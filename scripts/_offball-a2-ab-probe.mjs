/**
 * A2 对照探针：**同一份引擎代码**下，`SIM.A2_ANCHOR_BLEND` 的 1.0 vs 0.65 对照。
 *
 * ## 为什么这样写
 *
 * A2（`_chooseAttackOffBallTarget` 的 `drop` 分支纵向锚改成「球位与阵型位加权」）
 * 是**标准档行为改动**：它改位置 ⇒ 下游决策路径随之改变。所以不能只看「翻转数」，
 * 必须同时量**比赛结构有没有被改坏**（进球/射门/传球）。
 *
 * 由于改动点由常量 `SIM.A2_ANCHOR_BLEND` 控制（1.0 = 原行为、0.65 = A2），
 * 本探针就能在**同一份代码**上跑两档 ⇒ 差异 100% 来自这一个旋钮，
 * 不掺「引擎文件版本不同」的干扰。这比 `git stash` 前后跑更干净。
 *
 * ⚠ 早先尝试过「包装 `_thinkAttackOffBall` 后按出口 `ty` 反推球位锚」的离线做法，
 *   **已放弃并删除**：该函数**每个分支内部都自己调了 `_clampOffside`**，
 *   出口的 `ty` 已被夹取，反推不出原始球位锚（实测覆写量算出 31 万格/场的荒谬值）。
 *   ⇒ 教训：**别从函数出口反推中间量**，中间量要在它产生的地方取。
 *
 * ## 口径
 *
 * 种子 381000..、能力 15、标准档、0.1s 步长、2700 模拟秒（与既有探针同）。
 * 「目标跳变」= 球位移 <2m 而该球员目标点位移 >=1m（诊断文档同式）。
 *
 * ⚠ **为什么本探针可以用 2700s**：跳变量是「同口径前后配对」的指标，
 *   时长只影响量的多少，不影响相对变化（大跳 -16.8% 与时长无关）。
 *   本探针**不**把 beat 与既有 band 直接比对 —— 那个必须 5400s，
 *   见 `beat-guardrail-audit.mjs` 与本文件 [4] 段的告示。
 *
 * ## 用法
 *
 *   node scripts/_offball-a2-ab-probe.mjs [场数=6] [起始种子=381000]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 6);
const START_SEED = Math.max(1, Number(process.argv[3]) || 381000);
const DT = SIM.DT ?? 0.1;
const SECONDS = 2700;

const MX = (SIM.PITCH_W_METRES ?? 68) / (SIM.FIELD_W ?? 100);
const MY = (SIM.PITCH_H_METRES ?? 105) / (SIM.FIELD_H ?? 100);
const metres = (dx, dy) => Math.hypot(dx * MX, dy * MY);

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

/**
 * 跑一场并量取读数。
 * @param {number} seed
 * @param {number} blend 写入 SIM.A2_ANCHOR_BLEND（1.0 = 原行为，0.65 = A2）
 */
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

    const jumps = [];
    const prevTarget = new Map();
    const tally = { goals: 0, shots: 0, passes: 0, offside: 0 };
    const steps = Math.round(SECONDS / DT);

    for (let step = 0; step < steps; step++) {
      engine.step(DT);
      const events = engine.events || [];
      for (const ev of events) {
        if (ev.type === "goal") tally.goals += 1;
        else if (ev.type === "shot") tally.shots += 1;
        else if (ev.type === "pass") tally.passes += 1;
        else if (ev.type === "offside") tally.offside += 1;
      }
      if (events.length) events.length = 0;

      const b = engine.ball;
      for (const a of engine.agents) {
        if (a.sentOff || a.role === "GK") continue;
        if (!b || b.owner === a.id) continue;
        const tgt = a.offBallTarget;
        if (!tgt) continue;
        const p = prevTarget.get(a.id);
        if (p) {
          const ballMove = metres(b.x - p.ballX, b.y - p.ballY);
          const jump = metres(tgt.x - p.x, tgt.y - p.y);
          if (ballMove < 2 && jump >= 1) {
            jumps.push({ m: jump, fromY: p.y, toY: tgt.y, role: a.role });
          }
        }
        prevTarget.set(a.id, { x: tgt.x, y: tgt.y, ballX: b.x, ballY: b.y });
      }
    }
    return { seed, jumps, tally };
  } finally {
    SIM.A2_ANCHOR_BLEND = prev;
  }
}

const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const fx = (v) => Number(v.toFixed(3));
const cnt = (arr, lo) => arr.filter((m) => m >= lo).length;

console.log(
  `\n=== A2 同代码 A/B（${MATCHES} 场，种子 ${START_SEED}..${START_SEED + MATCHES - 1}）===\n` +
    `档位：standard / 能力 15 / 0.1s / ${SECONDS}s\n` +
    `对照：SIM.A2_ANCHOR_BLEND = 1.00（原行为）vs 0.65（A2）\n`
);

const rows = [];
for (let i = 0; i < MATCHES; i++) {
  const seed = START_SEED + i;
  const base = runMatch(seed, 1.0);
  const a2 = runMatch(seed, 0.65);
  rows.push({ seed, base, a2 });
  process.stderr.write(
    `场 ${i + 1}/${MATCHES} seed=${seed}: 基线跳变 ${base.jumps.length} / A2 ${a2.jumps.length}\n`
  );
}

const flat = (k) => rows.map((r) => r[k].jumps).flat();
const bJ = flat("base").map((j) => j.m);
const aJ = flat("a2").map((j) => j.m);

console.log("[1] 🔑 大跳 —— 瞬移的直接来源");
console.log({
  "基线 跳变总数": bJ.length,
  "A2 跳变总数": aJ.length,
  "总跳变变化": `${((aJ.length / (bJ.length || 1) - 1) * 100).toFixed(1)}%`,
  "基线 >=15m": cnt(bJ, 15),
  "A2 >=15m": cnt(aJ, 15),
  "大跳削减": `${(100 - (cnt(aJ, 15) / (cnt(bJ, 15) || 1)) * 100).toFixed(1)}%`,
  "基线 >=30m": cnt(bJ, 30),
  "A2 >=30m": cnt(aJ, 30),
  "巨跳削减": `${(100 - (cnt(aJ, 30) / (cnt(bJ, 30) || 1)) * 100).toFixed(1)}%`,
});

console.log("\n[2] 跳变幅度分布（米）");
for (const [label, arr] of [["基线", bJ], ["A2", aJ]]) {
  console.log({
    档: label,
    中位: fx(pct(arr, 0.5)),
    p90: fx(pct(arr, 0.9)),
    p99: fx(pct(arr, 0.99)),
    // ⚠ 不要写 `Math.max(0, ...arr)`：本探针的跳变数组是 **10 万级**长度，
    //   展开运算符会把每个元素当实参压栈 ⇒ `RangeError: Maximum call stack size exceeded`。
    //   （2026-09-20 实测：17.6 万个元素必崩。）循环求最大值，O(n) 且无栈风险。
    最大: fx(arr.reduce((m, v) => (v > m ? v : m), 0)),
    均值: fx(mean(arr)),
  });
}

console.log("\n[3] 幅度分档计数");
for (const [label, lo, hi] of [
  ["1~2m", 1, 2],
  ["2~5m", 2, 5],
  ["5~15m", 5, 15],
  ["15~30m", 15, 30],
  [">=30m", 30, Infinity],
]) {
  const c = bJ.filter((m) => m >= lo && m < hi).length;
  const a = aJ.filter((m) => m >= lo && m < hi).length;
  console.log(
    `    ${label.padEnd(8)} 基线 ${String(c).padStart(6)}   A2 ${String(a).padStart(6)}  ` +
      `(${c ? ((a / c - 1) * 100).toFixed(1) : "—"}%)`
  );
}

/**
 * 配对差 ± 2SE 判决：同种子前后成对相减，区间不含 0 才算这一项真被 A2 改了。
 * 配对（而非两组独立均值）是关键 —— 同种子消掉了「这场本来就难打」的公共波动。
 */
function paired(sel) {
  const D = rows.map((r) => sel(r.base) - sel(r.a2));
  const n = D.length;
  const mD = mean(D);
  const sdD = n > 1
    ? Math.sqrt(D.reduce((s, x) => s + (x - mD) ** 2, 0) / (n - 1))
    : 0;
  const se = sdD / Math.sqrt(n);
  const half = 2 * se;
  const t = se > 0 ? mD / se : 0;
  const mB = mean(rows.map((r) => sel(r.base)));
  return {
    基线: fx(mB),
    A2: fx(mean(rows.map((r) => sel(r.a2)))),
    配对差: fx(mD),
    "±2SE": fx(half),
    t: Number(t.toFixed(2)),
    判决: half === 0 ? "⚠空数据" : Math.abs(t) >= 2 ? "✅显著" : "⚠不显著",
    相对: mB ? `${((mD / mB) * 100).toFixed(1)}%` : "—",
  };
}

console.log("\n[4] 比赛结构（A2 不该把比赛改坏）");
console.log("  配对判决（同种子前后比；±2SE 不含 0 才算真变了）");
console.log("  进球/场  ", paired((t) => t.tally.goals));
console.log("  射门/场  ", paired((t) => t.tally.shots));
console.log("  越位/场  ", paired((t) => t.tally.offside));
console.log("  传球/场  ", paired((t) => t.tally.passes));

console.log("\n[5] 🔑 大跳削减的判决力（配对 —— 决定 [1] 的百分比能不能信）");
console.log("  大跳 >=15m", paired((r) => cnt(r.jumps.map((j) => j.m), 15)));
console.log("  巨跳 >=30m", paired((r) => cnt(r.jumps.map((j) => j.m), 30)));
console.log("  跳变总数  ", paired((r) => r.jumps.length));
console.log("  幅度均值  ", paired((r) => mean(r.jumps.map((j) => j.m))));

console.log("\n[6] ⚠ 判读");
console.log(
  [
    "· 目标：大跳显著下降，且 [4] 各项量级不变（A2 不该把比赛改坏）。",
    "· 若 [5] 的大跳/巨跳「判决」为 ✅显著 且 [4] 稳定 ⇒ A2 值得保留，继续跑全量 verify + 护栏。",
    "· 若 [5] 不显著 ⇒ 翻转主要不来自 drop 锚点，A2 解决不了用户看到的问题，应考虑别的候选。",
    "",
    "· 判决力：跳变侧是万级样本，[1]/[5] 的百分比可信（看 t 是否 >=2）。",
    "· ⚠ 进球是低计数高方差事件（SD_match ~1.58）。要判「0.5 球/场」的差异，",
    "     n = 2×(2×SD_match/效应)² ≈ 80 场/组。本探针默认场数远不够 ⇒",
    "     [4] 的进球行只作**量级对照**，t 不显著**不等于**没影响。",
    "     要下「A2 没改坏进球」的结论，须另跑 80 场配对的结构复核。",
    "",
    "· 🔴 时长口径：本探针跑 2700s ⇒ [4] 的 beat 读数**不能**与 beat 护栏",
    "     band [2.68, 5.18]（5400s 口径）直接比对。要判 beat 必须用",
    "     `beat-guardrail-audit.mjs`（它自带 5400s 口径）。",
  ].join("\n")
);
