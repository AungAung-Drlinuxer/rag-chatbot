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
  await sleep(600);
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(2500);
  const clicked = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("button, a, [role=button], .navitem, div[class*=cursor]"));
    const sec = items.find((b) => b.textContent.includes("Authentication & RBAC"));
    if (sec) { sec.click(); return "clicked Security section"; }
    return "section not found";
  });
  console.log(clicked);
  await sleep(1500);
  const visible = await page.evaluate(() => document.body.innerText.includes("Require HTTPS"));
  console.log("'Require HTTPS' visible:", visible);
  // Now click the toggle
  const r = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() === "Require HTTPS") {
        let el = node.parentElement;
        for (let up = 0; up < 8 && el; up++) {
          const btns = el.querySelectorAll("button");
          if (btns.length) {
            const btn = btns[btns.length - 1];
            const before = btn.className.includes("bg-blue-600");
            btn.click();
            return "clicked! was " + (before ? "ON" : "OFF");
          }
          el = el.parentElement;
        }
      }
    }
    return "toggle not found";
  });
  console.log("toggle:", r);
  await sleep(600);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/settings-security-toggled.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }