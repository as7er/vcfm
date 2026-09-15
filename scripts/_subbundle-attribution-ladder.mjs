// Sub-bundle attribution ladder for the global-movement candidate bundle.
//
// The bundle `_backline-support-release-candidate.mjs` is a chain of 29 smaller
// candidate modules, so "the movement candidate costs us 108 shots" is not an
// attribution — it is a description of the whole chain. This runner walks the
// chain in its real load order and measures a prefix at every step, so the
// difference between two consecutive steps is the marginal contribution of the
// layer added in between, and the differences telescope to the bundle total.
//
// Every step runs against `_v253-baseline.mjs` so the pairing object is always
// "v253 vs v253 + prefix". Rung P0 is the bare v253 baseline. The last rung is
// the whole bundle and must reproduce the already-recorded bundle result
// (standard 24: 627 shots / 53 goals) — that reproduction is the ladder's own
// correctness check.
//
// Rungs are independent processes, so they run with a small worker pool.
//
// Usage:
//   node scripts/_subbundle-attribution-ladder.mjs [standard|background] [matches] [outDir]
//
// Env:
//   LADDER_JOBS  concurrent rungs (default 3; each run is single-threaded and
//                memory-hungry, so do not raise this much on a 6-core box).
//   LADDER_ONLY  comma-separated rung prefixes to run, e.g. "P0,P5,P9".
//
// Writes one log per step into outDir (default .tmp-continuity/subbundle-attribution).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const profile = process.argv[2] === "background" ? "background" : "standard";
const matches = Math.max(8, Number(process.argv[3]) || 24);
const outDir = path.resolve(ROOT, process.argv[4] || ".tmp-continuity/subbundle-attribution");
const jobs = Math.max(1, Number(process.env.LADDER_JOBS) || 3);
const only = process.env.LADDER_ONLY
  ? new Set(process.env.LADDER_ONLY.split(",").map((s) => s.trim()).filter(Boolean))
  : null;

// Load order of the bundle, from the bare baseline to the root. Each entry is
// the module Node would have executed last at that point in the closure, so a
// rung's closure is exactly the prefix of the real bundle load order.
//
// LADDER_SET=bundle   top-level chain (default)
// LADDER_SET=passchain  the inside of rung P2, which is where the shot loss
//                      turned out to live: the pass-value / interception-risk /
//                      defensive-pass chain, one module per rung so every patch
//                      in that chain gets its own marginal.
//
// Careful: `_pass-risk-value-candidate.mjs` does NOT import
// `_coordinated-movement-candidate.mjs`, so a "passchain" rung is the pass
// chain alone, on the bare v253 baseline — it is not nested under the movement
// rung. Both ladders therefore start from their own baseline rung.
const LADDERS = {
  bundle: [
    ["P0-v253-baseline", null],
    ["P1-coordinated-movement", "_coordinated-movement-candidate.mjs"],
    ["P2-coordinated-pass-value", "_coordinated-pass-value-candidate.mjs"],
    ["P3-backline-pass", "_backline-pass-candidate.mjs"],
    ["P4-backline-pass-tracking", "_backline-pass-tracking-candidate.mjs"],
    ["P5-backline-flight", "_backline-flight-candidate.mjs"],
    ["P6-backline-release", "_backline-release-candidate.mjs"],
    ["P7-backline-contact-clock", "_backline-contact-clock-candidate.mjs"],
    ["P8-backline-contact-height", "_backline-contact-height-candidate.mjs"],
    ["P9-full-bundle", "_backline-support-release-candidate.mjs"],
  ],
  passchain: [
    ["Q0-v253-baseline", null],
    ["Q1-defensive-pass-arrival", "_defensive-pass-arrival-candidate.mjs"],
    ["Q2-defensive-pass-plan", "_defensive-pass-plan-candidate.mjs"],
    ["Q3-defensive-pass-momentum", "_defensive-pass-momentum-candidate.mjs"],
    ["Q4-defensive-pass-lifetime", "_defensive-pass-lifetime-candidate.mjs"],
    ["Q5-defensive-pass-release", "_defensive-pass-release-candidate.mjs"],
    ["Q6-pass-interception-risk", "_pass-interception-risk-candidate.mjs"],
    ["Q7-pass-risk-value", "_pass-risk-value-candidate.mjs"],
  ],
};

const ladderSet = process.env.LADDER_SET || "bundle";
const LADDER = LADDERS[ladderSet];
if (!LADDER) throw new Error(`unknown LADDER_SET ${ladderSet}; expected one of ${Object.keys(LADDERS).join(", ")}`);

const rungs = only ? LADDER.filter(([name]) => only.has(name.split("-")[0])) : LADDER;
if (rungs.length === 0) throw new Error("LADDER_ONLY matched no rungs");

fs.mkdirSync(outDir, { recursive: true });

function runRung([name, module]) {
  return new Promise((resolve) => {
    const args = ["--import", "./scripts/_v253-baseline.mjs"];
    if (module) args.push("--import", `./scripts/${module}`);
    args.push("scripts/match-realism-audit.mjs", String(matches), profile);
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => {
      const seconds = (Date.now() - started) / 1000;
      const logPath = path.join(outDir, `${name}-${profile}${matches}.log`);
      fs.writeFileSync(logPath, `$ node ${args.join(" ")}\nexit=${status}\n${stdout}${stderr}`);
      console.log(
        `${name.padEnd(28)} exit=${String(status).padStart(3)}  ${seconds.toFixed(1).padStart(7)}s  -> ${path.relative(ROOT, logPath)}`,
      );
      resolve({ name, module, exit: status, seconds: Number(seconds.toFixed(1)), log: path.relative(ROOT, logPath) });
    });
  });
}

const startedAll = Date.now();
const results = [];
let cursor = 0;
const workers = Array.from({ length: Math.min(jobs, rungs.length) }, async () => {
  while (cursor < rungs.length) {
    const index = cursor;
    cursor += 1;
    results.push(await runRung(rungs[index]));
  }
});
await Promise.all(workers);

results.sort((a, b) => Number(a.name.slice(1).split("-")[0]) - Number(b.name.slice(1).split("-")[0]));
fs.writeFileSync(
  path.join(outDir, `ladder-${profile}${matches}.json`),
  `${JSON.stringify({ profile, matches, baseline: "5f1d152", jobs, steps: results }, null, 2)}\n`,
);
console.log(
  `\n${results.length} rungs in ${((Date.now() - startedAll) / 1000 / 60).toFixed(1)} min ` +
    `with ${Math.min(jobs, rungs.length)} workers`,
);
console.log(`wrote ${path.relative(ROOT, path.join(outDir, `ladder-${profile}${matches}.json`))}`);
