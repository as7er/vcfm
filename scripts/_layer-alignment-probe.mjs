// Do the canvas layer and the DOM actor layer agree on where a field coordinate is?
//
// Architecture recovered by reading the code:
//   .mp-field  (aspect-ratio 68/93.45)
//   └ .mp-camera  (left/right 5.5%, transform: translate(x%,y%) scale(s))
//       ├ .mp-grass/.mp-lines/... (the pitch art, in 0-100 %)
//       ├ canvas.mp-canvas      (players + ball, painted with px=(x/100)*_cw)
//       └ .mp-actors            (officials, positioned with left/top percentages)
//
// Both children live inside the same transformed box, so they should agree. But
// `_resizeCanvas()` sizes the backing buffer from `fieldEl.clientWidth/Height`
// while the canvas element itself is inset:0 of `.mp-camera`. If those two boxes
// differ, the canvas art is horizontally stretched relative to the DOM dots and
// the ball visibly separates from the players.
//
// This probe measures, at a known field coordinate, where each layer actually
// paints -- so a mismatch shows up as numbers rather than as an opinion.
//
// Usage: node scripts/_layer-alignment-probe.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8899;
const baseUrl = `http://127.0.0.1:${port}/`;

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

const PROBE = () => {
  const mv = window.vcfmMainApi?.matchView;
  if (!mv) return { error: "no matchView" };
  const field = document.querySelector(".mp-field");
  const cam = document.querySelector(".mp-camera");
  const canvas = document.querySelector("canvas.mp-canvas");
  const actors = document.querySelector(".mp-actors");
  const fr = field.getBoundingClientRect();
  const cr = cam.getBoundingClientRect();
  const ar = actors.getBoundingClientRect();
  const cs = getComputedStyle(cam);
  const fr2 = canvas.getBoundingClientRect();
  return {
    fieldRect: [fr.left, fr.top, fr.width, fr.height].map((v) => +v.toFixed(2)),
    cameraRect: [cr.left, cr.top, cr.width, cr.height].map((v) => +v.toFixed(2)),
    actorsRect: [ar.left, ar.top, ar.width, ar.height].map((v) => +v.toFixed(2)),
    canvasRect: [fr2.left, fr2.top, fr2.width, fr2.height].map((v) => +v.toFixed(2)),
    cameraTransform: cs.transform,
    cameraLeftRight: [cs.left, cs.right],
    // what the canvas thinks its drawing surface is
    canvasBuffer: [canvas.width, canvas.height],
    canvasCssSize: [canvas.clientWidth, canvas.clientHeight],
    canvasLogical: [mv._cw, mv._ch],
    fieldClient: [field.clientWidth, field.clientHeight],
    cameraClient: [cam.clientWidth, cam.clientHeight],
    // a field coordinate -> where each layer puts it (page px)
    sample: (() => {
      const X = 25, Y = 25; // field units
      // DOM layers use left/top % of their own box
      const domX = ar.left + (X / 100) * ar.width;
      const domY = ar.top + (Y / 100) * ar.height;
      // canvas maps x/100 * _cw into its own box
      const cvX = fr2.left + (X / 100) * fr2.width;
      const cvY = fr2.top + (Y / 100) * fr2.height;
      return { X, Y, domX: +domX.toFixed(2), domY: +domY.toFixed(2), cvX: +cvX.toFixed(2), cvY: +cvY.toFixed(2), dx: +(cvX - domX).toFixed(2), dy: +(cvY - domY).toFixed(2) };
    })(),
    // empirical: put a real player and the ball where they are and compare
    empirical: (() => {
      const out = [];
      for (const pl of (mv.players || []).slice(0, 3)) {
        if (!pl.el) continue;
        const r = pl.el.getBoundingClientRect();
        out.push({ id: pl.id, x: pl.x, y: pl.y, domCentre: [+(r.left + r.width / 2).toFixed(1), +(r.top + r.height / 2).toFixed(1)] });
      }
      return out;
    })(),
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
  await page.fill("#input-manager", "Layer Align");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  await page.waitForTimeout(1200);
  for (let day = 0; day < 30; day++) {
    if (await page.locator("#btn-play-match").isEnabled().catch(() => false)) break;
    await page.click("#btn-advance").catch(() => {});
    await page.waitForTimeout(1500);
  }
  assert.ok(await page.locator("#btn-play-match").isEnabled(), "match never became playable");
  await page.click("#btn-play-match");
  await page.waitForSelector("#screen-match.active", { timeout: 60_000 });

  // PRE_MATCH geometry (camera at rest, scale 1 - isolates pure CSS geometry)
  await page.waitForTimeout(1500);
  const pre = await page.evaluate(PROBE);
  console.log(JSON.stringify({ phase: "PRE_MATCH (camera at rest)", ...pre }, null, 1));

  await page.click("#btn-sim-live", { timeout: 30_000 });
  await page.waitForFunction(
    () => window.vcfmMainApi?.matchView?.fsm?.current?.() !== "PRE_MATCH",
    null, { timeout: 30_000 }
  );
  await page.waitForTimeout(6000);
  const live = await page.evaluate(PROBE);
  console.log(JSON.stringify({ phase: "LIVE (camera panning/zooming)", ...live }, null, 1));
  console.log(JSON.stringify({ pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
