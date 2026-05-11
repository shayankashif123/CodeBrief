"""
ASGI middleware stack for the AI service.

Middleware 1 — InternalAuthMiddleware:
  Every request (except /health) must carry X-Internal-Secret matching the
  configured secret. This prevents anyone who discovers port 8000 from
  calling the AI service directly, bypassing NestJS auth entirely.
  Uses hmac.compare_digest — constant-time comparison, not ==, to prevent
  timing attacks.

Middleware 2 — RequestIdMiddleware:
  Generates or propagates a request ID for every request. Injected into
  structlog's contextvars so every log line for a request carries the same ID.
  NestJS passes its own X-Request-Id when calling FastAPI — we propagate it
  so the full request chain is traceable across both services in CloudWatch.
"""

import hmac
import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.logging import get_logger

logger = get_logger(__name__)

# Routes that bypass internal auth — only health/readiness probes
_PUBLIC_PATHS = {"/health", "/ready"}


class RequestIdMiddleware(BaseHTTPMiddleware):
    """
    Injects a request ID into every request.

    - Propagates X-Request-Id from NestJS if present
    - Generates a new UUID otherwise
    - Binds to structlog contextvars so all log lines carry request_id
    - Echoes the ID back in the response header for traceability
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())

        # Bind to structlog context — cleared automatically after response
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        start_time = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

        # Only log non-health endpoints to avoid log spam from ECS health checks
        if request.url.path not in _PUBLIC_PATHS:
            logger.info(
                "request_completed",
                status_code=response.status_code,
                duration_ms=duration_ms,
            )

        response.headers["X-Request-Id"] = request_id
        return response


class InternalAuthMiddleware(BaseHTTPMiddleware):
    """
    Validates X-Internal-Secret header on every non-public request.

    Uses hmac.compare_digest instead of == to prevent timing attacks.
    Returns 401 immediately — no route handler is called on failure.
    """

    def __init__(self, app, secret: str):
        super().__init__(app)
        self._secret = secret

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path in _PUBLIC_PATHS:
            return await call_next(request)

        incoming = request.headers.get("X-Internal-Secret", "")

        # hmac.compare_digest requires both operands to be the same type
        if not hmac.compare_digest(
            incoming.encode("utf-8"),
            self._secret.encode("utf-8"),
        ):
            logger.warning(
                "unauthorized_request",
                path=request.url.path,
                has_header=bool(incoming),
            )
            return JSONResponse(
                status_code=401,
                content={
                    "statusCode": 401,
                    "error": "UNAUTHORIZED",
                    "message": "Missing or invalid X-Internal-Secret",
                },
            )

        return await call_next(request)
