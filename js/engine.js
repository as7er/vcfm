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
  agePlayerOneYear,
  retireChance,
  resetSeasonStats,
  archiveAndResetSeasonStats,
  archiveClubSeasonStats,
  ensurePlayerHistory,
  ensureLeagueStats,
  generateFixtures,
  generateAllDivisionFixtures,
  clubsInDivision,
  createPlayer,
  DIVISIONS,
  ensureKit,
  assignSquadNumbers,
  registerSquadNumbers,
  ensurePlayerNumber,
  ensureWorldClubTemplates,
} from "./models.js";
import { STYLE_MOD, FORMATIONS, POS_LABEL } from "./data.js";
import { assertWorldInvariantsWhenEnabled } from "./world-invariants.js";
import { positionGroup, positionRating } from "./player-positions.js";
import { weightedDevelopmentAttributes } from "./player-attributes.js";
import { processInjuryRecoveryDay } from "./injuries.js";
import {
  archiveDevelopmentSeason,
  processDevelopmentMatchesForDay,
} from "./development-football.js";
import { developmentGrowthMultiplier } from "./player-pathway.js";
import {
  mediaAfterUserMatch,
  mediaTransfer,
  mediaYouthPromote,
  mediaPromotion,
  mediaDailyPulse,
  mediaSeasonKickoff,
  mediaSeasonAwards,
  ensureMedia,
  narrativeAfterUserMatch,
  narrativeTablePulse,
  narrativeInjuryWave,
} from "./media.js";
import {
  ensureStaff,
  ensureWorldStaff,
  coachMatchMod,
  coachGrowthBonus,
  scoutBuyMod,
  scoutSellMod,
  scoutYouthPotBonus,
  doctorInjuryMod,
  doctorHealBonus,
  generateStaffMarket,
  refreshStaffMarket,
  hireStaff,
  fireStaff,
  approachStaff,
  resolveStaffApproach,
  processStaffMarketDay,
  processManagerEcosystemDay,
  processManagerEcosystemSeasonEnd,
  processStaffContractsEndOfSeason,
  ensureStaffApproaches,
  pendingStaffApproaches,
  listApproachableStaff,
  staffCompensationFee,
  staffSigningFee,
  staffTargetRating,
  ROLES,
} from "./staff.js";
import { runInternationalBreak, ensureIntl } from "./intl.js";
import { awardSeasonHonors, ensureHonors, grantHonor } from "./honors.js";
import {
  ensureContract,
  renewOffer,
  terminatePlayer,
  terminateCost,
  needsContractAttention,
  processContractsEndOfSeason,
  releaseUnrenewed,
  signFreeAgent,
} from "./contracts.js";
import {
  ensureLoans,
  recallLoan,
  returnLoan,
  processLoansDay,
  returnAllLoans,
  listUserLoans,
  userSquadWageBill,
  previewLoanOut,
  previewLoanIn,
  isOnLoan,
  arrangeAiLoan,
} from "./loans.js";
import {
  ensureCompetitions,
  resetCompetitions,
  competitionFixturesOnDay,
  getNextUserCompetitionMatch,
  allUserCompetitionFixtures,
  allCompetitionFixtures,
  competitionsComplete,
  buildContinentalQualifiers,
} from "./cup.js";
import { pushMedia } from "./media.js";
import {
  ensureBoardObjective,
  ensureClubSeasonPlan,
  ensureWorldSeasonPlans,
  evaluateBoardProgress,
  checkBoardMidSeason,
  settleBoardObjective,
  sackManager,
} from "./board.js";
import {
  ensureTraining,
  setTraining,
  processTrainingDay,
  trainingSummary,
  assistantTrainingPlan,
  youthTrainingMult,
  TRAINING_FOCUSES,
  TRAINING_INTENSITIES,
} from "./training.js";
import {
  applyDelegatedDevelopment,
  applyDelegatedTraining,
  ensureWorldDelegation,
} from "./delegation.js";
import {
  ensureTransferWindow,
  isTransferWindowOpen,
  getTransferPhase,
  transferWindowLabel,
  transferWindowShort,
  processTransferWindowDay,
  assertTransferOpen,
} from "./transfers.js";
import {
  ensureClubSquadPlan,
  ensureWorldSquadPlans,
  evaluateRecruitmentCandidate,
  evaluateYouthCandidate,
  invalidateClubSquadPlan,
  invalidateDivisionSquadPlans,
  selectPlannedLoanCandidate,
  selectPlannedOverstockedPosition,
  selectPlannedRecruitmentPosition,
  selectPlannedSaleCandidate,
  squadPositionPlan,
} from "./squad-planning.js";
import {
  ensureFacilities,
  startFacilityUpgrade,
  upgradeYouthAcademy,
  processFacilityDay,
  processAiFacilityInvestment,
  matchdayIncome,
  applySeasonLeagueFinance,
  trainingGrowthBonus,
  trainingHealBonus,
  trainingInjuryMod,
  stadiumInfo,
  trainingFacilityInfo,
  youthFacilityInfo,
  facilitySummaryLine,
  isBuilding,
  getProject,
  FACILITY_MAX,
  STADIUM_LEVELS,
  TRAINING_FACILITY_LEVELS,
  FACILITY_LABELS,
} from "./facilities.js";
import {
  clubTransferBudget,
  ensureClubFinance,
  ensureWorldFinances,
  processAiDebtActions,
  resetClubSeasonFinance,
  settleWorldWeeklyFinances,
  recordFinanceEntry,
} from "./club-finance.js";
import { clubCashAvailability } from "./cash-reservations.js";
import {
  buildTransferPaymentPlan,
  processFinanceObligationsDay,
  settleTransferAgreement,
} from "./finance-obligations.js";
import { ensureWorldSponsorships, settleSponsorshipSeason } from "./sponsorships.js";
import {
  processLeagueTransitionPayments,
  registerLeagueTransitionFinance,
} from "./league-transition-finance.js";
import { settleWorldDebtSeason } from "./club-debt.js";
import {
  autoRegisterClub,
  availableRegistrationContexts,
  developmentStatus,
  eligiblePlayerIds,
  ensureWorldRegistrations,
  playerCompetitionEligibility,
  recordDevelopmentSeason,
  registrationSummary,
  setPlayerRegistered,
} from "./squad-registration.js";
import {
  simulateMatch,
  simulateMatchSync,
  createMatchSession,
  playFirstHalf,
  playSecondHalf,
  continueSecondHalf,
  applyUserHalfTime,
  applyTeamTalk,
  applyManagedTeamTalk,
  suggestHalfTimeTalk,
  applySubstitution,
  applyLiveTactics,
  buildRoleReview,
  getHalfTimeTips,
  finalizeMatch,
  getBenchPlayers,
  getOnFieldPlayers,
  ensureFixtureWeather,
  isDerby,
  isBigMatch,
  weatherByKey,
} from "./match.js";
import {
  ensureActiveCareer,
  ensureDirectorCareer,
  ensureManagerCareer,
  recordManagerMatch,
  settleManagerSeason,
  managerWinRate,
  ensureClubHonors,
  recordManagerSack,
} from "./career.js";
import {
  ensureManagerJob,
  enterUnemployment,
  resignManagership,
  acceptJobOffer,
  rejectJobOffer,
  pendingJobOffers,
  generateJobOffers,
  processManagerJobsDay,
  managerReputation,
  reputationTierLabel,
  resignCooldownLeft,
  isManagerEmployed,
} from "./manager-jobs.js";
import {
  processPoachingDay,
  expirePoachBids,
  acceptPoachBid,
  rejectPoachBid,
  pendingPoachBids,
  ensurePoachBids,
} from "./poaching.js";
import {
  buildScoutReport,
  formatScoutReportHtml,
  buildOpponentReport,
  formatOpponentReportHtml,
  opponentReportLogLines,
  scoutFogLevel,
  scoutAttrRows,
  formatScoutOvrFog,
  formatScoutPotFog,
} from "./scoutreport.js";
import {
  ensureScoutingKnowledge,
  observeScoutingPlayer,
  rankScoutingCandidates,
  scoutClubKnowledge,
  scoutPlayerSnapshot,
  scoutingFreshnessLabel,
} from "./scouting-knowledge.js";
import { resetSeasonDiscipline, ensureDiscipline, isAvailable } from "./discipline.js";
import {
  processInboxDay,
  ensureInbox,
  listInbox,
  pendingInboxCount,
  resolveInboxAction,
  markInboxRead,
  syncPoachBidsToInbox,
  syncDealNegotiationsToInbox,
  syncTransferNegotiationsToInbox,
  pushInbox,
  inboxCatLabel,
} from "./inbox.js";
import {
  ensureTransferNegotiations,
  findActiveSaleNegotiation,
  findActiveTransferNegotiation,
  listTransferNegotiations,
  processTransferNegotiationsDay,
  respondTransferNegotiation,
  submitSaleListing,
  submitTransferNegotiation,
} from "./transfer-negotiations.js";
import {
  cancelActiveDealNegotiations,
  ensureDealNegotiations,
  findActiveDealNegotiation,
  listDealNegotiations,
  processDealNegotiationsDay,
  respondDealNegotiation,
  submitLoanNegotiation,
  submitRenewalNegotiation,
} from "./deal-negotiations.js";
import {
  processDressingRoomDay,
  dressingRoomLeaders,
  dressingRoomFactions,
  dressingRoomFrictions,
  dressingRoomHarmony,
  harmonyLabel,
  playerBond,
} from "./dressing-room.js";
import {
  processRelationsDay,
  ensureSquadRelations,
  clubAtmosphere,
  atmosphereLabel,
  relationLabel,
  applyPlayerTalk,
  ensurePlayerRelation,
} from "./relations.js";
import {
  processScoutMissions,
  startScoutMission,
  processWorldPulse,
  processYouthPulse,
  financeSnapshot,
  checkManagerBadges,
  noteUserMatchResult,
  ensureScoutMissions,
} from "./worldpulse.js";
import {
  ensurePlayerPathway,
  ensureDevelopmentStats,
  processPlayingTimePromises,
  recordPlayerDevelopment,
  setPlayingTimeRole,
  playingTimeProgress,
  playingTimeRoleLabel,
  playerDevelopmentTimeline,
  developmentAttrLabel,
  developmentSharpness,
  recentMatchMinutes,
  PLAYING_TIME_ROLES,
} from "./player-pathway.js";
import { runCalendarWorker } from "./sim/calendar-worker-client.js";

