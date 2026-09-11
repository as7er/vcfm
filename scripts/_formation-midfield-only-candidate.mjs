// Isolate slot identity from changes to attacking target geometry. Preserve
// existing legal defaults, including the deeper midfielder in a staggered line.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const root = new URL("../js/", import.meta.url);
const hashes = {};
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  let source = String(result.source);
  if (url === new URL("player-positions.js", root).href) {
    source = source.replace(/\r\n/g, "\n");
    const before = '    if (x <= 28) return "LM";\n    if (x >= 72) return "RM";';
    assert.equal(source.split(before).length, 2);
    source = source.replace(before, '    if (x < 26) return "LM";\n    if (x > 74) return "RM";');
  } else if (url === new URL("data.js", root).href) {
    source = 'import { slotPositionCode } from "./player-positions.js";\n' + source;
    const begin = source.indexOf("export function defaultRoleForSlot(");
    const end = source.indexOf("\nexport function roleLabel(", begin);
    assert.ok(begin > 0 && end > begin);
    let method = source.slice(begin, end);
    method = method.replace('  const wide = x <= 28 || x >= 72;',
      '  const code = slotPositionCode(slot, index, slots);\n  const wide = ["LB", "RB", "LM", "RM", "LW", "RW"].includes(code);');
    method = method.replace('if (y <= minY + 4 && maxY - minY > 6) return "am_play";',
      'if (code === "AM") return "am_play";');
    assert.ok(method.includes('const code = slotPositionCode(slot, index, slots);'));
    source = source.slice(0, begin) + method + source.slice(end);
  } else return result;
  hashes[url.slice(root.href.length)] = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ formationMidfieldOnlyCandidate: hashes })));
