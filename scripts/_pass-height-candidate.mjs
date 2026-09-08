// Process-local candidate: reach depends on ball height, not the pass label.
// Preload before the existing route probe to evaluate the two mechanisms together.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const allFreeBalls = process.argv.includes("--all-free-heights");
const heightAwareSubsteps = process.argv.includes("--height-aware-substeps");
const freeFlightSubsteps = process.argv.includes("--free-flight-substeps");
const airDragOnly = process.argv.includes("--air-drag-only");
const flightOnly = process.argv.includes("--flight-only") || airDragOnly;
const baselineV249 = process.argv.includes("--baseline-v249");
const baselineOnly = process.argv.includes("--baseline-only");
const candidateSha256 = createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex");
assert.ok(!baselineOnly || (baselineV249 && !allFreeBalls && !freeFlightSubsteps && !heightAwareSubsteps && !airDragOnly));
assert.ok(!heightAwareSubsteps || allFreeBalls, "height-aware scheduling requires physical reach on every free ball");
assert.ok(!flightOnly || ((freeFlightSubsteps || airDragOnly) && !heightAwareSubsteps), "flight-only isolates the free-flight solver");
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = baselineV249 ? execFileSync("git", ["show", "03d6f0018f1c9bc5766a2f5e1379080de73c5a5d"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" }) : String(result.source);
  source = source.replace(/\r\n/g, "\n");
  const replacements = flightOnly || baselineOnly ? [] : [
    ["const overhead = b.isCrossPass && b.z > 2.2;", "const overhead = b.z > 2.2;"],
    ['const overheadCross = b.state === "pass" && !!b.isCrossPass;',
      allFreeBalls ? 'const overheadCross = true;' : 'const overheadCross = b.state === "pass";'],
  ];
  if (heightAwareSubsteps) replacements.push([
    "    const lengthSquared = dx * dx + dy * dy || 1e-9;\n    for (const agent of this.agents) {\n      if (agent.sentOff) continue;",
    "    const lengthSquared = dx * dx + dy * dy || 1e-9;\n" +
    "    const minimumHeight = Math.min(b.z || 0, (b.z || 0) + (b.vz || 0) * dt - 9 * dt * dt);\n" +
    "    for (const agent of this.agents) {\n      if (agent.sentOff) continue;\n" +
    '      if (minimumHeight > (agent.role === "GK" ? 3 : 2.2)) continue;',
  ]);
  if (freeFlightSubsteps) replacements.push(
    ['    if (b.state === "pass") {\n      let remaining = dt;',
      '    if (b.state === "pass" || dt > SIM.DT + 1e-9) {\n      let remaining = dt;'],
  );
  if (freeFlightSubsteps || airDragOnly) replacements.push(
    ['const horizontalFriction = ball.z > 0.4 ? 0.992 : groundFriction;',
      'const horizontalFriction = ball.z > 0.4 ? Math.pow(0.992, dt / SIM.DT) : groundFriction;'],
  );
  for (const [anchor, replacement] of replacements) {
    if (!source.includes(anchor) && source.split(replacement).length === 2) continue;
    assert.equal(source.split(anchor).length, 2, `unique pass-height anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  }
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ passHeightCandidate: {
  loadedEngineSha256, candidateSha256, baselineV249, baselineOnly,
  allFreeBalls, heightAwareSubsteps, freeFlightSubsteps, flightOnly, airDragOnly, preloads: process.execArgv,
} }, null, 2)));
