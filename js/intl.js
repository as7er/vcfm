/** 国家队：征召、国际赛事与个人国际数据。 */

import { NATIONALITIES, DIVISIONS } from "./data.js";
import { diagnoseInjury, injuryRiskMultiplier } from "./injuries.js";

/**
 * 每名整场出战球员的单场伤病基准概率。
 *
 * 与俱乐部比赛同量级：`match.js` 的 `tryInjury` 每分钟以 0.005 抽一次、
 * 每次随机选一队，90 分钟约合每队每场 0.22 次，摊到 11 人即约 0.02/人。
 * 征召之所以更让俱乐部头疼，不是这里的基准更高，而是国家队没有俱乐部的
 * 队医与康复设施减免（`doctorInjuryMod` / `trainingInjuryMod`），
 * 再加上长途奔波的额外体能消耗。
 */
const CALLUP_INJURY_BASE = 0.02;

/** 长途奔波带来的额外体能消耗，叠加在与俱乐部比赛同量级的基础消耗之上。 */
const INTL_TRAVEL_DRAIN = 2;

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
  europe: { name: "欧洲杯", nameEn: "European Championship" },
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

export function nationName(code, lang = "zh") {
  const nation = NATIONALITIES.find((n) => n.code === code);
  if (!nation) return code || "—";
  return lang === "en" ? nation.nameEn || nation.name || code : nation.name || nation.nameEn || code;
}

export function nationFlag(code) {
  return NATIONALITIES.find((n) => n.code === code)?.flag || "";
}

export function emptyNationRow() {
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

function bounded(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function latestLineupIds(world, code) {
  const latestMatch = [...(world.international?.matches || [])]
    .reverse()
    .find((match) => match.home === code || match.away === code);
  const side = latestMatch?.home === code ? "home" : "away";
  return new Set(latestMatch?.lineups?.[side] || []);
}

function nationalAvailable(player) {
  return (player?.injured || 0) <= 0 && (player?.intlSuspendedMatches || 0) <= 0;
}

/**
 * 现实征召评分：能力为主体，赛季表现、出场率、体能和国家队连续性影响边缘竞争。
 * 分数沿用 1–20 能力尺度，便于解释；俱乐部停赛不会错误延伸到国家队。
 */
export function nationalCallupScore(world, player, club = null, latestIds = null) {
  if (!player) return 0;
  const stats = player.stats || {};
  const apps = Math.max(0, Number(stats.apps) || 0);
  const avgRating = apps > 0 && (stats.ratingSum || 0) > 0 ? stats.ratingSum / apps : null;
  const lastRating = stats.lastRating != null && Number.isFinite(Number(stats.lastRating)) ? Number(stats.lastRating) : null;
  const fitness = Number(player.fitness ?? 100);
  const morale = Number(player.morale ?? 70);
  const intl = player.intl || {};
  const resolvedClub = club || (world.clubs || []).find((item) => item.id === player.clubId) || null;
  const clubPlayed = Number(world.table?.[resolvedClub?.id]?.played) || 0;
  const recentLineup = latestIds || latestLineupIds(world, player.nationality);

  // 近期状态（最近最多 5 场评分均）：与阵容「状态」列同源，影响边缘名额
  const formRatings = Array.isArray(stats.recentRatings) ? stats.recentRatings : [];
  const form =
    formRatings.length > 0
      ? formRatings.reduce((sum, r) => sum + (Number(r) || 0), 0) / formRatings.length
      : null;

  let score = Number(player.ovr) || 10;
  // 舞台高度：现实中低级别联赛球员即使数据亮眼也极难获得强国征召，
  // 顶级联赛的日常对抗强度本身就是选拔依据。只影响入选顺位，不改能力。
  const tier = Number(DIVISIONS[resolvedClub?.division]?.tier) || 2;
  score += tier === 1 ? 0.35 : tier === 2 ? -0.55 : -1.4;
  // ⚠ 这里的 3 场**故意不同于**评分榜的门槛（联赛榜取 10，见 `engine.js`）。
  //   用途不同：评分榜是**对外展示**，样本不足会把替补顶到榜首（已被量化证实），
  //   故门槛要严；而这里是**国家队征召的内部评分**，场均分只是 score 的一个
  //   限幅加成项（`bounded` 到 ±0.9），样本少只会让它影响小，不会造成
  //   「谁该入选」的错判。门槛低一点反而能让年轻球员的亮眼表现更早进入视野。
  if (avgRating != null && apps >= 3) score += bounded((avgRating - 6.6) * 0.55, -0.8, 0.9);
  if (form != null && formRatings.length >= 2) score += bounded((form - 6.5) * 0.22, -0.4, 0.5);
  else if (lastRating != null) score += bounded((lastRating - 6.5) * 0.18, -0.35, 0.45);
  if (clubPlayed >= 4) {
    const appearanceRate = bounded(apps / clubPlayed, 0, 1);
    score += bounded((appearanceRate - 0.55) * 0.8, -0.45, 0.35);
  }
  score += bounded((fitness - 82) / 45, -1.15, 0.4);
  score += bounded((morale - 70) / 120, -0.25, 0.25);
  score += Math.min(0.15, (Number(intl.caps) || 0) * 0.006);
  if (recentLineup.has(player.id)) score += 0.2;

  if ((player.age || 25) <= 23 && (player.potential || 0) > (player.ovr || 0)) {
    score += Math.min(0.24, ((player.potential || 0) - (player.ovr || 0)) * 0.08);
  }

  if (apps > 0) {
    if (player.pos === "GK") {
      const cleanRate = (Number(stats.cleanSheets) || 0) / apps;
      const concededRate = (Number(stats.goalsConceded) || 0) / apps;
      score += bounded(cleanRate * 0.22 - Math.max(0, concededRate - 1.4) * 0.08, -0.25, 0.25);
    } else if (player.pos === "ATT") {
      score += Math.min(0.35, ((Number(stats.goals) || 0) * 0.25 + (Number(stats.assists) || 0) * 0.1) / apps);
    } else if (player.pos === "MID") {
      score += Math.min(0.3, ((Number(stats.goals) || 0) * 0.1 + (Number(stats.assists) || 0) * 0.2) / apps);
    } else if (player.pos === "DEF") {
      score += Math.min(0.18, ((Number(stats.cleanSheets) || 0) / apps) * 0.18);
    }
  }
  return Math.round(score * 100) / 100;
}

function callupCandidates(world, code, list) {
  const latestIds = latestLineupIds(world, code);
  return list
    .filter(({ player }) => nationalAvailable(player))
    .map((entry) => ({ ...entry, selectionScore: nationalCallupScore(world, entry.player, entry.club, latestIds) }))
    .sort(
      (a, b) =>
        b.selectionScore - a.selectionScore ||
        (b.player.ovr || 0) - (a.player.ovr || 0) ||
        (b.player.potential || 0) - (a.player.potential || 0) ||
        a.player.id.localeCompare(b.player.id)
    );
}

function pickSquadEntries(world, code, list, limit = 23) {
  const candidates = callupCandidates(world, code, list);
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
  return selected;
}

const NATIONAL_NUMBER_PREFERENCES = Object.freeze({
  GK: [1, 12, 23],
  DEF: [2, 3, 4, 5, 13, 14, 15, 16],
  MID: [6, 8, 10, 17, 18, 20, 21],
  ATT: [7, 9, 11, 19, 22],
});

function assignNationalNumbers(entries) {
  const used = new Set();
  const posIndex = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  return entries.map((entry) => {
    const prefs = NATIONAL_NUMBER_PREFERENCES[entry.player.pos] || [];
    let number = prefs[posIndex[entry.player.pos] || 0] || null;
    posIndex[entry.player.pos] = (posIndex[entry.player.pos] || 0) + 1;
    if (!number || used.has(number)) {
      number = Array.from({ length: 23 }, (_, index) => index + 1).find((candidate) => !used.has(candidate)) || null;
    }
    if (number) used.add(number);
    return { ...entry, squadNumber: number };
  });
}

function pickXi(world, code, list) {
  const candidates = pickSquadEntries(world, code, list)
    .slice()
    .sort((a, b) => b.selectionScore - a.selectionScore || (b.player.ovr || 0) - (a.player.ovr || 0));
  const picked = [];
  const take = (pos, count) => {
    for (const entry of candidates) {
      if (picked.length >= 11 || picked.filter((x) => x.pos === pos).length >= count) break;
      const player = entry.player;
      if (player.pos === pos && !picked.includes(player)) picked.push(player);
    }
  };
  // 尽量组成可用阵型，再用综合能力补足人数。
  take("GK", 1);
  take("DEF", 4);
  take("MID", 3);
  take("ATT", 3);
  for (const entry of candidates) {
    if (picked.length >= 11) break;
    if (!picked.includes(entry.player)) picked.push(entry.player);
  }
  return picked;
}

export function nationalStartingXi(world, code) {
  return pickXi(world, code, playersByNation(world).get(code) || []);
}

/**
 * 全部国家队一览：人才池、实力、是否可参赛。
 * 实力取当前可出场 11 人平均能力；池子不足 6 人视为不可组队。
 */
export function listNationalTeams(world) {
  const byNation = playersByNation(world);
  const teams = NATIONALITIES.map((nation) => {
    const list = byNation.get(nation.code) || [];
    const xi = pickXi(world, nation.code, list);
    return {
      code: nation.code,
      name: nation.name,
      nameEn: nation.nameEn,
      flag: nation.flag,
      pool: list.length,
      xiSize: xi.length,
      strength: Math.round(xiStrength(xi) * 10) / 10,
      eligible: list.length >= 6 && xi.length >= 6,
    };
  });
  return teams.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.strength - a.strength ||
      b.pool - a.pool ||
      a.code.localeCompare(b.code)
  );
}

function accumulateNationRow(row, gf, ga) {
  row.played++;
  row.gf += gf || 0;
  row.ga += ga || 0;
  if (gf > ga) {
    row.w++;
    row.pts += 3;
  } else if (gf < ga) {
    row.l++;
  } else {
    row.d++;
    row.pts++;
  }
  row.gd = row.gf - row.ga;
}

/**
 * 一次扫描算出所有国家的累计战绩（全历史或指定赛事）。
 * 需要多国战绩时用它，避免按国家反复扫描比赛列表。
 */
export function nationalRecords(world, competitionId = null) {
  const matches = competitionId
    ? internationalMatches(world, competitionId)
    : world.international?.matches || [];
  const rows = new Map();
  const rowFor = (code) => {
    let row = rows.get(code);
    if (!row) rows.set(code, (row = emptyNationRow()));
    return row;
  };
  for (const match of matches) {
    accumulateNationRow(rowFor(match.home), match.homeGoals, match.awayGoals);
    accumulateNationRow(rowFor(match.away), match.awayGoals, match.homeGoals);
  }
  return rows;
}

/** 某国在国际赛事中的累计战绩（全历史或指定赛事）。 */
export function nationalRecord(world, code, competitionId = null) {
  return nationalRecords(world, competitionId).get(code) || emptyNationRow();
}

/** 最新国家队名单：按能力挑选约 23 人，并尽量保持各位置数量。 */
export function nationalSquad(world, code, limit = 23) {
  const entries = playersByNation(world).get(code) || [];
  const latestIds = latestLineupIds(world, code);
  const selected = assignNationalNumbers(pickSquadEntries(world, code, entries, limit));
  return selected.map((entry) => ({ ...entry, lastCalledUp: latestIds.has(entry.player.id) }));
}

export function xiStrength(xi) {
  if (!xi.length) return 0;
  return xi.reduce((sum, p) => sum + (p.ovr || 10), 0) / xi.length;
}

function nationStrength(world, code, list) {
  return xiStrength(pickXi(world, code, list));
}

function selectParticipants(world, entries, count, filter = () => true, required = []) {
  const eligible = [...entries]
    .filter(([code, list]) => filter(code) && list.length >= 6 && pickXi(world, code, list).length >= 6)
    .sort(
      (a, b) =>
        nationStrength(world, b[0], b[1]) - nationStrength(world, a[0], a[1]) ||
        a[0].localeCompare(b[0])
    )
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
    series = createSeries(
      world,
      entries.filter(([code, list]) => pickXi(world, code, list).length >= 6).map(([code]) => code)
    );
    state.competitions[id] = series;
  }
  return series;
}

function ensureSeasonCompetition(world) {
  const state = world.international;
  const isWorldYear = Number(world.season) % 4 === 2;
  const isEuropeYear = Number(world.season) % 4 === 0;
  const worldId = `intl_world_${world.season}`;
  const europeId = `intl_europe_${world.season}`;

  // 未开赛的旧档小规模赛事可就地升级到新规模（已有赛果的不动）
  const upgradeUnused = (id, minTeams) => {
    const existing = state.competitions[id];
    if (
      existing &&
      !existing.completed &&
      (existing.fixtureIds?.length || 0) === 0 &&
      (existing.participants?.length || 0) < minTeams
    ) {
      delete state.competitions[id];
      if (state.activeCompetitionId === id) state.activeCompetitionId = null;
    }
  };
  if (isWorldYear) upgradeUnused(worldId, 32);
  else if (isEuropeYear) upgradeUnused(europeId, 16);

  const current = Object.values(state.competitions).find(
    (competition) => competition.season === world.season && !competition.completed
  );
  if (current) {
    state.activeCompetitionId = current.id;
    return current;
  }

  const entries = [...playersByNation(world).entries()];
  let competition = null;
  // 世界杯 32 队 / 8 组；欧洲杯 16 队 / 4 组
  if (isWorldYear) {
    if (!state.competitions[worldId]?.completed) {
      const participants = selectParticipants(world, entries, 32, () => true, ["ENG", "ESP", "ITA", "GER", "FRA"]);
      if (participants.length >= 32) competition = createTournament(world, "world", participants, 8);
      else if (participants.length >= 16) competition = createTournament(world, "world", participants.slice(0, 16), 4);
    }
  } else if (isEuropeYear) {
    if (!state.competitions[europeId]?.completed) {
      const participants = selectParticipants(world, entries, 16, (code) => EUROPEAN_CODES.has(code), ["ENG", "ESP", "ITA", "GER", "FRA"]);
      if (participants.length >= 16) competition = createTournament(world, "europe", participants, 4);
      else if (participants.length >= 8) competition = createTournament(world, "europe", participants.slice(0, 8), 2);
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
    const copy = COMPETITION_COPY[competition.key];
    if (copy) {
      competition.name = copy.name;
      competition.nameEn = copy.nameEn;
    }
  }
  for (const match of state.matches) {
    const copy = COMPETITION_COPY[match.competitionKey];
    if (copy) {
      match.competitionName = copy.name;
      match.competitionNameEn = copy.nameEn;
    }
  }
  for (const item of state.history) {
    const copy = COMPETITION_COPY[item.key];
    if (copy) {
      item.name = copy.name;
      item.nameEn = copy.nameEn;
    }
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
  if (label === "十六强") return "Round of 16";
  if (label === "四分之一决赛") return "Quarter-finals";
  if (label === "半决赛") return "Semi-finals";
  if (label === "决赛") return "Final";
  if (label === "国际比赛日") return "International matchday";
  return label;
}

function knockoutRoundLabel(stage) {
  if (stage === "R16") return "十六强";
  if (stage === "QF") return "四分之一决赛";
  if (stage === "SF") return "半决赛";
  return "决赛";
}

/** 按晋级队数决定淘汰赛起点：16→十六强，8→四分之一，4→半决赛。 */
function initialKnockoutStage(pairCount) {
  if (pairCount >= 8) return "R16";
  if (pairCount >= 4) return "QF";
  return "SF";
}

function nextKnockoutStage(winnerCount) {
  if (winnerCount <= 2) return "F";
  if (winnerCount <= 4) return "SF";
  if (winnerCount <= 8) return "QF";
  return "R16";
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

/**
 * 征召的俱乐部代价：整场出战的球员消耗体能并承担一次伤病判定。
 *
 * ⚠ 体能消耗口径是**逐人 4–9 点的掷骰**。俱乐部赛的终场那笔已在 v278 改成
 * 「按本场跑动距离占比分摊球队总量」（见 `match.js` 的 `drainFitness`），
 * 所以这里与它**只同量级、不同分配方式**；征召没有跑动距离数据，维持掷骰。
 * 另加长途奔波的固定项；下限与俱乐部比赛一致取 35。伤病沿用 `injuries.js` 既有的诊断与
 * 复发风险，不新增伤病类型，也不写入任何能力或胜率修正。
 *
 * @returns {Array<{player: Object, injury: Object}>} 本场因征召受伤的球员
 */
function applyCallupCost(world, xi) {
  const injuries = [];
  for (const p of xi) {
    const drain = 4 + Math.floor(rng() * 6) + INTL_TRAVEL_DRAIN;
    p.fitness = Math.round(Math.max(35, (p.fitness ?? 100) - drain));

    const risk = CALLUP_INJURY_BASE * (p.fitness < 55 ? 1.6 : 1) * injuryRiskMultiplier(p);
    if (!chance(risk)) continue;
    const injury = diagnoseInjury(p, {
      cause: p.fitness < 62 ? "fatigue" : "contact",
      day: world.day,
      season: world.season,
      random: rng,
    });
    // 与俱乐部比赛伤退一致：带伤离场的球员体能封顶 45
    p.fitness = Math.round(Math.min(p.fitness, 45));
    injuries.push({ player: p, injury });
  }
  return injuries;
}

function simIntlMatch(world, xiA, xiB) {
  const sa = xiStrength(xiA) || 10;
  const sb = xiStrength(xiB) || 10;
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
  // 出场的代价与荣誉同时结算：先记出场数与士气，再扣体能并判伤。
  const injuries = [...applyCallupCost(world, xiA), ...applyCallupCost(world, xiB)];
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
  return { ga, gb, scorersA, scorersB, assistsA, assistsB, xiA, xiB, injuries };
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
  const xiA = pickXi(world, codeA, entries.get(codeA) || []);
  const xiB = pickXi(world, codeB, entries.get(codeB) || []);
  const result = simIntlMatch(world, xiA, xiB);
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
    // 征召代价与比赛结果存在同一条记录里，战报、信箱和审计读同一份事实。
    callupInjuries: result.injuries.map(({ player, injury }) => ({
      playerId: player.id,
      playerName: player.name,
      nationality: player.nationality || null,
      label: injury.label,
      labelEn: injury.labelEn,
      days: injury.totalDays,
    })),
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
  // 交叉对阵：A1-B2、B1-A2… 避免同组提前相遇
  const pairs = [];
  for (let i = 0; i < qualifiers.length; i += 4) {
    pairs.push([qualifiers[i], qualifiers[i + 3]], [qualifiers[i + 2], qualifiers[i + 1]]);
  }
  const validPairs = pairs.filter((p) => p[0] && p[1]);
  competition.stage = "knockout";
  competition.knockout = { stage: initialKnockoutStage(validPairs.length), pairs: validPairs };
}

function knockoutRound(world, competition) {
  const knockout = competition.knockout;
  if (!knockout?.pairs?.length) return;
  const winners = [];
  for (const [home, away] of knockout.pairs) {
    const match = recordMatch(world, competition, home, away, knockoutRoundLabel(knockout.stage), true);
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
  const pairs = [];
  for (let i = 0; i < winners.length; i += 2) {
    if (winners[i] && winners[i + 1]) pairs.push([winners[i], winners[i + 1]]);
  }
  competition.knockout = { stage: nextKnockoutStage(winners.length), pairs };
}

function seriesRound(world, competition, entries) {
  const codes = shuffle(
    entries.filter(([code, list]) => pickXi(world, code, list).length >= 6).map(([code]) => code)
  );
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
      const hurt = (match.callupInjuries || []).find((item) => item.playerId === id) || null;
      callups.push({
        player,
        nation: isHome ? match.home : match.away,
        goals,
        assists,
        opponent: isHome ? match.away : match.home,
        score,
        fitness: Math.round(Number(player.fitness ?? 100)),
        injury: hurt,
      });
      const detail = [`出场`, goals ? `${goals}球` : "", assists ? `${assists}助` : ""].filter(Boolean).join(" · ");
      world.news.unshift({
        day: world.day,
        text: `🌍 ${competition.name}：${player.name}（${nationFlag(player.nationality)}${nationName(player.nationality)}）对阵 ${nationName(isHome ? match.away : match.home)} ${score}，${detail}，回队体能 ${Math.round(Number(player.fitness ?? 100))}`,
      });
      if (hurt) {
        world.news.unshift({
          day: world.day,
          text: `🏥 ${player.name} 在国家队比赛中${hurt.label}，预计缺席约 ${hurt.days} 天`,
        });
      }
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
  const nations = [...byNation.entries()].filter(([code, list]) => pickXi(world, code, list).length >= 6);
  world.lastIntlDay = world.day;
  if (nations.length < 2) return { matches: 0, callups: [], injuries: [] };

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
  const injuries = matches.flatMap((match) => match.callupInjuries || []);
  return { matches: matches.length, callups, injuries };
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
