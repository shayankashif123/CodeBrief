"""
FastAPI dependency providers.

Design decisions:
- All clients live on app.state (set during lifespan startup)
- These thin Depends() functions pull them off app.state and inject into routes/services
- This pattern means:
    1. Routes never import clients directly — only via Depends()
    2. In tests, override with: app.dependency_overrides[get_qdrant] = lambda: mock_client
    3. No global singletons in module scope — everything flows through the graph
- Explicit return type annotations let IDEs and mypy understand what is injected

Usage in a route:
    @router.post("/review")
    async def create_review(
        body: ReviewRequest,
        qdrant: AsyncQdrantClient = Depends(get_qdrant),
        db: AsyncIOMotorDatabase = Depends(get_mongo_db),
        settings: Settings = Depends(get_settings_dep),
    ):
        ...
"""

from fastapi import Depends, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from qdrant_client import AsyncQdrantClient

from app.core.config import Settings, get_settings
from app.services.embedding_service import EmbeddingService


# ── Infrastructure clients ────────────────────────────────────────────────────


def get_qdrant(request: Request) -> AsyncQdrantClient:
    """Inject the Qdrant async client from app.state."""
    return request.app.state.qdrant


def get_mongo_db(request: Request) -> AsyncIOMotorDatabase:
    """
    Inject the MongoDB database handle from app.state.

    Named get_mongo_db (not get_db) to be unambiguous — future sprints
    will not add Postgres here (TypeORM handles that in NestJS), but
    clarity costs nothing.
    """
    return request.app.state.db


def get_settings_dep() -> Settings:
    """
    Inject settings via Depends() — thin wrapper around get_settings().

    Using this instead of importing get_settings() directly in routes
    allows test overrides via app.dependency_overrides.
    """
    return get_settings()


# ── Service layer ─────────────────────────────────────────────────────────────


def get_embedding_service(
    settings: Settings = Depends(get_settings_dep),
) -> EmbeddingService:
    """
    Inject EmbeddingService with all config values from settings.

    EmbeddingService is stateless — it holds only config values, no mutable
    state. We construct it per-request via Depends() (cheap, no I/O) rather
    than storing on app.state. This keeps the dependency graph explicit:
    routes declare what they need, not what global state they reach into.

    All tunable parameters come from settings — no magic numbers in the service.
    """
    return EmbeddingService(
        model=settings.EMBEDDING_MODEL,
        batch_size=settings.EMBEDDING_BATCH_SIZE,
        batch_sleep_seconds=settings.EMBEDDING_BATCH_SLEEP_SECONDS,
    )
