# OpenBao admin policy — day-2 operations via OIDC (no root token needed)
# Secrets: full control on the KV mount used by the platform
path "secret/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# System discovery (UI navigation)
path "sys/mounts" {
  capabilities = ["read"]
}
path "sys/auth" {
  capabilities = ["read"]
}

# Policy management (create/update custom policies)
path "sys/policies/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Auth method management (oidc config/roles)
path "auth/oidc/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Audit + health (compliance & ops dashboards)
path "sys/audit" {
  capabilities = ["read"]
}
path "sys/health" {
  capabilities = ["read"]
}

# Kubernetes auth roles (for workload integrations)
path "auth/kubernetes/role/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
