// LIVE verify 0.0.05: rail spacing, alert rows, no conversations section, tone
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

  // T1
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /collapse sidebar/i.test(x.getAttribute("aria-label")||""))?.click(); });
  await sleep(600);
  const rail = await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find(x => x.offsetParent !== null);
    const w = Math.round(a.getBoundingClientRect().width);
    const btns = [...a.querySelectorAll("button")].filter(b => /sidebar|notification/i.test(b.getAttribute("aria-label")||"")).map(b => Math.round(b.getBoundingClientRect().top));
    return { w, gap: btns.length >= 2 ? btns[1] - btns[0] : null };
  });
  console.log("T1 LIVE rail:", JSON.stringify(rail));
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /expand sidebar/i.test(x.getAttribute("aria-label")||""))?.click(); });
  await sleep(500);
  const expanded = await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find(x => x.offsetParent !== null);
    return Math.round(a.getBoundingClientRect().width);
  });
  console.log("T1 expand ->", expanded, "| works:", expanded === 250);

  // T2 + T3 + T4 on settings
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^settings$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(3500);
  const r = await page.evaluate(() => {
    const alertRow = [...document.querySelectorAll("p")].find(p => /Escalation awaiting approval/i.test(p.textContent||""));
    const row = alertRow?.closest("div.flex");
    const style = row ? getComputedStyle(row) : null;
    const convGone = ![...document.querySelectorAll("div")].some(x => x.textContent?.trim() === "Conversations" && /chat history/.test(x.parentElement?.textContent || ""));
    const card = [...document.querySelectorAll("section")].find(x => /Basic application settings|Alert emails|SMTP|Mail/i.test(x.textContent||""));
    return {
      alertRowPad: style ? style.paddingTop + "/" + style.paddingBottom : null,
      conversationsGone: convGone,
      cardBg: card ? getComputedStyle(card).backgroundColor : null,
    };
  });
  console.log("T2/T3/T4 LIVE:", JSON.stringify(r));
  await page.screenshot({ path: "D:/ragchatbot/verify_live_0005.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
