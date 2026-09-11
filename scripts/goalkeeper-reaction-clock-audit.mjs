// The same approaching ball and elapsed flight cannot grant a goalkeeper more
// reaction time merely because an old forecast places the goal line farther away.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const key = Symbol.for("vcfm.goalkeeper-reaction-clock-audit");
let captured;
globalThis[key] = (row) => { captured = row; };
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const source = String(result.source);
  const marker = "        pSave = clamp(pSave, 0.04, 0.93);";
  assert.equal(source.split(marker).length, 2);
  return { ...result, source: source.replace(marker, marker +
    '\n        globalThis[Symbol.for("vcfm.goalkeeper-reaction-clock-audit")]({ reactionTime, tt, pSave });') };
} });
const { SimEngine } = await import("../js/sim/engine.js");
function club(id) {
  const keys = ["pace", "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
    "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((name) => [name, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
function attempt(team, side, dt, alpha, age, forecast) {
  const e = new SimEngine(club("home"), club("away"), { random: () => 0.999 });
  const other = team === "home" ? "away" : "home", dir = e.attackDir(team);
  const keeper = e.agentById(`${other}-0`), shooter = e.agentById(`${team}-8`);
  for (const a of e.agents) a.sentOff = a !== keeper && a !== shooter;
  e.t = 100 + age; e.deadBallUntil = 0;
  keeper.x = 50 + side; keeper.y = e.targetGoalY(team) - dir * 6;
  shooter.x = 50; shooter.y = keeper.y - dir * 20;
  const y0 = keeper.y - dir * 4 * alpha, y1 = y0 + dir * 4;
  Object.assign(e.ball, { state: "shot", owner: null, x: 50, y: y1, z: 1, vz: 0,
    vx: 0, vy: dir * 4 / dt, _prevX: 50, _prevY: y0, _prevZ: 1, _stepDt: dt,
    shotAt: 100, shotFlightTime: forecast, shotDistance: 22, kickTeam: team,
    lastKicker: shooter.id, _saveChecked: false, _openGoalShot: false });
  captured = null;
  e._resolvePossession(dt);
  assert.ok(captured, "fixture must exercise an actual save decision");
  return captured;
}
const reports = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) for (const dt of [0.1, 0.3]) {
  for (const alpha of [0.25, 0.75]) for (const age of [0.2, 0.6]) {
    const first = attempt(team, side, dt, alpha, age, 0.65);
    const alternate = attempt(team, side, dt, alpha, age, 1.4);
    const expected = age + alpha * dt;
    const row = { team, side, dt, alpha, age, expected, first, alternate };
    reports.push(row);
    if (Math.abs(first.reactionTime - expected) > 1e-8 ||
        Math.abs(alternate.reactionTime - expected) > 1e-8 ||
        Math.abs(first.pSave - alternate.pSave) > 1e-8) failures.push(row);
  }
}
console.log(JSON.stringify({ cases: reports.length, failures, reports }, null, 2));
delete globalThis[key];
assert.deepEqual(failures, [], "save reaction must use elapsed time to the actual contact segment");
