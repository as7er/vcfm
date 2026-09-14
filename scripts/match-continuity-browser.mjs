import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8891;
const baseUrl = `http://127.0.0.1:${port}/`;
const out = new URL(`../.tmp-continuity/visual-${Date.now()}/`, import.meta.url);
mkdirSync(out, { recursive: true });
console.log(JSON.stringify({ out: fileURLToPath(out) }));
const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore", windowsHide: true,
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    try { ready = (await fetch(baseUrl)).ok; } catch {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "preview server did not start");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("dialog", async (dialog) => {
    await dialog[/urgent inbox|\u7d27\u6025\u4fe1\u7bb1/i.test(dialog.message()) ? "dismiss" : "accept"]();
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  // Match the E2E bootstrap: first-install SW activation can reload this page.
  await page.waitForFunction(() => (
    !("serviceWorker" in navigator) ||
    Object.keys(sessionStorage).some((key) => key.startsWith("vcfm-sw-reloaded-"))
  ));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90000 });
  await page.fill("#input-manager", "Continuity Audit");
  await page.click("#btn-new-game");
  try {
    await page.waitForSelector("#screen-main.active", { timeout: 90000 });
  } catch (error) {
    await page.screenshot({ path: fileURLToPath(new URL("boot-failure.png", out)) });
    const hint = await page.locator("#start-hint").textContent().catch(() => "");
    writeFileSync(new URL("boot-failure.json", out), JSON.stringify({ hint, errors, error: error.message }, null, 2));
    throw new Error(`new game did not open: ${hint || "no start hint"}; ${errors.join(" | ") || error.message}`);
  }
  let matchReady = false;
  for (let day = 0; day < 25 && !matchReady; day++) {
    const before = await page.locator("#date-label").innerText();
    console.log(JSON.stringify({ advancingFrom: before }));
    await page.click("#btn-advance");
    try {
      await page.waitForFunction((date) => document.querySelector("#date-label")?.textContent !== date,
        before, { timeout: 150000 });
    } catch (error) {
      const state = await page.evaluate(() => ({
        date: document.querySelector("#date-label")?.textContent,
        progress: document.querySelector("#calendar-advance-status")?.textContent,
        advanceDisabled: document.querySelector("#btn-advance")?.disabled,
        playMatchDisabled: document.querySelector("#btn-play-match")?.disabled,
        mainInert: document.querySelector("#screen-main")?.inert,
      }));
      await page.screenshot({ path: fileURLToPath(new URL("calendar-failure.png", out)) });
      writeFileSync(new URL("calendar-failure.json", out), JSON.stringify({
        before, state, errors, consoleErrors, error: error.message,
      }, null, 2));
      throw error;
    }
    matchReady = await page.locator("#btn-play-match").isEnabled();
    console.log(JSON.stringify({ advancedTo: await page.locator("#date-label").innerText(), matchReady }));
  }
  assert.ok(matchReady, "a playable fixture must appear");
  await page.click("#btn-play-match");
  await page.waitForSelector("#screen-match.active", { timeout: 90000 });
  await page.waitForSelector(".mp-official.referee");
  await page.evaluate(async () => {
    const resource = performance.getEntriesByType("resource").find((entry) => /\/matchview\.js\?/.test(entry.name));
    const { getMatchView } = await import(resource.name);
    const view = getMatchView(document.querySelector("#match-pitch-root"));
    window.__continuityView = view;
    const stats = window.__continuityStats = {
      frames: 0, movingFrames: 0, cuts: 0, contacts: 0, maxRefSpeed: 0, violations: [], samples: [], incidentFrames: [],
    };
    const apply = view.applySimSnapshot;
    view.applySimSnapshot = function(frame, options) {
      const previousT = this._officialsSimT;
      const previousRef = { x: this.officials.referee.x, y: this.officials.referee.y };
      const previousIncidents = this.motionMonitor.history.length;
      const result = apply.call(this, frame, options);
      if (this.motionMonitor.history.length > previousIncidents) {
        stats.incidentFrames.push({
          incidents: this.motionMonitor.history.slice(previousIncidents),
          frame: this.motionMonitor.frames.at(-1),
          sourceFrames: (this._simPlay?.frames || []).filter((source) => Math.abs(source.t - frame.t) < 0.6),
        });
      }
      if (this._simPlay?.label === "kickoff" && !stats.openingFrames) {
        stats.openingFrames = this._simPlay.frames.filter((source) => source.t < 15);
      }
      const dt = frame.t - previousT;
      const cut = !Number.isFinite(previousT) || dt < -1e-6 || dt > 0.55;
      stats.frames++;
      stats.cuts += Number(cut);
      if (!cut && dt > 0) {
        const distance = Math.hypot((this.officials.referee.x - previousRef.x) * 0.68,
          (this.officials.referee.y - previousRef.y) * 1.05);
        const speed = distance / dt;
        if (distance > 1e-6) stats.movingFrames++;
        stats.maxRefSpeed = Math.max(stats.maxRefSpeed, speed);
        if (speed > 3.801 && stats.violations.length < 20) stats.violations.push({ t: frame.t, speed, dt });
      }
      if (stats.frames % 30 === 0) stats.samples.push({
        t: frame.t, ball: { x: this.ball.x, y: this.ball.y, z: this.ball.z },
        referee: { x: this.officials.referee.x, y: this.officials.referee.y },
        replay: !!this._fmmReplay?.active,
      });
      return result;
    };
    const burst = view._burst;
    view._burst = function(...args) {
      if (args[2] === "save") stats.contacts++;
      return burst.apply(this, args);
    };
  });

  const captures = [];
  async function capture(label) {
    const pixels = await page.evaluate(() => {
      const canvas = document.querySelector("#mp-canvas");
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      let hash = 2166136261;
      for (let i = 0; i < data.length; i += 64) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
        hash = Math.imul(hash ^ data[i], 16777619);
      }
      return {
        width: canvas.width, height: canvas.height, colors: colors.size, hash,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    assert.ok(pixels.width > 100 && pixels.height > 100 && pixels.colors > 10, `${label}: blank canvas`);
    assert.ok(pixels.overflow <= 1, `${label}: horizontal overflow`);
    await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, out)) });
    captures.push({ label, ...pixels });
    console.log(JSON.stringify({ capture: label, ...pixels }));
  }

  await page.click("#btn-sim-live");
  await page.click('[data-match-speed="1"]');
  console.log("Watching a real match: desktop 1x, then 4x; mobile second half.");
  const started = Date.now();
  let fast = false;
  let halfTime = false;
  let completed = false;
  let nextCapture = 0;
  while (Date.now() - started < 8 * 60 * 1000) {
    const elapsed = Date.now() - started;
    if (!fast && elapsed > 20000) {
      await page.click('[data-match-speed="4"]');
      fast = true;
    }
    if (!halfTime && await page.locator("#match-ht-panel:not(.hidden)").isVisible()) {
      await capture("desktop-half-time");
      await page.click("#btn-ht-skip");
      halfTime = true;
      await page.setViewportSize({ width: 390, height: 844 });
      console.log("Second half: 390x844 mobile viewport, 4x.");
    }
    if (elapsed >= nextCapture) {
      await capture(`${halfTime ? "mobile" : "desktop"}-${Math.floor(elapsed / 1000)}`);
      nextCapture = elapsed + 20000;
    }
    if (await page.locator("#btn-match-continue").isEnabled()) {
      completed = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  await capture("final");
  const report = await page.evaluate(() => ({
    stats: window.__continuityStats,
    motion: window.__continuityView.motionMonitor.logMotionReport("match-continuity"),
    clock: document.querySelector("#match-minute")?.textContent,
  }));
  writeFileSync(new URL("report.json", out), JSON.stringify({ completed, halfTime, captures, errors, ...report }, null, 2));
  writeFileSync(new URL("motion-report.json", out), JSON.stringify({
    clock: report.clock,
    framesDriven: report.stats.frames,
    ...report.motion,
  }, null, 2));
  console.log(JSON.stringify({ completed, halfTime, frames: report.stats.frames,
    movingFrames: report.stats.movingFrames, maxRefSpeed: report.stats.maxRefSpeed,
    cuts: report.stats.cuts, contacts: report.stats.contacts, motion: report.motion.byType,
    motionFramesTotal: report.motion.framesSampledTotal, out: fileURLToPath(out), errors }));
  console.log(JSON.stringify({ motionRows: report.motion.rows }, null, 1));
  assert.ok(completed && halfTime, "the workflow must reach both halves and full time");
  assert.ok(report.stats.movingFrames > 100, "the browser must render moving play");
  assert.deepEqual(report.stats.violations, [], "officials exceeded physical speed in continuous play");
  for (const type of ["player-teleport", "ball-teleport", "display-divergence", "owner-ball-gap"]) {
    assert.equal(report.motion.byType[type] || 0, 0, `${type}: inspect the captured incident frames`);
  }
  assert.ok(new Set(captures.map((sample) => sample.hash)).size > 3, "canvas must change during play");
  assert.deepEqual(errors, [], "browser errors occurred");
  console.log("Match continuity browser audit passed.");
} finally {
  await browser?.close();
  server.kill();
}
