/**
 * ScopeControl — the per-conversation connector scope.
 *
 * WHY THESE ASSERTIONS AND NOT CLICKS: this repo has no DOM-interaction harness (no
 * @testing-library, by choice — `MarkdownMessage.test.tsx` uses `react-dom/server` too), so
 * the test targets the part that is actually capable of failing silently rather than the
 * part that throws.
 *
 * The failure this guards: the scope decides whether an infrastructure answer may reach a
 * connector AT ALL, and its wire format encodes "unscoped" as an ABSENT key (`streamChat`
 * omits empty arrays). So the two states — "restricted to one connector" and "restricted to
 * nothing" — are one bad `??` apart, and a mistake there does not raise: the user just gets
 * "no tools matched" for every question. These tests pin the naming rules and the
 * empty-server-list behaviour that keep that from happening.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ScopeControl, { scopeLabel, type McpServer } from "./ScopeControl";

const SERVERS: McpServer[] = [
  { name: "rancher", label: "rancher", curated: true },
  { name: "grafana", label: "grafana", curated: true },
  { name: "proxmox", label: "proxmox", curated: true },
];

describe("scopeLabel", () => {
  it("reads an empty selection as EVERY connector, never as none", () => {
    // The single most dangerous inversion in this feature: [] means "unscoped" on the wire.
    expect(scopeLabel([])).toBe("All connectors");
  });

  it("uses the display name for one connector, not the lowercase API token", () => {
    expect(scopeLabel(["grafana"])).toBe("Grafana");
    expect(scopeLabel(["rancher"])).toBe("Rancher");
    expect(scopeLabel(["postgres"])).toBe("PostgreSQL");
  });

  it("falls back to the wire name for a connector the UI does not prettify", () => {
    // A newly configured MCP server must still be nameable rather than rendering "undefined".
    expect(scopeLabel(["newthing"])).toBe("newthing");
  });

  it("collapses several to 'first +N' so the pill keeps one fixed width", () => {
    expect(scopeLabel(["grafana", "proxmox"])).toBe("Grafana +1");
    expect(scopeLabel(["grafana", "proxmox", "rancher"])).toBe("Grafana +2");
  });
});

describe("ScopeControl markup", () => {
  it("renders nothing when no connector is available", () => {
    // A failed /api/mcp/servers read must leave the chat page exactly as it was.
    const html = renderToStaticMarkup(
      <ScopeControl servers={[]} value={[]} onChange={() => {}} />,
    );
    expect(html).toBe("");
  });

  it("shows the current scope in the button's accessible name", () => {
    const html = renderToStaticMarkup(
      <ScopeControl servers={SERVERS} value={["grafana"]} onChange={() => {}} />,
    );
    expect(html).toContain("Connectors: Grafana");
    expect(html).not.toContain("All connectors</span>");
    // Closed state: the popover, and therefore the options, are not in the DOM at all.
    expect(html).not.toContain('role="listbox"');
  });

  it("keeps the closed pill free of a variable-width chip list", () => {
    // Guards the 390px regression class: only ONE label node, whatever the selection size.
    const one = renderToStaticMarkup(
      <ScopeControl servers={SERVERS} value={["grafana"]} onChange={() => {}} />,
    );
    const three = renderToStaticMarkup(
      <ScopeControl servers={SERVERS} value={["grafana", "proxmox", "rancher"]} onChange={() => {}} />,
    );
    expect((one.match(/truncate/g) ?? []).length).toBe((three.match(/truncate/g) ?? []).length);
  });
});