// 只读探针：验证「引擎是否在比赛中/中场换边」
//
// 用户报告：「下半场双方交换场地（似乎只有进球庆祝后才会交换场地）」
//
// 本探针**不问代码怎么写，只量实际发生了什么**：
//   ① 每 5 分钟采一次两队球员的 y 中位数 ⇒ 若换边，home 的 y 会在某时刻从「大」变「小」
//   ② 记录每一次 `_kickoff`（进球后 / 开场）后的两队 y 中位数
//   ③ 记录 `_restart` 的所有类型与球位，看有没有「半场重启」
//
// 用法：node scripts/_halftime-side-swap-probe.mjs [场数=2] [起始种子=391000]

import { SimEngine } from "../js/sim/engine.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 2);
const START_SEED = Math.max(1, Number(process.argv[3]) || 391000);
const DT = 0.1;
const FULL_SECONDS = 5400; // 90 分钟

const MX = 68 / 100;
const MY = 105 / 100;

function makeClub(name) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((role, i) => {
    const attrs = {};
    for (const k of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical",
      "finishing", "tackling", "marking", "strength", "stamina", "vision",
      "reflexes", "handling", "positioning", "kicking", "decisions",
    ]) attrs[k] = 15;
    return {
      id: `${name}-${i}`,
      name: `${name} ${i}`,
      role,
      number: i + 1,
      attrs,
      playingHabits: [],
    };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((p) => p.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      width: 3,
      style: "balanced",
    },
  };
}

/** 某队（非 GK）的 y 中位数 */
function medianY(engine, team) {
  const ys = engine.agents
    .filter((a) => a.team === team && a.role !== "GK" && !a.sentOff)
    .map((a) => a.y)
    .sort((a, b) => a - b);
  if (!ys.length) return null;
  return ys[Math.floor(ys.length / 2)];
}

function medianX(engine, team) {
  const xs = engine.agents
    .filter((a) => a.team === team && a.role !== "GK" && !a.sentOff)
    .map((a) => a.x)
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.floor(xs.length / 2)];
}

const KICKOFFS = [];
const RESTARTS = new Map();
const SAMPLES = [];
const EVENTS = [];

for (let m = 0; m < MATCHES; m++) {
  const seed = START_SEED + m;
  const engine = new SimEngine(makeClub(`home-${seed}`), makeClub(`away-${seed}`), { seed });

  // 包装 _kickoff：记录每次开球后的两队 y 中位数
  const origKickoff = engine._kickoff.bind(engine);
  engine._kickoff = function probeKickoff(team) {
    const r = origKickoff(team);
    KICKOFFS.push({
      seed,
      t: this.t,
      minute: this.t / 60,
      team,
      homeY: medianY(this, "home"),
      awayY: medianY(this, "away"),
      homeX: medianX(this, "home"),
      awayX: medianX(this, "away"),
    });
    return r;
  };

  // 包装 _restart：统计类型与球位
  const origRestart = engine._restart.bind(engine);
  engine._restart = function probeRestart(type, team, x, y) {
    const k = `${type}`;
    RESTARTS.set(k, (RESTARTS.get(k) || 0) + 1);
    return origRestart(type, team, x, y);
  };

  let lastSample = -1;
  for (let i = 0; i < FULL_SECONDS / DT; i++) {
    engine.step(DT);
    if (engine.events && engine.events.length) {
      for (const ev of engine.events) {
        if (ev.type === "goal" || ev.type === "ht" || ev.type === "ft") {
          EVENTS.push({ seed, t: engine.t, type: ev.type, teamId: ev.teamId ?? null });
        }
      }
      engine.events.length = 0;
    }
    // 每 300 秒（5 分钟）采一次
    const bucket = Math.floor(engine.t / 300);
    if (bucket !== lastSample) {
      lastSample = bucket;
      SAMPLES.push({
        seed,
        t: engine.t,
        minute: engine.t / 60,
        homeY: medianY(engine, "home"),
        awayY: medianY(engine, "away"),
      });
    }
  }
}

console.log("========================================================");
console.log("引擎换边验证探针（只读）");
console.log(`  ${MATCHES} 场 / 全场 90 分钟 / 种子 ${START_SEED}..${START_SEED + MATCHES - 1}`);
console.log("========================================================");

console.log("\n【① 每 5 分钟的两队 y 中位数 —— 若换边，home 的 y 会从大变小】");
console.log("  分钟   homeY   awayY   和      ← 和≈100 表示分居两侧");
for (const s of SAMPLES) {
  if (s.homeY == null || s.awayY == null) continue;
  const sum = s.homeY + s.awayY;
  console.log(
    `  ${String(Math.round(s.minute)).padStart(4)}'  ${String(s.homeY.toFixed(1)).padStart(6)}  ${String(s.awayY.toFixed(1)).padStart(6)}  ${String(sum.toFixed(1)).padStart(6)}`
  );
}

console.log("\n【② 每次开球（开场 + 进球后）的两队 y 中位数】");
console.log("  场  时刻/min  开球方   homeY   awayY    homeX   awayX");
for (const k of KICKOFFS) {
  console.log(
    `  ${String(k.seed - START_SEED).padStart(2)}  ${String(k.minute.toFixed(1)).padStart(8)}'  ${k.team.padEnd(6)}  ${String(k.homeY.toFixed(1)).padStart(6)}  ${String(k.awayY.toFixed(1)).padStart(6)}  ${String(k.homeX.toFixed(1)).padStart(7)}  ${String(k.awayX.toFixed(1)).padStart(7)}`
  );
}

console.log("\n【③ 上半场 vs 下半场的 y 中位数对比（关键判据）】");
{
  const first = SAMPLES.filter((s) => s.minute <= 45 && s.homeY != null);
  const second = SAMPLES.filter((s) => s.minute > 45 && s.homeY != null);
  const avg = (arr, key) => (arr.length ? arr.reduce((a, b) => a + b[key], 0) / arr.length : NaN);
  console.log(`  上半场 homeY 均值: ${avg(first, "homeY").toFixed(2)}   awayY 均值: ${avg(first, "awayY").toFixed(2)}`);
  console.log(`  下半场 homeY 均值: ${avg(second, "homeY").toFixed(2)}   awayY 均值: ${avg(second, "awayY").toFixed(2)}`);
  const dHome = avg(second, "homeY") - avg(first, "homeY");
  const dAway = avg(second, "awayY") - avg(first, "awayY");
  console.log(`  变化: home ${dHome >= 0 ? "+" : ""}${dHome.toFixed(2)}   away ${dAway >= 0 ? "+" : ""}${dAway.toFixed(2)}`);
  console.log(`  ⇒ 若换边成立，homeY 应出现大幅负向变化（从 ~60+ 掉到 ~35-），awayY 反向`);
  console.log(`  实测判定: ${Math.abs(dHome) > 12 && Math.sign(dHome) !== Math.sign(dAway) ? "★ 检测到换边" : "未检测到换边（home 恒在同一侧）"}`);
}

console.log("\n【④ 重启类型统计（找有没有「半场重启」这种东西）】");
for (const [k, v] of [...RESTARTS.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(6)}`);
}

console.log("\n【⑤ 进球 / 中场 / 全场事件】");
const byType = new Map();
for (const e of EVENTS) byType.set(e.type, (byType.get(e.type) || 0) + 1);
for (const [k, v] of byType) console.log(`  ${k.padEnd(8)} ${String(v).padStart(6)}`);
console.log(`  （引擎是否发过 "ht" 事件: ${byType.has("ht") ? "是" : "否 ⇒ 引擎不知道「中场」这个概念"}）`);
