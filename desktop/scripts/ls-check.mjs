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
  await sleep(500);
  const ls = await page.evaluate(() => ({
    dark: localStorage.getItem("ith.dark"),
    theme: document.documentElement.getAttribute("data-theme"),
  }));
  console.log("on login page:", JSON.stringify(ls));
  await page.close();
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }