// LIVE verify 0.0.06: Customize modal, hide panel, persistence on production
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

  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /customize/i.test(x.textContent||""))?.click(); });
  await sleep(800);
  const modal = await page.evaluate(() => !![...document.querySelectorAll("h2")].find(x => /customize dashboard/i.test(x.textContent||"")));
  console.log("LIVE modal open:", modal);

  await page.evaluate(() => {
    const row = [...document.querySelectorAll("div")].find(d => d.querySelector("span")?.textContent?.trim() === "Escalation rate" && d.querySelector("button"));
    [...row.querySelectorAll("button")].find(b => (b.getAttribute("aria-label")||"") === "Hide panel")?.click();
  });
  await sleep(400);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^done$/i.test(x.textContent||""))?.click(); });
  await sleep(900);
  const hidden = await page.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find(x => /Escalation rate/.test(x.textContent||""));
    return sec ? getComputedStyle(sec).display === "none" : true;
  });
  const persisted = await page.evaluate(() => (localStorage.getItem("ith.dash.layout")||"").includes("escalation"));
  console.log("LIVE hide Escalation rate -> display:none:", hidden, "| persisted:", !!persisted);

  // reset
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /customize/i.test(x.textContent||""))?.click(); });
  await sleep(500);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /reset to default/i.test(x.textContent||""))?.click(); });
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^done$/i.test(x.textContent||""))?.click(); });
  await sleep(900);
  const back = await page.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find(x => /Escalation rate/.test(x.textContent||""));
    return sec ? getComputedStyle(sec).display !== "none" : false;
  });
  console.log("LIVE reset -> Escalation rate visible again:", back);
  await page.screenshot({ path: "D:/ragchatbot/verify_live_0006.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
