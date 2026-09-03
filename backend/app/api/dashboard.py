"""Dashboard + Tickets APIs (v0.12.0).

Dashboard aggregates (design: Dashboard.tsx data-flow plan):
- GET /api/dashboard/stats                  — KPI cards
- GET /api/dashboard/conversations?days=7   — line chart series
- GET /api/dashboard/domains                — top domains bars
- GET /api/dashboard/recent-conversations   — recent chat turns
- GET /api/dashboard/recent-tickets         — recent escalations
- GET /api/dashboard/health                 — real service checks

Tickets (role-scoped):
- GET  /api/tickets        — user: own tickets; agent/admin: all
- POST /api/tickets        — create manual ticket (JiraTicket-backed)

All read-only aggregates are available to any authenticated user; creation
of manual tickets is allowed for agent/admin (users escalate via chat).
"""
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
from app.auth.rbac import get_role, require_cap, require_role
from app.core.config import SETTINGS
from app.observability.audit import audit
from app.persistence.database import SessionLocal, engine

logger = logging.getLogger("dashboard")

# v0.21.4 — Jira status sync-on-read state
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

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _db() -> Any:
    return SessionLocal()


def _rows(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query and return list[dict]."""
    with engine.begin() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(m) for m in result.mappings()]


# ---------------------------------------------------------------------------
# dashboard: stats
# ---------------------------------------------------------------------------

@router.get("/dashboard/stats")
def dashboard_stats(user: str = Depends(get_current_user)) -> dict:
    since = datetime.now(UTC) - timedelta(days=7)
    week_ago = since.isoformat()

    chats_week = _rows(
        "SELECT count(*) AS n FROM chat_messages "
        "WHERE role = 'user' AND created_at >= :since",
        {"since": week_ago},
    )[0]["n"]

    # v0.21.84 — escalation rate must be measured against CONVERSATIONS: a ticket
    # counts as an escalation only when it originated from a chat (has session_id).
    # Counting every Jira row (mostly manually-created tickets) produced rates >100%.
    escalated_week = _rows(
        "SELECT count(*) AS n FROM jira_tickets "
        "WHERE session_id IS NOT NULL AND created_at >= :since",
        {"since": week_ago},
    )[0]["n"]

    # resolved ≈ answered turns where decision was 'answer' (meta JSON)
    resolved_week = _rows(
        "SELECT count(*) AS n FROM chat_messages "
        "WHERE role = 'assistant' AND created_at >= :since "
        "AND meta LIKE '%\"decision\": \"answer\"%'",
        {"since": week_ago},
    )[0]["n"]

    active_users = _rows(
        "SELECT count(DISTINCT username) AS n FROM chat_sessions "
        "WHERE started_at >= :since",
        {"since": week_ago},
    )[0]["n"]

    kb_pages = _rows("SELECT count(*) AS n FROM kb_meta")[0]["n"]

    return {
        "total_conversations": int(chats_week or 0),
        "resolved_by_bot": int(resolved_week or 0),
        "escalated_to_tickets": int(escalated_week or 0),
        "active_users": int(active_users or 0),
        "kb_pages": int(kb_pages or 0),
        "window_days": 7,
    }


# ---------------------------------------------------------------------------
# dashboard: conversations series
# ---------------------------------------------------------------------------

@router.get("/dashboard/conversations")
def dashboard_conversations(
    days: int = 7, user: str = Depends(get_current_user)
) -> dict:
    days = max(1, min(days, 30))
    since = (datetime.now(UTC) - timedelta(days=days)).date().isoformat()

    totals = {
        str(r["day"]): int(r["n"])
        for r in _rows(
            "SELECT date(created_at) AS day, count(*) AS n FROM chat_messages "
            "WHERE role = 'user' AND date(created_at) >= :since "
            "GROUP BY day ORDER BY day",
            {"since": since},
        )
    }
    escalated = {
        str(r["day"]): int(r["n"])
        for r in _rows(
            "SELECT date(created_at) AS day, count(*) AS n FROM jira_tickets "
            "WHERE date(created_at) >= :since GROUP BY day ORDER BY day",
            {"since": since},
        )
    }

    series = []
    for i in range(days):
        day = (datetime.now(UTC) - timedelta(days=days - 1 - i)).date().isoformat()
        label = datetime.fromisoformat(day).strftime("%b %d")
        total = totals.get(day, 0)
        esc = escalated.get(day, 0)
        series.append(
            {
                "day": label,
                "total": total,
                "resolved": max(0, total - esc),
                "escalated": esc,
            }
        )

    return {"days": days, "series": series}


# ---------------------------------------------------------------------------
# dashboard: domains
# ---------------------------------------------------------------------------

@router.get("/dashboard/domains")
def dashboard_domains(user: str = Depends(get_current_user)) -> dict:
    rows = _rows(
        "SELECT domain AS name, count(*) AS n FROM kb_meta "
        "GROUP BY domain ORDER BY n DESC LIMIT 8"
    )
    # kb page distribution is a stand-in for query-domain mix until
    # chat_messages.meta domain aggregation is indexed; cheap + honest.
    total = sum(int(r["n"]) for r in rows) or 1
    domains = [
        {
            "name": str(r["name"] or "general").capitalize(),
            "count": int(r["n"]),
            "percentage": round(100.0 * int(r["n"]) / total, 1),
        }
        for r in rows
    ]
    return {"domains": domains}


# ---------------------------------------------------------------------------
# dashboard: recent conversations
# ---------------------------------------------------------------------------

@router.get("/dashboard/recent-conversations")
def dashboard_recent_conversations(
    limit: int = 10, user: str = Depends(get_current_user)
) -> dict:
    limit = max(1, min(limit, 50))
    rows = _rows(
        "SELECT m.created_at, s.username, m.content, m.meta "
        "FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id "
        "WHERE m.role = 'user' ORDER BY m.created_at DESC LIMIT :limit",
        {"limit": limit},
    )
    out = []
    for r in rows:
        meta = r.get("meta") or ""
        decision = "Resolved" if '"answer"' in meta else "Escalated"
        created = r["created_at"]
        out.append(
            {
                "time": created.strftime("%H:%M") if created else "",
                "user": r.get("username") or "unknown",
                "question": (r.get("content") or "")[:120],
                "result": decision,
            }
        )
    return {"conversations": out}


# ---------------------------------------------------------------------------
# dashboard: recent tickets
# ---------------------------------------------------------------------------

@router.get("/dashboard/recent-tickets")
def dashboard_recent_tickets(
    limit: int = 5, user: str = Depends(get_current_user)
) -> dict:
    limit = max(1, min(limit, 20))
    rows = _rows(
        "SELECT id, jira_key, domain, status, created_by, created_at, subject, priority, assignee, due_date "
        "FROM jira_tickets ORDER BY created_at DESC LIMIT :limit",
        {"limit": limit},
    )
    priority_map = {"database": "High", "network": "High", "security": "Critical",
                    "system": "Medium", "general": "Low"}
    out = []
    for r in rows:
        out.append(
            {
                "id": r.get("jira_key") or f"IT-{r['id']}",
                "subject": r.get("subject") or ((r.get("domain") or "general") + " escalation"),
                # normalize to Dashboard's badge vocabulary (Open/Pending/Resolved)
                "status": {"created": "Open", "open": "Open", "pending": "Pending",
                           "in progress": "Pending", "resolved": "Resolved",
                           "done": "Resolved", "closed": "Resolved"}.get(
                               (r.get("status") or "open").lower(), "Open"),
                "priority": (r.get("priority") or priority_map.get(r.get("domain") or "", "Medium")).capitalize(),
            }
        )
    return {"tickets": out}


# ---------------------------------------------------------------------------
# dashboard: health (real service checks)
# ---------------------------------------------------------------------------

@router.get("/dashboard/health")
def dashboard_health(user: str = Depends(get_current_user)) -> list[dict]:
    checks: list[dict] = []

    def add(name: str, ok: bool, latency_ms: int | None = None):
        checks.append(
            {
                "name": name,
                "status": "Healthy" if ok else "Down",
                "latency_ms": latency_ms,
            }
        )

    # PostgreSQL + pgvector
    t0 = time.time()
    try:
        _rows("SELECT 1")
        add("PostgreSQL + pgvector", True, int((time.time() - t0) * 1000))
    except Exception as exc:
        add("PostgreSQL + pgvector", False)
        logger.warning("health pg failed: %s", exc)

    # Redis (Sentinel-aware — uses the same connection the app uses)
    try:
        from app.persistence.redis import get_redis

        client = get_redis()
        client.socket_connect_timeout = 2
        client.socket_timeout = 2
        t0 = time.time()
        client.ping()
        add("Redis", True, int((time.time() - t0) * 1000))
    except Exception as exc:
        logger.warning("redis health failed: %s", exc)
        add("Redis", False)

    # Ollama embeddings
    t0 = time.time()
    try:
        import httpx

        r = httpx.get(f"{SETTINGS.ollama_url}/api/tags", timeout=3)
        add("Ollama / embeddings", r.status_code == 200, int((time.time() - t0) * 1000))
    except Exception:
        add("Ollama / embeddings", False)

    # LLM provider (H-Chat / OpenRouter) — config presence check (no cost)
    add("H-Chat API", bool(SETTINGS.hchat_api_key))

    # Confluence integration
    add("Confluence sync", bool(SETTINGS.confluence_token))

    # LDAP (config presence; real bind test is expensive)
    add("LDAP / AD", bool(SETTINGS.ldap_enabled) if hasattr(SETTINGS, "ldap_enabled") else True)

    return checks


# ---------------------------------------------------------------------------
# tickets: list + create (role-scoped)
# ---------------------------------------------------------------------------

class TicketCreate(BaseModel):
    subject: str
    description: str = ""
    domain: str = "general"
    priority: str = "medium"
    assignee: str | None = None    # v0.20.2
    due_date: str | None = None    # v0.20.2 ISO date


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

    out = []
    for r in rows:
        out.append(
            {
                "id": r.get("jira_key") or f"IT-{r['id']}",
                "subject": r.get("subject") or ((r.get("domain") or "general") + " escalation"),
                "description": r.get("description"),
                "status": ({"created": "open"}.get(r.get("status") or "", r.get("status") or "open")),
                "priority": (r.get("priority") or "medium"),
                "category": (r.get("domain") or "general").capitalize(),
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

        summary = req.subject[:120]
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
            subject=req.subject[:200],
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
            from app.integrations.notifier import notify_ticket_created
            notify_ticket_created(user, jira_key, req.subject[:120])
        except Exception:
            pass
        return {
            "id": jira_key or f"IT-{row.id}",
            "jira_mode": jira_result.get("mode"),
            "jira_link": jira_result.get("link"),
            "subject": req.subject[:120],
            "description": req.description,
            "status": "open",
            "priority": req.priority,
            "category": req.domain.capitalize(),
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
            from app.integrations.notifier import notify_ticket_status
            notify_ticket_status(row.created_by, row.jira_key, old, local)
        except Exception:
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


@router.get("/users/assignable")
def assignable_users(user: str = Depends(get_current_user)) -> dict:
    """Users holding ticket-working roles (admin/agent) — the assignable pool (v0.20.2)."""

    seen: dict[str, dict] = {}
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(
            _t("SELECT username, email, department FROM users")).mappings().all()
        # users table may be empty pre-LDAP; also discover identities from activity
        known = s.execute(
            _t("SELECT DISTINCT created_by AS u FROM jira_tickets WHERE created_by IS NOT NULL "
               "UNION SELECT DISTINCT username FROM audit_log WHERE username IS NOT NULL")
        ).mappings().all()
    for r in rows:
        seen[r["username"]] = {"username": r["username"], "email": r.get("email"),
                               "role": get_role(r["username"])}
    for r in known:
        u = r["u"]
        if u and u not in seen:
            seen[u] = {"username": u, "email": None, "role": get_role(u)}
    out = [v for v in seen.values() if v["role"] in ("admin", "agent")]
    return {"users": out}


class AttachmentRequest(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"
    data_base64: str


@router.get("/users")
def list_users(user: str = Depends(get_current_user)) -> dict:
    """All users visible to the chatbot — AD users (LDAP) merged with local users.
    Local users come from the users table (created on first login), AD users from the
    configured LDAP base. Admin/agent only (v0.21.9).

    v0.21.51 — gate uses get_role() (which knows about dev_admin_usernames) so
    the new admin ('ith@dmin') is recognised on first login before the users
    table has a row for them.
    """
    from app.auth.rbac import get_role as _gr
    role = _gr(user)
    if role not in ("admin", "agent"):
        raise HTTPException(status_code=403, detail="Forbidden")
    out: dict[str, dict] = {}
    # v0.21.58 — attach admin-managed groups + departments to every user record
    app_group_map: dict[str, list[str]] = {}
    dept_map: dict[str, str] = {}
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal as _SL

        with _SL() as s:
            for m in s.execute(_t("SELECT group_name, username FROM app_group_members")).mappings():
                app_group_map.setdefault(m["username"], []).append(m["group_name"])
            for m in s.execute(_t(
                "SELECT department, member_name FROM department_members WHERE member_type = 'user'"
            )).mappings():
                dept_map[m["member_name"]] = m["department"]
    except Exception:
        pass

    # 1) local users (DB) — first so the canonical id field is "local:<username>"
    with SessionLocal() as s:
        try:
            from sqlalchemy import text as _t
            rows = s.execute(_t(
                "SELECT username, role_override, status, disabled_at, email, department, last_login "
                "FROM users ORDER BY username"
            )).mappings().all()
            for r in rows:
                u = r["username"]
                role = (r.get("role_override") or "user").capitalize()
                out[u] = {
                    "id": f"local:{u}",
                    "name": u,
                    "username": u,
                    "email": r.get("email") or f"{u}@drlinuxer.com",
                    "department": dept_map.get(u) or r.get("department") or "Internal",
                    "role": role,
                    "roleOverride": r.get("role_override"),
                    "status": r.get("status") or "Active",
                    "groups": app_group_map.get(u, []),
                    "lastLogin": r["last_login"].strftime("%Y-%m-%d %H:%M") if r.get("last_login") else "—",
                    "joined": "—",
                    "source": "local",
                }
        except Exception:
            pass
    # 2) AD users via LDAP
    if SETTINGS.ldap_url:
        try:
            from ldap3 import ALL, Connection, Server
            server = Server(SETTINGS.ldap_url, get_info=ALL, connect_timeout=5)
            conn = Connection(server, user=SETTINGS.ldap_bind_dn,
                               password=SETTINGS.ldap_bind_password, auto_bind=True)
            # Search for user objects only
            conn.search(SETTINGS.ldap_base_dn,
                        "(&(objectClass=user)(objectCategory=person)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))",
                        attributes=["sAMAccountName", "displayName", "mail", "department",
                                    "userPrincipalName", "memberOf", "whenCreated", "lastLogon", "lastLogonTimestamp"],
                        size_limit=500)
            from datetime import datetime as _dt
            for e in conn.entries:
                u = str(e.sAMAccountName) if e.sAMAccountName else None
                if not u:
                    continue
                # derive role from AD groups
                groups: list[str] = []
                if hasattr(e, "memberOf") and e.memberOf:
                    # ldap3 returns memberOf as a list of strings (one per group DN)
                    raw_list = e.memberOf.values if hasattr(e.memberOf, "values") else e.memberOf
                    if isinstance(raw_list, str):
                        raw_list = [raw_list]
                    for g in raw_list:
                        if g.startswith("CN="):
                            groups.append(g.split(",")[0].replace("CN=", ""))
                role = "User"
                for g in groups:
                    if "admin" in g.lower():
                        role = "Administrator"; break
                    if "agent" in g.lower() or "support" in g.lower():
                        role = "IT Support"
                # lastLogon is a 100-ns Windows ticks value (if present and large)
                last_login = "—"
                # v0.21.58 — lastLogon is per-DC (not replicated); lastLogonTimestamp
                # is the replicated, accurate "last login" across all DCs.
                ll_value = None
                if hasattr(e, "lastLogonTimestamp") and e.lastLogonTimestamp:
                    ll_value = e.lastLogonTimestamp
                elif hasattr(e, "lastLogon") and e.lastLogon:
                    ll_value = e.lastLogon
                if ll_value:
                    try:
                        ticks = int(str(ll_value))
                        if ticks > 0:
                            ts = (ticks / 10000000.0) - 11644473600
                            if ticks > 9223372036854775807 // 2:  # never-logged-in sentinel
                                last_login = "—"
                            else:
                                last_login = _dt.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
                    except Exception:
                        pass
                # local record lookup (before first use — v0.21.74 bugfix)
                local = out.get(u, {})
                # local last_login (real chatbot logins) wins when newer
                local_ll = (local or {}).get("lastLogin")
                if local_ll and local_ll != "—":
                    last_login = local_ll
                joined = "—"
                if hasattr(e, "whenCreated") and e.whenCreated:
                    joined = str(e.whenCreated)
                # v0.21.53 — preserve admin overrides from the local users table
                # (status + roleOverride). Without this, /api/users would always
                # return "Active" for AD users and ignore the disabled state.
                # v0.21.57 — capitalise the merged role so "agent" -> "Agent" for
                # the UI (matches what the local block does).
                merged_role = (local.get("roleOverride") or role).capitalize()
                merged_status = local.get("status") or "Active"
                merged_dept = local.get("department") if local.get("department") and local.get("department") != "Internal" else (str(e.department) if e.department else "—")
                ad_groups = groups + [g for g in app_group_map.get(u, []) if g not in groups]
                out[u] = {
                    "id": f"ad:{u}",
                    "name": str(e.displayName) if e.displayName else u,
                    "username": u,
                    "email": str(e.mail) if e.mail else f"{u}@drlinuxer.com",
                    "department": dept_map.get(u) or merged_dept,
                    "role": merged_role,
                    "roleOverride": local.get("roleOverride"),
                    "status": merged_status,
                    "groups": ad_groups,
                    "lastLogin": last_login,
                    "joined": joined,
                    "source": "ad",
                }
        except Exception as exc:
            logger.warning("LDAP user search failed: %s", exc)
    return {"users": sorted(out.values(), key=lambda x: x["username"].lower())}



@router.patch("/users/{username}/role")
def update_user_role(username: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: change a user's role. role_override in users table takes precedence
    over AD-group-derived role on next login (v0.21.7)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    role = (payload.get("role") or "").strip().lower()
    # Map display names to backend enum
    role = {"it support": "agent", "knowledge manager": "knowledge", "administrator": "admin", "user": "user", "admin": "admin", "agent": "agent"}.get(role, role)
    if role not in ("admin", "agent", "user", "knowledge"):
        raise HTTPException(status_code=400, detail="role must be admin|agent|user|knowledge")
    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO users (username, role_override) VALUES (:u, :r) "
            "ON CONFLICT (username) DO UPDATE SET role_override = EXCLUDED.role_override"
        ), {"u": username, "r": role})
        s.commit()
    try:
        from app.observability.audit import audit
        audit("user.role.update", user, detail=f"target={username} role={role}")
    except Exception:
        pass
    return {"ok": True, "username": username, "role_override": role}


@router.patch("/users/{username}/status")
def update_user_status(username: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: enable/disable a user. Disabled users cannot log in (v0.21.7).
    v0.21.52 — refuse to disable yourself so an admin can never self-lockout
    (the existing token is invalidated on disable, so re-enabling from the
    same session is impossible).
    """
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if username == user and not bool(payload.get("enabled", True)):
        raise HTTPException(
            status_code=400,
            detail="You cannot disable your own account. Ask another admin.",
        )
    enabled = bool(payload.get("enabled", True))
    new_status = "Active" if enabled else "Disabled"
    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO users (username, status) VALUES (:u, :s) "
            "ON CONFLICT (username) DO UPDATE SET status = EXCLUDED.status, "
            "disabled_at = CASE WHEN EXCLUDED.status = 'Disabled' THEN NOW() ELSE NULL END"
        ), {"u": username, "s": new_status})
        s.execute(text(
            "UPDATE users SET status = :s, "
            "disabled_at = CASE WHEN :s = 'Disabled' THEN NOW() ELSE NULL END "
            "WHERE username = :u"
        ), {"s": new_status, "u": username})
        s.commit()
    try:
        from app.observability.audit import audit
        audit("user.status.update", user, detail=f"target={username} enabled={enabled}")
    except Exception:
        pass
    return {"ok": True, "username": username, "status": new_status}


@router.post("/users/{username}/reset-access")
def reset_user_access(username: str, user: str = Depends(get_current_user)) -> dict:
    """Admin: force a re-login. Invalidates refresh tokens and bumps last_seen
    re-auth flag (the user must log in again) (v0.21.7)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO users (username, status) VALUES (:u, 'Active') "
            "ON CONFLICT (username) DO UPDATE SET status = 'Active', disabled_at = NULL"
        ), {"u": username})
        s.execute(text(
            "UPDATE users SET status = 'Active', disabled_at = NULL WHERE username = :u"
        ), {"u": username})
        s.commit()
    try:
        from app.observability.audit import audit
        audit("user.reset_access", user, detail=f"target={username}")
    except Exception:
        pass
    return {"ok": True, "username": username, "status": "Active"}



@router.put("/users/{username}/password")
def set_local_password(username: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: set a password for a LOCAL user. LDAP users must change it in AD."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    pw = payload.get("password") or ""
    if len(pw) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    # refuse for LDAP-sourced users (they authenticate against AD)
    with SessionLocal() as s:

        from app.persistence.models import LocalUserCredential

        u = s.get(LocalUserCredential, username)
        if u and u.source == "ldap":
            raise HTTPException(
                status_code=400,
                detail="LDAP users authenticate against Active Directory — change the password there.",
            )
        import hashlib
        import hmac as _hmac
        import secrets

        salt = secrets.token_hex(16)
        digest = _hmac.new(salt.encode(), pw.encode(), hashlib.sha256).hexdigest()
        stored = f"{salt}${digest}"
        s.execute(text(
            "INSERT INTO local_user_credentials (username, password_hash) VALUES (:u, :p) "
            "ON CONFLICT (username) DO UPDATE SET password_hash = :p, updated_at = NOW()"
        ), {"u": username, "p": stored})
        s.commit()
    try:
        audit("user.password.set", user, detail=f"target={username}")
    except Exception:
        pass
    return {"ok": True}


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

@router.get("/settings")
def get_user_settings(user: str = Depends(get_current_user)) -> dict:
    """Returns the current user's saved preferences as a flat key/value map."""
    import json as _json
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t(
            "SELECT prefs FROM user_settings WHERE username = :u"
        ), {"u": user}).first()
    prefs = row[0] if row and row[0] else {}
    if isinstance(prefs, str):
        try: prefs = _json.loads(prefs)
        except Exception: prefs = {}
    return {"settings": prefs or {}, "username": user}


@router.put("/settings")
def put_user_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Replace the current user's preferences (prefs JSONB column).
    Creates the row on first save with sensible defaults for all required
    columns. Requires the `prefs` JSONB column (added in v0.21.15)."""
    settings = payload.get("settings")
    if not isinstance(settings, dict):
        raise HTTPException(status_code=400, detail="settings must be an object")
    import json as _json
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        s.execute(_t(
            "INSERT INTO user_settings (username, theme, density, prefs) "
            "VALUES (:u, 'light', 'comfortable', :p) "
            "ON CONFLICT (username) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = NOW()"
        ), {"u": user, "p": _json.dumps(settings)})
        s.commit()
    return {"ok": True, "username": user, "count": len(settings)}

# === v0.21.37 — SMTP email notification settings (admin only) ===
SMTP_KEYS = {"host", "port", "username", "password", "from_address", "use_tls", "enabled", "alerts"}

def _require_admin(user: str) -> None:
    from app.auth.rbac import get_role
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: admin only")

@router.get("/settings/smtp")
def get_smtp_settings(user: str = Depends(get_current_user)) -> dict:
    _require_admin(user)
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
    import json as _json
    val = row[0] if row else {}
    if isinstance(val, str):
        try: val = _json.loads(val)
        except Exception: val = {}
    # never return the password to the client
    safe = {k: v for k, v in (val or {}).items() if k != "password"}
    safe["password_set"] = bool(val and val.get("password"))
    return {"smtp": safe}

@router.put("/settings/smtp")
def put_smtp_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    _require_admin(user)
    data = payload.get("smtp")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="smtp object required")
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
        import json as _json
        current = row[0] if row else {}
        if isinstance(current, str):
            try: current = _json.loads(current)
            except Exception: current = {}
        current = current or {}
        # merge; empty password keeps the existing one
        for k, v in data.items():
            if k in SMTP_KEYS:
                if k == "password" and not v:
                    continue
                current[k] = v
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES ('smtp', :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"v": _json.dumps(current)})
        s.commit()
    return {"ok": True}

@router.post("/settings/smtp/test")
def send_test_email(payload: dict, user: str = Depends(get_current_user)) -> dict:
    _require_admin(user)
    import smtplib
    import ssl as _ssl
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
    import json as _json
    cfg = row[0] if row else {}
    if isinstance(cfg, str):
        try: cfg = _json.loads(cfg)
        except Exception: cfg = {}
    cfg = cfg or {}
    host = cfg.get("host"); port = int(cfg.get("port") or 587)
    username = cfg.get("username"); password = cfg.get("password")
    from_addr = cfg.get("from_address") or username
    to_addr = payload.get("to") or username
    if not host or not from_addr:
        raise HTTPException(status_code=400, detail="SMTP host / from address မသတ်မှတ်ရသေးပါ")
    msg = MIMEMultipart()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = "iTH Enterprise — Test email"
    msg.attach(MIMEText("SMTP configuration စမ်းသပ်မှု အောင်မြင်ပါသည်။ (iTH Enterprise Assistant)", "plain", "utf-8"))
    try:
        use_ssl = port == 465
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=15,
                                  context=_ssl.create_default_context()) as srv:
                if username and password:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to_addr], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=15) as srv:
                srv.ehlo()
                if cfg.get("use_tls", True):
                    srv.starttls(context=_ssl.create_default_context())
                    srv.ehlo()
                if username and password:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to_addr], msg.as_string())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Send failed: {exc}")
    return {"ok": True, "to": to_addr}


# === v0.21.40 — integration settings (Confluence / Jira) ===
INTEGRATION_KEYS = {"confluence", "jira", "ldap", "llm", "redis", "ollama"}

@router.get("/settings/integrations/{key}")
def get_integration_settings(key: str, user: str = Depends(get_current_user)) -> dict:
    if key not in INTEGRATION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown integration")
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
    import json as _json
    val = row[0] if row else {}
    if isinstance(val, str):
        try: val = _json.loads(val)
        except Exception: val = {}
    safe = {k: v for k, v in (val or {}).items() if not (k.endswith("_token") or k.endswith("_password"))}
    safe["token_set"] = bool(val and val.get("api_token"))
    return {"integration": key, "settings": safe}

@router.put("/settings/integrations/{key}")
def put_integration_settings(key: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    if key not in INTEGRATION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown integration")
    data = payload.get("settings")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="settings object required")
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
        import json as _json
        current = row[0] if row else {}
        if isinstance(current, str):
            try: current = _json.loads(current)
            except Exception: current = {}
        current = current or {}
        for k, v in data.items():
            if (k.endswith("_token") or k.endswith("_password") or k in ("api_key", "password")) and not v:
                continue  # empty secret keeps the stored one
            current[k] = v
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": key, "v": _json.dumps(current)})
        s.commit()
    return {"ok": True}

@router.post("/settings/integrations/{key}/test")
def test_integration(key: str, user: str = Depends(get_current_user)) -> dict:
    """Connectivity test for Confluence / Jira."""
    import httpx

    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
    import json as _json
    cfg = row[0] if row else {}
    if isinstance(cfg, str):
        try: cfg = _json.loads(cfg)
        except Exception: cfg = {}
    cfg = cfg or {}
    try:
        if key == "confluence":
            url = (cfg.get("base_url") or "").rstrip("/")
            if not url:
                raise ValueError("base_url not set")
            r = httpx.get(f"{url}/rest/api/content", params={"limit": 1},
                          auth=(cfg.get("email") or "", cfg.get("api_token") or ""), timeout=15)
            status = r.status_code
            detail = r.text[:200] if status not in (200, 201) else ""
        elif key == "jira":
            url = (cfg.get("base_url") or "").rstrip("/")
            if not url:
                raise ValueError("base_url not set")
            r = httpx.get(f"{url}/rest/api/3/myself",
                          auth=(cfg.get("email") or "", cfg.get("api_token") or ""), timeout=15)
            status = r.status_code
            detail = r.text[:200] if status != 200 else ""
        elif key == "llm":
            base = (cfg.get("base_url") or "").rstrip("/")
            if not base:
                raise ValueError("base_url not set")
            _hdrs = {"Authorization": f"Bearer {cfg.get('api_key')}"} if cfg.get("api_key") else {}
            r = httpx.get(f"{base}/models", headers=_hdrs, timeout=15)
            status = r.status_code
            detail = r.text[:200] if status != 200 else ""
        elif key == "ollama":
            host = (cfg.get("host") or "").rstrip("/")
            if not host:
                raise ValueError("host not set")
            r = httpx.get(f"{host}/api/tags", timeout=10)
            status = r.status_code
            detail = r.text[:200] if status != 200 else ""
        elif key == "redis":
            # TCP connect check (redis-ping needs a client dep; socket is enough)
            import socket
            host = cfg.get("host") or "127.0.0.1"
            port = int(cfg.get("port") or 6379)
            s = socket.create_connection((host, port), timeout=5)
            s.close()
            status, detail = 200, ""
        elif key == "ldap":
            # LDAP bind check via ldap3 using saved config (falls back to env config)
            host = cfg.get("host") or ""
            if not host:
                raise ValueError("host not set")
            port = int(cfg.get("port") or 389)
            from ldap3 import Connection, Server
            srv = Server(host, port=port, get_info=None, connect_timeout=5)
            conn = Connection(srv, user=cfg.get("bind_dn") or None,
                              password=cfg.get("bind_password") or None, auto_bind=False)
            conn.open()
            conn.unbind()
            status, detail = 200, ""
        else:
            raise ValueError(f"no test for {key}")
        if status in (200, 201):
            return {"ok": True, "status": status}
        return {"ok": False, "status": status, "detail": detail}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:200]}


# === v0.21.36 — chat attachments ===
# Store uploaded files (images/docs) as bytea rows; the chat message references
# attachment ids so the UI can render previews inline.

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


# === v0.21.14 — RBAC role/permission matrix (admin-editable) ===

# Canonical 4 roles and 5 capabilities. These are the defaults — admins can override
# any non-Administrator permission via PUT /api/rbac/matrix.
_RBAC_DEFAULT_MATRIX: dict[str, dict[str, bool]] = {
    "Administrator": {"chatbot": True,  "kb_search": True, "create_tickets": True, "manage_kb": True, "manage_users": True},
    "IT Support":    {"chatbot": True,  "kb_search": True, "create_tickets": True, "manage_kb": False, "manage_users": False},
    "Knowledge Manager": {"chatbot": True, "kb_search": True, "create_tickets": False, "manage_kb": True, "manage_users": False},
    "User":          {"chatbot": True,  "kb_search": True, "create_tickets": False, "manage_kb": False, "manage_users": False},
}
_RBAC_ROLES = tuple(_RBAC_DEFAULT_MATRIX.keys())


@router.get("/rbac/matrix")
def get_rbac_matrix(user: str = Depends(get_current_user)) -> dict:
    """Returns the role/permission matrix. Admin gets the editable view; non-admin gets a
    read-only copy. Defaults are returned for any role with no override row."""
    is_admin = get_role(user) == "admin"
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        rows = s.execute(_t(
            "SELECT role, permissions, updated_at, updated_by FROM rbac_matrix"
        )).mappings().all()
    overrides = {r["role"]: (r["permissions"], r["updated_at"], r["updated_by"]) for r in rows}
    out = []
    for role, perms in _RBAC_DEFAULT_MATRIX.items():
        if role in overrides:
            stored = overrides[role][0]
            merged = {**perms, **stored}  # override > default
            out.append({
                "role": role,
                "permissions": merged,
                "default": perms,
                "overridden": role in overrides,
                "updated_at": overrides[role][1].isoformat() if overrides[role][1] else None,
                "updated_by": overrides[role][2],
            })
        else:
            out.append({
                "role": role, "permissions": perms,
                "default": perms, "overridden": False,
                "updated_at": None, "updated_by": None,
            })
    return {"matrix": out, "editable": is_admin}


@router.put("/rbac/matrix")
def put_rbac_matrix(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: replace the permission matrix. payload = { "matrix": [ {role, permissions: {cap: bool}} ] }.
    Administrator row is rejected as a safety (admin must always have all perms)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    matrix = payload.get("matrix")
    if not isinstance(matrix, list):
        raise HTTPException(status_code=400, detail="matrix must be a list")
    # Validate + write
    import json as _json

    from sqlalchemy import text as _t
    with SessionLocal() as s:
        for row in matrix:
            role = (row.get("role") or "").strip()
            perms = row.get("permissions") or {}
            if role not in _RBAC_ROLES:
                raise HTTPException(status_code=400, detail=f"unknown role: {role}")
            if not isinstance(perms, dict):
                raise HTTPException(status_code=400, detail=f"permissions for {role} must be an object")
            # Ensure every default key is present
            merged = {**_RBAC_DEFAULT_MATRIX[role], **perms}
            if role == "Administrator":
                # Hard guarantee: admin always has everything
                merged = dict(_RBAC_DEFAULT_MATRIX["Administrator"])
            s.execute(_t(
                "INSERT INTO rbac_matrix (role, permissions, updated_by, updated_at) "
                "VALUES (:r, :p, :u, NOW()) "
                "ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions, "
                "updated_by = EXCLUDED.updated_by, updated_at = NOW()"
            ), {"r": role, "p": _json.dumps(merged), "u": user})
        s.commit()
    try:
        from app.observability.audit import audit
        audit("rbac.matrix.update", user, detail="roles=" + ",".join(r["role"] for r in matrix))
    except Exception:
        pass
    return {"ok": True, "count": len(matrix)}


# --- v0.21.58 — per-user permission overrides + groups + departments ----------

from app.persistence.models import (
    AppGroup,
    Department,
    DepartmentMember,
    GroupMember,
)


@router.get("/users/{username}/permissions")
def get_user_permissions(username: str, user: str = Depends(get_current_user)) -> dict:
    """Admin view: role matrix caps + this user's personal overrides."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    from app.auth.rbac import permissions_for

    with SessionLocal() as s:
        from sqlalchemy import text as _t

        row = s.execute(
            _t("SELECT permissions FROM user_permission_overrides WHERE username = :u"),
            {"u": username},
        ).first()
    return {
        "username": username,
        "effective": permissions_for(username),
        "overrides": row.permissions if row and row.permissions else {},
    }


