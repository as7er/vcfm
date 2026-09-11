// Confirm optimistic reach estimates with a copy of the real moving player.
// Discarding reverse/lateral momentum otherwise assigns impossible arrivals.
import "./_defensive-pass-plan-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const start = source.indexOf("  _defensivePassArrival(a) {");
  const end = source.indexOf("  _thinkDefend(a, owner) {", start);
  assert.ok(start > 0 && end > start);
  let method = source.slice(start, end);
  const gapStart = method.indexOf("      if (gap < 1e-8)");
  const gapEnd = method.indexOf("    }\n    return null;", gapStart);
  assert.ok(gapStart > 0 && gapEnd > gapStart);
  method = method.slice(0, gapStart) + `      if (gap >= 1e-8) {
        const metresPerUnit = pitchDistanceBetween(a.x, a.y, trial.x, trial.y) / gap;
        const along = Math.max(0, ((a.vx || 0) * dx + (a.vy || 0) * dy) / gap);
        const accelerateFor = Math.min(elapsed, Math.max(0, topSpeed - along) / accel);
        const reachable = along * accelerateFor + 0.5 * accel * accelerateFor ** 2 + topSpeed * (elapsed - accelerateFor);
        if ((gap - reachable) * metresPerUnit > contactRadius) continue;
      }
      const point = { x: trial.x, y: trial.y, at: this.t + elapsed, passAt: b.lastPassAt };
      const projected = { ...a, tx: point.x, ty: point.y, fsm: "press",
        _cornerArrivalAt: null, _passIntercept: point };
      this._integrate(projected, elapsed);
      if (pitchDistanceBetween(projected.x, projected.y, trial.x, trial.y) <= contactRadius) return point;
` + method.slice(gapEnd);
  source = source.slice(0, start) + method + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ defensivePassMomentumCandidate: { loadedEngineSha256 } })));
