// v7: the receiver must be able to walk into the selected opening without
// crossing another player's existing physical separation envelope.
import "./_support-offer-lease-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

function supportRunClear(a, target) {
  const dx = target.x - a.x;
  const dy = target.y - a.y;
  const squared = dx * dx + dy * dy;
  if (squared < 1e-8) return true;
  // Use the same envelope as _separateAgents, including its existing field-unit
  // geometry. Moving away from an existing contact remains allowed.
  return !this.agents.some((other) => {
    if (other.id === a.id || other.sentOff || other.injuredOff) return false;
    const along = ((other.x - a.x) * dx + (other.y - a.y) * dy) / squared;
    if (along <= 0) return false;
    const progress = Math.min(1, along);
    return Math.hypot(other.x - a.x - dx * progress, other.y - a.y - dy * progress) <
      this.separationMinDistanceUnits - 1e-6;
  });
}
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const retention = "if (!receivingSpace || this._laneSafety(owner, a, offer.x, offer.y)";
  const selection = "if (this._laneSafety(owner, a, x, y) < 1.8 / 8 ||";
  assert.equal(source.split(retention).length, 2);
  assert.equal(source.split(selection).length, 2);
  source = source.replace(retention,
    "if (!receivingSpace || !this._supportRunClear(a, offer) || this._laneSafety(owner, a, offer.x, offer.y)")
    .replace(selection, "if (!this._supportRunClear(a, spot) || this._laneSafety(owner, a, x, y) < 1.8 / 8 ||");
  source += `\nSimEngine.prototype._supportRunClear = ${supportRunClear.toString()};\n`;
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferRunRouteCandidate: { loadedEngineSha256 } })));
