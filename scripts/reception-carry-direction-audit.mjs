import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";
function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W, my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const rows = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  let draws = 0;
  const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
  const a = e.agentById(`${team}-6`), dir = e.attackDir(team);
  for (const p of e.agents) { p.sentOff = p !== a; p.x = 4; p.y = 4; }
  Object.assign(a, { x: 50 + side * 5, y: 50, vx: 0, vy: 0, heading: angle });
  e.t = 100;
  e.deadBallUntil = 0;
  Object.assign(e.ball, { x: a.x, y: a.y, z: 0, vx: -side * 15, vy: -dir * 5, state: "pass",
    owner: null, receiverId: a.id, kickTeam: team, lastPassAt: 99, isCrossPass: false, restartType: null });
  const expectedLength = Math.hypot((50 - a.x) * 0.15 * mx, 8 * my);
  const before = draws;
  const plan = e._beginBallControl(a);
  const dx = a.intent.tx - a.x, dy = a.intent.ty - a.y;
  const headingError = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - plan.desiredHeading),
    Math.cos(Math.atan2(dy, dx) - plan.desiredHeading)));
  const length = Math.hypot(dx * mx, dy * my);
  if (headingError > 1e-9) failures.push(`${team}/${side}/${angle}: first-touch direction immediately replaced (${headingError} rad)`);
  assert.ok(Math.abs(length - expectedLength) < 1e-9, "reception direction does not add carrying distance");
  assert.equal(draws - before, 1, "reception keeps the original decision-clock random draw");
  assert.ok(a.decisionUntil >= Math.max(a.controlUntil, e.ball.settleUntil), "do not bypass physical control or settling");
  rows.push({ team, side, angle, headingError, length, controlSeconds: a.controlUntil - e.t,
    decisionSeconds: a.decisionUntil - e.t });
}
console.log(JSON.stringify({ cases: rows.length, failures, rows }, null, 2));
assert.deepEqual(failures, []);
