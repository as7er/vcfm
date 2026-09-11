// A newly blocked carry invalidates the previous choice. React once using the
// existing close-pressure reaction delay; persistent contact does not spam AI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const marker = "  _decideOnBall(a) {";
  assert.equal(source.split(marker).length, 2);
  source = source.replace(marker, `  _reactToCarryContact(a) {
    const b = this.ball, intent = a.intent;
    if (b.owner !== a.id || b.state !== "held" || intent?.type !== "dribble" ||
        b.restartType || this.t < (this.deadBallUntil || 0)) {
      a._carryContact = null;
      return;
    }
    const dx = intent.tx - a.x, dy = intent.ty - a.y;
    const squared = dx * dx + dy * dy;
    if (squared < 1e-8) { a._carryContact = null; return; }
    const startedAt = b.controlStartAt || 0;
    const previous = a._carryContact;
    const known = previous?.startedAt === startedAt && this.agentById(previous.opponentId);
    // The existing four-unit dribbling-pressure zone provides release hysteresis.
    if (known && !known.sentOff && !known.injuredOff &&
        Math.hypot(known.x - a.x, known.y - a.y) < 4 &&
        (known.x - a.x) * dx + (known.y - a.y) * dy > 0) return;
    a._carryContact = null;
    const blocker = this.agents.find((o) => {
      if (o.team === a.team || o.sentOff || o.injuredOff ||
          Math.hypot(o.x - a.x, o.y - a.y) > this.separationMinDistanceUnits + 1e-6) return false;
      const along = ((o.x - a.x) * dx + (o.y - a.y) * dy) / squared;
      return along > 0 && along < 1;
    });
    if (!blocker) return;
    a._carryContact = { opponentId: blocker.id, startedAt };
    const reactionDelay = clamp(0.34 - ((a.attr.decisions || 0.55) - 0.55) * 0.2, 0.2, 0.4);
    a.decisionUntil = Math.min(a.decisionUntil, this.t + reactionDelay);
  }

` + marker);
  const pending = "      if (this._runPendingBallAction(a)) return;";
  assert.equal(source.split(pending).length, 2);
  source = source.replace(pending, pending + "\n      this._reactToCarryContact(a);");
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ carryContactReactionCandidate: { loadedEngineSha256 } })));
