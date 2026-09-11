// Read the complete first JSON report from each archived check without replay.
import { readFileSync } from "node:fs";
function firstObject(text) {
  const start = text.indexOf("{");
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  return null;
}
for (const label of process.argv.slice(2)) {
  const base = new URL(`../.tmp-continuity/global-movement/checks/${label}`, import.meta.url);
  const meta = JSON.parse(readFileSync(new URL(`${label}.json`, base), "utf8"));
  const report = firstObject(readFileSync(new URL(`${label}.log`, base), "utf8"));
  const error = readFileSync(new URL(`${label}.err.log`, base), "utf8");
  if (report?.perMatch) console.log(JSON.stringify({ label, exitCode: meta.exitCode,
    profile: report.simulationProfile, matches: report.equalMatches, perMatch: report.perMatch,
    conversion: report.shotConversionPct, completion: report.passCompletionPct,
    crosses: report.crossSharePct, outsideBox: report.outsideBoxSharePct,
    integration: report.integration, strong: report.strongVsWeak, delta: report.referenceDelta,
    error: error.match(/AssertionError \[ERR_ASSERTION\]: ([^\r\n]+)/)?.[1] || null }));
  else if (report?.reports && report?.failures) console.log(JSON.stringify({ label, exitCode: meta.exitCode,
    cases: report.cases, failures: report.failures.length,
    largestExcess: Math.max(0, ...report.failures.map((r) => (r.actualGap || 0) - (r.radius || 0))),
    failureTypes: [...new Set(report.failures.map((r) => r.name))].filter(Boolean) }));
  else if (report?.records && report?.failures) console.log(JSON.stringify({ label, exitCode: meta.exitCode,
    cases: report.cases, failures: report.failures.length,
    failureTypes: [...new Set(report.failures.map((r) => r.name))].filter(Boolean) }));
  else console.log(JSON.stringify({ label, exitCode: meta.exitCode, report }));
}