@router.put("/users/{username}/permissions")
def put_user_permissions(username: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: set per-user extra permissions (true/false per capability)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    perms = payload.get("permissions") or {}
    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO user_permission_overrides (username, permissions, updated_by) "
            "VALUES (:u, :p::jsonb, :by) "
            "ON CONFLICT (username) DO UPDATE SET permissions = :p::jsonb, updated_by = :by, updated_at = NOW()"
        ), {"u": username, "p": perms, "by": user})
        s.commit()
    try:
        audit("user.permissions.update", user, detail=f"target={username} perms={perms}")
    except Exception:
        pass
    from app.auth.rbac import permissions_for

    return {"ok": True, "username": username, "effective": permissions_for(username)}


@router.get("/groups")
def list_groups(user: str = Depends(get_current_user)) -> dict:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    with SessionLocal() as s:
        groups = s.query(AppGroup).order_by(AppGroup.name).all()
        members = s.query(GroupMember).all()
    out = []
    for g in groups:
        out.append({
            "name": g.name,
            "description": g.description,
            "role": g.role,
            "permissions": g.permissions or {},
            "members": [m.username for m in members if m.group_name == g.name],
        })
    return {"groups": out}


@router.post("/groups")
def create_group(payload: dict, user: str = Depends(get_current_user)) -> dict:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    name = (payload.get("name") or "").strip()
    role = (payload.get("role") or "user").strip().lower()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    if role not in ("admin", "agent", "knowledge", "user"):
        raise HTTPException(status_code=400, detail="role must be admin|agent|knowledge|user")
    with SessionLocal() as s:
        if s.get(AppGroup, name):
            raise HTTPException(status_code=409, detail=f"Group '{name}' already exists")
        s.add(AppGroup(name=name, description=payload.get("description"), role=role,
                       permissions=payload.get("permissions") or {}))
        s.commit()
    try:
        audit("group.create", user, detail=f" group={name} role={role}")
    except Exception:
        pass
    return {"ok": True, "name": name, "role": role}


