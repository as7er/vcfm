/** 董事会目标：赛季任务、进度、奖惩 */

import { DIVISIONS } from "./data.js";
import { formatMoney } from "./models.js";
import { pushBoardInbox, pushBoardObjectiveMail } from "./inbox.js";

const STATUS_LABEL = {
  active: "进行中",
  on_track: "达标中",
  met: "达标中",
  tight: "边缘",
  at_risk: "危险",
  danger: "危险",
  success: "完成",
  achieved: "完成",
  failed: "未完成",
};

/** 按队力在本级排名生成目标 */
export function generateBoardObjective(userClub, allClubs, season) {
  const div = userClub.division || 3;
  const peers = allClubs.filter((c) => (c.division || 3) === div);
  const sorted = [...peers].sort(
    (a, b) => (b.power || 0) - (a.power || 0) || String(a.id).localeCompare(String(b.id))
  );
  const powerRank = Math.max(1, sorted.findIndex((c) => c.id === userClub.id) + 1);
  const n = peers.length || 20;
  const division = DIVISIONS[div] || DIVISIONS[3];
  const tier = division.tier || 3;
  const upperName = DIVISIONS[division.upperDivision]?.name || "上级联赛";

  let type;
  let targetPos;
  let label;

  if (tier > 1 && !division.lowerDivision) {
    if (powerRank <= 4) {
      type = "promote";
      targetPos = division.promote || 3;
      label = `升级${upperName}（前 ${targetPos} 名）`;
    } else if (powerRank <= Math.ceil(n / 2)) {
      type = "top_half";
      targetPos = Math.ceil(n / 2);
      label = `杀入前半区（前 ${targetPos}）`;
    } else {
      type = "midtable";
      targetPos = Math.max(1, n - 4);
      label = `稳住中游（前 ${targetPos}）`;
    }
  } else if (tier > 1) {
    if (powerRank <= 3) {
      type = "promote";
      targetPos = division.promote || 3;
      label = `升级${upperName}（前 ${targetPos} 名）`;
    } else if (powerRank >= n - 4) {
      type = "survive";
      targetPos = n - 3;
      label = `保级（第 ${n - 3} 名或更好）`;
    } else if (powerRank <= 8) {
      type = "top_half";
      targetPos = Math.ceil(n / 2);
      label = `冲击前半区（前 ${targetPos}）`;
    } else {
      type = "midtable";
      targetPos = Math.max(1, n - 4);
      label = `中游安全（前 ${targetPos}）`;
    }
  } else if (powerRank <= 2) {
    type = "title";
    targetPos = 1;
    label = "争夺冠军（第 1）";
  } else if (powerRank <= 6) {
    type = "top_half";
    targetPos = 6;
    label = "前 6 名";
  } else if (powerRank >= n - 4) {
    type = "survive";
    targetPos = n - 3;
    label = `保级（第 ${n - 3} 名或更好）`;
  } else {
    type = "midtable";
    targetPos = 12;
    label = "中游安全区（前 12）";
  }

  const pot = Math.max(2_000_000, userClub.money || 5_000_000);
  const bonus = Math.round((pot * 0.06 + 400_000) / 10_000) * 10_000;
  const fine = Math.round((bonus * 0.55) / 10_000) * 10_000;

  return {
    season: season || null,
    division: div,
    type,
    targetPos,
    label,
    bonus,
    fine,
    status: "active",
    lastCheckDay: 0,
    settled: false,
    /** 解雇警告 0–3，满 3 中途解雇 */
    sackWarnings: 0,
    sacked: false,
  };
}

/** 确保本赛季有董事会目标 */
export function ensureBoardObjective(world) {
  if (!world) return null;
  const user = world.clubs?.find((c) => c.id === world.userClubId);
  if (!user) return null;

  if (!world.board || world.board.season !== world.season) {
    world.board = generateBoardObjective(user, world.clubs, world.season);
    world.news = world.news || [];
    world.news.unshift({
      day: world.day || 1,
      text: `董事会目标：${world.board.label}。达成奖金 ${formatMoney(world.board.bonus)}，未完成罚款 ${formatMoney(world.board.fine)}。`,
    });
    try {
      pushBoardObjectiveMail(world, world.board);
    } catch (_) {
      /* ignore */
    }
  }
  return world.board;
}

export function boardStatusLabel(status) {
  return STATUS_LABEL[status] || status || "—";
}

/**
 * 当前进度
 * status: active | met | danger | success | failed
 */
