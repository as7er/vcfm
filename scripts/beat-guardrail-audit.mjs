/**
 * `beat` 原语护栏审计（设计稿 §5.5 表第 6 项 / 落地步骤 #6）。
 *
 * ## 这条护栏要防什么
 *
 * 主动突破原语打开后，`beat`（成功越过一名防守者）会成为一个**新的事件流**。
 * 没有护栏的话有两类风险：
 *   · **上沿**：「人人都是梅西」—— 突破次数爆表，一对一失去稀缺性；
 *   · **下沿**：指标整体消失 —— 原语被某次改动静默掐灭（回归）。
 *
 * ## 护栏值从哪来（不许拍脑袋）
 *
 * 来自 `scripts/_beat-noise-calibration-probe.mjs` 的**实测噪声标定**
 * （8 批 × 12 场 = 96 场，种子 372000..372095）。
 * 方法型与 boxSec 那次完全一致：**先测批间 SD，再按 2SE 门槛定带宽**。
 *
 * 归档读数：`docs/measurements/probe-beat-guardrail-noise-2026-09-19.txt`
 *
 * ⚠ **护栏到基线的距离必须 ≥ 2SE**，否则翻红说明不了任何问题
 * （红线落在噪声里 = 没有判决力，这是 boxSec 那次已经付过的学费）。
 * 若半边 < 1 beat/场，一律向上取 1 —— 工程下限：至少留 1 次/场的余量。
 *
 * ## 用法
 *
 *   node scripts/beat-guardrail-audit.mjs [场数]
 *     # 默认 24 场（与 `match-realism-audit.mjs 24` 同规模）
 *
 * ⚠ 本审计**只在开关打开时有意义**。原语默认关闭（`opts.beatPrimitive` 默认 `false`），
 *   此时 `beat`/场 恒为 0 ⇒ 会顶破下沿。所以本审计自己显式打开开关跑，
 *   并在输出里说明「这是开关打开时的读数」，不依赖调用方。
 */
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(6, Number(process.argv[2]) || 24);
const START_SEED = 372000; // 与噪声标定同窗，读数可直接对照
const simulationProfile = "standard";
const timeStep = SIM.DT;
const separationPasses = 8;

// —— 实测基线（来自 96 场噪声标定，种子 372000..372095，2026-09-19）——
//
// | 量 | 读数 |
// |---|---|
// | beat/场 基线（双方合计） | 3.927 |
// | 单队 beat/场 | 2.708 |
// | 逐场 SD (SD_match) | 2.129（单场 0~11，明显长尾） |
// | 批间 SD (SD_batch, 12 场/批) | 0.62（批内均值 3.083~4.833，极差 1.75） |
//
// 带宽推导：
//   读数 ±2SE（12 场批）= 2 × SD_batch = 1.239
//   半边 = max(1.239, 工程下限 1.0) = **1.25**（向上取到 0.05 的整数倍，便于人读）
//   ⇒ band = [3.927 − 1.25, 3.927 + 1.25] = **[2.68, 5.18]**
//
// 判决力自检：要辨出 1 beat/场 的效应，每组需
//   n = 2 × (2 × SD_match / 1)² = 2 × (2 × 2.129)² ≈ 37 场。
//   ⚠ **本审计默认只跑 24 场 ⇒ 低于 37** ⇒ 只能判「大幅消失」或「大幅爆表」，
//     判不了 1/场 级别的偏移。护栏因此设成 ±1.25（≈ ±2SE）而不是更窄：
//     更窄的红线在 24 场规模下会被普通噪声顶破，那不是判决，是掷硬币。
//     要辨出 0.5/场 需每组 ~146 场 —— **明确超出单次审计预算，本审计不承诺。**
const BEAT_GUARDRAIL = Object.freeze({
  baseline: 3.93,
  lower: 2.68,
  upper: 5.18,
  halfWidth: 1.25,
  sdBatch: 0.62,
  sdMatch: 2.13,
  batchSize: 12,
  calibrationMatches: 96,
  calibrationSeeds: "372000..372095",
  /** 分辨 1 beat/场 所需的每组场数（由 SD_match 推得，2SE 判据）。 */
  matchesFor1Beat: 37,
});

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
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

