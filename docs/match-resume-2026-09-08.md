# Match simulation continuation, 2026-09-08

Production engine baseline: `2c7391c`. The runtime change in this continuation
preserves the original recording endpoints in motion diagnostic clips. None of
the behavioral candidates below is integrated into `js/sim/engine.js`, and the
realism assertions and frozen reference are unchanged.

The earlier session's corner helper and attack probes remain experimental.
Passing the corner helper's geometry audit does not mean that its full-match
behavior has passed calibration.

## Reproduction

All commands run from the repository root. Pass-protection experiments require
Node 22.15+ (`node:module.registerHooks`); this run used Node 24.18.0.

```powershell
node scripts/match-continuity-audit.mjs
node scripts/_opening-motion-source-probe.mjs 1000 world
node scripts/_pass-release-protection-calibration-probe.mjs control 6 box
node scripts/_pass-release-protection-calibration-probe.mjs contact 1 contact
node scripts/_pass-release-protection-calibration-probe.mjs contact 24 realism standard
node scripts/_pass-release-protection-calibration-probe.mjs contact 24 realism background
node scripts/_corner-routine-calibration-probe.mjs 24 arrival standard timed
node scripts/_corner-routine-calibration-probe.mjs 24 realism standard timed
node scripts/_corner-routine-calibration-probe.mjs 24 realism background timed
node scripts/_attacking-continuation-calibration-probe.mjs relay 12 movement
```

`scripts/_short-pass-contact-probe.mjs` is an intentional reproducer for an
unresolved defect: running it directly against the production engine fails its
first assertion. Through the `contact` wrapper its 16 mirrored contact, height,
reach, and dismissal cases pass. It is not registered in `verify.mjs`.

Every behavioral wrapper runs in its own process. The underlying audit can print
`control` because its prototype is already wrapped by the outer experiment; that
label means the control of that inner probe, not the unmodified engine. Compare
with the separately recorded baseline, not the printed label alone.

## Pass protection

The production free-ball collector excludes opponents until a pass has travelled
8m. A controlled pass can therefore go within 0.5m of a defender without allowing
contact, even when the ball is on the ground and the defender is active.

| Candidate | Box seconds, 6 matches | Standard goals / completion | Background goals / completion |
| --- | ---: | --- | --- |
| Production control | 1100.52 | Existing passing calibration | Existing passing calibration |
| `release`: immunity ends at the existing 2.6m control radius | 725.18 | 1.92 / 39.4% (24) | 2.25 / 39.9% (24) |
| `contact`: only let low balls within 1.1m contact an early opponent | 401.87 | 1.75 / 62.8% (24) | 2.00 / 64.2% (24) |
| `contact_space`: reject obstructed short lanes; keep safe recycling options | 534.58 | 1.13 / 72.1% (8) | Not run |
| `contact_chance`: also allow an unblocked close chance to use normal shot decisions | Not sampled | 1.50 / 72.1% (8) | Not run |

Numbers in parentheses are equal-strength match counts. The realism audit also
runs its own strong-versus-weak fixtures. In `contact_space`, 34.6% of box passes
remain in the box, compared with 58.1% in control. However, shot conversion is only
5.0%; `contact_chance` reaches 6.6% and weakens the ability advantage. These are
rejected implementations, not accepted progress toward a release candidate.

The important causal result is that early-pass immunity supports the existing
possession economy. Removing it independently exposes inadequate pass selection
and insufficient chance creation. Do not reclassify the lower box time by itself
as a solved circulation problem, or retune the immunity distance to fit scores.

Logs: `.tmp-continuity/pass-protection-*.log`.

## Corner arrivals

The unfinished helper stages three runners several metres behind arrival zones.
Ordinary movement slows over a five-unit arrival radius, leaving runners short
while the cross passes through its contest area. A timed-arrival experiment asks
for the speed needed to arrive with the ball, bounded by the same existing speed
and acceleration limits. It does not change player attributes or reception odds.

The controlled 24-corner comparison gives median remaining distance 1.75m ->
0.98m. The first timed experiment uses one movement step (`timed_coarse`); the
subsequent `timed` version subdivides movement to at most 0.1s in the background
profile. Standard integration is identical in both modes.

