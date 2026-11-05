/**
 * AI service — the assistant's model provider and answer behaviour, in one place.
 *
 * This section owns the whole "llm" integration: which provider answers, the base URL, the
 * write-only API key, and the model (auto-detected from the provider's catalogue). It also
 * owns the two retrieval knobs that live in the backend runtime, because they are the same
 * decision — "how does the assistant answer" — and splitting them across two screens with
 * two different save buttons is what made the old layout confusing.
 *
 * One section, one Save. Nothing here is stored on the device.
 *
 * v1.7.1 — rebuilt on the shared SettingsKit: a status hero, then Provider / Model /
 * Retrieval panels, then one action bar. Logic is unchanged; only the presentation and
 * a broken `aria-label` on the manual model input were touched.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, ChevronDown, Gauge, Info, KeyRound, Layers, Loader2, Lock,
  Pencil, RefreshCw, Save, Search, ShieldCheck, Sparkles, Trash2, XCircle,
} from "lucide-react";

import {
  deleteIntegrationSettings, getIntegrationSettings, getLlmModels, getRuntime,
  putIntegrationSettings, putRuntime, testIntegration,
} from "@/features/settings/api";
import { LLM_PRESETS, presetFor, providerLabel } from "../llmProviders";
import {
  BTN_DANGER, BTN_GHOST, BTN_PRIMARY, Eyebrow, Field, FieldGrid, INPUT, INPUT_MONO, Panel,
  Pill, Row,
} from "./SettingsKit";

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
    if (!window.confirm(
      "Remove the stored provider credentials?\n\n" +
      "The key is write-only, so this is the only way to revoke it. The assistant stops " +
      "answering until a new key is saved."
    )) return;
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
      <Panel
        icon={<Sparkles className="size-4.5" />}
        title="AI Assistant"
        description="How the assistant answers your questions. Managed by your IT administrators."
      >
        <Row title="AI provider" hint="Configured centrally — you do not need a key.">
          <span className="text-xs font-medium text-foreground">{providerLabel(provider)}</span>
        </Row>
        <Row title="Model" hint="The model currently answering.">
          <span className="font-mono text-xs text-muted-foreground">{storedModel || "—"}</span>
        </Row>
      </Panel>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-card p-6 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading the AI service configuration…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- status hero ---------------------------------------------------------- */}
      <section className="rounded-2xl border border-[var(--border)] bg-card p-5 text-card-foreground shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
              <Sparkles className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">{providerLabel(provider)}</h2>
                {tokenSet ? (
                  <Pill tone="ok"><CheckCircle2 className="size-3" /> Key stored</Pill>
                ) : (
                  <Pill tone="warn"><AlertCircle className="size-3" /> No API key</Pill>
                )}
              </div>
              <p className="mt-1 truncate font-mono text-xs text-foreground/80" title={storedModel}>
                {storedModel || "no model selected"}
              </p>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                {models.length > 0
                  ? `${models.length} model${models.length === 1 ? "" : "s"} detected`
                  : tokenSet ? "detecting models…" : "add an API key to detect models"}
                {" · "}top {topK} chunks · {Math.round((Number(threshold) || 0.75) * 100)}% confidence gate
              </p>
            </div>
          </div>
          <a
            href={preset.docs}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[var(--border)] px-2.5 py-1.5 text-2xs font-medium text-foreground transition hover:bg-muted/50"
          >
            Provider docs
          </a>
        </div>
      </section>

      {/* ---- provider ------------------------------------------------------------- */}
      <Panel
        icon={<KeyRound className="size-4.5" />}
        title="Provider & credentials"
        description="Which service generates the answers, and the key it authenticates with."
      >
        <div className="space-y-3 p-5">
          <FieldGrid>
            <Field label="AI provider" hint={preset.note}>
              <div className="relative">
                <select
                  value={form.provider || provider}
                  onChange={(e) => applyProvider(e.target.value)}
                  aria-label="AI provider"
                  className={`${INPUT} appearance-none pr-9 font-medium`}
                >
                  {LLM_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </Field>

            <Field
              label="Base URL"
              badge={isConfigured("base_url") ? <Pill tone="ok"><Lock className="size-3" /> Configured</Pill> : undefined}
            >
              <ValueInput field="base_url" placeholder="https://api.cline.bot/api/v1" />
            </Field>
          </FieldGrid>

          <div className="rounded-xl border border-[var(--border)] bg-muted/25 p-4">
            <Field
              label="API key"
              icon={<KeyRound className="size-3" />}
              badge={tokenSet ? <Pill tone="ok"><Lock className="size-3" /> Saved — not retrievable</Pill> : undefined}
            >
              <ValueInput field="api_key" placeholder="your provider API key" secret />
            </Field>
            <p className="mt-2 flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-[var(--ok)]" />
              Write-only: stored server-side and never returned. Leave blank to keep the current key.
            </p>
          </div>
        </div>
      </Panel>

      {/* ---- model ---------------------------------------------------------------- */}
      <Panel
        icon={<Layers className="size-4.5" />}
        title="Model"
        description="Picked from the provider's live catalogue — or typed by id if it is not listed."
        actions={models.length ? <Pill tone="muted">{models.length} detected</Pill> : undefined}
      >
        <div className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                placeholder={models.length ? `Filter ${models.length} models…` : "No models detected yet"}
                disabled={!models.length}
                aria-label="Search models"
                className={`${INPUT} pl-9 disabled:opacity-60`}
              />
            </div>
            <button type="button" onClick={() => void loadModels()} disabled={loadingModels} className={BTN_GHOST}>
              <RefreshCw className={`size-3.5 ${loadingModels ? "animate-spin" : ""}`} />
              {loadingModels ? "Detecting…" : models.length ? "Re-detect" : "Detect models"}
            </button>
          </div>

          {models.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-background">
              {filteredModels.length === 0 ? (
                <p className="px-3 py-3 text-2xs text-muted-foreground">No model matches “{modelQuery}”.</p>
              ) : filteredModels.map((m) => {
                const on = selectedModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setForm({ ...form, model: m.id })}
                    aria-pressed={on}
                    className={[
                      "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs transition",
                      on
                        ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    ].join(" ")}
                  >
                    <span className="truncate">{m.id}</span>
                    {on && <CheckCircle2 className="ml-auto size-3 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          <Field label="Model id" hint="Use this when the catalogue is unavailable or the model is brand new.">
            <input
              type="text"
              value={form.model || ""}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="or type a model id"
              spellCheck={false}
              autoComplete="off"
              aria-label="Model id"
              className={INPUT_MONO}
            />
          </Field>

          {modelsError && (
            <p className="flex items-start gap-1 text-2xs text-[var(--danger)]">
              <AlertCircle className="mt-0.5 size-3 shrink-0" /> {modelsError}
              <button type="button" onClick={() => void loadModels()} className="ml-1 underline hover:no-underline">retry</button>
            </p>
          )}
          {!modelsError && models.length > 0 && (
            <p className="flex items-center gap-1 text-2xs text-muted-foreground">
              <CheckCircle2 className="size-3 text-[var(--ok)]" />
              {models.length} model{models.length === 1 ? "" : "s"} auto-detected
              {modelsSource === "clinepass" ? " from the ClinePass catalogue" : " from the provider"}
              {modelQuery && ` — ${filteredModels.length} match “${modelQuery}”`}
            </p>
          )}
        </div>
      </Panel>

      {/* ---- retrieval ------------------------------------------------------------ */}
      <Panel
        icon={<Gauge className="size-4.5" />}
        title="Retrieval & answer behaviour"
        description="Shared backend settings — they change the assistant for everyone once saved."
      >
        <div className="p-5">
          <Eyebrow hint="Below this the assistant escalates instead of guessing">Confidence threshold</Eyebrow>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="50"
              max="100"
              step="5"
              value={Math.round((Number(threshold) || 0.75) * 100)}
              onChange={(e) => setThreshold(String(Number(e.target.value) / 100))}
              aria-label="Confidence threshold"
              className="h-1.5 flex-1 accent-[var(--primary)]"
            />
            <span className="shrink-0 rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-foreground)] tabular-nums">
              {Math.round((Number(threshold) || 0.75) * 100)}%
            </span>
          </div>
          <div className="mt-1 flex justify-between text-2xs text-muted-foreground/70">
            <span>50%</span><span>75%</span><span>100%</span>
          </div>
        </div>

        <Row title="Top K results" hint="Knowledge chunks retrieved per question.">
          <input
            type="number"
            min={1}
            max={20}
            value={topK}
            onChange={(e) => setTopK(e.target.value)}
            aria-label="Top K results"
            className={`${INPUT} w-24 text-center`}
          />
        </Row>
      </Panel>

      {/* ---- actions -------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-card p-4">
        <button type="button" onClick={save} disabled={saving} className={BTN_PRIMARY}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save AI settings
        </button>
        <button type="button" onClick={test} disabled={testing} className={BTN_GHOST}>
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Test connection
        </button>
        {(tokenSet || fieldsSet.length > 0) && (
          <button
            type="button"
            onClick={clear}
            disabled={clearing}
            className={`ml-auto ${BTN_DANGER}`}
            title="Revoke the stored credentials — the only way to remove a write-only value"
          >
            {clearing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Remove stored credentials
          </button>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {dirty && !msg && (
            <span className="inline-flex items-center gap-1 text-2xs text-[var(--warn)]">
              <Info className="size-3" /> Unsaved changes
            </span>
          )}
          {msg && (
            <span className={`inline-flex items-center gap-1 text-xs ${msg.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
              {msg.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
              {msg.text}
            </span>
          )}
          {updatedAt && !msg && (
            <span className="text-2xs text-muted-foreground">Last saved {new Date(updatedAt).toLocaleString()}</span>
          )}
        </div>
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
          <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-muted/40 px-3">
            <Lock className="size-3 shrink-0 text-muted-foreground" />
            <span className="select-none font-mono text-xs tracking-widest text-muted-foreground">••••••••</span>
            <span className="ml-auto text-2xs text-muted-foreground">write-only</span>
          </div>
          <button
            type="button"
            onClick={() => setReplacing({ ...replacing, [field]: true })}
            className={BTN_GHOST}
            title="Enter a new value"
          >
            <Pencil className="size-3.5" /> Replace
          </button>
        </div>
      );
    }

    return (
      <div>
        <div className="relative">
          <input
            type={isSec && !show ? "password" : "text"}
            value={form[field] || ""}
            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            placeholder={isSec && tokenSet ? "leave blank to keep current" : placeholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            aria-label={field}
            className={`${INPUT_MONO} pr-10 placeholder:font-sans`}
          />
          {isSec && (
            <button
              type="button"
              aria-label={show ? `Hide ${field}` : `Reveal ${field}`}
              onClick={() => setRevealed({ ...revealed, [field]: !show })}
              className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
        </div>
        {configured && (
          <button
            type="button"
            onClick={() => {
              setReplacing({ ...replacing, [field]: false });
              const n = { ...form }; delete n[field]; setForm(n);
            }}
            className="mt-1 text-2xs text-muted-foreground underline hover:text-foreground"
          >
            Keep the stored value
          </button>
        )}
      </div>
    );
  }
}

/* Eye icons kept local so the import list above stays focused on the section's own verbs. */
function EyeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function EyeOffIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5"><path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.4 5.5A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.2M6.2 6.7A17.6 17.6 0 0 0 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.8-.8" /></svg>;
}
