/**
 * 进攻三区「队形长度」拆解探针 —— 回答「剩下这 55.7 m 跨度是谁贡献的」。
 *
 * 背景：`scripts/attack-shape-compaction-audit.mjs` 量到进攻三区长度 59.0 m
 * （`backLine` 38.4 / `forwardTop` 94.0 / `span` 55.7），而
 * `scripts/_attack-block-shift-probe.mjs` 在**只统计控球方 + 只看中卫 + 用目标位** 的口径下
 * 量到中卫线 50.9 m。两个数字差 12 m，必须定位，否则无法判断下一步该改哪里。
 *
 * 本探针**完全复刻审计的采样口径**（两队都算、不按控球过滤、用实际位置 `a.y`、
 * `role !== "GK"`），但把后防线拆成中卫 / 边卫两段，并按控球状态与球深度分桶，
 * 从而回答三个问题：
 *   1. `backLine` 38.4 m 到底是中卫站的位置，还是某条边卫拖在后面的位置？
 *   2. 不按控球过滤，是否把「非控球方在进攻三区」的帧混了进来？
 *   3. 剩下的跨度是「后卫线不够高」还是「锋线站得太深」？
 *
 * 只读引擎公开状态，不改任何东西。用法：
 *   node scripts/_attack-block-length-breakdown-probe.mjs [standard|background]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const PROFILE = process.argv[2] === "background" ? "background" : "standard";
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05 m / y 格
const SAMPLE_STEPS = 5; // 与审计一致：每 0.5 秒
const SEEDS = [372000, 372001, 372002, 372003]; // 与审计同种子

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
      formation: "4-3-3", lineup: players.map((player) => player.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

const median = (values) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");

/** 与审计 `isFullback` 同口径：优先看 detailedPosition，否则按横向槽位判 */
function isFullback(agent) {
  if (agent.detailedPosition === "LB" || agent.detailedPosition === "RB") return true;
  if (agent.detailedPosition === "CB") return false;
  const x = agent.slotX != null ? agent.slotX : agent.baseX;
  return agent.role === "DEF" && (x < 30 || x > 70);
}

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

    const live = engine.agents.filter((agent) => !agent.sentOff);
    const ownerTeam = engine.ball.owner
      ? (String(engine.ball.owner).startsWith("home") ? "home" : "away")
      : null;

    for (const team of ["home", "away"]) {
      const squad = live.filter((agent) => agent.team === team);
      if (squad.length < 7) continue;
      const outfield = squad.filter((agent) => agent.role !== "GK");
      if (outfield.length < 7) continue;

      // 审计口径：球在该队进攻方向的前 1/3
      const ballL = engine.ball.y * MY;
      const progress = team === "home"
        ? (SIM.PITCH_H_METRES - ballL) / SIM.PITCH_H_METRES
        : ballL / SIM.PITCH_H_METRES;
      if (!(progress > 2 / 3)) continue; // 只看进攻三区

      const ownGoalL = team === "home" ? SIM.PITCH_H_METRES : 0;
      const depthOf = (agent) => Math.abs(agent.y * MY - ownGoalL);

      const defs = squad.filter((agent) => agent.role === "DEF");
      const cbs = defs.filter((agent) => !isFullback(agent));
      const fbs = defs.filter((agent) => isFullback(agent));
      const atts = squad.filter((agent) => agent.role === "ATT");
      if (!cbs.length || !atts.length) continue;

      const outfieldDepths = outfield.map(depthOf);
      const fbDepths = fbs.map(depthOf).sort((a, b) => a - b);
      const fbTargets = fbs.map((a) => Math.abs(a.ty * MY - ownGoalL)).sort((a, b) => a - b);
      // 边卫分化：最深那名边卫的「球侧」判定（横向离球更近 = 球侧）
      let ballSideFB = NaN;
      let farSideFB = NaN;
      if (fbs.length >= 2) {
        const sorted = [...fbs].sort((a, b) => Math.abs(a.x - engine.ball.x) - Math.abs(b.x - engine.ball.x));
        ballSideFB = depthOf(sorted[0]);
        farSideFB = depthOf(sorted[sorted.length - 1]);
      }

      rows.push({
        team, seed, progress,
        inPossession: ownerTeam === team,
        ballDepth: Math.abs(engine.ball.y * MY - ownGoalL),
        outfieldSpan: Math.max(...outfieldDepths) - Math.min(...outfieldDepths),
        backLineAll: Math.min(...defs.map(depthOf)),      // 审计 `attackBackLine`
        cbDeep: Math.min(...cbs.map(depthOf)),
        cbDeepTarget: Math.min(...cbs.map((a) => Math.abs(a.ty * MY - ownGoalL))),
        cbMedian: median(cbs.map(depthOf)),
        fbDeep: fbs.length ? fbDepths[0] : NaN,
        fbTop: fbs.length ? fbDepths[fbDepths.length - 1] : NaN,
        fbDeepTarget: fbTargets.length ? fbTargets[0] : NaN,
        fbTopTarget: fbTargets.length ? fbTargets[fbTargets.length - 1] : NaN,
        fbMedian: fbs.length ? median(fbs.map(depthOf)) : NaN,
        ballSideFB, farSideFB,
        forwardTop: Math.max(...atts.map(depthOf)),       // 审计 `attackForwardTop`
        midMedian: median(squad.filter((a) => a.role === "MID").map(depthOf)),
      });
    }
  }
}

console.log(`\n=== 进攻三区队形长度拆解（${SEEDS.length} 场，种子 ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]}，${PROFILE} 档）===`);
console.log(`口径与 attack-shape-compaction-audit.mjs 完全一致：两队都算、不按控球过滤、用实际位置 a.y。`);
console.log(`共 ${rows.length} 队帧（球在该队进攻方向前 1/3）。\n`);

