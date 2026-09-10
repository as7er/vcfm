// v12: include ball state in the existing defensive-plan cache key. A pass
// receiver is already the phase actor during flight, so actor identity alone
// cannot invalidate the flight assignments when that player controls the ball.
import "./_support-offer-physical-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const edits = [
    ["      plan.ballSide === ballSide &&", "      plan.ballSide === ballSide &&\n      plan.ballState === this.ball.state &&"],
    ["    plan.ballSide = ballSide;", "    plan.ballSide = ballSide;\n    plan.ballState = this.ball.state;"],
  ];
  for (const [before, after] of edits) {
    assert.equal(source.split(before).length, 2);
    source = source.replace(before, after);
  }
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferDefenseStateCandidate: { loadedEngineSha256 } })));
