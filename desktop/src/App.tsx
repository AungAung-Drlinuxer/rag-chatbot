/** App shell — session bootstrap + hash-routed page switch.
 *
 * Governance (see desktop/README.md): this file owns NO endpoint logic and NO
 * feature UI. Feature pages live in src/features/<domain>/pages, shared nav in
 * components/PageSidebar.tsx, theme/router/session in src/app/.
 * B-3: collapsible sidebar (Cmd/Ctrl+B, persisted). B-4: global Cmd+K palette.
 */
import { useEffect, useState } from "react";
import { useToast, ToastHost } from "@/shared/useToast";
import PageSidebar from "@/components/PageSidebar";
import CommandPalette from "@/components/CommandPalette";
import { NeedHelpCard } from "@/components/NeedHelpCard";
import { FloatingChatProvider, FloatingChatPopup } from "@/components/FloatingChat";
import { useHashNav } from "@/app/router";
import { useSidebarCollapsed } from "@/app/useSidebar";
import { applyStoredTheme, applyUserPrefs } from "@/app/theme";
import { usernameFromToken } from "@/app/session";
import {
  setAuthToken, setRefreshToken, loadTokens, saveTokens, clearTokens,
} from "@/shared/api/client";
import { login, getMe } from "@/features/auth/api";
import { getMySettings } from "@/features/settings/api";

import LoginPage from "@/features/auth/pages/LoginPage";
import ChatPage from "@/features/chat/pages/ChatPage";
import DashboardPage from "@/features/dashboard/pages/DashboardPage";
import ApiKeysPage from "@/features/apikeys/pages/ApiKeysPage";
import InventoryPage from "@/features/inventory/pages/InventoryPage";
import KnowledgePage from "@/features/knowledge/pages/KnowledgePage";
import TicketsPage from "@/features/tickets/pages/TicketsPage";
// import DomainsPage from "@/features/domains/pages/DomainsPage"; // retired: merged into KnowledgePage tabs
import UsersPage from "@/features/users/pages/UsersPage";
import ConversationHistoryPage from "@/features/conversations/pages/ConversationHistoryPage";
import AuditsPage from "@/features/audits/pages/AuditsPage";
import SettingsPage from "@/features/settings/pages/SettingsPage";

export default function App() {
  // v0.21.44 — apply persisted theme on every page load (previously only Settings
  // did, so refreshing on other pages reset the theme).
  useEffect(() => { applyStoredTheme(); }, []);
  const [nav, setNav] = useHashNav();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toast = useToast();

  // B-4 — global Cmd/Ctrl+K opens the shell-level palette
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [authed, setAuthed] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState("");
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [meDisplay, setMeDisplay] = useState("");

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

  async function onLogin(e: React.FormEvent) {
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
      setNav("chat");
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
    setLoginUser("");
    setLoginPass("");
    setLoginErr("");
    setAuthed(false);
    // Note: Do NOT reset data-theme to light on logout so the user's preferred theme persists seamlessly
  }

  // v1.1.9 — JWT rotated server-side (secret rotation) → stale sessions can't recover.
  // Any page that gets a 401 after a failed refresh dispatches this; force logout → login page.
  useEffect(() => {
    const onExpired = () => {
      void onLogout();
      setLoginErr("Your session has expired — please sign in again.");
    };
    window.addEventListener("ith:session-expired", onExpired);
    return () => window.removeEventListener("ith:session-expired", onExpired);
  }, []);

  const shell = (active: string, children: React.ReactNode) => (
    <>
      <div className="flex h-screen overflow-hidden">
        <PageSidebar active={active} onNavigate={setNav} userName={userName} role={role}
          displayRole={meDisplay} perms={perms} onLogout={onLogout}
          collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        <div className={active === "chat" ? "min-w-0 flex-1 overflow-hidden" : "min-w-0 flex-1 overflow-y-auto"}>{children}</div>
      </div>
      {active !== "chat" && <NeedHelpCard />}
      <FloatingChatPopup />
      {authed && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onNavigate={setNav}
          onOpenConversation={(id) => { setNav("chat"); window.dispatchEvent(new CustomEvent("ith:open-conversation", { detail: id })); }}
          enabled={perms}
        />
      )}
      <ToastHost toast={toast.toast} />
    </>
  );

  if (!authed) {
    return (
      <LoginPage
        loginUser={loginUser} setLoginUser={setLoginUser}
        loginPass={loginPass} setLoginPass={setLoginPass}
        loginErr={loginErr} onSubmit={onLogin}
      />
    );
  }

  return (
    <FloatingChatProvider>
      {(() => { switch (nav) {
    case "chat":
      return shell("chat", <ChatPage userName={userName} role={role} displayRole={meDisplay} perms={perms} onNavigate={setNav} onLogout={onLogout} />);
    case "dashboard":
      return shell("dashboard", <DashboardPage userName={userName} role={role} />);
    case "articles":
      return shell("articles", <KnowledgePage role={role} userName={userName} perms={perms} onToast={toast.push} />);
    case "tickets":
      return shell("tickets", <TicketsPage role={role} userName={userName} onToast={toast.push} />);
    case "domains":
      return shell("articles", <KnowledgePage role={role} userName={userName} perms={perms} initialTab="domains" onToast={toast.push} />);
    case "inventory":
      return shell("inventory", <InventoryPage role={role} userName={userName} onToast={toast.push} />);
    case "users":
      return shell("users", <UsersPage />);
    case "apikeys":
      return shell("apikeys", <ApiKeysPage role={role} userName={userName} onToast={toast.push} />);
    case "history":
      return shell("history", <ConversationHistoryPage />);
    case "audits":
      return shell("audits", <AuditsPage />);
    case "settings":
      return shell("settings", <SettingsPage role={role} />);
    default:
      return (
        <>
          <ChatPage userName={userName} role={role} onNavigate={setNav} onLogout={onLogout} />
          {authed && (
            <CommandPalette
              open={paletteOpen}
              onClose={() => setPaletteOpen(false)}
              onNavigate={setNav}
              onOpenConversation={(id) => { setNav("chat"); window.dispatchEvent(new CustomEvent("ith:open-conversation", { detail: id })); }}
              enabled={perms}
            />
          )}
          <ToastHost toast={toast.toast} />
        </>
      );
      } })()}
    </FloatingChatProvider>
  );
}
