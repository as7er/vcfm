import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MatchView } from "../js/matchview.js";
import { interpolateSimBall } from "../js/match-presentation.js";
import { SimEngine, ballDeflectionOf } from "../js/sim/engine.js";
import { compactSimFrame } from "../js/sim/adapt.js";

function makeClub(id) {
  const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = positions.map((pos, i) => ({
    id: `${id}-${i}`, name: `${id}-${i}`, pos, number: i + 1, fitness: 100,
    attrs: Object.fromEntries([
      "pace", "strength", "passing", "vision", "shooting", "finishing", "dribbling",
      "tackling", "marking", "stamina", "positioning", "reflexes", "handling", "kicking",
    ].map((key) => [key, 12])),
  }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

function seededRandom(seed) {
  return () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
}

function makeEngine() {
  return new SimEngine(makeClub("home"), makeClub("away"), { random: seededRandom(51029) });
}

// Only DOM output is stubbed. Snapshot application, interpolation, state capture,
// officials and motion diagnostics all run through the actual MatchView methods.
function makeView(frame) {
  const view = new MatchView(null);
  view._built = true;
  view.fsm.transition("PRE_MATCH");
  view.players = frame.players.map((player) => {
    const classes = new Set();
    return {
      ...player, pos: player.role,
      el: { classList: {
        contains: (name) => classes.has(name),
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
      } },
    };
  });
  view.officials = {
    referee: { x: 42, y: 50 },
    assistantA: { x: 3, y: 32 },
    assistantB: { x: 97, y: 68 },
  };
  for (const method of ["_applyPlayer", "_applyBall", "_applyOfficials", "_updatePossessionChrome"]) {
    view[method] = () => {};
  }
  view.bursts = [];
  view._burst = (...args) => view.bursts.push(args);
  view._setTouch = () => assert.fail("rendering a recorded frame must not create a new touch or heat sample");
  return view;
}

const base = makeEngine().snapshot();
base.motionContext = { discontinuity: false };
base.ball = { x: 60, y: 60, z: 0, owner: null, state: "pass" };
const at = (t, ball = base.ball, players = base.players) => ({ ...base, t, ball, players });
const metres = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);

const endpoints = [];
for (const fps of [30, 60, 120]) {
  const view = makeView(base);
  view.applySimSnapshot(at(0));
  Object.assign(view.officials.referee, { x: 10, y: 5 });
  const start = { ...view.officials.referee };
  for (let i = 1; i <= fps * 2; i++) {
    const previous = structuredClone(view.officials);
    view.applySimSnapshot(at(i / fps));
    for (const role of Object.keys(previous)) {
      assert.ok(metres(previous[role], view.officials[role]) <= 3.8 / fps + 1e-8,
        `${role} exceeded its simulation-time speed at ${fps}fps`);
    }
  }
  assert.ok(metres(start, view.officials.referee) > 7.5, "the speed limit must not freeze the referee");
  endpoints.push({ ...view.officials.referee });
  const paused = structuredClone(view.officials);
  for (let i = 0; i < 60; i++) view.applySimSnapshot(at(2));
  assert.deepEqual(view.officials, paused, "duplicate timestamps must leave officials stationary");
  view.applySimSnapshot(at(2 - 1e-9));
  assert.deepEqual(view.officials, paused, "timestamp roundoff must not teleport officials into a new scene");
}
assert.ok(metres(endpoints[0], endpoints[2]) < 1e-8, "render rate must not change the referee's path");

const view = makeView(base);
const owner = base.players.find((player) => player.role !== "GK");
const held = at(0, { x: owner.x + 1.3, y: owner.y + 0.2, z: 0.1, owner: owner.id, state: "held" });
view.applySimSnapshot(held);
assert.equal(view.ball.x, held.ball.x, "held ball must preserve the engine foot offset");
assert.equal(view.ball.y, held.ball.y);
const nextHeld = at(0.1, { ...held.ball, x: held.ball.x + 0.4, y: held.ball.y - 0.2 },
  base.players.map((player) => player.id === owner.id ? { ...player, heading: Math.PI / 2 } : player));
for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
  view.applySimSnapshotLerped(held, nextHeld, alpha);
  const expected = interpolateSimBall(held.ball, nextHeld.ball, alpha);
  assert.ok(Math.abs(view.ball.x - expected.x) < 1e-8, "turning cannot add a second foot projection");
  assert.ok(Math.abs(view.ball.y - expected.y) < 1e-8);
}

const sourceView = makeView(base);
const sourceA = structuredClone(at(7.4));
const sourceB = structuredClone(at(7.5));
sourceB.players[1].y += 1.2;
sourceView.applySimSnapshotLerped(sourceA, sourceB, 0.4);
const sourceRecord = sourceView.createMotionClip().frames.at(-1);
assert.deepEqual(sourceRecord.source, { from: sourceA, to: sourceB, alpha: 0.4 },
  "an interpolated diagnostic must retain the original recording endpoints");
assert.ok(sourceRecord.engine.t > sourceRecord.source.from.t &&
  sourceRecord.engine.t < sourceRecord.source.to.t);
sourceB.players[1].y += 20;
assert.notEqual(sourceRecord.source.to.players[1].y, sourceB.players[1].y,
  "later frame mutations must not overwrite captured evidence");
sourceView.applySimSnapshot(at(8));
assert.equal(sourceView.createMotionClip().frames.at(-1).source, null,
  "a direct snapshot must not inherit a preceding interpolation pair");

const contact = { t: 0.2, x: 61, y: 60, byId: owner.id };
const incoming = at(0.1);
const deflected = at(0.2, { ...base.ball, x: 61, state: "loose", deflect: contact });
for (const alpha of [0, 0.5, 0.85, 0.99]) view.applySimSnapshotLerped(incoming, deflected, alpha);
assert.equal(view.bursts.length, 0, "a contact cannot be displayed before its frame");
view.applySimSnapshotLerped(incoming, deflected, 1);
for (let i = 0; i < 12; i++) view.applySimSnapshot(at(0.2 + i * 0.01, deflected.ball));
assert.equal(view.bursts.length, 1, "one deflection must not burst on every interpolated frame");

/** 记录 `mp-seg-cut` 加减次数的场地替身（`makeView(null)` 的 `fieldEl` 是 null） */
function makeFieldStub() {
  const added = [];
  return {
    added,
    classList: {
      contains: () => false,
      add: (...names) => added.push(...names),
      remove: () => {},
      toggle: () => {},
    },
    get offsetWidth() { return 0; },
  };
}

// —— 规格变更（2026-09-22）：整队级重启搬运走「剪辑」，不再走 0.7 s 缓动 ——
//
// 本块原来断言「摆位从**显示位置**开始、0.7 模拟秒内缓动到位」。实测
// （`scripts/_restart-snap-census.mjs`，4 场整场确定性普查）显示细化高光里
// **可见**的 28 次超物理位移帧对**全部**是「21~22 人 / 40~76 m」的整队级搬运：
// 60 m 摊到 700 ms 是 ~86 m/s 的扫掠（ease-out cubic 首帧 ~258 m/s），
// 用户报的「球员瞬移到目标站位」就是它。而本仓库对**段首**早已下过同一结论
// （`js/matchview.js` 的 `_enterSegmentTransition` ⛔ 注释：「缓动本身也是错的
// 解法 —— 45 m 位移摊到 0.7 s 等于 64 m/s 的扫掠」），于是现在把段首那套
// 「硬置 + 淡场」推广到段内整队摆位。
//
// ⚠ 覆盖没有减少，只是换了承载它的规格分支：
//   · 「缓动按**模拟时间**推进、暂停时不动」「球与球员共用同一条过渡」
//     —— 仍由下面的 `small` 块（1.8~2.5 m 摆位）与 historical fixture 块把关；
//   · 「小范围摆位按缓动摊开而不是一步到位」—— 同样由 `small` 块把关。
const restartView = makeView(base);
const field = makeFieldStub();
restartView.fieldEl = field;
const cutCount = () => field.added.filter((name) => name === "mp-seg-cut").length;
restartView.applySimSnapshot(at(0));
const restart = {
  ...at(0.1, { x: 2, y: 2, z: 0, owner: owner.id, state: "corner", restartType: "corner" },
    base.players.map((player) => ({ ...player,
      x: player.id === owner.id ? 2 : 10, y: player.id === owner.id ? 3.5 : 20,
    }))),
  motionContext: { discontinuity: true },
};
restartView.applySimSnapshot(restart);
assert.equal(cutCount(), 1, "整队级摆位必须落一次剪辑（换镜头语汇），而不是伪造位移连续性");
assert.equal(restartView.ball.x, 2, "整队级摆位必须一步到位：700 ms 摊不平 54 m");
assert.equal(restartView.ball.y, 2);
// ⚠ `players[1]` 就是 `owner`（`owner` = 首个非门将）⇒ 它的目标 x 是 2。
//   要验「非持球球员也同帧落位」必须换一个下标。
assert.equal(restartView.players[2].x, 10, "球员必须与球同帧落位，不能球到了人还在滑");
assert.equal(restartView.players[1].x, 2, "角球主罚者也必须在同一帧到位");
assert.equal(restartView.carrier?.id, owner.id, "落位后持球高亮必须立刻跟上角球主罚者");
restartView._playSegmentCut();
assert.equal(cutCount(), 1, "同一个剪辑窗口内的重复调用不得重启动画（满遮时长会翻倍）");
restartView.applySimSnapshot({ ...restart, t: 0.3 });
restartView.applySimSnapshot({ ...restart, t: 0.5 });
restartView.applySimSnapshot({ ...restart, t: 0.81 });
assert.equal(cutCount(), 1, "落位完成后的帧不得再判成摆位（判定必须是幂等的）");
assert.equal(restartView.ball.x, 2);

restartView.applySimSnapshot({ ...restart, t: 0.9, ball: { ...restart.ball, x: 95 } });
assert.ok(restartView.ball._relocAt, "second restart should start another transition");
restartView.applySimSnapshot(at(300));
assert.equal(restartView.ball.x, base.ball.x, "a highlight cut must discard the old restart path");
assert.equal(restartView.ball._relocAt, 0);
const freshView = makeView(base);
freshView.applySimSnapshot(at(300));
assert.deepEqual(restartView.officials, freshView.officials, "officials must join the new scene with the players");

const taker = base.players.find((player) => player.id !== owner.id && player.role !== "GK");
const beforeRestart = at(100, { x: 60, y: 60, z: 0, owner: owner.id, state: "held" },
  base.players.map((player) => ({ ...player,
    x: player.id === owner.id ? 60 : 80, y: player.id === owner.id ? 60 : 80,
  })));
const afterRestart = {
  ...at(100.1, { x: 20, y: 20, z: 0, owner: taker.id, state: "held", restartType: "freekick" },
    base.players.map((player) => ({ ...player, x: 20, y: 20 }))),
  motionContext: { discontinuity: true, reason: "dead-ball" },
};
const boundaryView = makeView(beforeRestart);
boundaryView.applySimSnapshot(beforeRestart);
for (const alpha of [0.4, 0.45, 0.48, 0.5, 0.9]) {
  boundaryView.applySimSnapshotLerped(beforeRestart, afterRestart, alpha);
  // 规格变更（2026-09-22）：这一对是**整队摆位**（22 人从 60/80 搬到 20/20，
  // 最远 75 m）⇒ 走剪辑 + 原子切换。旧断言「插值期间球权必须留在原持球者」是
  // **缓动路径**才需要的不变量；原子切换下「几何还是旧的、球权已是新的」那个
  // 窗口根本不存在。所以这里换成**更强**的条件：几何与球权必须同帧一起换，
  // 不允许出现混合态 —— 混合态本身就是幽灵持球人。
  const shownCarrier = boundaryView.carrier?.id ?? null;
  const shownBallX = boundaryView.ball.x;
  assert.ok(
    (shownCarrier === owner.id && shownBallX === beforeRestart.ball.x) ||
      (shownCarrier === taker.id && shownBallX === afterRestart.ball.x),
    `whole-team placement must switch geometry and ownership in the same frame ` +
      `(carrier=${shownCarrier} ballX=${shownBallX})`
  );
}
assert.equal(boundaryView.motionMonitor.auditSummary().byType["owner-ball-gap"] || 0, 0,
  "restart interpolation must not create a phantom remote owner");

// A small restart placement used to slip under the 3-field-unit threshold.
// Interpolating the early half of that pair happened before the new restart
// flag, so both the picture and monitor saw a spurious open-play sprint.
for (const axis of ["x", "y"]) {
  for (const sign of [-1, 1]) {
    const scale = axis === "x" ? 0.68 : 1.05;
    const displacement = axis === "x" ? 1.8 : 2.5;
    const first = at(7.4, { x: 50.5, y: 50.5, z: 0, state: "held", owner: base.players[1].id },
      base.players.map((p) => ({ ...p, x: 50, y: 50 })));
    const next = {
      ...at(7.5, { ...first.ball, [axis]: first.ball[axis] + sign * displacement / scale,
        restartType: "freekick" }, first.players.map((p) => ({ ...p,
        [axis]: p[axis] + sign * displacement / scale,
      }))),
      motionContext: { discontinuity: true, reason: "dead-ball" },
    };
    const small = makeView(first);
    small.applySimSnapshot(first);
    for (const alpha of [0.12, 0.4, 0.48, 0.7, 0.99]) {
      small.applySimSnapshotLerped(first, next, alpha);
      assert.equal(small.players[1][axis], 50, "small restart placements must wait for the actual boundary");
      assert.equal(small.ball[axis], first.ball[axis], "the ball must wait with its relocating owner");
    }
    small.applySimSnapshotLerped(first, next, 1);
    assert.equal(small.players[1][axis], 50, "the first relocation frame must preserve the outgoing position");
    small.applySimSnapshot({ ...next, t: 7.7 });
    assert.ok(metres(first.players[1], small.players[1]) > 0);
    assert.ok(metres(first.players[1], small.players[1]) < displacement);
    assert.ok(Math.abs(metres(small.players[1], small.ball) - metres(first.players[1], first.ball)) < 1e-8,
      "the recorded owner/ball offset must survive the shared restart transition");
    small.applySimSnapshot({ ...next, t: 8.0 });
    small.applySimSnapshot({ ...next, t: 8.21 });
    assert.equal(small.players[1][axis], next.players[1][axis]);
    assert.equal(small.motionMonitor.auditSummary().byType["player-teleport"] || 0, 0);
  }
}

// Unmodified raw frames from the historical 07f1391 playback reproduction.
// Keep these in the repository so this regression does not depend on local logs
// or on a later engine continuing to generate the same match.
const historicalRestart = JSON.parse(readFileSync(new URL("./fixtures/restart-placement-51117.json", import.meta.url)));
const originalRecording = JSON.stringify(historicalRestart.frames);
const historicalTo = historicalRestart.frames.find((frame) => frame.motionContext?.discontinuity);
const historicalFrom = historicalRestart.frames[historicalRestart.frames.indexOf(historicalTo) - 1];
assert.ok(historicalFrom && historicalTo);
for (const incident of historicalRestart.incidents) {
  const from = historicalFrom.players.find((p) => p.id === incident.entityId);
  const to = historicalTo.players.find((p) => p.id === incident.entityId);
  assert.ok(Math.hypot(to.x - from.x, to.y - from.y) < 3, "the historical placement must exercise the old blind spot");
  assert.ok(metres(from, to) / (historicalTo.t - historicalFrom.t) > 10);
  // 规格变更（2026-09-22）：这一对是**整队摆位**（22 人全部超物理上限，
  // 最远 45.5 m —— 实测见 `.tmp` 诊断与 `_restart-snap-census.mjs`）⇒ 走剪辑 + 原子切换。
  // 旧断言要求「插值期间实体必须停在出发点」，那是**缓动路径**的中间态契约；
  // 原子切换下没有中间态。新断言其实更严：**不允许任何中间几何** ——
  // 要么全在出发点、要么全在新点。插在两者之间正是用户看到的「球员滑过整个缺口」。
  for (const fps of [30, 60, 120]) {
    const historicalView = makeView(historicalFrom);
    const historicalField = makeFieldStub();
    historicalView.fieldEl = historicalField;
    historicalView.applySimSnapshot(historicalFrom);
    const steps = Math.round(fps * (historicalTo.t - historicalFrom.t));
    for (let i = 1; i < steps; i++) {
      historicalView.applySimSnapshotLerped(historicalFrom, historicalTo, i / steps);
      const shown = historicalView.players.find((p) => p.id === incident.entityId);
      const atFrom = Math.abs(shown.x - from.x) < 1e-9 && Math.abs(shown.y - from.y) < 1e-9;
      const atTo = Math.abs(shown.x - to.x) < 1e-9 && Math.abs(shown.y - to.y) < 1e-9;
      assert.ok(atFrom || atTo,
        "a whole-team placement must never render an intermediate geometry");
    }
    assert.ok(historicalField.added.includes("mp-seg-cut"),
      "a whole-team placement must be announced as a scene cut");
    historicalView.applySimSnapshot(historicalTo);
    assert.equal(historicalView.motionMonitor.auditSummary().byType["player-teleport"] || 0, 0);
  }
}
assert.equal(JSON.stringify(historicalRestart.frames), originalRecording, "playback cannot mutate the preserved raw recording");

view.applySimSnapshot({ ...nextHeld, t: 400 });
const live = view.captureSceneSnapshot();
view.applySimSnapshot(at(10));
view.restoreSceneSnapshot(live);
assert.deepEqual(view.captureSceneSnapshot(), live, "replay must restore ball height, ownership, officials and clocks exactly");

const engine = makeEngine();
engine.ball._deflectPulse = contact;
engine.t = contact.t;
for (let i = 0; i < 3; i++) {
  assert.deepEqual(engine.snapshot().ball.deflect, contact);
  assert.deepEqual(compactSimFrame(engine).ball.deflect, contact);
}
engine.t = contact.t - 0.01;
assert.equal(ballDeflectionOf(engine), null, "future contact evidence must stay hidden");
engine.t = contact.t + 0.36;
assert.equal(ballDeflectionOf(engine), null, "stale contact evidence must expire");

const control = makeEngine();
const observed = makeEngine();
let contacts = 0;
let lastContact = null;
// Reading both live and recorded frames must leave the next physical states,
// RNG consumption, events and results identical to an unobserved match.
while (control.t < 90 * 60) {
  control.step();
  observed.step();
  if (ballDeflectionOf(observed)?.t !== lastContact && ballDeflectionOf(observed)) {
    lastContact = ballDeflectionOf(observed).t;
    contacts++;
  }
  const snapshot = observed.snapshot();
  compactSimFrame(observed);
  compactSimFrame(observed);
  assert.deepEqual(observed.snapshot(), snapshot, "recorded frame reads changed the live snapshot");
  assert.deepEqual(snapshot, control.snapshot(), "presentation reads changed simulation state");
}
assert.ok(contacts > 10, "the match must exercise actual contact events");
assert.deepEqual(observed.events, control.events);
assert.deepEqual(observed.directResult(), control.directResult());
console.log(`Match continuity audit passed: 30/60/120fps, paused frames, restarts, replay restoration, ${contacts} contacts, identical full-match results`);
