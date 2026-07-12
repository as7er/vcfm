/** 国家队：征召、友谊赛/预选赛简化模拟、个人国际数据 */

import { NATIONALITIES } from "./data.js";

function rng() {
  return Math.random();
}
function chance(p) {
  return rng() < p;
}

export function emptyIntl() {
  return {
    caps: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
  };
}

export function ensureIntl(p) {
  if (!p.intl) p.intl = emptyIntl();
  const e = emptyIntl();
  for (const k of Object.keys(e)) {
    if (p.intl[k] == null) p.intl[k] = 0;
  }
  return p.intl;
}

export function nationName(code) {
  return NATIONALITIES.find((n) => n.code === code)?.name || code || "—";
}

export function nationFlag(code) {
  return NATIONALITIES.find((n) => n.code === code)?.flag || "";
}

/** 按国籍聚合全世界球员 */
function playersByNation(world) {
  const map = new Map();
  for (const club of world.clubs) {
    for (const p of club.players) {
      const code = p.nationality || "ENG";
      if (!map.has(code)) map.set(code, []);
      map.get(code).push({ player: p, club });
    }
  }
  return map;
}

/**
 * 国际比赛日：每个有足够球员的国籍挑 11 人踢一场简化赛
 * 间隔由 engine 控制（约每 28–35 天）
 */
export function runInternationalBreak(world) {
  const byNation = playersByNation(world);
  const nations = [...byNation.entries()].filter(([, list]) => list.length >= 6);
  if (nations.length < 2) return { matches: 0, callups: [] };

  // 洗牌配对
  for (let i = nations.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nations[i], nations[j]] = [nations[j], nations[i]];
  }

  const userClub = world.clubs.find((c) => c.id === world.userClubId);
  const userPlayerIds = new Set((userClub?.players || []).map((p) => p.id));
  const callups = [];
  let matches = 0;

  for (let i = 0; i + 1 < nations.length; i += 2) {
    const [codeA, listA] = nations[i];
    const [codeB, listB] = nations[i + 1];
    const xiA = pickXi(listA);
    const xiB = pickXi(listB);
    const result = simIntlMatch(xiA, xiB, codeA, codeB);
    matches++;

    for (const p of xiA) {
      if (userPlayerIds.has(p.id)) {
        callups.push({
          player: p,
          nation: codeA,
          goals: result.scorersA.filter((id) => id === p.id).length,
          assists: result.assistsA.filter((id) => id === p.id).length,
          opponent: codeB,
          score: `${result.ga}-${result.gb}`,
        });
      }
    }
    for (const p of xiB) {
      if (userPlayerIds.has(p.id)) {
        callups.push({
          player: p,
          nation: codeB,
          goals: result.scorersB.filter((id) => id === p.id).length,
          assists: result.assistsB.filter((id) => id === p.id).length,
          opponent: codeA,
          score: `${result.gb}-${result.ga}`,
        });
      }
    }
  }

  if (callups.length) {
    for (const c of callups) {
      const g = c.goals;
      const a = c.assists;
      let detail = `出场`;
      if (g) detail += ` · ${g} 球`;
      if (a) detail += ` · ${a} 助`;
      world.news.unshift({
        day: world.day,
        text: `🌍 国家队：${c.player.name}（${nationFlag(c.nation)}${nationName(c.nation)}）对阵 ${nationName(c.opponent)} ${c.score}，${detail}`,
      });
    }
  } else {
    world.news.unshift({
      day: world.day,
      text: `🌍 国际比赛日结束，各路国家队完成热身/预选赛程。`,
    });
  }

  world.lastIntlDay = world.day;
  return { matches, callups };
}

function pickXi(list) {
  return list
    .map((x) => x.player)
    .filter((p) => (p.injured || 0) <= 0)
    .sort((a, b) => (b.ovr || 0) - (a.ovr || 0) || (b.potential || 0) - (a.potential || 0))
    .slice(0, 11);
}

function simIntlMatch(xiA, xiB, codeA, codeB) {
  const str = (xi) => {
    if (!xi.length) return 40;
    return xi.reduce((s, p) => s + (p.ovr || 10), 0) / xi.length;
  };
  let sa = str(xiA);
  let sb = str(xiB);
  // 泊松近似进球
  const xgA = Math.max(0.3, (sa / Math.max(sb, 1)) * 1.2);
  const xgB = Math.max(0.3, (sb / Math.max(sa, 1)) * 1.2);
  let ga = 0;
  let gb = 0;
  const scorersA = [];
  const scorersB = [];
  const assistsA = [];
  const assistsB = [];

  const rollGoals = (xg) => {
    let g = 0;
    for (let m = 0; m < 90; m++) {
      if (chance(xg / 90 * 1.6)) g++;
    }
    return Math.min(g, 6);
  };
  ga = rollGoals(xgA);
  gb = rollGoals(xgB);

  const addGoal = (xi, scorers, assists) => {
    const atk = xi.filter((p) => p.pos === "ATT" || p.pos === "MID");
    const pool = atk.length ? atk : xi;
    const scorer = pool[Math.floor(rng() * pool.length)];
    if (scorer) {
      scorers.push(scorer.id);
      ensureIntl(scorer).goals++;
      if (chance(0.65) && xi.length > 1) {
        const others = xi.filter((p) => p.id !== scorer.id && p.pos !== "GK");
        if (others.length) {
          const as = others[Math.floor(rng() * others.length)];
          assists.push(as.id);
          ensureIntl(as).assists++;
        }
      }
    }
  };

  for (let i = 0; i < ga; i++) addGoal(xiA, scorersA, assistsA);
  for (let i = 0; i < gb; i++) addGoal(xiB, scorersB, assistsB);

  // 出场 + 门将
  for (const p of xiA) {
    ensureIntl(p).caps++;
    p.morale = Math.min(100, (p.morale || 70) + 2);
  }
  for (const p of xiB) {
    ensureIntl(p).caps++;
    p.morale = Math.min(100, (p.morale || 70) + 2);
  }
  const gkA = xiA.find((p) => p.pos === "GK");
  const gkB = xiB.find((p) => p.pos === "GK");
  if (gkA) {
    ensureIntl(gkA).goalsConceded += gb;
    if (gb === 0) ensureIntl(gkA).cleanSheets++;
  }
  if (gkB) {
    ensureIntl(gkB).goalsConceded += ga;
    if (ga === 0) ensureIntl(gkB).cleanSheets++;
  }

  return { ga, gb, scorersA, scorersB, assistsA, assistsB, codeA, codeB };
}
