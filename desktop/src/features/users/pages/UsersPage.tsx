import {
  Download,
  Printer,
  Activity,
  Check,
  ChevronDown,
  CircleUserRound,
  KeyRound,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Shield,
  UserCheck,
  UserCog,
  Users as UsersIcon,
  UserX,
  X,
} from "lucide-react";

import { PageShell, PageHeader } from "@/components/ui/page";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

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

const RBAC_CAPABILITIES: { key: PermissionKey; label: string }[] = [
  { key: "chatbot", label: "Access chatbot" },
  { key: "kb_search", label: "Search knowledge base" },
  { key: "create_tickets", label: "Create tickets" },
  { key: "manage_kb", label: "Manage knowledge" },
  { key: "manage_users", label: "Manage users" },
  { key: "manage_domains", label: "Manage routing domains" },
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
  return ROLE_ALIASES[key] ?? ((["Administrator", "IT Support", "Knowledge Manager", "User"].includes(raw || "") ? raw : "User") as UserRole);
}

/* Canonical role → permission defaults (matches backend /api/rbac/matrix) */
const ROLE_DEFAULTS: Record<UserRole, PermissionMap> = {
  Administrator: { chatbot: true, kb_search: true, create_tickets: true, manage_kb: true, manage_users: true, manage_domains: true },
  "Knowledge Manager": { chatbot: true, kb_search: true, create_tickets: false, manage_kb: true, manage_users: false, manage_domains: true },
  "IT Support": { chatbot: true, kb_search: true, create_tickets: true, manage_kb: false, manage_users: false, manage_domains: false },
  User: { chatbot: true, kb_search: true, create_tickets: false, manage_kb: false, manage_users: false, manage_domains: false },
};

/* ============================================================
   PAGE
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

  async function loadUsers(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    try {
      const data = await listUsers();
      setUsers(((data.users ?? data ?? []) as User[]).map((u) => ({ ...u, role: normalizeRole(u.role as string) })));
    } catch (error) {
      console.warn("users fetch failed:", error);
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
      } catch (error) {
        console.warn("users fetch failed:", error);
      } finally {
        if (mounted) setLoading(false);
      }
      if (!mounted) return;
      loadSupportingData();
    }
    load();
    return () => { mounted = false; };
  }, []);

  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.status === "Active").length;
  const inactiveUsers = users.filter((u) => u.status === "Inactive" || u.status === "Disabled").length;
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

  /* v0.21.80 — responsive pagination (real, not decorative) */
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / perPage));
  const pagedUsers = useMemo(
    () => filteredUsers.slice((page - 1) * perPage, page * perPage),
    [filteredUsers, page, perPage]
  );
  useEffect(() => { setPage(1); }, [search, statusFilter, roleFilter, departmentFilter, perPage]);

  return (
    <PageShell>
      <div className="text-[13px]">
        <PageHeader
          icon={<UsersIcon className="size-5" />}
          title="Users"
          badge={`${totalUsers} users`}
          description="Manage system users, roles, and access."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => loadUsers(true)} disabled={refreshing}
                className="hidden items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-[11px] font-semibold shadow-sm transition hover:bg-slate-50 disabled:opacity-50 sm:flex dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
                <RefreshCw className={["size-3.5", refreshing ? "animate-spin" : ""].join(" ")} />
                Refresh
              </button>
              <button type="button" onClick={exportCsv}
                className="hidden items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-[11px] font-semibold shadow-sm transition hover:bg-slate-50 sm:flex dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
                <Download className="size-3.5" />
                Export CSV
              </button>
              <button type="button" onClick={printReport}
                className="hidden items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-[11px] font-semibold shadow-sm transition hover:bg-slate-50 sm:flex dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
                <Printer className="size-3.5" />
                Report
              </button>
              <button type="button" onClick={() => setShowAddUser(true)}
                className="flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-sky-600">
                <Plus className="size-4" />
                Add user
              </button>
            </div>
          }
        />

        <div className="p-5 lg:p-8">
          <div className="mx-auto max-w-[1400px]">
            {/* STAT CARDS */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={<UsersIcon className="size-5" />} title="Total users" value={totalUsers} description="All system users" />
              <StatCard icon={<UserCheck className="size-5" />} title="Active" value={activeUsers} description="Enabled accounts" positive />
              <StatCard icon={<UserX className="size-5" />} title="Inactive" value={inactiveUsers} description="Disabled accounts" />
              <StatCard icon={<Shield className="size-5" />} title="Locked" value={lockedUsers} description="Require admin action" warning />
            </div>

            {/* USERS TABLE */}
            <div className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b p-4 dark:border-slate-800">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div className="flex h-10 min-w-0 max-w-[420px] flex-1 items-center gap-2 rounded-xl border bg-slate-50 px-3 dark:border-slate-700 dark:bg-slate-800">
                      <Search className="size-4 shrink-0 text-muted-foreground" />
                      <input value={search} onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search by name, username or email..."
                        className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
                      {search && (
                        <button type="button" onClick={() => setSearch("")}
                          className="rounded-md p-1 hover:bg-slate-200 dark:hover:bg-slate-700">
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}
                      options={["All", "Active", "Inactive", "Locked", "Disabled"]} />
                    <FilterSelect label="Role" value={roleFilter} onChange={setRoleFilter}
                      options={["All", "Administrator", "IT Support", "Knowledge Manager", "User"]} />
                    <FilterSelect label="Department" value={departmentFilter} onChange={setDepartmentFilter}
                      options={departmentOptions} />
                    <button type="button" onClick={resetFilters} title="Clear filters"
                      className="grid size-10 place-items-center rounded-xl border hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      <RefreshCw className="size-3.5 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_#e2e8f0] dark:bg-slate-900 dark:shadow-[0_1px_0_#1e293b]">
                    <tr className="border-b text-left dark:border-slate-800">
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
                    {loading ? (
                      Array.from({ length: 7 }).map((_, index) => (
                        <tr key={index} className="border-b dark:border-slate-800">
                          <td colSpan={7} className="px-4 py-4"><Skeleton className="h-9 w-full" /></td>
                        </tr>
                      ))
                    ) : (
                      pagedUsers.map((user) => (
                        <UserRow key={user.id} user={user}
                          onSelect={() => setSelectedUser(user)}
                          onToggle={() => toggleUser(user.id)} />
                      ))
                    )}
                  </tbody>
                </table>
                {!loading && filteredUsers.length === 0 && <EmptyState onReset={resetFilters} />}
              </div>

              {!loading && filteredUsers.length > 0 && (
                <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                  <span className="text-[11px] text-muted-foreground">
                    Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, filteredUsers.length)} of {filteredUsers.length} users
                  </span>
                  <div className="flex items-center gap-1.5">
                    <PaginationButton label="‹" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
                    {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => (
                      <PaginationButton key={i} label={String(i + 1)} active={page === i + 1}
                        onClick={() => setPage(i + 1)} />
                    ))}
                    {totalPages > 5 && <span className="px-1 text-[11px] text-muted-foreground">… {totalPages}</span>}
                    <PaginationButton label="›" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} />
                    <select className="ml-2 h-8 rounded-lg border bg-white px-2 text-[10px] dark:border-slate-700 dark:bg-slate-900"
                      value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} aria-label="Users per page">
                      <option value="10">10 / page</option>
                      <option value="25">25 / page</option>
                      <option value="50">50 / page</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

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
   STAT CARD
============================================================ */

function StatCard({ icon, title, value, description, positive, warning }: {
  icon: ReactNode; title: string; value: number; description: string; positive?: boolean; warning?: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <div className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
          {icon}
        </div>
        {positive && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
            <Activity className="size-3" /> Healthy
          </span>
        )}
        {warning && <span className="text-[10px] font-semibold text-orange-600">Attention</span>}
      </div>
      <div className="mt-4">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="mt-1 text-xs font-semibold">{title}</div>
        <div className="mt-1 text-[10px] text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

/* ============================================================
   TABLE HEADER
============================================================ */

function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th className={["px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground", className].join(" ")}>
      {children}
    </th>
  );
}

/* ============================================================
   USER ROW
============================================================ */

