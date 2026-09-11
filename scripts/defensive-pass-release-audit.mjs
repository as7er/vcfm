// Changing the storage order of the same players must not delay the first
// defensive response to an otherwise identical, already executed pass.
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
function play(team, side, dt, reversed) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.5,
    simulationProfile: dt === 0.3 ? "background" : "standard", timeStep: dt,
    separationPasses: dt === 0.3 ? 4 : 8 });
  const dir = e.attackDir(team), y = team === "home" ? 30 : 70;
  const passer = e.agentById(`${team}-6`), receiver = e.agentById(`${team}-8`),
    a = e.agentById(`${team === "home" ? "away" : "home"}-2`);
  for (const p of e.agents) p.sentOff = ![passer, receiver, a].includes(p);
  Object.assign(passer, { x: 50 - side * 20, y, vx: 0, vy: 0, tx: 50 - side * 20, ty: y,
    decisionUntil: 0, heading: side > 0 ? 0 : Math.PI, pendingBallAction: null, controlPhase: "settled" });
  Object.assign(receiver, { x: 50 + side * 16, y, vx: 0, vy: 0, tx: 50 + side * 16, ty: y,
    attackThinkUntil: 101 });
  Object.assign(a, { x: 50, y: y + dir * 5, vx: 0, vy: 0, heading: Math.atan2(-dir, side) });
  e.t = 100; e.deadBallUntil = 0; e.cornerShapeUntil = 0; e._phaseTeam = team;
  e._teamAttackSince[team] = 50; e._fatigueCheckT = 1000;
  Object.assign(e.ball, { x: passer.x, y, vx: 0, vy: 0, z: 0, vz: 0, owner: passer.id,
    state: "held", restartType: null, receiverId: null, kickTeam: team, offsideExemptRestart: false });
  // Isolate identical pass execution from on-ball option sampling. Everything
  // from _pass through team jobs, physics and possession remains real.
  e._decideOnBall = (actor) => {
    assert.equal(actor.id, passer.id);
    e._pass(actor, { agent: receiver, tx: receiver.x, ty: receiver.y }, true);
  };
  if (reversed) e.agents.reverse();
  e.step(dt);
  assert.equal(e.ball.state, "pass");
  return { t: e.t, ball: { x: e.ball.x, y: e.ball.y, vx: e.ball.vx, vy: e.ball.vy },
    player: { x: a.x, y: a.y, vx: a.vx, vy: a.vy, tx: a.tx, ty: a.ty, fsm: a.fsm },
    point: a._passIntercept ? { ...a._passIntercept } : null };
}
const reports = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) for (const dt of [SIM.DT, 0.3]) {
  const normal = play(team, side, dt, false), reversed = play(team, side, dt, true);
  const row = { team, side, dt, normal, reversed };
  reports.push(row);
  if (JSON.stringify(normal) !== JSON.stringify(reversed)) failures.push(row);
}
console.log(JSON.stringify({ cases: reports.length, failures, reports }, null, 2));
assert.deepEqual(failures, [], "defenders must observe the executed pass independently of the player array order");
