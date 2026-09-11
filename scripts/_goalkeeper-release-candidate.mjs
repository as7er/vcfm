// Complete the same-step kick notification for goalkeepers. Flight response
// must not depend on a goalkeeper's place in the player decision array.
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
  const gkStart = source.indexOf("  _thinkGK(a, owner) {");
  const gkBall = source.indexOf("    const b = this.ball;", gkStart);
  assert.ok(gkStart > 0 && gkBall > gkStart);
  source = source.slice(0, gkBall) + source.slice(gkBall).replace("    const b = this.ball;",
    "    const b = this.ball;\n    owner = b.owner ? this.agentById(b.owner) : null;");
  const passMarker = "    this._startPassSupport(a, passTo);";
  assert.equal(source.split(passMarker).length, 2);
  source = source.replace(passMarker, passMarker + "\n    this._refreshGoalkeepersAfterRelease();");
  const shotMarker = "    a.noReclaimUntil = this.t + 0.4;";
  assert.equal(source.split(shotMarker).length, 2);
  source = source.replace(shotMarker, shotMarker + "\n    this._refreshGoalkeepersAfterRelease();");
  const method = `  _refreshGoalkeepersAfterRelease() {
    const b = this.ball;
    if (b.owner || !["pass", "shot"].includes(b.state) || this.t < (this.deadBallUntil || 0)) return;
    for (const keeper of this.agents) {
      if (keeper.role !== "GK" || keeper.sentOff || keeper.injuredOff) continue;
      this._thinkGK(keeper, null);
    }
  }

`;
  source = source.replace("  _thinkGK(a, owner) {", method + "  _thinkGK(a, owner) {");
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ goalkeeperReleaseCandidate: { loadedEngineSha256 } }));
