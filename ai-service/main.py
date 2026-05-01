"""
Codebrief AI Service — FastAPI application entry point

Sprint 1: Stub implementation — health check only.
Sprint 2: Full AI pipeline (indexing, review, documentation, RAG chat).
"""

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
import os

app = FastAPI(
    title="Codebrief AI Service",
    description="RAG pipeline, code review, and documentation generation",
    version="0.1.0",
)

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")


def verify_internal_key(x_internal_key: str = Header(...)):
    """All endpoints require the internal API key set in NestJS → FastAPI calls."""
    if x_internal_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid internal API key")


# ─── Health ───────────────────────────────────────────────────

@app.get("/health", tags=["health"])
async def health():
    """Health check — used by Docker and ECS."""
    return {"status": "ok", "service": "codebrief-ai"}


@app.get("/ready", tags=["health"])
async def ready():
    """Readiness check — verifies downstream connections."""
    checks = {}

    # Qdrant check
    try:
        from qdrant_client import QdrantClient
        client = QdrantClient(
            host=os.getenv("QDRANT_HOST", "qdrant"),
            port=int(os.getenv("QDRANT_PORT", "6333")),
            api_key=os.getenv("QDRANT_API_KEY"),
        )
        client.get_collections()
        checks["qdrant"] = "ok"
    except Exception as e:
        checks["qdrant"] = f"error: {str(e)}"

    all_ok = all(v == "ok" for v in checks.values())
    return {"status": "ready" if all_ok else "degraded", "checks": checks}


# ─── Stub endpoints (wired up in Sprint 2) ────────────────────

class IndexRepoRequest(BaseModel):
    repository_id: str
    repo_full_name: str
    clone_url: str
    installation_token: str
    default_branch: str = "main"


@app.post("/index", tags=["indexing"])
async def index_repository(body: IndexRepoRequest, x_internal_key: str = Header(...)):
    verify_internal_key(x_internal_key)
    # Sprint 2: implement IndexingService here
    return {"status": "stub", "message": "Indexing service not yet implemented"}


class ReviewRequest(BaseModel):
    repository_id: str
    pr_number: int
    head_sha: str
    diff: str
    pr_title: str
    pr_description: str | None = None
    author_login: str


@app.post("/review", tags=["review"])
async def review_pull_request(body: ReviewRequest, x_internal_key: str = Header(...)):
    verify_internal_key(x_internal_key)
    # Sprint 2: implement ReviewService here
    return {"status": "stub", "message": "Review service not yet implemented"}


class DocUpdateRequest(BaseModel):
    repository_id: str
    pr_number: int
    merge_sha: str
    diff: str


@app.post("/documentation/update", tags=["documentation"])
async def update_documentation(body: DocUpdateRequest, x_internal_key: str = Header(...)):
    verify_internal_key(x_internal_key)
    # Sprint 2: implement DocumentationService here
    return {"status": "stub", "message": "Documentation service not yet implemented"}


class ChatRequest(BaseModel):
    repository_id: str
    question: str
    conversation_history: list = []


@app.post("/chat", tags=["onboarding"])
async def onboarding_chat(body: ChatRequest, x_internal_key: str = Header(...)):
    verify_internal_key(x_internal_key)
    # Sprint 2: implement RAG chat here
    return {"status": "stub", "message": "Chat service not yet implemented"}