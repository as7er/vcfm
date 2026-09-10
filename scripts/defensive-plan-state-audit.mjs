// A pass and its first touch can have the same phase actor. Reproduce the
// handoff through the actual defensive planner, without replacing its jobs.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "passing", "vision", "shooting", "finishing", "dribbling",
        "tackling", "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"]
        .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id), pressing: 3 } };
}
const records = [];
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const presser = (plan) => [...plan.jobs].find(([, job]) => job.type === "press" || job.type === "contain")?.[0];
const readPlan = (plan) => ({ until: plan.until, ownerId: plan.ownerId, phase: plan.phase,
  presser: presser(plan), jobs: [...plan.jobs], trigger: plan.trigger.kind });
for (const defending of ["home", "away"]) for (const side of [-1, 1]) for (const receivedState of ["control", "held"]) {
  let draws = 0;
  const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
  const attacking = defending === "home" ? "away" : "home";
  const ownGoalY = defending === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
  const depthSign = defending === "home" ? -1 : 1;
  const receiver = e.agentById(`${attacking}-8`);
  const nearReceiver = e.agentById(`${defending}-1`);
  const nearFlight = e.agentById(`${defending}-2`);
  for (const a of e.agents) a.sentOff = ![receiver, nearReceiver, nearFlight].includes(a);
  const place = (a, depth) => Object.assign(a, { x: 50 + side * 4, y: ownGoalY + depthSign * depth, vx: 0, vy: 0 });
  place(receiver, 10);
  place(nearReceiver, 13);
  place(nearFlight, 18);
  receiver.heading = -depthSign * Math.PI / 2;
  receiver.controlPhase = "settled";
  e.t = 100;
  Object.assign(e.ball, { x: receiver.x, y: ownGoalY + depthSign * 20,
    owner: null, receiverId: receiver.id, state: "pass", restartType: null });
  const phase = "out-of-possession";
  const before = readPlan(e._refreshDefPlan(defending, receiver, phase));
  assert.equal(before.presser, nearFlight.id, "the flight fixture starts with the defender nearest the moving ball");
  assert.equal(before.trigger, "deep-threat");
  assert.equal(before.jobs.find(([id]) => id === nearFlight.id)[1].shadowId, receiver.id);
  const flightDraws = draws;
  e.t += 0.1;
  e.ball.y -= depthSign;
  assert.deepEqual(readPlan(e._refreshDefPlan(defending, receiver, phase)), before,
    "ordinary movement within one ball state retains the existing plan lease");
  assert.equal(draws, flightDraws, "reading a still-valid plan consumes no new randomness");

  // A 10.5 m pass reaches the same phase actor after 0.5 s, before lease expiry.
  e.t = 100.5;
  assert.ok(e.t < before.until);
  Object.assign(e.ball, { x: receiver.x, y: receiver.y, owner: receiver.id,
    receiverId: null, state: receivedState });
  receiver.controlPhase = receivedState === "control" ? "first-touch" : "settled";
  const after = readPlan(e._refreshDefPlan(defending, receiver, phase));
  assert.equal(after.ownerId, before.ownerId, "the receiving player's ID did not change");
  assert.equal(after.phase, before.phase, "the team remains out of possession");
  const prefix = `${defending}/${side}/${receivedState}`;
  check(after.presser === nearReceiver.id, `${prefix}: the defender 3.15 m from the receiver must take over from the one 8.4 m away`);
  check(after.until > before.until, `${prefix}: reception must invalidate the flight plan before its timer expires`);
  check(after.jobs.every(([, job]) => job.shadowId !== receiver.id && job.markId !== receiver.id),
    `${prefix}: a controlled ball cannot also be the off-ball cover-shadow assignment`);
  check(after.trigger === (receivedState === "control" ? "poor-touch" : "deep-threat"),
    `${prefix}: the trigger must read the current reception state`);

  const receptionDraws = draws;
  e.t += 0.05;
  assert.deepEqual(readPlan(e._refreshDefPlan(defending, receiver, phase)), after);
  assert.equal(draws, receptionDraws, "the new plan is cached for subsequent readers too");
  let settled = after;
  if (receivedState === "control") {
    e.t = 100.8;
    e.ball.state = "held";
    receiver.controlPhase = "settled";
    settled = readPlan(e._refreshDefPlan(defending, receiver, phase));
    check(settled.trigger === "deep-threat", `${prefix}: the first-touch trigger ends once the ball is settled`);
    check(settled.until > after.until, `${prefix}: settling starts a plan for the new ball state`);
  }
  e.t = settled.until + 0.01;
  const expired = readPlan(e._refreshDefPlan(defending, receiver, phase));
  assert.ok(expired.until > settled.until, "unchanged-state plans still refresh at their normal expiry");
  records.push({ defending, side, receivedState, before, after, settled });
}
console.log(JSON.stringify({ cases: records.length, failures, records }, null, 2));
assert.deepEqual(failures, [], "defensive plans must follow reception and settling boundaries");
console.log("Defensive plan state audit passed");
