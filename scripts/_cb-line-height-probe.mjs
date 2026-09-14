/**
 * 防线高度驱动的前压量 —— 真实战术下的强弱分离测量（只读探针，不进 verify 套件）。
 *
 * 背景：`CB_BLOCK_SHIFT_MAX_M` 原先对两队是同一个常数，中卫线前压会**同时**提高双方
 * 的进攻效率，于是摊薄强队优势（−14 → 1.92、−19 → 1.67、−26 → 1.46，门槛 1.5）。
 * 真实足球里这不是一个常数问题：**防线高度本来就是战术选择**——
 * `js/delegation.js:231-241` 已按实力差设定，强队（差 ≥1.5）取 ≥4，弱队取 ≤2。
 *
 * 因此前压量改为按该队 `defensiveLine` 缩放，以标准级 3 为基准（乘数恰为 1）。
 * 本探针回答一个 `match-realism-audit.mjs` **回答不了**的问题：
 * 那个审计把两队的 `defensiveLine` 都写死成 3，所以它对本次改动完全不敏感
 * （实测指标逐位不变）。要测真实对局效果，必须让两队带上各自的真实防线高度。
 *
 * 三个配置，强弱均为 ability 15 vs 11（差 4 级 → 强队防线 4、弱队防线 2）：
 *   A. uniform   两队防线都 3     —— 等价于审计口径，作为基准
 *   B. real,gain0 真实防线 + 缩放关闭 —— 真实战术下「旧行为」的样子
 *   C. real,gain  真实防线 + 缩放开启 —— 本次改动在真实战术下的样子
 *
 * B vs C 是**单一变量**对比（只有 `CB_BLOCK_SHIFT_LINE_GAIN` 不同），
 * 因此能干净地回答「按防线高度缩放是否把强弱优势还回来」。
 *
 * 用法：node scripts/_cb-line-height-probe.mjs [场数]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MATCHES = Math.max(8, Number(process.argv[2]) || 24);
const PROFILE = process.argv[3] === "background" ? "background" : "standard";
// ⚠ 必须按档位派生，与 match-realism-audit.mjs:9-10 一致。
// 写死成 0.1/8 会让 background 档实际跑标准档参数，两档数字会完全相同（踩过一次）。
const TIME_STEP = PROFILE === "background" ? 0.3 : SIM.DT;
const SEPARATION_PASSES = PROFILE === "background" ? 4 : 8;

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

/** 与 match-realism-audit.mjs 的 makeClub 同构，额外接受防线高度。 */
function makeClub(name, ability, defensiveLine) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const id = `${name}-p${index}`;
    return {
      id,
      name: id,
      pos,
      number: index + 1,
      fitness: 100,
      attrs: {
        pace: rating,
        shooting: rating,
        passing: rating,
        dribbling: rating,
        defending: rating,
        physical: rating,
        finishing: rating,
        tackling: rating,
        marking: rating,
        strength: rating,
        stamina: rating,
        vision: rating,
        reflexes: rating,
        handling: rating,
        positioning: rating,
        kicking: rating,
      },
    };
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
      defensiveLine,
      style: "balanced",
    },
  };
}

function runMatch(homeAbility, awayAbility, homeLine, awayLine, seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, homeAbility, homeLine),
      makeClub(`away-${seed}`, awayAbility, awayLine),
      { simulationProfile: PROFILE, timeStep: TIME_STEP, separationPasses: SEPARATION_PASSES }
    );
    const steps = Math.round((90 * 60) / TIME_STEP);
    for (let step = 0; step < steps; step++) engine.step(TIME_STEP);
    return engine;
  } finally {
    Math.random = originalRandom;
  }
}

/** 跑一组强弱对阵，返回强队的积分/进球/失球。 */
function runSeries(homeLine, awayLine, gain) {
  const previousGain = SIM.CB_BLOCK_SHIFT_LINE_GAIN;
  SIM.CB_BLOCK_SHIFT_LINE_GAIN = gain;
  let points = 0;
  let wins = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  try {
    for (let match = 0; match < MATCHES; match++) {
      const strongAtHome = match % 2 === 0;
      const engine = runMatch(
        strongAtHome ? 15 : 11,
        strongAtHome ? 11 : 15,
        strongAtHome ? homeLine : awayLine,
        strongAtHome ? awayLine : homeLine,
        265000 + match
      );
      const scored = strongAtHome ? engine.score.home : engine.score.away;
      const conceded = strongAtHome ? engine.score.away : engine.score.home;
      goalsFor += scored;
      goalsAgainst += conceded;
      if (scored > conceded) wins++;
      points += scored > conceded ? 3 : scored === conceded ? 1 : 0;
    }
  } finally {
    SIM.CB_BLOCK_SHIFT_LINE_GAIN = previousGain;
  }
  return {
    pointsPerMatch: Number((points / MATCHES).toFixed(2)),
    winRatePct: Number(((wins / MATCHES) * 100).toFixed(1)),
    goalsFor,
    goalsAgainst,
    goalDiff: goalsFor - goalsAgainst,
  };
}

const configs = [
  { key: "A 两队防线都 3（等价审计口径）", homeLine: 3, awayLine: 3, gain: 0.35 },
  { key: "B 真实防线 + 缩放关闭", homeLine: 4, awayLine: 2, gain: 0 },
  { key: "C 真实防线 + 缩放开启", homeLine: 4, awayLine: 2, gain: 0.35 },
];

console.log(`\n=== 防线高度驱动的前压量：真实战术下的强弱分离（${MATCHES} 场，${PROFILE} 档）===`);
console.log(`强弱 ability 15 vs 11（差 4 级）；强队防线 4、弱队防线 2 来自 delegation.js:236-240`);
console.log(`门槛：强队积分/场 >= 1.5，且净胜球 > 0\n`);
console.log("配置".padEnd(34) + "积分/场  胜率%   进球  失球  净胜");
console.log("-".repeat(70));

const results = {};
for (const config of configs) {
  const result = runSeries(config.homeLine, config.awayLine, config.gain);
  results[config.key] = result;
  const gate = result.pointsPerMatch >= 1.5 ? "✓" : "✗";
  console.log(
    config.key.padEnd(32) +
      String(result.pointsPerMatch).padStart(6) + gate +
      String(result.winRatePct).padStart(7) +
      String(result.goalsFor).padStart(6) +
      String(result.goalsAgainst).padStart(6) +
      String(result.goalDiff).padStart(6)
  );
}

const base = results["A 两队防线都 3（等价审计口径）"];
const off = results["B 真实防线 + 缩放关闭"];
const on = results["C 真实防线 + 缩放开启"];

console.log("\n--- 读法 ---");
console.log(
  `A 与 match-realism-audit.mjs 同口径（两队防线都 3），本次改动对它应为空操作。`
);
console.log(
  `B → C 是单一变量对比（只有 CB_BLOCK_SHIFT_LINE_GAIN 不同），差值即本次改动的净效果。`
);
console.log(
  `  B（缩放关闭）强队 ${off.pointsPerMatch} 分、净胜 ${off.goalDiff}`
);
console.log(
  `  C（缩放开启）强队 ${on.pointsPerMatch} 分、净胜 ${on.goalDiff}`
);
const delta = Number((on.pointsPerMatch - off.pointsPerMatch).toFixed(2));
const verdict =
  delta > 0 ? "缩放开启后强弱分离变好" : delta < 0 ? "缩放开启后强弱分离变差" : "两者相同";
console.log(`  → 积分差 ${delta >= 0 ? "+" : ""}${delta}，${verdict}`);
console.log(
  `\n参考：基准 A（两队防线都 3）强队 ${base.pointsPerMatch} 分、净胜 ${base.goalDiff}`
);
console.log(`     旧常数 −19 在审计口径下的实测值就是 1.67（已验证逐位一致）\n`);
