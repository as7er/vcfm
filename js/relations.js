/**
 * 更衣室关系 / 约谈 / 氛围（FM 味轻量版）
 * relation: -2..+2（球员对主帅）
 */

import { pushMedia } from "./media.js";

export function ensurePlayerRelation(p) {
  if (!p) return p;
  if (p.relation == null || Number.isNaN(+p.relation)) p.relation = 0;
  p.relation = Math.max(-2, Math.min(2, Math.round(+p.relation)));
  if (p.talkCooldown == null) p.talkCooldown = 0;
  return p;
}

export function ensureSquadRelations(club) {
  for (const p of club?.players || []) ensurePlayerRelation(p);
}

export function relationLabel(rel, lang = "zh") {
  const r = Math.round(rel ?? 0);
  if (lang === "en") {
    if (r >= 2) return "Loyal";
    if (r === 1) return "Warm";
    if (r === 0) return "Neutral";
    if (r === -1) return "Cool";
    return "Hostile";
  }
  if (r >= 2) return "忠心";
  if (r === 1) return "亲近";
  if (r === 0) return "中立";
  if (r === -1) return "疏远";
  return "对立";
}

export function relationTone(rel) {
  const r = Math.round(rel ?? 0);
  if (r >= 1) return "good";
  if (r <= -1) return "bad";
  return "neutral";
}

/** 更衣室氛围 0–100 */
export function clubAtmosphere(club) {
  ensureSquadRelations(club);
  const ps = club?.players || [];
  if (!ps.length) return 50;
  let s = 0;
  for (const p of ps) {
    const mor = p.morale ?? 70;
    const rel = (p.relation ?? 0) * 8;
    s += mor * 0.7 + 50 + rel;
  }
  return Math.round(Math.max(15, Math.min(95, s / ps.length)));
}

export function atmosphereLabel(score, lang = "zh") {
  if (lang === "en") {
    if (score >= 75) return "Buzzing";
    if (score >= 60) return "Settled";
    if (score >= 45) return "Flat";
    if (score >= 30) return "Tense";
    return "Toxic";
  }
  if (score >= 75) return "士气高涨";
  if (score >= 60) return "平稳";
  if (score >= 45) return "平淡";
  if (score >= 30) return "紧张";
  return "火药味";
}

/**
 * 约谈动作
 * @param {"praise"|"criticize"|"promise"|"contract"|"listen"} action
 */
export function applyPlayerTalk(world, playerId, action) {
  const club = world?.clubs?.find((c) => c.id === world.userClubId);
  if (!club) return { ok: false, msg: "无球队" };
  const p = club.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, msg: "球员不在队中" };
  ensurePlayerRelation(p);
  if ((p.talkCooldown || 0) > (world.day || 0)) {
    return {
      ok: false,
      msg: `冷却中，第 ${p.talkCooldown} 天前勿再约谈`,
    };
  }

  let msg = "";
  let dRel = 0;
  let dMor = 0;
  if (action === "praise") {
    dRel = 1;
    dMor = 5;
    msg = `表扬了 ${p.name}`;
  } else if (action === "criticize") {
    dRel = -1;
    dMor = -4;
    msg = `批评了 ${p.name}`;
  } else if (action === "promise") {
    dRel = 1;
    dMor = 3;
    p._promisedPlay = (world.day || 0) + 14;
    p._promiseAppsBase = p.stats?.apps || 0;
    msg = `向 ${p.name} 承诺更多出场`;
  } else if (action === "contract") {
    dRel = 1;
    dMor = 2;
    p._wantsRenew = true;
    msg = `与 ${p.name} 谈了续约意愿（请到转会页操作）`;
  } else if (action === "listen") {
    dRel = 0;
    dMor = 2;
    msg = `倾听了 ${p.name} 的想法`;
  } else {
    return { ok: false, msg: "未知约谈选项" };
  }

  p.relation = Math.max(-2, Math.min(2, (p.relation || 0) + dRel));
  p.morale = Math.max(20, Math.min(100, Math.round((p.morale || 70) + dMor)));
  p.talkCooldown = (world.day || 0) + 7;

  world.news = world.news || [];
  world.news.unshift({
    day: world.day,
    text: `🗣️ ${msg}（关系 ${relationLabel(p.relation)} · 士气 ${Math.round(p.morale)}）`,
  });

  return {
    ok: true,
    msg: `${msg} · 关系→${relationLabel(p.relation)}`,
    player: p,
  };
}

/** 检查承诺出场是否兑现（赛季出场少则伤关系） */
export function processPromiseChecks(world) {
  const club = world?.clubs?.find((c) => c.id === world.userClubId);
  if (!club) return;
  const day = world.day || 0;
  for (const p of club.players || []) {
    if (!p._promisedPlay) continue;
    if (day < p._promisedPlay) continue;
    ensurePlayerRelation(p);
    const apps = p.stats?.apps || 0;
    // 承诺到期：若近两周几乎没上（用场次粗判）— 简化：承诺窗口结束时 apps 未增加则惩罚
    const base = p._promiseAppsBase ?? 0;
    if (apps <= base) {
      p.relation = Math.max(-2, (p.relation || 0) - 1);
      p.morale = Math.max(25, Math.round((p.morale || 70) - 5));
      world.news?.unshift({
        day,
        text: `😤 ${p.name} 认为出场承诺未兑现，关系下降。`,
      });
    } else {
      p.relation = Math.min(2, (p.relation || 0) + 0); // 已在约谈时加过
    }
    delete p._promisedPlay;
    delete p._promiseAppsBase;
  }
}

export function beginPromiseTrack(p) {
  if (!p) return;
  p._promiseAppsBase = p.stats?.apps || 0;
}

/** 每日：氛围新闻 + 低关系可能发信 */
export function processRelationsDay(world) {
  if (!world || world.seasonOver || world.sacked) return;
  const club = world.clubs?.find((c) => c.id === world.userClubId);
  if (!club) return;
  ensureSquadRelations(club);
  processPromiseChecks(world);

  const atm = clubAtmosphere(club);
  club._atmosphere = atm;

  // 低氛围偶发媒体
  if (atm < 35 && Math.random() < 0.12) {
    pushMedia(world, {
      outlet: "更衣室八卦",
      headline: `${club.name} 更衣室气氛凝重`,
      body: `有记者称队内沟通不畅，士气与主帅关系双双承压。`,
      tone: "negative",
      category: "feature",
    });
  } else if (atm >= 78 && Math.random() < 0.08) {
    pushMedia(world, {
      outlet: "球迷之声",
      headline: `${club.short || club.name} 更衣室传出欢声`,
      body: `据悉核心球员对主帅评价正面，训练场笑声不断。`,
      tone: "positive",
      category: "feature",
    });
  }

  // 对立球员 → 返回待投递信箱草稿（由 engine 调用 pushInbox，避免环依赖）
  if (Math.random() < 0.1) {
    const hostile = club.players
      .filter((p) => (p.relation ?? 0) <= -1 && (p.talkCooldown || 0) <= (world.day || 0))
      .sort((a, b) => (a.relation || 0) - (b.relation || 0));
    if (hostile[0]) {
      const p = hostile[0];
      return {
        inboxDraft: {
          category: "player",
          priority: 2,
          title: `${p.name} 要求与你约谈`,
          body: `关系：${relationLabel(p.relation)} · 士气 ${Math.round(p.morale || 0)}。处理不当可能影响更衣室。`,
          dedupeKey: `talk_req_${p.id}`,
          expiresDay: (world.day || 0) + 8,
          ref: { kind: "player_talk", playerId: p.id },
          actions: [
            { id: "praise", label: "安抚表扬", labelEn: "Praise", primary: true },
            { id: "listen", label: "倾听", labelEn: "Listen" },
            { id: "criticize", label: "严词批评", labelEn: "Criticize" },
            { id: "ack", label: "稍后", labelEn: "Later" },
          ],
        },
      };
    }
  }
  return null;
}

/** 关系对个人比赛微小修正（士气已另算） */
export function relationMatchNudge(player) {
  ensurePlayerRelation(player);
  return 1 + (player.relation || 0) * 0.012;
}
