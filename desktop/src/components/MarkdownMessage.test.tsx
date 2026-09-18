/**
 * MarkdownMessage renders an infrastructure answer as a REAL table.
 *
 * THE REGRESSION THIS GUARDS: the backend wrapped every deterministic answer body in a
 * ``` fence, so react-markdown built a <pre> and the user saw the raw pipes
 * (`| Node | Status | …` with `|---|`) in a dark monospace block, with `**bold**` printed as
 * literal asterisks — over data that was entirely correct. A screenshot could not tell that
 * apart from "renders fine"; this asserts on the DOM instead.
 *
 * The fixtures are the verbatim strings the live backend returned (backend 1.6.89), so the
 * test fails if either side drifts: the backend starts emitting a fence again, or the
 * renderer loses remark-gfm / the table wrapper.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownMessage from "./MarkdownMessage";

/** The exact body for "Proxmox VMs list ပြပါ" — proxmox_list_vms, 29 guests. */
const PROXMOX_VMS = `**29 guest(s)**

| VMID | Kind | Name | Node | Status | CPU | Memory (used / max) | Uptime |
|---|---|---|---|---|---|---|---|
| 100 | VM | drlinuxer-prod-worker-7nc7k-kpd7b | pve01 | running | 8.2% | 15.4 GB / 16.0 GB | 5d 8h |
| 100010 | VM | nsvr1 | pve01 | running | 5.2% | 2.1 GB / 4.0 GB | 6d 9h |
| 100012 | VM | truenas | pve01 | running | 1.4% | 7.6 GB / 8.0 GB | 31d 9h |
| 100015 | VM | ROOTCA01 | pve01 | stopped | 0.0% | 0 B / 4.0 GB | 0m |

_19 more row(s) — open "Show full output" below_`;

/** The exact body for "nodes status" — kubernetes_list, 6 Nodes. */
const K8S_NODES = `**6 Nodes**

| Name | Status | Roles | Internal IP | Version | Age |
|---|---|---|---|---|---|
| drlinuxer-prod-master-jzgf9-cvkxk | Ready | control-plane,etcd,worker | 10.10.10.116 | v1.36.4+rke2r1 | 5d |
| drlinuxer-prod-worker-7nc7k-8m6v2 | Ready | worker | 10.10.10.114 | v1.36.4+rke2r1 | 5d |

_4 more row(s) — open "Show full output" below_`;

/** The exact body for "Proxmox storage ပြပါ" — proxmox_list_storage (the NESTED payload). */
const PROXMOX_STORAGE = `**2 datastore(s)** on pve01

| Storage | Type | Content | Used | Available | Total | Use% |
|---|---|---|---|---|---|---|
| local | dir | vztmpl,iso,import,backup | 26.4 GB | 413.4 GB | 459.5 GB | 5.7% |
| data | lvmthin | rootdir,images | 957.4 GB | 5.6 TB | 6.5 TB | 14.3% |`;

/** A non-table payload must STILL be fenced — reflowing raw JSON as prose is worse. */
const RAW_JSON = "```\n{\n  \"kind\": \"Node\",\n  \"metadata\": { \"name\": \"pve01\" }\n}\n```";

function render(md: string) {
  const html = renderToStaticMarkup(<MarkdownMessage content={md} />);
  // jsdom is the configured test environment, so DOMParser is available.
  return new DOMParser().parseFromString(`<div id="r">${html}</div>`, "text/html").querySelector("#r")!;
}

function headerCells(root: Element): string[] {
  const t = root.querySelector("table");
  const cells = t?.querySelectorAll("thead th");
  return cells ? [...cells].map((c) => c.textContent!.trim()) : [];
}

function bodyRowCount(root: Element): number {
  return root.querySelectorAll("table tbody tr").length;
}

describe("MarkdownMessage — infrastructure tables", () => {
  it("renders the Proxmox guest table as a <table>, not a code block", () => {
    const root = render(PROXMOX_VMS);
    expect(root.querySelectorAll("table")).toHaveLength(1);
    expect(headerCells(root)).toEqual([
      "VMID", "Kind", "Name", "Node", "Status", "CPU", "Memory (used / max)", "Uptime",
    ]);
    expect(bodyRowCount(root)).toBe(4);
    // Every column is actually rendered — the clipping that lost "Internal IP" and
    // "Version" started here, with the cells never making it into the DOM.
    const first = [...root.querySelectorAll("table tbody tr")[0].children].map((c) => c.textContent!.trim());
    expect(first[2]).toBe("drlinuxer-prod-worker-7nc7k-kpd7b");
    expect(first[5]).toBe("8.2%");
    expect(first[7]).toBe("5d 8h");
  });

  it("renders the Kubernetes node table with all six columns", () => {
    const root = render(K8S_NODES);
    expect(headerCells(root)).toEqual(["Name", "Status", "Roles", "Internal IP", "Version", "Age"]);
    expect(bodyRowCount(root)).toBe(2);
    const row = [...root.querySelectorAll("table tbody tr")[0].children].map((c) => c.textContent!.trim());
    expect(row[3]).toBe("10.10.10.116");
    expect(row[4]).toBe("v1.36.4+rke2r1");
  });

  it("renders the storage table (nested payload shape)", () => {
    const root = render(PROXMOX_STORAGE);
    expect(headerCells(root)).toEqual(["Storage", "Type", "Content", "Used", "Available", "Total", "Use%"]);
    expect(bodyRowCount(root)).toBe(2);
  });

  it("NEVER leaves a table inside a <pre> — the exact shape of the bug", () => {
    for (const fixture of [PROXMOX_VMS, K8S_NODES, PROXMOX_STORAGE]) {
      const root = render(fixture);
      const fenced = [...root.querySelectorAll("pre")].filter((p) => /\|\s*-{2,}/.test(p.textContent || ""));
      expect(fenced).toHaveLength(0);
      // ...and no raw pipe row survives anywhere outside a table either.
      expect(root.querySelectorAll("table").length).toBeGreaterThan(0);
    }
  });

  it("renders **bold** as bold, not as literal asterisks", () => {
    const root = render(PROXMOX_VMS);
    const strong = [...root.querySelectorAll("strong")].map((s) => s.textContent!.trim());
    expect(strong).toContain("29 guest(s)");
    // The heading must not still carry its markers in the text.
    expect(root.textContent).not.toContain("**");
  });

  it("names what it counted instead of saying 'object(s)'", () => {
    expect(render(K8S_NODES).querySelector("strong")!.textContent).toBe("6 Nodes");
    expect(render(PROXMOX_STORAGE).textContent).toContain("2 datastore(s) on pve01");
  });

  it("renders the truncation note as emphasis, not underscores", () => {
    const root = render(PROXMOX_VMS);
    const em = [...root.querySelectorAll("em")].map((e) => e.textContent || "");
    expect(em.some((t) => t.includes("19 more row(s)"))).toBe(true);
    expect(root.textContent).not.toContain("_19 more");
  });

  it("still fences a non-table payload", () => {
    const root = render(RAW_JSON);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    const pres = [...root.querySelectorAll("pre")];
    expect(pres).toHaveLength(1);
    expect(pres[0].textContent).toContain('"kind": "Node"');
  });

  /**
   * The mobile stacked layout prints `data-label` beside each value (styles.css, <640px).
   * Without it the phone view shows bare values with no column names — the very confusion
   * this work set out to remove, only worse than before.
   */
  it("labels every cell with its column header, for the mobile stacked layout", () => {
    const root = render(PROXMOX_VMS);
    const heads = headerCells(root);
    const rows = [...root.querySelectorAll("table tbody tr")];
    expect(rows.length).toBeGreaterThan(0);
    for (const tr of rows) {
      const labels = [...tr.querySelectorAll("td")].map((td) => td.getAttribute("data-label"));
      expect(labels).toEqual(heads);
    }
  });

  it("carries the wrapper class the responsive stylesheet hooks onto", () => {
    // jsdom reports every scrollWidth as 0, so the stacked STATE cannot be asserted here —
    // only that the wrapper the stylesheet keys off exists. The layout itself is verified
    // in a real browser (scripts/markdown_harness_shot.mjs).
    const root = render(K8S_NODES);
    const wrap = root.querySelector("table")!.parentElement!;
    expect(wrap.className).toContain("md-stack-wrap");
    expect(wrap.getAttribute("data-stacked")).toBe("0");
  });

  it("does not label header cells (they are <th>, not <td>)", () => {
    const root = render(K8S_NODES);
    expect(root.querySelectorAll("thead td")).toHaveLength(0);
    expect([...root.querySelectorAll("thead th")].every((th) => !th.hasAttribute("data-label"))).toBe(true);
  });
});
