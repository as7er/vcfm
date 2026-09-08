// Known-defect fixture until the isolated phase-boundary candidate is accepted.
import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";

function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "passing", "vision", "shooting", "finishing", "dribbling",
        "tackling", "marking", "strength", "stamina", "positioning", "reflexes", "handling", "kicking"]
        .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

function scenario(team, profile) {
  const engine = new SimEngine(club("home"), club("away"), {
    random: () => 0.3, simulationProfile: profile,
  });
  engine.t = 100;
  engine.deadBallUntil = 0;
  engine._cornerAttackUntil[team] = 114;
  for (const a of engine.agents) a.decisionUntil = 200;
  Object.assign(engine.ball, { x: 50, y: 50, owner: null, state: "loose", settleUntil: 200,
    vx: 0, vy: 0, vz: 0, z: 0, restartType: null, kickoffPassUntil: 0 });
  return engine;
}

let cases = 0;
for (const profile of ["standard", "background"]) {
  const dt = profile === "background" ? 0.3 : 0.1;
  for (const team of ["home", "away"]) {
    const other = team === "home" ? "away" : "home";
    for (const role of ["DEF", "GK"]) {
      const engine = scenario(team, profile);
      const opponent = engine.agents.find((a) => a.team === other && a.role === role);
      engine.ball.owner = opponent.id;
      engine.ball.state = "held";
      engine.step(dt);
      assert.equal(engine._cornerAttackUntil[team], 0, `${role} control ends the opponent's set piece`);
      engine.ball.owner = engine.agents.find((a) => a.team === team && a.role === "MID").id;
      engine.step(dt);
      assert.equal(engine._cornerAttackUntil[team], 0, "winning it back cannot revive a set piece");
      cases++;
    }
    for (const state of ["pass", "shot", "loose", "held"]) {
      const engine = scenario(team, profile);
      engine.ball.state = state;
      engine.ball.kickTeam = state === "loose" ? other : team;
      if (state === "held") engine.ball.owner = engine.agents.find((a) => a.team === team && a.role === "MID").id;
      engine.step(dt);
      assert.equal(engine._cornerAttackUntil[team], 114,
        `${state}: flight, deflection and attacking second balls preserve the phase`);
      cases++;
    }
    for (const type of ["corner", "goalkick", "throwin", "offside", "freekick", "indirect"]) {
      const engine = scenario(team, profile);
      engine._restart(type, team, type === "corner" ? 1 : 50, team === "home" ? 1 : 99);
      assert.deepEqual(engine._cornerAttackUntil, { home: 0, away: 0 }, `${type} ends the old phase`);
      if (type === "corner") {
        const taker = engine.agentById(engine.ball.owner);
        engine._decideOnBall(taker);
        assert.equal(engine._cornerAttackUntil[team], engine.t + 14, "a new delivery starts its own phase");
      }
      cases++;
    }
    for (const method of ["_kickoff", "_penaltyKick"]) {
      const engine = scenario(team, profile);
      engine[method](team);
      assert.deepEqual(engine._cornerAttackUntil, { home: 0, away: 0 }, `${method} ends the old phase`);
      cases++;
    }
  }
}
console.log(`Set-piece phase fixture passed: ${cases} mirrored control, second-ball and restart cases`);
