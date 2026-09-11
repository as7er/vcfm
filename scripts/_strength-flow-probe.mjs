// Observe the unchanged strong/weak fixtures used by match-realism-audit.
// Read only actual state/events; never repeat a tactical choice or draw RNG.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";

const count = Math.max(1, Number(process.argv[2]) || 24);
const profile = process.argv[3] === "background" ? "background" : "standard";
const label = process.argv[4] || "current";
assert.match(label, /^[a-z0-9-]+$/);
const dt = profile === "background" ? 0.3 : SIM.DT;
const directory = new URL("../.tmp-continuity/global-movement/strength/", import.meta.url);
mkdirSync(directory, { recursive: true });
const output = new URL(`${label}-${profile}.json`, directory);
assert.ok(!existsSync(output), "use a new evidence label");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const round = (value) => Number(value.toFixed(6));
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function makeClub(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const attributes = ["pace", "shooting", "passing", "dribbling", "defending", "physical",
    "finishing", "tackling", "marking", "strength", "stamina", "vision", "reflexes",
    "handling", "positioning", "kicking"];
  const players = roles.map((pos, index) => {
    const rating = Math.max(1, Math.min(20, ability + ((index * 7 + ability) % 5) - 2));
    const id = `${name}-p${index}`;
    return { id, name: id, pos, number: index + 1, fitness: 100,
      attrs: Object.fromEntries(attributes.map((key) => [key, rating])) };
  });
  return { id: name, name, players, tactics: { formation: "4-3-3",
    lineup: players.map((player) => player.id), pressing: 3, tempo: 3,
    defensiveLine: 3, style: "balanced" } };
}
const blank = () => ({ heldSeconds: 0, boxSeconds: 0, finalThirdSeconds: 0,
  shots: 0, distanceTotal: 0, under16: 0, openGoal: 0, goals: 0,
  passes: 0, receives: 0, interceptions: 0, tackles: 0, corners: 0,
  penalties: 0, penaltyGoals: 0, ownGoals: 0, offside: 0, shotsByRole: {} });
function run(seed, strongAtHome, observe) {
  const rng = seededRandom(seed), originalRandom = Math.random;
  let draws = 0;
  Math.random = () => { draws++; return rng(); };
  try {
    const e = new SimEngine(makeClub(`home-${seed}`, strongAtHome ? 15 : 11),
      makeClub(`away-${seed}`, strongAtHome ? 11 : 15), {
        simulationProfile: profile, timeStep: dt, separationPasses: profile === "background" ? 4 : 8,
      });
    const teams = { home: blank(), away: blank() };
    const frames = createHash("sha256");
    for (let step = 0; step < Math.round(5400 / dt); step++) {
      if (observe && e.t >= (e.deadBallUntil || 0) && !e.celebrateUntil &&
          e.ball.owner && ["held", "control"].includes(e.ball.state)) {
        const owner = e.agentById(e.ball.owner), row = teams[owner.team];
        const depth = Math.abs(e.ball.y - e.targetGoalY(owner.team)) * SIM.PITCH_H_METRES / SIM.FIELD_H;
        row.heldSeconds += dt;
        if (depth <= 38) row.finalThirdSeconds += dt;
        if (depth <= 16.5 && Math.abs(e.ball.x - 50) * SIM.PITCH_W_METRES / SIM.FIELD_W <= 20.16) row.boxSeconds += dt;
      }
      e.step(dt);
      if (seed === 265000) frames.update(JSON.stringify(e.snapshot()));
    }
    for (const event of e.events) {
      const row = teams[event.team];
      if (!row) continue;
      if (event.type === "shot") {
        row.shots++;
        row.distanceTotal += Number(event.distance) || 18;
        row.under16 += Number(event.distance < 16);
        row.openGoal += Number(!!event.openGoal);
        const role = e.agentById(event.agentId)?.role || "unknown";
        row.shotsByRole[role] = (row.shotsByRole[role] || 0) + 1;
      } else if (event.type === "goal") {
        row.goals++;
        row.penaltyGoals += Number(!!event.penalty);
        row.ownGoals += Number(!!event.ownGoal);
      } else if (event.type === "pass") row.passes++;
      else if (event.type === "receive") row.receives++;
      else if (event.type === "intercept") row.interceptions++;
      else if (event.type === "tackle") row.tackles++;
      else if (event.type === "corner") row.corners++;
      else if (event.type === "offside") row.offside++;
      else if (event.type === "foul" && event.penalty) teams[event.team === "home" ? "away" : "home"].penalties++;
    }
    return { seed, strongAtHome, score: { ...e.score }, teams, draws,
      eventHash: hash(e.events), stateHash: hash(e.snapshot()),
      frameHash: seed === 265000 ? frames.digest("hex") : null,
      resultEvents: e.events.filter((event) => ["shot", "goal", "save", "foul", "offside"].includes(event.type)) };
  } finally { Math.random = originalRandom; }
}
const matches = [];
for (let i = 0; i < count; i++) {
  const match = run(265000 + i, i % 2 === 0, true);
  if (i === 0) {
    const control = run(265000 + i, i % 2 === 0, false);
    for (const field of ["score", "draws", "eventHash", "stateHash", "frameHash"])
      assert.deepEqual(match[field], control[field], `observing must preserve ${field}`);
  }
  matches.push(match);
}
const totals = { strong: blank(), weak: blank() };
let points = 0;
for (const match of matches) {
  const strongTeam = match.strongAtHome ? "home" : "away", weakTeam = match.strongAtHome ? "away" : "home";
  points += match.score[strongTeam] > match.score[weakTeam] ? 3 : match.score[strongTeam] === match.score[weakTeam] ? 1 : 0;
  for (const [side, team] of [["strong", strongTeam], ["weak", weakTeam]]) {
    const source = match.teams[team], target = totals[side];
    for (const key of Object.keys(target)) {
      if (key === "shotsByRole") {
        for (const [role, n] of Object.entries(source[key])) target[key][role] = (target[key][role] || 0) + n;
      } else target[key] += source[key];
    }
  }
}
const summary = { profile, count, points, pointsPerMatch: round(points / count),
  totals: Object.fromEntries(Object.entries(totals).map(([side, row]) => [side, {
    ...row, heldSeconds: round(row.heldSeconds), boxSeconds: round(row.boxSeconds),
    finalThirdSeconds: round(row.finalThirdSeconds), distanceTotal: round(row.distanceTotal),
    conversion: round(100 * row.goals / Math.max(1, row.shots)),
    completion: round(100 * row.receives / Math.max(1, row.passes)),
    meanDistance: round(row.distanceTotal / Math.max(1, row.shots)),
  }])) };
writeFileSync(output, `${JSON.stringify({ summary, matches }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
