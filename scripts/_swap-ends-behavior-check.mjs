// 换边（`endsSwapped`）行为验证
//
// 验证两件事：
//   A. 入口函数自洽：`attackDir` / `targetGoalY` / `ownGoalY` 在换边后
//      必须严格取反，且 `ownGoalY` 与 `targetGoalY` 始终互补（和为 100）。
//   B. 开球摆位正确：`_kickoff` 后每队都在**自己的**半场（换边后主队
//      应在上半场，即 y < 50 一侧）。
//
// ⚠ 必须注入 `opts.random`（引擎不认 `opts.seed`），否则每次跑都是新
//    随机流，读数不可复现。
//
// 用法：node scripts/_swap-ends-behavior-check.mjs

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

function makeClub(name) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((role, i) => {
    const attrs = {};
    for (const k of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical",
      "finishing", "tackling", "marking", "strength", "stamina", "vision",
      "reflexes", "handling", "positioning", "kicking", "decisions",
    ]) attrs[k] = 15;
    return { id: `${name}-${i}`, name: `${name} ${i}`, role, number: i + 1, attrs, playingHabits: [] };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, width: 3, style: "balanced",
    },
  };
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const SEED = 411000;

// ── A. 入口函数自洽 ────────────────────────────────────────────────
{
  const normal = new SimEngine(makeClub("h"), makeClub("a"), { random: mulberry32(SEED) });
  const swapped = new SimEngine(makeClub("h"), makeClub("a"), {
    random: mulberry32(SEED),
    endsSwapped: true,
  });

  record(
    "默认不换边（endsSwapped=false）",
    normal.endsSwapped === false,
    `endsSwapped=${normal.endsSwapped}`,
  );
  record("显式开启换边", swapped.endsSwapped === true);

  // attackDir 必须取反
  const dirChecks = [
    ["home", normal.attackDir("home"), swapped.attackDir("home")],
    ["away", normal.attackDir("away"), swapped.attackDir("away")],
  ];
  let dirOk = true;
  let dirDetail = "";
  for (const [team, base, sw] of dirChecks) {
    if (!(base !== 0 && sw === -base)) {
      dirOk = false;
      dirDetail = `${team}: ${base} → ${sw}`;
    }
  }
  record("attackDir 换边后严格取反", dirOk, dirDetail || "home -1→+1 / away +1→-1");

  // 球门 y 必须互换，且自己/目标始终互补
  const goalChecks = [
    ["home own", normal.ownGoalY("home"), swapped.ownGoalY("home")],
    ["away own", normal.ownGoalY("away"), swapped.ownGoalY("away")],
    ["home target", normal.targetGoalY("home"), swapped.targetGoalY("home")],
    ["away target", normal.targetGoalY("away"), swapped.targetGoalY("away")],
  ];
  let goalOk = true;
  let goalDetail = "";
  for (const [label, base, sw] of goalChecks) {
    if (sw !== 100 - base) {
      goalOk = false;
      goalDetail = `${label}: ${base} → ${sw}`;
    }
  }
  record("ownGoalY/targetGoalY 换边后为 100-base", goalOk, goalDetail || "100↔0");

  // 关键不变量：任何时刻，ownGoalY 与 targetGoalY 必须互补（和 = 100）
  let complementOk = true;
  let compDetail = "";
  for (const eng of [normal, swapped]) {
    for (const team of ["home", "away"]) {
      const sum = eng.ownGoalY(team) + eng.targetGoalY(team);
      if (sum !== 100) {
        complementOk = false;
        compDetail = `${team}(swapped=${eng.endsSwapped}): ${eng.ownGoalY(team)}+${eng.targetGoalY(team)}=${sum}`;
      }
    }
  }
  record("不变量：ownGoalY + targetGoalY === 100", complementOk, compDetail || "4/4 成立");

  // attackDir 必须指向自己的目标球门（方向自洽）
  let dirConsistent = true;
  let dcDetail = "";
  for (const eng of [normal, swapped]) {
    for (const team of ["home", "away"]) {
      const dir = eng.attackDir(team);
      const own = eng.ownGoalY(team);
      const target = eng.targetGoalY(team);
      // 从己方门朝目标门的方向：若己方门在 y 大侧，则进攻朝 y 小 ⇒ -1
      const expect = own > 50 ? -1 : 1;
      if (dir !== expect) {
        dirConsistent = false;
        dcDetail = `${team}(swapped=${eng.endsSwapped}): dir=${dir} own=${own} target=${target}`;
      }
    }
  }
  record("不变量：attackDir 指向 targetGoalY", dirConsistent, dcDetail || "4/4 成立");

  // 进攻方向与 targets 一致：朝 y 小 ⇒ 目标门 y 必须小于己方门 y
  let targetConsistent = true;
  let tcDetail = "";
  for (const eng of [normal, swapped]) {
    for (const team of ["home", "away"]) {
      const dir = eng.attackDir(team);
      const own = eng.ownGoalY(team);
      const target = eng.targetGoalY(team);
      const ok = dir < 0 ? target < own : target > own;
      if (!ok) {
        targetConsistent = false;
        tcDetail = `${team}: dir=${dir} own=${own} target=${target}`;
      }
    }
  }
  record("不变量：目标门在进攻方向前方", targetConsistent, tcDetail || "4/4 成立");

  // _inOwnPenaltyArea 也必须跟着换边
  const ownBoxNormal = normal._inOwnPenaltyArea("home", 50, 95, 0);
  const ownBoxSwapped = swapped._inOwnPenaltyArea("home", 50, 95, 0);
  record("禁区判定随换边翻转（home y=95）", ownBoxNormal === true && ownBoxSwapped === false,
    `换边前=${ownBoxNormal} 换边后=${ownBoxSwapped}`);
  const oppBoxSwapped = swapped._inOwnPenaltyArea("home", 50, 5, 0);
  record("换边后 home 的禁区移到 y 小侧", oppBoxSwapped === true, `y=5 → ${oppBoxSwapped}`);
}

