// Screenshot + MEASURE the Anytype additions on Settings → Integrations and → Connectors.
//
// WHY a harness: both surfaces are behind auth and verification must not sign in as anyone.
// The harness renders the REAL `IntegrationsConfig` and `ConnectorsGallery` with `fetch`
// stubbed, and the connector payload is generated from the real backend catalogue.
//
// What it MEASURES rather than looks at:
//   1. no JS errors, no horizontal overflow
//   2. the Integrations tab bar actually offers Anytype — a META entry with no tab is
//      unreachable, which is how this was first written and why the assertion exists
//   3. selecting it loads the real endpoint: /api/settings/integrations/anytype must appear
//      in the request log (a tab wired to a label would pass a screenshot test)
//   4. the panel renders the module's own config fields — all 7, with the API key masked
//      (type=password) and the rest plain
//   5. the description tells the operator the two things that actually break this setup:
//      the mandatory Anytype-Version header and that the backend may not reach loopback
//   6. the Connectors gallery shows an Anytype card in a Knowledge group, and the note
//      carries the stdio→bridge requirement and the version-header caveat
//
// Usage (dev server only): node scripts/settings_anytype_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5219;
const BASE = `http://localhost:${PORT}/settings-anytype-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true,
  stdio: "pipe",
  cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await reachable(BASE);
  if (!up) await sleep(1000);
}
if (!up) {
  dev.kill();
  throw new Error(`harness server not reachable at ${BASE}`);
}
await sleep(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

// The 7 fields the anytype integration module reads out of system_settings.
const EXPECTED_FIELDS = [
  "Anytype API base URL",
  "API Key (Anytype → Settings → API Keys)",
  "Anytype-Version header (blank = 2025-11-08)",
  "Space IDs or names (comma separated, empty = all spaces)",
  "Object types (comma separated, empty = all)",
  "KB Domain Tag (empty = auto-classify)",
  "Max objects per sync",
];

const report = {};
let failed = false;
const fail = (m) => {
  failed = true;
  return m;
};

for (const theme of ["light", "dark"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });

  const jsErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto(`${BASE}?theme=${theme}`, { waitUntil: "networkidle2" });
  await page.waitForFunction("() => !!window.__SETTINGS_HARNESS__", { timeout: 30000 });
  await sleep(1200);

  const r = { problems: [] };

  // ---- is the stylesheet even applied? -------------------------------------------
  // The first version of this harness omitted `import "./styles.css"`, so the connector
  // dialog computed to `position: static` with a transparent background and every layout
  // number below was fiction. Assert the utilities resolve before trusting any of them.
  r.styles = await page.evaluate("window.__SETTINGS_HARNESS__.styles()");
  if (!r.styles.fixedApplies) r.problems.push(fail("Tailwind `fixed` does not resolve — styles.css is not applied"));
  if (!r.styles.insetApplies) r.problems.push(fail("Tailwind `inset-0` does not resolve — styles.css is not applied"));
  if (!r.styles.zIndexApplies) r.problems.push(fail("Tailwind `z-50` does not resolve — styles.css is not applied"));

  // ---- Integrations ---------------------------------------------------------------
  r.integrationTabs = await page.evaluate("window.__SETTINGS_HARNESS__.integrationTabs()");
  if (!r.integrationTabs.includes("Anytype")) {
    r.problems.push(fail(`Anytype has no tab — unreachable. tabs=${JSON.stringify(r.integrationTabs)}`));
  }

  const reqsBefore = await page.evaluate("window.__SETTINGS_REQS__.length");
  r.clicked = await page.evaluate('window.__SETTINGS_HARNESS__.selectIntegration("Anytype")');
  if (!r.clicked) r.problems.push(fail("could not click the Anytype tab"));
  await sleep(900);

  r.anytypeRequests = await page.evaluate(
    "window.__SETTINGS_REQS__.filter(u => /integrations\\/anytype/.test(u))",
  );
  r.requestsIssuedByClick = await page.evaluate(
    `window.__SETTINGS_REQS__.slice(${reqsBefore})`,
  );
  if (r.anytypeRequests.length === 0) {
    r.problems.push(fail("selecting Anytype issued no request — the tab is not wired to the endpoint"));
  }

  r.fields = await page.evaluate("window.__SETTINGS_HARNESS__.fields()");
  r.desc = await page.evaluate("window.__SETTINGS_HARNESS__.desc()");

  const labels = r.fields.map((f) => f.label);
  if (JSON.stringify(labels) !== JSON.stringify(EXPECTED_FIELDS)) {
    r.problems.push(fail(`field list differs.\n    got:      ${JSON.stringify(labels)}\n    expected: ${JSON.stringify(EXPECTED_FIELDS)}`));
  }
  const key = r.fields.find((f) => /API Key/.test(f.label));
  if (!key) r.problems.push(fail("API key field missing"));
  else if (key.type !== "password") {
    r.problems.push(fail(`API key field is type=${key.type}, not password — it would render in clear text`));
  }
  const plain = r.fields.filter((f) => !/API Key/.test(f.label));
  const wrong = plain.filter((f) => f.type !== "text");
  if (wrong.length) {
    r.problems.push(fail(`non-secret fields not plain text inputs: ${JSON.stringify(wrong)}`));
  }
  if (!/Anytype-Version/.test(r.desc)) {
    r.problems.push(fail("description does not mention the mandatory Anytype-Version header"));
  }
  if (!/127\.0\.0\.1|loopback|reachable host/.test(r.desc)) {
    r.problems.push(fail("description does not warn that a containerised backend cannot reach loopback"));
  }

  // ---- Hashnode: reachable, right fields, PAT masked, endpoint hit ------------------
  await page.evaluate('window.__SETTINGS_HARNESS__.selectIntegration("Hashnode")');
  await sleep(1500);
  r.hashnodeFields = await page.evaluate("window.__SETTINGS_HARNESS__.fields()");
  r.hashnodeReqs = await page.evaluate(
    "window.__SETTINGS_REQS__.filter(u => /integrations\\/hashnode/.test(u))",
  );
  if (r.hashnodeReqs.length === 0) {
    r.problems.push(fail("opening the Hashnode tab issued no /integrations/hashnode request"));
  }
  const HN_WANT = ["Publication host", "Personal Access Token", "GraphQL endpoint",
                   "KB domain tag", "Max posts per sync", "Include drafts"];
  for (const want of HN_WANT) {
    if (!r.hashnodeFields.some((f) => f.label.startsWith(want))) {
      r.problems.push(fail(`Hashnode is missing the "${want}" field (got ${JSON.stringify(r.hashnodeFields.map((f) => f.label))})`));
    }
  }
  const hnPat = r.hashnodeFields.find((f) => f.label.startsWith("Personal Access Token"));
  if (hnPat && hnPat.type !== "password") {
    r.problems.push(fail(`Hashnode PAT renders as type=${hnPat.type}, expected password`));
  }
  r.hashnodeText = await page.evaluate("window.__SETTINGS_HARNESS__.bodyText()");
  if (!/Pro plan/.test(r.hashnodeText)) {
    r.problems.push(fail("Hashnode panel does not mention the Pro-plan requirement for API reads"));
  }
  await page.evaluate('window.__SETTINGS_HARNESS__.selectIntegration("Anytype")');
  await sleep(1000);

  // ---- nav rail -------------------------------------------------------------------
  r.nav = await page.evaluate("window.__SETTINGS_HARNESS__.nav()");
  // "Models Provider" is deliberately absent: the model provider moved to the AI service
  // section, so Integrations is knowledge sources + infrastructure only.
  const NAV_EXPECTED = ["Confluence", "Jira", "OpenProject", "XWiki", "Notion", "ClickUp",
                        "Anytype", "Hashnode", "MCP", "LDAP", "Keycloak"];
  if (JSON.stringify(r.nav) !== JSON.stringify(NAV_EXPECTED)) {
    r.problems.push(fail(`nav rail differs.\n    got:      ${JSON.stringify(r.nav)}\n    expected: ${JSON.stringify(NAV_EXPECTED)}`));
  }

  if (r.nav.includes("Models Provider")) {
    r.problems.push(fail("Models Provider is still listed under Integrations — it moved to AI service"));
  }

  // back to Anytype for the remaining assertions
  await page.evaluate('window.__SETTINGS_HARNESS__.selectIntegration("Anytype")');
  await sleep(1200);

  // ---- security attributes + per-field reveal -------------------------------------
  // Asserted on Anytype because its key is NOT stored here, so a real input renders. On the
  // Models Provider tab the key is stored and the field is correctly a write-only mask with
  // no input at all — asserting a password input there was asserting the wrong thing.
  r.secretInputs = await page.evaluate("window.__SETTINGS_HARNESS__.secretInputs()");
  if (r.secretInputs.length === 0) {
    r.problems.push(fail("no password input rendered for an unconfigured API key"));
  }
  for (const si of r.secretInputs) {
    if (si.autoComplete !== "off") r.problems.push(fail(`secret input autoComplete=${si.autoComplete}, expected "off"`));
    if (si.spellCheck !== "false") r.problems.push(fail(`secret input spellCheck=${si.spellCheck}, expected "false"`));
    if (si.autoCorrect !== "off") r.problems.push(fail(`secret input autoCorrect=${si.autoCorrect}, expected "off"`));
    if (!si.onePwIgnore) r.problems.push(fail("secret input lacks data-1p-ignore"));
    if (si.lastPassIgnore !== "true") r.problems.push(fail(`secret input data-lpignore=${si.lastPassIgnore}`));
  }

  // Per-field reveal: toggling one secret must reveal exactly that one.
  r.revealClicked = await page.evaluate('window.__SETTINGS_HARNESS__.toggleReveal("API Key")');
  await sleep(400);
  r.passwordsBeforeToggle = r.secretInputs.length;
  r.passwordsAfterReveal = await page.evaluate("document.querySelectorAll('#integrations input[type=password]').length");
  if (!r.revealClicked) r.problems.push(fail("no reveal toggle found for the API Key field"));
  if (r.passwordsAfterReveal !== r.passwordsBeforeToggle - 1) {
    r.problems.push(fail(`revealing one secret changed the password-input count from ${r.passwordsBeforeToggle} to ${r.passwordsAfterReveal}, expected exactly one fewer`));
  }

  // Shot taken here, while no modal is open, so the file named "integrations" really
  // shows the integrations panel. (It previously ran after the connector dialog opened,
  // so the name described a screen the image did not contain.)
  await page.screenshot({ path: `${OUT}/settings_anytype_integrations_${theme}.png`, fullPage: false });

  // ---- Connectors -----------------------------------------------------------------
  r.connectors = await page.evaluate("window.__SETTINGS_HARNESS__.connectors()");
  if (!r.connectors.hasAnytype) {
    r.problems.push(fail("no Anytype card in the Connectors gallery"));
  }
  if (!r.connectors.hasKnowledgeGroup) {
    r.problems.push(fail("no Knowledge group heading in the gallery"));
  }
  // The catalogue `note` is rendered inside the ConnectDialog, not on the card, so it has
  // to be opened before it can be read. Asserting on the card would have been an assertion
  // about the wrong place.
  await page.evaluate('document.querySelector("#connectors").scrollIntoView()');
  await sleep(400);
  await page.screenshot({ path: `${OUT}/settings_anytype_connectors_${theme}.png`, fullPage: false });

  r.openedConnector = await page.evaluate('window.__SETTINGS_HARNESS__.openConnector("Anytype")');
  if (!r.openedConnector) r.problems.push(fail("could not open the Anytype connector form"));
  await sleep(800);
  r.dialogText = await page.evaluate("window.__SETTINGS_HARNESS__.bodyText()");
  r.dialogBox = await page.evaluate("window.__SETTINGS_HARNESS__.dialogBox()");
  if (!r.dialogBox) {
    r.problems.push(fail("no dialog overlay element in the DOM"));
  } else {
    if (r.dialogBox.position !== "fixed") {
      r.problems.push(fail(`dialog overlay is position:${r.dialogBox.position}, not fixed — it will not cover the viewport`));
    }
    if (!r.dialogBox.coversViewport) {
      r.problems.push(fail(`dialog overlay does not cover the viewport: top=${r.dialogBox.top} height=${r.dialogBox.height}`));
    }
    // Read the ALPHA, do not pattern-match a colour format. Tailwind v4 emits
    // `oklab(0 0 0 / 0.4)` for bg-black/40 while older versions emit rgba(...); matching
    // on "rgba?" reported a correctly-painted dim layer as missing.
    const parseAlpha = (v) => (v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v));
    const alphaOf = (raw) => {
      const s = String(raw).trim();
      if (s === "transparent" || s === "none") return 0;
      const slash = s.match(/\/\s*([\d.]+%?)\s*\)\s*$/); // oklab(...) / oklch(...) / color(...)
      if (slash) return parseAlpha(slash[1]);
      const rgba = s.match(/^rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([\d.]+%?)\s*\)$/);
      if (rgba) return parseAlpha(rgba[1]);
      return 1; // rgb(...) and anything else opaque
    };
    const alpha = alphaOf(r.dialogBox.bg);
    r.dialogBgAlpha = alpha;
    if (!(alpha > 0.05)) {
      r.problems.push(fail(`dialog dim layer is not painted (bg=${r.dialogBox.bg}, alpha=${alpha})`));
    }
  }

  if (!/stdio only/.test(r.dialogText)) {
    r.problems.push(fail("connector note does not explain the stdio→bridge requirement"));
  }
  if (!/supergateway/.test(r.dialogText)) {
    r.problems.push(fail("connector note does not name supergateway as the bridge"));
  }
  if (!/Anytype-Version/.test(r.dialogText)) {
    r.problems.push(fail("connector note does not mention the mandatory Anytype-Version header"));
  }
  if (!/31009/.test(r.dialogText)) {
    r.problems.push(fail("connector note does not name the default port 31009"));
  }
  if (!/read-only|reads are exposed/.test(r.dialogText)) {
    r.problems.push(fail("connector note does not state that only reads are exposed"));
  }
  await page.screenshot({ path: `${OUT}/settings_anytype_dialog_${theme}.png`, fullPage: false });
  {
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const hash = (p) => createHash("md5").update(readFileSync(p)).digest("hex");
    const grid = hash(`${OUT}/settings_anytype_connectors_${theme}.png`);
    const dlg = hash(`${OUT}/settings_anytype_dialog_${theme}.png`);
    r.dialogShotDiffers = grid !== dlg;
    if (grid === dlg) {
      r.problems.push(fail("the dialog screenshot is byte-identical to the grid screenshot — the modal is not visible"));
    }
  }

  // ---- health ---------------------------------------------------------------------
  r.overflow = await page.evaluate("window.__SETTINGS_HARNESS__.overflow()");
  if (r.overflow.scrollW > r.overflow.clientW + 1) {
    r.problems.push(fail(`horizontal overflow: ${r.overflow.scrollW} > ${r.overflow.clientW}`));
  }
  r.screenshots = [
    `${OUT}/settings_anytype_integrations_${theme}.png`,
    `${OUT}/settings_anytype_connectors_${theme}.png`,
    `${OUT}/settings_anytype_dialog_${theme}.png`,
  ];
  r.jsErrors = jsErrors;
  r.consoleErrors = consoleErrors;
  if (jsErrors.length) r.problems.push(fail(`JS errors: ${JSON.stringify(jsErrors.slice(0, 3))}`));

  report[theme] = r;
  await page.close();
}

await browser.close();
dev.kill();

console.log(JSON.stringify(report, null, 2));

const allProblems = Object.values(report).flatMap((r) => r.problems);
if (allProblems.length) {
  console.error(`\nFAILED (${allProblems.length}):`);
  for (const p of allProblems) console.error("  - " + p);
  process.exit(1);
}
console.log(
  "\nOK: Anytype is reachable in Integrations (7 real config fields, key masked, endpoint " +
    "hit) and offered in the Connectors gallery under Knowledge with the stdio/version caveats stated.",
);
