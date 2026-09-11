import { useState, useEffect, useMemo } from "react";

/** v1.5.8 — relative time for last-used display */
function relTimeAgo(iso: string): string {
  const d = new Date(iso.includes("Z") || iso.includes("+") ? iso : iso + "Z");
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 6e4);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
import { PageShell, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Check,
  ShieldAlert,
  RefreshCw,
  Code2,
  Terminal,
} from "lucide-react";
import { apiFetch, authHeaders, BASE } from "@/shared/api/client";

type ApiKeyRow = {
  id: number;
  name: string;
  key_prefix: string;
  scope: "chat" | "readonly";
  owner: string;
  active: boolean;
  created_at: string | null;
  last_used_at: string | null;
};

type Props = {
  role: string;
  userName: string;
  onToast?: (msg: string, kind?: "ok" | "err") => void;
};

export default function ApiKeysPage({ role, userName, onToast }: Props) {
  const isAdmin = role === "admin";
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [created, setCreated] = useState<null | { name: string; key: string; scope: string }>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formScope, setFormScope] = useState<"chat" | "readonly">("chat");
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKeyRow | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<ApiKeyRow | null>(null);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [activeSnippetTab, setActiveSnippetTab] = useState<"curl" | "python" | "powershell">("curl");
  // v1.5.8 — key status filter
  const [statusTab, setStatusTab] = useState<"all" | "active" | "revoked">("all");
  // v1.5.8 — prefix copy feedback
  const [copiedPrefix, setCopiedPrefix] = useState<number | null>(null);
  const filteredKeys = useMemo(() => {
    const all = keys ?? [];
    if (statusTab === "active") return all.filter((k) => k.active);
    if (statusTab === "revoked") return all.filter((k) => !k.active);
    return all;
  }, [keys, statusTab]);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const load = () => {
    setLoading(true);
    apiFetch(`${BASE}/api/apikeys`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setKeys(d?.keys ?? []))
      .catch(() => setKeys([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  async function createKey() {
    if (!formName.trim()) return;
    setBusy(true);
    try {
      const r = await apiFetch(`${BASE}/api/apikeys`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName.trim(), scope: formScope }),
      });
      if (r.status === 401) {
        // v1.1.9 — JWT was rotated / expired: the stale session cannot recover.
        // Force re-login instead of leaving the dialog in a dead state.
        setFormOpen(false);
        setBusy(false);
        window.dispatchEvent(new CustomEvent("ith:session-expired"));
        onToast?.("Session expired — please sign in again.", "err");
        return;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail ?? "failed");
      setCreated(d);
      setFormOpen(false);
      setFormName("");
      load();
    } catch (e: any) {
      onToast?.(e?.message ?? "Key creation failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKeyRow) {
    setBusy(true);
    try {
      const r = await apiFetch(`${BASE}/api/apikeys/${key.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("failed");
      onToast?.(`Key "${key.name}" revoked`);
      load();
    } catch {
      onToast?.("Revoke failed", "err");
    } finally {
      setBusy(false);
      setConfirmRevoke(null);
    }
  }

  /** v1.3.5 — PERMANENTLY delete a revoked key (row disappears forever). */
  async function purgeKey(key: ApiKeyRow) {
    setBusy(true);
    try {
      const r = await apiFetch(`${BASE}/api/apikeys/${key.id}/purge`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.detail ?? "delete failed");
      onToast?.(`Key "${key.name}" permanently deleted`);
      load();
    } catch (e: any) {
      onToast?.(e?.message ?? "Delete failed", "err");
    } finally {
      setBusy(false);
      setConfirmPurge(null);
    }
  }

  return (
    <PageShell>
      <PageHeader
        icon={<KeyRound className="size-5" />}
        badge={isAdmin ? "Administrator" : role === "knowledge" ? "Knowledge Manager" : "User"}
        title="API Keys"
        description="Programmatic access to the chatbot API — generate keys for scripts, integrations and automation."
        actions={
          <>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setSnippetsOpen(true)}>
              <Code2 className="mr-1.5 size-3.5 text-blue-600 dark:text-blue-400" />
              Usage Examples
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={load}>
              <RefreshCw className={`mr-2 size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700"
              onClick={() => setFormOpen(true)}
            >
              <Plus className="mr-1.5 size-4" />
              Generate key
            </Button>
          </>
        }
      />

      <div className="mx-auto max-w-[1000px] space-y-5 p-5 lg:p-8">
          {/* Info banner */}
          <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-blue-600" />
            <div className="text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
              <p className="font-medium">Use keys as <code className="rounded bg-muted px-1 font-mono">Authorization: Bearer &lt;key&gt;</code></p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Keys authenticate like a user login — RBAC and rate limits (5 requests/min) apply.
                Keys are stored hashed; the full value is shown once at creation.
              </p>
            </div>
          </div>

          {/* Created-once panel — v1.5.9: once copied, the raw key is hidden permanently */}
          {created && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="flex items-center justify-between">
                {copied ? (
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    Key "{created.name}" copied to clipboard — it is now hidden and cannot be retrieved again.
                  </p>
                ) : (
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    Key "{created.name}" created — copy it now, it will not be shown again.
                  </p>
                )}
                {!copied && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(created.key).catch(() => {});
                      setCopied(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:hover:bg-emerald-900/40"
                  >
                    <Copy className="size-3.5" />
                    Copy key
                  </button>
                )}
              </div>
              {!copied ? (
                <code className="mt-2 block select-all rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] text-emerald-300">
                  {created.key}
                </code>
              ) : (
                <code className="mt-2 block select-none rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] text-emerald-300/60">
                  {"•".repeat(40)}
                </code>
              )}
            </div>
          )}

          {/* Keys table */}
          <Card className="overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-sm font-semibold">
                {isAdmin ? "All keys" : "Your keys"}
                <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                  ({filteredKeys.length})
                </span>
              </h2>
              {/* v1.5.8 — status filter tabs */}
              <div className="flex items-center gap-1">
                {([["all", "All"], ["active", "Active"], ["revoked", "Revoked"]] as const).map(([val, label]) => {
                  const n = val === "all" ? (keys?.length ?? 0) : (keys ?? []).filter((k) => (val === "active" ? k.active : !k.active)).length;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setStatusTab(val)}
                      className={[
                        "rounded-lg px-2.5 py-1 text-[10px] font-medium transition",
                        statusTab === val
                          ? "bg-slate-900 text-white dark:bg-slate-700"
                          : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
                      ].join(" ")}
                    >
                      {label} {n > 0 && <span className="opacity-60">{n}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {loading ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : (keys ?? []).length === 0 ? (
              <div className="px-4 py-10 text-center text-[10px] text-muted-foreground">
                No API keys yet — generate one to enable programmatic access.
              </div>
            ) : (
              <div className="divide-y">
                {filteredKeys.map((k) => (
                  <div key={k.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
                      <KeyRound className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium" title={k.name}>
                          {k.name}
                        </span>
                        <span
                          className={[
                            "rounded-full px-2 py-0.5 text-[9px] font-medium capitalize",
                            k.scope === "chat"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
                          ].join(" ")}
                        >
                          {k.scope}
                        </span>
                        {/* v1.5.8 — explicit status badges for both states */}
                        {k.active ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            active
                          </span>
                        ) : (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400">
                            revoked
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">{k.key_prefix}</span>
                        <button
                          type="button"
                          title="Copy key prefix"
                          onClick={() => {
                            navigator.clipboard.writeText(k.key_prefix);
                            setCopiedPrefix(k.id);
                            window.setTimeout(() => setCopiedPrefix(null), 1500);
                          }}
                          className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                        >
                          {copiedPrefix === k.id ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
                        </button>
                        <span>·</span>
                        <span>
                          {k.created_at
                            ? new Date(k.created_at.includes("Z") || k.created_at.includes("+") ? k.created_at : k.created_at + "Z").toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
                            : ""}
                        </span>
                        {k.last_used_at ? (
                          <span title={new Date(k.last_used_at.includes("Z") || k.last_used_at.includes("+") ? k.last_used_at : k.last_used_at + "Z").toLocaleString()}>· used {relTimeAgo(k.last_used_at)}</span>
                        ) : (
                          <span className="italic">· never used</span>
                        )}
                        {isAdmin && (
                          <span className="inline-flex items-center gap-1">
                            · <span className="rounded bg-slate-100 px-1 py-px text-[9px] font-medium dark:bg-slate-800">{k.owner}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    {k.active && (isAdmin || k.owner === userName) && (
                      <button
                        onClick={() => setConfirmRevoke(k)}
                        title="Revoke key"
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                    {!k.active && (isAdmin || k.owner === userName) && (
                      <button
                        onClick={() => setConfirmPurge(k)}
                        title="Permanently delete this revoked key"
                        className="rounded-lg p-2 text-red-400 transition hover:bg-rose-50 hover:text-red-700 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>


      {/* Generate form dialog */}
      {formOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <Card className="w-full max-w-md rounded-2xl p-6">
            <h3 className="text-sm font-semibold">Generate API key</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Key name</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. ops-bot, monitoring-script"
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-xs outline-none focus:border-blue-400 dark:bg-slate-900"
                  maxLength={120}
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground">Scope</label>
                <div className="mt-1 flex gap-2">
                  {(["chat", "readonly"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setFormScope(s)}
                      className={[
                        "flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition",
                        formScope === s
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
                      ].join(" ")}
                    >
                      {s === "chat" ? "Chat (full access)" : "Read-only"}
                    </button>
                  ))}
                </div>
              </div>
              {isAdmin && (
                <p className="text-[10px] text-muted-foreground">
                  The key will be owned by <strong>{userName}</strong> (you). Use the API to create keys on behalf of others.
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy || !formName.trim()}
                onClick={createKey}
                className="rounded-xl bg-blue-600 text-white hover:bg-blue-700"
              >
                {busy ? "Generating…" : "Generate"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Revoke confirm dialog */}
      {confirmRevoke && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <Card className="w-full max-w-sm rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <ShieldAlert className="size-5 shrink-0 text-rose-600" />
              <div>
                <h3 className="text-sm font-semibold">Revoke key "{confirmRevoke.name}"?</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Anything using this key will immediately lose access. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmRevoke(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => revoke(confirmRevoke)}
                className="rounded-xl bg-rose-600 text-white hover:bg-rose-700"
              >
                {busy ? "Revoking…" : "Revoke key"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* v1.3.5 — Permanently delete confirm dialog */}
      {confirmPurge && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <Card className="w-full max-w-sm rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <ShieldAlert className="size-5 shrink-0 text-red-600" />
              <div>
                <h3 className="text-sm font-semibold">Permanently delete "{confirmPurge.name}"?</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  This revoked key and its record will be removed forever. Any client still
                  sending it receives 401. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmPurge(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => purgeKey(confirmPurge)}
                className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Code Snippets & Quick Docs Modal */}
      {snippetsOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-2xl overflow-hidden rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-2.5">
                <div className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                  <Terminal className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">API Key Integration & Usage Examples</h3>
                  <p className="text-[11px] text-muted-foreground">Connect external services, automation scripts, and custom tools</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="rounded-lg text-xs" onClick={() => setSnippetsOpen(false)}>
                Close
              </Button>
            </div>

            <div className="mt-4 flex gap-2 border-b pb-2">
              {(["curl", "python", "powershell"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveSnippetTab(tab)}
                  className={[
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                    activeSnippetTab === tab
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-muted-foreground hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                  ].join(" ")}
                >
                  {tab === "curl" ? "cURL / Bash" : tab === "python" ? "Python (requests)" : "PowerShell"}
                </button>
              ))}
            </div>

            <div className="relative mt-3">
              <div className="absolute right-3 top-3 z-10">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 rounded-lg bg-slate-800 text-[10px] text-slate-200 hover:bg-slate-700 hover:text-white dark:bg-slate-800"
                  onClick={() => {
                    const snip =
                      activeSnippetTab === "curl"
                        ? `curl -X POST https://chat.drlinuxer.com/api/chat/stream \\\n  -H "Authorization: Bearer <YOUR_API_KEY>" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "message": "How do I reset AD password?",\n    "session_id": "api-client-01"\n  }'`
                        : activeSnippetTab === "python"
                        ? `import requests, json\n\nAPI_KEY = "<YOUR_API_KEY>"\nURL = "https://chat.drlinuxer.com/api/chat/stream"\n\nheaders = {\n    "Authorization": f"Bearer {API_KEY}",\n    "Content-Type": "application/json"\n}\npayload = {\n    "message": "How do I connect to VPN?",\n    "session_id": "py-client-01"\n}\n\nwith requests.post(URL, headers=headers, json=payload, stream=True) as resp:\n    for line in resp.iter_lines():\n        if line and line.startswith(b"data:"):\n            data = json.loads(line[5:].strip())\n            if "token" in data:\n                print(data["token"], end="", flush=True)\nprint()`
                        : `$headers = @{\n  "Authorization" = "Bearer <YOUR_API_KEY>"\n  "Content-Type"  = "application/json"\n}\n$body = @{\n  message    = "How do I connect to VPN?"\n  session_id = "pwsh-session-01"\n} | ConvertTo-Json\n\nInvoke-RestMethod -Uri "https://chat.drlinuxer.com/api/chat/stream" -Method Post -Headers $headers -Body $body`;
                    navigator.clipboard.writeText(snip);
                    setCopiedSnippet(true);
                    setTimeout(() => setCopiedSnippet(false), 1600);
                  }}
                >
                  {copiedSnippet ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  {copiedSnippet ? "Copied" : "Copy snippet"}
                </Button>
              </div>

              <pre className="max-h-[300px] overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-200">
                {activeSnippetTab === "curl" && (
`# 1. Ask a question via cURL
curl -X POST https://chat.drlinuxer.com/api/chat/stream \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "How do I reset AD password?",
    "session_id": "api-client-01"
  }'`
                )}
                {activeSnippetTab === "python" && (
`import requests, json

API_KEY = "<YOUR_API_KEY>"
URL = "https://chat.drlinuxer.com/api/chat/stream"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}
payload = {
    "message": "How do I connect to VPN?",
    "session_id": "py-client-01"
}

with requests.post(URL, headers=headers, json=payload, stream=True) as resp:
    for line in resp.iter_lines():
        if line and line.startswith(b"data:"):
            data = json.loads(line[5:].strip())
            if "token" in data:
                print(data["token"], end="", flush=True)
print()`
                )}
                {activeSnippetTab === "powershell" && (
`$headers = @{
  "Authorization" = "Bearer <YOUR_API_KEY>"
  "Content-Type"  = "application/json"
}
$body = @{
  message    = "How do I connect to VPN?"
  session_id = "pwsh-session-01"
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://chat.drlinuxer.com/api/chat/stream" -Method Post -Headers $headers -Body $body`
                )}
              </pre>
            </div>

            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-[11px] text-muted-foreground dark:border-slate-800 dark:bg-slate-900/40">
              <span className="font-semibold text-slate-800 dark:text-slate-200">Endpoint Notes:</span>
              <ul className="mt-1 list-disc pl-4 space-y-0.5 text-[10px]">
                <li>Headers: <code className="font-mono">Authorization: Bearer ith_...</code></li>
                <li>Stream format: Server-Sent Events (SSE) with events: <code className="font-mono">stage</code>, <code className="font-mono">token</code>, <code className="font-mono">done</code></li>
                <li>Rate Limit: 5 requests / min per key (returns <code className="font-mono">HTTP 429 Too Many Requests</code> if exceeded)</li>
              </ul>
            </div>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
