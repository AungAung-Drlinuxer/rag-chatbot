"""Shared types for the RAG package."""
from __future__ import annotations

from typing import TypedDict


class RetrievalHit(TypedDict, total=False):
    """One retrieved KB chunk. Keys are produced by app.rag.retrieval:

    page_id/title/content/domain/source_url are always present; `distance`
    (cosine), `confidence` (1-distance), `rerank_score` (cross-encoder logit),
    `title_boost`/`final_score` (rerank blending) and the fusion rank hints
    (`vec_rank`/`kw_rank`/`rrf`) appear along the pipeline stages.
    """

    page_id: str | None
    title: str
    content: str
    domain: str | None
    source_url: str | None
    distance: float
    confidence: float
    rerank_score: float
    title_boost: float
    final_score: float
    vec_rank: int
    kw_rank: int
