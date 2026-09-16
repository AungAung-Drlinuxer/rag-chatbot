import { useState } from "react";
import { Save, Loader2, CheckCircle2, XCircle, Eye, EyeOff, ExternalLink, Loader as LoaderIcon, AlertCircle, ChevronDown, RefreshCw, Lock, ShieldCheck, Trash2, Pencil } from "lucide-react";
import { getIntegrationSettings, putIntegrationSettings, deleteIntegrationSettings, testIntegration, getLlmModels, syncOpenProjectTickets } from "@/features/settings/api";
import type { ProviderModel } from "@/features/settings/api";

type IntegrationKey = "confluence" | "jira" | "ldap" | "keycloak" | "llm" | "openproject" | "xwiki" | "notion" | "clickup" | "mcp";

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
    label: "Models Provider",
    desc: "Primary AI provider for generating answers (OpenAI-compatible: OpenRouter, DeepSeek, Anthropic, or an on-prem gateway). Credentials are write-only — once saved they can never be read back. Changes apply within 30 seconds without a rebuild.",
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
  notion: {
    label: "Notion (Knowledge Base)",
    desc:
      "Import Notion pages into the knowledge base. Uses a Notion internal integration token. " +
      "IMPORTANT: a page must be shared with the integration (page -> ... -> Connections) or it " +
      "returns 404 even with a valid token. Nested blocks are parsed recursively and sub-pages " +
      "are ingested as their own articles automatically.",
    docs: "https://www.notion.so/my-integrations",
    fields: [
      { key: "api_token", label: "Internal Integration Secret", placeholder: "ntn_... or secret_...", isSecret: true },
      { key: "source_ids", label: "Page / Database IDs (comma separated, empty = all shared)", placeholder: "1f2a...c9, 8b7d...42" },
      { key: "domain", label: "KB Domain Tag (empty = auto-classify)", placeholder: "general" },
      { key: "max_pages", label: "Max pages per sync", placeholder: "300" },
    ],
  },
  clickup: {
    label: "ClickUp (Docs & Tasks)",
    desc:
      "Import ClickUp Docs and/or tasks from named Lists. Uses a ClickUp personal token (pk_...) — " +
      "the raw token goes in the Authorization header, never with a 'Bearer ' prefix. " +
      "Docs come from the whole workspace (leave Doc IDs empty for all of them). Tasks are only " +
      "read from Lists you name — enter real LIST ids, not the workspace id (a wrong id returns " +
      "404 'List not found' and silently syncs nothing). Set KB Domain Tag to a real domain such " +
      "as 'general', otherwise the content lands in a domain no role can read.",
    docs: "https://developer.clickup.com/docs/authentication",
    fields: [
      { key: "api_token", label: "Personal API Token", placeholder: "pk_12345678_ABCDEF...", isSecret: true },
      { key: "doc_ids", label: "Doc IDs (empty = all docs in the workspace)", placeholder: "8c9c4a1-1018" },
      { key: "list_ids", label: "List IDs for tasks (NOT the workspace id)", placeholder: "901804099497" },
      { key: "workspace_ids", label: "Workspace ID (optional — first visible workspace is used)", placeholder: "9018580345" },
      { key: "include_comments", label: "Include task comments (true/false)", placeholder: "false" },
      { key: "min_chars", label: "Minimum task text length", placeholder: "120" },
      { key: "domain", label: "KB Domain Tag (use a real domain, e.g. general)", placeholder: "general" },
      { key: "max_tasks", label: "Max tasks per sync", placeholder: "500" },
    ],
  },
  mcp: {
    label: "MCP (Live Infrastructure)",
    desc:
      "Read-only access to your Kubernetes / Rancher estate via Model Context Protocol servers. " +
      "Two servers run in-cluster: one reads THIS cluster through a read-only ServiceAccount " +
      "(no credential needed), and a second reaches Rancher-managed downstream clusters through " +
      "the management API. Leave the Rancher Token empty to stay on the ServiceAccount path; " +
      "paste a token to switch to the Rancher API and see your downstream clusters. " +
      "Bind that token to a READ-ONLY Rancher role — anything the token can do, the assistant " +
      "can do. The URL is optional: leave it empty to let the app pick the right server. " +
      "Every tool is read-only (read_only=true, disable_destructive=true) and the assistant " +
      "only sees a curated subset of the tool catalogue.",
    docs: "https://modelcontextprotocol.io/",
    fields: [
      { key: "enabled", label: "Enabled (true/false)", placeholder: "true" },
      { key: "rancher_url", label: "Rancher Server URL", placeholder: "https://rke2-cluster.drlinuxer.com" },
      { key: "rancher_token", label: "Rancher API Token (READ-ONLY role — needed for downstream clusters)",
        placeholder: "token-xxxxx:xxxxxxxxxxxx", isSecret: true },
      { key: "url", label: "MCP Server URL (optional — blank = auto-select)",
        placeholder: "http://rancher-mcp:8080" },
      { key: "timeout_s", label: "Per-call timeout (seconds)", placeholder: "20" },
    ],
  },
};

