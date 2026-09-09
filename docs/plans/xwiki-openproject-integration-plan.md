# Integration Plan: XWiki (KB) + OpenProject (Tickets & KB)

> Status: PLAN (awaiting phased approval) — created per user request
> Date: 2026-09-09

## Current State
- KB ingestion: **Confluence sync only** (`app/knowledge/` + `system_settings key=confluence`)
- Tickets: **Jira only** (`app/integrations/jira.py`, `system_settings key=jira`)
- OpenProject: **already running in cluster** (ns `openproject`, v17.7.2,
  `https://openproject.drlinuxer.com`, API v3 reachable — 401 without API key)
- XWiki: **not deployed** anywhere in the cluster

## Goal
Add two more providers alongside existing Confluence/Jira (NOT replace):
1. **XWiki** → KB articles ingestion (RAG)
2. **OpenProject** → Work-package ticket sync + wiki pages as KB

---

## Phase 1 — OpenProject Integration (no new infra)
1. **Settings UI**: extend `IntegrationsConfig.tsx` with `openproject` tab
   (fields: `base_url`, `api_key` (secret), `project_id`, `wiki_enabled`)
2. **Backend**:
   - `app/integrations/openproject.py` — API v3 client (work packages, wiki pages)
   - `system_settings key=openproject` storage (same pattern as jira)
   - `/api/settings/integrations/openproject` GET/PUT/test endpoints
   - Ticket sync: map OpenProject **work packages** → `jira_tickets`-style table
     (or generalize: provider column `source = jira | openproject`)
   - KB ingestion: OpenProject **wiki pages** → same chunker/embed pipeline as Confluence
3. **Frontend**: Tickets page + Knowledge page show source badge (`jira`/`openproject`)

## Phase 2 — XWiki Deployment (new infra)
1. Manifests `infra/k8s/xwiki/`:
   - Deployment (image `xwiki:x.y-postgres-tomcat`) + PVC + Service
   - Reuse rag-chatbot PostgreSQL? NO — XWiki bundles its own schema;
     create separate DB `xwiki` on existing CNPG cluster + user
   - Ingress `xwiki.drlinuxer.com` (cert-manager TLS)
   - Harbor mirror image (air-gapped rule)
2. Resource budget: ~1 vCPU / 2Gi

## Phase 3 — XWiki Integration (app)
1. `app/integrations/xwiki.py` — REST API client (`/rest/wikis/.../pages`)
2. Settings tab (`base_url`, `username`, `api_token`, `spaces`)
3. Sync job in Celery beat (alongside Confluence sync)
4. Domain mapping: XWiki spaces → classifier domains

## Sequencing & Effort
| Phase | Est. effort | Depends on |
|---|---|---|
| 1 OpenProject app | ~2 sessions | API key from OpenProject admin |
| 2 XWiki deploy | ~1 session | Harbor image mirror (air-gap) |
| 3 XWiki app | ~1.5 sessions | Phase 2 |

## Decisions needed from user (before Phase 1 start)
- OpenProject **API key** (admin → My Account → Access Tokens)
- Which OpenProject **project(s)** to sync?
- Ticket unification: single unified list with `source` badge, or separate tab?
- XWiki version pin + whether user already has an external XWiki license/community instance preference
