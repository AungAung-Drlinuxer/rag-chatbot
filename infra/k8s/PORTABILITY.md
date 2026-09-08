# rag-chatbot — Deployment Portability Checklist (New Cluster)

Verdict: **the repo is portable** — every file needed to rebuild the stack on a
different cluster is in git, and nothing hard-codes values that cannot be
overridden. This checklist walks through what to change and what to watch.

## What ships in the repo (all in git, `dev` branch)

| Piece | Path | Self-contained? |
|---|---|---|
| Frontend (React SPA) | `desktop/` + `desktop/Dockerfile` + lockfile | ✅ `npm ci` builds offline from Harbor base image |
| Backend (FastAPI) | `backend/` + `backend/Dockerfile` + `uv.lock` | ✅ deps frozen; `BAKE_RERANKER=1` bakes the reranker model (needs internet at BUILD time only) |
| Rerank service | `infra/k8s/rerank-svc/` (app + Dockerfile + uv.lock) | ✅ same — model baked at build |
| K8s manifests | `infra/k8s/**` (22 files + Kustomize root) | ✅ all secrets placeholder-ized |
| Live-cluster dump | `infra/k8s/_source/` | gitignored — reference only |

## One-time prerequisites on the NEW cluster

1. **StorageClass** — manifests use `truenas-iscsi`. Replace with the target
   cluster's class:
   ```
   grep -rl "truenas-iscsi" infra/k8s/ | xargs sed -i 's/truenas-iscsi/<YOUR_SC>/'
   ```
   (Or create an alias StorageClass named `truenas-iscsi` backed by the new provisioner.)

2. **CloudNativePG operator** — must be installed before applying `postgres/`:
   ```
   kubectl apply -f https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.24/releases/cnpg-1.24.0.yaml
   ```

3. **cert-manager** + a ClusterIssuer named `drlinuxer-issuer` (or edit
   `ingress/10-ingress.yaml` to use your issuer / provide your own TLS secret).

4. **KEDA** (optional — only if you want celery autoscaling; otherwise delete
   `celery/10-worker.yaml`'s ScaledObject block and set a fixed replica count).

5. **Harbor (or any registry)** — build & push the four images:
   ```
   docker build -t <registry>/ragchatbot/backend:0.0.15 backend/
   docker build -t <registry>/ragchatbot/frontend:0.0.26 desktop/
   docker build -t <registry>/rag-chatbot/rerank-svc:1.0.1 infra/k8s/rerank-svc/   # build context = infra/k8s/rerank-svc
   docker build -t <registry>/platform/ollama:0.5.7-models <ollama-dir>          # needs model bake step
   ```
   Then `grep -rl "harbor.drlinuxer.com" infra/k8s/ | xargs sed -i 's|harbor.drlinuxer.com|<registry>|'`.

6. **Fill secrets** — every `__REPLACE_WITH_*__` placeholder:
   ```
   grep -rn "__REPLACE_WITH" infra/k8s/
   ```
   Inject via `kubectl create secret ... --dry-run -o yaml | kubectl apply -f -`,
   sealed-secrets, or Vault. **Never commit real values.**

## Environment-specific values to change

| Where | What | Default in repo |
|---|---|---|
| `ingress/10-ingress.yaml` | hostname + TLS issuer | `chat.drlinuxer.com`, `drlinuxer-issuer` |
| `backend/10-deployment.yaml` | `ALLOWED_DOMAINS`, `CONFLUENCE_*`, `SMTP_*`, LDAP group DNs | drlinuxer values |
| `backend-secrets` | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `RERANK_API_KEY`, `EMBED_API_KEY` | placeholders |
| `ollama/10-ollama.yaml` | image with baked models | `platform/ollama:0.5.7-models` |
| `*/10-*.yaml` | `storageClassName` | `truenas-iscsi` |

## What auto-bootstraps (no manual SQL needed)

* CNPG `postInitApplicationSQL` creates the `vector` extension.
* Backend startup (`init_db()` in `app/persistence/database.py`) creates ALL
  tables idempotently (`users`, `chat_*`, `feedback`, `rbac_matrix`,
  `classifier_domains`, `approvals`, `runtime_kv`, …) plus best-effort column
  migrations and the FTS index over `langchain_pg_embedding`.
* The `langchain_pg_collection` / `langchain_pg_embedding` tables are
  auto-created by LangChain's PGVector store on first retrieval call.
* RBAC matrix + 6 default classifier domains are seeded by the app on boot.

## Data migration (optional)

Fresh cluster = empty database. If you must carry conversations/KB content:

```bash
# On the OLD cluster
kubectl -n rag-chatbot exec postgres-ha-1 -- pg_dump -U postgres -Fc assistant > dump.sql.f
# On the NEW cluster (after pods are up)
kubectl -n rag-chatbot exec -i postgres-ha-1 -- pg_restore -U postgres -d assistant --clean --if-exists < dump.sql.f
```

KB vectors live in `langchain_pg_embedding` — included in the same dump. If
instead you re-import from Confluence, just run a KB sync from Settings after
configuring the Confluence credentials.

## Air-gap notes

* Backend/rerank/embedding models are **baked into images** at build time
  (`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1` at runtime). The BUILD machine
  needs internet once; the cluster never does.
* Ollama image ships with the models inside (or pre-seed
  `embedding-models-pvc`).
* `npm ci` / `uv sync` run on the build machine only.

## Known gaps (not blockers, but know them)

1. `infra/k8s/keycloak/` has no manifests yet — the running Keycloak was
   installed manually. If you need SSO on the new cluster, install the
   Keycloak operator separately or copy the live YAML from `_source/`.
2. Monitoring stack (Prometheus/Grafana) is not in the repo — CNPG's
   `PodMonitor` config map is included, but the scraper is cluster-level.
3. `_source/` contains the REAL current secrets (gitignored). Delete it before
   handing the repo to anyone outside the team.
