import assert from "node:assert/strict";
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

const restartView = makeView(base);
restartView.applySimSnapshot(at(0));
const restart = {
  ...at(0.1, { x: 2, y: 2, z: 0, owner: owner.id, state: "corner", restartType: "corner" },
    base.players.map((player) => ({ ...player,
      x: player.id === owner.id ? 2 : 10, y: player.id === owner.id ? 3.5 : 20,
    }))),
  motionContext: { discontinuity: true },
};
restartView.applySimSnapshot(restart);
assert.equal(restartView.ball.x, 60, "restart placement must start at the displayed ball");
assert.equal(restartView.carrier, null, "corner taker cannot glow while the displayed ball is still far away");
const playerStart = restartView.players[1].x;
restartView.applySimSnapshot({ ...restart, t: 0.3 });
assert.ok(restartView.ball.x > 2 && restartView.ball.x < 60, "restart must move toward its target");
assert.notEqual(restartView.players[1].x, playerStart, "corner taker must use the same transition as the team");
const pausedBall = { x: restartView.ball.x, y: restartView.ball.y };
restartView.applySimSnapshot({ ...restart, t: 0.3 });
assert.equal(restartView.ball.x, pausedBall.x, "a paused restart must not advance on wall time");
restartView.applySimSnapshot({ ...restart, t: 0.5 });
restartView.applySimSnapshot({ ...restart, t: 0.81 });
assert.equal(restartView.ball.x, 2, "restart must finish in simulation time at every playback speed");
assert.equal(restartView.carrier?.id, owner.id, "the corner taker must regain ownership after placement");

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
  assert.equal(boundaryView.carrier?.id, owner.id, "held restart geometry cannot acquire the future taker");
}
assert.equal(boundaryView.motionMonitor.auditSummary().byType["owner-ball-gap"] || 0, 0,
  "restart interpolation must not create a phantom remote owner");

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
