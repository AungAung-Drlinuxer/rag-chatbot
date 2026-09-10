import { useState } from "react";
import { Save, Loader2, CheckCircle2, XCircle, Eye, EyeOff, ExternalLink, Loader as LoaderIcon, AlertCircle, ChevronDown, RefreshCw } from "lucide-react";
import { getIntegrationSettings, putIntegrationSettings, testIntegration, getLlmModels, syncOpenProjectTickets } from "@/features/settings/api";
import type { ProviderModel } from "@/features/settings/api";

type IntegrationKey = "confluence" | "jira" | "ldap" | "keycloak" | "llm" | "openproject" | "xwiki" | "zabbix" | "grafana";

const META: Record<IntegrationKey, {
  label: string;
  desc: string;
  docs: string;
  fields: Array<{ key: string; label: string; placeholder: string; type?: string; isSecret?: boolean }>;
}> = {
  confluence: {
    label: "Confluence (Knowledge Base)",
    desc: "Connect Confluence Cloud to import pages into the knowledge base.",
    docs: "https://id.atlassian.com/manage-profile/security/api-tokens",
    fields: [
      { key: "base_url", label: "Base URL", placeholder: "https://your-domain.atlassian.net/wiki" },
      { key: "email", label: "Account Email", placeholder: "you@your-domain.com" },
      { key: "api_token", label: "API Token", placeholder: "ATATT3xFfGF0...", isSecret: true },
      { key: "space_keys", label: "Space Keys (comma separated)", placeholder: "HELP, IT, ENG" },
    ],
  },
  jira: {
    label: "Jira (Issue Tracking)",
    desc: "Connect Jira Cloud to auto-create escalation tickets.",
    docs: "https://id.atlassian.com/manage-profile/security/api-tokens",
    fields: [
      { key: "base_url", label: "Base URL", placeholder: "https://your-domain.atlassian.net" },
      { key: "email", label: "Account Email", placeholder: "you@your-domain.com" },
      { key: "api_token", label: "API Token", placeholder: "ATATT3xFfGF0...", isSecret: true },
      { key: "project_key", label: "Default Project Key", placeholder: "ITHD" },
    ],
  },
  ldap: {
    label: "LDAP / Active Directory",
    desc: "Authenticate users against your corporate directory (AD). Used for login + group-based role mapping.",
    docs: "https://ldap3.readthedocs.io/",
    fields: [
      { key: "host", label: "LDAP Server Host", placeholder: "ldaps://ad.your-domain.local or 10.10.10.10" },
      { key: "port", label: "Port", placeholder: "389 or 636 (LDAPS)" },
      { key: "bind_dn", label: "Bind DN (service account)", placeholder: "CN=svc-chatbot,OU=Service,DC=corp,DC=local" },
      { key: "bind_password", label: "Bind Password", placeholder: "service account password", isSecret: true },
      { key: "base_dn", label: "Base DN (search root)", placeholder: "DC=corp,DC=local" },
      { key: "user_filter", label: "User Filter", placeholder: "(sAMAccountName={username})" },
    ],
  },
  keycloak: {
    label: "Keycloak SSO",
    desc: "Single sign-on via Keycloak (OpenID Connect). Users sign in with the realm identity provider instead of local passwords.",
    docs: "https://www.keycloak.org/documentation",
    fields: [
      { key: "issuer", label: "Issuer / Base URL", placeholder: "https://keycloak-chatbot.drlinuxer.com" },
      { key: "realm", label: "Realm", placeholder: "ith-chatbot" },
      { key: "client_id", label: "Client ID", placeholder: "it-help-chatbot" },
      { key: "client_secret", label: "Client Secret", placeholder: "OIDC client secret", isSecret: true },
      { key: "redirect_uri", label: "Redirect URI", placeholder: "https://chat.drlinuxer.com/auth/callback" },
    ],
  },
  llm: {
    label: "H-Chat (LLM API)",
    desc: "Primary AI provider for generating answers (OpenAI-compatible: OpenRouter, DeepSeek, local H-Chat, or Anthropic). Changes apply within 30 seconds without a rebuild.",
    docs: "https://openrouter.ai/keys",
    fields: [
      { key: "provider", label: "Provider", placeholder: "openai or anthropic" },
      { key: "base_url", label: "Base URL", placeholder: "https://openrouter.ai/api/v1" },
      { key: "api_key", label: "API Key", placeholder: "sk-or-v1-...", isSecret: true },
      { key: "model", label: "Model", placeholder: "z-ai/glm-5.3-flash" },
    ],
  },
  openproject: {
    label: "OpenProject (Tickets & Wiki)",
    desc: "Connect a self-hosted OpenProject instance. Syncs work packages as tickets and optionally ingests wiki pages into the knowledge base.",
    docs: "https://www.openproject.org/docs/api/",
    fields: [
      { key: "base_url", label: "Base URL", placeholder: "https://openproject.drlinuxer.com" },
      { key: "api_key", label: "API Key", placeholder: "OpenProject access token", isSecret: true },
      { key: "project_id", label: "Project ID", placeholder: "1 or project identifier" },
      { key: "wiki_enabled", label: "Ingest Wiki Pages (true/false)", placeholder: "true" },
    ],
  },
  xwiki: {
    label: "XWiki (Knowledge Base)",
    desc: "Connect an external XWiki instance. Pages from the configured spaces are ingested into the knowledge base alongside Confluence.",
    docs: "https://www.xwiki.org/xwiki/bin/view/Documentation/UserGuide/Features/XWikiRESTfulAPIReferenceGuide/",
    fields: [
      { key: "base_url", label: "Base URL", placeholder: "https://xwiki.drlinuxer.com" },
      { key: "username", label: "Username", placeholder: "xwiki service user" },
      { key: "api_token", label: "API Token / Password", placeholder: "xwiki access token", isSecret: true },
      { key: "wiki", label: "Wiki Name", placeholder: "xwiki" },
      { key: "spaces", label: "Spaces (comma separated)", placeholder: "Main,IT,Help" },
    ],
  },
  zabbix: {
    label: "Zabbix (Monitoring)",
    desc: "Connect a Zabbix server so users can ask about device/server status and active problems in natural language.",
    docs: "https://www.zabbix.com/documentation/current/en/manual/api",
    fields: [
      { key: "base_url", label: "Zabbix Server URL", placeholder: "http://zabbix.drlinuxer.com" },
      { key: "api_token", label: "API Token", placeholder: "Zabbix API token (User menu → API tokens)", isSecret: true },
    ],
  },
  grafana: {
    label: "Grafana (Dashboards)",
    desc: "Connect Grafana with a service-account token so the chatbot pulls data from the administrator-created dashboards — multi-cluster and varied dashboards are covered automatically.",
    docs: "https://grafana.com/docs/grafana/latest/administration/service-accounts/",
    fields: [
      { key: "base_url", label: "Grafana URL", placeholder: "http://10.10.10.18:3000" },
      { key: "api_token", label: "Service Account Token", placeholder: "glsa_... (Grafana → Administration → Service accounts)", isSecret: true },
    ],
  },
};

