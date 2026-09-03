# ragchatbot — it-help-chatbot (governance refactor workspace)

Modular-architecture working copy of the **it-help-chatbot** project. Structure here is
the target shape for the production app (see boundary rules below). Live production
deployments still build from the original workspace until this repo is merged back.

## Layout

```
ragchatbot/
├── backend/         FastAPI + LangGraph RAG service  (see backend/DEPLOYMENT-NOTES.md)
│   └── app/{api,core,auth,classifier,orchestration,rag,llm,knowledge,
│            integrations,persistence,observability,tools}/
├── desktop/         Tauri + React client, feature-sliced (Step 1–4 done, verified)
│   └── src/{shared,features/<domain>/{api.ts,api,pages,components,hooks},components}
└── docs/qa/         screenshot evidence from live E2E runs
```

Related components (live in the production workspace, deploy manifests):
`rerank-svc/` standalone cross-encoder scoring service + `infra/k8s/*.yaml`.

## Boundary rules (enforced)

| Rule | Backend | Desktop |
|---|---|---|
| API layer = HTTP only | `app/api/*` routers | pages import `features/*/api.ts` |
| DB access downstream only | `persistence/repositories/` | n/a |
| External systems isolated | `integrations/` | `shared/api/client.ts` (only raw fetch) |
| Config externalized | YAML/config env | `VITE_API_URL` build arg |
| Long work in workers | `workers/` (celery) | n/a |
| Governance gate | ruff + pytest | **eslint: `no-restricted-globals: fetch` + `no-restricted-imports: ./api`** |

## Verification gates (run before every merge)

Desktop:
```bash
cd desktop
npm ci
npx tsc --noEmit            # must be 0 errors
npx eslint src              # governance violations must be 0
npm run build               # must succeed
node scripts/step4-pages-verify.mjs   # 7-page walk against live API
node scripts/live-fe0001-verify.mjs   # FULL live E2E incl. real chat stream
```

Backend:
```bash
cd backend
uv sync && uv run pytest -q
uv run ruff check app workers
```

## Image / deploy convention (user-mandated discipline)

```
build → push harbor.drlinuxer.com/ragchatbot/<component>:<ver> → kubectl set image
→ LIVE VERIFY: served bundle hash + unique strings + screenshot E2E
```
Never declare "done" from a local build alone.
- Frontend tag series restarted at **0.0.01** (2026-09-03) for this repo's lineage.
- Live state at authoring time: `ragchatbot/frontend:0.0.01` on `deploy/frontend`,
  backend `0.22.01` with `RERANK_MODE=remote`, `rerank-svc:1.0.0` (2–4 replicas, HPA).

## Branch flow

- `main` — tagged, deployable (tags = image versions)
- `dev`  — active development; PRs into main require the verification gates above
- Feature branches: `feat/<scope>-<summary>`, one refactor step per PR (see git log)
