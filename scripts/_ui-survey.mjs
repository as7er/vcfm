// Visual survey: capture the main career screens at desktop and phone widths so
// the layout/typography of each page can be reviewed side by side.
//
// Usage:
//   node scripts/_ui-survey.mjs [outDir]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8898;
const baseUrl = `http://127.0.0.1:${port}/`;
const outArg = process.argv[2];
const out = outArg
  ? (isAbsolute(outArg) ? outArg : resolve(root, outArg))
  : join(root, ".tmp-continuity", `ui-survey-${Date.now()}`);
mkdirSync(out, { recursive: true });
console.log(JSON.stringify({ out }));

// Tab -> primary nav group (mirrors MAIN_NAV_GROUPS in js/main.js:1628).
// Secondary tabs are hidden unless their primary group is active, so the probe
// must switch the primary nav first — otherwise the click silently no-ops and
// every screenshot comes out identical.
const NAV_GROUPS = {
  overview: ["dashboard", "finance", "inbox", "media", "career"],
  team: ["squad", "tactics", "training", "youth", "staff", "facilities"],
  matches: ["fixtures", "table"],
  transfer: ["transfer"],
  world: ["competitions", "clubs"],
};
const groupOf = (tab) =>
  Object.entries(NAV_GROUPS).find(([, tabs]) => tabs.includes(tab))?.[0] || "overview";

const TABS = [
  "dashboard", "finance", "inbox", "career",
  "squad", "tactics", "training",
  "fixtures", "table",
  "transfer",
  "competitions", "clubs",
];

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

// Per-panel structural metrics: how tall each card is, how much whitespace,
// how many text nodes, font-size spread. Enough to spot layout waste without
// a vision pass.
function metrics() {
  const panel = document.querySelector(".tab-panel.active");
  if (!panel) return null;
  const cards = Array.from(panel.querySelectorAll(".card, .panel, section"));
  const rows = cards.map((c) => {
    const r = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    return {
      cls: String(c.className || "").slice(0, 48),
      w: Math.round(r.width), h: Math.round(r.height),
      pad: cs.padding, gap: cs.gap,
      childCount: c.children.length,
    };
  });
  // font sizes actually in use inside the panel
  const sizes = {};
  for (const el of panel.querySelectorAll("*")) {
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize));
    sizes[px] = (sizes[px] || 0) + 1;
  }
  // horizontal overflow inside the panel
  const over = [];
  for (const el of panel.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
      over.push({ cls: String(el.className || el.tagName).slice(0, 40), w: Math.round(r.width), right: Math.round(r.right) });
    }
  }
  return {
    tab: document.querySelector(".tab.active")?.dataset.tab || null,
    panelH: panel.scrollHeight,
    cardCount: cards.length,
    rows,
    fontSizes: sizes,
    overflowCount: over.length,
    overflow: over.slice(0, 10),
    docScrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    chrome: (() => {
      const tb = document.querySelector(".topbar");
      const nav = document.querySelector(".nav-stack");
      const content = document.querySelector(".content");
      const vh = window.innerHeight;
      const r = (el) => (el ? Math.round(el.getBoundingClientRect().height) : null);
      const tbH = r(tb);
      return {
        topbarH: tbH,
        navH: r(nav),
        topbarPctOfViewport: tbH ? +(tbH / vh * 100).toFixed(1) : null,
        contentTop: content ? Math.round(content.getBoundingClientRect().top) : null,
        viewportH: vh,
      };
    })(),
    // Tactics-page pitch shape, so it can be compared against the match pitch
    // (css/style.css:6842 uses aspect-ratio 68/93.45 = 0.728).
    tacticsPitch: (() => {
      const p = document.querySelector("#pitch.pitch");
      if (!p) return null;
      const rect = p.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return {
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        ratio: +(rect.width / rect.height).toFixed(3),
        computedAspect: getComputedStyle(p).aspectRatio,
        // markings actually present in the DOM
        markings: ["pitch-stripe", "pitch-center", "pitch-box", "pitch-spot"]
          .filter((c) => p.querySelector(`.${c}`)),
      };
    })(),
  };
}

async function boot(page, manager) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => (
    !("serviceWorker" in navigator) ||
    Object.keys(sessionStorage).some((k) => k.startsWith("vcfm-sw-reloaded-"))
  ));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 120000 });
  await page.fill("#input-manager", manager);
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150000 });
  await page.waitForTimeout(1200);
}

let browser;
const report = { captures: [], errors: [] };
try {
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    try { ready = (await fetch(baseUrl)).ok; } catch { /* retry */ }
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "preview server did not start");
  browser = await chromium.launch({ channel: "msedge", headless: true });

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("dialog", async (d) => { await d.accept(); });

  await page.screenshot({ path: join(out, "00-start-screen.png"), fullPage: false });
  await boot(page, "UI Survey");

  for (const tab of TABS) {
    const group = groupOf(tab);
    await page.click(`.primary-tab[data-nav-group="${group}"]`).catch(() => {});
    await page.waitForTimeout(500);
    const btn = page.locator(`.tab[data-tab="${tab}"]`);
    if (!(await btn.count())) { report.errors.push(`missing tab ${tab}`); continue; }
    await btn.click().catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, `desktop-${tab}.png`), fullPage: false });
    const m = await page.evaluate(metrics);
    if (m && m.tab !== tab) report.errors.push(`tab did not switch: wanted ${tab}, got ${m.tab}`);
    report.captures.push({ viewport: "desktop", name: tab, metrics: m });
    console.log(JSON.stringify({ tab, active: m?.tab, panelH: m?.panelH, cards: m?.cardCount, fonts: m?.fontSizes, overflow: m?.overflowCount }));
  }

  // Phone pass on the densest screens.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  for (const tab of ["dashboard", "squad", "tactics", "table", "transfer"]) {
    const group = groupOf(tab);
    await page.click(`.primary-tab[data-nav-group="${group}"]`).catch(() => {});
    await page.waitForTimeout(500);
    const btn = page.locator(`.tab[data-tab="${tab}"]`);
    if (!(await btn.count())) continue;
    await btn.click().catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, `phone-${tab}.png`), fullPage: false });
    const m = await page.evaluate(metrics);
    if (m && m.tab !== tab) report.errors.push(`phone tab did not switch: wanted ${tab}, got ${m.tab}`);
    report.captures.push({ viewport: "phone", name: tab, metrics: m });
    console.log(JSON.stringify({ tab: `phone/${tab}`, active: m?.tab, panelH: m?.panelH, fonts: m?.fontSizes, overflow: m?.overflowCount }));
  }

  writeFileSync(join(out, "ui-survey.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ pageErrors: report.errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
