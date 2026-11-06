import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen, CheckCircle2, ExternalLink, Info, Loader2, Loader as LoaderIcon, Lock,
  Pencil, Plus, Power, Save, Search, Settings2, ShieldCheck, Ticket, Trash2, X, XCircle,
  Eye, EyeOff, ChevronRight, Sparkles,
} from "lucide-react";
import {
  deleteIntegrationSettings, getIntegrationSettings, getMySettings, putIntegrationSettings, testIntegration, updateMySettings,
} from "@/features/settings/api";

/* ============================================================
   v1.7.0 — Settings → Integrations, rebuilt around OPT-IN.

   Ten providers on one screen is a wall of empty forms: an admin who only uses
   Jira still had to scroll past nine credential panels. So the screen now opens
   on a catalogue of what CAN be connected, every provider is OFF by default,
   and only the providers the operator switches on get a configuration panel.
   The on/off choice is per USER and persisted in that user's preference blob
   (`integration_toggles`), because "which tools do I work with" is a personal
   choice, while the credentials themselves stay deployment-wide (admin only).

   Turning a provider off hides its panel but does NOT delete stored
   credentials — removal stays an explicit, confirmed action inside the panel.
============================================================ */

type ProviderKey = "confluence" | "jira";

type Field = { key: string; label: string; placeholder: string; type?: string; isSecret?: boolean };

type Provider = {
  key: ProviderKey;
  name: string;
  tagline: string;
  desc: string;
  category: Category;
  icon: typeof BookOpen;
  docs: string;
  fields: Field[];
};

type Category = "Knowledge & docs" | "Work tracking";

const CATEGORIES: Category[] = ["Knowledge & docs", "Work tracking"];

/**
 * Field groups. Every integration's fields answer one of three different questions,
 * and a flat column made an endpoint, a secret and a tuning knob look identical.
 * The group is DERIVED from the field key so it stays right when a provider is added.
 */
type FieldGroup = "connection" | "credentials" | "options";

const CREDENTIAL_KEYS = new Set([
  "api_key", "api_token", "access_token", "bind_password", "client_secret", "password", "token", "secret",
]);
const CONNECTION_KEYS = new Set(["base_url", "host", "port", "issuer", "redirect_uri", "url", "realm"]);

function groupOf(fieldKey: string): FieldGroup {
  const k = fieldKey.toLowerCase();
  if (CREDENTIAL_KEYS.has(k)) return "credentials";
  if (CONNECTION_KEYS.has(k)) return "connection";
  return "options";
}

const GROUP_ORDER: FieldGroup[] = ["connection", "credentials", "options"];
const GROUP_META: Record<FieldGroup, { label: string; hint: string }> = {
  connection: { label: "Connection", hint: "Where the service lives" },
  credentials: { label: "Credentials", hint: "Write-only — stored server-side, never returned" },
  options: { label: "Options", hint: "Scope and tuning" },
};

const PROVIDERS: Provider[] = [
  {
    key: "confluence",
    name: "Confluence",
    tagline: "Import wiki spaces into the knowledge base",
    desc: "Connect Confluence Cloud to import pages into the knowledge base. Pages from the listed spaces are chunked, embedded and become answer sources.",
    category: "Knowledge & docs",
    icon: BookOpen,
    docs: "https://id.atlassian.com/manage-profile/security/api-tokens",
    fields: [
      { key: "base_url", label: "Base URL", placeholder: "https://your-domain.atlassian.net/wiki" },
      { key: "email", label: "Account Email", placeholder: "you@your-domain.com" },
      { key: "api_token", label: "API Token", placeholder: "ATATT3xFfGF0...", isSecret: true },
      { key: "space_keys", label: "Space Keys (comma separated)", placeholder: "HELP, IT, ENG" },
    ],
  },
  {
    key: "jira",
    name: "Jira",
    tagline: "Auto-create escalation tickets",
    desc: "Connect Jira Cloud to auto-create escalation tickets. The project key is the default target when the assistant escalates a conversation.",
    category: "Work tracking",
    icon: Ticket,
    docs: "https://id.atlassian.com/manage-profile/security/api-tokens",
    fields: [
      { key: "base_url", label: "Base URL", placeholder: "https://your-domain.atlassian.net" },
      { key: "email", label: "Account Email", placeholder: "you@your-domain.com" },
      { key: "api_token", label: "API Token", placeholder: "ATATT3xFfGF0...", isSecret: true },
      { key: "project_key", label: "Default Project Key", placeholder: "ITHD" },
    ],
  },
];

/**
 * DEV BUILD — this deployment runs two connectors: Confluence (documents in) and Jira
 * (tickets out). The other providers stay defined below because their settings still
 * exist server-side and re-appear the moment they are added to this list; hiding them
 * here only stops the UI from offering a sync that has no destination configured.
 */
const BY_KEY = Object.fromEntries(PROVIDERS.map((p) => [p.key, p])) as Record<ProviderKey, Provider>;

/** Per-user opt-in map, stored in the user's preference blob. */
const PREF_KEY = "integration_toggles";

/* ============================================================
   SMALL UI PIECES
============================================================ */

function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={[
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        on
          ? "border-transparent bg-[var(--primary)]"
          : "border-[var(--border)] bg-muted",
      ].join(" ")}
    >
      <span
        className={[
          "size-3.5 rounded-full bg-white shadow-sm transition-transform",
          on ? "translate-x-[18px]" : "translate-x-[3px]",
        ].join(" ")}
      />
    </button>
  );
}

function StatusPill({ configured }: { configured?: boolean }) {
  if (configured === undefined) {
    // Unknown, not "unconfigured": the status probe is still in flight (or failed),
    // and claiming "Needs setup" for a live integration would be a lie.
    return <span className="text-2xs text-muted-foreground/60">Status unavailable</span>;
  }
  return configured ? (
    <span className="inline-flex items-center gap-1 text-2xs font-medium text-[var(--ok)]">
      <CheckCircle2 className="h-3 w-3" /> Configured
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-[var(--warn)]" /> Needs setup
    </span>
  );
}

/* ============================================================
   PROVIDER EDITOR — only mounted for an enabled provider
============================================================ */

