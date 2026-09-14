/**
 * 诊断：进攻时「球队整体随球前压」到底缺在哪一条线？
 *
 * 背景：`scripts/attack-shape-compaction-audit.mjs` 量出进攻三区队形长度 ~63 m，
 * 其中 DEF→ATT 跨度 60.0 m ≈ 4-3-3 静态模板的 59.85 m（`js/data.js:775-781`）。
 * 代码走查指向 `_chooseAttackOffBallTarget`（`engine.js:3734`）里的一条分支：
 *
 *   // 中卫留作防反保护，不再因为离球较近跟进到禁区弧顶围球。
 *   if (finalThird && a.role === "DEF" && !this._isFullback(a)) {
 *     a.tx = clamp(a.baseX + (b.x - 50) * 0.08, 18, 82);
 *     a.ty = clamp(a.baseY + dir * 7, 18, 82);      // ← 纵向目标是**常量**
 *     ...
 *   }
 *
 * 4-3-3 的两名中卫 baseY = 75（`js/data.js:777-778` 的 x=38/62 槽），home 的 dir = -1
 * （`engine.js:708`），于是 `ty = 68` 格 → 距己方门线 `(100-68) × 1.05 = 33.6 m`。
 * **这个 33.6 与审计实测的「最后一名后卫深度 33.6 m」逐位相同**——但那是手算，
 * 本脚本在真实运行中验证它，并量化「中卫线是否随球前压」。
 *
 * 判据（关键）：如果中卫线的纵向目标真是常量，那么
 *   `corr(球的推进深度, 中卫线深度)` 在进攻三区应 ≈ 0，回归斜率也应 ≈ 0；
 * 而 MID / ATT 线作为对照应该有明显正斜率。若三者都 ≈ 0，
 * 说明问题不在单条分支，而在更上层；若只有中卫线 ≈ 0，病因即定位到上面那条分支。
 *
 * 只读引擎公开状态，不消费随机数。口径与仓库其它探针一致（种子 372000..、每 0.5s 采样）。
 *
 * 用法：node scripts/_attack-block-shift-probe.mjs [场数] [standard|background]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MY = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05 m / y 格
const SAMPLE_STEPS = 5;
const FINAL_THIRD = 0.64;   // 与引擎 `_chooseAttackOffBallTarget` 的 finalThird 同阈值
const CB_PIN_UNITS = 7;     // 中卫分支的 `dir * 7`

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
    ]) attrs[key] = rating;
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

const median = (values) => {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
/** 最小二乘斜率 y = a + b·x */
function slope(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > 1e-9 ? num / den : NaN;
}
function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 1e-9 && syy > 1e-9 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

const matchCount = Math.max(1, Number(process.argv[2]) || 6);
const profile = process.argv[3] === "background" ? "background" : "standard";
const seeds = Array.from({ length: matchCount }, (_, i) => 372000 + i);
const timeStep = profile === "background" ? 0.3 : SIM.DT;
const separationPasses = profile === "background" ? 4 : 8;

/** 每帧每队一行记录 */
const rows = [];

for (const seed of seeds) {
  const engine = new SimEngine(
    makeClub(`home-${seed}`, 15),
    makeClub(`away-${seed}`, 15),
    { random: seededRandom(seed), simulationProfile: profile, timeStep, separationPasses }
  );
  const steps = Math.round((90 * 60) / timeStep);

  for (let step = 0; step < steps; step++) {
    engine.step(timeStep);
    if (step % SAMPLE_STEPS !== 0) continue;

    const live = engine.agents.filter((agent) => !agent.sentOff);
    // 控球方：`ball.owner` 是球员 id，探针的俱乐部 id 以 home/away 开头
    const ownerTeam = engine.ball.owner
      ? (String(engine.ball.owner).startsWith("home") ? "home" : "away")
      : null;
    for (const team of ["home", "away"]) {
      const squad = live.filter((agent) => agent.team === team);
      if (squad.length < 7) continue;
      // ⚠ 关键过滤：无球一方走的是防守分支（`_refreshDefPlan` 等），不是 `_chooseAttackOffBallTarget`。
      //    按球的推进深度分桶其实已能自动分离攻守（球靠近对方球门 = 该队在进攻），
      //    但这里显式过滤，避免把防守站位混进「进攻前压」的结论。
      const inPossession = ownerTeam === team;
      if (!inPossession) continue;
      const dir = team === "home" ? -1 : 1;
      const ownGoalY = team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
      // 距己方门线的深度（m）：depth = |y*MY - ownGoalY*MY|
      const depthOf = (y) => Math.abs(y * MY - ownGoalY * MY);
      const ballDepth = depthOf(engine.ball.y);
      const prog = Math.abs(engine.ball.y - ownGoalY) / 100;

      const isFullback = (a) => {
        if (a.detailedPosition === "LB" || a.detailedPosition === "RB") return true;
        if (a.detailedPosition === "CB") return false;
        const x = a.slotX != null ? a.slotX : a.baseX;
        return a.role === "DEF" && (x < 30 || x > 70);
      };
      const centreBacks = squad.filter((a) => a.role === "DEF" && !isFullback(a));
      if (centreBacks.length < 2) continue;

      // 中卫线：取**最深**那名中卫（与审计的 attackBackLine 同口径），用目标位 ty
      const cbTargetDepth = Math.min(...centreBacks.map((a) => depthOf(a.ty)));
      const cbActualDepth = Math.min(...centreBacks.map((a) => depthOf(a.y)));
      const cbMedianTargetDepth = median(centreBacks.map((a) => depthOf(a.ty)));
      // 预测值：分支公式 clamp(baseY + dir*7, 18, 82)
      const cbPredicted = centreBacks.map((a) => {
        const ty = Math.max(18, Math.min(82, a.baseY + dir * CB_PIN_UNITS));
        return depthOf(ty);
      });
      const cbPredictedMin = Math.min(...cbPredicted);
      const cbMatchPredicted = centreBacks.every((a, index) =>
        Math.abs(depthOf(a.ty) - cbPredicted[index]) < 0.05);

      const midDepth = median(squad.filter((a) => a.role === "MID").map((a) => depthOf(a.ty)));
      const attDepth = median(squad.filter((a) => a.role === "ATT").map((a) => depthOf(a.ty)));
      const fbList = squad.filter((a) => a.role === "DEF" && isFullback(a)).map((a) => depthOf(a.ty));
      const fbDepth = median(fbList);

      rows.push({
        team, seed, ballDepth, prog, finalThird: prog > FINAL_THIRD, inPossession,
        cbTargetDepth, cbActualDepth, cbMedianTargetDepth, cbPredictedMin, cbMatchPredicted,
        midDepth, attDepth, fbDepth,
      });
    }
  }
}

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");

console.log(`\n=== 进攻时球队前压诊断（${seeds.length} 场，种子 ${seeds[0]}..${seeds[seeds.length - 1]}，${profile} 档）===`);
console.log(`**只统计控球方**（无球方走防守分支，不属本诊断）；每队帧 = 一行。`);
console.log(`共 ${rows.length} 行，其中进攻三区 ${rows.filter((r) => r.finalThird).length} 行`);
console.log(`三区阈值 prog > ${FINAL_THIRD}（与引擎 finalThird 同）；深度以己方门线为 0。\n`);

// —— 1. 分支公式命中率 ——
const finalRows = rows.filter((r) => r.finalThird);
const matched = finalRows.filter((r) => r.cbMatchPredicted).length;
console.log("--- 1. 中卫纵向目标是否等于分支常量 `clamp(baseY + dir*7, 18, 82)` ---");
console.log(`  进攻三区内，两名中卫的目标位**同时**等于公式预测的队帧：${matched}/${finalRows.length}` +
  ` (${fmt(100 * matched / Math.max(1, finalRows.length))}%)`);
console.log(`  中卫线（最深者）目标深度中位：进攻三区 ${fmt(median(finalRows.map((r) => r.cbTargetDepth)))} m` +
  ` / 公式预测 ${fmt(median(finalRows.map((r) => r.cbPredictedMin)))} m`);
