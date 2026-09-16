// Two-proportion / mean comparison for the through-ball fidelity experiments.
//
// The open question from docs/through-pass-profile-fidelity-2026-09-16.md §5 is
// purely statistical: the observed profile gap (48.9% vs 55.6% completion) has a
// standard error of roughly 10pp at ~50 through balls, so "is this real?" cannot
// be answered by eyeballing the difference.
//
// This prints, for each metric, the difference with a confidence interval and the
// sample size that would be needed to resolve it at 80% power. Pure arithmetic on
// numbers you paste in; it runs no simulation.
//
// Usage:
//   node scripts/_two-proportion-power.mjs <nA> <kA> <nB> <kB>
//     nA/nB = trials, kA/kB = successes
import { readFileSync } from "node:fs";

/** Inverse standard normal CDF (Acklam's algorithm), for CI and power. */
function invNorm(p) {
  if (p <= 0 || p >= 1) throw new Error("p out of range");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
         (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

const Z80 = invNorm(0.8);
const Z975 = invNorm(0.975);

function compareProportions(nA, kA, nB, kB, label) {
  const pA = kA / nA, pB = kB / nB;
  const diff = pB - pA;
  const seDiff = Math.sqrt(pA * (1 - pA) / nA + pB * (1 - pB) / nB);
  const z = seDiff > 0 ? diff / seDiff : 0;
  const lo = diff - Z975 * seDiff, hi = diff + Z975 * seDiff;
  const pooled = (kA + kB) / (nA + nB);
  // n per arm for 80% power at the observed effect (two-sided 5%)
  const h = Math.abs(diff);
  const nPerArm = h > 0
    ? Math.ceil((Math.pow(Z975 + Z80, 2) * 2 * pooled * (1 - pooled)) / (h * h))
    : Infinity;
  console.log("\n" + label);
  console.log("   A: " + kA + "/" + nA + " = " + (pA * 100).toFixed(1) + "%");
  console.log("   B: " + kB + "/" + nB + " = " + (pB * 100).toFixed(1) + "%");
  console.log("   diff (B-A): " + (diff * 100).toFixed(1) + "pp"
    + "   SE " + (seDiff * 100).toFixed(1) + "pp"
    + "   95% CI [" + (lo * 100).toFixed(1) + ", " + (hi * 100).toFixed(1) + "]");
  console.log("   z = " + z.toFixed(2)
    + "   two-sided p " + (2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)))).toFixed(3));
  console.log("   decisive? " + (Math.abs(z) >= 1.96 ? "YES at 5%" : "NO (interval spans 0)"));
  console.log("   n needed per arm for 80% power at this effect: "
    + (Number.isFinite(nPerArm) ? nPerArm : "-"));
  return { diff, seDiff, z, nPerArm };
}

function compareMeans(rows, label) {
  // rows: [[meanA, sdA, nA], [meanB, sdB, nB]] — or paired if corr given
  const [[mA, sA, nA], [mB, sB, nB]] = rows;
  const diff = mB - mA;
  const se = Math.sqrt(sA * sA / nA + sB * sB / nB);
  const z = se > 0 ? diff / se : 0;
  console.log("\n" + label);
  console.log("   A: " + mA + " (sd " + sA + ", n " + nA + ")");
  console.log("   B: " + mB + " (sd " + sB + ", n " + nB + ")");
  console.log("   diff (B-A): " + diff.toFixed(3) + "   SE " + se.toFixed(3)
    + "   95% CI [" + (diff - Z975 * se).toFixed(3) + ", " + (diff + Z975 * se).toFixed(3) + "]");
  console.log("   z = " + z.toFixed(2)
    + "   decisive? " + (Math.abs(z) >= 1.96 ? "YES at 5%" : "NO (interval spans 0)"));
  return { diff, se, z };
}

/** erf via Abramowitz-Stegun 7.1.26. */
function erf(x) {
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return y;
}

// ---------------------------------------------------------------------------
// Parse the probe's own report if a log path is given, otherwise use argv.
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.length >= 4 && argv.every((a) => /^\d+$/.test(a))) {
  const [nA, kA, nB, kB] = argv.map(Number);
  compareProportions(nA, kA, nB, kB, "Completion rate (A=baseline, B=variant)");
} else if (argv[0] && argv[0].endsWith(".log")) {
  const txt = readFileSync(argv[0], "utf8");
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("=== 直塞结果对比");
  const d = JSON.parse(txt.slice(start, end > 0 ? end : undefined).trim());
  const keys = Object.keys(d);
  const [A, B] = keys;
  const throughA = d[A].perMatch.throughPasses * d[A].matches;
  const throughB = d[B].perMatch.throughPasses * d[B].matches;
  const compA = (d[A].outcomes["completed-intended"] || 0) + (d[A].outcomes["completed-other"] || 0);
  const compB = (d[B].outcomes["completed-intended"] || 0) + (d[B].outcomes["completed-other"] || 0);
  compareProportions(throughA, compA, throughB, compB, "Completion rate (" + A + " vs " + B + ")");
  compareProportions(
    throughA, d[A].outcomes["intercepted"] || 0,
    throughB, d[B].outcomes["intercepted"] || 0,
    "Intercepted (" + A + " vs " + B + ")"
  );
  compareMeans(
    [[d[A].perMatch.goals, 1, d[A].matches], [d[B].perMatch.goals, 1, d[B].matches]],
    "Goals/match (" + A + " vs " + B + ") — sd assumed 1, treat as indicative only"
  );
  console.log("\nRaw per-match through counts:");
  console.log("   " + A + " " + JSON.stringify(d[A].seeds.map((s) => s.through)));
  console.log("   " + B + " " + JSON.stringify(d[B].seeds.map((s) => s.through)));
} else {
  console.log("Usage:");
  console.log("  node scripts/_two-proportion-power.mjs <nA> <kA> <nB> <kB>");
  console.log("  node scripts/_two-proportion-power.mjs <.tmp-continuity/exp.log>");
}
