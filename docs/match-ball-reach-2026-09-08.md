# Ball reach and movement continuation, 2026-09-08

Starting point: HEAD `941ca12`, cache `vcfm-v249`, engine blob
`03d6f0018f1c9bc5766a2f5e1379080de73c5a5d`, SHA-256
`7e674ff2a61b385f81bae1add54f5dbd2d0d262ef411ad2a6cd10244e7c5bf31`.
Experiments below use process-local source hooks. The adopted change is
elapsed-time air drag, cache `vcfm-v250`. Height, support and coarse-flight
substep candidates have not been integrated. No realism envelope or frozen
reference has been changed.

## Confirmed reach defect

The existing interception and collection height exclusions depend on
`isCrossPass`. An ordinary lofted pass, a through ball or a loose rebound can
therefore be collected above the same player's established reach. The final
fixture covers both teams and profiles, interception, intended reception and
goalkeeper collection, with heights below, exactly at and above the existing
2.2m/3m thresholds. All 144 cases pass with the all-free-ball candidate. The
original 72-case fixture recorded 24 unreachable collections in production and
zero with the pass-only candidate; loose-ball cases were added afterwards.

The read-only observer records actual selected candidates and successful
`_beginBallControl` calls. In six standard box-audit matches (372000..372005),
production records 40 ordinary-pass, one through-pass and 13 loose-ball
collections above reach. The maximum height is 5.39m. Attempt counts include
repeated failed attempts; they must not be treated as distinct flights.

Observation enabled/disabled on seed 165000 gives the same event hash
`67e5a821ad1066b952aeba90d910828c56a7adbdbb394454c36415b668ab5bdd`,
state hash `e073354ae88dbab83cb9ac42b9442d3e2623302a4c3d6b4958001d7eda8dd355`
and 182392 random draws. Both runs also use the existing shot observer and route
control wrapper; only the new reach observer differs.

## Height candidate results

| Candidate | Standard goals / conversion | Background goals / conversion | Result |
| --- | --- | --- | --- |
| Pass height only, 8 equal + 16 strong/weak | 2.63 / 10.4% | Not run | Corner shots 0.25, below 0.5 |
| Pass height plus prior `flight_contact`, 8 + 16 | 2.00 / 8.7% | Not run | Rejected |
| All free-ball heights, 24 + 24 | 2.58 / 9.5% | 3.42 / 12.3% | Standard passes; background fails |
| All heights, height-aware scheduling and free-flight substeps, 24 + 24 | Standard-step behavior unchanged | 3.42 / 12.3% | Background still fails |

The initial eight-equal-match all-height screen failed in standard (2.00 goals,
7.8% conversion) and passed in background (2.75 goals, 10.2%). The full sample
reverses those pass/fail results. An eight-match screen is not release approval.
The first two commands included `equal-only`, but the old wrapper did not forward
it to the nested audit and ran 16 additional strong/weak fixtures. The wrapper
now forwards that option; each saved report records the actual fixture counts.

Production box sampling reproduces 1141.30 seconds and 57.8% in-box pass
destinations. Pass-height-only gives 1086.88 seconds and 57.1%. The complete
height/flight candidate gives 1087.37 seconds and 56.5%, with zero observed
over-height collections. Unmarked close chances are 50.33 per match and box
defending has 2.75 crowded target pairs per match. These pass existing regression
ceilings but do not solve circulation.

Background's existing interaction predictor examines only horizontal proximity,
even when the entire next step is above reach. The candidate checks the minimum
ballistic height over that interval, retaining fine steps for descent into reach
and pitch boundaries. Eight controlled scheduling cases pass. In the 24-match
comparison, extraStepSharePct falls from 32.2 to 28.5, but goals remain 3.42 and
the frozen goal delta remains +0.75. The candidate remains rejected.

## Support-lane experiment

After the original target and offside processing, a settled ATT/MID supporting
a held ball in the final third can seek a lateral gap of 2, 4 or 6m when a
defender obstructs the lane. It retains the original target depth, player speed,
acceleration and teammate target spacing, and consumes no new random draws.

Eight standard equal fixtures: support alone gives 2.13 goals, 28.63 shots and
7.4% conversion; support plus `flight_contact` gives 1.38 goals, 22.75 shots and
6.0% conversion. The combination does not recover shot supply. Both are rejected;
no depth or clearance parameter sweep was performed.

## Separate free-flight defect

Airborne velocity retention is a fixed 0.992 per integrator call, unlike the
time-scaled ground friction. In addition, ordinary pass movement is internally
substepped to 0.1s but loose-ball movement is not. A 0.3s free-flight call and
three 0.1s calls therefore disagree in horizontal speed and distance.

The first isolated candidate applies `0.992 ** (dt / SIM.DT)` and substeps coarse
free-ball movement with the existing pass solver. Its 27-case fixture checks
elapsed-time drag and mirrored airborne, rolling and bouncing trajectories.
Background 24+24 gives 3.25 goals and 11.4% conversion, but fails the frozen goal
tolerance (+0.58, allowed 0.55). This larger change is not adopted.

The separate drag-only candidate changes just the retention exponent, retaining
the existing integration steps. It passes background 24+24: 3.17 goals, 28.33
shots, 11.2% conversion, 78.9% completion, strong-team points 1.75 and
extraStepSharePct 31.7. All frozen tolerances pass. Standard 0.1s arithmetic is
unchanged; the free-flight candidate's seed-165000 standard match preserves the
event/state hashes and draw count above.

The drag exponent is now in production. `ball-drag-audit.mjs` verifies 30
ground/air, pass/shot/loose and 0.025/0.05/0.1/0.2/0.3s cases and runs in default
verify. The old engine fails the elapsed-time assertion; the integrated source
passes. This fixes damping, not the separate coarse-position approximation or
over-height collection defect. Full integrated verification has passed.

## Integrated verification

The integrated engine has Git blob `6b51782fa8456c2df43147c6bd49af1406391aa3`
and SHA-256 `d1d485355d0c5257088ed6046bc406891533df2e7390bd61bac31d814ecd1334`.
The engine blob was unchanged before and after `node scripts/verify.mjs --full`,
which completed early on 2026-09-09 (Asia/Shanghai), exit code 0 and final line
`VCFM verification passed`. The run includes every default suite and both
profiles, each with 24 equal-strength and 24 strong-versus-weak matches.

| Profile | Goals | Shots | Conversion | Completion | Strong-team points |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard | 3.00 | 27.96 | 10.7% | 79.3% | 1.92 |
| Background | 3.17 | 28.33 | 11.2% | 78.9% | 1.75 |

Both profiles pass all existing calibration envelopes and frozen-reference
tolerances. Background exactly reproduces the drag-only candidate report and
has extraStepSharePct 31.7 (ceiling 32). Five-season ecology, world invariants,
goalkeeper contact, offside event integrity and corner hard constraints pass.
Offside frequency remains 2.75/team/match, above the audit's reference band;
12 existing corner realism warnings and the motion suite's 11 diagnostic
warnings remain. A successful exit does not close those findings.

Integrated box sampling is unchanged: 1141.3 seconds/match, 57.8% in-box pass
destinations, 53 unmarked close chances/match, and box-defending crowded pairs
4.58/match. The circulation problem is still present.

Full log: `.tmp-continuity/ball-reach-verify-full.log`, SHA-256
`d9110a677e7bec551faf21965f6daa5f2909c4bad56d2676359b28f7ebcba69b`.

The browser continuity retry exits 0, reaching both halves and full time with
6063 frame updates, 5948 moving-referee updates and maximum referee speed 3.8m/s.
Teleport, display-divergence, owner-ball-gap and browser-error counts are zero;
this match also records no player-overlap incidents. The mobile in-play pitch is
367x551 with no horizontal overflow. Desktop/mobile screenshots were inspected;
canvas checks confirm nonblank, changing content. These observations do not
resolve the old displacement incident or erase overlap evidence from prior runs.
Artifacts: `.tmp-continuity/visual-1788880883709/`; log:
`.tmp-continuity/ball-reach-browser-retry.log`.

The first browser attempt timed out waiting for the new-game screen. The audit
now uses the existing browser-E2E first-install service-worker reload wait before
creating a game, and captures boot errors and a screenshot on a repeat failure.
No production bootstrap change was made. First-attempt log:
`.tmp-continuity/ball-reach-browser.log`.

## Evidence index

The following files are under `.tmp-continuity/pass-routes/`; each stores its
actual command, preloads, match counts, source hashes and exit code.

| Result | JSON report |
| --- | --- |
| All heights, standard 24+24, passes | `control-realism-24-standard-1788879727603.json` |
| All heights, background 24+24, fails | `control-realism-24-background-1788879454823.json` |
| Height-aware scheduling plus substeps, background, fails | `control-realism-24-background-1788879887049.json` |
| Drag plus free-flight substeps, background, fails | `control-realism-24-background-1788880165357.json` |
| Drag only, background 24+24, passes | `control-realism-24-background-1788880437645.json` |
| Support lanes, eight equal matches, fails | `control-realism-8-standard-1788879562255.json` |
| Support lanes plus contact/routes, eight equal matches, fails | `flight_contact-realism-8-standard-1788879561680.json` |
| Complete height/flight candidate, box sample | `control-box-6-standard-1788879921298.json` |

## Reproduction

```powershell
node scripts/_pass-height-fixture.mjs --report
node --import ./scripts/_pass-height-candidate.mjs scripts/_pass-height-fixture.mjs --baseline-v249 --all-free-heights --height-aware-substeps --free-flight-substeps
node --import ./scripts/_ball-reach-observer.mjs scripts/_pass-route-calibration-probe.mjs control 6 box standard
node --import ./scripts/_pass-height-candidate.mjs scripts/_pass-route-calibration-probe.mjs control 24 realism standard --baseline-v249 --all-free-heights
node --import ./scripts/_pass-height-candidate.mjs scripts/_pass-route-calibration-probe.mjs control 24 realism background --baseline-v249 --all-free-heights --height-aware-substeps --free-flight-substeps
node --import ./scripts/_support-lane-candidate.mjs scripts/_pass-route-calibration-probe.mjs flight_contact 8 realism standard equal-only
node --import ./scripts/_pass-height-candidate.mjs scripts/_free-flight-step-fixture.mjs --baseline-v249 --flight-only --free-flight-substeps
node --import ./scripts/_pass-height-candidate.mjs scripts/_pass-route-calibration-probe.mjs control 24 realism background --baseline-v249 --air-drag-only
node scripts/ball-drag-audit.mjs
```

`_pass-height-fixture.mjs` without `--report` and
`_free-flight-step-fixture.mjs` deliberately assert behavior of unadopted
candidates. They still fail on production and are outside default verification.
Use the documented preload arguments to check those candidates. The production
regression audit is `ball-drag-audit.mjs`.

Structured reports are in `.tmp-continuity/pass-routes/` and
`.tmp-continuity/ball-reach/`. The route wrapper now records original arguments,
preloads and loaded-engine hash in addition to disk-source hashes and exit code.
For combined prototypes, also consult the entry and preload source plus their
reported hashes; a `control` label alone does not identify the production engine.
`--baseline-v249` reads the pinned starting blob from Git without changing the
working tree. Add `--baseline-only` to load that source without a height/flight
change. Applied transformations are idempotent on the integrated drag fix.

The original 7.532s displacement recording is absent on this machine. There is
no new evidence that resolves that incident. Corner routines remain unintegrated.
