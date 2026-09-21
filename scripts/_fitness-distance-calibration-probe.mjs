/**
 * 中场体能「按跑动距离分摊」—— 跑动距离的**噪声标定**（2026-09-21）
 *
 * ## 为什么要有这个探针
 *
 * 已实测：引擎内 `agent.fitness` 的个体 spread 只有 0.39（总耗 4.84）⇒
 * 「读 agent.fitness 回写」修不好「中场全队同值」的症状（详见
 * `docs/measurements/halftime-fitness-per-player-2026-09-21.txt`）。
 * 替代方案是**按本场累计跑动距离占比分摊球队总耗能**。
 *
 * 按项目纪律，新指标**一开始就要配护栏**，而护栏带宽必须由**实测批间 SD** 决定
 * （不是拍脑袋、也不是拿几个历史点手画一条带）。本探针就是那个噪声标定：
 * 跑 N 场**互不重叠种子**，测队内跑动距离 `max/min` 比值的批间标准差。
 *
 * ## 口径（照抄生产，不能改）
 *
 * - 步长用 `eng.timeStep`（标准档 = `SIM.DT` = **0.1s**）。
 *   ⚠ 不要为了跑得快改大：`_activeStepDt` 会影响 `samplingReach` / `stallLimit` /
 *   `contactStep` ⇒ **改步长等于换了一套物理**，标定就不代表生产了。
 * - 米制换算与引擎 `pitchDistanceMetres` 完全一致：
 *   `hypot(dx * 68/100, dy * 105/100)`（内部 100×100 ↔ 球场 68m × 105m）。
 * - 只读：不插桩、不写回 `player.fitness`、不消费引擎随机数之外的任何东西。
 *
 * ## 用法
 *
 *   node scripts/_fitness-distance-calibration-probe.mjs [场数=8] [种子基=900000]
 *
 * 批的定义：**一场比赛**为一批，批内取主客两队各自的读数（两支球队是同一场比赛下的
 * 两个独立个体）。批间统计用 **n-1** 标准差。
 *
 * ⚠ 探针口径提醒：本探针的球队是「固定阵容 + 固定属性档」，只有种子在变 ——
 *   这正是护栏该用的口径（控制变量），不要拿它去代表「全联赛平均」。
 */

import { defaultTactics, ensureFootballProfile } from "../js/models.js";
import { generatePlayerAttributes } from "../js/player-attributes.js";
import { createMatchSession } from "../js/match.js";
import { ensureSimEngine } from "../js/sim/adapt.js";

const M_PER_X = 68 / 100; // 引擎 x = 球场宽度轴（边线）
const M_PER_Y = 105 / 100; // 引擎 y = 球场长度轴（球门线）

const MATCHES = Math.max(1, Number(process.argv[2]) || 8);
const SEED_BASE = Number(process.argv[3]) || 900000;

function player(id, pos, ovr, fitness = 90) {
  return {
    id, name: id, pos, ovr, potential: ovr + 1, age: 27,
    fitness, morale: 70, injured: 0, suspendedMatches: 0, attrs: {},
  };
}

function squad() {
  const players = [player("gk", "GK", 14), player("gk2", "GK", 13)];
  for (let i = 0; i < 7; i++) players.push(player(`d${i}`, "DEF", +(16 - i * 0.3).toFixed(2)));
  for (let i = 0; i < 8; i++) players.push(player(`m${i}`, "MID", +(16 - i * 0.25).toFixed(2)));
  for (let i = 0; i < 6; i++) players.push(player(`a${i}`, "ATT", +(16 - i * 0.4).toFixed(2)));
  // 完整属性：`ensureFootballProfile` **不生成 stamina**（全员默认 0.600 ⇒ 同值档），
  // 必须走 `generatePlayerAttributes`（新建世界同一条路径）。
  for (const p of players) {
    generatePlayerAttributes(p, p.ovr);
    ensureFootballProfile(p);
  }
  return players;
}

/**
 * ⚠ 显式指定首发：`defaultTactics().lineup` 是空数组，自动挑选实测**不会挑到门将**
 *   （会把一名后卫放到 GK 槽），于是「门将跑动 4.3km」测的是一个改行的后卫。
 *   行为上没错（引擎按 role 处理），但标定口径应该用真门将 ⇒ 这里手工指定。
 */
function lineupFor(players) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const pick = (prefix, n) =>
    Array.from({ length: n }, (_, i) => `${prefix}${i}`).filter((id) => byId.has(id));
  return ["gk", ...pick("d", 4), ...pick("m", 3), ...pick("a", 3)];
}

