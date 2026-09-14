import assert from "node:assert/strict";
import {
  createPlayer,
  ensureFootballProfile,
  playerOverall,
} from "../js/models.js";
import {
  PLAYER_ATTRIBUTE_ARCHETYPES,
  PLAYER_ATTRIBUTE_MODEL_VERSION,
  attributeArchetypeIdsForPosition,
  ensurePlayerAttributeProfile,
  inferAttributeArchetype,
  preferredHabitsForAttributeArchetype,
  weightedDevelopmentAttributes,
} from "../js/player-attributes.js";
import { PLAYER_HABITS, ensurePlayerHabits } from "../js/player-habits.js";

const sample = [];
for (const pos of ["GK", "DEF", "MID", "ATT"]) {
  for (let index = 0; index < 800; index++) sample.push(createPlayer(pos, 68, "attribute-audit"));
}

const byPosition = Object.groupBy(sample, (player) => player.pos);
const avg = (players, key) => players.reduce((sum, player) => sum + player.attrs[key], 0) / players.length;

let habitProfileMatches = 0;
let habitProfileCandidates = 0;
for (const player of sample) {
  assert.equal(player.attributeModelVersion, PLAYER_ATTRIBUTE_MODEL_VERSION, "new players need the current attribute model");
  assert.ok(PLAYER_ATTRIBUTE_ARCHETYPES[player.attributeArchetype], "every player needs a public attribute archetype");
  assert.equal(player.ovr, playerOverall(player), "stored OVR must match the position's real key attributes");
  for (const value of Object.values(player.attrs)) {
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 20, "attributes must stay on the 1-20 scale");
  }
}

const goalkeepers = byPosition.GK;
assert.ok(avg(goalkeepers, "reflexes") >= avg(goalkeepers, "shooting") + 5, "goalkeepers need clear goalkeeping strengths");
assert.ok(avg(goalkeepers, "handling") >= avg(goalkeepers, "finishing") + 5, "goalkeepers must not resemble outfield finishers");

const defenders = byPosition.DEF;
assert.ok(avg(defenders, "tackling") >= avg(defenders, "shooting") + 3, "defenders need defensive priority");
assert.ok(avg(defenders, "marking") >= avg(defenders, "finishing") + 3, "defenders need marking ahead of finishing");

const midfielders = byPosition.MID;
assert.ok(avg(midfielders, "passing") >= avg(midfielders, "finishing") + 2, "midfielders need passing priority");
assert.ok(avg(midfielders, "vision") >= avg(midfielders, "marking") + 1, "the mixed midfield population needs creative distinction");

const attackers = byPosition.ATT;
assert.equal(attackers.filter((player) => player.attrs.tackling > player.attrs.shooting).length, 0,
  "an attacker's tackling must not exceed shooting");
assert.equal(attackers.filter((player) => player.attrs.tackling > player.attrs.finishing).length, 0,
  "an attacker's tackling must not exceed finishing");
assert.ok(avg(attackers, "finishing") >= avg(attackers, "tackling") + 3, "attackers need a clear finishing advantage");

const byArchetype = Object.groupBy(sample, (player) => player.attributeArchetype);
const archetypeAvg = (id, key) => avg(byArchetype[id], key);
assert.ok(archetypeAvg("centre_back", "marking") > archetypeAvg("centre_back", "dribbling") + 3,
  "centre-backs need marking and tackling ahead of carrying");
assert.ok(archetypeAvg("full_back", "pace") > archetypeAvg("full_back", "finishing") + 3,
  "full-backs need pace, stamina and crossing ahead of finishing");
assert.ok(archetypeAvg("holding_midfielder", "positioning") > archetypeAvg("holding_midfielder", "shooting") + 2,
  "holding midfielders need positioning and ball-winning balance");
assert.ok(archetypeAvg("playmaker", "vision") > archetypeAvg("playmaker", "marking") + 3,
  "playmakers need vision, passing and decisions ahead of marking");
assert.ok(archetypeAvg("box_to_box", "stamina") > archetypeAvg("box_to_box", "finishing") + 2,
  "box-to-box midfielders need standout stamina");
assert.ok(archetypeAvg("wide_midfielder", "crossing") > archetypeAvg("wide_midfielder", "marking") + 2,
  "wide midfielders need crossing and carrying strengths");
assert.ok(archetypeAvg("winger", "pace") > archetypeAvg("winger", "tackling") + 4,
  "wingers need pace and dribbling ahead of tackling");
assert.ok(archetypeAvg("inside_forward", "finishing") > archetypeAvg("inside_forward", "crossing") + 1,
  "inside forwards need finishing ahead of touchline delivery");
assert.ok(archetypeAvg("advanced_forward", "finishing") > archetypeAvg("advanced_forward", "passing") + 3,
  "advanced forwards need finishing and movement ahead of playmaking");
assert.ok(archetypeAvg("target_forward", "heading") > archetypeAvg("target_forward", "pace") + 3,
  "target forwards need strength and heading ahead of pace");
assert.ok(archetypeAvg("pressing_forward", "stamina") > archetypeAvg("pressing_forward", "tackling") + 2,
  "pressing forwards may tackle, but their engine and forward skills must remain primary");
assert.ok(archetypeAvg("false_nine", "vision") > archetypeAvg("false_nine", "tackling") + 4,
  "false nines need playmaking and finishing ahead of defending");

for (const pos of ["DEF", "MID", "ATT"]) {
  const represented = new Set(byPosition[pos].map((player) => player.attributeArchetype));
  assert.ok(represented.size >= 2, `${pos} must contain multiple valid role profiles`);
  assert.ok(attributeArchetypeIdsForPosition(pos).every((id) => represented.has(id)), `${pos} generation must cover every configured archetype`);
}

for (const player of sample) {
  ensurePlayerHabits(player);
  const preferred = preferredHabitsForAttributeArchetype(player);
  for (const habitId of player.playingHabits) {
    const definition = PLAYER_HABITS[habitId];
    assert.ok(definition, "generated habits must exist");
    assert.ok(definition.positions.includes(player.pos), "generated habits must fit the player's position");
  }
  if (preferred.length && player.playingHabits.length) {
    habitProfileCandidates++;
    if (player.playingHabits.some((habitId) => preferred.includes(habitId))) habitProfileMatches++;
  }
}
assert.ok(habitProfileMatches / habitProfileCandidates >= 0.96,
  "most generated habits should express the player's attribute archetype without becoming mandatory");

const legacy = {
  id: "legacy-inverted-forward",
  name: "Legacy Forward",
  pos: "ATT",
  age: 25,
  ovr: 14,
  potential: 16,
  attrs: {
    pace: 14, shooting: 9, passing: 13, dribbling: 13, defending: 17, physical: 14,
    finishing: 10, tackling: 19, marking: 18, strength: 14, stamina: 13, vision: 13,
    reflexes: 10, handling: 10, positioning: 13, kicking: 10,
  },
};
assert.equal(ensurePlayerAttributeProfile(legacy), true, "legacy profiles need a one-time migration");
assert.equal(legacy.ovr, playerOverall(legacy), "migration must preserve a coherent OVR");
assert.ok(legacy.attrs.shooting >= legacy.attrs.tackling, "migration must repair shooting/tackling inversion");
assert.ok(legacy.attrs.finishing >= legacy.attrs.tackling, "migration must repair finishing/tackling inversion");
assert.equal(ensureFootballProfile(legacy), true, "football profile must finish legacy fields after attribute migration");
assert.equal(ensurePlayerAttributeProfile(legacy), false, "attribute migration must be idempotent");

const legacyPlaymaker = {
  id: "legacy-playmaker",
  pos: "MID",
  ovr: 15,
  positionProfile: { version: 1, primary: "AM", natural: ["AM"], ratings: { DM: 7, CM: 15, LM: 10, RM: 10, AM: 18 } },
  attrs: {
    pace: 12, shooting: 12, passing: 18, dribbling: 16, defending: 8, physical: 10,
    finishing: 11, tackling: 7, marking: 7, strength: 9, stamina: 13, vision: 18,
    positioning: 11, heading: 7, crossing: 14, decisions: 17, reflexes: 5, handling: 5, kicking: 9,
  },
};
assert.equal(inferAttributeArchetype(legacyPlaymaker), "playmaker",
  "legacy migration must preserve an existing creative player's identity instead of assigning a random profile");

// ⚠ 必须挑一个「相关属性都没满 20」的 playmaker，不能直接用 `sample.find(...)`。
// `createPlayer` 走 Math.random（`js/models.js:66,74,82`），`sample.find` 取的是随机样本里
// 的**第一个** playmaker；若它的 `passing` 恰好已到 20，`weightedDevelopmentAttributes`
// 的 `< 20` 候选过滤（`js/player-attributes.js:258`）会把它整个剔掉 →
// passing 计数 0 < tackling 计数 1 → **断言随机失败**。
// 2026-09-14 实测：连跑 20 次失败 1 次（5%），会让 `verify --full` 无故变红、
// 且失败点在属性成长、与当轮改的比赛引擎毫无关系，极易误判成回归。
// playmaker 的权重是固定的（passing 2.5 → 5 份、tackling −1.1 → 1 份），
// 所以只要两者都没满 20，5 > 1 这个比较就是确定的。
const developmentFixture = sample.find(
  (player) =>
    player.attributeArchetype === "playmaker" &&
    player.attrs.passing < 20 &&
    player.attrs.tackling < 20
);
assert.ok(developmentFixture, "sample must contain an uncapped playmaker to measure development weighting");
const development = weightedDevelopmentAttributes(developmentFixture);
assert.ok(development.filter((key) => key === "passing").length > development.filter((key) => key === "tackling").length,
  "development should favour the player's role-defining strengths without excluding weaknesses");

console.log(JSON.stringify({
  players: sample.length,
  archetypes: Object.fromEntries(Object.entries(byArchetype).map(([id, players]) => [id, players.length])),
  averages: {
    GK: { reflexes: avg(goalkeepers, "reflexes"), handling: avg(goalkeepers, "handling") },
    DEF: { tackling: avg(defenders, "tackling"), marking: avg(defenders, "marking") },
    MID: { passing: avg(midfielders, "passing"), vision: avg(midfielders, "vision") },
    ATT: { shooting: avg(attackers, "shooting"), finishing: avg(attackers, "finishing"), tackling: avg(attackers, "tackling") },
  },
}, null, 2));
