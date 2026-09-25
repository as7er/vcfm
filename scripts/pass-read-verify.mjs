/**
 * 传球读局回归（2026-09-25）—— 「会读比赛的球员挑更安全的线路」的快档常驻检查。
 *
 * ## 为什么必须存在
 *
 * 智商 A/B（`_player-iq-ab-probe.mjs`，16 种子）在 v292 之前：精神属性 6→16，
 * **所有质量指标均不显著、净胜球差恰为 0**。离线查明：`_laneSafety` 对所有球员都是
 * 「完美感知」，同一局面人人看到同一安全度 ⇒ 属性无从起作用。v292 引入
 * `_perceivedLaneSafety`（read = ½decisions + ½vision）：
 *   · read 在支点：与旧 `_laneSafety` 逐位相同 —— 联赛标定不动的前提；
 *   · 高于支点：向「抢点赛跑」估计靠拢（离线 AUC 0.818 vs 朴素 0.755）；
 *   · 低于支点：看到对手 0~0.6 s 前的位置。
 *
 * ## 判据（量代码直接改的量，不量整场结果）
 *
 * 在真实比赛里冻结 N 个持球局面，同一局面、同一随机流，只改持球人 read：
 *   ① 支点处感知安全度与 `_laneSafety` **逐位相同**（全部候选）；
 *   ② 高 read 选中的第一候选，其**赛跑安全度**（接近真实风险）均值 > 低 read。
 * 另带变异自检：把支点挪开，① 必须变红。
 *
 * 用法：node scripts/pass-read-verify.mjs
 */
import assert from "node:assert/strict";
import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession } from "../js/match.js";
import { createWorld } from "../js/models.js";
import { ensureSimEngine } from "../js/sim/adapt.js";
import { ensureStaff } from "../js/staff.js";

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

// 造世界期间固定 Math.random / Date.now（教练 ID 含 Date.now，见 _player-iq-ab-probe.mjs）
const realMathRandom = Math.random;
const realDateNow = Date.now;
Math.random = mulberry32(0x9a55);
Date.now = () => 1789000000000;
const startClub = CLUB_TEMPLATES.find((club) => club.division === 3);
const world = createWorld(startClub.id, "Pass read verify");
for (const club of world.clubs) ensureStaff(club);
Math.random = realMathRandom;
Date.now = realDateNow;

const fixture = world.fixtures.find((f) => f.home === world.userClubId);
const state = createMatchSession(world, fixture);
state.random = mulberry32(0x7e57);
const engine = ensureSimEngine(state);

const PIVOT = 0.66; // 与 engine.js PASS_READ.pivot 一致
const LOW = 0.45;
const HIGH = 0.85;

function withRead(agent, read, fn) {
  const saved = [agent.attr.decisions, agent.attr.vision];
  agent.attr.decisions = read;
  agent.attr.vision = read;
  try {
    return fn();
  } finally {
    [agent.attr.decisions, agent.attr.vision] = saved;
  }
}

function candidatesAt(holder, read, seed) {
  const realRandom = engine.random;
  engine.random = mulberry32(seed);
  try {
    return withRead(holder, read, () => engine._collectPassCandidates(holder));
  } finally {
    engine.random = realRandom;
  }
}

function etaOf(holder, c) {
  // 与引擎同一估计口径不可得（eta 是候选循环内部量）⇒ 这里只用于比较两个变体，取同一近似
  const dx = (c.tx - holder.x) * 0.68;
  const dy = (c.ty - holder.y) * 1.05;
  return Math.max(0.2, Math.hypot(dx, dy) / 15);
}

let states = 0;
let pivotChecks = 0;
let pivotMismatch = 0;
let mutantCaught = 0;
let choiceDiffers = 0;
let lowRace = 0;
let highRace = 0;
const WANT = 120;
for (let step = 0; step < 60 * 60 * 40 && states < WANT; step++) {
  engine.step();
  if (step % 25 !== 0) continue;
  const holder = engine.ball.owner ? engine.agentById(engine.ball.owner) : null;
  if (!holder || holder.role === "GK") continue;

  const seed = 0x5eed + step;
  const pivot = candidatesAt(holder, PIVOT, seed);
  for (const c of pivot) {
    if (c.backpass || c.through) continue;
    pivotChecks++;
    const naive = engine._laneSafety(holder, c.agent, c.tx, c.ty);
    const perceived = withRead(holder, PIVOT, () =>
      engine._perceivedLaneSafety(holder, c.agent, c.tx, c.ty, etaOf(holder, c), PIVOT)
    );
    if (naive !== perceived) pivotMismatch++;
    // 变异自检：支点挪开 0.07，同一判据必须能抓到差异（防止判据本身空转）
    const mutated = engine._perceivedLaneSafety(holder, c.agent, c.tx, c.ty, etaOf(holder, c), PIVOT - 0.07);
    if (mutated !== naive) mutantCaught++;
  }

  const low = candidatesAt(holder, LOW, seed).filter((c) => !c.backpass);
  const high = candidatesAt(holder, HIGH, seed).filter((c) => !c.backpass);
  if (low.length < 2 || high.length < 2) continue;
  states++;
  if (low[0].agent !== high[0].agent) choiceDiffers++;
  lowRace += engine._raceLaneSafety(holder, low[0].tx, low[0].ty, etaOf(holder, low[0]));
  highRace += engine._raceLaneSafety(holder, high[0].tx, high[0].ty, etaOf(holder, high[0]));
}

const report = {
  states,
  pivotChecks,
  pivotMismatch,
  mutantCaught,
  choiceDiffersPct: Number(((choiceDiffers / Math.max(1, states)) * 100).toFixed(1)),
  lowReadChosenRaceSafety: Number((lowRace / Math.max(1, states)).toFixed(4)),
  highReadChosenRaceSafety: Number((highRace / Math.max(1, states)).toFixed(4)),
};
console.log(JSON.stringify(report, null, 2));

assert.ok(states >= 60, `需要足够的持球局面（得到 ${states}）`);
assert.ok(pivotChecks >= 200, `支点逐位检查样本不足（${pivotChecks}）`);
assert.equal(pivotMismatch, 0, "read 在支点时感知安全度必须与 _laneSafety 逐位相同（联赛标定依赖此点）");
assert.ok(report.choiceDiffersPct >= 3, "read 高低必须改变至少一部分首选接球人，否则属性仍是死的");
assert.ok(
  report.highReadChosenRaceSafety > report.lowReadChosenRaceSafety,
  "高 read 选中线路的赛跑安全度必须高于低 read（否则读局方向反了）"
);

assert.ok(
  mutantCaught >= pivotChecks * 0.1,
  `变异自检：支点挪开 0.07 后应有相当部分候选偏离 _laneSafety（仅 ${mutantCaught}/${pivotChecks}）`
);
console.log("pass-read-verify OK");
