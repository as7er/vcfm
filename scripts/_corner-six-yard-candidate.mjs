// Isolate the remaining shallow-corner geometry from the accepted timing model.
// Near/far runs enter the six-yard area; a wide attacker contests the goalmouth.
// Staging leaves an actual approach run, using the existing movement limits.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const routineURL = new URL("../js/corner-routines.js", import.meta.url).href;
let routineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== routineURL) return result;
  let source = String(result.source);
  const edits = [
    ["const zones = [at(side * 3, 6.5), at(-side * 0.5, 8.5), at(-side * 4.5, 8)];",
      "const zones = [at(side * 3, 4.5), at(-side * 0.5, 7.5), at(-side * 4.5, 5)];"],
    ["(i === 0 ? 4 : 5) / MY", "(i === 0 ? 5.5 : 6) / MY"],
    ["const support = [at(side * 9, 9.5),", "const support = [at(side * 9, 4.5),"],
  ];
  for (const [anchor, replacement] of edits) {
    assert.equal(source.split(anchor).length, 2, `unique corner anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  }
  routineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ shallowCornerCandidate: { routineSha256 } }, null, 2)));
