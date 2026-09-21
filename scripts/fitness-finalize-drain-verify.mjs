/**
 * 终场体能「按跑动距离分摊」（方案 E）—— 回归检查。
 *
 * 背景：`js/match.js` 的 `drainFitness` 原来是**逐人掷骰子**
 * （`4 + Math.floor(rng() * 6)`），与跑动距离完全无关 ⇒「跑了 13km 的人」
 * 可能比「跑了 8km 的人」扣得更少。这是用户最初报的「各队员体能显示不对」的
 * 另一半（中场那 6 点已由方案 D 改成按跑动分摊；终场这 4~9 点比它还大）。
 *
 * 本检查守四条：
 *  1. **静态**：`drainFitness` 真的读 `state.simEng` / `runMetres`；
 *     比例分摊那一行**不许**再套 `Math.round`（套了分辨率就没了）；
 *     回退分支仍在。
 *  2. **空间路径行为**：终场扣减与跑动**严格成正比**（比值恒定 ⇒ Spearman = 1）。
 *  3. **回退路径行为**：把全体 `runMetres` 清零（读档重建 / 概率引擎的情形）
 *     ⇒ 必须退回旧的等额掷骰：体能是**整数**、且与跑动**不成比例**。
 *  4. **量级不变**：球队总量仍落在旧骰子的 [4n, 9n] 区间、逐人均值 ≈ 6.5
 *     ⇒ 「零重标定」不是嘴上说的。
 *
 * 用法：node scripts/fitness-finalize-drain-verify.mjs   （约 40 秒）
 */

import { readFileSync } from "node:fs";
import { defaultTactics, getLineupPlayers } from "../js/models.js";
import { generatePlayerAttributes } from "../js/player-attributes.js";
import {
  createMatchSession,
  playFirstHalf,
  playSecondHalf,
  finalizeMatch,
} from "../js/match.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 2);
const BASE_SEED = 910000;

