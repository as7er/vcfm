// The pressing target travels with the carrier. Add that observed velocity to
// the existing arrival correction, retaining speed, turning and acceleration.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { reportCandidateOnExit } from "./_candidate-exit-reports.mjs";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const begin = source.indexOf("  _integrateMotion(a, dt) {");
  const end = source.indexOf("  _stepBall(dt) {", begin);
  assert.ok(begin > 0 && end > begin);
  let method = source.slice(begin, end);
  const before = "    const dx = a.tx - a.x;\r\n    const dy = a.ty - a.y;";
  const normalized = method.replaceAll("\r\n", "\n");
  const marker = before.replaceAll("\r\n", "\n");
  assert.equal(normalized.split(marker).length, 2);
  method = normalized.replace(marker, `    const trackedOwner = a.fsm === "press" &&
      ["held", "control"].includes(this.ball.state) && !this.ball.restartType &&
      this.t >= (this.deadBallUntil || 0) && this.ball.owner
        ? this.agentById(this.ball.owner) : null;
    const tracking = trackedOwner && trackedOwner.team !== a.team &&
      !trackedOwner.sentOff && !trackedOwner.injuredOff;
    // In the linear arrival region, speed / 5 is the existing response gain.
    // Express carrier velocity through that same gain so all old motion limits
    // still apply, including when target velocity plus correction saturates.
    const responseTime = 5 / Math.max(0.1, speed);
    const dx = a.tx - a.x + (tracking ? trackedOwner.vx * responseTime : 0);
    const dy = a.ty - a.y + (tracking ? trackedOwner.vy * responseTime : 0);`);
  source = source.slice(0, begin) + method + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ movingPressTargetCandidate: { loadedEngineSha256 } }));
