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
await page.evaluate(() => {
  const els = [...document.querySelectorAll("button,[role=tab],a")];
  const t = els.find((e) => /integration/i.test(e.textContent || ""));
  if (t) t.click();
});
await sleep(2500);

// the Models Provider card (renamed from H-Chat)
await page.evaluate(() => {
  const t = [...document.querySelectorAll("button")].find((e) => /models provider|^LLM$/i.test((e.textContent || "").trim()));
  if (t) t.click();
});
await sleep(2000);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/settings_models_provider.png" });

const audit = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    renamedToModelsProvider: /Models Provider/.test(txt),
    hChatGone: !/H-Chat/.test(txt),
    writeOnlyBanner: /Credentials are write-only/.test(txt),
    maskedRows: (txt.match(/••••••••/g) || []).length,
    notRetrievableLabel: /not retrievable|value hidden|Secret saved/.test(txt),
    hasReplace: /Replace/.test(txt),
    hasClear: /Remove stored settings/.test(txt),
  };
});
console.log("SETTINGS AUDIT:", JSON.stringify(audit));
await browser.close();
