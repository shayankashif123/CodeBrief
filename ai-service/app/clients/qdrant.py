"""
Qdrant client — singleton lifecycle tied to FastAPI app state.

Design decisions:
- One QdrantClient instance per process, stored on app.state
- Collection and payload indexes are created at startup if they don't exist
  (idempotent — safe to run on every deploy)
- Payload indexes on repository_id and file_path are CRITICAL for performance:
  without them every vector search does a full collection scan
- Cosine distance for semantic similarity (text embeddings)
- 768 dimensions matches text-embedding-004 output exactly
- Async client used throughout — never blocks the event loop
"""

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    PayloadSchemaType,
    VectorParams,
)

from app.core.config import Settings, get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

async def create_qdrant_client() -> AsyncQdrantClient:
    """
    Create and return an AsyncQdrantClient.
    Called once during app lifespan startup — stored on app.state.
    """
    settings = get_settings()

    client = AsyncQdrantClient(
        url=settings.QDRANT_URL,
        api_key=settings.QDRANT_API_KEY,  # None is fine for local Docker
        timeout=30,
    )

    # Verify connectivity
    await client.get_collections()
    logger.info("qdrant_connected", url=settings.QDRANT_URL)

    # Bootstrap collection and indexes — idempotent
    await _ensure_collection(client, settings)
    await _ensure_payload_indexes(client, settings.QDRANT_COLLECTION_NAME)

    return client


async def _ensure_collection(client: AsyncQdrantClient, settings: Settings) -> None:
    """
    Create the codebase_chunks collection if it doesn't exist.
    Safe to call on every startup — skips creation if already present.
    """
    existing = await client.get_collections()
    existing_names = {c.name for c in existing.collections}

    collection_name = settings.QDRANT_COLLECTION_NAME

    if collection_name in existing_names:
        logger.info("qdrant_collection_exists", collection=collection_name)
        return

    await client.create_collection(
        collection_name=collection_name,
        vectors_config=VectorParams(
            size=settings.EMBEDDING_DIM,       # 768 for text-embedding-004
            distance=Distance.COSINE,           # standard for text similarity
            on_disk=False,                      # keep in memory for speed
        ),
    )
    logger.info("qdrant_collection_created", collection=collection_name)


async def _ensure_payload_indexes(
    client: AsyncQdrantClient, collection_name: str
) -> None:
    """
    Create payload indexes on filter fields.

    These are the most important performance configuration in Qdrant.
    Without them, every search with a filter does a full collection scan —
    O(n) instead of O(log n). With large codebases this is the difference
    between 50ms and 5000ms query time.

    repository_id — filtered on EVERY single query (data isolation)
    file_path     — filtered during incremental re-indexing (delete old chunks)
    chunk_type    — sometimes filtered to get only functions or classes
    language      — sometimes filtered for language-specific retrieval
    """
    indexes = [
        ("repository_id", PayloadSchemaType.KEYWORD),
        ("file_path", PayloadSchemaType.KEYWORD),
        ("chunk_type", PayloadSchemaType.KEYWORD),
        ("language", PayloadSchemaType.KEYWORD),
    ]

    collection_info = await client.get_collection(collection_name)
    existing_indexes = set(
        collection_info.payload_schema.keys()
        if collection_info.payload_schema
        else []
    )

    for field_name, schema_type in indexes:
        if field_name in existing_indexes:
            continue
        await client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=schema_type,
        )
        logger.info(
            "qdrant_index_created",
            collection=collection_name,
            field=field_name,
        )
