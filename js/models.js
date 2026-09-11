/** 球员 / 球队生成 */

import {
  NATIONALITIES,
  NATIONAL_TEAM_BASE_STRENGTH,
  CLUB_TEMPLATES,
  clubBrandingById,
  FORMATIONS,
  DIVISIONS,
  DIVISION_IDS,
  START_DIVISION,
  START_DIVISIONS,
  generatePlayerName,
  NAMES_BY_NATION,
  PLAYER_ROLES,
  defaultRoleForSlot,
} from "./data.js";
import { applyClubBranding, fictionalizePlayerName } from "./branding.js";
import { CURRENT_SAVE_SCHEMA_VERSION } from "./save-schema.js";
import { recordPlayerDevelopment } from "./player-pathway.js";
import {
  ensurePlayerPositionProfile,
  positionCoverage,
  positionFitForSlot,
  positionGroup,
  slotPositionCode,
} from "./player-positions.js";
import { ensurePlayerHabits } from "./player-habits.js";
import {
  ensurePlayerAttributeProfile,
  generatePlayerAttributes,
  normalizePlayerAttributeCoherence,
  weightedDevelopmentAttributes,
} from "./player-attributes.js";
export { ensurePlayerAttributeProfile } from "./player-attributes.js";
import {
  normalizeDutyForRole,
  roleFitsPosition,
} from "./player-roles.js";
import {
  assignSquadNumbers,
  ensurePlayerNumber,
  ensurePlayerNumberPreferences,
  numberPreferenceLabel,
  registerSquadNumbers,
} from "./squad-numbers.js";
export { assignSquadNumbers, ensurePlayerNumber, ensurePlayerNumberPreferences, numberPreferenceLabel, registerSquadNumbers, setSquadNumber } from "./squad-numbers.js";
import {
  APPEARANCE_HAIR_COLORS as SHARED_APPEARANCE_HAIR_COLORS,
  APPEARANCE_HAIR_STYLE_IDS as SHARED_APPEARANCE_HAIR_STYLE_IDS,
  APPEARANCE_HAIR_STYLE_NAMES as SHARED_APPEARANCE_HAIR_STYLE_NAMES,
  APPEARANCE_SKIN_TONES as SHARED_APPEARANCE_SKIN_TONES,
  generatePlayerAppearance as generateSharedPlayerAppearance,
  normalizeHairColor as normalizeSharedHairColor,
  normalizeHairStyleId as normalizeSharedHairStyleId,
  normalizeSkinTone as normalizeSharedSkinTone,
} from "./appearance.js";

let _id = 1;
/**
 * 只由计数器和 Math.random 决定：id 既被当作稳定种子 hash（报名背景见
 * squad-registration.js），又被大量排序拿来做同分兜底，而审计靠种子化的
 * Math.random 复现整个世界，掺进时间戳会让同一份存档每次跑出不同结果。
 */
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