function report(label, set) {
  if (!set.length) {
    console.log(`--- ${label}：无样本 ---\n`);
    return;
  }
  const backAll = median(set.map((r) => r.backLineAll));
  const cb = median(set.map((r) => r.cbDeep));
  const cbT = median(set.map((r) => r.cbDeepTarget));
  const cbM = median(set.map((r) => r.cbMedian));
  const fb = median(set.map((r) => r.fbDeep));
  const fbT = median(set.map((r) => r.fbTop));
  const fbDT = median(set.map((r) => r.fbDeepTarget));
  const fbTT = median(set.map((r) => r.fbTopTarget));
  const fbM = median(set.map((r) => r.fbMedian));
  const fwd = median(set.map((r) => r.forwardTop));
  const span = median(set.map((r) => r.outfieldSpan));
  const ballSide = median(set.map((r) => r.ballSideFB).filter(Number.isFinite));
  const farSide = median(set.map((r) => r.farSideFB).filter(Number.isFinite));
  const backLineIsCB = set.filter((r) => Math.abs(r.backLineAll - r.cbDeep) < 1e-9).length;
  const fbsplit = set.filter((r) => Number.isFinite(r.fbTop) && Number.isFinite(r.fbDeep)
    && r.fbTop - r.fbDeep > 20).length;
  console.log(`--- ${label}（${set.length} 队帧）---`);
  console.log(`  审计 backLine（min DEF，实际位）      ${fmt(backAll)} m`);
  console.log(`    其中中卫最深（min CB）              ${fmt(cb)} m   ← 中卫目标位 ${fmt(cbT)} m / 中卫中位 ${fmt(cbM)} m`);
  console.log(`    其中边卫最深（min FB）              ${fmt(fb)} m   ← 边卫目标位 ${fmt(fbDT)} m / 边卫中位 ${fmt(fbM)} m`);
  console.log(`  边卫最浅（max FB）                    ${fmt(fbT)} m   ← 边卫目标位 ${fmt(fbTT)} m`);
  console.log(`    两名边卫深度差 >20 m 的队帧占比      ${(100 * fbsplit / set.length).toFixed(1)}%`);
  console.log(`    球侧边卫中位 ${fmt(ballSide)} m / 远侧边卫中位 ${fmt(farSide)} m`);
  console.log(`  forwardTop（max ATT）                 ${fmt(fwd)} m`);
  console.log(`  队形跨度（outfield max−min，逐帧中位） ${fmt(span)} m`);
  console.log(`  「backLine 就是中卫」的队帧占比        ${(100 * backLineIsCB / set.length).toFixed(1)}%`);
  console.log("");
}

report("全部进攻三区帧", rows);
report("其中：本方控球", rows.filter((r) => r.inPossession));
report("其中：本方未控球", rows.filter((r) => !r.inPossession));

console.log("--- 按球的深度分桶（仅本方控球帧，与实际比赛口径更接近）---");
const poss = rows.filter((r) => r.inPossession);
const buckets = [[70, 85], [85, 105]];
console.log(`  球深度        队帧    CB最深  CB目标   FB中位   MID中位  ATT最高   跨度`);
for (const [lo, hi] of buckets) {
  const b = poss.filter((r) => r.ballDepth >= lo && r.ballDepth < hi);
  if (b.length < 20) continue;
  console.log(
    `  ${`${lo}–${hi}`.padEnd(12)}${String(b.length).padStart(6)}` +
    `${fmt(median(b.map((r) => r.cbDeep))).padStart(9)}` +
    `${fmt(median(b.map((r) => r.cbDeepTarget))).padStart(9)}` +
    `${fmt(median(b.map((r) => r.fbMedian))).padStart(9)}` +
    `${fmt(median(b.map((r) => r.midMedian))).padStart(9)}` +
    `${fmt(median(b.map((r) => r.forwardTop))).padStart(9)}` +
    `${fmt(median(b.map((r) => r.outfieldSpan))).padStart(8)}`
  );
}

// 主客对称性：客队的 baseY 经 `slotToPitch(slot, false)` 镜像、`dir` 取反，
// 所以 `blockForward = -dir * blockShiftY` 在两队应给出镜像的相同深度。
// 这里直接对比，任何符号错误（例如把 `-dir` 写成 `+dir`）都会在这里暴露。
console.log("\n--- 主客对称性检查（本方控球帧，同口径）---");
for (const [label, set] of [
  ["主队 home", poss.filter((r) => r.team === "home")],
  ["客队 away", poss.filter((r) => r.team === "away")],
]) {
  if (!set.length) {
    console.log(`  ${label}：无样本`);
    continue;
  }
  console.log(
    `  ${label.padEnd(12)} 队帧 ${String(set.length).padStart(6)}` +
    `  CB最深 ${fmt(median(set.map((r) => r.cbDeep)))}` +
    `  远侧FB ${fmt(median(set.map((r) => r.farSideFB).filter(Number.isFinite)))}` +
    `  ATT最高 ${fmt(median(set.map((r) => r.forwardTop)))}` +
    `  跨度 ${fmt(median(set.map((r) => r.outfieldSpan)))} m`
  );
}

console.log(`\n参考：审计口径进攻三区队形跨度 = ${fmt(median(rows.map((r) => r.outfieldSpan)))} m；`);
console.log(`      目标区间 30–40 m（AGENTS.md 的估计真实块长）。`);
console.log(`      队形跨度均值 ${fmt(mean(rows.map((r) => r.outfieldSpan)))} m（中位与均值差别大说明分布长尾）。`);
