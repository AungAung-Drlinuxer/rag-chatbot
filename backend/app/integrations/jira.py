"""Jira escalation — Phase 6 + JSM customer-request (G3 delta).

Design:
- creds set  -> real JSM /rest/servicedeskapi/request (service account as reporter,
  authenticated username passed in custom field Chatbot User)
- base URL, no token (dev)  -> mock create (fake key, reporter = user)
- no base URL  -> pre-filled create link only (Phase 1)

Routing: per-domain via jira_request_types JSON ({"server":"101","network":"102"}).
"""
from __future__ import annotations

import base64
import json
from urllib.parse import quote

from app.config import SETTINGS

_CREATE_PATH = "/secure/CreateIssueDetails!init.jspa"


def build_create_link(summary: str, description: str) -> str:
    base = SETTINGS.jira_base_url.rstrip("/")
    q = f"?summary={quote(summary)}&description={quote(description)}"
    return f"{base}{_CREATE_PATH}{q}"


def _get_request_type(domain):
    raw = SETTINGS.jira_request_types
    if not raw:
        return None
    try:
        table = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(table, dict):
        return None
    return table.get((domain or "").lower()) or table.get("general")


def escalate(summary: str, description: str, reporter=None,
             project=None, assignee=None, domain=None) -> dict:
    """Create a Jira ticket via JSM API (preferred) or issue REST (fallback)."""
    if not SETTINGS.jira_base_url:
        return {"link": build_create_link(summary, description), "mode": "link",
                "jira_key": None, "reporter": reporter}

    service_desk_id = SETTINGS.jira_service_desk_id
    rt_id = _get_request_type(domain)

    try:
        if service_desk_id and rt_id and SETTINGS.jira_email and SETTINGS.jira_token:
            key, link = _create_via_jsm(
                service_desk_id, rt_id, summary, description, reporter, assignee, domain
            )
            return {"link": link, "mode": "jsm", "jira_key": key, "reporter": reporter}
        if SETTINGS.jira_email and SETTINGS.jira_token:
            key, link = _create_via_issue_rest(summary, description, reporter, project, assignee)
            return {"link": link, "mode": "rest", "jira_key": key, "reporter": reporter}
        key = _mock_key()
        return {"link": f"{SETTINGS.jira_base_url.rstrip('/')}/browse/{key}",
                "mode": "mock", "jira_key": key, "reporter": reporter}
    except Exception as exc:
        return {"link": build_create_link(summary, description), "mode": "link",
                "jira_key": None, "reporter": reporter,
                "error": f"{type(exc).__name__}: {exc}"}


def _mock_key():
    import random
    return f"ESC-{random.randint(1000, 9999)}"


def _auth_header():
    raw = f"{SETTINGS.jira_email}:{SETTINGS.jira_token}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _create_via_jsm(service_desk_id, request_type_id, summary, description,
                    reporter, assignee, domain):
    """POST /rest/servicedeskapi/request — JSM customer-request creation."""
    import httpx
    payload = {
        "serviceDeskId": service_desk_id,
        "requestTypeId": request_type_id,
        "requestFieldValues": {
            "summary": summary,
            "description": description,
        },
    }
    if reporter:
        payload["requestFieldValues"]["customfield_10001"] = reporter
    if domain:
        payload["requestFieldValues"]["customfield_10002"] = domain
    headers = {"Authorization": _auth_header(), "Accept": "application/json",
               "Content-Type": "application/json"}
    with httpx.Client(timeout=30) as client:
        r = client.post(f"{SETTINGS.jira_base_url.rstrip('/')}/rest/servicedeskapi/request",
                        json=payload, headers=headers)
        r.raise_for_status()
        body = r.json()
    issue_key = body.get("issueKey") or body.get("key") or ""
    link = f"{SETTINGS.jira_base_url.rstrip('/')}/browse/{issue_key}" if issue_key else ""
    return issue_key, link


