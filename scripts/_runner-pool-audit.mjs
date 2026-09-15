// Ground-truth audit of the primary-mid runner slot, with the habit clause live.
//
// `_isPrimaryMidRunner` decides which single midfielder may attack the box:
// js/sim/engine.js:3699 rejects a non-primary mid's support point inside the
// opponent box, and :3801 pushes non-primary mids behind the ball in the final
// third. HEAD computes it as `mids[0]?.id === a.id` over *all* mids, so exactly
// one mid holds the slot whenever a mid is on the pitch.
//
// `_runner-only-candidate.mjs` narrows that pool with
//
//   m.isCore || !(hasHabit(comes_deep) ||
//                 (!hasHabit(gets_forward) && roleBehavior(support) > 0.52))
//
// Every existing harness (match-realism-audit, match-motion-integrity-audit)
// builds players with no `playingHabits`, so `_hasHabit` is always false there
// and only the `roleBehavior` half of that filter is ever exercised. This probe
// runs the same matches with habits actually derived, so the habit clause fires.
//
// If the narrowed pool comes out empty, `mids[0]` is undefined and *no*
// midfielder holds the slot -- the mechanic silently switches off for that team.
//
// Usage:
//   node scripts/_runner-pool-audit.mjs
//   node --import ./scripts/_runner-only-candidate.mjs scripts/_runner-pool-audit.mjs
import { SimEngine } from "../js/sim/engine.js";
import { ensurePlayerHabits } from "../js/player-habits.js";

const ATTR_KEYS = [
  "pace", "acceleration", "agility", "balance", "strength", "physical",
  "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
  "marking", "stamina", "positioning", "reflexes", "handling", "kicking",
  "heading", "crossing", "decisions", "firstTouch",
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const SLOTS = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];

/**
 * habitProfile:
 *   "none"     -- what every existing harness builds (no playingHabits at all)
 *   "derived"  -- habits derived through the shipped pipeline (ensurePlayerHabits)
 *   "deep-mids"-- worst case: every non-core mid carries comes_deep
 */
function makeClub(id, habitProfile, strength = 12) {
  const players = SLOTS.map((pos, index) => {
    const attrs = Object.fromEntries(ATTR_KEYS.map((key) => [key, strength]));
    // Give midfielders a passing/vision lean and wide/forward players a
    // pace/stamina lean, so the shipped derivation can actually choose between
    // comes_deep and gets_forward instead of tie-breaking on id.
    if (pos === "MID") {
      attrs.vision = strength + 6;
      attrs.passing = strength + 6;
      attrs.decisions = strength + 5;
      attrs.pace = strength - 3;
      attrs.stamina = strength - 2;
      attrs.positioning = strength - 2;
    } else if (pos === "ATT") {
      attrs.pace = strength + 6;
      attrs.stamina = strength + 5;
      attrs.positioning = strength + 5;
      attrs.vision = strength - 2;
    } else if (pos === "DEF") {
      attrs.pace = strength + 3;
      attrs.stamina = strength + 3;
      attrs.positioning = strength + 3;
    }
    const player = {
      id: `${id}-${index}`,
      name: `${id} ${index + 1}`,
      pos,
      number: index + 1,
      age: 25,
      ovr: strength,
      potential: strength,
      fitness: 100,
      morale: 70,
      injured: 0,
      suspended: 0,
      attrs,
    };
    if (habitProfile === "derived") {
      ensurePlayerHabits(player);
    } else if (habitProfile === "deep-mids") {
      player.playingHabits = pos === "MID" ? ["comes_deep"] : [];
    }
    return player;
  });
  return {
    id,
    name: id,
    short: id,
    color: id.includes("home") ? "#2563eb" : "#dc2626",
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      style: "balanced",
      pressing: 3,
      tempo: 3,
      width: 3,
      defensiveLine: 3,
      roles: [],
      duties: [],
    },
  };
}

