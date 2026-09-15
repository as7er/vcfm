// Is the "one midfielder may go forward" slot actually held by someone on the pitch?
//
// js/sim/engine.js:4179 `_isPrimaryMidRunner` picks the team's single forward-running
// midfielder with `mids[0]?.id === a.id`, over
//   this.agents.filter((m) => m.team === a.team && m.role === "MID")
// -- with **no sentOff / injuredOff filter**. So if the highest-scoring midfielder is
// off the pitch, `mids[0]` is that player, every on-pitch midfielder returns false,
// and *no* midfielder holds the slot.
//
// Two rules gate on that slot, and both are written as "exactly one":
//   :3799-3801  "three forwards + ONE best-suited midfielder" may advance in the
//               final third; everyone else drops behind the ball
//   :3699       a non-primary midfielder may not take a support spot in the box
// With the slot unheld, both degrade to "zero" -- the mechanic is silently off.
//
// This is independent of any candidate patch; it is a property of HEAD.
//
// Usage:
//   node scripts/_primary-mid-slot-audit.mjs --background 24 --standard 8
import { SimEngine } from "../js/sim/engine.js";

const SIM = { HOME_GOAL_Y: 100, AWAY_GOAL_Y: 0, FIELD_H: 100 };
const FINAL_THIRD_PROGRESS = 0.64;

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

function makeClub(id, strength = 12) {
  const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = positions.map((pos, index) => ({
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
    attrs: Object.fromEntries(ATTR_KEYS.map((key) => [key, strength])),
  }));
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

/** Same predicate the engine uses at :3748-3768. */
function inFinalThird(team, ballY) {
  const ownGoalY = team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
  const prog = Math.min(1, Math.max(0, Math.abs(ballY - ownGoalY) / SIM.FIELD_H));
  return prog > FINAL_THIRD_PROGRESS;
}

/** Is the player himself camped in the third he is attacking? (home attacks y=0) */
function inAttackingThird(team, y) {
  return team === "home" ? y < 33 : y > 67;
}

function runMatch(seed, profile) {
  const engine = new SimEngine(
    makeClub(`home-${seed}`),
    makeClub(`away-${seed}`),
    { random: seededRandom(seed), simulationProfile: profile }
  );
  const step = profile === "background" ? 0.3 : 0.1;
  const out = {
    seed,
    teamTicks: 0,
    okTicks: 0,
    defectTicks: 0,
    defectSentOff: 0,
    defectInjured: 0,
    defectFinalThirdTicks: 0,
    midsDeniedInFinalThird: 0,
    // Realised-effect probe: while the ball is in a team's attacking third, how many
    // of that team's on-pitch midfielders are actually up there with it?
    finalThirdTicks: 0,
    midsUpfieldSum: 0,
    midsUpfieldWhenDefectSum: 0,
    midsUpfieldWhenOkSum: 0,
    redCards: 0,
    midRedCards: 0,
  };
  while (engine.t < 90 * 60 - 1e-9) {
    engine.step(step);
    for (const team of ["home", "away"]) {
      const mids = engine.agents.filter((m) => m.team === team && m.role === "MID");
      const onPitch = mids.filter((m) => !m.sentOff && !m.injuredOff);
      if (!onPitch.length) continue;
      out.teamTicks++;
      // Ground truth: ask the engine which mid holds the slot.
      const holder = mids.find((m) => engine._isPrimaryMidRunner(m)) || null;
      const held = holder && !holder.sentOff && !holder.injuredOff;
      const ballInFinalThird = inFinalThird(team, engine.ball.y);
      const upfield = onPitch.filter((m) => inAttackingThird(team, m.y)).length;
      if (ballInFinalThird) {
        out.finalThirdTicks++;
        out.midsUpfieldSum += upfield;
        if (held) out.midsUpfieldWhenOkSum += upfield;
        else out.midsUpfieldWhenDefectSum += upfield;
      }
      if (held) {
        out.okTicks++;
        continue;
      }
      out.defectTicks++;
      if (holder?.sentOff) out.defectSentOff++;
      else if (holder?.injuredOff) out.defectInjured++;
      if (ballInFinalThird) {
        out.defectFinalThirdTicks++;
        // Every on-pitch mid is pushed behind the ball instead of one advancing.
        out.midsDeniedInFinalThird += onPitch.length;
      }
    }
  }
  for (const m of engine.agents) {
    if (!m.sentOff) continue;
    out.redCards++;
    if (m.role === "MID") out.midRedCards++;
  }
  return out;
}

function summarize(samples) {
  const totals = samples.reduce((acc, s) => {
    for (const key of Object.keys(s)) {
      if (key === "seed") continue;
      acc[key] = (acc[key] || 0) + s[key];
    }
    return acc;
  }, {});
  totals.matches = samples.length;
  const pct = (value) => Number(((value / Math.max(1, totals.teamTicks)) * 100).toFixed(4));
  totals.defectSharePct = pct(totals.defectTicks);
  totals.defectFinalThirdSharePct = pct(totals.defectFinalThirdTicks);
  totals.matchesWithDefect = samples.filter((s) => s.defectTicks > 0).length;
  totals.matchesWithDefectInFinalThird = samples.filter((s) => s.defectFinalThirdTicks > 0).length;
  totals.maxDefectTicksInMatch = Math.max(0, ...samples.map((s) => s.defectTicks));
  const avg = (sum, count) => Number((sum / Math.max(1, count)).toFixed(4));
  totals.avgMidsUpfieldInFinalThird = avg(totals.midsUpfieldSum, totals.finalThirdTicks);
  totals.avgMidsUpfieldWhenDefect = avg(totals.midsUpfieldWhenDefectSum, totals.defectFinalThirdTicks);
  totals.avgMidsUpfieldWhenOk = avg(
    totals.midsUpfieldWhenOkSum,
    totals.finalThirdTicks - totals.defectFinalThirdTicks
  );
  // Per-match rows so two runs on the same seeds can be paired, and so the affected
  // matches (the ones with defect ticks) can be read on their own.
  totals.perMatch = samples.map((s) => ({
    seed: s.seed,
    defectTicks: s.defectTicks,
    defectFinalThirdTicks: s.defectFinalThirdTicks,
    finalThirdTicks: s.finalThirdTicks,
    midsUpfieldWhenDefect: avg(s.midsUpfieldWhenDefectSum, s.defectFinalThirdTicks),
    midsUpfieldWhenOk: avg(s.midsUpfieldWhenOkSum, s.finalThirdTicks - s.defectFinalThirdTicks),
  }));
  return totals;
}

function parseArgs(argv) {
  const options = { background: 24, standard: 8, seedStart: 22901, standardSeedStart: 22911 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--background") options.background = Number(argv[++index]);
    else if (arg === "--standard") options.standard = Number(argv[++index]);
    else if (arg === "--seed-start") options.seedStart = Number(argv[++index]);
    else if (arg === "--standard-seed-start") options.standardSeedStart = Number(argv[++index]);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const report = {};
if (options.background > 0) {
  const seeds = Array.from({ length: options.background }, (_, i) => options.seedStart + i);
  report.background = summarize(seeds.map((seed) => runMatch(seed, "background")));
}
if (options.standard > 0) {
  const seeds = Array.from({ length: options.standard }, (_, i) => options.standardSeedStart + i);
  report.standard = summarize(seeds.map((seed) => runMatch(seed, "standard")));
}
console.log(JSON.stringify(report, null, 2));
