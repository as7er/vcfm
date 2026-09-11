// Let the assigned presser run to a reachable point on the observed flight.
// Reuse the receiver's arrival controller, physical flight and motion limits.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const start = source.indexOf("  _thinkDefend(a, owner) {");
  const end = source.indexOf("  _defBallRank(a)", start);
  assert.ok(start > 0 && end > start);
  let method = source.slice(start, end);
  const anchor = '    if (job.type === "press") {';
  assert.equal(method.split(anchor).length, 2);
  method = method.replace(anchor, `    a._passIntercept = null;
` + anchor + `
      const intercept = this._defensivePassArrival(a);
      if (intercept) {
        a.tx = intercept.x;
        a.ty = intercept.y;
        a._passIntercept = intercept;
        a.fsm = "press";
        return;
      }`);
  source = source.slice(0, start) + method + source.slice(end);
  const arrival = '    const arrivalAt = Number.isFinite(a._cornerArrivalAt) ? a._cornerArrivalAt :';
  assert.equal(source.split(arrival).length, 2);
  source = source.replace(arrival, arrival + `
      a._passIntercept && a._passIntercept.passAt === this.ball.lastPassAt && this.ball.kickTeam !== a.team
        ? a._passIntercept.at :`);
  const before = "  _thinkDefend(a, owner) {";
  source = source.replace(before, `  _defensivePassArrival(a) {
    const b = this.ball;
    if (b.owner || b.state !== "pass" || b.kickTeam === a.team || b.isCrossPass ||
        a.sentOff || a.injuredOff || a.role === "GK" || this.t < this.deadBallUntil || b.restartType) return null;
    const until = Math.min(3.4, (b.expectedAt || this.t) - this.t);
    if (until <= 0) return null;
    const trial = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, z: b.z || 0, vz: b.vz || 0 };
    const pressing = this._stepPressing[a.team] || 3;
    const topSpeed = playerRunSpeed(a) * (0.94 + pressing * 0.025);
    const accel = playerAcceleration(a, topSpeed);
    for (let elapsed = SIM.DT; elapsed <= until + 1e-8; elapsed += SIM.DT) {
      trial.x += trial.vx * SIM.DT;
      trial.y += trial.vy * SIM.DT;
      applyFreeBallForces(trial, SIM.DT);
      if (trial.x < 1 || trial.x > 99 || trial.y < 1 || trial.y > 99) return null;
      if (trial.z > 2.2) continue;
      const flown = Number.isFinite(b.kickX) && Number.isFinite(b.kickY)
        ? pitchDistanceBetween(trial.x, trial.y, b.kickX, b.kickY) : Infinity;
      if (flown < 8 && trial.z > 1.1) continue;
      const contactRadius = flown < 8 ? 1.1 : SIM.CONTROL_RADIUS_METRES + pitchSpeedMps(trial.vx, trial.vy) * 0.04;
      const dx = trial.x - a.x, dy = trial.y - a.y;
      const gap = Math.hypot(dx, dy);
      if (gap < 1e-8) return { x: trial.x, y: trial.y, at: this.t + elapsed, passAt: b.lastPassAt };
      const metresPerUnit = pitchDistanceBetween(a.x, a.y, trial.x, trial.y) / gap;
      const heading = Math.atan2(dy, dx);
      const turn = Math.abs(angleDelta(a.heading, heading));
      const speed = topSpeed * clamp(1 - turn / Math.PI * (0.16 - (a.attr.agility || 0.55) * 0.08), 0.82, 1);
      const along = Math.max(0, ((a.vx || 0) * dx + (a.vy || 0) * dy) / gap);
      const accelerateFor = Math.min(elapsed, Math.max(0, speed - along) / accel);
      const reachable = along * accelerateFor + 0.5 * accel * accelerateFor ** 2 + speed * (elapsed - accelerateFor);
      if ((gap - reachable) * metresPerUnit > contactRadius) continue;
      return { x: trial.x, y: trial.y, at: this.t + elapsed, passAt: b.lastPassAt };
    }
    return null;
  }

` + before);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ defensivePassArrivalCandidate: { loadedEngineSha256 } })));
