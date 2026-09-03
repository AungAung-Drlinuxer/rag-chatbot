// Visual QA: all pages standardized layout
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle2", timeout: 30000 });
  await page.type("#login-username", "dev");
  await page.type("#login-password", "dev");
  await sleep(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /sign in/i.test(x.textContent)); b && b.click(); });
  await sleep(2500);
  for (const name of ["Dashboard", "Knowledge", "Tickets", "Users", "Settings"]) {
    await page.evaluate((n) => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n);
      if (b) b.click();
    }, name);
    await sleep(1500);
    await page.screenshot({ path: `C:/Users/aungaung/it-help-chatbot/docs/std-${name.toLowerCase()}.png` });
    console.log(name, "captured");
  }
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }