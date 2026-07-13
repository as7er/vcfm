/**
 * 租借：外租 / 租入 / 召回 / 到期归还
 * world.loans: 进行中的租借记录
 * player.loan: 球员身上的租借标记
 */

import {
  formatMoney,
  assignSquadNumbers,
  autoLineup,
  estimateValue,
} from "./models.js";
import { assertTransferOpen, ensureTransferWindow, getTransferPhase } from "./transfers.js";
import { ensureContract } from "./contracts.js";

function clubById(world, id) {
  return world?.clubs?.find((c) => c.id === id) || null;
}

function findPlayerAnywhere(world, playerId) {
  for (const c of world.clubs || []) {
    const p = c.players.find((x) => x.id === playerId);
    if (p) return { player: p, club: c };
  }
  return null;
}

export function ensureLoans(world) {
  if (!world) return [];
  if (!Array.isArray(world.loans)) world.loans = [];
  return world.loans;
}

/**
 * 计算租借到期日
 * @param {'half'|'season'} term
 */
export function loanUntilDay(world, term = "half") {
  ensureTransferWindow(world);
  const tw = world.transferWindow;
  const day = world.day || 1;
  if (term === "season") {
    // 赛季末：用一个足够大的 day，process 在 startNextSeason 强制归还
    return 9999;
  }
  // 半年：到下一个窗结束后
  if (day <= (tw.summerEnd || 35)) {
    // 夏窗发起 → 冬窗结束归还
    return (tw.winterEnd || 145) + 1;
  }
  // 冬窗或之后 → 赛季末
  return 9999;
}

function defaultWageShare() {
  return 0.5 + Math.random() * 0.5; // 租入方 50–100%
}

function loanFeeFor(player) {
  const v = player.value || estimateValue(player) || 100000;
  return Math.round(v * (0.05 + Math.random() * 0.07));
}

/**
 * 预览外租（我方 → 随机/指定 AI）
 */
export function previewLoanOut(world, playerId, term = "half") {
  const user = clubById(world, world.userClubId);
  if (!user) return null;
  const player = user.players.find((p) => p.id === playerId);
  if (!player || player.loan) return null;
  const fee = loanFeeFor(player);
  const wageShare = 0.75;
  const untilDay = loanUntilDay(world, term);
  return {
    player,
    fee,
    wageShare,
    untilDay,
    term,
    parentWage: Math.round((player.wage || 0) * (1 - wageShare)),
    hostWage: Math.round((player.wage || 0) * wageShare),
  };
}

/**
 * 预览租入
 */
export function previewLoanIn(world, playerId, fromClubId, term = "half") {
  const from = clubById(world, fromClubId);
  const player = from?.players?.find((p) => p.id === playerId);
  if (!player || player.loan) return null;
  const fee = loanFeeFor(player);
  const wageShare = 0.8;
  const untilDay = loanUntilDay(world, term);
  return {
    player,
    from,
    fee,
    wageShare,
    untilDay,
    term,
    hostWage: Math.round((player.wage || 0) * wageShare),
  };
}

function stripFromLineup(club, playerId) {
  if (club?.tactics?.lineup) {
    club.tactics.lineup = club.tactics.lineup.filter((id) => id !== playerId);
  }
}

/**
 * 执行球员从 A 到 B 的租借移动
 */
function moveOnLoan(world, player, fromClub, toClub, { untilDay, wageShare, fee, term }) {
  ensureLoans(world);
  ensureContract(player);

  const idx = fromClub.players.findIndex((p) => p.id === player.id);
  if (idx < 0) return { ok: false, msg: "球员不在出让方" };

  const [p] = fromClub.players.splice(idx, 1);
  stripFromLineup(fromClub, p.id);

  p.number = null;
  p.loan = {
    fromClubId: fromClub.id,
    toClubId: toClub.id,
    parentClubId: fromClub.id,
    untilDay,
    wageShare,
    fee,
    term: term || "half",
    canRecall: true,
    startedDay: world.day || 1,
  };
  p.clubId = toClub.id;
  toClub.players.push(p);
  assignSquadNumbers(toClub);
  autoLineup(fromClub);
  autoLineup(toClub);

  const rec = {
    id: `loan_${p.id}_${world.day || 0}`,
    playerId: p.id,
    playerName: p.name,
    fromClubId: fromClub.id,
    toClubId: toClub.id,
    untilDay,
    wageShare,
    fee,
    term: term || "half",
  };
  world.loans.push(rec);
  return { ok: true, player: p, rec };
}

/**
 * 用户外租给 AI
 * @param {{ term?: 'half'|'season', toClubId?: string }} opts
 */