// ── B. 开球摆位 ────────────────────────────────────────────────────
{
  const eng = new SimEngine(makeClub("h"), makeClub("a"), {
    random: mulberry32(SEED),
    endsSwapped: true,
  });
  // 构造函数已经 kickoff 过一次；再显式调一次确保确定
  eng._kickoff("home");

  const homeYs = eng.agents.filter((a) => a.team === "home" && !a.sentOff).map((a) => a.y);
  const awayYs = eng.agents.filter((a) => a.team === "away" && !a.sentOff).map((a) => a.y);
  const homeMid = homeYs.slice().sort((x, y) => x - y)[Math.floor(homeYs.length / 2)];
  const awayMid = awayYs.slice().sort((x, y) => x - y)[Math.floor(awayYs.length / 2)];

  record(
    "换边后开球：主队压缩在 y<50 半场",
    homeYs.every((y) => y <= 50 + 1e-9),
    `home y ∈ [${Math.min(...homeYs).toFixed(1)}, ${Math.max(...homeYs).toFixed(1)}] 中位 ${homeMid.toFixed(1)}`,
  );
  record(
    "换边后开球：客队压缩在 y>50 半场",
    awayYs.every((y) => y >= 50 - 1e-9),
    `away y ∈ [${Math.min(...awayYs).toFixed(1)}, ${Math.max(...awayYs).toFixed(1)}] 中位 ${awayMid.toFixed(1)}`,
  );

  // 非开球队（away）必须退出中圈
  const awayOut = awayYs.every((y) => y >= 40.5 - 1e-9);
  record("换边后非开球队退出中圈", awayOut, `away min y=${Math.min(...awayYs).toFixed(1)}（阈值 40.5）`);

  // 对照：不换边时主队在 y>50 侧
  const eng2 = new SimEngine(makeClub("h"), makeClub("a"), { random: mulberry32(SEED) });
  eng2._kickoff("home");
  const homeYs2 = eng2.agents.filter((a) => a.team === "home" && !a.sentOff).map((a) => a.y);
  record(
    "对照：不换边时主队压缩在 y>50 半场",
    homeYs2.every((y) => y >= 50 - 1e-9),
    `home y ∈ [${Math.min(...homeYs2).toFixed(1)}, ${Math.max(...homeYs2).toFixed(1)}]`,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n📊 Results: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
if (failed.length) process.exit(1);