export function evaluateBoardProgress(world, sortedTableFn) {
  const board = ensureBoardObjective(world);
  if (!board) return null;
  const user = world.clubs.find((c) => c.id === world.userClubId);
  if (!user) return null;

  let table = [];
  if (typeof sortedTableFn === "function") {
    table = sortedTableFn(world, user.division || 3);
  } else {
    const div = user.division || 3;
    table = world.clubs
      .filter((c) => (c.division || 3) === div)
      .map((c) => {
        const t = world.table?.[c.id] || { pts: 0, gf: 0, ga: 0, played: 0 };
        return {
          id: c.id,
          pts: t.pts || 0,
          gd: (t.gf || 0) - (t.ga || 0),
          gf: t.gf || 0,
          played: t.played || 0,
        };
      })
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  }

  const pos = table.findIndex((r) => r.id === user.id) + 1;
  const row = table.find((r) => r.id === user.id);
  const played = row?.played || 0;

  let status = board.status;
  if (board.settled) {
    status = board.status === "achieved" || board.status === "success" ? "success" : "failed";
  } else if (world.seasonOver) {
    status = pos > 0 && pos <= board.targetPos ? "success" : "failed";
  } else if (played < 6) {
    status = "active";
  } else if (pos > 0 && pos <= board.targetPos) {
    status = "met";
  } else if (pos > 0 && pos <= board.targetPos + 2) {
    status = "active";
  } else {
    status = "danger";
  }

  if (!board.settled) board.status = status;

  return {
    board,
    pos,
    played,
    status,
    targetPos: board.targetPos,
    label: board.label,
    bonus: board.bonus,
    fine: board.fine,
    settled: !!board.settled,
  };
}

/**
 * 执行解雇：标记存档、新闻、士气崩盘。
 * 返回 { sacked: true, msg } 供 UI 弹回菜单。
 */
export function sackManager(world, reason = "") {
  const board = ensureBoardObjective(world);
  const user = world.clubs?.find((c) => c.id === world.userClubId);
  if (!user) return { sacked: false };

  if (board) {
    board.sacked = true;
    board.status = "failed";
  }
  world.sacked = true;
  world.sackedDay = world.day;
  world.sackedReason = reason || "董事会对成绩失去耐心";
  try {
    if (!world.managerCareer) world.managerCareer = { sacked: 0 };
    world.managerCareer.sacked = (world.managerCareer.sacked || 0) + 1;
  } catch (_) {
    /* ignore */
  }

  for (const p of user.players || []) {
    p.morale = Math.max(20, (p.morale || 70) - 12);
  }

  world.news = world.news || [];
  world.news.unshift({
    day: world.day,
    text: `🚨 解雇通告：${world.managerName || "经理"} 被 ${user.name} 董事会解除职务。${world.sackedReason}`,
  });

  return {
    sacked: true,
    msg: `你已被 ${user.name} 解雇。${world.sackedReason}`,
    clubName: user.name,
  };
}

/** 赛季中施压/鼓励（约每 14 天）；危险累计警告，满 3 解雇 */
export function checkBoardMidSeason(world, sortedTableFn) {
  if (!world || world.seasonOver || world.sacked) return null;
  const board = ensureBoardObjective(world);
  if (!board || board.settled || board.sacked) return null;

  const prog = evaluateBoardProgress(world, sortedTableFn);
  if (!prog || prog.played < 8) return null;
  if (world.day - (board.lastCheckDay || 0) < 14) return null;

  const prev = board._lastNewsStatus || "active";
  board.lastCheckDay = world.day;
  board._lastNewsStatus = prog.status;
  if (board.sackWarnings == null) board.sackWarnings = 0;

  const user = world.clubs.find((c) => c.id === world.userClubId);
  if (!user) return null;

  if (prog.status === "danger") {
    // 持续危险就加警告；刚进入危险也加
    board.sackWarnings = Math.min(3, (board.sackWarnings || 0) + 1);
    const w = board.sackWarnings;
    if (w >= 3) {
      return sackManager(
        world,
        `联赛第 ${prog.pos}，远未达到「${board.label}」，董事会忍无可忍。`
      );
    }
    if (w === 2) {
      const text = `⚠️ 最后警告：当前第 ${prog.pos}，目标「${board.label}」。再无起色将被解雇！（警告 ${w}/3）`;
      world.news.unshift({ day: world.day, text });
      pushBoardInbox(world, {
        title: "董事会最后警告",
        body: text,
        warning: true,
        priority: 3,
      });
    } else {
      const text = `董事会施压：当前第 ${prog.pos}，目标「${board.label}」。警告 ${w}/3 · 未完成将罚 ${formatMoney(board.fine)}。`;
      world.news.unshift({ day: world.day, text });
      pushBoardInbox(world, {
        title: "董事会施压",
        body: text,
        warning: true,
        priority: 3,
      });
    }
    for (const p of user.players || []) {
      p.morale = Math.max(30, (p.morale || 70) - 2 - w);
    }
  } else if (prog.status === "met") {
    if ((board.sackWarnings || 0) > 0) {
      board.sackWarnings = Math.max(0, board.sackWarnings - 1);
      const text = `董事会认可：排名回升至第 ${prog.pos}，目标重回正轨。警告降至 ${board.sackWarnings}/3。`;
      world.news.unshift({ day: world.day, text });
      pushBoardInbox(world, {
        title: "董事会认可近况",
        body: text,
        priority: 1,
      });
      for (const p of user.players || []) {
        p.morale = Math.min(100, (p.morale || 70) + 2);
      }
    } else if (prev === "danger") {
      const text = `董事会认可：排名回升至第 ${prog.pos}，目标「${board.label}」重回正轨。`;
      world.news.unshift({ day: world.day, text });
      pushBoardInbox(world, {
        title: "董事会认可近况",
        body: text,
        priority: 1,
      });
      for (const p of user.players || []) {
        p.morale = Math.min(100, (p.morale || 70) + 1);
      }
    }
  } else if (prog.status === "danger" && world.day % 28 < 3) {
    const text = `目标告急：仍在第 ${prog.pos}（目标前 ${board.targetPos}）· 警告 ${board.sackWarnings || 0}/3`;
    world.news.unshift({ day: world.day, text });
    pushBoardInbox(world, {
      title: "目标告急",
      body: text,
      warning: true,
      priority: 2,
    });
  }
  return null;
}

