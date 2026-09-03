// UI check — login, click Knowledge/Escalations/Settings, signout confirm.
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:1420";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const shot = (f) => p.screenshot({ path: `C:/Users/aungaung/it-help-chatbot/docs/${f}` });
let step = "";
try {
  await p.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await p.waitForSelector("input[placeholder=Username]", { timeout: 30000 });
  step = "login";
  await p.type("input[placeholder=Username]", "dev");
  await p.type("input[placeholder=Password]", "dev");
  const btns = await p.$$("button"); for (const bt of btns) { const t = (await bt.evaluate(el => el.textContent)).trim(); if (t === "Sign in") { await bt.click(); break; } }
  await p.waitForSelector(".navitem", { timeout: 30000 });
  console.log("STEP: logged in");
  const nav = (label) => p.evaluate((lab) => { const n = [...document.querySelectorAll(".navitem")].find(x => x.textContent.includes(lab)); if (n) n.click(); return !!n; }, label);

  await nav("Settings"); await new Promise(r => setTimeout(r, 800)); await shot("ui-settings.png"); console.log("STEP: settings");
  await nav("Escalations"); await new Promise(r => setTimeout(r, 800)); await shot("ui-escalations.png"); console.log("STEP: escalations");
  await nav("Knowledge"); await new Promise(r => setTimeout(r, 800)); await shot("ui-knowledge.png"); console.log("STEP: knowledge");
  await nav("Assistant"); await new Promise(r => setTimeout(r, 500));

  step = "signout";
  await p.click(".signout-btn");
  await new Promise(r => setTimeout(r, 500));
  const modalVisible = await p.evaluate(() => !!document.querySelector(".modal"));
  await shot("ui-signout-confirm.png");
  console.log("STEP: signout modal visible =", modalVisible);
  await p.evaluate(() => { const c = [...document.querySelectorAll(".modal-actions button")].find(x => x.textContent.includes("Cancel")); if (c) c.click(); });
  await new Promise(r => setTimeout(r, 400));
  console.log("STEP: after cancel, modal gone =", await p.evaluate(() => !document.querySelector(".modal")));
  console.log("UI_CHECK_OK");
} catch (e) {
  console.log("FAIL at", step, "=>", String(e).slice(0, 200));
  try { await shot("ui-fail.png"); } catch {}
}
await b.close();
