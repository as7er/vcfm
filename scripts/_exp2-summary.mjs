// Four-way summary: baseline vs segment-intercept, for both profiles.
// Reads the two probe logs written by `_through-pass-profile-fidelity-probe.mjs`.
import { readFileSync } from "node:fs";

const parse = (p) => {
  const txt = readFileSync(p, "utf8");
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("=== 直塞结果对比");
  const d = JSON.parse(txt.slice(start, end > 0 ? end : undefined).trim());
  const [A, B] = Object.keys(d);
  const out = {};
  for (const k of [A, B]) {
    const r = d[k];
    const comp = (r.outcomes["completed-intended"] || 0) + (r.outcomes["completed-other"] || 0);
    out[k] = {
      thru: r.perMatch.throughPasses,
      total: Math.round(r.perMatch.throughPasses * r.matches),
      comp,
      pct: +(comp / Math.round(r.perMatch.throughPasses * r.matches) * 100).toFixed(1),
      intercepted: r.outcomes["intercepted"] || 0,
      goals: r.perMatch.goals,
      shots: r.perMatch.shots,
    };
  }
  return out;
};

const base = parse(".tmp-continuity/exp2-base.log");
const seg = parse(".tmp-continuity/exp2-1.log");

const rows = [
  ["直塞/场", "thru"],
  ["直塞总数", "total"],
  ["完成", "comp"],
  ["完成率%", "pct"],
  ["被断", "intercepted"],
  ["进球/场", "goals"],
  ["射门/场", "shots"],
];

console.log("档位".padEnd(12) + ["标准基线", "标准+线段", "后台基线", "后台+线段"]
  .map((h) => h.padStart(11)).join(""));
for (const [label, key] of rows) {
  const vals = [base.standard[key], seg.standard[key], base.background[key], seg.background[key]];
  console.log(label.padEnd(12) + vals.map((v) => String(v).padStart(11)).join(""));
}
console.log("\n判据：若线段拦截是主因，『标准+线段』与『后台+线段』应靠拢。");
console.log("实际 标准+线段 完成率 " + seg.standard.pct + "%  vs  后台+线段 " + seg.background.pct + "%");
console.log("实际 标准基线  完成率 " + base.standard.pct + "%  vs  后台基线   " + base.background.pct + "%");
