// Choose a traversable continuation once an intended ordinary low pass is
// received. This changes the receiving decision, never the motor controller.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const incoming = "    const incomingVx = b.vx || 0;";
  assert.equal(source.split(incoming).length, 2);
  source = source.replace(incoming, `    const chooseOpenCarry = anticipated && !b.isThroughPass &&
      this.t >= this.deadBallUntil && !b.restartType;
` + incoming);
  const intent = "    a.intent = usesHands ? null : this._forwardDribbleIntent(a);";
  assert.equal(source.split(intent).length, 2);
  source = source.replace(intent, intent + `
    if (chooseOpenCarry) a.intent = this._receptionCarryRoute(a, a.intent);`);
  const anchor = "  _forwardDribbleIntent(a) {";
  assert.equal(source.split(anchor).length, 2);
  source = source.replace(anchor, `  _receptionCarryRoute(a, intended) {
    if (!intended || this._supportRunClear(a, { x: intended.tx, y: intended.ty })) return intended;
    const dx = intended.tx - a.x, dy = intended.ty - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.05) return intended;
    const metres = pitchDistanceBetween(a.x, a.y, intended.tx, intended.ty);
    const desiredHeading = Math.atan2(dy, dx);
    const radius = this.separationMinDistanceUnits;
    const angles = [desiredHeading + Math.PI, desiredHeading + Math.PI / 2, desiredHeading - Math.PI / 2];
    // Boundaries of the occupied angular intervals, including obstacles which
    // intersect only the finite endpoint. These are geometry, not tuned angles.
    for (const o of this.agents) {
      if (o.id === a.id || o.sentOff || o.injuredOff) continue;
      const ox = o.x - a.x, oy = o.y - a.y;
      const distance = Math.hypot(ox, oy);
      if (distance > length + radius || distance < 1e-8) continue;
      const centre = Math.atan2(oy, ox);
      let half;
      if (distance <= radius) half = Math.PI / 2;
      else if (Math.sqrt(distance * distance - radius * radius) <= length) half = Math.asin(radius / distance);
      else half = Math.acos(clamp((distance * distance + length * length - radius * radius) / (2 * distance * length), -1, 1));
      angles.push(centre + half + 1e-6, centre - half - 1e-6);
    }
    let best = null;
    for (const angle of angles) {
      let tx = clamp(a.x + Math.cos(angle) * length, 4, 96);
      let ty = clamp(a.y + Math.sin(angle) * length, 3, 97);
      const candidateMetres = pitchDistanceBetween(a.x, a.y, tx, ty);
      if (candidateMetres > metres) {
        const ratio = metres / candidateMetres;
        tx = a.x + (tx - a.x) * ratio;
        ty = a.y + (ty - a.y) * ratio;
      }
      if (pitchDistanceBetween(a.x, a.y, tx, ty) < 0.05 || !this._supportRunClear(a, { x: tx, y: ty })) continue;
      const heading = Math.atan2(ty - a.y, tx - a.x);
      const deviation = Math.abs(angleDelta(desiredHeading, heading));
      const turn = Math.abs(angleDelta(a.heading, heading));
      if (!best || deviation < best.deviation - 1e-9 ||
          Math.abs(deviation - best.deviation) < 1e-9 && turn < best.turn - 1e-9) {
        best = { tx, ty, deviation, turn };
      }
    }
    return best ? { type: "dribble", tx: best.tx, ty: best.ty } : { type: "hold", tx: a.x, ty: a.y };
  }

` + anchor);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ receptionPathCandidate: { loadedEngineSha256 } })));
