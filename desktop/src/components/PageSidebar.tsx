/** Shared nav sidebar for non-chat pages (extracted verbatim from App.tsx).
 * Capability-aware nav (v0.21.57): locked items stay visible; clicking shows WHY. */
import { useEffect, useState } from "react";
import { useBranding } from "@/app/useBranding";
import {
  BookOpen, Bot, ChevronDown, ChevronRight, Home, MessageSquare, MessagesSquare, PanelLeftClose, PanelLeftOpen,
  Pin, Pencil, Trash2, MoreHorizontal, ScrollText, Settings as SettingsIcon, Ticket as TicketIcon, Users as UsersIcon,
} from "lucide-react";
import { useNotifications, NotificationBell } from "@/components/NotificationBell";
import {
  listConversations,
  deleteConversation,
  clearConversations,
  renameConversation,
  pinConversation,
} from "@/features/conversations/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ============================================================
   PageSidebar — shared nav for non-chat pages (v0.13.0)
============================================================ */

export default function PageSidebar({
  active,
  onNavigate,
  userName,
  role,
  displayRole,
  perms,
  onLogout,
  collapsed = false,
  onToggleCollapsed,
}: {
  active: string;
  onNavigate: (nav: string) => void;
  userName?: string;
  role?: string;
  displayRole?: string;
  perms?: Record<string, boolean>;
  onLogout?: () => void;
  collapsed?: boolean;      // B-3: icon rail mode (Cmd/Ctrl+B)
  onToggleCollapsed?: () => void;
}) {
  const branding = useBranding();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [conversations, setConversations] = useState<any[]>([]);

  const [activeSessionId, setActiveSessionId] = useState<string>("");

  const loadHistory = () => {
    listConversations()
      .then((res: any) => setConversations(res?.conversations ?? []))
      .catch(() => setConversations([]));
  };

  useEffect(() => {
    loadHistory();
    const handleRefresh = (e?: any) => {
      loadHistory();
      if (e?.detail) {
        setActiveSessionId(e.detail);
      }
    };
    const handleOpen = (e: any) => {
      if (e?.detail) {
        setActiveSessionId(e.detail);
      }
    };
    window.addEventListener("ith:refresh-conversations", handleRefresh);
    window.addEventListener("ith:open-conversation", handleOpen);
    window.addEventListener("ith:new-chat-started", () => setActiveSessionId(""));
    return () => {
      window.removeEventListener("ith:refresh-conversations", handleRefresh);
      window.removeEventListener("ith:open-conversation", handleOpen);
      window.removeEventListener("ith:new-chat-started", () => setActiveSessionId(""));
    };
  }, []);
  // B-6 — admin/agent see HITL approvals + LDAP-gated accounts as notifications
  const canManage = role === "admin" || role === "agent";
  const notices = useNotifications(role || "user", !!canManage);

  // v0.21.57 — nav items are capability-aware. Locked items stay visible (so the
  // user knows the feature exists) but clicking one shows WHY access is denied.
  const items: Array<{ id: string; label: string; icon: React.ReactNode; cap?: string; capLabel?: string }> = [
    { id: "chat", label: "+ New", icon: <MessageSquare className="size-4" />, cap: "chatbot", capLabel: "Ask the AI assistant" },
    { id: "dashboard", label: "Dashboard", icon: <Home className="size-4" /> },
    { id: "articles", label: "Knowledge", icon: <BookOpen className="size-4" />, cap: "kb_search", capLabel: "Search knowledge base & domains" },
    { id: "tickets", label: "Tickets", icon: <TicketIcon className="size-4" /> },
    { id: "users", label: "Users", icon: <UsersIcon className="size-4" />, cap: "manage_users", capLabel: "Manage users, roles & settings" },
    { id: "history", label: "Conversations", icon: <MessagesSquare className="size-4" />, cap: "manage_users", capLabel: "Review organization conversation history" },
    { id: "audits", label: "Audit Log", icon: <ScrollText className="size-4" />, cap: "manage_users", capLabel: "View platform audit trail" },
    { id: "settings", label: "Settings", icon: <SettingsIcon className="size-4" /> },
  ];
  const pretty = displayRole || ({ admin: "Administrator", agent: "IT Support", knowledge: "Knowledge Manager", domain_manager: "Domain Manager" } as Record<string, string>)[role || "user"] || "User";

  const navBody = (
    <>
      {collapsed ? (
        /* Rail mode: top brand avatar or expand button */
        <div className="flex flex-col items-center justify-center gap-2 border-b py-3 dark:border-slate-800">
          {branding.logo ? (
            <img src={branding.logo} alt="Logo" className="size-8 rounded-lg object-contain" />
          ) : (
            <div className="grid size-8 place-items-center rounded-lg bg-blue-600 text-xs font-bold text-white">iTH</div>
          )}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              title="Expand sidebar (Ctrl+B)"
              aria-label="Expand sidebar"
              className="mt-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex h-16 items-center justify-between border-b px-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            {branding.logo ? (
              <img src={branding.logo} alt="Company logo" className="size-8 shrink-0 rounded-xl object-contain" />
            ) : (
              <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-blue-600 text-xs font-bold text-white shadow-xs">iTH</div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-100 truncate">{branding.appName || "IT Help Chatbot"}</div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("ith:restore-assistant-btn"));
              }}
              title="Assistant widget"
              aria-label="Show floating assistant button"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
            >
              <Bot className="size-4" />
            </button>
            {canManage && (
              <NotificationBell notices={notices} collapsed={collapsed} onOpen={onNavigate} />
            )}
            {onToggleCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                title="Collapse sidebar (Ctrl+B)"
                aria-label="Collapse sidebar"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
              >
                <PanelLeftClose className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <nav className={"flex-1 py-4 " + (collapsed ? "px-2" : "px-3")}>
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
                  if (item.id === "chat") {
                    window.dispatchEvent(new CustomEvent("ith:new-chat"));
                  }
                  setMobileOpen(false);
                }}
                title={locked ? `No permission: ${item.capLabel}` : collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={[
                  "mb-1 flex w-full items-center rounded-lg text-left text-xs font-medium transition",
                  collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
                  active === item.id && !locked
                    ? "bg-sky-500/15 text-sky-400 font-semibold shadow-xs"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100",
                  locked ? "opacity-60" : "",
                ].join(" ")}
              >
                {item.icon}
                {!collapsed && <span className="flex-1">{item.label}</span>}
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

        {/* Recent Chat History in Sidebar */}
        {!collapsed && (
          <div className="mt-4 pt-3 border-t border-[var(--sidebar-border)]/60">
            <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold tracking-wider text-slate-400">
              <button
                type="button"
                onClick={() => setHistoryOpen(!historyOpen)}
                className="flex items-center gap-1.5 hover:text-slate-200 transition"
              >
                <span>History</span>
                <span className="text-[10px] text-slate-500 font-normal">({conversations.length})</span>
                {historyOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
              {conversations.length > 0 && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (window.confirm("Are you sure you want to delete all chat history? This cannot be undone.")) {
                      try {
                        await clearConversations();
                        loadHistory();
                        setActiveSessionId("");
                        window.dispatchEvent(new CustomEvent("ith:new-chat"));
                      } catch {
                        // ignore error
                      }
                    }
                  }}
                  className="rounded p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 transition"
                  title="Delete all history"
                  aria-label="Delete all history"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>

            {historyOpen && (
              <div className="mt-1 space-y-0.5 max-h-60 overflow-y-auto pr-1">
                {conversations.length === 0 ? (
                  <p className="px-2 py-2 text-[10px] text-slate-500 italic">No recent chats</p>
                ) : (
                  conversations.map((c) => {
                    const isSelected = activeSessionId === c.session_id;
                    return (
                    <div key={c.session_id} className="group relative flex items-center">
                      <button
                        type="button"
                        onClick={() => {
                          onNavigate("chat");
                          setActiveSessionId(c.session_id);
                          window.dispatchEvent(new CustomEvent("ith:open-conversation", { detail: c.session_id }));
                          setMobileOpen(false);
                        }}
                        className={[
                          "flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs transition",
                          isSelected
                            ? "bg-blue-600/20 text-blue-300 font-semibold border-l-2 border-blue-500 pl-1.5"
                            : "text-slate-300 hover:bg-slate-800/60 hover:text-white",
                        ].join(" ")}
                        title={c.title || "Untitled chat"}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          {c.is_pinned && <Pin className="size-3 shrink-0 text-sky-400 rotate-45" />}
                          <span className="truncate">{c.title || "Untitled chat"}</span>
                        </span>
                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 transition"
                            title="Actions"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem
                            onClick={() => {
                              pinConversation(c.session_id, !c.is_pinned).then(loadHistory);
                            }}
                            className="flex items-center gap-2 text-xs"
                          >
                            <Pin className="size-3.5" />
                            {c.is_pinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              const newT = window.prompt("Rename chat:", c.title || "");
                              if (newT && newT.trim()) {
                                renameConversation(c.session_id, newT.trim()).then(loadHistory);
                              }
                            }}
                            className="flex items-center gap-2 text-xs"
                          >
                            <Pencil className="size-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              if (window.confirm("Delete this conversation?")) {
                                deleteConversation(c.session_id).then(loadHistory);
                              }
                            }}
                            className="flex items-center gap-2 text-xs text-rose-500 focus:text-rose-500"
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </nav>
      <div className={"border-t py-4 dark:border-slate-800 " + (collapsed ? "px-2" : "px-4")}>
        <div className={"flex items-center " + (collapsed ? "flex-col gap-2" : "gap-3")}>
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" title={collapsed ? (userName ?? "User") + " · " + pretty : undefined}>
            {(userName?.charAt(0) ?? "A").toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-slate-100">{userName ?? "User"}</div>
              <span className={["mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", (role === "admin" ? "bg-sky-500/20 text-sky-300" : role === "agent" ? "bg-cyan-500/20 text-cyan-300" : role === "knowledge" ? "bg-teal-500/20 text-teal-300" : "bg-slate-500/20 text-slate-300")].join(" ")}>
                {pretty}
              </span>
            </div>
          )}
          <button
            onClick={() => onLogout?.()}
            title="Sign out"
            className={"flex items-center rounded-lg border border-slate-600 text-[10px] font-medium text-slate-300 transition hover:border-red-400 hover:bg-red-500/10 hover:text-red-300 " + (collapsed ? "p-2" : "gap-1.5 px-2.5 py-2")}
          >
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            {!collapsed && "Sign out"}
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
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-[var(--sidebar-bg)] transition-all border-[var(--sidebar-border)] lg:static lg:z-auto lg:translate-x-0 " + (collapsed ? "w-[72px]" : "w-[250px]"),
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        {navBody}
      </aside>
    </>
  );
}
