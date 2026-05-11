"""
Unit tests for utils/token_counter.py.

These are pure unit tests — no mocking needed, no I/O, no async.
Token counting is synchronous math with no external dependencies.
"""

import pytest

from app.utils.token_counter import (
    estimate_tokens,
    estimate_tokens_for_chunks,
    format_chunks_for_prompt,
    trim_chunks_to_budget,
)


# ── estimate_tokens ────────────────────────────────────────────────────────────


def test_empty_string_is_zero_tokens():
    assert estimate_tokens("") == 0


def test_four_chars_is_one_token():
    assert estimate_tokens("abcd") == 1


def test_five_chars_rounds_up_to_two_tokens():
    """Ceiling division — 5 chars / 4 = 1.25 → rounds up to 2."""
    assert estimate_tokens("abcde") == 2


def test_typical_code_line():
    line = "async function processPayment(order: Order): Promise<Result> {"
    tokens = estimate_tokens(line)
    assert tokens > 0
    assert isinstance(tokens, int)


# ── trim_chunks_to_budget ──────────────────────────────────────────────────────


def make_chunk(content: str, score: float = 0.9) -> dict:
    """Helper — creates a plain dict chunk (not a Qdrant ScoredPoint)."""
    return {"content": content, "file_path": "test.py", "score": score}


def test_empty_chunks_returns_empty():
    result = trim_chunks_to_budget([], token_budget=1000)
    assert result == []


def test_single_chunk_under_budget_is_selected():
    chunks = [make_chunk("short content")]
    result = trim_chunks_to_budget(chunks, token_budget=1000)
    assert len(result) == 1


def test_single_chunk_over_budget_is_excluded():
    # Budget is 10 tokens (effective = 8 after safety factor)
    # Content is 100 chars = 25 tokens → exceeds budget
    chunks = [make_chunk("x" * 100)]
    result = trim_chunks_to_budget(chunks, token_budget=10)
    assert len(result) == 0


def test_multiple_chunks_respect_budget():
    """3 chunks each at ~250 tokens, budget=500 → first two fit, third excluded."""
    # 1000 chars ≈ 250 tokens each
    chunks = [make_chunk("a" * 1000), make_chunk("b" * 1000), make_chunk("c" * 1000)]
    # Budget 500 * 0.8 = 400 effective tokens → fits ~1.6 chunks → first chunk only
    result = trim_chunks_to_budget(chunks, token_budget=500)
    # At least one chunk selected, not all three
    assert 0 < len(result) < 3


def test_preserves_order():
    """Chunks are returned in the same order they were passed in."""
    chunks = [make_chunk(f"content {i}") for i in range(5)]
    result = trim_chunks_to_budget(chunks, token_budget=10000)
    contents = [c["content"] for c in result]
    for i, content in enumerate(contents):
        assert content == f"content {i}"


# ── format_chunks_for_prompt ───────────────────────────────────────────────────


def test_format_includes_file_path():
    chunk = {"content": "def hello(): pass", "file_path": "src/hello.py", "symbol_name": "hello"}
    result = format_chunks_for_prompt([chunk])
    assert "src/hello.py" in result


def test_format_includes_symbol_name():
    chunk = {"content": "def hello(): pass", "file_path": "src/hello.py", "symbol_name": "hello"}
    result = format_chunks_for_prompt([chunk])
    assert "hello" in result


def test_format_includes_content():
    chunk = {"content": "def hello(): pass", "file_path": "src/hello.py", "symbol_name": ""}
    result = format_chunks_for_prompt([chunk])
    assert "def hello(): pass" in result


def test_format_multiple_chunks_separated():
    chunks = [
        {"content": "chunk one", "file_path": "a.py", "symbol_name": ""},
        {"content": "chunk two", "file_path": "b.py", "symbol_name": ""},
    ]
    result = format_chunks_for_prompt(chunks)
    assert "chunk one" in result
    assert "chunk two" in result
    assert "---" in result  # separator between chunks


def test_format_empty_list():
    result = format_chunks_for_prompt([])
    assert result == ""
