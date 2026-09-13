/**
 * Which KB provider an article came from (v1.6.45).
 *
 * Resolution order:
 *   1. the `source_url` host — authoritative and provider-specific
 *      (aungaungxero.atlassian.net = Confluence, app.clickup.com = ClickUp, ...)
 *   2. the `page_id` prefix, for records whose URL is missing
 *      (notion-…, clickup-…, xwiki-…, openproject-…, manual-…)
 *
 * The legacy Confluence rows created before the prefix convention existed have
 * bare numeric page ids, so the host check has to come first — keying off the id
 * alone reports those 78 articles as unknown.
 */

export type ProviderKey =
  | "confluence"
  | "clickup"
  | "notion"
  | "xwiki"
  | "openproject"
  | "manual"
  | "unknown";

export type ProviderMeta = {
  key: ProviderKey;
  label: string;
  /** badge classes — a distinct hue per provider so the list scans quickly */
  className: string;
};

const PROVIDERS: Record<ProviderKey, ProviderMeta> = {
  confluence: {
    key: "confluence",
    label: "Confluence",
    className: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300",
  },
  clickup: {
    key: "clickup",
    label: "ClickUp",
    className: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
  },
  notion: {
    key: "notion",
    label: "Notion",
    className: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
  },
  xwiki: {
    key: "xwiki",
    label: "XWiki",
    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  },
  openproject: {
    key: "openproject",
    label: "OpenProject",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  manual: {
    key: "manual",
    label: "Manual",
    className: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300",
  },
  unknown: {
    key: "unknown",
    label: "Unknown",
    className: "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
  },
};

const HOST_MAP: Array<[RegExp, ProviderKey]> = [
  [/atlassian\.net/i, "confluence"],
  [/api\.clickup\.com|app\.clickup\.com/i, "clickup"],
  [/notion\.so|app\.notion\.com|notion\.site/i, "notion"],
  [/xwiki/i, "xwiki"],
  [/openproject/i, "openproject"],
];

const PREFIX_MAP: Array<[string, ProviderKey]> = [
  ["notion-", "notion"],
  ["clickup-", "clickup"],
  ["xwiki-", "xwiki"],
  ["openproject-", "openproject"],
  ["manual-", "manual"],
];

export function providerOf(article: { page_id?: string; source_url?: string }): ProviderMeta {
  const url = article?.source_url || "";
  if (url) {
    for (const [re, key] of HOST_MAP) {
      if (re.test(url)) return PROVIDERS[key];
    }
  }
  const pid = String(article?.page_id || "");
  for (const [prefix, key] of PREFIX_MAP) {
    if (pid.startsWith(prefix)) return PROVIDERS[key];
  }
  if (/^\d+$/.test(pid)) {
    // Legacy bare-numeric ids are Confluence pages ingested before the prefix
    // convention existed (their source_url is the Atlassian host).
    return PROVIDERS.confluence;
  }
  return PROVIDERS.unknown;
}

export function allProviders(): ProviderMeta[] {
  return [
    PROVIDERS.confluence,
    PROVIDERS.clickup,
    PROVIDERS.notion,
    PROVIDERS.xwiki,
    PROVIDERS.openproject,
    PROVIDERS.manual,
  ];
}
