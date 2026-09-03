// LIVE verify 0.0.04: T1 rail expand, T2 settings conversations, T4 local time
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

  const widthOf = () => page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find(x => x.offsetParent !== null);
    return a ? Math.round(a.getBoundingClientRect().width) : null;
  });
  // T1
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /collapse sidebar/i.test(x.getAttribute("aria-label")||""))?.click(); });
  await sleep(600);
  const wc = await widthOf();
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /expand sidebar/i.test(x.getAttribute("aria-label")||""))?.click(); });
  await sleep(600);
  const we = await widthOf();
  console.log(`T1 LIVE: collapse ${wc} -> expand ${we} | works: ${we === 250}`);

  // T4
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^audit log$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(4500);
  const t4 = await page.evaluate(() => {
    const td = [...document.querySelectorAll("tbody td")][0]?.textContent?.trim();
    const nowH = new Date().getHours();
    const utcH = new Date().getUTCHours();
    const localOk = td?.includes(String(nowH).padStart(2, "0") + ":");
    return { sample: td, localOk, nowH, utcH };
  });
  console.log("T4 LIVE:", JSON.stringify(t4));

  // T2
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^settings$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(3500);
  const t2 = await page.evaluate(() => ({
    section: [...document.querySelectorAll("div")].some(x => x.textContent?.trim() === "Conversations"),
    newBtn: [...document.querySelectorAll("button")].some(b => /new conversation/i.test(b.textContent||"")),
  }));
  console.log("T2 LIVE:", JSON.stringify(t2));
  await page.screenshot({ path: "D:/ragchatbot/verify_live_0004.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
