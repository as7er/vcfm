// P5 接入自检：用户场走 SimEngine，AI 场走概率引擎
import {
  simulateMatchSync,
} from "../match.js";
import { createPlayer } from "../models.js";

function makeClub(id, name, power) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, i) => {
    const p = createPlayer(pos, power, id);
    p.number = i + 1;
    return p;
  });
  return {
    id,
    name,
    short: name.slice(0, 3),
    division: 3,
    money: 1e6,
    form: [],
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((p) => p.id),
      style: "balanced",
      pressing: 3,
      tempo: 3,
      width: 3,
      defensiveLine: 3,
      roles: [],
    },
    staff: {},
    facilities: {},
  };
}

function makeWorld(userClubId, home, away) {
  return {
    userClubId,
    day: 10,
    season: 1,
    clubs: [home, away],
    fixtures: [],
    table: {
      [home.id]: { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
      [away.id]: { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 },
    },
    news: [],
    media: [],
    inbox: [],
  };
}

const home = makeClub("u1", "UserFC", 68);
const away = makeClub("a1", "AIFC", 62);

console.log("=== 用户场 (应走 v2) ===");
const worldUser = makeWorld("u1", home, away);
const f1 = { home: "u1", away: "a1", day: 10, competition: "league", round: 1, played: false };
const t0 = Date.now();
const r1 = simulateMatchSync(worldUser, f1, { teamTalkId: "encourage" });
console.log("ms", Date.now() - t0);
console.log("score", r1.homeGoals, "-", r1.awayGoals);
console.log("events", r1.events.length);
console.log(
  "goals",
  r1.events.filter((e) => e.type === "goal").map((e) => `${e.minute}' ${e.playerId || "?"}`)
);
console.log("sim marker", r1.events.some((e) => e.text && e.text.includes("空间模拟")));
console.log("shots", r1.report?.home?.shots, r1.report?.away?.shots);
console.log("xg", r1.report?.home?.xg, r1.report?.away?.xg);
console.log("fromSim goals", r1.events.filter((e) => e.type === "goal" && e.fromSim).length);

console.log("\n=== AI 场 (应走 v1，无 sim 标记) ===");
const home2 = makeClub("c1", "ClubA", 70);
const away2 = makeClub("c2", "ClubB", 65);
const worldAi = makeWorld("nobody", home2, away2);
const f2 = { home: "c1", away: "c2", day: 11, competition: "league", round: 2, played: false };
const t1 = Date.now();
const r2 = simulateMatchSync(worldAi, f2);
console.log("ms", Date.now() - t1);
console.log("score", r2.homeGoals, "-", r2.awayGoals);
console.log("sim marker", r2.events.some((e) => e.text && e.text.includes("空间模拟")));
console.log("events", r2.events.length);

if (!r1.events.some((e) => e.text && e.text.includes("空间模拟"))) {
  console.error("FAIL: user match missing sim marker");
  process.exit(1);
}
if (r2.events.some((e) => e.text && e.text.includes("空间模拟"))) {
  console.error("FAIL: AI match should not use sim");
  process.exit(1);
}
if (!f1.played) {
  console.error("FAIL: fixture not finalized");
  process.exit(1);
}
console.log("\nOK p5 integration");
