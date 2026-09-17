import {
  Trash2, ArrowUp, Bot, History,
  Link2, Menu, Paperclip, Search,
  Shield, Info, MessageSquareText,
  Check, Pencil,
  Ticket as TicketIcon,
} from "lucide-react";


import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  decideApproval,
  uploadAttachment,
  submitFeedback as pushFeedback,
} from "@/features/chat/api";
import { runChatStream } from "@/features/chat/hooks/useChatStream";
import ComposerControls, { ModeControl } from "@/features/chat/components/ComposerControls";
import MessageBubble from "@/features/chat/components/MessageBubble";
import SessionPanel from "@/features/chat/components/SessionPanel";
import {
  type Message,
  type Source,
  type Conv,
  currentTime,
  latestSources,
  latestRetrieval,
} from "@/features/chat/model";
import {
  EmptyChat,
  Row,
} from "@/features/chat/components/chat-parts";
import RagPipelineStatus, { useStageTelemetry } from "@/features/chat/components/RagPipelineStatus";
import { SourceCard } from "@/features/chat/components/MessageParts";
import { alertTicket } from "@/lib/notify";
import {
  listConversations,
  getConversationMessages,
  renameConversation,
} from "@/features/conversations/api";
import { createTicketApi, listActiveDomains, listTicketDestinations } from "@/features/tickets/api";
import { assignableUsers } from "@/features/users/api";

/* ============================================================
   MAIN COMPONENT
============================================================ */

export default function Chat({
  userName,
  // retained in the prop contract; no longer used now that escalations run
  // through the requester's ticket form instead of an admin approval modal
  role: _role,
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
  // v1.6.12 — RAG pipeline live tracker (per-stage telemetry + streaming pill)
  const pipeline = useStageTelemetry();
  // v1.6.22 — per-request LLM provider selection (user toggle in the chat input bar)
  const [llmProvider, setLlmProvider] = useState<"auto" | "cloud" | "local">("auto");
  // v1.6.55 — WHAT the answer may draw on, separate from which model answers.
  // Claude Desktop / opencode keep "chat" and "MCP tools" visibly distinct; without
  // it a KB answer and an infrastructure answer look identical, and a failed tool
  // lookup reads as "no such information in the knowledge base".
  const [chatMode, setChatMode] = useState<"auto" | "kb" | "infra">("auto");
  // v1.6.65 — "Ask this in Infrastructure mode" re-sends a previous question without
  // making the user retype it. State updates are async, so the override travels in a
  // ref that sendMessage consumes once.
  const askOverrideRef = useRef<{ question: string; mode: "auto" | "kb" | "infra" } | null>(null);
  // v1.6.65 — mobile access to "what produced this answer".
  const [panelOpen, setPanelOpen] = useState(false);
  // v1.6.40 — the escalation is resolved by the requester filling the ticket form
  // themselves, so remember which pending approval that form supersedes. On submit
  // it is marked "cancelled" (NOT resumed), which prevents an admin from later
  // approving the same escalation and creating a duplicate ticket.
  const [escalationApprovalId, setEscalationApprovalId] = useState<string | null>(null);
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
        toolUsed: m.meta?.tool_used || undefined,
        toolNote: m.meta?.tool_note || undefined,
        toolCalls: m.meta?.tool_calls || undefined,
        evidence: m.meta?.evidence || null,
        rawOutput: m.meta?.raw_output || undefined,
        latencyMs: m.meta?.latency_ms,
        ragTrace: m.meta?.rag_trace || (m.meta?.latency_ms ? { stages: {}, totalMs: m.meta.latency_ms } : undefined),
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
    const override = askOverrideRef.current;
    askOverrideRef.current = null;
    const question = (override?.question ?? input).trim();
    // The mode for THIS send: an override (one-click re-ask) wins over the composer
    // selection, which is what lets "Ask this in Infrastructure mode" work without
    // first mutating the control and waiting for a re-render.
    const sendMode = override?.mode ?? chatMode;
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

    setMessages((prev) => [...prev, userMessage]);
    historyRef.current = [...historyRef.current, { role: "user", content }];
    setIsTyping(true);
    pipeline.begin();
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
                      toolUsed: (meta as any).tool_used || undefined,
                      toolNote: (meta as any).tool_note || undefined,
                      toolCalls: (meta as any).tool_calls || undefined,
                      evidence: (meta as any).evidence || null,
                      rawOutput: (meta as any).raw_output || undefined,
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
                        // S1.1 — real retrieval stats for the right-hand panel
                        retrieval: meta.retrieval ?? undefined,
                        }
                        : m,
              ),
            ),
          onToken: (token) => {
            pipeline.onFirstToken();
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m))
            );
          },
          onStage: (detail, stageKey) => {
            setStage(detail);
            pipeline.onStage(detail, stageKey);
          },
          onApprovalRequest: (data) => {
            setStage("");
            // v1.6.40 — the HITL approval modal is replaced by the ticket form:
            // the requester fills in the details and creates the ticket directly.
            setEscalationApprovalId(data.approval_id);
            openTicketForm(undefined, {
              subject: (data.question || "").slice(0, 120),
              description: data.question || "",
            });
            alertTicket("before");
            chatAlert("Escalation understood — fill in the ticket details and submit.");
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + "\n\n📝 **Fill in the ticket form to escalate this.**" }
                : m));
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
            const finalTrace = pipeline.finish();
            const traceSnapshot = {
              stages: finalTrace.stages && Object.keys(finalTrace.stages).length > 0
                ? { ...finalTrace.stages }
                : { ...pipeline.telemetryRef.current },
              totalMs: finalTrace.totalMs || pipeline.elapsedRef.current || d.latency_ms || 0,
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      usage: d.usage ?? m.usage,
                      latencyMs: d.latency_ms ?? m.latencyMs,
                      serverId: d.message_id ?? m.serverId,
                      ragTrace: traceSnapshot,
                    }
                  : m,
              ),
            );
          },
        },
        llmProvider,
        sendMode,
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
      RETRY — re-run a previous user turn (v1.1.2)
      Trims messages after the chosen user turn (both the user
      turn and its assistant answer) and resends the question.
  ---------------------------------------------------------- */
  /**
   * v1.6.65 — re-ask this question against the LIVE estate.
   *
   * The whole point of an explicit mode switch is that the user can act on it. Getting
   * a documents answer and wanting the cluster's own answer used to mean retyping the
   * question and switching modes; this does both in one click.
   */
  function askLiveFromMessage(target: Message) {
    if (isTyping) return;
    const idx = messages.findIndex((m) => m.id === target.id);
    if (idx < 0) return;
    let question = "";
    for (let i = idx; i >= 0; i -= 1) {
      if (messages[i].role === "user") { question = messages[i].content.trim(); break; }
    }
    if (!question) return;
    setChatMode("infra");
    askOverrideRef.current = { question, mode: "infra" };
    void sendMessage();
  }

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
    assignee: string; due_date: string; destination: string;
  }>(null);
  // v1.6.4 — configured external destinations (Jira / OpenProject)
  const [ticketDests, setTicketDests] = useState<
    { key: string; label: string; configured: boolean }[]
  >([{ key: "jira", label: "Jira", configured: true }]);
  const [ticketBusy, setTicketBusy] = useState(false);
  // v1.6.3 — categories come from the live classifier-domain registry so a domain
  // added by a knowledge manager shows up immediately (was a hardcoded 7-item list)
  const [ticketDomains, setTicketDomains] = useState<{ key: string; label: string }[]>([
    { key: "general", label: "General" },
  ]);
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

  /** v1.6.45 — answer a follow-up grounded in ONE retrieved source.
   *
   * The source card only shows a trimmed excerpt, so "I want the details of this
   * article" previously meant retyping the question and hoping retrieval picked
   * the same chunks again. This sends a prompt that names the article, which pins
   * the retrieval target and asks for the full context, the procedure and any
   * exact commands.
   */
  function explainSource(source: Source) {
    const q =
      `Explain the knowledge base article "${source.title}" in full detail. ` +
      `Include: what it covers, the complete step-by-step procedure, every exact ` +
      `command or configuration value it mentions (in fenced code blocks), and any ` +
      `warnings or prerequisites.` +
      (source.url ? `\nSource: ${source.url}` : "");
    setInput(q);
    window.setTimeout(() => {
      document.querySelector<HTMLFormElement>("form")?.requestSubmit();
    }, 60);
  }

  function openTicketForm(
    _message?: Message,
    prefill?: { subject?: string; description?: string; domain?: string },
  ) {
    // v0.21.99 — open an EMPTY form; the user writes their own subject/description.
    // v1.6.40 — when the escalation comes from chat the same form is opened with the
    // user's own request pre-filled, so they only complete the details. Nothing is
    // auto-created: the user reviews and submits.
    setTicketForm({
      subject: prefill?.subject ?? "",
      description: prefill?.description ?? "",
      domain: prefill?.domain ?? "general",
      priority: "medium",
      assignee: "",
      due_date: "",
      destination: "jira",
    });
    listTicketDestinations()
      .then((ds) => {
        setTicketDests(ds);
        const firstConfigured = ds.find((d) => d.configured);
        if (firstConfigured)
          setTicketForm((f) => (f ? { ...f, destination: firstConfigured.key } : f));
      })
      .catch(() => { /* noop */ });
    // v0.21.98 — assignable users (same list as Tickets page)
    assignableUsers()
      .then((d) => setAssignable(d?.users ?? []))
      .catch(() => setAssignable([]));
    // v1.6.3 — live category list (reflects domains added by knowledge managers)
    listActiveDomains()
      .then((ds) => {
        if (!ds.length) return;
        const hasGeneral = ds.some((x) => x.key === "general");
        const list = [
          ...(hasGeneral ? [] : [{ key: "general", label: "General" }]),
          ...ds.map((x) => ({ key: x.key, label: x.label })),
        ];
        setTicketDomains(list);
        // keep the current selection if it still exists, else fall back to General
        setTicketForm((f) => (f ? {
          ...f,
          domain: list.some((x) => x.key === f.domain) ? f.domain : list[0].key,
        } : f));
      })
      .catch(() => { /* keep fallback list */ });
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
        destination: ticketForm.destination,
        session_id: sessionRef.current ?? null,
      });
      const destLabel = ticketForm.destination === "openproject" ? "OpenProject" : "Jira";
      const ticketId = created?.id ?? "";
      const link = created?.jira_link ?? "";

      // v1.6.40 — the form supersedes the pending HITL escalation: mark it cancelled
      // so it leaves the admin queue and cannot be approved later (which would create
      // a second ticket). Best-effort — the ticket already exists either way.
      if (escalationApprovalId) {
        try {
          await decideApproval(escalationApprovalId, "cancelled");
        } catch { /* the ticket is already created; the queue entry is cosmetic */ }
        setEscalationApprovalId(null);
      }

      // "after" signal: sound + haptics + in-app notice. The requester email is
      // sent server-side by notifier.notify_ticket_created() in POST /api/tickets.
      alertTicket("after");
      chatAlert(`${ticketId || "Ticket"} created in ${destLabel}`);
      // v1.6.8 — reflect the creation in the chat itself (assistant info message);
      // the backend also persisted it, so it survives reload.
      const infoLine = link
        ? `✅ Ticket ${ticketId} created in ${destLabel}.\nYou can follow it here: ${link}\nThe IT team will follow up.`
        : `✅ Ticket ${ticketId} created in ${destLabel}. The IT team will follow up.`;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: infoLine,
          timestamp: currentTime(),
        },
      ]);
      setTicketForm(null);
    } catch (e: any) {
      // v1.6.3 — surface the real reason (was a generic message that hid 422s)
      chatAlert(`Ticket creation failed — ${e?.message ?? "unknown error"}`, "err");
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

  // S1.1 — derived once per render: real retrieval stats + cited sources for the panel.
  const sources = latestSources(messages);
  const retrieval = latestRetrieval(messages);
  // v1.6.65 — "what produced this answer" for the detail strip. A live-infrastructure
  // answer has no retrieval numbers, so the same panel used to read 0 / "—" throughout.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastIsLive = lastAssistant?.toolUsed === "mcp_infra";
  const SERVER_LABEL: Record<string, string> = {
    rancher: "Rancher / Kubernetes",
    proxmox: "Proxmox VE",
  };
  const detailSummary = {
    live: lastIsLive,
    serverLabels: (lastAssistant?.evidence?.servers ?? []).map((x) => SERVER_LABEL[x] ?? x),
    at: lastAssistant?.evidence?.at ?? null,
    calls: lastAssistant?.evidence?.calls ?? lastAssistant?.toolCalls?.length ?? undefined,
    totalMs: lastAssistant?.evidence?.total_ms,
    readOnly: lastAssistant?.evidence?.read_only ?? true,
    chunks: retrieval?.chunks ?? null,
    cited: retrieval?.cited ?? (sources.length || null),
    rerankUsed: retrieval?.rerank_used ?? null,
    role: retrieval?.role ?? null,
    aclScoped: retrieval?.acl_scoped ?? null,
  };
  // S1.2 — exactly one progress surface: the live pipeline card. While it is on
  // screen (isTyping) the in-bubble placeholder degrades to a neutral skeleton so
  // the user never reads two competing "in progress" animations.
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {mobileHistory && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setMobileHistory(false)} />
      )}

      {/* ================= MAIN CHAT ================= */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* S2.8 — h-16 duplicated the app-shell bar's height; h-12 keeps a single
            visual rhythm between the shell chrome and the page chrome. */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--topbar-bg)] px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setMobileHistory(true)}>
              <Menu className="size-5" />
            </button>
            <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--brand-chip)] text-sky-300 shadow-sm">
              <Bot className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">IT Knowledge Assistant</h1>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-muted-foreground">Online</span>
                <span className="text-[10px] text-muted-foreground">·</span>
                <span className="hidden text-[10px] text-muted-foreground sm:block">
                  Hybrid RAG
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* S2.8 — "Hybrid RAG + rerank" moved to the retrieval panel (it was
                static text here) and the chip is slimmer so the header reads as one
                line of chrome instead of a second title bar. */}
            <div className="hidden items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-2.5 py-1 text-[10px] sm:flex">
              <Shield className="size-3 text-emerald-600" />
              RBAC protected
            </div>
          </div>
        
            {/* v1.6.68 — on small screens the answer-source selector lives here, not
                under the composer: it is a session-level setting, and the composer
                keeps only attach / mic / send. Visible below sm, where the composer
                hides its copy. */}
            <ModeControl
              mode={chatMode}
              onModeChange={setChatMode}
              className="sm:hidden"
            />
            {/* v1.6.65 — the panel was `hidden xl:flex`, so on a phone (where this app
                is mostly used) "what produced this answer" was unreachable. This opens
                it inline BELOW the header, so it participates in layout and can never
                occlude the composer. */}
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              title="What produced this answer"
              aria-label="Toggle answer detail"
              className={`rounded-lg p-2 transition xl:hidden ${
                panelOpen ? "bg-muted text-foreground" : "hover:bg-muted text-muted-foreground"
              }`}
            >
              <Info className="size-4" />
            </button>
        </header>

        {/* v1.6.65 — inline (not a floating sheet) so it can never cover the composer,
            and mode-aware so a live answer is not described with retrieval numbers. */}
        {panelOpen && (
          <div className="shrink-0 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 xl:hidden">
            <SessionPanel summary={detailSummary} />
          </div>
        )}

        {/* Messages */}
        <div ref={messagesContainerRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {/* S2.4 — the scroll container must be a flex column for `justify-center`
              to have any height to centre within; previously the empty state sat
              top-heavy with ~200px of dead space above the composer. */}
          <div className="mx-auto flex min-h-full max-w-[1000px] flex-col px-4 py-6 lg:px-8">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col justify-center">
                <EmptyChat userName={userName} onSuggestion={(q) => { setInput(q); window.setTimeout(() => { const form = document.querySelector<HTMLFormElement>("form"); form?.requestSubmit(); }, 60); }} />
              </div>
            ) : (
              <div className="space-y-7">
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    busy={isTyping}
                    liveStageText={stage}
                    liveElapsedMs={pipeline.elapsed}
                    onHelpful={() => submitFeedback(m, 1)}
                    onNotHelpful={() => submitFeedback(m, -1)}
                    onOpenTicketForm={() => openTicketForm(m)}
                    onSubmitEdit={(mid, text) => handleEditSubmit(mid, text)}
                    onRetryQuestion={() => retryFromMessage(m)}
            onAskLive={() => askLiveFromMessage(m)}
                  />
                ))}
                {/* In-flight RAG execution status shown ONLY while actively generating before message persists */}
                {isTyping && (
                  // S2.7 — align with the answer column (bubbles are max-w-[88%] of
                  // the 1000px column) instead of a narrower 768px panel that read
                  // like a floating modal parked under the bubble.
                  <div className="mx-auto w-full max-w-[88%] px-1 pb-2">
                    <RagPipelineStatus
                      active={true}
                      stage={stage}
                      streaming={pipeline.streaming}
                      telemetry={pipeline.telemetry}
                      elapsedMs={pipeline.elapsed}
                      defaultOpen={true}
                    />
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

        {/* v1.6.40 — the HITL approval modal was removed. An escalation now opens the
            pre-filled Create Ticket form for the requester, who fills in the details and
            submits; the pending approval is marked `cancelled` (never resumed, so no
            duplicate ticket). Admins keep the notification bell for awareness. */}

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
              {/* v1.6.22 — LLM provider toggle (Auto / Cloud / Local) */}
              {/* v1.6.60 — one quiet row instead of two rows of chips. Six coloured
                  pills clipped and wrapped on a phone, for settings that change once a
                  session. See components/ComposerControls.tsx. */}
              <ComposerControls
                mode={chatMode}
                onModeChange={setChatMode}
                engine={llmProvider}
                onEngineChange={setLlmProvider}
              />
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
                  title="Send (Enter)"
                  className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-xs transition hover:bg-blue-700 hover:shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </form>

            {/* S3.11 — 9.5px slate-500 on the page background failed comfortable
                reading; 11px at slate-500/400 clears the contrast floor. */}
            <p className="mt-1.5 text-center text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              Answers are AI-generated — verify before acting. Access is RBAC-protected.
            </p>
          </div>
        </div>
      </main>

      {/* ================= RIGHT SOURCE PANEL ================= */}
      {/* S2.6 — always mounted on xl (was gated on messages.length > 0, which made
          the message column jump 300px narrower the moment the first answer landed). */}
      {showSources && (
        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--card)] xl:flex">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
            <div>
              <h2 className="text-[12px] font-semibold leading-tight">Knowledge sources</h2>
              <p className="text-[9px] leading-tight text-muted-foreground">
                Retrieved for this conversation
              </p>
            </div>
            <Link2 className="size-3.5 text-muted-foreground" />
          </div>

          {/* S2.9 — retrieval stats pinned directly under the header so the panel has
              no unlabelled dead band in the middle. S1.1 — every value comes from the
              real `meta.retrieval` payload; "—" when the backend did not report it
              (never a fabricated number). */}
          <div className="shrink-0 border-b border-[var(--border)] p-4">
            <div className="rounded-xl bg-[var(--muted)] p-3">
              <div className="flex items-center gap-2">
                <History className="size-3.5 text-blue-500" />
                <span className="text-[10px] font-semibold">Retrieval information</span>
              </div>
              <div className="mt-3 space-y-2 text-[10px] text-muted-foreground">
                <Row
                  label="Chunks retrieved"
                  value={retrieval?.chunks != null ? String(retrieval.chunks) : "—"}
                />
                <Row
                  label="Sources cited"
                  value={
                    retrieval?.cited != null
                      ? String(retrieval.cited)
                      : sources.length > 0
                        ? String(sources.length)
                        : "—"
                  }
                />
                <Row
                  label="Search type"
                  value={
                    retrieval?.rerank_used === true
                      ? "Hybrid + rerank"
                      : retrieval?.rerank_used === false
                        ? "Hybrid (rerank skipped)"
                        : "—"
                  }
                />
                <Row
                  label="ACL filtering"
                  value={
                    retrieval?.acl_scoped == null
                      ? "—"
                      : retrieval.acl_scoped
                        ? "Enforced (domain-scoped)"
                        : "Enforced (unrestricted role)"
                  }
                  good={retrieval?.acl_scoped != null}
                />
                <Row
                  label="Top K"
                  value={retrieval?.top_k != null ? String(retrieval.top_k) : "—"}
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {sources.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
                <div className="grid size-9 place-items-center rounded-xl bg-[var(--muted)]">
                  <Link2 className="size-4 text-muted-foreground" />
                </div>
                <p className="text-[11px] font-medium text-muted-foreground">No sources yet</p>
                <p className="text-[10px] leading-relaxed text-muted-foreground/80">
                  Ask a question — the KB articles used to ground the answer appear here.
                </p>
              </div>
            ) : (
              sources.map((source, index) => (
                <SourceCard
                  key={`${source.page_id}-${index}`}
                  source={source}
                  index={index + 1}
                  onExplain={explainSource}
                />
              ))
            )}
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
                {/* v1.6.4 — destination: create in Jira or OpenProject (no local-only) */}
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Create in
                  </label>
                  <div className="flex gap-2">
                    {ticketDests.map((d) => {
                      const active = ticketForm.destination === d.key;
                      return (
                        <button
                          key={d.key}
                          type="button"
                          disabled={!d.configured}
                          title={d.configured
                            ? `Create this ticket in ${d.label}`
                            : `${d.label} is not configured — set it up in Settings → Integrations`}
                          onClick={() => setTicketForm({ ...ticketForm, destination: d.key })}
                          className={`h-10 flex-1 rounded-xl border px-3 text-xs font-medium transition dark:border-slate-700 dark:bg-slate-950 ${
                            active
                              ? "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400"
                              : d.configured
                                ? "border hover:border-orange-400 dark:border-slate-700"
                                : "cursor-not-allowed cursor-not-allowed opacity-40 italic dark:border-slate-800"
                          }`}
                        >
                          {d.label}{!d.configured ? " (not configured)" : ""}
                        </button>
                      );
                    })}
                  </div>
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
                      {ticketDomains.map((d) => (
                        <option key={d.key} value={d.key}>{d.label}</option>
                      ))}
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
