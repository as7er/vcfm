import assert from "node:assert/strict";

import { CLUB_TEMPLATES } from "../js/data.js";
import { createWorld } from "../js/models.js";
import {
  ensureInternational,
  internationalLeaders,
  internationalMatches,
  listInternationalCompetitions,
  nationalCompetitionStats,
  nationalSquad,
  runInternationalBreak,
} from "../js/intl.js";

const startClubId = CLUB_TEMPLATES.find((club) => club.division === 3)?.id;
assert.ok(startClubId, "a playable starting club is required");

function simulateTournament(season, expectedKey, breaks, expectedMatches) {
  const world = createWorld(startClubId, "International Audit");
  world.season = season;
  const preservedPlayer = world.clubs[0].players[0];
  preservedPlayer.intl.caps = 9;
  delete world.international;
  ensureInternational(world);
  assert.equal(preservedPlayer.intl.caps, 9, "old player international stats must be preserved");

  const competition = listInternationalCompetitions(world).find((item) => item.key === expectedKey);
  assert.ok(competition, `${expectedKey} competition should be created`);
  for (const code of ["ENG", "ESP", "ITA", "GER", "FRA"]) {
    assert.ok(competition.participants.includes(code), `${code} must be in ${expectedKey}`);
  }
  for (let i = 0; i < breaks; i++) {
    world.day = (i + 1) * 30;
    runInternationalBreak(world);
  }

  const matches = internationalMatches(world, competition.id);
  assert.equal(matches.length, expectedMatches, `${expectedKey} fixture count`);
  assert.equal(new Set(matches.map((match) => match.id)).size, matches.length, "match IDs must be unique");
  assert.equal(competition.stage, "done", `${expectedKey} should finish`);
  assert.ok(competition.champion, `${expectedKey} should have a champion`);
  assert.ok(
    world.international.history.some((item) => item.id === competition.id && item.champion),
    "champion history should be stored"
  );
  const leaders = internationalLeaders(world, competition.id);
  assert.ok(leaders.appearances.length, "appearance leaders should be available");
  assert.ok(leaders.keepers.length, "goalkeeper data should be available");
  const nation = competition.participants[0];
  assert.ok(nationalSquad(world, nation).length > 0, "national squad should be available");
  assert.ok(nationalCompetitionStats(world, nation, competition.id).size > 0, "national player event stats should be available");
  return { champion: competition.champion, matches: matches.length };
}

const worldCup = simulateTournament(2026, "world", 6, 31);
const european = simulateTournament(2028, "europe", 5, 15);

console.log(JSON.stringify({ worldCup, european }, null, 2));
