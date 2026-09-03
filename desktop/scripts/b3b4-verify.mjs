// Verify B-3/B-4: sidebar collapse (button + Ctrl+B, persisted) + global Cmd+K palette.
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
  await sleep(3000);
  // go to a sidebar page
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^dashboard$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(2500);

  const widthOf = () => page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find(x => x.offsetParent !== null);
    return a ? Math.round(a.getBoundingClientRect().width) : null;
  });
  const w1 = await widthOf();

  // collapse via button
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /collapse sidebar/i.test(x.getAttribute("aria-label") || ""))?.click(); });
  await sleep(700);
  const w2 = await widthOf();
  const persisted = await page.evaluate(() => localStorage.getItem("ith.sidebar"));
  console.log(`sidebar: ${w1}px -> ${w2}px | persisted: ${persisted}`);

  // toggle back via Ctrl+B
  await page.keyboard.down("Control"); await page.keyboard.press("b"); await page.keyboard.up("Control");
  await sleep(700);
  const w3 = await widthOf();
  console.log(`after Ctrl+B: ${w2}px -> ${w3}px`);

  // Cmd/Ctrl+K palette (global — works from Dashboard too)
  await page.keyboard.down("Control"); await page.keyboard.press("k"); await page.keyboard.up("Control");
  await sleep(800);
  const pal = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder*="Search pages"]');
    return { open: !!inp, placeholder: inp?.placeholder };
  });
  console.log("palette via Ctrl+K on Dashboard:", JSON.stringify(pal));
  await page.type('input[placeholder*="Search pages"]', "tick");
  await sleep(600);
  const rows = await page.evaluate(() => [...document.querySelectorAll('[class*="z-[100]"] button, div.fixed button')].map(b => (b.textContent||"").trim()).filter(t => /ticket/i.test(t)).slice(0, 4));
  console.log("palette results for 'tick':", JSON.stringify(rows));
  await page.keyboard.press("Enter");
  await sleep(2000);
  const onTickets = await page.evaluate(() => /Total tickets|ITHD-|Ticket/i.test(document.body.innerText));
  console.log("navigated to Tickets via palette:", onTickets);

  // open a conversation from palette (search + Enter)
  await page.keyboard.down("Control"); await page.keyboard.press("k"); await page.keyboard.up("Control");
  await sleep(700);
  await page.keyboard.down("Control"); await page.keyboard.press("k"); await page.keyboard.up("Control"); // close
  await sleep(500);
  await page.screenshot({ path: "D:/ragchatbot/verify_b3b4.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
