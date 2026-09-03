import {
  Download,
  Printer,
  AlertCircle,
  Pencil,
  RefreshCcw,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Filter,
  Plus,
  Search,
  Ticket as TicketIcon,
  MessageSquare,
  UserRound,
  Users,
  X,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PageShell, PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

// feature API (governance: endpoints live in features/*/api.ts, not components)
import {
  listTickets,
  createTicketApi,
  ticketComments,
  ticketAddComment,
  ticketUpdate,
  ticketAttachments,
  ticketAttachmentAdd,
  attachmentUrl,
} from "@/features/tickets/api";
import { articleDraft } from "@/features/knowledge/api";
import { assignableUsers } from "@/features/users/api";

// feature model + presentational parts (extracted from this file, Step 2 split)
import {
  type Ticket,
  type Comment,
  type Assignable,
  statusMeta,
  priorityMeta,
  relTime,
} from "@/features/tickets/model";
import {
  StatCard,
  MetaRow,
  StatusBadge,
  PriorityBadge,
  ActivityItem,
  RefreshIcon,
} from "@/features/tickets/components/presentational";

type Props = {
  role: string;
  userName?: string;
  onToast: (msg: string, kind?: "ok" | "err") => void;
};

export default function Tickets({
  role,
  userName,
  onToast,
}: Props) {
  const canManage =
    role === "admin" || role === "agent";

  const [tickets, setTickets] =
    useState<Ticket[] | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState("all");
  const [priorityFilter, setPriorityFilter] =
    useState("all");

  const [selected, setSelected] =
    useState<Ticket | null>(null);

  const [createOpen, setCreateOpen] =
    useState(false);


  const [busy, setBusy] = useState(false);

  const [newTicket, setNewTicket] = useState({
    subject: "",
    description: "",
    category: "General",
    priority: "medium",
    assignee: "",
    due_date: "",
  });

  // v0.20.0 — detail drawer: comments + field editing
  const [comments, setComments] = useState<Comment[]>([]);
  const [assignable, setAssignable] = useState<Assignable[]>([]);
  const [attachments, setAttachments] = useState<{ id: number; filename: string; size: number; created_by: string | null }[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [commentText, setCommentText] = useState("");
  const [editFields, setEditFields] = useState<{ subject: string; description: string; assignee: string; due_date: string } | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);

  const loadComments = (ref: string) => {
    ticketComments(ref).then((d) => setComments((d?.comments ?? []) as Comment[])).catch(() => setComments([]));
  };

  async function handleAddComment() {
    if (!selected || !commentText.trim()) return;
    const ref = selected.id;
    try {
      const c = await ticketAddComment(ref, commentText.trim());
      setComments((prev) => [...prev, c as Comment]);
      setCommentText("");
      onToast("Comment added");
    } catch {
      onToast("Comment failed", "err");
    }
  }

  async function handleUpdateStatus(status: string) {
    if (!selected) return;
    try {
      await ticketUpdate(selected.id, { status });
      setSelected({ ...selected, status: status as Ticket["status"] });
      setStatusOpen(false);
      setComments((prev) => [...prev, {
        id: Date.now(), author: userName, body: `status → ${status}`, kind: "status",
        created_at: new Date().toISOString(),
      }]);
      onToast("Status updated");
      listTickets(50).then((d) => setTickets((d?.tickets ?? []) as Ticket[])).catch(() => {});
    } catch {
      onToast("Status update failed", "err");
    }
  }

  async function handleSaveEdit() {
    if (!selected || !editFields) return;
    try {
      await ticketUpdate(selected.id, {
        subject: editFields.subject,
        description: editFields.description,
        assignee: editFields.assignee || null,
        due_date: editFields.due_date || null,
      });
      setSelected({
        ...selected,
        subject: editFields.subject,
        description: editFields.description,
        assignee: editFields.assignee || null,
      });
      setComments((prev) => [...prev, {
        id: Date.now(), author: userName,
        body: "subject/description/assignee/due date edited", kind: "edit",
        created_at: new Date().toISOString(),
      }]);
      setEditFields(null);
      onToast("Ticket updated");
      listTickets(50).then((d) => setTickets((d?.tickets ?? []) as Ticket[])).catch(() => {});
    } catch {
      onToast("Update failed", "err");
    }
  }

  useEffect(() => {
    let mounted = true;

    listTickets(50)
      .then((data) => {
        if (mounted) {
          setTickets((data?.tickets ?? []) as Ticket[]);
        }
      })
      .catch(() => {
        if (mounted) {
          setTickets([]); // real data only — show empty state on failure
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (selected?.id) loadComments(selected.id);
  }, [selected?.id]);

  useEffect(() => {
    assignableUsers().then((d) => setAssignable(d?.users ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selected?.id) ticketAttachments(selected.id).then((d) => setAttachments(d?.attachments ?? [])).catch(() => {});
    else setAttachments([]);
  }, [selected?.id]);

  const filteredTickets = useMemo(() => {
    if (!tickets) return [];

    const q = query.trim().toLowerCase();

    return tickets.filter((ticket) => {
      const matchesQuery =
        !q ||
        [
          ticket.id,
          ticket.subject,
          ticket.category,
          ticket.requester,
          ticket.assignee ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);

      const matchesStatus =
        statusFilter === "all" ||
        ticket.status === statusFilter;

      const matchesPriority =
        priorityFilter === "all" ||
        ticket.priority === priorityFilter;

      return (
        matchesQuery &&
        matchesStatus &&
        matchesPriority
      );
    });
  }, [
    tickets,
    query,
    statusFilter,
    priorityFilter,
  ]);

  const stats = useMemo(() => {
    const list = tickets ?? [];

    return {
      total: list.length,
      open: list.filter(
        (t) => t.status === "open"
      ).length,
      pending: list.filter(
        (t) => t.status === "pending"
      ).length,
      resolved: list.filter(
        (t) =>
          t.status === "resolved" ||
          t.status === "closed"
      ).length,
    };
  }, [tickets]);

  /* ---- Report export (v0.21.55): CSV download + printable sheet ------------- */
  function ticketRows() {
    return filteredTickets.map((tk) => ({
      id: tk.id,
      subject: tk.subject,
      category: tk.category,
      status: tk.status,
      priority: tk.priority,
      requester: tk.requester,
      assignee: tk.assignee || "Unassigned",
      created: tk.created_at,
      updated: tk.updated_at,
    }));
  }

  function csvCell(v: string) {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  function exportCsv() {
    const rows = ticketRows();
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const body = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => csvCell(String((r as any)[h] ?? ""))).join(",")),
    ].join("\n");
    const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `ticket-report-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onToast(`Report exported — ${rows.length} tickets`);
  }

  function printReport() {
    const rows = ticketRows();
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      onToast("Pop-up blocked — allow pop-ups to print", "err");
      return;
    }
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(`<!doctype html><html><head><title>Ticket Report</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;margin:32px;color:#0f172a}
        h1{font-size:18px;margin:0 0 4px}
        .meta{font-size:12px;color:#64748b;margin-bottom:16px}
        table{border-collapse:collapse;width:100%;font-size:11px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
        th{background:#f1f5f9}
        tr:nth-child(even) td{background:#f8fafc}
        @media print{button{display:none}}
      </style></head><body>
      <h1>IT Help — Ticket Report</h1>
      <div class="meta">Generated ${new Date().toLocaleString()} · ${rows.length} tickets${
        statusFilter !== "all" ? ` · status filter: ${statusFilter}` : ""}${
        priorityFilter !== "all" ? ` · priority filter: ${priorityFilter}` : ""}${
        query ? ` · search: "${esc(query)}"` : ""}</div>
      <table><thead><tr><th>Ticket</th><th>Subject</th><th>Category</th><th>Status</th>
      <th>Priority</th><th>Requester</th><th>Assignee</th><th>Created</th><th>Updated</th></tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><td>${esc(r.id)}</td><td>${esc(r.subject)}</td><td>${esc(r.category)}</td><td>${esc(r.status)}</td><td>${esc(r.priority)}</td><td>${esc(r.requester)}</td><td>${esc(r.assignee)}</td><td>${esc(r.created)}</td><td>${esc(r.updated)}</td></tr>`,
        )
        .join("")}</tbody></table>
      <script>window.onload=function(){window.print()}<\/script>
      </body></html>`);
    w.document.close();
  }


  function resetFilters() {
    setQuery("");
    setStatusFilter("all");
    setPriorityFilter("all");
  }

  async function createTicket() {
    if (!newTicket.subject.trim()) {
      onToast(
        "Ticket subject is required",
        "err"
      );
      return;
    }

    try {
      const created = await createTicketApi({
        subject: newTicket.subject,
        description: newTicket.description,
        domain: newTicket.category.toLowerCase(),
        priority: newTicket.priority,
        assignee: newTicket.assignee || null,
        due_date: newTicket.due_date || null,
      });

      const ticket: Ticket = {
        id: created.id ?? `IT-${Date.now()}`,
        subject: created.subject ?? newTicket.subject,
        description: created.description ?? newTicket.description,
        status: "open",
        priority: (created.priority ?? newTicket.priority) as Ticket["priority"],
        category: created.category ?? newTicket.category,
        requester: created.requester ?? userName ?? "Current User",
        assignee: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setTickets((current) => [
        ticket,
        ...(current ?? []),
      ]);
    } catch {
      onToast("Ticket creation failed", "err");
      return;
    }

    setNewTicket({
      subject: "",
      description: "",
      category: "General",
      priority: "medium",
      assignee: "",
      due_date: "",
    });

    setCreateOpen(false);

    onToast("Ticket created");
  }

    return (
    <PageShell>
      <PageHeader
        icon={<TicketIcon className="size-5" />}
      title="Tickets"
      description="Track and manage IT support requests"
      actions={
        <Button size="sm" className="rounded-xl" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 size-4" />
          Create ticket
        </Button>
      }
    />

          <div className="mx-auto grid max-w-[1600px] grid-cols-1 items-start gap-5 p-5 lg:p-8 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-6">

            {/* =================================================
                KPI CARDS
            ================================================= */}
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">

              <StatCard
                icon={
                  <TicketIcon className="size-4" />
                }
                label="Total tickets"
                value={stats.total}
                description="All support requests"
              />

              <StatCard
                icon={
                  <AlertCircle className="size-4" />
                }
                label="Open"
                value={stats.open}
                description="Require attention"
                accent="blue"
              />

              <StatCard
                icon={
                  <Clock3 className="size-4" />
                }
                label="Pending"
                value={stats.pending}
                description="Waiting for action"
                accent="amber"
              />

              <StatCard
                icon={
                  <CheckCircle2 className="size-4" />
                }
                label="Resolved"
                value={stats.resolved}
                description="Successfully completed"
                accent="emerald"
              />
            </section>

            {/* =================================================
                FILTER TOOLBAR
            ================================================= */}
            <Card className="rounded-2xl p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">

                <div className="relative flex-1 xl:max-w-xl">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                    placeholder="Search ticket ID, subject, requester..."
                    className="h-10 w-full rounded-xl border bg-background pl-10 pr-4 text-xs outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">

                  <div className="relative">
                    <select
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(
                          e.target.value
                        );
                      }}
                      className="h-10 min-w-[130px] appearance-none rounded-xl border bg-background px-3 pr-9 text-xs outline-none focus:border-blue-500"
                    >
                      <option value="all">
                        All statuses
                      </option>
                      <option value="open">
                        Open
                      </option>
                      <option value="pending">
                        Pending
                      </option>
                      <option value="resolved">
                        Resolved
                      </option>
                      <option value="closed">
                        Closed
                      </option>
                    </select>

                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>

                  <div className="relative">
                    <select
                      value={priorityFilter}
                      onChange={(e) => {
                        setPriorityFilter(
                          e.target.value
                        );
                      }}
                      className="h-10 min-w-[130px] appearance-none rounded-xl border bg-background px-3 pr-9 text-xs outline-none focus:border-blue-500"
                    >
                      <option value="all">
                        All priorities
                      </option>
                      <option value="critical">
                        Critical
                      </option>
                      <option value="high">
                        High
                      </option>
                      <option value="medium">
                        Medium
                      </option>
                      <option value="low">
                        Low
                      </option>
                    </select>

                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>

                  {(query ||
                    statusFilter !== "all" ||
                    priorityFilter !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetFilters}
                      className="h-10 rounded-xl text-xs"
                    >
                      <X className="mr-1.5 size-3.5" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            {/* =================================================
                TABLE
            ================================================= */}
            <Card className="overflow-hidden rounded-2xl">

              <div className="flex items-center justify-between border-b px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold">
                    Support requests
                  </h2>

                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {filteredTickets.length} matching tickets
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={exportCsv}
                    disabled={!filteredTickets.length}
                    className="flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"
                    title="Download ticket report (CSV)"
                  >
                    <Download className="size-3.5" />
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={printReport}
                    disabled={!filteredTickets.length}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                    title="Print / save as PDF"
                  >
                    <Printer className="size-3.5" />
                    Report
                  </button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg"
                    onClick={async () => {
                      setQuery("");
                      setBusy(true);
                      try {
                        const d = await listTickets(50);
                        setTickets((d?.tickets ?? []) as Ticket[]);
                        onToast("Ticket list refreshed");
                      } catch {
                        onToast("Refresh failed — try again");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <RefreshIcon />
                    Refresh
                  </Button>
                </div>
              </div>

              {!tickets ? (
                <div className="space-y-2 p-4">
                  {Array.from({
                    length: 6,
                  }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className="h-12 rounded-xl"
                    />
                  ))}
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-muted">
                    <Filter className="size-5 text-muted-foreground" />
                  </div>

                  <h3 className="text-sm font-semibold">
                    No tickets found
                  </h3>

                  <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                    Try changing your search or filter criteria.
                  </p>

                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 rounded-xl"
                    onClick={resetFilters}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : (
                <>
                  <div className="max-h-[420px] overflow-y-auto overflow-x-hidden rounded-xl border border-slate-100 pr-1 dark:border-slate-800">
                    <table className="w-full table-fixed text-xs">
                      <colgroup>
                        <col className="w-[11%]" />
                        <col className="w-[27%]" />
                        <col className="w-[11%]" />
                        <col className="w-[12%]" />
                        <col className="w-[15%]" />
                        <col className="w-[14%]" />
                        <col className="w-[10%]" />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                        <tr className="text-left">
                          <th className="px-4 py-3 font-semibold text-muted-foreground first:pl-5">
                            Ticket
                          </th>

                          <th className="px-4 py-3 font-semibold text-muted-foreground">
                            Subject
                          </th>

                          <th className="px-3 py-3 font-semibold text-muted-foreground">
                            Status
                          </th>

                          <th className="px-3 py-3 font-semibold text-muted-foreground">
                            Priority
                          </th>

                          <th className="px-3 py-3 font-semibold text-muted-foreground">
                            Requester
                          </th>

                          <th className="px-3 py-3 font-semibold text-muted-foreground">
                            Updated
                          </th>

                          <th className="px-3 py-3 text-right font-semibold text-muted-foreground">
                            Action
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredTickets.map(
                          (ticket) => {
                            const status =
                              statusMeta(ticket.status);

                            const priority =
                              priorityMeta(ticket.priority);

                            return (
                              <tr
                                key={ticket.id}
                                className="border-t transition hover:bg-slate-50 dark:hover:bg-slate-900/60"
                              >
                                <td className="truncate px-4 py-4 sm:px-5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelected(
                                        ticket
                                      )
                                    }
                                    className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                                  >
                                    {ticket.id}
                                  </button>
                                </td>

                                <td className="px-4 py-4">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelected(
                                        ticket
                                      )
                                    }
                                    className="block w-full text-left"
                                  >
                                    <div className="truncate font-medium">
                                      {
                                        ticket.subject
                                      }
                                    </div>

                                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                                      <span>
                                        {
                                          ticket.category
                                        }
                                      </span>

                                      <span>
                                        •
                                      </span>

                                      <span>
                                        {ticket.assignee ??
                                          "Unassigned"}
                                      </span>
                                    </div>
                                  </button>
                                </td>

                                <td className="px-4 py-4">
                                  <Badge
                                    variant="outline"
                                    className={[
                                      "rounded-lg text-[9px]",
                                      status.className,
                                    ].join(" ")}
                                  >
                                    {status.label}
                                  </Badge>
                                </td>

                                <td className="px-4 py-4">
                                  <span
                                    className={[
                                      "inline-flex items-center gap-1.5 font-medium",
                                      priority.className,
                                    ].join(" ")}
                                  >
                                    <span
                                      className={[
                                        "size-1.5 rounded-full",
                                        priority.dot,
                                      ].join(" ")}
                                    />

                                    {
                                      priority.label
                                    }
                                  </span>
                                </td>

                                <td className="truncate px-3 py-4 text-muted-foreground" title={ticket.requester}>
                                  {
                                    ticket.requester
                                  }
                                </td>

                                <td className="truncate px-3 py-4 text-muted-foreground">
                                  {relTime(
                                    ticket.updated_at
                                  )}
                                </td>

                                <td className="px-4 py-4">
                                  <div className="flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelected(
                                          ticket
                                        )
                                      }
                                      className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                                      title="View ticket details"
                                    >
                                      <ChevronRight className="size-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between border-t px-5 py-3">
                    <span className="text-[10px] text-muted-foreground">
                      Showing all {filteredTickets.length} ticket{filteredTickets.length === 1 ? "" : "s"} — scroll to review
                    </span>
                  </div>
                </>
              )}
            </Card>

            
              </div>{/* end left column */}

              {/* ==========================================================
                  TICKET DETAIL — persistent right panel (split-pane)
              ========================================================== */}
              <aside className="sticky top-6 hidden max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl border bg-white dark:border-slate-800 dark:bg-slate-900 xl:block">
                {!selected ? (
                  <div className="flex h-64 flex-col items-center justify-center gap-3 p-8 text-center">
                    <div className="grid size-12 place-items-center rounded-2xl bg-muted">
                      <TicketIcon className="size-5 text-muted-foreground" />
                    </div>

                    <h3 className="text-sm font-semibold">
                      No ticket selected
                    </h3>

                    <p className="max-w-[240px] text-xs text-muted-foreground">
                      Click a ticket ID or subject row to view details,
                      activity, and assignment here.
                    </p>
                  </div>
                ) : (
                  <div className="p-5">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <span className="text-xs font-semibold text-blue-600">
                        {selected.id}
                      </span>

                      <button
                        type="button"
                        onClick={() => setSelected(null)}
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </div>

                    <h2 className="text-lg font-semibold leading-6 tracking-tight">
                      {selected.subject}
                    </h2>

                    <div className="mt-3 flex items-center gap-2">
                      <StatusBadge status={statusMeta(selected.status)} />

                      <PriorityBadge priority={priorityMeta(selected.priority)} />
                    </div>

                    {/* Detail tabs (visual) */}
                    <div className="mt-4 flex gap-4 border-b text-xs font-medium">
                      <span className="-mb-px border-b-2 border-blue-600 pb-2 text-blue-600">
                        Details
                      </span>

                      <span className="pb-2 text-muted-foreground">
                        Activity
                      </span>

                      <span className="pb-2 text-muted-foreground">
                        Attachments
                      </span>
                    </div>

                    {/* Description */}
                    <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Description
                    </h3>

                    <div className="rounded-xl border bg-muted/30 p-3.5 text-sm leading-6">
                      {selected.description ||
                        "No description provided."}
                    </div>

                    {/* Metadata grid */}
                    <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-xs">
                      <MetaRow icon={<TicketIcon className="size-3.5" />} label="Category" value={selected.category} />
                      <MetaRow icon={<AlertCircle className="size-3.5" />} label="Priority" value={priorityMeta(selected.priority).label} />
                      <MetaRow icon={<UserRound className="size-3.5" />} label="Requester" value={selected.requester} />
                      <MetaRow icon={<CheckCircle2 className="size-3.5" />} label="Status" value={statusMeta(selected.status).label} />
                      <MetaRow icon={<Users className="size-3.5" />} label="Assignee" value={selected.assignee ?? "Unassigned"} />
                      <MetaRow icon={<Clock3 className="size-3.5" />} label="Created" value={new Date(selected.created_at).toLocaleString()} />
                    </div>

                    {/* Activity */}
                    <h3 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Activity
                    </h3>

                    {/* v0.20.0 — status picker */}
                    {statusOpen && (
                      <div className="mb-3 flex flex-wrap gap-2 rounded-xl border bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                        {["open", "pending", "resolved", "closed"].map((st) => (
                          <button
                            key={st}
                            onClick={() => handleUpdateStatus(st)}
                            className={[
                              "rounded-lg border px-3 py-1.5 text-[10px] font-semibold capitalize transition",
                              selected.status === st
                                ? "border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/30"
                                : "hover:bg-muted",
                            ].join(" ")}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* v0.20.0 — edit form */}
                    {editFields ? (
                      <div className="mb-4 space-y-3 rounded-xl border p-4 dark:border-slate-800">
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-medium">Subject</span>
                          <input
                            value={editFields.subject}
                            onChange={(e) => setEditFields({ ...editFields, subject: e.target.value })}
                            className="h-9 w-full rounded-lg border bg-transparent px-3 text-xs outline-none focus:border-blue-500 dark:border-slate-700"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-medium">Description</span>
                          <textarea
                            rows={4}
                            value={editFields.description}
                            onChange={(e) => setEditFields({ ...editFields, description: e.target.value })}
                            className="w-full rounded-lg border bg-transparent px-3 py-2 text-xs outline-none focus:border-blue-500 dark:border-slate-700"
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-medium">Assignee</span>
                            <input
                              value={editFields.assignee}
                              onChange={(e) => setEditFields({ ...editFields, assignee: e.target.value })}
                              placeholder="Unassigned"
                              className="h-9 w-full rounded-lg border bg-transparent px-3 text-xs outline-none focus:border-blue-500 dark:border-slate-700"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-medium">Due date</span>
                            <input
                              type="date"
                              value={editFields.due_date}
                              onChange={(e) => setEditFields({ ...editFields, due_date: e.target.value })}
                              className="h-9 w-full rounded-lg border bg-transparent px-3 text-xs outline-none focus:border-blue-500 dark:border-slate-700"
                            />
                          </label>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => setEditFields(null)}>
                            Cancel
                          </Button>
                          <Button size="sm" className="rounded-xl text-xs" onClick={handleSaveEdit}>
                            Save changes
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {/* Attachments (v0.20.2) */}
                    {attachments.length > 0 && (
                      <div className="mb-4">
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Attachments
                        </h3>
                        <div className="space-y-1.5">
                          {attachments.map((att) => (
                            <a
                              key={att.id}
                              href={attachmentUrl(selected.id, att.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center justify-between rounded-lg border px-3 py-2 text-[10px] transition hover:bg-muted"
                            >
                              <span className="truncate font-medium">📎 {att.filename}</span>
                              <span className="shrink-0 text-muted-foreground">{Math.round(att.size / 1024)} KB</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <ActivityItem
                        title="Ticket created"
                        text={`Opened by ${selected.requester}`}
                        time={relTime(selected.created_at)}
                      />

                      {comments.map((c) => (
                        <ActivityItem
                          key={c.id}
                          title={c.kind === "comment" ? `${c.author ?? "user"} commented` : `Updated by ${c.author ?? "user"}`}
                          text={c.body}
                          time={relTime(c.created_at ?? "")}
                        />
                      ))}
                    </div>

                    {/* Add attachment (drawer) */}
                    <div className="mt-4">
                      <input
                        type="file"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f || !selected) return;
                          try {
                            await ticketAttachmentAdd(selected.id, f);
                            ticketAttachments(selected.id)
                              .then((d) => setAttachments(d?.attachments ?? []))
                              .catch(() => {});
                            onToast("Attachment added");
                          } catch {
                            onToast("Upload failed", "err");
                          }
                          e.target.value = "";
                        }}
                        className="w-full rounded-xl border bg-background px-3 py-2 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-600"
                      />
                    </div>

                    {/* v0.21.84 — bounded comment box: single input + send (Enter works too) */}
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-900">
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddComment();
                        }}
                        placeholder="Write a comment… (Ctrl+Enter to send)"
                        rows={2}
                        className="w-full resize-none bg-transparent px-3 pt-2.5 text-xs outline-none placeholder:text-muted-foreground"
                      />
                      <div className="flex items-center justify-end px-2 pb-2">
                        <Button size="sm" className="rounded-lg text-[10px]" onClick={handleAddComment} disabled={!commentText.trim()}>
                          <MessageSquare className="mr-1 size-3" />
                          Send
                        </Button>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-6 flex flex-wrap gap-2 border-t pt-4">
                      {canManage ? (
                        <>
                          <Button variant="outline" size="sm" className="rounded-xl text-xs"
                            onClick={() => setEditFields({
                              subject: selected.subject,
                              description: selected.description ?? "",
                              assignee: selected.assignee ?? "",
                              due_date: selected.due_date ? selected.due_date.slice(0, 10) : "",
                            })}
                          >
                            <Pencil className="mr-1.5 size-3.5" />
                            Edit
                          </Button>

                          <Button variant="outline" size="sm" className="rounded-xl text-xs"
                            onClick={() => setStatusOpen((v) => !v)}
                          >
                            <RefreshCcw className="mr-1.5 size-3.5" />
                            Update status
                          </Button>

                        </>
                      ) : null}
                    </div>
                  </div>
                )}
              </aside>
            </div>
              {/* ==========================================================
          CREATE TICKET
      ========================================================== */}
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      >
        <DialogContent className="max-w-xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              Create support ticket
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-3">

            <div>
              <label className="mb-2 block text-xs font-medium">
                Subject
              </label>

              <input
                value={newTicket.subject}
                onChange={(e) =>
                  setNewTicket({
                    ...newTicket,
                    subject:
                      e.target.value,
                  })
                }
                placeholder="Briefly describe the issue"
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-xs font-medium">
                  Description
                </label>
                <button
                  type="button"
                  disabled={busy || !newTicket.subject.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const data = await articleDraft(
                        newTicket.subject,
                        newTicket.category.toLowerCase()
                      );
                      if (data.draft) {
                        setNewTicket({ ...newTicket, description: data.draft });
                        onToast("AI draft generated");
                      } else {
                        onToast(data.detail || "Draft failed", "err");
                      }
                    } catch {
                      onToast("Draft failed", "err");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-medium text-blue-600 transition hover:bg-blue-50 disabled:opacity-40 dark:hover:bg-blue-950/30"
                >
                  <Sparkles className="size-3" />
                  AI assist
                </button>
              </div>

              <textarea
                rows={6}
                value={
                  newTicket.description
                }
                onChange={(e) =>
                  setNewTicket({
                    ...newTicket,
                    description:
                      e.target.value,
                  })
                }
                placeholder="Describe what happened, error messages, affected system, and what you have already tried..."
                className="w-full resize-none rounded-xl border bg-background px-3 py-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">

              <div>
                <label className="mb-2 block text-xs font-medium">
                  Category
                </label>

                <select
                  value={
                    newTicket.category
                  }
                  onChange={(e) =>
                    setNewTicket({
                      ...newTicket,
                      category:
                        e.target.value,
                    })
                  }
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none"
                >
                  <option>
                    General
                  </option>
                  <option>
                    Network
                  </option>
                  <option>
                    Database
                  </option>
                  <option>
                    Kubernetes
                  </option>
                  <option>
                    Security
                  </option>
                  <option>
                    Server
                  </option>
                  <option>
                    Storage
                  </option>
                </select>
              </div>
              {/* v0.20.2 — Assignee / Due date / Attachments */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-medium">
                    Assignee
                  </label>
                  <select
                    value={newTicket.assignee}
                    onChange={(e) =>
                      setNewTicket({ ...newTicket, assignee: e.target.value })
                    }
                    className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none"
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
                  <label className="mb-2 block text-xs font-medium">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={newTicket.due_date}
                    onChange={(e) =>
                      setNewTicket({ ...newTicket, due_date: e.target.value })
                    }
                    className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium">
                  Attachments
                </label>
                <input
                  type="file"
                  multiple
                  onChange={(e) =>
                    setPendingFiles(Array.from(e.target.files ?? []))
                  }
                  className="w-full rounded-xl border bg-background px-3 py-2.5 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-blue-600"
                />
                {pendingFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {pendingFiles.map((f) => (
                      <div key={f.name} className="text-[10px] text-muted-foreground">
                        📎 {f.name} ({Math.round(f.size / 1024)} KB)
                      </div>
                    ))}
                  </div>
                )}
              </div>


              <div>
                <label className="mb-2 block text-xs font-medium">
                  Priority
                </label>

                <select
                  value={
                    newTicket.priority
                  }
                  onChange={(e) =>
                    setNewTicket({
                      ...newTicket,
                      priority:
                        e.target.value,
                    })
                  }
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none"
                >
                  <option value="critical">
                    Critical
                  </option>
                  <option value="high">
                    High
                  </option>
                  <option value="medium">
                    Medium
                  </option>
                  <option value="low">
                    Low
                  </option>
                </select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setCreateOpen(false)
              }
            >
              Cancel
            </Button>

            <Button onClick={createTicket}>
              <Plus className="mr-2 size-4" />
              Create ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

/* ==============================================================
   SIDEBAR
============================================================== */

/* ==============================================================
   STATS
============================================================== */

