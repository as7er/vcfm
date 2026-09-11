// Controlled mirror scenes expose discontinuities when support is far away.
import { SimEngine, SIM } from "../js/sim/engine.js";

const attrs = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
  "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning",
  "kicking", "decisions", "crossing"];
function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, 15 + ((i * 7 + 15) % 5) - 2])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3 } };
}
const rows = [];
for (const team of ["home", "away"]) {
  for (const task of ["fullback-near", "fullback-far", "mid-near", "mid-far", "centre-back", "weak-fullback", "weak-mid"]) {
    const e = new SimEngine(club("home"), club("away"), { random: () => 0.5 });
    const dir = e.attackDir(team);
    const goal = e.targetGoalY(team);
    const y = (metres) => goal - dir * metres / 1.05;
    e.t = 100;
    e.possession = team;
    e._phaseTeam = team;
    e._teamAttackSince[team] = 50;
    e._teamGainAt[team] = 50;
    e.deadBallUntil = 0;
    const a = e.agents.find((p) => p.team === team &&
      (task.includes("fullback") ? e._isFullback(p) : task.includes("mid") ? e._isPrimaryMidRunner(p) :
        p.role === "DEF" && !e._isFullback(p)));
    const owner = e.agents.find((p) => p.team === team && p.role === "ATT");
    for (const p of e.agents) {
      Object.assign(p, { x: p.baseX, y: p.team === team ? p.baseY : y(p.role === "ATT" ? 50 : 6),
        vx: 0, vy: 0, attackThinkUntil: 0, offBallTarget: null, sentOff: false, injuredOff: false });
    }
    owner.x = task.startsWith("weak") ? (a.baseX < 50 ? 92 : 8) : a.baseX;
    owner.y = y(10);
    if (task.endsWith("near") || task.endsWith("far")) {
      a.x = owner.x;
      a.y = owner.y - dir * ((task.includes("fullback") ? 55 : 28) + (task.endsWith("far") ? 0.1 : -0.1));
    }
    Object.assign(e.ball, { x: owner.x, y: owner.y, z: 0, vx: 0, vy: 0, owner: owner.id,
      state: "held", restartType: null, lastPasserId: null, lastPassAt: 0 });
    const start = { x: a.x, y: a.y };
    const fieldGap = Math.hypot(a.x - e.ball.x, a.y - e.ball.y);
    e._think(a, SIM.DT, owner, team, owner);
    rows.push({ team, task, id: a.id, roleId: a.roleId, duty: a.dutyId, core: a.isCore,
      habits: a.habits, roleSupport: e._roleBehavior(a, "support"), roleDepth: e._roleBehavior(a, "depth"),
      ball: { x: e.ball.x, y: e.ball.y }, start, fieldGap,
      target: { x: a.tx, y: a.ty }, fsm: a.fsm, kind: a.offBallTarget?.kind,
      targetBehindBallMetres: (e.ball.y - a.ty) * dir * 1.05,
      targetAdvanceMetres: (a.ty - a.y) * dir * 1.05 });
  }
}
console.log(JSON.stringify({ rows }, null, 2));
