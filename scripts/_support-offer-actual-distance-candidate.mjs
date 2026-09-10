// v15: geometric refinement minimizes the receiver's actual travel, not travel
// from its tactical anchor. A settled receiver can already be in an open spot
// up to 1.5 m from that anchor, so stopping at the first anchor-side opening can
// still make it walk farther or even leave a valid current position.
import "./_support-offer-space-fallback-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const before = `    for (const refine of [false, true]) {
    const searchXs = refine ? this._supportOfferSearchXs(a, owner, anchor) : [];
    for (const side of [preferredSide, -preferredSide]) {
      const edges = [...new Set([0, 2, 4, 6, ...searchXs.map((x) => (x - target.x) * mx * side)
        .filter((offset) => offset > 0 && offset < 6)])].sort((x, y) => x - y);
      const probes = refine ? edges.flatMap((edge, i) => i ? [(edges[i - 1] + edge) / 2, edge] : []) : [2, 4, 6];`;
  const after = `    for (const refine of [false, true]) {
    const originX = refine ? a.x : target.x;
    if (refine && available(originX)) choice = { x: originX, y: anchor.y };
    const searchXs = refine ? [...this._supportOfferSearchXs(a, owner, anchor),
      ...[-6, -4, -2, 0, 2, 4, 6].map((offset) => anchor.x + offset / mx)] : [];
    for (const side of [preferredSide, -preferredSide]) {
      const edges = [...new Set([0, ...searchXs
        .filter((x) => Math.abs(x - anchor.x) * mx <= 6 + 1e-7)
        .map((x) => (x - originX) * mx * side).filter((offset) => offset > 0)])].sort((x, y) => x - y);
      const probes = refine ? edges.flatMap((edge, i) => i ? [(edges[i - 1] + edge) / 2, edge] : []) : [2, 4, 6];`;
  assert.equal(source.split(before).length, 2);
  source = source.replace(before, after);
  for (const expression of ["target.x + offset * side / mx", "target.x + middle * side / mx", "target.x + upper * side / mx"]) {
    assert.equal(source.split(expression).length, 2);
    source = source.replace(expression, expression.replace("target.x", "originX"));
  }
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferActualDistanceCandidate: { loadedEngineSha256 } })));
