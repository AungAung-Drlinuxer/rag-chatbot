import { useState } from "react";
import {
  BookOpen, CheckCircle2, ChevronRight, ClipboardList, Rss,
  Eye, EyeOff, ExternalLink, FileText, Info, KeyRound, ListChecks, Loader2,
  Loader as LoaderIcon, Lock, NotebookPen, Pencil, RefreshCw, Save, ServerCog,
  Shapes, ShieldCheck, Ticket, Trash2, Users, XCircle,
} from "lucide-react";
import { getIntegrationSettings, putIntegrationSettings, deleteIntegrationSettings, testIntegration, syncOpenProjectTickets } from "@/features/settings/api";

type IntegrationKey = "confluence" | "jira" | "ldap" | "keycloak" | "openproject" | "xwiki" | "notion" | "clickup" | "anytype" | "hashnode" | "mcp";

/** Per-integration icon. A text-only tab bar of 11 items is slow to scan; the icon is
 *  what makes the row navigable at a glance. */
const ICON: Record<IntegrationKey, typeof BookOpen> = {
  confluence: BookOpen,
  jira: Ticket,
  openproject: ClipboardList,
  xwiki: FileText,
  notion: NotebookPen,
  clickup: ListChecks,
  anytype: Shapes,
  hashnode: Rss,
  mcp: ServerCog,
  ldap: Users,
  keycloak: KeyRound,
};

/** Order the nav shows. Knowledge sources first (they feed the assistant), then the
 *  infrastructure ones, then the model provider. */
const NAV_ORDER: IntegrationKey[] = [
  "confluence", "jira", "openproject", "xwiki", "notion", "clickup", "anytype", "hashnode",
  "mcp", "ldap", "keycloak",
];

/**
 * Field groups. Every integration's fields answer one of three different questions, and
 * putting them in a single flat column is what made this screen hard to read — an endpoint,
 * a secret and an optional tuning knob all carried the same visual weight.
 *
 * The group is DERIVED from the field key rather than declared on each of the ~50 field
 * definitions, so it stays right when an integration is added. Anything unrecognised lands
 * in "options", which is the safe default: a mis-grouped endpoint is a cosmetic problem,
 * whereas silently presenting a secret as ordinary config would not be.
 */
type FieldGroup = "connection" | "credentials" | "options";

