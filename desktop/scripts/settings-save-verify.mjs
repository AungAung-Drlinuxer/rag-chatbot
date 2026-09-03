import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1500);
// login
await page.evaluate(() => { localStorage.clear(); });
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2" });
await sleep(1000);
const needLogin = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
if (needLogin) {
  await page.type('input[type="text"], input[name="username"], #username', "ith@dmin");
  await page.type('input[type="password"]', "Pwint@160320");
  await page.click('button[type="submit"]');
  await sleep(3500);
}
// go to settings
await page.goto("https://chat.drlinuxer.com/#settings", { waitUntil: "networkidle2" }).catch(()=>{});
await sleep(1500);
// try hash-less nav via sidebar button
const clicked = await page.evaluate(() => {
  const els = [...document.querySelectorAll("button, a")];
  const b = els.find((e) => (e.textContent || "").trim().toLowerCase() === "settings");
  if (b) { b.click(); return true; }
  return false;
});
await sleep(2000);
const res = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    url: location.href,
    title: (document.querySelector("h1")||{}).textContent,
    stickyBarGone: !txt.includes("Unsaved changes are kept locally"),
    saveBtnInHeader: [...document.querySelectorAll("button")].some(b => /Save changes/.test(b.textContent) && b.closest("header")),
    hasSaveBtn: [...document.querySelectorAll("button")].some(b => /Save changes/.test(b.textContent)),
    adminBadge: txt.includes("Administrator"),
    fixedBottomBar: !!document.querySelector("div.fixed.bottom-0.left-0.right-0"),
  };
});
console.log(JSON.stringify(res, null, 1));
await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/settings-header-save.png" });
await browser.close();
