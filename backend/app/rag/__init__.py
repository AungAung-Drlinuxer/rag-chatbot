"""RAG package — information retrieval: hybrid search, rerank, gate, rewrite.

Public surface re-exported here (GOVERNANCE: retrieval subsystem internals stay
private; only these names are used across module boundaries):
retrieve/build_context (retrieval), add_texts/get_embeddings/get_vectorstore
(embeddings), rerank (reranker), rewrite_query (rewriter), decide/gate_confidence
(gate).
"""
from app.rag.embeddings import (
    COLLECTION_NAME,
    add_texts,
    get_embeddings,
    get_vectorstore,
)
from app.rag.gate import (
    DECISION_ANSWER,
    DECISION_CAUTION,
    caution_message,
    decide,
    gate_confidence,
    similarity_to_confidence,
)
from app.rag.models import RetrievalHit
from app.rag.reranker import rerank
from app.rag.retrieval import build_context, retrieve
from app.rag.rewriter import rewrite_query

__all__ = [
    "COLLECTION_NAME",
    "DECISION_ANSWER",
    "DECISION_CAUTION",
    "RetrievalHit",
    "add_texts",
    "build_context",
    "caution_message",
    "decide",
    "gate_confidence",
    "get_embeddings",
    "get_vectorstore",
    "rerank",
    "retrieve",
    "rewrite_query",
    "similarity_to_confidence",
]
