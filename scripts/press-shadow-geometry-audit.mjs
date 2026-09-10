import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "passing", "vision", "shooting", "finishing", "dribbling",
        "tackling", "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"]
        .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const records = [];
for (const defending of ["home", "away"]) for (const side of [-1, 1]) for (const layout of [
  { name: "goalward", ballSide: 12, ballDepth: 18, receiverSide: 30, receiverDepth: 7, cover: true },
  { name: "backward", ballSide: 20, ballDepth: 12, receiverSide: 4, receiverDepth: 30, cover: false },
]) {
  let draws = 0;
  const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
  const attacking = defending === "home" ? "away" : "home";
  const ownGoalY = defending === "home" ? 100 : 0;
  const depthSign = defending === "home" ? -1 : 1;
  const owner = e.agentById(`${attacking}-8`);
  const defender = e.agentById(`${defending}-2`);
  const receiver = e.agentById(`${attacking}-9`);
  Object.assign(owner, { x: 50 + side * layout.ballSide, y: ownGoalY + depthSign * layout.ballDepth });
  Object.assign(receiver, { x: 50 + side * layout.receiverSide, y: ownGoalY + depthSign * layout.receiverDepth });
  Object.assign(e.ball, { x: owner.x, y: owner.y, owner: owner.id, state: "held" });
  const job = { type: "press", trigger: "deep-threat", urgency: 0.88, shadowId: null };
  e._stepDefContext = { team: defending, phaseTeam: attacking, ownerId: owner.id,
    phase: "out-of-possession", shapeProfile: e._shapeProfile(defending),
    plan: { jobs: new Map([[defender.id, job]]) }, coordination: e._collectiveDefenseProfile(defending) };
  const before = draws;
  e._thinkDefend(defender, owner);
  const goalOffset = { x: defender.tx - owner.x, y: defender.ty - owner.y };
  const standoff = Math.hypot(goalOffset.x * mx, goalOffset.y * my);
  const goal = { x: (50 - owner.x) * mx, y: (ownGoalY - owner.y) * my };
  const shadow = { x: (receiver.x - owner.x) * mx, y: (receiver.y - owner.y) * my };
  const physicalAlignment = (goal.x * shadow.x + goal.y * shadow.y) /
    (Math.hypot(goal.x, goal.y) * Math.hypot(shadow.x, shadow.y));
  assert.equal(physicalAlignment > 0.08, layout.cover, "the passing direction is classified in real pitch geometry");
  job.shadowId = receiver.id;
  e._thinkDefend(defender, owner);
  const expected = layout.cover ? {
    x: owner.x + goalOffset.x * 0.76 + shadow.x / Math.hypot(shadow.x, shadow.y) * standoff / mx * 0.24,
    y: owner.y + goalOffset.y * 0.76 + shadow.y / Math.hypot(shadow.x, shadow.y) * standoff / my * 0.24,
  } : { x: owner.x + goalOffset.x, y: owner.y + goalOffset.y };
  const error = Math.hypot((defender.tx - expected.x) * mx, (defender.ty - expected.y) * my);
  records.push({ defending, side, layout: layout.name, physicalAlignment, error });
  assert.ok(error < 1e-9,
    `cover-shadow alignment must use the same metre geometry as its target offsets (${error.toFixed(6)} m)`);
  assert.equal(draws, before, "reading a passing angle does not change outcome randomness");
}
for (const defending of ["home", "away"]) for (const side of [-1, 1]) for (const crosses of [true, false]) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
  const attacking = defending === "home" ? "away" : "home";
  const goalY = defending === "home" ? 100 : 0;
  const depthSign = defending === "home" ? -1 : 1;
  const owner = e.agentById(`${attacking}-8`);
  const defender = e.agentById(`${defending}-2`);
  const receiver = e.agentById(`${attacking}-9`);
  Object.assign(owner, { x: 50, y: goalY + depthSign * 20 });
  Object.assign(receiver, { x: 50 + side * 30, y: goalY + depthSign * 10 });
  Object.assign(defender, { x: 50 + side * (crosses ? 8 : -8),
    y: owner.y + depthSign * (crosses ? 10 : -10) });
  Object.assign(e.ball, { x: owner.x, y: owner.y, owner: owner.id, state: "held" });
  e._stepDefContext = { team: defending, phaseTeam: attacking, ownerId: owner.id,
    phase: "out-of-possession", shapeProfile: e._shapeProfile(defending),
    plan: { jobs: new Map([[defender.id, { type: "screen", markId: receiver.id }]]) },
    coordination: e._collectiveDefenseProfile(defending) };
  const markTarget = { x: receiver.x + (50 - receiver.x) * 0.15,
    y: receiver.y + (goalY - receiver.y) * 0.22 };
  const current = { x: (defender.x - owner.x) * mx, y: (defender.y - owner.y) * my };
  const intended = { x: (markTarget.x - owner.x) * mx, y: (markTarget.y - owner.y) * my };
  assert.equal(intended.x * current.x + intended.y * current.y < 0, crosses,
    "the receiver and defender occupy opposite physical half-planes only in the crossing fixture");
  e._thinkDefend(defender, owner);
  const chosen = { x: (defender.tx - owner.x) * mx, y: (defender.ty - owner.y) * my };
  if (crosses) {
    assert.ok(Math.abs(chosen.x * current.y - chosen.y * current.x) < 1e-9 &&
      chosen.x * current.x + chosen.y * current.y > 0,
    "the screening defender must stay on its physical side of the ball's pressure circle");
  } else {
    assert.ok(Math.hypot(chosen.x - intended.x, chosen.y - intended.y) < 1e-9,
      "a support point on the same physical side does not require an invented detour");
  }
  records.push({ defending, side, crosses, job: "screen" });
}
console.log(JSON.stringify({ cases: records.length, records }, null, 2));
console.log("Defensive angle geometry audit passed");
