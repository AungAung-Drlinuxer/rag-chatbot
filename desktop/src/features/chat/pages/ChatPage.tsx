import {
  AlertTriangle,
  BarChart3,
  Trash2,
  ArrowUp,
  Bot,
  CheckCircle2,
  Clock3,
  History,
  Link2,
  Menu,
  Paperclip,
  Ticket as TicketIcon,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
  Ticket,
  User,
  MessageSquareText,
  Check,
  ExternalLink,
  Pencil,
  RotateCcw,
  Copy,
  Share2,
  Zap
} from "lucide-react";

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
  grafanaPanelChoices,
  grafanaPanelData,
  type GrafanaPanelChoice,
} from "@/features/chat/api";
import { runChatStream } from "@/features/chat/hooks/useChatStream";
import {
  type Message,
  type Source,
  type Conv,
  currentTime,
  latestSources,
} from "@/features/chat/model";
import {
  EmptyChat,
  Row,
} from "@/features/chat/components/chat-parts";
import {
  listConversations,
  getConversationMessages,
  renameConversation,
} from "@/features/conversations/api";
import { createTicketApi } from "@/features/tickets/api";
import { assignableUsers } from "@/features/users/api";

/* ============================================================
   MAIN COMPONENT
============================================================ */

export default function Chat({
  userName: _userName,
  role,
  displayRole: _displayRole,
  perms: _perms,
  onNavigate: _onNavigate,
  onLogout: _onLogout,
}: {
  userName?: string;
  role?: string;
  displayRole?: string;
  perms?: Record<string, boolean>;
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
      .then((d) => setConversations(d?.conversations ?? []))
      .catch(() => setConversations([]));
  }

  useEffect(() => {
    refreshConversations();
    const handleOpen = (e: any) => {
      const id = e?.detail;
      if (id) openConversation(id);
    };
    const handleNew = () => {
      newChat();
    };
    window.addEventListener("ith:open-conversation", handleOpen);
    window.addEventListener("ith:new-chat", handleNew);

    // If navigated with hash #/chat and was already on chat, treat as new chat trigger if event requested
    return () => {
      window.removeEventListener("ith:open-conversation", handleOpen);
      window.removeEventListener("ith:new-chat", handleNew);
    };
  }, []);

  /* ----------------------------------------------------------
      AUTO SCROLL
  ---------------------------------------------------------- */

  const messagesContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
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
        serverId: m.message_id || undefined,  // feedback target (v0.21.90)
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
    setPendingFiles([]);
    setInput("");

    const assistantId = crypto.randomUUID();

    // v1.3.4 — GRAFANA SELECT-FLOW pre-check: if the question matches dashboard
    // panels, show a selectable popup instead of the KB pipeline.
    try {
      const { choices } = await grafanaPanelChoices(question);
      if (choices.length > 0) {
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", timestamp: currentTime() }]);
        setPendingChoices({ forMessageId: assistantId, question, choices });
        return; // wait for the user to pick a panel
      }
    } catch { /* not configured or error — fall through to normal pipeline */ }

    setMessages((prev) => [...prev, userMessage]);
    historyRef.current = [...historyRef.current, { role: "user", content }];
    setIsTyping(true);
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
          onToken: (token) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m))
            );
          },
          onStage: (detail) => setStage(detail),
          onApprovalRequest: (data) => {
            setStage("");
            setApproval({ id: data.approval_id, question: data.question });
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + "⏸️ **Escalation needs administrator approval.**" } : m));
          },
          onCaution: (data) => {
            // v1.1.4 guardrail: blocked messages already have the policy text
            // injected via onToken; tag the message so the renderer shows a
            // security notice instead of the "No answer" fallback.
            if (data?.blocked) {
              setMessages((prev) => prev.map((m) =>
                m.id === assistantId
                  ? { ...m, guardrail: data.type ?? "blocked" }
                  : m));
            }
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
      window.dispatchEvent(new CustomEvent("ith:refresh-conversations", { detail: sessionRef.current }));
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
      GRAFANA SELECT-FLOW (v1.3.4)
      User asks a dashboard question → backend matches candidate
      panels → frontend shows a selectable popup → user picks →
      live data fetched → LLM generates the final narrative.
  ---------------------------------------------------------- */
  const [pendingChoices, setPendingChoices] = useState<null | {
    forMessageId: string;
    question: string;
    choices: GrafanaPanelChoice[];
  }>(null);
  const [choiceBusy, setChoiceBusy] = useState(false);

  async function handleGrafanaPick(choice: GrafanaPanelChoice) {
    if (!pendingChoices || choiceBusy) return;
    setChoiceBusy(true);
    const assistantId = pendingChoices.forMessageId;
    try {
      // 1) fetch the live data for the selected panel
      const data = await grafanaPanelData(choice);

      // 2) render the data table into the assistant message
      const table = [
        `**${data.panel_title}**  _(from: ${data.dashboard_title})_`,
        "",
        "| Series | Value |",
        "|---|---|",
        ...data.rows.map((row: any) => {
          const label = Object.entries(row.labels || {})
            .map(([k, v]) => `${k}=${v}`)
            .join(", ") || "(value)";
          return `| ${label} | ${Number(row.value).toLocaleString(undefined, { maximumFractionDigits: 2 })} |`;
        }),
      ].join("\n");

      setMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, content: table } : m));

      // 3) push the data through the LLM for the final narrative summary
      //    (append a follow-up streaming message with the data as context)
      const summaryId = crypto.randomUUID();
      setMessages((prev) => [...prev, { id: summaryId, role: "assistant", content: "", timestamp: currentTime() }]);
      setIsTyping(true);
      setStage("Generating answer from live data…");
      try {
        const streamed = await runChatStream(
          `Based on this live monitoring data, answer the user's question: "${pendingChoices.question}". Data from Grafana panel "${data.panel_title}" (dashboard: ${data.dashboard_title}): ${table}. Summarize the key findings in plain language, mention exact values, and flag anything unusual.`,
          sessionRef.current,
          historyRef.current.slice(0, -1),
          {
            onMeta: () => {},
            onToken: (token) => {
              setMessages((prev) =>
                prev.map((m) => (m.id === summaryId ? { ...m, content: m.content + token } : m)));
            },
            onStage: (detail) => setStage(detail),
            onApprovalRequest: () => {},
            onCaution: () => {},
            onDone: () => setStage(""),
          },
        );
        historyRef.current = [...historyRef.current, { role: "assistant", content: streamed }];
      } catch {
        setMessages((prev) => prev.map((m) =>
          m.id === summaryId ? { ...m, content: m.content || "_(LLM summary unavailable — data table above is the live answer.)_" } : m));
      } finally {
        setIsTyping(false);
        setStage("");
      }
    } catch (e: any) {
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, content: `⚠️ ${e?.message || "Panel data fetch failed"}` } : m));
    } finally {
      setPendingChoices(null);
      setChoiceBusy(false);
    }
  }

  /* ----------------------------------------------------------
      RETRY — re-run a previous user turn (v1.1.2)
      Trims messages after the chosen user turn (both the user
      turn and its assistant answer) and resends the question.
  ---------------------------------------------------------- */
  function retryFromMessage(target: Message) {
    if (isTyping || target.role !== "user") return;
    const idx = messages.findIndex((m) => m.id === target.id);
    if (idx < 0) return;
    const question = target.content.trim();
    if (!question) return;

    // Drop everything from this user turn onward (it + its answer),
    // then resend exactly like a fresh send.
    const kept = messages.slice(0, idx);
    setMessages(kept);
    historyRef.current = kept
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    // Reuse the standard send path
    setInput(question);
    window.setTimeout(() => {
      const form = document.querySelector<HTMLFormElement>("form");
      form?.requestSubmit();
    }, 60);
  }

  /* ----------------------------------------------------------
      EDIT-IN-PLACE (v1.3.1) — ChatGPT-style edit of a previous
      user turn: truncate the thread at that turn and resend the
      edited question through the standard send path.
  ---------------------------------------------------------- */
  function handleEditSubmit(messageId: string, newText: string) {
    if (isTyping) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0 || !newText.trim()) return;

    // Drop everything from this user turn onward (it + its answer),
    // then resend with the edited text — exactly like a fresh send.
    const kept = messages.slice(0, idx);
    setMessages(kept);
    historyRef.current = kept
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    setInput(newText.trim());
    window.setTimeout(() => {
      const form = document.querySelector<HTMLFormElement>("form");
      form?.requestSubmit();
    }, 60);
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
    setStage("");
    setIsTyping(false);
    window.dispatchEvent(new CustomEvent("ith:new-chat-started"));
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // Ctrl+N / Cmd+N — new chat shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  function openTicketForm(_message: Message) {
    // v0.21.99 — open an EMPTY form; the user writes their own subject/description.
    setTicketForm({
      subject: "",
      description: "",
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
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {mobileHistory && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setMobileHistory(false)} />
      )}

      {/* ================= MAIN CHAT ================= */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--topbar-bg)] px-4 lg:px-6">
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
        <div ref={messagesContainerRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
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
                    onSubmitEdit={(mid, text) => handleEditSubmit(mid, text)}
                    onRetryQuestion={() => retryFromMessage(m)}
                    grafanaChoices={
                      pendingChoices?.forMessageId === m.id ? pendingChoices.choices : undefined
                    }
                    grafanaBusy={pendingChoices?.forMessageId === m.id && choiceBusy}
                    onGrafanaPick={(c) => handleGrafanaPick(c)}
                  />
                ))}
        {/* Stage indicator during retrieval (only shown if bot hasn't started streaming answer text) */}
        {isTyping && stage && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-sm">
              <Bot className="size-5" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500 shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <span className="flex gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-blue-600 [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-blue-600 [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-blue-600 [animation-delay:300ms]" />
              </span>
              <span className="ml-1 text-[11px] font-medium">{stage}</span>
            </div>
          </div>
        )}
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

        {/* v0.22 — HITL escalation approval: centered confirmation modal */}
        {role === "admin" && approval && (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[3px]"
            role="dialog"
            aria-modal="true"
            aria-label="Escalation approval"
          >
            <div className="w-full max-w-md overflow-hidden rounded-2xl border border-amber-200/60 bg-[var(--card)] shadow-2xl dark:border-amber-900/50">
              {/* Header */}
              <div className="flex items-start gap-3 border-b border-amber-100 bg-gradient-to-r from-amber-50 to-orange-50/60 px-5 py-4 dark:border-amber-900/40 dark:from-amber-950/40 dark:to-orange-950/20">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                  <Shield className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-amber-950 dark:text-amber-200">
                      Escalation Approval Required
                    </h3>
                    <span className="inline-flex items-center rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/70 dark:text-amber-300">
                      HITL &middot; Pending
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-400/80">
                    Human-in-the-loop review before the ticket is created.
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="space-y-3 px-5 py-4">
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    User Request
                  </div>
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 text-xs leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                    &ldquo;{approval.question}&rdquo;
                  </div>
                </div>
                <div className="flex items-start gap-2 rounded-xl bg-blue-50/70 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 dark:bg-blue-950/30 dark:text-slate-300">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-blue-500" />
                  <span>
                    Approving will <strong>automatically create a Jira ticket</strong> and notify the requester via email.
                    Rejecting will inform the user that the escalation was not approved.
                  </span>
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900/40">
                <button
                  type="button"
                  onClick={async () => {
                    const d = await decideApproval(approval.id, "rejected");
                    setMessages((prev) => prev.map((m) =>
                      m.id === approval.id
                        ? { ...m, content: m.content + `

❌ **Rejected** — ${(d.messages ?? ["Ticket creation was rejected by the administrator."]).join(" ")}` }
                        : m));
                    setApproval(null);
                  }}
                  className="rounded-xl border border-slate-300/80 bg-white px-4 py-2 text-xs font-medium text-slate-700 shadow-2xs transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const d = await decideApproval(approval.id, "approved");
                    setMessages((prev) => prev.map((m) =>
                      m.id === approval.id
                        ? { ...m, content: m.content + `

✅ **Approved** — ${d.ticket_id ? `Ticket ${d.ticket_id} created. ` : ""}${(d.messages ?? []).join(" ")}` }
                        : m));
                    setApproval(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:from-emerald-700 hover:to-teal-700"
                >
                  <CheckCircle2 className="size-3.5" />
                  Approve &amp; Create Ticket
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Composer — compact single-row */}
        <div className="shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur-xs dark:border-slate-800/80 dark:bg-[#070B14]/95">
          <div className="mx-auto max-w-[860px] px-4 py-2 sm:px-6 sm:py-2.5">
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
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-2 shadow-xs transition-all focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/10 dark:border-slate-800 dark:bg-slate-900/80 dark:focus-within:bg-slate-900">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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
                  className="max-h-32 min-h-[30px] flex-1 resize-none bg-transparent px-2 py-1 text-xs outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isTyping}
                  aria-label="Send message"
                  className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-xs transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </form>

            <div className="mt-1.5 text-center text-[10px] text-slate-400">
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
  onSubmitEdit,
  onRetryQuestion,
  grafanaChoices,
  grafanaBusy = false,
  onGrafanaPick,
  busy = false,
}: {
  message: Message;
  onHelpful: () => void;
  onNotHelpful: () => void;
  onOpenTicketForm: () => void;
  onSubmitEdit?: (messageId: string, newText: string) => void;
  onRetryQuestion?: () => void;
  /** v1.3.4 — Grafana select-flow: candidate panels for this question */
  grafanaChoices?: GrafanaPanelChoice[];
  grafanaBusy?: boolean;
  onGrafanaPick?: (choice: GrafanaPanelChoice) => void;
  busy?: boolean;
}) {
  const isUser = message.role === "user";
  const caution = message.decision === "caution";
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API unavailable (http) — fallback
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function shareText(text: string) {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "IT Help Chatbot", text }); return; } catch { /* cancelled */ }
    }
    await copyText(text); // share unsupported -> copy as fallback
    setShared(true);
    window.setTimeout(() => setShared(false), 1600);
  }

  return (
    <div className={["group/msg flex gap-3", isUser ? "justify-end" : "justify-start"].join(" ")}>
      {!isUser && (
        <div className="grid size-9 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-sm">
          <Bot className="size-5" />
        </div>
      )}

      <div className={["min-w-0", isUser ? "max-w-[80%]" : "max-w-[88%]"].join(" ")}>
        <div
          className={[
            "min-w-0 max-w-full overflow-hidden rounded-2xl px-5 py-4 text-xs leading-relaxed",
            isUser
              ? "rounded-br-md bg-blue-600 text-white"
              : "rounded-tl-none border border-slate-200 bg-white text-slate-800 shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100",
          ].join(" ")}
        >
          {isUser ? (
            editing ? (
              /* v1.3.1 — in-place edit (ChatGPT-style): textarea inside the bubble */
              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (editDraft.trim() && editDraft !== message.content) {
                        onSubmitEdit?.(message.id, editDraft.trim());
                      }
                      setEditing(false);
                    } else if (e.key === "Escape") {
                      setEditing(false);
                      setEditDraft(message.content);
                    }
                  }}
                  rows={Math.min(6, Math.max(2, editDraft.split("\n").length))}
                  className="w-full resize-none rounded-xl bg-white/95 px-3 py-2 text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:bg-slate-900/95 dark:text-slate-100"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditing(false); setEditDraft(message.content); }}
                    className="rounded-lg border border-white/40 px-2.5 py-1 text-[10px] font-medium text-white/80 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!editDraft.trim() || editDraft === message.content}
                    onClick={() => {
                      if (editDraft.trim() && editDraft !== message.content) {
                        onSubmitEdit?.(message.id, editDraft.trim());
                      }
                      setEditing(false);
                    }}
                    className="rounded-lg bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
                  >
                    Save &amp; resend
                  </button>
                </div>
              </div>
            ) : (
            <div className="min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {message.content || "..."}
            </div>
            )
          ) : (
            <div className="md min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-xs leading-relaxed [&_code]:rounded [&_code]:bg-[var(--muted)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] dark:[&_code]:bg-slate-800 [&_h1]:mt-3 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-1 [&_p]:my-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_table]:my-3 [&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:overflow-hidden [&_table]:rounded-xl [&_table]:border [&_table]:border-slate-200 dark:[&_table]:border-slate-800 [&_th]:bg-slate-50 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-slate-700 dark:[&_th]:bg-slate-800/80 dark:[&_th]:text-slate-200 [&_th]:border-b [&_th]:border-slate-200 dark:[&_th]:border-slate-800 [&_td]:border-b [&_td]:border-slate-100 dark:[&_td]:border-slate-800/60 [&_td]:px-4 [&_td]:py-2.5 [&_td]:text-xs [&_tr:last-child_td]:border-b-0 [&_tbody_tr:hover]:bg-slate-50/50 dark:[&_tbody_tr:hover]:bg-slate-800/40">
              {message.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              ) : busy ? (
                <div className="flex items-center gap-2 text-slate-500">
                  <span className="flex gap-1">
                    <span className="size-1.5 animate-bounce rounded-full bg-blue-600 [animation-delay:0ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-blue-600 [animation-delay:150ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-blue-600 [animation-delay:300ms]" />
                  </span>
                  <span className="text-[11px] font-medium">Generating answer…</span>
                </div>
              ) : (message as any).guardrail ? (
                <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                  <div className="flex flex-col gap-1">
                    <div className="font-medium">Blocked by content security policy ({(message as any).guardrail}).</div>
                    <p className="text-[10px] text-muted-foreground">
                      Your message triggered the input guardrail (v1.1.4). No data was sent to the AI
                      provider. Rephrase your question — if you believe this is an error, contact IT.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 text-muted-foreground">
                  <div className="font-medium text-rose-600">No answer received from the AI provider.</div>
                  <p className="text-[10px]">
                    The pipeline ran (retrieval + generation) but the upstream model returned no
                    content — this is usually a free-tier rate limit or invalid model name. Try
                    again, or change the model in <strong>Settings → Integrations → H-Chat (LLM API)</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Inline Knowledge Base Sources in answer card */}
          {!isUser && (message.sources?.length ?? 0) > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800/80">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-blue-600 dark:text-blue-400" />
                  Sources & Referenced Documents
                </span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {message.sources!.length} reference{message.sources!.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {message.sources!.map((s, idx) => {
                  const content = (
                    <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 transition hover:border-blue-300 hover:bg-blue-50/40 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-blue-900 dark:hover:bg-blue-950/30">
                      <div className="grid size-6 shrink-0 place-items-center rounded-lg bg-blue-100 text-[10px] font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100" title={s.title}>
                          {s.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {s.space && <span className="capitalize">{s.space}</span>}
                          {s.relevance != null && (
                            <>
                              <span>•</span>
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                {s.relevance}% match
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {s.url && <ExternalLink className="size-3 shrink-0 text-slate-400 group-hover:text-blue-600" />}
                    </div>
                  );
                  return s.url ? (
                    <a key={`${s.page_id}-${idx}`} href={s.url} target="_blank" rel="noreferrer" className="block text-left">
                      {content}
                    </a>
                  ) : (
                    <div key={`${s.page_id}-${idx}`} className="block text-left">
                      {content}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
          {isUser && (
            // v1.1.2 — always-visible compact icons (hover-only hid them on touch devices):
            // Edit query / Copy query / Retry
            <span className="flex items-center gap-0.5">
              <button type="button" title="Edit query — edit in place and resend"
                onClick={() => { setEditDraft(message.content); setEditing(true); }}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <Pencil className="size-3.5" />
              </button>
              <button type="button" title="Copy query" onClick={() => copyText(message.content)}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              </button>
              <button type="button" title="Retry — re-run this question" onClick={() => onRetryQuestion?.()}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <RotateCcw className="size-3.5" />
              </button>
            </span>
          )}
          {!isUser && message.content && !busy && (
            <span className="flex items-center gap-1">
              <button type="button" title="Copy answer" onClick={() => copyText(message.content)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" title="Share answer" onClick={() => shareText(message.content)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                {shared ? <Check className="size-3 text-emerald-500" /> : <Share2 className="size-3" />}
                {shared ? "Shared" : "Share"}
              </button>
            </span>
          )}
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

        {/* v1.3.4 — Grafana select-flow: candidate panels the user picks from */}
        {!isUser && grafanaChoices && grafanaChoices.length > 0 && (
          <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-blue-800 dark:text-blue-300">
              <BarChart3 className="size-4" />
              Which dashboard panel should I show? ({grafanaChoices.length} matches)
            </div>
            <div className="mt-2.5 grid gap-1.5">
              {grafanaChoices.map((c, i) => (
                <button
                  key={`${c.dashboard_uid}-${c.panel_title}-${i}`}
                  type="button"
                  disabled={grafanaBusy}
                  onClick={() => onGrafanaPick?.(c)}
                  className="flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-left text-[11px] font-medium text-slate-700 shadow-2xs transition hover:border-blue-400 hover:bg-blue-100/60 disabled:opacity-50 dark:border-blue-900/60 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-blue-950/40"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {c.panel_title}
                    <span className="ml-1.5 text-[9px] font-normal text-muted-foreground">
                      · {c.dashboard_title}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[9px] font-semibold text-white">
                    {grafanaBusy ? "…" : "Select"}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[9px] text-muted-foreground">
              Live data from your Grafana dashboards — pick one and the assistant will summarize it.
            </p>
          </div>
        )}

        {!isUser && message.content && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => onHelpful()}
              disabled={busy}
              title={message.serverId ? "Record feedback" : "Answer not saved yet"}
              className={[
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
                message.feedback === 1
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
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
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
                message.feedback === -1
                  ? "border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <AlertTriangle className="size-3.5 text-amber-500" />
              Not helpful{message.feedback === -1 ? " ✓" : ""}
            </button>
            <button
              onClick={onOpenTicketForm}
              className="flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50/80 px-3.5 py-1.5 text-[11px] font-medium text-orange-700 transition hover:bg-orange-100 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300"
            >
              <Ticket className="size-3.5 text-orange-600 dark:text-orange-400" />
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
