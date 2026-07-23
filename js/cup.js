/** 五国国内杯与三项大陆赛事。所有后台比赛继续使用轻量概率引擎。 */

import { uid } from "./models.js";
import {
  COUNTRIES,
  COUNTRY_LIST,
  DIVISIONS,
  CONTINENTAL_COMPETITIONS,
} from "./data.js";

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

/** 当前排名快照生成下赛季大陆赛事席位：五国各 4 席。 */
export function buildContinentalQualifiers(world) {
  const result = {};
  for (const config of Object.values(CONTINENTAL_COMPETITIONS)) result[config.id] = [];
  for (const country of COUNTRY_LIST) {
    const ranked = rankedTopClubs(world, country.id);
    for (const config of Object.values(CONTINENTAL_COMPETITIONS)) {
      result[config.id].push(
        ...ranked.slice(config.rankStart - 1, config.rankEnd).map((c) => c.id)
      );
    }
  }
  return result;
}

function countryRoundPairs() {
  const ids = COUNTRY_LIST.map((c) => c.id);
  if (ids.length % 2) ids.push(null);
  const rounds = [];
  const arr = [...ids];
  for (let r = 0; r < arr.length - 1; r++) {
    const pairs = [];
    for (let i = 0; i < arr.length / 2; i++) {
      const a = arr[i];
      const b = arr[arr.length - 1 - i];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return rounds;
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
  const byCountry = {};
  for (const id of participants) {
    const countryId = countryOfClub(clubMap.get(id));
    if (!byCountry[countryId]) byCountry[countryId] = [];
    byCountry[countryId].push(id);
  }

  countryRoundPairs().forEach((pairs, roundIndex) => {
    pairs.forEach(([homeCountry, awayCountry], pairIndex) => {
      const homes = byCountry[homeCountry] || [];
      const aways = byCountry[awayCountry] || [];
      for (let i = 0; i < Math.min(homes.length, aways.length); i++) {
        const away = aways[(i + roundIndex + pairIndex) % aways.length];
        const swap = (i + roundIndex) % 2 === 1;
        tournament.fixtures.push(
          fixtureBase(tournament, {
            round: roundIndex + 1,
            roundLabel: `${tournament.name}联赛阶段 第${roundIndex + 1}比赛日`,
            day: openingDay + roundIndex * 21,
            home: swap ? away : homes[i],
            away: swap ? homes[i] : away,
          })
        );
      }
    });
  });
  return tournament;
}

function validQualifierSet(world, qualifiers) {
  const ids = new Set(world.clubs.map((c) => c.id));
  return Object.values(CONTINENTAL_COMPETITIONS).every((config) => {
    const list = qualifiers?.[config.id];
    return Array.isArray(list) && list.length === 20 && list.every((id) => ids.has(id));
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
      }
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
