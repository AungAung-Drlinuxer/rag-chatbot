import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(600);
  await page.type('input[type="text"]', "dev", { delay: 15 });
  await page.type('input[type="password"]', "dev", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1400);
  // go to settings and switch to dark + save
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(1800);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const dark = btns.find((b) => b.textContent.trim() === "Dark");
    if (dark) dark.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.includes("Save changes"));
    if (save) save.click();
  });
  await sleep(1500);
  const afterSave = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log("after save:", afterSave);
  // navigate to Dashboard (different page) then hard-reload
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await sleep(1200);
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(2500);
  const afterReload = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log("after reload on dashboard:", afterReload);
  // navigate to another page and reload again
  await page.evaluate(() => { window.location.hash = "#/chat"; });
  await sleep(1000);
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(2500);
  const afterChatReload = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log("after reload on chat:", afterChatReload);
  console.log(afterSave === "dark" && afterReload === "dark" && afterChatReload === "dark" ? "THEME STICKY ✓" : "THEME STILL RESETTING ✗");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }