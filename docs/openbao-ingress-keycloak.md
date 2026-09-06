# OpenBao UI Exposure — baobao.drlinuxer.com (Ingress + Keycloak OIDC)

Confluence-ready guide. English body, Myanmar footnotes.

## Overview

Expose the OpenBao Web UI publicly at **https://baobao.drlinuxer.com** (any IP),
replace root-token logins with **Keycloak OIDC SSO**, and reserve the root
token as break-glass only.

```
Browser ──HTTPS──▶ nginx ingress (baobao.drlinuxer.com, TLS drlinuxer-tls)
                      └──▶ svc/openbao-ui:8200 (active leader only)

Login flow (OIDC):
Browser ──▶ OpenBao UI "Sign in with OIDC"
        ──▶ Keycloak (keycloak.drlinuxer.com, realm of your choice)
        ──▶ back to OpenBao with code ──▶ OpenBao issues token w/ admin policy
```

---

## Part 1 — Ingress (baobao.drlinuxer.com)

`infra/k8s/openbao/20-ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: openbao-ui
  namespace: openbao
  annotations:
    # WebSockets are not needed for the UI, but keep generous timeouts for OIDC redirects
    nginx.ingress.kubernetes.io/proxy-read-timeout: "90"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "90"
    # OpenBao UI is a SPA — send unknown paths to index
    nginx.ingress.kubernetes.io/use-regex: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - baobao.drlinuxer.com
      secretName: drlinuxer-tls
  rules:
    - host: baobao.drlinuxer.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: openbao-ui
                port:
                  number: 8200
```

Apply:

```bash
kubectl apply -f infra/k8s/openbao/20-ingress.yaml
```

DNS: add an A record `baobao.drlinuxer.com → 10.10.10.200` (same ingress IP as
your other services).

> **No IP allowlist** was requested — any IP may reach the login page. Data
> inside remains protected by OpenBao auth + policies. Unsealed-but-unauthenticated
> requests only see the login form.

Verify:

```bash
curl -sk https://baobao.drlinuxer.com/ui/ -o /dev/null -w "%{http_code}\n"   # 200
```

---

## Part 2 — Keycloak OIDC for OpenBao (manual setup guide)

This part is intentionally **step-by-step for self-service setup** — no
automation, since Keycloak realm choice is yours.

### 2.1 Create an OIDC client in Keycloak

1. Keycloak Admin Console → choose your realm
   (e.g. `master` for quick start, or create a dedicated `openbao` realm
   for isolation — recommended for production).
2. **Clients → Create client**:
   - Client type: `OpenID Connect`
   - Client ID: `openbao`
   - Name: `OpenBao`
   - Root URL: `https://baobao.drlinuxer.com`
   - **Valid redirect URIs**:
     ```
     https://baobao.drlinuxer.com/oidc/callback
     https://baobao.drlinuxer.com/ui/vault/auth/oidc/callback   (legacy UI path)
     ```
   - Web origins: `https://baobao.drlinuxer.com`
3. **Credentials** tab → copy the **Client secret**.
4. Optional (recommended): create a group `openbao-admins`, assign your
   admin user(s) to it. OpenBao policies can be mapped by group claim.

### 2.2 Enable OIDC auth in OpenBao

```bash
cd infra/k8s/openbao
ROOT=$(py -3 -c "import json;print(json.load(open('.init-credentials.json'))['root_token'])")

# 1) Enable the oidc auth method
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$ROOT" bao auth enable oidc

# 2) Write the OIDC config — bound issuer must match Keycloak exactly
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$ROOT" bao write auth/oidc/config \
    oidc_discovery_url="https://keycloak.drlinuxer.com/realms/YOUR_REALM" \
    oidc_client_id="openbao" \
    oidc_client_secret="PASTE_CLIENT_SECRET" \
    default_role="admin"

# 3) Admin policy (already exists: it-help-chatbot read policy; create admin one)
cat > policies/openbao-admin.hcl <<'EOF'
# Full admin on secret mounts + system paths needed for day-2 ops
path "secret/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "sys/mounts"      { capabilities = ["read"] }
path "sys/auth"        { capabilities = ["read"] }
path "sys/policies/*"  { capabilities = ["create", "read", "update", "delete", "list"] }
path "auth/oidc/*"     { capabilities = ["create", "read", "update", "delete", "list"] }
path "sys/audit"       { capabilities = ["read"] }
path "sys/health"      { capabilities = ["read"] }
EOF

kubectl -n openbao cp policies/openbao-admin.hcl openbao-0:/tmp/admin.hcl
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$ROOT" bao policy write openbao-admin /tmp/admin.hcl

# 4) Bind OIDC role → policy. Two options:
#    (a) by allowed_redirect_uris only (any authenticated realm user = admin)
kubectl -n openbao exec openbao-0 -- \
  env BAO_TOKEN="$ROOT" bao write auth/oidc/role/admin \
    user_claim="preferred_username" \
    groups_claim="groups" \
    allowed_redirect_uris="https://baobao.drlinuxer.com/oidc/callback" \
    allowed_redirect_uris="https://baobao.drlinuxer.com/ui/vault/auth/oidc/callback" \
    bound_audiences="openbao" \
    oidc_scopes="openid,profile,email,groups" \
    policies="openbao-admin" \
    ttl=8h
```

> **Stricter option (b) — group binding:** create group `openbao-admins` in
> Keycloak, put users in it, then add `oidc_groups_claim="groups"` and
> `groups_claim` mapping plus a `bound_claims` on groups. Ask for this
> variant if you want group-gated admin access.

### 2.3 Test SSO login

1. Browse `https://baobao.drlinuxer.com/ui`
2. Method dropdown → **OIDC** → **Sign in with OIDC**
3. Keycloak login page → authenticate → redirected back to OpenBao UI
4. You are logged in with `openbao-admin` policy — **no root token used**

CLI equivalent (headless):

```bash
kubectl -n openbao exec -it openbao-0 -- bao login -method=oidc
# opens browser flow (port 8250 listener on localhost)
```

---

## Part 3 — Root token → break-glass

Once OIDC admin login is verified:

1. Store the existing root token safely (`.init-credentials.json` is already
   gitignored and kept offline). Optionally re-key to 5/3 shares and hand
   shares to custodians.
2. **Revoke the root token** so it cannot be used for daily work:

   ```bash
   # Look up the root token accessor first (do NOT revoke blind)
   kubectl -n openbao exec openbao-0 -- \
     env BAO_TOKEN="$ROOT" bao token lookup
   # note accessor → then revoke by accessor
   kubectl -n openbao exec openbao-0 -- \
     env BAO_TOKEN="$ROOT" bao token revoke -accessor=<ACCESSOR>
   ```

   If ever needed again, a new root token can be generated with a quorum of
   unseal shares (`bao operator generate-root`) — that's the whole point of
   break-glass: it exists but is deliberately hard to use.

3. Keep OIDC as the only login method shown on the UI:

   ```bash
   # (optional) hide token method on UI by not granting default policy
   kubectl -n openbao exec openbao-0 -- \
     env BAO_TOKEN="$ROOT" bao auth list
   ```

---

## Part 4 — Runbook notes

- **DNS**: `baobao.drlinuxer.com A 10.10.10.200`
- **TLS**: reuses `drlinuxer-tls` secret (same wildcard/cert as other hosts)
- **Redirect URIs must match Keycloak exactly** — most OIDC failures are a
  trailing-slash mismatch
- **Audit**: after the declarative audit stanza is active (pod restart), all
  logins land in `/openbao/audit/audit.log`
- If Keycloak is down, OpenBao UI login is unavailable — use CLI with a
  previously-issued admin token or break-glass root

## Checklist

- [ ] DNS record for baobao.drlinuxer.com
- [ ] Ingress applied, `curl https://baobao.drlinuxer.com/ui/` → 200
- [ ] Keycloak client `openbao` created w/ correct redirect URIs
- [ ] `bao auth enable oidc` + config + role/policy applied
- [ ] SSO login verified in browser
- [ ] Root token revoked (accessor lookup first)
- [ ] Root token stored offline in `.init-credentials.json` (break-glass)
