/**
 * `beat` 护栏带宽标定（设计稿 §5.5 表第 6 项 / 落地步骤 #5，2026-09-18 起筹备）。
 *
 * ## 为什么必须先测噪声
 *
 * 「护栏带宽」不是可以拍脑袋定的数字。一条护栏要有**判决力**，它到基线的距离
 * 必须大于「换一批种子，读数会漂多少」——也就是读数自身的标准误。
 * 不先量化批间 SD，「守 X/场」和「放宽到 Y/场」都只是在噪声上做决定
 * （这个教训在 boxSec 那次已经付过学费：见 `_box-seconds-rebaseline-probe.mjs`
 * 头部注释，850 护栏在 48 场规模下 2SE=29s，完全没有判决力）。
 *
 * ## 方法型来源
 *
 * 逐字沿用 `_box-seconds-rebaseline-probe.mjs` 的 `noise` 模式：
 * **B 批互不重叠的种子窗口 × 批内 m 场**，统计
 *   ① 逐场 SD（决定"要辨出 E/场 的效应，每组需要多少场"）
 *   ② 批间 SD（决定"m 场一读数，本身能稳定到几位"）
 * 统计工具（`mean` / `stdev` / `median`）与它保持同式，便于横向比对。
 *
 * ## 与它的差异（此处是**真实事件流**，不是探针侧反事实）
 *
 * boxSec 探针测的是"探针侧挂原语"；本探针测的是**引擎真的跑 `beatPrimitive`**
 * 时产出的 `beat` 事件流 —— 这正是设计稿 §5.5 第 6 项强调的点：
 * 反事实不产生真实事件，带宽只能在落地（开关打开）后测。
 *
 * ⚠ **口径必须与将来的审计一致**：`beat` 事件由 `_emit("beat", a, {...})` 发出，
 * 发起者是 `a`，`_emit` 写入字段 **`agentId`**（不是 `by`）；
 * 被越过者是 `from`。本探针按 `agentId` 归属球队来分主客，
 * **不要**像早期脚本那样用 `ev.by`（永远 undefined ⇒ 拆分恒失效）。
 *
 * ## 用法
 *
 *   node scripts/_beat-noise-calibration-probe.mjs
 *     # 默认：8 批 × 12 场 = 96 场，标准档 + beatPrimitive
 *   node scripts/_beat-noise-calibration-probe.mjs [批内场数] [批数]
 *   node scripts/_beat-noise-calibration-probe.mjs [批内场数] [批数] [起始种子]
 *     # 起始种子用于换窗口复查（默认 372000，与 boxSec 标定同窗，便于横向比）
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const perBatch = Math.max(2, Number(process.argv[2]) || 12);
const batches = Math.max(2, Number(process.argv[3]) || 8);
const START_SEED = Math.max(1, Number(process.argv[4]) || 372000);
const total = perBatch * batches;

const simulationProfile = "standard";
const timeStep = SIM.DT;
const separationPasses = 8;

// —— 球队构造：与 boxSec 探针 / 审计同式（17 项属性、无 crossing、能力 15）——
// 这一档球队是标准档基线（STANDARD_PROFILE_REFERENCE_24）同源的构造，
// 这样「band 里写 4.13/场」才有确定的解释：它就是"势均力敌两只中游队"下的读数。
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

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

// —— 插桩：`_attemptBeat` 只计数，不改行为 ——
//
// 引擎没有暴露"尝试数"计数器，所以这里在原型上包一层。**只读不写**：
// 取 `random()` 之前的状态无法从外部拿到，所以改用「进函数就被选中一次」+
// 「出来时看 `beatActionUntil` 有没有被推进」来判断是否越过意图门槛。
// ⚠ 这**不扰动**任何引擎状态：包装层只读实例字段。
const ORIG_ATTEMPT = SimEngine.prototype._attemptBeat;
const INSTRUMENT = { on: false, selected: 0, passed: 0, inIntentP: [] };

SimEngine.prototype._attemptBeat = function _probeAttemptBeat(a, opp) {
  if (!INSTRUMENT.on) return ORIG_ATTEMPT.call(this, a, opp);
  INSTRUMENT.selected += 1;
  const before = a.beatCdUntil;
  const result = ORIG_ATTEMPT.call(this, a, opp);
  // 意图门槛通过 ⇒ 冷却仍被推进（两种路径都推进），
  // 但**只有通过的那条**会走进 `_beatDuelCandidate`。
  // 用「冷却从"未激活"变为"> now"」当"确实进过函数体"的近似；
  // 更可靠的是数 `beat` 事件（真正的成功），所以这里只留作分母参考。
  if (before !== a.beatCdUntil) INSTRUMENT.passed += 1;
  return result;
};

/**
 * 跑一场，返回该场的 `beat` 读数。
 *
 * 分三个层次记，因为带宽可能要盯其中最稳的那个：
 *   · `beats`        —— 双方合计 `beat` 事件数 / 场
 *   · `beatsSideMax` —— 单队最大值（"单队 beat 成功/场"，与真实基准同口径）
 *   · `selected`     —— 进 `_attemptBeat` 的次数（被选中），用于看意图门槛
 *   · `topShare`     —— 单球员占比，用于监控属性差是否被摊薄
 */
