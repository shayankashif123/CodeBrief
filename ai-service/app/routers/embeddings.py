"""
Embeddings router — internal endpoint for testing and diagnostics.

This router is NOT part of the core product flow (indexing and review
have their own routers). It exists for:
1. End-to-end smoke testing — confirms the full embedding pipeline works
2. NestJS health integration — NestJS /api/ready can call this to verify
   the AI service embedding pipeline is functional, not just alive
3. Development tooling — embed a text and inspect the vector manually

All endpoints require X-Internal-Secret (enforced by InternalAuthMiddleware).
"""

from fastapi import APIRouter, Depends

from app.core.config import Settings
from app.core.dependencies import get_embedding_service, get_settings_dep
from app.core.logging import get_logger
from app.models.embedding import (
    BatchEmbedRequest,
    BatchEmbedResponse,
    EmbedRequest,
    EmbedResponse,
)
from app.services.embedding_service import EmbeddingService

logger = get_logger(__name__)

router = APIRouter(prefix="/embeddings", tags=["embeddings"])

_MAX_CHARS = 6000  # text-embedding-004 limit — matches EmbeddingService._MAX_CHARS_PER_TEXT


@router.post("/embed", response_model=EmbedResponse)
async def embed_text(
    body: EmbedRequest,
    embedding_svc: EmbeddingService = Depends(get_embedding_service),
    settings: Settings = Depends(get_settings_dep),
) -> EmbedResponse:
    """
    Embed a single text string.

    Used for diagnostics and integration testing.
    Not called in the production indexing or review flows.
    """
    original_length = len(body.text)
    truncated = original_length > _MAX_CHARS

    if body.task_type == "RETRIEVAL_QUERY":
        vector = await embedding_svc.embed_query(body.text)
    else:
        vector = await embedding_svc.embed_document(body.text)

    logger.info(
        "embed_request",
        task_type=body.task_type,
        original_length=original_length,
        truncated=truncated,
        dimensions=len(vector),
    )

    return EmbedResponse(
        embedding=vector,
        dimensions=len(vector),
        model=settings.EMBEDDING_MODEL,
        task_type=body.task_type,
        truncated=truncated,
        original_length=original_length,
    )


@router.post("/embed-batch", response_model=BatchEmbedResponse)
async def embed_batch(
    body: BatchEmbedRequest,
    embedding_svc: EmbeddingService = Depends(get_embedding_service),
    settings: Settings = Depends(get_settings_dep),
) -> BatchEmbedResponse:
    """
    Embed a batch of texts (up to 100).

    Useful for testing the batch embedding path used during indexing,
    without needing to trigger a full repository clone.
    """
    if body.task_type == "RETRIEVAL_QUERY":
        # Batch queries are unusual but supported
        embeddings = [await embedding_svc.embed_query(t) for t in body.texts]
    else:
        embeddings = await embedding_svc.embed_documents(body.texts)

    logger.info(
        "batch_embed_request",
        count=len(body.texts),
        task_type=body.task_type,
        dimensions=len(embeddings[0]) if embeddings else 0,
    )

    return BatchEmbedResponse(
        embeddings=embeddings,
        count=len(embeddings),
        dimensions=len(embeddings[0]) if embeddings else 0,
        model=settings.EMBEDDING_MODEL,
        task_type=body.task_type,
    )
