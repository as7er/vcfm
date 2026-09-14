/**
 * 把 FM26 的队形参照值变成**引擎侧可复现**的测量（诊断脚本，不进 verify）。
 *
 * 为什么需要它：`AGENTS.md` 里那组 FM26 对照值（覆盖面积 1821 m²、横向宽度 35.8 m、
 * 纵向铺开 27.2 m、最近队友距离 7.26 m）是 2026-09-01 从**两段录屏**里量出来的，
 * 素材在另一台机器上、且 FM 侧球员检测只到 14/22 人。它是一次性估计，
 * 不能当回归目标——`AGENTS.md:1764` 建议过把它做成审计断言，但缺的正是**引擎侧那一半**。
 * 本脚本补的就是这一半。
 *
 * ⚠ 三条必须知道的口径差异（否则会拿不可比的数字对账）：
 *   1. FM26 那组数字**来自两个不同脚本、两套口径**：
 *        · 纵向铺开 p90−p10（27.2）来自 `cmp6_robust.py`：**剔除门将带**（距球门线 8m 内）、
 *          用分位距代替极值。
 *        · 横向宽度（35.8）、覆盖面积（1821）、禁区内人数（1.0）来自 `cmp5_shape.py`：
 *          **用 max−min 且不剔门将**。
 *      所以本脚本**两种口径都算**（`all` / `noGK` × `max−min` / `p90−p10`），
 *      对账时挑同口径的那一格，不要混用。
 *   2. 视频侧「最近队友距离」（7.26）来自 `cmp4_metrics.py`，定义是**全场所有检出点的
 *      最近邻**（不分队），且那份脚本的分队算法后来被证有 bug。本脚本按**同队**最近邻算，
 *      并同时给出「全场最近邻」供对照。
 *   3. 视频侧检测不完整（FM 14/22、VCFM 17/22），**绝对值不可当精确数**；
 *      引擎侧是精确值，所以引擎侧的绝对值与 FM26 的估计值**天然不可逐位相等**，
 *      只有**比例与量级**可比。
 *   4. ⚠ **cmp6 的「8 m 门将带」在 VCFM 里几乎剔不掉门将**（本脚本 2026-09-13 实测：
 *      门将距己方门线深度中位 7.5 m、p90 9.0 m，正好压在 8 m 边界上，
 *      于是 **47.9% 的队帧里门将仍在样本内**）。引擎侧有精确 `role`，
 *      所以本脚本**同时**给出两个 noGK 口径：
 *        · `role` —— 按 `role !== "GK"` 剔除（**引擎侧应以此为准**，精确）；
 *        · `band` —— 按 8 m 门将带剔除（仅用于与 cmp6 的 27.2 m 严格同口径对账）。
 *      两者对**全场 p90−p10** 影响很小（分位距本就削极值），但对**三区 max−min** 影响很大
 *      （进攻三区 band 口径 83.9 m vs role 口径 60.0 m，差的 24 m 就是门将）。
 *
 * 口径与仓库其它探针一致：种子 372000..、标准档、`SIM.DT`、`separationPasses: 8`、
 * 每 0.5 秒采样。全程只读引擎公开状态，不消费随机数。
 *
 * 用法：node scripts/_fm26-shape-gap-probe.mjs [场数] [standard|background]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MX = SIM.PITCH_W_METRES / SIM.FIELD_W; // 0.68 m / x 格
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05 m / y 格
const GK_BAND_M = 8;      // cmp6 的门将带：距任一球门线 8m 内剔除（⚠ 见下方 caveat）
const BOX_DEPTH_M = 16.5;
const BOX_WIDTH_M = 40.32;
const SAMPLE_STEPS = 5;   // 每 5 步 = 0.5 秒
const STILL_MPS = 1.0;    // 与视频侧「近静止 <1 m/s」同口径

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

const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i];
};
const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** 一个点集的队形指标（长度轴 = y×1.05，宽度轴 = x×0.68） */
function shapeOf(points) {
  const ls = points.map((p) => p.y * MY).sort((a, b) => a - b);
  const ws = points.map((p) => p.x * MX).sort((a, b) => a - b);
  const lenMM = ls[ls.length - 1] - ls[0];
  const widMM = ws[ws.length - 1] - ws[0];
  return {
    lenMM,
    widMM,
    lenQ: percentile(ls, 0.9) - percentile(ls, 0.1),
    widQ: percentile(ws, 0.9) - percentile(ws, 0.1),
    areaMM: lenMM * widMM,
    centroid: ls.reduce((a, b) => a + b, 0) / ls.length,
    box: points.filter((p) => {
      const L = p.y * MY;
      const W = p.x * MX;
      const inWidth = W >= (SIM.PITCH_W_METRES - BOX_WIDTH_M) / 2 &&
        W <= (SIM.PITCH_W_METRES + BOX_WIDTH_M) / 2;
      return inWidth && (L <= BOX_DEPTH_M || L >= SIM.PITCH_H_METRES - BOX_DEPTH_M);
    }).length,
  };
}