/** 跑一场，返回该场的 `beat` 数与单队最大值。口径与 `_beat-noise-calibration-probe.mjs` 逐字一致。 */
function runMatch(seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  const beatsByTeam = { home: 0, away: 0 };
  try {
    const home = makeClub(`home-${seed}`, 15);
    const away = makeClub(`away-${seed}`, 15);
    const engine = new SimEngine(home, away, {
      simulationProfile,
      timeStep,
      separationPasses,
      beatPrimitive: true, // 🔑 本审计的全部意义就是量开关打开时的读数
    });
    const teamOf = (agentId) => {
      if (!agentId) return null;
      if (String(agentId).startsWith(`home-${seed}-`)) return "home";
      if (String(agentId).startsWith(`away-${seed}-`)) return "away";
      return null;
    };
    const steps = Math.round((90 * 60) / timeStep);
    for (let step = 0; step < steps; step++) {
      engine.step(timeStep);
      const events = engine.events || [];
      for (const ev of events) {
        if (ev.type !== "beat") continue;
        const team = teamOf(ev.agentId);
        if (team) beatsByTeam[team] += 1;
      }
      if (events.length) events.length = 0;
    }
    return {
      seed,
      beats: beatsByTeam.home + beatsByTeam.away,
      sideMax: Math.max(beatsByTeam.home, beatsByTeam.away),
    };
  } finally {
    Math.random = originalRandom;
  }
}

const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const stdev = (v) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
const fx = (v) => Number(v.toFixed(3));

const rows = [];
for (let i = 0; i < matches; i++) {
  rows.push(runMatch(START_SEED + i));
  if ((i + 1) % 6 === 0) process.stderr.write(`  ${i + 1}/${matches} 场\n`);
}

const perMatch = rows.map((r) => r.beats);
const perMatchSideMax = rows.map((r) => r.sideMax);
const observed = mean(perMatch);
const observedSide = mean(perMatchSideMax);
const sdObserved = stdev(perMatch);
const seObserved = sdObserved / Math.sqrt(matches);

const report = {
  matches,
  seeds: `${START_SEED}..${START_SEED + matches - 1}`,
  beatPerMatch: fx(observed),
  beatPerMatchSideMax: fx(observedSide),
  sdMatch: fx(sdObserved),
  se: fx(seObserved),
  range: [Math.min(...perMatch), Math.max(...perMatch)],
  guardrail: {
    baseline: BEAT_GUARDRAIL.baseline,
    band: [BEAT_GUARDRAIL.lower, BEAT_GUARDRAIL.upper],
    halfWidth: BEAT_GUARDRAIL.halfWidth,
    "derived from": `${BEAT_GUARDRAIL.calibrationMatches} 场噪声标定（种子 ${BEAT_GUARDRAIL.calibrationSeeds}），` +
      `SD_batch(12 场/批)=${BEAT_GUARDRAIL.sdBatch} ⇒ 2SE=${BEAT_GUARDRAIL.halfWidth}`,
  },
  deltaVsBaseline: fx(observed - BEAT_GUARDRAIL.baseline),
  withinBand: observed >= BEAT_GUARDRAIL.lower && observed <= BEAT_GUARDRAIL.upper,
  resolution: {
    "matches this run": matches,
    "matches needed to resolve 1 beat/match": BEAT_GUARDRAIL.matchesFor1Beat,
    note:
      matches >= BEAT_GUARDRAIL.matchesFor1Beat
        ? "this run can resolve a 1 beat/match shift"
        : "this run CANNOT resolve a 1 beat/match shift; it can only catch a large disappearance or blow-out",
  },
};
console.log(JSON.stringify(report, null, 2));

assert.ok(
  observed >= BEAT_GUARDRAIL.lower,
  `beat/match fell below the guard rail: ${fx(observed)} < ${BEAT_GUARDRAIL.lower}. ` +
    `The primitive is not firing as often as it did when the rail was calibrated ` +
    `(${BEAT_GUARDRAIL.baseline} ± ${BEAT_GUARDRAIL.halfWidth} at ${BEAT_GUARDRAIL.batchSize}-match reads). ` +
    `Either the primitive was silently disabled, or its intent gate was tightened.`
);
assert.ok(
  observed <= BEAT_GUARDRAIL.upper,
  `beat/match broke the guard rail: ${fx(observed)} > ${BEAT_GUARDRAIL.upper}. ` +
    `One-on-one beats are no longer scarce. Check whether the intent gate was loosened ` +
    `or the duel success probability inflated.`
);

console.log(
  `beat guardrail audit passed: ${fx(observed)} beats/match over ${matches} matches ` +
    `(band [${BEAT_GUARDRAIL.lower}, ${BEAT_GUARDRAIL.upper}], baseline ${BEAT_GUARDRAIL.baseline}, ` +
    `half-width from 2SE at ${BEAT_GUARDRAIL.batchSize}-match reads)`
);
