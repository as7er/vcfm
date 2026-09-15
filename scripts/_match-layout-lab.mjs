// Candidate-CSS lab for the 2D match view layout.
//
// Boots one live match, then injects each candidate stylesheet in turn and
// re-measures every viewport. One page load, N candidates — the full probe
// (scripts/_match-mobile-layout-probe.mjs) takes ~2.5 min per run because it
// re-boots the app, which is far too slow to iterate with.
//
// What we are chasing:
//   * the pitch is drawn inside .mp-camera, which is inset 5.5% left/right so
//     the stands can show. Every aspect-ratio in the stylesheet is written as
//     if the *field* box were the pitch, so the pitch ends up 0.89x too narrow.
//     The centre circle's rendered w/h is the cleanest witness: it must be 1.0.
//   * .mp-field's height is derived from its width only, with no bound from the
//     available height, so on short viewports (landscape phone, tablet) the
//     field grows to ~950px inside a ~270px slot and the page turns into a
//     scroller.
//
// Usage:
//   node scripts/_match-layout-lab.mjs [outDir] [--shots]
//
// Reports per candidate: centre-circle w/h (1.0 = undistorted), field and
// camera box aspects, wrap-vs-root overflow, document overflow.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8894;
const baseUrl = `http://127.0.0.1:${port}/`;
const outArg = process.argv[2];
const out = outArg ? (isAbsolute(outArg) ? outArg : resolve(root, outArg)) : join(root, ".tmp-continuity", `match-layout-lab-${Date.now()}`);
const shots = process.argv.includes("--shots");
mkdirSync(out, { recursive: true });

// ── Candidate stylesheets ───────────────────────────────────────────────────
// Each entry is a full override block. Keep them small and additive: every
// candidate is measured against the same live page, so a candidate must be
// self-contained (no reliance on the previous one).
//
// NOTE ON SPECIFICITY: during a live match the layout carries .live-kick, and
// `.match-layout.live-kick .fmm-match-body .mp-field` (0,4,0) sets the aspect
// ratio and the flex sizing. A candidate that only writes `.mp-field {...}`
// silently loses on mobile. Every candidate below therefore repeats the real
// selectors.
const PITCH_RATIO = 68 / 93.45; // (68/105) / (1 - 2*0.055) = 0.7276
const RATIO = "68 / 93.45";

// The aspect ratio is declared in four places; all four must agree.
const RATIO_FIX = `
  .mp-field { aspect-ratio: ${RATIO}; }
  .fmm-match .mp-field { aspect-ratio: ${RATIO}; }
  .match-layout.pre-kickoff .fmm-match-body .mp-field,
  .match-pre-brief:not(.hidden) ~ .fmm-match-body .mp-field { aspect-ratio: ${RATIO}; }
  .match-layout.live-kick .fmm-match-body .mp-field,
  .match-layout.ht-kick .fmm-match-body .mp-field { aspect-ratio: ${RATIO}; }
`;

const CANDIDATES = [
  { id: "C0-baseline", css: "" },

  // Ratio only. Isolates how much of the distortion is the ratio bug.
  { id: "C5-ratio-only", css: RATIO_FIX },

  // Ratio + make the pitch height-driven everywhere, so it is sized by the
  // slot it is given instead of by its own width. Desktop column widened to
  // leave room for the (now wider) pitch.
  {
    id: "C6-ratio-fit",
    css: `
      ${RATIO_FIX}
      .match-pitch-root { flex: 1 1 0%; min-height: 0; }
      @media (max-width: 1059px) {
        .match-layout.live-kick .fmm-match-body,
        .match-layout.ht-kick .fmm-match-body { flex: 1 1 auto; min-height: 0; height: auto; }
        .match-layout.live-kick .fmm-match-body .fm-pitch-col,
        .match-layout.ht-kick .fmm-match-body .fm-pitch-col {
          flex: 1 1 auto; min-height: 0; height: auto; max-height: none;
        }
        .match-layout.live-kick .fmm-match-body .mp-wrap,
        .match-layout.ht-kick .fmm-match-body .mp-wrap { height: 100%; min-height: 0; }
        .match-layout.live-kick .fmm-match-body .mp-field,
        .match-layout.ht-kick .fmm-match-body .mp-field {
          flex: 1 1 auto; min-height: 0; height: auto;
          width: auto; max-width: 100%; margin-inline: auto;
        }
      }
      @media (min-width: 1060px) {
        .match-layout.live-kick .fmm-match-body .mp-field,
        .match-layout.ht-kick .fmm-match-body .mp-field {
          width: auto; height: 100%; max-width: 100%; margin-inline: auto;
        }
        .match-layout.fm-match.fmm-match {
          grid-template-columns: minmax(340px, calc((100vh - 250px) * 0.78)) minmax(300px, 1fr);
        }
      }
    `,
  },

  // Ratio + height-driven on desktop only; mobile keeps the current
  // "pitch keeps its size, page scrolls" behaviour.
  {
    id: "C7-ratio-desktop-fit",
    css: `
      ${RATIO_FIX}
      @media (min-width: 1060px) {
        .match-layout.live-kick .fmm-match-body .mp-field,
        .match-layout.ht-kick .fmm-match-body .mp-field {
          width: auto; height: 100%; max-width: 100%; margin-inline: auto;
        }
        .match-layout.fm-match.fmm-match {
          grid-template-columns: minmax(340px, calc((100vh - 250px) * 0.78)) minmax(300px, 1fr);
        }
      }
    `,
  },

  // Ratio + fit, with a floor so a landscape phone does not shrink the pitch
  // into a sliver: below 300px of slot the field keeps a readable size and the
  // page scrolls again.
  {
    id: "C8-ratio-fit-floor",
    css: `
      ${RATIO_FIX}
      .match-pitch-root { flex: 1 1 0%; min-height: 0; }
      @media (max-width: 1059px) {
        .match-layout.live-kick .fmm-match-body,
        .match-layout.ht-kick .fmm-match-body { flex: 1 1 auto; min-height: 0; height: auto; }
        .match-layout.live-kick .fmm-match-body .fm-pitch-col,
        .match-layout.ht-kick .fmm-match-body .fm-pitch-col {
          flex: 1 1 auto; min-height: 0; height: auto; max-height: none;
        }
        .match-layout.live-kick .fmm-match-body .mp-wrap,
        .match-layout.ht-kick .fmm-match-body .mp-wrap { height: 100%; min-height: 0; }
        .match-layout.live-kick .fmm-match-body .mp-field,
        .match-layout.ht-kick .fmm-match-body .mp-field {
          flex: 1 1 auto; min-height: 300px; height: auto;
          width: auto; max-width: 100%; margin-inline: auto;
        }
      }
      @media (min-width: 1060px) {
        .match-layout.live-kick .fmm-match-body .mp-field,
        .match-layout.ht-kick .fmm-match-body .mp-field {
          width: auto; height: 100%; max-width: 100%; margin-inline: auto;
        }
        .match-layout.fm-match.fmm-match {
          grid-template-columns: minmax(340px, calc((100vh - 250px) * 0.78)) minmax(300px, 1fr);
        }
      }
    `,
  },
];

