// Mobile/desktop layout probe for the 2D match view.
//
// Opens a real match, then walks a list of viewports and records, per viewport:
//   - document overflow, and every element whose right edge escapes the viewport
//   - the box of every structural piece of the match screen
//   - the pitch canvas CSS size vs its backing-store size (DPR handling)
//   - the rendered aspect ratio of the pitch box against 68/105 = 0.6476, the
//     only ratio that keeps the SVG's non-isotropic 100x150 coordinate system
//     from squashing the pitch, plus the centre circle's rendered w/h
//   - text that renders below a readable size, and tap targets below ~40 px
//
// Usage:
//   node scripts/_match-mobile-layout-probe.mjs [outDir]
//
// Writes layout-<w>x<h>.json plus a screenshot per viewport.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8893;
const baseUrl = `http://127.0.0.1:${port}/`;
// A relative outDir must resolve against the repo root, not against this
// script's directory — `new URL(relative, import.meta.url)` would otherwise
// quietly write into scripts/.
//
// Keep this a plain path string: the sandboxed fs broker rejects URL objects
// with ERR_INVALID_URL_SCHEME, and mkdirSync(URL) dies before the first write.
const outArg = process.argv[2];
const out = outArg
  ? (isAbsolute(outArg) ? outArg : resolve(root, outArg))
  : join(root, ".tmp-continuity", `match-layout-${Date.now()}`);
mkdirSync(out, { recursive: true });
console.log(JSON.stringify({ out }));

const VIEWPORTS = [
  { label: "phone-small", width: 360, height: 640 },
  { label: "phone", width: 390, height: 844 },
  { label: "phone-tall", width: 414, height: 896 },
  { label: "phone-landscape", width: 844, height: 390 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 1000 },
];

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

function measureScript() {
  const seen = [];
  const rectOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      display: cs.display, overflowX: cs.overflowX, overflowY: cs.overflowY,
      fontSize: cs.fontSize,
    };
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Anything sticking out to the right of the viewport.
  const overflowing = [];
  for (const el of document.querySelectorAll("#screen-match *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || "").slice(0, 60),
        id: el.id || "",
        left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
      });
    }
  }

  // Text that will be hard to read, and controls that are hard to tap.
  const tinyText = [];
  const smallTargets = [];
  for (const el of document.querySelectorAll("#screen-match *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText) {
      const px = parseFloat(cs.fontSize);
      if (px && px < 11) tinyText.push({ id: el.id, cls: String(el.className || "").slice(0, 50), px });
    }
    if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") {
      if (r.height < 40 || r.width < 40) {
        smallTargets.push({ id: el.id, cls: String(el.className || "").slice(0, 50), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
  }

  const canvas = document.querySelector("#mp-canvas");
  let canvasInfo = null;
  if (canvas) {
    const r = canvas.getBoundingClientRect();
    canvasInfo = {
      cssW: Math.round(r.width), cssH: Math.round(r.height),
      attrW: canvas.width, attrH: canvas.height,
      cssAspect: Number((r.width / r.height).toFixed(4)),
      backingAspect: Number((canvas.width / canvas.height).toFixed(4)),
      dpr: window.devicePixelRatio,
    };
  }

  const wrap = document.querySelector(".mp-wrap");
  let wrapInfo = null;
  if (wrap) {
    const r = wrap.getBoundingClientRect();
    wrapInfo = { w: Math.round(r.width), h: Math.round(r.height), aspect: Number((r.width / r.height).toFixed(4)) };
  }

  // ── Pitch geometry ────────────────────────────────────────────────────────
  // The pitch is drawn in a 100 x 150 SVG coordinate system whose axes are NOT
  // isotropic: x spans 68 m over 100 units, y spans 105 m over 150 units. A
  // circle of r metres is rx = r/68*100, ry = r/105*150. For it to look round,
  // the SVG box must satisfy W/H = 68/105 = 0.6476. Anything else is a stretch,
  // and because the pitch SVG uses preserveAspectRatio="none" nothing warns you.
  const layout = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      sel,
      clientW: el.clientWidth, clientH: el.clientHeight,
      // untransformed layout box: compare this, not getBoundingClientRect,
      // because the camera applies a uniform scale + translate.
      aspect: el.clientHeight ? Number((el.clientWidth / el.clientHeight).toFixed(4)) : null,
      offsetW: el.offsetWidth, offsetH: el.offsetHeight,
      cssAspect: cs.aspectRatio, left: cs.left, right: cs.right, top: cs.top, bottom: cs.bottom,
      inset: cs.inset, position: cs.position, transform: cs.transform, overflow: cs.overflow,
    };
  };

  const pitchSvg = document.querySelector(".mp-lines") || document.querySelector("#mp-camera svg");
  let pitchSvgInfo = null;
  if (pitchSvg) {
    const r = pitchSvg.getBoundingClientRect();
    pitchSvgInfo = {
      cls: String(pitchSvg.getAttribute("class") || ""),
      viewBox: pitchSvg.getAttribute("viewBox"),
      preserveAspectRatio: pitchSvg.getAttribute("preserveAspectRatio"),
      clientW: pitchSvg.clientWidth, clientH: pitchSvg.clientHeight,
      layoutAspect: pitchSvg.clientHeight ? Number((pitchSvg.clientWidth / pitchSvg.clientHeight).toFixed(4)) : null,
      rectW: Math.round(r.width), rectH: Math.round(r.height),
    };
  }

  // Roundness check: the centre circle is the cleanest witness. Its element box
  // is square in SVG units (rx/ry are chosen so it *should* render round), so
  // the rendered rect's w/h ratio is the stretch factor directly.
  const circle = document.querySelector(".mp-lines ellipse");
  let circleInfo = null;
  if (circle) {
    const r = circle.getBoundingClientRect();
    circleInfo = {
      rx: circle.getAttribute("rx"), ry: circle.getAttribute("ry"),
      rectW: Number(r.width.toFixed(2)), rectH: Number(r.height.toFixed(2)),
      wOverH: Number((r.width / r.height).toFixed(4)),
    };
  }

  // The camera transform: a uniform scale + translate keeps shapes, a
  // non-uniform one distorts. Report both scale factors.
  const cam = document.querySelector("#mp-camera");
  let cameraInfo = null;
  if (cam) {
    const m = new DOMMatrixReadOnly(getComputedStyle(cam).transform);
    cameraInfo = {
      layoutW: cam.offsetWidth, layoutH: cam.offsetHeight,
      scaleX: Number(Math.hypot(m.a, m.b).toFixed(4)),
      scaleY: Number(Math.hypot(m.c, m.d).toFixed(4)),
      translateX: Number(m.e.toFixed(2)), translateY: Number(m.f.toFixed(2)),
    };
  }

  return {
    viewport: { w: vw, h: vh },
    document: {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
    },
    boxes: [
      "#match-header", "#match-live-stats", "#match-pitch-root", ".mp-wrap", ".mp-boards",
      "#match-log", "#match-main-actions", "#match-live-tac", "#match-com-toggle",
      "#mp-fmm-dock", ".fmm-match-bar", ".match-transport", ".match-speed-bar",
      ".match-camera-bar", ".mp-poss-bar", ".mp-jersey-row",
    ].map(rectOf).filter(Boolean),
    layoutBoxes: ["#mp-field", "#mp-camera", ".mp-canvas"].map(layout).filter(Boolean),
    canvas: canvasInfo,
    wrap: wrapInfo,
    pitchSvg: pitchSvgInfo,
    centreCircle: circleInfo,
    camera: cameraInfo,
    pitchAspectTarget: Number((105 / 68).toFixed(4)),
    overflowing,
    tinyText,
    smallTargets,
  };
}

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
  await page.fill("#input-manager", "Layout Probe");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 90000 });

  let matchReady = false;
  for (let day = 0; day < 30 && !matchReady; day++) {
    matchReady = await page.locator("#btn-play-match").isEnabled();
    if (matchReady) break;
    const before = await page.locator("#date-label").innerText().catch(() => "");
    await page.click("#btn-advance").catch(() => {});
    // Simulating a league day can be slow, and this is the flakiest part of the
    // boot; re-click instead of failing the whole run.
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

  const results = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(1200);
    const data = await page.evaluate(measureScript);
    data.label = vp.label;
    const stem = `layout-${vp.label}-${vp.width}x${vp.height}`;
    await page.screenshot({ path: join(out, `${stem}.png`) });
    writeFileSync(join(out, `${stem}.json`), `${JSON.stringify(data, null, 2)}\n`);
    results.push(data);
    console.log(JSON.stringify({
      viewport: vp.label, size: `${vp.width}x${vp.height}`,
      overflowX: data.document.overflowX,
      field: data.layoutBoxes.find((b) => b.sel === "#mp-field"),
      camera: data.camera,
      cameraBox: data.layoutBoxes.find((b) => b.sel === "#mp-camera"),
      canvas: data.canvas,
      pitchSvg: data.pitchSvg,
      centreCircle: data.centreCircle,
      pitchAspectTarget: data.pitchAspectTarget,
      overflowingCount: data.overflowing.length,
      tinyTextCount: data.tinyText.length,
      smallTargetCount: data.smallTargets.length,
    }));
  }
  writeFileSync(join(out, "layout-all.json"), `${JSON.stringify({ errors, results }, null, 2)}\n`);
  console.log(JSON.stringify({ pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
