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
  await sleep(4500);
}
// dismiss the command palette if it opened
await page.keyboard.press("Escape");
await sleep(500);

for (const hash of ["#/knowledge", "#/knowledge?tab=articles", "#/knowledge/articles"]) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await sleep(5000);
  const probe = await page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const tables = document.querySelectorAll("table").length;
    const heads = [...document.querySelectorAll("th")].map((t) => (t.textContent || "").trim());
    const rows = document.querySelectorAll("tbody tr").length;
    return {
      tables, rows, heads,
      hasArticleTitle: /Article Title/.test(main.innerText),
      providerBadges: [...document.querySelectorAll("span")].map((s) => (s.textContent || "").trim())
        .filter((t) => /^(Confluence|ClickUp|Notion|XWiki|OpenProject|Manual)$/.test(t)).length,
    };
  });
  console.log(hash, "->", JSON.stringify(probe));
  if (probe.tables > 0) { await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_provider_column.png" }); break; }
}
await browser.close();