function stableNameIndex(seed, length) {
  if (!length) return 0;
  let hash = 2166136261;
  for (const ch of String(seed || "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function playerNameIdentity(player) {
  const pool = NAMES_BY_NATION[player?.nationality];
  const order = pool?.order || "given-family";
  const parts = String(player?.name || "").trim().split(/\s+/).filter(Boolean);
  const parsed = parts.length < 2
    ? { order, given: parts[0] || "", family: "" }
    : order === "family-given"
    ? { order, given: parts.slice(1).join(" "), family: parts[0] }
    : { order, given: parts[0], family: parts.slice(1).join(" ") };
  if (!pool || (pool.first.includes(parsed.given) && pool.last.includes(parsed.family))) return parsed;
  // 公开姓名可能来自 branding.js 的真实姓名替换；反查原始池，避免迁移时误改名。
  for (const given of pool.first) {
    for (const family of pool.last) {
      const source = order === "family-given" ? `${family} ${given}` : `${given} ${family}`;
      if (fictionalizePlayerName(source) === player?.name) return { order, given, family };
    }
  }
  return parsed;
}

function stableNamePicker(player) {
  const identity = playerNameIdentity(player);
  let call = 0;
  return (items) => {
    const desired = call++ === 0 ? identity.given : identity.family;
    return items.includes(desired)
      ? desired
      : items[stableNameIndex(`${player?.id || player?.name}:${call}`, items.length)];
  };
}

/** 修复旧档同队姓名冲突；稳定保留已有姓名，只有发生名/姓碰撞时才换名。 */
export function ensureDistinctClubPlayerNames(club) {
  if (!club) return 0;
  const players = [...(club.players || []), ...(club.youth?.players || [])];
  const usedNames = new Set();
  let changed = 0;
  for (const player of players) {
    const next = generatePlayerName(player.nationality, stableNamePicker(player), { usedNames });
    if (next !== player.name) {
      player.name = next;
      changed++;
    }
    usedNames.add(player.name);
  }
  return changed;
}

const TALENT_MODEL_VERSION = 1;
const TALENT_REFERENCE = 18;
const TALENT_SCALE = 1;
const FOOTBALL_PROFILE_VERSION = 1;
const VALID_FEET = new Set(["right", "left", "both"]);

function clampNumber(v, a, b) {
  return Math.max(a, Math.min(b, Math.round(v)));
}

/** 将现实国家队层级温和映射到个人属性，不覆盖俱乐部自身的实力档位。 */
export function nationalTalentOffset(code) {
  const strength = NATIONAL_TEAM_BASE_STRENGTH[code];
  return Number.isFinite(strength) ? (strength - TALENT_REFERENCE) * TALENT_SCALE : 0;
}

/**
 * 各国联赛现实中的主要外援来源（语言、殖民史、地理与转会走廊）。
 * 只影响外籍球员来自哪国，不改任何人的能力——葡超该有巴西人，
 * 荷甲该有比利时与北欧人，而不是全球国籍平均抽签。
 */
const RECRUITMENT_CORRIDORS = Object.freeze({
  ENG: { IRL: 3.2, SCO: 3.0, WAL: 2.6, FRA: 1.8, NED: 1.6, BEL: 1.5, POR: 1.4, BRA: 1.3, ESP: 1.2 },
  ESP: { ARG: 3.4, BRA: 2.6, POR: 2.0, URU: 2.0, FRA: 1.6, ITA: 1.2 },
  GER: { AUT: 3.2, SUI: 2.8, POL: 2.6, TUR: 2.4, SRB: 2.0, CRO: 1.9, NED: 1.6, BRA: 1.3 },
  ITA: { ARG: 2.6, BRA: 2.4, CRO: 2.0, SRB: 1.9, FRA: 1.7, ESP: 1.3 },
  FRA: { BEL: 2.4, POR: 2.2, BRA: 1.8, ESP: 1.5, ITA: 1.3, NED: 1.2 },
  NED: { BEL: 3.4, DEN: 2.2, SWE: 2.0, NOR: 1.9, GER: 1.8, BRA: 1.6, POR: 1.3 },
  POR: { BRA: 4.2, ARG: 2.2, ESP: 1.8, URU: 1.6, FRA: 1.3 },
});

function pickPlayerNation(homeNation, isYouth, power) {
  const home = NATIONALITIES.find((nation) => nation.code === homeNation);
  if (home) {
    // 低级别球队更依赖本土球员；青训营以本地培养为主。
    const seniorHomeChance = Math.max(0.45, Math.min(0.68, 0.62 - (power - 55) * 0.005));
    if (Math.random() < (isYouth ? 0.72 : seniorHomeChance)) return home;
  }
  const foreignPool = home ? NATIONALITIES.filter((nation) => nation.code !== home.code) : NATIONALITIES;
  // 高水平俱乐部更常吸引成熟足球强国球员；低级别联赛承载更多弱国球员。
  // 这只影响球员出现在哪个档位的俱乐部，不会在国家队阶段篡改其能力。
  const clubLevel = Math.max(-0.85, Math.min(1, (power - 62) / 20));
  const corridor = RECRUITMENT_CORRIDORS[homeNation] || {};
  const weights = foreignPool.map((nation) => {
    const strength = NATIONAL_TEAM_BASE_STRENGTH[nation.code] ?? 17.2;
    return Math.exp((strength - 17.2) * clubLevel * 0.55) * (corridor[nation.code] || 1);
  });
  let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < foreignPool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return foreignPool[i];
  }
  return foreignPool[foreignPool.length - 1];
}

function stableUnit(seed) {
  let h = 2166136261;
  for (const ch of String(seed || "")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function migrateAttribute(value, offset, seed) {
  const whole = Math.trunc(offset);
  const fraction = Math.abs(offset - whole);
  const extra = fraction > 0 && stableUnit(seed) < fraction ? Math.sign(offset) : 0;
  return clamp((Number(value) || 1) + whole + extra);
}

function stableGaussian(seed) {
  const u = Math.max(0.000001, stableUnit(`${seed}:u`));
  const v = stableUnit(`${seed}:v`);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function profileAttr(p, key, fallback = 10) {
  return Number(p?.attrs?.[key]) || fallback;
}

function profileNoise(p, key, amount = 1.2) {
  return (stableUnit(`${p?.id || p?.name || ""}:${key}:profile-noise`) - 0.5) * amount;
}

function inferHeightCm(p) {
  const cfg =
    p?.pos === "GK"
      ? { mean: 190, spread: 5.5, min: 180, max: 203 }
      : p?.pos === "DEF"
        ? { mean: 185, spread: 6, min: 174, max: 200 }
        : p?.pos === "ATT"
          ? { mean: 181, spread: 6.5, min: 169, max: 198 }
          : { mean: 178, spread: 6, min: 166, max: 193 };
  return clampNumber(cfg.mean + stableGaussian(`${p?.id || p?.name || ""}:height:v${FOOTBALL_PROFILE_VERSION}`) * cfg.spread, cfg.min, cfg.max);
}

function inferPreferredFoot(p) {
  const roll = stableUnit(`${p?.id || p?.name || ""}:foot:v${FOOTBALL_PROFILE_VERSION}`);
  if (roll < 0.72) return "right";
  if (roll < 0.91) return "left";
  return "both";
}

function inferHeading(p) {
  const a = p?.attrs || {};
  const height = Number(p?.heightCm) || inferHeightCm(p);
  const aerialBonus = (height - 180) / 6;
  let raw;
  if (p?.pos === "GK") {
    raw = profileAttr(p, "handling") * 0.28 + profileAttr(p, "kicking") * 0.18 + profileAttr(p, "strength") * 0.24 + 3.2;
  } else if (p?.pos === "DEF") {
    raw =
      profileAttr(p, "marking") * 0.22 +
      profileAttr(p, "positioning") * 0.18 +
      profileAttr(p, "strength") * 0.28 +
      profileAttr(p, "physical") * 0.14 +
      profileAttr(p, "tackling") * 0.1 +
      1.6;
  } else if (p?.pos === "ATT") {
    raw =
      profileAttr(p, "finishing") * 0.24 +
      profileAttr(p, "shooting") * 0.14 +
      profileAttr(p, "strength") * 0.24 +
      profileAttr(p, "physical") * 0.16 +
      profileAttr(p, "positioning") * 0.12 +
      1.3;
  } else {
    raw =
      profileAttr(p, "positioning") * 0.22 +
      profileAttr(p, "strength") * 0.2 +
      profileAttr(p, "physical") * 0.16 +
      profileAttr(p, "passing") * 0.12 +
      profileAttr(p, "vision") * 0.1 +
      1.1;
  }
  return clamp(raw + aerialBonus + profileNoise(p, "heading"));
}

function inferCrossing(p) {
  let raw =
    profileAttr(p, "passing") * 0.36 +
    profileAttr(p, "vision") * 0.18 +
    profileAttr(p, "kicking") * 0.14 +
    profileAttr(p, "dribbling") * 0.12 +
    profileAttr(p, "pace") * 0.08 +
    1.6;
  if (p?.pos === "GK") raw -= 2.5;
  if (p?.pos === "MID") raw += 0.8;
  if (p?.pos === "ATT") raw += 0.2;
  return clamp(raw + profileNoise(p, "crossing"));
}

function inferDecisions(p) {
  let raw =
    profileAttr(p, "vision") * 0.25 +
    profileAttr(p, "positioning") * 0.22 +
    profileAttr(p, "passing") * 0.16 +
    profileAttr(p, "stamina") * 0.1 +
    profileAttr(p, "defending") * 0.08 +
    profileAttr(p, "ovr", Number(p?.ovr) || 10) * 0.08 +
    1.2;
  if (Number(p?.age || 0) >= 30) raw += 0.7;
  if (Number(p?.age || 0) <= 19) raw -= 0.4;
  return clamp(raw + profileNoise(p, "decisions"));
}

export function ensureFootballProfile(p) {
  if (!p) return false;
  if (!p.attrs || typeof p.attrs !== "object") p.attrs = {};
  let changed = false;
  const height = Number(p.heightCm);
  if (!Number.isFinite(height) || height < 150 || height > 215) {
    p.heightCm = inferHeightCm(p);
    changed = true;
  } else {
    const next = clampNumber(height, 150, 215);
    if (next !== height) changed = true;
    p.heightCm = next;
  }
  if (!VALID_FEET.has(p.preferredFoot)) {
    p.preferredFoot = inferPreferredFoot(p);
    changed = true;
  }
  if (!Number.isFinite(Number(p.attrs.heading))) {
    p.attrs.heading = inferHeading(p);
    changed = true;
  } else {
    const next = clamp(p.attrs.heading);
    if (next !== p.attrs.heading) changed = true;
    p.attrs.heading = next;
  }
  if (!Number.isFinite(Number(p.attrs.crossing))) {
    p.attrs.crossing = inferCrossing(p);
    changed = true;
  } else {
    const next = clamp(p.attrs.crossing);
    if (next !== p.attrs.crossing) changed = true;
    p.attrs.crossing = next;
  }
  if (!Number.isFinite(Number(p.attrs.decisions))) {
    p.attrs.decisions = inferDecisions(p);
    changed = true;
  } else {
    const next = clamp(p.attrs.decisions);
    if (next !== p.attrs.decisions) changed = true;
    p.attrs.decisions = next;
  }
  if ((p.footballProfileVersion || 0) < FOOTBALL_PROFILE_VERSION) {
    p.footballProfileVersion = FOOTBALL_PROFILE_VERSION;
    changed = true;
  }
  if (ensurePlayerPositionProfile(p)) changed = true;
  if (ensurePlayerHabits(p)) changed = true;
  return changed;
}

/**
 * 旧档一次性迁移：直接修改俱乐部持有的同一球员对象，并同步总评、潜力与财务数据。
 * 新生成球员已带版本标记，不会被重复校准。
 */
export function ensureRealisticPlayerTalent(p) {
  if (!p || (p.talentModelVersion || 0) >= TALENT_MODEL_VERSION) return false;
  const oldOvr = Number(p.ovr) || playerOverall(p);
  const oldPotential = Number(p.potential) || oldOvr;
  const potentialGap = Math.max(0, oldPotential - oldOvr);
  const offset = nationalTalentOffset(p.nationality);
  for (const key of Object.keys(p.attrs || {})) {
    p.attrs[key] = migrateAttribute(p.attrs[key], offset, `${p.id}:${key}:talent-v${TALENT_MODEL_VERSION}`);
  }
  p.abilitySeed = normalizedAbilitySeed(p);
  setPlayerOverall(p, p.abilitySeed);
  p.potential = clamp(p.ovr + potentialGap, p.ovr, 20);
  p.value = estimateValue(p);
  p.wage = p.fromYouth ? Math.max(200, Math.round(estimateWage(p) * 0.25)) : estimateWage(p);
  p.talentModelVersion = TALENT_MODEL_VERSION;
  return true;
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

const OVERALL_KEYS = Object.freeze({
  GK: ["reflexes", "handling", "positioning", "kicking"],
  DEF: ["tackling", "marking", "strength", "pace", "passing"],
  MID: ["passing", "vision", "stamina", "pace", "shooting"],
  ATT: ["shooting", "pace", "dribbling", "finishing", "strength"],
});

// 位置塑形对关键属性均值的额外抬升；统一回到 DEF 的 +1.2 基准。
const POSITION_OVR_EXCESS = Object.freeze({ GK: 0.8, DEF: 0, MID: -0.2, ATT: 0.4 });
export const ABILITY_DISTRIBUTION_VERSION = 1;

function rawPlayerOverall(p) {
  const keys = OVERALL_KEYS[p?.pos] || OVERALL_KEYS.MID;
  return keys.reduce((sum, key) => sum + (Number(p?.attrs?.[key]) || 1), 0) / keys.length;
}

function normalizedAbilitySeed(p) {
  return rawPlayerOverall(p) - (POSITION_OVR_EXCESS[p?.pos] || 0);
}

function setPlayerOverall(p, target) {
  if (!p?.attrs) return 0;
  const wanted = clamp(target);
  const keys = OVERALL_KEYS[p.pos] || OVERALL_KEYS.MID;
  const delta = wanted - rawPlayerOverall(p);
  for (const key of keys) p.attrs[key] = clamp((p.attrs[key] || 1) + delta);

  let current = playerOverall(p);
  let guard = 0;
  while (current !== wanted && guard++ < 120) {
    const direction = current < wanted ? 1 : -1;
    const candidates = keys
      .filter((key) => direction > 0 ? p.attrs[key] < 20 : p.attrs[key] > 1)
      .sort((a, b) => direction > 0 ? p.attrs[a] - p.attrs[b] : p.attrs[b] - p.attrs[a]);
    if (!candidates.length) break;
    p.attrs[candidates[guard % candidates.length]] += direction;
    current = playerOverall(p);
  }
  p.ovr = current;
  normalizePlayerAttributeCoherence(p);
  return current;
}

function scaledCount(base, population, reference) {
  return Math.max(1, Math.round(base * (population / reference)));
}

/**
 * 一次性世界能力标尺：保留球员相对排序，仅压缩 18–20 的人数并同步潜力/财务。
 * 它发生在数据库生成/旧档迁移阶段，不参与比赛或国家队的隐藏修正。
 */
export function calibrateWorldAbilityDistribution(clubs) {
  const firstTeam = (clubs || []).flatMap((club) => (club.players || []).map((player) => ({ player, club })));
  if (!firstTeam.length) return null;
  const original = new Map();
  for (const { player } of firstTeam) {
    original.set(player.id, {
      ovr: Number(player.ovr) || playerOverall(player),
      potential: Number(player.potential) || Number(player.ovr) || playerOverall(player),
    });
  }

  const ranked = firstTeam
    .map((entry) => ({
      ...entry,
      seed: Number.isFinite(entry.player.abilitySeed)
        ? entry.player.abilitySeed
        : normalizedAbilitySeed(entry.player),
    }))
    .sort((a, b) => b.seed - a.seed || stableUnit(`${a.player.id}:ability-rank`) - stableUnit(`${b.player.id}:ability-rank`));

  const count20 = scaledCount(2, ranked.length, 3572);
  const count19 = scaledCount(24, ranked.length, 3572);
  const count18 = scaledCount(110, ranked.length, 3572);
  ranked.forEach(({ player, seed }, index) => {
    const target = index < count20
      ? 20
      : index < count20 + count19
        ? 19
        : index < count20 + count19 + count18
          ? 18
          : Math.min(17, clamp(seed));
    setPlayerOverall(player, target);
    player.abilitySeed = seed;
    player.abilityDistributionVersion = ABILITY_DISTRIBUTION_VERSION;
  });

  const allPlayers = (clubs || []).flatMap((club) => [
    ...(club.players || []),
    ...(club.youth?.players || []),
  ]);
  const potentialRanked = allPlayers
    .map((player) => {
      const old = original.get(player.id) || {
        ovr: Number(player.ovr) || playerOverall(player),
        potential: Number(player.potential) || Number(player.ovr) || playerOverall(player),
      };
      const normalizedPotential = old.potential - (POSITION_OVR_EXCESS[player.pos] || 0);
      const youthBonus = (player.age || 25) <= 21 ? Math.min(0.6, (22 - (player.age || 21)) * 0.1) : 0;
      return { player, score: normalizedPotential + (player.ovr || 10) * 0.25 + youthBonus };
    })
    .sort((a, b) => b.score - a.score || stableUnit(`${a.player.id}:potential-rank`) - stableUnit(`${b.player.id}:potential-rank`));

  const potential20 = scaledCount(8, potentialRanked.length, 4700);
  const potential19 = scaledCount(48, potentialRanked.length, 4700);
  const potential18 = scaledCount(180, potentialRanked.length, 4700);
  potentialRanked.forEach(({ player, score }, index) => {
    const tier = index < potential20
      ? 20
      : index < potential20 + potential19
        ? 19
        : index < potential20 + potential19 + potential18
          ? 18
          : Math.min(17, clamp(score - (player.ovr || 10) * 0.25));
    player.potential = Math.max(player.ovr || 1, tier);
    player.value = estimateValue(player);
    player.wage = player.fromYouth
      ? Math.max(200, Math.round(estimateWage(player) * 0.25))
      : estimateWage(player);
  });

  return {
    players: ranked.length,
    current: { 20: count20, 19: count19, 18: count18 },
    potential: { 20: potential20, 19: potential19, 18: potential18 },
  };
}

export function estimateValue(p) {
  const ovr = playerOverall(p);
  // 更平滑的指数级数：1.8 而非 2.4，避免顶级球员与普通球员价差过大
  // 20 OVR 与 10 OVR 现在约 40 倍差距（而非原 96 倍），更接近真实转会市场
  const ageFactor = p.age <= 23 ? 1.35 : p.age <= 28 ? 1.15 : p.age <= 32 ? 0.9 : 0.55;
  const base = Math.pow(ovr, 1.8) * 18_000;
  return Math.max(50_000, Math.round(base * ageFactor / 10_000) * 10_000);
}

export function estimateWage(p) {
  const ovr = playerOverall(p);
  const ageTax = p.age >= 34 ? 0.75 : p.age >= 32 ? 0.9 : 1;
  // 位置稀缺性系数：门将供给充足（0.85），前锋市场溢价（1.1）
  const positionMod = p.pos === "GK" ? 0.85 : p.pos === "DEF" ? 0.9 : p.pos === "ATT" ? 1.1 : 1.0;
  return Math.max(800, Math.round(ovr * ovr * 45 * ageTax * positionMod));
}

/** 高龄退役概率（赛季结束后、年龄已 +1）平滑曲线，避免悬崖式退役 */
export function retireChance(age) {
  if (age >= 40) return 1;
  if (age >= 38) return 0.85;
  if (age >= 37) return 0.6;
  if (age >= 36) return 0.35;
  if (age >= 35) return 0.18;
  if (age >= 34) return 0.08;
  if (age >= 33) return 0.03;
  if (age >= 32) return 0.01;
  return 0;
}

const AGEING_ATTRS = {
  physical: ["pace", "stamina", "physical", "strength", "reflexes"],
  technical: ["shooting", "passing", "dribbling", "finishing", "tackling", "handling", "kicking", "heading", "crossing"],
  mental: ["vision", "marking", "positioning", "decisions"],
};

const PHYSICAL_DECLINE_AGE = { GK: 34, DEF: 32, MID: 31, ATT: 30 };

function changeRandomAgeingAttr(p, keys, delta) {
  const pool = keys.filter((key) => {
    const value = Number(p.attrs?.[key]) || 0;
    return delta < 0 ? value > 1 : value < 20;
  });
  if (!pool.length) return false;
  const key = pool[Math.floor(Math.random() * pool.length)];
  p.attrs[key] = Math.max(1, Math.min(20, p.attrs[key] + delta));
  return true;
}

/**
 * 年龄 +1，并按位置拆分身体、技术与心智能力曲线。
 * 边锋/前锋更早失去爆发力，门将与中卫更晚；经验属性可在成熟期继续增长。
 */
export function agePlayerOneYear(p, context = {}) {
  const beforeAttrs = { ...(p.attrs || {}) };
  const ovrBefore = Number(p.ovr || playerOverall(p));
  p.age = (p.age || 17) + 1;
  let declined = false;
  const summary = { physical: 0, technical: 0, mental: 0, improvedMental: 0 };
  if (p.attrs) {
    const startAge = PHYSICAL_DECLINE_AGE[p.pos] || 31;
    if (p.age >= startAge) {
      const years = p.age - startAge;
      const attempts = Math.min(3, 1 + Math.floor(years / 2));
      const chancePerHit = p.pos === "GK" ? 0.58 : 0.7;
      for (let i = 0; i < attempts; i++) {
        if (Math.random() < chancePerHit && changeRandomAgeingAttr(p, AGEING_ATTRS.physical, -1)) {
          summary.physical++;
          declined = true;
        }
      }
      if (p.age >= startAge + 3 && Math.random() < 0.32) {
        if (changeRandomAgeingAttr(p, AGEING_ATTRS.technical, -1)) {
          summary.technical++;
          declined = true;
        }
      }
    }

    const mentalPeakEnd = p.pos === "GK" || p.pos === "DEF" ? 34 : 32;
    if (p.age >= 27 && p.age <= mentalPeakEnd && Math.random() < 0.24) {
      if (changeRandomAgeingAttr(p, AGEING_ATTRS.mental, 1)) summary.improvedMental++;
    } else if (p.age >= mentalPeakEnd + 4 && Math.random() < 0.22) {
      if (changeRandomAgeingAttr(p, AGEING_ATTRS.mental, -1)) {
        summary.mental++;
        declined = true;
      }
    }

    p.ageingLast = summary;
    p.ovr = playerOverall(p);
    if (p.potential != null) {
      p.potential = Math.max(p.ovr, Math.min(p.potential, p.ovr + (p.age >= mentalPeakEnd ? 0 : 1)));
    }
  }
  if (!declined && p.age <= 24 && p.potential != null && p.ovr < p.potential && Math.random() < 0.35) {
    // 年轻球员赛季末小幅成长
    const keys = weightedDevelopmentAttributes(p, Object.keys(p.attrs || {}));
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
  if (context.record) {
    const changes = Object.keys(p.attrs || {})
      .filter((key) => Number(p.attrs[key]) !== Number(beforeAttrs[key]))
      .map((key) => ({ attribute: key, before: beforeAttrs[key], after: p.attrs[key] }));
    const improved = changes.filter((change) => Number(change.after) > Number(change.before)).length;
    const declinedCount = changes.length - improved;
    recordPlayerDevelopment(p, {
      season: context.season,
      day: context.day,
      type: "ageing",
      source: "season-transition",
      changes,
      ovrBefore,
      ovrAfter: p.ovr,
      reason: declinedCount && improved
        ? "年龄曲线带来经验成长与身体衰退"
        : declinedCount
          ? "位置与年龄对应的自然衰退"
          : "成熟期经验与比赛理解增长",
      reasonEn: declinedCount && improved
        ? "Ageing combined experience gains with physical decline"
        : declinedCount
          ? "Natural position-specific ageing decline"
          : "Maturity improved experience and game understanding",
      details: { age: p.age, position: p.pos, ageing: { ...summary } },
    });
  }
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
    /** 最近 5 场评分记录（用于计算状态；跨联赛/杯赛滚动） */
    recentRatings: [],
  };
}

const RECENT_FORM_LEN = 5;

/**
 * 赛后写入滚动状态：任意正式比赛（联赛/杯赛/洲际）出场都计入，
 * 与「联赛场均」分账分离——状态看手感，场均看联赛口径。
 */
export function pushRecentRating(p, rating) {
  if (!p || rating == null || Number.isNaN(Number(rating))) return null;
  ensurePlayerHistory(p);
  const st = p.stats;
  if (!Array.isArray(st.recentRatings)) st.recentRatings = [];
  st.recentRatings.push(Math.round(Number(rating) * 10) / 10);
  if (st.recentRatings.length > RECENT_FORM_LEN) {
    st.recentRatings = st.recentRatings.slice(-RECENT_FORM_LEN);
  }
  return st.recentRatings;
}

/** 球员状态（form）：最近最多 5 场评分平均，用于选人决策与界面显示 */
export function playerForm(p) {
  const s = p?.stats || emptyMatchStats();
  const recent = Array.isArray(s.recentRatings) ? s.recentRatings : [];
  if (recent.length === 0) return null;
  const sum = recent.reduce((acc, r) => acc + (Number(r) || 0), 0);
  return Math.round((sum / recent.length) * 10) / 10;
}

/** 状态颜色档：≥7.3 热 / ≥6.8 良好 / ≥6.0 正常 / <6.0 低迷 */
export function formClass(form) {
  if (form == null || Number.isNaN(form)) return "";
  if (form >= 7.3) return "form-hot";
  if (form >= 6.8) return "form-good";
  if (form >= 6.0) return "form-ok";
  return "form-cold";
}

export function formatForm(form) {
  if (form == null || Number.isNaN(form)) return "—";
  return Number(form).toFixed(1);
}

/** 状态文案（中/英） */
export function formToneLabel(form, lang = "zh") {
  if (form == null || Number.isNaN(form)) return lang === "en" ? "—" : "—";
  if (form >= 7.3) return lang === "en" ? "Hot" : "火热";
  if (form >= 6.8) return lang === "en" ? "Good" : "良好";
  if (form >= 6.0) return lang === "en" ? "Steady" : "平稳";
  return lang === "en" ? "Cold" : "低迷";
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
/** Appearance traits for avatar pipeline / portrait matching */
export const APPEARANCE_SKIN_TONES = SHARED_APPEARANCE_SKIN_TONES;
export const APPEARANCE_HAIR_COLORS = SHARED_APPEARANCE_HAIR_COLORS;
/** 0 flat 1 pompadour 2 spiky 3 buzz 4 sidepart 5 bowl 6 afro 7 curl 8 fade 9 long */
export const APPEARANCE_HAIR_STYLE_IDS = SHARED_APPEARANCE_HAIR_STYLE_IDS;
export const APPEARANCE_HAIR_STYLE_NAMES = SHARED_APPEARANCE_HAIR_STYLE_NAMES;

export function generatePlayerAppearance(player = {}, opts = {}) {
  return generateSharedPlayerAppearance(player, opts);
}

/** Backfill appearanceSeed / skin / hair for old saves. */
export function ensurePlayerAppearance(p) {
  if (!p || typeof p !== "object") return p;
  const gen = generatePlayerAppearance(p);
  if (p.appearanceSeed == null || p.appearanceSeed === "") {
    p.appearanceSeed = gen.appearanceSeed;
  }
  if (!normalizeSharedSkinTone(p.skinTone)) p.skinTone = gen.skinTone;
  else p.skinTone = normalizeSharedSkinTone(p.skinTone);
  if (!normalizeSharedHairColor(p.hairColor)) p.hairColor = gen.hairColor;
  else p.hairColor = normalizeSharedHairColor(p.hairColor);
  const hs = normalizeSharedHairStyleId(p.hairStyle);
  p.hairStyle = hs == null ? gen.hairStyle : hs;
  return p;
}

export function ensurePlayerHistory(p) {
  ensurePlayerAppearance(p);
  if (!p.stats) p.stats = emptyMatchStats();
  else {
    const e = emptyMatchStats();
    for (const k of Object.keys(e)) {
      if (p.stats[k] == null) p.stats[k] = e[k];
    }
    if (!Array.isArray(p.stats.recentRatings)) p.stats.recentRatings = [];
    // 旧档只有 lastRating：用其垫一条，避免状态列长期空白
    if (
      p.stats.recentRatings.length === 0 &&
      p.stats.lastRating != null &&
      Number.isFinite(Number(p.stats.lastRating)) &&
      (p.stats.apps || 0) > 0
    ) {
      p.stats.recentRatings = [Math.round(Number(p.stats.lastRating) * 10) / 10];
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
  if (!p.leagueStats || typeof p.leagueStats !== "object" || Array.isArray(p.leagueStats)) {
    p.leagueStats = {};
  }
  if (!p.competitionStats || typeof p.competitionStats !== "object" || Array.isArray(p.competitionStats)) {
    p.competitionStats = {};
  }
  return p;
}

/**
 * 本赛季按国内联赛独立记账。旧档首次访问时将现有总联赛数据归入当时所在联赛；
 * 之后跨联赛转会会写入新的 division 桶，不污染此前赛事的数据。
 */
export function ensureLeagueStats(p, division, clubId = null) {
  ensurePlayerHistory(p);
  const key = String(Number(division) || 3);
  if (p.leagueStatsVersion !== 1) {
    const current = p.stats || emptyMatchStats();
    const hasData =
      (current.apps || 0) > 0 ||
      (current.goals || 0) > 0 ||
      (current.assists || 0) > 0 ||
      (current.cleanSheets || 0) > 0 ||
      (current.goalsConceded || 0) > 0 ||
      (current.ratingSum || 0) > 0;
    p.leagueStats = hasData ? { [key]: { ...emptyMatchStats(), ...current, clubId } } : {};
    p.leagueStatsVersion = 1;
  }
  if (!p.leagueStats[key]) {
    p.leagueStats[key] = { ...emptyMatchStats(), clubId };
  } else {
    const empty = emptyMatchStats();
    for (const statKey of Object.keys(empty)) {
      if (p.leagueStats[key][statKey] == null) p.leagueStats[key][statKey] = empty[statKey];
    }
    if (clubId) p.leagueStats[key].clubId = clubId;
  }
  return p.leagueStats[key];
}

/** 本赛季按俱乐部杯赛/洲际赛事 ID 独立记账，不混入国内联赛数据。 */
export function ensureCompetitionStats(p, competitionId, clubId = null) {
  ensurePlayerHistory(p);
  const key = String(competitionId || "unknown");
  if (!p.competitionStats[key]) {
    p.competitionStats[key] = { ...emptyMatchStats(), clubId };
  } else {
    const empty = emptyMatchStats();
    for (const statKey of Object.keys(empty)) {
      if (p.competitionStats[key][statKey] == null) p.competitionStats[key][statKey] = empty[statKey];
    }
    if (clubId) p.competitionStats[key].clubId = clubId;
  }
  return p.competitionStats[key];
}

/** Archive the current club segment without advancing the season. */
export function archiveClubSeasonStats(p, season, clubId, clubName) {
  ensurePlayerHistory(p);
  const s = p.stats || emptyMatchStats();
  const hasData = s.apps > 0 || s.goals > 0 || s.assists > 0 || s.cleanSheets > 0 || s.goalsConceded > 0;
  if (hasData) {
    const duplicate = p.history.some(
      (h) => h.season === season && h.clubId === clubId && h.apps === s.apps && h.goals === s.goals && h.assists === s.assists
    );
    if (!duplicate) {
      const entry = {
        season,
        clubId: clubId || p.clubId || null,
        clubName: clubName || "",
        apps: s.apps || 0,
        goals: s.goals || 0,
        assists: s.assists || 0,
        cleanSheets: s.cleanSheets || 0,
        goalsConceded: s.goalsConceded || 0,
        avgRating: s.apps > 0 && s.ratingSum > 0 ? Math.round((s.ratingSum / s.apps) * 10) / 10 : null,
      };
      p.history.push(entry);
      for (const key of ["apps", "goals", "assists", "cleanSheets", "goalsConceded", "ratingSum"]) {
        p.career[key] = (p.career[key] || 0) + (s[key] || 0);
      }
    }
  }
  const keepForm = Array.isArray(s.recentRatings) ? s.recentRatings.slice(-RECENT_FORM_LEN) : [];
  p.stats = emptyMatchStats();
  if (keepForm.length) p.stats.recentRatings = keepForm;
  p.leagueStats = {};
  p.leagueStatsVersion = 1;
  p.competitionStats = {};
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

  // 状态是滚动手感，跨赛季保留最近评分；赛季场均/出场则清零
  const keepForm = Array.isArray(s.recentRatings) ? s.recentRatings.slice(-RECENT_FORM_LEN) : [];
  p.stats = emptyMatchStats();
  if (keepForm.length) p.stats.recentRatings = keepForm;
  p.leagueStats = {};
  p.leagueStatsVersion = 1;
  p.competitionStats = {};
  p.fitness = Math.min(100, Math.max(80, p.fitness || 90));
  p.injured = 0;
  p.injury = null;
  p.returnToPlayDays = 0;
}

/** @deprecated 使用 archiveAndResetSeasonStats；无赛季信息时仅清零 */
export function resetSeasonStats(p) {
  ensurePlayerHistory(p);
  const keepForm = Array.isArray(p.stats?.recentRatings)
    ? p.stats.recentRatings.slice(-RECENT_FORM_LEN)
    : [];
  p.stats = emptyMatchStats();
  if (keepForm.length) p.stats.recentRatings = keepForm;
  p.leagueStats = {};
  p.leagueStatsVersion = 1;
  p.competitionStats = {};
  p.fitness = Math.min(100, Math.max(80, p.fitness || 90));
  p.injured = 0;
  p.injury = null;
  p.returnToPlayDays = 0;
}

export function createPlayer(pos, power = 65, clubId = null, opts = {}) {
  const isYouth = !!opts.youth;
  const nation = opts.nationality
    ? NATIONALITIES.find((item) => item.code === opts.nationality) || pickPlayerNation(opts.homeNation, isYouth, power)
    : pickPlayerNation(opts.homeNation, isYouth, power);
  const mean = power / 5 + nationalTalentOffset(nation.code); // 俱乐部档位为主，国籍层级只作有限修正
  const age = isYouth ? rand(15, 18) : rand(17, 34);
  const p = {
    id: uid(isYouth ? "yt" : "pl"),
    name: generatePlayerName(nation.code, opts.namePick || pick, {
      usedNames: opts.existingNames,
    }),
    pos,
    age,
    nationality: nation.code,
    nationName: nation.name,
    nationNameEn: nation.nameEn,
    nationFlag: nation.flag,
    attrs: {},
    fitness: rand(85, 100),
    morale: rand(55, 85),
    clubId,
    injured: 0,
    fromYouth: isYouth,
    // 本赛季数据
    stats: emptyMatchStats(),
    // 本赛季国内联赛分赛事数据：{ [divisionId]: stats + clubId }
    leagueStats: {},
    leagueStatsVersion: 1,
    // 本赛季俱乐部杯赛分赛事数据：{ [competitionId]: stats + clubId }
    competitionStats: {},
    // 生涯总计（跨赛季累计）
    career: emptyMatchStats(),
    // 分赛季历史 [{ season, clubId, clubName, apps, goals, ... }]
    history: [],
    // 国家队
    intl: { caps: 0, goals: 0, assists: 0, cleanSheets: 0, goalsConceded: 0 },
    // 个人荣誉
    honors: [],
    // 球衣号与稳定偏好（入队/登记时由 squad-numbers 分配）
    number: null,
    numberPreferences: [],
    numberPreferenceStrength: null,
    numberPreferenceVersion: 0,
    talentModelVersion: TALENT_MODEL_VERSION,
  };
  generatePlayerAttributes(p, mean);
  // appearance identity persisted at create time
  {
    const look = generatePlayerAppearance(p);
    p.appearanceSeed = look.appearanceSeed;
    p.skinTone = look.skinTone;
    p.hairColor = look.hairColor;
    p.hairStyle = look.hairStyle;
  }
  ensureFootballProfile(p);
  ensurePlayerNumberPreferences(p);
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
  const existingNames = new Set([
    ...(club.players || []).map((player) => player.name),
    ...(club.youth?.players || []).map((player) => player.name),
  ]);
  const p = createPlayer(pos, power, club.id, {
    youth: true,
    homeNation: club.countryCode,
    existingNames,
  });
  // 高等级更容易出高潜力
  if (Math.random() < 0.08 + level * 0.04) {
    p.potential = clamp(p.potential + rand(1, 3), p.potential, 20);
  }
  p.ovr = playerOverall(p);
  p.value = estimateValue(p);
  return p;
}

export function fillYouthSquad(club, count = null, options = {}) {
  const ya = ensureYouthAcademy(club);
  const cfg = YOUTH_LEVELS[ya.level] || YOUTH_LEVELS[1];
  const target = count ?? Math.min(cfg.capacity, 4 + ya.level);
  while (ya.players.length < target) {
    ya.players.push(createYouthPlayer(club));
  }
  if (options.assignNumbers !== false) assignSquadNumbers(club, { reason: options.reason || "youth-intake" });
  return ya.players;
}


/** 球衣样式：solid / stripes / hoops / halves / sash */
export const KIT_STYLES = ["solid", "stripes", "hoops", "halves", "sash"];

function hashStr(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function contrastText(hex) {
  if (!hex || typeof hex !== "string") return "#fff";
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length < 6) return "#fff";
  const r0 = parseInt(h.slice(0, 2), 16) / 255;
  const g0 = parseInt(h.slice(2, 4), 16) / 255;
  const b0 = parseInt(h.slice(4, 6), 16) / 255;
  if ([r0, g0, b0].some((n) => Number.isNaN(n))) return "#fff";
  const lin = (s) =>
    s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lin(r0) + 0.7152 * lin(g0) + 0.0722 * lin(b0);
  // 黑/白谁对比度高用谁（粉衣必须深字）
  const cBlack = (Math.max(L, 0) + 0.05) / (Math.min(L, 0) + 0.05);
  const cWhite = (Math.max(L, 1) + 0.05) / (Math.min(L, 1) + 0.05);
  return cBlack >= cWhite ? "#0f172a" : "#ffffff";
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
  // 所有已映射俱乐部始终按原创品牌参数刷新，旧档的名称/球衣快照不会反向覆盖。
  const branding = club.id ? clubBrandingById[club.id] : null;
  if (branding?.kit) {
    const theme = branding.kit;
    club.color = branding.colors.primary;
    club.colors = { ...branding.colors };
    club.crest = { ...branding.crest };
    club.kit = {
      style: theme.style || "solid",
      primary: theme.primary,
      secondary: theme.secondary || shiftHex(theme.primary, -50),
      numberColor: theme.numberColor || contrastText(theme.primary),
    };
    return club.kit;
  }
  if (club.kit && club.kit.primary && club.kit.style) {
    // 始终按主色校正号码色（修复旧存档粉衣白字）
    const auto = contrastText(club.kit.primary);
    const cur = club.kit.numberColor;
    if (!cur) {
      club.kit.numberColor = auto;
    } else {
      // 与底色亮度差太小 → 强制自动
      const parseL = (hex) => {
        let hh = String(hex || "").replace("#", "");
        if (hh.length === 3) hh = hh[0] + hh[0] + hh[1] + hh[1] + hh[2] + hh[2];
        if (hh.length < 6) return 0.5;
        const r = parseInt(hh.slice(0, 2), 16) / 255;
        const g = parseInt(hh.slice(2, 4), 16) / 255;
        const b = parseInt(hh.slice(4, 6), 16) / 255;
        const lin = (s) =>
          s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      if (Math.abs(parseL(club.kit.primary) - parseL(cur)) < 0.35) {
        club.kit.numberColor = auto;
      }
    }
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

const SQUAD_SHAPE = [
  ...Array(2).fill("GK"),
  ...Array(6).fill("DEF"),
  ...Array(6).fill("MID"),
  ...Array(5).fill("ATT"),
];

export function createClub(template, lang = "zh") {
  const existingNames = new Set();
  const players = SQUAD_SHAPE.map((pos) => {
    const jitter = rand(-6, 6);
    const player = createPlayer(pos, template.power + jitter, template.id, {
      homeNation: template.countryCode,
      existingNames,
    });
    existingNames.add(player.name);
    return player;
  });
  // 排序：主力能力略高
  players.sort((a, b) => b.ovr - a.ovr);

  const division = template.division || START_DIVISION;
  const club = {
    id: template.id,
    name: template.name,
    nameEn: template.nameEn,
    nameZh: template.nameZh,
    short: template.short,
    shortName: template.shortName || template.short,
    color: template.color,
    power: template.power,
    money: template.money,
    division,
    countryId: template.countryId || DIVISIONS[division]?.countryId || "crownland",
    countryCode: template.countryCode,
    leagueId: division,
    city: template.city ? { ...template.city } : null,
    stadiumName: template.stadiumName ? { ...template.stadiumName } : null,
    colors: template.colors ? { ...template.colors } : null,
    crest: template.crest ? { ...template.crest } : null,
    realityProfile: template.realityProfile ? { ...template.realityProfile } : null,
    players,
    tactics: defaultTactics(),
    form: [], // W/D/L 最近
    youth: {
      level: template.realityProfile?.youthLevel || (DIVISIONS[division]?.tier === 1 ? 2 : 1),
      players: [],
      daysSinceIntake: rand(0, 20),
    },
    staff: null, // create 后填充，避免循环依赖 staff.js
    kit: null,
    numberRegistration: null,
    training: { focus: "balanced", intensity: "normal" },
    facilities: template.realityProfile
      ? {
          stadium: template.realityProfile.stadiumLevel || 1,
          training: template.realityProfile.trainingLevel || 1,
          youth: template.realityProfile.youthLevel || 1,
          projects: [],
        }
      : null,
    finance: {
      version: 2,
      ledgerVersion: 1,
      ledgerSeason: null,
      ledgerSeq: 0,
      financeLedger: [],
      seasonTicketIncome: 0,
      seasonMatchdayIncome: 0,
      seasonCommercialIncome: 0,
      seasonWageOut: 0,
      seasonFacilityOut: 0,
      seasonTransferNet: 0,
      seasonBroadcastIncome: 0,
      seasonPrizeIncome: 0,
      seasonCompetitionIncome: 0,
      seasonLeagueTransitionIncome: 0,
      seasonFinancingNet: 0,
      seasonHomeGates: 0,
    },
  };
  applyClubBranding(club, clubBrandingById[club.id] || template.branding, lang);
  ensureKit(club);
  fillYouthSquad(club);
  assignSquadNumbers(club, { reason: "club-created" });
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
    /** null 表示跟随基础阵型；显式值只改变对应比赛阶段的空间站位 */
    possessionFormation: null,
    outOfPossessionFormation: null,
    style: "balanced",
    pressing: 3,
    tempo: 3,
    width: 3,
    defensiveLine: 3,
    lineup: [],
    /** 与 lineup 等长：每槽角色 id（见 data.PLAYER_ROLES） */
    roles: [],
    /** 与 roles 等长：每槽职责 defend / support / attack */
    duties: [],
    /**
     * 核心球员 id（梅西/C罗/内马尔式「进攻绝对权」）
     * 须在首发中；null 表示未指定
     */
    corePlayerId: null,
    /** 队长须在首发中；null 表示开赛前自动选择 */
    captainId: null,
    /** 定位球职责须在首发中；缺失时按真实属性自动选择 */
    setPieces: {
      penaltyId: null,
      directFreeKickId: null,
      cornerId: null,
    },
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

export const SET_PIECE_TYPES = Object.freeze(["penalty", "directFreeKick", "corner"]);
const SET_PIECE_FIELDS = Object.freeze({
  penalty: "penaltyId",
  directFreeKick: "directFreeKickId",
  corner: "cornerId",
});

function normalizeSetPieces(t) {
  if (!t.setPieces || typeof t.setPieces !== "object") t.setPieces = {};
  for (const field of Object.values(SET_PIECE_FIELDS)) {
    if (t.setPieces[field] === undefined) t.setPieces[field] = null;
  }
  return t.setPieces;
}

function lineupPlayerMap(club) {
  return new Map((club?.players || []).map((p) => [p.id, p]));
}

function starterPlayers(club, { outfield = false } = {}) {
  const map = lineupPlayerMap(club);
  return (club?.tactics?.lineup || [])
    .map((id) => map.get(id))
    .filter((p) => p && (!outfield || p.pos !== "GK"));
}

function starterHas(club, playerId, { outfield = false } = {}) {
  if (!playerId) return false;
  const map = lineupPlayerMap(club);
  const p = map.get(playerId);
  if (!p || (outfield && p.pos === "GK")) return false;
  return (club?.tactics?.lineup || []).includes(playerId);
}

function scoreCaptainCandidate(p) {
  const a = p?.attrs || {};
  const posMul = p?.pos === "DEF" ? 1.08 : p?.pos === "MID" ? 1.05 : p?.pos === "GK" ? 1.0 : 0.96;
  const age = Math.max(17, Math.min(36, Number(p?.age) || 24));
  const experience = Math.max(0, Math.min(5, age - 24)) + Math.max(0, Math.min(3, Number(p?.career?.apps || 0) / 80));
  const skill =
    (Number(a.decisions) || 10) * 0.32 +
    (Number(a.positioning) || 10) * 0.16 +
    (Number(a.stamina) || 10) * 0.12 +
    (Number(a.vision) || 10) * 0.1 +
    (Number(p?.ovr) || 10) * 0.2 +
    (Number(p?.morale) || 70) * 0.025 +
    experience;
  return skill * posMul;
}

function scoreSetPieceCandidate(p, type) {
  const a = p?.attrs || {};
  if (type === "penalty") {
    return (
      (Number(a.finishing) || 10) * 0.36 +
      (Number(a.shooting) || 10) * 0.26 +
      (Number(a.decisions) || 10) * 0.18 +
      (Number(a.kicking) || 10) * 0.1 +
      (Number(p?.ovr) || 10) * 0.1
    );
  }
  if (type === "corner") {
    return (
      (Number(a.crossing) || 10) * 0.44 +
      (Number(a.passing) || 10) * 0.22 +
      (Number(a.vision) || 10) * 0.12 +
      (Number(a.kicking) || 10) * 0.12 +
      (Number(a.decisions) || 10) * 0.1
    );
  }
  return (
    (Number(a.kicking) || 10) * 0.28 +
    (Number(a.shooting) || 10) * 0.24 +
    (Number(a.crossing) || 10) * 0.16 +
    (Number(a.passing) || 10) * 0.14 +
    (Number(a.decisions) || 10) * 0.1 +
    (Number(a.vision) || 10) * 0.08
  );
}

export function getCaptainId(club) {
  ensureTactics(club);
  const id = club.tactics.captainId || null;
  if (!id) return null;
  if (!starterHas(club, id)) {
    club.tactics.captainId = null;
    return null;
  }
  return id;
}

export function pickAutoCaptainId(club) {
  ensureTactics(club);
  const xi = starterPlayers(club);
  if (!xi.length) return null;
  let best = null;
  let bestScore = -1;
  for (const p of xi) {
    const score = scoreCaptainCandidate(p);
    if (score > bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

export function ensureCaptain(club, { force = false } = {}) {
  ensureTactics(club);
  if (!force) {
    const cur = getCaptainId(club);
    if (cur) return cur;
  }
  const id = pickAutoCaptainId(club);
  club.tactics.captainId = id;
  return id;
}

export function setCaptainId(club, playerId) {
  ensureTactics(club);
  if (!playerId) {
    club.tactics.captainId = null;
    return { ok: true, captainId: null };
  }
  if (!starterHas(club, playerId)) {
    return { ok: false, msg: "队长须在首发十一人中" };
  }
  club.tactics.captainId = playerId;
  return { ok: true, captainId: playerId };
}

export function getSetPieceTakerId(club, type) {
  ensureTactics(club);
  const field = SET_PIECE_FIELDS[type];
  if (!field) return null;
  const id = club.tactics.setPieces?.[field] || null;
  if (!id) return null;
  if (!starterHas(club, id, { outfield: true })) {
    club.tactics.setPieces[field] = null;
    return null;
  }
  return id;
}

export function pickAutoSetPieceTakerId(club, type) {
  ensureTactics(club);
  if (!SET_PIECE_FIELDS[type]) return null;
  const xi = starterPlayers(club, { outfield: true });
  if (!xi.length) return null;
  let best = null;
  let bestScore = -1;
  for (const p of xi) {
    const score = scoreSetPieceCandidate(p, type);
    if (score > bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

export function ensureSetPieceTakers(club, { force = false } = {}) {
  ensureTactics(club);
  normalizeSetPieces(club.tactics);
  const out = {};
  for (const type of SET_PIECE_TYPES) {
    const field = SET_PIECE_FIELDS[type];
    const cur = !force ? getSetPieceTakerId(club, type) : null;
    const id = cur || pickAutoSetPieceTakerId(club, type);
    club.tactics.setPieces[field] = id;
    out[type] = id;
  }
  return out;
}

export function setSetPieceTakerId(club, type, playerId) {
  ensureTactics(club);
  const field = SET_PIECE_FIELDS[type];
  if (!field) return { ok: false, msg: "无效定位球类型" };
  if (!playerId) {
    club.tactics.setPieces[field] = null;
    return { ok: true, type, playerId: null };
  }
  if (!starterHas(club, playerId, { outfield: true })) {
    return { ok: false, msg: "定位球主罚者须在首发非门将中" };
  }
  club.tactics.setPieces[field] = playerId;
  return { ok: true, type, playerId };
}

export function ensureLineupResponsibilities(club, { force = false } = {}) {
  ensureCaptain(club, { force });
  ensureSetPieceTakers(club, { force });
  return {
    captainId: club?.tactics?.captainId || null,
    setPieces: { ...(club?.tactics?.setPieces || {}) },
  };
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
  if (!Array.isArray(t.duties)) t.duties = [];
  if (reset || t.roles.length !== need) {
    const next = [];
    const nextDuties = [];
    for (let i = 0; i < need; i++) {
      const prev = !reset && t.roles[i];
      const target = slotPositionCode(slots[i], i, slots);
      if (prev && PLAYER_ROLES[prev] && roleFitsPosition(prev, target)) {
        next.push(prev);
      } else {
        next.push(defaultRoleForSlot(slots[i], i, slots));
      }
      nextDuties.push(normalizeDutyForRole(next[i], !reset ? t.duties[i] : null));
    }
    t.roles = next;
    t.duties = nextDuties;
  } else {
    for (let i = 0; i < need; i++) {
      const rid = t.roles[i];
      const slot = slots[i];
      const target = slotPositionCode(slot, i, slots);
      if (!PLAYER_ROLES[rid] || !roleFitsPosition(rid, target)) {
        t.roles[i] = defaultRoleForSlot(slot, i, slots);
      }
      t.duties[i] = normalizeDutyForRole(t.roles[i], t.duties[i]);
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
    if (t.possessionFormation === undefined) t.possessionFormation = null;
    if (t.outOfPossessionFormation === undefined) t.outOfPossessionFormation = null;
    if (t.possessionFormation !== null && !FORMATIONS[t.possessionFormation]) {
      t.possessionFormation = null;
    }
    if (t.outOfPossessionFormation !== null && !FORMATIONS[t.outOfPossessionFormation]) {
      t.outOfPossessionFormation = null;
    }
    if (!t.style) t.style = d.style;
    if (t.pressing == null) t.pressing = d.pressing;
    if (t.tempo == null) t.tempo = d.tempo;
    if (t.width == null) t.width = d.width;
    if (t.defensiveLine == null) t.defensiveLine = d.defensiveLine;
    if (!Array.isArray(t.lineup)) t.lineup = [];
    if (!Array.isArray(t.roles)) t.roles = [];
    if (!Array.isArray(t.duties)) t.duties = [];
    if (t.corePlayerId === undefined) t.corePlayerId = null;
    if (t.captainId === undefined) t.captainId = null;
    normalizeSetPieces(t);
    t.pressing = Math.max(1, Math.min(5, +t.pressing || 3));
    t.tempo = Math.max(1, Math.min(5, +t.tempo || 3));
    t.width = Math.max(1, Math.min(5, +t.width || 3));
    t.defensiveLine = Math.max(1, Math.min(5, +t.defensiveLine || 3));
  }
  normalizeSetPieces(club.tactics);
  ensureLineupRoles(club);
  // 核心、队长和定位球职责须在当前首发中
  const xi = new Set(club.tactics.lineup || []);
  if (club.tactics.corePlayerId && !xi.has(club.tactics.corePlayerId)) club.tactics.corePlayerId = null;
  if (club.tactics.captainId && !xi.has(club.tactics.captainId)) club.tactics.captainId = null;
  for (const field of Object.values(SET_PIECE_FIELDS)) {
    if (club.tactics.setPieces[field] && !xi.has(club.tactics.setPieces[field])) {
      club.tactics.setPieces[field] = null;
    }
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
  const target = slotPositionCode(slots[idx], idx, slots);
  if (!role || !roleFitsPosition(roleId, target)) {
    return { ok: false, msg: "角色与位置不匹配" };
  }
  club.tactics.roles[idx] = roleId;
  club.tactics.duties[idx] = normalizeDutyForRole(roleId, club.tactics.duties?.[idx]);
  return { ok: true, roleId };
}

/** 设置某槽职责；职责必须属于当前角色。 */
export function setSlotDuty(club, slotIndex, dutyId) {
  ensureTactics(club);
  const idx = +slotIndex;
  if (!Number.isFinite(idx) || idx < 0 || idx >= (club.tactics.roles || []).length) {
    return { ok: false, msg: "无效槽位" };
  }
  const roleId = getSlotRole(club, idx);
  const duty = normalizeDutyForRole(roleId, dutyId);
  if (duty !== dutyId) return { ok: false, msg: "职责与角色不匹配" };
  club.tactics.duties[idx] = duty;
  return { ok: true, dutyId: duty, roleId };
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

export function getSlotDuty(club, slotIndex) {
  ensureTactics(club);
  ensureLineupRoles(club);
  const roleId = getSlotRole(club, slotIndex);
  return normalizeDutyForRole(roleId, club.tactics.duties?.[slotIndex]);
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

/**
 * 自动阵容选人分：能力 × 体能 × 士气 × 近况状态。
 * form 为最近评分均值（约 5–8）；以 6.5 为中性，温和放大/缩小，不压过 OVR 主轴。
 */
function xiSortScore(p, options = {}) {
  const base =
    (p.ovr || 10) * ((p.fitness || 100) / 100) * (0.85 + (p.morale || 70) / 500);
  const form = playerForm(p);
  let score = base;
  // form 5.0 → 0.93 · 6.5 → 1.00 · 7.5 → 1.045 · 8.5 → 1.09（钳制 0.88–1.12）
  if (form != null && !Number.isNaN(Number(form))) {
    const formMul = Math.max(0.88, Math.min(1.12, 1 + (Number(form) - 6.5) * 0.045));
    score *= formMul;
  }

  // AI 密集赛程轮换：重要比赛减轻轮换惩罚，但不会无视真实体能。
  if (options.day != null && p.lastStartedDay != null) {
    const restDays = Math.max(0, Number(options.day) - Number(p.lastStartedDay));
    const rawPenalty = restDays <= 2 ? 0.18 : restDays === 3 ? 0.1 : restDays === 4 ? 0.04 : 0;
    const importance = Math.max(0, Math.min(1, Number(options.importance) || 0.5));
    score *= 1 - rawPenalty * (1 - importance * 0.55);
  }
  const recentStarts = Array.isArray(p.recentStartDays) && options.day != null
    ? p.recentStartDays.filter((day) => Number(options.day) - Number(day) <= 8).length
    : 0;
  if (recentStarts >= 3) score *= 1 - Math.min(0.12, (recentStarts - 2) * 0.05);
  if ((p.returnToPlayDays || 0) > 0) score *= Math.max(0.82, 1 - p.returnToPlayDays * 0.025);
  // 培养原则只在实力接近时给年轻高潜球员一个温和的选人优势，成长仍由训练和出场产生。
  if (
    options.youthPriority === "high" &&
    Number(p.age || 99) <= 21 &&
    Number(p.potential || p.ovr || 0) >= Number(p.ovr || 0) + 2
  ) {
    score *= 1.035;
  }
  if (options.rotation === "fitness") {
    score *= 0.82 + Math.max(0, Math.min(100, Number(p.fitness ?? 70))) / 550;
  }
  return score;
}

function lineupPlayerScore(player, slot, slots, options = {}) {
  const base = xiSortScore(player, options);
  const coverage = positionCoverage(player, slot, slots);
  const groupFit = positionGroup(player?.pos) === positionGroup(slot?.pos) ? 1 : 0.55;
  // 位置适配是现实选人因素，但不会盖过 OVR、体能和近况。
  const fitMultiplier = 0.78 + Math.max(0, Math.min(20, coverage.rating)) / 20 * 0.3;
  return base * groupFit * fitMultiplier;
}

function slotCandidates(club, slot, slots, used, eligibleIds, options = {}) {
  const selectable = (player) =>
    !used.has(player.id) &&
    playerSelectable(player) &&
    (!eligibleIds || eligibleIds.has(player.id));
  const group = positionGroup(slot?.pos);
  const inGroup = (club.players || []).filter((player) => selectable(player) && positionGroup(player.pos) === group);
  const pool = slot?.pos === "GK"
    ? inGroup.filter((player) => player.pos === "GK")
    : inGroup.filter((player) => player.pos !== "GK");
  const candidates = pool.length ? pool : (club.players || []).filter((player) => selectable(player) && (slot?.pos === "GK" ? player.pos === "GK" : player.pos !== "GK"));
  return candidates.sort((a, b) => lineupPlayerScore(b, slot, slots, options) - lineupPlayerScore(a, slot, slots, options));
}

export function autoLineup(club, options = {}) {
  ensureTactics(club);
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const used = new Set();
  const lineup = Array(formation.slots.length).fill(null);
  const eligibleIds = options.eligibleIds instanceof Set ? options.eligibleIds : null;
  const lockedIds = new Set(Array.isArray(options.lockedPlayerIds) ? options.lockedPlayerIds : []);
  const lockedPlayers = club.players
    .filter((p) => lockedIds.has(p.id) && playerSelectable(p) && (!eligibleIds || eligibleIds.has(p.id)))
    .sort((a, b) => xiSortScore(b, options) - xiSortScore(a, options));

  // 先把可用的锁定球员安置到同位置槽；不得已才使用非门将空槽。
  for (const player of lockedPlayers) {
    const eligibleSlots = formation.slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot, index }) => !lineup[index] && positionGroup(slot.pos) === positionGroup(player.pos));
    eligibleSlots.sort((a, b) => lineupPlayerScore(player, b.slot, formation.slots, options) - lineupPlayerScore(player, a.slot, formation.slots, options));
    let slotIndex = eligibleSlots[0]?.index ?? -1;
    if (slotIndex < 0 && player.pos !== "GK") {
      slotIndex = formation.slots.findIndex((slot, index) => !lineup[index] && slot.pos !== "GK");
    }
    if (slotIndex < 0) continue;
    lineup[slotIndex] = player.id;
    used.add(player.id);
  }

  for (let slotIndex = 0; slotIndex < formation.slots.length; slotIndex++) {
    if (lineup[slotIndex]) continue;
    const slot = formation.slots[slotIndex];
    const candidates = slotCandidates(club, slot, formation.slots, used, eligibleIds, options);
    let pickP = candidates[0];
    if (!pickP) {
      pickP = club.players
        .filter((p) => !used.has(p.id) && playerSelectable(p) && (!eligibleIds || eligibleIds.has(p.id)))
        .sort((a, b) => xiSortScore(b, options) - xiSortScore(a, options))[0];
    }
    if (pickP) {
      used.add(pickP.id);
      lineup[slotIndex] = pickP.id;
    }
  }
  club.tactics.lineup = lineup.filter(Boolean);
  ensureLineupRoles(club, { reset: true });
  ensureLineupResponsibilities(club, { force: true });
  return club.tactics.lineup;
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
    const candidates = pool
      .filter((x) => !used.has(x.id) && (slot.pos === "GK" ? x.pos === "GK" : x.pos !== "GK"))
      .sort((a, b) => {
        const ga = positionGroup(a.pos) === positionGroup(slot.pos) ? 1 : 0;
        const gb = positionGroup(b.pos) === positionGroup(slot.pos) ? 1 : 0;
        if (ga !== gb) return gb - ga;
        return positionFitForSlot(b, slot, slots).rating - positionFitForSlot(a, slot, slots).rating;
      });
    const p = candidates[0] || pool.find((x) => !used.has(x.id));
    if (p) used.add(p.id);
    out.push(p || null);
  }
  return out;
}

/**
 * 保留用户已选首发：仅替换伤停/不存在/人数不足的位置
 * AI 队或 lineup 空时退回 autoLineup
 */
export function ensureMatchLineup(
  club,
  {
    forceAuto = false,
    day = null,
    importance = 0.5,
    eligibleIds = null,
    youthPriority = "normal",
    rotation = "balanced",
  } = {}
) {
  ensureTactics(club);
  if (forceAuto || !club.tactics.lineup?.length) {
    return autoLineup(club, { day, importance, eligibleIds, youthPriority, rotation });
  }
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const need = formation.slots.length;
  const map = new Map((club.players || []).map((p) => [p.id, p]));
  const used = new Set();
  const next = [];

  for (let i = 0; i < need; i++) {
    const id = club.tactics.lineup[i];
    const p = id ? map.get(id) : null;
    if (p && playerSelectable(p) && !used.has(p.id) && (!(eligibleIds instanceof Set) || eligibleIds.has(p.id))) {
      used.add(p.id);
      next.push(p.id);
      continue;
    }
    const slot = formation.slots[i];
    const candidates = slotCandidates(
      club,
      slot,
      formation.slots,
      used,
      eligibleIds instanceof Set ? eligibleIds : null,
      { day, importance }
    );
    let pickP = candidates[0];
    if (!pickP) {
      pickP = club.players
        .filter((x) => !used.has(x.id) && playerSelectable(x) && (!(eligibleIds instanceof Set) || eligibleIds.has(x.id)))
        .sort((a, b) => xiSortScore(b, { day, importance }) - xiSortScore(a, { day, importance }))[0];
    }
    if (pickP) {
      used.add(pickP.id);
      next.push(pickP.id);
    }
  }
  club.tactics.lineup = next;
  ensureLineupRoles(club);
  ensureLineupResponsibilities(club);
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
  ensureLineupResponsibilities(club);
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
  ensureLineupResponsibilities(club);
  const slot = formation.slots[idx];
  const coverage = positionCoverage(player, slot, formation.slots);
  const outOfPos = coverage.rating < 10;
  return {
    ok: true,
    outOfPos,
    slotPos: slot?.pos,
    slotDetailedPosition: coverage.target,
    positionRating: coverage.rating,
    playerPos: player.pos,
  };
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
  const byDiv = {};
  for (const c of clubs) {
    const d = c.division || 3;
    if (!byDiv[d]) byDiv[d] = [];
    byDiv[d].push(c.id);
  }
  const all = [];
  const divisions = [...new Set([...DIVISION_IDS, ...Object.keys(byDiv).map(Number)])].sort(
    (a, b) => a - b
  );
  for (const d of divisions) {
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

export function createWorld(userClubId, managerName, lang = "zh") {
  resetIdCounter(1);
  const clubs = CLUB_TEMPLATES.map((t) => {
    const c = createClub(t, lang);
    autoLineup(c);
    return c;
  });
  calibrateWorldAbilityDistribution(clubs);
  for (const club of clubs) {
    autoLineup(club);
    registerSquadNumbers(club, { season: 2026, day: 1, reason: "initial-registration", protectedEntries: {} });
  }
  // staff 延迟到 main/engine ensure，避免 models↔staff 循环

  const user = clubs.find((c) => c.id === userClubId);
  if (!user) throw new Error("invalid club");
  if (!START_DIVISIONS.includes(user.division)) throw new Error("invalid starting division");

  const fixtures = generateAllDivisionFixtures(clubs);
  const table = {};
  for (const c of clubs) {
    table[c.id] = { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  }

  const divName = DIVISIONS[user.division]?.name || "乙级联赛";

  const world = {
    schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
    version: 7,
    abilityDistributionVersion: ABILITY_DISTRIBUTION_VERSION,
    season: 2026,
    day: 1,
    managerName,
    userClubId,
    countryId: user.countryId,
    countryCode: user.countryCode,
    clubs,
    fixtures,
    table,
    seasonOver: false,
    retiredPlayers: [],
    freeAgents: [],
    media: [],
    cup: null, // 旧档兼容；新赛事使用 domesticCups / continentals
    domesticCups: {},
    continentals: {},
    continentalQualifiers: null,
    // 国家队赛事与历史；旧存档由 intl.ensureInternational 惰性迁移
    international: { version: 1, matches: [], competitions: {}, history: [], activeCompetitionId: null },
    poachBids: [],
    scoutingKnowledge: {
      version: 1,
      initialized: false,
      players: {},
      clubs: {},
      divisions: {},
      nations: {},
    },
    scoutMissions: [],
    scoutWatch: [],
    staffMarket: [],
    staffApproaches: [],
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
        text: `${managerName} 正式执教 ${user.name}，从${divName}起步！七国联赛与三项大陆赛事已经启航。`,
      },
    ],
    matchIndex: 0,
  };
  return world;
}

export function clubsInDivision(clubs, division) {
  return clubs.filter((c) => (c.division || 3) === division);
}

/** 旧存档补齐新增俱乐部；稳定 ID 已存在的俱乐部不会被重建。 */
export function ensureWorldClubTemplates(world, lang = "zh") {
  if (!world || !Array.isArray(world.clubs)) return 0;
  if (!world.table) world.table = {};
  const known = new Set(world.clubs.map((c) => c.id));
  let added = 0;
  for (const template of CLUB_TEMPLATES) {
    if (known.has(template.id)) continue;
    const club = createClub(template, lang);
    autoLineup(club);
    registerSquadNumbers(club, {
      season: world.season,
      day: world.day,
      reason: "club-added",
      protectedEntries: {},
    });
    world.clubs.push(club);
    world.table[club.id] = { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    added++;
  }
  if (added > 0) {
    calibrateWorldAbilityDistribution(world.clubs);
    for (const club of world.clubs) autoLineup(club);
    world.abilityDistributionVersion = ABILITY_DISTRIBUTION_VERSION;
  }
  return added;
}

/**
 * 只为完全缺失的联赛追加赛程，保留旧档已有赛程、比分和比赛报告。
 * 返回本次新增的赛程，供加载迁移补齐已经过去的轮次。
 */
export function ensureWorldLeagueFixtures(world) {
  if (!world || !Array.isArray(world.clubs)) return [];
  if (!Array.isArray(world.fixtures)) world.fixtures = [];

  const divisionByClub = new Map(
    world.clubs.map((club) => [club.id, Number(club.division || START_DIVISION)])
  );
  const scheduledDivisions = new Set();
  for (const fixture of world.fixtures) {
    const division = Number(
      fixture.division ||
      divisionByClub.get(fixture.home) ||
      divisionByClub.get(fixture.away)
    );
    if (DIVISIONS[division]) {
      fixture.division = division;
      scheduledDivisions.add(division);
    }
  }

  const added = [];
  for (const division of DIVISION_IDS) {
    if (scheduledDivisions.has(division)) continue;
    const clubIds = clubsInDivision(world.clubs, division).map((club) => club.id);
    if (clubIds.length < 2) continue;
    const fixtures = generateFixtures(clubIds);
    for (const fixture of fixtures) fixture.division = division;
    added.push(...fixtures);
  }

  if (added.length) {
    world.fixtures.push(...added);
    world.fixtures.sort((a, b) => a.day - b.day || a.division - b.division);
  }
  return added;
}

export { DIVISIONS, DIVISION_IDS, START_DIVISION, START_DIVISIONS };

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
  const DAYS_BETWEEN_ROUNDS = 6; // 改为6天间隔，更紧凑的赛程

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
    day += DAYS_BETWEEN_ROUNDS;
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
    // 同一轮多场同一天；每轮结束后间隔
    if ((i + 1) % (clubIds.length / 2) === 0) {
      round++;
      day += DAYS_BETWEEN_ROUNDS;
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
    d += DAYS_BETWEEN_ROUNDS;
  }
  return out;
}

export function formatMoney(n) {
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `€${(n / 1_000).toFixed(0)}K`;
  return `€${n}`;
}

export { CLUB_TEMPLATES, FORMATIONS, rand, pick };
