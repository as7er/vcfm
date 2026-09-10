// Independently sample legal lateral space between the candidate's coarse
// search points. This observer never assigns targets or consumes randomness.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";
import { OFF_BALL_TARGET_DEFAULTS } from "../js/off-ball-movement.js";

const count = Number(process.argv[2]) || 6;
const label = process.argv[3] || "current";
assert.match(label, /^[a-z0-9-]+$/);
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const gap = (p, q) => Math.hypot((p.x - q.x) * mx, (p.y - q.y) * my);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function seeded(seed) {
  let v = seed >>> 0;
  return () => {
    v += 0x6d2b79f5;
    let n = v;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function club(id) {
  const attrs = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
    "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning",
    "kicking", "decisions", "crossing"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, 15 + ((i * 7 + 15) % 5) - 2])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3 } };
}
let eligible = 0;
let missed = 0;
let excess = 0;
const examples = [];
function play(seed, observed) {
  const rng = seeded(seed);
  let draws = 0;
  const e = new SimEngine(club(`h${seed}`), club(`a${seed}`), {
    random: () => { draws++; return rng(); }, timeStep: SIM.DT, separationPasses: 8,
  });
  const frameHash = createHash("sha256");
  if (observed) {
    const apply = e._applySupportOffer;
    e._applySupportOffer = function(a, owner, previous) {
      const b = this.ball;
      const anchor = { x: a.tx, y: a.ty };
      const examine = !previous && owner && owner.team === a.team && a.id !== b.owner &&
        !a.sentOff && !a.injuredOff && ["ATT", "MID"].includes(a.role) && b.owner === owner.id &&
        b.state === "held" && !b.restartType && this.t >= this.deadBallUntil &&
        !["third-man-run", "cutback-outlet", "one-two"].includes(a.offBallTarget?.kind) &&
        Math.abs(b.y - this.targetGoalY(a.team)) * my < 38 &&
        Math.hypot(a.vx * mx, a.vy * my) < 1 && gap(a, anchor) <= 1.5 &&
        gap(b, anchor) >= 6 && gap(b, anchor) < 20 && this._laneSafety(owner, a, anchor.x, anchor.y) <= 1.1 / 8;
      let alternative = null;
      if (examine) {
        eligible++;
        for (let step = -60; step <= 60; step++) {
          const spot = { x: anchor.x + step / 10 / mx, y: anchor.y };
          if (spot.x < 3 || spot.x > 97 || spot.y < 3 || spot.y > 97 || gap(b, spot) >= 20 ||
              this._isOffsidePosition(a.team, spot)) continue;
          const other = a.team === "home" ? "away" : "home";
          if (a.role === "MID" && !this._isPrimaryMidRunner(a) && this._inOwnFoulBox(other, spot.x, spot.y)) continue;
          if (!this._supportRunClear(a, spot) || this._laneSafety(owner, a, spot.x, spot.y) < 1.8 / 8 ||
              !this._launchRouteClear(owner, { agent: a, tx: spot.x, ty: spot.y })) continue;
          if (this.agents.some((m) => m.id !== a.id && !m.sentOff && !m.injuredOff &&
              (m.team === a.team ? gap(spot, { x: m.tx, y: m.ty }) < OFF_BALL_TARGET_DEFAULTS.supportSpacingMetres
                : m.role !== "GK" && gap(spot, m) < 2))) continue;
          if (!alternative || gap(a, spot) < gap(a, alternative)) alternative = spot;
        }
      }
      const result = apply.call(this, a, owner, previous);
      if (examine && alternative) {
        const offer = a.offBallTarget?.offer;
        const skipped = !offer;
        const overshot = !!offer && gap(a, offer) > gap(a, alternative) + 0.25;
        missed += Number(skipped);
        excess += Number(overshot);
        if ((skipped || overshot) && examples.length < 30) examples.push({ seed, at: this.t,
          playerId: a.id, anchor, alternative, chosen: offer || null, skipped, overshot,
          ball: { x: b.x, y: b.y, owner: b.owner },
          agents: this.agents.filter((m) => !m.sentOff && !m.injuredOff).map((m) => ({
            id: m.id, team: m.team, role: m.role, x: m.x, y: m.y, tx: m.tx, ty: m.ty, vx: m.vx, vy: m.vy,
          })) });
      }
      return result;
    };
  }
  for (let step = 0; step < 54000; step++) {
    e.step(SIM.DT);
    if (seed === 372000) frameHash.update(JSON.stringify(e.snapshot()));
  }
  return { seed, draws, score: e.score, final: digest(e.snapshot()), events: digest(e.events),
    frames: seed === 372000 ? frameHash.digest("hex") : null };
}
const matches = [];
for (let i = 0; i < count; i++) {
  const bare = i === 0 ? play(372000, false) : null;
  const measured = play(372000 + i, true);
  if (bare) assert.deepEqual(measured, bare);
  matches.push(measured);
}
const summary = { label, matches, eligible, missed, excess, preloads: process.execArgv };
mkdirSync(new URL("../.tmp-continuity/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../.tmp-continuity/support-space-${label}.json`, import.meta.url),
  JSON.stringify({ summary, examples }, null, 2));
console.log(JSON.stringify(summary, null, 2));
