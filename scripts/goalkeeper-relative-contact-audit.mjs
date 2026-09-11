// A swept save compares the ball and moving goalkeeper at the same instant.
// Exercise the real step/motion/ball chain; only suppress tactical retargeting.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const key = Symbol.for("vcfm.goalkeeper-relative-contact-audit");
let observe;
globalThis[key] = (engine, row) => observe?.(engine, row);
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const source = String(result.source);
  const marker = "        if (dPath > reach) continue;";
  assert.equal(source.split(marker).length, 2);
  return { ...result, source: source.replace(marker,
    `        globalThis[Symbol.for("vcfm.goalkeeper-relative-contact-audit")](this, { gk, tt, cx, cy, dPath, lateral, dt });\n` + marker) };
} });
const { SimEngine, SIM } = await import("../js/sim/engine.js");
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W, my = SIM.PITCH_H_METRES / SIM.FIELD_H;
function club(id) {
  const keys = ["pace", "acceleration", "agility", "passing", "vision", "shooting", "finishing",
    "dribbling", "tackling", "marking", "strength", "stamina", "positioning", "decisions", "reflexes", "handling", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(keys.map((name) => [name, 15])) }));
  return { id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const reports = [], failures = [];
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  for (const profile of ["standard", "background"]) for (const motion of ["still", "across", "along", "diagonal"]) {
    const dt = profile === "background" ? 0.3 : 0.1;
    const e = new SimEngine(club("home"), club("away"), { random: () => 0.999, simulationProfile: profile, timeStep: dt });
    const other = team === "home" ? "away" : "home", dir = e.attackDir(team);
    const keeper = e.agentById(`${other}-0`), shooter = e.agentById(`${team}-8`);
    for (const a of e.agents) a.sentOff = a !== keeper && a !== shooter;
    e.t = 100; e.deadBallUntil = 0; e._fatigueCheckT = Infinity;
    const vx = ["across", "diagonal"].includes(motion) ? side * 3 / mx : 0;
    const vy = ["along", "diagonal"].includes(motion) ? dir * 2 / my : 0;
    Object.assign(keeper, { x: 50 + side * 2 / mx, y: e.targetGoalY(team) - dir * 5 / my,
      vx, vy, heading: Math.atan2(vy, vx) });
    keeper.tx = keeper.x + vx * 3; keeper.ty = keeper.y + vy * 3;
    Object.assign(shooter, { x: 50, y: e.targetGoalY(team) - dir * 20 / my });
    shooter.tx = shooter.x; shooter.ty = shooter.y;
    Object.assign(e.ball, { state: "shot", owner: null, x: 50, y: e.targetGoalY(team) - dir * 8 / my,
      z: 1, vz: 0, vx: side * 1 / mx, vy: dir * 35 / my, shotAt: 99.8, shotFlightTime: 0.6,
      shotDistance: 20, kickTeam: team, lastKicker: shooter.id, _saveChecked: false,
      _openGoalShot: false, settleUntil: 0, restartType: null });
    e._think = () => {};
    const integrate = e._integrate;
    let motionStart;
    e._integrate = function (a, stepDt) {
      if (a === keeper && motionStart?.at !== this.t) motionStart = { at: this.t, x: a.x, y: a.y };
      return integrate.call(this, a, stepDt);
    };
    const rows = [];
    observe = (engine, actual) => {
      assert.equal(engine, e);
      assert.equal(actual.gk, keeper);
      assert.equal(motionStart.at, e.t);
      const b = e.ball;
      const sx = (b._prevX - motionStart.x) * mx, sy = (b._prevY - motionStart.y) * my;
      const ex = (b.x - keeper.x) * mx, ey = (b.y - keeper.y) * my;
      const dx = ex - sx, dy = ey - sy;
      const alpha = Math.max(0, Math.min(1, -(sx * dx + sy * dy) / (dx * dx + dy * dy)));
      const expectedGap = Math.hypot(sx + dx * alpha, sy + dy * alpha);
      const row = { team, side, profile, motion, stepAt: e.t, alpha, expectedGap,
        actualAlpha: actual.tt, actualGap: actual.dPath,
        gapError: actual.dPath - expectedGap,
        keeperTravel: Math.hypot((keeper.x - motionStart.x) * mx, (keeper.y - motionStart.y) * my) };
      rows.push(row);
      if (Math.abs(row.gapError) > 1e-8 || Math.abs(actual.tt - alpha) > 1e-8) failures.push(row);
    };
    e.step(dt);
    assert.ok(rows.length, "fixture must exercise the real swept save geometry");
    reports.push(...rows);
  }
}
delete globalThis[key];
console.log(JSON.stringify({ scenarios: 32, contacts: reports.length, failures, reports }, null, 2));
assert.deepEqual(failures, [], "save geometry cannot use the keeper's future endpoint at an earlier ball contact");
