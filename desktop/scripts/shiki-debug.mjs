// Direct check: does the mock/dev answer produce a code block, and does shiki render it?
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://127.0.0.1:4173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERR:", String(e).slice(0, 200)));
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar");
  // Inject a message containing a fenced sql block directly into state via new chat:
  // Simpler: ask and inspect whatever pre exists after streaming completes.
  await page.type('textarea[placeholder^="Ask about"]', "How do I check PostgreSQL connections with SQL? show the query");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  for (let i = 0; i < 25; i++) {
    const st = await page.evaluate(() => ({
      pres: document.querySelectorAll(".md pre").length,
      shiki: document.querySelectorAll(".md pre.shiki, .shiki-block").length,
      plain: [...document.querySelectorAll(".md pre code")].filter(c => c.textContent.includes("SELECT") || c.textContent.includes("select")).length,
      text: (document.querySelector(".msg.assistant .bubble") || {}).textContent?.length || 0,
    }));
    if (st.text > 80 && (st.shiki > 0 || st.plain > 0)) {
      console.log(`pres=${st.pres} shikiBlocks=${st.shiki} selectCodePlain=${st.plain} len=${st.text}`);
      if (st.pres > 0) {
        const html = await page.evaluate(() => { const p = document.querySelector(".md pre"); return { cls: p.className, childSpan: !!p.querySelector("span[style*='color']"), sample: p.innerHTML.slice(0, 120); }; }).catch(e=>({err:String(e)}));
        console.log("first pre:", JSON.stringify(html).slice(0, 300));
      }
      break;
    }
    await sleep(2000);
  }
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
