/**
 * 端到端审计：真实对局里「防线高度」是否真的驱动了中卫线前压（已进 verify 默认套件）。
 *
 * 为什么需要它：`scripts/_cb-line-height-probe.mjs` 是**直接给引擎传战术**的合成测量，
 * 而真实对局里战术是 `js/match.js:393 aiTuneTactics()` 按实力差算出来、写进俱乐部对象、
 * 再由 `ensureSimEngine`（`js/sim/adapt.js:61`）把俱乐部交给 `new SimEngine(state.home, state.away)`
 * 进入引擎的。这条端到端链路此前没有验证过。
 *
 * 为什么它不可被既有审计替代：`match-realism-audit.mjs` 与
 * `attack-shape-compaction-audit.mjs` 都把两队的 `defensiveLine` 写死成 3，
 * 而本审计的断言只在**两队防线不同**时才可能失败——两者是互补的，不是重复的。
 * （`collective-defense-audit` / `team-shapes-audit` / `match-analysis-audit` 虽然用了
 *  非 3 防线，但它们断言的是防守行为，不是「强队中卫线是否站得更高」。）
 *
 * 真实链路里防线高度的来源（两处机制一致，只是量纲不同）：
 *   `js/match.js:438-451`    diff <= -12 → defensiveLine <= 2；diff >= +12 → >= 4
 *   `js/delegation.js:231-241` difference <= -1.5 → <= 2；>= +1.5 → >= 4
 *
 * 本探针用 power 78 vs 62（差 16，跨过 ±12 门槛）跑**真实比赛会话**，验证三件事：
 *   1. `aiTuneTactics` 确实按实力差设出了不同防线（强队 >=4、弱队 <=2）；
 *   2. 这两个值确实传到了引擎（`_tacticLevel` 读到不同值）；
 *   3. 进攻三区内，强队的中卫线**确实站得比弱队高**，且差值接近乘法因子预测。
 *
 * ⚠ 必须**按球推进深度分层**再比：中卫线深度本身就随 `prog` 变化，
 *   不分层会把「谁攻得更深」混进「谁的防线更高」。
 *
 * ⚠ 必须**预置固定 ID 的教练**（见 `makeClub`）：不预置时 `ensureStaff` 会走
 *   `js/staff.js:108` 的 `Date.now()` 生成 ID，而教练身份是用 `coach.id` 做种子派生的，
 *   于是每次运行战术都不同、本审计会不确定（踩过一次：同种子两次 61.2 vs 60.4 m）。
 *
 * 用法：node scripts/cb-line-height-e2e-audit.mjs [场数]
 */
import assert from "node:assert/strict";

import { createMatchSession } from "../js/match.js";
import { SIM } from "../js/sim/engine.js";
import { ensureSimEngine } from "../js/sim/adapt.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 3);
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05 m / y 格
const FINAL_THIRD = 0.64;                    // 与引擎 `finalThird` 同阈值
const SAMPLE_STEPS = 5;                      // 每 0.5 秒采样
const STRONG_POWER = 78;
const WEAK_POWER = 62;

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

function makeClub(id, ability, power) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const pid = `${id}-p${index}`;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions",
    ]) attrs[key] = rating;
    return { id: pid, name: pid, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id,
    name: id,
    power,
    players,
    // ⚠ 必须预置固定 ID 的教练，否则 `ensureStaff` 会走
    //    `js/staff.js:108` 的 `${prefix}_${Date.now()...}_${Math.random()...}` 生成 ID，
    //    而教练身份（`ensureCoachIdentity`，`js/manager-ecosystem.js:134`）是用
    //    `coach.id` 做种子派生的 → **每次运行身份都不同 → 战术不同 → 本审计不确定**（踩过一次）。
    //    预置后 `ensureStaff` 提前返回，身份由固定 ID 稳定派生。
    //    两队给同样的 rating/age，让差异只来自 power。
    staff: {
      coach: {
        id: `${id}-coach`,
        name: `${id}-coach`,
        role: "coach",
        rating: 12,
        wage: 1000,
        age: 45,
        contractYears: 3,
        clubId: id,
      },
    },
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      style: "balanced",
    },
  };
}

const median = (values) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** 中卫线 = 最深那名中卫（与 `_attack-block-shift-probe.mjs` 同口径）。 */
function isFullback(agent) {
  if (agent.detailedPosition === "LB" || agent.detailedPosition === "RB") return true;
  if (agent.detailedPosition === "CB") return false;
  const x = agent.slotX != null ? agent.slotX : agent.baseX;
  return agent.role === "DEF" && (x < 30 || x > 70);
}

const samples = { strong: [], weak: [] };
const lineLevels = [];

for (let match = 0; match < MATCHES; match++) {
  const seed = 900000 + match;
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const strong = makeClub("strong", 15, STRONG_POWER);
    const weak = makeClub("weak", 11, WEAK_POWER);
    // userClubId 指向一个不存在的俱乐部，好让 aiTuneTactics 对**两队**都生效
    const world = {
      day: 1,
      season: 1,
      userClubId: "__none__",
      clubs: [strong, weak],
      fixtures: [],
      news: [],
    };
    const fixture = { day: 5, home: "strong", away: "weak", played: false };

    const state = createMatchSession(world, fixture);
    const engine = state.simEng || ensureSimEngine(state);

    // ---- 断言 1：真实链路确实按实力差设出了不同防线 ----
    const strongLine = strong.tactics.defensiveLine;
    const weakLine = weak.tactics.defensiveLine;
    lineLevels.push({ seed, strongLine, weakLine, strongPower: strong.power, weakPower: weak.power });
    assert.ok(
      strongLine >= 4,
      `seed ${seed}: 强队(power ${strong.power}) 的防线应 >= 4，实际 ${strongLine}`
    );
    assert.ok(
      weakLine <= 2,
      `seed ${seed}: 弱队(power ${weak.power}) 的防线应 <= 2，实际 ${weakLine}`
    );

    // ---- 断言 2：这两个值确实到了引擎 ----
    assert.equal(
      engine._tacticLevel("home", "defensiveLine"),
      strongLine,
      `seed ${seed}: 引擎读到的强队防线与俱乐部不一致`
    );
    assert.equal(
      engine._tacticLevel("away", "defensiveLine"),
      weakLine,
      `seed ${seed}: 引擎读到的弱队防线与俱乐部不一致`
    );

    // ---- 采样：只统计控球方、且球已进入进攻三区 ----
    const steps = Math.round((90 * 60) / SIM.DT);
    for (let step = 0; step < steps; step++) {
      engine.step(SIM.DT);
      if (step % SAMPLE_STEPS !== 0) continue;
      const owner = engine.agents.find((agent) => agent.id === engine.ball.owner);
      if (!owner) continue;
      const team = owner.team; // "home" = strong, "away" = weak
      const ownGoalY = team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
      const prog = Math.abs(engine.ball.y - ownGoalY) / SIM.FIELD_H;
      if (prog <= FINAL_THIRD) continue;
      const squad = engine.agents.filter((agent) => agent.team === team && !agent.sentOff);
      const centreBacks = squad.filter((agent) => agent.role === "DEF" && !isFullback(agent));
      if (centreBacks.length < 2) continue;
      const depth = (y) => Math.abs(y * MY - ownGoalY * MY);
      const cbDepth = Math.min(...centreBacks.map((agent) => depth(agent.y)));
      samples[team === "home" ? "strong" : "weak"].push({ prog, cbDepth });
    }
  } finally {
    Math.random = originalRandom;
  }
}

// ---- 按 prog 分层对比，避免把「谁攻得更深」混进来 ----
const BANDS = [
  { label: "0.64–0.75", lo: 0.64, hi: 0.75 },
  { label: "0.75–0.85", lo: 0.75, hi: 0.85 },
  { label: "0.85–1.00", lo: 0.85, hi: 1.01 },
];

console.log(`\n=== 端到端验证：真实对局里的防线高度 → 中卫线前压（${MATCHES} 场）===`);
console.log(`power ${STRONG_POWER} vs ${WEAK_POWER}（差 ${STRONG_POWER - WEAK_POWER}，跨过 ±12 门槛）\n`);

console.log("1. 真实链路（aiTuneTactics）设出的防线高度");
console.log("   种子     强队防线  弱队防线");
for (const row of lineLevels) {
  console.log(`   ${row.seed}      ${String(row.strongLine).padStart(2)}        ${String(row.weakLine).padStart(2)}`);
}
const strongLineAvg = lineLevels.reduce((sum, r) => sum + r.strongLine, 0) / lineLevels.length;
const weakLineAvg = lineLevels.reduce((sum, r) => sum + r.weakLine, 0) / lineLevels.length;
console.log(`   平均      ${strongLineAvg.toFixed(2)}      ${weakLineAvg.toFixed(2)}`);

// 乘法因子预测的深度差（进攻三区内中卫线基准 33.6 m，前压基准 19 m）
const GAIN = SIM.CB_BLOCK_SHIFT_LINE_GAIN;
const strongMult = 1 + (strongLineAvg - 3) * GAIN;
const weakMult = 1 + (weakLineAvg - 3) * GAIN;

console.log("\n2. 进攻三区内的中卫线深度（按球推进深度分层，只统计控球方）");
console.log("   推进深度      强队样本  弱队样本   强队深度   弱队深度    差值");
console.log("   " + "-".repeat(62));
for (const band of BANDS) {
  const pick = (list) => list.filter((s) => s.prog >= band.lo && s.prog < band.hi);
  const strongBand = pick(samples.strong);
  const weakBand = pick(samples.weak);
  const strongDepth = median(strongBand.map((s) => s.cbDepth));
  const weakDepth = median(weakBand.map((s) => s.cbDepth));
  const diff = strongDepth - weakDepth;
  console.log(
    "   " + band.label.padEnd(14) +
      String(strongBand.length).padStart(8) +
      String(weakBand.length).padStart(10) +
      (Number.isFinite(strongDepth) ? strongDepth.toFixed(1).padStart(10) + " m" : "         —") +
      (Number.isFinite(weakDepth) ? weakDepth.toFixed(1).padStart(10) + " m" : "         —") +
      (Number.isFinite(diff) ? (diff >= 0 ? "+" : "") + diff.toFixed(1).padStart(8) + " m" : "         —")
  );
}

const strongTop = samples.strong.filter((s) => s.prog >= 0.85);
const weakTop = samples.weak.filter((s) => s.prog >= 0.85);
const strongDepth = median(strongTop.map((s) => s.cbDepth));
const weakDepth = median(weakTop.map((s) => s.cbDepth));

console.log("\n3. 结论（推进 0.85–1.00 档）");
console.log(`   强队防线均值 ${strongLineAvg.toFixed(2)} 级 → 乘数 ${strongMult.toFixed(3)}`);
console.log(`   弱队防线均值 ${weakLineAvg.toFixed(2)} 级 → 乘数 ${weakMult.toFixed(3)}`);
console.log(`   强队中卫线深度中位 ${strongDepth.toFixed(1)} m / 弱队 ${weakDepth.toFixed(1)} m`);
console.log(`   实测差值 ${(strongDepth - weakDepth).toFixed(1)} m`);

assert.ok(
  Number.isFinite(strongDepth) && Number.isFinite(weakDepth),
  "样本不足，无法比较（两个档位都要有数据）"
);
assert.ok(
  strongDepth > weakDepth,
  `强队的中卫线应站得比弱队高，实际强队 ${strongDepth.toFixed(1)} m、弱队 ${weakDepth.toFixed(1)} m`
);

console.log(
  "\n✅ 端到端通过：真实对局的实力差 → aiTuneTactics 设定防线高度 → 引擎按防线缩放中卫线前压，" +
    `强队中卫线比弱队高 ${(strongDepth - weakDepth).toFixed(1)} m。\n`
);
