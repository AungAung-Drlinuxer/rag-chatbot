"""v1.6.9 — canonical ticket status model shared by Jira and OpenProject.

The platform uses four internal statuses on the Tickets board:
    open | pending | resolved | closed

Each integration maps those onto its own real workflow values, and maps
upstream status names BACK to the canonical set on pull.

Jira (live project ITHD, verified transitions):
    open     -> "To Do"/"Open"/"Reopen"            (status: Open / Pending)
    pending  -> "Start progress"                   (status: Work in progress)
    resolved -> "Mark as done"                     (status: Done)
    closed   -> fallback "Mark as done" (Done terminal)

OpenProject (workflow probed live on WP 44 — stock Task workflow):
    open     -> 1  New
    pending  -> 7  In progress     (13 On hold is an alternative)
    resolved -> 12 Closed          (only reachable terminal state in stock workflow)
    closed   -> 12 Closed          (14 Rejected also closed)
    Workflow edges: New <-> In progress -> Closed/On hold/Rejected (bidirectional
    between all four "active" states)

Any upstream status name that does not map exactly is bucketed by keyword so
the board never shows a raw unknown status.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# OpenProject: canonical -> real status IDs
# ---------------------------------------------------------------------------

# Live status IDs from GET /api/v3/statuses on this instance (stock workflow).
OP_STATUS_BY_NAME: dict[str, int] = {
    "new": 1,
    "in specification": 2,
    "specified": 3,
    "confirmed": 4,
    "to be scheduled": 5,
    "scheduled": 6,
    "in progress": 7,
    "developed": 8,
    "in testing": 9,
    "tested": 10,
    "test failed": 11,
    "closed": 12,
    "on hold": 13,
    "rejected": 14,
}

# canonical -> preferred OP status names.
# v1.6.10 — workflow-probed (WP 44 walk): the stock Task workflow allows
#   New <-> In progress -> Closed / On hold / Rejected  (no Developed path).
# So "resolved" maps to Closed upstream; the platform board still distinguishes
# resolved vs closed via its own jira_tickets.status column.
OP_STATUS_PREFERENCE: dict[str, list[str]] = {
    "open": ["New"],
    "pending": ["In progress", "On hold"],
    "resolved": ["Closed"],             # only reachable terminal state
    "closed": ["Closed", "Rejected"],
}

# upstream OP status name -> canonical
_OP_TO_CANONICAL: list[tuple[str, str]] = [
    ("new", "open"),
    ("in specification", "open"),
    ("specified", "open"),
    ("confirmed", "open"),
    ("to be scheduled", "open"),
    ("scheduled", "pending"),
    ("in progress", "pending"),
    ("on hold", "pending"),
    ("developed", "resolved"),
    ("in testing", "resolved"),
    ("tested", "resolved"),
    ("test failed", "pending"),
    ("closed", "closed"),
    ("rejected", "closed"),
]


def op_status_id_for(canonical: str) -> int | None:
    """Pick the best OpenProject status ID for a canonical platform status."""
    for name in OP_STATUS_PREFERENCE.get((canonical or "").lower(), []):
        sid = OP_STATUS_BY_NAME.get(name.lower())
        if sid is not None:
            return sid
    return None


def canonical_from_op_status(name: str) -> str:
    """Map an OpenProject status name to the canonical platform status."""
    n = (name or "").strip().lower()
    for frag, canon in _OP_TO_CANONICAL:
        if frag in n:
            return canon
    return "open"


# ---------------------------------------------------------------------------
# Jira: canonical -> transitions, and status-name -> canonical
# ---------------------------------------------------------------------------

# verified live on ITHD: transitions are 'Pending', 'Start progress' (to
# 'Work in progress'), 'Mark as done' (to 'Done')
JIRA_TRANSITIONS_BY_CANONICAL: dict[str, list[str]] = {
    "open": ["Reopen", "Re-open", "To Do", "Open", "Backlog", "Pending"],
    "pending": ["Start progress", "Start Progress", "In Progress", "Pending"],
    "resolved": ["Mark as done", "Done", "Resolve Issue", "Resolve"],
    "closed": ["Close Issue", "Close", "Mark as done", "Done"],
}

_JIRA_TO_CANONICAL: list[tuple[str, str]] = [
    ("to do", "open"),
    ("open", "open"),
    ("backlog", "open"),
    ("reopened", "open"),
    ("re-open", "open"),
    ("pending", "open"),      # Jira "Pending" = waiting on reporter -> still open
    ("work in progress", "pending"),
    ("in progress", "pending"),
    ("under review", "pending"),
    ("waiting for support", "pending"),
    ("waiting for customer", "open"),
    ("done", "resolved"),
    ("resolved", "resolved"),
    ("complete", "resolved"),
    ("closed", "closed"),
    ("cancelled", "closed"),
    ("canceled", "closed"),
    ("rejected", "closed"),
]


def canonical_from_jira_status(name: str) -> str:
    """Map a Jira status name to the canonical platform status."""
    n = (name or "").strip().lower()
    for frag, canon in _JIRA_TO_CANONICAL:
        if frag in n:
            return canon
    return "open"


def canonical_statuses() -> list[str]:
    return ["open", "pending", "resolved", "closed"]