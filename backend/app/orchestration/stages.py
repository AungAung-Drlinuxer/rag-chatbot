"""Pipeline stages — one small, independently testable step per function.

Each stage delegates to the owning subsystem (GOVERNANCE Rule 2: stages never
call each other; only the orchestrator composes them).
"""
from __future__ import annotations

from app.llm import make_chain, stream_answer
from app.rag import build_context, retrieve
from app.rag.gate import decide, gate_confidence
from app.rag.rewriter import rewrite_query


# --- Stage 1: Query Rewrite ------------------------------------------------
def query_rewrite(query: str, history: list[dict] | None = None) -> str:
    """Rewrite the user turn into a self-contained search query (LLM-driven in Phase 2)."""
    return rewrite_query(query, history)


# --- Stage 2: Retriever (Vector Search) ------------------------------------
def retrieve_stage(rewritten: str, domain: str, k: int | None = None) -> list[dict]:
    try:
        return retrieve(rewritten, domain=domain, k=k)
    except Exception:  # retrieval must never break the stream (fail-safe)
        return []


# --- Stage 3: Context Assembly ---------------------------------------------
def context_assembly(docs: list[dict], rewritten: str) -> str:
    return build_context(docs, rewritten) if docs else ""


# --- Stage 4: Confidence Gate ----------------------------------------------
def gate_stage(docs: list[dict]) -> tuple[float, str]:
    if not docs:
        return 0.0, "caution"
    # rerank-aware: cross-encoder sigmoid blended w/ vector distance (varies per query).
    confidence = gate_confidence(docs[0])
    return confidence, decide(confidence)


# --- Stage 5: LLM Invocation (LCEL prompt -> model -> parser) ---------------
def answer_chain():
    """Return the LCEL chain (prompt | llm | StrOutputParser) used for generation."""
    return make_chain()


def stream_answer_stage(question: str, context: str):
    yield from stream_answer(question, context)
