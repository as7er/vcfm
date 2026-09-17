/**
 * 点球漏斗探针：把「禁区内可吹罚接触 → 实际判罚点球」整条链路逐层量出来。
 *
 * 为什么要这个探针（背景）：
 *   `_close-range-foul-probe.mjs` 量出「禁区内犯规 30 次 / 判 0 点球」，据此推断
 *   `js/sim/engine.js:6476` 的 `pFoul *= 0.014` 与注释「系数 0.334」不一致。
 *   但那条推断只覆盖了**一条**路径。点球其实有两条独立入口，外加两层闸门：
 *     ① 抢断路径  `_commitFoul`      —— 被 0.014 缩放
 *     ② 手球路径  `_commitHandball`  —— 完全不过 pFoul，走 handballContactDecision
 *     ③ 裁判现场判定 `penaltyOnFieldDecision`（禁区内 missRisk 5%~48% 会误判无点球）
 *     ④ VAR 复核     `_emitVarReview` / `varReviewDecision`
 *
 * 读代码得到的**待验证假设**（本探针的核心目的之一是证伪它）：
 *   `_commitFoul` 给 VAR 传的 `evidence.inPenaltyArea` === `inBox` 本身，
 *   而 `varReviewDecision` 的 `supported` 只要求 `inPenaltyArea && offenceType∈{foul,handball}`。
 *   ⇒ 只要 inBox 为真，VAR 必然推翻为 penalty，第③层的 missRisk 是**死代码**，
 *     「抢断路径点球数 ≈ 禁区内犯规数」。若实测成立，则产出完全由 0.014 驱动。
 *
 * 口径纪律（见 skill `sim-change-validation` Step 3.8 / 3.85 / 3.95）：
 *   - 只读引擎自写的事件字段（type/team/penalty/handball/card/decision），不做几何推断。
 *   - 自检内建：加和恒等式 + VAR 交叉核对 + 量级核对 + 组成分母一并打印。
 *
 * 用法：node scripts/_penalty-funnel-probe.mjs [场数] [profile]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

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
      "positioning", "kicking", "decisions", "crossing",
    ]) {
      attrs[key] = rating;
    }
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
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
      style: "balanced",
    },
  };
}

const pct = (num, den) => Number(((num / Math.max(1, den)) * 100).toFixed(1));
const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};

const matchCount = Math.max(1, Number(process.argv[2]) || 18);
const profile = process.argv[3] || "standard";
const seeds = Array.from({ length: matchCount }, (_, i) => 372000 + i);
const timeStep = SIM.DT;

// `_inOwnFoulBox` 的等价几何；仅用于交叉核对，不用于主计数。
const inBox = (team, x, y) => x > 22 && x < 78 && (team === "home" ? y >= 84 : y <= 16);

const agg = {
  matches: 0,
  fouls: 0,
  foulsByFilter: 0,
  foulPenaltyTrue: 0,
  foulPenaltyFalse: 0,
  foulHandball: 0,
  foulHandballPenalty: 0,
  foulTacklePenalty: 0,
  foulTackleNoPenalty: 0,
  foulInBoxGeom: 0,
  foulOutBoxGeom: 0,
  varReview: 0,
  varReviewPenalty: 0,
  varDecision: 0,
  varDecisionPenalty: 0,
  varDecisionNoPenalty: 0,
  varConfirmed: 0,
  varOverturned: 0,
  varOverturnedToPenalty: 0,
  varOverturnedToNoPenalty: 0,
  handballEvents: 0,
  handballPenalty: 0,
  penaltyEventKinds: new Map(),
  goals: 0,
  perMatchFouls: [],
  perMatchInBox: [],
  perMatchPenalty: [],
};

for (const seed of seeds) {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, 15),
      makeClub(`away-${seed}`, 15),
      { simulationProfile: profile, timeStep, separationPasses: 8 }
    );
    const steps = Math.round((90 * 60) / timeStep);
    for (let step = 0; step < steps; step++) engine.step(timeStep);

    const events = engine.events || [];
    agg.matches++;
    let mFouls = 0;
    let mInBox = 0;
    let mPen = 0;

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e || typeof e.type !== "string") continue;

      if (e.type === "foul") {
        agg.fouls++;
        mFouls++;
        if (inBox(e.team, e.x, e.y)) {
          agg.foulInBoxGeom++;
          mInBox++;
        } else {
          agg.foulOutBoxGeom++;
        }
        if (e.penalty === true) {
          agg.foulPenaltyTrue++;
          mPen++;
          if (e.handball === true) agg.foulHandballPenalty++;
          else agg.foulTacklePenalty++;
        } else {
          agg.foulPenaltyFalse++;
          if (e.handball !== true) agg.foulTackleNoPenalty++;
        }
        if (e.handball === true) agg.foulHandball++;
      }

      if (e.type === "handball") {
        agg.handballEvents++;
        if (e.penalty === true) agg.handballPenalty++;
      }

      if (e.type === "var_review") {
        agg.varReview++;
        if (e.incident === "penalty") agg.varReviewPenalty++;
      }

      if (e.type === "var_decision") {
        agg.varDecision++;
        if (e.finalDecision === "penalty") agg.varDecisionPenalty++;
        else if (e.finalDecision === "no-penalty") agg.varDecisionNoPenalty++;
        if (e.decision === "confirmed") agg.varConfirmed++;
        else if (e.decision === "overturned") {
          agg.varOverturned++;
          if (e.finalDecision === "penalty") agg.varOverturnedToPenalty++;
          else agg.varOverturnedToNoPenalty++;
        }
      }

      if (e.type === "goal") {
        agg.goals++;
        if (e.penalty === true) {
          const k = "goal(penalty)";
          agg.penaltyEventKinds.set(k, (agg.penaltyEventKinds.get(k) || 0) + 1);
        }
      }
      if (e.penalty === true && e.type !== "foul" && e.type !== "goal") {
        agg.penaltyEventKinds.set(e.type, (agg.penaltyEventKinds.get(e.type) || 0) + 1);
      }
    }
    agg.perMatchFouls.push(mFouls);
    agg.perMatchInBox.push(mInBox);
    agg.perMatchPenalty.push(mPen);
  } finally {
    Math.random = original;
  }
}

const per = (v) => Number((v / Math.max(1, seeds.length)).toFixed(2));
const N = seeds.length;

console.log(`\n=== 点球漏斗探针  profile=${profile}  ${N} 场  种子 ${seeds[0]}..${seeds[N - 1]} ===`);

console.log("\n【第 0 层】犯规总量");
console.log(`  foul 事件总数          : ${agg.fouls}  (${per(agg.fouls)}/场)`);
console.log(`    ├─ 手球路径(handball) : ${agg.foulHandball}  (${per(agg.foulHandball)}/场)`);
console.log(`    └─ 抢断路径           : ${agg.fouls - agg.foulHandball}  (${per(agg.fouls - agg.foulHandball)}/场)`);

console.log("\n【第 1 层】犯规地点（几何核对，用事件自带 team/x/y）");
console.log(`  本方禁区内             : ${agg.foulInBoxGeom}  (${per(agg.foulInBoxGeom)}/场)  ${pct(agg.foulInBoxGeom, agg.fouls)}%`);
console.log(`  禁区外                 : ${agg.foulOutBoxGeom}  (${per(agg.foulOutBoxGeom)}/场)`);

console.log("\n【第 2 层】事件自带 penalty 标记");
console.log(`  penalty:false          : ${agg.foulPenaltyFalse}  (${per(agg.foulPenaltyFalse)}/场)`);
console.log(`  penalty:true  合计     : ${agg.foulPenaltyTrue}  (${per(agg.foulPenaltyTrue)}/场)`);
console.log(`    ├─ 手球路径          : ${agg.foulHandballPenalty}  (${per(agg.foulHandballPenalty)}/场)`);
console.log(`    └─ 抢断路径          : ${agg.foulTacklePenalty}  (${per(agg.foulTacklePenalty)}/场)`);

console.log("\n【第 3/4 层】VAR");
console.log(`  var_review             : ${agg.varReview}  (${per(agg.varReview)}/场)`);
console.log(`    incident=penalty     : ${agg.varReviewPenalty}  (${per(agg.varReviewPenalty)}/场)`);
console.log(`  var_decision           : ${agg.varDecision}`);
console.log(`    finalDecision=penalty: ${agg.varDecisionPenalty}  (${per(agg.varDecisionPenalty)}/场)`);
console.log(`    finalDecision=no-pen : ${agg.varDecisionNoPenalty}`);
console.log(`    confirmed            : ${agg.varConfirmed}`);
console.log(`    overturned           : ${agg.varOverturned}` +
  `  (→penalty ${agg.varOverturnedToPenalty} / →no-penalty ${agg.varOverturnedToNoPenalty})`);

console.log("\n【第 5 层】点球相关事件（按 type 归类）");
if (agg.penaltyEventKinds.size === 0) {
  console.log(`  （无任何 penalty:true 的非 foul 事件）`);
} else {
  for (const [k, v] of [...agg.penaltyEventKinds.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}  (${per(v)}/场)`);
  }
}
console.log(`  进球总数               : ${agg.goals}  (${per(agg.goals)}/场)`);

console.log("\n【每场波动】");
console.log(`  犯规/场    中位 ${median(agg.perMatchFouls)}  区间 ${Math.min(...agg.perMatchFouls)}~${Math.max(...agg.perMatchFouls)}`);
console.log(`  禁区内/场  中位 ${median(agg.perMatchInBox)}  区间 ${Math.min(...agg.perMatchInBox)}~${Math.max(...agg.perMatchInBox)}`);
console.log(`  点球/场    中位 ${median(agg.perMatchPenalty)}  区间 ${Math.min(...agg.perMatchPenalty)}~${Math.max(...agg.perMatchPenalty)}`);

console.log("\n--- 自检 ---");
console.log(`  ⚠️ 恒等式 penalty:true(${agg.foulPenaltyTrue}) + penalty:false(${agg.foulPenaltyFalse})` +
  ` == foul 总数(${agg.fouls}) → ${agg.foulPenaltyTrue + agg.foulPenaltyFalse === agg.fouls ? "✅ 相等" : "❌ 不等"}`);
console.log(`  ⚠️ 恒等式 手球(${agg.foulHandballPenalty}) + 抢断(${agg.foulTacklePenalty})` +
  ` == penalty:true(${agg.foulPenaltyTrue}) → ${agg.foulHandballPenalty + agg.foulTacklePenalty === agg.foulPenaltyTrue ? "✅ 相等" : "❌ 不等"}`);
console.log(`  ⚠️ 恒等式 禁区内(${agg.foulInBoxGeom}) + 禁区外(${agg.foulOutBoxGeom})` +
  ` == foul 总数(${agg.fouls}) → ${agg.foulInBoxGeom + agg.foulOutBoxGeom === agg.fouls ? "✅ 相等" : "❌ 不等"}`);
const gap = agg.foulInBoxGeom - agg.foulPenaltyTrue;
console.log(`  ⚠️ 交叉核对 几何禁区内(${agg.foulInBoxGeom}) vs penalty:true(${agg.foulPenaltyTrue})` +
  ` → 差 ${gap} ${Math.abs(gap) <= 2 ? "✅ 判据一致" : "❌ 判据不一致"}`);
const rate = agg.fouls / N;
console.log(`  ⚠️ 量级核对 犯规 ${rate.toFixed(2)}/场 vs 引擎注释 ~22/场 → ` +
  (rate >= 14 && rate <= 32 ? "✅ 同量级" : `❌ 偏 ${(rate - 22).toFixed(1)}`));
console.log(`  ⚠️ VAR 交叉核对 var_review(${agg.varReview}) vs var_decision(${agg.varDecision})` +
  ` → ${agg.varReview === agg.varDecision ? "✅ 一一对应" : `❌ 差 ${agg.varReview - agg.varDecision}`}`);
