"""RAG orchestrator — the single coordinator of the chat pipeline.

GOVERNANCE Rule 1: only this module composes the business workflow. Stages
(classify → rewrite → retrieve → context → gate → [tool]) are defined in
`stages.py`; execution policies (domain fallback, ticket-tool override) in
`policies.py`. Nothing here is reached by a sibling subsystem directly.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.classifier import LOCKDOWN, STAGE1_CONFIDENCE, classify_domain
from app.core.config import SETTINGS
from app.orchestration import policies, stages
from app.tools.jira import detect_ticket_intent, fetch_ticket_context


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


# Stage indirection (kept module-level so run_rag stays readable + patchable).
_query_rewrite = stages.query_rewrite
_retrieve = stages.retrieve_stage
_context = stages.context_assembly
_gate = stages.gate_stage


def answer_chain():
    """Return the LCEL chain (prompt | llm | StrOutputParser) used for generation."""
    return stages.answer_chain()


def stream_answer_orchestrated(question: str, context: str):
    yield from stages.stream_answer_stage(question, context)


def run_rag(query: str, history: list[dict] | None = None, top_k: int | None = None,
            user: str | None = None) -> RAGOrchestrationResult:
    """Execute the full RAG orchestration for one user turn.

    `top_k` (per-call) overrides any runtime override; runtime override overrides
    the env default. Lookup order: per-call arg → runtime_kv → SETTINGS.
    """
    from app.core.runtime import get as runtime_get

    domain, domain_conf = classify_domain(query)      # (classifier, outside diagram block)
    rewritten = _query_rewrite(query, history)         # 1. Query Rewrite
    if top_k is not None:
        used_top_k = int(top_k)
    else:
        used_top_k = int(runtime_get("retrieval_top_k"))
    docs = _retrieve(rewritten, domain, k=used_top_k)  # 2. Retriever (Vector Search)

    # Stage-2 fallback: weak keyword stage -> trust top retrieved doc's domain
    domain = policies.apply_domain_fallback(domain, domain_conf, docs, LOCKDOWN, STAGE1_CONFIDENCE)

    context = _context(docs, rewritten)                # 3. Context Assembly (truncates to window)

    confidence, decision = _gate(docs)                 # 4. Confidence Gate

    # Agentic tool hook (v0.18.0): if the question is about tickets, query the
    # live ticket DB (RBAC-scoped) and prepend it as authoritative context.
    ticket_source = False
    ticket_rows: list[dict] = []
    if user and detect_ticket_intent(query):
        ticket_ctx, ticket_rows = fetch_ticket_context(user, query)
        if ticket_ctx:
            context, confidence, decision, docs = policies.apply_ticket_override(
                context, ticket_ctx, confidence, decision, docs)
            ticket_source = True
    # v0.16.7 — per-hit relevance (rerank sigmoid blended with vector distance) so the UI
    # shows real, varied percentages instead of a constant fallback.
    sources = policies.build_sources(docs)
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