let failed = 0;
function check(ok, label, detail = "") {
  const mark = ok ? "  ✓" : "  ✗";
  console.log(`${mark} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

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

// ---- 1. 静态 ---------------------------------------------------------------

const mv = readFileSync("js/match.js", "utf8");
function bodyOf(src, signature) {
  // ⚠ 锚「行首缩进 + 签名 + {」——`indexOf(签名)` 命中的会是**调用点**（老坑）。
  const re = new RegExp(`^[ \\t]*${signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*\\{`, "m");
  const m = re.exec(src);
  if (!m) return "";
  const open = src.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

console.log("\n[1] 静态：`js/match.js` 的 `drainFitness`");
{
  const body = bodyOf(mv, "function drainFitness(club, isHome, state)");
  check(body.length > 800 && body.length < 20000, "定位到 `drainFitness` 定义体", `长度 ${body.length}`);
  check(/state\.simEng/.test(body), "读 `state.simEng`");
  check(/runMetres/.test(body), "读 `agent.runMetres`");
  check(/sumWork > 0/.test(body), "有「拿不到跑动距离」的判定");
  // 回退分支必须与旧实现一致（逐字），否则读档/概率引擎路径行为会变
  check(
    /p\.fitness = Math\.round\(Math\.max\(35, p\.fitness - drain\)\)/.test(body),
    "回退分支仍是旧的等额掷骰（逐字保留）"
  );
  // 比例分摊那一行不许套 Math.round
  check(
    /p\.fitness = Math\.max\(35, \(Number\(p\.fitness\) \|\| 100\) - \(work\[i\] \/ sumWork\) \* teamTotal\)/.test(body),
    "比例分摊行**未**套 `Math.round`（保分辨率）"
  );
  // 两支路各一次 rng ⇒ 消耗次数与旧实现相同（不解平移全局随机流）。
  // ⚠ 这是**文本**代理，不是行为断言：它只能抓住「整块回退」，抓不住
  //   「只抽一颗骰子再乘人数」这种写法（那种也恰好 2 处、也落在 [4n, 9n]）。
  //   所以下面再加一条形状断言钉住「累计是在 `xi.length` 次循环里做的」。
  const draws = (body.match(/rng\(\)/g) || []).length;
  check(draws === 2, "`rng()` 恰好出现 2 次（两支路各一）⇒ 抽取次数与旧实现一致", `实际 ${draws}`);
  check(
    /for \(let i = 0; i < xi\.length; i \+= 1\) \{\s*\n\s*teamTotal \+=/.test(body),
    "球队总量是**逐人累加** `xi.length` 次（排除「抽一颗再乘人数」的退化解）"
  );
}

// ---- 驱动一场比赛 ----------------------------------------------------------

function mkPlayer(id, pos, ovr) {
  const p = {
    id, name: id, pos, ovr, potential: ovr + 1, age: 27,
    fitness: 90, morale: 70, injured: 0, suspendedMatches: 0, attrs: {},
  };
  generatePlayerAttributes(p, p.ovr);
  return p;
}

function squad(tag) {
  const players = [mkPlayer(`${tag}_gk`, "GK", 14), mkPlayer(`${tag}_gk2`, "GK", 13)];
  for (let i = 0; i < 7; i++) players.push(mkPlayer(`${tag}_d${i}`, "DEF", +(16 - i * 0.3).toFixed(2)));
  for (let i = 0; i < 8; i++) players.push(mkPlayer(`${tag}_m${i}`, "MID", +(16 - i * 0.25).toFixed(2)));
  for (let i = 0; i < 6; i++) players.push(mkPlayer(`${tag}_a${i}`, "ATT", +(16 - i * 0.4).toFixed(2)));
  return players;
}

function makeWorld() {
  const mk = (id, name, power, tag) => ({
    id, name, power, players: squad(tag), tactics: defaultTactics(), form: [], staff: {},
  });
  return {
    clubs: [mk("user", "User", 70, "h"), mk("opp", "Opponent", 65, "a")],
    userClubId: "user", season: 2026, day: 5, table: [], news: [],
  };
}

/**
 * 跑完一整场并在 `finalizeMatch` 前后各取一次体能。
 * `zeroWork=true` 时把全体 `runMetres` 清零 ⇒ 强制走回退分支
 * （这正是「读档后引擎重建」的真实情形，比删掉 `simEng` 更贴近生产且更安全）。
 */
async function playAndFinalize(seed, zeroWork) {
  const world = makeWorld();
  const club = world.clubs[0];
  const fixture = { day: 5, home: "user", away: "opp", played: false, id: `f${seed}`, matchSeed: seed >>> 0 };
  const state = createMatchSession(world, fixture, { random: mulberry32(seed) });
  await playFirstHalf(state, {});
  await playSecondHalf(state, {});

  if (zeroWork) {
    for (const a of state.simEng?.agents || []) a.runMetres = 0;
  }

  const runById = new Map();
  for (const a of state.simEng?.agents || []) {
    if (a?.id != null) runById.set(a.id, Number(a.runMetres) || 0);
  }
  const sent = state.sentOff?.home || new Set();
  const xi = getLineupPlayers(club).filter((p) => p && !sent.has(p.id));
  const before = new Map(xi.map((p) => [p.id, Number(p.fitness) || 0]));

  finalizeMatch(state);

  const work = xi.map((p) => runById.get(p.id) ?? 0);
  const drain = xi.map((p) => (before.get(p.id) ?? 0) - (Number(p.fitness) || 0));
  const fitness = xi.map((p) => Number(p.fitness));
  return { xi, work, drain, fitness };
}

// ---- 2. 空间路径：严格成正比 -----------------------------------------------

console.log("\n[2] 空间路径：终场扣减必须与跑动严格成正比");
const meanPerPlayer = [];
for (let m = 0; m < MATCHES; m += 1) {
  const seed = BASE_SEED + m;
  const { xi, work, drain } = await playAndFinalize(seed, false);
  const sumWork = work.reduce((s, v) => s + v, 0);
  const teamTotal = drain.reduce((s, v) => s + v, 0);
  const n = xi.length;

  check(sumWork > 0, `场 ${m + 1}：拿到跑动距离`, `${(sumWork / 1000).toFixed(1)} km / ${n} 人`);
  // 严格成正比：drain_i / work_i 必须恒定
  const ratios = work.map((w, i) => (w > 0 ? drain[i] / w : null)).filter((v) => v !== null);
  const rMin = Math.min(...ratios);
  const rMax = Math.max(...ratios);
  check(
    rMax - rMin < 1e-9,
    `场 ${m + 1}：逐人「扣减/跑动」比值恒定（严格比例分摊）`,
    `${rMin.toExponential(6)} ~ ${rMax.toExponential(6)}`
  );
  // 量级：球队总量仍应是 n 次 4~9 骰子之和（未触 35 下限时的守恒前提）
  check(
    teamTotal >= 4 * n - 1e-6 && teamTotal <= 9 * n + 1e-6,
    `场 ${m + 1}：球队总量仍在旧骰子区间 [${4 * n}, ${9 * n}]`,
    `实际 ${teamTotal.toFixed(3)}`
  );
  meanPerPlayer.push(teamTotal / n);
}
{
  const mean = meanPerPlayer.reduce((s, v) => s + v, 0) / meanPerPlayer.length;
  check(Math.abs(mean - 6.5) < 1.5, "逐人平均扣减仍 ≈ 6.5 点（旧骰子 4~9 的均值）⇒ 零重标定", `实际 ${mean.toFixed(2)}`);
}

// ---- 3. 回退路径：仍走旧的等额掷骰 -----------------------------------------

console.log("\n[3] 回退路径（全体 runMetres 清零 ⇒ 读档重建 / 概率引擎情形）");
{
  const seed = BASE_SEED + 100;
  const { xi, work, drain, fitness } = await playAndFinalize(seed, true);
  check(work.every((v) => v === 0), "跑动距离确实为 0（回退条件成立）");
  check(
    fitness.every((v) => Number.isInteger(v)),
    "体能仍是**整数**（旧实现逐人 `Math.round` 的特征）",
    `取值 ${[...new Set(fitness)].sort((a, b) => a - b).join(",")}`
  );
  const positive = drain.filter((v) => v > 0);
  const distinct = new Set(positive);
  // ⚠ 判据要能区分「旧实现逐人掷骰」与「等额分摊 + Math.round」：
  //   后者会让所有球员扣减**完全相同** ⇒ `distinct.size === 1`。
  //   11 次 4~9 的骰子实际会给出约 5~6 个不同取值，取 3 作下界留有充分余量。
  check(
    distinct.size >= 3,
    "扣减呈掷骰散布（≥3 个不同取值），而非等额分摊",
    `取值集合 ${[...distinct].sort((a, b) => a - b).join(",")}`
  );
  check(xi.length > 0, "回退路径仍结算了首发", `${xi.length} 人`);
}

// ---- 4. 结论 ---------------------------------------------------------------

if (failed) {
  console.error(`\nfitness-finalize-drain-verify: ${failed} 项失败`);
  process.exit(1);
}
console.log("\nfitness-finalize-drain-verify: ok");
