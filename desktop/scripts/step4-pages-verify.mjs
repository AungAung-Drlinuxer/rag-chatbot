// Step 4 gate: every page navigates + fetches real data after shim deletion.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 140)));
  await page.setViewport({ width: 1360, height: 900 });
  await page.goto("http://localhost:1420/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#login-username", { timeout: 15000 });
  await page.type("#login-username", process.env.VERIFY_USER);
  await page.type("#login-password", process.env.VERIFY_PASS);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /How can I help you today|New conversation/i.test(document.body.innerText), { timeout: 25000 });
  console.log("login+chat shell OK | backend health dot:",
    await page.evaluate(() => !!document.querySelector(".bg-emerald-500")));

  async function nav(label, expectRe, tag) {
    await page.evaluate((l) => {
      const t = [...document.querySelectorAll("button")].find((x) =>
        new RegExp("^\\s*" + l + "\\s*$", "i").test(x.textContent || ""));
      if (t) t.click();
    }, label);
    await sleep(4500);
    const ok = await page.evaluate((re) => new RegExp(re).test(document.body.innerText), expectRe);
    console.log(`${tag} (${label}): ${ok ? "OK" : "FAIL"}`);
    return ok;
  }

  let pass = 0, fail = 0;
  const checks = [
    ["Dashboard", "Total|Overview|tickets|conversations", "dashboard"],
    ["Knowledge", "knowledge|articles|domains|KB", "knowledge (fetches->api layer)"],
    ["Tickets", "Total tickets", "tickets"],
    ["Users", "users", "users (createUserApi/perms)"],
    ["Audit Log", "Audit|action", "audits (new api module)"],
    ["Settings", "Appearance|Theme|General", "settings (runtime knobs)"],
    ["Conversations", "conversation", "conv history"],
  ];
  for (const [l, re, tag] of checks) {
    (await nav(l, re, tag)) ? pass++ : fail++;
  }
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button")].find((x) => /^\s*Chat\s*$/i.test(x.textContent || ""));
    if (t) t.click();
  });
  await sleep(2000);
  console.log("back to chat:", await page.evaluate(() => /How can I help|IT Knowledge Assistant/i.test(document.body.innerText)));
  await page.screenshot({ path: "D:/ragchatbot/verify4_pages.png" });
  console.log(`\nRESULT: ${pass} pass / ${fail} fail | JS errors:`, errors.length ? errors.slice(0, 5) : "none");
} catch (e) {
  console.log("FAIL", e.message);
} finally {
  await browser.close();
}
