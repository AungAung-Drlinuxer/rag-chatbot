# Valkey 9.1 Sentinel — pre-written for future migration

Status: **prepared, NOT applied**. This mirrors `infra/k8s/redis/` (Redis 7.4
Sentinel HA) as a drop-in replacement for a later migration. Until cutover,
keep running the `redis-*` stack.

## Files

| File | Contents |
|------|----------|
| `10-valkey-data.yaml` | Secret `valkey-pass`, ConfigMap `valkey-config` (valkey.conf / sentinel.conf / users.acl), StatefulSet `valkey-data` (3 replicas), Service `valkey-data-headless` |
| `20-valkey-sentinel.yaml` | StatefulSet `valkey-sentinel` (3 replicas, DNS-wait init fix baked in), Services `valkey-sentinel-headless`, `valkey-sentinel-service`, `valkey-service` |
| `sentinel.conf` | Reference copy of the ConfigMap's sentinel.conf (single source of truth is the ConfigMap) |

## Key differences from the redis-* manifests

- **Image**: `valkey/valkey:9.1.2` (BSD-3, Linux Foundation). Alpine variant
  exists for local dev: `valkey/valkey:9.1.2-alpine`.
- **Binaries**: `valkey-server`, `valkey-cli` (no `redis-*` names; sentinel is
  run as `valkey-server /conf/sentinel.conf --sentinel`).
- **fsGroup 1000** (not 999): the valkey container runs uid=999 / gid=1000.
- **Sentinel master set name**: `rag-chatbot-valkey` (was `rag-chatbot-redis`).
- **Sentinel auth**: `requirepass` / `sentinel auth-pass` enabled (the redis
  reference `sentinel.conf` intent), probes use `-a`.
- **DNS-wait init** (from `30-redis-sentinel-fix.yaml`) is merged into
  `20-valkey-sentinel.yaml` — sentinel FATAL-exits if the monitor hostname
  does not resolve at boot (CoreDNS not ready after node restart).

## Applying

```bash
kubectl apply -f infra/k8s/valkey/10-valkey-data.yaml
kubectl rollout status sts/valkey-data -n rag-chatbot
kubectl apply -f infra/k8s/valkey/20-valkey-sentinel.yaml
kubectl rollout status sts/valkey-sentinel -n rag-chatbot
```

Replace every `__REPLACE_WITH_RANDOM_32_BYTES__` with one shared random
password before applying (same convention as the redis manifests).

## Application config at cutover

```env
REDIS_MODE=sentinel
REDIS_SENTINELS=valkey-sentinel-service.rag-chatbot.svc.cluster.local:26379
REDIS_MASTER_NAME=rag-chatbot-valkey
REDIS_PASSWORD=<same as the manifests>
```

Client libraries need **no code changes**: redis-py and kombu's
`sentinel://` transport speak RESP to valkey-sentinel unchanged. Optional: the
`valkey-redis-compat` shim if you later want native `valkey://` URLs.

## Migration notes (redis 7.4 → valkey 9.1)

- **RDB/AOF files from Redis 7.4 are NOT loadable by Valkey** (official
  migration matrix: `CE 7.4 → n/a` for physical migration; Valkey is a fork
  of Redis OSS 7.2). Do not copy the old PVC data over.
- Your Redis data (cache, rate-limit counters, Celery broker/results) is
  ephemeral → simplest cutover: bring Valkey up empty and switch the app env.
  For a zero-loss option, stand Valkey up beside Redis and DUMP/RESTORE or
  drain the Celery queue first.
- Run both stacks in parallel (distinct resource names allow it), switch
  `REDIS_*` env, then decommission `infra/k8s/redis/`.

## Local dev equivalent (backend/docker-compose.dev.yml)

```yaml
  valkey:
    image: valkey/valkey:9.1.2-alpine
    ports: ["6380:6379"]
    volumes: [valkeydata:/data]
    test: ["CMD", "valkey-cli", "ping"]
```
