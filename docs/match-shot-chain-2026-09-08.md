# Shot-chain diagnosis, 2026-09-08

Starting point: HEAD `2c9c1d4`, engine blob
`9f32cb4902ac2c74ce965cc8d31be8c4c0436e13`, cache `vcfm-v248`.
The implemented change is the shared ballistic/bounce solver for shots, cache
`vcfm-v249`. Shot accuracy, decision cooldowns, goalkeeper probabilities, realism
envelopes and frozen calibration references are unchanged.

## What the observation establishes

The observer hooks the actual decision locals, shot launch, goalkeeper and
blocking attempts, goal-line crossing and final event. It captures serialized
launch states with linked agent Maps preserved. It does not make extra decisions
or consume random draws. A complete seed-165000 control match with observation
enabled/disabled has identical event and final-state hashes and exactly 182392
random draws. This is one complete-match invariance check, not just equal scores.
Decision rows cover the ordinary shooting-zone branch; restart-specific decisions
use other paths. Shot events are observed regardless of the decision branch.

Eight equal matches per sample, seeds 165000..165007:

| Engine/profile | All shots / goals | Ordinary shots / goals | Ordinary aims outside posts | Ordinary aims inside frame |
| --- | ---: | ---: | ---: | ---: |
| Production before fix, standard | 226 / 22 | 221 / 18 | 181 / 221 | 35 / 221 |
| Prior `flight_contact`, standard | 178 / 17 | 174 / 15 | 135 / 174 | 32 / 174 |
| Prior `flight_contact`, background | 166 / 19 | 166 / 19 | 130 / 166 | 33 / 166 |
| `flight_contact` plus ballistic fix, standard | 184 / 13 | 182 / 12 | 139 / 182 | 34 / 182 |

"Ordinary" excludes penalties, whose separate procedure emits a shot without
the same aim coordinates or free-flight state. "Inside frame" refers to the
chosen horizontal/vertical target, not a conventional on-target statistic:
keepers can touch a ball that would miss, and ball physics changes its height.
Some early JSON summaries used all shot events as the aim denominator; the
table above recalculates that denominator from the saved ordinary-shot records.
The final observer reports the valid aim denominator explicitly.

In this eight-match window the route candidate loses shot volume while ordinary
conversion remains similar (8.1% versus 8.6%). It does not establish that every
window has the same conversion: the earlier 24-match candidate failed at 8.1%
overall conversion. Close central, unpressured shots drop from 41 to 33.
"Clear" here means ball within 16.5m, goal aperture above 0.35 radians, nearest
outfielder farther than 3m, and centre lane clearance above 1.1m.

For the standard route sample, 101 of 200 clear decision observations are denied
by the team cooldown. These observations include repeated decisions within the
same possession; they are not 200 independent chances. The large horizontal aim
spread is shared by the old and candidate engines. Neither this evidence nor
the eight-match goal count establishes that goalkeepers should be weakened.

## Reproduced physical defect and fix

The old shot integrator advanced height as `z += vz * dt`, then applied gravity
to velocity. Launch aiming and goal-line interpolation instead assumed
`z = z0 + vz0*t - 9*t*t`. The missing half-gravity displacement accumulated a
positive height error even before any contact or bounce. At `dt=0.1`, starting
from `z=1, vz=3`, height after 0.4s was 1.12m instead of 0.76m.

Shots now use the existing `applyFreeBallForces`, including the same in-step
ground contact and rebound as other free balls. The redundant shot-only solver
has been removed. No additional random number is used, and launch speed, chosen
target and skill parameters are unchanged. `shot-flight-audit.mjs` covers 28
ballistic, mirrored goal-line and bounce cases and is included in default verify.
Its closed-form height assertion fails on the old engine and passes on the fix.

The saved standard route sample contains 174 ordinary launches. Replaying the
same launches without players gives mean goal-line height error **0.343213m**
before the fix and approximately **1e-13m** after it. Free-flight goals change
28 to 30, high exits 47 to 32, and woodwork 8 to 6. No chosen in-frame target in
this sample becomes a high exit in the old solver; the controlled mirrored
fixture supplies that boundary case. This is a real physical defect with a small
observed scoring effect, not an explanation for the entire circulation problem.

