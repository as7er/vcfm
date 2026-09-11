import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";
function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W, my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const distance = (a, p) => Math.hypot((a.x - p.tx) * mx, (a.y - p.ty) * my);
const reports = [], failures = [];
const mirrored = new Map();
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  for (const scenario of ["open", "ahead", "behind", "teammate", "injured", "depart-contact", "two-obstacles", "sideline", "surrounded", "cross", "through", "high", "restart"]) {
    let draws = 0;
    const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
    const a = e.agentById(`${team}-6`), dir = e.attackDir(team);
    for (const p of e.agents) { p.sentOff = p !== a; p.x = 4; p.y = 4; }
    Object.assign(a, { x: scenario === "sideline" ? 50 + side * 44 : 50 + side * 8,
      y: team === "home" ? 21 : 79, vx: 0, vy: 0, heading: Math.atan2(dir, -side * 0.4) });
    const baseline = e._forwardDribbleIntent(a);
    const dx = baseline.tx - a.x, dy = baseline.ty - a.y, length = Math.hypot(dx, dy);
    const ux = dx / length, uy = dy / length;
    const add = (index, along, across, friendly = false, injured = false) => {
      const t = friendly ? team : team === "home" ? "away" : "home";
      const o = e.agentById(`${t}-${index}`);
      Object.assign(o, { sentOff: false, injuredOff: injured,
        x: a.x + ux * along + dir * uy * across * side,
        y: a.y + uy * along - dir * ux * across * side, vx: 0, vy: 0 });
    };
    if (!["open", "surrounded"].includes(scenario)) {
      add(2, scenario === "behind" || scenario === "depart-contact" ? -2.5 : 4,
        scenario === "two-obstacles" ? 1 : 0.5, scenario === "teammate", scenario === "injured");
    }
    if (scenario === "two-obstacles") add(3, 6, -3);
    if (scenario === "surrounded") {
      for (let j = 0; j < 8; j++) {
        const angle = j * Math.PI / 4;
        const o = e.agentById(`${team === "home" ? "away" : "home"}-${j + 1}`);
        Object.assign(o, { sentOff: false, x: a.x + Math.cos(angle) * 3.1,
          y: a.y + Math.sin(angle) * 3.1, vx: 0, vy: 0 });
      }
    }
    e.t = 100;
    e.deadBallUntil = scenario === "restart" ? 101 : 0;
    Object.assign(e.ball, { x: a.x, y: a.y, z: scenario === "high" ? 1.5 : 0,
      vx: side * 10, vy: -dir * 4, state: "pass", owner: null, receiverId: a.id,
      kickTeam: team, lastPassAt: 99, isCrossPass: scenario === "cross", isThroughPass: scenario === "through", restartType: null });
    const before = draws;
    e._beginBallControl(a);
    const excluded = ["cross", "through", "high", "restart"].includes(scenario);
    const unchanged = ["open", "behind", "injured", "depart-contact"].includes(scenario) || excluded;
    if (unchanged) assert.deepEqual(a.intent, baseline, `${scenario}: do not replace an open or special receive`);
    else if (!e._supportRunClear(a, { x: a.intent.tx, y: a.intent.ty })) failures.push(`${team}/${side}/${scenario}: blocked continuation`);
    if (scenario === "surrounded" && a.intent.type !== "hold") failures.push(`${team}/${side}: carry into a closed ring`);
    assert.ok(distance(a, a.intent) <= distance(a, baseline) + 1e-8, "do not add carrying distance");
    assert.equal(draws - before, 1, "preserve decision-clock random draw");
    assert.ok(a.decisionUntil >= Math.max(a.controlUntil, e.ball.settleUntil), "do not bypass physical control");
    const normalized = { x: (a.intent.tx - 50) * side, y: (a.intent.ty - 50) * dir, type: a.intent.type };
    const reference = mirrored.get(scenario);
    if (reference && !excluded) {
      assert.equal(normalized.type, reference.type);
      assert.ok(Math.abs(normalized.x - reference.x) < 1e-6 && Math.abs(normalized.y - reference.y) < 1e-6,
        `${scenario}: asymmetric choice ${JSON.stringify({ reference, normalized })}`);
    } else mirrored.set(scenario, normalized);
    reports.push({ team, side, scenario, intent: a.intent, control: a.controlUntil - e.t, decision: a.decisionUntil - e.t });
  }
}
console.log(JSON.stringify({ cases: reports.length, failures, reports }, null, 2));
assert.deepEqual(failures, []);
