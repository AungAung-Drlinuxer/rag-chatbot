import io

f = "src/features/tickets/pages/TicketsPage.tsx"
s = io.open(f, encoding="utf-8").read()

# FIX 1: dedicated listBusy for Refresh
s = s.replace(
    "  const [busy, setBusy] = useState(false);",
    "  const [busy, setBusy] = useState(false);\n"
    "  const [listBusy, setListBusy] = useState(false); // Refresh owns its own state — shared busy froze other affordances",
    1,
)

s = s.replace(
    '''                      setQuery("");
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
                  </Button>''',
    '''                      setQuery("");
                      setListBusy(true);
                      try {
                        const d = await listTickets(50);
                        setTickets((d?.tickets ?? []) as Ticket[]);
                        // re-sync open detail panel with fresh statuses
                        setSelected((cur) => (cur ? (d?.tickets ?? []).find((x: Ticket) => x.id === cur.id) ?? cur : cur));
                        onToast("Ticket list refreshed");
                      } catch {
                        onToast("Refresh failed — try again", "err");
                      } finally {
                        setListBusy(false);
                      }
                    }}
                    disabled={listBusy}
                  >
                    <RefreshIcon className={listBusy ? "animate-spin" : ""} />
                    {listBusy ? "Refreshing…" : "Refresh"}
                  </Button>''',
)

# FIX 2: Update-status toggle icon -> chevron (it opens a picker, not a refresh)
s = s.replace(
    '''                          <Button variant="outline" size="sm" className="rounded-xl text-xs"
                            onClick={() => setStatusOpen((v) => !v)}
                          >
                            <RefreshCcw className="mr-1.5 size-3.5" />
                            Update status
                          </Button>''',
    '''                          <Button variant="outline" size="sm" className="rounded-xl text-xs"
                            onClick={() => setStatusOpen((v) => !v)}
                            aria-expanded={statusOpen}
                          >
                            <ChevronDown className={"mr-1.5 size-3.5 transition-transform " + (statusOpen ? "rotate-180" : "")} />
                            Update status
                          </Button>''',
)

# FIX 3: status picker -> always-visible segmented control, instant save
old_picker = '''                    {/* v0.20.0 — status picker */}
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
                    )}'''
new_picker = '''                    {/* v0.21.99 — status = always-visible segmented control.
                        Clicking a segment SAVES IMMEDIATELY (optimistic PUT);
                        no Save button by design. Edit form keeps its own Save. */}
                    <div className="mb-4">
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Status — click to change (saves instantly)
                      </h3>
                      <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-50 p-1.5 dark:bg-slate-800/50">
                        {(["open", "pending", "resolved", "closed"] as const).map((st) => {
                          const m = statusMeta(st);
                          const active = selected.status === st;
                          const saving = statusSaving === st;
                          return (
                            <button
                              key={st}
                              disabled={!!statusSaving}
                              onClick={() => handleUpdateStatus(st)}
                              aria-pressed={active}
                              className={[
                                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-semibold capitalize transition",
                                active
                                  ? "bg-white text-foreground shadow-sm ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
                                  : "text-muted-foreground hover:bg-white/60 hover:text-foreground dark:hover:bg-slate-900/60",
                                saving ? "opacity-60" : "",
                              ].join(" ")}
                            >
                              <span className={"size-1.5 rounded-full " + m.dotClass} />
                              {saving ? "saving…" : m.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>'''
assert old_picker in s, "picker block not found"
s = s.replace(old_picker, new_picker)

# state + optimistic handler
s = s.replace(
    "  const [statusOpen, setStatusOpen] = useState(false);",
    "  const [statusOpen, setStatusOpen] = useState(false);\n"
    "  const [statusSaving, setStatusSaving] = useState<string | null>(null);",
    1,
)
old_h = '''  async function handleUpdateStatus(status: string) {
    if (!selected) return;
    try {
      await ticketUpdate(selected.id, { status });
      setSelected({ ...selected, status: status as Ticket["status"] });
      setStatusOpen(false);'''
new_h = '''  async function handleUpdateStatus(status: string) {
    if (!selected || statusSaving) return;
    const prevStatus = selected.status;
    setStatusSaving(status);
    setSelected({ ...selected, status: status as Ticket["status"] }); // optimistic
    try {
      await ticketUpdate(selected.id, { status });
      setStatusOpen(false);'''
assert old_h in s, "handler not found"
s = s.replace(old_h, new_h)

old_tail = '''      onToast("Status updated");
      listTickets(50).then((d) => setTickets((d?.tickets ?? []) as Ticket[])).catch(() => {});
    } catch {
      onToast("Status update failed", "err");
    }
  }'''
new_tail = '''      onToast("Status updated");
      listTickets(50).then((d) => {
        setTickets((d?.tickets ?? []) as Ticket[]);
        setSelected((cur) => (cur ? (d?.tickets ?? []).find((x: Ticket) => x.id === cur.id) ?? cur : cur));
      }).catch(() => {});
    } catch {
      setSelected({ ...selected, status: prevStatus }); // rollback
      onToast("Status update failed", "err");
    } finally {
      setStatusSaving(null);
    }
  }'''
assert old_tail in s, "handler tail not found"
s = s.replace(old_tail, new_tail)

io.open(f, "w", encoding="utf-8", newline="\n").write(s)
print("patched OK")
