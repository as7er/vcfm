// Compare recorded observations only. Separate time composition from within-bin change.
import { readFileSync } from "node:fs";
const names = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const [beforeName = "v253-standard", afterName = "contact-flow-standard"] = names;
const directory = new URL("../.tmp-continuity/global-movement/defense-flow/", import.meta.url);
const before = JSON.parse(readFileSync(new URL(`${beforeName}.json`, directory)));
const after = JSON.parse(readFileSync(new URL(`${afterName}.json`, directory)));
const round = (v) => Number(v.toFixed(5));
console.log(JSON.stringify({ before: before.summary.total, after: after.summary.total }));
for (const dimension of ["state", "age", "direction", "nearestJob", "nearestRole", "depth", "planState", "nearestIsPresser", "pressApproach", ...(process.argv.includes("--details") ? ["stateAge", "activityAge"] : [])]) {
  const left = before.summary.groups[dimension], right = after.summary.groups[dimension];
  const rows = [];
  for (const bin of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const a = left[bin] || { ticks: 0, sharePct: 0, nearest: 0 };
    const b = right[bin] || { ticks: 0, sharePct: 0, nearest: 0 };
    const weight = (a.sharePct + b.sharePct) / 200;
    const contribution = b.sharePct * b.nearest / 100 - a.sharePct * a.nearest / 100;
    rows.push({ bin, beforeShare: a.sharePct, afterShare: b.sharePct, before: a.nearest, after: b.nearest,
      deltaContribution: round(contribution), withinBin: round((b.nearest - a.nearest) * weight),
      composition: round((b.sharePct - a.sharePct) / 100 * (a.nearest + b.nearest) / 2),
      beforePresser: a.presser, afterPresser: b.presser, beforePressTarget: a.pressTarget, afterPressTarget: b.pressTarget,
      beforePressGap: a.pressGap, afterPressGap: b.pressGap });
  }
  console.log(JSON.stringify({ dimension, rows: rows.sort((a, b) => b.deltaContribution - a.deltaContribution) }));
}
for (const [label, report] of [[beforeName, before], [afterName, after]]) {
  const pursuit = { views: 0, primaryNearest: 0, bodyContact: 0, bodyContactBehind: 0,
    targetInsideCarrierEnvelope: 0, targetAcrossCarrier: 0 };
  for (const episode of report.episodes) for (const view of episode.views) {
    const owner = view.players.find((a) => a.id === view.ball.owner);
    const presser = view.players.find((a) => a.team !== owner.team && a.job?.type === "press");
    if (!presser) continue;
    const px = presser.x - owner.x, py = presser.y - owner.y;
    const tx = presser.tx - owner.x, ty = presser.ty - owner.y;
    const radius = 2.85;
    pursuit.views++;
    pursuit.primaryNearest += +(Math.abs(view.row.presser - view.row.nearest) < 1e-6);
    const contact = Math.hypot(px, py) <= radius + 0.15;
    pursuit.bodyContact += +contact;
    pursuit.bodyContactBehind += +(contact && py * (owner.team === "home" ? -1 : 1) < 0);
    pursuit.targetInsideCarrierEnvelope += +(Math.hypot(tx, ty) < radius);
    pursuit.targetAcrossCarrier += +(contact && px * tx + py * ty < 0);
  }
  console.log(JSON.stringify({ label, longGapEpisodePursuit: pursuit }));
  if (!process.argv.includes("--episodes")) continue;
  console.log(JSON.stringify({ label, episodes: [...report.episodes].sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5).map((episode) => ({ seed: episode.seed, at: episode.at, seconds: episode.seconds,
      meanNearest: episode.meanNearest, views: [episode.views[0], episode.views[Math.floor(episode.views.length / 2)], episode.views.at(-1)]
        .map((v) => ({ ...v, players: v.players.filter((a) => a.id === v.ball.owner ||
          ["press", "screen"].includes(a.job?.type) || Math.hypot((a.x - v.ball.x) * 0.68, (a.y - v.ball.y) * 1.05) < 5) })) })) }));
}
