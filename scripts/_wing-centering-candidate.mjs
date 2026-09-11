// Express the winger's default width around midfield; keep its existing depth.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const before = "a.baseX * 0.55 + 50 * 0.25 + (b.x - 50) * 0.12";
  const after = "50 + (a.baseX - 50) * 0.55 + (b.x - 50) * 0.12";
  const original = String(result.source);
  assert.equal(original.split(before).length, 2);
  const source = original.replace(before, after);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ wingCenteringCandidate: { loadedEngineSha256 } })));
