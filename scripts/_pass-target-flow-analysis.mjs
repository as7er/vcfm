// Inspect already recorded receipts; no simulation or RNG calls.
import { readFileSync } from "node:fs";
const directory = new URL("../.tmp-continuity/global-movement/box-flow/", import.meta.url);
const mx = 0.68, my = 1.05;
const distance = (x1, y1, x2, y2) => Math.hypot((x1 - x2) * mx, (y1 - y2) * my);
const median = (rows) => {
  const sorted = rows.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(4) : null;
};
const round = (n) => +n.toFixed(4);
const opposite = (team) => team === "home" ? "away" : "home";
const inBox = (defending, x, y) => x > 22 && x < 78 && (defending === "home" ? y >= 84 : y <= 16);
for (const label of process.argv.slice(2)) {
  const { summary, acquisitions, passes } = JSON.parse(readFileSync(new URL(`${label}.json`, directory)));
  const rows = acquisitions.filter((row) => row.state === "pass" && row.receiverId).map((row) => {
    const team = row.playerId.startsWith("home-") ? "home" : "away";
    const friendly = team === row.kickTeam;
    return { ...row, friendly, actualTeam: team,
      outcome: !friendly ? "opponent" : row.playerId === row.receiverId ? "intended" :
        row.playerId === row.passerId ? "self-reclaim" : "other-teammate",
      targetGap: distance(row.ballX, row.ballY, row.targetX, row.targetY),
      contactGap: distance(row.ballX, row.ballY, row.x, row.y),
      flown: distance(row.ballX, row.ballY, row.kickX, row.kickY),
      leavesBox: inBox(opposite(row.kickTeam), row.kickX, row.kickY) &&
        !inBox(opposite(row.kickTeam), row.targetX, row.targetY),
      caughtInAttackingBox: inBox(opposite(row.kickTeam), row.ballX, row.ballY),
      backward: (row.targetY - row.kickY) * (row.kickTeam === "home" ? -1 : 1) * my < -4,
    };
  });
  const groups = (selected) => Object.fromEntries(["intended", "other-teammate", "self-reclaim", "opponent"]
    .map((outcome) => {
      const group = selected.filter((row) => row.outcome === outcome);
      return [outcome, { count: group.length, perMatch: round(group.length / summary.matches.length),
        medianRemaining: median(group.map((row) => row.targetGap)),
        medianContactGap: median(group.map((row) => row.contactGap)),
        medianFlown: median(group.map((row) => row.flown)),
        caughtInAttackingBox: group.filter((row) => row.caughtInAttackingBox).length }];
    }));
  const exit = rows.filter((row) => row.leavesBox);
  console.log(JSON.stringify({ label, allPasses: passes.length, passReceipts: rows.length,
    all: groups(rows), boxExit: groups(exit), backward: groups(rows.filter((row) => row.backward)),
    examples: exit.filter((row) => row.caughtInAttackingBox && row.outcome === "other-teammate")
      .sort((a, b) => b.targetGap - a.targetGap).slice(0, 2) }));
}
