// The pass already assigns the receiver immediately. Commit the selected
// third player's existing run through the same tactical pipeline as well.
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
  const marker = "    selected.runner.attackThinkUntil = Math.min(selected.runner.attackThinkUntil || Infinity, this.t);";
  assert.equal(source.split(marker).length, 2);
  source = source.replace(marker, `    this._applyPassSupport(selected.runner, receiver);
    this._applyAttackTactics(selected.runner, receiver);
    this._commitOffBallTarget(selected.runner, receiver);`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ passSupportReleaseCandidate: { loadedEngineSha256 } }));
