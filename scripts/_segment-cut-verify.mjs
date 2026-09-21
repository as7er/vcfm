// Verify the segment-entry cut actually fires.
//
// The fix adds `_enterSegmentTransition` -> `_playSegmentCut`, which puts
// `.mp-seg-cut` on `.mp-field` for 260 ms whenever a highlight segment starts
// more than a frame after the previous one ended. Whole-match census says every
// real gap is 129.5-956.8 sim-seconds, so every non-first segment should cut.
//
// This probe checks three things:
//   1. the class really appears at segment entries (and only there)
//   2. the mode reported by `_enterSegmentTransition` is 'cut' for real gaps
//   3. the first segment of a match reports 'first' (no gratuitous flash at kick-off)
//
// It also watches for the failure mode the fix could introduce: if the cut
// class got stuck on, the pitch would stay dark.
//
// Usage: node scripts/_segment-cut-verify.mjs [seconds]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8911;
const baseUrl = "http://127.0.0.1:" + port + "/";
const seconds = Math.max(20, Number(process.argv[2]) || 60);

const PROGRESS = root + ".tmp-continuity/cut-progress.log";
mkdirSync(dirname(PROGRESS), { recursive: true });
const mark = (s) => { try { appendFileSync(PROGRESS, new Date().toISOString() + " " + s + "\n"); } catch { /* ignore */ } };
mark("start");

async function closeModalIfAny(page) {
  // ⚠ 必须认 `#modal` 的 `hidden` class，只查 `.modal.open/.show` 会漏。
  const closed = await page
    .evaluate(() => {
      const m = document.querySelector("#modal");
      if (!m) return false;
      const vis = getComputedStyle(m);
      if (vis.display === "none" || vis.visibility === "hidden" || m.classList.contains("hidden")) {
        return false;
      }
      const btn =
        m.querySelector("#modal-close, [data-close], .modal-close, .modal-x, button.close") ||
        [...m.querySelectorAll("button")].find((b) =>
          /关闭|确定|继续|知道了|OK|×/i.test(b.textContent || "")
        );
      if (btn) {
        btn.click();
        return true;
      }
      m.click();
      return true;
    })
    .catch(() => false);
  if (closed) await page.waitForTimeout(400);
  return closed;
}

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});

const INSTALL = (ms) => {
  const mv = window.vcfmMainApi?.matchView;
  window.__cut = { entries: [], classSeen: 0, classStuck: 0, samples: 0, done: false, notes: [], until: performance.now() + ms };
  if (!mv) { window.__cut.notes.push("no matchView"); window.__cut.done = true; return; }

  const origEnter = mv._enterSegmentTransition.bind(mv);
  mv._enterSegmentTransition = function patched(frames) {
    const r = origEnter(frames);
    const el = document.querySelector(".mp-field");
    window.__cut.entries.push({
      mode: r.mode,
      gapSec: r.gapSec != null ? +r.gapSec.toFixed(1) : null,
      t0: frames?.[0]?.t ?? null,
      hasClass: !!el?.classList.contains("mp-seg-cut"),
    });
    return r;
  };

  const frame = () => {
    const now = performance.now();
    const el = document.querySelector(".mp-field");
    const has = !!el?.classList.contains("mp-seg-cut");
    window.__cut.samples++;
    if (has) window.__cut.classSeen++;
    // a cut should never last more than ~400ms; count long runs as "stuck"
    if (has) {
      window.__cut._run = (window.__cut._run || 0) + 1;
      if (window.__cut._run > 60) window.__cut.classStuck++;
    } else {
      window.__cut._run = 0;
    }
    if (now >= window.__cut.until) { window.__cut.done = true; return; }
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
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", async (d) => { await d.accept(); });

  // ⚠ 不要等 `vcfm-sw-reloaded-*`：headless 下 SW 可能不写这条，30s 就超时。
  //   已验证路径（`_display-layer-motion-probe.mjs`）：domcontentloaded + 轮询 vcfmMainApi。
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  let apiReady = false;
  for (let i = 0; i < 90 && !apiReady; i++) {
    apiReady = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
    if (!apiReady) await page.waitForTimeout(1000);
  }
  assert.ok(apiReady, "首屏未就绪：window.vcfmMainApi 未出现");
  mark("booted");
  await page.fill("#input-manager", "Cut Verify");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  mark("main-screen");

  // ⚠ 旧循环点 `#btn-advance` 等 `#next-match` 文案变化，实测卡在 main-screen。
  //   已验证可用的路径：`#btn-advance-matchday` + 轮询 `#btn-play-match`.disabled。
  await page.locator("#btn-advance-matchday").click();
  let kicked = false;
  for (let i = 0; i < 360 && !kicked; i++) {
    await page.waitForTimeout(2000);
    await closeModalIfAny(page);
    const st = await page.evaluate(() => {
      const b = document.querySelector("#btn-play-match");
      return { disabled: b ? b.disabled : null };
    });
    kicked = st.disabled === false;
    if (i % 15 === 0) mark("advance i=" + i + " disabled=" + st.disabled);
  }
  assert.ok(kicked, "推进到比赛日后仍无「进入比赛」可点");
  mark("matchday");
  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 60_000 });
  await page.evaluate(INSTALL, seconds * 1000);
  mark("installed");
  await page.click("#btn-sim-live", { timeout: 30_000 });
  mark("sim-live");

  await page.waitForFunction(() => window.__cut?.done === true, null, { timeout: (seconds + 180) * 1000 });
  mark("done");

  const raw = await page.evaluate(() => ({
    entries: window.__cut.entries, classSeen: window.__cut.classSeen,
    classStuck: window.__cut.classStuck, samples: window.__cut.samples, notes: window.__cut.notes,
  }));
  console.log("ENTRIES " + JSON.stringify(raw.entries));
  console.log("CLASS " + JSON.stringify({
    framesWithCutClass: raw.classSeen, totalFrames: raw.samples,
    pct: raw.samples ? +((raw.classSeen / raw.samples) * 100).toFixed(1) : null,
    stuckRuns: raw.classStuck,
  }));
  const modes = raw.entries.map((e) => e.mode);
  console.log("MODES " + JSON.stringify({
    first: modes.filter((m) => m === "first").length,
    cut: modes.filter((m) => m === "cut").length,
    ease: modes.filter((m) => m === "ease").length,
  }));
  console.log("NOTES " + JSON.stringify(raw.notes));
  console.log("ERRORS " + JSON.stringify(errors));
} finally {
  if (browser) await browser.close();
  server.kill();
}
