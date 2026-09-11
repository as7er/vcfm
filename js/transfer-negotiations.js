/**
 * 用户买入谈判：俱乐部审核 -> 球员合同审核 -> 成交。
 *
 * 存档只保存 ID、金额、合同条款与状态；球员和俱乐部始终从 world.clubs 解析，
 * 避免复制对象后出现阵容、财政与页面数据不一致。
 */

import {
  assignSquadNumbers,
  autoLineup,
  estimateValue,
  estimateWage,
  formatMoney,
  archiveClubSeasonStats,
} from "./models.js";
import { ensureContract } from "./contracts.js";
import { mediaTransfer } from "./media.js";
import { isTransferWindowOpen, transferWindowLabel } from "./transfers.js";
import { POS_LABEL } from "./data.js";
import { recordFinanceEntry } from "./finance-ledger.js";
import { clubTransferBudget } from "./club-finance.js";
import { buildTransferPaymentPlan, settleTransferAgreement } from "./finance-obligations.js";
import { shouldBuyPosition } from "./squad-balance.js";
import {
  ACTIVE_DEAL_NEGOTIATION_STATUSES,
  ACTIVE_TRANSFER_NEGOTIATION_STATUSES,
  activeDealCashCommitments,
  activeTransferCashCommitments,
  transferNegotiationCashCost,
} from "./cash-reservations.js";

export {
  ACTIVE_TRANSFER_NEGOTIATION_STATUSES,
  activeTransferCashCommitments,
  transferNegotiationCashCost,
};

const MAX_SQUAD = 28;
const MIN_SELLER_SQUAD = 14;
const MAX_HISTORY = 60;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function money(n) {
  return Math.max(0, Math.round(Number(n) || 0));
}

function hasActiveDealNegotiation(world, playerId) {
  return (world.dealNegotiations || []).some(
    (negotiation) =>
      negotiation.playerId === playerId &&
      ACTIVE_DEAL_NEGOTIATION_STATUSES.has(negotiation.status)
  );
}

function signingBonus(wage, years) {
  return Math.round(money(wage) * clamp(Math.round(Number(years) || 3), 1, 5) * 0.5);
}

function transferPaymentTerms(
  fee,
  { upfrontPct = 100, installmentCount = 0, appearanceBonus = 0, appearanceTarget = 20, sellOnPct = 0 } = {}
) {
  const plan = buildTransferPaymentPlan(fee, upfrontPct, installmentCount);
  return {
    upfrontPct: plan.upfrontPct,
    installmentCount: plan.installmentCount,
    appearanceBonus: money(appearanceBonus),
    appearanceTarget: Math.max(5, Math.min(50, Math.round(Number(appearanceTarget) || 20))),
    sellOnPct: Math.max(0, Math.min(30, Math.round(Number(sellOnPct) || 0))),
  };
}

function aiTransferPaymentTerms(fee, random = Math.random) {
  const total = money(fee);
  // Keep ordinary one-million-class deals cash-settled for legacy negotiation flows;
  // meaningful multi-million AI bids expose the same structured terms as the user UI.
  if (total < 1_200_000) return transferPaymentTerms(total);
  const installmentCount = total >= 4_000_000 ? 3 : total >= 1_200_000 ? 2 : 1;
  const upfrontPct = installmentCount >= 2 ? 60 : 70;
  return transferPaymentTerms(total, {
    upfrontPct,
    installmentCount,
    appearanceBonus: Math.round(total * (0.05 + random() * 0.05)),
    appearanceTarget: 20,
    sellOnPct: 8 + Math.floor(random() * 5),
  });
}

function negotiationId(world) {
  const serial = (Number(world._transferNegotiationSerial) || 0) + 1;
  world._transferNegotiationSerial = serial;
  return `tn_${world.season || 0}_${world.day || 0}_${serial}`;
}

function clubById(world, id) {
  return world?.clubs?.find((club) => club.id === id) || null;
}

function playerAtClub(club, playerId) {
  return club?.players?.find((player) => player.id === playerId) || null;
}

function hasTransferEmbargo(club) {
  return !!(club?.finance?.debtPlan?.transferEmbargo || club?.finance?.compliance?.transferEmbargo);
}

function setStatus(world, negotiation, status, extra = {}) {
  negotiation.status = status;
  negotiation.updatedDay = world.day || 0;
  negotiation.revision = (Number(negotiation.revision) || 0) + 1;
  Object.assign(negotiation, extra);
  return negotiation;
}

function stopNegotiation(world, negotiation, status, reason, rejectedBy = null) {
  const stopped = setStatus(world, negotiation, status, {
    reason,
    rejectedBy,
    decisionDay: null,
    finishedDay: world.day || 0,
  });
  if (negotiation.kind === "user_sell" && negotiation.sourceBidId) {
    const sourceBid = (world.poachBids || []).find((bid) => bid.id === negotiation.sourceBidId);
    if (sourceBid?.status === "negotiating") {
      sourceBid.status = status === "rejected" ? "rejected" : "expired";
    }
  }
  return stopped;
}

function nextDecisionDay(world, random = Math.random) {
  return (world.day || 0) + (random() < 0.5 ? 1 : 2);
}

export function ensureTransferNegotiations(world) {
  if (!world) return [];
  if (!Array.isArray(world.transferNegotiations)) world.transferNegotiations = [];
  if (!Number.isFinite(Number(world._transferNegotiationSerial))) {
    world._transferNegotiationSerial = world.transferNegotiations.length;
  }
  return world.transferNegotiations;
}

export function isActiveTransferNegotiation(negotiation) {
  return !!negotiation && ACTIVE_TRANSFER_NEGOTIATION_STATUSES.has(negotiation.status);
}

