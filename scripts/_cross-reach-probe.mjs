// Measure whether a selected cross destination can actually be reached at the
// arrival time, using the normal player integrator and its unchanged limits.
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
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const rows = [];
for (const team of ["home", "away"]) {
  for (const side of [-1, 1]) {
    for (const depth of [16, 22, 28]) {
      const e = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
      e.t = 100;
      const goalY = e.targetGoalY(team);
      const dir = e.attackDir(team);
      const passer = e.agents.find((a) => a.team === team && a.role === "MID");
      const receiver = e.agents.find((a) => a.team === team && a.role === "ATT");
      for (const a of e.agents) Object.assign(a, { sentOff: true, vx: 0, vy: 0 });
      Object.assign(passer, { x: 50 + side * 35, y: goalY - dir * 36 / my,
        sentOff: false, actionPreparationActive: false });
      Object.assign(receiver, { x: 50 - side * 3, y: goalY - dir * depth / my,
        sentOff: false, heading: dir * Math.PI / 2, fsm: "receive" });
      Object.assign(e.ball, { x: passer.x, y: passer.y, owner: passer.id, state: "held",
        z: 0, restartType: null, offsideExemptRestart: true });
      const target = e._bestCross(passer);
      if (!target) {
        if (!process.argv.includes("--report")) assert.equal(depth, 28, "only the distant receiver should be outside the physical crossing range");
        rows.push({ team, side, depth, rejected: true });
        continue;
      }
      assert.ok(target && target.agent === receiver);
      const initialGap = Math.hypot((receiver.x - target.tx) * mx, (receiver.y - target.ty) * my);
      e._pass(passer, target, true);
      const flightSeconds = e.ball.expectedAt - e.t;
      let remaining = flightSeconds;
      while (remaining > 1e-9) {
        const dt = Math.min(0.1, remaining);
        receiver.tx = target.tx;
        receiver.ty = target.ty;
        e._integrate(receiver, dt);
        e.t += dt;
        remaining -= dt;
      }
      const arrivalGap = Math.hypot((receiver.x - target.tx) * mx, (receiver.y - target.ty) * my);
      rows.push({ team, side, depth, initialGap, flightSeconds, arrivalGap });
      if (!process.argv.includes("--report")) assert.ok(arrivalGap < SIM.CONTROL_RADIUS_METRES,
        `selected cross cannot meet its receiver: ${depth}m, remaining ${arrivalGap.toFixed(2)}m`);
    }
  }
}
if (process.argv.includes("--report")) console.log(JSON.stringify({ crossReach: rows }, null, 2));
else console.log(`Cross reach audit passed: ${rows.length} mirrored reachable and unreachable deliveries`);
