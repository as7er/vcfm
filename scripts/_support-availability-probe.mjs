// Read-only measurement of settled, screened low-pass outlets. Use --import
// for a process-local candidate; the first match checks observation determinism.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";

const count = Math.max(1, Number(process.argv[2]) || 6);
const profile = process.argv[3] === "background" ? "background" : "standard";
const label = process.argv[4] || "current";
assert.match(label, /^[a-z0-9-]+$/);
const dt = profile === "background" ? 0.3 : SIM.DT;
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const distance = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
const speed = (a) => Math.hypot(a.vx * mx, a.vy * my);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const percentile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null;
};
const pct = (n, d) => d ? n / d * 100 : 0;
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
    "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning",
    "kicking", "decisions", "crossing"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, 15 + ((i * 7 + 15) % 5) - 2])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3 } };
}
function clearance(engine, team, from, to) {
  const dx = (to.x - from.x) * mx;
  const dy = (to.y - from.y) * my;
  const length = Math.hypot(dx, dy);
  let laneGap = Infinity;
  let markerGap = Infinity;
  let blocker = null;
  for (const o of engine.agents) {
    if (o.team === team || o.role === "GK" || o.sentOff || o.injuredOff) continue;
    markerGap = Math.min(markerGap, distance(o, to));
    const ox = (o.x - from.x) * mx;
    const oy = (o.y - from.y) * my;
    const along = (ox * dx + oy * dy) / length;
    if (along <= 0 || along >= length) continue;
    const gap = Math.abs(ox * dy - oy * dx) / length;
    if (gap < laneGap) { laneGap = gap; blocker = o; }
  }
  return { laneGap, markerGap, blocker };
}
function alternative(engine, a, owner) {
  const target = { x: a.tx, y: a.ty };
  const b = engine.ball;
  const dx = (target.x - b.x) * mx;
  const dy = (target.y - b.y) * my;
  const length = Math.hypot(dx, dy);
  if (length < 0.1) return null;
  // A short check away from the passing line, in metres, rather than arbitrary
  // oscillation about the formation anchor. This only observes candidate space.
  for (const offset of [2, 4, 6]) {
    for (const side of [-1, 1]) {
      const x = target.x - dy / length * offset * side / mx;
      const y = target.y + dx / length * offset * side / my;
      if (x < 3 || x > 97 || y < 3 || y > 97 || engine._isOffsidePosition(a.team, { x, y })) continue;
      if (distance(b, { x, y }) >= 20) continue;
      const g = clearance(engine, a.team, b, { x, y });
      if (g.laneGap <= 1.8 || g.markerGap <= 2) continue;
      if (!engine._launchRouteClear(owner, { agent: a, tx: x, ty: y })) continue;
      const crowded = engine.agents.some((m) => m.team === a.team && m.id !== a.id &&
        !m.sentOff && !m.injuredOff && distance({ x, y }, { x: m.tx, y: m.ty }) < 1.8);
      if (!crowded) return { x, y, offset, laneGap: g.laneGap };
    }
  }
  return null;
}

