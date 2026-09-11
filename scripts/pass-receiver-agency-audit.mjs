import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";
function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const rows = [], failures = [];
for (const team of ["home", "away"]) for (const axis of ["x", "y"]) for (const sign of [-1, 1]) {
  for (const scenario of ["on-course", "near-foot", "cross", "loose", "opponent", "off-course",
    "past-target", "expired", "receiver-off", "receiver-injured", "receiver-unreachable", "target-area"]) {
    const e = new SimEngine(club("home"), club("away"), { random: () => 0 });
    const bystander = e.agentById(`${team}-5`), receiver = e.agentById(`${team}-8`);
    const opponents = team === "home" ? "away" : "home";
    e.agents = [bystander, receiver];
    e.t = 100; e.deadBallUntil = 0;
    const point = (forward, lateral = 0) => axis === "x"
      ? { x: 50 + sign * forward / 0.68, y: 50 + lateral / 1.05 }
      : { x: 50 + lateral / 0.68, y: 50 + sign * forward / 1.05 };
    const target = point(scenario === "past-target" ? -12 : 12);
    Object.assign(bystander, point(0, scenario === "near-foot" ? 0.8 : 2), {
      vx: 0, vy: 0, noReclaimUntil: 0, heading: 0 });
    Object.assign(receiver, target, { vx: 0, vy: 0, sentOff: scenario === "receiver-off",
      injuredOff: scenario === "receiver-injured", heading: 0 });
    if (scenario === "receiver-unreachable") Object.assign(receiver, point(32));
    if (scenario === "target-area") Object.assign(target, point(2));
    if (scenario === "opponent") bystander.team = opponents;
    Object.assign(e.ball, point(0), { owner: null, state: scenario === "loose" ? "loose" : "pass",
      z: 0, vz: 0, vx: axis === "x" ? sign * 10 / 0.68 : 0,
      vy: axis === "y" ? sign * 10 / 1.05 : 0,
      targetX: target.x, targetY: target.y, kickTeam: team, lastKicker: null,
      lastPasserId: null, receiverId: receiver.id, kickX: point(-10).x, kickY: point(-10).y,
      lastPassAt: 99, expectedAt: scenario === "expired" ? 99 : 101.2,
      settleUntil: 0, restartType: null, isCrossPass: scenario === "cross", offsideIds: new Set() });
    if (scenario === "off-course") {
      e.ball.vx = axis === "x" ? 0 : 10 / 0.68;
      e.ball.vy = axis === "y" ? 0 : 10 / 1.05;
    }
    // Prevent the distinct long-range defensive interception lottery in this fixture.
    e._teamInterceptUntil[opponents] = 1000;
    e._resolvePossession(0.1);
    const expected = scenario === "on-course" ? null : bystander.id;
    if (e.ball.owner !== expected) failures.push({ team, axis, sign, scenario, expected, actual: e.ball.owner });
    rows.push({ team, axis, sign, scenario, owner: e.ball.owner });
    if (scenario === "on-course" && !e.ball.owner) {
      Object.assign(e.ball, target);
      e.t = 101;
      e._resolvePossession(0.1);
      assert.equal(e.ball.owner, receiver.id, "the intended receiver still controls the arriving pass");
    }
  }
}
console.log(JSON.stringify({ cases: rows.length, failures, rows }));
assert.deepEqual(failures, []);
