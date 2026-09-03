// capture auth page: intercept AFTER login form renders (block only the final callback nav)
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  // don't intercept navigation — KC auth page renders, form submit would go to callback
  // but we never submit, so nothing redirects. Earlier blank shot was from aborting the
  // redirect BEFORE the page rendered.
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    "https://10.10.10.200/realms/drlinuxer/protocol/openid-connect/auth?client_id=it-help-chatbot&redirect_uri=http://localhost:1420/callback&response_type=code&scope=openid",
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );
  await sleep(1500);
  const html = await page.content();
  console.log("page has dlx-brand:", html.includes("dlx-brand"));
  console.log("page has dlx-heading:", html.includes("dlx-heading"));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/kc-live-branded.png" });
  console.log("captured");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }