// Apply the existing physical arrival controller to a designated pass receiver.
// This changes braking, never the player's speed, acceleration or turning limits.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
globalThis[Symbol.for("vcfm.receiver-arrival-candidate")] = true;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source).replace(/\r\n/g, "\n");
  const anchor = '    if (!Number.isFinite(a._cornerArrivalAt) || this.ball.owner || this.ball.state !== "pass") {';
  assert.equal(source.split(anchor).length, 2, "unique timed-arrival controller");
  source = source.replace(anchor,
    '    const arrivalAt = Number.isFinite(a._cornerArrivalAt) ? a._cornerArrivalAt :\n' +
    '      this.ball.receiverId === a.id && this.ball.kickTeam === a.team ? this.ball.expectedAt : null;\n' +
    '    if (!Number.isFinite(arrivalAt) || this.ball.owner || this.ball.state !== "pass") {');
  source = source.replace('a._cornerArrivalAt - this.t - step * stepDt -', 'arrivalAt - this.t - step * stepDt -');
  return { ...result, source };
} });