export function loanOutPlayer(world, playerId, opts = {}) {
  if (world.sacked) return { ok: false, msg: "你已被解雇，无法操作" };
  const win = assertTransferOpen(world);
  if (!win.ok) return win;

  const user = clubById(world, world.userClubId);
  if (!user) return { ok: false, msg: "无球队" };
  const player = user.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, msg: "球员不在阵中" };
  if (player.loan) return { ok: false, msg: "该球员已在租借中" };
  if (user.players.length <= 14) return { ok: false, msg: "阵容过少，无法外租" };
  if (player.pos === "GK") {
    const gks = user.players.filter((p) => p.pos === "GK" && p.id !== player.id);
    if (gks.length < 1) return { ok: false, msg: "至少保留一名门将" };
  }

  const term = opts.term === "season" ? "season" : "half";
  let toClub = opts.toClubId ? clubById(world, opts.toClubId) : null;
  if (!toClub) {
    const candidates = world.clubs.filter(
      (c) =>
        c.id !== user.id &&
        c.players.length < 26 &&
        c.players.length >= 12
    );
    if (!candidates.length) return { ok: false, msg: "暂无接收租借的俱乐部" };
    // 偏好同级、阵容偏少
    candidates.sort((a, b) => a.players.length - b.players.length);
    toClub = candidates[Math.floor(Math.random() * Math.min(5, candidates.length))];
  }
  if (toClub.players.length >= 28) return { ok: false, msg: "对方阵容已满" };

  const fee = loanFeeFor(player);
  const wageShare = defaultWageShare();
  const untilDay = loanUntilDay(world, term);

  // 对方付租借费给用户
  toClub.money = Math.max(0, (toClub.money || 0) - fee);
  user.money += fee;

  const res = moveOnLoan(world, player, user, toClub, {
    untilDay,
    wageShare,
    fee,
    term,
  });
  if (!res.ok) return res;

  world.news.unshift({
    day: world.day,
    text: `🔁 外租：${player.name} → ${toClub.name}（至 D${untilDay === 9999 ? "赛季末" : untilDay}）· 租借费 ${formatMoney(fee)} · 对方承担薪资 ${Math.round(wageShare * 100)}%`,
  });
  return {
    ok: true,
    msg: `已将 ${player.name} 外租至 ${toClub.name}，收入 ${formatMoney(fee)}`,
    fee,
    toClub,
  };
}

/**
 * 用户从 AI 租入
 * @param {{ term?: 'half'|'season' }} opts
 */
export function loanInPlayer(world, playerId, fromClubId, opts = {}) {
  if (world.sacked) return { ok: false, msg: "你已被解雇，无法操作" };
  const win = assertTransferOpen(world);
  if (!win.ok) return win;

  const user = clubById(world, world.userClubId);
  const from = clubById(world, fromClubId);
  if (!user || !from || from.id === user.id) return { ok: false, msg: "无效俱乐部" };
  const player = from.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, msg: "球员不存在" };
  if (player.loan) return { ok: false, msg: "该球员已在租借中" };
  if (user.players.length >= 28) return { ok: false, msg: "阵容已满" };
  if (from.players.length <= 14) return { ok: false, msg: "对方拒绝外租（阵容过少）" };
  if (player.pos === "GK") {
    const gks = from.players.filter((p) => p.pos === "GK" && p.id !== player.id);
    if (gks.length < 1) return { ok: false, msg: "对方不会外租最后一名门将" };
  }

  const term = opts.term === "season" ? "season" : "half";
  const fee = loanFeeFor(player);
  const wageShare = 0.7 + Math.random() * 0.3;
  if (user.money < fee) {
    return { ok: false, msg: `资金不足，租借费需 ${formatMoney(fee)}` };
  }

  const untilDay = loanUntilDay(world, term);
  user.money -= fee;
  from.money += fee;

  const res = moveOnLoan(world, player, from, user, {
    untilDay,
    wageShare,
    fee,
    term,
  });
  if (!res.ok) return res;

  world.news.unshift({
    day: world.day,
    text: `🔁 租入：${player.name}（来自 ${from.name}）至 D${untilDay === 9999 ? "赛季末" : untilDay} · 租借费 ${formatMoney(fee)} · 我方承担薪资 ${Math.round(wageShare * 100)}%`,
  });
  return {
    ok: true,
    msg: `租入 ${player.name}，支付 ${formatMoney(fee)} · 至 ${untilDay === 9999 ? "赛季末" : "D" + untilDay}`,
    fee,
  };
}

/**
 * 归还租借（到期 / 召回 / 赛季末）
 */
export function returnLoan(world, playerId, { reason = "return" } = {}) {
  ensureLoans(world);
  const found = findPlayerAnywhere(world, playerId);
  if (!found || !found.player.loan) {
    // 清理悬挂记录
    world.loans = world.loans.filter((l) => l.playerId !== playerId);
    return { ok: false, msg: "未找到租借记录" };
  }
  const { player, club: host } = found;
  const loan = player.loan;
  const parent = clubById(world, loan.parentClubId || loan.fromClubId);
  if (!parent) {
    player.loan = null;
    world.loans = world.loans.filter((l) => l.playerId !== playerId);
    return { ok: false, msg: "母队不存在" };
  }
  if (parent.id === host.id) {
    player.loan = null;
    world.loans = world.loans.filter((l) => l.playerId !== playerId);
    return { ok: true, msg: "已清理" };
  }

  const idx = host.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return { ok: false, msg: "租入方名单异常" };
  const [p] = host.players.splice(idx, 1);
  stripFromLineup(host, playerId);
  p.loan = null;
  p.number = null;
  p.clubId = parent.id;
  parent.players.push(p);
  assignSquadNumbers(parent);
  autoLineup(host);
  autoLineup(parent);
  world.loans = world.loans.filter((l) => l.playerId !== playerId);

  const label =
    reason === "recall"
      ? "召回"
      : reason === "season"
        ? "赛季末归还"
        : "租借到期归还";
  world.news.unshift({
    day: world.day,
    text: `🔁 ${label}：${p.name} 返回 ${parent.name}（自 ${host.name}）`,
  });
  return { ok: true, msg: `${p.name} 已返回 ${parent.name}`, player: p };
}

