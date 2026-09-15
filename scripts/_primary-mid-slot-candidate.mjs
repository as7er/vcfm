// Keep the "one midfielder may go forward" slot held by someone actually on the pitch.
//
// js/sim/engine.js:4179 `_isPrimaryMidRunner` selects the team's single
// forward-running midfielder with `mids[0]?.id === a.id`, where `mids` is
//   this.agents.filter((m) => m.team === a.team && m.role === "MID")
// -- no sentOff / injuredOff filter. So when the highest-scoring midfielder is off
// the pitch, `mids[0]` is that player and every on-pitch midfielder returns false:
// *no* midfielder holds the slot.
//
// Two rules are written as "exactly one" and both gate on that slot:
//   :3799-3801  "three forwards + ONE best-suited midfielder" advance in the final
//               third; the rest drop behind the ball
//   :3699       a non-primary midfielder may not take a support spot in the box
// Unheld, both degrade to "zero" -- the mechanic switches off silently. That is a
// property of HEAD, independent of any candidate patch.
//
// The fix is one clause: the pool must be players who can actually run. It only
// changes behaviour in the case where the top-scoring mid is off the pitch.
//
// Evidence: docs/primary-mid-slot-2026-09-15.md
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const begin = source.indexOf("  _isPrimaryMidRunner(a) {");
  const end = source.indexOf("  _defensiveThreats(", begin);
  assert.ok(begin > 0 && end > begin, "could not locate _isPrimaryMidRunner");
  let method = source.slice(begin, end);
  // The same filter text also appears at :3803 inside the final-third rule, so the
  // replacement must be scoped to this method.
  const before = '.filter((m) => m.team === a.team && m.role === "MID")';
  assert.equal(method.split(before).length, 2, "expected exactly one pool filter inside _isPrimaryMidRunner");
  method = method.replace(
    before,
    '.filter((m) => m.team === a.team && m.role === "MID" && !m.sentOff && !m.injuredOff)'
  );
  source = source.slice(0, begin) + method + source.slice(end);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ primaryMidSlotCandidate: { loadedEngineSha256 } })));