/** 最近邻距离：同队最近邻 + 全场最近邻（cmp4 的口径） */
function nearestDistances(points, allPoints) {
  let sameTeamMin = Infinity;
  let anyMin = Infinity;
  for (const p of points) {
    for (const q of allPoints) {
      if (q === p) continue;
      const d = Math.hypot((p.x - q.x) * MX, (p.y - q.y) * MY);
      if (d < anyMin) anyMin = d;
      if (q.team === p.team && d < sameTeamMin) sameTeamMin = d;
    }
  }
  return { sameTeamMin, anyMin };
}

const matchCount = Math.max(1, Number(process.argv[2]) || 6);
const profile = process.argv[3] === "background" ? "background" : "standard";
const seeds = Array.from({ length: matchCount }, (_, i) => 372000 + i);
const timeStep = profile === "background" ? 0.3 : SIM.DT;
const separationPasses = profile === "background" ? 4 : 8;

const acc = {
  all: { lenMM: [], widMM: [], lenQ: [], widQ: [], areaMM: [], box: [] },
  noGK: { lenMM: [], widMM: [], lenQ: [], widQ: [], areaMM: [], box: [] },      // role 口径（引擎侧准）
  noGKband: { lenMM: [], widMM: [], lenQ: [], widQ: [], areaMM: [], box: [] },  // 8m 带口径（对 cmp6）
  nnSame: [], nnAny: [],
  centroids: { all: new Map(), role: new Map(), band: new Map() }, // 口径 -> team -> [mean length]
  speeds: [], ownerOrGkExcluded: 0,
  gkBandMissed: 0, gkFrames: 0, gkDepths: [],  // 门将带命中率自检
  // 按控球所在三区分解（`AGENTS.md:3105` 记进攻三区 58.9m，本区复测）
  // 同时记 all / role-noGK / band-noGK 三口径：v238 的 58.9/39.5/41.9 是**剔门将带**口径，
  // all 口径会被门将钉在己方门线附近而虚高（进攻三区 all 85.4 vs role-noGK 60.0）。
  phase: {
    own: { lenMM: [], lenQ: [], lenMMnoGK: [], lenMMband: [] },
    middle: { lenMM: [], lenQ: [], lenMMnoGK: [], lenMMband: [] },
    attack: { lenMM: [], lenQ: [], lenMMnoGK: [], lenMMband: [] },
  },
  attackBackLine: [],   // 进攻三区：最后一名后卫距己方球门线的深度 (m)
  attackForwardTop: [], // 进攻三区：最靠前前锋距己方球门线的深度 (m)
};
const bumpCentroid = (kind, team, value) => {
  const m = acc.centroids[kind];
  const list = m.get(team) || [];
  list.push(value);
  m.set(team, list);
};

for (const seed of seeds) {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, 15),
      makeClub(`away-${seed}`, 15),
      { simulationProfile: profile, timeStep, separationPasses }
    );
    const steps = Math.round((90 * 60) / timeStep);
    const prev = new Map();

    for (let step = 0; step < steps; step++) {
      engine.step(timeStep);
      const ownerId = engine.ball.owner;

      // —— 速度 / 近静止（排除门将与持球人，与 _player-stillness-probe 同口径）——
      for (const p of engine.agents) {
        if (p.sentOff) { prev.delete(p.id); continue; }
        const last = prev.get(p.id);
        prev.set(p.id, { x: p.x, y: p.y });
        if (!last) continue;
        if (p.role === "GK" || p.id === ownerId) { acc.ownerOrGkExcluded++; continue; }
        acc.speeds.push(Math.hypot((p.x - last.x) * MX, (p.y - last.y) * MY) / timeStep);
      }

      if (step % SAMPLE_STEPS !== 0) continue;

      const live = engine.agents.filter((a) => !a.sentOff);
      for (const team of ["home", "away"]) {
        const squad = live.filter((a) => a.team === team);
        if (squad.length < 7) continue;
        // noGK(role)：按角色精确剔除门将 —— 引擎侧应以此为准
        const noGK = squad.filter((p) => p.role !== "GK");
        // noGK(band)：cmp6 的 8m 门将带（⚠ 在 VCFM 里只是抛硬币，见头注释 caveat 4）
        const band = squad.filter((p) => {
          const L = p.y * MY;
          return L > GK_BAND_M && L < SIM.PITCH_H_METRES - GK_BAND_M;
        });
        // 自检：band 口径下门将是否被漏掉
        const gk = squad.filter((p) => p.role === "GK");
        if (gk.length) {
          acc.gkFrames++;
          acc.gkDepths.push(...gk.map((g) => (team === "home" ? SIM.PITCH_H_METRES - g.y * MY : g.y * MY)));
          if (band.some((p) => p.role === "GK")) acc.gkBandMissed++;
        }

        if (noGK.length >= 7) {
          const s = shapeOf(noGK);
          acc.noGK.lenMM.push(s.lenMM); acc.noGK.widMM.push(s.widMM);
          acc.noGK.lenQ.push(s.lenQ); acc.noGK.widQ.push(s.widQ);
          acc.noGK.areaMM.push(s.areaMM); acc.noGK.box.push(s.box);
          bumpCentroid("role", team, s.centroid);
        }
        if (band.length >= 7) {
          const sb = shapeOf(band);
          acc.noGKband.lenMM.push(sb.lenMM); acc.noGKband.widMM.push(sb.widMM);
          acc.noGKband.lenQ.push(sb.lenQ); acc.noGKband.widQ.push(sb.widQ);
          acc.noGKband.areaMM.push(sb.areaMM); acc.noGKband.box.push(sb.box);
          bumpCentroid("band", team, sb.centroid);
        }
        // all：不剔门将（cmp5 的口径）
        const sAll = shapeOf(squad);
        acc.all.lenMM.push(sAll.lenMM); acc.all.widMM.push(sAll.widMM);
        acc.all.lenQ.push(sAll.lenQ); acc.all.widQ.push(sAll.widQ);
        acc.all.areaMM.push(sAll.areaMM); acc.all.box.push(sAll.box);
        bumpCentroid("all", team, sAll.centroid);

        const nn = nearestDistances(squad, live);
        if (Number.isFinite(nn.sameTeamMin)) acc.nnSame.push(nn.sameTeamMin);
        if (Number.isFinite(nn.anyMin)) acc.nnAny.push(nn.anyMin);

        // —— 按控球所在三区分解 ——
        // 「进攻三区」= 球在该队进攻方向的最后 1/3 场地；深度以**己方球门线**为 0。
        const ballL = engine.ball.y * MY;
        const ballProgress = team === "home"
          ? (SIM.PITCH_H_METRES - ballL) / SIM.PITCH_H_METRES
          : ballL / SIM.PITCH_H_METRES;
        const phase = ballProgress < 1 / 3 ? "own" : ballProgress > 2 / 3 ? "attack" : "middle";
        const bucket = acc.phase[phase];
        bucket.lenMM.push(sAll.lenMM);
        bucket.lenQ.push(sAll.lenQ);
        if (noGK.length >= 7) bucket.lenMMnoGK.push(shapeOf(noGK).lenMM);
        if (band.length >= 7) bucket.lenMMband.push(shapeOf(band).lenMM);        if (phase === "attack") {
          const ownGoalL = team === "home" ? SIM.PITCH_H_METRES : 0;
          const depthOf = (p) => Math.abs(p.y * MY - ownGoalL);
          const defDepths = squad.filter((p) => p.role === "DEF").map(depthOf);
          const attDepths = squad.filter((p) => p.role === "ATT").map(depthOf);
          // 最后一名后卫 = 离己方球门线最近者（深度最小）
          if (defDepths.length) acc.attackBackLine.push(Math.min(...defDepths));
          // 最靠前的前锋（深度最大）
          if (attDepths.length) acc.attackForwardTop.push(Math.max(...attDepths));
        }
      }
    }
  } finally {
    Math.random = original;
  }
}

// FM26 参照值（AGENTS.md「交接（2026-09-01）」），并标注其口径来源
const FM26 = {
  speedMedian: 2.75,          // cmp7（剔慢镜）
  stillSharePct: 16.2,        // cmp7
  lenQ: 27.2,                 // cmp6：剔门将带 + p90−p10
  widMM: 35.8,                // cmp5：不剔门将 + max−min
  areaMM: 1821,               // cmp5：不剔门将 + max−min
  nnAny: 7.26,                // cmp4：全场最近邻
  box: 1.0,                   // cmp5
  centroidStd: 15.5,          // cmp6
};

