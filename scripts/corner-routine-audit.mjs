import assert from "node:assert/strict";
import { buildCornerRoutine, cornerDelivery, cornerMovementTarget } from "../js/corner-routines.js";

function players(team) {
  return ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"].map((role, i) => ({
    id: `${team}-${i}`, team, role, x: 50, y: 50,
    attr: { crossing: 0.7, vision: 0.7, pace: 0.7, heading: 0.7, strength: 0.7, physical: 0.7 },
  }));
}
const metres = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);
let cases = 0;
for (const team of ["home", "away"]) {
  for (const left of [true, false]) {
    for (const missing of [0, 1, 3]) {
      const agents = [...players("home"), ...players("away")];
      const defending = team === "home" ? "away" : "home";
      if (missing) {
        for (const a of agents.filter((a) => a.team === defending && a.role !== "GK").slice(-missing)) a.sentOff = true;
      }
      const takerId = `${team}-5`;
      const goalY = team === "home" ? 0 : 100;
      const attackDirection = team === "home" ? -1 : 1;
      const ball = { x: left ? 0 : 100, y: goalY, owner: takerId, state: "corner" };
      const routine = buildCornerRoutine({ agents, team, takerId, ball, now: 100, attackDirection, goalY });
      assert.equal(routine.runs.size, 3);
      assert.equal(routine.positions.has(takerId), false, "the routine cannot move the corner taker off the arc");
      const outlet = [...routine.positions.values()].find((spot) => spot.kind === "outlet");
      assert.ok(Math.abs(outlet.y - goalY) * 1.05 > 52.5, "the counterattack outlet must be beyond halfway");
      for (const a of agents) {
        const spot = routine.positions.get(a.id);
        if (a.sentOff) assert.equal(spot, undefined, "dismissed players cannot occupy a set-piece slot");
        if (spot) Object.assign(a, { x: spot.x, y: spot.y });
      }
      const placed = agents.filter((a) => routine.positions.has(a.id));
      for (let i = 0; i < placed.length; i++) {
        const a = placed[i];
        if (a.team === defending) assert.ok(metres(a, ball) >= 9.15, "Law 17 distance");
        for (const b of placed.slice(i + 1)) assert.ok(metres(a, b) >= 1.6, "staged bodies must not overlap");
      }
      const [runnerId, arrival] = routine.runs.entries().next().value;
      const runner = agents.find((a) => a.id === runnerId);
      const staged = cornerMovementTarget(routine, runner, ball, agents, 100.7);
      assert.ok(metres(staged, arrival) >= 3.5, "the runner must still have a run to make at release");
      assert.deepEqual({ x: staged.x, y: staged.y }, { x: runner.x, y: runner.y });
      const approach = cornerMovementTarget(routine, runner, ball, agents, 101);
      assert.ok(metres(approach, staged) > 1, "the shared pre-kick signal must start an approach run");
      assert.ok(metres(approach, arrival) < metres(staged, arrival), "the approach must progress toward the arrival zone");
      const markerId = [...routine.marks].find(([, id]) => id === runnerId)?.[0];
      if (markerId) {
        const marker = agents.find((a) => a.id === markerId);
        Object.assign(runner, approach);
        const following = cornerMovementTarget(routine, marker, ball, agents, 101.2);
        assert.ok((following.y - runner.y) * attackDirection > 0,
          "the marker reacts to the same approach signal from the goal side");
        Object.assign(runner, { x: staged.x, y: staged.y });
      }
      const taker = agents.find((a) => a.id === takerId);
      Object.assign(taker, { x: ball.x, y: ball.y });
      const delivery = cornerDelivery(routine, agents, taker);
      assert.ok([...routine.runs.values()].some((target) => target.x === delivery.tx && target.y === delivery.ty),
        "the delivery must target an assigned arrival zone");
      const chosenZones = new Map();
      for (let i = 0; i < 256; i++) {
        const choice = cornerDelivery(routine, agents, taker, (i + 0.5) / 256);
        const key = `${choice.tx},${choice.ty}`;
        chosenZones.set(key, (chosenZones.get(key) || 0) + 1);
        assert.ok([...routine.runs.values()].some((target) => target.x === choice.tx && target.y === choice.ty));
      }
      assert.equal(chosenZones.size, routine.runs.size, "delivery selection must use more than one goalmouth zone");
      assert.equal(chosenZones.get(`${delivery.tx},${delivery.ty}`), Math.max(...chosenZones.values()),
        "the best observed delivery keeps the greatest selection weight");
      const flight = { ...ball, state: "pass", owner: null, lastKicker: takerId, lastPassAt: 102, expectedAt: 104 };
      assert.equal(cornerMovementTarget(routine, runner, flight, agents, 102), null,
        "a routine requires its own actual release marker");
      routine.releasedAt = 102;
      assert.deepEqual(cornerMovementTarget(routine, runner, flight, agents, 102.1), arrival);
      assert.equal(cornerMovementTarget(routine, runner, { ...flight, state: "held", owner: runnerId }, agents, 103), null);
      assert.equal(cornerMovementTarget(routine, runner, { ...flight, lastPassAt: 110, expectedAt: 112 }, agents, 110), null,
        "a later pass by the same player must not restart an old corner run");
      assert.equal(cornerMovementTarget(routine, runner, flight, agents, 105), null);
      cases++;
    }
  }
}
console.log(`Corner routine audit passed: ${cases} mirrored and reduced-team cases, staging, release and expiry`);
