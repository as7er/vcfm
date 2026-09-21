/**
 * Pure post-match analysis derived from SimEngine events.
 * No metric here changes the simulation result or rolls additional randomness.
 */

const TEAMS = ["home", "away"];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round((Number(value) || 0) * scale) / scale;
}

function finite(value, fallback = 50) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize both teams so they attack from y=0 toward y=100. */
function attackCoordinates(team, x, y, endsSwapped = false) {
  const px = clamp(finite(x), 0, 100);
  const py = clamp(finite(y), 0, 100);
  // ⚠ 2026-09-22 修：原式 `team === "away" ? {100-px, py} : {px, 100-py}` 把
  //   「主队朝 y=0 攻」写死了 ⇒ 下半场换边后热区/传球网络会整体镜像错。
  //   改看该事件发生时的半场（`event.endsSwapped` 由引擎 `_emit` 写入；
  //   缺省 false ⇒ 与旧行为逐位一致）。
  const attacksLow = endsSwapped ? team === "away" : team === "home";
  return attacksLow ? { x: px, y: 100 - py } : { x: 100 - px, y: py };
}

/**
 * Pre-shot xG. Outcome is deliberately excluded: a miss does not make the
 * chance worse after the fact.
 */
export function estimateShotXg(shot) {
  if (!shot) return 0.05;
  if (shot.penalty) return 0.76;

  const team = shot.team === "away" ? "away" : "home";
  const x = clamp(finite(shot.x), 0, 100);
  const y = clamp(finite(shot.y), 0, 100);
  // ⚠ 2026-09-22 修：原式是 `team === "home" ? 0 : 100`，把「主队朝 y=0 攻」写死了
  //   ⇒ 下半场换边后 xG 会拿**错误的球门**算距离与角度。改看该事件发生时的半场
  //   （`shot.endsSwapped` 由引擎 `_emit` 写入；缺省 false ⇒ 与旧行为逐位一致）。
  const attacksLow = shot.endsSwapped ? team === "away" : team === "home";
  const goalY = attacksLow ? 0 : 100;
  const distance = Number.isFinite(Number(shot.distance))
    ? Math.max(1, Number(shot.distance))
    : Math.hypot(x - 50, y - goalY);
  const goalDepth = Math.max(0.8, Math.abs(y - goalY));
  const leftAngle = Math.atan2(44 - x, goalDepth);
  const rightAngle = Math.atan2(56 - x, goalDepth);
  const visibleAngle = Math.abs(rightAngle - leftAngle);
  const angleFactor = 0.48 + 0.52 * clamp(visibleAngle / 0.72, 0, 1);
  const pressure = clamp(Number(shot.pressure) || 0, 0, 1);

  let xg = 0.58 * Math.exp(-distance / 14) * angleFactor;
  xg *= 1 - pressure * 0.28;
  if (shot.openGoal) xg = Math.max(xg, 0.42);
  if (shot.long) xg *= 0.78;
  if (shot.freekick) xg *= 0.74;
  return clamp(xg, 0.01, 0.72);
}

function shotOutcome(events, index, shot) {
  if (shot.offTarget) return "offTarget";
  const other = shot.team === "home" ? "away" : "home";
  for (let i = index + 1; i < events.length; i++) {
    const next = events[i];
    if (finite(next.t, Infinity) - finite(shot.t, 0) > 6) break;
    if (next.type === "shot") break;
    if (next.type === "goal" && next.team === shot.team) return "goal";
    if (next.type === "save" && next.team === other) return "saved";
    if (next.type === "block" && next.team === other) return "blocked";
  }
  return "offTarget";
}

function emptySide() {
  return {
    xg: 0,
    openPlayXg: 0,
    shots: [],
    progression: {
      passesAttempted: 0,
      passesCompleted: 0,
      passCompletionPct: 0,
      progressivePasses: 0,
      finalThirdEntries: 0,
      boxEntries: 0,
    },
    pressing: {
      pressures: 0,
      pressureSuccesses: 0,
      pressureSuccessPct: 0,
      highPressures: 0,
      regains: 0,
      highRegains: 0,
    },
    shape: {
      leftPct: 0,
      centerPct: 0,
      rightPct: 0,
      averageActionHeight: 0,
    },
    heatmap: { cols: 6, rows: 10, max: 0, cells: Array(60).fill(0) },
    network: { nodes: [], edges: [], hub: null },
  };
}

function playerName(options, team, playerId) {
  if (!playerId) return "";
  const club = team === "home" ? options.home : options.away;
  return club?.players?.find((player) => player.id === playerId)?.name || String(playerId);
}

function addHeat(side, team, x, y, playerId, nodeBag, weight = 1, endsSwapped = false) {
  const pos = attackCoordinates(team, x, y, endsSwapped);
  const col = clamp(Math.floor(pos.x / (100 / side.heatmap.cols)), 0, side.heatmap.cols - 1);
  const row = clamp(Math.floor(pos.y / (100 / side.heatmap.rows)), 0, side.heatmap.rows - 1);
  side.heatmap.cells[row * side.heatmap.cols + col] += weight;

  if (playerId) {
    if (!nodeBag.has(playerId)) nodeBag.set(playerId, { x: 0, y: 0, weight: 0, passes: 0, received: 0 });
    const node = nodeBag.get(playerId);
    node.x += pos.x * weight;
    node.y += pos.y * weight;
    node.weight += weight;
  }
  return pos;
}

function isBoxEntry(start, end) {
  const inBox = (p) => p.y >= 82 && p.x >= 18 && p.x <= 82;
  return !inBox(start) && inBox(end);
}

function successfulPressure(events, index, event) {
  for (let i = index + 1; i < events.length; i++) {
    const next = events[i];
    if (finite(next.t, Infinity) - finite(event.t, 0) > 3) break;
    if (next.team === event.team && (next.type === "tackle" || next.type === "intercept")) return true;
  }
  return false;
}

function finalizeSide(side, team, options, nodeBag, edgeBag, actionZones, compact) {
  const progression = side.progression;
  progression.passCompletionPct = progression.passesAttempted
    ? round((progression.passesCompleted / progression.passesAttempted) * 100)
    : 0;

  const pressing = side.pressing;
  pressing.pressureSuccessPct = pressing.pressures
    ? round((pressing.pressureSuccesses / pressing.pressures) * 100)
    : 0;

  const zoneTotal = actionZones.left + actionZones.center + actionZones.right;
  if (zoneTotal) {
    side.shape.leftPct = round((actionZones.left / zoneTotal) * 100);
    side.shape.centerPct = round((actionZones.center / zoneTotal) * 100);
    side.shape.rightPct = round(100 - side.shape.leftPct - side.shape.centerPct);
    side.shape.averageActionHeight = round(actionZones.height / zoneTotal);
  }

  side.xg = round(side.xg, 2);
  side.openPlayXg = round(side.openPlayXg, 2);
  if (compact) {
    delete side.heatmap;
    delete side.network;
    return;
  }
  side.heatmap.cells = side.heatmap.cells.map((value) => round(value, 1));
  side.heatmap.max = Math.max(0, ...side.heatmap.cells);

  const nodes = [];
  for (const [playerId, bag] of nodeBag) {
    if (!bag.weight) continue;
    nodes.push({
      playerId,
      name: playerName(options, team, playerId),
      x: round(bag.x / bag.weight),
      y: round(bag.y / bag.weight),
      touches: round(bag.weight),
      passes: bag.passes,
      received: bag.received,
    });
  }
  nodes.sort((a, b) => b.passes + b.received - (a.passes + a.received));
  const visibleIds = new Set(nodes.slice(0, 11).map((node) => node.playerId));
  side.network.nodes = nodes.filter((node) => visibleIds.has(node.playerId));
  side.network.edges = [...edgeBag.values()]
    .filter((edge) => visibleIds.has(edge.fromId) && visibleIds.has(edge.toId))
    .sort((a, b) => b.count - a.count || b.progressive - a.progressive)
    .slice(0, 20);
  side.network.hub = side.network.nodes[0] || null;
}

/**
 * @param {object[]} rawEvents SimEngine event stream
 * @param {{home?: object, away?: object}} options clubs used only for player names
 */
