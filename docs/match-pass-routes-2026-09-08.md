# Pass routes continuation, 2026-09-08

Baseline: HEAD `2c9c1d4`, production behavior from `2c7391c`, cache `vcfm-v248`.
The engine Git blob is `9f32cb4902ac2c74ce965cc8d31be8c4c0436e13`.
All candidates here run through process-local loading hooks. No candidate has
been integrated into production, and no calibration assertion or frozen
reference has been changed. Earlier v247 verification remains the production
behavior reference, not evidence that these experiments passed.

## Causal measurement

`_pass-lane-contact-probe.mjs` records player positions when a pass is selected,
when it is released, and when a low ball comes within 1.1m of an active opposing
outfield player before travelling 8m. It also tracks the eventual collector.
The observer does not make decisions or consume random numbers. It delegates
the matches to the existing box audit, using its club construction and seeds.

Six standard matches, seeds 372000..372005, reproduce the previous control's
1100.52 box seconds and 58.1% in-box pass destinations. Of 6861 completed pass
flights, 1505 encounter an early close-contact candidate. For those encounters:

- 92.29% already had that defender in the launch corridor at release, and
  90.10% did at selection.
- Median elapsed flight is 0.1s, travel 1.394m, defender displacement 0.156m.
- 1210 still end in an intended receiver or another teammate's control.
- Box-origin passes account for 546 encounters; 91.39% already had the defender
  in the corridor at release.

These are predominantly choices into an occupied launch lane, not defenders
running in from a distant position. A static occupied corridor alone is not
proof that a lofted ball will hit someone: height at the encounter matters.
Flights still in progress when a match ends are not included in the outcome
counts. The initial four-match control reported 58.25 unmarked chances against
the six-match audit's ceiling of 58; the final six-match control passes at 55.83.

## Route candidates

The route family evaluates the ball's launch position, ignores opponents behind
the launch point in its lane score, and checks close launch obstacles before
selecting an ordinary pass. Cutbacks evaluate their actual shifted destination.
Prepared passes are checked again before release. No variant changes player
attributes, shooting accuracy, referee probabilities or match results.

| Candidate | Standard box seconds (6) | In-box destinations | Standard goals / completion | Background goals / completion |
| --- | ---: | ---: | --- | --- |
| Production control | 1100.52 | 58.1% | Existing production calibration | Existing production calibration |
| `route`: short ground lanes only, existing contact protection | 750.15 | 39.0% | 2.13 / 79.0% (8) | Not run |
| `contact`: short ground routes plus early contact | 468.10 | 37.7% | 2.38 / 74.4% (8) | Not run |
| `flight_contact`: also model medium/long ordinary-pass launch height | 614.28 | 34.5% | 1.83 / 77.6% (24) | 1.96 / 76.8% (24) |
| `finish`: close clear shot can use normal decisions during team cooldown | Not sampled | Not sampled | 2.38 / 78.1% (8) | Not run |
| `space`: offer a reachable lateral destination around a blocked receiver | 762.92 | 42.7% | Not run | Not run |
| `space_timed`: same destinations, timed reception movement | 741.52 | 40.5% | 2.13 / 79.1% (8) | Not run |

Parentheses give equal-strength fixture counts; an 8-match realism invocation
also runs 16 strong-versus-weak fixtures, while 24 runs 24 of each. The route
variants are named independently of the older protection probe's `contact` and
`contact_space`; do not treat identical short names as identical experiments.

`flight_contact` reduces early close-contact candidates from 1505 to 36 across
the six box-audit matches. Its full-match completion is back inside the existing
envelope, but it is rejected for low production. Standard conversion is 8.1%,
outside-box shots 55.8%, shots 22.71 and corner shots 0.25 per match. Background
conversion is 9.3%, but shots are 21.08, penalties 0 and corner shots 0.38.
Both also miss several frozen-reference tolerances, including goalkeeper
claims. Lower box time does not override these failures.

