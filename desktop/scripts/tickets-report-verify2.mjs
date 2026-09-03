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
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/tickets"; });
  await sleep(5000);
  const info = await page.evaluate(() => {
    const rows = document.querySelectorAll("tbody tr").length;
    const scrollBox = Array.from(document.querySelectorAll("div")).find(
      (d) => typeof d.className === "string" && d.className.indexOf("overflow-y-auto") >= 0 && d.className.indexOf("420") >= 0
    );
    const anyTable = document.querySelector("table");
    return {
      rows,
      scrollBoxFound: !!scrollBox,
      scrollBoxClass: scrollBox ? String(scrollBox.className).slice(0, 120) : null,
      tableFound: !!anyTable,
      tableClass: anyTable ? String(anyTable.className).slice(0, 80) : null,
      canScrollY: scrollBox ? scrollBox.scrollHeight > scrollBox.clientHeight : null,
      sh: scrollBox ? scrollBox.scrollHeight : null,
      ch: scrollBox ? scrollBox.clientHeight : null,
      hOverflow: scrollBox ? scrollBox.scrollWidth > scrollBox.clientWidth + 1 : null,
      summary: Array.from(document.querySelectorAll("span")).map((s) => s.textContent.trim()).find((x) => x.startsWith("Showing all")),
      buttons: Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim()).filter((x) => /CSV|Report|Refresh/.test(x)),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/tickets-report.png" });
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }