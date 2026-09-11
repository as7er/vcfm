// Recombine all four consecutive 24-seed windows and execute the unchanged
// production report/validation expressions against their exact raw counts.
// This diagnoses sampling variation; it does not replace the failed 24 gate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const [prefix, profile, originalLabel] = process.argv.slice(2);
assert.match(prefix || "", /^[a-z0-9-]+$/);
assert.ok(["standard", "background"].includes(profile));
assert.match(originalLabel || "", /^[a-z0-9-]+$/);
const directory = new URL("../.tmp-continuity/global-movement/checks/", import.meta.url);
const hash = (value) => createHash("sha256").update(value).digest("hex");
function objects(text) {
  const result = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") continue;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < text.length; end++) {
      const c = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        result.push(JSON.parse(text.slice(start, end + 1))); start = end; break;
      }
    }
  }
  return result;
}
function read(label) {
  const meta = JSON.parse(readFileSync(new URL(`${label}.json`, directory), "utf8"));
  const stdout = readFileSync(new URL(`${label}.log`, directory));
  assert.equal(hash(stdout), meta.stdoutSha256);
  const reports = objects(stdout.toString("utf8"));
  return { meta, report: reports.find((r) => r.perMatch),
    candidateHashes: Object.fromEntries(reports.flatMap((r) => Object.entries(r)
      .filter(([k, v]) => k.endsWith("Candidate") && v.loadedEngineSha256)
      .map(([k, v]) => [k, v.loadedEngineSha256]))) };
}
function add(into, value) {
  if (typeof value === "number") return (into || 0) + value;
  if (Array.isArray(value)) return [...(into || []), ...value];
  const out = { ...(into || {}) };
  for (const [key, next] of Object.entries(value)) out[key] = add(out[key], next);
  return out;
}
const baseline = read(originalLabel);
const windows = [0, 24, 48, 72].map((offset) => read(`${prefix}-${profile}-${offset}`));
const auditBytes = readFileSync(new URL("./match-realism-audit.mjs", import.meta.url));
const originalAuditSha256 = hash(auditBytes);
const audit = auditBytes.toString("utf8").replaceAll("\r\n", "\n");
let combined;
for (let i = 0; i < windows.length; i++) {
  const window = windows[i];
  const raw = window.report?.rawSample;
  assert.ok(raw);
  assert.equal(raw.offset, i * 24);
  assert.equal(raw.originalAuditSha256, originalAuditSha256);
  assert.equal(window.report.simulationProfile, profile);
  assert.equal(window.report.equalMatches, 24);
  assert.equal(window.report.strongVsWeak.matches, 24);
  assert.deepEqual(window.candidateHashes, baseline.candidateHashes);
  assert.equal(window.meta.sourceHash, baseline.meta.sourceHash);
  assert.equal(window.meta.sourceHashAfter, window.meta.sourceHash);
  const { offset, originalAuditSha256: unused, ...counts } = raw;
  combined = add(combined, counts);
}
const { rawSample, ...firstReport } = windows[0].report;
assert.deepEqual(firstReport, baseline.report, "the first window must reproduce the original failed 24-seed run");
const failures = [];
let report;
const context = { ...combined, assert: {
  ok: (value, message) => { if (!value) failures.push(message); },
  equal: (a, b, message) => { if (a !== b) failures.push(message); },
}, matches: 96, strongMatches: 96, equalOnly: false, simulationProfile: profile,
  timeStep: profile === "background" ? 0.3 : 0.1, separationPasses: profile === "background" ? 4 : 8,
  console: { log: (text) => { report = JSON.parse(text); } } };
const start = audit.indexOf("const perMatch = (value)");
assert.ok(start > 0);
runInNewContext(audit.slice(start), context, { timeout: 1000 });
assert.ok(report);
// The production 96-run skips these 24-reference-only budget checks. Retain
// them here as an additional constraint, using the production expressions.
if (profile === "background") {
  const begin = audit.indexOf("if (report.profileDelta) {\n  const delta");
  const finish = audit.indexOf("\n// 同一组容差", begin);
  assert.ok(begin > 0 && finish > begin);
  runInNewContext(audit.slice(begin, finish).replace("if (report.profileDelta)", "if (true)"),
    { report, assert: context.assert }, { timeout: 1000 });
}
console.log(JSON.stringify({ ...report, diagnosticOnly: true, originalAuditSha256,
  sourceHash: baseline.meta.sourceHash, candidateHashes: baseline.candidateHashes,
  seedWindow: { equalFirst: 165000, equalLast: 165095, strongFirst: 265000, strongLast: 265095 },
  firstWindowReproducesOriginal: true,
  original24: { label: originalLabel, exitCode: baseline.meta.exitCode,
    perMatch: baseline.report.perMatch, strongVsWeak: baseline.report.strongVsWeak },
  shards: windows.map(({ meta, report }) => ({ label: meta.label, exitCode: meta.exitCode,
    offset: report.rawSample.offset, stdoutSha256: meta.stdoutSha256 })),
  failures,
}, null, 2));
assert.deepEqual(failures, [], "expanded sample left one or more unchanged realism bounds");
