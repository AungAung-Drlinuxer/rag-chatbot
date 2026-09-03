// Verify B-6 bell, B-7 bento hero, B-9 sorting on the built bundle
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
  await sleep(4000);

  // B-6: bell visible in sidebar head for admin
  const bell = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(x => /notification/i.test(x.getAttribute("aria-label") || "") || x.getAttribute("aria-label") === "Notifications");
    return { present: !!b, label: b?.getAttribute("aria-label") };
  });
  console.log("B-6 bell:", JSON.stringify(bell));

  // B-7: bento hero on dashboard
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^dashboard$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(3000);
  const hero = await page.evaluate(() => {
    const heroCard = document.querySelector(".md\\:col-span-2");
    if (!heroCard) return { found: false };
    const val = heroCard.querySelector(".text-3xl")?.textContent?.trim();
    return { found: true, heroValue: val, title: heroCard.querySelector(".text-xs")?.textContent?.trim() };
  });
  console.log("B-7 bento hero:", JSON.stringify(hero));

  // B-9: sorting on tickets
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x => /^tickets$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(4500);
  const firstIdBefore = await page.evaluate(() => document.querySelector("tbody tr td button, tbody tr td")?.textContent?.trim());
  await page.evaluate(() => {
    const th = [...document.querySelectorAll("th")].find(x => /updated/i.test(x.textContent||""));
    th?.querySelector("button")?.click();
  });
  await sleep(900);
  const firstIdAfter = await page.evaluate(() => document.querySelector("tbody tr td button, tbody tr td")?.textContent?.trim());
  await page.evaluate(() => {
    const th = [...document.querySelectorAll("th")].find(x => /updated/i.test(x.textContent||""));
    th?.querySelector("button")?.click();
  });
  await sleep(900);
  const firstIdAsc = await page.evaluate(() => document.querySelector("tbody tr td button, tbody tr td")?.textContent?.trim());
  const sortedWorks = firstIdBefore !== firstIdAfter || firstIdAfter !== firstIdAsc;
  console.log(`B-9 sort by Updated: ${firstIdBefore} -> desc:${firstIdAfter} -> asc:${firstIdAsc} | works: ${sortedWorks}`);
  await page.screenshot({ path: "D:/ragchatbot/verify_b679.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
