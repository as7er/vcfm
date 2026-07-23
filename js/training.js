/** 一线队训练日程：重点 + 强度，影响恢复 / 成长 / 伤病 / 士气 */

import { playerOverall, estimateValue, estimateWage } from "./models.js";
import { ensureStaff, staffRating, coachGrowthBonus, doctorHealBonus, doctorInjuryMod } from "./staff.js";
import { trainingGrowthBonus, trainingHealBonus, trainingInjuryMod } from "./facilities.js";
import { allCompetitionFixtures } from "./cup.js";

export const TRAINING_FOCUSES = {
  recovery: {
    key: "recovery",
    label: "恢复调整",
    desc: "优先回体能，几乎不练技术",
    fitnessMod: 1.55,
    fatigue: 0,
    injuryRisk: 0.002,
    growth: 0.01,
    morale: 1,
    attrs: [],
  },
  balanced: {
    key: "balanced",
    label: "综合训练",
    desc: "恢复与成长兼顾",
    fitnessMod: 1.0,
    fatigue: 2,
    injuryRisk: 0.008,
    growth: 0.045,
    morale: 0,
    attrs: null, // 按位置挑
  },
  fitness: {
    key: "fitness",
    label: "体能强化",
    desc: "耐力与爆发，消耗较大",
    fitnessMod: 0.75,
    fatigue: 5,
    injuryRisk: 0.016,
    growth: 0.06,
    morale: -1,
    attrs: ["stamina", "pace", "strength"],
  },
  attack: {
    key: "attack",
    label: "进攻训练",
    desc: "射门、终结、盘带",
    fitnessMod: 0.9,
    fatigue: 3,
    injuryRisk: 0.012,
    growth: 0.055,
    morale: 0,
    attrs: ["shooting", "finishing", "dribbling", "pace"],
  },
  defense: {
    key: "defense",
    label: "防守训练",
    desc: "抢断、盯人、身体对抗",
    fitnessMod: 0.9,
    fatigue: 3,
    injuryRisk: 0.012,
    growth: 0.055,
    morale: 0,
    attrs: ["tackling", "marking", "strength", "positioning"],
  },
  technical: {
    key: "technical",
    label: "技术训练",
    desc: "传球、视野、盘带",
    fitnessMod: 0.95,
    fatigue: 2,
    injuryRisk: 0.008,
    growth: 0.055,
    morale: 0,
    attrs: ["passing", "vision", "dribbling"],
  },
  goalkeeping: {
    key: "goalkeeping",
    label: "门将专项",
    desc: "门将属性优先；外场手几乎不涨",
    fitnessMod: 1.0,
    fatigue: 2,
    injuryRisk: 0.006,
    growth: 0.07,
    morale: 0,
    attrs: ["reflexes", "handling", "positioning", "kicking"],
  },
  match_prep: {
    key: "match_prep",
    label: "赛前准备",
    desc: "轻负荷 + 提士气，适合比赛日前",
    fitnessMod: 1.25,
    fatigue: 1,
    injuryRisk: 0.004,
    growth: 0.02,
    morale: 2,
    attrs: null,
  },
  youth: {
    key: "youth",
    label: "青训侧重",
    desc: "一线轻练；本周青训成长加快",
    fitnessMod: 1.15,
    fatigue: 1,
    injuryRisk: 0.004,
    growth: 0.02,
    morale: 0,
    attrs: [],
    youthGrowthMult: 1.45,
  },
};

export const TRAINING_INTENSITIES = {
  light: {
    key: "light",
    label: "轻松",
    fitnessMod: 1.2,
    fatigueMult: 0.5,
    growthMult: 0.55,
    injuryMult: 0.4,
    morale: 1,
  },
  normal: {
    key: "normal",
    label: "正常",
    fitnessMod: 1.0,
    fatigueMult: 1.0,
    growthMult: 1.0,
    injuryMult: 1.0,
    morale: 0,
  },
  hard: {
    key: "hard",
    label: "高强度",
    fitnessMod: 0.72,
    fatigueMult: 1.55,
    growthMult: 1.55,
    injuryMult: 2.1,
    morale: -1,
  },
};

const POS_ATTRS = {
  GK: ["reflexes", "handling", "positioning", "kicking"],
  DEF: ["tackling", "marking", "strength", "positioning", "stamina"],
  MID: ["passing", "vision", "stamina", "dribbling", "tackling"],
  ATT: ["shooting", "finishing", "pace", "dribbling", "strength"],
};