function UserRow({ user, onSelect, onToggle }: { user: User; onSelect: () => void; onToggle: () => void }) {
  return (
    <tr className="group border-b transition hover:bg-sky-50/40 last:border-0 dark:border-slate-800 dark:hover:bg-slate-800/40">
      <td className="px-4 py-3">
        <button type="button" onClick={onSelect} className="flex items-center gap-3 text-left">
          <Avatar name={user.name} />
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold hover:text-sky-600" title={user.name}>{user.name}</div>
            <div className="truncate text-[10px] text-muted-foreground">@{user.username}</div>
          </div>
        </button>
      </td>
      <td className="px-4 py-3"><span className="text-[10px]" title={user.department}>{user.department || "—"}</span></td>
      <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
      <td className="px-4 py-3"><StatusBadge status={user.status} /></td>
      <td className="px-4 py-3"><span className="text-[10px] text-muted-foreground" title={user.lastLogin}>{formatDateTime(user.lastLogin)}</span></td>
      <td className="px-4 py-3"><span className="text-[10px] text-muted-foreground" title={user.joined}>{formatDate(user.joined)}</span></td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-0.5">
          <button type="button" onClick={onSelect} title="View user"
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800">
            <CircleUserRound className="size-3.5" />
          </button>
          <button type="button" onClick={onToggle}
            title={user.status === "Active" ? "Disable user" : user.status === "Pending" ? "Approve registration" : "Enable user"}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800">
            {user.status === "Active" ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
          </button>
          <button type="button" title="More actions" onClick={onSelect}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800">
            <MoreHorizontal className="size-3.5" />
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
  const initials = name.split(" ").map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase();
  return (
    <div className="grid size-10 shrink-0 place-items-center rounded-full bg-sky-50 text-[11px] font-bold text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
      {initials}
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const styles: Record<UserRole, string> = {
    Administrator: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300",
    "IT Support": "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-300",
    "Knowledge Manager": "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300",
    User: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  return <span className={["inline-flex items-center rounded-md border px-2.5 py-1 text-[8px] font-semibold", styles[role]].join(" ")}>{role}</span>;
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
    <span className={["inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[8px] font-semibold", item.className].join(" ")}>
      <span className={["size-1.5 rounded-full", item.dot].join(" ")} />
      {status}
    </span>
  );
}

/* ============================================================
   FILTER SELECT / PAGINATION / EMPTY STATE
============================================================ */

function FilterSelect({ value, onChange, options, label }: {
  value: string; onChange: (value: string) => void; options: string[]; label: string;
}) {
  return (
    <div className="relative">
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}
        className="h-10 min-w-[120px] appearance-none rounded-xl border bg-white py-0 pl-3 pr-8 text-[10px] font-medium outline-none transition hover:bg-slate-50 focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
        {options.map((option) => (
          <option key={option} value={option}>{option === "All" ? `All ${label}` : option}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function PaginationButton({ label, active, disabled, onClick }: {
  label: string; active?: boolean; disabled?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={["grid size-8 place-items-center rounded-lg border text-[10px] font-medium transition",
        active ? "border-sky-700 bg-sky-700 text-white"
          : "bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800",
        disabled ? "cursor-not-allowed opacity-40" : ""].join(" ")}>
      {label}
    </button>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-20 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800">
        <Search className="size-5 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-sm font-semibold">No users found</h3>
      <p className="mt-1 text-[11px] text-muted-foreground">Try changing your search or filters.</p>
      <button type="button" onClick={onReset} className="mt-4 text-[11px] font-semibold text-sky-600 hover:text-sky-700">
        Clear filters
      </button>
    </div>
  );
}

/* ============================================================
   USER DRAWER
============================================================ */

function UserDrawer({ user, onClose, onUserUpdated }: {
  user: User; onClose: () => void; onUserUpdated?: (user: User) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>(user.role);
  const [permissions, setPermissions] = useState<PermissionMap>(EMPTY_PERMISSIONS);
  const [loadingPermissions, setLoadingPermissions] = useState(true);
  const [savingRole, setSavingRole] = useState(false);
  const [roleSaved, setRoleSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadPermissions() {
      setLoadingPermissions(true);
      try {
        const data = await getUserPermissions(user.username);
        if (!mounted) return;
        setPermissions({ ...EMPTY_PERMISSIONS, ...(data.effective ?? {}) });
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
     (from ROLE_DEFAULTS + user's saved overrides). Saves re-fetch effective perms. */
  const previewPerms: PermissionMap = useMemo(() => {
    const defaults = ROLE_DEFAULTS[selectedRole] ?? EMPTY_PERMISSIONS;
    if (selectedRole === user.role) return permissions;
    // merge: role defaults + any override the user already has for caps the new role lacks
    const merged = { ...defaults };
    (Object.keys(merged) as PermissionKey[]).forEach((k) => {
      if (!merged[k] && permissions[k] && user.roleOverride) merged[k] = true; // keep explicit grants
    });
    return merged;
  }, [selectedRole, permissions, user.role, user.roleOverride]);

  async function saveRole() {
    if (selectedRole === user.role) return;
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

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-950/25 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[430px] flex-col bg-white shadow-2xl dark:bg-slate-950">
        <div className="flex items-center justify-between border-b px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-sm font-semibold">User details</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">Account and access information</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 transition hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="border-b px-5 py-5 dark:border-slate-800">
            <div className="flex items-center gap-4">
              <div className="grid size-14 shrink-0 place-items-center rounded-full bg-sky-50 text-sm font-bold text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
                {getInitials(user.name)}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{user.name}</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">@{user.username}</p>
                <div className="mt-2"><StatusBadge status={user.status} /></div>
              </div>
            </div>
          </div>

          <div className="space-y-7 p-5">
            {/* ACCOUNT */}
            <DrawerSection title="Account" icon={<CircleUserRound className="size-4" />}>
              <div className="divide-y rounded-xl border dark:divide-slate-800 dark:border-slate-800">
                <InfoRow label="Email" value={user.email} />
                <InfoRow label="Department" value={user.department || "—"} />
                <InfoRow label="Account type" value={isAdUser ? "LDAP / AD" : "Local"} />
                <InfoRow label="Joined" value={formatDateTime(user.joined)} />
                <InfoRow label="Last login" value={formatDateTime(user.lastLogin)} />
              </div>
            </DrawerSection>

            {/* ACCESS */}
            <DrawerSection title="Access" icon={<Shield className="size-4" />}>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Role</label>
                  <div className="relative">
                    <select value={selectedRole}
                      onChange={(event) => { setSelectedRole(event.target.value as UserRole); setRoleSaved(false); }}
                      className="h-10 w-full appearance-none rounded-xl border bg-white px-3 pr-9 text-[11px] font-medium outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-sky-950">
                      <option value="Administrator">Administrator</option>
                      <option value="IT Support">IT Support</option>
                      <option value="Knowledge Manager">Knowledge Manager</option>
                      <option value="User">User</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                  <p className="mt-1.5 text-[9.5px] leading-4 text-muted-foreground">
                    {ROLE_DESCRIPTIONS[selectedRole]}
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground">Permissions</span>
                    {selectedRole !== user.role ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[8.5px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        Preview: {selectedRole}
                      </span>
                    ) : (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[8.5px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                        Current: {user.role}
                      </span>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-xl border dark:border-slate-800">
                    {loadingPermissions ? (
                      <div className="space-y-2 p-3">
                        <Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-full" />
                        <Skeleton className="h-7 w-full" /><Skeleton className="h-7 w-full" />
                      </div>
                    ) : (
                      <div className="divide-y dark:divide-slate-800">
                        {RBAC_CAPABILITIES.map((capability) => {
                          const enabled = previewPerms[capability.key];
                          const changed = selectedRole !== user.role && enabled !== !!permissions[capability.key];
                          return (
                            <div key={capability.key} className={["flex items-center gap-2.5 px-3 py-2.5",
                              changed ? "bg-amber-50/60 dark:bg-amber-950/20" : ""].join(" ")}>
                              <span className={["grid size-5 shrink-0 place-items-center rounded-full",
                                enabled ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"].join(" ")}>
                                {enabled ? <Check className="size-3" /> : <X className="size-3" />}
                              </span>
                              <span className={["text-[10.5px]", enabled ? "font-medium text-slate-800 dark:text-slate-200" : "text-muted-foreground"].join(" ")}>
                                {capability.label}
                              </span>
                              {changed && (
                                <span className={["ml-auto rounded-full px-1.5 py-0.5 text-[8px] font-semibold",
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
                </div>

                <div className="flex items-center justify-end gap-2">
                  {roleSaved && <span className="mr-auto text-[10px] font-medium text-emerald-600">Access updated ✓</span>}
                  {error && <span className="mr-auto max-w-[190px] truncate text-[10px] text-red-600" title={error}>{error}</span>}
                  <button type="button" onClick={saveRole} disabled={savingRole || selectedRole === user.role}
                    className="rounded-xl bg-sky-700 px-5 py-2.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40">
                    {savingRole ? "Saving..." : "Save access changes"}
                  </button>
                </div>
              </div>
            </DrawerSection>

            {/* DIRECTORY */}
            <DrawerSection title="Directory" icon={<UserCog className="size-4" />}>
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-[10px] font-medium">AD / LDAP groups</div>
                  {user.groups.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {user.groups.map((group) => (
                        <span key={group} className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                          {group}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-center text-[10px] text-muted-foreground">
                      No directory groups assigned.
                    </div>
                  )}
                </div>
                <InfoRow label="Source" value={isAdUser ? "Active Directory" : "Local account"} />
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
                      <div className="text-[10px] font-semibold text-amber-900 dark:text-amber-200">Managed by Active Directory</div>
                      <p className="mt-1 text-[10px] leading-4 text-amber-800 dark:text-amber-300">
                        This password is managed in Active Directory and cannot be changed here.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <LocalPasswordForm username={user.username} />
              )}
            </DrawerSection>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] leading-4 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="border-t bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={handleResetAccess}
              className="flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[10px] font-semibold transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-900">
              <RefreshCw className="size-3.5" /> Reset access
            </button>
            <button type="button" disabled={busy} onClick={handleStatusChange}
              className={["flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[10px] font-semibold transition disabled:opacity-50",
                user.status === "Active"
                  ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300"].join(" ")}>
              {user.status === "Active" ? <><UserX className="size-3.5" /> Disable user</> : <><UserCheck className="size-3.5" /> Enable user</>}
            </button>
          </div>
        </div>
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
        <span className="text-sky-600 dark:text-sky-400">{icon}</span>
        <h3 className="text-[11px] font-bold uppercase tracking-wide">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[40px] items-center justify-between gap-4 border-b px-3 last:border-b-0 dark:border-slate-800">
      <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <span className="max-w-[245px] truncate text-right text-[10px] font-medium" title={value}>{value}</span>
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
        className="h-10 w-full rounded-xl border bg-white px-3 text-[10px] outline-none transition placeholder:text-muted-foreground focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-sky-950" />
      <div className="flex justify-end">
        <button type="button" onClick={savePassword} disabled={busy || password.length < 8}
          className="rounded-xl bg-sky-700 px-4 py-2 text-[10px] font-semibold text-white hover:bg-sky-600 disabled:opacity-40">
          {busy ? "Updating..." : "Update password"}
        </button>
      </div>
      {message && <div className="text-[10px] font-medium text-emerald-600">{message}</div>}
      {error && <div className="text-[10px] text-red-600">{error}</div>}
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
      <div className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold">Add user</h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Create a local account or provision an account for directory access.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
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
              <label className="mb-1.5 block text-[10px] font-semibold">Role</label>
              <div className="relative">
                <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}
                  className="h-10 w-full appearance-none rounded-xl border bg-white px-3 pr-8 text-[11px] outline-none dark:border-slate-700 dark:bg-slate-950">
                  <option value="User">User</option>
                  <option value="IT Support">IT Support</option>
                  <option value="Knowledge Manager">Knowledge Manager</option>
                  <option value="Administrator">Administrator</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
          </div>
          <InputField label="Password" value={password} onChange={setPassword} placeholder="Minimum 8 characters" type="password" />
          <div className="rounded-xl bg-sky-50 p-3 text-[10px] leading-4 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
            <div className="flex gap-2">
              <Shield className="mt-0.5 size-3.5 shrink-0" />
              <span>LDAP / AD users should normally be synchronized from Active Directory. Their passwords are managed by AD.</span>
            </div>
          </div>
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-[10px] text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t p-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className="rounded-xl border px-4 py-2.5 text-[10px] font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Cancel</button>
          <button type="button" onClick={createUser} disabled={saving}
            className="rounded-xl bg-sky-700 px-5 py-2.5 text-[10px] font-semibold text-white hover:bg-sky-600 disabled:opacity-40">
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
      <span className="mb-1.5 block text-[10px] font-semibold">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
        className="h-10 w-full rounded-xl border bg-white px-3 text-[11px] outline-none placeholder:text-muted-foreground focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-sky-950" />
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
