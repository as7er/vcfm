/**
 * 无球跑位目标：四层串行管线的**逐层位移归因**探针（只读）。
 *
 * 为什么要有这个探针
 * ------------------
 * 项目里「球员跑位看起来不合理」类报告反复出现，而**每个机制单独读都是对的**：
 *   - `_applyAttackTactics`  队形宽度 / 控球拉拽 / 纵深位移 / 显式锚点
 *   - `_commitOffBallTarget` 租约（防折返）/ 防拥挤 / 越位线投影
 *   - `_separateSupportTargets` 全体定稿后的横向松弛（Gauss-Seidel）
 *   - `_clampOffside`        纵深投影到越位线
 * 缺陷（若存在）藏在**层与层之间**：每层只保证自己的局部约束，
 * 没有任何一处检查「四层过完后落点是否还合理」。读源码发现不了这种问题，
 * 只能量出来。
 *
 * 本探针量什么
 * ------------
 * 对每一次「无球目标重算」，记录四个层的**进出坐标**，于是得到：
 *   [1] 各层位移的分布（中位 / p90 / 最大），单位「场坐标格」
 *   [2] 净位移 = 最终落点相对初始意图的偏移；以及**方向翻转**的次数
 *     （层与层互相抵消的强证据：位移量大但净位移接近 0）
 *   [3] `_commitOffBallTarget` 的租约命中率（decision === "held"）——
 *     租约是唯一会**主动否决**上层新意图的机制
 *   [4] `_separateSupportTargets` 的分组规模与「横向被推开」的幅度
 *   [5] 层间冲突计数：某层把落点往一个方向推、下一层又推回来的次数
 *     （用位移向量的点积 < 0 判定）
 *
 * 纪律
 * ----
 * - **纯只读**：包装方法后在进出各读一次实例字段，不改任何值、不消费随机数。
 * - 不写引擎、不发事件、不进 verify（这是**诊断**探针，不是护栏审计）。
 * - 输出 100% 为读数与分布，**不含任何"应该改成什么"的建议** ——
 *   是否值得动管线，由读数决定，不由本探针决定。
 *
 * 用法
 * ----
 *   node scripts/_offball-layered-attribution-probe.mjs [场数=6] [起始种子=381000]
 */

import { SimEngine, SIM } from "../js/sim/engine.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 6);
const START_SEED = Math.max(1, Number(process.argv[3]) || 381000);

const SIM_SECONDS = SIM.MATCH_SECONDS ?? 5400;
const DT = SIM.DT ?? 0.1;

/** 场坐标单位 → 米（各向异性：横向 68/100、纵向 105/100）。 */
const MX = (SIM.PITCH_W_METRES ?? 68) / (SIM.FIELD_W ?? 100);
const MY = (SIM.PITCH_H_METRES ?? 105) / (SIM.FIELD_H ?? 100);

function metres(dx, dy) {
  return Math.hypot(dx * MX, dy * MY);
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

// ————————————————————————————————————————————————
// 逐层位移归因：包装四个方法，只在进出读一次坐标
// ————————————————————————————————————————————————

/** 单次重算的完整记录。 */
const RECORDS = [];

/** 当前正在跟踪的球员（一次 `_commitOffBallTarget` = 一次重算）。 */
let TRACK = null;

/** 层 3 的逐次调用统计。 */
const SEPARATE = { calls: 0, buckets: 0, pairsMoved: 0, maxShoveM: 0, shoveSamples: [] };

/** 每个球员最近一次提交的记录（层3 在提交之后跑，回来补记横向推动量）。 */
const byPlayerLastRecord = new Map();

function snapshot(a) {
  return { x: a.tx, y: a.ty };
}

function layeredDelta(before, after) {
  return metres(after.x - before.x, after.y - before.y);
}

const ORIG = {
  think: SimEngine.prototype._thinkAttackOffBall,
  tactics: SimEngine.prototype._applyAttackTactics,
  commit: SimEngine.prototype._commitOffBallTarget,
  separate: SimEngine.prototype._separateSupportTargets,
};

// ⚠ 归因链的锚点必须建在这里：`_thinkAttackOffBall`（生成初始意图）之后、
// `_applyAttackTactics`（层1）之前。若建在 `_commitOffBallTarget` 里就太晚了 ——
// 那时层1 已经跑完，`probeTactics` 会被跳过（TRACK 仍为 null）⇒ 层1 恒读 0。
SimEngine.prototype._thinkAttackOffBall = function probeThink(a, phaseActor) {
  const result = ORIG.think.call(this, a, phaseActor);
  TRACK = {
    agent: a,
    start: snapshot(a),
    layer1: null,
    layer1M: 0,
    layer2M: 0,
    held: false,
    end: null,
    netM: 0,
    phase: null,
    fsm: null,
  };
  return result;
};

SimEngine.prototype._applyAttackTactics = function probeTactics(a, phaseActor) {
  const before = TRACK && TRACK.agent === a ? snapshot(a) : null;
  const result = ORIG.tactics.call(this, a, phaseActor);
  if (before) {
    TRACK.layer1 = { from: before, to: snapshot(a) };
    TRACK.layer1M = layeredDelta(before, snapshot(a));
  }
  return result;
};

SimEngine.prototype._commitOffBallTarget = function probeCommit(a, phaseActor) {
  if (!TRACK || TRACK.agent !== a) {
    // 异常路径（未经过 `_thinkAttackOffBall` 就被提交）：兜底建点，标记出来。
    TRACK = {
      agent: a,
      start: snapshot(a),
      layer1: { from: snapshot(a), to: snapshot(a) },
      layer1M: 0,
      layer2M: 0,
      held: false,
      end: null,
      netM: 0,
      phase: null,
      fsm: null,
      noThink: true,
    };
  }
  // 🔑 租约诊断：提交**前**捕获旧目标与其时间戳。
  // `holdPrevious` 会把旧点原样返回，所以旧点的「年龄」决定了这次"位移"有多大。
  const prev = a.offBallTarget;
  TRACK.prevAgeSec = prev && Number.isFinite(prev.setAt) ? this.t - prev.setAt : null;
  TRACK.prev = prev ? { x: prev.x, y: prev.y } : null;
  TRACK.newCandidate = snapshot(a);
  const result = ORIG.commit.call(this, a, phaseActor);
  if (TRACK.layer1) TRACK.layer2M = layeredDelta(TRACK.layer1.to, snapshot(a));
  TRACK.held = a.offBallTarget?.decision === "held";
  TRACK.decision = a.offBallTarget?.decision ?? null;
  TRACK.end = snapshot(a);
  TRACK.netM = layeredDelta(TRACK.start, TRACK.end);
  // held 时的"位移"实际是「新候选」与「被保留的旧点」之间的距离 ——
  // 它衡量的是租约把球员**按住**的幅度，不是球员真的走了这么远。
  TRACK.holdGapM = TRACK.held && TRACK.newCandidate && TRACK.end
    ? metres(TRACK.end.x - TRACK.newCandidate.x, TRACK.end.y - TRACK.newCandidate.y)
    : 0;
  TRACK.phase = a.offBallTarget?.phase ?? null;
  TRACK.fsm = a.offBallTarget?.fsm ?? null;
  TRACK.layer3M = 0;
  RECORDS.push(TRACK);
  byPlayerLastRecord.set(a.id, TRACK);
  TRACK = null;
  return result;
};

SimEngine.prototype._separateSupportTargets = function probeSeparate() {
  // 记录调用前后每个 support 球员的 tx，量出「层 3 横向把谁推开了多少」。
  const beforeMap = new Map();
  for (const a of this.agents) {
    if (a.sentOff || a.fsm !== "support" || !a.offBallTarget) continue;
    beforeMap.set(a.id, a.tx);
  }
  const result = ORIG.separate.call(this);
  SEPARATE.calls += 1;
  let moved = 0;
  for (const a of this.agents) {
    if (!beforeMap.has(a.id)) continue;
    const dx = Math.abs(a.tx - beforeMap.get(a.id));
    if (dx * MX > 0.05) {
      moved += 1;
      const m = dx * MX;
      SEPARATE.shoveSamples.push(m);
      if (m > SEPARATE.maxShoveM) SEPARATE.maxShoveM = m;
      // 层3 发生在「层1+层2 定稿」之后，所以补偿要记到对应记录上。
      const rec = byPlayerLastRecord.get(a.id);
      if (rec) rec.layer3M = (rec.layer3M || 0) + m;
    }
  }
  if (moved) SEPARATE.buckets += 1;
  SEPARATE.pairsMoved += moved;
  return result;
};


// ————————————————————————————————————————————————
// 跑比赛
// ————————————————————————————————————————————————

function runMatch(seed) {
  const home = makeClub(`home-${seed}`, 15);
  const away = makeClub(`away-${seed}`, 15);
  // ⚠ 构造签名是 (home, away, opts)，与 `_beat-noise-calibration-probe.mjs` 一致。
  // 这里**不传任何可选开关** —— 测的就是默认档。
  const engine = new SimEngine(home, away, { seed });
  engine._probeSeed = seed;
  // 只跑一半时长即可拿到足够样本，且不同种子仍互不重叠
  const steps = Math.floor(SIM_SECONDS / DT / 2);
  for (let i = 0; i < steps; i++) {
    engine.step(DT);
    // 抽走事件限内存（`engine.events` 不是每步清空的）
    if (engine.events && engine.events.length > 512) engine.events.length = 0;
  }
  return { seed, steps };
}

const started = Date.now();
const perMatch = [];
for (let i = 0; i < MATCHES; i++) {
  const seed = START_SEED + i;
  const before = RECORDS.length;
  const info = runMatch(seed);
  perMatch.push({ seed, recomputes: RECORDS.length - before, steps: info.steps });
}

// ————————————————————————————————————————————————
// 统计
// ————————————————————————————————————————————————

function quantile(values, q) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clampInt(Math.round((sorted.length - 1) * q), 0, sorted.length - 1);
  return sorted[idx];
}

