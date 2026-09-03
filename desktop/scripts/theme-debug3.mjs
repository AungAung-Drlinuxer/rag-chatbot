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
  await page.type('input[type="text"]', "dev", { delay: 15 });
  await page.type('input[type="password"]', "dev", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1400);
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(1600);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    btns.find((b) => b.textContent.trim() === "Dark")?.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Save changes"))?.click();
  });
  await sleep(1400);
  await page.evaluate(() => { window.location.hash = "#/chat"; });
  await sleep(900);
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(3000);
  const st = await page.evaluate(() => ({
    ls: localStorage.getItem("ith.dark"),
    theme: document.documentElement.getAttribute("data-theme"),
    hash: location.hash,
    hasPassword: !!document.querySelector('input[type="password"]'),
    bodyClasses: document.documentElement.className,
  }));
  console.log(JSON.stringify(st, null, 1));
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }