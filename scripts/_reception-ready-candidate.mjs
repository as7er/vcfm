// Process-local experiment: an intended low-pass receiver has seen the ball
// coming and can reconsider the next action once the physical first touch ends.
// Preserve the existing control, settle, body-turn and shooting rules.
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const symbol = Symbol.for("vcfm.reception-ready-candidate");
const shotWindowOnly = process.argv.includes("--reception-shot-window");
const counts = { anticipated: 0, ready: 0 };
globalThis[symbol] = (SimEngine, SIM) => {
  function hasShotWindow(engine, a, heading) {
    if (process.argv.includes("--contact-window") && engine._probeHasCloseShot) {
      return engine._probeHasCloseShot(a, heading, true);
    }
    const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
    const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
    const b = engine.ball;
    const dy = (engine.targetGoalY(a.team) - b.y) * my;
    const dx = (50 - b.x) * mx;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.1 || distance > 16.5) return false;
    const left = Math.atan2(dy, (SIM.GOAL_X0 - b.x) * mx);
    const right = Math.atan2(dy, (SIM.GOAL_X1 - b.x) * mx);
    const aperture = Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
    if (aperture < 0.35) return false;
    const hx = Math.cos(heading) * mx;
    const hy = Math.sin(heading) * my;
    if ((hx * dx + hy * dy) / (Math.hypot(hx, hy) * distance) < 0.5) return false;
    for (const o of engine.agents) {
      if (o.team === a.team || o.role === "GK" || o.sentOff || o.injuredOff) continue;
      const ox = (o.x - b.x) * mx;
      const oy = (o.y - b.y) * my;
      const along = (ox * dx + oy * dy) / distance;
      if (along > 0 && along < distance && Math.abs(ox * dy - oy * dx) / distance <= 1.1) return false;
    }
    return true;
  }
  const begin = SimEngine.prototype._beginBallControl;
  SimEngine.prototype._beginBallControl = function (a, options) {
    const b = this.ball;
    const observedFlight = Math.max(0, this.t - (b.lastPassAt ?? this.t));
    const anticipated = a.role !== "GK" && b.state === "pass" &&
      b.receiverId === a.id && b.kickTeam === a.team &&
      !b.isCrossPass && (b.z || 0) <= 0.8;
    const result = begin.call(this, a, options);
    if (anticipated) {
      counts.anticipated++;
      if (!shotWindowOnly || hasShotWindow(this, a, result.desiredHeading)) {
        counts.ready++;
        const plannedAt = process.argv.includes("--flight-anticipation")
          ? a.decisionUntil - observedFlight : -Infinity;
        a.decisionUntil = Math.min(a.decisionUntil,
          Math.max(a.controlUntil, this.ball.settleUntil || a.controlUntil, plannedAt));
      }
    }
    return result;
  };
};
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  return { ...result, source: `${result.source}\nglobalThis[Symbol.for("vcfm.reception-ready-candidate")](SimEngine, SIM);\n` };
} });
process.on("exit", () => console.log(JSON.stringify({ receptionReadiness: { shotWindowOnly, ...counts } }, null, 2)));
