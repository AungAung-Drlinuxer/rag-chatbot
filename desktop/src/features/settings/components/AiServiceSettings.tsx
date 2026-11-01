/**
 * AI service — the assistant's model provider and answer behaviour, in one place.
 *
 * This section owns the whole "llm" integration: which provider answers, the base URL, the
 * write-only API key, and the model (auto-detected from the provider's catalogue). It also
 * owns the two retrieval knobs that live in the backend runtime, because they are the same
 * decision — "how does the assistant answer" — and splitting them across two screens with
 * two different save buttons was the thing that made the old layout confusing.
 *
 * One section, one Save. Nothing here is stored on the device.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, ChevronDown, Database, Eye, EyeOff, ExternalLink, Gauge,
  Info, KeyRound, Layers, Loader2, Lock, Pencil, RefreshCw, Save, Search, ShieldCheck,
  Sparkles, Trash2, XCircle,
} from "lucide-react";

import {
  deleteIntegrationSettings, getIntegrationSettings, getLlmModels, getRuntime,
  putIntegrationSettings, putRuntime, testIntegration,
} from "@/features/settings/api";
import { LLM_PRESETS, presetFor, providerLabel } from "../llmProviders";

type Msg = { ok: boolean; text: string } | null;

export function AiServiceSettings({ isAdmin }: { isAdmin: boolean }) {
  // ---- stored provider config ------------------------------------------------------
  const [provider, setProvider] = useState<string>("clinepass");
  const [storedModel, setStoredModel] = useState<string>("");
  const [fieldsSet, setFieldsSet] = useState<string[]>([]);
  const [secretFields, setSecretFields] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // ---- editable form. A value here is an ADD/REPLACE, never a read of what is stored. --
  const [form, setForm] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // ---- model catalogue -------------------------------------------------------------
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [modelsSource, setModelsSource] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const autoDetectedFor = useRef<string | null>(null);

  // ---- retrieval knobs -------------------------------------------------------------
  const [topK, setTopK] = useState("5");
  const [threshold, setThreshold] = useState("0.75");

  // ---- status ----------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const tokenSet = secretFields.includes("api_key");
  const preset = presetFor(form.provider || provider);
  const isConfigured = (k: string) => fieldsSet.includes(k);
  const isSecret = (k: string) => secretFields.includes(k);
  const editable = (k: string) => !isConfigured(k) || !!replacing[k];

  // ---- load ------------------------------------------------------------------------
  const load = async () => {
    try {
      const d: any = await getIntegrationSettings("llm");
      const s = d?.settings ?? {};
      setProvider(s.provider ?? "clinepass");
      setStoredModel(s.model ?? "");
      setFieldsSet(d?.fields_set ?? []);
      setSecretFields(d?.secret_fields ?? []);
      setUpdatedAt(d?.updated_at ?? null);
    } catch { /* non-admin or unconfigured */ }
  };

  const loadRuntime = async () => {
    try {
      const d = await getRuntime();
      const o = d?.overrides ?? {};
      if (o.retrieval_top_k != null) setTopK(String(o.retrieval_top_k));
      if (o.confidence_gate_threshold != null) setThreshold(String(o.confidence_gate_threshold));
    } catch { /* non-admin */ }
  };

  /** Read the provider's real catalogue. Uses the SAVED key, so it cannot run from a key
   *  that has only been typed — hence detection on mount and after a save. */
  const loadModels = async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await getLlmModels();
      const list = res.models || [];
      setModels(list);
      setModelsSource((res as { source?: string }).source ?? null);
      if (!list.length) setModelsError("Provider returned an empty model list.");
    } catch (err: any) {
      setModels([]);
      setModelsSource(null);
      setModelsError(err?.message || "Could not reach the provider");
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    (async () => {
      await Promise.all([load(), loadRuntime()]);
      setLoading(false);
    })();
  }, [isAdmin]);

  // Auto-detect once a key is stored, and once per provider/model change — never per render.
  useEffect(() => {
    if (!isAdmin || !tokenSet) return;
    const signature = `${provider}|${storedModel}`;
    if (autoDetectedFor.current === signature) return;
    autoDetectedFor.current = signature;
    void loadModels();
  }, [isAdmin, tokenSet, provider, storedModel]);

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q),
    );
  }, [models, modelQuery]);

  // ---- actions ---------------------------------------------------------------------
  /** Changing provider also moves the base URL and model, because a ClinePass provider with
   *  an OpenRouter-style model id authenticates fine and then 404s on every request. */
  function applyProvider(id: string) {
    const p = presetFor(id);
    const next: Record<string, string> = { ...form, provider: id };
    if (p.base_url) next.base_url = p.base_url;
    if (p.model) next.model = p.model;
    setForm(next);
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) if (v && v.trim()) payload[k] = v.trim();
      const changed = Object.keys(payload).length;

      if (changed) await putIntegrationSettings("llm", payload);
      await putRuntime({
        retrieval_top_k: Number(topK) || 5,
        confidence_gate_threshold: Number(threshold) || 0.75,
      });

      await load();
      setForm({});
      setReplacing({});
      setRevealed({});
      setMsg({
        ok: true,
        text: changed
          ? `Saved ${changed} field(s) and the retrieval settings.`
          : "Retrieval settings saved — stored credentials are unchanged.",
      });
      // A newly stored key makes the catalogue reachable; detect it now.
      if (changed) {
        autoDetectedFor.current = null;
        void loadModels();
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await testIntegration("llm");
      setMsg(
        r.ok
          ? { ok: true, text: `Connection OK${r.status ? ` (HTTP ${r.status})` : ""}.` }
          : { ok: false, text: r.detail || r.error || `Provider refused the request${r.status ? ` (HTTP ${r.status})` : ""}.` },
      );
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function clear() {
    setClearing(true);
    setMsg(null);
    try {
      await deleteIntegrationSettings("llm");
      await load();
      setModels([]);
      setMsg({ ok: true, text: "Stored provider credentials removed." });
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || "Could not remove the stored settings" });
    } finally {
      setClearing(false);
    }
  }

  const dirty = Object.values(form).some((v) => v && v.trim().length > 0);
  const selectedModel = form.model || storedModel;

  // ---- read-only view for non-admins -----------------------------------------------
  if (!isAdmin) {
    return (
      <Card icon={<Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
        tone="bg-indigo-50 dark:bg-indigo-950/40"
        title="AI Assistant" description="How the assistant answers your questions.">
        <Row label="AI provider" hint="Managed by your IT administrators.">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {providerLabel(provider)}
          </span>
        </Row>
        <Row label="Model" hint="The model currently answering.">
          <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{storedModel || "—"}</span>
        </Row>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-background p-6 text-xs text-slate-500 dark:text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the AI service configuration…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- status hero ---------------------------------------------------------- */}
      <div className="rounded-xl border border-[var(--border)] bg-gradient-to-br from-indigo-50 to-transparent p-5 dark:from-indigo-950/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {providerLabel(provider)}
              </h3>
              {tokenSet ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-2xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> Key stored
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-2xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  <AlertCircle className="h-3 w-3" /> No API key
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate font-mono text-xs text-slate-600 dark:text-slate-300" title={storedModel}>
              {storedModel || "no model selected"}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {models.length > 0
                ? `${models.length} model${models.length === 1 ? "" : "s"} detected`
                : tokenSet
                  ? "detecting models…"
                  : "add an API key to detect models"}
              {" · "}top {topK} chunks · {Math.round((Number(threshold) || 0.75) * 100)}% gate
            </p>
          </div>
          <a href={preset.docs} target="_blank" rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-800/60">
            Provider docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* ---- provider ------------------------------------------------------------- */}
      <Card icon={<Database className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
        tone="bg-indigo-50 dark:bg-indigo-950/40"
        title="Provider"
        description="Which service generates the answers, and the credential it uses.">

        <div className="px-5 py-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* provider */}
            <Field label="AI provider" hint={preset.note}>
              <div className="relative">
                <select value={form.provider || provider}
                  onChange={(e) => applyProvider(e.target.value)}
                  className="h-9 w-full appearance-none rounded-lg border border-[var(--border)] bg-background px-3 pr-9 text-xs font-medium text-foreground outline-none focus:border-blue-500">
                  {LLM_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </Field>

            {/* base url */}
            <Field label="Base URL" badge={isConfigured("base_url") ? "Configured" : undefined}>
              <ValueInput field="base_url" placeholder="https://api.cline.bot/api/v1" />
            </Field>
          </div>
        </div>

        {/* api key — its own row, because it is the one field that is a secret */}
        <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <Field label="API key" icon={<KeyRound className="h-3 w-3" />}
            badge={tokenSet ? "Saved — not retrievable" : undefined}>
            <ValueInput field="api_key" placeholder="your provider API key" secret />
          </Field>
          <p className="mt-1.5 flex items-start gap-1 text-xs leading-4 text-slate-400">
            <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
            Write-only: stored server-side and never returned. Leave blank to keep the current key.
          </p>
        </div>

        {/* model */}
        <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <Field label="Model" badge={models.length ? `${models.length} detected` : undefined}>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                  <input type="text" value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    placeholder={models.length ? `Filter ${models.length} models…` : "No models detected yet"}
                    disabled={!models.length}
                    className="h-9 w-full rounded-lg border border-[var(--border)] bg-background py-2 pl-9 pr-3 text-xs text-foreground outline-none focus:border-blue-500 disabled:opacity-60" />
                </div>
                <button type="button" onClick={() => void loadModels()} disabled={loadingModels}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? "animate-spin" : ""}`} />
                  {loadingModels ? "Detecting…" : models.length ? "Re-detect" : "Detect models"}
                </button>
              </div>

              {models.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border)]">
                  {filteredModels.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-slate-400">No model matches “{modelQuery}”.</p>
                  ) : filteredModels.map((m) => {
                    const on = selectedModel === m.id;
                    return (
                      <button key={m.id} type="button" onClick={() => setForm({ ...form, model: m.id })}
                        className={[
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs",
                          on ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200"
                             : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60",
                        ].join(" ")}>
                        <span className="truncate">{m.id}</span>
                        {on && <CheckCircle2 className="ml-auto size-3 shrink-0 text-indigo-600" />}
                      </button>
                    );
                  })}
                </div>
              )}

              <input type="text" value={form.model || ""}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="or type a model id"
                spellCheck={false} autoComplete="off"
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-blue-500" />

              {modelsError && (
                <p className="flex items-start gap-1 text-xs text-rose-600">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {modelsError}
                  <button type="button" onClick={() => void loadModels()} className="ml-1 underline hover:no-underline">retry</button>
                </p>
              )}
              {!modelsError && models.length > 0 && (
                <p className="flex items-center gap-1 text-xs text-slate-400">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  {models.length} model{models.length === 1 ? "" : "s"} auto-detected
                  {modelsSource === "clinepass" ? " from the ClinePass catalogue" : " from the provider"}
                  {modelQuery && ` — ${filteredModels.length} match “${modelQuery}”`}
                </p>
              )}
            </div>
          </Field>
        </div>
      </Card>

      {/* ---- retrieval ------------------------------------------------------------ */}
      <Card icon={<Layers className="h-5 w-5 text-sky-600 dark:text-sky-400" />}
        tone="bg-sky-50 dark:bg-sky-950/40"
        title="Retrieval & answer behaviour"
        description="Shared backend settings — they change the assistant for everyone once saved.">

        <div className="px-5 py-4">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                <Gauge className="h-3.5 w-3.5 text-slate-400" /> Confidence threshold
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Minimum confidence required before an answer is returned. Below it, the
                assistant escalates instead of guessing.
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">
              {Math.round((Number(threshold) || 0.75) * 100)}%
            </span>
          </div>
          <input type="range" min="50" max="100" step="5"
            value={Math.round((Number(threshold) || 0.75) * 100)}
            onChange={(e) => setThreshold(String(Number(e.target.value) / 100))}
            aria-label="Confidence threshold"
            className="mt-4 w-full accent-indigo-600" />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>50%</span><span>75%</span><span>100%</span>
          </div>
        </div>

        <Row label="Top K results" hint="Knowledge chunks retrieved per question.">
          <input type="number" min={1} max={20} value={topK}
            onChange={(e) => setTopK(e.target.value)}
            aria-label="Top K results"
            className="h-9 w-24 rounded-lg border border-[var(--border)] bg-background px-3 text-sm text-foreground outline-none focus:border-sky-500" />
        </Row>
      </Card>

      {/* ---- actions -------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-background p-4">
        <button type="button" onClick={save} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save AI settings
        </button>
        <button type="button" onClick={test} disabled={testing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800">
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Test connection
        </button>
        {(tokenSet || fieldsSet.length > 0) && (
          <button type="button" onClick={clear} disabled={clearing}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3.5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/30"
            title="Revoke the stored credentials — the only way to remove a write-only value">
            {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Remove stored credentials
          </button>
        )}
        {dirty && !msg && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <Info className="h-3 w-3" /> Unsaved changes
          </span>
        )}
        {msg && (
          <span className={["inline-flex items-center gap-1 text-xs", msg.ok ? "text-emerald-600" : "text-rose-600"].join(" ")}>
            {msg.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {msg.text}
          </span>
        )}
        {updatedAt && !msg && (
          <span className="ml-auto text-xs text-slate-400">
            Last saved {new Date(updatedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- field helpers */

  /** A stored value is never rendered: show a mask and require Replace. */
  function ValueInput({ field, placeholder, secret }: { field: string; placeholder: string; secret?: boolean }) {
    const configured = isConfigured(field);
    const isSec = secret || isSecret(field);
    const show = !!revealed[field];

    if (configured && !editable(field)) {
      return (
        <div className="flex items-center gap-2">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-slate-50 px-3 dark:bg-slate-900/60">
            <Lock className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="select-none font-mono text-xs tracking-widest text-slate-400">••••••••</span>
            <span className="ml-auto text-2xs text-slate-400">write-only</span>
          </div>
          <button type="button" onClick={() => setReplacing({ ...replacing, [field]: true })}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
            title="Enter a new value">
            <Pencil className="h-3.5 w-3.5" /> Replace
          </button>
        </div>
      );
    }

    return (
      <div>
        <div className="relative">
          <input type={isSec && !show ? "password" : "text"}
            value={form[field] || ""}
            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            placeholder={isSec && tokenSet ? "leave blank to keep current" : placeholder}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            data-1p-ignore data-lpignore="true"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-background px-3 pr-10 font-mono text-xs text-foreground outline-none focus:border-blue-500 placeholder:font-sans" />
          {isSec && (
            <button type="button" aria-label={show ? `Hide ${field}` : `Reveal ${field}`}
              onClick={() => setRevealed({ ...revealed, [field]: !show })}
              className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600">
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        {configured && (
          <button type="button"
            onClick={() => {
              setReplacing({ ...replacing, [field]: false });
              const n = { ...form }; delete n[field]; setForm(n);
            }}
            className="mt-1 text-xs text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300">
            Keep the stored value
          </button>
        )}
      </div>
    );
  }
}

/* ---------------------------------------------------------------- presentational */

function Card({ icon, tone, title, description, children }: {
  icon: React.ReactNode; tone: string; title: string; description: string; children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-background">
      <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Field({ label, hint, badge, icon, children }: {
  label: string; hint?: string; badge?: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
        {icon}{label}
        {badge && (
          <span className="inline-flex items-center gap-1 text-2xs text-emerald-600">
            <Lock className="h-3 w-3" />{badge}
          </span>
        )}
      </label>
      {children}
      {hint && <p className="text-xs leading-4 text-slate-400">{hint}</p>}
    </div>
  );
}