/** 赛季末结算奖金/罚款；严重未完成可能解雇 */
export function settleBoardObjective(world, finalPos, sortedTableFn) {
  const board = world?.board;
  if (!board || board.settled) return null;
  if (board.season != null && board.season !== world.season) return null;
  if (world.sacked || board.sacked) {
    board.settled = true;
    return { ok: false, status: "failed", sacked: true };
  }

  const user = world.clubs.find((c) => c.id === world.userClubId);
  if (!user) return null;

  let pos = finalPos;
  if (pos == null || pos <= 0) {
    const prog = evaluateBoardProgress(world, sortedTableFn);
    pos = prog?.pos || 99;
  }

  const ok = pos <= board.targetPos;
  board.settled = true;
  board.finalPos = pos;
  board.status = ok ? "success" : "failed";

  const divName = DIVISIONS[board.division || user.division || 3]?.name || "";
  if (ok) {
    user.money += board.bonus;
    board.sackWarnings = 0;
    world.news.unshift({
      day: world.day,
      text: `董事会目标完成！${divName}第 ${pos} 名 · 「${board.label}」。奖金 ${formatMoney(board.bonus)} 已到账。`,
    });
    for (const p of user.players || []) {
      p.morale = Math.min(100, (p.morale || 70) + 4);
    }
    return { ok: true, status: "success", money: board.bonus };
  }

  user.money = Math.max(0, user.money - board.fine);
  world.news.unshift({
    day: world.day,
    text: `董事会目标未完成：${divName}第 ${pos} 名（目标前 ${board.targetPos}）。罚款 ${formatMoney(board.fine)}。`,
  });
  for (const p of user.players || []) {
    p.morale = Math.max(25, (p.morale || 70) - 5);
  }

  // 赛季末解雇：警告≥2，或名次远差于目标（+5 名以上）
  const warnings = board.sackWarnings || 0;
  const farMiss = pos > board.targetPos + 5;
  const shouldSack = warnings >= 2 || farMiss;
  if (shouldSack) {
    const sack = sackManager(
      world,
      `赛季结束${divName}第 ${pos}（目标前 ${board.targetPos}），董事会不再续约。`
    );
    return { ok: false, status: "failed", money: -board.fine, sacked: true, sack };
  }

  return { ok: false, status: "failed", money: -board.fine, sacked: false };
}

export function boardObjectiveLabel(board) {
  return board?.label || "—";
}

/** UI 一行摘要 */
export function boardStatusLine(board) {
  if (!board) return "—";
  if (board.sacked) {
    return `${board.label} · 已解雇`;
  }
  if (board.settled) {
    const st = board.status === "success" || board.status === "achieved" ? "已完成" : "未完成";
    return `${board.label} · ${st}（赛季末第 ${board.finalPos ?? "—"}）`;
  }
  const w = board.sackWarnings || 0;
  const warn = w > 0 ? ` · 警告 ${w}/3` : "";
  return `${board.label} · ${boardStatusLabel(board.status)}${warn} · 奖 ${formatMoney(board.bonus)} / 罚 ${formatMoney(board.fine)}`;
}

/** UI 样式：ok | warn | danger | "" */
export function boardTone(board) {
  if (!board) return "";
  if (board.settled) {
    return board.status === "success" || board.status === "achieved" ? "ok" : "danger";
  }
  const s = board.status;
  if (s === "met" || s === "on_track" || s === "success" || s === "achieved") return "ok";
  if (s === "tight" || s === "warn") return "warn";
  if (s === "danger" || s === "at_risk" || s === "failed") return "danger";
  return "";
}
