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

import queue
import threading
import time

import httpx
from sqlalchemy import text

from app.config import SETTINGS
from app.persistence.database import SessionLocal

logger = logging.getLogger("mcp.client")

_ACCEPT = "application/json, text/event-stream"


def get_mcp_cfg() -> dict:
    """MCP config from system_settings key='mcp', falling back to environment.

    DB-first so the Settings page is authoritative and an admin can repoint or
    disable infrastructure access without a redeploy — same precedence the other
    integrations use. The env value (SETTINGS.mcp_rancher_url) stays as the
    default a fresh install starts from.
    """
    cfg: dict = {}
    try:
        with SessionLocal() as s:
            row = s.execute(text("SELECT value FROM system_settings WHERE key = 'mcp'")).first()
        val = row[0] if row else {}
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except (TypeError, ValueError):
                val = {}
        cfg = val or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("mcp cfg read failed: %s", exc)

    token = str(cfg.get("rancher_token") or "").strip()
    # Instance selection. The upstream server refuses `kubeconfig_paths` together
    # with `rancher_request_token_auth`, so ONE process cannot serve both the local
    # cluster and the Rancher-managed downstream ones. Two deployments exist; a
    # configured Rancher token is the signal to use the management instance, since
    # that token is what makes downstream clusters reachable at all.
    #
    # With no token we stay on the kubeconfig instance, which works on a fresh
    # install with no credential — infrastructure lookup keeps functioning instead of
    # going dark until someone pastes a token.
    explicit = str(cfg.get("url") or "").strip()
    if explicit:
        url, mode = explicit, "explicit"
    elif token:
        url, mode = SETTINGS.mcp_mgmt_url, "rancher"
    else:
        url, mode = SETTINGS.mcp_rancher_url, "kubeconfig"

    enabled_raw = cfg.get("enabled")
    enabled = (SETTINGS.mcp_enabled if enabled_raw is None
               else str(enabled_raw).strip().lower() in ("1", "true", "yes", "on"))
    return {
        "url": url.rstrip("/"),
        "mode": mode,
        "enabled": enabled,
        "timeout_s": float(cfg.get("timeout_s") or SETTINGS.mcp_timeout_s),
        "rancher_url": str(cfg.get("rancher_url") or "").strip(),
        "rancher_token": token,
        # Proxmox VE (opt-in; see get_mcp_servers for why it defaults off).
        "proxmox_enabled": cfg.get("proxmox_enabled"),
        "proxmox_url": str(cfg.get("proxmox_url") or SETTINGS.mcp_proxmox_url).strip(),
        # Connectors added from the gallery. Without this passthrough the key never
        # reached get_mcp_servers(), so a connected connector was absent from the server
        # list and get_client() fell back to the FIRST server — the settings page reported
        # Rancher's tool counts for Postgres and Grafana.
        "servers": cfg.get("servers") or [],
        # No proxmox_token here on purpose — see get_mcp_servers().
    }


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
        cfg = get_mcp_cfg()
        self.cfg = cfg
        self.url = (url or cfg["url"] or "").rstrip("/")
        self.timeout = float(timeout or cfg["timeout_s"])
        # When set, every MCP call carries this Rancher token. The server runs with
        # per-request token auth, so THIS token decides which clusters are visible —
        # that is how downstream clusters are reached without per-cluster kubeconfigs.
        self.rancher_token = cfg.get("rancher_token") or ""
        # Transport per server. supergateway's streamable-HTTP mode crashes its own
        # Node process on a tools/list (unhandled "No connection established"),
        # measured against proxmox-mcp; its SSE mode survives the same sequence. So
        # bridged stdio servers are spoken to over SSE, everything else over the
        # streamable-HTTP endpoint.
        self.transport = "http"
        # SSE state.
        self._sse_q: dict[int, queue.Queue] = {}
        self._sse_endpoint: str | None = None
        self._sse_started = False
        self._session: str | None = None
        self._rid = 0
        self._lock = threading.Lock()
        self._tools_cache: tuple[float, list[dict]] | None = None

    # -- SSE transport (legacy MCP SSE: GET /sse -> POST /message) ----------
    def _sse_base(self) -> str:
        """The server root for SSE, whatever form the configured URL takes."""
        u = (self.url or "").rstrip("/")
        for suffix in ("/sse", "/messages/", "/message"):
            if u.endswith(suffix):
                u = u[: -len(suffix)]
        return u

    def _sse_headers(self, accept: str = "text/event-stream") -> dict:
        """Headers for an SSE request, INCLUDING the token.

        The token was only ever attached on the streamable-HTTP path, so any connector whose
        transport is `sse` silently sent nothing — a Grafana service-account token could be
        saved in Settings, arrive at the client, and still be dropped on the wire, leaving
        every query answered 401 with the token sitting unused. The SSE GET and the SSE POST
        are one session with the server, so both halves have to carry it.
        """
        headers = {"Accept": accept}
        if self.rancher_token:
            headers["Authorization"] = "Bearer " + self.rancher_token
        return headers

    def _sse_open(self) -> None:
        """Open the event stream and learn the message endpoint."""
        if self._sse_started:
            return
        holder: dict = {}
        ready = threading.Event()

        def _read():
            try:
                with httpx.Client(timeout=httpx.Timeout(30.0, read=None)) as client:
                    # Accept either convention: a base URL (…:8000) or one that already
                    # names the SSE path (…:8000/sse). The catalogue advertises the full
                    # path for clarity, and appending "/sse" to that produced
                    # "…/sse/sse" -> 404 -> "endpoint not advertised", which is how both
                    # new connectors failed on first contact.
                    with client.stream("GET", self._sse_base() + "/sse",
                                       headers=self._sse_headers()) as r:
                        r.raise_for_status()
                        event = None
                        for line in r.iter_lines():
                            if line is None:
                                continue
                            if line.startswith("event:"):
                                event = line[6:].strip()
                            elif line.startswith("data:"):
                                data = line[5:].strip()
                                if event == "endpoint" and "message" in data:
                                    # The endpoint arrives as a bare path with the
                                    # session id in the query string.
                                    holder["endpoint"] = data
                                    ready.set()
                                else:
                                    try:
                                        msg = json.loads(data)
                                    except ValueError:
                                        msg = {}
                                    rid = msg.get("id")
                                    if isinstance(rid, int) and rid in self._sse_q:
                                        self._sse_q[rid].put(msg)
            except Exception as exc:  # noqa: BLE001
                logger.info("mcp sse stream ended: %s: %s", type(exc).__name__, exc)
            finally:
                ready.set()
                self._sse_started = False

        threading.Thread(target=_read, daemon=True, name="mcp-sse").start()
        if not ready.wait(20) or not holder.get("endpoint"):
            raise RuntimeError("MCP SSE endpoint not advertised")
        self._sse_endpoint = holder["endpoint"]
        self._sse_started = True

    def _rpc_sse(self, method: str, params: dict | None, notify: bool = False,
                 timeout: float | None = None) -> dict:
        self._sse_open()
        with self._lock:
            self._rid += 1
            rid = self._rid
        body: dict = {"jsonrpc": "2.0", "method": method}
        if not notify:
            body["id"] = rid
        if params is not None:
            body["params"] = params

        # _sse_base(), NOT self.url: the advertised endpoint is an absolute path
        # ("/message?sessionId=..."), so appending it to a URL that already ends in "/sse"
        # produced "/sse/message" -> 404. The stream GET already used _sse_base(), which is
        # why a connector configured with the full SSE path failed only on the WRITE half:
        # initialize never returned, and it surfaced as "endpoint not advertised". Using the
        # same base for both halves makes either URL form work.
        if notify:
            with httpx.Client(timeout=self.timeout) as client:
                client.post(self._sse_base() + self._sse_endpoint, json=body,
                            headers=self._sse_headers("application/json")).raise_for_status()
            return {}

        q: queue.Queue = queue.Queue()
        self._sse_q[rid] = q
        try:
            with httpx.Client(timeout=self.timeout) as client:
                client.post(self._sse_base() + self._sse_endpoint, json=body,
                            headers=self._sse_headers("application/json")).raise_for_status()
            msg = q.get(timeout=timeout or self.timeout)
        except queue.Empty:
            raise RuntimeError(f"MCP SSE timeout waiting for {method}")
        finally:
            self._sse_q.pop(rid, None)
        if "error" in msg:
            raise RuntimeError(f"MCP error: {str(msg['error'])[:200]}")
        return msg

    # -- transport ---------------------------------------------------------
    def _rpc(self, method: str, params: dict | None, notify: bool = False) -> dict:
        if self.transport == "sse":
            return self._rpc_sse(method, params, notify=notify)
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
        if self.rancher_token:
            # Kept out of logs and never echoed back to a client.
            headers["Authorization"] = "Bearer " + self.rancher_token

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


