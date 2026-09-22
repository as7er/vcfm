/**
 * 点球命中率标定 —— 回归检查（2026-09-22，v286）。
 *
 * 背景（用户原话）：「之前发现点球的时候，进球率都比较低，这个是根据守门员的能力
 * 和罚点球球员的能力去设置概率的吗？」
 *
 * 查证结论（详见 docs/measurements/restart-placement-root-cause-2026-09-22.txt §5①）：
 *   · 命中率**只**由 `js/sim/engine.js` 的一条式子决定，判罚瞬间一次算完并冻结
 *     （`_tickPenalty` 只播动画、不再抽随机数）：
 *         penSkill = finishing*.38 + shooting*.24 + decisions*.22 + kicking*.10 + (isCore ? .015 : 0)
 *         save     = .55*reflexes + .28*handling            （无门将时 0.2）
 *         pScore   = clamp(BASE + (penSkill - 0.6) * SLOPE - save * GK_W, 0.55, 0.9)
 *     —— **读门将也读主罚者**，只抽一次随机数，**没有**射门方向↔扑救方向配对。
 *   · 旧 `BASE = 0.77` 让**真实俱乐部**（`createWorld` 全量世界）平均只有 **67.09%**，
 *     而现实足球约 75~80%；更直接的矛盾是**本仓库自己的点球 xG 硬编码就是 0.76**
 *     （`js/match.js:1200` / `js/match-analysis.js:40`）⇒ 引擎实际转化率与它自己声明的
 *     xG 差了 9 个百分点，战报数字与画面互相打架。
 *   · ⇒ v286 把 `BASE` 改成 **0.85**（**只动这一个常数**）：
 *     平均 ≈75%，而**斜率与门将权重一字未改** ⇒ 能力区分度一点不减；
 *     判罚侧一行没碰 ⇒ **点球频次不动**。
 *
 * 本检查守五条 —— ⚠ **它量的是行为，不是常数本身**：将来若再标定 BASE，
 * 只要下面这些性质仍成立，本检查就应继续通过（不该靠改这里的数字来「修」它）。
 *   ① **静态**：公式仍是那条单行式子；`SLOPE`/`GK_W` 与夹子**没被动过**
 *      （它们决定能力区分度，不是本次标定的对象）。
 *   ② **真实数据锚点**（最重要的一条，防「探针构造产物被当成产品结论」）：
 *      用 `createWorld` 的真实俱乐部实测平均命中率落在现实带内。
 *   ③ **实现与公式一致**：每个场景的实测值与该场景 agent 属性算出的 `pScore`
 *      在 3σ 内；主罚者↑ 单调↑、门将↑ 单调↓。
 *   ④ **区分度仍在**：主罚者 1→20 的极差 ≥ 15pp、门将 1→20 的极差 ≥ 8pp。
 *   ⑤ **随机流形状不变**：每次点球的 `random()` 抽取次数 ∈ {1,2}，
 *      且 `== 2` 当且仅当 outcome 是 `save`（多抽的那次是 `saveSide`，纯动画）。
 *      ⚠ 这条是「不要顺手在点球里多抽随机数」的护栏 —— 多抽会平移整场的随机流。
 *
 * 另含**变异测试**：把 BASE 换回旧值 0.77 ⇒ 真实锚点**必须报红**
 * （证明本护栏对「改回去」有判别力，不是装饰）。
 *
 * 用法：node scripts/penalty-conversion-verify.mjs   （约 10~20 秒）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession } from "../js/match.js";
import { createWorld } from "../js/models.js";
import { ensureSimEngine } from "../js/sim/adapt.js";
import { SIM, SimEngine } from "../js/sim/engine.js";
import { ensureWorldStaff } from "../js/staff.js";

// ————————————————————————————————————————————————————————————
// 现实带：真实足球点球命中率约 75~80%（顶级联赛/大赛大样本）。
// 下沿取 0.72 是给「世界差异 + 抽样噪声」留的余量，不是为了宽容差：
// **旧 BASE 0.77 的实测值 0.671 落在带外**，正是本护栏要抓住的回归。
// ————————————————————————————————————————————————————————————
const BAND_LOW = 0.72;
const BAND_HIGH = 0.79;
/** 每个场景的伯努利试验次数（3σ ≈ 3 * sqrt(p(1-p)/n)） */
const SYNTH_TRIALS = 4000;
const REAL_PER_FIXTURE = 1500;

