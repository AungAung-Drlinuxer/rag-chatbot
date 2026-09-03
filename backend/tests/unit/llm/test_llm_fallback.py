"""Phase 10 — LLM fault-tolerance tests (never raise; primary → fallback → dev mock).

`stream_answer` yields (token, usage) pairs; `usage` is non-None only on the
final zero-length sentinel.
"""
from app import llm
from app.core.config import SETTINGS


def _collect(stream) -> str:
    return "".join(tok for tok, _usage in stream)


def test_stream_never_raises_on_primary_failure(monkeypatch):
    class _Boom:
        def stream(self, *a, **k):
            raise RuntimeError("hchat down")

    monkeypatch.setattr(llm, "make_llm", lambda: _Boom())
    monkeypatch.setattr(SETTINGS, "fallback_enabled", False)
    out = _collect(llm.stream_answer("q", "ctx"))
    assert "dev mock" in out  # degraded gracefully, never raised


def test_stream_dev_mock_when_no_key(monkeypatch):
    monkeypatch.setattr(SETTINGS, "hchat_api_key", "")
    monkeypatch.setattr(SETTINGS, "fallback_enabled", False)
    out = _collect(llm.stream_answer("q", "ctx"))
    assert "dev mock" in out


def test_stream_local_fallback_when_primary_absent(monkeypatch):
    monkeypatch.setattr(SETTINGS, "hchat_api_key", "")
    monkeypatch.setattr(SETTINGS, "fallback_enabled", True)
    monkeypatch.setattr(SETTINGS, "ollama_url", "http://localhost:1")  # unreachable → ollama errors
    # local chain construction is lazy; stream() fails → falls through to dev mock
    out = _collect(llm.stream_answer("q", "ctx"))
    assert "dev mock" in out
