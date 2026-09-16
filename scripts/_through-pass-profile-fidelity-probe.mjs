// Diagnostic: how do through balls actually END, and do the two simulation
// profiles disagree about it?
//
// Background (AGENTS.md, 2026-09-03 handoff, "下一步" #2):
//   "查「后台档为什么对直塞比标准档敏感」：转化率涨 +1.0pp vs 标准档 +0.3pp。
//    那可能是后台档（0.3s 步长 + 4 趟分离）的保真度缺陷。"
//
// The two profiles differ in three ways:
//   timeStep          0.1  vs 0.3
//   separationPasses  8    vs 4
//   fine-stepping     ball physics only sub-steps when a player is within
//                     CONTROL_RADIUS+2 (4.6m) of the predicted path; shots
//                     always sub-step. Players sub-step only for the keeper.
//
// So a pass crossing open space runs at 0.3s in the background profile. If the
// defect is on the defensive side, background through balls should be completed
// or converted at a higher rate than standard ones.
//
// This probe is a pure observer: it reads the public event stream and changes
// nothing. Same seeds in both profiles, so the two columns are paired.
//
// Usage: node scripts/_through-pass-profile-fidelity-probe.mjs [matches] [seedBase]
import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(2, Number(process.argv[2]) || 12);
const seedBase = Number(process.argv[3]) || 372000;

const PROFILES = [
  { key: "standard", timeStep: SIM.DT, separationPasses: 8 },
  { key: "background", timeStep: 0.3, separationPasses: 4 },
];

function seededRandom(seed) {
  let s = seed >>> 0;
  return function random() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClub(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const id = `${name}-p${index}`;
    return {
      id, name: id, pos, number: index + 1, fitness: 100,
      attrs: {
        pace: rating, shooting: rating, passing: rating, dribbling: rating,
        defending: rating, physical: rating, finishing: rating, tackling: rating,
        marking: rating, strength: rating, stamina: rating, vision: rating,
        reflexes: rating, handling: rating, positioning: rating, kicking: rating,
      },
    };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

function runMatch(profile, ability, seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, ability),
      makeClub(`away-${seed}`, ability),
      {
        simulationProfile: profile.key,
        timeStep: profile.timeStep,
        separationPasses: profile.separationPasses,
      }
    );
    const steps = Math.round((90 * 60) / profile.timeStep);
    for (let step = 0; step < steps; step++) engine.step(profile.timeStep);
    return engine;
  } finally {
    Math.random = originalRandom;
  }
}

// Classify what happened to one through ball. Walks forward until the passage
// is resolved or the ball clearly changed hands.
//
// NOTE: the engine emits no dedicated restart events (no "out"/"throw"/"corner"),
// so dead balls show up as the next `pass` coming from the other team.
function classify(events, index) {
  const pass = events[index];
  const limit = pass.t + 12;
  for (let j = index + 1; j < events.length; j++) {
    const e = events[j];
    if (e.t > limit) return "unresolved-timeout";
    if (e.type === "receive") {
      if (e.team === pass.team && e.intendedId === pass.toId) return "completed-intended";
      if (e.team === pass.team) return "completed-other";
      return "received-by-opponent";
    }
    if (e.type === "intercept" && e.from === pass.agentId) return "intercepted";
    if (e.type === "offside") return "offside";
    if (e.type === "goal") return "goal-direct";
    if (e.type === "shot" && e.team === pass.team) return "shot";
    if (e.type === "tackle") return "tackled";
    if (e.type === "block") return "blocked";
    if (e.type === "pass") {
      return e.team === pass.team ? "superseded-same-team" : "superseded-other-team";
    }
  }
  return "unresolved-end";
}

const report = {};
for (const profile of PROFILES) {
  const outcome = {};
  let throughPasses = 0;
  let crossThrough = 0;
  let goals = 0;
  let shots = 0;
  let allPasses = 0;
  let throughGoalsAfter = 0;
  let throughShotsAfter = 0;
  const seedRows = [];

  for (let m = 0; m < matches; m++) {
    const seed = seedBase + m;
    const engine = runMatch(profile, 15, seed);
    const events = engine.events;
    let localThrough = 0;
    let localCompleted = 0;

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === "pass") {
        allPasses++;
        if (e.through && e.cross) crossThrough++;
        if (e.through && !e.cross) {
          throughPasses++;
          localThrough++;
          const verdict = classify(events, i);
          outcome[verdict] = (outcome[verdict] || 0) + 1;
          if (verdict === "completed-intended" || verdict === "completed-other") localCompleted++;
          // did a shot / goal follow within the same passage?
          let sawShot = false;
          for (let k = i + 1; k < events.length && events[k].t <= e.t + 12; k++) {
            const ev = events[k];
            if (ev.type === "goal" && ev.team === e.team) { throughGoalsAfter++; break; }
            if (ev.type === "shot" && ev.team === e.team) { sawShot = true; }
            if (ev.type === "pass" && ev.team !== e.team) break;
          }
          if (sawShot) throughShotsAfter++;
        }
      }
      if (e.type === "shot") shots++;
      if (e.type === "goal") goals++;
    }
    seedRows.push({ seed, through: localThrough, completed: localCompleted });
  }

  report[profile.key] = {
    matches,
    timeStep: profile.timeStep,
    separationPasses: profile.separationPasses,
    perMatch: {
      allPasses: +(allPasses / matches).toFixed(1),
      throughPasses: +(throughPasses / matches).toFixed(2),
      crossThrough: +(crossThrough / matches).toFixed(2),
      goals: +(goals / matches).toFixed(2),
      shots: +(shots / matches).toFixed(2),
      throughLeadsToShot: +(throughShotsAfter / matches).toFixed(2),
      throughLeadsToGoal: +(throughGoalsAfter / matches).toFixed(2),
    },
    throughCompletionPct: throughPasses
      ? +(((outcome["completed-intended"] || 0) + (outcome["completed-other"] || 0)) / throughPasses * 100).toFixed(1)
      : null,
    outcomes: Object.fromEntries(Object.entries(outcome).sort((a, b) => b[1] - a[1])),
    seeds: seedRows,
  };
}

console.log(JSON.stringify(report, null, 2));

const s = report.standard;
const b = report.background;
console.log("\n=== 直塞结果对比（同种子配对）===");
console.log(`种子 ${seedBase}..${seedBase + matches - 1}，${matches} 场/档`);
console.log("指标".padEnd(22), "标准档".padStart(10), "后台档".padStart(10));
const rows = [
  ["直塞/场", s.perMatch.throughPasses, b.perMatch.throughPasses],
  ["直塞完成率%", s.throughCompletionPct, b.throughCompletionPct],
  ["被断", s.outcomes.intercepted || 0, b.outcomes.intercepted || 0],
  ["越位", s.outcomes.offside || 0, b.outcomes.offside || 0],
  ["被对手接到", s.outcomes["received-by-opponent"] || 0, b.outcomes["received-by-opponent"] || 0],
  ["直塞后 12s 内射门", s.perMatch.throughLeadsToShot, b.perMatch.throughLeadsToShot],
  ["直塞后 12s 内进球", s.perMatch.throughLeadsToGoal, b.perMatch.throughLeadsToGoal],
  ["总射门/场", s.perMatch.shots, b.perMatch.shots],
  ["进球/场", s.perMatch.goals, b.perMatch.goals],
];
for (const [label, a, c] of rows) {
  console.log(String(label).padEnd(22), String(a).padStart(10), String(c).padStart(10));
}
