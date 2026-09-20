/**
 * 进球护栏带宽标定（探针口径）—— 2026-09-20。
 *
 * ## 为什么需要这一支
 *
 * 设计稿 `docs/one-on-one-beat-primitive-design-2026-09-18.md` §7.5 末把
 * 「`beat` 开进标准档」的前置写死为：**先给「进球」补护栏**。
 * 现状是**两条口径严重不对称**：
 *
 *   · **审计口径**（`match-realism-audit.mjs`，能力 13、含强弱、24 场）：
 *     有真护栏 `[2.5, 3.3]`（`assert.ok(goals >= 2.5 && goals <= 3.3)`）。
 *   · **探针口径**（本仓绝大多数探针，能力 15、双方同构）：
 *     `_final-third-movement-calibration-probe.mjs` 里的 `PROBE_BAND.goals = [2.2, 2.7]`
 *     **只是三点手工画出来的软标注**（v251 2.50 / v252 2.35 / 今日 2.38），
 *     **没有噪声标定，因此没有判决力** —— 越界只是"打印一句警告"，不判死。
 *
 * ⇒ 拿 `[2.2, 2.7]` 去判探针档位改动（例如 beat、直塞 vision），
 *   等于拿一条**没人验过噪声的红线**做决定。这正是 boxSec `850` 与直塞
 *   `[0.5, 12]` 栽过的那个坑（AGENTS.md「护栏纪律」）。
 *
 * ## 方法型（逐字沿用，不另发明）
 *
 * 与 `_beat-noise-calibration-probe.mjs` / `_box-seconds-rebaseline-probe.mjs noise`
 * **完全同型**：**B 批互不重叠的种子窗口 × 批内 m 场**，统计
 *   ① 逐场 SD（`SD_match`）—— 决定"要辨出 E/场 的效应，每组需要多少场"
 *   ② 批间 SD（`SD_batch`）—— 决定"m 场一读数，本身能稳定到几位"
 * 再按 **2SE 门槛**推导带宽。统计工具（`mean`/`stdev`/`median`）同式，便于横向比对。
 *
 * ## 口径对齐（关键，别混用）
 *
 * 本探针测的是**探针口径**进球（能力 15、双方同构、标准档、`SIM.DT`），
 * 与 `_final-third-movement-calibration-probe.mjs` 同源 ⇒ 定出来的带宽
 * **只能替换 `PROBE_BAND.goals`，不能替换审计口径的 `[2.5, 3.3]`**。
 * 两口径历史读数本就不同量级（审计口径 2.54 参考值 vs 探针口径 2.35~2.50）。
 *
 * ## 用法
 *
 *   node scripts/_goals-noise-calibration-probe.mjs
 *     # 默认：8 批 × 12 场 = 96 场，与 beat 标定同规模同窗
 *   node scripts/_goals-noise-calibration-probe.mjs [批内场数] [批数] [起始种子]
 *
 * ⚠ 纯只读：不改引擎、不插桩、不消费额外随机数。
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const perBatch = Math.max(2, Number(process.argv[2]) || 12);
const batches = Math.max(2, Number(process.argv[3]) || 8);
const START_SEED = Math.max(1, Number(process.argv[4]) || 372000);
const total = perBatch * batches;

const simulationProfile = "standard";
const timeStep = SIM.DT;
const separationPasses = 8;

// —— 球队构造：17 项属性、无 crossing、能力 15 ——
// 与 `_beat-noise-calibration-probe.mjs` / `_final-third-movement-calibration-probe.mjs`
// 的 control 档同式，这样定出来的带宽才与既有探针读数可比。
// ⚠ 刻意**不给 crossing**：这是标准档基线（STANDARD_PROFILE_REFERENCE_24）同源的构造。
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
      "positioning", "kicking", "decisions",
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

// ⚠ 引擎不认 `opts.seed`（`engine.js:510` 只读 `opts.random`）——
//   这里与既有探针同式：直接替换 `Math.random`，保证同种子可复现。
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** 跑一场，返回该场进球数（双方合计）+ 分主客，便于检查是否有单向偏置。 */
function runMatch(seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  const goalsByTeam = { home: 0, away: 0 };
  try {
    const home = makeClub(`home-${seed}`, 15);
    const away = makeClub(`away-${seed}`, 15);
    const engine = new SimEngine(home, away, {
      simulationProfile,
      timeStep,
      separationPasses,
    });
    const steps = Math.round((90 * 60) / timeStep);
    for (let step = 0; step < steps; step++) {
      engine.step(timeStep);
      const events = engine.events || [];
      for (const ev of events) {
        if (ev.type !== "goal") continue;
        if (ev.team === "home") goalsByTeam.home += 1;
        else if (ev.team === "away") goalsByTeam.away += 1;
      }
      if (events.length) events.length = 0;
    }
    return {
      seed,
      goals: goalsByTeam.home + goalsByTeam.away,
      goalsHome: goalsByTeam.home,
      goalsAway: goalsByTeam.away,
    };
  } finally {
    Math.random = originalRandom;
  }
}

// —— 统计工具（与 `_beat-noise-calibration-probe.mjs` 同式）——
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const stdev = (v) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
const median = (v) => {
  if (!v.length) return 0;
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};
const fx = (v) => Number(v.toFixed(3));