function rng() {
  return Math.random();
}
function chance(p) {
  return rng() < p;
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function ensureTraining(club) {
  if (!club.training || typeof club.training !== "object") {
    club.training = { focus: "balanced", intensity: "normal" };
  }
  if (!TRAINING_FOCUSES[club.training.focus]) club.training.focus = "balanced";
  if (!TRAINING_INTENSITIES[club.training.intensity]) club.training.intensity = "normal";
  return club.training;
}

export function setTraining(club, { focus, intensity } = {}) {
  const t = ensureTraining(club);
  if (focus && TRAINING_FOCUSES[focus]) t.focus = focus;
  if (intensity && TRAINING_INTENSITIES[intensity]) t.intensity = intensity;
  return t;
}

export function trainingSummary(club) {
  const t = ensureTraining(club);
  const f = TRAINING_FOCUSES[t.focus];
  const i = TRAINING_INTENSITIES[t.intensity];
  return {
    focus: t.focus,
    intensity: t.intensity,
    focusLabel: f.label,
    intensityLabel: i.label,
    desc: f.desc,
    line: `${f.label} · ${i.label}`,
  };
}

/** 青训周成长倍率（训练侧重青训时 >1） */
export function youthTrainingMult(club) {
  const t = ensureTraining(club);
  const f = TRAINING_FOCUSES[t.focus];
  return f.youthGrowthMult || 1;
}

function pickAttrKeys(player, focusCfg) {
  if (focusCfg.key === "goalkeeping") {
    if (player.pos !== "GK") return [];
    return focusCfg.attrs.slice();
  }
  if (Array.isArray(focusCfg.attrs) && focusCfg.attrs.length === 0) return [];
  if (focusCfg.attrs == null) {
    return (POS_ATTRS[player.pos] || POS_ATTRS.MID).slice();
  }
  // 专项：门将只练门将项；外场手跳过纯门将属性
  if (player.pos === "GK") {
    const gk = focusCfg.attrs.filter((k) =>
      ["reflexes", "handling", "positioning", "kicking"].includes(k)
    );
    return gk.length ? gk : POS_ATTRS.GK.slice();
  }
  return focusCfg.attrs.filter((k) => !["reflexes", "handling", "kicking"].includes(k));
}

function ageGrowthFactor(age) {
  if (age == null) return 1;
  if (age <= 21) return 1.25;
  if (age <= 24) return 1.1;
  if (age <= 28) return 1.0;
  if (age <= 31) return 0.55;
  if (age <= 33) return 0.25;
  return 0.08;
}

function growFirstTeamPlayer(player, growthRate, focusCfg) {
  if (!player || player.injured > 0) return false;
  if (!player.potential) player.potential = Math.min(20, (player.ovr || 10) + 1);
  if ((player.ovr || 0) >= player.potential) return false;

  const rate = growthRate * ageGrowthFactor(player.age);
  if (!chance(rate)) return false;

  const keys = pickAttrKeys(player, focusCfg).filter((k) => (player.attrs?.[k] || 0) < 20);
  if (!keys.length) return false;

  const k = keys[Math.floor(rng() * keys.length)];
  player.attrs[k] = Math.min(20, (player.attrs[k] || 1) + 1);
  player.ovr = playerOverall(player);
  player.value = estimateValue(player);
  if (!player.fromYouth || player.age > 18) {
    player.wage = estimateWage(player);
  }
  return true;
}

/**
 * AI：按平均体能 / 是否临近比赛日自动调训练
 * nextMatchDays: 距下一场自己比赛的天数，未知则 null
 */
export function autoPickTraining(club, nextMatchDays = null) {
  ensureStaff(club);
  const players = club.players || [];
  if (!players.length) return ensureTraining(club);

  const fit =
    players.reduce((s, p) => s + (p.fitness || 70), 0) / players.length;
  const injured = players.filter((p) => p.injured > 0).length;

  let focus = "balanced";
  let intensity = "normal";

  if (fit < 62 || injured >= 3) {
    focus = "recovery";
    intensity = "light";
  } else if (nextMatchDays != null && nextMatchDays <= 1) {
    focus = "match_prep";
    intensity = "light";
  } else if (nextMatchDays != null && nextMatchDays <= 3) {
    focus = "match_prep";
    intensity = "normal";
  } else if (fit > 88 && chance(0.35)) {
    focus = pickWeighted([
      ["attack", 1],
      ["defense", 1],
      ["fitness", 1],
      ["technical", 1],
    ]);
    intensity = chance(0.4) ? "hard" : "normal";
  } else if (fit < 75) {
    focus = "recovery";
    intensity = "normal";
  }

  return setTraining(club, { focus, intensity });
}

function pickWeighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of pairs) {
    r -= w;
    if (r <= 0) return k;
  }
  return pairs[0][0];
}

function nextMatchDaysForClub(world, clubId) {
  const fixtures = [
    ...(world.fixtures || []),
    ...allCompetitionFixtures(world),
  ];
  let best = null;
  for (const f of fixtures) {
    if (f.played) continue;
    if (f.home !== clubId && f.away !== clubId) continue;
    const d = (f.day || 0) - (world.day || 0);
    if (d < 0) continue;
    if (best == null || d < best) best = d;
  }
  return best;
}

/**
 * 每日训练结算：体能 / 伤病 / 士气；每周属性成长
 * 用户队保留其设置；AI 队自动微调
 */
export function processTrainingDay(world) {
  const logs = [];

  for (const club of world.clubs || []) {
    ensureStaff(club);
    ensureTraining(club);

    const isUser = club.id === world.userClubId;
    if (!isUser) {
      autoPickTraining(club, nextMatchDaysForClub(world, club.id));
    }

    const t = ensureTraining(club);
    const focus = TRAINING_FOCUSES[t.focus];
    const inten = TRAINING_INTENSITIES[t.intensity];
    const coach = staffRating(club, "coach");
    const healBase =
      (5 + doctorHealBonus(club) + trainingHealBonus(club)) *
      focus.fitnessMod *
      inten.fitnessMod;
    // 教练略提升恢复效率
    const heal = healBase * (0.95 + coach / 20 * 0.1);
    const fatigue = focus.fatigue * inten.fatigueMult;
    const injuryP =
      focus.injuryRisk *
      inten.injuryMult *
      doctorInjuryMod(club) *
      trainingInjuryMod(club);
    const moraleDelta = (focus.morale || 0) + (inten.morale || 0);

    let grewNames = [];
    let injuredNames = [];

    for (const p of club.players || []) {
      if (p.injured > 0) {
        // 伤员：只做恢复向处理，不强制高强度疲劳
        const restHeal = heal * 1.1 + Math.floor(rng() * 3);
        // 体能始终存整数，避免 85.84239999999998% 这种浮点展示
        p.fitness = Math.round(clamp((p.fitness || 50) + restHeal * 0.6, 25, 100));
        const extra = coach >= 14 && chance(0.2) ? 1 : 0;
        p.injured = Math.max(0, p.injured - 1 - extra);
        continue;
      }

      const delta = heal + Math.floor(rng() * 4) - fatigue;
      p.fitness = Math.round(clamp((p.fitness || 80) + delta, 30, 100));

      if (moraleDelta !== 0 && chance(0.35)) {
        p.morale = Math.round(clamp((p.morale || 70) + moraleDelta, 20, 100));
      }

      // 高强度 + 低体能 → 训练伤
      const risk = injuryP * (p.fitness < 55 ? 1.6 : 1);
      if (chance(risk)) {
        p.injured = 1 + Math.floor(rng() * 3);
        p.fitness = Math.round(Math.min(p.fitness, 55));
        if (isUser) injuredNames.push(p.name);
      }
    }

    // 每周：一线队属性成长（教练 + 训练重点）
    if (world.day % 7 === 0) {
      const growthRate =
        focus.growth * inten.growthMult +
        coachGrowthBonus(club) +
        trainingGrowthBonus(club);
      for (const p of club.players || []) {
        if (growFirstTeamPlayer(p, growthRate, focus)) {
          if (isUser) grewNames.push(p.name);
        }
      }
      if (isUser && grewNames.length) {
        const show = grewNames.slice(0, 4).join("、");
        const more = grewNames.length > 4 ? ` 等 ${grewNames.length} 人` : "";
        logs.push({
          day: world.day,
          text: `🏋️ 训练见效：${show}${more} 属性小幅提升（${focus.label}·${inten.label}）`,
        });
      }
    }

    if (isUser && injuredNames.length) {
      logs.push({
        day: world.day,
        text: `⚠️ 训练受伤：${injuredNames.slice(0, 3).join("、")}${
          injuredNames.length > 3 ? " 等" : ""
        }（建议降低强度或改恢复）`,
      });
    }
  }

  for (const n of logs) {
    world.news.unshift(n);
  }
  return logs;
}
