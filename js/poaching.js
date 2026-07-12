/**
 * AI 挖角：窗内对用户队高潜/合同将尽球员出价
 * 用户可在转会页接受/拒绝
 */

import { formatMoney, estimateValue, autoLineup, assignSquadNumbers } from "./models.js";
import { ensureContract } from "./contracts.js";
import { isTransferWindowOpen } from "./transfers.js";
import { ensureStaff, scoutBuyMod } from "./staff.js";
import { pushMedia } from "./media.js";

export function ensurePoachBids(world) {
  if (!Array.isArray(world.poachBids)) world.poachBids = [];
  return world.poachBids;
}

/**
 * 每日有小概率生成挖角报价
 */
export function processPoachingDay(world) {
  if (!world || world.seasonOver || world.sacked) return;
  if (!isTransferWindowOpen(world)) return;
  ensurePoachBids(world);

  // 已有未处理报价则不再刷
  if (world.poachBids.some((b) => b.status === "pending")) return;
  if (Math.random() > 0.12) return;

  const user = world.clubs.find((c) => c.id === world.userClubId);
  if (!user || user.players.length <= 15) return;

  // 目标：合同短 / 年轻高潜 / 能力高
  const candidates = user.players
    .filter((p) => {
      ensureContract(p);
      if ((p.injured || 0) > 0) return false;
      if ((p.contractYears || 0) <= 1) return true;
      if (p.age <= 23 && (p.potential || p.ovr) >= 14) return true;
      if (p.ovr >= 15) return Math.random() < 0.4;
      return false;
    })
    .sort((a, b) => b.ovr - a.ovr);

  if (!candidates.length) return;
  const target = candidates[Math.floor(Math.random() * Math.min(4, candidates.length))];

  const buyers = world.clubs.filter(
    (c) => c.id !== user.id && c.players.length < 26 && (c.money || 0) > target.value * 0.6
  );
  if (!buyers.length) return;
  // 偏好更高级别 / 有钱俱乐部
  buyers.sort((a, b) => (a.division || 3) - (b.division || 3) || b.money - a.money);
  const buyer = buyers[Math.floor(Math.random() * Math.min(5, buyers.length))];

  ensureStaff(buyer);
  const mult = 0.95 + Math.random() * 0.35 + ((target.contractYears || 1) <= 1 ? 0.1 : 0);
  const fee = Math.round((target.value || estimateValue(target)) * mult);

  const bid = {
    id: `poach_${world.day}_${target.id}_${Date.now()}`,
    day: world.day,
    playerId: target.id,
    playerName: target.name,
    pos: target.pos,
    ovr: target.ovr,
    fromClubId: user.id,
    buyerId: buyer.id,
    buyerName: buyer.name,
    fee,
    status: "pending", // pending | accepted | rejected | expired
    expiresDay: world.day + 5,
  };
  world.poachBids.unshift(bid);
  if (world.poachBids.length > 20) world.poachBids.length = 20;

  world.news.unshift({
    day: world.day,
    text: `📞 ${buyer.name} 报价 ${formatMoney(fee)} 求购 ${target.name}（你可在转会页处理，${bid.expiresDay - world.day} 天内有效）`,
  });
}

/** 过期未处理 → 自动拒绝 */
export function expirePoachBids(world) {
  ensurePoachBids(world);
  for (const b of world.poachBids) {
    if (b.status !== "pending") continue;
    if ((world.day || 0) > b.expiresDay) {
      b.status = "expired";
    }
  }
}

export function acceptPoachBid(world, bidId) {
  ensurePoachBids(world);
  if (!isTransferWindowOpen(world)) {
    return { ok: false, msg: "转会窗已关闭" };
  }
  const bid = world.poachBids.find((b) => b.id === bidId);
  if (!bid || bid.status !== "pending") return { ok: false, msg: "报价无效或已处理" };

  const user = world.clubs.find((c) => c.id === world.userClubId);
  const buyer = world.clubs.find((c) => c.id === bid.buyerId);
  if (!user || !buyer) return { ok: false, msg: "俱乐部无效" };
  if (user.players.length <= 14) return { ok: false, msg: "阵容过少，无法放人" };

  const idx = user.players.findIndex((p) => p.id === bid.playerId);
  if (idx < 0) {
    bid.status = "expired";
    return { ok: false, msg: "球员已不在队中" };
  }
  const player = user.players[idx];
  user.players.splice(idx, 1);
  user.money += bid.fee;
  player.clubId = buyer.id;
  player.number = null;
  player.morale = Math.min(100, (player.morale || 70) + 5);
  buyer.players.push(player);
  buyer.money = Math.max(0, buyer.money - bid.fee);
  assignSquadNumbers(buyer);
  autoLineup(user);
  autoLineup(buyer);
  bid.status = "accepted";

  world.news.unshift({
    day: world.day,
    text: `🤝 接受 ${buyer.name} 报价，售出 ${player.name}，收入 ${formatMoney(bid.fee)}`,
  });
  pushMedia(world, {
    outlet: "转会速递",
    headline: `${player.name} 加盟 ${buyer.name}`,
    body: `${user.name} 接受了 ${formatMoney(bid.fee)} 的报价，转会尘埃落定。`,
    tone: "neutral",
    category: "transfer",
  });
  return { ok: true, msg: `已售出 ${player.name}，收入 ${formatMoney(bid.fee)}` };
}

export function rejectPoachBid(world, bidId) {
  ensurePoachBids(world);
  const bid = world.poachBids.find((b) => b.id === bidId);
  if (!bid || bid.status !== "pending") return { ok: false, msg: "报价无效或已处理" };
  bid.status = "rejected";
  // 小幅士气
  const user = world.clubs.find((c) => c.id === world.userClubId);
  const p = user?.players.find((x) => x.id === bid.playerId);
  if (p) p.morale = Math.max(20, (p.morale || 70) - 3);
  world.news.unshift({
    day: world.day,
    text: `🚫 拒绝 ${bid.buyerName} 对 ${bid.playerName} 的报价（${formatMoney(bid.fee)}）`,
  });
  return { ok: true, msg: `已拒绝 ${bid.buyerName} 的报价` };
}

export function pendingPoachBids(world) {
  ensurePoachBids(world);
  expirePoachBids(world);
  return world.poachBids.filter((b) => b.status === "pending");
}
