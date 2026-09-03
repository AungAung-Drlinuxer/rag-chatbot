"""Phase 10 — LLM fault-tolerance tests (never raise; primary → fallback → dev mock)."""
from app.llm import client as llm_mod
from app.config import SETTINGS


def test_stream_never_raises_on_primary_failure(monkeypatch):
    class _Boom:
        def stream(self, *a, **k):
            raise RuntimeError("hchat down")

    monkeypatch.setattr(llm, "make_chain", lambda: _Boom())
    monkeypatch.setattr(SETTINGS, "fallback_enabled", False)
    out = "".join(llm.stream_answer("q", "ctx"))
    assert "dev mock" in out  # degraded gracefully, never raised


def test_stream_dev_mock_when_no_key(monkeypatch):
    monkeypatch.setattr(SETTINGS, "hchat_api_key", "")
    monkeypatch.setattr(SETTINGS, "fallback_enabled", False)
    out = "".join(llm.stream_answer("q", "ctx"))
    assert "dev mock" in out


def test_stream_local_fallback_when_primary_absent(monkeypatch):
    monkeypatch.setattr(SETTINGS, "hchat_api_key", "")
    monkeypatch.setattr(SETTINGS, "fallback_enabled", True)
    monkeypatch.setattr(SETTINGS, "ollama_url", "http://localhost:1")  # unreachable → ollama errors
    # _build_local_ollama is lazy (construction ok), stream() will fail → falls to dev mock
    out = "".join(llm.stream_answer("q", "ctx"))
    assert "dev mock" in out
