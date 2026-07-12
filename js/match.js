/**
 * 比赛模拟：情境修正、细事件、半场干预、赛后报告
 */

import {
  teamStrength,
  getLineupPlayers,
  autoLineup,
  formatMoney,
  ensurePlayerHistory,
} from "./models.js";
import { STYLE_MOD } from "./data.js";
import {
  coachMatchMod,
  doctorInjuryMod,
  ensureStaff,
} from "./staff.js";
import { trainingInjuryMod, matchdayIncome, stadiumInfo } from "./facilities.js";
import {
  mediaAfterUserMatch,
  narrativeAfterUserMatch,
  pushMedia,
} from "./media.js";
import { grantHonor } from "./honors.js";
import { advanceCupBracket } from "./cup.js";

function rng() {
  return Math.random();
}
function chance(p) {
  return rng() < p;
}
function clubById(world, id) {
  return world.clubs.find((c) => c.id === id);
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// ---------- 情境 ----------

const WEATHERS = [
  { key: "clear", name: "晴朗", icon: "☀️", atk: 1, def: 1, pace: 1, error: 1, injury: 1 },
  { key: "rain", name: "雨战", icon: "🌧️", atk: 0.93, def: 1.05, pace: 0.9, error: 1.25, injury: 1.1 },
  { key: "wind", name: "大风", icon: "💨", atk: 0.96, def: 0.98, pace: 0.94, error: 1.15, injury: 1 },
  { key: "cold", name: "严寒", icon: "❄️", atk: 0.97, def: 1.02, pace: 0.95, error: 1.05, injury: 1.2 },
  { key: "heat", name: "酷热", icon: "🔥", atk: 0.98, def: 0.97, pace: 0.88, error: 1.08, injury: 1.15 },
];

function pickWeather() {
  const r = rng();
  if (r < 0.42) return WEATHERS[0];
  if (r < 0.62) return WEATHERS[1];
  if (r < 0.76) return WEATHERS[2];
  if (r < 0.9) return WEATHERS[3];
  return WEATHERS[4];
}

/** 同级固定种子宿敌（约 1/7 对阵） */
function isDerby(home, away) {
  if (!home || !away) return false;
  if ((home.division || 3) !== (away.division || 3)) return false;
  const key = [home.id, away.id].sort().join("|");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 7 === 0;
}

function isBigMatch(world, home, away, isCup) {
  if (isCup) {
    const dh = home.division || 3;
    const da = away.division || 3;
    if (dh !== da) return true; // 跨级杯赛
  }
  if ((home.division || 3) === 1) {
    const ph = home.power || 50;
    const pa = away.power || 50;
    if (ph >= 72 && pa >= 72) return true;
  }
  return false;
}

function applyStyle(strength, tactics, side) {
  const mod = STYLE_MOD[tactics?.style] || STYLE_MOD.balanced;
  const press = 1 + ((tactics?.pressing || 3) - 3) * 0.03;
  const tempo = 1 + ((tactics?.tempo || 3) - 3) * 0.025;
  if (side === "atk") return strength * mod.atk * tempo * (0.97 + press * 0.03);
  return strength * mod.def * press;
}

function formScore(club, n = 5) {
  const f = club.form || [];
  const slice = f.slice(-n);
  let s = 0;
  for (const x of slice) {
    if (x === "W") s += 1;
    else if (x === "L") s -= 1;
  }
  return { score: s, len: slice.length };
}

function aiTuneTactics(club, opponent, world) {
  if (!club?.tactics || club.id === world.userClubId) return;
  const t = club.tactics;
  const fs = formScore(club, 5);
  const myP = club.power || 50;
  const opP = opponent?.power || 50;
  const diff = myP - opP;
  if (fs.len >= 3 && fs.score <= -2) {
    t.style = chance(0.5) ? "defend" : "counter";
    t.pressing = Math.max(1, Math.min(3, (t.pressing || 3) - 1));
    t.tempo = Math.max(1, Math.min(3, (t.tempo || 3) - 1));
  } else if (fs.len >= 3 && fs.score >= 2) {
    t.style = chance(0.55) ? "attack" : "balanced";
    t.pressing = Math.min(5, Math.max(3, (t.pressing || 3) + 1));
    t.tempo = Math.min(5, Math.max(3, (t.tempo || 3) + 1));
  } else if (diff <= -12) {
    t.style = "counter";
    t.pressing = 2;
    t.tempo = 2;
  } else if (diff >= 12) {
    t.style = chance(0.4) ? "attack" : "possession";
    t.pressing = 4;
    t.tempo = 3;
  }
  const xi = getLineupPlayers(club);
  const hurt = xi.filter((p) => p && (p.injured > 0 || (p.fitness || 100) < 55)).length;
  if (hurt >= 2 || !t.lineup?.length) autoLineup(club);
}

function emptySideStats() {
  return {
    shots: 0,
    shotsOn: 0,
    xg: 0,
    corners: 0,
    fouls: 0,
    yellows: 0,
    reds: 0,
    possessionTicks: 0,
    saves: 0,
    woodwork: 0,
  };
}

function recomputeSides(state) {
  const { home, away, weather, derby, bigMatch, isCup } = state;
  let homeAtk = applyStyle(teamStrength(home), home.tactics, "atk");
  let homeDef = applyStyle(teamStrength(home), home.tactics, "def");
  let awayAtk = applyStyle(teamStrength(away), away.tactics, "atk");
  let awayDef = applyStyle(teamStrength(away), away.tactics, "def");

  const hCoach = coachMatchMod(home);
  const aCoach = coachMatchMod(away);
  homeAtk *= hCoach;
  homeDef *= hCoach;
  awayAtk *= aCoach;
  awayDef *= aCoach;

  // 主场
  homeAtk *= 1.06;
  homeDef *= 1.04;

  // 天气
  homeAtk *= weather.atk;
  awayAtk *= weather.atk;
  homeDef *= weather.def;
  awayDef *= weather.def;
  const pace = weather.pace;

  // 德比：更开放、更高犯规
  if (derby) {
    homeAtk *= 1.06;
    awayAtk *= 1.06;
    homeDef *= 0.97;
    awayDef *= 0.97;
  }
  // 焦点战
  if (bigMatch) {
    homeAtk *= 1.03;
    awayAtk *= 1.03;
  }
  // 杯赛弱队爆冷空间
  if (isCup) {
    const dh = home.division || 3;
    const da = away.division || 3;
    if (dh > da) {
      // 主队级别更低 → 略提士气
      homeAtk *= 1.04;
      homeDef *= 1.03;
    } else if (da > dh) {
      awayAtk *= 1.04;
      awayDef *= 1.03;
    }
  }

  // 红牌减员
  const hRed = state.sentOff.home.size;
  const aRed = state.sentOff.away.size;
  if (hRed) {
    homeAtk *= Math.pow(0.88, hRed);
    homeDef *= Math.pow(0.86, hRed);
  }
  if (aRed) {
    awayAtk *= Math.pow(0.88, aRed);
    awayDef *= Math.pow(0.86, aRed);
  }

  state.homeAtk = homeAtk;
  state.homeDef = homeDef;
  state.awayAtk = awayAtk;
  state.awayDef = awayDef;
  state.pace = pace;
  state.homeXG = Math.max(0.15, (homeAtk / Math.max(awayDef, 1)) * 1.15 * pace);
  state.awayXG = Math.max(0.12, (awayAtk / Math.max(homeDef, 1)) * 1.0 * pace);
}

/**
 * 创建比赛会话（不写最终结果）
 */
export function createMatchSession(world, fixture) {
  const home = clubById(world, fixture.home);
  const away = clubById(world, fixture.away);
  if (!home || !away) throw new Error("invalid fixture clubs");

  ensureStaff(home);
  ensureStaff(away);
  if (home.id !== world.userClubId) aiTuneTactics(home, away, world);
  if (away.id !== world.userClubId) aiTuneTactics(away, home, world);
  autoLineup(home);
  autoLineup(away);

  const isCup = fixture.competition === "cup";
  const weather = pickWeather();
  const derby = isDerby(home, away);
  const bigMatch = isBigMatch(world, home, away, isCup);

  // 备份战术（半场改完可保留到终场）
  const userClub =
    home.id === world.userClubId ? home : away.id === world.userClubId ? away : null;

  const state = {
    world,
    fixture,
    home,
    away,
    isCup,
    weather,
    derby,
    bigMatch,
    events: [],
    stats: { home: emptySideStats(), away: emptySideStats() },
    hg: 0,
    ag: 0,
    phase: "pre",
    yellowCount: new Map(), // playerId -> n
    sentOff: { home: new Set(), away: new Set() }, // player ids
    injuredOut: new Set(),
    subsUsed: { home: 0, away: 0 },
    maxSubs: 3,
    userSide:
      home.id === world.userClubId ? "home" : away.id === world.userClubId ? "away" : null,
    userClub,
    finished: false,
    report: null,
  };

  recomputeSides(state);
  return state;
}

function pushEv(state, minute, type, text, extra = {}) {
  const ev = { minute, type, text, ...extra };
  state.events.push(ev);
  return ev;
}

function sideKey(state, club) {
  return club.id === state.home.id ? "home" : "away";
}

function activeXi(state, club) {
  const sk = sideKey(state, club);
  const sent = state.sentOff[sk];
  return getLineupPlayers(club).filter(
    (p) => p && !sent.has(p.id) && !state.injuredOut.has(p.id) && (p.injured || 0) <= 0
  );
}

function ensureStats(p) {
  ensurePlayerHistory(p);
  return p.stats;
}

function weightedPick(pool, weightFn) {
  if (!pool.length) return null;
  let total = 0;
  const weights = pool.map((p) => {
    const w = Math.max(0.01, weightFn(p));
    total += w;
    return w;
  });
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function pickScorer(xi) {
  const attackers = xi.filter((p) => p.pos === "ATT" || p.pos === "MID");
  const pool = attackers.length ? attackers : xi;
  return weightedPick(
    pool,
    (p) =>
      (p.attrs?.finishing || p.attrs?.shooting || 10) +
      (p.pos === "ATT" ? 6 : p.pos === "MID" ? 2 : 0) +
      rng() * 3
  );
}

function pickAssister(xi, scorer) {
  const pool = xi.filter((p) => p.id !== scorer.id && p.pos !== "GK");
  if (!pool.length || chance(0.28)) return null;
  return weightedPick(
    pool,
    (p) =>
      (p.attrs?.passing || 10) +
      (p.attrs?.vision || 8) +
      (p.pos === "MID" ? 5 : p.pos === "ATT" ? 2 : 1) +
      rng() * 2
  );
}

function pickDefender(xi) {
  const defs = xi.filter((p) => p.pos === "DEF" || p.pos === "MID");
  return weightedPick(defs.length ? defs : xi, (p) => (p.attrs?.tackling || p.attrs?.defending || 10) + rng() * 2);
}

function pickGk(xi) {
  return xi.find((p) => p.pos === "GK") || xi[0] || null;
}

function addGoal(state, minute, club, xi, { penalty = false } = {}) {
  const sk = sideKey(state, club);
  const scorer = pickScorer(xi);
  if (!scorer) return;
  const assister = penalty ? null : pickAssister(xi, scorer);
  if (sk === "home") state.hg++;
  else state.ag++;
  ensureStats(scorer).goals++;
  if (assister) ensureStats(assister).assists++;
  const st = state.stats[sk];
  st.shots++;
  st.shotsOn++;
  const xgAdd = penalty ? 0.76 : 0.12 + rng() * 0.28;
  st.xg += xgAdd;

  const assistText = assister ? `（助攻：${assister.name}）` : "";
  const label = penalty ? "点球破门" : "破门";
  pushEv(
    state,
    minute,
    "goal",
    `⚽ ${minute}' ${club.short} ${scorer.name} ${label}！${assistText}`,
    {
      teamId: club.id,
      playerId: scorer.id,
      assistId: assister?.id || null,
      penalty,
    }
  );
}

function tryAttack(state, minute, club, opp, atk, def, xgPer90) {
  const sk = sideKey(state, club);
  const oppSk = sk === "home" ? "away" : "home";
  const xi = activeXi(state, club);
  const oppXi = activeXi(state, opp);
  if (xi.length < 7) return;

  const st = state.stats[sk];
  const oppSt = state.stats[oppSk];
  // 控球按攻势强度加权（非每分钟双方各 +1）
  const hold = Math.max(0.15, atk / (atk + def + 1));
  if (chance(hold * 0.55 + xgPer90 * 0.08)) {
    st.possessionTicks += 1 + (chance(hold) ? 1 : 0);
  }

  // 角球
  if (chance(0.035 * (state.derby ? 1.2 : 1))) {
    st.corners++;
    pushEv(state, minute, "corner", `🚩 ${minute}' ${club.short} 获得角球`, { teamId: club.id });
    if (chance(0.18)) {
      // 角球转化威胁
      st.shots++;
      const xg = 0.08 + rng() * 0.12;
      st.xg += xg;
      if (chance(0.35 + atk / (atk + def) * 0.15)) {
        addGoal(state, minute, club, xi);
        return;
      }
      if (chance(0.4)) {
        st.shotsOn++;
        const gk = pickGk(oppXi);
        if (gk) {
          oppSt.saves++;
          pushEv(state, minute, "save", `🧤 ${minute}' ${opp.short} ${gk.name} 扑出角球攻门`, {
            teamId: opp.id,
            playerId: gk.id,
          });
        }
      }
    }
    return;
  }

  const threatChance = (xgPer90 / 90) * 1.85 * (state.weather.error || 1);
  if (!chance(threatChance)) return;

  st.shots++;
  const quality = 0.42 + atk / (atk + def + 1) * 0.22;
  const xg = clamp(0.04 + quality * 0.35 * rng(), 0.03, 0.45);
  st.xg += xg;

  // 点球（罕见）
  if (chance(0.018 * (state.derby ? 1.3 : 1))) {
    st.fouls++;
    state.stats[oppSk].fouls++;
    pushEv(state, minute, "penalty", `❗ ${minute}' 点球！${club.short} 获得主罚机会`, {
      teamId: club.id,
    });
    if (chance(0.78)) {
      addGoal(state, minute, club, xi, { penalty: true });
    } else {
      st.shotsOn++;
      const gk = pickGk(oppXi);
      pushEv(
        state,
        minute,
        "pen_miss",
        `😮 ${minute}' 点球未进！${gk ? opp.short + " " + gk.name + " 神扑" : club.short + " 罚失"}`,
        { teamId: club.id }
      );
      if (gk) oppSt.saves++;
    }
    return;
  }

  // 进球 / 扑救 / 中柱 / 偏出
  if (chance(quality)) {
    addGoal(state, minute, club, xi);
  } else if (chance(0.28)) {
    st.shotsOn++;
    const gk = pickGk(oppXi);
    if (gk) {
      oppSt.saves++;
      pushEv(state, minute, "save", `🧤 ${minute}' ${opp.short} ${gk.name} 扑救成功`, {
        teamId: opp.id,
        playerId: gk.id,
      });
    } else {
      pushEv(state, minute, "chance", `${minute}' ${club.short} 射正被挡出`);
    }
  } else if (chance(0.08)) {
    st.woodwork++;
    st.shotsOn++;
    pushEv(state, minute, "woodwork", `🪵 ${minute}' ${club.short} 打中门框！`, { teamId: club.id });
  } else if (chance(0.2)) {
    pushEv(state, minute, "chance", `${minute}' ${club.short} 错失良机`, { teamId: club.id });
  }
}

function tryCardOrFoul(state, minute) {
  const foulBase = 0.04 * (state.derby ? 1.35 : 1) * (state.bigMatch ? 1.1 : 1);
  if (!chance(foulBase)) return;

  const homeSide = chance(0.5);
  const club = homeSide ? state.home : state.away;
  const sk = homeSide ? "home" : "away";
  const xi = activeXi(state, club);
  const p = pickDefender(xi) || xi[0];
  if (!p) return;

  state.stats[sk].fouls++;

  // 黄牌 / 红牌
  const cardRoll = rng();
  const yellowRate = 0.35 * (state.derby ? 1.2 : 1);
  if (cardRoll < 0.04) {
    // 直红
    state.sentOff[sk].add(p.id);
    state.stats[sk].reds++;
    state.yellowCount.delete(p.id);
    pushEv(state, minute, "red", `🟥 ${minute}' ${club.short} ${p.name} 被红牌罚下！`, {
      teamId: club.id,
      playerId: p.id,
    });
    recomputeSides(state);
  } else if (cardRoll < yellowRate) {
    const prev = state.yellowCount.get(p.id) || 0;
    const next = prev + 1;
    state.yellowCount.set(p.id, next);
    state.stats[sk].yellows++;
    if (next >= 2) {
      state.sentOff[sk].add(p.id);
      state.stats[sk].reds++;
      pushEv(
        state,
        minute,
        "red",
        `🟥 ${minute}' ${club.short} ${p.name} 两黄变一红被罚下！`,
        { teamId: club.id, playerId: p.id, secondYellow: true }
      );
      recomputeSides(state);
    } else {
      pushEv(state, minute, "card", `🟨 ${minute}' ${club.short} ${p.name} 吃到黄牌`, {
        teamId: club.id,
        playerId: p.id,
      });
    }
  }
}

function tryInjury(state, minute) {
  const club = chance(0.5) ? state.home : state.away;
  const injuryMod = doctorInjuryMod(club) * trainingInjuryMod(club);
  // injuryMod 越低（好队医/设施）越不易伤
  const base = 0.005 * (state.weather.injury || 1) * injuryMod;
  if (!chance(base)) return;
  const sk = sideKey(state, club);
  const xi = activeXi(state, club);
  if (!xi.length) return;
  const p = xi[Math.floor(rng() * xi.length)];
  if (!p) return;
  // 唯一门将略保护
  if (p.pos === "GK" && xi.filter((x) => x.pos === "GK").length <= 1 && chance(0.7)) return;

  const days = 1 + Math.floor(rng() * 4);
  p.injured = days;
  p.fitness = Math.min(p.fitness, 45);
  state.injuredOut.add(p.id);
  pushEv(state, minute, "injury", `🏥 ${minute}' ${club.short} ${p.name} 受伤下场（约 ${days} 天）`, {
    teamId: club.id,
    playerId: p.id,
  });
  recomputeSides(state);

  // AI 自动用尽换人名额补人
  if (state.subsUsed[sk] < state.maxSubs && club.id !== state.world.userClubId) {
    aiAutoSub(state, club, p.id, minute);
  }
}

function aiAutoSub(state, club, outId, minute) {
  const sk = sideKey(state, club);
  if (state.subsUsed[sk] >= state.maxSubs) return;
  const xiIds = new Set(club.tactics.lineup);
  const outP = club.players.find((p) => p.id === outId);
  const bench = club.players
    .filter(
      (p) =>
        !xiIds.has(p.id) &&
        (p.injured || 0) <= 0 &&
        !state.sentOff[sk].has(p.id) &&
        (p.fitness || 0) > 50
    )
    .sort((a, b) => {
      const posMatch = outP && a.pos === outP.pos ? 5 : 0;
      return b.ovr + posMatch - (a.ovr + (outP && b.pos === outP.pos ? 5 : 0));
    });
  const inn = bench[0];
  if (!inn) return;
  applySubstitution(state, club, outId, inn.id, minute, true);
}

/**
 * 换人：更新 lineup
 */
export function applySubstitution(state, club, outId, inId, minute, silent = false) {
  const sk = sideKey(state, club);
  if (state.subsUsed[sk] >= state.maxSubs) {
    return { ok: false, msg: "换人次数已用尽（最多 3 次）" };
  }
  const lineup = club.tactics.lineup || [];
  const idx = lineup.indexOf(outId);
  if (idx < 0) return { ok: false, msg: "下场球员不在首发" };
  if (lineup.includes(inId)) return { ok: false, msg: "上场球员已在场上" };
  const inn = club.players.find((p) => p.id === inId);
  const outP = club.players.find((p) => p.id === outId);
  if (!inn || !outP) return { ok: false, msg: "球员无效" };
  if ((inn.injured || 0) > 0) return { ok: false, msg: "替补受伤无法上场" };
  if (state.sentOff[sk].has(inId)) return { ok: false, msg: "该球员已被罚下" };

  lineup[idx] = inId;
  club.tactics.lineup = lineup;
  state.subsUsed[sk]++;
  state.injuredOut.delete(outId); // 已换下

  if (!silent) {
    pushEv(
      state,
      minute,
      "sub",
      `🔄 ${minute}' ${club.short} 换人：${outP.name} ↓ → ${inn.name} ↑（${state.subsUsed[sk]}/${state.maxSubs}）`,
      { teamId: club.id, outId, inId }
    );
  } else {
    pushEv(
      state,
      minute,
      "sub",
      `🔄 ${minute}' ${club.short} 换人：${outP.name} ↓ → ${inn.name} ↑`,
      { teamId: club.id, outId, inId }
    );
  }
  recomputeSides(state);
  return { ok: true, msg: "换人成功" };
}

/**
 * 模拟一段时间（含 from，含 to）
 * onEvent?: async (ev, snapshot) => void  用于直播
 */
export async function simulateMinutes(state, fromMin, toMin, { onEvent } = {}) {
  for (let minute = fromMin; minute <= toMin; minute++) {
    if (minute === 46 && fromMin <= 45) {
      // 半场由外部处理
    }

    tryAttack(
      state,
      minute,
      state.home,
      state.away,
      state.homeAtk,
      state.awayDef,
      state.homeXG
    );
    tryAttack(
      state,
      minute,
      state.away,
      state.home,
      state.awayAtk,
      state.homeDef,
      state.awayXG
    );
    tryCardOrFoul(state, minute);
    tryInjury(state, minute);

    // 体能微耗
    if (minute % 15 === 0) {
      for (const club of [state.home, state.away]) {
        for (const p of activeXi(state, club)) {
          const drain = 1 + (club.tactics.pressing > 3 ? 1 : 0) + (state.weather.pace < 0.92 ? 1 : 0);
          p.fitness = Math.max(30, (p.fitness || 100) - drain);
        }
      }
      recomputeSides(state);
    }

    if (onEvent) {
      // 只回调本分钟新增事件
      const recent = state.events.filter((e) => e.minute === minute);
      for (const ev of recent) {
        await onEvent(ev, {
          homeGoals: state.hg,
          awayGoals: state.ag,
          minute,
        });
      }
      // 无事件也推进分钟显示
      if (!recent.length) {
        await onEvent(
          { minute, type: "tick", text: "" },
          { homeGoals: state.hg, awayGoals: state.ag, minute }
        );
      }
    }
  }
}

/** 开球 + 上半场 1–45 */
export async function playFirstHalf(state, opts = {}) {
  const { home, away, weather, derby, bigMatch, isCup, fixture } = state;
  pushEv(state, 0, "kickoff", "比赛开始！");
  const bits = [`${weather.icon} ${weather.name}`];
  if (derby) bits.push("🔥 德比大战");
  if (bigMatch) bits.push(isCup ? "🏆 焦点杯赛" : "⭐ 焦点战");
  pushEv(state, 0, "context", `情境：${bits.join(" · ")}`);
  if (opts.onEvent) {
    for (const ev of state.events) {
      await opts.onEvent(ev, { homeGoals: 0, awayGoals: 0, minute: 0 });
    }
  }
  state.phase = "h1";
  await simulateMinutes(state, 1, 45, opts);
  pushEv(state, 45, "ht", `中场休息 ${home.name} ${state.hg} - ${state.ag} ${away.name}`);
  if (opts.onEvent) {
    const ht = state.events[state.events.length - 1];
    await opts.onEvent(ht, {
      homeGoals: state.hg,
      awayGoals: state.ag,
      minute: 45,
    });
  }
  state.phase = "ht";
  return state;
}

/** AI 中场微调 + 可能换人 */
export function aiHalfTime(state) {
  for (const club of [state.home, state.away]) {
    if (club.id === state.world.userClubId) continue;
    const opp = club === state.home ? state.away : state.home;
    const myG = club === state.home ? state.hg : state.ag;
    const opG = club === state.home ? state.ag : state.hg;
    const t = club.tactics;
    if (myG < opG) {
      t.style = chance(0.5) ? "attack" : "balanced";
      t.pressing = Math.min(5, (t.pressing || 3) + 1);
      t.tempo = Math.min(5, (t.tempo || 3) + 1);
    } else if (myG > opG + 1) {
      t.style = chance(0.4) ? "defend" : "possession";
      t.pressing = Math.max(1, (t.pressing || 3) - 1);
    }
    // 换下疲劳/受伤
    const sk = sideKey(state, club);
    const xi = activeXi(state, club);
    const tired = xi.filter((p) => (p.fitness || 100) < 62).sort((a, b) => a.fitness - b.fitness);
    if (tired[0] && state.subsUsed[sk] < state.maxSubs && chance(0.55)) {
      aiAutoSub(state, club, tired[0].id, 46);
    }
  }
  recomputeSides(state);
}

/**
 * 用户中场指令
 * orders: { style?, pressing?, tempo?, subs?: [{outId, inId}] }
 */
export function applyUserHalfTime(state, orders = {}) {
  const club = state.userClub;
  if (!club) return { ok: false, msg: "无用户球队" };
  const t = club.tactics;
  if (orders.style) t.style = orders.style;
  if (orders.pressing != null) t.pressing = clamp(+orders.pressing, 1, 5);
  if (orders.tempo != null) t.tempo = clamp(+orders.tempo, 1, 5);

  const msgs = [];
  if (orders.style || orders.pressing != null || orders.tempo != null) {
    pushEv(
      state,
      45,
      "tactics",
      `📋 中场调整：${styleLabel(t.style)} · 压迫 ${t.pressing} · 节奏 ${t.tempo}`
    );
    msgs.push("战术已更新");
  }
  for (const s of orders.subs || []) {
    const res = applySubstitution(state, club, s.outId, s.inId, 46);
    msgs.push(res.msg);
  }
  recomputeSides(state);
  return { ok: true, msg: msgs.join("；") || "继续比赛" };
}

function styleLabel(s) {
  return (
    {
      balanced: "均衡",
      attack: "进攻",
      defend: "防守",
      possession: "控球",
      counter: "反击",
    }[s] || s
  );
}

/** 下半场 46–90 + 收尾事件（不含 finalize） */
export async function playSecondHalf(state, opts = {}) {
  aiHalfTime(state);
  state.phase = "h2";
  await simulateMinutes(state, 46, 90, opts);
  pushEv(
    state,
    90,
    "ft",
    `全场结束 ${state.home.name} ${state.hg} - ${state.ag} ${state.away.name}`
  );
  if (opts.onEvent) {
    const ft = state.events[state.events.length - 1];
    await opts.onEvent(ft, {
      homeGoals: state.hg,
      awayGoals: state.ag,
      minute: 90,
    });
  }
  state.phase = "ft";
  return state;
}

function possessionPct(state) {
  const h = state.stats.home.possessionTicks;
  const a = state.stats.away.possessionTicks;
  const t = h + a || 1;
  const hp = Math.round((h / t) * 100);
  return { home: hp, away: 100 - hp };
}

function buildReport(state) {
  const poss = possessionPct(state);
  const hs = state.stats.home;
  const as = state.stats.away;
  return {
    score: `${state.hg} - ${state.ag}`,
    homeGoals: state.hg,
    awayGoals: state.ag,
    weather: { key: state.weather.key, name: state.weather.name, icon: state.weather.icon },
    derby: state.derby,
    bigMatch: state.bigMatch,
    home: {
      name: state.home.name,
      short: state.home.short,
      shots: hs.shots,
      shotsOn: hs.shotsOn,
      xg: Math.round(hs.xg * 100) / 100,
      possession: poss.home,
      corners: hs.corners,
      fouls: hs.fouls,
      yellows: hs.yellows,
      reds: hs.reds,
      saves: hs.saves,
      woodwork: hs.woodwork,
    },
    away: {
      name: state.away.name,
      short: state.away.short,
      shots: as.shots,
      shotsOn: as.shotsOn,
      xg: Math.round(as.xg * 100) / 100,
      possession: poss.away,
      corners: as.corners,
      fouls: as.fouls,
      yellows: as.yellows,
      reds: as.reds,
      saves: as.saves,
      woodwork: as.woodwork,
    },
    scorers: state.events
      .filter((e) => e.type === "goal")
      .map((e) => ({
        minute: e.minute,
        teamId: e.teamId,
        playerId: e.playerId,
        text: e.text,
        penalty: !!e.penalty,
      })),
  };
}

function applyResult(world, f) {
  const ht = world.table[f.home];
  const at = world.table[f.away];
  if (!ht || !at) return;
  ht.played++;
  at.played++;
  ht.gf += f.homeGoals;
  ht.ga += f.awayGoals;
  at.gf += f.awayGoals;
  at.ga += f.homeGoals;

  if (f.homeGoals > f.awayGoals) {
    ht.w++;
    ht.pts += 3;
    at.l++;
    clubById(world, f.home).form.push("W");
    clubById(world, f.away).form.push("L");
  } else if (f.homeGoals < f.awayGoals) {
    at.w++;
    at.pts += 3;
    ht.l++;
    clubById(world, f.home).form.push("L");
    clubById(world, f.away).form.push("W");
  } else {
    ht.d++;
    at.d++;
    ht.pts++;
    at.pts++;
    clubById(world, f.home).form.push("D");
    clubById(world, f.away).form.push("D");
  }
  for (const c of world.clubs) {
    if (c.form.length > 5) c.form = c.form.slice(-5);
  }
}

function drainFitness(club, isHome, state) {
  const injuryMod = doctorInjuryMod(club) * trainingInjuryMod(club);
  const sk = club.id === state.home.id ? "home" : "away";
  const sent = state.sentOff[sk];
  for (const p of getLineupPlayers(club)) {
    if (sent.has(p.id)) continue;
    const drain = 4 + Math.floor(rng() * 6) + (club.tactics.pressing > 3 ? 2 : 0);
    p.fitness = Math.max(35, p.fitness - drain);
    if (chance(0.015 * injuryMod) && !state.injuredOut.has(p.id)) {
      p.injured = 1 + Math.floor(rng() * 3);
      p.fitness = Math.min(p.fitness, 50);
    }
  }
  const xi = new Set(club.tactics.lineup);
  for (const p of club.players) {
    if (!xi.has(p.id)) {
      p.fitness = Math.min(100, p.fitness + 3);
    }
  }
}

function updateMorale(club, gf, ga) {
  let delta = 0;
  if (gf > ga) delta = 6;
  else if (gf < ga) delta = -5;
  else delta = 1;
  for (const p of club.players) {
    p.morale = Math.max(20, Math.min(100, p.morale + delta + Math.floor(rng() * 3 - 1)));
  }
}

/**
 * 写入比分、积分、新闻、报告
 */
export function finalizeMatch(state) {
  if (state.finished) return state.report;
  const { world, fixture, home, away, isCup, hg, ag, events } = state;

  // 出场统计（终场仍在名单或上过场的简化：当前 lineup + 有事件的）
  const countApps = (club) => {
    for (const p of getLineupPlayers(club)) {
      ensureStats(p).apps++;
    }
  };
  countApps(home);
  countApps(away);

  const homeGk = pickGk(getLineupPlayers(home));
  const awayGk = pickGk(getLineupPlayers(away));
  if (homeGk) {
    ensureStats(homeGk).goalsConceded += ag;
    if (ag === 0) ensureStats(homeGk).cleanSheets++;
  }
  if (awayGk) {
    ensureStats(awayGk).goalsConceded += hg;
    if (hg === 0) ensureStats(awayGk).cleanSheets++;
  }

  fixture.homeGoals = hg;
  fixture.awayGoals = ag;
  fixture.played = true;
  fixture.events = events;
  fixture.weather = state.weather.key;
  fixture.derby = state.derby;

  if (!isCup) {
    applyResult(world, fixture);
  } else if (hg === ag) {
    const penHome = chance(0.5);
    fixture.winner = penHome ? home.id : away.id;
    fixture.penalties = true;
    events.push({
      minute: 90,
      type: "ft",
      text: `点球大战！${penHome ? home.name : away.name} 晋级（原 90 分钟 ${hg}-${ag}）`,
    });
  } else {
    fixture.winner = hg > ag ? home.id : away.id;
  }

  drainFitness(home, true, state);
  drainFitness(away, false, state);
  if (!isCup) {
    updateMorale(home, hg, ag);
    updateMorale(away, ag, hg);
  } else {
    const winId = fixture.winner;
    for (const c of [home, away]) {
      const won = c.id === winId;
      for (const p of c.players) {
        p.morale = Math.max(20, Math.min(100, p.morale + (won ? 4 : -2)));
      }
    }
  }

  const report = buildReport(state);
  fixture.matchReport = report;
  state.report = report;
  state.finished = true;

  // 用户场次新闻 / 收入 / 媒体
  const userId = world.userClubId;
  if (fixture.home === userId || fixture.away === userId) {
    const isHome = fixture.home === userId;
    const myG = isHome ? hg : ag;
    const opG = isHome ? ag : hg;
    const opp = isHome ? away : home;
    const me = isHome ? home : away;
    let result = "战平";
    if (isCup) {
      const won = fixture.winner === userId;
      result = won ? (fixture.penalties ? "点球晋级" : "晋级") : fixture.penalties ? "点球出局" : "出局";
    } else {
      if (myG > opG) result = "获胜";
      else if (myG < opG) result = "落败";
    }
    const tag = isCup ? `🏆 ${fixture.roundLabel || "联赛杯"}` : `第 ${fixture.round} 轮`;
    const ctx = [];
    if (state.derby) ctx.push("德比");
    if (state.weather.key !== "clear") ctx.push(state.weather.name);
    world.news.unshift({
      day: world.day,
      text: `${tag}：对阵 ${opp.name} ${myG}-${opG} ${result}${ctx.length ? `（${ctx.join("·")}）` : ""}`,
    });
    if (isHome) {
      const income = matchdayIncome(me, {
        isCup,
        won: myG > opG || (isCup && fixture.winner === userId),
      });
      // 德比/焦点略提收入
      const bonus = state.derby ? 1.15 : state.bigMatch ? 1.08 : 1;
      const finalIncome = Math.round(income * bonus);
      me.money += finalIncome;
      world.news.unshift({
        day: world.day,
        text: `🏟️ 主场收入 ${formatMoney(finalIncome)}（${stadiumInfo(me).name} · 容量约 ${stadiumInfo(me).capacity.toLocaleString()}）`,
      });
    }
    if (!isCup) {
      mediaAfterUserMatch(world, fixture, me, opp, myG, opG);
      narrativeAfterUserMatch(world, me, opp, myG, opG, false);
    } else {
      pushMedia(world, {
        outlet: "VC体育",
        headline: `${tag}：${me.name} ${myG}-${opG} ${opp.name}，${result}`,
        body: fixture.penalties
          ? "90 分钟难解难分，最终在点球大战中分出胜负。联赛杯永远充满戏剧性。"
          : `一场跨级别的较量吸引了媒体目光。${result.includes("晋级") ? "赢家笑到最后。" : "苦主只能专注联赛。"}`,
        tone: result.includes("晋级") ? "positive" : "negative",
        category: "cup",
      });
    }
  }

  if (isCup) {
    advanceCupBracket(world);
    if (world.cup?.stage === "done" && world.cup.champion) {
      const champ = clubById(world, world.cup.champion);
      if (champ) {
        for (const p of champ.players) {
          grantHonor(p, {
            season: world.season,
            type: "cup_winner",
            title: "VC 联赛杯冠军",
            detail: champ.name,
            clubId: champ.id,
            clubName: champ.name,
            division: champ.division,
          });
        }
        if (champ.id === world.userClubId) {
          pushMedia(world, {
            outlet: "联赛日报",
            headline: `金杯！${champ.name} 问鼎 VC 联赛杯`,
            body: "三级别球队同场竞技的舞台上，他们站到了最高领奖台。",
            tone: "positive",
            category: "cup",
          });
        }
      }
    }
  }

  return {
    homeGoals: hg,
    awayGoals: ag,
    events,
    report,
  };
}

/**
 * 完整模拟一场（AI 场次 / 用户快速无暂停）
 * options.pauseAtHalf: 若 true 且用户队，只踢上半场并返回 state（不 finalize）
 */
export async function simulateMatchFull(world, fixture, options = {}) {
  const state = createMatchSession(world, fixture);
  const onEvent = options.onEvent;
  await playFirstHalf(state, { onEvent });

  if (options.pauseAtHalf && state.userSide) {
    return { paused: true, state, homeGoals: state.hg, awayGoals: state.ag, events: state.events };
  }

  await playSecondHalf(state, { onEvent });
  const result = finalizeMatch(state);
  return { paused: false, state, ...result };
}

function runMinutesSync(state, fromMin, toMin) {
  for (let minute = fromMin; minute <= toMin; minute++) {
    tryAttack(state, minute, state.home, state.away, state.homeAtk, state.awayDef, state.homeXG);
    tryAttack(state, minute, state.away, state.home, state.awayAtk, state.homeDef, state.awayXG);
    tryCardOrFoul(state, minute);
    tryInjury(state, minute);
    if (minute % 15 === 0) {
      for (const club of [state.home, state.away]) {
        for (const p of activeXi(state, club)) {
          const drain = 1 + (club.tactics.pressing > 3 ? 1 : 0);
          p.fitness = Math.max(30, (p.fitness || 100) - drain);
        }
      }
      recomputeSides(state);
    }
  }
}

/** 同步完整模拟（AI 场次 / 快速无暂停） */
export function simulateMatchSync(world, fixture) {
  const state = createMatchSession(world, fixture);
  const { home, away, weather, derby, bigMatch, isCup } = state;
  pushEv(state, 0, "kickoff", "比赛开始！");
  const bits = [`${weather.icon} ${weather.name}`];
  if (derby) bits.push("🔥 德比大战");
  if (bigMatch) bits.push(isCup ? "🏆 焦点杯赛" : "⭐ 焦点战");
  pushEv(state, 0, "context", `情境：${bits.join(" · ")}`);
  runMinutesSync(state, 1, 45);
  pushEv(state, 45, "ht", `中场休息 ${home.name} ${state.hg} - ${state.ag} ${away.name}`);
  aiHalfTime(state);
  runMinutesSync(state, 46, 90);
  pushEv(state, 90, "ft", `全场结束 ${home.name} ${state.hg} - ${state.ag} ${away.name}`);
  return finalizeMatch(state);
}

/** 兼容旧 API：同步完整模拟 */
export function simulateMatch(world, fixture, _opts = {}) {
  return simulateMatchSync(world, fixture);
}

/** 下半场继续（用户中场指令后） */
export async function continueSecondHalf(state, orders = {}, opts = {}) {
  if (state.phase !== "ht" && state.phase !== "h1") {
    // allow if already at ht
  }
  if (state.userSide && orders) {
    applyUserHalfTime(state, orders);
  }
  await playSecondHalf(state, opts);
  return finalizeMatch(state);
}

export function getBenchPlayers(club, state) {
  const xi = new Set(club.tactics.lineup || []);
  const sk = sideKey(state, club);
  return club.players
    .filter(
      (p) =>
        !xi.has(p.id) &&
        (p.injured || 0) <= 0 &&
        !state.sentOff[sk].has(p.id)
    )
    .sort((a, b) => b.ovr - a.ovr);
}

export function getOnFieldPlayers(club, state) {
  return activeXi(state, club);
}

export { styleLabel };