| Candidate | Standard 24 | Background 24 | Decision |
| --- | --- | --- | --- |
| Original unfinished routine | 2.50 goals, 8.2% conversion | 3.67 goals | Rejected |
| Timed attacking runners, original coarse integration | 2.79 goals, 9.4% conversion, all assertions pass | 3.58 goals | Rejected |
| Timed attacking runners, fine movement substeps | Same standard integration | 3.33 goals | Rejected |
| `duel`: markers also target their runner's arrival zone | 2.54 goals, 7.8% conversion | 3.54 goals, 0.58 penalties | Rejected |
| `phase`: timed runners, end the window on opposing control | 2.33 goals, 8.1% conversion | 3.25 goals, 11.2% conversion; frozen goal delta +0.58 | Rejected |

The controlled comparison isolates the movement defect. It does not establish
that the full routine is ready to ship. The current helper still has no delivery
inside the six-yard box, and its staging remains a separate realism limitation.

Logs: `.tmp-continuity/corner-timed-*.log`, `corner-duel-*.log`, and the preceding
session's `corner-routine-*.log`. The `phase` background run passes the intrinsic
calibration envelope but fails the frozen-reference goal tolerance: +0.58 versus
the allowed +0.55. Its standard comparison also fails the intrinsic goals and
conversion lower bounds. The reference has not been changed.

The isolated phase-boundary candidate is a separate experiment, with original
production corner positions and movement. It ends the set-piece window on
opposing control or a new restart, kickoff or penalty, while retaining attacking
second balls and deflections. The control fails the opposing-control fixture;
the candidate passes 56 mirrored cases in both profiles. Run with
`node scripts/_set-piece-phase-calibration-probe.mjs boundary 24 realism standard`
(or `background`). Full-match results are pending; this is not a shipped fix.
The completed full-match results are recorded below; this is not a shipped fix.

The isolated candidate's standard 24-match run produces 3.13 goals, 9.9%
conversion and 2.42 strong-team points per match; the +0.54 strong-point delta
misses the frozen tolerance by 0.04. Background produces 3.75 goals and 1.33
strong-team points, failing both the goal envelope and ability-separation gate.
The phase boundary is therefore a real state fix with a useful fixture, but is
not ready for production integration.

## Movement and the old incident

The `relay` experiment retains a triggered run through the receiver's control
phase instead of discarding it when the ball arrives. In 12 matches it produces
1091.62 box seconds, 2.33 goals, and a median target lead of -16.15m. It does not
improve the principal movement metric and was not advanced to release testing.

The pass-reception timing probe found that the old candidate lead was 0.34--0.75s
for a 4m/s receiver while the actual flight took 0.68--1.36s. A deterministic
four-iteration predictor using the same friction and speed model reduces the
controlled residual to 1mm. The full 24-match `lead` candidate gives standard
2.92 goals, 9.9% conversion and 79.0% completion, but strong-team separation is
outside tolerance; background gives 2.67 goals, 78.8% completion and only 1.33
strong-team points. It is rejected as a release candidate, although the timing
measurement remains a concrete input for a future movement redesign.

The old defender incident at 7.532s in
`.tmp-continuity/visual-1788622669345/report.json` still lacks original recording
endpoints. It cannot be attributed to engine motion from interpolated coordinates.
The new world-team opening probe covers 1000 fixtures and 126341 raw frame pairs,
with maximum speed 7.21m/s and zero incidents. This does not close the old case.

Motion diagnostics now copy `from`, `to`, and `alpha` at the recording point and
include them in the exported clip. A later mutation of the recording cannot alter
captured source evidence; direct snapshots explicitly have no interpolation pair.
Continuity verification passes at 30/60/120fps, including pauses, restarts, replay
restoration and a full-match read/no-read comparison containing 165 contacts.

The final browser run passed with 9264 updates, 9129 moving referee frames,
maximum referee speed 3.8m/s, no motion incidents and no browser errors. Desktop
1x/4x and the mobile second half all rendered nonblank changing canvases without
horizontal overflow; the live mobile pitch was 367 x 551. Desktop/mobile
screenshots were inspected. Artifacts: `.tmp-continuity/visual-1788847655068/`.
Motion-integrity, presentation, broadcast and cache audits also passed. Cache is
`vcfm-v248`. Full `verify` has not been repeated for this diagnostic-only change.
