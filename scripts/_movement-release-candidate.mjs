// Movement-only release: the layers of `_backline-support-release-candidate.mjs`
// that the prefix ladder showed are *not* responsible for the realism-gate
// failure, and that measurably improve shot supply.
//
// Evidence: docs/subbundle-attribution-2026-09-14.md (where the layers were
// isolated) and docs/movement-release-2026-09-15.md (measured result below).
//
// MEASURED, v253 baseline (5f1d152), 24 matches:
//   standard   792 shots / 67 goals (2.79), conversion 8.5%  -> BELOW the 9% floor
//   background 771 shots / 100 goals (4.17)                  -> ABOVE the 3.3 ceiling
// The v253 background baseline is already 3.13, so any candidate that raises
// shot supply pushes it out. Do not adopt as-is; see the reduced candidate.
//
//   kept (movement / support geometry)
//     _coordinated-movement-candidate      winger centring, slot identity,
//                                          runner eligibility, byline recovery
//     _backline-support-candidate          centre-back connection + outlet depth
//                                          (pulls in _fullback-support-candidate)
//     _pass-support-release-candidate      commit the selected third runner
//
//   dropped (each owns a separate failure cause, measured separately)
//     _coordinated-pass-value-candidate    the whole pass-value / interception-risk
//                                          / defensive-pass chain: −97 shots,
//                                          close-range −109, breaks the goal floor
//     _backline-pass-tracking-candidate    moving-press clock + target (defensive)
//     _backline-flight-candidate           defensive flight actor
//     _backline-release-candidate          goalkeeper release / reaction clock /
//                                          contact height: shots flat but goals
//                                          69 → 47, conversion 10.3% → 7.0%
//
// Nothing here changes speed, ability, shooting, saving, or any gate value.
import "./_coordinated-movement-candidate.mjs";
import "./_backline-support-candidate.mjs";
import "./_pass-support-release-candidate.mjs";
