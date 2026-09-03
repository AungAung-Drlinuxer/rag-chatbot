// v0.4.1 soft-panel visual capture (Knowledge page).
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /knowledge/i.test(e.textContent)); if (n) n.click(); });
  await sleep(2200);
  const m = await page.evaluate(() => {
    const el = document.querySelector(".kb-page .grid > button");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const card = document.querySelector('.kb-page [data-slot="card"]');
    return { cardBorder: cs.borderTopColor, cardShadowParts: cs.boxShadow.split("),").length, sectionCardBorder: card ? getComputedStyle(card).borderTopColor : null };
  });
  console.log(JSON.stringify(m));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v041-soft-knowledge.png" });
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
