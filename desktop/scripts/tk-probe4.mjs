// Rerun the status-save test against the LIVE build (preview with LIVE API base)
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
const reqs = [];
page.on("request", r => { if (r.url().includes("/api/tickets") && r.method() === "PUT") reqs.push(r.url()); });
await page.setViewport({ width: 1500, height: 950 });
await page.goto("http://localhost:1420/", { waitUntil: "networkidle0" });
await page.waitForSelector("#login-username");
await page.type("#login-username", process.env.VERIFY_USER);
await page.type("#login-password", process.env.VERIFY_PASS);
await page.keyboard.press("Enter");
await sleep(3000);
await page.evaluate(() => { [...document.querySelectorAll("button")].find(x=>/^tickets$/i.test((x.textContent||"").trim()))?.click(); });
await sleep(4500);
await page.evaluate(() => { [...document.querySelectorAll("tbody tr td button")].find(b => /^ITHD-\d+/.test((b.textContent||"").trim()))?.click(); });
await sleep(2000);
const res = await page.evaluate(async () => {
  const h = [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent||""));
  const btns = [...h.parentElement.querySelectorAll("button")];
  const active = btns.find(b => b.getAttribute("aria-pressed") === "true");
  const target = btns.find(b => b !== active);
  const before = active.textContent.trim();
  const t = target.textContent.trim();
  target.click();
  // wait toast
  let toast = null;
  for (let i = 0; i < 40; i++) {
    const t2 = document.querySelector("[role=status]")?.textContent || null;
    if (t2) break;
    await new Promise(r2 => setTimeout(r2, 250));
  }
  const nowActive = [...h.parentElement.querySelectorAll("button")].find(b => b.getAttribute("aria-pressed") === "true")?.textContent.trim();
  return { clicked: t, now: nowActive(now), toast: document.querySelector("[role=status]")?.textContent };
  function nowActive(){ return null; }
}).catch(e => ({ err: String(e).slice(0,120) }));
console.log("click result:", JSON.stringify(res));
console.log("PUT requests seen:", reqs.length ? reqs : "none");
await sleep(1500);
const after = await page.evaluate(() => [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent||""))?.parentElement.querySelector('[aria-pressed="true"]')?.textContent.trim());
console.log("segment after:", after);
await browser.close();
