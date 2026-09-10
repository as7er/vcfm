// v6: a support offer has its own spatial and passing-lane continuation rules.
// Do not let the ordinary reversal lease retain it before those rules run.
import "./_support-offer-dynamic-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const original = 'const urgent = a.offBallTargetKind === "one-two" && a.offBallTarget?.kind !== "one-two";';
  assert.equal(String(result.source).split(original).length, 2, "one ordinary lease entry must exist");
  const source = String(result.source).replace(original,
    'const urgent = (a.offBallTargetKind === "one-two" && a.offBallTarget?.kind !== "one-two") || !!a.offBallTarget?.offer;');
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferLeaseCandidate: { loadedEngineSha256 } })));
