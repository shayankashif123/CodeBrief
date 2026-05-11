"""
MongoDB client — Motor async driver, singleton lifecycle on app.state.

Design decisions:
- Motor is the official async MongoDB driver — wraps PyMongo, returns coroutines
- Single AsyncIOMotorClient per process — Motor manages its own connection pool
- Collections and indexes bootstrapped at startup (idempotent)
- TTL indexes on codebase_snapshots for automatic cleanup of old indexing records
- Indexes mirror what the NestJS side queries — never create an index without
  knowing which query it serves
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, IndexModel

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)


async def create_mongo_client() -> tuple[AsyncIOMotorClient, AsyncIOMotorDatabase]:
    """
    Create Motor client and return (client, db) tuple.
    Both stored on app.state — client for graceful shutdown, db for queries.
    """
    settings = get_settings()

    client = AsyncIOMotorClient(
        settings.MONGODB_URI,
        serverSelectionTimeoutMS=5000,  # fail fast if Mongo unreachable
        maxPoolSize=10,
        minPoolSize=2,
    )

    # Verify connectivity — raises if unreachable
    await client.admin.command("ping")
    logger.info("mongo_connected", db=settings.MONGODB_DB_NAME)

    db = client[settings.MONGODB_DB_NAME]
    await _ensure_indexes(db)

    return client, db


async def _ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """
    Create all MongoDB indexes — idempotent (MongoDB skips existing indexes).

    Index rationale:
    - reviews: queried by postgres_repo_id (dashboard), postgres_review_id (lookup),
      and pull_request.pr_number (finding a specific review)
    - documentation: queried by postgres_repo_id + status (pending review queue)
    - codebase_snapshots: queried by postgres_repo_id + trigger_sha (debugging)
    """

    # ── reviews collection ────────────────────────────────────────────────────
    await db.reviews.create_indexes([
        IndexModel(
            [("postgres_repo_id", ASCENDING)],
            name="idx_postgres_repo_id",
        ),
        IndexModel(
            [("postgres_review_id", ASCENDING)],
            unique=True,
            name="idx_postgres_review_id",
        ),
        IndexModel([
            ("pull_request.pr_number", ASCENDING),
            ("postgres_repo_id", ASCENDING),
        ], name="idx_pr_number_repo"),
        IndexModel(
            [("created_at", DESCENDING)],
            name="idx_created_at",
        ),  # dashboard: recent reviews first
    ])

    # ── documentation collection ──────────────────────────────────────────────
    await db.documentation.create_indexes([
        IndexModel([("postgres_repo_id", ASCENDING)], name="idx_repo_id"),
        IndexModel([
            ("postgres_repo_id", ASCENDING),
            ("status", ASCENDING),
        ], name="idx_repo_status"),  # "give me all pending reviews for this repo"
        IndexModel([
            ("trigger.pr_number", ASCENDING),
            ("postgres_repo_id", ASCENDING),
        ], name="idx_pr_repo"),
        IndexModel([("created_at", DESCENDING)], name="idx_created_at"),
        IndexModel([("status", ASCENDING)], name="idx_status"),
    ])

    # ── codebase_snapshots collection ─────────────────────────────────────────
    await db.codebase_snapshots.create_indexes([
        IndexModel([("postgres_repo_id", ASCENDING)], name="idx_repo_id"),
        IndexModel([
            ("trigger_sha", ASCENDING),
        ], name="idx_trigger_sha"),
        IndexModel([("created_at", DESCENDING)], name="idx_created_at"),
        IndexModel([("status", ASCENDING)], name="idx_status"),
        # Auto-delete snapshots older than 90 days — they're audit trail, not source of truth
        IndexModel(
            [("created_at", ASCENDING)],
            expireAfterSeconds=90 * 24 * 60 * 60,
            name="snapshots_ttl",
        ),
    ])

    logger.info("mongo_indexes_ensured")
