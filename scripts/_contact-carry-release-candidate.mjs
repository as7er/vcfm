// Refine the static-path experiment: release only from an actual body constraint.
// A farther defender on the projected route does not yet prevent advancing.
import "./_blocked-carry-release-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const begin = source.indexOf("  _blockedCarryRelease(a, intent, options) {");
  const end = source.indexOf("  _forwardDribbleIntent(a) {", begin);
  assert.ok(begin > 0 && end > begin);
  let method = source.slice(begin, end);
  const before = "      if (o.team === a.team || o.sentOff || o.injuredOff) return false;";
  assert.equal(method.split(before).length, 2);
  method = method.replace(before, before + `
      if (Math.hypot(o.x - a.x, o.y - a.y) > this.separationMinDistanceUnits + 1e-6) return false;`);
  source = source.slice(0, begin) + method + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ contactCarryReleaseCandidate: { loadedEngineSha256 } })));
