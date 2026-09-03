import { FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence } from "framer-motion";
import {AlertTriangle, BookOpen, Check, CheckCircle2, LayoutDashboard, ChevronDown, FileText, Home, MessageCircle, MessageSquare, MessageSquareText, Phone, Plus, RotateCw, Search, Settings as SettingsIcon, ThumbsDown, ThumbsUp, Ticket as TicketIcon, TicketCheck, TicketPlus, Trash2, Users as UsersIcon, Wrench, Zap, MessagesSquare, ScrollText,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MarkdownPre } from "@/components/HighlightedCode";
import Knowledge from "@/features/knowledge/pages/KnowledgePage";
import Tickets from "@/features/tickets/pages/TicketsPage";
import ChatPage from "@/features/chat/pages/ChatPage";
import UsersPage from "@/features/users/pages/UsersPage";
import ConversationHistoryPage from "@/features/conversations/pages/ConversationHistoryPage";
import AuditsPage from "@/features/audits/pages/AuditsPage";
import SettingsNew from "@/features/settings/pages/SettingsPage";
import Dashboard from "@/features/dashboard/pages/DashboardPage";
import Login from "@/features/auth/pages/LoginPage";
import {
  setAuthToken, setRefreshToken, loadTokens, saveTokens, clearTokens,
} from "@/shared/api/client";
import { login, getMe } from "@/features/auth/api";
import { streamChat, escalate, getContact, submitFeedback } from "@/features/chat/api";
import { searchArticles, createArticle, triggerSync } from "@/features/knowledge/api";
import {
  listConversations, getConversationMessages, clearConversations,
  type Conv,
} from "@/features/conversations/api";
import { getMySettings } from "@/features/settings/api";

type Hit = { title?: string; confidence?: number; source_url?: string };
type Meta = {
  domain?: string;
  confidence?: number;
  decision?: string;
  hits?: Hit[];
  // LLM usage (set on the SSE `done` event, then merged into meta)
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  top_k?: number;
  context_tokens_estimate?: number;
  context_chars?: number;
  context_truncated?: boolean;
  max_context_tokens?: number;
};
type Article = { title?: string; confidence?: number; source_url?: string };
type Contact = { name?: string; email?: string; phone?: string };
type Msg = { role: "user" | "assistant"; content: string; meta?: Meta | null; caution?: string | null; messageId?: string };

// Decode the JWT `sub` claim (username) client-side for display.
function usernameFromToken(tok: string): string {
  try {
    const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.sub as string;
  } catch {
    return "";
  }
}

// "Today" / "Yesterday" / "May 13" style relative date for the sidebar list.
function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sodThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((sod.getTime() - sodThat.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const NAV = [
  { id: "dashboard", label: "Dashboard", ico: null },
  { id: "articles", label: "Knowledge", ico: null },
  { id: "tickets", label: "Tickets", ico: null },
  { id: "users", label: "Users", ico: null },
  { id: "history", label: "Conversations", ico: null },
  { id: "history", label: "Conversations", ico: null },
  { id: "settings", label: "Settings", ico: null },
];

export default function App() {
  // v0.21.44 — apply persisted theme on every page load (previously only Settings did,
  // so refreshing on other pages reset the theme).
  useEffect(() => {
    const dark = localStorage.getItem("ith.dark") === "1";
    const compact = localStorage.getItem("ith.compact") === "1";
    const animOff = localStorage.getItem("ith.animations") === "0";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.dataset.compact = compact ? "1" : "0";
    document.documentElement.classList.toggle("animations-off", animOff);
  }, []);

  const [query, setQuery] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  // v0.18.2 — persist current page in the URL hash so browser refresh keeps the
  // same page. Hash (#/dashboard) also makes sub-pages linkable. Default = chat.
  const initialNav = () => {
    const h = window.location.hash.replace(/^#\/?/, "");
    return NAV.some((n) => n.id === h) ? h : "chat";
  };
  const [nav, setNavState] = useState(initialNav);
  const setNav = (n: string) => {
    setNavState(n);
    window.history.replaceState(null, "", n === "chat" ? "#/" : `#/${n}`);
  };
  const [contact, setContact] = useState<Contact | null>(null);
  const [articleQuery, setArticleQuery] = useState("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [authed, setAuthed] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState("");
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [meDisplay, setMeDisplay] = useState("");
  const [escalation, setEscalation] = useState<any>(null);
  const [escKey, setEscKey] = useState<number | null>(null);
  const [fbSent, setFbSent] = useState<Record<string, string>>({}); // messageId -> 'helpful'|'unhelpful'
  const [adminErr, setAdminErr] = useState("");
  const [adminMsg, setAdminMsg] = useState("");
  const [artForm, setArtForm] = useState({ title: "", body: "", domain: "general" });
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [mkOpen, setMkOpen] = useState(false); // Manage KB collapsible (context panel)
  const [drawer, setDrawer] = useState(false); // mobile sidebar drawer (RWD)
  const [nhFor, setNhFor] = useState<string | null>(null);   // messageId awaiting Not-Helpful reason
  const sessionRef = useRef<string>(crypto.randomUUID());
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const last = msgs[msgs.length - 1];

  // Restore session from OS keyring on mount (Phase 5).
  useEffect(() => {
    loadTokens().then((t) => {
      if (t?.access) {
        setAuthToken(t.access);
        setRefreshToken(t.refresh ?? null);
        setUserName(usernameFromToken(t.access));
        setAuthed(true);
        getMe().then((m) => { setRole(m.role); setPerms(m.permissions ?? {}); setMeDisplay(m.displayRole ?? ""); }).catch(() => {});
        getMySettings().then(applyUserPrefs).catch(() => {}); // theme engine on restore
      }
    }).catch(() => {});
  }, []);

  // Theme engine: apply the saved prefs to <html data-theme> + font scaling.
  function applyUserPrefs(s: any) {
    const root = document.documentElement;
    // v0.21.45 — server may store either `theme` ("light"|"dark"|"system") or the newer
    // boolean `darkMode`; fall back to the local mirror. Never write "undefined".
    let theme: string | undefined = s?.theme;
    if (typeof s?.darkMode === "boolean") theme = s.darkMode ? "dark" : "light";
    if (!theme || theme === "undefined") {
      theme = localStorage.getItem("ith.dark") === "1" ? "dark" : "light";
    }
    root.setAttribute("data-theme", theme);
    root.style.setProperty("--chat-font-size", `${s?.chat_font_size || 14}px`);
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setLoginErr("");
    try {
      const data = await login(loginUser, loginPass);
      setAuthToken(data.access_token);
      setRefreshToken(data.refresh_token ?? null);
      await saveTokens(data.access_token, data.refresh_token);
      setUserName(data.username ?? loginUser);
      setAuthed(true);
      // v0.21.96 — login always lands on Chat (user request: no other page shown)
      setNavState("chat");
      window.history.replaceState(null, "", "#/");
      getMe().then((m) => { setRole(m.role); setPerms(m.permissions ?? {}); setMeDisplay(m.displayRole ?? ""); }).catch(() => {});
      // Load saved prefs and apply the theme immediately (theme engine).
      getMySettings().then(applyUserPrefs).catch(() => {});
    } catch (err: any) {
      // v0.21.57 — show the backend's reason verbatim (e.g. the account-disabled
      // message) instead of "Error: Login failed (HTTP 403)".
      setLoginErr(err?.message ? String(err.message).replace(/^Error:\s*/, "") : String(err));
    }
  }

  async function onLogout() {
    await clearTokens();
    setAuthToken(null);
    setRefreshToken(null);
    setUserName("");
    setAuthed(false);
  }

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      setNavState(NAV.some((n) => n.id === h) ? h : "chat");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    if (last?.meta?.domain) getContact(last.meta.domain).then(setContact).catch(() => setContact(null));
  }, [last?.meta?.domain]);

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setQuery("");
    historyRef.current.push({ role: "user", content: q });
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setMsgs((m) => [...m, { role: "assistant", content: "", meta: null }]);
    setBusy(true);
    try {
      await streamChat(q, sessionRef.current, historyRef.current.slice(0, -1), (ev) => {
        if (ev.event === "meta") {
          const meta: Meta = ev.data;
          setMsgs((m) => {
            const n = [...m];
            n[n.length - 1] = { ...n[n.length - 1], meta };
            return n;
          });
        } else if (ev.event === "caution") {
          setMsgs((m) => {
            const n = [...m];
            n[n.length - 1] = { ...n[n.length - 1], caution: ev.data.message };
            return n;
          });
        } else if (ev.event === "token") {
          setMsgs((m) => {
            const n = [...m];
            n[n.length - 1] = { ...n[n.length - 1], content: n[n.length - 1].content + String(ev.data.token ?? "") };
            return n;
          });
        } else if (ev.event === "done") {
          setMsgs((m) => {
            const n = [...m];
            // Merge LLM usage + RAG tunables from the terminal event into the
            // existing `meta` so the UI can render a single "Usage" pill without
            // separate state.
            const prev: any = n[n.length - 1].meta || {};
            const merged: Meta = {
              ...prev,
              ...(ev.data.usage ? { usage: ev.data.usage } : {}),
              ...(ev.data.top_k != null ? { top_k: ev.data.top_k } : {}),
              ...(ev.data.context_tokens_estimate != null ? { context_tokens_estimate: ev.data.context_tokens_estimate } : {}),
            };
            n[n.length - 1] = { ...n[n.length - 1], messageId: ev.data.message_id, meta: merged };
            return n;
          });
          historyRef.current.push({ role: "assistant", content: "" });
          setBusy(false);
          loadConversations();
        }
      });
    } catch (err) {
      setMsgs((m) => {
        const n = [...m];
        n[n.length - 1] = { ...n[n.length - 1], content: `<AlertTriangle className="size-3" />️ ${String(err)}` };
        return n;
      });
      setBusy(false);
    }
  }

  async function onSearchArticles(e: FormEvent) {
    e.preventDefault();
    if (!articleQuery) return;
    try {
      const res = await searchArticles(articleQuery, last?.meta?.domain);
      setArticles(res.articles ?? []);
    } catch {
      setArticles([]);
    }
  }

  async function onFeedback(mid: string | null | undefined, rating: number, comment?: string) {
    const id = mid ?? null;
    try {
      const ok = await submitFeedback(id, rating, comment);
      if (ok && ok.saved) setFbSent((s) => ({ ...s, [id ?? ""]: rating === 1 ? "helpful" : "unhelpful" }));
    } catch {
      // no-op — keep the buttons enabled so the user can retry
    }
  }

  async function onEscalateMsg(m: Msg, key: number) {
    setEscalation(null); setEscKey(null);
    try {
      const r = await escalate({
        message: (m.content || "").slice(0, 120) || "IT help escalation",
        domain: m.meta?.domain,
        confidence: m.meta?.confidence,
        transcript: historyRef.current,
      });
      setEscalation(r); setEscKey(key);
      if (r?.link) window.open(r.link, "_blank");
    } catch (err) {
      setEscalation({ error: String(err) }); setEscKey(key);
    }
  }

  async function onAddArticle(e: FormEvent) {
    e.preventDefault();
    setAdminErr(""); setAdminMsg("");
    if (!artForm.title || !artForm.body) { setAdminErr("Title and body are required"); return; }
    const page_id = "custom-" + artForm.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const res = await createArticle({ ...artForm, page_id });
    if (res.status === 200 || res.status === 201) { setAdminMsg("Added ✓ re-embedding…"); setArtForm({ title: "", body: "", domain: "general" }); }
    else setAdminErr(res.status === 403 ? "Admin only (403)" : `Failed (HTTP ${res.status})`);
  }


  async function onSync() {
    setAdminMsg("Syncing KB…");
    const res = await triggerSync();
    setAdminMsg(res.status === 200 ? `Synced <Check className="size-3" /> ${JSON.stringify(res.data)}` : `Sync failed (HTTP ${res.status})`);
  }


  async function loadConversations() {
    try {
      const r: any = await listConversations();
      setConversations(Array.isArray(r?.conversations) ? r.conversations : []);
    } catch {
      setConversations([]);
    }
  }
  useEffect(() => { if (authed) loadConversations(); }, [authed]);

  // Sidebar click → load that conversation's history and resume it.
  async function openConversation(id: string) {
    try {
      const r: any = await getConversationMessages(id);
      const list: Msg[] = (r.messages ?? []).map((m: any) => ({
        role: m.role, content: m.content, meta: m.meta ?? null, caution: m.caution ?? null,
      }));
      setMsgs(list);
      historyRef.current = list.map((m) => ({ role: m.role, content: m.content }));
      sessionRef.current = id;
      setNav("chat");
      setContact(null);
      setEscalation(null);
    } catch (err) {
      console.error("openConversation", err);
    }
  }

  // "Clear ▾" → wipe the user's conversations and start fresh.
  async function clearConvos() {
    try {
      await clearConversations();
      setConversations([]);
      setMsgs([]);
      historyRef.current = [];
      sessionRef.current = crypto.randomUUID();
    } catch {
      // stay
    }
    setConfirmClear(false);
  }

  if (!authed) {
    return (
      <Login
        loginUser={loginUser} setLoginUser={setLoginUser}
        loginPass={loginPass} setLoginPass={setLoginPass}
        loginErr={loginErr} onSubmit={onLogin}
      />
    );
  }

  // v0.13.0 — new Chat experience replaces the legacy 3-pane chat view.
  if (authed && nav === "chat") {
    return (
      <ChatPage userName={userName} role={role} onNavigate={(n) => { setNav(n); }} onLogout={onLogout} />
    );
  }

  // v0.15.0 — full-page views (like Chat page) for all primary sections.
  if (authed && nav === "users") {
    return (
      <div className="flex h-screen overflow-hidden">
        <PageSidebar active="users" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
        <div className="min-w-0 flex-1 overflow-y-auto"><UsersPage /></div>
      </div>
    );
  }

  // v0.21.75 — admin conversation audit page
  if (authed && nav === "history") {
    return (
      <div className="flex h-screen overflow-hidden">
        <PageSidebar active="history" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
        <div className="min-w-0 flex-1 overflow-y-auto"><ConversationHistoryPage /></div>
      </div>
    );
  }

  if (authed && nav === "audits") {
    return (
      <div className="flex h-screen overflow-hidden">
        <PageSidebar active="audits" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
        <div className="min-w-0 flex-1 overflow-y-auto"><AuditsPage /></div>
      </div>
    );
  }

  if (authed && nav === "settings") {
    return (
      <div className="flex h-screen overflow-hidden">
        <PageSidebar active="settings" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
        <div className="min-w-0 flex-1 overflow-y-auto"><SettingsNew role={role} /></div>
      </div>
    );
  }

  if (authed && nav === "tickets") {
    return (
      <div className="flex h-screen overflow-hidden">
        <PageSidebar active="tickets" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <Tickets role={role} userName={userName} onToast={(m) => { setAdminMsg(m); setTimeout(() => setAdminMsg(""), 2500); }} />
        </div>
      </div>
    );
  }

  if (authed && nav === "dashboard") {
    return (
      <div className="flex h-screen overflow-hidden">
        <PageSidebar active="dashboard" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <Dashboard userName={userName} role={role} />
        </div>
      </div>
    );
  }

  if (authed && nav === "articles") {
    return (
      <div className="flex h-screen overflow-hidden">
        <PageSidebar active="articles" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <Knowledge role={role} userName={userName} onToast={(m, k) => { k === "err" ? setAdminErr(m) : setAdminMsg(m); setTimeout(() => { setAdminMsg(""); setAdminErr(""); }, 2500); }} />
        </div>
      </div>
    );
  }

  // Users administration page (admin/agent) — wrapped with nav sidebar.
  if (authed && nav === "users") {
    return (
      <div className="flex min-h-screen">
        <PageSidebar active="users" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
        <div className="min-w-0 flex-1"><UsersPage /></div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Top bar */}
      <header className="topbar">
        <button className="hamburger lg:hidden" aria-label="Menu" onClick={() => setDrawer(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>
        </button>
        <div className="brand"><div className="logo">i</div>
          <div>IT Help Chatbot <div className="sub">Enterprise RAG Assistant</div></div>
        </div>
        <div className="chip">on-prem · LangChain · pgvector</div>
        <div className="status"><span className="dot" /> Online</div>
      </header>

      <div className={`layout ${drawer ? "drawer-open" : ""}`}>
        {/* Mobile backdrop */}
        {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)} />}
        {/* Sidebar (off-canvas <=860px via .layout.drawer-open) */}
        <aside className={`sidebar ${drawer ? "open" : ""}`}>
          <div className="navtitle">Workspace</div>
          {NAV.map((n) => (
            <div key={n.id} className={`navitem ${nav === n.id ? "active" : ""}`} onClick={() => { setNav(n.id); setDrawer(false); }}>
              <span className="ico">
                {n.id === "dashboard" && <LayoutDashboard className="size-4" />}
                {n.id === "articles" && <BookOpen className="size-4" />}
                {n.id === "tickets" && <TicketCheck className="size-4" />}
                {n.id === "users" && <UsersIcon className="size-4" />}
                {n.id === "history" && <MessagesSquare className="size-4" />}
                {n.id === "settings" && <SettingsIcon className="size-4" />}
              </span>{n.label}
            </div>
          ))}

          {/* Chat + conversations moved to the bottom (v0.21.34) */}
          <div className="navtitle" style={{ marginTop: "auto" }}>Conversations</div>
          <div key="chat" className={`navitem ${nav === "chat" ? "active" : ""}`} onClick={() => { setNav("chat"); setDrawer(false); }}>
            <span className="ico"><MessageSquareText className="size-4" /></span>Chat
          </div>

          {/* RECENT CONVERSATIONS (Phase 10) */}
          <div className="recent">
            <div className="recent-head">
              <span className="recent-title" title="RECENT CONVERSATIONS">RECENT CONVERSATIONS</span>
              {conversations.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="clear-btn" title="Clear conversations">
                      Clear <span style={{ fontSize: 9 }}>▾</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" sideOffset={4}>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setConfirmClear(true)}
                    >
                      <Trash2 className="size-3" />️ Clear all conversations…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {conversations.length === 0
              ? <div className="recent-empty">No conversations yet</div>
              : (
                <ul className="recent-list">
                  {conversations.map((c) => (
                    <li key={c.session_id}
                        className={`conv ${sessionRef.current === c.session_id ? "active" : ""}`}
                        onClick={() => openConversation(c.session_id)}>
                      <span className="conv-dot" />
                      <div className="conv-body">
                        <div className="conv-title">{c.title || "New conversation"}</div>
                        <div className="conv-when">{formatWhen(c.last_at)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            <button className="view-all" onClick={() => setNav("chat")}>View all conversations</button>
          </div>

          <div className="foot">
            <div className="profile-head">
              <div className="avatar user-profile">{(userName || "?").slice(0, 1).toUpperCase()}</div>
              <div className="profile-info">
                <div className="name">{userName || "User"}</div>
                <div className="role">IT Engineer {role ? `· ${role}` : ""}</div>
              </div>
            </div>
            <button className="btn signout-btn" onClick={() => setConfirmLogout(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Left panel — IT Lead + Find an Article (v0.6.1) */}
        {nav === "chat" && (
        <aside className="left-panel">
          <div className="card">
            <h4><Phone className="size-3" /> IT Lead</h4>
            {contact ? (
              <div className="contact-line">
                <div className="contact-row"><span className="contact-label">Name</span><span>{contact.name}</span></div>
                <div className="contact-row"><span className="contact-label">Email</span><a href={`mailto:${contact.email}`}>{contact.email}</a></div>
                <div className="contact-row"><span className="contact-label">Phone</span><span>{contact.phone}</span></div>
              </div>
            ) : <span className="muted" style={{ fontSize: 12 }}>—</span>}
          </div>

          <div className="card">
            <h4><Search className="size-3" /> Find an article</h4>
            <form onSubmit={onSearchArticles} className="artrow">
              <input placeholder="Search KB…" value={articleQuery} onChange={(e) => setArticleQuery(e.target.value)} />
              <button className="btn" type="submit">Go</button>
            </form>
            {articles.length > 0 && (
              <ul className="article-list">
                {articles.map((a, i) => (
                  <li key={i}>
                    <a href={a.source_url} target="_blank" rel="noreferrer">{a.title}</a>
                    <span className="badge conf">{a.confidence?.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}

            {(role === "admin" || role === "agent") && (
              <div className="manage-kb">
                <button type="button" className="mk-head" onClick={() => setMkOpen(!mkOpen)}>
                  <span><Wrench className="size-3" /> Manage KB {role === "admin" ? "(Admin)" : "(Agent)"}</span>
                  <ChevronDown className={`size-4 transition-transform ${mkOpen ? "" : "-rotate-90"}`} />
                </button>
                {mkOpen && (
                <div className="mk-body">
                  {adminMsg && <div className="mk-msg">{adminMsg}</div>}
                  {adminErr && <div className="mk-err">{adminErr}</div>}
                  <form onSubmit={onAddArticle} className="mk-form">
                    <input placeholder="Title" value={artForm.title} onChange={(e) => setArtForm({ ...artForm, title: e.target.value })} />
                    <textarea placeholder="Body (markdown)" value={artForm.body} onChange={(e) => setArtForm({ ...artForm, body: e.target.value })} rows={2} />
                    <input placeholder="Domain (general)" value={artForm.domain} onChange={(e) => setArtForm({ ...artForm, domain: e.target.value })} />
                    <button className="btn" type="submit"><Plus className="size-3" /> Add article</button>
                  </form>
                  <div className="mk-actions">
                    <button className="btn" onClick={onSync}><RotateCw className="size-3" /> Sync KB</button>
                  </div>
                </div>
                )}
              </div>
            )}
          </div>
        </aside>
        )}

        {/* Chat area */}
        {nav === "chat" && (
        <>
        {/* Chat */}
        <section className="chat">
          <div className="chat-scroll" ref={scrollRef}>
            {msgs.length === 0 && (
              <div className="empty">
                <div className="big"><MessageCircle className="size-3" /></div>
                <div><b>Ask the assistant anything</b></div>
                <div style={{ marginTop: 4 }}>e.g. "How do I resolve a PostgreSQL connection timeout?"</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <motion.div
                key={i}
                className={`msg-row ${m.role}`}
                initial={{ opacity: 0, y: 10, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              >
                {m.role === "assistant" && (
                  <div className="avatar assistant" title="IT Help Assistant">
                    iTH
                  </div>
                )}
                <div className={`msg ${m.role}`}>
                {m.role === "assistant" && m.meta && (
                  <div className="meta-row">
                    <span className="badge domain">{m.meta.domain ?? "general"}</span>
                    <span className="badge conf">conf {m.meta.confidence?.toFixed(3)}</span>
                    <span className={`badge ${m.meta.decision === "answer" ? "answer" : "caution"}`}>
                      {m.meta.decision === "answer" ? <><Check className="size-3" /> answer</> : <><AlertTriangle className="size-3" /> caution</>}
                    </span>
                    {m.meta.usage?.total_tokens != null ? (
                      <span
                        className="badge usage"
                        title={`Tokens used by the LLM for this answer. in=${m.meta.usage.input_tokens} out=${m.meta.usage.output_tokens}${m.meta.context_tokens_estimate != null ? ` · context≈${m.meta.context_tokens_estimate} tok` : ""}${m.meta.top_k ? ` · top_k=${m.meta.top_k}` : ""}`}
                      >
                        <Zap className="size-3" /> {m.meta.usage.total_tokens} tok
                        {m.meta.top_k ? ` · k${m.meta.top_k}` : ""}
                      </span>
                    ) : m.meta.context_tokens_estimate != null ? (
                      <span className="badge usage" title="RAG context size + top_k (LLM usage not reported)">
                        ctx≈{m.meta.context_tokens_estimate} tok · k{m.meta.top_k ?? "?"}
                      </span>
                    ) : null}
                  </div>
                )}
                <div className="bubble">
                  {m.role === "assistant" && m.meta
                    ? <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: MarkdownPre }}>{m.content || (busy ? "" : "_No answer_")}</ReactMarkdown></div>
                    : <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>}
                  {m.role === "assistant" && busy && !m.content && (
                    <span className="typing-dots" aria-label="assistant is thinking">
                      <motion.span animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: 0 }} />
                      <motion.span animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: 0.15 }} />
                      <motion.span animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: 0.3 }} />
                    </span>
                  )}
                  {m.role === "assistant" && m.content && !m.meta && busy && <span className="typing">·</span>}
                </div>
                <div className={`msg-time ${m.role}`}>
                  {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
                {m.role === "assistant" && m.caution && (
                  <div className="badge caution"><AlertTriangle className="size-3" />️ {m.caution}</div>
                )}
                {m.role === "assistant" && m.meta?.hits?.length ? (
                  <div className="src-inline">
                    <div className="src-label"><Search className="size-3" /> Sources (RAG)</div>
                    <AnimatePresence initial={false}>
                      {m.meta.hits.map((h, j) => (
                        <motion.div
                          key={j}
                          className="src-item"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.25, delay: 0.08 * j, ease: "easeOut" }}
                        >
                          {h.source_url
                            ? <a href={h.source_url} target="_blank" rel="noreferrer"><FileText className="size-3" /> {h.title || "Source"}</a>
                            : <span><FileText className="size-3" /> {h.title || "Source"}</span>}
                          <span className="sconf">({h.confidence?.toFixed(2)})</span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                ) : null}
                {m.role === "assistant" && (
                  <div className="fb-inline">
                    {fbSent[m.messageId ?? ""] ? (
                      <div className="fb-done">
                        <CheckCircle2 className="size-4" />
                        Feedback submitted — {fbSent[m.messageId ?? ""] === "helpful" ? "Helpful" : "Not Helpful"}
                      </div>
                    ) : (
                      <div className="fb-q">Was this answer helpful?</div>
                    )}
                    <div className="actions">
                      <button className="btn helpful" disabled={!m.messageId || !!fbSent[m.messageId ?? ""]} onClick={() => onFeedback(m.messageId, 1)}>
                        <ThumbsUp className="size-3.5" /> Helpful
                      </button>
                      <button className="btn unhelpful" disabled={!m.messageId || !!fbSent[m.messageId ?? ""]} onClick={() => setNhFor(m.messageId ?? null)}>
                        <ThumbsDown className="size-3.5" /> Not Helpful
                      </button>
                      <button className="btn esc" disabled={!m.content} onClick={() => onEscalateMsg(m, i)}>
                        <TicketPlus className="size-3.5" /> Escalate
                      </button>
                    </div>
                    {escKey === i && escalation && (
                      <div className="article-pill" style={{ marginTop: 8, background: "var(--warn-bg)", color: "#7c2d12" }}>
                        {escalation.error ? `<AlertTriangle className="size-3" />️ ${escalation.error}`
                          : `<AlertOctagon className="size-3" /> ${escalation.mode}${escalation.jira_key ? " · " + escalation.jira_key : ""}${escalation.reporter ? " · by " + escalation.reporter : ""} — opened`}
                      </div>
                    )}
                  </div>
                )}
                </div>{/* /.msg */}
                {m.role === "user" && (
                  <div className="avatar user" title={userName || "You"}>
                    {(userName || "U").slice(0, 1).toUpperCase()}
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {msgs.length === 0 && !busy && (
            <div className="quick-replies">
              <span className="qr-label">Try asking:</span>
              {["VPN troubleshooting", "DB connection timeout", "Reset Active Directory password", "Kubernetes pod restart"].map((q) => (
                <button
                  key={q}
                  type="button"
                  className="qr-chip"
                  onClick={() => { setQuery(q); requestAnimationFrame(() => { (document.querySelector("form.composer button.send") as HTMLButtonElement | null)?.click(); }); }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <form className="composer" onSubmit={ask}>
            <textarea
              placeholder="Ask about DB, VPN, passwords…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(e as any); } }}
            />
            <button className="send" type="submit" disabled={busy}>{busy ? "···" : "Send"}</button>
          </form>
        </section>

        {/* Confidence bar — above the composer (v0.6.1) */}
        {nav === "chat" && (
        <div className="confidence-bar">
          <span className="badge domain">{last?.meta?.domain ?? "general"}</span>
          <span className="badge conf">conf {last?.meta?.confidence?.toFixed(3) ?? "—"}</span>
          <span className={`badge ${last?.meta?.decision === "answer" ? "answer" : "caution"}`}>
            {last?.meta?.decision === "answer" ? <><Check className="size-3" /> answer</> : last?.meta ? <><AlertTriangle className="size-3" /> caution</> : "awaiting…"}
          </span>
          <span className="confidence-meta">{last?.meta ? "current answer" : "no question yet"}</span>
        </div>
        )}
        </>
        )}

        {/* Knowledge page — browse-first redesign (v0.4.0) */}
        {false && nav === "articles" && (
        <section className="page" data-nav="articles">
          <Knowledge role={role} userName={userName} onToast={(m, k) => { k === "err" ? setAdminErr(m) : setAdminMsg(m); setTimeout(() => { setAdminMsg(""); setAdminErr(""); }, 2500); }} />
        </section>
        )}

        {/* Tickets page — split-pane support desk (v0.11.0) */}
        {false && nav === "tickets" && (
        <div className="flex min-h-screen">
          <PageSidebar active="tickets" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
          <div className="min-w-0 flex-1">
        <section className="page" data-nav="tickets">
          <Tickets role={role} userName={userName} onToast={(m) => { setAdminMsg(m); setTimeout(() => { setAdminMsg(""); }, 2500); }} />
        </section>
          </div>
        </div>
        )}

        {/* Dashboard page — analytics overview (v0.11.0) */}
        {false && nav === "dashboard" && (
        <div className="flex min-h-screen">
          <PageSidebar active="dashboard" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
          <div className="min-w-0 flex-1">
        <section className="page" data-nav="dashboard">
          <Dashboard userName={userName} role={role} />
        </section>
          </div>
        </div>
        )}
        {/* Settings page (new layout, v0.14.0) */}
        {false && nav === "settings" && (
        <div className="flex min-h-screen">
          <PageSidebar active="settings" onNavigate={setNav} userName={userName} role={role} displayRole={meDisplay} perms={perms} onLogout={onLogout} />
          <div className="min-w-0 flex-1">
            <SettingsNew role={role} />
          </div>
        </div>
        )}
      </div>

      {/* Sign out — shadcn AlertDialog */}
      <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end your session and clear saved credentials on this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onLogout(); setConfirmLogout(false); }}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Not-Helpful reason modal (rich feedback loop) */}
      <AlertDialog open={!!nhFor} onOpenChange={(o) => !o && setNhFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>What went wrong?</AlertDialogTitle>
            <AlertDialogDescription>
              Help us improve retrieval — your note goes straight to the pipeline evaluation dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2.5 pt-1 pb-2">
            {["Outdated KB", "Hallucinated answer", "Wrong domain", "Missing source", "Other"].map((r) => (
              <button
                key={r}
                className="nh-reason rounded-lg border border-[var(--border)] px-4 py-3.5 text-left text-sm transition hover:border-[var(--ring)] hover:bg-[var(--accent-soft)] active:scale-[.99]"
                onClick={async () => {
                  const id = nhFor;
                  setNhFor(null);
                  if (!id) return;
                  await onFeedback(id, -1, r);
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear conversations — shadcn AlertDialog */}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear conversations?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all your chat history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => clearConvos()}>Clear all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


/* ============================================================
   PageSidebar — shared nav for non-chat pages (v0.13.0)
============================================================ */

function PageSidebar({
  active,
  onNavigate,
  userName,
  role,
  displayRole,
  perms,
  onLogout,
}: {
  active: string;
  onNavigate: (nav: string) => void;
  userName?: string;
  role?: string;
  displayRole?: string;
  perms?: Record<string, boolean>;
  onLogout?: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);

  // v0.21.57 — nav items are capability-aware. Locked items stay visible (so the
  // user knows the feature exists) but clicking one shows WHY access is denied.
  const items: Array<{ id: string; label: string; icon: React.ReactNode; cap?: string; capLabel?: string }> = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="size-4" />, cap: "chatbot", capLabel: "Ask the AI assistant" },
    { id: "dashboard", label: "Dashboard", icon: <Home className="size-4" /> },
    { id: "articles", label: "Knowledge", icon: <BookOpen className="size-4" />, cap: "kb_search", capLabel: "Search knowledge base" },
    { id: "tickets", label: "Tickets", icon: <TicketIcon className="size-4" /> },
    { id: "users", label: "Users", icon: <UsersIcon className="size-4" />, cap: "manage_users", capLabel: "Manage users, roles & settings" },
    { id: "history", label: "Conversations", icon: <MessagesSquare className="size-4" />, cap: "manage_users", capLabel: "Review conversation history" },
    { id: "audits", label: "Audit Log", icon: <ScrollText className="size-4" />, cap: "manage_users", capLabel: "View platform audit trail" },
    { id: "settings", label: "Settings", icon: <SettingsIcon className="size-4" /> },
  ];
  const pretty = displayRole || ({ admin: "Administrator", agent: "IT Support", knowledge: "Knowledge Manager" } as Record<string, string>)[role || "user"] || "User";

  const navBody = (
    <>
      <div className="flex h-16 items-center gap-3 border-b px-5 dark:border-slate-800">
        <div className="grid size-9 place-items-center rounded-xl bg-blue-600 text-xs font-bold text-white">iTH</div>
        <div>
          <div className="text-sm font-semibold">IT Help Chatbot</div>
          <div className="text-[10px] text-slate-400">Enterprise Assistant</div>
        </div>
      </div>
      
      <nav className="flex-1 px-3 py-4">
        {items.map((item) => {
          const locked = item.cap ? perms && perms[item.cap] === false : false;
          return (
            <div key={item.id}>
              <button
                onClick={() => {
                  if (locked) {
                    setDenied(denied === item.id ? null : item.id);
                    return;
                  }
                  setDenied(null);
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                title={locked ? `No permission: ${item.capLabel}` : undefined}
                className={[
                  "mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition",
                  active === item.id && !locked
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                  locked ? "opacity-60" : "",
                ].join(" ")}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {locked && (
                  <svg viewBox="0 0 24 24" className="size-3.5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
              </button>
              {locked && denied === item.id && (
                <div className="mb-2 mx-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[10px] leading-4 text-amber-200">
                  Access restricted — your role ({pretty}) does not have permission:
                  {" "}<b>{item.capLabel}</b>. Contact your administrator.
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t px-4 py-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            {(userName?.charAt(0) ?? "A").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-slate-100">{userName ?? "User"}</div>
            <span className={["mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold", (role === "admin" ? "bg-sky-500/20 text-sky-300" : role === "agent" ? "bg-cyan-500/20 text-cyan-300" : role === "knowledge" ? "bg-teal-500/20 text-teal-300" : "bg-slate-500/20 text-slate-300")].join(" ")}>
              {pretty}
            </span>
          </div>
          <button
            onClick={() => onLogout?.()}
            title="Sign out"
            className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-2.5 py-2 text-[10px] font-medium text-slate-300 transition hover:border-red-400 hover:bg-red-500/10 hover:text-red-300"
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
    </>
  );

  return (
    <>
      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b bg-white px-4 lg:hidden dark:border-slate-800 dark:bg-slate-900">
        <button
          onClick={() => setMobileOpen(true)}
          className="grid size-10 place-items-center rounded-lg hover:bg-muted"
          aria-label="Open navigation"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-blue-600 text-[10px] font-bold text-white">iTH</div>
          <span className="text-xs font-semibold">IT Help</span>
        </div>
        <div className="size-10" />
      </div>
      {/* Spacer for fixed top bar on mobile */}
      <div className="h-14 lg:hidden" />

      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-[250px] flex-col border-r bg-[var(--sidebar-bg)] transition-transform border-[var(--sidebar-border)] lg:static lg:z-auto lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        {navBody}
      </aside>
    </>
  );
}
