from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import status as http_status
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.deps import get_current_user
from app.auth.rbac import get_role, require_role, require_cap
from app.config import SETTINGS
from app.persistence.database import SessionLocal, engine

logger = logging.getLogger("dashboard")

router = APIRouter(prefix="/api")

class TicketCreate(BaseModel):
    """v1.6.3 — schema drift fix: the UI sends `subject` (+ optional due_date) but this
    model only declared `summary`, so every create returned 422 'Field required' and the
    Create-ticket button silently failed. Accept both; `subject` wins."""
    subject: str | None = None
    summary: str | None = None  # legacy alias, kept for backwards compatibility
    description: str = ""
    priority: str = "medium"
    domain: str = "general"
    assignee: str | None = None
    due_date: str | None = None

    def effective_subject(self) -> str:
        return (self.subject or self.summary or "").strip()

class CommentRequest(BaseModel):
    body: str

class TicketUpdateRequest(BaseModel):
    status: str | None = None
    assignee: str | None = None
    priority: str | None = None

class AttachmentRequest(BaseModel):
    filename: str
    content_type: str
    data_base64: str


@router.get("/domains")
def list_active_domains(user: str = Depends(get_current_user)) -> dict:
    """v1.6.3 — active classifier domains for ticket category dropdowns.

    Previously the Category select in both the chat ticket dialog and the Tickets
    page used a HARDCODED 7-item list, so a domain created by a knowledge manager
    never appeared. This endpoint is readable by any authenticated user (unlike
    /api/admin/domains which requires manage_domains)."""
    from app.persistence.models import ClassifierDomain
    with SessionLocal() as s:
        rows = (s.query(ClassifierDomain)
                .filter(ClassifierDomain.is_active.is_(True))
                .order_by(ClassifierDomain.display_name.asc())
                .all())
        return {"domains": [
            {"key": d.domain_key, "label": d.display_name, "color": d.color or "blue"}
            for d in rows
        ]}


def _domain_labels() -> dict[str, str]:
    """v1.6.3 — domain_key → display_name for pretty category labels."""
    try:
        from app.persistence.models import ClassifierDomain
        with SessionLocal() as s:
            return {d.domain_key: d.display_name for d in s.query(ClassifierDomain).all()}
    except Exception:
        return {}


def _db() -> Any:
    return SessionLocal()

