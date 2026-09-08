// Candidate-only coarse-flight equivalence; production still fails this fixture.
// Preload/reproduction commands: docs/match-ball-reach-2026-09-08.md.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

let cases = 0;
const fields = ["x", "y", "z", "vx", "vy", "vz"];
const run = (start, dt, duration) => {
  const ball = { owner: null, ...start };
  for (let step = 0; step < Math.round(duration / dt); step++) {
    SimEngine.prototype._stepBall.call({ ball }, dt);
  }
  return ball;
};
for (const state of ["pass", "shot", "loose"]) {
  for (const dt of [0.05, SIM.DT, 0.3]) {
    const ball = run({ state, x: 50, y: 50, z: 5, vx: 10, vy: -20, vz: 0 }, dt, 0.3);
    assert.ok(Math.abs(ball.vx - 10 * 0.992 ** 3) < 1e-10,
      `${state} air drag must depend on elapsed time, dt=${dt}, vx=${ball.vx}`);
    assert.ok(Math.abs(ball.vy + 20 * 0.992 ** 3) < 1e-10);
    assert.ok(Math.abs(ball.z - 4.19) < 1e-10);
    cases++;
  }
  for (const direction of [-1, 1]) {
    for (const vertical of [{ z: 5, vz: 2 }, { z: 0, vz: 0 }, { z: 0.3, vz: -7 }]) {
      const start = { state, x: 50, y: 50, vx: 12, vy: direction * 24, ...vertical };
      const standard = run(start, SIM.DT, 0.6);
      const coarse = run(start, 0.3, 0.6);
      for (const field of fields) {
        assert.ok(Math.abs(standard[field] - coarse[field]) < 1e-10,
          `${state} coarse/standard ${field} must agree through flight, roll and bounce`);
      }
      cases++;
    }
  }
}
console.log(`Free-flight step fixture passed: ${cases} air-drag, mirrored flight, roll and bounce cases`);
