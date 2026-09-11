// Route an actual presser around the carrier's existing body envelope.
// Tactical standoff, body size, pace, acceleration and tackle rules are unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const anchor = "  _integrate(a, dt) {";
  assert.equal(source.split(anchor).length, 2);
  source = source.replace(anchor, `  _pressBodyWaypoint(a) {
    const b = this.ball;
    const owner = b.owner ? this.agentById(b.owner) : null;
    if (a.fsm !== "press" || !owner || owner.team === a.team || owner.sentOff || owner.injuredOff ||
        !["held", "control"].includes(b.state) || b.restartType || this.t < (this.deadBallUntil || 0)) {
      a._pressBodyRoute = null;
      return null;
    }
    const radius = this.separationMinDistanceUnits;
    const px = a.x - owner.x, py = a.y - owner.y;
    const tx = a.tx - owner.x, ty = a.ty - owner.y;
    const distance = Math.hypot(px, py), targetDistance = Math.hypot(tx, ty);
    if (distance < 1e-6 || targetDistance < 1e-6) { a._pressBodyRoute = null; return null; }
    const angle = Math.atan2(px * ty - py * tx, px * tx + py * ty);
    const visible = Math.acos(clamp(radius / Math.max(radius, distance), -1, 1));
    const targetVisible = Math.acos(clamp(radius / Math.max(radius, targetDistance), -1, 1));
    // Project an unreachable tactical point onto the current body boundary only
    // to test visibility. A visible target keeps the original pressing behavior.
    if (Math.abs(angle) <= visible + targetVisible + 1e-6) { a._pressBodyRoute = null; return null; }
    const previous = a._pressBodyRoute;
    const sameRoute = previous?.ownerId === owner.id && previous.attackSince === this._teamAttackSince[owner.team];
    const shortSide = angle < 0 ? -1 : 1;
    const sides = sameRoute ? [previous.side, -previous.side] : [shortSide, -shortSide];
    for (const side of sides) {
      const remainingAngle = side === shortSide ? Math.abs(angle) : Math.PI * 2 - Math.abs(angle);
      const tangentAngle = Math.atan2(py, px) + side * visible;
      const cx = Math.cos(tangentAngle), cy = Math.sin(tangentAngle);
      // Extend the tangent into the next visible arc. The waypoint itself is
      // outside the obstacle, and the same arrival/acceleration controller runs.
      const extension = radius * Math.tan(Math.min(Math.PI / 4, remainingAngle - visible - targetVisible));
      const tangentRadius = Math.max(radius, distance < radius ? radius * radius / distance : radius);
      const target = { x: owner.x + cx * tangentRadius - side * cy * extension,
        y: owner.y + cy * tangentRadius + side * cx * extension };
      if (target.x < 2 || target.x > 98 || target.y < 2 || target.y > 98) continue;
      const dx = target.x - a.x, dy = target.y - a.y;
      const squared = dx * dx + dy * dy;
      if (squared < 1e-8) continue;
      const obstructed = this.agents.some((other) => {
        if (other === a || other === owner || other.sentOff || other.injuredOff) return false;
        const ox = other.x - a.x, oy = other.y - a.y;
        const along = clamp((ox * dx + oy * dy) / squared, 0, 1);
        return Math.hypot(ox - dx * along, oy - dy * along) < Math.min(radius, Math.hypot(ox, oy)) - 1e-6;
      });
      if (obstructed) continue;
      a._pressBodyRoute = { ownerId: owner.id, attackSince: this._teamAttackSince[owner.team], side };
      return target;
    }
    a._pressBodyRoute = null;
    return null;
  }

` + anchor + `
    const pressWaypoint = this._pressBodyWaypoint(a);
    if (pressWaypoint) {
      const tx = a.tx, ty = a.ty;
      a.tx = pressWaypoint.x;
      a.ty = pressWaypoint.y;
      this._integrateMotion(a, dt);
      a.tx = tx;
      a.ty = ty;
      return;
    }`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ pressBodyRouteCandidate: { loadedEngineSha256 } })));