let failed = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pct = (v) => `${(v * 100).toFixed(2)}%`;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 会数「抽了几次」的随机源（守第 ⑤ 条） */
function countingRng(rng) {
  const wrapped = (...args) => {
    wrapped.draws += 1;
    return rng(...args);
  };
  wrapped.draws = 0;
  wrapped.reset = () => {
    wrapped.draws = 0;
  };
  return wrapped;
}

// ————————————————————————————————————————————————————————————
// ① 静态：公式形状 + 区分度常数
// ————————————————————————————————————————————————————————————
const engineSrc = readFileSync(new URL("../js/sim/engine.js", import.meta.url), "utf8");
const formula = engineSrc.match(
  /const pScore = clamp\(([\d.]+) \+ \(penSkill - 0\.6\) \* ([\d.]+) - save \* ([\d.]+), ([\d.]+), ([\d.]+)\);/
);
check(!!formula, "点球结算公式仍是那条单行式子（能被本护栏解析）");
assert.ok(formula, "penalty formula must keep its documented single-line shape");
// ⚠ 解构**不能**多跳一位：`slice(1)` 的第一项就是 BASE（本脚本第一版在这里多跳了一格，
//   于是 BASE 被当成 SLOPE、夹子变成 undefined、期望值全成 NaN）。
const [BASE, SLOPE, GK_W, CLAMP_LO, CLAMP_HI] = formula.slice(1).map(Number);
check(SLOPE === 0.34, "斜率 SLOPE 未被改动（能力区分度）", `SLOPE=${SLOPE}`);
check(GK_W === 0.22, "门将权重 GK_W 未被改动（能力区分度）", `GK_W=${GK_W}`);
check(CLAMP_LO === 0.55 && CLAMP_HI === 0.9, "夹子未被改动", `clamp=[${CLAMP_LO}, ${CLAMP_HI}]`);

/** 与引擎同源的期望值（用它自己的 agent 属性） */
function expectedPScore(taker, gk, base = BASE) {
  const penSkill =
    (taker.attr.finishing || 0.55) * 0.38 +
    (taker.attr.shooting || 0.55) * 0.24 +
    (taker.attr.decisions || 0.55) * 0.22 +
    (taker.attr.kicking || 0.55) * 0.1 +
    (taker.isCore ? 0.015 : 0);
  const save = gk ? 0.55 * gk.attr.reflexes + 0.28 * gk.attr.handling : 0.2;
  return clamp(base + (penSkill - 0.6) * SLOPE - save * GK_W, CLAMP_LO, CLAMP_HI);
}

// ————————————————————————————————————————————————————————————
// 合成俱乐部（属性可调）：只用来量「响应方向与幅度」
// ————————————————————————————————————————————————————————————
const ATTR_KEYS = [
  "pace", "strength", "passing", "vision", "shooting", "finishing", "dribbling",
  "tackling", "marking", "stamina", "positioning", "reflexes", "handling", "kicking",
  "heading", "crossing", "decisions", "physical",
];

function makeClub(id, outfield, gkAttrs) {
  const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = positions.map((pos, i) => {
    const value = pos === "GK" ? gkAttrs : outfield;
    return {
      id: `${id}-${i}`,
      name: `${id}-${i}`,
      pos,
      number: i + 1,
      fitness: 100,
      attrs: Object.fromEntries(ATTR_KEYS.map((key) => [key, value])),
    };
  });
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

/**
 * 在一个引擎上跑 n 次点球，返回 { goal, save, miss, expected, draws }
 * ⚠ 不 `step()`：结算在 `_penaltyKick` 里一次算完（`_tickPenalty` 只播动画），
 *   所以直接读 `pendingPenalty.outcome` 就是引擎真会执行的那个结果。
 *   这也让本检查能跑上千次而不受引擎演出开销影响。
 */
function samplePenalties(eng, team, n) {
  const rng = eng.random;
  const out = { goal: 0, save: 0, miss: 0, expectedSum: 0, drawsBad: 0, drawPairs: [] };
  for (let i = 0; i < n; i += 1) {
    rng.reset();
    eng._penaltyKick(team);
    const pen = eng.pendingPenalty;
    const taker = eng.agentById(pen.takerId);
    const gk = pen.gkId ? eng.agentById(pen.gkId) : null;
    out[pen.outcome] += 1;
    out.expectedSum += expectedPScore(taker, gk);
    // ⑤ 随机流形状：goal/miss 应恰好 1 次，save 应恰好 2 次（多一次 saveSide）
    const expectedDraws = pen.outcome === "save" ? 2 : 1;
    if (rng.draws !== expectedDraws) out.drawsBad += 1;
    out.drawPairs.push([pen.outcome, rng.draws]);
  }
  out.rate = out.goal / n;
  out.expected = out.expectedSum / n;
  out.sigma = Math.sqrt((out.expected * (1 - out.expected)) / n);
  return out;
}

function makeEngine(seed, outfield, gkAttrs) {
  const rng = countingRng(mulberry32(seed));
  const eng = new SimEngine(makeClub("home", outfield, gkAttrs), makeClub("away", outfield, gkAttrs), {
    random: rng,
  });
  return { eng, rng };
}

console.log(`=== 点球命中率标定检查（BASE=${BASE}）===`);
console.log(`现实带 [${pct(BAND_LOW)}, ${pct(BAND_HIGH)}]｜合成场景 ${SYNTH_TRIALS} 次/格\n`);

// ————————————————————————————————————————————————————————————
// ③ + ④ 合成网格：实现是否与公式一致、响应方向、区分度
// ————————————————————————————————————————————————————————————
const GRID = [
  { taker: 1, gk: 10 },
  { taker: 10, gk: 12 },
  { taker: 12, gk: 12 },
  { taker: 20, gk: 12 },
  { taker: 12, gk: 1 },
  { taker: 12, gk: 20 },
];
console.log("网格（行=主罚者全属性 / 列=门将全属性，实测 vs 公式）：");
const measured = new Map();
const deviations = [];
const drawViolations = [];
for (const cell of GRID) {
  const { eng, rng } = makeEngine(770000 + cell.taker * 31 + cell.gk, cell.taker, cell.gk);
  const r = samplePenalties(eng, "home", SYNTH_TRIALS);
  measured.set(`${cell.taker}/${cell.gk}`, r);
  const dev = Math.abs(r.rate - r.expected) / r.sigma;
  deviations.push(dev);
  drawViolations.push(r.drawsBad);
  console.log(
    `  主罚者 ${String(cell.taker).padStart(2)} / 门将 ${String(cell.gk).padStart(2)}：` +
      `实测 ${pct(r.rate)}  公式 ${pct(r.expected)}  Δ=${dev.toFixed(2)}σ` +
      `（goal ${r.goal} / save ${r.save} / miss ${r.miss}）`
  );
  // 复用同一引擎再跑一遍同种子 ⇒ 必须逐位相同（可复现，AGENTS.md 的铁律）
  const again = samplePenalties(makeEngine(770000 + cell.taker * 31 + cell.gk, cell.taker, cell.gk).eng,
    "home", 200);
  const first200 = r.drawPairs.slice(0, 200).map((p) => p[0]).join(",");
  check(again.drawPairs.map((p) => p[0]).join(",") === first200, "同种子重跑逐位相同（可复现）",
    `主罚者 ${cell.taker} / 门将 ${cell.gk}`);
  void rng;
}

check(Math.max(...deviations) <= 3, "每个场景实测值都在公式的 3σ 内（实现 = 公式）",
  `最大偏离 ${Math.max(...deviations).toFixed(2)}σ`);
check(drawViolations.every((v) => v === 0), "每次点球的 random() 抽取次数符合契约（save=2，其余=1）",
  `违例 ${drawViolations.reduce((a, b) => a + b, 0)} 次`);

const t1 = measured.get("1/10").rate;
const t12 = measured.get("12/12").rate;
const t20 = measured.get("20/12").rate;
const gk1 = measured.get("12/1").rate;
const gk20 = measured.get("12/20").rate;
check(t1 < t12 && t12 < t20, "主罚者越强命中率越高（单调）",
  `${pct(t1)} < ${pct(t12)} < ${pct(t20)}`);
check(gk1 > gk20, "门将越强命中率越低（单调）", `${pct(gk1)} > ${pct(gk20)}`);
check(t20 - t1 >= 0.15, "主罚者 1→20 的区分度 ≥ 15pp（标定没有把能力抹平）",
  `${((t20 - t1) * 100).toFixed(1)}pp`);
check(gk1 - gk20 >= 0.08, "门将 1→20 的区分度 ≥ 8pp（标定没有把能力抹平）",
  `${((gk1 - gk20) * 100).toFixed(1)}pp`);

// ————————————————————————————————————————————————————————————
// ② 真实数据锚点（最重要）
// ————————————————————————————————————————————————————————————
console.log("\n真实俱乐部锚点（createWorld 全量世界，真入口 _penaltyKick）：");
// ⚠ `createWorld` 不接种子 ⇒ 必须换掉 `Math.random`，否则每轮是**不同的比赛**
//   （本仓库的普查探针踩过这个坑）。这里用固定 PRNG 并做双跑指纹自检。
const originalRandom = Math.random;
const WORLD_SEED = 0x5f3a71c9;

/**
 * 用**全新**的种子化 PRNG 跑一次 fn（世界生成是它唯一的消费方）。
 *
 * ⚠ 每次必须新建实例：本脚本第一版把 `mulberry32(...)` 提到函数外只建**一个**，
 *   于是第二次调用接着上一次的流往下走 ⇒ 两轮是**两个不同的世界**
 *   （复现自检报出 34 组指纹逐组不同）。这正是 `_restart-snap-census.mjs`
 *   踩过的同一个坑：`createWorld` 不接种子，不换 `Math.random` 就没有可复现性。
 */
function withSeededWorld(fn) {
  Math.random = mulberry32(WORLD_SEED);
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function realAnchor() {
  const startClub = CLUB_TEMPLATES.find((c) => c.division === 3);
  const source = createWorld(startClub.id, "Penalty Conversion Verify");
  ensureWorldStaff(source);
  const fixtures = source.fixtures.filter(
    (f) => f.home === source.userClubId || f.away === source.userClubId
  );
  let goal = 0;
  let n = 0;
  let expectedSum = 0;
  let drawsBad = 0;
  const fingerprint = [];
  for (const fx of fixtures) {
    const world = structuredClone(source);
    const state = createMatchSession(world, world.fixtures.find((f) => f.id === fx.id));
    const eng = ensureSimEngine(state);
    const rng = countingRng(mulberry32(0x1234 + n));
    eng.random = rng;
    const r = samplePenalties(eng, "home", REAL_PER_FIXTURE);
    goal += r.goal;
    n += REAL_PER_FIXTURE;
    expectedSum += r.expectedSum;
    drawsBad += r.drawsBad;
    fingerprint.push(`${fx.id}:${r.goal}`);
  }
  return { goal, n, mean: goal / n, expected: expectedSum / n, drawsBad, fingerprint: fingerprint.join("|") };
}

// ⚠ 这里**不能**断言「两轮指纹逐位相同」—— 实测做不到，而且与本次标定无关。
//
//   证据（2026-09-22，`.tmp-diag-session-determinism.mjs`）：把 `Math.random` 换成固定种子
//   PRNG 之后，同一进程连跑 4 轮「createWorld + createMatchSession + _penaltyKick」，
//   **每轮指纹都不同，每轮有 11~12/34 组对阵的点球主罚者不一样**（AI 队的阵型在
//   4-3-3 / 4-2-3-1 / 4-4-2 / 4-2-3-1 之间变）⇒ 首发跟着变。
//   成因线索：AI 队走 `aiTuneTactics`（`js/match.js:463`）→ `ensureCoachIdentity`
//   （`js/manager-ecosystem.js:134`），这条路上有**不受 `Math.random` 替换影响的熵**。
//   ⇒ 「世界 + 会话构造」不能靠种子化 `Math.random` 复现，这是**既有性质**
//     （改 BASE 之前之后完全一样）。
//   （`scripts/_restart-snap-census.mjs` 的双跑自检能过，是因为它的判据粗 ——
//     它量的是整队位移帧的时序，对「换了个点球主罚者」不敏感。凡是要做
//     「种子化 Math.random + 双跑比对」的探针都要注意这一点。）
//
//   ⇒ 所以复现性分两层来守：
//     ① **受控层**（引擎 + 随机源都在我们手里）—— 见上面合成网格的「同种子重跑逐位相同」；
//     ② **真实锚点**改用「两次独立构造必须落在同一条窄带内」：公式若被改坏（±8pp），
//        这一条会直接报红。
const real = withSeededWorld(realAnchor);
const realAgain = withSeededWorld(realAnchor);
const anchorDrift = Math.abs(real.mean - realAgain.mean);
check(anchorDrift <= 0.015, "真实锚点两次独立构造的平均命中率一致（Δ ≤ 1.5pp）",
  `Δ=${(anchorDrift * 100).toFixed(2)}pp（两轮 ${pct(real.mean)} / ${pct(realAgain.mean)}）`);
console.log(
  `  ${real.n} 次点球（${real.fingerprint.split("|").length} 组真实对阵 × ${REAL_PER_FIXTURE}）：` +
    `实测 ${pct(real.mean)}  公式 ${pct(real.expected)}  期望带 [${pct(BAND_LOW)}, ${pct(BAND_HIGH)}]`
);
const realSigma = Math.sqrt((real.expected * (1 - real.expected)) / real.n);
check(
  Math.abs(real.mean - real.expected) <= 3 * realSigma,
  "真实锚点：实测与公式在 3σ 内",
  `Δ=${((real.mean - real.expected) / realSigma).toFixed(2)}σ（n=${real.n}）`
);
check(
  real.mean >= BAND_LOW && real.mean <= BAND_HIGH,
  "真实锚点：平均命中率落在现实带内（75~80% 的现实基准）",
  `${pct(real.mean)}`
);
check(real.drawsBad === 0, "真实锚点：随机流形状同样符合契约", `违例 ${real.drawsBad} 次`);

// ————————————————————————————————————————————————————————————
// 变异测试：把 BASE 换回旧值 ⇒ 真实锚点必须掉出现实带
// ————————————————————————————————————————————————————————————
// 用同一批真实主罚者/门将属性算「旧 BASE」的反事实值（夹子照旧参与），
// 这样不必真的改产品代码就能证明本护栏对「改回去」有判别力。
console.log("\n变异测试（反事实：BASE 换回 0.77）：");
const startClub = CLUB_TEMPLATES.find((c) => c.division === 3);
const src = withSeededWorld(() => {
  const w = createWorld(startClub.id, "Penalty Conversion Verify (mutant)");
  ensureWorldStaff(w);
  return w;
});
let oldSum = 0;
let oldN = 0;
for (const fx of src.fixtures.filter((f) => f.home === src.userClubId || f.away === src.userClubId)) {
  const world = structuredClone(src);
  const state = createMatchSession(world, world.fixtures.find((f) => f.id === fx.id));
  const eng = ensureSimEngine(state);
  // 直接构造一次点球，取出引擎**真会选中**的主罚者与门将
  eng._penaltyKick("home");
  const pen = eng.pendingPenalty;
  const taker = eng.agentById(pen.takerId);
  const gk = pen.gkId ? eng.agentById(pen.gkId) : null;
  const rateOld = expectedPScore(taker, gk, 0.77);
  for (let i = 0; i < REAL_PER_FIXTURE; i += 1) oldSum += rateOld;
  oldN += REAL_PER_FIXTURE;
}
const oldMean = oldSum / oldN;
console.log(`  旧 BASE 0.77 的同批期望值：${pct(oldMean)}`);
check(oldMean < BAND_LOW, "把 BASE 改回 0.77 ⇒ 会掉出现实带（护栏有判别力）",
  `${pct(oldMean)} < ${pct(BAND_LOW)}`);

// ————————————————————————————————————————————————————————————
console.log(`\n${failed === 0 ? "penalty-conversion-verify: ok" : `penalty-conversion-verify: FAILED (${failed})`}`);
process.exitCode = failed === 0 ? 0 : 1;
void SIM;
