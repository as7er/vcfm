// Preserve all successes and failures from the support-offer continuation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const directory = new URL(".tmp-continuity/support-offer/", root);
const hash = (data) => createHash("sha256").update(data).digest("hex");
function objects(text) {
  const result = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
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
for (const name of readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
  const metadata = JSON.parse(readFileSync(new URL(name, directory), "utf8"));
  if (!Array.isArray(metadata.args) || !metadata.label) continue;
  const stdout = readFileSync(new URL(`${metadata.label}.log`, directory));
  const stderr = readFileSync(new URL(`${metadata.label}.err.log`, directory));
  assert.equal(hash(stdout), metadata.stdoutSha256, `${metadata.label}: stdout evidence changed`);
  assert.equal(hash(stderr), metadata.stderrSha256, `${metadata.label}: stderr evidence changed`);
  runs.push({ ...metadata, stdoutFile: `.tmp-continuity/support-offer/${metadata.label}.log`,
    stderrFile: `.tmp-continuity/support-offer/${metadata.label}.err.log`,
    reports: objects(stdout.toString("utf8")), error: stderr.toString("utf8").trim() || null,
    tail: stdout.toString("utf8").slice(-3000) });
}
const observations = [];
for (const name of readdirSync(new URL(".tmp-continuity/", root)).filter((name) =>
  /^(support-availability-|support-offer-trace-|support-defense-|support-space-).*\.json$/.test(name)).sort()) {
  const bytes = readFileSync(new URL(`.tmp-continuity/${name}`, root));
  const data = JSON.parse(bytes.toString("utf8"));
  observations.push({ file: `.tmp-continuity/${name}`, sha256: hash(bytes), summary: data.summary });
}
const visuals = [];
for (const run of runs.filter((run) => run.args.includes("scripts/match-continuity-browser.mjs"))) {
  for (const output of new Set(run.reports.map((report) => report.out).filter(Boolean))) {
    const folder = relative(fileURLToPath(root), output).replaceAll("\\", "/");
    assert.match(folder, /^\.tmp-continuity\/visual-\d+$/, "browser evidence must stay in its capture directory");
    const url = new URL(`${folder}/`, root);
    const artifacts = readdirSync(url).filter((name) => /\.(?:png|json)$/.test(name)).sort().map((name) => ({
      file: `${folder}/${name}`, sha256: hash(readFileSync(new URL(name, url))),
    }));
    const reportUrl = new URL("report.json", url);
    const report = existsSync(reportUrl) ? JSON.parse(readFileSync(reportUrl, "utf8")) : null;
    const failureUrl = new URL("calendar-failure.json", url);
    visuals.push({ label: run.label, folder, artifacts,
      report: report ? { completed: report.completed, halfTime: report.halfTime, captures: report.captures,
        errors: report.errors, clock: report.clock, motion: report.motion,
        stats: Object.fromEntries(["frames", "movingFrames", "cuts", "contacts", "maxRefSpeed", "violations"]
          .map((key) => [key, report.stats[key]])) } : null,
      calendarFailure: existsSync(failureUrl) ? JSON.parse(readFileSync(failureUrl, "utf8")) : null,
    });
  }
}
const paths = ["js/sim/engine.js", "scripts/match-realism-audit.mjs", "scripts/box-possession-sampling-audit.mjs",
  "scripts/box-defending-audit.mjs", "scripts/defensive-plan-state-audit.mjs",
  "scripts/support-offer-audit.mjs", "scripts/_support-availability-probe.mjs", "scripts/_support-offer-trace.mjs",
  "scripts/_support-offer-candidate.mjs", "scripts/_support-offer-context-candidate.mjs",
  "scripts/_support-offer-lateral-candidate.mjs", "scripts/_support-offer-minimal-candidate.mjs",
  "scripts/_support-offer-dynamic-candidate.mjs", "scripts/_support-offer-lease-candidate.mjs",
  "scripts/_support-offer-run-route-candidate.mjs", "scripts/_support-defense-probe.mjs",
  "scripts/_support-offer-screen-candidate.mjs", "scripts/_support-offer-shadow-candidate.mjs",
  "scripts/_support-offer-defensive-angle-candidate.mjs", "scripts/press-shadow-geometry-audit.mjs",
  "scripts/_support-offer-physical-candidate.mjs", "scripts/_support-offer-defense-state-candidate.mjs",
  "scripts/_support-offer-space-candidate.mjs", "scripts/_support-offer-space-probe.mjs",
  "scripts/_support-offer-space-fallback-candidate.mjs", "scripts/_support-offer-actual-distance-candidate.mjs",
  "scripts/_support-offer-equivalence.mjs", "scripts/_v252-baseline.mjs", "scripts/_record-check.mjs",
  "scripts/_archive-support-offers.mjs", "scripts/match-continuity-browser.mjs",
  "scripts/_final-third-movement-calibration-probe.mjs", "scripts/match-motion-integrity-audit.mjs",
  "scripts/corner-structure-audit.mjs", "scripts/offside-event-integrity-audit.mjs",
  "scripts/verify.mjs", "sw.js", "index.html", "js/main.js"];
const files = Object.fromEntries(paths.filter((path) => existsSync(new URL(path, root))).map((path) => [path, {
  sha256: hash(readFileSync(new URL(path, root))),
  gitBlob: execFileSync("git", ["hash-object", path], {
    cwd: fileURLToPath(root), encoding: "utf8", windowsHide: true,
  }).trim(),
}]));
const baselineGit = "468816e37effa7139fb2bd28d543d0f7d2ed6413";
const requiredLabels = ["offer-final-controlled", "offer-final-defense-state", "offer-final-angles",
  "offer-final-equivalence", "offer-final-verify-full", "offer-final-standard96", "offer-final-background96",
  "offer-final-trace-standard", "offer-final-trace-background", "offer-final-availability-standard",
  "offer-final-availability-background", "offer-final-final-third", "offer-final-browser-retry",
  "offer-final-box-background"];
const finalValidation = process.argv.includes("--final") ? {
  engineSha256: files["js/sim/engine.js"].sha256,
  engineGitBlob: files["js/sim/engine.js"].gitBlob,
  requiredLabels,
  unchangedGuards: ["scripts/match-realism-audit.mjs", "scripts/box-possession-sampling-audit.mjs",
    "scripts/box-defending-audit.mjs", "scripts/match-motion-integrity-audit.mjs",
    "scripts/corner-structure-audit.mjs", "scripts/offside-event-integrity-audit.mjs"],
} : null;
if (finalValidation) {
  for (const label of requiredLabels) {
    const run = runs.find((entry) => entry.label === label);
    assert.ok(run, `${label}: final run is missing or unfinished`);
    assert.equal(run.exitCode, 0, `${label}: final run failed`);
    assert.equal(run.sourceHash, finalValidation.engineSha256, `${label}: wrong engine version`);
    assert.equal(run.sourceHashAfter, finalValidation.engineSha256, `${label}: engine changed during the run`);
    for (const [path, expected] of Object.entries(run.entryHashes)) {
      assert.equal(hash(readFileSync(new URL(path, root))), expected, `${label}: entry changed after verification`);
    }
  }
  const full = runs.find((run) => run.label === "offer-final-verify-full");
  assert.ok(full.tail.trimEnd().endsWith("VCFM verification passed"), "full verification did not finish");
  for (const path of finalValidation.unchangedGuards) {
    const original = execFileSync("git", ["rev-parse", `${baselineGit}:${path}`], {
      cwd: fileURLToPath(root), encoding: "utf8", windowsHide: true,
    }).trim();
    assert.equal(files[path].gitBlob, original, `${path}: original guard or frozen reference changed`);
  }
}
const evidence = { createdAt: new Date().toISOString(), baselineGit,
  finalValidation, files, runs, observations, visuals,
  interpretation: "Every recorded attempt is retained. A passed observation probe proves determinism only for its explicitly compared first match. Repeated post-holder-change commits are distinct from holder-transition counts. Failure of any release guard remains a failure." };
mkdirSync(new URL("docs/evidence/", root), { recursive: true });
const output = new URL("docs/evidence/match-support-offers-2026-09-10.json", root);
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ output: fileURLToPath(output), runs: runs.length, observations: observations.length,
  visuals: visuals.length, finalValidation: !!finalValidation,
  successes: runs.filter((run) => run.exitCode === 0).length,
  failures: runs.filter((run) => run.exitCode !== 0).length, sha256: hash(readFileSync(output)) }));
