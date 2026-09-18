/**
 * Reusable render harness — screenshots an answer WITHOUT logging in.
 *
 * Why it exists: proving a markdown-rendering change needed a real browser, but the
 * reviewer account had been deleted from production and signing in is not something a
 * verification script may do on its own. This renders the SAME component the chat page
 * uses, with the SAME stylesheet, on the REAL backend payloads — so the screenshot shows
 * the true presentation without touching auth or the database.
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/markdown_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import MarkdownMessage from "./components/MarkdownMessage";

declare global {
  interface Window { __HARNESS__?: { ready: boolean; tables: number } }
}

const PROXMOX_VMS = `**29 VMs**

| VMID | Name | Status | CPU | Memory | Uptime |
|---|---|---|---|---|---|
| 100 | drlinuxer-prod-worker-7nc7k-kpd7b | running | 10.0% | 15.3 / 16.0 GB | 5d 9h |
| 100010 | nsvr1 | running | 8.3% | 2.2 / 4.0 GB | 6d 9h |
| 100011 | nsvr2 | running | 5.2% | 1.7 / 4.0 GB | 6d 9h |
| 100012 | truenas | running | 1.5% | 7.7 / 8.0 GB | 31d 9h |
| 100014 | harbor | running | 1.6% | 7.5 / 8.0 GB | 31d 9h |
| 100017 | xwiki | running | 15.2% | 9.3 / 16.0 GB | 28d 13h |
| 100018 | lgmt-stack | running | 6.1% | 13.8 / 16.0 GB | 12d 4h |
| 100019 | zabbix | stopped | 0.0% | 0.0 / 4.0 GB | 0m |
| 9301 | k8s-worker (template) | stopped | 0.0% | 0.0 / 4.0 GB | 0m |`;

const K8S_NODES = `**6 Nodes**

| Name | Status | Roles | Internal IP | Version | Age |
|---|---|---|---|---|---|
| drlinuxer-prod-master-jzgf9-cvkxk | Ready | control-plane,etcd,worker | 10.10.10.116 | v1.36.4+rke2r1 | 5d |
| drlinuxer-prod-master-jzgf9-flcx8 | Ready | control-plane,etcd,worker | 10.10.10.118 | v1.36.4+rke2r1 | 5d |
| drlinuxer-prod-worker-7nc7k-8m6v2 | Ready | worker | 10.10.10.114 | v1.36.4+rke2r1 | 5d |
| drlinuxer-prod-worker-7nc7k-kpd7b | Ready | worker | 10.10.10.117 | v1.36.4+rke2r1 | 5d |`;

const STORAGE = `**2 datastore(s)** on pve01

| Storage | Type | Content | Used | Available | Total | Use% |
|---|---|---|---|---|---|---|
| local | dir | vztmpl,iso,import,backup | 26.4 GB | 413.4 GB | 459.5 GB | 5.7% |
| data | lvmthin | rootdir,images | 957.4 GB | 5.6 TB | 6.5 TB | 14.3% |`;

/** Mirrors the chat bubble: the green badge above, the evidence card below. */
function Answer({ body, source }: { body: string; source: string }) {
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
        ⚡ live infrastructure · read-only MCP
      </span>
      <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
        <MarkdownMessage content={body} />
      </div>
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-3.5 py-2.5 text-[11px] text-slate-700">
        <span className="font-medium">⚡ Live infrastructure</span>
        <span className="ml-2">{source}</span>
        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">read-only</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <Answer body={PROXMOX_VMS} source="Proxmox VE" />
    <Answer body={K8S_NODES} source="Rancher / Kubernetes" />
    <Answer body={STORAGE} source="Proxmox VE" />
  </>
);

window.__HARNESS__ = { ready: true, tables: 0 };
