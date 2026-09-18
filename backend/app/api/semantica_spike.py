"""Semantica spike — read-only proxy to the `semantica-spike` service.

WHY A PROXY RATHER THAN LETTING THE UI CALL THE SERVICE
Three reasons, all of which the app already applies elsewhere: the browser should not need a
route to an internal ClusterIP service; the spike's JSON must pass through the same session
check as every other screen; and when the spike is removed, only this file and one page go
with it.

SCOPE
Read-only, admin-only. The service exposes a graph built from the knowledge base; nothing
here writes. The one mutation the spike has (rebuilding the graph) is deliberately not
exposed: it is a batch job, not a button, and putting it behind an HTTP call would invite
someone to run a 229-article extraction from a browser tab.
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import get_current_user
from app.auth.rbac import require_role

logger = logging.getLogger(__name__)

router = APIRouter()

# ClusterIP service from infra/k8s/semantica/10-deployment.yaml.
BASE = "http://semantica-spike:8000"
TIMEOUT = 12.0


def _get(path: str, **params) -> dict:
    """Fetch one endpoint from the spike service, with an honest failure message.

    A spike pod that is scaled to zero or still building is a normal state, not an error the
    user caused — so the response says which it is instead of surfacing a stack trace.
    """
    try:
        r = httpx.get(f"{BASE}{path}", params={k: v for k, v in params.items() if v not in (None, "")},
                      timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        logger.info("semantica spike unreachable: %s: %s", type(exc).__name__, exc)
        raise HTTPException(
            status_code=503,
            detail=("Semantica spike is not reachable. Either the pod is scaled to zero or it is "
                    "still building the graph from the knowledge base."),
        ) from exc
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=r.text[:300])
    try:
        return r.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Semantica spike returned non-JSON") from exc


@router.get("/api/semantica/stats")
def stats(user: str = Depends(get_current_user), role: str = Depends(require_role("admin"))) -> dict:
    """Counts, label breakdown, and the most-mentioned entities and relations."""
    return _get("/stats")


@router.get("/api/semantica/graph")
def graph(
    limit: int = Query(120, ge=5, le=400),
    user: str = Depends(get_current_user),
    role: str = Depends(require_role("admin")),
) -> dict:
    """A bounded neighbourhood: the top entities plus the edges between them.

    Bounded on purpose — the full graph would be thousands of nodes, and a viewer that tries
    to draw all of them shows a hairball rather than a structure.
    """
    return _get("/graph", limit=limit)


@router.get("/api/semantica/entities")
def entities(
    limit: int = Query(200, ge=1, le=1000),
    q: str = Query(""),
    user: str = Depends(get_current_user),
    role: str = Depends(require_role("admin")),
) -> list:
    """Entity list, optionally filtered by name. Includes mention counts."""
    return _get("/entities", limit=limit, q=q)


@router.get("/api/semantica/provenance")
def provenance(
    name: str = Query(..., min_length=1),
    user: str = Depends(get_current_user),
    role: str = Depends(require_role("admin")),
) -> list:
    """Which KB pages and URLs produced this entity.

    This is the claim worth testing: `audit_log` already records what the system decided, but
    nothing today can say which documents produced a given fact.
    """
    return _get("/provenance", name=name)


@router.get("/api/semantica/relation")
def relation(
    subject: str = Query(..., min_length=1),
    user: str = Depends(get_current_user),
    role: str = Depends(require_role("admin")),
) -> list:
    """Every edge touching this entity, in either direction.

    `-> list`, not `-> dict`: the service returns an array, and a `-> dict` annotation makes
    FastAPI fail response validation and answer 500 for a request that had already succeeded.
    """
    return _get("/relation", subject=subject)
