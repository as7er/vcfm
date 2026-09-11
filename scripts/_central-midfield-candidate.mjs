// The half-space slots at x=28/72 in a three-man midfield are central mids.
// Use the same detailed slot position for default roles and match assignment.
import "./_wing-centering-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const root = new URL("../js/", import.meta.url);
const hashes = {};
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  let source = String(result.source);
  if (url === new URL("player-positions.js", root).href) {
    const before = '    if (x <= 28) return "LM";\r\n    if (x >= 72) return "RM";';
    source = source.replace(/\r\n/g, "\n");
    const normalized = before.replace(/\r\n/g, "\n");
    assert.equal(source.split(normalized).length, 2);
    source = source.replace(normalized, '    if (x < 26) return "LM";\n    if (x > 74) return "RM";');
  } else if (url === new URL("data.js", root).href) {
    source = 'import { slotPositionCode } from "./player-positions.js";\n' + source;
    const begin = source.indexOf("export function defaultRoleForSlot(");
    const end = source.indexOf("\nexport function roleLabel(", begin);
    assert.ok(begin > 0 && end > begin);
    source = source.slice(0, begin) + `export function defaultRoleForSlot(slot, index = 0, slots = []) {
  if (!slot) return "cm_box";
  const code = slotPositionCode(slot, index, slots);
  const x = slot.x ?? 50;
  if (code === "GK") return "gk_std";
  if (code === "LB" || code === "RB") return "fb_wb";
  if (code === "CB") return x > 42 && x < 58 ? "cb_ball" : "cb_central";
  if (code === "LM" || code === "RM") return "winger";
  if (code === "DM") return "dm_hold";
  if (code === "AM") return "am_play";
  if (code === "CM") return "cm_central";
  if (code === "LW" || code === "RW") return "st_winger";
  const attackers = slots.filter((s) => s.pos === "ATT").length;
  return attackers >= 2 && index % 2 === 0 ? "st_target" : "st_advanced";
}
` + source.slice(end);
  } else return result;
  hashes[url.slice(root.href.length)] = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ centralMidfieldCandidate: hashes })));
