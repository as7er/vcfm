/** 董事会目标：赛季任务、进度、奖惩 */

import { DIVISIONS } from "./data.js";
import { formatMoney } from "./models.js";

const STATUS_LABEL = {
  active: "进行中",
  on_track: "达标轨道",
  met: "达标轨道",
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

  let type;
  let targetPos;
  let label;

  if (div === 3) {
    if (powerRank <= 4) {
      type = "promote";
      targetPos = 3;
      label = "升级甲级（前 3 名）";
    } else if (powerRank <= 10) {
      type = "top_half";
      targetPos = 10;
      label = "杀入前半区（前 10）";
    } else {
      type = "midtable";
      targetPos = 14;
      label = "稳住中游（前 14）";
    }
  } else if (div === 2) {
    if (powerRank <= 3) {
      type = "promote";
      targetPos = 3;
      label = "升级超联（前 3 名）";
    } else if (powerRank >= n - 4) {
      type = "survive";
      targetPos = n - 3;
      label = `保级（第 ${n - 3} 名或更好）`;
    } else if (powerRank <= 8) {
      type = "top_half";
      targetPos = 10;
      label = "冲击前半区（前 10）";
    } else {
      type = "midtable";
      targetPos = 14;
      label = "中游安全（前 14）";
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
      text: `📋 董事会目标：${world.board.label}。达成奖金 ${formatMoney(world.board.bonus)}，未完成罚款 ${formatMoney(world.board.fine)}。`,
    });
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

/** 赛季中施压/鼓励（约每 14 天） */
export function checkBoardMidSeason(world, sortedTableFn) {
  if (!world || world.seasonOver) return;
  const board = ensureBoardObjective(world);
  if (!board || board.settled) return;

  const prog = evaluateBoardProgress(world, sortedTableFn);
  if (!prog || prog.played < 8) return;
  if (world.day - (board.lastCheckDay || 0) < 14) return;

  const prev = board._lastNewsStatus || "active";
  board.lastCheckDay = world.day;
  board._lastNewsStatus = prog.status;

  const user = world.clubs.find((c) => c.id === world.userClubId);
  if (!user) return;

  if (prog.status === "danger" && prev !== "danger") {
    world.news.unshift({
      day: world.day,
      text: `⚠️ 董事会施压：当前第 ${prog.pos}，目标「${board.label}」。继续下滑将面临罚款 ${formatMoney(board.fine)}。`,
    });
    for (const p of user.players || []) {
      p.morale = Math.max(30, (p.morale || 70) - 2);
    }
  } else if (prog.status === "met" && prev === "danger") {
    world.news.unshift({
      day: world.day,
      text: `✅ 董事会认可：排名回升至第 ${prog.pos}，目标「${board.label}」重回正轨。`,
    });
    for (const p of user.players || []) {
      p.morale = Math.min(100, (p.morale || 70) + 1);
    }
  } else if (prog.status === "danger" && world.day % 28 < 3) {
    world.news.unshift({
      day: world.day,
      text: `📉 目标告急：仍在第 ${prog.pos}（目标前 ${board.targetPos}）。`,
    });
  }
}

/** 赛季末结算奖金/罚款（须在已知最终排名时调用） */
export function settleBoardObjective(world, finalPos, sortedTableFn) {
  const board = world?.board;
  if (!board || board.settled) return null;
  if (board.season != null && board.season !== world.season) return null;

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
    world.news.unshift({
      day: world.day,
      text: `🎯 董事会目标完成！${divName}第 ${pos} 名 · 「${board.label}」。奖金 ${formatMoney(board.bonus)} 已到账。`,
    });
    for (const p of user.players || []) {
      p.morale = Math.min(100, (p.morale || 70) + 4);
    }
    return { ok: true, status: "success", money: board.bonus };
  }

  user.money = Math.max(0, user.money - board.fine);
  world.news.unshift({
    day: world.day,
    text: `❌ 董事会目标未完成：${divName}第 ${pos} 名（目标前 ${board.targetPos}）。罚款 ${formatMoney(board.fine)}。`,
  });
  for (const p of user.players || []) {
    p.morale = Math.max(25, (p.morale || 70) - 5);
  }
  return { ok: false, status: "failed", money: -board.fine };
}

/** UI 摘要：board + 可选当前排名/场次 */
export function boardStatusLine(board, pos, played) {
  if (!board) return "—";
  if (board.settled) {
    const st = board.status === "success" || board.status === "achieved" ? "已完成" : "未完成";
    return `${board.label} · ${st}（赛季末第 ${board.finalPos ?? "—"}） · 奖 ${formatMoney(board.bonus)} / 罚 ${formatMoney(board.fine)}`;
  }
  const st = boardStatusLabel(board.status);
  const posText = pos > 0 ? `当前第 ${pos}` : "尚未开赛";
  const games = played != null ? ` · 已赛 ${played} 场` : "";
  return `${board.label} · ${st}（${posText}${games}） · 奖 ${formatMoney(board.bonus)} / 罚 ${formatMoney(board.fine)}`;
}

/**
 * UI 色调：可传 board 对象或 status 字符串
 * @returns {""|"ok"|"warn"|"danger"}
 */
export function boardTone(boardOrStatus) {
  const s =
    typeof boardOrStatus === "string"
      ? boardOrStatus
      : boardOrStatus?.status;
  if (!s) return "";
  if (s === "success" || s === "achieved" || s === "met" || s === "on_track") return "ok";
  if (s === "tight" || s === "active") return "warn";
  if (s === "danger" || s === "at_risk" || s === "failed") return "danger";
  return "";
}
