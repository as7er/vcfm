// 验证「注入确定性 PRNG」能否让引擎可复现。
//
// 背景：引擎 `:510` 的 `this.random = opts.random ?? Math.random` 早已支持
// 注入随机源，但**不接受 `seed`**。此前所有探针传的都是 `{ seed: N }`，
// 被静默忽略 ⇒ 每次跑都是新随机流 ⇒ 逐位对比等方法全部失效。
// 本脚本确认：传 `opts.random` 后同一 seed 能否逐位复现。
//
// 用法：node scripts/_deterministic-random-check.mjs

import { SimEngine } from "../js/sim/engine.js";

const DT = 0.1;

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
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, width: 3, style: "balanced",
    },
  };
}

const Q = 1e6;
const q = (v) => (v == null || Number.isNaN(v) ? "n" : Math.round(v * Q));

/** 用注入的 PRNG 跑 frames 帧，返回签名 */
function sig(seed, frames) {
  const engine = new SimEngine(makeClub("home"), makeClub("away"), {
    random: mulberry32(seed),
  });
  const out = [];
  for (let i = 0; i < frames; i++) {
    engine.step(DT);
    const parts = [];
    for (const a of engine.agents) parts.push(`${a.id},${q(a.x)},${q(a.y)},${q(a.tx)},${q(a.ty)}`);
    out.push(parts.join("|") + `|S,${engine.score.home},${engine.score.away}`);
  }
  return out;
}

const A = sig(12345, 200);
const B = sig(12345, 200);
const C = sig(99999, 200);

console.log("同一 seed(12345) 跑两次是否一致（注入 PRNG）：");
console.log(A.join("\n") === B.join("\n") ? "  ✅ 完全一致 —— 可复现" : "  ❌ 仍不一致");

console.log("\n不同 seed 是否产生不同轨迹：");
console.log(A.join("\n") !== C.join("\n") ? "  ✅ 不同 —— seed 确实生效" : "  ❌ 相同 —— seed 未生效");

console.log("\n不注入 random（默认 Math.random）跑两次：");
const D = sig(1, 50);
const E = sig(1, 50);
console.log(D.join("\n") === E.join("\n") ? "  一致" : "  ❌ 不一致 —— 印证默认不可复现（seed 被忽略）");
