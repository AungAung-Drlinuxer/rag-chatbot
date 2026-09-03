// v0.5.3 QA: header consistency, flat inputs, uniform gutters on 3 pages.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });

  // Settings: no Back button, flat inputs
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1500);
  const sHasBack = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /back to chat/i.test(b.textContent)));
  ok("Settings: no 'Back to chat' button", !sHasBack);
  const flatInput = await page.evaluate(() => {
    const inp = [...document.querySelectorAll('[data-slot="card"] input')].find((i) => i.value === "dev" || /admin|dev/.test(i.value));
    if (!inp) return null;
    const cs = getComputedStyle(inp);
    return { bg: cs.backgroundColor, borderLeft: cs.borderLeftWidth };
  });
  ok("Settings inputs flat (no grey bg)", flatInput && (flatInput.bg === "rgba(0, 0, 0, 0)" || flatInput.bg.includes("0, 0, 0, 0")), JSON.stringify(flatInput));
  const gutS = await page.evaluate(() => { const p = document.querySelector(".page"); return getComputedStyle(p).paddingLeft; });
  ok("gutter 16px (settings)", gutS === "16px");
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v053-settings.png" });

  // Knowledge
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /knowledge/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1600);
  const kbHero = await page.evaluate(() => {
    const el = document.querySelector(".kb-page form input");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, blw: cs.borderLeftWidth };
  });
  ok("Knowledge hero input flat", kbHero && kbHero.bg === "rgba(0, 0, 0, 0)" && kbHero.blw === "1px", JSON.stringify(kbHero)); // transparent + hairline kept but no boxy sides? check bl
  const gutK = await page.evaluate(() => { const p = document.querySelector(".page"); return getComputedStyle(p).paddingLeft; });
  ok("gutter 16px (knowledge)", gutK === "16px");
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v053-knowledge.png" });

  // Escalations unchanged sanity + gutter
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /escalations/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1200);
  const gutE = await page.evaluate(() => { const p = document.querySelector(".page"); return getComputedStyle(p).paddingLeft; });
  ok("Escalations still 16px (reference)", gutE === "16px");

  // Select trigger flatness in settings
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1300);
  const trig = await page.evaluate(() => {
    const t = document.querySelector('[data-slot="select-trigger"]');
    if (!t) return null;
    const cs = getComputedStyle(t);
    return { bg: cs.backgroundColor, sh: cs.boxShadow === "none" };
  });
  ok("Select trigger flat (no fill/shadow)", trig && trig.bg === "rgba(0, 0, 0, 0)" && trig.sh, JSON.stringify(trig));

  const fails = R.filter((r) => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
