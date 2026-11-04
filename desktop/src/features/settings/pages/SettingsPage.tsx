import {
  Bell,
  Bot,
  Building2,
  Check,
  Globe,
  Mail,
  Link2,
  Monitor,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Lock,
  Pencil,
  Plug,
  BookOpen,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PageShell, PageHeader } from "@/components/ui/page";

import { dashHealth } from "@/features/dashboard/api";
import { IntegrationsConfig } from "../components/IntegrationsConfig";
import { BrandingSettings } from "../components/BrandingSettings";
import { AiServiceSettings } from "../components/AiServiceSettings";
import { Image as ImageIcon } from "lucide-react";
import {
  getMySettings, updateMySettings, getIntegrationSettings,
  getSmtpSettings, putSmtpSettings, sendTestEmail,
} from "@/features/settings/api";

/* v1.6.90 — Settings re-skinned to the workspace mockup:
   breadcrumb + H1 + right-aligned access badge, a horizontal TAB row that
   switches between the four groups (Preferences / Integrations / AI service /
   Email server), a two-column body (content + 260px right rail) and a sticky
   footer bar. All live logic is preserved: server load/save, instant theme
   side-effects, RAG runtime knobs (admin), the Integrations status cards +
   editor tabs + System health checks, and write-only credentials. */

/* ============================================================
   SHARED ROW COMPONENTS (reference style)
============================================================ */