/** Mirrors the candidate's eligibility filter, for reporting only. */
function eligiblePool(engine, team) {
  return engine.agents.filter(
    (m) => m.team === team && m.role === "MID" && !m.sentOff && !m.injuredOff &&
      (m.isCore || !(engine._hasHabit(m, "comes_deep") ||
        (!engine._hasHabit(m, "gets_forward") && engine._roleBehavior(m, "support") > 0.52)))
  );
}

function runMatch(seed, profile, habitProfile) {
  const engine = new SimEngine(
    makeClub(`home-${seed}`, habitProfile),
    makeClub(`away-${seed}`, habitProfile),
    { random: seededRandom(seed), simulationProfile: profile }
  );
  const step = profile === "background" ? 0.3 : 0.1;
  const out = {
    seed,
    teamTicks: 0,
    ticksWithNoPrimary: 0,
    ticksWithAllMidsIneligible: 0,
    emptyPoolTicks: 0,
    minPoolSize: Number.POSITIVE_INFINITY,
    maxPoolSize: 0,
    midsWithComesDeep: 0,
    midsWithGetsForward: 0,
  };
  while (engine.t < 90 * 60 - 1e-9) {
    engine.step(step);
    for (const team of ["home", "away"]) {
      const mids = engine.agents.filter((m) => m.team === team && m.role === "MID");
      if (!mids.length) continue;
      out.teamTicks++;
      // Ground truth: does *any* mid hold the slot? Ask the engine, do not
      // re-derive the rule.
      const holders = mids.filter((m) => engine._isPrimaryMidRunner(m));
      if (!holders.length) out.ticksWithNoPrimary++;
      const pool = eligiblePool(engine, team);
      if (!pool.length) {
        out.emptyPoolTicks++;
        out.ticksWithAllMidsIneligible++;
      }
      out.minPoolSize = Math.min(out.minPoolSize, pool.length);
      out.maxPoolSize = Math.max(out.maxPoolSize, pool.length);
    }
  }
  for (const m of engine.agents.filter((a) => a.role === "MID")) {
    if (engine._hasHabit(m, "comes_deep")) out.midsWithComesDeep++;
    if (engine._hasHabit(m, "gets_forward")) out.midsWithGetsForward++;
  }
  if (!Number.isFinite(out.minPoolSize)) out.minPoolSize = 0;
  return out;
}

function summarize(samples) {
  const totals = samples.reduce((acc, s) => {
    acc.teamTicks += s.teamTicks;
    acc.ticksWithNoPrimary += s.ticksWithNoPrimary;
    acc.emptyPoolTicks += s.emptyPoolTicks;
    acc.minPoolSize = Math.min(acc.minPoolSize, s.minPoolSize);
    acc.maxPoolSize = Math.max(acc.maxPoolSize, s.maxPoolSize);
    acc.midsWithComesDeep += s.midsWithComesDeep;
    acc.midsWithGetsForward += s.midsWithGetsForward;
    return acc;
  }, {
    matches: samples.length, teamTicks: 0, ticksWithNoPrimary: 0, emptyPoolTicks: 0,
    minPoolSize: Number.POSITIVE_INFINITY, maxPoolSize: 0,
    midsWithComesDeep: 0, midsWithGetsForward: 0,
  });
  const pct = (value) => Number(((value / Math.max(1, totals.teamTicks)) * 100).toFixed(3));
  totals.noPrimarySharePct = pct(totals.ticksWithNoPrimary);
  totals.emptyPoolSharePct = pct(totals.emptyPoolTicks);
  totals.matchesWithEmptyPool = samples.filter((s) => s.emptyPoolTicks > 0).length;
  totals.matchesWithNoPrimary = samples.filter((s) => s.ticksWithNoPrimary > 0).length;
  return totals;
}

const SEEDS = [22901, 22902, 22903, 22904];
const report = {};
for (const habitProfile of ["none", "derived", "deep-mids"]) {
  report[habitProfile] = summarize(SEEDS.map((seed) => runMatch(seed, "background", habitProfile)));
}
console.log(JSON.stringify({ profile: "background", seeds: SEEDS, report }, null, 2));
