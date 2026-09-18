import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(3000);
const u = await page.$('input[name="username"], input#username, input[type="text"]');
if (u) {
  await u.click({ clickCount: 3 });
  await page.keyboard.type("conn-reviewer");
  const pw = await page.$('input[type="password"]');
  if (pw) { await pw.click({ clickCount: 3 }); await page.keyboard.type("ConnRev!x72"); }
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    page.keyboard.press("Enter"),
  ]).catch(() => {});
  await sleep(5000);
}
// Settings -> Connectors (SPA: a hard goto does not route, so click the nav item)
await page.evaluate(() => {
  const items = [...document.querySelectorAll("a, button")];
  const it = items.find((e) => (e.textContent || "").trim() === "Settings");
  if (it) it.click();
});
await sleep(6000);
// v1.6.75 — settings is now a grouped nav, so open the Connectors panel first.
const navClicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("nav button")]
    .find((x) => (x.textContent || "").trim() === "Connectors");
  if (b) { b.click(); return true; }
  return false;
});
console.log("nav Connectors clicked:", navClicked);
// wait past the gallery's background-probe refresh (7s) so the tool count lands
await sleep(14000);
// confirm the nav carries the grouped structure
const nav = await page.evaluate(() => {
  const groups = [...document.querySelectorAll("nav p")].map((e) => (e.textContent || "").trim());
  const items = [...document.querySelectorAll("nav button")].map((e) => (e.textContent || "").trim());
  const current = document.querySelector('nav button[aria-current="page"]');
  return { groups, items, active: current ? current.textContent.trim() : null };
});
console.log("NAV:", JSON.stringify(nav));

const info = await page.evaluate(() => {
  const t = document.body.innerText;
  const cards = [...document.querySelectorAll("button[aria-label^='Connect ']")];
  const ticks = [...document.querySelectorAll("button[aria-label$='connected']")];
  return {
    heading: /Connectors/.test(t),
    subheading: /Connect services so the assistant can read and act on your data/.test(t),
    searchBox: Boolean(document.querySelector('input[placeholder="Search all connectors"]')),
    filters: ["all", "connected", "available"].filter((f) =>
      [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim().toLowerCase().startsWith(f))),
    customButton: /Custom connector/.test(t),
    categories: ["Infrastructure", "Observability", "Data", "Developer", "Productivity", "Files", "Custom"]
      .filter((c) => new RegExp(c, "i").test(t)),
    plusButtons: cards.length,
    connectedTicks: ticks.length,
    showsToolCount: /\d+ read tools/.test(t),
    showsNotAnswering: /server not answering/.test(t),
    legacyFieldForm: /Rancher Server URL/.test(t),
  };
});
console.log("GALLERY:", JSON.stringify(info, null, 1));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/connectors_gallery.png", fullPage: false });
// scroll to show more categories
await page.evaluate(() => window.scrollBy(0, 700));
await sleep(1200);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/connectors_gallery2.png", fullPage: false });
console.log("screenshots written");
await browser.close();
