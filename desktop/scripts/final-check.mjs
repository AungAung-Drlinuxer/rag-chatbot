// Visual check of all the key pages
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(800);
  // Log in as dev
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1200);
  console.log("after login URL:", page.url());
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/final-chat.png" });
  // Settings page
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(1500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/final-settings.png" });
  // Users page
  await page.evaluate(() => { window.location.hash = "#/users"; });
  await sleep(2000);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/final-users.png" });
  // Open a user drawer
  await page.evaluate(() => {
    const rows = document.querySelectorAll("tr");
    if (rows[1]) rows[1].click();
  });
  await sleep(1500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/final-user-drawer.png" });
  // Dashboard
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await sleep(1500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/final-dashboard.png" });
  console.log("all pages captured");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }