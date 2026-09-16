// Pre-match briefing layout probe.
//
// Boots the game, opens the match screen WITHOUT starting the match (the
// pre-kickoff state where #match-pre-brief is on screen), then per viewport:
//   - geometry of every structural piece (scoreboard, briefing panel, pitch,
//     commentary, dock)
//   - elements escaping the viewport horizontally
//   - elements clipped inside their scroll container (scrollWidth > clientWidth
//     +1 or scrollHeight > clientHeight +1 while overflow is not visible)
//   - sibling overlaps inside the briefing panel
//   - tiny text (<11px)
//   - form-strip validation: exactly 5 cells per side, no overlap, all visible
//
// Usage:
//   node scripts/_briefing-layout-probe.mjs [outDir] [theme]
//   theme: dark (default) | light | both
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8895;
const baseUrl = `http://127.0.0.1:${port}/`;
const outArg = process.argv[2];
const out = outArg
  ? (isAbsolute(outArg) ? outArg : resolve(root, outArg))
  : join(root, ".tmp-continuity", `briefing-layout-${Date.now()}`);
mkdirSync(out, { recursive: true });
console.log(JSON.stringify({ out }));

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 1000 },
  { label: "laptop", width: 1280, height: 800 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "phone", width: 390, height: 844 },
  { label: "phone-small", width: 360, height: 640 },
];

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

function measureScript() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const rectOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      sel,
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      bottom: Math.round(r.bottom), right: Math.round(r.right),
    };
  };

  // Elements escaping the viewport horizontally.
  const overflowing = [];
  for (const el of document.querySelectorAll("#screen-match *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || "").slice(0, 70),
        id: el.id || "",
        left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
      });
    }
  }

  // Content clipped by a scroll container (visible overflow is intentional
  // for chips etc., so only flag hidden/clip/auto/scroll).
  const clipped = [];
  for (const el of document.querySelectorAll("#match-pre-brief *, #match-pre-brief")) {
    if (!el.querySelectorAll) continue;
    const cs = getComputedStyle(el);
    const oflow = cs.overflow + cs.overflowX + cs.overflowY;
    if (!/hidden|clip|auto|scroll/.test(oflow)) continue;
    const hidW = el.scrollWidth - el.clientWidth;
    const hidH = el.scrollHeight - el.clientHeight;
    if (hidW > 1 || hidH > 1) {
      clipped.push({
        cls: String(el.className || "").slice(0, 70),
        id: el.id || "",
        hidW, hidH,
        overflowX: cs.overflowX, overflowY: cs.overflowY,
        clientW: el.clientWidth, clientH: el.clientHeight,
        scrollW: el.scrollWidth, scrollH: el.scrollHeight,
      });
    }
  }

  // Sibling overlaps inside the briefing panel (visible elements only).
  const overlaps = [];
  const panel = document.querySelector("#match-pre-brief");
  if (panel) {
    const els = Array.from(panel.querySelectorAll("*")).filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.position !== "fixed";
    });
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 4 && oy > 4) {
          const csA = getComputedStyle(a), csB = getComputedStyle(b);
          const opaque = (el) => parseFloat(getComputedStyle(el).opacity) !== 0;
          if (opaque(a) && opaque(b)) {
            overlaps.push({
              a: (a.className || a.tagName).toString().slice(0, 50),
              b: (b.className || b.tagName).toString().slice(0, 50),
              ox: Math.round(ox), oy: Math.round(oy),
            });
          }
        }
      }
    }
  }

  // Tiny text anywhere on the match screen.
  const tinyText = [];
  for (const el of document.querySelectorAll("#screen-match *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px && px < 11) tinyText.push({ cls: String(el.className || "").slice(0, 50), px });
  }

  // Briefing panel text lines that wrap outside their own box or stick out.
  const lineIssues = [];
  for (const el of document.querySelectorAll(".brief-line, .brief-chip, .form-pill, .team-talk-desc, .team-talk-label")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      lineIssues.push({
        cls: String(el.className || "").slice(0, 50),
        text: (el.textContent || "").trim().slice(0, 40),
        clientW: el.clientWidth, scrollW: el.scrollWidth,
      });
    }
  }

  // Form-strip validation: each side should have exactly one .form-strip with
  // 5 .form-cell children, all visible (non-zero rect), non-overlapping, and
  // contained within the briefing panel width.
  const formStripIssues = [];
  const strips = document.querySelectorAll("#match-pre-brief .form-strip");
  const panelRect = panel ? panel.getBoundingClientRect() : null;
  for (const strip of strips) {
    const sr = strip.getBoundingClientRect();
    const cells = strip.querySelectorAll(".form-cell");
    const cellRects = Array.from(cells).map((c) => c.getBoundingClientRect());
    const issue = {
      cellCount: cells.length,
      stripW: Math.round(sr.width),
      stripH: Math.round(sr.height),
      cells: cellRects.map((r) => ({ w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) })),
    };
    if (cells.length !== 5) formStripIssues.push({ ...issue, reason: "cellCount!=5" });
    else if (cellRects.some((r) => r.width === 0 || r.height === 0)) formStripIssues.push({ ...issue, reason: "invisible-cell" });
    else {
      // check pairwise overlap
      let overlap = false;
      for (let i = 0; i < cellRects.length - 1; i++) {
        if (cellRects[i].right > cellRects[i + 1].left + 1) { overlap = true; break; }
      }
      if (overlap) formStripIssues.push({ ...issue, reason: "cell-overlap" });
      else if (panelRect && sr.right > panelRect.right + 2) formStripIssues.push({ ...issue, reason: "strip-overflow-panel", panelRight: Math.round(panelRect.right) });
    }
  }
  // Expected: exactly 2 strips (me + opp), each 5 cells, no issues.
  const formStripSummary = {
    stripCount: strips.length,
    issues: formStripIssues,
  };

  // Does the briefing panel fit in the viewport at all, and can the page scroll?
  const pr = panel ? panel.getBoundingClientRect() : null;

  return {
    viewport: { w: vw, h: vh },
    theme: document.documentElement.getAttribute("data-theme") || "dark",
    matchLayoutClass: String(document.querySelector(".match-layout")?.className || ""),
    document: {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
    },
    boxes: [
      "#match-header", "#match-pre-brief", ".prematch-brief", ".brief-chips",
      ".brief-form-row", ".team-talk-panel", ".team-talk-grid", "#match-log",
      "#match-pitch-root", ".mp-field", "#mp-fmm-dock", ".fmm-match-bar",
    ].map(rectOf).filter(Boolean),
    briefingPanel: pr
      ? { fitsViewport: pr.top >= -1 && pr.bottom <= vh + 1, top: Math.round(pr.top), bottom: Math.round(pr.bottom), h: Math.round(pr.height) }
      : null,
    overflowing,
    clipped,
    overlaps: overlaps.slice(0, 30),
    tinyText,
    lineIssues,
    formStrip: formStripSummary,
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
  await page.fill("#input-manager", "Briefing Probe");
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
  assert.ok(matchReady, "no match became playable within 25 days");
  await page.click("#btn-play-match");
  // Stay in the pre-kickoff state: #match-pre-brief must be on screen.
  await page.waitForSelector("#screen-match.active", { timeout: 60000 });
  await page.waitForSelector("#match-pre-brief", { timeout: 60000 });
  await page.waitForTimeout(1500);

  // Inject synthetic form data so the 5-cell strip is exercised (a fresh save
  // has no matches yet, so me.form/opp.form are empty and the strip would
  // only show the "n/a" fallback). We patch the briefing object the UI already
  // rendered by rewriting the form-strip HTML directly, mirroring what
  // renderPrematchBriefHtml would produce with real form arrays.
  await page.evaluate(() => {
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
    const data = [["W","W","D","L","W"], ["L","D","L","W","L"]];
    strips.forEach((s, i) => { s.outerHTML = makeStrip(data[i] || data[0]); });
  });
  await page.waitForTimeout(400);

  const themeArg = process.argv[3] || "both";
  const themes = themeArg === "both" ? ["dark", "light"] : [themeArg];

  const results = [];
  for (const theme of themes) {
    if (themes.length > 1) console.log(`\n=== theme: ${theme} ===`);
    await page.evaluate((th) => {
      if (th === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
    }, theme);
    await page.waitForTimeout(300);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(1200);
      const data = await page.evaluate(measureScript);
      data.label = vp.label;
      const stem = `briefing-${theme}-${vp.label}-${vp.width}x${vp.height}`;
      await page.screenshot({ path: join(out, `${stem}.png`), fullPage: false });
      writeFileSync(join(out, `${stem}.json`), `${JSON.stringify(data, null, 2)}\n`);
      results.push(data);
      console.log(JSON.stringify({
        theme, viewport: vp.label,
        overflowX: data.document.overflowX,
        briefingFits: data.briefingPanel?.fitsViewport,
        overflowingCount: data.overflowing.length,
        clippedCount: data.clipped.length,
        overlapCount: data.overlaps.length,
        tinyTextCount: data.tinyText.length,
        lineIssueCount: data.lineIssues.length,
        formStrip: data.formStrip,
      }));
    }
  }
  writeFileSync(join(out, "briefing-all.json"), `${JSON.stringify({ errors, results }, null, 2)}\n`);
  console.log(JSON.stringify({ pageErrors: errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
