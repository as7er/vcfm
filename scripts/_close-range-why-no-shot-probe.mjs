/**
 * 诊断（第二轮，重建）：**门前极近区（dGoal ≤ 6 场地单位 ≈ 6.3 m）为什么没有射门？**
 *
 * 缘起：射门距离分布（`_shot-distance-probe`，事件流真值）已确证
 *   <6 单位仅 **2.4%（0.56 脚/场）**、中位 13.33 单位、86% 来自 9.5 单位以外。
 *   ⇒「近门犹豫不射」被否，问题变成「近门区为什么**几乎不产生射门**」。
 *
 * ⛔ 第一版（`_close-range-entry-outcome-probe.mjs`）自我矛盾已作废：
 *   进入 58.89 次/场、持球人 65% 是门将、dwell 恒等于窗口 —— 详见 AGENTS.md。
 *   根因是**用几何/速度判定「谁在进攻」**（门将近静止时误判）加状态机结算写错。
 *
 * ✅ 本版的设计原则（对抗上一版的失效模式）：
 *   1. **不做几何判定进攻方** —— 一律用引擎自己写在事件上的 `team`
 *      （`_emit` 的 `team: a?.team`，见 `engine.js:5036`）。
 *   2. **不做状态机** —— 只在**事件流**上工作，没有任何 `inside/entry` 标志位，
 *      因此不存在「结算路径漏触发」这类 bug。
 *   3. **每条读数都附自检**：分母、构成、以及一个「必须为真」的恒等式，
 *      输出里直接打印，读的人能当场发现仪器坏掉。
 *
 * 量什么：把**每支球队每一次「球到 ≤6 且归属明确」**作为一次机会，
 * 看它在**同一次进攻归属（同一 kickTeam 连续持有）**内以什么结束。
 *   · 事件流按 `t` 排序；用 `shot`(带距离) / `pass` / `tackle` / `block` / `save`
 *     重建「球权段」：一段 = 同一 `team` 的连续事件，直到对方事件或死球。
 *   · 段内最小 `dGoal` ≤ 6 的段，记为「到过近门区」。
 *   · 该段的终止事件 = 段内最后一条事件（射门/传球/被断/被封堵）。
 *
 * 用法：node scripts/_close-range-why-no-shot-probe.mjs [场数]
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

// 引擎里「球到球门的距离」= dist(x,y,50,targetGoalY(team))。
// targetGoalY: home -> AWAY_GOAL_Y=0, away -> HOME_GOAL_Y=100（已实测核对）。
const targetY = (team) => (team === "home" ? SIM.AWAY_GOAL_Y : SIM.HOME_GOAL_Y);
const distToGoal = (team, x, y) => Math.hypot(x - 50, y - targetY(team));

const agg = {
  matches: 0,
  totalEvents: 0,
  shots: 0,
  possessionRuns: 0,        // 球权段总数
  runsReachingZone: 0,      // 到过 ≤6 的段
  runsWithShotInZone: 0,    // 到过 ≤6 且在区内射门的段
  runsWithShotAnywhere: 0,  // 到过 ≤6 且该段内任何位置射门的段
  terminal: new Map(),      // 到过 ≤6 的段，其终止事件类型
  minDist: [],              // 到过 ≤6 的段，段内最小 dGoal
  zoneShotDist: [],         // 区内射门的距离分布
  zoneShotPerMatch: [],
  // 自检
  sanityNonZeroShots: 0,
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

    const events = (engine.events || []).filter((e) => Number.isFinite(e.t));
    events.sort((a, b) => a.t - b.t);
    agg.matches++;
    agg.totalEvents += events.length;

    // —— 按 team 切「球权段」：team 变了就开新段；只考虑带 team 的事件 ——
    const runs = [];
    let cur = null;
    for (const ev of events) {
      if (!ev.team) continue;
      if (!cur || cur.team !== ev.team) {
        cur = { team: ev.team, events: [] };
        runs.push(cur);
      }
      cur.events.push(ev);
      if (ev.type === "shot") agg.shots++;
    }
    agg.possessionRuns += runs.length;
    agg.sanityNonZeroShots += events.filter((e) => e.type === "shot").length;

    let zoneShotsThisMatch = 0;
    for (const run of runs) {
      // 段内最小 dGoal（用事件自带 x/y；无 x/y 的事件跳过）
      let minD = Infinity;
      for (const ev of run.events) {
        if (!Number.isFinite(ev.x) || !Number.isFinite(ev.y)) continue;
        minD = Math.min(minD, distToGoal(run.team, ev.x, ev.y));
      }
      if (!Number.isFinite(minD)) continue;
      if (minD > ZONE) continue;
      agg.runsReachingZone++;
      agg.minDist.push(minD);

      const shotsInRun = run.events.filter((e) => e.type === "shot");
      const shotsInZone = shotsInRun.filter(
        (e) => Number.isFinite(e.x) && Number.isFinite(e.y) &&
          distToGoal(run.team, e.x, e.y) <= ZONE
      );
      if (shotsInRun.length) agg.runsWithShotAnywhere++;
      if (shotsInZone.length) {
        agg.runsWithShotInZone++;
        zoneShotsThisMatch += shotsInZone.length;
        for (const s of shotsInZone) if (Number.isFinite(s.distance)) agg.zoneShotDist.push(s.distance);
      }
      const last = run.events[run.events.length - 1];
      bump(agg.terminal, last.type);
    }
    agg.zoneShotPerMatch.push(zoneShotsThisMatch);
  } finally {
    Math.random = original;
  }
}

const per = (v) => Number((v / Math.max(1, seeds.length)).toFixed(2));
console.log(
  `\n=== 门前极近区（≤${ZONE} 单位 ≈ ${(ZONE * 1.05).toFixed(1)} m）为什么没有射门` +
    `（${seeds.length} 场，种子 ${seeds[0]}..${seeds[seeds.length - 1]}）===`
);
console.log("\n[0] 仪器自检：");
console.log({
  事件总数: agg.totalEvents,
  每场: per(agg.totalEvents),
  射门事件总数: agg.shots,
  每场: per(agg.shots),
  球权段总数: agg.possessionRuns,
  每场: per(agg.possessionRuns),
});
console.log(
  `  ⚠️ 恒等式：射门事件 ${agg.shots} 必须与独立计数 ${agg.sanityNonZeroShots} 相等 → ` +
    (agg.shots === agg.sanityNonZeroShots ? "✅ 相等" : `❌ 不等（差 ${agg.shots - agg.sanityNonZeroShots}）`)
);
console.log(
  `  ⚠️ 合理性：射门/场 ${per(agg.shots)} 应与已确证的 23.61 同量级 → ` +
    (Math.abs(per(agg.shots) - 23.61) / 23.61 < 0.25 ? "✅ 一致" : "❌ 偏差过大")
);

console.log("\n[1] 到过 ≤6 的球权段：");
console.log({
  段数: agg.runsReachingZone,
  每场: per(agg.runsReachingZone),
  "占全部段": `${pct(agg.runsReachingZone, agg.possessionRuns)}%`,
  "段内最小 dGoal 中位": median(agg.minDist),
});
console.log("\n[2] ★ 这些段里有没有射门：");
console.log({
  "段内任何位置射门": `${agg.runsWithShotInZone + (agg.runsWithShotAnywhere - agg.runsWithShotInZone)} (${pct(agg.runsWithShotAnywhere, agg.runsReachingZone)}%)`,
  "其中在 ≤6 区内射门": `${agg.runsWithShotInZone} (${pct(agg.runsWithShotInZone, agg.runsReachingZone)}%)`,
  "完全没射门": `${agg.runsReachingZone - agg.runsWithShotAnywhere} (${pct(agg.runsReachingZone - agg.runsWithShotAnywhere, agg.runsReachingZone)}%)`,
});
console.log("\n[3] 到过 ≤6 却没射门的段，终止事件是什么：");
for (const [k, v] of [...agg.terminal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${k}: ${v} (${pct(v, agg.runsReachingZone)}%)  ${per(v)}/场`);
}
console.log("\n[4] 区内射门的距离（应全部 ≤6）：");
console.log({
  n: agg.zoneShotDist.length,
  最大: agg.zoneShotDist.length ? Math.max(...agg.zoneShotDist).toFixed(2) : 0,
  中位: median(agg.zoneShotDist),
  每场: Number((agg.zoneShotDist.length / Math.max(1, seeds.length)).toFixed(2)),
});
console.log(
  "  ⚠️ 与 `_shot-distance-probe` 的「<6 共 10 脚 / 0.56 每场」比对口径差异：" +
    "本探针按**球权段内**归属计，那边按**shot.distance**（出脚点）计。"
);
