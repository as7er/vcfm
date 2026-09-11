// Read archived flight lifecycles, including when each side first reacts.
import { readFileSync } from "node:fs";
const label = process.argv[2] || "pass-plan";
const median = (xs) => xs.length ? Number([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(6)) : null;
for (const profile of ["standard", "background"]) {
  const report = JSON.parse(readFileSync(new URL(`../.tmp-continuity/global-movement/defensive-pass/${label}-${profile}.json`, import.meta.url)));
  for (const team of ["home", "away"]) {
    const first = new Map();
    for (const row of report.rows) {
      const key = `${row.seed}:${row.kickTeam}:${row.passAt}`;
      if (row.kickTeam === team && !first.has(key)) first.set(key, row);
    }
    const rows = [...first.values()];
    const ages = rows.map((r) => r.start.t - r.passAt);
    const close = rows.filter((r) => r.end.reason === "defender-control");
    console.log(JSON.stringify({ label, profile, kickTeam: team, passes: rows.length,
      decisionOnKickTick: ages.filter((n) => Math.abs(n) < 1e-7).length,
      medianFirstReaction: median(ages), controlledByRunner: close.length,
      medianInitialGap: median(rows.map((r) => Math.hypot((r.start.player.x - r.start.ball.x) * 0.68,
        (r.start.player.y - r.start.ball.y) * 1.05))),
      medianTimeToControl: median(close.map((r) => r.end.t - r.passAt)) }));
  }
}
