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

/**
 * 🔑 每个球员上一次提交时的**真实位置**与当时的旧目标点。
 *
 * 用来算「球员是在接近旧目标，还是在被它甩开」——
 * 这需要跨重算间隔的信息，而模块本身不存球员历史位置，
 * 所以探针在旁路记一份（**只读**，不回写模块）。
 */
const playerHistory = new Map();
/** 每个球员上一轮产出点的锚点类型（"ball" | "base"） */
const prevAnchorByPlayer = new Map();

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
  // 🔑 上游产出：先记**进这次思考之前**的目标与球位，再跑 `_chooseAttackOffBallTarget`。
  // 若某次「球没动、产出目标却跳到球场另一端」，错在这里，不在租约。
  const upstreamBefore = snapshot(a);
  const ballBefore = this.ball ? { x: this.ball.x, y: this.ball.y } : null;
  const result = ORIG.think.call(this, a, phaseActor);
  const upstreamAfter = snapshot(a);
  // 🔑 复刻 `_chooseAttackOffBallTarget` 的两个关键中间量（只读，不消费随机数）
  const _b = this.ball;
  const _ownGoalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
  const _prog = _b ? Math.max(0, Math.min(1, Math.abs(_b.y - _ownGoalY) / 100)) : null;
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
    // —— 上游目标生成（`_chooseAttackOffBallTarget` + `_applyPassSupport`）——
    // upstreamJumpM = 上游自己把目标挪了多远（层1 之前）
    // ballHeldM     = 该球员上一轮提交时的球位，到这一次的球位，球自己动了多远
    upstreamJumpM: metres(upstreamAfter.x - upstreamBefore.x, upstreamAfter.y - upstreamBefore.y),
    upstreamFromPrevM: null, // 待与 prev 比（在 probeCommit 里补）
    upstreamToBallM: ballBefore
      ? metres(upstreamAfter.x - ballBefore.x, upstreamAfter.y - ballBefore.y) : null,
    upstreamBallMoveM: null, // 与上一轮球位比（在 probeCommit 里补）
    upstreamFsm: a.fsm ?? null,
    upstreamKind: a.offBallTargetKind ?? null,
    // 🔑 锚点诊断：上游产出点相对**固定阵型基准**的偏移。
    // 若产出点≈基准位，则它本来就该离球很远（后卫不跟球），不是缺陷；
    // 若产出点**远离**基准位又**远离**球，则是公式算歪了。
    upstreamBaseX: a.baseX ?? null,
    upstreamBaseY: a.baseY ?? null,
    upstreamRole: a.role ?? null,
    upstreamDir: this.attackDir(a.team),
    upstreamProg: _prog,
    upstreamTeam: a.team ?? null,
    // 🔑🔑 分支指纹：`_chooseAttackOffBallTarget` 里 ATT/MID 的 `drop` 分支
    // 纵向锚是**球位**（`b.y + dir*dropDepth`），`else` 分支锚是**阵型位**（`baseY`）。
    // 两者相距可达 70+ m，且由 `this.random() < p` 决定走哪条 ⇒ 每秒重掷一次骰子。
    // 这里用产出点与「球位」vs「阵型位」的接近程度反推走了哪条分支（只读）。
    upstreamNearBallY: (() => {
      if (!_b || !Number.isFinite(a.baseY)) return null;
      const dBallY = Math.abs(upstreamAfter.y - _b.y);
      const dBaseY = Math.abs(upstreamAfter.y - a.baseY);
      return dBallY < dBaseY ? "ball" : "base";
    })(),
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
  // 🔑 上游诊断：把「上游产出的点」与「旧点」比，并量球在这两个时刻之间自己走了多远。
  // 判据：球几乎没动（<2m）而上游产出点离旧点 >=15m  ⇒ 上游产出荒谬目标。
  if (prev) {
    TRACK.upstreamFromPrevM = metres(TRACK.newCandidate.x - prev.x, TRACK.newCandidate.y - prev.y);
    const prevBall = prev.ball;
    const bNow = this.ball;
    if (prevBall && Number.isFinite(prevBall.x) && Number.isFinite(prevBall.y) && bNow) {
      TRACK.upstreamBallMoveM = metres(bNow.x - prevBall.x, bNow.y - prevBall.y);
    }
  }
  // 🔑 `sameContext` 的两个判据在提交前后的取值（用于验证它是否漏判了球权易手）
  TRACK.prevOwnerId = prev?.ownerId ?? null;
  TRACK.prevPhase = prev?.phase ?? null;
  const rawOwner = this.ball?.owner || this.ball?.receiverId || null;
  TRACK.ownerIdAtCommit = rawOwner;
  TRACK.ballOwnerNullAtCommit = !this.ball?.owner;
  TRACK.phaseAtCommit = this._teamShapePhase ? this._teamShapePhase(a.team) : null;
  // 🔑 决定性分层依据：`holdPrevious` 的四个条件**全部只引用球员自身**，
  // 没有一个引用球。所以要判"这次 hold 是对是错"，必须外部补上球的信息：
  //   ballFromPrev = 球相对旧目标跑了多远（世界是否已跑远）
  //   ballFromCand = 球相对新候选点有多远（新点是否离球更近）
  const ball = this.ball;
  TRACK.ball = ball ? { x: ball.x, y: ball.y } : null;
  TRACK.ballFromPrevM = prev && ball ? metres(ball.x - prev.x, ball.y - prev.y) : null;
  TRACK.ballFromCandM = ball && TRACK.newCandidate
    ? metres(ball.x - TRACK.newCandidate.x, ball.y - TRACK.newCandidate.y)
    : null;
  // 🔑 定阈值真正需要的量：**球自身**从上一次定目标到现在走了多远。
  // `previous.ball`（`off-ball-movement.js:128` 存下）就是"上次决策时的球位置"。
  TRACK.ballTravelM =
    prev && ball && prev.ball && Number.isFinite(prev.ball.x) && Number.isFinite(prev.ball.y)
      ? metres(ball.x - prev.ball.x, ball.y - prev.ball.y)
      : null;
  // 同一间隔内球员自己跑了多远（对照：球 vs 人，谁动得多）
  TRACK.playerTravelM = prev && prev.setAt != null
    ? null // 球员位移需要历史位置，这里没有；用"球员距旧点"近似（已在 holdGap 里）
    : null;
  // 节流间隔：上一次定目标到现在过了多久（= prevAgeSec，语义相同，保留别名便于阅读）
  TRACK.gapSec = TRACK.prevAgeSec;
  // 🔑 `oldTargetRemaining` 的等价量：球员**真实位置**距旧目标点多远。
  // （模块内部用 `offBallDistanceMetres(player, previous)` 算，
  //   这里复刻同一口径 —— 球员位置用 a.x/a.y，**不是** a.tx/a.ty。）
  TRACK.oldTargetRemainingM = prev
    ? metres(a.x - prev.x, a.y - prev.y)
    : null;
  // 🔑🔑 球员是在「接近」旧目标，还是在被它「甩开」？
  //
  // ⚠ 口径修正（第一版写错了）：必须用**同一个参照点**比较球员的两次位置。
  // 第一版记的 `remainToTargetM` 是"距**那一轮的**目标"，而每轮目标都会变 ——
  // 于是两次相减比的是两个不同的点，算出来的"接近速率"没有意义
  // （实测因此得出"98.7% 都在接近、中位 4.77m/s"这种接近全速冲刺的荒谬读数）。
  //
  // 正确口径：拿**上一次提交时球员的位置**，与**这一次提交时球员的位置**，
  // 都相对于**这一次的旧目标点**（`prev`）来算距离。
  const histPos = playerHistory.get(a.id);
  TRACK.prevRemainToOldTargetM =
    histPos && Number.isFinite(histPos.x) && Number.isFinite(histPos.y) && prev
      ? metres(histPos.x - prev.x, histPos.y - prev.y)
      : null;
  // 接近为正（距离在缩小）—— 语义：>0 = 正在接近**这个**旧目标
  TRACK.closingRateM = (TRACK.prevRemainToOldTargetM != null && TRACK.oldTargetRemainingM != null)
    ? TRACK.prevRemainToOldTargetM - TRACK.oldTargetRemainingM
    : null;
  // 间隔时长（用于把 closingRate 归一成"米/秒"，免得受节流抖动影响）
  TRACK.closingMps = (TRACK.closingRateM != null && Number.isFinite(TRACK.prevAgeSec) && TRACK.prevAgeSec > 1e-6)
    ? TRACK.closingRateM / TRACK.prevAgeSec
    : null;
  // 球员自身的位移（|本轮到上一轮的位置差|）——用于判断读数是否物理上可信
  TRACK.playerStepM =
    histPos && Number.isFinite(histPos.x) && Number.isFinite(histPos.y)
      ? metres(a.x - histPos.x, a.y - histPos.y)
      : null;
  const result = ORIG.commit.call(this, a, phaseActor);
  if (TRACK.layer1) TRACK.layer2M = layeredDelta(TRACK.layer1.to, snapshot(a));
  TRACK.held = a.offBallTarget?.decision === "held";
  TRACK.decision = a.offBallTarget?.decision ?? null;
  // 🔑🔑 渲染层缺口诊断：`matchview.applySimSnapshot` 的 `relocate` 缓动要求
  // `adjacent && restartFrame`，而 `restartFrame = ball.restartType || motionContext.discontinuity`，
  // 后者只在**死球 / 庆祝 / 点球**三个窗口为真（`engine.js:472-486`）。
  // ⇒ 若非死球帧发生大位移，缓动不武装 ⇒ 硬置 ⇒ 视觉瞬移。
  // 这里记录该次决策是否落在死球/庆祝窗口内，用来判定那批大跳是否有豁免。
  TRACK.inMotionBoundary =
    (this.deadBallUntil && this.t <= this.deadBallUntil + 1e-6) ||
    (this.celebrateUntil && this.t <= this.celebrateUntil + 1e-6) ||
    !!this.pendingPenalty;
  TRACK.ballRestartType = this.ball?.restartType || null;
  // 🔑 上一轮该球员的锚点（用于交叉验证「锚点翻转 ⇒ 大跳」）
  TRACK._prevAnchor = prevAnchorByPlayer.get(a.id) ?? null;
  prevAnchorByPlayer.set(a.id, TRACK.upstreamNearBallY ?? null);
  TRACK.agentId = a.id;
  TRACK.end = snapshot(a);
  TRACK.endRealX = a.x;
  TRACK.endRealY = a.y;
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
  // 记下这一轮结束时的球员**真实位置**，供下一轮算「接近还是远离」。
  // ⚠ 只记位置，不记"距目标多远"——后者会随目标变化而失去可比性（见上面的口径修正）。
  playerHistory.set(a.id, { x: a.x, y: a.y, t: this.t });
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

