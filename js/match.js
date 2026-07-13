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
import { processClubMatchDiscipline } from "./discipline.js";
import { ensureManagerCareer, recordManagerMatch } from "./career.js";

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

export const WEATHERS = [
  { key: "clear", name: "晴朗", icon: "☀️", atk: 1, def: 1, pace: 1, error: 1, injury: 1 },
  { key: "rain", name: "雨战", icon: "🌧️", atk: 0.93, def: 1.05, pace: 0.9, error: 1.25, injury: 1.1 },
  { key: "wind", name: "大风", icon: "💨", atk: 0.96, def: 0.98, pace: 0.94, error: 1.15, injury: 1 },
  { key: "cold", name: "严寒", icon: "❄️", atk: 0.97, def: 1.02, pace: 0.95, error: 1.05, injury: 1.2 },
  { key: "heat", name: "酷热", icon: "🔥", atk: 0.98, def: 0.97, pace: 0.88, error: 1.08, injury: 1.15 },
];

export function pickWeather() {
  const r = rng();
  if (r < 0.42) return WEATHERS[0];
  if (r < 0.62) return WEATHERS[1];
  if (r < 0.76) return WEATHERS[2];
  if (r < 0.9) return WEATHERS[3];
  return WEATHERS[4];
}

/** 按 key 取天气；未知则重新抽取 */
export function weatherByKey(key) {
  return WEATHERS.find((w) => w.key === key) || pickWeather();
}

/**
 * 赛前锁定天气（简报与开赛一致）
 * @returns {typeof WEATHERS[0]}
 */
export function ensureFixtureWeather(fixture) {
  if (!fixture) return pickWeather();
  if (fixture.preWeather && typeof fixture.preWeather === "object" && fixture.preWeather.key) {
    return weatherByKey(fixture.preWeather.key);
  }
  if (fixture.weather && typeof fixture.weather === "string") {
    const w = weatherByKey(fixture.weather);
    fixture.preWeather = { key: w.key, name: w.name, icon: w.icon };
    return w;
  }
  const w = pickWeather();
  fixture.preWeather = { key: w.key, name: w.name, icon: w.icon };
  return w;
}

/** 同级固定种子宿敌（约 1/7 对阵） */
export function isDerby(home, away) {
  if (!home || !away) return false;
  if ((home.division || 3) !== (away.division || 3)) return false;
  const key = [home.id, away.id].sort().join("|");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 7 === 0;
}

export function isBigMatch(world, home, away, isCup) {
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
  // 与赛前简报同一天气（已锁定则复用）
  const weather = ensureFixtureWeather(fixture);
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
    /** 正式比赛：每队最多 5 次换人（与当代足球/FMM 一致） */
    maxSubs: 5,
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
  // 个人赛季数据只计联赛（数据榜 / 阵容赛季列）
  if (!state.isCup) {
    ensureStats(scorer).goals++;
    if (assister) ensureStats(assister).assists++;
  }
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
    return { ok: false, msg: `换人次数已用尽（最多 ${state.maxSubs} 次）` };
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
    state.minute = minute;
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
    midMatchCoachPrompt(state, minute);

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
      // 只回调本分钟新增事件（带实时 xG/控球）
      const snap = liveSnap(state, minute);
      const recent = state.events.filter((e) => e.minute === minute);
      for (const ev of recent) {
        await onEvent(ev, snap);
      }
      // 无事件也推进分钟显示
      if (!recent.length) {
        await onEvent({ minute, type: "tick", text: "" }, snap);
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
    const snap0 = liveSnap(state, 0);
    for (const ev of state.events) {
      await opts.onEvent(ev, snap0);
    }
  }
  state.phase = "h1";
  await simulateMinutes(state, 1, 45, opts);
  pushEv(state, 45, "ht", `中场休息 ${home.name} ${state.hg} - ${state.ag} ${away.name}`);
  if (opts.onEvent) {
    const ht = state.events[state.events.length - 1];
    await opts.onEvent(ht, liveSnap(state, 45));
  }
  state.phase = "ht";
  return state;
}