const CREDENTIAL_KEYS = new Set([
  "api_key", "api_token", "access_token", "bind_password", "client_secret", "password",
  "token", "secret",
]);
const CONNECTION_KEYS = new Set([
  "base_url", "host", "port", "issuer", "redirect_uri", "url", "realm",
]);

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
  hashnode: {
    label: "Hashnode (Blog)",
    desc: "Ingest a Hashnode blog's published posts into the knowledge base. Reads go through the GraphQL API at gql.hashnode.com — note that Hashnode retired free API access on 2026-05-13, so every query now needs a Pro plan on the publication. The PAT is write-only.",
    docs: "https://hashnode.com/settings/developer",
    fields: [
      { key: "publication_host", label: "Publication host", placeholder: "blog.example.com" },
      { key: "api_key", label: "Personal Access Token", placeholder: "your Hashnode PAT", isSecret: true },
      { key: "base_url", label: "GraphQL endpoint", placeholder: "https://gql.hashnode.com" },
      { key: "domain", label: "KB domain tag", placeholder: "engineering (empty = auto-classify)" },
      { key: "max_posts", label: "Max posts per sync", placeholder: "200" },
      { key: "include_drafts", label: "Include drafts", placeholder: "false" },
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
  anytype: {
    label: "Anytype (Knowledge Base)",
    desc:
      "Import objects from a local-first Anytype space into the knowledge base. Anytype runs on " +
      "YOUR machine, so the base URL is usually http://127.0.0.1:31009 for the desktop app (the " +
      "CLI listens on 31012) — a containerised backend cannot reach loopback, so point this at a " +
      "reachable host instead. Create the key in Anytype under Settings → API Keys. " +
      "Anytype ALSO requires an 'Anytype-Version' header on every request: leave it blank to use " +
      "the dated default, and change it if a newer Anytype refuses the old one. " +
      "Objects are read as blocks and flattened to markdown; an object that yields no text is " +
      "skipped rather than indexed as a blank article. Nothing is ever written back to Anytype — " +
      "this integration only issues reads.",
    docs: "https://developers.anytype.io/docs/reference",
    fields: [
      { key: "base_url", label: "Anytype API base URL", placeholder: "http://127.0.0.1:31009" },
      { key: "api_key", label: "API Key (Anytype → Settings → API Keys)", placeholder: "your Anytype API key", isSecret: true },
      { key: "api_version", label: "Anytype-Version header (blank = 2025-11-08)", placeholder: "2025-11-08" },
      { key: "space_ids", label: "Space IDs or names (comma separated, empty = all spaces)", placeholder: "My Space, 6f2a...c9" },
      { key: "object_types", label: "Object types (comma separated, empty = all)", placeholder: "page, note" },
      { key: "domain", label: "KB Domain Tag (empty = auto-classify)", placeholder: "general" },
      { key: "max_objects", label: "Max objects per sync", placeholder: "300" },
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
      "only sees a curated subset of the tool catalogue. Proxmox VE is separate and OFF by " +
      "default: it can destroy virtual machines, and this cluster is itself hosted there. " +
      "Enable it only after putting a read-only (PVEAuditor) API token in the " +
      "'proxmox-mcp-credentials' Secret and scaling the proxmox-mcp deployment to 1 — the " +
      "hypervisor credential deliberately does NOT live in this form, because the Proxmox " +
      "server reads it from its environment and a token that powerful belongs with the " +
      "platform team. Its destructive tier is unreachable: the process-level opt-in is " +
      "never set, so those tools fail closed in code.",
    docs: "https://modelcontextprotocol.io/",
    fields: [
      { key: "enabled", label: "Enabled (true/false)", placeholder: "true" },
      { key: "rancher_url", label: "Rancher Server URL", placeholder: "https://rke2-cluster.drlinuxer.com" },
      { key: "rancher_token", label: "Rancher API Token (READ-ONLY role — needed for downstream clusters)",
        placeholder: "token-xxxxx:xxxxxxxxxxxx", isSecret: true },
      { key: "url", label: "MCP Server URL (optional — blank = auto-select)",
        placeholder: "http://rancher-mcp:8080" },
      { key: "timeout_s", label: "Per-call timeout (seconds)", placeholder: "20" },
      { key: "proxmox_enabled", label: "Proxmox VE enabled (true/false)", placeholder: "false" },
      { key: "proxmox_url", label: "Proxmox MCP Server URL",
        placeholder: "http://proxmox-mcp:8000" },
    ],
  },
};

/** Tab label without the parenthetical: "Confluence (Knowledge Base)" → "Confluence". */
function shortLabel(k: IntegrationKey): string {
  return META[k].label.split(" (")[0].split(" /")[0].replace(" SSO", "");
}

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
  // PER FIELD. A single shared flag meant revealing one secret revealed every secret on
  // the form at once, which is the opposite of what an eye toggle is for.
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = async (key: IntegrationKey) => {
    setResult(null);
    try {
      const res = await getIntegrationSettings(key);
      // Every integration here is write-only: nothing readable is ever seeded back into
      // the form, so a stored value can only be replaced, never read.
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
    setRevealed({});
    setReplacing({});
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

  /** One field row. Kept as a local function so the grouping loop above stays readable. */
  function renderField(f: { key: string; label: string; placeholder: string; type?: string; isSecret?: boolean }) {
    const configured = isConfigured(f.key);
    const editable = isEditable(f.key);
    const isSecret = !!f.isSecret || secretFields.includes(f.key);
    const show = !!revealed[f.key];
    const showBadge = configured;

    return (
      <div key={f.key} className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
          {f.label}
          {showBadge && (
            <span className="inline-flex items-center gap-1 text-2xs text-emerald-600">
              {isSecret ? <Lock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {isSecret ? "Saved — not retrievable" : "Configured"}
            </span>
          )}
        </label>

        {/* A stored value is never rendered. The admin sees a mask and must press Replace. */}
        {configured && !editable ? (
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
              <Lock className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="select-none font-mono text-xs tracking-widest text-slate-400">••••••••</span>
              <span className="ml-auto text-2xs text-slate-400">write-only</span>
            </div>
            <button
              type="button"
              onClick={() => setReplacing({ ...replacing, [f.key]: true })}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
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
                     browser and password managers offer to save it into the admin's personal
                     vault, and autocorrect/spellcheck can ship the value to a third party. */
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                {isSecret && (
                  <button
                    type="button"
                    aria-label={show ? `Hide ${f.label}` : `Reveal ${f.label}`}
                    onClick={() => setRevealed({ ...revealed, [f.key]: !show })}
                    className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600"
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
                className="mt-1 text-2xs text-slate-400 underline hover:text-slate-600 dark:hover:text-slate-300"
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
    .map((g) => ({ group: g, fields: META[active].fields.filter((f) => groupOf(f.key) === g) }))
    .filter((x) => x.fields.length > 0);

  const dirty = Object.values(form).some((v) => typeof v === "string" && v.trim().length > 0);

  return (
    <div className="flex flex-col lg:flex-row">
      {/* ---- nav rail ------------------------------------------------------------ */}
      <nav className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-800 lg:w-60 lg:border-b-0 lg:border-r">
        <p className="hidden px-2 pb-2 text-2xs font-semibold uppercase tracking-wider text-slate-400 lg:block">
          Knowledge &amp; Services
        </p>
        <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {NAV_ORDER.map((k) => {
            const Icon = ICON[k];
            const on = active === k;
            return (
              <button
                key={k}
                onClick={() => switchTab(k)}
                title={META[k].label}
                className={[
                  "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition lg:w-full",
                  on
                    ? "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200"
                    : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60",
                ].join(" ")}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="whitespace-nowrap lg:truncate">{shortLabel(k)}</span>
                {on && <ChevronRight className="ml-auto hidden size-3 shrink-0 lg:block" />}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ---- panel --------------------------------------------------------------- */}
      <div className="min-w-0 flex-1 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{META[active].label}</h3>
              {fieldsSet.length > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-2xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-2xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <span className="size-1.5 rounded-full bg-slate-400" /> Not configured
                </span>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {META[active].desc}
            </p>
          </div>
          <a
            href={META[active].docs}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-2xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Get API token <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <p className="text-2xs leading-relaxed text-slate-600 dark:text-slate-400">
            <b>Credentials are write-only.</b> Every value below — URLs, hosts, accounts, keys and
            tokens — is stored server-side and is <b>never returned</b> once saved. Enter a value
            only when adding or replacing it; leaving a field blank keeps what is already stored.
            {updatedAt && <> Last saved {new Date(updatedAt).toLocaleString()}.</>}
          </p>
        </div>

        <div className="mt-5 space-y-6">
          {groups.map(({ group, fields }) => (
            <section key={group}>
              <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-slate-100 pb-1.5 dark:border-slate-800">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {GROUP_META[group].label}
                </h4>
                <span className="text-2xs text-slate-400">{GROUP_META[group].hint}</span>
                {group === "credentials" && <Lock className="size-3 text-slate-400" />}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {fields.map(renderField)}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
          <button
            onClick={test}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
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
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
              title="Pull work packages from OpenProject into the tickets board"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync tickets now
            </button>
          )}

          {fieldsSet.length > 0 && (
            <button
              onClick={clearIntegration}
              disabled={clearing}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/30"
              title="Revoke the stored credentials — the only way to remove a write-only value"
            >
              {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Remove stored settings
            </button>
          )}
        </div>

        {/* Unsaved input is called out, because a write-only field cannot be read back to
            check whether the value was actually stored. */}
        {dirty && !result && (
          <p className="mt-2 flex items-center gap-1 text-2xs text-amber-600 dark:text-amber-400">
            <Info className="h-3 w-3" /> Unsaved changes — press Save to store them.
          </p>
        )}

        {result && (
          <p
            className={[
              "mt-2 inline-flex items-center gap-1 text-xs",
              result.ok ? "text-emerald-600" : "text-rose-600",
            ].join(" ")}
          >
            {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {result.message}
          </p>
        )}
      </div>
    </div>
  );
}
