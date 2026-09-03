import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCacheEnabled(false);
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(500);
  await page.type('input[type="text"]', "ith@dmin", { delay: 15 });
  await page.type('input[type="password"]', "Pwint@160320", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(2500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, .navitem"));
    const nav = btns.find((b) => b.textContent.trim() === "Settings");
    if (nav) nav.click();
  });
  await sleep(3500);
  const check = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      title: document.querySelector("h1")?.textContent?.trim(),
      sections: ["General", "Appearance", "Integrations", "AI Assistant", "Notifications", "Enterprise security"]
        .map((s) => ({ name: s, present: t.includes(s) })),
      integrationCards: t.includes("Confluence") && t.includes("Jira") && t.includes("Connected"),
      themeSeg: t.includes("Light") && t.includes("Dark"),
      confidenceSlider: t.includes("Confidence threshold"),
      saveBar: t.includes("Save changes") && t.includes("preferences"),
    };
  });
  console.log(JSON.stringify(check, null, 1));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/settings-redesign.png", fullPage: false });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }