// Use actual pressing targets and locomotion, with prescribed carrier motion.
// This isolates arrival tracking; match audits cover contact/separation effects.
import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";
function club(id) {
  const keys = ["pace", "acceleration", "agility", "passing", "vision", "shooting", "finishing",
    "dribbling", "tackling", "marking", "strength", "stamina", "positioning", "decisions"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", pressing: 3, lineup: players.map((p) => p.id) } };
}
const distance = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);
const rows = [], failures = [];
for (const team of ["home", "away"]) for (const axis of ["x", "y"]) for (const sign of [-1, 1]) {
  for (const dt of [0.1, 0.3]) for (const motion of [0, 1.5]) {
    const e = new SimEngine(club("home"), club("away"), { random: () => 0.5,
      timeStep: dt, simulationProfile: dt === 0.3 ? "background" : "standard" });
    const owner = e.agentById(`${team}-8`), defending = team === "home" ? "away" : "home";
    const presser = e.agentById(`${defending}-2`);
    e.agents = [owner, presser]; e.t = 100; e.deadBallUntil = 0;
    e._phaseTeam = team; e.possession = team; e._teamAttackSince[team] = 50;
    Object.assign(owner, { x: 50, y: 50, vx: axis === "x" ? sign * motion / 0.68 : 0,
      vy: axis === "y" ? sign * motion / 1.05 : 0 });
    Object.assign(e.ball, { owner: owner.id, x: owner.x, y: owner.y,
      state: "held", restartType: null, receiverId: null });
    e._stepPressing[defending] = 3;
    e._thinkDefend(presser, owner);
    // Hold the chosen pressing job/urgency fixed while testing locomotion.
    // Otherwise a plan refresh can change standoff even for a stationary ball.
    e._defPlans[defending].until = Infinity;
    Object.assign(presser, { x: presser.tx, y: presser.ty, vx: owner.vx, vy: owner.vy,
      heading: motion ? Math.atan2(owner.vy, owner.vx) : 0 });
    const gaps = [], speeds = [], accelerations = [];
    for (let step = 0; step < Math.round(6 / dt); step++) {
      e._stepDefContext = null;
      e._thinkDefend(presser, owner);
      const before = { vx: presser.vx, vy: presser.vy };
      const target = { x: presser.tx, y: presser.ty };
      e._integrateMotion(presser, dt);
      assert.equal(presser.tx, target.x, "tracking must keep the selected tactical target");
      assert.equal(presser.ty, target.y, "tracking must keep the selected tactical target");
      speeds.push(Math.hypot(presser.vx, presser.vy));
      accelerations.push(Math.hypot(presser.vx - before.vx, presser.vy - before.vy) / dt);
      owner.x += owner.vx * dt; owner.y += owner.vy * dt;
      e.ball.x = owner.x; e.ball.y = owner.y;
      e.t += dt;
      e._stepDefContext = null;
      e._thinkDefend(presser, owner);
      // Compare both bodies and the target at the same end-of-step time.
      if (step * dt >= 2) gaps.push(distance(presser, { x: presser.tx, y: presser.ty }));
    }
    const maxGap = Math.max(...gaps);
    if (maxGap > 0.5) failures.push({ team, axis, sign, dt, motion, maxGap });
    if (!motion) assert.ok(maxGap < 1e-8, "a stationary carrier's target remains stationary");
    if (process.argv.includes("--check-clock")) {
      const initial = structuredClone(presser);
      const velocity = { vx: owner.vx, vy: owner.vy };
      e._integrateMotion(presser, dt);
      const expectedMotion = structuredClone(presser);
      Object.assign(presser, structuredClone(initial));
      owner.vx += 1;
      owner.vy -= 1;
      e._integrateMotion(presser, dt);
      assert.deepEqual(presser, expectedMotion,
        "later opponent integration must not alter the velocity observed at the decision time");
      Object.assign(presser, initial);
      Object.assign(owner, velocity);
    }
    rows.push({ team, axis, sign, dt, motion, maxGap,
      maximumSpeedUnits: Math.max(...speeds), maximumAccelerationUnits: Math.max(...accelerations) });
  }
}
console.log(JSON.stringify({ cases: rows.length, failures, rows }));
assert.deepEqual(failures, [], "an already matched moving marker must not brake and fall behind the target");
