"""Domain classifier — Stage 1 fast keyword rules (<1ms); Stage 2 metadata fallback.

Returns (domain, confidence). Keyword hits → high confidence. No hit → "general" with
low confidence; the pipeline then overrides the domain with the top retrieved doc's
stored domain (Stage 2 approximate ML/zero-shot fallback) when Stage 1 < 0.7.
"""
from __future__ import annotations

LOCKDOWN = "general"
STAGE1_CONFIDENCE = 0.7  # below this, pipeline triggers Stage 2

# domain → list of triggering keywords (lowercased, substring match).
# SECURITY_TERMS checked first and weighted 2x — security phrases are often
# embedded in generic sentences ("suspicious login detected on a server").
SECURITY_TERMS = [
    "suspicious", "unauthorized", "breach", "intrusion", "phishing", "malware",
    "brute force", "credential", "certificate", "tls", "ssl", "apparmor",
    "access denied", "permission", "login", "log in", "authentication failure",
]
KEYWORD_RULES: dict[str, list[str]] = {
    "database": ["database", "postgres", "oracle", "sql", "ora-", "timeout",
                 "connection refused", "disk full", "backup", "slow query",
                 "deadlock", "replication", "pool exhaust", "vacuum", "wal"],
    "network": ["network", "internet", "dns", "wifi", "firewall", "vpn",
                "no internet", "speed", "connectivity", "ip", "interface",
                "eth0", "gateway", "proxy", "ntp", "chrony", "latency",
                "route", "traceroute", "ping"],
    "security": ["security", "password", "unauthorized", "access denied",
                 "permission", "account", "2fa", "mfa", "lockout", "phishing",
                 "suspicious", "breach", "certificate", "tls", "ssl",
                 "apparmor", "credential", "brute force"],
    "server": ["server", "service", "cpu", "memory", "ram", "crash", "restart", "reboot", "process", "resource", "kill", "oom", "out of memory", "systemd", "journalctl", "disk usage", "filesystem", "lvm", "kubernetes", "k8s", "kubectl", "pod", "pvc", "helm", "imagepullbackoff", "crashloopbackoff", "statefulset", "deployment", "rollout", "daemonset", "nfs", "storage", "mount", "disk io", "iops", "partition", "application", "app crash", "outlook", "teams", "zoom", "office", "excel", "word", "browser", "chrome", "edge", "print", "printer", "license", "install", "update failed", "software"],
    "kubernetes": ["kubernetes", "k8s", "kubectl", "pod", "node notready", "pvc", "pv",
                   "helm", "crashloopbackoff", "imagepullbackoff", "oomkilled", "deployment",
                   "ingress", "namespace", "rke2", "container"],
    "storage": ["storage", "nfs", "mount", "filesystem", "disk space", "smb", "share",
                "ceph", "volume", "partition", "lvm", "raid"],
}


def classify_domain(query: str) -> tuple[str, float]:
    """Keyword-rule classifier. Returns (domain, confidence in 0..1)."""
    text = (query or "").lower()
    best_domain, best_hits = LOCKDOWN, 0
    for domain, kws in KEYWORD_RULES.items():
        hits = sum(1 for kw in kws if kw in text)
        if domain == "security":
            hits *= 2  # prioritize security signals over generic terms
        if domain in ("kubernetes", "storage", "application"):
            hits *= 1.5  # v0.20.12: specific domains beat generic system terms
        if hits > best_hits:
            best_domain, best_hits = domain, hits
    if best_hits == 0:
        return LOCKDOWN, 0.3
    # Scale confidence: 1 hit ~= 0.75, more hits approach 1.0
    confidence = min(0.75 + 0.1 * (best_hits - 1), 0.98)
    return best_domain, round(confidence, 3)
