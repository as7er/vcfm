// Isolated experiment: movement and ball contacts use the same substep clock.
// Decisions remain at the requested outer-step cadence; no attributes change.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const baseline = process.argv.includes("--baseline-v250");
  let source = baseline
    ? execFileSync("git", ["show", "6b51782fa8456c2df43147c6bd49af1406391aa3"],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" }) : String(result.source);
  if (baseline && process.argv.includes("--baseline-only")) return { ...result, source };
  if (!baseline && source.includes("  _integrateMotion(a, dt) {")) return result;
  source = source.replace(/\r\n/g, "\n");
  const legacyContactClock = process.argv.includes("--sync-v2-contact-clock");
  function replace(anchor, replacement) {
    assert.equal(source.split(anchor).length, 2, `unique engine anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  }
  if (!legacyContactClock) {
    for (const anchor of ["_restart(type, restartTeam, x, y) {", "_kickoff(team) {", "_penaltyKick(team) {"]) {
      replace(anchor, `${anchor}\n    this._restartStepEpoch = (this._restartStepEpoch || 0) + 1;`);
    }
    replace("    const contactReason = this._contactFineReason();\n", "");
    replace("    if (contactReason) {\n      this.integrationStats.reasons[contactReason] =\n        (this.integrationStats.reasons[contactReason] || 0) + 1;\n    }\n", "");
    replace("      this._activeStepDt = contactReason ? SIM.DT : physicsDt;", "      this._activeStepDt = physicsDt;");
  }
  const start = source.indexOf("    // 2) 积分运动\n");
  const end = source.indexOf("    // 3-5) 无风险跑位", start);
  assert.ok(start > 0 && end > start, "unique movement block");
  const movement = source.slice(start, end);
  source = source.slice(0, start) + source.slice(end);
  const loop = "      this._emitTimeOffset = physicsDt;\n      this._stepBall(physicsDt);";
  assert.equal(source.split(loop).length, 2);
  const fineMovement = movement.replace(/\bdt\b/g, "physicsDt")
    .split("\n").filter(Boolean).map((line) => `  ${line}`).join("\n");
  source = source.replace(loop,
    "      this._emitTimeOffset = physicsDt;\n" +
    (process.argv.includes("--sync-shared-separation-epoch") ? "" : "      if (index > 0) this._motionStepEpoch++;\n") +
    `${fineMovement}\n` +
    (legacyContactClock ? "      const restartBeforeContact = this.deadBallUntil;\n" :
      "      const contactReason = this._contactFineReason();\n" +
      "      this._activeStepDt = contactReason ? Math.min(SIM.DT, physicsDt) : physicsDt;\n" +
      "      if (contactReason) this.integrationStats.reasons[contactReason] =\n" +
      "        (this.integrationStats.reasons[contactReason] || 0) + 1;\n" +
      "      const restartBeforeContact = this._restartStepEpoch || 0;\n") +
    "      this._stepBall(physicsDt);");
  const oldBreak = "      if (this.pendingPenalty || this.celebrateUntil || flightResolved) break;";
  assert.equal(source.split(oldBreak).length, 2);
  source = source.replace(oldBreak,
    legacyContactClock
      ? "      if (this.pendingPenalty || this.celebrateUntil || this.deadBallUntil !== restartBeforeContact) break;"
      : "      if (this.pendingPenalty || this.celebrateUntil || (this._restartStepEpoch || 0) !== restartBeforeContact) break;");
  return { ...result, source };
} });
