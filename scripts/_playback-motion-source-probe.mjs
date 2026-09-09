// Exercise the actual rAF timeline, pair selection, interpolation and monitor.
// DOM painting alone is stubbed. --historical pins all JS modules to 07f1391.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const historical = process.argv.includes("--historical");
const fixtureURL = new URL("./match-continuity-audit.mjs?view-fixtures", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === fixtureURL) return { ...result,
    source: String(result.source).split("const base = makeEngine().snapshot();")[0] + "\nexport { makeView };\n" };
  if (!historical || !url.startsWith(new URL("js/", root).href)) return result;
  const relative = decodeURIComponent(url.slice(root.href.length).split("?")[0]);
  const source = execFileSync("git", ["show", `07f1391:${relative}`], { cwd: fileURLToPath(root), encoding: "utf8" });
  return { ...result, source };
} });

const { SimEngine, SIM } = await import("../js/sim/engine.js");
const { compactSimFrame } = await import("../js/sim/adapt.js");
const { createWorld } = await import("../js/models.js");
const { CLUB_TEMPLATES, START_DIVISIONS } = await import("../js/data.js");
const { makeView } = await import(fixtureURL);
const count = Math.max(1, Number(process.argv[2]) || 100);
function random(seed) {
  return () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
}
const originalRandom = Math.random;
Math.random = random(582601);
const startClub = CLUB_TEMPLATES.find((club) => START_DIVISIONS.includes(club.division));
const clubs = createWorld(startClub.id, "Playback Motion Probe").clubs;
Math.random = originalRandom;
let rafId = 0;
const callbacks = new Map();
globalThis.requestAnimationFrame = (callback) => { callbacks.set(++rafId, callback); return rafId; };
globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
let now = 1000;
Object.defineProperty(globalThis, "performance", { value: { now: () => now }, configurable: true });
const metres = (a, b) => Math.hypot((b.x - a.x) * 0.68, (b.y - a.y) * 1.05);
const report = { revision: historical ? "07f1391" : "working", matches: count, runs: 0,
  rendered: 0, rawPairs: 0, maxRawSpeed: 0, maxRenderedSpeed: 0, incidents: [] };
for (let index = 0; index < count; index++) {
  const seed = 51029 + index;
  const home = clubs[index % clubs.length];
  let awayIndex = (index * 17 + 13) % clubs.length;
  if (awayIndex === index % clubs.length) awayIndex = (awayIndex + 1) % clubs.length;
  const engine = new SimEngine(structuredClone(home), structuredClone(clubs[awayIndex]), { random: random(seed) });
  const frames = [compactSimFrame(engine)];
  for (let step = 0; step < 140; step++) { engine.step(SIM.DT); frames.push(compactSimFrame(engine)); }
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a.motionContext?.discontinuity || b.motionContext?.discontinuity || a.ball.restartType || b.ball.restartType) continue;
    report.rawPairs++;
    const previous = new Map(a.players.map((p) => [p.id, p]));
    for (const p of b.players) report.maxRawSpeed = Math.max(report.maxRawSpeed,
      metres(previous.get(p.id), p) / (b.t - a.t));
  }
  for (const fps of [30, 60, 120]) {
    const view = makeView(frames[0]);
    for (const method of ["_tickDirector", "_drawCanvas", "_updateSimCamera", "refreshLayout",
      "_clearDirectorChrome", "_clearCornerChrome"]) view[method] = () => {};
    let previous = null;
    const apply = view.applySimSnapshot;
    view.applySimSnapshot = function (frame, options) {
      const result = apply.call(this, frame, options);
      report.rendered++;
      if (previous && frame.t > previous.t && frame.t - previous.t <= 0.55 &&
        !previous.motionContext?.discontinuity && !frame.motionContext?.discontinuity &&
        !previous.ball.restartType && !frame.ball.restartType) {
        const byId = new Map(previous.players.map((p) => [p.id, p]));
        for (const p of frame.players) if (byId.has(p.id)) report.maxRenderedSpeed = Math.max(report.maxRenderedSpeed,
          metres(byId.get(p.id), p) / (frame.t - previous.t));
      }
      previous = frame;
      return result;
    };
    let rendered = 0;
    let paused = false;
    const completion = view.playSimTimeline(frames, {
      label: "kickoff", getSpeed: () => rendered < fps * 2 ? 1 : rendered < fps * 3 ? 4 : 2,
      isPaused: () => paused,
    });
    while (view._simPlay && rendered < fps * 40) {
      const scheduled = [...callbacks.values()];
      callbacks.clear();
      paused = rendered >= fps && rendered < fps + 8;
      now += 1000 / fps;
      for (const callback of scheduled) callback(now);
      rendered++;
    }
    assert.equal(view._simPlay, null, "the real timeline must finish");
    await completion;
    report.runs++;
    const incidents = view.motionMonitor.history.filter((incident) => incident.type === "player-teleport");
    for (const incident of incidents) report.incidents.push({ seed, fps, incident,
      originalFrames: frames.filter((frame) => Math.abs(frame.t - incident.t) < 0.6),
      clip: view.createMotionClip() });
  }
  if ((index + 1) % 25 === 0) console.log(`Playback openings: ${index + 1}/${count}, incidents ${report.incidents.length}`);
}
mkdirSync(new URL(".tmp-continuity/", root), { recursive: true });
const output = new URL(`.tmp-continuity/playback-motion-${report.revision}-${Date.now()}.json`, root);
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, incidents: report.incidents.map(({ seed, fps, incident }) => ({ seed, fps, incident })),
  evidence: fileURLToPath(output) }, null, 2));
assert.equal(report.incidents.length, 0, "the actual playback route contains an unexplained displacement");
