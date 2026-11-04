import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Ticket,
  ThumbsDown,
  ThumbsUp,
  Users,
  X,
  FileText,
} from "lucide-react";

interface ReferenceGroup {
  title: string;
  count: number;
  match: string;
  source: string;
  details: string;
}

const referenceGroups: ReferenceGroup[] = [
  {
    title: "Say no to traditional database",
    count: 4,
    match: "50–65%",
    source: "Knowledge base",
    details: "Grouped knowledge references related to database troubleshooting and recovery guidance.",
  },
  {
    title: "PostgreSQL Service Failure",
    count: 1,
    match: "62%",
    source: "Knowledge base",
    details: "Reference group for PostgreSQL service failure checks and diagnosis.",
  },
  {
    title: "Database",
    count: 1,
    match: "66%",
    source: "Knowledge base",
    details: "General database support reference.",
  },
  {
    title: "Database Support Routing",
    count: 1,
    match: "64%",
    source: "Knowledge base",
    details: "Routing guidance for escalating database incidents to the DBA Team.",
  },
];

const healthServices = [
  "PostgreSQL + pgvector",
  "Redis",
  "Ollama / embeddings",
  "Model Provider",
  "Confidence sync",
  "Jira",
  "LDAP / AD",
];

interface CheckItem {
  id: string;
  label: string;
  command?: string;
  done: boolean;
}

const initialChecklist: CheckItem[] = [
  { id: "postgres", label: "Confirm PostgreSQL accepts connections", command: "pg_isready -p 5432", done: false },
  { id: "health", label: "Application health checks pass", done: false },
  { id: "logs", label: "Service logs contain no new critical errors", done: false },
  { id: "monitoring", label: "Monitoring returns healthy", done: false },
];

const navItems = [
  { name: "Chat", icon: MessageSquare },
  { name: "Overview", icon: LayoutDashboard },
  { name: "Knowledge", icon: BookOpen },
  { name: "Domains & routing", icon: Activity },
  { name: "Tickets", icon: Ticket },
  { name: "Users", icon: Users },
  { name: "Conversations", icon: MessageSquare },
  { name: "Audit log", icon: FileText },
  { name: "Settings", icon: Settings },
];

const NAV_MAP: Record<string, string> = {
  "Chat": "chat",
  "Overview": "dashboard",
  "Knowledge": "articles",
  "Domains & routing": "domains",
  "Tickets": "tickets",
  "Users": "users",
  "Conversations": "history",
  "Audit log": "audits",
  "Settings": "settings",
};

interface SidebarProps {
  onNavigate?: (nav: string) => void;
  closeMobile?: () => void;
  userName?: string;
  displayRole?: string;
  onLogout?: () => void;
}

function Sidebar({ onNavigate, closeMobile, userName, displayRole, onLogout }: SidebarProps) {
  const handleNav = (name: string) => {
    const target = NAV_MAP[name] || name;
    if (onNavigate) onNavigate(target);
    closeMobile?.();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-2 pb-6 pt-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-xs font-extrabold text-violet-700 shadow-sm">ITH</span>
        <span className="text-sm font-bold tracking-tight text-white">IT Help Desk</span>
      </div>

      <button
        type="button"
        onClick={() => {
          handleNav("chat");
        }}
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-3 text-sm font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50"
      >
        <Plus size={17} />
        New conversation
      </button>

      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">Workspace</p>
      <nav aria-label="Workspace navigation" className="space-y-1">
        {navItems.map(({ name, icon: Icon }) => {
          const active = name === "Chat";
          return (
            <button
              key={name}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => {
                handleNav(name);
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
                active ? "bg-white text-violet-700 shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={17} aria-hidden="true" />
              {name}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-500" />}
            </button>
          );
        })}
      </nav>

      <div className="mt-6 border-t border-white/15 pt-4">
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Recent conversations</p>
        {["Database is down", "Reset my password…", "Check my Proxmox VM…"].map((title) => (
          <button
            key={title}
            type="button"
            onClick={() => {
              handleNav("chat");
            }}
            className={`block w-full truncate rounded-lg px-3 py-2.5 text-left text-xs transition ${
              title === "Database is down" ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            {title}
          </button>
        ))}
      </div>

      <div className="mt-auto border-t border-white/15 pt-4">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/20 text-xs font-bold text-white">
              {(userName || "AD").slice(0, 2).toUpperCase()}
            </span>
            <span>
              <span className="block text-xs font-semibold text-white">{userName || "Administrator"}</span>
              <span className="block text-[10px] text-white/65">{displayRole || "Workspace admin"}</span>
            </span>
          </div>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              title="Sign out"
              className="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white text-xs"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface PanelCardProps {
  title?: string;
  subtitle?: string;
  icon?: any;
  children: React.ReactNode;
  className?: string;
}

function PanelCard({ title, subtitle, icon: Icon, children, className = "" }: PanelCardProps) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.025] ${className}`}>
      {(title || Icon) && (
        <div className="flex items-start gap-3 px-4 pb-0 pt-4">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
              <Icon size={17} aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs leading-5 text-slate-500">{subtitle}</p>}
          </div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

interface ReferenceCardProps {
  group: ReferenceGroup;
  expanded: boolean;
  onToggle: () => void;
}

function ReferenceCard({ group, expanded, onToggle }: ReferenceCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white transition hover:border-violet-200">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700">
          <BookOpen size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold leading-5 text-slate-800">{group.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
            <span>{group.count} {group.count === 1 ? "reference" : "references"}</span>
            <span aria-hidden="true">·</span>
            <span>{group.match} match</span>
          </span>
        </span>
        <ChevronDown size={15} className={`mt-1 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2.5">
          <p className="text-[11px] leading-5 text-slate-600">{group.details}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400">Source: {group.source}</span>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
              {group.match} retrieval match
            </span>
          </div>
        </div>
      )}
    </article>
  );
}

interface ChatProps {
  userName?: string;
  role?: string;
  displayRole?: string;
  perms?: Record<string, boolean>;
  onNavigate?: (nav: string) => void;
  onLogout?: () => void;
}

interface MessageItem {
  id: number;
  type: "user" | "assistant";
  text: string;
}

export default function Chat({
  userName,
  displayRole,
  onNavigate,
  onLogout,
}: ChatProps) {
  const [checklist, setChecklist] = useState<CheckItem[]>(initialChecklist);
  const [sourceQuery, setSourceQuery] = useState("");
  const [expandedReferences, setExpandedReferences] = useState<string[]>([]);
  const [systemOpen, setSystemOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [toast, setToast] = useState("");
  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraCreated, setJiraCreated] = useState(false);
  const [quickAction, setQuickAction] = useState<string | null>(null);

  const filteredReferences = useMemo(() => {
    const term = sourceQuery.trim().toLowerCase();
    if (!term) return referenceGroups;
    return referenceGroups.filter((group) =>
      [group.title, group.source, group.details, group.match].join(" ").toLowerCase().includes(term)
    );
  }, [sourceQuery]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }

  function toggleChecklist(id: string) {
    setChecklist((current) => current.map((item) => item.id === id ? { ...item, done: !item.done } : item));
  }

  const answerText = [
    "Validate recovery and involve the DBA team.",
    "If the service error indicates configuration, permissions, recovery, replication, or data issues, escalate to the DBA Team.",
    "Use approved recovery procedures.",
    "Restart only through an approved DBA incident/change procedure. For high availability or failover, follow the specific approved cluster failover runbook.",
    ...checklist.map((item) => `${item.label}${item.command ? ` ${item.command}` : ""}`),
  ].join("\n\n");

  async function copyAnswer() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(answerText);
      } else {
        const element = document.createElement("textarea");
        element.value = answerText;
        element.style.position = "fixed";
        element.style.opacity = "0";
        document.body.appendChild(element);
        element.select();
        document.execCommand("copy");
        element.remove();
      }
      notify("Answer copied to clipboard.");
    } catch {
      notify("Copy is unavailable in this browser.");
    }
  }

  function sendFollowUp(event: React.FormEvent) {
    event.preventDefault();
    const text = followUp.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: Date.now(), type: "user", text },
      {
        id: Date.now() + 1,
        type: "assistant",
        text: "I can’t verify this follow-up while offline. Please consult the approved runbook or contact the DBA Team.",
      },
    ]);
    setFollowUp("");
  }

  function createJiraPreview(event: React.FormEvent) {
    event.preventDefault();
    setJiraCreated(true);
    setJiraOpen(false);
    notify("Jira ticket preview created locally. Nothing was sent to Jira.");
  }

  function toggleReference(title: string) {
    setExpandedReferences((current) =>
      current.includes(title) ? current.filter((item) => item !== title) : [...current, title]
    );
  }

  function triggerQuickAction(action: string) {
    setQuickAction(action);
  }

  function closeQuickAction() {
    if (!quickAction) return;
    notify(`${quickAction} is a local preview action. No system was contacted.`);
    setQuickAction(null);
  }

  const sourcesPanel = (
    <div className="space-y-4">
      <PanelCard
        title="Sources"
        subtitle="7 references grouped into 4 titles"
        icon={BookOpen}
      >
        <label className="relative mb-3 block">
          <span className="sr-only">Filter source references</span>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            value={sourceQuery}
            onChange={(event) => setSourceQuery(event.target.value)}
            placeholder="Filter references…"
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
          />
        </label>
        <div className="space-y-2">
          {filteredReferences.map((group) => (
            <ReferenceCard
              key={group.title}
              group={group}
              expanded={expandedReferences.includes(group.title)}
              onToggle={() => toggleReference(group.title)}
            />
          ))}
          {filteredReferences.length === 0 && (
            <p className="rounded-xl bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">No matching references.</p>
          )}
        </div>
        <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2.5 text-[10px] leading-4 text-blue-800">
          Match scores describe retrieval similarity, not answer confidence.
        </p>
      </PanelCard>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          aria-expanded={systemOpen}
          onClick={() => setSystemOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 p-4 text-left"
        >
          <span className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck size={17} /></span>
            <span>
              <span className="block text-sm font-semibold text-slate-900">System status</span>
              <span className="mt-1 block text-xs text-slate-500">7 services · status from screenshot</span>
            </span>
          </span>
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${systemOpen ? "rotate-180" : ""}`} />
        </button>
        {systemOpen && (
          <div className="space-y-1 border-t border-slate-100 p-3">
            {healthServices.map((service) => (
              <div key={service} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2">
                <span className="text-[11px] font-medium text-slate-700">{service}</span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Healthy
                </span>
              </div>
            ))}
            <p className="px-2 pt-2 text-[10px] leading-4 text-slate-400">Static status labels from the supplied screenshot; not live monitoring.</p>
          </div>
        )}
      </section>

      <PanelCard title="Quick actions" subtitle="Shortcuts for common requests" icon={LifeBuoy}>
        <div className="space-y-2">
          {[
            ["Reset password", "Reset password"],
            ["Check service status", "Check service status"],
            ["My tickets", "My tickets"],
          ].map(([label, action]) => (
            <button
              key={action}
              type="button"
              onClick={() => triggerQuickAction(action)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-left text-xs font-medium text-slate-700 transition hover:border-violet-200 hover:bg-violet-50"
            >
              {label}<ArrowUpRight size={14} className="text-slate-400" />
            </button>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-slate-400">Actions show local demo confirmations only.</p>
      </PanelCard>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/35 md:hidden" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMobileNavOpen(false);
        }}>
          <aside className="flex h-full w-72 flex-col bg-gradient-to-b from-violet-700 to-violet-900 p-4 shadow-2xl">
            <div className="mb-3 flex justify-end">
              <button type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="rounded-lg p-2 text-white hover:bg-white/10"><X size={18} /></button>
            </div>
            <Sidebar onNavigate={onNavigate} closeMobile={() => setMobileNavOpen(false)} userName={userName} displayRole={displayRole} onLogout={onLogout} />
          </aside>
        </div>
      )}

      {mobileSourcesOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/35 lg:hidden" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMobileSourcesOpen(false);
        }}>
          <aside className="ml-auto h-full w-full max-w-sm overflow-y-auto bg-slate-50 p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold">Sources & status</h2>
              <button type="button" aria-label="Close sources panel" onClick={() => setMobileSourcesOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-white"><X size={18} /></button>
            </div>
            {sourcesPanel}
          </aside>
        </div>
      )}

      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-[230px] shrink-0 flex-col bg-gradient-to-b from-violet-700 to-violet-900 p-4 md:flex">
          <Sidebar onNavigate={onNavigate} userName={userName} displayRole={displayRole} onLogout={onLogout} />
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto grid max-w-[1700px] grid-cols-1 gap-5 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-7 lg:py-6">
            <section className="min-w-0">
              <header className="mb-5 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <button type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm md:hidden">
                    <Menu size={18} />
                  </button>
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span>Workspace</span><ChevronRight size={12} /><span>Chat</span>
                    </div>
                    <h1 className="truncate text-lg font-bold tracking-tight text-slate-950">Database support</h1>
                  </div>
                </div>
                <button type="button" onClick={() => setMobileSourcesOpen(true)} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm lg:hidden">
                  <BookOpen size={15} /> Sources
                </button>
              </header>

              <div className="mb-5 flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-violet-600 px-4 py-3 text-sm font-medium text-white shadow-sm">
                  Database is down
                </div>
              </div>

              <article className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><Bot size={20} /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-bold text-slate-900">IT Assistant</h2>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Visible answer excerpt</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Database support</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1.5 text-[10px] font-medium text-slate-600">
                    <Clock3 size={12} /> Retrieval pipeline completed 28.1s
                  </span>
                </div>

                <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">Suggested next step</p>
                    <h3 className="text-xl font-bold leading-snug tracking-tight text-slate-950 sm:text-2xl">
                      Validate recovery and involve the DBA team
                    </h3>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                      If the service error indicates configuration, permissions, recovery, replication, or data issues, escalate to the DBA Team.
                    </p>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
                    <div className="flex gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700"><AlertTriangle size={16} /></span>
                      <div>
                        <p className="text-xs font-bold text-amber-950">Use approved recovery procedures.</p>
                        <p className="mt-1.5 text-xs leading-5 text-amber-900/85">
                          Restart only through an approved DBA incident/change procedure. For high availability or failover, follow the specific approved cluster failover runbook.
                        </p>
                      </div>
                    </div>
                  </div>

                  <section aria-labelledby="validation-title">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 id="validation-title" className="text-sm font-bold text-slate-900">Validation checklist</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {checklist.filter((item) => item.done).length} of {checklist.length} checks complete
                        </p>
                      </div>
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600">Local checklist</span>
                    </div>
                    <div className="space-y-2">
                      {checklist.map((item) => (
                        <label key={item.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition ${item.done ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 hover:border-violet-200 hover:bg-violet-50/30"}`}>
                          <input
                            type="checkbox"
                            checked={item.done}
                            onChange={() => toggleChecklist(item.id)}
                            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 accent-violet-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
                            aria-label={item.label}
                          />
                          <span className={`min-w-0 flex-1 text-xs leading-5 ${item.done ? "text-slate-500 line-through" : "text-slate-700"}`}>
                            {item.label}
                            {item.command && <code className="ml-1.5 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-violet-800">{item.command}</code>}
                          </span>
                          {item.done && <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" />}
                        </label>
                      ))}
                    </div>
                  </section>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex items-center gap-2 text-slate-700"><Users size={15} /><h3 className="text-xs font-bold">Incident routing</h3></div>
                      <div className="space-y-2.5 text-xs">
                        <div className="flex justify-between gap-3"><span className="text-slate-500">Owner</span><span className="font-semibold text-slate-800">DBA Team</span></div>
                        <div className="flex justify-between gap-3"><span className="text-slate-500">Jira queue / project</span><span className="text-right font-semibold text-slate-800">IT HelpDesk · Database</span></div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2 text-slate-700"><Activity size={15} /><h3 className="text-xs font-bold">Answer metadata</h3></div>
                      <p className="text-xs leading-5 text-slate-600">11:52 PM <span className="mx-1 text-slate-300">·</span> <strong className="font-semibold text-slate-800">79% answer confidence</strong></p>
                      <p className="mt-1 text-[11px] text-slate-500">2,915 input / 1,465 output tokens</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" aria-pressed={feedback === "helpful"} onClick={() => { setFeedback("helpful"); notify("Thanks for your feedback. Saved in this preview."); }} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${feedback === "helpful" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        <ThumbsUp size={14} /> Helpful
                      </button>
                      <button type="button" aria-pressed={feedback === "not-helpful"} onClick={() => { setFeedback("not-helpful"); notify("Feedback noted locally in this preview."); }} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${feedback === "not-helpful" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        <ThumbsDown size={14} /> Not helpful
                      </button>
                      <button type="button" onClick={copyAnswer} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                        <Copy size={14} /> Copy answer
                      </button>
                      <button type="button" onClick={() => notify("Regenerate is unavailable offline; no AI service was contacted.")} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">
                        <RefreshCw size={14} /> Regenerate
                      </button>
                    </div>
                    <button type="button" onClick={() => setJiraOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700">
                      <Ticket size={15} /> {jiraCreated ? "Create another Jira preview" : "Create Jira ticket"}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400">Feedback, copy, and ticket actions are local preview interactions.</p>
                </div>
              </article>

              {messages.length > 0 && (
                <section aria-label="Follow-up conversation" className="mt-5 space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.type === "user" ? "rounded-br-md bg-violet-600 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-700 shadow-sm"}`}>
                        {message.type === "assistant" && <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">Offline preview response</p>}
                        {message.text}
                      </div>
                    </div>
                  ))}
                </section>
              )}

              <form onSubmit={sendFollowUp} className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <label htmlFor="follow-up" className="sr-only">Ask a follow-up question</label>
                <textarea
                  id="follow-up"
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={2}
                  placeholder="Ask a follow-up question…"
                  className="w-full resize-y border-0 bg-transparent px-2 py-2 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
                    <Bot size={13} /> Auto mode <ChevronDown size={12} />
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="hidden text-[10px] text-slate-400 sm:inline">Offline demo · no AI call</span>
                    <button type="submit" disabled={!followUp.trim()} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-45">
                      <Send size={14} /> Send
                    </button>
                  </div>
                </div>
              </form>
              <p className="mt-2 text-center text-[10px] text-slate-400">Follow-up messages receive a canned offline preview response.</p>
            </section>

            <aside className="hidden min-w-0 lg:block">
              <div className="sticky top-6">{sourcesPanel}</div>
            </aside>
          </div>
        </main>
      </div>

      {jiraOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setJiraOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="jira-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">Local preview only</p>
                <h2 id="jira-title" className="mt-1 text-lg font-bold text-slate-950">Create Jira ticket</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">Review the simulated ticket details. Nothing will be sent to Jira.</p>
              </div>
              <button type="button" aria-label="Close Jira preview dialog" onClick={() => setJiraOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={17} /></button>
            </div>
            <form onSubmit={createJiraPreview} className="space-y-4">
              <label className="block text-xs font-semibold text-slate-700">
                Summary
                <input defaultValue="Database is down — validate recovery" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Project</p><p className="mt-1 text-xs font-semibold text-slate-800">IT HelpDesk</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] text-slate-500">Queue</p><p className="mt-1 text-xs font-semibold text-slate-800">Database</p></div>
              </div>
              <label className="block text-xs font-semibold text-slate-700">
                Description
                <textarea defaultValue="Validate database recovery using approved procedures and involve the DBA Team." rows={3} className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal leading-5 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
              </label>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setJiraOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-violet-700">Create preview ticket</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {quickAction && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setQuickAction(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="quick-action-title" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><LifeBuoy size={18} /></span>
                <div>
                  <h2 id="quick-action-title" className="text-sm font-bold text-slate-900">{quickAction}</h2>
                  <p className="mt-1 text-[10px] font-semibold text-violet-700">Local demonstration</p>
                </div>
              </div>
              <button type="button" aria-label="Close quick action" onClick={() => setQuickAction(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <p className="text-xs leading-5 text-slate-600">
              This shortcut is displayed for demonstration only. No account, service, or ticket system was contacted.
            </p>
            <button type="button" onClick={closeQuickAction} className="mt-5 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-violet-700">Got it</button>
          </section>
        </div>
      )}

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-[80] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-medium text-white shadow-xl">
          <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />{toast}
        </div>
      )}
    </div>
  );
}
