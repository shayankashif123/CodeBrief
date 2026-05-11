"""
Structured logging setup for the AI service.

Design decisions:
- Centralized logging config called once at startup.
- JSON logs in staging/production, console logs in development.
- Request-level context (request_id, method, path) is injected by middleware
  using structlog contextvars.
"""

import logging
import sys

import structlog

from app.core.config import get_settings

_CONFIGURED = False


def configure_logging() -> None:
    """Configure stdlib logging + structlog exactly once per process."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    settings = get_settings()
    level = getattr(logging, settings.LOG_LEVEL, logging.INFO)

    logging.basicConfig(
        level=level,
        format="%(message)s",
        stream=sys.stdout,
    )

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]

    if settings.ENV == "development":
        renderer = structlog.dev.ConsoleRenderer()
    else:
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    _CONFIGURED = True


def get_logger(name: str):
    """Return a structlog logger bound to the given module name."""
    return structlog.get_logger(name)
