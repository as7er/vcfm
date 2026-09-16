// How big are the inter-segment gaps over a WHOLE match?
//
// Why: `_segment-boundary-probe.mjs` caught one boundary with a 740 s sim-time
// gap and a 44.9 m median displacement, where all 26 entities jumped at once.
// One sample is not a distribution. The fix branches on the gap length
// (<= 20 s -> ease, > 20 s -> explicit cut), so the threshold has to be
// justified by what the gaps actually look like across a match.
//
// This probe instruments `playSimTimeline` itself rather than sampling from a
// rAF loop: a segment switch can happen between two frames, and a sampler
// would miss it.
//
// Usage: node scripts/_segment-gap-census.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8903;
const baseUrl = "http://127.0.0.1:" + port + "/";

const PROGRESS = root + ".tmp-continuity/gap-progress.log";
const mark = (step) => {
  try { appendFileSync(PROGRESS, new Date().toISOString() + " " + step + "\n"); } catch { /* ignore */ }
};
mark("start");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

const INSTALL = () => {
  const mv = window.vcfmMainApi?.matchView;
  window.__gap = { segs: [], installError: null };
  if (!mv) { window.__gap.installError = "no matchView"; return; }
  const orig = mv.playSimTimeline.bind(mv);
  let lastEnd = null;
  mv.playSimTimeline = function patched(frames, opts) {
    const t0 = frames?.[0]?.t ?? null;
    const t1 = frames?.[frames.length - 1]?.t ?? null;
    window.__gap.segs.push({
      label: opts?.label ?? null,
      n: frames?.length ?? 0,
      t0, t1,
      span: (Number.isFinite(t0) && Number.isFinite(t1)) ? +(t1 - t0).toFixed(1) : null,
      gapFromPrev: (Number.isFinite(t0) && Number.isFinite(lastEnd)) ? +(t0 - lastEnd).toFixed(1) : null,
    });
    if (Number.isFinite(t1)) lastEnd = t1;
    return orig(frames, opts);
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
  page.on("dialog", async (d) => { await d.accept(); });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (
    !("serviceWorker" in navigator) ||
    Object.keys(sessionStorage).some((k) => k.startsWith("vcfm-sw-reloaded-"))
  ));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 120_000 });
  mark("booted");
  await page.fill("#input-manager", "Gap Census");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  mark("main-screen");
  await page.waitForTimeout(1200);

  // Reach matchday. Click advance, then WAIT FOR THE DAY TO CHANGE rather than
  // assuming a fixed delay -- a single click advances one day, and the match
  // can be several days out.
  for (let day = 0; day < 40; day++) {
    if (await page.locator("#btn-play-match").isEnabled().catch(() => false)) break;
    const before = await page.evaluate(() => (document.querySelector("#next-match")?.innerText || ""));
    await page.click("#btn-advance").catch(() => {});
    await page
      .waitForFunction(
        (prev) => (document.querySelector("#next-match")?.innerText || "") !== prev,
        before, { timeout: 8000 }
      )
      .catch(() => {});
  }
  const playable = await page.locator("#btn-play-match").isEnabled().catch(() => false);
  mark("matchday playable=" + playable);
  assert.ok(playable, "match never became playable");
  await page.click("#btn-play-match");
  await page.waitForSelector("#screen-match.active", { timeout: 60_000 });
  await page.evaluate(INSTALL);
  mark("installed");
  await page.click("#btn-sim-live", { timeout: 30_000 });
  mark("clicked sim-live");

  // Play the whole match. Highlights mode skips the dull parts, so this is
  // bounded; poll for a stop condition rather than guessing a duration.
  const deadline = Date.now() + 8 * 60 * 1000;
  let finished = false;
  while (Date.now() < deadline && !finished) {
    await page.waitForTimeout(4000);
    const n = await page.evaluate(() => window.__gap.segs.length).catch(() => 0);
    const txt = await page.evaluate(() => (document.body.innerText || "").slice(0, 4000)).catch(() => "");
    finished = /FULL\s*TIME|全场结束|比赛结束|赛后/.test(txt);
    mark("segs=" + n + " finished=" + finished);
  }
  mark("loop-exit finished=" + finished);

  const raw = await page.evaluate(() => ({
    segs: window.__gap.segs, installError: window.__gap.installError,
  }));
  console.log("SEGMENTS " + raw.segs.length + " installError=" + raw.installError);
  for (const s of raw.segs) console.log(JSON.stringify(s));

  const gaps = raw.segs.map((s) => s.gapFromPrev).filter((g) => Number.isFinite(g) && g > 0);
  const buckets = {
    "<=0.5s": gaps.filter((g) => g <= 0.5).length,
    "0.5-20s": gaps.filter((g) => g > 0.5 && g <= 20).length,
    "20-60s": gaps.filter((g) => g > 20 && g <= 60).length,
    "60-180s": gaps.filter((g) => g > 60 && g <= 180).length,
    ">180s": gaps.filter((g) => g > 180).length,
  };
  const trueGaps = gaps.filter((g) => g > 0.5);
  const sorted = [...trueGaps].sort((a, b) => a - b);
  console.log("BUCKETS " + JSON.stringify(buckets));
  console.log("STATS " + JSON.stringify({
    trueGaps: trueGaps.length,
    gapMedian: sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(1) : null,
    gapP90: sorted.length ? +sorted[Math.floor(sorted.length * 0.9)].toFixed(1) : null,
    gapMax: sorted.length ? +sorted[sorted.length - 1].toFixed(1) : null,
  }));
  // Which side of the 20 s threshold do the real gaps fall on?
  const needsCut = trueGaps.filter((g) => g > 20).length;
  console.log("THRESHOLD " + JSON.stringify({
    cut: needsCut, ease: trueGaps.length - needsCut,
    cutPct: trueGaps.length ? +((needsCut / trueGaps.length) * 100).toFixed(0) : null,
  }));
  console.log("ERRORS " + JSON.stringify(errors));
} finally {
  if (browser) await browser.close();
  server.kill();
}
