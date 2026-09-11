// Controlled crossing pass with a defender able to reach the receiving lane.
// Disable possession lotteries only to compare actual closest approach under
// the same ball flight, tactical job and motor limits.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";
function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", pressing: 3, lineup: players.map((p) => p.id) } };
}
const reports = [], failures = [];
if (process.argv.includes("--check-assignment")) {
  for (const team of ["home", "away"]) for (const side of [-1, 1]) {
    const e = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
    const defending = team === "home" ? "away" : "home", dir = e.attackDir(team);
    const receiver = e.agentById(`${team}-8`), nearOldBall = e.agentById(`${defending}-2`),
      nearCrossing = e.agentById(`${defending}-3`);
    const y = team === "home" ? 30 : 70;
    for (const a of e.agents) a.sentOff = ![receiver, nearOldBall, nearCrossing].includes(a);
    Object.assign(receiver, { x: 50 + side * 16, y, vx: 0, vy: 0 });
    Object.assign(nearOldBall, { x: 50 - side * 17, y: y + dir * 5, vx: 0, vy: 0,
      heading: Math.atan2(-dir, side) });
    Object.assign(nearCrossing, { x: 50, y: y + dir * 5, vx: 0, vy: 0,
      heading: Math.atan2(-dir, side) });
    e.t = 100; e.deadBallUntil = 0; e._phaseTeam = team; e._teamAttackSince[team] = 50;
    Object.assign(e.ball, { owner: null, state: "pass", x: 50 - side * 18, y,
      vx: side * 20, vy: 0, z: 0, vz: 0, kickTeam: team, kickX: 50 - side * 20, kickY: y,
      receiverId: receiver.id, targetX: receiver.x, targetY: y, lastPassAt: 99.9, expectedAt: 103.4,
      restartType: null, isCrossPass: false, settleUntil: 0 });
    const plan = e._refreshDefPlan(defending, receiver);
    const assigned = [...plan.jobs].find(([, job]) => job.type === "press")?.[0];
    if (assigned !== nearCrossing.id) failures.push({ team, side, assigned, expected: nearCrossing.id });
    if (e._defensivePassArrival) {
      assert.equal(e._defensivePassArrival(nearOldBall), null, "old-ball proximity is not reachability");
      assert.ok(e._defensivePassArrival(nearCrossing), "the crossing defender must actually be able to arrive");
    }
  }
}
for (const team of ["home", "away"]) for (const side of [-1, 1]) for (const dt of [0.1, 0.3]) {
  let draws = 0;
  const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
  const receiver = e.agentById(`${team}-8`), defender = e.agentById(`${team === "home" ? "away" : "home"}-2`);
  const dir = e.attackDir(team), y = team === "home" ? 30 : 70;
  for (const a of e.agents) a.sentOff = a !== receiver && a !== defender;
  Object.assign(receiver, { x: 50 + side * 16, y, vx: 0, vy: 0 });
  Object.assign(defender, { x: 50, y: y + dir * 5, vx: 0, vy: 0, heading: Math.atan2(-dir, side) });
  e.t = 100;
  e.deadBallUntil = 0;
  e._phaseTeam = team;
  e._teamAttackSince[team] = 50;
  e._stepPressing[defender.team] = 3;
  Object.assign(e.ball, { owner: null, state: "pass", x: 50 - side * 18, y,
    vx: side * 20, vy: 0, z: 0, vz: 0, kickTeam: team, kickX: 50 - side * 20, kickY: y,
    receiverId: receiver.id, targetX: receiver.x, targetY: y, lastPassAt: 99.9, expectedAt: 103.4,
    restartType: null, isCrossPass: false, settleUntil: 0 });
  e._thinkDefend(defender, receiver);
  const fixedPlan = e._defPlans[defender.team];
  // Crossing the lateral zones normally refreshes a tactical plan and draws
  // its next expiry. Isolate the motion experiment from those valid refreshes.
  e._refreshDefPlan = () => fixedPlan;
  const samples = [];
  const before = draws;
  for (let step = 0; step < Math.round(2.4 / dt); step++) {
    e._stepDefContext = null;
    e._thinkDefend(defender, receiver);
    const target = { x: defender.tx, y: defender.ty };
    e._integrate(defender, dt);
    e._stepBall(dt);
    e.t += dt;
    const gap = Math.hypot((e.ball.x - defender.x) * 0.68, (e.ball.y - defender.y) * 1.05);
    samples.push({ t: e.t, target, player: { x: defender.x, y: defender.y, vx: defender.vx, vy: defender.vy },
      ball: { x: e.ball.x, y: e.ball.y }, gap, arrivalAt: defender._passIntercept?.at ?? null });
  }
  assert.equal(draws, before, "interception geometry must not consume random draws");
  const minGap = Math.min(...samples.map((s) => s.gap));
  if (minGap > SIM.CONTROL_RADIUS_METRES) failures.push({ team, side, dt, minGap });
  reports.push({ team, side, dt, minGap, samples });
}
console.log(JSON.stringify({ cases: reports.length, failures, reports }, null, 2));
assert.deepEqual(failures, [], "a reachable crossing pass must not be missed by chasing the old ball position");
