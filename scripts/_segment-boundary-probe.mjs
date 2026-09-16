// Measure the displacement at highlight-segment ENTRY.
//
// The chain of evidence so far:
//   · smoothness probe      — players/ball smooth WITHIN a segment
//   · official probe        — officials smooth WITHIN a segment
//   · visibility probe      — no actor leaves the camera rect
//   · layer-alignment probe — canvas and DOM agree to 0.00 px
//   · timeline-frames probe — simPerWall 1.005, frame gap exactly 0.1 s,
//                             zero gaps > 1 s  => playback is correct
//
// So the playback inside a segment is right. The remaining candidate is the
// boundary BETWEEN segments: `playSimTimeline` opens with
//     this.applySimSnapshot(frames[0], { soft: false });      (matchview.js:809)
// which is a hard snap. And a highlight window starts 8 s before the goal, so
// that snap is to a completely different part of the pitch than wherever the
// previous segment ended.
//
// This probe watches every `_simPlay` transition and records, at the instant of
// the switch, how far each actor moved on screen. A segment boundary should
// show a large, instantaneous displacement for most actors -- if it does, that
// is the teleport the user is reporting.
//
// Usage: node scripts/_segment-boundary-probe.mjs [seconds]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8902;
const baseUrl = `http://127.0.0.1:${port}/`;
const seconds = Math.max(10, Number(process.argv[2]) || 20);

const PROGRESS = `${root}.tmp-continuity/seg-progress.log`;
const mark = (step) => {
  try { appendFileSync(PROGRESS, `${new Date().toISOString()} ${step}\n`); } catch { /* ignore */ }
};
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

const INSTALL = (ms) => {
  const mv = window.vcfmMainApi?.matchView;
  window.__seg = { events: [], done: false, notes: [], until: performance.now() + ms };
  if (!mv) { window.__seg.notes.push("no matchView"); window.__seg.done = true; return; }

  const snap = () => {
    const o = {};
    for (const pl of mv.players || []) if (Number.isFinite(pl.x)) o[`P:${pl.id}`] = [pl.x, pl.y];
    if (mv.ball) o.ball = [mv.ball.x, mv.ball.y];
    for (const k of ["referee", "assistantA", "assistantB"]) {
      const m = mv.officials?.[k];
      if (m && Number.isFinite(m.x)) o[`O:${k}`] = [m.x, m.y];
    }
    return o;
  };

  let lastSp = null;
  let prev = snap();
  let prevSp = mv._simPlay;
  const frame = () => {
    const now = performance.now();
    const sp = mv._simPlay;
    const cur = snap();
    // segment identity change?
    const switched = sp !== prevSp;
    if (switched) {
      // displacement at the boundary: current positions vs the last frame before
      const deltas = [];
      for (const k of Object.keys(cur)) {
        const a = prev[k];
        if (!a) continue;
        const d = Math.hypot((cur[k][0] - a[0]) * 0.68, (cur[k][1] - a[1]) * 1.05);
        deltas.push({ k: k.length > 18 ? k.slice(0, 18) : k, m: +d.toFixed(2) });
      }
      deltas.sort((x, y) => y.m - x.m);
      const vals = deltas.map((d) => d.m);
      const sorted = [...vals].sort((a, b) => a - b);
      window.__seg.events.push({
        t: now,
        kind: switched === true && !sp ? "segment-end" : (!prevSp && sp ? "segment-start" : "segment-change"),
        from: prevSp ? { label: prevSp.label, i: prevSp.i, simT: +(prevSp.simT || 0).toFixed(2), n: prevSp.frames?.length } : null,
        to: sp ? { label: sp.label, i: sp.i, simT: +(sp.simT || 0).toFixed(2), n: sp.frames?.length, t0: sp.frames?.[0]?.t ?? null } : null,
        movedCount: deltas.length,
        movedOver1m: vals.filter((v) => v > 1).length,
        movedOver3m: vals.filter((v) => v > 3).length,
        medianM: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(2) : null,
        maxM: sorted.length ? +sorted[sorted.length - 1].toFixed(2) : null,
        top: deltas.slice(0, 5),
      });
      prevSp = sp;
    }
    prev = cur;
    if (now >= window.__seg.until) { window.__seg.done = true; return; }
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
  await page.fill("#input-manager", "Segment Boundary");
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
  await page.waitForTimeout(1500);
  mark("post-kickoff");

  await page.evaluate(INSTALL, seconds * 1000);
  await page.waitForFunction(() => window.__seg?.done === true, null, { timeout: (seconds + 120) * 1000 });
  mark("sampling done");

  const raw = await page.evaluate(() => ({ events: window.__seg.events, notes: window.__seg.notes }));
  console.log(JSON.stringify({ seconds, boundaryEvents: raw.events.length, notes: raw.notes }));
  for (const e of raw.events) {
    console.log(JSON.stringify({
      kind: e.kind,
      from: e.from,
      to: e.to,
      movedCount: e.movedCount,
      movedOver1m: e.movedOver1m,
      movedOver3m: e.movedOver3m,
      medianM: e.medianM,
      maxM: e.maxM,
      top5: e.top,
    }));
  }
  console.log(JSON.stringify({ pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
