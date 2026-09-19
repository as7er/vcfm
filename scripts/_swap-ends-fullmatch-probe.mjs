// 换边开启后的**整场行为探针**（只读，不改代码）
//
// 目的：在 `endsSwapped=true` 下真的把一场 90 分钟跑完，量出三件事：
//   ① 是否会抛异常 / 产生 NaN 坐标（硬崩溃面）
//   ② 进攻方向是否真的翻转了（球在哪个半场、射门朝向）
//   ③ 比分与事件是否「看起来还像足球」（软退化面）
//
// 对照组：同 seed 的 `endsSwapped=false`。两组用完全相同的随机流，
// 所以任何差异都只能来自换边本身。
//
// 用法：node scripts/_swap-ends-fullmatch-probe.mjs [场数=3]

import { SimEngine } from "../js/sim/engine.js";

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

const ROLES = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
const NAMES = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "finishing", "tackling", "marking", "strength", "stamina", "vision",
  "reflexes", "handling", "positioning", "kicking", "decisions",
];
function makeClub(name, bias) {
  const players = ROLES.map((role, i) => {
    const attrs = {};
    for (const k of NAMES) attrs[k] = 10 + bias + ((i * 3 + k.length) % 5);
    return {
      id: `${name}-${i}`, name: `${name} ${i}`, pos: role, role, number: i + 1,
      attrs, playingHabits: [], fitness: 100, injured: 0,
    };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, width: 3, style: "balanced",
    },
  };
}

const MATCHES = Math.max(1, Number(process.argv[2]) || 3);
const SEED0 = 611000;
const DT = 0.1;
const SECONDS = 5400; // 90 分钟
const SWAP_AT = 2700; // 45 分钟

