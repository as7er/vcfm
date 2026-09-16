// Measure the smoothness of the 2D match view.
//
// The user's report: players, ball and referee all appear to teleport rather than
// move, unlike FM. The existing continuity audits do not contradict that — they
// check the ENGINE state against a speed threshold and the DISPLAY against the
// engine, so a presentation that only redraws positions in coarse steps can pass
// both while looking steppy.
//
// So measure the thing the eye sees: sample the rendered position of every
// `.mp-player`, `.mp-ball` and `.mp-official` on every animation frame, and
// report the per-frame displacement distribution. Three signatures to look for:
//
//   · a large fraction of frames with ZERO movement  -> positions are only
//     written at the simulation rate while the renderer redraws faster; the
//     motion is a staircase even if each step is small
//   · a tail of large single-frame jumps             -> genuine teleports
//   · a low count of distinct positions per second   -> the effective update
//     rate is below the frame rate
//
// Usage: node scripts/_match-smoothness-probe.mjs [seconds]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8896;
const baseUrl = `http://127.0.0.1:${port}/`;
const seconds = Math.max(5, Number(process.argv[2]) || 25);

// stdout is block-buffered when redirected to a file, so a hung run shows nothing.
// Write progress markers straight to disk instead.
const PROGRESS = process.env.SMOOTH_PROGRESS || `${root}.tmp-continuity/smoothness-progress.log`;
const mark = (step) => {
  try { appendFileSync(PROGRESS, `${new Date().toISOString()} ${step}\n`); } catch { /* ignore */ }
};
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

// Installed in the page: record every frame's positions.
//
// Sample the VIEW's own coordinates (`matchView.players/ball/officials`), not the
// DOM style. The match view runs in `mp-canvas-mode`, where the DOM players are
// transparent hit zones and the visuals are painted on a canvas — so DOM `left/top`
// is not necessarily the drawn position. The view's x/y is what gets drawn.
const INSTALL = (ms) => {
  window.__smooth = { samples: [], done: false, until: performance.now() + ms, notes: [] };
  const mv = window.vcfmMainApi?.matchView;
  if (!mv) { window.__smooth.notes.push("matchView not exposed"); window.__smooth.done = true; return; }
  window.__smooth.canvasMode = !!document.querySelector(".mp-field.mp-canvas-mode");
  const canvas = document.querySelector(".mp-field canvas");
  const frame = () => {
    const now = performance.now();
    const s = {
      t: now,
      fsm: mv.fsm?.current?.() ?? null,
      simDrive: !!mv.simDrive,
      playing: !!mv._simPlay,
      simT: mv._simPlay?.simT ?? null,
      players: {},
      ball: null,
      officials: {},
      canvasSig: null,
    };
    for (const pl of mv.players || []) {
      s.players[pl.id] = [pl.x, pl.y];
    }
    if (mv.ball) s.ball = [mv.ball.x, mv.ball.y];
    for (const [role, o] of Object.entries(mv.officials || {})) {
      if (o && Number.isFinite(o.x)) s.officials[role] = [o.x, o.y];
    }
    // cheap non-blankness signature: sum of a sparse pixel sample
    if (canvas) {
      try {
        const ctx = canvas.getContext("2d");
        const w = canvas.width, h = canvas.height;
        const d = ctx.getImageData(0, 0, w, h).data;
        let acc = 0;
        for (let i = 0; i < d.length; i += 4096) acc = (acc + d[i] * (i % 251 + 1)) % 1000003;
        s.canvasSig = acc;
      } catch { /* tainted or no ctx */ }
    }
    window.__smooth.samples.push(s);
    if (now >= window.__smooth.until) { window.__smooth.done = true; return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

// Pitch scale: 100 field units across = 68 m, 100 down = 105 m.
const MX = 0.68;
const MY = 1.05;

function summarise(samples, pick, label) {
  const times = [];
  const pts = [];
  for (const s of samples) {
    const p = pick(s);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    times.push(s.t);
    pts.push(p);
  }
  if (pts.length < 3) return null;
  const steps = [];
  let zero = 0;
  const distinct = new Set();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = Math.hypot((b[0] - a[0]) * MX, (b[1] - a[1]) * MY);
    steps.push(d);
    if (d < 1e-9) zero++;
    distinct.add(`${b[0].toFixed(3)},${b[1].toFixed(3)}`);
  }
  const span = times[times.length - 1] - times[0];
  const secs = Math.max(1e-6, span / 1000);
  const sorted = [...steps].sort((x, y) => x - y);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    label,
    frames: pts.length,
    fps: +(pts.length / secs).toFixed(1),
    zeroMovePct: +((zero / steps.length) * 100).toFixed(1),
    distinctPerSec: +(distinct.size / secs).toFixed(1),
    stepMedianM: +q(0.5).toFixed(3),
    stepP95M: +q(0.95).toFixed(3),
    stepMaxM: +q(0.999).toFixed(3),
    jumpsOver1m: steps.filter((d) => d > 1).length,
    jumpsOver3m: steps.filter((d) => d > 3).length,
  };
}

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
  page.on("dialog", async (d) => { await d.accept(); });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (
    !("serviceWorker" in navigator) ||
    Object.keys(sessionStorage).some((k) => k.startsWith("vcfm-sw-reloaded-"))
  ));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 120_000 });
mark("booted");
  await page.fill("#input-manager", "Smoothness Probe");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
mark("main-screen");
  await page.waitForTimeout(1200);

  // Reach matchday, then kick off.
  mark("reaching matchday");
  for (let day = 0; day < 30; day++) {
    if (await page.locator("#btn-play-match").isEnabled().catch(() => false)) break;
    await page.click("#btn-advance").catch(() => {});
    await page.waitForTimeout(1500);
  }
  assert.ok(await page.locator("#btn-play-match").isEnabled(), "match never became playable");
  await page.click("#btn-play-match");
  mark("clicked play-match");
  await page.waitForSelector("#screen-match.active", { timeout: 60_000 });
  // The match screen opens in PRE_MATCH; #btn-sim-live (js/main.js:2339 -> runMatch("live"))
  // is what actually kicks off. Waiting on the FSM rather than a fixed sleep.
  await page.click("#btn-sim-live", { timeout: 30_000 });
  mark("clicked sim-live");
  const left = await page.waitForFunction(
    () => window.vcfmMainApi?.matchView?.fsm?.current?.() !== "PRE_MATCH",
    null, { timeout: 30_000 }
  ).then(() => true).catch(() => false);
  assert.ok(left, "match never left PRE_MATCH after #btn-sim-live");
  await page.waitForTimeout(4000);
  mark("post-kickoff wait done");

  console.log(JSON.stringify({ samplingSeconds: seconds }));
  await page.evaluate(INSTALL, seconds * 1000);
  await page.waitForFunction(() => window.__smooth?.done === true, null, { timeout: (seconds + 60) * 1000 });
  mark("sampling done");

  const raw = await page.evaluate(() => ({
    samples: window.__smooth.samples,
    canvasMode: window.__smooth.canvasMode,
    notes: window.__smooth.notes,
  }));
  console.log(JSON.stringify({ framesCaptured: raw.samples.length, canvasMode: raw.canvasMode, notes: raw.notes }));

  // What was the view doing while we sampled?
  const states = {};
  for (const s of raw.samples) {
    const k = `${s.fsm}|simDrive=${s.simDrive}|playing=${s.playing}`;
    states[k] = (states[k] || 0) + 1;
  }
  console.log(JSON.stringify({ viewStates: states }));
  const sigs = new Set(raw.samples.map((s) => s.canvasSig).filter((v) => v != null));
  console.log(JSON.stringify({ distinctCanvasSignatures: sigs.size }));
  const simTs = raw.samples.map((s) => s.simT).filter((v) => Number.isFinite(v));
  if (simTs.length > 1) {
    const adv = simTs[simTs.length - 1] - simTs[0];
    console.log(JSON.stringify({ simSecondsAdvanced: +adv.toFixed(2), simRate: +(adv / ((raw.samples[raw.samples.length - 1].t - raw.samples[0].t) / 1000)).toFixed(2) }));
  }

  const playerIds = [...new Set(raw.samples.flatMap((s) => Object.keys(s.players)))];
  const officialKeys = [...new Set(raw.samples.flatMap((s) => Object.keys(s.officials)))];
  const rows = [];
  rows.push(summarise(raw.samples, (s) => s.ball, "ball"));
  for (const id of playerIds.slice(0, 4)) rows.push(summarise(raw.samples, (s) => s.players[id], `player:${id}`));
  for (const k of officialKeys) rows.push(summarise(raw.samples, (s) => s.officials[k], `official:${k}`));

  const cols = ["label", "frames", "fps", "zeroMovePct", "distinctPerSec", "stepMedianM", "stepP95M", "stepMaxM", "jumpsOver1m", "jumpsOver3m"];
  console.log(cols.map((c) => c.padStart(15)).join(""));
  for (const r of rows) {
    if (!r) { console.log("(no samples for a track)"); continue; }
    console.log(cols.map((c) => String(r[c]).padStart(15)).join(""));
  }
  console.log(JSON.stringify({ pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
