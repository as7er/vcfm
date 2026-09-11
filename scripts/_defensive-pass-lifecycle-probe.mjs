// Observe assigned interception runs through real motion and possession changes.
// Reuse archived full-match hashes so observing all six games needs no extra
// control runs. Only wrappers around methods already called by the engine run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";

const profile = process.argv[2] === "background" ? "background" : "standard";
const referenceLabel = process.argv[3] || "pass-plan";
const label = process.argv[4] || referenceLabel;
const count = Math.max(1, Number(process.argv[5]) || 6);
for (const value of [referenceLabel, label]) assert.match(value, /^[a-z0-9-]+$/);
const root = new URL("../.tmp-continuity/global-movement/", import.meta.url);
const reference = JSON.parse(readFileSync(new URL(`${referenceLabel}-${profile}.json`, root))).summary;
const directory = new URL("defensive-pass/", root);
mkdirSync(directory, { recursive: true });
const output = new URL(`${label}-${profile}.json`, directory);
assert.ok(!existsSync(output), "use a fresh evidence label");
const dt = profile === "background" ? 0.3 : SIM.DT;
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W, my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const metres = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const round = (value) => Number(value.toFixed(6));
const median = (values) => values.length ? round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]) : null;
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
// Identical inputs to _global-movement-probe.mjs, including its player IDs.
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
const player = (a) => ({ id: a.id, team: a.team, role: a.role, x: a.x, y: a.y,
  tx: a.tx, ty: a.ty, vx: a.vx, vy: a.vy, heading: a.heading, fsm: a.fsm,
  sentOff: !!a.sentOff, injuredOff: !!a.injuredOff });
const ball = (b) => ({ x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz,
  state: b.state, owner: b.owner, kickTeam: b.kickTeam, kickX: b.kickX, kickY: b.kickY,
  lastKicker: b.lastKicker, lastPassAt: b.lastPassAt, receiverId: b.receiverId,
  targetX: b.targetX, targetY: b.targetY, expectedAt: b.expectedAt, restartType: b.restartType });
const rows = [], matches = [], motionFailures = [], observations = [], passRoutes = [];
for (let i = 0; i < count; i++) {
  const seed = 372000 + i, rng = seeded(seed);
  let draws = 0;
  const e = new SimEngine(club(`h${seed}`), club(`a${seed}`), {
    random: () => { draws++; return rng(); }, simulationProfile: profile,
    timeStep: dt, separationPasses: profile === "background" ? 4 : 8,
  });
  const active = new Map();
  const assessments = new Map();
  let route = null;
  const finishRoute = (reason) => {
    if (!route) return;
    route.end = { t: e.t, reason, ball: ball(e.ball) };
    route = null;
  };
  const risk = e._passInterceptionRisk;
  if (risk) e._passInterceptionRisk = function(a, option) {
    const result = risk.call(this, a, option);
    let current = assessments.get(a.id);
    if (!current || current.t !== this.t) {
      current = { t: this.t, options: new Map() };
      assessments.set(a.id, current);
    }
    const key = JSON.stringify([option.agent?.id, option.tx, option.ty]);
    current.options.set(key, { t: this.t, ball: ball(this.ball), passer: player(a),
      receiver: option.agent && player(option.agent), risk: structuredClone(result),
      defender: result && player(this.agentById(result.defenderId)) });
    return result;
  };
  const pass = e._pass;
  e._pass = function(a, option, ...args) {
    const owned = this.ball.owner === a.id;
    const before = ball(this.ball);
    const assessment = assessments.get(a.id)?.options.get(JSON.stringify([option.agent?.id, option.tx, option.ty]));
    const result = pass.call(this, a, option, ...args);
    if (owned && this.ball.state === "pass" && this.ball.lastKicker === a.id && this.ball.lastPassAt === this.t) {
      finishRoute("new-pass");
      route = { seed, team: a.team, passerId: a.id, intendedId: option.agent?.id,
        cross: !!option.cross, through: !!option.through, cutback: !!option.cutback,
        before, start: { t: this.t, ball: ball(this.ball), passer: player(a) },
        assessment: assessment ? structuredClone(assessment) : null, flight: [] };
      passRoutes.push(route);
    }
    return result;
  };
  const finish = (id, reason) => {
    const record = active.get(id);
    if (!record) return;
    const a = e.agentById(id);
    record.end = { t: e.t, reason, player: player(a), ball: ball(e.ball) };
    record.netMetres = metres(record.start.player, a);
    active.delete(id);
  };
  const synchronize = () => {
    if (route) {
      const b = e.ball;
      if (b.owner) finishRoute(e.agentById(b.owner)?.team === route.team ? "team-control" : "opponent-control");
      else if (b.restartType || e.t < e.deadBallUntil) finishRoute("restart");
      else if (b.state !== "pass") finishRoute(`ball-${b.state}`);
      else if (b.lastPassAt !== route.start.t || b.kickTeam !== route.team) finishRoute("new-pass");
    }
    for (const [id, record] of active) {
      const a = e.agentById(id), b = e.ball;
      if (a.sentOff || a.injuredOff) finish(id, "player-left");
      else if (b.owner) {
        const owner = e.agentById(b.owner);
        finish(id, b.owner === id ? "defender-control" : owner?.team === a.team ? "teammate-control" : "opponent-control");
      } else if (b.restartType || e.t < e.deadBallUntil) finish(id, "restart");
      else if (b.lastPassAt !== record.passAt || b.kickTeam !== record.kickTeam) finish(id, "new-pass");
      else if (b.state !== "pass") finish(id, `ball-${b.state}`);
    }
  };
  const think = e._thinkDefend;
  e._thinkDefend = function(a, ...args) {
    synchronize();
    const result = think.call(this, a, ...args);
    const point = a._passIntercept, b = this.ball;
    if (!point) { finish(a.id, "assignment-ended"); return result; }
    let record = active.get(a.id);
    if (!record) {
      record = { seed, id: a.id, passAt: b.lastPassAt, kickTeam: b.kickTeam,
        start: { t: this.t, player: player(a), ball: ball(b), point: { ...point } },
        commands: [], motion: [], flight: [], travelMetres: 0, minBallGapMetres: metres(a, b) };
      rows.push(record);
      active.set(a.id, record);
    }
    record.commands.push({ t: this.t, point: { ...point }, player: player(a), ball: ball(b),
      plan: { passAt: this._defPlans[a.team].passAt, interceptAt: this._defPlans[a.team].interceptAt,
        job: { ...this._defPlans[a.team].jobs.get(a.id) } } });
    return result;
  };
  const integrate = e._integrate;
  e._integrate = function(a, stepDt) {
    // Candidate planners may project a private player copy through the same
    // controller. Its ID does not make that calculation an actual run.
    if (this.agentById(a.id) !== a) return integrate.call(this, a, stepDt);
    synchronize();
    const record = active.get(a.id), before = record ? player(a) : null;
    const point = a._passIntercept;
    // A stale stored object must never activate a run in a different task.
    if (point && point.passAt === this.ball.lastPassAt && this.ball.kickTeam !== a.team &&
        !this.ball.owner && this.ball.state === "pass" && !Number.isFinite(a._cornerArrivalAt) &&
        (a.sentOff || a.injuredOff || a.role === "GK" || a.fsm !== "press")) {
      motionFailures.push({ seed, t: this.t, player: player(a), point: { ...point }, ball: ball(this.ball) });
    }
    if (record && point) {
      const error = metres({ x: a.tx, y: a.ty }, point);
      if (error > 1e-6) motionFailures.push({ seed, t: this.t, id: a.id, error, point: { ...point }, before });
    }
    const result = integrate.call(this, a, stepDt);
    if (record) {
      const after = player(a), distance = metres(before, after);
      record.travelMetres += distance;
      record.motion.push({ t: this.t, dt: stepDt, before, after, distance });
    }
    return result;
  };
  const stepBall = e._stepBall;
  e._stepBall = function(stepDt) {
    const result = stepBall.call(this, stepDt);
    if (route) {
      const predicted = route.assessment?.risk?.defenderId;
      route.flight.push({ t: this.t + stepDt, ball: ball(this.ball),
        players: this.agents.filter((a) => !a.sentOff && !a.injuredOff &&
          (a.id === predicted || a.id === route.intendedId || metres(a, this.ball) <= 4))
          .map((a) => ({ ...player(a), point: a._passIntercept && { ...a._passIntercept } })) });
    }
    for (const [id, record] of active) {
      const a = this.agentById(id);
      const gap = metres(a, this.ball);
      record.minBallGapMetres = Math.min(record.minBallGapMetres, gap);
      record.flight.push({ t: this.t + stepDt, ball: ball(this.ball), player: player(a), gap });
    }
    return result;
  };
  const resolve = e._resolvePossession;
  e._resolvePossession = function(...args) {
    const result = resolve.apply(this, args);
    synchronize();
    return result;
  };
  const frames = createHash("sha256");
  for (let step = 0; step < Math.round(5400 / dt); step++) {
    e.step(dt);
    if (i === 0) frames.update(JSON.stringify(e.snapshot()));
    synchronize();
  }
  for (const id of active.keys()) finish(id, "match-end");
  finishRoute("match-end");
  const match = { seed, score: e.score, draws, stateHash: hash(e.snapshot()), eventsHash: hash(e.events),
    frameHash: i === 0 ? frames.digest("hex") : null };
  assert.deepEqual(match, reference.matches.find((m) => m.seed === seed), "observer changed the archived match");
  matches.push(match);
  observations.push({ seed, stats: structuredClone(e.stats) });
}
const outcomes = {};
for (const row of rows) outcomes[row.end.reason] = (outcomes[row.end.reason] || 0) + 1;
const summary = { label, profile, matches, comparedMatches: matches.length, frameComparedSeed: 372000,
  engineSha256: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  preloads: process.execArgv, createdAt: new Date().toISOString(),
  runs: rows.length, distinctPasses: new Set(rows.map((r) => `${r.seed}:${r.kickTeam}:${r.passAt}`)).size,
  commands: rows.reduce((n, r) => n + r.commands.length, 0),
  motionSteps: rows.reduce((n, r) => n + r.motion.length, 0), motionFailures: motionFailures.length,
  medianTravelMetres: median(rows.map((r) => r.travelMetres)), medianNetMetres: median(rows.map((r) => r.netMetres)),
  medianClosestBallMetres: median(rows.map((r) => r.minBallGapMetres)),
  withinBaseControlRadius: rows.filter((r) => r.minBallGapMetres <= SIM.CONTROL_RADIUS_METRES).length,
  outcomes,
  passRoutes: { total: passRoutes.length,
    assessed: passRoutes.filter((r) => r.assessment).length,
    risk: passRoutes.filter((r) => r.assessment?.risk).length,
    riskyTeamControl: passRoutes.filter((r) => r.assessment?.risk && r.end?.reason === "team-control").length,
    riskyOpponentControl: passRoutes.filter((r) => r.assessment?.risk && r.end?.reason === "opponent-control").length,
    clearOpponentControl: passRoutes.filter((r) => r.assessment && !r.assessment.risk && r.end?.reason === "opponent-control").length,
    medianAssessmentAge: median(passRoutes.filter((r) => r.assessment).map((r) => r.start.t - r.assessment.t)) } };
writeFileSync(output, `${JSON.stringify({ summary, rows, observations, motionFailures, passRoutes }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
assert.deepEqual(motionFailures, [], "interception motion must execute the current valid target");
