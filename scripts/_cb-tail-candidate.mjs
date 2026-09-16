// VERDICT: ADOPTED (2026-09-15). This file is now an ARCHIVE, not a candidate.
//
// The tail-weighted centre-back block shift is part of the engine:
//   js/sim/engine.js — SIM.CB_BLOCK_TAIL_FROM / SIM.CB_BLOCK_TAIL_GAIN and the
//   `blockCurve` term in `_chooseAttackOffBallTarget`.
//
// It used to patch `blockShiftY` through a module hook. That anchor no longer
// exists (the engine now computes `blockCurve` directly), so loading this file as
// a `--import` preload would assert. It therefore verifies the integration
// instead of applying it, and is safe to load.
//
// Evidence and the full trade-off curve: docs/cb-block-tail-2026-09-15.md
//
//   shape (4-match medians)      before   tail 1.5   target
//     attacking third length      47.38     41.08    30-40
//     span (DEF->ATT)             44.70     40.25    30-40
//     back line depth             49.69     53.44    56-66
//   envelope (48 matches, same seeds)
//     standard goals / separation  2.73 / 1.92  ->  2.67 / 2.04
//     background goals / separation 3.13 / 1.85 ->  2.92 / 1.96
//
// Rejected alternatives (measured, see the doc):
//   tail 2.0  — reaches the target (39.08 / 38.96) but strength separation falls
//               to 1.52 over 48 matches, i.e. 0.02 above the 1.5 floor.
//   raising CB_BLOCK_SHIFT_MAX_M linearly — lifts the midfield block too, so the
//               counter-attack exposure rises before the shape improves
//               (probe ladder: -14 -> 1.92, -19 -> 1.67, -26 -> 1.46, floor 1.5).
//
// The sweep knobs (VCFM_CB_TAIL_FROM / VCFM_CB_TAIL_GAIN / VCFM_CB_SHIFT_MULT)
// no longer do anything here; to sweep a new curve, edit the SIM constants or
// write a fresh candidate against the current anchor.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const source = readFileSync(new URL("../js/sim/engine.js", import.meta.url), "utf8");
const required = [
  "CB_BLOCK_TAIL_FROM",
  "CB_BLOCK_TAIL_GAIN",
  "const blockCurve =",
];
const missing = required.filter((needle) => !source.includes(needle));
assert.deepEqual(
  missing,
  [],
  `the tail-weighted block shift is no longer in js/sim/engine.js: ${missing.join(", ")}`
);
const sha256 = createHash("sha256").update(source).digest("hex");
process.on("exit", () => {
  console.log(JSON.stringify({ cbTailArchive: { integrated: true, engineSha256: sha256 } }));
});
