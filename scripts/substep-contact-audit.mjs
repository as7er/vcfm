// Newtonian bound at each actual contact-resolution timestamp. Production's
// coarse movement must not expose the end position to an earlier ball substep.
// --report records the old defect without asserting the candidate behavior.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, index) => ({ id: `${id}-${index}`, name: `${id}-${index}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "acceleration", "agility", "shooting", "passing", "dribbling",
        "defending", "physical", "finishing", "tackling", "marking", "strength", "stamina", "vision",
        "reflexes", "handling", "positioning", "kicking", "decisions"].map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

const rows = [];
for (const profile of ["standard", "background"]) {
  for (const axis of ["x", "y"]) {
    for (const direction of [-1, 1]) {
      const dt = profile === "background" ? 0.3 : SIM.DT;
      const engine = new SimEngine(club("home"), club("away"), {
        random: () => 0.5, simulationProfile: profile, timeStep: dt,
      });
      const a = engine.agents.find((p) => p.team === "home" && p.role === "DEF");
      const speedUnits = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * a.attr.pace);
      Object.assign(a, { x: 20, y: 20, tx: axis === "x" ? direction > 0 ? 80 : 2 : 20,
        ty: axis === "y" ? direction > 0 ? 80 : 2 : 20,
        vx: axis === "x" ? direction * speedUnits : 0,
        vy: axis === "y" ? direction * speedUnits : 0,
        heading: axis === "x" ? direction > 0 ? 0 : Math.PI : direction * Math.PI / 2,
        fsm: "home", fitness: 100 });
      engine.agents = [a];
      engine.t = 100;
      engine.deadBallUntil = 0;
      engine._fatigueCheckT = Infinity;
      engine._think = () => {};
      Object.assign(engine.ball, { owner: null, state: "shot", x: 60, y: 60, z: 0.5,
        vx: 0, vy: -10, vz: 0, lastKicker: null, kickTeam: "away", receiverId: null,
        restartType: null, _saveChecked: false, _blockersChecked: new Set(), _handballChecked: new Set() });
      const resolve = engine._resolvePossession;
      const observations = [];
      engine._resolvePossession = function (stepDt) {
        const elapsed = this.t - 100 + stepDt;
        const distance = Math.hypot((a.x - 20) * 0.68, (a.y - 20) * 1.05);
        const maxDistance = speedUnits * (axis === "x" ? 0.68 : 1.05) * elapsed;
        observations.push({ elapsed, distance, maxDistance, futureTravel: Math.max(0, distance - maxDistance) });
        return resolve.call(this, stepDt);
      };
      engine.step(dt);
      assert.equal(observations.length, profile === "background" ? 3 : 1);
      rows.push({ profile, axis, direction, observations });
    }
  }
}
const violations = rows.flatMap((row) => row.observations.filter((o) => o.futureTravel > 1e-8));
const collisionEngine = new SimEngine(club("home"), club("away"), {
  random: () => 0.5, simulationProfile: "background", timeStep: 0.3,
});
collisionEngine.agents = collisionEngine.agents.filter((a) => a.team === "home" && a.role === "DEF").slice(0, 2);
collisionEngine.agents.forEach((a, index) => {
  const sign = index ? -1 : 1;
  Object.assign(a, { x: index ? 22.7 : 20, y: 20, tx: index ? 10 : 32.7, ty: 80,
    vx: sign * 1.5, vy: 4, heading: Math.atan2(4, sign * 1.5), fsm: "home", fitness: 100 });
});
collisionEngine.t = 100;
collisionEngine.deadBallUntil = 0;
collisionEngine._fatigueCheckT = Infinity;
collisionEngine._think = () => {};
Object.assign(collisionEngine.ball, { owner: null, state: "shot", x: 60, y: 60, z: 0.5,
  vx: 0, vy: -10, vz: 0, lastKicker: null, kickTeam: "away", receiverId: null, restartType: null });
const separate = collisionEngine._separateAgents;
const separationRows = [];
collisionEngine._separateAgents = function (...args) {
  const before = this.agents.map((a) => ({ x: a.x, y: a.y }));
  assert.ok(Math.abs(before[0].y - before[1].y) < 1e-8, "the controlled collision normal is horizontal");
  const result = separate.apply(this, args);
  const lateralDrift = Math.max(...this.agents.map((a, i) => Math.abs(a.y - before[i].y)));
  separationRows.push({ at: this.t, epoch: this._motionStepEpoch, lateralDrift });
  return result;
};
collisionEngine.step(0.3);

const earlyContactRows = [];
for (const restartAfterContact of [false, true]) {
  const engine = new SimEngine(club("home"), club("away"), {
    random: () => 0, simulationProfile: "background", timeStep: 0.3,
  });
  const receiver = engine.agents.find((a) => a.team === "home" && a.role === "DEF");
  Object.assign(receiver, { x: 21, y: 20, tx: 80, ty: 20, vx: 0, vy: 0, heading: 0,
    fsm: "receive", noReclaimUntil: 0 });
  engine.agents = [receiver];
  engine.t = 100;
  engine.deadBallUntil = 0;
  engine._fatigueCheckT = Infinity;
  engine._think = () => {};
  Object.assign(engine.ball, { owner: null, state: "pass", x: 20, y: 20, z: 0,
    vx: 5 / 0.68, vy: 0, vz: 0, lastKicker: null, kickTeam: "home", receiverId: receiver.id,
    kickX: 5, kickY: 20, lastPassAt: 99, expectedAt: 100.3, restartType: null,
    isCrossPass: false, offsideIds: new Set() });
  const resolve = engine._resolvePossession;
  let calls = 0;
  let firstControlAt = null;
  let restartPosition = null;
  engine._resolvePossession = function (dt) {
    calls++;
    const result = resolve.call(this, dt);
    if (calls === 1) {
      assert.equal(this.ball.owner, receiver.id, "the actual possession solver completes the early reception");
      firstControlAt = this.t;
      if (restartAfterContact) {
        this._restart("freekick", "home", 30, 50);
        restartPosition = { x: receiver.x, y: receiver.y };
      }
    }
    return result;
  };
  engine.step(0.3);
  earlyContactRows.push({ restartAfterContact, calls, firstControlAt, endTime: engine.t,
    finalBallState: engine.ball.state, restartPosition,
    finalPosition: { x: receiver.x, y: receiver.y } });
  if (restartAfterContact) assert.deepEqual({ x: receiver.x, y: receiver.y }, restartPosition,
    "the new restart scene must not receive leftover open-play movement");
}

const savedFlightRows = [];
for (const team of ["home", "away"]) {
  const engine = new SimEngine(club("home"), club("away"), {
    random: () => 0.5, simulationProfile: "background", timeStep: 0.3,
  });
  const keeper = engine.agents.find((a) => a.team === team && a.role === "GK");
  const dir = team === "home" ? 1 : -1;
  const goalY = team === "home" ? 100 : 0;
  Object.assign(keeper, { x: 50, y: goalY - dir * 5, tx: 50, ty: goalY - dir * 5,
    vx: 0, vy: 0, fsm: "home" });
  engine.agents = [keeper];
  engine.t = 100;
  engine.deadBallUntil = 0;
  engine._fatigueCheckT = Infinity;
  engine._think = () => {};
  const draws = [0, 0.99]; // successful save, parried rather than held
  engine.random = () => draws.length ? draws.shift() : 0;
  Object.assign(engine.ball, { owner: null, state: "shot", x: 50, y: goalY - dir * 7.5,
    z: 0.5, vx: 0, vy: dir * 10, vz: 0, lastKicker: null, receiverId: null,
    kickTeam: team === "home" ? "away" : "home", restartType: null, settleUntil: 0,
    _saveChecked: false, _blockersChecked: new Set(), _handballChecked: new Set() });
  const resolve = engine._resolvePossession;
  let calls = 0;
  let firstSaveY;
  engine._resolvePossession = function (dt) {
    calls++;
    const result = resolve.call(this, dt);
    if (calls === 1) {
      assert.ok(this.events.some((event) => event.type === "save"), "the actual solver must produce a save");
      assert.equal(this.ball.state, "loose", "the saved ball is still in flight");
      firstSaveY = this.ball.y;
    }
    return result;
  };
  engine.step(0.3);
  savedFlightRows.push({ team, calls, remainingTravelMetres: (engine.ball.y - firstSaveY) * dir * 1.05 });
}

const closingEngine = new SimEngine(club("home"), club("away"), {
  random: () => 0.99, simulationProfile: "background", timeStep: 0.3,
});
const carrier = closingEngine.agents.find((a) => a.team === "home" && a.role === "DEF");
const defender = closingEngine.agents.find((a) => a.team === "away" && a.role === "DEF");
Object.assign(carrier, { x: 50, y: 50, tx: 50, ty: 50, vx: 0, vy: 0, fsm: "carry", protectUntil: 0 });
Object.assign(defender, { x: 55.5, y: 50, tx: 40, ty: 50, vx: -5, vy: 0,
  heading: Math.PI, fsm: "press", tackleCdUntil: 0 });
closingEngine.agents = [carrier, defender];
closingEngine.t = 100;
closingEngine.deadBallUntil = 0;
closingEngine._phaseTeam = "home";
closingEngine._teamAttackSince.home = 90;
closingEngine._teamTackleUntil.away = 0;
closingEngine._fatigueCheckT = Infinity;
closingEngine._think = () => {};
Object.assign(closingEngine.ball, { state: "held", owner: carrier.id, x: 50, y: 50,
  z: 0, vx: 0, vy: 0, vz: 0, restartType: null, settleUntil: 0 });
assert.equal(closingEngine._contactFineReason(), null, "the defender starts outside the contact window");
const closingResolve = closingEngine._resolvePossession;
let closingContactStep;
closingEngine._resolvePossession = function (dt) {
  closingContactStep = this._activeStepDt;
  return closingResolve.call(this, dt);
};
closingEngine.step(0.3);

console.log(JSON.stringify({ scenarios: rows.length + 6, violations: violations.length,
  maximumFutureTravelMetres: Math.max(0, ...violations.map((o) => o.futureTravel)),
  separationRows, earlyContactRows, savedFlightRows, closingContactStep, rows }, null, 2));
if (!process.argv.includes("--report")) {
  assert.equal(violations.length, 0, "contact resolution cannot use a player position from a later time");
  assert.ok(separationRows.every((row) => row.lateralDrift < 1e-8),
    "a horizontal separation correction must not rewind movement from earlier substeps");
  assert.equal(earlyContactRows[0].calls, 3, "an early reception must not discard the remaining simulated time");
  assert.equal(earlyContactRows[1].calls, 1, "a restart ends the old movement interval");
  assert.ok(savedFlightRows.every((row) => row.calls === 3 && row.remainingTravelMetres > 1),
    "a goalkeeper's temporary protection must not stop a parried ball's flight");
  assert.equal(closingContactStep, SIM.DT, "contact sampling must use the actual post-movement proximity");
}
