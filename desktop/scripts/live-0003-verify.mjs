// LIVE E2E for 0.0.03: bell + bento + sorting on production
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#login-username");
  await page.type("#login-username", process.env.VERIFY_USER);
  await page.type("#login-password", process.env.VERIFY_PASS);
  await page.keyboard.press("Enter");
  await sleep(4000);
  // ChatPage bell
  const bell1 = await page.evaluate(() => !!document.querySelector(".lucide-bell")?.closest("button"));
  // Dashboard bell + bento
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^dashboard$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(4000);
  const r = await page.evaluate(() => {
    const bell = document.querySelector(".lucide-bell")?.closest("button");
    const hero = document.querySelector(".md\\:col-span-2 .text-3xl")?.textContent?.trim();
    return { sidebarBell: !!bell, aria: bell?.getAttribute("aria-label"), hero };
  });
  console.log("LIVE ChatPage bell:", bell1, "| Sidebar bell:", JSON.stringify(r));
  // sorting live
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^tickets$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(6000);
  const before = await page.evaluate(() => document.querySelector("tbody tr td button")?.textContent?.trim());
  await page.evaluate(() => {
    const th = [...document.querySelectorAll("th")].find(x => /updated/i.test(x.textContent||""));
    th?.querySelector("button")?.click();
  });
  await sleep(1200);
  const after = await page.evaluate(() => document.querySelector("tbody tr td button")?.textContent?.trim());
  console.log(`LIVE sort Updated: ${before} -> ${after} | changed: ${before !== after}`);
  await page.screenshot({ path: "D:/ragchatbot/verify_live_0003.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
