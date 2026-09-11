// Archive the entire investigation, including rejected candidates and failures.
// This deliberately does not read or overwrite the completed v253 archive.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const directory = new URL(".tmp-continuity/global-movement/", root);
const checks = new URL("checks/", directory);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
        try { result.push(JSON.parse(text.slice(start, end + 1))); start = end; } catch {}
        break;
      }
    }
  }
  return result;
}
const runs = [];
for (const name of readdirSync(checks).filter((name) => name.endsWith(".json")).sort()) {
  const metadata = JSON.parse(readFileSync(new URL(name, checks), "utf8"));
  const stdout = readFileSync(new URL(`${metadata.label}.log`, checks));
  const stderr = readFileSync(new URL(`${metadata.label}.err.log`, checks));
  assert.equal(hash(stdout), metadata.stdoutSha256, `${metadata.label}: stdout changed`);
  assert.equal(hash(stderr), metadata.stderrSha256, `${metadata.label}: stderr changed`);
  runs.push({ ...metadata, stdoutFile: `.tmp-continuity/global-movement/checks/${metadata.label}.log`,
    stderrFile: `.tmp-continuity/global-movement/checks/${metadata.label}.err.log`,
    reports: objects(stdout.toString("utf8")), error: stderr.toString("utf8").trim() || null,
    tail: stdout.toString("utf8").slice(-3000) });
}
const observations = [];
for (const folder of ["", "byline/", "box-flow/", "defense-flow/", "reception-path/", "defensive-pass/", "strength/"]) {
  const location = new URL(folder, directory);
  if (!existsSync(location)) continue;
  for (const name of readdirSync(location).filter((name) => name.endsWith(".json")).sort()) {
    const bytes = readFileSync(new URL(name, location));
    const report = JSON.parse(bytes.toString("utf8"));
    if (report.summary) observations.push({ file: `.tmp-continuity/global-movement/${folder}${name}`,
      sha256: hash(bytes), summary: report.summary });
  }
}
// Shot snapshots live in their established directory. Keep their raw JSON and
// binary state hashes with this investigation when one of its checks made them.
const shotArtifacts = [];
const shotLabels = new Set(runs.flatMap((run) => run.reports
  .filter((report) => report.shotChain?.label).map((report) => report.shotChain.label)));
for (const label of shotLabels) {
  assert.match(label, /^[a-zA-Z0-9-]+$/);
  const artifacts = {};
  for (const extension of ["json", "bin"]) {
    const path = `.tmp-continuity/shot-chain/${label}.${extension}`;
    const bytes = readFileSync(new URL(path, root));
    artifacts[extension] = { file: path, sha256: hash(bytes), bytes: bytes.length };
  }
  shotArtifacts.push({ label, artifacts });
}
const paths = new Set(["js/sim/engine.js", "js/data.js", "js/player-positions.js", "scripts/verify.mjs",
  "scripts/match-realism-audit.mjs", "scripts/box-defending-audit.mjs", "scripts/box-possession-sampling-audit.mjs",
  "scripts/match-motion-integrity-audit.mjs", "scripts/corner-structure-audit.mjs", "scripts/offside-event-integrity-audit.mjs",
  "scripts/_archive-global-movement.mjs", "scripts/_global-movement-check.mjs", "scripts/_v253-baseline.mjs",
  "scripts/_box-flow-analysis.mjs",
  "sw.js", "index.html", "js/main.js"]);
for (const run of runs) for (const path of Object.keys(run.entryHashes)) paths.add(path.replace(/^\.\//, ""));
// Follow candidate imports so a combined preload does not conceal its effective inputs.
for (const path of paths) {
  if (!path.startsWith("scripts/") || !existsSync(new URL(path, root))) continue;
  const source = readFileSync(new URL(path, root), "utf8");
  for (const match of source.matchAll(/import\s+"\.\/([^"\n]+\.mjs)"/g)) paths.add(`scripts/${match[1]}`);
}
const files = Object.fromEntries([...paths].filter((path) => existsSync(new URL(path, root))).sort().map((path) => [path, {
  sha256: hash(readFileSync(new URL(path, root))),
  gitBlob: execFileSync("git", ["hash-object", path], { cwd: fileURLToPath(root), encoding: "utf8", windowsHide: true }).trim(),
}]));
const evidence = { createdAt: new Date().toISOString(), baselineGit: "5f1d152", finalValidation: null,
  files, runs, observations, shotArtifacts };
const destination = new URL("docs/evidence/", root);
mkdirSync(destination, { recursive: true });
writeFileSync(new URL("match-global-movement-2026-09-10.json", destination), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ runs: runs.length, observations: observations.length,
  shotArtifacts: shotArtifacts.length, finalValidation: evidence.finalValidation }));
for (const run of runs) {
  const report = run.reports.find((r) => r.perMatch && r.shotConversionPct != null);
  if (!report) continue;
  console.log(JSON.stringify({ label: run.label, exitCode: run.exitCode, profile: report.simulationProfile,
    matches: report.equalMatches, goals: report.perMatch.goals, shots: report.perMatch.shots,
    conversion: report.shotConversionPct, completion: report.passCompletionPct, crosses: report.crossSharePct,
    strongPoints: report.strongVsWeak?.pointsPerMatch, delta: report.referenceDelta,
    failure: run.error?.match(/AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/)?.[1] || null }));
}
