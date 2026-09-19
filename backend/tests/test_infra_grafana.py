"""Grafana / LGTM rendering and routing — the regression suite for both.

WHY THESE EXIST
"Loki က label ဘာတွေရှိလဲ" reached the user as "infrastructure lookup failed — no live
data" while the evidence card on the same screen showed a successful 290-byte call. Three
separate faults had to line up for that, and each one is pinned here so it cannot come back:

  1. `list_loki_label_names` was not in the tool set the model could see.
  2. `_deterministic_lookup` is Kubernetes-only, so it declined every Grafana question —
     there was no fallback path at all.
  3. Nothing rendered Grafana's payload shapes, so even a successful call had no way to
     become an answer.

Run inside the pod:
  kubectl -n rag-chatbot exec -i <backend-pod> -c backend -- \
    sh -c 'cat > /tmp/test_infra_grafana.py && cd /app && python -m pytest /tmp/test_infra_grafana.py -q'
"""
import json

from app.mcp.infra_agent import (
    GRAFANA_CURATED_TOOLS,
    curated_for,
    summarise_grafana,
)

# ---------------------------------------------------------------- rendering


def test_datasources_render_as_a_table():
    raw = json.dumps({"datasources": [
        {"id": 2, "uid": "dfxmyb02uggzka", "name": "Loki", "type": "loki", "isDefault": False},
        {"id": 1, "uid": "dfxmyazv2ru9sf", "name": "Prometheus", "type": "prometheus", "isDefault": True},
    ], "total": 2})
    out = summarise_grafana(raw)
    assert out is not None
    assert "**2 datasource(s)**" in out
    assert "| Name | Type | UID | Default |" in out
    assert "Prometheus" in out and "prometheus" in out
    assert "| yes |" in out or "yes" in out


def test_datacource_health_renders_status():
    raw = json.dumps({"results": [
        {"uid": "a", "name": "Loki", "type": "loki", "status": "OK",
         "message": "Data source successfully connected."},
    ]})
    out = summarise_grafana(raw)
    assert out is not None
    assert "**1 datasource(s) checked**" in out
    assert "OK" in out and "Loki" in out


def test_label_list_renders_with_a_count_and_kind():
    out = summarise_grafana(json.dumps(["container", "filename", "namespace", "pod"]), "labels")
    assert out is not None
    assert "**4 label(s)**" in out
    assert "`container`" in out and "`namespace`" in out
    # the same array under a different kind must say so, not claim to be labels
    assert "metric(s)" in summarise_grafana(json.dumps(["up", "down"]), "metrics")


def test_empty_alert_groups_says_nothing_is_firing():
    out = summarise_grafana(json.dumps({"alertGroups": []}))
    assert out is not None
    assert "0 alert group(s)" in out


def test_instant_query_series_render_metric_labels_value():
    raw = json.dumps({"data": [
        {"metric": {"__name__": "up", "job": "prometheus", "instance": "localhost:9090"},
         "value": [1789790917.316, "1"]},
    ]})
    out = summarise_grafana(raw)
    assert out is not None
    assert "**1 series**" in out
    assert "| Metric | Labels | Value |" in out
    assert "up" in out and "job=prometheus" in out


def test_kubernetes_shapes_are_declined_so_they_keep_their_own_summariser():
    """A K8s payload must NOT be handled here, or summarise_json stops being reached."""
    k8s = json.dumps({"items": [{"metadata": {"name": "pod-1"}, "status": {"phase": "Running"}}]})
    assert summarise_grafana(k8s) is None
    assert summarise_grafana("not json at all") is None
    assert summarise_grafana(json.dumps({"something": "else"})) is None


# ---------------------------------------------------------------- exposure


def test_grafana_allowlist_exposes_the_label_and_query_tools():
    """Fault 1: the tools the question needed have to be reachable."""
    for name in ("list_loki_label_names", "list_prometheus_label_names",
                 "list_prometheus_metric_names", "query_prometheus",
                 "query_loki_logs", "list_datasources"):
        assert name in GRAFANA_CURATED_TOOLS, f"{name} missing from the Grafana allowlist"


def test_grafana_uses_the_explicit_allowlist_not_the_round_robin():
    """The round-robin ranked list_incidents above list_loki_label_names."""
    catalogue = ["list_incidents", "list_snapshots", "list_loki_label_names",
                 "get_dashboard_summary", "query_prometheus"]
    picked = curated_for("grafana", catalogue)
    assert "list_loki_label_names" in picked
    assert "query_prometheus" in picked


def test_other_servers_keep_their_own_allowlists():
    """The Grafana list must not leak into the Kubernetes or Proxmox sets."""
    assert "kubernetes_list" in curated_for("rancher", ["kubernetes_list"])
    assert "list_datasources" not in curated_for("rancher", ["list_datasources"])


# ---------------------------------------------------------------- answer body


def test_markdown_without_a_table_is_not_fenced():
    """Fault 3b: a fenced body is a <pre>, so **bold** prints its asterisks.

    The Loki label list is markdown by construction but contains no table, and it arrived
    on screen as literal `**6 label(s)** | \\`container\\` · …`.
    """
    from app.mcp.infra_agent import _as_answer_body

    body = "**Loki — label names**\n\n**6 label(s)**\n\n`container` · `pod`"
    out = _as_answer_body(body, markdown=True)
    assert "```" not in out
    assert out.startswith("**Loki — label names**")


def test_raw_payloads_are_still_fenced():
    """The flag must not disable fencing for kubectl/JSON output, where backticks are literal."""
    from app.mcp.infra_agent import _as_answer_body

    raw = '{"kind": "PodList", "note": "a `backtick` and a **star** in a string value"}'
    out = _as_answer_body(raw)
    assert out.startswith("```")


def test_a_table_is_passed_through_either_way():
    from app.mcp.infra_agent import _as_answer_body

    body = "**3 datasource(s)**\n\n| Name | Type |\n|---|---|\n| Loki | loki |"
    assert "| Name | Type |" in _as_answer_body(body, markdown=True)
    assert "```" not in _as_answer_body(body, markdown=True)
