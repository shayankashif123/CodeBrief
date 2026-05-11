"""
Application configuration — single source of truth for all environment variables.

Design decisions:
- Pydantic BaseSettings reads from environment + .env file automatically
- Validation happens at import time — the process refuses to start with missing vars
- All values are typed — no raw os.getenv() calls scattered through the codebase
- Nested models for logical grouping (DatabaseSettings, GoogleSettings, etc.)
- A single cached `get_settings()` function prevents re-parsing on every Depends() call
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    MONGODB_URI: str = Field(..., description="MongoDB connection string")
    MONGODB_DB_NAME: str = Field(default="codebrief", description="MongoDB database name")

    QDRANT_URL: str = Field(..., description="Qdrant instance URL")
    QDRANT_API_KEY: str | None = Field(
        default=None,
        description="Qdrant API key — required in production, optional locally",
    )
    QDRANT_COLLECTION_NAME: str = Field(
        default="codebase_chunks",
        description="Qdrant collection storing code embeddings",
    )


class GoogleSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    GOOGLE_API_KEY: str = Field(..., description="Google AI Studio API key")
    EMBEDDING_MODEL: str = Field(
        default="models/text-embedding-004",
        description="Google embedding model — produces 768-dim vectors",
    )
    GEMINI_MODEL: str = Field(
        default="gemini-2.0-flash",
        description="Gemini model used for review and doc generation",
    )
    EMBEDDING_BATCH_SIZE: int = Field(
        default=50,
        ge=1,
        le=100,
        description="Google allows max 100 texts per batch embed call",
    )
    EMBEDDING_DIM: int = Field(
        default=768,
        description="Output dimensions for text-embedding-004",
    )
    EMBEDDING_BATCH_SLEEP_SECONDS: float = Field(
        default=0.5,
        ge=0.0,
        description="Sleep between embedding batch calls to avoid rate limits",
    )
    EMBEDDING_MAX_CHARS: int = Field(
        default=6000,
        ge=500,
        description="Characters beyond this are truncated before embedding",
    )


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ENV: Literal["development", "staging", "production"] = Field(
        default="development",
        description="Runtime environment — controls log format and strictness",
    )
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(
        default="INFO",
    )
    # Shared secret between NestJS and FastAPI — every internal request carries this
    INTERNAL_SECRET: str = Field(
        ...,
        min_length=32,
        description="HMAC secret shared with NestJS for inter-service auth",
    )
    # Port FastAPI listens on inside the container
    PORT: int = Field(default=8000, ge=1024, le=65535)

    # Tmp directory for cloned repos during indexing
    REPO_CLONE_DIR: str = Field(
        default="/tmp/codebrief_repos",
        description="Temp directory for git clones — cleared after indexing",
    )


class Settings(DatabaseSettings, GoogleSettings, AppSettings):
    """
    Merged settings class — all environment variables in one place.
    Inherits from all sub-settings for logical grouping while keeping
    a single instantiation point.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # don't error on unknown env vars from Docker Compose
        case_sensitive=True,
    )

    @field_validator("QDRANT_API_KEY", mode="before")
    @classmethod
    def require_qdrant_key_in_production(cls, v: str | None, info) -> str | None:
        # We can't easily access ENV here in a field_validator,
        # so this is enforced in the model_validator below
        return v

    @model_validator(mode="after")
    def production_requirements(self) -> "Settings":
        if self.ENV == "production":
            if not self.QDRANT_API_KEY:
                raise ValueError("QDRANT_API_KEY is required in production")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Cached settings factory.

    Using lru_cache means Settings() is only parsed once per process lifetime.
    In tests, call get_settings.cache_clear() before monkeypatching env vars.
    """
    return Settings()