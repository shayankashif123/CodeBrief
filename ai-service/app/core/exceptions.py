"""
Exception hierarchy for the AI service.
"""

from datetime import UTC, datetime

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.logging import get_logger

logger = get_logger(__name__)


class CodebriefAIError(Exception):
    status_code: int = 500
    error_code: str = "INTERNAL_ERROR"

    def __init__(self, message: str, **context):
        super().__init__(message)
        self.message = message
        self.context = context


class QdrantError(CodebriefAIError):
    status_code = 503
    error_code = "QDRANT_ERROR"


class MongoError(CodebriefAIError):
    status_code = 503
    error_code = "MONGO_ERROR"


class GeminiError(CodebriefAIError):
    status_code = 503
    error_code = "GEMINI_ERROR"


class EmbeddingError(CodebriefAIError):
    status_code = 503
    error_code = "EMBEDDING_FAILED"


class RepositoryNotIndexedError(CodebriefAIError):
    status_code = 422
    error_code = "REPOSITORY_NOT_INDEXED"


class DiffTooLargeError(CodebriefAIError):
    status_code = 422
    error_code = "DIFF_TOO_LARGE"


class InvalidDiffError(CodebriefAIError):
    status_code = 422
    error_code = "INVALID_DIFF"


class IndexingError(CodebriefAIError):
    status_code = 500
    error_code = "INDEXING_FAILED"


class CloneError(CodebriefAIError):
    status_code = 422
    error_code = "CLONE_FAILED"


class UnauthorizedError(CodebriefAIError):
    status_code = 401
    error_code = "UNAUTHORIZED"


def _error_body(request: Request, exc: CodebriefAIError) -> dict:
    return {
        "statusCode": exc.status_code,
        "error": exc.error_code,
        "message": exc.message,
        "timestamp": datetime.now(UTC).isoformat(),
        "path": str(request.url.path),
    }


async def codebrief_exception_handler(
    request: Request, exc: CodebriefAIError
) -> JSONResponse:
    logger.error(
        "request_failed",
        error_code=exc.error_code,
        message=exc.message,
        path=str(request.url.path),
        status_code=exc.status_code,
        **exc.context,
    )
    return JSONResponse(status_code=exc.status_code, content=_error_body(request, exc))


async def unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    logger.exception(
        "unhandled_exception",
        path=str(request.url.path),
        exc_type=type(exc).__name__,
    )
    return JSONResponse(
        status_code=500,
        content={
            "statusCode": 500,
            "error": "INTERNAL_ERROR",
            "message": "An unexpected error occurred",
            "timestamp": datetime.now(UTC).isoformat(),
            "path": str(request.url.path),
        },
    )
