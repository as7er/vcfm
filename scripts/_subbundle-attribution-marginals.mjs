// Turn a sub-bundle attribution ladder into a marginal-contribution table.
//
// Reads the logs produced by `_subbundle-attribution-ladder.mjs` and prints,
// for every rung, the distance-binned shot counts plus the *marginal* change
// versus the previous rung. Because the rungs are prefixes of the real load
// order, the marginals telescope exactly to the bundle total, so the column
// "adds under16" answers "how many of the lost close-range shots does this
// layer own".
//
// Usage:
//   node scripts/_subbundle-attribution-marginals.mjs <ladder.json | dir> [profile] [matches]
//
// Also prints a noise yardstick: the per-bin standard error implied by the
// audit's own per-match shot spread, so a marginal that is smaller than the
// yardstick is not claimed as an effect.

import fs from "node:fs";
import path from "node:path";

const BIN_ORDER = ["under16", "16to22", "22to30", "30plus"];

function findReport(text) {
  const cleaned = text.replace(/^\[pin-engine-revision\][^\n]*\n/, "");
  let depth = 0;
  let start = -1;
  for (let k = 0; k < cleaned.length; k += 1) {
    const ch = cleaned[k];
    if (ch === "{") {
      if (depth === 0) start = k;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const slice = cleaned.slice(start, k + 1);
        if (slice.includes('"distance"') && slice.includes('"perMatch"')) {
          try {
            return JSON.parse(slice);
          } catch {
            /* keep scanning */
          }
        }
        start = -1;
      }
    }
  }
  return null;
}

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/_subbundle-attribution-marginals.mjs <ladder.json | dir> [profile] [matches]");
  process.exit(2);
}

let dir = target;
let profile = process.argv[3] || "standard";
let matches = Number(process.argv[4]) || 24;
if (fs.existsSync(target) && fs.statSync(target).isFile()) {
  const spec = JSON.parse(fs.readFileSync(target, "utf8"));
  profile = spec.profile;
  matches = spec.matches;
  dir = path.dirname(target);
}

const names = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(`-${profile}${matches}.log`))
  .map((f) => f.replace(`-${profile}${matches}.log`, ""))
  .sort((a, b) => Number(a.slice(1).split("-")[0]) - Number(b.slice(1).split("-")[0]));

// A ladder whose rungs do not include the bare baseline (e.g. the pass-chain
// ladder, whose first rung is already a patch) can borrow one from elsewhere
// with BASELINE_LOG=<path>. It is prepended as rung 0 so every rung still gets
// a marginal against the true baseline.
let borrowed = null;
const baselineLog = process.env.BASELINE_LOG;
if (baselineLog) {
  const report = findReport(fs.readFileSync(baselineLog, "utf8"));
  if (!report) throw new Error(`BASELINE_LOG has no audit report: ${baselineLog}`);
  const bins = {};
  let shots = 0;
  let goals = 0;
  for (const b of BIN_ORDER) {
    const cell = report.distance?.[b] ?? { shots: 0, goals: 0 };
    bins[b] = { shots: cell.shots, goals: cell.goals };
    shots += cell.shots;
    goals += cell.goals;
  }
  const name = path.basename(baselineLog).replace(`-${profile}${matches}.log`, "");
  borrowed = { name: `${name} [borrowed baseline]`, bins, shots, goals };
}

const rungs = [];
for (const name of names) {
  const report = findReport(fs.readFileSync(path.join(dir, `${name}-${profile}${matches}.log`), "utf8"));
  if (!report) {
    console.log(`!! ${name}: no audit report`);
    continue;
  }
  const bins = {};
  let shots = 0;
  let goals = 0;
  for (const b of BIN_ORDER) {
    const cell = report.distance?.[b] ?? { shots: 0, goals: 0 };
    bins[b] = { shots: cell.shots, goals: cell.goals };
    shots += cell.shots;
    goals += cell.goals;
  }
  rungs.push({
    name,
    bins,
    shots,
    goals,
    goalsPerMatch: report.perMatch?.goals,
    shotsPerMatch: report.perMatch?.shots,
    outsideBox: report.outsideBoxSharePct,
    exit: null,
  });
}

if (rungs.length === 0) {
  console.log(`no ladder logs found in ${dir} for ${profile} ${matches}`);
  process.exit(1);
}

if (borrowed) rungs.unshift(borrowed);

const base = rungs[0];
console.log(`ladder: ${path.relative(process.cwd(), dir).replace(/\\/g, "/")}  profile=${profile} matches=${matches}`);
console.log(`baseline rung = ${base.name} (${base.shots} shots / ${base.goals} goals)\n`);

const header =
  `${"rung".padEnd(28)} ${BIN_ORDER.map((b) => b.padStart(9)).join("")} ${"total".padStart(8)} ${"goals".padStart(7)}` +
  `  |  ${BIN_ORDER.map((b) => `d${b}`.padStart(9)).join("")} ${"dTotal".padStart(8)} ${"dGoals".padStart(7)}`;
console.log(header);
console.log("-".repeat(header.length));

for (const rung of rungs) {
  const i = rungs.indexOf(rung);
  const prev = i === 0 ? base : rungs[i - 1];
  const cells = BIN_ORDER.map((b) => String(rung.bins[b].shots).padStart(9)).join("");
  const dcells = BIN_ORDER.map((b) => String(rung.bins[b].shots - prev.bins[b].shots).padStart(9)).join("");
  console.log(
    `${rung.name.padEnd(28)} ${cells} ${String(rung.shots).padStart(8)} ${String(rung.goals).padStart(7)}` +
      `  |  ${dcells} ${String(rung.shots - prev.shots).padStart(8)} ${String(rung.goals - prev.goals).padStart(7)}`,
  );
}

console.log("");
console.log("per-rung detail");
for (const rung of rungs) {
  console.log(
    `  ${rung.name.padEnd(28)} shots/match=${rung.shotsPerMatch} goals/match=${rung.goalsPerMatch} outsideBox=${rung.outsideBox}%`,
  );
}

const last = rungs[rungs.length - 1];
console.log("");
console.log(
  `bundle total: shots ${last.shots - base.shots}, goals ${last.goals - base.goals} ` +
    `(under16 ${last.bins.under16.shots - base.bins.under16.shots}, ` +
    `16to22 ${last.bins["16to22"].shots - base.bins["16to22"].shots}, ` +
    `22to30 ${last.bins["22to30"].shots - base.bins["22to30"].shots})`,
);

// The audit declares a frozen tolerance of +-3 shots/match on the aggregate,
// i.e. +-3*matches on a run of this length. A marginal below that is not
// claimed as an effect: the paired design should be tighter than this, but the
// project's own declared yardstick is the only noise scale that is already
// agreed on, so use it as the conservative bar.
const declaredPerMatch = 3;
const yardstick = declaredPerMatch * matches;
console.log("");
console.log(`noise yardstick (audit's own declared shots tolerance): +-${declaredPerMatch}/match = +-${yardstick} over ${matches} matches`);
const marginals = rungs.slice(1).map((r, i) => ({ name: r.name, d: r.shots - rungs[i].shots }));
const over = marginals.filter((m) => Math.abs(m.d) >= yardstick);
console.log(
  over.length === 0
    ? "  no rung's marginal reaches the yardstick"
    : `  rungs whose marginal reaches the yardstick: ${over.map((m) => `${m.name} ${m.d}`).join(", ")}`,
);

