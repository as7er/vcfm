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
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.999 });
  const a = e.agentById(`${team}-8`), defending = team === "home" ? "away" : "home";
  const gk = e.agentById(`${defending}-0`), dir = e.attackDir(team);
  const fromGoal = (depth) => e.targetGoalY(team) - dir * depth;
  for (const p of e.agents) {
    p.x = 30 + (p.num % 5) * 8; p.y = fromGoal(80); p.isCore = false;
    p.vx = p.vy = 0;
  }
  Object.assign(a, { x: 50 + side * 16, y: fromGoal(5.4), roleId: "st_winger", dutyId: "support",
    heading: dir * Math.PI / 2, intent: null });
  Object.assign(gk, { x: 50, y: fromGoal(1) });
  e.t = 100; e.deadBallUntil = 0; e._teamAttackSince[team] = 50; e._teamShotUntil[team] = 1000;
  Object.assign(e.ball, { owner: a.id, state: "held", x: a.x, y: a.y, restartType: null,
    offsideExemptRestart: false, kickoffPassUntil: 0 });
  e._decideOnBall(a);
  const initial = { ...a.intent };
  assert.equal(initial.ty, fromGoal(14), "fixture must select the original shooting-zone retreat");
  for (const depth of [6.8, 8.4, 10]) {
    a.y = fromGoal(depth); e.ball.x = a.x; e.ball.y = a.y; e.t++;
    e._decideOnBall(a);
    const continuing = a.intent?.type === "dribble" && a.intent.tx === initial.tx && a.intent.ty === initial.ty;
    if (!continuing) failures.push(`${team}/${side}/${depth}: selected retreat reversed before completion`);
    rows.push({ team, side, depth, initial, after: { ...a.intent } });
  }
  Object.assign(a, { x: initial.tx, y: initial.ty });
  e.ball.x = a.x; e.ball.y = a.y; e.t++;
  e._decideOnBall(a);
  assert.ok(a.pendingBallAction || (a.intent.ty - a.y) * dir > 0,
    "a completed retreat must return control to normal decisions");
}
console.log(JSON.stringify({ cases: rows.length, failures, rows }, null, 2));
assert.deepEqual(failures, []);
