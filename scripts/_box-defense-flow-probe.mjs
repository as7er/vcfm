// Passive decomposition of the exact box-defending audit sample.
// Read actual decisions and targets; never call a decision helper to observe it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";

const count = Math.max(1, Number(process.argv[2]) || 12);
const profile = process.argv[3] === "background" ? "background" : "standard";
const label = process.argv[4] || "current";
assert.match(label, /^[a-z0-9-]+$/);
const dt = profile === "background" ? 0.3 : SIM.DT;
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W, my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const distance = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
const speed = (a) => Math.hypot((a.vx || 0) * mx, (a.vy || 0) * my);
const round = (n) => Number(n.toFixed(6));
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const directory = new URL("../.tmp-continuity/global-movement/defense-flow/", import.meta.url);
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
function club(name) {
  const keys = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
    "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning",
    "kicking", "decisions"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${name}-p${i}`, name: `${name}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 12 + ((i * 7 + 12) % 5) - 2])) }));
  return { id: name, name, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced" } };
}
const groups = {}, matches = [], acquisitions = [], episodes = [];
const total = fresh();
function fresh() {
  return { ticks: 0, nearest: 0, nearestDef: 0, within2: 0, nearestOwner: 0,
    presser: 0, presserCount: 0, pressTarget: 0, pressGap: 0, pressSpeed: 0, ownerSpeed: 0,
    markTicks: 0, defenseTicks: 0, staleOwnerTicks: 0, staleStateTicks: 0, gapOver3: 0 };
}
function add(stats, row) {
  stats.ticks++;
  for (const key of ["nearest", "nearestDef", "within2", "nearestOwner", "ownerSpeed", "markTicks", "defenseTicks"])
    stats[key] += row[key];
  if (row.presser != null) {
    stats.presserCount++;
    for (const key of ["presser", "pressTarget", "pressGap", "pressSpeed"]) stats[key] += row[key];
  }
  stats.staleOwnerTicks += +row.staleOwner;
  stats.staleStateTicks += +row.staleState;
  stats.gapOver3 += +(row.nearest > 3);
}
function grouped(dimension, key, row) {
  const group = groups[dimension] ||= {};
  add(group[key] ||= fresh(), row);
}
function summarize(stats) {
  const mean = (key, divisor = stats.ticks) => round(stats[key] / Math.max(1, divisor));
  return { ticks: stats.ticks, sharePct: round(stats.ticks / Math.max(1, total.ticks) * 100),
    nearest: mean("nearest"), nearestDef: mean("nearestDef"), within2: mean("within2"),
    nearestOwner: mean("nearestOwner"), ownerSpeed: mean("ownerSpeed"),
    presser: mean("presser", stats.presserCount), pressTarget: mean("pressTarget", stats.presserCount),
    pressGap: mean("pressGap", stats.presserCount), pressSpeed: mean("pressSpeed", stats.presserCount),
    markSharePct: round(stats.markTicks / Math.max(1, stats.defenseTicks) * 100),
    staleOwnerPct: mean("staleOwnerTicks") * 100, staleStatePct: mean("staleStateTicks") * 100,
    gapOver3Pct: mean("gapOver3") * 100 };
}
function view(a, plan) {
  return { id: a.id, team: a.team, role: a.role, roleId: a.roleId, x: a.x, y: a.y,
    tx: a.tx, ty: a.ty, vx: a.vx, vy: a.vy, fsm: a.fsm, heading: a.heading,
    intent: a.intent && { ...a.intent }, pending: a.pendingBallAction && { ...a.pendingBallAction },
    job: plan?.jobs.get(a.id), sentOff: !!a.sentOff, injuredOff: !!a.injuredOff };
}
function play(seed, observed) {
  const originalRandom = Math.random, rng = seeded(seed);
  let draws = 0;
  Math.random = () => { draws++; return rng(); };
  try {
    const e = new SimEngine(club(`home-${seed}`), club(`away-${seed}`), {
      simulationProfile: profile, timeStep: dt, separationPasses: profile === "background" ? 4 : 8,
    });
    const local = fresh(), frames = createHash("sha256"), plansAt = {}, receipts = new Map();
    let ownerSince = 0, lastOwner = null, episode = null;
    const finish = () => {
      if (!episode) return;
      episode.seconds = round(episode.ticks * dt);
      episode.meanNearest = round(episode.nearestSum / episode.ticks);
      if (episode.seconds >= 1) episodes.push(episode);
      episode = null;
    };
    if (observed) {
      const begin = e._beginBallControl;
      e._beginBallControl = function(a, options) {
        const row = { seed, at: this.t, id: a.id, team: a.team, x: this.ball.x, y: this.ball.y,
          from: this.ball.state, kickTeam: this.ball.kickTeam, kickX: this.ball.kickX,
          kickY: this.ball.kickY, kind: options?.kind || "receive" };
        const result = begin.call(this, a, options);
        receipts.set(a.id, row);
        acquisitions.push(row);
        return result;
      };
      const refresh = e._refreshDefPlan;
      e._refreshDefPlan = function(team, ...args) {
        const jobs = this._defPlans[team]?.jobs;
        const result = refresh.call(this, team, ...args);
        if (result.jobs !== jobs) plansAt[team] = this.t;
        return result;
      };
    }
    for (let step = 0; step < Math.round(5400 / dt); step++) {
      e.step(dt);
      if (seed === 165000) frames.update(JSON.stringify(e.snapshot()));
      if (!observed) continue;
      const b = e.ball;
      if (b.owner !== lastOwner) { ownerSince = e.t; lastOwner = b.owner; }
      const owner = b.owner && e.agentById(b.owner);
      const defendingTeam = owner?.team === "home" ? "away" : "home";
      if (!owner || owner.role === "GK" || !(b.x > 22 && b.x < 78 &&
        (defendingTeam === "home" ? b.y >= 84 : b.y <= 16))) { finish(); continue; }
      const plan = e._defPlans[defendingTeam];
      const defenders = e.agents.filter((a) => a.team === defendingTeam && !a.sentOff && a.role !== "GK");
      const nearest = defenders.reduce((a, p) => !a || distance(p, b) < distance(a, b) ? p : a, null);
      const presser = defenders.find((a) => plan?.jobs.get(a.id)?.type === "press");
      const receipt = receipts.get(owner.id);
      const age = receipt && receipt.at >= ownerSince - dt - 1e-6 ? e.t - receipt.at : e.t - ownerSince;
      const ageBin = age < 0.5 ? "0-0.5" : age < 1 ? "0.5-1" : age < 2 ? "1-2" : age < 5 ? "2-5" : "5+";
      const state = e.t < e.deadBallUntil || b.restartType ? "restart" : b.state === "control" ? "control" :
        owner.pendingBallAction ? `prepare-${owner.pendingBallAction.action}` : owner.intent?.type || b.state;
      const depth = Math.abs(b.y - e.targetGoalY(owner.team)) * my;
      const ownerSpeed = speed(owner);
      const direction = ownerSpeed < 1 ? "settled" : Math.abs(owner.vy * my) < Math.abs(owner.vx * mx) ?
        "lateral" : owner.vy * e.attackDir(owner.team) > 0 ? "forward" : "backward";
      const target = presser && { x: presser.tx, y: presser.ty };
      const nearestJob = plan?.jobs.get(nearest.id)?.type || "none";
      const row = { nearest: distance(nearest, b), nearestOwner: Math.min(...defenders.map((a) => distance(a, owner))),
        nearestDef: Math.min(...defenders.filter((a) => a.role === "DEF").map((a) => distance(a, b))),
        within2: defenders.filter((a) => distance(a, b) < 2).length, ownerSpeed,
        presser: presser ? distance(presser, b) : null, pressTarget: presser ? distance(target, b) : null,
        pressGap: presser ? distance(presser, target) : null, pressSpeed: presser ? speed(presser) : null,
        markTicks: defenders.filter((a) => plan?.jobs.get(a.id)?.type === "mark").length,
        defenseTicks: defenders.length, staleOwner: plan?.ownerId !== owner.id, staleState: plan?.ballState !== b.state };
      add(total, row); add(local, row);
      for (const [dimension, key] of Object.entries({ state, age: ageBin, stateAge: `${state}:${ageBin}`, direction,
        nearestJob, nearestRole: nearest.role, depth: depth < 5.5 ? "0-5.5" : depth < 11 ? "5.5-11" : "11-16.8",
        planState: row.staleOwner ? "stale-owner" : row.staleState ? "stale-state" : "current",
        nearestIsPresser: nearest === presser ? "yes" : "no",
        pressApproach: !presser ? "none" : (presser.y - owner.y) * e.attackDir(owner.team) > 0 ? "goal-side" : "behind",
        activityAge: `${direction}:${ageBin}` })) grouped(dimension, key, row);
      if (row.nearest > 3 && state !== "restart") {
        if (episode?.ownerId !== owner.id) finish();
        if (!episode) episode = { seed, at: e.t, ownerId: owner.id, ticks: 0, nearestSum: 0, views: [] };
        episode.ticks++; episode.nearestSum += row.nearest;
        if (!episode.views.length || e.t - episode.views.at(-1).t >= 0.49) {
          episode.views.push({ t: e.t, row, age, state, ball: { x: b.x, y: b.y, state: b.state, owner: b.owner },
            plan: { ownerId: plan.ownerId, ballState: plan.ballState, phase: plan.phase,
              refreshedAt: plansAt[defendingTeam], until: plan.until },
            players: e.agents.map((a) => view(a, plan)) });
        }
      } else finish();
    }
    finish();
    return { seed, score: e.score, draws, stateHash: hash(e.snapshot()), eventsHash: hash(e.events),
      framesHash: seed === 165000 ? frames.digest("hex") : null, ...(observed ? { sample: local } : {}) };
  } finally { Math.random = originalRandom; }
}
for (let i = 0; i < count; i++) {
  const seed = 165000 + i;
  const bare = i === 0 ? play(seed, false) : null;
  const observed = play(seed, true);
  if (bare) {
    const { sample, ...outcome } = observed;
    assert.deepEqual(outcome, bare, "observation changed frames, state, events or RNG");
  }
  matches.push(observed);
}
const summary = { label, profile, count, createdAt: new Date().toISOString(),
  fixture: "box-defending-audit (same names, attributes, tactics, seeds and sampling clock)",
  observerComparedSeed: 165000, preloads: process.execArgv,
  engineSha256: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  total: summarize(total), groups: Object.fromEntries(Object.entries(groups).map(([dimension, bins]) =>
    [dimension, Object.fromEntries(Object.entries(bins).map(([key, stats]) => [key, summarize(stats)]))])),
  matches: matches.map((m) => ({ ...m, sample: summarize(m.sample) })),
  episodeCount: episodes.length, episodeSeconds: round(episodes.reduce((sum, r) => sum + r.seconds, 0)) };
writeFileSync(output, `${JSON.stringify({ summary, acquisitions, episodes }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
