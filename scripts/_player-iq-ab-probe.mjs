/**
 * 球员「比赛智商」A/B（2026-09-24）——三项精神属性到底有没有进入决策？
 *
 * 问题：与 FM26 比「球员智能化」，最核心的一条是**同一局面下，聪明的球员做出更好的选择**。
 * 本仓库球员只有三项精神属性：`decisions` / `vision` / `positioning`。
 * 本探针在**产品路径**上（`createWorld` 真实球队 → `createMatchSession` → `ensureSimEngine`
 * → `runSimPeriodRaw` 两个半场）做配对 A/B：
 *   同一对阵、同一随机种子，**唯一变量**是主队 10 名外场球员的三项精神属性 = 6 或 16。
 * 其余属性（速度、传球、射门……）逐位相同 ⇒ 差值只能来自「会不会读比赛」。
 *
 * 期望方向（现实 / FM 的共识）：高智商 ⇒ 传球成功率↑、射门选择更好（距离↓、受压↓）、
 * 丢球权↓、对手射门↓、净胜球↑。若某项**无变化**，说明那条决策链没接属性。
 *
 * ⚠ 纪律：引擎不认 `opts.seed`，随机源经 `state.random` 注入；配对差用逐种子差值的 SE。
 *
 * 用法：node scripts/_player-iq-ab-probe.mjs [种子数=8]
 */
import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession } from "../js/match.js";
import { createWorld } from "../js/models.js";
import { ensureSimEngine, runSimPeriodRaw } from "../js/sim/adapt.js";
import { ensureStaff } from "../js/staff.js";

const SEEDS = Math.max(2, Number(process.argv[2]) || 8);
const MENTAL = ["decisions", "vision", "positioning"];
const LOW = 6;
const HIGH = 16;

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

const startClub = CLUB_TEMPLATES.find((club) => club.division === 3);
// ⚠ createWorld / ensureStaff 用的是 Math.random：不固定的话每个进程造出的球员都不同，
//   改动前后两次运行比的就不是同一批人。教练 ID 还含 Date.now，而教练战术身份按 ID 哈希推出，
//   所以两者都要固定。造世界期间临时替换，造完还原。
const realMathRandom = Math.random;
const realDateNow = Date.now;
Math.random = mulberry32(0x1a2b3c);
Date.now = () => 1789000000000;
const source = createWorld(startClub.id, "Player IQ AB");
const fixture = source.fixtures.find((f) => f.home === source.userClubId);
if (!fixture) throw new Error("找不到用户主场赛程");
// ⚠ 新世界的教练组是懒创建的：`createMatchSession` 里的 `ensureStaff` 用未种子化的 Math.random
//   现场生成教练 ⇒ 每次克隆都换一套教练 ⇒ simModifiers 与 AI 首发随之漂移，配对 A/B 失效。
//   必须在克隆前把教练组固化到 source 上（真实存档里教练只生成一次，不受此影响）。
for (const club of source.clubs) ensureStaff(club);
Math.random = realMathRandom;
Date.now = realDateNow;

function runOnce(seed, iq) {
  const world = structuredClone(source);
  const fx = world.fixtures.find((f) => f.id === fixture.id);
  const home = world.clubs.find((c) => c.id === fx.home);
  for (const p of home.players) {
    if (p.pos === "GK") continue;
    for (const k of MENTAL) p.attrs[k] = iq;
  }
  const state = createMatchSession(world, fx);
  state.random = mulberry32(seed);
  const engine = ensureSimEngine(state);
  // 控球占比：每秒看一次持球方
  let ownHome = 0;
  let ownAny = 0;
  const sample = () => {
    const owner = engine.ball.owner ? engine.agentById(engine.ball.owner) : null;
    if (!owner) return;
    ownAny++;
    if (owner.team === "home") ownHome++;
  };
  const origStep = engine.step.bind(engine);
  let acc = 0;
  engine.step = (dt) => {
    origStep(dt);
    acc += dt;
    if (acc >= 1) {
      acc -= 1;
      sample();
    }
  };
  runSimPeriodRaw(engine, 1, 45);
  runSimPeriodRaw(engine, 46, 90);

  const m = {
    passes: 0, completed: 0, through: 0, crosses: 0,
    shots: 0, shotDist: 0, shotPressure: 0, oppShots: 0,
    goalsFor: 0, goalsAgainst: 0, lostToIntercept: 0, lostToTackle: 0,
  };
  for (const e of engine.events) {
    const mine = e.team === "home";
    if (e.type === "pass" && mine) {
      m.passes++;
      if (e.through && !e.cross) m.through++;
      if (e.cross) m.crosses++;
    } else if (e.type === "receive" && mine) m.completed++;
    else if (e.type === "shot") {
      if (mine) {
        m.shots++;
        m.shotDist += Number(e.distance) || 0;
        m.shotPressure += Number(e.pressure) || 0;
      } else m.oppShots++;
    } else if (e.type === "goal") {
      if (mine) m.goalsFor++;
      else m.goalsAgainst++;
    } else if (e.type === "intercept" && !mine) m.lostToIntercept++;
    else if (e.type === "tackle" && !mine) m.lostToTackle++;
  }
  return {
    passPct: m.completed / Math.max(1, m.passes) * 100,
    passes: m.passes,
    through: m.through,
    shots: m.shots,
    shotDist: m.shotDist / Math.max(1, m.shots),
    shotPressure: m.shotPressure / Math.max(1, m.shots),
    oppShots: m.oppShots,
    goalDiff: m.goalsFor - m.goalsAgainst,
    turnovers: m.lostToIntercept + m.lostToTackle,
    possessionPct: ownHome / Math.max(1, ownAny) * 100,
  };
}

const keys = [
  ["passPct", "传球成功率 %", +1],
  ["passes", "传球次数", 0],
  ["through", "直塞次数", 0],
  ["possessionPct", "控球率 %", +1],
  ["turnovers", "被断/被抢次数", -1],
  ["shots", "射门次数", 0],
  ["shotDist", "射门平均距离（格）", -1],
  ["shotPressure", "射门时平均受压", -1],
  ["oppShots", "对手射门次数", -1],
  ["goalDiff", "净胜球", +1],
];
const lows = [];
const highs = [];
const t0 = Date.now();
for (let s = 0; s < SEEDS; s++) {
  const seed = 0x51a000 + s * 7919;
  lows.push(runOnce(seed, LOW));
  highs.push(runOnce(seed, HIGH));
  console.log(`  种子 ${s + 1}/${SEEDS} 完成（${((Date.now() - t0) / 1000).toFixed(0)} s）`);
}
// 自检：同一种子同一变体必须逐位可复现
const again = runOnce(0x51a000, LOW);
const repro = JSON.stringify(again) === JSON.stringify(lows[0]);

// 双尾 5% 临界 t（自由度 n−1）；n 越大越接近 1.96
const tCrit = (n) => ({ 2: 12.71, 3: 4.3, 4: 3.18, 5: 2.78, 6: 2.57, 7: 2.45, 8: 2.36, 9: 2.31, 10: 2.26, 12: 2.2, 16: 2.13, 24: 2.07, 32: 2.04 })[n] ?? (n < 16 ? 2.3 : n < 32 ? 2.1 : 2.0);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`\n=== 球员智商 A/B（主队外场 ${MENTAL.join("/")} = ${LOW} vs ${HIGH}，${SEEDS} 种子配对）===`);
console.log(`复现自检：${repro ? "✅ 同种子逐位一致" : "❌ 不可复现 —— 下面的差值不可信"}`);
console.log("指标".padEnd(18) + "低智商".padStart(9) + "高智商".padStart(9) + "配对差".padStart(9) + "  t 值   方向");
for (const [k, label, want] of keys) {
  const d = highs.map((h, i) => h[k] - lows[i][k]);
  const md = mean(d);
  const sd = Math.sqrt(d.reduce((x, y) => x + (y - md) ** 2, 0) / Math.max(1, d.length - 1));
  const tval = sd > 0 ? md / (sd / Math.sqrt(d.length)) : md === 0 ? 0 : Infinity;
  const sig = Math.abs(tval) >= tCrit(d.length); // 双尾 5%
  const dir = want === 0 ? "（中性）" : !sig ? "不显著" : Math.sign(md) === want ? "✅ 符合预期" : "🔴 方向反了";
  console.log(
    label.padEnd(18) +
      mean(lows.map((x) => x[k])).toFixed(2).padStart(9) +
      mean(highs.map((x) => x[k])).toFixed(2).padStart(9) +
      (md >= 0 ? "+" : "") + md.toFixed(2).padStart(8) +
      `  ${Number.isFinite(tval) ? tval.toFixed(2) : "∞"}`.padStart(7) + `  ${dir}`
  );
}
