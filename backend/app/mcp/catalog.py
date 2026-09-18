"""The MCP connector catalog — what the Connectors gallery offers.

WHY A CATALOG EXISTS
Today the app knows exactly two MCP servers and both are hardcoded in
`client.get_mcp_servers()`. That is fine for a single-purpose deployment and wrong for a
gallery: the whole point of a connector screen is that an administrator can see what is
available, connect one, and see its state. A catalog also lets the UI describe a
connector BEFORE it is configured, which is what makes the "available" state useful.

HONESTY RULES THIS FILE FOLLOWS
`source` distinguishes what this deployment actually ships from what an administrator
must supply, because claiming a connector is "available" when nobody has verified the
upstream server works would be the same class of error as reporting a failed lookup as a
success:
  builtin  - the image is built and deployed by this repo (verified end to end here)
  upstream - a real published package exists; connect it by running it and giving the URL
  custom   - bring your own MCP server over streamable HTTP or SSE

Nothing here is auto-installed. A catalog entry only ever describes how to point the app
at a server; the server itself runs as its own Deployment so that its RBAC, secrets and
resource limits stay independent of the application.
"""
from __future__ import annotations

# field: (key, label, kind, required, placeholder)
#   kind: text | password | bool
CATALOG: list[dict] = [
    # ---------------------------------------------------------------- built in
    {
        "id": "rancher",
        "name": "Rancher / Kubernetes",
        "description": "Read-only access to this cluster and, with a Rancher API token, "
                       "to every downstream cluster. Nodes, workloads, events and logs.",
        "category": "Infrastructure",
        "badge": "Built-in",
        "source": "builtin",
        "transport": "streamable_http",
        "url_default": "http://rancher-mcp:8080/mcp",
        "fields": [
            {"key": "url", "label": "MCP server URL", "kind": "text", "required": False,
             "placeholder": "http://rancher-mcp:8080/mcp"},
            {"key": "rancher_url", "label": "Rancher server URL", "kind": "text",
             "required": False, "placeholder": "https://rancher.example.com"},
            {"key": "rancher_token", "label": "Rancher API token", "kind": "password",
             "required": False, "placeholder": "token-xxxxx:xxxxxxxxxxxx"},
        ],
        "note": "Leave the token empty to stay on the read-only ServiceAccount path, which "
                "sees this cluster only. Paste a token to reach downstream clusters; bind "
                "it to a READ-ONLY Rancher role.",
    },
    {
        "id": "proxmox",
        "name": "Proxmox VE",
        "description": "Read-only inventory of the Proxmox estate: nodes, VMs, containers, "
                       "storage, snapshots, backups and task history.",
        "category": "Infrastructure",
        "badge": "Built-in",
        "source": "builtin",
        "transport": "sse",
        "url_default": "http://proxmox-mcp:8000/sse",
        "fields": [
            {"key": "url", "label": "MCP server URL", "kind": "text", "required": False,
             "placeholder": "http://proxmox-mcp:8000/sse"},
        ],
        "note": "Scaled to zero by default. Credentials live in the K8s Secret "
                "proxmox-mcp-credentials (PVEAuditor role), not here — a hypervisor token "
                "is too powerful to hold in the application's own settings. "
                "PROXMOX_ENABLE_DESTRUCTIVE is never set, so destroy/exec tools are "
                "refused in code before any API call.",
    },
    # ---------------------------------------------------- common upstream servers
    {
        "id": "grafana",
        "name": "Grafana / Observability",
        "description": "Query dashboards, Prometheus metrics and Loki logs. Pairs with the "
                       "LGTM stack for \"why was it slow\" questions.",
        "category": "Observability",
        "badge": "Popular",
        "source": "upstream",
        "transport": "streamable_http",
        "url_default": "",
        "fields": [
            {"key": "url", "label": "MCP server URL", "kind": "text", "required": True,
             "placeholder": "http://grafana-mcp:8000/mcp"},
            {"key": "token", "label": "Service account token", "kind": "password",
             "required": True, "placeholder": "glsa_xxxxxxxx"},
        ],
        "note": "Run the MCP server with a Viewer-role service account. Metrics reads are "
                "safe; alert-rule writes are not, so keep the role read-only.",
    },
    {
        "id": "postgres",
        "name": "PostgreSQL",
        "description": "Read-only SQL against an operational database — inventory, counts "
                       "and audit questions the knowledge base cannot answer.",
        "category": "Data",
        "badge": "Popular",
        "source": "upstream",
        "transport": "streamable_http",
        "url_default": "",
        "fields": [
            {"key": "url", "label": "MCP server URL", "kind": "text", "required": True,
             "placeholder": "http://postgres-mcp:8000/mcp"},
            {"key": "dsn", "label": "Connection string", "kind": "password",
             "required": True, "placeholder": "postgresql://reader:***@host:5432/db"},
        ],
        "note": "Use a dedicated read-only role. Never point this at the application "
                "database with its own credentials.",
    },
    {
        "id": "gitea",
        "name": "Gitea / GitHub",
        "description": "Repositories, issues, pull requests and CI status, so \"what changed "
                       "recently\" can be answered from code rather than tickets.",
        "category": "Developer",
        "badge": "",
        "source": "upstream",
        "transport": "streamable_http",
        "url_default": "",
        "fields": [
            {"key": "url", "label": "MCP server URL", "kind": "text", "required": True,
             "placeholder": "http://gitea-mcp:8000/mcp"},
            {"key": "token", "label": "Access token", "kind": "password", "required": True,
             "placeholder": "read-only token"},
        ],
        "note": "Scope the token to read:repository and read:issue only.",
    },
    {
        "id": "zabbix",
        "name": "Zabbix",
        "description": "Host availability, triggers and problems from Zabbix, alongside the "
                       "Kubernetes view.",
        "category": "Observability",
        "badge": "",
        "source": "upstream",
        "transport": "streamable_http",
        "url_default": "",
        "fields": [
            {"key": "url", "label": "MCP server URL", "kind": "text", "required": True,
             "placeholder": "http://zabbix-mcp:8000/mcp"},
            {"key": "token", "label": "API token", "kind": "password", "required": True,
             "placeholder": "api token"},
        ],
        "note": "Read-only API user only. Disable host/trigger write scopes.",
    },
    {
        "id": "jira",
        "name": "Jira / OpenProject",
        "description": "Ticket search and status. The escalation path already creates "
                       "tickets; this lets the assistant read them back.",
        "category": "Productivity",
        "badge": "",
        "source": "upstream",
        "transport": "streamable_http",
        "url_default": "",
        "fields": [
            {"key": "url", "label": "MCP server URL", "kind": "text", "required": True,
             "placeholder": "http://jira-mcp:8000/mcp"},
            {"key": "token", "label": "API token", "kind": "password", "required": True,
             "placeholder": "api token"},
        ],
        "note": "Read issues only. Ticket creation stays on the reviewed escalation flow, "
                "not on a tool the model can call freely.",
    },
    {
        "id": "filesystem",
        "name": "Filesystem",
        "description": "Read files from a mounted directory — runbooks, exports and logs "
                       "that are not in the knowledge base.",
        "category": "Files",
        "badge": "",
        "source": "upstream",
        "transport": "streamable_http",
        "url_default": "",
        "fields": [
            {"key": "url", "label": "MCP server URL", "kind": "text", "required": True,
             "placeholder": "http://filesystem-mcp:8000/mcp"},
        ],
        "note": "Mount one directory read-only. Never mount a host path or a secrets "
                "volume — a filesystem tool can read whatever it is given.",
    },
    # ------------------------------------------------------------------- custom
    {
        "id": "custom",
        "name": "Custom MCP connector",
        "description": "Point the assistant at any MCP server you run, over streamable "
                       "HTTP or SSE.",
        "category": "Custom",
        "badge": "",
        "source": "custom",
        "transport": "streamable_http",
        "url_default": "",
        "fields": [
            {"key": "name", "label": "Display name", "kind": "text", "required": True,
             "placeholder": "Internal CMDB"},
            {"key": "url", "label": "MCP server URL", "kind": "text", "required": True,
             "placeholder": "http://my-mcp:8000/mcp"},
            {"key": "token", "label": "Bearer token", "kind": "password",
             "required": False, "placeholder": "optional"},
            {"key": "transport", "label": "Transport (streamable_http or sse)",
             "kind": "text", "required": False, "placeholder": "streamable_http"},
        ],
        "note": "Only read tools are exposed to the assistant: the catalogue is filtered "
                "to reads and anything matching a write verb is refused, whoever wrote "
                "the server.",
    },
]


def catalog_entry(connector_id: str) -> dict | None:
    for entry in CATALOG:
        if entry["id"] == connector_id:
            return entry
    return None


def catalog_by_category() -> list[dict]:
    """Catalog grouped for the gallery, preserving the order categories first appear."""
    order: list[str] = []
    grouped: dict[str, list[dict]] = {}
    for entry in CATALOG:
        cat = entry["category"]
        if cat not in grouped:
            grouped[cat] = []
            order.append(cat)
        grouped[cat].append(entry)
    return [{"category": c, "connectors": grouped[c]} for c in order]