@router.put("/groups/{name}")
def update_group(name: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    with SessionLocal() as s:
        g = s.get(AppGroup, name)
        if not g:
            raise HTTPException(status_code=404, detail="Group not found")
        if "description" in payload:
            g.description = payload["description"]
        if "role" in payload:
            r = (payload["role"] or "user").lower()
            if r in ("admin", "agent", "knowledge", "user"):
                g.role = r
        if "permissions" in payload:
            g.permissions = payload["permissions"]
        if "members" in payload:
            s.query(GroupMember).filter(GroupMember.group_name == name).delete()
            for u in payload["members"]:
                s.add(GroupMember(group_name=name, username=u))
        s.commit()
    return {"ok": True, "name": name}


@router.delete("/groups/{name}")
def delete_group(name: str, user: str = Depends(get_current_user)) -> dict:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    with SessionLocal() as s:
        s.query(GroupMember).filter(GroupMember.group_name == name).delete()
        g = s.get(AppGroup, name)
        if g:
            s.delete(g)
        s.commit()
    return {"ok": True}


@router.get("/departments")
def list_departments(user: str = Depends(get_current_user)) -> dict:
    with SessionLocal() as s:
        deps = s.query(Department).order_by(Department.name).all()
        members = s.query(DepartmentMember).all()
    out = []
    for d in deps:
        out.append({
            "name": d.name,
            "description": d.description,
            "users": [m.member_name for m in members if m.department == d.name and m.member_type == "user"],
            "groups": [m.member_name for m in members if m.department == d.name and m.member_type == "group"],
        })
    return {"departments": out}


@router.post("/departments")
def create_department(payload: dict, user: str = Depends(get_current_user)) -> dict:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Department name is required")
    with SessionLocal() as s:
        if s.get(Department, name):
            raise HTTPException(status_code=409, detail=f"Department '{name}' already exists")
        s.add(Department(name=name, description=payload.get("description"), created_by=user))
        s.commit()
    try:
        audit("department.create", user, detail=f" name={name}")
    except Exception:
        pass
    return {"ok": True, "name": name}


@router.put("/departments/{name}")
def update_department(name: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    with SessionLocal() as s:
        d = s.get(Department, name)
        if not d:
            raise HTTPException(status_code=404, detail="Department not found")
        if "description" in payload:
            d.description = payload["description"]
        if "users" in payload or "groups" in payload:
            s.query(DepartmentMember).filter(DepartmentMember.department == name).delete()
            for u in payload.get("users", []):
                s.add(DepartmentMember(department=name, member_type="user", member_name=u))
            for g in payload.get("groups", []):
                s.add(DepartmentMember(department=name, member_type="group", member_name=g))
        s.commit()
    return {"ok": True, "name": name}


@router.delete("/departments/{name}")
def delete_department(name: str, user: str = Depends(get_current_user)) -> dict:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    with SessionLocal() as s:
        s.query(DepartmentMember).filter(DepartmentMember.department == name).delete()
        d = s.get(Department, name)
        if d:
            s.delete(d)
        s.commit()
    return {"ok": True}


@router.get("/runtime")
def get_runtime_settings(user: str = Depends(get_current_user)) -> dict:
    """Admin: current RAG runtime knobs (retrieval_top_k, confidence threshold, ...)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    from app.core.runtime import all_overrides

    return {"overrides": all_overrides()}


@router.put("/runtime")
def put_runtime_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: set RAG runtime knobs without redeploying."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    from app.core.runtime import set_ as runtime_set

    applied = {}
    for k, v in (payload.get("overrides") or {}).items():
        try:
            runtime_set(k, v)
            applied[k] = v
        except KeyError:
            pass
    return {"ok": True, "applied": applied}


# --- v0.21.70 Phase 2 — escalation approval queue (human-in-the-loop) ---------

@router.get("/approvals")
def list_approvals(user: str = Depends(get_current_user)) -> dict:
    """Admin: pending escalation approvals."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(_t(
            "SELECT id, username, question, status, created_at FROM approvals "
            "ORDER BY created_at DESC LIMIT 50"
        )).mappings().all()
    return {"approvals": [
        {"id": str(r["id"]), "username": r["username"], "question": r["question"],
         "status": r["status"], "created_at": r["created_at"].isoformat() if r["created_at"] else None}
        for r in rows
    ]}


