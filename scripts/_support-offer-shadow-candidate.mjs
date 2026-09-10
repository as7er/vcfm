// v9: use physical pitch angles when choosing the presser's cover shadow.
import "./_support-offer-screen-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const original = /const goalLength = Math\.hypot\(vx, vy\) \|\| 1;\s+const shadowLength = Math\.hypot\(sx, sy\) \|\| 1;\s+const alignment = \(vx \* sx \+ vy \* sy\) \/ \(goalLength \* shadowLength\);/g;
  assert.equal([...String(result.source).matchAll(original)].length, 1);
  const source = String(result.source).replace(original, `const goalVector = pitchVectorMetres(vx, vy);
        const shadowVector = pitchVectorMetres(sx, sy);
        const goalLength = Math.hypot(goalVector.x, goalVector.y) || 1;
        const shadowLength = Math.hypot(shadowVector.x, shadowVector.y) || 1;
        const alignment = (goalVector.x * shadowVector.x + goalVector.y * shadowVector.y) /
          (goalLength * shadowLength);`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferShadowCandidate: { loadedEngineSha256 } })));
