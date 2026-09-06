# OpenBao HA on RKE2 — drlinuxer-prod

Confluence-ready blog guide. English body + Myanmar footnotes for the team.

---

## TL;DR (မြန်မာ)

OpenBao = HashiCorp Vault-compatible secret manager (open source). Kubernetes
in-cluster secrets တွေက base64 only, encryption-at-rest မလုပ်ရသေးရင် leak risk
ရှိ။ OpenBao က AES-encrypted storage, identity-based policy, audit log,
dynamic secrets, Kubernetes ServiceAccount JWT auth, CSI volume mount
အစရှိတာတွေ ပေးတယ်။

RKE2 cluster ပေါ်မှာ **3-node Raft HA** + **Kubernetes Auth** + **CSI Provider**
+ **Web UI** ပါတဲ့ production-style setup ဖြစ်ပါတယ်။

---

## 1. Why OpenBao (and not just Kubernetes Secrets)?

Kubernetes Secrets are base64-encoded objects in etcd. They are **not encrypted
by default** — any principal with `get secrets` can decode them. K8s has
encryption-at-rest, but it must be enabled explicitly and still doesn't give
you per-workload policies, dynamic credentials, or detailed audit logs
out-of-the-box.

OpenBao gives you:

| Feature | Why it matters |
|---|---|
| Encryption at rest | All secret data is AES-encrypted inside OpenBao's storage backend |
| Identity-based access | Policies attach to identities: Kubernetes ServiceAccounts, JWT, LDAP |
| Fine-grained ACL | Per-path, per-capability access (read/list/update/delete) |
| Dynamic secrets | Short-lived DB / cloud credentials with TTLs |
| Audit logs | Every request/response logged → SIEM |
| Kubernetes native | Auth via ServiceAccount JWT + TokenReview API |
| CSI Provider | Pods mount secrets as files; never written to etcd |

---

## 2. Target architecture

```
RKE2 / Kubernetes cluster
└── Namespace: openbao
    ├── StatefulSet: openbao (3 replicas)
    │   ├── openbao-0  (Raft leader)
    │   ├── openbao-1  (Raft follower)
    │   └── openbao-2  (Raft follower)
    ├── PVC: data-openbao-{0..2}  (truenas-iscsi, 10Gi RWO)
    ├── PVC: audit-openbao-{0..2} (truenas-nfs,    5Gi RWO)
    ├── Service: openbao            (ClusterIP API)
    ├── Service: openbao-internal   (headless / Raft peer traffic)
    ├── Service: openbao-ui         (Web UI)
    └── DaemonSet: openbao-csi-provider  (5 nodes)
```

Raft provides leader/follower consensus: as long as 2 of 3 nodes are up,
the cluster stays available. Unseal keys are not auto-generated; they
must be combined manually (3-of-5) to reconstruct the root encryption
key.

---

## 3. Prerequisites

- RKE2 / Kubernetes 1.24+ with at least 3 worker nodes
- StorageClass `truenas-iscsi` (RWO) and `truenas-nfs` (default; used for audit logs)
- `kubectl` + `helm 3.x` configured for the target cluster
- Internal DNS resolution for `openbao.openbao.svc.cluster.local`

---

## 4. Helm install (HA Raft + UI + CSI)

`infra/k8s/openbao/values-ha.yaml`:

```yaml
server:
  ha:
    enabled: true
    replicas: 3
    raft:
      enabled: true

  dataStorage:
    enabled: true
    size: 10Gi
    storageClass: truenas-iscsi

  auditStorage:
    enabled: true
    size: 5Gi
    storageClass: truenas-nfs

  disruptionBudget:
    enabled: true
    maxUnavailable: 1

  affinity: |
    podAntiAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          podAffinityTerm:
            labelSelector:
              matchExpressions:
                - key: app.kubernetes.io/name
                  operator: In
                  values: [openbao]
            topologyKey: kubernetes.io/hostname

  resources:
    requests: { memory: 256Mi, cpu: 250m }
    limits:   { memory: 512Mi, cpu: 500m }

  config: |
    ui = true
    cluster_name = "drlinuxer-openbao"

    listener "tcp" {
      address         = "[::]:8200"
      cluster_address = "[::]:8201"
      tls_disable     = 1     # internal-only; TLS via ingress later
    }
    storage "raft" { path = "/openbao/data" }
    service_registration "kubernetes" {}

ui:
  enabled: true
  serviceType: ClusterIP
  activeOpenbaoPodOnly: true

csi:
  enabled: true

injector:
  enabled: false   # PoC uses CSI only
```

Install:

```bash
kubectl create namespace openbao
helm repo add openbao https://openbao.github.io/openbao-helm
helm repo update
helm upgrade --install openbao openbao/openbao \
  --namespace openbao \
  --version 0.29.4 \
  -f infra/k8s/openbao/values-ha.yaml
```

> **Note:** `tls_disable = 1` is for internal-only lab/cluster use. For
> production, terminate TLS at an internal ingress (or in OpenBao itself)
> and restrict access via NetworkPolicy.

---

## 5. Initialize & unseal

```bash
kubectl -n openbao exec openbao-0 -- \
  bao operator init -key-shares=5 -key-threshold=3 -format=json \
  > .init-credentials.json
```

This writes 5 unseal key shares + 1 root token. **Store this file outside
the cluster** (password manager, printed envelope, encrypted S3 bucket).
Never commit it; `.init-credentials.json` is gitignored.

Unseal all 3 nodes using the runbook at `infra/k8s/openbao/unseal-and-init.sh`:

```bash
cd infra/k8s/openbao
bash unseal-and-init.sh
```

Output (verified on drlinuxer-prod):

```
== Raft peers ==
Node                                    Address                            State     Voter
b2ff4171-20c0-3e0c-3d07-e320b5077c14    openbao-0.openbao-internal:8201    leader    true
afa36110-8d39-345a-cda4-f6e0582a86df    openbao-1.openbao-internal:8201    follower  true
20122935-fb13-0597-982f-312ed37f0dac    openbao-2.openbao-internal:8201    follower  true
```

All 3 nodes report `Initialized: true / Sealed: false / HA Enabled: true`.

---

## 6. Web UI (admin GUI)

```bash
kubectl -n openbao port-forward svc/openbao-ui 8200:8200
# open http://127.0.0.1:8200/ui
```

Login with the initial root token. From the UI you can browse KV secrets,
manage policies, configure Kubernetes roles, and view the Raft health
banner. **Do not expose the UI on the public internet** — keep it on
VPN / bastion only.

---

## 7. KV v2 secrets

```bash
BAO_TOKEN=$(jq -r .root_token .init-credentials.json)

# Enable
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$BAO_TOKEN" bao secrets enable -path=secret kv-v2

# Store secrets (example)
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$BAO_TOKEN" \
  bao kv put secret/it-help-chatbot/backend \
    database_url="postgresql+psycopg2://app:***@postgres-ha..." \
    jwt_secret="..." \
    ldap_bind_password="..." \
    h_chat_api_key="..."
```

---

## 8. Kubernetes auth + policies

Enable the auth method:

```bash
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$BAO_TOKEN" bao auth enable kubernetes

kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$BAO_TOKEN" bao write auth/kubernetes/config \
  kubernetes_host="https://10.43.0.1:443"
```

Write the policy (`infra/k8s/openbao/policies/it-help-chatbot.hcl`):

```hcl
path "secret/data/it-help-chatbot/*" {
  capabilities = ["read"]
}
path "secret/metadata/it-help-chatbot/*" {
  capabilities = ["list"]
}
```

Apply:

```bash
kubectl -n openbao cp policies/it-help-chatbot.hcl openbao-0:/tmp/ith.hcl
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$BAO_TOKEN" bao policy write it-help-chatbot /tmp/ith.hcl
```

Bind a Kubernetes ServiceAccount to the policy:

```bash
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$BAO_TOKEN" \
  bao write auth/kubernetes/role/it-help-chatbot \
  bound_service_account_names=it-help-chatbot-backend \
  bound_service_account_namespaces=it-help-chatbot \
  policies=it-help-chatbot \
  ttl=2h
```

Create the ServiceAccount in the consuming app's namespace:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: it-help-chatbot-backend
  namespace: it-help-chatbot
```

> **Myanmar note:** `bound_service_account_namespaces` ထဲမှာ namespace
> နာမည် မှန်ကန်စွာ ထည့်ထားဖို့ အရေးကြီးပါတယ် — mismatch ဖြစ်ရင်
> 403/denied ဖြစ်တတ်ပါတယ်။

---

## 9. PoC: backend reads from OpenBao

From a pod running as `it-help-chatbot-backend` SA, the proof-of-concept
flow is:

1. Pod requests a Kubernetes ServiceAccount token (projected automatically).
2. Pod POSTs that token to `auth/kubernetes/login` with role=it-help-chatbot.
3. OpenBao returns a short-lived OpenBao token (TTL = 2h).
4. Pod uses that token to read `secret/data/it-help-chatbot/backend`.

Live verification (executed inside `openbao-0` against the real cluster):

```
$ kubectl -n openbao exec openbao-0 -- sh -c '<login+read script>'
token_prefix: s.bQCue6A7C7Hn...
{ "data": { "data": {
    "confluence_base_url": "https://aungaungxero.atlassian.net/wiki",
    "confluence_email":   "aungaungxero@gmail.com",
    "confluence_space_keys": "IHKB",
    "confluence_token":   "ATATT3x...",
    "database_url":       "postgresql+psycopg2://app:***...",
    "h_chat_api_key":     "***",
    "jira_*":             "...",
    "jwt_secret":         "***",
    "ldap_bind_password": "***",
    "redis_password":     "***"
}}}
```

> **PoC scope:** backend code is unchanged in this commit. The PoC
> demonstrates the auth + read path works end-to-end. A follow-up commit
> will add a small `app/secrets/openbao.py` resolver that reads from
> OpenBao on startup with a 2h token TTL, falling back to env vars
> (`backend-secrets` Secret) if OpenBao is unreachable.

---

## 10. CSI Provider: mount secrets as files in pods

For workloads that need secrets as files (no env vars), use the CSI
provider (already enabled by `csi.enabled=true`).

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: my-app-secrets
  namespace: apps
spec:
  provider: openbao
  parameters:
    roleName: my-app
    objects: |
      - objectName: db_password
        secretPath: secret/data/it-help-chatbot/backend
        secretKey:  ldap_bind_password
```

Workload spec:

```yaml
volumes:
  - name: openbao-secrets
    csi:
      driver: secrets-store.csi.k8s.io
      volumeAttributes:
        secretProviderClass: my-app-secrets
containers:
  - name: app
    volumeMounts:
      - { name: openbao-secrets, mountPath: /var/run/app-secrets, readOnly: true }
```

---

## 11. Operations

### Rotation

```bash
# Update a value
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$BAO_TOKEN" \
  bao kv put secret/it-help-chatbot/backend ldap_bind_password="NEW"

# Roll restarts
kubectl -n it-help-chatbot rollout restart deploy/backend
```

### Audit device

```bash
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$BAO_TOKEN" bao audit enable file file_path=/openbao/audit/audit.log
```

Logs are written to the audit PVC; ship to SIEM via Fluent Bit.

### Raft snapshot

```bash
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$BAO_TOKEN" bao operator raft snapshot save /tmp/openbao.snap
kubectl cp openbao/openbao-0:/tmp/openbao.snap ./openbao-$(date +%F).snap
sha256sum ./openbao-$(date +%F).snap
```

Store off-cluster, encrypted. Test the restore path regularly.

### Failover drill

```bash
kubectl -n openbao delete pod openbao-0
kubectl -n openbao exec openbao-1 -- bao operator raft list-peers
```

