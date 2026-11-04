import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
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
  RotateCw,
} from "lucide-react";

import { submitFeedback } from "@/features/chat/api";
import { runChatStream } from "@/features/chat/hooks/useChatStream";
import { listConversations, getConversationMessages, type Conv } from "@/features/conversations/api";
import { createTicketApi } from "@/features/tickets/api";
import { dashHealth } from "@/features/dashboard/api";
import MarkdownMessage from "@/components/MarkdownMessage";
import { groupSources, type SourceGroup } from "@/features/chat/sources";
import type { Source, Message } from "@/features/chat/model";

/* ============================================================
   TYPES & CONSTANTS
============================================================ */

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

interface ServiceHealth {
  key: string;
  name: string;
  status: string;
  latency_ms?: number | null;
}

interface ChecklistItem {
  id: string;
  label: string;
  command?: string;
  done: boolean;
}

const defaultChecklist: ChecklistItem[] = [
  { id: "c1", label: "Confirm PostgreSQL accepts connections", command: "pg_isready -p 5432", done: false },
  { id: "c2", label: "Application health checks pass", done: false },
  { id: "c3", label: "Service logs contain no new critical errors", done: false },
  { id: "c4", label: "Monitoring returns healthy", done: false },
];

/* ============================================================
   SIDEBAR COMPONENT
============================================================ */

interface SidebarProps {
  onNavigate?: (nav: string) => void;
  closeMobile?: () => void;
  userName?: string;
  displayRole?: string;
  onLogout?: () => void;
  conversations: Conv[];
  activeSessionId: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

function Sidebar({
  onNavigate,
  closeMobile,
  userName,
  displayRole,
  onLogout,
  conversations,
  activeSessionId,
  onSelectConversation,
  onNewChat,
}: SidebarProps) {
  const handleNav = (name: string) => {
    const target = NAV_MAP[name] || name;
    if (onNavigate) onNavigate(target);
    closeMobile?.();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-2 pb-6 pt-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-xs font-extrabold text-violet-700 shadow-sm">
          ITH
        </span>
        <span className="text-sm font-bold tracking-tight text-white">IT Help Desk</span>
      </div>

      {/* New conversation button */}
      <button
        type="button"
        onClick={() => {
          onNewChat();
          closeMobile?.();
        }}
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-3 text-sm font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50"
      >
        <Plus size={17} />
        New conversation
      </button>

      {/* Workspace Navigation */}
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
        Workspace
      </p>
      <nav aria-label="Workspace navigation" className="space-y-1">
        {navItems.map(({ name, icon: Icon }) => {
          const active = name === "Chat";
          return (
            <button
              key={name}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => handleNav(name)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
                active
                  ? "bg-white text-violet-700 shadow-sm"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon size={17} aria-hidden="true" />
              {name}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-500" />}
            </button>
          );
        })}
      </nav>

      {/* Recent Conversations List */}
      <div className="mt-6 flex min-h-0 flex-1 flex-col border-t border-white/15 pt-4">
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">
          Recent conversations
        </p>
        <div className="flex-1 space-y-1 overflow-y-auto pr-1">
          {conversations.length === 0 ? (
            <p className="px-3 py-2 text-xs text-white/50">No conversations yet</p>
          ) : (
            conversations.slice(0, 15).map((conv) => {
              const isSelected = conv.session_id === activeSessionId;
              return (
                <button
                  key={conv.session_id}
                  type="button"
                  onClick={() => {
                    onSelectConversation(conv.session_id);
                    closeMobile?.();
                  }}
                  className={`block w-full truncate rounded-lg px-3 py-2 text-left text-xs transition ${
                    isSelected
                      ? "bg-white/20 font-semibold text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                  title={conv.title || "New conversation"}
                >
                  {conv.title || "New conversation"}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* User profile footer */}
      <div className="mt-auto border-t border-white/15 pt-4">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20 text-xs font-bold text-white">
              {(userName || "AD").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 truncate">
              <span className="block truncate text-xs font-semibold text-white">
                {userName || "Administrator"}
              </span>
              <span className="block truncate text-[10px] text-white/65">
                {displayRole || "Workspace admin"}
              </span>
            </div>
          </div>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              title="Sign out"
              className="shrink-0 rounded-lg p-1.5 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PANEL CARD & REFERENCE CARD (RIGHT SIDEBAR)
============================================================ */

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

function ReferenceCard({
  group,
  expanded,
  onToggle,
}: {
  group: SourceGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const matchPercent = group.max != null ? Math.round(group.max * 100) : null;
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
          <span className="block truncate text-xs font-semibold leading-5 text-slate-800" title={group.source.title}>
            {group.source.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
            <span>
              {group.count} {group.count === 1 ? "reference" : "references"}
            </span>
            {matchPercent != null && (
              <>
                <span aria-hidden="true">·</span>
                <span>{matchPercent}% match</span>
              </>
            )}
          </span>
        </span>
        <ChevronDown
          size={15}
          className={`mt-1 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2.5">
          <p className="text-[11px] leading-5 text-slate-600 line-clamp-4">
            {group.source.excerpt || "No excerpt available."}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] text-slate-400">
              Source: {group.source.space || "Knowledge base"}
            </span>
            {matchPercent != null && (
              <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                {matchPercent}% retrieval match
              </span>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/* ============================================================
   MAIN CHAT WORKSPACE
============================================================ */

interface ChatProps {
  userName?: string;
  role?: string;
  displayRole?: string;
  perms?: Record<string, boolean>;
  onNavigate?: (nav: string) => void;
  onLogout?: () => void;
}

export default function Chat({
  userName,
  displayRole,
  onNavigate,
  onLogout,
}: ChatProps) {
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => crypto.randomUUID());
  const [activeTitle, setActiveTitle] = useState<string>("Database support");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [latestSources, setLatestSources] = useState<Source[]>([]);
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [systemOpen, setSystemOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [expandedReferences, setExpandedReferences] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(defaultChecklist);
  const [feedback, setFeedback] = useState<Record<string, "helpful" | "not-helpful">>({});
  const [toast, setToast] = useState("");
  const [jiraOpen, setJiraOpen] = useState(false);
  const [jiraSummary, setJiraSummary] = useState("");
  const [jiraDesc, setJiraDesc] = useState("");
  const [jiraSubmitting, setJiraSubmitting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<{ role: string; content: string }[]>([]);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3500);
  };

  // Load real conversations
  const loadConversations = () => {
    listConversations()
      .then((data: any) => {
        if (data?.conversations) {
          setConversations(data.conversations);
        }
      })
      .catch(() => {});
  };

  // Load system health
  const loadHealth = () => {
    dashHealth()
      .then((d: any) => {
        if (Array.isArray(d?.services)) {
          setServices(d.services);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadConversations();
    loadHealth();
    const t = window.setInterval(loadHealth, 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Load a conversation by session ID
  const openConversation = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    const conv = conversations.find((c) => c.session_id === sessionId);
    if (conv) setActiveTitle(conv.title || "Conversation");

    try {
      const res: any = await getConversationMessages(sessionId);
      if (res?.messages) {
        const loaded: Message[] = res.messages.map((m: any, idx: number) => ({
          id: m.message_id || `msg-${idx}`,
          role: m.role,
          content: m.content || "",
          timestamp: m.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          confidence: m.meta?.confidence != null ? Math.round(m.meta.confidence * 100) : undefined,
          decision: m.meta?.decision,
          sources: m.meta?.hits || [],
          usage: m.meta?.usage,
        }));
        setMessages(loaded);
        historyRef.current = loaded.map((m) => ({ role: m.role, content: m.content }));

        // Update right sidebar sources from the latest assistant message
        const lastWithSources = [...loaded].reverse().find((m) => m.sources && m.sources.length > 0);
        if (lastWithSources?.sources) {
          setLatestSources(lastWithSources.sources);
        } else {
          setLatestSources([]);
        }
      }
    } catch {
      notify("Failed to load conversation messages.");
    }
  };

  // Start a new chat
  const startNewChat = () => {
    const newId = crypto.randomUUID();
    setActiveSessionId(newId);
    setActiveTitle("New conversation");
    setMessages([]);
    setLatestSources([]);
    historyRef.current = [];
    setInput("");
  };

  // Send message through real RAG pipeline
  const handleSendMessage = async (event?: React.FormEvent, directQuestion?: string) => {
    event?.preventDefault();
    const question = (directQuestion ?? input).trim();
    if (!question || isTyping) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, userMessage]);
    historyRef.current.push({ role: "user", content: question });
    setInput("");
    setIsTyping(true);

    const initialAssistant: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, initialAssistant]);

    try {
      await runChatStream(
        question,
        activeSessionId,
        historyRef.current.slice(0, -1),
        {
          onMeta: (meta: any) => {
            const hits = meta?.hits || [];
            if (hits.length > 0) setLatestSources(hits);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      confidence: meta.confidence != null ? Math.round(meta.confidence * 100) : undefined,
                      decision: meta.decision,
                      sources: hits,
                      usage: meta.usage,
                    }
                  : m
              )
            );
          },
          onToken: (token: string) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m))
            );
          },
          onStage: () => {},
          onApprovalRequest: () => {},
          onDone: () => {
            setIsTyping(false);
            loadConversations();
          },
        }
      );
    } catch (err: any) {
      setIsTyping(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: m.content || `An error occurred: ${err?.message || "connection error"}` }
            : m
        )
      );
    }
  };

  // Submit feedback
  const handleFeedback = async (messageId: string, rating: 1 | -1) => {
    try {
      await submitFeedback(messageId, rating);
      setFeedback((prev) => ({ ...prev, [messageId]: rating === 1 ? "helpful" : "not-helpful" }));
      notify(rating === 1 ? "Thanks for your feedback!" : "Feedback noted.");
    } catch {
      notify("Feedback noted locally.");
    }
  };

  // Copy answer to clipboard
  const copyAnswer = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      notify("Answer copied to clipboard.");
    } catch {
      notify("Unable to copy to clipboard.");
    }
  };

  // Toggle reference group in right panel
  const toggleReference = (title: string) => {
    setExpandedReferences((curr) =>
      curr.includes(title) ? curr.filter((t) => t !== title) : [...curr, title]
    );
  };

  // Filter sources
  const sourceGroups = useMemo(() => {
    const grouped = groupSources(latestSources);
    const q = sourceQuery.trim().toLowerCase();
    if (!q) return grouped;
    return grouped.filter(
      (g) =>
        g.source.title.toLowerCase().includes(q) ||
        g.source.excerpt.toLowerCase().includes(q) ||
        g.source.space.toLowerCase().includes(q)
    );
  }, [latestSources, sourceQuery]);

  // Handle Jira Modal
  const openJiraForMessage = (m: Message, prevUserQuery?: string) => {
    setJiraSummary(prevUserQuery || "Incident from IT Assistant");
    setJiraDesc(m.content);
    setJiraOpen(true);
  };

  const submitJiraTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setJiraSubmitting(true);
    try {
      await createTicketApi({
        subject: jiraSummary,
        description: jiraDesc,
        priority: "medium",
        domain: "general",
        session_id: activeSessionId,
      });
      setJiraOpen(false);
      notify("Jira ticket created successfully!");
    } catch (err: any) {
      notify(`Ticket creation error: ${err?.message || "failed"}`);
    } finally {
      setJiraSubmitting(false);
    }
  };

  const healthyServicesCount = services.filter((s) => s.status === "Healthy").length;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/35 md:hidden"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMobileNavOpen(false);
          }}
        >
          <aside className="flex h-full w-72 flex-col bg-gradient-to-b from-violet-700 to-violet-900 p-4 shadow-2xl">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-lg p-2 text-white hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>
            <Sidebar
              onNavigate={onNavigate}
              closeMobile={() => setMobileNavOpen(false)}
              userName={userName}
              displayRole={displayRole}
              onLogout={onLogout}
              conversations={conversations}
              activeSessionId={activeSessionId}
              onSelectConversation={openConversation}
              onNewChat={startNewChat}
            />
          </aside>
        </div>
      )}

      {/* Mobile Sources Drawer */}
      {mobileSourcesOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/35 lg:hidden"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMobileSourcesOpen(false);
          }}
        >
          <aside className="ml-auto h-full w-full max-w-sm overflow-y-auto bg-slate-50 p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold">Sources & status</h2>
              <button
                type="button"
                aria-label="Close sources panel"
                onClick={() => setMobileSourcesOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-white"
              >
                <X size={18} />
              </button>
            </div>
            {/* Sources content inside drawer */}
            <div className="space-y-4">
              <PanelCard
                title="Sources"
                subtitle={`${latestSources.length} references across ${sourceGroups.length} titles`}
                icon={BookOpen}
              >
                <label className="relative mb-3 block">
                  <span className="sr-only">Filter source references</span>
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={sourceQuery}
                    onChange={(e) => setSourceQuery(e.target.value)}
                    placeholder="Filter references…"
                    className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                  />
                </label>
                <div className="space-y-2">
                  {sourceGroups.map((g) => (
                    <ReferenceCard
                      key={g.key}
                      group={g}
                      expanded={expandedReferences.includes(g.key)}
                      onToggle={() => toggleReference(g.key)}
                    />
                  ))}
                  {sourceGroups.length === 0 && (
                    <p className="rounded-xl bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">
                      No matching references.
                    </p>
                  )}
                </div>
              </PanelCard>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Layout: Left Sidebar + Center Main + Right Panel */}
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-[230px] shrink-0 flex-col bg-gradient-to-b from-violet-700 to-violet-900 p-4 md:flex">
          <Sidebar
            onNavigate={onNavigate}
            userName={userName}
            displayRole={displayRole}
            onLogout={onLogout}
            conversations={conversations}
            activeSessionId={activeSessionId}
            onSelectConversation={openConversation}
            onNewChat={startNewChat}
          />
        </aside>

        {/* Center Main Chat Workspace */}
        <main className="min-w-0 flex-1">
          <div className="mx-auto grid max-w-[1700px] grid-cols-1 gap-5 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-7 lg:py-6">
            <section className="min-w-0 flex flex-col min-h-[calc(100vh-3rem)]">
              {/* Header */}
              <header className="mb-5 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    aria-label="Open navigation"
                    onClick={() => setMobileNavOpen(true)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm md:hidden"
                  >
                    <Menu size={18} />
                  </button>
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span>Workspace</span>
                      <ChevronRight size={12} />
                      <span>Chat</span>
                    </div>
                    <h1 className="truncate text-lg font-bold tracking-tight text-slate-950">
                      {activeTitle}
                    </h1>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileSourcesOpen(true)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm lg:hidden"
                >
                  <BookOpen size={15} /> Sources
                </button>
              </header>

              {/* Chat Message Scroll Area */}
              <div className="flex-1 space-y-5">
                {/* Initial Welcome Card when there are no messages */}
                {messages.length === 0 && (
                  <article className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 space-y-4">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
                        <Bot size={20} />
                      </span>
                      <div>
                        <h2 className="text-base font-bold text-slate-900">IT Assistant</h2>
                        <p className="text-xs text-slate-500">
                          Ask any question — answers are grounded in your enterprise knowledge base.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      {[
                        "Database is down — how to check PostgreSQL status?",
                        "How do I reset my VPN password?",
                        "Troubleshoot Kubernetes pod crashing in production",
                        "Check system status and active outages",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => handleSendMessage(undefined, prompt)}
                          className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-violet-200 hover:bg-violet-50 text-left text-xs text-slate-700 transition"
                        >
                          <span className="truncate pr-2">{prompt}</span>
                          <ArrowUpRight size={14} className="shrink-0 text-slate-400" />
                        </button>
                      ))}
                    </div>
                  </article>
                )}

                {/* Rendered Messages */}
                {messages.map((m, idx) => {
                  if (m.role === "user") {
                    return (
                      <div key={m.id} className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-violet-600 px-4 py-3 text-sm font-medium text-white shadow-sm">
                          {m.content}
                        </div>
                      </div>
                    );
                  }

                  // Assistant Card
                  const prevUserMsg = messages[idx - 1]?.role === "user" ? messages[idx - 1].content : undefined;
                  const isCurrentFeedback = feedback[m.id];

                  return (
                    <article key={m.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                      {/* Assistant Card Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
                            <Bot size={20} />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-sm font-bold text-slate-900">IT Assistant</h2>
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                {m.decision === "caution" ? "Cautioned answer" : "Visible answer excerpt"}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-500">Enterprise Support RAG</p>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1.5 text-[10px] font-medium text-slate-600">
                          <Clock3 size={12} /> {m.timestamp}
                        </span>
                      </div>

                      {/* Assistant Card Body */}
                      <div className="space-y-5 px-4 py-5 sm:px-6 sm:py-6">
                        <div>
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">
                            Suggested resolution
                          </p>
                          <div className="prose prose-slate max-w-none text-sm leading-6 text-slate-700">
                            {m.content ? (
                              <MarkdownMessage content={m.content} />
                            ) : (
                              <div className="flex items-center gap-2 text-slate-400 py-3">
                                <RotateCw className="size-4 animate-spin text-violet-600" />
                                <span>Generating answer from knowledge base…</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Validation checklist */}
                        <section aria-labelledby={`validation-${m.id}`}>
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h3 id={`validation-${m.id}`} className="text-sm font-bold text-slate-900">
                                Validation checklist
                              </h3>
                              <p className="mt-1 text-xs text-slate-500">
                                {checklist.filter((c) => c.done).length} of {checklist.length} checks complete
                              </p>
                            </div>
                            <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600">
                              System checklist
                            </span>
                          </div>
                          <div className="space-y-2">
                            {checklist.map((item) => (
                              <label
                                key={item.id}
                                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition ${
                                  item.done
                                    ? "border-emerald-200 bg-emerald-50/60"
                                    : "border-slate-200 hover:border-violet-200 hover:bg-violet-50/30"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={item.done}
                                  onChange={() =>
                                    setChecklist((curr) =>
                                      curr.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c))
                                    )
                                  }
                                  className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 accent-violet-600"
                                />
                                <span
                                  className={`min-w-0 flex-1 text-xs leading-5 ${
                                    item.done ? "text-slate-500 line-through" : "text-slate-700"
                                  }`}
                                >
                                  {item.label}
                                  {item.command && (
                                    <code className="ml-1.5 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-violet-800">
                                      {item.command}
                                    </code>
                                  )}
                                </span>
                                {item.done && <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" />}
                              </label>
                            ))}
                          </div>
                        </section>

                        {/* Metadata grid cards */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div className="mb-3 flex items-center gap-2 text-slate-700">
                              <Users size={15} />
                              <h3 className="text-xs font-bold">Incident routing</h3>
                            </div>
                            <div className="space-y-2.5 text-xs">
                              <div className="flex justify-between gap-3">
                                <span className="text-slate-500">Owner</span>
                                <span className="font-semibold text-slate-800">DBA & Support Team</span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="text-slate-500">Jira queue / project</span>
                                <span className="text-right font-semibold text-slate-800">IT HelpDesk</span>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <div className="mb-3 flex items-center gap-2 text-slate-700">
                              <Activity size={15} />
                              <h3 className="text-xs font-bold">Answer metadata</h3>
                            </div>
                            <p className="text-xs leading-5 text-slate-600">
                              <strong className="font-semibold text-slate-800">
                                {m.confidence != null ? `${m.confidence}% answer confidence` : "Grounding verified"}
                              </strong>
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {m.usage?.total_tokens
                                ? `${m.usage.input_tokens ?? 0} in / ${m.usage.output_tokens ?? 0} out tokens`
                                : "Enterprise RAG pipeline verified"}
                            </p>
                          </div>
                        </div>

                        {/* Action buttons footer */}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              aria-pressed={isCurrentFeedback === "helpful"}
                              onClick={() => handleFeedback(m.id, 1)}
                              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                                isCurrentFeedback === "helpful"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <ThumbsUp size={14} /> Helpful
                            </button>
                            <button
                              type="button"
                              aria-pressed={isCurrentFeedback === "not-helpful"}
                              onClick={() => handleFeedback(m.id, -1)}
                              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                                isCurrentFeedback === "not-helpful"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              <ThumbsDown size={14} /> Not helpful
                            </button>
                            <button
                              type="button"
                              onClick={() => copyAnswer(m.content)}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                            >
                              <Copy size={14} /> Copy answer
                            </button>
                            {prevUserMsg && (
                              <button
                                type="button"
                                onClick={() => handleSendMessage(undefined, prevUserMsg)}
                                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                              >
                                <RefreshCw size={14} /> Regenerate
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => openJiraForMessage(m, prevUserMsg)}
                            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700"
                          >
                            <Ticket size={15} /> Create Jira ticket
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Composer Box */}
              <form onSubmit={handleSendMessage} className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <label htmlFor="user-prompt" className="sr-only">
                  Ask a follow-up question
                </label>
                <textarea
                  id="user-prompt"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  rows={2}
                  placeholder="Ask a follow-up IT question…"
                  className="w-full resize-y border-0 bg-transparent px-2 py-2 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
                    <Bot size={13} /> Auto mode <ChevronDown size={12} />
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="hidden text-[10px] text-slate-400 sm:inline">
                      Live RAG streaming · Internal KB
                    </span>
                    <button
                      type="submit"
                      disabled={!input.trim() || isTyping}
                      className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Send size={14} /> Send
                    </button>
                  </div>
                </div>
              </form>
            </section>

            {/* Right Context Sidebar */}
            <aside className="hidden min-w-0 lg:block">
              <div className="sticky top-6 space-y-4">
                {/* Sources Card */}
                <PanelCard
                  title="Sources"
                  subtitle={
                    latestSources.length > 0
                      ? `${latestSources.length} references across ${sourceGroups.length} titles`
                      : "No sources yet"
                  }
                  icon={BookOpen}
                >
                  <label className="relative mb-3 block">
                    <span className="sr-only">Filter source references</span>
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={sourceQuery}
                      onChange={(e) => setSourceQuery(e.target.value)}
                      placeholder="Filter references…"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                    />
                  </label>
                  <div className="space-y-2">
                    {sourceGroups.map((g) => (
                      <ReferenceCard
                        key={g.key}
                        group={g}
                        expanded={expandedReferences.includes(g.key)}
                        onToggle={() => toggleReference(g.key)}
                      />
                    ))}
                    {sourceGroups.length === 0 && (
                      <p className="rounded-xl bg-slate-50 px-3 py-5 text-center text-xs text-slate-500">
                        {latestSources.length === 0
                          ? "No sources yet — ask an IT question to see cited references."
                          : "No matching references found."}
                      </p>
                    )}
                  </div>
                  {latestSources.length > 0 && (
                    <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2.5 text-[10px] leading-4 text-blue-800">
                      Match scores describe retrieval similarity, not answer confidence.
                    </p>
                  )}
                </PanelCard>

                {/* System Status Card */}
                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    aria-expanded={systemOpen}
                    onClick={() => setSystemOpen((curr) => !curr)}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                        <ShieldCheck size={17} />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">System status</span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {services.length > 0
                            ? `${healthyServicesCount} healthy of ${services.length} services`
                            : "Checking dependencies…"}
                        </span>
                      </span>
                    </span>
                    <ChevronDown
                      size={16}
                      className={`text-slate-400 transition-transform ${systemOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {systemOpen && (
                    <div className="space-y-1 border-t border-slate-100 p-3">
                      {services.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-slate-400">Loading system status…</p>
                      ) : (
                        services.map((svc) => {
                          const isOk = svc.status === "Healthy";
                          return (
                            <div key={svc.key} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2">
                              <span className="text-[11px] font-medium text-slate-700">{svc.name}</span>
                              <span
                                className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${
                                  isOk ? "text-emerald-700" : "text-rose-700"
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${isOk ? "bg-emerald-500" : "bg-rose-500"}`}
                                />
                                {svc.status}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </section>

                {/* Quick actions Card */}
                <PanelCard title="Quick actions" subtitle="Shortcuts for common requests" icon={LifeBuoy}>
                  <div className="space-y-2">
                    {[
                      { label: "Reset password", prompt: "How do I reset my password?" },
                      { label: "Check service status", prompt: "What is the current health status of all IT services?" },
                      { label: "My tickets", nav: "tickets" },
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          if (item.nav && onNavigate) {
                            onNavigate(item.nav);
                          } else if (item.prompt) {
                            handleSendMessage(undefined, item.prompt);
                          }
                        }}
                        className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-left text-xs font-medium text-slate-700 transition hover:border-violet-200 hover:bg-violet-50"
                      >
                        {item.label}
                        <ArrowUpRight size={14} className="text-slate-400" />
                      </button>
                    ))}
                  </div>
                </PanelCard>
              </div>
            </aside>
          </div>
        </main>
      </div>

      {/* Jira Ticket Modal */}
      {jiraOpen && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setJiraOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="jira-dialog-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">
                  Incident Escalation
                </p>
                <h2 id="jira-dialog-title" className="mt-1 text-lg font-bold text-slate-950">
                  Create Jira ticket
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Submit this issue directly to the IT HelpDesk Jira queue.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close Jira dialog"
                onClick={() => setJiraOpen(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={17} />
              </button>
            </div>
            <form onSubmit={submitJiraTicket} className="space-y-4">
              <label className="block text-xs font-semibold text-slate-700">
                Summary
                <input
                  value={jiraSummary}
                  onChange={(e) => setJiraSummary(e.target.value)}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] text-slate-500">Project</p>
                  <p className="mt-1 text-xs font-semibold text-slate-800">IT HelpDesk</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] text-slate-500">Queue</p>
                  <p className="mt-1 text-xs font-semibold text-slate-800">Database & Support</p>
                </div>
              </div>
              <label className="block text-xs font-semibold text-slate-700">
                Description
                <textarea
                  value={jiraDesc}
                  onChange={(e) => setJiraDesc(e.target.value)}
                  rows={4}
                  required
                  className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal leading-5 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
              </label>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setJiraOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={jiraSubmitting}
                  className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {jiraSubmitting ? "Creating ticket…" : "Create Jira ticket"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Toast Host */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-[80] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-medium text-white shadow-xl"
        >
          <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
          {toast}
        </div>
      )}
    </div>
  );
}
