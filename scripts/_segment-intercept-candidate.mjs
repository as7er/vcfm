// Diagnostic candidate: make the in-flight interception test geometric over the
// ball's swept path instead of a point sample at the end of the step.
//
// The production test in `_resolvePossession` is
//
//     const d = pitchDistanceBetween(o.x, o.y, b.x, b.y);
//     if (d < SIM.CONTROL_RADIUS_METRES + 2.4) { ...roll the interception... }
//
// i.e. it asks "is a defender within 5.0m of the ball RIGHT NOW". With a 0.3s
// background step and 15m/s of ball travel that is a 4.5m jump between samples,
// so a defender sitting near the edge of the 5.0m radius can be stepped over
// entirely. The standard profile samples three times as often, so the two
// profiles disagree about the same physical situation.
//
// This candidate replaces the point distance with the distance to the segment the
// ball swept during the step, which is what the test means physically and is
// (approximately) independent of the step size. It reuses the `_prevX/_prevY`
// reconstruction already used by the goalkeeper reaction code below it.
//
// It changes ONLY the geometry, not how often `_resolvePossession` is called, so
// unlike `_always-fine-step-candidate.mjs` it is a single-variable test.
//
//   node --import ./scripts/_segment-intercept-candidate.mjs \
//     scripts/_through-pass-profile-fidelity-probe.mjs 24 372000
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;

const ANCHOR =
  "          const d = pitchDistanceBetween(o.x, o.y, b.x, b.y);\n" +
  "          // 拦截半径：比脚下控球略大（伸脚/身体挡），越靠近越易成\n" +
  "          if (d < SIM.CONTROL_RADIUS_METRES + 2.4) {";

const REPLACEMENT =
  "          const _ix0 = Number.isFinite(b._prevX) ? b._prevX : b.x - b.vx * dt;\n" +
  "          const _iy0 = Number.isFinite(b._prevY) ? b._prevY : b.y - b.vy * dt;\n" +
  "          const _isx = b.x - _ix0;\n" +
  "          const _isy = b.y - _iy0;\n" +
  "          const _il2 = _isx * _isx + _isy * _isy || 1e-9;\n" +
  "          const _it = Math.max(0, Math.min(1, ((o.x - _ix0) * _isx + (o.y - _iy0) * _isy) / _il2));\n" +
  "          const d = pitchDistanceBetween(o.x, o.y, _ix0 + _isx * _it, _iy0 + _isy * _it);\n" +
  "          // 拦截半径：比脚下控球略大（伸脚/身体挡），越靠近越易成\n" +
  "          if (d < SIM.CONTROL_RADIUS_METRES + 2.4) {";

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== engineURL) return result;
    let source = String(result.source).replace(/\r\n/g, "\n");
    assert.equal(source.split(ANCHOR).length, 2, "unique interception-test anchor");
    source = source.replace(ANCHOR, REPLACEMENT);
    return { ...result, source };
  },
});
