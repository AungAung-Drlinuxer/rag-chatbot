"""LDAP/AD authentication (ldap3) with a dev fallback when no LDAP is configured.

Design doc Phase 2 auth: desktop login → backend validates against LDAP/AD → JWT.
When `ldap_url` is empty (dev/on-prem without a directory), a dev user is accepted
(`auth_dev_user` / password `dev`) so the full flow is testable end-to-end.
"""
from __future__ import annotations

import logging

from app.config import SETTINGS

logger = logging.getLogger("auth")

import os
DEV_PASSWORD = os.environ.get("DEV_PASSWORD", "Pwint@160320")


def authenticate(username: str, password: str) -> str | None:
    """Validate credentials.

    Returns:
      "<username>"          — authenticated OK
      "disabled:<username>" — AD bind succeeded but the account is admin-disabled
      "pending:<username>"  — AD bind OK, awaiting registration approval
      None                  — wrong credentials / user unknown / directory error
    """
    if not username or not password:
        return None

    # v0.21.58 — LOCAL user credentials first (admin-set passwords). LDAP users are
    # NOT in this table and continue to AD below.
    try:
        import hashlib
        import hmac as _hmac

        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as _s:
            row = _s.execute(
                _t("SELECT password_hash FROM local_user_credentials WHERE username = :u"),
                {"u": username},
            ).first()
        if row:
            try:
                salt, digest = row.password_hash.split("$", 1)
                ok = _hmac.compare_digest(
                    _hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest(), digest
                )
            except Exception:
                ok = False
            if ok:
                logger.info("local credential login for %s", username)
                return username
            logger.warning("local credential login failed for %s", username)
            return None
    except Exception as _e:
        logger.warning("local credential check skipped: %s", _e)

    # v0.20.11 — dev backdoor works regardless of LDAP config (explicit allowlist),
    # so local/dev testing never breaks when a directory is present.
    if username == SETTINGS.auth_dev_user and password == DEV_PASSWORD:
        logger.warning("dev backdoor login for %s", username)
        return username

    if not SETTINGS.ldap_url:
        logger.warning("dev auth failed for %s (ldap not configured)", username)
        return None

    return _ldap_authenticate(username, password)


