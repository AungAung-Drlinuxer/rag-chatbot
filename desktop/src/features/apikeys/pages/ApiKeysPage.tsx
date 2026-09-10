import { useState, useEffect } from "react";
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

  return (
    <PageShell>
      <PageHeader
        icon={<KeyRound className="size-5" />}
        badge={isAdmin ? "Administrator" : role === "knowledge" ? "Knowledge Manager" : "User"}
        title="API Keys"
        description="Programmatic access to the chatbot API — generate keys for scripts, integrations and automation."
        actions={
          <>
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

          {/* Created-once panel */}
          {created && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  Key "{created.name}" created — copy it now, it will not be shown again.
                </p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(created.key).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:hover:bg-emerald-900/40"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy key"}
                </button>
              </div>
              <code className="mt-2 block select-all rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] text-emerald-300">
                {created.key}
              </code>
            </div>
          )}

          {/* Keys table */}
          <Card className="overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-sm font-semibold">
                {isAdmin ? "All keys" : "Your keys"}
              </h2>
              <span className="text-[10px] text-muted-foreground">
                {keys?.length ?? 0} key{(keys?.length ?? 0) === 1 ? "" : "s"}
              </span>
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
                {(keys ?? []).map((k) => (
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
                            "rounded-full px-2 py-0.5 text-[9px] font-medium uppercase",
                            k.scope === "chat"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
                          ].join(" ")}
                        >
                          {k.scope}
                        </span>
                        {!k.active && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400">
                            revoked
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">{k.key_prefix}</span>
                        <span>·</span>
                        <span>
                          {k.created_at
                            ? new Date(k.created_at.includes("Z") || k.created_at.includes("+") ? k.created_at : k.created_at + "Z").toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
                            : ""}
                        </span>
                        {k.last_used_at && <span>· used</span>}
                        {isAdmin && <span>· owner: {k.owner}</span>}
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
    </PageShell>
  );
}
