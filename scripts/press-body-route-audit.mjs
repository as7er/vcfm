// Exercise the real planner, motion and separation around an obstructing carrier.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";
function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id), pressing: 3 } };
}
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W, my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const metres = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
const rows = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) for (const dt of [0.1, 0.3]) {
  let draws = 0;
  const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; },
    simulationProfile: dt === 0.3 ? "background" : "standard", timeStep: dt, separationPasses: 8 });
  const owner = e.agentById(`${team}-8`);
  const defending = team === "home" ? "away" : "home";
  const defender = e.agentById(`${defending}-2`), dir = e.attackDir(team);
  for (const a of e.agents) a.sentOff = a !== owner && a !== defender;
  const origin = { x: 50 + side * 6, y: e.targetGoalY(team) - dir * 12 };
  Object.assign(owner, { ...origin, tx: origin.x, ty: origin.y, vx: 0, vy: 0,
    heading: dir * Math.PI / 2, bodyTargetHeading: dir * Math.PI / 2, fsm: "carry" });
  Object.assign(defender, { x: origin.x + side * 0.3, y: origin.y - dir * 3,
    vx: 0, vy: 0, heading: dir * Math.PI / 2, fsm: "press" });
  Object.assign(e.ball, { owner: owner.id, x: owner.x, y: owner.y, state: "held", restartType: null });
  e.t = 100;
  e._teamAttackSince[team] = 90;
  e.deadBallUntil = 0;
  e._stepPressing.home = e._stepPressing.away = 3;
  e._stepBall(dt);
  const startGap = metres(defender, e.ball);
  let minBodyGap = Infinity, maxSpeed = 0, maxRouteShift = 0, routeFrames = 0;
  for (let i = 0; i < Math.round(6 / dt); i++) {
    e._stepDefContext = null;
    e._thinkDefend(defender, owner);
    owner.tx = origin.x; owner.ty = origin.y;
    const tactical = { tx: defender.tx, ty: defender.ty };
    if (e._pressBodyWaypoint) {
      const beforeDraws = draws;
      const point = e._pressBodyWaypoint(defender);
      assert.equal(draws, beforeDraws, "geometric routing must not consume randomness");
      if (point) { routeFrames++; maxRouteShift = Math.max(maxRouteShift, metres(point, { x: tactical.tx, y: tactical.ty })); }
    }
    e._integrate(owner, dt);
    e._integrate(defender, dt);
    assert.deepEqual({ tx: defender.tx, ty: defender.ty }, tactical, "routing must preserve the tactical destination");
    maxSpeed = Math.max(maxSpeed, Math.hypot(defender.vx * mx, defender.vy * my));
    e._separateAgents(8, dt);
    e._stepBall(dt);
    minBodyGap = Math.min(minBodyGap, Math.hypot(defender.x - owner.x, defender.y - owner.y));
    e.t += dt;
  }
  const endGap = metres(defender, e.ball), goalSide = (defender.y - owner.y) * dir;
  const row = { team, side, dt, startGap, endGap, goalSide, ownerDisplacement: metres(origin, owner),
    minBodyGap, maxSpeed, routeFrames, maxRouteShift };
  rows.push(row);
  if (!(goalSide > 0 && endGap < 2.5)) failures.push(`${team}/${side}/${dt}: a defender must be able to get around a stationary carrier to the goal side`);
  if (!(minBodyGap >= e.separationMinDistanceUnits - 1e-5)) failures.push(`${team}/${side}/${dt}: body envelope not preserved (${minBodyGap})`);
  assert.ok(maxSpeed < 8, "routing must stay within existing running capability");
}
console.log(JSON.stringify({ rows, failures }, null, 2));
if (!process.argv.includes("--report")) assert.deepEqual(failures, []);
