// Read-only comparison of receiver lead against the actual ball flight.
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

const rows = [];
for (const axis of ["x", "y"]) {
  for (const distance of [8, 12, 18]) {
    for (const runnerSpeed of [0, 4]) {
      const engine = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
      const passer = engine.agents.find((a) => a.team === "home" && a.role === "MID");
      const receiver = engine.agents.find((a) => a.team === "home" && a.role === "ATT");
      for (const a of engine.agents) Object.assign(a, { x: 5, y: a.team === "home" ? 90 : 5, vx: 0, vy: 0 });
      Object.assign(passer, { x: 35, y: 60, actionPreparationActive: false });
      Object.assign(receiver, {
        x: passer.x + (axis === "x" ? distance / 0.68 : 0),
        y: passer.y - (axis === "y" ? distance / 1.05 : 0),
        vx: axis === "y" ? runnerSpeed / 0.68 : 0,
        vy: axis === "x" ? -runnerSpeed / 1.05 : 0,
      });
      Object.assign(engine.ball, { x: passer.x, y: passer.y, owner: passer.id, state: "held", z: 0,
        vx: 0, vy: 0, vz: 0, restartType: null, offsideExemptRestart: false });
      engine._teamThroughUntil.home = Infinity;
      const target = engine._passCandidates(passer).find((option) => option.agent === receiver);
      assert.ok(target && !target.through);
      const leadMetres = Math.hypot((target.tx - receiver.x) * 0.68, (target.ty - receiver.y) * 1.05);
      const leadSeconds = runnerSpeed ? leadMetres / runnerSpeed : 0;
      const origin = { x: engine.ball.x, y: engine.ball.y };
      engine._pass(passer, target);
      const expectedSeconds = engine.ball.expectedAt - engine.t;
      const dx = (target.tx - origin.x) * 0.68;
      const dy = (target.ty - origin.y) * 1.05;
      const length2 = dx * dx + dy * dy;
      let previousProgress = 0;
      let flightSeconds = null;
      for (let i = 1; i <= 100; i++) {
        engine._stepBall(0.1);
        const progress = ((engine.ball.x - origin.x) * 0.68 * dx +
          (engine.ball.y - origin.y) * 1.05 * dy) / length2;
        if (progress >= 1) {
          flightSeconds = (i - 1 + (1 - previousProgress) / (progress - previousProgress)) * 0.1;
          break;
        }
        previousProgress = progress;
      }
      assert.ok(flightSeconds > 0, "the uncontested pass must reach its target");
      rows.push({ axis, distance, runnerSpeed, leadSeconds, expectedSeconds, flightSeconds,
        runShortfallMetres: runnerSpeed * flightSeconds - leadMetres });
    }
  }
}
console.log(JSON.stringify(rows.map((row) => Object.fromEntries(Object.entries(row)
  .map(([key, value]) => [key, typeof value === "number" ? Number(value.toFixed(3)) : value]))), null, 2));