console.log(
  `\n=== 进球护栏带宽标定（探针口径，${batches} 批 × ${perBatch} 场 = ${total} 场，` +
    `种子 ${START_SEED}..${START_SEED + total - 1}）===`
);
console.log("档位：standard（无 beatPrimitive）/ 17 项属性 / 能力 15 / 4-3-3 / 双方同构。");
console.log("口径：探针口径（与 _final-third-movement-calibration-probe.mjs 同源）。");
console.log("⚠ 本带宽只替换 PROBE_BAND.goals；审计口径 [2.5, 3.3] 不动（那是另一条口径）。");

const batchMeans = [];
const batchDetails = [];
const perMatchGoals = [];
const perMatchSideMax = [];
const perMatchHome = [];
const perMatchAway = [];

for (let b = 0; b < batches; b++) {
  const rows = [];
  for (let i = 0; i < perBatch; i++) {
    const seed = START_SEED + b * perBatch + i;
    const r = runMatch(seed);
    rows.push(r);
    perMatchGoals.push(r.goals);
    perMatchSideMax.push(Math.max(r.goalsHome, r.goalsAway));
    perMatchHome.push(r.goalsHome);
    perMatchAway.push(r.goalsAway);
  }
  const m = mean(rows.map((r) => r.goals));
  batchMeans.push(m);
  batchDetails.push({
    批: b + 1,
    种子: `${START_SEED + b * perBatch}..${START_SEED + b * perBatch + perBatch - 1}`,
    "进球/场(双方合计)": fx(m),
    单场最少: Math.min(...rows.map((r) => r.goals)),
    单场最多: Math.max(...rows.map((r) => r.goals)),
  });
  process.stderr.write(`批 ${b + 1}/${batches}: 进球/场 ${fx(m)}\n`);
}

const sdMatch = stdev(perMatchGoals);
const sdBatch = stdev(batchMeans);
const grandMean = mean(perMatchGoals);

console.log("\n[1] 🔑 核心结论 —— 同一引擎同一档位，换一批种子读数会漂多少：");
console.log({
  "进球/场 总体均值(双方合计)": fx(grandMean),
  "进球/场 中位数": median(perMatchGoals),
  [`批内均值范围(每批 ${perBatch} 场)`]: `${fx(Math.min(...batchMeans))} ~ ${fx(Math.max(...batchMeans))}`,
  "批间标准差(SD_batch)": fx(sdBatch),
  "批间极差": fx(Math.max(...batchMeans) - Math.min(...batchMeans)),
  "逐场标准差(SD_match)": fx(sdMatch),
  "单场最少~最多": `${Math.min(...perMatchGoals)} ~ ${Math.max(...perMatchGoals)}`,
  "主队 均值": fx(mean(perMatchHome)),
  "客队 均值": fx(mean(perMatchAway)),
});

console.log("\n[2] 逐批明细（每批 = 一次「n 场测量」的读数）：");
for (const d of batchDetails) {
  console.log(
    `  批 ${String(d.批).padStart(2)} 种子 ${d.种子.padEnd(15)} ` +
      `进球/场 ${String(d["进球/场(双方合计)"]).padStart(7)}  ` +
      `单场 ${d.单场最少} ~ ${d.单场最多}`
  );
}

console.log("\n[3] ⚖ 判决力 —— 要辨出多大的效应，每组需要多少场：");
console.log("   （2SE 判据，两独立样本一组，用逐场 SD；门槛 = 2×SD/√n 每组）");
for (const eff of [0.25, 0.5, 1, 2]) {
  const n = Math.ceil(2 * ((2 * sdMatch) / eff) ** 2);
  console.log(`    效应 ${String(eff).padStart(4)} 球/场 → 每组约 ${String(n).padStart(5)} 场`);
}
console.log(
  `   · 换言之：用 ${perBatch} 场一批做读数，批间 SD = ${fx(sdBatch)}，` +
    `那么"读数本身"的 ±2SE ≈ ±${fx(2 * sdBatch)} 球/场。`
);

console.log("\n[4] 建议护栏带宽（据此表得，不手调）：");
{
  const halfMeasured = 2 * sdBatch;
  // 工程下限 0.25 球/场：与 beat 的「至少 1 次/场」同精神 ——
  // 进球是低频离散事件，护栏比噪声还窄没有意义；但也不能宽到判不出 0.5 球/场。
  const half = Math.max(halfMeasured, 0.25);
  console.log({
    基线: fx(grandMean),
    "批间 1SE": fx(sdBatch),
    "读数 ±2SE": fx(halfMeasured),
    "⇒ 采用的半边": fx(half),
    "⇒ 建议下沿": fx(grandMean - half),
    "⇒ 建议上沿": fx(grandMean + half),
  });
  console.log(
    `   读法：护栏到基线的距离必须 ≥ 2SE，否则翻红说明不了任何问题；\n` +
      `   若半边 <0.25 球/场，一律向上取 0.25（低频离散事件的工程下限）。\n` +
      `   ⚠ 对照现状：手工软标注 [2.2, 2.7]（三点 2.50/2.35/2.38）半边约 0.25，\n` +
      `     与本次实测半边 ${fx(half)} 的关系见上 —— 若实测明显更宽，\n` +
      `     说明旧软标注**比噪声还窄**，那它过去"没报警"只是运气。`
  );
}

console.log("\n[5] 分布形状（用于确认是否长尾、要不要用中位数）：");
{
  const sorted = [...perMatchGoals].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  console.log({
    min: sorted[0],
    p25: q(0.25),
    中位数: median(perMatchGoals),
    p75: q(0.75),
    max: sorted[sorted.length - 1],
    均值: fx(grandMean),
    零球场次占比: `${((sorted.filter((x) => x === 0).length / sorted.length) * 100).toFixed(1)}%`,
  });
}