def get_mcp_servers() -> list[dict]:
    """Every configured MCP server, in priority order.

    Multi-server because the estate has more than one domain of truth: Rancher/
    Kubernetes (read-only ServiceAccount, or the management API for downstream
    clusters) and Proxmox VE. Tool names are namespaced upstream by each server
    (`kubernetes_*`, `proxmox_*`), so the catalogues concatenate without collisions.

    Each entry: {name, url, enabled, token, mode}.
    """
    cfg = get_mcp_cfg()
    servers: list[dict] = []

    # --- Rancher / Kubernetes ------------------------------------------------
    servers.append({
        "name": "rancher",
        "url": cfg["url"],
        "enabled": cfg["enabled"],
        "token": cfg.get("rancher_token") or "",
        "mode": cfg.get("mode", "kubeconfig"),
        "transport": "http",
    })

    # --- Proxmox VE ----------------------------------------------------------
    # Default OFF. Proxmox can DESTROY virtual machines, and on this estate the
    # Kubernetes cluster this app runs on is itself hosted there — an enabled-by-
    # default destructive surface could take out the platform running the chatbot.
    # It stays opt-in, and the server process pins its destructive gate closed.
    px_enabled_raw = cfg.get("proxmox_enabled")
    px_enabled = str(px_enabled_raw).strip().lower() in ("1", "true", "yes", "on")
    servers.append({
        "name": "proxmox",
        "url": str(cfg.get("proxmox_url") or SETTINGS.mcp_proxmox_url).rstrip("/"),
        "enabled": px_enabled,
        # The Proxmox server reads its API token from the process environment (a
        # Kubernetes Secret), not from a request header, so there is no per-request
        # token to forward. Keeping one in Settings would imply the app can apply it;
        # it cannot without write access to K8s Secrets, which is a privilege not
        # worth taking for this. The hypervisor credential stays with the platform
        # team, rotatable with kubectl/SealedSecrets.
        "token": "",
        "mode": "proxmox",
        # A bridged stdio server. The image ships OUR bridge (bridge.js), which serves
        # streamable HTTP at /mcp — supergateway was measured unusable with this child (its
        # SSE mode serves one client only, and both streamable-HTTP variants die on the first
        # request). So this is "http", the same shape as rancher-mcp.
        "transport": "http",
    })
    # --- connectors added from the gallery ------------------------------------
    # `mcp.servers` holds whatever the administrator connected on the Connectors
    # screen: [{id, name, url, token, enabled, transport}]. The two entries above stay
    # hardcoded because this deployment ships those images and their behaviour is
    # special-cased (Rancher's two auth modes, Proxmox's SSE transport); anything an
    # administrator adds is data.
    for entry in (cfg.get("servers") or []):
        if not isinstance(entry, dict):
            continue
        url = str(entry.get("url") or "").strip().rstrip("/")
        sid = str(entry.get("id") or "").strip()
        if not sid or not url:
            continue
        en = str(entry.get("enabled")).strip().lower() in ("1", "true", "yes", "on")
        row = {
            "name": sid,
            "url": url,
            "enabled": en,
            # A bearer token is forwarded per request; servers that read credentials
            # from their own environment simply ignore it.
            "token": str(entry.get("token") or ""),
            "mode": "custom",
            "transport": str(entry.get("transport") or "http").strip() or "http",
        }
        # A signal the connector is ALREADY hardcoded above (proxmox is, and an
        # administrator may well configure its URL on the Connectors screen). Without this
        # check the same name appeared twice — once from the hardcoded default with its own
        # enabled flag and transport, once from storage — so Settings listed one connector
        # as both disabled and enabled. The stored entry wins: it carries what the
        # administrator actually chose.
        prior = next((i for i, s in enumerate(servers) if s.get("name") == sid), None)
        if prior is None:
            servers.append(row)
        else:
            servers[prior] = row
    return servers



def save_mcp_server(entry: dict) -> list[dict]:
        """Add or replace one connector in `mcp.servers`. Returns the new list.

        Stored server-side with the rest of the integration settings. A blank token on an
        update means "keep the stored one", matching the write-only credential contract used
        by every other integration — the UI never receives a secret back, so it cannot send
        one either.
        """
        from sqlalchemy import text as _sql

        from app.persistence.database import SessionLocal

        sid = str(entry.get("id") or "").strip()
        if not sid:
            raise ValueError("connector id required")
        with SessionLocal() as session:
            raw = session.execute(_sql(
                "SELECT value FROM system_settings WHERE key = 'mcp'")).scalar()
            cfg = {}
            if raw:
                try:
                    cfg = json.loads(raw) if isinstance(raw, str) else dict(raw)
                except Exception:  # noqa: BLE001
                    cfg = {}
            servers = [s for s in (cfg.get("servers") or []) if isinstance(s, dict)]
            existing = next((s for s in servers if s.get("id") == sid), {})
            merged = dict(existing)
            merged.update({k: v for k, v in entry.items() if v is not None})
            if not str(merged.get("token") or "").strip():
                merged["token"] = existing.get("token") or ""
            servers = [s for s in servers if s.get("id") != sid] + [merged]
            cfg["servers"] = servers
            session.execute(_sql(
                "INSERT INTO system_settings (key, value) VALUES ('mcp', :v) "
                "ON CONFLICT (key) DO UPDATE SET value = :v"),
                {"v": json.dumps(cfg)})
            session.commit()
            return servers



def remove_mcp_server(connector_id: str) -> list[dict]:
        """Disconnect a connector: drop it from `mcp.servers` and forget its client."""
        from sqlalchemy import text as _sql

        from app.persistence.database import SessionLocal

        with SessionLocal() as session:
            raw = session.execute(_sql(
                "SELECT value FROM system_settings WHERE key = 'mcp'")).scalar()
            cfg = {}
            if raw:
                try:
                    cfg = json.loads(raw) if isinstance(raw, str) else dict(raw)
                except Exception:  # noqa: BLE001
                    cfg = {}
            servers = [s for s in (cfg.get("servers") or [])
                       if isinstance(s, dict) and s.get("id") != connector_id]
            cfg["servers"] = servers
            session.execute(_sql(
                "INSERT INTO system_settings (key, value) VALUES ('mcp', :v) "
                "ON CONFLICT (key) DO UPDATE SET value = :v"),
                {"v": json.dumps(cfg)})
            session.commit()
        # Drop the cached session so a reconnect starts clean.
        with _clients_lock:
            for url in [u for u, c in _clients.items() if getattr(c, "owner", "") == connector_id]:
                _clients.pop(url, None)
        return servers
_clients: dict[str, McpClient] = {}
_clients_lock = threading.Lock()


def get_client(name: str = "rancher") -> McpClient:
    """Client for a named server (see get_mcp_servers())."""
    servers = {s["name"]: s for s in get_mcp_servers()}
    spec = servers.get(name) or next(iter(servers.values()))
    url = spec["url"] or ""
    with _clients_lock:
        cli = _clients.get(url)
        if cli is None:
            cli = McpClient(url=url)
            cli.rancher_token = spec.get("token") or ""
            cli.transport = spec.get("transport") or "http"
            _clients[url] = cli
        return cli


def reset_clients() -> None:
    """Drop every cached session (after a settings change)."""
    with _clients_lock:
        _clients.clear()
