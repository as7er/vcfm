// A goalkeeper must see an executed kick before the common motion step,
// independently of whether its array slot precedes or follows the kicker.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", pressing: 3, lineup: players.map((p) => p.id) } };
}
const point = (a) => ({ x: a.x, y: a.y, vx: a.vx, vy: a.vy, tx: a.tx, ty: a.ty, fsm: a.fsm });
function scene(team, side, dt, kind, reversed) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.5,
    simulationProfile: dt === 0.3 ? "background" : "standard", timeStep: dt,
    separationPasses: dt === 0.3 ? 4 : 8 });
  const other = team === "home" ? "away" : "home", dir = e.attackDir(team);
  const goalY = e.targetGoalY(team), shooter = e.agentById(`${team}-8`),
    receiver = e.agentById(`${team}-9`), keeper = e.agentById(`${other}-0`);
  for (const a of e.agents) a.sentOff = ![shooter, receiver, keeper].includes(a);
  Object.assign(shooter, { x: 50 + side * 8, y: goalY - dir * 27, tx: 50 + side * 8,
    ty: goalY - dir * 27, vx: 0, vy: 0, heading: Math.atan2(dir, -side * 0.2),
    decisionUntil: 0, pendingBallAction: null, actionPreparationActive: false, controlPhase: "settled" });
  Object.assign(receiver, { x: 50 + side * 4, y: goalY - dir * 12, tx: 50 + side * 4,
    ty: goalY - dir * 12, vx: 0, vy: 0, attackThinkUntil: 1000 });
  Object.assign(keeper, { x: 50 - side * 3, y: goalY - dir * 4, tx: 50,
    ty: goalY - dir * 4, vx: 0, vy: 0, heading: Math.atan2(-dir, 0) });
  e.t = 100; e.deadBallUntil = 0; e.cornerShapeUntil = 0; e._phaseTeam = team;
  e._teamAttackSince[team] = 50; e._fatigueCheckT = 1000;
  Object.assign(e.ball, { x: shooter.x, y: shooter.y, vx: 0, vy: 0, z: 0, vz: 0,
    state: "held", owner: shooter.id, kickTeam: team, receiverId: null,
    restartType: null, offsideExemptRestart: false, settleUntil: 0 });
  e._decideOnBall = (actor) => {
    assert.equal(actor.id, shooter.id);
    if (kind === "shot") e._shoot(actor, null, true);
    else e._pass(actor, { agent: receiver, tx: receiver.x, ty: receiver.y, through: kind === "through" }, true);
  };
  if (reversed) e.agents.reverse();
  e.step(dt);
  return { ball: { state: e.ball.state, x: e.ball.x, y: e.ball.y, z: e.ball.z,
    vx: e.ball.vx, vy: e.ball.vy, vz: e.ball.vz }, keeper: point(keeper) };
}
const reports = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  for (const dt of [SIM.DT, 0.3]) for (const kind of ["pass", "through", "shot"]) {
    const normal = scene(team, side, dt, kind, false), reversed = scene(team, side, dt, kind, true);
    const row = { team, side, dt, kind, normal, reversed };
    assert.deepEqual(normal.ball, reversed.ball, "the compared kick and flight must be identical");
    reports.push(row);
    if (JSON.stringify(normal.keeper) !== JSON.stringify(reversed.keeper)) failures.push(row);
  }
}
console.log(JSON.stringify({ cases: reports.length, failures, reports }, null, 2));
assert.deepEqual(failures, [], "an executed kick must reach every goalkeeper before movement");
