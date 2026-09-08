// Candidate-only reach assertions; --report observes the unresolved production defect.
// Preload/reproduction commands: docs/match-ball-reach-2026-09-08.md.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

function club(id) {
  const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = positions.map((pos, index) => ({ id: `${id}-${index}`, pos, name: `${id}-${index}`,
    fitness: 100, attrs: Object.fromEntries(["pace", "passing", "dribbling", "shooting", "finishing",
      "tackling", "marking", "positioning", "strength", "stamina", "vision", "decisions", "reflexes",
      "handling", "kicking"].map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

const results = [];
const scheduling = [];
if (process.argv.includes("--height-aware-substeps")) {
  for (const role of ["ATT", "GK"]) {
    for (const scenario of ["above", "falling", "below", "boundary"]) {
      const engine = new SimEngine(club("home"), club("away"));
      for (const a of engine.agents) a.sentOff = true;
      const collector = engine.agents.find((a) => a.role === role);
      Object.assign(collector, { x: 50, y: 50, sentOff: false });
      const reach = role === "GK" ? 3 : 2.2;
      Object.assign(engine.ball, { owner: null, state: "pass", x: 50, y: 50, vx: 8, vy: 0,
        z: scenario === "below" ? reach - 0.1 : reach + 1, vz: scenario === "falling" ? -3 : 0 });
      if (scenario === "boundary") engine.ball.x = 99;
      const actual = engine._ballFlightNearInteraction(0.3);
      const expected = scenario !== "above";
      scheduling.push({ role, scenario, actual, expected });
      assert.equal(actual, expected, "fine scheduling must include descent and pitch boundaries");
    }
  }
}
const flights = [];
if (process.argv.includes("--free-flight-substeps")) {
  for (const state of ["pass", "shot", "loose"]) {
    for (const dt of [0.05, 0.1, 0.3]) {
      const engine = new SimEngine(club("home"), club("away"));
      Object.assign(engine.ball, { owner: null, state, x: 50, y: 50, z: 5, vx: 10, vy: 0, vz: 0 });
      for (let i = 0; i < Math.round(0.3 / dt); i++) engine._stepBall(dt);
      const expectedVx = 10 * 0.992 ** 3;
      flights.push({ state, dt, x: engine.ball.x, vx: engine.ball.vx });
      assert.ok(Math.abs(engine.ball.vx - expectedVx) < 1e-10, "air drag uses elapsed time");
      assert.ok(Math.abs(engine.ball.z - 4.19) < 1e-10, "free-flight height uses elapsed time");
    }
  }
  for (const state of ["pass", "shot", "loose"]) {
    const pair = flights.filter((row) => row.state === state && row.dt >= 0.1);
    assert.ok(Math.abs(pair[0].x - pair[1].x) < 1e-10, "coarse free-flight distance matches standard substeps");
  }
}
for (const profile of process.argv.includes("--flight-only") ? [] : ["standard", "background"]) {
  for (const team of ["home", "away"]) {
    for (const kind of ["ordinary", "through", "cross", "loose"]) {
      for (const contact of ["receiver", "intercept", "goalkeeper"]) {
        for (const reachOffset of [-0.1, 0, 0.1]) {
          const reachable = reachOffset <= 0;
          const dt = profile === "background" ? 0.3 : SIM.DT;
          const engine = new SimEngine(club("home"), club("away"), {
            simulationProfile: profile, timeStep: dt, random: () => 0.5,
          });
          engine.t = 100;
          engine.deadBallUntil = 0;
          engine.random = () => 0.99;
          for (const a of engine.agents) Object.assign(a, { x: 90, y: 50, sentOff: true });
          const other = team === "home" ? "away" : "home";
          const collector = engine.agents.find((a) => a.team === (contact === "intercept" ? other : team) &&
            (contact === "goalkeeper" ? a.role === "GK" : a.role !== "GK"));
          const y = contact === "goalkeeper" ? team === "home" ? 92 : 8 : 40;
          Object.assign(collector, { x: 50, y, sentOff: false, injuredOff: false, tackleCdUntil: 0 });
          const height = (contact === "goalkeeper" ? 3 : 2.2) + reachOffset;
          Object.assign(engine.ball, { owner: null, state: kind === "loose" ? "loose" : "pass", x: 50, y, z: height,
            vx: 0, vy: 8, vz: -2, kickX: 50, kickY: y - 12, kickTeam: team, lastKicker: null,
            receiverId: contact === "receiver" ? collector.id : null, settleUntil: 0,
            isCrossPass: kind === "cross", isThroughPass: kind === "through", offsideIds: new Set() });
          let draws = 0;
          let controlled = null;
          engine.random = () => { draws++; return 0; };
          engine._tryHandball = () => false;
          engine._beginBallControl = (a) => { controlled = a.id; };
          engine._resolvePossession(dt);
          results.push({ profile, team, kind, contact, height, reachable, draws, controlled });
          if (!process.argv.includes("--report")) {
            assert.equal(controlled, reachable ? collector.id : null,
              `${profile}/${team}/${kind}/${contact}: contact must respect physical height`);
            if (!reachable) assert.equal(draws, 0, "unreachable contact must consume no random draw");
          }
        }
      }
    }
  }
}
console.log(JSON.stringify({ passHeightFixture: { cases: results.length,
  scheduling, flights,
  unreachableContacts: results.filter((row) => !row.reachable && row.controlled).length,
  unreachableByKind: Object.fromEntries(["ordinary", "through", "cross", "loose"].map((kind) => [kind,
    results.filter((row) => row.kind === kind && !row.reachable && row.controlled).length])),
  results: process.argv.includes("--verbose") ? results : undefined } }, null, 2));
