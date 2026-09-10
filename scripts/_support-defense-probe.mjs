// Diagnose the unchanged box-defending guard using the same clubs and seeds.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";

const count = Math.max(1, Number(process.argv[2]) || 12);
const label = process.argv[3] || "current";
assert.match(label, /^[a-z0-9-]+$/);
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const gap = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function club(id) {
  const attrs = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
    "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning", "kicking", "decisions"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, 12 + ((i * 7 + 12) % 5) - 2])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced" } };
}
const buckets = new Map();
const matches = [];
const examples = [];
for (let i = 0; i < count; i++) {
  const seed = 165000 + i;
  const original = Math.random;
  Math.random = seeded(seed);
  try {
    const e = new SimEngine(club(`home-${seed}`), club(`away-${seed}`), {
      simulationProfile: "standard", timeStep: SIM.DT, separationPasses: 8,
    });
    let ticks = 0;
    let total = 0;
    for (let step = 0; step < Math.round(5400 / SIM.DT); step++) {
      e.step(SIM.DT);
      const b = e.ball;
      const owner = b.owner && e.agentById(b.owner);
      if (!owner || owner.role === "GK") continue;
      const defending = owner.team === "home" ? "away" : "home";
      if (!(b.x > 22 && b.x < 78 && (defending === "home" ? b.y >= 84 : b.y <= 16))) continue;
      const opponents = e.agents.filter((a) => a.team === defending && !a.sentOff && a.role !== "GK")
        .map((a) => ({ a, gap: gap(a, b) })).sort((a, b) => a.gap - b.gap);
      const nearest = opponents[0];
      const plan = e._defPlans[defending];
      const presser = opponents.find(({ a }) => ["press", "contain"].includes(plan?.jobs?.get(a.id)?.type));
      const job = plan?.jobs?.get(nearest.a.id)?.type;
      const live = !b.restartType && e.t >= e.deadBallUntil;
      const depth = Math.abs(b.y - e.targetGoalY(owner.team)) * my;
      const zone = depth < 6 ? "under6" : depth < 12 ? "6to12" : "12plus";
      const support = e.agents.some((a) => a.team === owner.team && a.offBallTarget?.offer);
      const keys = ["all", live ? "live" : "restart", `state:${b.state}`, `depth:${zone}`,
        `nearest-job:${job}`, support ? "offer-active" : "no-offer", `match:${seed}`];
      for (const key of keys) {
        if (!buckets.has(key)) buckets.set(key, { ticks: 0, nearest: 0, over4: 0, presser: 0, presserLag: 0 });
        const row = buckets.get(key);
        row.ticks++;
        row.nearest += nearest.gap;
        row.over4 += Number(nearest.gap > 4);
        row.presser += presser?.gap || 0;
        row.presserLag += Number(presser && presser.gap > nearest.gap + 2);
      }
      ticks++;
      total += nearest.gap;
      if (live && nearest.gap > 4 && examples.length < 40 &&
          (!examples.length || e.t - examples.at(-1).at > 5 || examples.at(-1).seed !== seed)) {
        examples.push({ seed, at: e.t, ball: { x: b.x, y: b.y, state: b.state },
          owner: { id: owner.id, x: owner.x, y: owner.y },
          defenders: opponents.slice(0, 3).map(({ a, gap }) => ({ id: a.id, gap, x: a.x, y: a.y,
            tx: a.tx, ty: a.ty, vx: a.vx, vy: a.vy, job: plan?.jobs?.get(a.id) })) });
      }
    }
    matches.push({ seed, score: e.score, ticks, average: total / ticks });
  } finally { Math.random = original; }
}
const summary = { label, matches, buckets: Object.fromEntries([...buckets].map(([key, r]) => [key, {
  ticks: r.ticks, nearest: r.nearest / r.ticks, over4Pct: r.over4 / r.ticks * 100,
  presser: r.presser / r.ticks, presserLagPct: r.presserLag / r.ticks * 100,
}])), engineSha256: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  preloads: process.execArgv, createdAt: new Date().toISOString() };
mkdirSync(new URL("../.tmp-continuity/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../.tmp-continuity/support-defense-${label}.json`, import.meta.url),
  JSON.stringify({ summary, examples }, null, 2));
console.log(JSON.stringify(summary, null, 2));
