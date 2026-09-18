/**
 * 突破原语参数扫描（2026-09-18 夜）—— 只调参数，不碰引擎。
 *
 * 目的：把 `_beat-counterfactual-probe.mjs` 的三项判据同时调到目标带内：
 *   ① 频次：单队 ~17 次/场（真实 34~38 双方合计）
 *   ② 成功率：47~52%
 *   ③ 属性差：≥ +15pp（真实 +20~30pp）
 *
 * 用法：node scripts/_beat-param-sweep.mjs [场数] [档位]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(2, Number(process.argv[2]) || 4);
const TIER = (process.argv[3] || "tiered") === "uniform" ? "uniform" : "tiered";
const seedBase = 372000;
const SAMPLE_INTERVAL = 0.1;

const PER_UNIT_X = 68 / 100;
const PER_UNIT_Y = 105 / 100;
const pitchDistM = (ax, ay, bx, by) =>
  Math.hypot((ax - bx) * PER_UNIT_X, (ay - by) * PER_UNIT_Y);

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
    ]) attrs[key] = rating;
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

function duelContext(engine, a) {
  let opp = null, oppD = Infinity, helpers = 0;
  for (const o of engine.agents) {
    if (o.team === a.team || o.role === "GK" || o.sentOff) continue;
    const d = pitchDistM(o.x, o.y, a.x, a.y);
    if (d < oppD) { oppD = d; opp = o; }
    if (d <= 8) helpers++;
  }
  return { opp, d: oppD, helpers: Math.max(0, helpers - 1) };
}

/** 用一组参数跑一场，返回读数。全部离线，不改引擎。 */
function runMatch(P, seed) {
  const originalRandom = Math.random;
  const probeRandom = seededRandom(seed ^ 0x9e3779b9);
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(makeClub(`home-${seed}`), makeClub(`away-${seed}`), {
      simulationProfile: "standard", timeStep: SIM.DT, separationPasses: 8,
    });
    const steps = Math.round((90 * 60) / SIM.DT);
    let nextSampleAt = 0;
    const r = {
      attempts: 0, attemptsCore: 0, attemptsOrdinary: 0,
      success: 0, successCore: 0, successOrdinary: 0,
      pSum: 0, blockedIntent: 0,
    };
    const lastAttempt = new Map();
    const inAction = new Map();

    for (let step = 0; step < steps; step++) {
      engine.step(SIM.DT);
      const t = engine.t;
      if (t < nextSampleAt) continue;
      nextSampleAt = t + SAMPLE_INTERVAL;

      const b = engine.ball;
      const owner = b.owner ? engine.agentById(b.owner) : null;
      if (!owner || (b.state !== "held" && b.state !== "control")) continue;

      const busy = inAction.get(owner.id);
      if (busy !== undefined && t < busy) continue;
      const last = lastAttempt.get(owner.id);
      if (last !== undefined && t - last < P.cooldownSec) continue;

      const { opp, d, helpers } = duelContext(engine, owner);
      if (!opp || d > P.maxDuelDistM) continue;

      const intentP = P.intentBase + P.intentPerDribbling * owner.attr.dribbling;
      if (probeRandom() >= intentP) {
        r.blockedIntent++;
        lastAttempt.set(owner.id, t);
        inAction.set(owner.id, t + P.actionDurationSec);
        continue;
      }

      const atk = 0.55 * owner.attr.dribbling + 0.25 * owner.attr.balance + 0.2 * owner.attr.pace;
      const def = 0.6 * opp.attr.tackling + 0.2 * opp.attr.marking;
      const goalY = owner.team === "home" ? SIM.AWAY_GOAL_Y : SIM.HOME_GOAL_Y;
      const toGoal = Math.atan2((goalY - owner.y) * PER_UNIT_Y, (0 - owner.x) * PER_UNIT_X);
      const toDef = Math.atan2((opp.y - owner.y) * PER_UNIT_Y, (opp.x - owner.x) * PER_UNIT_X);
      let dAng = Math.abs(toDef - toGoal);
      if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
      const angleBonus = (dAng / Math.PI) * P.angleWeight;

      const p = Math.max(P.pMin, Math.min(
        P.pMax,
        P.base + (atk - def) * P.attrWeight + angleBonus - helpers * P.helpWeight
      ));

      const isCore = !!owner.isCore;
      r.attempts++;
      if (isCore) r.attemptsCore++; else r.attemptsOrdinary++;
      r.pSum += p;
      if (probeRandom() < p) {
        r.success++;
        if (isCore) r.successCore++; else r.successOrdinary++;
      }
      lastAttempt.set(owner.id, t);
      inAction.set(owner.id, t + P.actionDurationSec);
    }
    return r;
  } finally {
    Math.random = originalRandom;
  }
}

/** 候选参数组。全部围绕上一步的结果微调。 */
const CANDIDATES = [
  { name: "A 现状基准", intentBase: 0.010, intentPerDribbling: 0.055, attrWeight: 1.35 },
  { name: "B 意图减半", intentBase: 0.005, intentPerDribbling: 0.030, attrWeight: 1.35 },
  { name: "C B+属性加权", intentBase: 0.005, intentPerDribbling: 0.030, attrWeight: 1.70 },
  { name: "D 再减意图", intentBase: 0.003, intentPerDribbling: 0.018, attrWeight: 1.70 },
  { name: "E D+截距降", intentBase: 0.003, intentPerDribbling: 0.018, attrWeight: 1.70, base: 0.26 },
  { name: "F 意图再减", intentBase: 0.002, intentPerDribbling: 0.012, attrWeight: 1.90, base: 0.24 },
];

const BASE = {
  maxDuelDistM: 3.0, actionDurationSec: 1.2, cooldownSec: 3.0,
  base: 0.30, attrWeight: 1.35, angleWeight: 0.20, helpWeight: 0.05,
  pMin: 0.08, pMax: 0.80,
};

console.log(
  `\n=== 突破原语参数扫描 —— ${matches} 场/组，档位 ${TIER}，种子 ${seedBase}..${seedBase + matches - 1} ===\n`
);
console.log(
  "组".padEnd(16) + "单队尝试/场".padStart(12) + "成功率%".padStart(10) +
  "核心%".padStart(8) + "普通%".padStart(8) + "属性差pp".padStart(11) + "  判定"
);

const results = [];
for (const cand of CANDIDATES) {
  const P = { ...BASE, ...cand };
  const rows = [];
  for (let m = 0; m < matches; m++) rows.push(runMatch(P, seedBase + m));
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const attempts = sum("attempts");
  const success = sum("success");
  const perTeam = attempts / matches / 2;
  const succPct = attempts ? (success / attempts) * 100 : 0;
  const coreAtt = sum("attemptsCore");
  const ordAtt = sum("attemptsOrdinary");
  const corePct = coreAtt ? (sum("successCore") / coreAtt) * 100 : 0;
  const ordPct = ordAtt ? (sum("successOrdinary") / ordAtt) * 100 : 0;
  const gap = corePct - ordPct;

  const freqOk = perTeam >= 11 && perTeam <= 25;
  const succOk = succPct >= 45 && succPct <= 55;
  const gapOk = gap >= 15;
  const verdict =
    freqOk && succOk && gapOk
      ? "✅ 三项全过"
      : `⚠ ${[!freqOk && "频次", !succOk && "成功率", !gapOk && "属性差"].filter(Boolean).join("/")}未过`;

  console.log(
    cand.name.padEnd(16) +
    perTeam.toFixed(1).padStart(12) +
    succPct.toFixed(1).padStart(10) +
    corePct.toFixed(1).padStart(8) +
    ordPct.toFixed(1).padStart(8) +
    gap.toFixed(1).padStart(11) +
    "  " + verdict
  );
  results.push({ cand, perTeam, succPct, gap, corePct, ordPct });
}

console.log("\n目标带：单队尝试 11~25 次/场（真实 ~17）、成功率 45~55%（真实 47~52%）、属性差 ≥15pp（真实 +20~30pp）");

const best = results.filter(
  (r) => r.perTeam >= 11 && r.perTeam <= 25 && r.succPct >= 45 && r.succPct <= 55 && r.gap >= 15
);
if (best.length) {
  console.log(`\n✅ 有 ${best.length} 组全过 —— 取最接近目标的：`);
  for (const b of best) {
    console.log(
      `   ${b.cand.name}: 单队 ${b.perTeam.toFixed(1)}、成功率 ${b.succPct.toFixed(1)}%、属性差 ${b.gap.toFixed(1)}pp`
    );
    console.log(`     参数 = ${JSON.stringify({ ...BASE, ...b.cand })}`);
  }
} else {
  console.log("\n⚠ 无组全过 —— 记录最接近的组，供下一轮微调：");
  const scored = [...results].sort((a, b) => {
    const score = (r) =>
      Math.abs(r.perTeam - 17) / 17 + Math.abs(r.succPct - 50) / 50 + Math.max(0, 15 - r.gap) / 15;
    return score(a) - score(b);
  });
  for (const s of scored.slice(0, 3)) {
    console.log(
      `   ${s.cand.name}: 单队 ${s.perTeam.toFixed(1)}、成功率 ${s.succPct.toFixed(1)}%、属性差 ${s.gap.toFixed(1)}pp`
    );
  }
}
