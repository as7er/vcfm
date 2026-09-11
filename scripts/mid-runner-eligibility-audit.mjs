import assert from "node:assert/strict";
import { SimEngine } from "../js/sim/engine.js";
const keys = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
  "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning", "kicking"];
function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(keys.map((key) => [key, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
let cases = 0;
for (const team of ["home", "away"]) {
  for (const kind of ["normal", "habit", "role", "role-forward", "core", "sent-off", "injured", "all-deep", "all-off"]) {
    let draws = 0;
    const e = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
    const mids = e.agents.filter((p) => p.team === team && p.role === "MID");
    for (const a of mids) {
      Object.assign(a, { roleId: "cm_central", dutyId: "support", detailedPosition: "CM", habits: new Set(), isCore: false });
      for (const key of ["pace", "dribbling", "finishing", "vision"]) a.attr[key] = 0.5;
    }
    const best = mids[2];
    for (const key of ["pace", "dribbling", "finishing", "vision"]) best.attr[key] = 1;
    if (["habit", "core"].includes(kind)) best.habits.add("comes_deep");
    if (["role", "role-forward"].includes(kind)) best.roleId = "cm_playmaker";
    if (kind === "role-forward") best.habits.add("gets_forward");
    if (kind === "core") best.isCore = true;
    if (kind === "sent-off") best.sentOff = true;
    if (kind === "injured") best.injuredOff = true;
    if (kind === "all-deep") mids.forEach((a) => a.habits.add("comes_deep"));
    if (kind === "all-off") mids.forEach((a) => { a.sentOff = true; });
    const beforeDraws = draws;
    const selected = mids.filter((a) => e._isPrimaryMidRunner(a));
    const none = kind === "all-deep" || kind === "all-off";
    assert.equal(selected.length, none ? 0 : 1, `${team}/${kind}: at most one eligible midfielder`);
    if (!none) {
      assert.equal(selected[0].id, ["normal", "role-forward", "core"].includes(kind) ? best.id : mids[0].id,
        `${team}/${kind}: nomination must agree with the execution branch`);
    }
    assert.equal(draws, beforeDraws, "choosing eligibility must not roll extra random choices");
    cases++;
    // Verify the nomination through the actual target selector as well. A
    // nominal winner who takes a drop-deep branch would still consume the slot.
    const dir = e.attackDir(team);
    const goalY = e.targetGoalY(team);
    const carrier = e.agents.find((p) => p.team === team && p.role === "ATT");
    Object.assign(carrier, { x: 50, y: goalY - dir * 30 });
    for (const opponent of e.agents.filter((p) => p.team !== team)) {
      opponent.y = goalY - dir * (opponent.role === "GK" ? 2 : 15);
    }
    e.t = 30;
    e.deadBallUntil = 0;
    Object.assign(e.ball, { owner: carrier.id, state: "held", x: carrier.x, y: carrier.y, restartType: null });
    for (const midfielder of mids.filter((p) => !p.sentOff && !p.injuredOff)) {
      e._thinkAttackOffBall(midfielder, carrier);
      const ahead = (midfielder.ty - e.ball.y) * dir;
      assert.ok(e._isPrimaryMidRunner(midfielder) ? ahead > 0 : ahead < 0,
        `${team}/${kind}: the runner advances and supporting midfielders stay behind the ball`);
      cases++;
    }
  }
}
console.log(JSON.stringify({ cases, activeOnly: true, executionCompatible: true }));