export {
  simulateMatch,
  simulateMatchSync,
  createMatchSession,
  playFirstHalf,
  playSecondHalf,
  continueSecondHalf,
  applyUserHalfTime,
  applyTeamTalk,
  applyManagedTeamTalk,
  suggestHalfTimeTalk,
  applySubstitution,
  applyLiveTactics,
  buildRoleReview,
  getHalfTimeTips,
  finalizeMatch,
  getBenchPlayers,
  getOnFieldPlayers,
  ensureFixtureWeather,
  isDerby,
  isBigMatch,
  weatherByKey,
  ensureActiveCareer,
  ensureDirectorCareer,
  ensureManagerCareer,
  recordManagerMatch,
  settleManagerSeason,
  managerWinRate,
  ensureClubHonors,
  processPoachingDay,
  acceptPoachBid,
  rejectPoachBid,
  pendingPoachBids,
  ensurePoachBids,
  buildScoutReport,
  formatScoutReportHtml,
  buildOpponentReport,
  formatOpponentReportHtml,
  opponentReportLogLines,
  scoutFogLevel,
  scoutAttrRows,
  formatScoutOvrFog,
  formatScoutPotFog,
  ensureScoutingKnowledge,
  observeScoutingPlayer,
  rankScoutingCandidates,
  scoutClubKnowledge,
  scoutPlayerSnapshot,
  scoutingFreshnessLabel,
  ensureDiscipline,
  isAvailable,
  resetSeasonDiscipline,
  processInboxDay,
  ensureInbox,
  listInbox,
  pendingInboxCount,
  resolveInboxAction,
  markInboxRead,
  syncPoachBidsToInbox,
  syncDealNegotiationsToInbox,
  syncTransferNegotiationsToInbox,
  pushInbox,
  inboxCatLabel,
  ensureTransferNegotiations,
  findActiveSaleNegotiation,
  findActiveTransferNegotiation,
  listTransferNegotiations,
  respondTransferNegotiation,
  submitSaleListing,
  submitTransferNegotiation,
  ensureDealNegotiations,
  findActiveDealNegotiation,
  listDealNegotiations,
  respondDealNegotiation,
  submitLoanNegotiation,
  submitRenewalNegotiation,
  cancelActiveDealNegotiations,
  autoRegisterClub,
  availableRegistrationContexts,
  developmentStatus,
  eligiblePlayerIds,
  ensureWorldRegistrations,
  playerCompetitionEligibility,
  registrationSummary,
  setPlayerRegistered,
  processRelationsDay,
  ensureSquadRelations,
  clubAtmosphere,
  atmosphereLabel,
  relationLabel,
  applyPlayerTalk,
  ensurePlayerRelation,
  dressingRoomLeaders,
  dressingRoomFactions,
  dressingRoomFrictions,
  dressingRoomHarmony,
  harmonyLabel,
  playerBond,
  processScoutMissions,
  startScoutMission,
  processWorldPulse,
  processYouthPulse,
  financeSnapshot,
  checkManagerBadges,
  noteUserMatchResult,
  ensureScoutMissions,
  ensureManagerJob,
  enterUnemployment,
  resignManagership,
  acceptJobOffer,
  rejectJobOffer,
  pendingJobOffers,
  generateJobOffers,
  processManagerJobsDay,
  managerReputation,
  reputationTierLabel,
  resignCooldownLeft,
  isManagerEmployed,
  ensurePlayerPathway,
  ensureDevelopmentStats,
  setPlayingTimeRole,
  playingTimeProgress,
  playingTimeRoleLabel,
  playerDevelopmentTimeline,
  developmentAttrLabel,
  developmentSharpness,
  recentMatchMinutes,
  PLAYING_TIME_ROLES,
};

function rng() {
  return Math.random();
}

function chance(p) {
  return rng() < p;
}

function clubById(world, id) {
  return world.clubs.find((c) => c.id === id);
}

const ATTR_KEYS = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "finishing", "tackling", "marking", "strength", "stamina", "vision",
  "reflexes", "handling", "positioning", "kicking", "heading", "crossing", "decisions",
];

function staffRatingSafe(club, role) {
  ensureStaff(club);
  return club.staff[role]?.rating || 8;
}