function runMatch(seed, swappedAtHalftime) {
  const eng = new SimEngine(makeClub("H", 4), makeClub("A", 1), { random: mulberry32(seed) });
  const stats = {
    seed,
    swapped: false,
    errors: [],
    nanFrames: 0,
    ballYsum: 0,
    ballYsumH1: 0,
    ballYsumH2: 0,
    framesH1: 0,
    framesH2: 0,
    homeShots: 0,
    awayShots: 0,
    goalsHome: 0,
    goalsAway: 0,
    homeShotYsum: 0,
    awayShotYsum: 0,
    // 下半场单算（判射门纵深用）。整场均值会把换边前/后的位置混在一起，
    // 得出「两队都停在中线」的假象 —— 见文末判据处的说明。
    h2: { homeShots: 0, awayShots: 0, homeShotYsum: 0, awayShotYsum: 0 },
  };

  // 记录事件
  //
  // ⚠ `_emit`（engine.js:5269）的字段是 { t, type, team, agentId, x, y, ...extra }；
  //   shot 的 extra 里**没有** `onTarget`/`minute`（见 :3637 的 payload）。
  //   所以射正无法从事件直接读，改用「射门发生位置 y 的分布」来判进攻方向：
  //   换边后主队应该从 **y 小侧** 起脚（原本是从 y 大侧）。
  const seen = new Set();
  let inSecondHalf = false; // 由下面的循环维护，供 drainEvents 判断是否下半场
  const drainEvents = () => {
    const evs = eng.events || [];
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      const key = `${e.t}|${e.type}|${e.team}|${e.agentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.type === "shot") {
        if (e.team === "home") {
          stats.homeShots++;
          stats.homeShotYsum += e.y;
          if (inSecondHalf) {
            stats.h2.homeShots++;
            stats.h2.homeShotYsum += e.y;
          }
        } else {
          stats.awayShots++;
          stats.awayShotYsum += e.y;
          if (inSecondHalf) {
            stats.h2.awayShots++;
            stats.h2.awayShotYsum += e.y;
          }
        }
      }
      if (e.type === "goal") {
        if (e.team === "home") stats.goalsHome++;
        else stats.goalsAway++;
      }
    }
  };

  const steps = Math.round(SECONDS / DT);
  const swapStep = Math.round(SWAP_AT / DT);
  for (let i = 0; i < steps; i++) {
    // 在 45 分钟处换边（等价于调用层做的事）
    if (swappedAtHalftime && i === swapStep && !stats.swapped) {
      stats.swapped = true;
      eng.endsSwapped = true;
      eng._kickoff("away"); // 下半场由客队开球（与真实一致）
    }
    // 非换边组也按同一时刻切半场，两组才可比
    if (i >= swapStep) inSecondHalf = true;
    try {
      eng.step(DT);
    } catch (e) {
      stats.errors.push(`${(i * DT).toFixed(0)}s: ${e && e.message}`);
      if (stats.errors.length > 3) break;
    }
    drainEvents();
    if (!Number.isFinite(eng.ball.x) || !Number.isFinite(eng.ball.y)) stats.nanFrames++;
    const y = eng.ball.y;
    stats.ballYsum += y;
    if (i < swapStep) {
      stats.ballYsumH1 += y;
      stats.framesH1++;
    } else {
      stats.ballYsumH2 += y;
      stats.framesH2++;
    }
  }
  drainEvents();

  stats.avgBallY = stats.ballYsum / steps;
  stats.avgBallYH1 = stats.framesH1 ? stats.ballYsumH1 / stats.framesH1 : 0;
  stats.avgBallYH2 = stats.framesH2 ? stats.ballYsumH2 / stats.framesH2 : 0;
  stats.finalHome = eng.score?.home ?? stats.goalsHome;
  stats.finalAway = eng.score?.away ?? stats.goalsAway;
  return stats;
}

console.log("跑 90 分钟整场（每组最多 3 场，同 seed 对照）…\n");
const rows = [];
for (let m = 0; m < MATCHES; m++) {
  const seed = SEED0 + m;
  const base = runMatch(seed, false);
  const swap = runMatch(seed, true);
  rows.push({ seed, base, swap });
}

function fmt(r) {
  const hsy = r.homeShots ? (r.homeShotYsum / r.homeShots).toFixed(1) : "n/a";
  const asy = r.awayShots ? (r.awayShotYsum / r.awayShots).toFixed(1) : "n/a";
  return [
    `比分 ${String(r.finalHome).padStart(2)}-${String(r.finalAway).padEnd(2)}`,
    `射门 ${String(r.homeShots).padStart(2)}/${String(r.awayShots).padEnd(2)}`,
    `射门位均y 主${hsy}/客${asy}`,
    `球均y ${r.avgBallY.toFixed(1).padStart(5)}`,
    `上半 ${r.avgBallYH1.toFixed(1).padStart(5)}`,
    `下半 ${r.avgBallYH2.toFixed(1).padStart(5)}`,
    `NaN ${r.nanFrames}`,
    `异常 ${r.errors.length}`,
  ].join(" │ ");
}

for (const { seed, base, swap } of rows) {
  console.log(`  seed=${seed}`);
  console.log(`    不换边 ${fmt(base)}`);
  console.log(`    换  边 ${fmt(swap)}`);
  if (swap.errors.length) {
    console.log(`    ⛔ 换边组异常：`);
    for (const e of swap.errors) console.log(`       ${e}`);
  }
  console.log("");
}

// ── 汇总判据 ──────────────────────────────────────────────────────
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("── 判据 ──");
const anyErr = rows.some((r) => r.swap.errors.length);
const anyNan = rows.some((r) => r.swap.nanFrames > 0);
record("换边整场无异常抛出", !anyErr, anyErr ? "见上方 ⛔" : `${rows.length} 场`);
record("换边整场无 NaN 球坐标", !anyNan, anyNan ? `${rows.filter((r) => r.swap.nanFrames).length} 场出现` : `${rows.length} 场`);

// 换边后球的平均位置应仍在球场内（0..100），且与不换边组同量级
const sane = rows.every((r) => r.swap.avgBallY > 10 && r.swap.avgBallY < 90);
record("换边后球平均位置在合理区间", sane, rows.map((r) => r.swap.avgBallY.toFixed(1)).join(" / "));

// 进球数不应爆炸（>12 球基本说明攻守彻底失序）
const maxGoals = Math.max(...rows.map((r) => r.swap.finalHome + r.swap.finalAway));
record("换边后总进球数未爆炸（≤12）", maxGoals <= 12, `最高 ${maxGoals} 球`);

// ★ 核心判据：换边后主队的射门位置必须翻到 y 小侧。
// 不换边时主队攻 y=0 的门 ⇒ 禁区在 y 小侧 ⇒ 射门点 y 偏小；
// 换边后主队攻 y=100 的门 ⇒ 射门点 y 应偏大。
// 这条直接证明「41 处方向性推断」里至少射门相关的那批**跟着换了**。
const shotYrows = rows.filter(
  (r) =>
    r.swap.homeShots >= 5 &&
    r.base.homeShots >= 5 &&
    r.swap.awayShots >= 5 &&
    r.base.awayShots >= 5
);
let shotShift = [];
for (const r of shotYrows) {
  const bh = r.base.homeShotYsum / r.base.homeShots;
  const sh = r.swap.homeShotYsum / r.swap.homeShots;
  shotShift.push({ seed: r.seed, base: bh, swap: sh });
}
if (shotYrows.length) {
  const allFlipped = shotShift.every((x) => x.swap > x.base);
  record(
    "换边后主队射门位置整体翻向对面半场",
    allFlipped,
    shotShift.map((x) => `seed${x.seed}: ${x.base.toFixed(1)}→${x.swap.toFixed(1)}`).join(" │ "),
  );

  // ★★ 强判据（2026-09-19 加，2026-09-19 修正）：换边后**两队**都得真的打上门前。
  //
  // ⛔ 这条判据错过两次，都记下来免得重犯：
  //
  //   错误 1（量选错）：原来要求「主队射门位均 y > 50 且客队 < 50」。换边会把
  //     `y` 的含义整个翻过来，拿换边后的绝对 y 跟 50 比，比的是「谁站在场地
  //     哪一侧」，不是「谁攻上去了」。必须换成 **距己方门的纵深**（0=己方门，
  //     100=对方门）——这个量与主客/换边无关，换边前后同一条判据都成立。
  //
  //   错误 2（样本混了半场）：探针累计的 `homeShotYsum` 是**整场**射门的总和，
  //     包含上半场（换边前，主队射门 y≈10）。混合后均值 ~49，看着像「主队没
  //     攻上去」，实际下半场单算是 87~89，完全正常。判据必须**只看下半场**。
  //     ⚠ 也就是说：这条判据得靠 `runMatch` 分半场累计，不能复用上面的统计。
  const depthOf = (y, team, swapped) => {
    const own = team === "home" ? (swapped ? 0 : 100) : swapped ? 100 : 0;
    return own > 50 ? 100 - y : y;
  };
  const depthRows = rows
    .filter(
      (r) =>
        r.swap.h2 && r.swap.h2.homeShots >= 4 && r.swap.h2.awayShots >= 4 &&
        r.base.h2 && r.base.h2.homeShots >= 4 && r.base.h2.awayShots >= 4
    )
    .map((r) => ({
      seed: r.seed,
      baseH: depthOf(r.base.h2.homeShotYsum / r.base.h2.homeShots, "home", false),
      baseA: depthOf(r.base.h2.awayShotYsum / r.base.h2.awayShots, "away", false),
      swapH: depthOf(r.swap.h2.homeShotYsum / r.swap.h2.homeShots, "home", true),
      swapA: depthOf(r.swap.h2.awayShotYsum / r.swap.h2.awayShots, "away", true),
    }));
  if (depthRows.length) {
    const bothReach = depthRows.every((x) => x.swapH > 75 && x.swapA > 75);
    record(
      "换边后两队下半场射门纵深都在对方门前（>75）",
      bothReach,
      depthRows
        .map(
          (x) =>
            `seed${x.seed}: 主${x.swapH.toFixed(1)}/客${x.swapA.toFixed(1)}（不换边 ${x.baseH.toFixed(1)}/${x.baseA.toFixed(1)}）`
        )
        .join(" │ "),
    );
  } else {
    console.log("  ⚠ 样本不足（需要两队下半场各 ≥4 次射门的场次），跳过射门纵深判据");
  }
} else {
  console.log("  ⚠ 样本不足（需要两队各 ≥5 次射门的场次），跳过射门方向判据");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n📊 Results: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
if (failed.length) process.exit(1);
