"""LLM provider abstraction — H-Chat primary → local Ollama fallback → dev mock.

Design doc: the LLM never searches; it only reads the RAG-assembled context.
`stream_answer` yields (token, usage) pairs and never raises (a down provider
degrades gracefully). `usage` is non-None only on the LAST pair (zero-length
sentinel) so the caller can read final token counts exactly once.

Chain construction lives in app.llm.providers; streaming/usage helpers in
app.llm.client. make_chain/stream_answer stay here because tests and callers
patch/call them at package level.
"""
from __future__ import annotations

import logging
from collections.abc import Iterable

from app.core.config import SETTINGS
from app.llm.client import (
    _extract_usage,
    extract_usage,
    stream_with_usage,
)
from app.llm.models import UsageDict
from app.llm.providers import hchat

logger = logging.getLogger("llm")

__all__ = [
    "UsageDict",
    "_extract_usage",
    "extract_usage",
    "make_chain",
    "make_llm",
    "stream_answer",
    "stream_with_usage",
]


def make_chain():
    """Return the primary (H-Chat) LCEL runnable, or None when no key is set."""
    if not SETTINGS.hchat_api_key:
        return None
    try:
        if hchat.primary_kind() == "openai":
            return hchat.build_openai()
        return hchat.build_anthropic()
    except Exception as exc:
        logger.warning(f"primary LLM build failed ({type(exc).__name__}): {exc}")
        return None


def make_llm():
    """Return the bare chat model (no prompt, no parser) for streaming callers that
    need to inspect `AIMessageChunk.usage_metadata` directly. Returns None when
    no key is set or build fails (same as `make_chain`)."""
    chain = make_chain()
    if chain is None:
        return None
    # The LCEL chain shape is `prompt | llm | parser` → llm is `steps[-2]`.
    steps = getattr(chain, "steps", None)
    if not steps or len(steps) < 2:
        return None
    return steps[-2]


def _bare_local_llm():
    fb = hchat.build_local_ollama()
    steps = getattr(fb, "steps", None)
    return steps[-2] if steps and len(steps) >= 2 else None


def stream_answer(question: str, context: str) -> Iterable[tuple[str, UsageDict]]:
    """Yield (token, usage). H-Chat → local Ollama → dev mock (Phase 10 fault tolerance)."""
    # 1) Primary — external H-Chat (stream the bare LLM so we can read usage_metadata)
    llm = make_llm()
    if llm is not None:
        for attempt in (1, 2):  # v0.18.5: one retry for transient provider errors (520/empty)
            try:
                yield from stream_with_usage(llm, question, context)
                return
            except Exception as exc:
                if attempt == 1:
                    logger.warning(f"H-Chat failed (attempt {attempt}: {type(exc).__name__}): {exc}; retrying")
                    continue
                logger.warning(f"H-Chat failed (attempt {attempt}: {type(exc).__name__}): {exc}; falling back to local model")

    # 2) Fallback — local Ollama (CPU, on-prem)
    if SETTINGS.fallback_enabled:
        try:
            local_llm = _bare_local_llm()
            if local_llm is not None:
                yield from stream_with_usage(local_llm, question, context)
                return
        except Exception as exc:
            logger.warning(f"local fallback failed ({type(exc).__name__}): {exc}; using dev mock")

    # 3) Last resort — dev mock (never raise; no usage metadata)
    from app.llm.prompts import DEV_MOCK_TOKENS

    for tok in DEV_MOCK_TOKENS:
        yield tok, None
