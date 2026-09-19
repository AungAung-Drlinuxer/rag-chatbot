#!/usr/bin/env bash
# 02 — Kasm control plane (db + app roles) on the kasm-app VM.
#
# RUN INSIDE THE kasm-app VM as root:   sudo bash 02-install-app.sh
#
# The control plane is ONE VM with two roles, because the roles only talk over TCP (the web
# app reaches the database on 5432), and on a single host that is just the loopback. The two
# values this prints — DATABASE_PASSWORD and MANAGER_TOKEN — are required by 03-install-agent.sh.
# Capture them NOW: the agent cannot check in without the manager token, and the manager token
# is only shown at database-install time.
set -euo pipefail

KASM_VERSION="${KASM_VERSION:-1.19.0}"
SRC="https://kasm-static-content.s3.amazonaws.com"
DB_USER="${DB_USER:-kasm}"
DB_NAME="${DB_NAME:-kasm}"

# Rolling images (the 1.19 default) auto-update the workspace images. Static images give manual
# update control, which is what an on-prem/air-gapped estate wants — one deliberate upgrade,
# not a surprise image change under a running class.
STATIC=--use-static-images

echo "=== 0. host preparation ==="
apt-get update -qq
apt-get install -y -qq curl ca-certificates jq openssl
timedatectl set-timezone Asia/Yangon || true
echo "  kernel: $(uname -r)   os: $(. /etc/os-release; echo "$PRETTY_NAME")"
# Kasm's installer enforces its own checks (swap, ports, disk) — do not fight them, pass flags.

echo
echo "=== 1. download and verify the installer ==="
cd /tmp
curl --fail-early -fO "$SRC/kasm_release_${KASM_VERSION}.tar.gz"
curl --fail-early -fO "$SRC/kasm_release_${KASM_VERSION}.tar.gz.sha256sum"
sha256sum --check "kasm_release_${KASM_VERSION}.tar.gz.sha256sum"
tar -xf "kasm_release_${KASM_VERSION}.tar.gz"
echo "  extracted: $(ls -d /tmp/kasm_release | head -1)"

# --- swap -------------------------------------------------------------------------------
# The installer aborts without swap. A 4 GiB swapfile on an 8 GiB control-plane VM is cheap
# insurance for the database; the 48 GiB agents deliberately run without it (-H) because
# swapping a Docker host turns a slow session into a stalled one.
if ! swapon --show | grep -q .; then
  echo
  echo "=== 2. creating 4 GiB swap (the installer requires some) ==="
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "  swapfile active"
fi

echo
echo "=== 3. DATABASE role ==="
echo "  (capture DATABASE_PASSWORD and MANAGER_TOKEN from the output below)"
sudo bash kasm_release/install.sh --role db \
  --database-user "$DB_USER" --database-name "$DB_NAME" \
  --admin-password "${KASM_ADMIN_PASSWORD:-}" \
  ${KASM_ACTIVATION_KEY:+-a "$KASM_ACTIVATION_KEY"} \
  2>&1 | tee /root/kasm-db-install.log
echo
echo "  --- the two values you need, from /root/kasm-db-install.log ---"
grep -iE "database password|manager token|admin password|Database Password|Manager Token" /root/kasm-db-install.log || true

echo
read -rp "  paste DATABASE_PASSWORD now: " DB_PASS
echo
echo "=== 4. WEB APP role ==="
sudo bash kasm_release/install.sh --role app $STATIC \
  --db-hostname 127.0.0.1 --db-password "$DB_PASS" \
  --database-user "$DB_USER" --database-name "$DB_NAME" \
  ${KASM_SSL_CERT:+--ssl-public-cert "$KASM_SSL_CERT"} \
  ${KASM_SSL_KEY:+--ssl-private-key "$KASM_SSL_KEY"} \
  2>&1 | tee /root/kasm-app-install.log

echo
echo "=== done ==="
echo "  UI:  https://$(hostname -I | awk '{print $1}')"
echo "  login: admin@kasm.local  (password was generated above unless --admin-password was set)"
docker ps --format '  {{.Names}}\t{{.Status}}'
