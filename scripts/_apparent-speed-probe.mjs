// Apparent SPEED of the match view, not its smoothness.
//
// Why this probe exists
// ---------------------
// Three probes have now measured smoothness and all cleared it:
//   · `_match-smoothness-probe.mjs`     — players/ball: zeroMovePct 0.5-7%, no >3 m tails
//   · `_official-smoothness-probe.mjs`  — officials: 0.022 m per write @ 59.7/s
//   · `_actor-visibility-probe.mjs`     — every actor 100% inside the camera rect
//   · `_layer-alignment-probe.mjs`      — canvas and DOM layers agree to 0.00 px
//
// So the interpolation is mathematically correct. But the user still says actors
// "teleport". The variable none of those probes measured is TIME SCALE: if the
// simulation clock advances many times faster than the wall clock, a perfectly
// smooth 7 m/s run crosses the pitch in a fraction of a second and the eye
// cannot track it -- which is exactly what "teleport" feels like.
//
// This probe measures sim-seconds per wall-second, and converts every actor's
// perceived speed into real-world m/s.
//
// Usage: node scripts/_apparent-speed-probe.mjs [seconds]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8900;
const baseUrl = `http://127.0.0.1:${port}/`;
const seconds = Math.max(5, Number(process.argv[2]) || 15);

const PROGRESS = `${root}.tmp-continuity/speed-progress.log`;
const mark = (step) => {
  try { appendFileSync(PROGRESS, `${new Date().toISOString()} ${step}\n`); } catch { /* ignore */ }
};
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

