#!/usr/bin/env bash
# Does the token have PRIVILEGES, not just a working secret?
#
# /version returning 200 only proves the token authenticates. PVE answers that endpoint for
# any valid token, including one with no ACL at all. The proxy check is
# /access/permissions returning {"data":{}} — an empty map means no effective privileges.
#
# This asks the actual endpoints the MCP's read tools call, so a failure names the missing
# privilege instead of surfacing later as an opaque tool error.
#
# Credentials come from the Secret; the URL is masked.
set -euo pipefail
NS=rag-chatbot
POD=pve-acl-check
WORK="$(mktemp -d "${LOCALAPPDATA:-$HOME}/Temp/pve-acl-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/pod.yaml" <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: pve-acl-check
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
          ask() {
            code=$(curl -sS -k -m 15 -o /tmp/b.txt -w '%{http_code}' \
              -H "Authorization: PVEAPIToken=$PROXMOX_TOKEN_ID=$PROXMOX_TOKEN_SECRET" \
              "$PROXMOX_URL$1" 2>/dev/null || echo 000)
            n=$(head -c 200 /tmp/b.txt | tr -d '\n')
            case "$code" in
              200) printf "  %-38s 200 OK        %s\n" "$2" "$(echo "$n" | head -c 90)" ;;
              403) printf "  %-38s 403 DENIED    %s\n" "$2" "$(echo "$n" | head -c 110)" ;;
              *)   printf "  %-38s %s              %s\n" "$2" "$code" "$(echo "$n" | head -c 90)" ;;
            esac
          }
          echo "  --- effective permissions ---"
          curl -sS -k -m 15 -H "Authorization: PVEAPIToken=$PROXMOX_TOKEN_ID=$PROXMOX_TOKEN_SECRET" \
            "$PROXMOX_URL/api2/json/access/permissions" 2>/dev/null | head -c 900 | sed 's/^/    /'
          echo
          echo "  --- what the MCP's read tools need ---"
          ask "/api2/json/nodes"                                   "Sys.Audit        /nodes"
          ask "/api2/json/cluster/resources"                       "perms            /cluster/resources"
          ask "/api2/json/cluster/status"                          "Sys.Audit        /cluster/status"
          ask "/api2/json/cluster/ha/status/current"               "Sys.Audit        /cluster/ha/status"
          ask "/api2/json/storage"                                 "Datastore.Audit  /storage"
          ask "/api2/json/pools"                                   "Pool.Audit       /pools"
          ask "/api2/json/access/users"                            "perms            /access/users"
          ask "/api2/json/access/roles"                            "perms            /access/roles"
          ask "/api2/json/access/acl"                              "perms            /access/acl"
          ask "/api2/json/cluster/backup"                          "Datastore.Audit  /cluster/backup"
          ask "/api2/json/cluster/tasks"                           "Sys.Audit        /cluster/tasks"
          echo
          echo "  --- per-node reads (VM.Audit + Sys.Audit) ---"
          NODE=$(curl -sS -k -m 15 -H "Authorization: PVEAPIToken=$PROXMOX_TOKEN_ID=$PROXMOX_TOKEN_SECRET" \
            "$PROXMOX_URL/api2/json/nodes" 2>/dev/null | sed -n 's/.*"node":"\([^"]*\)".*/\1/p' | head -1)
          if [ -n "$NODE" ]; then
            echo "    first node: $NODE"
            ask "/api2/json/nodes/$NODE/status"      "Sys.Audit        node status"
            ask "/api2/json/nodes/$NODE/qemu"        "VM.Audit         node qemu list"
            ask "/api2/json/nodes/$NODE/lxc"         "VM.Audit         node lxc list"
            ask "/api2/json/nodes/$NODE/storage"     "Datastore.Audit  node storage"
            ask "/api2/json/nodes/$NODE/rrddata?timeframe=hour" "Sys.Audit  node rrd metrics"
          else
            echo "    could not list nodes — cannot test per-node reads"
          fi
YAML

kubectl -n "$NS" delete pod "$POD" --ignore-not-found >/dev/null 2>&1
kubectl -n "$NS" apply -f "$WORK/pod.yaml" >/dev/null
kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Succeeded pod/"$POD" --timeout=220s >/dev/null 2>&1 \
  || kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Failed pod/"$POD" --timeout=10s >/dev/null 2>&1 || true
kubectl -n "$NS" logs "$POD" 2>&1 | tail -32
kubectl -n "$NS" delete pod "$POD" --wait=false >/dev/null 2>&1
