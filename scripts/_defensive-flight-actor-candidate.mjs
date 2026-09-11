// Readers of one flight use the same receiver reference, including readers
// still carrying the enclosing think loop's pre-kick owner argument.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { reportCandidateOnExit } from "./_candidate-exit-reports.mjs";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const begin = source.indexOf("  _thinkDefend(a, owner) {");
  const end = source.indexOf("  _defBallRank(a)", begin);
  assert.ok(begin > 0 && end > begin);
  let method = source.slice(begin, end);
  const marker = "    const b = this.ball;";
  assert.equal(method.split(marker).length, 2);
  method = method.replace(marker, marker + `
    if (!b.owner && b.state === "pass") {
      owner = (b.receiverId && this.agentById(b.receiverId)) ||
        (b.lastKicker && this.agentById(b.lastKicker)) || owner;
    }`);
  source = source.slice(0, begin) + method + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ defensiveFlightActorCandidate: { loadedEngineSha256 } }));
