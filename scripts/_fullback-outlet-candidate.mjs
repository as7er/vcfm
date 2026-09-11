// Once the ball reaches the byline, the full-back offers the same 18 m
// cutback depth used by the third-man plan, instead of joining at the byline.
import "./_rest-defense-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const anchor = "        overlapY = clamp(b.y + dir * (8 + this.random() * 12 + prog * 8), 8, 92);";
  assert.equal(source.split(anchor).length, 2);
  source = source.replace(anchor, anchor + `
        const outletDepth = 18 * clamp((20 - ballDepth) / 8, 0, 1);
        const overlapDepth = Math.max(Math.abs(overlapY - goalY) * my, outletDepth);
        overlapY = goalY - dir * overlapDepth / my;`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ fullbackOutletCandidate: { loadedEngineSha256 } })));