export function IntegrationsConfig() {
  const [active, setActive] = useState<IntegrationKey>("confluence");
  const [form, setForm] = useState<Record<string, string>>({});
  const [tokenSet, setTokenSet] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const isLlm = active === "llm";

  async function fetchModels() {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await getLlmModels();
      setModels(res.models || []);
    if (!res.models?.length) setModelsError("Provider returned an empty model list.");
    } catch (err: any) {
      setModels([]);
      setModelsError(err?.message || "Failed to load models");
    } finally {
      setLoadingModels(false);
    }
  }

  const load = async (key: IntegrationKey) => {
    setResult(null);
    try {
      const res = await getIntegrationSettings(key);
      setForm({ ...(res.settings || {}) });
      setTokenSet(!!res.settings?.token_set);
    } catch {
      setForm({});
    }
  };

  const switchTab = (key: IntegrationKey) => {
    setActive(key);
    setShowSecret(false);
    setModels([]);
    setModelsError(null);
    load(key);
  };

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      await putIntegrationSettings(active, form);
      setResult({ ok: true, message: "Saved. Click Test to verify connection." });
      await load(active);
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await testIntegration(active);
      if (res?.ok) setResult({ ok: true, message: `Connected as ${res.user || "user"}` });
      else setResult({ ok: false, message: res?.detail || res?.error || "Connection failed" });
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-5 pt-3">
        {(["confluence", "jira", "openproject", "xwiki", "zabbix", "grafana", "ldap", "keycloak", "llm"] as IntegrationKey[]).map((k) => (
          <button
            key={k}
            onClick={() => switchTab(k)}
            className={[
              "px-3 py-2 text-xs font-medium border-b-2 -mb-px",
              active === k
                ? "border-blue-600 text-blue-700 dark:text-blue-300"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300",
            ].join(" ")}
          >
            {META[k].label.split(" (")[0].split(" /")[0].replace(" SSO", "")}
          </button>
        ))}
        <a
          href={META[active].docs}
          target="_blank"
          rel="noreferrer"
          className="ml-auto mr-2 text-2xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 inline-flex items-center gap-1"
        >
          Get API token <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="px-5 pb-5 space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">{META[active].desc}</p>

        <div className="grid grid-cols-1 gap-3">
          {META[active].fields.map((f) => {
            const isModelField = isLlm && f.key === "model";
            return (
            <div key={f.key} className="space-y-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                {f.label}
                {f.isSecret && tokenSet && (
                  <span className="ml-2 inline-flex items-center gap-1 text-2xs text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> Token saved
                  </span>
                )}
              </label>
              <div className="relative">
                {isModelField ? (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <select
                        value={form[f.key] || ""}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        disabled={loadingModels || models.length === 0}
                        className="w-full appearance-none rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 pr-9 text-xs text-slate-900 dark:text-white disabled:opacity-60"
                      >
                        <option value="">
                          {models.length === 0
                            ? (loadingModels ? "Loading models..." : "— Load models first —")
                            : models.some((m) => m.id === form[f.key])
                              ? (form[f.key] as string)
                              : `${form[f.key] || ""} (custom, not in list)`}
                        </option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>{m.id}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    </div>
                    <button
                      type="button"
                      onClick={fetchModels}
                      disabled={loadingModels}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                      title="Fetch the model catalogue from the provider using the saved API key"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? "animate-spin" : ""}`} />
                      {loadingModels ? "Loading..." : models.length ? "Reload" : "Load models"}
                    </button>
                  </div>
                ) : (
                  <input
                    type={f.isSecret && !showSecret ? "password" : (f.type || "text")}
                    value={form[f.key] || ""}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    placeholder={f.isSecret && tokenSet ? "leave blank to keep current" : f.placeholder}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 pr-10 text-xs text-slate-900 dark:text-white placeholder:text-slate-400"
                  />
                )}
                {f.isSecret && (
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className={isModelField ? "hidden" : "absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600"}
                  >
                    {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
              {isModelField && modelsError && (
                <p className="mt-1 flex items-center gap-1 text-2xs text-rose-600">
                  <AlertCircle className="h-3 w-3" /> {modelsError}
                  <button type="button" onClick={fetchModels} className="ml-1 underline hover:no-underline">retry</button>
                </p>
              )}
              {isModelField && models.length > 0 && (
                <p className="mt-1 text-2xs text-slate-400">
                  {models.length} models available from your provider — pick one, or keep a custom ID.
                </p>
              )}
            </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
          <button
            onClick={test}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium px-3 py-2 disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LoaderIcon className="h-3.5 w-3.5" />}
            Test connection
          </button>
          {active === "openproject" && (
            <button
              onClick={async () => {
                setSyncing(true);
                setResult(null);
                try {
                  const res = await syncOpenProjectTickets();
                  if (res?.ok) {
                    setResult({ ok: true, message: `Synced: ${res.created ?? 0} created, ${res.updated ?? 0} updated (total ${res.total ?? 0})` });
                  } else {
                    setResult({ ok: false, message: res?.message || "Sync failed" });
                  }
                } catch (e: any) {
                  setResult({ ok: false, message: e?.message || "Sync failed" });
                } finally {
                  setSyncing(false);
                }
              }}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-xs font-medium px-3 py-2 disabled:opacity-50"
              title="Pull work packages from OpenProject into the tickets board"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync tickets now
            </button>
          )}
          {result && (
            <span
              className={[
                "inline-flex items-center gap-1 text-xs",
                result.ok ? "text-emerald-600" : "text-rose-600",
              ].join(" ")}
            >
              {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {result.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
