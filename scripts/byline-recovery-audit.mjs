import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";

const keys = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
  "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning", "kicking"];
function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
function scene(team, side) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.99 });
  const a = e.agents.find((p) => p.team === team && p.role === "ATT");
  const dir = e.attackDir(team);
  const goalY = e.targetGoalY(team);
  const fromGoal = (depth) => goalY - dir * depth;
  for (const p of e.agents) {
    p.x = 30 + (p.num % 5) * 8;
    p.y = fromGoal(60 + p.num);
    p.isCore = false;
  }
  Object.assign(a, { x: side < 0 ? 8 : 92, y: fromGoal(6.4), vx: 0, vy: 0,
    roleId: "st_winger", dutyId: "support", habits: new Set(["hugs_line"]), intent: null });
  e.t = 30;
  e.deadBallUntil = 0;
  e._teamAttackSince[team] = 10;
  e.possession = team;
  Object.assign(e.ball, { owner: a.id, state: "held", x: a.x, y: a.y,
    restartType: null, offsideExemptRestart: false, kickoffPassUntil: 0 });
  return { e, a, dir, fromGoal };
}

let cases = 0;
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  const { e, a, dir, fromGoal } = scene(team, side);
  e._decideOnBall(a);
  const recovery = { ...a.intent };
  assert.equal(recovery.ty, fromGoal(13), "the existing byline action retreats to its original target");
  for (const depth of [7.1, 8.4, 10]) {
    Object.assign(a, { y: fromGoal(depth) });
    Object.assign(e.ball, { x: a.x, y: a.y });
    e.t += 1;
    e._decideOnBall(a);
    assert.ok((a.intent.ty - a.y) * dir < 0,
      `${team}/${side}/${depth}: a partial retreat must not immediately reverse toward the byline`);
    assert.equal(a.intent.ty, recovery.ty, "keep the selected destination while completing the retreat");
    cases++;
  }
  Object.assign(a, { x: recovery.tx, y: recovery.ty });
  Object.assign(e.ball, { x: a.x, y: a.y });
  e.t += 1;
  e._decideOnBall(a);
  assert.ok((a.intent.ty - a.y) * dir > 0, "a completed recovery must not permanently lock the carrier");
  cases++;

  const release = scene(team, side);
  release.e._decideOnBall(release.a);
  release.a.y = release.fromGoal(8.4);
  Object.assign(release.e.ball, { x: release.a.x, y: release.a.y });
  const outlet = release.e.agents.find((p) => p.team === team && p.role === "MID");
  Object.assign(outlet, { x: side < 0 ? 30 : 70, y: release.fromGoal(20), vx: 0, vy: 0 });
  release.e.t += 1;
  release.e._decideOnBall(release.a);
  assert.ok(release.e.ball.state === "pass" || release.a.pendingBallAction?.type === "pass",
    "a newly available cutback may interrupt recovery");
  cases++;

  const stale = scene(team, side);
  stale.e._decideOnBall(stale.a);
  stale.a.y = stale.fromGoal(8.4);
  Object.assign(stale.e.ball, { x: stale.a.x, y: stale.a.y });
  stale.e._teamAttackSince[team]++;
  stale.e._decideOnBall(stale.a);
  assert.ok((stale.a.intent.ty - stale.a.y) * dir > 0, "a previous possession cannot keep a recovery active");
  cases++;
}
console.log(JSON.stringify({ cases, mirrored: true, completionAndRelease: true }));