const INSTALL = (ms) => {
  const mv = window.vcfmMainApi?.matchView;
  window.__spd = { samples: [], done: false, notes: [], until: performance.now() + ms };
  if (!mv) { window.__spd.notes.push("no matchView"); window.__spd.done = true; return; }
  const frame = () => {
    const now = performance.now();
    const s = { t: now, fsm: mv.fsm?.current?.() ?? null, simT: mv._simPlay?.simT ?? null, sp: null };
    // what playback parameters is the timeline currently using?
    const sp = mv._simPlay;
    if (sp) {
      s.sp = {
        speed: typeof sp.getSpeed === "function" ? sp.getSpeed() : null,
        paused: typeof sp.isPaused === "function" ? sp.isPaused() : null,
        rate: sp.rate,
        rateMul: sp.rateMul,
        i: sp.i,
        frames: sp.frames?.length ?? null,
      };
    }
    s.ents = {};
    for (const pl of mv.players || []) {
      if (Number.isFinite(pl.x)) s.ents[`P:${pl.id}`] = [pl.x, pl.y];
    }
    if (mv.ball) s.ents.ball = [mv.ball.x, mv.ball.y];
    for (const k of ["referee", "assistantA", "assistantB"]) {
      const m = mv.officials?.[k];
      if (m && Number.isFinite(m.x)) s.ents[`O:${k}`] = [m.x, m.y];
    }
    window.__spd.samples.push(s);
    if (now >= window.__spd.until) { window.__spd.done = true; return; }
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
  await page.fill("#input-manager", "Speed Probe");
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
  await page.waitForFunction(
    () => window.vcfmMainApi?.matchView?.fsm?.current?.() !== "PRE_MATCH",
    null, { timeout: 30_000 }
  );
  await page.waitForTimeout(3000);
  mark("post-kickoff");

  await page.evaluate(INSTALL, seconds * 1000);
  await page.waitForFunction(() => window.__spd?.done === true, null, { timeout: (seconds + 60) * 1000 });
  mark("sampling done");

  const raw = await page.evaluate(() => ({ samples: window.__spd.samples, notes: window.__spd.notes }));
  const S = raw.samples;
  console.log(JSON.stringify({ seconds, frames: S.length, notes: raw.notes }));

  // ---- time scale -------------------------------------------------------
  const wall0 = S[0].t, wall1 = S[S.length - 1].t;
  const wallSec = (wall1 - wall0) / 1000;
  const sims = S.map((s) => s.simT).filter((v) => Number.isFinite(v));
  const simSec = sims.length > 1 ? sims[sims.length - 1] - sims[0] : null;
  console.log(JSON.stringify({
    wallSeconds: +wallSec.toFixed(2),
    simSeconds: simSec != null ? +simSec.toFixed(2) : null,
    simRate: simSec != null ? +(simSec / wallSec).toFixed(2) : null,
  }));

  // playback parameters actually in force
  const sps = S.map((s) => s.sp).filter(Boolean);
  if (sps.length) {
    const uniq = {};
    for (const sp of sps) {
      const k = `speed=${sp.speed}|rate=${sp.rate}|rateMul=${sp.rateMul}|paused=${sp.paused}`;
      uniq[k] = (uniq[k] || 0) + 1;
    }
    console.log(JSON.stringify({ playbackParams: uniq }));
    const rates = sps.map((s) => s.rate).filter(Number.isFinite);
    const muls = sps.map((s) => s.rateMul).filter(Number.isFinite);
    const spds = sps.map((s) => s.speed).filter(Number.isFinite);
    console.log(JSON.stringify({
      rateMedian: rates.length ? rates.sort((a, b) => a - b)[Math.floor(rates.length / 2)] : null,
      rateMulMedian: muls.length ? muls.sort((a, b) => a - b)[Math.floor(muls.length / 2)] : null,
      speedMedian: spds.length ? spds.sort((a, b) => a - b)[Math.floor(spds.length / 2)] : null,
    }));
  }

  // ---- per-entity apparent speed ---------------------------------------
  const keys = [...new Set(S.flatMap((s) => Object.keys(s.ents || {})))];
  const rows = [];
  for (const k of keys) {
    const pts = [];
    for (const s of S) {
      const p = s.ents?.[k];
      if (p) pts.push({ t: s.t, simT: s.simT, x: p[0], y: p[1] });
    }
    if (pts.length < 5) continue;
    const speeds = [];
    const simSpeeds = [];
    let span = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dWall = (b.t - a.t) / 1000;
      if (dWall <= 1e-6) continue;
      // field units -> metres (x: 0.68, y: 1.05)
      const dM = Math.hypot((b.x - a.x) * 0.68, (b.y - a.y) * 1.05);
      speeds.push(dM / dWall);
      const dSim = (b.simT ?? 0) - (a.simT ?? 0);
      if (Number.isFinite(dSim) && dSim > 1e-6) simSpeeds.push(dM / dSim);
      span += dWall;
    }
    if (!speeds.length) continue;
    const sorted = [...speeds].sort((x, y) => x - y);
    const q = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(2);
    const ss = [...simSpeeds].sort((x, y) => x - y);
    const qs = (p) => ss.length ? +ss[Math.min(ss.length - 1, Math.floor(p * ss.length))].toFixed(2) : null;
    rows.push({
      key: k.length > 22 ? k.slice(0, 22) : k,
      samples: pts.length,
      wallMpsMedian: q(0.5),
      wallMpsP95: q(0.95),
      wallMpsMax: +sorted[sorted.length - 1].toFixed(2),
      simMpsMedian: qs(0.5),
      simMpsP95: qs(0.95),
    });
  }
  rows.sort((a, b) => b.wallMpsMedian - a.wallMpsMedian);
  const cols = ["key", "samples", "wallMpsMedian", "wallMpsP95", "wallMpsMax", "simMpsMedian", "simMpsP95"];
  console.log(cols.map((c) => c.padStart(15)).join(""));
  console.log("  (wallMps = metres covered per WALL second -- what the eye sees)");
  console.log("  (simMps  = metres covered per SIM second  -- physical plausibility)");
  for (const r of rows.slice(0, 26)) console.log(cols.map((c) => String(r[c]).padStart(15)).join(""));
  console.log(JSON.stringify({ pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