function runMatch(seed, beatPrimitive) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  const beatsByTeam = { home: 0, away: 0 };
  const beatsByPlayer = new Map();
  INSTRUMENT.on = beatPrimitive;
  INSTRUMENT.selected = 0;
  INSTRUMENT.passed = 0;
  try {
    const home = makeClub(`home-${seed}`, 15);
    const away = makeClub(`away-${seed}`, 15);
    const engine = new SimEngine(home, away, {
      simulationProfile,
      timeStep,
      separationPasses,
      beatPrimitive, // 🔑 只有这里是真的打开开关
    });

    // 队名 → 队标识的反查（`agentId` 是球员 id，前缀就是队在 makeClub 里的名字）
    const teamOf = (agentId) => {
      if (!agentId) return null;
      if (String(agentId).startsWith(`home-${seed}-`)) return "home";
      if (String(agentId).startsWith(`away-${seed}-`)) return "away";
      return null;
    };

    const steps = Math.round((90 * 60) / timeStep);
    for (let step = 0; step < steps; step++) {
      engine.step(timeStep);
      // `beat` 事件在 `engine.events` 里累积（只在构造时清一次），
      // 每步抽走避免数组无限增长，同时这正是"事件流"的采样点。
      const events = engine.events || [];
      for (const ev of events) {
        if (ev.type !== "beat") continue;
        const team = teamOf(ev.agentId);
        if (!team) continue;
        beatsByTeam[team] += 1;
        beatsByPlayer.set(ev.agentId, (beatsByPlayer.get(ev.agentId) || 0) + 1);
      }
      if (events.length) events.length = 0;
    }

    const beats = beatsByTeam.home + beatsByTeam.away;
    const beatsSideMax = Math.max(beatsByTeam.home, beatsByTeam.away);
    let topShare = 0;
    if (beats > 0) {
      const top = Math.max(...beatsByPlayer.values());
      topShare = Number((top / beats).toFixed(3));
    }
    return {
      seed,
      beats,
      beatsHome: beatsByTeam.home,
      beatsAway: beatsByTeam.away,
      beatsSideMax,
      selected: INSTRUMENT.selected,
      passed: INSTRUMENT.passed,
      topShare,
    };
  } finally {
    Math.random = originalRandom;
    INSTRUMENT.on = false;
  }
}

// —— 统计工具（与 `_box-seconds-rebaseline-probe.mjs` 同式）——
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
  `\n=== beat 护栏带宽标定（${batches} 批 × ${perBatch} 场 = ${total} 场，` +
    `种子 ${START_SEED}..${START_SEED + total - 1}）===`
);
console.log("档位：standard + beatPrimitive（**真实事件流**，非探针侧反事实）");
console.log("口径：17 项属性球队 / 能力 15 / 4-3-3 / 双方同构 ⇒ 势均力敌中游队对话。");

const batchMeans = [];
const batchMaxes = [];
const batchDetails = [];
const perMatchBeats = [];
const perMatchSideMax = [];
const perMatchSelected = [];
const allTopShare = [];

