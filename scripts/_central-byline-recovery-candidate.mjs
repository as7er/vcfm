// The shooting-zone fallback has the same interrupted byline retreat as the
// wider-wing branch. Complete that chosen destination unless a shot/pass wins.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const begin = source.indexOf('      const nearAttackingByline = a.team === "home" ? a.y < 5.5');
  const end = source.indexOf("      // 核心 / 边锋：内切带进去", begin);
  assert.ok(begin > 0 && end > begin);
  let block = source.slice(begin, end);
  block = '      const completingRecovery = a.intent?.bylineRecovery === this._teamAttackSince[a.team] &&\n' +
    '        a.intent.type === "dribble" && pitchDistanceBetween(a.x, a.y, a.intent.tx, a.intent.ty) > 1.5;\n' + block;
  block = block.replace('if (trappedAtByline && (pressure > 0.45 || cdBlocked || dGoal > 11)) {',
    'if (completingRecovery || (trappedAtByline && (pressure > 0.45 || cdBlocked || dGoal > 11))) {');
  const intent = '        a.intent = {';
  assert.equal(block.split(intent).length, 2);
  block = block.replace(intent, `        if (completingRecovery) {
          a.fsm = "carry";
          return;
        }
` + intent);
  const target = '          ty: clamp(goalY - dir * 14, 3, 97),';
  assert.equal(block.split(target).length, 2);
  block = block.replace(target, target + '\n          bylineRecovery: this._teamAttackSince[a.team],');
  source = source.slice(0, begin) + block + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ centralBylineRecoveryCandidate: { loadedEngineSha256 } })));
