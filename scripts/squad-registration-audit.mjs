import assert from "node:assert/strict";

import { autoLineup, createWorld, ensureMatchLineup, resetIdCounter } from "../js/models.js";
import { CLUB_TEMPLATES } from "../js/data.js";
import { createMatchSession, getBenchPlayers } from "../js/match.js";
import {
  autoRegisterClub,
  developmentStatus,
  eligiblePlayerIds,
  ensurePlayerDevelopment,
  playerCompetitionEligibility,
  recordDevelopmentSeason,
  registrationSummary,
  setPlayerRegistered,
} from "../js/squad-registration.js";

function player(id, pos = "MID", ovr = 12, age = 25, nationality = "ENG") {
  const attrs = {
    reflexes: ovr,
    handling: ovr,
    positioning: ovr,
    kicking: ovr,
    tackling: ovr,
    marking: ovr,
    strength: ovr,
    pace: ovr,
    passing: ovr,
    vision: ovr,
    stamina: ovr,
    shooting: ovr,
    dribbling: ovr,
    finishing: ovr,
  };
  return {
    id,
    name: `Player ${id}`,
    pos,
    age,
    nationality,
    attrs,
    ovr,
    potential: Math.min(20, ovr + 1),
    value: 1_000_000,
    wage: 10_000,
    contractYears: 3,
    fitness: 100,
    morale: 70,
    injured: 0,
    suspendedMatches: 0,
    stats: {},
    history: [],
  };
}

function setDevelopment(candidate, club, countryId, { clubYears = 0, associationYears = 0, consecutive = clubYears } = {}) {
  candidate.development = {
    version: 1,
    clubYears: clubYears ? { [club.id]: clubYears } : {},
    associationYears: associationYears ? { [countryId]: associationYears } : {},
    recordedSeasons: [],
    recentClubId: clubYears ? club.id : null,
    consecutiveClubYears: consecutive,
    seeded: true,
  };
  return candidate;
}

function club(id, countryId = "crownland", countryCode = "ENG") {
  return {
    id,
    name: `Club ${id}`,
    short: id,
    division: 1,
    countryId,
    countryCode,
    power: 70,
    money: 20_000_000,
    players: [],
    youth: { level: 1, players: [] },
    facilities: { stadium: 1, training: 1, youth: 1, projects: [] },
    staff: {},
    finance: {},
    tactics: { formation: "4-3-3", lineup: [], roles: [] },
  };
}

function buildWorld() {
  const home = club("home");
  const away = club("away", "iberia", "ESP");
  const positions = ["GK", "GK", "DEF", "DEF", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "MID", "MID", "MID", "ATT", "ATT", "ATT", "ATT", "ATT", "MID", "DEF", "ATT", "MID", "DEF", "ATT", "MID", "DEF", "ATT"];
  home.players = positions.map((pos, index) => {
    const candidate = player(`h${index}`, pos, 20 - (index % 9), index === 27 ? 20 : 25, index < 10 ? "ENG" : "BRA");
    candidate.clubId = home.id;
    if (index < 5) return setDevelopment(candidate, home, home.countryId, { clubYears: 3, associationYears: 3 });
    if (index < 10) return setDevelopment(candidate, home, home.countryId, { associationYears: 3 });
    return setDevelopment(candidate, home, home.countryId);
  });
  away.players = positions.slice(0, 20).map((pos, index) => {
    const candidate = player(`a${index}`, pos, 13 + (index % 4), 25, index < 10 ? "ESP" : "ARG");
    candidate.clubId = away.id;
    return setDevelopment(candidate, away, away.countryId, index < 5
      ? { clubYears: 3, associationYears: 3 }
      : index < 10
        ? { associationYears: 3 }
        : {});
  });
  autoLineup(home);
  autoLineup(away);
  return {
    world: {
      season: 2026,
      day: 1,
      userClubId: home.id,
      clubs: [home, away],
      table: {
        [home.id]: { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
        [away.id]: { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
      },
      news: [],
      media: [],
      loans: [],
      continentals: {
        continental_champions: {
          id: "continental_champions",
          type: "continental",
          name: "Champions Cup",
          participants: [home.id, away.id],
          fixtures: [],
        },
      },
    },
    home,
    away,
  };
}

const leagueFixture = { id: "league", home: "home", away: "away", competition: "league", competitionType: "league", day: 3 };
const continentalFixture = {
  id: "continental",
  home: "home",
  away: "away",
  competition: "continental",
  competitionType: "continental-league-stage",
  competitionId: "continental_champions",
  competitionName: "Champions Cup",
  day: 6,
};

// League list respects 25 players, a 17-player non-homegrown ceiling, and U21 exemption.
{
  const { world, home } = buildWorld();
  const result = autoRegisterClub(world, home, { key: "league", type: "league", competitionId: 1 });
  assert.equal(result.ok, true);
  const summary = registrationSummary(world, home, leagueFixture);
  assert.equal(summary.valid, true);
  assert.ok(summary.registered <= 25);
  assert.ok(summary.nonAssociation <= 17);
  const u21 = home.players.find((candidate) => candidate.age === 20);
  const eligibility = playerCompetitionEligibility(world, home, leagueFixture, u21);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.route, "u21");
  assert.equal((summary.entry.playerIds || []).includes(u21.id), false, "U21 must not consume an A-list place");
}

// Continental A-list uses both homegrown quotas; a continuously club-trained U21 takes List B.
{
  const { world, home } = buildWorld();
  const result = autoRegisterClub(world, home, {
    key: "continental:continental_champions",
    type: "continental",
    competitionId: "continental_champions",
  });
  assert.equal(result.ok, true);
  const summary = registrationSummary(world, home, continentalFixture);
  assert.equal(summary.valid, true);
  assert.ok(summary.registered <= 25);
  assert.ok(summary.registered <= 21 + Math.min(4, summary.clubTrained));
  assert.ok(summary.nonAssociation <= 17);

  const listB = home.players.find((candidate) => candidate.age === 20);
  setDevelopment(listB, home, home.countryId, { clubYears: 2, associationYears: 2, consecutive: 2 });
  home.registrations = null;
  const eligibility = playerCompetitionEligibility(world, home, continentalFixture, listB);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.route, "list-b");
}

// Development is recorded from the actual club once per season and survives a later move.
{
  const { world, home, away } = buildWorld();
  const graduate = player("graduate", "MID", 12, 18, "ENG");
  graduate.clubId = home.id;
  graduate.fromYouth = true;
  home.youth.players.push(graduate);
  const seeded = ensurePlayerDevelopment(world, graduate, home);
  const before = Number(seeded.clubYears[home.id]) || 0;
  recordDevelopmentSeason(world, 2026);
  recordDevelopmentSeason(world, 2026);
  assert.equal(graduate.development.clubYears[home.id], before + 1, "season must only count once");
  home.youth.players = home.youth.players.filter((candidate) => candidate.id !== graduate.id);
  away.players.push(graduate);
  graduate.clubId = away.id;
  assert.equal(developmentStatus(world, home, graduate).clubYears, before + 1);
  assert.equal(developmentStatus(world, away, graduate).clubYears, 0);
}

// Manual registration locks outside transfer windows and cannot use an exempt player as an A-list slot.
{
  const { world, home } = buildWorld();
  const context = { key: "league", type: "league", competitionId: 1 };
  autoRegisterClub(world, home, context);
  const u21 = home.players.find((candidate) => candidate.age === 20);
  assert.equal(setPlayerRegistered(world, home, context, u21.id, true).ok, false);
  world.day = 51;
  const adult = home.players.find((candidate) => candidate.age > 21);
  assert.equal(setPlayerRegistered(world, home, context, adult.id, false).ok, false);
}

// Match creation repairs an illegal XI and the bench exposes only competition-eligible players.
{
  const { world, home } = buildWorld();
  autoRegisterClub(world, home, { key: "league", type: "league", competitionId: 1 });
  const eligible = eligiblePlayerIds(world, home, leagueFixture);
  const excluded = home.players.find((candidate) => candidate.age > 21 && !eligible.has(candidate.id));
  assert.ok(excluded, "test squad must contain an unregistered adult");
  home.tactics.lineup[0] = excluded.id;
  ensureMatchLineup(home, { eligibleIds: eligible });
  assert.equal(home.tactics.lineup.includes(excluded.id), false);

  const state = createMatchSession(world, leagueFixture);
  assert.equal(state.eligiblePlayerIds.home.has(excluded.id), false);
  assert.equal(getBenchPlayers(home, state).some((candidate) => candidate.id === excluded.id), false);
}

// 🔴 报名名单必须**至少留 1 名门将**（2026-09-22 新增护栏）。
//
// 为什么钉它：`automaticPlayerIds` 按 `registrationScore` 从高到低填名额，而那个分数是
// `ovr × 100 + potential + positionFloor`，门将的 `positionFloor` 只有 **0.3**
// （`ovr × 100` 是 1300+ 量级）⇒ **实质位置无关**。
// 非本土培养名额上限 17 ⇒ 某队非本土球员 > 17 时最弱那批被切，
// 门将若恰在最弱批就会**一个都不剩** ⇒ `eligiblePlayerIds` 排除全部门将
// ⇒ `ensureMatchLineup` 把一名外场球员放进首发门将槽
// （症状：门将槽的球员跑 2.44km，却被按 `pos` 统计成 DEF）。
//
// ⚠ **当前真实世界不可达**：8 种子 × 270 队 = **2160 队实测 0 例**；
//   真实球队连签 3/6/9/12/15 名外援（squad 19→34）也 0 例。
//   唯一触发过的场景是**探针自己造的合成阵容**（把两名门将设成全队最弱）。
//   ⇒ 这条性质是「现在恰好成立」—— 钉住它，将来报名逻辑改动导致丢门将时
//     会**立刻报警**，而不是等玩家报「我队门将是个后卫」。
//   详见 `docs/measurements/gk-slot-eligibility-2026-09-22.txt`。
//
// ⚠ 注意本护栏**只管报名**，不改任何行为：全队门将都不可用时由外场球员客串门将
//   是**正确**的降级（现实足球也会发生）。现实规则也**不要求**名单里必须有门将 ——
//   所以不给 `automaticPlayerIds` 加「必须留门将」的约束（那是发明规则）。
{
  const seeds = 4;
  let clubs = 0;
  let withoutGk = 0;
  const offenders = [];
  for (let s = 0; s < seeds; s += 1) {
    resetIdCounter(1);
    const division3 = CLUB_TEMPLATES.filter((candidate) => candidate.division === 3);
    const world = createWorld(division3[s % division3.length].id, `GK guard ${s}`);
    world.season = 2026 + s;
    for (const candidate of world.clubs || []) {
      const fixture = (world.fixtures || []).find(
        (f) => f.home === candidate.id || f.away === candidate.id
      );
      if (!fixture) continue;
      clubs += 1;
      const gks = (candidate.players || []).filter((p) => p.pos === "GK");
      // 阵容本身没有门将 ⇒ 不是本护栏管的事（那是球员生成的问题）
      if (!gks.length) continue;
      const ids = eligiblePlayerIds(world, candidate, fixture);
      if (!gks.some((p) => ids.has(p.id))) {
        withoutGk += 1;
        if (offenders.length < 5) offenders.push(candidate.id);
      }
    }
  }
  // 样本量断言：没有它，「0 例」可能只是没量到
  assert.ok(clubs > 500, `普查样本太小（${clubs} 队），这条护栏没有判决力`);
  assert.equal(
    withoutGk,
    0,
    `有 ${withoutGk} 支球队的报名名单排除了全部门将（例：${offenders.join(", ")}）`
  );
  console.log(`  门将护栏：${clubs} 支球队，报名名单排除全部门将的 ${withoutGk} 支`);
}

console.log("Squad registration audit passed: development history, domestic and continental quotas, U21/List B, locking, and match eligibility");
