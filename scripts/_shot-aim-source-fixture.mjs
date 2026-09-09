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
const rows = [];
for (const team of ["home", "away"]) {
  for (const side of [-1, 1]) {
    const engine = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
    const a = engine.agents.find((p) => p.team === team && p.role === "ATT");
    const goalY = engine.targetGoalY(team);
    Object.assign(a, { x: 50 + side * 15, y: goalY - engine.attackDir(team) * 14,
      habits: [], actionPreparationActive: false });
    Object.assign(engine.ball, { x: a.x, y: a.y, z: 0, owner: a.id, state: "held", restartType: null });
    const perceived = engine._goalOpportunity(a).targetX;
    engine._shoot(a, null, true);
    const actual = engine.events.findLast((event) => event.type === "shot").targetX;
    rows.push({ team, side, perceived, actual });
    if (!process.argv.includes("--report")) assert.equal(actual, perceived,
      "a zero-error ordinary shot must aim along the lane whose keeper coverage was assessed");
  }
}
console.log(JSON.stringify({ shotAimSource: rows }, null, 2));
