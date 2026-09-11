// Assign a flying-ball press by reachable arrival, not distance to the old
// ball position. Keep ordinary carrier pressure and marking quotas unchanged.
import "./_defensive-pass-arrival-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const start = source.indexOf("  _refreshDefPlan(team, owner,");
  const end = source.indexOf("  _defensivePassArrival(a)", start);
  assert.ok(start > 0 && end > start);
  let method = source.slice(start, end);
  const cache = "      plan.ballState === this.ball.state &&";
  assert.equal(method.split(cache).length, 2);
  method = method.replace(cache, cache + `
      (this.ball.state !== "pass" || plan.passAt === this.ball.lastPassAt &&
        (!Number.isFinite(plan.interceptAt) || this.t <= plan.interceptAt)) &&`);
  const before = "    const presser =\r\n      oldPress &&";
  method = method.replaceAll("\r\n", "\n");
  const anchor = before.replaceAll("\r\n", "\n");
  assert.equal(method.split(anchor).length, 2);
  method = method.replace(anchor, `    const interception = trigger.active && this.ball.state === "pass"
      ? candidates.map((player) => ({ player, point: this._defensivePassArrival(player) }))
        .filter((candidate) => candidate.point)
        .sort((left, right) => left.point.at - right.point.at ||
          pitchDistanceBetween(left.player.x, left.player.y, left.point.x, left.point.y) -
            pitchDistanceBetween(right.player.x, right.player.y, right.point.x, right.point.y) ||
          String(left.player.id).localeCompare(String(right.player.id)))[0] : null;
    const presser = interception ? interception.player :
      oldPress &&`);
  const saved = "    plan.ballState = this.ball.state;";
  assert.equal(method.split(saved).length, 2);
  method = method.replace(saved, saved + `
    plan.passAt = this.ball.lastPassAt;
    plan.interceptAt = interception?.point.at ?? null;`);
  source = source.slice(0, start) + method + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ defensivePassPlanCandidate: { loadedEngineSha256 } })));
