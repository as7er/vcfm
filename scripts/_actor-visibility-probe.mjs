// Geometric reachability of the match-view actors.
//
// Established so far:
//   · `_match-smoothness-probe.mjs`  — players and ball move smoothly in view
//     coordinates (zeroMovePct 0.5-7%, no >3 m single-frame tails).
//   · `_official-smoothness-probe.mjs` — officials ALSO move smoothly
//     (referee 0.022 m per write at 59.7 writes/sec, no >3 m jumps), and the
//     occlusion test says the DOM dot is NOT covered by the canvas.
//
// So nothing is teleporting in *logical* space. That means the reported
// teleport must come from geometry: an actor that is drawn outside the visible
// pitch area pops in and out as the camera pans, which the eye reads as
// "teleported". The previous probe already showed the assistants failing the
// `insideField` containment test.
//
// This probe measures the visible pitch rect (the `.mp-camera` box, which is
// what actually paints the grass and the lines) and asks, for every actor,
// what fraction of frames it is inside that rect -- and how much of the actor's
// motion happens while it is off-rect (i.e. invisible then reappearing).
//
// Usage: node scripts/_actor-visibility-probe.mjs [seconds]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8898;
const baseUrl = `http://127.0.0.1:${port}/`;
const seconds = Math.max(5, Number(process.argv[2]) || 20);

const PROGRESS = `${root}.tmp-continuity/actor-vis-progress.log`;
const mark = (step) => {
  try { appendFileSync(PROGRESS, `${new Date().toISOString()} ${step}\n`); } catch { /* ignore */ }
};
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

const INSTALL = (ms) => {
  const mv = window.vcfmMainApi?.matchView;
  window.__vis = { samples: [], done: false, notes: [], until: performance.now() + ms };
  if (!mv) { window.__vis.notes.push("matchView not exposed"); window.__vis.done = true; return; }

  const frame = () => {
    const now = performance.now();
    const field = document.querySelector(".mp-field");
    const cam = document.querySelector(".mp-camera");
    const fr = field?.getBoundingClientRect();
    const cr = cam?.getBoundingClientRect();
    const actors = document.querySelector(".mp-actors")?.getBoundingClientRect();
    const s = { t: now, fsm: mv.fsm?.current?.() ?? null };
    if (fr && cr) {
      s.field = [+fr.left.toFixed(1), +fr.top.toFixed(1), +fr.width.toFixed(1), +fr.height.toFixed(1)];
      s.camera = [+cr.left.toFixed(1), +cr.top.toFixed(1), +cr.width.toFixed(1), +cr.height.toFixed(1)];
      s.actors = actors ? [+actors.left.toFixed(1), +actors.top.toFixed(1), +actors.width.toFixed(1), +actors.height.toFixed(1)] : null;
    }
    // every actor's painted centre, in page pixels
    s.ents = {};
    for (const pl of mv.players || []) {
      if (!pl.el) continue;
      const r = pl.el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      s.ents[`P:${pl.id}`] = [+(r.left + r.width / 2).toFixed(1), +(r.top + r.height / 2).toFixed(1), +r.width.toFixed(1)];
    }
    if (mv.ball) {
      const d = document.querySelector(".mp-ball");
      if (d) {
        const r = d.getBoundingClientRect();
        s.ents.ball = [+(r.left + r.width / 2).toFixed(1), +(r.top + r.height / 2).toFixed(1), +r.width.toFixed(1)];
      }
    }
    for (const k of ["referee", "assistantA", "assistantB"]) {
      const m = mv.officials?.[k];
      if (!m?.el) continue;
      const r = m.el.getBoundingClientRect();
      s.ents[`O:${k}`] = [+(r.left + r.width / 2).toFixed(1), +(r.top + r.height / 2).toFixed(1), +r.width.toFixed(1)];
    }
    // canvas ink: does the canvas actually cover the camera box?
    window.__vis.samples.push(s);
    if (now >= window.__vis.until) { window.__vis.done = true; return; }
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
  page.on("dialog", async (d) => { await d.accept(); });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (
    !("serviceWorker" in navigator) ||
    Object.keys(sessionStorage).some((k) => k.startsWith("vcfm-sw-reloaded-"))
  ));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 120_000 });
  mark("booted");
  await page.fill("#input-manager", "Actor Vis");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  mark("main-screen");
  await page.waitForTimeout(1200);
  for (let day = 0; day < 30; day++) {
    if (await page.locator("#btn-play-match").isEnabled().catch(() => false)) break;
    await page.click("#btn-advance").catch(() => {});
    await page.waitForTimeout(1500);
  }
  assert.ok(await page.locator("#btn-play-match").isEnabled(), "match never became playable");
  await page.click("#btn-play-match");
  await page.waitForSelector("#screen-match.active", { timeout: 60_000 });
  await page.click("#btn-sim-live", { timeout: 30_000 });
  mark("clicked sim-live");
  const left = await page.waitForFunction(
    () => window.vcfmMainApi?.matchView?.fsm?.current?.() !== "PRE_MATCH",
    null, { timeout: 30_000 }
  ).then(() => true).catch(() => false);
  assert.ok(left, "match never left PRE_MATCH");
  await page.waitForTimeout(4000);
  mark("post-kickoff");

  await page.evaluate(INSTALL, seconds * 1000);
  await page.waitForFunction(() => window.__vis?.done === true, null, { timeout: (seconds + 60) * 1000 });
  mark("sampling done");

  const raw = await page.evaluate(() => ({ samples: window.__vis.samples, notes: window.__vis.notes }));
  const S = raw.samples;
  console.log(JSON.stringify({ seconds, frames: S.length, notes: raw.notes }));

  // Geometry of the painted pitch vs the DOM actors layer.
  const geom = {};
  for (const s of S) {
    if (!s.camera) continue;
    geom.camera = s.camera;
    geom.field = s.field;
    geom.actors = s.actors;
  }
  console.log(JSON.stringify({ geometry: geom }));

  const camDrift = { minL: Infinity, maxL: -Infinity, minT: Infinity, maxT: -Infinity };
  for (const s of S) {
    if (!s.camera) continue;
    camDrift.minL = Math.min(camDrift.minL, s.camera[0]);
    camDrift.maxL = Math.max(camDrift.maxL, s.camera[0]);
    camDrift.minT = Math.min(camDrift.minT, s.camera[1]);
    camDrift.maxT = Math.max(camDrift.maxT, s.camera[1]);
  }
  console.log(JSON.stringify({
    cameraPanPx: {
      x: +(camDrift.maxL - camDrift.minL).toFixed(1),
      y: +(camDrift.maxT - camDrift.minT).toFixed(1),
    },
  }));

  // For each entity: fraction of frames inside the camera rect, and the number
  // of enter/exit transitions (a pop-in/pop-out reads as a teleport).
  const keys = [...new Set(S.flatMap((s) => Object.keys(s.ents || {})))];
  const rows = [];
  for (const k of keys) {
    let n = 0, inside = 0, transitions = 0, prev = null;
    let maxOff = 0;
    for (const s of S) {
      const e = s.ents?.[k];
      const c = s.camera;
      if (!e || !c) continue;
      const [x, y] = e;
      const ok = x >= c[0] && x <= c[0] + c[2] && y >= c[1] && y <= c[1] + c[3];
      n++;
      if (ok) inside++;
      if (prev !== null && prev !== ok) transitions++;
      prev = ok;
      if (!ok) {
        const dx = Math.max(c[0] - x, x - (c[0] + c[2]), 0);
        const dy = Math.max(c[1] - y, y - (c[1] + c[3]), 0);
        maxOff = Math.max(maxOff, Math.hypot(dx, dy));
      }
    }
    if (!n) continue;
    rows.push({
      key: k,
      frames: n,
      insidePct: +((inside / n) * 100).toFixed(1),
      inOutTransitions: transitions,
      maxOffPx: +maxOff.toFixed(1),
      widthPx: S.find((s) => s.ents?.[k])?.ents[k][2] ?? null,
    });
  }
  rows.sort((a, b) => a.insidePct - b.insidePct);
  const cols = ["key", "frames", "insidePct", "inOutTransitions", "maxOffPx", "widthPx"];
  console.log(cols.map((c) => c.padStart(20)).join(""));
  for (const r of rows) console.log(cols.map((c) => String(r[c]).padStart(20)).join(""));
  console.log(JSON.stringify({ pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
