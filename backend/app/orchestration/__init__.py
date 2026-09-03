"""Orchestration subsystem — end-to-end workflow control (GOVERNANCE owner).

Facade re-exports so callers/tests keep using `app.orchestration.run_rag`,
`answer_chain`, and the `RAGOrchestrationResult` dataclass. Implementation is
split across orchestrator.py (workflow), stages.py (steps), policies.py
(execution policies) and graph.py (LangGraph/HITL variant).
"""
from app.classifier import classify_domain
from app.orchestration.orchestrator import (
    RAGOrchestrationResult,
    answer_chain,
    run_rag,
    stream_answer_orchestrated,
)

__all__ = [
    "RAGOrchestrationResult",
    "answer_chain",
    "classify_domain",
    "run_rag",
    "stream_answer_orchestrated",
]
