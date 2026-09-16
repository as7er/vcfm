// Fast render check: does the page actually paint a palette, in both themes?
//
// Written after a colour migration introduced custom-property cycles
// (`--bg: var(--bg)`), which invalidate the token and make every consumer fall
// back to the initial value — the page rendered black with invisible text.
// A screenshot would show it, but this reads the resolved values directly and is
// much faster than a full survey pass.
//
// Usage: node scripts/_theme-render-check.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8897;
const baseUrl = `http://127.0.0.1:${port}/`;

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

const probe = () => {
  const cs = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const card = document.querySelector(".card");
  const cardCs = card ? getComputedStyle(card) : null;
  const tokenNames = ["--bg", "--bg2", "--card", "--border", "--text", "--muted", "--primary",
    "--good", "--bad", "--warn", "--pitch", "--toast-bg", "--surface-inset",
    "--event-red", "--event-injury", "--event-pen", "--event-save", "--event-wood",
    "--event-sub", "--open-fg", "--open-border", "--closed-fg", "--closed-border",
    "--board-border", "--board-meta", "--bar-track", "--start-sky-top"];
  const tokens = {};
  for (const t of tokenNames) tokens[t] = cs.getPropertyValue(t).trim();
  return {
    theme: document.documentElement.getAttribute("data-theme") || "(default dark)",
    bodyBg: body.backgroundColor,
    bodyColor: body.color,
    cardBg: cardCs?.backgroundColor ?? null,
    cardColor: cardCs?.color ?? null,
    // an empty string here means the token is invalid (e.g. a reference cycle)
    emptyTokens: Object.entries(tokens).filter(([, v]) => !v).map(([k]) => k),
    tokens,
  };
};

let browser;
try {
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = (await fetch(baseUrl)).ok; } catch { /* retry */ }
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "preview server did not start");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 120000 });
  await page.fill("#input-manager", "Theme Check");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150000 });
  await page.waitForTimeout(1200);

  const results = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => {
      if (t === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
    }, theme);
    await page.waitForTimeout(500);
    const r = await page.evaluate(probe);
    results.push(r);
    console.log(JSON.stringify(r, null, 1));
  }

  let failed = false;
  for (const r of results) {
    if (r.emptyTokens.length) {
      console.log(`FAIL: ${r.theme} has invalid tokens: ${r.emptyTokens.join(", ")}`);
      failed = true;
    }
    const transparent = ["rgba(0, 0, 0, 0)", "transparent"];
    if (transparent.includes(r.bodyBg)) {
      console.log(`FAIL: ${r.theme} body background is transparent (${r.bodyBg})`);
      failed = true;
    }
    if (r.bodyBg === r.bodyColor) {
      console.log(`FAIL: ${r.theme} body text and background are the same colour (${r.bodyColor})`);
      failed = true;
    }
  }
  console.log(JSON.stringify({ pageErrors: errors }));
  console.log(failed ? "FAIL" : "PASS: both themes resolve every token and paint a readable palette");
  process.exitCode = failed ? 1 : 0;
} finally {
  if (browser) await browser.close();
  server.kill();
}
