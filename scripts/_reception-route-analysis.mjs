// Follow recorded acquisitions to the first observed decision/entry in the same
// receiving lifecycle. This reads evidence only; it never simulates a match.
import { readFileSync } from "node:fs";
const mx = 0.68, my = 1.05;
const opposite = (team) => team === "home" ? "away" : "home";
const inBox = (team, x, y) => x > 22 && x < 78 && (team === "home" ? y >= 84 : y <= 16);
const distance = (x1, y1, x2, y2) => Math.hypot((x1 - x2) * mx, (y1 - y2) * my);
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(4) : null;
};
const groupBy = (rows, key) => {
  const groups = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return groups;
};
for (const label of process.argv.slice(2)) {
  const { summary, acquisitions, decisions, passes, spells } = JSON.parse(readFileSync(
    new URL(`../.tmp-continuity/global-movement/box-flow/${label}.json`, import.meta.url)));
  const acqsByMatch = groupBy(acquisitions, (row) => row.seed);
  const decisionsByPlayer = groupBy(decisions, (row) => row.owner.id);
  const passesByPlayer = groupBy(passes, (row) => row.playerId);
  const entriesByPlayer = groupBy(spells, (row) => row.ownerId);
  const rows = [];
  for (const match of acqsByMatch.values()) for (let i = 0; i < match.length; i++) {
    const a = match[i];
    if (a.state !== "pass" || a.receiverId !== a.playerId || a.cross || a.through ||
        a.kickTeam !== (a.playerId.startsWith("home-") ? "home" : "away")) continue;
    const dir = a.kickTeam === "home" ? -1 : 1;
    const defending = opposite(a.kickTeam);
    const goalY = a.kickTeam === "home" ? 0 : 100;
    if (Math.abs(a.y - goalY) * my > 38) continue;
    const nextAcquisitionAt = match[i + 1]?.t ?? Infinity;
    const nextPassAt = (passesByPlayer.get(a.playerId) || []).find((p) => p.t >= a.t)?.t ?? Infinity;
    const lifecycleEnd = Math.min(nextAcquisitionAt, nextPassAt);
    const decision = (decisionsByPlayer.get(a.playerId) || []).find((d) => d.t >= a.t && d.t < lifecycleEnd + 1e-8);
    const entry = (entriesByPlayer.get(a.playerId) || []).find((s) => s.at > a.t &&
      s.at < Math.min(lifecycleEnd, decision?.t ?? Infinity) && s.receipt?.t === a.t && s.origin === "carry-entry");
    const targetAdvance = (a.targetY - a.y) * dir * my;
    const intendedGap = distance(a.x, a.y, a.targetX, a.targetY);
    rows.push({ seed: a.seed, t: a.t, playerId: a.playerId,
      fromBox: inBox(defending, a.kickX, a.kickY), toBox: inBox(defending, a.targetX, a.targetY),
      receivedInBox: inBox(defending, a.x, a.y), ballInBox: a.inBox,
      targetAdvance, intendedGap, routeStillOutward: targetAdvance < -1.5 && intendedGap > 1.5,
      x: a.x, y: a.y, targetX: a.targetX, targetY: a.targetY,
      initialIntent: a.intent, initialAdvance: a.intent ? (a.intent.ty - a.y) * dir * my : null,
      decisionObserved: !!decision, waitToDecision: decision ? decision.t - a.t : null,
      decisionAdvance: decision ? (decision.owner.y - a.y) * dir * my : null,
      decisionGap: decision ? distance(decision.owner.x, decision.owner.y, a.targetX, a.targetY) : null,
      decision: decision && { t: decision.t, x: decision.owner.x, y: decision.owner.y, inBox: decision.inBox,
        action: decision.action, preparedAction: decision.preparedAction, after: decision.after },
      carryEntryBeforeDecision: !!entry, entry: entry && { t: entry.at, x: entry.x, y: entry.y },
    });
  }
  function stats(group) {
    const observed = group.filter((row) => row.decisionObserved);
    return { count: group.length, stillOutward: group.filter((r) => r.routeStillOutward).length,
      receivedInBox: group.filter((r) => r.receivedInBox).length,
      ballInBox: group.filter((r) => r.ballInBox).length,
      carryEntryBeforeDecision: group.filter((r) => r.carryEntryBeforeDecision).length,
      medianOriginalTargetAdvance: median(group.map((r) => r.targetAdvance)),
      medianTargetGap: median(group.map((r) => r.intendedGap)),
      firstDecisionsObserved: observed.length,
      medianWaitToDecision: median(observed.map((r) => r.waitToDecision)),
      medianActualAdvanceToDecision: median(observed.map((r) => r.decisionAdvance)),
      firstDecisionsInBox: observed.filter((r) => r.decision.inBox).length,
      firstDecisionsReturnPass: observed.filter((r) => r.decision.action === "pass" ||
        r.decision.action === "prepare" && r.decision.preparedAction === "pass").length };
  }
  const exits = rows.filter((r) => r.fromBox && !r.toBox);
  console.log(JSON.stringify({ label, matches: summary.matches.length,
    intendedOrdinaryFinalThird: stats(rows), intendedExit: stats(exits),
    intendedOutwardExit: stats(exits.filter((r) => r.routeStillOutward)),
    examples: exits.filter((r) => r.routeStillOutward && r.decisionAdvance > 3)
      .sort((a, b) => b.decisionAdvance - a.decisionAdvance).slice(0, 3) }));
}
