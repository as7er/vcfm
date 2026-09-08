# Reception and contact-clock continuation, 2026-09-09

Starting point: HEAD `941ca12`, with the already verified, uncommitted v250
elapsed-time drag fix. Production engine blob:
`6b51782fa8456c2df43147c6bd49af1406391aa3`. The previous full verification remains
valid for that source, now committed as `27592dc`. The continuation integrates
the synchronous contact clock and timed corner routine as v251; full verification
and the browser continuity audit have both completed with exit code 0. No
calibration envelope or frozen reference has been changed. Circulation and the
old displacement incident remain unresolved.

## Reception timeline

`_reception-chain-observer.mjs` records intended receptions, the physical control
period, first subsequent decision, movement and eventual release. Instrumentation
lives in external WeakMaps. Seed 165000 with observation enabled/disabled has
identical event hash
`67e5a821ad1066b952aeba90d910828c56a7adbdbb394454c36415b668ab5bdd`, state hash
`e073354ae88dbab83cb9ac42b9442d3e2623302a4c3d6b4958001d7eda8dd355`, and 182392
random draws.

Six standard box-audit fixtures, seeds 372000..372005:

| Measure | v250 baseline | Previous `flight_contact` candidate |
| --- | ---: | ---: |
| Intended low, non-cross receptions | 3822 | 3271 |
| Median physical control period | 0.253 s | 0.243 s |
| Median time to first actual decision | 3.2 s | 3.3 s |
| Median forward travel before that decision | 7.19 m | 7.48 m |
| Clear close receptions | 141 | 18 |
| Clear reception no longer clear at first decision | 50 | 8 |

The entire delay is **not** stationary. `_beginBallControl` assigns a default
forward-dribble intention before calling `_nextControlDecision`; after the short
first touch, the receiver executes that intention for several seconds. The
measurement therefore identifies forced initial carrying, not a three-second
stop. The geometric clear-window observations are distinct receptions; their
definition is recorded in the observer and is not an xG model.

## Reception and carrying experiments

All rows below are eight equal-strength standard fixtures, seeds
165000..165007, with `equal-only` explicitly forwarded. They are screening
results, not release approval or estimates of a stable scoring effect.

| Candidate | Goals | Shots | Conversion | Passes | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Decide after physical control for all intended low passes | 1.88 | 25.88 | 7.2% | 1415.13 | Rejected |
| Same, plus `flight_contact` | 1.88 | 23.25 | 8.1% | 1304.38 | Rejected |
| Earlier decision only in a clear, facing-goal close window | 2.25 | 28.25 | 8.0% | 1109.75 | Rejected |
| Same, plus `flight_contact` | 2.00 | 23.25 | 8.6% | 1000.38 | Rejected |
| Steer a carrier around the occupied path | 2.50 | 27.25 | 9.2% | 1090.13 | Penalties 0; not accepted |
| Same, plus `flight_contact` | 1.50 | 22.13 | 6.8% | 981.63 | Rejected |

The broad reception candidate changes only when normal decisions become ready;
physical first touch, settle time, body preparation, shooting cooldowns and
accuracy remain active. The restricted version also requires a reachable low
ball, a goal aperture, an unobstructed lane and compatible body orientation.
Neither version recovers the route candidate's missing production.

The carrying experiment retains the original destination and motor limits but
steers around the existing separation radius. It is an exploratory local
steering rule, not an accepted replacement for football movement decisions.

The restricted reception-plus-route six-match box sample gives 613.12 box
seconds and 38.4% in-box destinations. This is not sufficient for acceptance
given the failed scoring screen. The v250 control still reproduces
1141.30 seconds and 57.8% in-box destinations.

Logs: `.tmp-continuity/reception-*.log` and `carry-lane-*.log`. Raw reception
timelines are under `.tmp-continuity/reception-chain/`; structured calibration
reports are under `.tmp-continuity/pass-routes/`. New reports also hash each local
`--import` preload, since prototype wrappers are not fully described by a hash
of the transformed engine text alone.

## Confirmed background contact-clock defect

The v250 engine advances every player for the whole outer 0.3-second interval before
checking the ball in 0.1-second substeps. Thus the first and second contact
checks see player positions from the end of the interval.

`substep-contact-audit.mjs` checks the distance a constant-speed player could
have travelled at each **actual contact-resolution timestamp**. Four mirrored
background scenarios produce eight violations; the maximum position advance
beyond the elapsed-time bound is 1.12392 m. Four standard scenarios pass.

The synchronous candidate interleaves movement, separation, ball motion and
contact under one substep clock, while retaining the outer decision cadence.
It also processes the remaining interval after an early reception. A new
restart or goal ends the old interval's movement.

An initial prototype reused one separation epoch across multiple movement
substeps. Its bounded correction then measured from an earlier position and
rewound unrelated movement. The added symmetric collision fixture exposes a
0.52314-field-unit y error during a purely horizontal separation. Each physical
substep now has its own correction epoch. `--sync-shared-separation-epoch`
reproduces that rejected prototype for diagnosis.

The corrected candidate initially passed 11 controlled scenarios, including
early reception and restart handling. The final audit adds two mirrored actual
goalkeeper parries and a defender entering the contact window during movement,
for 14 scenarios. All pass against the integrated source. The old engine fails
the temporal bound and discards the post-contact interval.

The old corner routine was also rerun on v250 before any synchronous change:
background 24 equal + 24 strong/weak fixtures give 4.00 goals per match, a frozen
goal delta of +1.33, and fail. The old pre-v250 candidate numbers cannot be reused.
Log: `.tmp-continuity/corner-v250-background.log`.

The rejected shared-epoch synchronous prototype gives 3.54 goals on production
corners and 3.33 with the routine. Those figures do not validate the corrected
candidate; both also fail existing goal checks.

## Contact-clock corrections and corner integration

The second prototype still sampled the contact reason before player movement
and treated every change to `deadBallUntil` as a restart. A goalkeeper's parry
sets that field for temporary protection, although the ball remains in play.
The final implementation classifies contact after movement and uses a restart
sequence changed only by `_restart`, `_kickoff` and `_penaltyKick`. A parry now
advances its remaining flight; the mirrored fixture observes a further 2.0916m
instead of stopping after the first substep.

All rows here use 24 equal-strength plus 24 strong/weak fixtures per profile:

| Prototype / profile | Goals | Conversion | Strong points | Result |
| --- | ---: | ---: | ---: | --- |
| Separate epochs, old contact clock / background | 3.42 | 12.1% | 1.63 | Rejected |
| Same plus all free-ball height gates / background | 3.50 | 12.6% | 1.42 | Rejected |
| Same plus timed corners / background | 2.75 | 10.0% | 1.17 | Rejected |
| Corrected contact clock, original corners / background | 3.42 | 12.1% | 1.92 | Rejected |
| Corrected clock and timed corners / standard | 2.88 | 9.7% | 1.92 | Passed |
| Corrected clock and timed corners / background | 3.21 | 10.9% | 1.83 | Passed |

The accepted combination passes every original frozen-reference tolerance.
Background goal delta is +0.54 against the unchanged 0.55 tolerance, so the
candidate was also expanded to 96 equal and 96 strong/weak fixtures per profile,
including 72 additional seeds in each group. Both expanded runs exit 0:

| Expanded profile | Goals | Shots | Conversion | Completion | Strong points | Corners | Corner shots | Corner goals |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard | 2.92 | 29.61 | 9.8% | 78.9% | 2.02 | 4.76 | 1.95 | 0.14 |
| Background | 3.09 | 28.48 | 10.9% | 79.3% | 1.75 | 3.70 | 1.39 | 0.16 |

Counts are per match, except for the two percentage columns. Background
ball-substep execution share is 30.7%. The unchanged frozen-reference comparison
is checked by the 24-match runs; these expanded runs test additional seeds
against the existing calibration envelope. Logs:
`.tmp-continuity/synchronous-v3-expanded-standard.log` and
`.tmp-continuity/synchronous-v3-expanded-background.log`.

`js/corner-routines.js` now supplies actual engine staging, delivery targets,
attacking runs and defensive marking. Runs begin on this corner's recorded
release and expire when the flight ends. Timed arrival changes the movement
target to compensate for the ordinary stopping radius; it retains the same
speed, acceleration, fatigue and turning limits. Ordinary decisions still run
at the outer-step cadence. The new module is precached for offline use.

