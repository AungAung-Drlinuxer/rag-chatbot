"""Minimal MCP client over streamable HTTP (Phase 1).

WHY HAND-ROLLED
The backend already ships httpx, and the MCP surface this needs is three methods
(initialize / tools/list / tools/call). Adding `langchain-mcp-adapters` would pull
a dependency tree for that, and it would also hand over tool selection wholesale —
whereas the whole risk here is WHICH tools reach the model.

FRAMING
MCP streamable-HTTP is JSON-RPC 2.0 POSTed to /mcp. The server may reply either as
plain JSON or as an SSE stream (`event: message` / `data: {...}`), so both are
parsed. A session id, when returned in the `mcp-session-id` header, is echoed on
subsequent calls.

FAILURE POLICY
Every method raises on transport/protocol problems; the caller catches and falls
back. A broken or missing MCP server must never take chat down — infrastructure
lookup is an enhancement, not a dependency.
"""
from __future__ import annotations

import json
import logging
import threading
import time

import httpx

from app.config import SETTINGS

logger = logging.getLogger("mcp.client")

_ACCEPT = "application/json, text/event-stream"


def _parse_body(raw: str) -> dict:
    """Accept either a plain JSON body or an SSE frame carrying the JSON."""
    txt = (raw or "").strip()
    if not txt:
        return {}
    if txt.startswith("{") or txt.startswith("["):
        try:
            return json.loads(txt)
        except ValueError:
            return {}
    # SSE: take the last `data:` line, which is where the JSON-RPC reply sits.
    payload = None
    for line in txt.splitlines():
        if line.startswith("data:"):
            payload = line[5:].strip()
    if payload:
        try:
            return json.loads(payload)
        except ValueError:
            return {}
    return {}


class McpClient:
    def __init__(self, url: str | None = None, timeout: float | None = None) -> None:
        self.url = (url or SETTINGS.mcp_rancher_url or "").rstrip("/")
        self.timeout = float(timeout or SETTINGS.mcp_timeout_s)
        self._session: str | None = None
        self._rid = 0
        self._lock = threading.Lock()
        self._tools_cache: tuple[float, list[dict]] | None = None

    # -- transport ---------------------------------------------------------
    def _rpc(self, method: str, params: dict | None, notify: bool = False) -> dict:
        if not self.url:
            raise RuntimeError("MCP url not configured")
        with self._lock:
            self._rid += 1
            rid = self._rid
        body: dict = {"jsonrpc": "2.0", "method": method}
        if not notify:
            body["id"] = rid
        if params is not None:
            body["params"] = params

        headers = {"Content-Type": "application/json", "Accept": _ACCEPT}
        if self._session:
            headers["mcp-session-id"] = self._session

        with httpx.Client(timeout=self.timeout) as client:
            r = client.post(self.url + "/mcp", json=body, headers=headers)
            r.raise_for_status()
            sid = r.headers.get("mcp-session-id")
            if sid:
                self._session = sid
            if notify:
                return {}
            data = _parse_body(r.text)
        if "error" in data:
            raise RuntimeError(f"MCP error: {str(data['error'])[:200]}")
        return data

    # -- protocol ----------------------------------------------------------
    def initialize(self) -> dict:
        out = self._rpc("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "rag-chatbot", "version": "0.1"},
        })
        try:
            self._rpc("notifications/initialized", {}, notify=True)
        except Exception:  # noqa: BLE001 - optional per spec
            pass
        return out

    def list_tools(self, ttl: float = 300.0) -> list[dict]:
        """Tool catalogue, cached briefly — it is static and the schema is large."""
        now = time.time()
        if self._tools_cache and (now - self._tools_cache[0]) < ttl:
            return self._tools_cache[1]
        if not self._session:
            self.initialize()
        data = self._rpc("tools/list", {})
        tools = ((data.get("result") or {}).get("tools")) or []
        self._tools_cache = (now, tools)
        return tools

    def call_tool(self, name: str, arguments: dict) -> str:
        """Return the tool's text content. Raises on failure (caller decides)."""
        if not self._session:
            self.initialize()
        data = self._rpc("tools/call", {"name": name, "arguments": arguments or {}})
        content = ((data.get("result") or {}).get("content")) or []
        parts = []
        for c in content:
            if isinstance(c, dict):
                parts.append(c.get("text") or "")
            else:
                parts.append(str(c))
        text = "\n".join(p for p in parts if p).strip()
        if not text:
            raise RuntimeError(f"MCP tool {name} returned no content")
        return text

    def healthy(self) -> bool:
        try:
            if not self._session:
                self.initialize()
            return bool(self.list_tools())
        except Exception as exc:  # noqa: BLE001
            logger.info("mcp unhealthy: %s: %s", type(exc).__name__, exc)
            return False


_client: McpClient | None = None
_client_lock = threading.Lock()


def get_client() -> McpClient:
    global _client
    with _client_lock:
        if _client is None:
            _client = McpClient()
        return _client
