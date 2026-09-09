import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "passing", "vision", "shooting", "finishing", "dribbling", "crossing",
        "tackling", "marking", "strength", "stamina", "positioning", "reflexes", "handling", "kicking"]
        .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const rows = [];
for (const dt of [0.1, 0.3]) {
  for (const axis of ["x", "y"]) {
    for (const distance of [12, 18, 24, 30, 36]) {
      const engine = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
      const a = engine.agents.find((p) => p.team === "home" && p.role === "MID");
      const start = { x: 15, y: 30 };
      const scale = axis === "x" ? 0.68 : 1.05;
      const target = { ...start, [axis]: start[axis] + distance / scale };
      Object.assign(a, { ...start, actionPreparationActive: false });
      Object.assign(engine.ball, { ...start, owner: a.id, state: "held", restartType: null });
      engine._pass(a, { tx: target.x, ty: target.y, cross: true, through: true }, true);
      const expected = engine.ball.expectedAt - engine.t;
      let previousDistance = 0;
      let previousHeight = engine.ball.z;
      let arrival = null;
      for (let step = 1; step < 100; step++) {
        engine._stepBall(dt);
        const travelled = (engine.ball[axis] - start[axis]) * scale;
        if (travelled >= distance) {
          const alpha = (distance - previousDistance) / (travelled - previousDistance);
          arrival = { height: previousHeight + (engine.ball.z - previousHeight) * alpha,
            seconds: (step - 1 + alpha) * dt };
          break;
        }
        previousDistance = travelled;
        previousHeight = engine.ball.z;
      }
      assert.ok(arrival, "an unobstructed delivery must reach its assigned zone");
      if (!process.argv.includes("--report")) {
        assert.ok(arrival.height <= 2.2 && arrival.height >= 0.8,
          `${axis}/${distance}m: a cross passed its chosen zone at ${arrival.height.toFixed(2)}m, above playable reach`);
        assert.ok(Math.abs(arrival.seconds - expected) <= dt, "runner timing follows actual delivery flight");
      }
      rows.push({ dt, axis, distance, height: Number(arrival.height.toFixed(3)), seconds: Number(arrival.seconds.toFixed(3)) });
    }
  }
}
console.log(JSON.stringify({ crossArrival: rows }, null, 2));
if (!process.argv.includes("--report")) console.log(`Cross arrival audit passed: ${rows.length} metric directions, distances and time steps`);
