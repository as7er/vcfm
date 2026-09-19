/** 七国国内杯与三项欧洲俱乐部赛事。所有后台比赛继续使用轻量概率引擎。 */

import { uid } from "./models.js";
import {
  COUNTRIES,
  COUNTRY_LIST,
  DIVISIONS,
  CONTINENTAL_COMPETITIONS,
} from "./data.js";
import {
  ensureCompetitionParticipationFinance,
  settleCompetitionFixtureFinance,
  settleContinentalLeagueQualification,
} from "./competition-finance.js";

function rng() {
  return Math.random();
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function countryOfClub(club) {
  return club?.countryId || DIVISIONS[club?.division || 3]?.countryId || "crownland";
}

function emptyRow() {
  return { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
}

function fixtureBase(tournament, extra) {
  return {
    id: uid("tfx"),
    competition: tournament.type === "domestic" ? "cup" : "continental",
    competitionId: tournament.id,
    competitionName: tournament.name,
    competitionType:
      tournament.type === "domestic" ? "domestic-cup" : "continental-league-stage",
    homeGoals: null,
    awayGoals: null,
    played: false,
    events: [],
    ...extra,
  };
}

function roundKey(size) {
  if (size === 8) return "QF";
  if (size === 4) return "SF";
  if (size === 2) return "F";
  return `R${size}`;
}

function roundText(name, stage) {
  if (stage === "QF") return `${name}四分之一决赛`;
  if (stage === "SF") return `${name}半决赛`;
  if (stage === "F") return `${name}决赛`;
  const n = Number(String(stage).replace("R", ""));
  return Number.isFinite(n) && n > 0 ? `${name}${n}强` : `${name}淘汰赛`;
}

export function createDomesticCup(world, countryId) {
  const country = COUNTRIES[countryId] || COUNTRIES.crownland;
  const clubIds = shuffle(
    world.clubs.filter((c) => countryOfClub(c) === countryId).map((c) => c.id)
  );
  const size = 2 ** Math.ceil(Math.log2(Math.max(2, clubIds.length)));
  const byeCount = Math.max(0, size - clubIds.length);
  const byes = clubIds.slice(0, byeCount);
  const play = clubIds.slice(byeCount);
  const stage = roundKey(play.length);
  const openingDay = world.day > 1 ? world.day + 6 : 7;
  const tournament = {
    id: `domestic_${countryId}`,
    type: "domestic",
    countryId,
    name: country.cupName,
    nameEn: country.cupNameEn,
    season: world.season,
    stage,
    byes,
    fixtures: [],
    bracket: {},
    pendingWinners: [...byes],
    champion: null,
  };

  for (let i = 0; i < play.length; i += 2) {
    if (!play[i + 1]) break;
    tournament.fixtures.push(
      fixtureBase(tournament, {
        round: stage,
        roundLabel:
          byeCount > 0 && stage !== "R32" ? `${tournament.name}第一轮` : roundText(tournament.name, stage),
        day: openingDay,
        home: play[i],
        away: play[i + 1],
      })
    );
  }
  tournament.bracket[stage] = tournament.fixtures.map((f) => f.id);
  if (clubIds.length < 2) {
    tournament.stage = "done";
    tournament.champion = clubIds[0] || null;
  }
  return tournament;
}

function migrateLegacyCup(world) {
  if (!world.cup || world.cup.season !== world.season) return;
  const user = world.clubs.find((c) => c.id === world.userClubId);
  const countryId = countryOfClub(user);
  if (!world.domesticCups[countryId]) {
    const cup = world.cup;
    cup.id = `domestic_${countryId}`;
    cup.type = "domestic";
    cup.countryId = countryId;
    cup.name = COUNTRIES[countryId]?.cupName || cup.name || "国内杯";
    cup.nameEn = COUNTRIES[countryId]?.cupNameEn || "Domestic Cup";
    for (const f of cup.fixtures || []) {
      f.competition = "cup";
      f.competitionId = cup.id;
      f.competitionName = cup.name;
      f.competitionType = "domestic-cup";
    }
    world.domesticCups[countryId] = cup;
  }
  world.cup = null;
}

function refreshDomesticCupBranding(tournament, country) {
  if (!tournament || !country) return;
  const previousName = tournament.name;
  tournament.name = country.cupName;
  tournament.nameEn = country.cupNameEn;
  for (const fixture of tournament.fixtures || []) {
    fixture.competitionName = tournament.name;
    if (previousName && fixture.roundLabel?.includes(previousName)) {
      fixture.roundLabel = fixture.roundLabel.replace(previousName, tournament.name);
    }
  }
}

function topDivisionForCountry(countryId) {
  return Object.values(DIVISIONS).find(
    (d) => d.countryId === countryId && d.tier === 1
  )?.id;
}

function rankedTopClubs(world, countryId) {
  const division = topDivisionForCountry(countryId);
  const clubs = world.clubs.filter((c) => c.division === division);
  const hasPlayed = clubs.some((c) => (world.table?.[c.id]?.played || 0) > 0);
  return clubs.sort((a, b) => {
    if (!hasPlayed) return (b.power || 0) - (a.power || 0) || a.id.localeCompare(b.id);
    const ta = world.table?.[a.id] || emptyRow();
    const tb = world.table?.[b.id] || emptyRow();
    return (
      tb.pts - ta.pts ||
      tb.gf - tb.ga - (ta.gf - ta.ga) ||
      tb.gf - ta.gf ||
      (b.power || 0) - (a.power || 0)
    );
  });
}

/** 当前排名快照生成下赛季欧洲赛事席位：各国每赛事 4 席。 */
export function buildContinentalQualifiers(world) {
  const result = {};
  for (const config of Object.values(CONTINENTAL_COMPETITIONS)) result[config.id] = [];
  // 只为实际有球队的国家分配席位，与 validQualifierSet 的口径保持一致
  const presentCountries = new Set((world.clubs || []).map(countryOfClub));
  for (const country of COUNTRY_LIST) {
    if (!presentCountries.has(country.id)) continue;
    const ranked = rankedTopClubs(world, country.id);
    for (const config of Object.values(CONTINENTAL_COMPETITIONS)) {
      result[config.id].push(
        ...ranked.slice(config.rankStart - 1, config.rankEnd).map((c) => c.id)
      );
    }
  }
  return result;
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildLeaguePhaseRounds(participants, clubMap, roundCount = 8) {
  const findRound = (usedPairs) => {
    const search = (remaining, pairs) => {
      if (!remaining.length) return pairs;
      let selectedIndex = 0;
      let candidates = null;
      for (let i = 0; i < remaining.length; i++) {
        const home = remaining[i];
        const options = remaining.filter(
          (away, j) =>
            i !== j &&
            countryOfClub(clubMap.get(home)) !== countryOfClub(clubMap.get(away)) &&
            !usedPairs.has(pairKey(home, away))
        );
        if (candidates == null || options.length < candidates.length) {
          selectedIndex = i;
          candidates = options;
        }
      }
      if (!candidates?.length) return null;
      const home = remaining[selectedIndex];
      const withoutHome = remaining.filter((_, index) => index !== selectedIndex);
      for (const away of shuffle(candidates)) {
        const result = search(
          withoutHome.filter((id) => id !== away),
          [...pairs, [home, away]]
        );
        if (result) return result;
      }
      return null;
    };
    return search(shuffle([...participants]), []);
  };

  for (let attempt = 0; attempt < 20; attempt++) {
    const usedPairs = new Set();
    const rounds = [];
    for (let round = 0; round < roundCount; round++) {
      const pairs = findRound(usedPairs);
      if (!pairs) break;
      rounds.push(pairs);
      for (const [home, away] of pairs) usedPairs.add(pairKey(home, away));
    }
    if (rounds.length === roundCount) return rounds;
  }
  throw new Error("unable to create continental league-phase schedule");
}

function orientLeaguePhaseRounds(rounds) {
  const edges = rounds.flatMap((pairs, roundIndex) =>
    pairs.map(([a, b], pairIndex) => ({ a, b, roundIndex, pairIndex }))
  );
  const adjacency = new Map();
  edges.forEach((edge, index) => {
    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push(index);
    adjacency.get(edge.b).push(index);
  });

  const used = new Set();
  const oriented = new Map();
  for (const start of adjacency.keys()) {
    if ((adjacency.get(start) || []).every((index) => used.has(index))) continue;
    const stack = [start];
    const circuit = [];
    while (stack.length) {
      const current = stack[stack.length - 1];
      const edgeIndex = (adjacency.get(current) || []).find((index) => !used.has(index));
      if (edgeIndex == null) {
        circuit.push(stack.pop());
        continue;
      }
      used.add(edgeIndex);
      const edge = edges[edgeIndex];
      stack.push(edge.a === current ? edge.b : edge.a);
    }
    circuit.reverse();
    for (let i = 0; i < circuit.length - 1; i++) {
      const home = circuit[i];
      const away = circuit[i + 1];
      const edgeIndex = (adjacency.get(home) || []).find((index) => {
        const edge = edges[index];
        return !oriented.has(index) && (edge.a === away || edge.b === away);
      });
      if (edgeIndex != null) oriented.set(edgeIndex, [home, away]);
    }
  }

  return rounds.map((pairs, roundIndex) =>
    pairs.map((_, pairIndex) => {
      const edgeIndex = edges.findIndex(
        (edge) => edge.roundIndex === roundIndex && edge.pairIndex === pairIndex
      );
      return oriented.get(edgeIndex) || [edges[edgeIndex].a, edges[edgeIndex].b];
    })
  );
}

export function createContinentalCompetition(world, config, participants) {
  const openingDay = world.day > 1 ? world.day + 5 : 6;
  const tournament = {
    id: `continental_${config.id}`,
    key: config.id,
    type: "continental",
    name: config.name,
    nameEn: config.nameEn,
    season: world.season,
    stage: "league",
    participants: [...participants],
    fixtures: [],
    table: {},
    champion: null,
  };
  for (const id of participants) tournament.table[id] = emptyRow();

  const clubMap = new Map(world.clubs.map((c) => [c.id, c]));
  const leagueRounds = orientLeaguePhaseRounds(
    buildLeaguePhaseRounds(participants, clubMap)
  );
  leagueRounds.forEach((pairs, roundIndex) => {
    pairs.forEach(([home, away]) => {
      tournament.fixtures.push(
        fixtureBase(tournament, {
          round: roundIndex + 1,
          roundLabel: `${tournament.name}联赛阶段 第${roundIndex + 1}比赛日`,
          day: openingDay + roundIndex * 21,
          home,
          away,
        })
      );
    });
  });
  return tournament;
}

function refreshContinentalBranding(tournament, config) {
  if (!tournament || !config) return;
  const previousName = tournament.name;
  tournament.name = config.name;
  tournament.nameEn = config.nameEn;
  for (const fixture of tournament.fixtures || []) {
    fixture.competitionName = tournament.name;
    if (previousName && fixture.roundLabel?.includes(previousName)) {
      fixture.roundLabel = fixture.roundLabel.replace(previousName, tournament.name);
    }
  }
}

function validQualifierSet(world, qualifiers) {
  const ids = new Set(world.clubs.map((c) => c.id));
  // 席位数 = 有球队参赛的国家数 × 每赛事 4 席；不写死队数，加国家自动扩容
  const presentCountries = new Set((world.clubs || []).map(countryOfClub));
  const expected = COUNTRY_LIST.filter((country) => presentCountries.has(country.id)).length * 4;
  return Object.values(CONTINENTAL_COMPETITIONS).every((config) => {
    const list = qualifiers?.[config.id];
    return Array.isArray(list) && list.length === expected && list.every((id) => ids.has(id));
  });
}

export function ensureCompetitions(world) {
  if (!world.domesticCups || typeof world.domesticCups !== "object") world.domesticCups = {};
  if (!world.continentals || typeof world.continentals !== "object") world.continentals = {};
  migrateLegacyCup(world);

  const presentCountries = new Set((world.clubs || []).map(countryOfClub));
  for (const country of COUNTRY_LIST) {
    if (!presentCountries.has(country.id)) continue;
    const current = world.domesticCups[country.id];
    if (!current || current.season !== world.season) {
      world.domesticCups[country.id] = createDomesticCup(world, country.id);
    } else {
      refreshDomesticCupBranding(current, country);
    }
  }

  let qualifiers = world.continentalQualifiers;
  if (!validQualifierSet(world, qualifiers)) qualifiers = buildContinentalQualifiers(world);
  if (validQualifierSet(world, qualifiers)) {
    world.continentalQualifiers = qualifiers;
    for (const config of Object.values(CONTINENTAL_COMPETITIONS)) {
      const current = world.continentals[config.id];
      if (!current || current.season !== world.season) {
        world.continentals[config.id] = createContinentalCompetition(
          world,
          config,
          qualifiers[config.id]
        );
      } else {
        refreshContinentalBranding(current, config);
      }
      ensureCompetitionParticipationFinance(world, world.continentals[config.id]);
    }
  }
  world.cup = null;
  return world;
}

export function resetCompetitions(world, qualifiers = null) {
  world.domesticCups = {};
  world.continentals = {};
  world.continentalQualifiers = qualifiers;
  world.cup = null;
  return ensureCompetitions(world);
}

export function allCompetitionFixtures(world) {
  const domestic = Object.values(world.domesticCups || {}).flatMap((c) => c.fixtures || []);
  const continental = Object.values(world.continentals || {}).flatMap((c) => c.fixtures || []);
  return [...domestic, ...continental];
}

export function competitionFixturesOnDay(world, day) {
  return allCompetitionFixtures(world).filter((f) => !f.played && f.day === day);
}

export function getNextUserCompetitionMatch(world) {
  return (
    allCompetitionFixtures(world)
      .filter(
        (f) =>
          !f.played && (f.home === world.userClubId || f.away === world.userClubId)
      )
      .sort((a, b) => a.day - b.day || String(a.competitionId).localeCompare(String(b.competitionId)))[0] ||
    null
  );
}

export function allUserCompetitionFixtures(world) {
  return allCompetitionFixtures(world).filter(
    (f) => f.home === world.userClubId || f.away === world.userClubId
  );
}

export function findCompetition(world, fixtureOrId) {
  const id = typeof fixtureOrId === "string" ? fixtureOrId : fixtureOrId?.competitionId;
  if (!id) return null;
  return (
    Object.values(world.domesticCups || {}).find((c) => c.id === id) ||
    Object.values(world.continentals || {}).find((c) => c.id === id) ||
    null
  );
}

export function sortedContinentalTable(tournament) {
  if (!tournament?.table) return [];
  return Object.entries(tournament.table)
    .map(([id, row]) => ({ id, ...row, gd: (row.gf || 0) - (row.ga || 0) }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.id.localeCompare(b.id));
}

export function continentalPlayerLeaders(world, competitionId, limit = 15) {
  const tournament = findCompetition(world, competitionId);
  if (!tournament || tournament.type !== "continental") {
    return { goals: [], assists: [], ratings: [], keepers: [] };
  }
  const clubsById = new Map((world.clubs || []).map((club) => [club.id, club]));
  const entries = [];
  for (const currentClub of world.clubs || []) {
    for (const player of currentClub.players || []) {
      const stats = player.competitionStats?.[competitionId];
      if (!stats || !(stats.apps || stats.goals || stats.assists || stats.ratingSum)) continue;
      const club = clubsById.get(stats.clubId) || currentClub;
      const avgRating = stats.apps > 0 && stats.ratingSum > 0
        ? Math.round((stats.ratingSum / stats.apps) * 10) / 10
        : null;
      entries.push({ player, club, stats, avgRating });
    }
  }
  const goals = entries
    .filter((entry) => entry.stats.goals > 0)
    .sort(
      (a, b) =>
        b.stats.goals - a.stats.goals ||
        b.stats.assists - a.stats.assists ||
        (b.avgRating || 0) - (a.avgRating || 0)
    )
    .slice(0, limit);
  const assists = entries
    .filter((entry) => entry.stats.assists > 0)
    .sort(
      (a, b) =>
        b.stats.assists - a.stats.assists ||
        b.stats.goals - a.stats.goals ||
        (b.avgRating || 0) - (a.avgRating || 0)
    )
    .slice(0, limit);
  // 赛事（洲际）场均评分：至少 4 场。
  //
  // ⚠ 门槛比联赛榜低（联赛取 10），因为洲际赛事单队总场次远少于 34 轮联赛 ——
  //   用同一把尺子会把榜清空。取值同样有量化依据：见 `engine.js` 评分榜处的注释，
  //   核心结论是「评分由进球驱动 ⇒ 出场少的场均方差大 ⇒ 低门槛必然被替补占榜」。
  //   4 场是在「不误伤」与「挡住 ≤2 场的刷分」之间按赛事规模折中的结果。
  const ratings = entries
    .filter((entry) => entry.stats.apps >= 4 && entry.avgRating != null)
    .sort(
      (a, b) =>
        b.avgRating - a.avgRating ||
        b.stats.apps - a.stats.apps ||
        b.stats.goals + b.stats.assists - (a.stats.goals + a.stats.assists)
    )
    .slice(0, limit);
  const keepers = entries
    .filter((entry) => entry.player.pos === "GK" && entry.stats.apps > 0)
    .map((entry) => ({
      ...entry,
      gaPerGame: entry.stats.goalsConceded / entry.stats.apps,
    }))
    .sort(
      (a, b) =>
        b.stats.cleanSheets - a.stats.cleanSheets ||
        a.gaPerGame - b.gaPerGame ||
        b.stats.apps - a.stats.apps
    )
    .slice(0, limit);
  return { goals, assists, ratings, keepers };
}

export function applyContinentalResult(world, fixture) {
  if (fixture.competitionType !== "continental-league-stage" || fixture._continentalApplied) return;
  const tournament = findCompetition(world, fixture);
  if (!tournament) return;
  const h = tournament.table[fixture.home] || (tournament.table[fixture.home] = emptyRow());
  const a = tournament.table[fixture.away] || (tournament.table[fixture.away] = emptyRow());
  h.played++;
  a.played++;
  h.gf += fixture.homeGoals;
  h.ga += fixture.awayGoals;
  a.gf += fixture.awayGoals;
  a.ga += fixture.homeGoals;
  if (fixture.homeGoals > fixture.awayGoals) {
    h.w++;
    a.l++;
    h.pts += 3;
  } else if (fixture.homeGoals < fixture.awayGoals) {
    a.w++;
    h.l++;
    a.pts += 3;
  } else {
    h.d++;
    a.d++;
    h.pts++;
    a.pts++;
  }
  fixture._continentalApplied = true;
}

function addKnockoutRound(tournament, entrants, stage, day) {
  const fixtures = [];
  for (let i = 0; i < entrants.length; i += 2) {
    if (!entrants[i + 1]) break;
    fixtures.push(
      fixtureBase(tournament, {
        competitionType: "continental-knockout",
        round: stage,
        roundLabel: roundText(tournament.name, stage),
        day,
        home: entrants[i],
        away: entrants[i + 1],
      })
    );
  }
  tournament.fixtures.push(...fixtures);
  tournament.stage = stage;
  return fixtures;
}

function completeTournament(world, tournament, championId) {
  tournament.stage = "done";
  tournament.champion = championId || null;
  const champion = world.clubs.find((c) => c.id === championId);
  if (champion) {
    world.news.unshift({
      day: world.day,
      text: `🏆 ${tournament.name}冠军：${champion.name}！`,
    });
  }
}

function advanceDomesticCup(world, cup) {
  if (!cup || cup.stage === "done") return;
  const stageFixtures = (cup.fixtures || []).filter((f) => f.round === cup.stage);
  if (!stageFixtures.length || !stageFixtures.every((f) => f.played)) return;
  const winners = cup.stage.startsWith("R") ? [...(cup.pendingWinners || [])] : [];
  for (const f of stageFixtures) winners.push(f.winner || (f.homeGoals > f.awayGoals ? f.home : f.away));
  cup.pendingWinners = [];
  if (winners.length === 1) {
    completeTournament(world, cup, winners[0]);
    return;
  }
  const stage = roundKey(winners.length);
  shuffle(winners);
  const day = Math.max(...cup.fixtures.map((f) => f.day), world.day) + 18;
  const next = [];
  for (let i = 0; i < winners.length; i += 2) {
    next.push(
      fixtureBase(cup, {
        round: stage,
        roundLabel: roundText(cup.name, stage),
        day,
        home: winners[i],
        away: winners[i + 1],
      })
    );
  }
  cup.fixtures.push(...next);
  cup.bracket[stage] = next.map((f) => f.id);
  cup.stage = stage;
}

function advanceContinental(world, tournament) {
  if (!tournament || tournament.stage === "done") return;
  if (tournament.stage === "league") {
    const stageFixtures = tournament.fixtures.filter(
      (f) => f.competitionType === "continental-league-stage"
    );
    if (!stageFixtures.length || !stageFixtures.every((f) => f.played)) return;
    const seeded = sortedContinentalTable(tournament).slice(0, 8).map((r) => r.id);
    settleContinentalLeagueQualification(world, tournament, seeded);
    const entrants = [seeded[0], seeded[7], seeded[3], seeded[4], seeded[1], seeded[6], seeded[2], seeded[5]];
    addKnockoutRound(
      tournament,
      entrants,
      "QF",
      Math.max(...stageFixtures.map((f) => f.day), world.day) + 21
    );
    world.news.unshift({ day: world.day, text: `🌐 ${tournament.name}八强对阵已出炉。` });
    return;
  }

  const stageFixtures = tournament.fixtures.filter((f) => f.round === tournament.stage);
  if (!stageFixtures.length || !stageFixtures.every((f) => f.played)) return;
  const winners = stageFixtures.map(
    (f) => f.winner || (f.homeGoals > f.awayGoals ? f.home : f.away)
  );
  if (winners.length === 1) {
    completeTournament(world, tournament, winners[0]);
    return;
  }
  const stage = roundKey(winners.length);
  addKnockoutRound(
    tournament,
    winners,
    stage,
    Math.max(...stageFixtures.map((f) => f.day), world.day) + 21
  );
}

export function advanceCompetition(world, fixture) {
  const tournament = findCompetition(world, fixture);
  if (!tournament) return;
  settleCompetitionFixtureFinance(world, tournament, fixture);
  if (tournament.type === "domestic") advanceDomesticCup(world, tournament);
  else advanceContinental(world, tournament);
}

export function competitionsComplete(world) {
  const all = [
    ...Object.values(world.domesticCups || {}),
    ...Object.values(world.continentals || {}),
  ];
  return all.length > 0 && all.every((t) => t.stage === "done");
}

export function getUserDomesticCup(world) {
  const user = world.clubs.find((c) => c.id === world.userClubId);
  return world.domesticCups?.[countryOfClub(user)] || null;
}

// 旧 API 名称保留，避免历史模块或存档迁移路径失效。
export const ensureCup = ensureCompetitions;
export const cupFixturesOnDay = competitionFixturesOnDay;
export const getNextUserCupMatch = getNextUserCompetitionMatch;
export const allCupUserFixtures = allUserCompetitionFixtures;
export const advanceCupBracket = advanceCompetition;
export function createLeagueCup(world) {
  const user = world.clubs.find((c) => c.id === world.userClubId);
  return createDomesticCup(world, countryOfClub(user));
}

export const STAGE_LABEL = {};
export const STAGE_ORDER = ["league", "QF", "SF", "F", "done"];
