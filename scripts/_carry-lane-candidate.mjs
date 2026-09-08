// Process-local steering experiment. The destination, speed, acceleration,
// shooting and pass decisions stay unchanged; a carrier can steer around an
// occupied path instead of relying on the separation solver to push them apart.
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const symbol = Symbol.for("vcfm.carry-lane-candidate");
const observeOnly = process.argv.includes("--observe-carry-lanes");
const samples = { carrierSteps: 0, blockedSteps: 0, steeredSteps: 0 };

globalThis[symbol] = (SimEngine, SIM) => {
  const radius = SIM.SEPARATION_MIN_DISTANCE_UNITS;
  function clearance(a, dx, dy, opponents) {
    const lengthSquared = dx * dx + dy * dy;
    let nearest = Infinity;
    for (const o of opponents) {
      const ox = o.x - a.x;
      const oy = o.y - a.y;
      const along = Math.max(0, Math.min(1, (ox * dx + oy * dy) / lengthSquared));
      nearest = Math.min(nearest, Math.hypot(ox - dx * along, oy - dy * along));
    }
    return nearest;
  }
  const integrate = SimEngine.prototype._integrate;
  SimEngine.prototype._integrate = function (a, dt) {
    if (this.ball.owner !== a.id || this.ball.state !== "held" || a.role === "GK" ||
        a.pendingBallAction || a.intent?.type !== "dribble" || this.t < (this.deadBallUntil || 0)) {
      return integrate.call(this, a, dt);
    }
    const tx = a.tx;
    const ty = a.ty;
    const dx = tx - a.x;
    const dy = ty - a.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.1) return integrate.call(this, a, dt);
    samples.carrierSteps++;
    const horizon = Math.min(distance, 5);
    const ux = dx / distance;
    const uy = dy / distance;
    const opponents = this.agents.filter((o) => o.team !== a.team && !o.sentOff && !o.injuredOff &&
      Math.hypot(o.x - a.x, o.y - a.y) < horizon + radius);
    const originalClearance = clearance(a, ux * horizon, uy * horizon, opponents);
    if (originalClearance >= radius) return integrate.call(this, a, dt);
    samples.blockedSteps++;
    let best = null;
    for (const degrees of [30, -30, 60, -60, 90, -90]) {
      const theta = degrees * Math.PI / 180;
      const rx = ux * Math.cos(theta) - uy * Math.sin(theta);
      const ry = ux * Math.sin(theta) + uy * Math.cos(theta);
      const gap = clearance(a, rx * horizon, ry * horizon, opponents);
      const score = Math.min(radius, gap) + Math.cos(theta) * 0.15;
      if (!best || score > best.score) best = { x: a.x + rx * horizon, y: a.y + ry * horizon, gap, score };
    }
    if (best && best.gap > originalClearance + 0.25 &&
        best.x >= 2 && best.x <= 98 && best.y >= 2 && best.y <= 98) {
      samples.steeredSteps++;
      if (!observeOnly) {
        a.tx = best.x;
        a.ty = best.y;
      }
    }
    const result = integrate.call(this, a, dt);
    a.tx = tx;
    a.ty = ty;
    return result;
  };
};
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  return { ...result, source: `${result.source}\nglobalThis[Symbol.for("vcfm.carry-lane-candidate")](SimEngine, SIM);\n` };
} });
process.on("exit", () => console.log(JSON.stringify({ carryLanes: { observeOnly, ...samples } }, null, 2)));
