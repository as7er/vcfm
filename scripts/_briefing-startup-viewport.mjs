// Pre-match briefing: startup-viewport vs resized-viewport control.
//
// Question under test (handoff 2026-09-16 §2): is the "briefing panel crushed
// to 2 px" reading on phone/tablet a REAL defect, or an artifact of measuring
// AFTER resizing down from 1440x1000?
//
// Method: boot the game twice over the same code, differing ONLY in how the
// phone viewport is reached.
//   arm A (startup)  : the page is created at 390x844 and never resized.
//   arm B (resized)  : the page is created at 1440x1000, driven to the
//                      pre-kickoff state, and THEN resized to 390x844.
// Both arms measure #match-pre-brief clientHeight/scrollHeight plus every
// ancestor's flex params, with no transient page reload between drive and
// measure in either arm.
//
// Usage:
//   node scripts/_briefing-startup-viewport.mjs [outDir]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8896;
const baseUrl = `http://127.0.0.1:${port}/`;
const outArg = process.argv[2];
const out = outArg
  ? (isAbsolute(outArg) ? outArg : resolve(root, outArg))
  : join(root, ".tmp-continuity", `briefing-startup-${Date.now()}`);
mkdirSync(out, { recursive: true });
console.log(JSON.stringify({ out }));

const TARGET = { width: 390, height: 844 };
const BASELINE = { width: 1440, height: 1000 };

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

function measureScript() {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel,
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      offsetH: el.offsetHeight,
      rectH: Math.round(r.height),
      rectTop: Math.round(r.top),
      rectBottom: Math.round(r.bottom),
      flexGrow: cs.flexGrow,
      flexShrink: cs.flexShrink,
      flexBasis: cs.flexBasis,
      minHeight: cs.minHeight,
      maxHeight: cs.maxHeight,
      overflowY: cs.overflowY,
    };
  };
  const panel = document.querySelector("#match-pre-brief");
  const parent = panel?.parentElement;
  const chain = [];
  for (let el = panel; el && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el);
    chain.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || "").slice(0, 60),
      display: cs.display,
      flexGrow: cs.flexGrow,
      flexShrink: cs.flexShrink,
      flexBasis: cs.flexBasis,
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      overflowY: cs.overflowY,
      maxHeight: cs.maxHeight,
    });
  }
  return {
    viewport: { w: vw, h: vh },
    panelClass: String(panel?.className || ""),
    panelHidden: panel?.classList.contains("hidden") ?? null,
    layoutClass: String(document.querySelector(".match-layout")?.className || ""),
    preBrief: pick("#match-pre-brief"),
    briefBody: pick("#match-pre-brief .prematch-brief"),
    matchBody: pick(".fmm-match-body"),
    field: pick(".mp-field"),
    fieldAspectWorks: (() => {
      const f = document.querySelector(".mp-field");
      if (!f) return null;
      const r = f.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? +(r.width / r.height).toFixed(3) : null;
    })(),
    parentDisplay: parent ? getComputedStyle(parent).display : null,
    parentIsGrid: parent ? getComputedStyle(parent).display === "grid" : null,
    panelFitsViewport: panel ? (() => {
      const r = panel.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= vh + 1;
    })() : null,
    ancestorChain: chain,
    docScroll: {
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
    },
  };
}

async function boot(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (
    !("serviceWorker" in navigator) ||
    Object.keys(sessionStorage).some((k) => k.startsWith("vcfm-sw-reloaded-"))
  ));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90000 });
  await page.fill("#input-manager", "Startup Probe");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 90000 });
  let matchReady = false;
  for (let day = 0; day < 30 && !matchReady; day++) {
    matchReady = await page.locator("#btn-play-match").isEnabled();
    if (matchReady) break;
    const before = await page.locator("#date-label").innerText().catch(() => "");
    await page.click("#btn-advance").catch(() => {});
    try {
      await page.waitForFunction((d) => document.querySelector("#date-label")?.textContent !== d, before, { timeout: 45000 });
    } catch { /* retry */ }
  }
  assert.ok(matchReady, "no match became playable within 30 days");
  await page.click("#btn-play-match");
  await page.waitForSelector("#screen-match.active", { timeout: 60000 });
  await page.waitForSelector("#match-pre-brief", { timeout: 60000 });
  await page.waitForTimeout(2000);
  // Give the pre-kickoff pitch a moment to lay out (it mounts async).
  await page.waitForSelector(".mp-field", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

function patchForms(page) {
  return page.evaluate(() => {
    const makeStrip = (arr) => {
      const cells = [];
      for (let i = 0; i < 5; i++) {
        const r = arr[i];
        if (!r) cells.push('<span class="form-cell none" title="—">·</span>');
        else if (r === "W") cells.push('<span class="form-cell win" title="Win">W</span>');
        else if (r === "L") cells.push('<span class="form-cell loss" title="Loss">L</span>');
        else cells.push('<span class="form-cell draw" title="Draw">D</span>');
      }
      return '<span class="form-strip">' + cells.join("") + "</span>";
    };
    const strips = document.querySelectorAll("#match-pre-brief .form-strip");
    const data = [["W", "W", "D", "L", "W"], ["L", "D", "L", "W", "L"]];
    strips.forEach((s, i) => { s.outerHTML = makeStrip(data[i] || data[0]); });
    return strips.length;
  });
}

let browser;
const report = { arms: {}, agreement: null, errors: [] };
try {
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    try { ready = (await fetch(baseUrl)).ok; } catch { /* retry */ }
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "preview server did not start");

  browser = await chromium.launch({ channel: "msedge", headless: true });

  // ── Arm A: page created AT the phone viewport, never resized ──
  {
    const page = await browser.newPage({ viewport: TARGET });
    page.on("pageerror", (e) => report.errors.push(`A:${e.message}`));
    page.on("dialog", async (d) => { await d.accept(); });
    await boot(page);
    const strips = await patchForms(page);
    await page.waitForTimeout(600);
    const data = await page.evaluate(measureScript);
    data.formStrips = strips;
    await page.screenshot({ path: join(out, "armA-startup-phone.png"), fullPage: false });
    report.arms.startup = data;
    await page.close();
  }

  // ── Arm B: page created at desktop, driven there, THEN resized ──
  {
    const page = await browser.newPage({ viewport: BASELINE });
    page.on("pageerror", (e) => report.errors.push(`B:${e.message}`));
    page.on("dialog", async (d) => { await d.accept(); });
    await boot(page);
    const strips = await patchForms(page);
    await page.waitForTimeout(600);
    const beforeResize = await page.evaluate(measureScript);
    await page.setViewportSize(TARGET);
    await page.waitForTimeout(1500);
    const data = await page.evaluate(measureScript);
    data.beforeResize = beforeResize;
    data.formStrips = strips;
    await page.screenshot({ path: join(out, "armB-resized-phone.png"), fullPage: false });
    report.arms.resized = data;
    await page.close();
  }

  const a = report.arms.startup;
  const b = report.arms.resized;
  report.agreement = {
    startupPanelClientH: a.preBrief?.clientH ?? null,
    resizedPanelClientH: b.preBrief?.clientH ?? null,
    matchesProbeReading: b.preBrief?.clientH === 2,
    sameAsStartup: (a.preBrief?.clientH ?? -1) === (b.preBrief?.clientH ?? -2),
    startupPanelScrollH: a.preBrief?.scrollH ?? null,
    resizedPanelScrollH: b.preBrief?.scrollH ?? null,
    startupFieldAspect: a.fieldAspectWorks,
    resizedFieldAspect: b.fieldAspectWorks,
  };
  writeFileSync(join(out, "startup-vs-resized.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.agreement, null, 2));
  console.log(JSON.stringify({ pageErrors: report.errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
