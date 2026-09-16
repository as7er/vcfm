// Minimal smoke test: does the page boot with the new segment-transition code?
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { chromium } from "playwright";

const root = "F:/VCFM/";
const port = 8910;
const PROGRESS = root + ".tmp-continuity/smoke-progress.log";
const mark = (s) => { try { appendFileSync(PROGRESS, new Date().toISOString() + " " + s + "\n"); } catch { /* ignore */ } };
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

let browser;
try {
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = (await fetch("http://127.0.0.1:" + port + "/")).ok; } catch { /* retry */ }
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "server");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", async (d) => { await d.accept(); });

  await page.goto("http://127.0.0.1:" + port + "/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => (
    !("serviceWorker" in navigator) ||
    Object.keys(sessionStorage).some((k) => k.startsWith("vcfm-sw-reloaded-"))
  ));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 120000 });
  mark("booted");
  await page.fill("#input-manager", "Smoke");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150000 });
  mark("main-screen");

  const info = await page.evaluate(() => ({
    play: !!document.querySelector("#btn-play-match"),
    playDisabled: document.querySelector("#btn-play-match")?.disabled,
    advance: !!document.querySelector("#btn-advance"),
    advanceDisabled: document.querySelector("#btn-advance")?.disabled,
    advanceMatchday: !!document.querySelector("#btn-advance-matchday"),
    advanceMatchdayDisabled: document.querySelector("#btn-advance-matchday")?.disabled,
    nextMatchText: (document.querySelector("#next-match")?.innerText || "").slice(0, 120),
  }));
  console.log("CONTROLS " + JSON.stringify(info));
  mark("reported");

  // advance a few days and re-check
  for (let i = 0; i < 4; i++) {
    await page.click("#btn-advance").catch(() => {});
    await page.waitForTimeout(2500);
  }
  const info2 = await page.evaluate(() => ({
    playDisabled: document.querySelector("#btn-play-match")?.disabled,
    nextMatchText: (document.querySelector("#next-match")?.innerText || "").slice(0, 120),
  }));
  console.log("AFTER4 " + JSON.stringify(info2));
  mark("after4");

  console.log("ERRORS " + JSON.stringify(errors));
} finally {
  if (browser) await browser.close();
  server.kill();
}
