#!/usr/bin/env bash
# Probe the Proxmox API directly with the token from the Secret.
#
# WHY NOT JUST SCALE THE MCP TO 1 AND SEE
# If it fails inside the MCP the error is wrapped three layers deep (bridge -> stdio child
# -> PVE). This asks the PVE API the simplest possible question first, so a failure tells
# us which of the two independent things is wrong: is 8006 reachable from the pod network,
# and does the token authenticate. Only if both pass is the MCP worth starting.
#
# Credentials come from the Secret via envFrom/secretKeyRef, so they never appear in this
# script, on a command line, or in the transcript. The URL is printed MASKED — the host is
# enough to diagnose routing, and it is an internal connection string.
set -euo pipefail
NS=rag-chatbot
POD=pve-token-check
WORK="$(mktemp -d "${LOCALAPPDATA:-$HOME}/Temp/pve-check-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "=== 1. secret shape (keys and emptiness, never values) ==="
kubectl -n "$NS" get secret proxmox-mcp-credentials -o jsonpath='{.data}' | python -c "
import sys, json, base64
d = json.loads(sys.stdin.read() or '{}')
for k in sorted(d):
    raw = base64.b64decode(d[k]).decode('utf-8','replace')
    if k in ('PROXMOX_TOKEN_ID','PROXMOX_TOKEN_SECRET'):
        # show only the shape, never the value
        if k == 'PROXMOX_TOKEN_ID':
            print(f'  {k:22} {\"EMPTY\" if not raw.strip() else raw}')
        else:
            print(f'  {k:22} {\"EMPTY\" if not raw.strip() else str(len(raw))+\" chars (hidden)\"}')
    elif k == 'PROXMOX_URL':
        # mask the host: keep the scheme, the port and the last octet
        if not raw.strip():
            print(f'  {k:22} EMPTY')
        else:
            import re
            m = re.match(r'(https?)://([^:/]+)(:(\d+))?', raw)
            if m:
                host = m.group(2)
                last = host.split('.')[-1]
                print(f'  {k:22} {m.group(1)}://***.***.***.{last}{(\":\"+m.group(4)) if m.group(4) else \"\"}')
            else:
                print(f'  {k:22} (unparsable, {len(raw)} chars)')
    else:
        print(f'  {k:22} {raw}')
"
echo

echo "=== 2. DNS/TCP reachability from a pod, then the API call ==="
cat > "$WORK/pod.yaml" <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: pve-token-check
  namespace: rag-chatbot
spec:
  restartPolicy: Never
  containers:
    - name: check
      image: alpine:3.20
      envFrom:
        - secretRef:
            name: proxmox-mcp-credentials
      command: ["/bin/sh","-c"]
      args:
        - |
          apk add -q curl >/dev/null 2>&1
          HOSTPORT=$(echo "$PROXMOX_URL" | sed -E 's#^https?://##; s#/.*$##')
          HOST=${HOSTPORT%%:*}
          PORT=${HOSTPORT##*:}
          [ "$PORT" = "$HOST" ] && PORT=8006
          echo "  target port: $PORT"
          echo "  --- DNS ---"
          getent hosts "$HOST" >/dev/null 2>&1 && echo "  resolves: yes" || echo "  resolves: NO (DNS failure)"
          echo "  --- TCP ---"
          (nc -z -w6 "$HOST" "$PORT" 2>/dev/null && echo "  tcp $PORT: OPEN") || echo "  tcp $PORT: CLOSED / FILTERED"
          echo "  --- PVE API with the token ---"
          R=$(curl -sS -k -m 15 -o /tmp/body.txt -w '%{http_code}' \
               -H "Authorization: PVEAPIToken=$PROXMOX_TOKEN_ID=$PROXMOX_TOKEN_SECRET" \
               "$PROXMOX_URL/api2/json/version" 2>/tmp/err.txt)
          echo "  HTTP $R"
          if [ "$R" = "200" ]; then
            echo "  TOKEN OK — body:"; head -c 400 /tmp/body.txt | sed 's/^/    /'
          else
            echo "  TOKEN/HTTP FAILED — body:"; head -c 300 /tmp/body.txt | sed 's/^/    /'
            head -c 200 /tmp/err.txt | sed 's/^/    curl: /'
          fi
          echo "  --- who does PVE think we are ---"
          curl -sS -k -m 15 -H "Authorization: PVEAPIToken=$PROXMOX_TOKEN_ID=$PROXMOX_TOKEN_SECRET" \
            "$PROXMOX_URL/api2/json/access/permissions" 2>/dev/null | head -c 700 | sed 's/^/    /'
YAML

kubectl -n "$NS" delete pod "$POD" --ignore-not-found >/dev/null 2>&1
kubectl -n "$NS" apply -f "$WORK/pod.yaml" >/dev/null
kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Succeeded pod/"$POD" --timeout=200s >/dev/null 2>&1 \
  || kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Failed pod/"$POD" --timeout=10s >/dev/null 2>&1 || true
kubectl -n "$NS" logs "$POD" 2>&1 | tail -30
kubectl -n "$NS" delete pod "$POD" --wait=false >/dev/null 2>&1