function growYouthPlayer(player, growthRate, context = {}) {
  if (!player.potential) player.potential = Math.min(20, player.ovr + 3);
  if (player.ovr >= player.potential) return false;
  let grew = false;
  // 每周有机会涨 1 点某项属性
  if (chance(growthRate)) {
    const keys = weightedDevelopmentAttributes(player, ATTR_KEYS);
    if (keys.length) {
      const k = keys[Math.floor(rng() * keys.length)];
      // 未达潜力时才涨
      const room = player.potential - player.ovr;
      if (room > 0 || player.attrs[k] < player.potential) {
        const before = Number(player.attrs[k] || 1);
        const ovrBefore = Number(player.ovr || playerOverall(player));
        player.attrs[k] = Math.min(20, (player.attrs[k] || 1) + 1);
        grew = true;
        if (context.record) {
          recordPlayerDevelopment(player, {
            season: context.world?.season,
            day: context.world?.day,
            type: "academy-training",
            source: "youth-development",
            changes: [{ attribute: k, before, after: player.attrs[k] }],
            ovrBefore,
            ovrAfter: playerOverall(player),
            reason: "青训设施、教练能力与本周培养计划共同推动成长",
            reasonEn: "Academy facilities, coaching and the weekly development plan drove improvement",
            details: {
              academyLevel: context.club?.youth?.level || 1,
              growthRate,
              developmentMinutes: Number(context.developmentMinutes || 0),
              developmentSharpness: Number(context.developmentSharpness || 0),
            },
          });
        }
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

/** 青训日更：成长 / 招生；维护费由全俱乐部统一周结算处理。 */
function processYouthDay(world) {
  for (const club of world.clubs) {
    const ya = ensureYouthAcademy(club);
    const cfg = YOUTH_LEVELS[ya.level] || YOUTH_LEVELS[1];
    ya.daysSinceIntake = (ya.daysSinceIntake || 0) + 1;
    for (const yp of ya.players) {
      processInjuryRecoveryDay(yp, {
        doctorBonus: doctorHealBonus(club),
        facilityBonus: trainingHealBonus(club),
      });
    }

    // 每周成长（教练加成）
    if (world.day % 7 === 0) {
      const yMult = youthTrainingMult(club);
      const growth =
        (cfg.growth + coachGrowthBonus(club) + trainingGrowthBonus(club) * 0.5) * yMult;
      for (const yp of ya.players) {
        const matchSharpness = developmentSharpness(world, yp);
        const matchExposure = developmentGrowthMultiplier(world, yp);
        growYouthPlayer(yp, growth * matchExposure, {
          world,
          club,
          record: club.id === world.userClubId,
          developmentMinutes: Math.round(recentMatchMinutes(world, yp)),
          developmentSharpness: matchSharpness,
        });
      }
      for (const p of club.players) {
        if (p.fromYouth && p.age <= 22 && p.potential && p.ovr < p.potential && chance(growth * 0.35)) {
          growYouthPlayer(p, growth * 0.5, { world, club, record: club.id === world.userClubId });
          p.wage = estimateWage(p);
        }
      }
    }

    // 约每 60 天招生（球探提升潜力），更符合现实青训周期
    if (ya.daysSinceIntake >= 60) {
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
      if (newcomers.length) assignSquadNumbers(club);
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
  const squadPlan = ensureClubSquadPlan(world, club);
  // 按一线队未来位置缺口、成熟度和培养价值选择提拔对象。
  const promote = ya.players
    .map((player) => ({ player, review: evaluateYouthCandidate(world, club, player, { plan: squadPlan }) }))
    .filter((item) => item.review.promote)
    .sort((a, b) => b.review.score - a.review.score);
  for (const { player: p } of promote.slice(0, 1)) {
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
  // 换队后清旧号再分配，避免撞号
  player.number = null;
  club.players.push(player);
  assignSquadNumbers(club);
  autoLineup(club);
  invalidateClubSquadPlan(club);

  if (!silent && clubId === world.userClubId) {
    recordPlayerDevelopment(player, {
      season: world.season,
      day: world.day,
      type: "milestone",
      source: "academy-promotion",
      reason: "从青训学院升入一线队",
      reasonEn: "Promoted from the academy to the first team",
      details: { clubId: club.id },
    });
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
  return { ok: true, msg: `已与 ${player.name} 解约` };
}

// 青训升级：走 facilities 工期系统（re-export 见文件底部 import）

function beginAdvanceDay(world) {
  // 待业：日历仍推进（生成工作邀请），但不能经营旧队比赛
  if (world.sacked) {
    world.day += 1;
    processFinanceObligationsDay(world);
    processTransferNegotiationsDay(world);
    processDealNegotiationsDay(world);
    ensureManagerJob(world);
    processManagerJobsDay(world);
    return {
      finished: true,
      result: {
        userMatches: [],
        sacked: true,
        unemployed: world.managerJob?.status === "unemployed",
        events: [],
        offers: pendingJobOffers(world),
      },
    };
  }

  world.day += 1;
  processFinanceObligationsDay(world);
  const events = []; // 收集关键事件用于反馈

  // 转会窗开/关提示
  ensureTransferWindow(world);
  processTransferWindowDay(world);
  processTransferNegotiationsDay(world);
  processDealNegotiationsDay(world);
  const twEvent = checkTransferWindowEvent(world);
  if (twEvent) events.push(twEvent);

  expirePoachBids(world);
  processPoachingDay(world);
  processStaffMarketDay(world);
  processManagerJobsDay(world);
  // 信箱：同步挖角、过期、偶发球员/球探邮件
  processInboxDay(world);
  // 关系/氛围 + 可能的约谈信草稿
  const relOut = processRelationsDay(world);
  if (relOut?.inboxDraft) {
    pushInbox(world, relOut.inboxDraft);
    events.push({ type: "player_unhappy", player: relOut.inboxDraft.playerName });
  }
  const userClub = clubById(world, world.userClubId);
  for (const draft of processPlayingTimePromises(world, userClub)) {
    pushInbox(world, draft);
    if (draft.priority >= 3) {
      events.push({ type: "playing_time_breach", playerId: draft.ref?.playerId });
    }
  }
  // 更衣室：派系与领袖不满（关系网由现有事实推导，不写入隐藏修正）
  const roomOut = processDressingRoomDay(world);
  if (roomOut?.inboxDraft) {
    pushInbox(world, roomOut.inboxDraft);
    events.push({ type: "dressing_room_unrest", playerId: roomOut.inboxDraft.ref?.playerId });
  }
  processScoutMissions(world);
  processWorldPulse(world);
  processYouthPulse(world);

  // 设施建设完工
  const facilityResult = processFacilityDay(world);
  if (facilityResult?.completed) {
    events.push({ type: "facility_completed", facility: facilityResult.kind });
  }

  // 训练日程：体能 / 伤愈 / 士气 / 周成长（替代原先统一恢复）
  ensureWorldDelegation(world);
  applyDelegatedTraining(world, userClub);
  applyDelegatedDevelopment(world, userClub);
  processTrainingDay(world);

  // 青训
  processYouthDay(world);
  const youthEvent = checkYouthRecruitmentEvent(world);
  if (youthEvent) events.push(youthEvent);

  // 国际比赛日（约每 50 天，更贴近现实频率）
  if (!world.lastIntlDay) world.lastIntlDay = 0;
  if (world.day - world.lastIntlDay >= 50 && !world.seasonOver) {
    const intl = runInternationalBreak(world);
    // 征召的代价对玩家可见：被征召人数与因国家队比赛受伤的自家球员。
    const userPlayerIds = new Set((userClub?.players || []).map((p) => p.id));
    events.push({
      type: "international_break",
      day: world.day,
      callups: (intl.callups || []).length,
      injuries: (intl.injuries || []).filter((item) => userPlayerIds.has(item.playerId)),
    });
  }

  ensureCompetitions(world);

  // 今天的比赛：国内联赛、国内杯与大陆赛事（非用户场次自动踢完）
  const todayLeague = world.fixtures.filter((f) => f.day === world.day && !f.played);
  const todayCompetitions = competitionFixturesOnDay(world, world.day);
  const today = [...todayLeague, ...todayCompetitions];
  const userMatches = [];
  const aiFixtures = [];
  const keyMatchIds = [];
  for (const f of today) {
    const isUser = f.home === world.userClubId || f.away === world.userClubId;
    if (isUser) {
      userMatches.push(f);
    } else {
      aiFixtures.push(f);
      if (f.derby || isTopTableClash(world, f) || isRelegationClash(world, f)) {
        keyMatchIds.push(f.id);
      }
    }
  }
  return { finished: false, events, userClub, userMatches, aiFixtures, keyMatchIds };
}

function finishAdvanceDay(world, context) {
  const { events, userClub, userMatches, aiFixtures, keyMatchIds = [] } = context;
  const aiMatchResults = [];
  for (const f of aiFixtures) {
    // 记录关键AI比赛（德比、争冠、保级）
    if (keyMatchIds.includes(f.id)) {
      aiMatchResults.push({
        home: clubById(world, f.home)?.short || clubById(world, f.home)?.name,
        away: clubById(world, f.away)?.short || clubById(world, f.away)?.name,
        homeGoals: f.homeGoals,
        awayGoals: f.awayGoals,
        derby: f.derby,
      });
    }
  }
  if (aiMatchResults.length > 0) {
    events.push({ type: "key_matches", matches: aiMatchResults });
  }
  // 用户比赛尚未结算时积分榜不完整，AI 董事会延后到下一完整日复核。
  const managerEvents = userMatches.length
    ? []
    : processManagerEcosystemDay(world, { alreadyEnsured: true });
  if (managerEvents.length) events.push(...managerEvents);

  // 发展队比赛在完整日历日运行；用户正式比赛会在 finalizeMatch 后再触发，
  // 以便先锁定当天一线队的真实出场与体能事实。
  if (!userMatches.length) {
    const developmentMatches = processDevelopmentMatchesForDay(world);
    if (developmentMatches.length) {
      events.push({
        type: "development_matches",
        count: developmentMatches.length,
        matches: developmentMatches
          .filter((match) => match.home === world.userClubId || match.away === world.userClubId)
          .map((match) => ({
            home: match.home,
            away: match.away,
            homeGoals: match.score.home,
            awayGoals: match.score.away,
          })),
      });
    }
  }

  // 租借到期归还
  ensureLoans(world);
  const loanResult = processLoansDay(world);
  if (loanResult?.returned?.length > 0) {
    events.push({ type: "loan_returned", count: loanResult.returned.length });
  }

  // 媒体日常脉搏
  if (userClub && !world.seasonOver) {
    mediaDailyPulse(world, userClub);
    narrativeTablePulse(world, userClub, getSortedTable);
    narrativeInjuryWave(world, userClub);
  }

  // 检查伤病事件
  const injuryEvent = checkInjuryEvent(world, userClub);
  if (injuryEvent) events.push(injuryEvent);

  // 检查董事会警告
  const boardEvent = checkBoardEvent(world);
  if (boardEvent) events.push(boardEvent);

  // 所有俱乐部使用同一套工资、设施维护与商业收入周结算。
  if (world.day % 7 === 0) {
    const settlements = settleWorldWeeklyFinances(world);
    const debtActions = processAiDebtActions(world);
    if (debtActions.length) events.push({ type: "ai_debt_actions", actions: debtActions });
    const facilityInvestments = processAiFacilityInvestment(world);
    if (facilityInvestments.length) {
      events.push({ type: "ai_facility_investments", actions: facilityInvestments });
    }
    const user = clubById(world, world.userClubId);
    const userSettle = settlements.find((item) => item.clubId === world.userClubId);
    const total = userSettle?.operatingOut || 0;
    const commercial = userSettle?.commercialIncome || 0;
    world.news.unshift({
      day: world.day,
      text: `俱乐部周结算：商业收入 ${formatMoney(commercial)} - 运营支出 ${formatMoney(total)}（一线 ${formatMoney(userSettle?.squadWage || 0)} + 青训 ${formatMoney(userSettle?.youthWage || 0)} + 职员 ${formatMoney(userSettle?.staffWage || 0)} + 设施 ${formatMoney(userSettle?.facilityUpkeep || 0)}），资金 ${formatMoney(user.money)}`,
    });
  }

  // 赛季结束：只处理一次（年龄 / 下滑 / 退役；可能赛季末解雇）
  let finishResult = null;
  const allPlayed =
    world.fixtures.length > 0 &&
    world.fixtures.every((f) => f.played) &&
    competitionsComplete(world);
  if (allPlayed && !world.seasonOver) {
    finishResult = finishSeason(world);
  }

  // 董事会中期检查（可能解雇）+ 窗内 AI 转会
  let sackedResult = null;
  if (!world.seasonOver && !world.sacked) {
    sackedResult = checkBoardMidSeason(world, getSortedTable);
    if (!world.sacked && isTransferWindowOpen(world)) {
      const aiMoves = processAiTransfers(world);
      if (aiMoves.length) {
        const types = aiMoves.reduce((counts, move) => {
          const type = move.type || "transfer";
          counts[type] = (counts[type] || 0) + 1;
          return counts;
        }, {});
        events.push({
          type: "ai_squad_moves",
          day: world.day,
          count: aiMoves.length,
          types,
        });
      }
    }
  }

  const sacked =
    !!(sackedResult && sackedResult.sacked) ||
    !!(finishResult && finishResult.sacked) ||
    !!world.sacked;

  // 解雇/待业：生成工作邀请（保留存档可再就业）
  if (sacked && world.sacked) {
    ensureManagerJob(world);
    if (world.managerJob.status !== "unemployed" || !pendingJobOffers(world).length) {
      enterUnemployment(world, world.sackedReason || "被董事会解雇", { fromSack: true });
    }
  }
  // 标注事件发生日，便于多日推进后的摘要按时间排列
  for (const ev of events) {
    if (ev.day == null) ev.day = world.day;
  }
  // 开发期一致性检查：默认关闭，由 VCFM_DEV_INVARIANTS=1 启用
  assertWorldInvariantsWhenEnabled(world, "advance-day");
  return {
    userMatches,
    sacked,
    sackedResult:
      sackedResult ||
      finishResult?.sackedResult ||
      (world.sacked ? { sacked: true, msg: world.sackedReason } : null),
    events, // 返回事件列表供界面展示
  };
}

/** 推进一天：训练恢复、AI 比赛、工资 */
export function advanceDay(world, options = {}) {
  const context = beginAdvanceDay(world);
  if (context.finished) return context.result;
  for (const fixture of context.aiFixtures) {
    simulateMatch(world, fixture, {
      engineMode: options.aiEngineMode,
      simulationProfile: options.aiSimulationProfile,
    });
  }
  return finishAdvanceDay(world, context);
}

/** Calendar worker path: expensive match clocks may run in a dedicated pool. */
export async function advanceDayWithMatchRunner(world, options = {}, matchRunner) {
  const context = beginAdvanceDay(world);
  if (context.finished) return context.result;
  if (context.aiFixtures.length) {
    await matchRunner(world, context.aiFixtures, {
      engineMode: options.aiEngineMode,
      simulationProfile: options.aiSimulationProfile,
    });
  }
  return finishAdvanceDay(world, context);
}

// 辅助函数：检查各种关键事件

function checkTransferWindowEvent(world) {
  const tw = world.transferWindow;
  if (!tw || !tw.lastPhase) return null;
  const phase = getTransferPhase(world);
  if (phase !== tw.lastPhase) {
    if (phase === "summer") return { type: "transfer_window", phase: "summer_open" };
    if (phase === "winter") return { type: "transfer_window", phase: "winter_open" };
    if (phase === "closed") return { type: "transfer_window", phase: "closed" };
  }
  return null;
}

function checkYouthRecruitmentEvent(world) {
  const userClub = clubById(world, world.userClubId);
  if (!userClub) return null;
  const ya = userClub.youth;
  if (!ya) return null;
  // 检查是否刚招生（daysSinceIntake === 0 表示刚重置）
  if (ya.daysSinceIntake === 0 && ya.players.length > 0) {
    const newcomers = ya.players.slice(-3); // 假设最多3个新人
    if (newcomers.length > 0) {
      return {
        type: "youth_recruitment",
        count: newcomers.length,
        avgPotential: Math.round(
          newcomers.reduce((s, p) => s + (p.potential || p.ovr || 0), 0) /
            newcomers.length
        ),
      };
    }
  }
  return null;
}

function isTopTableClash(world, fixture) {
  if (!world?.table) return false;
  const homeClub = clubById(world, fixture.home);
  const awayClub = clubById(world, fixture.away);
  if (!homeClub || !awayClub || homeClub.division !== awayClub.division) return false;

  const table = getSortedTable(world, homeClub.division);
  const homePos = table.findIndex(r => r.id === fixture.home) + 1;
  const awayPos = table.findIndex(r => r.id === fixture.away) + 1;

  // 双方都在前4名
  return homePos > 0 && awayPos > 0 && homePos <= 4 && awayPos <= 4;
}

function isRelegationClash(world, fixture) {
  if (!world?.table) return false;
  const homeClub = clubById(world, fixture.home);
  const awayClub = clubById(world, fixture.away);
  const relegate = DIVISIONS[homeClub?.division]?.relegate || 0;
  if (!homeClub || !awayClub || homeClub.division !== awayClub.division || relegate <= 0) return false;

  const table = getSortedTable(world, homeClub.division);
  const homePos = table.findIndex(r => r.id === fixture.home) + 1;
  const awayPos = table.findIndex(r => r.id === fixture.away) + 1;
  const total = table.length;
  const dangerStart = Math.max(1, total - relegate - 1);

  // 双方都在保级区附近（倒数5名）
  return homePos > 0 && awayPos > 0 && homePos >= dangerStart && awayPos >= dangerStart;
}

function checkInjuryEvent(world, userClub) {
  if (!userClub) return null;
  const injured = userClub.players.filter((p) => (p.injured || 0) > 0);
  if (injured.length >= 3) {
    return { type: "injury_wave", count: injured.length };
  }
  return null;
}

function checkBoardEvent(world) {
  const userClub = clubById(world, world.userClubId);
  if (!userClub) return null;
  const board = world.boardObjective;
  if (!board) return null;
  // 检查是否有新警告
  const warnings = board.warnings || 0;
  if (warnings > (board._lastWarnings || 0)) {
    board._lastWarnings = warnings;
    return { type: "board_warning", warnings, maxWarnings: 4 };
  }
  return null;
}

/**
 * 赛季末：排名新闻 + 全员年龄+1 + 高龄下滑 + 退役
 * 不会自动开新赛季，需调用 startNextSeason
 */
export function finishSeason(world) {
  if (world.seasonOver) return { retired: [] };

  archiveDevelopmentSeason(world);

  // Record the actual club and association where each 15-21-year-old trained
  // before ages advance and loans return for the next season.
  recordDevelopmentSeason(world, world.season);

  // 个人荣誉（用本赛季 stats，在归档/升降级前）
  awardSeasonHonors(world);

  // 合同年限 -1 / 到期
  processContractsEndOfSeason(world);

  // 大陆席位取升降级前的本赛季最终排名。
  world._nextContinentalQualifiers = buildContinentalQualifiers(world);

  // 转播分成 + 名次奖金：须在升降级改写 division 之前，按本赛季最终积分榜
  const leaguePay = applySeasonLeagueFinance(world, getSortedTable);
  const sponsorshipPay = settleSponsorshipSeason(world, getSortedTable);
  const debtPay = settleWorldDebtSeason(world);

  // AI 董事会必须在升降级改写 division 前，按最终积分榜复核主教练。
  processManagerEcosystemSeasonEnd(world);

  // 先算本级排名与升降级（在年龄变化前，用本赛季积分）
  const promoNews = applyPromotionRelegation(world);

  const userClub = getUserClub(world);
  const userDivForAward = world._lastUserDiv || userClub.division || 3;
  const pos = world._lastUserPos > 0 ? world._lastUserPos : 1;
  const divName = DIVISIONS[userDivForAward]?.name || `第${userDivForAward}级`;
  // 经理生涯 / 俱乐部荣誉墙 / 结算快照
  ensureManagerCareer(world);
  settleManagerSeason(world, pos, userDivForAward, promoNews);
  world.news.unshift({
    day: world.day,
    text: `🏆 ${world.season} 赛季结束！${userClub.name} 在${divName}排名第 ${pos} 名。可进入下一赛季。`,
  });
  if (leaguePay?.userPayout) {
    const up = leaguePay.userPayout;
    world.news.unshift({
      day: world.day,
      text: `📺 联赛分红：第 ${up.pos} 名 · 转播分成 ${formatMoney(up.broadcast)} + 名次奖金 ${formatMoney(up.prize)} = ${formatMoney(up.total)}（已入账）`,
    });
  }
  const userSponsorPay = sponsorshipPay.find((item) => item.clubId === userClub.id);
  if (userSponsorPay?.achieved) {
    world.news.unshift({
      day: world.day,
      text: `商业赞助：联赛排名目标已达成，表现奖金 ${formatMoney(userSponsorPay.amount)} 已入账。`,
    });
  }
  const userDebtPay = debtPay.filter((item) => item.clubId === userClub.id)
    .reduce((sum, item) => sum + item.principal, 0);
  if (userDebtPay > 0) {
    world.news.unshift({ day: world.day, text: `赛季债务还本 ${formatMoney(userDebtPay)} 已从现金余额扣除。` });
  }
  mediaSeasonAwards(world, userClub, pos, divName);
  const boardSettle = settleBoardObjective(world, pos, getSortedTable);
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
      const declined = agePlayerOneYear(p, {
        season: world.season,
        day: world.day,
        record: club.id === world.userClubId,
      });
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
      agePlayerOneYear(p, {
        season: world.season,
        day: world.day,
        record: club.id === world.userClubId,
      });
      // 青训一般不退役；满 20 岁仍在青训则强制释放或提拔潜力高的
      if (p.age >= 20) {
        const plannedPromotion = club.id !== world.userClubId
          ? evaluateYouthCandidate(world, club, p).promote
          : p.potential >= 14;
        const squadLimit = club.id === world.userClubId ? 23 : 25;
        if (plannedPromotion && club.players.length < squadLimit) {
          p.fromYouth = true;
          // 学院号码只用于青训名单；进入一线队后参加正式赛季登记。
          p.number = null;
          p.wage = estimateWage(p);
          ensurePlayerHistory(p);
          club.players.push(p);
          invalidateClubSquadPlan(club);
          if (club.id === world.userClubId) {
            recordPlayerDevelopment(p, {
              season: world.season,
              day: world.day,
              type: "milestone",
              source: "academy-age-promotion",
              reason: "达到青训年龄上限后升入一线队",
              reasonEn: "Promoted after reaching the academy age limit",
              details: { clubId: club.id },
            });
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

    // 退役、合同到期后先保证每个位置组仍能组成现实的一线队骨架。
    const minimumByPosition = { GK: 2, DEF: 5, MID: 5, ATT: 3 };
    for (const [position, minimum] of Object.entries(minimumByPosition)) {
      while (club.players.filter((player) => player.pos === position).length < minimum) {
        const existingNames = new Set(club.players.map((player) => player.name));
        club.players.push(
          createPlayer(position, club.power - 5 + Math.floor(rng() * 8), club.id, {
            homeNation: club.countryCode,
            existingNames,
          })
        );
      }
    }

    // 阵容过少则继续补充轮换球员。
    while (club.players.length < 16) {
      const posPick = ["GK", "DEF", "MID", "ATT"][Math.floor(rng() * 4)];
      const existingNames = new Set(club.players.map((player) => player.name));
      club.players.push(
        createPlayer(posPick, club.power - 5 + Math.floor(rng() * 8), club.id, {
          homeNation: club.countryCode,
          existingNames,
        })
      );
    }
    // 赛季末新补充球员先保持无号；下一赛季在归队/解约完成后统一登记，
    // 避免普通补位球员提前占走刚释放的 7/9/10/11 号。
    fillYouthSquad(club, null, { assignNumbers: false });
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
  return {
    retired: retiredUser,
    sacked: !!(boardSettle && boardSettle.sacked) || !!world.sacked,
    sackedResult: boardSettle?.sack || (world.sacked ? { sacked: true, msg: world.sackedReason } : null),
  };
}

/** 开启下一赛季：归档个人赛季数据 → 重置积分榜、赛程 */
export function startNextSeason(world) {
  ensureCompetitions(world);
  if (
    !world.seasonOver &&
    (world.fixtures.some((f) => !f.played) || !competitionsComplete(world))
  ) {
    return { ok: false, msg: "本赛季尚未结束" };
  }

  // 若尚未做过赛季末处理（年龄/退役）
  if (!world.seasonOver) finishSeason(world);

  const endedSeason = world.season;
  const priorNumberEntries = new Map(
    (world.clubs || []).map((club) => [club.id, { ...(club.numberRegistration?.entries || {}) }])
  );

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

  // 全部租借归还，再处理未续约离队
  cancelActiveDealNegotiations(world);
  returnAllLoans(world);
  releaseUnrenewed(world);

  const expandedClubs = ensureWorldClubTemplates(world);
  ensureWorldFinances(world);

  world.season += 1;
  world.day = 1;
  world.seasonOver = false;
  // 新赛季重置解雇标记与转会窗状态
  world.sacked = false;
  world.sackedDay = null;
  world.sackedReason = null;
  ensureTransferWindow(world);
  world.transferWindow.lastPhase = null;
  processTransferWindowDay(world);
  ensurePoachBids(world);
  world.poachBids = [];
  processStaffContractsEndOfSeason(world);
  ensureStaffApproaches(world);
  world.staffApproaches = (world.staffApproaches || []).filter((a) => a.status === "pending");

  const userNumberRegistrationChanges = [];
  for (const c of world.clubs) {
    world.table[c.id] = { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    if (!c.division) c.division = 3;
    resetClubSeasonFinance(c, world.season);
    for (const p of c.players) {
      ensureContract(p);
      ensureDiscipline(p);
      resetSeasonDiscipline(p);
    }
    autoLineup(c);
    const numberResult = registerSquadNumbers(c, {
      season: world.season,
      reason: "new-season",
      day: 1,
      protectedEntries: priorNumberEntries.get(c.id) || {},
    });
    if (c.id === world.userClubId) userNumberRegistrationChanges.push(...numberResult.changes);
  }
  ensureWorldSponsorships(world);
  const leagueTransitionPayments = processLeagueTransitionPayments(world);
  ensureWorldSeasonPlans(world);
  ensureWorldSquadPlans(world, { force: true });

  world.fixtures = generateAllDivisionFixtures(world.clubs);
  const qualifiers = world._nextContinentalQualifiers || null;
  delete world._nextContinentalQualifiers;
  resetCompetitions(world, qualifiers);
  ensureWorldRegistrations(world);
  const user = getUserClub(world);
  const divName = DIVISIONS[user.division]?.name || "";
  world.news.unshift({
    day: 1,
    text: `📅 ${world.season} 赛季开始！${user.name} 征战${divName}。国内联赛、杯赛与大陆赛事赛程已生成。${expandedClubs ? ` 世界联赛新增 ${expandedClubs} 家俱乐部。` : ""}`,
  });
  if (userNumberRegistrationChanges.length) {
    const changed = userNumberRegistrationChanges.slice(0, 6).map((item) => `${item.name} ${item.from ? `#${item.from}→` : ""}#${item.to}`).join("、");
    const more = userNumberRegistrationChanges.length > 6 ? ` 等 ${userNumberRegistrationChanges.length} 人` : "";
    world.news.unshift({
      day: 1,
      text: `🔢 新赛季号码登记：${changed}${more}。原有持有人优先保留，空缺重要号码按球员偏好、位置与阵容地位分配。`,
    });
  }
  const userTransitionPayment = leagueTransitionPayments.find((item) => item.clubId === user.id);
  if (userTransitionPayment) {
    world.news.unshift({
      day: 1,
      text: `${userTransitionPayment.kind === "promotion" ? "升级筹备支持" : "降级缓冲金"} ${formatMoney(userTransitionPayment.amount)} 已入账。`,
    });
  }
  mediaSeasonKickoff(world, user, divName);
  ensureBoardObjective(world);

  return { ok: true, msg: `${world.season} 赛季 · ${divName} 已开始` };
}

export function renewUserPlayer(world, playerId, opts = {}) {
  const club = getUserClub(world);
  if (!club) return { ok: false, msg: "无球队" };
  const p = club.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, msg: "球员不在阵中" };
  if (p.loan) return { ok: false, msg: "租借球员无法续约" };
  const offer = opts.wage != null
    ? { years: opts.years || 3, newWage: opts.wage }
    : renewOffer(p, opts.years != null ? { years: opts.years } : {});
  return submitRenewalNegotiation(world, playerId, {
    years: offer.years,
    wage: offer.newWage,
  });
}

export function loanOutPlayer(world, playerId, opts = {}) {
  const preview = previewLoanOut(world, playerId, opts.term || "half");
  if (!preview) return { ok: false, msg: "无法外租该球员" };
  return submitLoanNegotiation(world, "loan_out", playerId, null, {
    term: opts.term,
    fee: opts.fee ?? preview.fee,
    wageShare: opts.wageShare ?? preview.wageShare,
  });
}

export function loanInPlayer(world, playerId, fromClubId, opts = {}) {
  const preview = previewLoanIn(world, playerId, fromClubId, opts.term || "half");
  if (!preview) return { ok: false, msg: "无法租入该球员" };
  return submitLoanNegotiation(world, "loan_in", playerId, fromClubId, {
    term: opts.term,
    fee: opts.fee ?? preview.fee,
    wageShare: opts.wageShare ?? preview.wageShare,
  });
}

export function terminateUserPlayer(world, playerId) {
  if (world.sacked) return { ok: false, msg: "你已被解雇，无法操作" };
  const club = getUserClub(world);
  if (!club) return { ok: false, msg: "无球队" };
  const p = club.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, msg: "球员不在阵中" };
  if (findActiveDealNegotiation(world, playerId) || findActiveTransferNegotiation(world, playerId)) {
    return { ok: false, msg: "该球员仍有进行中的合同、租借或转会谈判" };
  }
  const res = terminatePlayer(world, club, p);
  if (res.ok) {
    world.news.unshift({ day: world.day, text: `📝 ${res.msg}` });
  }
  return res;
}

export function previewTerminate(world, playerId) {
  const club = getUserClub(world);
  const p = club?.players?.find((x) => x.id === playerId);
  if (!p) return null;
  return { player: p, cost: terminateCost(p) };
}

export function previewRenew(world, playerId, years) {
  const club = getUserClub(world);
  const p = club?.players?.find((x) => x.id === playerId);
  if (!p) return null;
  return { player: p, offer: renewOffer(p, years != null ? { years } : {}) };
}

export function getNextPlayableMatch(world) {
  return getNextUserMatch(world);
}

export {
  ensureCompetitions,
  getNextUserCompetitionMatch,
  allUserCompetitionFixtures,
  allCompetitionFixtures,
  renewOffer,
  ensureContract,
  signFreeAgent,
  needsContractAttention,
  terminateCost,
  ensureTraining,
  setTraining,
  trainingSummary,
  assistantTrainingPlan,
  TRAINING_FOCUSES,
  TRAINING_INTENSITIES,
  ensureTransferWindow,
  isTransferWindowOpen,
  getTransferPhase,
  transferWindowLabel,
  transferWindowShort,
  processTransferWindowDay,
  assertTransferOpen,
  sackManager,
  ensureFacilities,
  startFacilityUpgrade,
  upgradeYouthAcademy,
  stadiumInfo,
  trainingFacilityInfo,
  youthFacilityInfo,
  facilitySummaryLine,
  isBuilding,
  getProject,
  FACILITY_MAX,
  STADIUM_LEVELS,
  TRAINING_FACILITY_LEVELS,
  FACILITY_LABELS,
  ensureClubFinance,
  ensureWorldFinances,
  // 租借
  ensureLoans,
  recallLoan,
  returnLoan,
  processLoansDay,
  returnAllLoans,
  listUserLoans,
  userSquadWageBill,
  previewLoanOut,
  previewLoanIn,
  isOnLoan,
};

/** 按各国联赛配置执行相邻级别升降级。 */
export function applyPromotionRelegation(world) {
  const news = [];
  const sortDiv = (d) => getSortedTable(world, d);
  const clubMap = new Map(world.clubs.map((c) => [c.id, c]));

  // 记录用户升降前级别与排名（供赛季总结）
  const user = getUserClub(world);
  const userDivBefore = user.division || 3;
  const ranked = sortDiv(userDivBefore);
  world._lastUserDiv = userDivBefore;
  world._lastUserPos = ranked.findIndex((r) => r.id === user.id) + 1;
  const nameOf = (id) => clubMap.get(id)?.name || id;
  const list = (ids) => ids.map(nameOf).join("、");
  const moves = [];
  const countryIds = [...new Set(Object.values(DIVISIONS).map((d) => d.countryId))];
  for (const countryId of countryIds) {
    const leagues = Object.values(DIVISIONS)
      .filter((d) => d.countryId === countryId)
      .sort((a, b) => a.tier - b.tier);
    for (let i = 0; i < leagues.length - 1; i++) {
      const upper = leagues[i];
      const lower = leagues[i + 1];
      const count = Math.min(upper.relegate || 0, lower.promote || 0);
      if (!count) continue;
      const upperTable = sortDiv(upper.id);
      const lowerTable = sortDiv(lower.id);
      if (upperTable.length < count || lowerTable.length < count) continue;
      const relegated = upperTable.slice(-count).map((r) => r.id);
      const promoted = lowerTable.slice(0, count).map((r) => r.id);
      for (const id of relegated) moves.push({ id, from: upper.id, to: lower.id, promoted: false });
      for (const id of promoted) moves.push({ id, from: lower.id, to: upper.id, promoted: true });
      news.push(`⬆️ ${lower.name}升级：${list(promoted)} → ${upper.name}`);
      news.push(`⬇️ ${upper.name}降级：${list(relegated)} → ${lower.name}`);
    }
  }

  for (const move of moves) {
    const club = clubMap.get(move.id);
    if (club) {
      registerLeagueTransitionFinance(world, club, move);
      club.division = move.to;
    }
  }

  const userMove = moves.find((m) => m.id === user.id);
  if (userMove?.promoted) {
    news.push(`🎉 恭喜！${user.name} 成功升级至${DIVISIONS[user.division]?.name}！`);
  }
  if (userMove && !userMove.promoted) {
    news.push(`😢 ${user.name} 不幸降级至${DIVISIONS[user.division]?.name}。`);
  }

  // 媒体通稿（用户相关）
  if (userMove) {
    mediaPromotion(
      world,
      user.name,
      DIVISIONS[userDivBefore]?.name || "",
      DIVISIONS[user.division]?.name || "",
      userMove.promoted
    );
  }

  return news;
}

/** @param division 不传则全世界；传联赛 ID 则仅该联赛 */
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
  // 国内联赛、国内杯与大陆赛事里用户下场最早的未赛
  const league = world.fixtures
    .filter(
      (f) =>
        !f.played &&
        (f.home === world.userClubId || f.away === world.userClubId)
    )
    .sort((a, b) => a.day - b.day || (a.round || 0) - (b.round || 0));
  const competition = getNextUserCompetitionMatch(world);
  if (league[0] && competition) {
    return league[0].day <= competition.day ? league[0] : competition;
  }
  return league[0] || competition || null;
}

/** 下一场用户比赛的日期（联赛/杯）；无则 null */
export function nextUserMatchDay(world) {
  const m = getNextUserMatch(world);
  return m ? m.day : null;
}

/**
 * 连续推进到下一场用户比赛日（或赛季结束）。
 * 若当天已有可踢比赛，不推进，返回 stopped 提示。
 * 返回值包含关键事件摘要，用于界面展示。
 */
export function advanceToNextMatchDay(world, maxDays = 60, options = {}) {
  if (world.sacked) {
    return { ok: false, msg: "你已被解雇", days: 0, userMatches: [], sacked: true, events: [] };
  }
  if (world.seasonOver) {
    return { ok: false, msg: "赛季已结束", days: 0, userMatches: [], events: [] };
  }
  const ready = getNextPlayableMatch(world);
  if (ready && ready.day <= world.day && !ready.played) {
    return {
      ok: false,
      msg: "今天有比赛，请先进入比赛！",
      days: 0,
      userMatches: [ready],
      pendingMatch: ready,
      events: [],
    };
  }

  let days = 0;
  let last = { userMatches: [], events: [] };
  const allEvents = []; // 累积所有事件

  while (days < maxDays && !world.seasonOver && !world.sacked) {
    const target = nextUserMatchDay(world);
    if (target != null && world.day >= target) {
      const m = getNextPlayableMatch(world) || getNextUserMatch(world);
      return {
        ok: true,
        days,
        userMatches: m ? [m] : [],
        pendingMatch: m,
        msg: m ? `比赛日到了（推进 ${days} 天）` : `已推进 ${days} 天`,
        events: allEvents,
      };
    }
    last = advanceDay(world, options);
    if (last.events && last.events.length > 0) {
      allEvents.push(...last.events);
    }
    days += 1;
    if (last.sacked || world.sacked) {
      return {
        ok: false,
        days,
        userMatches: [],
        sacked: true,
        sackedResult: last.sackedResult,
        msg: last.sackedResult?.msg || "你已被解雇",
        events: allEvents,
      };
    }
    if (last.userMatches && last.userMatches.length) {
      return {
        ok: true,
        days,
        userMatches: last.userMatches,
        pendingMatch: last.userMatches[0],
        msg: `推进 ${days} 天，比赛日到了`,
        events: allEvents,
      };
    }
    if (world.seasonOver) {
      return {
        ok: true,
        days,
        userMatches: [],
        msg: `推进 ${days} 天，赛季结束`,
        sacked: !!world.sacked,
        events: allEvents,
      };
    }
  }
  return {
    ok: true,
    days,
    userMatches: last.userMatches || [],
    msg: `已推进 ${days} 天`,
    events: allEvents,
  };
}

export async function advanceToNextMatchDayWithMatchRunner(
  world,
  maxDays = 60,
  options = {},
  matchRunner
) {
  if (world.sacked) {
    return { ok: false, msg: "你已被解雇", days: 0, userMatches: [], sacked: true, events: [] };
  }
  if (world.seasonOver) {
    return { ok: false, msg: "赛季已结束", days: 0, userMatches: [], events: [] };
  }
  const ready = getNextPlayableMatch(world);
  if (ready && ready.day <= world.day && !ready.played) {
    return {
      ok: false,
      msg: "今天有比赛，请先进入比赛！",
      days: 0,
      userMatches: [ready],
      pendingMatch: ready,
      events: [],
    };
  }

  let days = 0;
  let last = { userMatches: [], events: [] };
  const allEvents = [];
  while (days < maxDays && !world.seasonOver && !world.sacked) {
    const target = nextUserMatchDay(world);
    if (target != null && world.day >= target) {
      const match = getNextPlayableMatch(world) || getNextUserMatch(world);
      return {
        ok: true,
        days,
        userMatches: match ? [match] : [],
        pendingMatch: match,
        msg: match ? `比赛日到了（推进 ${days} 天）` : `已推进 ${days} 天`,
        events: allEvents,
      };
    }
    last = await advanceDayWithMatchRunner(world, options, matchRunner);
    if (last.events?.length) allEvents.push(...last.events);
    days += 1;
    if (last.sacked || world.sacked) {
      return {
        ok: false,
        days,
        userMatches: [],
        sacked: true,
        sackedResult: last.sackedResult,
        msg: last.sackedResult?.msg || "你已被解雇",
        events: allEvents,
      };
    }
    if (last.userMatches?.length) {
      return {
        ok: true,
        days,
        userMatches: last.userMatches,
        pendingMatch: last.userMatches[0],
        msg: `推进 ${days} 天，比赛日到了`,
        events: allEvents,
      };
    }
    if (world.seasonOver) {
      return {
        ok: true,
        days,
        userMatches: [],
        msg: `推进 ${days} 天，赛季结束`,
        sacked: !!world.sacked,
        events: allEvents,
      };
    }
  }
  return {
    ok: true,
    days,
    userMatches: last.userMatches || [],
    msg: `已推进 ${days} 天`,
    events: allEvents,
  };
}

/**
 * 推进到赛季末：自动连推，遇到我方比赛日则停下。
 * stopOnUserMatch=true（默认）适合通勤。
 */
export function advanceToSeasonEnd(
  world,
  {
    maxDays = 400,
    stopOnUserMatch = true,
    aiEngineMode,
    aiSimulationProfile,
  } = {}
) {
  if (world.sacked) {
    return { ok: false, msg: "你已被解雇", days: 0, userMatches: [], sacked: true };
  }
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
  const allEvents = []; // 累积事件供界面摘要展示
  while (days < maxDays && !world.seasonOver && !world.sacked) {
    last = advanceDay(world, { aiEngineMode, aiSimulationProfile });
    if (last.events && last.events.length > 0) {
      allEvents.push(...last.events);
    }
    days += 1;
    if (last.sacked || world.sacked) {
      return {
        ok: false,
        days,
        userMatches: [],
        sacked: true,
        sackedResult: last.sackedResult,
        msg: last.sackedResult?.msg || "你已被解雇",
        events: allEvents,
      };
    }
    if (stopOnUserMatch && last.userMatches && last.userMatches.length) {
      return {
        ok: true,
        days,
        userMatches: last.userMatches,
        pendingMatch: last.userMatches[0],
        stoppedForMatch: true,
        msg: `推进 ${days} 天，遇到我方比赛，已停下`,
        events: allEvents,
      };
    }
    if (world.seasonOver) {
      return {
        ok: true,
        days,
        userMatches: [],
        stoppedForMatch: false,
        msg: `推进 ${days} 天，赛季结束`,
        sacked: !!world.sacked,
        events: allEvents,
      };
    }
  }
  return {
    ok: true,
    days,
    userMatches: last.userMatches || [],
    stoppedForMatch: !!(last.userMatches && last.userMatches.length),
    msg: `已推进 ${days} 天（未到赛季末）`,
    events: allEvents,
  };
}

export async function advanceToSeasonEndWithMatchRunner(
  world,
  {
    maxDays = 400,
    stopOnUserMatch = true,
    aiEngineMode,
    aiSimulationProfile,
  } = {},
  matchRunner
) {
  if (world.sacked) {
    return { ok: false, msg: "你已被解雇", days: 0, userMatches: [], sacked: true };
  }
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
  const allEvents = [];
  while (days < maxDays && !world.seasonOver && !world.sacked) {
    last = await advanceDayWithMatchRunner(
      world,
      { aiEngineMode, aiSimulationProfile },
      matchRunner
    );
    if (last.events?.length) allEvents.push(...last.events);
    days += 1;
    if (last.sacked || world.sacked) {
      return {
        ok: false,
        days,
        userMatches: [],
        sacked: true,
        sackedResult: last.sackedResult,
        msg: last.sackedResult?.msg || "你已被解雇",
        events: allEvents,
      };
    }
    if (stopOnUserMatch && last.userMatches?.length) {
      return {
        ok: true,
        days,
        userMatches: last.userMatches,
        pendingMatch: last.userMatches[0],
        stoppedForMatch: true,
        msg: `推进 ${days} 天，遇到我方比赛，已停下`,
        events: allEvents,
      };
    }
    if (world.seasonOver) {
      return {
        ok: true,
        days,
        userMatches: [],
        stoppedForMatch: false,
        msg: `推进 ${days} 天，赛季结束`,
        sacked: !!world.sacked,
        events: allEvents,
      };
    }
  }
  return {
    ok: true,
    days,
    userMatches: last.userMatches || [],
    stoppedForMatch: !!last.userMatches?.length,
    msg: `已推进 ${days} 天（未到赛季末）`,
    events: allEvents,
  };
}

const BACKGROUND_SPATIAL_OPTIONS = Object.freeze({
  aiEngineMode: "spatial",
  aiSimulationProfile: "background",
});

async function runCalendarInBackground(world, action, payload, fallback) {
  try {
    return await runCalendarWorker(world, action, payload);
  } catch (error) {
    // 无 Worker 的旧浏览器仍保持相同空间因果，只是会同步占用主线程。
    console.warn("calendar worker unavailable; using synchronous spatial fallback", error);
    return fallback();
  }
}

/** 浏览器主路径：在 Worker 中用无画面空间模拟推进一天。 */
export function advanceDayAsync(world) {
  return runCalendarInBackground(world, "day", {}, () =>
    advanceDay(world, BACKGROUND_SPATIAL_OPTIONS)
  );
}

/** 浏览器主路径：在 Worker 中推进到下一场用户比赛。 */
export function advanceToNextMatchDayAsync(world, maxDays = 60) {
  return runCalendarInBackground(world, "to-matchday", { maxDays }, () =>
    advanceToNextMatchDay(world, maxDays, BACKGROUND_SPATIAL_OPTIONS)
  );
}

/** 浏览器主路径：在 Worker 中推进赛季，并在用户比赛前停下。 */
export function advanceToSeasonEndAsync(
  world,
  { maxDays = 400, stopOnUserMatch = true } = {}
) {
  return runCalendarInBackground(
    world,
    "to-season-end",
    { maxDays, stopOnUserMatch },
    () =>
      advanceToSeasonEnd(world, {
        maxDays,
        stopOnUserMatch,
        ...BACKGROUND_SPATIAL_OPTIONS,
      })
  );
}

/** 队与队之间转会 */
function transferBetween(world, buyer, seller, player) {
  const idx = seller.players.findIndex((p) => p.id === player.id);
  if (idx < 0) return { ok: false, msg: "球员不存在" };
  if (seller.players.length <= 14) return { ok: false, msg: "卖方阵容过少" };
  if (buyer.players.length >= 25) return { ok: false, msg: "买方阵容已满" };
  if (buyer.finance?.compliance?.transferEmbargo || buyer.finance?.debtPlan?.transferEmbargo) {
    return { ok: false, msg: "买方处于财政转会限制期" };
  }
  const price = Math.round((player.value || estimateValue(player)) * (0.9 + rng() * 0.2));
  const installmentCount = price >= 1_200_000 ? 2 : price >= 400_000 ? 1 : 0;
  const paymentPlan = buildTransferPaymentPlan(price, installmentCount > 0 ? 65 : 100, installmentCount);
  if (clubTransferBudget(world, buyer) < paymentPlan.upfront) {
    return { ok: false, msg: "扣除运营储备和既有分期后资金不足" };
  }
  const transferId = `ai_${world.season}_${world.day}_${player.id}`;
  settleTransferAgreement(world, {
    transferId,
    buyerClubId: buyer.id,
    sellerClubId: seller.id,
    player,
    fee: price,
    upfrontPct: paymentPlan.upfrontPct,
    installmentCount: paymentPlan.installmentCount,
    appearanceBonus: price >= 400_000 ? Math.round(price * 0.06) : 0,
    appearanceTarget: 20,
    sellOnPct: (player.age || 25) <= 23 ? 10 : 0,
    source: "ai-transfer-upfront",
  });
  archiveClubSeasonStats(player, world.season, seller.id, seller.name);
  seller.players.splice(idx, 1);
  player.clubId = buyer.id;
  player.morale = Math.min(100, (player.morale || 70) + 5);
  player.number = null;
  buyer.players.push(player);
  assignSquadNumbers(buyer);
  autoLineup(buyer);
  autoLineup(seller);
  invalidateClubSquadPlan(buyer);
  invalidateClubSquadPlan(seller);
  invalidateDivisionSquadPlans(world, buyer.division);
  if (seller.division !== buyer.division) invalidateDivisionSquadPlans(world, seller.division);
  return { ok: true, price, upfront: paymentPlan.upfront, player };
}

/**
 * AI 转会：窗内约每 3 天；买、卖与年轻球员外租均读取同一份多年阵容计划。
 */
export function processAiTransfers(world) {
  if (world.seasonOver || world.sacked) return [];
  if (!isTransferWindowOpen(world)) return [];
  if (world.day % 3 !== 0) return [];

  const moves = [];
  const clubs = world.clubs.filter((c) => c.id !== world.userClubId);
  const shuffled = clubs.slice().sort(() => rng() - 0.5);
  // 夏窗更活跃。此前这里是全世界每三天 6/3 笔，全年最多百余笔，
  // 明显低于青训提拔、合同流动和退役带来的正常球员流入，市场因此
  // 只能限制继续买人，却没有足够吞吐量把真实冗余送出去。提高的是
  // 市场容量，不是单家俱乐部的购买权限；每家俱乐部在本轮仍最多一笔，
  // 且继续服从位置需求、预算、财政禁令和最低阵容骨架。
  let budgetMoves = getTransferPhase(world) === "summer" ? 18 : 9;

  for (const club of shuffled) {
    if (budgetMoves <= 0) break;
    ensureStaff(club);
    if (club.players.length < 14) continue;
    const seasonPlan = ensureClubSeasonPlan(club, world.clubs, world.season);
    const squadPlan = ensureClubSquadPlan(world, club);

    const avgAge =
      club.players.reduce((s, p) => s + (p.age || 25), 0) / Math.max(1, club.players.length);
    const needCash = club.money < (seasonPlan?.key === "sustainable" ? 1_200_000 : 350_000) || club.players.length >= 26;
    const tooOld = avgAge >= (seasonPlan?.key === "rebuild" ? 27.3 : 29) && club.players.length > 16;

    // 外租：母队确有培养对象，接收方也必须在该位置缺人且能提供现实轮换机会。
    if (chance(seasonPlan?.key === "youth" || seasonPlan?.key === "rebuild" ? 0.24 : 0.12)) {
      const loanPlayer = selectPlannedLoanCandidate(world, club);
      if (loanPlayer) {
        const hosts = clubs
          .filter((host) =>
            host.id !== club.id &&
            !host.finance?.debtPlan?.transferEmbargo &&
            !host.finance?.compliance?.transferEmbargo &&
            host.players.length < 25
          )
          .map((host) => {
            const hostPlan = ensureClubSquadPlan(world, host);
            const positionPlan = squadPositionPlan(hostPlan, loanPlayer.pos);
            return { host, positionPlan };
          })
          .filter(({ positionPlan }) =>
            positionPlan &&
            positionPlan.current < positionPlan.ideal &&
            positionPlan.needScore >= 12 &&
            (loanPlayer.ovr || 0) >= Math.max(6, positionPlan.starterAverage - 2.5)
          )
          .sort((a, b) =>
            b.positionPlan.needScore - a.positionPlan.needScore ||
            a.positionPlan.starterAverage - b.positionPlan.starterAverage
          );
        const host = hosts[0]?.host;
        if (host) {
          const fee = Math.round((loanPlayer.value || estimateValue(loanPlayer) || 100_000) * 0.03);
          const loan = arrangeAiLoan(world, club, host, loanPlayer, {
            term: getTransferPhase(world) === "summer" ? "season" : "half",
            fee,
            wageShare: 0.75,
            announce: chance(0.18),
          });
          if (loan.ok) {
            invalidateClubSquadPlan(club);
            invalidateClubSquadPlan(host);
            invalidateDivisionSquadPlans(world, club.division);
            if (host.division !== club.division) invalidateDivisionSquadPlans(world, host.division);
            moves.push({ ...loan, type: "loan", fromClubId: club.id, toClubId: host.id });
            budgetMoves -= 1;
            continue;
          }
        }
      }
    }

    // 卖：只处理计划明确判定为过剩且不会破坏位置最低骨架的球员。
    // 上限先前的软刹车只是“别买更多”:真正超编时优先松一档上限放冗余走,
    // 只有结构跌破最低骨架时才撤回普通换血线。
    const rescueOverstock = !!selectPlannedOverstockedPosition(world, club);
    if (needCash || tooOld || rescueOverstock || chance(seasonPlan?.key === "sustainable" || seasonPlan?.key === "rebuild" ? 0.24 : 0.15)) {
      const victim = selectPlannedSaleCandidate(world, club, rescueOverstock
        ? (player) => !!(squadPositionPlan(ensureClubSquadPlan(world, club), player.pos) || {}).overstock
        : null);
      if (victim && club.players.length > 15) {
        const buyers = world.clubs
          .filter(
            (c) =>
              c.id !== club.id &&
              c.id !== world.userClubId &&
              c.players.length < 25 &&
              clubTransferBudget(world, c) > (victim.value || 0) * 0.8
          )
          .map((buyer) => {
            const buyerPlan = ensureClubSquadPlan(world, buyer);
            const positionPlan = squadPositionPlan(buyerPlan, victim.pos);
            const review = evaluateRecruitmentCandidate(world, buyer, victim, { plan: buyerPlan });
            return { buyer, positionPlan, review };
          })
          .filter(({ positionPlan }) =>
            positionPlan && positionPlan.current < positionPlan.maximum && positionPlan.needScore >= 8
          )
          .sort((a, b) => {
            return b.positionPlan.needScore - a.positionPlan.needScore ||
              b.review.score - a.review.score ||
              b.buyer.money - a.buyer.money;
          });
        if (buyers.length) {
          const buyer = buyers[0].buyer;
          const res = transferBetween(world, buyer, club, victim);
          if (res.ok) {
            moves.push(res);
            budgetMoves -= 1;
            const involvesUser =
              buyer.id === world.userClubId || club.id === world.userClubId;
            if (involvesUser) {
              world.news.unshift({
                day: world.day,
                text: `🔄 ${buyer.name} 从 ${club.name} 签下 ${victim.name}，费 ${formatMoney(res.price)}`,
              });
              mediaTransfer(world, {
                type: club.id === world.userClubId ? "sell" : "buy",
                playerName: victim.name,
                clubName: buyer.name,
                otherName: club.name,
                feeText: formatMoney(res.price),
              });
            } else if (chance(0.35)) {
              world.news.unshift({
                day: world.day,
                text: `🔄 ${buyer.name} 签下 ${victim.name}（来自 ${club.name}）`,
              });
            }
            continue;
          }
        }

        // 转会市场没有合适买家时，真实的冗余仍有第二条出口：主动解约。
        // 只对规划明确为低顺位、位置超出理想深度的球员执行，并支付剩余
        // 合同补偿；资金不足或会破坏最低骨架时保留球员，等待下一窗口。
        const release = terminatePlayer(world, club, victim);
        if (release.ok) {
          moves.push({
            ...release,
            type: "release",
            clubId: club.id,
            playerId: victim.id,
          });
          budgetMoves -= 1;
          if (chance(0.3)) {
            world.news.unshift({
              day: world.day,
              text: `📝 ${club.name} 与 ${victim.name} 解约，球员进入自由市场`,
            });
          }
          continue;
        }
      }
    }

    // 买：优先解决当前、下季与两年后共同暴露的最高位置风险。
    const transferBudget = clubTransferBudget(world, club);
    if (club.finance?.debtPlan?.transferEmbargo || club.finance?.compliance?.transferEmbargo) continue;
    const needPos = selectPlannedRecruitmentPosition(world, club);
    // 任何位置超编时先停买,优先让窗口清结构再进人。若不限购,``别买更多''
    // 的软刹车挡不住高需求位置的第七人反复被买回。(本循环只遍历 AI 俱乐部,
    // 玩家的阵容增长不受此约束。)
    if (selectPlannedOverstockedPosition(world, club) || club.players.length >= 25) continue;
    if (!needPos || transferBudget < 150000 || needPos === selectPlannedOverstockedPosition(world, club)) continue;

    const minOvr = Math.max(6, Math.floor((club.power || 50) / 8) - 1);
    const candidates = [];
    for (const other of world.clubs) {
      if (other.id === club.id) continue;
      // 用户球员只能通过可处理的正式报价离队，不能被后台 AI 即时卖走。
      if (other.id === world.userClubId) continue;
      // 略偏好同级
      const sameDiv = (other.division || 3) === (club.division || 3);
      const sellerPlan = ensureClubSquadPlan(world, other);
      const sellerPosition = squadPositionPlan(sellerPlan, needPos);
      const detailedNeed = squadPlan?.detailedNeeds?.find((slot) => slot.group === needPos) || null;
      for (const p of other.players) {
        if (positionGroup(p.pos) !== needPos) continue;
        if (other.players.length <= 14) continue;
        if (
          !sellerPosition ||
          sellerPosition.current <= sellerPosition.minimum ||
          sellerPosition.owned <= sellerPosition.minimum
        ) continue;
        const sellerDecision = sellerPlan.playerDecisions?.[p.id];
        if (!["sell", "replace"].includes(sellerDecision?.action)) continue;
        if ((p.ovr || 0) < minOvr) continue;
        if (detailedNeed && positionRating(p, detailedNeed.target) < 8) continue;
        // 别买高龄废柴
        if ((p.age || 0) >= 33 && (p.ovr || 0) < 12) continue;
        const price = (p.value || estimateValue(p)) * (0.9 + rng() * 0.15);
        if (price > transferBudget) continue;
        const review = evaluateRecruitmentCandidate(world, club, p, { plan: squadPlan, seasonPlan });
        const affordability = price / Math.max(150_000, transferBudget);
        const score = review.score + (sameDiv ? 0.5 : 0) - affordability * 3;
        candidates.push({ player: p, club: other, score, price, review });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const pick = candidates[0];
    if (!pick) continue;
    // 挖用户队：窗内更积极
    if (pick.club.id === world.userClubId && !chance(0.55)) continue;

    const res = transferBetween(world, club, pick.club, pick.player);
    if (res.ok) {
      moves.push(res);
      budgetMoves -= 1;
      if (pick.club.id === world.userClubId) {
        world.news.unshift({
          day: world.day,
          text: `⚠️ ${club.name} 挖走了你的 ${pick.player.name}！转会费 ${formatMoney(res.price)}`,
        });
        mediaTransfer(world, {
          type: "sell",
          playerName: pick.player.name,
          clubName: club.name,
          otherName: pick.club.name,
          feeText: formatMoney(res.price),
        });
      } else if (chance(0.28)) {
        world.news.unshift({
          day: world.day,
          text: `🔄 ${club.name} 补强${POS_LABEL[needPos] || needPos}：签下 ${pick.player.name}`,
        });
      }
    }
  }
  return moves;
}


/**
 * 买入球员
 * options: { years?: number, wageMult?: number } 合同谈判
 */
export function buyPlayer(world, playerId, fromClubId, options = {}) {
  if (world.sacked) return { ok: false, msg: "你已被解雇，无法操作转会" };
  const win = assertTransferOpen(world);
  if (!win.ok) return win;

  const user = getUserClub(world);
  if (user.finance?.compliance?.transferEmbargo || user.finance?.debtPlan?.transferEmbargo) {
    return { ok: false, msg: "俱乐部处于财政转会限制期" };
  }
  const from = clubById(world, fromClubId);
  if (!from || from.id === user.id) return { ok: false, msg: "无效的卖家" };
  const idx = from.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return { ok: false, msg: "球员不存在" };
  const player = from.players[idx];
  if (player.loan) return { ok: false, msg: "租借球员不可转会买入（可谈租借）" };
  ensureStaff(user);
  ensureContract(player);
  const price = Math.round(player.value * (1.05 + rng() * 0.15) * scoutBuyMod(user));
  const paymentPlan = buildTransferPaymentPlan(price, options.upfrontPct, options.installmentCount);
  const priceCash = clubCashAvailability(world, user, paymentPlan.upfront);
  if (!priceCash.ok) {
    return {
      ok: false,
      msg: priceCash.reserved > 0
        ? `未承诺现金不足：转会谈判已占用 ${formatMoney(priceCash.reserved)}，本交易首付款需要 ${formatMoney(paymentPlan.upfront)}`
        : `资金不足，需要首付款 ${formatMoney(paymentPlan.upfront)}`,
    };
  }
  if (user.players.length >= 28) return { ok: false, msg: "阵容已满（最多 28 人）" };
  if (from.players.length <= 14) return { ok: false, msg: "对方拒绝出售（阵容过少）" };

  // 合同谈判：年限 1–5，周薪倍率
  let years = options.years != null ? Math.max(1, Math.min(5, +options.years)) : 2 + Math.floor(rng() * 3);
  const wageMult = options.wageMult != null ? Math.max(0.9, Math.min(1.5, +options.wageMult)) : 1.05 + rng() * 0.2;
  // 短约略贵 / 长约略便宜身价已固定；拒签：过低周薪
  if (wageMult < 0.95 && player.ovr >= 14) {
    return { ok: false, msg: `${player.name} 拒绝过低周薪条件` };
  }
  const newWage = Math.max(player.wage || 800, Math.round(estimateWage(player) * wageMult));
  const signingBonus = Math.round(newWage * years * 0.5);
  const dealCash = clubCashAvailability(world, user, paymentPlan.upfront + signingBonus);
  if (!dealCash.ok) {
    return {
      ok: false,
      msg: dealCash.reserved > 0
        ? `未承诺现金不足：转会谈判已占用 ${formatMoney(dealCash.reserved)}，首付款与签约奖需 ${formatMoney(paymentPlan.upfront + signingBonus)}`
        : `资金不足：首付款 ${formatMoney(paymentPlan.upfront)} + 签约奖 ${formatMoney(signingBonus)}`,
    };
  }

  settleTransferAgreement(world, {
    transferId: `legacy_${world.season}_${world.day}_${player.id}`,
    buyerClubId: user.id,
    sellerClubId: from.id,
    player,
    fee: price,
    upfrontPct: paymentPlan.upfrontPct,
    installmentCount: paymentPlan.installmentCount,
    appearanceBonus: options.appearanceBonus,
    appearanceTarget: options.appearanceTarget,
    sellOnPct: options.sellOnPct,
    source: "transfer-upfront",
  });
  recordFinanceEntry(user, -signingBonus, { category: "transfer", source: "signing-bonus", season: world.season, day: world.day });
  from.players.splice(idx, 1);
  player.clubId = user.id;
  player.morale = Math.min(100, player.morale + 8);
  player.number = null; // 新队重新占号
  player.contractYears = years;
  player.wage = newWage;
  player._needsRenew = false;
  player.value = estimateValue(player);
  user.players.push(player);
  assignSquadNumbers(user);
  autoLineup(from);
  autoLineup(user);

  world.news.unshift({
    day: world.day,
    text: `✍️ 转会：签下 ${player.name}（${POS_LABEL[player.pos]}），转会费 ${formatMoney(price)} · ${years} 年合同 · 周薪 ${formatMoney(newWage)}`,
  });
  mediaTransfer(world, {
    type: "buy",
    playerName: player.name,
    clubName: user.name,
    otherName: from.name,
    feeText: formatMoney(price),
  });
  return {
    ok: true,
    msg: `成功签下 ${player.name}：费 ${formatMoney(price)} + 签约奖 ${formatMoney(signingBonus)} · ${years} 年 · 周薪 ${formatMoney(newWage)}`,
    price,
    years,
    wage: newWage,
  };
}

/** 预览买入合同条款（不扣款） */
export function previewBuyDeal(world, playerId, fromClubId, years = 3, wageMult = 1.1) {
  const user = getUserClub(world);
  const from = clubById(world, fromClubId);
  if (!from) return null;
  const player = from.players.find((p) => p.id === playerId);
  if (!player) return null;
  ensureStaff(user);
  ensureContract(player);
  const knownValue = scoutPlayerSnapshot(world, player, user).valueEstimate;
  const price = Math.round(knownValue * 1.08 * scoutBuyMod(user));
  const y = Math.max(1, Math.min(5, +years || 3));
  const wm = Math.max(0.9, Math.min(1.5, +wageMult || 1.1));
  const newWage = Math.max(player.wage || 800, Math.round(estimateWage(player) * wm));
  const signingBonus = Math.round(newWage * y * 0.5);
  return {
    player,
    price,
    years: y,
    wageMult: wm,
    newWage,
    signingBonus,
    total: price + signingBonus,
    report: buildScoutReport(world, player, user),
  };
}

export function sellPlayer(world, playerId, options = {}) {
  if (world.sacked) return { ok: false, msg: "你已被解雇，无法操作转会" };
  const win = assertTransferOpen(world);
  if (!win.ok) return win;

  const user = getUserClub(world);
  const idx = user.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return { ok: false, msg: "球员不在阵中" };
  if (user.players.length <= 14) return { ok: false, msg: "阵容过少，无法再出售" };
  const player = user.players[idx];
  if (player.loan) return { ok: false, msg: "租借球员不可出售" };
  ensureStaff(user);
  const askingFee = Math.max(
    1,
    Math.round(Number(options.askingFee) || player.value * scoutSellMod(user))
  );
  return submitSaleListing(world, playerId, { askingFee });
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

/** 射手榜 / 助攻榜 / 门将榜 / 评分榜；division="all" 时汇总所有国内联赛。 */
export function getStatLeaders(world, division = null) {
  const user = getUserClub(world);
  const div = division === "all" ? null : division != null ? Number(division) : user?.division || 3;
  const clubsById = new Map((world.clubs || []).map((club) => [club.id, club]));
  const all = allPlayersWithClub(world, null)
    .map((entry) => {
      const { player, club } = entry;
      ensureLeagueStats(player, club.division, club.id);
      const stats = div == null ? player.stats : player.leagueStats?.[String(div)];
      if (!stats) return null;
      const statClub = stats.clubId ? clubsById.get(stats.clubId) || club : club;
      return { player, club: statClub, stats };
    })
    .filter(Boolean);

  const goals = [...all]
    .filter((x) => x.stats.goals > 0)
    .sort(
      (a, b) =>
        b.stats.goals - a.stats.goals ||
        b.stats.assists - a.stats.assists ||
        b.player.ovr - a.player.ovr
    )
    .slice(0, 20);

  const assists = [...all]
    .filter((x) => x.stats.assists > 0)
    .sort(
      (a, b) =>
        b.stats.assists - a.stats.assists ||
        b.stats.goals - a.stats.goals ||
        b.player.ovr - a.player.ovr
    )
    .slice(0, 20);

  // 门将：至少出场 1 次；优先零封，再看出场，再看失球少
  const keepers = all
    .filter((x) => x.player.pos === "GK" && x.stats.apps > 0)
    .map((x) => {
      const s = x.stats;
      const gaPerGame = s.apps ? s.goalsConceded / s.apps : 99;
      return { ...x, gaPerGame };
    })
    .sort(
      (a, b) =>
        b.stats.cleanSheets - a.stats.cleanSheets ||
        a.gaPerGame - b.gaPerGame ||
        b.stats.apps - a.stats.apps
    )
    .slice(0, 15);

  // 场均评分：至少 10 场（联赛 34 轮，10 场 ≈ 赛季 30%）。
  //
  // ⚠ 门槛定值依据（不是拍脑袋，见 `docs/` 记的量化）：
  //   评分公式（`match.js` 的 `applyMatchRatings`）由**进球驱动** ——
  //   基础 6.4 + 进球×0.95 + 助攻×0.55，单场封顶 9.6。
  //   而进球是**小概率事件**，于是「场均分」的方差随出场数**急剧下降**：
  //     踢 3 场的前锋，场均 ≥ 8.0 的概率 1.01%；踢 20 场的只有 0.00%。
  //   ⇒ 门槛低时，榜单前排会被「蒙进几个球的替补」占满。实测（进球驱动模型，
  //     18 队 × 12 人档，蒙特卡洛 4000 批）：
  //       门槛 3  → 前 20 名里平均 7.82 人出场 ≤5 场，榜首平均只出场 4.1 次；
  //       门槛 8  → ≤5 场的人清零，但仍混入 2.67 个 ≤8 场的；
  //       门槛 10 → ≤5 场与 ≤8 场均为 0，榜首平均出场 15.3 次（像个真主力）。
  //   故取 10。提高门槛只是**把不合资格的样本挡在外面**，
  //   不改评分公式本身 —— 这是改动面最小的修法（用户 2026-09-19 拍板）。
  const ratings = all
    .map((x) => {
      const s = x.stats || {};
      const apps = s.apps || 0;
      const avg =
        apps > 0 && s.ratingSum > 0
          ? Math.round((s.ratingSum / apps) * 10) / 10
          : null;
      return {
        ...x,
        avgRating: avg,
        lastRating: s.lastRating ?? null,
        apps,
      };
    })
    .filter((x) => x.avgRating != null && x.apps >= 10)
    .sort(
      (a, b) =>
        b.avgRating - a.avgRating ||
        b.apps - a.apps ||
        b.player.ovr - a.player.ovr
    )
    .slice(0, 20);

  return { goals, assists, keepers, ratings };
}

export function refreshStaffMarketForUser(world) {
  return refreshStaffMarket(world, 12);
}

export function hireStaffForUser(world, candidateId) {
  const user = getUserClub(world);
  ensureStaff(user);
  ensureWorldStaff(world);
  const cand = (world.staffMarket || []).find((s) => s.id === candidateId);
  if (!cand) return { ok: false, msg: "自由身候选人不存在，请刷新市场" };
  const res = hireStaff(world, user, cand);
  if (res.ok) {
    world.news.unshift({
      day: world.day,
      text: `👔 职员：${res.msg}`,
    });
  }
  return res;
}

/** 接触他队在职职员或（备用）自由身 */
export function approachStaffForUser(world, staffId, fromClubId = null) {
  const user = getUserClub(world);
  if (!user) return { ok: false, msg: "无俱乐部" };
  const res = approachStaff(world, user.id, staffId, fromClubId);
  return res;
}

export function respondStaffApproachForUser(world, approachId, accept) {
  return resolveStaffApproach(world, approachId, accept);
}

export function fireStaffForUser(world, role) {
  const user = getUserClub(world);
  const res = fireStaff(world, user, role);
  if (res.ok) {
    world.news.unshift({
      day: world.day,
      text: `👔 ${res.msg}`,
    });
  }
  return res;
}

export {
  ensureStaff,
  ensureWorldStaff,
  ROLES,
  ensureIntl,
  ensureHonors,
  listApproachableStaff,
  pendingStaffApproaches,
  staffCompensationFee,
  staffSigningFee,
  approachStaff,
  staffTargetRating,
  processStaffMarketDay,
  processStaffContractsEndOfSeason,
  refreshStaffMarket,
};

/** 球探模糊估值区间（对方球员） */
export function scoutValueRange(world, player) {
  const user = getUserClub(world);
  ensureStaff(user);
  const snapshot = scoutPlayerSnapshot(world, player, user);
  const center = Math.max(1, snapshot.valueEstimate);
  const err = Math.max(0, (snapshot.valueHi - snapshot.valueLo) / (center * 2));
  return {
    lo: snapshot.valueLo,
    hi: snapshot.valueHi,
    err,
    rating: staffRatingSafe(user, "scout"),
    confidence: snapshot.confidence,
  };
}

export function formatScoutValue(world, player) {
  const { lo, hi } = scoutValueRange(world, player);
  return formatMoney(lo) + "–" + formatMoney(hi);
}

export function formatScoutOvr(world, player) {
  const user = getUserClub(world);
  ensureStaff(user);
  return scoutPlayerSnapshot(world, player, user)?.ovrText || "-";
}

export function getMarketPlayers(world, posFilter = "") {
  const user = getUserClub(world);
  const list = [];
  for (const club of world.clubs) {
    if (club.id === user.id) continue;
    for (const p of club.players) {
      if (posFilter && p.pos !== posFilter) continue;
      // 只挂牌部分球员：非绝对主力
      list.push({ player: p, club, scouting: scoutPlayerSnapshot(world, p, user) });
    }
  }
  list.sort(
    (a, b) =>
      b.scouting.ovrEstimate - a.scouting.ovrEstimate ||
      b.scouting.potentialEstimate - a.scouting.potentialEstimate ||
      String(a.player.id).localeCompare(String(b.player.id))
  );
  return list.slice(0, 40);
}

/*
 * P6 清理：simulateMatchLive（v1 逐分钟直播包装）已删除——
 * 用户直播由 main.js 直调 playFirstHalf/continueSecondHalf（v2 空间模拟录帧投影）。
 */

export { FORMATIONS, formatMoney, playerOverall, estimateValue };
