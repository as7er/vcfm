// Replay the exact arrival claimed by the defender's planner through the
// actual motor and ball integrators. Opposing/lateral momentum cannot be
// discarded when deciding whether a defender can reach a moving pass.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";
function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", pressing: 3, lineup: players.map((p) => p.id) } };
}
const metres = (a, b) => Math.hypot((a.x - b.x) * SIM.PITCH_W_METRES / SIM.FIELD_W,
  (a.y - b.y) * SIM.PITCH_H_METRES / SIM.FIELD_H);
const reports = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  for (const velocity of [[0, 0], [0, -5], [0, 5], [-5, 0], [5, 0], [3, 4], [-3, -4]]) {
    for (const offset of [3, 5, 8]) {
      let draws = 0;
      const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
      const receiver = e.agentById(`${team}-8`), a = e.agentById(`${team === "home" ? "away" : "home"}-2`);
      const dir = e.attackDir(team), y = team === "home" ? 30 : 70;
      for (const p of e.agents) p.sentOff = p !== receiver && p !== a;
      Object.assign(receiver, { x: 50 + side * 16, y, vx: 0, vy: 0 });
      Object.assign(a, { x: 50, y: y + dir * offset, vx: side * velocity[0], vy: dir * velocity[1],
        heading: velocity[0] || velocity[1] ? Math.atan2(dir * velocity[1], side * velocity[0]) : Math.atan2(-dir, side) });
      e.t = 100; e.deadBallUntil = 0; e._phaseTeam = team; e._teamAttackSince[team] = 50;
      e._stepPressing[a.team] = 3;
      Object.assign(e.ball, { owner: null, state: "pass", x: 50 - side * 18, y, vx: side * 20,
        vy: 0, z: 0, vz: 0, kickTeam: team, kickX: 50 - side * 20, kickY: y,
        receiverId: receiver.id, targetX: receiver.x, targetY: y, lastPassAt: 99.9, expectedAt: 103.4,
        restartType: null, isCrossPass: false, settleUntil: 0 });
      assert.equal(typeof e._defensivePassArrival, "function");
      const before = structuredClone({ a, ball: e.ball, t: e.t, draws });
      const point = e._defensivePassArrival(a);
      assert.deepEqual({ a, ball: e.ball, t: e.t, draws }, before, "reach prediction must not change the live scene or RNG");
      const row = { team, side, velocity, offset, point };
      if (point) {
        Object.assign(a, { tx: point.x, ty: point.y, fsm: "press", _passIntercept: point });
        const duration = point.at - e.t;
        e._integrate(a, duration);
        e._stepBall(duration);
        const flown = metres(e.ball, { x: e.ball.kickX, y: e.ball.kickY });
        const radius = flown < 8 ? 1.1 : SIM.CONTROL_RADIUS_METRES +
          Math.hypot(e.ball.vx * 0.68, e.ball.vy * 1.05) * 0.04;
        row.actualGap = metres(a, e.ball);
        row.radius = radius;
        row.flightError = metres(point, e.ball);
        assert.ok(row.flightError < 1e-8, "prediction and real ball flight use the same clock and drag");
        if (row.actualGap > radius + 1e-6) failures.push(row);
      }
      reports.push(row);
    }
  }
}
console.log(JSON.stringify({ cases: reports.length, failures, reports }, null, 2));
assert.deepEqual(failures, [], "a claimed intercept must be reachable with the real current momentum and motor limits");
