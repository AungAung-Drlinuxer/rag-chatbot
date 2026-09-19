#!/usr/bin/env bash
# 03 — Kasm AGENT role on kasm-agent1 / kasm-agent2.
#
# RUN INSIDE EACH AGENT VM as root:   sudo bash 03-install-agent.sh
#
# The agent is where the student sessions actually run (VS Code, Jupyter/ML, terminal).
# It is deliberately NOT a Kubernetes pod: Kasm's own documentation is explicit that the
# agent role "runs containerized desktop and application sessions ... Agents are always
# deployed outside of Kubernetes on standard Docker hosts and are never included in the
# Helm chart". So these VMs are the session tier, and the cluster only holds the chatbot.
set -euo pipefail

KASM_VERSION="${KASM_VERSION:-1.19.0}"
SRC="https://kasm-static-content.s3.amazonaws.com"
STATIC=--use-static-images

AGENT_HOSTNAME="${AGENT_HOSTNAME:-$(hostname -I | awk '{print $1}')}"   # must be reachable FROM the app VM
MANAGER_HOSTNAME="${MANAGER_HOSTNAME:?set MANAGER_HOSTNAME=<kasm-app IP>}"
MANAGER_TOKEN="${MANAGER_TOKEN:?set MANAGER_TOKEN=<from the db install>}"

echo "=== 0. host preparation ==="
apt-get update -qq
apt-get install -y -qq curl ca-certificates
timedatectl set-timezone Asia/Yangon || true
echo "  os: $(. /etc/os-release; echo "$PRETTY_NAME")  cores: $(nproc)  mem: $(free -h | awk '/^Mem:/{print $2}')"
echo "  agent hostname: $AGENT_HOSTNAME   manager: $MANAGER_HOSTNAME"

echo
echo "=== 1. reachability (do not skip: the agent checks in over 443) ==="
if ! curl -sk --max-time 8 -o /dev/null "https://${MANAGER_HOSTNAME}/"; then
  echo "  cannot reach https://${MANAGER_HOSTNAME}/ — fix routing/firewall before installing"
  exit 1
fi
echo "  https://${MANAGER_HOSTNAME}/ reachable"

echo
echo "=== 2. download and verify the installer ==="
cd /tmp
curl --fail-early -fO "$SRC/kasm_release_${KASM_VERSION}.tar.gz"
curl --fail-early -fO "$SRC/kasm_release_${KASM_VERSION}.tar.gz.sha256sum"
sha256sum --check "kasm_release_${KASM_VERSION}.tar.gz.sha256sum"
tar -xf "kasm_release_${KASM_VERSION}.tar.gz"

# -H (no-swap-check): deliberately no swap on a 48 GiB container host. Swapping a Docker host
# converts "slow session" into "stalled session", and there is no workload here that needs it.
echo
echo "=== 3. AGENT role ==="
sudo bash kasm_release/install.sh --role agent $STATIC -H \
  --public-hostname "$AGENT_HOSTNAME" \
  --manager-hostname "$MANAGER_HOSTNAME" \
  --manager-token "$MANAGER_TOKEN" \
  2>&1 | tee /root/kasm-agent-install.log

echo
echo "=== done on $(hostname) ==="
docker ps --format '  {{.Names}}\t{{.Status}}'
cat <<'EOF'

reminder — the agent is NOT live until it is enabled in the UI:
  Admin -> Infrastructure -> Docker Agents -> edit this agent -> Enabled -> Save
EOF
