// Passive reception-lifecycle observation on the existing box-audit fixtures.
// Compare every final state/event/RNG count (and first-match frames) to an
// already archived run, so no duplicate control simulations are necessary.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";
const profile = process.argv[2] === "background" ? "background" : "standard";
const baselineLabel = process.argv[3] || "connected";
const label = process.argv[4] || baselineLabel;
const count = Math.max(1, Number(process.argv[5]) || 6);
for (const name of [baselineLabel, label]) assert.match(name, /^[a-z0-9-]+$/);
const previous = JSON.parse(readFileSync(new URL(
  `../.tmp-continuity/global-movement/box-flow/${baselineLabel}-${profile}.json`, import.meta.url))).summary;
const directory = new URL("../.tmp-continuity/global-movement/reception-path/", import.meta.url);
mkdirSync(directory, { recursive: true });
const output = new URL(`${label}-${profile}.json`, directory);
assert.ok(!existsSync(output), "use a fresh evidence label");
const dt = profile === "background" ? 0.3 : SIM.DT;
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W, my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const inBox = (team, x, y) => x > 22 && x < 78 && (team === "home" ? y >= 84 : y <= 16);
const other = (team) => team === "home" ? "away" : "home";
function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function club(name) {
  const keys = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
    "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning", "kicking", "decisions"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${name}-p${i}`, name: `${name}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15 + ((i * 7 + 15) % 5) - 2])) }));
  return { id: name, name, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced" } };
}
const player = (a) => ({ id: a.id, team: a.team, role: a.role, roleId: a.roleId, dutyId: a.dutyId,
  x: a.x, y: a.y, vx: a.vx, vy: a.vy, tx: a.tx, ty: a.ty, heading: a.heading,
  fsm: a.fsm, intent: a.intent && { ...a.intent } });
const rows = [], matches = [];
for (let i = 0; i < count; i++) {
  const seed = 372000 + i, originalRandom = Math.random, rng = seeded(seed);
  let draws = 0, active = null;
  Math.random = () => { draws++; return rng(); };
  try {
    const e = new SimEngine(club(`home-${seed}`), club(`away-${seed}`), {
      simulationProfile: profile, timeStep: dt, separationPasses: profile === "background" ? 4 : 8,
    });
    const finish = (reason) => {
      if (!active) return;
      const a = e.agentById(active.receiver.id);
      active.end = { reason, t: e.t, player: player(a) };
      active = null;
    };
    const begin = e._beginBallControl;
    e._beginBallControl = function(a, ...args) {
      finish("new-control");
      const b = this.ball;
      const shouldRecord = a.role !== "GK" && b.state === "pass" && a.team === b.kickTeam &&
        a.id === b.receiverId && !b.isCrossPass && !b.isThroughPass &&
        Math.abs(a.y - this.targetGoalY(a.team)) * my <= 38;
      const record = shouldRecord ? { seed, t: this.t, receiver: player(a),
        ball: { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, kickX: b.kickX, kickY: b.kickY,
          targetX: b.targetX, targetY: b.targetY, passerId: b.lastPasserId, lastPassAt: b.lastPassAt },
        players: this.agents.filter((p) => p.id !== a.id && !p.sentOff && !p.injuredOff).map(player),
        fromBox: inBox(other(a.team), b.kickX, b.kickY),
        toBox: inBox(other(a.team), b.targetX, b.targetY),
        receivedInBox: inBox(other(a.team), a.x, a.y), controlSamples: [] } : null;
      const result = begin.call(this, a, ...args);
      if (record) {
        record.plan = { ...result };
        record.after = player(a);
        record.controlUntil = a.controlUntil;
        record.decisionUntil = a.decisionUntil;
        const intent = a.intent, dx = intent.tx - a.x, dy = intent.ty - a.y;
        const squared = dx * dx + dy * dy;
        record.blockers = record.players.filter((o) => {
          const along = squared > 0 ? ((o.x - a.x) * dx + (o.y - a.y) * dy) / squared : 0;
          if (along <= 0) return false;
          const u = Math.min(1, along);
          return Math.hypot(o.x - a.x - u * dx, o.y - a.y - u * dy) < this.separationMinDistanceUnits - 1e-6;
        }).map((p) => p.id);
        active = record;
        rows.push(record);
      }
      return result;
    };
    const decide = e._decideOnBall;
    e._decideOnBall = function(a, ...args) {
      const record = active?.receiver.id === a.id ? active : null;
      if (record) record.decision = { t: this.t, player: player(a), inBox: inBox(other(a.team), this.ball.x, this.ball.y) };
      const result = decide.call(this, a, ...args);
      if (record) {
        record.decision.action = a.pendingBallAction?.action || this.ball.state;
        record.decision.after = a.intent && { ...a.intent };
        finish("decision");
      }
      return result;
    };
    const frames = createHash("sha256");
    for (let step = 0; step < Math.round(5400 / dt); step++) {
      e.step(dt);
      if (i === 0) frames.update(JSON.stringify(e.snapshot()));
      if (!active) continue;
      if (e.ball.owner !== active.receiver.id || e.t < e.deadBallUntil || e.ball.restartType) {
        finish("possession-ended");
      } else {
        const a = e.agentById(e.ball.owner);
        active.controlSamples.push({ t: e.t, x: a.x, y: a.y, ballX: e.ball.x, ballY: e.ball.y, state: e.ball.state });
      }
    }
    finish("match-end");
    const match = { seed, score: e.score, draws, stateHash: hash(e.snapshot()), eventsHash: hash(e.events),
      framesHash: i === 0 ? frames.digest("hex") : null };
    assert.deepEqual(match, previous.matches.find((m) => m.seed === seed), "observer changed the archived match");
    matches.push(match);
  } finally { Math.random = originalRandom; }
}
function summarize(selected) {
  const early = selected.filter((r) => {
    let wasOutside = !inBox(other(r.receiver.team), r.ball.x, r.ball.y);
    for (const s of r.controlSamples) {
      const inside = inBox(other(r.receiver.team), s.ballX, s.ballY);
      if (!inside) wasOutside = true;
      if (inside && wasOutside && s.state === "held") return true;
    }
    return false;
  });
  return { receipts: selected.length, blocked: selected.filter((r) => r.blockers.length).length,
    blockedByOpponent: selected.filter((r) => r.blockers.some((id) => r.players.find((p) => p.id === id).team !== r.receiver.team)).length,
    firstDecisionObserved: selected.filter((r) => r.decision).length, entriesBeforeDecision: early.length,
    blockedEntries: early.filter((r) => r.blockers.length).length,
    decisionsInBox: selected.filter((r) => r.decision?.inBox).length };
}
const summary = { label, profile, matches, comparedTo: `${baselineLabel}-${profile}`, comparedEveryMatch: true,
  firstMatchFramesCompared: true, all: summarize(rows), exits: summarize(rows.filter((r) => r.fromBox && !r.toBox)),
  sourceHash: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  preloads: process.execArgv, createdAt: new Date().toISOString() };
writeFileSync(output, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
