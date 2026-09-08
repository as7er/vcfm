import assert from "node:assert/strict";
import fs from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";
import { compactSimFrame } from "../js/sim/adapt.js";
import { createWorld } from "../js/models.js";
import { CLUB_TEMPLATES, START_DIVISIONS } from "../js/data.js";

const count = Number(process.argv[2]) || 1000;
const useWorld = process.argv[3] === "world";
function random(seed) {
  return () => {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 4294967296;
  };
}
function club(id, strength) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(["pace", "acceleration", "agility", "strength", "physical", "passing",
        "vision", "shooting", "finishing", "dribbling", "tackling", "marking", "stamina",
        "positioning", "reflexes", "handling", "kicking", "crossing", "decisions"]
        .map((key) => [key, strength])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
const metres = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);
let clubs = null;
if (useWorld) {
  const originalRandom = Math.random;
  Math.random = random(582601);
  try {
    const start = CLUB_TEMPLATES.find((candidate) => START_DIVISIONS.includes(candidate.division));
    clubs = createWorld(start.id, "Opening Motion Probe").clubs;
  } finally {
    Math.random = originalRandom;
  }
}
const report = { matches: count, fixtureMode: useWorld ? "world" : "synthetic",
  rawPairs: 0, maxSpeed: 0, incidents: [] };
for (let i = 0; i < count; i++) {
  const seed = 51029 + i;
  const home = clubs ? structuredClone(clubs[i % clubs.length]) : club("home", 8 + i % 12);
  let awayIndex = (i * 17 + 13) % (clubs?.length || 1);
  if (clubs && awayIndex === i % clubs.length) awayIndex = (awayIndex + 1) % clubs.length;
  const away = clubs ? structuredClone(clubs[awayIndex]) : club("away", 8 + (i * 7) % 12);
  const engine = new SimEngine(home, away, { random: random(seed) });
  let before = compactSimFrame(engine);
  const history = [];
  for (let step = 0; step < 140; step++) {
    engine.step(SIM.DT);
    const after = compactSimFrame(engine);
    assert.ok(after.t > before.t, "recorded frame times must be increasing");
    const boundary = before.motionContext?.discontinuity || after.motionContext?.discontinuity ||
      before.ball.restartType || after.ball.restartType;
    if (!boundary) {
      const byId = new Map(before.players.map((p) => [p.id, p]));
      for (const p of after.players) {
        const prev = byId.get(p.id);
        if (!prev) continue;
        const speed = metres(prev, p) / (after.t - before.t);
        report.maxSpeed = Math.max(report.maxSpeed, speed);
        if (speed > 11.5 && report.incidents.length < 30) {
          report.incidents.push({ seed, home: home.id, away: away.id, id: p.id, t: after.t,
            speed, sourceFrames: [...history, before, after] });
        }
      }
      report.rawPairs++;
    }
    history.push(before);
    if (history.length > 2) history.shift();
    before = after;
  }
}
fs.mkdirSync(".tmp-continuity", { recursive: true });
fs.writeFileSync(`.tmp-continuity/opening-motion-source${useWorld ? "-world" : ""}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, incidents: report.incidents.map(({ sourceFrames, ...r }) => r) }, null, 2));
