/** 球员职业合同：年限、续约、到期 */

import { estimateWage, estimateValue, formatMoney, assignSquadNumbers } from "./models.js";

export function ensureContract(p) {
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

/** 续约报价：签约费（一次性）+ 新周薪 */
export function renewOffer(p) {
  ensureContract(p);
  const years = newContractYears(p);
  const wageMult = 1.05 + Math.random() * 0.2 + (p.ovr >= 15 ? 0.1 : 0);
  const newWage = Math.max(p.wage || 800, Math.round(estimateWage(p) * wageMult));
  const fee = Math.round(newWage * 4 * years * 0.15); // 签约奖
  return { years, newWage, fee };
}

export function renewPlayer(club, player, offer = null) {
  ensureContract(player);
  const o = offer || renewOffer(player);
  if (club.money < o.fee) {
    return { ok: false, msg: `资金不足，签约奖需 ${formatMoney(o.fee)}` };
  }
  club.money -= o.fee;
  player.contractYears = o.years;
  player.wage = o.newWage;
  player.morale = Math.min(100, (player.morale || 70) + 5);
  player.value = estimateValue(player);
  return {
    ok: true,
    msg: `已与 ${player.name} 续约 ${o.years} 年，周薪 ${formatMoney(o.newWage)}，签约奖 ${formatMoney(o.fee)}`,
    offer: o,
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
      p.contractYears = Math.max(0, (p.contractYears || 1) - 1);

      if (p.contractYears > 0) {
        kept.push(p);
        continue;
      }

      // 合同到期
      if (club.id === userId) {
        // 用户：默认续约请求；若阵容将过少则自动续
        const offer = renewOffer(p);
        // 先放进待续约列表，暂不离队——用户可在休赛期处理
        // 若用户不处理，startNextSeason 会把仍为 0 的转为自由身
        p.contractYears = 0;
        p._needsRenew = true;
        kept.push(p);
        userExpired.push(p);
      } else {
        // AI：高能力续约，低能力释放
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

  // 限制自由身池
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
  p.morale = Math.min(100, (p.morale || 60) + 8);
  p.number = null;
  club.players.push(p);
  assignSquadNumbers(club);
  return {
    ok: true,
    msg: `免费签下 ${p.name}，合同 ${offer.years} 年，周薪 ${formatMoney(offer.newWage)}`,
  };
}