function clampInt(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function summarise(values) {
  if (!values.length) return { n: 0, median: NaN, p90: NaN, max: NaN, mean: NaN };
  let sum = 0;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v > max) max = v;
  }
  return {
    n: values.length,
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    max,
    mean: sum / values.length,
  };
}

const L1 = RECORDS.map((r) => r.layer1M).filter((v) => Number.isFinite(v));
const L2 = RECORDS.map((r) => r.layer2M).filter((v) => Number.isFinite(v));
const L3 = RECORDS.map((r) => r.layer3M || 0).filter((v) => v > 0);
const NET = RECORDS.map((r) => r.netM).filter((v) => Number.isFinite(v));
const heldCount = RECORDS.filter((r) => r.held).length;
const noThinkCount = RECORDS.filter((r) => r.noThink).length;

// 层间抵消：层1 与 层2 的位移向量点积 < 0，且两者都超过 0.3m
let cancelCount = 0;
let cancelNetSmall = 0;
for (const r of RECORDS) {
  if (!r.layer1 || !Number.isFinite(r.layer1M) || !Number.isFinite(r.layer2M)) continue;
  const d1 = {
    x: (r.layer1.to.x - r.layer1.from.x) * MX,
    y: (r.layer1.to.y - r.layer1.from.y) * MY,
  };
  // 层2 的位移 = 最终 − 层1 结束
  const d2 = {
    x: (r.end.x - r.layer1.to.x) * MX,
    y: (r.end.y - r.layer1.to.y) * MY,
  };
  const n1 = Math.hypot(d1.x, d1.y);
  const n2 = Math.hypot(d2.x, d2.y);
  if (n1 < 0.3 || n2 < 0.3) continue;
  const dot = d1.x * d2.x + d1.y * d2.y;
  if (dot < 0) {
    cancelCount += 1;
    if (r.netM < Math.max(n1, n2) * 0.35) cancelNetSmall += 1;
  }
}

const fsmCounts = new Map();
for (const r of RECORDS) {
  const key = r.fsm || "(null)";
  fsmCounts.set(key, (fsmCounts.get(key) || 0) + 1);
}

// —— 大位移样本的构成（排查 max 67m 这类异常值到底是谁）——
const BIG = 8; // 米
const bigMoves = RECORDS
  .filter((r) => Number.isFinite(r.netM) && r.netM >= BIG)
  .map((r) => ({
    netM: Number(r.netM.toFixed(2)),
    layer1M: Number((r.layer1M || 0).toFixed(2)),
    layer2M: Number((r.layer2M || 0).toFixed(2)),
    fsm: r.fsm,
    phase: r.phase,
    held: r.held,
    from: { x: Number(r.start.x.toFixed(1)), y: Number(r.start.y.toFixed(1)) },
    to: { x: Number(r.end.x.toFixed(1)), y: Number(r.end.y.toFixed(1)) },
  }))
  .sort((a, b) => b.netM - a.netM);

const bigShare = RECORDS.length ? bigMoves.length / RECORDS.length : 0;

// —— 🔑 租约年龄诊断：held 的样本里，被保留的旧点有多旧？——
const heldRecords = RECORDS.filter((r) => r.held);
const heldAges = heldRecords.map((r) => r.prevAgeSec).filter((v) => Number.isFinite(v));
const heldGaps = heldRecords.map((r) => r.holdGapM).filter((v) => Number.isFinite(v));
const leaseAge = summarise(heldAges);
const leaseHoldGap = summarise(heldGaps);

// held 的样本中，被按住的幅度 >= 8m 的有多少（= 本文档关注的"大位移"）
const heldBigGap = heldGaps.filter((v) => v >= BIG).length;

// 对照：非 held 样本的净位移分布（真实"目标更新"的幅度）
const nonHeldNet = RECORDS.filter((r) => !r.held).map((r) => r.netM);
const nonHeldNetSum = summarise(nonHeldNet);
//
// 判据：纵向位移 > 30m **且** 横向位移 < 5m。真实跑位不会这样 ——
// 球员横穿半场时横向也会动，只有坐标被整体镜像才会出现"纵向大跳、横向几乎不动"。
const SIDE_SWITCH = { bigY: 30, smallX: 5 };
const sideSwitchLike = bigMoves.filter((m) => {
  const dy = Math.abs(m.to.y - m.from.y) * MY;
  const dx = Math.abs(m.to.x - m.from.x) * MX;
  return dy >= SIDE_SWITCH.bigY && dx <= SIDE_SWITCH.smallX;
});
const sideSwitchAndHeld = sideSwitchLike.filter((m) => m.held);

// 按「是否换了半场」给大位移分类（from/to 的 y 是否落在不同半场）
const halfOf = (y) => (y >= 50 ? "top" : "bottom");
const crossedHalf = bigMoves.filter((m) => halfOf(m.from.y) !== halfOf(m.to.y));

// —— 位移量级分桶（看分布是不是"绝大多数不动 + 极少数大跳"）——
const buckets = [
  { label: "<0.05m (未动)", lo: 0, hi: 0.05 },
  { label: "0.05~0.5m", lo: 0.05, hi: 0.5 },
  { label: "0.5~2m", lo: 0.5, hi: 2 },
  { label: "2~8m", lo: 2, hi: 8 },
  { label: ">=8m", lo: 8, hi: Infinity },
];
const histogram = buckets.map((b) => ({
  label: b.label,
  count: NET.filter((v) => v >= b.lo && v < b.hi).length,
}));

const phases = new Set(RECORDS.map((r) => r.phase).filter(Boolean));

const out = {
  config: {
    matches: MATCHES,
    seeds: `${START_SEED}..${START_SEED + MATCHES - 1}`,
    tickSeconds: DT,
    matchSecondsSimulated: (SIM_SECONDS / 2).toFixed(0),
  },
  perMatch,
  totals: {
    recomputes: RECORDS.length,
    recomputesPerMatch: RECORDS.length / MATCHES,
    heldByLease: heldCount,
    heldShare: RECORDS.length ? heldCount / RECORDS.length : 0,
    commitsWithoutThink: noThinkCount,
  },
  layer1_tactics_metres: summarise(L1),
  layer2_commit_metres: summarise(L2),
  layer3_lateral_metres: summarise(L3),
  net_metres: summarise(NET),
  layer_cancellation: {
    pairsWhereLayer2OpposesLayer1: cancelCount,
    ofThoseNetUnder35pct: cancelNetSmall,
    share: RECORDS.length ? cancelCount / RECORDS.length : 0,
  },
  layer3_separate: {
    calls: SEPARATE.calls,
    callsThatMovedAnyone: SEPARATE.buckets,
    totalPlayerPushes: SEPARATE.pairsMoved,
    maxShoveMetres: SEPARATE.maxShoveM,
    shoveMetres: summarise(SEPARATE.shoveSamples),
  },
  fsmDistribution: Object.fromEntries([...fsmCounts.entries()].sort((a, b) => b[1] - a[1])),
  netHistogram: histogram,
  leaseDiagnosis: {
    heldCount: heldRecords.length,
    heldShare: RECORDS.length ? heldRecords.length / RECORDS.length : 0,
    heldPreviousAgeSec: leaseAge,
    heldHoldGapMetres: leaseHoldGap,
    heldHeldGapOver8m: heldBigGap,
    nonHeldNetMetres: nonHeldNetSum,
  },
  sideSwitchDiagnosis: {
    bigMoveThresholdMetres: BIG,
    bigMoves: bigMoves.length,
    /** 纵向 >=30m 且横向 <=5m：坐标镜像的典型指纹 */
    longitudinalFlipLike: sideSwitchLike.length,
    longitudinalFlipAndHeldByLease: sideSwitchAndHeld.length,
    /** from/to 落在不同半场 */
    crossedHalfwayLine: crossedHalf.length,
  },
  bigMoves: { thresholdMetres: BIG, count: bigMoves.length, share: bigShare, top: bigMoves.slice(0, 12) },
  phasesSeen: [...phases],
};

console.log(JSON.stringify(out, null, 2));

console.log("\n【逐层位移归因 · 单位米】");
console.log(`  层1 战术(宽度/拉拽/纵深/锚点)  中位 ${out.layer1_tactics_metres.median.toFixed(2)}  p90 ${out.layer1_tactics_metres.p90.toFixed(2)}  max ${out.layer1_tactics_metres.max.toFixed(2)}`);
console.log(`  层2 提交(租约/防拥挤/越位投影) 中位 ${out.layer2_commit_metres.median.toFixed(2)}  p90 ${out.layer2_commit_metres.p90.toFixed(2)}  max ${out.layer2_commit_metres.max.toFixed(2)}`);
console.log(`  层3 横向松弛(仅被推开者)       中位 ${out.layer3_lateral_metres.median.toFixed(2)}  p90 ${out.layer3_lateral_metres.p90.toFixed(2)}  max ${out.layer3_lateral_metres.max.toFixed(2)}`);
console.log(`  三层合计净位移(层1起→层2终)    中位 ${out.net_metres.median.toFixed(2)}  p90 ${out.net_metres.p90.toFixed(2)}  max ${out.net_metres.max.toFixed(2)}`);
console.log(`  未经 _thinkAttackOffBall 的提交: ${noThinkCount}`);

console.log("\n【层间抵消（层2 把层1 推回去）】");
console.log(`  方向相反的样本 ${cancelCount} / ${RECORDS.length}`);
console.log(`  其中净位移 < 较大分量的 35%：${cancelNetSmall}  ← 数值上是"来回抵消"`);

console.log("\n【层3 横向松弛（全体定稿后）】");
console.log(`  调用 ${SEPARATE.calls} 次，其中 ${SEPARATE.buckets} 次真的推开了人`);
console.log(`  累计被推动的球员·次 ${SEPARATE.pairsMoved}，单次最大横移 ${SEPARATE.maxShoveM.toFixed(2)} m`);

console.log("\n【租约否决】");
console.log(`  目标被租约保留(decision=held) 的比例 ${(out.totals.heldShare * 100).toFixed(1)}%  (${heldCount}/${RECORDS.length})`);

console.log("\n【fsm 分布】");
for (const [k, v] of Object.entries(out.fsmDistribution)) {
  console.log(`  ${k}: ${v}`);
}

console.log("\n【净位移量级分桶】");
for (const b of out.netHistogram) {
  const pct = RECORDS.length ? (b.count / RECORDS.length) * 100 : 0;
  console.log(`  ${b.label.padEnd(16)} ${String(b.count).padStart(7)}  ${pct.toFixed(2)}%`);
}

console.log(`\n【大位移样本（>= ${BIG}m）】 共 ${bigMoves.length} 例（${(bigShare * 100).toFixed(3)}%），最大的 12 个：`);
for (const m of bigMoves.slice(0, 12)) {
  console.log(`  ${String(m.netM).padStart(6)}m  fsm=${String(m.fsm).padEnd(8)} 层1=${String(m.layer1M).padStart(5)}m 层2=${String(m.layer2M).padStart(5)}m  ${JSON.stringify(m.from)}→${JSON.stringify(m.to)}  held=${m.held}`);
}

console.log("\n【🔑 租约否决诊断 —— 这才是大位移的真正来源】");
console.log(`  held 样本 ${heldRecords.length} 个（占 ${((out.totals.heldShare || 0) * 100).toFixed(2)}%）`);
console.log(`  被保留的旧点年龄(秒)  中位 ${leaseAge.median.toFixed(2)}  p90 ${leaseAge.p90.toFixed(2)}  max ${leaseAge.max.toFixed(2)}`);
console.log(`  租约把球员按住的距离(米) 中位 ${leaseHoldGap.median.toFixed(2)}  p90 ${leaseHoldGap.p90.toFixed(2)}  max ${leaseHoldGap.max.toFixed(2)}`);
console.log(`  其中按住幅度 >= ${BIG}m 的: ${heldBigGap}  ← 这些就是分桶里的"大位移"`);
console.log(`  对照：非 held 样本的净位移 中位 ${nonHeldNetSum.median.toFixed(2)}  p90 ${nonHeldNetSum.p90.toFixed(2)}  max ${nonHeldNetSum.max.toFixed(2)}`);

console.log("\n【🔑 换边特征诊断（坐标镜像的指纹）】");
console.log(`  纵向 >=${SIDE_SWITCH.bigY}m 且 横向 <=${SIDE_SWITCH.smallX}m 的样本: ${sideSwitchLike.length}`);
console.log(`  其中同时 held=true（租约说"保留旧目标"却跳了半场）: ${sideSwitchAndHeld.length}`);
console.log(`  from/to 跨过中线的样本: ${crossedHalf.length}`);
console.log("  ⇒ 若此数接近大位移总数，则这些不是跑位，是坐标被整体翻转而未重置租约。");

console.log(`\n耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
