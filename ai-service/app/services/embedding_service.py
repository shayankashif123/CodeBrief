"""
EmbeddingService — generates vector embeddings via Google text-embedding-004.

Design decisions:

1. RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY task types
   Google's text-embedding-004 is a biencoder trained with two separate task types.
   Using the wrong type degrades retrieval quality measurably:
   - RETRIEVAL_DOCUMENT: use when embedding content to be stored (code chunks at index time)
   - RETRIEVAL_QUERY: use when embedding a query to search against stored content (diff at review time)
   - SEMANTIC_SIMILARITY: use when comparing two texts symmetrically (not our use case)
   This is documented but easy to miss — it's the single most impactful correctness decision here.

2. Batching
   Google allows up to 100 texts per embed_content call. Sending 4000 chunks one by one
   = 4000 API calls. Batching into groups of 100 = 40 API calls. 100x fewer round trips.
   Each batch call is still synchronous in the SDK, so we run it in a thread executor.

3. Retry with exponential backoff via tenacity
   Google's embedding API returns 429 (rate limit) and 503 (transient) under load.
   A bare try/except that gives up immediately is wrong in production.
   tenacity.retry with exponential backoff + jitter handles both gracefully.
   We retry up to 3 times. If all 3 fail, we raise EmbeddingError — not a bare exception —
   so the caller knows exactly what failed and why.

4. asyncio.to_thread for the sync SDK
   google-generativeai is synchronous. Calling it directly in an async route blocks the
   entire event loop — no other requests are served during the API call (~200ms).
   asyncio.to_thread() runs it in the default ThreadPoolExecutor, keeping the loop free.

5. Input truncation
   text-embedding-004 has a 2048 token limit per text. Code chunks longer than ~6000 chars
   will be truncated by Google silently. We truncate at 6000 chars explicitly so the
   truncation is visible and logged, not a silent quality degradation.

6. No state beyond config
   EmbeddingService is intentionally stateless — it holds model name and batch size,
   nothing else. This makes it trivially injectable and testable with a mock.
"""

import asyncio
from typing import Literal

import google.generativeai as genai
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    wait_random,
    wait_combine,
)

from app.core.exceptions import EmbeddingError
from app.core.logging import get_logger

logger = get_logger(__name__)

# Google text-embedding-004 hard limits
_MAX_CHARS_PER_TEXT = 6000      # ~2000 tokens — truncate before sending
_MAX_BATCH_SIZE = 100           # Google API maximum
_EMBEDDING_DIM = 768            # text-embedding-004 output dimensions

# Task type literals — using Google's exact string values
TaskType = Literal[
    "RETRIEVAL_DOCUMENT",
    "RETRIEVAL_QUERY",
    "SEMANTIC_SIMILARITY",
    "CLASSIFICATION",
    "CLUSTERING",
]


class EmbeddingService:
    """
    Wraps Google text-embedding-004 with batching, retries, and correct task typing.

    Instantiated per-request via Depends(get_embedding_service).
    Stateless — safe to construct multiple times, no shared mutable state.
    """

    def __init__(
        self,
        model: str,
        batch_size: int = 100,
        batch_sleep_seconds: float = 0.3,
    ):
        self._model = model
        self._batch_size = min(batch_size, _MAX_BATCH_SIZE)
        self._batch_sleep_seconds = batch_sleep_seconds

    # ── Public API ────────────────────────────────────────────────────────────

    async def embed_document(self, text: str) -> list[float]:
        """
        Embed a single document for storage (code chunk at index time).
        Uses RETRIEVAL_DOCUMENT task type.
        """
        results = await self.embed_documents([text])
        return results[0]

    async def embed_query(self, text: str) -> list[float]:
        """
        Embed a query for similarity search (diff at review time).
        Uses RETRIEVAL_QUERY task type — different from embed_document.
        """
        truncated = self._truncate(text)
        return await self._embed_single(truncated, task_type="RETRIEVAL_QUERY")

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """
        Batch embed multiple documents for storage.
        Uses RETRIEVAL_DOCUMENT task type.
        Processes in batches of self._batch_size with a rate-limit buffer between batches.
        """
        if not texts:
            return []

        truncated_texts = [self._truncate(t) for t in texts]
        all_embeddings: list[list[float]] = []

        for batch_start in range(0, len(truncated_texts), self._batch_size):
            batch = truncated_texts[batch_start : batch_start + self._batch_size]

            logger.debug(
                "embedding_batch",
                batch_index=batch_start // self._batch_size,
                batch_size=len(batch),
                total_texts=len(texts),
            )

            batch_embeddings = await self._embed_batch_with_retry(
                batch, task_type="RETRIEVAL_DOCUMENT"
            )
            all_embeddings.extend(batch_embeddings)

            # Rate-limit buffer between batches — not needed for single batches
            if batch_start + self._batch_size < len(truncated_texts):
                await asyncio.sleep(self._batch_sleep_seconds)

        logger.info(
            "embedding_complete",
            total_texts=len(texts),
            total_embeddings=len(all_embeddings),
        )
        return all_embeddings

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _embed_single(
        self, text: str, task_type: TaskType
    ) -> list[float]:
        """Embed a single text with retry logic."""
        results = await self._embed_batch_with_retry([text], task_type=task_type)
        return results[0]

    async def _embed_batch_with_retry(
        self, texts: list[str], task_type: TaskType
    ) -> list[list[float]]:
        """
        Core embedding call wrapped in tenacity retry.

        Retry strategy:
        - Retries on any Exception (Google SDK raises various types for transient errors)
        - Exponential backoff: 1s → 2s → 4s, plus random jitter (0–1s) to avoid thundering herd
        - Maximum 3 attempts — if all fail, raises EmbeddingError
        - Logs each retry attempt
        """

        @retry(
            retry=retry_if_exception_type(Exception),
            stop=stop_after_attempt(3),
            wait=wait_combine(
                wait_exponential(multiplier=1, min=1, max=8),
                wait_random(0, 1),  # jitter
            ),
            reraise=False,  # we handle the final failure below
        )
        async def _attempt() -> list[list[float]]:
            return await asyncio.to_thread(
                self._call_google_sdk, texts, task_type
            )

        try:
            return await _attempt()
        except Exception as exc:
            raise EmbeddingError(
                f"Embedding failed after 3 retries: {exc}",
                task_type=task_type,
                batch_size=len(texts),
                model=self._model,
            ) from exc

    def _call_google_sdk(
        self, texts: list[str], task_type: TaskType
    ) -> list[list[float]]:
        """
        Synchronous Google SDK call — runs in thread executor via asyncio.to_thread.

        Returns a list of embedding vectors in the same order as input texts.
        """
        result = genai.embed_content(
            model=self._model,
            content=texts,
            task_type=task_type,
        )
        # Google SDK returns {"embedding": [...]} for single input
        # and {"embedding": [[...], [...]]} for batch input
        embeddings = result["embedding"]

        # Normalise: single input comes back as a flat list, not a list of lists
        if texts and isinstance(embeddings[0], float):
            return [embeddings]
        return embeddings

    @staticmethod
    def _truncate(text: str) -> str:
        """
        Truncate text to the Google API character limit.
        We do this explicitly rather than letting Google truncate silently.
        """
        if len(text) > _MAX_CHARS_PER_TEXT:
            logger.debug(
                "text_truncated",
                original_len=len(text),
                truncated_len=_MAX_CHARS_PER_TEXT,
            )
            return text[:_MAX_CHARS_PER_TEXT]
        return text
