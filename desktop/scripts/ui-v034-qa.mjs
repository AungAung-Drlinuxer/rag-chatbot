// v0.3.4 QA: lucide nav icons, feedback icon buttons, Manage-KB collapsible, context height, settings frames.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });

  // 1) Nav icons are real SVGs (lucide), not emoji
  const navSvg = await page.evaluate(() => [...document.querySelectorAll(".navitem .ico svg")].length);
  ok("nav uses lucide SVG icons (4)", navSvg === 4, `${navSvg} svgs`);

  // 2) Context panel no longer forces page scroll
  const ctx = await page.evaluate(() => {
    const c = document.querySelector(".context");
    if (!c) return null;
    return { h: c.scrollHeight, vh: innerHeight };
  });
  ok("context panel fits viewport (Manage KB collapsed)", ctx && ctx.h <= ctx.vh + 2, `h=${ctx?.h} vh=${ctx?.vh}`);

  // 3) Manage KB toggle exists and collapses/expands
  const mk = await page.$(".mk-head");
  ok("Manage KB header exists", !!mk);
  if (mk) {
    const before = await page.evaluate(() => !!document.querySelector(".manage-kb form"));
    await mk.click(); await sleep(400);
    const after = await page.evaluate(() => !!document.querySelector(".manage-kb form"));
    ok("Manage KB expands on click", !before && after);
    await mk.click(); await sleep(300);
  }

  // 4) Feedback buttons (need a message): ask, wait for done, check icons inside buttons
  await page.type('textarea[placeholder^="Ask about"]', "VPN problem");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let answered = false;
  for (let i = 0; i < 25; i++) {
    answered = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".fb-inline button.btn.helpful")].pop();
      return b && !b.disabled;
    });
    if (answered) break;
    await sleep(1500);
  }
  if (answered) {
    const icons = await page.evaluate(() => {
      const pick = (sel) => ([...document.querySelectorAll(sel)].pop() || {});
      return {
        helpful: !!pick("button.btn.helpful svg"),
        unhelpful: !!pick("button.btn.unhelpful svg"),
        esc: !!pick("button.btn.esc svg"),
      };
    });
    ok("feedback buttons have SVG icons", icons.helpful && icons.unhelpful && icons.esc, JSON.stringify(icons));
  } else ok("feedback reachable (answer stream)", false, "stream timed out — check backend");

  // 5) Settings page frames cleaner (no nested card border)
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await page.waitForFunction(() => document.querySelectorAll("[data-slot=card], .set-card").length >= 6, { timeout: 12000 });
  await sleep(500);
  const frames = await page.evaluate(() => {
    const card = document.querySelector("[data-slot=card]");
    if (!card) return null;
    const cs = getComputedStyle(card);
    return { border: cs.borderTopWidth, bg: cs.backgroundColor, shadow: cs.boxShadow };
  });
  ok("settings card single-frame clean style", frames && frames.border === "1px" && frames.bg.includes("255"), JSON.stringify(frames));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v034-settings.png" });

  const fails = R.filter(r => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
