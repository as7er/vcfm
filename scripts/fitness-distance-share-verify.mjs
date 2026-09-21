/**
 * 中场体能「按跑动距离占比分摊」验收（2026-09-21，方案 D）
 *
 * 背景：`docs/measurements/halftime-fitness-per-player-2026-09-21.txt`
 * —— 用户已拍板的「读引擎 `agent.fitness` 回写」实测修不好「中场全队同值」，
 * 替代方案 = 引擎累计**真实跑动距离**，结算时**球队总量不变、按距离占比分摊**。
 *
 * 本探针守四条：
 *  [1] 静态：`runMetres` 在 `engine.js` 里**只写不读**（纯计数器 ⇒ 不影响物理）
 *  [2] 静态：结算实现只有一处，且四处调用点都走它（没有残留的内联 drain）
 *  [3] 动态（空间引擎）：**球队总量精确守恒** + **队内出现差异** + **排序与跑动距离一致**
 *  [4] 动态（概率引擎）：没有 `simEng` ⇒ 走回退 ⇒ **仍是等额**（旧行为不变）
 *
 * 用法：node scripts/_fitness-distance-share-verify.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultTactics, ensureFootballProfile, getLineupPlayers } from "../js/models.js";
import { generatePlayerAttributes } from "../js/player-attributes.js";
import { createMatchSession, playFirstHalf } from "../js/match.js";

const engineSrc = readFileSync("js/sim/engine.js", "utf8");
const matchSrc = readFileSync("js/match.js", "utf8");

let failed = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

// ─────────────────────────────────────────────────────────────
console.log("\n[1] 静态：`runMetres` 只写不读（纯计数器）");
{
  const lines = engineSrc.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (line.includes("runMetres")) hits.push({ n: i + 1, line: line.trim() });
  });
  console.log(`     engine.js 里共 ${hits.length} 处：`);
  for (const h of hits) console.log(`       ${h.n}: ${h.line.slice(0, 100)}`);
  // 只允许「初始化」与「累加」两种形态：都必须是**赋值/自增**，不能是读取
  const reads = hits.filter(
    (h) =>
      !/runMetres:\s*0/.test(h.line) &&
      !/^\s*a\.runMetres\s*=\s*0;/.test(h.line) &&
      !/a\.runMetres\s*=\s*\(a\.runMetres\s*\|\|\s*0\)\s*\+/.test(h.line)
  );
  check(reads.length === 0, "没有任何「读取 runMetres」的地方（引擎物理不受它影响）",
    reads.length ? reads.map((r) => `${r.n}:${r.line.slice(0, 60)}`).join(" | ") : "");
}

// ─────────────────────────────────────────────────────────────
console.log("\n[2] 静态：结算实现唯一，四处调用点都走它");
{
  check(
    (matchSrc.match(/function settleFitnessDrain\(/g) || []).length === 1,
    "`settleFitnessDrain` 只定义一次"
  );
  // ⚠ 只数**调用**（`settleFitnessDrain(state, state.home` / `state.away`），
  //   不要把函数定义行 `function settleFitnessDrain(state, club, sk, ...)` 数进来。
  const calls = (matchSrc.match(/settleFitnessDrain\(state, state\.(home|away)/g) || []).length;
  check(calls === 8, "8 处调用（4 个站点 × 主客两队）", `实测 ${calls}`);
  // 旧的内联写法必须清零
  check(
    !/const drain = Math\.max\(\s*\n?\s*1,\s*\n?\s*Math\.round\(fitW/.test(matchSrc),
    "没有残留的内联 drain 写法"
  );
  check(
    /const perPlayer = Math\.max\(1, Math\.round\(fitW \+ extra\)\)/.test(matchSrc),
    "名义扣减口径未变（`max(1, round(fitW + extra))`）"
  );
  // 回退分支必须与旧实现逐字相同
  check(
    /if \(!work \|\| sumWork <= 0\) \{\s*\n\s*for \(const p of xi\) p\.fitness = Math\.round\(Math\.max\(30, \(p\.fitness \|\| 100\) - perPlayer\)\);/.test(
      matchSrc
    ),
    "回退分支 = 旧的等额扣减（逐字相同）"
  );
  check(
    /const exact = work\.map\(\(w\) => \(w \/ sumWork\) \* teamTotal\);/.test(matchSrc),
    "分摊按「跑动距离占比 × 球队总量」"
  );
  check(
    /const teamTotal = perPlayer \* xi\.length;/.test(matchSrc),
    "球队总量 = 每人名义扣减 × 人数（总量口径不变）"
  );
}

// ─────────────────────────────────────────────────────────────
function player(id, pos, ovr, fitness = 90) {
  return {
    id, name: id, pos, ovr, potential: ovr + 1, age: 27,
    fitness, morale: 70, injured: 0, suspendedMatches: 0, attrs: {},
  };
}
function squad() {
  const ps = [player("gk", "GK", 14), player("gk2", "GK", 13)];
  for (let i = 0; i < 7; i++) ps.push(player(`d${i}`, "DEF", +(16 - i * 0.3).toFixed(2)));
  for (let i = 0; i < 8; i++) ps.push(player(`m${i}`, "MID", +(16 - i * 0.25).toFixed(2)));
  for (let i = 0; i < 6; i++) ps.push(player(`a${i}`, "ATT", +(16 - i * 0.4).toFixed(2)));
  for (const p of ps) {
    generatePlayerAttributes(p, p.ovr);
    ensureFootballProfile(p);
  }
  return ps;
}
function buildWorld() {
  return {
    clubs: [
      { id: "user", name: "User", power: 70, players: squad(), tactics: defaultTactics(), staff: {} },
      { id: "opp", name: "Opponent", power: 65, players: squad(), tactics: defaultTactics() },
    ],
    userClubId: "user", season: 2026, day: 5,
  };
}

// ─────────────────────────────────────────────────────────────
console.log("\n[3] 动态（空间引擎 + 直播路径）：守恒 + 差异 + 排序");
let spatial = null;
{
  const world = buildWorld();
  const club = world.clubs[0];
  const fixture = { day: 5, home: "user", away: "opp", played: false, matchSeed: 424242 };
  const state = createMatchSession(world, fixture);
  const xi0 = getLineupPlayers(club);
  const sumBefore = xi0.reduce((s, p) => s + (p.fitness || 100), 0);
  await playFirstHalf(state, {});

  const xi = getLineupPlayers(club);
  const sumAfter = xi.reduce((s, p) => s + (p.fitness || 100), 0);
  const vals = xi.map((p) => p.fitness);
  const uniq = new Set(vals.map((v) => Math.round(v)));
  const shown = xi.map((p) => Math.round(p.fitness)).sort((a, b) => a - b);

  // 引擎侧跑动距离
  const runById = new Map((state.simEng?.agents || []).map((a) => [a.id, Number(a.runMetres) || 0]));
  const rows = xi.map((p) => ({ id: p.id, run: runById.get(p.id) ?? 0, fit: p.fitness }));
  const kms = rows.map((r) => r.run / 1000);
  const kmMin = kms.reduce((m, v) => (v < m ? v : m), Infinity);
  const kmMax = kms.reduce((m, v) => (v > m ? v : m), -Infinity);

  console.log(`     赛前 Σ=${sumBefore}  中场 Σ=${sumAfter.toFixed(4)}  差=${(sumBefore - sumAfter).toFixed(4)}`);
  console.log(`     面板显示值：${shown.join(", ")}（取值种类 ${uniq.size}）`);
  console.log(`     跑动距离：${kmMin.toFixed(2)} ~ ${kmMax.toFixed(2)} km（比值 ${(kmMax / kmMin).toFixed(2)}×）`);

  // ① 球队总量精确守恒：上半场 3 次结算（15'/30'/45'）
  const spent = sumBefore - sumAfter;
  check(Math.abs(spent % 11) < 1e-6, "球队总量是「11 的整数倍」（= 每人名义扣减 × 人数 × 结算次数）",
    `实测 ${spent.toFixed(6)}`);
  check(Math.abs(spent / 33 - 1) < 1e-6, "每人名义扣减 = 1 点（默认战术），3 次结算 ⇒ 共 33 点",
    `实测 ${(spent / 33).toFixed(6)}`);
  // ② 队内出现差异（旧实现是团块：取值种类 = 1）
  check(uniq.size > 1, "队内体能**不再是同一个值**", `取值种类 ${uniq.size}`);
  check(
    Math.max(...shown) - Math.min(...shown) >= 2,
    "面板显示值的极差 ≥ 2 点（肉眼可见）",
    `${Math.min(...shown)} ~ ${Math.max(...shown)}`
  );
  // ③ 排序：跑动距离最少的球员扣得最少
  const sortedByRun = rows.slice().sort((a, b) => a.run - b.run);
  const sortedByFit = rows.slice().sort((a, b) => b.fit - a.fit);
  check(
    sortedByRun[0].id === sortedByFit[0].id,
    "跑动最少的球员体能最高",
    `跑动最少 ${sortedByRun[0].id}(${(sortedByRun[0].run / 1000).toFixed(2)}km) / 体能最高 ${sortedByFit[0].id}`
  );
  check(
    sortedByRun[sortedByRun.length - 1].id === sortedByFit[sortedByFit.length - 1].id,
    "跑动最多的球员体能最低",
    `跑动最多 ${sortedByRun[sortedByRun.length - 1].id} / 体能最低 ${sortedByFit[sortedByFit.length - 1].id}`
  );
  // ④ 引擎侧的 runMetres 真的累加了（不是全 0 —— 全 0 会静默走回退，看着「没报错」）
  check(kmMin > 0.5, "引擎累计跑动距离不是 0（否则会静默走回退）", `min ${kmMin.toFixed(2)}km`);

  spatial = { sumBefore, sumAfter, spent };
}

// ─────────────────────────────────────────────────────────────
console.log("\n[4] 动态（概率引擎）：无 simEng ⇒ 回退 ⇒ 仍是等额");
{
  const world = buildWorld();
  const club = world.clubs[0];
  const fixture = { day: 5, home: "user", away: "opp", played: false, matchSeed: 424242 };
  const state = createMatchSession(world, fixture, { engineMode: "probability" });
  await playFirstHalf(state, {});
  const xi = getLineupPlayers(club);
  const uniq = new Set(xi.map((p) => p.fitness));
  console.log(`     simEng=${state.simEng ? "存在" : "不存在"}；体能取值种类 ${uniq.size}`);
  check(!state.simEng, "概率路径没有创建 simEng（⇒ 每次结算都走回退）");
  check(uniq.size === 1, "概率路径仍是等额扣减（旧行为不变）", `取值 ${[...uniq].join(",")}`);
  check(
    [...uniq].every((v) => Number.isInteger(v)),
    "概率路径的体能仍是整数（回退分支带 Math.round）"
  );
}

console.log("");
if (failed) {
  console.error(`❌ 体能分摊验收失败：${failed} 项`);
  process.exit(1);
}
console.log("✅ 体能分摊验收通过：总量守恒 · 队内出现差异 · 排序与跑动距离一致 · 概率路径行为不变");
