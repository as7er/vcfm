import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";

function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "passing", "vision", "shooting", "finishing", "dribbling",
        "tackling", "marking", "strength", "stamina", "positioning", "reflexes", "handling", "kicking", "crossing"]
        .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

let cases = 0;
for (const team of ["home", "away"]) {
  for (const side of [-1, 1]) {
    let draws = 0;
    const engine = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
    engine.t = 100;
    const passer = engine.agents.find((a) => a.team === team && a.role === "MID");
    const receiver = engine.agents.find((a) => a.team === team && a.role === "ATT");
    const excluded = engine.agents.find((a) => a.team === team && a.role === "ATT" && a !== receiver);
    for (const a of engine.agents) Object.assign(a, { sentOff: true, vx: 0, vy: 0 });
    const goalY = engine.targetGoalY(team);
    const dir = engine.attackDir(team);
    Object.assign(passer, { x: 50 + side * 30, y: goalY - dir * 28, sentOff: false,
      actionPreparationActive: false });
    Object.assign(receiver, { x: 50 - side * 12, y: goalY - dir * 17, sentOff: false });
    Object.assign(excluded, { x: receiver.x + side * 3, y: receiver.y, sentOff: false, injuredOff: true });
    Object.assign(engine.ball, { x: passer.x, y: passer.y, owner: passer.id, state: "held", z: 0,
      vx: 0, vy: 0, vz: 0, restartType: null, offsideExemptRestart: false });
    const assessed = [];
    const lane = engine._laneSafety;
    engine._laneSafety = function (from, to, tx = to.x, ty = to.y) {
      assessed.push({ id: to.id, x: tx, y: ty });
      return lane.call(this, from, to, tx, ty);
    };
    const before = draws;
    const chosen = engine._bestCross(passer);
    assert.ok(chosen && chosen.agent === receiver, "only the active receiver can be selected");
    assert.equal(draws - before, 2, "cross destination keeps its two existing random draws");
    assert.deepEqual(assessed, [{ id: receiver.id, x: chosen.tx, y: chosen.ty }],
      "the assessed lane must be the actual cross destination, excluding inactive players");
    assert.ok(chosen.tx !== receiver.x && chosen.ty !== receiver.y, "fixture distinguishes both targets");
    engine._pass(passer, chosen, true);
    assert.equal(engine.ball.targetX, assessed[0].x);
    assert.equal(engine.ball.targetY, assessed[0].y);
    const event = engine.events.findLast((event) => event.type === "pass");
    assert.deepEqual({ x: event.toX, y: event.toY }, { x: assessed[0].x, y: assessed[0].y });
    assert.deepEqual({ x: receiver.intent.tx, y: receiver.intent.ty }, { x: assessed[0].x, y: assessed[0].y });
    cases++;
  }
}
console.log(`Pass destination audit passed: ${cases} mirrored cross selection, flight, receiver and event cases`);
