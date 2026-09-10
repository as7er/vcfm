// v14: preserve a coarse search result that is already minimal to its existing
// 2 m / 2^10 precision. Clearance edges fill missing intervals; they need not
// perturb every valid target by a fraction of a millimetre.
import "./_support-offer-space-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const edits = [
    ["    const searchXs = this._supportOfferSearchXs(a, owner, anchor);",
      "    for (const refine of [false, true]) {\n    const searchXs = refine ? this._supportOfferSearchXs(a, owner, anchor) : [];"],
    ["const probes = edges.flatMap((edge, i) => i ? [(edges[i - 1] + edge) / 2, edge] : []);",
      "const probes = refine ? edges.flatMap((edge, i) => i ? [(edges[i - 1] + edge) / 2, edge] : []) : [2, 4, 6];"],
    ["gap(a, spot) < gap(a, choice) - 1e-7", "gap(a, spot) < gap(a, choice) - (refine ? 2 / 2 ** 10 : 1e-7)"],
    ["    if (choice) offer = { ...choice, at: this.t, ownerId: b.owner,", "    }\n    if (choice) offer = { ...choice, at: this.t, ownerId: b.owner,"],
  ];
  for (const [before, after] of edits) {
    assert.equal(source.split(before).length, 2);
    source = source.replace(before, after);
  }
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferSpaceFallbackCandidate: { loadedEngineSha256 } })));
