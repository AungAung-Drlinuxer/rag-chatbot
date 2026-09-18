/**
 * ConnectorsGallery — a connector screen for MCP servers.
 *
 * MODELLED ON: Perplexity's Connectors page (search, Discover/All/Connected/Available
 * filters, category sections of cards, a "+ Custom connector" menu, and a tick in place
 * of the plus once something is connected).
 *
 * WHY IT EXISTS HERE
 * MCP was previously two hardcoded servers with a handful of fields buried inside the
 * Integrations form. That works when you know exactly what you run; it does not let an
 * administrator see what is available, what is connected, or whether it is actually
 * reachable. This screen answers those three questions, and its "Connected" state is
 * driven by a real tool listing from the server rather than by a saved flag.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, Loader2, Plus, Search, ServerCog, Star, X,
} from "lucide-react";

import {
  connectConnector, disconnectConnector, listConnectors, testConnector,
  type Connector, type ConnectorField,
} from "../api";

/* Per-category accent so the grid is legible at a glance without per-brand logos. */
const TONE: Record<string, string> = {
  Infrastructure: "bg-sky-500",
  Observability: "bg-violet-500",
  Developer: "bg-slate-700",
  Data: "bg-emerald-600",
  Productivity: "bg-amber-500",
  Files: "bg-cyan-600",
  Custom: "bg-rose-500",
};

function Tile({ name, category }: { name: string; category: string }) {
  return (
    <div
      className={`grid size-9 shrink-0 place-items-center rounded-lg text-[15px] font-semibold text-white shadow-sm ${
        TONE[category] ?? "bg-slate-500"
      }`}
      aria-hidden
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function Card({
  c, onConnect, onConfigure,
}: {
  c: Connector;
  onConnect: (c: Connector) => void;
  onConfigure: (c: Connector) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
      <Tile name={c.name} category={c.category} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
            {c.name}
          </span>
          {c.badge && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
              {c.badge === "Popular" && <Star className="size-2.5" />}
              {c.badge}
            </span>
          )}
          {c.connected && c.reachable === true && (
            <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[9px] font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-400">
              {c.tools_exposed} read tools
            </span>
          )}
          {c.connected && c.reachable === false && (
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
              enabled · server not answering
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          {c.description}
        </p>
      </div>
      {c.connected ? (
        <button
          type="button"
          onClick={() => onConfigure(c)}
          title={
            c.reachable === false
              ? "Enabled, but the server is not answering — open to test or disconnect"
              : "Connected — test or disconnect"
          }
          aria-label={`${c.name} connected`}
          className={`grid size-7 shrink-0 place-items-center rounded-full text-white transition ${
            c.reachable === false
              ? "bg-amber-500 hover:bg-amber-600"
              : "bg-emerald-500 hover:bg-emerald-600"
          }`}
        >
          {/* A connected-but-silent connector used to get the same green tick as a
              healthy one, which reads as "all good" when the server is down. Amber
              states the fact; the card text says which. */}
          {c.reachable === false ? <AlertTriangle className="size-4" /> : <Check className="size-4" />}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onConnect(c)}
          title={`Connect ${c.name}`}
          aria-label={`Connect ${c.name}`}
          className="grid size-7 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}

export default function ConnectorsGallery() {
  const [groups, setGroups] = useState<{ category: string; connectors: Connector[] }[]>([]);
  const [extras, setExtras] = useState<Connector[]>([]);
  const [counts, setCounts] = useState({ total: 0, connected: 0, reachable: 0 });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "connected" | "available">("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<Connector | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const d = await listConnectors();
      setGroups(d.groups || []);
      setExtras(d.extras || []);
      setCounts(d.counts || { total: 0, connected: 0, reachable: 0 });
    } catch {
      setMsg({ ok: false, text: "Could not load connectors." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);


  const all = useMemo(
    () => [...groups.flatMap((g) => g.connectors), ...extras],
    [groups, extras],
  );

  // The list endpoint answers immediately and probes the servers in the background (a
  // settings page must not block ~6s on a network probe). So when a connected connector
  // comes back with reachability UNKNOWN, ask once more shortly after — that surfaces the
  // real tool count without the user having to reload.
  useEffect(() => {
    const unknown = all.some((c) => c.connected && c.reachable === null);
    if (!unknown) return;
    const t = window.setTimeout(() => { void load(); }, 7000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const matches = (c: Connector) => {
    if (filter === "connected" && !c.connected) return false;
    if (filter === "available" && c.connected) return false;
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (c.name + " " + c.description + " " + c.category).toLowerCase().includes(needle);
  };

  const visibleGroups = useMemo(() => {
    const gs = groups
      .map((g) => ({ category: g.category, connectors: g.connectors.filter(matches) }))
      .filter((g) => g.connectors.length > 0);
    const ex = extras.filter(matches);
    if (ex.length) {
      const found = gs.find((g) => g.category === "Custom");
      if (found) found.connectors.push(...ex);
      else gs.push({ category: "Custom", connectors: ex });
    }
    return gs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, extras, q, filter]);

  function openConnect(c: Connector) {
    setMsg(null);
    // A connector with no fields to fill (already pointing at a default URL) can be
    // enabled directly; otherwise the form opens.
    setEditing(c);
  }

  async function submit(c: Connector, values: Record<string, string>) {
    setBusy(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = { ...values, enabled: "true" };
      if (c.source === "custom" && !c.fields?.length) payload.enabled = "true";
      await connectConnector(c.id, payload);
      const t = await testConnector(c.id);
      setMsg({
        ok: !!t.ok,
        text: t.ok ? `${c.name}: ${t.detail}` : `${c.name}: ${t.detail}`,
      });
      setEditing(null);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: `${c.name}: ${e instanceof Error ? e.message : "failed"}` });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(c: Connector) {
    setBusy(true);
    setMsg(null);
    try {
      await disconnectConnector(c.id);
      setMsg({ ok: true, text: `${c.name} disconnected.` });
      setEditing(null);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: `${c.name}: ${e instanceof Error ? e.message : "failed"}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5">
      {/* header + custom connector menu */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Connectors
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Connect services so the assistant can read and act on your data. Every tool
            is read-only.
          </p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-medium text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
          >
            <Plus className="size-3.5" /> Custom connector
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  const custom = all.find((c) => c.id === "custom");
                  if (custom) setEditing(custom);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <ServerCog className="size-3.5" /> Add MCP connector
              </button>
              <div className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-400 dark:border-slate-800">
                Connect your own API is not available yet.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* search + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search all connectors"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-[12px] outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        {(["all", "connected", "available"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium capitalize transition ${
              filter === f
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {f}
            {f === "connected" && counts.connected ? ` (${counts.connected})` : ""}
          </button>
        ))}
      </div>

      {msg && (
        <div
          className={`mb-3 rounded-lg px-3 py-2 text-[11px] ${
            msg.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
          }`}
        >
          {msg.text}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-6 text-[12px] text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Loading connectors…
        </div>
      )}

      {!loading && visibleGroups.length === 0 && (
        <p className="py-6 text-center text-[12px] text-slate-500">
          No connectors match {q ? `"${q}"` : "this filter"}.
        </p>
      )}

      {visibleGroups.map((g) => (
        <div key={g.category} className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {g.category}
            </span>
            <span className="text-[10px] text-slate-400">{g.connectors.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {g.connectors.map((c) => (
              <Card key={c.id} c={c} onConnect={openConnect} onConfigure={openConnect} />
            ))}
          </div>
        </div>
      ))}

      {editing && (
        <ConnectDialog
          c={editing}
          busy={busy}
          onSubmit={submit}
          onDisconnect={disconnect}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ConnectDialog({
  c, busy, onSubmit, onDisconnect, onClose,
}: {
  c: Connector;
  busy: boolean;
  onSubmit: (c: Connector, v: Record<string, string>) => void;
  onDisconnect: (c: Connector) => void;
  onClose: () => void;
}) {
  const fields: ConnectorField[] = c.fields?.length
    ? c.fields
    : [
        { key: "name", label: "Display name", kind: "text", required: true },
        { key: "url", label: "MCP server URL", kind: "text", required: true },
        { key: "token", label: "Bearer token", kind: "password", required: false },
      ];
  const [v, setV] = useState<Record<string, string>>(() => ({
    url: c.url || c.url_default || "",
    rancher_url: c.rancher_url || "",
  }));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <Tile name={c.name} category={c.category} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold">{c.name}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {c.description}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                {f.label}
                {f.required ? "" : " (optional)"}
              </span>
              <input
                type={f.kind === "password" ? "password" : "text"}
                value={v[f.key] ?? ""}
                onChange={(e) => setV((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={f.placeholder || ""}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
          ))}
          {c.note && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              {c.note}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
          {c.connected ? (
            <button
              type="button"
              onClick={() => onDisconnect(c)}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/40"
            >
              Disconnect
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSubmit(c, v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-[11px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {c.connected ? "Save & test" : "Connect & test"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
