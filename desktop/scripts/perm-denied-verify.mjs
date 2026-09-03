import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJBdW5nQXVuZyIsInR5cGUiOiJhY2Nlc3MiLCJpYXQiOjE3ODgxNTIzMDUsImV4cCI6MTc4ODE1NDEwNX0.PsrA3WrAK8j7EajAxxtEQZykaJxlhmTtMASUmab7aiY";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.evaluate((t) => sessionStorage.setItem("tokens", JSON.stringify({ access: t, refresh: null })), TOKEN);
  await page.reload({ waitUntil: "networkidle0", timeout: 25000 });
  await sleep(2500);
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await sleep(1500);
  // AungAung = User role: manage_users false => Users nav locked with padlock
  const nav = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("nav button"));
    const users = btns.find((b) => b.textContent.trim().startsWith("Users"));
    const chat = btns.find((b) => b.textContent.trim().startsWith("Chat"));
    return {
      usersLockedIcon: users ? !!users.querySelector("svg rect") : null,
      usersTitle: users ? (users.getAttribute("title") || "") : null,
      chatLocked: chat ? !!chat.querySelector("svg rect") : null,
    };
  });
  console.log("nav state:", JSON.stringify(nav));
  // click locked Users -> notification
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("nav button"));
    const users = btns.find((b) => b.textContent.trim().startsWith("Users"));
    if (users) users.click();
  });
  await sleep(700);
  const note = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("div"));
    for (const d of els) {
      const t = d.textContent || "";
      if (t.includes("Access restricted") && t.includes("Manage users")) return t.trim().slice(0, 200);
    }
    return "";
  });
  console.log("notification:", note || "(none)");
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/perm-denied.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }