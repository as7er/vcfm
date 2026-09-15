// Extract the distance-binned shot table from one or more captured audit logs.
//
// The realism audit prints a large JSON report somewhere in stdout, optionally
// preceded by candidate-loader lines and/or a [pin-engine-revision] line. This
// helper finds that report, prints the headline numbers, and prints the
// per-bin shots/goals so a ladder of runs can be compared side by side.
//
// Usage:
//   node scripts/_audit-log-bins.mjs <log> [<log> ...]
//
// Prints, per log: profile, matches, goals/match, conversion, outside-box
// share, and the four distance bins with shots / goals / conversion.

import fs from "node:fs";

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

const BIN_ORDER = ["under16", "16to22", "22to30", "30plus"];

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/_audit-log-bins.mjs <log> [...]");
  process.exit(2);
}

const rows = [];
for (const file of files) {
  const report = findReport(fs.readFileSync(file, "utf8"));
  if (!report) {
    console.log(`${file}\n  !! no audit report found\n`);
    continue;
  }
  const label = file.split(/[\\/]/).pop().replace(/\.log$/, "");
  console.log(`${label}`);
  console.log(
    `  profile=${report.simulationProfile} dt=${report.timeStep} sep=${report.separationPasses} ` +
      `equalMatches=${report.equalMatches}`,
  );
  console.log(
    `  goals/match=${report.perMatch.goals} shots/match=${report.perMatch.shots} ` +
      `conversion=${report.shotConversionPct}% outsideBox=${report.outsideBoxSharePct}%`,
  );
  let totalShots = 0;
  let totalGoals = 0;
  for (const bin of BIN_ORDER) {
    const cell = report.distance?.[bin];
    if (!cell) continue;
    totalShots += cell.shots;
    totalGoals += cell.goals;
    const conv = cell.shots ? ((100 * cell.goals) / cell.shots).toFixed(1) : "0.0";
    console.log(
      `    ${bin.padEnd(7)} shots=${String(cell.shots).padStart(4)} ` +
        `goals=${String(cell.goals).padStart(3)} conv=${conv}%`,
    );
  }
  console.log(`    TOTAL   shots=${totalShots} goals=${totalGoals}`);
  rows.push({
    label,
    profile: report.simulationProfile,
    shots: totalShots,
    goals: totalGoals,
    bins: Object.fromEntries(
      BIN_ORDER.map((b) => [b, report.distance?.[b] ? { ...report.distance[b] } : null]),
    ),
  });
  console.log("");
}

if (rows.length > 1) {
  const base = rows[0];
  console.log("delta vs first row");
  console.log(
    `  ${"run".padEnd(34)} ${BIN_ORDER.map((b) => b.padStart(9)).join("")} ${"total".padStart(9)} ${"goals".padStart(7)}`,
  );
  for (const row of rows) {
    const cells = BIN_ORDER.map((b) => {
      const a = base.bins[b]?.shots ?? 0;
      const c = row.bins[b]?.shots ?? 0;
      return String(c - a).padStart(9);
    });
    console.log(
      `  ${row.label.padEnd(34)} ${cells.join("")} ${String(row.shots - base.shots).padStart(9)} ` +
        `${String(row.goals - base.goals).padStart(7)}`,
    );
  }
}
