"""
Pydantic schemas for embedding endpoints.

Separating models from routers means:
- Models are importable by tests without loading the full router
- The same schema can be shared across multiple routers
- Schema changes have one canonical location

All response models use explicit field definitions so the OpenAPI schema
is accurate and the Swagger UI shows real examples.
"""

from pydantic import BaseModel, Field


class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10_000)
    task_type: str = Field(
        default="RETRIEVAL_DOCUMENT",
        pattern="^(RETRIEVAL_DOCUMENT|RETRIEVAL_QUERY|SEMANTIC_SIMILARITY)$",
        description=(
            "RETRIEVAL_DOCUMENT for content to store, "
            "RETRIEVAL_QUERY for search queries. "
            "Using the wrong type degrades retrieval quality."
        ),
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "text": "async function processPayment(order: Order): Promise<Result>",
                "task_type": "RETRIEVAL_DOCUMENT",
            }
        }
    }


class EmbedResponse(BaseModel):
    embedding: list[float] = Field(..., description="768-dimensional vector")
    dimensions: int = Field(..., description="Should always be 768 for text-embedding-004")
    model: str
    task_type: str
    truncated: bool = Field(
        ...,
        description="True if input was truncated to 6000 chars before embedding",
    )
    original_length: int = Field(..., description="Character length of input before truncation")


class BatchEmbedRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=100)
    task_type: str = Field(
        default="RETRIEVAL_DOCUMENT",
        pattern="^(RETRIEVAL_DOCUMENT|RETRIEVAL_QUERY|SEMANTIC_SIMILARITY)$",
    )


class BatchEmbedResponse(BaseModel):
    embeddings: list[list[float]]
    count: int
    dimensions: int
    model: str
    task_type: str