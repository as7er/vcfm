/**
 * 纪律：黄牌累计、红牌停赛
 * - 单场黄牌：本赛季 yellowsSeason +1；每满 5 张停 1 场
 * - 直红 / 两黄变一红：停 1～3 场（两黄变一红固定 1 场）
 * - 本队完赛后：已有停赛且非本场新禁赛的球员 -1 场
 */

export function ensureDiscipline(p) {
  if (!p) return p;
  if (p.yellowsSeason == null) p.yellowsSeason = 0;
  if (p.suspendedMatches == null) p.suspendedMatches = 0;
  return p;
}

export function isSuspended(p) {
  ensureDiscipline(p);
  return (p.suspendedMatches || 0) > 0;
}

export function isAvailable(p) {
  if (!p) return false;
  if ((p.injured || 0) > 0) return false;
  if (isSuspended(p)) return false;
  return true;
}

/** 赛季初清黄牌（保留未执行完的停赛） */
export function resetSeasonDiscipline(p) {
  ensureDiscipline(p);
  p.yellowsSeason = 0;
}

/**
 * 本队完成一场后：所有停赛球员 -1 场（该场已「度过」）
 * 本场才领到的停赛从下场开始，本场不扣
 */
export function tickSuspensionsAfterMatch(club, newlyBannedIds = new Set()) {
  if (!club) return;
  for (const p of club.players) {
    ensureDiscipline(p);
    if ((p.suspendedMatches || 0) <= 0) continue;
    if (newlyBannedIds.has(p.id)) continue;
    p.suspendedMatches = Math.max(0, p.suspendedMatches - 1);
  }
}

/**
 * 完整处理：先记账停赛，再 tick，返回 newlyBanned + 新闻
 */
export function processClubMatchDiscipline(club, events) {
  const news = [];
  const newlyBanned = new Set();
  if (!club || !events) return { news, newlyBanned };

  const byPlayer = new Map();
  for (const ev of events) {
    if (!ev.playerId) continue;
    if (ev.teamId && ev.teamId !== club.id) continue;
    if (ev.type !== "card" && ev.type !== "red") continue;
    const p = club.players.find((x) => x.id === ev.playerId);
    if (!p) continue;
    ensureDiscipline(p);
    let rec = byPlayer.get(p.id);
    if (!rec) {
      rec = { p, yellows: 0, red: false, secondYellow: false };
      byPlayer.set(p.id, rec);
    }
    if (ev.type === "card") rec.yellows += 1;
    if (ev.type === "red") {
      rec.red = true;
      if (ev.secondYellow) rec.secondYellow = true;
    }
  }

  for (const rec of byPlayer.values()) {
    const p = rec.p;
    // 两黄变一红：只记红停，不重复加黄累计（第二黄被红覆盖）
    if (rec.yellows > 0 && !rec.red) {
      const before = p.yellowsSeason || 0;
      p.yellowsSeason = before + rec.yellows;
      const banTicks = Math.floor(p.yellowsSeason / 5) - Math.floor(before / 5);
      if (banTicks > 0) {
        p.suspendedMatches = (p.suspendedMatches || 0) + banTicks;
        newlyBanned.add(p.id);
        news.push(`🟨 ${p.name} 赛季黄牌 ${p.yellowsSeason} 张，停赛 ${banTicks} 场`);
      }
    } else if (rec.yellows > 0 && rec.red && !rec.secondYellow) {
      // 直红同时可能有黄（少见）：黄仍累计
      const before = p.yellowsSeason || 0;
      p.yellowsSeason = before + rec.yellows;
      const banTicks = Math.floor(p.yellowsSeason / 5) - Math.floor(before / 5);
      if (banTicks > 0) {
        p.suspendedMatches = (p.suspendedMatches || 0) + banTicks;
        newlyBanned.add(p.id);
        news.push(`🟨 ${p.name} 赛季黄牌 ${p.yellowsSeason} 张，停赛 ${banTicks} 场`);
      }
    } else if (rec.secondYellow && rec.yellows >= 1) {
      // 两黄变一红：只计 1 张赛季黄（第一张）
      const before = p.yellowsSeason || 0;
      p.yellowsSeason = before + 1;
      const banTicks = Math.floor(p.yellowsSeason / 5) - Math.floor(before / 5);
      if (banTicks > 0) {
        p.suspendedMatches = (p.suspendedMatches || 0) + banTicks;
        newlyBanned.add(p.id);
        news.push(`🟨 ${p.name} 赛季黄牌 ${p.yellowsSeason} 张，停赛 ${banTicks} 场`);
      }
    }
    if (rec.red) {
      const banFinal = rec.secondYellow
        ? 1
        : 1 + (Math.random() < 0.35 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0);
      p.suspendedMatches = (p.suspendedMatches || 0) + banFinal;
      newlyBanned.add(p.id);
      news.push(
        rec.secondYellow
          ? `🟥 ${p.name} 两黄变一红，停赛 ${banFinal} 场`
          : `🟥 ${p.name} 红牌，停赛 ${banFinal} 场`
      );
    }
  }

  tickSuspensionsAfterMatch(club, newlyBanned);
  return { news, newlyBanned };
}

export function suspensionSummary(club) {
  if (!club) return [];
  return club.players
    .filter((p) => isSuspended(p))
    .map((p) => ({
      id: p.id,
      name: p.name,
      matches: p.suspendedMatches,
      yellows: p.yellowsSeason || 0,
    }));
}

/** 赛前简报数据 */
export function buildPreMatchBriefing(world, fixture, userClub) {
  if (!world || !fixture || !userClub) return null;
  const home = world.clubs.find((c) => c.id === fixture.home);
  const away = world.clubs.find((c) => c.id === fixture.away);
  if (!home || !away) return null;
  const isHome = fixture.home === userClub.id;
  const opp = isHome ? away : home;
  const me = userClub;

  const suspended = suspensionSummary(me);
  const injured = me.players
    .filter((p) => (p.injured || 0) > 0)
    .map((p) => ({ name: p.name, days: p.injured }));
  const yellowRisk = me.players
    .filter((p) => (p.yellowsSeason || 0) >= 4 && !isSuspended(p) && (p.injured || 0) <= 0)
    .map((p) => ({ name: p.name, yellows: p.yellowsSeason }));
  const tired = me.players
    .filter((p) => (p.fitness || 100) < 60 && isAvailable(p))
    .sort((a, b) => a.fitness - b.fitness)
    .slice(0, 5)
    .map((p) => ({ name: p.name, fit: p.fitness }));

  const oppTop = [...opp.players]
    .filter((p) => isAvailable(p))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 3)
    .map((p) => ({ name: p.name, pos: p.pos, ovr: p.ovr }));

  const table = world.table || {};
  const myT = table[me.id] || { pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  const opT = table[opp.id] || { pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };

  return {
    isHome,
    isCup: fixture.competition === "cup",
    roundLabel: fixture.competition === "cup"
      ? fixture.roundLabel || "联赛杯"
      : `联赛第 ${fixture.round || "?"} 轮`,
    me: { name: me.name, pts: myT.pts, form: me.form || [] },
    opp: {
      name: opp.name,
      pts: opT.pts,
      form: opp.form || [],
      power: opp.power,
      top: oppTop,
    },
    suspended,
    injured,
    yellowRisk,
    tired,
  };
}
