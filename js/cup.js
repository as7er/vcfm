/** VCFM 杯：三级共 60 队淘汰赛 */

import { uid } from "./models.js";

function rng() {
  return Math.random();
}

/** 从 64 种子需要 60 队 + 4 轮空？用 64 槽：60 队 + 4 bye，或直接 60 队第一轮 4 队轮空进 32？
 * 简化：随机抽 4 队第一轮轮空 → 56 队打 28 场 = 28 胜 + 4 轮空 = 32 强，再标准淘汰。
 */
export function createLeagueCup(world) {
  const clubs = world.clubs.map((c) => c.id);
  // 洗牌
  for (let i = clubs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [clubs[i], clubs[j]] = [clubs[j], clubs[i]];
  }

  // 4 支轮空（优先乙级弱旅轮空显得合理——随机即可）
  const byes = clubs.slice(0, 4);
  const play = clubs.slice(4); // 56

  const R32 = [];
  // 28 场 R1 → 进 32 强的还有 byes
  const r1winners = [...byes];
  const r1fixtures = [];
  let day = 10; // 赛季第 10 天开打首轮
  for (let i = 0; i < play.length; i += 2) {
    r1fixtures.push({
      id: uid("cup"),
      competition: "cup",
      round: "R56",
      roundLabel: "VCFM 杯第1轮",
      day,
      home: play[i],
      away: play[i + 1],
      homeGoals: null,
      awayGoals: null,
      played: false,
      events: [],
    });
  }

  return {
    name: "VCFM 杯",
    season: world.season,
    stage: "R56", // R56 → R32 → R16 → QF → SF → F → done
    byes,
    fixtures: r1fixtures,
    bracket: {
      R56: r1fixtures.map((f) => f.id),
      R32: [],
      R16: [],
      QF: [],
      SF: [],
      F: [],
    },
    champion: null,
    pendingWinners: r1winners, // 轮空已进下一轮名单，首轮打完后合并
  };
}

export function ensureCup(world) {
  if (!world.cup || world.cup.season !== world.season) {
    world.cup = createLeagueCup(world);
  }
  return world.cup;
}

export function cupFixturesOnDay(world, day) {
  const cup = world.cup;
  if (!cup) return [];
  return cup.fixtures.filter((f) => !f.played && f.day === day);
}

export function getNextUserCupMatch(world) {
  const cup = world.cup;
  if (!cup) return null;
  return cup.fixtures.find(
    (f) =>
      !f.played &&
      (f.home === world.userClubId || f.away === world.userClubId)
  );
}

export function allCupUserFixtures(world) {
  const cup = world.cup;
  if (!cup) return [];
  return cup.fixtures.filter(
    (f) => f.home === world.userClubId || f.away === world.userClubId
  );
}

const STAGE_ORDER = ["R56", "R32", "R16", "QF", "SF", "F", "done"];
const STAGE_LABEL = {
  R56: "VCFM 杯第1轮",
  R32: "VCFM 杯32强",
  R16: "VCFM 杯16强",
  QF: "VCFM 杯四分之一决赛",
  SF: "VCFM 杯半决赛",
  F: "VCFM 杯决赛",
};
const NEXT_STAGE = {
  R56: "R32",
  R32: "R16",
  R16: "QF",
  QF: "SF",
  SF: "F",
  F: "done",
};
const STAGE_SIZE = { R32: 32, R16: 16, QF: 8, SF: 4, F: 2 };

/** 当前阶段全部赛完后生成下一轮 */
export function advanceCupBracket(world) {
  const cup = world.cup;
  if (!cup || cup.stage === "done") return;

  const stage = cup.stage;
  const stageFx = cup.fixtures.filter((f) => f.round === stage);
  if (!stageFx.length || !stageFx.every((f) => f.played)) return;

  const winners = [];
  if (stage === "R56") {
    winners.push(...(cup.pendingWinners || []));
  }
  for (const f of stageFx) {
    const w =
      f.homeGoals > f.awayGoals
        ? f.home
        : f.homeGoals < f.awayGoals
          ? f.away
          : rng() < 0.5
            ? f.home
            : f.away; // 平局点球简化
    if (f.homeGoals === f.awayGoals) {
      f.penalties = true;
      f.winner = w;
    }
    winners.push(w);
  }

  const next = NEXT_STAGE[stage];
  if (next === "done") {
    cup.stage = "done";
    cup.champion = winners[0];
    const champ = world.clubs.find((c) => c.id === cup.champion);
    world.news.unshift({
      day: world.day,
      text: `🏆 VCFM 杯冠军：${champ?.name || cup.champion}！`,
    });
    return;
  }

  // 洗牌对阵
  for (let i = winners.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [winners[i], winners[j]] = [winners[j], winners[i]];
  }

  // 下一轮日期：当前 max day + 14
  const maxDay = Math.max(...cup.fixtures.map((f) => f.day), world.day);
  const day = maxDay + 14;
  const label = STAGE_LABEL[next];
  const newFx = [];
  for (let i = 0; i < winners.length; i += 2) {
    if (!winners[i + 1]) break;
    const f = {
      id: uid("cup"),
      competition: "cup",
      round: next,
      roundLabel: label,
      day,
      home: winners[i],
      away: winners[i + 1],
      homeGoals: null,
      awayGoals: null,
      played: false,
      events: [],
    };
    newFx.push(f);
    cup.fixtures.push(f);
  }
  cup.bracket[next] = newFx.map((f) => f.id);
  cup.stage = next;
  cup.pendingWinners = [];

  world.news.unshift({
    day: world.day,
    text: `🏆 ${label}对阵已出炉（比赛日 D${day}）`,
  });
}

export { STAGE_LABEL, STAGE_ORDER };
