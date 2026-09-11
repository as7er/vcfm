// Read the preserved shot observations; do not replay or select new seeds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const path = process.argv[2];
assert.ok(path, "provide an archived shot-chain JSON");
const bytes = readFileSync(path);
const report = JSON.parse(bytes);
function firstReport(path) {
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("{");
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error(`missing report: ${path}`);
}
let observerIntegrity = null;
if (process.argv[3] || process.argv[4]) {
  assert.ok(process.argv[3] && process.argv[4], "provide both traced sample logs");
  const observed = firstReport(process.argv[3]).shotSamples;
  const unobserved = firstReport(process.argv[4]).shotSamples;
  assert.equal(observed.profile, unobserved.profile);
  assert.ok(observed.matches.every((m) => m.framesHash && m.stateValueHash));
  const values = (matches) => matches.map(({ stateHash, ...m }) => m);
  assert.deepEqual(values(observed.matches), values(unobserved.matches));
  observerIntegrity = { identicalValues: true, profile: observed.profile,
    matches: values(observed.matches), binaryEncodingEqual: observed.matches.every((m, i) =>
      m.stateHash === unobserved.matches[i].stateHash) };
}
const round = (n) => Number.isFinite(n) ? Number(n.toFixed(6)) : null;
function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { n: sorted.length, mean: round(sorted.reduce((s, n) => s + n, 0) / sorted.length),
    p50: round(sorted[Math.floor((sorted.length - 1) * 0.5)]),
    p90: round(sorted[Math.floor((sorted.length - 1) * 0.9)]), max: round(sorted.at(-1)) };
}
const attempts = report.records.flatMap((shot) => shot.keeperAttempts.map((a) => ({
  shot: shot.id, match: shot.match, at: shot.at, outcome: shot.outcome, inFrame: shot.targetInFrame,
  reactionTime: a.reactionTime, actualTime: a.contactAt - a.shotAt,
  excess: a.reactionTime - (a.contactAt - a.shotAt), probability: a.pSave,
  height: a.z, distance: shot.distanceMetres,
})));
assert.ok(attempts.length);
assert.ok(attempts.every((a) => Number.isFinite(a.actualTime) && Number.isFinite(a.excess)));
console.log(JSON.stringify({ path, sha256: createHash("sha256").update(bytes).digest("hex"),
  observerIntegrity,
  engineSha256: report.engineBeforeObserverSha256, shots: report.records.length, attempts: attempts.length,
  overcount: attempts.filter((a) => a.excess > 1e-8).length,
  undercount: attempts.filter((a) => a.excess < -1e-8).length,
  reactionSeconds: stats(attempts.map((a) => a.reactionTime)),
  availableSeconds: stats(attempts.map((a) => a.actualTime)),
  excessSeconds: stats(attempts.map((a) => a.excess)),
  largestOvercounts: [...attempts].sort((a, b) => b.excess - a.excess).slice(0, 5),
}, null, 2));
