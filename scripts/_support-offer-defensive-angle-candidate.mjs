// v10: the pressure circle already has a metre radius; classify its half-planes
// in the same physical geometry used by the cover shadow and target offsets.
import "./_support-offer-shadow-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const original = /const crossesPressureCircle =\s+\(support\.x - b\.x\) \* \(a\.x - b\.x\) \+\s+\(support\.y - b\.y\) \* \(a\.y - b\.y\) <\s+0;/g;
  assert.equal([...String(result.source).matchAll(original)].length, 1);
  const source = String(result.source).replace(original, `const supportVector = pitchVectorMetres(support.x - b.x, support.y - b.y);
        const playerVector = pitchVectorMetres(a.x - b.x, a.y - b.y);
        const crossesPressureCircle =
          supportVector.x * playerVector.x + supportVector.y * playerVector.y < 0;`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferDefensiveAngleCandidate: { loadedEngineSha256 } })));