export function findActiveTransferNegotiation(world, playerId) {
  return ensureTransferNegotiations(world).find(
    (negotiation) =>
      negotiation.kind === "user_buy" &&
      negotiation.playerId === playerId &&
      isActiveTransferNegotiation(negotiation)
  ) || null;
}

export function findActiveSaleNegotiation(world, playerId) {
  return ensureTransferNegotiations(world).find(
    (negotiation) =>
      negotiation.kind === "user_sell" &&
      negotiation.playerId === playerId &&
      isActiveTransferNegotiation(negotiation)
  ) || null;
}

export function listTransferNegotiations(world, { limit = 16 } = {}) {
  return ensureTransferNegotiations(world)
    .slice()
    .sort((a, b) => {
      const activeDiff = Number(isActiveTransferNegotiation(b)) - Number(isActiveTransferNegotiation(a));
      if (activeDiff) return activeDiff;
      return (b.updatedDay || b.createdDay || 0) - (a.updatedDay || a.createdDay || 0);
    })
    .slice(0, Math.max(1, limit));
}

function validateLiveDeal(
  world,
  negotiation,
  { checkFunds = true, checkReservedFunds = false } = {}
) {
  if (!world || world.sacked) return { ok: false, reason: "经理当前无法处理俱乐部转会" };
  if (world.userClubId !== negotiation.buyerClubId) {
    return { ok: false, reason: "你已不再执教发起报价的俱乐部" };
  }
  if (!isTransferWindowOpen(world)) {
    return { ok: false, reason: `转会窗已关闭：${transferWindowLabel(world)}` };
  }
  const buyer = clubById(world, negotiation.buyerClubId);
  const seller = clubById(world, negotiation.sellerClubId);
  if (!buyer || !seller || buyer.id === seller.id) {
    return { ok: false, reason: "交易俱乐部已不存在" };
  }
  if (hasTransferEmbargo(buyer)) return { ok: false, reason: "买方处于财政转会限制期" };
  const player = playerAtClub(seller, negotiation.playerId);
  if (!player) return { ok: false, reason: "球员已经离开卖方俱乐部" };
  if (player.loan) return { ok: false, reason: "球员当前处于租借关系，无法完成永久转会" };
  if (hasActiveDealNegotiation(world, player.id)) {
    return { ok: false, reason: "球员已有进行中的续约或租借谈判" };
  }
  if ((buyer.players || []).length >= MAX_SQUAD) {
    return { ok: false, reason: `买方阵容已满（最多 ${MAX_SQUAD} 人）` };
  }
  if ((seller.players || []).length <= MIN_SELLER_SQUAD) {
    return { ok: false, reason: "卖方一线队人数不足，无法继续出售" };
  }
  const dealCost = transferNegotiationCashCost(negotiation);
  const reserved = checkReservedFunds
    ? activeTransferCashCommitments(world, buyer.id, { excludeId: negotiation.id }) +
      activeDealCashCommitments(world, buyer.id)
    : 0;
  if (checkFunds && (Number(buyer.money) || 0) - reserved < dealCost) {
    return {
      ok: false,
      reason: checkReservedFunds && reserved > 0
        ? `未承诺现金不足：其他谈判已占用 ${formatMoney(reserved)}，本交易需要 ${formatMoney(dealCost)}`
        : `资金不足，需要 ${formatMoney(dealCost)}`,
    };
  }
  return { ok: true, buyer, seller, player };
}

/**
 * 提交用户买入报价。条款使用实际金额，不保存球员/俱乐部对象。
 */
