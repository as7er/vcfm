// The receiver lead must use the flight that _pass actually launches, including
// the ground/air drag and the moving destination. This predictor consumes no RNG.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source).replace(/\r\n/g, "\n");
  const anchor = /const nominalSpeed = clamp\(18 \+ d \* 0\.7,[\s\S]*?let ty = clamp\(m\.y \+ \(m\.vy \|\| 0\) \* eta, 3, 97\);/g;
  assert.equal([...source.matchAll(anchor)].length, 1, "unique receiver lead estimate");
  source = source.replace(anchor, `let tx = m.x;
      let ty = m.y;
      let eta = 0;
      for (let iteration = 0; iteration < 4; iteration++) {
        const distanceM = pitchDistanceBetween(this.ball.x, this.ball.y, tx, ty);
        const nominalSpeed = clamp(10.5 + distanceM * 0.38, 11.5, 27) * (0.94 + 0.06 * (a.attr.passing || 0.55));
        const loft = distanceM >= 30 - 1e-6 ? 9 + (distanceM - 30) * 0.1 : distanceM >= 20 - 1e-6 ? 4.75 : 0;
        const nextEta = clamp(estimateBallArrivalSeconds(distanceM, nominalSpeed, loft ? 0.2 : 0, loft), 0.2, 3.4);
        tx = clamp(m.x + (m.vx || 0) * nextEta, 3, 97);
        ty = clamp(m.y + (m.vy || 0) * nextEta, 3, 97);
        if (Math.abs(nextEta - eta) < 0.005) break;
        eta = nextEta;
      }`);
  return { ...result, source };
} });
