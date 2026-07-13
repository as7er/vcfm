/** 球员职业合同：年限、续约、到期、解约 */

import { estimateWage, estimateValue, formatMoney, assignSquadNumbers, autoLineup } from "./models.js";
import { assertTransferOpen } from "./transfers.js";

export function ensureContract(p) {
  if (!p) return p;
  if (p.contractYears == null || p.contractYears < 0) {
    // 青年默认短约，成年 1–4 年
    if (p.fromYouth && (p.age || 18) <= 18) p.contractYears = 1 + Math.floor(Math.random() * 2);
    else p.contractYears = 1 + Math.floor(Math.random() * 4);
  }
  if (p.wage == null) p.wage = estimateWage(p);
  return p;
}

export function newContractYears(p) {
  if (p.age >= 34) return 1;
  if (p.age >= 32) return 1 + Math.floor(Math.random() * 2);
  if (p.age <= 21) return 2 + Math.floor(Math.random() * 3);
  return 2 + Math.floor(Math.random() * 3); // 2–4
}

/**
 * 续约报价：签约费（一次性）+ 新周薪
 * @param {object} p
 * @param {{ years?: number }} [opts]
 */
export function renewOffer(p, opts = {}) {
  ensureContract(p);
  let years =
    opts.years != null
      ? Math.max(1, Math.min(5, +opts.years))
      : newContractYears(p);
  if (p.age >= 34) years = Math.min(years, 1);
  else if (p.age >= 32) years = Math.min(years, 2);

  const baseMult = 1.05 + Math.random() * 0.12 + (p.ovr >= 15 ? 0.08 : 0);
  // 长约略贵周薪
  const yearBump = 1 + Math.max(0, years - 2) * 0.03;
  const wageMult = baseMult * yearBump;
  const newWage = Math.max(p.wage || 800, Math.round(estimateWage(p) * wageMult));
  const fee = Math.round(newWage * 4 * years * 0.15); // 签约奖
  return { years, newWage, fee, wageMult };
}

/** 短约 / 待续约（UI 筛选） */
export function needsContractAttention(p) {
  if (!p) return false;
  ensureContract(p);
  if (p._needsRenew) return true;
  if ((p.contractYears || 0) <= 1) return true;
  return false;
}

export function renewPlayer(club, player, offer = null) {
  if (!club || !player) return { ok: false, msg: "无效球员" };
  if (player.loan) return { ok: false, msg: "租借球员无法续约（由母队管理合同）" };
  ensureContract(player);
  const o = offer || renewOffer(player);
  if (club.money < o.fee) {
    return { ok: false, msg: `资金不足，签约奖需 ${formatMoney(o.fee)}` };
  }
  club.money -= o.fee;
  player.contractYears = o.years;
  player.wage = o.newWage;
  player._needsRenew = false;
  player.morale = Math.min(100, (player.morale || 70) + 5);
  player.value = estimateValue(player);
  return {
    ok: true,
    msg: `已与 ${player.name} 续约 ${o.years} 年，周薪 ${formatMoney(o.newWage)}，签约奖 ${formatMoney(o.fee)}`,
    offer: o,
  };
}

/**
 * 解约补偿：周薪 × 4 × 剩余年（至少 4 周）
 */
export function terminateCost(player) {
  ensureContract(player);
  const years = Math.max(1, player.contractYears || 1);
  const wage = player.wage || estimateWage(player);
  return Math.round(wage * 4 * years);
}

/**
 * 一线队解约 → 自由身
 * @param {object} world
 * @param {object} club
 * @param {object} player
 */
export function terminatePlayer(world, club, player) {
  if (!world || !club || !player) return { ok: false, msg: "无效操作" };
  if (player.loan) {
    return { ok: false, msg: "租借球员无法解约（可等待到期或由母队召回）" };
  }
  ensureContract(player);
  if (club.players.length <= 14) {
    return { ok: false, msg: "阵容过少，无法再解约（至少保留 14 人）" };
  }
  if (player.pos === "GK") {
    const gks = club.players.filter((p) => p.pos === "GK" && p.id !== player.id);
    if (gks.length < 1) return { ok: false, msg: "至少保留一名门将" };
  }

  const cost = terminateCost(player);
  if (club.money < cost) {
    return { ok: false, msg: `解约补偿不足，需 ${formatMoney(cost)}` };
  }

  const idx = club.players.findIndex((p) => p.id === player.id);
  if (idx < 0) return { ok: false, msg: "球员不在阵中" };

  club.money -= cost;
  const [p] = club.players.splice(idx, 1);
  p.clubId = null;
  p._needsRenew = false;
  p.number = null;
  p.loan = null;
  if (!Array.isArray(world.freeAgents)) world.freeAgents = [];
  world.freeAgents.push(p);
  // 从首发名单移除
  if (club.tactics?.lineup) {
    club.tactics.lineup = club.tactics.lineup.filter((id) => id !== p.id);
  }
  assignSquadNumbers(club);
  autoLineup(club);

  if (world.freeAgents.length > 100) {
    world.freeAgents = world.freeAgents.slice(-100);
  }

  return {
    ok: true,
    msg: `已与 ${p.name} 解约，补偿 ${formatMoney(cost)}，球员成为自由身`,
    cost,
    player: p,
  };
}