for (let b = 0; b < batches; b++) {
  const rows = [];
  for (let i = 0; i < perBatch; i++) {
    const seed = START_SEED + b * perBatch + i;
    const r = runMatch(seed, true);
    rows.push(r);
    perMatchBeats.push(r.beats);
    perMatchSideMax.push(r.beatsSideMax);
    perMatchSelected.push(r.selected);
    allTopShare.push(r.topShare);
  }
  const m = mean(rows.map((r) => r.beats));
  const mx = mean(rows.map((r) => r.beatsSideMax));
  batchMeans.push(m);
  batchMaxes.push(mx);
  batchDetails.push({
    批: b + 1,
    种子: `${START_SEED + b * perBatch}..${START_SEED + b * perBatch + perBatch - 1}`,
    "beat/场(双方合计)": fx(m),
    "单队max/场": fx(mx),
    单场最少: Math.min(...rows.map((r) => r.beats)),
    单场最多: Math.max(...rows.map((r) => r.beats)),
  });
  process.stderr.write(`批 ${b + 1}/${batches}: beat/场 ${fx(m)}\n`);
}

const sdMatch = stdev(perMatchBeats);
const sdBatch = stdev(batchMeans);
const grandMean = mean(perMatchBeats);
const grandSideMax = mean(perMatchSideMax);

console.log("\n[1] 🔑 核心结论 —— 同一引擎同一档位，换一批种子读数会漂多少：");
console.log({
  "beat/场 总体均值(双方合计)": fx(grandMean),
  "单队 beat/场 均值": fx(grandSideMax),
  "beat/场 中位数": median(perMatchBeats),
  [`批内均值范围(每批 ${perBatch} 场)`]: `${fx(Math.min(...batchMeans))} ~ ${fx(Math.max(...batchMeans))}`,
  "批间标准差(SD_batch)": fx(sdBatch),
  "批间极差": fx(Math.max(...batchMeans) - Math.min(...batchMeans)),
  "逐场标准差(SD_match)": fx(sdMatch),
  "单场最少~最多": `${Math.min(...perMatchBeats)} ~ ${Math.max(...perMatchBeats)}`,
  "被选中/场(分母参考)": fx(mean(perMatchSelected)),
  "成功率(beat/被选中)": `${((grandMean / mean(perMatchSelected)) * 100).toFixed(2)}%`,
});

console.log("\n[2] 逐批明细（每批 = 一次「n 场测量」的读数）：");
for (const d of batchDetails) {
  console.log(
    `  批 ${String(d.批).padStart(2)} 种子 ${d.种子.padEnd(15)} ` +
      `beat/场 ${String(d["beat/场(双方合计)"]).padStart(7)}  单队max ${String(d["单队max/场"]).padStart(7)}  ` +
      `单场 ${d.单场最少} ~ ${d.单场最多}`
  );
}

console.log("\n[3] ⚖ 判决力 —— 要辨出多大的效应，每组需要多少场：");
console.log("   （2SE 判据，两独立样本一组，用逐场 SD；门槛 = 2×SD/√n 每组）");
for (const eff of [0.5, 1, 2, 3]) {
  // 两组各 n 场，差值 2SE = 2×√(2)×SD/√n ⇒ n = 2×(2×SD/eff)²
  const n = Math.ceil(2 * ((2 * sdMatch) / eff) ** 2);
  console.log(`    效应 ${String(eff).padStart(3)} beat/场 → 每组约 ${String(n).padStart(6)} 场`);
}
console.log(
  `   · 换言之：用 ${perBatch} 场一批做读数，批间 SD = ${fx(sdBatch)}，` +
    `那么"读数本身"的 ±2SE ≈ ±${fx(2 * sdBatch)} beat/场。`
);

console.log("\n[4] 建议护栏带宽（据此表得，不手调）：");
{
  const half = 2 * sdBatch;
  console.log({
    基线: fx(grandMean),
    "批间 1SE": fx(sdBatch),
    "读数 ±2SE": fx(half),
    "⇒ 建议下沿": fx(grandMean - Math.max(half, 1)),
    "⇒ 建议上沿": fx(grandMean + Math.max(half, 1)),
  });
  console.log(
    "   读法：护栏到基线的距离必须 ≥ 2SE，否则翻红说明不了任何问题；\n" +
      "   若半边 <1 beat/场，一律向上取 1（工程下限：至少留 1 次/场的余量）。"
  );
}

console.log("\n[5] 分布形状（用于确认是否长尾、要不要用中位数）：");
{
  const sorted = [...perMatchBeats].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  console.log({
    min: sorted[0],
    p25: q(0.25),
    中位数: median(perMatchBeats),
    p75: q(0.75),
    max: sorted[sorted.length - 1],
    均值: fx(grandMean),
  });
}