export function submitTransferNegotiation(
  world,
  playerId,
  sellerClubId,
  {
    fee,
    years = 3,
    wage,
    upfrontPct = 100,
    installmentCount = 0,
    appearanceBonus = 0,
    appearanceTarget = 20,
    sellOnPct = 0,
    random = Math.random,
  } = {}
) {
  ensureTransferNegotiations(world);
  if (!world || world.sacked) return { ok: false, msg: "你当前无法操作转会" };
  if (!isTransferWindowOpen(world)) {
    return { ok: false, msg: `转会窗已关闭。${transferWindowLabel(world)}` };
  }
  const buyer = clubById(world, world.userClubId);
  const seller = clubById(world, sellerClubId);
  if (!buyer || !seller || buyer.id === seller.id) return { ok: false, msg: "无效的卖方俱乐部" };
  if (hasTransferEmbargo(buyer)) return { ok: false, msg: "俱乐部处于财政转会限制期" };
  const player = playerAtClub(seller, playerId);
  if (!player) return { ok: false, msg: "球员已不在该俱乐部" };
  if (player.loan) return { ok: false, msg: "租借球员不可进行永久转会谈判" };
  if (findActiveTransferNegotiation(world, playerId)) {
    return { ok: false, msg: "该球员已有一项进行中的买入谈判" };
  }
  if (hasActiveDealNegotiation(world, playerId)) {
    return { ok: false, msg: "该球员已有进行中的续约或租借谈判" };
  }
  if ((buyer.players || []).length >= MAX_SQUAD) return { ok: false, msg: "阵容已满（最多 28 人）" };
  if ((seller.players || []).length <= MIN_SELLER_SQUAD) {
    return { ok: false, msg: "对方一线队人数不足，拒绝开启谈判" };
  }

  const offeredFee = money(fee);
  const contractYears = clamp(Math.round(Number(years) || 3), 1, 5);
  const offeredWage = money(wage);
  if (offeredFee <= 0) return { ok: false, msg: "转会费报价必须大于 0" };
  if (offeredWage <= 0) return { ok: false, msg: "合同周薪必须大于 0" };
  const bonus = signingBonus(offeredWage, contractYears);
  const paymentTerms = transferPaymentTerms(offeredFee, {
    upfrontPct,
    installmentCount,
    appearanceBonus,
    appearanceTarget,
    sellOnPct,
  });
  const draft = { fee: offeredFee, wage: offeredWage, years: contractYears, ...paymentTerms };
  const reserved = activeTransferCashCommitments(world, buyer.id) +
    activeDealCashCommitments(world, buyer.id);
  const immediateCost = transferNegotiationCashCost(draft);
  if ((Number(buyer.money) || 0) - reserved < immediateCost) {
    return {
      ok: false,
      msg: reserved > 0
        ? `未承诺现金不足：进行中谈判已占用 ${formatMoney(reserved)}，首付款与签约奖还需 ${formatMoney(immediateCost)}`
        : `资金不足：首付款与签约奖合计需要 ${formatMoney(immediateCost)}`,
    };
  }

  const negotiation = {
    id: negotiationId(world),
    kind: "user_buy",
    season: world.season,
    playerId,
    buyerClubId: buyer.id,
    sellerClubId: seller.id,
    initialFee: offeredFee,
    fee: offeredFee,
    initialYears: contractYears,
    years: contractYears,
    initialWage: offeredWage,
    wage: offeredWage,
    signingBonus: bonus,
    ...paymentTerms,
    status: "club_review",
    createdDay: world.day || 0,
    updatedDay: world.day || 0,
    decisionDay: nextDecisionDay(world, random),
    revision: 1,
    clubCounterCount: 0,
    playerCounterCount: 0,
    reason: null,
    rejectedBy: null,
    finishedDay: null,
  };
  world.transferNegotiations.unshift(negotiation);
  if (world.transferNegotiations.length > MAX_HISTORY) {
    const active = world.transferNegotiations.filter(isActiveTransferNegotiation);
    const history = world.transferNegotiations.filter((item) => !isActiveTransferNegotiation(item));
    world.transferNegotiations = [...active, ...history.slice(0, Math.max(0, MAX_HISTORY - active.length))];
  }
  return {
    ok: true,
    msg: `已向 ${seller.name} 提交对 ${player.name} 的报价，预计 1–2 天答复`,
    negotiation,
  };
}

function trimNegotiationHistory(world) {
  if (world.transferNegotiations.length <= MAX_HISTORY) return;
  const active = world.transferNegotiations.filter(isActiveTransferNegotiation);
  const history = world.transferNegotiations.filter((item) => !isActiveTransferNegotiation(item));
  world.transferNegotiations = [...active, ...history.slice(0, Math.max(0, MAX_HISTORY - active.length))];
}

function validateSaleListing(world, negotiation) {
  if (!world || world.sacked) return { ok: false, reason: "经理当前无法处理俱乐部转会" };
  if (world.userClubId !== negotiation.sellerClubId) {
    return { ok: false, reason: "你已不再执教挂牌球员所在俱乐部" };
  }
  if (!isTransferWindowOpen(world)) {
    return { ok: false, reason: `转会窗已关闭：${transferWindowLabel(world)}` };
  }
  const seller = clubById(world, negotiation.sellerClubId);
  if (!seller) return { ok: false, reason: "卖方俱乐部已不存在" };
  const player = playerAtClub(seller, negotiation.playerId);
  if (!player) return { ok: false, reason: "球员已经离开你的俱乐部" };
  if (player.loan) return { ok: false, reason: "球员当前处于租借关系，无法永久转会" };
  if (hasActiveDealNegotiation(world, player.id)) {
    return { ok: false, reason: "球员已有进行中的续约或租借谈判" };
  }
  if ((seller.players || []).length <= MIN_SELLER_SQUAD) {
    return { ok: false, reason: "一线队人数不足，无法继续出售" };
  }
  return { ok: true, seller, player };
}

function validateSaleDeal(
  world,
  negotiation,
  { checkBudget = true, excludeTransferId = negotiation.id } = {}
) {
  const listing = validateSaleListing(world, negotiation);
  if (!listing.ok) return listing;
  const buyer = clubById(world, negotiation.buyerClubId);
  if (!buyer || buyer.id === listing.seller.id) {
    return { ok: false, reason: "买方俱乐部已不存在" };
  }
  if (hasTransferEmbargo(buyer)) return { ok: false, reason: "买方处于财政转会限制期" };
  if ((buyer.players || []).length >= MAX_SQUAD) {
    return { ok: false, reason: "买方一线队已经满员" };
  }
  const cost = transferNegotiationCashCost(negotiation);
  const otherCommitments = activeTransferCashCommitments(world, buyer.id, {
    excludeId: excludeTransferId,
  }) + activeDealCashCommitments(world, buyer.id);
  const available = Math.max(0, clubTransferBudget(world, buyer) - otherCommitments);
  if (checkBudget && available < cost) {
    return {
      ok: false,
      reason: `买方扣除运营储备与其他谈判后无法承担 ${formatMoney(cost)}`,
    };
  }
  return { ...listing, buyer };
}

