// Verify all 4 tasks on the built bundle
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

  // go to a PageSidebar page
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^dashboard$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(3000);

  // ── Task-1: collapse then expand ──
  const widthOf = () => page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find(x => x.offsetParent !== null);
    return a ? Math.round(a.getBoundingClientRect().width) : null;
  });
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /collapse sidebar/i.test(x.getAttribute("aria-label")||""))?.click(); });
  await sleep(600);
  const wCollapsed = await widthOf();
  // expand via visible button in rail (Task-1 fix)
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /expand sidebar/i.test(x.getAttribute("aria-label")||""))?.click(); });
  await sleep(600);
  const wExpanded = await widthOf();
  console.log(`T1: collapse ${wCollapsed}px -> expand via rail button ${wExpanded}px | expand works: ${wExpanded === 250}`);

  // ── Task-4: audits time shows local (not UTC) ──
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^audit log$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(4000);
  const t4 = await page.evaluate(() => {
    const tds = [...document.querySelectorAll("tbody td")].slice(0, 3).map(td => (td.textContent||"").trim());
    return { sample: tds[0], all: tds };
  });
  console.log("T4: first audit TIME:", t4.sample, "| local-expected ≈ hour", new Date().getHours());
  const isUTC = t4.sample && t4.sample.includes(String(new Date().getUTCHours()).padStart(2,"0") + ":") && !t4.sample.includes(String(new Date().getHours()).padStart(2,"0") + ":");
  console.log("T4: shows UTC (must be false):", !!isUTC);

  // ── Task-2: Settings conversations section ──
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^settings$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(3500);
  const t2 = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h1,h2,h3,div")].find(x => x.textContent?.trim() === "Conversations");
    const newBtn = [...document.querySelectorAll("button")].find(b => /new conversation/i.test(b.textContent||""));
    const search = [...document.querySelectorAll("input")].find(i => /search conversations/i.test(i.placeholder||""));
    return { section: !!h, newBtn: !!newBtn, search: !!search };
  });
  console.log("T2: Settings Conversations section:", JSON.stringify(t2));
  await page.screenshot({ path: "D:/ragchatbot/verify_tasks.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
