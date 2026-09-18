/**
 * 直塞护栏标定 —— 直接回答一个二选一：
 *   **(甲) 给直塞设一条可靠护栏**（它有稳定的种群均值，只是需要合适的带宽）
 *   **(乙) 承认直塞这个指标本身不可用作判据**（种子间噪声 > 任何要检出的效应）
 *
 * 背景（为什么需要这个探针）：
 *   · `match-realism-audit.mjs:463` 的直塞护栏是 `>= 0.5 && <= 12` —— 上下沿差 **24 倍**。
 *     这不是护栏，是「只要别完全消失」。真正需要它来判决时（见下），它给不出任何判决。
 *   · 2026-09-18 的 `runMargin` 48 场 A/B 用直塞做了判据，读数 2.02 → 1.88，
 *     判「反向 ❌」；但同一批归档里同一档位在 6 场是 **2.67**（相对 control 2.17 是**上升**）。
 *     同一档位在 6 场 / 48 场方向相反 ⇒ 判据不成立，**必须先量化种子间噪声**。
 *
 * 方法：**同一引擎、同一档位、同能力，跑 B 批互不重叠的种子窗口**，每批 n 场。
 *   · 批内均值 = 一次「n 场测量」的读数（就是 A/B 实验实际拿到的东西）
 *   · 批间标准差 = **换一批种子，读数会漂多少**（就是缺的那个 SE）
 *   · 再用 (批间标准差 / sqrt(n)) 得到「n 场读数的标准误」，据此算最小可检出差异。
 *
 * 顺带测：直塞的**种子间分布形态**（是否零膨胀 —— 很多场 0 次、少数场很多次）。
 *   若均值 ≈ 2 而中位 1、最大 7，则该指标方差主要由少数场驱动，均值不稳。
 *
 * **纯测量，不改引擎。** 只读 `engine.events`，不插桩、不消费随机数。
 * 与 `match-realism-audit` / `_final-third-movement-calibration-probe` 同口径：
 * `ev.through && !ev.cross`，双方合计每场。
 *
 * 用法：
 *   node scripts/_through-pass-noise-calibration-probe.mjs [批次场数] [批数]
 *   默认 12 场 × 20 批 = 240 场（种子 372000 起，与既有档位实验同一起点）
 *   可选第三参数 "control" / "commit" —— 第二档是否挂跑动原语，用于看噪声是否随档位变化
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

/** 与 `_final-third-movement-calibration-probe.mjs` 的 club() 一致（18 属性，含 crossing）。 */
function club(name, ability) {
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

const perBatch = Math.max(2, Number(process.argv[2]) || 12);
const batches = Math.max(2, Number(process.argv[3]) || 20);
const useCommit = (process.argv[4] || "control") === "commit";
const START_SEED = 372000;

const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
/** 样本标准差（n-1）；n<2 时返回 0。 */
const stdev = (values) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
};
const quantile = (values, q) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  return Number(s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2));
};
const fx = (v) => Number(v.toFixed(2));

/**
 * 跑一场，返回该场的逐项读数。commit=true 时挂与校准探针 runC1.0 同语义的跑动原语。
 * 原语实现逐字取自 `_final-third-movement-calibration-probe.mjs`（runC1.0 = runLead 1.0，
 * 无 margin），此处只保留让读数可比所需的最小部分。
 */