const VIEWPORTS = [
  { label: "phone-small", width: 360, height: 640 },
  { label: "phone", width: 390, height: 844 },
  { label: "phone-tall", width: 414, height: 896 },
  { label: "phone-landscape", width: 844, height: 390 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 1000 },
];

function measure() {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      w: el.clientWidth, h: el.clientHeight,
      aspect: el.clientHeight ? Number((el.clientWidth / el.clientHeight).toFixed(4)) : null,
      offsetH: el.offsetHeight,
    };
  };
  const circle = document.querySelector(".mp-lines ellipse");
  const cr = circle ? circle.getBoundingClientRect() : null;
  const field = box("#mp-field");
  const cam = box("#mp-camera");
  const wrap = box(".mp-wrap");
  const rootBox = box("#match-pitch-root");
  const canvas = document.querySelector("#mp-canvas");
  return {
    field, camera: cam, wrap, root: rootBox,
    canvasBacking: canvas ? { w: canvas.width, h: canvas.height } : null,
    canvasAspect: canvas ? Number((canvas.width / canvas.height).toFixed(4)) : null,
    circleWOverH: cr ? Number((cr.width / cr.height).toFixed(4)) : null,
    circleW: cr ? Number(cr.width.toFixed(1)) : null,
    circleH: cr ? Number(cr.height.toFixed(1)) : null,
    wrapOverflow: wrap && rootBox ? wrap.h - rootBox.h : null,
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    docOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  };
}

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
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
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90000 });
  await page.fill("#input-manager", "Layout Lab");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 90000 });

  let matchReady = false;
  for (let day = 0; day < 30 && !matchReady; day++) {
    matchReady = await page.locator("#btn-play-match").isEnabled();
    if (matchReady) break;
    const before = await page.locator("#date-label").innerText().catch(() => "");
    await page.click("#btn-advance").catch(() => {});
    // Simulating a whole league day can take a while, and this is the flakiest
    // part of the boot. Re-click on a slow day instead of failing the run — the
    // measurements afterwards are what we came for.
    try {
      await page.waitForFunction((d) => document.querySelector("#date-label")?.textContent !== d, before, { timeout: 45000 });
    } catch { /* slow day or missed click: retry */ }
  }
  assert.ok(matchReady, "no match became playable within 25 days");
  await page.click("#btn-play-match");
  await page.waitForSelector("#screen-match.active", { timeout: 60000 });
  await page.click("#btn-sim-live");
  await page.waitForSelector("#mp-canvas", { timeout: 60000 });
  await page.waitForTimeout(2500);

  // One dedicated <style> node we rewrite per candidate.
  await page.evaluate(() => {
    const s = document.createElement("style");
    s.id = "lab-css";
    document.head.appendChild(s);
  });

  const table = [];
  for (const cand of CANDIDATES) {
    await page.evaluate((css) => {
      document.querySelector("#lab-css").textContent = css;
    }, cand.css);
    const rows = {};
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(700);
      rows[vp.label] = await page.evaluate(measure);
      if (shots) {
        await page.screenshot({ path: join(out, `lab-${cand.id}-${vp.label}.png`) });
      }
    }
    table.push({ id: cand.id, rows });
    // Compact console table: circle roundness and fit are the two things that matter.
    for (const vp of VIEWPORTS) {
      const r = rows[vp.label];
      console.log([
        cand.id.padEnd(20),
        vp.label.padEnd(17),
        `circle ${String(r.circleWOverH).padEnd(7)}`,
        `field ${r.field.w}x${r.field.h}(${r.field.aspect})`,
        `cam(${r.camera.aspect})`,
        `wrapOver ${String(r.wrapOverflow).padStart(5)}`,
        `docY ${r.docOverflowY}`,
      ].join("  "));
    }
  }
  writeFileSync(join(out, "lab.json"), `${JSON.stringify({ errors, table }, null, 2)}\n`);
  console.log(JSON.stringify({ out, pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
