// QA: all pages full-view + nav works + mobile drawer
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 150)));

  // Desktop pass
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle2", timeout: 30000 });
  await page.type("#login-username", "dev");
  await page.type("#login-password", "dev");
  await sleep(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /sign in/i.test(x.textContent)); b && b.click(); });
  await sleep(2500);

  const pages = ["Dashboard", "Knowledge", "Tickets", "Users", "Settings"];
  for (const name of pages) {
    await page.evaluate((n) => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => x.textContent.trim() === n);
      if (b) b.click();
    }, name);
    await sleep(1500);
    const ok = await page.evaluate((n) => document.body.innerText.includes(n), name);
    console.log(`${name}: ${ok ? "✓" : "✗"} renders`);
  }

  // sidebar icons visible?
  const icons = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    return aside ? aside.querySelectorAll("svg").length : 0;
  });
  console.log("sidebar svg icons:", icons);

  // Mobile pass — drawer + full view
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(800);
  // go to Dashboard first (mobile)
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => x.textContent.trim() === "Dashboard");
    if (b) b.click();
  });
  await sleep(1500);
  const mobileBar = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => d.className && String(d.className).includes("lg:hidden") && d.querySelector("button"));
    return !!el;
  });
  console.log("mobile topbar visible:", mobileBar);
  await page.evaluate(() => {
    const btn = document.querySelector("button[aria-label='Open navigation']");
    btn && btn.click();
  });
  await sleep(800);
  const drawerOpen = await page.evaluate(() => document.body.innerText.includes("Back to Chat"));
  console.log("mobile drawer opens:", drawerOpen);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/rwd-mobile.png" });
  console.log("ERRORS:", errors.slice(0, 4));
} catch (e) {
  console.log("FAIL", e.message);
} finally {
  await browser.close();
}