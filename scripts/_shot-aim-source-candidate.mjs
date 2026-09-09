// Use the lane assessed by _goalOpportunity as the intended aim. Keep the
// existing error distribution, shot power and random draws unchanged.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source).replace(/\r\n/g, "\n");
  const replacements = [
    ['this._queueBallAction(a, "shot", 50, goalY, extraMeta)',
      'this._queueBallAction(a, "shot", opportunity.targetX, goalY, extraMeta)'],
    ['const aimCentre = placesShot ? 50 + placementSide * (2.8 + this.random()) : 50;',
      'const aimCentre = placesShot ? 50 + placementSide * (2.8 + this.random()) : opportunity.targetX;'],
  ];
  for (const [anchor, replacement] of replacements) {
    assert.equal(source.split(anchor).length, 2, `unique shot aim anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  }
  return { ...result, source };
} });
