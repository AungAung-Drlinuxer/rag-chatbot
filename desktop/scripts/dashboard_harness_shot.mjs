// Screenshot + MEASURE the dashboard.
//
// Why a harness instead of the running app: the dashboard is behind auth and verification
// must not sign in as anyone. The harness renders the real page component with `fetch`
// stubbed to fixtures shaped like the endpoint returns (see src/__dashboard_harness__.tsx).
//
// What it MEASURES rather than looks at — "cards are evenly arranged" is a claim that has
// to be arithmetic, not a vibe:
//   1. no JS errors, no horizontal overflow
//   2. EVERY row of the KPI grid spans the full content width. The old 4-column grid left
//      a 1- or 2-card orphan row; this is the assertion that catches it coming back
//   3. KPI cards, chart-row cards and lower-row cards are each equal in height
//   4. the chart row and lower row are three EQUAL columns (they were magic fr ratios)
//   5. "Quick actions" is gone
//   6. the wrong "Asia/Bangkok (GMT+7)" claim is gone
//   7. the range picker really reaches the wire: choosing a custom range must issue a
//      request carrying start=…&end=… — a picker that only changes a label would pass a
//      screenshot test and fail this one
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

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true,
  stdio: "pipe",
  cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await reachable(BASE);
  if (!up) await sleep(1000);
}
if (!up) {
  dev.kill();
  throw new Error(`harness server not reachable at ${BASE}`);
}
await sleep(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

/** Layout facts, measured in the page. */
const MEASURE = () => {
  const round = (n) => Math.round(n);
  const sectionWith = (needle) =>
    [...document.querySelectorAll("section")].find((s) => (s.textContent ?? "").includes(needle)) ?? null;

  const cardsOf = (section) =>
    section ? [...section.children].filter((e) => e.getBoundingClientRect().height > 40) : [];

  /** Group children into visual rows by their top edge, then report how much of the
   *  content width each row covers. A row that covers less than the full width is a
   *  ragged row — the thing the user actually complained about. */
  const rowFill = (section) => {
    if (!section) return null;
    const cs = getComputedStyle(section);
    const contentW = section.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const rows = new Map();
    for (const el of cardsOf(section)) {
      const r = el.getBoundingClientRect();
      const key = round(r.top / 4) * 4;
      const row = rows.get(key) ?? { left: Infinity, right: -Infinity, n: 0 };
      row.left = Math.min(row.left, r.left);
      row.right = Math.max(row.right, r.right);
      row.n += 1;
      rows.set(key, row);
    }
    return {
      contentW: round(contentW),
      rows: [...rows.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, row]) => ({ cards: row.n, covered: round(row.right - row.left) })),
    };
  };

  const heights = (section) => (section ? cardsOf(section).map((e) => round(e.getBoundingClientRect().height)) : []);
  const widths = (section) => (section ? cardsOf(section).map((e) => round(e.getBoundingClientRect().width)) : []);
  const uniform = (a) => a.length > 0 && a.every((v) => Math.abs(v - a[0]) <= 1);

  const kpi = sectionWith("Total Conversations");
  const chartRow = sectionWith("Knowledge by domain");
  const lowerRow = sectionWith("System health");
  const body = document.body.textContent ?? "";
  const de = document.documentElement;

  return {
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    /* v1.6.70 — the page must fit ONE screen: at 1440×900 nothing may be below the fold. */
    scrollH: de.scrollHeight,
    clientH: de.clientHeight,
    kpiFill: rowFill(kpi),
    kpiCount: kpi ? cardsOf(kpi).length : 0,
    kpiHeights: heights(kpi),
    chartHeights: heights(chartRow),
    chartWidths: widths(chartRow),
    lowerHeights: heights(lowerRow),
    lowerWidths: widths(lowerRow),
    hasQuickActions: /Quick actions/i.test(body),
    hasBangkok: /Asia\/Bangkok|GMT\+7/.test(body),
    rangeLabel: document.querySelector('button[title="Reporting window"]')?.textContent?.trim() ?? null,
    footer: [...document.querySelectorAll("div")].map((d) => d.textContent ?? "").find((t) => /Last updated/.test(t))?.slice(0, 160) ?? null,
  };
};

const report = {};
let failed = false;
const fail = (msg) => {
  failed = true;
  return msg;
};
/** Equal to within a pixel — sub-pixel layout rounding is not a difference. */
const uniform = (a) => a.length > 0 && a.every((v) => Math.abs(v - a[0]) <= 1);

for (const role of ["admin", "user"]) {
  for (const theme of ["light", "dark"]) {
    const key = `${role}_${theme}`;
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const http4xx = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("response", (r) => {
      if (r.status() >= 400) http4xx.push({ status: r.status(), url: r.url().slice(0, 160) });
    });

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${BASE}?role=${role}&theme=${theme}`, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction("window.__DASH_HARNESS__?.ready === true", { timeout: 20000 });
    await sleep(1400);

    const m = await page.evaluate(MEASURE);
    const problems = [];

    // favicon 404 is a harness artefact; anything else is real
    const badHttp = http4xx.filter((r) => !/favicon\.ico/.test(r.url));
    const generic = consoleErrors.filter((t) => /Failed to load resource/.test(t));
    const named = consoleErrors.filter((t) => !/Failed to load resource/.test(t));
    if (pageErrors.length) problems.push(fail(`pageErrors=${pageErrors.length}: ${pageErrors[0]}`));
    if (named.length) problems.push(fail(`console=${named.length}: ${named[0]}`));
    if (badHttp.length) problems.push(fail(`http ${badHttp[0].status} ${badHttp[0].url}`));
    if (generic.length && !http4xx.length) problems.push(fail(`unattributed resource error`));

    if (m.scrollW > m.clientW) problems.push(fail(`overflow ${m.scrollW}>${m.clientW}`));
    // The dashboard's whole point is that it reads in one screen: 1440×900 is the repo's
    // desktop reference size, so anything past the fold is a regression.
    if (m.scrollH > m.clientH + 1) problems.push(fail(`page scrolls: ${m.scrollH}>${m.clientH}`));
    if (m.kpiCount === 0) problems.push(fail("no KPI cards found"));

    // 2. every KPI row spans the full content width
    if (m.kpiFill) {
      for (const [i, row] of m.kpiFill.rows.entries()) {
        if (Math.abs(row.covered - m.kpiFill.contentW) > 2) {
          problems.push(fail(`KPI row ${i + 1} covers ${row.covered}px of ${m.kpiFill.contentW}px (${row.cards} card(s)) — ragged row`));
        }
      }
      const total = m.kpiFill.rows.reduce((a, r) => a + r.cards, 0);
      if (total !== m.kpiCount) problems.push(fail(`row grouping lost cards: ${total} != ${m.kpiCount}`));
    }

    // 3. equal heights
    if (!uniform(m.kpiHeights)) problems.push(fail(`KPI heights differ: ${m.kpiHeights.join(", ")}`));
    if (!uniform(m.chartHeights)) problems.push(fail(`chart-row heights differ: ${m.chartHeights.join(", ")}`));
    if (!uniform(m.lowerHeights)) problems.push(fail(`lower-row heights differ: ${m.lowerHeights.join(", ")}`));

    // 4. equal columns
    if (!uniform(m.chartWidths)) problems.push(fail(`chart-row widths differ: ${m.chartWidths.join(", ")}`));
    if (!uniform(m.lowerWidths)) problems.push(fail(`lower-row widths differ: ${m.lowerWidths.join(", ")}`));

    // 5/6. the two things the user asked to remove
    if (m.hasQuickActions) problems.push(fail("'Quick actions' still present"));
    if (m.hasBangkok) problems.push(fail("'Asia/Bangkok' / 'GMT+7' still present"));

    // expected KPI count: 6 for admin, 5 for user
    const wantKpi = role === "admin" ? 6 : 5;
    if (m.kpiCount !== wantKpi) problems.push(fail(`KPI count ${m.kpiCount} != ${wantKpi}`));

    await page.screenshot({ path: `${OUT}/dashboard_${key}.png`, fullPage: true });
    report[key] = { ...m, problems };
    await page.close();
  }
}

// ---- 7. the custom range must reach the wire ---------------------------------------
// A picker that only changes its own label would pass any screenshot test. This drives
// the real control and asserts on the requests the page actually made.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${BASE}?role=admin&theme=light`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction("window.__DASH_HARNESS__?.ready === true", { timeout: 20000 });
  await sleep(1200);

  const seriesReqs = () =>
    page.evaluate(() =>
      window.__DASH_REQS__.filter((u) => /dashboard\/(conversations|gate-trend)\?/.test(u)),
    );

  const initialLabel = await page.evaluate(
    () => document.querySelector('button[title="Reporting window"]')?.textContent?.trim() ?? null,
  );
  const initial = await seriesReqs();

  // The label format is locale-dependent ("Sep 01, 2026" under en-US), so match on the
  // parts rather than on one hardcoded ordering.
  const showsDate = (text, iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const dayNum = String(d.getUTCDate()).padStart(2, "0");
    return (text ?? "").includes(month) && (text ?? "").includes(dayNum) && (text ?? "").includes(String(d.getUTCFullYear()));
  };

  await page.click('button[title="Reporting window"]');
  await sleep(250);
  // "Custom range" is a heading over the two boxes, not a button — opening the picker is
  // all that is needed to reveal them.
  const opened = await page.evaluate(() => {
    const picker = [...document.querySelectorAll("div")].find((d) =>
      d.textContent?.includes("Custom range") && d.querySelector('input[type="date"]'),
    );
    return {
      hasCustom: !!picker,
      heading: /Custom range/.test(picker?.textContent ?? ""),
      dateInputs: document.querySelectorAll('input[type="date"]').length,
    };
  });
  await sleep(350);

  // Choosing "Custom range" only reveals the boxes — it must not commit anything yet.
  const afterOpen = { label: await page.evaluate(() => document.querySelector('button[title="Reporting window"]')?.textContent?.trim() ?? null), reqs: (await seriesReqs()).length };

  const typeRange = (from, to) =>
    page.evaluate(
      (f, t) => {
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        const [fromEl, toEl] = document.querySelectorAll('input[type="date"]');
        set.call(fromEl, f);
        fromEl.dispatchEvent(new Event("input", { bubbles: true }));
        set.call(toEl, t);
        toEl.dispatchEvent(new Event("input", { bubbles: true }));
      },
      from,
      to,
    );

  // A backwards range must be refused rather than silently swapped.
  await typeRange("2026-10-20", "2026-10-05");
  await sleep(400);
  const backwards = await page.evaluate(() => {
    const apply = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Apply range");
    return {
      disabled: !!apply?.disabled,
      warning: /must be on or before|in the future/i.test(document.body.textContent ?? ""),
    };
  });

  // A valid range: still nothing on the wire until Apply.
  await page.evaluate(() => { window.__DASH_REQS__.length = 0; });
  await typeRange("2026-09-01", "2026-09-30");
  await sleep(500);
  const beforeApply = await seriesReqs();

  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Apply range")?.click();
  });
  await sleep(1600);

  const after = await page.evaluate(() => ({
    reqs: window.__DASH_REQS__.filter((u) => /dashboard\/(conversations|gate-trend)\?/.test(u)),
    label: document.querySelector('button[title="Reporting window"]')?.textContent?.trim() ?? null,
    footer: document.body.textContent?.match(/[A-Z][a-z]{2} \d{2}, \d{4} → [A-Z][a-z]{2} \d{2}, \d{4}/)?.[0] ?? null,
    // the fixture echoes the window it was asked for, exactly like the backend
    chartPoints: document.querySelectorAll("svg path").length,
  }));

  await page.screenshot({ path: `${OUT}/dashboard_custom_range.png`, fullPage: true });

  const problems = [];
  if (!opened.hasCustom || !opened.heading) problems.push(fail("no 'Custom range' section in the picker"));
  if (opened.dateInputs !== 2) problems.push(fail(`expected 2 date inputs, found ${opened.dateInputs}`));
  // Opening the picker is not a change of window: the label must stay put and no request
  // may be made. Both of these were real regressions caught here.
  if (afterOpen.label !== initialLabel) problems.push(fail(`opening the picker changed the label: ${afterOpen.label}`));
  if (afterOpen.reqs !== initial.length) problems.push(fail(`opening the custom picker refetched (${initial.length} -> ${afterOpen.reqs})`));
  if (!backwards.disabled) problems.push(fail("a backwards range was applicable"));
  if (!backwards.warning) problems.push(fail("no warning shown for a backwards range"));
  if (beforeApply.length !== 0) problems.push(fail(`a draft range reached the wire before Apply: ${JSON.stringify(beforeApply)}`));

  const withRange = after.reqs.filter((u) => /start=.*end=/.test(u));
  if (withRange.length === 0) problems.push(fail(`custom range never reached the wire; requests were: ${JSON.stringify(after.reqs)}`));
  if (!withRange.some((u) => u.includes("start=2026-09-01") && u.includes("end=2026-09-30"))) {
    problems.push(fail(`wrong dates on the wire: ${JSON.stringify(withRange)}`));
  }
  if (withRange.length !== 2) problems.push(fail(`expected both series endpoints to be re-requested, got ${withRange.length}`));
  if (!showsDate(after.label, "2026-09-01") || !showsDate(after.label, "2026-09-30")) {
    problems.push(fail(`button label did not follow the custom range: ${after.label}`));
  }
  if (!showsDate(after.footer, "2026-09-01") || !showsDate(after.footer, "2026-09-30")) {
    problems.push(fail(`footer did not name the reported window: ${after.footer}`));
  }
  if (!/Last 7 days/.test(initialLabel ?? "")) problems.push(fail(`default range label was ${initialLabel}`));
  if (initial.length !== 2) problems.push(fail(`initial load made ${initial.length} series requests, expected 2`));

  report.custom_range = { initialLabel, initial, opened, afterOpen, backwards, beforeApply, after, problems };
  if (problems.length) failed = true;
  await page.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (failed) {
  console.error("\nFAIL: see per-scenario `problems` above");
  process.exit(1);
}
console.log("\nOK: dashboard renders — no ragged KPI rows, equal heights, equal columns, custom range reaches the wire");
