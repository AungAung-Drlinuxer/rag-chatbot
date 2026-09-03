// Verify: status segmented control saves instantly (no Save button) + Refresh works.
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
  await page.goto("http://localhost:1420/", { waitUntil: "networkidle0" });
  await page.waitForSelector("#login-username");
  await page.type("#login-username", process.env.VERIFY_USER);
  await page.type("#login-password", process.env.VERIFY_PASS);
  await page.keyboard.press("Enter");
  await sleep(2500);
  // nav to Tickets
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(x => /^tickets$/i.test((x.textContent || "").trim())); b?.click(); });
  await sleep(4000);
  // open first ticket row
  const opened = await page.evaluate(() => {
    const idBtn = [...document.querySelectorAll("tbody tr td button")].find(b => /^ITHD-\d+/.test((b.textContent || "").trim()));
    if (!idBtn) return false; idBtn.click(); return true;
  });
  await sleep(2000);
  // assert segmented control visible WITHOUT any toggle click (always-on)
  const seg = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent || ""));
    if (!h) return { found: false };
    const btns = [...h.parentElement.querySelectorAll("button")].map(b => (b.textContent || "").trim());
    return { found: true, btns, active: h.parentElement.querySelector('[aria-pressed="true"]')?.textContent?.trim() };
  });
  console.log("segmented control:", JSON.stringify(seg));
  // pick a DIFFERENT status and confirm instant save (no Save button involved)
  const before = seg.active;
  const target = seg.btns.find(b => b && b.toLowerCase() !== (before || "").toLowerCase());
  const t0 = Date.now();
  await page.evaluate((t) => {
    const h = [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent || ""));
    const btn = [...h.parentElement.querySelectorAll("button")].find(b => (b.textContent || "").toLowerCase().includes(t));
    btn.click();
  }, target.toLowerCase().split("…")[0].split("sav")[0].trim());
  // wait for toast "Status updated"
  let toastSeen = null;
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(() => document.querySelector("[role=status]")?.textContent || null);
    if (t) { toastSeen = t; break; }
    await sleep(250);
  }
  const dt = Date.now() - t0;
  console.log(`clicked "${target}" -> toast "${toastSeen}" in ${dt}ms`);
  // confirm no "Save changes" button inside status area (it belongs to Edit form only)
  const saveInStatus = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent || ""));
    return !!h?.parentElement.querySelector("button") && [...h.parentElement.querySelectorAll("button")].some(b => /save/i.test(b.textContent || ""));
  });
  console.log("Save button inside status control (must be false):", saveInStatus);
  // Refresh button: click and watch spinner/toast
  const refresh = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(x => /^refresh/i.test((x.textContent || "").trim()));
    if (!b) return null; b.click(); return true;
  });
  await sleep(400);
  const spinning = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(x => /refreshing/i.test(x.textContent || ""));
    return b ? b.textContent.trim() : "already done";
  });
  await sleep(3000);
  const toast2 = await page.evaluate(() => document.querySelector("[role=status]")?.textContent || null);
  console.log("refresh clicked:", refresh, "| during:", spinning, "| toast:", toast2);
  await page.screenshot({ path: "D:/ragchatbot/verify_tickets_status.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