const fmt = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : "-");
const centroidStd = (() => {
  const out = {};
  for (const [kind, m] of Object.entries(acc.centroids)) {
    const stds = [];
    for (const list of m.values()) {
      if (list.length < 10) continue;
      const mean = list.reduce((a, b) => a + b, 0) / list.length;
      stds.push(Math.sqrt(list.reduce((a, b) => a + (b - mean) ** 2, 0) / list.length));
    }
    out[kind] = stds.length ? stds.reduce((a, b) => a + b, 0) / stds.length : NaN;
  }
  return out;
})();

const speedMedian = median(acc.speeds);
const stillSharePct = 100 * acc.speeds.filter((s) => s < STILL_MPS).length /
  Math.max(1, acc.speeds.length);

console.log(`\n=== FM26 队形参照 vs 引擎侧实测（${seeds.length} 场，种子 ${seeds[0]}..${seeds[seeds.length - 1]}，${profile} 档）===`);
console.log("读法：FM26 列是**录屏估计**（检测率 FM 14/22），引擎侧是精确值；只比比例与量级。\n");

const row = (label, vcfm, fm26, note) =>
  `  ${label.padEnd(34)}${String(vcfm).padStart(9)}${String(fm26).padStart(9)}   ${note}`;
console.log("  " + "指标".padEnd(32) + "VCFM".padStart(9) + "FM26".padStart(9) + "   口径");

console.log(row("位移速度中位 (m/s)", fmt(speedMedian, 2), fmt(FM26.speedMedian, 2),
  "cmp7：剔慢镜、剔门将+持球人"));
console.log(row("近静止 <1m/s 占比 (%)", fmt(stillSharePct), fmt(FM26.stillSharePct), "cmp7 同口径"));
console.log(row("纵向铺开 p90−p10 (m) [role-noGK]", fmt(median(acc.noGK.lenQ)), fmt(FM26.lenQ),
  "★按 role 剔门将（引擎侧准）"));
console.log(row("纵向铺开 p90−p10 (m) [band-noGK]", fmt(median(acc.noGKband.lenQ)), fmt(FM26.lenQ),
  "★cmp6 同口径（8m 带，会漏门将）"));
console.log(row("纵向铺开 max−min (m) [all]", fmt(median(acc.all.lenMM)), "-", "cmp5 口径对照"));
console.log(row("横向宽度 max−min (m) [all]", fmt(median(acc.all.widMM)), fmt(FM26.widMM),
  "★cmp5 同口径（不剔门将）"));
console.log(row("横向宽度 p90−p10 (m) [role-noGK]", fmt(median(acc.noGK.widQ)), "-", "分位距对照"));
console.log(row("覆盖面积 max−min (m²) [all]", fmt(median(acc.all.areaMM), 0), fmt(FM26.areaMM, 0),
  "★cmp5 同口径"));
console.log(row("最近邻距离 同队 (m)", fmt(median(acc.nnSame), 2), "-", "本脚本定义"));
console.log(row("最近邻距离 全场 (m)", fmt(median(acc.nnAny), 2), fmt(FM26.nnAny),
  "★cmp4 同口径（不分队）"));
console.log(row("单队禁区内人数 [all]", fmt(median(acc.all.box), 2), fmt(FM26.box, 1), "cmp5 口径"));
console.log(row("球队重心长向标准差 [role]", fmt(centroidStd.role), fmt(FM26.centroidStd),
  "★按 role 剔门将（引擎侧准）"));
console.log(row("球队重心长向标准差 [band]", fmt(centroidStd.band), fmt(FM26.centroidStd),
  "★cmp6 同口径（8m 带，会漏门将）"));

console.log(`\n样本：速度 ${acc.speeds.length} 次（已排除 ${acc.ownerOrGkExcluded} 个门将/持球人采样）`);
console.log(`      队帧 all ${acc.all.lenMM.length} / role-noGK ${acc.noGK.lenMM.length} / band-noGK ${acc.noGKband.lenMM.length}`);
// 门将带自检
acc.gkDepths.sort((a, b) => a - b);
const gkQ = (p) => acc.gkDepths[Math.min(acc.gkDepths.length - 1, Math.floor(acc.gkDepths.length * p))];
console.log(`      门将带自检：门将距己方门线中位 ${fmt(gkQ(0.5))} m / p90 ${fmt(gkQ(0.9))} m；` +
  `band 口径漏掉门将的队帧 ${acc.gkBandMissed}/${acc.gkFrames} (${fmt(100 * acc.gkBandMissed / Math.max(1, acc.gkFrames))}%)`);

