// Settings panel (v0.3.0) — shadcn/ui primitives + Tailwind utilities.
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {AlertTriangle, FlaskConical, Info, Loader2, MessageSquare, Palette, PlugZap, RotateCcw, Search, Send, Settings as SettingsIcon, TrendingUp, User, Zap} from "lucide-react";
import {
  getMySettings, updateMySettings, getAdminSettings, saveAdminSettings,
  resetAdminSetting, getIntegrationsStatus,
  type UserSettings, type Knob, type IntegrationStatus,
} from "@/features/settings/api";

type Props = { role: string; userName: string; onBack?: () => void; onPrefsChange?: (s: UserSettings) => void };

const TOGGLES: { key: keyof UserSettings; label: string; hint?: React.ReactNode }[] = [
  { key: "show_token_usage", label: "Show token usage", hint: <span style={{display:"inline-flex",alignItems:"center",gap:4}}><Zap className="size-3" /> pill under each answer</span> },
  { key: "show_rag_sources", label: "Show RAG sources", hint: <span style={{display:"inline-flex",alignItems:"center",gap:4}}><Search className="size-3" /> Sources block under each answer</span> },
  { key: "stream_responses", label: "Stream responses", hint: "off = wait for the full reply" },
  { key: "markdown_rendering", label: "Markdown rendering", hint: "tables, code blocks, lists" },
];

const ESC_TOGGLES: { key: keyof UserSettings; label: string }[] = [
  { key: "escalate_include_transcript", label: "Include chat transcript in ticket" },
  { key: "escalate_include_sources", label: "Include cited KB sources" },
  { key: "escalate_open_new_tab", label: "Open the ticket in a new tab" },
];

