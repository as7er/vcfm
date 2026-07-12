/** 教练组 / 球探 / 队医 */

import { FIRST_NAMES, LAST_NAMES } from "./data.js";

const ROLES = {
  coach: {
    key: "coach",
    label: "教练",
    desc: "提升比赛表现与训练成长",
    effect: "比赛强度、年轻球员成长",
  },
  scout: {
    key: "scout",
    label: "球探",
    desc: "转会议价与青训苗子质量",
    effect: "买人折扣、市场情报、招生潜力",
  },
  doctor: {
    key: "doctor",
    label: "队医",
    desc: "伤病与体能恢复",
    effect: "受伤概率↓、恢复↑",
  },
};

function rand(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function uid() {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createStaff(role, rating = null) {
  const r = rating != null ? rating : rand(6, 16);
  const wage = Math.max(500, Math.round(r * r * 35));
  return {
    id: uid(),
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    role,
    rating: Math.max(1, Math.min(20, r)),
    wage,
    age: rand(32, 62),
  };
}

export function defaultStaffForClub(club) {
  // 级别越高，初始职员越好
  const base = club.division === 1 ? 12 : club.division === 2 ? 9 : 7;
  return {
    coach: createStaff("coach", base + rand(-1, 2)),
    scout: createStaff("scout", base + rand(-2, 1)),
    doctor: createStaff("doctor", base + rand(-2, 2)),
  };
}

export function ensureStaff(club) {
  if (!club.staff) club.staff = defaultStaffForClub(club);
  for (const role of ["coach", "scout", "doctor"]) {
    if (!club.staff[role]) club.staff[role] = createStaff(role, 8);
  }
  return club.staff;
}

export function staffRating(club, role) {
  ensureStaff(club);
  return club.staff[role]?.rating || 8;
}

/** 教练：比赛强度系数 ~0.96–1.08 */
export function coachMatchMod(club) {
  const r = staffRating(club, "coach");
  return 0.94 + (r / 20) * 0.14;
}

/** 教练：年轻球员周成长额外概率 */
export function coachGrowthBonus(club) {
  return staffRating(club, "coach") * 0.008;
}

/** 球探：买入价格系数（越高越便宜） */
export function scoutBuyMod(club) {
  const r = staffRating(club, "scout");
  return 1.12 - (r / 20) * 0.2; // 0.92–1.12
}

/** 球探：卖出略优 */
export function scoutSellMod(club) {
  const r = staffRating(club, "scout");
  return 0.85 + (r / 20) * 0.2;
}

/** 球探：青训新生潜力加成 */
export function scoutYouthPotBonus(club) {
  return Math.floor(staffRating(club, "scout") / 8); // 0–2
}

/** 队医：受伤概率系数 */
export function doctorInjuryMod(club) {
  const r = staffRating(club, "doctor");
  return 1.15 - (r / 20) * 0.45; // 高评分更不易伤
}

/** 队医：每日恢复加成 */
export function doctorHealBonus(club) {
  return Math.floor(staffRating(club, "doctor") / 5); // 0–4
}

export function staffWageBill(club) {
  ensureStaff(club);
  return ["coach", "scout", "doctor"].reduce(
    (s, k) => s + (club.staff[k]?.wage || 0),
    0
  );
}

/** 可雇佣候选人池 */
export function generateStaffMarket(count = 12) {
  const roles = ["coach", "scout", "doctor"];
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(createStaff(pick(roles), rand(7, 18)));
  }
  return list.sort((a, b) => b.rating - a.rating);
}

export function hireStaff(world, club, candidate, fee) {
  ensureStaff(club);
  if (club.money < fee + candidate.wage * 4) {
    return { ok: false, msg: "资金不足以支付签约费与初期薪水" };
  }
  const role = candidate.role;
  const old = club.staff[role];
  club.money -= fee;
  club.staff[role] = {
    id: candidate.id,
    name: candidate.name,
    role: candidate.role,
    rating: candidate.rating,
    wage: candidate.wage,
    age: candidate.age,
  };
  // 从市场移除
  if (Array.isArray(world.staffMarket)) {
    world.staffMarket = world.staffMarket.filter((s) => s.id !== candidate.id);
  }
  return {
    ok: true,
    msg: `已聘请 ${candidate.name} 担任${ROLES[role].label}（能力 ${candidate.rating}）${
      old ? `，前职员 ${old.name} 离任` : ""
    }`,
    old,
  };
}

export function fireStaff(club, role) {
  ensureStaff(club);
  const s = club.staff[role];
  if (!s) return { ok: false, msg: "没有该职位职员" };
  // 解约补偿 4 周薪水
  const cost = s.wage * 4;
  if (club.money < cost) return { ok: false, msg: `解约补偿不足（需 €${cost}）` };
  club.money -= cost;
  // 换成低水平临时工
  club.staff[role] = createStaff(role, rand(5, 8));
  return {
    ok: true,
    msg: `已与 ${s.name} 解约，临时${ROLES[role].label}已上岗`,
  };
}

export { ROLES };
