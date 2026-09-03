// Prod check — RECENT CONVERSATIONS sidebar via https://chat.drlinuxer.com (self-signed cert).
import puppeteer from "puppeteer-core";
const BASE = "https://chat.drlinuxer.com";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--ignore-certificate-errors"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
let step = "";
try {
  await p.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await p.waitForSelector("input[placeholder=Username]", { timeout: 45000 });
  step = "login";
  await p.type("input[placeholder=Username]", "dev");
  await p.type("input[placeholder=Password]", "dev");
  const btns = await p.$$("button"); for (const bt of btns) { const t = (await bt.evaluate(el => el.textContent)).trim(); if (t === "Sign in") { await bt.click(); break; } }
  await p.waitForSelector(".navitem", { timeout: 45000 });
  await p.waitForSelector(".recent", { timeout: 15000 });
  // Wait for the async conversation list to populate.
  await p.waitForFunction(() => document.querySelectorAll(".conv").length > 0, { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  const title = await p.evaluate(() => document.querySelector(".recent-title")?.textContent?.trim());
  const convs = await p.$$eval(".conv", (els) => els.map(e => (e.querySelector(".conv-title")?.textContent?.trim() ?? "") + " · " + (e.querySelector(".conv-when")?.textContent?.trim() ?? "")));
  const hasClear = await p.evaluate(() => !!document.querySelector(".clear-btn"));
  const hasViewAll = await p.evaluate(() => !!document.querySelector(".view-all"));
  console.log("STEP: recent-title =", title, "| clear =", hasClear, "| viewAll =", hasViewAll, "| count =", convs.length);
  console.log("STEP: conversations =", JSON.stringify(convs));
  await p.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/ui-recent-prod.png" });
  // open the first conversation -> active dot
  if (await p.$(".conv")) {
    await p.click(".conv");
    await new Promise(r => setTimeout(r, 1200));
    console.log("STEP: opened, msgs =", await p.$$eval(".msg", e => e.length), "| active dot =", await p.evaluate(() => !!document.querySelector(".conv.active")));
    await p.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/ui-recent-prod-open.png" });
  }
  console.log("UI_RECENT_PROD_OK");
} catch (e) {
  console.log("FAIL at", step, "=>", String(e).slice(0, 240));
  try { await p.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/ui-recent-prod-fail.png" }); } catch {}
}
await b.close();
