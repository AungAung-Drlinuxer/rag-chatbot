/**
 * Scope harness — screenshots the connector scope control WITHOUT logging in.
 *
 * Same reasoning as __harness__.tsx: the chat page is behind auth and verification must not
 * sign in as anyone, but the question "does the scope pill fit at 390px" needs a real browser
 * with the real stylesheet.
 *
 * The fixture is the shape the live endpoint returns today —
 *   GET /api/mcp/servers ->
 *     {"servers":[{"name":"rancher","label":"rancher","curated":true}, ...],"can_scope":true}
 * captured from backend 1.6.102 (enabled_servers: rancher, proxmox, postgres, grafana) — so
 * the screenshot shows the true option list, including PostgreSQL's length.
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/scope_harness_shot.mjs
 */
import "./styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import ComposerControls, { ModeControl } from "./features/chat/components/ComposerControls";
import ScopeControl, { type McpServer } from "./features/chat/components/ScopeControl";


/** Verbatim from the live endpoint, in the order it returned them. */
const SERVERS: McpServer[] = [
  { name: "rancher", label: "rancher", curated: true },
  { name: "proxmox", label: "proxmox", curated: true },
  { name: "postgres", label: "postgres", curated: true },
  { name: "grafana", label: "grafana", curated: true },
];

function Desktop() {
  const [mode, setMode] = useState<"auto" | "kb" | "infra">("auto");
  const [engine, setEngine] = useState<"auto" | "cloud" | "local">("auto");
  const [scope, setScope] = useState<string[]>([]);
  return (
    <div className="p-6">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        desktop · composer control row
      </p>
      <ComposerControls
        mode={mode}
        onModeChange={setMode}
        engine={engine}
        onEngineChange={setEngine}
        servers={SERVERS}
        scope={scope}
        onScopeChange={setScope}
      />
    </div>
  );
}

/** On a phone the scope moves to the header, exactly like ModeControl. */
function PhoneHeader() {
  const [mode, setMode] = useState<"auto" | "kb" | "infra">("auto");
  const [scope, setScope] = useState<string[]>([]);
  return (
    <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-2">
      <span className="mr-auto truncate text-[12px] font-semibold text-slate-700">
        Asset inventory sync
      </span>
      <ModeControl mode={mode} onModeChange={setMode} />
      <ScopeControl
        servers={SERVERS}
        value={scope}
        onChange={setScope}
        className={mode === "kb" ? "hidden" : ""}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <PhoneHeader />
    <Desktop />
    {/* every selection size, side by side: the pill must not grow with the count */}
    <div className="flex flex-wrap items-center gap-3 p-6 pt-0">
      <ScopeControl servers={SERVERS} value={[]} onChange={() => {}} />
      <ScopeControl servers={SERVERS} value={["grafana"]} onChange={() => {}} />
      <ScopeControl servers={SERVERS} value={["grafana", "proxmox"]} onChange={() => {}} />
      <ScopeControl servers={SERVERS} value={["grafana", "proxmox", "rancher", "postgres"]} onChange={() => {}} />
      {/* an MCP server the UI does not prettify — must still be nameable, not "undefined" */}
      <ScopeControl servers={[{ name: "newthing", label: "newthing", curated: false }]} value={["newthing"]} onChange={() => {}} />
    </div>
  </>
);

// A separate global from __harness__.tsx: both are loaded by different pages, but a
// shared Window key would have to agree on one type and neither harness needs that.
(window as unknown as { __HARNESS_SCOPE__?: unknown }).__HARNESS_SCOPE__ = {
  ready: true, servers: SERVERS.map((s) => s.name),
};