// Trace every playSimTimeline entry with the exact inputs to `_enterSegmentTransition`.
//
// Two records in the earlier cut-verify run contradicted the design:
//   entry 1  mode "cut"  gapSec 0.1    (expected "first": that is the kick-off window)
//   entry 3  mode "first" gapSec null  (expected "cut": t0 = 217 is mid-match)
//
// Reading the source says both should be explainable without a reset bug:
//   * a goal segment plays, and then `playFmmGoalReplay` re-enters `playSimTimeline`
//     with `climax + 2` as its raw window end (matchview.js:5866). So `tEnd0` becomes
//     climax+2 rather than the real window end, and the replay itself rewinds to
//     climax-5.5. The rewind is DETECTED and intentional (matchview.js:578).
//     Our probe counts that re-entry as an entry, so the rewind shows up as a "gap".
//   * `_segLastEndSimT` is then left at climax+2, so a later window starting before
//     that sees `gap <= 0` -> mode "first".
//
// This probe records the raw `_segLastEndSimT` before each entry (null vs number) and
// samples `_relocLastSimT` every animation frame, so a replay cursor can be told apart
// from a genuine reset.
//
// Usage: node scripts/_segment-entry-trace.mjs [seconds]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8917;
const baseUrl = "http://127.0.0.1:" + port + "/";
const seconds = Math.max(30, Number(process.argv[2]) || 150);
const OUT = root + ".tmp-continuity/entry-trace.json";
const PROGRESS = root + ".tmp-continuity/entry-trace-progress.log";
const mark = (s) => { try { appendFileSync(PROGRESS, new Date().toISOString() + " " + s + "\n"); } catch { /* ignore */ } };
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

const INSTALL = (ms) => {
  const mv = window.vcfmMainApi?.matchView;
  window.__tr = { entries: [], samples: 0, done: false, notes: [], until: performance.now() + ms };
  if (!mv) { window.__tr.notes.push("no matchView"); window.__tr.done = true; return; }

  const fixed = (n) => (Number.isFinite(Number(n)) ? +Number(n).toFixed(2) : null);
  const rawOf = (v) => (v === null ? "null" : (Number.isFinite(Number(v)) ? "num" : String(v)));

  const origEnter = mv._enterSegmentTransition.bind(mv);
  mv._enterSegmentTransition = function patched(frames) {
    const prevBefore = mv._segLastEndSimT;
    const r = origEnter(frames);
    window.__tr.entries.push({
      label: mv._simPlay?.label ?? null,
      nFrames: frames?.length ?? 0,
      t0: fixed(frames?.[0]?.t),
      tEnd: fixed(frames?.[frames.length - 1]?.t),
      prevEnd: fixed(prevBefore),
      prevEndRaw: rawOf(prevBefore),
      gapSec: r.gapSec != null ? +r.gapSec.toFixed(2) : null,
      mode: r.mode,
      relocLastSimTAtEntry: fixed(mv._relocLastSimT),
      relocRawAtEntry: rawOf(mv._relocLastSimT),
    });
    return r;
  };

  const samples = [];
  const frame = () => {
    const now = performance.now();
    samples.push({
      w: +now.toFixed(0),
      reloc: fixed(mv._relocLastSimT),
      relocRaw: rawOf(mv._relocLastSimT),
      built: !!mv._built,
      segEnd: fixed(mv._segLastEndSimT),
    });
    window.__tr.samples++;
    if (now >= window.__tr.until) {
      window.__tr.samples_arr = samples.filter((_, i) => i % 15 === 0 || i < 5);
      window.__tr.done = true;
      return;
    }
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
  await page.fill("#input-manager", "Entry Trace");
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

  await page.waitForFunction(() => window.__tr?.done === true, null, { timeout: (seconds + 240) * 1000 });
  mark("done");

  const raw = await page.evaluate(() => ({
    entries: window.__tr.entries,
    samples: window.__tr.samples_arr || [],
    notes: window.__tr.notes,
  }));
  writeFileSync(OUT, JSON.stringify({ ...raw, errors, seconds }, null, 2));
  console.log("ENTRIES " + raw.entries.length + " -> " + OUT);
  for (const e of raw.entries) {
    console.log(
      "  " + String(e.label).padEnd(8) +
      " frames=" + String(e.nFrames).padStart(4) +
      " t0=" + String(e.t0).padStart(7) +
      " tEnd=" + String(e.tEnd).padStart(7) +
      " prevEnd=" + String(e.prevEnd).padStart(7) +
      " gap=" + String(e.gapSec).padStart(7) +
      " " + e.mode
    );
  }
  console.log("NOTES " + JSON.stringify(raw.notes));
  console.log("ERRORS " + JSON.stringify(errors));
} finally {
  if (browser) await browser.close();
  server.kill();
}