/** 用户将本队球员挂牌，市场会在 1–2 天后反馈实际报价。 */
export function submitSaleListing(
  world,
  playerId,
  { askingFee, random = Math.random } = {}
) {
  ensureTransferNegotiations(world);
  if (!world || world.sacked) return { ok: false, msg: "你当前无法操作转会" };
  if (!isTransferWindowOpen(world)) {
    return { ok: false, msg: `转会窗已关闭。${transferWindowLabel(world)}` };
  }
  const seller = clubById(world, world.userClubId);
  const player = playerAtClub(seller, playerId);
  if (!seller || !player) return { ok: false, msg: "球员不在你的阵容中" };
  if (player.loan) return { ok: false, msg: "租借球员不可挂牌出售" };
  if ((seller.players || []).length <= MIN_SELLER_SQUAD) {
    return { ok: false, msg: "阵容过少，无法再出售" };
  }
  if (findActiveSaleNegotiation(world, playerId)) {
    return { ok: false, msg: "该球员已经挂牌或正在进行出售谈判" };
  }
  if (hasActiveDealNegotiation(world, playerId)) {
    return { ok: false, msg: "该球员已有进行中的续约或租借谈判" };
  }
  const fee = money(askingFee);
  if (fee <= 0) return { ok: false, msg: "挂牌价必须大于 0" };

  const negotiation = {
    id: negotiationId(world),
    kind: "user_sell",
    season: world.season,
    playerId,
    buyerClubId: null,
    sellerClubId: seller.id,
    initialFee: fee,
    askingFee: fee,
    fee,
    years: null,
    wage: null,
    signingBonus: 0,
    status: "market_search",
    createdDay: world.day || 0,
    updatedDay: world.day || 0,
    decisionDay: nextDecisionDay(world, random),
    revision: 1,
    sellerCounterCount: 0,
    reason: "球员已挂牌，等待有真实需求且资金充足的俱乐部报价",
    rejectedBy: null,
    finishedDay: null,
  };
  world.transferNegotiations.unshift(negotiation);
  trimNegotiationHistory(world);
  return {
    ok: true,
    msg: `${player.name} 已以 ${formatMoney(fee)} 挂牌，预计 1–2 天获得市场反馈`,
    negotiation,
  };
}

function sellerAskingFee(seller, player) {
  const value = Math.max(1, Number(player.value) || estimateValue(player));
  const lineup = new Set(seller.tactics?.lineup || []);
  const samePosition = (seller.players || []).filter((candidate) => candidate.pos === player.pos).length;
  ensureContract(player);
  let factor = 1.05;
  if (lineup.has(player.id)) factor += 0.12;
  if (samePosition <= 3) factor += 0.08;
  if ((seller.players || []).length <= 17) factor += 0.1;
  if ((player.contractYears || 0) <= 1) factor -= 0.15;
  if ((player.contractYears || 0) >= 4) factor += 0.05;
  if ((player.age || 0) >= 32) factor -= 0.08;
  if ((player.morale || 70) <= 50) factor -= 0.06;
  return Math.round(value * clamp(factor, 0.78, 1.38));
}

function processClubReview(world, negotiation, live, random) {
  const asking = sellerAskingFee(live.seller, live.player);
  const acceptanceLine = asking * (0.96 + random() * 0.04);
  if (negotiation.fee >= acceptanceLine) {
    setStatus(world, negotiation, "player_review", {
      decisionDay: nextDecisionDay(world, random),
      reason: "卖方俱乐部已接受转会费报价，等待球员审核合同",
    });
    return;
  }
  if (negotiation.fee >= asking * 0.68 && (negotiation.clubCounterCount || 0) < 2) {
    const counterFee = Math.max(
      negotiation.fee + 1,
      Math.round(asking * (0.98 + random() * 0.04))
    );
    setStatus(world, negotiation, "club_counter", {
      fee: counterFee,
      signingBonus: signingBonus(negotiation.wage, negotiation.years),
      clubCounterCount: (negotiation.clubCounterCount || 0) + 1,
      decisionDay: null,
      reason: `卖方认为球员的阵容地位与合同情况对应 ${formatMoney(counterFee)} 的转会费`,
    });
    return;
  }
  stopNegotiation(
    world,
    negotiation,
    "rejected",
    `卖方拒绝报价：${formatMoney(negotiation.fee)} 明显低于其基于球员价值、合同与阵容地位的估价`,
    "club"
  );
}

function playerContractDemand(buyer, seller, player, years) {
  ensureContract(player);
  const marketWage = Math.max(1, estimateWage(player));
  const currentWage = Math.max(1, Number(player.wage) || marketWage);
  let factor = 1;
  const buyerPower = Math.max(1, Number(buyer.power) || 1);
  const sellerPower = Math.max(1, Number(seller.power) || 1);
  if (buyerPower < sellerPower) factor += clamp((sellerPower - buyerPower) / sellerPower, 0, 0.12);
  if (buyerPower > sellerPower) factor -= clamp((buyerPower - sellerPower) / buyerPower, 0, 0.05);
  const minYears = (player.age || 0) <= 27 ? 3 : (player.age || 0) <= 30 ? 2 : 1;
  if (years < minYears) factor += 0.05 * (minYears - years);
  return {
    wage: Math.round(Math.max(marketWage * 0.98, currentWage * 1.02) * factor),
    years: Math.max(years, minYears),
  };
}

function saleContractTerms(buyer, seller, player, random) {
  const preferredYears = (player.age || 0) >= 32 ? 2 : 3;
  const demand = playerContractDemand(buyer, seller, player, preferredYears);
  const wage = Math.round(demand.wage * (1.01 + random() * 0.07));
  return {
    years: demand.years,
    wage,
    signingBonus: signingBonus(wage, demand.years),
  };
}

function setSaleOffer(world, negotiation, buyer, fee, terms, reason, sourceBidId = null) {
  return setStatus(world, negotiation, "seller_review", {
    buyerClubId: buyer.id,
    fee: money(fee),
    years: terms.years,
    wage: terms.wage,
    signingBonus: terms.signingBonus,
    upfrontPct: terms.upfrontPct,
    installmentCount: terms.installmentCount,
    appearanceBonus: terms.appearanceBonus,
    appearanceTarget: terms.appearanceTarget,
    sellOnPct: terms.sellOnPct,
    buyerOfferFee: money(fee),
    decisionDay: null,
    reason,
    sourceBidId,
  });
}

