/**
 * EvidenceCard — the two claims it makes about live infrastructure.
 *
 * THE DISTINCTION THIS GUARDS: `evidence.servers` is what the turn USED; `scope` is what it
 * was ALLOWED to use. They are produced by different layers and mean different things, and a
 * card that showed only the first would leave a reader unable to tell "I restricted this to
 * Grafana" from "Grafana happened to be all that had anything to say".
 *
 * Static markup, like the other tests here: this repo has no DOM-interaction harness, and the
 * risk is in what gets rendered, not in what a click does.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EvidenceCard, { type Evidence } from "./EvidenceCard";

const EV: Evidence = { kind: "mcp", servers: ["grafana"], read_only: true, calls: 2 };

describe("EvidenceCard scope chip", () => {
  it("renders no scope chip when the conversation is unscoped", () => {
    const html = renderToStaticMarkup(<EvidenceCard evidence={EV} />);
    // Absent means "all connectors", so an empty chip would be actively misleading.
    expect(html).not.toContain("scoped:");
  });

  it("shows the connectors the turn was restricted to", () => {
    const html = renderToStaticMarkup(<EvidenceCard evidence={EV} scope={["grafana"]} />);
    expect(html).toContain("scoped: Grafana");
    // ...next to what it actually used, not instead of it.
    expect(html).toContain("Grafana");
  });

  it("prettifies every connector the picker can offer", () => {
    // The picker names all four; a card that lowercased two of them would look broken beside
    // the ones it knows.
    for (const [name, label] of [
      ["rancher", "Rancher / Kubernetes"],
      ["proxmox", "Proxmox VE"],
      ["grafana", "Grafana"],
      ["postgres", "PostgreSQL"],
    ] as const) {
      const html = renderToStaticMarkup(
        <EvidenceCard evidence={{ ...EV, servers: [name] }} scope={[name]} />,
      );
      expect(html).toContain(label);
    }
  });

  it("falls back to the wire name for an unknown connector", () => {
    const html = renderToStaticMarkup(<EvidenceCard evidence={EV} scope={["newthing"]} />);
    expect(html).toContain("scoped: newthing");
  });
});
