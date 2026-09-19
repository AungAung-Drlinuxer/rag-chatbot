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


def test_raw_payload_is_fenced_even_from_the_markdown_path():
    """`markdown=True` describes the caller, not every payload it returns.

    `cluster status` falls through every summariser and returns the Rancher cluster array;
    passing that through unfenced turns a readable code block into a wall of plain JSON.
    """
    from app.mcp.infra_agent import _as_answer_body

    raw = '[\n  {\n    "cpu": "18.02/48",\n    "name": "drlinuxer-prod"\n  }\n]'
    assert _as_answer_body(raw, markdown=True).startswith("```")


# ---------------------------------------------------------------- cluster reference


def test_cluster_ref_is_kubeconfig_local_on_the_kubeconfig_instance(monkeypatch=None):
    """No Rancher token -> the kubeconfig instance, which addresses this cluster that way."""
    import app.mcp.infra_agent as ia

    def fake_call(name, args):
        raise AssertionError("cluster_list must not be called in kubeconfig mode")

    # get_mcp_cfg reads SETTINGS/DB; force the mode directly through the module's import.
    import app.mcp.client as client
    real = client.get_mcp_cfg
    try:
        client.get_mcp_cfg = lambda: {"mode": "kubeconfig"}
        assert ia._cluster_ref(fake_call) == "kubeconfig:local"
    finally:
        client.get_mcp_cfg = real


def test_cluster_ref_uses_a_rancher_id_and_avoids_local():
    """Rancher mode has no kubeconfig, so the reference must be a Rancher cluster id."""
    import app.mcp.infra_agent as ia
    import app.mcp.client as client

    payload = '[{"id": "local", "name": "local"}, {"id": "c-m-k6rln5bs", "name": "drlinuxer-prod"}]'
    only_local = '[{"id": "local", "name": "local"}]'
    real = client.get_mcp_cfg
    try:
        client.get_mcp_cfg = lambda: {"mode": "rancher"}
        # Each case must start from an empty cache — the resolve is cached for 5 minutes, so
        # without this the first answer is returned for all three (which is the cache working,
        # not the resolver failing).
        ia._CLUSTER_REF_CACHE.clear()
        assert ia._cluster_ref(lambda n, a: payload) == "c-m-k6rln5bs"
        # `local` is the management cluster, not where the app runs - but it is still valid,
        # so it is the fallback rather than the string the server rejects.
        ia._CLUSTER_REF_CACHE.clear()
        assert ia._cluster_ref(lambda n, a: only_local) == "local"
        ia._CLUSTER_REF_CACHE.clear()
        assert ia._cluster_ref(lambda n, a: None) == "local"
    finally:
        client.get_mcp_cfg = real
        ia._CLUSTER_REF_CACHE.clear()


def test_cluster_ref_honours_an_explicit_setting():
    import app.mcp.infra_agent as ia
    import app.mcp.client as client

    real = client.get_mcp_cfg
    try:
        client.get_mcp_cfg = lambda: {"mode": "rancher", "cluster": "c-abc12"}
        assert ia._cluster_ref(lambda n, a: "[]") == "c-abc12"
    finally:
        client.get_mcp_cfg = real

def test_cluster_ref_is_cached_after_the_first_resolve():
    """Every deterministic question calls this, including Grafana/Proxmox ones.

    Uncached, each of those paid a cluster_list round trip just to name a cluster it would
    never use (~300 ms measured on the live server).
    """
    import app.mcp.infra_agent as ia
    import app.mcp.client as client

    real = client.get_mcp_cfg
    calls = {"n": 0}

    def counting_call(name, args):
        calls["n"] += 1
        return '[{"id": "local", "name": "local"}, {"id": "c-m-k6rln5bs", "name": "drlinuxer-prod"}]'

    try:
        client.get_mcp_cfg = lambda: {"mode": "rancher"}
        ia._CLUSTER_REF_CACHE.clear()
        first = ia._cluster_ref(counting_call)
        second = ia._cluster_ref(counting_call)
        assert first == second == "c-m-k6rln5bs"
        assert calls["n"] == 1, f"cluster_list called {calls['n']} times, expected 1"
    finally:
        client.get_mcp_cfg = real
        ia._CLUSTER_REF_CACHE.clear()


def test_a_failed_resolve_is_not_cached():
    """A transient failure must not pin the wrong cluster for five minutes."""
    import app.mcp.infra_agent as ia
    import app.mcp.client as client

    real = client.get_mcp_cfg
    tries = {"n": 0}

    def flaky_complete(name, args):
        tries["n"] += 1
        if tries["n"] == 1:
            return None                      # server briefly unhappy
        return '[{"id": "c-m-k6rln5bs", "name": "drlinuxer-prod"}]'

    try:
        client.get_mcp_cfg = lambda: {"mode": "rancher"}
        ia._CLUSTER_REF_CACHE.clear()
        assert ia._cluster_ref(flaky_complete) == "local"
        assert ia._cluster_ref(flaky_complete) == "c-m-k6rln5bs"
    finally:
        client.get_mcp_cfg = real
        ia._CLUSTER_REF_CACHE.clear()

# ---------------------------------------------------------------- connector scope


def test_an_empty_scope_means_every_server():
    """`servers: []` is an untouched picker, not a request for no servers at all.

    Getting this backwards would silently disable infrastructure answers for every client
    that sends an empty list — a failure that looks like "the tools are down".
    """
    import app.mcp.infra_agent as ia

    tok = ia.set_server_scope([])
    try:
        assert ia.server_scope() is None
        assert ia._in_scope("rancher") and ia._in_scope("grafana")
    finally:
        ia.reset_server_scope(tok)

    tok = ia.set_server_scope(None)
    try:
        assert ia.server_scope() is None
        assert ia._in_scope("anything")
    finally:
        ia.reset_server_scope(tok)


def test_a_scope_restricts_and_is_normalised():
    import app.mcp.infra_agent as ia

    tok = ia.set_server_scope(["Grafana", "grafana", "  "])
    try:
        assert ia.server_scope() == ["grafana"]
        assert ia._in_scope("grafana")
        assert not ia._in_scope("rancher")
    finally:
        ia.reset_server_scope(tok)


def test_the_scope_is_reset_even_when_the_answer_raises():
    """A scoped turn must not leak its restriction into the next question on the worker."""
    import app.mcp.infra_agent as ia

    real = ia._answer_infra_scoped
    try:
        def boom(q):
            assert ia.server_scope() == ["grafana"]     # scope in force inside the call
            raise RuntimeError("tool exploded")

        ia._answer_infra_scoped = boom
        try:
            ia.answer_infra("q", servers=["grafana"])
        except RuntimeError:
            pass
        assert ia.server_scope() is None, "scope leaked after a failed turn"
    finally:
        ia._answer_infra_scoped = real


def test_a_scoped_out_rancher_is_not_asked_for_clusters():
    """The point of the scope: a Grafana-only turn must not pay a Rancher round trip."""
    import app.mcp.infra_agent as ia
    import app.mcp.client as client

    real = client.get_mcp_cfg
    calls = {"n": 0}

    def counting_call(name, args):
        calls["n"] += 1
        return '[{"id": "c-m-k6rln5bs", "name": "drlinuxer-prod"}]'

    try:
        client.get_mcp_cfg = lambda: {"mode": "rancher"}
        ia._CLUSTER_REF_CACHE.clear()
        tok = ia.set_server_scope(["grafana"])
        try:
            ref = ia._cluster_ref(counting_call)
        finally:
            ia.reset_server_scope(tok)
        assert calls["n"] == 0, f"cluster_list called {calls['n']} times with rancher scoped out"
        assert ref == "local"
    finally:
        client.get_mcp_cfg = real
        ia._CLUSTER_REF_CACHE.clear()


def test_enabled_servers_shapes_the_picker_payload():
    import app.mcp.infra_agent as ia

    out = ia.enabled_servers()
    assert isinstance(out, list)
    for row in out:
        assert set(row) == {"name", "label", "curated"}, row
        # The picker names connectors; it has no business shipping the transport.
        # An earlier revision returned `url`, i.e. http://rancher-mcp-mgmt:8080 and
        # friends, to every admin/agent browser. Assert the ABSENCE, not just the shape.
        assert "url" not in row and "token" not in row
        assert str(row["name"]).islower()