The close-chance observer finds 360 clear, facing-goal decisions in the six
`flight_contact` matches, of which 300 occur during team cooldown. Allowing
normal shooting decisions there raises shots to 33.38 per match in the 8-match
`finish` screen, but conversion falls to 7.1%. `space_timed` conversion is 8.9%.
Neither candidate restores reliable chance creation. Receiver movement uses
the existing acceleration/speed limits and the same timed-arrival approach as
the earlier corner experiment; it does not grant additional speed.

## Cutback destination defect

The production `_bestCutback` assesses safety toward the receiver's current
position, then shifts the actual destination inward and backward. A mirrored
fixture reproduces the mismatch: assessed `(40,16)`, kicked `(41.8,17.5)`.
The `cutback` candidate only moves destination calculation before safety
evaluation and passes that destination to the existing scorer.

The four fixture cases check that assessment, flight target and emitted pass
coordinates agree, with no extra random draws. The standalone production
fixture intentionally fails until a full-match-compatible fix is accepted.

| Candidate | Standard 24 | Background 24 | Decision |
| --- | --- | --- | --- |
| `cutback` | 2.63 goals, 9.0% conversion, 79.4% completion; exit 0 | 3.46 goals, 12.3% conversion, 79.0% completion | Rejected: background goals exceed 3.3 and frozen goal delta is +0.79 |
| `cutback_phase`: also close the stale set-piece window | 2.54 goals, 9.0% conversion, 79.3% completion; exit 0 | 3.54 goals, 12.9% conversion, 78.9% completion | Rejected: background goals and corner shots 0.46 |

The isolated cutback box sample is 1085.97s with 56.6% in-box destinations. It
fixes a real assessment inconsistency but does not materially solve circulation.
The combined candidate uses exactly the previous phase-boundary experiment:
opposing control, another restart, kickoff or penalty ends the old window;
attacking second balls remain live. Its 56-case mirrored phase fixture passes.

## Reproduction and evidence

Node 22.15+ is required; this session used Node 24.17.0 on Windows. Commands run
from the repository root. Use separate commands for each profile.

```powershell
node scripts/_pass-route-calibration-probe.mjs control 6 lanes standard
node scripts/_pass-route-calibration-probe.mjs flight_contact 1 fixture standard
node scripts/_pass-route-calibration-probe.mjs flight_contact 1 contact standard
node scripts/_pass-route-calibration-probe.mjs flight_contact 6 lanes standard
node scripts/_pass-route-calibration-probe.mjs flight_contact 24 realism standard
node scripts/_pass-route-calibration-probe.mjs flight_contact 24 realism background
node scripts/_pass-route-calibration-probe.mjs cutback 1 cutback standard
node scripts/_pass-route-calibration-probe.mjs cutback 24 realism standard
node scripts/_pass-route-calibration-probe.mjs cutback 24 realism background
node scripts/_pass-route-calibration-probe.mjs cutback_phase 1 phase standard
node scripts/_pass-route-calibration-probe.mjs cutback_phase 24 realism standard
node scripts/_pass-route-calibration-probe.mjs cutback_phase 24 realism background
```

The route fixture passes 72 mirrored launch, height, velocity, dismissal and
preparation cases; the existing short-pass contact fixture passes 16 cases.
Both are controlled geometry checks, not release approval. The isolated
fixtures remain outside `verify.mjs` while their production defects remain.

Original text logs are in `.tmp-continuity/continue-20260908/`. Windows can
interleave stdout's JSON with stderr when an assertion terminates the process.
The final probe therefore also writes parsed report objects to unique JSON
files in `.tmp-continuity/pass-routes/`, together with the engine/candidate
SHA-256, Node version, timestamps, failure reason and actual exit code. Reports
printed by observers during process exit are included too. This structured
capture was added after the full-match candidate runs; it does not retroactively
add metadata to older text logs.

Final checks: all four fixture commands above pass (148 cases total), the
six-match observed control reproduces its original report, changed scripts pass
syntax checks, and the cache audit passes at v248. The final JSON control report
includes the observer's exit-time contact/outcome records. Git diff confirms
production modules and calibration references are unchanged.

The old 7.532s motion incident's original local artifacts are absent on this
machine. No new evidence closes that incident, and this session does not change
the corner routine or motion-diagnostic runtime. Full `verify --full` has not
been rerun because no production code has changed.