The six-match corner structure audit passes all hard constraints. Existing
realism warnings fall from 12 to 3: no staged attacker or delivery in the six-yard
box, and no attacker exceeding 5m in the audit's 2.5-second restart window.
Median delivery depth is 8.5m, keeper depth 1.5m, nearest defender to the corner
9.65m and minimum staged pair spacing 2m. This improves the corner setup but does
not establish that every corner realism target has been met.

The 12-match defending audit passes at 3.42 crowded target pairs per match.
Six-match box sampling passes at 1096.85 seconds, 58.8% in-box destinations and
55 unmarked close chances per match. Circulation therefore remains unresolved.

The final-third movement probe was also rerun on the integrated engine, with
12 control fixtures (seeds 372000..372011). Its wrapped and unwrapped matches
produce identical scores. The primary movement measures still show the original
problem: 9.7% of targets lead the ball by at least 5m, median target lead is
-16.23m, 2.7% extend beyond the offside line, and median player distance from the
line is 19.49m. The secondary near-stationary share is 44.2%, and box possession
is 1119.17 seconds per match in this larger fixture group. This is diagnostic
evidence, not an assertion that the movement defect is fixed. Log:
`.tmp-continuity/v251-final-third-control.log`, exit 0.

## Rejected follow-ups on v251

The corrected clock changes the basis of earlier experiments, so the two
closest circulation candidates were screened again without changing the
production source:

| Candidate | Fixtures per profile | Standard | Background | Decision |
| --- | --- | --- | --- | --- |
| Score a cutback at its actual delivery target | 24 equal + 24 strong/weak | 3.17 goals, strong points 2.00; exit 0 | 3.50 goals, frozen goal delta +0.83; exit 1 | Reject |
| Safe routes, low-ball contact, reachable space and arrival timing (`space_timed`) | 8 equal only | 2.25 goals, 24.25 shots, 9.3% conversion; exit 1 | 3.13 goals, 23.50 shots, 13.3% conversion; exit 1 | Reject |

The cutback candidate still yields 1140.08 box seconds and 56.7% in-box
destinations over six fixtures. Correcting that genuine coordinate mismatch
alone does not fix circulation and fails the background scoring envelope.
The route candidate still reduces shot supply and goalkeeper claims; outside-box
shots account for 50.5% / 55.3%, with goalkeeper claims at 6.13 / 10.38 per match.
An eight-match screen is not full release verification.

The remaining six-yard corner gaps were also tested in isolation with
`_corner-six-yard-candidate.mjs`: shallower near/far delivery zones, longer
approach runs and one wide goalmouth attacker. All 12 controlled mirrored and
reduced-team scenes pass. Six matches produce 35 corners and only one structure
warning, but every delivery chooses the same 4.5m-deep target. The eight-match
equal-only scoring screens fail in opposite directions: standard 2.25 goals
and 8.3% conversion; background 5.00 goals and 17.9% conversion. Both give just
0.38 corner shots per match. This candidate is rejected; its passing structure
audit does not justify changing the match gates or the warning window.

These are process-local experiments only. Logs:
`.tmp-continuity/v251-cutback-*.log`, `v251-space-timed-*.log` and
`v251-shallow-*.log`. Production keeps the three documented corner warnings.

## Implementation equivalence and verification

Four complete matches compare the process-local candidate with the integrated
engine: equal and strong/weak seed 165000/265000 in both profiles. Every rendered
state snapshot and RNG draw count is hashed after every step, as well as the
complete event stream. All hashes and draw counts match. The corresponding
reference/integrated JSON files are byte-identical:

- Standard SHA-256: `31004d929d6bb4c0ef3b5b183f87087ea1f7841e26c6ab840536568aeed4f4b5`.
- Background SHA-256: `9b6b343c6479b6b6192a5a49bc7fe81bed2526a2955d43fb9a057a57c816151b`.

