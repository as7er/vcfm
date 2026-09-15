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
//
// MEASURED, HEAD, 96 matches (equal-strength seeds 165000..165095, so the 24-match
// sample above is the first quarter of it):
//   standard   2600 shots / 241 goals (2.51), conversion 9.3%, cross 4.3%,
//              penalties 0.17, strong-team 1.92 -> exit 0, every envelope passes
//   the HEAD baseline on the same 96 seeds reads goals 2.49 -> exit 1, i.e. the
//   baseline itself fails the goals floor at this sample size.
//
// The `penalties 0.08` reading is small-sample noise, not a defect: at 96 matches
// this candidate reads 0.17, identical to the baseline's 4/24 = 0.167, and the
// paired test is 22 : 16 (p = 0.42). The 24-match penalty gate fails 21.2% of the
// time under an unchanged true rate, and across the eight ladder variants the
// penalty counts (4, 6, 6, 3, 4, 5, 4, 2) are *less* dispersed than Poisson noise
// (Cochran p = 86.8%). See docs/movement-release-2026-09-15.md §5.
//
// Note there IS a real code path from these patches to box fouls
// (js/sim/engine.js:3699 and :3801 both gate MID positioning on
// `_isPrimaryMidRunner`), so "no causal path" is not the answer here — the
// settlement is empirical.
//
// Two side effects are real and highly significant at 96 matches: passes +2.2%
// and crosses -17.8% (cross share 5.3% -> 4.3%, still inside the 3-14% envelope
// but with less margin than the baseline).
import "./_runner-only-candidate.mjs";
import "./_byline-recovery-candidate.mjs";
import "./_pass-support-release-candidate.mjs";
