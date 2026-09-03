// verify dark mode after v0.21.18 deployment
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
  await sleep(800);
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(2500);
  const initialDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("initial dark:", initialDark);
  // Click Light
  const r1 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const light = btns.find((b) => b.textContent.trim() === "Light");
    if (light) { light.click(); return "clicked Light"; }
    return "not found";
  });
  console.log("step 1:", r1);
  await sleep(400);
  const afterLight = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after Light click (no save):", afterLight);
  // Click Save
  const r2 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) { save.click(); return "clicked save"; }
    return "not found";
  });
  console.log("step 2:", r2);
  await sleep(3000);
  const afterSave = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after Save (should be false):", afterSave);
  // Now click Dark
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const dark = btns.find((b) => b.textContent.trim() === "Dark");
    if (dark) dark.click();
  });
  await sleep(400);
  const afterDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after Dark click:", afterDark);
  // Save
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) save.click();
  });
  await sleep(3000);
  const afterDarkSave = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after Dark save (should be true):", afterDarkSave);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/theme-verified.png" });
  console.log("done");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }