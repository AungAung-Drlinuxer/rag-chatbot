// v0.4.0 Knowledge tab QA: header badge, domain cards, recent list, manage table + sync health.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /knowledge/i.test(e.textContent)); if (n) n.click(); });
  await page.waitForFunction(() => !!document.querySelector(".kb-page"), { timeout: 10000 });
  await sleep(1500);

  ok("header title", (await page.evaluate(() => document.querySelector(".kb-page h2")?.textContent || "")).includes("IT Help Knowledge Base"));
  const badge = await page.evaluate(() => document.querySelector(".kb-page")?.textContent?.includes("Synced") || false);
  ok("sync health badge", badge);
  const cards = await page.evaluate(() => [...document.querySelectorAll(".kb-page .grid > button")].length);
  ok("domain cards render", cards >= 2, `${cards} cards`);
  const recentN = await page.evaluate(() => [...document.querySelectorAll(".kb-page ul.divide-y > li")].length);
  ok("recent list rows", recentN >= 2, `${recentN} rows`);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v040-knowledge-top.png" });

  // expand manage
  const manageBtn = await page.evaluate(() => { const b = [...document.querySelectorAll(".kb-page button")].find((x) => /Manage/i.test(x.textContent)); if (b) b.click(); return !!b; });
  await sleep(900);
  const table = await page.evaluate(() => !!document.querySelector(".kb-page table"));
  ok("manage expands with article table", manageBtn && table);
  const healthTiles = await page.evaluate(() => [...document.querySelectorAll(".kb-page .grid.grid-cols-2 > div")].length);
  ok("sync health tiles", healthTiles >= 5, `${healthTiles} tiles`);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v040-knowledge-manage.png", fullPage: true });

  // mobile sanity
  await page.setViewport({ width: 375, height: 812 });
  await sleep(700);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  ok("mobile 375px no overflow", !ov);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v040-knowledge-mobile.png" });

  const fails = R.filter(r => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
