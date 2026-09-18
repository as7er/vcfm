/**
 * 一对一突破原语 —— **探针侧反事实模拟**（2026-09-18 夜，引擎零改动）。
 *
 * 目的（见 docs/one-on-one-beat-primitive-design-2026-09-18.md §7 第 2 条）：
 *   在**不改引擎**的前提下，回答三个问题：
 *     ① 若加入 `beat` 动作，每场会触发多少次？（真实基准：尝试 ~17 次/队、成功 ~9 次）
 *     ② 成功率会是多少？能否落在真实的 47~52%？
 *     ③ 成功率是否**随 `dribbling` 上升**？（当前实测是 0.38× 反向，即完全无关）
 *
 * 方法：**纯观察 + 离线计分**。
 *   · 每 0.1s 采样持球者与最近防守者的几何（距离、方位角差、周边协防数）。
 *   · 在满足"可尝试突破"的条件时，用设计稿 §2.4 的公式**离线算一个概率 p**，
 *     并用**探针自己的随机流**（不是引擎的）掷骰 —— 引擎行为完全不受影响。
 *   · 统计"会触发多少次 / 成功率 / 属性相关性"。
 *
 * ⚠ 关键：这里算出的 p **不会被写回引擎**，持球者的实际行为仍是引擎原本的决策。
 *    所以本探针给的是一阶效应量估计（"值不值得做"），不是落地的最终校准。
 *
 * 用法：
 *   node scripts/_beat-counterfactual-probe.mjs [场数] [种子起点] [档位]
 *   档位 = tiered（核心 18 / 普通 9）| uniform（同值 15）
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(2, Number(process.argv[2]) || 12);
const seedBase = Math.max(1, Number(process.argv[3]) || 372000);
const TIER = (process.argv[4] || "tiered") === "uniform" ? "uniform" : "tiered";
/** 可选：CLI 覆盖意图门槛（便于扫描到目标频次） */
const INTENT_BASE_OVERRIDE = process.argv[5] !== undefined ? Number(process.argv[5]) : null;

const SAMPLE_INTERVAL = 0.1;
const PER_UNIT_X = 68 / 100;
const PER_UNIT_Y = 105 / 100;
const pitchDistM = (ax, ay, bx, by) =>
  Math.hypot((ax - bx) * PER_UNIT_X, (ay - by) * PER_UNIT_Y);

/** —— 设计稿 §2.4 的可调参数（全部显式列出，便于扫描）—— */
const P = {
  /** 可尝试突破的距离上限（米）。控制半径 2.6，稍放宽到"贴身"尺度。 */
  maxDuelDistM: 3.0,
  /**
   * 一次"尝试过人"的**动作时长**（秒）。真实里一次带球过人是一个 1~2s 的连续动作，
   * 不是瞬时掷骰。⚠ 第一版我用"冷却 4s + 每 0.1s 采样"⇒ 1187 次尝试/场，
   * 是真实基准（34~38）的 **30 倍** —— 错误在于把采样频率当成了动作频率。
   */
  actionDurationSec: 1.2,
  /** 动作结束后的冷却（秒）。 */
  cooldownSec: 3.0,
  /**
   * 🔑 **意图门槛**：并非每次贴身都值得尝试过人 —— 真实足球在 ~1000 次持球接触里
   * 只挑出 ~17 次 take-on。所以必须有第二层"我这次要不要过他"的概率。
   * ⚠ 这是第二版修正的核心：第一版只靠冷却限制频率，结果单队 721 次/场（真实 17），
   * 因为**引擎里贴身是常态**（实测 53.5% 的持球样本最近对手 ≤3m）。
   * 门槛随 `dribbling` 上升 —— 这也正是"球星更爱也更能过人"的第一层体现。
   * 取值来自 `_beat-param-sweep.mjs` 的扫描（C 组，12 场验证）。
   */
  intentBase: 0.005,
  intentPerDribbling: 0.030,
  /** 公式截距 */
  base: 0.30,
  /** 属性差权重（第一版 0.55 只给出 +6.8pp；扫描后定为 1.70 → +18.3pp） */
  attrWeight: 1.70,
  /** 侧向角奖励权重（防守者偏离持球者前进线越多越好过） */
  angleWeight: 0.20,
  /** 协防惩罚（每多一名 8m 内的协防者，成功率下降） */
  helpWeight: 0.05,
  /** 概率上下限 */
  pMin: 0.08,
  pMax: 0.80,
  /** 场地尺度：真实每队每场尝试次数目标（用于频次校核） */
  targetAttemptsPerTeamPerMatch: 17,
};
if (INTENT_BASE_OVERRIDE !== null && Number.isFinite(INTENT_BASE_OVERRIDE)) {
  P.intentBase = INTENT_BASE_OVERRIDE;
}

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

function makeClub(name) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const CORE = new Set([5, 6, 9]);
  const players = roles.map((pos, index) => {
    const id = `${name}-p${index}`;
    let rating = TIER === "uniform" ? 15 : CORE.has(index) ? 18 : 11;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
    ]) {
      attrs[key] = rating;
    }
    if (TIER === "tiered" && !CORE.has(index)) {
      attrs.dribbling = 9;
      attrs.vision = 9;
      attrs.passing = 11;
    }
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

/** 最近防守者 + 协防数（8m 内）。 */
function duelContext(engine, a) {
  let opp = null;
  let oppD = Infinity;
  let helpers = 0;
  for (const o of engine.agents) {
    if (o.team === a.team || o.role === "GK" || o.sentOff) continue;
    const d = pitchDistM(o.x, o.y, a.x, a.y);
    if (d < oppD) {
      oppD = d;
      opp = o;
    }
    if (d <= 8) helpers++;
  }
  return { opp, d: oppD, helpers: Math.max(0, helpers - 1) };
}

function runMatch(seed) {
  const originalRandom = Math.random;
  // ⚠ 探针自己的随机流：与引擎的 Math.random 分离，保证不干扰引擎行为
  const probeRandom = seededRandom(seed ^ 0x9e3779b9);
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(makeClub(`home-${seed}`), makeClub(`away-${seed}`), {
      simulationProfile: "standard",
      timeStep: SIM.DT,
      separationPasses: 8,
    });

    const steps = Math.round((90 * 60) / SIM.DT);
    let nextSampleAt = 0;

    const r = {
      // 反事实：会触发的突破尝试
      attempts: 0,
      attemptsCore: 0,
      attemptsOrdinary: 0,
      success: 0,
      successCore: 0,
      successOrdinary: 0,
      // 每个触发的 p 值（用于看分布）
      pSum: 0,
      pSumCore: 0,
      pSumOrdinary: 0,
      // 不满足条件而"本该尝试但被挡"的次数（冷却/距离）
      blockedByCooldown: 0,
      /** 通过了冷却、但意图门槛未过的次数 */
      blockedByIntent: 0,
      // 时间戳：用来算"每场尝试次数"的稳定性
      firstAttemptAt: null,
    };

    /** playerId -> 上次尝试时间 */
    const lastAttempt = new Map();
    /** playerId -> 当前动作是否在进行中（未到结束时刻） */
    const inAction = new Map();

    for (let step = 0; step < steps; step++) {
      engine.step(SIM.DT);
      const t = engine.t;
      if (t < nextSampleAt) continue;
      nextSampleAt = t + SAMPLE_INTERVAL;

      const b = engine.ball;
      const owner = b.owner ? engine.agentById(b.owner) : null;
      if (!owner || (b.state !== "held" && b.state !== "control")) continue;

      // 动作进行中 / 冷却中 ⇒ 不触发（这才是真实动作频率的建模）
      const busyUntil = inAction.get(owner.id);
      if (busyUntil !== undefined && t < busyUntil) continue;
      const last = lastAttempt.get(owner.id);
      if (last !== undefined && t - last < P.cooldownSec) {
        r.blockedByCooldown++;
        continue;
      }

      const { opp, d, helpers } = duelContext(engine, owner);
      if (!opp || d > P.maxDuelDistM) continue;

      // 🔑 意图门槛：贴身 ≠ 想过人。真实足球在 ~1000 次持球接触里只挑出 ~17 次 take-on。
      //    门槛随 dribbling 上升（球星更爱也更能过人）。
      const intentP = P.intentBase + P.intentPerDribbling * owner.attr.dribbling;
      if (probeRandom() >= intentP) {
        r.blockedByIntent++;
        lastAttempt.set(owner.id, t); // 本次不尝试，也进冷却，避免每采样点重掷
        inAction.set(owner.id, t + P.actionDurationSec);
        continue;
      }

      // —— 离线算概率（设计稿 §2.4）——
      const atk = 0.55 * owner.attr.dribbling + 0.25 * owner.attr.balance + 0.2 * owner.attr.pace;
      const def = 0.6 * opp.attr.tackling + 0.2 * opp.attr.marking;

      // 侧向角：防守者相对"持球者 → 对方球门"方向的角偏差
      const dir = engine.attackDir(owner.team);
      const goalY = owner.team === "home" ? SIM.AWAY_GOAL_Y : SIM.HOME_GOAL_Y;
      const toGoal = Math.atan2((goalY - owner.y) * PER_UNIT_Y, (0 - owner.x) * PER_UNIT_X);
      const toDef = Math.atan2((opp.y - owner.y) * PER_UNIT_Y, (opp.x - owner.x) * PER_UNIT_X);
      let dAng = Math.abs(toDef - toGoal);
      if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
      const angleBonus = (dAng / Math.PI) * P.angleWeight;

      const p = Math.max(
        P.pMin,
        Math.min(
          P.pMax,
          P.base + (atk - def) * P.attrWeight + angleBonus - helpers * P.helpWeight
        )
      );

      const isCore = !!owner.isCore;
      r.attempts++;
      if (isCore) {
        r.attemptsCore++;
        r.pSumCore += p;
      } else {
        r.attemptsOrdinary++;
        r.pSumOrdinary += p;
      }
      r.pSum += p;
      if (r.firstAttemptAt === null) r.firstAttemptAt = t;

      // 掷骰（探针自己的流）
      if (probeRandom() < p) {
        r.success++;
        if (isCore) r.successCore++;
        else r.successOrdinary++;
      }
      lastAttempt.set(owner.id, t);
      inAction.set(owner.id, t + P.actionDurationSec);
    }

    return r;
  } finally {
    Math.random = originalRandom;
  }
}

const rows = [];
for (let m = 0; m < matches; m++) rows.push(runMatch(seedBase + m));

const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
const per = (k) => Number((sum(k) / matches).toFixed(2));
const pctOf = (a, b) => (b > 0 ? Number(((a / b) * 100).toFixed(1)) : null);

console.log(
  `\n=== 一对一突破·反事实模拟 —— ${matches} 场，种子 ${seedBase}..${seedBase + matches - 1}，档位 ${TIER} ===`
);
console.log("⚠ 本探针只做**离线计分**：概率不写回引擎，持球者真实行为仍是引擎原本的决策。");
console.log(
  `\n参数：对抗日距 ≤${P.maxDuelDistM}m、动作时长 ${P.actionDurationSec}s、冷却 ${P.cooldownSec}s`
);
console.log(
  `      意图门槛 = ${P.intentBase} + ${P.intentPerDribbling}×dribbling`
);
console.log(
  `      p = clamp(${P.base} + Δattr×${P.attrWeight} + 角奖励×${P.angleWeight} − 协防×${P.helpWeight}, ${P.pMin}, ${P.pMax})`
);

console.log("\n[1] 触发频次（问题①）：");
console.log({
  "突破尝试/场（双方合计）": per("attempts"),
  "≈ 单队/场": Number((per("attempts") / 2).toFixed(1)),
  "其中核心球员/场": per("attemptsCore"),
  "其中普通球员/场": per("attemptsOrdinary"),
  "被冷却挡下的采样数/场": per("blockedByCooldown"),
  "通过冷却但意图未过的次数/场": per("blockedByIntent"),
});
console.log(
  `  真实基准：**单队** ~${P.targetAttemptsPerTeamPerMatch} 次/场（双方 ~34~38）、成功 ~17 次/场`
);
{
  const perTeam = per("attempts") / 2;
  const ratio = perTeam / P.targetAttemptsPerTeamPerMatch;
  console.log(
    ratio >= 0.7 && ratio <= 1.5
      ? `  ✅ 单队 ${perTeam.toFixed(1)} 次/场 在真实带（0.7~1.5×）内。`
      : `  ⚠ 单队 ${perTeam.toFixed(1)} 次/场 = 真实基准的 ${ratio.toFixed(2)}× ⇒ 需调动作时长/冷却。`
  );
}

console.log("\n[2] 成功率（问题②）：");
{
  const succPct = pctOf(sum("success"), sum("attempts"));
  console.log({
    "成功/尝试": `${sum("success")} / ${sum("attempts")}`,
    "整体成功率%": succPct,
    "平均 p（模型预测）%": sum("attempts") ? Number(((sum("pSum") / sum("attempts")) * 100).toFixed(1)) : null,
  });
  console.log("  真实基准：联赛平均 47~52%（英超 52%、西甲 47%）");
  if (succPct !== null) {
    const ok = succPct >= 40 && succPct <= 58;
    console.log(
      ok
        ? `  ✅ ${succPct}% 落在真实带 40~58% 内 —— 参数合理。`
        : `  ⚠ ${succPct}% 在真实带外 —— 需调 ${succPct > 58 ? "低" : "高"} ${P.base} / ${P.attrWeight}。`
    );
  }
}

console.log("\n[3] 🔑 属性相关性（问题③，本探针要回答的核心）：");
{
  const corePct = pctOf(sum("successCore"), sum("attemptsCore"));
  const ordPct = pctOf(sum("successOrdinary"), sum("attemptsOrdinary"));
  console.log({
    "核心球员 成功/尝试": `${sum("successCore")} / ${sum("attemptsCore")}`,
    "普通球员 成功/尝试": `${sum("successOrdinary")} / ${sum("attemptsOrdinary")}`,
    "核心成功率%": corePct,
    "普通成功率%": ordPct,
  });
  if (corePct !== null && ordPct !== null && ordPct > 0) {
    const gap = corePct - ordPct;
    console.log({
      "差值(pp)": Number(gap.toFixed(1)),
      "比值": Number((corePct / ordPct).toFixed(2)),
    });
    console.log("  真实基准：顶级盘带者 66~78% vs 联赛平均 47~52% ⇒ 差 +20~30pp");
    if (gap >= 15) {
      console.log(`  ✅ 差值 +${gap.toFixed(1)}pp ≥ 15pp ⇒ **属性权重足够**，值得落引擎。`);
    } else {
      console.log(
        `  ⛔ 差值仅 +${gap.toFixed(1)}pp < 15pp ⇒ 属性权重偏弱，需提高 ${P.attrWeight}。`
      );
    }
  } else if (TIER === "uniform") {
    console.log("  （uniform 档所有属性相同 ⇒ 差值应接近 0，这是仪器的自检）");
  }
}

console.log("\n[4] 模型预测的 p 分布（看是否有球员被压在上下限）：");
{
  const coreAvgP = sum("attemptsCore") ? (sum("pSumCore") / sum("attemptsCore")) * 100 : null;
  const ordAvgP = sum("attemptsOrdinary") ? (sum("pSumOrdinary") / sum("attemptsOrdinary")) * 100 : null;
  console.log({
    "核心平均 p%": coreAvgP === null ? null : Number(coreAvgP.toFixed(1)),
    "普通平均 p%": ordAvgP === null ? null : Number(ordAvgP.toFixed(1)),
    "pMin/pMax": `${P.pMin} / ${P.pMax}`,
  });
  console.log(
    "  ⚠ 若平均值贴到 pMax，说明公式对高属性球员已饱和（无法体现更多差异）。"
  );
}

console.log("\n[5] 连带观察（供后续重标定参考）：");
{
  // 用最后一场的 engine 统计（近似）
  console.log("  ⚠ 本探针未统计传球/射门受影响量 —— 那需要真正落引擎后跑审计。");
  console.log("     落引擎后必须重跑：match-realism-audit（24 场）+ verify.mjs + boxSec/直塞/越位三条复核。");
}

console.log("\n[6] ⚖ 结论：");
{
  const succPct = pctOf(sum("success"), sum("attempts"));
  const corePct = pctOf(sum("successCore"), sum("attemptsCore"));
  const ordPct = pctOf(sum("successOrdinary"), sum("attemptsOrdinary"));
  const gap = corePct !== null && ordPct !== null ? corePct - ordPct : null;
  const freqOk = sum("attempts") / matches >= 10;
  const succOk = succPct !== null && succPct >= 40 && succPct <= 58;
  const gapOk = gap !== null && gap >= 15;
  console.log({
    "频次合理(≥10 次/场)": freqOk,
    "成功率在真实带(40~58%)": succOk,
    "属性差 ≥15pp": gapOk,
  });
  if (freqOk && succOk && gapOk) {
    console.log(
      "   ✅ 三项全过 ⇒ **值得落引擎**。按设计稿 §5 完成标定后落地。"
    );
  } else {
    console.log(
      "   ⚠ 有项目未达标 ⇒ 先调参数重跑本探针（引擎零改动、成本极低），"
    );
    console.log("      直到三项全过再考虑落引擎。");
  }
}
