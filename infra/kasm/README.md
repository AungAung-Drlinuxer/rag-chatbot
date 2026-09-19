# Kasm lab tier — control plane + two agents

The education/lab environment for the chatbot. **This is not a Kubernetes workload.** Kasm's
own documentation is explicit:

> "Agents are always deployed **outside of Kubernetes** on standard Docker hosts and are
> **never included in the Helm chart**."
> — https://docs.kasm.com/docs/latest/explanations/kubernetes-deployment-options

The Helm chart covers the control plane only (App / Connection Proxy / Dedicated Proxy); the
sessions students actually use run on Docker hosts. So the lab is three VMs on pve01, and the
K8s cluster keeps running the chatbot.

```
pve01 (72c / 270 GB — measured 57c / 73 GB free)
├── K8s cluster            rag-chatbot · keycloak · harbor · monitoring · gitea   ← unchanged
├── VM 110  kasm-app       4c /  8 GB /  60 G   db + app + proxy   (control plane)
├── VM 111  kasm-agent1   16c / 48 GB / 100 G   student sessions
└── VM 112  kasm-agent2   16c / 48 GB / 100 G   student sessions (peak / second class)
```

## Why clone instead of installing an OS

pve01 already holds `ubuntu24-template` (VMID **9100**) — measured from the Proxmox API:

| key | value | why it matters |
|---|---|---|
| `ide2` | `data:vm-9100-cloudinit,media=cdrom` | cloud-init drive present, no snippet to write |
| `ciuser` / `sshkeys` | `rkeadmin` / set | no first-boot console work |
| `net0` | `virtio,…,bridge=vmbr1` | same bridge as the RKE2 nodes |
| `cpu` / `machine` / `scsihw` | `host` / `q35` / `virtio-scsi-single` | matches the rest of the estate |
| `agent` | `enabled=1` | qemu-guest-agent, so the Proxmox API can read guest state |
| `vga` / `serial0` | `serial0` / `socket` | serial console only — use `qm terminal` |

So: **no ISO download, no cloud image, no cloud-init snippet.** Clone it three times.

## Sizing, and why those numbers

| role | vCPU | RAM | disk | rationale |
|---|---|---|---|---|
| kasm-app | 4 | 8 GB | 60 G | control plane only; Kasm's own practical floor is 4c/8G. Disk holds the ~10–15 G service images plus Postgres data. |
| kasm-agent | 16 | 48 GB | 100 G | the session tier. Disk holds the workspace images (VS Code ~1.5 G, `ubuntu-noble-ml-engineering` 5–8 G) once each per agent. |

Per-session cost used for capacity planning (verify in Phase 0 — these are estimates, not
measurements):

```
VS Code           ~1 vCPU / 1.5 GB   →  ~15-20 concurrent per agent
Jupyter / ML      ~2 vCPU / 4.0 GB   →   ~8-10 concurrent per agent
Terminal/desktop  ~1 vCPU / 2.0 GB   →  ~15-20 concurrent per agent
```

Two agents ≈ 20–40 concurrent sessions depending on the mix. **RAM binds long before CPU
does**, which is why the VM counts matter more than the core counts.

## Procedure

### Step 1 — provision the VMs (on the Proxmox host)

```bash
scp infra/kasm/01-clone-vms.sh root@pve01:/root/
ssh root@pve01 'bash /root/01-clone-vms.sh --dry-run'    # print every command first
ssh root@pve01 'bash /root/01-clone-vms.sh'              # then for real
```

Before the real run, confirm the gateway (the script defaults to `10.10.10.1`):

```bash
ssh root@pve01 'ip route | grep default'
```

**These provisioning commands have not been executed.** The Proxmox credential the app holds
is `PVEAuditor` (read-only) by design — provisioning is deliberately not something the chatbot
can do. `--dry-run` exists so the exact commands can be reviewed before touching the host.

### Step 2 — control plane (inside VM 110)

```bash
ssh rkeadmin@10.10.10.60
sudo bash 02-install-app.sh
```

It installs the **db role then the app role on the same VM**. Two roles on one host because
they only talk over TCP (web app → database on 5432), which on a single host is the loopback.
**Capture two values from `/root/kasm-db-install.log`:**

- `DATABASE_PASSWORD` — needed by the app role (the script prompts for it)
- `MANAGER_TOKEN` — needed by **every** agent. It is shown only at database-install time.

```bash
grep -iE "database password|manager token" /root/kasm-db-install.log
```

Then log in at `https://10.10.10.60` as `admin@kasm.local`.

### Step 3 — agents (inside VM 111 and VM 112)

```bash
ssh rkeadmin@10.10.10.61
sudo MANAGER_HOSTNAME=10.10.10.60 MANAGER_TOKEN='<from step 2>' bash 03-install-agent.sh
# ...same on 10.10.10.62
```

The script refuses to run if `https://<manager>/` is unreachable, because the agent checks in
over 443 and a silent failure there looks like "the agent installed but never appears".

### Step 4 — enable the agents

The agent is **not live until it is enabled in the UI**:

```
Admin -> Infrastructure -> Docker Agents -> edit each agent -> Enabled -> Save
```

Both agents should show green. Then launch a VS Code workspace to prove the tier end to end.

## Ports

| source | destination | port | note |
|---|---|---|---|
| users | kasm-app | 443 | UI / API / streaming |
| kasm-app | agents | 443 | agent instructions |
| agents | kasm-app | 443 | check-in, image + auth requests |
| kasm-app | database | 5432 | loopback only (co-located) |

Only 443 needs to be reachable from clients. Agents never need to be internet-facing.

## Flags that matter

| flag | why |
|---|---|
| `--use-static-images` (`-f`) | 1.19 defaults to *rolling* images, which update the workspace images on their own. On-prem wants one deliberate upgrade, not a surprise image change under a running class. |
| `-H` (agents only) | skip the swap check. Deliberate: no swap on a 48 GiB Docker host — swapping converts "slow session" into "stalled session". The 8 GiB control plane does get a 4 GiB swapfile. |
| `--balloon 0` | a Kasm agent must report the memory it actually has. With ballooning on, sessions get OOM-killed while the host still looks half empty. |
| `--activation-key-file` / `-a` | licence activation. **In a multi-server install this applies to the database role only** (documented). Do not pass it to the agents. |
| `--ssl-public-cert` / `--ssl-private-key` | bring your own cert instead of Kasm's self-signed one. |

## Licence — decide before a real class

- **Community Edition**: free, "testing, non-profits and non-commercial activities",
  **limited to 5 concurrent sessions**. Fine for Phase 0, not for a class.
- **Starter**: *per named user* or *per concurrent session*.

Engineering lever: a per-concurrent-session licence means **scheduling is a cost control**.
60 students in 4 batches of 15 needs a 15-session licence instead of 60 named users.

## Air-gap preparation (later)

Static (non-rolling) bundles, with the SHA256 published alongside each:

```
installer       kasm_release_1.19.0.tar.gz                        7b801cb0579a7867df46b6da873fe8dd631db07d4c05349e5bd1aea27130c37d
services        kasm_release_service_images_amd64_1.19.0.tar.gz   c8697a7d6db6d6c2cd685cf431977e79bb4adfa35d91d6fab455e70f4441e46d
workspaces      kasm_release_workspace_images_amd64_1.19.0.tar.gz 2338ed95653cf37b41c32c4202c38b507fd94a745dc81a303402e20f292486da
network plugin  kasm_release_network_plugin_images_amd64_1.5.tar.gz  bd13ce71737cebf2e7559c01c2dbff657a52505c771fce450a32bed36ef3056d
logging plugin  kasm_release_logging_plugin_images_amd64_1.1.tar.gz  fe5d1d6d1acd42ea89e15e375d0d6719f9d6cbf1f9c6943c4fda901a3d529135
```

Offline install takes `--offline-workspaces`, `--offline-service`,
`--offline-network-plugin`, `--offline-logger-plugin`. Licence activation for an offline
install needs the online activation tool once, to obtain a key — the deployed system then does
not call out. Workspace images should also be mirrored into Harbor so the agents never pull
from Docker Hub (same rule the K8s estate already follows).

## Phase 0 — prove these three things before trusting the design

1. **Can a session be launched API-only** (`POST /api/public/request_kasm`) without going
   through the UI? The whole chatbot integration depends on this. If it needs an interactive
   login, the architecture changes.
2. **Does the returned `kasm_url` render inside an iframe**, including the KasmVNC WebSocket
   upgrade? The app's nginx has no CSP and no `X-Frame-Options` (verified), so nothing blocks
   it on our side — the question is the streaming transport through whatever ingress is added.
3. **Measure real per-session RAM** for VS Code and for the ML image. Every number in the
   sizing table above is an estimate; capacity planning should not rest on estimates.

## Not done here

- No app changes. The Lab page, `lab_sessions` table and the `kasm-mcp` connector are the
  next phase, not this one.
- No licence purchased, no activation key set.
- The clone script has not been run against pve01.
