import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1600,1100",
         "--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1600, height: 1100 },
});
const page = await browser.newPage();

// instrument the Web Audio API BEFORE any app code runs so we can prove the chime fired
await page.evaluateOnNewDocument(() => {
  window.__chimes = [];
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig) return;
  const Spy = function (...a) {
    const ctx = new Orig(...a);
    const origOsc = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => {
      const osc = origOsc();
      const origStart = osc.start.bind(osc);
      osc.start = (...s) => { window.__chimes.push(ctx.currentTime); return origStart(...s); };
      return osc;
    };
    return ctx;
  };
  window.AudioContext = Spy;
  window.webkitAudioContext = Spy;
});

await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1500);
await page.evaluate(() => { location.hash = "#/login"; });
await sleep(1200);
const inputs = await page.$$("input");
if (inputs.length >= 2) {
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type("ui-reviewer");
  await inputs[1].click({ clickCount: 3 }); await inputs[1].type("UiReview!x72");
  await page.keyboard.press("Enter");
  await sleep(4500);
}

const box = await page.$("textarea");
if (!box) { console.log("NO TEXTAREA"); await browser.close(); process.exit(1); }
await box.click();
await page.keyboard.type("please escalate to ticket");
await page.keyboard.press("Enter");
console.log("sent escalation request");

// wait for EITHER the ticket form or the old approval modal
let state = null;
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  state = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      oldModal: /Escalation Approval Required/.test(txt),
      formOpen: /Create (support )?ticket|Create Ticket/i.test(txt),
      chips: window.__chimes ? window.__chimes.length : -1,
      diveText: txt.includes("please escalate to ticket"),
    };
  });
  if (state.oldModal || state.formOpen) break;
}
console.log("STATE:", JSON.stringify(state));

const detail = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll("input,textarea")];
  const subj = inputs.find((i) => /subject/i.test(i.getAttribute("placeholder") || ""));
  const desc = inputs.find((i) => /describ|detail/i.test(i.getAttribute("placeholder") || ""));
  return {
    subjectValue: subj ? subj.value : null,
    descValue: (desc && desc.value ? desc.value.slice(0, 60) : null),
    chimes: window.__chimes ? window.__chimes.length : -1,
    submitButton: !!([...document.querySelectorAll("button")].find((b) => /create ticket|submit/i.test(b.textContent || ""))),
  };
});
console.log("FORM DETAIL:", JSON.stringify(detail));

await page.screenshot({ path: "D:/ragchatbot/docs/qa/ticket_form_from_escalation.png" });
await browser.close();