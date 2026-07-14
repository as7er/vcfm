/**
 * 世界动态、球探任务、赛季徽章、财政摘要
 */

import { formatMoney, estimateValue } from "./models.js";
import { pushInbox, ensureInbox } from "./inbox.js";
import { pushMedia } from "./media.js";
import { ensureManagerCareer } from "./career.js";
import { staffWageBill, ensureStaff } from "./staff.js";
import { facilityWeeklyUpkeep, ensureFacilities } from "./facilities.js";
import { userSquadWageBill } from "./loans.js";
import { isTransferWindowOpen } from "./transfers.js";

// ---------- 球探任务 ----------

export function ensureScoutMissions(world) {
  if (!Array.isArray(world.scoutMissions)) world.scoutMissions = [];
  return world.scoutMissions;
}

/**
 * 派球探：region div 2/3 或 "intl"
 */
export function startScoutMission(world, region = "div3") {
  if (!world || world.sacked) return { ok: false, msg: "无法派遣" };
  ensureScoutMissions(world);
  if (world.scoutMissions.some((m) => m.status === "active")) {
    return { ok: false, msg: "已有进行中的球探任务" };
  }
  const club = world.clubs.find((c) => c.id === world.userClubId);
  if (!club) return { ok: false, msg: "无球队" };
  const cost = region === "div2" ? 25_000 : region === "intl" ? 40_000 : 15_000;
  if ((club.money || 0) < cost) return { ok: false, msg: `资金不足 ${formatMoney(cost)}` };
  club.money -= cost;
  const days = region === "intl" ? 10 : region === "div2" ? 7 : 5;
  const mission = {
    id: `sm_${world.day}_${Date.now().toString(36)}`,
    region,
    startDay: world.day,
    doneDay: world.day + days,
    status: "active",
    cost,
  };
  world.scoutMissions.unshift(mission);
  world.news = world.news || [];
  const regLabel =
    region === "div2" ? "甲级" : region === "intl" ? "海外/跨级" : "乙级";
  world.news.unshift({
    day: world.day,
    text: `🔍 球探出发：前往${regLabel}搜寻（${days} 天，花费 ${formatMoney(cost)}）`,
  });
  return { ok: true, msg: `球探已出发（${days} 天后回报）`, mission };
}

export function processScoutMissions(world) {
  if (!world || world.seasonOver) return;
  ensureScoutMissions(world);
  for (const m of world.scoutMissions) {
    if (m.status !== "active") continue;
    if ((world.day || 0) < m.doneDay) continue;
    m.status = "done";
    completeScoutMission(world, m);
  }
}

function completeScoutMission(world, mission) {
  const user = world.clubs.find((c) => c.id === world.userClubId);
  if (!user) return;
  const region = mission.region;
  let pool = [];
  for (const c of world.clubs) {
    if (c.id === user.id) continue;
    const div = c.division || 3;
    if (region === "div3" && div !== 3) continue;
    if (region === "div2" && div !== 2) continue;
    if (region === "intl" && div === 3) continue; // 跨级看甲/超
    for (const p of c.players || []) {
      if ((p.age || 30) > 23) continue;
      if ((p.potential || p.ovr || 0) < 13) continue;
      pool.push({ p, c });
    }
  }
  if (!pool.length) {
    pushInbox(world, {
      category: "scout",
      priority: 1,
      title: "球探任务结束：暂无亮点",
      body: "本次出行未发现值得跟进的目标。",
      dedupeKey: `sm_done_${mission.id}`,
      actions: [{ id: "ack", label: "知道了", labelEn: "OK" }],
    });
    return;
  }
  pool.sort(
    (a, b) =>
      (b.p.potential || b.p.ovr) - (a.p.potential || a.p.ovr) || b.p.ovr - a.p.ovr
  );
  const hits = pool.slice(0, 3);
  world.scoutWatch = world.scoutWatch || [];
  const lines = [];
  for (const { p, c } of hits) {
    if (!world.scoutWatch.includes(p.id)) world.scoutWatch.unshift(p.id);
    lines.push(
      `· ${p.name}（${c.short || c.name} · ${p.pos} · ${p.age} 岁 · 能力约 ${p.ovr}/潜 ${p.potential || "?"} · 估值约 ${formatMoney(p.value || estimateValue(p))}）`
    );
  }
  if (world.scoutWatch.length > 30) world.scoutWatch.length = 30;
  pushInbox(world, {
    category: "scout",
    priority: 2,
    title: `球探回报：发现 ${hits.length} 名目标`,
    body: `已自动加入关注列表。\n${lines.join("\n")}`,
    dedupeKey: `sm_done_${mission.id}`,
    ref: { kind: "scout_report", playerIds: hits.map((h) => h.p.id) },
    actions: [
      { id: "ack", label: "很好", labelEn: "Nice", primary: true },
    ],
  });
  pushMedia(world, {
    outlet: "转会电报",
    headline: `${user.short || user.name} 球探网动作频繁`,
    body: `有消息称该队正在物色年轻补强对象。`,
    tone: "rumor",
    category: "rumor",
  });
}

// ---------- 世界动态 ----------

export function processWorldPulse(world) {
  if (!world || world.seasonOver || world.sacked) return;
  if (Math.random() > 0.18) return;
  const user = world.clubs.find((c) => c.id === world.userClubId);
  const others = world.clubs.filter((c) => c.id !== world.userClubId);
  if (!others.length) return;
  const c = others[Math.floor(Math.random() * others.length)];
  const table = world.table?.[c.id];
  const templates = [
    () => ({
      headline: `${c.name} 主帅强调「稳中求进」`,
      body: `面对联赛形势，${c.short || c.name} 更衣室放出「一场一场踢」的信号。`,
      tone: "neutral",
    }),
    () => ({
      headline: `传闻：大俱乐部关注 ${c.short || c.name} 边路`,
      body: `转会圈有小道消息称某支高级别球队在观察其侧翼人选。`,
      tone: "rumor",
    }),
    () => ({
      headline: `${c.name} 近况${table && table.w >= 2 ? "火热" : "起伏"}`,
      body: table
        ? `联赛战绩 ${table.w || 0} 胜 ${table.d || 0} 平 ${table.l || 0} 负。`
        : `赛季仍在推进中。`,
      tone: table && (table.w || 0) > (table.l || 0) ? "positive" : "neutral",
    }),
    () => ({
      headline: `${c.short || c.name} 董事会对成绩表态`,
      body: `俱乐部高层表示「支持主帅，但也需要看见进步」。`,
      tone: "neutral",
    }),
  ];
  const t = templates[Math.floor(Math.random() * templates.length)]();
  pushMedia(world, {
    outlet: Math.random() > 0.5 ? "联赛日报" : "午夜足球",
    headline: t.headline,
    body: t.body,
    tone: t.tone,
    category: "feature",
  });
  // 偶尔进 news
  if (Math.random() < 0.5) {
    world.news = world.news || [];
    world.news.unshift({ day: world.day, text: `🌍 ${t.headline}` });
  }
}

// ---------- 财政 ----------

export function financeSnapshot(world) {
  const club = world?.clubs?.find((c) => c.id === world.userClubId);
  if (!club) return null;
  ensureStaff(club);
  ensureFacilities(club);
  const squadWage = userSquadWageBill(world);
  const youthWage = (club.youth?.players || []).reduce((s, p) => s + (p.wage || 0), 0);
  const staffWage = staffWageBill(club);
  const upkeep = facilityWeeklyUpkeep(club);
  const weekly = squadWage + youthWage + staffWage + upkeep;
  const money = club.money || 0;
  const weeksCover = weekly > 0 ? Math.floor(money / weekly) : 99;
  return {
    money,
    squadWage,
    youthWage,
    staffWage,
    upkeep,
    weekly,
    weeksCover,
    windowOpen: isTransferWindowOpen(world),
    warning: weeksCover < 8,
    critical: weeksCover < 4,
  };
}

// ---------- 青年周报 ----------

export function processYouthPulse(world) {
  if (!world || world.seasonOver) return;
  if ((world.day || 0) % 7 !== 0) return;
  const club = world.clubs.find((c) => c.id === world.userClubId);
  const youth = club?.youth?.players || [];
  if (!youth.length) return;
  const star = [...youth].sort((a, b) => (b.potential || b.ovr) - (a.potential || a.ovr))[0];
  if (!star) return;
  if (Math.random() > 0.55) return;
  world.news = world.news || [];
  world.news.unshift({
    day: world.day,
    text: `🌱 青训周报：${star.name}（${star.pos}）训练积极，潜力档 ${star.potential || "?"} · 教练建议持续观察。`,
  });
}

// ---------- 赛季徽章 ----------

export function checkManagerBadges(world, ctx = {}) {
  const c = ensureManagerCareer(world);
  if (!Array.isArray(c.badges)) c.badges = [];
  const have = new Set(c.badges.map((b) => b.id));
  const grant = (id, title, detail) => {
    if (have.has(id)) return;
    c.badges.unshift({
      id,
      title,
      detail: detail || "",
      season: world.season,
      day: world.day,
    });
    have.add(id);
    world.news = world.news || [];
    world.news.unshift({
      day: world.day,
      text: `🏅 成就解锁：${title}${detail ? ` — ${detail}` : ""}`,
    });
  };

  if ((c.wins || 0) >= 1) grant("first_win", "首胜", "取得任职后第一场胜利");
  if ((c.wins || 0) >= 10) grant("ten_wins", "十场胜利", "生涯胜场达到 10");
  if ((c.matches || 0) >= 50) grant("veteran_mgr", "百炼成钢", "执教满 50 场");
  if ((c.promotions || 0) >= 1) grant("promoted", "升级功臣", "带队升级");
  if ((c.titles || 0) >= 1) grant("champion", "联赛冠军", "捧起联赛奖杯");
  if ((c.cups || 0) >= 1) grant("cup_king", "杯赛荣耀", "问鼎 VCFM 杯");
  if (ctx.winStreak >= 5) grant("streak5", "五连胜", "联赛/杯赛连胜 5 场");
  if (ctx.cleanYouthPromote) grant("youth_star", "青训伯乐", "提拔青训球员进入一线队");

  return c.badges;
}

/** 用户连胜追踪 */
export function noteUserMatchResult(world, myG, opG) {
  if (!world) return;
  if (myG > opG) {
    world._winStreak = (world._winStreak || 0) + 1;
  } else {
    world._winStreak = 0;
  }
  checkManagerBadges(world, { winStreak: world._winStreak || 0 });
}
