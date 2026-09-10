// Observe each offer until its actual attacking/movement task ends.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";

const count = Math.max(1, Number(process.argv[2]) || 6);
const profile = process.argv[3] === "background" ? "background" : "standard";
const label = process.argv[4] || "current";
assert.match(label, /^[a-z0-9-]+$/);
const dt = profile === "background" ? 0.3 : SIM.DT;
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const gap = (p, q) => Math.hypot((p.x - q.x) * mx, (p.y - q.y) * my);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const percentile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null;
};
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
function club(id) {
  const attrs = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
    "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning",
    "kicking", "decisions", "crossing"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, 15 + ((i * 7 + 15) % 5) - 2])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3 } };
}
const records = [];
const matches = [];
const targetCommits = [];
const relaxationCommits = [];
function play(seed, observed) {
  const rng = seeded(seed);
  let draws = 0;
  const engine = new SimEngine(club(`h${seed}`), club(`a${seed}`), {
    random: () => { draws++; return rng(); }, simulationProfile: profile, timeStep: dt,
    separationPasses: profile === "background" ? 4 : 8,
  });
  const active = new Map();
  const screenObservations = new Map();
  const frameHash = createHash("sha256");
  function finish(a, reason) {
    const record = active.get(a.id);
    if (!record) return;
    // The previous sampled position is the last position in this task. In
    // particular, do not count the first step of a turnover's recovery run.
    record.reason = reason;
    record.seconds = record.lastAt - record.at;
    record.displacement = gap(record.start, record.last);
    record.remaining = gap(record.last, record.target);
    records.push(record);
    active.delete(a.id);
  }
  if (observed) {
    assert.equal(typeof engine._applySupportOffer, "function", "load the candidate or production offer implementation");
    const separate = engine._separateSupportTargets;
    engine._separateSupportTargets = function() {
      const owner = this.ball.owner && this.agentById(this.ball.owner);
      const before = owner ? this.agents.filter((a) => a.offBallTarget?.offer && a.team === owner.team)
        .map((a) => ({ a, x: a.tx, y: a.ty, lane: this._laneSafety(owner, a, a.tx, a.ty) * 8 })) : [];
      const result = separate.call(this);
      for (const prior of before) {
        if (gap(prior, { x: prior.a.tx, y: prior.a.ty }) < 1e-7) continue;
        const lane = this._laneSafety(owner, prior.a, prior.a.tx, prior.a.ty) * 8;
        relaxationCommits.push({ seed, at: this.t, playerId: prior.a.id,
          from: { x: prior.x, y: prior.y }, target: { x: prior.a.tx, y: prior.a.ty },
          priorLane: prior.lane, lane, closedByRelaxation: prior.lane >= 1.1 && lane < 1.1 });
      }
      return result;
    };
    const commit = engine._commitOffBallTarget;
    engine._commitOffBallTarget = function(a, owner) {
      const previous = a.offBallTarget?.offer ? { ...a.offBallTarget,
        offer: { ...a.offBallTarget.offer } } : null;
      const candidate = { x: a.tx, y: a.ty };
      const result = commit.call(this, a, owner);
      if (previous && this.ball.owner === owner?.id && owner.team === a.team) {
        const target = { x: a.tx, y: a.ty };
        const minimumLane = this.ball.owner === previous.offer.ownerId ? 1.1 : 1.8;
        const lane = this._laneSafety(owner, a, target.x, target.y) * 8;
        const receivingSpace = !this.agents.some((opponent) => opponent.team !== a.team &&
          opponent.role !== "GK" && !opponent.sentOff && !opponent.injuredOff && gap(opponent, target) < 2);
        const routeClear = this._launchRouteClear(owner, { agent: a, tx: target.x, ty: target.y });
        const keptOldPoint = gap(previous, target) < 1e-7;
        const closed = lane < minimumLane || !receivingSpace || !routeClear;
        targetCommits.push({ seed, at: this.t, playerId: a.id, candidate, target,
          previous: { x: previous.x, y: previous.y, at: previous.offer.at },
          decision: a.offBallTarget?.decision, stillLabelled: !!a.offBallTarget?.offer,
          lane, minimumLane, receivingSpace, routeClear,
          keptClosedOldPoint: keptOldPoint && closed,
          closedLeaseRetention: keptOldPoint && closed && a.offBallTarget?.decision === "held",
          unlabelledClosedRetention: keptOldPoint && closed && !a.offBallTarget?.offer && gap(candidate, target) > 0.1 });
      }
      return result;
    };
    const apply = engine._applySupportOffer;
    engine._applySupportOffer = function(a, owner, previous) {
      const anchor = { x: a.tx, y: a.ty };
      const screened = owner?.id === this.ball.owner && this.ball.state === "held" &&
        owner.team === a.team && Math.hypot(a.vx * mx, a.vy * my) < 1 && gap(a, anchor) <= 1.5 &&
        this._laneSafety(owner, a, anchor.x, anchor.y) <= 1.1 / 8;
      const lastScreen = screenObservations.get(a.id);
      const confirmedScreen = screened && lastScreen?.screened && lastScreen.ownerId === this.ball.owner &&
        lastScreen.attackSince === this._teamAttackSince[a.team] && gap(lastScreen.anchor, anchor) <= 1.5;
      screenObservations.set(a.id, { screened, ownerId: this.ball.owner,
        attackSince: this._teamAttackSince[a.team], anchor });
      const result = apply.call(this, a, owner, previous);
      const offer = a.offBallTarget?.offer;
      if (offer && offer.at === this.t && active.get(a.id)?.at !== offer.at) {
        finish(a, "replanned");
        const dx = (a.tx - a.x) * mx;
        const dy = (a.ty - a.y) * my;
        const length = Math.hypot(dx, dy);
        let runnerLaneGap = null;
        let runnerLaneBlocker = null;
        for (const opponent of this.agents) {
          if (opponent.team === a.team || opponent.sentOff || opponent.injuredOff || length < 0.01) continue;
          const ox = (opponent.x - a.x) * mx;
          const oy = (opponent.y - a.y) * my;
          const along = (ox * dx + oy * dy) / length;
          if (along <= 0 || along >= length) continue;
          const perpendicular = Math.abs(ox * dy - oy * dx) / length;
          if (runnerLaneGap === null || perpendicular < runnerLaneGap) {
            runnerLaneGap = perpendicular;
            runnerLaneBlocker = { id: opponent.id, x: opponent.x, y: opponent.y, vx: opponent.vx, vy: opponent.vy };
          }
        }
        active.set(a.id, { seed, playerId: a.id, team: a.team, role: a.role, at: this.t,
          ownerId: this.ball.owner, lastObservedOwnerId: this.ball.owner, attackSince: this._teamAttackSince[a.team],
          start: { x: a.x, y: a.y }, last: { x: a.x, y: a.y }, lastAt: this.t,
          target: { x: a.tx, y: a.ty }, anchor, pathMetres: 0, changedOwnerCommits: 0,
          changedOwnerBlockedCommits: 0, holderChanges: 0, blockedHolderChanges: 0,
          blockedHeldCommits: 0, onsideViolations: 0,
          initialDetour: gap(anchor, { x: a.tx, y: a.ty }),
          runnerLaneGap, runnerLaneBlocker, screenedAtPreviousDecision: !!confirmedScreen,
          initialDepthChange: (a.ty - anchor.y) * my * this.attackDir(a.team),
          laneAtSelection: this._laneSafety(owner, a, a.tx, a.ty) * 8 });
      }
      const record = active.get(a.id);
      if (record && offer && offer.at === record.at && this.ball.owner && this.ball.owner !== record.ownerId) {
        record.changedOwnerCommits++;
        record.changedOwnerBlockedCommits += Number(this._laneSafety(owner, a, a.tx, a.ty) <= 1.1 / 8);
      }
      if (record && offer && offer.at === record.at && this.ball.owner && this.ball.owner !== record.lastObservedOwnerId) {
        record.holderChanges++;
        record.blockedHolderChanges += Number(this._laneSafety(owner, a, a.tx, a.ty) <= 1.1 / 8);
        record.lastObservedOwnerId = this.ball.owner;
      }
      if (record && offer) record.onsideViolations += Number(this._isOffsidePosition(a.team, { x: a.tx, y: a.ty }));
      if (record && offer && this.ball.owner === owner?.id) {
        record.blockedHeldCommits += Number(this._laneSafety(owner, a, a.tx, a.ty) < 1.1 / 8);
      }
      return result;
    };
  }
  for (let step = 0; step < Math.round(5400 / dt); step++) {
    engine.step(dt);
    if (seed === 372000) frameHash.update(JSON.stringify(engine.snapshot()));
    if (!observed) continue;
    for (const [id, record] of active) {
      const a = engine.agentById(id);
      const b = engine.ball;
      const owner = b.owner && engine.agentById(b.owner);
      const attackTeam = owner?.team || (b.state === "pass" ? b.kickTeam : null);
      const reason = a.sentOff || a.injuredOff ? "left-field" : b.restartType || engine.t < engine.deadBallUntil ? "restart" :
        attackTeam !== a.team || record.attackSince !== engine._teamAttackSince[a.team] ? "possession-ended" :
        b.owner === id || (b.state === "pass" && b.receiverId === id) ? "receiving" :
        a.offBallTarget?.offer?.at !== record.at ? "target-ended" : null;
      if (reason) { finish(a, reason); continue; }
      record.pathMetres += gap(record.last, a);
      record.last = { x: a.x, y: a.y };
      record.lastAt = engine.t;
      record.target = { x: a.tx, y: a.ty };
    }
  }
  for (const id of active.keys()) finish(engine.agentById(id), "match-end");
  return { seed, score: engine.score, draws, stateHash: hash(engine.snapshot()), eventsHash: hash(engine.events),
    frameHash: seed === 372000 ? frameHash.digest("hex") : null };
}
for (let i = 0; i < count; i++) {
  const bare = i === 0 ? play(372000, false) : null;
  const measured = play(372000 + i, true);
  if (bare) assert.deepEqual(measured, bare, "the observer must preserve every frame, event and random draw");
  matches.push(measured);
}
const tally = (key) => records.reduce((sum, r) => sum + r[key], 0);
const summary = { label, profile, matches, runs: records.length,
  reasons: records.reduce((out, r) => { out[r.reason] = (out[r.reason] || 0) + 1; return out; }, {}),
  medianDisplacement: percentile(records.map((r) => r.displacement), 0.5),
  medianRemaining: percentile(records.map((r) => r.remaining), 0.5),
  medianSeconds: percentile(records.map((r) => r.seconds), 0.5),
  p90Seconds: percentile(records.map((r) => r.seconds), 0.9),
  changedOwnerCommits: tally("changedOwnerCommits"), changedOwnerBlockedCommits: tally("changedOwnerBlockedCommits"),
  holderChanges: tally("holderChanges"), blockedHolderChanges: tally("blockedHolderChanges"),
  blockedHeldCommits: tally("blockedHeldCommits"),
  actualTargetCommits: targetCommits.length,
  closedLeaseRetentions: targetCommits.filter((c) => c.closedLeaseRetention).length,
  unlabelledClosedRetentions: targetCommits.filter((c) => c.unlabelledClosedRetention).length,
  keptClosedOldPoints: targetCommits.filter((c) => c.keptClosedOldPoint).length,
  relaxationMoves: relaxationCommits.length,
  lanesClosedByRelaxation: relaxationCommits.filter((c) => c.closedByRelaxation).length,
  runnerRoutesWithin1Metre: records.filter((r) => r.runnerLaneGap !== null && r.runnerLaneGap < 1).length,
  runnerRoutesWithin2Metres: records.filter((r) => r.runnerLaneGap !== null && r.runnerLaneGap < 2).length,
  screenedAtPreviousDecision: records.filter((r) => r.screenedAtPreviousDecision).length,
  onsideViolations: tally("onsideViolations"),
  initialDepthChange: { min: Math.min(...records.map((r) => r.initialDepthChange)),
    max: Math.max(...records.map((r) => r.initialDepthChange)),
    median: percentile(records.map((r) => r.initialDepthChange), 0.5) },
  engineSha256: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  preloads: process.execArgv, createdAt: new Date().toISOString() };
mkdirSync(new URL("../.tmp-continuity/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../.tmp-continuity/support-offer-trace-${label}-${profile}.json`, import.meta.url),
  JSON.stringify({ summary, records, targetCommits, relaxationCommits }, null, 2));
console.log(JSON.stringify(summary, null, 2));
