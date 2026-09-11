// Split one contiguous diagnostic sample without changing any engine code or
// validation threshold. The original 24-seed result remains a separate gate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const arg = process.argv.find((value) => value.startsWith("--seed-offset="));
const offset = Number(arg?.slice("--seed-offset=".length));
assert.ok(Number.isInteger(offset) && offset >= 0 && offset % 24 === 0);
const auditURL = new URL("./match-realism-audit.mjs", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== auditURL) return result;
  let source = String(result.source);
  const originalAuditSha256 = createHash("sha256").update(source).digest("hex");
  function replace(anchor, replacement) {
    assert.equal(source.split(anchor).length, 2, `unique seed-window anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  }
  replace("const seed = 165000 + match;", `const seed = 165000 + ${offset} + match;`);
  replace("265000 + match);", `265000 + ${offset} + match);`);
  replace("console.log(JSON.stringify(report, null, 2));", `console.log(JSON.stringify({ ...report,
    rawSample: { offset: ${offset}, originalAuditSha256: "${originalAuditSha256}",
      totals, integration, stallSeeds, strongPoints, strongWins, strongGoals, weakGoals }
  }, null, 2));`);
  return { ...result, source };
} });
