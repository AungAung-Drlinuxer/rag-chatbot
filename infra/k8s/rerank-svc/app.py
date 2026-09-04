"""rerank-svc — standalone cross-encoder reranking service.

Serves BAAI/bge-reranker-base (torch CrossEncoder, CPU) over one endpoint:

    POST /v1/rerank
      { "query": "...", "documents": ["c1", "c2", ...], "top_k": 8 }
      → { "results": [ { "index": 3, "relevance_score": 6.21 }, ... ] }  (desc order)
      → { "model": "BAAI/bge-reranker-base", "took_ms": 214 }

Design rules:
- Pure scorer. NO business logic here: title-boost heuristics, confidence-gate
  blending and fallback ordering all stay in the backend (app/rerank.py).
  The service only answers "how relevant is doc i to this query" with logits.
- The model is baked into the image at build time (HF_HUB_OFFLINE=1 at runtime)
  so a pod never downloads anything — required for the air-gapped cluster.
- readiness only flips green after the model is resident in RAM.
"""
from __future__ import annotations

import logging
import os
import threading
import time

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MODEL_NAME = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-base")
MAX_DOCS = int(os.environ.get("RERANK_MAX_DOCS", "32"))
MAX_CHARS = int(os.environ.get("RERANK_MAX_CHARS", "2000"))
API_KEY = os.environ.get("RERANK_API_KEY", "")  # optional in-cluster auth

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("rerank-svc")

app = FastAPI(title="rerank-svc", version="1.0.0")

_lock = threading.Lock()
_model = None          # CrossEncoder singleton
_ready = False         # readiness flag


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from sentence_transformers import CrossEncoder

                t0 = time.perf_counter()
                logger.info("loading %s (cpu, offline cache)", MODEL_NAME)
                _model = CrossEncoder(MODEL_NAME, device="cpu", max_length=512)
                logger.info("model resident in %.1fs", time.perf_counter() - t0)
    return _model


@app.on_event("startup")
def _warm() -> None:
    """Eager-load the baked model and run one dummy pair so first real
    request doesn't pay the lazy-import cost."""
    global _ready
    try:
        m = _get_model()
        m.predict([["warmup query", "warmup document"]], show_progress_bar=False)
        _ready = True
    except Exception as exc:  # stay not-ready → k8s kills/restarts the pod
        logger.error("model warmup failed: %s: %s", type(exc).__name__, exc)


@app.get("/health")
def health() -> dict:
    return {"ok": _ready, "model": MODEL_NAME}


class RerankRequest(BaseModel):
    query: str
    documents: list[str] = Field(default_factory=list)
    top_k: int | None = None


class RerankHit(BaseModel):
    index: int
    relevance_score: float


class RerankResponse(BaseModel):
    results: list[RerankHit]
    model: str
    took_ms: int


@app.post("/v1/rerank")
def rerank(req: RerankRequest, x_api_key: str | None = Header(default=None)) -> RerankResponse:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="bad api key")
    if not _ready:
        raise HTTPException(status_code=503, detail="model not loaded")
    if not req.query or not req.documents:
        return RerankResponse(results=[], model=MODEL_NAME, took_ms=0)
    if len(req.documents) > MAX_DOCS:
        raise HTTPException(status_code=413, detail=f"too many documents (max {MAX_DOCS})")

    docs = [(d or "")[:MAX_CHARS] for d in req.documents]
    pairs = [[req.query, d] for d in docs]
    t0 = time.perf_counter()
    try:
        scores = _get_model().predict(pairs, show_progress_bar=False)
    except Exception as exc:
        logger.exception("inference failed")
        raise HTTPException(status_code=500, detail=f"inference error: {type(exc).__name__}")

    hits = sorted(
        (RerankHit(index=i, relevance_score=round(float(s), 5)) for i, s in enumerate(scores)),
        key=lambda h: h.relevance_score,
        reverse=True,
    )
    if req.top_k:
        hits = hits[: req.top_k]
    took = int((time.perf_counter() - t0) * 1000)
    logger.info("rerank docs=%d took=%dms", len(docs), took)
    return RerankResponse(results=hits, model=MODEL_NAME, took_ms=took)
