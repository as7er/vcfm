// v11: retain the original off-ball decision cadence. The extra confirmation
// delay was exploratory, unlike the reproduced lease, route and geometry bugs.
import "./_support-offer-defensive-angle-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const original = `const screened = b.owner === owner.id && b.state === "held" && settled &&
    gap(b, target) >= 6 && gap(b, target) < 20 &&
    this._laneSafety(owner, a, target.x, target.y) <= 1.1 / 8;
  const previousScreen = a.supportScreen;
  a.supportScreen = screened ? { at: this.t, ownerId: b.owner,
    attackSince: this._teamAttackSince[a.team], x: anchor.x, y: anchor.y } : null;
  if (screened && previousScreen && previousScreen.at < this.t &&
      previousScreen.ownerId === b.owner && previousScreen.attackSince === this._teamAttackSince[a.team] &&
      gap(previousScreen, anchor) <= 1.5) {`;
  assert.equal(String(result.source).split(original).length, 2);
  const source = String(result.source).replace(original,
    'if (b.owner === owner.id && b.state === "held" && settled && gap(b, target) >= 6 && gap(b, target) < 20 &&\n      this._laneSafety(owner, a, target.x, target.y) <= 1.1 / 8) {')
    .replaceAll("{ a.supportScreen = null; return; }", "return;");
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferPhysicalCandidate: { loadedEngineSha256 } })));
