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
  await sleep(2000);
  // click Integrations section
  const clicked = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("button, a, [role=button], div[class*=cursor]"));
    const integ = items.find((b) => b.textContent.trim() === "Integrations" || b.textContent.includes("External services"));
    if (integ) { integ.click(); return "clicked"; }
    return "not found";
  });
  console.log("Integrations section:", clicked);
  await sleep(2000);
  const tabs = await page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim());
    return texts.filter((t) => ["Email / SMTP","Ticketing","XWiki","OpenProject","SSO / LDAP","Other Services"].includes(t));
  });
  console.log("tabs visible:", JSON.stringify(tabs));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/integrations-tabs.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }