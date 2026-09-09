// Physical close contact must override the old eight-metre pass protection.
// Retained as a fixture for production verification and historical comparisons.
import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";

function club(id) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
    attrs: Object.fromEntries(["pace", "passing", "vision", "shooting", "finishing", "dribbling",
      "tackling", "marking", "strength", "stamina", "positioning", "reflexes", "handling", "kicking"]
      .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}

function scenario(team, side, gap, height = 0, dismissed = false) {
  const engine = new SimEngine(club("home"), club("away"), { random: () => 0.3 });
  engine.t = 100;
  const other = team === "home" ? "away" : "home";
  const passer = engine.agents.find((a) => a.team === team && a.role === "MID");
  const defender = engine.agents.find((a) => a.team === other && a.role === "DEF");
  for (const a of engine.agents) {
    a.x = a.tx = a.team === "home" ? 10 : 90;
    a.y = a.ty = a.role === "GK" ? a.baseY : 80;
    a.noReclaimUntil = engine.t + 5;
  }
  passer.x = 50 - side * 6;
  passer.y = 50;
  defender.x = 50;
  defender.y = 50 + gap / 1.05;
  defender.sentOff = dismissed;
  defender.noReclaimUntil = 0;
  engine._teamInterceptUntil[other] = engine.t + 20;
  Object.assign(engine.ball, {
    x: 50, y: 50, z: height, vx: side * 15 / 0.68, vy: 0, vz: 0,
    _prevX: 50 - side * 1.5 / 0.68, _prevY: 50, _prevZ: height,
    owner: null, state: "pass", settleUntil: 0, kickTeam: team,
    kickX: passer.x, kickY: passer.y, lastKicker: passer.id, lastPassAt: engine.t - 0.3,
    receiverId: null, offsideIds: new Set(), isCrossPass: false,
  });
  engine._resolvePossession(0.1);
  return { engine, passer, defender };
}

let cases = 0;
for (const team of ["home", "away"]) {
  for (const side of [-1, 1]) {
    const direct = scenario(team, side, 0.5);
    assert.equal(direct.engine.ball.owner, direct.defender.id,
      "a low short pass touching a defender cannot pass through them under an 8m protection rule");
    const distant = scenario(team, side, 2);
    assert.equal(distant.engine.ball.owner, null,
      "removing short-pass immunity must not allow an early remote interception");
    const high = scenario(team, side, 0.5, 3);
    assert.equal(high.engine.ball.owner, null, "a ball above the defender must continue its flight");
    const dismissed = scenario(team, side, 0.5, 0, true);
    assert.equal(dismissed.engine.ball.owner, null, "an off-field defender cannot block a pass");
    cases += 4;
  }
}
console.log(`Short-pass contact audit passed: ${cases} mirrored close-contact, reach, height and dismissal cases`);
