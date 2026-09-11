// Continue the body-control direction chosen for this reception until the next
// normal decision. Do not instantly replace it with an unrelated forward carry.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const before = '    a.intent = usesHands ? null : this._forwardDribbleIntent(a);';
  assert.equal(source.split(before).length, 2);
  source = source.replace(before, before + `
    if (a.intent) {
      const length = pitchDistanceBetween(a.x, a.y, a.intent.tx, a.intent.ty);
      const offset = pitchOffsetToward(Math.cos(plan.desiredHeading), Math.sin(plan.desiredHeading), length);
      a.intent = { type: "dribble", tx: clamp(a.x + offset.x, 4, 96), ty: clamp(a.y + offset.y, 3, 97) };
    }`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ receptionCarryDirectionCandidate: { loadedEngineSha256 } })));
