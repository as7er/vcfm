import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

let cases = 0;
for (const state of ["pass", "shot", "loose"]) {
  for (const dt of [0.025, 0.05, 0.1, 0.2, 0.3]) {
    for (const airborne of [false, true]) {
      const ball = { owner: null, state, x: 50, y: 50, z: airborne ? 5 : 0,
        vx: 10, vy: -20, vz: airborne ? 3 : 0 };
      for (let step = 0; step < Math.round(0.6 / dt); step++) {
        SimEngine.prototype._stepBall.call({ ball }, dt);
      }
      const retention = (airborne ? 0.992 : SIM.BALL_FRICTION) ** 6;
      assert.ok(Math.abs(ball.vx - 10 * retention) < 1e-10,
        `${state}/${airborne ? "air" : "ground"}: drag must depend on elapsed time, dt=${dt}, vx=${ball.vx}`);
      assert.ok(Math.abs(ball.vy + 20 * retention) < 1e-10);
      assert.ok(Math.abs(ball.z - (airborne ? 3.56 : 0)) < 1e-10);
      cases++;
    }
  }
}
console.log(`Ball-drag audit passed: ${cases} ball-state, timestep and ground/air cases`);
