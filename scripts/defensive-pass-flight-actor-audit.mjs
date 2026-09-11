// A kick and the following readers observe the same flight. The enclosing
// think loop's pre-kick owner must not make that plan alternate identities.
import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";
function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", pressing: 3, lineup: players.map((p) => p.id) } };
}
const reports = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  for (const through of [false, true]) for (const reversed of [false, true]) {
    let draws = 0;
    const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
    const other = team === "home" ? "away" : "home";
    const passer = e.agentById(`${team}-6`), receiver = e.agentById(`${team}-8`), defender = e.agentById(`${other}-2`);
    for (const a of e.agents) a.sentOff = ![passer, receiver, defender].includes(a);
    if (reversed) e.agents.reverse();
    Object.assign(passer, { x: 50 - side * 20, y: 50, vx: 0, vy: 0, heading: side > 0 ? 0 : Math.PI });
    Object.assign(receiver, { x: 50 + side * 16, y: 50, vx: 0, vy: 0 });
    Object.assign(defender, { x: 50, y: 55, vx: 0, vy: 0 });
    e.t = 100; e.deadBallUntil = 0; e._phaseTeam = team; e._teamAttackSince[team] = 50;
    Object.assign(e.ball, { owner: passer.id, state: "held", x: passer.x, y: 50,
      vx: 0, vy: 0, z: 0, vz: 0, restartType: null, receiverId: null });
    e._pass(passer, { agent: receiver, tx: receiver.x, ty: receiver.y, through }, true);
    assert.equal(e.ball.state, "pass", "fixture must complete the actual kick");
    const plan = e._defPlans[other], jobs = plan.jobs;
    const kickActor = plan.ownerId, before = draws;
    // These are the two actual argument forms: remaining slots in the kick
    // step still hold the passer; the next step uses the planned receiver.
    for (const actor of [receiver, passer, receiver]) {
      e._stepDefContext = null;
      e._thinkDefend(defender, actor);
    }
    const row = { team, side, through, reversed, kickActor, receiverId: receiver.id,
      finalActor: plan.ownerId, reusedJobs: plan.jobs === jobs, extraDraws: draws - before };
    reports.push(row);
    if (kickActor !== receiver.id || plan.ownerId !== receiver.id || plan.jobs !== jobs || draws !== before) failures.push(row);
  }
}
console.log(JSON.stringify({ cases: reports.length, reports, failures }, null, 2));
assert.deepEqual(failures, [], "one unchanged flight must use one actor and preserve its still-valid plan");
