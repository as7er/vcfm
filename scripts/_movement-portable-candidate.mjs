// The HEAD-portable subset of `_movement-release-candidate.mjs`.
//
// `_backline-support-candidate.mjs` (and the `_fullback-support-candidate.mjs`
// it pulls in) cannot load on HEAD: it replaces the whole full-back off-ball
// block and its `end` marker is the v253 centre-back comment text, while HEAD's
// block was rewritten by the far-side full-back fix (`2bd9fa5`, which added
// `blockForward` + `_checkCrowding` there). Porting it therefore means
// reconciling two competing full-back models — a change that needs its own
// validation, not a marker tweak.
//
// Everything else in the movement set does load on HEAD, so this file isolates
// "what the movement work can do without the full-back rewrite".
//
// Evidence: docs/subbundle-attribution-2026-09-14.md and
// docs/movement-release-2026-09-15.md (per-patch ladder R0-R6).
//
// MEASURED, HEAD, 24 matches standard: 638 shots / 66 goals (2.75, identical to
// the HEAD baseline), conversion 10.3%, strong-team points 1.92 — near-neutral
// overall — but cross share 5.0% -> 2.7%, BELOW the 3% floor. The ladder shows
// that loss comes from winger centring (R1) and the formation patch (R2), which
// also collapse strong-team points to 1.13 and goals to 2.42 respectively.
// Use `_movement-reduced-candidate.mjs` instead.
import "./_coordinated-movement-candidate.mjs";
import "./_pass-support-release-candidate.mjs";
