// Read-only reception timeline. Preload before the existing calibration runner.
// WeakMaps keep instrumentation out of serialized engine state and RNG flow.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const enabled = !process.argv.includes("--unobserved-receptions");
const engineURL = new URL("../js/sim/engine.js", import.meta.url);
const fixturesURL = new URL("./match-realism-audit.mjs?shot-fixtures", import.meta.url);
const rows = [];
const active = new WeakMap();
const symbol = Symbol.for("vcfm.reception-chain-observer");
const evidence = {
  command: process.argv.slice(1), preloads: process.execArgv,
  startedAt: new Date().toISOString(),
  engineSha256: createHash("sha256").update(readFileSync(engineURL)).digest("hex"),
};
const round = (n) => Number.isFinite(n) ? Number(n.toFixed(4)) : null;
const median = (values) => {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  const mid = ordered.length >> 1;
  return ordered.length ? round(ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2) : null;
};

globalThis[symbol] = (SimEngine, SIM) => {
  const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
  const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
  const speed = (a) => Math.hypot(a.vx * mx, a.vy * my);
  function scene(engine, a) {
    const b = engine.ball;
    const dx = (50 - a.x) * mx;
    const dy = (engine.targetGoalY(a.team) - a.y) * my;
    const distance = Math.hypot(dx, dy);
    let nearest = Infinity;
    let lane = Infinity;
    for (const o of engine.agents) {
      if (o.team === a.team || o.role === "GK" || o.sentOff || o.injuredOff) continue;
      const ox = (o.x - a.x) * mx;
      const oy = (o.y - a.y) * my;
      nearest = Math.min(nearest, Math.hypot(ox, oy));
      const along = (ox * dx + oy * dy) / (distance || 1);
      if (along > 0 && along < distance) lane = Math.min(lane, Math.abs(ox * dy - oy * dx) / distance);
    }
    return { at: engine.t, x: a.x, y: a.y, vx: a.vx, vy: a.vy, speed: speed(a),
      tx: a.tx, ty: a.ty, heading: a.heading, ballX: b.x, ballY: b.y, ballZ: b.z,
      distance, nearest: round(nearest), lane: round(lane),
      closeClear: distance < 16.5 && Math.abs(a.x - 50) * mx < 8 && nearest > 3 && lane > 1.1 };
  }
  function finish(engine, outcome) {
    const row = active.get(engine);
    if (!row) return;
    const a = engine.agentById(row.receiverId);
    row.endedAt = engine.t;
    row.outcome = outcome;
    row.end = a ? scene(engine, a) : null;
    active.delete(engine);
  }

  const begin = SimEngine.prototype._beginBallControl;
  SimEngine.prototype._beginBallControl = function (a, options) {
    finish(this, "replaced");
    const b = this.ball;
    const eligible = b.state === "pass" && b.receiverId === a.id && b.kickTeam === a.team && a.role !== "GK";
    const row = eligible ? {
      match: this.home.id, profile: this.simulationProfile, receiverId: a.id, role: a.role, team: a.team,
      contact: scene(this, a), flightSeconds: this.t - b.lastPassAt,
      cross: !!b.isCrossPass, through: !!b.isThroughPass, incomingSpeed: speed(b),
      advanceVelocity: a.vy * my * this.attackDir(a.team),
      box: this._inOwnFoulBox(a.team === "home" ? "away" : "home", b.x, b.y),
      outcome: "unfinished",
    } : null;
    const result = begin.call(this, a, options);
    if (row) {
      row.controlSeconds = a.controlUntil - this.t;
      row.scheduledDecisionSeconds = a.decisionUntil - this.t;
      row.plannedHeading = a.bodyTargetHeading;
      rows.push(row);
      active.set(this, row);
    }
    return result;
  };
  const decide = SimEngine.prototype._decideOnBall;
  SimEngine.prototype._decideOnBall = function (a) {
    const row = active.get(this);
    if (row && row.receiverId === a.id && !row.decision) row.decision = scene(this, a);
    return decide.call(this, a);
  };
  const stepBall = SimEngine.prototype._stepBall;
  SimEngine.prototype._stepBall = function (dt) {
    const result = stepBall.call(this, dt);
    const row = active.get(this);
    if (!row) return result;
    const b = this.ball;
    if (b.owner !== row.receiverId) {
      finish(this, b.owner ? "lost-control" : b.state);
    } else if (b.state === "held" && !row.settled) {
      row.settled = scene(this, this.agentById(row.receiverId));
    }
    return result;
  };
  const emit = SimEngine.prototype._emit;
  SimEngine.prototype._emit = function (type, a, extra) {
    const row = active.get(this);
    if (row && a?.id === row.receiverId && ["pass", "shot", "clearance"].includes(type)) finish(this, type);
    return emit.call(this, type, a, extra);
  };
};

registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === fixturesURL.href) {
    const source = String(result.source).split("const totals = {")[0];
    assert.ok(source.length < String(result.source).length, "fixture export boundary exists");
    return { ...result, source: `${source}\nexport { makeClub, seededRandom };\n` };
  }
  if (url !== engineURL.href) return result;
  evidence.loadedEngineSha256 = createHash("sha256").update(String(result.source)).digest("hex");
  if (!enabled) return result;
  return { ...result, source: `${result.source}\nglobalThis[Symbol.for("vcfm.reception-chain-observer")](SimEngine, SIM);\n` };
} });

function summarize(group) {
  const decided = group.filter((row) => row.decision);
  const moving = group.filter((row) => row.contact.speed >= 2);
  return { receptions: group.length, decided: decided.length,
    medianFlightSeconds: median(group.map((r) => r.flightSeconds)),
    medianControlSeconds: median(group.map((r) => r.controlSeconds)),
    medianScheduledDecisionSeconds: median(group.map((r) => r.scheduledDecisionSeconds)),
    medianActualDecisionSeconds: median(decided.map((r) => r.decision.at - r.contact.at)),
    movingReceptions: moving.length,
    movingContactSpeed: median(moving.map((r) => r.contact.speed)),
    movingSettledSpeed: median(moving.map((r) => r.settled?.speed)),
    movingDecisionSpeed: median(moving.map((r) => r.decision?.speed)),
    clearAtContact: group.filter((r) => r.contact.closeClear).length,
    clearLostBeforeDecision: decided.filter((r) => r.contact.closeClear && !r.decision.closeClear).length,
    medianProgressBeforeDecision: median(decided.map((r) => (r.decision.y - r.contact.y) * (r.team === "home" ? -1 : 1) * 1.05)),
    outcomes: group.reduce((out, row) => { out[row.outcome] = (out[row.outcome] || 0) + 1; return out; }, {}) };
}
process.on("exit", (exitCode) => {
  if (!enabled) return;
  const ground = rows.filter((r) => !r.cross && r.contact.ballZ <= 0.8);
  const summary = { all: summarize(rows), ground: summarize(ground), boxGround: summarize(ground.filter((r) => r.box)) };
  const directory = new URL("../.tmp-continuity/reception-chain/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  const file = new URL(`receptions-${Date.now()}.json`, directory);
  writeFileSync(file, JSON.stringify({ ...evidence, completedAt: new Date().toISOString(), exitCode, summary, rows }, null, 2));
  console.log(JSON.stringify({ receptionChain: summary, receptionEvidence: file.pathname }, null, 2));
});
