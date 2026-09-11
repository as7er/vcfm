// Compact readout of already recorded experiments; never replays a match.
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("../.tmp-continuity/global-movement/", import.meta.url);
const labels = process.argv.slice(2);
for (const name of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
  const report = JSON.parse(readFileSync(new URL(name, directory), "utf8"));
  if (!report.summary || (labels.length && !labels.includes(report.summary.label))) continue;
  const s = report.summary;
  console.log(JSON.stringify({ file: name, historical: s.buckets["historical-final-third"],
    held: s.buckets["live-final:held"], collective: s.collective }));
  if (labels.length === 1) {
    console.log(JSON.stringify({ buckets: Object.fromEntries(Object.entries(s.buckets)
      .filter(([key]) => key.startsWith("attack:") || key.startsWith("target:"))) }));
    const examples = report.examples.filter((row) => row.open === 0).slice(0, 3);
    for (const row of examples) {
      const owner = row.players.find((p) => p.id === row.ball.owner);
      console.log(JSON.stringify({ seed: row.seed, t: row.t, ball: { x: row.ball.x, y: row.ball.y },
        plan: row.plan, owner: owner?.id, players: row.players.filter((p) => p.team === owner?.team)
          .map((p) => ({ id: p.id, role: p.role, position: [p.x, p.y].map((n) => +n.toFixed(2)),
            target: [p.tx, p.ty].map((n) => +n.toFixed(2)), kind: p.kind || p.fsm,
            speed: +Math.hypot(p.vx * 0.68, p.vy * 1.05).toFixed(2) })) }));
    }
  }
}
