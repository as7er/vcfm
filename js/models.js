/** 球员 / 球队生成 */

import {
  FIRST_NAMES,
  LAST_NAMES,
  NATIONALITIES,
  CLUB_TEMPLATES,
  FORMATIONS,
  DIVISIONS,
  START_DIVISION,
} from "./data.js";

let _id = 1;
export function uid(prefix = "p") {
  return `${prefix}_${_id++}_${Math.random().toString(36).slice(2, 7)}`;
}

export function resetIdCounter(n = 1) {
  _id = n;
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(v, a = 1, b = 20) {
  return Math.max(a, Math.min(b, Math.round(v)));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function gauss(mean, spread) {
  // ponytail: Box-Muller 简化，足够生成属性分布
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * spread;
}

export function playerOverall(p) {
  const { pos, attrs } = p;
  let raw;
  if (pos === "GK") {
    raw = (attrs.reflexes + attrs.handling + attrs.positioning + attrs.kicking) / 4;
  } else if (pos === "DEF") {
    raw = (attrs.tackling + attrs.marking + attrs.strength + attrs.pace + attrs.passing) / 5;
  } else if (pos === "MID") {
    raw = (attrs.passing + attrs.vision + attrs.stamina + attrs.pace + attrs.shooting) / 5;
  } else {
    raw = (attrs.shooting + attrs.pace + attrs.dribbling + attrs.finishing + attrs.strength) / 5;
  }
  return clamp(raw, 1, 20);
}

export function estimateValue(p) {
  const ovr = playerOverall(p);
  const ageFactor = p.age <= 23 ? 1.35 : p.age <= 28 ? 1.15 : p.age <= 32 ? 0.9 : 0.55;
  const base = Math.pow(ovr, 2.4) * 12_000;
  return Math.max(50_000, Math.round(base * ageFactor / 10_000) * 10_000);
}

export function estimateWage(p) {
  const ovr = playerOverall(p);
  const ageTax = p.age >= 34 ? 0.75 : p.age >= 32 ? 0.9 : 1;
  return Math.max(800, Math.round(ovr * ovr * 45 * ageTax));
}

/** 高龄退役概率（赛季结束后、年龄已 +1） */
export function retireChance(age) {
  if (age >= 40) return 1;
  if (age >= 38) return 0.75;
  if (age >= 36) return 0.45;
  if (age >= 34) return 0.22;
  if (age >= 33) return 0.1;
  if (age >= 32) return 0.04;
  return 0;
}

/** 年龄 +1，并处理 32+ 下滑；返回是否发生下滑 */
export function agePlayerOneYear(p) {
  p.age = (p.age || 17) + 1;
  let declined = false;
  if (p.age >= 32 && p.attrs) {
    const hits = p.age >= 36 ? 3 : p.age >= 34 ? 2 : 1;
    for (let i = 0; i < hits; i++) {
      const keys = Object.keys(p.attrs).filter((k) => (p.attrs[k] || 0) > 1);
      // 优先体能类
      const prefer = keys.filter((k) =>
        ["pace", "stamina", "physical", "strength", "reflexes", "dribbling"].includes(k)
      );
      const pool = prefer.length ? prefer : keys;
      if (!pool.length) break;
      const k = pool[Math.floor(Math.random() * pool.length)];
      p.attrs[k] = Math.max(1, p.attrs[k] - 1);
      declined = true;
    }
    p.ovr = playerOverall(p);
    if (p.potential != null) {
      p.potential = Math.max(p.ovr, Math.min(p.potential, p.ovr + (p.age >= 34 ? 0 : 1)));
    }
  } else if (p.age <= 24 && p.potential != null && p.ovr < p.potential && Math.random() < 0.35) {
    // 年轻球员赛季末小幅成长
    const keys = Object.keys(p.attrs || {}).filter((k) => (p.attrs[k] || 0) < 20);
    if (keys.length) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      p.attrs[k] = Math.min(20, p.attrs[k] + 1);
      p.ovr = playerOverall(p);
    }
  }
  p.value = estimateValue(p);
  p.wage = p.fromYouth && p.age <= 18
    ? Math.max(200, Math.round(estimateWage(p) * 0.25))
    : estimateWage(p);
  return declined;
}

export function emptyMatchStats() {
  return { apps: 0, goals: 0, assists: 0, cleanSheets: 0, goalsConceded: 0 };
}

/** 兼容旧存档：补齐生涯总计与分赛季历史 */
export function ensurePlayerHistory(p) {
  if (!p.stats) p.stats = emptyMatchStats();
  if (!p.career) {
    p.career = { ...emptyMatchStats() };
  } else {
    const e = emptyMatchStats();
    for (const k of Object.keys(e)) {
      if (p.career[k] == null) p.career[k] = 0;
    }
  }
  if (!Array.isArray(p.history)) p.history = [];
  return p;
}

/**
 * 赛季结束归档：当前 stats 写入 history + 累加 career，再清零本赛季
 * @param season 刚结束的赛季年份
 */
export function archiveAndResetSeasonStats(p, season, clubId, clubName) {
  ensurePlayerHistory(p);
  const s = p.stats || emptyMatchStats();
  const hasData =
    s.apps > 0 ||
    s.goals > 0 ||
    s.assists > 0 ||
    s.cleanSheets > 0 ||
    s.goalsConceded > 0;

  if (hasData) {
    // 同赛季同队不重复归档（防止重复点下一赛季）
    const dup = p.history.some(
      (h) => h.season === season && h.clubId === clubId && h.apps === s.apps && h.goals === s.goals
    );
    if (!dup) {
      p.history.push({
        season,
        clubId: clubId || p.clubId || null,
        clubName: clubName || "",
        apps: s.apps || 0,
        goals: s.goals || 0,
        assists: s.assists || 0,
        cleanSheets: s.cleanSheets || 0,
        goalsConceded: s.goalsConceded || 0,
      });
      p.career.apps += s.apps || 0;
      p.career.goals += s.goals || 0;
      p.career.assists += s.assists || 0;
      p.career.cleanSheets += s.cleanSheets || 0;
      p.career.goalsConceded += s.goalsConceded || 0;
    }
  }

  p.stats = emptyMatchStats();
  p.fitness = Math.min(100, Math.max(80, p.fitness || 90));
  p.injured = 0;
}

/** @deprecated 使用 archiveAndResetSeasonStats；无赛季信息时仅清零 */
export function resetSeasonStats(p) {
  ensurePlayerHistory(p);
  p.stats = emptyMatchStats();
  p.fitness = Math.min(100, Math.max(80, p.fitness || 90));
  p.injured = 0;
}

export function createPlayer(pos, power = 65, clubId = null, opts = {}) {
  const isYouth = !!opts.youth;
  const mean = power / 5; // 约 12–16 落在 1–20
  const spread = isYouth ? 1.8 : 2.2;
  const g = () => clamp(gauss(mean, spread));

  const attrs = {
    pace: g(),
    shooting: g(),
    passing: g(),
    dribbling: g(),
    defending: g(),
    physical: g(),
    // 细分
    finishing: g(),
    tackling: g(),
    marking: g(),
    strength: g(),
    stamina: g(),
    vision: g(),
    reflexes: g(),
    handling: g(),
    positioning: g(),
    kicking: g(),
  };

  // 位置偏向
  if (pos === "GK") {
    attrs.reflexes = clamp(attrs.reflexes + 3);
    attrs.handling = clamp(attrs.handling + 3);
    attrs.positioning = clamp(attrs.positioning + 2);
    attrs.shooting = clamp(attrs.shooting - 4);
  } else if (pos === "DEF") {
    attrs.tackling = clamp(attrs.tackling + 3);
    attrs.marking = clamp(attrs.marking + 2);
    attrs.strength = clamp(attrs.strength + 1);
  } else if (pos === "MID") {
    attrs.passing = clamp(attrs.passing + 2);
    attrs.vision = clamp(attrs.vision + 2);
    attrs.stamina = clamp(attrs.stamina + 1);
  } else {
    attrs.shooting = clamp(attrs.shooting + 2);
    attrs.finishing = clamp(attrs.finishing + 3);
    attrs.dribbling = clamp(attrs.dribbling + 1);
    attrs.pace = clamp(attrs.pace + 1);
  }

  const age = isYouth ? rand(15, 18) : rand(17, 34);
  const nation = pick(NATIONALITIES);
  const p = {
    id: uid(isYouth ? "yt" : "pl"),
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    pos,
    age,
    nationality: nation.code,
    nationName: nation.name,
    nationFlag: nation.flag,
    attrs,
    fitness: rand(85, 100),
    morale: rand(55, 85),
    clubId,
    injured: 0,
    fromYouth: isYouth,
    // 本赛季数据
    stats: emptyMatchStats(),
    // 生涯总计（跨赛季累计）
    career: emptyMatchStats(),
    // 分赛季历史 [{ season, clubId, clubName, apps, goals, ... }]
    history: [],
    // 国家队
    intl: { caps: 0, goals: 0, assists: 0, cleanSheets: 0, goalsConceded: 0 },
    // 个人荣誉
    honors: [],
  };
  p.ovr = playerOverall(p);
  // 潜力：青年略高于当前，成年接近当前
  if (isYouth) {
    const potBoost = rand(2, 7);
    p.potential = clamp(p.ovr + potBoost, p.ovr, 20);
  } else {
    p.potential = clamp(p.ovr + rand(0, 2), p.ovr, 20);
  }
  p.value = estimateValue(p);
  p.wage = isYouth ? Math.max(200, Math.round(estimateWage(p) * 0.25)) : estimateWage(p);
  // 合同年限（职业）
  p.contractYears = isYouth ? rand(1, 2) : rand(1, 4);
  p._needsRenew = false;
  return p;
}

/** 青训营等级费用与容量 */
export const YOUTH_LEVELS = {
  1: { name: "基础青训", capacity: 8, intake: 1, growth: 0.08, upkeep: 15_000 },
  2: { name: "地区青训", capacity: 10, intake: 1, growth: 0.11, upkeep: 35_000 },
  3: { name: "专业学院", capacity: 12, intake: 2, growth: 0.15, upkeep: 70_000 },
  4: { name: "精英学院", capacity: 14, intake: 2, growth: 0.2, upkeep: 120_000 },
  5: { name: "世界级学院", capacity: 16, intake: 3, growth: 0.26, upkeep: 200_000 },
};

export const YOUTH_UPGRADE_COST = {
  2: 2_000_000,
  3: 5_000_000,
  4: 12_000_000,
  5: 25_000_000,
};

export function ensureYouthAcademy(club) {
  if (!club.youth) {
    club.youth = {
      level: 1,
      players: [],
      daysSinceIntake: 0,
    };
  }
  if (!Array.isArray(club.youth.players)) club.youth.players = [];
  return club.youth;
}

export function createYouthPlayer(club) {
  ensureYouthAcademy(club);
  const level = club.youth.level || 1;
  const cfg = YOUTH_LEVELS[level] || YOUTH_LEVELS[1];
  // 实力与俱乐部+青训等级挂钩
  const power = Math.max(40, club.power - 18 + level * 3 + rand(-4, 6));
  const pos = pick(["GK", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT"]);
  const p = createPlayer(pos, power, club.id, { youth: true });
  // 高等级更容易出高潜力
  if (Math.random() < 0.08 + level * 0.04) {
    p.potential = clamp(p.potential + rand(1, 3), p.potential, 20);
  }
  p.ovr = playerOverall(p);
  p.value = estimateValue(p);
  return p;
}

export function fillYouthSquad(club, count = null) {
  const ya = ensureYouthAcademy(club);
  const cfg = YOUTH_LEVELS[ya.level] || YOUTH_LEVELS[1];
  const target = count ?? Math.min(cfg.capacity, 4 + ya.level);
  while (ya.players.length < target) {
    ya.players.push(createYouthPlayer(club));
  }
  return ya.players;
}

const SQUAD_SHAPE = [
  ...Array(2).fill("GK"),
  ...Array(6).fill("DEF"),
  ...Array(6).fill("MID"),
  ...Array(5).fill("ATT"),
];

export function createClub(template) {
  const players = SQUAD_SHAPE.map((pos) => {
    const jitter = rand(-6, 6);
    return createPlayer(pos, template.power + jitter, template.id);
  });
  // 排序：主力能力略高
  players.sort((a, b) => b.ovr - a.ovr);

  const division = template.division || START_DIVISION;
  const club = {
    id: template.id,
    name: template.name,
    short: template.short,
    color: template.color,
    power: template.power,
    money: template.money,
    division,
    players,
    tactics: {
      formation: "4-3-3",
      style: "balanced",
      pressing: 3,
      tempo: 3,
      lineup: [], // player ids, 11 人，按阵型槽位
    },
    form: [], // W/D/L 最近
    youth: {
      level: division === 1 ? 2 : 1,
      players: [],
      daysSinceIntake: rand(0, 20),
    },
    staff: null, // create 后填充，避免循环依赖 staff.js
  };
  fillYouthSquad(club);
  // staff 在 createWorld / 读档时 ensureStaff
  return club;
}

export function autoLineup(club) {
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const used = new Set();
  const lineup = [];
  for (const slot of formation.slots) {
    const candidates = club.players
      .filter((p) => p.pos === slot.pos && !used.has(p.id) && p.injured <= 0)
      .sort((a, b) => {
        const sa = b.ovr * (b.fitness / 100) * (0.85 + b.morale / 500);
        const sb = a.ovr * (a.fitness / 100) * (0.85 + a.morale / 500);
        return sa - sb;
      });
    // 位置不够时用其他位置顶
    let pickP = candidates[0];
    if (!pickP) {
      pickP = club.players
        .filter((p) => !used.has(p.id) && p.injured <= 0)
        .sort((a, b) => b.ovr - a.ovr)[0];
    }
    if (pickP) {
      used.add(pickP.id);
      lineup.push(pickP.id);
    }
  }
  club.tactics.lineup = lineup;
  return lineup;
}

export function getLineupPlayers(club) {
  const map = new Map(club.players.map((p) => [p.id, p]));
  return club.tactics.lineup.map((id) => map.get(id)).filter(Boolean);
}

export function teamStrength(club) {
  let xi = getLineupPlayers(club);
  if (xi.length < 11) {
    autoLineup(club);
    xi = getLineupPlayers(club);
  }
  if (!xi.length) return club.power;
  const avgOvr = xi.reduce((s, p) => s + p.ovr, 0) / xi.length;
  const fit = xi.reduce((s, p) => s + p.fitness, 0) / xi.length / 100;
  const mor = xi.reduce((s, p) => s + p.morale, 0) / xi.length / 100;
  const t = club.tactics;
  const press = 0.96 + t.pressing * 0.015;
  return avgOvr * 5 * fit * (0.9 + mor * 0.2) * press;
}

/** 按级别生成并合并赛程（各级共用相同比赛日） */
export function generateAllDivisionFixtures(clubs) {
  const byDiv = { 1: [], 2: [], 3: [] };
  for (const c of clubs) {
    const d = c.division || 3;
    if (!byDiv[d]) byDiv[d] = [];
    byDiv[d].push(c.id);
  }
  const all = [];
  for (const d of [1, 2, 3]) {
    const ids = byDiv[d];
    if (!ids || ids.length < 2) continue;
    const fixtures = generateFixtures(ids);
    for (const f of fixtures) {
      f.division = d;
      all.push(f);
    }
  }
  // 按 day、division 排序，便于推进
  all.sort((a, b) => a.day - b.day || a.division - b.division);
  return all;
}

export function createWorld(userClubId, managerName) {
  resetIdCounter(1);
  const clubs = CLUB_TEMPLATES.map((t) => {
    const c = createClub(t);
    autoLineup(c);
    return c;
  });
  // staff 延迟到 main/engine ensure，避免 models↔staff 循环

  const user = clubs.find((c) => c.id === userClubId);
  if (!user) throw new Error("invalid club");
  // 开局只能选乙级
  if (user.division !== START_DIVISION) {
    user.division = START_DIVISION;
  }

  const fixtures = generateAllDivisionFixtures(clubs);
  const table = {};
  for (const c of clubs) {
    table[c.id] = { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  }

  const divName = DIVISIONS[user.division]?.name || "乙级联赛";

  const world = {
    version: 4,
    season: 2026,
    day: 1,
    managerName,
    userClubId,
    clubs,
    fixtures,
    table,
    seasonOver: false,
    retiredPlayers: [],
    freeAgents: [],
    media: [],
    cup: null, // engine/main 中 ensureCup
    news: [
      {
        day: 1,
        text: `${managerName} 正式执教 ${user.name}，从${divName}起步！每级 20 队 · 联赛杯跨级淘汰 · 注意球员合同年限。`,
      },
    ],
    matchIndex: 0,
  };
  return world;
}

export function clubsInDivision(clubs, division) {
  return clubs.filter((c) => (c.division || 3) === division);
}

export { DIVISIONS, START_DIVISION };

/** 双循环赛程：每轮 day 间隔 7 */
export function generateFixtures(clubIds) {
  // circle method for single round, then reverse for double
  const ids = [...clubIds];
  if (ids.length % 2 === 1) ids.push(null); // bye
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const single = [];

  const arr = [...ids];
  for (let r = 0; r < rounds; r++) {
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home && away) {
        // 轮流主客
        if (r % 2 === 0) pairs.push({ home, away });
        else pairs.push({ home: away, away: home });
      }
    }
    single.push(pairs);
    // rotate
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }

  const fixtures = [];
  let day = 3; // 赛季第 3 天开打
  let round = 1;
  for (const pairs of single) {
    for (const p of pairs) {
      fixtures.push({
        id: uid("fx"),
        round,
        day,
        home: p.home,
        away: p.away,
        homeGoals: null,
        awayGoals: null,
        played: false,
        events: [],
      });
    }
    round++;
    day += 7;
  }
  // 下半程换主客
  const firstHalfCount = fixtures.length;
  for (let i = 0; i < firstHalfCount; i++) {
    const f = fixtures[i];
    fixtures.push({
      id: uid("fx"),
      round,
      day,
      home: f.away,
      away: f.home,
      homeGoals: null,
      awayGoals: null,
      played: false,
      events: [],
    });
    // 同一轮多场同一天；每轮结束后 +7
    if ((i + 1) % (clubIds.length / 2) === 0) {
      round++;
      day += 7;
    }
  }

  // 修正：按 round 重排 day
  const byRound = new Map();
  for (const f of fixtures) {
    if (!byRound.has(f.round)) byRound.set(f.round, []);
    byRound.get(f.round).push(f);
  }
  let d = 3;
  const roundsSorted = [...byRound.keys()].sort((a, b) => a - b);
  // 重新编号 round 与 day
  let rn = 1;
  const out = [];
  for (const r of roundsSorted) {
    for (const f of byRound.get(r)) {
      out.push({ ...f, round: rn, day: d });
    }
    rn++;
    d += 7;
  }
  return out;
}

export function formatMoney(n) {
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `€${(n / 1_000).toFixed(0)}K`;
  return `€${n}`;
}

export { CLUB_TEMPLATES, FORMATIONS, rand, pick };