function runMatch(seed, commit) {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(club(`home-${seed}`, 15), club(`away-${seed}`, 15), {
      simulationProfile: "standard",
      timeStep: SIM.DT,
      separationPasses: 8,
    });

    if (commit) {
      const V = { runLead: 1.0 };
      const held = new Map();
      const origThink = engine._thinkAttackOffBall.bind(engine);
      engine._thinkAttackOffBall = function (a, owner) {
        origThink(a, owner);
        const dir = this.attackDir(a.team);
        const goalY = this.targetGoalY(a.team);
        const ownGoalY = goalY > 50 ? 0 : 100;
        const prog = Math.abs(this.ball.y - ownGoalY) / 100;
        if (prog <= 0.64) return;
        const t = Number.isFinite(this.t) ? this.t : 0;
        const h = held.get(a.id);
        if (h && t < h.arriveBy && h.dir === dir) {
          a.tx = h.tx;
          a.ty = h.ty;
          return;
        }
        held.delete(a.id);
        const isRunner = a.role === "ATT" || this._isPrimaryMidRunner(a);
        if (!isRunner) return;
        const speed = Number(a.speedMax) || 7.0;
        const d = Math.hypot((a.tx - a.x) * 1.05, (a.ty - a.y) * 1.05);
        const arriveBy = t + (d / speed) * V.runLead + 0.05;
        held.set(a.id, { tx: a.tx, ty: a.ty, arriveBy, dir });
      };
    }

    const steps = Math.round((90 * 60) / SIM.DT);
    const reading = { through: 0, crosses: 0, passes: 0, goals: 0, shots: 0, offsides: 0 };
    let cursor = 0;
    for (let step = 0; step < steps; step++) {
      engine.step(SIM.DT);
      for (; cursor < engine.events.length; cursor++) {
        const ev = engine.events[cursor];
        if (ev.type === "pass") {
          reading.passes++;
          if (ev.through && !ev.cross) reading.through++;
          if (ev.cross) reading.crosses++;
        } else if (ev.type === "shot") reading.shots++;
        else if (ev.type === "goal") reading.goals++;
        else if (ev.type === "offside") reading.offsides++;
      }
    }
    return reading;
  } finally {
    Math.random = original;
  }
}

console.log(
  `\n=== 直塞护栏标定：种子间噪声（${batches} 批 × ${perBatch} 场 = ${batches * perBatch} 场，` +
    `种子 ${START_SEED}..${START_SEED + batches * perBatch - 1}）===`
);
console.log(`档位：${useCommit ? "runC1.0（挂跑动原语）" : "control（引擎原样）"}`);

// —— 逐场读数 + 逐批均值 ——
const perMatch = [];
const batchMeans = [];
const batchDetails = [];
let seed = START_SEED;
for (let b = 0; b < batches; b++) {
  const rows = [];
  for (let i = 0; i < perBatch; i++) {
    const r = runMatch(seed++, useCommit);
    rows.push(r);
    perMatch.push(r);
  }
  const m = mean(rows.map((r) => r.through));
  batchMeans.push(m);
  batchDetails.push({
    批: b + 1,
    种子: `${START_SEED + b * perBatch}..${seed - 1}`,
    直塞均值: fx(m),
    直塞中位: median(rows.map((r) => r.through)),
    零场数: rows.filter((r) => r.through === 0).length,
    最大: Math.max(...rows.map((r) => r.through)),
  });
  process.stderr.write(`批 ${b + 1}/${batches}: 均值 ${fx(m)}\n`);
}

const throughValues = perMatch.map((r) => r.through);
const sdBatch = stdev(batchMeans);
const grandMean = mean(throughValues);

console.log("\n[1] 🔑 核心结论 —— 同一引擎、同一档位，换一批种子读数会漂多少：");
console.log({
  "总体均值(所有场)": fx(grandMean),
  "批内均值范围": `${fx(Math.min(...batchMeans))} ~ ${fx(Math.max(...batchMeans))}`,
  [`批间标准差(每批 ${perBatch} 场)`]: fx(sdBatch),
  "批间极差": fx(Math.max(...batchMeans) - Math.min(...batchMeans)),
  [`${perBatch} 场读数的标准误`]: fx(sdBatch),
  [`48 场读数的标准误(外推)`]: fx(stdev(throughValues) / Math.sqrt(48)),
  "逐场标准差": fx(stdev(throughValues)),
});

console.log("\n[2] 逐场直塞分布形态 —— 是否零膨胀（少数场驱动均值）：");
console.log({
  场数: perMatch.length,
  均值: fx(grandMean),
  中位: median(throughValues),
  p25: quantile(throughValues, 0.25),
  p75: quantile(throughValues, 0.75),
  p90: quantile(throughValues, 0.9),
  最大: Math.max(...throughValues),
  "0 次的场数": `${throughValues.filter((v) => v === 0).length} (${fx(
    (throughValues.filter((v) => v === 0).length / perMatch.length) * 100
  )}%)`,
  "≥5 次的场数": `${throughValues.filter((v) => v >= 5).length} (${fx(
    (throughValues.filter((v) => v >= 5).length / perMatch.length) * 100
  )}%)`,
});

