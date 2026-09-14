/**
 * 进攻三区「跨度两端点」探针 —— 回答「要把跨度压到 30–40 m，该从哪一端下手」，
 * 并顺带回答主线问题「球推进时整条块有没有跟着抬起来」。
 *
 * 背景：`_attack-block-length-breakdown-probe.mjs` 量到进攻三区跨度 47.4 m（球 85–105 m 档 47.3 m），
 * 构成是 CB 50.9 m ↔ ATT 98.0 m。其中 CB 那一端靠 `CB_BLOCK_SHIFT_MAX_M` 已经用尽
 * （见 docs/attack-block-shift-diagnosis-2026-09-14.md §5g：再推就跌破进球护栏）。
 *
 * 剩下的是 **ATT 那一端**。而 ATT 不是自由变量：`_clampOffside` 把它钳在**对手最后一名后卫**
 * 的线上。两队的深度都从各自门线量起，所以存在一个恒等式：
 *
 *     我方 ATT 深度 + 对手最后一名后卫深度 = 105 m（场地全长）
 *
 * 也就是说：**对手后卫站得越深，我方前锋就被钉得越深**。
 *
 * ⚠ 口径说明（2026-09-14 第二版）：本版把「持球帧」收紧为
 * `owner 存在 + ball.state ∈ {held, control} + 球不在持球方自己禁区内`，
 * 与 `_ball-depth-occupancy-probe.mjs` / `box-possession-sampling-audit.mjs` 对齐。
 * 第一版只判 `ball.owner` 是否存在，会把己方禁区持球（门将）算进来。
 * 同时**取消**「只看进攻三区」的采集限制，改为全帧采集、按节过滤，
 * 这样第 4b 节才能给出**全场**的块高剖面——那才是「整体前压」的直接读数。
 *
 * 只读，不改任何东西。
 * 用法：node scripts/_attack-span-endpoints-probe.mjs [standard|background] [场数]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const PROFILE = process.argv[2] === "background" ? "background" : "standard";
const MATCHES = Number(process.argv[3] || 4);
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05 m / y 格
const SAMPLE_STEPS = 5; // 与队形审计一致：每 0.5 秒
const SEEDS = Array.from({ length: MATCHES }, (_, i) => 372000 + i); // 与队形审计同种子

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

const ATTRS = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "finishing", "tackling", "marking", "strength", "stamina", "vision",
  "reflexes", "handling", "positioning", "kicking", "crossing", "decisions",
];
function makeClub(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, i) => {
    const rating = Math.max(1, Math.min(20, ability + (((i * 7 + ability) % 5) - 2)));
    const attrs = {};
    for (const k of ATTRS) attrs[k] = rating;
    return { id: `${name}-p${i}`, name: `${name}-p${i}`, pos, number: i + 1, fitness: 100, attrs };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");

const rows = [];
for (const seed of SEEDS) {
  const timeStep = PROFILE === "background" ? 0.3 : SIM.DT;
  const separationPasses = PROFILE === "background" ? 4 : 8;
  const engine = new SimEngine(
    makeClub(`home-${seed}`, 15),
    makeClub(`away-${seed}`, 15),
    { random: seededRandom(seed), simulationProfile: PROFILE, timeStep, separationPasses }
  );
  const steps = Math.round((90 * 60) / timeStep);

  for (let step = 0; step < steps; step++) {
    engine.step(timeStep);
    if (step % SAMPLE_STEPS !== 0) continue;

    const live = engine.agents.filter((a) => !a.sentOff);
    const ball = engine.ball;
    const owner = ball.owner ? engine.agentById(ball.owner) : null;
    if (!owner) continue;
    if (ball.state !== "held" && ball.state !== "control") continue;
    const ownerTeam = owner.team;
    // 排除「球在持球方自己禁区」的帧（门将持球等）
    if (engine._inOwnFoulBox(ownerTeam, ball.x, ball.y)) continue;

    const opp = ownerTeam === "home" ? "away" : "home";
    const ownGoalL = ownerTeam === "home" ? SIM.PITCH_H_METRES : 0;
    const oppGoalL = opp === "home" ? SIM.PITCH_H_METRES : 0;
    const depthOf = (a, goalL) => Math.abs(a.y * MY - goalL);

    const squad = live.filter((a) => a.team === ownerTeam);
    const outfield = squad.filter((a) => a.role !== "GK");
    const atts = squad.filter((a) => a.role === "ATT");
    const defs = squad.filter((a) => a.role === "DEF");
    const mids = squad.filter((a) => a.role === "MID");
    if (outfield.length < 7 || !atts.length || !defs.length) continue;

    const oppSquad = live.filter((a) => a.team === opp);
    const oppDefs = oppSquad.filter((a) => a.role === "DEF");
    const oppOutfield = oppSquad.filter((a) => a.role !== "GK");
    if (oppDefs.length < 3 || oppOutfield.length < 7) continue;

    const ballDepth = depthOf(ball, ownGoalL);

    const cbDeep = Math.min(...defs.map((a) => depthOf(a, ownGoalL)));
    const forwardTop = Math.max(...atts.map((a) => depthOf(a, ownGoalL)));
    const midTop = mids.length ? Math.max(...mids.map((a) => depthOf(a, ownGoalL))) : NaN;
    const outfieldDepths = outfield.map((a) => depthOf(a, ownGoalL));
    const outfieldTop = Math.max(...outfieldDepths);
    // 外场块长：与 `attack-shape-compaction-audit.mjs` 的 `lengthOf(outfield)` 同口径
    const outfieldLen = outfieldTop - Math.min(...outfieldDepths);
    // 球是否真在**对方罚球区内**（审计同口径，比「球深度 ≥85」精确）
    const inOppBox = engine._inOwnFoulBox(opp, ball.x, ball.y);

    // 对手最后一名后卫：离**对手自己门线**的距离
    const oppDefDepths = oppDefs.map((a) => depthOf(a, oppGoalL)).sort((x, y) => x - y);
    const oppDeepest = oppDefDepths[0];
    const oppSecond = oppDefDepths.length > 1 ? oppDefDepths[1] : NaN;
    const oppLineMedian = median(oppDefDepths);

    // 我方最深前锋「应该」被钉在越位线（= 对手倒数第二名防守者，含门将）上
    const pinnedDepth = SIM.PITCH_H_METRES - oppDeepest;
    const pinResidual = forwardTop - pinnedDepth;

    const oppInOwnBoxZone = oppOutfield.filter((a) => depthOf(a, oppGoalL) < 18).length;

    rows.push({
      seed, team: ownerTeam, ballDepth,
      cbDeep, forwardTop, midTop, outfieldTop, outfieldLen,
      span: forwardTop - cbDeep,
      blockMid: (cbDeep + forwardTop) / 2,
      oppDeepest, oppSecond, oppLineMedian,
      pinResidual,
      oppInOwnBoxZone,
      inAttackThird: ballDepth > 70,
      inOppBox,
    });
  }
}

const attack = rows.filter((r) => r.inAttackThird);
const bucketOf = (d) => (d >= 85 ? "85–105" : "70–85");
const BUCKETS = ["70–85", "85–105"];

console.log(`\n=== 跨度两端点 + 块高剖面（${SEEDS.length} 场，种子 ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]}，${PROFILE} 档）===`);
console.log(`全场持球帧 ${rows.length}，其中进攻三区 ${attack.length}（${fmt((100 * attack.length) / rows.length)}%）。单位 m。\n`);

console.log("--- 1. 全部进攻三区持球帧 ---");
console.log(`  我方 CB 最深          中位 ${fmt(median(attack.map((r) => r.cbDeep)))}`);
console.log(`  我方 ATT 最深         中位 ${fmt(median(attack.map((r) => r.forwardTop)))}`);
console.log(`  跨度（ATT − CB）      中位 ${fmt(median(attack.map((r) => r.span)))}`);
console.log(`  对手最后一名后卫离其门线 中位 ${fmt(median(attack.map((r) => r.oppDeepest)))}  ← 恒等式的另一端（105 − ATT）`);
console.log(`  对手第二深后卫        中位 ${fmt(median(attack.map((r) => r.oppSecond)))}`);
console.log(`  对手后卫线中位深度    中位 ${fmt(median(attack.map((r) => r.oppLineMedian)))}`);

console.log("\n--- 2. 恒等式校验（我方 ATT 深度 + 对手最后一名后卫深度 应 ≈ 105）---");
const sums = attack.map((r) => r.forwardTop + r.oppDeepest);
console.log(`  和 中位 ${fmt(median(sums), 2)} | 均值 ${fmt(mean(sums), 2)} | 最小/最大 ${fmt(Math.min(...sums), 1)}/${fmt(Math.max(...sums), 1)}`);
console.log(`  被钉住（残差 |x| ≤ 2 m）占比 ${fmt((100 * attack.filter((r) => Math.abs(r.pinResidual) <= 2).length) / attack.length)}%`);
console.log(`  残差 中位 ${fmt(median(attack.map((r) => r.pinResidual)), 2)}（正 = 比越位线还深）`);

console.log("\n--- 3. 按球深度分桶（进攻三区）---");
console.log("  球深度     队帧     CB最深   ATT最深   跨度    对手最深后卫  对手后卫线中位  对手禁区内人数");
for (const b of BUCKETS) {
  const set = attack.filter((r) => bucketOf(r.ballDepth) === b);
  if (!set.length) continue;
  console.log(
    `  ${b.padEnd(9)} ${String(set.length).padStart(6)} ${fmt(median(set.map((r) => r.cbDeep))).padStart(8)} ` +
    `${fmt(median(set.map((r) => r.forwardTop))).padStart(8)} ${fmt(median(set.map((r) => r.span))).padStart(7)} ` +
    `${fmt(median(set.map((r) => r.oppDeepest))).padStart(12)} ${fmt(median(set.map((r) => r.oppLineMedian))).padStart(14)} ` +
    `${fmt(median(set.map((r) => r.oppInOwnBoxZone)), 0).padStart(14)}`
  );
}

console.log("\n--- 4. 对手最后一名后卫的深度分布（85–105 档）---");
const deep = attack.filter((r) => bucketOf(r.ballDepth) === "85–105");
const buckets = [[0, 4], [4, 8], [8, 12], [12, 16], [16, 22], [22, 30], [30, 999]];
for (const [lo, hi] of buckets) {
  const n = deep.filter((r) => r.oppDeepest >= lo && r.oppDeepest < hi).length;
  console.log(`  离其门线 ${String(lo).padStart(3)}–${hi === 999 ? "  ∞" : String(hi).padStart(3)} m：${String(n).padStart(5)}  (${fmt((100 * n) / deep.length)}%)`);
}

console.log("\n--- 4b. 全场块高剖面：球深度每 10 m 一档（全部持球帧）---");
console.log("  球深度     队帧    CB最深   中场最深  ATT最深   跨度   块长   块中点   对手最后一名后卫  对手后卫线中位");
const bands = [[0, 15], [15, 25], [25, 35], [35, 45], [45, 55], [55, 65], [65, 75], [75, 85], [85, 95], [95, 105]];
for (const [lo, hi] of bands) {
  const set = rows.filter((r) => r.ballDepth >= lo && r.ballDepth < hi);
  if (set.length < 40) continue;
  console.log(
    `  ${(lo + "–" + hi).padEnd(9)} ${String(set.length).padStart(6)} ${fmt(median(set.map((r) => r.cbDeep))).padStart(8)} ` +
    `${fmt(median(set.map((r) => r.midTop))).padStart(8)} ${fmt(median(set.map((r) => r.forwardTop))).padStart(8)} ` +
    `${fmt(median(set.map((r) => r.span))).padStart(6)} ${fmt(median(set.map((r) => r.outfieldLen))).padStart(6)} ` +
    `${fmt(median(set.map((r) => r.blockMid))).padStart(8)} ` +
    `${fmt(median(set.map((r) => r.oppDeepest))).padStart(16)} ${fmt(median(set.map((r) => r.oppLineMedian))).padStart(16)}`
  );
}
console.log("  （球深度 = 球距持球方自己门线的米数；块长 = 外场 max−min 深度，与审计同口径）");

console.log("\n--- 4c. 要达到跨度目标，ATT 那一端需要站到哪（进攻三区）---");
const cbAll = median(attack.map((r) => r.cbDeep));
for (const target of [30, 35, 40]) {
  const attNeeded = cbAll + target;
  const oppNeeded = SIM.PITCH_H_METRES - attNeeded;
  console.log(`  跨度 ≤ ${target} m（CB 保持 ${fmt(cbAll)} m）→ ATT ≤ ${fmt(attNeeded)} m → 对手最后一名后卫须离其门线 ≥ ${fmt(oppNeeded)} m`);
}
console.log(`  实测 85–105 档对手最后一名后卫中位 ${fmt(median(deep.map((r) => r.oppDeepest)))} m；该档球本身离对手门线中位 ${fmt(median(deep.map((r) => SIM.PITCH_H_METRES - r.ballDepth)))} m`);

console.log("\n--- 4d. 进攻三区按球深度切两段（外场块长 = 审计 lengthOf(outfield) 同口径）---");
console.log("  分组                     队帧   外场块长   跨度    CB最深   ATT最深  对手最后一名后卫  对手后卫线中位");
for (const [label, set] of [
  ["三区·球 70–85（组织）", attack.filter((r) => r.ballDepth < 85)],
  ["三区·球 85–105（深入）", attack.filter((r) => r.ballDepth >= 85)],
]) {
  if (!set.length) continue;
  console.log(
    `  ${label.padEnd(23)} ${String(set.length).padStart(6)} ${fmt(median(set.map((r) => r.outfieldLen))).padStart(9)} ` +
    `${fmt(median(set.map((r) => r.span))).padStart(6)} ${fmt(median(set.map((r) => r.cbDeep))).padStart(8)} ` +
    `${fmt(median(set.map((r) => r.forwardTop))).padStart(8)} ${fmt(median(set.map((r) => r.oppDeepest))).padStart(14)} ` +
    `${fmt(median(set.map((r) => r.oppLineMedian))).padStart(14)}`
  );
}
console.log(`  → 「球 85–105」占进攻三区持球帧 ${fmt((100 * attack.filter((r) => r.ballDepth >= 85).length) / attack.length)}%`);
console.log(`  对照（审计 attackCeiling 54 / span [30, 52]）：全三区外场块长 ${fmt(median(attack.map((r) => r.outfieldLen)))} m`);
console.log("  附：球在对方罚球区内（含贴边）占进攻三区 " + fmt((100 * attack.filter((r) => r.inOppBox).length) / attack.length) + "%（这是横向口径，不等价于上面的深度分段）");

console.log("\n--- 5. 读法 ---");
console.log("· 第 2 节：和 ≈ 105 且被钉住占比高 → ATT 由对手倒数第二名防守者决定，");
console.log("  降跨度只能靠抬高对手防线，而不是继续推我方中卫线。");
console.log("· 第 4b 节是主线读数：看 CB 最深那一列有没有随球深度**单调上移**。");
console.log("  若球到 85+ 时 CB 仍停在 ~50 m，说明块确实没整体前压；");
console.log("  若 65–85 档跨度已在 30–40 m，说明「进攻三区太长」主要是**禁区围攻**帧拉动的。");
console.log("· 第 4c 节：若达标所需的对手后卫位置离其门线十几米、而球此刻就在门前几米，");
console.log("  则该目标在禁区进攻阶段几何上不可达。");
