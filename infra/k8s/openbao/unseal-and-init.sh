#!/usr/bin/env bash
# OpenBao unseal + cluster bootstrap — drlinuxer-prod
# Usage: bash unseal-and-init.sh
# Reads credentials from .init-credentials.json (gitignored).
set -euo pipefail
cd "$(dirname "$0")"

CRED_FILE=".init-credentials.json"
[ -f "$CRED_FILE" ] || { echo "missing $CRED_FILE"; exit 1; }

KEY1=$(py -3 -c "import json;print(json.load(open(r'$CRED_FILE'))['unseal_keys_b64'][0])")
KEY2=$(py -3 -c "import json;print(json.load(open(r'$CRED_FILE'))['unseal_keys_b64'][1])")
KEY3=$(py -3 -c "import json;print(json.load(open(r'$CRED_FILE'))['unseal_keys_b64'][2])")
ROOT=$(py -3 -c "import json;print(json.load(open(r'$CRED_FILE'))['root_token'])")

echo "== Unseal openbao-0 =="
for k in "$KEY1" "$KEY2" "$KEY3"; do
  kubectl -n openbao exec openbao-0 -- bao operator unseal "$k" >/dev/null
done

echo "== Join standbys =="
kubectl -n openbao exec openbao-1 -- bao operator raft join "http://openbao-0.openbao-internal:8200" >/dev/null 2>&1 || echo "openbao-1 already joined"
kubectl -n openbao exec openbao-2 -- bao operator raft join "http://openbao-0.openbao-internal:8200" >/dev/null 2>&1 || echo "openbao-2 already joined"

echo "== Unseal standbys =="
for pod in openbao-1 openbao-2; do
  for k in "$KEY1" "$KEY2" "$KEY3"; do
    kubectl -n openbao exec "$pod" -- bao operator unseal "$k" >/dev/null || true
  done
done

echo "== Login root =="
kubectl -n openbao exec openbao-0 -- bao login "$ROOT" >/dev/null

echo "== Raft peers =="
kubectl -n openbao exec openbao-0 -- bao operator raft list-peers

echo "== Status =="
for pod in openbao-0 openbao-1 openbao-2; do
  echo "--- $pod"
  kubectl -n openbao exec "$pod" -- bao status 2>&1 | grep -E "Initialized|Sealed|HA Enabled|Active Node"
done
