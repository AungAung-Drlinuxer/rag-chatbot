"""Tests for the top_k override in RAGOrchestrationResult (Phase 10.1)."""
from app.core import runtime
from app.core.config import SETTINGS
from app.orchestration import orchestrator


def _fake_runtime_get(key):
    # No DB override → fall back to the env/SETTINGS default the test patches.
    return getattr(SETTINGS, key)


def test_run_rag_uses_default_top_k(monkeypatch):
    """If top_k is None, fall back to SETTINGS.retrieval_top_k and echo it on the result."""
    monkeypatch.setattr(SETTINGS, "retrieval_top_k", 7)
    monkeypatch.setattr(runtime, "get", _fake_runtime_get)
    # Force the retriever to return [] (no real DB needed) and to NOT raise.
    monkeypatch.setattr(orchestrator, "_retrieve", lambda q, d, k=None: [])
    res = orchestrator.run_rag("hello")
    assert res.top_k == 7
    assert res.context_tokens_estimate >= 0


def test_run_rag_respects_top_k_override(monkeypatch):
    """Per-call top_k should override the global default."""
    monkeypatch.setattr(SETTINGS, "retrieval_top_k", 3)
    monkeypatch.setattr(runtime, "get", _fake_runtime_get)
    seen_k = {}

    def fake_retrieve(rewritten, domain, k=None):
        seen_k["k"] = k
        return []

    monkeypatch.setattr(orchestrator, "_retrieve", fake_retrieve)
    res = orchestrator.run_rag("hello", top_k=11)
    assert seen_k["k"] == 11
    assert res.top_k == 11