// ————————————————————————————————————————————————
// 🔑 决定性分层：held 到底是「正确防抖」还是「错误按住」
// ————————————————————————————————————————————————
//
// 判据来自缺陷本身：`holdPrevious` 只问「球员的新旧目标是否反向」，
// **从不问球是否已经跑了**。于是一次 hold 合不合理，取决于**球**：
//
//   球相对旧目标位移很小  ⇒ 世界没变，压住球员 = 正确的防抖
//   球相对旧目标位移很大  ⇒ 世界已跑远，压住球员 = 把球员钉在过期位置
//
// 同时看「新候选点是否比旧点更靠近球」：若新点明显更靠球，说明
// 新候选才是对的，却仍被旧点取代 ⇒ 强证据表明这次 hold 是错的。
const HELD_BALL_BANDS = [
  { label: "球相对旧点 <5m（世界没变）", lo: 0, hi: 5 },
  { label: "5~15m", lo: 5, hi: 15 },
  { label: "15~30m", lo: 15, hi: 30 },
  { label: ">=30m（世界已跑远）", lo: 30, hi: Infinity },
];
const heldBands = HELD_BALL_BANDS.map((b) => {
  const rows = heldRecords.filter(
    (r) => Number.isFinite(r.ballFromPrevM) && r.ballFromPrevM >= b.lo && r.ballFromPrevM < b.hi
  );
  const gaps = rows.map((r) => r.holdGapM).filter(Number.isFinite);
  const over8 = gaps.filter((v) => v >= 8).length;
  return {
    label: b.label,
    count: rows.length,
    shareOfHeld: heldRecords.length ? rows.length / heldRecords.length : 0,
    holdGapMedian: gaps.length ? quantile(gaps, 0.5) : NaN,
    holdGapMax: gaps.length ? gaps.reduce((m, v) => Math.max(m, v), -Infinity) : NaN,
    gapOver8m: over8,
  };
});

// 强证据：新候选点比旧点**更靠近球**，却仍被旧点取代
const candidateCloserToBall = heldRecords.filter(
  (r) => Number.isFinite(r.ballFromCandM) && Number.isFinite(r.ballFromPrevM)
    && r.ballFromCandM < r.ballFromPrevM - 1
);
const suspiciousHeld = candidateCloserToBall.filter((r) => r.holdGapM >= 8);

const heldBandsTotal = heldBands.reduce((acc, b) => acc + b.count, 0);

// ————————————————————————————————————————————————
// 🔑 阈值标定：`leaseMaxBallTravelMetres` 该取多少？
// ————————————————————————————————————————————————
//
// 语义：**「球从上次定目标到现在跑了多远，就认为上下文已变、租约作废」**。
//
// 定值依据（不是拍）：
//   ① 上界 = 节流间隔内球的最大合理推进量。超过它，压住球员必然是错的。
//   ② 下界 = 真防抖场景里球的位移量级。低于它，压住球员是对的（确实在抖）。
//   ③ 关键校验：阈值取 X 时，**被判为"世界没变"（仍可 held）的样本里，
//     有多少是真防抖** —— 若这部分塌掉，说明阈值压到了防抖区。
//
// 这里给出全体样本（不只 held）的 ballTravelM 分位，供选值。
const allBallTravel = RECORDS
  .map((r) => r.ballTravelM)
  .filter((v) => Number.isFinite(v));
const allBallTravelSum = summarise(allBallTravel);

const BALL_TRAVEL_QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];
const ballTravelQuantileTable = BALL_TRAVEL_QUANTILES.map((q) => ({
  q,
  metres: allBallTravel.length ? quantile(allBallTravel, q) : NaN,
}));

// 候选阈值 → 各自的后果。对每个候选，报：
//   heldKept      = 该阈值下仍会被 hold 的现有 held 样本数（want: 只剩真防抖）
//   heldKeptShare = 占现有 held 的比例
//   bigHoldKilled = 被该阈值阻止的"按住 >=8m"次数（want: 尽量大）
const THRESHOLD_CANDIDATES = [2, 3, 5, 8, 12, 20, 30];
const thresholdTable = THRESHOLD_CANDIDATES.map((t) => {
  const kept = heldRecords.filter(
    (r) => Number.isFinite(r.ballTravelM) && r.ballTravelM < t
  );
  const killed = heldRecords.filter(
    (r) => Number.isFinite(r.ballTravelM) && r.ballTravelM >= t
  );
  const killedBig = killed.filter((r) => r.holdGapM >= 8).length;
  const keptGaps = kept.map((r) => r.holdGapM).filter(Number.isFinite);
  return {
    thresholdMetres: t,
    heldKept: kept.length,
    heldKeptShare: heldRecords.length ? kept.length / heldRecords.length : 0,
    heldKilled: killed.length,
    bigHoldsKilled: killedBig,
    keptHoldGapMedian: keptGaps.length ? quantile(keptGaps, 0.5) : NaN,
    keptHoldGapMax: keptGaps.length ? keptGaps.reduce((m, v) => Math.max(m, v), -Infinity) : NaN,
    /** 全部样本里会被放行的比例（阈值对整体行为的影响面） */
    shareOfAllCommitsKeptEligible: RECORDS.length
      ? RECORDS.filter((r) => Number.isFinite(r.ballTravelM) && r.ballTravelM < t).length / RECORDS.length
      : 0,
  };
});