// —— 按控球三区分解：验证 `AGENTS.md:3105` 的「纵向拉长只发生在进攻三区」 ——
// 深度以己方球门线为 0。三列口径：all max−min（含门将，会虚高）/ noGK max−min / noGK p90−p10。
const phaseOf = (key) => ({
  lenAll: median(acc.phase[key].lenMM),
  lenNoGK: median(acc.phase[key].lenMMnoGK),
  lenBand: median(acc.phase[key].lenMMband),
  lenQ: median(acc.phase[key].lenQ),
  n: acc.phase[key].lenMM.length,
});
const own = phaseOf("own");
const mid = phaseOf("middle");
const att = phaseOf("attack");
console.log("\n--- 按控球三区分解球队纵向长度（m）---");
const prow = (label, a, b, c, d, note) =>
  `  ${label.padEnd(26)}${String(a).padStart(10)}${String(b).padStart(12)}${String(c).padStart(12)}${String(d).padStart(12)}   ${note || ""}`;
console.log("  " + "控球区域".padEnd(25) + "all".padStart(10) + "role-noGK".padStart(12) +
  "band-noGK".padStart(12) + "noGK p90−p10".padStart(12) + "   队帧数");
console.log(prow("己方三区 (own third)", fmt(own.lenAll), fmt(own.lenNoGK), fmt(own.lenBand), fmt(own.lenQ), `n=${own.n}`));
console.log(prow("中场三区 (middle third)", fmt(mid.lenAll), fmt(mid.lenNoGK), fmt(mid.lenBand), fmt(mid.lenQ), `n=${mid.n}`));
console.log(prow("进攻三区 (attacking third)", fmt(att.lenAll), fmt(att.lenNoGK), fmt(att.lenBand), fmt(att.lenQ), `n=${att.n}`));
console.log(prow("进攻三区 / 己方三区",
  fmt(own.lenAll > 0 ? att.lenAll / own.lenAll : NaN, 2),
  fmt(own.lenNoGK > 0 ? att.lenNoGK / own.lenNoGK : NaN, 2),
  fmt(own.lenBand > 0 ? att.lenBand / own.lenBand : NaN, 2),
  fmt(own.lenQ > 0 ? att.lenQ / own.lenQ : NaN, 2), ">1 表示越往前越散"));

// 进攻三区内的纵深：最后一名后卫 / 最靠前前锋距己方球门线的距离
const backLine = median(acc.attackBackLine);
const forwardTop = median(acc.attackForwardTop);
console.log("\n--- 进攻三区内纵深（距**己方**球门线，m）---");
console.log(row("最后一名后卫深度 (min DEF)", fmt(backLine), "-", `n=${acc.attackBackLine.length}`));
console.log(row("最靠前前锋深度 (max ATT)", fmt(forwardTop), "-", `n=${acc.attackForwardTop.length}`));
console.log(row("进攻三区内前后跨度 (ATT−DEF)", fmt(forwardTop - backLine), "-",
  ">30 说明后卫线没跟上进攻"));
console.log("\n  参照：4-3-3 静态模板 DEF=26.25m / ATT=86.10m / 全队长度 59.85m（js/data.js:775）。");
console.log("  `AGENTS.md:3105` 记进攻三区 58.9m / 己方 39.5m / 中场 41.9m（**剔门将带**口径）——");
console.log(`  与上表 band-noGK 列对照 → 本区复测：进攻三区 ${fmt(att.lenBand)} / 己方 ${fmt(own.lenBand)} / 中场 ${fmt(mid.lenBand)}；`);
console.log(`  role-noGK 列（引擎侧准）：进攻三区 ${fmt(att.lenNoGK)} / 己方 ${fmt(own.lenNoGK)} / 中场 ${fmt(mid.lenNoGK)}。`);

console.log("\n⚠ 引擎侧是精确值、FM26 是 14/22 检出率的录屏估计，**绝对值不可逐位对账**；");
console.log("  且 FM26 那组数来自两套口径（见脚本头注释），对账只挑 ★ 标注的同口径行。");
console.log("  ⚠ cmp6 的 8m 门将带在 VCFM 里只剔掉约一半（见头注释 caveat 4），band 列偏大属口径伪影。");
