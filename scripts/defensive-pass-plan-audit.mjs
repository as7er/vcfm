// Match-state boundaries around an assigned interception, through the real
// planner and motor. Cached jobs must follow a new pass or reception, while
// still-valid jobs must not be reselected on every reader.
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
function scene(team, side) {
  let draws = 0;
  const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
  const defending = team === "home" ? "away" : "home", dir = e.attackDir(team);
  const receiver = e.agentById(`${team}-8`), a = e.agentById(`${defending}-2`);
  const y = team === "home" ? 30 : 70;
  for (const p of e.agents) p.sentOff = p !== receiver && p !== a;
  Object.assign(receiver, { x: 50 + side * 16, y, vx: 0, vy: 0 });
  Object.assign(a, { x: 50, y: y + dir * 5, vx: 0, vy: 0, heading: Math.atan2(-dir, side) });
  e.t = 100; e.deadBallUntil = 0; e._phaseTeam = team; e._teamAttackSince[team] = 50;
  e._stepPressing[defending] = 3;
  Object.assign(e.ball, { owner: null, state: "pass", x: 50 - side * 18, y,
    vx: side * 20, vy: 0, z: 0, vz: 0, kickTeam: team, kickX: 50 - side * 20, kickY: y,
    receiverId: receiver.id, targetX: receiver.x, targetY: y, lastPassAt: 99.9, expectedAt: 103.4,
    restartType: null, isCrossPass: false, settleUntil: 0 });
  return { e, a, receiver, defending, draws: () => draws };
}
const records = [], failures = [];
const run = (name, team, side, test) => {
  try { test(scene(team, side)); records.push({ name, team, side, passed: true }); }
  catch (error) {
    const failure = { name, team, side, message: error.message };
    failures.push(failure); records.push({ ...failure, passed: false });
  }
};
const exclusions = {
  "controlled": ({ e, receiver }) => Object.assign(e.ball, { owner: receiver.id, state: "control" }),
  "held": ({ e, receiver }) => Object.assign(e.ball, { owner: receiver.id, state: "held" }),
  "loose": ({ e }) => { e.ball.state = "loose"; },
  "shot": ({ e }) => { e.ball.state = "shot"; },
  "corner": ({ e }) => { e.ball.state = "corner"; },
  "own-pass": ({ e, a }) => { e.ball.kickTeam = a.team; },
  "cross": ({ e }) => { e.ball.isCrossPass = true; },
  "dead-ball": ({ e }) => { e.deadBallUntil = e.t + 1; },
  "restart": ({ e }) => { e.ball.restartType = "freekick"; },
  "sent-off": ({ a }) => { a.sentOff = true; },
  "injured-off": ({ a }) => { a.injuredOff = true; },
  "goalkeeper": ({ a }) => { a.role = "GK"; },
  "arrival-expired": ({ e }) => { e.ball.expectedAt = e.t; },
  "ball-above-reach": ({ e }) => Object.assign(e.ball, { z: 8, vz: 0, expectedAt: e.t + 0.3 }),
};
const stale = {
  "owner-acquired": exclusions.controlled,
  "loose-ball": exclusions.loose,
  "own-pass": exclusions["own-pass"],
  "next-pass": ({ e }) => { e.ball.lastPassAt += 0.1; },
  "sent-off": exclusions["sent-off"],
  "injured-off": exclusions["injured-off"],
  "different-job": ({ a }) => { a.fsm = "cover"; },
  "restart": exclusions.restart,
};
const motion = (a) => ({ x: a.x, y: a.y, vx: a.vx, vy: a.vy, heading: a.heading, fitness: a.fitness, tx: a.tx, ty: a.ty });
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  for (const [name, mutate] of Object.entries(exclusions)) run(`excluded-${name}`, team, side, (s) => {
    assert.ok(s.e._defensivePassArrival(s.a), "fixture must start with a reachable pass");
    mutate(s);
    const state = structuredClone({ ball: s.e.ball, agent: s.a, draws: s.draws() });
    assert.equal(s.e._defensivePassArrival(s.a), null);
    assert.deepEqual({ ball: s.e.ball, agent: s.a, draws: s.draws() }, state);
  });
  for (const [name, mutate] of Object.entries(stale)) run(`stale-${name}`, team, side, (s) => {
    s.e._thinkDefend(s.a, s.receiver);
    assert.ok(s.a._passIntercept);
    // A nearby replacement target makes accidental use of the old arrival
    // controller observable as excess acceleration, rather than a data check.
    s.a.tx = s.a.x + side;
    s.a.ty = s.a.y;
    mutate(s);
    const expected = { ...s.a };
    s.e._integrateMotion(expected, 0.1);
    s.e._integrate(s.a, 0.1);
    assert.deepEqual(motion(s.a), motion(expected), "old interception must not accelerate a different task");
  });
  run("cache-valid", team, side, ({ e, a, receiver, draws }) => {
    e._thinkDefend(a, receiver);
    const plan = e._defPlans[a.team], jobs = plan.jobs, before = draws();
    e.t += 0.05;
    assert.equal(e._refreshDefPlan(a.team, receiver).jobs, jobs);
    assert.equal(draws(), before);
  });
  run("cache-new-pass-same-receiver", team, side, ({ e, a, receiver, draws }) => {
    e._thinkDefend(a, receiver);
    const jobs = e._defPlans[a.team].jobs, before = draws();
    e.t += 0.05;
    e.ball.lastPassAt = e.t;
    const plan = e._refreshDefPlan(a.team, receiver);
    assert.notEqual(plan.jobs, jobs, "same receiver ID cannot preserve the previous flight's plan");
    assert.equal(plan.passAt, e.ball.lastPassAt);
    assert.ok(draws() > before, "new plan must still use its ordinary expiry randomization");
  });
  run("cache-missed-arrival", team, side, ({ e, a, receiver }) => {
    e._thinkDefend(a, receiver);
    const plan = e._defPlans[a.team], jobs = plan.jobs;
    assert.ok(Number.isFinite(plan.interceptAt));
    e.t = plan.interceptAt + 0.01;
    plan.until = e.t + 1;
    assert.notEqual(e._refreshDefPlan(a.team, receiver).jobs, jobs,
      "an interception that has already passed expires before the ordinary lease");
  });
  run("handoff-to-cover", team, side, ({ e, a, receiver }) => {
    e._thinkDefend(a, receiver);
    const plan = e._defPlans[a.team];
    assert.ok(a._passIntercept);
    plan.jobs.set(a.id, { type: "contain" });
    e._thinkDefend(a, receiver);
    assert.equal(a._passIntercept, null);
    assert.equal(a.fsm, "cover");
  });
}
console.log(JSON.stringify({ cases: records.length, failures, records }, null, 2));
assert.deepEqual(failures, [], "interception plans and motion must respect lifecycle boundaries");
