// Read actual recorded decisions; do not replay alternative choices.
import { readFileSync } from "node:fs";
const directory = new URL("../.tmp-continuity/global-movement/box-flow/", import.meta.url);
for (const name of process.argv.slice(2)) {
  const { decisions } = JSON.parse(readFileSync(new URL(`${name}.json`, directory)));
  const result = { name, initiated: 0, pending: 0, continued: 0, released: 0, reversed: 0, retargeted: 0, examples: [] };
  for (const row of decisions) {
    const a = row.owner, previous = a.intent, next = row.after;
    const dir = a.team === "home" ? -1 : 1, targetY = a.team === "home" ? 14 : 86;
    if (next?.type === "dribble" && Math.abs(next.ty - targetY) < 1e-8 &&
        Math.abs(a.y - (a.team === "home" ? 0 : 100)) < 5.5 && Math.abs(a.x - 50) > 8) result.initiated++;
    if (previous?.type !== "dribble" || Math.abs(previous.ty - targetY) > 1e-8) continue;
    const gap = Math.hypot((previous.tx - a.x) * 0.68, (previous.ty - a.y) * 1.05);
    if (gap <= 1.5) continue;
    result.pending++;
    if (["prepare", "pass", "shot"].includes(row.action)) { result.released++; continue; }
    if (next?.type !== "dribble") continue;
    if ((next.ty - a.y) * dir > 0) {
      result.reversed++;
      if (result.examples.length < 4) result.examples.push({ seed: row.seed, t: row.t, ownerId: a.id,
        position: [a.x, a.y], previous, next, remainingMetres: gap });
    } else if (next.tx === previous.tx && next.ty === previous.ty) result.continued++;
    else result.retargeted++;
  }
  console.log(JSON.stringify(result));
}
