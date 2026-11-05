import {
  Bell,
  Bot,
  Building2,
  Check,
  Globe,
  Link2,
  Monitor,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Plug,
  BookOpen,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PageShell, PageHeader } from "@/components/ui/page";
import { Panel, Row, Segmented } from "../components/SettingsKit";

import { dashHealth } from "@/features/dashboard/api";
import { IntegrationsConfig } from "../components/IntegrationsConfig";
import { BrandingSettings } from "../components/BrandingSettings";
import { AiServiceSettings } from "../components/AiServiceSettings";
import { EmailServerSettings } from "../components/EmailServerSettings";
import { Image as ImageIcon } from "lucide-react";
import {
  getMySettings, updateMySettings, getIntegrationSettings,
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

/** The single switch used across Preferences — same geometry as every other panel. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-pressed={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
        checked ? "border-transparent bg-[var(--primary)]" : "border-[var(--border)] bg-muted"}`}
    >
      <span className={`size-3.5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
    </button>
  );
}

function ToggleRow({ checked, onChange, title, description }: {
  checked: boolean; onChange: (value: boolean) => void; title: string; description?: string;
}) {
  return (
    <Row title={title} hint={description}>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </Row>
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

function SectionCard({ icon, title, description, children }: {
  icon: React.ReactNode; iconTone?: string; title: string; description: string; children: React.ReactNode;
}) {
  // Delegates to the shared Panel so every section in Settings has one header anatomy.
  return (
    <Panel icon={icon} title={title} description={description}>
      {children}
    </Panel>
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

            {/* ---- Answers: every control here changes how a message is rendered. ---- */}
            {active === "general" && (
              <SectionCard
                icon={<Bot className="size-4.5" />}
                title="Chat"
                description="Choose how answers appear in your desktop app."
              >
                <Row title="Chat font size" hint="Text size used throughout the conversation.">
                  <Segmented
                    label="Chat font size"
                    value={String(chatFontSize)}
                    options={[
                      { value: "12", label: "12" },
                      { value: "14", label: "14" },
                      { value: "16", label: "16" },
                      { value: "18", label: "18" },
                    ]}
                    onChange={(v) => {
                      const size = Number(v);
                      setChatFontSize(size);
                      applyThemeNow(darkMode, compact, animations, size);
                    }}
                  />
                </Row>
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
              <SectionCard
                icon={<Monitor className="size-4.5" />}
                title="Appearance"
                description="Customize how the application looks."
              >
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">Theme mode</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Choose between light and dark interface</p>
                    </div>
                    <div className="flex gap-2" role="group" aria-label="Theme mode">
                      {(["light", "dark"] as const).map((option) => {
                        const on = (option === "dark") === darkMode;
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setDarkMode(option === "dark");
                              applyThemeNow(option === "dark", compact, animations, chatFontSize);
                            }}
                            aria-pressed={on}
                            className={[
                              "w-[104px] rounded-xl border p-1.5 text-left transition",
                              on
                                ? "border-[var(--primary)] ring-2 ring-[var(--primary)]/20"
                                : "border-[var(--border)] hover:border-[var(--primary)]/40",
                            ].join(" ")}
                          >
                            {/* miniature of the actual workspace chrome, so the choice is visible
                                before it is applied rather than described in words */}
                            <span
                              className={[
                                "flex h-12 w-full gap-1 overflow-hidden rounded-lg border p-1",
                                option === "dark"
                                  ? "border-[#342C46] bg-[#14121B]"
                                  : "border-[#E3E1EA] bg-[#F7F8FC]",
                              ].join(" ")}
                              aria-hidden
                            >
                              <span className={["w-3 rounded-sm", option === "dark" ? "bg-[#100E17]" : "bg-gradient-to-b from-[#7C3AED] to-[#5B21B6]"].join(" ")} />
                              <span className="flex flex-1 flex-col gap-1">
                                <span className={["h-1.5 w-2/3 rounded-sm", option === "dark" ? "bg-[#9C93B4]" : "bg-[#C4B5FD]"].join(" ")} />
                                <span className={["h-1.5 w-full rounded-sm", option === "dark" ? "bg-[#342C46]" : "bg-[#E3E1EA]"].join(" ")} />
                                <span className={["h-1.5 w-4/5 rounded-sm", option === "dark" ? "bg-[#342C46]" : "bg-[#E3E1EA]"].join(" ")} />
                              </span>
                            </span>
                            <span className="mt-1 flex items-center gap-1 px-0.5 text-2xs font-medium capitalize text-foreground">
                              {option}
                              {on && <Check className="size-3 text-[var(--primary)]" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <Row title="Compact mode" hint="Reduce space between elements.">
                  <Toggle checked={compact} onChange={(v) => { setCompact(v); applyThemeNow(darkMode, v, animations, chatFontSize); }} label="Compact mode" />
                </Row>
                <Row title="Animations" hint="Interface transitions and motion.">
                  <Toggle checked={animations} onChange={(v) => {
                    setAnimations(v);
                    applyThemeNow(darkMode, compact, v, chatFontSize);
                  }} label="Animations" />
                </Row>
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

            {/* Members choose WHICH tools they use; the connections themselves stay
                admin-configured, so this deliberately renders without any editor. */}
            {!isAdmin && active === "general" && (
              <SectionCard
                icon={<Plug className="h-5 w-5 text-[var(--primary)]" />}
                iconTone="bg-[var(--accent)]"
                title="My integrations"
                description="Pick the tools you work with. An administrator sets up each connection once."
              >
                <div className="p-5">
                  <IntegrationsConfig variant="personal" />
                </div>
              </SectionCard>
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
            {isAdmin && active === "notifications" && <EmailServerSettings />}


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
