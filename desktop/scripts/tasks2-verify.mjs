// Verify all 4 fixes: rail spacing, alert emails padding, no Conversations in settings, tone match
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
  await sleep(3500);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^dashboard$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(3000);

  // T1: rail width + spacing between toggle and bell
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /collapse sidebar/i.test(x.getAttribute("aria-label")||""))?.click(); });
  await sleep(600);
  const rail = await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find(x => x.offsetParent !== null);
    const w = Math.round(a.getBoundingClientRect().width);
    const btns = [...a.querySelectorAll("button")].filter(b => /sidebar|notification/i.test(b.getAttribute("aria-label")||"")).map(b => Math.round(b.getBoundingClientRect().top));
    return { w, toggleTop: btns[0], bellTop: btns[1] };
  });
  console.log("T1 rail:", JSON.stringify(rail), "| toggle-bell gap:", rail.bellTop - rail.toggleTop, "px");
  // expand back to confirm reachable
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /expand sidebar/i.test(x.getAttribute("aria-label")||""))?.click(); });
  await sleep(500);
  const expanded = await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find(x => x.offsetParent !== null);
    return Math.round(a.getBoundingClientRect().width);
  });
  console.log("T1 expand reachable ->", expanded + "px :", expanded === 250);

  // T3 + T4: settings page
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^settings$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(3000);
  const s = await page.evaluate(() => {
    const removed = ![...document.querySelectorAll("div")].some(x => x.textContent?.trim() === "Conversations" && /chat history/.test(x.parentElement?.textContent || ""));
    const alertRow = [...document.querySelectorAll("p")].find(p => /Escalation awaiting approval/i.test(p.textContent||""));
    const row = alertRow?.closest("div.flex");
    const style = row ? getComputedStyle(row) : null;
    const card = document.querySelector("section.rounded-2xl");
    const cardBg = card ? getComputedStyle(card).backgroundColor : null;
    return { conversationsSectionGone: removed, alertRowPadding: style ? style.paddingTop + "/" + style.paddingBottom : null, cardBg };
  });
  console.log("T3/T4:", JSON.stringify(s));
  await page.screenshot({ path: "D:/ragchatbot/verify_tasks2.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