function buildWorld() {
  const home = squad();
  const away = squad();
  const club = {
    id: "user", name: "User", power: 70, players: home,
    tactics: { ...defaultTactics(), lineup: lineupFor(home) }, staff: {},
  };
  const opponent = {
    id: "opp", name: "Opponent", power: 65, players: away,
    tactics: { ...defaultTactics(), lineup: lineupFor(away) },
  };
  return { clubs: [club, opponent], userClubId: "user", season: 2026, day: 5 };
}

/** 跑上半场，累加每个 agent 的实际位移（米）。 */
function runHalf(seed) {
  const world = buildWorld();
  const fixture = { day: 5, home: "user", away: "opp", played: false, matchSeed: seed >>> 0 };
  const state = createMatchSession(world, fixture);
  ensureSimEngine(state);
  const eng = state.simEng;
  const step = eng.timeStep; // 生产同档：标准档 = SIM.DT = 0.1s

  // ⚠ Map 的键用 **agent 对象本身**，不要用 `a.id`：
  //   主客两队用同一个 `squad()` 生成 ⇒ **两队 id 完全相同**（gk/d0/.../a2），
  //   按 id 建键会互相覆盖 ⇒ 实测跑出「门将 45 分钟 964km」这种荒谬数。
  //   **数字荒谬时先怀疑键，不要怀疑引擎。**
  const prev = new Map();
  const dist = new Map();
  for (const a of eng.agents) {
    prev.set(a, { x: a.x, y: a.y });
    dist.set(a, 0);
  }

  const tEnd = 45 * 60;
  let guard = 0;
  const guardMax = Math.ceil((tEnd - eng.t) / step + 200);
  while (eng.t + 1e-9 < tEnd && guard < guardMax) {
    eng.step(Math.min(step, tEnd - eng.t));
    guard += 1;
    for (const a of eng.agents) {
      const p = prev.get(a);
      if (!p) continue;
      dist.set(a, dist.get(a) + Math.hypot((a.x - p.x) * M_PER_X, (a.y - p.y) * M_PER_Y));
      p.x = a.x;
      p.y = a.y;
    }
  }

  const teamOf = (tag) =>
    eng.agents
      .filter((a) => a.team === tag)
      .map((a) => ({
        id: a.id,
        role: a.role,
        km: dist.get(a) / 1000,
        fit: Number(a.fitness),
      }));
  return { steps: guard, step, home: teamOf("home"), away: teamOf("away") };
}

/** 从一支球队的逐人跑动距离算指标。 */
function metrics(rows) {
  const kms = rows.map((r) => r.km);
  const sum = kms.reduce((s, v) => s + v, 0);
  const mean = sum / (kms.length || 1);
  const lo = kms.reduce((m, v) => (v < m ? v : m), Infinity);
  const hi = kms.reduce((m, v) => (v > m ? v : m), -Infinity);
  // 队内离散度：样本标准差（n-1）
  const sd = Math.sqrt(
    kms.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, kms.length - 1)
  );
  const gk = rows.find((r) => r.role === "GK");
  const byRole = {};
  for (const r of rows) (byRole[r.role] = byRole[r.role] || []).push(r.km);
  const roleMean = {};
  for (const [role, arr] of Object.entries(byRole)) {
    roleMean[role] = arr.reduce((s, v) => s + v, 0) / arr.length;
  }
  return {
    n: kms.length,
    mean,
    sd,
    cv: mean > 0 ? sd / mean : 0,
    min: lo,
    max: hi,
    ratio: lo > 0 ? hi / lo : 0,
    gkKm: gk ? gk.km : NaN,
    gkShare: gk && mean > 0 ? gk.km / mean : NaN,
    roleMean,
  };
}

