// Why do officials look like they teleport?
//
// `_match-smoothness-probe.mjs` cleared players and ball (zeroMovePct 0.5-7%,
// no real tails) but the user reports the referee as teleporting too. Two
// candidate mechanisms are distinguishable by instrumentation rather than by
// reading the code:
//
//   H1 — officials are DOM `.mp-official` elements (z-index 2) while players
//        and the ball are drawn on the canvas (z-index 3). If the canvas is
//        opaque, the officials are simply HIDDEN, and what the user sees is
//        three dots appearing/disappearing — which reads as teleporting.
//   H2 — `_applyOfficials()` writes `left/top` on every call, so each call
//        moves them; but the "sceneCut" branch in `moveTo()` snaps them to the
//        target outright, so any scene cut is a genuine multi-metre jump.
//
// This probe answers both: it checks whether the official element is actually
// painted (hit-test / visibility / occlusion by canvas), and it separates the
// per-call displacement into "smooth" and "sceneCut snap" buckets.
//
// Usage: node scripts/_official-smoothness-probe.mjs [seconds]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8897;
const baseUrl = `http://127.0.0.1:${port}/`;
const seconds = Math.max(5, Number(process.argv[2]) || 20);

const PROGRESS = `${root}.tmp-continuity/official-progress.log`;
const mark = (step) => {
  try { appendFileSync(PROGRESS, `${new Date().toISOString()} ${step}\n`); } catch { /* ignore */ }
};
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

// ---------------------------------------------------------------------------
// Page-side install.
//
// We hook `applySimSnapshot` so we can tag each call with whether it is a
// scene cut, and record the official's position on every call. Then we also
// record what the RENDERER actually paints -- by reading the element's
// computed style AND by hit-testing the point where the official should be
// (if the canvas covers it, elementFromPoint returns the canvas, not the dot).
// ---------------------------------------------------------------------------
const INSTALL = (ms) => {
  const mv = window.vcfmMainApi?.matchView;
  window.__off = { calls: [], samples: [], done: false, notes: [], until: performance.now() + ms };
  if (!mv) { window.__off.notes.push("matchView not exposed"); window.__off.done = true; return; }

  const proj = (x, y) => ({ x: x * 0.68, y: y * 1.05 }); // field units -> metres

  // Instrument the per-call write.
  const origApply = mv._applyOfficials.bind(mv);
  mv._applyOfficials = function patched() {
    const o = mv.officials || {};
    const rec = { t: performance.now(), simT: mv._officialsSimT, marks: {} };
    for (const k of ["referee", "assistantA", "assistantB"]) {
      const m = o[k];
      if (m && Number.isFinite(m.x)) rec.marks[k] = [m.x, m.y];
    }
    window.__off.calls.push(rec);
    if (window.__off.calls.length > 20000) window.__off.calls.shift();
    return origApply();
  };

  // Who is on top at the referee's own position? If the canvas occludes the
  // DOM dot, `elementFromPoint` will not return the dot's element.
  const probeOcclusion = () => {
    const out = {};
    const o = mv.officials || {};
    const field = document.querySelector(".mp-field");
    const canvas = document.querySelector("canvas.mp-canvas");
    if (!field) return out;
    const fr = field.getBoundingClientRect();
    for (const k of ["referee", "assistantA", "assistantB"]) {
      const m = o[k];
      if (!m?.el) { out[k] = "no-element"; continue; }
      const er = m.el.getBoundingClientRect();
      const cx = er.left + er.width / 2;
      const cy = er.top + er.height / 2;
      // style visibility chain
      const cs = getComputedStyle(m.el);
      const visible = cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.01;
      const top = document.elementFromPoint(cx, cy);
      let topKind = top ? top.tagName.toLowerCase() + "." + (top.className || "") : "null";
      out[k] = {
        visible,
        opacity: cs.opacity,
        rect: { l: +er.left.toFixed(1), t: +er.top.toFixed(1), w: +er.width.toFixed(1), h: +er.height.toFixed(1) },
        insideField: er.left >= fr.left - 1 && er.right <= fr.right + 1 && er.top >= fr.top - 1 && er.bottom <= fr.bottom + 1,
        hit: topKind.slice(0, 60),
        hitIsSelf: top === m.el || m.el.contains(top),
      };
    }
    out.canvas = canvas ? { z: getComputedStyle(canvas).zIndex, firstPx: (() => {
      try {
        const c = canvas.getContext("2d");
        const d = c.getImageData(0, 0, Math.min(4, canvas.width), Math.min(4, canvas.height)).data;
        return [d[0], d[1], d[2], d[3]];
      } catch { return null; }
    })() } : null;
    out.zIndex = {
      canvas: canvas ? getComputedStyle(canvas).zIndex : null,
      actors: (() => {
        const a = document.querySelector(".mp-actors");
        return a ? getComputedStyle(a).zIndex : null;
      })(),
      official: o.referee?.el ? getComputedStyle(o.referee.el).zIndex : null,
    };
    return out;
  };

  // Read back the official's transform-affected paint rectangle each frame.
  const frame = () => {
    const now = performance.now();
    const o = mv.officials || {};
    const s = { t: now, fsm: mv.fsm?.current?.() ?? null, marks: {}, rects: {} };
    for (const k of ["referee", "assistantA", "assistantB"]) {
      const m = o[k];
      if (!m || !Number.isFinite(m.x)) continue;
      s.marks[k] = [m.x, m.y];
      if (m.el) {
        const r = m.el.getBoundingClientRect();
        s.rects[k] = [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)];
      }
    }
    // also record ball and first player for reference
    s.ball = mv.ball ? [mv.ball.x, mv.ball.y] : null;
    s.ballState = mv.ballState ?? null;
    s.playCentre = mv._playCentre ? [mv._playCentre.x, mv._playCentre.y] : null;
    window.__off.samples.push(s);
    if (window.__off.samples.length % 120 === 0) {
      window.__off.occlusion = probeOcclusion();
    }
    if (now >= window.__off.until) { window.__off.done = true; return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

function summariseCalls(calls, key) {
  const pts = [];
  for (const c of calls) {
    const m = c.marks[key];
    if (m) pts.push({ t: c.t, x: m[0], y: m[1] });
  }
  if (pts.length < 3) return null;
  const steps = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dt = (b.t - a.t) / 1000;
    const d = Math.hypot((b.x - a.x) * 0.68, (b.y - a.y) * 1.05);
    steps.push({ d, dt });
  }
  const ds = steps.map((s) => s.d);
  const sorted = [...ds].sort((a, b) => a - b);
  const q = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(3);
  const span = (pts[pts.length - 1].t - pts[0].t) / 1000;
  return {
    key,
    writes: pts.length,
    writesPerSec: +(pts.length / Math.max(1e-6, span)).toFixed(1),
    metersPerWriteMedian: q(0.5),
    metersPerWriteP95: q(0.95),
    metersPerWriteMax: +sorted[sorted.length - 1].toFixed(3),
    zeroMovePct: +((ds.filter((d) => d < 1e-9).length / ds.length) * 100).toFixed(1),
    over1m: ds.filter((d) => d > 1).length,
    over3m: ds.filter((d) => d > 3).length,
    over6m: ds.filter((d) => d > 6).length,
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
  await page.fill("#input-manager", "Official Probe");
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
  await page.waitForFunction(() => window.__off?.done === true, null, { timeout: (seconds + 60) * 1000 });
  mark("sampling done");

  const raw = await page.evaluate(() => ({
    calls: window.__off.calls,
    samples: window.__off.samples,
    occlusion: window.__off.occlusion || null,
    notes: window.__off.notes,
  }));
  console.log(JSON.stringify({ samplingSeconds: seconds, writes: raw.calls.length, frames: raw.samples.length, notes: raw.notes }));
  console.log(JSON.stringify({ occlusion: raw.occlusion }, null, 1));

  for (const k of ["referee", "assistantA", "assistantB"]) {
    const s = summariseCalls(raw.calls, k);
    console.log(JSON.stringify(s));
  }

  // Per-frame VISIBLE rect displacement (what the eye actually sees) - this
  // catches CSS-transition / paint-rate effects that the write rate misses.
  for (const k of ["referee", "assistantA", "assistantB"]) {
    const pts = [];
    for (const s of raw.samples) {
      const r = s.rects?.[k];
      const m = s.marks?.[k];
      if (r && m) pts.push({ t: s.t, rx: r[0], ry: r[1], x: m[0], y: m[1], fsm: s.fsm });
    }
    if (pts.length < 3) { console.log(JSON.stringify({ key: k, visible: null })); continue; }
    const ds = [];
    let domZero = 0;
    let markZero = 0;
    const jumps = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dDom = Math.hypot(b.rx - a.rx, b.ry - a.ry) / 1000; // px -> "screen kpx"; keep raw px below
      const dMark = Math.hypot((b.x - a.x) * 0.68, (b.y - a.y) * 1.05);
      ds.push(Math.hypot(b.rx - a.rx, b.ry - a.ry));
      if (Math.hypot(b.rx - a.rx, b.ry - a.ry) < 1e-9) domZero++;
      if (dMark < 1e-9) markZero++;
      if (dMark > 3) jumps.push({ t: b.t, m: +dMark.toFixed(2), fsm: b.fsm });
    }
    const sorted = [...ds].sort((x, y) => x - y);
    const q = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(3);
    console.log(JSON.stringify({
      key: k,
      frames: pts.length,
      domZeroMovePct: +((domZero / ds.length) * 100).toFixed(1),
      markZeroMovePct: +((markZero / ds.length) * 100).toFixed(1),
      domStepMedianPx: q(0.5),
      domStepP95Px: q(0.95),
      domStepMaxPx: q(0.999),
      domJumpsOver10px: ds.filter((d) => d > 10).length,
      markJumpsOver3m: jumps.length,
      firstJumps: jumps.slice(0, 8),
    }));
  }
  console.log(JSON.stringify({ pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
