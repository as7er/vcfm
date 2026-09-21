/**
 * 战术响应回归（2026-09-22）—— 「球员读懂战术」的**快档**常驻检查（约 9 秒）。
 *
 * ## 与 `_tactics-understanding-probe.mjs` 的分工
 *
 * 那个是**深度摸底**（4 种子 × 30 分钟 ≈ 260 秒，出全套读数 + SD，用于发现与论证）；
 * 本文件是**快档断言**，把关键结论钉成回归，放进 `verify.mjs`。
 *
 * ## 为什么必须存在（2026-09-22 的教训）
 *
 * 审计查明：`width` / `tempo` / `style` 这些战术旋钮**从来没有被任何探针扫过**
 * （在 `scripts/` 里只作为 fixture 字面量出现）⇒「旋钮死了 / 响应反了」可以长期全绿。
 *
 * 🔴 更关键：**判据要量「旋钮代码里直接改的那个量」**。
 * 第一版摸底用「传球数」判 `tempo`，得出「tempo 是死的」——**错的**；
 * 它直接改的是「拿球后多久决定」，换成**持球时长**后信号立刻出来（−15%，6σ）。
 *
 * ## 判据（快档只比两端 1 vs 5，样本预算花在**重复**上）
 *
 * | 旋钮 | 量什么 | 期望 |
 * |---|---|---|
 * | `width` | 非中央槽位的横向 \|x−50\|（米，行为量） | 1→5 变化 ≥ 2 m |
 * | `defensiveLine` | `_defLineY()`（**直接量**，受控局面） | 1→5 变化 ≥ 4 格 |
 * | `pressing` | 同上（2026-09-22 新加：压迫轻推防线） | 1→5 变化 ≥ 2 格 |
 * | `tempo` | 持球时长（秒，行为量） | 1→5 下降 ≥ 0.2 s |
 *
 * ⚠ 快档第一版四个旋钮都走行为量，`defensiveLine` / `pressing` 在 3 种子 × 12 分钟下
 * 跨度只有 3.4 / 1.2 格 —— **不是没响应，是行为量把直接信号稀释了**。
 * 改成直接调 `_defLineY()` 后零噪声（实测 −15.2 / −11.2 格，与代码逐位吻合）。
 *
 * 用法：node scripts/tactics-response-verify.mjs
 */

import { readFileSync } from "node:fs";
import { SimEngine } from "../js/sim/engine.js";
import { teamShapeProfile } from "../js/team-shapes.js";
import { collectiveDefenseProfile } from "../js/collective-defense.js";

const SEEDS = 3;
const MINUTES = 12;
const DT = 0.1;
const STEPS = Math.round((MINUTES * 60) / DT);
const WARMUP = Math.round(30 / DT);
const MX = 0.68;
const LOW = 1;
const HIGH = 5;

let failed = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
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

function makeClub(name) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((role, i) => {
    const attrs = {};
    for (const k of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical",
      "finishing", "tackling", "marking", "strength", "stamina", "vision",
      "reflexes", "handling", "positioning", "kicking", "decisions", "crossing", "heading",
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

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** 行为量：跑一场，采横向 / 持球时长 */
function measure(level, knob) {
  const per = [];
  for (let s = 0; s < SEEDS; s += 1) {
    const eng = new SimEngine(makeClub("h"), makeClub("a"), { random: mulberry32(770000 + s) });
    Object.assign(eng.home.tactics, { [knob]: level });

    const lateral = [];
    const holds = [];
    let prevOwner = null;
    let runStart = 0;

    for (let i = 0; i < STEPS; i += 1) {
      eng.step();
      if (i < WARMUP) continue;

      const owner = eng.ball.owner;
      if (owner !== prevOwner) {
        if (prevOwner != null) {
          const dur = i * DT - runStart;
          if (dur >= 0.3) holds.push(dur);
        }
        prevOwner = owner;
        if (owner != null) runStart = i * DT;
      }

      if (i % 5 === 0) {
        for (const a of eng.agents) {
          if (a.team !== "home" || a.role === "GK" || a.sentOff) continue;
          if (Math.abs(a.baseX - 50) >= 8) lateral.push(Math.abs(a.x - 50) * MX);
        }
      }
    }
    per.push({ lateral: mean(lateral), hold: mean(holds) });
  }
  return {
    lateral: per.reduce((s, v) => s + v.lateral, 0) / per.length,
    hold: per.reduce((s, v) => s + v.hold, 0) / per.length,
  };
}

/**
 * 直接量：`defensiveLine` / `pressing` 直接改的就是 `_defLineY()` 的输出，
 * 所以**受控局面下直接调它**，零噪声。
 * （`width` / `tempo` 的直接输出要经 `_applyAttackTactics` 混合才看得到 ⇒ 走行为量。）
 */
function defLineDirect(level, knob) {
  const eng = new SimEngine(makeClub("h"), makeClub("a"), { random: mulberry32(1) });
  Object.assign(eng.home.tactics, { [knob]: level });
  eng.ball.x = 50;
  eng.ball.y = 50;
  eng.ball.owner = null;
  eng.ball.state = "loose";
  const defs = eng.agents.filter((a) => a.team === "home" && a.role === "DEF");
  return defs.reduce((s, a) => s + eng._defLineY(a), 0) / Math.max(1, defs.length);
}

function behaviorSpan(knob, pick, minSpan, wantDown = false) {
  const a = pick(measure(LOW, knob));
  const b = pick(measure(HIGH, knob));
  const delta = b - a;
  return { a, b, delta, ok: Math.abs(delta) >= minSpan && (!wantDown || delta < 0) };
}

function directSpan(knob, minSpan) {
  const a = defLineDirect(LOW, knob);
  const b = defLineDirect(HIGH, knob);
  return { a, b, delta: b - a, ok: Math.abs(b - a) >= minSpan };
}

const show = (r, d) => `${r.a.toFixed(d)} → ${r.b.toFixed(d)}（${r.delta > 0 ? "+" : ""}${r.delta.toFixed(d)}）`;

// ── [1] 静态：默认档必须逐位不变的写法 / 两模块一致 ─────────────────────────
console.log("\n[1] 静态：写法与一致性");
{
  const engine = readFileSync("js/sim/engine.js", "utf8");
  check(
    /\(pressLevel - 3\) \* \(a\.role === "DEF"/.test(engine),
    "`_defLineY` 的 pressPush 写成 `(pressLevel - 3)` ⇒ `pressing=3`（默认档）时为零"
  );

  const shape = teamShapeProfile({ style: "counter", pressing: 4, width: 3, tempo: 3, defensiveLine: 3 });
  const cd = collectiveDefenseProfile({ style: "counter", pressing: 4, width: 3, defensiveLine: 3 });
  // 只钉「两处模块彼此一致」——同一份事实不能两处各写一套。
  // 语义要不要改（反击该不该「丢球后回收」）留作产品决策：2026-09-22 试改过、**已撤回**，
  // 因为它推翻 `team-shapes-audit.mjs:75` 的既有断言，且实测效果在噪声内（≈0.43σ）。
  check(
    cd.regroup === shape.transition.regroup && cd.counterPress === shape.transition.counterPress,
    "`collective-defense` 与 `team-shapes` 的 regroup / counterPress **彼此一致**",
    `counterPress=${shape.transition.counterPress} regroup=${shape.transition.regroup}`
  );

  const bal = teamShapeProfile({ style: "balanced", pressing: 3, width: 3, tempo: 3, defensiveLine: 3 });
  check(
    bal.transition.regroup === false && bal.transition.counterPress === false,
    "`balanced` 默认档两个标志都不变（均为 false）"
  );
}

// ── [2] 行为 / 直接量：四个旋钮 ─────────────────────────────────────────────
console.log("\n[2] 旋钮 → 它**直接改的那个量**");
{
  const r = behaviorSpan("width", (m) => m.lateral, 2);
  check(r.ok, "width 1→5 ⇒ 横向 |x−50| 变化 ≥ 2 m（行为量）", show(r, 2));
}
{
  const r = directSpan("defensiveLine", 4);
  check(r.ok, "defensiveLine 1→5 ⇒ `_defLineY` 变化 ≥ 4 格（直接量，零噪声）", show(r, 1));
}
{
  const r = directSpan("pressing", 2);
  check(
    r.ok,
    "pressing 1→5 ⇒ `_defLineY` 变化 ≥ 2 格（2026-09-22 新加：压迫轻推防线，原来完全不跟）",
    show(r, 1)
  );
}
{
  const r = behaviorSpan("tempo", (m) => m.hold, 0.2, true);
  check(r.ok, "tempo 1→5 ⇒ 持球时长下降 ≥ 0.2 s（行为量）", show(r, 3));
}

if (failed) {
  console.error(`\ntactics-response-verify: ${failed} 项失败`);
  process.exit(1);
}
console.log("\ntactics-response-verify: ok");
