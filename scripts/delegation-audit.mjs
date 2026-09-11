import assert from "node:assert/strict";

import { FORMATIONS } from "../js/data.js";
import {
  applyDelegatedLineup,
  applyDelegatedTactics,
  applyDelegatedTraining,
  ensureDelegation,
  setManagementMode,
} from "../js/delegation.js";
import { autoLineup, defaultTactics } from "../js/models.js";
import {
  applyLiveTactics,
  applyManagedTeamTalk,
  applyTeamTalk,
  applyUserHalfTime,
  applySubstitution,
  createMatchSession,
  playFirstHalf,
  playSecondHalf,
} from "../js/match.js";

function player(id, pos, ovr, options = {}) {
  return {
    id,
    name: id,
    pos,
    ovr,
    potential: options.potential ?? ovr + 1,
    age: options.age ?? 27,
    fitness: options.fitness ?? 90,
    morale: options.morale ?? 70,
    injured: options.injured ?? 0,
    suspendedMatches: 0,
    attrs: {},
  };
}

function squad() {
  const players = [player("gk", "GK", 14), player("gk2", "GK", 13)];
  for (let i = 0; i < 7; i++) players.push(player(`d${i}`, "DEF", 16 - i * 0.3));
  for (let i = 0; i < 8; i++) players.push(player(`m${i}`, "MID", 16 - i * 0.25));
  for (let i = 0; i < 6; i++) players.push(player(`a${i}`, "ATT", 16 - i * 0.4));
  return players;
}

function fixture(day = 5) {
  return { day, home: "user", away: "opp", played: false };
}

function testWorld() {
  const club = {
    id: "user",
    name: "User",
    power: 70,
    players: squad(),
    tactics: defaultTactics(),
    staff: { coach: { id: "coach", name: "Coach", role: "coach", rating: 15, wage: 1000, age: 45, contractYears: 3, clubId: "user" } },
  };
  const opponent = { id: "opp", name: "Opponent", power: 65, players: squad(), tactics: defaultTactics() };
  const world = { day: 1, season: 1, userClubId: club.id, clubs: [club, opponent], fixtures: [fixture()], news: [] };
  return { world, club, opponent };
}

function assertNoSubstituteReentry(events, clubId) {
  const substitutions = events.filter((event) => event.type === "sub" && event.teamId === clubId);
  const removed = new Set();
  for (const substitution of substitutions) {
    assert.ok(!removed.has(substitution.inId), "a substituted player must not return to the same match");
    removed.add(substitution.outId);
  }
}

{
  const { world, club } = testWorld();
  autoLineup(club);
  const state = createMatchSession(world, fixture());
  state.eligiblePlayerIds.home = new Set(club.players.map((player) => player.id));
  const original = club.tactics.lineup[1];
  const originalPlayer = club.players.find((player) => player.id === original);
  const firstBench = club.players.find(
    (candidate) => !club.tactics.lineup.includes(candidate.id) && candidate.pos === originalPlayer.pos
  );
  assert.ok(originalPlayer && firstBench, "same-position outfield substitution fixture must exist");
  assert.equal(applySubstitution(state, club, original, firstBench.id, 60).ok, true);
  const secondBench = club.players.find(
    (candidate) =>
      !club.tactics.lineup.includes(candidate.id) &&
      candidate.id !== original &&
      candidate.pos === firstBench.pos
  );
  assert.ok(secondBench, "second same-position substitute fixture must exist");
  assert.equal(applySubstitution(state, club, firstBench.id, secondBench.id, 70).ok, true);
  assert.equal(applySubstitution(state, club, secondBench.id, firstBench.id, 80).ok, false,
    "a substituted player must never re-enter, regardless of the random match path");
}

{
  const { world, club } = testWorld();
  autoLineup(club);
  const cupFixture = { ...fixture(), competitionType: "domestic-cup" };
  const state = createMatchSession(world, cupFixture);
  state.eligiblePlayerIds.home = new Set(club.players.map((player) => player.id));
  const outfield = club.players.find(
    (player) => club.tactics.lineup.includes(player.id) && player.pos !== "GK"
  );
  const goalkeeper = club.players.find(
    (player) => !club.tactics.lineup.includes(player.id) && player.pos === "GK"
  );
  assert.ok(outfield && goalkeeper, "goalkeeper substitution guard fixture must exist");
  const before = [...club.tactics.lineup];
  const result = applySubstitution(state, club, outfield.id, goalkeeper.id, 60);
  assert.equal(result.ok, false, "an outfield slot must reject a substitute goalkeeper");
  assert.deepEqual(club.tactics.lineup, before, "a rejected substitution must not mutate the lineup");
}

{
  const { world, club } = testWorld();
  autoLineup(club);
  const cupFixture = { ...fixture(), competitionType: "domestic-cup" };
  const state = createMatchSession(world, cupFixture);
  state.eligiblePlayerIds.home = new Set(club.players.map((player) => player.id));
  const goalkeeper = club.players.find(
    (player) => club.tactics.lineup.includes(player.id) && player.pos === "GK"
  );
  const outfield = club.players.find(
    (player) => !club.tactics.lineup.includes(player.id) && player.pos !== "GK"
  );
  const backup = club.players.find(
    (player) => !club.tactics.lineup.includes(player.id) && player.pos === "GK"
  );
  assert.ok(goalkeeper && outfield && backup, "goalkeeper replacement fixture must exist");
  assert.equal(
    applySubstitution(state, club, goalkeeper.id, outfield.id, 60).ok,
    false,
    "a goalkeeper slot must reject an outfield substitute"
  );
  assert.equal(applySubstitution(state, club, goalkeeper.id, backup.id, 60).ok, true);
  assert.equal(
    club.tactics.lineup.filter((id) => club.players.find((player) => player.id === id)?.pos === "GK").length,
    1,
    "a valid goalkeeper replacement must leave exactly one goalkeeper on the pitch"
  );
}

{
  const { world, club } = testWorld();
  const delegation = ensureDelegation(world, club);
  assert.equal(world.managementMode, "head_coach");
  assert.equal(delegation.training, "player");
  assert.equal(delegation.lineup, "player");
  assert.equal(delegation.tactics, "player");
}

{
  const { world, club } = testWorld();
  const delegation = ensureDelegation(world, club);
  delegation.training = "staff";
  for (const player of club.players) player.fitness = 55;
  const result = applyDelegatedTraining(world, club);
  assert.equal(result.ok, true);
  assert.equal(club.training.focus, "recovery");
  assert.equal(club.training.intensity, "light");
}

{
  const { world, club } = testWorld();
  const delegation = ensureDelegation(world, club);
  delegation.lineup = "staff";
  delegation.locks.playerIds = ["a5"];
  const result = applyDelegatedLineup(world, club);
  assert.equal(result.ok, true);
  assert.ok(result.lineup.includes("a5"));
  club.players.find((p) => p.id === "a5").injured = 10;
  const injuredResult = applyDelegatedLineup(world, club);
  assert.ok(!injuredResult.lineup.includes("a5"));
  assert.ok(injuredResult.unavailableLocked.includes("a5"));
}

{
  const { world, club } = testWorld();
  const delegation = ensureDelegation(world, club);
  club.tactics.formation = "5-3-2";
  delegation.tactics = "staff";
  delegation.locks.formation = true;
  const result = applyDelegatedTactics(world, club, fixture());
  assert.equal(result.ok, true);
  assert.equal(club.tactics.formation, "5-3-2");
  assert.ok(FORMATIONS[club.tactics.formation]);
}

{
  const { club } = testWorld();
  const senior = club.players.find((p) => p.id === "a0");
  const youth = club.players.find((p) => p.id === "a1");
  senior.ovr = 15;
  youth.ovr = 14.9;
  youth.age = 19;
  youth.potential = 18;
  autoLineup(club, { youthPriority: "high" });
  assert.ok(club.tactics.lineup.includes(youth.id));
  senior.ovr = 19;
  autoLineup(club, { youthPriority: "high" });
  assert.ok(club.tactics.lineup.includes(senior.id));
}

{
  const { world, club } = testWorld();
  delete club.staff.coach;
  const result = setManagementMode(world, club, "club_director");
  assert.equal(result.ok, false);
  assert.notEqual(world.managementMode, "club_director");
}

{
  const { world, club } = testWorld();
  const result = setManagementMode(world, club, "club_director");
  assert.equal(result.ok, true);
  const tactics = applyDelegatedTactics(world, club, fixture());
  assert.equal(tactics.ok, true);
  assert.equal("matchBonus" in club, false);
  assert.equal("delegationMod" in club.tactics, false);
  assert.equal("power" in tactics, false);
}

{
  const { world, club } = testWorld();
  assert.equal(setManagementMode(world, club, "club_director").ok, true);
  const state = createMatchSession(world, fixture());
  const originalStyle = club.tactics.style;
  const playerTalk = applyTeamTalk(state, "demand", "pre");
  assert.equal(playerTalk.ok, false, "club director must not deliver the team talk");
  const coachTalk = applyManagedTeamTalk(state, "pre");
  assert.equal(coachTalk.ok, true, "head coach should deliver the delegated team talk");
  const halfTime = applyUserHalfTime(state, { style: "attack" });
  assert.equal(halfTime.ok, false, "club director must not control half-time tactics");
  const live = applyLiveTactics(state, { style: originalStyle === "attack" ? "defend" : "attack" });
  assert.equal(live.ok, false, "club director must not control live tactics");
  assert.equal(club.tactics.style, originalStyle, "blocked live tactics must not mutate club tactics");
}

{
  const { world, club, opponent } = testWorld();
  assert.equal(setManagementMode(world, club, "club_director").ok, true);
  const state = createMatchSession(world, fixture());
  assert.equal(applyManagedTeamTalk(state, "pre").ok, true);
  await playFirstHalf(state);
  const streamed = [];
  await playSecondHalf(state, { onEvent: (event) => streamed.push(event) });
  assert.ok(["encourage", "calm", "demand", "solid", "control"].includes(state.teamTalks.ht));
  const reviews = state.events.filter((event) => event.managedDecision && event.phase === "matchday");
  assert.deepEqual(reviews.map((event) => event.minute), [60, 75]);
  const scheduledSubs = state.events.filter(
    (event) => event.type === "sub" && (event.minute === 60 || event.minute === 75)
  );
  assert.ok(scheduledSubs.some((event) => event.teamId === club.id), "delegated coach must use substitutions");
  assert.ok(scheduledSubs.some((event) => event.teamId === opponent.id), "opposing coach must use substitutions");
  assert.ok(
    streamed.some((event) => event.type === "sub" && event.teamId === club.id),
    "delegated substitutions must reach the live event stream"
  );
  assert.ok(
    streamed.some((event) => event.type === "sub" && event.teamId === opponent.id),
    "opponent substitutions must reach the live event stream"
  );
  assertNoSubstituteReentry(state.events, club.id);
  assertNoSubstituteReentry(state.events, opponent.id);
}

{
  const { world, club, opponent } = testWorld();
  world.userClubId = "not-in-this-fixture";
  const state = createMatchSession(world, fixture());
  await playFirstHalf(state);
  await playSecondHalf(state);
  const scheduledSubs = state.events.filter(
    (event) => event.type === "sub" && (event.minute === 60 || event.minute === 75)
  );
  assert.ok(scheduledSubs.some((event) => event.teamId === club.id), "home AI must review substitutions");
  assert.ok(scheduledSubs.some((event) => event.teamId === opponent.id), "away AI must review substitutions");
  assertNoSubstituteReentry(state.events, club.id);
  assertNoSubstituteReentry(state.events, opponent.id);
}

for (const engineMode of ["probability", "spatial"]) {
  const { world, club, opponent } = testWorld();
  for (const team of [club, opponent]) {
    for (const player of team.players) player.id = `${team.id}-${player.id}`;
  }
  const state = createMatchSession(
    world,
    { ...fixture(), competitionType: "domestic-cup", matchSeed: 911253 },
    { engineMode }
  );
  const starters = new Set(opponent.tactics.lineup);
  const backup = opponent.players.find((player) => !starters.has(player.id) && player.pos === "GK");
  assert.ok(backup, "AI substitution fixture must have a reserve keeper");
  for (const player of opponent.players) {
    if (!starters.has(player.id)) player.ovr = player.pos === "GK" ? 20 : 8;
  }

  await playFirstHalf(state);
  if (engineMode === "spatial") {
    const engine = state.simEng;
    const outgoing = engine.agents.find(
      (agent) => agent.team === "away" && agent.role !== "GK" && !agent.sentOff
    );
    assert.ok(outgoing);
    const pendingBefore = state._simPendingSubs.length;
    const incoming = engine.onInjurySub(outgoing);
    assert.ok(incoming, "injury replacement must use an available outfield player");
    assert.notEqual(incoming.pos, "GK", "injury callback must not select the highest-rated reserve keeper");
    state._simPendingSubs.length = pendingBefore;

    const eligible = state.eligiblePlayerIds.away;
    state.eligiblePlayerIds.away = new Set([...opponent.tactics.lineup, backup.id]);
    assert.equal(engine.onInjurySub(outgoing), null, "a keeper-only bench cannot replace an injured outfielder");
    assert.equal(state._simPendingSubs.length, pendingBefore, "no candidate must not reserve a substitution");
    state.eligiblePlayerIds.away = eligible;
  }
  await playSecondHalf(state);

  const substitutions = state.events.filter((event) => event.type === "sub" && event.teamId === opponent.id);
  assert.ok(substitutions.some((event) => event.minute === 60 || event.minute === 75),
    `${engineMode}: AI must still make scheduled outfield substitutions`);
  const lineup = new Set(starters);
  for (const event of substitutions) {
    const outgoing = opponent.players.find((player) => player.id === event.outId);
    const incoming = opponent.players.find((player) => player.id === event.inId);
    assert.ok(outgoing && incoming);
    assert.equal(incoming.pos === "GK", outgoing.pos === "GK",
      `${engineMode}: AI goalkeeper replacements must stay in the goalkeeper position`);
    lineup.delete(event.outId);
    lineup.add(event.inId);
    assert.equal(opponent.players.filter((player) => lineup.has(player.id) && player.pos === "GK").length, 1,
      `${engineMode}: every substitution must leave one goalkeeper in the lineup`);
  }
  assert.ok(!substitutions.some((event) => event.inId === backup.id),
    `${engineMode}: reserve keeper must stay on the bench during ordinary outfield rotations`);
}

console.log("delegation audit passed");