function ToggleRow({ checked, onChange, title, description }: {
  checked: boolean; onChange: (value: boolean) => void; title: string; description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-6 py-3.5">
      <div className="min-w-0 pr-4">
        <p className="text-xs font-semibold text-slate-900 dark:text-white">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{description}</p>}
      </div>
      <div className="shrink-0">
      <button type="button" onClick={() => onChange(!checked)} aria-pressed={checked}
        className={`relative flex h-5.5 w-10 items-center rounded-full transition-colors ${
          checked ? "bg-[var(--primary)]" : "bg-muted ring-1 ring-[var(--border)]"}`}>
        <span className={`size-4.5 rounded-full bg-white shadow-xs transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
      </div>
    </div>
  );
}

function SelectRow({ label, description, value, onChange, options, width = "w-52" }: {
  label: string; description: string; value: string; onChange: (v: string) => void; options: string[]; width?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-6 py-3.5">
      <div className="min-w-0 pr-4">
        <p className="text-xs font-semibold text-slate-900 dark:text-white">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        className={`${width} h-9 rounded-xl border border-[var(--border)] bg-background px-3 text-xs text-foreground outline-none transition focus:border-[var(--primary)]`}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}


/* Grouped settings navigation (v1.6.75). The four groups are the four TABS the
 * mockup renders as a horizontal row. Only panels that HAVE content are listed:
 * this app has no settings behind Extensions / Developer / Plugins, and an empty
 * page is worse than an absent one. The service-status block lives inside
 * Integrations. */
const SETTINGS_NAV: { group: string; items: { id: string; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: "Application",
    items: [
      { id: "general", label: "Preferences", icon: <Monitor className="size-4" /> },
      { id: "integrations", label: "Integrations", icon: <Plug className="size-4" /> },
    ],
  },
  {
    group: "Customize",
    items: [
      { id: "skills", label: "AI service", icon: <BookOpen className="size-4" /> },
      { id: "notifications", label: "Email server", icon: <Bell className="size-4" /> },
    ],
  },
];

function SectionCard({ icon, iconTone, title, description, children }: {
  icon: React.ReactNode; iconTone: string; title: string; description: string; children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card text-card-foreground shadow-xs">
      <div className="border-b border-[var(--border)] px-6 py-4.5 bg-muted/20">
        <div className="flex items-center gap-3.5">
          <div className={`flex size-9 items-center justify-center rounded-xl ${iconTone}`}>{icon}</div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </section>
  );
}

function applyThemeNow(dark: boolean, dense: boolean, anim: boolean, fontSize: number) {
  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.dataset.compact = dense ? "1" : "0";
  root.classList.toggle("animations-off", !anim);
  root.style.setProperty("--chat-font-size", `${fontSize}px`);
}

/** The exact payload the preferences Save writes, and the shape the dirty check
 *  compares against. Kept in one place so "dirty" and "what gets saved" can never
 *  drift apart. */
type PrefValues = {
  theme: "light" | "dark";
  density: "comfortable" | "compact";
  compact: boolean;
  animations: boolean;
  chat_font_size: number;
  show_rag_sources: boolean;
  show_token_usage: boolean;
  markdown_rendering: boolean;
};

/* ============================================================
   PAGE
============================================================ */

export default function Settings({ role }: { role?: string }) {
  // v1.6.75 — which settings tab is open.
  const [active, setActive] = useState("general");
  // v0.21.90 — role gating: user/IT Support/Knowledge Manager only see Preferences,
  // AI Assistant, Notifications. Integrations + Mail are admin-only.
  const isAdmin = role === "admin";

  const [saved, setSaved] = useState(false);

  // Personal preferences backed by typed user_settings fields where available.
  const [darkMode, setDarkMode] = useState(false);
  const [compact, setCompact] = useState(false);
  const [animations, setAnimations] = useState(true);
  const [chatFontSize, setChatFontSize] = useState(14);
  const [sourceCitations, setSourceCitations] = useState(true);
  const [showTokenUsage, setShowTokenUsage] = useState(true);
  const [markdownRendering, setMarkdownRendering] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // v1.6.90 — the last values known to be stored server-side. `dirty` is derived by
  // comparing the live form to this baseline, so the sticky footer can tell the truth
  // about whether there is anything to save, and Discard can restore it exactly.
  const [baseline, setBaseline] = useState<PrefValues | null>(null);

  const currentValues: PrefValues = {
    theme: darkMode ? "dark" : "light",
    density: compact ? "compact" : "comfortable",
    compact,
    animations,
    chat_font_size: chatFontSize,
    show_rag_sources: sourceCitations,
    show_token_usage: showTokenUsage,
    markdown_rendering: markdownRendering,
  };
  const dirty = baseline !== null && JSON.stringify(currentValues) !== JSON.stringify(baseline);

  // The API returns a flat preference object (older servers may wrap it).
  useEffect(() => {
    let mounted = true;
    getMySettings()
      .then((s) => {
        if (!mounted) return;
        const dark = s.theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : s.theme ? s.theme === "dark" : !!s.darkMode;
        const dense = typeof s.compact === "boolean" ? s.compact : s.density === "compact";
        const fontSize = typeof s.chat_font_size === "number" ? s.chat_font_size : 14;
        const anim = s.animations !== false;
        const showSources = typeof s.show_rag_sources === "boolean" ? s.show_rag_sources : true;
        const showTokens = typeof s.show_token_usage === "boolean" ? s.show_token_usage : true;
        const mdRender = typeof s.markdown_rendering === "boolean" ? s.markdown_rendering : true;
        setDarkMode(dark);
        setCompact(dense);
        setAnimations(anim);
        setChatFontSize(fontSize);
        setSourceCitations(showSources);
        setShowTokenUsage(showTokens);
        setMarkdownRendering(mdRender);
        setBaseline({
          theme: dark ? "dark" : "light",
          density: dense ? "compact" : "comfortable",
          compact: dense,
          animations: anim,
          chat_font_size: fontSize,
          show_rag_sources: showSources,
          show_token_usage: showTokens,
          markdown_rendering: mdRender,
        });
        applyThemeNow(dark, dense, anim, fontSize);
      })
      .catch((e) => { if (mounted) setSaveError(e?.message || "Could not load saved settings"); });
    return () => { mounted = false; };
  }, []);

  async function saveSettings() {
    setSaving(true); setSaveError(null);
    const payload = currentValues;
    try {
      await updateMySettings(payload);
      applyThemeNow(darkMode, compact, animations, chatFontSize);
      window.dispatchEvent(new CustomEvent("ith:settings-saved", { detail: payload }));
      setBaseline(currentValues);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setSaveError(err?.message || "Save failed");
    } finally { setSaving(false); }
  }

  /** Restore the form to the last stored values and re-apply the theme. */
  function discardChanges() {
    if (!baseline) return;
    const dark = baseline.theme === "dark";
    setDarkMode(dark);
    setCompact(baseline.compact);
    setAnimations(baseline.animations);
    setChatFontSize(baseline.chat_font_size);
    setSourceCitations(baseline.show_rag_sources);
    setShowTokenUsage(baseline.show_token_usage);
    setMarkdownRendering(baseline.markdown_rendering);
    applyThemeNow(dark, baseline.compact, baseline.animations, baseline.chat_font_size);
    setSaveError(null);
  }

  const visibleItems = SETTINGS_NAV
    .flatMap((group) => group.items)
    .filter((item) => isAdmin || item.id === "general");

  // Right-rail facts. Both are the app's real values, not decoration: the access
  // level is the signed-in role and the environment is the build mode the app runs.
  const roleLabel = isAdmin ? "Administrator" : role ? role.charAt(0).toUpperCase() + role.slice(1) : "Member";
  const buildMode = import.meta.env.MODE || "production";
  const environment = buildMode.charAt(0).toUpperCase() + buildMode.slice(1);

  return (
    <PageShell>
      <div className="flex min-h-full flex-col">
        <PageHeader
          breadcrumbs={["Workspace", "Settings"]}
          icon={<SettingsIcon className="size-5" />}
          title="Settings"
          description="Manage your workspace, connections, and preferences."
          actions={
            <div className="flex items-center gap-2">
              {saveError && <span className="max-w-[240px] truncate text-xs text-red-600" title={saveError}>{saveError}</span>}
              <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-2xs font-semibold text-[var(--accent-foreground)]">
                {isAdmin ? "Admin access" : "Preferences"}
              </span>
            </div>
          }
        />

        {/* Tabs — one group visible at a time. Kept as a labelled landmark so the
            section navigation stays addressable for assistive tech and tests. */}
        <nav
          aria-label="Settings sections"
          className="mb-6 flex items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--border)] bg-muted/25 p-1.5"
        >
          {visibleItems.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => setActive(it.id)}
              aria-current={active === it.id ? "page" : undefined}
              className={[
                "flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-medium transition",
                active === it.id
                  ? "bg-card text-foreground shadow-xs ring-1 ring-[var(--border)]"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              ].join(" ")}
            >
              <span aria-hidden className={active === it.id ? "text-[var(--primary)]" : ""}>{it.icon}</span>
              {it.label}
            </button>
          ))}
        </nav>

        {/* Two-column body: content on the left, the 260px rail on the right. The rail
            is hidden below ~1100px so the content column keeps the full width. */}
        <main className="flex flex-1 items-start gap-8">
          <div className="min-w-0 flex-1 space-y-4">

            {/* Personal chat preferences: every control changes message rendering. */}
            {active === "general" && (
            <SectionCard icon={<Bot className="h-5 w-5 text-sky-600 dark:text-sky-400" />}
              iconTone="bg-sky-50 dark:bg-sky-950/40"
              title="Chat" description="Choose how answers appear in your desktop app.">
              <SelectRow label="Chat font size" description="Text size used throughout the conversation"
                value={String(chatFontSize)} onChange={(v) => {
                  const size = Number(v);
                  setChatFontSize(size);
                  applyThemeNow(darkMode, compact, animations, size);
                }} options={["12", "14", "16", "18"]} />
              <ToggleRow checked={sourceCitations} onChange={setSourceCitations}
                title="Show source citations"
                description="Show referenced knowledge articles with assistant answers." />
              <ToggleRow checked={showTokenUsage} onChange={setShowTokenUsage}
                title="Show token usage"
                description="Show input and output token counts below assistant answers." />
              <ToggleRow checked={markdownRendering} onChange={setMarkdownRendering}
                title="Format Markdown"
                description="Render headings, lists, tables, links, and code blocks in answers." />
            </SectionCard>
            )}

            {/* ==================== APPEARANCE ==================== */}
            {active === "general" && (
            <SectionCard icon={<Monitor className="h-5 w-5 text-violet-600 dark:text-violet-400" />}
              iconTone="bg-violet-50 dark:bg-violet-950/40"
              title="Appearance" description="Customize how the application looks.">
              <div>
                <div className="flex items-center justify-between gap-6 px-6 py-3.5">
                  <div className="min-w-0 pr-4">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">Theme mode</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Choose between light and dark interface</p>
                  </div>
                  <div className="flex rounded-xl border border-[var(--border)] bg-muted/40 p-1">
                    {(["light", "dark"] as const).map((option) => (
                      <button key={option} type="button"
                        onClick={() => {
                          setDarkMode(option === "dark");
                          applyThemeNow(option === "dark", compact, animations, chatFontSize);
                        }}
                        className={`rounded-lg px-3.5 py-1.5 text-xs font-medium capitalize transition ${
                          (option === "dark") === darkMode
                            ? "bg-background text-foreground shadow-xs font-semibold"
                            : "text-muted-foreground hover:text-foreground"}`}>
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                  <ToggleRow checked={compact} onChange={(v) => { setCompact(v); applyThemeNow(darkMode, v, animations, chatFontSize); }} title="Compact mode"
                    description="Reduce space between elements." />
                  <ToggleRow checked={animations} onChange={(v) => {
                    setAnimations(v);
                    applyThemeNow(darkMode, compact, v, chatFontSize);
                  }} title="Animations" description="Interface transitions and motion." />
                </div>
              </div>
            </SectionCard>
            )}

            {/* ==================== INTEGRATIONS ==================== */}

            {active === "integrations" && (
            <div className="space-y-4">
              <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card text-card-foreground shadow-xs">
                <div className="border-b border-[var(--border)] bg-muted/20 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
                      <Link2 className="size-4.5" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold tracking-tight">Integrations</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Switch on the tools you actually use — each enabled one gets its own setup panel.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-5">
                  <IntegrationsConfig />
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card text-card-foreground shadow-xs">
                <div className="flex items-center gap-2 border-b border-[var(--border)] bg-muted/20 px-5 py-3">
                  <span className="size-1.5 rounded-full bg-[var(--ok)]" />
                  <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Service status</p>
                  <span className="ml-auto text-2xs text-muted-foreground/70">Live health of the dependencies</span>
                </div>
                <div className="p-4">
                  <IntegrationStatusCards />
                </div>
              </section>
            </div>
            )}

            {/* Branding — admin only (logo on login + sidebar) */}
            {isAdmin && active === "general" && (
            <SectionCard
              icon={<ImageIcon className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" />}
              iconTone="bg-fuchsia-50 dark:bg-fuchsia-950/40"
              title="Branding"
              description="Custom logo and brand name shown on the login page and sidebar."
            >
              <div className="p-5">
                <BrandingSettings />
              </div>
            </SectionCard>
            )}

            {/* Mail (SMTP) — admin only; the Email server tab */}
            {isAdmin && active === "notifications" && <MailSettings />}


            {/* ==================== AI ASSISTANT ==================== */}
            {/* Provider, credentials, model detection and the retrieval knobs are one
                decision, so they are one section with one Save. */}
            {active === "skills" && <AiServiceSettings isAdmin={isAdmin} />}
          </div>

          {/* ---- right rail ---------------------------------------------------------- */}
          <aside className="hidden w-[260px] shrink-0 space-y-4 min-[1100px]:block">
            <section className="rounded-2xl border border-[var(--border)] bg-card p-5 text-card-foreground shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
                  <Building2 className="size-4" />
                </div>
                <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">Workspace settings</h2>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Your account and this deployment, at a glance.
              </p>
              <dl className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Access level</dt>
                  <dd className="text-xs font-medium text-slate-900 dark:text-white">{roleLabel}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Environment</dt>
                  <dd className="text-xs font-medium text-slate-900 dark:text-white">{environment}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-sky-100 bg-sky-50/60 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
                <div>
                  <p className="text-sm font-semibold text-sky-900 dark:text-sky-300">Enterprise security</p>
                  <p className="mt-1 text-xs leading-5 text-sky-700 dark:text-sky-400">
                    Authentication (LDAP/AD), roles, session policies, and integration credentials
                    are managed by IT administrators.
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </main>

        {/* Sticky footer. Rendered ONLY on Preferences: that is the one tab whose changes
            the page itself owns and can save/discard. The other tabs (Integrations, AI
            service, Email server) each own their own save button inside the panel, so a
            page-level Save there would be a lie. */}
        {active === "general" && (
          <div className="sticky bottom-0 z-20 -mx-5 mt-6 border-t border-[var(--border)] bg-[var(--background)]/85 px-5 py-3 backdrop-blur lg:-mx-8 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs" aria-live="polite">
                {saving ? (
                  <span className="text-muted-foreground">Saving…</span>
                ) : saved ? (
                  <span className="flex items-center gap-1.5 font-medium text-emerald-600">
                    <Check className="size-3.5" /> Saved
                  </span>
                ) : dirty ? (
                  <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                    <span className="size-1.5 rounded-full bg-amber-500" /> Unsaved changes
                  </span>
                ) : (
                  <span className="text-muted-foreground">No unsaved changes</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={discardChanges} disabled={!dirty || saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-card px-3.5 py-2 text-xs font-medium text-foreground shadow-xs transition hover:bg-muted/50 disabled:opacity-50">
                  <RotateCcw className="size-3.5" />
                  Discard
                </button>
                <button type="button" onClick={saveSettings} disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-[var(--primary-foreground)] shadow-xs transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
                  <Save className="size-3.5" />
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

/* ============================================================
   INTEGRATIONS STATUS CARDS + EDITOR + SYSTEM HEALTH (live)
============================================================ */

/* ============================================================
   MAIL (SMTP) — real settings via /api/settings/smtp (admin only)
============================================================ */

function MailSettings() {
  const [form, setForm] = useState({
    host: "", port: 587, username: "", password: "", from: "",
    use_tls: true, enabled: true,
  });
  const [alerts, setAlerts] = useState<Record<string, boolean>>({
    approval_request: true, ticket_created: true, ticket_status_change: true,
  });
  const [passwordSet, setPasswordSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // v1.6.35 — which mail fields already hold a stored (write-only) value
  const [smtpSet, setSmtpSet] = useState<string[]>([]);
  const [replacingSmtp, setReplacingSmtp] = useState<Record<string, boolean>>({});
  const smtpConfigured = (k: string) => smtpSet.includes(k);
  const smtpEditable = (k: string) => !smtpConfigured(k) || !!replacingSmtp[k] || !!form[k as "host" | "username" | "from"];

  useEffect(() => {
    getSmtpSettings()
      .then((d) => {
        const s = d.smtp ?? {};
        const set: string[] = (d as any).fields_set ?? [];
        setSmtpSet(set);
        // v1.6.35 — sensitive fields (host / username / from-address / password)
        // are write-only and come back masked, so they are NEVER loaded into the
        // form. Only operational knobs are seeded. Typing a value replaces it.
        setForm({
          host: "", port: Number(s.port) || 587,
          username: "", password: "",
          from: "", use_tls: s.use_tls !== false,
          enabled: s.enabled !== false,
        });
        if (s.alerts && typeof s.alerts === "object")
          setAlerts({ approval_request: true, ticket_created: true, ticket_status_change: true, ...s.alerts });
        setPasswordSet(!!s.password_set);
      })
      .catch(() => setError("Failed to load mail settings"))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    // A stored (masked) field counts as satisfied — it is write-only, so the
    // admin is not asked to retype the host just to flip a toggle.
    const hostOk = !!form.host.trim() || smtpConfigured("host");
    const fromOk = !!form.from.trim() || smtpConfigured("from_address") || smtpConfigured("from");
    if (!hostOk || !fromOk) { setError("Host and from-address are required."); return; }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        port: Number(form.port) || 587, use_tls: form.use_tls, enabled: form.enabled,
        alerts,
      };
      // Only send fields the admin actually typed; blank keeps the stored value.
      // A masked value is never sent (it would overwrite the real one).
      const MASK_CHARS = "•";
      for (const [k, v] of [
        ["host", form.host], ["username", form.username],
        ["from_address", form.from], ["password", form.password],
      ] as const) {
        const val = (v || "").trim();
        if (val && !val.includes(MASK_CHARS)) body[k] = val;
      }
      await putSmtpSettings(body);
      setPasswordSet(true);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally { setSaving(false); }
  }

  /** v1.6.35 — a stored mail field is shown as a mask; Replace unlocks the input. */
  const writeOnlyRow = (
    fieldKey: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    type = "text",
  ) => (
    <label className="block">
      <span className={labelCls}>
        {label}
        {smtpConfigured(fieldKey) && (
          <span className="ml-2 inline-flex items-center gap-1 text-2xs text-emerald-600">
            <Lock className="h-3 w-3" /> saved — not retrievable
          </span>
        )}
      </span>
      {smtpConfigured(fieldKey) && !smtpEditable(fieldKey) ? (
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
            <Lock className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="select-none font-mono text-xs tracking-widest text-slate-400">••••••••</span>
            <span className="ml-auto text-2xs text-slate-400">write-only</span>
          </div>
          <button
            type="button"
            onClick={() => setReplacingSmtp({ ...replacingSmtp, [fieldKey]: true })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            title="Enter a new value"
          >
            <Pencil className="h-3.5 w-3.5" />
            Replace
          </button>
        </div>
      ) : (
        <input className={inputCls} type={type} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );

  async function sendTest() {
    const to = (testTo.trim() || form.username || form.from);
    if (!to) { setError("Enter a recipient for the test email."); return; }
    setTesting(true); setTestMsg(null); setError(null);
    try {
      const r = await sendTestEmail(to);
      setTestMsg(r.ok ? `Test email sent to ${r.to} — check inbox (and spam) in a minute.` : "Send failed");
    } catch (err: any) {
      setTestMsg(null);
      setError(err?.message || "Test failed — check SMTP settings first");
    } finally { setTesting(false); }
  }

  const inputCls = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white";
  const labelCls = "mb-1.5 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <section className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/40">
            <Mail className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Mail (SMTP)</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Outgoing email server used for alert notifications.</p>
          </div>
        </div>
      </div>
      <div className="space-y-4 p-5">
        {loading && <p className="text-xs text-muted-foreground">Loading mail settings…</p>}
        {!loading && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {writeOnlyRow("host", "SMTP host", form.host,
                (v) => setForm({ ...form, host: v }), "smtp.gmail.com")}
              <label className="block">
                <span className={labelCls}>Port</span>
                <input className={inputCls} type="number" value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 587 })} />
              </label>
              {writeOnlyRow("username", "Username", form.username,
                (v) => setForm({ ...form, username: v }), "you@gmail.com")}
              <label className="block">
                <span className={labelCls}>
                  Password {passwordSet && <span className="text-emerald-600">(saved — leave blank to keep)</span>}
                </span>
                <input className={inputCls} type="password" value={form.password} placeholder="16-char app password"
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </label>
              <div className="block sm:col-span-2">
                {writeOnlyRow("from_address", "From address", form.from,
                  (v) => setForm({ ...form, from: v }), "you@gmail.com")}
              </div>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              <ToggleRow checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })}
                title="Enable outgoing mail" description="Master switch — when off, no alert emails are sent." />
              <ToggleRow checked={form.use_tls} onChange={(v) => setForm({ ...form, use_tls: v })}
                title="Use TLS (STARTTLS)" description="Recommended — encrypts the SMTP connection (port 587)." />
            </div>

            {/* which events send alert mails */}
            <div className="pt-2">
              <p className="mb-2 text-xs font-semibold text-slate-900 dark:text-white">Alert emails — send on these events</p>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border-t border-b border-[var(--border)]">
                <ToggleRow checked={!!alerts.approval_request}
                  onChange={(v) => setAlerts({ ...alerts, approval_request: v })}
                  title="Escalation awaiting approval"
                  description="Sent to administrators when a LangGraph human-in-the-loop approval is requested." />
                <ToggleRow checked={!!alerts.ticket_created}
                  onChange={(v) => setAlerts({ ...alerts, ticket_created: v })}
                  title="Ticket created"
                  description="Sent to the requester when a Jira ticket is opened (chat escalation or Tickets page)." />
                <ToggleRow checked={!!alerts.ticket_status_change}
                  onChange={(v) => setAlerts({ ...alerts, ticket_status_change: v })}
                  title="Ticket status changed"
                  description="Sent to the requester when Jira status moves (open → pending → resolved…)." />
              </div>
            </div>

            {/* test row — stacks cleanly on mobile */}
            <div className="rounded-xl border border-[var(--border)] bg-muted/30 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <label className="block min-w-0">
                  <span className={labelCls}>Send test email to</span>
                  <input className={inputCls} value={testTo} placeholder={form.username || "you@drlinuxer.com"}
                    onChange={(e) => setTestTo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendTest(); }} />
                </label>
                <button onClick={sendTest} disabled={testing}
                  className="h-10 shrink-0 rounded-xl border px-5 text-xs font-semibold transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800">
                  {testing ? "Sending…" : "Send test"}
                </button>
                <button onClick={save} disabled={saving}
                  className="h-10 shrink-0 rounded-xl bg-[var(--primary)] px-5 text-xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 disabled:opacity-50">
                  {saving ? "Saving…" : "Save mail settings"}
                </button>
              </div>
              <p className="mt-2 text-2xs leading-4 text-muted-foreground">
                Gmail: use a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords),
                not your normal password. Host smtp.gmail.com, port 587, TLS on.
              </p>
            </div>
            {saved && <p className="text-xs font-medium text-emerald-600">Mail settings saved ✓</p>}
            {testMsg && <p className="text-xs font-medium text-emerald-600">{testMsg}</p>}
            {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          </>
        )}
      </div>
    </section>
  );
}


function IntegrationStatusCards() {
  const [services, setServices] = useState<any[]>([]);
  const [cfg, setCfg] = useState<Record<string, any>>({});

  useEffect(() => {
    dashHealth()
      .then((list) => setServices(Array.isArray(list) ? list : []))
      .catch(() => {});
    Promise.all([
      getIntegrationSettings("confluence"),
      getIntegrationSettings("jira"),
      getIntegrationSettings("ldap"),
      getIntegrationSettings("llm"),
    ]).then((vals) => {
      const map: Record<string, any> = {};
      vals.forEach((v: any, i: number) => { map[["confluence", "jira", "ldap", "llm"][i]] = v?.settings ?? v; });
      setCfg(map);
    }).catch(() => {});
  }, []);

  const st = (needle: string) => {
    const hit = services.find((s) => (s.name || "").toLowerCase().includes(needle));
    return hit ? hit.status : null;
  };
  const chip = (needle: string) => {
    const s = st(needle);
    if (!s) return null;
    const ok = /healthy|ok|up/i.test(s);
    return (
      <span className={["inline-flex items-center gap-1 text-2xs font-medium", ok ? "text-emerald-500" : "text-red-400"].join(" ")}>
        <span className={["size-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-red-400"].join(" ")} />
        {ok ? "Connected" : s}
      </span>
    );
  };

  const cards = [
    { key: "confluence", name: "Confluence", desc: "Knowledge base and documentation source.",
      detail: cfg.confluence?.base_url ? `URL: ${cfg.confluence.base_url}` : "URL: (configured in Confluence tab)" },
    { key: "jira", name: "Jira", desc: "Issue tracking and ticket management.",
      detail: cfg.jira?.base_url ? `URL: ${cfg.jira.base_url}` : "URL: (configured)" },
    { key: "ldap", name: "LDAP / Active Directory", desc: "User authentication and group synchronization.",
      detail: cfg.ldap?.host ? `Server: ${cfg.ldap.host}:${cfg.ldap.port ?? 389}` : "Server: 10.10.10.10" },
    // The model provider's status lives in the AI service section now — it shows the
    // provider, model, key state and detection count, which is strictly more than this
    // card said. Keeping a second copy here is how the two screens drifted apart before.
    { key: "redis", name: "Redis (Cache & Queue)", desc: "Caching and asynchronous task queue.",
      detail: "Mode: Sentinel" },
  ];

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {cards.map((c, idx) => (
        <div key={c.key} className={["flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700",
          idx === cards.length - 1 && cards.length % 2 === 1 ? "xl:col-span-2" : ""].join(" ")}>
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Globe className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold">{c.name}</span>
              {chip(c.key)}
            </div>
            <p className="mt-0.5 truncate text-2xs text-muted-foreground">{c.desc}</p>
            <div className="mt-1 truncate text-2xs text-slate-400">{c.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
