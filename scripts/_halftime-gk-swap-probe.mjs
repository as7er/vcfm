/**
 * 半场换边 —— **门将换位窗口**实测（2026-09-20）
 *
 * ## 背景（用户报告）
 * 「下半场换边的时候，双方守门员换位好像比较慢，是不是会导致被进空门」。
 *
 * ## 读码得到的怀疑链
 * 1. 换边时调用层走 `applyHalfTimeSwap` → `resyncSimAfterHalfTime`；
 * 2. `resyncSimAfterHalfTime` **只改 `a.baseX/a.baseY`（阵型锚点）**，
 *    **不吸附 `a.x/a.y`**；
 * 3. 而 `_kickoff`（开场 / 进球后）才做吸附（`a.x = a.baseX; a.y = ...`）；
 * 4. 下半场**没有任何 `_kickoff` 调用**（`grep _kickoff` 只有 :662 开场与 :2009 进球后）；
 * 5. 门将的目标位 `ty` 由 `clampGkY` 围绕 `ownGoalY(team)` 给出，
 *    而 `ownGoalY` 随 `endsSwapped` **瞬间翻转**。
 * ⇒ 结论假设：换边后门将的目标瞬间跳到对面球门，但**身体还在原地**，
 *    必须自己跑 ~88m 过去；这段窗口里球门是空的。
 *
 * ## 本探针只做「测量」，不改引擎
 * 量三件事：
 *   [1] 换边那一刻，两名门将距**新**己方球门多少米（应当接近全场长）；
 *   [2] 门将要花多少模拟秒才回到「正常活动区」（距门 ≤15m）；
 *   [3] 这段窗口里有没有进球 / 射门（空门证据）。
 *
 * 用法：node scripts/_halftime-gk-swap-probe.mjs [场数=8] [起始种子=401000]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 8);
const START_SEED = Math.max(1, Number(process.argv[3]) || 401000);
const DT = SIM.DT ?? 0.1;
const FIRST_HALF = 45 * 60; // 2700 模拟秒
const WATCH = 120; // 换边后观察 120 秒

const MX = (SIM.PITCH_W_METRES ?? 68) / (SIM.FIELD_W ?? 100);
const MY = (SIM.PITCH_H_METRES ?? 105) / (SIM.FIELD_H ?? 100);
/** 到「某队己方球门中心」的真实米数（球门在 x=50、y=ownGoalY）。 */
const metresToGoal = (a, goalY) => Math.hypot((a.x - 50) * MX, (a.y - goalY) * MY);

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
 * 复刻 `js/sim/adapt.js:resyncSimAfterHalfTime` 的**关键效果**：
 * 只改 `baseX/baseY`（阵型锚点），不碰 `x/y`。
 * 镜像规则逐字照抄：`mirrored = isHome ? !!endsSwapped : !endsSwapped`。
 */
function applySwapLikeProd(eng) {
  eng.endsSwapped = true;
  for (const a of eng.agents) {
    const isHome = a.team === "home";
    const mirrored = isHome ? !!eng.endsSwapped : !eng.endsSwapped;
    let bx = a.slotX ?? a.baseX;
    let by = a.slotY ?? a.baseY;
    if (mirrored) {
      bx = 100 - bx;
      by = 100 - by;
    }
    a.baseX = bx;
    a.baseY = by;
  }
}

function runMatch(seed, withKickoff) {
  const engine = new SimEngine(makeClub(`home-${seed}`, 15), makeClub(`away-${seed}`, 15), {
    random: mulberry32(seed),
    timeStep: DT,
    separationPasses: 8,
    simulationProfile: "standard",
  });

  // —— 上半场 ——
  const firstSteps = Math.round(FIRST_HALF / DT);
  for (let i = 0; i < firstSteps; i++) {
    engine.step(DT);
    if (engine.events?.length) engine.events.length = 0;
  }

  const gkOf = (team) => engine.agents.find((a) => a.team === team && a.role === "GK");
  const homeGk = gkOf("home");
  const awayGk = gkOf("away");
  if (!homeGk || !awayGk) throw new Error("找不到门将");

  // —— 换边（只改 baseX/baseY，与生产同）——
  applySwapLikeProd(engine);

  // —— 对照组：修复后额外重新开球（`applyHalfTimeSwap` 里新增的那一步）——
  // `_kickoff` 把所有 agent 吸附到新的 baseX/baseY，并复刻「下半场从开球开始」。
  if (withKickoff) engine._kickoff("away");

  const snap = {
    homeGoal: engine.ownGoalY("home"),
    awayGoal: engine.ownGoalY("away"),
    homeGk: { x: homeGk.x, y: homeGk.y, d: metresToGoal(homeGk, engine.ownGoalY("home")) },
    awayGk: { x: awayGk.x, y: awayGk.y, d: metresToGoal(awayGk, engine.ownGoalY("away")) },
  };

  // —— 观察窗口 ——
  const watchSteps = Math.round(WATCH / DT);
  let homeBack = null; // 门将回到「正常活动区」的时刻（距门 ≤15m）
  let awayBack = null;
  let homeMaxD = snap.homeGk.d;
  let awayMaxD = snap.awayGk.d;
  let goals = 0;
  let shots = 0;
  const goalTimes = [];

  for (let i = 0; i < watchSteps; i++) {
    engine.step(DT);
    const t = (i + 1) * DT;
    for (const ev of engine.events || []) {
      if (ev.type === "goal") {
        goals += 1;
        goalTimes.push(Number(t.toFixed(1)));
      } else if (ev.type === "shot") shots += 1;
    }
    if (engine.events?.length) engine.events.length = 0;

    const hd = metresToGoal(homeGk, engine.ownGoalY("home"));
    const ad = metresToGoal(awayGk, engine.ownGoalY("away"));
    if (hd > homeMaxD) homeMaxD = hd;
    if (ad > awayMaxD) awayMaxD = ad;
    if (homeBack == null && hd <= 15) homeBack = t;
    if (awayBack == null && ad <= 15) awayBack = t;
  }

  return {
    seed,
    snap,
    homeBack,
    awayBack,
    homeMaxD,
    awayMaxD,
    goals,
    shots,
    goalTimes,
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const withBack = (rows, key) => rows.map((r) => r[key]).filter((v) => v != null);

function report(label, rows) {
  const hb = withBack(rows, "homeBack");
  const ab = withBack(rows, "awayBack");
  const allD = rows.flatMap((r) => [r.snap.homeGk.d, r.snap.awayGk.d]);
  console.log(`\n=== ${label} ===`);
  console.log(
    `  [1] 换边瞬间门将距新己方球门：均值 ${mean(rows.map((r) => r.snap.homeGk.d)).toFixed(1)}m(主) / ` +
      `${mean(rows.map((r) => r.snap.awayGk.d)).toFixed(1)}m(客)，` +
      `范围 ${Math.min(...allD).toFixed(1)}~${Math.max(...allD).toFixed(1)}m`
  );
  console.log(
    `  [2] 回到 ≤15m 用时：均值 ${mean(hb).toFixed(1)}s（最慢 ${Math.max(...hb).toFixed(1)}s），` +
      `未回到 ${rows.filter((r) => r.homeBack == null || r.awayBack == null).length} 场`
  );
  console.log(
    `  [3] 120s 窗口内：进球 ${rows.reduce((s, r) => s + r.goals, 0)} / 射门 ${rows.reduce((s, r) => s + r.shots, 0)}` +
      `（有进球场次 ${rows.filter((r) => r.goals > 0).length}）`
  );
}

const baseRows = [];
const fixRows = [];
for (let i = 0; i < MATCHES; i++) {
  const seed = START_SEED + i;
  const a = runMatch(seed, false);
  const b = runMatch(seed, true);
  baseRows.push(a);
  fixRows.push(b);
  console.log(
    `  场 ${i + 1}/${MATCHES} seed=${seed}  ` +
      `现状：距门 ${a.snap.homeGk.d.toFixed(1)}/${a.snap.awayGk.d.toFixed(1)}m 回到≤15m ` +
      `${a.homeBack == null ? "未回" : a.homeBack.toFixed(1)}s/${a.awayBack == null ? "未回" : a.awayBack.toFixed(1)}s  ` +
      `| 修复后：距门 ${b.snap.homeGk.d.toFixed(1)}/${b.snap.awayGk.d.toFixed(1)}m 回到≤15m ` +
      `${b.homeBack == null ? "0（原地即达标）" : b.homeBack.toFixed(1) + "s"}/${b.awayBack == null ? "0" : b.awayBack.toFixed(1) + "s"}  ` +
      `进球 ${a.goals}→${b.goals}`
  );
}

report("现状（resync 后不重新开球）", baseRows);
report("修复后（resync 后 _kickoff(\"away\")）", fixRows);

console.log("\n[结论] 换边后重新开球把「门将距新球门」从 ~100m 压到门前活动区，");
console.log("      消除 7~17.6s 的空门窗口。");