// ————————————————————————————————————————————————
// 🔑🔑 残余归因：只加球位移阈值，剩下多少 ≥8m 错按没被解释？
// ————————————————————————————————————————————————
//
// 上一次标定发现：**所有阈值下「留下的按住中位」都稳定在 ~18m**，
// 说明单靠球位移覆盖不了全部误伤 —— 还有一部分错按里，球几乎没动、
// 球员却被按住几十米。那部分的主导条件必然是**只引用球员自身**的两个：
//   `reversal`（球员相对旧目标的方向）与 `oldTargetRemaining`（球员距旧目标多远）。
//
// 这里把 held 样本按 **球位移 × 球员距旧目标剩余** 做二维交叉，
// 直接看出"球没动但按住很大"的样本落在哪一格。
const CROSSOVER_THRESHOLD = 3; // 拟采用的球位移阈值
const PLAYER_REMAIN_BANDS = [
  { label: "球员距旧目标 <5m", lo: 0, hi: 5 },
  { label: "5~15m", lo: 5, hi: 15 },
  { label: "15~30m", lo: 15, hi: 30 },
  { label: ">=30m", lo: 30, hi: Infinity },
];
const crossover = PLAYER_REMAIN_BANDS.map((pb) => {
  const inBand = heldRecords.filter((r) => {
    const remain = Number.isFinite(r.oldTargetRemainingM) ? r.oldTargetRemainingM : null;
    return remain !== null && remain >= pb.lo && remain < pb.hi;
  });
  const ballSmall = inBand.filter((r) => Number.isFinite(r.ballTravelM) && r.ballTravelM < CROSSOVER_THRESHOLD);
  const ballLarge = inBand.filter((r) => Number.isFinite(r.ballTravelM) && r.ballTravelM >= CROSSOVER_THRESHOLD);
  const gaps = inBand.map((r) => r.holdGapM).filter(Number.isFinite);
  const smallGaps = ballSmall.map((r) => r.holdGapM).filter(Number.isFinite);
  return {
    label: pb.label,
    total: inBand.length,
    ballSmallCount: ballSmall.length,
    ballLargeCount: ballLarge.length,
    gapMedian: gaps.length ? quantile(gaps, 0.5) : NaN,
    /** ← 这才是关键：球没动（阈值救不了）却按住 >=8m 的样本数 */
    unfixableBigHolds: ballSmall.filter((r) => r.holdGapM >= 8).length,
    unfixableGapMax: smallGaps.length ? smallGaps.reduce((m, v) => Math.max(m, v), -Infinity) : NaN,
  };
});

const totalBigHolds = heldRecords.filter((r) => r.holdGapM >= 8).length;
const fixedByBallThreshold = heldRecords.filter(
  (r) => r.holdGapM >= 8 && Number.isFinite(r.ballTravelM) && r.ballTravelM >= CROSSOVER_THRESHOLD
).length;
const unfixableBigHolds = totalBigHolds - fixedByBallThreshold;

// ————————————————————————————————————————————————
// 🔑🔑🔑 决定性测量：球员在「接近」还是被「甩开」？
// ————————————————————————————————————————————————
//
// 假设：`oldTargetRemaining >= 2.4` 的**语义写错了** ——
// 它检查的是「球员**还没到达**旧目标」，而租约的意图是
// 「球员**正在接近**旧目标，别让他中途改主意」。
// 一个被球甩开、正在**远离**旧目标的球员，同样满足「还没到达」。
//
// 判据：`closingMps`（米/秒，正=接近）。若被按住的大多数是**负值（正在远离）**，
// 则租约确实在锁死"已经放弃该目标"的球员 —— 语义写错的假设成立。
const closingOf = (rows) => rows
  .map((r) => r.closingMps)
  .filter((v) => Number.isFinite(v));
const closingSum = summarise(closingOf(heldRecords));

// 物理可信度自检：接近速率不可能超过球员跑动速度上限（职业球员 ~9 m/s）。
// 若出现 >12 的读数，说明口径仍有问题，读数不可用。
const closingValues = closingOf(heldRecords);
const closingSane = closingValues.filter((v) => v <= 12);
const closingInsane = closingValues.filter((v) => v > 12);
// 另一条自检：球员在间隔内的实际位移（|位置差|）
const playerStepSum = summarise(heldRecords.map((r) => r.playerStepM).filter(Number.isFinite));

const nearZero = 0.15; // 米/秒：低于此视为"基本没在靠近也没在远离"
const closingBuckets = [
  { label: "正在远离 (<= -0.15 m/s)", test: (v) => v <= -nearZero },
  { label: "基本静止 (-0.15~0.15)", test: (v) => v > -nearZero && v < nearZero },
  { label: "正在接近 (>= 0.15 m/s)", test: (v) => v >= nearZero },
];

/** 对给定的 held 子集，给出接近/远离三分。 */
function closureBreakdown(rows, label) {
  const values = closingOf(rows);
  return {
    label,
    n: values.length,
    buckets: closingBuckets.map((b) => ({
      label: b.label,
      count: values.filter(b.test).length,
    })),
  };
}

const closureAll = closureBreakdown(heldRecords, "全部 held");
const closureBig = closureBreakdown(
  heldRecords.filter((r) => r.holdGapM >= 8),
  "按住 >=8m 的 held"
);
const closureUnfixable = closureBreakdown(
  heldRecords.filter((r) => r.holdGapM >= 8 && Number.isFinite(r.ballTravelM) && r.ballTravelM < CROSSOVER_THRESHOLD),
  "球没动却按住 >=8m（阈值救不了的那批）"
);
const closureSmall = closureBreakdown(
  heldRecords.filter((r) => r.holdGapM < 8),
  "按住 <8m 的 held（疑似真防抖）"
);

/**
 * 若把判据从「还没到达」改成「正在接近」（closing >= +ε），
 * 会阻止多少次错按、误伤多少次真防抖？
 */
const CLOSING_EPSILONS = [0.15, 0.3, 0.5, 1.0];
const closingFixTable = CLOSING_EPSILONS.map((eps) => {
  const big = heldRecords.filter((r) => r.holdGapM >= 8);
  const small = heldRecords.filter((r) => r.holdGapM < 8);
  const bigKilled = big.filter((r) => Number.isFinite(r.closingMps) && r.closingMps < eps).length;
  const smallKilled = small.filter((r) => Number.isFinite(r.closingMps) && r.closingMps < eps).length;
  return {
    epsilonMps: eps,
    bigHoldsKilled: bigKilled,
    bigHoldsKilledShare: big.length ? bigKilled / big.length : 0,
    realDampingKilled: smallKilled,
    realDampingKilledShare: small.length ? smallKilled / small.length : 0,
  };
});

// ————————————————————————————————————————————————
// 🔑🔑🔑🔑 「球没动却按住 >=8m」那 540 例到底是什么？
// ————————————————————————————————————————————————
//
// 球位移阈值救不了它们。既然球员侧特征与别的 held 无异，那差异必然在别处。
// 直接看原始样本：它们的新旧目标是"谁"，以及**两个点分别离球多远**。
const unfixableRows = heldRecords.filter(
  (r) => r.holdGapM >= 8 && Number.isFinite(r.ballTravelM) && r.ballTravelM < CROSSOVER_THRESHOLD
);
const unfixableSample = unfixableRows
  .slice()
  .sort((x, y) => y.holdGapM - x.holdGapM)
  .slice(0, 15)
  .map((r) => ({
    holdGapM: Number(r.holdGapM.toFixed(2)),
    ballTravelM: Number((r.ballTravelM ?? NaN).toFixed(2)),
    oldRemainM: Number((r.oldTargetRemainingM ?? NaN).toFixed(2)),
    closingMps: Number((r.closingMps ?? NaN).toFixed(2)),
    ballToOldTargetM: Number((r.ballFromPrevM ?? NaN).toFixed(2)),
    ballToNewCandM: Number((r.ballFromCandM ?? NaN).toFixed(2)),
    fsm: r.fsm,
    held: { x: Number(r.end.x.toFixed(1)), y: Number(r.end.y.toFixed(1)) },
    newCand: { x: Number(r.newCandidate.x.toFixed(1)), y: Number(r.newCandidate.y.toFixed(1)) },
    player: { x: Number(r.agent.x.toFixed(1)), y: Number(r.agent.y.toFixed(1)) },
  }));

/**
 * 这批样本的两个判别量：
 *   ① 新候选点是否比旧目标**更靠近球**（若明显更近 ⇒ 新点更合理，按住是错的）
 *   ② 旧目标是否离球**极远**（旧点已被球抛弃）
 */
const unfixableCandCloser = unfixableRows.filter(
  (r) => Number.isFinite(r.ballFromCandM) && Number.isFinite(r.ballFromPrevM)
    && r.ballFromCandM < r.ballFromPrevM - 1
).length;
const unfixableOldFarFromBall = unfixableRows.filter(
  (r) => Number.isFinite(r.ballFromPrevM) && r.ballFromPrevM >= 15
).length;
const unfixableCandCloseToBall = unfixableRows.filter(
  (r) => Number.isFinite(r.ballFromCandM) && r.ballFromCandM <= 10
).length;

// 那批样本里，新候选点离球多近、旧点离球多远？
const unfixCandBallDist = summarise(
  unfixableRows.map((r) => r.ballFromCandM).filter(Number.isFinite)
);
const unfixOldBallDist = summarise(
  unfixableRows.map((r) => r.ballFromPrevM).filter(Number.isFinite)
);

// ————————————————————————————————————————————————
// 🔑🔑🔑🔑🔑 那批样本是「球权易手但 sameContext 没拦住」吗？
// ————————————————————————————————————————————————
//
// 原始样本显示：旧目标与新候选点**分处球场两端**（一个 ~80m、一个 ~20m），
// 而球只动了 0.15~2.63m。这不像"球推进"，像**攻防方向整个反过来**。
//
// `sameContext` 判据 = `previous.phase === phase && previous.ownerId === ownerId`。
// `ownerId`（`engine.js:1579`）= `ball.owner || ball.receiverId || phaseActor?.id || null`。
//
// 假设：球权易手瞬间 `ball.owner` 为 null（球在空中），`ownerId` 落到
// `receiverId` 或 `phaseActor?.id`，**两边恰好算出同一个值** ⇒ sameContext 误判为真。
//
// 判据：这两列呈"镜像"（一个约 y<50、一个约 y>50），且**方向相反**。
const mirrored = unfixableRows.filter((r) => {
  if (!r.end || !r.newCandidate || !r.prev) return false;
  const heldHalf = r.end.y >= 50 ? "bottom" : "top";
  const candHalf = r.newCandidate.y >= 50 ? "bottom" : "top";
  return heldHalf !== candHalf;
});
const mirroredFarApart = mirrored.filter(
  (r) => metres(r.end.x - r.newCandidate.x, r.end.y - r.newCandidate.y) >= 30
);

// 对照：全体 held 里的"跨半场"比例，看这批是否显著偏高
const allHeldCrossHalf = heldRecords.filter((r) => {
  if (!r.end || !r.newCandidate) return false;
  return (r.end.y >= 50 ? "b" : "t") !== (r.newCandidate.y >= 50 ? "b" : "t");
});

// 这批样本里 ownerId / phase 的形态（探针把它们记下来了）
const ownerShape = { sameOwnerId: 0, ownerBecameNull: 0, ownerChanged: 0, phaseChanged: 0, unknown: 0 };
for (const r of unfixableRows) {
  if (r.ownerIdAtCommit == null || r.prevOwnerId == null) { ownerShape.unknown += 1; continue; }
  if (r.ownerIdAtCommit === r.prevOwnerId) ownerShape.sameOwnerId += 1;
  else ownerShape.ownerChanged += 1;
  if (r.ownerIdAtCommit == null) ownerShape.ownerBecameNull += 1;
  if (r.prevPhase && r.phaseAtCommit && r.prevPhase !== r.phaseAtCommit) ownerShape.phaseChanged += 1;
}
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
    /** 🔑 按「球相对旧点跑了多远」分层：越靠下越可能是"错误按住" */
    heldByBallDisplacement: heldBands,
    heldBandsTotal,
    /** 新候选点比旧点更靠近球、却仍被旧点取代 ⇒ 强证据是错的 */
    heldWhereCandidateWasCloserToBall: candidateCloserToBall.length,
    ofThoseHoldingOver8m: suspiciousHeld.length,
  },
  /** 🔑 阈值标定：`leaseMaxBallTravelMetres` 的取值依据 */
  thresholdCalibration: {
    ballTravelMetresAllCommits: allBallTravelSum,
    ballTravelQuantiles: ballTravelQuantileTable,
    candidates: thresholdTable,
  },
  /** 🔑🔑 残余归因：球位移阈值能救多少、救不了多少 */
  residualAttribution: {
    crossoverBallThresholdMetres: CROSSOVER_THRESHOLD,
    totalBigHolds,
    fixedByBallThreshold,
    unfixableByBallThresholdAlone: unfixableBigHolds,
    unfixableShareOfBigHolds: totalBigHolds ? unfixableBigHolds / totalBigHolds : 0,
    byPlayerRemaining: crossover,
  },
  /** 🔑🔑🔑 决定性：球员在接近旧目标，还是被它甩开？ */
  closureDiagnosis: {
    /** 全部 held 的接近速率（米/秒，正=接近） */
    closingRateMpsAllHeld: closingSum,
    /** 物理可信度自检 */
    sanity: {
      physicallyPossible: closingSane.length,
      impossibleAbove12mps: closingInsane.length,
      playerStepMetresInInterval: playerStepSum,
    },
    breakdowns: [closureAll, closureBig, closureSmall, closureUnfixable],
    /** 把判据改成「正在接近」的代价/收益 */
    ifPredicateBecameClosing: closingFixTable,
  },
  /** 🔑🔑🔑🔑 球位移阈值救不了的那批到底是什么 */
  unfixableResidual: {
    count: unfixableRows.length,
    newCandidateCloserToBall: unfixableCandCloser,
    oldTargetAtLeast15mFromBall: unfixableOldFarFromBall,
    newCandidateWithin10mOfBall: unfixableCandCloseToBall,
    newCandidateDistanceToBall: unfixCandBallDist,
    oldTargetDistanceToBall: unfixOldBallDist,
    topSamples: unfixableSample,
  },
  /** 🔑🔑🔑🔑🔑 那批样本是「球权易手但 sameContext 漏判」吗 */
  contextLeakDiagnosis: {
    unfixableCount: unfixableRows.length,
    /** 保留点与新候选点**分处球场两端**（跨中线）的例数 */
    heldAndCandidateOnOppositeHalves: mirrored.length,
    /** 其中两点相距 >=30m 的（= 目标点被整个翻转） */
    flippedOver30m: mirroredFarApart.length,
    /** 对照：全部 held 里跨半场的比例（看这批是否显著偏高） */
    allHeldCrossHalfCount: allHeldCrossHalf.length,
    allHeldCrossHalfShare: heldRecords.length ? allHeldCrossHalf.length / heldRecords.length : 0,
    unfixableCrossHalfShare: unfixableRows.length ? mirrored.length / unfixableRows.length : 0,
    ownerShapeDuringUnfixable: ownerShape,
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

console.log("\n【🔑🔑 决定性分层：这次 hold 是对是错？】");
console.log("  （holdPrevious 的四个条件全部只引用球员自身，没有一个引用球 ——");
console.log("    所以判它合不合理，只能从外部补上球的信息）");
console.log("  按「球相对旧目标跑了多远」分层：");
console.log("    分档                          计数    占held   按住中位   按住max   其中>=8m");
for (const b of heldBands) {
  const pct = (b.shareOfHeld * 100).toFixed(1);
  const med = Number.isFinite(b.holdGapMedian) ? b.holdGapMedian.toFixed(2) : "—";
  const mx = Number.isFinite(b.holdGapMax) ? b.holdGapMax.toFixed(2) : "—";
  console.log(`    ${b.label.padEnd(28)} ${String(b.count).padStart(6)}  ${pct.padStart(5)}%  ${String(med).padStart(8)}  ${String(mx).padStart(8)}  ${String(b.gapOver8m).padStart(7)}`);
}
console.log(`    （未计入分层的 held: ${heldRecords.length - heldBandsTotal}）`);
console.log(`  新候选点更靠近球、却仍被旧点取代: ${candidateCloserToBall.length} 例`);
console.log(`    其中按住幅度 >=8m 的: ${suspiciousHeld.length} 例  ← 这些几乎没有辩护余地`);

console.log("\n【🔑🔑 阈值标定：leaseMaxBallTravelMetres 该取多少】");
console.log(`  语义 = 「球从上次定目标到现在跑了多远，就认为上下文已变」`);
console.log(`  全体样本的球位移(米)：中位 ${allBallTravelSum.median.toFixed(2)}  p75 ${quantile(allBallTravel, 0.75).toFixed(2)}  p90 ${quantile(allBallTravel, 0.9).toFixed(2)}  p99 ${quantile(allBallTravel, 0.99).toFixed(2)}  max ${allBallTravelSum.max.toFixed(2)}`);
console.log("\n  候选阈值 → 后果：");
console.log("    阈值   仍hold  占held   阻止的hold   阻止的>=8m按住   留下的按住中位/max   全体放行率");
for (const c of thresholdTable) {
  const med = Number.isFinite(c.keptHoldGapMedian) ? c.keptHoldGapMedian.toFixed(1) : "—";
  const mx = Number.isFinite(c.keptHoldGapMax) ? c.keptHoldGapMax.toFixed(1) : "—";
  console.log(`    ${String(c.thresholdMetres).padStart(3)}m  ${String(c.heldKept).padStart(6)}  ${(c.heldKeptShare * 100).toFixed(1).padStart(5)}%  ${String(c.heldKilled).padStart(9)}  ${String(c.bigHoldsKilled).padStart(13)}   ${String(med).padStart(8)}/${String(mx).padStart(8)}   ${(c.shareOfAllCommitsKeptEligible * 100).toFixed(1).padStart(5)}%`);
}

console.log(`\n【🔑🔑 残余归因：球位移阈值(${CROSSOVER_THRESHOLD}m)能救多少】`);
console.log(`  全部 >=8m 按住: ${totalBigHolds}`);
console.log(`  能被球位移阈值阻止: ${fixedByBallThreshold}`);
console.log(`  救不了的: ${unfixableBigHolds}  (${((unfixableBigHolds / Math.max(1, totalBigHolds)) * 100).toFixed(1)}%)  ← 球几乎没动，球员却被按住`);
console.log("\n  按「球员距旧目标剩余」交叉（这是救不了那部分的主导条件）：");
console.log("    球员剩余        总数   球动小  球动大   按住中位   球没动却按住>=8m   其最大按住");
for (const c of crossover) {
  const med = Number.isFinite(c.gapMedian) ? c.gapMedian.toFixed(1) : "—";
  const mx = Number.isFinite(c.unfixableGapMax) ? c.unfixableGapMax.toFixed(1) : "—";
    console.log(`    ${c.label.padEnd(16)} ${String(c.total).padStart(6)} ${String(c.ballSmallCount).padStart(7)} ${String(c.ballLargeCount).padStart(7)}   ${String(med).padStart(8)}   ${String(c.unfixableBigHolds).padStart(15)}   ${String(mx).padStart(9)}`);
}

console.log("\n【🔑🔑🔑 决定性：球员在接近旧目标，还是被它甩开？】");
console.log("  （假设：`oldTargetRemaining >= 2.4` 的语义是「还没到达」，");
console.log("    而租约的意图是「正在接近」—— 一个被球甩开、正在远离的球员同样满足「还没到达」）");
console.log(`  全部 held 的接近速率(米/秒，正=接近)：中位 ${closingSum.median.toFixed(2)}  p10 ${quantile(closingOf(heldRecords), 0.1).toFixed(2)}  p90 ${quantile(closingOf(heldRecords), 0.9).toFixed(2)}`);
console.log(`  ⚠ 物理自检：>12m/s 的读数 ${closingInsane.length} 个（应为 0，球员跑不到这么快）`);
console.log(`             球员在间隔内的实际位移：中位 ${playerStepSum.median.toFixed(2)}m  p90 ${playerStepSum.p90.toFixed(2)}m  max ${playerStepSum.max.toFixed(2)}m`);
console.log("");
for (const b of [closureAll, closureBig, closureSmall, closureUnfixable]) {
  const parts = b.buckets.map((x) => {
    const pct = b.n ? ((x.count / b.n) * 100).toFixed(1) : "0.0";
    return `${x.label}: ${x.count} (${pct}%)`;
  });
  console.log(`  ${b.label}  n=${b.n}`);
  for (const p of parts) console.log(`      ${p}`);
}
console.log("\n  若把判据从「还没到达」改成「正在接近」：");
console.log("    eps(米/秒)   阻止的>=8m错按   占错按   误伤的真防抖(<8m)   占防抖");
for (const c of closingFixTable) {
  console.log(`    ${String(c.epsilonMps).padStart(8)}   ${String(c.bigHoldsKilled).padStart(13)}   ${(c.bigHoldsKilledShare * 100).toFixed(1).padStart(5)}%   ${String(c.realDampingKilled).padStart(15)}   ${(c.realDampingKilledShare * 100).toFixed(1).padStart(5)}%`);
}

console.log(`\n【🔑🔑🔑🔑 球位移阈值救不了的那 ${unfixableRows.length} 例：原始样本】`);
console.log(`  新候选点更靠近球的: ${unfixableCandCloser}  (${((unfixableCandCloser / Math.max(1, unfixableRows.length)) * 100).toFixed(1)}%)`);
console.log(`  旧目标距球 >=15m 的: ${unfixableOldFarFromBall}  (${((unfixableOldFarFromBall / Math.max(1, unfixableRows.length)) * 100).toFixed(1)}%)`);
console.log(`  新候选点距球 <=10m 的: ${unfixableCandCloseToBall}  (${((unfixableCandCloseToBall / Math.max(1, unfixableRows.length)) * 100).toFixed(1)}%)`);
console.log(`  新候选点距球：中位 ${unfixCandBallDist.median.toFixed(2)}m  max ${unfixCandBallDist.max.toFixed(2)}m`);
console.log(`  旧目标距球：  中位 ${unfixOldBallDist.median.toFixed(2)}m  max ${unfixOldBallDist.max.toFixed(2)}m`);
console.log("\n  按按住幅度最大的 15 例：");
console.log("    按住m  球位移m  球员距旧点m  接近m/s  旧点→球m  新点→球m   fsm");
for (const s of unfixableSample) {
  console.log(`    ${String(s.holdGapM).padStart(6)} ${String(s.ballTravelM).padStart(8)} ${String(s.oldRemainM).padStart(11)} ${String(s.closingMps).padStart(8)} ${String(s.ballToOldTargetM).padStart(9)} ${String(s.ballToNewCandM).padStart(9)}   ${s.fsm}`);
}

console.log("\n【🔑🔑🔑🔑🔑 这批是「球权易手但 sameContext 漏判」吗】");
console.log(`  球权前后 ownerId 变化：不变 ${ownerShape.sameOwnerId} ／ 变了 ${ownerShape.ownerChanged} ／ 未知 ${ownerShape.unknown}`);
console.log(`  提交时 ball.owner 为 null 的：${ownerShape.ownerBecameNull}`);
console.log(`  phase 在此期间变化：${ownerShape.phaseChanged}`);
console.log(`  保留点与新候选点跨中线：${mirrored.length} / ${unfixableRows.length} (${((mirrored.length / Math.max(1, unfixableRows.length)) * 100).toFixed(1)}%)`);
console.log(`    其中两点相距 >=30m（目标被整个翻转）：${mirroredFarApart.length}`);
console.log(`  对照：全部 held 里跨中线 ${allHeldCrossHalf.length} / ${heldRecords.length} (${((allHeldCrossHalf.length / Math.max(1, heldRecords.length)) * 100).toFixed(1)}%)`);

console.log("\n【🔑🔑🔑🔑🔑🔑 上游归因：错在目标生成，还是在租约？】");
console.log("  假设（本轮最新）：`holdPrevious` 是**拦截者**，不是缺陷。");
console.log("  若成立，则「上游产出的候选点」应当在球没动时就已经跳到很远处 ——");
console.log("  租约只是把球员按住不让跑（视觉上=不瞬移），被拦住的次数=上游出错的次数。");
{
  const withPrev = RECORDS.filter((r) => Number.isFinite(r.upstreamFromPrevM));
  const ballStill = withPrev.filter((r) => Number.isFinite(r.upstreamBallMoveM) && r.upstreamBallMoveM < 2);
  const absurd = withPrev.filter(
    (r) => Number.isFinite(r.upstreamBallMoveM) && r.upstreamBallMoveM < 2 && r.upstreamFromPrevM >= 15
  );
  const absurdHeld = absurd.filter((r) => r.held);
  const absurdNotHeld = absurd.filter((r) => !r.held);
  const jumpSum = summarise(withPrev.map((r) => r.upstreamFromPrevM));
  const ballMoveSum = summarise(
    withPrev.map((r) => r.upstreamBallMoveM).filter((v) => Number.isFinite(v))
  );
  console.log(`  有前后可比样本: ${withPrev.length}`);
  console.log(`  上游自身上移幅度(米)：中位 ${jumpSum.median.toFixed(2)}  p90 ${jumpSum.p90.toFixed(2)}  p99 ${quantile(withPrev.map((r) => r.upstreamFromPrevM), 0.99).toFixed(2)}  max ${jumpSum.max.toFixed(2)}`);
  console.log(`  球在这期间自己移动(米)：中位 ${ballMoveSum.median.toFixed(2)}  p90 ${ballMoveSum.p90.toFixed(2)}  max ${ballMoveSum.max.toFixed(2)}`);
  console.log(`  ⚠ 「球几乎没动(<2m)」的样本: ${ballStill.length} (${((ballStill.length / Math.max(1, withPrev.length)) * 100).toFixed(1)}%)`);
  console.log(`  ⚠⚠ 「球没动(<2m) 但上游产出点离旧点 >=15m」: ${absurd.length}  ← 上游荒谬目标`);
  console.log(`      其中被租约拦住(held): ${absurdHeld.length}`);
  console.log(`      其中**没被拦住**(会真的跑错=视觉瞬移): ${absurdNotHeld.length}  ←★ 这数就是用户看到的瞬移量`);
  // 🔑 关键复核：这 719 例「跑错」到底是**真错**还是**合理的新决策**？
  // 三种辩护必须逐一量出来，否则会把正常跑位误判成 bug：
  //  (a) 球权刚易手 ⇒ 目标该变（`ownerId` 变了）
  //  (b) 阶段刚切换（过渡/控球/失球）⇒ 目标该变
  //  (c) 球员确实被"甩开"很久了（旧点年龄大）⇒ 该重新决策
  const nh = absurdNotHeld;
  const ownerFlipped = nh.filter((r) => r.prevOwnerId !== r.ownerIdAtCommit).length;
  const phaseFlipped = nh.filter((r) => r.prevPhase !== r.phaseAtCommit).length;
  const prevAgeSum = summarise(nh.map((r) => r.prevAgeSec).filter(Number.isFinite));
  const nhBallMove = summarise(nh.map((r) => r.upstreamBallMoveM).filter(Number.isFinite));
  console.log(`      这 ${nh.length} 例的辩护检测（辩护成立=不是bug）：`);
  console.log(`        (a) 球权 ownerId 变了: ${ownerFlipped} (${((ownerFlipped / Math.max(1, nh.length)) * 100).toFixed(1)}%)`);
  console.log(`        (b) 阶段 phase 变了:   ${phaseFlipped} (${((phaseFlipped / Math.max(1, nh.length)) * 100).toFixed(1)}%)`);
  console.log(`        (c) 旧点年龄(秒)：中位 ${prevAgeSum.median.toFixed(2)}  p90 ${prevAgeSum.p90.toFixed(2)}  max ${prevAgeSum.max.toFixed(2)}`);
  console.log(`            其中旧点年龄 <0.5s（刚定完就翻脸）: ${nh.filter((r) => Number.isFinite(r.prevAgeSec) && r.prevAgeSec < 0.5).length}`);
  console.log(`        (d) 这批的球动幅度：中位 ${nhBallMove.median.toFixed(2)}m  p90 ${nhBallMove.p90.toFixed(2)}m`);
  const defensible = nh.filter(
    (r) => r.prevOwnerId !== r.ownerIdAtCommit || r.prevPhase !== r.phaseAtCommit
  ).length;
  console.log(`      ⇒ 三种辩护全都**不成立**的: ${nh.length - defensible} (${(((nh.length - defensible) / Math.max(1, nh.length)) * 100).toFixed(1)}%)  ← 真·上游荒谬目标`);
  // 按球员净位移分：这批球员最后到底跑了多远（= 视觉位移）
  const nhNet = summarise(nh.map((r) => r.netM).filter(Number.isFinite));
  console.log(`      这批的球员净位移：中位 ${nhNet.median.toFixed(2)}m  p90 ${nhNet.p90.toFixed(2)}m  max ${nhNet.max.toFixed(2)}m`);
  console.log(`      净位移 >=8m（一眼看出是瞬移）: ${nh.filter((r) => r.netM >= 8).length}`);
  // 🔑🔑 决定性复核：`netM` 是 tx/ty（目标点）的变化，**不等于球员真的跑过去**。
  // 判「是否真的跑错」必须看球员的**真实坐标位移**（下一轮记录里才有）。
  // ⇒ 用 `playerHistory` 在这一轮之后、下一轮提交时反查：若球员实际没动，
  //    说明下游还有一层（执行层速度钳制/越位投影/脚下黏球）把荒谬目标吃掉了。
  {
    let ranFar = 0, stayed = 0, ranMed = 0, ranSum = 0, ranN = 0, ranMax = 0;
    for (const r of nh) {
      const later = playerHistory.get(r.agentId);
      if (!later || !Number.isFinite(later.x)) continue;
      const moved = metres(later.x - r.endRealX, later.y - r.endRealY);
      ranSum += moved; ranN += 1;
      if (moved > ranMax) ranMax = moved;
      if (moved >= 8) ranFar += 1;
      else if (moved < 0.5) stayed += 1;
    }
    console.log(`      反查这批球员在**下一次提交前**的真实位移（n=${ranN}）：`);
    console.log(`        实际跑出 >=8m: ${ranFar}   几乎没动(<0.5m): ${stayed}   max ${ranMax.toFixed(2)}m`);
    console.log(`      ⇒ 若 >=8m 仍为 0，则荒谬目标在**执行层**被吸收，球员视觉上不瞬移；`);
    console.log(`        那用户的瞬移报告就不是这条链，应转查渲染层（见独立诊断）。`);
    // 🔑🔑 渲染层豁免检查：这批大跳落在死球/庆祝窗口的比例
    const boundary = nh.filter((r) => r.inMotionBoundary).length;
    const restartMarked = nh.filter((r) => r.ballRestartType).length;
    console.log(`\n      【渲染层豁免检查（决定这批会不会被缓动兜住）】`);
    console.log(`        落在死球/庆祝/点球窗口内（缓动可豁免）: ${boundary} (${((boundary / Math.max(1, nh.length)) * 100).toFixed(1)}%)`);
    console.log(`        带 restartType 标记: ${restartMarked} (${((restartMarked / Math.max(1, nh.length)) * 100).toFixed(1)}%)`);
    console.log(`        ⇒ 既不豁免、又无 restartType 的: ${nh.length - boundary - restartMarked}  ← 这些帧缓动不武装，硬置`);
  }
  console.log("\n      按住幅度最大的 15 例（球没动、没被拦、上游把点扔到 >=15m 外）：");
  console.log("        上游上移m  球动m  球员净位移m  旧点年龄s  旧点→球m  新点→球m  owner变  phase变  fsm→kind");
  for (const s of nh.slice(0, 15)) {
    console.log(
      `        ${String(s.upstreamFromPrevM).padStart(9)} ${String(s.upstreamBallMoveM).padStart(6)} ${String(s.netM).padStart(11)} ${String(Number.isFinite(s.prevAgeSec) ? s.prevAgeSec.toFixed(2) : "—").padStart(10)} ${String(Number.isFinite(s.ballFromPrevM) ? s.ballFromPrevM.toFixed(1) : "—").padStart(9)} ${String(Number.isFinite(s.ballFromCandM) ? s.ballFromCandM.toFixed(1) : "—").padStart(9)}  ${String(s.prevOwnerId !== s.ownerIdAtCommit).padStart(6)}  ${String(s.prevPhase !== s.phaseAtCommit).padStart(7)}  ${String(s.fsm)}/${String(s.upstreamKind ?? "—")}`
    );
  }

  // 按上游上移幅度分桶
  const UP_BANDS = [
    { label: "<1m（正常微调）", lo: 0, hi: 1 },
    { label: "1~5m", lo: 1, hi: 5 },
    { label: "5~15m", lo: 5, hi: 15 },
    { label: "15~30m", lo: 15, hi: 30 },
    { label: ">=30m（跳半场）", lo: 30, hi: Infinity },
  ];
  console.log("\n  上游自身上移幅度分桶（全体提交）：");
  console.log("    幅度档              计数    占比   其中held   held率   球动中位/m");
  for (const bd of UP_BANDS) {
    const rows = withPrev.filter((r) => r.upstreamFromPrevM >= bd.lo && r.upstreamFromPrevM < bd.hi);
    const h = rows.filter((r) => r.held).length;
    const bm = summarise(rows.map((r) => r.upstreamBallMoveM).filter((v) => Number.isFinite(v)));
    console.log(
      `    ${bd.label.padEnd(20)} ${String(rows.length).padStart(6)}  ${((rows.length / Math.max(1, withPrev.length)) * 100).toFixed(1).padStart(5)}%  ${String(h).padStart(8)}  ${((h / Math.max(1, rows.length)) * 100).toFixed(1).padStart(5)}%  ${String(Number.isFinite(bm.median) ? bm.median.toFixed(2) : "—").padStart(9)}`
    );
  }
  // 🔑🔑 归因到具体分支：上游哪些产出会「离球 >=15m」？
  // `_chooseAttackOffBallTarget` 有 7 条 return 路径，用产出的 tx/ty 与
  // baseX/baseY/ball 的关系把分支反推出来（不改引擎，不消费随机数）。
  {
    const withPrev2 = RECORDS.filter(
      (r) => Number.isFinite(r.upstreamFromPrevM) && Number.isFinite(r.upstreamBallMoveM)
    );
    const farFromBall = withPrev2.filter(
      (r) => r.upstreamBallMoveM < 2 && Number.isFinite(r.upstreamToBallM) && r.upstreamToBallM >= 15
    );
    const nearBall = withPrev2.filter(
      (r) => Number.isFinite(r.upstreamToBallM) && r.upstreamToBallM < 15
    );
    const byFsm = new Map();
    for (const r of farFromBall) {
      const k = r.upstreamFsm ?? "?";
      byFsm.set(k, (byFsm.get(k) || 0) + 1);
    }
    console.log("\n  【离球 >=15m 的产出点按上游 fsm 分（落在哪条分支）】");
    for (const [k, v] of [...byFsm.entries()].sort((x, y) => y[1] - x[1])) {
      console.log(`    ${String(k).padEnd(10)} ${String(v).padStart(6)}  ${((v / Math.max(1, farFromBall.length)) * 100).toFixed(1).padStart(5)}%`);
    }
    console.log(`  对照中位上移：离球近(<15m) ${summarise(nearBall.map((r) => r.upstreamFromPrevM)).median.toFixed(2)}m  ／  离球远(>=15m) ${summarise(farFromBall.map((r) => r.upstreamFromPrevM)).median.toFixed(2)}m`);

    // 🔑🔑🔑 决定性判别：把「离球远的点」分成两类
    //   (A) 合理远点 —— 落在自己的固定阵型槽位附近（后卫不跟球，设计如此）
    //   (B) 异常远点 —— 既离球远、又离自己的槽位远（公式算歪 = 真缺陷）
    // 只有 (B) 才是「球没动、目标却自己跑掉」的瞬移源。
    const perUnitX = MX, perUnitY = MY;
    const distToBase = (r) => {
      if (!Number.isFinite(r.upstreamBaseX) || !Number.isFinite(r.upstreamBaseY)) return null;
      const nd = r.end ?? r.newCandidate;
      if (!nd) return null;
      return metres(nd.x - r.upstreamBaseX, nd.y - r.upstreamBaseY);
    };
    const jumpers = farFromBall.filter(
      (r) => r.upstreamFromPrevM >= 15 && r.upstreamBallMoveM < 2
    );
    let legit = 0, weird = 0;
    const weirdRows = [];
    for (const r of jumpers) {
      const db = distToBase(r);
      if (db == null) continue;
      if (db <= 12) legit += 1;           // 落在槽位附近 ⇒ 只是"不跟球"，合理
      else { weird += 1; if (weirdRows.length < 12) weirdRows.push({ ...r, baseDistM: db }); }
    }
    console.log("\n  【那批「球没动却跳 >=15m」的点，落在哪】");
    console.log(`    落在自己固定槽位 <=12m 内（不跟球，设计如此）: ${legit}`);
    console.log(`    既离球远、又离槽位 >12m（公式算歪 = 真缺陷）: ${weird}  ←★ 这才是瞬移源`);
    if (weirdRows.length) {
      console.log("\n    真缺陷样本（按上移幅度）：");
      console.log("      上移m  离槽位m  球动m  角色  队  dir  prog  槽位Y  球Y   产出Y  产出X");
      const sorted = weirdRows.sort((x, y) => y.upstreamFromPrevM - x.upstreamFromPrevM);
      for (const s of sorted) {
        const nd = s.end ?? s.newCandidate;
        const ballY = s.ball ? s.ball.y : NaN;
        console.log(
          `      ${String(s.upstreamFromPrevM.toFixed(1)).padStart(6)} ${String(s.baseDistM.toFixed(1)).padStart(8)} ${String(s.upstreamBallMoveM.toFixed(2)).padStart(6)}  ${String(s.upstreamRole).padEnd(4)} ${String(s.upstreamTeam).padEnd(5)} ${String(s.upstreamDir).padStart(4)} ${String(Number(s.upstreamProg).toFixed(2)).padStart(5)} ${String(Number(s.upstreamBaseY).toFixed(0)).padStart(6)} ${String(Number(ballY).toFixed(0)).padStart(5)} ${String(Number(nd.y).toFixed(1)).padStart(6)} ${String(Number(nd.x).toFixed(1)).padStart(6)}`
        );
      }
      // 🔑 判别：产出点纵向是否"超过"了球（走过了头）或"背离"了球
      const overBall = weirdRows.filter((r) => {
        const nd = r.end ?? r.newCandidate;
        if (!r.ball) return false;
        const dirY = r.upstreamDir;
        // 沿进攻方向，产出点是否越过了球（比球更靠对方球门）
        return dirY * (nd.y - r.ball.y) > 0 && Math.abs(nd.y - r.ball.y) > 5;
      }).length;
      const behindBall = weirdRows.filter((r) => {
        const nd = r.end ?? r.newCandidate;
        if (!r.ball) return false;
        const dirY = r.upstreamDir;
        return dirY * (nd.y - r.ball.y) < 0 && Math.abs(nd.y - r.ball.y) > 30;
      }).length;
      console.log(`\n    其中产出点纵向**越过球** >5m 的: ${overBall} / ${weirdRows.length}`);
      console.log(`    其中产出点纵向**远在球后方**(>30m) 的: ${behindBall} / ${weirdRows.length}`);
    }

    // 🔑🔑🔑 决定性交叉：**锚点翻转**（ball↔base）是否就是大跳的直接原因？
    // 判据：同一球员连续两次决策，上一轮锚点与这一轮锚点不同。
    // 若「锚点翻转」的样本里大跳比例远高于「锚点不变」，则根因坐实。
    {
      const withAnchor = RECORDS.filter(
        (r) => r.upstreamNearBallY && Number.isFinite(r.upstreamFromPrevM)
      );
      const flipped = withAnchor.filter(
        (r) => r._prevAnchor && r._prevAnchor !== r.upstreamNearBallY
      );
      const same = withAnchor.filter(
        (r) => r._prevAnchor && r._prevAnchor === r.upstreamNearBallY
      );
      const big = (rows) => rows.filter((r) => r.upstreamFromPrevM >= 15).length;
      const med = (rows) => summarise(rows.map((r) => r.upstreamFromPrevM)).median;
      console.log("\n  【🔑🔑🔑 锚点翻转 vs 上移幅度 —— 直接验证「分支抖动」假设】");
      console.log(`    上一轮锚点 ≠ 本轮（锚点翻转，含 drop 抖动）: n=${flipped.length}`);
      console.log(`      上移中位 ${med(flipped).toFixed(2)}m   >=15m 的 ${big(flipped)} (${((big(flipped) / Math.max(1, flipped.length)) * 100).toFixed(1)}%)`);
      console.log(`    上一轮锚点 = 本轮（锚点不变）:            n=${same.length}`);
      console.log(`      上移中位 ${med(same).toFixed(2)}m   >=15m 的 ${big(same)} (${((big(same) / Math.max(1, same.length)) * 100).toFixed(1)}%)`);
      if (big(same) > 0 || big(flipped) > 0) {
        const lift = (big(flipped) / Math.max(1, flipped.length)) / Math.max(1e-9, big(same) / Math.max(1, same.length));
        console.log(`    ⇒ 锚点翻转使「大跳」概率提升 ${lift.toFixed(1)}×`);
      }
    }

    // ————————————————————————————————————————————————
    // 🔑 方向 C：模拟「迟滞」能救多少（零成本预估，不改引擎）
    // —
    // 迟滞（hysteresis）的口径：一旦走到某个锚点，就要求更强的证据才切回另一个锚点。
    // 具体到 `_chooseAttackOffBallTarget`：`drop` 的进入门是 `prog < 0.68`，
    // 若加迟滞，退出应要求 `prog > 0.74`（带宽 0.06）。
    // 探针里用「上一轮锚点 + 本轮 prog」重建：
    //   · 上一轮锚 = ball（在 drop 分支）→ 本轮只有当 prog > 0.74 才允许切回 base
    //   · 上一轮锚 = base（在 else 分支）→ 本轮只有当 prog < 0.68 才允许切到 ball
    //   · 中间带内保持上一轮锚点不变 ⇒ 消掉翻转
    // 注意：这只估算「哪些翻转会被迟滞消掉」，不重算目标点本身（探针没有引擎的分支上下文）。
    {
      const HYSTERESIS_BANDS = [
        { label: "带宽 0.00（现状）", bw: 0 },
        { label: "带宽 0.03", bw: 0.03 },
        { label: "带宽 0.06", bw: 0.06 },
        { label: "带宽 0.10", bw: 0.10 },
        { label: "带宽 0.15", bw: 0.15 },
      ];
      const withProg = RECORDS.filter(
        (r) => r._prevAnchor && Number.isFinite(r.upstreamProg) && Number.isFinite(r.upstreamFromPrevM)
      );
      console.log("\n  【🔑 方向 C：加「迟滞」能消掉多少翻转与大跳（零成本预估）】");
      console.log("    进入 drop 的门 prog<0.68；迟滞带宽 bw ⇒ 退出需 prog>0.68+bw");
      console.log("    带宽     锚点翻转数   被迟滞消除   消除率   大跳(>=15m)数   其中被消除");
      for (const hb of HYSTERESIS_BANDS) {
        // 判定本轮"若不迟滞"的锚（探针已反推），以及"若迟滞"的锚
        let flipNow = 0, flipKilled = 0, bigNow = 0, bigKilled = 0;
        for (const r of withProg) {
          const wouldFlip = r._prevAnchor !== r.upstreamNearBallY;
          if (!wouldFlip) continue;
          flipNow += 1;
          const isBig = r.upstreamFromPrevM >= 15;
          if (isBig) bigNow += 1;
          // 迟滞：在中间带（0.68 ~ 0.68+bw）内保持上一轮锚点
          const prog = r.upstreamProg;
          const inBand = prog >= 0.68 && prog <= 0.68 + hb.bw;
          if (inBand) {
            // 带宽内不许翻转 ⇒ 这次翻转被消除
            flipKilled += 1;
            if (isBig) bigKilled += 1;
          }
        }
        console.log(
          `    ${hb.bw.toFixed(2).padStart(6)}   ${String(flipNow).padStart(10)}   ${String(flipKilled).padStart(10)}   ${((flipKilled / Math.max(1, flipNow)) * 100).toFixed(1).padStart(5)}%   ${String(bigNow).padStart(12)}   ${String(bigKilled).padStart(9)}`
        );
      }
      console.log("    ⚠ 这是**上界估计**：迟滞只在「prog 落回中间带」时生效，");
      console.log("      而很多翻转发生在球位远离边界（prog 深在 0.2 或 0.9）时 —— 那些迟滞救不了。");
      console.log("      真正的收益要在引擎里实施后用 `verify.mjs` + 进球率复核才能定论。");
    }

    // ————————————————————————————————————————————————
    // 🔑🔑 迟滞失效的原因诊断：翻转到底发生在 prog 的哪个位置？
    // 若翻转集中在 prog 中间带（≈0.68），迟滞有效；
    // 若翻转散布在两侧深处，则门其实没在抖 —— 抖的是 `nearest` / `random()`。
    {
      const withProg = RECORDS.filter(
        (r) => r._prevAnchor && Number.isFinite(r.upstreamProg) && r._prevAnchor !== r.upstreamNearBallY
      );
      const PROG_BANDS = [
        { label: "0.00~0.20", lo: 0, hi: 0.2 },
        { label: "0.20~0.40", lo: 0.2, hi: 0.4 },
        { label: "0.40~0.60", lo: 0.4, hi: 0.6 },
        { label: "0.60~0.68（门附近）", lo: 0.6, hi: 0.68 },
        { label: "0.68~0.80（门附近）", lo: 0.68, hi: 0.8 },
        { label: "0.80~1.00", lo: 0.8, hi: 1.01 },
      ];
      console.log("\n  【🔑🔑 锚点翻转发生在 prog 的哪个位置（诊断迟滞为何失效）】");
      console.log("    prog 档                  翻转数   占比   其中大跳(>=15m)   大跳占比");
      for (const pb of PROG_BANDS) {
        const rows = withProg.filter((r) => r.upstreamProg >= pb.lo && r.upstreamProg < pb.hi);
        const bigRows = rows.filter((r) => r.upstreamFromPrevM >= 15).length;
        console.log(
          `    ${pb.label.padEnd(24)} ${String(rows.length).padStart(6)}  ${((rows.length / Math.max(1, withProg.length)) * 100).toFixed(1).padStart(5)}%  ${String(bigRows).padStart(16)}   ${((bigRows / Math.max(1, rows.length)) * 100).toFixed(1).padStart(5)}%`
        );
      }
      const nearGate = withProg.filter((r) => r.upstreamProg >= 0.60 && r.upstreamProg < 0.80).length;
      console.log(`    ⇒ 落在「门附近」（0.60~0.80）的翻转只占 ${((nearGate / Math.max(1, withProg.length)) * 100).toFixed(1)}%`);
      console.log(`      ⇒ ${((1 - nearGate / Math.max(1, withProg.length)) * 100).toFixed(1)}% 的翻转发生在 prog 深处 —— `);
      console.log(`        prog 门根本没在抖，抖的是 \`nearest\` / \`this.random() < p\` / \`dropDepth\` 的随机项。`);
    }
  }
}


console.log("\n【🔑 换边特征诊断（坐标镜像的指纹）】");
console.log(`  纵向 >=${SIDE_SWITCH.bigY}m 且 横向 <=${SIDE_SWITCH.smallX}m 的样本: ${sideSwitchLike.length}`);
console.log(`  其中同时 held=true（租约说"保留旧目标"却跳了半场）: ${sideSwitchAndHeld.length}`);
console.log(`  from/to 跨过中线的样本: ${crossedHalf.length}`);
console.log("  ⇒ 若此数接近大位移总数，则这些不是跑位，是坐标被整体翻转而未重置租约。");

console.log(`\n耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
