// A completed kick is visible to every defender before movement begins,
// including defenders whose ordinary think slot preceded the passer's slot.
import "./_defensive-pass-lifetime-candidate.mjs";
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
  const anchor = "    this._startPassSupport(a, passTo);";
  assert.equal(source.split(anchor).length, 2);
  source = source.replace(anchor, anchor + `
    if (!isCross && this.t >= (this.deadBallUntil || 0)) {
      this._stepDefContext = null;
      for (const defender of this.agents) {
        if (defender.team === a.team || defender.role === "GK" || defender.sentOff || defender.injuredOff) continue;
        defender.offBallTarget = null;
        this._thinkDefend(defender, a);
      }
    }`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ defensivePassReleaseCandidate: { loadedEngineSha256 } }));
