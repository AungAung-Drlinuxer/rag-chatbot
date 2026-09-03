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
  async function goto(label) {
    await page.evaluate((l) => {
      Array.from(document.querySelectorAll("button, .navitem")).find((b) => b.textContent.trim() === l)?.click();
    }, label);
    await sleep(3000);
  }
  await goto("Settings");
  const s = await page.evaluate(() => {
    const t = document.body.innerText;
    const cards = document.querySelectorAll(".grid.xl\\:grid-cols-2 > div").length;
    return {
      autosaveCopyGone: !t.includes("Changes are saved to your application preferences"),
      manualSaveCopy: t.includes("Unsaved changes are kept locally"),
      bannerFixed: t.includes("once you press Save changes") && !t.includes("apply to new questions immediately"),
      integrationCards: cards >= 5,
      saveBtn: t.includes("Save changes"),
    };
  });
  console.log("settings:", JSON.stringify(s));
  await goto("Conversations");
  const h = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      title: document.querySelector("h1")?.textContent?.trim(),
      dateRange: !!document.querySelector('input[type="date"]'),
      inlineExportGone: !t.includes("Export .txt") || !document.querySelector("tbody button"),
      noExportCol: !Array.from(document.querySelectorAll("thead th")).some((x) => x.textContent.trim() === "Export"),
    };
  });
  console.log("history:", JSON.stringify(h));
  // click first row -> detail panel exports
  await page.evaluate(() => document.querySelector("tbody tr")?.click());
  await sleep(2500);
  const d = await page.evaluate(() => {
    const t = document.body.innerText;
    return { detailExportTxt: t.includes("Export .txt"), detailExportJson: t.includes("Export .json") };
  });
  console.log("detail:", JSON.stringify(d));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/history-after-fix.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }