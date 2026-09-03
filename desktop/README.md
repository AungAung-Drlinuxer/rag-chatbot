# IT Help Chatbot — Desktop (Tauri 2 + React/TypeScript)

> Native + web client for the IT Help Chatbot backend. **Presentation layer only** — it
> never talks to PostgreSQL/LDAP/Confluence/Jira/the LLM directly; it talks only to the
> FastAPI backend over HTTPS + JWT + SSE.

---

## Table of Contents
1. [Layout — feature-sliced](#layout)
2. [Governance rules (enforced by ESLint)](#governance)
3. [Developer onboarding](#onboarding)
4. [Verification gates](#gates)
5. [Build & Web Deployment](#deploy)
6. [Tauri](#tauri)
7. [API endpoints map](#api-map)
8. [Configuration](#config)
9. [Security](#security)

---

<a name="layout"></a>
## Layout — feature-sliced

`src/` root holds **only 4 files**. Everything else is either shared transport,
shared UI primitives, or a feature module owning its own api/page/components.

```
desktop/
├── src/
│   ├── main.tsx                     # React root
│   ├── App.tsx                      # session bootstrap + route switch (1,060L — see BACKLOG)
│   ├── styles.css                   # design tokens (borderless/soft-shadow system, Inter)
│   ├── vite-env.d.ts
│   │
│   ├── shared/
│   │   └── api/client.ts            # ★ the ONLY sanctioned raw-fetch home:
│   │                                #   BASE url, token store, 401 single-flight
│   │                                #   refresh, authHeaders(), Tauri keyring
│   ├── components/
│   │   ├── ui/                      # shadcn primitives (button, dialog, page shell…)
│   │   ├── HighlightedCode.tsx      # shiki code blocks (8 langs)
│   │   └── …                        # cross-feature UI only
│   ├── lib/utils.ts
│   │
│   └── features/<domain>/           # auth chat tickets knowledge users settings
│       │                            #   dashboard audits conversations
│       ├── api.ts                   # ★ endpoint calls for the domain (uses apiFetch)
│       ├── model.ts                 # types + pure helpers (no React, no fetch)
│       ├── pages/<Domain>Page.tsx   # route-level component
│       ├── components/…             # presentational parts
│       └── hooks/…                  # e.g. chat/hooks/useChatStream.ts —
│                                    #   THE single SSE contract (meta/stage/token/
│                                    #   approval_request/done) for HITL interrupt
│
├── scripts/                         # puppeteer-core QA drivers (step2/3/4 + live-fe verify)
├── src-tauri/                       # Rust shell: keyring commands, updater, capabilities
├── eslint.config.js                 # governance gates (see below)
├── Dockerfile · nginx.conf          # web deploy: node build → nginx, same-origin /api
└── vite.config.ts                   # strictPort 1420, @/ alias, dev /api proxy
```

Reference split status (2026-09-03): Steps 1–4 complete — legacy `src/api.ts` shim
**deleted**, all pages moved to `features/*/pages/`, ESLint gate in force.
`ragchatbot/frontend:0.0.01` is live-verified with this layout.

<a name="governance"></a>
## Governance rules (enforced by ESLint)

| # | Rule | Enforcement |
|---|---|---|
| G1 | **No raw `fetch()` in components/pages.** Endpoint calls belong in `features/<domain>/api.ts` using `apiFetch` (token + 401-refresh handled once) | `no-restricted-globals` = **error**; allowed only in `shared/api/client.ts` + `features/*/api.ts` |
| G2 | **No `@/api` / `./api` imports.** The legacy shim is gone — import the feature directly (`@/features/tickets/api`) | `no-restricted-imports` = **error** |
| G3 | Cross-feature calls go through the other feature's **api module**, never deep-import its internals | code review; ratchet: add `import/no-restricted-paths` when zones are declared |
| G4 | SSE contract changes must land in `features/chat/hooks/useChatStream.ts` + `shared/api/client.ts` only | review checklist item |
| G5 | UI bar: borderless soft-shadow panels, SettingRow pattern, lucide SVG (never emoji), RWD with drawer | screenshot review per PR |

Baseline rules (no-unused-vars etc.) are **warning-only during migration**; a dedicated
cleanup PR ratchets them to error. See `eslint.config.js` comments for the off-list
(print-report escapes, exhaustive-deps) — do not silently remove those exceptions.

<a name="onboarding"></a>
## Developer onboarding

1. `git clone` → branch `dev` (never push to `main` directly; `main` = tagged, deployable)
2. `cd desktop && npm ci`
   - Windows: if the esbuild postinstall guard fires → `npx install-scripts approve esbuild && npm rebuild esbuild`
3. Point at a backend: `VITE_API_URL=https://api.drlinuxer.com npm run dev`
   (or run the backend locally on :8000 — vite dev proxies `/api` same-origin)
4. Dev login: the admin account from the cluster ConfigMap (see backend DEPLOYMENT-NOTES; ask the team, never commit credentials)
5. Make your change **inside one feature folder** when possible; new endpoint → add to that feature's `api.ts`
6. Run the gates (below) → PR into `dev` → screenshot evidence attached → squash-merge
7. Release: tag → image build → Harbor push → cluster replace → **live verify** (see [deploy](#deploy))

First-issue suggestions: fix one of the 2 remaining lint warnings; delete
`features/settings/pages/LegacySettings.tsx` (orphan); add a Vitest unit for
`useChatStream` event mapping.

<a name="gates"></a>
## Verification gates (all must pass before PR merge)

```bash
cd desktop
npx tsc --noEmit                    # 0 errors
npx eslint src                      # governance violations: 0
npm run build                       # Vite production build
# live evidence (needs built dist + preview/API access):
npx vite preview --port 1420 &
VERIFY_USER=<admin> VERIFY_PASS=<pw> node scripts/step4-pages-verify.mjs   # 7-page walk
node scripts/live-fe0001-verify.mjs                                       # full live E2E incl. chat stream
```

Never claim "done" from a local build alone — the user bar is **verified-live**
(served bundle hash + unique strings + screenshot).

<a name="deploy"></a>
## Build & Web Deployment

```bash
# image from this folder — VITE_API_URL="" → same-origin (nginx proxies /api)
docker build -t harbor.drlinuxer.com/ragchatbot/frontend:0.0.02 .
docker push harbor.drlinuxer.com/ragchatbot/frontend:0.0.02
kubectl -n it-help-chatbot set image deploy/frontend \
  frontend=harbor.drlinuxer.com/ragchatbot/frontend:0.0.02
kubectl -n it-help-chatbot rollout status deploy/frontend
# LIVE verify (mandatory): curl https://chat.drlinuxer.com/ → served bundle hash,
# grep the deployed JS for a unique string from your change, then run the
# puppeteer scripts against the live URL. Rollback = set image back one tag.
```

`nginx.conf`: SPA fallback + `/api/` → `backend:80` with `proxy_buffering off` +
600s timeouts (SSE). K8s manifests: production workspace `infra/k8s/frontend.yaml`
(Ingress `chat.drlinuxer.com`). Public Harbor project → no pull-secret.

Image tag convention for this repo's lineage: `0.0.0N` (started 2026-09-03 at 0.0.01).

<a name="tauri"></a>
## Tauri

`src-tauri/src/lib.rs` exposes keyring commands (invoked from `shared/api/client.ts`):

| Command | Effect |
|---|---|
| `save_tokens(access, refresh)` | store JWT in OS keyring (DPAPI/Keychain/libsecret) |
| `load_tokens()` | read JWT (null if none) |
| `clear_tokens()` | remove on logout |

Non-Tauri runs fall back to `sessionStorage` automatically. Desktop builds use an
**absolute** `VITE_API_URL`; web builds use `""`. Signed MSI/DEB + auto-updater =
Phase 10 (certs not provisioned yet) — `npm run tauri dev` works unsigned.

<a name="api-map"></a>
## API endpoints map

| Feature module | Endpoints |
|---|---|
| `features/auth` | POST /api/auth/login · GET /api/auth/me · GET /health |
| `features/chat` | POST /api/chat/stream (SSE) · /api/escalate · /api/feedback · /api/attachments · /api/approvals(+PUT decision) · GET /api/contacts/{domain} · /api/escalations |
| `features/conversations` | GET/PATCH/DELETE /api/conversations* (+ `admin-api.ts`: /api/admin/conversations*, export) |
| `features/tickets` | GET/POST /api/tickets · PUT /api/tickets/{ref} · comments · attachments |
| `features/knowledge` | /api/articles* (search, CRUD, draft, browse, list, sync-status) |
| `features/users` | /api/users* (role/status/reset/password/permissions/assignable) · /api/rbac/matrix · /api/departments |
| `features/settings` | /api/settings* · /api/admin/settings* · smtp(+test) · integrations(+test/status) · /api/runtime |
| `features/dashboard` | /api/dashboard/{stats,conversations,domains,recent-*,health} |
| `features/audits` | /api/admin/audits |

All requests attach an `Authorization: Bearer <jwt>` header sourced from
the keyring (via `setAuthToken`);
401 triggers a single-flight refresh then one retry.

<a name="config"></a>
## Configuration

| Var | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | `http://127.0.0.1:8000` (dev) / `""` (web build) | API base; `""` = same-origin via nginx |
| port 1420 | strict | Tauri dev URL — do not change without updating tauri.conf.json |

<a name="security"></a>
## Security

- JWT in **OS keyring** via Tauri (never localStorage) in desktop builds
- Client-side role/perms only hide UI — every capability is **enforced backend-side**
  (`require_role`/`require_cap`); no security logic lives in this repo's JS
- No secrets committed; dev credentials rotate — ask the team
- XSS: answers render through `react-markdown` (no `dangerouslySetInnerHTML`)
