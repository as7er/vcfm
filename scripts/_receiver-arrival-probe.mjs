import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "accel", "agility", "passing", "vision", "shooting", "finishing", "dribbling",
        "tackling", "marking", "strength", "stamina", "positioning", "reflexes", "handling", "kicking"]
        .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const rows = [];
for (const axis of ["x", "y"]) {
  for (const sign of [-1, 1]) {
    for (const dt of [0.05, 0.1, 0.3]) {
      const engine = new SimEngine(club("h"), club("a"), { random: () => 0.5 });
      engine.t = 100;
      const passer = engine.agents.find((a) => a.team === "home" && a.role === "MID");
      const receiver = engine.agents.find((a) => a.team === "home" && a.role === "ATT");
      const start = { x: 50, y: 50 };
      const target = { x: 50, y: 50, [axis]: 50 + sign * 18 / (axis === "x" ? mx : my) };
      const runAxis = axis === "x" ? "y" : "x";
      const offset = 4 / (runAxis === "x" ? mx : my);
      Object.assign(passer, start, { actionPreparationActive: false });
      Object.assign(receiver, target, { [runAxis]: target[runAxis] - offset, vx: 0, vy: 0,
        heading: runAxis === "x" ? 0 : Math.PI / 2, fsm: "receive" });
      Object.assign(engine.ball, start, { owner: passer.id, state: "held", restartType: null, offsideExemptRestart: true });
      engine._pass(passer, { agent: receiver, tx: target.x, ty: target.y }, true);
      const flight = engine.ball.expectedAt - engine.t;
      let elapsed = 0;
      let maxSpeedRatio = 0;
      while (elapsed < flight - 1e-9) {
        const step = Math.min(dt, flight - elapsed);
        receiver.tx = target.x;
        receiver.ty = target.y;
        const speed = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * receiver.attr.pace) *
          (0.76 + Math.max(0.3, receiver.fitness / 100) * 0.24);
        engine._integrate(receiver, step);
        maxSpeedRatio = Math.max(maxSpeedRatio, Math.hypot(receiver.vx, receiver.vy) / speed);
        elapsed += step;
        engine.t += step;
      }
      const gap = Math.hypot((receiver.x - target.x) * mx, (receiver.y - target.y) * my);
      assert.ok(maxSpeedRatio <= 1.001, "arrival never increases running ability");
      if (!process.argv.includes("--report")) assert.ok(gap < 0.2, `late ${axis}/${sign}/${dt}: ${gap.toFixed(3)}m`);
      rows.push({ axis, sign, dt, flight, gap, maxSpeedRatio });
    }
  }
}
if (process.argv.includes("--report")) console.log(JSON.stringify({ receiverArrival: rows }, null, 2));
else console.log(`Receiver arrival audit passed: ${rows.length} directions and time steps; maximum miss ${Math.max(...rows.map((row) => row.gap)).toFixed(3)}m`);
