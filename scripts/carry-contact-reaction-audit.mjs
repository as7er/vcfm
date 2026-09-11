import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";
function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "passing", "vision", "dribbling", "tackling", "marking",
        "strength", "stamina", "positioning", "decisions"].map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const rows = [], failures = [];
for (const team of ["home", "away"]) for (const axis of ["x", "y"]) for (const sign of [-1, 1]) {
  for (const scenario of ["contact", "distant", "behind", "restart", "first-touch", "earlier-decision"]) {
    const e = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
    const a = e.agentById(`${team}-5`), other = team === "home" ? "away" : "home";
    const blocker = e.agentById(`${other}-2`);
    e.agents = [a, blocker]; e.t = 100; e.deadBallUntil = scenario === "restart" ? 101 : 0;
    Object.assign(a, { x: 50, y: 50, vx: 0, vy: 0, fsm: "carry", pendingBallAction: null,
      decisionUntil: scenario === "earlier-decision" ? 100.1 : 104,
      controlUntil: scenario === "first-touch" ? 101 : 0,
      intent: { type: "dribble", tx: axis === "x" ? 50 + sign * 8 : 50,
        ty: axis === "y" ? 50 + sign * 8 : 50 } });
    const gap = scenario === "distant" ? 4.1 : scenario === "behind" ? -2.8 : 2.8;
    Object.assign(blocker, { x: axis === "x" ? 50 + sign * gap : 50,
      y: axis === "y" ? 50 + sign * gap : 50, vx: 0, vy: 0 });
    Object.assign(e.ball, { owner: a.id, x: a.x, y: a.y,
      state: scenario === "first-touch" ? "control" : "held", restartType: null, controlStartAt: 99 });
    let decisions = 0;
    e._decideOnBall = () => { decisions++; };
    e._think(a, 0.1, a, team, a);
    const firstDeadline = a.decisionUntil;
    const shouldReact = scenario === "contact" || scenario === "earlier-decision";
    if (shouldReact ? firstDeadline > 100.4 : firstDeadline !== 104) {
      failures.push({ team, axis, sign, scenario, firstDeadline });
    }
    if (scenario === "earlier-decision") assert.equal(firstDeadline, 100.1, "a reaction never delays a scheduled decision");
    if (scenario === "contact" && firstDeadline <= 100.4) {
      for (const t of [100.2, 100.4, 100.6, 100.8]) {
        e.t = t;
        e._think(a, 0.1, a, team, a);
      }
      assert.equal(decisions, 1, "continuous contact must trigger only one early decision");
      e.t = 101; e.ball.controlStartAt = 101;
      e._think(a, 0.1, a, team, a);
      assert.ok(a.decisionUntil <= 101.4, "a new possession must not inherit the old contact latch");
    }
    rows.push({ team, axis, sign, scenario, firstDeadline, decisions });
  }
}
console.log(JSON.stringify({ cases: rows.length, failures, rows }));
assert.deepEqual(failures, []);
