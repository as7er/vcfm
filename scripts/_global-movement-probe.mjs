// Observe movement by phase and duty, keeping the historical final-third
// denominator alongside live-play measurements. No tactical methods are re-run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";

const count = Math.max(1, Number(process.argv[2]) || 6);
const profile = process.argv[3] === "background" ? "background" : "standard";
const label = process.argv[4] || "current";
assert.match(label, /^[a-z0-9-]+$/);
const dt = profile === "background" ? 0.3 : SIM.DT;
const interval = profile === "background" ? 0.6 : 0.5;
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const metres = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
const speed = (a) => Math.hypot(a.vx * mx, a.vy * my);
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const round = (n) => Number(n.toFixed(3));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? round(sorted[Math.floor(sorted.length / 2)]) : null;
};
const pct = (n, d) => d ? round(100 * n / d) : 0;
const directory = new URL("../.tmp-continuity/global-movement/", import.meta.url);
mkdirSync(directory, { recursive: true });
const output = new URL(`${label}-${profile}.json`, directory);
assert.ok(!existsSync(output), "use a fresh evidence label");

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
function duty(e, a) {
  if (a.role === "DEF") return e._isFullback(a) ? "fullback" : "centre-back";
  if (a.role === "MID") return e._isPrimaryMidRunner(a) ? "mid-runner" : "mid-support";
  return e._isWinger(a) ? "winger" : "striker";
}
function gapToOpponents(e, team, from, to) {
  const dx = (to.x - from.x) * mx;
  const dy = (to.y - from.y) * my;
  const length = Math.hypot(dx, dy);
  let lane = Infinity;
  let marker = Infinity;
  for (const other of e.agents) {
    if (other.team === team || other.role === "GK" || other.sentOff || other.injuredOff) continue;
    marker = Math.min(marker, metres(other, to));
    const ox = (other.x - from.x) * mx;
    const oy = (other.y - from.y) * my;
    const along = length > 0 ? (ox * dx + oy * dy) / length : 0;
    if (along <= 0 || along >= length) continue;
    lane = Math.min(lane, Math.abs(ox * dy - oy * dx) / length);
  }
  return { lane, marker };
}
const buckets = new Map();
function sample(key, e, a, b) {
  if (!buckets.has(key)) buckets.set(key, { samples: 0, still: 0, settled: 0, movingForward: 0,
    ahead5: 0, speed: 0, targetGap: [], ahead: [], openShort: 0, closedShort: 0 });
  const row = buckets.get(key);
  const velocity = speed(a);
  const gap = metres(a, { x: a.tx, y: a.ty });
  const lead = (a.ty - b.y) * e.attackDir(a.team) * my;
  const passDistance = metres(a, b);
  row.samples++;
  row.still += Number(velocity < 1);
  row.settled += Number(velocity < 1 && gap < 1.5);
  row.movingForward += Number(a.vy * e.attackDir(a.team) * my >= 1);
  row.ahead5 += Number(lead >= 5);
  row.speed += velocity;
  row.targetGap.push(gap);
  row.ahead.push(lead);
  if (passDistance >= 6 && passDistance < 20) {
    const { lane } = gapToOpponents(e, a.team, b, a);
    row.openShort += Number(lane > 1.1);
    row.closedShort += Number(lane <= 1.1);
  }
}
const collective = { samples: 0, moving: [], ahead: [], allSettled: 0, openOptions: [], closedAll: 0 };
const episodes = [];
const examples = [];
const passes = { total: 0, eligible: 0, newRun: 0, keptRun: 0, noRun: 0, cutback: 0,
  settledAtPass: [], movingAtPass: [] };