export function deriveMatchAnalysis(rawEvents, options = {}) {
  const compact = options.compact === true;
  const events = (Array.isArray(rawEvents) ? rawEvents : [])
    .map((event, index) => ({ ...event, _index: index }))
    .sort((a, b) => finite(a.t, 0) - finite(b.t, 0) || a._index - b._index);
  const result = { version: 1, source: "sim-events", home: emptySide(), away: emptySide() };
  const pendingPasses = { home: [], away: [] };
  const completedPasses = { home: [], away: [] };
  const nodeBags = { home: new Map(), away: new Map() };
  const edgeBags = { home: new Map(), away: new Map() };
  const actionZones = {
    home: { left: 0, center: 0, right: 0, height: 0 },
    away: { left: 0, center: 0, right: 0, height: 0 },
  };

  const noteAction = (team, x, y, playerId, weight = 1, endsSwapped = false) => {
    if (!TEAMS.includes(team)) return null;
    const pos = compact
      ? attackCoordinates(team, x, y, endsSwapped)
      : addHeat(result[team], team, x, y, playerId, nodeBags[team], weight, endsSwapped);
    const zone = pos.x < 34 ? "left" : pos.x > 66 ? "right" : "center";
    actionZones[team][zone] += weight;
    actionZones[team].height += pos.y * weight;
    return pos;
  };

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const team = event.team;
    if (!TEAMS.includes(team)) continue;
    const side = result[team];

    if (event.type === "pass") {
      const start = noteAction(team, event.x, event.y, event.agentId, 1, event.endsSwapped);
      const end = attackCoordinates(team, event.toX, event.toY, event.endsSwapped);
      const pass = { event, start, end, completed: false, receiverId: null };
      pendingPasses[team].push(pass);
      side.progression.passesAttempted++;
      continue;
    }

    if (event.type === "receive") {
      const pending = pendingPasses[team];
      let match = null;
      for (let j = pending.length - 1; j >= 0; j--) {
        const candidate = pending[j];
        if (finite(event.t, 0) - finite(candidate.event.t, 0) > 8) break;
        if (!candidate.completed && (!event.from || candidate.event.agentId === event.from)) {
          match = candidate;
          break;
        }
      }
      const end = noteAction(team, event.x, event.y, event.agentId, 1, event.endsSwapped);
      if (!match || !end) continue;
      match.completed = true;
      match.receiverId = event.agentId || null;
      match.end = end;
      completedPasses[team].push(match);
      side.progression.passesCompleted++;
      const startDistance = 100 - match.start.y;
      const endDistance = 100 - end.y;
      const progressive = match.start.y < 75 && end.y - match.start.y >= 10 && endDistance <= startDistance * 0.75;
      if (progressive) side.progression.progressivePasses++;
      if (match.start.y < 66.7 && end.y >= 66.7) side.progression.finalThirdEntries++;
      if (isBoxEntry(match.start, end)) side.progression.boxEntries++;

      const fromId = match.event.agentId;
      const toId = event.agentId;
      if (!compact && fromId && toId && fromId !== toId) {
        const fromNode = nodeBags[team].get(fromId);
        const toNode = nodeBags[team].get(toId);
        if (fromNode) fromNode.passes++;
        if (toNode) toNode.received++;
        const key = `${fromId}>${toId}`;
        const edge = edgeBags[team].get(key) || { fromId, toId, count: 0, progressive: 0 };
        edge.count++;
        if (progressive) edge.progressive++;
        edgeBags[team].set(key, edge);
      }
      continue;
    }

    if (event.type === "shot") {
      const pos = noteAction(team, event.x, event.y, event.agentId, 1.5, event.endsSwapped);
      const xg = estimateShotXg(event);
      const shot = {
        minute: clamp(Math.floor(finite(event.t, 0) / 60) + 1, 1, 90),
        playerId: event.agentId || null,
        playerName: playerName(options, team, event.agentId),
        x: round(pos?.x ?? 50),
        y: round(pos?.y ?? 84),
        xg: round(xg, 2),
        outcome: shotOutcome(events, i, event),
        penalty: !!event.penalty,
        freekick: !!event.freekick,
      };
      side.shots.push(shot);
      side.xg += xg;
      if (!shot.penalty && !shot.freekick) side.openPlayXg += xg;
      continue;
    }

    if (event.type === "pressure") {
      const pos = noteAction(team, event.x, event.y, event.agentId, 0.6, event.endsSwapped);
      side.pressing.pressures++;
      if (pos?.y >= 66.7) side.pressing.highPressures++;
      if (successfulPressure(events, i, event)) side.pressing.pressureSuccesses++;
      continue;
    }

    if (event.type === "tackle" || event.type === "intercept") {
      const pos = noteAction(team, event.x, event.y, event.agentId, 1, event.endsSwapped);
      side.pressing.regains++;
      if (pos?.y >= 66.7) side.pressing.highRegains++;
      continue;
    }

    if (event.type === "foul") noteAction(team, event.x, event.y, event.agentId, 0.5, event.endsSwapped);
  }

  for (const team of TEAMS) {
    finalizeSide(
      result[team],
      team,
      options,
      nodeBags[team],
      edgeBags[team],
      actionZones[team],
      compact
    );
  }
  if (compact) result.compact = true;
  return result;
}

