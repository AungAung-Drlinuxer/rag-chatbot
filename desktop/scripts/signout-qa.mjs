// Verify: exactly ONE profile+signout per page, at BOTTOM of sidebar
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
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => x.textContent.trim() === n);
      if (b) b.click();
    }, name);
    await sleep(1200);
    const stats = await page.evaluate(() => {
      const signs = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Sign out" && b.offsetParent !== null);
      const positions = signs.map((b) => Math.round(b.getBoundingClientRect().top));
      return { count: signs.length, positions };
    });
    console.log(`${name}: visible Sign out = ${stats.count}, tops=${JSON.stringify(stats.positions)}`);
  }
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/signout-bottom.png" });
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }