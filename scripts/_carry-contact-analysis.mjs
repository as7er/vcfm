import { readFileSync } from "node:fs";
const directory = new URL("../.tmp-continuity/global-movement/box-flow/", import.meta.url);
const round = (n) => +n.toFixed(4);
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? round(sorted[Math.floor(sorted.length / 2)]) : null;
};
for (const label of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(new URL(`${label}.json`, directory)));
  const selected = (report.carryContacts || []).filter((row) => row.inBox).map((row) => ({ ...row,
    scheduledWait: Math.max(0, Math.min(row.owner.decisionUntil, row.afterFirstThinkUntil) - row.t),
    actualWait: row.firstDecisionAt == null ? null : row.firstDecisionAt - row.t,
    duration: row.endAt == null ? null : row.endAt - row.t,
    acquisitionAge: row.acquisition ? row.t - row.acquisition.t : null,
  }));
  const decided = selected.filter((r) => r.actualWait != null);
  const groups = {};
  for (const row of decided) groups[row.firstDecisionAction] = (groups[row.firstDecisionAction] || 0) + 1;
  console.log(JSON.stringify({ label, contacts: selected.length, reachedDecision: decided.length,
    contactEndedFirst: selected.filter((r) => r.endAt != null && r.actualWait == null).length,
    medianScheduledWait: median(selected.map((r) => r.scheduledWait)),
    medianActualWait: median(decided.map((r) => r.actualWait)),
    waitedAtLeastOneSecond: decided.filter((r) => r.actualWait >= 1 - 1e-6).length,
    recentReceiptsWaiting: selected.filter((r) => r.acquisitionAge < 4 && r.scheduledWait >= 1).length,
    actions: groups,
    examples: decided.filter((r) => r.actualWait >= 1).sort((a, b) => b.actualWait - a.actualWait)
      .slice(0, 2).map((r) => ({ seed: r.seed, at: r.t, ownerId: r.owner.id, blockerId: r.blocker.id,
        position: [r.owner.x, r.owner.y], target: [r.owner.intent.tx, r.owner.intent.ty],
        scheduledWait: r.scheduledWait, actualWait: r.actualWait, action: r.firstDecisionAction,
        acquisitionAge: r.acquisitionAge })) }));
}
