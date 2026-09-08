import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

let cases = 0;
for (const dt of [0.1, 0.05, 0.025]) {
  for (const vz of [3, 6, 9]) {
    const ball = { x: 50, y: 50, z: 1, vx: 0, vy: -30, vz, owner: null, state: "shot" };
    for (let index = 0; index < Math.round(0.4 / dt); index++) {
      SimEngine.prototype._stepBall.call({ ball }, dt);
    }
    const expectedZ = 1 + vz * 0.4 - 9 * 0.4 ** 2;
    assert.ok(Math.abs(ball.z - expectedZ) < 1e-9,
      `shot height must follow z0 + vz*t - g*t*t/2: dt=${dt}, got=${ball.z}, expected=${expectedZ}`);
    assert.ok(Math.abs(ball.vz - (vz - 18 * 0.4)) < 1e-9);
    cases++;
  }
}

for (const direction of [-1, 1]) {
  for (const state of ["shot", "loose"]) {
    const ball = { x: 50, y: direction < 0 ? 20 : 80, z: 0.25, vx: 0, vy: direction * 50,
      vz: (2.2 - 0.25 + 9 * 0.4 ** 2) / 0.4, owner: null, state, kickTeam: direction < 0 ? "home" : "away",
      lastKicker: "shooter" };
    let crossing;
    const engine = Object.assign(Object.create(SimEngine.prototype), {
      ball,
      agentById: () => ({ team: ball.kickTeam }),
      _goal: (team, evidence) => { crossing = { team, ...evidence }; },
      _restart: (type) => { crossing = { type }; },
      _emitWoodwork: () => {},
    });
    // A shot aimed below the bar must not gain artificial altitude at each tick.
    for (let i = 0; i < 10 && !crossing; i++) {
      engine._stepBall(SIM.DT);
      if (state === "loose") engine.ball.state = "shot";
      engine._resolveBounds();
      engine.ball.state = state;
    }
    assert.equal(crossing?.team, ball.kickTeam, `mirrored ${state} trajectory stays below the bar`);
    assert.ok(crossing.crossZ < 2.44 && crossing.crossZ > 1.9);
    cases++;
  }
}

for (const dt of [0.1, 0.05]) {
  const start = { x: 50, y: 50, z: 0.3, vx: 15, vy: -30, vz: -7, owner: null };
  const shot = { ...start, state: "shot" };
  const loose = { ...start, state: "loose" };
  for (let i = 0; i < Math.round(0.5 / dt); i++) {
    SimEngine.prototype._stepBall.call({ ball: shot }, dt);
    SimEngine.prototype._stepBall.call({ ball: loose }, dt);
    for (const key of ["x", "y", "z", "vx", "vy", "vz"]) {
      assert.equal(shot[key], loose[key], `the same physical ball uses the same bounce: ${key}`);
    }
    assert.ok(shot.z >= 0);
    cases++;
  }
}
console.log(`shot-flight audit passed (${cases} ballistic, mirrored goal-line and bounce cases)`);
