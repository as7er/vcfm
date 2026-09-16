// Verify the segment-entry cut actually fires.
//
// The fix adds `_enterSegmentTransition` -> `_playSegmentCut`, which puts
// `.mp-seg-cut` on `.mp-field` for 260 ms whenever a highlight segment starts
// more than a frame after the previous one ended. Whole-match census says every
// real gap is 129.5-956.8 sim-seconds, so every non-first segment should cut.
//
// This probe checks three things:
//   1. the class really appears at segment entries (and only there)
//   2. the mode reported by `_enterSegmentTransition` is 'cut' for real gaps
//   3. the first segment of a match reports 'first' (no gratuitous flash at kick-off)
//
// It also watches for the failure mode the fix could introduce: if the cut
// class got stuck on, the pitch would stay dark.
//
// Usage: node scripts/_segment-cut-verify.mjs [seconds]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8911;
const baseUrl = "http://127.0.0.1:" + port + "/";
const seconds = Math.max(20, Number(process.argv[2]) || 60);

const PROGRESS = root + ".tmp-continuity/cut-progress.log";
const mark = (s) => { try { appendFileSync(PROGRESS, new Date().toISOString() + " " + s + "\n"); } catch { /* ignore */ } };
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

const INSTALL = (ms) => {
  const mv = window.vcfmMainApi?.matchView;
  window.__cut = { entries: [], classSeen: 0, classStuck: 0, samples: 0, done: false, notes: [], until: performance.now() + ms };
  if (!mv) { window.__cut.notes.push("no matchView"); window.__cut.done = true; return; }

  const origEnter = mv._enterSegmentTransition.bind(mv);
  mv._enterSegmentTransition = function patched(frames) {
    const r = origEnter(frames);
    const el = document.querySelector(".mp-field");
    window.__cut.entries.push({
      mode: r.mode,
      gapSec: r.gapSec != null ? +r.gapSec.toFixed(1) : null,
      t0: frames?.[0]?.t ?? null,
      hasClass: !!el?.classList.contains("mp-seg-cut"),
    });
    return r;
  };

  const frame = () => {
    const now = performance.now();
    const el = document.querySelector(".mp-field");
    const has = !!el?.classList.contains("mp-seg-cut");
    window.__cut.samples++;
    if (has) window.__cut.classSeen++;
    // a cut should never last more than ~400ms; count long runs as "stuck"
    if (has) {
      window.__cut._run = (window.__cut._run || 0) + 1;
      if (window.__cut._run > 60) window.__cut.classStuck++;
    } else {
      window.__cut._run = 0;
    }
    if (now >= window.__cut.until) { window.__cut.done = true; return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
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
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", async (d) => { await d.accept(); });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (
    !("serviceWorker" in navigator) ||
    Object.keys(sessionStorage).some((k) => k.startsWith("vcfm-sw-reloaded-"))
  ));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 120_000 });
  mark("booted");
  await page.fill("#input-manager", "Cut Verify");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  mark("main-screen");

  for (let day = 0; day < 40; day++) {
    if (await page.locator("#btn-play-match").isEnabled().catch(() => false)) break;
    const before = await page.evaluate(() => (document.querySelector("#next-match")?.innerText || ""));
    await page.click("#btn-advance").catch(() => {});
    await page.waitForFunction(
      (prev) => (document.querySelector("#next-match")?.innerText || "") !== prev,
      before, { timeout: 8000 }
    ).catch(() => {});
  }
  assert.ok(await page.locator("#btn-play-match").isEnabled(), "match never became playable");
  mark("matchday");
  await page.click("#btn-play-match");
  await page.waitForSelector("#screen-match.active", { timeout: 60_000 });
  await page.evaluate(INSTALL, seconds * 1000);
  mark("installed");
  await page.click("#btn-sim-live", { timeout: 30_000 });
  mark("sim-live");

  await page.waitForFunction(() => window.__cut?.done === true, null, { timeout: (seconds + 180) * 1000 });
  mark("done");

  const raw = await page.evaluate(() => ({
    entries: window.__cut.entries, classSeen: window.__cut.classSeen,
    classStuck: window.__cut.classStuck, samples: window.__cut.samples, notes: window.__cut.notes,
  }));
  console.log("ENTRIES " + JSON.stringify(raw.entries));
  console.log("CLASS " + JSON.stringify({
    framesWithCutClass: raw.classSeen, totalFrames: raw.samples,
    pct: raw.samples ? +((raw.classSeen / raw.samples) * 100).toFixed(1) : null,
    stuckRuns: raw.classStuck,
  }));
  const modes = raw.entries.map((e) => e.mode);
  console.log("MODES " + JSON.stringify({
    first: modes.filter((m) => m === "first").length,
    cut: modes.filter((m) => m === "cut").length,
    ease: modes.filter((m) => m === "ease").length,
  }));
  console.log("NOTES " + JSON.stringify(raw.notes));
  console.log("ERRORS " + JSON.stringify(errors));
} finally {
  if (browser) await browser.close();
  server.kill();
}