function stat(values) {
  const n = values.length;
  if (!n) return { n: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  const lo = values.reduce((m, v) => (v < m ? v : m), Infinity);
  const hi = values.reduce((m, v) => (v > m ? v : m), -Infinity);
  return { n, mean, sd, min: lo, max: hi };
}

console.log(`\n=== 跑动距离噪声标定：${MATCHES} 场（种子 ${SEED_BASE}..${SEED_BASE + MATCHES - 1}）===`);
const t0 = Date.now();
const perMatch = [];
const allTeams = [];
const teamRecords = [];
for (let i = 0; i < MATCHES; i++) {
  const seed = SEED_BASE + i;
  const half = runHalf(seed);
  const mh = metrics(half.home);
  const ma = metrics(half.away);
  perMatch.push({ seed, step: half.step, mh, ma });
  allTeams.push(mh, ma);
  teamRecords.push({ kms: half.home.map((r) => r.km) }, { kms: half.away.map((r) => r.km) });
  console.log(
    `  场 ${String(i + 1).padStart(2)} seed=${seed}  步长 ${half.step}s 步数 ${half.steps}  ` +
      `主 ratio ${mh.ratio.toFixed(2)} 均 ${mh.mean.toFixed(2)}km GK占比 ${(mh.gkShare * 100).toFixed(0)}%  |  ` +
      `客 ratio ${ma.ratio.toFixed(2)} 均 ${ma.mean.toFixed(2)}km GK占比 ${(ma.gkShare * 100).toFixed(0)}%`
  );
}
console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log(`\n=== 批间统计（每支球队一个观测，共 ${allTeams.length} 个）===`);
const ratios = allTeams.map((m) => m.ratio);
const means = allTeams.map((m) => m.mean);
const sds = allTeams.map((m) => m.sd);
const cvs = allTeams.map((m) => m.cv);
const gkShares = allTeams.map((m) => m.gkShare).filter((v) => Number.isFinite(v));

const sRatio = stat(ratios);
const sMean = stat(means);
const sSd = stat(sds);
const sCv = stat(cvs);
const sGk = stat(gkShares);

const fmt = (s, unit = "", digits = 3) =>
  `n=${s.n}  均值 ${s.mean.toFixed(digits)}${unit}  SD(n-1) ${s.sd.toFixed(digits)}${unit}  ` +
  `范围 ${s.min.toFixed(digits)} ~ ${s.max.toFixed(digits)}${unit}`;

console.log(`  队内 max/min 比值   : ${fmt(sRatio)}`);
console.log(`  球队场均跑动        : ${fmt(sMean, "km")}`);
console.log(`  队内 SD             : ${fmt(sSd, "km")}`);
console.log(`  队内 CV (=SD/均值)  : ${fmt(sCv)}`);
console.log(`  门将占球队均值的比  : ${fmt(sGk)}`);

// ⚠ 伪重复提醒：主客两队共享同一场比赛的条件 ⇒ 96 个「球队观测」不是 96 个独立样本。
//   护栏带宽必须用**以比赛为批单位**的 SD（下面这一组），球队级 SD 只作参考。
const perMatchRatio = perMatch.map((p) => (p.mh.ratio + p.ma.ratio) / 2);
const perMatchMean = perMatch.map((p) => (p.mh.mean + p.ma.mean) / 2);
const perMatchGk = perMatch
  .map((p) => (p.mh.gkShare + p.ma.gkShare) / 2)
  .filter((v) => Number.isFinite(v));
const sMRatio = stat(perMatchRatio);
const sMMean = stat(perMatchMean);
const sMGk = stat(perMatchGk);
console.log("\n  ── 以**比赛**为批单位（推荐用于护栏带宽）──");
console.log(`  队内 max/min 比值   : ${fmt(sMRatio)}`);
console.log(`  球队场均跑动        : ${fmt(sMMean, "km")}`);
console.log(`  门将占球队均值的比  : ${fmt(sMGk)}`);

console.log("\n  按角色均值（所有球队合并）：");
const roleAcc = {};
for (const m of allTeams) {
  for (const [role, v] of Object.entries(m.roleMean)) (roleAcc[role] = roleAcc[role] || []).push(v);
}
for (const [role, arr] of Object.entries(roleAcc)) {
  const s = stat(arr);
  console.log(`    ${role.padEnd(5)} n=${String(s.n).padStart(2)}  均值 ${s.mean.toFixed(2)}km  SD ${s.sd.toFixed(3)}  范围 ${s.min.toFixed(2)}~${s.max.toFixed(2)}`);
}

// ── 护栏建议：带宽 = 2 × SD_batch（本项目的 2SE 判决口径）
console.log("\n=== 护栏建议（带宽由实测批间 SD 决定，不是拍脑袋）===");
const band2 = 2 * sMRatio.sd;
console.log(
  `  主指标「队内 max/min 比值」：中心 ${sMRatio.mean.toFixed(3)}（比赛级 SD ${sMRatio.sd.toFixed(3)}；球队级 ${sRatio.sd.toFixed(3)}），` +
    `2×SD = ${band2.toFixed(3)} ⇒ 建议带 **[${(sRatio.mean - band2).toFixed(2)}, ${(sRatio.mean + band2).toFixed(2)}]**`
);
console.log(
  `  ⚠ 判决力：若带宽 ${band2.toFixed(3)}，要辨出「比值变化 Δ」需要 ` +
    `n = (2 × SD / Δ)² **场比赛**。例：Δ=0.3 ⇒ n=${Math.ceil(((2 * sMRatio.sd) / 0.3) ** 2)}；` +
    `Δ=0.5 ⇒ n=${Math.ceil(((2 * sMRatio.sd) / 0.5) ** 2)}`
);
const band2Gk = 2 * sMGk.sd;
console.log(
  `  辅助指标「门将占球队均值比」：中心 ${sMGk.mean.toFixed(3)}（比赛级 SD ${sMGk.sd.toFixed(3)}），` +
    `2×SD = ${band2Gk.toFixed(3)} ⇒ 建议带 **[${(sGk.mean - band2Gk).toFixed(2)}, ${(sGk.mean + band2Gk).toFixed(2)}]**`
);
console.log(
  `  辅助指标「队内 CV」：中心 ${sCv.mean.toFixed(3)}，` +
    `2×SD = ${(2 * sCv.sd).toFixed(3)} ⇒ 建议带 **[${(sCv.mean - 2 * sCv.sd).toFixed(3)}, ${(sCv.mean + 2 * sCv.sd).toFixed(3)}]**`
);

// ── 反事实：按跑动距离占比分摊「球队总耗能」（总量不变 ⇒ 零重标定）
console.log("\n=== 反事实：按跑动距离占比分摊球队总耗能 ===");
// 现状：上半场每人固定扣 3 点（实测 `player.fitness` 90 → 87，3 次整点结算 × 1 点）
// ⇒ 球队总量 = 3 × 11 = 33 点。改成按**每支球队自己的逐人距离**占比分摊同一总量。
// ⚠ 第一版这里用「角色均值」当分母 ⇒ 分母只有 4 个数而不是 11 个 ⇒ 均值算出来是 8.25 而不是 3。
//   反事实必须用**逐人**距离，用角色均值会把队内差异抹掉（等于又做了一次团块）。
const PER_PLAYER_DRAIN = 3;
// ⚠ 面板值的基准是**赛前体能**（本探针里是 90），不是 100。
//   第一版写成 `100 - drain` ⇒ 把「86~89」错报成「96~99」。
const START_FITNESS = 90;
const teamTotal = PER_PLAYER_DRAIN * 11;
const allDrains = [];
for (const m of allTeams) {
  const kmsOfTeam = m.kms || null;
  void kmsOfTeam;
}
// 逐人距离需要重跑时留存：这里用「每支球队的逐人读数」直接算
for (const rec of teamRecords) {
  const sum = rec.kms.reduce((a, b) => a + b, 0);
  for (const km of rec.kms) allDrains.push((km / sum) * teamTotal);
}
allDrains.sort((a, b) => a - b);
const pick = (q) => allDrains[Math.min(allDrains.length - 1, Math.floor(q * allDrains.length))];
const dMin = allDrains[0];
const dMax = allDrains[allDrains.length - 1];
const dMean = allDrains.reduce((a, b) => a + b, 0) / allDrains.length;
console.log(`  现状：每人固定扣 ${PER_PLAYER_DRAIN} 点，球队总量 ${teamTotal} 点。`);
console.log(`  改成按逐人跑动距离占比分摊同一总量（样本 ${allDrains.length} 个「球员×场」）：`);
console.log(
  `    应扣 min ${dMin.toFixed(2)} / p10 ${pick(0.1).toFixed(2)} / 中位 ${pick(0.5).toFixed(2)} / ` +
    `p90 ${pick(0.9).toFixed(2)} / max ${dMax.toFixed(2)}`
);
console.log(
  `    ⇒ 面板取值 **${Math.round(START_FITNESS - dMax)} ~ ${Math.round(START_FITNESS - dMin)}**` +
    `（现状是全员 ${Math.round(START_FITNESS - PER_PLAYER_DRAIN)}；均值仍是 ${Math.round(START_FITNESS - PER_PLAYER_DRAIN)}）`
);
console.log(
  `    球队均值扣减 ${dMean.toFixed(3)}（= 现状 ${PER_PLAYER_DRAIN}）⇒ **均值口径不变**，` +
    `只有队内分布变了 ⇒ 零重标定`
);
console.log(
  `  个体极值对应：最少的球员（门将，${sMGk.mean.toFixed(2)}×球队均）应扣 ≈ ${dMin.toFixed(2)}，` +
    `最多的球员应扣 ≈ ${dMax.toFixed(2)}（比值 ${(dMax / dMin).toFixed(2)}×）`
);
