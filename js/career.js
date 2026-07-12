/**
 * 经理生涯统计 + 俱乐部荣誉墙 + 赛季结算快照
 */

import { DIVISIONS } from "./data.js";

export function emptyManagerCareer() {
  return {
    seasons: 0,
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    titles: 0, // 各级联赛冠军
    promotions: 0,
    relegations: 0,
    cups: 0,
    sacked: 0,
    bestFinish: null, // { season, division, pos, divName }
    trophies: [], // { season, type, title, detail }
  };
}

export function ensureManagerCareer(world) {
  if (!world.managerCareer) world.managerCareer = emptyManagerCareer();
  const c = world.managerCareer;
  for (const k of Object.keys(emptyManagerCareer())) {
    if (c[k] == null) c[k] = emptyManagerCareer()[k];
  }
  if (!Array.isArray(c.trophies)) c.trophies = [];
  return c;
}

export function ensureClubHonors(club) {
  if (!club) return [];
  if (!Array.isArray(club.honors)) club.honors = [];
  return club.honors;
}

/** 用户完赛后更新生涯场次 */
export function recordManagerMatch(world, myG, opG, isCup = false) {
  const c = ensureManagerCareer(world);
  c.matches += 1;
  c.goalsFor += myG;
  c.goalsAgainst += opG;
  if (myG > opG) c.wins += 1;
  else if (myG < opG) c.losses += 1;
  else c.draws += 1;
  if (isCup && myG !== opG) {
    // 杯赛胜负已在 wins/losses 计入
  }
}

export function recordManagerSack(world) {
  const c = ensureManagerCareer(world);
  c.sacked += 1;
}

/**
 * 赛季末：写入结算快照 + 俱乐部荣誉 + 经理奖杯
 */
export function settleManagerSeason(world, userPos, userDiv, promoNews = []) {
  const c = ensureManagerCareer(world);
  const club = world.clubs.find((x) => x.id === world.userClubId);
  if (!club) return null;

  c.seasons += 1;
  const divName = DIVISIONS[userDiv]?.name || `第${userDiv}级`;
  const table = world.table[club.id] || {};
  const snap = {
    season: world.season,
    division: userDiv,
    divName,
    pos: userPos,
    pts: table.pts || 0,
    w: table.w || 0,
    d: table.d || 0,
    l: table.l || 0,
    gf: table.gf || 0,
    ga: table.ga || 0,
    clubName: club.name,
  };

  // 最佳名次：级别越高越好，同级名次越小越好
  if (
    !c.bestFinish ||
    userDiv < c.bestFinish.division ||
    (userDiv === c.bestFinish.division && userPos < c.bestFinish.pos)
  ) {
    c.bestFinish = { ...snap };
  }

  ensureClubHonors(club);
  if (userPos === 1) {
    c.titles += 1;
    const title = `${divName}冠军`;
    club.honors.unshift({
      season: world.season,
      type: "champion",
      title,
      detail: `${snap.pts} 分`,
    });
    c.trophies.unshift({
      season: world.season,
      type: "champion",
      title,
      detail: club.name,
    });
  }

  // 升降级
  const promoText = (promoNews || []).join(" ");
  if (/升级|升入|升超|升甲/.test(promoText) && promoText.includes(club.name)) {
    c.promotions += 1;
    club.honors.unshift({
      season: world.season,
      type: "promotion",
      title: "升级成功",
      detail: divName,
    });
    c.trophies.unshift({
      season: world.season,
      type: "promotion",
      title: "升级",
      detail: divName,
    });
  }
  if (/降级|降入|降乙|降甲/.test(promoText) && promoText.includes(club.name)) {
    c.relegations += 1;
  }

  // 杯赛冠军
  if (world.cup?.champion === club.id) {
    c.cups += 1;
    club.honors.unshift({
      season: world.season,
      type: "cup",
      title: "VC 联赛杯冠军",
      detail: "",
    });
    c.trophies.unshift({
      season: world.season,
      type: "cup",
      title: "VC 联赛杯冠军",
      detail: club.name,
    });
  }

  if (club.honors.length > 30) club.honors.length = 30;
  if (c.trophies.length > 40) c.trophies.length = 40;

  // 结算页数据
  world.lastSeasonSummary = {
    ...snap,
    trophies: c.trophies.filter((t) => t.season === world.season),
    career: {
      seasons: c.seasons,
      matches: c.matches,
      wins: c.wins,
      draws: c.draws,
      losses: c.losses,
      titles: c.titles,
      promotions: c.promotions,
      cups: c.cups,
    },
  };

  return world.lastSeasonSummary;
}

export function managerWinRate(c) {
  if (!c || !c.matches) return 0;
  return Math.round((c.wins / c.matches) * 1000) / 10;
}
