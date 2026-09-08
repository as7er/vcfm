// Process-local experiment: settled supporting players leave a blocked lane.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const measures = { eligible: 0, blocked: 0, moved: 0 };
globalThis[Symbol.for("vcfm.support-lane-candidate")] = (stage) => { measures[stage]++; };
let loadedEngineSha256;

function supportLaneTarget(a, owner) {
  const b = this.ball;
  const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
  const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
  const gap = (ax, ay, bx, by) => Math.hypot((ax - bx) * mx, (ay - by) * my);
  if (!owner || b.owner !== owner.id || owner.team !== a.team || a.id === owner.id ||
      (a.role !== "ATT" && a.role !== "MID") || a.sentOff || a.injuredOff ||
      b.state !== "held" || b.restartType || this.t < (this.deadBallUntil || 0) ||
      Math.abs(b.y - this.targetGoalY(a.team)) > 36 ||
      gap(a.x, a.y, a.tx, a.ty) > 4 || gap(b.x, b.y, a.tx, a.ty) > 25 ||
      gap(b.x, b.y, a.tx, a.ty) < 6) return null;
  const count = globalThis[Symbol.for("vcfm.support-lane-candidate")];
  count("eligible");
  const clear = (tx, ty) => {
    const dx = (tx - b.x) * mx;
    const dy = (ty - b.y) * my;
    const length = Math.hypot(dx, dy);
    for (const o of this.agents) {
      if (o.team === a.team || o.role === "GK" || o.sentOff || o.injuredOff) continue;
      const ox = (o.x - b.x) * mx;
      const oy = (o.y - b.y) * my;
      const along = (ox * dx + oy * dy) / length;
      if (along < 0 || along > length) continue;
      if (Math.abs(ox * dy - oy * dx) / length <= 1.1) return false;
    }
    return true;
  };
  if (clear(a.tx, a.ty)) return null;
  count("blocked");
  const preferredSide = a.baseX < 50 ? -1 : 1;
  for (const offset of [2, 4, 6]) {
    for (const side of [preferredSide, -preferredSide]) {
      const tx = clamp(a.tx + side * offset / mx, 3, 97);
      if (!clear(tx, a.ty)) continue;
      const crowded = this.agents.some((m) => m.team === a.team && m.id !== a.id &&
        !m.sentOff && !m.injuredOff &&
        gap(tx, a.ty, m.tx, m.ty) < OFF_BALL_TARGET_DEFAULTS.supportSpacingMetres);
      if (crowded) continue;
      count("moved");
      return { x: tx, y: a.ty };
    }
  }
  return null;
}

registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  assert.ok(String(result.source).includes("_commitOffBallTarget(a, phaseActor)"));
  const source = `${result.source}
SimEngine.prototype._probeSupportLaneTarget = ${supportLaneTarget.toString()};
const supportLaneCommit = SimEngine.prototype._commitOffBallTarget;
SimEngine.prototype._commitOffBallTarget = function(a, owner) {
  const result = supportLaneCommit.call(this, a, owner);
  const target = this._probeSupportLaneTarget(a, owner);
  if (target) {
    a.tx = target.x;
    a.offBallTarget = { ...a.offBallTarget, x: target.x, kind: "support-lane" };
  }
  return result;
};
`;
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportLaneCandidate: { loadedEngineSha256, measures } }, null, 2)));
