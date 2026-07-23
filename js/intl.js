/** 国家队：征召、国际赛事与个人国际数据。 */

import { NATIONALITIES } from "./data.js";

const EUROPEAN_CODES = new Set([
  "ENG",
  "ESP",
  "GER",
  "FRA",
  "ITA",
  "POR",
  "NED",
  "BEL",
  "CRO",
  "DEN",
  "SWE",
  "NOR",
  "SUI",
  "AUT",
  "TUR",
  "SRB",
  "UKR",
  "SCO",
  "WAL",
  "IRL",
  "POL",
]);

const COMPETITION_COPY = {
  world: { name: "世界国家杯", nameEn: "World Nations Cup" },
  europe: { name: "欧洲国家锦标赛", nameEn: "European Nations Championship" },
  series: { name: "国际系列赛", nameEn: "International Series" },
};

const GROUP_ROUNDS = [
  [
    [0, 3],
    [1, 2],
  ],
  [
    [3, 2],
    [0, 1],
  ],
  [
    [1, 3],
    [2, 0],
  ],
];

function rng() {
  return Math.random();
}

function chance(p) {
  return rng() < p;
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

function emptyNationRow() {
  return { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
}

/** 按国籍聚合全世界球员。球员转会后仍按本人国籍参加国家队。 */
function playersByNation(world) {
  const map = new Map();
  for (const club of world.clubs || []) {
    for (const p of club.players || []) {
      const code = p.nationality || "ENG";
      if (!map.has(code)) map.set(code, []);
      map.get(code).push({ player: p, club });
    }
  }
  return map;
}

function pickXi(list) {
  const candidates = list
    .map((x) => x.player)
    .filter((p) => (p.injured || 0) <= 0)
    .sort((a, b) => (b.ovr || 0) - (a.ovr || 0) || (b.potential || 0) - (a.potential || 0));
  const picked = [];
  const take = (pos, count) => {
    for (const p of candidates) {
      if (picked.length >= 11 || picked.filter((x) => x.pos === pos).length >= count) break;
      if (p.pos === pos && !picked.includes(p)) picked.push(p);
    }
  };
  // 尽量组成可用阵型，再用综合能力补足人数。
  take("GK", 1);
  take("DEF", 4);
  take("MID", 3);
  take("ATT", 3);
  for (const p of candidates) {
    if (picked.length >= 11) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked;
}

/** 最新国家队名单：按能力挑选约 23 人，并尽量保持各位置数量。 */
export function nationalSquad(world, code, limit = 23) {
  const entries = playersByNation(world).get(code) || [];
  const latestMatch = [...(world.international?.matches || [])]
    .reverse()
    .find((match) => match.home === code || match.away === code);
  const latestSide = latestMatch?.home === code ? "home" : "away";
  const latestIds = new Set(latestMatch?.lineups?.[latestSide] || []);
  const candidates = entries
    .filter(({ player }) => (player.injured || 0) <= 0)
    .sort(
      ({ player: a }, { player: b }) =>
        Number(latestIds.has(b.id)) - Number(latestIds.has(a.id)) ||
        (b.ovr || 0) - (a.ovr || 0) ||
        (b.potential || 0) - (a.potential || 0) ||
        a.id.localeCompare(b.id)
    );
  const selected = [];
  const take = (pos, count) => {
    for (const entry of candidates) {
      if (selected.length >= limit || selected.filter((item) => item.player.pos === pos).length >= count) break;
      if (entry.player.pos === pos && !selected.includes(entry)) selected.push(entry);
    }
  };
  take("GK", 3);
  take("DEF", 8);
  take("MID", 7);
  take("ATT", 5);
  for (const entry of candidates) {
    if (selected.length >= limit) break;
    if (!selected.includes(entry)) selected.push(entry);
  }
  return selected.map((entry) => ({ ...entry, lastCalledUp: latestIds.has(entry.player.id) }));
}

function nationStrength(list) {
  const xi = pickXi(list);
  if (!xi.length) return 0;
  return xi.reduce((sum, p) => sum + (p.ovr || 10), 0) / xi.length;
}

function selectParticipants(entries, count, filter = () => true, required = []) {
  const eligible = [...entries]
    .filter(([code, list]) => filter(code) && list.length >= 6 && pickXi(list).length >= 6)
    .sort((a, b) => nationStrength(b[1]) - nationStrength(a[1]) || a[0].localeCompare(b[0]))
    .map(([code]) => code);
  const selected = required.filter((code) => eligible.includes(code));
  return [...selected, ...eligible.filter((code) => !selected.includes(code))].slice(0, count);
}

function makeGroups(participants, count) {
  const groups = Array.from({ length: count }, (_, i) => ({
    id: String.fromCharCode(65 + i),
    teams: [],
  }));
  participants.forEach((code, index) => groups[index % count].teams.push(code));
  return groups;
}

function createTournament(world, key, participants, groupCount) {
  const copy = COMPETITION_COPY[key];
  const groups = makeGroups(participants, groupCount);
  const table = {};
  participants.forEach((code) => {
    table[code] = emptyNationRow();
  });
  return {
    id: `intl_${key}_${world.season}`,
    key,
    type: "international",
    name: copy.name,
    nameEn: copy.nameEn,
    season: world.season,
    createdDay: world.day,
    stage: "group",
    groupRound: 0,
    groups,
    participants: [...participants],
    table,
    fixtureIds: [],
    knockout: null,
    champion: null,
    completed: false,
  };
}

function createSeries(world, participants) {
  const copy = COMPETITION_COPY.series;
  const table = {};
  participants.forEach((code) => {
    table[code] = emptyNationRow();
  });
  return {
    id: `intl_series_${world.season}`,
    key: "series",
    type: "international",
    name: copy.name,
    nameEn: copy.nameEn,
    season: world.season,
    createdDay: world.day,
    stage: "series",
    participants: [...participants],
    table,
    fixtureIds: [],
    champion: null,
    completed: false,
  };
}

function ensureSeriesCompetition(world, entries) {
  const state = world.international;
  const id = `intl_series_${world.season}`;
  let series = state.competitions[id];
  if (!series) {
    series = createSeries(world, entries.filter(([, list]) => list.length >= 6).map(([code]) => code));
    state.competitions[id] = series;
  }
  return series;
}

function ensureSeasonCompetition(world) {
  const state = world.international;
  const current = Object.values(state.competitions).find(
    (competition) => competition.season === world.season && !competition.completed
  );
  if (current) {
    state.activeCompetitionId = current.id;
    return current;
  }

  const entries = [...playersByNation(world).entries()];
  const isWorldYear = Number(world.season) % 4 === 2;
  const isEuropeYear = Number(world.season) % 4 === 0;
  const worldId = `intl_world_${world.season}`;
  const europeId = `intl_europe_${world.season}`;
  let competition = null;
  if (isWorldYear) {
    if (!state.competitions[worldId]?.completed) {
      const participants = selectParticipants(entries, 16, () => true, ["ENG", "ESP", "ITA", "GER", "FRA"]);
      if (participants.length >= 16) competition = createTournament(world, "world", participants, 4);
    }
  } else if (isEuropeYear) {
    if (!state.competitions[europeId]?.completed) {
      const participants = selectParticipants(entries, 8, (code) => EUROPEAN_CODES.has(code), ["ENG", "ESP", "ITA", "GER", "FRA"]);
      if (participants.length >= 8) competition = createTournament(world, "europe", participants, 2);
    }
  }
  if (!competition) competition = ensureSeriesCompetition(world, entries);
  state.competitions[competition.id] = competition;
  state.activeCompetitionId = competition.id;
  return competition;
}

/** 初始化或迁移国际赛事存档，不覆盖旧的球员国际累计数据。 */
export function ensureInternational(world) {
  if (!world) return null;
  if (!world.international || typeof world.international !== "object") {
    world.international = { version: 1, matches: [], competitions: {}, history: [], activeCompetitionId: null };
  }
  const state = world.international;
  if (!Array.isArray(state.matches)) state.matches = [];
  if (!state.competitions || typeof state.competitions !== "object") state.competitions = {};
  if (!Array.isArray(state.history)) state.history = [];
  for (const competition of Object.values(state.competitions)) {
    if (!Array.isArray(competition.fixtureIds)) competition.fixtureIds = [];
    if (!competition.table || typeof competition.table !== "object") competition.table = {};
  }
  ensureSeasonCompetition(world);
  return state;
}

export function listInternationalCompetitions(world) {
  const state = ensureInternational(world);
  return Object.values(state?.competitions || {}).sort(
    (a, b) => Number(b.season || 0) - Number(a.season || 0) || Number(b.createdDay || 0) - Number(a.createdDay || 0)
  );
}

export function internationalMatches(world, competitionId) {
  const state = ensureInternational(world);
  const competition = state?.competitions?.[competitionId];
  if (!competition) return [];
  const byId = new Map((state.matches || []).map((match) => [match.id, match]));
  return (competition.fixtureIds || []).map((id) => byId.get(id)).filter(Boolean);
}

export function latestInternationalCompetition(world, code) {
  const competitions = listInternationalCompetitions(world);
  const matchesFor = (competition) => internationalMatches(world, competition.id);
  return (
    competitions.find((competition) => {
      const matches = matchesFor(competition);
      return matches.length && matches.some((match) => match.home === code || match.away === code);
    }) ||
    competitions.find((competition) => competition.participants?.includes(code)) ||
    competitions[0] ||
    null
  );
}

/** 返回某国在指定国际赛事中的球员出场、进球、助攻和门将数据。 */
export function nationalCompetitionStats(world, code, competitionId) {
  const matches = competitionId
    ? internationalMatches(world, competitionId).filter((match) => match.home === code || match.away === code)
    : (world.international?.matches || []).filter((match) => match.home === code || match.away === code);
  const stats = new Map();
  const ensure = (player) => {
    if (!player?.id) return null;
    if (!stats.has(player.id)) {
      stats.set(player.id, {
        id: player.id,
        apps: 0,
        goals: 0,
        assists: 0,
        cleanSheets: 0,
        goalsConceded: 0,
      });
    }
    return stats.get(player.id);
  };
  for (const match of matches) {
    const side = match.home === code ? "home" : "away";
    const conceded = side === "home" ? match.awayGoals : match.homeGoals;
    for (const id of match.lineups?.[side] || []) {
      const player = playerById(world, id);
      if (!player || player.nationality !== code) continue;
      const row = ensure(player);
      row.apps++;
      if (player.pos === "GK") {
        row.goalsConceded += conceded;
        if (conceded === 0) row.cleanSheets++;
      }
    }
    for (const item of match.scorers?.[side] || []) {
      const row = ensure({ id: item.id });
      if (row) row.goals++;
    }
    for (const item of match.assists?.[side] || []) {
      const row = ensure({ id: item.id });
      if (row) row.assists++;
    }
  }
  return stats;
}

function sortedNationRows(competition, codes = null) {
  const selected = codes || competition.participants || Object.keys(competition.table || {});
  return selected
    .map((code) => ({ id: code, ...(competition.table?.[code] || emptyNationRow()) }))
    .sort(
      (a, b) =>
        b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.w - a.w || a.id.localeCompare(b.id)
    );
}

export function internationalTable(competition, codes = null) {
  return sortedNationRows(competition, codes);
}

function playerSnapshot(player) {
  return { id: player.id, name: player.name, nation: player.nationality || "" };
}

function roundLabelEn(label) {
  const group = String(label).match(/^小组赛 第(\d+)轮$/);
  if (group) return `Group stage · Matchday ${group[1]}`;
  if (label === "四分之一决赛") return "Quarter-finals";
  if (label === "半决赛") return "Semi-finals";
  if (label === "决赛") return "Final";
  if (label === "国际比赛日") return "International matchday";
  return label;
}

function addNationResult(competition, home, away, ga, gb) {
  const a = competition.table[home] || (competition.table[home] = emptyNationRow());
  const b = competition.table[away] || (competition.table[away] = emptyNationRow());
  a.played++;
  b.played++;
  a.gf += ga;
  a.ga += gb;
  b.gf += gb;
  b.ga += ga;
  a.gd = a.gf - a.ga;
  b.gd = b.gf - b.ga;
  if (ga > gb) {
    a.w++;
    b.l++;
    a.pts += 3;
  } else if (ga < gb) {
    b.w++;
    a.l++;
    b.pts += 3;
  } else {
    a.d++;
    b.d++;
    a.pts++;
    b.pts++;
  }
}

function simIntlMatch(xiA, xiB) {
  const str = (xi) => {
    if (!xi.length) return 40;
    return xi.reduce((s, p) => s + (p.ovr || 10), 0) / xi.length;
  };
  const sa = str(xiA);
  const sb = str(xiB);
  const xgA = Math.max(0.3, (sa / Math.max(sb, 1)) * 1.2);
  const xgB = Math.max(0.3, (sb / Math.max(sa, 1)) * 1.2);
  const rollGoals = (xg) => {
    let goals = 0;
    for (let m = 0; m < 90; m++) {
      if (chance((xg / 90) * 1.6)) goals++;
    }
    return Math.min(goals, 6);
  };
  const ga = rollGoals(xgA);
  const gb = rollGoals(xgB);
  const scorersA = [];
  const scorersB = [];
  const assistsA = [];
  const assistsB = [];
  const addGoal = (xi, scorers, assists) => {
    const atk = xi.filter((p) => p.pos === "ATT" || p.pos === "MID");
    const pool = atk.length ? atk : xi;
    const scorer = pool[Math.floor(rng() * pool.length)];
    if (!scorer) return;
    scorers.push(scorer.id);
    ensureIntl(scorer).goals++;
    if (chance(0.65)) {
      const others = xi.filter((p) => p.id !== scorer.id && p.pos !== "GK");
      if (others.length) {
        const assister = others[Math.floor(rng() * others.length)];
        assists.push(assister.id);
        ensureIntl(assister).assists++;
      }
    }
  };
  for (let i = 0; i < ga; i++) addGoal(xiA, scorersA, assistsA);
  for (let i = 0; i < gb; i++) addGoal(xiB, scorersB, assistsB);

  for (const p of [...xiA, ...xiB]) {
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
  return { ga, gb, scorersA, scorersB, assistsA, assistsB, xiA, xiB };
}

function playerById(world, id) {
  for (const club of world.clubs || []) {
    const player = (club.players || []).find((p) => p.id === id);
    if (player) return player;
  }
  return null;
}

function recordMatch(world, competition, codeA, codeB, roundLabel, knockout = false) {
  const entries = playersByNation(world);
  const xiA = pickXi(entries.get(codeA) || []);
  const xiB = pickXi(entries.get(codeB) || []);
  const result = simIntlMatch(xiA, xiB);
  const match = {
    id: uid("intl_match"),
    competitionId: competition.id,
    competitionKey: competition.key,
    competitionName: competition.name,
    competitionNameEn: competition.nameEn,
    season: world.season,
    day: world.day,
    roundLabel,
    roundLabelEn: roundLabelEn(roundLabel),
    home: codeA,
    away: codeB,
    homeGoals: result.ga,
    awayGoals: result.gb,
    penalties: null,
    played: true,
    lineups: { home: xiA.map((p) => p.id), away: xiB.map((p) => p.id) },
    scorers: {
      home: result.scorersA.map((id) => playerSnapshot(playerById(world, id) || { id, name: id, nationality: codeA })),
      away: result.scorersB.map((id) => playerSnapshot(playerById(world, id) || { id, name: id, nationality: codeB })),
    },
    assists: {
      home: result.assistsA.map((id) => playerSnapshot(playerById(world, id) || { id, name: id, nationality: codeA })),
      away: result.assistsB.map((id) => playerSnapshot(playerById(world, id) || { id, name: id, nationality: codeB })),
    },
  };
  if (knockout && match.homeGoals === match.awayGoals) {
    const homePen = 3 + Math.floor(rng() * 3);
    const awayPen = 3 + Math.floor(rng() * 3);
    match.penalties = { home: homePen, away: awayPen };
    if (homePen === awayPen) match.penalties.home++;
  }
  competition.fixtureIds.push(match.id);
  world.international.matches.push(match);
  addNationResult(competition, codeA, codeB, match.homeGoals, match.awayGoals);
  return match;
}

function winnerOf(match) {
  if (match.homeGoals > match.awayGoals) return match.home;
  if (match.awayGoals > match.homeGoals) return match.away;
  return (match.penalties?.home || 0) > (match.penalties?.away || 0) ? match.home : match.away;
}

function groupRound(world, competition) {
  const round = competition.groupRound || 0;
  const fixtures = GROUP_ROUNDS[round] || [];
  for (const group of competition.groups || []) {
    for (const [a, b] of fixtures) {
      const home = group.teams[a];
      const away = group.teams[b];
      if (home && away) recordMatch(world, competition, home, away, `小组赛 第${round + 1}轮`);
    }
  }
  competition.groupRound = round + 1;
  if (competition.groupRound < GROUP_ROUNDS.length) return;

  const qualifiers = [];
  for (const group of competition.groups || []) {
    const rows = internationalTable(competition, group.teams);
    qualifiers.push(rows[0]?.id, rows[1]?.id);
  }
  const pairs = [];
  if (competition.key === "world") {
    for (let i = 0; i < qualifiers.length; i += 4) {
      pairs.push([qualifiers[i], qualifiers[i + 3]], [qualifiers[i + 2], qualifiers[i + 1]]);
    }
  } else {
    for (let i = 0; i < qualifiers.length; i += 2) {
      pairs.push([qualifiers[i], qualifiers[i + 1]]);
    }
  }
  competition.stage = "knockout";
  competition.knockout = { stage: competition.key === "world" ? "QF" : "SF", pairs: pairs.filter((p) => p[0] && p[1]) };
}

function knockoutRound(world, competition) {
  const knockout = competition.knockout;
  if (!knockout?.pairs?.length) return;
  const winners = [];
  for (const [home, away] of knockout.pairs) {
    const label = knockout.stage === "QF" ? "四分之一决赛" : knockout.stage === "SF" ? "半决赛" : "决赛";
    const match = recordMatch(world, competition, home, away, label, true);
    winners.push(winnerOf(match));
  }
  if (knockout.stage === "F") {
    competition.champion = winners[0] || null;
    competition.completed = true;
    competition.stage = "done";
    if (!world.international.history.some((item) => item.id === competition.id)) {
      world.international.history.unshift({
        id: competition.id,
        key: competition.key,
        season: competition.season,
        name: competition.name,
        nameEn: competition.nameEn,
        champion: competition.champion,
      });
    }
    return;
  }
  if (winners.length === 2) {
    competition.knockout = { stage: "F", pairs: [[winners[0], winners[1]]] };
  } else {
    const pairs = [];
    for (let i = 0; i < winners.length; i += 2) pairs.push([winners[i], winners[i + 1]]);
    competition.knockout = { stage: "SF", pairs };
  }
}

function seriesRound(world, competition, entries) {
  const codes = shuffle(entries.filter(([, list]) => list.length >= 6).map(([code]) => code));
  for (let i = 0; i + 1 < codes.length; i += 2) {
    recordMatch(world, competition, codes[i], codes[i + 1], "国际比赛日");
  }
}

function appendInternationalNews(world, competition, matches) {
  if (!Array.isArray(world.news)) world.news = [];
  const callups = [];
  const userIds = new Set(
    (world.clubs?.find((club) => club.id === world.userClubId)?.players || []).map((p) => p.id)
  );
  for (const match of matches) {
    const userCallups = [...(match.lineups.home || []), ...(match.lineups.away || [])].filter((id) => userIds.has(id));
    for (const id of userCallups) {
      const player = playerById(world, id);
      if (!player) continue;
      const isHome = match.lineups.home.includes(id);
      const goals = (match.scorers[isHome ? "home" : "away"] || []).filter((p) => p.id === id).length;
      const assists = (match.assists[isHome ? "home" : "away"] || []).filter((p) => p.id === id).length;
      const score = isHome
        ? `${match.homeGoals}-${match.awayGoals}`
        : `${match.awayGoals}-${match.homeGoals}`;
      callups.push({
        player,
        nation: isHome ? match.home : match.away,
        goals,
        assists,
        opponent: isHome ? match.away : match.home,
        score,
      });
      const detail = [`出场`, goals ? `${goals}球` : "", assists ? `${assists}助` : ""].filter(Boolean).join(" · ");
      world.news.unshift({
        day: world.day,
        text: `🌍 ${competition.name}：${player.name}（${nationFlag(player.nationality)}${nationName(player.nationality)}）对阵 ${nationName(isHome ? match.away : match.home)} ${score}，${detail}`,
      });
    }
  }
  if (competition.completed && competition.champion) {
    world.news.unshift({
      day: world.day,
      text: `🏆 ${competition.name}结束，${nationFlag(competition.champion)}${nationName(competition.champion)}夺冠。`,
    });
  }
  return callups;
}

/** 国际比赛日：赛事年份进行国家杯赛，其余时间进行国际系列赛。 */
export function runInternationalBreak(world) {
  const state = ensureInternational(world);
  const byNation = playersByNation(world);
  const nations = [...byNation.entries()].filter(([, list]) => list.length >= 6);
  world.lastIntlDay = world.day;
  if (nations.length < 2) return { matches: 0, callups: [] };

  let competition = state.competitions[state.activeCompetitionId] || ensureSeasonCompetition(world);
  if (competition.completed) {
    competition = ensureSeriesCompetition(world, nations);
    state.activeCompetitionId = competition.id;
  }
  const before = state.matches.length;
  if (competition.key === "series") {
    seriesRound(world, competition, nations);
  } else if (competition.stage === "group") {
    groupRound(world, competition);
  } else if (competition.stage === "knockout") {
    knockoutRound(world, competition);
  }
  const matches = state.matches.slice(before);
  const callups = appendInternationalNews(world, competition, matches);
  return { matches: matches.length, callups };
}

export function internationalLeaders(world, competitionId) {
  const matches = internationalMatches(world, competitionId);
  const scorers = new Map();
  const assists = new Map();
  const appearances = new Map();
  const keepers = new Map();
  const add = (map, item, nation) => {
    if (!item?.id) return;
    const current = map.get(item.id) || { id: item.id, name: item.name || item.id, nation, value: 0 };
    current.value++;
    map.set(item.id, current);
  };
  for (const match of matches) {
    for (const side of ["home", "away"]) {
      for (const id of match.lineups?.[side] || []) {
        const player = playerById(world, id);
        add(appearances, { id, name: player?.name || id }, player?.nationality || match[side]);
        if (player?.pos === "GK") {
          const current = keepers.get(id) || {
            id,
            name: player.name || id,
            nation: player.nationality || match[side],
            apps: 0,
            cleanSheets: 0,
            goalsConceded: 0,
          };
          const conceded = side === "home" ? match.awayGoals : match.homeGoals;
          current.apps++;
          current.goalsConceded += conceded;
          if (conceded === 0) current.cleanSheets++;
          keepers.set(id, current);
        }
      }
      for (const item of match.scorers?.[side] || []) add(scorers, item, item.nation || match[side]);
      for (const item of match.assists?.[side] || []) add(assists, item, item.nation || match[side]);
    }
  }
  const sort = (map) => [...map.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, 10);
  return {
    scorers: sort(scorers),
    assists: sort(assists),
    appearances: sort(appearances),
    keepers: [...keepers.values()]
      .sort((a, b) => b.cleanSheets - a.cleanSheets || a.goalsConceded - b.goalsConceded || a.name.localeCompare(b.name))
      .slice(0, 10),
  };
}
