// Read forecasts alongside the actual launched pass and subsequent contacts.
// A forecast is probabilistic, so successful reception alone is not an error.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const metres = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);
const round = (n) => Number(n.toFixed(6));
const median = (values) => values.length ? round([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]) : null;
for (const label of process.argv.slice(2).filter((arg) => arg !== "--examples")) {
  assert.match(label, /^[a-z0-9-]+$/);
  const input = new URL(`../.tmp-continuity/global-movement/defensive-pass/${label}.json`, import.meta.url);
  const data = JSON.parse(readFileSync(input, "utf8"));
  assert.ok(data.passRoutes, "this observation must include pass assessment records");
  const groups = new Map(), examples = [];
  for (const route of data.passRoutes) {
    const risk = route.assessment?.risk;
    const age = route.assessment ? route.start.t - route.assessment.t : null;
    const kind = !route.assessment ? "unassessed" : risk ? "risk" : "clear";
    const keys = [kind, `${kind}:${age == null ? "unknown" : age < 1e-8 ? "immediate" : "prepared"}`];
    const forecastTime = risk ? route.start.t + risk.point.at - route.assessment.t : null;
    let assigned = false, reachableFrame = null, minGap = Infinity;
    for (const frame of route.flight) {
      const defender = risk && frame.players.find((a) => a.id === risk.defenderId);
      if (!defender) continue;
      assigned ||= defender.point?.passAt === route.start.t && defender.fsm === "press";
      const gap = metres(defender, frame.ball);
      minGap = Math.min(minGap, gap);
      const flown = metres(frame.ball, { x: frame.ball.kickX, y: frame.ball.kickY });
      const speed = Math.hypot(frame.ball.vx * 0.68, frame.ball.vy * 1.05);
      const radius = flown < 8 ? 1.1 : 2.6 + speed * 0.04;
      const height = flown < 8 ? 1.1 : 2.2;
      if (!reachableFrame && gap <= radius && frame.ball.z <= height) reachableFrame = frame;
    }
    // The flight snapshot is after this physics step; legacy end.t is the
    // step's start time. Use that snapshot for the actual contact timestamp.
    const contactAt = route.flight.at(-1)?.t ?? route.end?.t;
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, { passes: 0, teamControl: 0, opponentControl: 0,
        predictedDefenderControl: 0, assigned: 0, inReach: 0, receivedBeforeForecast: 0,
        otherEndings: {}, ages: [], closest: [] });
      const row = groups.get(key);
      row.passes++;
      row.teamControl += Number(route.end?.reason === "team-control");
      row.opponentControl += Number(route.end?.reason === "opponent-control");
      row.predictedDefenderControl += Number(!!risk && route.end?.ball.owner === risk.defenderId);
      row.assigned += Number(assigned);
      row.inReach += Number(!!reachableFrame);
      row.receivedBeforeForecast += Number(!!risk && route.end?.reason === "team-control" && contactAt < forecastTime - 1e-8);
      if (age != null) row.ages.push(age);
      if (Number.isFinite(minGap)) row.closest.push(minGap);
      if (!["team-control", "opponent-control"].includes(route.end?.reason)) {
        row.otherEndings[route.end?.reason || "unfinished"] = (row.otherEndings[route.end?.reason || "unfinished"] || 0) + 1;
      }
    }
    if (risk && age < 1e-8 && assigned && !reachableFrame && examples.length < 6) {
      examples.push({ seed: route.seed, startAt: route.start.t, assessment: route.assessment,
        outcome: route.end, closestMetres: round(minGap), actualFlight: route.flight });
    }
  }
  console.log(JSON.stringify({ label, groups: Object.fromEntries([...groups].map(([key, row]) => {
    const { ages, closest, ...counts } = row;
    return [key, { ...counts, medianAssessmentAge: median(ages), medianClosestMetres: median(closest) }];
  })), examples: process.argv.includes("--examples") ? examples : examples.map((row) => ({
    seed: row.seed, startAt: row.startAt, closestMetres: row.closestMetres, reason: row.outcome.reason,
  })) }, null, 2));
}
