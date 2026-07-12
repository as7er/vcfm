/** 比赛模拟、联赛推进、转会 */

import {
  teamStrength,
  getLineupPlayers,
  autoLineup,
  playerOverall,
  estimateValue,
  estimateWage,
  formatMoney,
  ensureYouthAcademy,
  createYouthPlayer,
  fillYouthSquad,
  YOUTH_LEVELS,
  YOUTH_UPGRADE_COST,
  agePlayerOneYear,
  retireChance,
  resetSeasonStats,
  archiveAndResetSeasonStats,
  ensurePlayerHistory,
  generateFixtures,
  generateAllDivisionFixtures,
  clubsInDivision,
  createPlayer,
  DIVISIONS,
} from "./models.js";
import { STYLE_MOD, FORMATIONS, POS_LABEL } from "./data.js";
import {
  mediaAfterUserMatch,
  mediaTransfer,
  mediaYouthPromote,
  mediaPromotion,
  mediaDailyPulse,
  mediaSeasonKickoff,
  mediaSeasonAwards,
  ensureMedia,
} from "./media.js";
import {
  ensureStaff,
  coachMatchMod,
  coachGrowthBonus,
  scoutBuyMod,
  scoutSellMod,
  scoutYouthPotBonus,
  doctorInjuryMod,
  doctorHealBonus,
  staffWageBill,
  generateStaffMarket,
  hireStaff,
  fireStaff,
  ROLES,
} from "./staff.js";
import { runInternationalBreak, ensureIntl } from "./intl.js";
import { awardSeasonHonors, ensureHonors, grantHonor } from "./honors.js";
import {
  ensureContract,
  renewPlayer,
  renewOffer,
  processContractsEndOfSeason,
  releaseUnrenewed,
  signFreeAgent,
} from "./contracts.js";
import {
  ensureCup,
  createLeagueCup,
  cupFixturesOnDay,
  getNextUserCupMatch,
  allCupUserFixtures,
  advanceCupBracket,
  STAGE_LABEL,
} from "./cup.js";
import { pushMedia } from "./media.js";

function rng() {
  return Math.random();
}

function chance(p) {
  return rng() < p;
}

function clubById(world, id) {
  return world.clubs.find((c) => c.id === id);
}

function applyStyle(strength, tactics, side /* 'atk'|'def' */) {
  const mod = STYLE_MOD[tactics.style] || STYLE_MOD.balanced;
  const press = 1 + (tactics.pressing - 3) * 0.03;
  const tempo = 1 + (tactics.tempo - 3) * 0.025;
  if (side === "atk") return strength * mod.atk * tempo * (0.97 + press * 0.03);
  return strength * mod.def * press;
}

/** 生成 90 分钟事件流（联赛或杯赛；cup 不改积分榜） */
export function simulateMatch(world, fixture, { live = false } = {}) {
  const home = clubById(world, fixture.home);
  const away = clubById(world, fixture.away);
  if (!home || !away) throw new Error("invalid fixture clubs");

  autoLineup(home);
  autoLineup(away);
  const isCup = fixture.competition === "cup";

  ensureStaff(home);
  ensureStaff(away);

  let homeAtk = applyStyle(teamStrength(home), home.tactics, "atk");
  let homeDef = applyStyle(teamStrength(home), home.tactics, "def");
  let awayAtk = applyStyle(teamStrength(away), away.tactics, "atk");
  let awayDef = applyStyle(teamStrength(away), away.tactics, "def");

  // 教练影响
  const hCoach = coachMatchMod(home);
  const aCoach = coachMatchMod(away);
  homeAtk *= hCoach;
  homeDef *= hCoach;
  awayAtk *= aCoach;
  awayDef *= aCoach;

  // 主场优势
  homeAtk *= 1.06;
  homeDef *= 1.04;

  const events = [];
  let hg = 0;
  let ag = 0;

  const push = (minute, type, text, extra = {}) => {
    events.push({ minute, type, text, ...extra });
  };

  push(0, "kickoff", "比赛开始！");

  const homeXi = getLineupPlayers(home);
  const awayXi = getLineupPlayers(away);

  const ensureStats = (p) => {
    ensurePlayerHistory(p);
    return p.stats;
  };

  const weightedPick = (pool, weightFn) => {
    let total = 0;
    const weights = pool.map((p) => {
      const w = weightFn(p);
      total += w;
      return w;
    });
    let r = rng() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  };

  const pickScorer = (xi) => {
    const attackers = xi.filter((p) => p.pos === "ATT" || p.pos === "MID");
    const pool = attackers.length ? attackers : xi;
    return weightedPick(
      pool,
      (p) =>
        (p.attrs.finishing || p.attrs.shooting || 10) +
        (p.pos === "ATT" ? 6 : p.pos === "MID" ? 2 : 0) +
        rng() * 3
    );
  };

  const pickAssister = (xi, scorer) => {
    const pool = xi.filter((p) => p.id !== scorer.id && p.pos !== "GK");
    if (!pool.length || chance(0.28)) return null; // 约 28% 无助攻（个人能力进球）
    return weightedPick(
      pool,
      (p) =>
        (p.attrs.passing || 10) +
        (p.attrs.vision || 8) +
        (p.pos === "MID" ? 5 : p.pos === "ATT" ? 2 : 1) +
        rng() * 2
    );
  };

  // 期望进球
  const homeXG = Math.max(0.2, (homeAtk / Math.max(awayDef, 1)) * 1.15);
  const awayXG = Math.max(0.15, (awayAtk / Math.max(homeDef, 1)) * 1.0);

  for (let minute = 1; minute <= 90; minute++) {
    // 半场
    if (minute === 46) {
      push(45, "ht", `中场休息 ${hg} - ${ag}`);
    }

    // 每分钟尝试一次进攻（泊松近似）
    const homeChance = homeXG / 90;
    const awayChance = awayXG / 90;

    if (chance(homeChance * 1.8)) {
      // 有威胁
      if (chance(0.42 + homeAtk / (homeAtk + awayDef) * 0.2)) {
        const scorer = pickScorer(homeXi);
        const assister = pickAssister(homeXi, scorer);
        hg++;
        ensureStats(scorer).goals++;
        if (assister) ensureStats(assister).assists++;
        const assistText = assister ? `（助攻：${assister.name}）` : "";
        push(minute, "goal", `⚽ ${minute}' ${home.short} ${scorer.name} 破门！${assistText}`, {
          teamId: home.id,
          playerId: scorer.id,
          assistId: assister?.id || null,
        });
      } else if (chance(0.15)) {
        push(minute, "chance", `${minute}' ${home.short} 错失良机`);
      }
    }

    if (chance(awayChance * 1.8)) {
      if (chance(0.42 + awayAtk / (awayAtk + homeDef) * 0.2)) {
        const scorer = pickScorer(awayXi);
        const assister = pickAssister(awayXi, scorer);
        ag++;
        ensureStats(scorer).goals++;
        if (assister) ensureStats(assister).assists++;
        const assistText = assister ? `（助攻：${assister.name}）` : "";
        push(minute, "goal", `⚽ ${minute}' ${away.short} ${scorer.name} 破门！${assistText}`, {
          teamId: away.id,
          playerId: scorer.id,
          assistId: assister?.id || null,
        });
      } else if (chance(0.15)) {
        push(minute, "chance", `${minute}' ${away.short} 错失良机`);
      }
    }

    // 偶发黄牌
    if (chance(0.012)) {
      const side = chance(0.5) ? home : away;
      const xi = side === home ? homeXi : awayXi;
      const p = xi[Math.floor(rng() * xi.length)];
      if (p) push(minute, "card", `🟨 ${minute}' ${side.short} ${p.name} 吃到黄牌`);
    }
  }

  push(90, "ft", `全场结束 ${home.name} ${hg} - ${ag} ${away.name}`);

  fixture.homeGoals = hg;
  fixture.awayGoals = ag;
  fixture.played = true;
  fixture.events = events;

  // 出场 + 门将数据
  for (const p of homeXi) {
    ensureStats(p).apps++;
  }
  for (const p of awayXi) {
    ensureStats(p).apps++;
  }
  const homeGk = homeXi.find((p) => p.pos === "GK") || homeXi[0];
  const awayGk = awayXi.find((p) => p.pos === "GK") || awayXi[0];
  if (homeGk) {
    ensureStats(homeGk).goalsConceded += ag;
    if (ag === 0) ensureStats(homeGk).cleanSheets++;
  }
  if (awayGk) {
    ensureStats(awayGk).goalsConceded += hg;
    if (hg === 0) ensureStats(awayGk).cleanSheets++;
  }

  // 联赛更新积分榜；杯赛平局点球决胜
  if (!isCup) {
    applyResult(world, fixture);
  } else if (hg === ag) {
    // 杯赛淘汰：点球简化
    const penHome = chance(0.5);
    if (penHome) {
      fixture.homeGoals = hg;
      fixture.awayGoals = ag;
      fixture.winner = home.id;
      fixture.penalties = true;
      events.push({
        minute: 90,
        type: "ft",
        text: `点球大战！${home.name} 晋级（原 90 分钟 ${hg}-${ag}）`,
      });
    } else {
      fixture.winner = away.id;
      fixture.penalties = true;
      events.push({
        minute: 90,
        type: "ft",
        text: `点球大战！${away.name} 晋级（原 90 分钟 ${hg}-${ag}）`,
      });
    }
  } else {
    fixture.winner = hg > ag ? home.id : away.id;
  }

  // 体能/士气
  drainFitness(home, true);
  drainFitness(away, false);
  if (!isCup) {
    updateMorale(home, hg, ag, true);
    updateMorale(away, ag, hg, false);
  } else {
    // 杯赛晋级士气
    const winId = fixture.winner;
    for (const c of [home, away]) {
      const won = c.id === winId;
      for (const p of c.players) {
        p.morale = Math.max(20, Math.min(100, p.morale + (won ? 4 : -2)));
      }
    }
  }

  // 新闻 + 媒体（用户场次）
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
    world.news.unshift({
      day: world.day,
      text: `${tag}：对阵 ${opp.name} ${myG}-${opG} ${result}`,
    });
    if (!isCup) mediaAfterUserMatch(world, fixture, me, opp, myG, opG);
    else {
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
    // 决赛冠军荣誉
    if (world.cup?.stage === "done" && world.cup.champion) {
      const champ = clubById(world, world.cup.champion);
      if (champ) {
        for (const p of champ.players) {
          if ((p.stats?.apps || 0) >= 1 || true) {
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

  return { homeGoals: hg, awayGoals: ag, events };
}

function applyResult(world, f) {
  const ht = world.table[f.home];
  const at = world.table[f.away];
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

function drainFitness(club, isHome) {
  const injuryMod = doctorInjuryMod(club);
  for (const p of getLineupPlayers(club)) {
    const drain = 4 + Math.floor(rng() * 6) + (club.tactics.pressing > 3 ? 2 : 0);
    p.fitness = Math.max(35, p.fitness - drain);
    // 偶发受伤（队医降低概率）
    if (chance(0.02 * injuryMod)) {
      p.injured = 1 + Math.floor(rng() * 3);
      p.fitness = Math.min(p.fitness, 50);
    }
  }
  // 替补轻微恢复
  const xi = new Set(club.tactics.lineup);
  for (const p of club.players) {
    if (!xi.has(p.id)) {
      p.fitness = Math.min(100, p.fitness + 3);
      if (p.injured > 0) p.injured = Math.max(0, p.injured - 0); // 比赛日不减伤
    }
  }
}

function updateMorale(club, gf, ga, isHome) {
  let delta = 0;
  if (gf > ga) delta = 6;
  else if (gf < ga) delta = -5;
  else delta = 1;
  for (const p of club.players) {
    p.morale = Math.max(20, Math.min(100, p.morale + delta + Math.floor(rng() * 3 - 1)));
  }
}

const ATTR_KEYS = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "finishing", "tackling", "marking", "strength", "stamina", "vision",
  "reflexes", "handling", "positioning", "kicking",
];

function staffRatingSafe(club, role) {
  ensureStaff(club);
  return club.staff[role]?.rating || 8;
}

function growYouthPlayer(player, growthRate) {
  if (!player.potential) player.potential = Math.min(20, player.ovr + 3);
  if (player.ovr >= player.potential) return false;
  let grew = false;
  // 每周有机会涨 1 点某项属性
  if (chance(growthRate)) {
    const keys = ATTR_KEYS.filter((k) => (player.attrs[k] || 0) < 20);
    if (keys.length) {
      const k = keys[Math.floor(rng() * keys.length)];
      // 未达潜力时才涨
      const room = player.potential - player.ovr;
      if (room > 0 || player.attrs[k] < player.potential) {
        player.attrs[k] = Math.min(20, (player.attrs[k] || 1) + 1);
        grew = true;
      }
    }
  }
  if (grew) {
    player.ovr = playerOverall(player);
    player.value = estimateValue(player);
    player.wage = Math.max(200, Math.round(estimateWage(player) * 0.25));
  }
  return grew;
}

/** 青训日更：成长 / 招生 / 维护费 */
function processYouthDay(world) {
  for (const club of world.clubs) {
    const ya = ensureYouthAcademy(club);
    const cfg = YOUTH_LEVELS[ya.level] || YOUTH_LEVELS[1];
    ya.daysSinceIntake = (ya.daysSinceIntake || 0) + 1;

    // 每周成长 + 维护（教练加成）
    if (world.day % 7 === 0) {
      const growth = cfg.growth + coachGrowthBonus(club);
      for (const yp of ya.players) {
        growYouthPlayer(yp, growth);
      }
      for (const p of club.players) {
        if (p.fromYouth && p.age <= 22 && p.potential && p.ovr < p.potential && chance(growth * 0.35)) {
          growYouthPlayer(p, growth * 0.5);
          p.wage = estimateWage(p);
        }
      }
      club.money -= cfg.upkeep;
    }

    // 约每 30 天招生（球探提升潜力）
    if (ya.daysSinceIntake >= 30) {
      ya.daysSinceIntake = 0;
      const free = cfg.capacity - ya.players.length;
      const n = Math.min(cfg.intake, Math.max(0, free));
      const newcomers = [];
      const potBonus = scoutYouthPotBonus(club);
      for (let i = 0; i < n; i++) {
        const kid = createYouthPlayer(club);
        if (potBonus > 0) {
          kid.potential = Math.min(20, (kid.potential || kid.ovr) + potBonus);
        }
        ya.players.push(kid);
        newcomers.push(kid);
      }
      if (club.id === world.userClubId && newcomers.length) {
        const names = newcomers.map((p) => p.name).join("、");
        world.news.unshift({
          day: world.day,
          text: `🌱 青训招生：${names} 加入学院（潜力 ${newcomers.map((p) => p.potential).join("/")}）`,
        });
      }
      // AI：自动提拔过高潜力/释放低潜
      if (club.id !== world.userClubId) {
        aiManageYouth(world, club);
      }
    }
  }
}

function aiManageYouth(world, club) {
  const ya = ensureYouthAcademy(club);
  // 提拔高潜力
  const promote = ya.players.filter((p) => p.potential >= 15 || p.ovr >= 12);
  for (const p of promote.slice(0, 1)) {
    if (club.players.length >= 28) break;
    promoteYouth(world, club.id, p.id, { silent: true });
  }
  // 名单过满则释放最弱
  const cfg = YOUTH_LEVELS[ya.level] || YOUTH_LEVELS[1];
  while (ya.players.length > cfg.capacity) {
    ya.players.sort((a, b) => a.potential - b.potential || a.ovr - b.ovr);
    ya.players.shift();
  }
}

export function promoteYouth(world, clubId, playerId, { silent = false } = {}) {
  const club = clubById(world, clubId);
  if (!club) return { ok: false, msg: "球队不存在" };
  const ya = ensureYouthAcademy(club);
  const idx = ya.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return { ok: false, msg: "青训球员不存在" };
  if (club.players.length >= 28) return { ok: false, msg: "一线队已满（最多 28 人）" };

  const [player] = ya.players.splice(idx, 1);
  player.clubId = club.id;
  player.fromYouth = true;
  player.morale = Math.min(100, (player.morale || 70) + 10);
  player.wage = estimateWage(player);
  player.value = estimateValue(player);
  ensurePlayerHistory(player);
  club.players.push(player);
  autoLineup(club);

  if (!silent && clubId === world.userClubId) {
    world.news.unshift({
      day: world.day,
      text: `🌟 青训提拔：${player.name}（${POS_LABEL[player.pos]}）升入一线队，能力 ${player.ovr} / 潜力 ${player.potential}`,
    });
    mediaYouthPromote(world, club.name, player.name, player.ovr, player.potential);
  }
  return {
    ok: true,
    msg: `已提拔 ${player.name} 至一线队（能力 ${player.ovr}，潜力 ${player.potential}）`,
    player,
  };
}

export function releaseYouth(world, clubId, playerId) {
  const club = clubById(world, clubId);
  if (!club) return { ok: false, msg: "球队不存在" };
  const ya = ensureYouthAcademy(club);
  const idx = ya.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return { ok: false, msg: "青训球员不存在" };
  const [player] = ya.players.splice(idx, 1);
  if (clubId === world.userClubId) {
    world.news.unshift({
      day: world.day,
      text: `青训：已与 ${player.name} 解约`,
    });
  }
  return { ok: true, msg: `已释放 ${player.name}` };
}

export function upgradeYouthAcademy(world, clubId) {
  const club = clubById(world, clubId);
  if (!club) return { ok: false, msg: "球队不存在" };
  const ya = ensureYouthAcademy(club);
  if (ya.level >= 5) return { ok: false, msg: "青训已达最高等级" };
  const next = ya.level + 1;
  const cost = YOUTH_UPGRADE_COST[next];
  if (club.money < cost) return { ok: false, msg: `资金不足，需要 ${formatMoney(cost)}` };
  club.money -= cost;
  ya.level = next;
  fillYouthSquad(club, Math.min(ya.players.length + 1, YOUTH_LEVELS[next].capacity));
  world.news.unshift({
    day: world.day,
    text: `🏗️ 青训设施升级至 Lv.${next} ${YOUTH_LEVELS[next].name}，花费 ${formatMoney(cost)}`,
  });
  return { ok: true, msg: `青训已升级至 Lv.${next}（${YOUTH_LEVELS[next].name}）` };
}

/** 推进一天：恢复、AI 比赛、工资 */
export function advanceDay(world) {
  world.day += 1;

  // 恢复（队医加成）
  for (const club of world.clubs) {
    ensureStaff(club);
    const heal = 5 + doctorHealBonus(club);
    for (const p of club.players) {
      p.fitness = Math.min(100, p.fitness + heal + Math.floor(rng() * 4));
      if (p.injured > 0) {
        // 队医加速伤愈
        const extra = staffRatingSafe(club, "doctor") >= 14 && chance(0.25) ? 1 : 0;
        p.injured = Math.max(0, p.injured - 1 - extra);
      }
    }
  }

  // 青训
  processYouthDay(world);

  // 国际比赛日（约每 30 天）
  if (!world.lastIntlDay) world.lastIntlDay = 0;
  if (world.day - world.lastIntlDay >= 30 && !world.seasonOver) {
    runInternationalBreak(world);
  }

  ensureCup(world);

  // 今天的比赛：联赛 + 联赛杯（非用户场次自动踢完）
  const todayLeague = world.fixtures.filter((f) => f.day === world.day && !f.played);
  const todayCup = cupFixturesOnDay(world, world.day);
  const today = [...todayLeague, ...todayCup];
  const userMatches = [];
  for (const f of today) {
    const isUser = f.home === world.userClubId || f.away === world.userClubId;
    if (isUser) {
      userMatches.push(f);
    } else {
      simulateMatch(world, f);
    }
  }

  // 媒体日常脉搏
  const userClub = clubById(world, world.userClubId);
  if (userClub && !world.seasonOver) mediaDailyPulse(world, userClub);

  // 每周发工资（每 7 天）
  if (world.day % 7 === 0) {
    const user = clubById(world, world.userClubId);
    ensureStaff(user);
    const wageBill = user.players.reduce((s, p) => s + p.wage, 0);
    const youthWage = (user.youth?.players || []).reduce((s, p) => s + (p.wage || 0), 0);
    const staffWage = staffWageBill(user);
    const total = wageBill + youthWage + staffWage;
    user.money -= total;
    world.news.unshift({
      day: world.day,
      text: `发放周薪 ${formatMoney(total)}（一线 ${formatMoney(wageBill)} + 青训 ${formatMoney(youthWage)} + 职员 ${formatMoney(staffWage)}），资金 ${formatMoney(user.money)}`,
    });
  }

  // 赛季结束：只处理一次（年龄 / 下滑 / 退役）
  const allPlayed = world.fixtures.length > 0 && world.fixtures.every((f) => f.played);
  if (allPlayed && !world.seasonOver) {
    finishSeason(world);
  }

  // 极简 AI 转会（休赛日也跑；低频，避免刷屏）
  if (!world.seasonOver) {
    processAiTransfers(world);
  }

  return { userMatches };
}

/**
 * 赛季末：排名新闻 + 全员年龄+1 + 高龄下滑 + 退役
 * 不会自动开新赛季，需调用 startNextSeason
 */
export function finishSeason(world) {
  if (world.seasonOver) return { retired: [] };

  // 个人荣誉（用本赛季 stats，在归档/升降级前）
  awardSeasonHonors(world);

  // 合同年限 -1 / 到期
  processContractsEndOfSeason(world);

  // 先算本级排名与升降级（在年龄变化前，用本赛季积分）
  const promoNews = applyPromotionRelegation(world);

  const userClub = getUserClub(world);
  const userDivForAward = world._lastUserDiv || userClub.division || 3;
  const pos = world._lastUserPos > 0 ? world._lastUserPos : 1;
  const divName = DIVISIONS[userDivForAward]?.name || `第${userDivForAward}级`;
  world.news.unshift({
    day: world.day,
    text: `🏆 ${world.season} 赛季结束！${userClub.name} 在${divName}排名第 ${pos} 名。可进入下一赛季。`,
  });
  mediaSeasonAwards(world, userClub, pos, divName);
  for (const t of promoNews) {
    world.news.unshift({ day: world.day, text: t });
  }
  delete world._lastUserDiv;
  delete world._lastUserPos;

  const retiredUser = [];
  const declinedUser = [];
  if (!Array.isArray(world.retiredPlayers)) world.retiredPlayers = [];

  for (const club of world.clubs) {
    const ya = ensureYouthAcademy(club);

    // 一线队
    const kept = [];
    for (const p of club.players) {
      // 退役前先归档本赛季，保留生涯/分赛季历史
      const declined = agePlayerOneYear(p);
      if (declined && club.id === world.userClubId) declinedUser.push(p.name);
      const rc = retireChance(p.age);
      if (rc > 0 && chance(rc)) {
        archiveAndResetSeasonStats(p, world.season, club.id, club.name);
        world.retiredPlayers.unshift({
          ...JSON.parse(JSON.stringify(p)),
          retiredSeason: world.season,
          lastClubId: club.id,
          lastClubName: club.name,
        });
        if (world.retiredPlayers.length > 80) world.retiredPlayers.length = 80;
        if (club.id === world.userClubId) retiredUser.push({ name: p.name, age: p.age });
        continue;
      }
      kept.push(p);
    }
    club.players = kept;

    // 青训
    const yKept = [];
    for (const p of ya.players) {
      agePlayerOneYear(p);
      // 青训一般不退役；满 20 岁仍在青训则强制释放或提拔潜力高的
      if (p.age >= 20) {
        if (p.potential >= 14 && club.players.length < 28) {
          p.fromYouth = true;
          p.wage = estimateWage(p);
          ensurePlayerHistory(p);
          club.players.push(p);
          if (club.id === world.userClubId) {
            world.news.unshift({
              day: world.day,
              text: `🌱 ${p.name} 已超龄，自动升入一线队（能力 ${p.ovr} / 潜力 ${p.potential}）`,
            });
          }
        } else {
          // 离开学院前归档
          archiveAndResetSeasonStats(p, world.season, club.id, club.name);
        }
        continue;
      }
      yKept.push(p);
    }
    ya.players = yKept;

    // 阵容过少则补人
    while (club.players.length < 16) {
      const posPick = ["GK", "DEF", "MID", "ATT"][Math.floor(rng() * 4)];
      // 保证至少 1 门将
      const needGk = !club.players.some((p) => p.pos === "GK");
      club.players.push(
        createPlayer(needGk ? "GK" : posPick, club.power - 5 + Math.floor(rng() * 8), club.id)
      );
    }
    fillYouthSquad(club);
    autoLineup(club);
    club.form = [];
  }

  if (retiredUser.length) {
    world.news.unshift({
      day: world.day,
      text: `👋 退役：${retiredUser.map((r) => `${r.name}（${r.age}岁）`).join("、")}`,
    });
  }
  if (declinedUser.length) {
    const sample = declinedUser.slice(0, 5).join("、");
    const more = declinedUser.length > 5 ? ` 等 ${declinedUser.length} 人` : "";
    world.news.unshift({
      day: world.day,
      text: `📉 高龄状态下滑：${sample}${more}`,
    });
  }

  world.seasonOver = true;
  return { retired: retiredUser };
}

/** 开启下一赛季：归档个人赛季数据 → 重置积分榜、赛程 */
export function startNextSeason(world) {
  if (!world.seasonOver && world.fixtures.some((f) => !f.played)) {
    return { ok: false, msg: "本赛季尚未结束" };
  }

  // 若尚未做过赛季末处理（年龄/退役）
  if (!world.seasonOver) finishSeason(world);

  const endedSeason = world.season;

  // 归档本赛季个人数据到 history + career（在赛季号 +1 之前）
  for (const c of world.clubs) {
    for (const p of c.players) {
      archiveAndResetSeasonStats(p, endedSeason, c.id, c.name);
    }
    const ya = ensureYouthAcademy(c);
    for (const p of ya.players) {
      archiveAndResetSeasonStats(p, endedSeason, c.id, c.name);
    }
    ya.daysSinceIntake = 0;
  }

  // 未续约球员离队
  releaseUnrenewed(world);

  world.season += 1;
  world.day = 1;
  world.seasonOver = false;

  for (const c of world.clubs) {
    world.table[c.id] = { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    if (!c.division) c.division = 3;
    for (const p of c.players) ensureContract(p);
    autoLineup(c);
  }

  world.fixtures = generateAllDivisionFixtures(world.clubs);
  world.cup = createLeagueCup(world);
  const user = getUserClub(world);
  const divName = DIVISIONS[user.division]?.name || "";
  world.news.unshift({
    day: 1,
    text: `📅 ${world.season} 赛季开始！${user.name} 征战${divName}。联赛 + VC联赛杯赛程已生成。`,
  });
  mediaSeasonKickoff(world, user, divName);

  return { ok: true, msg: `${world.season} 赛季 · ${divName} 已开始` };
}

export function renewUserPlayer(world, playerId) {
  const club = getUserClub(world);
  const p = club.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, msg: "球员不在阵中" };
  const res = renewPlayer(club, p);
  if (res.ok) {
    p._needsRenew = false;
    world.news.unshift({ day: world.day, text: `📝 ${res.msg}` });
  }
  return res;
}

export function getNextPlayableMatch(world) {
  // 优先当天可踢的用户联赛/杯赛
  const league = world.fixtures.find(
    (f) =>
      !f.played &&
      f.day <= world.day &&
      (f.home === world.userClubId || f.away === world.userClubId)
  );
  const cup = getNextUserCupMatch(world);
  if (league && cup) {
    if (league.day === world.day && cup.day === world.day) {
      // 同日：先联赛后杯？按 day 相同则杯赛也要踢——返回数组由 UI 处理
      return league.day <= cup.day ? league : cup;
    }
    if (league.day <= world.day && league.day <= (cup.day || 999)) return league;
    if (cup.day <= world.day) return cup;
  }
  if (league && league.day <= world.day) return league;
  if (cup && cup.day <= world.day) return cup;
  // 下一场未踢（可能未到日）
  const nextLeague = getNextUserMatch(world);
  if (nextLeague && cup) {
    return nextLeague.day <= cup.day ? nextLeague : cup;
  }
  return nextLeague || cup || null;
}

export {
  ensureCup,
  getNextUserCupMatch,
  allCupUserFixtures,
  renewOffer,
  ensureContract,
  signFreeAgent,
  createLeagueCup,
};

/**
 * 升降级（每级 20 队）：
 * - 超联(1)：后 3 名降甲级
 * - 甲级(2)：前 3 升超联，后 3 降乙级
 * - 乙级(3)：前 3 升甲级
 */
export function applyPromotionRelegation(world) {
  const news = [];
  const sortDiv = (d) => getSortedTable(world, d);

  const d1 = sortDiv(1);
  const d2 = sortDiv(2);
  const d3 = sortDiv(3);

  const nUp = 3;
  const nDown = 3;

  if (d1.length < nDown + 2 || d2.length < nUp + nDown || d3.length < nUp) {
    return news;
  }

  const clubMap = new Map(world.clubs.map((c) => [c.id, c]));
  const setDiv = (id, div) => {
    const c = clubMap.get(id);
    if (c) c.division = div;
  };

  const upFrom3 = d3.slice(0, nUp).map((r) => r.id);
  const downFrom2 = d2.slice(-nDown).map((r) => r.id);
  const upFrom2 = d2
    .filter((r) => !downFrom2.includes(r.id))
    .slice(0, nUp)
    .map((r) => r.id);
  const downFrom1 = d1.slice(-nDown).map((r) => r.id);

  // 记录用户升降前级别与排名（供赛季总结）
  const user = getUserClub(world);
  const userDivBefore = user.division || 3;
  const ranked = sortDiv(userDivBefore);
  world._lastUserDiv = userDivBefore;
  world._lastUserPos = ranked.findIndex((r) => r.id === user.id) + 1;

  for (const id of upFrom3) setDiv(id, 2);
  for (const id of downFrom2) setDiv(id, 3);
  for (const id of upFrom2) setDiv(id, 1);
  for (const id of downFrom1) setDiv(id, 2);

  const nameOf = (id) => clubMap.get(id)?.name || id;
  const list = (ids) => ids.map(nameOf).join("、");

  if (upFrom3.length) news.push(`⬆️ 乙级升级：${list(upFrom3)} → 甲级联赛`);
  if (downFrom2.length) news.push(`⬇️ 甲级降级：${list(downFrom2)} → 乙级联赛`);
  if (upFrom2.length) news.push(`⬆️ 甲级升级：${list(upFrom2)} → 超级联赛`);
  if (downFrom1.length) news.push(`⬇️ 超联降级：${list(downFrom1)} → 甲级联赛`);

  if (upFrom3.includes(user.id) || upFrom2.includes(user.id)) {
    news.push(`🎉 恭喜！${user.name} 成功升级至${DIVISIONS[user.division]?.name}！`);
  }
  if (downFrom2.includes(user.id) || downFrom1.includes(user.id)) {
    news.push(`😢 ${user.name} 不幸降级至${DIVISIONS[user.division]?.name}。`);
  }

  // 媒体通稿（用户相关）
  if (upFrom3.includes(user.id) || upFrom2.includes(user.id)) {
    mediaPromotion(
      world,
      user.name,
      DIVISIONS[userDivBefore]?.name || "",
      DIVISIONS[user.division]?.name || "",
      true
    );
  } else if (downFrom2.includes(user.id) || downFrom1.includes(user.id)) {
    mediaPromotion(
      world,
      user.name,
      DIVISIONS[userDivBefore]?.name || "",
      DIVISIONS[user.division]?.name || "",
      false
    );
  }

  return news;
}

/** @param division 不传则全联盟；传 1/2/3 则仅该级 */
export function getSortedTable(world, division = null) {
  let clubs = world.clubs;
  if (division != null) {
    clubs = clubsInDivision(world.clubs, division);
  }
  return clubs
    .map((c) => {
      const t = world.table[c.id] || { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
      return {
        id: c.id,
        name: c.name,
        division: c.division || 3,
        ...t,
        gd: t.gf - t.ga,
      };
    })
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}

export function getUserClub(world) {
  return clubById(world, world.userClubId);
}

export function getNextUserMatch(world) {
  // 联赛 + 杯赛里用户下场最早的未赛
  const league = world.fixtures
    .filter(
      (f) =>
        !f.played &&
        (f.home === world.userClubId || f.away === world.userClubId)
    )
    .sort((a, b) => a.day - b.day || (a.round || 0) - (b.round || 0));
  const cup = getNextUserCupMatch(world);
  if (league[0] && cup) return league[0].day <= cup.day ? league[0] : cup;
  return league[0] || cup || null;
}

/** 下一场用户比赛的日期（联赛/杯）；无则 null */
export function nextUserMatchDay(world) {
  const m = getNextUserMatch(world);
  return m ? m.day : null;
}

/**
 * 连续推进到下一场用户比赛日（或赛季结束）。
 * 若当天已有可踢比赛，不推进，返回 stopped 提示。
 */
export function advanceToNextMatchDay(world, maxDays = 60) {
  if (world.seasonOver) {
    return { ok: false, msg: "赛季已结束", days: 0, userMatches: [] };
  }
  const ready = getNextPlayableMatch(world);
  if (ready && ready.day <= world.day && !ready.played) {
    return {
      ok: false,
      msg: "今天有比赛，请先进入比赛！",
      days: 0,
      userMatches: [ready],
      pendingMatch: ready,
    };
  }

  let days = 0;
  let last = { userMatches: [] };
  while (days < maxDays && !world.seasonOver) {
    const target = nextUserMatchDay(world);
    if (target != null && world.day >= target) {
      const m = getNextPlayableMatch(world) || getNextUserMatch(world);
      return {
        ok: true,
        days,
        userMatches: m ? [m] : [],
        pendingMatch: m,
        msg: m ? 比赛日到了（推进  天） : 已推进  天,
      };
    }
    last = advanceDay(world);
    days += 1;
    if (last.userMatches && last.userMatches.length) {
      return {
        ok: true,
        days,
        userMatches: last.userMatches,
        pendingMatch: last.userMatches[0],
        msg: 推进  天，比赛日到了,
      };
    }
    if (world.seasonOver) {
      return {
        ok: true,
        days,
        userMatches: [],
        msg: 推进  天，赛季结束,
      };
    }
  }
  return {
    ok: true,
    days,
    userMatches: last.userMatches || [],
    msg: 已推进  天,
  };
}

function posCount(players, pos) {
  return players.filter((p) => p.pos === pos).length;
}

/** 队与队之间转会 */
function transferBetween(world, buyer, seller, player) {
  const idx = seller.players.findIndex((p) => p.id === player.id);
  if (idx < 0) return { ok: false, msg: "球员不存在" };
  if (seller.players.length <= 14) return { ok: false, msg: "卖方阵容过少" };
  if (buyer.players.length >= 28) return { ok: false, msg: "买方阵容已满" };
  const price = Math.round((player.value || estimateValue(player)) * (0.9 + rng() * 0.2));
  if (buyer.money < price) return { ok: false, msg: "资金不足" };

  buyer.money -= price;
  seller.money += price;
  seller.players.splice(idx, 1);
  player.clubId = buyer.id;
  player.morale = Math.min(100, (player.morale || 70) + 5);
  buyer.players.push(player);
  autoLineup(buyer);
  autoLineup(seller);
  return { ok: true, price, player };
}

/**
 * 极简 AI 转会：约每 3 天抽几支非用户队补短板 / 甩卖。
 * 可能从用户队挖人（你队人数>16 时）。
 */
export function processAiTransfers(world) {
  if (world.seasonOver) return [];
  if (world.day % 3 !== 0) return [];

  const moves = [];
  const clubs = world.clubs.filter((c) => c.id !== world.userClubId);
  const shuffled = clubs.slice().sort(() => rng() - 0.5);
  let budgetMoves = 4;

  for (const club of shuffled) {
    if (budgetMoves <= 0) break;
    ensureStaff(club);
    if (club.players.length < 14) continue;

    // 资金紧张或人太多：卖最弱
    if (club.money < 200000 || club.players.length >= 26) {
      const sellable = club.players
        .slice()
        .sort((a, b) => (a.ovr || 0) - (b.ovr || 0) || (b.age || 0) - (a.age || 0));
      const victim = sellable[0];
      if (victim && club.players.length > 15) {
        const buyers = world.clubs.filter(
          (c) =>
            c.id !== club.id &&
            c.players.length < 27 &&
            c.money > (victim.value || 0) * 0.85
        );
        if (buyers.length) {
          const buyer = buyers[Math.floor(rng() * buyers.length)];
          const res = transferBetween(world, buyer, club, victim);
          if (res.ok) {
            moves.push(res);
            budgetMoves -= 1;
            const involvesUser =
              buyer.id === world.userClubId || club.id === world.userClubId;
            if (involvesUser) {
              world.news.unshift({
                day: world.day,
                text: 🔄  从  签下 ，,
              });
              mediaTransfer(world, {
                type: club.id === world.userClubId ? "sell" : "buy",
                playerName: victim.name,
                clubName: buyer.name,
                otherName: club.name,
                feeText: formatMoney(res.price),
              });
            } else if (chance(0.3)) {
              world.news.unshift({
                day: world.day,
                text: 🔄  签下 （来自 ）,
              });
            }
            continue;
          }
        }
      }
    }

    // 补短板
    const needPos = ["GK", "DEF", "MID", "ATT"].find((pos) => {
      const n = posCount(club.players, pos);
      if (pos === "GK") return n < 2;
      return n < 4;
    });
    if (!needPos || club.money < 150000 || club.players.length >= 27) continue;

    const candidates = [];
    for (const other of world.clubs) {
      if (other.id === club.id) continue;
      if (other.id === world.userClubId && other.players.length <= 16) continue;
      for (const p of other.players) {
        if (p.pos !== needPos) continue;
        if (other.players.length <= 14) continue;
        if (p.pos === "GK" && posCount(other.players, "GK") <= 1) continue;
        const price = (p.value || estimateValue(p)) * 0.95;
        if (price > club.money) continue;
        candidates.push({
          player: p,
          club: other,
          score: (p.ovr || 0) - price / 1000000,
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const pick = candidates[0];
    if (!pick) continue;
    if (pick.club.id === world.userClubId && !chance(0.4)) continue;

    const res = transferBetween(world, club, pick.club, pick.player);
    if (res.ok) {
      moves.push(res);
      budgetMoves -= 1;
      if (pick.club.id === world.userClubId) {
        world.news.unshift({
          day: world.day,
          text: ⚠️  挖走了你的 ！转会费 ,
        });
        mediaTransfer(world, {
          type: "sell",
          playerName: pick.player.name,
          clubName: club.name,
          otherName: pick.club.name,
          feeText: formatMoney(res.price),
        });
      } else if (chance(0.25)) {
        world.news.unshift({
          day: world.day,
          text: 🔄  补强 ：签下 ,
        });
      }
    }
  }
  return moves;
}

export function buyPlayer(world, playerId, fromClubId) {
  const user = getUserClub(world);
  const from = clubById(world, fromClubId);
  if (!from || from.id === user.id) return { ok: false, msg: "无效的卖家" };
  const idx = from.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return { ok: false, msg: "球员不存在" };
  const player = from.players[idx];
  ensureStaff(user);
  const price = Math.round(player.value * (1.05 + rng() * 0.15) * scoutBuyMod(user));
  if (user.money < price) return { ok: false, msg: `资金不足，需要 ${formatMoney(price)}` };
  if (user.players.length >= 28) return { ok: false, msg: "阵容已满（最多 28 人）" };
  if (from.players.length <= 14) return { ok: false, msg: "对方拒绝出售（阵容过少）" };

  user.money -= price;
  from.money += price;
  from.players.splice(idx, 1);
  player.clubId = user.id;
  player.morale = Math.min(100, player.morale + 8);
  user.players.push(player);
  autoLineup(from);
  autoLineup(user);

  world.news.unshift({
    day: world.day,
    text: `✍️ 转会：签下 ${player.name}（${POS_LABEL[player.pos]}），转会费 ${formatMoney(price)}`,
  });
  mediaTransfer(world, {
    type: "buy",
    playerName: player.name,
    clubName: user.name,
    otherName: from.name,
    feeText: formatMoney(price),
  });
  return { ok: true, msg: `成功签下 ${player.name}，花费 ${formatMoney(price)}` };
}

export function sellPlayer(world, playerId) {
  const user = getUserClub(world);
  const idx = user.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return { ok: false, msg: "球员不在阵中" };
  if (user.players.length <= 14) return { ok: false, msg: "阵容过少，无法再出售" };
  const player = user.players[idx];
  // 随机买家
  const buyers = world.clubs.filter((c) => c.id !== user.id && c.players.length < 26);
  if (!buyers.length) return { ok: false, msg: "暂无买家" };
  const buyer = buyers[Math.floor(rng() * buyers.length)];
  ensureStaff(user);
  const price = Math.round(player.value * (0.85 + rng() * 0.2) * scoutSellMod(user));
  if (buyer.money < price * 0.5) {
    // 仍允许低价
  }
  user.players.splice(idx, 1);
  user.money += price;
  player.clubId = buyer.id;
  buyer.players.push(player);
  buyer.money = Math.max(0, buyer.money - price);
  autoLineup(user);
  autoLineup(buyer);

  world.news.unshift({
    day: world.day,
    text: `📤 售出 ${player.name} 至 ${buyer.name}，收入 ${formatMoney(price)}`,
  });
  mediaTransfer(world, {
    type: "sell",
    playerName: player.name,
    clubName: user.name,
    otherName: buyer.name,
    feeText: formatMoney(price),
  });
  return { ok: true, msg: `售出 ${player.name}，收入 ${formatMoney(price)}` };
}

/** 球员列表（带球队信息）；division 限制同级 */
export function allPlayersWithClub(world, division = null) {
  const list = [];
  for (const club of world.clubs) {
    if (division != null && (club.division || 3) !== division) continue;
    for (const p of club.players) {
      ensurePlayerHistory(p);
      list.push({ player: p, club });
    }
  }
  return list;
}

/** 射手榜 / 助攻榜 / 门将榜（默认本级联赛） */
export function getStatLeaders(world, division = null) {
  const user = getUserClub(world);
  const div = division != null ? division : user?.division || 3;
  const all = allPlayersWithClub(world, div);

  const goals = [...all]
    .filter((x) => x.player.stats.goals > 0)
    .sort(
      (a, b) =>
        b.player.stats.goals - a.player.stats.goals ||
        b.player.stats.assists - a.player.stats.assists ||
        b.player.ovr - a.player.ovr
    )
    .slice(0, 20);

  const assists = [...all]
    .filter((x) => x.player.stats.assists > 0)
    .sort(
      (a, b) =>
        b.player.stats.assists - a.player.stats.assists ||
        b.player.stats.goals - a.player.stats.goals ||
        b.player.ovr - a.player.ovr
    )
    .slice(0, 20);

  // 门将：至少出场 1 次；优先零封，再看出场，再看失球少
  const keepers = all
    .filter((x) => x.player.pos === "GK" && x.player.stats.apps > 0)
    .map((x) => {
      const s = x.player.stats;
      const gaPerGame = s.apps ? s.goalsConceded / s.apps : 99;
      return { ...x, gaPerGame };
    })
    .sort(
      (a, b) =>
        b.player.stats.cleanSheets - a.player.stats.cleanSheets ||
        a.gaPerGame - b.gaPerGame ||
        b.player.stats.apps - a.player.stats.apps
    )
    .slice(0, 15);

  return { goals, assists, keepers };
}

export function refreshStaffMarket(world) {
  world.staffMarket = generateStaffMarket(12);
  return world.staffMarket;
}

export function hireStaffForUser(world, candidateId) {
  const user = getUserClub(world);
  ensureStaff(user);
  if (!Array.isArray(world.staffMarket)) refreshStaffMarket(world);
  const cand = world.staffMarket.find((s) => s.id === candidateId);
  if (!cand) return { ok: false, msg: "候选人不存在，请刷新市场" };
  const fee = Math.round(cand.rating * cand.rating * 8000);
  const res = hireStaff(world, user, cand, fee);
  if (res.ok) {
    world.news.unshift({
      day: world.day,
      text: `👔 职员：聘请 ${cand.name} 担任${ROLES[cand.role].label}（${cand.rating}），签约费 ${formatMoney(fee)}`,
    });
  }
  return res;
}

export function fireStaffForUser(world, role) {
  const user = getUserClub(world);
  const res = fireStaff(user, role);
  if (res.ok) {
    world.news.unshift({
      day: world.day,
      text: `👔 ${res.msg}`,
    });
  }
  return res;
}

export { ensureStaff, ROLES, ensureIntl, ensureHonors };

export function getMarketPlayers(world, posFilter = "") {
  const user = getUserClub(world);
  const list = [];
  for (const club of world.clubs) {
    if (club.id === user.id) continue;
    for (const p of club.players) {
      if (posFilter && p.pos !== posFilter) continue;
      // 只挂牌部分球员：非绝对主力
      list.push({ player: p, club });
    }
  }
  list.sort((a, b) => b.player.ovr - a.player.ovr);
  return list.slice(0, 40);
}

/** 直播模拟：逐步回调 */
export async function simulateMatchLive(world, fixture, onEvent, delayMs = 80) {
  // 重新模拟但用逐步方式——先跑完整模拟再回放 events
  // 为了可中断显示，先清空并实时版：
  const home = clubById(world, fixture.home);
  const away = clubById(world, fixture.away);
  autoLineup(home);
  autoLineup(away);

  // 使用完整模拟拿结果，然后回放（保证与快速模拟算法一致）
  // 但 simulateMatch 会直接写结果——所以 live 路径自己实现回放前不调用 apply

  // 简化：调用 simulate 但先备份 table——不优雅。直接 simulate 后回放 events。
  const result = simulateMatch(world, fixture);
  // 回放时比分动画
  let hg = 0;
  let ag = 0;
  // 撤销已经 apply 的比分显示用 events 重放
  for (const ev of result.events) {
    if (ev.type === "goal") {
      if (ev.teamId === fixture.home) hg++;
      else ag++;
    }
    await onEvent(ev, { homeGoals: hg, awayGoals: ag });
    await sleep(delayMs);
  }
  return result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export { FORMATIONS, formatMoney, playerOverall, estimateValue };
