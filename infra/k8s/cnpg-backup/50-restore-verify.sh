#!/usr/bin/env bash
# Restore-verify: the only test that proves the backup is real.
#
# A Backup object reporting `completed` means the operator saw a clean exit. It does not
# mean the bytes are readable. This bootstraps a THROWAWAY cluster from the object store,
# compares row counts against production, and deletes it.
#
# It never touches the production cluster or its PVCs. It creates one small separate
# cluster (10Gi, 1 instance) and removes it at the end.
#
# Usage: bash 50-restore-verify.sh
set -euo pipefail
NS=rag-chatbot
TEST=restore-verify
STORECLASS=truenas-iscsi      # Delete reclaimPolicy, so the throwaway PVC cleans up
WORK="$(mktemp -d "${LOCALAPPDATA:-$HOME}/Temp/restore-verify-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "=== production counts (baseline) ==="
kubectl -n "$NS" exec postgres-ha-1 -c postgres -- psql -U postgres -d assistant -tAc "
select 'kb_meta='||count(*) from kb_meta
union all select 'users='||count(*) from users
union all select 'classifier_domains='||count(*) from classifier_domains
union all select 'chat_messages='||count(*) from chat_messages
union all select 'langchain_pg_embedding='||count(*) from langchain_pg_embedding;" | sed 's/^/  /'

echo
echo "=== bootstrap a throwaway cluster from Garage ==="
cat > "$WORK/test.yaml" <<'YAML'
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: restore-verify
  namespace: rag-chatbot
spec:
  instances: 1
  imageName: ghcr.io/cloudnative-pg/postgresql:16.4
  storage:
    size: 10Gi
    storageClass: truenas-iscsi
  resources:
    requests: {cpu: 100m, memory: 256Mi}
    limits: {cpu: "1", memory: 1Gi}
  bootstrap:
    recovery:
      source: origin
  externalClusters:
    - name: origin
      plugin:
        name: barman-cloud.cloudnative-pg.io
        parameters:
          barmanObjectName: cnpg-backup-store
          serverName: postgres-ha
YAML

kubectl -n "$NS" delete clusters.postgresql.cnpg.io "$TEST" --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "$NS" apply -f "$WORK/test.yaml" >/dev/null

for i in $(seq 1 15); do
  R=$(kubectl -n "$NS" get clusters.postgresql.cnpg.io "$TEST" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)
  PH=$(kubectl -n "$NS" get clusters.postgresql.cnpg.io "$TEST" -o jsonpath='{.status.phase}' 2>/dev/null || true)
  echo "  [t+$((i*20))s] ready=$R phase=$PH"
  [ "$R" = "True" ] && break
  sleep 20
done

if [ "${R:-}" != "True" ]; then
  echo "  RESTORE FAILED — the backup is not recoverable."
  kubectl -n "$NS" get clusters.postgresql.cnpg.io "$TEST" -o jsonpath='{.status.conditions[*].message}{"\n"}' 2>/dev/null || true
  kubectl -n "$NS" delete clusters.postgresql.cnpg.io "$TEST" --wait=false >/dev/null 2>&1 || true
  exit 1
fi

echo
echo "=== restored counts ==="
kubectl -n "$NS" exec "${TEST}-1" -c postgres -- psql -U postgres -d assistant -tAc "
select 'kb_meta='||count(*) from kb_meta
union all select 'users='||count(*) from users
union all select 'classifier_domains='||count(*) from classifier_domains
union all select 'chat_messages='||count(*) from chat_messages
union all select 'langchain_pg_embedding='||count(*) from langchain_pg_embedding;" | sed 's/^/  /'

echo
echo "=== cleanup ==="
kubectl -n "$NS" delete clusters.postgresql.cnpg.io "$TEST" --wait=false >/dev/null 2>&1 || true
echo "  throwaway cluster removed (production untouched)"
echo
echo "Compare the two lists above by eye — every count must match."
