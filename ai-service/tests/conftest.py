"""
Shared test fixtures and configuration for the AI service test suite.

Design decisions:
- All fixtures use pytest-asyncio — the entire service is async
- Fixtures that mock external services (Google API, Qdrant, MongoDB) are
  session-scoped where possible to reduce setup overhead
- The `app` fixture uses TestClient with dependency_overrides so tests
  never touch real infrastructure
- Settings are patched via environment variables using monkeypatch,
  then get_settings.cache_clear() is called to force re-parsing

Test environment variables (set here so tests never need a real .env):
"""

import os

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock

# Set required env vars before importing anything that reads settings
# This must happen at module load time — before Settings() is constructed
os.environ.setdefault("INTERNAL_SECRET", "test-secret-at-least-32-chars-long-abc")
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017")
os.environ.setdefault("QDRANT_URL", "http://localhost:6333")
os.environ.setdefault("GOOGLE_API_KEY", "test-google-api-key")
os.environ.setdefault("ENV", "development")


@pytest.fixture(autouse=True)
def clear_settings_cache():
    """
    Clear the lru_cache on get_settings before each test.

    Without this, the first test to import settings would cache the values
    and every subsequent test — even those that monkeypatch env vars —
    would see the stale cached object.
    """
    from app.core.config import get_settings
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def mock_qdrant() -> AsyncMock:
    """Mock AsyncQdrantClient — prevents real Qdrant connections in unit tests."""
    mock = AsyncMock()
    mock.get_collections.return_value = MagicMock(collections=[])
    mock.search.return_value = []
    mock.upsert.return_value = None
    mock.delete.return_value = None
    return mock


@pytest.fixture
def mock_mongo_db() -> AsyncMock:
    """Mock AsyncIOMotorDatabase — prevents real MongoDB connections in unit tests."""
    mock = AsyncMock()
    mock.command.return_value = {"ok": 1}
    mock.reviews = AsyncMock()
    mock.documentation = AsyncMock()
    mock.codebase_snapshots = AsyncMock()
    return mock


@pytest.fixture
def mock_embedding_service() -> AsyncMock:
    """
    Mock EmbeddingService — returns deterministic 768-dim vectors.
    Use this in router tests to avoid hitting the Google API.
    """
    mock = AsyncMock()
    mock_vector = [0.1] * 768
    mock.embed_document.return_value = mock_vector
    mock.embed_query.return_value = mock_vector
    mock.embed_documents.return_value = [mock_vector]
    return mock


@pytest.fixture
def test_app(mock_qdrant, mock_mongo_db):
    """
    Full FastAPI test application with all infrastructure mocked.

    Dependency overrides replace real clients with mocks so tests
    never touch Qdrant, MongoDB, or Google APIs.
    """
    from main import create_app
    from app.core.dependencies import get_qdrant, get_mongo_db

    app = create_app()

    # Override infrastructure dependencies
    app.dependency_overrides[get_qdrant] = lambda: mock_qdrant
    app.dependency_overrides[get_mongo_db] = lambda: mock_mongo_db

    # Store mocks on app.state for middleware (readiness probe accesses app.state directly)
    app.state.qdrant = mock_qdrant
    app.state.db = mock_mongo_db

    return app


@pytest.fixture
def client(test_app) -> TestClient:
    """
    Synchronous TestClient wrapping the test app.

    For most route tests, the synchronous TestClient is simpler than
    using httpx.AsyncClient. Use AsyncClient only when you need to test
    streaming responses or WebSocket connections.
    """
    return TestClient(
        test_app,
        headers={"X-Internal-Secret": "test-secret-at-least-32-chars-long-abc"},
    )
