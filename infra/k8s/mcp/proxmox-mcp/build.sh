#!/usr/bin/env bash
# Build + publish proxmox-mcp (Proxmox VE MCP behind a stdio->SSE bridge).
set -euo pipefail
VER="${1:?usage: build.sh <version>  e.g. build.sh 1.0.2}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
IMG="harbor.drlinuxer.com/rag-chatbot/proxmox-mcp:${VER}"
echo "building $IMG"
docker build -t "$IMG" .
docker push "$IMG"
echo
echo "deploy:  kubectl apply -f 10-deployment.yaml"
echo
echo "ACTIVATION (deliberately multi-step - hypervisor access should be a decision):"
echo "  1. create a read-only Proxmox API token (role PVEAuditor), e.g."
echo "       pve-audit@pve!mcp        role PVEAuditor on /"
echo "  2. put it in the Secret (never commit the value; prefer a sealed secret):"
echo "       kubectl -n rag-chatbot patch secret proxmox-mcp-credentials \\"
echo "         --type merge -p '{\"stringData\":{\"PROXMOX_URL\":\"https://<pve>:8006\","
echo "           \"PROXMOX_TOKEN_ID\":\"<id>\",\"PROXMOX_TOKEN_SECRET\":\"<secret>\"}}'"
echo "  3. scale it up:  kubectl -n rag-chatbot scale deploy/proxmox-mcp --replicas=1"
echo "  4. Settings -> Integrations -> MCP: proxmox_enabled=true, proxmox_url=http://proxmox-mcp:8000"
echo "  5. verify: kubectl -n rag-chatbot logs -l app.kubernetes.io/name=proxmox-mcp | tail"
echo
echo "  PROXMOX_ENABLE_DESTRUCTIVE must stay UNSET. The destructive tier fails closed"
echo "  in code without it; see the Dockerfile header for the full safety model."
