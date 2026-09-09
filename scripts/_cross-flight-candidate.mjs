// Ordinary crosses must also arrive at a playable height at their chosen zone.
// The existing corner solver already uses the actual flight and consumes the
// same one delivery-height draw as the old distance-independent cross loft.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  const source = String(result.source);
  const anchor = "if (isCross && fromCorner) {";
  assert.equal(source.split(anchor).length, 2, "unique cross flight setup");
  return { ...result, source: source.replace(anchor, "if (isCross) {") };
} });