console.log(`  实测位置（非目标）深度中位：${fmt(median(finalRows.map((r) => r.cbActualDepth)))} m`);

// —— 2. 各条线是否随球前压 ——
console.log("\n--- 2. 各条线深度 vs 球的推进深度：相关性 / 回归斜率 ---");
console.log("  （斜率 = 球每多推进 1 m，该线目标位多前压多少 m；真实球队应接近 1，全队一起移动）");
const line = (label, key) => {
  const all = rows.filter((r) => Number.isFinite(r[key]));
  const fin = finalRows.filter((r) => Number.isFinite(r[key]));
  const xsAll = all.map((r) => r.ballDepth);
  const xsFin = fin.map((r) => r.ballDepth);
  console.log(
    `  ${label.padEnd(22)}全场 corr ${fmt(correlation(xsAll, all.map((r) => r[key])), 3).padStart(7)}` +
    `  斜率 ${fmt(slope(xsAll, all.map((r) => r[key])), 3).padStart(7)}` +
    `  |  进攻三区 corr ${fmt(correlation(xsFin, fin.map((r) => r[key])), 3).padStart(7)}` +
    `  斜率 ${fmt(slope(xsFin, fin.map((r) => r[key])), 3).padStart(7)}`
  );
};
line("中卫线 (CB, 最深)", "cbTargetDepth");
line("中卫线 (CB, 中位)", "cbMedianTargetDepth");
line("边卫线 (FB)", "fbDepth");
line("中场线 (MID)", "midDepth");
line("锋线 (ATT)", "attDepth");

// —— 3. 按球的推进深度分桶：看中卫线是不是平的 ——
console.log("\n--- 3. 按球的推进深度分桶（m），看各线目标深度怎么变 ---");
const buckets = [[0, 20], [20, 35], [35, 52.5], [52.5, 70], [70, 85], [85, 105]];
console.log("  " + "球推进深度".padEnd(16) + "队帧".padStart(8) + "CB最深".padStart(9) +
  "FB".padStart(8) + "MID".padStart(8) + "ATT".padStart(8) + "  DEF→ATT 跨度");
for (const [lo, hi] of buckets) {
  const bucket = rows.filter((r) => r.ballDepth >= lo && r.ballDepth < hi);
  if (bucket.length < 20) continue;
  const cb = median(bucket.map((r) => r.cbTargetDepth));
  const fb = median(bucket.map((r) => r.fbDepth));
  const mid = median(bucket.map((r) => r.midDepth));
  const att = median(bucket.map((r) => r.attDepth));
  console.log(
    `  ${`${lo}–${hi}`.padEnd(16)}${String(bucket.length).padStart(8)}` +
    `${fmt(cb).padStart(9)}${fmt(fb).padStart(8)}${fmt(mid).padStart(8)}${fmt(att).padStart(8)}` +
    `  ${fmt(att - cb)}`
  );
}

console.log("\n读法：若「CB 最深」一列随球推进很快**饱和**（斜率 ≈ 0）而 FB/MID/ATT 继续变大，");
console.log("      则病因定位到 `_chooseAttackOffBallTarget` 的中卫分支（`engine.js:3788-3793`）——");
console.log("      中卫的纵向目标是**与球位无关的常量** `baseY + dir*7`（4-3-3 → 33.6 m），球队没有整体前压。");
const saturate = buckets.filter(([lo]) => lo >= 70);
if (saturate.length) {
  const rowsSat = rows.filter((r) => r.ballDepth >= 70);
  console.log(`\n参考：球推进 ≥70 m 时（${rowsSat.length} 队帧）——CB 最深 ${fmt(median(rowsSat.map((r) => r.cbTargetDepth)))} m / ` +
    `ATT ${fmt(median(rowsSat.map((r) => r.attDepth)))} m。`);
  console.log("      若真实球队的块长是 30–40 m，则 CB 线应在 ~56–66 m，即**缺约 22–32 m 的整体前压**。");
}
