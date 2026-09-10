"""Grafana integration — dashboards-as-knowledge (v1.2.6).

Config in system_settings key='grafana': { base_url, api_token, enabled }

The user's design: a Grafana service-account token lets the chatbot pull the
dashboards administrators created — panels already encode the right PromQL for
each cluster, so multi-cluster / varied dashboards are covered without
hardcoding queries here.

Provides:
- is_configured()
- test_connection()
- list_dashboards()
- get_dashboard(uid)
- flatten_panels(dash) — flat list of (title, type, expr, legend)
- run_prom_query(expr) — execute against Prometheus (LGTM)
- render_panel_rows(rows, legend, unit) — markdown table
"""
from __future__ import annotations

import logging
import re
import urllib.parse

import httpx

logger = logging.getLogger("grafana")

# Prometheus (LGTM) URL for executing panel queries
PROM_URL = "http://10.10.10.18:9090"


def _cfg(key: str, default: str = "") -> str:
    """Read from system_settings 'grafana' (stripped) or SETTINGS fallback."""
    try:
        import json as _json
        from app.persistence.database import SessionLocal
        from sqlalchemy import text as _t
        with SessionLocal() as s:
            row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'grafana'")).first()
        val = row[0] if row else {}
        if isinstance(val, str):
            val = _json.loads(val)
        return str((val or {}).get(key, "") or default)
    except Exception:
        return default


def _headers() -> dict:
    tok = _cfg("api_token")
    return {"Authorization": f"Bearer {tok}"} if tok else {}


def is_configured() -> bool:
    return bool(_cfg("api_token"))


def test_connection() -> dict:
    """Verify token + list dashboards."""
    base = _cfg("base_url", "http://10.10.10.18:3000").rstrip("/")
    if not _headers():
        return {"ok": False, "detail": "No Grafana token configured"}
    try:
        with httpx.Client(timeout=8) as c:
            r = c.get(f"{base}/api/search?type=dash-db", headers=_headers())
            r.raise_for_status()
            dbs = r.json()
        return {"ok": True, "dashboards": [d.get("title") for d in dbs if isinstance(d, dict)]}
    except Exception as exc:
        return {"ok": False, "detail": f"{type(exc).__name__}: {exc}"}


def list_dashboards() -> list[dict]:
    base = _cfg("base_url", "http://10.10.10.18:3000").rstrip("/")
    if not _headers():
        return []
    try:
        with httpx.Client(timeout=8) as c:
            r = c.get(f"{base}/api/search?type=dash-db", headers=_headers())
            r.raise_for_status()
            return r.json()
    except Exception as exc:
        logger.debug("list_dashboards failed: %s", exc)
        return []


def get_dashboard(uid: str) -> dict | None:
    base = _cfg("base_url", "http://10.10.10.18:3000").rstrip("/")
    if not _headers():
        return None
    try:
        with httpx.Client(timeout=8) as c:
            r = c.get(f"{base}/api/dashboards/uid/{uid}", headers=_headers())
            r.raise_for_status()
            return r.json()
    except Exception as exc:
        logger.debug("get_dashboard(%s) failed: %s", uid, exc)
        return None


def flatten_panels(dash: dict) -> list[dict]:
    """Fully flatten dashboard panels (incl. rows) into dicts."""
    out: list[dict] = []
    panels = dash.get("dashboard", {}).get("panels", []) or []

    def walk(items):
        for p in items or []:
            if not isinstance(p, dict):
                continue
            if p.get("type") == "row":
                walk(p.get("panels") or [])
                continue
            title = p.get("title") or "Untitled"
            for t in p.get("targets") or []:
                if isinstance(t, dict) and t.get("expr"):
                    out.append({
                        "title": title,
                        "type": p.get("type", "stat"),
                        "expr": t["expr"],
                        "legend": t.get("legendFormat", ""),
                    })

    walk(panels)
    return out


def run_prom_query(expr: str) -> list:
    """Execute a PromQL instant query and return the raw result list."""
    url = f"{PROM_URL}/api/v1/query?query=" + urllib.parse.quote(expr)
    with httpx.Client(timeout=10) as c:
        r = c.get(url)
        r.raise_for_status()
        return r.json().get("data", {}).get("result", [])


def _legend_for(item_metric: dict, legend: str) -> str:
    """Resolve {{label}} placeholders in a panel legendFormat."""
    if not legend:
        # sensible default: show namespace/pod-ish identity
        return ", ".join(f"{k}={v}" for k, v in list(item_metric.items())
                         if k not in ("__name__", "job", "instance"))[:80]
    resolved = legend
    for label, value in item_metric.items():
        resolved = resolved.replace("{{" + label + "}}", str(value))
    return resolved[:100]


def render_prom_results(results: list, legend: str, max_rows: int = 12) -> str:
    """Turn Prometheus query results into a compact markdown table."""
    if not results:
        return "_No data._"
    lines = ["| Series | Value |", "|---|---|"]
    for item in results[:max_rows]:
        metric = item.get("metric", {})
        value = float(item.get("value", [0, 0])[1])
        name = _legend_for(item_metric=metric_of(item), legend=legend)
        lines.append(f"| {name} | {value:,.2f} |")
    if len(results) > max_rows:
        lines.append(f"_… {len(results) - max_rows} more series_")
    return "\n".join(lines)


def metric_of(item: dict) -> dict:
    return item.get("metric", {})


# ---------------------------------------------------------------------------
# v1.3.3 — PANEL INDEX + intent matching (natural-language pin-pointing)
# Users ask "what is the token cost?" or "select Node Exporter Full" without
# saying "grafana". We score the question against every panel title and route
# to the grafana tool when a confident match exists.
# ---------------------------------------------------------------------------

_PANEL_INDEX: list[dict] | None = None
_PANEL_INDEX_AT: float = 0.0
_PANEL_INDEX_TTL = 300.0  # 5 min cache — new dashboards appear within 5 min


def _stop_words() -> set:
    return {"the", "what", "is", "are", "show", "me", "how", "many", "much", "a",
            "an", "of", "in", "on", "for", "to", "and", "or", "please", "can",
            "you", "tell", "give", "current", "now", "right", "get", "do", "does",
            "there", "any", "from", "with", "about", "it", "this", "that"}


def panel_index(force: bool = False) -> list[dict]:
    """Cached flat index of all panels across all dashboards.

    Each entry: {dashboard_title, dashboard_uid, title, type, expr, legend}
    """
    global _PANEL_INDEX, _PANEL_INDEX_AT
    import time as _t
    now = _t.time()
    if not force and _PANEL_INDEX is not None and (now - _PANEL_INDEX_AT) < _PANEL_INDEX_TTL:
        return _PANEL_INDEX
    idx: list[dict] = []
    for d in list_dashboards():
        dash = get_dashboard(d["uid"])
        if not dash:
            continue
        for panel in flatten_panels(dash):
            if "$" in panel.get("expr", ""):
                continue
            idx.append({
                "dashboard_title": d.get("title", ""),
                "dashboard_uid": d["uid"],
                **panel,
            })
    _PANEL_INDEX = idx
    _PANEL_INDEX_AT = now
    return idx


def match_question_to_panels(question: str, top_n: int = 4) -> list[dict]:
    """Score the question against all panel titles. Returns top matches with score.

    Token-overlap scoring, stop-word filtered. Empty result = not a panel question.
    """
    q_words = {w for w in re.split(r"\W+", question.lower()) if len(w) > 2} - _stop_words()
    if not q_words:
        return []
    scored: list[dict] = []
    for entry in panel_index():
        pt_words = {w for w in re.split(r"\W+", (entry.get("title") or "").lower()) if len(w) > 2}
        overlap = q_words & pt_words
        if not overlap:
            continue
        score = len(overlap) * 2 + sum(1 for w in overlap if len(w) > 4)
        # strong bonus: dashboard title words also match (e.g. "node exporter full")
        dt_words = {w for w in re.split(r"\W+", entry.get("dashboard_title", "").lower()) if len(w) > 2}
        if q_words & dt_words:
            score += 3
        scored.append({**entry, "_score": score})
    scored.sort(key=lambda x: -x["_score"])
    return scored[:top_n]
