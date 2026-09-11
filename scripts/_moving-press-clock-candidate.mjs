// Sample observed target velocity when choosing the tactical target, before
// sequential player integration. Never read a future opponent velocity.
import "./_moving-press-target-candidate.mjs";
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
  const marker = '    if (job.type === "press") {';
  assert.equal(method.split(marker).length, 2);
  method = method.replace(marker, marker + `
      a._pressTargetVelocity = owner && b.owner === owner.id
        ? { ownerId: owner.id, vx: owner.vx, vy: owner.vy } : null;`);
  source = source.slice(0, begin) + method + source.slice(end);
  const tracking = "    const tracking = trackedOwner && trackedOwner.team !== a.team &&";
  assert.equal(source.split(tracking).length, 2);
  source = source.replace(tracking, `    const observed = a._pressTargetVelocity;
    const tracking = trackedOwner && observed?.ownerId === trackedOwner.id && trackedOwner.team !== a.team &&`);
  for (const axis of ["x", "y"]) {
    const before = `tracking ? trackedOwner.v${axis} * responseTime : 0`;
    assert.equal(source.split(before).length, 2);
    source = source.replace(before, `tracking ? observed.v${axis} * responseTime : 0`);
  }
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ movingPressClockCandidate: { loadedEngineSha256 } }));
