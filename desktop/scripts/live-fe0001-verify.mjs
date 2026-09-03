// LIVE E2E against chat.drlinuxer.com (the 0.0.01 image actually serving)
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
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#login-username", { timeout: 15000 });
  await page.type("#login-username", process.env.VERIFY_USER);
  await page.type("#login-password", process.env.VERIFY_PASS);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /How can I help you today|New conversation/i.test(document.body.innerText), { timeout: 25000 });
  console.log("login -> chat shell OK (LoginPage+ChatPage from new image)");

  async function nav(label, expectRe) {
    await page.evaluate((l) => {
      const t = [...document.querySelectorAll("button")].find((x) =>
        new RegExp("^\\s*" + l + "\\s*$", "i").test(x.textContent || ""));
      if (t) t.click();
    }, label);
    await sleep(5000);
    const ok = await page.evaluate((re) => new RegExp(re).test(document.body.innerText), expectRe);
    console.log(label + ":", ok ? "OK" : "FAIL");
    return ok;
  }
  let pass = 0, fail = 0;
  for (const [l, re] of [
    ["Dashboard", "Total|Overview|tickets|conversations"],
    ["Knowledge", "knowledge|articles|domains|KB"],
    ["Tickets", "Total tickets"],
    ["Users", "users"],
    ["Audit Log", "Audit|action"],
    ["Settings", "Appearance|Theme|General"],
    ["Conversations", "conversation"],
  ]) { (await nav(l, re)) ? pass++ : fail++; }

  // real chat round-trip on live
  await page.evaluate(() => { const t = [...document.querySelectorAll("button")].find(x => /^\s*Chat\s*$/i.test(x.textContent || "")); if (t) t.click(); });
  await sleep(2000);
  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "How do I reset my AD password?");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector(".animate-bounce") && /\d{2,}/.test(document.body.innerText), { timeout: 240000 });
  const streamed = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll("div")].map(d => (d.innerText || "").length)));
  console.log("live chat streamed answer, longest block:", streamed, "chars");
  await page.screenshot({ path: "D:/ragchatbot/verify_live_fe0001.png" });
  console.log(`\nLIVE RESULT: ${pass} pass / ${fail} fail | JS errors:`, errors.length ? errors.slice(0, 5) : "none");
} catch (e) {
  console.log("FAIL", e.message);
} finally {
  await browser.close();
}
