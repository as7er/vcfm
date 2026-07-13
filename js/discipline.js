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

function formSlice(club, n = 5) {
  const f = (club?.form || []).slice(-n);
  return f;
}

function formStr(form) {
  if (!form?.length) return "—";
  return form.join("");
}

function formTone(form) {
  if (!form?.length) return "neutral";
  let s = 0;
  for (const x of form) {
    if (x === "W") s += 1;
    else if (x === "L") s -= 1;
  }
  if (s >= 2) return "hot";
  if (s <= -2) return "cold";
  return "neutral";
}

/** 同级联赛积分榜位次（1-based）；无则 0 */
function tablePosition(world, clubId, division) {
  const clubs = (world.clubs || []).filter(
    (c) => (c.division || 3) === (division || 3)
  );
  const table = world.table || {};
  const rows = clubs
    .map((c) => {
      const t = table[c.id] || { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
      return {
        id: c.id,
        pts: t.pts || 0,
        gd: (t.gf || 0) - (t.ga || 0),
        gf: t.gf || 0,
      };
    })
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  const idx = rows.findIndex((r) => r.id === clubId);
  return idx >= 0 ? idx + 1 : 0;
}

/** 双方历史交锋（已赛） */
function headToHead(world, aId, bId, limit = 5) {
  const list = (world.fixtures || [])
    .filter(
      (f) =>
        f.played &&
        ((f.home === aId && f.away === bId) || (f.home === bId && f.away === aId))
    )
    .sort((a, b) => (b.day || 0) - (a.day || 0))
    .slice(0, limit);
  return list.map((f) => {
    const myHome = f.home === aId;
    const myG = myHome ? f.homeGoals : f.awayGoals;
    const opG = myHome ? f.awayGoals : f.homeGoals;
    let res = "D";
    if (myG > opG) res = "W";
    else if (myG < opG) res = "L";
    return {
      day: f.day,
      home: f.home,
      away: f.away,
      score: `${f.homeGoals}-${f.awayGoals}`,
      myG,
      opG,
      res,
      venue: myHome ? "H" : "A",
    };
  });
}

/**
 * 赛前简报数据（FMM 风：情境 + 近况 + 人员 + 对手）
 * @param {object} [ctx] 可选：{ weather, derby, bigMatch }（由 match 层锁定，避免循环依赖）
 */
export function buildPreMatchBriefing(world, fixture, userClub, ctx = {}) {
  if (!world || !fixture || !userClub) return null;
  const home = world.clubs.find((c) => c.id === fixture.home);
  const away = world.clubs.find((c) => c.id === fixture.away);
  if (!home || !away) return null;
  const isHome = fixture.home === userClub.id;
  const opp = isHome ? away : home;
  const me = userClub;
  const isCup = fixture.competition === "cup";
  const division = me.division || 3;

  const suspended = suspensionSummary(me);
  const injured = me.players
    .filter((p) => (p.injured || 0) > 0)
    .map((p) => ({ name: p.name, days: p.injured, pos: p.pos }))
    .sort((a, b) => b.days - a.days);
  const yellowRisk = me.players
    .filter((p) => (p.yellowsSeason || 0) >= 4 && !isSuspended(p) && (p.injured || 0) <= 0)
    .map((p) => ({ name: p.name, yellows: p.yellowsSeason, pos: p.pos }));
  const tired = me.players
    .filter((p) => (p.fitness || 100) < 62 && isAvailable(p))
    .sort((a, b) => a.fitness - b.fitness)
    .slice(0, 5)
    .map((p) => ({ name: p.name, fit: Math.round(p.fitness), pos: p.pos }));

  const xi = (me.tactics?.lineup || [])
    .map((id) => me.players.find((p) => p.id === id))
    .filter(Boolean);
  const avgFit = xi.length
    ? Math.round(xi.reduce((s, p) => s + (p.fitness || 100), 0) / xi.length)
    : null;
  const formation = me.tactics?.formation || "4-3-3";
  const style = me.tactics?.style || "balanced";

  const oppSuspended = suspensionSummary(opp);
  const oppInjured = opp.players
    .filter((p) => (p.injured || 0) > 0)
    .slice(0, 4)
    .map((p) => ({ name: p.name, days: p.injured }));
  const oppTop = [...opp.players]
    .filter((p) => isAvailable(p))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 3)
    .map((p) => ({ name: p.name, pos: p.pos, ovr: p.ovr }));
  const oppFormation = opp.tactics?.formation || "4-3-3";
  const oppStyle = opp.tactics?.style || "balanced";

  const table = world.table || {};
  const myT = table[me.id] || { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  const opT = table[opp.id] || { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  const myPos = isCup ? 0 : tablePosition(world, me.id, division);
  const opPos = isCup ? 0 : tablePosition(world, opp.id, opp.division || division);

  const myForm = formSlice(me, 5);
  const opForm = formSlice(opp, 5);
  const h2h = headToHead(world, me.id, opp.id, 5);

  // 天气/德比由调用方传入（main 在简报前 ensureFixtureWeather）
  const weather = ctx.weather || fixture.preWeather || null;
  const derby = !!ctx.derby;
  const bigMatch = !!ctx.bigMatch;

  // 看点 / 董事会压力
  const stakes = [];
  if (derby) stakes.push("derby");
  if (bigMatch) stakes.push(isCup ? "cupSpotlight" : "bigMatch");
  if (isCup) stakes.push("cup");
  if (!isCup && myPos > 0 && opPos > 0) {
    if (myPos <= 3 && opPos <= 3) stakes.push("topClash");
    if (myPos >= 14 && opPos >= 14) stakes.push("relegationSix");
  }
  const board = world.board;
  if (board?.label && board.status !== "done" && board.status !== "failed") {
    stakes.push("board");
  }

  const powerDiff = (me.power || 50) - (opp.power || 50);
  let matchup = "even";
  if (powerDiff >= 8) matchup = "favorite";
  else if (powerDiff <= -8) matchup = "underdog";

  return {
    isHome,
    isCup,
    roundLabel: isCup
      ? fixture.roundLabel || "VCFM 杯"
      : `联赛第 ${fixture.round || "?"} 轮`,
    day: fixture.day,
    weather: { key: weather.key, name: weather.name, icon: weather.icon },
    derby,
    bigMatch,
    stakes,
    matchup,
    powerDiff,
    me: {
      id: me.id,
      name: me.name,
      short: me.short || me.name,
      pts: myT.pts || 0,
      played: myT.played || 0,
      w: myT.w || 0,
      d: myT.d || 0,
      l: myT.l || 0,
      gf: myT.gf || 0,
      ga: myT.ga || 0,
      pos: myPos,
      form: myForm,
      formStr: formStr(myForm),
      formTone: formTone(myForm),
      power: me.power || 50,
      formation,
      style,
      avgFit,
    },
    opp: {
      id: opp.id,
      name: opp.name,
      short: opp.short || opp.name,
      pts: opT.pts || 0,
      played: opT.played || 0,
      w: opT.w || 0,
      d: opT.d || 0,
      l: opT.l || 0,
      gf: opT.gf || 0,
      ga: opT.ga || 0,
      pos: opPos,
      form: opForm,
      formStr: formStr(opForm),
      formTone: formTone(opForm),
      power: opp.power || 50,
      formation: oppFormation,
      style: oppStyle,
      top: oppTop,
      suspended: oppSuspended,
      injured: oppInjured,
    },
    h2h,
    suspended,
    injured,
    yellowRisk,
    tired,
    boardLabel: board?.label || "",
  };
}

/**
 * 简报 → 评论区/日志行（中文引擎文案；EN 由 UI localize）
 * @returns {string[]}
 */
export function briefingLogLines(brief) {
  if (!brief) return [];
  const lines = [];
  const venue = brief.isHome ? "主场" : "客场";
  lines.push(`📋 赛前简报 · ${brief.roundLabel} · ${venue}`);

  const wx = brief.weather;
  if (wx) {
    let ctx = `${wx.icon} ${wx.name}`;
    if (brief.derby) ctx += " · 🔥 德比";
    if (brief.bigMatch) ctx += brief.isCup ? " · 🏆 焦点杯赛" : " · ⭐ 焦点战";
    lines.push(`情境：${ctx}`);
  }

  const me = brief.me;
  const opp = brief.opp;
  if (me && opp) {
    const posMe = me.pos ? `第${me.pos}` : "—";
    const posOp = opp.pos ? `第${opp.pos}` : "—";
    if (!brief.isCup) {
      lines.push(
        `积分榜：我 ${posMe}（${me.pts}分） · 对方 ${posOp}（${opp.pts}分）`
      );
    }
    lines.push(
      `近况：我 ${me.formStr || "—"} · 对方 ${opp.formStr || "—"}`
    );
    if (me.avgFit != null) {
      lines.push(`首发体能均 ${me.avgFit}% · 阵型 ${me.formation}`);
    }
  }

  if (brief.suspended?.length) {
    lines.push(
      `停赛：${brief.suspended.map((s) => `${s.name} 停${s.matches}`).join("、")}`
    );
  }
  if (brief.injured?.length) {
    lines.push(
      `伤病：${brief.injured
        .slice(0, 5)
        .map((s) => `${s.name}${s.days ? `(${s.days}天)` : ""}`)
        .join("、")}`
    );
  }
  if (brief.yellowRisk?.length) {
    lines.push(
      `黄牌边缘：${brief.yellowRisk.map((s) => `${s.name}(${s.yellows})`).join("、")}`
    );
  }
  if (brief.tired?.length) {
    lines.push(
      `体能告急：${brief.tired.map((s) => `${s.name}${s.fit}%`).join("、")}`
    );
  }

  if (opp?.top?.length) {
    lines.push(
      `对方威胁：${opp.top.map((s) => `${s.name} ${s.ovr}`).join("、")}`
    );
  }
  if (opp?.suspended?.length) {
    lines.push(
      `对方停赛：${opp.suspended.map((s) => s.name).join("、")}`
    );
  }
  if (opp?.injured?.length) {
    lines.push(
      `对方伤病：${opp.injured.map((s) => s.name).join("、")}`
    );
  }
  if (opp) {
    lines.push(`对方部署：${opp.formation} · 实力 ${opp.power}`);
  }

  if (brief.h2h?.length) {
    const recent = brief.h2h
      .slice(0, 3)
      .map((h) => `${h.venue}${h.score}(${h.res})`)
      .join(" · ");
    lines.push(`交锋近绩：${recent}`);
  } else {
    lines.push("交锋近绩：本季首次交手");
  }

  if (brief.matchup === "favorite") lines.push("纸面：我方占优，忌轻敌");
  else if (brief.matchup === "underdog") lines.push("纸面：实力偏弱，可反击求生");
  else lines.push("纸面：实力接近，细节定胜负");

  if (brief.boardLabel) {
    lines.push(`董事会目标：${brief.boardLabel}`);
  }

  if (
    lines.length <= 4 &&
    !brief.suspended?.length &&
    !brief.injured?.length &&
    !brief.tired?.length
  ) {
    lines.push("人员齐全，无重大缺阵");
  }
  return lines;
}
