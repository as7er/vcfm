import { SimEngine, SIM } from "../js/sim/engine.js";

const count = Number(process.argv[2]) || 24;
const simulationProfile = process.argv[3] === "background" ? "background" : "standard";
const timeStep = simulationProfile === "background" ? 0.3 : SIM.DT;
const samples = [];
function random(seed) {
  return () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
}
function club(id, rating) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "acceleration", "agility", "heading", "strength", "physical",
        "passing", "vision", "shooting", "finishing", "dribbling", "tackling", "marking", "stamina",
        "positioning", "reflexes", "handling", "kicking", "crossing", "decisions"].map((key) => [key, rating])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const metres = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);
for (let index = 0; index < count; index++) {
  const engine = new SimEngine(club("home", 15), club("away", 15), {
    random: random(412000 + index), simulationProfile, timeStep,
    separationPasses: simulationProfile === "background" ? 4 : 8,
  });
  engine.t = 100;
  const team = index % 2 ? "away" : "home";
  engine._restart("corner", team, index % 4 < 2 ? 0 : 100, engine.targetGoalY(team));
  let flight = null;
  for (let step = 0; step < 100; step++) {
    engine.step(timeStep);
    if (!flight && engine.ball.state === "pass") {
      flight = { at: engine.ball.lastPassAt, expectedAt: engine.ball.expectedAt,
        start: new Map([...engine._cornerRoutine.runs].map(([id, target]) => [id, {
          x: engine.agentById(id).x, y: engine.agentById(id).y, target,
        }])) };
    }
    if (!flight) continue;
    if (engine.ball.state !== "pass" || engine.ball.lastPassAt !== flight.at || engine.t > flight.expectedAt + 0.3) {
      const runners = [...flight.start].map(([id, start]) => ({ id,
        moved: metres(start, engine.agentById(id)), gap: metres(engine.agentById(id), start.target) }));
      const owner = engine.agentById(engine.ball.owner);
      samples.push({ team, duration: engine.t - flight.at, expected: flight.expectedAt - flight.at,
        ownerTeam: owner?.team ?? null, ownerRole: owner?.role ?? null,
        state: engine.ball.state, runners });
      break;
    }
  }
}
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({ simulationProfile, corners: samples.length,
  flightSeconds: median(samples.map((sample) => sample.duration)),
  movedM: median(samples.flatMap((sample) => sample.runners.map((runner) => runner.moved))),
  remainingM: median(samples.flatMap((sample) => sample.runners.map((runner) => runner.gap))),
  attackingControls: samples.filter((sample) => sample.ownerTeam === sample.team).length,
  keeperControls: samples.filter((sample) => sample.ownerRole === "GK").length,
  samples: samples.slice(0, 4),
}, null, 2));
