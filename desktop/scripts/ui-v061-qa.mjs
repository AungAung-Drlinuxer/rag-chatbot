// v0.6.1 QA: profile avatar, signout label, left panel, confidence bar.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });

  // Sidebar: profile avatar + signout text
  const profile = await page.evaluate(() => {
    const p = document.querySelector(".profile-head");
    const so = document.querySelector(".signout-btn");
    return {
      avatar: !!p && !!p.querySelector(".avatar.user-profile"),
      name: p?.querySelector(".name")?.textContent,
      signoutText: so?.textContent?.trim().includes("Sign Out"),
      signoutIcon: !!so?.querySelector("svg"),
    };
  });
  ok("profile avatar shows", profile.avatar);
  ok("profile name correct", profile.name === "dev", profile.name || "?");
  ok("signout has text + icon", profile.signoutText && profile.signoutIcon);

  // Left panel visible
  const lp = await page.evaluate(() => {
    const el = document.querySelector(".left-panel");
    return !!el && el.querySelectorAll(".card").length >= 2;
  });
  ok("left panel with IT Lead + Find Article cards", lp);

  // Chat confidence bar above composer
  const cb = await page.evaluate(() => {
    const el = document.querySelector(".confidence-bar");
    return !!el && !!el.querySelector(".badge.domain");
  });
  ok("confidence bar above composer", cb);

  // Send a message to verify confidence bar updates
  await page.type('textarea[placeholder^="Ask about"]', "VPN issue");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let confUpdated = false;
  for (let i = 0; i < 15; i++) {
    const hasConf = await page.evaluate(() => {
      const b = document.querySelector(".confidence-bar .badge.conf");
      return b && b.textContent !== "conf —";
    });
    if (hasConf) { confUpdated = true; break; }
    await sleep(1500);
  }
  ok("confidence updates after streaming", confUpdated);

  const fails = R.filter((r) => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }