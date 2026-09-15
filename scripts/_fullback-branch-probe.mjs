// Runs N full matches and prints per-match score/shot/goal. Use it as the ENTRY
// (not the preload): instrument it by running
//   node --import ./scripts/_fullback-branch-observer.mjs scripts/_fullback-branch-probe.mjs
// (observer injects a read-only tag into the fullback branch and prints a summary).
// A plain `node scripts/_fullback-branch-probe.mjs` run is the HEAD control: the two
// runs must produce identical per-match scores for the same seeds, which is the
// acceptance that the observer does not perturb the simulation.
import { SimEngine } from "../js/sim/engine.js";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function makeClub(id, strength = 12) {
  const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = positions.map((pos, index) => ({
    id: `${id}-${index}`,
    name: `${id} ${index + 1}`,
    pos,
    number: index + 1,
    age: 25,
    ovr: strength,
    potential: strength,
    fitness: 100,
    morale: 70,
    injured: 0,
    suspended: 0,
    attrs: Object.fromEntries([
      "pace", "acceleration", "agility", "balance", "strength", "physical",
      "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
      "marking", "stamina", "positioning", "reflexes", "handling", "kicking",
      "heading", "crossing", "decisions", "firstTouch",
    ].map((key) => [key, strength])),
  }));
  return {
    id,
    name: id,
    short: id,
    color: id.includes("home") ? "#2563eb" : "#dc2626",
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((p) => p.id),
      style: "balanced",
      pressing: 3, tempo: 3, width: 3, defensiveLine: 3,
      roles: [], duties: [],
    },
  };
}
export function runFullMatch(seed, profile) {
  const random = seededRandom(seed);
  const engine = new SimEngine(
    makeClub(`home-${seed}`, 12),
    makeClub(`away-${seed}`, 12),
    { random, simulationProfile: profile }
  );
  while (engine.t < 90 * 60 - 1e-9) engine.step(profile === "background" ? 0.3 : 0.1);
  const count = (team, type) => engine.events.filter((e) => e.team === team && e.type === type).length;
  return {
    seed, profile,
    score: [engine.score.home, engine.score.away],
    goals: engine.score.home + engine.score.away,
    shots: count("home", "shot") + count("away", "shot"),
  };
}

const backgroundSeeds = [22931, 22932, 22933, 22934, 22935, 22936];
const standardSeeds = [22941, 22942];
const matches = [];
for (const seed of backgroundSeeds) matches.push(runFullMatch(seed, "background"));
for (const seed of standardSeeds) matches.push(runFullMatch(seed, "standard"));

const observer = globalThis[Symbol.for("vcfm.fullback-branch-observer")];
if (observer && observer.summary) {
  const summary = observer.summary();
  const farBomb = summary.counts["bomb|far"] || 0;
  const farHome = summary.counts["home|far"] || 0;
  const farShare = farBomb + farHome ? farBomb / (farBomb + farHome) : null;
  if (summary.contradiction !== 0) throw new Error(`observer contradiction: ${summary.contradiction}`);
  console.log(
    `[instrumented] ${matches.length} matches, ${summary.total} fullback decisions, ` +
    `far-side bomb share ${farShare == null ? "n/a" : (100 * farShare).toFixed(1) + "%"}`
  );
  console.log(JSON.stringify({ summary, farBombShare: farShare == null ? null : +farShare.toFixed(4) }, null, 2));
}
console.log("perMatch=" + JSON.stringify(matches));