function findSaleBuyer(world, negotiation, seller, player, random) {
  const pendingBid = (world.poachBids || [])
    .filter(
      (bid) =>
        bid.status === "pending" &&
        bid.playerId === player.id &&
        bid.fromClubId === seller.id
    )
    .sort((a, b) => (b.fee || 0) - (a.fee || 0))[0];
  if (pendingBid) {
    const buyer = clubById(world, pendingBid.buyerId);
    if (buyer && !hasTransferEmbargo(buyer)) {
      const terms = {
        ...saleContractTerms(buyer, seller, player, random),
        ...aiTransferPaymentTerms(pendingBid.fee, random),
      };
      const candidate = {
        ...negotiation,
        buyerClubId: buyer.id,
        fee: money(pendingBid.fee),
        ...terms,
      };
      const other = activeTransferCashCommitments(world, buyer.id, { excludeId: negotiation.id }) +
        activeDealCashCommitments(world, buyer.id);
      if (clubTransferBudget(world, buyer) - other >= transferNegotiationCashCost(candidate)) {
        return { buyer, fee: pendingBid.fee, terms, sourceBidId: pendingBid.id };
      }
    }
  }

  const value = Math.max(1, Number(player.value) || estimateValue(player));
  const asking = money(negotiation.askingFee || negotiation.fee);
  if (asking > value * 1.65) return null;
  const candidates = [];
  for (const buyer of world.clubs || []) {
    if (buyer.id === seller.id || (buyer.players || []).length >= 26 || hasTransferEmbargo(buyer)) continue;
    const need = shouldBuyPosition(buyer.players || [], player.pos);
    const marketOffer = Math.round(value * (0.84 + random() * 0.22 + (need ? 0.07 : 0)));
    const fee = Math.min(asking, marketOffer);
    if (fee < Math.min(asking * 0.66, value * 0.78)) continue;
    const terms = {
      ...saleContractTerms(buyer, seller, player, random),
      ...aiTransferPaymentTerms(fee, random),
    };
    const candidate = { ...negotiation, buyerClubId: buyer.id, fee, ...terms };
    const other = activeTransferCashCommitments(world, buyer.id, { excludeId: negotiation.id }) +
      activeDealCashCommitments(world, buyer.id);
    if (clubTransferBudget(world, buyer) - other < transferNegotiationCashCost(candidate)) continue;
    const targetOvr = Math.max(7, Math.round((Number(buyer.power) || 55) / 5));
    const abilityFit = -Math.abs((Number(player.ovr) || 10) - targetOvr) * 0.25;
    const leagueStep = (seller.division || 3) - (buyer.division || 3);
    const score = (need ? 5 : 0) + abilityFit + leagueStep * 0.6 + random() * 2;
    candidates.push({ buyer, fee, terms, score, sourceBidId: null });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function processSaleMarketSearch(world, negotiation, live, random) {
  const offer = findSaleBuyer(world, negotiation, live.seller, live.player, random);
  if (!offer) {
    stopNegotiation(
      world,
      negotiation,
      "rejected",
      `市场没有俱乐部愿意按接近 ${formatMoney(negotiation.askingFee)} 的价格报价`,
      "market"
    );
    return;
  }
  if (offer.sourceBidId) {
    const sourceBid = (world.poachBids || []).find((bid) => bid.id === offer.sourceBidId);
    if (sourceBid) sourceBid.status = "negotiating";
  }
  setSaleOffer(
    world,
    negotiation,
    offer.buyer,
    offer.fee,
    offer.terms,
    `${offer.buyer.name} 根据球员身价、阵容需求与自身预算提交正式报价`,
    offer.sourceBidId
  );
}

function processSaleBuyerReview(world, negotiation, live, random) {
  const value = Math.max(1, Number(live.player.value) || estimateValue(live.player));
  const need = shouldBuyPosition(live.buyer.players || [], live.player.pos);
  const maxFee = Math.round(value * (0.98 + (need ? 0.1 : 0) + random() * 0.08));
  if (negotiation.fee <= maxFee) {
    setStatus(world, negotiation, "player_review", {
      decisionDay: nextDecisionDay(world, random),
      reason: "买方接受你的还价，等待球员审核合同与竞技计划",
    });
    return;
  }
  const priorOffer = money(negotiation.buyerOfferFee);
  if ((negotiation.sellerCounterCount || 0) <= 2 && maxFee > priorOffer) {
    const counterFee = Math.max(priorOffer + 1, Math.round((priorOffer + maxFee) / 2));
    setStatus(world, negotiation, "seller_review", {
      fee: counterFee,
      buyerOfferFee: counterFee,
      decisionDay: null,
      reason: `买方无法接受 ${formatMoney(negotiation.fee)}，改报 ${formatMoney(counterFee)}`,
    });
    return;
  }
  stopNegotiation(
    world,
    negotiation,
    "rejected",
    `买方认为 ${formatMoney(negotiation.fee)} 超出其基于身价与阵容需求的上限`,
    "buyer"
  );
}

function playerAcceptsSale(negotiation, seller, buyer, player, random) {
  let chance = 0.9;
  const powerGap = (Number(seller.power) || 50) - (Number(buyer.power) || 50);
  if (powerGap > 0) chance -= clamp(powerGap / 70, 0, 0.28);
  if ((buyer.division || 3) > (seller.division || 3)) chance -= 0.12;
  if ((player.morale || 70) <= 50) chance += 0.08;
  if ((negotiation.wage || 0) >= (Number(player.wage) || 0) * 1.2) chance += 0.08;
  if ((player.age || 0) <= 28 && (player.ovr || 0) >= 15 && powerGap >= 8) chance -= 0.12;
  return random() < clamp(chance, 0.35, 0.98);
}

function completeSaleNegotiation(world, negotiation) {
  const live = validateSaleDeal(world, negotiation);
  if (!live.ok) {
    stopNegotiation(world, negotiation, "cancelled", live.reason);
    return { ok: false, msg: live.reason, negotiation };
  }
  const { seller, buyer, player } = live;
  const sellerIndex = seller.players.findIndex((candidate) => candidate.id === player.id);
  if (sellerIndex < 0) {
    stopNegotiation(world, negotiation, "cancelled", "球员已经离开你的俱乐部");
    return { ok: false, msg: negotiation.reason, negotiation };
  }

  const fee = money(negotiation.fee);
  const bonus = signingBonus(negotiation.wage, negotiation.years);
  const settlement = settleTransferAgreement(world, {
    buyerClubId: buyer.id,
    sellerClubId: seller.id,
    player,
    fee,
    upfrontPct: negotiation.upfrontPct,
    installmentCount: negotiation.installmentCount,
    appearanceBonus: negotiation.appearanceBonus,
    appearanceTarget: negotiation.appearanceTarget,
    sellOnPct: negotiation.sellOnPct,
    transferId: negotiation.id,
    source: "transfer-upfront",
  });
  recordFinanceEntry(buyer, -bonus, { category: "transfer", source: "signing-bonus", season: world.season, day: world.day });

  archiveClubSeasonStats(player, world.season, seller.id, seller.name);
  seller.players.splice(sellerIndex, 1);
  player.clubId = buyer.id;
  player.number = null;
  player.morale = Math.min(100, (Number(player.morale) || 70) + 5);
  player.contractYears = negotiation.years;
  player.wage = negotiation.wage;
  player._needsRenew = false;
  player.value = estimateValue(player);
  buyer.players.push(player);
  assignSquadNumbers(buyer);
  autoLineup(seller);
  autoLineup(buyer);

  negotiation.signingBonus = bonus;
  setStatus(world, negotiation, "completed", {
    decisionDay: null,
    finishedDay: world.day || 0,
    reason: "卖方、买方与球员均已接受条款，转会完成",
  });
  for (const bid of world.poachBids || []) {
    if (bid.playerId === player.id && (bid.status === "pending" || bid.status === "negotiating")) {
      bid.status = bid.id === negotiation.sourceBidId ? "accepted" : "expired";
    }
  }
  if (!Array.isArray(world.news)) world.news = [];
  world.news.unshift({
    day: world.day,
    text: `📤 售出 ${player.name} 至 ${buyer.name}，转会费 ${formatMoney(fee)}`,
  });
  mediaTransfer(world, {
    type: "sell",
    playerName: player.name,
    clubName: seller.name,
    otherName: buyer.name,
    feeText: formatMoney(fee),
  });
  return {
    ok: true,
    msg: `已售出 ${player.name} 至 ${buyer.name}，总价 ${formatMoney(fee)} · 已收 ${formatMoney(settlement.upfront)}`,
    negotiation,
  };
}

function processSalePlayerReview(world, negotiation, live, random) {
  if (playerAcceptsSale(negotiation, live.seller, live.buyer, live.player, random)) {
    return completeSaleNegotiation(world, negotiation);
  }
  stopNegotiation(
    world,
    negotiation,
    "rejected",
    "球员拒绝新俱乐部：竞技水平、联赛层级与合同提升不足以支持转会",
    "player"
  );
  return { ok: false, negotiation };
}

/** 将一份现有 AI 报价送入球员审核，不再在用户点击接受时即时转会。 */
export function acceptIncomingTransferOffer(
  world,
  { playerId, buyerClubId, fee, sourceBidId = null, random = Math.random } = {}
) {
  ensureTransferNegotiations(world);
  const seller = clubById(world, world?.userClubId);
  const buyer = clubById(world, buyerClubId);
  const player = playerAtClub(seller, playerId);
  if (!seller || !buyer || !player) return { ok: false, msg: "报价对应的俱乐部或球员已失效" };
  if (hasActiveDealNegotiation(world, playerId)) {
    return { ok: false, msg: "该球员已有进行中的续约或租借谈判" };
  }
  const existing = findActiveSaleNegotiation(world, playerId);
  const terms = {
    ...saleContractTerms(buyer, seller, player, random),
    ...aiTransferPaymentTerms(fee, random),
  };
  const negotiation = {
    id: negotiationId(world),
    kind: "user_sell",
    season: world.season,
    playerId,
    buyerClubId: buyer.id,
    sellerClubId: seller.id,
    initialFee: money(fee),
    askingFee: money(fee),
    fee: money(fee),
    ...terms,
    status: "player_review",
    createdDay: world.day || 0,
    updatedDay: world.day || 0,
    decisionDay: nextDecisionDay(world, random),
    revision: 1,
    sellerCounterCount: 0,
    reason: "你已接受买方报价，等待球员审核新俱乐部与合同",
    rejectedBy: null,
    finishedDay: null,
    sourceBidId,
  };
  const live = validateSaleDeal(world, negotiation, {
    excludeTransferId: existing?.buyerClubId === buyer.id ? existing.id : negotiation.id,
  });
  if (!live.ok) return { ok: false, msg: live.reason };
  if (existing) stopNegotiation(world, existing, "cancelled", "你接受了另一家俱乐部的正式报价");
  world.transferNegotiations.unshift(negotiation);
  trimNegotiationHistory(world);
  return {
    ok: true,
    msg: `已接受 ${buyer.name} 的报价，球员将在 1–2 天内答复`,
    negotiation,
  };
}

function completeBuyNegotiation(world, negotiation) {
  const live = validateLiveDeal(world, negotiation, { checkReservedFunds: true });
  if (!live.ok) {
    stopNegotiation(world, negotiation, "cancelled", live.reason);
    return { ok: false, msg: live.reason, negotiation };
  }
  const { buyer, seller, player } = live;
  const sellerIndex = seller.players.findIndex((candidate) => candidate.id === player.id);
  if (sellerIndex < 0) {
    stopNegotiation(world, negotiation, "cancelled", "球员已经离开卖方俱乐部");
    return { ok: false, msg: negotiation.reason, negotiation };
  }

  const fee = money(negotiation.fee);
  const bonus = signingBonus(negotiation.wage, negotiation.years);
  const settlement = settleTransferAgreement(world, {
    buyerClubId: buyer.id,
    sellerClubId: seller.id,
    player,
    fee,
    upfrontPct: negotiation.upfrontPct,
    installmentCount: negotiation.installmentCount,
    appearanceBonus: negotiation.appearanceBonus,
    appearanceTarget: negotiation.appearanceTarget,
    sellOnPct: negotiation.sellOnPct,
    transferId: negotiation.id,
    source: "transfer-upfront",
  });
  recordFinanceEntry(buyer, -bonus, { category: "transfer", source: "signing-bonus", season: world.season, day: world.day });

  archiveClubSeasonStats(player, world.season, seller.id, seller.name);
  seller.players.splice(sellerIndex, 1);
  player.clubId = buyer.id;
  player.morale = Math.min(100, (Number(player.morale) || 70) + 8);
  player.number = null;
  player.contractYears = negotiation.years;
  player.wage = negotiation.wage;
  player._needsRenew = false;
  player.value = estimateValue(player);
  buyer.players.push(player);
  assignSquadNumbers(buyer);
  autoLineup(seller);
  autoLineup(buyer);

  negotiation.signingBonus = bonus;
  setStatus(world, negotiation, "completed", {
    decisionDay: null,
    finishedDay: world.day || 0,
    reason: "俱乐部与球员均已接受条款，转会完成",
  });
  if (!Array.isArray(world.news)) world.news = [];
  world.news.unshift({
    day: world.day,
    text: `✍️ 转会：签下 ${player.name}（${POS_LABEL[player.pos] || player.pos}），转会费 ${formatMoney(fee)} · ${negotiation.years} 年合同 · 周薪 ${formatMoney(negotiation.wage)}`,
  });
  mediaTransfer(world, {
    type: "buy",
    playerName: player.name,
    clubName: buyer.name,
    otherName: seller.name,
    feeText: formatMoney(fee),
  });
  return {
    ok: true,
    msg: `成功签下 ${player.name}：总价 ${formatMoney(fee)} · 首付 ${formatMoney(settlement.upfront)} + 签约奖 ${formatMoney(bonus)}`,
    negotiation,
  };
}

function processPlayerReview(world, negotiation, live, random) {
  const demand = playerContractDemand(
    live.buyer,
    live.seller,
    live.player,
    negotiation.years
  );
  const acceptanceLine = demand.wage * (0.96 + random() * 0.04);
  if (negotiation.wage >= acceptanceLine && negotiation.years >= demand.years) {
    return completeBuyNegotiation(world, negotiation);
  }
  if (negotiation.wage >= demand.wage * 0.7 && (negotiation.playerCounterCount || 0) < 2) {
    const counterWage = Math.max(
      negotiation.wage + 1,
      Math.round(demand.wage * (1 + random() * 0.03))
    );
    setStatus(world, negotiation, "player_counter", {
      wage: counterWage,
      years: demand.years,
      signingBonus: signingBonus(counterWage, demand.years),
      playerCounterCount: (negotiation.playerCounterCount || 0) + 1,
      decisionDay: null,
      reason: `球员根据现有薪资、市场工资、合同年限与两队竞技水平提出新合同`,
    });
    return { ok: true, negotiation };
  }
  stopNegotiation(
    world,
    negotiation,
    "rejected",
    `球员拒绝合同：周薪 ${formatMoney(negotiation.wage)} 与其现有薪资和市场水平差距过大`,
    "player"
  );
  return { ok: false, negotiation };
}

/** 每日处理到期的俱乐部/球员审核。 */
export function processTransferNegotiationsDay(world, { random = Math.random } = {}) {
  const events = [];
  for (const negotiation of ensureTransferNegotiations(world)) {
    if (!isActiveTransferNegotiation(negotiation)) continue;
    if (negotiation.kind === "user_sell") {
      const listing = validateSaleListing(world, negotiation);
      if (!listing.ok) {
        stopNegotiation(world, negotiation, "cancelled", listing.reason);
        events.push({ id: negotiation.id, status: negotiation.status, reason: negotiation.reason });
        continue;
      }
      if (negotiation.status === "seller_review") continue;
      if ((world.day || 0) < (negotiation.decisionDay || 0)) continue;
      if (negotiation.status === "market_search") {
        processSaleMarketSearch(world, negotiation, listing, random);
      } else {
        const liveSale = validateSaleDeal(world, negotiation);
        if (!liveSale.ok) {
          stopNegotiation(world, negotiation, "cancelled", liveSale.reason);
        } else if (negotiation.status === "buyer_review") {
          processSaleBuyerReview(world, negotiation, liveSale, random);
        } else if (negotiation.status === "player_review") {
          processSalePlayerReview(world, negotiation, liveSale, random);
        }
      }
      events.push({ id: negotiation.id, status: negotiation.status, reason: negotiation.reason });
      continue;
    }
    const live = validateLiveDeal(world, negotiation);
    if (!live.ok) {
      stopNegotiation(world, negotiation, "cancelled", live.reason);
      events.push({ id: negotiation.id, status: negotiation.status, reason: negotiation.reason });
      continue;
    }
    if (negotiation.status === "club_counter" || negotiation.status === "player_counter") continue;
    if ((world.day || 0) < (negotiation.decisionDay || 0)) continue;
    if (negotiation.status === "club_review") {
      processClubReview(world, negotiation, live, random);
    } else if (negotiation.status === "player_review") {
      processPlayerReview(world, negotiation, live, random);
    }
    events.push({ id: negotiation.id, status: negotiation.status, reason: negotiation.reason });
  }
  return events;
}

function respondSaleNegotiation(
  world,
  negotiation,
  actionId,
  { random = Math.random, fee = null } = {}
) {
  if (actionId === "withdraw") {
    if (!isActiveTransferNegotiation(negotiation)) {
      return { ok: false, msg: "该出售谈判已经结束" };
    }
    stopNegotiation(world, negotiation, "cancelled", "你撤回了挂牌或终止了出售谈判");
    negotiation.userHandledRevision = negotiation.revision;
    return { ok: true, msg: "已撤牌，出售谈判结束", negotiation };
  }
  if (negotiation.status !== "seller_review") {
    return { ok: false, msg: "该出售谈判当前无需回应" };
  }
  if (actionId === "reject") {
    stopNegotiation(world, negotiation, "cancelled", "你拒绝了买方报价");
    negotiation.userHandledRevision = negotiation.revision;
    const sourceBid = (world.poachBids || []).find((bid) => bid.id === negotiation.sourceBidId);
    if (sourceBid && sourceBid.status !== "accepted") sourceBid.status = "rejected";
    return { ok: true, msg: "已拒绝报价，出售谈判结束", negotiation };
  }
  if (actionId === "counter") {
    const counterFee = money(fee);
    if (counterFee <= negotiation.fee) {
      return { ok: false, msg: "还价必须高于买方当前报价" };
    }
    setStatus(world, negotiation, "buyer_review", {
      fee: counterFee,
      sellerCounterCount: (negotiation.sellerCounterCount || 0) + 1,
      decisionDay: (world.day || 0) + 1,
      reason: `你要求买方将报价提高至 ${formatMoney(counterFee)}`,
    });
    negotiation.userHandledRevision = negotiation.revision;
    return { ok: true, msg: "已向买方提交还价，预计 1 天答复", negotiation };
  }
  if (actionId !== "accept") return { ok: false, msg: "未知出售谈判操作" };
  const live = validateSaleDeal(world, negotiation);
  if (!live.ok) {
    stopNegotiation(world, negotiation, "cancelled", live.reason);
    return { ok: false, msg: live.reason, negotiation };
  }
  setStatus(world, negotiation, "player_review", {
    decisionDay: nextDecisionDay(world, random),
    reason: "你已接受买方报价，等待球员审核新俱乐部与合同",
  });
  negotiation.userHandledRevision = negotiation.revision;
  return { ok: true, msg: "已接受报价，球员将在 1–2 天内答复", negotiation };
}

/** 处理信箱中的俱乐部或球员还价。 */
export function respondTransferNegotiation(
  world,
  negotiationId,
  actionId,
  { random = Math.random, fee = null } = {}
) {
  const negotiation = ensureTransferNegotiations(world).find((item) => item.id === negotiationId);
  if (!negotiation) return { ok: false, msg: "谈判不存在" };
  if (negotiation.kind === "user_sell") {
    return respondSaleNegotiation(world, negotiation, actionId, { random, fee });
  }
  if (actionId === "withdraw") {
    if (!isActiveTransferNegotiation(negotiation)) {
      return { ok: false, msg: "该谈判已经结束" };
    }
    stopNegotiation(world, negotiation, "cancelled", "你撤回了报价");
    negotiation.userHandledRevision = negotiation.revision;
    return { ok: true, msg: "已撤回报价，谈判结束", negotiation };
  }
  if (actionId === "reject") {
    if (negotiation.status !== "club_counter" && negotiation.status !== "player_counter") {
      return { ok: false, msg: "该谈判当前无需回应" };
    }
    stopNegotiation(world, negotiation, "cancelled", "你拒绝了对方提出的还价");
    negotiation.userHandledRevision = negotiation.revision;
    return { ok: true, msg: "已拒绝还价，谈判结束", negotiation };
  }
  if (actionId !== "accept") return { ok: false, msg: "未知谈判操作" };

  const live = validateLiveDeal(world, negotiation, { checkReservedFunds: true });
  if (!live.ok) {
    stopNegotiation(world, negotiation, "cancelled", live.reason);
    return { ok: false, msg: live.reason, negotiation };
  }
  if (negotiation.status === "club_counter") {
    setStatus(world, negotiation, "player_review", {
      decisionDay: nextDecisionDay(world, random),
      reason: "你已接受卖方还价，等待球员审核合同",
    });
    negotiation.userHandledRevision = negotiation.revision;
    return { ok: true, msg: "已接受俱乐部还价，球员将在 1–2 天内答复合同", negotiation };
  }
  if (negotiation.status === "player_counter") {
    const result = completeBuyNegotiation(world, negotiation);
    if (result.ok) negotiation.userHandledRevision = negotiation.revision;
    return result;
  }
  return { ok: false, msg: "该谈判当前无需回应" };
}