export function IntegrationsConfig() {
  const [active, setActive] = useState<IntegrationKey>("confluence");
  // v1.6.35 — `form` holds ONLY newly typed values. Stored values are never
  // loaded into it (the API does not return them), so a plain Save can never
  // re-submit or overwrite a secret with a placeholder.
  const [form, setForm] = useState<Record<string, string>>({});
  const [fieldsSet, setFieldsSet] = useState<string[]>([]);
  const [secretFields, setSecretFields] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [clearing, setClearing] = useState(false);
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
      // Deliberately DO NOT seed `form` from the response: every value in
      // `res.settings` is a mask token. Only the "which fields are set" flags
      // are usable.
      setForm({});
      setReplacing({});
      setFieldsSet(res.fields_set || []);
      setSecretFields(res.secret_fields || []);
      setUpdatedAt(res.updated_at || null);
      setTokenSet(!!res.token_set || (res.secret_fields || []).length > 0);
    } catch {
      setForm({});
      setFieldsSet([]);
      setSecretFields([]);
      setUpdatedAt(null);
      setTokenSet(false);
    }
  };

  /** True when the stored config already holds a value for this field. */
  const isConfigured = (fieldKey: string) => fieldsSet.includes(fieldKey);

  /** A field is editable only after the admin explicitly chooses Replace, or when
   *  nothing is stored yet. */
  const isEditable = (fieldKey: string) =>
    !isConfigured(fieldKey) || !!replacing[fieldKey] || fieldKey in form;

  const clearIntegration = async () => {
    if (!window.confirm(
      `Remove the stored ${META[active].label} configuration?\n\n` +
      "Credentials are write-only, so this is the only way to revoke them. " +
      "The integration stops working until it is configured again."
    )) return;
    setClearing(true);
    setResult(null);
    try {
      await deleteIntegrationSettings(active);
      setResult({ ok: true, message: "Stored configuration removed." });
      await load(active);
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Could not clear the configuration" });
    } finally {
      setClearing(false);
    }
  };

  const switchTab = (key: IntegrationKey) => {
    setActive(key);
    setShowSecret(false);
    setReplacing({});
    setModels([]);
    setModelsError(null);
    load(key);
  };

  const save = async () => {
    setSaving(true);
    setResult(null);
    // Only fields the admin actually typed are sent. Omitted fields keep their
    // stored value server-side, so a write-only field can never be blanked.
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) {
      if (typeof v === "string" && v.trim()) payload[k] = v;
    }
    const changed = Object.keys(payload).length;
    try {
      await putIntegrationSettings(active, payload);
      setResult({
        ok: true,
        message: changed
          ? `Saved ${changed} field(s). Click Test to verify the connection.`
          : "Nothing new to save — stored values are unchanged.",
      });
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
        {(["confluence", "jira", "openproject", "xwiki", "notion", "clickup", "mcp", "ldap", "keycloak", "llm"] as IntegrationKey[]).map((k) => (
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

        {/* v1.6.35 — state the posture up front so nobody is surprised that values
            cannot be read back. */}
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <p className="text-2xs leading-relaxed text-slate-600 dark:text-slate-400">
            <b>Credentials are write-only.</b> Every value below — URLs, hosts, accounts,
            keys and tokens — is stored server-side and is <b>never returned</b> once saved.
            {" "}Enter a value only when adding or replacing it; leaving a field blank keeps
            what is already stored.
            {updatedAt && <> Last saved {new Date(updatedAt).toLocaleString()}.</>}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {META[active].fields.map((f) => {
            const isModelField = isLlm && f.key === "model";
            const configured = isConfigured(f.key);
            const editable = isEditable(f.key);
            const isSecret = !!f.isSecret || secretFields.includes(f.key);
            return (
            <div key={f.key} className="space-y-1">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                {f.label}
                {configured && (
                  <span className="ml-2 inline-flex items-center gap-1 text-2xs text-emerald-600">
                    {isSecret ? <Lock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                    {isSecret ? "Secret saved — not retrievable" : "Configured — value hidden"}
                  </span>
                )}
              </label>

              {/* v1.6.35 — a stored value is never rendered. The admin sees a mask
                  and must press Replace to write a new one. */}
              {configured && !editable ? (
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
                    <Lock className="h-3 w-3 shrink-0 text-slate-400" />
                    <span className="font-mono text-xs tracking-widest text-slate-400 select-none">
                      ••••••••
                    </span>
                    <span className="ml-auto text-2xs text-slate-400">write-only</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplacing({ ...replacing, [f.key]: true })}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    title="Enter a new value for this field"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Replace
                  </button>
                </div>
              ) : (
              <>
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
              {configured && (
                <button
                  type="button"
                  onClick={() => {
                    setReplacing({ ...replacing, [f.key]: false });
                    const next = { ...form };
                    delete next[f.key];
                    setForm(next);
                  }}
                  className="mt-1 text-2xs text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300"
                >
                  Keep the stored value
                </button>
              )}
              </>
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
          {fieldsSet.length > 0 && (
            <button
              onClick={clearIntegration}
              disabled={clearing}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/30 text-xs font-medium px-3 py-2 disabled:opacity-50"
              title="Revoke the stored credentials — the only way to remove a write-only value"
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Remove stored settings
            </button>
          )}
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