@router.put("/approvals/{approval_id}")
def decide_approval(approval_id: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: approve or reject a pending escalation.

    v0.21.82 — the decision is delivered INTO the LangGraph via
    Command(resume=...); ticket creation now happens inside the graph's
    create_ticket node (single source of truth for state transitions).
    Returns the graph's final state (ticket_id + confirmation message).
    """
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    decision = (payload.get("decision") or "").lower()
    if decision not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision must be approved|rejected")

    with SessionLocal() as s:
        from sqlalchemy import text as _t

        res = s.execute(_t(
            "UPDATE approvals SET status = :st, decided_by = :by, decided_at = NOW() "
            "WHERE id = :i AND status = 'pending' RETURNING username, question, thread_id"
        ), {"st": decision, "by": user, "i": approval_id}).mappings().first()
        s.commit()
    if not res:
        raise HTTPException(status_code=404, detail="Pending approval not found")

    # Resume the graph with the admin decision (ticket creation happens in-graph)
    from app.orchestration.graph import run_rag_graph

    thread_id = res.get("thread_id") or approval_id
    try:
        graph_state = run_rag_graph(
            query=res["question"] or "",
            user=res["username"],
            thread_id=thread_id,
            resume_command={"approved": decision == "approved", "decided_by": user},
        )
    except Exception as exc:  # graph/Jira hiccup → direct escalation fallback
        graph_state = {"approval_status": decision, "ticket_id": None,
                       "escalation_messages": [f"graph error: {exc}"]}
        if decision == "approved":
            try:
                from app.integrations.jira import escalate as jira_escalate
                from app.persistence.models import JiraTicket

                summary = (res["question"] or "Escalation")[:120]
                jr = jira_escalate(summary=summary, description=res["question"] or "",
                                   reporter=res["username"] or None, domain="general")
                with SessionLocal() as s:
                    s.add(JiraTicket(jira_key=jr.get("jira_key"), subject=summary,
                                     description=res["question"] or "",
                                     created_by=res["username"], status="Open"))
                    s.commit()
                try:
                    from app.integrations.notifier import notify_ticket_created
                    notify_ticket_created(res["username"], jr.get("jira_key"), summary)
                except Exception:
                    pass
                graph_state.update(
                    ticket_id=jr.get("jira_key"),
                    escalation_messages=[f"✅ Ticket ({jr.get('jira_key')}) opened successfully."])
            except Exception as exc2:
                graph_state["escalation_messages"] = [f"escalation failed: {exc2}"]
    try:
        audit("approval.decision", user, detail=f"id={approval_id} decision={decision}")
    except Exception:
        pass
    return {
        "ok": True,
        "decision": decision,
        "approval_status": graph_state.get("approval_status"),
        "ticket_id": graph_state.get("ticket_id"),
        "messages": graph_state.get("escalation_messages") or [],
    }


# --- v0.21.90 — admin audit log viewer ------------------------------------------

@router.get("/admin/audits")
def admin_list_audits(
    user: str = Depends(get_current_user),
    username: str = "", action: str = "", limit: int = 100,
    offset: int = 0,
) -> dict:
    """Admin: read the application audit trail (login/chat/escalate/feedback/sync)."""
    _require_admin_cap(user, "manage_users")
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    where = "WHERE 1=1"
    params: dict = {"limit": limit, "offset": offset}
    if username:
        where += " AND username = :username"
        params["username"] = username
    if action:
        where += " AND action = :action"
        params["action"] = action
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(_t(
            "SELECT id, action, username, domain, confidence, decision, detail, "
            "created_at FROM audit_log " + where +
            " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
        ), params).mappings().all()
        total = s.execute(_t(
            "SELECT count(*) AS n FROM audit_log " + where
        ), {k: v for k, v in params.items() if k in ("username", "action")}).mappings().first()["n"]
        actions = [r["action"] for r in s.execute(_t(
            "SELECT DISTINCT action FROM audit_log ORDER BY action")).mappings().all()]
    out = [{
        "id": r["id"], "action": r["action"], "username": r["username"],
        "domain": r["domain"], "confidence": r["confidence"], "decision": r["decision"],
        "detail": r["detail"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    } for r in rows]
    return {"audits": out, "total": total, "actions": actions}


@router.get("/admin/audits/export")
def admin_export_audits(
    user: str = Depends(get_current_user), username: str = "", action: str = "",
    format: str = "csv",
) -> str:
    """Admin: export the audit trail as CSV (download)."""
    _require_admin_cap(user, "manage_users")
    from fastapi import Response as _Resp

    where = "WHERE 1=1"
    params: dict = {}
    if username:
        where += " AND username = :username"; params["username"] = username
    if action:
        where += " AND action = :action"; params["action"] = action
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        rows = s.execute(_t(
            "SELECT created_at, action, username, domain, decision, confidence, detail "
            "FROM audit_log " + where + " ORDER BY created_at DESC LIMIT 10000"
        ), params).mappings().all()
    import csv as _csv
    import io as _io

    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["created_at", "action", "username", "domain", "decision", "confidence", "detail"])
    for r in rows:
        w.writerow([(r["created_at"].isoformat() if r["created_at"] else ""),
                    r["action"], r["username"] or "", r["domain"] or "",
                    r["decision"] or "", r["confidence"] if r["confidence"] is not None else "",
                    (r["detail"] or "").replace("\r", " ").replace("\n", " ")])
    return _Resp(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'},
    )


# --- v0.21.73 — admin conversation audit & export ------------------------------

def _require_admin_cap(user: str, cap: str) -> None:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")


@router.get("/admin/conversations")
def admin_list_conversations(
    username: str = "", limit: int = 50, user: str = Depends(get_current_user)
) -> dict:
    """Admin: list ALL users' chat sessions (optionally filtered by username)."""
    _require_admin_cap(user, "manage_users")
    limit = max(1, min(limit, 200))
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        sql = (
            "SELECT cs.id, cs.username, cs.title, cs.started_at, "
            "count(cm.id) AS messages, max(cm.created_at) AS last_at "
            "FROM chat_sessions cs JOIN chat_messages cm ON cm.session_id = cs.id "
            "WHERE (:u = '' OR cs.username = :u) "
            "GROUP BY cs.id, cs.username, cs.title, cs.started_at "
            "ORDER BY max(cm.created_at) DESC LIMIT :lim"
        )
        rows = s.execute(_t(sql), {"u": username, "lim": limit}).mappings().all()
    return {"conversations": [
        {"session_id": str(r["id"]), "username": r["username"],
         "title": r["title"] or "(untitled)", "messages": int(r["messages"]),
         "started_at": r["started_at"].isoformat() if r["started_at"] else None,
         "last_at": r["last_at"].isoformat() if r["last_at"] else None}
        for r in rows
    ]}


@router.get("/admin/conversations/{session_id}/messages")
def admin_conversation_messages(session_id: str, user: str = Depends(get_current_user)) -> dict:
    """Admin: full transcript of one session."""
    _require_admin_cap(user, "manage_users")
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        sess = s.execute(_t("SELECT username, title, started_at FROM chat_sessions WHERE id = :i"),
                         {"i": session_id}).mappings().first()
        if not sess:
            raise HTTPException(status_code=404, detail="Conversation not found")
        msgs = s.execute(_t(
            "SELECT role, content, meta, created_at FROM chat_messages "
            "WHERE session_id = :i ORDER BY created_at"
        ), {"i": session_id}).mappings().all()
    return {"username": sess["username"], "title": sess["title"],
            "started_at": sess["started_at"].isoformat() if sess["started_at"] else None,
            "messages": [
                {"role": m["role"], "content": m["content"],
                 "created_at": m["created_at"].isoformat() if m["created_at"] else None}
                for m in msgs
            ]}


@router.get("/admin/conversations/{session_id}/export")
def admin_conversation_export(session_id: str, format: str = "txt",
                              user: str = Depends(get_current_user)):
    """Admin: export a conversation transcript as .txt (or .json)."""
    _require_admin_cap(user, "manage_users")
    from fastapi.responses import Response

    d = admin_conversation_messages(session_id, user)
    fname = f"conversation-{d['username']}-{session_id[:8]}"
    if format == "json":
        import json as _json

        return Response(content=_json.dumps(d, indent=1, default=str),
                        media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{fname}.json"'})
    lines = [
        "Conversation export — IT Help Chatbot",
        f"User: {d['username']}   Session: {session_id}",
        f"Started: {d['started_at']}   Title: {d['title'] or '(untitled)'}",
        f"Exported: {datetime.now(UTC).isoformat()} by {user}",
        "=" * 60, "",
    ]
    for m in d["messages"]:
        who = "USER" if m["role"] == "user" else "AI"
        lines.append(f"[{m['created_at']}] {who}:")
        lines.append(m["content"])
        lines.append("")
    return Response(content="\n".join(lines), media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{fname}.txt"'})
