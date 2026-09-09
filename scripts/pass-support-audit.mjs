import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "passing", "vision", "shooting", "finishing", "dribbling",
        "tackling", "marking", "strength", "stamina", "positioning", "reflexes", "handling", "kicking"]
        .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const runKind = (a) => a.offBallTargetKind === "third-man-run" || a.offBallTargetKind === "cutback-outlet";
const metres = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);
function scene(team, receptionDepth = 22) {
  const engine = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
  const dir = engine.attackDir(team);
  const goalY = engine.targetGoalY(team);
  const depthY = (metres) => goalY - dir * metres / 1.05;
  for (const a of engine.agents) Object.assign(a, { x: a.baseX, y: depthY(a.team === team ? 70 : Math.min(14, receptionDepth - 2)),
    vx: 0, vy: 0, sentOff: false, injuredOff: false, habits: [] });
  const passer = engine.agentById(`${team}-5`);
  const receiver = engine.agentById(`${team}-8`);
  Object.assign(passer, { x: 45, y: depthY(32), actionPreparationActive: false });
  Object.assign(receiver, { x: 60, y: depthY(receptionDepth), actionPreparationActive: false });
  for (const [i, x] of [[9, 30], [10, 75]]) Object.assign(engine.agentById(`${team}-${i}`), { x, y: depthY(32) });
  Object.assign(engine.ball, { x: passer.x, y: passer.y, owner: passer.id, state: "held", z: 0,
    restartType: null, kickoffPassUntil: 0, offsideExemptRestart: false });
  engine.t = 100;
  engine.deadBallUntil = 0;
  engine._teamAttackSince[team] = 90;
  engine._pass(passer, { agent: receiver, tx: receiver.x, ty: receiver.y, through: false }, true);
  assert.equal(engine.ball.state, "pass");
  for (const a of engine.agents.filter((a) => a.team === team && a.role === "ATT" && a !== receiver)) {
    engine._thinkAttackOffBall(a, receiver);
  }
  const runners = engine.agents.filter(runKind);
  assert.equal(runners.length, 1, "one actual forward pass should trigger one third-player run");
  return { engine, passer, receiver, runner: runners[0], depthY };
}

let cases = 0;
for (const team of ["home", "away"]) {
  const { engine, receiver, runner, depthY } = scene(team);
  assert.notEqual(runner.id, receiver.id, "the intended receiver keeps their reception assignment");
  const target = { x: runner.tx, y: runner.ty };
  const start = { x: runner.x, y: runner.y };
  for (let i = 0; i < 5; i++) engine._integrate(runner, SIM.DT);
  assert.ok(metres(start, runner) > 0.5, "the run must produce actual physical movement");
  assert.ok(Math.hypot(runner.vx, runner.vy) <= SIM.MAX_PLAYER_SPEED,
    "a triggered run must use the normal speed limit");
  const nextReceiver = engine.agentById(`${team}-6`);
  Object.assign(nextReceiver, { x: 40, y: depthY(25) });
  engine.t += 0.5;
  Object.assign(engine.ball, { x: receiver.x, y: receiver.y, owner: receiver.id, state: "held", restartType: null });
  engine._pass(receiver, { agent: nextReceiver, tx: nextReceiver.x, ty: nextReceiver.y }, true);
  engine._thinkAttackOffBall(runner, nextReceiver);
  assert.equal(runKind(runner), true, "a subsequent pass must not interrupt a still-useful run");
  assert.deepEqual({ x: runner.tx, y: runner.ty }, target);
  engine.t += 20;
  engine._thinkAttackOffBall(runner, nextReceiver);
  assert.equal(runKind(runner), false, "an expired run returns to normal support decisions");
  cases += 3;

  const turnover = scene(team);
  turnover.engine._teamAttackSince[team] = turnover.engine.t + 0.1;
  turnover.engine._thinkAttackOffBall(turnover.runner, turnover.receiver);
  assert.equal(runKind(turnover.runner), false, "an old plan cannot resume in a new possession");
  const restart = scene(team);
  restart.engine._kickoff(team);
  restart.engine._thinkAttackOffBall(restart.runner, restart.receiver);
  assert.equal(runKind(restart.runner), false, "kickoff clears the previous attacking run");
  cases += 2;

  const pipeline = scene(team);
  pipeline.runner.attackThinkUntil = 0;
  pipeline.engine._think(pipeline.runner, SIM.DT, null, team, pipeline.receiver);
  assert.equal(pipeline.runner.offBallTarget?.kind, "third-man-run",
    "the triggered run survives the real tactics and target-reservation pipeline");
  assert.equal(pipeline.engine._isOffsidePosition(team, {
    x: pipeline.runner.tx, y: pipeline.runner.ty,
  }), false, "the committed onward target remains onside for the next pass");
  const pipelineStart = { x: pipeline.runner.x, y: pipeline.runner.y };
  for (let i = 0; i < 5; i++) pipeline.engine._integrate(pipeline.runner, SIM.DT);
  assert.ok(metres(pipelineStart, pipeline.runner) > 0.5,
    "the committed target causes physical movement, not just an intent label");
  cases++;

  const cutback = scene(team, 8);
  assert.equal(cutback.runner.offBallTargetKind, "cutback-outlet");
  assert.ok(Math.abs(cutback.runner.ty - cutback.engine.targetGoalY(team)) * 1.05 > 16.5,
    "a byline reception needs an outlet outside the crowded penalty area");
  cases++;

  function reception(flightSeconds, intended = true) {
    const e = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
    e.t = 100;
    const a = e.agentById(`${team}-8`);
    Object.assign(e.ball, { x: a.x, y: a.y, z: 0, vx: 4, vy: 0, vz: 0, owner: null,
      state: "pass", kickTeam: team, receiverId: intended ? a.id : null,
      lastPassAt: e.t - flightSeconds, isCrossPass: false });
    e._beginBallControl(a);
    assert.ok(a.decisionUntil >= a.controlUntil && a.decisionUntil >= e.ball.settleUntil,
      "advance observation cannot skip the physical first touch");
    return a.decisionUntil;
  }
  assert.ok(Math.abs(reception(0.2) - reception(1) - 0.8) < 1e-8,
    "the intended receiver can use the flight as observation time");
  assert.equal(reception(0.2, false), reception(1, false), "an unexpected collector has no intended-reception preparation");
  reception(10);
  cases += 2;
}
console.log(`Pass support audit passed: ${cases} mirrored physical runs, continuation, expiry, turnover, restart and reception cases`);
