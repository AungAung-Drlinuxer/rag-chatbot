"""Ticket HTTP routes — escalation to Jira, escalation list, feedback."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import get_current_user, jira_route
from app.observability.audit import audit
from app.persistence.database import SessionLocal
from app.persistence.models import Feedback
from app.persistence.repositories import tickets
from app.schemas import EscalateRequest, FeedbackRequest

logger = logging.getLogger("it-help-chatbot")

router = APIRouter(tags=["tickets"])


@router.post("/api/escalate")
def escalate(req: EscalateRequest, user: str = Depends(get_current_user)) -> dict:
    """Phase 6 — create a Jira ticket AS the authenticated user (reporter=username)."""
    from app.integrations.jira import escalate as jira_escalate

    summary = (req.message or "IT help escalation").strip()[:120]
    transcript = "\n".join(
        f"{m.get('role')}: {m.get('content')}" for m in req.transcript if m.get("content")
    )
    description = (
        f"Domain: {req.domain or 'unknown'}\n"
        f"Confidence: {req.confidence}\n"
        f"Transcript:\n{transcript}"
    )
    try:
        route = jira_route(req.domain)
        result = jira_escalate(summary, description, reporter=user,
                               project=route.get("project") if isinstance(route, dict) else route,
                               assignee=route.get("assignee") if isinstance(route, dict) else None,
                               domain=req.domain)
    except Exception as exc:
        logger.exception("escalate failed")
        result = {"link": "", "mode": "error", "jira_key": None, "reporter": user,
                  "error": f"{type(exc).__name__}: {exc}"}
    audit("escalate", user, req.domain, req.confidence, detail=result.get("jira_key"))

    # Persist the escalation log (best-effort).
    try:
        tickets.create(session_id=req.session_id, jira_key=result.get("jira_key"),
                       domain=req.domain, status="created", created_by=user)
    except Exception as exc:
        logger.warning(f"persist jira ticket skipped ({type(exc).__name__}): {exc}")

    return result


@router.get("/api/escalations")
def list_escalations(user: str = Depends(get_current_user)) -> dict:
    """Phase 6 — list the current user's escalation (Jira) tickets, newest first."""
    try:
        return {"escalations": tickets.list_for_user(user)}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"escalations unavailable: {type(exc).__name__}")


@router.post("/api/feedback")
def feedback(req: FeedbackRequest, user: str = Depends(get_current_user)) -> dict:
    """Record Helpful / Not Helpful (design doc §7)."""
    with SessionLocal() as s:
        s.add(Feedback(message_id=req.message_id, rating=req.rating, comment=req.comment))
        s.commit()
    audit("feedback", user, detail=f"message_id={req.message_id} rating={req.rating}")
    return {"status": "ok", "saved": True, "rating": req.rating}
