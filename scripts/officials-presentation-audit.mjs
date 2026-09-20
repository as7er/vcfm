/**
 * 官员跑位审计：主裁不得瞬移、不得被球牵着走、不得比追球的球员还快。
 *
 * 为什么必须新写这一支：`verify.mjs` 至今没有任何一项覆盖 officials。
 * 用户三次报同一类现象（「主裁和球一样同步或者瞬移」「比追球的球员还快」
 * 「是不是锁死了主裁和球的距离」），而三次都只能靠肉眼和一次性探针发现。
 *
 * 已有的两支都挡不住回归：
 *  1. `_referee-motion-probe.mjs` **照抄一遍公式**，证明不了仓库里那份
 *     `_updateOfficials` 真的这么跑。抄件已经漂了：它第 34 行写
 *     `MAX_STEP_M = 0.7`「与 matchview.js 同值」，而 matchview.js 现在是 **0.38**。
 *     这正是「审计通过而画面明显不对」的机制。
 *  2. `_officials-visual-verify.mjs` 走真浏览器，是对的，但它要 Playwright +
 *     python 静态服务 + 25 次推进日期，两三分钟起，放进 `verify.mjs` 不现实
 *     （仓库里所有浏览器审计都在 `package.json` 里单列，不在 verify 清单内）。
 *
 * 本审计的做法：**import 真正的 `MatchView.prototype._updateOfficials`**，用一个
 * 只带它所读字段的替身 `this` 调它，球的轨迹来自真正的 `SimEngine`。
 * 于是公式不可能与仓库漂移（没有抄件），也不需要浏览器。
 * DOM 那一半（R/A 字母、圆点尺寸、aria-hidden）仍由
 * `npm run test:officials-browser` 覆盖——那些只有真排版才测得出来。
 *
 * ⚠ `_applyOfficials` 被替身成空函数：它只把坐标写进 `el.style.left/top`，
 *   是纯输出端，没有任何钳制或修正逻辑（matchview.js:2815-2824 全文四行）。
 *   替掉它不会让本审计放过任何运动学缺陷。
 *
 * 口径：种子 372000..、能力 15、标准档、0.1s 步长，与 `_referee-motion-probe`
 * 和 `corner-structure-audit` 一致。每个模拟帧再按 6 个渲染插值子帧调用一次，
 * 覆盖 60fps 调用频率；`_updateOfficials` 的移动量必须按 sim 时间缩放。
 * 本脚本使用 soft 追踪档，match-continuity-audit 另覆盖实际 applySimSnapshot/插值入口。
 *
 * 真实参照：英超主裁每场跑 10~12 km、均速约 2 m/s、冲刺峰值 6~7 m/s，
 * 离球 15~20 m；边裁沿边线与倒数第二名防守者齐平。
 */
import assert from "node:assert/strict";

import { SimEngine, SIM } from "../js/sim/engine.js";
import { MatchView } from "../js/matchview.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 2);
const DT = SIM.DT;
const MX = SIM.PITCH_W_METRES / SIM.FIELD_W;
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H;
const metres = (dx, dy) => Math.hypot(dx * MX, dy * MY);

const quantile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const maximum = (values) => values.reduce((max, value) => Math.max(max, value), -Infinity);
const minimum = (values) => values.reduce((min, value) => Math.min(min, value), Infinity);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClub(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const id = `${name}-p${index}`;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
    ]) attrs[key] = rating;
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      style: "balanced",
    },
  };
}

/**
 * 只带 `_updateOfficials` 与 `_offsideLineY` 真正读到的字段的替身。
 * 刻意**不**构造真的 MatchView：那会拉起 DOM、rAF 与整套 actors。
 * 方法本体全部取自原型，所以测的是仓库里那一份实现。
 */
function makeViewStub() {
  return {
    officials: {
      referee: { x: 42, y: 50 },
      assistantA: { x: 3, y: 32 },
      assistantB: { x: 97, y: 68 },
    },
    ball: { x: 50, y: 50 },
    ballState: "control",
    ballFlightUntil: 0,
    players: [],
    _isBallInFlight: MatchView.prototype._isBallInFlight,
    _offsideLineY: MatchView.prototype._offsideLineY,
    // `_updateOfficials` 现按「哪队朝哪头攻」分配边裁半场（`07f1391` 加入），
    // 因此也要读 `_attackDir`。方法与上面两条同样取自原型。
    _attackDir: MatchView.prototype._attackDir,
    _updateOfficials: MatchView.prototype._updateOfficials,
    _applyOfficials() {},
  };
}

/** 引擎球态 → 视图球态（matchview.js:504-509 的同一映射） */
const viewBallState = (state) =>
  state === "pass" ? "flight" : state === "shot" || state === "penalty" ? "shot" : "control";

/** 跑一场，返回官员与「追球球员」的逐帧运动学 */
function runMatch(seed) {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, 15),
      makeClub(`away-${seed}`, 15),
      { simulationProfile: "standard", timeStep: DT, separationPasses: 8 }
    );
    const view = makeViewStub();
    // 替身的 players 数组一次建好，逐帧只改 y 与红牌集合——`_offsideLineY` 只读这两样。
    // `classList.contains` 查的是外层 `sentOff` 集合，而不是捕获某一帧的布尔值，
    // 否则红牌之后这层替身会永远返回旧答案。
    const sentOff = new Set();
    const roster = engine.agents.map((agent) => ({
      team: agent.team,
      y: agent.y,
      el: { classList: { contains: (cls) => cls === "sent-off" && sentOff.has(agent.id) } },
    }));
    view.players = roster;

    const refSteps = [];
    const refGaps = [];
    const chaserSpeeds = [];
    const assistantA = { steps: [], xs: [], ys: [] };
    const assistantB = { steps: [], xs: [], ys: [] };
    let previousChaser = { id: null, x: 0, y: 0, live: false };

    const steps = Math.round((90 * 60) / DT);
    for (let index = 0; index < steps; index++) {
      engine.step(DT);
      const ball = engine.ball;

      // —— 同步替身读到的那几样 ——
      const previousBall = { x: view.ball.x, y: view.ball.y };
      view.ball.x = ball.x;
      view.ball.y = ball.y;
      view.ballState = viewBallState(ball.state);
      sentOff.clear();
      for (let k = 0; k < engine.agents.length; k++) {
        const agent = engine.agents[k];
        roster[k].y = agent.y;
        if (agent.sentOff) sentOff.add(agent.id);
      }

      // ★ 调用真实实现六次，模拟每个 0.1s 帧内的 60fps 插值更新。
      // 若把每次调用都当成完整 sim tick，主裁会在一帧内跑 6 倍距离。
      for (let sub = 1; sub <= 6; sub++) {
        const alpha = sub / 6;
        view.ball.x = previousBall.x + (ball.x - previousBall.x) * alpha;
        view.ball.y = previousBall.y + (ball.y - previousBall.y) * alpha;
        const before = {
          ref: { ...view.officials.referee },
          a: { ...view.officials.assistantA },
          b: { ...view.officials.assistantB },
        };
        MatchView.prototype._updateOfficials.call(view, true, DT / 6);
        const after = view.officials;
        refSteps.push(metres(after.referee.x - before.ref.x, after.referee.y - before.ref.y));
        refGaps.push(metres(view.ball.x - after.referee.x, view.ball.y - after.referee.y));
        assistantA.steps.push(metres(after.assistantA.x - before.a.x, after.assistantA.y - before.a.y));
        assistantA.xs.push(after.assistantA.x);
        assistantA.ys.push(after.assistantA.y);
        assistantB.steps.push(metres(after.assistantB.x - before.b.x, after.assistantB.y - before.b.y));
        assistantB.xs.push(after.assistantB.x);
        assistantB.ys.push(after.assistantB.y);
      }
      view.ball.x = ball.x;
      view.ball.y = ball.y;

      // —— 追球球员：离球最近的非门将，逐帧位移换算成米 ——
      // 只在**同一个人连续两帧都是最近者、且两帧都不在死球摆位**时记一次：
      // 换人会把跨多帧的位移当成一帧（实测峰值 1037.9 m/s），死球摆位会把整队
      // 瞬移到定位球站位。两者都会把 p90 抬高，而 p90 正是下面那条断言的分母——
      // 分母被污染的断言比没有断言更糟。
      let chaser = null;
      let best = Infinity;
      for (const agent of engine.agents) {
        if (agent.sentOff || agent.role === "GK") continue;
        const gap = metres(agent.x - ball.x, agent.y - ball.y);
        if (gap < best) {
          best = gap;
          chaser = agent;
        }
      }
      const live = !ball.restartType && ball.state !== "dead";
      if (chaser && live && previousChaser.id === chaser.id && previousChaser.live) {
        chaserSpeeds.push(metres(chaser.x - previousChaser.x, chaser.y - previousChaser.y));
      }
      previousChaser = chaser
        ? { id: chaser.id, x: chaser.x, y: chaser.y, live }
        : { id: null, x: 0, y: 0, live: false };
    }
    return { refSteps, refGaps, chaserSpeeds, assistantA, assistantB };
  } finally {
    Math.random = original;
  }
}

const all = {
  refSteps: [],
  refGaps: [],
  chaserSpeeds: [],
  aSteps: [], aXs: [], aYs: [],
  bSteps: [], bXs: [], bYs: [],
};
for (let index = 0; index < MATCHES; index++) {
  const run = runMatch(372000 + index);
  all.refSteps = all.refSteps.concat(run.refSteps);
  all.refGaps = all.refGaps.concat(run.refGaps);
  all.chaserSpeeds = all.chaserSpeeds.concat(run.chaserSpeeds);
  all.aSteps = all.aSteps.concat(run.assistantA.steps);
  all.aXs = all.aXs.concat(run.assistantA.xs);
  all.aYs = all.aYs.concat(run.assistantA.ys);
  all.bSteps = all.bSteps.concat(run.assistantB.steps);
  all.bXs = all.bXs.concat(run.assistantB.xs);
  all.bYs = all.bYs.concat(run.assistantB.ys);
}

// Officials use render substeps; the chaser is sampled at the engine tick.
const perStepToMps = 6 / DT;
const refPeakStep = maximum(all.refSteps);
const refPeakMps = refPeakStep * perStepToMps;
const refMeanMps = mean(all.refSteps) * perStepToMps;
const refMoved = all.refSteps.filter((step) => step > 1e-6).length;
const chaserP90Mps = quantile(all.chaserSpeeds, 0.9) / DT;
const chaserPeakMps = maximum(all.chaserSpeeds) / DT;
const gapMin = minimum(all.refGaps);
const gapMax = maximum(all.refGaps);
const gapMedian = quantile(all.refGaps, 0.5);

const report = {
  场数: MATCHES,
  采样帧: all.refSteps.length,
  主裁: {
    有位移帧: refMoved,
    峰值mps: Number(refPeakMps.toFixed(2)),
    均速mps: Number(refMeanMps.toFixed(2)),
    离球中位m: Number(gapMedian.toFixed(2)),
    离球最近m: Number(gapMin.toFixed(2)),
    离球最远m: Number(gapMax.toFixed(2)),
    离球跨度m: Number((gapMax - gapMin).toFixed(2)),
  },
  追球球员: {
    p90mps: Number(chaserP90Mps.toFixed(2)),
    峰值mps: Number(chaserPeakMps.toFixed(2)),
  },
  边裁A: {
    x范围: [Number(minimum(all.aXs).toFixed(2)), Number(maximum(all.aXs).toFixed(2))],
    y范围: [Number(minimum(all.aYs).toFixed(2)), Number(maximum(all.aYs).toFixed(2))],
    有位移帧: all.aSteps.filter((step) => step > 1e-6).length,
  },
  边裁B: {
    x范围: [Number(minimum(all.bXs).toFixed(2)), Number(maximum(all.bXs).toFixed(2))],
    y范围: [Number(minimum(all.bYs).toFixed(2)), Number(maximum(all.bYs).toFixed(2))],
    有位移帧: all.bSteps.filter((step) => step > 1e-6).length,
  },
};
console.log(JSON.stringify(report, null, 2));

// ── 1) 先证明这不是在读一张静止画面 ──
// `vcfm-tracker-lock-on-static` 那条教训：先确认量到的东西真的在动，
// 否则下面每一条上限断言都会因为「分子恒为 0」而永远通过。
assert.ok(all.refSteps.length > 10000, `采样帧太少：${all.refSteps.length}`);
assert.ok(
  refMoved > all.refSteps.length * 0.5,
  `主裁必须真的在动，否则下面的上限断言全是空转（${refMoved}/${all.refSteps.length} 帧有位移）`
);
assert.ok(all.chaserSpeeds.length > 10000, `追球球员样本太少：${all.chaserSpeeds.length}`);

// ── 2) 不得瞬移 ──
// `MAX_OFFICIAL_STEP_M = 0.38`（3.8 m/s）是 matchview 里唯一的上限，恒速追击保证
// 单帧位移不会超过它。旧实现的目标点是球位的刚性偏移，单帧目标跳变实测 45.87m
// （≈458 m/s），任何回归都会把这条线撞穿两个数量级。
assert.ok(
  refPeakMps < 4,
  `主裁峰值 ${refPeakMps.toFixed(2)} m/s 过大，瞬移回归了（上限 3.8 m/s + 浮点余量）`
);

// ── 3) 不得比追球的球员还快 ──
// 用户的原话是「球去到哪，主裁跑的比追球的球员还快」。所以这条不写死一个 m/s，
// 而是锚到**引擎自己那一帧离球最近的非门将**：主裁的峰值必须低于他们的 p90。
// 这样引擎调球员速度时这条断言会跟着动，不会悄悄失去意义。
assert.ok(
  refPeakMps < chaserP90Mps,
  `主裁峰值 ${refPeakMps.toFixed(2)} m/s 必须低于追球球员 p90 ${chaserP90Mps.toFixed(2)} m/s`
);

// ── 4) 不得被球锁死距离 ──
// 用户第三次报的是「你是不是锁死了主裁和球的距离」。旧实现偏移恒为 ±11/±7 格，
// `hypot(11,7)` 恒等于 13.04，离球距离几乎没有跨度——那时的画面就是「贴着球走」。
// 真实主裁离球 15~20m 且随局面大幅起伏，所以这里要求跨度足够大。
assert.ok(
  gapMax - gapMin > 12,
  `主裁离球跨度只有 ${(gapMax - gapMin).toFixed(2)}m，说明他被球牵着走`
);

// ── 5) 边裁各守一条边线、各守一半场地，并且真的在跑 ──
const aX = [minimum(all.aXs), maximum(all.aXs)];
const bX = [minimum(all.bXs), maximum(all.bXs)];
assert.ok(aX[0] >= 1 && aX[1] <= 5, `边裁 A 必须留在 x≈3 那条边线：${aX}`);
assert.ok(bX[0] >= 95 && bX[1] <= 99, `边裁 B 必须留在 x≈97 那条边线：${bX}`);
assert.ok(maximum(all.aYs) <= 50, `边裁 A 只负责 y<50 那半场：最大 ${maximum(all.aYs)}`);
assert.ok(minimum(all.bYs) >= 50, `边裁 B 只负责 y>50 那半场：最小 ${minimum(all.bYs)}`);
assert.ok(
  all.aSteps.filter((step) => step > 1e-6).length > all.aSteps.length * 0.3,
  "边裁 A 必须跟着越位线跑动"
);
assert.ok(
  all.bSteps.filter((step) => step > 1e-6).length > all.bSteps.length * 0.3,
  "边裁 B 必须跟着越位线跑动"
);
assert.ok(
  maximum(all.aSteps) * perStepToMps < 4,
  `边裁 A 峰值 ${(maximum(all.aSteps) * perStepToMps).toFixed(2)} m/s 过大`
);
assert.ok(
  maximum(all.bSteps) * perStepToMps < 4,
  `边裁 B 峰值 ${(maximum(all.bSteps) * perStepToMps).toFixed(2)} m/s 过大`
);

console.log(
  "\nOfficials presentation audit passed: 主裁不瞬移、慢于追球球员、离球距离未被锁死；边裁各守边线与半场"
);

