// Save readiness uses time actually available before contact, not the future
// time the shot would have needed to reach the goal line.
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
  const old = `        const reactionTime = Number.isFinite(b.shotFlightTime)
          ? b.shotFlightTime
          : clamp(shotDistance / Math.max(1, speed), 0.18, 1.4);`;
  source = source.replaceAll("\r\n", "\n");
  assert.equal(source.split(old).length, 2);
  source = source.replace(old, `        const contactAt = this.t + (Number.isFinite(b._stepDt) ? b._stepDt : dt) * tt;
        const reactionTime = Number.isFinite(b.shotAt)
          ? Math.max(0, contactAt - b.shotAt)
          : Number.isFinite(b.shotFlightTime) ? b.shotFlightTime
          : clamp(shotDistance / Math.max(1, speed), 0.18, 1.4);`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ goalkeeperReactionClockCandidate: { loadedEngineSha256 } }));
