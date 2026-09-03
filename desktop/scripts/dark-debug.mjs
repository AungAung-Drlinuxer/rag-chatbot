// verify dark mode toggle end-to-end
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
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE ERR:", m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(600);
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
  console.log("initial dark class:", initialDark);
  // Click LIGHT to switch to light mode
  const click = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const light = btns.find((b) => b.textContent.trim() === "Light");
    if (light) { light.click(); return "clicked Light"; }
    return "not found; buttons: " + btns.map((b) => b.textContent.trim().slice(0, 30)).join("|");
  });
  console.log("light click:", click);
  await sleep(400);
  const afterLightClick = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after light click (should be false):", afterLightClick);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/dark-step1-light.png" });
  // Click Save
  const saveClick = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) { save.click(); return "clicked save"; }
    return "not found";
  });
  console.log("save:", saveClick);
  await sleep(2500);
  const afterSave = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after save (should be false if saved):", afterSave);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/dark-step2-after-save.png" });
  // Check the actual <html> attributes
  const htmlInfo = await page.evaluate(() => ({
    darkClass: document.documentElement.classList.contains("dark"),
    dataCompact: document.documentElement.dataset.compact,
    bodyClass: document.body.className,
    title: document.title,
  }));
  console.log("html info:", JSON.stringify(htmlInfo));
  // Now click Dark again and Save
  const click2 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const dark = btns.find((b) => b.textContent.trim() === "Dark");
    if (dark) { dark.click(); return "clicked Dark"; }
    return "not found";
  });
  console.log("dark click again:", click2);
  await sleep(400);
  const afterDarkClick = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after dark click (should be true):", afterDarkClick);
  // Save
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) save.click();
  });
  await sleep(2500);
  const afterDarkSave = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after dark save (should be true):", afterDarkSave);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/dark-step3-dark-saved.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }