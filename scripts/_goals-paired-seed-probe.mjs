/**
 * 进球数的**配对逐场**取样 —— 回答「某次改动的进球变化是系统性的，还是混沌重掷」。
 *
 * 动机：`match-realism-audit.mjs` 只给 48 场的**合计均值**。当一次改动把均值从
 * 2.88 推到 2.25（跌破 2.5 护栏）时，仅凭均值无法区分两种情况：
 *   (a) 改动**系统性**地降低了进球；
 *   (b) 引擎是确定但混沌的，一次微小扰动把整批对局重掷了，均值波动纯属取样噪声。
 * 本探针用**同一批种子**跑两台引擎，输出逐场进球，于是可以：
 *   · 做配对比较（同一 seed 的前后差），看差值的符号是否系统性偏负；
 *   · 把 48 场劈成两半，用两半均值的差估计**块间噪声尺度**，
 *     再拿它去衡量前后总差是否超出噪声。
 *
 * 口径与 `match-realism-audit.mjs` 完全一致（等强 13 vs 13、`seededRandom`、
 * 同一 `makeClub`、同一 timeStep/separationPasses），否则数字不可比。
 *
 * 用法：node scripts/_goals-paired-seed-probe.mjs [场数] [种子基] [standard|background]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MATCHES = Math.max(2, Number(process.argv[2]) || 48);
const SEED_BASE = Number(process.argv[3] || 165000);
const profile = process.argv[4] === "background" ? "background" : "standard";
const timeStep = profile === "background" ? 0.3 : SIM.DT;
const separationPasses = profile === "background" ? 4 : 8;

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
    const rating = Math.max(1, Math.min(20, ability + (((index * 7 + ability) % 5) - 2)));
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

function runMatch(seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(makeClub(`home-${seed}`, 13), makeClub(`away-${seed}`, 13), {
      simulationProfile: profile, timeStep, separationPasses,
    });
    const steps = Math.round((90 * 60) / timeStep);
    for (let step = 0; step < steps; step++) engine.step(timeStep);
    return engine;
  } finally {
    Math.random = originalRandom;
  }
}

const rows = [];
for (let match = 0; match < MATCHES; match++) {
  const seed = SEED_BASE + match;
  const engine = runMatch(seed);
  const result = engine.directResult();
  const goals = result.score.home + result.score.away;
  const shots = result.shots.home + result.shots.away;
  const onTarget = result.shotsOn.home + result.shotsOn.away;
  rows.push({ seed, goals, shots, onTarget });
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const half = Math.floor(MATCHES / 2);
const first = rows.slice(0, half);
const second = rows.slice(half);
const all = mean(rows.map((r) => r.goals));
const blockA = mean(first.map((r) => r.goals));
const blockB = mean(second.map((r) => r.goals));

console.log(
  JSON.stringify(
    {
      profile,
      matches: MATCHES,
      seedBase: SEED_BASE,
      goalsPerMatch: Number(all.toFixed(3)),
      shotsPerMatch: Number(mean(rows.map((r) => r.shots)).toFixed(3)),
      onTargetPerMatch: Number(mean(rows.map((r) => r.onTarget)).toFixed(3)),
      blockA: { seeds: [first[0].seed, first[first.length - 1].seed], goalsPerMatch: Number(blockA.toFixed(3)) },
      blockB: { seeds: [second[0].seed, second[second.length - 1].seed], goalsPerMatch: Number(blockB.toFixed(3)) },
      // 两个半区均值之差：同引擎、同分布的**块间噪声尺度**的估计
      blockGap: Number((blockB - blockA).toFixed(3)),
      perMatch: rows,
    },
    null,
    2
  )
);
