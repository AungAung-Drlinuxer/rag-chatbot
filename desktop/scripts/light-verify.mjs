import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1200);
// fresh login
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2" });
await sleep(1200);
const hasLoginForm = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
if (hasLoginForm) {
  await page.type('input[type="text"], #username, input[name="username"]', "ith@dmin");
  await page.type('input[type="password"]', "Pwint@160320");
  await page.click('button[type="submit"]');
  await sleep(4500);
}
const after = await page.evaluate(() => ({
  hash: location.hash,
  isChat: !!document.querySelector("textarea, [data-chat-input]") || document.body.innerText.includes("IT Knowledge Assistant"),
  usersVisible: document.body.innerText.includes("User management") || location.hash.includes("users"),
}));
console.log("after-login:", JSON.stringify(after));
// switch to LIGHT theme via settings (data-theme attr)
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
await sleep(400);
const theme = await page.evaluate(() => {
  const root = document.documentElement.getAttribute("data-theme");
  const bg = getComputedStyle(document.body).backgroundColor;
  const aside = document.querySelector("aside");
  const asideBg = aside ? getComputedStyle(aside).backgroundColor : null;
  return { theme: root, bodyBg: bg, sidebarBg: asideBg, sidebarIsNavy: asideBg === "rgb(10, 22, 40)" };
});
console.log("light-theme:", JSON.stringify(theme));
await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/chat-light-fixed.png" });
await browser.close();
console.log("DONE");
