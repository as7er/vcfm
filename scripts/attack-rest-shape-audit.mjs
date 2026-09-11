import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";
const attrs = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
  "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning",
  "kicking", "decisions", "crossing"];
function club(id, line) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: line } };
}
let scenes = 0;
function target(team, depth, line = 3, fullback = false) {
  scenes++;
  const e = new SimEngine(club("home", line), club("away", line), { random: () => 0.5 });
  const dir = e.attackDir(team);
  const goalY = e.targetGoalY(team);
  const a = e.agents.find((p) => p.team === team && p.role === "DEF" && e._isFullback(p) === fullback);
  const owner = e.agents.find((p) => p.team === team && p.role === "ATT");
  e.t = 100;
  e.possession = team;
  e._phaseTeam = team;
  e._teamAttackSince[team] = 50;
  e._teamGainAt[team] = 50;
  e.deadBallUntil = 0;
  for (const p of e.agents) {
    Object.assign(p, { x: p.baseX, y: p.team === team ? p.baseY : goalY - dir * 4,
      vx: 0, vy: 0, isCore: false, habits: {}, offBallTarget: null });
  }
  Object.assign(owner, { x: team === "home" ? 10 : 90, y: goalY - dir * depth / 1.05 });
  if (fullback) Object.assign(a, { x: owner.x, y: owner.y - dir * 10 });
  Object.assign(e.ball, { x: owner.x, y: owner.y, z: 0, vx: 0, vy: 0, owner: owner.id,
    state: "held", restartType: null, lastPasserId: null, lastPassAt: 0 });
  const before = e.agents.map((p) => [p.x, p.y, p.vx, p.vy]);
  e._thinkAttackOffBall(a, owner);
  assert.deepEqual(e.agents.map((p) => [p.x, p.y, p.vx, p.vy]), before, "choosing an anchor must not place players");
  return { x: a.tx, y: a.ty, behind: (e.ball.y - a.ty) * dir * 1.05,
    depth: Math.abs(a.ty - goalY) * 1.05 };
}
const rows = [];
for (const team of ["home", "away"]) {
  for (const line of [1, 3, 5]) {
    for (const depth of [10, 20, 30, 37]) {
      const next = target(team, depth, line);
      assert.ok(next.behind >= 28 - 1e-7, "centre-backs must keep protection behind the attack");
      assert.ok(next.depth < 69, "centre-backs should connect rather than remain near their own box");
      rows.push({ team, line, ballDepth: depth, ...next });
    }
  }
  assert.ok(target(team, 30).depth > target(team, 20).depth + 4, "safety line must advance as play progresses");
  assert.ok(target(team, 10, 1).depth > target(team, 10, 5).depth + 12, "public line-height instruction must remain effective");
  for (const depth of [5, 10, 12]) {
    const fullback = target(team, depth, 3, true);
    assert.ok(fullback.depth >= 18 - 1e-7, "a full-back must offer a cutback when play reaches the byline");
    assert.ok(fullback.behind > 0);
  }
  assert.ok(target(team, 25, 3, true).behind < -4, "a normal same-side overlap must still advance beyond the carrier");
}
for (const h of rows.filter((r) => r.team === "home")) {
  const a = rows.find((r) => r.team === "away" && r.line === h.line && r.ballDepth === h.ballDepth);
  assert.ok(Math.hypot(h.x + a.x - 100, h.y + a.y - 100) < 1e-8, "safety line must rotate with the pitch");
}
console.log(JSON.stringify({ scenes, mirrorPairs: rows.length / 2, rows }, null, 2));
