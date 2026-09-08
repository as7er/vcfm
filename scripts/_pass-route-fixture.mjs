// Controlled route cases for the process-local candidate. These assert visible
// football geometry, not a desired result from a seeded full match.
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

let cases = 0;
for (const team of ["home", "away"]) {
  for (const axis of ["x", "y"]) {
    for (const side of [-1, 1]) {
      let draws = 0;
      const engine = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
      assert.equal(typeof engine._probeLaunchRouteClear, "function", "run through the flight route wrapper");
      const passer = engine.agents.find((a) => a.team === team && a.role === "MID");
      const receiver = engine.agents.find((a) => a.team === team && a.role === "ATT");
      const defender = engine.agents.find((a) => a.team !== team && a.role === "DEF");
      for (const a of engine.agents) Object.assign(a, { sentOff: true, injuredOff: false, vx: 0, vy: 0 });
      passer.sentOff = receiver.sentOff = defender.sentOff = false;
      const scale = axis === "x" ? SIM.PITCH_W_METRES / SIM.FIELD_W : SIM.PITCH_H_METRES / SIM.FIELD_H;
      const other = axis === "x" ? "y" : "x";
      const otherScale = other === "x" ? SIM.PITCH_W_METRES / SIM.FIELD_W : SIM.PITCH_H_METRES / SIM.FIELD_H;
      const position = (along, lateral = 0) => ({ [axis]: 50 + side * along / scale, [other]: 50 + lateral / otherScale });
      Object.assign(passer, position(-2), { actionPreparationActive: false });
      Object.assign(receiver, position(12));
      Object.assign(defender, position(1.5));
      Object.assign(engine.ball, { x: 50, y: 50, owner: passer.id, state: "held", z: 0,
        vx: 0, vy: 0, vz: 0, restartType: null, offsideExemptRestart: false });
      engine._teamThroughUntil[team] = Infinity;
      const target = { tx: receiver.x, ty: receiver.y, agent: receiver };

      const before = draws;
      assert.equal(engine._probeLaunchRouteClear(passer, target), false, "a defender blocks a ground launch lane");
      assert.equal(draws, before, "route prediction consumes no random draws");
      assert.ok(!engine._passCandidates(passer).some((option) => option.agent === receiver),
        "the passer must consider another action when its only lane is blocked");
      cases++;

      Object.assign(defender, position(4, 2));
      assert.equal(engine._probeLaunchRouteClear(passer, target), true, "a two-metre lateral gap is a viable launch lane");
      const safety = engine._laneSafety(passer, receiver);
      Object.assign(passer, position(-0.6));
      assert.equal(engine._laneSafety(passer, receiver), safety,
        "carrier-body offset must not change the same ball-to-target line");
      cases++;

      Object.assign(defender, position(-0.8));
      assert.equal(engine._laneSafety(passer, receiver), 1, "a defender behind the ball cannot obstruct an escape pass");
      assert.equal(engine._probeLaunchRouteClear(passer, target), true);
      cases++;

      Object.assign(defender, position(6), { [other === "x" ? "vx" : "vy"]: 5 / otherScale });
      assert.equal(engine._probeLaunchRouteClear(passer, target), true,
        "a defender moving clear before ball arrival does not block the future lane");
      cases++;

      Object.assign(defender, position(1.5), { vx: 0, vy: 0, sentOff: true });
      assert.equal(engine._probeLaunchRouteClear(passer, target), true, "a sent-off player is not an obstacle");
      defender.sentOff = false;
      defender.injuredOff = true;
      assert.equal(engine._probeLaunchRouteClear(passer, target), true, "an injured-off player is not an obstacle");
      defender.injuredOff = false;
      cases += 2;

      const longSpot = position(31);
      const lofted = { ...target, tx: longSpot.x, ty: longSpot.y };
      assert.equal(engine._probeLaunchRouteClear(passer, lofted), false,
        "a lofted pass is still low beside a defender immediately after launch");
      Object.assign(defender, position(6));
      assert.equal(engine._probeLaunchRouteClear(passer, lofted), true,
        "the same lofted pass clears a more distant defender once it gains height");
      cases += 2;

      Object.assign(defender, position(1.5));
      const passEvents = engine.events.filter((event) => event.type === "pass").length;
      engine._pass(passer, target, true);
      assert.equal(engine.ball.owner, passer.id, "a newly blocked prepared pass is cancelled before kicking");
      assert.equal(engine.events.filter((event) => event.type === "pass").length, passEvents);
      cases++;
    }
  }
}
console.log(`Pass-route fixture passed: ${cases} mirrored geometry, trajectory, motion, dismissal and preparation cases`);
