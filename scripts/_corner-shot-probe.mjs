import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(4, Number(process.argv[2]) || 24);
const dt = SIM.DT;

function seededRandom(seed) {
  let v = seed >>> 0;
  return () => {
    v += 0x6d2b79f5;
    let n = v;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClub(name, ability = 15) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, index) => {
    const rating = Math.max(1, Math.min(20, ability + ((index * 7 + ability) % 5) - 2));
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
    ]) attrs[key] = rating;
    const id = `${name}-p${index}`;
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      style: "balanced",
    },
  };
}

const rows = [];
for (let m = 0; m < matches; m++) {
  const engine = new SimEngine(
    makeClub(`corner-probe-home-${m}`),
    makeClub(`corner-probe-away-${m}`),
    { simulationProfile: "standard", timeStep: dt, separationPasses: 8, random: seededRandom(372000 + m) },
  );
  const steps = Math.round((90 * 60) / dt);
  let seenEvents = 0;
  const corners = [];
  for (let i = 0; i < steps; i++) {
    engine.step(dt);
    const fresh = engine.events.slice(seenEvents);
    seenEvents = engine.events.length;
    for (const event of fresh) {
      if (event.type === "corner") corners.push({ t: event.t, team: event.team, shots: 0, goals: 0 });
      if (event.type !== "shot" && event.type !== "goal") continue;
      for (const corner of corners) {
        if (event.t > corner.t && event.t <= corner.t + 14 && event.team === corner.team) {
          if (event.type === "shot") corner.shots++;
          if (event.type === "goal") corner.goals++;
        }
      }
    }
  }
  rows.push({
    match: m,
    corners: corners.length,
    withShot14s: corners.filter((c) => c.shots > 0).length,
    withGoal14s: corners.filter((c) => c.goals > 0).length,
    shots14s: corners.reduce((n, c) => n + c.shots, 0),
    details: corners,
  });
}

const all = rows.flatMap((r) => r.details);
console.log(JSON.stringify({
  matches,
  corners: all.length,
  cornersWithShot14s: all.filter((c) => c.shots > 0).length,
  cornersWithGoal14s: all.filter((c) => c.goals > 0).length,
  shotRate: all.length ? Number((all.filter((c) => c.shots > 0).length / all.length).toFixed(4)) : 0,
  totalShotsIn14s: all.reduce((n, c) => n + c.shots, 0),
  rows,
}, null, 2));