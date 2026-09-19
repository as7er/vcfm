// 逐位对比：`ownGoalY` / `targetGoalY` / `_inOwnPenaltyArea` / `_ballDistanceToOwnGoal`
// 重构（2026-09-19）前后的球员轨迹是否**完全一致**。
//
// 为什么需要它：这是一次「纯重构、不改行为」的改动——把 10 处硬编码的
// `team === "home" ? SIM.X_GOAL_Y : SIM.Y_GOAL_Y` 收敛到统一入口。
// 纯重构的验收标准不是「指标没退化」（那只能证明没大改坏），而是
// **逐位相同**：同种子下每一帧每个球员的 x/y 必须 bit-for-bit 相等。
//
// 做法：
//   1. 用 `git stash` 把工作区改成重构前的 HEAD 版本，跑一遍存签名；
//   2. 恢复工作区，跑第二遍存签名；
//   3. 对比两份签名。
// 本脚本**只负责跑签名**，stash 由外层 shell 编排（见脚本尾部注释）。
//
// 用法：node scripts/_gody-refactor-bitwise-check.mjs <输出文件> [场数=3]
//
// ⚠ 必须注入 `opts.random`：引擎 `:510` 只认 `opts.random`，**不认 `seed`**。
//    传 `{ seed }` 会被静默忽略 ⇒ 走 `Math.random` ⇒ 每次跑都是新随机流，
//    逐位对比必然全部分叉（这个坑我曾踩过：16200 帧"全部不同"，
//    误以为重构引入分叉，实际是对比方法本身失效）。

import { writeFileSync } from "node:fs";
import { SimEngine } from "../js/sim/engine.js";

/** mulberry32：小而快的 32 位 PRNG，同 seed 完全可复现 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OUT = process.argv[2] || ".tmp-bitwise-sig.txt";
const MATCHES = Math.max(1, Number(process.argv[3]) || 3);
const START_SEED = 411000;
const DT = 0.1;
const FULL_SECONDS = 5400;

function makeClub(name) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((role, i) => {
    const attrs = {};
    for (const k of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical",
      "finishing", "tackling", "marking", "strength", "stamina", "vision",
      "reflexes", "handling", "positioning", "kicking", "decisions",
    ]) attrs[k] = 15;
    return { id: `${name}-${i}`, name: `${name} ${i}`, role, number: i + 1, attrs, playingHabits: [] };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((p) => p.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      width: 3,
      style: "balanced",
    },
  };
}

// 浮点转「可比较的整数字符串」：用定点表示避免 ±0 / NaN 表示差异造成的假阳性。
// 1e-6 格 ≈ 0.068mm，远小于任何物理意义，但足以抓住真实的数值分叉。
const Q = 1e6;
function q(v) {
  if (v == null || Number.isNaN(v)) return "n";
  return Math.round(v * Q);
}

const lines = [];
for (let m = 0; m < MATCHES; m++) {
  const seed = START_SEED + m;
  const engine = new SimEngine(makeClub(`home-${seed}`), makeClub(`away-${seed}`), {
    random: mulberry32(seed),
  });

  const steps = Math.round(FULL_SECONDS / DT);
  for (let i = 0; i < steps; i++) {
    engine.step(DT);
    // 每 10 步（1 模拟秒）取一次快照，避免文件过大；签名密度足够抓分叉
    if (i % 10 !== 0) continue;
    const parts = [`${m}:${i}`];
    for (const a of engine.agents) {
      parts.push(`${a.id},${q(a.x)},${q(a.y)},${q(a.tx)},${q(a.ty)}`);
    }
    const b = engine.ball;
    parts.push(`B,${q(b.x)},${q(b.y)},${q(b.vx)},${q(b.vy)}`);
    parts.push(`S,${engine.score.home},${engine.score.away}`);
    lines.push(parts.join("|"));
  }
}

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`wrote ${lines.length} sampled frames -> ${OUT}`);
