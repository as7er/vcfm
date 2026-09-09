const MX = 0.68;
const MY = 1.05;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const distance = (a, b) => Math.hypot((a.x - b.x) * MX, (a.y - b.y) * MY);
const active = (a) => !a.sentOff && !a.injuredOff;
const aerial = (a) => (a.attr.heading ?? a.attr.finishing ?? 0.5) * 0.4 +
  (a.attr.strength ?? 0.5) * 0.35 + (a.attr.physical ?? 0.5) * 0.25;
const byAerial = (a, b) => aerial(b) - aerial(a) || String(a.id).localeCompare(String(b.id));

export function buildCornerRoutine({ agents, team, takerId, ball, now, attackDirection, goalY }) {
  const side = ball.x < 50 ? -1 : 1;
  const at = (width, depth) => ({
    x: clamp(50 + width / MX, 3, 97),
    y: clamp(goalY - attackDirection * depth / MY, 0.75, 99.25),
  });
  const attackers = agents.filter((a) => active(a) && a.team === team && a.role !== "GK" && a.id !== takerId);
  const defenders = agents.filter((a) => active(a) && a.team !== team && a.role !== "GK");
  const positions = new Map();
  const runs = new Map();
  const marks = new Map();
  const backs = attackers.filter((a) => a.role === "DEF").sort((a, b) => byAerial(b, a)).slice(0, 2);
  backs.forEach((a, i) => positions.set(a.id, { ...at((i ? 1 : -1) * 8, 55 + i * 2), kind: "rest" }));
  const forward = attackers.filter((a) => !positions.has(a.id)).sort(byAerial);
  const zones = [at(side * 3, 4.5), at(-side * 0.5, 8.5), at(-side * 4.5, 5)];
  forward.slice(0, 3).forEach((a, i) => {
    const target = zones[i];
    positions.set(a.id, {
      x: clamp(target.x + side * (i % 2 ? -1 : 1) * 1.5 / MX, 3, 97),
      y: target.y - attackDirection * (i === 0 ? 8 : 9) / MY,
      kind: "runner",
    });
    runs.set(a.id, target);
  });
  const support = [at(side * 9, 4.5), at(-side * 8, 9.5), at(-side * 1, 18), at(side * 15, 21)];
  forward.slice(3).forEach((a, i) => positions.set(a.id, {
    ...support[Math.min(i, support.length - 1)], kind: i < 2 ? "second-ball" : "edge",
  }));

  const outlet = [...defenders].sort((a, b) =>
    (b.role === "ATT") - (a.role === "ATT") || (b.attr.pace || 0) - (a.attr.pace || 0) ||
    String(a.id).localeCompare(String(b.id)))[0];
  if (outlet) positions.set(outlet.id, { ...at(side * 4, 55), kind: "outlet" });
  const pool = defenders.filter((a) => a !== outlet).sort(byAerial);
  let index = 0;
  const place = (spot, kind) => {
    const player = pool[index++];
    if (player) positions.set(player.id, { ...spot, kind });
  };
  place(at(side * 3.4, 0.8), "post");
  place(at(-side * 3, 5.2), "zone");
  for (const attacker of forward.slice(0, 5)) {
    const defender = pool[index++];
    if (!defender) break;
    const spot = positions.get(attacker.id);
    positions.set(defender.id, {
      x: spot.x - side * 1.2 / MX,
      y: spot.y + attackDirection * 1.8 / MY,
      kind: "mark",
    });
    marks.set(defender.id, attacker.id);
  }
  place(at(-side * 5, 18), "edge");
  while (index < pool.length) {
    place({ x: ball.x - side * 9.6 / MX, y: ball.y - attackDirection * 1 / MY }, "short");
  }
  const keeper = agents.find((a) => active(a) && a.team !== team && a.role === "GK");
  if (keeper) positions.set(keeper.id, { ...at(-side * 0.8, 1.5), kind: "keeper" });

  // Separate staging slots in metres. Arrival targets stay attached to their
  // intended zones; staging separation must not move the delivery itself.
  const ordered = [...positions.keys()].sort();
  for (let iteration = 0; iteration < 8; iteration++) {
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = positions.get(ordered[i]);
        const b = positions.get(ordered[j]);
        const dx = (b.x - a.x) * MX;
        const dy = (b.y - a.y) * MY;
        const gap = Math.hypot(dx, dy);
        if (gap >= 2) continue;
        const ux = gap > 1e-6 ? dx / gap : 1;
        const uy = gap > 1e-6 ? dy / gap : 0;
        const shift = (2 - gap) / 2;
        a.x = clamp(a.x - ux * shift / MX, 3, 97);
        a.y = clamp(a.y - uy * shift / MY, 0.75, 99.25);
        b.x = clamp(b.x + ux * shift / MX, 3, 97);
        b.y = clamp(b.y + uy * shift / MY, 0.75, 99.25);
      }
    }
  }
  return { team, takerId, startedAt: now, releasedAt: null, side, attackDirection, positions, runs, marks };
}

export function cornerDelivery(routine, agents, taker, roll = null) {
  if (!routine || routine.takerId !== taker.id) return null;
  const vision = taker.attr.vision ?? 0.55;
  const technique = taker.attr.crossing ?? taker.attr.passing ?? 0.55;
  let best = null;
  const choices = [];
  for (const [id, target] of routine.runs) {
    const runner = agents.find((a) => a.id === id && active(a));
    if (!runner) continue;
    let cover = Infinity;
    for (const defender of agents) {
      if (!active(defender) || defender.team === taker.team) continue;
      cover = Math.min(cover, distance(defender, target));
    }
    const deliveryDistance = distance(taker, target);
    const value = aerial(runner) * 0.45 + Math.min(cover, 6) / 6 * vision * 0.4 -
      deliveryDistance / 55 * (1 - technique) * 0.25;
    choices.push({ agent: null, value, cross: true, through: false, tx: target.x, ty: target.y });
    if (!best || value > best.value) best = { agent: null, value, cross: true, through: false, tx: target.x, ty: target.y };
  }
  if (!choices.length || !Number.isFinite(roll)) return best;
  const weights = choices.map((choice) => Math.exp((choice.value - best.value) / 0.16));
  let remaining = clamp(roll, 0, 1) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < choices.length; i++) {
    remaining -= weights[i];
    if (remaining <= 0) return choices[i];
  }
  return choices[choices.length - 1];
}

export function cornerMovementTarget(routine, player, ball, agents, now) {
  if (!routine || !active(player) || player.id === routine.takerId) return null;
  if (ball.state === "corner" && ball.owner === routine.takerId) {
    const stage = routine.positions.get(player.id);
    if (now < routine.startedAt + 0.8) return stage || null;
    const arrival = routine.runs.get(player.id);
    if (arrival && stage) return {
      x: stage.x + (arrival.x - stage.x) * 0.35,
      y: stage.y + (arrival.y - stage.y) * 0.35,
    };
    const markedId = routine.marks.get(player.id);
    const marked = markedId ? agents.find((a) => a.id === markedId && active(a)) : null;
    if (marked && routine.runs.has(markedId)) return {
      x: clamp(marked.x - routine.side * 1.2 / MX, 3, 97),
      y: clamp(marked.y + routine.attackDirection * 1.8 / MY, 0.75, 99.25),
    };
    return stage || null;
  }
  if (ball.state !== "pass" || ball.owner || ball.lastKicker !== routine.takerId ||
      routine.releasedAt == null || ball.lastPassAt !== routine.releasedAt ||
      now > ball.expectedAt + 0.4) return null;
  const target = routine.runs.get(player.id);
  if (target) return target;
  const markedId = routine.marks.get(player.id);
  const marked = markedId ? agents.find((a) => a.id === markedId && active(a)) : null;
  if (marked && routine.runs.has(markedId)) {
    return {
      x: clamp(marked.x - routine.side * 1.2 / MX, 3, 97),
      y: clamp(marked.y + routine.attackDirection * 1.8 / MY, 0.75, 99.25),
    };
  }
  // Hold the second-ball and counterattack structure during this delivery.
  return player.role !== "GK" ? routine.positions.get(player.id) || null : null;
}