Integrated engine blob: `1241e4d15f4f30c95fcd7c06205faf015191f0a8`.
SHA-256: `3859b6f940238081b06d8fc1a081a4c8e672e2efd696a5c421b8953662434f8c`.
`node scripts/verify.mjs --full` completed on 2026-09-09 with exit code 0 and
final line `VCFM verification passed`. The engine blob and SHA-256 above remain
unchanged before and after the run. All default suites, including five-season
ecology and world invariants, pass. The integrated standard/background
24 equal + 24 strong/weak runs reproduce the candidate's 2.88 / 3.21 goals,
9.7% / 10.9% conversion and 1.92 / 1.83 strong-team points. Every unchanged
frozen tolerance passes; background ball-substep execution share is 30.6%.
Offside events match all 40 decisions over eight matches, with the existing
2.50-per-team-match rate warning retained. The corner audit retains the three
realism warnings described above while passing its hard constraints.

Full log: `.tmp-continuity/synchronous-corner-verify-full.log`.
SHA-256: `fbd6a689f81ee70047bac20fd1ce2ebce69fcadb5df592ac574bd222fb9ddb12`.

The desktop/mobile browser continuity audit exits 0. It records 7695 updates,
7570 moving frames, referee peak speed 3.8m/s, 22 cuts and 30 contacts. Motion
alarms and browser errors are empty; this match also has no player-overlap
diagnostics. The playing mobile pitch is 367 by 551 pixels with no horizontal
overflow. The changing canvas pixels and the desktop/mobile screenshots were
visually checked. Evidence: `.tmp-continuity/visual-1788895641590/`; log:
`.tmp-continuity/synchronous-corner-browser.log`. A clean new match does not
resolve the old displacement incident that lacks original frames.
Browser log SHA-256:
`101f68e788ef71e1ced2ec316e0adda67a89dde637b3bdc84b8e8e2879c7d8aa`.

## Reproduction

```powershell
node --import ./scripts/_reception-chain-observer.mjs scripts/_pass-route-calibration-probe.mjs control 6 box standard
node --import ./scripts/_reception-ready-candidate.mjs scripts/_pass-route-calibration-probe.mjs flight_contact 8 realism standard equal-only --reception-shot-window
node --import ./scripts/_carry-lane-candidate.mjs scripts/_pass-route-calibration-probe.mjs flight_contact 8 realism standard equal-only
node scripts/substep-contact-audit.mjs
node --import ./scripts/_synchronous-step-candidate.mjs scripts/substep-contact-audit.mjs --baseline-v250 --baseline-only --report
node --import ./scripts/_synchronous-step-candidate.mjs scripts/_pass-route-calibration-probe.mjs control 24 realism background --baseline-v250
node --import ./scripts/_synchronous-step-candidate.mjs scripts/_corner-routine-calibration-probe.mjs 24 realism background timed --baseline-v250
node --import ./scripts/_synchronous-step-candidate.mjs --import ./scripts/_shot-chain-observer.mjs scripts/_corner-routine-calibration-probe.mjs 2 trace background timed --baseline-v250 --unobserved --sample-label=reference
node --import ./scripts/_shot-chain-observer.mjs scripts/_corner-integration-sample.mjs 2 background --unobserved --sample-label=integrated
node scripts/_pass-route-calibration-probe.mjs cutback 24 realism background
node scripts/_pass-route-calibration-probe.mjs space_timed 8 realism background equal-only
node --import ./scripts/_corner-six-yard-candidate.mjs scripts/corner-structure-audit.mjs 6
node --import ./scripts/_corner-six-yard-candidate.mjs scripts/_pass-route-calibration-probe.mjs control 8 realism background equal-only
node scripts/_final-third-movement-calibration-probe.mjs 12 control
```

For historical v250 reception samples, preload `_synchronous-step-candidate.mjs`
before the observer/candidate and append `--baseline-v250 --baseline-only`.
`--baseline-v250` reads the pinned v250 Git blob into the process without changing
working-tree files. Without that flag the synchronous loader is a no-op on the
integrated engine, and the timed corner probe only observes the shipped routine.
Add `--sync-v2-contact-clock` to reproduce the second prototype; also add
`--sync-shared-separation-epoch` for the first prototype.

The old 7.532-second displacement recording is still unavailable on this machine.
A newly reproduced clock error is not evidence that it caused that old incident.