console.log("\n[3] 逐批明细（每批就是一次「n 场测量」的读数）：");
for (const d of batchDetails) {
  console.log(
    `  批 ${String(d.批).padStart(2)} 种子 ${d.种子.padEnd(17)} ` +
      `均值 ${String(d.直塞均值).padStart(5)}  中位 ${String(d.直塞中位).padStart(4)}  ` +
      `零场 ${d.零场数}/${perBatch}  最大 ${d.最大}`
  );
}

console.log("\n[4] 判据含义 —— 用这些噪声数怎么读 A/B 结果：");
{
  // 两独立同分布样本（各 n 场）之差的 SE = sqrt(2) * sd(单组 n 场均值)
  const seBatch = sdBatch;                       // 每批 perBatch 场，就是一次「n 场测量」
  const seDiff = Math.sqrt(2) * seBatch;
  const sdMatch = stdev(throughValues);          // 逐场标准差
  console.log({
    [`n=${perBatch} 时，单组读数的标准误`]: fx(seBatch),
    "⇒ 两组差值需超过(约 2SE)才可判有差": fx(seDiff * 2),
    "逐场标准差": fx(sdMatch),
  });
  console.log("  各效应量所需的每组场数（2SE 判据，两独立样本）：");
  for (const eff of [0.10, 0.14, 0.30, 0.50, 1.00]) {
    const n = Math.ceil(2 * ((2 * sdMatch) / eff) ** 2);
    console.log(`    效应 ${eff.toFixed(2)}/场 → 每组约 ${String(n).padStart(5)} 场`);
  }
  console.log(
    `  参照本仓归档：48 场 A/B 直塞 2.02 → 1.88（差 0.14）；` +
      `6 场同档位 2.17 → 2.67（差 0.50，方向相反）。`
  );
}

console.log("\n[5] 伴随量（供交叉检查，均按双方合计每场）：");
console.log({
  传球: fx(mean(perMatch.map((r) => r.passes))),
  传中: fx(mean(perMatch.map((r) => r.crosses))),
  射门: fx(mean(perMatch.map((r) => r.shots))),
  进球: fx(mean(perMatch.map((r) => r.goals))),
  越位: fx(mean(perMatch.map((r) => r.offsides)) / 2),
});

// —— 判决：这个指标能不能用作细粒度 A/B 判据 ——
{
  const sdMatch = stdev(throughValues);
  const typicalEffect = 0.30; // 一个「值得关心」的档位效应，按 0.3/场设定
  const nNeeded = Math.ceil(2 * ((2 * sdMatch) / typicalEffect) ** 2);
  console.log("\n[6] ⚖ 裁决 —— 直塞作为「↑/↓」判据是否可用：");
  console.log({
    [`要检出 ${typicalEffect.toFixed(2)}/场 的效应，每组需要`]: `${nNeeded} 场`,
    "本仓实际 A/B 规模": `48 场（2SE = ${fx(Math.sqrt(2) * (sdMatch / Math.sqrt(48)) * 2)}）`,
    结论:
      nNeeded > 200
        ? "⛔ 不可用作细粒度 A/B 判据 —— 所需样本量远超实际实验规模"
        : "✅ 在 48 场规模下可用",
  });
  if (nNeeded > 200) {
    console.log(
      `   ⇒ 直塞只能用于**大样本方向性参考**（≥200 场/组），` +
        `不能进「近 48 场就判 ↑/↓」的验收表。\n` +
        `   ⇒ 现状那条 \`>= 0.5 && <= 12\` 的"护栏"应改述为**爆炸半径限制**（防指标整体消失），` +
        `而不是"落在标定区间中央"。`
    );
  }
}

if (sdBatch > 0.6) {
  console.log(
    `\n⛔ 警示：批间标准差 ${fx(sdBatch)} 已接近均值 ${fx(grandMean)} 的三分之一量级 ——` +
      `\n   该指标主要由少数高直塞场驱动，**不宜作为细粒度 A/B 判据**。`
  );
}
