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
import re

from app.config import SETTINGS
from app.mcp.client import get_client

logger = logging.getLogger("mcp.infra")

# The toolset handed to the model. Chosen so each one answers a real question:
#   "what clusters are there"      -> cluster_list
#   "is anything broken"           -> kubernetes_workload_health, kubernetes_events
#   "why did this pod fail"        -> kubernetes_logs, kubernetes_describe
#   "what is under pressure"       -> kubernetes_top, kubernetes_capacity
CURATED_TOOLS: tuple[str, ...] = (
    "cluster_list",
    "kubernetes_workload_health",
    "kubernetes_events",
    "kubernetes_logs",
    "kubernetes_describe",
    "kubernetes_top",
    "kubernetes_capacity",
)

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
    """LangChain tools for the curated MCP tools, or [] if the server is down."""
    from langchain_core.tools import StructuredTool

    client = get_client()
    try:
        catalogue = {t.get("name"): t for t in client.list_tools()}
    except Exception as exc:  # noqa: BLE001
        logger.info("mcp tool catalogue unavailable: %s: %s", type(exc).__name__, exc)
        return []

    tools = []
    for name in CURATED_TOOLS:
        spec = catalogue.get(name)
        if not spec:
            continue  # not offered by this deployment; skip rather than invent
        desc = (spec.get("description") or name)[:900]
        schema = spec.get("inputSchema") or {}
        try:
            args_schema = _json_schema_to_args(schema)
        except Exception:  # noqa: BLE001
            continue

        def _run(_name=name, **kwargs):
            # Drop None so the server sees only what the model actually set.
            args = {k: v for k, v in kwargs.items() if v is not None}
            try:
                return _truncate(client.call_tool(_name, args),
                                 int(SETTINGS.mcp_max_tool_chars))
            except Exception as exc:  # noqa: BLE001
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
        return (getattr(final, "content", "") or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def agent_status() -> dict:
    """Diagnostics for the Settings page / health panel."""
    client = get_client()
    try:
        tools = client.list_tools()
        return {
            "configured": bool(client.url),
            "url": client.url,
            "reachable": True,
            "tools_available": len(tools),
            "tools_curated": [n for n in CURATED_TOOLS if any(t.get("name") == n for t in tools)],
        }
    except Exception as exc:  # noqa: BLE001
        return {"configured": bool(client.url), "url": client.url, "reachable": False,
                "error": f"{type(exc).__name__}: {str(exc)[:160]}",
                "tools_curated": list(CURATED_TOOLS)}