function Row({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-dashed border-[var(--border)] last:border-0 max-sm:flex-col max-sm:items-start max-sm:gap-1.5">
      <div className="min-w-0 text-sm text-[var(--foreground)]">
        {label}
        {hint && <small className="block text-xs text-[var(--muted-foreground)]">{hint}</small>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function gao(st: IntegrationStatus | null): { label: string; url: string }[] | null {
  const obs: any = (st as any)?.observability;
  if (!obs) return null;
  const links: { label: string; url: string }[] = [];
  for (const [k, v] of Object.entries(obs)) {
    if (typeof v === "string" && v.startsWith("http")) {
      links.push({ label: k.charAt(0).toUpperCase() + k.slice(1), url: v });
    }
  }
  return links.length ? links : null;
}


const SLIDER_BOUNDS: Record<string, [number, number]> = {
  retrieval_top_k: [1, 20],
  confidence_gate_threshold: [0, 1],
  max_context_tokens: [1000, 200000],
  chunk_tokens: [200, 2000],
  chunk_overlap: [0, 0.5],
};

export default function Settings({ role, userName, onPrefsChange }: Props) {
  const isAdmin = role === "admin";
  const [s, setS] = useState<UserSettings | null>(null);
  const [savedMsg, setSavedMsg] = useState("");
  const [err, setErr] = useState("");
  const [knobs, setKnobs] = useState<Knob[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [adminMsg, setAdminMsg] = useState("");
  const [applying, setApplying] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);

  useEffect(() => {
    getMySettings().then(setS).catch((e) => setErr(String(e)));
    if (isAdmin) getAdminSettings().then((r) => setKnobs(r.knobs)).catch(() => setKnobs(null));
    getIntegrationsStatus().then(setIntegrations).catch(() => setIntegrations(null));
  }, [isAdmin]);

  async function patch(p: Partial<UserSettings>) {
    if (!s) return;
    setS({ ...s, ...p });            // optimistic
    try {
      const next = await updateMySettings(p);
      setS(next);
      onPrefsChange?.(next);         // live-apply theme + fonts
      setSavedMsg("Saved ✓");
      setTimeout(() => setSavedMsg(""), 1500);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function applyKnobs() {
    setApplying(true);
    try {
      await saveAdminSettings(dirty);
      const r = await getAdminSettings();
      setKnobs(r.knobs); setDirty({});
      setAdminMsg("Applied ✓ takes effect on the next request");
      setTimeout(() => setAdminMsg(""), 2500);
    } catch (e) {
      setErr(String(e));
    } finally {
      setApplying(false);
    }
  }

  async function resetKnob(key: string) {
    try {
      await resetAdminSetting(key);
      const r = await getAdminSettings();
      setKnobs(r.knobs);
      setDirty((d) => { const n = { ...d }; delete n[key]; return n; });
    } catch (e) {
      setErr(String(e));
    }
  }

  const selectCls = "w-[200px]";

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 pb-6">
      <header className="mb-1 flex items-center gap-3.5">
        <h2 className="text-xl font-bold tracking-tight"><SettingsIcon className="size-3" />️ Settings</h2>
        <span className="flex-1 text-xs text-[var(--muted-foreground)]">{userName} · {role}</span>
        <span className="min-w-16 text-right text-xs font-bold text-emerald-600">{savedMsg}</span>
      </header>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="size-3" />️ {err}</div>
      )}

      {/* Profile */}
      <Card className="border-[var(--border)] shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><User className="size-4 opacity-60" /> Profile</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Field label="Username"><input disabled value={userName} className="w-full rounded-md px-0 py-2 text-sm bg-transparent outline-none opacity-90 border-0 border-b border-[var(--border)] rounded-noney-80 outline-none" /></Field>
          <Field label="Role"><input disabled value={role} className="w-full rounded-md px-0 py-2 text-sm bg-transparent outline-none opacity-90 border-0 border-b border-[var(--border)] rounded-noney-80 outline-none" /></Field>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card className="border-[var(--border)] shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Palette className="size-4 opacity-60" /> Appearance</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Theme">
            <Select value={s?.theme ?? "system"} onValueChange={(v) => patch({ theme: v })}>
              <SelectTrigger className={selectCls}><SelectValue placeholder="Theme" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Density">
            <Select value={s?.density ?? "comfortable"} onValueChange={(v) => patch({ density: v })}>
              <SelectTrigger className={selectCls}><SelectValue placeholder="Density" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="comfortable">Comfortable</SelectItem>
                <SelectItem value="compact">Compact</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Chat font size">
            <Select value={String(s?.chat_font_size ?? 14)} onValueChange={(v) => patch({ chat_font_size: Number(v) })}>
              <SelectTrigger className={selectCls}><SelectValue /></SelectTrigger>
              <SelectContent>{[12, 14, 16].map((n) => <SelectItem key={n} value={String(n)}>{n} px</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Code font">
            <Select value={s?.code_font ?? "JetBrains Mono"} onValueChange={(v) => patch({ code_font: v })}>
              <SelectTrigger className={selectCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="JetBrains Mono">JetBrains Mono</SelectItem>
                <SelectItem value="System (Segoe UI)">System (Segoe UI)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {/* Chat behavior */}
      {!s ? (
        <Card className="border-[var(--border)] p-4"><div className="space-y-3"><Skeleton className="h-4 w-40" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div></Card>
      ) : (
        <Card className="border-[var(--border)] shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><MessageSquare className="size-4 opacity-60" /> Chat behavior</CardTitle></CardHeader>
          <CardContent>
            {TOGGLES.map((t) => (
              <Row key={t.key} label={t.label} hint={t.hint}>
                <Switch checked={!!s[t.key]} onCheckedChange={(v) => patch({ [t.key]: v } as Partial<UserSettings>)} />
              </Row>
            ))}
            <Row label="History retention (days)">
              <input
                type="number" min={7} max={365} value={s.history_retention_days}
                onChange={(e) => patch({ history_retention_days: Number(e.target.value) })}
                className="w-24 rounded-md bg-transparent px-1 py-2 text-sm outline-none border-b border-[var(--border)] focus:border-[var(--ring)] rounded-b-none"
              />
            </Row>
          </CardContent>
        </Card>
      )}

      {/* RAG tuning (admin) */}
      {isAdmin && knobs && (
        <Card className="border-indigo-300 shadow-sm dark:border-indigo-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FlaskConical className="size-4 opacity-60" /> RAG tuning
              <Badge variant="outline" className="ml-1 font-normal text-[var(--muted-foreground)]">applies on the next request</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {adminMsg && <div className="mb-2 inline-block rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{adminMsg}</div>}
            {knobs.map((k) => (
              <Row key={k.key} label={<code>{k.key}</code>} hint={`type ${k.type} · default ${k.default}${k.overridden ? " · OVERRIDDEN" : ""}`}>
                <span className="flex w-full max-w-[320px] flex-col gap-1">
                  <span className="flex items-center justify-between gap-2">
                    <input
                      type={k.type === "int" || k.type === "float" ? "number" : "text"}
                      step={k.type === "float" ? "0.01" : undefined}
                      value={dirty[k.key] ?? String(k.current)}
                      onChange={(e) => setDirty((d) => ({ ...d, [k.key]: e.target.value }))}
                      className="w-24 rounded-md bg-transparent px-1 py-2 text-sm tabular-nums outline-none border-b border-[var(--border)] focus:border-[var(--ring)] rounded-b-none"
                    />
                    <span className="text-[11px] text-[var(--muted-foreground)]">{SLIDER_BOUNDS[k.key] ? `range ${SLIDER_BOUNDS[k.key][0]}–${SLIDER_BOUNDS[k.key][1]}` : ""}</span>
                  </span>
                  {SLIDER_BOUNDS[k.key] && (
                    <input
                      type="range"
                      min={SLIDER_BOUNDS[k.key][0]}
                      max={SLIDER_BOUNDS[k.key][1]}
                      step={k.type === "float" ? 0.01 : 1}
                      value={Number(dirty[k.key] ?? k.current) || 0}
                      onChange={(e) => setDirty((d) => ({ ...d, [k.key]: e.target.value }))}
                      className="w-full accent-[var(--primary)]"
                    />
                  )}
                </span>
                {k.overridden && (
                  <Button variant="ghost" size="sm" onClick={() => resetKnob(k.key)} title="Reset to env default">
                    <RotateCcw className="size-3.5" /> reset
                  </Button>
                )}
              </Row>
            ))}
            {Object.keys(dirty).length > 0 && (
              <Button className="mt-3 w-full sm:w-auto" onClick={applyKnobs} disabled={applying}>
                {applying ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Apply changes ({Object.keys(dirty).length})
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Escalation */}
      <Card className="border-[var(--border)] shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Send className="size-4 opacity-60" /> Escalation</CardTitle></CardHeader>
        <CardContent>
          {ESC_TOGGLES.map((t) => (
            <Row key={t.key} label={t.label}>
              <Switch checked={!!s?.[t.key]} onCheckedChange={(v) => patch({ [t.key]: v } as Partial<UserSettings>)} />
            </Row>
          ))}
        </CardContent>
      </Card>

      {/* Integrations */}
      <Card className="border-[var(--border)] shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <PlugZap className="size-4 opacity-60" /> Integrations &amp; KB status
            <Badge variant="secondary" className="font-normal">secrets never shown</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!integrations ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : (
            <>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
              {(() => {
                const g = integrations!;
                const light = (v: unknown, warnVals: string[] = ["placeholder"]) =>
                  v === "set" || v === true ? "ok" : warnVals.includes(String(v)) ? "warn" : "err";
                const items: { name: string; detail: string; level: "ok" | "warn" | "err"; link?: string }[] = [
                  { name: "PostgreSQL", detail: `CNPG ${g.postgres?.url?.split("@")[1] ?? ""}`, level: "ok" },
                  { name: "Redis", detail: `${g.redis?.mode} · master ${g.redis?.master_name}`, level: light(g.redis?.password) as any },
                  { name: "Ollama (embeddings)", detail: `${g.ollama?.embedding_model} · ${g.ollama?.embedding_dim}-dim`, level: "ok" },
                  { name: "LLM", detail: `${g.llm?.provider} / ${g.llm?.model}`, level: light(g.llm?.api_key) as any },
                  { name: "Jira", detail: g.jira?.project ? `project ${g.jira.project}` : "not configured", level: light(g.jira?.token) as any },
                  { name: "Confluence", detail: g.confluence?.space_keys || "no spaces", level: light(g.confluence?.token) as any },
                ];
                return items.map((it) => (
                  <div key={it.name} className="rounded-xl border border-[var(--border)] p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${it.level === "ok" ? "bg-emerald-500" : it.level === "warn" ? "bg-amber-500" : "bg-red-400"}`} />
                      <span className="text-[13px] font-bold">{it.name}</span>
                    </div>
                    <div className="truncate text-[11.5px] text-[var(--muted-foreground)]" title={it.detail}>{it.detail}</div>
                  </div>
                ));
              })()}
            </div>

            {/* Observability deep-links */}
            {gao(integrations) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {gao(integrations)!.map((l) => (
                  <a key={l.label} href={l.url} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--primary)] hover:bg-[var(--accent-soft)]">
                     <TrendingUp className="size-3" /> {l.label} ↗
                  </a>
                ))}
              </div>
            )}
            </>
          )}
        </CardContent>
      </Card>

      {/* About */}
      <Card className="border-[var(--border)] shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Info className="size-4 opacity-60" /> About</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <Field label="App version"><input disabled value={`${integrations?.app?.version ?? "?"} (${integrations?.app?.env ?? "?"})`} className="w-full rounded-md px-0 py-2 text-sm bg-transparent outline-none opacity-90 border-0 border-b border-[var(--border)] rounded-noney-80 outline-none" /></Field>
            <Field label="Service"><input disabled value={integrations?.app?.service ?? "?"} className="w-full rounded-md px-0 py-2 text-sm bg-transparent outline-none opacity-90 border-0 border-b border-[var(--border)] rounded-noney-80 outline-none" /></Field>
          </div>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Backend API docs: <a href="/docs" target="_blank" rel="noreferrer" className="text-[var(--primary)] underline-offset-2 hover:underline">/docs</a> (FastAPI Swagger)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