/** 赛中关键提示：60' / 75' 体能与比分建议（写入事件流） */
function midMatchCoachPrompt(state, minute) {
  if (minute !== 60 && minute !== 75) return;
  const club = state.userClub;
  if (!club) return;
  const myG = club === state.home ? state.hg : state.ag;
  const opG = club === state.home ? state.ag : state.hg;
  const xi = activeXi(state, club);
  const avgFit = xi.length
    ? Math.round(xi.reduce((s, p) => s + (p.fitness || 100), 0) / xi.length)
    : 80;
  const tired = xi.filter((p) => (p.fitness || 100) < 58).length;
  const tips = [];
  if (minute === 60) {
    if (myG < opG) tips.push("落后，可考虑加强压迫或换进攻点");
    else if (myG > opG) tips.push("领先，注意控场与体能分配");
    else tips.push("僵持中，可微调节奏寻找突破");
    if (avgFit < 68) tips.push(`首发平均体能 ${avgFit}%，考虑轮换`);
  } else {
    if (tired >= 2) tips.push(`${tired} 名主力体能告急，建议换人`);
    if (myG === opG) tips.push("比分胶着，最后 15 分钟是关键窗口");
    else if (myG === opG - 1) tips.push("仅落后 1 球，可冒险压上");
    else if (myG > opG) tips.push("守住优势，别急于冒进");
  }
  if (!tips.length) return;
  pushEv(state, minute, "coach", `💬 ${minute}' 教练席：${tips.join(" · ")}`);
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
      `📋 中场调整：${styleLabel(t.style)} · 压迫 ${t.pressing} · 节奏 ${t.tempo}`,
      {
        teamId: club.id,
        style: t.style,
        pressing: t.pressing,
        tempo: t.tempo,
      }
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

/**
 * 赛中即时战术（下半场直播中改压迫/风格/节奏）
 * 写入 events 供画面反馈；立即 recomputeSides
 */
export function applyLiveTactics(state, orders = {}) {
  const club = state.userClub;
  if (!club || !state || state.finished) return { ok: false, msg: "无法调整" };
  const t = club.tactics;
  let changed = false;
  if (orders.style && orders.style !== t.style) {
    t.style = orders.style;
    changed = true;
  }
  if (orders.pressing != null && +orders.pressing !== t.pressing) {
    t.pressing = clamp(+orders.pressing, 1, 5);
    changed = true;
  }
  if (orders.tempo != null && +orders.tempo !== t.tempo) {
    t.tempo = clamp(+orders.tempo, 1, 5);
    changed = true;
  }
  if (!changed) return { ok: true, msg: "无变化", tactics: { ...t } };
  const minute = state.minute || 46;
  pushEv(
    state,
    minute,
    "tactics",
    `📋 ${minute}' 场边调整：${styleLabel(t.style)} · 压迫 ${t.pressing} · 节奏 ${t.tempo}`,
    {
      teamId: club.id,
      style: t.style,
      pressing: t.pressing,
      tempo: t.tempo,
    }
  );
  recomputeSides(state);
  return {
    ok: true,
    msg: "战术已更新",
    tactics: { style: t.style, pressing: t.pressing, tempo: t.tempo },
    event: state.events[state.events.length - 1],
  };
}

/** 中场休息提示：体能告急 / 黄牌边缘（给 UI） */
export function getHalfTimeTips(state) {
  const club = state?.userClub;
  if (!club) return { fitness: [], yellows: [], scoreTip: "" };
  const sk = state.userSide;
  const sent = state.sentOff?.[sk] || new Set();
  const xi = getLineupPlayers(club).filter((p) => !sent.has(p.id));
  const fitness = xi
    .filter((p) => (p.fitness ?? 100) < 62)
    .sort((a, b) => (a.fitness ?? 100) - (b.fitness ?? 100))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      fitness: Math.round(p.fitness ?? 100),
    }));
  // 本场已吃黄（从事件推）+ 赛季累计边缘
  const booked = new Set(
    (state.events || [])
      .filter((e) => (e.type === "card" || e.type === "red") && e.playerId)
      .map((e) => e.playerId)
  );
  const yellows = xi
    .filter((p) => (p.yellowsSeason || 0) >= 4 || booked.has(p.id))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      yellows: p.yellowsSeason || 0,
      booked: booked.has(p.id),
    }));
  const myG = club === state.home ? state.hg : state.ag;
  const opG = club === state.home ? state.ag : state.hg;
  let scoreTip = "";
  if (myG < opG) scoreTip = "落后：可加强压迫或换进攻点";
  else if (myG > opG) scoreTip = "领先：注意控场与体能";
  else scoreTip = "平局：可微调节奏寻找突破";
  const avgFit = xi.length
    ? Math.round(xi.reduce((s, p) => s + (p.fitness || 100), 0) / xi.length)
    : 80;
  return { fitness, yellows, scoreTip, avgFit, myG, opG };
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
    await opts.onEvent(ft, liveSnap(state, 90));
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

/** 直播/回放用的实时数据快照（xG、控球、射门） */
function liveSnap(state, minute) {
  const poss = possessionPct(state);
  const hs = state.stats.home;
  const as = state.stats.away;
  return {
    homeGoals: state.hg,
    awayGoals: state.ag,
    minute: minute ?? state.minute ?? 0,
    home: {
      xg: Math.round(hs.xg * 100) / 100,
      shots: hs.shots,
      shotsOn: hs.shotsOn,
      possession: poss.home,
    },
    away: {
      xg: Math.round(as.xg * 100) / 100,
      shots: as.shots,
      shotsOn: as.shotsOn,
      possession: poss.away,
    },
  };
}

/**
 * 赛后文字复盘（3–5 句，经理可读）
 * 基于比分、xG、控球、关键事件，不改结果
 */
function buildMatchNarrative(state) {
  const lines = [];
  const h = state.home;
  const a = state.away;
  const hg = state.hg;
  const ag = state.ag;
  const poss = possessionPct(state);
  const hs = state.stats.home;
  const as = state.stats.away;
  const hx = Math.round(hs.xg * 100) / 100;
  const ax = Math.round(as.xg * 100) / 100;
  const goals = state.events.filter((e) => e.type === "goal");
  const reds = state.events.filter((e) => e.type === "red");
  const wood = (hs.woodwork || 0) + (as.woodwork || 0);

  // 1) 结果总览
  if (hg > ag) {
    lines.push(`${h.short || h.name} 主场 ${hg}-${ag} 击败 ${a.short || a.name}。`);
  } else if (ag > hg) {
    lines.push(`${a.short || a.name} 客场 ${ag}-${hg} 取胜，${h.short || h.name} 未能守住主场。`);
  } else {
    lines.push(`${h.short || h.name} 与 ${a.short || a.name} ${hg}-${ag} 握手言和。`);
  }

  // 2) xG / 控球读数
  const xgDiff = hx - ax;
  if (Math.abs(xgDiff) >= 0.35) {
    const better = xgDiff > 0 ? h.short || h.name : a.short || a.name;
    const worse = xgDiff > 0 ? a.short || a.name : h.short || h.name;
    if ((xgDiff > 0 && hg < ag) || (xgDiff < 0 && ag < hg)) {
      lines.push(
        `场面与结果背离：${better} 期望进球更高（${Math.max(hx, ax).toFixed(2)} vs ${Math.min(hx, ax).toFixed(2)}），却未能兑现。`
      );
    } else if ((xgDiff > 0 && hg > ag) || (xgDiff < 0 && ag > hg)) {
      lines.push(
        `${better} 创造了更多威胁（xG ${Math.max(hx, ax).toFixed(2)}-${Math.min(hx, ax).toFixed(2)}），比分与场面大体一致。`
      );
    } else {
      lines.push(
        `双方期望进球 ${hx.toFixed(2)}-${ax.toFixed(2)}；${better} 稍占上风，${worse} 防守顶住了压力。`
      );
    }
  } else if (Math.abs(poss.home - 50) >= 8) {
    const ballSide = poss.home >= poss.away ? h.short || h.name : a.short || a.name;
    lines.push(
      `${ballSide} 控球占优（${Math.max(poss.home, poss.away)}%-${Math.min(poss.home, poss.away)}%），但转化效率决定了最终比分。`
    );
  } else {
    lines.push(
      `控球与 xG 都接近（${poss.home}%-${poss.away}% · ${hx.toFixed(2)}-${ax.toFixed(2)}），是一场拉锯战。`
    );
  }

  // 3) 进球时间线
  if (goals.length === 1) {
    const g = goals[0];
    const club = g.teamId === h.id ? h : a;
    lines.push(`唯一进球出现在 ${g.minute}'，${club.short || club.name} 一球定胜负。`);
  } else if (goals.length >= 2) {
    const first = goals[0];
    const last = goals[goals.length - 1];
    const late = goals.filter((g) => g.minute >= 75);
    if (late.length) {
      lines.push(`比赛后段仍有进球：最后一球在 ${last.minute}'，${late.length} 粒进球来自 75' 之后。`);
    } else {
      lines.push(
        `共 ${goals.length} 粒进球，首开纪录于 ${first.minute}'，终场前一球在 ${last.minute}'。`
      );
    }
  } else {
    lines.push(`全场零封，双方门将与防线是本场主角之一。`);
  }

  // 4) 牌 / 门框等调味
  if (reds.length) {
    const r = reds[0];
    const club = r.teamId === h.id ? h : a;
    lines.push(`${r.minute}' ${club.short || club.name} 被罚下，人数劣势改写了后段走势。`);
  } else if (wood >= 2) {
    lines.push(`门框作响 ${wood} 次，运气也站在了比分一边。`);
  } else if (state.derby) {
    lines.push(`德比火药味足，拼抢与犯规都高于平常。`);
  } else if (state.bigMatch) {
    lines.push(`焦点战节奏紧，双方都不敢轻易压上。`);
  }

  // 5) MOTM（若已生成评分）
  const motm = state.matchRatings?.motm;
  if (motm?.name) {
    const bits = [];
    if (motm.goals) bits.push(`${motm.goals}球`);
    if (motm.assists) bits.push(`${motm.assists}助`);
    if (motm.saves) bits.push(`${motm.saves}扑`);
    const extra = bits.length ? `（${bits.join(" · ")}）` : "";
    lines.push(`本场最佳：${motm.name}${extra}，评分 ${motm.rating}。`);
  }

  return lines.slice(0, 5);
}

function buildReport(state) {
  const poss = possessionPct(state);
  const hs = state.stats.home;
  const as = state.stats.away;
  // 评分应在 finalize 里先算；若提前 buildReport 则 narrative 不含 MOTM
  const narrative = buildMatchNarrative(state);
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
    ratings: state.matchRatings || null,
    narrative,
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
 * 根据本场事件与比分，给出场球员打 1–10 评分（FM 风格）
 * @returns {{ home: object[], away: object[], motm: object|null }}
 */
function applyMatchRatings(state) {
  const { home, away, hg, ag, events } = state;
  /** @type {Map<string, { goals: number, assists: number, saves: number, yellow: number, red: number, wood: number }>} */
  const bag = new Map();
  const bump = (id, key, n = 1) => {
    if (!id) return;
    if (!bag.has(id)) {
      bag.set(id, { goals: 0, assists: 0, saves: 0, yellow: 0, red: 0, wood: 0 });
    }
    bag.get(id)[key] += n;
  };
  for (const e of events || []) {
    if (e.type === "goal") {
      bump(e.playerId, "goals");
      if (e.assistId) bump(e.assistId, "assists");
    } else if (e.type === "save" || e.type === "pen_miss") {
      // pen_miss 的 playerId 可能是主罚方；仅 save 记扑救
      if (e.type === "save") bump(e.playerId, "saves");
    } else if (e.type === "card") {
      bump(e.playerId, "yellow");
    } else if (e.type === "red") {
      bump(e.playerId, "red");
    } else if (e.type === "woodwork") {
      bump(e.playerId, "wood");
    }
  }

  const rateSide = (club, gf, ga, won, drew) => {
    const list = [];
    const xi = getLineupPlayers(club);
    for (const p of xi) {
      if (!p) continue;
      const st = ensureStats(p);
      const m = bag.get(p.id) || {
        goals: 0,
        assists: 0,
        saves: 0,
        yellow: 0,
        red: 0,
        wood: 0,
      };
      let r = 6.4;
      // 能力微调
      r += ((p.ovr || 12) - 12) * 0.04;
      // 体能/士气
      r += ((p.fitness || 80) - 75) * 0.008;
      r += ((p.morale || 70) - 70) * 0.006;

      if (p.pos === "GK") {
        r += m.saves * 0.22;
        if (ga === 0) r += 0.55;
        else r -= Math.min(1.4, ga * 0.28);
        r += m.goals * 0.8; // 门将进球极罕见
      } else {
        r += m.goals * 0.95;
        r += m.assists * 0.55;
        r += m.wood * 0.15;
        // 前场贡献封顶防刷分
        r = Math.min(r, 6.4 + 3.2);
      }

      r += m.yellow * -0.35;
      r += m.red * -1.6;
      if (won) r += 0.28;
      else if (drew) r += 0.05;
      else r -= 0.22;

      // 噪声
      r += (rng() - 0.5) * 0.45;
      r = clamp(Math.round(r * 10) / 10, 3.0, 10.0);

      // 场均/最近评分只累计联赛；杯赛仅写入本场报告
      if (!state.isCup) {
        st.ratingSum = (st.ratingSum || 0) + r;
        st.lastRating = r;
      }
      list.push({
        playerId: p.id,
        name: p.name,
        pos: p.pos,
        number: p.number,
        rating: r,
        goals: m.goals,
        assists: m.assists,
        saves: m.saves,
      });
    }
    list.sort((a, b) => b.rating - a.rating);
    return list;
  };

  const homeWon = hg > ag;
  const awayWon = ag > hg;
  const drew = hg === ag;
  const homeList = rateSide(home, hg, ag, homeWon, drew);
  const awayList = rateSide(away, ag, hg, awayWon, drew);

  let motm = null;
  const all = [
    ...homeList.map((x) => ({ ...x, teamId: home.id, side: "home" })),
    ...awayList.map((x) => ({ ...x, teamId: away.id, side: "away" })),
  ];
  if (all.length) {
    all.sort((a, b) => b.rating - a.rating);
    motm = all[0];
  }
  return { home: homeList, away: awayList, motm };
}

/**
 * 写入比分、积分、新闻、报告
 */
export function finalizeMatch(state) {
  if (state.finished) return state.report;
  const { world, fixture, home, away, isCup, hg, ag, events } = state;

  // 出场 / 零封 / 失球只计联赛（杯赛不进数据榜与赛季个人统计）
  if (!isCup) {
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
  }

  // 赛后评分（报告始终生成；ratingSum/lastRating 仅联赛写入）
  // 须先于 buildReport，以便 narrative 写入 MOTM
  const ratings = applyMatchRatings(state);
  state.matchRatings = ratings;

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

  // 纪律：黄牌累计 / 红牌停赛 / 停赛天数 -1（双方都处理）
  for (const club of [home, away]) {
    const { news: discNews } = processClubMatchDiscipline(club, events);
    for (const text of discNews) {
      if (club.id === world.userClubId) {
        world.news.unshift({ day: world.day, text });
      }
    }
  }

  // 用户场次新闻 / 收入 / 媒体
  const userId = world.userClubId;
  if (fixture.home === userId || fixture.away === userId) {
    const isHome = fixture.home === userId;
    const myG = isHome ? hg : ag;
    const opG = isHome ? ag : hg;
    const opp = isHome ? away : home;
    const me = isHome ? home : away;
    // 经理生涯场次（杯赛点球按晋级/出局的比分已在 hg/ag）
    try {
      ensureManagerCareer(world);
      let careerGf = myG;
      let careerGa = opG;
      if (isCup && fixture.penalties) {
        // 点球：按胜负记 W/L，比分仍用 90 分钟
        if (fixture.winner === userId) {
          if (myG <= opG) careerGf = opG + 1;
        } else if (myG >= opG) {
          careerGa = myG + 1;
        }
      }
      recordManagerMatch(world, careerGf, careerGa, isCup);
    } catch (_) {
      /* ignore */
    }
    let result = "战平";
    if (isCup) {
      const won = fixture.winner === userId;
      result = won ? (fixture.penalties ? "点球晋级" : "晋级") : fixture.penalties ? "点球出局" : "出局";
    } else {
      if (myG > opG) result = "获胜";
      else if (myG < opG) result = "落败";
    }
    const tag = isCup ? `🏆 ${fixture.roundLabel || "VCFM 杯"}` : `第 ${fixture.round} 轮`;
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
        outlet: "VCFM体育",
        headline: `${tag}：${me.name} ${myG}-${opG} ${opp.name}，${result}`,
        body: fixture.penalties
          ? "90 分钟难解难分，最终在点球大战中分出胜负。VCFM 杯永远充满戏剧性。"
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
            title: "VCFM 杯冠军",
            detail: champ.name,
            clubId: champ.id,
            clubName: champ.name,
            division: champ.division,
          });
        }
        if (champ.id === world.userClubId) {
          pushMedia(world, {
            outlet: "联赛日报",
            headline: `金杯！${champ.name} 问鼎 VCFM 杯`,
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
    midMatchCoachPrompt(state, minute);
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
  const evBefore = state.events.length;
  if (state.userSide && orders && (orders.style || orders.pressing != null || orders.tempo != null || (orders.subs && orders.subs.length))) {
    applyUserHalfTime(state, orders);
  }
  // 中场调整事件立刻走 onEvent（直播横幅/评论/换人动画），不要等完场再刷日志
  if (opts.onEvent) {
    const snap = liveSnap(state, 45);
    for (const ev of state.events.slice(evBefore)) {
      await opts.onEvent(ev, snap);
    }
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
        (p.suspendedMatches || 0) <= 0 &&
        !state.sentOff[sk].has(p.id)
    )
    .sort((a, b) => b.ovr - a.ovr);
}

export function getOnFieldPlayers(club, state) {
  return activeXi(state, club);
}

export { styleLabel };
