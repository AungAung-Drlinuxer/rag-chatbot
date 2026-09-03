import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCacheEnabled(false);
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(500);
  await page.type('input[type="text"]', "ith@dmin", { delay: 15 });
  await page.type('input[type="password"]', "Pwint@160320", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(2500);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button, .navitem")).find((b) => b.textContent.trim() === "Tickets")?.click();
  });
  await sleep(3500);
  // click a ticket row to open the detail panel
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("tbody button")).find((x) => /ITHD-/.test(x.textContent));
    b?.click();
  });
  await sleep(2500);
  const d = await page.evaluate(() => {
    const t = document.body.innerText;
    const ta = document.querySelector("aside textarea");
    return {
      ticketOpen: t.includes("ITHD-"),
      commentBox: !!ta && ta.placeholder.includes("Write a comment"),
      sendBtn: t.includes("Send"),
      dupAddComment: t.includes("Add comment"),
    };
  });
  console.log("drawer:", JSON.stringify(d));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/tickets-drawer-fixed.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }