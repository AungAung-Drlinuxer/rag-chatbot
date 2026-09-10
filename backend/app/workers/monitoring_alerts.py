"""Monitoring alert notifications (v1.1.9).

Phase 4 — Zabbix/LGTM alert status delivered both in-app and by email.

Design:
- Celery beat runs `check_monitoring_alerts` every 5 minutes.
- Pulls Zabbix active problems + LGTM cluster health.
- NEW problems (not seen in previous checks — tracked by source_id uniqueness) are:
  1. Persisted to `monitoring_alerts` (in-app notification source)
  2. Emailed via app.notifier.send_alert (admins) on High/Disaster severity
- In-app: NotificationBell polls /api/monitoring/alerts.
"""
from __future__ import annotations

import logging
import time

from app.persistence.database import SessionLocal
from app.persistence.models import MonitoringAlert

try:
    from workers.celery_app import celery_app

    @celery_app.task(name="workers.monitoring_alerts.check_monitoring_alerts")
    def _task_check_monitoring():
        return check_monitoring_alerts()
except Exception:
    pass  # standalone import (tests) — celery not required

logger = logging.getLogger("monitoring")


def check_monitoring_alerts() -> dict:
    """Periodic check — create rows for NEW problems, email admins for high severity."""
    created = 0
    emailed = 0

    with SessionLocal() as s:
        seen_ids: set[str] = {
            r[0] for r in s.query(MonitoringAlert.external_id).filter(
                MonitoringAlert.source == "zabbix").all()
        }

        # --- Zabbix problems ------------------------------------------------
        try:
            from app.integrations import zabbix as zb
            if zb.is_configured():
                for p in zb.client().problems():
                    pid = f"zabbix:{p['name']}"
                    if pid in seen_ids:
                        continue
                    alert = MonitoringAlert(
                        source="zabbix",
                        external_id=pid,
                        severity=int(p.get("severity", 0)),
                        name=p["name"],
                        status="active",
                    )
                    s.add(alert)
                    s.commit()
                    s.refresh(alert)
                    seen_ids.add(pid)
                    created += 1
                    # email on High/Disaster
                    if int(p.get("severity", 0)) >= 4:
                        _email_admins(alert)
                        emailed += 1
        except Exception as exc:
            logger.warning("monitoring: zabbix check skipped (%s)", exc)

        # --- LGTM cluster health (only alert on total failure) --------------
        try:
            from app.integrations.lgmt import cluster_health_summary
            h = cluster_health_summary()
            if h.get("pods_failed", 0) > 0 or h.get("backend_live_pods", 1) == 0:
                alert = MonitoringAlert(
                    source="lgtm",
                    external_id=f"lgtm:backend-down:{int(time.time() // 300)}",
                    severity=5,
                    name=f"Backend down — {h.get('backend_live_pods', 0)} live pods",
                    status="active",
                )
                s.add(alert)
                s.commit()
                _email_admins(alert)
                emailed += 1
        except Exception as exc:
            logger.debug("monitoring: lgtm check skipped (%s)", exc)

    return {"new": created, "emailed": emailed}


def _email_admins(alert: MonitoringAlert) -> None:
    try:
        from app.notifier import send_alert
        send_alert(
            "monitoring_alert",
            f"[iTH] {alert.name[:100]}",
            f"Source: {alert.source}\nSeverity: {alert.severity}\n"
            f"Detail: {alert.name}\n\nView in chatbot: Monitoring panel.",
            to_admins=True,
        )
    except Exception as exc:
        logger.debug("monitoring email failed: %s", exc)