"""RAG Orchestration — LangChain + LCEL chains (mirrors the architecture diagram).

Diagram block "RAG Orchestration — LangChain + LCEL Chains":
    Query Rewrite → Retriever (Vector Search) → Context Assembly → Prompt Template → LLM Invocation

This module is the single entry point for the chat pipeline. It composes the LCEL
answer chain with the retrieval/context stages and produces a structured result.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.classifier.engine import LOCKDOWN, STAGE1_CONFIDENCE, classify_domain
from app.config import SETTINGS
from app.rag.gate import DECISION_ANSWER, decide, gate_confidence
from app.llm.client import make_chain, stream_answer
from app.rag.retrieval import build_context, retrieve
from app.rag.rewriter import rewrite_query
from app.tools.ticket_tool import detect_ticket_intent, fetch_ticket_context


@dataclass
class RAGOrchestrationResult:
    domain: str = "general"
    rewritten: str = ""
    docs: list[dict] = field(default_factory=list)
    confidence: float = 0.0
    decision: str = "caution"
    context: str = ""
    sources: list[dict] = field(default_factory=list)
    tool_used: str | None = None  # v0.18.0: which agentic tool answered (None = pure RAG)
    tool_rows: list[dict] = field(default_factory=list)  # structured rows from the tool
    # Telemetry for the LLM stage
    top_k: int = 0
    context_chars: int = 0
    context_tokens_estimate: int = 0
    context_truncated: bool = False


# --- Stage 1: Query Rewrite ------------------------------------------------
def _query_rewrite(query: str, history: list[dict] | None = None) -> str:
    """Rewrite the user turn into a self-contained search query (LLM-driven in Phase 2)."""
    return rewrite_query(query, history)


# --- Stage 2: Retriever (Vector Search) ------------------------------------
def _retrieve(rewritten: str, domain: str, k: int | None = None) -> list[dict]:
    try:
        return retrieve(rewritten, domain=domain, k=k)
    except Exception:  # retrieval must never break the stream (fail-safe)
        return []


# --- Stage 3: Context Assembly ---------------------------------------------
def _context(docs: list[dict], rewritten: str) -> str:
    return build_context(docs, rewritten) if docs else ""


# --- Stage 4: Confidence Gate ----------------------------------------------
def _gate(docs: list[dict]) -> tuple[float, str]:
    if not docs:
        return 0.0, "caution"
    # rerank-aware: cross-encoder sigmoid blended w/ vector distance (varies per query).
    confidence = gate_confidence(docs[0])
    return confidence, decide(confidence)


# --- Stage 5: LLM Invocation (LCEL prompt -> model -> parser) ---------------
def answer_chain():
    """Return the LCEL chain (prompt | llm | StrOutputParser) used for generation."""
    return make_chain()


def stream_answer_orchestrated(question: str, context: str):
    yield from stream_answer(question, context)


def run_rag(query: str, history: list[dict] | None = None, top_k: int | None = None,
            user: str | None = None) -> RAGOrchestrationResult:
    """Execute the full RAG orchestration for one user turn.

    `top_k` (per-call) overrides any runtime override; runtime override overrides
    the env default. Lookup order: per-call arg → runtime_kv → SETTINGS.
    """
    from app.runtime import get as runtime_get

    domain, domain_conf = classify_domain(query)      # (classifier, outside diagram block)
    rewritten = _query_rewrite(query, history)         # 1. Query Rewrite
    if top_k is not None:
        used_top_k = int(top_k)
    else:
        used_top_k = int(runtime_get("retrieval_top_k"))
    docs = _retrieve(rewritten, domain, k=used_top_k)  # 2. Retriever (Vector Search)

    # Stage-2 fallback: weak keyword stage -> trust top retrieved doc's domain
    if domain_conf < STAGE1_CONFIDENCE and docs:
        top_domain = docs[0].get("domain")
        if top_domain and top_domain != LOCKDOWN:
            domain = top_domain

    context = _context(docs, rewritten)                # 3. Context Assembly (truncates to window)

    confidence, decision = _gate(docs)                 # 4. Confidence Gate

    # Agentic tool hook (v0.18.0): if the question is about tickets, query the
    # live ticket DB (RBAC-scoped) and prepend it as authoritative context.
    ticket_source = False
    ticket_rows: list[dict] = []
    if user and detect_ticket_intent(query):
        ticket_ctx, ticket_rows = fetch_ticket_context(user, query)
        if ticket_ctx:
            context = ticket_ctx + "\n\n" + (context or "")
            ticket_source = True
            # a live DB lookup is high-confidence by definition — skip the gate
            confidence, decision = 0.95, DECISION_ANSWER
            # tool answered → drop KB docs/sources so UI doesn't mix ticket + KB
            docs = []
            sources = []
    # v0.16.7 — per-hit relevance (rerank sigmoid blended with vector distance) so the UI
    # shows real, varied percentages instead of a constant fallback.
    from app.rag.gate import gate_confidence
    sources = [
        {
            "page_id": d.get("page_id"),
            "title": d["title"],
            "confidence": d["confidence"],
            "source_url": d["source_url"],
            "relevance": gate_confidence(d),
        }
        for d in docs
    ]
    context_chars = len(context)
    context_tokens_estimate = context_chars // max(1, SETTINGS.chars_per_token)
    context_truncated = context.endswith("to fit context window]")
    return RAGOrchestrationResult(
        domain=domain, rewritten=rewritten, docs=docs, confidence=confidence,
        decision=decision, context=context, sources=sources,
        tool_used="tickets" if ticket_source else None,
        tool_rows=ticket_rows,
        top_k=used_top_k,
        context_chars=context_chars,
        context_tokens_estimate=context_tokens_estimate,
        context_truncated=context_truncated,
    )
