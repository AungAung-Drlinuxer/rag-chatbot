import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1150 });
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(3000);

// login
const userEl = await page.$('input[name="username"], input#username, input[type="text"]');
if (userEl) {
  await userEl.click({ clickCount: 3 });
  await page.keyboard.type("mcp-setadmin");
  const pwEl = await page.$('input[type="password"]');
  if (pwEl) { await pwEl.click({ clickCount: 3 }); await page.keyboard.type("McpSet!x72"); }
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    page.keyboard.press("Enter"),
  ]).catch(() => {});
  await sleep(5000);
}

// navigate to Settings
const nav = await page.evaluate(() => {
  for (const b of document.querySelectorAll("button,a")) {
    const t = (b.textContent || "").trim();
    if (t === "Settings" || t.startsWith("Settings")) { b.click(); return true; }
  }
  return false;
});
await sleep(4500);

// open the MCP integration tab
const clicked = await page.evaluate(() => {
  for (const el of document.querySelectorAll("button,a,div[role=tab],li")) {
    const t = (el.textContent || "").trim();
    if (/MCP/i.test(t) && t.length < 40) { el.click(); return t; }
  }
  return null;
});
await sleep(2500);

const info = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    cardVisible: /MCP \(Live Infrastructure\)/.test(txt),
    hasEnabled: /Enabled \(true\/false\)/.test(txt),
    hasRancherUrl: /Rancher Server URL/.test(txt),
    hasToken: /Rancher API Token/.test(txt),
    hasUrl: /MCP Server URL/.test(txt),
    hasTest: /Test/i.test(txt),
  };
});
console.log("clicked tab  :", clicked);
console.log("CARD:", JSON.stringify(info));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/mcp_settings_card.png", fullPage: true });
console.log("screenshot written");
await browser.close();
