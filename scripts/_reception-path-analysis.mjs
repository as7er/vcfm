// Correctly distinguish a ball still in the box at initial contact from a
// subsequent carried entry. Read the original saved samples without rerunning.
import { readFileSync } from "node:fs";
const inBox = (team, x, y) => x > 22 && x < 78 && (team === "home" ? y >= 84 : y <= 16);
const other = (team) => team === "home" ? "away" : "home";
for (const label of process.argv.slice(2)) {
  const { summary, rows } = JSON.parse(readFileSync(new URL(
    `../.tmp-continuity/global-movement/reception-path/${label}.json`, import.meta.url)));
  const annotated = rows.map((r) => {
    const team = other(r.receiver.team);
    let outsideAt = !inBox(team, r.ball.x, r.ball.y) ? r.t : null;
    let entry = null;
    for (const s of r.controlSamples) {
      if (!inBox(team, s.ballX, s.ballY) && outsideAt == null) outsideAt = s.t;
      if (outsideAt != null && inBox(team, s.ballX, s.ballY) && s.state === "held") { entry = s; break; }
    }
    return { ...r, entry, outsideAt };
  });
  const stats = (group) => ({ receipts: group.length,
    blocked: group.filter((r) => r.blockers.length).length,
    blockedByOpponent: group.filter((r) => r.blockers.some((id) => r.players.find((p) => p.id === id).team !== r.receiver.team)).length,
    carryEntriesBeforeDecision: group.filter((r) => r.entry).length,
    blockedCarryEntriesBeforeDecision: group.filter((r) => r.entry && r.blockers.length).length,
    initialBallInside: group.filter((r) => inBox(other(r.receiver.team), r.ball.x, r.ball.y)).length,
    initialPlayerInside: group.filter((r) => r.receivedInBox).length,
  });
  const exits = annotated.filter((r) => r.fromBox && !r.toBox);
  console.log(JSON.stringify({ label, comparedEveryMatch: summary.comparedEveryMatch,
    all: stats(annotated), exits: stats(exits), examples: exits.filter((r) => r.entry && r.blockers.length)
      .slice(0, 2).map(({ controlSamples, players, ...r }) => ({ ...r,
        blockingPlayers: players.filter((p) => r.blockers.includes(p.id)) })) }));
}
