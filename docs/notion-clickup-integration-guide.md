# Notion & ClickUp KB Integrations — Setup Guide

> **Scope** — how to connect Notion and ClickUp as knowledge-base sources for the
> RAG pipeline, what each adapter does, and the failure modes to expect.
>
> **Applies to** — backend `v1.6.34+` (adapters + `load_all()` registration),
> frontend `v1.6.25+` (Settings → Integrations cards).

---

## 1. How a KB source plugs in

Every source implements one contract and returns article dicts:

```python
{
    "page_id":    "notion-1f2a...c9",   # stable, source-namespaced
    "title":      "VPN Reconnection Guide",
    "domain":     "network",             # optional → auto-classified when absent
    "source_url": "https://www.notion.so/...",  # citation target
    "body":       "<markdown>",
    "meta":       {"clickup_status": "in progress"},  # optional → chunk cmetadata
}
```

`app/knowledge/loaders.load_all()` aggregates every configured source. Each loader
is wrapped in its own `try/except`, so **one broken integration never blocks the
others** — verified in the test suite ("a raising loader is swallowed and
load_all still returns a list").

`app/knowledge/ingest.py` then:

1. resolves the domain (`_effective_domain` — re-classifies from title/body when the
   tag is not a real pipeline domain),
2. hashes `title + body` for **delta sync** (unchanged pages are skipped, so a
   30-minute sync stays cheap),
3. chunks (section-header aware, title-prefixed), embeds, upserts,
4. merges any `meta` keys into each chunk's `cmetadata` (allow-listed, string-coerced).

**Nothing else needs changing** — the Celery beat schedule already calls
`sync_all()` every 30 minutes, so a newly enabled source starts indexing
automatically.

---

## 2. Notion

### Credentials

| Field | Value |
|---|---|
| `api_token` | Internal integration secret (`ntn_...` / `secret_...`) from https://www.notion.so/my-integrations |
| `source_ids` | *(optional)* comma list of page/database IDs; empty = every page shared with the integration |
| `domain` | *(optional)* KB domain tag; empty = auto-classify |
| `max_pages` | safety ceiling per sync (default 300) |

### 🔴 The number-one failure: pages are not shared

A perfectly valid token still returns **404** for any page that has not been
explicitly shared with the integration. Notion does not distinguish "no such page"
from "not shared with you", so this reads like a token problem.

**Fix:** open the page in Notion → `•••` → **Connections** → add your integration.
Do this for each top-level page; children inherit access.

`test_connection()` separates the two cases for you:

| Result | Meaning |
|---|---|
| `Invalid token (HTTP 401)` | the secret itself is wrong |
| `Connected — N page(s) visible` | good to go |
| `Token valid, but no pages are shared…` | token is fine — go share pages |

### How the adapter reads Notion

* `POST /v1/search` (paginated via `has_more` / `next_cursor`) to discover pages.
* `GET /v1/blocks/{id}/children` **recursively** — a page's children return only the
  top level; any block with `has_children` needs its own call (nested lists, toggles,
  tables, columns). Depth is capped at 6 and blocks per page at 400.
* Block types mapped to Markdown: `heading_1..3`, `paragraph`,
  `bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle`, `quote`, `callout`,
  `code`, `divider`, `bookmark`, `link_preview`, `equation`, `table_row`, `child_page`.
* `rich_text` arrays are **joined** — Notion splits one sentence into many spans
  (bold/link/mention boundaries), so without joining the body reads
  `"How to  reset  the  VPN ?"`.
* Sub-pages are ingested as **their own articles** (they appear in `/v1/search`).

### Rate limits

Notion allows roughly **3 requests/second averaged**, and a recursive walk makes
many calls per page. Every request passes through a process-wide throttle
(`0.34 s` minimum interval) plus `Retry-After`-aware backoff on `429`.

### Known limitation

The Notion API exposes **databases (rows), not database *views***. If you need a
view-level filter, replicate it as an explicit `source_ids` entry or filter after
ingest.

---

## 3. ClickUp

### Credentials

| Field | Value |
|---|---|
| `api_token` | Personal token `pk_...` (ClickUp → Settings → Apps) |
| `doc_ids` | *(optional)* comma list of ClickUp Doc IDs |
| `list_ids` | comma list of List IDs — **required for task ingestion** |
| `include_comments` | `true` to fold task comments into the body (default off) |
| `min_chars` | skip tasks with less text than this (default 120) |
| `domain` | *(optional)* KB domain tag; empty = auto-classify |
| `max_tasks` | safety ceiling per sync (default 500) |

### 🔴 The Bearer-prefix foot-gun

ClickUp wants the **raw token** in the `Authorization` header. Adding the usual
`Bearer ` prefix produces a `401` with a misleading body. The adapter detects this
and returns:

> `Remove the 'Bearer ' prefix — ClickUp expects the raw pk_... token`

### Why tasks are restricted to named Lists

A ClickUp workspace is full of operational noise (`"thanks!"`, `"done"`, `"+1"`).
Indexing all of it pollutes retrieval and buries real documentation. Therefore:

* tasks are read **only from `list_ids` you name**, and
* entries shorter than `min_chars` are dropped.

Where the Docs API is available, prefer **Docs** as the KB surface.

### Metadata (status / priority / assignees / tags)

Task metadata is written **twice**, deliberately:

1. **Into the body** as a Markdown table — so it is semantically searchable and
   visible in the citation card:

   ```markdown
   | Field | Value |
   | --- | --- |
   | Task ID | 86a1bc |
   | Status | in progress |
   | Priority | High |
   | Assignees | aung, kyaw |
   | Tags | network, vpn |
   | Due date | 2026-09-10 |
   | List | Network Runbooks |
   ```

2. **Into chunk `cmetadata`** — so it can be filtered on later:

   ```
   clickup_status, clickup_priority, clickup_assignees, clickup_tags,
   clickup_list, clickup_kind, source
   ```

   ⚠️ `langchain_pg_embedding.cmetadata` is `json` (not `jsonb`) — use `->>`
   rather than the `@>` containment operator.

### Docs API availability

ClickUp's Docs endpoints (`/api/v3/docs/...`) are newer and plan-gated. A `404`/`403`
is **logged and skipped**, never fatal — Docs ingestion simply contributes nothing
while task ingestion continues.

### Rate limits

Free tier allows ~**100 req/min**. The adapter throttles to ~6 req/s and honours
`Retry-After` on `429`.

---

## 4. Domain & RBAC — read this before enabling a source

Retrieval is **domain-filtered** per role by `allowed_domains()`:

| Role | Allowed domains |
|---|---|
| `admin` | *(unrestricted)* |
| `agent` | database, security, network, system, general |
| `knowledge` | *(unrestricted read — v1.6.34 fix)* |
| `user` | general, system |

Consequences:

* Set `domain` on the integration to a domain that the target roles can actually
  read, or leave it empty so `_effective_domain()` classifies it from the content.
* If you tag content with a new domain (e.g. `clickup`) that is not in any role's
  allow-list, **it will be invisible in chat** even though it ingested fine.
* `ROLE_DOMAINS` is configurable without a rebuild (backend ConfigMap / env
  `ROLE_DOMAINS`, format `role=d1,d2;role2=*`).

### v1.6.34 fix

`ROLE_DOMAINS` had **no `knowledge=` entry**, so `allowed_domains("knowledge")`
returned an **empty set** — a Knowledge Manager saw *zero* KB content in chat,
because every retrieved chunk was filtered out by the domain gate. The role now
gets unrestricted read (`knowledge=*`); write/manage authority is still governed
by the separate capability map.

---

## 5. Air-gap / egress

Both Notion and ClickUp are cloud SaaS, so a sync needs outbound HTTPS to
`api.notion.com` and `api.clickup.com`. In a restricted-egress cluster:

* the sync fails **silently and safely** (the loader is guarded, other sources are
  unaffected),
* the chat pipeline is unaffected (it reads Postgres, not the SaaS APIs).

Chat itself still hard-fails over to the on-prem Ollama engine when the LLM
provider is unreachable — KB ingestion and LLM inference are independent paths.

---

## 6. Secrets

Credentials are stored in `system_settings` (DB) via the Settings UI, the same way
as Confluence/Jira. They are **never** written to the repo or a ConfigMap, and the
API only ever returns `token_set: true` — the value itself is not echoed back.

**Do not** put these tokens in `infra/k8s/*.yaml`, `.env` committed to git, or a
Kubernetes Secret managed by hand.

Retrieved KB content is treated as **DATA, never instructions** by the system
prompt, so a Notion/ClickUp page containing text like "ignore all instructions" is
neutralised the same way any other KB hygiene problem is.

---

## 7. Enabling a source (checklist)

```
1. Settings → Integrations → Notion (or ClickUp)
2. Paste the token → Save
3. Click Test  → expect "Connected …" (Notion) / "Connected as <user>" (ClickUp)
   ├─ Notion: "no pages are shared" → share the pages, re-test
   └─ ClickUp: "Remove the 'Bearer ' prefix" → fix the token
4. Set source_ids / list_ids + domain → Save
5. Wait ≤ 30 min (Celery beat) or run a manual sync:
       POST /api/knowledge/sync        (admin)
6. Verify ingestion:
       SELECT count(*) FROM langchain_pg_embedding
        WHERE cmetadata->>'page_id' LIKE 'notion-%';   -- or 'clickup-%'
7. Ask a question that the new content answers and confirm it is cited.
```

## 8. Failure-mode reference

| Symptom | Cause | Fix |
|---|---|---|
| Notion `test` → `Invalid token (HTTP 401)` | wrong/rotated secret | re-issue the integration secret |
| Notion `test` → `Token valid, but no pages are shared` | pages not connected to the integration | page → `•••` → Connections |
| Notion sync finds 0 pages, no error | same as above | same |
| ClickUp `test` → 401 | `Bearer ` prefix present | remove it |
| ClickUp sync returns 0 articles | no `list_ids` / all tasks below `min_chars` | add List IDs or lower `min_chars` |
| ClickUp docs skipped | Docs API plan-gated (404/403) | use task Lists instead |
| Content ingested but never cited | `domain` not in the role's `ROLE_DOMAINS` | retag or extend `ROLE_DOMAINS` |
| Sync stops after the first source | should not happen — loaders are individually guarded | check pod logs for `* load skipped:` |
