"""
FastAPI application entry point — Codebrief AI Service.

Architecture:
- create_app() factory function (not a module-level app instance) — testable,
  importable without side effects, matches the pattern of NestJS's bootstrap()
- Lifespan context manager handles all startup/shutdown in one place:
    startup: configure logging → connect clients → store on app.state
    shutdown: close connections cleanly (important for ECS task draining)
- Middleware applied in registration order (bottom of stack executes first):
    1. RequestIdMiddleware  — always first, establishes request_id for all logs
    2. InternalAuthMiddleware — second, rejects unauthorized before any work
- Exception handlers cover our typed hierarchy + bare Exception fallback
- Swagger UI available at /api/docs in non-production environments only

Startup sequence (order matters):
1. configure_logging() — must be first, everything else logs
2. configure_gemini() — global SDK configuration, must run before any embed/generate call
3. create_qdrant_client() — bootstraps collection + indexes, stored on app.state
4. create_mongo_client() — bootstraps indexes, stored on app.state
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.clients.gemini import configure_gemini
from app.clients.mongo import create_mongo_client
from app.clients.qdrant import create_qdrant_client
from app.core.config import get_settings
from app.core.exceptions import (
    CodebriefAIError,
    codebrief_exception_handler,
    unhandled_exception_handler,
)
from app.core.logging import configure_logging, get_logger
from app.core.middleware import InternalAuthMiddleware, RequestIdMiddleware
from app.routers import health, embeddings

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan — startup and shutdown in one coherent block.

    Using the lifespan context manager (not deprecated @app.on_event) as
    recommended since FastAPI 0.93. Everything before `yield` is startup;
    everything after is shutdown.

    Clients are stored on app.state so they're accessible via request.app.state
    in route handlers and middleware — no module-level singletons.
    """
    settings = get_settings()

    # ── Startup ───────────────────────────────────────────────────────────────
    configure_logging()
    logger.info(
        "ai_service_starting",
        env=settings.ENV,
        log_level=settings.LOG_LEVEL,
    )

    # Configure Google SDK — must happen before any embed/generate call
    configure_gemini()

    # Connect to Qdrant — bootstraps collection and payload indexes
    app.state.qdrant = await create_qdrant_client()

    # Connect to MongoDB — bootstraps indexes, returns (client, db) tuple
    mongo_client, db = await create_mongo_client()
    app.state.mongo_client = mongo_client  # kept for shutdown
    app.state.db = db

    logger.info("ai_service_ready", port=settings.PORT)

    yield  # Application is now running

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("ai_service_shutting_down")

    # Close Qdrant connection
    await app.state.qdrant.close()

    # Close MongoDB connection — drains in-flight operations
    app.state.mongo_client.close()

    logger.info("ai_service_shutdown_complete")


def create_app() -> FastAPI:
    """
    Application factory — creates and configures the FastAPI instance.

    Using a factory function (not module-level app = FastAPI()) means:
    - Tests can call create_app() and get a fresh instance each time
    - The module can be imported without starting the app
    - Settings are read at factory call time, not import time
    """
    settings = get_settings()

    app = FastAPI(
        title="Codebrief AI Service",
        description="AI pipeline for PR review and documentation generation",
        version="1.0.0",
        # Only expose Swagger UI in non-production environments
        docs_url="/api/docs" if settings.ENV != "production" else None,
        redoc_url="/api/redoc" if settings.ENV != "production" else None,
        openapi_url="/api/openapi.json" if settings.ENV != "production" else None,
        lifespan=lifespan,
    )

    # ── Middleware (applied bottom-up — last registered executes first) ────────
    # InternalAuthMiddleware executes second (validates secret)
    app.add_middleware(
        InternalAuthMiddleware,
        secret=settings.INTERNAL_SECRET,
    )
    # RequestIdMiddleware executes first (establishes request_id for all subsequent logs)
    app.add_middleware(RequestIdMiddleware)

    # CORS — only relevant if this service is ever called from a browser directly
    # In production it never is (only NestJS calls it), but needed for local Swagger UI
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"] if settings.ENV != "production" else [],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Exception handlers ────────────────────────────────────────────────────
    # Typed hierarchy handler — covers all CodebriefAIError subclasses
    app.add_exception_handler(CodebriefAIError, codebrief_exception_handler)
    # Fallback — catches anything not in our typed hierarchy
    app.add_exception_handler(Exception, unhandled_exception_handler)

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(health.router)          # /health, /ready — no prefix
    app.include_router(embeddings.router)      # /embeddings/embed

    # Task 6 routers — added in the next task
    # app.include_router(indexing.router)      # /indexing/start, /indexing/status
    # app.include_router(review.router)        # /review

    return app


# ── ASGI application instance ─────────────────────────────────────────────────
# Uvicorn targets this: uvicorn main:app
# Tests import create_app() directly and never touch this module-level instance
app = create_app()
