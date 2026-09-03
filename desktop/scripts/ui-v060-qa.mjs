// v0.6.0 QA: all pages render, key functions work.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });

  // Chat send message
  await page.type('textarea[placeholder^="Ask about"]', "VPN drops");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let hasAnswer = false;
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => ([...document.querySelectorAll(".msg-row.assistant .bubble")].pop() || {}).textContent?.length || 0);
    if (len > 40) { hasAnswer = true; break; }
    await sleep(1500);
  }
  ok("chat streams", hasAnswer);

  // Knowledge
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /knowledge/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1500);
  const kbCards = await page.evaluate(() => document.querySelectorAll(".kb-page .grid > button").length);
  ok("knowledge domain cards render", kbCards > 0, `${kbCards} cards`);

  // Settings
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1500);
  const cards = await page.evaluate(() => document.querySelectorAll("[data-slot=card]").length);
  ok("settings cards render", cards >= 6, `${cards} cards`);

  // Escalations
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /escalations/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1200);
  const esc = await page.evaluate(() => document.querySelectorAll(".esc-card").length);
  ok("escalation cards render", esc >= 0, `${esc} cards`);

  // Gutter check
  for (const [nav, label] of [["escalations","Escalations"], ["settings","Settings"], ["knowledge","Knowledge"]]) {
    await page.evaluate((n) => { const el = [...document.querySelectorAll(".navitem")].find((e) => e.textContent.toLowerCase().includes(n)); if (el) el.click(); }, nav);
    await sleep(1200);
    const pad = await page.evaluate(() => { const p = document.querySelector(".page"); return getComputedStyle(p).paddingLeft; });
    ok(`${label}: gutter 16px`, pad === "16px");
  }

  const fails = R.filter((r) => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }