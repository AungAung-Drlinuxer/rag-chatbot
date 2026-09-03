"""RBAC / ACL (Phase 9) — LDAP group roles · domain-scoped access · per-domain Jira routing.

Role resolution: LDAP groups → role (admin / agent / user); a dev fallback maps certain
usernames (e.g. `dev`) to admin so the whole flow stays testable without a directory.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.auth.deps import get_current_user
from app.core.config import SETTINGS

ROLES = ("admin", "agent", "user")


def get_groups(username: str) -> list[str]:
    """LDAP group memberships (Phase 9). Empty when no directory configured."""
    if not SETTINGS.ldap_url:
        return []
    try:
        from ldap3 import ALL, Connection, Server

        server = Server(SETTINGS.ldap_url, get_info=ALL, connect_timeout=5)
        conn = Connection(server, user=SETTINGS.ldap_bind_dn, password=SETTINGS.ldap_bind_password, auto_bind=True)
        conn.search(SETTINGS.ldap_base_dn, SETTINGS.ldap_user_filter.format(username=username),
                    attributes=["memberOf"])
        member_of = (conn.entries[0].memberOf.value if conn.entries and hasattr(conn.entries[0].memberOf, "value") else "")
        return [g.split(",")[0].replace("CN=", "") for g in (member_of or "").split(",") if g]
    except Exception:
        return []


def get_role(username: str) -> str:
    """Resolve role for a username (admin > agent > user).

    v0.21.57 — an admin-set `role_override` in the users table wins over LDAP
    groups, so the RBAC matrix + page gating follow what the admin assigned in
    the Users page. Falls back to LDAP-group resolution when there is no row or
    override (never breaks login when the DB is unreachable).
    """
    if not SETTINGS.rbac_enabled:
        return "admin"
    if username in {u.strip() for u in SETTINGS.dev_admin_usernames.split(",") if u.strip()}:
        return "admin"
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT role_override FROM users WHERE username = :u"), {"u": username}
            ).first()
        if row and row.role_override:
            return row.role_override
    except Exception:
        pass
    groups = set(get_groups(username))
    if groups & {g.strip() for g in SETTINGS.rbac_admin_groups.split(",") if g.strip()}:
        return "admin"
    if groups & {g.strip() for g in SETTINGS.rbac_agent_groups.split(",") if g.strip()}:
        return "agent"
    return "user"


def _parse_role_domains() -> dict[str, set[str]]:
    """'role=domains;role2=domains2' → {role: {'a', ...}} ('*' → all)."""
    out: dict[str, set[str]] = {}
    for chunk in SETTINGS.role_domains.split(";"):
        if "=" not in chunk:
            continue
        role, domains = chunk.split("=", 1)
        out[role.strip()] = {d.strip() for d in domains.split(",") if d.strip()}
    return out


def allowed_domains(role: str) -> set[str] | None:
    """Domains a role may access; None = all (admin / '*')."""
    if role == "admin":
        return None
    mapping = _parse_role_domains()
    domains = mapping.get(role, set())
    if "*" in domains:
        return None
    return domains


def require_role(*roles: str):
    """FastAPI dependency factory — returns the role or 403 if the user lacks one."""
    _ROLE_LABEL = {"admin": "Administrator", "agent": "IT Support",
                   "knowledge": "Knowledge Manager", "user": "User"}

    def dependency(user: str = Depends(get_current_user)) -> str:
        role = get_role(user)  # already override-aware (v0.21.57)
        if role not in roles:
            need = "/".join(_ROLE_LABEL.get(r, r) for r in roles)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your role ({_ROLE_LABEL.get(role, role)}) cannot do this — requires {need}. Please contact your administrator.",
            )
        return role

    return dependency


def jira_route(domain: str | None) -> dict:
    """Per-domain Jira routing: domain → {project, assignee}. Falls back to defaults."""
    project, assignee = None, None
    for chunk in SETTINGS.domain_jira_routing.split(";"):
        if "=" not in chunk:
            continue
        d, rest = chunk.split("=", 1)
        if d.strip() == (domain or ""):
            parts = [p.strip() for p in rest.split(",")]
            project = parts[0] if len(parts) > 0 else None
            assignee = parts[1] if len(parts) > 1 else None
            break
    return {"project": project, "assignee": assignee}


# --- v0.21.57 — effective role (role_override aware) + capability enforcement -----

# Canonical capability ids shown in the admin RBAC matrix.
CAPABILITIES = {
    "chatbot": "Ask the AI assistant",
    "kb_search": "Search knowledge base",
    "create_tickets": "Create & escalate tickets",
    "manage_kb": "Manage knowledge base (sync, write-back)",
    "manage_users": "Manage users, roles & settings",
}

# Map the internal role (admin/agent/user + knowledge) to the matrix display role.
_MATRIX_ROLE_FOR = {
    "admin": "Administrator",
    "agent": "IT Support",
    "knowledge": "Knowledge Manager",
    "user": "User",
}

_DEFAULT_MATRIX = {
    "Administrator": {"chatbot": True, "kb_search": True, "create_tickets": True, "manage_kb": True, "manage_users": True},
    "IT Support": {"chatbot": True, "kb_search": True, "create_tickets": True, "manage_kb": False, "manage_users": False},
    "Knowledge Manager": {"chatbot": True, "kb_search": True, "create_tickets": False, "manage_kb": True, "manage_users": False},
    "User": {"chatbot": True, "kb_search": True, "create_tickets": False, "manage_kb": False, "manage_users": False},
}


def effective_role(username: str) -> str:
    """role_override from the users table wins; otherwise LDAP-group role.

    Fast path: no LDAP round-trip when an override exists.
    """
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT role_override, status FROM users WHERE username = :u"),
                {"u": username},
            ).first()
        if row and row.role_override:
            return row.role_override
    except Exception:
        pass
    return get_role(username)


def _stored_matrix() -> dict:
    """Admin-editable matrix from the rbac_matrix table (merged over defaults)."""
    matrix = {r: dict(p) for r, p in _DEFAULT_MATRIX.items()}
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            rows = s.execute(_t("SELECT role, permissions FROM rbac_matrix")).mappings().all()
        for r in rows:
            perms = r["permissions"] or {}
            if r["role"] in matrix:
                matrix[r["role"]] = {**matrix[r["role"]], **perms}
    except Exception:
        pass
    return matrix


def _group_permissions(username: str) -> dict | None:
    """Highest-privilege app_group the user belongs to → its role+extra caps.

    v0.21.58 — groups carry a role and optional extra permissions; a user's
    effective access is the best of (personal role_override, group role)."""
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            rows = s.execute(_t(
                "SELECT g.role, g.permissions FROM app_groups g "
                "JOIN app_group_members m ON m.group_name = g.name "
                "WHERE m.username = :u"
            ), {"u": username}).mappings().all()
    except Exception:
        return None
    if not rows:
        return None
    rank = {"admin": 3, "agent": 2, "knowledge": 2, "user": 1}
    best = max(rows, key=lambda r: rank.get(r["role"], 1))
    extra = best["permissions"] or {}
    return {"role": best["role"], "extra": extra}


def permissions_for(username: str) -> dict:
    """{capability: bool} — role matrix, raised by group extras, then per-user overrides."""
    role = effective_role(username)
    display = _MATRIX_ROLE_FOR.get(role, "User")
    matrix = _stored_matrix()
    perms = dict(matrix.get(display, matrix["User"]))

    # group extras can raise individual caps
    grp = _group_permissions(username)
    if grp:
        grow = _MATRIX_ROLE_FOR.get(grp["role"], "User")
        gmatrix = _stored_matrix().get(grow, {})
        for k, v in gmatrix.items():
            if v:
                perms[k] = True
        for k, v in grp["extra"].items():
            if v:
                perms[k] = True

    # explicit per-user overrides win
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT permissions FROM user_permission_overrides WHERE username = :u"),
                {"u": username},
            ).first()
        if row and row.permissions:
            for k, v in row.permissions.items():
                perms[k] = bool(v)
    except Exception:
        pass
    return perms


def is_disabled(username: str) -> bool:
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT status FROM users WHERE username = :u"), {"u": username}
            ).first()
        return bool(row and row[0] == "Disabled")
    except Exception:
        return False


def require_cap(capability: str, label: str | None = None):
    """FastAPI dependency factory: gate an endpoint on a capability.

    On failure returns a clear 403 message the UI can show verbatim:
    "Your role (User) does not have permission: Create & escalate tickets."
    """
    from fastapi import Depends as _Depends

    def _dep(user: str = _Depends(get_current_user)) -> str:
        perms = permissions_for(user)
        if not perms.get(capability, False):
            role = _MATRIX_ROLE_FOR.get(effective_role(user), "User")
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Your role ({role}) does not have permission: "
                    f"{label or CAPABILITIES.get(capability, capability)}. "
                    "Please contact your administrator."
                ),
            )
        return user

    return _dep


def require_admin(user: str = Depends(get_current_user)) -> str:
    if effective_role(user) != "admin":
        raise HTTPException(
            status_code=403,
            detail="Administrator permission required: Manage users, roles & settings.",
        )
    return user
