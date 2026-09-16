// Read-only fullback-branch observation; no decision calls or random draws.
// Tags each fullback off-ball decision as `bomb` (overlap) or `home` (fallback)
// and records the inputs (dBall, prog, wide, blockForward) plus the realised
// target depth in metres. The only side effect is a new field on the agent that
// nothing reads, so the observed match must come out identical without it.
//
// The `contradiction` cross-check depends on which bombOn gate the engine under
// test uses, so it is switchable:
//   VCFM_FULLBACK_RULE=same-side  (default) — HEAD gate: the ball must be on the
//     fullback's side, so `home && prog>0.55 && near` is impossible.
//   VCFM_FULLBACK_RULE=dBall55 — the previous gate: `dBall < 55`, so
//     `home && prog>0.55 && dBall<55` is impossible. Use this when measuring a
//     pre-change baseline (e.g. `git show HEAD:js/sim/engine.js`), otherwise the
//     far-side rows that the old engine legitimately sent home would be flagged.
//   VCFM_FULLBACK_RULE=both — the adopted gate: `dBall < 55 && ballOnSide`, so
//     `home && prog>0.55 && dBall<55 && near` is impossible.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url);
const observe = 'globalThis[Symbol.for("vcfm.fullback-branch-observer")]';
const RULE = process.env.VCFM_FULLBACK_RULE || "both";
assert.ok(["same-side", "dBall55", "both"].includes(RULE), `unknown VCFM_FULLBACK_RULE: ${RULE}`);
let loadedEngineSha256;

const agg = {
  total: 0,
  counts: {}, // `${branch}|${side}`
  depth: {}, // `${branch}|${side}` -> {sum,sumSq,n}
  homeDb: {}, // `${side}|${under55|over55}` -> count
  band: {}, // `${branch}|${side}|${band}` -> count
  contradiction: 0, // home rows with prog>0.55 && ball on the FB's side (must stay 0 under the same-side gate)
};

function bandOf(prog) {
  if (prog < 0.38) return "a<0.38";
  if (prog < 0.55) return "b0.38-0.55";
  if (prog < 0.64) return "c0.55-0.64";
  return "d>0.64";
}

globalThis[Symbol.for("vcfm.fullback-branch-observer")] = (engine, a, branch, extra) => {
  agg.total++;
  const side =
    (extra.wide < 0 && extra.ballX < 50) || (extra.wide > 0 && extra.ballX > 50) ? "near" : "far";
  const key = `${branch}|${side}`;
  agg.counts[key] = (agg.counts[key] || 0) + 1;
  const d = (agg.depth[key] ||= { sum: 0, sumSq: 0, n: 0 });
  d.sum += extra.depth;
  d.sumSq += extra.depth * extra.depth;
  d.n++;
  agg.homeDb[`${side}|${extra.dBall < 55 ? "under55" : "over55"}`] =
    (agg.homeDb[`${side}|${extra.dBall < 55 ? "under55" : "over55"}`] || 0) + 1;
  agg.band[`${branch}|${side}|${bandOf(extra.prog)}`] =
    (agg.band[`${branch}|${side}|${bandOf(extra.prog)}`] || 0) + 1;
  if (branch === "home" && extra.prog > 0.55) {
    const violates =
      RULE === "same-side" ? side === "near"
      : RULE === "dBall55" ? extra.dBall < 55
      : extra.dBall < 55 && side === "near";
    if (violates) agg.contradiction++;
  }
};
globalThis[Symbol.for("vcfm.fullback-branch-observer")].summary = () => {
  const mean = (key) => {
    const d = agg.depth[key];
    if (!d || d.n === 0) return null;
    const m = d.sum / d.n;
    const v = Math.max(0, d.sumSq / d.n - m * m);
    return { n: d.n, mean: +m.toFixed(2), sd: +Math.sqrt(v).toFixed(2) };
  };
  return {
    loadedEngineSha256,
    rule: RULE,
    total: agg.total,
    counts: agg.counts,
    depth: Object.fromEntries(Object.keys(agg.depth).map((k) => [k, mean(k)])),
    homeDb: agg.homeDb,
    band: agg.band,
    contradiction: agg.contradiction,
  };
};

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== engineURL.href) return result;
    loadedEngineSha256 = createHash("sha256").update(String(result.source)).digest("hex");
    let source = String(result.source).replace(/\r\n/g, "\n");
    const depthExpr =
      'Math.abs(a.ty - (a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y)) * SIM.PITCH_H_METRES / SIM.FIELD_H';
    for (const [anchor, replacement] of [
      [
        "        a.ty = clamp(b.y + dir * (8 + this.random() * 12 + prog * 8), 8, 92);",
        `        a.ty = clamp(b.y + dir * (8 + this.random() * 12 + prog * 8), 8, 92);\n        ${observe}(this, a, "bomb", { dBall, prog, dir, blockForward, wide, ballX: b.x, x: a.tx, y: a.ty, depth: ${depthExpr} });`,
      ],
      [
        "      a.ty = fbTargetY;",
        `      a.ty = fbTargetY;\n      ${observe}(this, a, "home", { dBall, prog, dir, blockForward, wide, ballX: b.x, x: a.tx, y: a.ty, depth: ${depthExpr}, crowd: fbShiftMetres });`,
      ],
    ]) {
      assert.equal(source.split(anchor).length, 2, "unique fullback-branch anchor");
      source = source.replace(anchor, replacement);
    }
    return { ...result, source };
  },
});