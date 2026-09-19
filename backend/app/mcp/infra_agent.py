"""Phase 1 — a bounded ReAct loop over a CURATED set of MCP infrastructure tools.

WHY CURATED, NOT EVERYTHING
The Rancher MCP server registers 19 tools (and the Proxmox one ~96). Tool-selection
accuracy collapses as the count grows, and every schema is tokens spent on every
request. So this exposes a short list that maps to the questions an IT help desk
actually gets asked, and nothing else.

READ-ONLY
The MCP server is deployed with read_only=true / disable_destructive=true, so no
tool here can mutate anything even if the model picks badly. Writes would go
through the existing HITL approval gate, not through this loop.

BOUNDED
Max `mcp_max_steps` LLM/tool round-trips, a hard timeout per tool call, and a
truncation of tool output. A wrong turn costs a few seconds, not a hung request.
"""
from __future__ import annotations

import json
import logging
import contextvars
import re
import time

from app.config import SETTINGS
from app.mcp.client import get_client

logger = logging.getLogger("mcp.infra")

# The toolset handed to the model. Chosen so each one answers a real question:
#   "what clusters are there"      -> cluster_list
#   "is anything broken"           -> kubernetes_workload_health, kubernetes_events
#   "why did this pod fail"        -> kubernetes_logs, kubernetes_describe
#   "what is under pressure"       -> kubernetes_top, kubernetes_capacity
# v1.6.65 — per-turn tool-call record.
#
# A KB answer can show its sources; a live-infrastructure answer has nothing to show
# unless the calls themselves are recorded. A ContextVar keeps this correct under
# concurrency (the same process serves many chats) and needs no plumbing through
# every function signature.
_TOOL_CALLS: contextvars.ContextVar[list | None] = contextvars.ContextVar(
    "mcp_tool_calls", default=None)


def _begin_call_log() -> list:
    log: list = []
    _TOOL_CALLS.set(log)
    return log


def _record_call(name: str, ms: int, nbytes: int, server: str = "") -> None:
    log = _TOOL_CALLS.get()
    if log is None:
        return
    log.append({
        "name": name,
        "ms": int(ms),
        "bytes": int(nbytes),
        "server": server or "mcp",
        "at": time.strftime("%H:%M:%S"),
    })


CURATED_TOOLS: tuple[str, ...] = (
    "cluster_list",
    "kubernetes_list",
    "kubernetes_workload_health",
    "kubernetes_events",
    "kubernetes_logs",
    "kubernetes_describe",
    "kubernetes_top",
    "kubernetes_capacity",
)

# Proxmox VE — TIER-1 READS ONLY.
#
# Proxmox can destroy virtual machines, and the Kubernetes cluster this app runs on
# is itself hosted on that Proxmox, so a wrong call here could take out the platform
# serving the chatbot. Three independent layers keep that from happening:
#   1. the server process is deployed with its destructive env gate CLOSED, and the
#      package enforces that in code before any HTTP request leaves the pod
#   2. only the read tools below are ever handed to the model
#   3. MUTATING_RE is a belt-and-braces filter applied on top of (2), so version
#      drift that renames a tool cannot silently expose a write by matching a stale
#      allowlist entry
# Names taken from the server's ACTUAL catalogue (measured: 42 tools at 0.5.1 — the
# README advertises 96 for 0.11.0, so the allowlist was written against reality, not
# documentation). Every entry below is a pure read.
PROXMOX_CURATED_TOOLS: tuple[str, ...] = (
    "proxmox_status",
    "proxmox_list_vms",
    "proxmox_list_containers",
    "proxmox_get_resource",
    "proxmox_get_vm_config",
    "proxmox_get_container_config",
    "proxmox_list_storage",
    "proxmox_list_snapshots",
    "proxmox_list_backups",
    "proxmox_list_templates",
    "proxmox_resource_usage",
    "proxmox_recent_tasks",
    "proxmox_get_task_status",
    "proxmox_service_status",
    "proxmox_guest_network",
    "proxmox_audit_permissions",
)

# Second gate on top of the curated allowlists: a tool must ALSO not match this.
#
# It is a deny-list rather than a "mutating verb" list because the first attempt at
# that was wrong in both directions — measured against the server's real catalogue:
#   MISSED  proxmox_read_file            (reads inside a guest filesystem)
#   MISSED  proxmox_cleanup_smoke_resources  (deletes resources; "cleanup" is a verb)
#   FALSE   proxmox_list_snapshots       (a READ that merely has "snapshot" as a noun)
# So this matches on the operation, not on any occurrence of a word. Anything read
# from inside a guest is refused too: that is host/tenant data, not inventory.
DENY_TOOLS_RE = re.compile(
    r"(destroy|delete|remove|create|clone|migrate|resize|rollback|restore|"
    r"cleanup|reboot|shutdown|suspend|resume|"
    r"force_stop|start_resource|stop_resource|"
    r"service_start|service_stop|service_restart|run_backup|"
    r"snapshot_resource|provision|"
    r"write|exec|read_file|list_directory|stat_path|upload|download|"
    r"set[_-]|update|enable|disable|next_vmid|validate|wait_task)",
    re.IGNORECASE,
)

# Grafana / LGTM: the questions an operator actually asks of an observability stack.
#
# WHY AN EXPLICIT LIST RATHER THAN THE ROUND-ROBIN FALLBACK
# The dynamic rule (verb rank, then shortest name) produced a balanced-looking 18, but it
# ranked `list_incidents` and `list_snapshots` above `list_loki_label_names` and never
# selected `list_prometheus_metric_names` at all. Measured: "Loki က label ဘာတွေရှိလဲ"
# therefore had NO path — the label tool was not exposed to the model, the deterministic
# lookup declined the question, and the answer collapsed to "lookup failed — no live data"
# while the evidence card showed a successful 290-byte call to list_datasources.
#
# Every entry here exists to answer a question family, not to fill a quota:
#   datasource/health  -> what is configured, is it reachable
#   loki labels/logs   -> what labels exist, what do the logs say
#   prometheus         -> what labels/metrics exist, run an instant query
#   alerting/incident  -> what is firing
#   dashboard/search   -> where is the panel, where is the thing
GRAFANA_CURATED_TOOLS: tuple[str, ...] = (
    "list_datasources",
    "check_datasources_health",
    "get_datasource",
    "list_loki_label_names",
    "list_loki_label_values",
    "query_loki_logs",
    "query_loki_stats",
    "analyze_loki_labels",
    "list_prometheus_label_names",
    "list_prometheus_label_values",
    "list_prometheus_metric_names",
    "list_prometheus_metric_metadata",
    "query_prometheus",
    "list_alert_groups",
    "list_alert_rules",
    "list_incidents",
    "search_dashboards",
    "get_dashboard_summary",
    "search_folders",
)

CURATED_BY_SERVER: dict[str, tuple[str, ...]] = {
    "rancher": CURATED_TOOLS,
    "proxmox": PROXMOX_CURATED_TOOLS,
    "grafana": GRAFANA_CURATED_TOOLS,
}

# For a connector an administrator added, there is no hand-written allowlist — so the
# exposure rule is inverted: only names that READ are considered, and anything matching a
# write verb is refused. Names are then capped, because tool-selection accuracy collapses
# as the count grows and every schema costs tokens on every request.
#
# v1.6.79 — matched on WORDS, not a single anchored regex. The first version was
# `^(?:[a-z0-9]+[_-])?(list|get|…)`, and the optional prefix greedily ate the verb:
# "list_alert_groups" parsed as prefix "list_" + "alert" and was DROPPED as a non-read.
# Measured effect: 51 of Grafana's 65 tools were refused, including list_datasources,
# list_incidents, list_prometheus_label_names and analyze_db_health — reads an operator
# actually wants. Both real servers name tools as <namespace>_<verb>_<object>, so the rule
# is now "the verb appears in the first two words", which keeps the prefix form working
# without swallowing the verb.
_READ_VERBS = frozenset({
    "list", "get", "show", "describe", "status", "read", "search", "find", "query",
    "fetch", "inspect", "view", "recent", "top", "capacity", "health", "events", "logs",
    "info", "summary", "diff", "check", "analyze", "analyse", "explain", "test",
    "validate", "whoami", "version", "ping", "resolve", "preview", "history",
})
_CUSTOM_TOOL_CAP = 18

# Order matters when trimming to the cap. Sorting alphabetically is arbitrary and, with
# Grafana's 65 tools, it cut every `list_*` tool — the enumerable inventories an operator
# asks for first ("what datasources / alerts / incidents are there"). Ranking by verb
# first, then by name length (shorter = more general), keeps the broadly useful reads and
# drops the niche ones instead.
_VERB_RANK = {
    "list": 0, "check": 1, "analyze": 2, "analyse": 2, "explain": 2,
    "get": 3, "show": 3, "describe": 3, "status": 3, "info": 3, "summary": 3,
    "query": 4, "search": 4, "find": 4, "fetch": 4, "read": 4, "view": 4,
    "diff": 5, "logs": 5, "events": 5, "health": 5, "top": 5, "capacity": 5,
}


def _looks_like_read(name: str) -> bool:
    words = [w for w in re.split(r"[_\-.]", (name or "").lower()) if w]
    return any(w in _READ_VERBS for w in words[:2])


def _read_rank(name: str) -> tuple:
    words = [w for w in re.split(r"[_\-.]", (name or "").lower()) if w]
    best = min((_VERB_RANK.get(w, 6) for w in words[:2]), default=6)
    return (best, len(name), name)


def curated_for(server_name: str, catalogue: dict) -> tuple[str, ...]:
    """Tool names to expose for a server. Explicit allowlist, else reads only.

    Selection is ROUND-ROBIN across verb rank, not "best rank first". Filling the cap
    from the top rank alone gave Grafana 18 `list_*` tools and nothing else — inventory
    only, with no health or detail reads. Taking one per rank in turn yields a balanced
    set: several inventories, a health check, and the detail getters.
    """
    explicit = CURATED_BY_SERVER.get(server_name)
    if explicit:
        return explicit

    buckets: dict[int, list[str]] = {}
    for name in catalogue:
        if DENY_TOOLS_RE.search(name) or not _looks_like_read(name):
            continue
        buckets.setdefault(_read_rank(name)[0], []).append(name)
    for b in buckets.values():
        b.sort(key=len)  # shorter name = the more general tool

    picked: list[str] = []
    while len(picked) < _CUSTOM_TOOL_CAP and any(buckets.values()):
        for rank in sorted(buckets):
            if not buckets[rank]:
                continue
            picked.append(buckets[rank].pop(0))
            if len(picked) >= _CUSTOM_TOOL_CAP:
                break
    return tuple(picked)

# Cheap intent gate — no LLM call, same discipline as app/tools/ticket_tool.py.
#
# v1.6.73 — rebuilt after auditing 51 question forms. The old gate required one of a
# short list of nouns and only matched some of them in the singular, so `\bcluster\b`
# missed "clusters" and `\bworkload\b` missed "workloads". Eleven ordinary questions
# were declined and therefore answered from the knowledge base instead of the cluster:
#   "list the clusters" · "what clusters do you manage?" · "what is the cluster status?"
#   "what is the node capacity?" · "what is running in the rag-chatbot namespace?"
#   "is everything healthy?" · "which workloads have problems?" · "what went wrong
#   recently?" · "how much memory is being used?" · "what is using the most memory?"
#   "where is my storage going?"
# It also ACCEPTED "how do I create a deployment in kubernetes?" — a how-to for the KB.
#
# Three signals instead of one, because people rarely name the object they mean:
_INFRA_NOUN = re.compile(
    r"\b(kubeconfig|kubectl|kubernetes|k8s|clusters?|namespaces?|pods?|nodes?|"
    r"deployments?|statefulsets?|daemonsets?|replicasets?|ingress(es)?|helm|rancher|"
    r"workloads?|pvc|pvs?|volumes?|services?|secrets?|configmaps?|cronjobs?|jobs?|"
    r"events?|containers?|images?)\b",
    re.IGNORECASE,
)
# "how much memory", "what is using the most cpu" — no object named, still live.
_MEASURABLE = re.compile(
    r"\b(cpu|memory|ram|disk|storage|capacity|usage|utilisation|utilization|"
    r"requests?|limits?|restarts?|uptime|versions?|ip addresses?|ips?)\b",
    re.IGNORECASE,
)
# "is everything healthy", "what went wrong" — state of the system as a whole.
_STATE = re.compile(
    r"\b(status|state|health|healthy|unhealthy|ready|failing|down|problems?|issues?|"
    r"errors?|warnings?|wrong|broken|crash\w*|oom\w*|pending|evicted|taints?|"
    r"inventory|running|count|how many|list|show)\b",
    re.IGNORECASE,
)
# "is this about OUR estate, or about the concept?" Measured: the first version listed
# only possessives, so "how much memory is being used?" (no "my/our/the") and "show me
# cpu usage" (imperative) were both declined and answered from the knowledge base.
_SCOPE = re.compile(
    r"\b(my|our|the|everything|anything|something|this|recently|now|show|list|check|"
    r"any|current|much|many|me|we|have|is there|are there|do we)\b",
    re.IGNORECASE,
)
# Concept/how-to questions belong to the knowledge base, not the cluster. This check
# runs FIRST so a how-to that mentions "kubernetes" cannot reach the tools.
_CONCEPT = re.compile(
    r"\b(what is an?|what are|explain|define|difference between|how does|"
    r"how do i (create|deploy|install|configure|set ?up|write|build|add|enable|use|"
    r"reset|change|update)|how to |tutorial|step by step|concept|architecture of|"
    r"best practice|why should|advantages? of|benefits? of|"
    r"does an? |should i |do i need|are there any benefits)\b",
    re.IGNORECASE,
)
_LIVE_HINT = re.compile(
    r"\b(my|our|current|live|right now|status of|show me|list|check|any|are there|"
    r"how many|which|why is|why are|is there|down|failing|broken|unhealthy)\b",
    re.IGNORECASE,
)


def detect_infra_intent(question: str) -> bool:
    """True when the question is about THIS infrastructure's live state."""
    q = (question or "").strip()
    if len(q) < 4:
        return False
    # A conceptual or procedural question is never a cluster lookup, even when it names
    # kubernetes — that is what the knowledge base is for.
    if _CONCEPT.search(q):
        return False
    # Named Kubernetes object -> live.
    if _INFRA_NOUN.search(q):
        return True
    # A measurable quantity asked about *our* estate ("how much memory is being used?").
    if _MEASURABLE.search(q) and _SCOPE.search(q):
        return True
    # State of the system as a whole ("is everything healthy?", "what went wrong?").
    if _STATE.search(q) and _SCOPE.search(q):
        return True
    return False


# "what can you check / what can you do / what tools do you have" — a capability
# question, which legitimately matches no lookup tool and used to answer EMPTY.
_CAPABILITY = re.compile(
    r"(what can you (check|do|see|tell|query|access)|what (do|can) you (check|do|see)|"
    r"what (tools|checks|queries) (do you have|are available)|"
    r"what kubernetes (things|questions)|what can i ask|your capabilities|"
    r"how can you help with (kube|k8s|kube?rnetes|the cluster))",
    re.IGNORECASE,
)


def capabilities_text() -> str:
    """The live-lookup capability list, grouped by what it answers.

    Built from CURATED_TOOLS rather than prose so it cannot drift from what is actually
    reachable, and so it is honest when a server is down (it lists only what is loaded).
    """
    groups = [
        ("Cluster & nodes", ["cluster_list", "kubernetes_capacity", "kubernetes_list"]),
        ("Workload health", ["kubernetes_workload_health", "kubernetes_top"]),
        ("Diagnostics", ["kubernetes_events", "kubernetes_logs", "kubernetes_describe"]),
    ]
    loaded = set()
    try:
        loaded = {t.name for t in build_tools()}
    except Exception:  # noqa: BLE001
        pass
    lines = ["**I can read your live Kubernetes / Rancher estate (read-only).**", ""]
    for title, names in groups:
        present = [n for n in names if not loaded or n in loaded]
        if not present:
            continue
        lines.append(f"**{title}**")
        for n in present:
            lines.append(f"- `{n}`")
        lines.append("")
    lines += [
        "Ask either way — a command or plain language, both work:",
        "- `kubectl get nodes` · `kubectl get pods -n <namespace>` · `kubectl get svc`",
        "- \"are the nodes healthy?\" · \"which pods are restarting?\" · \"what is using the "
        "most memory?\" · \"what went wrong recently?\"",
        "",
        "Every tool is read-only: the service account has get/list/watch only, so nothing "
        "can be changed from here.",
    ]
    return "\n".join(lines)


def _truncate(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…[truncated, {len(text) - limit} more chars]"


def _json_schema_to_args(schema: dict):
    """Build a pydantic model from an MCP inputSchema (flat primitives only).

    The MCP schemas here are shallow (string / integer / number / boolean /
    array-of-string), so a small converter keeps this dependency-free instead of
    pulling a schema-library.
    """
    from pydantic import Field, create_model

    props = (schema or {}).get("properties") or {}
    required = set((schema or {}).get("required") or [])
    types = {
        "string": (str, ...),
        "integer": (int, ...),
        "number": (float, ...),
        "boolean": (bool, ...),
    }
    fields: dict = {}
    for key, spec in props.items():
        if not isinstance(spec, dict):
            continue
        t = spec.get("type")
        if t == "array":
            base = (spec.get("items") or {}).get("type")
            py = {"integer": int, "number": float, "boolean": bool}.get(base, str)
            ann = list[py]  # type: ignore[valid-type]
        elif t in types:
            ann = types[t][0]
        else:
            ann = str
        desc = (spec.get("description") or "")[:300]
        default = spec.get("default")
        if key in required:
            fields[key] = (ann, Field(..., description=desc))
        else:
            fields[key] = (ann | None, Field(default, description=desc))  # type: ignore[operator]
    name = "McpArgs"
    if not fields:
        return create_model(name)
    return create_model(name, **fields)


def build_tools():
    """LangChain tools across every ENABLED MCP server. Never raises.

    Tool names are namespaced upstream (`kubernetes_*` vs `proxmox_*`), so the
    catalogues concatenate without collisions. A server that is down or disabled
    simply contributes nothing.
    """
    from langchain_core.tools import StructuredTool

    from app.mcp.client import get_client, get_mcp_servers

    tools = []
    for spec in get_mcp_servers():
        if not spec.get("enabled") or not spec.get("url"):
            continue
        client = get_client(spec["name"])
        try:
            catalogue = {t.get("name"): t for t in client.list_tools()}
        except Exception as exc:  # noqa: BLE001
            logger.info("mcp[%s] catalogue unavailable: %s: %s",
                        spec["name"], type(exc).__name__, exc)
            continue
        # Explicit allowlist for the shipped servers; reads-only for a connector the
        # administrator added from the gallery.
        curated = curated_for(spec["name"], catalogue)
        if not curated:
            logger.info("mcp[%s] exposes no read tools; skipping", spec["name"])
            continue

        for name in curated:
            spec_tool = catalogue.get(name)
            if not spec_tool:
                continue  # not offered by this build; skip rather than invent
            # Belt-and-braces: never hand the model a state-changing tool, even if
            # an upstream rename made a mutating tool match the allowlist.
            if DENY_TOOLS_RE.search(name):
                logger.warning("mcp[%s] refusing non-read tool %s", spec["name"], name)
                continue
            desc = (spec_tool.get("description") or name)[:900]
            schema = spec_tool.get("inputSchema") or {}
            try:
                args_schema = _json_schema_to_args(schema)
            except Exception:  # noqa: BLE001
                continue

            def _run(_name=name, _client=client, _server=spec["name"], **kwargs):
                # Drop None so the server sees only what the model actually set.
                args = {k: v for k, v in kwargs.items() if v is not None}
                _t0 = time.monotonic()
                try:
                    # NO truncation here. The cap used to be applied inside the tool, and
                    # a JSON object list cut mid-object with a "…[truncated]" marker is no
                    # longer parseable — so the summariser returned None and the raw JSON
                    # was dumped at the user (the reported bug). Truncation now happens
                    # where the consumer needs it: the model's tool result and the answer
                    # body. The deterministic path gets the whole payload and can reduce
                    # it properly.
                    out = _client.call_tool(_name, args)
                    _record_call(_name, (time.monotonic() - _t0) * 1000, len(out), _server)
                    return out
                except Exception as exc:  # noqa: BLE001
                    _record_call(_name, (time.monotonic() - _t0) * 1000, 0, _server)
                    # Return the error as tool output: the model can recover, and the
                    # loop never dies on one bad call.
                    return f"TOOL ERROR ({_name}): {type(exc).__name__}: {str(exc)[:200]}"

            tools.append(StructuredTool.from_function(
                func=_run, name=name, description=desc, args_schema=args_schema,
            ))
    return tools


_SYSTEM = """You are an IT operations assistant with read-only access to the live
Kubernetes infrastructure. Answer the user's question using the tools; do not guess
at cluster state.

Rules:
- Call tools to gather evidence before answering. Prefer one focused call at a time.
- Tool names are exactly as given. Arguments must match the schema.
- If a call errors, adapt once, then report what you could and could not determine.
- Finish with a concise answer: what is wrong, the evidence (names, counts,
  messages), and the recommended next step. Cite the resource names you saw.
- If the tools cannot answer the question, say so plainly. Never invent resources."""


def run_infra_agent(question: str, max_steps: int | None = None) -> str:
    """Run the bounded ReAct loop. Returns the final answer text ("" on failure)."""
    from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage

    from app.llm.client import make_llm

    llm = make_llm()
    if llm is None:
        return ""
    tools = build_tools()
    if not tools:
        return ""

    steps = int(max_steps or SETTINGS.mcp_max_steps)
    by_name = {t.name: t for t in tools}
    try:
        bound = llm.bind_tools(tools)
    except Exception as exc:  # noqa: BLE001
        logger.info("model cannot bind tools: %s", exc)
        return ""

    messages: list = [
        SystemMessage(content=_SYSTEM),
        HumanMessage(content=question[:2000]),
    ]
    for step in range(steps):
        ai = bound.invoke(messages)
        messages.append(ai)
        calls = getattr(ai, "tool_calls", None) or []
        if not calls:
            return (getattr(ai, "content", "") or "").strip()
        for call in calls:
            name = call.get("name")
            args = call.get("args") or {}
            tool = by_name.get(name)
            if tool is None:
                result = f"TOOL ERROR: unknown tool {name}"
            else:
                try:
                    result = tool.invoke(args)
                except Exception as exc:  # noqa: BLE001
                    result = f"TOOL ERROR ({name}): {type(exc).__name__}"
            logger.info("mcp step %d: %s -> %d chars", step + 1, name, len(str(result)))
            # Truncate at the MODEL's boundary, not in the tool: the tool must return the
            # whole payload so the deterministic path can summarise it properly.
            messages.append(ToolMessage(content=_truncate(
                                            str(result), int(SETTINGS.mcp_max_tool_chars)),
                                        tool_call_id=call.get("id") or name))
    # Out of steps: ask for a wrap-up with whatever evidence exists.
    try:
        messages.append(HumanMessage(content="Summarise your findings now."))
        final = llm.invoke(messages)
        text = (getattr(final, "content", "") or "").strip()
        if text:
            return text
    except Exception:  # noqa: BLE001
        pass
    return ""



# ---------------------------------------------------------------------------
# Readable output: kubectl-style questions and JSON summarisation (v1.6.69)
# ---------------------------------------------------------------------------

# `kubectl get <kind>` shorthand -> the resource kind the API expects. People paste
# commands straight from their terminal ("Kubectl get nodes"), and short names/plurals
# are what they type.
_KUBECTL_KINDS: dict[str, str] = {
    "node": "Node", "nodes": "Node", "no": "Node",
    "pod": "Pod", "pods": "Pod", "po": "Pod",
    "deployment": "Deployment", "deployments": "Deployment", "deploy": "Deployment",
    "svc": "Service", "service": "Service", "services": "Service",
    "ingress": "Ingress", "ingresses": "Ingress",
    "statefulset": "StatefulSet", "statefulsets": "StatefulSet", "sts": "StatefulSet",
    "daemonset": "DaemonSet", "daemonsets": "DaemonSet", "ds": "DaemonSet",
    "namespace": "Namespace", "namespaces": "Namespace", "ns": "Namespace",
    "pvc": "PersistentVolumeClaim", "pv": "PersistentVolume",
    "configmap": "ConfigMap", "cm": "ConfigMap",
    "secret": "Secret", "secrets": "Secret",
    "job": "Job", "jobs": "Job", "cronjob": "CronJob",
    "event": "Event", "events": "Event",
}


def parse_kubectl(q: str) -> dict | None:
    """Extract intent from a pasted kubectl command. None when it is not one.

    WHY: "Kubectl get nodes" is a completely natural thing for an IT helpdesk user to
    type — it is what they already do in a terminal. Before this it matched only the
    bare word "node", fell through to kubernetes_list, and the answer was 6 KB of raw
    JSON (a Node object with its full annotations). Recognising the command shape lets
    the question reach the right tool with the right namespace.
    """
    m = re.search(r"kubectl\s+get\s+([a-zA-Z][a-zA-Z0-9-]*)", q, re.I)
    if not m:
        return None
    kind = _KUBECTL_KINDS.get(m.group(1).lower())
    if not kind:
        return None
    ns = None
    nm = re.search(r"(?:-n|--namespace[=\s])\s*([a-z0-9][a-z0-9-]*)", q, re.I)
    if nm:
        ns = nm.group(1)
    # "kubectl get pods -A" / "--all-namespaces" means every namespace.
    all_ns = bool(re.search(r"-A\b|--all-namespaces", q))
    return {"kind": kind, "namespace": ns, "all_namespaces": all_ns}


def _age(ts: str | None) -> str:
    if not ts:
        return "-"
    try:
        from datetime import datetime, timezone
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        d = int((datetime.now(timezone.utc) - t).total_seconds())
        if d < 3600: return f"{d // 60}m"
        if d < 86400: return f"{d // 3600}h"
        return f"{d // 86400}d"
    except Exception:  # noqa: BLE001
        return "-"


def _loads_tolerant(raw: str):
    """json.loads that survives a TRUNCATED object list.

    WHY: tool output is capped (mcp_max_tool_chars) so a large list arrives cut mid-
    object, json.loads raises, and the summariser returned None — which fell straight
    back to dumping the raw JSON. That is exactly the failure the summariser exists to
    prevent, so the parse has to cope with the cut rather than giving up on it.
    """
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        pass
    s = (raw or "").strip()
    if not s.startswith("["):
        return None
    depth, last = 0, -1
    in_str, esc = False, False
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                last = i
    if last > 0:
        try:
            return json.loads(s[: last + 1] + "]")
        except Exception:  # noqa: BLE001
            return None
    return None


def summarise_json(raw: str) -> str | None:
    """Turn a JSON list of Kubernetes objects into a compact readable table.

    WHY: the tools return full objects — every annotation, every managedFields entry.
    Dumping that is technically an answer and practically useless: the screenshot that
    prompted this showed a wall of JSON where a table of NAME / STATUS / ROLES / AGE was
    wanted. The verbatim payload is still available in the evidence card.
    """
    data = _loads_tolerant(raw)
    if data is None:
        return None
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        return None

    rows = []
    for o in data[:80]:
        md = o.get("metadata") or {}
        st = o.get("status") or {}
        name = md.get("name") or "?"
        kind = o.get("kind") or "?"
        # Node/pod readiness, then the phase, then nothing.
        state = ""
        for c in (st.get("conditions") or []):
            if c.get("type") in ("Ready", "ReadyForContainers"):
                state = "Ready" if str(c.get("status")) == "True" else "NotReady"
                break
        if not state:
            state = st.get("phase") or (st.get("containerStatuses") or [{}])[0].get("ready")
            state = "Ready" if state is True else ("NotReady" if state is False else (state or ""))
        if not state and st:
            # Workload kinds carry replica counts instead of a Ready condition:
            # avail/desired is what "is it healthy" actually means for a Deployment,
            # and without this every Deployment row read "Status: -".
            avail = st.get("availableReplicas")
            want = (o.get("spec") or {}).get("replicas")
            if avail is not None or want is not None:
                a, w = avail if avail is not None else 0, want if want is not None else 0
                state = f"{a}/{w}" + ("" if a == w else "  ⚠")
            elif st.get("numberReady") is not None:
                want = (o.get("spec") or {}).get("replicas")
                state = f"{st.get('numberReady')}/{want if want is not None else '?'}"
        state = state or "-"
        roles = ",".join(
            k.split("node-role.kubernetes.io/")[-1]
            for k in (md.get("labels") or {}) if "node-role.kubernetes.io/" in k
        ) or "-"
        ip = next((a.get("address") for a in (st.get("addresses") or [])
                   if a.get("type") == "InternalIP"), "-")
        ver = (st.get("nodeInfo") or {}).get("kubeletVersion") or "-"
        node = (st.get("nodeName") or (o.get("spec") or {}).get("nodeName") or "-")
        rows.append((name, kind, state, roles, ip, ver, node, _age(md.get("creationTimestamp"))))

    # Show the columns that actually carry information for this kind.
    is_node = all(r[1] == "Node" for r in rows)
    if is_node:
        head = "| Name | Status | Roles | Internal IP | Version | Age |"
        sep = "|---|---|---|---|---|---|"
        body = [f"| {r[0]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} | {r[7]} |" for r in rows]
    else:
        head = "| Name | Kind | Status | Node | Age |"
        sep = "|---|---|---|---|---|"
        body = [f"| {r[0]} | {r[1]} | {r[2]} | {r[6]} | {r[7]} |" for r in rows]

    total = len(data)
    # Name what was counted. "**6 object(s)**" made the reader work out what the six things
    # were from the table below it; "**6 Nodes**" says it up front. A mixed list keeps the
    # generic wording and names the kinds it contains.
    kinds = sorted({r[1] for r in rows if r[1] and r[1] != "?"})
    if len(kinds) == 1:
        label = kinds[0] if kinds[0].endswith("s") else kinds[0] + "s"
        heading = f"**{total} {label}**"
    elif kinds:
        heading = f"**{total} objects** — {', '.join(kinds)}"
    else:
        heading = f"**{total} objects**"
    cut = " (list was truncated at the tool-output cap)" if len(rows) >= 80 else ""
    note = (f"\n\n_Showing {len(rows)} of {total}{cut}._" if total > len(rows) or cut else "")
    return (f"{heading}\n\n{head}\n{sep}\n" + "\n".join(body) + note)


def _first_tool(tools, names: tuple[str, ...]):
    by = {t.name: t for t in tools}
    for n in names:
        if n in by:
            return by[n]
    return None


def _fmt_bytes(n) -> str:
    """Bytes -> the largest unit that keeps the number readable."""
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "?"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024:
            return f"{int(n)} B" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def _fmt_uptime(sec) -> str:
    try:
        sec = int(sec)
    except (TypeError, ValueError):
        return "?"
    d, rem = divmod(sec, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    if d:
        return f"{d}d {h}h"
    return f"{h}h {m}m" if h else f"{m}m"


def _fmt_ts(ts) -> str:
    try:
        import datetime as _dt
        return _dt.datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M")
    except (TypeError, ValueError, OSError, OverflowError):
        return "?"


def _md_table(headers: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join("---" for _ in headers) + "|"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out)


def _fmt_pair(used, total) -> str:
    """`15.3 / 16.0 GB` — one unit for both numbers.

    Not `15.3 GB / 16.0 GB`: repeating the unit in every cell of every row spent width the
    widest column needed, and the header already says what the pair means. It matters
    because the guest table carries eight columns and the widest one sets its total width.

    The loop walks the ORIGINAL total and only computes an exponent; it must not scale the
    values as it goes. An earlier version divided both inside the loop and then divided
    again by the unit exponent, so every figure came out as `0.0 / 0.0 GB` — a correct-looking
    column of zeroes that no exception would ever flag.
    """
    try:
        u = float(used)
        t = float(total)
    except (TypeError, ValueError):
        return _fmt_bytes(used) + " / " + _fmt_bytes(total)
    exps = {"B": 0, "KB": 1, "MB": 2, "GB": 3, "TB": 4}
    probe = abs(t)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if probe < 1024:
            if unit == "B":
                return str(int(u)) + " / " + str(int(t)) + " B"
            d = 1024 ** exps[unit]
            return f"{u / d:.1f} / {t / d:.1f} {unit}"
        probe /= 1024
    d = 1024 ** 5
    return f"{u / d:.1f} / {t / d:.1f} PB"


def summarise_proxmox(raw: str) -> str | None:
    """Render a Proxmox tool payload as a readable table, or None if it is not one.

    A SEPARATE FUNCTION FROM summarise_json, and the reason is measurable: that one is
    Kubernetes-shaped — it reads `metadata.name` and the workload status fields — so against
    Proxmox objects (`vmid`, `cpu`, `mem`, `maxmem`) every cell rendered as "?" and the
    answer was a table of question marks reading `| ? | ? | - | - | - |`, over 29 real VMs
    that had returned correctly. A K8s-shaped table over correct data is worse than no
    table, because it looks like the tool failed.

    It mutates nothing and returns None for anything unrecognised, so the caller can fall
    back to the raw payload.
    """
    try:
        d = json.loads(raw)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(d, dict):
        return None

    # --- nodes: proxmox_status -------------------------------------------------
    if "nodes" in d and isinstance(d.get("nodes"), list) and "version" in d:
        rows = []
        for n in d["nodes"]:
            if not isinstance(n, dict):
                continue
            cpu = n.get("cpu")
            cpu_s = f"{float(cpu) * 100:.1f}%" if isinstance(cpu, (int, float)) else "?"
            rows.append([
                str(n.get("node") or "?"),
                str(n.get("status") or "?"),
                cpu_s,
                str(n.get("maxcpu") or "?"),
                _fmt_pair(n.get('mem'), n.get('maxmem')),
                _fmt_uptime(n.get("uptime")),
            ])
        if rows:
            body = _md_table(["Node", "Status", "CPU", "Cores", "Memory", "Uptime"], rows)
            return f"PVE {d.get('version')} (release {d.get('release')})\n\n{body}"

    # --- guests: proxmox_list_vms / proxmox_list_containers ---------------------
    # Only columns that CARRY INFORMATION. On a single-node PVE every row says "pve01",
    # and this branch summarises one key at a time so a "Kind" column would be a column of
    # identical values. Eight columns is what pushed "Uptime" off the right edge of a 735px
    # bubble; six fit. A mixed payload or a multi-node cluster keeps the column, because
    # then it distinguishes rows.
    for key in ("vms", "containers"):
        items = d.get(key)
        if isinstance(items, list) and items and isinstance(items[0], dict):
            label = "VM" if key == "vms" else "container"
            multi_node = len({str(g.get("node")) for g in items if isinstance(g, dict)}) > 1
            headers = (["VMID", "Name"] + (["Node"] if multi_node else [])
                       + ["Status", "CPU", "Memory", "Uptime"])
            rows = []
            for g in items:
                if not isinstance(g, dict):
                    continue
                cpu = g.get("cpu")
                cpu_s = f"{float(cpu) * 100:.1f}%" if isinstance(cpu, (int, float)) else "?"
                name = str(g.get("name") or "?")
                if str(g.get("template")) == "1":
                    name += " (template)"
                row = [str(g.get("vmid") or "?"), name[:38]]
                if multi_node:
                    row.append(str(g.get("node") or "?"))
                row += [
                    str(g.get("status") or "?"),
                    cpu_s,
                    _fmt_pair(g.get("mem"), g.get("maxmem")),
                    _fmt_uptime(g.get("uptime")),
                ]
                rows.append(row)
            if rows:
                n = d.get("count", len(rows))
                body = _md_table(headers, rows)
                return f"**{n} {label}{'' if str(n) == '1' else 's'}**\n\n{body}"

    # --- storage: proxmox_list_storage -----------------------------------------
    # The payload is NESTED — {count, nodes: [{node, storage: [...]}]} — not the flat
    # {storage: [...]} the name suggests. Checking only the flat shape let this fall
    # through to summarise_json, which rendered the "?" table again. Flatten both.
    stor = d.get("storage")
    node_label = d.get("node") or "?"
    if not (isinstance(stor, list) and stor and isinstance(stor[0], dict)):
        stor = []
        for n in (d.get("nodes") or []):
            if isinstance(n, dict) and isinstance(n.get("storage"), list):
                stor.extend(s for s in n["storage"] if isinstance(s, dict))
        if stor:
            node_label = ", ".join(
                str(n.get("node")) for n in (d.get("nodes") or []) if isinstance(n, dict)
            ) or node_label
    if isinstance(stor, list) and stor and isinstance(stor[0], dict):
        rows = []
        for s in stor:
            frac = s.get("used_fraction")
            pct = f"{float(frac) * 100:.1f}%" if isinstance(frac, (int, float)) else "?"
            rows.append([
                str(s.get("storage") or "?"),
                str(s.get("type") or "?"),
                str(s.get("content") or "-"),
                _fmt_bytes(s.get("used")),
                _fmt_bytes(s.get("avail")),
                _fmt_bytes(s.get("total")),
                pct,
            ])
        body = _md_table(["Storage", "Type", "Content", "Used", "Available", "Total", "Use%"], rows)
        return f"**{len(rows)} datastore(s)** on {node_label}\n\n{body}"

    # --- tasks: proxmox_recent_tasks -------------------------------------------
    tasks = d.get("tasks")
    if isinstance(tasks, list) and tasks and isinstance(tasks[0], dict):
        rows = []
        for t in tasks:
            rows.append([
                _fmt_ts(t.get("starttime")),
                str(t.get("type") or "?"),
                str(t.get("id") or "-"),
                str(t.get("user") or "?"),
                str(t.get("status") or "?"),
            ])
        body = _md_table(["Started", "Type", "Target", "User", "Status"], rows)
        return f"**{d.get('count', len(rows))} recent task(s)**\n\n{body}"

    return None


def summarise_grafana(raw: str, kind: str = "") -> str | None:
    """Render a Grafana/Loki/Prometheus tool payload as a readable answer body.

    A SEPARATE FUNCTION FROM summarise_json, for the same measured reason summarise_proxmox
    is: that one is Kubernetes-shaped. It looks for `metadata.name` / `status` and renders
    anything else as a table whose every cell is "?" — over correct data. Grafana's payloads
    are their own shapes, and they are mostly LISTS: label names, label values, metric names,
    datasources. A list reflowed through the Kubernetes summariser is a wall of "?", so this
    handles the shapes the connector actually returns:

      {"datasources": [...], "total": n}     -> inventory table
      {"results": [{...,status,message}]}    -> health table
      ["container","pod",...]                -> the list, inline and readable
      {"alertGroups": [...]}                 -> what is firing
      {"data": [{"metric":{...},"value":[…]} -> instant-query series table

    `kind` names what the list holds ("labels", "metrics", "series") because a bare array of
    strings does not say. Unrecognised shapes return None so the caller can fall through to
    the Kubernetes summariser, then to the raw payload.
    """
    try:
        src = json.loads(raw)
    except Exception:  # noqa: BLE001
        return None

    if isinstance(src, dict) and "datasources" in src:
        ds = src.get("datasources") or []
        if not ds:
            return "**0 datasource(s)** configured in Grafana."
        rows = [[
            str(d.get("name") or "?"),
            str(d.get("type") or "?"),
            str(d.get("uid") or "-"),
            "yes" if d.get("isDefault") else "",
        ] for d in ds]
        body = _md_table(["Name", "Type", "UID", "Default"], rows)
        return f"**{len(rows)} datasource(s)** in Grafana\n\n{body}"

    if isinstance(src, dict) and "results" in src:
        rs = src.get("results") or []
        if not rs:
            return None
        rows = [[
            str(r.get("name") or "?"),
            str(r.get("type") or "?"),
            str(r.get("status") or "?"),
            str(r.get("message") or "-")[:60],
        ] for r in rs]
        body = _md_table(["Name", "Type", "Status", "Detail"], rows)
        return f"**{len(rows)} datasource(s) checked**\n\n{body}"

    if isinstance(src, dict) and "alertGroups" in src:
        gs = src.get("alertGroups") or []
        if not gs:
            return "**0 alert group(s)** — nothing is firing."
        rows = [[
            str(g.get("name") or "?"),
            str(g.get("state") or "?"),
            str(len(g.get("alerts") or [])),
        ] for g in gs]
        body = _md_table(["Alert group", "State", "Alerts"], rows)
        return f"**{len(rows)} alert group(s)**\n\n{body}"

    # Instant query: {"data":[{"metric":{...},"value":[ts,"v"]}]}
    if isinstance(src, dict) and "data" in src:
        data = src.get("data") or []
        if not data or not isinstance(data[0], dict) or "metric" not in data[0]:
            return None
        rows = []
        for s in data[:60]:
            metric = s.get("metric") or {}
            name = metric.get("__name__") or metric.get("name") or "?"
            labels = ", ".join(f"{k}={v}" for k, v in sorted(metric.items())
                               if k not in ("__name__", "name"))
            val = s.get("value") or s.get("values") or []
            if isinstance(val, list) and val and isinstance(val[-1], list):
                val = val[-1]
            shown = val[1] if isinstance(val, list) and len(val) > 1 else "-"
            rows.append([str(name), labels[:70] or "-", str(shown)])
        body = _md_table(["Metric", "Labels", "Value"], rows)
        return (f"**{len(data)} series**{' (showing %d)' % len(rows) if len(data) > len(rows) else ''}"
                f"\n\n{body}")

    # A bare array of names — label names, label values, metric names, folder names.
    if isinstance(src, list) and src and all(isinstance(x, str) for x in src):
        label = {
            "labels": "label(s)",
            "values": "value(s)",
            "metrics": "metric(s)",
        }.get(kind, "item(s)")
        shown = src[:60]
        cells = " · ".join(f"`{s}`" for s in shown)
        tail = f"\n\n_{len(src) - len(shown)} more not shown_" if len(src) > len(shown) else ""
        return f"**{len(src)} {label}**\n\n{cells}{tail}"

    return None


def _as_answer_body(raw: str, max_rows: int = 200, markdown: bool = False) -> str:
    """Turn a tool payload into the answer body.

    MARKDOWN TABLES ARE PASSED THROUGH AS MARKDOWN. They used to be wrapped in a ``` fence
    along with everything else, which is why a correct table arrived on screen as a dark
    monospace block showing the raw pipes — `| Node | Status | …` with `|---|` visible — and
    why any `**bold**` in it printed its asterisks. react-markdown only builds a real table
    (and MarkdownMessage already styles one) when the text is NOT a code block, so the fence
    was defeating the renderer for exactly the payloads that most needed it.

    Everything that is not a table — raw JSON, kubectl output — still gets fenced, because a
    wall of JSON reflowed as prose is worse than a scrollable block.

    Tables are cut on ROW boundaries, not line boundaries. A fixed 14-LINE cut splits a
    table mid-row and the renderer drops the orphan, so the visible row count would silently
    differ from the one stated.
    """
    lines = raw.strip().split("\n")
    tbl_at = None
    for i in range(len(lines) - 1):
        if lines[i].lstrip().startswith("|") and re.match(r"^\s*\|[\s:|\-]+\|\s*$", lines[i + 1]):
            tbl_at = i
            break

    if tbl_at is None:
        # MARKDOWN FROM A SUMMARISER IS PASSED THROUGH — never fenced.
        #
        # A fenced body is a `<pre>` to react-markdown, so `**bold**` prints its asterisks
        # and `` `container` `` prints its backticks. That is exactly what happened to
        # "Loki က label ဘာတွေရှိလဲ": the label list is markdown by construction but has no
        # table, so it was fenced and arrived as literal `**6 label(s)** | \`container\` …`.
        # The datasource answer was fine only because it happens to contain a table.
        #
        # The flag is explicit rather than sniffing for `**`, because the default caller
        # feeds raw kubectl/JSON output where a backtick or asterisk inside a string must
        # keep its literal meaning.
        shown = lines[:40] if markdown else lines[:14]
        hidden = max(0, len(lines) - len(shown))
        if markdown:
            out = "\n".join(shown)
        else:
            out = "```\n" + "\n".join(shown) + "\n```"
        if hidden:
            out += f"\n\n_{hidden} more line(s) — open \"Show full output\" below_"
        return out

    pre = lines[:tbl_at]
    header = lines[tbl_at:tbl_at + 2]
    rows = [ln for ln in lines[tbl_at + 2:] if ln.strip()]
    shown = rows[:max_rows]
    hidden = max(0, len(rows) - len(shown))
    md = "\n".join(pre + header + shown).strip()
    if hidden:
        md += f"\n\n_{hidden} more row(s) — open \"Show full output\" below_"
    return md


def _deterministic_lookup(question: str, tools):
    """Answer a common infrastructure question WITHOUT the model choosing a tool.

    WHY THIS EXISTS (measured, not defensive coding): the configured model here is a
    free tier, and on this question it returned EMPTY content with no tool calls, so
    the whole lookup yielded 0 chars in 9.3s. With the model out of the loop the
    answer silently became a knowledge-base miss — exactly the confusion the mode
    switch is meant to remove. So when tool-calling produces nothing, pick the
    obvious tool deterministically and return real cluster data.

    This is deliberately narrow: it handles the shapes an IT help desk actually asks
    ("what is unhealthy", "what is in namespace X", "what events are firing") and
    declines everything else rather than guessing.
    """
    q = (question or "").lower()

    # --- explicit kubectl command first: it states exactly what is wanted -----
    kb = parse_kubectl(question or "")
    if kb:
        ns = kb.get("namespace")
        # Nodes live at cluster scope; everything else is namespaced.
        tool = _first_tool(tools, ("kubernetes_list",))
        if tool:
            try:
                largs = {"cluster": "kubeconfig:local", "kind": kb["kind"]}
                if ns and kb["kind"] not in ("Node", "Namespace", "PersistentVolume"):
                    largs["namespace"] = ns
                out = str(tool.invoke(largs))
                if out.strip() and out.strip() not in ("[]", "{}"):
                    # Full objects are unreadable; summarise unless the tool already
                    # returned something human-formatted.
                    summary = summarise_json(out)
                    return summary if summary else out
            except Exception as exc:  # noqa: BLE001
                logger.info("kubectl-style lookup failed: %s", exc)

    ns = None
    # Namespace extraction, both orders. The first pattern is the common phrasing
    # ("in the rag-chatbot namespace") and MUST be tried first: the naive
    # `namespace\s+(\w+)` matched the word AFTER "namespace", so "…namespace right
    # now" yielded ns="right" and the lookup queried a namespace that does not exist —
    # the tool returned nothing and the answer reported a failed lookup for a question
    # the cluster could answer. Stopwords guard the remaining slots.
    _NS_STOP = {"the", "a", "an", "my", "this", "that", "which", "what", "in", "on",
                "right", "now", "and", "or", "is", "are", "of", "for", "to", "please"}
    # Try each phrasing and take the first NON-STOPWORD capture. An `or` chain over
    # re.search() short-circuits on the first pattern that matches at all, so
    # "in namespace kube-system" matched pattern 1 as "in", was rejected as a
    # stopword, and never reached the pattern that had the real name.
    for _pat in (r"\b([a-z0-9][a-z0-9-]*)\s+namespace\b",
                 r"\bnamespace[:\s]+([a-z0-9][a-z0-9-]*)",
                 r"\bin\s+([a-z0-9][a-z0-9-]*-[a-z0-9-]+)\b"):
        mm = re.search(_pat, q)
        if mm and mm.group(1) not in _NS_STOP:
            ns = mm.group(1)
            break

    # ---- ordered routing rules ------------------------------------------------
    # Order matters: the specific shapes come before the broad health catch-all, and
    # every rule was added only after it appeared in the question audit.
    def _call(tool_name: str, args: dict):
        t = _first_tool(tools, (tool_name,))
        if not t:
            return None
        try:
            out = str(t.invoke(args))
        except Exception as exc:  # noqa: BLE001
            logger.info("deterministic %s failed: %s", tool_name, exc)
            return None
        return out if out.strip() and out.strip() not in ("[]", "{}") else None

    # 0a) Grafana / LGTM observability. MUST come before the Kubernetes rules below, and it
    #     is safe to put first because it only fires on observability vocabulary that no
    #     other rule owns. Measured before this existed: "Loki က label ဘာတွေရှိလဲ"
    #     had no working path anywhere — the deterministic lookup declined it (this function
    #     is Kubernetes-only by design), `list_loki_label_names` was not in the model's
    #     exposed tool set, the model called `list_datasources` instead, returned no final
    #     message, and the answer collapsed to "lookup failed — no live data" while the
    #     evidence card showed a successful 290-byte call. The connector was fine the whole
    #     time; the routing was not.
    #
    #     The label and metric tools REQUIRE a datasourceUid, so the uid is resolved from
    #     list_datasources by type first. A question phrased without the product name
    #     ("label ဘာတွေရှိလဲ") cannot be resolved this way and is declined rather than
    #     guessed, the same discipline the rest of this function follows.
    if re.search(r"\b(grafana|loki|prometheus|tempo|mimir|pyroscope|datasources?)\b", q):

        def _ds_uid(kind: str) -> str:
            """Resolve a datasource uid by its type — list_datasources needs no arguments."""
            out = _call("list_datasources", {})
            if not out:
                return ""
            try:
                for d in (json.loads(out).get("datasources") or []):
                    if str(d.get("type") or "").lower() == kind:
                        return str(d.get("uid") or "")
            except Exception:  # noqa: BLE001
                return ""
            return ""

        def _gf(title: str, tool: str, args: dict, kind: str = ""):
            """Call a Grafana tool and render it; None keeps the caller searching."""
            out = _call(tool, args)
            if not out:
                return None
            body = summarise_grafana(out, kind) or summarise_json(out) or out
            return f"**{title}**\n\n{body}"

        wants_loki = bool(re.search(r"\bloki\b", q))
        wants_prom = bool(re.search(r"\bprometheus\b", q))

        # -- label inventories: the question class that had no path at all ---------
        if re.search(r"\blabels?\b", q):
            if wants_loki:
                uid = _ds_uid("loki")
                if uid:
                    got = _gf("Loki — label names", "list_loki_label_names",
                              {"datasourceUid": uid}, "labels")
                    if got:
                        return got
            if wants_prom:
                uid = _ds_uid("prometheus")
                if uid:
                    got = _gf("Prometheus — label names", "list_prometheus_label_names",
                              {"datasourceUid": uid, "limit": 100}, "labels")
                    if got:
                        return got

        # -- metric inventory ------------------------------------------------------
        if wants_prom and re.search(r"\b(metrics?|series)\b", q):
            uid = _ds_uid("prometheus")
            if uid:
                got = _gf("Prometheus — metric names", "list_prometheus_metric_names",
                          {"datasourceUid": uid, "limit": 60}, "metrics")
                if got:
                    return got

        # -- datasource inventory and reachability --------------------------------
        if re.search(r"\b(datasources?|grafana)\b", q):
            if re.search(r"\b(health|healthy|ok|reachable|working|connect|status)\b", q):
                got = _gf("Grafana — datasource health", "check_datasources_health", {})
                if got:
                    return got
            got = _gf("Grafana — datasources", "list_datasources", {})
            if got:
                return got

        # -- what is firing --------------------------------------------------------
        if re.search(r"\b(alerts?|alerting|firing|incidents?)\b", q):
            got = (_gf("Grafana — alert groups", "list_alert_groups", {})
                   or _gf("Grafana — incidents", "list_incidents", {}))
            if got:
                return got

        # -- log lines -------------------------------------------------------------
        if wants_loki and re.search(r"\blogs?\b", q):
            uid = _ds_uid("loki")
            if uid:
                got = _gf("Loki — log volume", "query_loki_stats",
                          {"datasourceUid": uid, "logql": '{container=~".+"}'})
                if got:
                    return got

        # -- default: the inventory an operator means by "grafana" -----------------
        got = _gf("Grafana — datasources", "list_datasources", {})
        if got:
            return got

    # 0) Proxmox / hypervisor. MUST come before every rule below, because Proxmox has
    #    nodes, storage and guests of its own — so each generic rule was claiming
    #    hypervisor questions and answering them with Kubernetes data. Measured before
    #    this rule existed: "Proxmox node တွေ ဘယ်နှစ်ခု ရှိလဲ" ran kubernetes_list, and
    #    "Proxmox VMs list ပြပါ" ran kubernetes_workload_health. The tools were connected
    #    and reachable the whole time; nothing ever routed to them.
    #    Bare "node"/"storage"/"vm" still routes to Kubernetes; the word Proxmox (or pve)
    #    is required to enter here.
    if re.search(r"\b(proxmox|pve|hypervisor)\b", q):
        # summarise_proxmox FIRST, summarise_json second: the latter is Kubernetes-shaped
        # and renders Proxmox objects as a table of "?" over correct data.
        # -- storage / backup inventory ------------------------------------------
        if re.search(r"\b(storage|datastore|disk|backup|vzdump)\b", q):
            if re.search(r"\bbackup", q):
                out = _call("proxmox_list_backups", {}) or _call("proxmox_list_storage", {})
            else:
                out = _call("proxmox_list_storage", {})
            if out:
                return summarise_proxmox(out) or summarise_json(out) or out
        # -- guests: whole VMs vs LXC containers ---------------------------------
        if re.search(r"\b(vms?|virtual machines?|qemu)\b", q):
            out = _call("proxmox_list_vms", {})
            if out:
                return summarise_proxmox(out) or summarise_json(out) or out
        if re.search(r"\b(lxc|containers?|cts?)\b", q) and not re.search(
                r"\b(kubernetes|k8s|pods?|namespace|deploy)\b", q):
            out = _call("proxmox_list_containers", {})
            if out:
                return summarise_proxmox(out) or summarise_json(out) or out
        # -- consumption ---------------------------------------------------------
        # NOT proxmox_resource_usage: its schema requires a vmid (it reports per-guest
        # metrics, not per-node). Calling it without one returns TOOL_INPUT_INVALID, so the
        # branch could never succeed. Node-level CPU/memory live in /nodes/<node>/rrddata,
        # which the vendored tool set does not expose — so a usage question lands on
        # proxmox_status, whose table now carries the node's CPU and memory columns.
        if re.search(r"\b(cpu|memory|ram|load|usage|utilis|utiliz)\b", q):
            out = _call("proxmox_status", {})
            if out:
                return summarise_proxmox(out) or summarise_json(out) or out
        # -- running/scheduled work ---------------------------------------------
        if re.search(r"\b(task|job|recent|running)\b", q):
            out = _call("proxmox_recent_tasks", {})
            if out:
                return summarise_proxmox(out) or summarise_json(out) or out
        # -- default: version, node list and cluster health ----------------------
        out = _call("proxmox_status", {})
        if out:
            return summarise_proxmox(out) or summarise_json(out) or out

    # 1) Which estates exist / their status -> cluster_list.
    if re.search(r"\bclusters?\b", q) and re.search(
            r"list|which|what|how many|status|manage|available|all|connected", q):
        out = _call("cluster_list", {})
        if out:
            return out

    # 2) Storage inventory -> PVC list (summarised).
    if re.search(r"\b(storage|pvc|persistent ?volumes?|volumes?|disk)\b", q):
        largs = {"cluster": "kubeconfig:local", "kind": "PersistentVolumeClaim"}
        if ns:
            largs["namespace"] = ns
        out = _call("kubernetes_list", largs)
        if out:
            return summarise_json(out) or out

    # 3) Consumption -> top. "how much memory is being used", "what is using the most
    #    memory", "show me cpu usage" name no object at all.
    if re.search(r"\b(cpu|memory|ram)\b", q) and re.search(
            r"usage|using|most|top|utilis|utiliz|consume|pressure", q):
        out = _call("kubernetes_top", {"cluster": "kubeconfig:local"})
        if out:
            return summarise_json(out) or out

    # 4) Nodes. Capacity questions get the pre-formatted capacity table; status,
    #    version, roles, taints and IP questions need the node objects, which are
    #    summarised into Name/Status/Roles/Internal IP/Version/Age.
    if re.search(r"\bnodes?\b|\bno\b", q):
        if re.search(r"capacity|request|limit|allocat", q):
            out = _call("kubernetes_capacity", {"cluster": "kubeconfig:local"})
            if out:
                return out
        out = _call("kubernetes_list", {"cluster": "kubeconfig:local", "kind": "Node"})
        if out:
            return summarise_json(out) or out

    # 5) Events / warnings / anything wrong -> events. Before the generic health rule:
    #    "are there any warnings" should list events, not a workload summary.
    if re.search(r"events?|warnings?|wrong|errors?|problems?|issues?|alert", q):
        eargs = {"cluster": "kubeconfig:local"}
        if ns:
            eargs["namespace"] = ns
        out = _call("kubernetes_events", eargs)
        if out:
            return out

    # 6) Everything else about live state -> the workload-health summary.
    if re.search(r"unhealthy|not ready|failing|broken|crash|health|healthy|status|state|"
                 r"ready|how many|count|which|list|running|inventory|pod|deployment|"
                 r"workload|namespace|resource|everything|anything", q):
        wargs = {"cluster": "kubeconfig:local"}
        if ns:
            wargs["namespace"] = ns
        out = _call("kubernetes_workload_health", wargs)
        if out:
            return out
    return ""


def answer_infra(question: str) -> tuple[str, str, list, str]:
    """(text, note, calls, raw). note is "deterministic" | "ok" | "failed".

    `text` is what gets shown as the answer; `raw` is the verbatim tool output.

    WHY THEY ARE SEPARATE: the first version put the entire tool output in the answer
    body AND offered it again under the evidence card's "Show full output" — the same
    6 KB of table twice, which is exactly the messiness this work is meant to remove.
    The body now carries a readable excerpt with a count of what is held back, and the
    full payload travels only to the collapsible viewer.

    `calls` is the per-turn record of what was queried (name, duration, size, server,
    time). It is the evidence a live-infrastructure answer must show — the KB path has
    its source list, this is the equivalent.

    Deterministic FIRST, the model second. Measured reason for the order: when the
    model was primary it echoed the instruction meant for it ("LIVE INFRASTRUCTURE
    DATA — answer from this… Do NOT say the knowledge base lacks the information")
    back to the user as the answer body and emitted "[]" instead of the data. Driving
    the common shapes from code produces a clean, complete answer with no model in the
    loop, and it is faster and cheaper besides.
    """
    _begin_call_log()
    tools = build_tools()
    if tools:
        raw = _deterministic_lookup(question, tools)
        # A tool can succeed and still return nothing; an empty array is not an answer.
        if raw and raw.strip() not in ("[]", "{}", "null") and len(raw.strip()) > 20:
            logger.info("deterministic infra lookup produced %d chars", len(raw))
            # NO leading "Live infrastructure — read-only, queried directly from the
            # cluster (not from documents)." sentence. The chat UI already renders a green
            # "live infrastructure · read-only MCP" badge directly above the bubble (see
            # EvidenceCard), so saying it again in the body was pure duplication — and it
            # pushed the actual data down. The badge is the claim; the table is the evidence.
            #
            # NO code fence around the body either: it must reach the renderer as markdown.
            # See _as_answer_body — and note the flag: without `markdown=True` a body that
            # has no table (the Loki label list) is still fenced, and `**6 label(s)**`
            # arrives on screen wearing its asterisks.
            text = _as_answer_body(raw, markdown=True)
            return text, "deterministic", (_TOOL_CALLS.get() or []), raw.strip()

    # A "what can you do" question names the domain but wants the capability list, not a
    # lookup — and it legitimately matches no tool, so it used to come back EMPTY.
    if _CAPABILITY.search(question or ""):
        return capabilities_text(), "capabilities", (_TOOL_CALLS.get() or []), ""

    # Fall back to the model choosing tools, for questions the deterministic shapes
    # above do not cover.
    text = run_infra_agent(question)
    if text:
        return text, "ok", (_TOOL_CALLS.get() or []), ""
    return "", "failed", (_TOOL_CALLS.get() or []), ""


def agent_status() -> dict:
    """Diagnostics for the Settings page / health panel: per-server reachability,
    tool counts and which curated tools each one actually offers."""
    from app.mcp.client import get_client, get_mcp_servers

    servers = []
    for spec in get_mcp_servers():
        entry = {"name": spec["name"], "url": spec["url"],
                 "enabled": bool(spec.get("enabled")), "mode": spec.get("mode")}
        curated = CURATED_BY_SERVER.get(spec["name"], ())
        entry["tools_curated"] = list(curated)
        if not spec.get("enabled") or not spec.get("url"):
            entry["reachable"] = False
            entry["skipped"] = "disabled"
            servers.append(entry)
            continue
        try:
            names = [t.get("name") for t in get_client(spec["name"]).list_tools()]
            entry["reachable"] = True
            entry["tools_available"] = len(names)
            entry["tools_curated"] = [n for n in curated if n in names]
        except Exception as exc:  # noqa: BLE001
            entry["reachable"] = False
            entry["error"] = f"{type(exc).__name__}: {str(exc)[:160]}"
        servers.append(entry)

    live = [s for s in servers if s.get("reachable")]
    return {
        "servers": servers,
        "servers_reachable": len(live),
        # Back-compat with the earlier single-server shape used by the Settings test.
        "configured": bool(servers),
        "url": servers[0]["url"] if servers else "",
        "reachable": bool(live),
        "tools_available": sum(s.get("tools_available") or 0 for s in live),
        "tools_curated": sorted({n for s in live for n in (s.get("tools_curated") or [])}),
    }
