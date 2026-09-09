// Reproduce the calibrated v252 candidate against the pinned v251 runtime,
// even after the production engine has changed. No production flags are used.
// node scripts/attacking-candidate-audit.mjs [count=24] [standard|background] [audit=realism]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const count = Number(process.argv[2] || 24);
const profile = process.argv[3] || "standard";
const audit = process.argv[4] || "realism";
assert.ok(Number.isInteger(count) && count > 0);
assert.ok(["standard", "background"].includes(profile));
assert.ok(["realism", "box", "movement", "fixture", "contact", "cutback", "opportunity", "trace"].includes(audit));
const preloads = [
  "_v251-baseline", "_third-man-run-candidate", "_reception-ready-candidate",
  "_corner-dynamic-candidate", "_pass-height-candidate", "_pass-arrival-candidate",
  "_cross-flight-candidate", "_cross-target-candidate", "_receiver-arrival-candidate",
  "_cross-reach-candidate", "_shot-aim-source-candidate",
];
const args = preloads.flatMap((name) => ["--import", `./scripts/${name}.mjs`]);
if (audit === "trace") args.push("--import", "./scripts/_shot-chain-observer.mjs");
args.push("scripts/_pass-route-calibration-probe.mjs", "space_timed", String(count), audit, profile,
  "--mid-support", "--flight-anticipation", "--sustain-runs", "--all-free-heights",
  "--height-aware-substeps", "--metric-lanes", "--cross-offside", "--close-shot-eligibility",
  "--angular-window", "--contact-window");
if (audit === "trace") args.push("--unobserved", "--sample-label=archived-attacking-candidate");
const result = spawnSync(process.execPath, args, {
  cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
