// Isolate the eligibility defect from the attacking-shape experiments.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const begin = source.indexOf("  _isPrimaryMidRunner(a) {");
  const end = source.indexOf("  _defensiveThreats(", begin);
  assert.ok(begin > 0 && end > begin);
  let method = source.slice(begin, end);
  const before = '.filter((m) => m.team === a.team && m.role === "MID")';
  assert.equal(method.split(before).length, 2);
  method = method.replace(before, `.filter((m) => m.team === a.team && m.role === "MID" && !m.sentOff && !m.injuredOff &&
        (m.isCore || !(this._hasHabit(m, "comes_deep") ||
          (!this._hasHabit(m, "gets_forward") && this._roleBehavior(m, "support") > 0.52))))`);
  source = source.slice(0, begin) + method + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ runnerOnlyCandidate: { loadedEngineSha256 } })));
