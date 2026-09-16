// Metrics-only sweep probe for the centre-back block-shift curve.
//
// Replicates `scripts/attack-shape-compaction-audit.mjs`'s measurement EXACTLY
// (same seeds, same clubs, same role-noGK sampling, same three thirds by ball
// position, same median-of-per-frame-lengths) but prints the numbers instead of
// asserting, so a curve configuration can be swept without the first failed
// assertion hiding the rest of the readings.
//
// The engine under test is whatever the `--import` preload provides, so pair it
// with a candidate, e.g.:
//
//   VCFM_CB_TAIL_GAIN=2 node --import ./scripts/_cb-tail-candidate.mjs \
//     scripts/_cb-tail-sweep.mjs standard
//
// Usage: node scripts/_cb-tail-sweep.mjs [standard|background] [seeds]
import { SimEngine, SIM } from "../js/sim/engine.js";

const PROFILE = process.argv[2] === "background" ? "background" : "standard";
const SEED_COUNT = Math.max(1, Number(process.argv[3]) || 4);
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05 m / y 格
const SAMPLE_STEPS = 5; // 与审计一致：每 0.5 秒
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => 372000 + i);

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
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const id = `${name}-p${index}`;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions",
    ]) attrs[key] = rating;
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((player) => player.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const lengthOf = (points) => {
  const depths = points.map((p) => p.y * MY);
  return Math.max(...depths) - Math.min(...depths);
};

const timeStep = PROFILE === "background" ? 0.3 : SIM.DT;
const separationPasses = PROFILE === "background" ? 4 : 8;
const acc = {
  own: [], middle: [], attack: [],
  attackAll: [], attackBackLine: [], attackForwardTop: [],
};

for (const seed of SEEDS) {
  const engine = new SimEngine(
    makeClub(`home-${seed}`, 15),
    makeClub(`away-${seed}`, 15),
    { random: seededRandom(seed), simulationProfile: PROFILE, timeStep, separationPasses }
  );
  const steps = Math.round((90 * 60) / timeStep);
  for (let step = 0; step < steps; step++) {
    engine.step(timeStep);
    if (step % SAMPLE_STEPS !== 0) continue;
    const live = engine.agents.filter((agent) => !agent.sentOff);
    for (const team of ["home", "away"]) {
      const squad = live.filter((agent) => agent.team === team);
      if (squad.length < 7) continue;
      const outfield = squad.filter((agent) => agent.role !== "GK");
      if (outfield.length < 7) continue;
      const ballL = engine.ball.y * MY;
      const progress = team === "home"
        ? (SIM.PITCH_H_METRES - ballL) / SIM.PITCH_H_METRES
        : ballL / SIM.PITCH_H_METRES;
      const phase = progress < 1 / 3 ? "own" : progress > 2 / 3 ? "attack" : "middle";
      acc[phase].push(lengthOf(outfield));
      if (phase !== "attack") continue;
      acc.attackAll.push(lengthOf(squad));
      const ownGoalL = team === "home" ? SIM.PITCH_H_METRES : 0;
      const depthOf = (player) => Math.abs(player.y * MY - ownGoalL);
      const defenders = squad.filter((player) => player.role === "DEF").map(depthOf);
      const forwards = squad.filter((player) => player.role === "ATT").map(depthOf);
      if (defenders.length) acc.attackBackLine.push(Math.min(...defenders));
      if (forwards.length) acc.attackForwardTop.push(Math.max(...forwards));
    }
  }
}

const own = median(acc.own);
const middle = median(acc.middle);
const attack = median(acc.attack);
const backLine = median(acc.attackBackLine);
const forwardTop = median(acc.attackForwardTop);

// 审计阈值，用于一眼看出哪一条会挂（与 attack-shape-compaction-audit.mjs 同步，
// 含 2026-09-15 修订：比值下限 1.15 → 1.02，并新增两条机制断言）
const LIMITS = {
  attackCeiling: 54, thirdCeiling: 45, thirdFloor: 20, attackFloor: 25,
  attackOverMiddle: 1.02, backLineFloor: 53, forwardTopFloor: 92,
  spanMin: 30, spanMax: 52,
};
const checks = {
  attackCeiling: attack <= LIMITS.attackCeiling,
  thirdCeilingOwn: own <= LIMITS.thirdCeiling,
  thirdCeilingMiddle: middle <= LIMITS.thirdCeiling,
  thirdFloor: own >= LIMITS.thirdFloor && middle >= LIMITS.thirdFloor,
  attackFloor: attack >= LIMITS.attackFloor,
  attackOverMiddle: attack >= middle * LIMITS.attackOverMiddle,
  backLineFloor: backLine >= LIMITS.backLineFloor,
  forwardTopFloor: forwardTop >= LIMITS.forwardTopFloor,
  spanMin: forwardTop - backLine >= LIMITS.spanMin,
  spanMax: forwardTop - backLine <= LIMITS.spanMax,
};

console.log(JSON.stringify({
  profile: PROFILE,
  seeds: SEEDS.length,
  samples: { own: acc.own.length, middle: acc.middle.length, attack: acc.attack.length },
  own: +own.toFixed(2),
  middle: +middle.toFixed(2),
  attack: +attack.toFixed(2),
  attackAll: +median(acc.attackAll).toFixed(2),
  attackOverMiddle: +(attack / middle).toFixed(3),
  attackOverOwn: +(attack / own).toFixed(3),
  backLine: +backLine.toFixed(2),
  forwardTop: +forwardTop.toFixed(2),
  span: +(forwardTop - backLine).toFixed(2),
  checks,
  failing: Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k),
}, null, 2));
