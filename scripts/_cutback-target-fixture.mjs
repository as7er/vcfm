// Known defect: production fails until a candidate passes both full-match profiles.
import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";

function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "passing", "vision", "shooting", "finishing", "dribbling",
        "tackling", "marking", "strength", "stamina", "positioning", "reflexes", "handling", "kicking"]
        .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

let cases = 0;
for (const team of ["home", "away"]) {
  for (const side of [-1, 1]) {
    let draws = 0;
    const engine = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
    engine.t = 100;
    const passer = engine.agents.find((a) => a.team === team && a.role === "ATT");
    const receiver = engine.agents.find((a) => a.team === team && a.role === "MID");
    for (const a of engine.agents) Object.assign(a, { sentOff: true, vx: 0, vy: 0 });
    const goalY = engine.targetGoalY(team);
    const dir = engine.attackDir(team);
    Object.assign(passer, { x: 50 + side * 27, y: goalY - dir * 4, sentOff: false,
      actionPreparationActive: false });
    Object.assign(receiver, { x: 50 + side * 10, y: goalY - dir * 16, sentOff: false });
    Object.assign(engine.ball, { x: passer.x, y: passer.y, owner: passer.id, state: "held", z: 0,
      vx: 0, vy: 0, vz: 0, restartType: null, offsideExemptRestart: false });
    const lane = engine._laneSafety;
    const evaluated = [];
    engine._laneSafety = function (from, to, tx = to.x, ty = to.y) {
      evaluated.push({ id: to.id, x: tx, y: ty });
      return lane.call(this, from, to, tx, ty);
    };
    const before = draws;
    const chosen = engine._bestCutback(passer);
    assert.ok(chosen && chosen.agent === receiver, "the fixture has one valid cutback receiver");
    assert.equal(draws, before, "evaluating a cutback consumes no random draws");
    const assessed = evaluated.find((item) => item.id === receiver.id);
    assert.deepEqual({ x: assessed.x, y: assessed.y }, { x: chosen.tx, y: chosen.ty },
      "cutback lane safety must evaluate the destination that will actually be kicked toward");
    assert.ok(chosen.tx !== receiver.x || chosen.ty !== receiver.y,
      "the case must distinguish the receiver position from the cutback destination");
    engine._pass(passer, chosen, true);
    assert.equal(engine.ball.targetX, assessed.x);
    assert.equal(engine.ball.targetY, assessed.y);
    const event = engine.events.findLast((event) => event.type === "pass");
    assert.deepEqual({ x: event.toX, y: event.toY }, { x: assessed.x, y: assessed.y },
      "the evaluated lane, engine flight and reported pass share the destination");
    cases++;
  }
}
console.log(`Cutback target audit passed: ${cases} mirrored selection, flight and event cases`);
