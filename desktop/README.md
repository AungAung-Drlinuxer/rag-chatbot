# IT Help Chatbot — Desktop (Tauri 2 + React/TypeScript)

> Native + web client for the IT Help Chatbot backend. **Presentation layer only** — it
> never talks to PostgreSQL/LDAP/Confluence/Jira/the LLM directly; it talks only to the
> FastAPI backend over HTTPS + JWT + SSE.

---

## Table of Contents
1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Features](#features)
4. [Directory Structure](#directory-structure)
5. [Setup](#setup)
6. [Development](#development)
7. [Build](#build)
8. [Web Deployment (Docker/nginx)](#web-deployment)
9. [Tauri Commands](#tauri-commands)
10. [API Integration](#api-integration)
11. [Configuration](#configuration)
12. [Security](#security)

---

## Overview
A **Tauri 2** desktop app (and a **web build** via Vite) that chats with the backend.
It renders Markdown answers, streams tokens over SSE, shows the confidence gate + sources,
lets users rate answers, escalate to Jira, and (for admins) manage the KB.

**Key principle:** the desktop is the **presentation layer**; all enterprise security,
auth and integrations happen in the backend.

## Tech Stack
- **Tauri 2** (Rust) — native shell, OS keyring (DPAPI/Keychain/libsecret)
- **React 18 + TypeScript** — UI
- **Vite** — dev server + build (`strictPort 1420` — Tauri dev URL must match)
- **react-markdown + remark-gfm** — markdown answers w/ code blocks
- **@tauri-apps/api** — invoke keyring commands
- **puppeteer-core** (dev) — E2E login/chat smoke test

## Features
| Area | Feature |
|---|---|
| **Auth** | Login screen (username/password) → `POST /api/auth/login` → JWT → **OS keyring** (save/load/clear) · logout |
| **Chat** | SSE streaming (`fetch` + `ReadableStream`, JWT Bearer) · markdown render · gate badges (`domain · conf · ✓answer/⚠caution`) |
| **Context panel** | Confidence · IT Lead (contact) · Retrieved sources · Feedback (helpful/not) · **Escalate** |
| **Escalate** | `POST /api/escalate` → shows result (`jira_key`, `reporter`, link) |
| **Articles** | Search + select · **Manage KB (Admin)** panel — add-article form · Sync KB · delete (admin/agent only) |
| **RBAC-aware** | Role badge (`IT Engineer · Admin`) · admin UI only for admin/agent · 403 handling |
| **Session** | JWT restored from keyring on launch (`GET /api/auth/me` → role) |

## Directory Structure
```
desktop/
├── src/
│   ├── App.tsx            # 3-pane UI: sidebar nav + chat + context panel; login screen; admin panel
│   ├── api.ts             # API client: login, streamChat (SSE), escalate, feedback, articles, contacts, getMe + CRUD/sync
│   ├── sse.ts             # SSE via fetch + ReadableStream (JWT Bearer)
│   ├── store.ts           # state helpers (session, messages)
│   ├── styles.css         # design system (indigo accent, slate palette, radius, shadows, Inter)
│   ├── main.tsx           # React root (imports styles)
│   ├── vite-env.d.ts      # Vite types
│   └── ui-preview.html    # static populated design preview (documentation)
├── src-tauri/
│   ├── Cargo.toml         # tauri 2 + keyring crate
│   ├── src/lib.rs         # Tauri commands: save_tokens / load_tokens / clear_tokens (keyring)
│   ├── src/main.rs        # entry
│   ├── build.rs
│   ├── tauri.conf.json    # bundle msi/deb, identifier com.drlinuxer.ithelpchatbot, updater config
│   ├── capabilities/default.json
│   └── icons/
├── scripts/
│   ├── login-screenshot.mjs  # E2E login+chat smoke (headless Chrome)
│   └── live-demo.mjs         # containerized live-demo driver
├── Dockerfile             # node build → nginx (web deploy)
├── nginx.conf             # SPA + /api proxy (SSE-aware)
├── vite.config.ts         # strictPort 1420
├── package.json
└── .dockerignore
```

## Setup
```bash
cd desktop
npm install
# esbuild postinstall may be blocked on Windows — approve once:
npx install-scripts approve esbuild && npm rebuild esbuild   # if npm install-scripts guard fires
```

## Development
```bash
# Tauri desktop (needs Rust + backend running on :8000)
# backend at http://127.0.0.1:8000 (set VITE_API_URL if different)
npm run tauri dev

# Web only (Vite dev on :1420) — set VITE_API_URL to the backend for CORS access
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

## Build
```bash
npm run build                      # Vite → dist/ (static SPA)
npm run tauri build                # native installers (MSI/DEB) — needs signing certs (Phase 10)
# E2E smoke:
node scripts/login-screenshot.mjs  # headless login→chat→screenshots
```
> A **signed** desktop build (code-signing + auto-updater) requires provisioning certs +
> updating `tauri.conf.json` + `updater/latest.json` (Phase 10). Until then, run
> `tauri dev` / unsigned builds.

## Web Deployment
The same app ships as a **web SPA** (nginx) — `docker build` (node build → nginx):
```bash
docker build -t harbor.drlinuxer.com/it-help-chatbot/frontend:0.1.0 .
docker push harbor.drlinuxer.com/it-help-chatbot/frontend:0.1.0
```
`nginx.conf` serves the SPA (`try_files … /index.html`) and proxies `/api` to the
`backend` service with `proxy_buffering off` + 600s (SSE). Built with **`VITE_API_URL=""`**
(same-origin via the proxy → no CORS in prod). K8s: `infra/k8s/frontend.yaml`
(Deployment + Service + Ingress, `chat.drlinuxer.com`, `nginx` class). Public Harbor
project → no pull-secret.

> Desktop build uses an **absolute** `VITE_API_URL` (backend host); web build uses `""`
> (relative, nginx proxy). Set it at build time accordingly.

## Tauri Commands
Rust (`src-tauri/src/lib.rs`) exposes keyring commands (invoked from `api.ts`):
| Command | Effect |
|---|---|
| `save_tokens(access, refresh)` | store JWT in OS keyring |
| `load_tokens()` | read JWT (null if none) |
| `clear_tokens()` | remove on logout |

## API Integration
`api.ts` (fetch wrapper):
| Function | Endpoint |
|---|---|
| `login(u, p)` | `POST /api/auth/login` |
| `getMe()` | `GET /api/auth/me` → username + role |
| `streamChat(...)` | `POST /api/chat/stream` (SSE) |
| `escalate(...)` | `POST /api/escalate` |
| `submitFeedback(...)` | `POST /api/feedback` |
| `searchArticles(...)` | `POST /api/articles/search` |
| `createArticle/deleteArticle/triggerSync` | article CRUD + sync (admin) |
| `getContact(domain)` | `GET /api/contacts/{domain}` |

All requests attach `Authorization: Bearer <JWT>` from the keyring (via `setAuthToken`).

## Configuration
| Var | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | `http://127.0.0.1:8000` | Backend base (web build: `""` same-origin; desktop: absolute host) |

`.env.example` documents it. Tauri dev URL must be exactly `http://localhost:1420`
(`strictPort`).

## Security
- **JWT stored in OS keyring** (DPAPI/Keychain/libsecret) — not localStorage.
- **No secrets in the bundle** — key passed via backend (never baked into the app).
- **Presentation-only** — no direct DB/LDAP/Confluence/Jira/LLM access.
- **CORS** — allowed origins limited in the backend.
- **403 handling** — admin-only UI hidden for non-admin roles.
