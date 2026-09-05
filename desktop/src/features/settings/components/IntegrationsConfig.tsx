import { useState } from "react";
import { Save, Loader2, CheckCircle2, XCircle, Eye, EyeOff, ExternalLink, Loader as LoaderIcon } from "lucide-react";
import { getIntegrationSettings, putIntegrationSettings, testIntegration } from "@/features/settings/api";

type IntegrationKey = "confluence" | "jira" | "ldap" | "keycloak";

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
};

export function IntegrationsConfig() {
  const [active, setActive] = useState<IntegrationKey>("confluence");
  const [form, setForm] = useState<Record<string, string>>({});
  const [tokenSet, setTokenSet] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

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
        {(["confluence", "jira", "ldap", "keycloak"] as IntegrationKey[]).map((k) => (
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
          {META[active].fields.map((f) => (
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
                <input
                  type={f.isSecret && !showSecret ? "password" : (f.type || "text")}
                  value={form[f.key] || ""}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.isSecret && tokenSet ? "leave blank to keep current" : f.placeholder}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 pr-10 text-xs text-slate-900 dark:text-white placeholder:text-slate-400"
                />
                {f.isSecret && (
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600"
                  >
                    {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
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