def _create_via_issue_rest(summary, description, reporter, project, assignee):
    """Standard POST /rest/api/3/issue fallback (no JSM service-desk)."""
    import httpx
    fields = {
        "project": {"key": project or SETTINGS.jira_project},
        "summary": summary,
        "description": {"type": "doc", "version": 1,
                        "content": [{"type": "paragraph",
                                     "content": [{"type": "text", "text": description}]}]},
        "issuetype": {"name": "Task"},
    }
    headers = {"Authorization": _auth_header(), "Accept": "application/json",
               "Content-Type": "application/json"}
    with httpx.Client(timeout=30) as client:
        r = client.post(f"{SETTINGS.jira_base_url.rstrip('/')}/rest/api/3/issue",
                        json={"fields": fields}, headers=headers)
        r.raise_for_status()
        body = r.json()
    issue_key = body.get("key", "")
    return issue_key, f"{SETTINGS.jira_base_url.rstrip('/')}/browse/{issue_key}"


# ---------------------------------------------------------------------------
# v0.20.5 — status transitions (chatbot -> Jira)
# ---------------------------------------------------------------------------

# chatbot status word -> acceptable Jira transition names (first match wins)
STATUS_TRANSITIONS: dict[str, list[str]] = {
    "open": ["Reopen", "Re-open", "To Do", "Open", "Backlog", "Pending"],
    "pending": ["Start Progress", "In Progress", "Pending"],
    "resolved": ["Mark as done", "Done", "Resolve Issue", "Resolve"],
    "closed": ["Close Issue", "Close", "Mark as done", "Done"],
}


def transition_issue(issue_key: str, status: str) -> dict:
    """Move a Jira issue to a new status. Returns {ok, detail}."""
    if not (SETTINGS.jira_base_url and SETTINGS.jira_email and SETTINGS.jira_token):
        return {"ok": False, "detail": "Jira not configured"}

    names = STATUS_TRANSITIONS.get((status or "").lower(), [])
    auth = _auth_header()

    try:
        import httpx

        with httpx.Client(timeout=20,
                          headers={"Authorization": auth, "Accept": "application/json"}) as client:
            # 1) list available transitions
            r = client.get(f"{SETTINGS.jira_base_url.rstrip('/')}/rest/api/3/issue/{issue_key}/transitions")
            r.raise_for_status()
            available = {t["name"].lower(): t["id"] for t in r.json().get("transitions", [])}

            # 2) first matching transition name
            tid = next((available[n.lower()] for n in names if n.lower() in available), None)
            if tid is None:
                return {"ok": False,
                        "detail": f"no matching transition for '{status}' "
                                  f"(available: {list(available.keys())})"}

            # 3) perform the transition
            r2 = client.post(
                f"{SETTINGS.jira_base_url.rstrip('/')}/rest/api/3/issue/{issue_key}/transitions",
                json={"transition": {"id": tid}},
            )
            r2.raise_for_status()
            return {"ok": True, "detail": f"transitioned via '{tid}'"}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}


def fetch_issue_status(issue_key: str) -> dict:
    """Read the live status of a Jira issue. Returns {ok, status, assignee}."""
    if not (SETTINGS.jira_base_url and SETTINGS.jira_email and SETTINGS.jira_token):
        return {"ok": False, "detail": "Jira not configured"}
    try:
        import httpx

        with httpx.Client(timeout=15,
                          headers={"Authorization": _auth_header(), "Accept": "application/json"}) as client:
            r = client.get(
                f"{SETTINGS.jira_base_url.rstrip('/')}/rest/api/3/issue/{issue_key}",
                params={"fields": "status,assignee"},
            )
            r.raise_for_status()
            f = r.json().get("fields", {})
            return {
                "ok": True,
                "status": (f.get("status") or {}).get("name", "").lower(),
                "assignee": ((f.get("assignee") or {}).get("name")
                             or (f.get("assignee") or {}).get("accountId") or None),
            }
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}
