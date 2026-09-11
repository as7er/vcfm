// A selected third player must start the signalled run before the common
// movement phase, regardless of his slot in the already-running think loop.
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
function scene(team, side, dt, depth, reversed) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.5,
    simulationProfile: dt === 0.3 ? "background" : "standard", timeStep: dt,
    separationPasses: dt === 0.3 ? 4 : 8 });
  const dir = e.attackDir(team), other = team === "home" ? "away" : "home";
  const depthY = (m) => e.targetGoalY(team) - dir * m / 1.05;
  const passer = e.agentById(`${team}-5`), receiver = e.agentById(`${team}-8`),
    runner = e.agentById(`${team}-9`), keeper = e.agentById(`${other}-0`),
    defender = e.agentById(`${other}-2`);
  for (const a of e.agents) a.sentOff = ![passer, receiver, runner, keeper, defender].includes(a);
  Object.assign(passer, { x: 50 + side * 5, y: depthY(32), tx: 50 + side * 5,
    ty: depthY(32), vx: 0, vy: 0, heading: Math.atan2(dir, side * 0.2),
    decisionUntil: 0, pendingBallAction: null, controlPhase: "settled" });
  Object.assign(receiver, { x: 50 + side * 12, y: depthY(depth), tx: 50 + side * 12,
    ty: depthY(depth), vx: 0, vy: 0, attackThinkUntil: 1000 });
  Object.assign(runner, { x: 50 - side * 18, y: depthY(28), tx: 50 - side * 18,
    ty: depthY(28), baseX: 50 - side * 18, vx: 0, vy: 0,
    heading: Math.atan2(dir, 0), attackThinkUntil: 1000, offBallTarget: null });
  Object.assign(keeper, { x: 50, y: depthY(1.5), tx: 50, ty: depthY(1.5), vx: 0, vy: 0 });
  Object.assign(defender, { x: 50 + side * 30, y: depthY(Math.min(14, depth - 2)), vx: 0, vy: 0 });
  e.t = 100; e.deadBallUntil = 0; e.cornerShapeUntil = 0; e._phaseTeam = team;
  e._teamAttackSince[team] = 50; e._fatigueCheckT = 1000;
  Object.assign(e.ball, { x: passer.x, y: passer.y, vx: 0, vy: 0, z: 0, vz: 0,
    owner: passer.id, state: "held", restartType: null, receiverId: null,
    kickTeam: team, offsideExemptRestart: false, settleUntil: 0 });
  e._decideOnBall = (a) => {
    assert.equal(a.id, passer.id);
    e._pass(a, { agent: receiver, tx: receiver.x, ty: receiver.y }, true);
  };
  if (reversed) e.agents.reverse();
  e.step(dt);
  assert.equal(e.ball.state, "pass", "fixture must execute the same real pass");
  assert.equal(e._passSupportRun?.playerId, runner.id, "fixture must select the same third player");
  return { ball: { x: e.ball.x, y: e.ball.y, z: e.ball.z, vx: e.ball.vx, vy: e.ball.vy },
    plan: e._passSupportRun,
    runner: { x: runner.x, y: runner.y, tx: runner.tx, ty: runner.ty, vx: runner.vx, vy: runner.vy,
      fsm: runner.fsm, kind: runner.offBallTarget?.kind ?? null } };
}
const reports = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) for (const dt of [SIM.DT, 0.3]) {
  for (const depth of [8, 22]) {
    const normal = scene(team, side, dt, depth, false), reversed = scene(team, side, dt, depth, true);
    assert.deepEqual(normal.ball, reversed.ball, "the compared kick and flight must be identical");
    assert.deepEqual(normal.plan, reversed.plan, "the selected run must be identical");
    const row = { team, side, dt, depth, normal, reversed };
    reports.push(row);
    if (JSON.stringify(normal.runner) !== JSON.stringify(reversed.runner) ||
        Math.hypot(normal.runner.vx, normal.runner.vy) < 1e-8 ||
        Math.hypot(reversed.runner.vx, reversed.runner.vy) < 1e-8) failures.push(row);
  }
}
console.log(JSON.stringify({ cases: reports.length, failures, reports }, null, 2));
assert.deepEqual(failures, [], "the assigned third-player run must start independently of array order");
