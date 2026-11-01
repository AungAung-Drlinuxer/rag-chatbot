import {
  Download,
  Printer,
  AlertTriangle,
  Check,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Shield,
  UserCheck,
  UserCog,
  Users as UsersIcon,
  UserX,
  X,
} from "lucide-react";

import { EmptyState, ErrorState, PageHeader, PageShell, SectionCard } from "@/components/ui/page";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import {
  listUsers,
  listDepartments,
  getUserPermissions,
  setUserPassword,
  createUser as createUserApi,
  resetUserAccess,
  updateUserRole,
  updateUserStatus,
} from "@/features/users/api";

/* ============================================================
   TYPES
============================================================ */

type UserStatus = "Active" | "Inactive" | "Locked" | "Disabled" | "Pending";

// v1.1.1 — Domain Manager merged into Knowledge Manager (Knowledge page owns
// both KB articles and the Domains & Routing engine).
type UserRole =
  | "Administrator"
  | "IT Support"
  | "Knowledge Manager"
  | "User";

type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  department: string;
  role: UserRole;
  roleOverride?: string | null;
  status: UserStatus;
  groups: string[];
  lastLogin: string;
  joined: string;
  source?: "ad" | "local";
};

type PermissionKey =
  | "chatbot"
  | "kb_search"
  | "create_tickets"
  | "manage_kb"
  | "manage_users"
  | "manage_domains";

type PermissionMap = Record<PermissionKey, boolean>;

// v1.3.6 — "Manage routing domains" merged into "Manage knowledge": the Knowledge
// page hosts BOTH article management AND routing-domain management, so one
// capability (manage_kb) governs both. manage_domains stays as a backend alias
// (granted whenever manage_kb is granted) for DB compatibility.
const RBAC_CAPABILITIES: { key: PermissionKey; label: string }[] = [
  { key: "chatbot", label: "Access chatbot" },
  { key: "kb_search", label: "Search knowledge base" },
  { key: "create_tickets", label: "Create tickets" },
  { key: "manage_kb", label: "Manage knowledge & routing domains" },
  { key: "manage_users", label: "Manage users" },
];

const EMPTY_PERMISSIONS: PermissionMap = {
  chatbot: false,
  kb_search: false,
  create_tickets: false,
  manage_kb: false,
  manage_users: false,
  manage_domains: false,
};

/* Role descriptions — shown in the role dropdown so admins pick correctly */
const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  Administrator: "Full control: users, KB, domains, tickets, settings",
  "IT Support": "Works tickets (view/edit all), syncs KB, receives escalations",
  "Knowledge Manager": "Manages KB articles AND the Domains & Routing engine",
  User: "End user: chat + search KB + own tickets only",
};

/* Normalize any backend/local variant (Agent, Admin, agent, IT Support…) to the
   canonical display role used across the UI. Backend /api/users capitalizes the
   role_override (agent -> Agent, admin -> Admin), LDAP-derived rows may be
   "IT Support"/"Administrator", and overrides may be raw enum keys. */
const ROLE_ALIASES: Record<string, UserRole> = {
  "agent": "IT Support",
  "admin": "Administrator",
  "administrator": "Administrator",
  "knowledge": "Knowledge Manager",
  "knowledge manager": "Knowledge Manager",
  // legacy merged role — domain manager == Knowledge Manager
  "domain_manager": "Knowledge Manager",
  "domain manager": "Knowledge Manager",
  "it support": "IT Support",
  "user": "User",
};

function normalizeRole(raw: string | null | undefined): UserRole {
  const key = (raw || "").trim().toLowerCase();
  return ROLE_ALIASES[key] ?? (([ "Administrator", "IT Support", "Knowledge Manager", "User" ].includes(raw || "") ? raw : "User") as UserRole);
}

/* Canonical role → permission defaults (matches backend /api/rbac/matrix) */
const ROLE_DEFAULTS: Record<UserRole, PermissionMap> = {
  Administrator: { chatbot: true, kb_search: true, create_tickets: true, manage_kb: true, manage_users: true, manage_domains: true },
  "Knowledge Manager": { chatbot: true, kb_search: true, create_tickets: false, manage_kb: true, manage_users: false, manage_domains: true },
  "IT Support": { chatbot: true, kb_search: true, create_tickets: true, manage_kb: false, manage_users: false, manage_domains: false },
  User: { chatbot: true, kb_search: true, create_tickets: false, manage_kb: false, manage_users: false, manage_domains: false },
};

/* Avatar tones — a deterministic colour per person, so two rows are told apart
   at a glance. Presentation only; nothing here is derived from account data. */
const AVATAR_TONES = [
  "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
];

function avatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/* ============================================================
   PAGE

   Layout follows the Workspace / Users mockup: breadcrumb + eyebrow + H1,
   secondary/secondary/PRIMARY action row, four equal summary cards, then ONE
   "Workspace members" panel (heading + count badge, search/filter toolbar, the
   directory table, a range + pager footer) and a muted note underneath.

   Colours are the app's design tokens (--primary #0048F0, --border, --accent,
   --muted) rather than the mockup's literal hexes: the mockup is dark-only and
   this page has to work in both themes.
============================================================ */

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [roleFilter, setRoleFilter] = useState("All");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* v0.21.80 — responsive pagination (real, not decorative) */
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  async function loadUsers(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    setError(null);
    try {
      const data = await listUsers();
      setUsers(((data.users ?? data ?? []) as User[]).map((u) => ({ ...u, role: normalizeRole(u.role as string) })));
    } catch (err: any) {
      // A swallowed failure used to render the EMPTY state, which says "no users
      // exist" when the truth is "the directory could not be read".
      console.warn("users fetch failed:", err);
      setError(err?.message || "Could not reach the user directory.");
      setUsers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadSupportingData() {
    try {
      const departmentData = await listDepartments();
      if (departmentData) setDepartments(departmentData.departments ?? []);
    } catch { /* Ignore supporting-data failures. */ }
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const data = await listUsers();
        if (mounted) setUsers(((data.users ?? data ?? []) as User[]).map((u) => ({ ...u, role: normalizeRole(u.role as string) })));
      } catch (err: any) {
        console.warn("users fetch failed:", err);
        if (mounted) setError(err?.message || "Could not reach the user directory.");
      } finally {
        if (mounted) setLoading(false);
      }
      if (!mounted) return;
      loadSupportingData();
    }
    load();
    return () => { mounted = false; };
  }, []);

  /* Every figure below is counted from the list this page already loaded —
     nothing is fetched twice and nothing is estimated. */
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.status === "Active").length;
  const adminUsers = users.filter((u) => u.role === "Administrator").length;
  const inactiveUsers = users.filter((u) => u.status !== "Active").length;
  const lockedUsers = users.filter((u) => u.status === "Locked").length;

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !query ||
        user.name.toLowerCase().includes(query) ||
        user.username.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query);
      const matchesStatus = statusFilter === "All" || user.status === statusFilter;
      const matchesRole = roleFilter === "All" || user.role === roleFilter;
      const matchesDepartment = departmentFilter === "All" || user.department === departmentFilter;
      return matchesSearch && matchesStatus && matchesRole && matchesDepartment;
    });
  }, [users, search, statusFilter, roleFilter, departmentFilter]);

  const departmentOptions = useMemo(() => {
    const values = [
      ...(departments ?? []).map((department: any) => department.name),
      ...users.map((user) => user.department).filter(
        (department) => department && department !== "—" && department !== "Internal"),
    ];
    return ["All", ...Array.from(new Set(values))];
  }, [departments, users]);

  function exportCsv() {
    const header = "Name,Username,Email,Department,Role,Status,Last login,Joined";
    const rows = filteredUsers.map((u) =>
      [u.name, u.username, u.email, u.department, u.role, u.status, u.lastLogin, u.joined]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const csv = "\ufeff" + [header, ...rows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `users-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  function printReport() {
    const rows = filteredUsers.map((u) => `
      <tr>
        <td>${u.name}</td><td>@${u.username}</td><td>${u.email}</td>
        <td>${u.department || "—"}</td><td>${u.role}</td><td>${u.status}</td>
        <td>${formatDateTime(u.lastLogin)}</td><td>${formatDate(u.joined)}</td>
      </tr>`).join("");
    const w = window.open("", "_blank", "width=1000,height=700");
    if (!w) return;
    w.document.write(`<html><head><title>Users report</title>
      <style>body{font-family:Inter,Segoe UI,sans-serif;padding:24px;color:#0f172a}
      h1{font-size:18px;margin:0 0 4px}p{font-size:11px;color:#64748b;margin:0 0 16px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{text-align:left;background:#f1f5f9;padding:8px;border-bottom:2px solid #e2e8f0}
      td{padding:7px 8px;border-bottom:1px solid #e2e8f0}
      .meta{margin-bottom:16px;font-size:10px;color:#94a3b8}</style></head><body>
      <h1>Users report — IT Help Chatbot</h1>
      <p class="meta">${filteredUsers.length} users · generated ${new Date().toLocaleString()} · filters: search="${search || "-"}", status=${statusFilter}, role=${roleFilter}, department=${departmentFilter}</p>
      <table><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th>Last login</th><th>Joined</th></tr></thead>
      <tbody>${rows}</tbody></table></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  function resetFilters() {
    setSearch(""); setStatusFilter("All"); setRoleFilter("All"); setDepartmentFilter("All");
  }

  async function toggleUser(userId: string) {
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    const shouldEnable = user.status === "Disabled" || user.status === "Inactive" || user.status === "Pending";
    try {
      const response = await updateUserStatus(user.username, shouldEnable);
      const newStatus = response.status as UserStatus;
      setUsers((current) => current.map((item) =>
        item.id === userId ? { ...item, status: newStatus } : item));
      setSelectedUser((current) =>
        current && current.id === userId ? { ...current, status: newStatus } : current);
    } catch (error) {
      console.warn("toggle user failed:", error);
    }
  }

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / perPage));
  const pagedUsers = useMemo(
    () => filteredUsers.slice((page - 1) * perPage, page * perPage),
    [filteredUsers, page, perPage]
  );
  useEffect(() => { setPage(1); }, [search, statusFilter, roleFilter, departmentFilter, perPage]);

  const hasFilters = Boolean(search || statusFilter !== "All" || roleFilter !== "All" || departmentFilter !== "All");
  const rangeStart = filteredUsers.length === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, filteredUsers.length);

  return (
    <PageShell>
      <div>
        <PageHeader
          breadcrumbs={["Workspace", "Users"]}
          eyebrow="Administration"
          icon={<UsersIcon className="size-5" />}
          title="Users"
          badge={`${totalUsers} users`}
          description="Manage workspace members and their access."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {/* Refresh and the printable report keep their behaviour; they are
                  icon-only so the row reads as the mockup's "one primary action". */}
              <button type="button" onClick={() => loadUsers(true)} disabled={refreshing}
                aria-label="Refresh users" title="Refresh users"
                className="grid size-10 place-items-center rounded-xl border border-[var(--border)] bg-card text-foreground shadow-sm transition hover:bg-[var(--muted)] disabled:opacity-50">
                <RefreshCw className={["size-3.5", refreshing ? "animate-spin" : ""].join(" ")} />
              </button>
              <button type="button" onClick={exportCsv} disabled={filteredUsers.length === 0}
                className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-card px-3.5 py-2.5 text-xs font-semibold shadow-sm transition hover:bg-[var(--muted)] disabled:opacity-50">
                <Download className="size-3.5" />
                Export CSV
              </button>
              <button type="button" onClick={printReport} disabled={filteredUsers.length === 0}
                aria-label="Print report" title="Print report"
                className="grid size-10 place-items-center rounded-xl border border-[var(--border)] bg-card text-foreground shadow-sm transition hover:bg-[var(--muted)] disabled:opacity-50">
                <Printer className="size-3.5" />
              </button>
              <button type="button" onClick={() => setShowAddUser(true)}
                className="flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-xs font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90">
                <Plus className="size-4" />
                Add user
              </button>
            </div>
          }
        />

        {/* summary cards — label left, icon right, big number, muted caption */}
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={<UsersIcon className="size-4" />} label="Total users"
            value={totalUsers} caption="Members in this workspace" />
          <SummaryCard icon={<UserCheck className="size-4" />} label="Active users"
            value={activeUsers} caption="Enabled accounts" />
          <SummaryCard icon={<Shield className="size-4" />} label="Administrators"
            value={adminUsers} caption="Full workspace control" />
          <SummaryCard icon={<UserX className="size-4" />} label="Inactive"
            value={inactiveUsers} caption="Disabled, locked or pending" />
        </div>

        <SectionCard
          title="Workspace members"
          actions={
            <span className="rounded-md bg-[var(--muted)] px-2 py-1 text-2xs font-medium text-muted-foreground">
              {filteredUsers.length === totalUsers
                ? `${totalUsers} users`
                : `${filteredUsers.length} of ${totalUsers} users`}
            </span>
          }
        >
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--border)] px-5 py-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, username or email…"
                aria-label="Search users"
                className="h-10 w-full min-w-[220px] rounded-lg border border-[var(--border)] bg-[var(--background)] pl-9 pr-9 text-xs outline-none transition placeholder:text-muted-foreground focus:border-[var(--primary)]"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-[var(--muted)] hover:text-foreground">
                  <X className="size-3" />
                </button>
              )}
            </div>
            {/* Status offers Locked/Disabled as well as the mockup's three: the
                backend really does return those states, and a filter that cannot
                reach a state the table shows is worse than no filter. */}
            <FilterSelect label="Status" allLabel="All statuses" value={statusFilter} onChange={setStatusFilter}
              options={["All", "Active", "Inactive", "Locked", "Disabled"]} />
            <FilterSelect label="Role" allLabel="All roles" value={roleFilter} onChange={setRoleFilter}
              options={["All", "Administrator", "IT Support", "Knowledge Manager", "User"]} />
            <FilterSelect label="Department" allLabel="All departments" value={departmentFilter} onChange={setDepartmentFilter}
              options={departmentOptions} />
            <button type="button" onClick={resetFilters} disabled={!hasFilters}
              className="h-10 rounded-lg border border-[var(--border)] bg-card px-3.5 text-xs font-semibold transition hover:bg-[var(--muted)] disabled:opacity-40">
              Reset
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[var(--muted)]/40">
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <Th>User</Th>
                  <Th>Department</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Last login</Th>
                  <Th>Joined</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  Array.from({ length: 7 }).map((_, index) => (
                    <tr key={"sk" + index} className="border-b border-[var(--border)]">
                      <td colSpan={7} className="px-5 py-4"><Skeleton className="h-9 w-full" /></td>
                    </tr>
                  ))
                )}
                {!loading && pagedUsers.map((user) => (
                  <UserRow key={user.id} user={user}
                    onSelect={() => setSelectedUser(user)}
                    onToggle={() => toggleUser(user.id)} />
                ))}
                {!loading && error && (
                  <tr>
                    <td colSpan={7}>
                      <ErrorState
                        compact
                        title="Could not load workspace members"
                        detail={error}
                        onRetry={() => loadUsers(true)}
                      />
                    </td>
                  </tr>
                )}
                {!loading && !error && filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      {/* Two different situations, two different messages: an empty
                          directory is a normal state, "nothing matches your filters"
                          is something the user can undo. */}
                      {users.length === 0 ? (
                        <EmptyState
                          icon={<UsersIcon className="size-5" />}
                          title="No workspace members yet"
                          description="Members appear here as they are created locally or synchronized from Active Directory."
                        />
                      ) : (
                        <EmptyState
                          icon={<SearchX className="size-5" />}
                          title="No users found"
                          description="Try changing your search or filters."
                          actionLabel="Clear filters"
                          onAction={resetFilters}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* range + pager footer */}
          {!loading && !error && filteredUsers.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">
                Showing {rangeStart} to {rangeEnd} of {filteredUsers.length} users
              </span>
              <div className="flex items-center gap-1.5">
                <PaginationButton label="‹" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
                {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => (
                  <PaginationButton key={i} label={String(i + 1)} active={page === i + 1}
                    onClick={() => setPage(i + 1)} />
                ))}
                {totalPages > 5 && <span className="px-1 text-xs text-muted-foreground">… {totalPages}</span>}
                <PaginationButton label="›" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} />
                <select className="ml-2 h-8 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-2xs"
                  value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} aria-label="Users per page">
                  <option value="10">10 / page</option>
                  <option value="25">25 / page</option>
                  <option value="50">50 / page</option>
                </select>
              </div>
            </div>
          )}
        </SectionCard>

        <p className="mt-4 flex flex-wrap justify-between gap-x-4 gap-y-1 text-2xs text-muted-foreground">
          <span>
            Counts are computed from the {totalUsers} member{totalUsers === 1 ? "" : "s"} returned by{" "}
            <code className="font-mono">/api/users</code> — no separate totals are fetched.
            {lockedUsers > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {" "}{lockedUsers} locked account{lockedUsers === 1 ? "" : "s"} — Require admin action.
              </span>
            )}
          </span>
          <span>
            Directory (AD) accounts are read from LDAP; only local accounts can have their password set here.
          </span>
        </p>

        {selectedUser && (
          <UserDrawer
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
            onUserUpdated={(updatedUser) => {
              setUsers((current) => current.map((item) => item.id === updatedUser.id ? updatedUser : item));
              setSelectedUser((current) => current && current.id === updatedUser.id ? { ...updatedUser, role: normalizeRole(updatedUser.role as string) } : current);
            }}
          />
        )}

        {showAddUser && <AddUserModal onClose={() => { setShowAddUser(false); loadUsers(); }} />}
      </div>
    </PageShell>
  );
}

/* ============================================================
   SUMMARY CARD
============================================================ */

function SummaryCard({ icon, label, value, caption }: {
  icon: ReactNode; label: string; value: number; caption: string;
}) {
  return (
    <div data-slot="summary-card" className="rounded-xl border border-[var(--border)] bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-[var(--accent-foreground)]">{icon}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-2xs text-muted-foreground">{caption}</div>
    </div>
  );
}

/* ============================================================
   TABLE HEADER
============================================================ */

function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th className={["border-y border-[var(--border)] px-5 py-3 text-left text-2xs font-semibold uppercase tracking-wide text-muted-foreground", className].join(" ")}>
      {children}
    </th>
  );
}

/* ============================================================
   USER ROW
============================================================ */

function UserRow({ user, onSelect, onToggle }: { user: User; onSelect: () => void; onToggle: () => void }) {
  const hasDepartment = Boolean(user.department) && user.department !== "—";
  const hasLogin = Boolean(user.lastLogin) && user.lastLogin !== "—";
  const hasJoined = Boolean(user.joined) && user.joined !== "—";
  const isActive = user.status === "Active";

  return (
    <tr className="border-b border-[var(--border)] transition hover:bg-[var(--muted)]/40">
      <td className="px-5 py-3.5">
        <button type="button" onClick={onSelect} className="flex min-w-0 items-center gap-3 text-left">
          <Avatar name={user.name} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold" title={user.name}>{user.name}</span>
              {user.username.endsWith("-svc") && (
                <span
                  title="Service account — used by system components, not a human user"
                  className="shrink-0 rounded border border-[var(--border)] bg-[var(--muted)] px-1 py-px text-3xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  system
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-2xs text-muted-foreground" title={user.email}>
              @{user.username} · {user.email}
            </span>
          </span>
        </button>
      </td>
      <td className="px-5 py-3.5">
        {hasDepartment ? (
          <span className="text-2xs" title={user.department}>{user.department}</span>
        ) : (
          <span className="text-2xs text-muted-foreground" title="No department assigned">—</span>
        )}
      </td>
      <td className="px-5 py-3.5"><RoleBadge role={user.role} /></td>
      <td className="px-5 py-3.5"><StatusBadge status={user.status} /></td>
      <td className="px-5 py-3.5">
        {hasLogin ? (
          <span className="text-2xs text-muted-foreground" title={user.lastLogin}>{formatDateTime(user.lastLogin)}</span>
        ) : (
          <span className="text-2xs text-muted-foreground" title="This account has never signed in">Never logged in</span>
        )}
      </td>
      <td className="px-5 py-3.5">
        {/* Local accounts carry no join date at all (the endpoint returns "—"),
            so the column says so rather than guessing at a sync source. */}
        {hasJoined ? (
          <span className="text-2xs text-muted-foreground" title={user.joined}>{formatDate(user.joined)}</span>
        ) : (
          <span className="text-2xs text-muted-foreground" title="No join date recorded by the directory">—</span>
        )}
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={onSelect}
            className="rounded-lg border border-[var(--border)] bg-card px-2.5 py-1.5 text-2xs font-semibold transition hover:bg-[var(--muted)]">
            Edit
          </button>
          <button type="button" onClick={onToggle}
            title={isActive ? "Disable user" : user.status === "Pending" ? "Approve registration" : "Enable user"}
            aria-label={isActive ? "Disable user" : "Enable user"}
            className="grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-[var(--muted)] hover:text-foreground">
            {isActive ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ============================================================
   AVATAR / ROLE BADGE / STATUS BADGE
============================================================ */

function Avatar({ name }: { name: string }) {
  return (
    <span className={["grid size-9 shrink-0 place-items-center rounded-full text-2xs font-bold", avatarTone(name)].join(" ")}>
      {getInitials(name)}
    </span>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  // v1.5.6 — distinct role colors: Administrator=violet, IT Support=sky, KM=teal, User=slate
  const styles: Record<UserRole, string> = {
    Administrator: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
    "IT Support": "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300",
    "Knowledge Manager": "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300",
    User: "border-[var(--border)] bg-[var(--muted)] text-muted-foreground",
  };
  return <span className={["inline-flex items-center rounded-md border px-2 py-0.5 text-3xs font-semibold", styles[role]].join(" ")}>{role}</span>;
}

function StatusBadge({ status }: { status: UserStatus }) {
  const config: Record<UserStatus, { className: string; dot: string }> = {
    Active: { className: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", dot: "bg-emerald-500" },
    Pending: { className: "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300", dot: "bg-sky-500" },
    Inactive: { className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", dot: "bg-slate-400" },
    Locked: { className: "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300", dot: "bg-red-500" },
    Disabled: { className: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", dot: "bg-amber-500" },
  };
  const item = config[status];
  return (
    <span className={["inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-3xs font-semibold", item.className].join(" ")}>
      <span className={["size-1.5 rounded-full", item.dot].join(" ")} />
      {status}
    </span>
  );
}

/* ============================================================
   FILTER SELECT / PAGINATION
============================================================ */

function FilterSelect({ value, onChange, options, label, allLabel }: {
  value: string; onChange: (value: string) => void; options: string[]; label: string; allLabel: string;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}
      className="h-10 min-w-[140px] rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none transition focus:border-[var(--primary)]">
      {options.map((option) => (
        <option key={option} value={option}>{option === "All" ? allLabel : option}</option>
      ))}
    </select>
  );
}

function PaginationButton({ label, active, disabled, onClick }: {
  label: string; active?: boolean; disabled?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={["grid size-8 place-items-center rounded-lg border border-[var(--border)] text-2xs font-medium transition",
        active ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "bg-card hover:bg-[var(--muted)]",
        disabled ? "cursor-not-allowed opacity-40" : ""].join(" ")}>
      {label}
    </button>
  );
}

/* ============================================================
   CONFIRM DIALOG — every destructive action goes through this
============================================================ */

function ConfirmDialog({ open, title, description, confirmLabel, destructive, busy, onConfirm, onCancel }: {
  open: boolean; title: string; description: ReactNode; confirmLabel: string;
  destructive?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} disabled={busy}
            onClick={onConfirm}>
            {busy ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ============================================================
   USER DRAWER

   The overlay the mockup is really about: person header, workspace role with a
   LIVE capability preview, the directory provenance, a source-specific security
   callout, and the account actions.

   HONESTY NOTES (checked against backend/app/api/users.py + admin_ops.py):
   - Role changes are a REAL write (PATCH /api/users/{u}/role → role_override);
     it applies on the user's next sign-in, which the panel says out loud.
   - The capability list is the role's DEFAULTS while a new role is picked, and
     the account's EFFECTIVE permissions (GET /api/users/{u}/permissions) when
     the selection is unchanged. The panel labels which of the two it is showing
     instead of presenting a guess as the saved state.
   - Local passwords are a REAL write (PUT /api/users/{u}/password) and the
     backend refuses LDAP-sourced accounts, so the AD branch has no form at all.
============================================================ */

function UserDrawer({ user, onClose, onUserUpdated }: {
  user: User; onClose: () => void; onUserUpdated?: (user: User) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>(user.role);
  const [permissions, setPermissions] = useState<PermissionMap>(EMPTY_PERMISSIONS);
  // The permissions endpoint also returns the account's EXPLICIT per-user grants
  // (`overrides`). The preview needs those — the role matrix alone is not a grant.
  const [overrides, setOverrides] = useState<Partial<PermissionMap>>({});
  const [loadingPermissions, setLoadingPermissions] = useState(true);
  const [savingRole, setSavingRole] = useState(false);
  const [roleSaved, setRoleSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<null | "disable" | "reset">(null);

  useEffect(() => {
    let mounted = true;
    async function loadPermissions() {
      setLoadingPermissions(true);
      try {
        const data = await getUserPermissions(user.username);
        if (!mounted) return;
        const eff = { ...EMPTY_PERMISSIONS, ...(data.effective ?? {}) };
        setPermissions({ ...eff, manage_domains: eff.manage_kb }); // v1.3.6 merged capability
        setOverrides((data.overrides ?? {}) as Partial<PermissionMap>);
      } catch (err: any) {
        if (mounted) setPermissions(EMPTY_PERMISSIONS);
        console.warn("Failed to load user permissions:", err);
      } finally {
        if (mounted) setLoadingPermissions(false);
      }
    }
    loadPermissions();
    return () => { mounted = false; };
  }, [user.username]);

  /* v0.21.80 — instant preview: while picking a role, show that role's default permissions
     (from ROLE_DEFAULTS + the account's explicit per-user grants). Saves re-fetch effective perms.
     v1.0.2 — the merge used the EFFECTIVE matrix as if it were an explicit grant, so the preview
     did not move for any account that had ever had its role changed (every such row carries a
     role_override). It now merges the `overrides` map the permissions endpoint returns, which is
     what an explicit grant actually is. */
  const previewPerms: PermissionMap = useMemo(() => {
    const defaults = ROLE_DEFAULTS[selectedRole] ?? EMPTY_PERMISSIONS;
    let base: PermissionMap;
    if (selectedRole === user.role) {
      base = permissions;
    } else {
      // merge: role defaults + the explicit per-user grants this account already holds
      const merged = { ...defaults } as PermissionMap;
      (Object.keys(merged) as PermissionKey[]).forEach((k) => {
        if (!merged[k] && overrides[k]) merged[k] = true; // keep explicit grants
      });
      base = merged;
    }
    // v1.3.6 — merged capability: manage_domains follows manage_kb (one switch in UI)
    return { ...base, manage_domains: base.manage_kb };
  }, [selectedRole, permissions, overrides, user.role]);

  const roleChanged = selectedRole !== user.role;

  async function saveRole() {
    if (!roleChanged) return;
    setSavingRole(true); setError(null); setRoleSaved(false);
    try {
      await updateUserRole(user.username, selectedRole);
      const updatedUser: User = { ...user, role: selectedRole, roleOverride: selectedRole.toLowerCase() };
      onUserUpdated?.({ ...updatedUser, role: normalizeRole(updatedUser.role as string) });
      setRoleSaved(true);
      window.setTimeout(() => setRoleSaved(false), 2500);
      try {
        getUserPermissions(user.username)
          .then((data) => setPermissions({ ...EMPTY_PERMISSIONS, ...(data.effective ?? {}) }))
          .catch(() => { /* Keep existing permission display. */ });
      } catch { /* Keep existing permission display. */ }
    } catch (err: any) {
      setError(err?.message || "Failed to update user role.");
    } finally {
      setSavingRole(false);
    }
  }

  async function handleResetAccess() {
    setBusy(true); setError(null);
    try {
      await resetUserAccess(user.username);
      onUserUpdated?.({ ...user, status: "Active" });
    } catch (err: any) {
      setError(err?.message || "Failed to reset user access.");
    } finally { setBusy(false); }
  }

  async function handleStatusChange() {
    setBusy(true); setError(null);
    const shouldEnable = user.status === "Disabled" || user.status === "Inactive";
    try {
      const response = await updateUserStatus(user.username, shouldEnable);
      onUserUpdated?.({ ...user, status: response.status as UserStatus });
    } catch (err: any) {
      setError(err?.message || "Failed to update account status.");
    } finally { setBusy(false); }
  }

  const isAdUser = user.source === "ad" || user.id?.startsWith("ad:");
  const shouldEnable = user.status === "Disabled" || user.status === "Inactive";

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-950/25 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[440px] flex-col border-l border-[var(--border)] bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <div className="text-sm font-semibold">User details</div>
            <div className="mt-0.5 text-2xs text-muted-foreground">Account and access information</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 transition hover:bg-[var(--muted)]" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* person header */}
          <div className="border-b border-[var(--border)] px-5 py-5">
            <div className="flex items-center gap-4">
              <span className={["grid size-14 shrink-0 place-items-center rounded-full text-sm font-bold", avatarTone(user.name)].join(" ")}>
                {getInitials(user.name)}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{user.name}</h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={user.email}>
                  @{user.username} · {user.email}
                </p>
                <div className="mt-2"><StatusBadge status={user.status} /></div>
              </div>
            </div>
          </div>

          <div className="space-y-7 p-5">
            {/* ACCOUNT */}
            <DrawerSection title="Account" icon={<UsersIcon className="size-4" />}>
              <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
                <InfoRow label="Email" value={user.email} />
                <InfoRow label="Department" value={user.department || "—"} />
                <InfoRow label="Account type" value={isAdUser ? "Active Directory" : "Local"} />
                <InfoRow label="Joined" value={formatDateTime(user.joined)} />
                <InfoRow label="Last login" value={formatDateTime(user.lastLogin)} />
              </div>
            </DrawerSection>

            {/* ACCESS */}
            <DrawerSection title="Workspace role" icon={<Shield className="size-4" />}>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-2xs font-medium text-muted-foreground">Role</label>
                  <select value={selectedRole}
                    onChange={(event) => { setSelectedRole(event.target.value as UserRole); setRoleSaved(false); }}
                    className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-xs font-medium outline-none transition focus:border-[var(--primary)]" aria-label="Role">
                    <option value="Administrator">Administrator</option>
                    <option value="IT Support">IT Support</option>
                    <option value="Knowledge Manager">Knowledge Manager</option>
                    <option value="User">User</option>
                  </select>
                  <p className="mt-1.5 text-2xs leading-4 text-muted-foreground">
                    {ROLE_DESCRIPTIONS[selectedRole]}
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-2xs font-medium text-muted-foreground">Permissions</span>
                    {roleChanged ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-3xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        Preview: {selectedRole}
                      </span>
                    ) : (
                      <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-3xs font-semibold text-[var(--accent-foreground)]">
                        Current: {user.role}
                      </span>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                    {loadingPermissions ? (
                      <div className="space-y-2 p-3">
                        <Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-full" />
                      </div>
                    ) : (
                      <div className="divide-y divide-[var(--border)]">
                        {RBAC_CAPABILITIES.map((capability) => {
                          const enabled = previewPerms[capability.key];
                          const changed = roleChanged && enabled !== !!permissions[capability.key];
                          return (
                            <div key={capability.key} data-slot="permission-row" data-enabled={enabled ? "true" : "false"}
                              className={["flex items-center gap-2.5 px-3 py-2.5",
                              changed ? "bg-amber-50/60 dark:bg-amber-950/20" : ""].join(" ")}>
                              <span className={["grid size-5 shrink-0 place-items-center rounded-full",
                                enabled ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : "bg-[var(--muted)] text-muted-foreground"].join(" ")}>
                                {enabled ? <Check className="size-3" /> : <X className="size-3" />}
                              </span>
                              <span className={["text-2xs", enabled ? "font-medium text-foreground" : "text-muted-foreground"].join(" ")}>
                                {capability.label}
                              </span>
                              {changed && (
                                <span className={["ml-auto rounded-full px-1.5 py-0.5 text-3xs font-semibold",
                                  enabled ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300"].join(" ")}>
                                  {enabled ? "+ new" : "− removed"}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Say which of the two lists is on screen. The preview is the
                      role's default matrix; the current list came from the API. */}
                  <p className="mt-2 text-2xs leading-4 text-muted-foreground">
                    {roleChanged
                      ? "Role defaults plus this account's explicit grants — nothing is saved until you apply the change."
                      : "Effective permissions reported by the permissions endpoint."}
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {roleSaved && <span className="mr-auto text-2xs font-medium text-emerald-600">Access updated ✓</span>}
                  {error && <span className="mr-auto max-w-[190px] truncate text-2xs text-red-600" title={error}>{error}</span>}
                  <button type="button" onClick={saveRole} disabled={savingRole || !roleChanged}
                    className="rounded-lg bg-[var(--primary)] px-4 py-2.5 text-2xs font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                    {savingRole ? "Saving..." : "Save access changes"}
                  </button>
                </div>
                <p className="text-2xs leading-4 text-muted-foreground">
                  Writes the role override through <code className="font-mono">PATCH /api/users/…/role</code>;
                  it takes effect the next time this user signs in.
                </p>
              </div>
            </DrawerSection>

            {/* DIRECTORY */}
            <DrawerSection title="Directory" icon={<UserCog className="size-4" />}>
              <div className="space-y-4">
                <InfoRow label="Source" value={isAdUser ? "Active Directory" : "Local"} />
                <div>
                  <div className="mb-2 text-2xs font-medium">Groups</div>
                  {user.groups.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {user.groups.map((group) => (
                        <span key={group} className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-2xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                          {group}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--border)] p-4 text-center text-2xs text-muted-foreground">
                      No directory groups assigned.
                    </div>
                  )}
                </div>
              </div>
            </DrawerSection>

            {/* SECURITY */}
            <DrawerSection title="Security" icon={<KeyRound className="size-4" />}>
              {isAdUser ? (
                <div className="rounded-xl bg-amber-50 p-3.5 dark:bg-amber-950/30">
                  <div className="flex gap-3">
                    <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      <KeyRound className="size-4" />
                    </div>
                    <div>
                      <div className="text-2xs font-semibold text-amber-900 dark:text-amber-200">Managed by Active Directory</div>
                      <p className="mt-1 text-2xs leading-4 text-amber-800 dark:text-amber-300">
                        This password is managed in Active Directory and cannot be changed here.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* The local branch is NOT read-only: PUT /users/{u}/password really
                      writes, so the callout says that instead of claiming nothing happens. */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-3.5">
                    <div className="flex gap-3">
                      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
                        <KeyRound className="size-4" />
                      </div>
                      <div>
                        <div className="text-2xs font-semibold text-foreground">Local account</div>
                        <p className="mt-1 text-2xs leading-4 text-muted-foreground">
                          This password is stored by this application — a change below is applied immediately.
                        </p>
                      </div>
                    </div>
                  </div>
                  <LocalPasswordForm username={user.username} />
                </div>
              )}
            </DrawerSection>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-2xs leading-4 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[var(--border)] bg-card p-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => setConfirmKind("reset")}
              className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2.5 text-2xs font-semibold transition hover:bg-[var(--muted)] disabled:opacity-50">
              <RefreshCw className="size-3.5" /> Reset access
            </button>
            <button type="button" disabled={busy}
              onClick={() => { if (shouldEnable) { void handleStatusChange(); } else { setConfirmKind("disable"); } }}
              className={["flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-2xs font-semibold transition disabled:opacity-50",
                shouldEnable
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300"
                  : "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"].join(" ")}>
              {shouldEnable ? <><UserCheck className="size-3.5" /> Enable user</> : <><UserX className="size-3.5" /> Disable user</>}
            </button>
          </div>
        </div>

        {/* Disabling revokes access immediately (the backend invalidates the token),
            and reset-access forces a fresh sign-in — both ask first. */}
        <ConfirmDialog
          open={confirmKind === "disable"}
          destructive
          busy={busy}
          title={`Disable ${user.name}?`}
          description="They are signed out straight away and cannot sign in again until an administrator re-enables the account."
          confirmLabel="Disable user"
          onCancel={() => setConfirmKind(null)}
          onConfirm={() => { setConfirmKind(null); void handleStatusChange(); }}
        />
        <ConfirmDialog
          open={confirmKind === "reset"}
          busy={busy}
          title={`Force ${user.name} to sign in again?`}
          description="This invalidates their refresh tokens so the next request needs a fresh sign-in, and the account status is set back to Active."
          confirmLabel="Reset access"
          onCancel={() => setConfirmKind(null)}
          onConfirm={() => { setConfirmKind(null); void handleResetAccess(); }}
        />
      </aside>
    </div>
  );
}

/* ============================================================
   DRAWER SECTION / INFO ROW
============================================================ */

function DrawerSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[var(--accent-foreground)]">{icon}</span>
        <h3 className="text-xs font-bold uppercase tracking-wide">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[40px] items-center justify-between gap-4 px-3">
      <span className="shrink-0 text-2xs text-muted-foreground">{label}</span>
      <span className="max-w-[245px] truncate text-right text-2xs font-medium" title={value}>{value}</span>
    </div>
  );
}

/* ============================================================
   LOCAL PASSWORD
============================================================ */

function LocalPasswordForm({ username }: { username: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function savePassword() {
    if (password.length < 8) return;
    setBusy(true); setMessage(null); setError(null);
    try {
      await setUserPassword(username, password);
      setPassword("");
      setMessage("Password updated ✓");
    } catch (err: any) {
      setError(err?.message || "Failed to update password.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)}
        placeholder="New password (min 8 characters)"
        className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-2xs outline-none transition placeholder:text-muted-foreground focus:border-[var(--primary)]"  aria-label="New password"/>
      <div className="flex items-center justify-between gap-2">
        {message && <span className="text-2xs font-medium text-emerald-600">{message}</span>}
        {error && <span className="text-2xs text-red-600">{error}</span>}
        <button type="button" onClick={savePassword} disabled={busy || password.length < 8}
          className="ml-auto rounded-lg bg-[var(--primary)] px-4 py-2 text-2xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-40">
          {busy ? "Updating..." : "Update password"}
        </button>
      </div>
    </div>
  );
}



/* ============================================================
   ADD USER MODAL
============================================================ */

function AddUserModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState<UserRole>("User");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createUser() {
    if (!username.trim() || !displayName.trim() || !email.trim()) {
      setError("Username, display name and email are required.");
      return;
    }
    setSaving(true); setError(null);
    try {
      await createUserApi({ username: username.trim(), name: displayName.trim(), email: email.trim(), department: department.trim(), role, password });
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to create user.");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-[520px] overflow-hidden rounded-2xl border border-[var(--border)] bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Add user</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">Create a local account or provision an account for directory access.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-[var(--muted)]">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <InputField label="Username" value={username} onChange={setUsername} placeholder="e.g. john.smith" />
          <InputField label="Display name" value={displayName} onChange={setDisplayName} placeholder="John Smith" />
          <InputField label="Email" value={email} onChange={setEmail} placeholder="john.smith@company.com" type="email" />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label="Department" value={department} onChange={setDepartment} placeholder="IT Operations" />
            <div>
              <label className="mb-1.5 block text-2xs font-semibold">Role</label>
              <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}
                className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none" aria-label="Role">
                <option value="User">User</option>
                <option value="IT Support">IT Support</option>
                <option value="Knowledge Manager">Knowledge Manager</option>
                <option value="Administrator">Administrator</option>
              </select>
            </div>
          </div>
          <InputField label="Password" value={password} onChange={setPassword} placeholder="Minimum 8 characters" type="password" />
          <div className="rounded-xl bg-[var(--accent)] p-3 text-2xs leading-4 text-[var(--accent-foreground)]">
            <div className="flex gap-2">
              <Shield className="mt-0.5 size-3.5 shrink-0" />
              <span>LDAP / AD users should normally be synchronized from Active Directory. Their passwords are managed by AD.</span>
            </div>
          </div>
          {error && (
            <div className="flex gap-2 rounded-xl bg-red-50 p-3 text-2xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] p-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-2xs font-semibold hover:bg-[var(--muted)]">Cancel</button>
          <button type="button" onClick={createUser} disabled={saving}
            className="rounded-lg bg-[var(--primary)] px-5 py-2.5 text-2xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-40">
            {saving ? "Creating..." : "Create user"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   INPUT FIELD / HELPERS
============================================================ */

function InputField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-2xs font-semibold">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-xs outline-none placeholder:text-muted-foreground focus:border-[var(--primary)]" />
    </label>
  );
}

function getInitials(name: string) {
  return name.split(" ").map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase();
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
