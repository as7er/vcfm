// Full-back support must connect distant players without sending both flanks
// forward or relying on a discontinuous distance gate.
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
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const gap = (p, q) => Math.hypot((p.x - q.x) * mx, (p.y - q.y) * my);
function scene(team, distance, { weak = false, duty = "support", noCover = false, ballX = 12, depth = 10 } = {}) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
  const dir = e.attackDir(team);
  const goalY = e.targetGoalY(team);
  const y = (metres) => goalY - dir * metres / my;
  const a = e.agents.find((p) => p.team === team && e._isFullback(p));
  const owner = e.agents.find((p) => p.team === team && p.role === "ATT");
  e.t = 100;
  e.possession = team;
  e._phaseTeam = team;
  e._teamAttackSince[team] = 50;
  e._teamGainAt[team] = 50;
  e.deadBallUntil = 0;
  for (const p of e.agents) {
    Object.assign(p, { x: p.baseX, y: p.team === team ? p.baseY : y(4), vx: 0, vy: 0,
      isCore: false, habits: {}, attackThinkUntil: 0, offBallTarget: null });
    if (noCover && p.team === team && p.role === "DEF" && !e._isFullback(p)) p.sentOff = true;
  }
  owner.x = team === "home" ? ballX : 100 - ballX;
  if (weak) owner.x = 100 - owner.x;
  owner.y = y(depth);
  Object.assign(a, { x: owner.x, y: owner.y - dir * distance, dutyId: duty });
  Object.assign(e.ball, { x: owner.x, y: owner.y, z: 0, vx: 0, vy: 0, owner: owner.id,
    state: "held", restartType: null, lastPasserId: null, lastPassAt: 0 });
  e._think(a, SIM.DT, owner, team, owner);
  return { x: a.tx, y: a.ty, behind: (e.ball.y - a.ty) * dir * my,
    advance: (a.ty - a.y) * dir * my, baseDepth: Math.abs(a.baseY - goalY) * my,
    depth: Math.abs(a.ty - goalY) * my, kind: a.offBallTarget?.kind };
}
let cases = 0;
let maximumMirrorError = 0;
let maximumDistanceStep = 0;
const boundaries = [];
for (const team of ["home", "away"]) {
  const near = scene(team, 54.9);
  const far = scene(team, 55.1);
  boundaries.push({ team, near, far, jumpMetres: gap(near, far) });
  assert.ok(gap(near, far) < 1, "crossing the former 55-unit gate must not abandon support");
  assert.ok(far.advance > 15 && far.behind > 0 && far.behind <= 25,
    "a distant same-side full-back should move into a safe connection behind the ball");
  const weak = scene(team, 55.1, { weak: true });
  assert.ok(weak.behind >= 24 && weak.depth < weak.baseDepth, "weak side must advance while retaining cover");
  for (const options of [{ duty: "defend" }, { noCover: true }, { ballX: 50 }]) {
    assert.ok(scene(team, 15, options).behind >= 10, "overlap needs a flank, duty and cover");
    cases++;
  }
  let previous = null;
  for (let distance = 20; distance <= 65; distance += 0.25) {
    const next = scene(team, distance);
    if (previous) maximumDistanceStep = Math.max(maximumDistanceStep, gap(previous, next));
    previous = next;
    cases++;
  }
  cases += 3;
}
for (const depth of [10, 25, 45]) {
  for (const ballX of [8, 25, 50, 75, 92]) {
    for (const distance of [25, 45, 54.9, 55.1, 65]) {
      const h = scene("home", distance, { ballX, depth });
      const a = scene("away", distance, { ballX, depth });
      maximumMirrorError = Math.max(maximumMirrorError, gap(h, { x: 100 - a.x, y: 100 - a.y }));
      cases++;
    }
  }
}
assert.ok(maximumDistanceStep < 1, "distance must change the target continuously");
assert.ok(maximumMirrorError < 1e-8, "full-back decisions must rotate with the field");
console.log(JSON.stringify({ cases, maximumMirrorError, maximumDistanceStep, boundaries }, null, 2));
