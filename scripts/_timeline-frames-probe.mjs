// Dump the actual timeline frame list that the live match plays.
//
// The whole "teleport" investigation now hinges on one question that no probe
// has answered directly: what do the timestamps in `matchView._simPlay.frames`
// actually look like, and how fast does the view walk through them?
//
// If the gaps between consecutive frames are ~0.1 s and the timeline consumes
// them at ~1x, the playback is correct and the complaint must be about
// something else (e.g. camera motion, or a contrast/size issue).
//
// If some gaps are seconds long, the view linearly interpolates across them --
// every entity then slides at a constant, unphysical speed, which reads as a
// teleport.
//
// This probe samples the live timeline once, reporting the frame list, the
// index cursor, and the frame-to-frame gap distribution.
//
// Usage: node scripts/_timeline-frames-probe.mjs [seconds]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8901;
const baseUrl = `http://127.0.0.1:${port}/`;
const seconds = Math.max(5, Number(process.argv[2]) || 12);

const PROGRESS = `${root}.tmp-continuity/tlf-progress.log`;
const mark = (step) => {
  try { appendFileSync(PROGRESS, `${new Date().toISOString()} ${step}\n`); } catch { /* ignore */ }
};
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

// Sample the timeline cursor every frame: (wall time, simT, frame index i,
// and the two bracketing frame timestamps).
const INSTALL = (ms) => {
  const mv = window.vcfmMainApi?.matchView;
  window.__tlf = { samples: [], segments: [], done: false, notes: [], until: performance.now() + ms };
  if (!mv) { window.__tlf.notes.push("no matchView"); window.__tlf.done = true; return; }
  let lastSp = null;
  const frame = () => {
    const now = performance.now();
    const sp = mv._simPlay;
    if (sp) {
      if (sp !== lastSp) {
        lastSp = sp;
        const fr = sp.frames || [];
        const ts = fr.map((f) => f.t ?? null);
        const gaps = [];
        for (let i = 1; i < ts.length; i++) {
          if (Number.isFinite(ts[i]) && Number.isFinite(ts[i - 1])) gaps.push(+(ts[i] - ts[i - 1]).toFixed(4));
        }
        const sorted = [...gaps].sort((a, b) => a - b);
        const q = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null;
        window.__tlf.segments.push({
          frameCount: fr.length,
          tFirst: ts[0] ?? null,
          tLast: ts[ts.length - 1] ?? null,
          spanSec: (Number.isFinite(ts[0]) && Number.isFinite(ts[ts.length - 1])) ? +(ts[ts.length - 1] - ts[0]).toFixed(2) : null,
          gapMin: q(0),
          gapMedian: q(0.5),
          gapP95: q(0.95),
          gapMax: sorted.length ? sorted[sorted.length - 1] : null,
          gapsOver1s: gaps.filter((g) => g > 1).length,
          gapsOver5s: gaps.filter((g) => g > 5).length,
          label: sp.label ?? null,
          rate: sp.rate,
        });
      }
      const fr = sp.frames || [];
      const a = fr[sp.i];
      const b = fr[Math.min(sp.i + 1, fr.length - 1)];
      window.__tlf.samples.push({
        t: now,
        simT: sp.simT,
        i: sp.i,
        n: fr.length,
        tA: a?.t ?? null,
        tB: b?.t ?? null,
        gap: (Number.isFinite(a?.t) && Number.isFinite(b?.t)) ? +(b.t - a.t).toFixed(4) : null,
        rate: sp.rate,
        rateMul: sp.rateMul,
        speed: typeof sp.getSpeed === "function" ? sp.getSpeed() : null,
        hold: now < (sp.holdUntil || 0),
      });
    }
    if (now >= window.__tlf.until) { window.__tlf.done = true; return; }
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
  await page.fill("#input-manager", "Timeline Frames");
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
  await page.waitForTimeout(2500);
  mark("post-kickoff");

  await page.evaluate(INSTALL, seconds * 1000);
  await page.waitForFunction(() => window.__tlf?.done === true, null, { timeout: (seconds + 60) * 1000 });
  mark("sampling done");

  const raw = await page.evaluate(() => ({
    samples: window.__tlf.samples, segments: window.__tlf.segments, notes: window.__tlf.notes,
  }));
  console.log(JSON.stringify({ seconds, frames: raw.samples.length, segments: raw.segments.length, notes: raw.notes }));
  console.log("=== timeline segments played during the sample ===");
  for (const s of raw.segments) console.log(JSON.stringify(s));

  // Playback rate measured WITHIN a segment (i.e. while i only increases).
  // A naive last-first diff is wrong across segment restarts, which is what
  // produced the bogus "12.6x" reading earlier -- so compute per run.
  const S = raw.samples;
  const runs = [];
  let cur = [];
  for (let k = 0; k < S.length; k++) {
    const s = S[k];
    if (s.tA == null) continue;
    if (cur.length && (cur[cur.length - 1].simT > s.simT + 1e-6)) { runs.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) runs.push(cur);
  console.log("=== playback rate per contiguous run ===");
  for (const r of runs) {
    if (r.length < 4) continue;
    const wall = (r[r.length - 1].t - r[0].t) / 1000;
    const sim = r[r.length - 1].simT - r[0].simT;
    const iAdv = r[r.length - 1].i - r[0].i;
    console.log(JSON.stringify({
      wallSec: +wall.toFixed(2),
      simSec: +sim.toFixed(2),
      simPerWall: wall > 0 ? +(sim / wall).toFixed(3) : null,
      framesConsumed: iAdv,
      framesPerWallSec: wall > 0 ? +(iAdv / wall).toFixed(1) : null,
      avgGapSec: iAdv > 0 ? +(sim / iAdv).toFixed(4) : null,
      holds: r.filter((x) => x.hold).length,
      rate: r[0].rate, rateMul: r[0].rateMul, speed: r[0].speed,
    }));
  }
  // how long is a single consumed frame worth, in held vs normal play
  const normal = S.filter((s) => !s.hold && s.gap != null);
  const held = S.filter((s) => s.hold && s.gap != null);
  const stat = (arr) => {
    if (!arr.length) return null;
    const g = arr.map((x) => x.gap).sort((a, b) => a - b);
    return { n: arr.length, min: g[0], median: g[Math.floor(g.length / 2)], max: g[g.length - 1] };
  };
  console.log(JSON.stringify({ gapWhilePlaying: stat(normal), gapWhileHeld: stat(held) }));
  console.log(JSON.stringify({ pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
