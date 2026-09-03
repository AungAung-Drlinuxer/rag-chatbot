"""Escalation / Jira-ticket persistence (owned by persistence/)."""
from __future__ import annotations

from app.core.config import SETTINGS
from app.persistence.database import SessionLocal
from app.persistence.models import JiraTicket


def create(*, session_id: str | None, jira_key: str | None, domain: str | None,
           status: str, created_by: str) -> None:
    """Log an escalation (best-effort persistence lives with the caller)."""
    with SessionLocal() as s:
        s.add(JiraTicket(session_id=session_id, jira_key=jira_key, domain=domain,
                         status=status, created_by=created_by))
        s.commit()


def list_for_user(username: str, limit: int = 50) -> list[dict]:
    """The user's escalation tickets, newest first, with browsable links."""
    with SessionLocal() as s:
        rows = (
            s.query(JiraTicket)
            .filter(JiraTicket.created_by == username)
            .order_by(JiraTicket.created_at.desc())
            .limit(limit)
            .all()
        )
    base = SETTINGS.jira_base_url.rstrip("/") if SETTINGS.jira_base_url else ""
    return [
        {
            "id": t.id,
            "jira_key": t.jira_key,
            "domain": t.domain,
            "status": t.status,
            "created_at": t.created_at.isoformat(),
            "link": f"{base}/browse/{t.jira_key}" if (base and t.jira_key) else None,
            "session_id": str(t.session_id) if t.session_id else None,
        }
        for t in rows
    ]
