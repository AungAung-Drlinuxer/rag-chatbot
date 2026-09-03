// verify dark mode via data-theme attribute
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
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(2500);
  const initial = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-theme"),
    cls: document.documentElement.classList.contains("dark"),
  }));
  console.log("initial:", initial);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/theme-fix-1-initial.png" });
  // Click Light
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const light = btns.find((b) => b.textContent.trim() === "Light");
    if (light) light.click();
  });
  await sleep(300);
  const afterLight = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-theme"),
    cls: document.documentElement.classList.contains("dark"),
  }));
  console.log("after Light click:", afterLight);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/theme-fix-2-light.png" });
  // Click Save
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) save.click();
  });
  await sleep(3000);
  const afterSave = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-theme"),
    cls: document.documentElement.classList.contains("dark"),
  }));
  console.log("after Save:", afterSave);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/theme-fix-3-after-save.png" });
  // Click Dark
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const dark = btns.find((b) => b.textContent.trim() === "Dark");
    if (dark) dark.click();
  });
  await sleep(300);
  const afterDarkClick = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-theme"),
    cls: document.documentElement.classList.contains("dark"),
  }));
  console.log("after Dark click:", afterDarkClick);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) save.click();
  });
  await sleep(3000);
  const afterDarkSave = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-theme"),
    cls: document.documentElement.classList.contains("dark"),
  }));
  console.log("after Dark+Save:", afterDarkSave);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/theme-fix-4-dark.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }