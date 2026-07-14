/**
 * 统一 Inbox 信箱（FM 味：董事会 / 转会报价 / 球探 / 球员诉求）
 * 与 news 并行：news 仍是时间线，inbox 是可处理事项。
 */

import { formatMoney, estimateValue } from "./models.js";
import { ensureContract, needsContractAttention, renewOffer } from "./contracts.js";
import { acceptPoachBid, rejectPoachBid, ensurePoachBids } from "./poaching.js";
import { pushMedia } from "./media.js";
import { isAvailable } from "./discipline.js";

const CAT_LABEL = {
  board: "董事会",
  transfer: "转会",
  scout: "球探",
  player: "球员",
  media: "媒体",
  system: "系统",
};

const CAT_LABEL_EN = {
  board: "Board",
  transfer: "Transfer",
  scout: "Scout",
  player: "Player",
  media: "Media",
  system: "System",
};

function uid() {
  return `ib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function ensureInbox(world) {
  if (!world) return [];
  if (!Array.isArray(world.inbox)) world.inbox = [];
  return world.inbox;
}

export function inboxCatLabel(cat, lang = "zh") {
  return (lang === "en" ? CAT_LABEL_EN : CAT_LABEL)[cat] || cat || "—";
}

/**
 * @param {object} article
 * @param {string} article.category board|transfer|scout|player|media|system
 * @param {string} article.title
 * @param {string} [article.body]
 * @param {number} [article.priority] 1–3
 * @param {object} [article.ref] 处理用引用
 * @param {Array} [article.actions]
 * @param {number} [article.expiresDay]
 * @param {string} [article.dedupeKey] 同 key 未处理则不重复
 */
export function pushInbox(world, article) {
  if (!world || !article?.title) return null;
  ensureInbox(world);

  if (article.dedupeKey) {
    const exists = world.inbox.some(
      (m) =>
        m.dedupeKey === article.dedupeKey &&
        (m.status === "pending" || m.status === "read")
    );
    if (exists) return null;
  }

  const mail = {
    id: article.id || uid(),
    day: world.day || 1,
    season: world.season,
    category: article.category || "system",
    priority: Math.max(1, Math.min(3, article.priority || 1)),
    title: article.title,
    body: article.body || "",
    status: "pending", // pending | read | done | expired
    actions: article.actions || [{ id: "ack", label: "知道了", labelEn: "OK" }],
    ref: article.ref || null,
    expiresDay: article.expiresDay ?? null,
    dedupeKey: article.dedupeKey || null,
    resultNote: null,
  };
  world.inbox.unshift(mail);
  if (world.inbox.length > 80) world.inbox.length = 80;
  return mail;
}

export function listInbox(world, { pendingOnly = false, limit = 40 } = {}) {
  ensureInbox(world);
  let list = world.inbox.slice();
  if (pendingOnly) {
    list = list.filter((m) => m.status === "pending" || m.status === "read");
  }
  // 待处理优先，再按优先级、日期
  list.sort((a, b) => {
    const pa = a.status === "pending" ? 0 : a.status === "read" ? 1 : 2;
    const pb = b.status === "pending" ? 0 : b.status === "read" ? 1 : 2;
    if (pa !== pb) return pa - pb;
    if ((b.priority || 1) !== (a.priority || 1)) return (b.priority || 1) - (a.priority || 1);
    return (b.day || 0) - (a.day || 0);
  });
  return list.slice(0, limit);
}

export function pendingInboxCount(world) {
  ensureInbox(world);
  return world.inbox.filter((m) => m.status === "pending").length;
}

export function markInboxRead(world, mailId) {
  const m = ensureInbox(world).find((x) => x.id === mailId);
  if (!m || m.status !== "pending") return false;
  m.status = "read";
  return true;
}

function finishMail(mail, note) {
  mail.status = "done";
  mail.resultNote = note || null;
  mail.actions = [];
}

/** 把未处理的挖角报价同步进信箱 */
export function syncPoachBidsToInbox(world) {
  if (!world) return;
  ensureInbox(world);
  ensurePoachBids(world);
  for (const bid of world.poachBids) {
    if (bid.status !== "pending") continue;
    const key = `poach_${bid.id}`;
    const existing = world.inbox.find((m) => m.dedupeKey === key);
    if (existing) {
      if (existing.status === "pending" || existing.status === "read") {
        existing.expiresDay = bid.expiresDay;
      }
      continue;
    }
    pushInbox(world, {
      category: "transfer",
      priority: 3,
      title: `${bid.buyerName} 求购 ${bid.playerName}`,
      body: `报价 ${formatMoney(bid.fee)} · ${bid.pos} · 能力 ${bid.ovr}。有效至第 ${bid.expiresDay} 天。可在信箱或转会页处理。`,
      dedupeKey: key,
      expiresDay: bid.expiresDay,
      ref: { kind: "poach", bidId: bid.id },
      actions: [
        { id: "accept", label: "接受报价", labelEn: "Accept", primary: true },
        { id: "reject", label: "拒绝", labelEn: "Reject" },
      ],
    });
  }
  // 报价已处理 → 关闭对应邮件
  for (const m of world.inbox) {
    if (m.ref?.kind !== "poach" || m.status === "done" || m.status === "expired") continue;
    const bid = world.poachBids.find((b) => b.id === m.ref.bidId);
    if (!bid || bid.status !== "pending") {
      finishMail(m, bid ? `已${bid.status === "accepted" ? "接受" : bid.status === "rejected" ? "拒绝" : "失效"}` : "已失效");
    }
  }
}

/** 过期待办 */
export function expireInbox(world) {
  ensureInbox(world);
  const day = world.day || 0;
  for (const m of world.inbox) {
    if (m.status !== "pending" && m.status !== "read") continue;
    if (m.expiresDay != null && day > m.expiresDay) {
      m.status = "expired";
      m.actions = [];
      m.resultNote = m.resultNote || "已过期";
      // 关联挖角：过期由 poaching.expirePoachBids 处理
    }
  }
}

/**
 * 处理邮件动作
 * @returns {{ ok: boolean, msg: string, sacked?: boolean }}
 */
export function resolveInboxAction(world, mailId, actionId) {
  ensureInbox(world);
  const mail = world.inbox.find((m) => m.id === mailId);
  if (!mail) return { ok: false, msg: "邮件不存在" };
  if (mail.status === "done" || mail.status === "expired") {
    return { ok: false, msg: "该事项已处理" };
  }

  const user = world.clubs?.find((c) => c.id === world.userClubId);
  const act = actionId || "ack";

  // —— 挖角 ——
  if (mail.ref?.kind === "poach") {
    if (act === "accept") {
      const res = acceptPoachBid(world, mail.ref.bidId);
      if (res.ok) finishMail(mail, res.msg);
      return res;
    }
    if (act === "reject") {
      const res = rejectPoachBid(world, mail.ref.bidId);
      if (res.ok) finishMail(mail, res.msg);
      return res;
    }
  }

  // —— 董事会知晓 ——
  if (mail.ref?.kind === "board" || mail.category === "board") {
    if (act === "ack" || act === "commit" || act === "deflect") {
      if (act === "commit" && user) {
        for (const p of user.players || []) {
          p.morale = Math.min(100, Math.round((p.morale || 70) + 1));
        }
        finishMail(mail, "已向董事会表态：全力冲击目标");
        world.news = world.news || [];
        world.news.unshift({
          day: world.day,
          text: `📋 你回复董事会：全力冲击「${world.board?.label || "赛季目标"}」。更衣室士气微升。`,
        });
        return { ok: true, msg: "已回复董事会（承诺冲目标）" };
      }
      if (act === "deflect" && user) {
        // 略减董事会压力感：警告 -0（不直接改 sackWarnings 太多）
        if (world.board && (world.board.sackWarnings || 0) > 0 && Math.random() < 0.35) {
          world.board.sackWarnings = Math.max(0, world.board.sackWarnings - 1);
        }
        finishMail(mail, "已请求董事会再给时间");
        world.news = world.news || [];
        world.news.unshift({
          day: world.day,
          text: `📋 你请求董事会再给时间观察。结果未可知。`,
        });
        return { ok: true, msg: "已请求董事会再给时间" };
      }
      finishMail(mail, "已阅");
      return { ok: true, msg: "已阅" };
    }
  }

  // —— 球员约谈 ——
  if (mail.ref?.kind === "player") {
    const p = user?.players?.find((x) => x.id === mail.ref.playerId);
    if (!p) {
      finishMail(mail, "球员已离队");
      return { ok: false, msg: "球员已不在队中" };
    }
    if (act === "praise") {
      p.morale = Math.min(100, Math.round((p.morale || 70) + 5));
      finishMail(mail, `已表扬 ${p.name}`);
      world.news?.unshift({ day: world.day, text: `🗣️ 你表扬了 ${p.name}，士气上升。` });
      return { ok: true, msg: `已表扬 ${p.name}` };
    }
    if (act === "promise") {
      p.morale = Math.min(100, Math.round((p.morale || 70) + 3));
      p._promisedPlay = (world.day || 0) + 14;
      finishMail(mail, `已承诺给 ${p.name} 更多出场`);
      world.news?.unshift({
        day: world.day,
        text: `🗣️ 你向 ${p.name} 承诺近两周增加出场机会。`,
      });
      return { ok: true, msg: `已承诺给 ${p.name} 更多出场` };
    }
    if (act === "rebuff") {
      p.morale = Math.max(20, Math.round((p.morale || 70) - 6));
      finishMail(mail, `已回绝 ${p.name}`);
      world.news?.unshift({ day: world.day, text: `🗣️ 你回绝了 ${p.name} 的诉求，其士气下降。` });
      return { ok: true, msg: `已回绝 ${p.name}` };
    }
    if (act === "renew_hint") {
      // 仅标记，真正续约仍在合同页
      p._wantsRenew = true;
      p.morale = Math.min(100, Math.round((p.morale || 70) + 2));
      finishMail(mail, `已表示愿意谈续约（请到转会/合同处理）`);
      return { ok: true, msg: "已表态愿意谈续约，请到转会页处理合同" };
    }
    if (act === "ack") {
      finishMail(mail, "已阅");
      return { ok: true, msg: "已阅" };
    }
  }

  // —— 球探 ——
  if (mail.ref?.kind === "scout" || mail.category === "scout") {
    if (act === "watch" && mail.ref?.playerId) {
      world.scoutWatch = world.scoutWatch || [];
      if (!world.scoutWatch.includes(mail.ref.playerId)) {
        world.scoutWatch.unshift(mail.ref.playerId);
        if (world.scoutWatch.length > 30) world.scoutWatch.length = 30;
      }
      finishMail(mail, "已加入关注列表");
      return { ok: true, msg: "已加入球探关注列表（可在转会市场留意）" };
    }
    if (act === "ack" || act === "dismiss") {
      finishMail(mail, "已阅");
      return { ok: true, msg: "已阅" };
    }
  }

  // 默认知晓
  if (act === "ack" || act === "ok" || act === "dismiss") {
    finishMail(mail, "已阅");
    return { ok: true, msg: "已阅" };
  }

  return { ok: false, msg: "未知操作" };
}

/** 董事会相关邮件（由 board 模块调用） */
export function pushBoardInbox(world, { title, body, priority = 2, warning = false } = {}) {
  if (!title) return null;
  return pushInbox(world, {
    category: "board",
    priority: warning ? 3 : priority,
    title,
    body: body || "",
    dedupeKey: `board_${world.day}_${title.slice(0, 24)}`,
    ref: { kind: "board" },
    actions: warning
      ? [
          { id: "commit", label: "承诺冲目标", labelEn: "Commit", primary: true },
          { id: "deflect", label: "请求再给时间", labelEn: "Ask for time" },
          { id: "ack", label: "知道了", labelEn: "OK" },
        ]
      : [{ id: "ack", label: "知道了", labelEn: "OK" }],
  });
}

/**
 * 每日信箱脉搏：球员诉求 + 球探简报（低概率）
 */
export function processInboxDay(world) {
  if (!world || world.seasonOver || world.sacked) return;
  ensureInbox(world);
  expireInbox(world);
  syncPoachBidsToInbox(world);

  const user = world.clubs?.find((c) => c.id === world.userClubId);
  if (!user) return;

  // 球员：出场少 / 合同将尽
  if (Math.random() < 0.14) {
    maybePlayerRequest(world, user);
  }
  // 球探：窗内或偶发
  if (Math.random() < 0.1) {
    maybeScoutTip(world, user);
  }
}

function maybePlayerRequest(world, user) {
  const xi = new Set(user.tactics?.lineup || []);
  const candidates = (user.players || [])
    .filter((p) => isAvailable(p) && !p.loan)
    .map((p) => {
      ensureContract(p);
      const apps = p.stats?.apps || p.season?.apps || 0;
      const lowApps = apps < 3 && (world.day || 0) > 20 && (p.ovr || 0) >= 12 && !xi.has(p.id);
      const shortContract = needsContractAttention(p) || (p.contractYears || 2) <= 1;
      const lowMorale = (p.morale || 70) <= 48;
      let score = 0;
      if (lowApps) score += 3;
      if (shortContract) score += 2;
      if (lowMorale) score += 2;
      if (xi.has(p.id) && lowMorale) score += 1;
      return { p, score, lowApps, shortContract, lowMorale };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) return;
  const pick = candidates[0];
  const p = pick.p;
  const key = `player_${p.id}_${pick.lowApps ? "play" : pick.shortContract ? "con" : "mor"}`;
  if (world.inbox.some((m) => m.dedupeKey === key && m.status === "pending")) return;

  if (pick.lowApps) {
    pushInbox(world, {
      category: "player",
      priority: 2,
      title: `${p.name} 要求更多出场时间`,
      body: `${p.name}（${p.pos} · 能力 ${p.ovr}）认为自己坐板凳太久，希望近两周获得稳定机会。处理不当可能影响更衣室。`,
      dedupeKey: key,
      expiresDay: (world.day || 0) + 10,
      ref: { kind: "player", playerId: p.id, topic: "playtime" },
      actions: [
        { id: "promise", label: "承诺出场", labelEn: "Promise minutes", primary: true },
        { id: "praise", label: "安抚表扬", labelEn: "Praise" },
        { id: "rebuff", label: "回绝", labelEn: "Refuse" },
      ],
    });
    return;
  }

  if (pick.shortContract) {
    const offer = renewOffer(p);
    pushInbox(world, {
      category: "player",
      priority: 2,
      title: `${p.name} 想谈续约`,
      body: `合同仅剩 ${p.contractYears ?? "?"} 年。若续约，参考约 ${offer?.years || 3} 年 / 周薪 ${formatMoney(offer?.newWage || p.wage)}（具体仍在转会页操作）。`,
      dedupeKey: key,
      expiresDay: (world.day || 0) + 12,
      ref: { kind: "player", playerId: p.id, topic: "contract" },
      actions: [
        { id: "renew_hint", label: "愿意谈", labelEn: "Open to talks", primary: true },
        { id: "rebuff", label: "暂不考虑", labelEn: "Not now" },
        { id: "ack", label: "稍后处理", labelEn: "Later" },
      ],
    });
    return;
  }

  if (pick.lowMorale) {
    pushInbox(world, {
      category: "player",
      priority: 2,
      title: `${p.name} 士气低落，想见你`,
      body: `当前士气约 ${Math.round(p.morale || 0)}。一次简短约谈可能稳住状态。`,
      dedupeKey: key,
      expiresDay: (world.day || 0) + 7,
      ref: { kind: "player", playerId: p.id, topic: "morale" },
      actions: [
        { id: "praise", label: "鼓励", labelEn: "Encourage", primary: true },
        { id: "rebuff", label: "严词要求", labelEn: "Demand more" },
        { id: "ack", label: "先搁置", labelEn: "Later" },
      ],
    });
  }
}

function maybeScoutTip(world, user) {
  // 找市场上有潜力的外队球员
  const others = (world.clubs || []).filter((c) => c.id !== user.id);
  const pool = [];
  for (const c of others) {
    for (const p of c.players || []) {
      if ((p.age || 30) > 24) continue;
      if ((p.potential || p.ovr || 0) < 14) continue;
      if ((p.injured || 0) > 0) continue;
      pool.push({ p, c });
    }
  }
  if (!pool.length) return;
  const hit = pool[Math.floor(Math.random() * Math.min(12, pool.length))];
  const { p, c } = hit;
  const val = p.value || estimateValue(p);
  const key = `scout_${p.id}`;
  pushInbox(world, {
    category: "scout",
    priority: 1,
    title: `球探报告：关注 ${p.name}`,
    body: `${c.name} 的 ${p.name}（${p.pos} · ${p.age} 岁 · 能力约 ${p.ovr} / 潜力 ${p.potential || "?"}）。估值约 ${formatMoney(val)}。是否加入关注？`,
    dedupeKey: key,
    expiresDay: (world.day || 0) + 14,
    ref: { kind: "scout", playerId: p.id, clubId: c.id },
    actions: [
      { id: "watch", label: "加入关注", labelEn: "Watch", primary: true },
      { id: "dismiss", label: "忽略", labelEn: "Dismiss" },
    ],
  });
  if (Math.random() < 0.4) {
    pushMedia(world, {
      outlet: "午夜足球",
      headline: `球探圈热议：${p.name} 或成下家目标`,
      body: `有消息称多支球队在关注 ${c.short || c.name} 的年轻人 ${p.name}。`,
      tone: "rumor",
      category: "rumor",
    });
  }
}

/** 董事会目标新建时 */
export function pushBoardObjectiveMail(world, board) {
  if (!board) return;
  pushInbox(world, {
    category: "board",
    priority: 2,
    title: `本赛季董事会目标：${board.label}`,
    body: `达成奖金 ${formatMoney(board.bonus)}，未完成罚款 ${formatMoney(board.fine)}。请合理排兵与转会。`,
    dedupeKey: `board_obj_${board.season}`,
    ref: { kind: "board", topic: "objective" },
    actions: [
      { id: "commit", label: "全力以赴", labelEn: "Commit", primary: true },
      { id: "ack", label: "知道了", labelEn: "OK" },
    ],
  });
}
