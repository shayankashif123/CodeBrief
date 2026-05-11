"""
Unit tests for EmbeddingService.

Test strategy:
- Mock genai.embed_content so tests never hit the real Google API
- Test each public method: embed_document, embed_query, embed_documents (batch)
- Test boundary conditions: empty list, single item, exact batch size, multi-batch
- Test truncation: text longer than 6000 chars gets truncated before sending
- Test retry: simulate first call failing, second call succeeding
- Test failure: simulate all 3 attempts failing — assert EmbeddingError raised
- Test task_type: assert RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY are passed correctly

asyncio_mode = "auto" in pyproject.toml means no @pytest.mark.asyncio decorator needed.
"""

import sys
from unittest.mock import MagicMock, patch

import pytest

# Mock google.generativeai at import time so tests run without the real SDK.
# This is necessary because the SDK has a transitive dependency on httplib2/pyparsing
# that raises a DeprecationWarning-as-error during collection in some environments.
# Our tests mock genai.embed_content anyway — this just makes collection succeed.
sys.modules["google"] = MagicMock()
sys.modules["google.generativeai"] = MagicMock()

from app.core.exceptions import EmbeddingError
from app.services.embedding_service import EmbeddingService, _MAX_CHARS_PER_TEXT

MOCK_VECTOR = [0.1] * 768
TEST_MODEL = "models/text-embedding-004"
TEST_BATCH_SIZE = 100


@pytest.fixture
def svc() -> EmbeddingService:
    return EmbeddingService(
        model=TEST_MODEL,
        batch_size=TEST_BATCH_SIZE,
        batch_sleep_seconds=0.0,  # no sleep in tests
    )


def make_google_response(count: int = 1) -> dict:
    """Build a mock Google SDK response for `count` embeddings."""
    if count == 1:
        return {"embedding": MOCK_VECTOR}
    return {"embedding": [MOCK_VECTOR] * count}


# ── embed_document ─────────────────────────────────────────────────────────────


async def test_embed_document_returns_vector(svc):
    with patch("app.services.embedding_service.genai.embed_content") as mock_embed:
        mock_embed.return_value = make_google_response(1)
        result = await svc.embed_document("def hello(): pass")

    assert isinstance(result, list)
    assert len(result) == 768
    assert result == MOCK_VECTOR


async def test_embed_document_uses_retrieval_document_task_type(svc):
    with patch("app.services.embedding_service.genai.embed_content") as mock_embed:
        mock_embed.return_value = make_google_response(1)
        await svc.embed_document("some code")

    _, kwargs = mock_embed.call_args
    assert kwargs["task_type"] == "RETRIEVAL_DOCUMENT"


# ── embed_query ────────────────────────────────────────────────────────────────


async def test_embed_query_uses_retrieval_query_task_type(svc):
    """CRITICAL: embed_query must use RETRIEVAL_QUERY, not RETRIEVAL_DOCUMENT."""
    with patch("app.services.embedding_service.genai.embed_content") as mock_embed:
        mock_embed.return_value = make_google_response(1)
        result = await svc.embed_query("how does auth work?")

    _, kwargs = mock_embed.call_args
    assert kwargs["task_type"] == "RETRIEVAL_QUERY"
    assert len(result) == 768


# ── embed_documents (batch) ────────────────────────────────────────────────────


async def test_embed_documents_empty_list(svc):
    result = await svc.embed_documents([])
    assert result == []


async def test_embed_documents_single_item(svc):
    with patch("app.services.embedding_service.genai.embed_content") as mock_embed:
        mock_embed.return_value = make_google_response(1)
        result = await svc.embed_documents(["single chunk"])

    assert len(result) == 1
    assert result[0] == MOCK_VECTOR


async def test_embed_documents_multiple_items_single_batch(svc):
    """3 items — all fit in one batch call."""
    texts = ["chunk one", "chunk two", "chunk three"]
    with patch("app.services.embedding_service.genai.embed_content") as mock_embed:
        mock_embed.return_value = make_google_response(3)
        result = await svc.embed_documents(texts)

    assert len(result) == 3
    mock_embed.assert_called_once()  # one batch call, not three


async def test_embed_documents_multi_batch():
    """
    150 items with batch_size=100 → 2 batch calls.
    First call: items 0–99, second call: items 100–149.
    """
    svc = EmbeddingService(model=TEST_MODEL, batch_size=100, batch_sleep_seconds=0.0)
    texts = [f"chunk {i}" for i in range(150)]
    call_count = 0

    def side_effect(**kwargs):
        nonlocal call_count
        call_count += 1
        count = len(kwargs["content"])
        return make_google_response(count)

    with patch("app.services.embedding_service.genai.embed_content", side_effect=side_effect):
        result = await svc.embed_documents(texts)

    assert len(result) == 150
    assert call_count == 2


# ── Truncation ─────────────────────────────────────────────────────────────────


async def test_truncation_at_max_chars(svc):
    """Text longer than _MAX_CHARS_PER_TEXT is truncated before sending to Google."""
    long_text = "x" * 10_000

    with patch("app.services.embedding_service.genai.embed_content") as mock_embed:
        mock_embed.return_value = make_google_response(1)
        await svc.embed_document(long_text)

    _, kwargs = mock_embed.call_args
    sent_content = kwargs["content"]
    assert len(sent_content[0]) == _MAX_CHARS_PER_TEXT


async def test_no_truncation_under_limit(svc):
    """Text under the limit is sent as-is — no modification."""
    short_text = "def hello(): pass"

    with patch("app.services.embedding_service.genai.embed_content") as mock_embed:
        mock_embed.return_value = make_google_response(1)
        await svc.embed_document(short_text)

    _, kwargs = mock_embed.call_args
    assert kwargs["content"][0] == short_text


# ── Retry logic ────────────────────────────────────────────────────────────────


async def test_retries_on_transient_failure(svc):
    """First call raises, second call succeeds — result returned normally."""
    call_count = 0

    def side_effect(**kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise Exception("503 Service Unavailable")
        return make_google_response(1)

    with patch("app.services.embedding_service.genai.embed_content", side_effect=side_effect):
        result = await svc.embed_document("test")

    assert call_count == 2
    assert result == MOCK_VECTOR


async def test_raises_embedding_error_after_all_retries_exhausted(svc):
    """All 3 attempts fail → EmbeddingError raised (not a bare Exception)."""
    with patch(
        "app.services.embedding_service.genai.embed_content",
        side_effect=Exception("Rate limited"),
    ):
        with pytest.raises(EmbeddingError) as exc_info:
            await svc.embed_document("test")

    assert exc_info.value.error_code == "EMBEDDING_FAILED"
    assert "3 retries" in exc_info.value.message


# ── Batch size cap ─────────────────────────────────────────────────────────────


def test_batch_size_capped_at_100():
    """Constructor caps batch_size at 100 regardless of input."""
    svc = EmbeddingService(model=TEST_MODEL, batch_size=500)
    assert svc._batch_size == 100


def test_batch_size_below_max_preserved():
    svc = EmbeddingService(model=TEST_MODEL, batch_size=50)
    assert svc._batch_size == 50


def test_batch_sleep_seconds_stored():
    """Custom sleep value is preserved — used during multi-batch indexing."""
    svc = EmbeddingService(model=TEST_MODEL, batch_sleep_seconds=1.5)
    assert svc._batch_sleep_seconds == 1.5
