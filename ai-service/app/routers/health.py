"""
Health and readiness endpoints.

/health  — liveness probe: is the process alive? Always returns 200 if the server is up.
           ECS uses this to decide whether to kill and restart the container.

/ready   — readiness probe: are all dependencies reachable?
           ECS/ALB uses this to decide whether to route traffic to this instance.
           Returns 200 only if Qdrant, MongoDB, and Google API are all reachable.
           Returns 503 if any dependency is down — ALB stops routing to this instance.

Design decisions:
- Liveness (/health) never checks dependencies — a slow Qdrant should not cause
  the container to restart (which would make things worse). Only the process health matters.
- Readiness (/ready) checks all three with a short timeout — if a dependency is down,
  we want traffic to fail fast at the load balancer, not inside a hung request handler.
- Both endpoints are excluded from InternalAuthMiddleware (public paths list).
- Response includes dependency status breakdown so engineers can see WHICH dep is down.
"""

import asyncio

import google.generativeai as genai
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def liveness():
    """
    Liveness probe — always 200 if the process is running.
    ECS restarts the container only if this returns non-200 or times out.
    """
    return {"status": "ok", "service": "codebrief-ai"}


@router.get("/ready")
async def readiness(request: Request):
    """
    Readiness probe — checks all downstream dependencies.
    Returns 503 with a breakdown if any dependency is unreachable.
    """
    checks = {}
    all_healthy = True

    # ── Qdrant ────────────────────────────────────────────────────────────────
    try:
        qdrant = request.app.state.qdrant
        await qdrant.get_collections()
        checks["qdrant"] = "ok"
    except Exception as exc:
        checks["qdrant"] = f"error: {exc}"
        all_healthy = False
        logger.error("readiness_qdrant_failed", error=str(exc))

    # ── MongoDB ───────────────────────────────────────────────────────────────
    try:
        db = request.app.state.db
        await db.command("ping")
        checks["mongodb"] = "ok"
    except Exception as exc:
        checks["mongodb"] = f"error: {exc}"
        all_healthy = False
        logger.error("readiness_mongo_failed", error=str(exc))

    # ── Google API ────────────────────────────────────────────────────────────
    try:
        # Lightweight auth/connectivity check using configured SDK credentials.
        await asyncio.to_thread(lambda: next(genai.list_models(page_size=1), None))
        checks["google_api"] = "ok"
    except Exception as exc:
        checks["google_api"] = f"error: {exc}"
        all_healthy = False
        logger.error("readiness_google_failed", error=str(exc))

    status_code = 200 if all_healthy else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ok" if all_healthy else "degraded",
            "service": "codebrief-ai",
            "checks": checks,
        },
    )
