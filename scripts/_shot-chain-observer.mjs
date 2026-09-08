// Preload with --import. Hooks observe existing locals without extra RNG draws.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { serialize } from "node:v8";

const engineURL = new URL("../js/sim/engine.js", import.meta.url);
const auditURL = new URL("./match-realism-audit.mjs", import.meta.url);
const startedAt = new Date().toISOString();
const enabled = !process.argv.includes("--unobserved");
const command = process.argv.slice(1);
let SIM;
let engineBeforeObserverSha256;
const records = [];
const decisions = new Map();
const pending = new WeakMap();
const aims = new WeakMap();
const snapshots = [];
const symbol = Symbol.for("vcfm.shot-chain-observer");
const observe = `globalThis[Symbol.for("vcfm.shot-chain-observer")]`;
const round = (n) => Number.isFinite(n) ? Number(n.toFixed(4)) : null;
const countBy = (rows, key) => rows.reduce((out, row) => {
  const value = typeof key === "function" ? key(row) : row[key];
  out[value ?? "unknown"] = (out[value ?? "unknown"] || 0) + 1;
  return out;
}, {});
const mean = (rows, key) => rows.length ? round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length) : null;
const pct = (rows, predicate) => rows.length ? round(rows.filter(predicate).length * 100 / rows.length) : null;
const bin = (d) => d < 8 ? "under8m" : d < 16.5 ? "8to16.5m" : d < 22 ? "16.5to22m" : "22plusm";

function geometry(engine, a) {
  const b = engine.ball;
  const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
  const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
  const dy = (engine.targetGoalY(a.team) - b.y) * my;
  const dx = (50 - b.x) * mx;
  const distance = Math.hypot(dx, dy);
  const left = Math.atan2(dy, (SIM.GOAL_X0 - b.x) * mx);
  const right = Math.atan2(dy, (SIM.GOAL_X1 - b.x) * mx);
  const angle = Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
  let nearest = Infinity;
  let laneGap = Infinity;
  for (const o of engine.agents) {
    if (o.team === a.team || o.role === "GK" || o.sentOff || o.injuredOff) continue;
    const ox = (o.x - b.x) * mx;
    const oy = (o.y - b.y) * my;
    nearest = Math.min(nearest, Math.hypot(ox, oy));
    const along = (ox * dx + oy * dy) / distance;
    if (along > 0 && along < distance) laneGap = Math.min(laneGap, Math.abs(ox * dy - oy * dx) / distance);
  }
  return { distance, angleDegrees: angle * 180 / Math.PI, nearest, laneGap,
    clear: distance < 16.5 && angle > 0.35 && nearest > 3 && laneGap > 1.1 };
}

function finish(engine, outcome, detail = {}) {
  const record = pending.get(engine);
  if (!record) return;
  Object.assign(record, { outcome, endedAt: engine.t + (engine._emitTimeOffset || 0) }, detail);
  pending.delete(engine);
}

function capture(engine) {
  // Serialize immediately: Maps and their agent references must remain linked.
  return serialize({ ...engine, random: undefined, opts: { ...engine.opts, random: undefined },
    events: [], possTimeline: [] });
}

globalThis[symbol] = (engine, stage, data) => {
  if (stage === "constants") { SIM = data; return; }
  const match = engine.home.id;
  if (stage === "decision") {
    const g = geometry(engine, data.a);
    const key = `${engine.simulationProfile}:${bin(g.distance)}:${g.clear ? "clear" : "other"}`;
    let row = decisions.get(key);
    if (!row) {
      row = { key, decisions: 0, selectedShots: 0, cooldownDenied: 0, personalDenied: 0,
        attackAgeDenied: 0, qualityRejected: 0, probabilityRejected: 0, duringCooldown: 0 };
      decisions.set(key, row);
    }
    row.decisions++;
    if (data.cdBlocked) row.duringCooldown++;
    if (data.takeShot) row.selectedShots++;
    else if (!data.canShoot) {
      if (engine.t < (data.a.shotCdUntil || 0)) row.personalDenied++;
      else if (data.cdBlocked && !data.opportunity.clearOpenGoal && data.dGoal >= 9.5 && !data.setPieceChance) row.cooldownDenied++;
      else row.attackAgeDenied++;
    } else if (!data.opportunity.clearOpenGoal && !data.clearCloseChance &&
      !(data.shootQuality > data.shootThresh && data.shootQuality >= data.passQuality * (data.core ? 0.7 : data.isWing ? 0.78 : 0.85))) {
      row.qualityRejected++;
    } else row.probabilityRejected++;
    return;
  }
  if (stage === "aim") {
    aims.set(engine, { errorWidth: data.err, skill: data.skill, aimCentre: data.aimCentre });
    return;
  }
  if (stage === "event") {
    const { type, a, extra } = data;
    if (type === "shot") {
      finish(engine, "superseded");
      const g = geometry(engine, a);
      const b = engine.ball;
      const record = { id: records.length, match, profile: engine.simulationProfile, at: engine.t,
        shooterId: a.id, team: a.team, ...g, ...aims.get(engine), ...extra,
        // Event distance is in legacy field units. Keep the measured metres too.
        distanceMetres: g.distance, distanceBin: bin(g.distance),
        launchState: b.state,
        targetInFrame: Number.isFinite(extra.targetX) && Number.isFinite(extra.targetZ)
          ? extra.targetX > SIM.GOAL_X0 && extra.targetX < SIM.GOAL_X1 && extra.targetZ < 2.44 : null,
        launch: { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz },
        keeperAttempts: [], blockAttempts: [], outcome: "unfinished" };
      records.push(record);
      pending.set(engine, record);
      snapshots.push({ id: record.id, state: capture(engine) });
      return;
    }
    if (!pending.has(engine)) return;
    if (["goal", "save", "block", "woodwork", "penalty", "handball", "offside"].includes(type)) {
      finish(engine, type, { result: extra });
    }
    return;
  }
  const record = pending.get(engine);
  if (!record) return;
  if (stage === "save") {
    record.keeperAttempts.push({ ...data, at: engine.t + (engine._emitTimeOffset || 0) });
  } else if (stage === "block") {
    record.blockAttempts.push({ ...data, at: engine.t + (engine._emitTimeOffset || 0) });
  } else if (stage === "bounds") {
    record.crossing = data;
  } else if (stage === "restart") {
    const c = record.crossing;
    finish(engine, c ? c.crossZ >= 2.44 ? "high" : c.crossX <= SIM.GOAL_X0 || c.crossX >= SIM.GOAL_X1 ? "wide" : "restart-in-frame" : data.type,
      { restart: data.type });
  } else if (stage === "resolve" && (engine.ball.owner || engine.ball.state !== "shot")) {
    finish(engine, `ended-${engine.ball.state}`);
  }
};

registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === `${auditURL.href}?shot-fixtures`) {
    const source = String(result.source).split("const totals = {")[0];
    return { ...result, source: `${source}\nexport { makeClub, seededRandom };\n` };
  }
  if (url !== engineURL.href || !enabled) return result;
  engineBeforeObserverSha256 = createHash("sha256").update(String(result.source)).digest("hex");
  let source = String(result.source).replace(/\r\n/g, "\n");
  function replace(anchor, replacement) {
    assert.equal(source.split(anchor).length, 2, `unique shot observer anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  }
  replace("      if (takeShot) {", `${observe}(this, "decision", { a, dGoal, pressure, canShoot, cdBlocked, setPieceChance, opportunity, takeShot, clearCloseChance, shootQuality, shootThresh, passQuality, core, isWing });\n      if (takeShot) {`);
  replace("    const aimX = aimCentre + (this.random() - 0.5) * err;", `    const aimX = aimCentre + (this.random() - 0.5) * err;\n    ${observe}(this, "aim", { err, skill, aimCentre });`);
  replace("  _emit(type, a, extra = {}) {", `  _emit(type, a, extra = {}) {\n    ${observe}(this, "event", { type, a, extra });`);
  replace("        pSave = clamp(pSave, 0.04, 0.93);", `        pSave = clamp(pSave, 0.04, 0.93);\n        ${observe}(this, "save", { dt, pSave, dPath, reach, lateral, reactionTime, shotDistance, z: b.z });`);
  replace("        if (this.random() >= pBlock) continue;", `        ${observe}(this, "block", { defenderId: o.id, dt, pBlock, distance: d, z: b.z });\n        if (this.random() >= pBlock) continue;`);
  replace("    const underBar = crossZ < 2.44;", `    if (crossedGoalLine != null) ${observe}(this, "bounds", { crossX, crossZ });\n    const underBar = crossZ < 2.44;`);
  replace("  _restart(type, restartTeam, x, y) {", `  _restart(type, restartTeam, x, y) {\n    ${observe}(this, "restart", { type });`);
  replace("      this._resolveBounds();", `      this._resolveBounds();\n      ${observe}(this, "resolve", {});`);
  return { ...result, source: `${source}\n${observe}(null, "constants", SIM);\n` };
} });

function summarize(rows) {
  const aimed = rows.filter((r) => Number.isFinite(r.targetX) && Number.isFinite(r.targetZ));
  return { shots: rows.length, outcomes: countBy(rows, "outcome"),
    aimedShots: aimed.length, targetInFramePct: pct(aimed, (r) => r.targetInFrame),
    aimWidePct: pct(aimed, (r) => r.targetX <= SIM.GOAL_X0 || r.targetX >= SIM.GOAL_X1),
    aimHighPct: pct(aimed, (r) => r.targetZ >= 2.44),
    clearPct: pct(rows, (r) => r.clear), distanceMetres: mean(rows, "distanceMetres"),
    keeperAttemptPct: pct(rows, (r) => r.keeperAttempts.length > 0),
    savesOnAimedFramePct: pct(rows.filter((r) => r.targetInFrame), (r) => r.outcome === "save"),
    goalsOnAimedFramePct: pct(rows.filter((r) => r.targetInFrame), (r) => r.outcome === "goal"),
    saveProbability: mean(rows.flatMap((r) => r.keeperAttempts), "pSave") };
}

process.on("exit", (exitCode) => {
  if (!enabled) return;
  const directory = new URL("../.tmp-continuity/shot-chain/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  const label = `${command.slice(1, 5).join("-") || "sample"}-${Date.now()}`;
  const byDistance = Object.fromEntries([...new Set(records.map((r) => r.distanceBin))].sort()
    .map((key) => [key, summarize(records.filter((r) => r.distanceBin === key))]));
  const report = { label, command, preloads: process.execArgv, startedAt, endedAt: new Date().toISOString(), exitCode, node: process.version,
    engineSha256: createHash("sha256").update(readFileSync(engineURL)).digest("hex"),
    engineBeforeObserverSha256,
    entrySha256: createHash("sha256").update(readFileSync(command[0])).digest("hex"),
    observerSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
    overall: summarize(records), clear: summarize(records.filter((r) => r.clear)), byDistance,
    matches: countBy(records, "match"), decisions: [...decisions.values()], records };
  writeFileSync(new URL(`${label}.json`, directory), JSON.stringify(report, null, 2));
  writeFileSync(new URL(`${label}.bin`, directory), serialize(snapshots));
  console.log(JSON.stringify({ shotChain: { ...report, records: undefined } }, null, 2));
  console.log(`Shot evidence: ${new URL(`${label}.json`, directory).pathname}`);
});
