import {
  MessagesSquare,
  ScrollText,
  AlertTriangle,
  Trash2,
  ArrowUp,
  BarChart3,
  BookOpen,
  Layers,
  LifeBuoy,
  Ticket as TicketIcon,
  Users,
  Bot,
  CheckCircle2,
  Clock3,
  History,
  Link2,
  Menu,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Shield,
  Sparkles,
  Ticket,
  User,
  MessageSquareText,
  Check,
  Pin,
  Pencil,
  MoreHorizontal,
  Zap
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  listApprovals,
  decideApproval,
  uploadAttachment,
  submitFeedback as pushFeedback,
} from "@/features/chat/api";
import { runChatStream } from "@/features/chat/hooks/useChatStream";
import { useNotifications, NotificationBell } from "@/components/NotificationBell";
import {
  type Message,
  type Source,
  type Conv,
  currentTime,
  latestSources,
} from "@/features/chat/model";
import {
  TypingIndicator,
  EmptyChat,
  Row,
} from "@/features/chat/components/chat-parts";
import {
  listConversations,
  getConversationMessages,
  deleteConversation,
  clearConversations,
  renameConversation,
  pinConversation,
} from "@/features/conversations/api";
import { createTicketApi } from "@/features/tickets/api";
import { assignableUsers } from "@/features/users/api";

/* ============================================================
   MAIN COMPONENT
============================================================ */

export default function Chat({
  userName,
  role,
  onNavigate,
  onLogout,
}: {
  userName?: string;
  role?: string;
  onNavigate?: (nav: string) => void;
  onLogout?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [selectedConversation, setSelectedConversation] = useState("");
  const [search, setSearch] = useState("");
  // v0.21.35 — Ctrl+K quick search palette
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingFiles, setPendingFiles] = useState<{ id: string; filename: string; mime: string }[]>([]);
  // B-6 — notification bell data (admin/agent)
  const canManage = role === "admin" || role === "agent";
  const notices = useNotifications(role || "user", !!canManage);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [stage, setStage] = useState("");
  const [approval, setApproval] = useState<{ id: string; question: string } | null>(null);
  // v0.21.72 — admin polls the approval queue so requests from OTHER users surface too
  useEffect(() => {
    if (role !== "admin") return;
    let alive = true;
    async function poll() {
      try {
        const d = await listApprovals();
        if (!alive) return;
        const pending = (d.approvals ?? []).find((a: any) => a.status === "pending");
        if (pending) setApproval((cur) => cur ?? { id: pending.id, question: pending.question });
      } catch { /* ignore transient */ }
    }
    poll();
    const iv = setInterval(() => { if (!approvalRef.current) poll(); }, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, [role]);
  // approval read through a ref inside the poll interval (effect deps stay [role])
  const approvalRef = useRef(approval);
  approvalRef.current = approval;
  const [showSources] = useState(true);
  const [mobileHistory, setMobileHistory] = useState(false);

  const sessionRef = useRef<string>(crypto.randomUUID());
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* ----------------------------------------------------------
      LOAD CONVERSATIONS
  ---------------------------------------------------------- */

  function refreshConversations() {
    listConversations()
      .then((r: any) => setConversations(r?.conversations ?? []))
      .catch(() => setConversations([]));
  }

  useEffect(() => {
    refreshConversations();
  }, []);

  /* ----------------------------------------------------------
      AUTO SCROLL
  ---------------------------------------------------------- */

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  /* ----------------------------------------------------------
      OPEN A PAST CONVERSATION
  ---------------------------------------------------------- */

  // v0.21.35 — global Ctrl+K / Cmd+K to open the search palette
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function openConversation(id: string) {
    setSelectedConversation(id);
    sessionRef.current = id;
    setMobileHistory(false);
    try {
      const r: any = await getConversationMessages(id);
      const list: Message[] = (r.messages ?? []).map((m: any, i: number) => ({
        id: `${id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        confidence: m.meta?.confidence != null ? Math.round(m.meta.confidence * 100) : undefined,
        decision: m.meta?.decision,
        topK: m.meta?.top_k,
        usage: m.meta?.usage,
        latencyMs: m.meta?.latency_ms,
        sources: (m.meta?.hits ?? []).map((h: any) => ({
          page_id: h.page_id ?? null,
          title: h.title ?? "Untitled",
          space: h.domain ?? "KB",
          relevance: h.relevance != null ? Math.round(h.relevance * 100)
            : h.distance != null ? Math.round((1 - h.distance) * 100)
            : null as unknown as number,
          excerpt: (h.content ?? h.snippet ?? "").slice(0, 180),
          url: h.source_url ?? null,
        })),
      }));
      setMessages(list);
      historyRef.current = list.map((m) => ({ role: m.role, content: m.content }));
    } catch {
      setMessages([]);
    }
  }

  async function removeConversation(id: string) {
    if (!window.confirm("Delete this conversation?")) return;
    try {
      await deleteConversation(id);
      setConversations((prev) => (prev ?? []).filter((x) => x.session_id !== id));
      if (selectedConversation === id) {
        newChat();
      }
    } catch {
      // ignore — item stays
    }
  }

  /* ----------------------------------------------------------
      SEND (streaming)
  ---------------------------------------------------------- */

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const question = input.trim();
    if (!question || isTyping) return;

    // v0.21.36 — append attachment links to the outgoing message
    let content = question;
    if (pendingFiles.length > 0) {
      const links = pendingFiles
        .map((f) => (f.mime.startsWith("image/")
          ? `![${f.filename}](/api/attachments/${f.id})`
          : `[📄 ${f.filename}](/api/attachments/${f.id})`))
        .join(" ");
      content = `${question}\n\n${links}`;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: currentTime(),
    };
    setMessages((prev) => [...prev, userMessage]);
    historyRef.current = [...historyRef.current, { role: "user", content }];
    setPendingFiles([]);
    setInput("");
    setIsTyping(true);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", timestamp: currentTime() },
    ]);

    try {
      const streamed = await runChatStream(
        question,
        sessionRef.current,
        historyRef.current.slice(0, -1),
        {
          onMeta: (meta) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      confidence: meta.confidence != null ? Math.round(meta.confidence * 100) : undefined,
                      decision: meta.decision,
                      topK: meta.top_k,
                      sources: (meta.hits ?? []).map((h: any) => ({
                        page_id: h.page_id ?? null,
                        title: h.title ?? "Untitled",
                        space: h.domain ?? "KB",
                        relevance: h.relevance != null ? Math.round(h.relevance * 100)
                          : h.distance != null ? Math.round((1 - h.distance) * 100)
                          : null,
                        excerpt: (h.content ?? "").slice(0, 180),
                        url: h.source_url ?? null,
                      })),
                    }
                  : m,
              ),
            ),
          onToken: (token) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m)),
            ),
          onStage: (detail) => setStage(detail),
          onApprovalRequest: (data) => {
            setStage("");
            setApproval({ id: data.approval_id, question: data.question });
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + "⏸️ **Escalation needs administrator approval.**" } : m));
          },
          onDone: (d) => {
            setStage("");
            if (d.usage || d.latency_ms || d.message_id) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, usage: d.usage ?? m.usage, latencyMs: d.latency_ms ?? m.latencyMs, serverId: d.message_id ?? m.serverId }
                    : m,
                ),
              );
            }
          },
        },
      );
      historyRef.current = [
        ...historyRef.current,
        { role: "assistant", content: streamed },
      ];
      refreshConversations();
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: m.content || "⚠️ Connection error — please try again." }
            : m,
        ),
      );
    } finally {
      setIsTyping(false);
      setStage("");
    }
  }

  /* ----------------------------------------------------------
      NEW CHAT
  ---------------------------------------------------------- */

  function newChat() {
    setMessages([]);
    setInput("");
    setSelectedConversation("");
    sessionRef.current = crypto.randomUUID();
    historyRef.current = [];
    setMobileHistory(false);
  }

  /* ----------------------------------------------------------
      ESCALATE → /api/escalate
  ---------------------------------------------------------- */

  // v0.21.90 — prefill ticket dialog (instead of silent auto-create on click)
  const [ticketForm, setTicketForm] = useState<null | {
    subject: string; description: string; domain: string; priority: string;
    assignee: string; due_date: string;
  }>(null);
  const [ticketBusy, setTicketBusy] = useState(false);
  // v0.21.98 — chat create-ticket mirrors the Tickets page form (native /api/tickets)
  type AssignableUser = { username: string; email: string | null; role: string };
  const [assignable, setAssignable] = useState<AssignableUser[]>([]);
  const [chatNote, setChatNote] = useState<string | null>(null);
  function chatAlert(msg: string, kind?: string) {
    setChatNote(kind === "err" ? `⚠️ ${msg}` : `ℹ️ ${msg}`);
    window.setTimeout(() => setChatNote(null), 3200);
  }

  function submitFeedback(message: Message, rating: 1 | -1) {
    const target = message.serverId;
    if (!target) { chatAlert("Answer not saved yet — feedback unavailable", "err"); return; }
    const next = message.feedback === rating ? 0 : rating;
    pushFeedback(target, next, undefined)
      .then(() => {
        setMessages((prev) => prev.map((m) => m.id === message.id ? { ...m, feedback: (next === 0 ? undefined : next) as 1 | -1 | undefined } : m));
        chatAlert(next === 0 ? "Feedback cleared" : next === 1 ? "Thanks — marked helpful" : "Thanks — we'll improve this answer");
      })
      .catch(() => chatAlert("Feedback failed", "err"));
  }

  function openTicketForm(message: Message) {
    const question = messages.filter((m) => m.role === "user").slice(-1)[0]?.content || "";
    setTicketForm({
      subject: question.slice(0, 110) || "IT help escalation",
      description:
        `Raised from chat with the IT Help assistant.\n\nQuestion: ${question}\n\nAnswer summary: ${(message.content || "").slice(0, 500)}`,
      domain: "general",
      priority: "medium",
      assignee: "",
      due_date: "",
    });
    // v0.21.98 — assignable users (same list as Tickets page)
    assignableUsers()
      .then((d) => setAssignable(d?.users ?? []))
      .catch(() => setAssignable([]));
  }

  async function submitTicketForm() {
    if (!ticketForm || !ticketForm.subject.trim()) return;
    setTicketBusy(true);
    try {
      // v0.21.98 — same native path as Tickets page "Create support ticket"
      const created = await createTicketApi({
        subject: ticketForm.subject,
        description: ticketForm.description,
        domain: ticketForm.domain,
        priority: ticketForm.priority,
        assignee: ticketForm.assignee || null,
        due_date: ticketForm.due_date || null,
      });
      chatAlert(`Ticket ${created?.jira_key ?? created?.id ?? ""} created successfully`);
      setTicketForm(null);
    } catch {
      chatAlert("Ticket creation failed", "err");
    } finally {
      setTicketBusy(false);
    }
  }



  /* ----------------------------------------------------------
      FILTER HISTORY
  ---------------------------------------------------------- */

  const filteredConversations = conversations.filter((c) => {
    const q = search.toLowerCase();
    const title = (c.title ?? c.session_id).toLowerCase();
    return !q || title.includes(q);
  });

  /* ----------------------------------------------------------
      RENDER
  ---------------------------------------------------------- */

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {mobileHistory && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setMobileHistory(false)} />
      )}

      {/* ================= HISTORY SIDEBAR ================= */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-[250px] flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] transition-transform lg:static lg:z-auto lg:translate-x-0",
          mobileHistory ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        {/* Brand — matches PageSidebar (B-6: notification bell for admin/agent) */}
        <div className="flex h-16 items-center gap-3 border-b border-[var(--sidebar-border)] px-5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-600 text-xs font-bold text-white">iTH</div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">IT Help Chatbot</div>
            <div className="text-[10px] text-muted-foreground">Enterprise Assistant</div>
          </div>
          {(role === "admin" || role === "agent") && (
            <div className="ml-auto mr-1">
              <NotificationBell notices={notices} onOpen={(n) => onNavigate?.(n)} />
            </div>
          )}
        </div>

        {/* User profile card — matches PageSidebar */}


        {/* New conversation */}
        <div className="p-3">
          <button
            onClick={newChat}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="size-4" />
            New conversation
          </button>
        </div>

        {/* Search (click or Ctrl+K to open palette) */}
        <div className="px-3">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-[var(--sidebar-border)] bg-[var(--sidebar-hover)] px-3 text-left text-[var(--sidebar-text)] transition hover:bg-[var(--sidebar-active-bg)]"
          >
            <Search className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">Search conversations...</span>
            <kbd className="hidden shrink-0 rounded border border-[var(--sidebar-border)] bg-[var(--sidebar-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--sidebar-text-muted)] sm:inline">
              Ctrl K
            </kbd>
          </button>
        </div>

        {/* Conversation history */}
        <div className="mt-3 flex-1 overflow-y-auto px-2">
          <div className="flex items-center justify-between px-2 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sidebar-text-muted)]">
              Recent conversations
            </span>
            {(conversations ?? []).length > 0 && (
              <button
                onClick={async () => {
                  if (!window.confirm("Delete ALL conversations? This cannot be undone.")) return;
                  try {
                    await clearConversations();
                    setConversations([]);
                    newChat();
                  } catch { /* ignore */ }
                }}
                title="Clear all conversations"
                className="rounded p-1 text-muted-foreground transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
          {filteredConversations.map((c) => (
            <div key={c.session_id} className="group relative mb-1">
              <button
                onClick={() => openConversation(c.session_id)}
                className={[
                  "w-full rounded-lg px-3 py-2.5 pr-8 text-left transition",
                  selectedConversation === c.session_id
                    ? "bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
                    : "hover:bg-[var(--sidebar-hover)]",
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  {c.is_pinned && <Pin className="size-3 shrink-0 rotate-45 text-blue-600 dark:text-blue-400" />}
                  <MessageSquare
                    className={[
                      "size-4 shrink-0",
                      selectedConversation === c.session_id ? "text-blue-600" : "text-muted-foreground",
                    ].join(" ")}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                    {c.title || c.session_id.slice(0, 18)}
                  </span>
                </div>
              </button>
              {/* v0.21.41 — "..." menu anchored to the row (sibling, not nested) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Conversation menu"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-2 top-2 hidden rounded-md p-1 text-[var(--sidebar-text-muted)] transition hover:bg-[var(--sidebar-active-bg)] hover:text-[var(--sidebar-active-text)] group-hover:block"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={2} collisionPadding={8} avoidCollisions side="bottom">
                  <DropdownMenuItem
                    onClick={() => pinConversation(c.session_id, !c.is_pinned).then(refreshConversations)}
                  >
                    <Pin className="size-3.5" /> {c.is_pinned ? "Unpin" : "Pin"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => { setRenameTarget({ id: c.session_id, title: c.title || "" }); setRenameValue(c.title || ""); }}
                  >
                    <Pencil className="size-3.5" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => removeConversation(c.session_id)}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>

        {/* Page navigation — matches PageSidebar items */}
        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="grid grid-cols-1 gap-0.5">
            {[
              { id: "dashboard", label: "Dashboard", icon: <BarChart3 className="size-4" /> },
              { id: "articles", label: "Knowledge", icon: <BookOpen className="size-4" /> },
              { id: "tickets", label: "Tickets", icon: <TicketIcon className="size-4" /> },
              { id: "domains", label: "Domains", icon: <Layers className="size-4" /> },
              { id: "users", label: "Users", icon: <Users className="size-4" /> },
              { id: "history", label: "Conversations", icon: <MessagesSquare className="size-4" /> },
              { id: "audits", label: "Audit Log", icon: <ScrollText className="size-4" /> },
              { id: "settings", label: "Settings", icon: <LifeBuoy className="size-4" /> },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => onNavigate?.(item.id)}
                className="mb-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium text-[var(--sidebar-text)] transition text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Profile + sign out — bottom, matches PageSidebar */}
        <div className="border-t border-[var(--sidebar-border)] px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-[var(--sidebar-active-bg)] text-sm font-semibold text-[var(--sidebar-active-text)]">
              {(userName?.charAt(0) ?? "A").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-[var(--sidebar-text)]">{userName ?? "User"}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--sidebar-text-muted)]">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                online
              </div>
            </div>
            <button
              onClick={() => onLogout?.()}
              title="Sign out"
              className="flex items-center gap-1.5 rounded-lg border border-[var(--sidebar-border)] px-2.5 py-2 text-[10px] font-medium text-[var(--sidebar-text)] transition hover:border-red-400/40 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-red-900 dark:hover:bg-red-950/30 dark:hover:text-red-300"
            >
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* ================= MAIN CHAT ================= */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center justify-between border-b border-[var(--border)] bg-[var(--topbar-bg)] px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setMobileHistory(true)}>
              <Menu className="size-5" />
            </button>
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-chip)] text-sky-300 shadow-sm">
              <Bot className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">IT Knowledge Assistant</h1>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-muted-foreground">Online</span>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="hidden text-[10px] text-muted-foreground sm:block">
                  Hybrid RAG + rerank
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-[10px] sm:flex">
              <Shield className="size-3.5 text-emerald-600" />
              RBAC protected
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1000px] px-4 py-6 lg:px-8">
            {messages.length === 0 ? (
              <EmptyChat onSuggestion={(q) => { setInput(q); }} />
            ) : (
              <div className="space-y-7">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    busy={isTyping}
                    onHelpful={() => submitFeedback(m, 1)}
                    onNotHelpful={() => submitFeedback(m, -1)}
                    onOpenTicketForm={() => openTicketForm(m)}
                    />
                ))}
                {isTyping && <TypingIndicator stage={stage} />}
                {chatNote && (
                  <div className="mx-auto w-fit rounded-full border bg-white px-3 py-1.5 text-[10px] font-medium shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    {chatNote}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* v0.21.70 — admin escalation approval banner */}
        {role === "admin" && approval && (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                  Escalation approval requested
                </div>
                <div className="truncate text-[10px] text-amber-700 dark:text-amber-300">
                  {approval.question}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={async () => {
                    const d = await decideApproval(approval.id, "approved");
                    setMessages((prev) => prev.map((m) =>
                      m.id === approval.id
                        ? { ...m, content: m.content + `\n\n✅ **Approved** — ${d.ticket_id ? `Ticket ${d.ticket_id} created. ` : ""}${(d.messages ?? []).join(" ")}` }
                        : m));
                    setApproval(null);
                  }}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-[10px] font-semibold text-white hover:bg-emerald-500"
                >
                  Approve & escalate
                </button>
                <button
                  onClick={async () => {
                    const d = await decideApproval(approval.id, "rejected");
                    setMessages((prev) => prev.map((m) =>
                      m.id === approval.id
                        ? { ...m, content: m.content + `\n\n❌ **Rejected** — ${(d.messages ?? ["Ticket creation was rejected by the administrator."]).join(" ")}` }
                        : m));
                    setApproval(null);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-[var(--border)] bg-[var(--topbar-bg)]">
          <div className="mx-auto max-w-[1000px] px-4 py-4 lg:px-8">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Sparkles className="size-3 text-blue-500" />
                Answers are grounded in your internal knowledge base.
              </div>
            </div>

            <form onSubmit={sendMessage} className="relative">
              {pendingFiles.length > 0 && (
                  <div className="flex w-full flex-wrap gap-2 px-1 pb-2">
                    {pendingFiles.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-2 py-1 text-[10px]">
                        {f.mime.startsWith("image/") ? "🖼️" : "📄"} {f.filename}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-red-500"
                          onClick={() => setPendingFiles((p) => p.filter((x) => x.id !== f.id))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-end rounded-2xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-sm transition focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 dark:bg-slate-950 dark:focus-within:ring-blue-950">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="mb-0.5 rounded-xl p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  title="Attach file or image"
                >
                  <Paperclip className="size-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.md,.doc,.docx,.xlsx,.csv"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setUploading(true);
                    try {
                      const res = await uploadAttachment(f, sessionRef.current);
                      setPendingFiles((p) => [...p, res]);
                    } catch (err: any) {
                      console.warn("upload failed:", err?.message);
                    } finally {
                      setUploading(false);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }
                  }}
                />
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={1}
                  placeholder="Ask an IT question..."
                  className="max-h-32 min-h-[42px] flex-1 resize-none bg-transparent px-2 py-2.5 text-xs outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isTyping}
                  className="mb-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </form>

            <div className="mt-2 text-center text-[10px] text-muted-foreground">
              AI-generated answers may require verification. Sensitive information is protected by RBAC.
            </div>
          </div>
        </div>
      </main>

      {/* ================= RIGHT SOURCE PANEL ================= */}
      {showSources && messages.length > 0 && (
        <aside className="hidden w-[300px] shrink-0 border-l border-[var(--border)] bg-[var(--card)] xl:flex xl:flex-col">
          <div className="flex h-16 items-center justify-between border-b px-5">
            <div>
              <h2 className="text-sm font-semibold">Knowledge sources</h2>
              <p className="text-[10px] text-muted-foreground">Retrieved for this conversation</p>
            </div>
            <Link2 className="size-4 text-muted-foreground" />
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {latestSources(messages).map((source, index) => (
              <SourceCard key={`${source.page_id}-${index}`} source={source} index={index + 1} />
            ))}
          </div>
          <div className="border-t p-4">
            <div className="rounded-xl bg-[var(--muted)] p-3">
              <div className="flex items-center gap-2">
                <History className="size-3.5 text-blue-500" />
                <span className="text-[10px] font-semibold">Retrieval information</span>
              </div>
              <div className="mt-3 space-y-2 text-[10px] text-muted-foreground">
                <Row label="Chunks retrieved" value={String(latestSources(messages).length || 0)} />
                <Row label="Sources used" value={String(latestSources(messages).length || 0)} />
                <Row label="Search type" value="Hybrid + rerank" />
                <Row label="ACL filtering" value="Enabled" good />
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* v0.21.38 — rename conversation dialog */}
{/* ---------- create-ticket prefill dialog (v0.21.90) ---------- */}
        {ticketForm && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
            onClick={() => setTicketForm(null)}
          >
            <div
              className="w-full max-w-lg rounded-2xl bg-[var(--card)] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b px-5 py-4 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300">
                    <TicketIcon className="size-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Create support ticket</h2>
                    <p className="text-[10px] text-muted-foreground">
                      Prefilled from this chat — edit the details before submitting
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setTicketForm(null)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Trash2 className="size-4 opacity-0" />
                  <span className="text-xs">✕</span>
                </button>
              </div>

              <div className="space-y-4 p-5">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Subject
                  </label>
                  <input
                    value={ticketForm.subject}
                    onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })}
                    className="h-10 w-full rounded-xl border bg-white px-3 text-xs outline-none focus:border-orange-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Description
                  </label>
                  <textarea
                    rows={5}
                    value={ticketForm.description}
                    onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })}
                    className="w-full resize-none rounded-xl border bg-white px-3 py-2.5 text-xs outline-none focus:border-orange-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Category
                    </label>
                    <select
                      value={ticketForm.domain}
                      onChange={(e) => setTicketForm({ ...ticketForm, domain: e.target.value })}
                      className="h-10 w-full rounded-xl border bg-white px-3 text-xs outline-none dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="general">General</option>
                      <option value="network">Network</option>
                      <option value="database">Database</option>
                      <option value="kubernetes">Kubernetes</option>
                      <option value="security">Security</option>
                      <option value="server">Server</option>
                      <option value="storage">Storage</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Priority
                    </label>
                    <select
                      value={ticketForm.priority}
                      onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value })}
                      className="h-10 w-full rounded-xl border bg-white px-3 text-xs outline-none dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>
                {/* v0.21.98 — Assignee + Due date (same as Tickets page form) */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Assignee
                    </label>
                    <select
                      value={ticketForm.assignee}
                      onChange={(e) => setTicketForm({ ...ticketForm, assignee: e.target.value })}
                      className="h-10 w-full rounded-xl border bg-white px-3 text-xs outline-none dark:border-slate-700 dark:bg-slate-950"
                    >
                      <option value="">Unassigned</option>
                      {assignable.map((u) => (
                        <option key={u.username} value={u.username}>
                          {u.username}{u.role === "admin" ? " (admin)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Due date
                    </label>
                    <input
                      type="date"
                      value={ticketForm.due_date}
                      onChange={(e) => setTicketForm({ ...ticketForm, due_date: e.target.value })}
                      className="h-10 w-full rounded-xl border bg-white px-3 text-xs outline-none dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t px-5 py-4 dark:border-slate-800">
                <button
                  onClick={() => setTicketForm(null)}
                  className="rounded-xl border px-4 py-2.5 text-[11px] font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={submitTicketForm}
                  disabled={ticketBusy || !ticketForm.subject.trim()}
                  className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-orange-500 disabled:opacity-50"
                >
                  <TicketIcon className="size-3.5" />
                  {ticketBusy ? "Creating…" : "Create ticket"}
                </button>
              </div>
            </div>
          </div>
        )}

              {renameTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="mx-4 w-full max-w-[400px] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <Pencil className="size-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-semibold">Rename conversation</span>
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && renameTarget) {
                  await renameConversation(renameTarget.id, renameValue);
                  setRenameTarget(null);
                  refreshConversations();
                }
              }}
              className="mb-4 h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800"
              placeholder="Conversation title"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenameTarget(null)}
                className="rounded-lg border px-3 py-2 text-xs font-medium transition hover:bg-muted dark:border-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (renameTarget) {
                    await renameConversation(renameTarget.id, renameValue);
                    setRenameTarget(null);
                    refreshConversations();
                  }
                }}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {/* v0.21.35 — Ctrl+K conversation palette */}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="mx-4 w-full max-w-[560px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b px-4 py-3 dark:border-slate-700">
              <Search className="size-4 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && filteredConversations.length > 0) {
                    openConversation(filteredConversations[0].session_id);
                    setPaletteOpen(false);
                  }
                }}
                placeholder="Search conversations..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="shrink-0 rounded border bg-slate-50 px-1.5 py-0.5 text-[10px] text-muted-foreground dark:border-slate-600 dark:bg-slate-800">
                Esc
              </kbd>
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-2">
              {filteredConversations.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No conversations found
                </div>
              ) : (
                filteredConversations.map((c) => (
                  <button
                    key={c.session_id}
                    onClick={() => { openConversation(c.session_id); setPaletteOpen(false); }}
                    className={[
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                      selectedConversation === c.session_id
                        ? "bg-blue-50 dark:bg-blue-950/40"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800",
                    ].join(" ")}
                  >
                    <MessageSquareText className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {c.title || "New conversation"}
                    </span>
                    {selectedConversation === c.session_id && (
                      <Check className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                    )}
                  </button>
                ))
              )}
            </div>
            <div className="border-t px-4 py-2 text-[10px] text-muted-foreground dark:border-slate-700">
              Enter open · Esc close
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   MESSAGE BUBBLE
============================================================ */

function MessageBubble({
  message,
  onHelpful,
  onNotHelpful,
  onOpenTicketForm,
  busy = false,
}: {
  message: Message;
  onHelpful: () => void;
  onNotHelpful: () => void;
  onOpenTicketForm: () => void;
  busy?: boolean;
}) {
  const isUser = message.role === "user";
  const caution = message.decision === "caution";

  return (
    <div className={["flex gap-3", isUser ? "justify-end" : "justify-start"].join(" ")}>
      {!isUser && (
        <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
          <Bot className="size-4" />
        </div>
      )}

      <div className={["min-w-0", isUser ? "max-w-[80%]" : "max-w-[88%]"].join(" ")}>
        <div
          className={[
            "rounded-2xl px-4 py-3 text-xs leading-6",
            isUser
              ? "rounded-br-md bg-blue-600 text-white"
              : "rounded-bl-md border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] shadow-sm",
          ].join(" ")}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{message.content || "..."}</div>
          ) : (
            <div className="md text-[11px] leading-6 [&_code]:rounded [&_code]:bg-[var(--muted)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[10px] dark:[&_code]:bg-slate-800 [&_h1]:mt-3 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-[11px] [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_p]:my-1.5 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:text-[11px] [&_th]:border [&_th]:border-[var(--border)] [&_th]:bg-[var(--muted)] [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-[var(--border)] [&_td]:px-2.5 [&_td]:py-1.5 [&_tbody_tr:nth-child(even)]:bg-[color:var(--muted)]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content || "..."}
              </ReactMarkdown>
            </div>
          )}

          {/* v0.21.74 — inline sources removed (right sidebar "Knowledge sources" shows them) */}
        </div>

        <div
          className={[
            "mt-2 flex flex-wrap items-center gap-2",
            isUser ? "justify-end" : "justify-start",
          ].join(" ")}
        >
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock3 className="size-3" />
            {message.timestamp}
          </span>
          {!isUser && message.confidence != null && (
            <ConfidenceBadge confidence={message.confidence} />
          )}
          {!isUser && (message.usage?.input_tokens != null || message.usage?.output_tokens != null) && (
            <span
              className="flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]"
              title={message.latencyMs ? `Generated in ${(message.latencyMs / 1000).toFixed(1)}s` : undefined}
            >
              <Zap className="size-3 text-amber-500" />
              {message.usage?.input_tokens ?? 0} in · {message.usage?.output_tokens ?? 0} out
              {(message.usage?.input_tokens || message.usage?.output_tokens) ? ` = ${((message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0)).toLocaleString()} tokens` : ""}
              {message.latencyMs ? <span className="text-slate-400 dark:text-slate-500">· {(message.latencyMs / 1000).toFixed(0)}s</span> : null}
            </span>
          )}
          {!isUser && caution && (
            <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="size-3" />
              caution — verify before proceeding
            </span>
          )}
        </div>

        {!isUser && message.content && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => onHelpful()}
              disabled={busy}
              title={message.serverId ? "Record feedback" : "Answer not saved yet"}
              className={[
                "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-medium transition",
                message.feedback === 1
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "hover:bg-muted",
              ].join(" ")}
            >
              <CheckCircle2 className="size-3.5 text-emerald-500" />
              Helpful{message.feedback === 1 ? " ✓" : ""}
            </button>
            <button
              onClick={() => onNotHelpful()}
              disabled={busy}
              title={message.serverId ? "Record feedback" : "Answer not saved yet"}
              className={[
                "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[10px] font-medium transition",
                message.feedback === -1
                  ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300"
                  : "hover:bg-muted",
              ].join(" ")}
            >
              <AlertTriangle className="size-3.5 text-orange-500" />
              Not helpful{message.feedback === -1 ? " ✓" : ""}
            </button>
            <button
              onClick={onOpenTicketForm}
              className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[10px] font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300"
            >
              <Ticket className="size-3.5" />
              Create ticket
            </button>
          </div>
        )}
      </div>

      {isUser && (
        <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)]">
          <User className="size-4" />
        </div>
      )}
    </div>
  );
}

/* ============================================================
   CONFIDENCE / SOURCES
============================================================ */

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const high = confidence >= 85;
  const medium = confidence >= 70 && confidence < 85;
  return (
    <span
      className={[
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        high
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
          : medium
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-red-200 bg-red-50 text-red-700",
      ].join(" ")}
    >
      <span
        className={[
          "size-1.5 rounded-full",
          high ? "bg-emerald-500" : medium ? "bg-amber-500" : "bg-red-500",
        ].join(" ")}
      />
      {confidence}% confidence
    </span>
  );
}

function SourceCard({ source, index }: { source: Source; index: number }) {
  const body = (
    <>
      <div className="flex items-start gap-3">
        <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-[10px] font-semibold text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
          {index}
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[10px] font-semibold">{source.title}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">{source.space}</div>
        </div>
      </div>
      {source.relevance == null ? (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Type</span>
          <span className="text-[10px] font-semibold text-blue-600">Ticket</span>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Relevance</span>
          <span className="text-[10px] font-semibold text-emerald-600">{source.relevance}%</span>
        </div>
      )}
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${source.relevance}%` }} />
      </div>
      <p className="mt-3 line-clamp-3 text-[10px] leading-4 text-muted-foreground">{source.excerpt}</p>
    </>
  );
  return source.url ? (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className="mb-3 block w-full rounded-xl border bg-white p-3 text-left transition hover:border-blue-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      {body}
    </a>
  ) : (
    <div className="mb-3 w-full rounded-xl border bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      {body}
    </div>
  );
}