/**
 * 母队召回外租球员
 */
export function recallLoan(world, playerId) {
  if (world.sacked) return { ok: false, msg: "你已被解雇，无法操作" };
  const found = findPlayerAnywhere(world, playerId);
  if (!found?.player?.loan) return { ok: false, msg: "该球员不在租借中" };
  const loan = found.player.loan;
  const parentId = loan.parentClubId || loan.fromClubId;
  if (parentId !== world.userClubId) {
    return { ok: false, msg: "只能召回本队外租球员" };
  }
  if (!loan.canRecall) return { ok: false, msg: "合同约定不可召回" };

  const user = clubById(world, world.userClubId);
  if (user && user.players.length >= 28) {
    return { ok: false, msg: "阵容已满，无法召回" };
  }

  // 窗外召回费：2 周薪
  const phase = getTransferPhase(world);
  let fee = 0;
  if (phase === "closed") {
    fee = Math.round((found.player.wage || 1000) * 2);
    if (user.money < fee) {
      return { ok: false, msg: `窗外召回需支付 ${formatMoney(fee)}` };
    }
    user.money -= fee;
  }

  const res = returnLoan(world, playerId, { reason: "recall" });
  if (!res.ok) return res;
  return {
    ok: true,
    msg:
      fee > 0
        ? `已召回 ${found.player.name}（召回费 ${formatMoney(fee)}）`
        : `已召回 ${found.player.name}`,
    fee,
  };
}

/** 每日：到期归还 */
export function processLoansDay(world) {
  if (!world) return [];
  ensureLoans(world);
  const day = world.day || 1;
  const returned = [];
  // 复制 id 列表，避免遍历中修改
  const due = world.loans.filter((l) => (l.untilDay || 9999) <= day);
  for (const l of due) {
    const r = returnLoan(world, l.playerId, { reason: "return" });
    if (r.ok) returned.push(l.playerName || l.playerId);
  }
  return returned;
}

/** 赛季切换：全部归还 */
export function returnAllLoans(world) {
  ensureLoans(world);
  const ids = world.loans.map((l) => l.playerId);
  const names = [];
  for (const id of ids) {
    const r = returnLoan(world, id, { reason: "season" });
    if (r.ok && r.player) names.push(r.player.name);
  }
  world.loans = [];
  return names;
}

/** 用户视角列表 */
export function listUserLoans(world) {
  ensureLoans(world);
  const uid = world.userClubId;
  const out = [];
  const inn = [];
  for (const l of world.loans) {
    const found = findPlayerAnywhere(world, l.playerId);
    const row = {
      ...l,
      player: found?.player || null,
      fromName: clubById(world, l.fromClubId)?.short || l.fromClubId,
      toName: clubById(world, l.toClubId)?.short || l.toClubId,
      untilLabel: l.untilDay >= 9999 ? "赛季末" : `D${l.untilDay}`,
    };
    if (l.fromClubId === uid) out.push(row);
    if (l.toClubId === uid) inn.push(row);
  }
  return { out, inn };
}

/**
 * 周薪：租借球员按分摊计入
 * 返回用户俱乐部应付一线周薪（含外租己方承担部分 + 租入承担部分）
 */
export function userSquadWageBill(world) {
  const user = clubById(world, world.userClubId);
  if (!user) return 0;
  ensureLoans(world);
  let total = 0;

  // 在册球员（含租入）
  for (const p of user.players) {
    const w = p.wage || 0;
    if (p.loan && p.loan.toClubId === user.id) {
      total += Math.round(w * (p.loan.wageShare ?? 1));
    } else if (!p.loan) {
      total += w;
    }
  }

  // 外租：母队承担 (1 - wageShare)
  for (const l of world.loans) {
    if (l.fromClubId !== user.id) continue;
    const found = findPlayerAnywhere(world, l.playerId);
    const w = found?.player?.wage || 0;
    const share = l.wageShare ?? found?.player?.loan?.wageShare ?? 0.75;
    total += Math.round(w * (1 - share));
  }

  return total;
}

export function isOnLoan(player) {
  return !!(player && player.loan);
}

export function isLoanedOut(world, playerId) {
  ensureLoans(world);
  return world.loans.some(
    (l) => l.playerId === playerId && l.fromClubId === world.userClubId
  );
}
