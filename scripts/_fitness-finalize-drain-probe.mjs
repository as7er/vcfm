/**
 * 赛后 `drainFitness` 取证（**只读**）—— 「方案 E」的前置探针。
 *
 * 背景：`finalizeMatch` 的赛后扣减（`js/match.js:3087`）是
 *   `const drain = 4 + Math.floor(rng() * 6) + Math.round((fitW - 1) * 4);`
 * —— **逐人掷骰子，与 `runMetres` 完全无关**。于是「跑了 13km 的人」可能比
 * 「跑了 8km 的人」扣得更少。这是用户最初报的「各队员体能显示不对」的另一半：
 * 中场那 6 点已经由方案 D 改成按跑动分摊，但赛后这 4~9 点（均值 6.5）还是掷骰子，
 * 而且它**比中场那 6 点还大**。
 *
 * 本探针只回答两件事，**不改任何产品代码**：
 *
 *   A. `finalizeMatch` 时 `state.simEng` 还在吗？`runMetres` 是否已累计到**整场**？
 *      （`simEng` 不进存档、概率引擎路径本来就没有它 ⇒ 这一步不能假设，必须实测。）
 *   B. 当前「实际扣减」与跑动的相关性有多高？换成「同一总量按跑动占比分摊」
 *      的反事实又会是多少？
 *
 * 做法（关键）：`playFirstHalf` / `playSecondHalf` / `finalizeMatch` 三个都是导出的，
 * 所以可以在 `finalizeMatch` **之前**取快照 —— 那正是 `drainFitness` 读数的时刻。
 * （`simulateMatchSync` 会把 begin/run/finalize 一气跑完，拿不到这个中间态。）
 *
 * 三段快照把「赛后那一笔」与「整场总和」分开量：
 *   赛前 ──(中场 6 次整点结算)── 终场前 ──(`drainFitness`)── 终场后
 *   · 赛后那一笔 = 终场前 − 终场后   （纯骰子，预期与跑动无关）
 *   · 整场总和   = 赛前   − 终场后   （骰子 + 方案 D 的信号）
 *
 * ⚠ 两个已踩过的坑（都写在这里免得下一个探针再踩）：
 *   1. **首发必须显式指定** `club.tactics.lineup`。靠自动挑选实测会把一名后卫
 *      放进门将槽（本探针第一版就撞上了：门将槽的球员只跑 2.44km，被当成 DEF
 *      统计，于是 DEF/MID/ATT 的跑动均值全部虚高、且完全没有 GK 行）。
 *   2. 主客两队必须用**不同 id 前缀**。上一个标定探针两队共用 `squad()` ⇒ id
 *      完全相同 ⇒ Map 互相覆盖，跑出「门将 45 分钟 964km」。
 *      **数字荒谬时先怀疑键。**
 *
 * 用法：node scripts/_fitness-finalize-drain-probe.mjs [场数=8]
 */

import { defaultTactics, getLineupPlayers } from "../js/models.js";
import { generatePlayerAttributes } from "../js/player-attributes.js";
import { FORMATIONS } from "../js/data.js";
import {
  createMatchSession,
  playFirstHalf,
  playSecondHalf,
  finalizeMatch,
} from "../js/match.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 8);
const STEP_NOTE = "标准档步长 = SIM.DT = 0.1s（生产同档）";

/**
 * mulberry32：小而快的 32 位 PRNG，同 seed 完全可复现。
 * ⚠ 必须传 `opts.random`：引擎（`engine.js:510`）是
 *   `this.random = opts.random ?? Math.random`，**全仓 `opts.seed` 零引用** ——
 *   传 `{ seed }` 会被静默忽略，走 `Math.random`，每次跑都是新随机流。
 */
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

/*
 * 🔴 让整场**可复现**（AGENTS.md ④ 的铁律：做任何测量实验前，先证明模拟可复现）。
 *
 * 只给 `fixture.matchSeed` **不够**。实测：同一 seed 连跑两次，
 * **球员跑动距离就不同**（h_d3 13.58 vs 13.08 km）、换人次数也不同（7 vs 8）
 * ⇒ 整场都是另一场比赛，修前/修后根本没法做受控 A/B
 * （本探针第二版就是这样把「本该逐位不变的对照组」跑出 0.890 → 0.941 漂移的）。
 *
 * 已经确定性的部分：`matchRandom` 那条链是定死的 —— `random.js:30` 的
 * `ensureMatchSeed` 由 `(season, day, id, home, away, competition)` **哈希**而来，
 * 不用 `Math.random`；`generatePlayerAttributes` 全文也没有随机调用。
 * 漏掉的是**直接调 `Math.random`** 的那些：`aiTuneTactics`（AI 球队调战术，
 * `match.js:787-788`）、`models.js` 的 `makeId`（`Math.random().toString(36)`）等。
 * ⇒ 进程内整体换掉 `Math.random`。**只影响本探针进程，不碰任何产品代码。**
 */
Math.random = mulberry32(20260921);

function mkPlayer(id, pos, ovr) {
  const p = {
    id,
    name: id,
    pos,
    ovr,
    potential: ovr + 1,
    age: 27,
    fitness: 90,
    morale: 70,
    injured: 0,
    suspendedMatches: 0,
    attrs: {},
  };
  // ⚠ 必须走 `generatePlayerAttributes`（新建世界同一条路径）：
  //   `ensureFootballProfile` **不生成 stamina** ⇒ 全员默认 0.600 ⇒ 同值档。
  generatePlayerAttributes(p, p.ovr);
  return p;
}

/** 主客两队用不同 id 前缀（见文件头坑 2） */
function squad(tag) {
  const players = [
    mkPlayer(`${tag}_gk`, "GK", 14),
    mkPlayer(`${tag}_gk2`, "GK", 13),
  ];
  for (let i = 0; i < 7; i++) players.push(mkPlayer(`${tag}_d${i}`, "DEF", +(16 - i * 0.3).toFixed(2)));
  for (let i = 0; i < 8; i++) players.push(mkPlayer(`${tag}_m${i}`, "MID", +(16 - i * 0.25).toFixed(2)));
  for (let i = 0; i < 6; i++) players.push(mkPlayer(`${tag}_a${i}`, "ATT", +(16 - i * 0.4).toFixed(2)));
  return players;
}

/**
 * 显式按**槽位位置**排首发（见文件头坑 1）。
 * 每个槽位从同位置球员里取能力最高者 ⇒ 保证 GK 槽是真门将。
 */
function setLineup(club) {
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const byPos = new Map();
  for (const p of [...club.players].sort((a, b) => (b.ovr || 0) - (a.ovr || 0))) {
    if (!byPos.has(p.pos)) byPos.set(p.pos, []);
    byPos.get(p.pos).push(p.id);
  }
  club.tactics.lineup = formation.slots.map((slot) => (byPos.get(slot.pos) || []).shift() ?? null);
  club.tactics.roles = [];
  club.tactics.duties = [];
  return formation.slots.map((slot, i) => `${slot.pos}:${club.tactics.lineup[i]}`).join(" ");
}

function makeWorld() {
  const mk = (id, name, power, tag) => ({
    id,
    name,
    power,
    players: squad(tag),
    tactics: defaultTactics(),
    form: [],
    staff: {},
  });
  const home = mk("user", "User", 70, "h");
  const away = mk("opp", "Opponent", 65, "a");
  const homeLine = setLineup(home);
  setLineup(away);
  // ⚠ 假 world 跑完场还需要 `table`（`applyResult` 会读）与 `news`（`finalizeMatch:3480` 会 unshift）
  return {
    world: { clubs: [home, away], userClubId: "user", season: 2026, day: 5, table: [], news: [] },
    homeLine,
  };
}

function ranks(arr) {
  const order = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array(arr.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k].i] = avg;
    i = j + 1;
  }
  return r;
}

/** Spearman：只关心「排序是否一致」，对单位与线性缩放免疫 */
function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx;
    const b = ry[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / Math.sqrt(dx * dy || 1);
}

const stat = (xs) => {
  const n = xs.length || 1;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return { mean, sd, lo: Math.min(...xs), hi: Math.max(...xs), range: Math.max(...xs) - Math.min(...xs) };
};

/** 同一总量按跑动占比分摊（保留小数 —— 取整会毁掉分辨率） */
function shareByWork(work, total) {
  const sum = work.reduce((s, v) => s + v, 0);
  return sum > 0 ? work.map((w) => (w / sum) * total) : null;
}

// ---- 逐场驱动 ---------------------------------------------------------------

const roleDist = {};
const agg = []; // 比赛级观测（不是球队级 —— 归档 §[2] 的伪重复教训）
let simEngSeen = 0;
let simEngMissing = 0;
let lineupShown = null;
let firstMatchRows = null;
let subEvents = 0;
let firstSlotMap = null;
let gkAtKickoff = null;

for (let m = 0; m < MATCHES; m++) {
  const { world, homeLine } = makeWorld();
  if (!lineupShown) lineupShown = homeLine;
  const club = world.clubs[0];
  // ⚠ **`matchSeed` 必须给**：`activeRandom = matchRandom(world, fixture)`（不是 `opts.random`），
  //   不给种子时 `ensureMatchSeed` 每次生成新的 ⇒ **两轮之间不可复现**，做不了受控 A/B。
  //   本探针第一版漏了它，于是「中场结算」这个**本该逐位不变的对照组**在修前/修后
  //   出现了 0.890 → 0.941 的漂移（2026-09-21，code-reviewer 抓到）。
  //   铁律（AGENTS.md ④）：**做任何测量实验前，先证明模拟可复现。**
  const fixture = {
    day: 5 + m, home: "user", away: "opp", played: false,
    id: `f${m}`, matchSeed: (900000 + m) >>> 0,
  };
  const state = createMatchSession(world, fixture, { random: mulberry32(900000 + m) });

  if (!gkAtKickoff) {
    const gid = (club.tactics.lineup || [])[0];
    const gp = club.players.find((x) => x.id === gid);
    gkAtKickoff = `${gid}(${gp?.pos})`;
  }
  /* 赛前快照：必须在 createMatchSession **之后** —— 首发此时才定（归档 §[1] 的坑）。 */
  const pre = new Map(getLineupPlayers(club).map((p) => [p.id, Number(p.fitness) || 0]));

  await playFirstHalf(state, {});
  await playSecondHalf(state, {});

  // ── 这里是 `finalizeMatch` **之前**，也就是 `drainFitness` 将要读数的时刻 ──
  const eng = state.simEng;
  if (eng?.agents?.length) simEngSeen += 1;
  else simEngMissing += 1;

  const runById = new Map();
  if (eng?.agents) {
    for (const a of eng.agents) if (a?.id != null) runById.set(a.id, Number(a.runMetres) || 0);
  }

  // 首场留存「槽位 → 球员 → 跑动」映射：用来核对**门将槽到底站的是谁**、
  // 以及换人之后 id ↔ runMetres 的对应有没有错位（两者都会毁掉反事实的正确性）。
  if (!firstSlotMap) {
    const slots = (FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"]).slots;
    firstSlotMap = slots.map((slot, i) => {
      const pid = (club.tactics.lineup || [])[i];
      const p = club.players.find((x) => x.id === pid);
      return { i, slot: slot.pos, id: pid, pos: p?.pos, km: (runById.get(pid) ?? 0) / 1000 };
    });
  }
  const sent = state.sentOff?.home || new Set();
  const xi = getLineupPlayers(club).filter((p) => p && !sent.has(p.id));
  const mid = new Map(xi.map((p) => [p.id, Number(p.fitness) || 0]));
  subEvents += (state.events || []).filter((e) => e.type === "sub").length;

  finalizeMatch(state);

  // 只保留三段快照都在的球员，避免换人污染口径
  const keep = xi.filter((p) => pre.has(p.id));
  const work = keep.map((p) => runById.get(p.id) ?? 0);
  const settleDrain = keep.map((p) => pre.get(p.id) - mid.get(p.id));
  const finalDrain = keep.map((p) => mid.get(p.id) - (Number(p.fitness) || 0));
  const totalDrain = keep.map((p) => pre.get(p.id) - (Number(p.fitness) || 0));

  const sumWork = work.reduce((s, v) => s + v, 0);
  if (sumWork <= 0) continue;

  for (const p of keep) (roleDist[p.pos] ||= []).push((runById.get(p.id) ?? 0) / 1000);

  const totalSum = totalDrain.reduce((s, v) => s + v, 0);
  const finalSum = finalDrain.reduce((s, v) => s + v, 0);
  const cTotal = shareByWork(work, totalSum);
  const cFinal = shareByWork(work, finalSum);

  agg.push({
    rFinal: spearman(work, finalDrain),
    rTotal: spearman(work, totalDrain),
    rSettle: spearman(work, settleDrain),
    finalSd: stat(finalDrain).sd,
    cFinalSd: stat(cFinal).sd,
    finalRange: stat(finalDrain).range,
    cFinalRange: stat(cFinal).range,
    totalSd: stat(totalDrain).sd,
    cTotalSd: stat(cTotal).sd,
    totalRange: stat(totalDrain).range,
    cTotalRange: stat(cTotal).range,
    finalSum,
    cFinalSum: cFinal.reduce((s, v) => s + v, 0),
  });

  if (!firstMatchRows) {
    firstMatchRows = keep
      .map((p, i) => ({
        id: p.id,
        pos: p.pos,
        km: work[i] / 1000,
        settle: settleDrain[i],
        fin: finalDrain[i],
        total: totalDrain[i],
        cFinal: cFinal[i],
      }))
      .sort((a, b) => a.km - b.km);
  }
  process.stdout.write(`\r已完成 ${m + 1}/${MATCHES} 场`);
}
process.stdout.write("\n");

// ---- 报告 -------------------------------------------------------------------

console.log(`\n（${STEP_NOTE}；显式首发 ${lineupShown}）`);
console.log(`（建会话之后门将槽 = ${gkAtKickoff} —— 用来判断显式首发有没有被覆盖）`);

console.log("\n=== A. `finalizeMatch` 时 `state.simEng` 是否可用 ===");
console.log(`  simEng 存在：${simEngSeen} 场 ｜ 缺失：${simEngMissing} 场`);
console.log(`  可用跑动读数的比赛观测：${agg.length} 个（全场换人事件累计 ${subEvents} 次）`);

if (!agg.length) {
  console.log("  ❌ 拿不到 `runMetres` ⇒ 方案 E 在这条路径上不成立，必须保留旧回退。");
  process.exit(0);
}

console.log("\n=== B. 槽位映射与跑动距离（首场，终场时刻）===");
console.log("  #  槽位   球员        位置   整场跑动km");
for (const r of firstSlotMap || []) {
  const warn = r.slot === "GK" && r.pos !== "GK" ? "   ⚠ 门将槽站的不是门将" : "";
  console.log(
    `  ${String(r.i).padStart(2)} ${r.slot.padEnd(6)} ${String(r.id ?? "—").padEnd(11)} ` +
      `${String(r.pos ?? "—").padEnd(6)} ${r.km.toFixed(2).padStart(6)}${warn}`
  );
}
console.log("  角色    整场均值    范围");
for (const pos of ["GK", "DEF", "MID", "ATT"]) {
  if (!roleDist[pos]) continue;
  const s = stat(roleDist[pos]);
  console.log(
    `  ${pos.padEnd(5)} ${s.mean.toFixed(2).padStart(7)} km  ${s.lo.toFixed(2)} ~ ${s.hi.toFixed(2)}`
  );
}

console.log("\n=== C. 首场逐人对照（按跑动升序）===");
console.log("  id          pos   跑动km   中场结算   赛后(实际)  赛后(按跑动)  整场总和");
for (const r of firstMatchRows) {
  console.log(
    `  ${r.id.padEnd(11)} ${r.pos.padEnd(5)} ${r.km.toFixed(2).padStart(6)} ` +
      `${r.settle.toFixed(2).padStart(9)} ${r.fin.toFixed(2).padStart(11)} ` +
      `${r.cFinal.toFixed(2).padStart(12)} ${r.total.toFixed(2).padStart(9)}`
  );
}

console.log("\n=== D. 「跑得多 ⇒ 扣得多」的相关性（Spearman，比赛级均值）===");
const rF = agg.map((r) => r.rFinal).filter(Number.isFinite);
const rT = agg.map((r) => r.rTotal).filter(Number.isFinite);
const rS = agg.map((r) => r.rSettle).filter(Number.isFinite);
console.log(`  赛后那一笔（掷骰子，4~9 点）   ：${stat(rF).mean.toFixed(3)}  ← 预期 ≈ 0，即与跑动无关`);
console.log(`  中场结算（方案 D，按跑动）     ：${stat(rS).mean.toFixed(3)}  ← 预期 ≈ 1`);
console.log(`  整场总和（两者相加）           ：${stat(rT).mean.toFixed(3)}  ← 骰子把信号稀释到这`);

console.log("\n=== E. 量级与守恒 ===");
const fSd = stat(agg.map((r) => r.finalSd));
const cfSd = stat(agg.map((r) => r.cFinalSd));
const fRg = stat(agg.map((r) => r.finalRange));
const cfRg = stat(agg.map((r) => r.cFinalRange));
const tSd = stat(agg.map((r) => r.totalSd));
const ctSd = stat(agg.map((r) => r.cTotalSd));
const tRg = stat(agg.map((r) => r.totalRange));
const ctRg = stat(agg.map((r) => r.cTotalRange));
console.log(`  赛后那一笔 队内 SD  ：实际 ${fSd.mean.toFixed(2)} 点 ｜ 按跑动 ${cfSd.mean.toFixed(2)} 点`);
console.log(`  赛后那一笔 队内极差 ：实际 ${fRg.mean.toFixed(2)} 点 ｜ 按跑动 ${cfRg.mean.toFixed(2)} 点`);
console.log(`  整场总和   队内 SD  ：实际 ${tSd.mean.toFixed(2)} 点 ｜ 按跑动 ${ctSd.mean.toFixed(2)} 点`);
console.log(`  整场总和   队内极差 ：实际 ${tRg.mean.toFixed(2)} 点 ｜ 按跑动 ${ctRg.mean.toFixed(2)} 点`);
const dev = Math.max(...agg.map((r) => Math.abs(r.cFinalSum - r.finalSum)));
console.log(`  赛后总量      ：实际 ${stat(agg.map((r) => r.finalSum)).mean.toFixed(3)} 点 ｜ 按跑动 ${stat(agg.map((r) => r.cFinalSum)).mean.toFixed(3)} 点 ｜ 最大偏差 ${dev.toExponential(2)}`);

console.log("\n=== 判定 ===");
console.log(`A. \`runMetres\` 在 finalize 时刻可用：✅ 是（${simEngSeen}/${MATCHES} 场）`);
console.log(`B. 赛后那一笔与跑动的相关性：${stat(rF).mean.toFixed(3)}`);
console.log("   （修前基线 -0.007＝与噪声无异；改成按跑动分摊后应为 1.000）");
console.log(`C. 整场总扣减与跑动的相关性：${stat(rT).mean.toFixed(3)}（修前基线 0.481）`);
console.log(`D. 反事实是否保总量：${dev < 1e-6 ? "✅ 精确守恒" : "❌ 不守恒"}（偏差 ${dev.toExponential(2)}）`);
console.log(`   队内极差：实际 ${tRg.mean.toFixed(2)} 点 vs 按跑动 ${ctRg.mean.toFixed(2)} 点`);
