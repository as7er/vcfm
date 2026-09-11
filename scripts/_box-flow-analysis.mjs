// Read stored observation only. Does not replay or change any match.
import { readFileSync } from "node:fs";
const labels = process.argv.slice(2);
const mx = 0.68, my = 1.05;
const round = (n) => Number(n.toFixed(3));
const other = (team) => team === "home" ? "away" : "home";
const inBox = (team, x, y) => x > 22 && x < 78 && (team === "home" ? y >= 84 : y <= 16);
const dist = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
const bump = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };
for (const label of labels) {
  const report = JSON.parse(readFileSync(new URL(`../.tmp-continuity/global-movement/box-flow/${label}.json`, import.meta.url)));
  const { summary: s, spells, decisions, acquisitions, passes } = report;
  const forced = spells.filter((spell) => {
    const receipt = spell.receipt;
    return spell.origin === "carry-entry" && receipt && spell.at - receipt.t < 10 &&
      !receipt.inBox && !inBox(spell.defending, receipt.x, receipt.y) &&
      !decisions.some((row) => row.seed === spell.seed && row.owner.id === spell.ownerId &&
        row.t >= receipt.t - 1e-6 && row.t < spell.at);
  });
  const forcedByRole = {};
  for (const row of forced) {
    const key = `${row.role}:${row.roleId}`;
    const g = forcedByRole[key] ||= { n: 0, seconds: 0, beforeEntry: 0 };
    g.n++;
    g.seconds += row.seconds;
    g.beforeEntry += row.at - row.receipt.t;
  }
  const atMostOneDecision = spells.filter((spell) => decisions.filter((row) => row.seed === spell.seed &&
    row.owner.id === spell.ownerId && row.t >= spell.at && row.t < spell.endAt).length <= 1);
  const backs = [];
  for (const p of passes.filter((p) => p.fromBox)) {
    const receipt = acquisitions.findLast((row) => row.seed === p.seed && row.playerId === p.playerId && row.t <= p.t);
    if (receipt?.passerId === p.id && p.t - receipt.t < 8.5) backs.push(p);
  }
  const blockedCarries = decisions.filter((d) => {
    if (!d.inBox || d.action !== "dribble" || !d.after) return false;
    const dx = d.after.tx - d.owner.x, dy = d.after.ty - d.owner.y;
    const squared = dx * dx + dy * dy;
    if (squared < 1e-6) return false;
    return d.players.some((o) => {
      if (o.team === d.owner.team || o.sentOff || o.injuredOff) return false;
      const along = ((o.x - d.owner.x) * dx + (o.y - d.owner.y) * dy) / squared;
      return along > 0 && along < 1 && Math.hypot(o.x - d.owner.x - along * dx, o.y - d.owner.y - along * dy) < 2.85;
    });
  });
  const openBackward = blockedCarries.filter((d) => d.choices.some((set) => set.options.some((p) => {
    const dir = d.owner.team === "home" ? -1 : 1;
    if ((p.ty - d.owner.y) * dir * my > -4 || p.cross || p.through) return false;
    const dx = (p.tx - d.ball.x) * mx, dy = (p.ty - d.ball.y) * my;
    const squared = dx * dx + dy * dy;
    return squared > 0 && !d.players.some((o) => {
      if (o.team === d.owner.team || o.role === "GK" || o.sentOff || o.injuredOff) return false;
      const ox = (o.x - d.ball.x) * mx, oy = (o.y - d.ball.y) * my;
      const along = Math.max(0, Math.min(1, (ox * dx + oy * dy) / squared));
      return Math.hypot(ox - along * dx, oy - along * dy) < 1.8;
    });
  })));
  const summary = { label, seconds: s.boxSecondsPerMatch, spells: s.boxSpellsPerMatch,
    beforeAnyDecisionEntriesPerMatch: round(forced.length / s.matches.length),
    secondsInTheseSpellsPerMatch: round(forced.reduce((n, row) => n + row.seconds, 0) / s.matches.length),
    forcedByRole: Object.fromEntries(Object.entries(forcedByRole).map(([key, g]) => [key,
      { entries: g.n, seconds: round(g.seconds), averagePriorCarry: round(g.beforeEntry / g.n) }])),
    atMostOneDecisionSpellsPct: round(atMostOneDecision.length / spells.length * 100),
    immediateReturnBoxPasses: backs.length,
    boxDecisionAction: s.inBoxDecisions, blockedCarries: blockedCarries.length,
    contactedBlockedCarries: blockedCarries.filter((d) => d.players.some((o) =>
      o.team !== d.owner.team && !o.sentOff && !o.injuredOff &&
      Math.hypot(o.x - d.owner.x, o.y - d.owner.y) <= 2.85 + 1e-6 &&
      (o.x - d.owner.x) * (d.after.tx - d.owner.x) + (o.y - d.owner.y) * (d.after.ty - d.owner.y) > 0)).length,
    blockedCarriesWithOpenBackwardPass: openBackward.length };
  console.log(JSON.stringify(summary));
  if (labels.length !== 1) continue;
  const examples = forced.filter((row) => row.role === "MID").sort((a, b) => b.seconds - a.seconds).slice(0, 3);
  for (const row of examples) {
    console.log(JSON.stringify({ example: { ...row, snapshot: undefined },
      decisions: decisions.filter((d) => d.seed === row.seed && d.owner.id === row.ownerId &&
        d.t >= row.receipt.t && d.t <= row.endAt).map(({ players, ...d }) => d),
      attackers: row.snapshot.filter((a) => a.team === row.team).map((a) => ({ id: a.id, role: a.role, roleId: a.roleId,
        x: round(a.x), y: round(a.y), tx: round(a.tx), ty: round(a.ty), kind: a.offBallTarget?.kind,
        speed: round(Math.hypot(a.vx * mx, a.vy * my)) })),
      nearest: row.snapshot.filter((a) => a.team === row.defending && !a.sentOff).sort((a, b) => dist(a, row) - dist(b, row))
        .slice(0, 3).map((a) => ({ ...a, offBallTarget: undefined })) }));
  }
}
