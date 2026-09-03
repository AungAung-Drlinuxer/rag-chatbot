// Verify NO duplicate sidebar: count 'iTH' brand marks on Tickets page (should be 1)
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
  await sleep(2000);
  for (const name of ["Tickets", "Dashboard", "Knowledge"]) {
    await page.evaluate((n) => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => x.textContent.trim() === n);
      if (b) b.click();
    }, name);
    await sleep(1200);
    const brands = await page.evaluate(() => {
      return [...document.querySelectorAll("div")].filter((d) =>
        d.textContent.trim() === "iTH" && d.offsetParent !== null
      ).length;
    });
    const asides = await page.evaluate(() => document.querySelectorAll("aside").length);
    console.log(`${name}: iTH marks=${brands} (expect 1-2), asides=${asides} (expect 1)`);
  }
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }