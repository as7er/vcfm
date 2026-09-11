// Height and horizontal save geometry must describe the same physical instant.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((name) => [name, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const reports = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) for (const dt of [0.1, 0.3]) {
  for (const alpha of [0.25, 0.75]) for (const vz of [-6, 6]) for (const expectedZ of [2.42, 2.46]) {
    const e = new SimEngine(club("home"), club("away"), { random: () => 0.999 });
    const other = team === "home" ? "away" : "home", dir = e.attackDir(team);
    const keeper = e.agentById(`${other}-0`), shooter = e.agentById(`${team}-8`);
    for (const a of e.agents) a.sentOff = a !== keeper && a !== shooter;
    e.t = 100; e.deadBallUntil = 0;
    keeper.x = 50 + side; keeper.y = e.targetGoalY(team) - dir * 10;
    shooter.x = 50; shooter.y = keeper.y - dir * 20;
    const speed = 35 / (SIM.PITCH_H_METRES / SIM.FIELD_H);
    const contactDt = dt * alpha;
    const z0 = expectedZ - vz * contactDt + 9 * contactDt * contactDt;
    Object.assign(e.ball, { state: "shot", owner: null, x: 50,
      y: keeper.y - dir * speed * contactDt, z: z0, vz,
      vx: 0, vy: dir * speed, shotAt: e.t - 0.4, shotFlightTime: 0.8,
      shotDistance: 22, kickTeam: team, lastKicker: shooter.id,
      _saveChecked: false, _openGoalShot: false, settleUntil: 0 });
    e._stepBall(dt);
    const endpointZ = e.ball.z;
    e._resolvePossession(dt);
    const attempted = !!e.ball._saveChecked;
    const row = { team, side, dt, alpha, vz, expectedZ, endpointZ,
      expectedAttempt: expectedZ <= 2.44, attempted };
    reports.push(row);
    if (attempted !== row.expectedAttempt) failures.push(row);
  }
}
console.log(JSON.stringify({ cases: reports.length, failures, reports }, null, 2));
assert.deepEqual(failures, [], "keeper height gate must use the projected contact time");
