// Tickets page QA — find why nothing renders
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
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 300)));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#login-username", "dev");
  await page.type("#login-password", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 20000 });
  const clicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".navitem")];
    const t = items.find((x) => /tickets/i.test(x.textContent));
    if (t) { t.click(); return t.textContent.trim(); }
    return null;
  });
  console.log("clicked:", clicked);
  await sleep(2500);
  const info = await page.evaluate(() => {
    const section = document.querySelector('[data-nav="tickets"]');
    return {
      sectionExists: !!section,
      htmlLen: section ? section.innerHTML.length : 0,
      visibleText: section ? section.innerText.slice(0, 200) : "(none)",
    };
  });
  console.log(JSON.stringify(info, null, 1));
  console.log("ERRORS:", errors.slice(0, 6));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/tickets-qa.png" });
} catch (e) {
  console.log("FAIL", e.message);
} finally {
  await browser.close();
}