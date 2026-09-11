import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";
const keys = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
  "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning", "kicking", "decisions"];
function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
function scene(team, side, gap = 2.85) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.99 });
  const a = e.agents.find((p) => p.team === team && p.role === "MID");
  const mate = e.agents.find((p) => p.team === team && p.role === "MID" && p !== a);
  const defender = e.agents.find((p) => p.team !== team && p.role === "DEF");
  const goalkeeper = e.agents.find((p) => p.team !== team && p.role === "GK");
  const dir = e.attackDir(team), goalY = e.targetGoalY(team);
  const fromGoal = (depth) => goalY - dir * depth;
  for (const p of e.agents) {
    Object.assign(p, { x: 50, y: fromGoal(70), vx: 0, vy: 0, isCore: false, habits: new Set() });
  }
  Object.assign(a, { x: 50 + side * 10, y: fromGoal(12), roleId: "cm_central", dutyId: "support",
    detailedPosition: "CM", heading: dir * Math.PI / 2, actionPreparationActive: false, shotCdUntil: 0 });
  Object.assign(mate, { x: 50 + side * 17, y: fromGoal(24) });
  Object.assign(defender, { x: a.x - side * gap * 4 / Math.sqrt(52), y: a.y + dir * gap * 6 / Math.sqrt(52) });
  Object.assign(goalkeeper, { x: 50, y: fromGoal(2) });
  e.t = 30;
  e.deadBallUntil = 0;
  e._teamAttackSince[team] = 10;
  e._teamShotUntil[team] = 1000;
  Object.assign(e.ball, { state: "held", owner: a.id, x: a.x, y: a.y,
    restartType: null, offsideExemptRestart: false, kickoffPassUntil: 0 });
  return { e, a, mate, defender, goalkeeper, dir, fromGoal };
}
let cases = 0;
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  const { e, a, mate, defender, fromGoal } = scene(team, side);
  e._decideOnBall(a);
  assert.equal(e.ball.state, "pass", "actual forward body contact must release through the open rear lane");
  assert.equal(e.ball.receiverId, mate.id);
  cases++;

  const distant = scene(team, side, 6);
  distant.e._decideOnBall(distant.a);
  assert.equal(distant.e.ball.state, "held", "a farther defender does not yet prevent advancing");
  assert.equal(distant.a.intent.type, "dribble");
  cases++;

  const intent = { type: "dribble", tx: 50 + side * 6, ty: fromGoal(6) };
  const option = { agent: mate, tx: mate.x, ty: mate.y, value: -0.02 };
  Object.assign(e.ball, { owner: a.id, state: "held", x: a.x, y: a.y });
  assert.equal(e._blockedCarryRelease(a, intent, [option]), option,
    "safe relief remains useful when its forward-progress score is negative");
  cases++;
  const originalX = defender.x, originalY = defender.y;
  defender.x = 2 * a.x - defender.x;
  defender.y = 2 * a.y - defender.y;
  assert.equal(e._blockedCarryRelease(a, intent, [option]), null,
    "contact behind a carrier must not stop a forward escape");
  cases++;
  defender.x = originalX;
  defender.y = originalY;
  mate.sentOff = true;
  assert.equal(e._blockedCarryRelease(a, intent, [option]), null, "the outlet must be active");
  mate.sentOff = false;
  cases++;
  const occupied = scene(team, side);
  Object.assign(occupied.goalkeeper, { role: "DEF", x: occupied.mate.x, y: occupied.mate.y });
  assert.equal(occupied.e._blockedCarryRelease(occupied.a, intent,
    [{ agent: occupied.mate, tx: occupied.mate.x, ty: occupied.mate.y }]), null,
    "an occupied receiving point is not an outlet");
  cases++;
  defender.sentOff = true;
  assert.equal(e._blockedCarryRelease(a, intent, [option]), null, "off-field players cannot obstruct");
  cases++;
}
console.log(JSON.stringify({ cases, mirrored: true, currentContactOnly: true }));
