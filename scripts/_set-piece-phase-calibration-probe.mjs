// Isolate set-piece phase expiry from the experimental corner positions/runs.
// Usage: node scripts/_set-piece-phase-calibration-probe.mjs boundary 24 realism standard
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const variant = process.argv[2] || "boundary";
const count = process.argv[3] || "24";
const audit = process.argv[4] || "fixture";
const profile = process.argv[5] || "standard";
assert.ok(["control", "boundary"].includes(variant));
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL || variant === "control") return result;
  let source = String(result.source);
  const edits = [
    ["const controlTeam = owner?.team || flightControl;",
      'if (owner) this._cornerAttackUntil[owner.team === "home" ? "away" : "home"] = 0;'],
    ["_restart(type, restartTeam, x, y) {", "this._cornerAttackUntil = { home: 0, away: 0 };"],
    ["_kickoff(team) {", "this._cornerAttackUntil = { home: 0, away: 0 };"],
    ["_penaltyKick(team) {", "this._cornerAttackUntil = { home: 0, away: 0 };"],
  ];
  for (const [anchor, addition] of edits) {
    assert.equal(source.split(anchor).length, 2, `unique phase anchor: ${anchor}`);
    source = source.replace(anchor, `${anchor}\n    ${addition}`);
  }
  return { ...result, source };
} });
console.log(`Set-piece phase: ${variant}, ${audit}, ${count}, ${profile}`);
process.argv[2] = count;
process.argv[3] = profile;
const audits = {
  fixture: "./_set-piece-phase-fixture.mjs",
  realism: "./match-realism-audit.mjs",
  structure: "./corner-structure-audit.mjs",
  defending: "./box-defending-audit.mjs",
  box: "./box-possession-sampling-audit.mjs",
};
assert.ok(audits[audit], `unknown audit: ${audit}`);
await import(audits[audit]);
