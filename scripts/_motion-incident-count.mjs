// Count motion-integrity incidents over an arbitrary number of matches.
//
// match-motion-integrity-audit.mjs is a guardrail: it runs 6 background seeds and
// asserts absolute ceilings. Those ceilings are fine for catching regressions, but
// with counts around 5-7 the sample cannot resolve a halving -- the two-sample
// test on 7 vs 3 is only p ~ 0.34. This script runs the same monitor over more
// matches so a candidate comparison has some power.
//
// Seeds start at 22901 by default, which makes the 6-seed background sample inside
// the audit a strict subset of this run -- the same nesting trick the 96-match
// realism sample uses against its 24-match quarter. Pass the same seed start and
// match count to two runs to get a paired comparison.
//
// Usage:
//   node scripts/_motion-incident-count.mjs --matches 24
//   node --import ./scripts/_movement-no-eligibility-candidate.mjs \
//     scripts/_motion-incident-count.mjs --matches 24
import { MOTION_INCIDENT_TYPES, MotionIntegrityMonitor } from "../js/match-motion-integrity.js";
import { SimEngine } from "../js/sim/engine.js";

const ATTR_KEYS = [
  "pace", "acceleration", "agility", "balance", "strength", "physical",
  "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
  "marking", "stamina", "positioning", "reflexes", "handling", "kicking",
  "heading", "crossing", "decisions", "firstTouch",
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Same club as match-motion-integrity-audit.mjs, so the counts stay comparable.
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
    attrs: Object.fromEntries(ATTR_KEYS.map((key) => [key, strength])),
  }));
  return {
    id,
    name: id,
    short: id,
    color: id.includes("home") ? "#2563eb" : "#dc2626",
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      style: "balanced",
      pressing: 3,
      tempo: 3,
      width: 3,
      defensiveLine: 3,
      roles: [],
      duties: [],
    },
  };
}

function runMatch(seed, profile) {
  const engine = new SimEngine(
    makeClub(`home-${seed}`),
    makeClub(`away-${seed}`),
    { random: seededRandom(seed), simulationProfile: profile }
  );
  const monitor = new MotionIntegrityMonitor({
    windowSeconds: 12,
    sampleIntervalSeconds: profile === "background" ? 0.25 : 0.075,
    metadata: { matchSeed: seed, profile },
  });
  const step = profile === "background" ? 0.3 : 0.1;
  while (engine.t < 90 * 60 - 1e-9) {
    engine.step(step);
    const snapshot = engine.snapshot();
    monitor.record(snapshot, snapshot, { label: "incident-count" });
  }
  const summary = monitor.auditSummary();
  return {
    seed,
    severe: summary.severe,
    warnings: summary.warnings,
    byType: { ...summary.byType },
    goals: engine.score.home + engine.score.away,
  };
}

function parseArgs(argv) {
  const options = { matches: 24, seedStart: 22901, profile: "background" };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--matches") options.matches = Number(argv[++index]);
    else if (arg === "--seed-start") options.seedStart = Number(argv[++index]);
    else if (arg === "--profile") options.profile = argv[++index];
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const seeds = Array.from({ length: options.matches }, (_, index) => options.seedStart + index);
const samples = seeds.map((seed) => runMatch(seed, options.profile));

const totals = samples.reduce((acc, sample) => {
  acc.severe += sample.severe;
  acc.warnings += sample.warnings;
  acc.goals += sample.goals;
  for (const [type, count] of Object.entries(sample.byType)) {
    acc.byType[type] = (acc.byType[type] || 0) + count;
  }
  return acc;
}, { severe: 0, warnings: 0, goals: 0, byType: {} });

const perMatch = (value) => Number((value / Math.max(1, samples.length)).toFixed(3));

console.log(JSON.stringify({
  profile: options.profile,
  matches: samples.length,
  seedRange: [seeds[0], seeds[seeds.length - 1]],
  totals,
  perMatch: {
    warnings: perMatch(totals.warnings),
    goals: perMatch(totals.goals),
    ...Object.fromEntries(Object.entries(totals.byType).map(([type, count]) => [type, perMatch(count)])),
  },
  counts: Object.fromEntries(Object.keys(totals.byType).map((type) => [
    type,
    samples.filter((sample) => (sample.byType[type] || 0) > 0).length,
  ])),
  // Per-match breakdown so two runs on the same seeds can be paired.
  perMatchCounts: samples.map((sample) => ({
    seed: sample.seed,
    churn: sample.byType[MOTION_INCIDENT_TYPES.PLAYER_TARGET_CHURN] || 0,
    oscillation: sample.byType[MOTION_INCIDENT_TYPES.PLAYER_OSCILLATION] || 0,
    warnings: sample.warnings,
  })),
}, null, 2));
