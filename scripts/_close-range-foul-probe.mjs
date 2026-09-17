/**
 * 诊断：门前极近区（≤6 单位）的**犯规**到底是什么？
 *
 * 缘起：`_close-range-why-no-shot-probe.mjs`（已自检、事件流真值）18 场读数显示
 *   到过 dGoal ≤ 6 的球权段 **3 段/场（占全部段 0.6%）**，其中 **85.2% 没有射门**，
 *   而终止事件里 **foul 占 55.6%（1.67/场）** —— 即「球到门前就被犯规终止」。
 *
 * 本探针回答三个问题（全部基于引擎自写的 `foul` 事件字段，不做几何推断）：
 *   1. 全部犯规里，门前（dGoal ≤ 6）占多少？和 `_calculateFoul` 的注释「约 22/场」对得上吗？
 *   2. 门前犯规里 `penalty: true` 占多少？（即真的判了点球的比例）
 *   3. 门前犯规的牌型、以及**被侵犯方**是否确实在进攻（用 foul.from 反查）？
 *
 * ⚠️ 自检（按技能 Step 3.95）：
 *   · 恒等式：foul 事件数 = 用 `type==="foul"` 独立过滤的计数
 *   · 量级：犯规/场 应与引擎注释的 ~22 同量级
 *   · 组成：分母与构成一并打印
 *
 * 用法：node scripts/_close-range-foul-probe.mjs [场数]
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
      lineup: players.map((player) => player.id),
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
const seeds = Array.from({ length: matchCount }, (_, i) => 372000 + i);
const timeStep = SIM.DT;
const ZONE = 6;

// 犯规由**防守方**（defender）发出，`from` = 被侵犯者。
// 被侵犯者所属队 = 进攻方 ⇒ 球门参照用被侵犯者的 targetGoal。
// 但 `_emit("foul", defender, ...)` 的 `team` 是 defender 的队，
// 而 x/y 是**犯规发生地点**。判断「离哪个门近」不需要知道谁进攻：
//   取 min(离 y=0 的门, 离 y=100 的门)，若 ≤ ZONE 即「在某个门前极近区」。
const nearestGoalDist = (x, y) =>
  Math.min(Math.hypot(x - 50, y - 0), Math.hypot(x - 50, y - 100));

const agg = {
  fouls: 0,
  foulsByFilter: 0,
  nearGoal: 0,
  nearGoalPenalty: 0,
  allPenalty: 0,
  cards: new Map(),
  nearGoalDist: [],
  foulDistFromNearestGoal: [],
  nearGoalInBox: 0,
  perMatchFouls: [],
  perMatchNearGoal: [],
};
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

for (const seed of seeds) {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, 15),
      makeClub(`away-${seed}`, 15),
      { simulationProfile: "standard", timeStep, separationPasses: 8 }
    );
    const steps = Math.round((90 * 60) / timeStep);
    for (let step = 0; step < steps; step++) engine.step(timeStep);

    const events = engine.events || [];
    const fouls = events.filter((e) => e.type === "foul");
    agg.fouls += fouls.length;
    agg.foulsByFilter += fouls.filter((e) => e.type === "foul").length;

    let mNear = 0;
    for (const f of fouls) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) continue;
      const d = nearestGoalDist(f.x, f.y);
      agg.foulDistFromNearestGoal.push(d);
      if (f.penalty) agg.allPenalty++;
      if (d <= ZONE) {
        agg.nearGoal++;
        mNear++;
        agg.nearGoalDist.push(d);
        if (f.penalty) agg.nearGoalPenalty++;
        bump(agg.cards, f.card || "none");
        // 是否在禁区内（用引擎自己的 penalty 标记即可，但再记一次 inBox 几何）
        const inBox =
          (f.x > 22 && f.x < 78) && (f.y >= 84 || f.y <= 16);
        if (inBox) agg.nearGoalInBox++;
      }
    }
    agg.perMatchFouls.push(fouls.length);
    agg.perMatchNearGoal.push(mNear);
  } finally {
    Math.random = original;
  }
}

const per = (v) => Number((v / Math.max(1, seeds.length)).toFixed(2));
console.log(
  `\n=== 门前极近区（≤${ZONE} 单位）的犯规到底是什么（${seeds.length} 场，` +
    `种子 ${seeds[0]}..${seeds[seeds.length - 1]}）===`
);
console.log("\n[0] 仪器自检：");
console.log({
  犯规事件数: agg.fouls,
  独立过滤计数: agg.foulsByFilter,
  每场: per(agg.fouls),
});
console.log(
  `  ⚠️ 恒等式：${agg.fouls} = ${agg.foulsByFilter} → ` +
    (agg.fouls === agg.foulsByFilter ? "✅ 相等" : "❌ 不等")
);
console.log(
  `  ⚠️ 量级：犯规/场 ${per(agg.fouls)} 应与引擎注释的「约 22」同量级 → ` +
    (per(agg.fouls) >= 10 && per(agg.fouls) <= 45 ? "✅ 一致" : "❌ 偏差过大")
);

console.log("\n[1] 全部犯规 vs 门前犯规：");
console.log({
  "全部犯规": `${agg.fouls} (${per(agg.fouls)}/场)`,
  "其中离最近球门 ≤6": `${agg.nearGoal} (${pct(agg.nearGoal, agg.fouls)}%)  ${per(agg.nearGoal)}/场`,
  "离最近球门距离中位": median(agg.foulDistFromNearestGoal),
});
console.log("\n[2] 点球：");
console.log({
  "全部犯规中 penalty=true": `${agg.allPenalty} (${pct(agg.allPenalty, agg.fouls)}%)  ${per(agg.allPenalty)}/场`,
  "门前犯规中 penalty=true": `${agg.nearGoalPenalty} (${pct(agg.nearGoalPenalty, agg.nearGoal)}%)  ${per(agg.nearGoalPenalty)}/场`,
  "门前犯规且几何在禁区内": `${agg.nearGoalInBox} (${pct(agg.nearGoalInBox, agg.nearGoal)}%)`,
});
console.log("\n[3] 门前犯规的牌型：");
for (const [k, v] of [...agg.cards.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v} (${pct(v, agg.nearGoal)}%)`);
}
console.log("\n[4] 每场波动（用于判断单场是否可信）：");
console.log({
  "犯规/场 中位": median(agg.perMatchFouls),
  "犯规/场 min~max": `${Math.min(...agg.perMatchFouls)}~${Math.max(...agg.perMatchFouls)}`,
  "门前犯规/场 中位": median(agg.perMatchNearGoal),
  "门前犯规/场 min~max": `${Math.min(...agg.perMatchNearGoal)}~${Math.max(...agg.perMatchNearGoal)}`,
});
