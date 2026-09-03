"""Execution policies — workflow decisions the orchestrator applies between stages.

Separated from `orchestrator.py` (composition) and `stages.py` (steps) so the
"what do we do given these results" rules are testable in isolation:

- Stage-2 domain fallback (weak classifier → trust top retrieved doc)
- Ticket-tool override (live DB answer is high-confidence by definition)
- Per-hit relevance source rows for the UI
"""
from __future__ import annotations

from app.rag.gate import DECISION_ANSWER, gate_confidence


def apply_domain_fallback(domain: str, domain_conf: float, docs: list[dict],
                          lockdown: str, stage1_threshold: float) -> str:
    """Weak Stage-1 keyword stage → trust the top retrieved doc's stored domain.

    (doc: ML zero-shot classifier would slot in here when conf < 0.7.)
    """
    if domain_conf < stage1_threshold and docs:
        top_domain = docs[0].get("domain")
        if top_domain and top_domain != lockdown:
            return top_domain
    return domain


def apply_ticket_override(context: str, ticket_ctx: str, confidence: float,
                          decision: str, docs: list[dict]):
    """A live ticket DB lookup is authoritative: prepend it as context, force a
    high-confidence "answer", and drop the KB docs so the UI doesn't mix
    ticket rows with KB hits. Returns (context, confidence, decision, docs)."""
    merged = ticket_ctx + "\n\n" + (context or "")
    return merged, 0.95, DECISION_ANSWER, []


def build_sources(docs: list[dict]) -> list[dict]:
    """v0.16.7 — per-hit relevance (rerank sigmoid blended with vector distance)
    so the UI shows real, varied percentages instead of a constant fallback."""
    return [
        {
            "page_id": d.get("page_id"),
            "title": d["title"],
            "confidence": d["confidence"],
            "source_url": d["source_url"],
            "relevance": gate_confidence(d),
        }
        for d in docs
    ]
