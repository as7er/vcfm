// A pass into an opponent's reachable route must be valued below the same
// route when that opponent cannot arrive. Compare against the real launch.
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
  const pair = {};
  for (const direction of [-1, 1]) {
    let draws = 0;
    const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
    const dir = e.attackDir(team), y = 50;
    const a = e.agentById(`${team}-6`), receiver = e.agentById(`${team}-8`),
      opponent = e.agentById(`${team === "home" ? "away" : "home"}-2`);
    for (const p of e.agents) p.sentOff = ![a, receiver, opponent].includes(p);
    Object.assign(a, { x: 50 - side * 20, y, vx: 0, vy: 0, heading: side > 0 ? 0 : Math.PI });
    Object.assign(receiver, { x: 50 + side * 16, y, vx: 0, vy: 0 });
    Object.assign(opponent, { x: 50, y: y + dir * 6.5, vx: 0, vy: dir * direction * 5,
      heading: Math.atan2(dir * direction, 0) });
    e.t = 100; e.deadBallUntil = 0; e._phaseTeam = team; e._teamAttackSince[team] = 50;
    Object.assign(e.ball, { owner: a.id, state: "held", x: a.x, y, vx: 0, vy: 0, z: 0, vz: 0,
      receiverId: null, restartType: null, offsideExemptRestart: false });
    const option = e._passCandidates(a).find((p) => p.agent.id === receiver.id);
    assert.ok(option, "a contested but legal option remains available");
    const before = structuredClone({ ball: e.ball, agents: e.agents, plans: e._defPlans, t: e.t, draws });
    const risk = e._passInterceptionRisk ? e._passInterceptionRisk(a, option) : null;
    assert.deepEqual({ ball: e.ball, agents: e.agents, plans: e._defPlans, t: e.t, draws }, before,
      "forecasting must not change the actual ball, players, jobs or random stream");
    let negativeValue = null;
    if (risk && e._unratedPassCandidates) {
      // Base territorial values can be negative for deep backward options.
      // Risk must not promote those options merely by moving them toward zero.
      const original = e._unratedPassCandidates;
      e._unratedPassCandidates = () => [{ ...option, value: -0.1 }];
      try { negativeValue = e._passCandidates(a)[0].value; }
      finally { e._unratedPassCandidates = original; }
    }
    e._pass(a, option, true);
    assert.equal(e.ball.state, "pass");
    const actualPoint = e._defensivePassArrival(opponent);
    if (risk) assert.deepEqual(risk.point, actualPoint, "selection and real launch must see the same zero-error flight");
    pair[direction < 0 ? "toward" : "away"] = { value: option.value, negativeValue, risk, actualPoint,
      launch: { vx: e.ball.vx, vy: e.ball.vy, z: e.ball.z, vz: e.ball.vz, expectedAt: e.ball.expectedAt } };
  }
  const row = { team, side, ...pair };
  reports.push(row);
  if (!pair.toward.actualPoint || pair.away.actualPoint) failures.push({ ...row, kind: "fixture-does-not-separate-reachability" });
  else if (!(pair.toward.value < pair.away.value)) failures.push({ ...row, kind: "motion-blind-pass-value" });
  if (pair.toward.negativeValue != null && pair.toward.negativeValue > -0.1) {
    failures.push({ ...row, kind: "risk-promoted-negative-option" });
  }
}
console.log(JSON.stringify({ cases: reports.length, failures, reports }, null, 2));
assert.deepEqual(failures, [], "pass assessment and actual defensive arrival must read the same moving route");