def _ldap_authenticate(username: str, password: str) -> str | None:
    """Bind to LDAP/AD: service-bind → search user DN → rebind as user (verify password).

    v0.20.9 — resilient bind: if the service bind fails (bad DN format/password), fall
    back to a direct UPN user bind (username@drlinuxer.com style), which AD accepts
    without a prior search. Keeps login working while the service account is sorted out.
    """
    from ldap3 import ALL, Connection, Server

    server = Server(SETTINGS.ldap_url, get_info=ALL, connect_timeout=5)
    try:
        # 1) bind as service account to search the directory
        svc = Connection(server, user=SETTINGS.ldap_bind_dn,
                         password=SETTINGS.ldap_bind_password, auto_bind=False)
        if svc.bind():
            # v0.21.2: strip a UPN suffix if typed, and match either sAMAccountName
            # or userPrincipalName so both "aungaung" and "AungAung@drlinuxer.com" work.
            base_user = username.split("@")[0]
            user_filter = (
                f"(|(sAMAccountName={base_user})(userPrincipalName={username}))"
                if "@" in username
                else SETTINGS.ldap_user_filter.format(username=username)
            )
            svc.search(SETTINGS.ldap_base_dn, user_filter,
                       attributes=["sAMAccountName", "mail", "department",
                                   "userPrincipalName"])
            if not svc.entries:
                logger.warning("LDAP user %s not found", username)
                return None
            entry = svc.entries[0]
            user_dn = entry.entry_dn
            # canonical identity = sAMAccountName (stable for roles/audit)
            canonical = str(entry.sAMAccountName) if entry.sAMAccountName else username
            # 2) rebind as the user to verify the password — try DN first, then UPN
            upn = str(entry.userPrincipalName) if entry.userPrincipalName else None
            bound = False
            for bind_as in (user_dn, upn):
                if not bind_as:
                    continue
                with Connection(server, user=bind_as, password=password) as uc:
                    if uc.bind():
                        bound = True
                        break
            if not bound:
                logger.warning("LDAP user bind failed for %s (52e-style)", username)
                return None
            # v0.21.6 — upsert into the local users table so the user appears in
            # /api/users alongside AD accounts. Role defaults to 'user'; admin/agent
            # promotion happens via the it-help-admins / it-help-agents AD groups.
            # v0.21.7 — admin-controlled status + role_override
            try:
                from sqlalchemy import text as _t

                from app.auth.rbac import get_role
                from app.persistence.database import SessionLocal
                with SessionLocal() as s:
                    row = s.execute(_t(
                        "SELECT role_override, status FROM users WHERE username = :u"
                    ), {"u": canonical}).first()
                    if row and row.status == "Disabled":
                        logger.warning("login blocked for %s (status=Disabled)", canonical)
                        return f"disabled:{canonical}"
                    if row and row.status == "Pending":
                        # v0.21.96 — registration flow: LDAP identity verified but the
                        # account is still awaiting admin approval → clear signal, no token.
                        logger.info("login pending registration approval for %s", canonical)
                        return f"pending:{canonical}"
                    if not row:
                        # v0.21.96 — LDAP integration must NOT auto-add users. First-ever
                        # AD bind creates a Pending stub so admins see the request in the
                        # Users page, but login stays blocked until they approve it.
                        s.execute(_t(
                            "INSERT INTO users (username, ldap_dn, department, status, last_seen) "
                            "VALUES (:u, :dn, :dept, 'Pending', NOW()) "
                            "ON CONFLICT (username) DO NOTHING"
                        ), {"u": canonical, "dn": user_dn,
                            "dept": (str(entry.department) if entry.department else None)})
                        s.commit()
                        logger.info("LDAP first-seen %s → Pending (registration required)", canonical)
                        return f"pending:{canonical}"
                    # Active user — refresh last_seen only (role comes from RBAC groups)
                    s.execute(_t(
                        "UPDATE users SET last_seen = NOW() WHERE username = :u"
                    ), {"u": canonical})
                    s.commit()
            except Exception as _exc:
                logger.debug("users status/role check skipped: %s", _exc)
            return canonical

        # service bind failed — log it, then fall through to UPN direct bind
        logger.warning("LDAP service bind failed (%s); trying UPN user bind",
                       svc.result.get("description"))
    except Exception as exc:
        logger.warning("LDAP service bind error (%s); trying UPN user bind",
                       type(exc).__name__)

    # UPN direct bind — AD resolves username@domain without a search
    upn = f"{username}@{SETTINGS.ldap_upn_suffix}" if SETTINGS.ldap_upn_suffix else None
    if not upn:
        return None
    try:
        with Connection(server, user=upn, password=password) as uc:
            if uc.bind():
                logger.info("LDAP UPN bind OK for %s", username)
                # v0.21.96 — registration gate mirrors the search path
                try:
                    from sqlalchemy import text as _t
                    from app.persistence.database import SessionLocal
                    base = username.split("@")[0]
                    with SessionLocal() as s:
                        row = s.execute(_t("SELECT status FROM users WHERE username IN (:a, :b)"),
                                        {"a": base, "b": username}).first()
                        if row and row.status == "Disabled":
                            return f"disabled:{base}"
                        if not row or row.status == "Pending":
                            s.execute(_t(
                                "INSERT INTO users (username, ldap_dn, status, last_seen) "
                                "VALUES (:u, :dn, 'Pending', NOW()) "
                                "ON CONFLICT (username) DO UPDATE SET last_seen = NOW()"
                            ), {"u": base, "dn": None})
                            s.commit()
                            return f"pending:{base}"
                except Exception:
                    pass
                return username.split("@")[0]
            logger.warning("LDAP UPN bind failed for %s (%s)", username,
                           uc.result.get("description"))
    except Exception as exc:
        logger.warning("LDAP UPN bind error (%s): %s", type(exc).__name__, exc)
    return None
