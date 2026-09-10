"""LGTM stack integration — cluster & app status NL queries (v1.1.9).

User asks in natural language: "is the backend healthy?" / "which pods are down?"
Backend queries Prometheus (LGTM's Prometheus) via HTTP — no kubectl needed in-pod.

Config: PROM_URL / LOKI_URL constants (LGTM VM 10.10.10.18).
"""
from __future__ import annotations

import logging
import time
import urllib.parse

import httpx

logger = logging.getLogger("lgmt")

PROM_URL = "http://10.10.10.18:9090"
LOKI_URL = "http://10.10.10.18:3100"


def prom_instant(query: str) -> list:
    """Instant Prometheus query → result list."""
    url = f"{PROM_URL}/api/v1/query?query=" + urllib.parse.quote(query)
    with httpx.Client(timeout=6) as c:
        r = c.get(url)
        r.raise_for_status()
        data = r.json()
    return data.get("data", {}).get("result", [])


def _scalar(query: str, default=0) -> int:
    try:
        r = prom_instant(query)
        return int(float(r[0]["value"][1])) if r else default
    except Exception as exc:
        logger.debug("prom query failed (%s): %s", query, exc)
        return default


def cluster_health_summary() -> dict:
    """Aggregate K8s + app health for NL responses."""
    return {
        "backend_live_pods": _scalar('sum(up{job="prometheus.scrape.chatbot_backend"} == bool 1)'),
        "restarts_1h": _scalar('sum(increase(kube_pod_container_status_restarts_total{namespace="rag-chatbot"}[1h]))'),
        "pods_running": _scalar('count(kube_pod_status_phase{namespace="rag-chatbot", phase="Running"} == 1)'),
        "pods_pending": _scalar('count(kube_pod_status_phase{namespace="rag-chatbot", phase="Pending"} == 1)'),
        "pods_failed": _scalar('sum(kube_pod_status_phase{namespace="rag-chatbot", phase="Failed"} == 1) or vector(0)'),
        "nodes_ready": _scalar('sum(kube_node_status_condition{condition="Ready", status="true"} == 1)'),
    }


def summarize_cluster_health(h: dict) -> str:
    lines = [
        f"Kubernetes cluster: {h.get('nodes_ready', '?')} nodes ready",
        f"rag-chatbot namespace: {h.get('pods_running', '?')} pods running, "
        f"{h.get('restarts_1h', 0)} restarts in the last hour",
        f"Backend API: {h.get('backend_live_pods', '?')} live pods",
    ]
    if h.get("pods_failed", 0) > 0:
        lines.append(f"WARNING: {h['pods_failed']} failed pods detected")
    return "\n".join(lines)