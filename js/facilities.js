/**
 * 俱乐部设施：球场 / 训练基地 / 青训学院
 * 升级有建设工期，完工后生效。
 */

import { formatMoney, YOUTH_LEVELS, YOUTH_UPGRADE_COST, ensureYouthAcademy, fillYouthSquad } from "./models.js";
import { DIVISIONS } from "./data.js";

export const FACILITY_MAX = 5;

/** 球场等级：容量、主场比赛日收入、周维护 */
export const STADIUM_LEVELS = {
  1: { name: "社区球场", capacity: 4_000, matchday: 45_000, upkeep: 8_000 },
  2: { name: "区级球场", capacity: 8_000, matchday: 90_000, upkeep: 18_000 },
  3: { name: "职业球场", capacity: 15_000, matchday: 180_000, upkeep: 40_000 },
  4: { name: "现代化主场", capacity: 28_000, matchday: 350_000, upkeep: 80_000 },
  5: { name: "地标球场", capacity: 45_000, matchday: 600_000, upkeep: 140_000 },
};

/** 训练设施：成长加成、恢复加成、伤病风险系数 */
export const TRAINING_FACILITY_LEVELS = {
  1: { name: "简易训练场", growth: 0, heal: 0, injuryMod: 1.0, upkeep: 5_000 },
  2: { name: "标准训练中心", growth: 0.012, heal: 1, injuryMod: 0.92, upkeep: 15_000 },
  3: { name: "专业训练基地", growth: 0.025, heal: 2, injuryMod: 0.85, upkeep: 35_000 },
  4: { name: "高科技训练中心", growth: 0.04, heal: 3, injuryMod: 0.78, upkeep: 70_000 },
  5: { name: "世界级训练城", growth: 0.055, heal: 4, injuryMod: 0.7, upkeep: 120_000 },
};

/** 升级费用（升到该级） */
export const STADIUM_UPGRADE_COST = {
  2: 3_000_000,
  3: 8_000_000,
  4: 18_000_000,
  5: 40_000_000,
};

export const TRAINING_FACILITY_COST = {
  2: 1_500_000,
  3: 4_000_000,
  4: 10_000_000,
  5: 22_000_000,
};

/** 建设天数（升到该级） */
export const BUILD_DAYS = {
  stadium: { 2: 14, 3: 21, 4: 28, 5: 35 },
  training: { 2: 10, 3: 14, 4: 21, 5: 28 },
  youth: { 2: 12, 3: 18, 4: 24, 5: 30 },
};

const LABELS = {
  stadium: "球场",
  training: "训练设施",
  youth: "青训设施",
};

export function ensureFacilities(club) {
  if (!club) return null;
  const ya = ensureYouthAcademy(club);
  if (!club.facilities || typeof club.facilities !== "object") {
    const tier = DIVISIONS[club.division || 3]?.tier || 3;
    club.facilities = {
      stadium: tier === 1 ? 3 : tier === 2 ? 2 : 1,
      training: tier === 1 ? 2 : 1,
      youth: ya.level || 1,
      projects: [], // { kind, from, to, finishDay, cost, name }
    };
  }
  const f = club.facilities;
  if (f.stadium == null) f.stadium = 1;
  if (f.training == null) f.training = 1;
  // 与 youth.level 双向对齐：取较高者
  if (f.youth == null) f.youth = ya.level || 1;
  if ((ya.level || 1) > f.youth) f.youth = ya.level;
  if (f.youth > (ya.level || 1)) ya.level = f.youth;
  if (!Array.isArray(f.projects)) f.projects = [];
  f.stadium = clampLv(f.stadium);
  f.training = clampLv(f.training);
  f.youth = clampLv(f.youth);
  return f;
}

function clampLv(n) {
  return Math.max(1, Math.min(FACILITY_MAX, Number(n) || 1));
}

export function facilityLevel(club, kind) {
  const f = ensureFacilities(club);
  return f?.[kind] || 1;
}

export function stadiumInfo(club) {
  const lv = facilityLevel(club, "stadium");
  return { level: lv, ...(STADIUM_LEVELS[lv] || STADIUM_LEVELS[1]) };
}

export function trainingFacilityInfo(club) {
  const lv = facilityLevel(club, "training");
  return { level: lv, ...(TRAINING_FACILITY_LEVELS[lv] || TRAINING_FACILITY_LEVELS[1]) };
}

export function youthFacilityInfo(club) {
  const lv = facilityLevel(club, "youth");
  const y = YOUTH_LEVELS[lv] || YOUTH_LEVELS[1];
  return {
    level: lv,
    name: y.name,
    capacity: y.capacity,
    intake: y.intake,
    growth: y.growth,
    upkeep: y.upkeep,
  };
}

export function isBuilding(club, kind) {
  const f = ensureFacilities(club);
  return (f.projects || []).some((p) => p.kind === kind);
}

export function getProject(club, kind) {
  const f = ensureFacilities(club);
  return (f.projects || []).find((p) => p.kind === kind) || null;
}

function upgradeCost(kind, nextLv) {
  if (kind === "stadium") return STADIUM_UPGRADE_COST[nextLv];
  if (kind === "training") return TRAINING_FACILITY_COST[nextLv];
  if (kind === "youth") return YOUTH_UPGRADE_COST[nextLv];
  return null;
}

function levelName(kind, lv) {
  if (kind === "stadium") return STADIUM_LEVELS[lv]?.name || `Lv.${lv}`;
  if (kind === "training") return TRAINING_FACILITY_LEVELS[lv]?.name || `Lv.${lv}`;
  if (kind === "youth") return YOUTH_LEVELS[lv]?.name || `Lv.${lv}`;
  return `Lv.${lv}`;
}

/**
 * 开工升级（扩建/新建看台/训练/青训）
 * world.day 用于计算完工日
 */
export function startFacilityUpgrade(world, clubId, kind) {
  if (!["stadium", "training", "youth"].includes(kind)) {
    return { ok: false, msg: "未知设施类型" };
  }
  const club = world.clubs.find((c) => c.id === clubId);
  if (!club) return { ok: false, msg: "球队不存在" };
  if (world.sacked && clubId === world.userClubId) {
    return { ok: false, msg: "你已被解雇，无法动工" };
  }

  const f = ensureFacilities(club);
  if (isBuilding(club, kind)) {
    const p = getProject(club, kind);
    return {
      ok: false,
      msg: `${LABELS[kind]}施工中（约第 ${p.finishDay} 天完工）`,
    };
  }

  const cur = f[kind] || 1;
  if (cur >= FACILITY_MAX) return { ok: false, msg: `${LABELS[kind]}已满级` };

  const next = cur + 1;
  const cost = upgradeCost(kind, next);
  if (cost == null) return { ok: false, msg: "无法升级" };
  if (club.money < cost) {
    return { ok: false, msg: `资金不足，需要 ${formatMoney(cost)}` };
  }

  const days = (BUILD_DAYS[kind] && BUILD_DAYS[kind][next]) || 14;
  club.money -= cost;

  const verb =
    kind === "stadium"
      ? next >= 4
        ? "新建"
        : "扩建"
      : kind === "training"
        ? next >= 4
          ? "新建"
          : "升级"
        : "升级";

  const project = {
    kind,
    from: cur,
    to: next,
    finishDay: (world.day || 1) + days,
    cost,
    name: levelName(kind, next),
    verb,
  };
  f.projects.push(project);

  const label = LABELS[kind];
  world.news.unshift({
    day: world.day,
    text: `🏗️ ${club.name} ${verb}${label}：目标「${project.name}」（Lv.${next}），工期 ${days} 天，花费 ${formatMoney(cost)}`,
  });

  return {
    ok: true,
    msg: `已开工${verb}${label} → ${project.name}（${days} 天后完工，${formatMoney(cost)}）`,
    project,
  };
}

/** 兼容旧青训升级按钮：走设施工期系统 */
export function upgradeYouthAcademy(world, clubId) {
  return startFacilityUpgrade(world, clubId, "youth");
}

/**
 * 每日：检查完工
 */
export function processFacilityDay(world) {
  if (!world || world.seasonOver) return;
  for (const club of world.clubs || []) {
    const f = ensureFacilities(club);
    if (!f.projects.length) continue;
    const remain = [];
    for (const p of f.projects) {
      if ((world.day || 0) < p.finishDay) {
        remain.push(p);
        continue;
      }
      // 完工
      f[p.kind] = p.to;
      if (p.kind === "youth") {
        const ya = ensureYouthAcademy(club);
        ya.level = p.to;
        fillYouthSquad(
          club,
          Math.min(ya.players.length + 1, (YOUTH_LEVELS[p.to] || YOUTH_LEVELS[1]).capacity)
        );
      }
      if (club.id === world.userClubId) {
        world.news.unshift({
          day: world.day,
          text: `✅ 设施竣工：${LABELS[p.kind]}「${p.name}」已投入使用（Lv.${p.to}）`,
        });
      }
    }
    f.projects = remain;
  }
}

/** 周维护：球场 + 训练 + 青训（青训在 processYouthDay 已扣一份，这里只扣球场和训练，避免双扣） */
export function facilityWeeklyUpkeep(club) {
  ensureFacilities(club);
  const st = stadiumInfo(club);
  const tr = trainingFacilityInfo(club);
  return (st.upkeep || 0) + (tr.upkeep || 0);
}

/** 主场比赛日收入（含上座波动） */
export function matchdayIncome(club, { isCup = false, won = false } = {}) {
  const st = stadiumInfo(club);
  let base = st.matchday || 40_000;
  if (isCup) base *= 0.75;
  // 上座 75%–100%
  const fill = 0.75 + Math.random() * 0.25;
  let income = Math.round(base * fill);
  if (won) income = Math.round(income * 1.08);
  // 联赛级别微调
  const tier = DIVISIONS[club.division || 3]?.tier || 3;
  if (tier === 1) income = Math.round(income * 1.25);
  else if (tier === 2) income = Math.round(income * 1.1);
  return income;
}

export function trainingGrowthBonus(club) {
  return trainingFacilityInfo(club).growth || 0;
}

export function trainingHealBonus(club) {
  return trainingFacilityInfo(club).heal || 0;
}

export function trainingInjuryMod(club) {
  return trainingFacilityInfo(club).injuryMod ?? 1;
}

export function facilitySummaryLine(club) {
  const st = stadiumInfo(club);
  const tr = trainingFacilityInfo(club);
  const y = youthFacilityInfo(club);
  const building = (ensureFacilities(club).projects || [])
    .map((p) => `${LABELS[p.kind]}施工中`)
    .join(" · ");
  const base = `球场 Lv.${st.level} · 训练 Lv.${tr.level} · 青训 Lv.${y.level}`;
  return building ? `${base}（${building}）` : base;
}

export { LABELS as FACILITY_LABELS };