const matches = [];
function point(a) {
  return { id: a.id, team: a.team, role: a.role, x: a.x, y: a.y, tx: a.tx, ty: a.ty,
    vx: a.vx, vy: a.vy, baseX: a.baseX, baseY: a.baseY,
    kind: a.offBallTarget?.kind, fsm: a.fsm, attackThinkUntil: a.attackThinkUntil };
}
function play(seed, observed) {
  const rng = seeded(seed);
  let draws = 0;
  const e = new SimEngine(club(`h${seed}`), club(`a${seed}`), {
    random: () => { draws++; return rng(); }, simulationProfile: profile,
    timeStep: dt, separationPasses: profile === "background" ? 4 : 8,
  });
  const originalStart = e._startPassSupport;
  if (observed) e._startPassSupport = function(a, option) {
    const before = this._passSupportRun;
    const result = originalStart.call(this, a, option);
    const b = this.ball;
    passes.total++;
    if (b.state !== "pass" || b.lastKicker !== a.id || b.lastPassAt !== this.t ||
        !option.agent || option.cross || option.agent.role === "GK" ||
        Math.abs(b.targetY - this.targetGoalY(a.team)) * my > 38 ||
        (b.targetY - b.kickY) * this.attackDir(a.team) < -4) return result;
    passes.eligible++;
    const after = this._passSupportRun;
    const active = after && after.team === a.team && this.t <= after.until &&
      after.attackSince === this._teamAttackSince[a.team];
    passes.newRun += Number(active && after !== before);
    passes.keptRun += Number(active && after === before);
    passes.noRun += Number(!active);
    passes.cutback += Number(active && after.cutback);
    const front = this.agents.filter((p) => p.team === a.team && p.id !== a.id &&
      p.id !== option.agent.id && !p.sentOff && !p.injuredOff &&
      (p.role === "ATT" || this._isPrimaryMidRunner(p)));
    passes.settledAtPass.push(front.filter((p) => speed(p) < 1 && metres(p, { x: p.tx, y: p.ty }) < 1.5).length);
    passes.movingAtPass.push(front.filter((p) => speed(p) >= 1).length);
    return result;
  };
  const frameHash = createHash("sha256");
  let nextSample = dt;
  let episode = null;
  function finish(reason) {
    if (!episode) return;
    episodes.push({ ...episode, seconds: round(episode.lastAt - episode.at), reason });
    episode = null;
  }
  for (let step = 0; step < Math.round(5400 / dt); step++) {
    e.step(dt);
    if (seed === 372000) frameHash.update(JSON.stringify(e.snapshot()));
    if (!observed || e.t + 1e-7 < nextSample) continue;
    nextSample += interval;
    const b = e.ball;
    const owner = b.owner ? e.agentById(b.owner) : null;
    const team = owner?.team || (["pass", "shot"].includes(b.state) ? b.kickTeam : null);
    const live = !b.restartType && e.t >= (e.deadBallUntil || 0) && e.t >= (e.cornerShapeUntil || 0);
    const legacyTeam = e.possession;
    if (["home", "away"].includes(legacyTeam) && Math.abs(b.y - e.targetGoalY(legacyTeam)) < 36) {
      for (const a of e.agents) {
        if (a.team !== legacyTeam || a.role === "GK" || a.sentOff || a.id === owner?.id) continue;
        sample("historical-final-third", e, a, b);
        sample(`historical:${live ? b.state : "restart"}`, e, a, b);
      }
    }
    if (!live || !["home", "away"].includes(team)) { finish("phase-ended"); continue; }
    const depth = Math.abs(b.y - e.targetGoalY(team)) * my;
    const zone = depth < 10 ? "under10" : depth < 16.5 ? "10to16.5" : depth < 38 ? "16.5to38" : "build-up";
    const attackers = e.agents.filter((a) => a.team === team && a.role !== "GK" &&
      !a.sentOff && !a.injuredOff && a.id !== owner?.id);
    for (const a of attackers) {
      sample(`attack:${zone}:${duty(e, a)}`, e, a, b);
      if (depth < 38) {
        sample(`live-final:${b.state}`, e, a, b);
        sample(`target:${a.offBallTarget?.kind || a.fsm}`, e, a, b);
      }
    }
    if (depth >= 38 || !owner || b.state !== "held") { finish("carrier-changed"); continue; }
    const front = attackers.filter((a) => a.role === "ATT" || e._isPrimaryMidRunner(a));
    const moving = front.filter((a) => speed(a) >= 1).length;
    const ahead = front.filter((a) => (a.ty - b.y) * e.attackDir(team) * my >= 5).length;
    const settled = front.length >= 2 && front.every((a) => speed(a) < 1 && metres(a, { x: a.tx, y: a.ty }) < 1.5);
    const open = front.filter((a) => {
      const length = metres(a, b);
      const space = gapToOpponents(e, team, b, a);
      return length >= 4 && length <= 25 && space.lane > 1.1 && space.marker >= 2 && !e._isOffsidePosition(team, a);
    }).length;
    collective.samples++;
    collective.moving.push(moving);
    collective.ahead.push(ahead);
    collective.allSettled += Number(settled);
    collective.openOptions.push(open);
    collective.closedAll += Number(settled && open === 0);
    if (!settled) { finish("players-moved"); continue; }
    const key = `${team}:${owner.id}:${e._teamAttackSince[team]}`;
    if (episode && episode.key !== key) finish("possession-changed");
    if (!episode) episode = { key, seed, at: e.t, lastAt: e.t, samples: 0,
      withoutOpen: 0, depth: round(depth), front: front.map((a) => a.id), startBall: { x: b.x, y: b.y } };
    episode.lastAt = e.t;
    episode.samples++;
    episode.withoutOpen += Number(open === 0);
    if (episode.samples === 5 && examples.length < 60) examples.push({ seed, t: e.t,
      episodeStart: episode.at, ball: { ...b, offsideIds: [...(b.offsideIds || [])] },
      plan: e._passSupportRun ? { ...e._passSupportRun } : null, open, depth,
      players: e.agents.map(point) });
  }
  finish("match-end");
  return { seed, score: e.score, draws, stateHash: hash(e.snapshot()), eventsHash: hash(e.events),
    frameHash: seed === 372000 ? frameHash.digest("hex") : null };
}
for (let i = 0; i < count; i++) {
  const seed = 372000 + i;
  const bare = i === 0 ? play(seed, false) : null;
  const measured = play(seed, true);
  if (bare) assert.deepEqual(measured, bare, "observation changed frames, events or random calls");
  matches.push(measured);
}
const summary = { label, profile, matches, observerComparedSeed: 372000,
  engineSha256: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  preloads: process.execArgv, createdAt: new Date().toISOString(),
  buckets: Object.fromEntries([...buckets].map(([key, row]) => [key, { samples: row.samples,
    stillPct: pct(row.still, row.samples), settledPct: pct(row.settled, row.samples),
    movingForwardPct: pct(row.movingForward, row.samples), ahead5Pct: pct(row.ahead5, row.samples),
    meanSpeed: round(row.speed / row.samples), medianGap: median(row.targetGap), medianAhead: median(row.ahead),
    openShort: row.openShort, closedShort: row.closedShort }])),
  collective: { samples: collective.samples, medianMoving: median(collective.moving),
    medianAhead5: median(collective.ahead), allSettledPct: pct(collective.allSettled, collective.samples),
    settledWithoutOpenPct: pct(collective.closedAll, collective.samples),
    medianOpen: median(collective.openOptions), episodes: episodes.length,
    episodesAtLeast2Seconds: episodes.filter((r) => r.seconds >= 2).length,
    episodesAtLeast2SecondsWithoutOpen: episodes.filter((r) => r.seconds >= 2 && r.withoutOpen >= r.samples / 2).length },
  passes: { ...passes, settledAtPass: median(passes.settledAtPass), movingAtPass: median(passes.movingAtPass) } };
writeFileSync(output, `${JSON.stringify({ summary, episodes, examples }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