def _rows(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query and return list[dict]."""
    with engine.begin() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(m) for m in result.mappings()]


_jira_status_cache: dict[str, tuple[float, str]] = {}  # jira_key -> (ts, mapped_local_status)
_JIRA_SYNC_TTL = 60  # seconds

def _map_jira_status(name: str) -> str | None:
    s = (name or "").lower()
    if any(w in s for w in ("open", "to do", "backlog", "reopened", "re-open")):
        return "open"
    if any(w in s for w in ("progress", "pending", "waiting")):
        return "pending"
    if any(w in s for w in ("done", "resolved", "complete")):
        return "resolved"
    if "clos" in s:
        return "closed"
    return None

@router.get("/tickets")
def list_tickets(
    user: str = Depends(get_current_user),
    limit: int = 50,
) -> dict:
    role = get_role(user)
    limit = max(1, min(limit, 200))
    privileged = role in ("admin", "agent")

    sql = (
        "SELECT id, jira_key, session_id, domain, status, created_by, created_at, "
        "subject, description, priority, assignee, due_date "
        "FROM jira_tickets "
        + ("WHERE created_by = :user " if not privileged else "")
        + "ORDER BY created_at DESC LIMIT :limit"
    )
    params: dict = {"limit": limit}
    if not privileged:
        params["user"] = user

    rows = _rows(sql, params)

    # v0.21.4 — Jira status sync-on-read (60s TTL per ticket): the board shows
    # fresh status after changes made directly in Jira (reopen, done, etc.).
    now = time.time()
    for r in rows:
        jk = r.get("jira_key")
        if not jk:
            continue
        # v1.1.0 — OpenProject work packages: status already synced at pull time;
        # Jira-only live sync path below.
        if jk.startswith("op-"):
            continue
        cached = _jira_status_cache.get(jk)
        if cached and (now_cached := cached[0]) and (time.time() - now_cached) < _JIRA_SYNC_TTL:
            r["status"] = cached[1]
            continue
        from app.integrations.jira import fetch_issue_status

        live = fetch_issue_status(jk)
        mapped = _map_jira_status(live.get("status") if live.get("ok") else None)
        if mapped:
            r["status"] = mapped
            # look up internal DB id by jira_key (r["id"] may be missing/None on this row shape)
            with SessionLocal() as s:
                row = s.execute(text("SELECT id FROM jira_tickets WHERE jira_key = :k"),
                                {"k": jk}).first()
                if row and row[0] is not None:
                    s.execute(text("UPDATE jira_tickets SET status=:s WHERE id=:i"),
                              {"s": mapped, "i": row[0]})
                    s.commit()
        _jira_status_cache[jk] = (time.time(), mapped or (r.get("status") or ""))

    _labels = _domain_labels()  # v1.6.3 — pretty category labels
    out = []
    for r in rows:
        out.append(
            {
                "id": r.get("jira_key") or f"IT-{r['id']}",
                "subject": r.get("subject") or ((r.get("domain") or "general") + " escalation"),
                "description": r.get("description"),
                "status": ({"created": "open"}.get(r.get("status") or "", r.get("status") or "open")),
                "priority": (r.get("priority") or "medium"),
                # v1.6.3 — pretty category label from the classifier registry
                "category": _labels.get(
                    (r.get("domain") or "general").lower(),
                    (r.get("domain") or "general").replace("_", " ").capitalize(),
                ),
                "requester": r.get("created_by") or "unknown",
                "assignee": r.get("assignee"),
                "due_date": r["due_date"].isoformat() if r.get("due_date") else None,
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
                "updated_at": r["created_at"].isoformat() if r.get("created_at") else None,
            }
        )
    return {"tickets": out, "scope": "all" if privileged else "own"}


_require_create_tickets = require_cap("create_tickets")


@router.post("/tickets", status_code=http_status.HTTP_201_CREATED)
def create_ticket(
    req: TicketCreate,
    user: str = Depends(_require_create_tickets),
) -> dict:
    """Manual ticket creation — gated by the admin RBAC matrix (v0.21.57).
    Users escalate via chat."""
    with SessionLocal() as s:
        # v0.17.0 — create in Jira FIRST (real key), then persist. If Jira is not
        # configured the ticket still saves locally with jira_key=None.
        from app.integrations.jira import escalate as jira_escalate
        from app.persistence.models import JiraTicket

        subj = req.effective_subject()
        if not subj:
            raise HTTPException(status_code=400, detail="Ticket subject is required")
        summary = subj[:120]
        jira_result = jira_escalate(
            summary=summary,
            description=req.description,
            reporter=user,
            project=None,  # jira_route(domain) decides inside escalate
            assignee=req.assignee or None,  # v0.21.98 — honor chosen assignee in Jira
            domain=req.domain,
        )
        jira_key = jira_result.get("jira_key")

        from datetime import datetime as _dt

        row = JiraTicket(
            jira_key=jira_key,
            domain=req.domain[:64],
            status="open",
            created_by=user,
            subject=subj[:200],
            description=req.description,
            priority=req.priority[:16],
            assignee=(req.assignee or None),
            due_date=(_dt.fromisoformat(req.due_date) if req.due_date else None),
        )
        s.add(row)
        s.commit()
        s.refresh(row)
        # v0.21.92 — alert the requester their ticket is open
        try:
            from app.notifier import notify_ticket_created
            notify_ticket_created(user, jira_key, subj[:120])
        except Exception:  # noqa: BLE001
            pass
        return {
            "id": jira_key or f"IT-{row.id}",
            "jira_mode": jira_result.get("mode"),
            "jira_link": jira_result.get("link"),
            "subject": subj[:120],
            "description": req.description,
            "status": "open",
            "priority": req.priority,
            "category": _domain_labels().get(
                req.domain.lower(), req.domain.replace("_", " ").capitalize()
            ),
            "requester": user,
            "assignee": row.assignee,
            "due_date": row.due_date.isoformat() if row.due_date else None,
        }


# ---------------------------------------------------------------------------
# v0.20.0 — ticket comments + field updates (native-Jira-style detail drawer)
# ---------------------------------------------------------------------------

def _resolve_ticket(ticket_ref: str, user: str):
    """Map 'ITHD-2' or 'IT-7' to the jira_tickets row (RBAC-checked)."""
    from app.persistence.models import JiraTicket

    with SessionLocal() as s:
        if ticket_ref.startswith("ITHD-"):
            row = s.query(JiraTicket).filter(JiraTicket.jira_key == ticket_ref).first()
        else:
            try:
                tid = int(ticket_ref.replace("IT-", ""))
            except ValueError:
                return None
            row = s.get(JiraTicket, tid)
        if row is None:
            return None
        role = get_role(user)
        if role not in ("admin", "agent") and (row.created_by or "") != user:
            return None
        return row


def _sync_jira_status(row):
    """Pull live status from Jira into the local row (v0.20.7 — Jira wins on status).
    Called when a user opens a ticket so they always see the current state."""
    if not row.jira_key:
        return None
    from app.integrations.jira import fetch_issue_status

    live = fetch_issue_status(row.jira_key)
    if not live.get("ok"):
        return None
    jira_status = (live.get("status") or "").strip().lower()
    if not jira_status:
        return None
    # map Jira status name → local vocabulary
    local = ("open" if any(w in jira_status for w in ("open", "to do", "backlog", "reopened", "re-open"))
             else "pending" if any(w in jira_status for w in ("progress", "pending", "waiting"))
             else "resolved" if any(w in jira_status for w in ("done", "resolved", "complete"))
             else "closed" if "clos" in jira_status else None)
    if local and row.status != local:
        old = row.status
        row.status = local
        with SessionLocal() as s:
            s.add(row)
            s.refresh(row)
            s.commit()
            from app.persistence.models import TicketComment

            s.add(TicketComment(ticket_id=row.id, author="Jira",
                                body=f"status synced from Jira: {old} → {local} "
                                     f"(Jira status: {jira_status})", kind="status"))
            s.commit()
        # v0.21.92 — alert the requester about the status transition
        try:
            from app.notifier import notify_ticket_status
            notify_ticket_status(row.created_by, row.jira_key, old, local)
        except Exception:  # noqa: BLE001
            pass
        return local
    return None


@router.get("/tickets/{ticket_ref}/comments")
def ticket_comments(ticket_ref: str, user: str = Depends(get_current_user)) -> dict:
    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    synced = _sync_jira_status(row)  # v0.20.7 — Jira is source of truth for status
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(
            _t("SELECT id, author, body, kind, created_at FROM ticket_comments "
               "WHERE ticket_id = :tid ORDER BY created_at ASC"),
            {"tid": row.id},
        ).mappings().all()
    return {"comments": [
        {"id": r["id"], "author": r["author"], "body": r["body"],
         "kind": r["kind"],
         "created_at": r["created_at"].isoformat() if r["created_at"] else None}
        for r in rows
    ], "synced_status": synced}


class CommentRequest(BaseModel):
    body: str


@router.post("/tickets/{ticket_ref}/comments")
def ticket_comment_add(ticket_ref: str, req: CommentRequest,
                       user: str = Depends(get_current_user)) -> dict:
    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    with SessionLocal() as s:
        from app.persistence.models import TicketComment

        c = TicketComment(ticket_id=row.id, author=user, body=req.body[:4000], kind="comment")
        s.add(c)
        s.commit()
        return {"id": c.id, "author": user, "body": c.body, "kind": "comment",
                "created_at": c.created_at.isoformat() if c.created_at else None}


class TicketUpdateRequest(BaseModel):
    status: str | None = None
    assignee: str | None = None
    due_date: str | None = None  # ISO date
    subject: str | None = None
    description: str | None = None


@router.put("/tickets/{ticket_ref}")
def ticket_update(ticket_ref: str, req: TicketUpdateRequest,
                  user: str = Depends(get_current_user),
                  _role: str = Depends(require_role("admin", "agent"))) -> dict:
    # v0.22.00 — BUGFIX: `user` previously got require_role's return value (the ROLE
    # string "admin"), so _resolve_ticket checked ownership against "admin" and every
    # agent/admin status edit 404'd. Identity and authorization are separate deps now.
    row = _resolve_ticket(ticket_ref, user)
    logger.info("ticket_update ref=%s user=%s resolved=%s", ticket_ref, user, row is not None)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    changes: list[str] = []
    with SessionLocal() as s:
        s.add(row)
        s.refresh(row)
        if req.status:
            row.status = req.status[:32].lower()
            changes.append(f"status → {row.status}")
        if req.assignee is not None:
            row.assignee = req.assignee[:64] or None
            changes.append(f"assignee → {row.assignee or 'Unassigned'}")
        if req.due_date is not None:
            from datetime import datetime as _dt
            row.due_date = _dt.fromisoformat(req.due_date) if req.due_date else None
            changes.append(f"due date → {req.due_date or 'none'}")
        if req.subject:
            row.subject = req.subject[:200]
            changes.append("subject edited")
        if req.description is not None:
            row.description = req.description
            changes.append("description edited")
        s.commit()

        from app.persistence.models import TicketComment

        # v0.20.5 — push status change into Jira (best-effort; local stays authoritative)
        jira_note = ""
        if req.status and row.jira_key:
            from app.integrations.jira import transition_issue

            tr = transition_issue(row.jira_key, req.status)
            if tr.get("ok"):
                jira_note = " · synced to Jira"
            else:
                jira_note = f" · Jira sync failed ({tr.get('detail')})"
                logger.warning("jira transition failed for %s: %s", row.jira_key, tr.get("detail"))

        if changes or jira_note:
            body = "; ".join(changes) + jira_note if changes else f"Jira sync: {jira_note.strip(' .')}"
            s.add(TicketComment(ticket_id=row.id, author=user,
                                body=body, kind="status"))
            s.commit()
    return {"ok": True, "changes": changes, "jira_synced": jira_note.endswith("synced to Jira")}



@router.get("/tickets/{ticket_ref}/attachments")
def ticket_attachments(ticket_ref: str, user: str = Depends(get_current_user)) -> dict:
    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(
            _t("SELECT id, filename, content_type, size_bytes, created_by, created_at "
               "FROM ticket_attachments WHERE ticket_id = :tid ORDER BY created_at"),
            {"tid": row.id}).mappings().all()
    return {"attachments": [
        {"id": r["id"], "filename": r["filename"], "content_type": r["content_type"],
         "size": r["size_bytes"], "created_by": r["created_by"],
         "created_at": r["created_at"].isoformat() if r["created_at"] else None}
        for r in rows
    ]}


@router.post("/tickets/{ticket_ref}/attachments")
def ticket_attachment_add(ticket_ref: str, req: AttachmentRequest,
                          user: str = Depends(get_current_user)) -> dict:
    import base64 as _b64

    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    try:
        blob = _b64.b64decode(req.data_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid base64 payload")
    if len(blob) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="attachment exceeds 5 MB")
    with SessionLocal() as s:
        from app.persistence.models import TicketAttachment

        a = TicketAttachment(ticket_id=row.id, filename=req.filename[:255],
                             content_type=req.content_type[:128], data=blob,
                             size_bytes=len(blob), created_by=user)
        s.add(a)
        s.commit()
        return {"id": a.id, "filename": a.filename, "size": a.size_bytes}


@router.get("/tickets/{ticket_ref}/attachments/{att_id}/download")
def ticket_attachment_download(ticket_ref: str, att_id: int,
                               user: str = Depends(get_current_user)):
    from fastapi import Response

    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    with SessionLocal() as s:
        from app.persistence.models import TicketAttachment

        a = s.get(TicketAttachment, att_id)
        if a is None or a.ticket_id != row.id:
            raise HTTPException(status_code=404, detail="attachment not found")
        return Response(
            content=a.data,
            media_type=a.content_type or "application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{a.filename}"'},
        )






# === v0.21.15 — User settings (per-user preferences persisted to DB) ===
# Uses the existing user_settings table (Phase 10.1 schema); we store the
# chatbot-specific preferences in a `prefs` JSONB column.


@router.post("/attachments")
async def upload_attachment(
    file: UploadFile = File(...),
    session_id: str = Form(""),
    user: str = Depends(get_current_user),
) -> dict:
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
    mime = file.content_type or "application/octet-stream"
    att_id = uuid4().hex
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        s.execute(_t(
            "INSERT INTO chat_attachments (id, session_id, username, filename, mime, size, data) "
            "VALUES (:id, :sid, :u, :fn, :mime, :sz, :data)"
        ), {"id": att_id, "sid": session_id, "u": user, "fn": file.filename,
            "mime": mime, "sz": len(data), "data": data})
        s.commit()
    return {"id": att_id, "filename": file.filename, "mime": mime, "size": len(data)}


@router.get("/attachments/{att_id}")
def get_attachment(att_id: str, user: str = Depends(get_current_user)):
    from fastapi.responses import Response
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t(
            "SELECT filename, mime, data FROM chat_attachments WHERE id = :id"
        ), {"id": att_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return Response(content=bytes(row[2]), media_type=row[1],
                    headers={"Content-Disposition": f'inline; filename="{row[0]}"'})


# === v1.1.0 — OpenProject work-package ticket sync ===========================
@router.post("/tickets/openproject/sync")
def openproject_sync(user: str = Depends(require_cap("manage_kb"))) -> dict:
    """Pull OpenProject work packages into jira_tickets (jira_key='op-<id>').

    Idempotent: existing op-* keys are updated in place; new ones inserted.
    Admin/agent-triggered from Settings -> Integrations -> OpenProject.
    """
    from app.integrations.openproject import fetch_work_packages

    tickets = fetch_work_packages()
    if not tickets:
        return {"ok": True, "created": 0, "updated": 0, "total": 0,
                "message": "No work packages returned — check OpenProject config"}

    created = updated = 0
    with SessionLocal() as s:
        for t in tickets:
            existing = s.execute(
                text("SELECT id FROM jira_tickets WHERE jira_key = :k"),
                {"k": t["ticket_id"]},
            ).first()
            if existing:
                s.execute(text(
                    "UPDATE jira_tickets SET status=:st, subject=:sj, description=:ds, "
                    "assignee=:asg WHERE jira_key=:k"
                ), {"st": t["status"], "sj": t["title"], "ds": t["body"],
                    "asg": t["assignee"], "k": t["ticket_id"]})
                updated += 1
            else:
                s.execute(text(
                    "INSERT INTO jira_tickets (jira_key, domain, status, created_by, "
                    "created_at, subject, description, priority, assignee) "
                    "VALUES (:k, :dm, :st, :cb, NOW(), :sj, :ds, :pr, :asg)"
                ), {"k": t["ticket_id"], "dm": "general", "st": t["status"],
                    "cb": "openproject-sync", "sj": t["title"], "ds": t["body"],
                    "pr": "medium", "asg": t["assignee"]})
                created += 1
        s.commit()
    return {"ok": True, "created": created, "updated": updated, "total": len(tickets)}


# === v0.21.14 — RBAC role/permission matrix (admin-editable) ===

