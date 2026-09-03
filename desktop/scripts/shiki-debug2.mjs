// Minimal shiki check: what do the <pre> elements look like after streaming?
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://127.0.0.1:4173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar");
  await page.type('textarea[placeholder^="Ask about"]', "How do I check PostgreSQL connections with SQL? show the query");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let info = null;
  for (let i = 0; i < 30; i++) {
    info = await page.evaluate(() => {
      const pres = [...document.querySelectorAll(".md pre")];
      return {
        pres: pres.length,
        shiki: pres.filter(p => p.classList.contains("shiki")).length,
        wrapped: document.querySelectorAll(".shiki-block").length,
        colored: pres.filter(p => p.querySelector("span[style*='color']")).length,
        len: (document.querySelector(".msg.assistant .bubble") || {}).textContent?.length || 0,
      };
    });
    if (info.len > 80 && info.pres > 0) break;
    await sleep(2000);
  }
  console.log(JSON.stringify(info));
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
