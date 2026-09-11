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
function scene(team, side) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.99 });
  const a = e.agents.find((p) => p.team === team && p.role === "MID");
  const mate = e.agents.find((p) => p.team === team && p.role === "MID" && p !== a);
  const defender = e.agents.find((p) => p.team !== team && p.role === "DEF");
  const goalkeeper = e.agents.find((p) => p.team !== team && p.role === "GK");
  const dir = e.attackDir(team), goalY = e.targetGoalY(team);
  const fromGoal = (depth) => goalY - dir * depth;
  for (const p of e.agents) {
    p.x = 50;
    p.y = fromGoal(70);
    p.vx = p.vy = 0;
    p.isCore = false;
    p.habits = new Set();
  }
  Object.assign(a, { x: 50 + side * 10, y: fromGoal(12), roleId: "cm_central", dutyId: "support",
    detailedPosition: "CM", heading: dir * Math.PI / 2, actionPreparationActive: false, shotCdUntil: 0 });
  Object.assign(mate, { x: 50 + side * 17, y: fromGoal(24) });
  Object.assign(defender, { x: 50 + side * 8, y: fromGoal(9) });
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
  const destinations = e._passCandidates(a);
  assert.ok(destinations.some((p) => p.agent.id === mate.id), "the visible rear outlet must already be a pass candidate");
  e._decideOnBall(a);
  assert.equal(e.ball.state, "pass", "a blocked carrier must use the open rear outlet");
  assert.equal(e.ball.receiverId, mate.id, "the release must reach the already evaluated supporting teammate");
  cases++;
  assert.equal(typeof e._blockedCarryRelease, "function");
  const intent = { type: "dribble", tx: 50 + side * 6, ty: fromGoal(6) };
  const option = { agent: mate, tx: mate.x, ty: mate.y, value: -0.02 };
  e.ball.owner = a.id;
  e.ball.x = a.x;
  e.ball.y = a.y;
  assert.equal(e._blockedCarryRelease(a, intent, [option]), option,
    "negative forward progress must not make a safe pressure release invalid");
  cases++;
  const x = defender.x;
  defender.x = 50 - side * 25;
  assert.equal(e._blockedCarryRelease(a, intent, [option]), null, "a clear carry remains available");
  defender.x = x;
  cases++;
  mate.x = a.x;
  mate.y = fromGoal(9);
  assert.equal(e._blockedCarryRelease(a, intent, [{ ...option, tx: mate.x, ty: mate.y }]), null,
    "a marked forward target cannot be relabelled as pressure relief");
  cases++;
  const blocked = scene(team, side);
  Object.assign(blocked.goalkeeper, { role: "DEF", x: blocked.mate.x, y: blocked.mate.y });
  assert.equal(blocked.e._blockedCarryRelease(blocked.a, intent,
    [{ agent: blocked.mate, tx: blocked.mate.x, ty: blocked.mate.y }]), null, "do not force a release into an occupied receiving point");
  cases++;
  defender.sentOff = true;
  assert.equal(e._blockedCarryRelease(a, intent, [option]), null, "an off-field player cannot obstruct a carry");
  cases++;
}
console.log(JSON.stringify({ cases, mirrored: true, realDecisionRelease: true }));
