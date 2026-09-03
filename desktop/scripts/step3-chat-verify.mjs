// Step 3 verification: refactored Chat page streams a real answer via runChatStream.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "D:/ragchatbot/verify3_";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });
  await page.setViewport({ width: 1360, height: 900 });

  await page.goto("http://localhost:1420/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#login-username", { timeout: 15000 });
  await page.type("#login-username", process.env.VERIFY_USER);
  await page.type("#login-password", process.env.VERIFY_PASS);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /How can I help you today|New conversation/i.test(document.body.innerText), { timeout: 25000 });
  console.log("LOGIN OK");

  // empty state present (EmptyChat from chat-parts)
  const empty = await page.evaluate(() => /How can I help you today/i.test(document.body.innerText));
  console.log("EmptyChat renders:", empty);

  // type a question into the composer and send
  await page.evaluate(() => {
    const ta = document.querySelector("textarea, input[placeholder*=ask i], [contenteditable]");
    if (ta) { ta.focus(); }
  });
  const typed = await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "What should I check when a Kubernetes pod is stuck in CrashLoopBackOff?");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  console.log("typed question:", typed);
  await page.keyboard.press("Enter");

  // wait for streaming to finish: TypingIndicator shows stage text, then answer appears
  let sawStage = false, answerLen = 0;
  for (let i = 0; i < 100; i++) {
    await sleep(2000);
    const st = await page.evaluate(() => {
      const txt = document.body.innerText;
      return {
        stage: /Thinking|retriev|knowledge|confidence|generat|answer/i.test(txt) && !!document.querySelector(".animate-bounce"),
        bubbles: document.querySelectorAll(".rounded-2xl").length,
        // assistant message bodies
        longest: Math.max(0, ...[...document.querySelectorAll("div")].filter(d => d.className.includes?.("rounded-2xl")).map(d => (d.innerText || "").length)),
      };
    });
    if (st.stage) sawStage = true;
    answerLen = st.longest;
    if (answerLen > 300 && !st.stage) break;  // answer settled
  }
  console.log("TypingIndicator/stage seen:", sawStage, "| longest bubble text:", answerLen);
  const meta = await page.evaluate(() => ({
    hasConfidence: /\d{1,3}%/.test(document.body.innerText),
    hasSources: /Sources|source/i.test(document.body.innerText),
    hasFeedback: !!document.querySelector("[title*=elpful], [title*=mprove], button svg.lucide-thumbs-up, button svg.lucide-thumbs-down"),
  }));
  console.log("meta UI:", JSON.stringify(meta));
  await page.screenshot({ path: OUT + "chat-answer.png", fullPage: false });
  console.log("JS ERRORS:", errors.length ? errors.slice(0, 6) : "none");
} catch (e) {
  console.log("FAIL", e.message);
} finally {
  await browser.close();
}
