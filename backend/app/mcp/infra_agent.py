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

CURATED_BY_SERVER: dict[str, tuple[str, ...]] = {
    "rancher": CURATED_TOOLS,
    "proxmox": PROXMOX_CURATED_TOOLS,
}

# Cheap intent gate — no LLM call, same discipline as app/tools/ticket_tool.py.
# Deliberately requires an infrastructure noun; a bare "cluster" should not hijack
# an ordinary knowledge question.
_INFRA_STRONG = re.compile(
    r"\b(kubeconfig|kubectl|kubernetes|k8s|cluster|namespace|pod|pods|node|nodes|"
    r"deployment|deployments|statefulset|daemonset|replicaset|ingress|helm|"
    r"rancher|workload|oomkill|crashloop|evicted|pending pod|readiness|liveness|"
    r"cpu usage|memory usage|capacity|disk pressure)\b",
    re.IGNORECASE,
)
# Phrases that mean "tell me about the concept", not "look at my cluster".
_CONCEPT = re.compile(
    r"\b(what is|what are|explain|define|difference between|how does|tutorial|"
    r"concept|architecture of)\b",
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
    if len(q) < 4 or not _INFRA_STRONG.search(q):
        return False
    # "What is a pod?" is a KB question. "Why is my pod pending?" is not.
    if _CONCEPT.search(q) and not _LIVE_HINT.search(q):
        return False
    return True


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
        curated = CURATED_BY_SERVER.get(spec["name"], ())
        if not curated:
            continue
        client = get_client(spec["name"])
        try:
            catalogue = {t.get("name"): t for t in client.list_tools()}
        except Exception as exc:  # noqa: BLE001
            logger.info("mcp[%s] catalogue unavailable: %s: %s",
                        spec["name"], type(exc).__name__, exc)
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
                    out = _truncate(_client.call_tool(_name, args),
                                    int(SETTINGS.mcp_max_tool_chars))
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
            messages.append(ToolMessage(content=str(result),
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


def _first_tool(tools, names: tuple[str, ...]):
    by = {t.name: t for t in tools}
    for n in names:
        if n in by:
            return by[n]
    return None


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

    # Prefer the workload-health summary: it returns a READABLE, pre-formatted table
    # (NAME / NAMESPACE / KIND / READY …) in one call, where kubernetes_list returns a
    # large JSON array that renders as an unreadable wall of text in the answer.
    # Measured: the list output was 6,031 chars of JSON and the UI showed a code block
    # of "[…]" — technically correct, useless to a human.
    if re.search(r"unhealthy|not ready|failing|broken|crash|health|status|how many|count|which|list|pod|deployment|workload", q):
        tool = _first_tool(tools, ("kubernetes_workload_health",))
        if tool:
            try:
                wargs = {"cluster": "kubeconfig:local"}
                if ns:
                    wargs["namespace"] = ns
                out = str(tool.invoke(wargs))
                if out.strip() and out.strip() not in ("[]", "{}"):
                    return out
            except Exception as exc:  # noqa: BLE001
                logger.info("deterministic workload_health failed: %s", exc)

    # Specific resource kind -> kubernetes_list, for questions the summary cannot
    # answer (e.g. a Service or Ingress inventory).
    kind = None
    for needle, proper in (("deployment", "Deployment"), ("statefulset", "StatefulSet"),
                           ("daemonset", "DaemonSet"), ("pod", "Pod"),
                           ("service", "Service"), ("ingress", "Ingress"),
                           ("node", "Node"), ("namespace", "Namespace")):
        if re.search(r"\b" + needle + r"s?\b", q):
            kind = proper
            break
    if kind:
        tool = _first_tool(tools, ("kubernetes_list",))
        if tool:
            try:
                largs = {"cluster": "kubeconfig:local", "kind": kind}
                if ns:
                    largs["namespace"] = ns
                out = str(tool.invoke(largs))
                if out.strip() and out.strip() not in ("[]", "{}"):
                    return out
            except Exception as exc:  # noqa: BLE001
                logger.info("deterministic kubernetes_list failed: %s", exc)

    if re.search(r"event|warning", q):
        tool = _first_tool(tools, ("kubernetes_events",))
        if tool:
            try:
                eargs = {"cluster": "kubeconfig:local"}
                if ns:
                    eargs["namespace"] = ns
                return str(tool.invoke(eargs))
            except Exception as exc:  # noqa: BLE001
                logger.info("deterministic kubernetes_events failed: %s", exc)
    return ""


def answer_infra(question: str) -> tuple[str, str, list]:
    """(text, note, calls). note is "deterministic" | "ok" | "failed".

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
            head = raw.strip()
            if len(head) > 3500:
                head = head[:3500] + "\n…[truncated]"
            return (("**Live infrastructure** — read-only, queried directly from the "
                     "cluster (not from documents).\n\n```\n" + head + "\n```"),
                    "deterministic", _TOOL_CALLS.get() or [])

    # Fall back to the model choosing tools, for questions the deterministic shapes
    # above do not cover.
    text = run_infra_agent(question)
    if text:
        return text, "ok", _TOOL_CALLS.get() or []
    return "", "failed", _TOOL_CALLS.get() or []


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
