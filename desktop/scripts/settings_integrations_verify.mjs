import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1600,1100"],
  defaultViewport: { width: 1600, height: 1100 },
});
const page = await browser.newPage();
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1500);
await page.evaluate(() => { location.hash = "#/login"; });
await sleep(1200);
const inputs = await page.$$("input");
if (inputs.length >= 2) {
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type("ui-reviewer");
  await inputs[1].click({ clickCount: 3 }); await inputs[1].type("UiReview!x72");
  await page.keyboard.press("Enter");
  await sleep(4000);
}
await page.evaluate(() => { location.hash = "#/settings"; });
await sleep(4500);

// Integrations tab
const tabClicked = await page.evaluate(() => {
  const els = [...document.querySelectorAll("button,[role=tab],a")];
  const t = els.find((e) => /integration/i.test(e.textContent || ""));
  if (t) { t.click(); return true; }
  return false;
});
await sleep(2500);

// list what integration cards the sidebar offers
const list = await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim())
    .filter((t) => /notion|clickup|xwiki|confluence|jira/i.test(t))
);
console.log("INTEGRATION BUTTONS:", JSON.stringify(list));

async function shot(name, matcher) {
  const ok = await page.evaluate((m) => {
    const els = [...document.querySelectorAll("button")];
    const t = els.find((e) => new RegExp(m, "i").test(e.textContent || ""));
    if (t) { t.click(); return true; }
    return false;
  }, matcher);
  await sleep(1800);
  await page.screenshot({ path: `D:/ragchatbot/docs/qa/${name}.png` });
  console.log(`${name}: clicked=${ok}`);
  return ok;
}

await shot("settings_notion", "^Notion");
await shot("settings_clickup", "^ClickUp");

// audit the rendered fields for the ClickUp card
const fields = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    hasBearerHint: /Bearer/i.test(txt),
    labels: (txt.match(/Personal API Token|List IDs for tasks|Doc IDs|Minimum task text length|Max tasks per sync|KB Domain Tag/g) || []),
  };
});
console.log("CLICKUP CARD:", JSON.stringify(fields));
await browser.close();
