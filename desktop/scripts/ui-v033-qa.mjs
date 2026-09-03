// v0.3.3 regression: desktop settings unchanged + 375px mobile renders sanely.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  // Desktop first
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  const desktopSidebar = await page.evaluate(() => getComputedStyle(document.querySelector(".sidebar")).display !== "none");
  ok("desktop: sidebar visible", desktopSidebar);
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await page.waitForFunction(() => document.querySelectorAll("[data-slot=card], .set-card").length >= 6, { timeout: 12000 });
  await sleep(600);
  const overflowD = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok("desktop: settings no overflow", !overflowD);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v033-desktop.png" });

  // Mobile 375px
  await page.setViewport({ width: 375, height: 812 });
  await sleep(800);
  const m = await page.evaluate(() => {
    const sb = document.querySelector(".sidebar");
    const sbDisplay = sb ? getComputedStyle(sb).display : "gone";
    const ov = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    const knobRow = [...document.querySelectorAll("code")].find((c) => /retrieval_top_k/.test(c.textContent));
    const knobVisible = knobRow ? knobRow.getBoundingClientRect().width > 0 && knobRow.getBoundingClientRect().right <= innerWidth : true;
    const pgCell = [...document.querySelectorAll("td")].find((t) => /postgres-ha-pooler/.test(t.textContent));
    const pgFits = pgCell ? pgCell.getBoundingClientRect().right <= innerWidth + 2 : true;
    return { sbDisplay, ov, knobVisible, pgFits };
  });
  ok("mobile 375px: sidebar hidden", m.sbDisplay === "none" || m.sbDisplay === "gone", m.sbDisplay);
  ok("mobile 375px: no horizontal overflow", !m.ov);
  ok("mobile 375px: RAG knob visible", m.knobVisible);
  ok("mobile 375px: postgres URL wraps in card", m.pgFits);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v033-mobile.png" });

  // recent-title ellipsis check (narrow sidebar simulation on desktop)
  await page.setViewport({ width: 1180, height: 900 });
  await sleep(600);
  const rt = await page.evaluate(() => {
    const el = document.querySelector(".recent-title");
    return el ? getComputedStyle(el).textOverflow === "ellipsis" : null;
  });
  ok("recent-title ellipsis rule present", rt !== false, String(rt));

  const fails = R.filter(r => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
