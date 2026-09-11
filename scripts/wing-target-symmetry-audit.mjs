// Check actual tactical targets, not a copied version of the coordinate formula.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";
const attrs = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
  "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning",
  "kicking", "decisions", "crossing"];
function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3 } };
}
function target(team, baseX, ballX, depth, pipeline) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
  const dir = e.attackDir(team);
  const goalY = e.targetGoalY(team);
  const a = e.agents.find((p) => p.team === team && p.role === "ATT");
  const owner = e.agents.find((p) => p.team === team && p.role === "ATT" && p !== a);
  e.t = 100;
  e.possession = team;
  e._phaseTeam = team;
  e._teamAttackSince[team] = 50;
  e._teamGainAt[team] = 50;
  e.deadBallUntil = 0;
  for (const p of e.agents) {
    Object.assign(p, { x: p.baseX, y: p.team === team ? p.baseY : goalY - dir * 4,
      vx: 0, vy: 0, isCore: false, habits: [], attackThinkUntil: 0, offBallTarget: null });
  }
  Object.assign(a, { baseX, x: baseX, roleId: "st_winger", dutyId: "support" });
  Object.assign(owner, { x: ballX, y: goalY - dir * depth / 1.05 });
  Object.assign(e.ball, { x: owner.x, y: owner.y, z: 0, vx: 0, vy: 0, owner: owner.id,
    state: "held", restartType: null, lastPasserId: null, lastPassAt: 0 });
  if (pipeline) e._think(a, SIM.DT, owner, team, owner);
  else e._chooseAttackOffBallTarget(a, owner);
  assert.equal(a.fsm, "home", "scene must exercise the default winger target");
  return { x: a.tx, y: a.ty };
}
const rows = [];
for (const pipeline of [false, true]) {
  for (const baseX of [20, 28, 50, 72, 80]) {
    for (const ballX of [8, 28, 50, 72, 92]) {
      for (const depth of [12, 20]) {
        const home = target("home", baseX, ballX, depth, pipeline);
        const away = target("away", 100 - baseX, 100 - ballX, depth, pipeline);
        const reflected = target("home", 100 - baseX, 100 - ballX, depth, pipeline);
        rows.push({ pipeline, baseX, ballX, depth, home, away, reflected,
          halfTurnError: Math.hypot(home.x + away.x - 100, home.y + away.y - 100),
          lateralError: Math.hypot(home.x + reflected.x - 100, home.y - reflected.y) });
      }
    }
  }
}
const centered = target("home", 50, 50, 12, false);
const maximumHalfTurnError = Math.max(...rows.map((r) => r.halfTurnError));
const maximumLateralError = Math.max(...rows.map((r) => r.lateralError));
console.log(JSON.stringify({ scenes: rows.length * 3 + 1, centered, maximumHalfTurnError,
  maximumLateralError, examples: rows.slice(0, 2) }, null, 2));
assert.ok(Math.abs(centered.x - 50) < 1e-8, "a centered anchor and ball must stay centered");
assert.ok(maximumHalfTurnError < 1e-8, "home/away targets must rotate with the pitch");
assert.ok(maximumLateralError < 1e-8, "left/right targets must reflect with the pitch");
