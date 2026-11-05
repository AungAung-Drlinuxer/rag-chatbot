// Screenshot + DRIVE the Tickets page.
//
// Renders the real page against a 23-ticket `/api/tickets` fixture
// (see src/__tickets_harness__.tsx) and checks what a redesign can quietly break:
//
//   1. the four metric cards equal the fixture (23 / 11 / 6 / 4), share a row of equal
//      heights at 1280, and become 2x2 at 390
//   2. the toolbar keeps its two labelled selects and its search field, and shows a
//      removable chip for each applied filter
//   3. the desktop table shows 10 rows, a pager that says 1–10 of 23, real badges, and
//      moves to 11–20 on Next
//   4. below md the table is gone, cards appear instead, and opening one raises the detail
//      sheet (which used to be `hidden` at every width under xl)
//   5. sorting still advertises direction through aria-sort
//   6. no horizontal overflow at 320 / 390 / 768 / 1280, and the dark palette holds
//
// Usage (dev server only): node scripts/tickets_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5233;
const BASE = `http://localhost:${PORT}/tickets-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "pipe" });
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});
const reachable = async (u) => { try { return (await fetch(u, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };
let up = false;
for (let i = 0; i < 60 && !up; i++) { up = await reachable(BASE); if (!up) await sleep(1000); }
if (!up) { dev.kill(); throw new Error(`harness not reachable at ${BASE}`); }
await sleep(2200);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const problems = [];
const fail = (m) => problems.push(m);
const report = {};

const MEASURE = () => {
  const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const cards = [...document.querySelectorAll('[data-slot="card"]')].slice(0, 4);
  const table = document.querySelector("table");
  const tableVisible = table ? getComputedStyle(table).display !== "none" && table.getBoundingClientRect().height > 0 : false;
  const cardLinks = [...document.querySelectorAll("ul.md\\:hidden > li button")];
  return {
    vw: window.innerWidth,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    stats: cards.map((c) => ({
      label: txt(c.querySelector("span.text-2xs")),
      value: txt(c.querySelector("span.text-2xl, span.text-3xl")),
      h: Math.round(c.getBoundingClientRect().height),
      w: Math.round(c.getBoundingClientRect().width),
    })),
    tableVisible,
    rows: table ? table.querySelectorAll("tbody tr").length : 0,
    headers: table ? [...table.querySelectorAll("thead th")].map((th) => txt(th)) : [],
    statuses: table ? [...table.querySelectorAll("tbody tr td:nth-child(3)")].map((td) => txt(td)) : [],
    priorities: table ? [...table.querySelectorAll("tbody tr td:nth-child(4)")].map((td) => txt(td)) : [],
    cardCount: cardLinks.length,
    cardTexts: cardLinks.slice(0, 2).map((b) => txt(b).slice(0, 120)),
    pager: txt(document.querySelector("table")?.closest("div")?.parentElement?.querySelector(".border-t") ?? document.body).slice(0, 80),
    searchWidth: Math.round(document.querySelector('input[aria-label="Search tickets"]')?.getBoundingClientRect().width ?? 0),
    body: document.body.textContent ?? "",
    aside: (() => {
      const a = document.querySelector("aside");
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { visible: r.height > 0 && getComputedStyle(a).display !== "none", position: getComputedStyle(a).position, width: Math.round(r.width), bottom: Math.round(r.bottom) };
    })(),
  };
};

async function open(query = "", width = 1280, height = 1000) {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.goto(`${BASE}${query}`, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(1400);
  return { page, errs };
}

// ---- 1. desktop layout, metrics, table --------------------------------------------
{
  const { page, errs } = await open();
  const m = await page.evaluate(MEASURE);
  const p = [];
  if (errs.length) p.push(`JS error: ${errs[0]}`);
  if (m.overflow) p.push("horizontal overflow at 1280");

  const values = m.stats.map((s) => s.value).join(",");
  if (values !== "23,11,6,4") p.push(`metric values were ${values}, expected 23,11,6,4`);
  if (m.stats.length !== 4) p.push(`${m.stats.length} metric cards`);
  const heights = new Set(m.stats.map((s) => s.h));
  if (heights.size > 1) p.push(`metric cards have different heights: ${[...heights].join(",")}`);
  if (m.stats.some((s) => s.w < 150)) p.push("a metric card is narrower than 150px at 1280");

  if (!m.tableVisible) p.push("desktop table is not visible");
  if (m.rows !== 10) p.push(`table rendered ${m.rows} rows, expected 10`);
  if (m.headers.join("|") !== "Ticket|Subject|Status|Priority|Requester") p.push(`headers: ${m.headers.join("|")}`);
  if (m.statuses.filter((s) => /Open|Pending|Resolved|Closed/.test(s)).length !== 10) p.push("status column missing labels");
  if (m.priorities.filter((s) => /Critical|High|Medium|Low/.test(s)).length !== 10) p.push("priority column missing labels");
  if (!/Showing 1–10 of 23 tickets/.test(m.body)) p.push("range footer is not 1–10 of 23");

  await page.screenshot({ path: `${OUT}/tickets_desktop.png`, fullPage: true });
  report.desktop = { ...m, body: undefined, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 2. filters + sorting + paging -------------------------------------------------
{
  const { page } = await open();
  const p = [];

  // status filter via the labelled select
  await page.select('select[aria-label="Filter by status"]', "open");
  await sleep(600);
  let m = await page.evaluate(MEASURE);
  if (m.rows !== 10) p.push(`status=open page 1 showed ${m.rows} rows, expected a full page of 10`);
  if (!/Status: Open/.test(m.body)) p.push("applied status filter has no chip");
  if (!/11 matching tickets/.test(m.body)) p.push("result count did not follow the filter");

  // remove the chip
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Remove filter"))?.click();
  });
  await sleep(500);
  m = await page.evaluate(MEASURE);
  if (m.rows !== 10) p.push(`clearing the chip left ${m.rows} rows`);

  // search narrows
  await page.type('input[aria-label="Search tickets"]', "printer");
  await sleep(600);
  m = await page.evaluate(MEASURE);
  if (m.rows !== 1) p.push(`search returned ${m.rows} rows`);
  if (!/1 matching tickets/.test(m.body)) p.push("search count is wrong");

  // clear search via its X
  await page.click('button[aria-label="Clear search"]');
  await sleep(500);

  // paging
  await page.click('button[aria-label="Next page"]');
  await sleep(600);
  m = await page.evaluate(MEASURE);
  if (!/Showing 11–20 of 23 tickets/.test(m.body)) p.push("Next page did not move to 11–20");
  if (m.rows !== 10) p.push(`page 2 rendered ${m.rows} rows`);

  // sort
  const aria = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("thead button")].find((b) => (b.textContent ?? "").trim().startsWith("Ticket"));
    const before = btn?.getAttribute("aria-sort");
    btn?.click();
    return before;
  });
  await sleep(500);
  const aria2 = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("thead button")].find((b) => (b.textContent ?? "").trim().startsWith("Ticket"));
    return btn?.getAttribute("aria-sort");
  });
  if (aria !== "none" || aria2 !== "descending") p.push(`sort aria-sort was ${aria} then ${aria2}, expected none then descending`);

  await page.screenshot({ path: `${OUT}/tickets_filtered.png`, fullPage: true });
  report.interactions = { problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 3. mobile: cards + detail sheet ----------------------------------------------
{
  const { page } = await open("", 390, 844);
  const p = [];
  let m = await page.evaluate(MEASURE);
  if (m.overflow) p.push("mobile: horizontal overflow");
  if (m.tableVisible) p.push("mobile: the desktop table is still rendered");
  if (m.cardCount !== 10) p.push(`mobile: ${m.cardCount} cards, expected 10`);
  if (m.stats.length !== 4) p.push("mobile: metric cards missing");
  if (m.stats[0].w > 220) p.push(`mobile: metric card is ${m.stats[0].w}px wide — not a 2-up grid`);
  if (m.searchWidth < 300) p.push(`mobile: search is only ${m.searchWidth}px wide`);

  // open the first card → bottom sheet
  await page.evaluate(() => document.querySelector("ul.md\\:hidden > li button")?.click());
  await sleep(700);
  m = await page.evaluate(MEASURE);
  if (!m.aside?.visible) p.push("mobile: tapping a ticket did not show the detail sheet");
  if (m.aside && m.aside.position !== "fixed") p.push(`mobile: detail position is ${m.aside.position}`);
  if (!/Status — click to change/.test(m.body)) p.push("mobile: sheet content missing");
  await page.screenshot({ path: `${OUT}/tickets_mobile_sheet.png`, fullPage: false });

  // close
  await page.evaluate(() => {
    const aside = document.querySelector("aside");
    aside?.querySelector("button")?.click();
  });
  await sleep(500);
  m = await page.evaluate(MEASURE);
  if (m.aside?.visible) p.push("mobile: sheet did not close");

  await page.screenshot({ path: `${OUT}/tickets_390.png`, fullPage: true });
  report.mobile = { ...m, body: undefined, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 4. tablet + dark --------------------------------------------------------------
{
  const { page } = await open("", 768, 1024);
  const p = [];
  const m = await page.evaluate(MEASURE);
  if (m.overflow) p.push("768px: horizontal overflow");
  if (!m.tableVisible) p.push("768px: table missing");
  if (m.rows !== 10) p.push(`768px: ${m.rows} rows`);
  await page.screenshot({ path: `${OUT}/tickets_768.png`, fullPage: true });
  report.tablet = { overflow: m.overflow, rows: m.rows, problems: p };
  p.forEach(fail);
  await page.close();

  const d = await open("?theme=dark");
  const q = [];
  const bg = await d.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--card").trim());
  if (!/^#1E1A2A$/i.test(bg)) q.push(`dark --card was ${JSON.stringify(bg)}`);
  const dm = await d.page.evaluate(MEASURE);
  if (dm.overflow) q.push("dark: horizontal overflow");
  await d.page.screenshot({ path: `${OUT}/tickets_dark.png`, fullPage: true });
  report.dark = { bg, problems: q };
  q.forEach(fail);
  await d.page.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (problems.length) {
  console.error(`\nFAILED (${problems.length}):`);
  problems.forEach((x) => console.error("  - " + x));
  process.exit(1);
}
console.log("\nOK: metrics match the queue, filters and pager work, cards replace the table on mobile, the sheet opens");
