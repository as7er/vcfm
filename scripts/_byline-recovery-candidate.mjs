// Complete the already selected retreat before a new hug-the-line advance.
// Passing remains available at every decision; no speed or decision timer changes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const begin = source.indexOf("    // ——————————— 边锋高位：优先内切");
  const end = source.indexOf("    // ——————————— 边后卫高位", begin);
  assert.ok(begin > 0 && end > begin);
  let method = source.slice(begin, end);
  const before = "      if (nearAttackingByline) {";
  assert.equal(method.split(before).length, 2);
  method = method.replace(before, `      const completingRecovery = a.intent?.bylineRecovery === this._teamAttackSince[a.team] &&
        a.intent.type === "dribble" && pitchDistanceBetween(a.x, a.y, a.intent.tx, a.intent.ty) > 1.5;
      if (nearAttackingByline || completingRecovery) {`);
  const target = '          ty: clamp(goalY - dir * 13, 5, 95),';
  assert.equal(method.split(target).length, 2);
  method = method.replace(target, target + '\n          bylineRecovery: this._teamAttackSince[a.team],');
  source = source.slice(0, begin) + method + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ bylineRecoveryCandidate: { loadedEngineSha256 } })));
