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
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(1500);
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("button, a, [role=button]"));
    const integ = items.find((b) => b.textContent.trim().startsWith("Integrations"));
    if (integ) integ.click();
  });
  await sleep(1500);
  // click Confluence tab
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find((b) => b.textContent.trim() === "Confluence");
    if (btns.includes(b)) b.click();
  });
  await sleep(1500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/integrations-confluence.png" });
  // click Jira tab
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const j = btns.find((b) => b.textContent.trim() === "Jira");
    if (j) j.click();
  });
  await sleep(1200);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/jira-tab.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }