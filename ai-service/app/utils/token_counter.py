"""
Token counting utility for RAG context budget management.

Problem: Gemini has a context window limit. We retrieve 20 code chunks from
Qdrant but cannot blindly stuff all of them into the prompt — we would exceed
the limit and the API call would fail, or the model would perform poorly on
an overly long context.

Solution: Count tokens before building the prompt and trim context to fit
within a configurable budget. This runs entirely locally — no API call needed.

Design decisions:

1. Why not use tiktoken?
   tiktoken is calibrated for OpenAI models. Gemini uses a different tokenizer.
   For our purposes (staying within a ~3500-token budget with a comfortable margin),
   the approximation of 4 chars ≈ 1 token is accurate enough. We're not counting
   tokens for billing — we're counting them to avoid exceeding the context window.

2. Why a dedicated utility instead of inline math in the service?
   Because the same budget logic is needed in ReviewService (Task 7) and
   DocumentationService (Task 8). One utility, no duplication.

3. Conservative estimation
   We deliberately over-estimate (round up, add 20% buffer) so we never
   accidentally exceed the limit. Under-using context budget costs nothing.
   Over-using it causes a failed API call.

Usage:
    from app.utils.token_counter import estimate_tokens, trim_chunks_to_budget

    chunks = qdrant_results  # list of ScoredPoint
    budget = 3500
    selected = trim_chunks_to_budget(chunks, budget)
"""

from __future__ import annotations

# Gemini tokenizer approximation: ~4 characters per token for English/code
# This is intentionally conservative — we round up, not down
_CHARS_PER_TOKEN = 4

# Safety margin: we aim for 80% of stated budget to account for approximation error
# and for prompt overhead (system prompt, instructions, PR metadata)
_SAFETY_FACTOR = 0.80


def estimate_tokens(text: str) -> int:
    """
    Estimate the token count of a text string.

    Uses the 4-chars-per-token approximation, rounded up.
    Conservative — slightly over-estimates to prevent context overflow.
    """
    return -(-len(text) // _CHARS_PER_TOKEN)  # ceiling division without math.ceil


def estimate_tokens_for_chunks(chunks: list[dict]) -> list[int]:
    """
    Estimate token count for a list of chunk content strings.

    Args:
        chunks: list of dicts with at least a 'content' key

    Returns:
        list of token estimates in the same order as input
    """
    return [estimate_tokens(chunk.get("content", "")) for chunk in chunks]


def trim_chunks_to_budget(
    chunks: list,
    token_budget: int,
    content_key: str = "content",
) -> list:
    """
    Select chunks greedily until the token budget is exhausted.

    Assumes chunks are pre-sorted by relevance score (highest first),
    which is how Qdrant returns them. We take chunks in order until
    adding the next one would exceed the budget.

    Args:
        chunks: Qdrant ScoredPoint objects or dicts with payload
        token_budget: maximum tokens to allocate for context
        content_key: key to extract content from chunk payload

    Returns:
        Subset of chunks that fit within the budget, in relevance order.
    """
    effective_budget = int(token_budget * _SAFETY_FACTOR)
    selected = []
    used_tokens = 0

    for chunk in chunks:
        # Support both ScoredPoint (Qdrant client object) and plain dicts
        if hasattr(chunk, "payload"):
            content = chunk.payload.get(content_key, "")
        else:
            content = chunk.get(content_key, "")

        chunk_tokens = estimate_tokens(content)

        if used_tokens + chunk_tokens > effective_budget:
            # This chunk would exceed budget — skip it but continue checking
            # smaller chunks later in the list might still fit
            continue

        selected.append(chunk)
        used_tokens += chunk_tokens

    return selected


def format_chunks_for_prompt(chunks: list, content_key: str = "content") -> str:
    """
    Format retrieved chunks into the context block that goes into the prompt.

    Each chunk is prefixed with its file path and symbol name so the AI
    can cite specific sources in its findings.

    Args:
        chunks: Qdrant ScoredPoint objects or dicts with payload

    Returns:
        Formatted string ready to embed in the review prompt
    """
    parts = []

    for chunk in chunks:
        if hasattr(chunk, "payload"):
            payload = chunk.payload
        else:
            payload = chunk

        file_path = payload.get("file_path", "unknown")
        symbol_name = payload.get("symbol_name", "")
        content = payload.get(content_key, "")

        header = f"// {file_path}"
        if symbol_name:
            header += f" — {symbol_name}"

        parts.append(f"{header}\n{content}")

    return "\n\n---\n\n".join(parts)
