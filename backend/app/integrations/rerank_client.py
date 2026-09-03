"""HTTP client for the standalone rerank-svc (Option A split).

Cluster-internal only: the URL is an in-cluster Service DNS
(http://rerank-svc:8080) — no external egress, air-gap safe.

Contract (see rerank-svc/app.py):
    POST /v1/rerank {query, documents[], top_k} → {results[{index, relevance_score}]}

Raises on any transport/error problem; app.rerank catches and falls back to
vector order so a degraded reranker never takes chat down.
"""
from __future__ import annotations

import logging

import httpx

from app.config import SETTINGS

logger = logging.getLogger("integrations.rerank")


def score(query: str, docs: list[dict]) -> list[float]:
    """Return a cross-encoder logit for every doc (same order as `docs`).

    `docs` items only need a "content" key; truncation mirrors the local path
    (first 2000 chars) so local and remote modes score identically.
    """
    payload = {
        "query": query,
        "documents": [(d.get("content") or "")[:2000] for d in docs],
    }
    headers = {"Content-Type": "application/json"}
    if SETTINGS.rerank_api_key:
        headers["X-API-Key"] = SETTINGS.rerank_api_key
    url = SETTINGS.rerank_url.rstrip("/") + "/v1/rerank"
    with httpx.Client(timeout=SETTINGS.rerank_timeout_s) as client:
        r = client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        body = r.json()

    scores = [0.0] * len(docs)
    for hit in body.get("results", []):
        idx = hit.get("index")
        if isinstance(idx, int) and 0 <= idx < len(docs):
            scores[idx] = float(hit.get("relevance_score", 0.0))
    logger.debug("remote rerank: %d docs in %sms", len(docs), body.get("took_ms"))
    return scores
