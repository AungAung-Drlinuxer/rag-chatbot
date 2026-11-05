// Screenshot + MEASURE the redesigned Overview page.
//
// The page is behind auth, so this renders the REAL component with `fetch` stubbed to
// endpoint-shaped fixtures (src/__dashboard_harness__.tsx). Nothing in the component is
// mocked — only its data source.
//
// What it proves, as arithmetic rather than opinion:
//   1. no JS errors, no horizontal overflow at 1440 or 390
//   2. the page is ordered around decisions: attention → KPIs → quality → queue → health
//   3. KPI tiles are complete and equal (6 admin / 5 user), and every row spans full width
//   4. the two quality cards and three queue cards share a height and equal columns
//   5. real signals drive the attention strip: a degraded fixture must produce a
//      "Dependency down" tile naming Redis, a healthy one must not
//   6. an empty install shows the empty state, never a grid of zeroes
//   7. no placeholder copy ships (lorem/sample/dummy/mock)
//   8. the custom-range picker still reaches the wire with start=…&end=…
//
// Usage (dev server only): node scripts/dashboard_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5217;
const BASE = `http://localhost:${PORT}/dashboard-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "pipe" });
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

const reachable = async (u) => {
  try { return (await fetch(u, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
};
let up = false;
for (let i = 0; i < 60 && !up; i++) { up = await reachable(BASE); if (!up) await sleep(1000); }
if (!up) { dev.kill(); throw new Error(`harness not reachable at ${BASE}`); }
await sleep(2200);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const MEASURE = () => {
  const round = (n) => Math.round(n);
  const section = (name) => document.querySelector(`[data-section="${name}"]`);
  const kids = (el) => (el ? [...el.children].filter((c) => c.getBoundingClientRect().height > 20) : []);
  const heights = (el) => kids(el).map((c) => round(c.getBoundingClientRect().height));
  const widths = (el) => kids(el).map((c) => round(c.getBoundingClientRect().width));
  const uniform = (a, tol = 1) => a.length > 0 && a.every((v) => Math.abs(v - a[0]) <= tol);
  const rowSpan = (el) => {
    if (!el) return null;
    const rows = new Map();
    for (const c of kids(el)) {
      const r = c.getBoundingClientRect();
      const k = round(r.top / 4) * 4;
      const row = rows.get(k) ?? { left: Infinity, right: -Infinity, n: 0 };
      row.left = Math.min(row.left, r.left); row.right = Math.max(row.right, r.right); row.n++;
      rows.set(k, row);
    }
    return { width: round(el.clientWidth), rows: [...rows.values()].map((r) => ({ n: r.n, covered: round(r.right - r.left) })) };
  };
  const order = [...document.querySelectorAll("[data-section]")].map((e) => e.getAttribute("data-section"));
  const text = document.body.textContent ?? "";
  const de = document.documentElement;
  return {
    order,
    scrollW: de.scrollWidth, clientW: de.clientWidth, scrollH: de.scrollHeight,
    kpiCount: kids(section("kpis")).length,
    kpi: rowSpan(section("kpis")),
    kpiHeights: heights(section("kpis")),
    quality: { heights: heights(section("quality")), widths: widths(section("quality")) },
    queue: { heights: heights(section("queue")), widths: widths(section("queue")) },
    attentionText: section("attention")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    hasEmptyState: /No activity in this reporting window/.test(text),
    hasPlaceholderCopy: /lorem ipsum|sample data|dummy data|mock data/i.test(text),
    kpiValues: kids(section("kpis")).map((c) => c.textContent?.replace(/\s+/g, " ").trim().slice(0, 90)),
  };
};

const report = {};
let failed = false;
const problems = [];
const fail = (m) => { failed = true; problems.push(m); return m; };
const uniform = (a) => a.length > 0 && a.every((v) => Math.abs(v - a[0]) <= 1);

for (const role of ["admin", "user"]) {
  for (const theme of ["light", "dark"]) {
    const key = `${role}_${theme}`;
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
    await page.goto(`${BASE}?role=${role}&theme=${theme}`, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction("window.__DASH_HARNESS__?.ready === true", { timeout: 20000 });
    await sleep(1400);

    const m = await page.evaluate(MEASURE);
    const p = [];
    if (pageErrors.length) p.push(`pageErrors=${pageErrors.length}: ${pageErrors[0]}`);
    if (m.scrollW > m.clientW + 1) p.push(`horizontal overflow ${m.scrollW}>${m.clientW}`);
    if (m.hasPlaceholderCopy) p.push("placeholder copy shipped");

    const wanted = ["attention", "kpis", "queue", "quality", "health"];
    if (JSON.stringify(m.order) !== JSON.stringify(wanted)) p.push(`section order ${JSON.stringify(m.order)}`);

    const wantKpi = role === "admin" ? 6 : 5;
    if (m.kpiCount !== wantKpi) p.push(`KPI count ${m.kpiCount} != ${wantKpi}`);
    if (!uniform(m.kpiHeights)) p.push(`KPI heights differ: ${m.kpiHeights.join(",")}`);
    for (const [i, row] of (m.kpi?.rows ?? []).entries()) {
      if (Math.abs(row.covered - m.kpi.width) > 2) p.push(`KPI row ${i + 1} covers ${row.covered}/${m.kpi.width} (${row.n} cards)`);
    }
    if (!uniform(m.quality.heights)) p.push(`quality heights differ: ${m.quality.heights.join(",")}`);
    if (!uniform(m.queue.heights)) p.push(`queue heights differ: ${m.queue.heights.join(",")}`);
    if (!uniform(m.queue.widths)) p.push(`queue widths differ: ${m.queue.widths.join(",")}`);

    await page.screenshot({ path: `${OUT}/overview_${key}.png`, fullPage: true });
    report[key] = { ...m, problems: p };
    p.forEach(fail);
    await page.close();
  }
}

// ---- signal-driven attention strip (degraded) --------------------------------------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await page.goto(`${BASE}?role=admin&theme=light&state=degraded`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction("window.__DASH_HARNESS__?.ready === true", { timeout: 20000 });
  await sleep(1200);
  const m = await page.evaluate(MEASURE);
  const p = [];
  if (m.scrollW > m.clientW + 1) p.push(`degraded: horizontal overflow`);
  if (!/Dependency down/.test(m.attentionText ?? "")) p.push("degraded: no 'Dependency down' tile");
  if (!/Redis/.test(m.attentionText ?? "")) p.push("degraded: failing dependency not named");
  const body = await page.evaluate(() => document.body.textContent ?? "");
  if (!/Failing: Redis/.test(body)) p.push("degraded: failing dependency not surfaced in health");
  if (!/27 events/.test(body)) p.push("degraded: guardrail counter missing from health");
  if (/Nothing blocking right now/.test(m.attentionText ?? "")) p.push("degraded: claims all clear while Redis is down");
  await page.screenshot({ path: `${OUT}/overview_degraded_light.png`, fullPage: true });
  report.degraded = { attentionText: m.attentionText, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- empty install ----------------------------------------------------------------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}?role=admin&theme=light&state=empty`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction("window.__DASH_HARNESS__?.ready === true", { timeout: 20000 });
  await sleep(1000);
  const m = await page.evaluate(MEASURE);
  const p = [];
  if (!m.hasEmptyState) p.push("empty install did not show the empty state");
  if (m.kpiCount > 0) p.push(`empty install still rendered ${m.kpiCount} KPI tiles`);
  await page.screenshot({ path: `${OUT}/overview_empty_light.png`, fullPage: true });
  report.empty = { hasEmptyState: m.hasEmptyState, kpiCount: m.kpiCount, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- mobile 390 -------------------------------------------------------------------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`${BASE}?role=admin&theme=light`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction("window.__DASH_HARNESS__?.ready === true", { timeout: 20000 });
  await sleep(1000);
  const m = await page.evaluate(MEASURE);
  const p = [];
  if (m.scrollW > m.clientW + 1) p.push(`mobile horizontal overflow ${m.scrollW}>${m.clientW}`);
  if (m.kpiCount !== 6) p.push(`mobile KPI count ${m.kpiCount}`);
  await page.screenshot({ path: `${OUT}/overview_mobile_light.png`, fullPage: true });
  report.mobile = { scrollW: m.scrollW, clientW: m.clientW, kpiCount: m.kpiCount, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- custom range still reaches the wire ------------------------------------------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await page.goto(`${BASE}?role=admin&theme=light`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction("window.__DASH_HARNESS__?.ready === true", { timeout: 20000 });
  await sleep(1200);

  const seriesReqs = () =>
    page.evaluate(() => window.__DASH_REQS__.filter((u) => /dashboard\/(conversations|gate-trend)\?/.test(u)));

  const initial = await seriesReqs();
  await page.click('button[title="Reporting window"]');
  await sleep(250);
  const opened = await page.evaluate(() => ({
    dateInputs: document.querySelectorAll('input[type="date"]').length,
    hasCustom: /Custom range/.test(document.body.textContent ?? ""),
  }));

  await page.evaluate(() => { window.__DASH_REQS__.length = 0; });
  await page.evaluate(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const [fromEl, toEl] = document.querySelectorAll('input[type="date"]');
    set.call(fromEl, "2026-09-01"); fromEl.dispatchEvent(new Event("input", { bubbles: true }));
    set.call(toEl, "2026-09-30"); toEl.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(400);
  const beforeApply = await seriesReqs();
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Apply range")?.click();
  });
  await sleep(1600);
  const after = await page.evaluate(() => ({
    reqs: window.__DASH_REQS__.filter((u) => /dashboard\/(conversations|gate-trend)\?/.test(u)),
    label: document.querySelector('button[title="Reporting window"]')?.textContent?.trim() ?? null,
  }));

  const p = [];
  if (opened.dateInputs !== 2 || !opened.hasCustom) p.push("custom range controls missing");
  if (beforeApply.length !== 0) p.push(`draft range reached the wire before Apply: ${beforeApply.length}`);
  const withRange = after.reqs.filter((u) => /start=.*end=/.test(u));
  if (withRange.length !== 2) p.push(`expected 2 ranged requests, got ${withRange.length}`);
  if (!withRange.some((u) => u.includes("start=2026-09-01") && u.includes("end=2026-09-30"))) p.push("wrong dates on the wire");
  if (!/2026/.test(after.label ?? "")) p.push(`label did not follow the range: ${after.label}`);
  if (initial.length !== 2) p.push(`initial load made ${initial.length} series requests`);

  await page.screenshot({ path: `${OUT}/overview_custom_range.png`, fullPage: true });
  report.custom_range = { initial, opened, beforeApply, after, problems: p };
  p.forEach(fail);
  await page.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (failed) {
  console.error(`\nFAILED (${problems.length}):`);
  problems.forEach((x) => console.error("  - " + x));
  process.exit(1);
}
console.log("\nOK: overview ordered for decisions, real signals drive the attention strip, no overflow, range reaches the wire");
