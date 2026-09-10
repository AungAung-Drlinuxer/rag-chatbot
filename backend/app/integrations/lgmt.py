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


def top_pods_by_cpu(namespace: str | None = None, limit: int = 5) -> list[dict]:
    """Top pods by 5m avg CPU. No namespace filter = whole cluster (auto-detect)."""
    ns = f'namespace="{ns_or_default(namespace)}"' if namespace else 'image!=""'
    q = f"topk({min(10, max(1, limit))}, sum(rate(container_cpu_usage_seconds_total{{{ns}}}[5m])) by (pod, namespace))"
    rows = []
    try:
        for item in prom_instant(q):
            m = item.get("metric", {})
            rows.append({
                "pod": m.get("pod", "?"),
                "namespace": m.get("namespace", "?"),
                "cpu_millicores": round(float(item["value"][1]) * 1000, 1),
            })
    except Exception as exc:
        logger.debug("top cpu query failed: %s", exc)
    return sorted(rows, key=lambda r: -r["cpu_millicores"])


def top_pods_by_memory(limit: int = 5) -> list[dict]:
    q = 'topk(10, sum(container_memory_working_set_bytes{image!=""}) by (pod, namespace))'
    rows = []
    try:
        for item in prom_instant(q):
            rows.append({
                "pod": item["metric"].get("pod", "?"),
                "namespace": item["metric"].get("namespace", "?"),
                "memory_mib": round(float(item["value"][1]) / 1024 / 1024, 0),
            })
    except Exception as exc:
        logger.debug("top memory query failed: %s", exc)
    return sorted(rows, key=lambda r: -r["memory_mib"])[:max(1, limit)]


def namespaces_overview() -> list[dict]:
    """Auto-detect all namespaces + pod counts + restarts 1h."""
    rows = []
    try:
        for it in prom_instant('count(kube_pod_status_phase{phase="Running"}) by (namespace)'):
            ns = it["metric"].get("namespace", "?")
            pods = int(float(it["value"][1]))
            restarts = _scalar(f'sum(increase(kube_pod_container_status_restarts_total{{namespace="{ns}"}}[1h]))')
            rows.append({"namespace": ns, "pods": pods, "restarts_1h": restarts})
    except Exception as exc:
        logger.debug("namespaces overview failed: %s", exc)
    return sorted(rows, key=lambda r: -r["pods"])


def services_overview(namespace: str | None = None) -> list[dict]:
    sel = f'namespace="{ns_or_default(namespace)}"' if namespace else ""
    rows = []
    try:
        for it in prom_instant(f'kube_service_info{{{sel}}}'):
            m = it["metric"]
            rows.append({"namespace": m.get("namespace"), "service": m.get("service"),
                         "type": "", "cluster_ip": ""})
    except Exception as exc:
        logger.debug("services overview failed: %s", exc)
    return rows


def ingress_overview() -> list[dict]:
    rows = []
    try:
        for it in prom_instant('kube_ingress_info'):
            m = it["metric"]
            rows.append({"namespace": m.get("namespace"), "ingress": m.get("ingress")})
    except Exception as exc:
        logger.debug("ingress overview failed: %s", exc)
    return rows


def nodes_detail() -> list[dict]:
    rows = []
    try:
        for it in prom_instant('kube_node_info'):
            n = it["metric"].get("node", "?")
            cpu = _scalar(f'kube_node_status_allocatable{{node="{n}", resource="cpu"}}')
            mem = _scalar(f'kube_node_status_allocatable{{node="{n}", resource="memory"}}')
            ready = _scalar(f'kube_node_status_condition{{node="{n}", condition="Ready", status="true"}}')
            rows.append({"node": n, "cpu_cores": cpu, "memory_gb": round(mem_gb(mem), 1) if mem_gb(mem) else None,
                         "ready": bool(ready)})
    except Exception as exc:
        logger.debug("nodes detail failed: %s", exc)
    return rows


def ns_or_default(namespace: str | None) -> str:
    return namespace or "rag-chatbot"


def mem_gb(b: float) -> float:
    return b / 1024 / 1024 / 1024


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