/**
 * 赛季末：全体合同 -1；到期处理
 * AI：自动续约主力；用户队到期进 freeAgents 或强制提示
 */
export function processContractsEndOfSeason(world) {
  const userId = world.userClubId;
  if (!Array.isArray(world.freeAgents)) world.freeAgents = [];

  const userExpired = [];
  const leftUser = [];

  for (const club of world.clubs) {
    const kept = [];
    for (const p of club.players) {
      ensureContract(p);
      // 租借球员：合同年在母队逻辑上仍减，但租期由 loans 管理；此处仍 -1
      p.contractYears = Math.max(0, (p.contractYears || 1) - 1);

      if (p.contractYears > 0) {
        kept.push(p);
        continue;
      }

      // 合同到期
      if (club.id === userId) {
        const offer = renewOffer(p);
        p.contractYears = 0;
        p._needsRenew = true;
        kept.push(p);
        userExpired.push(p);
        void offer;
      } else {
        // AI：高能力续约，低能力释放（租借中的先保留，由归还后再处理）
        if (p.loan) {
          kept.push(p);
          continue;
        }
        if (p.ovr >= 11 || club.players.length <= 16) {
          const o = renewOffer(p);
          if (club.money >= o.fee) {
            club.money -= o.fee;
            p.contractYears = o.years;
            p.wage = o.newWage;
            kept.push(p);
          } else {
            p.clubId = null;
            p._needsRenew = false;
            world.freeAgents.push(p);
          }
        } else {
          p.clubId = null;
          p._needsRenew = false;
          world.freeAgents.push(p);
        }
      }
    }
    club.players = kept;
  }

  // 青训合同也 -1，到期自动 +1 年短约（仍在学院）
  for (const club of world.clubs) {
    const ya = club.youth;
    if (!ya?.players) continue;
    for (const p of ya.players) {
      ensureContract(p);
      p.contractYears = Math.max(1, (p.contractYears || 1) - 1);
      if (p.contractYears <= 0) p.contractYears = 1;
    }
  }

  if (userExpired.length) {
    world.news.unshift({
      day: world.day,
      text: `📝 合同到期：${userExpired.map((p) => p.name).join("、")} 需要续约，否则下赛季初将成为自由球员`,
    });
  }

  if (world.freeAgents.length > 100) world.freeAgents = world.freeAgents.slice(-100);

  return { userExpired, leftUser };
}

/** 进入新赛季时：仍未续约的用户球员变自由身 */
export function releaseUnrenewed(world) {
  const club = world.clubs.find((c) => c.id === world.userClubId);
  if (!club) return [];
  if (!Array.isArray(world.freeAgents)) world.freeAgents = [];
  const gone = [];
  club.players = club.players.filter((p) => {
    ensureContract(p);
    if (p.loan) return true; // 租借身份由 loans 处理
    if (p.contractYears <= 0 || p._needsRenew) {
      p.clubId = null;
      p._needsRenew = false;
      p.contractYears = 0;
      world.freeAgents.push(p);
      gone.push(p.name);
      return false;
    }
    return true;
  });
  if (gone.length) {
    world.news.unshift({
      day: world.day,
      text: `📝 未续约离队（自由身）：${gone.join("、")}`,
    });
  }
  return gone;
}

/** 签自由球员 */
export function signFreeAgent(world, playerId) {
  if (world.sacked) return { ok: false, msg: "你已被解雇，无法签约" };
  const win = assertTransferOpen(world);
  if (!win.ok) return win;
  const club = world.clubs.find((c) => c.id === world.userClubId);
  if (!club) return { ok: false, msg: "无球队" };
  if (!Array.isArray(world.freeAgents)) return { ok: false, msg: "无自由球员" };
  const idx = world.freeAgents.findIndex((p) => p.id === playerId);
  if (idx < 0) return { ok: false, msg: "球员不存在" };
  if (club.players.length >= 28) return { ok: false, msg: "阵容已满" };

  const p = world.freeAgents[idx];
  const offer = renewOffer(p);
  if (club.money < offer.fee) {
    return { ok: false, msg: `签约奖不足 ${formatMoney(offer.fee)}` };
  }
  club.money -= offer.fee;
  world.freeAgents.splice(idx, 1);
  p.clubId = club.id;
  p.contractYears = offer.years;
  p.wage = offer.newWage;
  p._needsRenew = false;
  p.loan = null;
  p.morale = Math.min(100, (p.morale || 60) + 8);
  p.number = null;
  club.players.push(p);
  assignSquadNumbers(club);
  return {
    ok: true,
    msg: `免费签下 ${p.name}，合同 ${offer.years} 年，周薪 ${formatMoney(offer.newWage)}`,
  };
}
