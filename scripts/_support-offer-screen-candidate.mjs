// v8: confirm a stable passing obstruction at the next ordinary off-ball
// decision. A single transient shadow does not immediately move a settled outlet.
import "./_support-offer-run-route-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const start = 'if (b.owner === owner.id && b.state === "held" && settled && gap(b, target) >= 6 && gap(b, target) < 20 &&\n      this._laneSafety(owner, a, target.x, target.y) <= 1.1 / 8) {';
  assert.equal(source.split(start).length, 2);
  source = source.replace(start, `const screened = b.owner === owner.id && b.state === "held" && settled &&
    gap(b, target) >= 6 && gap(b, target) < 20 &&
    this._laneSafety(owner, a, target.x, target.y) <= 1.1 / 8;
  const previousScreen = a.supportScreen;
  a.supportScreen = screened ? { at: this.t, ownerId: b.owner,
    attackSince: this._teamAttackSince[a.team], x: anchor.x, y: anchor.y } : null;
  if (screened && previousScreen && previousScreen.at < this.t &&
      previousScreen.ownerId === b.owner && previousScreen.attackSince === this._teamAttackSince[a.team] &&
      gap(previousScreen, anchor) <= 1.5) {`);
  const eligible = '["third-man-run", "cutback-outlet", "one-two"].includes(a.offBallTarget?.kind)) return;';
  const deep = 'if (Math.abs(b.y - this.targetGoalY(a.team)) * my >= 38) return;';
  assert.equal(source.split(eligible).length, 2);
  assert.equal(source.split(deep).length, 2);
  source = source.replace(eligible, eligible.replace("return;", "{ a.supportScreen = null; return; }"))
    .replace(deep, deep.replace("return;", "{ a.supportScreen = null; return; }"));
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferScreenCandidate: { loadedEngineSha256 } })));
