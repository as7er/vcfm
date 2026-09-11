// Observe completed decisions and actual contiguous wide carries. Wrappers
// only copy existing return values; the first match has a full unobserved twin.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";

const count = Math.max(1, Number(process.argv[2]) || 6);
const profile = process.argv[3] === "background" ? "background" : "standard";
const label = process.argv[4] || "current";
assert.match(label, /^[a-z0-9-]+$/);
const dt = profile === "background" ? 0.3 : SIM.DT;
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const round = (n) => Number(n.toFixed(4));
const metres = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const directory = new URL("../.tmp-continuity/global-movement/byline/", import.meta.url);
mkdirSync(directory, { recursive: true });
const output = new URL(`${label}-${profile}.json`, directory);
assert.ok(!existsSync(output), "use a fresh evidence label");
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
const decisions = [];
const episodes = [];
const examples = [];
const matches = [];
function point(p) {
  return { id: p.id, team: p.team, role: p.role, roleId: p.roleId, dutyId: p.dutyId,
    x: p.x, y: p.y, vx: p.vx, vy: p.vy, tx: p.tx, ty: p.ty, habits: [...p.habits],
    sentOff: !!p.sentOff, injuredOff: !!p.injuredOff };
}
function isRecovery(e, a, intent) {
  return intent?.type === "dribble" && Math.abs(intent.ty - (e.targetGoalY(a.team) - e.attackDir(a.team) * 13)) < 1e-8 &&
    (intent.tx === 10 || intent.tx === 90);
}
function play(seed, observed) {
  const rng = seeded(seed);
  let draws = 0;
  const e = new SimEngine(club(`h${seed}`), club(`a${seed}`), {
    random: () => { draws++; return rng(); }, simulationProfile: profile,
    timeStep: dt, separationPasses: profile === "background" ? 4 : 8,
  });
  let current = null;
  if (observed) {
    for (const name of ["_bestCutback", "_bestCross", "_passCandidates"]) {
      const original = e[name];
      e[name] = function(...args) {
        const result = original.apply(this, args);
        if (current) current.options.push({ method: name, choices: (Array.isArray(result) ? result : result ? [result] : [])
          .map((p) => ({ playerId: p.agent?.id, value: p.value, x: p.tx, y: p.ty,
            distance: p.agent ? metres(this.ball, p.agent) : null })) });
        return result;
      };
    }
    const original = e._decideOnBall;
    e._decideOnBall = function(a) {
      const goalY = this.targetGoalY(a.team);
      const wide = Math.abs(a.x - 50) * mx >= 20.16 && Math.abs(a.y - goalY) * my < 20 &&
        this.ball.owner === a.id && !this.ball.restartType && this.t >= (this.deadBallUntil || 0);
      if (!wide) return original.call(this, a);
      const previous = a.intent ? { ...a.intent } : null;
      const wasRecovery = isRecovery(this, a, previous);
      const remaining = wasRecovery ? metres(a, { x: previous.tx, y: previous.ty }) : null;
      current = { seed, t: this.t, playerId: a.id, x: a.x, y: a.y, attackSince: this._teamAttackSince[a.team],
        previous, options: [], wasRecovery, remaining };
      const result = original.call(this, a);
      const after = a.intent ? { ...a.intent } : null;
      const recovery = isRecovery(this, a, after);
      const passing = this.ball.state === "pass" || a.pendingBallAction?.type === "pass";
      const prematureReversal = wasRecovery && remaining > 1.5 && !passing && after?.type === "dribble" &&
        (after.ty - a.y) * this.attackDir(a.team) > 0;
      Object.assign(current, { after, recovery, passing, prematureReversal,
        ballState: this.ball.state, pendingAction: a.pendingBallAction?.type || null });
      decisions.push(current);
      if (prematureReversal && examples.length < 12) examples.push({ ...current, players: this.agents.map(point) });
      current = null;
      return result;
    };
  }
  const frames = createHash("sha256");
  let episode = null;
  const finish = (reason) => {
    if (episode) episodes.push({ ...episode, seconds: round(e.t - episode.at), reason });
    episode = null;
  };
  for (let step = 0; step < Math.round(5400 / dt); step++) {
    e.step(dt);
    if (seed === 372000) frames.update(JSON.stringify(e.snapshot()));
    if (!observed) continue;
    const b = e.ball;
    const a = b.owner && e.agentById(b.owner);
    const wide = a && ["held", "control"].includes(b.state) && !b.restartType && e.t >= (e.deadBallUntil || 0) &&
      Math.abs(b.x - 50) * mx >= 20.16 && Math.abs(b.y - e.targetGoalY(a.team)) * my < 16.5;
    if (!wide) { finish(b.owner ? "left-region" : b.state); continue; }
    const key = `${a.id}:${e._teamAttackSince[a.team]}`;
    if (episode && episode.key !== key) finish("possession-changed");
    if (!episode) episode = { seed, key, playerId: a.id, at: e.t, x: b.x, y: b.y };
  }
  finish("match-end");
  return { seed, score: e.score, draws, stateHash: hash(e.snapshot()), eventsHash: hash(e.events),
    framesHash: seed === 372000 ? frames.digest("hex") : null };
}
for (let i = 0; i < count; i++) {
  const seed = 372000 + i;
  const bare = i === 0 ? play(seed, false) : null;
  const measured = play(seed, true);
  if (bare) assert.deepEqual(measured, bare, "observation changed the actual match");
  matches.push(measured);
}
const recovering = decisions.filter((row) => row.wasRecovery && row.remaining > 1.5);
const summary = { label, profile, matches, observerComparedSeed: 372000,
  engineSha256: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  preloads: process.execArgv, createdAt: new Date().toISOString(), decisions: decisions.length,
  recoveryAttempts: decisions.filter((row) => row.recovery && !row.wasRecovery).length,
  decisionsDuringRecovery: recovering.length,
  recoveryContinuations: recovering.filter((row) => row.recovery && !row.passing).length,
  recoveryPasses: recovering.filter((row) => row.passing).length,
  prematureReversals: decisions.filter((row) => row.prematureReversal).length,
  wideCarrySecondsPerMatch: round(episodes.reduce((sum, row) => sum + row.seconds, 0) / count),
  longestWideCarrySeconds: Math.max(0, ...episodes.map((row) => row.seconds)),
  wideCarriesOver30Seconds: episodes.filter((row) => row.seconds >= 30).length,
  wideCarriesOver60Seconds: episodes.filter((row) => row.seconds >= 60).length };
writeFileSync(output, `${JSON.stringify({ summary, episodes, decisions, examples }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
