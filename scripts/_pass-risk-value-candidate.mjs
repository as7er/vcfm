// Existing negative territorial values are already undesirable. A survival
// multiplier must not promote them toward zero when a route becomes riskier.
import "./_pass-interception-risk-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { reportCandidateOnExit } from "./_candidate-exit-reports.mjs";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const original = String(result.source);
  const before = "      const interceptionRisk = this._passInterceptionRisk(a, option);";
  assert.equal(original.split(before).length, 2);
  const source = original.replace(before,
    "      const interceptionRisk = option.value > 0 ? this._passInterceptionRisk(a, option) : null;");
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ passRiskValueCandidate: { loadedEngineSha256 } }));