The full-flight replay restores the same launch scene into both production
profiles, then advances their real `step()` with eight common RNG seeds per
launch (1392 trials/profile). These are independent episode replays, not exact
continuations of the original match RNG. Goals change 123 to 132 in standard and
119 to 133 in background. Profile outcomes agree on roughly 90% of paired trials;
different player scheduling and subsequent RNG consumption remain involved.

## Verification

The integrated production source passed `node scripts/verify.mjs --full` on
2026-09-08 with exit code 0 and final line `VCFM verification passed`. This covers
JavaScript syntax, every default suite and both realism profiles, each with 24
equal-strength matches plus 24 strong-versus-weak fixtures. The two profile
results reproduce the earlier process-local physical candidate:

| Profile | Goals | Shots | Conversion | Completion | Strong-team points |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard | 3.00 | 27.96 | 10.7% | 79.3% | 1.92 |
| Background | 3.17 | 28.33 | 11.2% | 78.9% | 1.79 |

Both pass the existing intrinsic envelopes and every frozen-reference
tolerance. Goalkeeper contact, five-season ecology, world invariants, offside
event integrity and corner hard constraints also pass. The 12 existing corner
realism warnings remain. Background `extraStepSharePct` is 31.7 against its
unchanged ceiling of 32.

The engine was unchanged throughout verification and has Git blob
`03d6f0018f1c9bc5766a2f5e1379080de73c5a5d` and SHA-256
`7e674ff2a61b385f81bae1add54f5dbd2d0d262ef411ad2a6cd10244e7c5bf31`.
Full log: `.tmp-continuity/shot-chain-verify-full.log`.

The browser continuity audit against the integrated source exits 0: both halves,
desktop 1x/4x and 390x844 mobile, 7045 frame updates, maximum referee speed 3.8m/s.
Teleport, display-divergence and owner-ball-gap counts and browser errors are all
zero. Eleven player-overlap diagnostics remain; do not describe all diagnostics
as zero. The mobile pitch is 367x551 with no horizontal overflow. Desktop/mobile
screenshots were inspected and canvas-pixel checks confirm moving, nonblank
rendering. Artifacts: `.tmp-continuity/visual-1788872853152/`.

The route-plus-physics screen is still rejected: 13 goals from 184 attempts over
eight matches does not recover adequate production. The prior pass-route
candidate, final-third movement and corner rework have not been integrated.
The old 7.532s displacement incident remains unresolved.

The integrated-source box audit passes at 1141.3 box seconds per match, 57.8%
in-box destinations and 53 unmarked close chances per match. Box-defending passes
with 4.58 crowded target pairs per match. These values meet the current regression
ceilings but do not improve the circulation problem; future circulation
experiments need to use this new engine baseline.

## Reproduction

```powershell
node --import ./scripts/_shot-chain-observer.mjs scripts/_pass-route-calibration-probe.mjs control 8 shots standard
node --import ./scripts/_shot-chain-observer.mjs scripts/_pass-route-calibration-probe.mjs control 1 shots standard --unobserved
node --import ./scripts/_shot-chain-observer.mjs scripts/_pass-route-calibration-probe.mjs flight_contact 8 shots standard
node scripts/shot-flight-audit.mjs
node scripts/_shot-chain-replay.mjs <saved-launches.bin> 8
node --import ./scripts/_shot-flight-candidate.mjs scripts/_shot-chain-replay.mjs <saved-launches.bin> 8 --legacy-shot
node scripts/verify.mjs --full
node scripts/match-continuity-browser.mjs
```

The `--legacy-shot` loader reads the pinned pre-fix engine blob from Git into the
process; it does not restore any working-tree file. Without that flag, the
loader is a no-op once the physical fix is integrated. Old snapshots retain the
original engine hash. Replay output uses unique filenames and records the input
and current engine hashes plus loader arguments.
Sample commands use the currently integrated engine. To reproduce the pre-fix
rows, preload `_shot-flight-candidate.mjs` before the observer and append
`--legacy-shot`. That command was checked after integration and still reproduces
the original seed-165000 event/state hashes and random-draw count.

Evidence lives under `.tmp-continuity/shot-chain/`; the binary snapshots preserve
the launch state, and adjacent JSON contains all decision and outcome records.
Top-level logs include `shot-chain-control-unobserved.log`,
`shot-replay-control-ordinary.log`, `shot-replay-ballistic-ordinary.log`,
`shot-ballistic-realism-standard.log`, `shot-ballistic-realism-background.log`,
`shot-chain-verify-full.log` and `shot-chain-browser.log`.
