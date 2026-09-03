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
  const bundles = new Set();
  page.on("response", (res) => {
    const u = res.url();
    if (u.includes("/assets/index-")) bundles.add(u.split("/").pop() + " (from " + (res.fromCache() ? "cache" : "network") + ")");
  });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(500);
  await page.type('input[type="text"]', "dev", { delay: 15 });
  await page.type('input[type="password"]', "dev", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1400);
  await page.evaluate(() => { window.location.hash = "#/chat"; });
  await sleep(900);
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(2500);
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  console.log("theme:", theme);
  console.log("bundles loaded:", JSON.stringify(Array.from(bundles), null, 1));
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }