/** 球员 / 球队生成 */

import {
  NATIONALITIES,
  CLUB_TEMPLATES,
  FORMATIONS,
  DIVISIONS,
  START_DIVISION,
  generatePlayerName,
  PLAYER_ROLES,
  ROLES_BY_POS,
  DEFAULT_ROLE_BY_POS,
  defaultRoleForSlot,
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
  return {
    apps: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    /** 本赛季评分合计（÷ apps = 场均） */
    ratingSum: 0,
    /** 最近一场评分 0–10 */
    lastRating: null,
  };
}

/** 本赛季场均评分；不足 1 场返回 null */
export function seasonAvgRating(p) {
  const s = p?.stats || emptyMatchStats();
  const apps = s.apps || 0;
  if (!apps || s.ratingSum == null || s.ratingSum <= 0) return null;
  return Math.round((s.ratingSum / apps) * 10) / 10;
}

/** 评分颜色档：≥7.5 高 / ≥6.5 中 / 其余低 */
export function ratingClass(r) {
  if (r == null || Number.isNaN(r)) return "";
  if (r >= 7.5) return "rating-high";
  if (r >= 6.5) return "rating-mid";
  if (r >= 5.5) return "rating-ok";
  return "rating-low";
}

export function formatRating(r) {
  if (r == null || Number.isNaN(r)) return "—";
  return Number(r).toFixed(1);
}

/** 兼容旧存档：补齐生涯总计与分赛季历史 */
export function ensurePlayerHistory(p) {
  if (!p.stats) p.stats = emptyMatchStats();
  else {
    const e = emptyMatchStats();
    for (const k of Object.keys(e)) {
      if (p.stats[k] == null) p.stats[k] = e[k];
    }
  }
  if (!p.career) {
    p.career = { ...emptyMatchStats() };
  } else {
    const e = emptyMatchStats();
    for (const k of Object.keys(e)) {
      if (p.career[k] == null) p.career[k] = e[k];
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
      const avgR =
        s.apps > 0 && s.ratingSum > 0
          ? Math.round((s.ratingSum / s.apps) * 10) / 10
          : null;
      p.history.push({
        season,
        clubId: clubId || p.clubId || null,
        clubName: clubName || "",
        apps: s.apps || 0,
        goals: s.goals || 0,
        assists: s.assists || 0,
        cleanSheets: s.cleanSheets || 0,
        goalsConceded: s.goalsConceded || 0,
        avgRating: avgR,
      });
      p.career.apps += s.apps || 0;
      p.career.goals += s.goals || 0;
      p.career.assists += s.assists || 0;
      p.career.cleanSheets += s.cleanSheets || 0;
      p.career.goalsConceded += s.goalsConceded || 0;
      if (s.ratingSum > 0) {
        p.career.ratingSum = (p.career.ratingSum || 0) + s.ratingSum;
      }
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
    name: generatePlayerName(nation.code, pick),
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
    // 球衣号（入队时由 assignSquadNumbers 分配）
    number: null,
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
  assignSquadNumbers(club);
  return ya.players;
}


/** 球衣样式：solid / stripes / hoops / halves / sash */
export const KIT_STYLES = ["solid", "stripes", "hoops", "halves", "sash"];

/** 与 clubs.js 主题表同步；此处再列一份避免 models↔clubs 循环依赖 */
const KIT_THEME_BY_ID = {
  sunset: {
    primary: "#f97316",
    secondary: "#5b21b6",
    style: "sash",
    numberColor: "#ffffff",
  },
  harbor: {
    primary: "#0ea5e9",
    secondary: "#f8fafc",
    style: "stripes",
    numberColor: "#0f172a",
  },
  steel: {
    primary: "#64748b",
    secondary: "#dc2626",
    style: "halves",
    numberColor: "#ffffff",
  },
  mill: {
    primary: "#166534",
    secondary: "#eab308",
    style: "hoops",
    numberColor: "#ffffff",
  },
};

function hashStr(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function contrastText(hex) {
  if (!hex || typeof hex !== "string") return "#fff";
  const h = hex.replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#0f172a" : "#ffffff";
}

function shiftHex(hex, delta) {
  if (!hex || typeof hex !== "string") return "#64748b";
  const h = hex.replace("#", "");
  if (h.length < 6) return hex;
  const clamp255 = (n) => Math.max(0, Math.min(255, n));
  const r = clamp255(parseInt(h.slice(0, 2), 16) + delta);
  const g = clamp255(parseInt(h.slice(2, 4), 16) + delta);
  const b = clamp255(parseInt(h.slice(4, 6), 16) + delta);
  return (
    "#" +
    [r, g, b]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** 为俱乐部生成/补齐球衣配置 */
export function ensureKit(club) {
  if (!club) return null;
  // 主题队：始终覆盖（修正旧存档里落日城被随机成灰蓝的问题）
  const theme = club.id ? KIT_THEME_BY_ID[club.id] : null;
  if (theme) {
    club.color = theme.primary;
    club.kit = {
      style: theme.style || "solid",
      primary: theme.primary,
      secondary: theme.secondary || shiftHex(theme.primary, -50),
      numberColor: theme.numberColor || contrastText(theme.primary),
    };
    return club.kit;
  }
  if (club.kit && club.kit.primary && club.kit.style) {
    if (!club.kit.numberColor) club.kit.numberColor = contrastText(club.kit.primary);
    return club.kit;
  }
  const primary = club.color || "#3d8bfd";
  const h = hashStr(club.id || club.name || "club");
  const style = KIT_STYLES[h % KIT_STYLES.length];
  const secondary =
    style === "solid" ? shiftHex(primary, 40) : shiftHex(primary, h % 2 === 0 ? -55 : 70);
  club.kit = {
    style,
    primary,
    secondary,
    numberColor: contrastText(primary),
  };
  return club.kit;
}

/** CSS background for kit preview */
export function kitBackground(kit) {
  if (!kit) return "#3d8bfd";
  const a = kit.primary || "#3d8bfd";
  const b = kit.secondary || "#1e293b";
  switch (kit.style) {
    case "stripes":
      return `repeating-linear-gradient(90deg, ${a} 0 6px, ${b} 6px 12px)`;
    case "hoops":
      return `repeating-linear-gradient(0deg, ${a} 0 6px, ${b} 6px 12px)`;
    case "halves":
      return `linear-gradient(90deg, ${a} 50%, ${b} 50%)`;
    case "sash":
      return `linear-gradient(135deg, ${a} 40%, ${b} 40%, ${b} 55%, ${a} 55%)`;
    default:
      return a;
  }
}

/** 位置默认号段偏好 */
function preferredNumbers(pos) {
  if (pos === "GK") return [1, 13, 23, 25, 31];
  if (pos === "DEF") return [2, 3, 4, 5, 6, 12, 14, 15, 16, 22, 24, 26, 32];
  if (pos === "MID") return [6, 7, 8, 10, 11, 14, 16, 17, 18, 20, 21, 28, 30];
  return [7, 9, 10, 11, 14, 17, 18, 19, 21, 27, 29, 33, 99];
}

/** 给俱乐部全员分配不重复球衣号（缺号才补） */
export function assignSquadNumbers(club) {
  if (!club || !Array.isArray(club.players)) return;
  ensureKit(club);
  const used = new Set();
  for (const p of club.players) {
    if (p.number != null && p.number >= 1 && p.number <= 99) used.add(p.number);
  }
  // 已有号的不动；缺号按能力优先占号
  const need = club.players
    .filter((p) => p.number == null || p.number < 1 || p.number > 99)
    .sort((a, b) => (b.ovr || 0) - (a.ovr || 0));

  for (const p of need) {
    let num = null;
    for (const cand of preferredNumbers(p.pos)) {
      if (!used.has(cand)) {
        num = cand;
        break;
      }
    }
    if (num == null) {
      for (let n = 1; n <= 99; n++) {
        if (!used.has(n)) {
          num = n;
          break;
        }
      }
    }
    p.number = num || 99;
    used.add(p.number);
  }
  // 青训也补号（可与一线重复显示，但尽量不重复本队）
  const ya = club.youth?.players;
  if (Array.isArray(ya)) {
    for (const p of ya) {
      if (p.number != null && p.number >= 1 && p.number <= 99) continue;
      let num = null;
      for (const cand of preferredNumbers(p.pos)) {
        if (!used.has(cand)) {
          num = cand;
          break;
        }
      }
      if (num == null) {
        for (let n = 40; n <= 99; n++) {
          if (!used.has(n)) {
            num = n;
            break;
          }
        }
      }
      p.number = num || (40 + Math.floor(Math.random() * 50));
      used.add(p.number);
    }
  }
}

export function ensurePlayerNumber(club, player) {
  if (!player) return null;
  if (player.number != null && player.number >= 1 && player.number <= 99) return player.number;
  if (club) assignSquadNumbers(club);
  if (player.number != null) return player.number;
  // 无俱乐部上下文：按位置给个默认
  const prefs = preferredNumbers(player.pos);
  player.number = prefs[0] || 99;
  return player.number;
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
    tactics: defaultTactics(),
    form: [], // W/D/L 最近
    youth: {
      level: division === 1 ? 2 : 1,
      players: [],
      daysSinceIntake: rand(0, 20),
    },
    staff: null, // create 后填充，避免循环依赖 staff.js
    kit: null,
    training: { focus: "balanced", intensity: "normal" },
    facilities: null, // ensureFacilities 时按联赛补默认
  };
  ensureKit(club);
  fillYouthSquad(club);
  assignSquadNumbers(club);
  // staff / training / facilities 在 createWorld / 读档时 ensure
  return club;
}

function playerSelectable(p) {
  if (!p) return false;
  if ((p.injured || 0) > 0) return false;
  if ((p.suspendedMatches || 0) > 0) return false;
  return true;
}

/** 默认战术（含宽度 / 防线 / 槽位角色） */
export function defaultTactics() {
  return {
    formation: "4-3-3",
    style: "balanced",
    pressing: 3,
    tempo: 3,
    width: 3,
    defensiveLine: 3,
    lineup: [],
    /** 与 lineup 等长：每槽角色 id（见 data.PLAYER_ROLES） */
    roles: [],
    /**
     * 核心球员 id（梅西/C罗/内马尔式「进攻绝对权」）
     * 须在首发中；null 表示未指定
     */
    corePlayerId: null,
  };
}

/** 读/校验核心球员：不在首发则清空 */
export function getCorePlayerId(club) {
  ensureTactics(club);
  const id = club.tactics.corePlayerId || null;
  if (!id) return null;
  const xi = new Set(club.tactics.lineup || []);
  if (!xi.has(id)) {
    club.tactics.corePlayerId = null;
    return null;
  }
  return id;
}

/**
 * 从首发里自动挑「进攻核心」：中前场优先，综合射门/盘带/速度/总评
 * 主客队共用，避免只有用户队有绝对进攻权
 */
export function pickAutoCorePlayerId(club) {
  ensureTactics(club);
  const map = new Map((club.players || []).map((p) => [p.id, p]));
  const xi = (club.tactics.lineup || []).map((id) => map.get(id)).filter(Boolean);
  if (!xi.length) return null;
  let best = null;
  let bestScore = -1;
  for (const p of xi) {
    if (!p || p.pos === "GK") continue;
    const a = p.attrs || {};
    const posB = p.pos === "ATT" ? 1.25 : p.pos === "MID" ? 1.1 : 0.75;
    const skill =
      (a.finishing || 10) * 0.28 +
      (a.shooting || 10) * 0.22 +
      (a.dribbling || 10) * 0.28 +
      (a.pace || 10) * 0.12 +
      (a.passing || 10) * 0.1;
    const score = (skill + (p.ovr || 10) * 0.35) * posB;
    if (score > bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

/**
 * 保证有核心：已设置且在首发则保留；否则自动指定
 * 主客队开赛前都应调用，避免单方面才有梅西/C罗式行为
 * @param {object} club
 * @param {{ force?: boolean }} [opts] force=true 时即使已有也重算
 */
export function ensureCorePlayer(club, { force = false } = {}) {
  ensureTactics(club);
  if (!force) {
    const cur = getCorePlayerId(club);
    if (cur) return cur;
  }
  const id = pickAutoCorePlayerId(club);
  club.tactics.corePlayerId = id;
  return id;
}

/** 设置核心球员（点同一人可取消） */
export function setCorePlayerId(club, playerId) {
  ensureTactics(club);
  if (!playerId) {
    club.tactics.corePlayerId = null;
    return { ok: true, corePlayerId: null };
  }
  const xi = club.tactics.lineup || [];
  if (!xi.includes(playerId)) {
    return { ok: false, msg: "核心球员须在首发十一人中" };
  }
  if (club.tactics.corePlayerId === playerId) {
    club.tactics.corePlayerId = null;
    return { ok: true, corePlayerId: null, cleared: true };
  }
  club.tactics.corePlayerId = playerId;
  return { ok: true, corePlayerId: playerId };
}

/**
 * 规范化 / 补齐槽位角色数组（不回调 ensureTactics，避免循环）
 * @param {object} club
 * @param {{ reset?: boolean }} [opts] reset=true 时按阵型重写默认角色
 */
export function ensureLineupRoles(club, { reset = false } = {}) {
  if (!club?.tactics) return [];
  const t = club.tactics;
  const formation = FORMATIONS[t.formation] || FORMATIONS["4-3-3"];
  const slots = formation.slots || [];
  const need = slots.length;
  if (!Array.isArray(t.roles)) t.roles = [];
  if (reset || t.roles.length !== need) {
    const next = [];
    for (let i = 0; i < need; i++) {
      const prev = !reset && t.roles[i];
      if (prev && PLAYER_ROLES[prev] && PLAYER_ROLES[prev].pos === slots[i].pos) {
        next.push(prev);
      } else {
        next.push(defaultRoleForSlot(slots[i], i, slots));
      }
    }
    t.roles = next;
  } else {
    for (let i = 0; i < need; i++) {
      const rid = t.roles[i];
      const slot = slots[i];
      if (!PLAYER_ROLES[rid] || PLAYER_ROLES[rid].pos !== slot.pos) {
        t.roles[i] = defaultRoleForSlot(slot, i, slots);
      }
    }
  }
  return t.roles;
}

/** 读档补齐战术字段 */
export function ensureTactics(club) {
  if (!club) return null;
  const d = defaultTactics();
  if (!club.tactics || typeof club.tactics !== "object") {
    club.tactics = { ...d };
  } else {
    const t = club.tactics;
    if (!t.formation || !FORMATIONS[t.formation]) t.formation = d.formation;
    if (!t.style) t.style = d.style;
    if (t.pressing == null) t.pressing = d.pressing;
    if (t.tempo == null) t.tempo = d.tempo;
    if (t.width == null) t.width = d.width;
    if (t.defensiveLine == null) t.defensiveLine = d.defensiveLine;
    if (!Array.isArray(t.lineup)) t.lineup = [];
    if (!Array.isArray(t.roles)) t.roles = [];
    if (t.corePlayerId === undefined) t.corePlayerId = null;
    t.pressing = Math.max(1, Math.min(5, +t.pressing || 3));
    t.tempo = Math.max(1, Math.min(5, +t.tempo || 3));
    t.width = Math.max(1, Math.min(5, +t.width || 3));
    t.defensiveLine = Math.max(1, Math.min(5, +t.defensiveLine || 3));
  }
  ensureLineupRoles(club);
  // 核心须在首发
  if (club.tactics.corePlayerId) {
    const xi = new Set(club.tactics.lineup || []);
    if (!xi.has(club.tactics.corePlayerId)) club.tactics.corePlayerId = null;
  }
  return club.tactics;
}

/** 设置某槽角色 */
export function setSlotRole(club, slotIndex, roleId) {
  ensureTactics(club);
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const slots = formation.slots || [];
  const idx = +slotIndex;
  if (!Number.isFinite(idx) || idx < 0 || idx >= slots.length) {
    return { ok: false, msg: "无效槽位" };
  }
  ensureLineupRoles(club);
  const role = PLAYER_ROLES[roleId];
  if (!role || role.pos !== slots[idx].pos) {
    return { ok: false, msg: "角色与位置不匹配" };
  }
  club.tactics.roles[idx] = roleId;
  return { ok: true, roleId };
}

/** 取槽位角色 id */
export function getSlotRole(club, slotIndex) {
  ensureTactics(club);
  ensureLineupRoles(club);
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  return (
    club.tactics.roles?.[slotIndex] ||
    defaultRoleForSlot(formation.slots[slotIndex], slotIndex, formation.slots)
  );
}

/**
 * 球员在首发中的角色（按 lineup 下标）
 * @returns {string|null}
 */
export function roleIdForPlayer(club, playerId) {
  if (!club?.tactics || !playerId) return null;
  ensureTactics(club);
  ensureLineupRoles(club);
  const i = (club.tactics.lineup || []).indexOf(playerId);
  if (i < 0) return null;
  return club.tactics.roles[i] || null;
}

/** 角色定义对象 */
export function roleDefForPlayer(club, playerId) {
  const id = roleIdForPlayer(club, playerId);
  return id ? PLAYER_ROLES[id] || null : null;
}

/**
 * 汇总首发角色对球队侧的微量修正
 * @returns {{ atk: number, def: number, poss: number, foul: number, chance: number, fit: number }}
 */
export function teamRoleMods(club) {
  ensureTactics(club);
  ensureLineupRoles(club);
  const mods = { atk: 1, def: 1, poss: 1, foul: 1, chance: 1, fit: 1 };
  const roles = club.tactics.roles || [];
  if (!roles.length) return mods;
  let atk = 0;
  let def = 0;
  let poss = 0;
  let foul = 0;
  let chance = 0;
  let fit = 0;
  let n = 0;
  for (const rid of roles) {
    const r = PLAYER_ROLES[rid];
    if (!r) continue;
    n++;
    atk += r.atk || 0;
    def += r.def || 0;
    poss += r.poss || 0;
    foul += r.foul || 0;
    chance += r.chance || 0;
    fit += r.fit || 0;
  }
  if (!n) return mods;
  // 平均后再收敛：整队大约 ±6% 内
  const scale = 0.55;
  mods.atk = 1 + (atk / n) * scale;
  mods.def = 1 + (def / n) * scale;
  mods.poss = 1 + (poss / n) * scale;
  mods.foul = 1 + (foul / n) * scale;
  mods.chance = 1 + (chance / n) * scale;
  mods.fit = 1 + (fit / n) * scale;
  return mods;
}

function xiSortScore(p) {
  return (p.ovr || 10) * ((p.fitness || 100) / 100) * (0.85 + (p.morale || 70) / 500);
}

export function autoLineup(club) {
  ensureTactics(club);
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const used = new Set();
  const lineup = [];
  for (const slot of formation.slots) {
    const candidates = club.players
      .filter((p) => p.pos === slot.pos && !used.has(p.id) && playerSelectable(p))
      .sort((a, b) => xiSortScore(b) - xiSortScore(a));
    let pickP = candidates[0];
    if (!pickP) {
      pickP = club.players
        .filter((p) => !used.has(p.id) && playerSelectable(p))
        .sort((a, b) => (b.ovr || 0) - (a.ovr || 0))[0];
    }
    if (pickP) {
      used.add(pickP.id);
      lineup.push(pickP.id);
    }
  }
  club.tactics.lineup = lineup;
  ensureLineupRoles(club, { reset: true });
  return lineup;
}

/**
 * 把已有首发名单对齐到阵型槽：优先同位置，GK 槽强制尽量是门将。
 * 供 matchview / SimEngine 共用，避免「球门前没人」。
 * @param {object[]} xi
 * @param {{ pos: string }[]} slots
 * @returns {(object|null)[]}
 */
export function assignPlayersToFormationSlots(xi, slots) {
  const pool = (xi || []).filter(Boolean);
  const used = new Set();
  const out = [];
  for (const slot of slots || []) {
    let p =
      pool.find((x) => !used.has(x.id) && x.pos === slot.pos) ||
      (slot.pos === "GK" ? pool.find((x) => !used.has(x.id) && x.pos === "GK") : null) ||
      pool.find((x) => !used.has(x.id));
    if (p) used.add(p.id);
    out.push(p || null);
  }
  return out;
}

/**
 * 保留用户已选首发：仅替换伤停/不存在/人数不足的位置
 * AI 队或 lineup 空时退回 autoLineup
 */
export function ensureMatchLineup(club, { forceAuto = false } = {}) {
  ensureTactics(club);
  if (forceAuto || !club.tactics.lineup?.length) {
    return autoLineup(club);
  }
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const need = formation.slots.length;
  const map = new Map((club.players || []).map((p) => [p.id, p]));
  const used = new Set();
  const next = [];

  for (let i = 0; i < need; i++) {
    const id = club.tactics.lineup[i];
    const p = id ? map.get(id) : null;
    if (p && playerSelectable(p) && !used.has(p.id)) {
      used.add(p.id);
      next.push(p.id);
      continue;
    }
    const slot = formation.slots[i];
    const candidates = club.players
      .filter((x) => x.pos === slot.pos && !used.has(x.id) && playerSelectable(x))
      .sort((a, b) => xiSortScore(b) - xiSortScore(a));
    let pickP = candidates[0];
    if (!pickP) {
      pickP = club.players
        .filter((x) => !used.has(x.id) && playerSelectable(x))
        .sort((a, b) => (b.ovr || 0) - (a.ovr || 0))[0];
    }
    if (pickP) {
      used.add(pickP.id);
      next.push(pickP.id);
    }
  }
  club.tactics.lineup = next;
  ensureLineupRoles(club);
  return next;
}

export function getLineupPlayers(club) {
  ensureTactics(club);
  const map = new Map(club.players.map((p) => [p.id, p]));
  return (club.tactics.lineup || []).map((id) => map.get(id)).filter(Boolean);
}

/** 替补席（不在首发且可选） */
export function getBenchForTactics(club) {
  ensureTactics(club);
  const xi = new Set(club.tactics.lineup || []);
  return (club.players || [])
    .filter((p) => p && !xi.has(p.id) && playerSelectable(p))
    .sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
}

/**
 * 互换两个首发槽位
 * @returns {{ ok: boolean, msg?: string }}
 */
export function swapLineupSlots(club, slotA, slotB) {
  ensureTactics(club);
  const lineup = club.tactics.lineup || [];
  const a = +slotA;
  const b = +slotB;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    return { ok: false, msg: "无效槽位" };
  }
  if (a < 0 || b < 0 || a >= lineup.length || b >= lineup.length) {
    return { ok: false, msg: "槽位越界" };
  }
  const tmp = lineup[a];
  lineup[a] = lineup[b];
  lineup[b] = tmp;
  club.tactics.lineup = lineup;
  // 角色挂在槽位上：换人不换职责（更接近「这个位置怎么踢」）
  ensureLineupRoles(club);
  return { ok: true };
}

/**
 * 把球员放入指定首发槽（替补上场 / 槽位替换）
 * - 若球员已在首发其他槽：与目标槽互换
 * - 若在替补：替换目标槽原球员（原球员下替补）
 * @returns {{ ok: boolean, msg?: string, outOfPos?: boolean }}
 */
export function setLineupSlot(club, slotIndex, playerId) {
  ensureTactics(club);
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const need = formation.slots.length;
  let lineup = [...(club.tactics.lineup || [])];
  while (lineup.length < need) lineup.push(null);

  const idx = +slotIndex;
  if (!Number.isFinite(idx) || idx < 0 || idx >= need) {
    return { ok: false, msg: "无效槽位" };
  }
  const map = new Map((club.players || []).map((p) => [p.id, p]));
  const player = map.get(playerId);
  if (!player) return { ok: false, msg: "找不到球员" };
  if (!playerSelectable(player)) {
    return { ok: false, msg: "该球员不可用（伤停）" };
  }

  const existing = lineup.indexOf(playerId);
  if (existing === idx) return { ok: true, msg: "无变化" };
  if (existing >= 0) {
    // 已在首发：互换
    const tmp = lineup[idx];
    lineup[idx] = playerId;
    lineup[existing] = tmp;
  } else {
    // 替补顶上：直接替换该槽
    lineup[idx] = playerId;
  }
  club.tactics.lineup = lineup.filter((id, i) => i < need);
  ensureLineupRoles(club);
  const slotPos = formation.slots[idx]?.pos;
  const outOfPos = slotPos && player.pos && player.pos !== slotPos;
  return { ok: true, outOfPos, slotPos, playerPos: player.pos };
}

export function teamStrength(club) {
  ensureTactics(club);
  let xi = getLineupPlayers(club);
  if (xi.length < 11) {
    ensureMatchLineup(club);
    xi = getLineupPlayers(club);
  }
  if (!xi.length) return club.power;
  const avgOvr = xi.reduce((s, p) => s + p.ovr, 0) / xi.length;
  const fit = xi.reduce((s, p) => s + p.fitness, 0) / xi.length / 100;
  const mor = xi.reduce((s, p) => s + p.morale, 0) / xi.length / 100;
  // 压迫不再双重计入实力；体能/士气为主
  return avgOvr * 5 * fit * (0.9 + mor * 0.2);
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
    version: 6,
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
    poachBids: [],
    managerCareer: {
      seasons: 0,
      matches: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      titles: 0,
      promotions: 0,
      relegations: 0,
      cups: 0,
      sacked: 0,
      bestFinish: null,
      trophies: [],
    },
    lastSeasonSummary: null,
    news: [
      {
        day: 1,
        text: `${managerName} 正式执教 ${user.name}，从${divName}起步！每级 20 队 · VCFM 杯跨级淘汰 · 注意球员合同年限。`,
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
