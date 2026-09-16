// Diagnostic candidate: force the background profile to sub-step ball physics on
// EVERY step, instead of only when a player is near the predicted path.
//
// Why: the background profile runs at dt=0.3. `_ballPhysicsFineReason` normally
// returns null unless a player is within CONTROL_RADIUS+2 of the ball's predicted
// path, so a pass crossing open space advances in 0.3s jumps. The interception
// test in `_resolvePossession` is a POINT test — `distance(defender, ball) < 5.0m`
// at the instant it runs — so with 4.5m of ball travel between samples, a defender
// sitting at 4.5-5.0m perpendicular from the path can be skipped entirely.
//
// If that is what makes background through balls survive more often, forcing fine
// steps should close the gap between the two profiles.
//
// This is a DIAGNOSTIC, not a proposed change: it makes background much slower.
// Preload it, run the same probe, compare the background column.
//
//   node --import ./scripts/_always-fine-step-candidate.mjs \
//     scripts/_through-pass-profile-fidelity-probe.mjs 24 372000
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== engineURL) return result;
    let source = String(result.source).replace(/\r\n/g, "\n");
    const anchor = "  _ballPhysicsFineReason(dt) {\n";
    assert.equal(source.split(anchor).length, 2, "unique _ballPhysicsFineReason anchor");
    source = source.replace(
      anchor,
      `${anchor}    if (this.simulationProfile === "background" && dt > SIM.DT + 1e-9) return "forced-fine";\n`
    );
    return { ...result, source };
  },
});
