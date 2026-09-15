// The reduced movement candidate minus its eligibility change.
//
// The full reduced bundle (_movement-reduced-candidate.mjs) was rejected in
// docs/movement-release-2026-09-15.md §6: gate-neutral, no measured mechanism
// benefit, and one reachable silent disablement. This file isolates the other two
// patches so the question "is there anything here worth landing?" can be answered
// separately, because single-patch readings are not additive on this engine.
//
// Why this specific split matters: `_runner-only-candidate.mjs` narrows the
// primary-mid runner pool, and an empty pool makes *no* midfielder hold the slot
// (js/sim/engine.js:3699 and :3801 both gate on it). On the motion guardrail the
// full bundle read oscillation 5 -> 7 and churn 7 -> 6, i.e. the one direction
// that moved was the wrong one. If the eligibility change is what pushes
// oscillation up, it could be masking a real anti-dithering gain from these two,
// which are exactly the patches that target dithering:
//
//   _byline-recovery-candidate      finish the byline retreat before re-advancing
//   _pass-support-release-candidate commit the selected third runner
//
// Decision rule: compare PLAYER_TARGET_CHURN and PLAYER_OSCILLATION against
// HEAD (background 7 / 5) and against the full bundle (6 / 7). Lower on both than
// HEAD is the signal that these two are worth carrying forward.
import "./_byline-recovery-candidate.mjs";
import "./_pass-support-release-candidate.mjs";
