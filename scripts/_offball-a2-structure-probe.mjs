/**
 * A2 结构复核：**同代码配对**下，`SIM.A2_ANCHOR_BLEND` = 1.0（原行为）vs 0.65（A2）
 * 对**比赛结构**的影响 —— 进球 / 射门 / 越位 / 传球。
 *
 * ## 为什么需要它（与 `_offball-a2-ab-probe.mjs` 的分工）
 *
 * `_offball-a2-ab-probe.mjs` 量的是**跳变侧**（目标点跳变），那是万级样本，
 * 几场就有判决力。但它也顺带报进球 —— 而**进球是低计数高方差事件**：
 *
 *   SD_match ≈ 1.583 球/场（96 场噪声标定，见
 *   docs/measurements/probe-goals-noise-calibration-2026-09-20.txt）
 *
 * 要判「0.5 球/场」的差异，需要 n = 2×(2×SD_match/效应)² ≈ **80 场/组**。
 * 6 场/12 场下的进球读数只是**量级对照**，t 不显著**不等于**没影响。
 *
 * ⇒ 本探针就是那个「够量的结构复核」。默认 80 场/组 = 160 场配对。
 *
 * ## 为什么用配对而不是两组独立均值
 *
 * 同种子跑两档，逐场相减。这样「这场本来就难打」的公共波动被消掉，
 * 判决力大幅提升 —— 80 场配对等效于远多于 80 场独立对照。
 *
 * ## 用法
 *
 *   node scripts/_offball-a2-structure-probe.mjs [场数=80] [起始种子=382000]
 *
 * ⚠ 时长口径：本探针跑 **2700 模拟秒**。这对本探针是**正确的** ——
 *   它只做「同口径前后配对」（基线 vs A2 都在 2700s 下跑），
 *   不与任何外部标定的 band 直接比对。
 *   若要把这里的数字跟 5400s 口径的 beat 护栏 band [2.68, 5.18] 比，
 *   **那是错的** —— 请改用 `beat-guardrail-audit.mjs`。
 *
 * ⚠ 命名注意：本文件里的 **A2 = 无球跑位锚点混合**（`A2_ANCHOR_BLEND`）。
 *   与表现层的 A1/A2（`_presentation-a1a2a3-visual-verify.mjs` 里的画幅/镜头）
 *   **是两回事**，只是编号撞车。
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 80);
const START_SEED = Math.max(1, Number(process.argv[3]) || 382000);
const DT = SIM.DT ?? 0.1;
const SECONDS = 2700;

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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runMatch(seed, blend) {
  const prev = SIM.A2_ANCHOR_BLEND;
  SIM.A2_ANCHOR_BLEND = blend;
  try {
    const engine = new SimEngine(makeClub(`home-${seed}`, 15), makeClub(`away-${seed}`, 15), {
      random: mulberry32(seed),
      timeStep: DT,
      separationPasses: 8,
      simulationProfile: "standard",
    });
    const tally = { goals: 0, shots: 0, offside: 0, passes: 0 };
    const steps = Math.round(SECONDS / DT);
    for (let step = 0; step < steps; step++) {
      engine.step(DT);
      const events = engine.events || [];
      for (const ev of events) {
        if (ev.type === "goal") tally.goals += 1;
        else if (ev.type === "shot") tally.shots += 1;
        else if (ev.type === "offside") tally.offside += 1;
        else if (ev.type === "pass") tally.passes += 1;
      }
      if (events.length) events.length = 0;
    }
    return tally;
  } finally {
    SIM.A2_ANCHOR_BLEND = prev;
  }
}

const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const fx = (v) => Number(v.toFixed(3));

console.log(
  `\n=== A2 结构复核（${MATCHES} 场配对 = ${MATCHES * 2} 场，` +
    `种子 ${START_SEED}..${START_SEED + MATCHES - 1}）===\n` +
    `档位：standard / 能力 15 / 0.1s / ${SECONDS}s\n` +
    `对照：SIM.A2_ANCHOR_BLEND = 1.00（原行为）vs 0.65（A2）\n` +
    `判决力前提：SD_match(进球) ≈ 1.583 ⇒ 判 0.5 球/场需 ~80 场/组\n`
);

const base = [];
const a2 = [];
for (let i = 0; i < MATCHES; i++) {
  const seed = START_SEED + i;
  base.push(runMatch(seed, 1.0));
  a2.push(runMatch(seed, 0.65));
  if ((i + 1) % 10 === 0) {
    process.stderr.write(`  ... 已完成 ${i + 1}/${MATCHES} 场配对\n`);
  }
}

/** 配对差 ± 2SE：区间不含 0 才算这一项真被 A2 改了。 */
function paired(key) {
  const B = base.map((r) => r[key]);
  const A = a2.map((r) => r[key]);
  const D = B.map((x, i) => x - A[i]);
  const n = D.length;
  const mD = mean(D);
  const sdD = n > 1
    ? Math.sqrt(D.reduce((s, x) => s + (x - mD) ** 2, 0) / (n - 1))
    : 0;
  const se = sdD / Math.sqrt(n);
  const half = 2 * se;
  const t = se > 0 ? mD / se : 0;
  const mB = mean(B);
  return {
    基线: fx(mB),
    A2: fx(mean(A)),
    配对差: fx(mD),
    "±2SE": fx(half),
    t: Number(t.toFixed(2)),
    判决: half === 0 ? "⚠空数据" : Math.abs(t) >= 2 ? "✅显著" : "⚠不显著",
    相对: mB ? `${((mD / mB) * 100).toFixed(1)}%` : "—",
  };
}

console.log("[1] 结构指标（配对判决；±2SE 不含 0 才算真变了）");
console.log("  进球/场  ", paired("goals"));
console.log("  射门/场  ", paired("shots"));
console.log("  越位/场  ", paired("offside"));
console.log("  传球/场  ", paired("passes"));

console.log("\n[2] 进球逐场配对差（基线 − A2；正数 = A2 少进球）");
console.log("  " + base.map((r, i) => r.goals - a2[i].goals).join(" "));

console.log("\n[3] ⚠ 判读");
console.log(
  [
    `· 本探针回答的是「A2 有没有改坏比赛结构」，而不是「A2 有没有削掉大跳」`,
    `  （后者看 _offball-a2-ab-probe.mjs）。`,
    `· 判定标准：进球/射门/越位三项**配对差远小于 2SE** 且 t < 2 ⇒ 没改坏；`,
    `  若某项 ✅显著，须能解释其方向（如传球 +4% 来自球员站位更贴阵型位）。`,
    `· ⚠ 越位差为 0.000 是**预期**：A2 只改 drop 分支的纵向锚，`,
    `  _clampOffside 仍在每个分支内照旧执行，越位几何未被触碰。`,
    `· 单场进球 SD ≈ 1.58 属已知噪声底。若配对数 < 80，本探针不足以判 0.5 球/场。`,
  ].join("\n")
);
