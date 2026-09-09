// Exclude a proposed crossing zone when even the receiver's physical running
// bound plus existing control reach cannot meet the flight. No ability changes.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source).replace(/\r\n/g, "\n");
  const anchor = '      const ty = clamp(goalY - dir * (8 + this.random() * 6), 4, 96);';
  assert.equal(source.split(anchor).length, 2, "unique crossing zone");
  source = source.replace(anchor, `${anchor}\n      if (!this._crossTargetReachable(a, m, tx, ty)) continue;`);
  const method = `  _crossTargetReachable(passer, receiver, tx, ty) {
    const distance = pitchDistanceBetween(this.ball.x, this.ball.y, tx, ty);
    const technique = clamp((passer.attr.crossing || passer.attr.passing || 0.55) * 0.68 +
      (passer.attr.passing || 0.55) * 0.18 + (passer.attr.kicking || 0.55) * 0.14, 0.3, 0.95);
    const ballSpeed = clamp(10.5 + distance * 0.38, 11.5, 27) * (0.94 + 0.06 * technique);
    const loft = loftForTargetHeight(distance, ballSpeed, 1.375);
    const time = clamp(estimateBallArrivalSeconds(distance, ballSpeed, 0.2, loft), 0.2, 3.4);
    const dx = tx - receiver.x;
    const dy = ty - receiver.y;
    const gap = Math.hypot(dx, dy);
    if (gap < 0.01) return true;
    const speed = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * receiver.attr.pace) *
      (0.76 + Math.max(0.3, (receiver.fitness ?? 100) / 100) * 0.24);
    const accel = speed * (2.5 + 2.5 * receiver.attr.accel) * (0.94 + (receiver.attr.agility || 0.55) * 0.08);
    const along = Math.max(0, ((receiver.vx || 0) * dx + (receiver.vy || 0) * dy) / gap);
    const accelerating = Math.min(time, Math.max(0, speed - along) / accel);
    const travel = along * accelerating + 0.5 * accel * accelerating ** 2 + speed * (time - accelerating);
    const metresPerUnit = pitchDistanceMetres(dx, dy) / gap;
    return (gap - travel) * metresPerUnit <= SIM.CONTROL_RADIUS_METRES;
  }

`;
  source = source.replace("  _bestCross(a) {", `${method}  _bestCross(a) {`);
  return { ...result, source };
} });
