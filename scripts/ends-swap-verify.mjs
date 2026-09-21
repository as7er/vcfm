/**
 * 换边（`endsSwapped`）方向/端别回归（2026-09-22）
 *
 * ## 为什么要有这一条
 *
 * 2026-09-22 的审计发现：引擎里有一整类「用队名隐式表达方向」的写法
 * （`restartTeam === "home" ? 5 : 95` 之类），它们在上半场（`endsSwapped=false`）
 * 恰好正确，**一下半场就成批失效** —— 进球记给错队、门将站进门里、越位失效、
 * 前场任意球整队摆到另一端。
 *
 * 🔴 **原有的 42 例换边检查 + 24 场角球探针全都漏掉了**，因为它们的判据是
 * 「总进球数 ≤ 12」「射门纵深」这类**总量**指标 —— 没有一条问「**这个球是谁进的**」、
 * 「门将站在哪」。**判据选错**，不是探针坏了。
 *
 * 所以本文件专门补那个洞：把「方向/端别」的正确性钉成**逐点断言**，
 * 而且每条都同时跑 `endsSwapped = false / true` 两种取值。
 *
 * ## 判据的统一写法
 *
 * **换边只翻 y，x 永不翻。** 一切期望值都从 `attackDir` / `ownGoalY` / `targetGoalY`
 * 派生（而不是硬编码 4/96/5/95），这样两种取值都能用同一套公式断言。
 *
 * 用法：node scripts/ends-swap-verify.mjs      （约 2 秒，不需要浏览器）
 */

import { readFileSync } from "node:fs";
import { SimEngine } from "../js/sim/engine.js";

let failed = 0;
function check(ok, label, detail = "") {
  const mark = ok ? "  ✓" : "  ✗";
  console.log(`${mark} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

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

/** ⚠ 必须注入 `opts.random`（引擎不认 `opts.seed`），否则读数不可复现。 */
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

const mk = (swapped) =>
  new SimEngine(makeClub("h"), makeClub("a"), { random: mulberry32(411000), endsSwapped: swapped });

const other = (t) => (t === "home" ? "away" : "home");

// ── [1] 静态：防止退回「按队名取方向」的写法 ────────────────────────────────
console.log("\n[1] 静态：关键位置不得再出现按队名的端别判定");
{
  const src = readFileSync("js/sim/engine.js", "utf8");
  const forbid = [
    ["_resolveBounds 的角球/门球", /_restart\("corner", "(?:home|away)", b\.x < 50 \? 2 : 98, (?:4|96)\)/],
    ["clampGkY 的队名分支", /a\.team === "home"\s*\n?\s*\?\s*clamp\(ty, goalY - maxAdvance/],
    ["越位线的队名分支", /attTeam === "home" \? (?:Infinity|y < first)/],
    ["越位位置的队名分支", /if \(team === "home"\) \{\s*\n\s*return player\.y < 50/],
    ["_restart 的 mirrorY", /mirrorY = \(topY\) => \(restartTeam === "home"/],
    ["进球钉球的队名分支", /const inTopNet = scoringTeam === "home"/],
  ];
  for (const [label, re] of forbid) {
    check(!re.test(src), `已不再按队名取端：${label}`);
  }
  check(/const lowTeam = this\.ownGoalY\("home"\) <= 50/.test(src), "`_resolveBounds` 由 `ownGoalY` 派生端别");
}

// ── [2] 门将：目标位必须落在**己方门内侧**（不能站到球网里）────────────────
console.log("\n[2] 门将钳位（clampGkY）：两种换边下都必须贴己方门、且在场地内");
for (const swapped of [false, true]) {
  const eng = mk(swapped);
  const b = eng.ball;
  b.owner = null;
  b.state = "loose";
  b.x = 50;
  b.y = 50;
  for (const team of ["home", "away"]) {
    const gk = eng.agents.find((a) => a.team === team && a.role === "GK");
    const own = eng.ownGoalY(team);
    const dir = eng.attackDir(team);
    // 把门将放在「离门 8 格、场内」的位置，再让它自己算目标
    gk.x = 50;
    gk.y = own + dir * 8;
    gk.ty = gk.y;
    eng._thinkGK(gk, null);
    const inField = gk.ty >= 1 && gk.ty <= 99;
    const onOwnSide = dir < 0 ? gk.ty <= own + 1 : gk.ty >= own - 1;
    check(
      inField && onOwnSide,
      `swapped=${String(swapped).padEnd(5)} ${team} GK ty=${gk.ty.toFixed(2)} 在己方门内侧`,
      `ownGoalY=${own} dir=${dir}`
    );
  }
}

// ── [3] 越位线：必须是「按进攻方向数、倒数第 2 名防守者」的 y ────────────────
console.log("\n[3] 越位线（_offsideLineY）：两种换边下都必须取对方向");
for (const swapped of [false, true]) {
  const eng = mk(swapped);
  for (const team of ["home", "away"]) {
    const own = eng.ownGoalY(team);
    eng.agents
      .filter((a) => a.team === team)
      .forEach((a, i) => {
        a.y = own === 0 ? (i === 0 ? 1 : 5 + i * 8) : i === 0 ? 99 : 95 - i * 8;
      });
  }
  for (const att of ["home", "away"]) {
    const line = eng._offsideLineY(att);
    const defys = eng.agents.filter((a) => a.team === other(att)).map((a) => a.y);
    const attGoal = eng.targetGoalY(att);
    // 期望：按「朝该进攻方向」排序后的第 2 个（门将在最末）
    const sorted = defys.slice().sort((a, b) => (attGoal === 100 ? b - a : a - b));
    check(
      line === +sorted[1].toFixed(1) || Math.abs(line - sorted[1]) < 1e-9,
      `swapped=${String(swapped).padEnd(5)} 进攻方=${att}（攻 ${attGoal} 端）越位线`,
      `实得 ${line} ｜ 期望 ${sorted[1]}`
    );
  }
}

// ── [4] 底线出界：角球/门球「给谁 + 摆哪」─────────────────────────────────
console.log("\n[4] 底线出界：角球给该端攻方、门球给该端守方，球落在该端");
for (const swapped of [false, true]) {
  for (const line of [0, 100]) {
    for (const kicker of ["home", "away"]) {
      const eng = mk(swapped);
      const k = eng.agents.find((a) => a.team === kicker && a.role !== "GK");
      const b = eng.ball;
      b.lastKicker = k.id;
      b.state = "pass";
      b.x = 50;
      b._prevX = 50;
      b.z = 0.2;
      b._prevZ = 0.2;
      b._prevVz = 0;
      if (line === 100) {
        b._prevY = 99;
        b.y = 100.6;
      } else {
        b._prevY = 1;
        b.y = -0.6;
      }
      eng._resolveBounds();
      const ev = eng.events
        .filter((e) => ["corner", "goalkick"].includes(e.type))
        .pop();
      // 该端守门的队 = ownGoalY 等于该端的队
      const defTeam = eng.ownGoalY("home") === line ? "home" : "away";
      const attTeam = other(defTeam);
      const wantType = kicker === defTeam ? "corner" : "goalkick";
      const wantTeam = kicker === defTeam ? attTeam : defTeam;
      const ok =
        !!ev &&
        ev.type === wantType &&
        ev.team === wantTeam &&
        Math.abs(Number(ev.y) - line) <= 12.5; // 角球 y=4/96、门球 y=12/88
      check(
        ok,
        `swapped=${String(swapped).padEnd(5)} 出 y=${String(line).padStart(3)} 最后触球=${kicker.padEnd(4)} → ${wantType}/${wantTeam}`,
        ev ? `实得 ${ev.type}/${ev.team} y=${ev.y}` : "无事件"
      );
    }
  }
}

// ── [5] 进球记名：y 端进球必须记给「在该端进攻的队」────────────────────────
console.log("\n[5] 进球记名：两种换边下都必须记给在该端进攻的队");
for (const swapped of [false, true]) {
  for (const line of [0, 100]) {
    const eng = mk(swapped);
    const defTeam = eng.ownGoalY("home") === line ? "home" : "away";
    const attTeam = other(defTeam);
    const shooter = eng.agents.find((a) => a.team === attTeam && a.role === "ATT");
    const b = eng.ball;
    b.lastKicker = shooter.id;
    b.state = "shot";
    b.x = 50;
    b._prevX = 50;
    b.z = 0.5;
    b._prevZ = 0.5;
    b._prevVz = 0;
    if (line === 100) {
      b._prevY = 99;
      b.y = 100.4;
    } else {
      b._prevY = 1;
      b.y = -0.4;
    }
    const before = { home: eng.score.home, away: eng.score.away };
    eng._resolveBounds();
    const scored = eng.score[attTeam] > before[attTeam];
    // 换边安全：球必须钉在**该队进攻的**那一端
    const wantEnd = eng.targetGoalY(attTeam);
    const ballOnRightEnd = wantEnd <= 50 ? b.y < 1.5 : b.y > 98.5;
    check(
      scored,
      `swapped=${String(swapped).padEnd(5)} 出 y=${String(line).padStart(3)} 由 ${attTeam} 打进 → 记给 ${attTeam}`,
      `比分 ${eng.score.home}-${eng.score.away}`
    );
    check(
      ballOnRightEnd,
      `         球钉在该队进攻端（y=${b.y.toFixed(1)}，期望 ${wantEnd <= 50 ? "<1.5" : ">98.5"}）`
    );
  }
}

// ── [6] `endsSwapped=false` 的对称性自检 ───────────────────────────────────
console.log("\n[6] 自洽：`endsSwapped=true` 下主客应互为主客（不是「只有一队换边」）");
{
  const a = mk(false);
  const b = mk(true);
  const pairs = [
    ["ownGoalY", (e) => e.ownGoalY("home")],
    ["targetGoalY", (e) => e.targetGoalY("home")],
    ["attackDir", (e) => e.attackDir("home")],
  ];
  for (const [name, get] of pairs) {
    const va = get(a);
    const vb = get(b);
    check(vb === -va || vb === 100 - va, `${name}(home) 换边后取反/镜像`, `${va} → ${vb}`);
  }
  check(a.ownGoalY("home") !== b.ownGoalY("home"), "两队都换边（不是只换一队）");
}

if (failed) {
  console.error(`\nends-swap-verify: ${failed} 项失败`);
  process.exit(1);
}
console.log("\nends-swap-verify: ok");
