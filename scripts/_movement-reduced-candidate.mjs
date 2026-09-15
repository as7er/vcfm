// Reduced movement candidate: only the patches that pass every calibration
// envelope when run alone on HEAD (standard, 24 matches).
//
// Evidence: docs/movement-release-2026-09-15.md
//
//   kept — each passed the full envelope set on its own
//     _runner-only-candidate          primary-mid runner eligibility
//     _byline-recovery-candidate      complete the retreat before re-advancing
//     _pass-support-release-candidate commit the selected third runner
//
//   dropped — each trips an envelope on its own
//     _wing-centering-candidate       strong-team points 2.04 → 1.13 (floor 1.5)
//     _formation-midfield-only-candidate
//                                     goals 2.42 (floor 2.5), cross share
//                                     5.0% → 2.8% (floor 3%), strong-team
//                                     points 1.00
//
// Single-patch readings are not additive on this engine, so the combination
// still has to be measured rather than assumed — that is what this file is for.
//
// MEASURED, HEAD, 24 matches:
//   background 625 shots / 70 goals (2.92), conversion 11.2%, cross 5.0%,
//              strong-team 1.79  -> exit 0, every envelope passes
//   standard   640 shots / 63 goals (2.63), conversion 9.8%, cross 4.2%,
//              strong-team 1.67  -> only `penalties 0.08` fails (envelope 0.1-0.5)
// The standard-profile penalty reading is 2 spot kicks in 24 matches against 4
// for the baseline. That has to be shown to be small-sample noise (or shown to
// have no causal path from these patches) before this candidate can be adopted;
// see docs/movement-release-2026-09-15.md §5.
import "./_runner-only-candidate.mjs";
import "./_byline-recovery-candidate.mjs";
import "./_pass-support-release-candidate.mjs";