The new leader is reported within seconds; existing tokens remain valid.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Ready=0/1, Sealed: true` | Node sealed | Run `bao operator unseal` 3× (threshold) |
| Pod `Pending` | PVC not bound, or anti-affinity too strict | Check `kubectl describe pvc`; relax topology key |
| `403 permission denied` (k8s auth) | SA namespace mismatch or policy path | Verify `bound_service_account_namespaces`, `secret/data/...` path |
| `raft join` fails | Leader unreachable | Check `openbao-0.openbao-internal:8200` DNS, NetworkPolicy |
| CSI mount fails | SecretProviderClass / role mismatch | Verify `roleName`, SA, and CSI provider pods |
| UI inaccessible | Service/port-forward issue | `kubectl get svc -n openbao`; use `port-forward` for dev |

---

## 13. Production security checklist

- **Never** commit unseal keys or root tokens. `.init-credentials.json`
  is gitignored at the repo level.
- Prefer **KMS/HSM auto-unseal** (AWS KMS, KMIP, PKCS#11) in production
  to avoid manual key handling.
- Use **short TTLs** (2h default here) and renew frequently.
- Restrict OpenBao API/UI with **NetworkPolicy** + firewalls to platform
  team namespaces.
- Reserve the **root token for break-glass only**; create dedicated
  admin policies for day-2 ops.
- **Enable audit** and ship logs to central SIEM; alert on
  `secret/data/*` reads from unexpected IPs.

---

## File map

```
infra/k8s/openbao/
├── values-ha.yaml                       # Helm values
├── unseal-and-init.sh                   # Bootstrap runbook
├── policies/
│   └── it-help-chatbot.hcl              # PoC read policy
└── .init-credentials.json               # gitignored; ./.gitignore entry
```

---

## 14. Backend integration (live in drlinuxer-prod)

The backend at `D:\ragchatbot\backend\app\secrets\openbao.py` authenticates
against OpenBao at startup using the pod's ServiceAccount JWT
(`/var/run/secrets/kubernetes.io/serviceaccount/token`). On success it
reads `secret/data/it-help-chatbot/backend` and constructs a
`Settings(**overrides)` that overrides the env-var-based values.

**Loading order (highest priority first):**

1. OpenBao KV (read once at process start, 2h token TTL)
2. Environment variables (k8s `Secret` `backend-secrets` mounted as env)
3. Hardcoded defaults in `app/config.py`

If OpenBao is unreachable, misconfigured, the role is not authorized, or
any other failure happens, the resolver returns `None` and the settings
fall back to the env-var layer. No retry storm: a single startup-time
attempt, then the env-var values are used for the process lifetime.

Verified live on drlinuxer-prod:

```
$ kubectl -n it-help-chatbot exec backend-pod -- python -c '...'
openbao_keys_count: 15
keys: ['confluence_base_url', 'confluence_email', 'confluence_space_keys',
       'confluence_token', 'database_url', 'h_chat_api_key', 'jira_base_url',
       'jira_email', 'jira_project', 'jira_request_types', 'jira_service_desk_id',
       'jira_token', 'jwt_secret', 'ldap_bind_password', 'redis_password']
$ curl https://chat.drlinuxer.com/api/auth/login ...   # 200 OK
$ curl /api/articles-domains ...                       # 8 domains, all live data
```

Fallback test (with OpenBao URL pointed at a bad host):

```
$ OPENBAO_URL=http://nonexistent-host:9999
$ python -c '... load() ...'
result: None
openbao: k8s auth login failed: [Errno -3] Temporary failure in name resolution
```

Both deployments (`backend` and `celery-worker`) are bound to
`serviceAccountName: it-help-chatbot-backend` so the SA token is mounted
at the standard path.

**Knobs (env vars, optional):**

| Var | Default |
|---|---|
| `OPENBAO_URL` | `http://openbao.openbao.svc.cluster.local:8200` |
| `OPENBAO_KV_PATH` | `secret/data/it-help-chatbot/backend` |
| `OPENBAO_K8S_ROLE` | `it-help-chatbot` |

To disable OpenBao entirely in a specific environment, set
`OPENBAO_URL` to an empty string (the resolver will short-circuit).

---

## References

- OpenBao Helm + HA Raft: https://openbao.org/docs/platform/k8s/helm/examples/ha-with-raft/
- OpenBao CSI Provider: https://openbao.org/docs/platform/k8s/csi/
- Kubernetes auth method: https://openbao.org/docs/auth/kubernetes/
- Audit devices: https://openbao.org/docs/audit/
- Tokens: https://openbao.org/docs/concepts/tokens/
- K8s secrets good practices: https://kubernetes.io/docs/concepts/security/secrets-good-practices/
- K8s encryption-at-rest: https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/
