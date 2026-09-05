import {
  Bell,
  Bot,
  Check,
  Globe,
  Mail,
  Info,
  Link2,
  Monitor,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { PageShell, PageHeader } from "@/components/ui/page";

import { dashHealth } from "@/features/dashboard/api";
import { IntegrationsConfig } from "../components/IntegrationsConfig";
import { BrandingSettings } from "../components/BrandingSettings";
import { Image as ImageIcon } from "lucide-react";
import {
  getUserSettings, putUserSettings, getIntegrationSettings,
  getSmtpSettings, putSmtpSettings, sendTestEmail, getRuntime, putRuntime,
} from "@/features/settings/api";

/* v0.21.81 — Settings redesigned to the reference single-scroll layout:
   section cards (General/Appearance/Integrations/AI Assistant/Notifications/
   Security info) + sticky bottom save bar. All live logic preserved: server
   load/save, instant theme side-effects, RAG runtime knobs (admin), and the
   Integrations status cards + editor tabs + System health checks. */

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
          checked ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-700"}`}>
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
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={`${width} h-9 rounded-xl border border-[var(--border)] bg-background px-3 text-xs text-foreground outline-none transition focus:border-blue-500`}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

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

/* ============================================================
   PAGE
============================================================ */

export default function Settings({ role }: { role?: string }) {
  // v0.21.90 — role gating: user/IT Support/Knowledge Manager only see General,
  // Appearance, AI Assistant, Notifications. Integrations + Mail are admin-only.
  const isAdmin = role === "admin";

  const [saved, setSaved] =
    useState(false);

  // General — server DB backed live state
  const [appName, setAppName] = useState("IT Help Chatbot");
  const [language, setLanguage] = useState("English");
  const [darkMode, setDarkMode] = useState(false);
  const [compact, setCompact] = useState(false);
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [animations, setAnimations] = useState(true);
  const [sounds, setSounds] = useState(false);
  const [welcome, setWelcome] = useState(true);
  const [rememberLast, setRememberLast] = useState(true);

  // other sections (unchanged)
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [ticketNotifications, setTicketNotifications] = useState(true);
  const [sourceCitations, setSourceCitations] = useState(true);
  const [strictRBAC, setStrictRBAC] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [syncInterval, setSyncInterval] = useState("30");
  const [topK, setTopK] = useState("5");
  const [similarityThreshold, setSimilarityThreshold] = useState("0.72");

  // v0.21.30 — wire the remaining settings (Integrations/Security/Notifications/AI)
  const [sessionTimeout, setSessionTimeout] = useState("8 hours");
  const [requireHttps, setRequireHttps] = useState(true);
  const [apiAuth, setApiAuth] = useState(true);
  const [rateLimiting, setRateLimiting] = useState(true);
  const [systemAlerts, setSystemAlerts] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);
  const [llmProvider, setLlmProvider] = useState("H-Chat / Claude");
  const [embeddingModel, setEmbeddingModel] = useState("nomic-embed-text");
  const [confidenceGate, setConfidenceGate] = useState(true);

  // Real DOM side-effects (visual only, server DB is the source of truth)
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  function applyThemeNow(dark: boolean, compact: boolean, anim: boolean) {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.dataset.compact = compact ? "1" : "0";
    document.documentElement.classList.toggle("animations-off", !anim);
  }

  useEffect(() => {
    document.documentElement.dataset.compact = compact ? "1" : "0";
  }, [compact]);

  useEffect(() => {
    document.title = appName;
  }, [appName]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load saved settings from server DB on mount
  useEffect(() => {
    let mounted = true;
    getUserSettings()
      .then((d) => {
        if (!mounted || !d.settings) return;
        const s = d.settings;
        if (typeof s.appName === "string") setAppName(s.appName);
        if (typeof s.language === "string") setLanguage(s.language);
        if (typeof s.darkMode === "boolean") setDarkMode(s.darkMode);
        if (typeof s.compact === "boolean") setCompact(s.compact);
        if (typeof s.timezone === "string") setTimezone(s.timezone);
        if (typeof s.dateFormat === "string") setDateFormat(s.dateFormat);
        if (typeof s.itemsPerPage === "number") setItemsPerPage(s.itemsPerPage);
        if (typeof s.animations === "boolean") setAnimations(s.animations);
        if (typeof s.sounds === "boolean") setSounds(s.sounds);
        if (typeof s.welcome === "boolean") setWelcome(s.welcome);
        if (typeof s.rememberLast === "boolean") setRememberLast(s.rememberLast);
        if (typeof s.emailNotifications === "boolean") setEmailNotifications(s.emailNotifications);
        if (typeof s.ticketNotifications === "boolean") setTicketNotifications(s.ticketNotifications);
        if (typeof s.sourceCitations === "boolean") setSourceCitations(s.sourceCitations);
        if (typeof s.strictRBAC === "boolean") setStrictRBAC(s.strictRBAC);
        if (typeof s.autoSync === "boolean") setAutoSync(s.autoSync);
        if (typeof s.syncInterval === "string") setSyncInterval(s.syncInterval);
        if (typeof s.topK === "string") setTopK(s.topK);
        if (typeof s.similarityThreshold === "string") setSimilarityThreshold(s.similarityThreshold);
        if (typeof s.sessionTimeout === "string") setSessionTimeout(s.sessionTimeout);
        if (typeof s.requireHttps === "boolean") setRequireHttps(s.requireHttps);
        if (typeof s.apiAuth === "boolean") setApiAuth(s.apiAuth);
        if (typeof s.rateLimiting === "boolean") setRateLimiting(s.rateLimiting);
        if (typeof s.systemAlerts === "boolean") setSystemAlerts(s.systemAlerts);
        if (typeof s.dailyDigest === "boolean") setDailyDigest(s.dailyDigest);
        if (typeof s.llmProvider === "string") setLlmProvider(s.llmProvider);
        if (typeof s.embeddingModel === "string") setEmbeddingModel(s.embeddingModel);
        if (typeof s.confidenceGate === "boolean") setConfidenceGate(s.confidenceGate);
        // Apply theme immediately so the user sees the change even if the
        // state setter is batched or hasn't propagated yet.
        applyThemeNow(!!s.darkMode, !!s.compact, s.animations !== false);
      })
      .catch((e) => { if (mounted) setSaveError(e?.message || "Could not load saved settings"); });
    return () => { mounted = false; };
  }, []);

  async function saveSettings() {
    setSaving(true); setSaveError(null);
    const payload = {
      appName, language, darkMode, compact, timezone, dateFormat,
      itemsPerPage, animations, sounds, welcome, rememberLast,
      emailNotifications, ticketNotifications, sourceCitations,
      strictRBAC, autoSync, syncInterval, topK, similarityThreshold,
      sessionTimeout, requireHttps, apiAuth, rateLimiting,
      systemAlerts, dailyDigest, llmProvider, embeddingModel, confidenceGate,
    };
    try {
      await putUserSettings(payload);
      // Apply the just-saved theme immediately (synchronous DOM update)
      applyThemeNow(!!darkMode, !!compact, animations);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setSaveError(err?.message || "Save failed");
      // v0.21.83 — persist RAG runtime knobs too (single Save = everything)
      try {
        await putRuntime({
          retrieval_top_k: Number(topK) || 5,
          confidence_gate_threshold: Number(similarityThreshold) || 0.75,
        });
      } catch { /* non-admin: user prefs already saved */ }
    } finally { setSaving(false); }
  }

  // v0.21.83 — load real backend runtime knobs on mount (admin only; silently
  // ignored for other roles since /api/runtime is gated 403).
  useEffect(() => {
    getRuntime()
      .then((d) => {
        if (!d) return;
        const o = d.overrides ?? {};
        if (o.retrieval_top_k != null) setTopK(String(o.retrieval_top_k));
        if (o.confidence_gate_threshold != null) setSimilarityThreshold(String(o.confidence_gate_threshold));
      })
      .catch(() => {});
  }, []);

  // v0.21.90 — real AI provider info (from /api/settings/integrations/llm), not a label
  const [llmCfg, setLlmCfg] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    getIntegrationSettings("llm")
      .then((d: any) => setLlmCfg(d?.settings ?? d))
      .catch(() => {});
  }, []);

  return (
    <PageShell>
      <div className="min-h-full">
        <PageHeader
          icon={<SettingsIcon className="size-5" />}
          title="Settings"
          badge={isAdmin ? "Administrator" : "Preferences"}
          description="Manage your IT Help application preferences"
          actions={
            <div className="flex items-center gap-2">
              {saved && (
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
                  <Check className="size-3.5" /> Saved
                </span>
              )}
              {saveError && <span className="max-w-[200px] truncate text-[11px] text-red-600" title={saveError}>{saveError}</span>}
              <button type="button" onClick={saveSettings} disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50">
                <Save className="size-3.5" />
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          }
        />

        {/* Main content */}
        <main className="mx-auto max-w-[1400px] pb-8">
          <div className="space-y-5">

            {/* ==================== GENERAL ==================== */}
            <SectionCard icon={<Globe className="h-5 w-5 text-sky-600 dark:text-sky-400" />}
              iconTone="bg-sky-50 dark:bg-sky-950/40"
              title="General" description="Basic application settings and preferences.">
              <div className="flex items-center justify-between gap-6 px-6 py-3.5">
                <div className="min-w-0 pr-4">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">Application name</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Name displayed throughout the application</p>
                </div>
                <div className="w-52">
                  <input type="text" value={appName} onChange={(e) => setAppName(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-xs text-foreground outline-none transition focus:border-blue-500" />
                </div>
              </div>
              <SelectRow label="Language" description="Language used by the application"
                value={language} onChange={setLanguage} options={["English"]} />
              <SelectRow label="Time zone" description="Used for timestamps and notifications"
                value={timezone} onChange={setTimezone}
                options={["Asia/Singapore", "Asia/Bangkok", "Asia/Yangon", "UTC", "Asia/Kolkata", "Europe/London"]} />
              <SelectRow label="Date format" description="Format used for dates in tables and details"
                value={dateFormat} onChange={setDateFormat}
                options={["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD MMM YYYY"]} />
              <SelectRow label="Items per page" description="Rows shown in ticket and knowledge lists"
                value={String(itemsPerPage)} onChange={(v) => setItemsPerPage(Number(v) || 20)}
                options={["10", "20", "25", "50", "100"]} />
            </SectionCard>

            {/* ==================== APPEARANCE ==================== */}
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
                        onClick={() => setDarkMode(option === "dark")}
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
                  <ToggleRow checked={compact} onChange={setCompact} title="Compact mode"
                    description="Reduce space between elements." />
                  <ToggleRow checked={animations} onChange={setAnimations} title="Animations"
                    description="Interface transitions and motion." />
                </div>
              </div>
            </SectionCard>

            {/* ==================== INTEGRATIONS ==================== */}
            {isAdmin && (
            <SectionCard icon={<Link2 className="h-5 w-5 text-teal-600 dark:text-teal-400" />}
              iconTone="bg-teal-50 dark:bg-teal-950/40"
              title="Integrations" description="Connect external tools and services.">
              <IntegrationsConfig />
              <div className="border-t border-slate-100 dark:border-slate-800 px-5 pb-5 pt-4">
                <p className="mb-3 text-2xs font-semibold uppercase tracking-wider text-slate-400">Service status</p>
                <IntegrationStatusCards />
                <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                  <ToggleRow checked={autoSync} onChange={setAutoSync}
                    title="Automatic knowledge sync"
                    description="Periodically import updated pages from Confluence into the knowledge base." />
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 dark:bg-slate-900">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Knowledge base sync: {autoSync ? `automatic every ${syncInterval} minutes` : "manual only"}.
                    Integration credentials are managed by administrators.
                  </p>
                </div>
              </div>
            </SectionCard>
            )}

            {/* Branding — admin only (logo on login + sidebar) */}
            {isAdmin && (
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

            {/* Mail (SMTP) — admin only */}
            {isAdmin && <MailSettings />}


            {/* ==================== AI ASSISTANT ==================== */}
            <SectionCard icon={<Bot className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
              iconTone="bg-indigo-50 dark:bg-indigo-950/40"
              title="AI Assistant" description="Configure AI provider and response behavior.">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                <div className="flex items-center justify-between gap-6 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">AI provider</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Provider used for assistant responses</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
                      <Sparkles className="h-4 w-4 text-indigo-500" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {llmCfg?.model
                          ? llmCfg.model
                          : (llmCfg ? "configured" : "…")}
                      </span>
                    </div>
                    {llmCfg?.provider && (
                      <span className="text-[10px] text-muted-foreground">
                        via {llmCfg.provider}
                        {llmCfg.fallback_model ? ` · fallback: ${llmCfg.fallback_model}` : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">Confidence threshold</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Minimum confidence required before returning an answer (backend runtime)
                      </p>
                    </div>
                    <span className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400">
                      {Math.round((Number(similarityThreshold) || 0.75) * 100)}%
                    </span>
                  </div>
                  <input type="range" min="50" max="100" step="5"
                    value={Math.round((Number(similarityThreshold) || 0.75) * 100)}
                    onChange={(e) => setSimilarityThreshold(String(Number(e.target.value) / 100))}
                    className="mt-4 w-full accent-indigo-600" />
                  <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                    <span>50%</span><span>75%</span><span>100%</span>
                  </div>
                </div>
                <div className="px-5 pb-3">
                  <ToggleRow checked={sourceCitations} onChange={setSourceCitations}
                    title="Show source citations"
                    description="Display the knowledge sources used to generate an answer." />
                  <ToggleRow checked={confidenceGate} onChange={setConfidenceGate}
                    title="Confidence gate"
                    description="Hold the answer when retrieval confidence is below the threshold." />
                  <div className="flex items-center justify-between gap-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">Top K results</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Knowledge chunks retrieved per question (backend runtime)
                      </p>
                    </div>
                    <div className="w-52">
                      <input type="number" min={1} max={20} value={topK}
                        onChange={(e) => setTopK(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                    </div>
                  </div>
                  <div className="rounded-xl bg-indigo-50/60 px-3 py-2.5 text-[10px] leading-4 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
                    Threshold and Top K are shared backend settings (runtime_kv). They update
                    the assistant for everyone once you press Save changes.
                  </div>
                </div>
              </div>
            </SectionCard>

            

            {/* ==================== NOTIFICATIONS ==================== */}
            <SectionCard icon={<Bell className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
              iconTone="bg-amber-50 dark:bg-amber-950/40"
              title="Notifications" description="Control how you receive updates and alerts.">
              <div className="px-5">
                <ToggleRow checked={ticketNotifications} onChange={setTicketNotifications}
                  title="Ticket updates"
                  description="Receive notifications when Jira tickets are created or updated." />
                <ToggleRow checked={systemAlerts} onChange={setSystemAlerts}
                  title="System notifications"
                  description="Important system alerts and announcements." />
                <ToggleRow checked={emailNotifications} onChange={setEmailNotifications}
                  title="Email notifications"
                  description="Email delivery for the enabled notifications (configured under Mail — admin only)." />
                <ToggleRow checked={dailyDigest} onChange={setDailyDigest}
                  title="Daily digest"
                  description="Daily summary of usage and system activity." />
              </div>
            </SectionCard>

            {/* ==================== SECURITY INFO ==================== */}
            <section className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
                <div>
                  <p className="text-sm font-semibold text-sky-900 dark:text-sky-300">Enterprise security</p>
                  <p className="mt-1 text-xs leading-5 text-sky-700 dark:text-sky-400">
                    Authentication (LDAP/AD), RBAC roles, session policies, and integration credentials
                    are managed by your IT administrators.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </main>

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

  useEffect(() => {
    getSmtpSettings()
      .then((d) => {
        const s = d.smtp ?? {};
        setForm({
          host: s.host ?? "", port: Number(s.port) || 587,
          username: s.username ?? "", password: "",
          from: s.from_address ?? s.from ?? "", use_tls: s.use_tls !== false,
          enabled: s.enabled !== false,
        });
        if (s.alerts && typeof s.alerts === "object")
          setAlerts({ approval_request: true, ticket_created: true, ticket_status_change: true, ...s.alerts });
        setPasswordSet(!!s.password_set);
        if (!testTo && (s.from_address || s.username)) setTestTo(s.from_address || s.username);
      })
      .catch(() => setError("Failed to load mail settings"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!form.host.trim() || !form.from.trim()) { setError("Host and from-address are required."); return; }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        host: form.host, port: Number(form.port) || 587, username: form.username,
        from_address: form.from, use_tls: form.use_tls, enabled: form.enabled,
        alerts,
      };
      if (form.password.trim()) body.password = form.password; // keep existing if blank
      await putSmtpSettings(body);
      setPasswordSet(true);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally { setSaving(false); }
  }

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
  const labelCls = "mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
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
              <label className="block">
                <span className={labelCls}>SMTP host</span>
                <input className={inputCls} value={form.host} placeholder="smtp.gmail.com"
                  onChange={(e) => setForm({ ...form, host: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>Port</span>
                <input className={inputCls} type="number" value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 587 })} />
              </label>
              <label className="block">
                <span className={labelCls}>Username</span>
                <input className={inputCls} value={form.username} placeholder="you@gmail.com"
                  onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>
                  Password {passwordSet && <span className="text-emerald-600">(saved — leave blank to keep)</span>}
                </span>
                <input className={inputCls} type="password" value={form.password} placeholder="16-char app password"
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </label>
              <label className="block sm:col-span-2">
                <span className={labelCls}>From address</span>
                <input className={inputCls} value={form.from} placeholder="you@gmail.com"
                  onChange={(e) => setForm({ ...form, from: e.target.value })} />
              </label>
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
                  className="h-10 shrink-0 rounded-xl border px-5 text-[11px] font-semibold transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800">
                  {testing ? "Sending…" : "Send test"}
                </button>
                <button onClick={save} disabled={saving}
                  className="h-10 shrink-0 rounded-xl bg-sky-700 px-5 text-[11px] font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50">
                  {saving ? "Saving…" : "Save mail settings"}
                </button>
              </div>
              <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                Gmail: use a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords),
                not your normal password. Host smtp.gmail.com, port 587, TLS on.
              </p>
            </div>
            {saved && <p className="text-[11px] font-medium text-emerald-600">Mail settings saved ✓</p>}
            {testMsg && <p className="text-[11px] font-medium text-emerald-600">{testMsg}</p>}
            {error && <p className="text-[11px] font-medium text-red-600">{error}</p>}
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
      <span className={["inline-flex items-center gap-1 text-[10px] font-medium", ok ? "text-emerald-500" : "text-red-400"].join(" ")}>
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
    { key: "h-chat", name: "H-Chat (LLM API)", desc: "External LLM provider for generating responses.",
      detail: cfg.llm?.model
        ? `Model: ${cfg.llm.model}${cfg.llm.base_url ? ` · ${cfg.llm.base_url.replace(/^https?:\/\//, "")}` : ""}`
        : "Provider: OpenRouter" },
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
              <span className="text-[12px] font-semibold">{c.name}</span>
              {chip(c.key)}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{c.desc}</p>
            <div className="mt-1 truncate text-[9.5px] text-slate-400">{c.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}



