#!/usr/bin/env bash
# 01 — Clone the three Kasm VMs from the existing ubuntu24-template.
#
# RUN THIS ON THE PROXMOX HOST (pve01), not on the cluster and not in a container:
#   scp infra/kasm/01-clone-vms.sh root@pve01:/root/ && ssh root@pve01 'bash /root/01-clone-vms.sh --dry-run'
#
# WHY CLONE AND NOT INSTALL AN ISO: pve01 already carries `ubuntu24-template` (VMID 9100) with
# cloud-init, an ssh key and the `rkeadmin` user baked in — measured:
#   ide2   data:vm-9100-cloudinit,media=cdrom      <- cloud-init drive present
#   ciuser rkeadmin        sshkeys SET             <- no first-boot console work needed
#   net0   virtio,...,bridge=vmbr1                 <- same bridge as the RKE2 nodes
#   cpu host · machine q35 · scsihw virtio-scsi-single · agent enabled=1
# So there is no ISO to download and no snippet to write. Cloning also inherits the same
# bridge / CPU type / SCSI model / qemu-guest-agent, which is what keeps these VMs looking
# like the rest of the estate.
#
# NOT EXECUTED YET: the Proxmox credential the app holds is PVEAuditor (read-only) by design,
# so provisioning is deliberately not something the chatbot can do. Run this yourself.
set -euo pipefail

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

TEMPLATE=9100
STORAGE=data
BRIDGE=vmbr1

APP_ID=110;  APP_CORES=4;  APP_MEM=8192;  APP_DISK=60G
A1_ID=111;   A1_CORES=16;  A1_MEM=49152; A1_DISK=100G
A2_ID=112;   A2_CORES=16;  A2_MEM=49152; A2_DISK=100G

# Static addressing. Confirm the gateway on the host before a real run:  ip route | grep default
NET_PREFIX=24
NET_GW=10.10.10.1
DNS=10.10.10.18              # the LGTM/DNS host this estate already resolves against

APP_IP=10.10.10.60           # kasm control plane (db + app)
A1_IP=10.10.10.61            # agent 1
A2_IP=10.10.10.62            # agent 2

run() { if [[ $DRY -eq 1 ]]; then echo "  DRY: $*"; else echo "  RUN: $*"; "$@"; fi }

echo "=== preflight ==="
if [[ $DRY -eq 0 ]]; then
  command -v qm >/dev/null || { echo "qm not found — run this on the Proxmox host"; exit 1; }
  for id in $APP_ID $A1_ID $A2_ID; do
    if qm status "$id" >/dev/null 2>&1; then echo "VMID $id already exists — aborting"; exit 1; fi
  done
  qm config "$TEMPLATE" >/dev/null 2>&1 || { echo "template $TEMPLATE missing"; exit 1; }
  qm config "$TEMPLATE" | grep -q '^template: 1' || echo "  WARN: $TEMPLATE is not flagged as a template"
fi
echo "  template $TEMPLATE present · storage $STORAGE · bridge $BRIDGE"

clone_one() {
  local id=$1 name=$2 cores=$3 mem=$4 disk=$5 ip=$6
  echo
  echo "=== $name (VMID $id) — ${cores}c / $((mem/1024)) GiB / $disk / $ip ==="
  run qm clone "$TEMPLATE" "$id" --name "$name" --full --storage "$STORAGE"
  run qm set "$id" --cores "$cores" --memory "$mem" --balloon 0
  # balloon 0 on purpose: a Kasm agent must report the memory it actually has. With ballooning
  # on, the guest is handed a smaller ceiling than the VM config advertises and sessions get
  # OOM-killed while the host still looks half empty.
  run qm resize "$id" scsi0 "$disk"
  # grow-only, and the template ships 20G — Docker images need far more (see README sizing)
  run qm set "$id" --ipconfig0 "ip=${ip}/${NET_PREFIX},gw=${NET_GW}" --nameserver "$DNS"
  run qm set "$id" --tags kasm-lab
  # same serial-console-only layout as the rest of the estate (vga: serial0)
}

clone_one "$APP_ID" kasm-app    "$APP_CORES" "$APP_MEM" "$APP_DISK" "$APP_IP"
clone_one "$A1_ID"  kasm-agent1 "$A1_CORES"  "$A1_MEM"  "$A1_DISK"  "$A1_IP"
clone_one "$A2_ID"  kasm-agent2 "$A2_CORES"  "$A2_MEM"  "$A2_DISK"  "$A2_IP"

echo
echo "=== start ==="
for id in $APP_ID $A1_ID $A2_ID; do run qm start "$id"; done

cat <<EOF

next:
  1. confirm the guest addresses (vmbr1, DHCP off over cloud-init):
       ssh rkeadmin@$APP_IP 'ip -4 addr show; ip route | grep default'
  2. install the control plane on $APP_IP :  02-install-app.sh
  3. install the agents on $A1_IP and $A2_IP :  03-install-agent.sh
  4. in the Kasm UI: Infrastructure -> Docker Agents -> edit each -> Enabled -> Save
EOF
