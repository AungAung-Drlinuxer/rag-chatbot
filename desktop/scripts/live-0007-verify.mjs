// LIVE verify 0.0.07: KPI cards all in ONE row (4 equal cards, desktop)
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#login-username");
  await page.type("#login-username", process.env.VERIFY_USER);
  await page.type("#login-password", process.env.VERIFY_PASS);
  await page.keyboard.press("Enter");
  await sleep(4000);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^dashboard$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(3500);
  const r = await page.evaluate(() => {
    // the KPI section is the first grid with 4 cards
    const sec = [...document.querySelectorAll("section")].find(x => /Total Conversations/.test(x.textContent||""));
    if (!sec) return { found: false };
    const cards = [...sec.querySelectorAll(":scope > div, :scope > .relative")].filter(c => /Total Conversations|Resolved by Bot|Escalated to Tickets|Active Users/.test(c.textContent||""));
    const tops = cards.map(c => Math.round(c.getBoundingClientRect().top));
    const sameRow = tops.length === 4 && new Set(tops).size === 1;
    const widths = cards.map(c => Math.round(c.getBoundingClientRect().width));
    return { found: true, cards: cards.length, sameRow, tops, widths };
  });
  console.log("KPI row:", JSON.stringify(r));
  await page.screenshot({ path: "D:/ragchatbot/verify_live_0007.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
