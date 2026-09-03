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
  await page.type('input[type="text"]', "ith@dmin", { delay: 15 });
  await page.type('input[type="password"]', "Pwint@160320", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(2000);
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await sleep(3500);
  const check = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim());
    return {
      hasCsv: btns.includes("Export CSV"),
      hasReport: btns.includes("Report"),
      viewAllLeft: btns.filter((b) => b.includes("View all")).length,
      bottomLinks: Array.from(document.querySelectorAll("a")).map((a) => a.textContent.trim())
        .filter((t) => /View all|System status/.test(t)),
    };
  });
  console.log(JSON.stringify(check, null, 1));
  // test print popup
  const popup = new Promise((res) => browser.once("targetcreated", () => res("opened")));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.trim() === "Report");
    b.click();
  });
  console.log("print popup:", await Promise.race([popup, sleep(4000).then(() => "none")]));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/dashboard-report.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }