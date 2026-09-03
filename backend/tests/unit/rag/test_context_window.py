"""Tests for context-window truncation in build_context (Phase 10.1).

build_context reads the window from runtime_get("max_context_tokens"), so the
tests patch app.core.runtime.get (no DB needed) and assert against the
v0.21.97 structured-briefing format.
"""
import pytest

from app import rag
from app.core import runtime
from app.core.config import SETTINGS


@pytest.fixture
def window(monkeypatch):
    def _set(tokens: int):
        monkeypatch.setattr(SETTINGS, "chars_per_token", 4)
        monkeypatch.setattr(runtime, "get", lambda key: {
            "max_context_tokens": tokens,
            "retrieval_top_k": 5,
            "confidence_gate_threshold": 0.75,
        }.get(key, 0))
    return _set


def test_build_context_truncates_to_window(window):
    """build_context should drop the tail of an oversized doc list and add a meta line."""
    window(300)  # ~1200-char budget: keeps some (not all) of the 8 oversized docs
    docs = [
        {"title": f"Doc {i}", "content": ("lorem ipsum " * 30), "domain": "system",
         "source_url": None}
        for i in range(8)
    ]
    out = rag.build_context(docs, "q?")
    assert out.startswith("=== KNOWLEDGE BASE CONTEXT")
    assert "User question: q?" in out
    # Must signal truncation at the tail
    assert "to fit context window" in out
    # Some docs kept, some dropped
    kept = out.count("--- KB Article [")
    assert 0 < kept < len(docs)


def test_build_context_empty_docs_returns_header_only(window):
    window(100)
    out = rag.build_context([], "q?")
    assert "User question: q?" in out
    assert "KB Article" not in out
    assert out.rstrip().endswith("=== END CONTEXT ===")


def test_build_context_small_fits_all(window):
    """Tiny inputs must NOT add a truncation meta line."""
    window(60000)
    docs = [{"title": "A", "content": "short", "domain": "system", "source_url": None}]
    out = rag.build_context(docs, "q")
    assert "to fit context window" not in out
    assert "Title: A" in out
    assert "Content:\nshort" in out
