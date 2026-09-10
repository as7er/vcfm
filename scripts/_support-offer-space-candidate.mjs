// v13: add actual clearance boundaries to the existing 2/4/6 m search.
// Boolean availability is not monotone: one defender's shadow can end before
// a teammate's reservation begins, leaving a gap with no coarse sample in it.
import "./_support-offer-defense-state-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

function supportOfferSearchXs(a, owner, anchor) {
  const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
  const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
  const xs = [3, 97];
  const add = (x) => {
    if (Number.isFinite(x) && Math.abs(x - anchor.x) * mx < 6) xs.push(x);
  };
  const roots = (aa, bb, cc, fromX, scaleX) => {
    if (Math.abs(aa) < 1e-12) {
      if (Math.abs(bb) > 1e-12) add(fromX - cc / bb / scaleX);
      return;
    }
    const discriminant = bb * bb - 4 * aa * cc;
    if (discriminant < 0) return;
    const span = Math.sqrt(discriminant);
    add(fromX + (-bb - span) / (2 * aa) / scaleX);
    add(fromX + (-bb + span) / (2 * aa) / scaleX);
  };
  const circle = (point, radius, scaleX = mx, scaleY = my) => {
    const dy = (anchor.y - point.y) * scaleY;
    const squared = radius * radius - dy * dy;
    if (squared < 0) return;
    const dx = Math.sqrt(squared) / scaleX;
    add(point.x - dx);
    add(point.x + dx);
  };
  const segment = (from, obstacle, radius, scaleX, scaleY) => {
    const y = (anchor.y - from.y) * scaleY;
    const ox = (obstacle.x - from.x) * scaleX;
    const oy = (obstacle.y - from.y) * scaleY;
    // Tangencies to the blocking circle, and entry/exit of the projection
    // into the finite segment. All roots are target X values at this depth.
    roots(oy * oy - radius * radius, -2 * ox * oy * y,
      (ox * ox - radius * radius) * y * y, from.x, scaleX);
    roots(0, ox, oy * y, from.x, scaleX);
    roots(1, -ox, y * y - oy * y, from.x, scaleX);
    circle(obstacle, radius, scaleX, scaleY);
  };
  circle(this.ball, 20);
  for (const other of this.agents) {
    if (other.id === a.id || other.sentOff || other.injuredOff) continue;
    // Running clearance retains the existing body's field-unit envelope.
    segment(a, other, this.separationMinDistanceUnits - 1e-6, 1, 1);
    if (other.team === a.team) {
      circle({ x: other.tx, y: other.ty }, OFF_BALL_TARGET_DEFAULTS.supportSpacingMetres);
    } else if (other.role !== "GK") {
      segment(this.ball, other, 1.8, mx, my);
      circle(other, 2);
    }
  }
  return xs;
}

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source).replaceAll("\r\n", "\n");
  source += `\nSimEngine.prototype._supportOfferSearchXs = ${supportOfferSearchXs.toString()};\n`;
  const before = "    for (const side of [preferredSide, -preferredSide]) {\n      let lower = 0;\n      for (const offset of [2, 4, 6]) {";
  const after = `    const searchXs = this._supportOfferSearchXs(a, owner, anchor);
    for (const side of [preferredSide, -preferredSide]) {
      const edges = [...new Set([0, 2, 4, 6, ...searchXs.map((x) => (x - target.x) * mx * side)
        .filter((offset) => offset > 0 && offset < 6)])].sort((x, y) => x - y);
      const probes = edges.flatMap((edge, i) => i ? [(edges[i - 1] + edge) / 2, edge] : []);
      let lower = 0;
      for (const offset of probes) {`;
  assert.equal(source.split(before).length, 2);
  source = source.replace(before, after);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferSpaceCandidate: { loadedEngineSha256 } })));
