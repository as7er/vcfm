// A physically clear close opportunity remains eligible during team pacing.
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

function scene(team, roll) {
  let draws = 0;
  const engine = new SimEngine(club("home"), club("away"), { random: () => { draws++; return roll; } });
  const a = engine.agents.find((p) => p.team === team && p.role === "ATT");
  const keeper = engine.agents.find((p) => p.team !== team && p.role === "GK");
  const defender = engine.agents.find((p) => p.team !== team && p.role === "DEF");
  for (const p of engine.agents) Object.assign(p, { sentOff: true, injuredOff: false, vx: 0, vy: 0 });
  const dir = engine.attackDir(team);
  const goalY = engine.targetGoalY(team);
  Object.assign(a, { sentOff: false, x: 50, y: goalY - dir * 12 / 1.05,
    heading: Math.atan2(dir, 0), actionPreparationActive: false, shotCdUntil: 0, habits: [] });
  Object.assign(keeper, { sentOff: false, x: 50, y: goalY - dir / 1.05 });
  Object.assign(defender, { x: 50, y: goalY - dir * 6 / 1.05 });
  Object.assign(engine.ball, { x: a.x, y: a.y, z: 0, owner: a.id, state: "held",
    restartType: null, kickoffPassUntil: 0, offsideExemptRestart: false });
  engine.t = 100;
  engine.deadBallUntil = 0;
  engine._teamShotUntil[team] = 400;
  engine._cornerAttackUntil[team] = 0;
  engine._teamAttackSince[team] = 0;
  return { engine, a, defender, draws: () => draws };
}

let cases = 0;
for (const team of ["home", "away"]) {
  const clear = scene(team, 0.05);
  const hasWindow = clear.engine._hasCloseShotWindow || clear.engine._probeHasCloseShot;
  assert.equal(typeof hasWindow, "function");
  const before = clear.draws();
  assert.equal(hasWindow.call(clear.engine, clear.a), true);
  assert.equal(clear.draws(), before, "observing a shot window must not consume randomness");
  clear.engine._decideOnBall(clear.a);
  assert.equal(clear.engine.ball.state, "shot", "a prepared clear opportunity is eligible during team pacing");
  cases++;

  const blocked = scene(team, 0.05);
  blocked.defender.sentOff = false;
  assert.equal(hasWindow.call(blocked.engine, blocked.a), false, "a defender in the actual block corridor closes the window");
  blocked.engine._decideOnBall(blocked.a);
  assert.notEqual(blocked.engine.ball.state, "shot", "blocked opportunities do not gain the close-window exception");
  blocked.defender.injuredOff = true;
  assert.equal(hasWindow.call(blocked.engine, blocked.a), true, "an injured-off player cannot block a real opportunity");
  cases++;

  const cautious = scene(team, 0.25);
  assert.equal(hasWindow.call(cautious.engine, cautious.a), true);
  cautious.engine._decideOnBall(cautious.a);
  assert.notEqual(cautious.engine.ball.state, "shot", "eligibility must preserve the existing pacing probability");
  cases++;

  const turned = scene(team, 0.05);
  turned.a.heading += Math.PI;
  assert.equal(hasWindow.call(turned.engine, turned.a), false, "the player must face the shooting corridor");
  turned.a.heading -= Math.PI;
  turned.engine.ball.restartType = "freekick";
  assert.equal(hasWindow.call(turned.engine, turned.a), false, "ordinary opportunities cannot override a restart");
  cases += 2;
}
console.log(`Attacking opportunity audit passed: ${cases} mirrored eligibility, blocking, facing and pacing cases`);