function ProviderEditor({ provider, onConfigured }: {
  provider: Provider;
  onConfigured: (key: ProviderKey, configured: boolean) => void;
}) {
  // `form` holds ONLY newly typed values. Stored values are never loaded into it
  // (the API does not return them), so Save can never re-submit a placeholder.
  const [form, setForm] = useState<Record<string, string>>({});
  const [fieldsSet, setFieldsSet] = useState<string[]>([]);
  const [secretFields, setSecretFields] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [clearing, setClearing] = useState(false);
  const [tokenSet, setTokenSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getIntegrationSettings(provider.key);
      setForm({});
      setReplacing({});
      const set = res.fields_set || [];
      setFieldsSet(set);
      setSecretFields(res.secret_fields || []);
      setUpdatedAt(res.updated_at || null);
      setTokenSet(!!res.token_set || (res.secret_fields || []).length > 0);
      onConfigured(provider.key, set.length > 0);
    } catch {
      setForm({});
      setFieldsSet([]);
      setSecretFields([]);
      setUpdatedAt(null);
      setTokenSet(false);
    } finally {
      setLoading(false);
    }
  }, [provider.key, onConfigured]);

  useEffect(() => {
    setResult(null);
    setRevealed({});
    load();
  }, [load]);

  const isConfigured = (fieldKey: string) => fieldsSet.includes(fieldKey);
  const isEditable = (fieldKey: string) =>
    !isConfigured(fieldKey) || !!replacing[fieldKey] || fieldKey in form;

  async function save() {
    setSaving(true);
    setResult(null);
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) if (typeof v === "string" && v.trim()) payload[k] = v;
    const changed = Object.keys(payload).length;
    try {
      await putIntegrationSettings(provider.key, payload);
      setResult({
        ok: true,
        message: changed
          ? `Saved ${changed} field(s). Run Test to verify the connection.`
          : "Nothing new to save — stored values are unchanged.",
      });
      await load();
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const res = await testIntegration(provider.key);
      setResult(res?.ok
        ? { ok: true, message: `Connected as ${res.user || "user"}` }
        : { ok: false, message: res?.detail || res?.error || "Connection failed" });
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function clear() {
    if (!window.confirm(
      `Remove the stored ${provider.name} configuration?\n\n` +
      "Credentials are write-only, so this is the only way to revoke them. " +
      "The integration stops working until it is configured again."
    )) return;
    setClearing(true);
    setResult(null);
    try {
      await deleteIntegrationSettings(provider.key);
      setResult({ ok: true, message: "Stored configuration removed." });
      await load();
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Could not clear the configuration" });
    } finally {
      setClearing(false);
    }
  }



  function renderField(f: Field) {
    const configured = isConfigured(f.key);
    const editable = isEditable(f.key);
    const isSecret = !!f.isSecret || secretFields.includes(f.key);
    const show = !!revealed[f.key];

    return (
      <div key={f.key} className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
          {f.label}
          {configured && (
            <span className="inline-flex items-center gap-1 text-2xs text-[var(--ok)]">
              {isSecret ? <Lock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {isSecret ? "Saved — not retrievable" : "Configured"}
            </span>
          )}
        </label>

        {configured && !editable ? (
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-muted/40 px-3 py-2">
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="select-none font-mono text-xs tracking-widest text-muted-foreground">••••••••</span>
              <span className="ml-auto text-2xs text-muted-foreground">write-only</span>
            </div>
            <button
              type="button"
              onClick={() => setReplacing({ ...replacing, [f.key]: true })}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/50"
              title="Enter a new value for this field"
            >
              <Pencil className="h-3.5 w-3.5" /> Replace
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <input
                type={isSecret && !show ? "password" : (f.type || "text")}
                value={form[f.key] || ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={isSecret && tokenSet ? "leave blank to keep current" : f.placeholder}
                /* Security: an integration token is not a site login. Without these the
                   browser and password managers offer to save it, and autocorrect can
                   ship the value to a third party. */
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 pr-10 font-mono text-xs text-foreground outline-none transition placeholder:font-sans placeholder:text-muted-foreground focus:border-[var(--primary)]"
              />
              {isSecret && (
                <button
                  type="button"
                  aria-label={show ? `Hide ${f.label}` : `Reveal ${f.label}`}
                  onClick={() => setRevealed({ ...revealed, [f.key]: !show })}
                  className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
            {configured && (
              <button
                type="button"
                onClick={() => {
                  setReplacing({ ...replacing, [f.key]: false });
                  const next = { ...form };
                  delete next[f.key];
                  setForm(next);
                }}
                className="mt-1 text-2xs text-muted-foreground underline hover:text-foreground"
              >
                Keep the stored value
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const groups = GROUP_ORDER
    .map((g) => ({ group: g, fields: provider.fields.filter((f) => groupOf(f.key) === g) }))
    .filter((x) => x.fields.length > 0);
  const dirty = Object.values(form).some((v) => typeof v === "string" && v.trim().length > 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card text-card-foreground shadow-xs">
      {/* header */}
      <header className="border-b border-[var(--border)] bg-muted/20 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
              <provider.icon className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold tracking-tight">{provider.name}</h3>
                <StatusPill configured={loading ? undefined : fieldsSet.length > 0} />
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{provider.desc}</p>
            </div>
          </div>
          <a
            href={provider.docs}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[var(--border)] px-2.5 py-1.5 text-2xs font-medium text-foreground transition hover:bg-muted/50"
          >
            Provider docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </header>

      {/* write-only banner */}
      <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-muted/30 px-3 py-2.5">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" />
        <p className="text-2xs leading-relaxed text-muted-foreground">
          <b className="text-foreground">Credentials are write-only.</b> Every value below — URLs, hosts, accounts,
          keys and tokens — is stored server-side and <b className="text-foreground">never returned</b> once saved.
          Enter a value only to add or replace it; leaving a field blank keeps what is stored.
          {updatedAt && <> Last saved {new Date(updatedAt).toLocaleString()}.</>}
        </p>
      </div>

      {/* fields */}
      <div className="space-y-5 px-5 py-4">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading stored configuration…
          </p>
        ) : (
          groups.map(({ group, fields }) => (
            <section key={group}>
              <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-[var(--border)] pb-1.5">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {GROUP_META[group].label}
                </h4>
                <span className="text-2xs text-muted-foreground/70">{GROUP_META[group].hint}</span>
                {group === "credentials" && <Lock className="size-3 text-muted-foreground" />}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {fields.map(renderField)}
              </div>
            </section>
          ))
        )}
      </div>

      {/* actions */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-muted/20 px-5 py-3.5">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-xs font-medium text-[var(--primary-foreground)] transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-medium text-foreground transition hover:bg-muted/50 disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LoaderIcon className="h-3.5 w-3.5" />}
          Test connection
        </button>
                {fieldsSet.length > 0 && (
          <button
            onClick={clear}
            disabled={clearing}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs font-medium text-[var(--danger)] transition hover:bg-[var(--danger)]/10 disabled:opacity-50"
            title="Revoke the stored credentials — the only way to remove a write-only value"
          >
            {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Remove stored settings
          </button>
        )}
      </footer>

      {(dirty || result) && (
        <div className="border-t border-[var(--border)] px-5 py-2.5">
          {dirty && !result && (
            <p className="flex items-center gap-1 text-2xs text-[var(--warn)]">
              <Info className="h-3 w-3" /> Unsaved changes — press Save to store them.
            </p>
          )}
          {result && (
            <p className={["flex items-center gap-1 text-xs", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"].join(" ")}>
              {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {result.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* ============================================================
   CATALOGUE — the browse view; everything starts OFF
============================================================ */

function Catalog({ enabled, status, onToggle, onConfigure, personal }: {
  enabled: Record<string, boolean>;
  status: Record<string, boolean>;
  onToggle: (key: ProviderKey, next: boolean) => void;
  onConfigure: (key: ProviderKey) => void;
  personal: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "All">("All");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PROVIDERS.filter((p) =>
      (category === "All" || p.category === category) &&
      (!q || `${p.name} ${p.tagline} ${p.category} ${p.desc}`.toLowerCase().includes(q))
    );
  }, [query, category]);

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search integrations"
            placeholder="Search integrations…"
            className="h-9 w-full rounded-xl border border-[var(--border)] bg-background pl-9 pr-3 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-[var(--primary)]"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-muted/30 p-1">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={[
                "shrink-0 rounded-lg px-2.5 py-1.5 text-2xs font-medium transition",
                category === c
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((p) => {
          const on = !!enabled[p.key];
          const Icon = p.icon;
          return (
            <div
              key={p.key}
              className={[
                "group relative flex flex-col rounded-2xl border bg-card p-4 transition",
                on
                  ? "border-[var(--primary)]/45 ring-1 ring-[var(--primary)]/15"
                  : "border-[var(--border)] hover:border-[var(--primary)]/30 hover:shadow-sm",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className={[
                      "grid size-9 shrink-0 place-items-center rounded-xl transition",
                      on
                        ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                        : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    <Icon className="size-4.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">{p.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">{p.tagline}</p>
                  </div>
                </div>
                <Switch on={on} onChange={(next) => onToggle(p.key, next)} label={`Enable ${p.name}`} />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
                <StatusPill configured={status[p.key]} />
                {on && !personal ? (
                  <button
                    type="button"
                    onClick={() => onConfigure(p.key)}
                    className="inline-flex items-center gap-1 text-2xs font-medium text-[var(--primary)] hover:underline"
                  >
                    Configure <ChevronRight className="size-3" />
                  </button>
                ) : on ? (
                  <span className="text-2xs text-muted-foreground">Set up by your admin</span>
                ) : (
                  <span className="text-2xs text-muted-foreground/70">{p.category}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center">
          <p className="text-xs text-muted-foreground">No integration matches “{query}”.</p>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" />
        {personal
          ? "Switching a tool on keeps it available in your workspace; the connection itself is configured once by an administrator. Your choices are personal and never affect other people."
          : "Switching a provider on adds its configuration panel for you only. It never disables the integration for other users, and switching it off keeps the stored credentials until you remove them inside the panel."}
      </p>
    </div>
  );
}

/* ============================================================
   PANEL
============================================================ */

export function IntegrationsConfig({ variant = "admin" }: { variant?: "admin" | "personal" }) {
  // `personal` is what a non-admin sees: the same per-user opt-in map, but no
  // credential editor — connections are configured once by an administrator, and
  // a member only chooses which of the available tools to keep in their workspace.
  const personal = variant === "personal";
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<ProviderKey | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);

  // Load the per-user opt-in map (falls back to an empty map = everything off).
  useEffect(() => {
    let mounted = true;
    getMySettings()
      .then((s: any) => {
        if (!mounted) return;
        const all: Record<string, any> = s?.settings && typeof s.settings === "object"
          ? { ...s.settings, ...s }
          : { ...s };
        setPrefs(all);
        const map = all?.[PREF_KEY];
        const clean: Record<string, boolean> = {};
        if (map && typeof map === "object") {
          for (const p of PROVIDERS) if (map[p.key] === true) clean[p.key] = true;
        }
        setEnabled(clean);
        const first = PROVIDERS.find((p) => clean[p.key]);
        setSelected(first ? first.key : null);
        // Nothing switched on yet is the honest first-run state: open the catalogue.
        // A member's view IS the catalogue, so it starts open either way.
        if (!first || personal) setBrowsing(true);
      })
      .catch(() => { if (mounted) setBrowsing(true); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // `personal` only decides whether the catalogue opens first; re-running on its
    // change would refetch the user's toggles and discard their current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markConfigured = useCallback((key: ProviderKey, configured: boolean) => {
    setStatus((prev) => (prev[key] === configured ? prev : { ...prev, [key]: configured }));
  }, []);

  // Probe every provider once so the catalogue can show real Configured / Needs setup
  // states. Ten small GETs on open beats showing a placeholder that looks like an answer.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(
      PROVIDERS.map(async (p) => {
        const res = await getIntegrationSettings(p.key);
        return [p.key, (res.fields_set || []).length > 0] as const;
      }),
    ).then((rows) => {
      if (cancelled) return;
      setStatus((prev) => {
        const next = { ...prev };
        for (const r of rows) if (r.status === "fulfilled") next[r.value[0]] = r.value[1];
        return next;
      });
    });
    return () => { cancelled = true; };
  }, []);

  async function persist(next: Record<string, boolean>) {
    setError(null);
    const body = { ...prefs, [PREF_KEY]: next };
    setPrefs(body);
    try {
      await updateMySettings(body as any);
    } catch (e: any) {
      setError(e?.message || "Could not save your integration choices");
    }
  }

  function toggle(key: ProviderKey, next: boolean) {
    const map = { ...enabled };
    if (next) map[key] = true;
    else delete map[key];
    setEnabled(map);
    if (next) {
      setSelected(key);
      setBrowsing(false);
    } else if (selected === key) {
      const rest = PROVIDERS.find((p) => map[p.key]);
      setSelected(rest ? rest.key : null);
    }
    void persist(map);
  }

  const enabledList = PROVIDERS.filter((p) => enabled[p.key]);
  const activeProvider = selected ? BY_KEY[selected] : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-8 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading integrations…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* summary strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-muted/25 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">
              {enabledList.length} of {PROVIDERS.length} integrations enabled
            </p>
            <p className="text-2xs text-muted-foreground">
              {personal
                ? "Switch on the tools you use — your choice is saved to your own account."
                : "Only enabled providers show a configuration panel — keep the list short."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enabledList.length > 0 && (
            <button
              type="button"
              onClick={() => { setEnabled({}); setSelected(null); setBrowsing(true); void persist({}); }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-1.5 text-2xs font-medium text-foreground transition hover:bg-muted/50"
            >
              <Power className="size-3" /> Turn all off
            </button>
          )}
          {!personal && (
            <button
              type="button"
              onClick={() => setBrowsing((b) => !b)}
              className={[
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-2xs font-semibold transition",
                browsing
                  ? "border border-[var(--border)] text-foreground hover:bg-muted/50"
                  : "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90",
              ].join(" ")}
            >
              {browsing ? <><X className="size-3" /> Close catalogue</> : <><Plus className="size-3" /> Add integration</>}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-2xs text-[var(--danger)]">
          {error}
        </p>
      )}

      {browsing || personal ? (
        <Catalog enabled={enabled} status={status} onToggle={toggle} personal={personal} onConfigure={(k) => { setSelected(k); setBrowsing(false); }} />
      ) : enabledList.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] px-6 py-12 text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Settings2 className="size-5" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">No integrations enabled</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Pick only the tools your workspace actually uses. Each one you enable gets its own configuration panel here.
          </p>
          <button
            type="button"
            onClick={() => setBrowsing(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-xs font-medium text-[var(--primary-foreground)] transition hover:opacity-90"
          >
            <Plus className="size-3.5" /> Browse integrations
          </button>
        </div>
      ) : (
        <>
          {/* enabled selector */}
          <div className="flex flex-wrap gap-1.5">
            {enabledList.map((p) => {
              const on = selected === p.key;
              const Icon = p.icon;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setSelected(p.key)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-2xs font-medium transition",
                    on
                      ? "border-[var(--primary)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                      : "border-[var(--border)] text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="size-3" />
                  {p.name}
                  <span className={["size-1.5 rounded-full", status[p.key] ? "bg-[var(--ok)]" : "bg-[var(--warn)]"].join(" ")} />
                </button>
              );
            })}
          </div>

          {activeProvider && (
            <ProviderEditor
              key={activeProvider.key}
              provider={activeProvider}
              onConfigured={markConfigured}
            />
          )}

          <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" />
            Disabling a provider only hides its panel from your view. To revoke credentials, use
            “Remove stored settings” inside that provider's panel.
          </p>
        </>
      )}
    </div>
  );
}