const buckets = new Map();
const episodes = [];
const examples = [];
const matches = [];
const sampleEvery = profile === "background" ? 0.6 : 0.5;
function play(seed, observed) {
  const rng = seeded(seed);
  let draws = 0;
  const random = () => { draws++; return rng(); };
  const e = new SimEngine(club(`h${seed}`), club(`a${seed}`), {
    random, simulationProfile: profile, timeStep: dt, separationPasses: profile === "background" ? 4 : 8,
  });
  const active = new Map();
  let nextSample = dt;
  const frameHash = createHash("sha256");
  const end = (key, reason) => {
    const record = active.get(key);
    if (!record) return;
    episodes.push({ ...record, reason, seconds: record.lastAt - record.at });
    active.delete(key);
  };
  for (let s = 0; s < Math.round(5400 / dt); s++) {
    e.step(dt);
    if (seed === 372000) frameHash.update(JSON.stringify(e.snapshot()));
    if (!observed || e.t + 1e-7 < nextSample) continue;
    nextSample += sampleEvery;
    const seen = new Set();
    const b = e.ball;
    const owner = b.owner && e.agentById(b.owner);
    const depth = owner ? Math.abs(b.y - e.targetGoalY(owner.team)) * my : Infinity;
    if (owner && !b.restartType && e.t >= (e.deadBallUntil || 0) && b.state === "held" && depth < 38) {
      const zone = depth < 10 ? "under10" : depth < 16.5 ? "10to16.5" : depth < 25 ? "16.5to25" : "25to38";
      for (const a of e.agents) {
        if (a.team !== owner.team || a.id === owner.id || a.role === "GK" || a.sentOff || a.injuredOff) continue;
        const key = `${zone}:${a.role}`;
        if (!buckets.has(key)) buckets.set(key, { samples: 0, settled: 0, lowOutlets: 0, blocked: 0,
          launchBlocked: 0, closelyMarked: 0, escapePossible: 0, gap: [] });
        const row = buckets.get(key);
        row.samples++;
        if (speed(a) >= 1 || distance(a, { x: a.tx, y: a.ty }) > 1.5) continue;
        row.settled++;
        const passLength = distance(b, a);
        if (passLength < 6 || passLength >= 20) continue;
        row.lowOutlets++;
        const g = clearance(e, a.team, b, a);
        if (g.laneGap > 1.1) continue;
        row.blocked++;
        row.gap.push(g.laneGap);
        row.closelyMarked += Number(g.markerGap <= 2);
        row.launchBlocked += Number(!e._launchRouteClear(owner, { agent: a, tx: a.x, ty: a.y }));
        const alt = alternative(e, a, owner);
        row.escapePossible += Number(!!alt);
        const episodeKey = `${a.id}:${owner.id}:${e._teamAttackSince[a.team]}`;
        seen.add(episodeKey);
        let record = active.get(episodeKey);
        if (!record) {
          record = { seed, playerId: a.id, ownerId: owner.id, role: a.role, zone, at: e.t,
            lastAt: e.t, samples: 0, escapeSamples: 0 };
          active.set(episodeKey, record);
        }
        record.lastAt = e.t;
        record.samples++;
        record.escapeSamples += Number(!!alt);
        if (alt && record.samples === 5 && examples.length < 40) {
          const point = (m) => ({ id: m.id, team: m.team, role: m.role, x: m.x, y: m.y,
            vx: m.vx, vy: m.vy, tx: m.tx, ty: m.ty, kind: m.offBallTarget?.kind });
          examples.push({ seed, at: e.t, ball: { x: b.x, y: b.y }, owner: point(owner),
            player: point(a), blocker: point(g.blocker), alternative: alt, laneGap: g.laneGap });
        }
      }
    }
    for (const key of active.keys()) if (!seen.has(key)) end(key, "changed");
  }
  for (const key of active.keys()) end(key, "match-end");
  return { seed, score: e.score, draws, stateHash: hash(e.snapshot()), eventsHash: hash(e.events),
    frameHash: seed === 372000 ? frameHash.digest("hex") : null };
}
let determinism;
for (let i = 0; i < count; i++) {
  const seed = 372000 + i;
  const bare = i === 0 ? play(seed, false) : null;
  const measured = play(seed, true);
  if (bare) {
    assert.deepEqual(measured, bare, "observation must preserve every frame, event and random draw");
    determinism = measured;
  }
  matches.push(measured);
}
const rows = Object.fromEntries([...buckets].map(([key, r]) => [key, {
  samples: r.samples, settledPct: pct(r.settled, r.samples), lowOutlets: r.lowOutlets,
  blocked: r.blocked, blockedPct: pct(r.blocked, r.lowOutlets),
  launchBlockedPct: pct(r.launchBlocked, r.blocked), closelyMarkedPct: pct(r.closelyMarked, r.blocked),
  escapePossiblePct: pct(r.escapePossible, r.blocked), medianLaneGap: percentile(r.gap, 0.5),
}]));
const summary = { label, profile, matches, determinism, buckets: rows,
  episodes: { count: episodes.length, medianSeconds: percentile(episodes.map((r) => r.seconds), 0.5),
    p90Seconds: percentile(episodes.map((r) => r.seconds), 0.9),
    atLeast2Seconds: episodes.filter((r) => r.seconds >= 2).length,
    atLeast2SecondsWithSpace: episodes.filter((r) => r.seconds >= 2 && r.escapeSamples >= r.samples / 2).length },
  engineSha256: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  preloads: process.execArgv, createdAt: new Date().toISOString() };
mkdirSync(new URL("../.tmp-continuity/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../.tmp-continuity/support-availability-${label}-${profile}.json`, import.meta.url),
  JSON.stringify({ summary, episodes, examples }, null, 2));
console.log(JSON.stringify(summary, null, 2));
