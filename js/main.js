/** VCFM · UI 主逻辑 */

import {
  CLUB_TEMPLATES,
  clubBrandingById,
  FORMATIONS,
  FORMATION_MOD,
  POS_LABEL,
  NATIONALITIES,
  NATIONAL_TEAM_KITS,
  DIVISIONS,
  DIVISION_IDS,
  START_DIVISION,
  START_DIVISIONS,
  COUNTRY_LIST,
  playerDisplaySurname,
  TACTIC_PRESETS,
  tacticsSliderLabel,
  STYLE_MOD,
  PLAYER_ROLES,
  roleLabel,
  roleShort,
  TEAM_TALKS,
  TEAM_TALK_IDS,
  teamTalkLabel,
  teamTalkDesc,
} from "./data.js";
import { ensureMedia, mediaSeasonKickoff } from "./media.js";
import { ensureDistinctClubPlayerNames } from "./models.js";
import {
  nextDisplayedMinute,
  PENALTY_SETUP_SEC,
  eventTickerMs,
} from "./match-presentation.js";
import { t, initPrefs, getLang } from "./i18n.js";
import { ensurePlayerInjury, injuryLabel } from "./injuries.js";
import {
  positionSummary,
  positionCoverage,
  positionLabel as detailedPositionLabel,
  slotPositionCode,
} from "./player-positions.js";
import {
  PLAYER_DUTIES,
  dutyLabel,
  dutyShort,
  roleDescription,
  roleDetail,
  roleSuitability,
  rolesForDetailedPosition,
} from "./player-roles.js";
import { teamShapeSummary } from "./team-shapes.js";
import {
  availableHabitTraining,
  cancelHabitTraining,
  habitDescription,
  habitLabel,
  startHabitTraining,
} from "./player-habits.js";
import { nationFlagHtml } from "./flags.js?v=286";
import { clubCrestHtml } from "./club-crest.js?v=286";
import { applyWorldClubBranding, localizedClubName } from "./branding.js";
import { recordFinanceEntry } from "./finance-ledger.js";
import { renderFinance as renderFinanceView } from "./ui/finance.js";
import { renderFacilities as renderFacilitiesView } from "./ui/facilities.js";
import { renderMedia as renderMediaView } from "./ui/media.js";
import { renderManagerWorkbench } from "./ui/manager-workbench.js";
import {
  setLinkWorldSource,
  clubLinkHtml,
  playerLinkHtml,
  clubDisplayName,
  clubDisplayShortName,
} from "./ui/links.js";
import {
  renderTable as renderTableView,
  renderStats as renderStatsView,
} from "./ui/league-centre.js";
import { clubSeasonBudgetSnapshot, updateClubFinanceBudget } from "./club-finance.js";
import { clubCashAvailability } from "./cash-reservations.js";
import { buildTransferPaymentPlan } from "./finance-obligations.js";
import { acceptSponsorshipOffer } from "./sponsorships.js";
import {
  repayClubFinancing,
  requestClubFinancing,
} from "./club-debt.js";
import {
  ensureCompetitions,
  sortedContinentalTable,
  continentalPlayerLeaders,
} from "./cup.js";

function clubNameById(clubId, fallback = "—") {
  const club = world?.clubs?.find((item) => item.id === clubId);
  return club ? clubDisplayName(club) : fallback;
}

function positionLabel(pos) {
  return getLang() === "en" ? pos || "—" : POS_LABEL[pos] || pos || "—";
}

function nationLabel(p) {
  if (p.nationality) {
    const n = NATIONALITIES.find((x) => x.code === p.nationality);
    if (n) return `${nationFlagHtml(n.code)}${getLang() === "en" ? n.nameEn || n.name : n.name}`;
  }
  if (p.nationFlag && p.nationName) {
    return `${p.nationFlag} ${getLang() === "en" ? p.nationNameEn || p.nationName : p.nationName}`;
  }
  return "—";
}

function preferredFootLabel(foot, en = getLang() === "en") {
  if (foot === "left") return en ? "Left" : "左脚";
  if (foot === "both") return en ? "Both" : "双脚";
  return en ? "Right" : "右脚";
}
import {
  createWorld,
  autoLineup,
  getLineupPlayers,
  formatMoney,
  playerOverall,
  ensureYouthAcademy,
  fillYouthSquad,
  ensurePlayerHistory,
  ensureRealisticPlayerTalent,
  ensurePlayerAttributeProfile,
  ensureFootballProfile,
  calibrateWorldAbilityDistribution,
  ABILITY_DISTRIBUTION_VERSION,
  emptyMatchStats,
  seasonAvgRating,
  ratingClass,
  formatRating,
  playerForm,
  formClass,
  formatForm,
  formToneLabel,
  YOUTH_LEVELS,
  YOUTH_UPGRADE_COST,
  ensureKit,
  ensureTactics,
  getCorePlayerId,
  setCorePlayerId,
  getCaptainId,
  setCaptainId,
  getSetPieceTakerId,
  setSetPieceTakerId,
  ensureLineupResponsibilities,
  assignSquadNumbers,
  kitBackground,
  ensurePlayerNumber,
  numberPreferenceLabel,
  swapLineupSlots,
  setLineupSlot,
  ensureLineupRoles,
  ensureMatchLineup,
  setSlotRole,
  getSlotRole,
  setSlotDuty,
  getSlotDuty,
  teamRoleMods,
} from "./models.js";
import {
  advanceDay,
  advanceDayAsync,
  advanceToNextMatchDayAsync,
  advanceToSeasonEndAsync,
  simulateMatch,
  createMatchSession,
  playFirstHalf,
  continueSecondHalf,
  applySubstitution,
  applyLiveTactics,
  getHalfTimeTips,
  applyTeamTalk,
  applyManagedTeamTalk,
  suggestHalfTimeTalk,
  buildRoleReview,
  getBenchPlayers,
  getOnFieldPlayers,
  ensureFixtureWeather,
  isDerby,
  isBigMatch,
  getSortedTable,
  getUserClub,
  getNextUserMatch,
  sellPlayer,
  getMarketPlayers,
  renewUserPlayer,
  terminateUserPlayer,
  previewTerminate,
  previewRenew,
  needsContractAttention,
  loanOutPlayer,
  loanInPlayer,
  recallLoan,
  listUserLoans,
  previewLoanOut,
  previewLoanIn,
  isOnLoan,
  promoteYouth,
  releaseYouth,
  upgradeYouthAcademy,
  startFacilityUpgrade,
  ensureFacilities,
  ensureWorldFinances,
  autoRegisterClub,
  availableRegistrationContexts,
  developmentStatus,
  eligiblePlayerIds,
  ensureWorldRegistrations,
  playerCompetitionEligibility,
  registrationSummary,
  setPlayerRegistered,
  facilitySummaryLine,
  isBuilding,
  getProject,
  startNextSeason,
  ensureStaff,
  ensureWorldStaff,
  ROLES,
  refreshStaffMarket,
  hireStaffForUser,
  fireStaffForUser,
  approachStaffForUser,
  respondStaffApproachForUser,
  listApproachableStaff,
  pendingStaffApproaches,
  staffCompensationFee,
  staffSigningFee,
  ensureIntl,
  ensureHonors,
  scoutValueRange,
  formatScoutValue,
  formatScoutOvr,
  ensureTraining,
  setTraining,
  trainingSummary,
  assistantTrainingPlan,
  TRAINING_FOCUSES,
  TRAINING_INTENSITIES,
  ensureTransferWindow,
  isTransferWindowOpen,
  transferWindowLabel,
  transferWindowShort,
  processTransferWindowDay,
  ensureActiveCareer,
  managerWinRate,
  ensureManagerJob,
  enterUnemployment,
  resignManagership,
  acceptJobOffer,
  rejectJobOffer,
  pendingJobOffers,
  generateJobOffers,
  managerReputation,
  reputationTierLabel,
  resignCooldownLeft,
  ensureClubHonors,
  acceptPoachBid,
  rejectPoachBid,
  pendingPoachBids,
  ensureInbox,
  listInbox,
  pendingInboxCount,
  resolveInboxAction,
  markInboxRead,
  syncPoachBidsToInbox,
  syncDealNegotiationsToInbox,
  syncTransferNegotiationsToInbox,
  inboxCatLabel,
  findActiveSaleNegotiation,
  findActiveTransferNegotiation,
  listTransferNegotiations,
  respondTransferNegotiation,
  submitTransferNegotiation,
  findActiveDealNegotiation,
  listDealNegotiations,
  respondDealNegotiation,
  clubAtmosphere,
  atmosphereLabel,
  relationLabel,
  ensureSquadRelations,
  ensurePlayerRelation,
  applyPlayerTalk,
  dressingRoomLeaders,
  dressingRoomFactions,
  dressingRoomFrictions,
  dressingRoomHarmony,
  harmonyLabel,
  ensurePlayerPathway,
  ensureDevelopmentStats,
  setPlayingTimeRole,
  playingTimeProgress,
  playingTimeRoleLabel,
  playerDevelopmentTimeline,
  developmentAttrLabel,
  developmentSharpness,
  PLAYING_TIME_ROLES,
  financeSnapshot,
  startScoutMission,
  ensureScoutMissions,
  checkManagerBadges,
  buildScoutReport,
  formatScoutReportHtml,
  buildOpponentReport,
  formatOpponentReportHtml,
  opponentReportLogLines,
  scoutAttrRows,
  formatScoutOvrFog,
  formatScoutPotFog,
  ensureScoutingKnowledge,
  scoutPlayerSnapshot,
  scoutingFreshnessLabel,
  previewBuyDeal,
  ensureDiscipline,
  isAvailable,
} from "./engine.js";
import {
  ensureClubSquadPlan,
  selectPlannedSaleCandidate,
  squadPlayerPlan,
  squadPositionPlan,
} from "./squad-planning.js?v=286";
import {
  TRAINING_MODES,
  ensureTrainingBoost,
  setTrainingMode,
} from "./training-boost.js";
import {
  applyDelegatedLineup,
  applyDelegatedTactics,
  applyDelegatedTraining,
  ensureDelegation,
  ensureWorldDelegation,
  isFullyDelegated,
  setManagementMode,
  shouldStaffHandleMatchday,
} from "./delegation.js";
import {
  coachIdentityFacts,
  coachIdentitySummary,
  ensureCoachIdentity,
  managerReviewLabel,
} from "./manager-ecosystem.js";
import {
  ensureInternational,
  listInternationalCompetitions,
  internationalMatches,
  internationalTable,
  internationalLeaders,
  listNationalTeams,
  nationalSquad,
  nationalRecords,
  emptyNationRow,
  nationalCompetitionStats,
  nationName,
} from "./intl.js";
import {
  buildPreMatchBriefing,
  briefingLogLines,
  suspensionSummary,
} from "./discipline.js";
import {
  saveGame,
  loadGame,
  hasSave,
  hasAnySave,
  listSlots,
  getActiveSlot,
  setActiveSlot,
  formatSlotLabel,
  SLOT_COUNT,
  exportSaveDownload,
  importSaveText,
  initializeSaveStorage,
  migrateLegacySave,
  clearSave,
} from "./save.js";
import { migrateSaveSchema } from "./save-schema.js";
import {
  ensureBoardObjective,
  boardStatusLine,
  boardTone,
} from "./board.js";
import {
  playerAvatarHtml,
  staffAvatarHtml,
  avatarHtml,
  hydrateAvatarKitRecolor,
} from "./avatar.js?v=286";
import { attributeArchetypeLabel } from "./player-attributes.js";
import {
  MANAGER_ONBOARDING_TAB_STEPS,
  completeManagerOnboardingStep,
  dismissManagerOnboarding,
  ensureManagerOnboarding,
  managerOnboardingView,
} from "./manager-onboarding.js";

/** DOM 更新后对齐正式肖像球衣主色（debounced） */
let _avatarHydrateTimer = 0;
function scheduleAvatarHydrate(root) {
  if (typeof document === "undefined") return;
  clearTimeout(_avatarHydrateTimer);
  _avatarHydrateTimer = setTimeout(() => {
    try {
      hydrateAvatarKitRecolor(root || document);
    } catch {
      /* ignore */
    }
  }, 0);
}
if (typeof document !== "undefined" && typeof MutationObserver === "function") {
  const bootHydrate = () => {
    const app = document.getElementById("app") || document.body;
    if (!app) return;
    scheduleAvatarHydrate(app);
    const mo = new MutationObserver(() => scheduleAvatarHydrate(app));
    mo.observe(app, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootHydrate, { once: true });
  } else {
    bootHydrate();
  }
}

/** 解雇/离职后：进入待业并展示工作邀请（可再就业，不必强制新开档） */
function handleSacked(result) {
  if (!result || !result.sacked) return false;
  if (!world) return false;
  try {
    ensureManagerJob(world);
    if (world.managerJob.status !== "unemployed" || !pendingJobOffers(world).length) {
      enterUnemployment(world, result.msg || world.sackedReason || "被董事会解雇", {
        fromSack: true,
      });
    }
  } catch (err) {
    console.warn(err);
  }
  autosave("sacked");
  const reason =
    result.msg || result.sackedResult?.msg || world?.sackedReason || "你已被董事会解雇。";
  const offers = pendingJobOffers(world) || [];
  const offerLines = offers
    .slice(0, 4)
    .map(
      (o, i) =>
        `${i + 1}. ${o.clubName}（${o.divName || ""}）· 周薪约 ${formatMoney(o.wage)}`
    )
    .join("\n");
  alert(
    `${reason}\n\n你已进入经理市场（待业）。可在「生涯」页查看并接受工作邀请，或回开始菜单开新档。\n\n当前邀请：\n${
      offerLines || "（正在匹配俱乐部…可推进日程等待新邀请）"
    }`
  );
  // 留在主界面生涯页，便于接受邀请；不再清空 world
  showScreen("main");
  enterMain();
  try {
    document.querySelector('[data-tab="career"]')?.click();
  } catch (_) {
    /* ignore */
  }
  renderCareerJobs();
  toast(getLang() === "en" ? "Unemployed — check Career for job offers" : "已待业 — 请到生涯页查看工作邀请");
  return true;
}

let world = null;
// 共享链接工具按需读取当前世界；传取值函数而非 world 本身，读档替换后自动跟随
setLinkWorldSource(() => world);
let pendingMatch = null;
/** 最近一次日期推进的关键变化，只属于当前运行会话，不写入存档 */
let dashboardAdvanceDigest = null;
let liveRunning = false;
/** @type {import('./match.js').createMatchSession extends Function ? any : any} */
let matchState = null;
let pendingSubs = []; // 中场待确认换人 {outId, inId, outName, inName}
/** 赛前队内讲话 id（默认鼓励） */
let selectedPreTalk = "encourage";
/** @type {import('./matchview.js').MatchView | null} */
let matchView = null;
let matchViewApi = null;
let matchViewModulePromise = null;
// ---------- 重开直播的进度记账（只服务提示，不参与播放逻辑） ----------
/** 上一场直播看到的进度。只用来「提醒用户重开会从 0′ 重演」，不参与播放逻辑。
 *  用 sessionStorage：刷新（F5）后仍在 —— 那正是用户走的那条路；关标签页即失效，
 *  不会把陈旧进度带到别的存档里。记账键含赛季/天/场次，换场次自然不匹配。 */
const MATCH_PROGRESS_KEY = "vcfm-match-progress";

/** 记账键：赛季 + 天数 + 场次 id ⇒ 换天/换场次自然不匹配，不会张冠李戴。 */
function matchProgressKey(fixture) {
  return `${world?.season}:${world?.day}:${fixture?.id ?? ""}`;
}

/** @returns {null | { key: string, minute: number, at: number }} 读不到或坏 JSON 都返回 null */
function readMatchProgress() {
  try {
    const raw = sessionStorage.getItem(MATCH_PROGRESS_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec && typeof rec === "object" ? rec : null;
  } catch (_) {
    /* 隐私模式 / 坏 JSON：当作没有记录，不能因此打断进比赛 */
    return null;
  }
}

/** @returns {boolean} 是否写入成功（配额或隐私模式失败时为 false） */
function writeMatchProgress(rec) {
  try {
    sessionStorage.setItem(MATCH_PROGRESS_KEY, JSON.stringify(rec));
    return true;
  } catch (_) {
    /* 存不下只是少一次提醒，绝不能影响比赛 */
    return false;
  }
}

/** 已写入的 { key, minute, simT }。直播时 `refreshLiveHudFromState` 每帧都会调 `setMatchMinute`，
 *  而 sessionStorage 是同步 API ⇒ 不去重就是每帧一次写盘；去重后每场只写 ~90 次。 */
let lastMatchProgressWrite = { key: "", minute: 0, simT: null };

function clearMatchProgress() {
  lastMatchProgressWrite = { key: "", minute: 0, simT: null };
  try {
    sessionStorage.removeItem(MATCH_PROGRESS_KEY);
  } catch (_) {
    /* ignore */
  }
}

// ---------- ④-B 续播（真正的「继续看」） ----------
/**
 * 续播点（模拟秒）。非 null 时，`playHighlightPlanBridge` 对 `t1 ≤ 它的段`
 * **只记账、不渲染** —— 复用现成的 skip 路径（`spec.onSkip` + `refreshLiveHudFromState`）。
 *
 * 为什么可行：`js/match.js` 的 `simulatePeriodWithSim` 把**渲染**交给
 * `opts.playHighlightPlan`，之后有一段兜底循环 flush 全部剩余线索并逐分钟跑
 * `finishMinuteSideEffects` ⇒ **一个段都不渲染也不会丢进球 / 体能 / 事件**。
 *
 * ⚠ 跨半场：`playFirstHalf`（fromMin=1）与 `playSecondHalf`（46/61/76）是两次独立调用，
 *   桥接器因此被调 4 次。若续播点在 H2，H1 的段**全部**被跳过 ⇒ 不会渲染 ⇒ 本变量
 *   保持非 null 一直带到 H2，正好继续跳过 46′ 之前的段。中途会停在**中场面板**
 *   等一次确认（用户可顺手调整战术）—— 这是有意的，弹窗文案里已说明。
 */
let matchResumeSimT = null;
/** 续播点的顶栏分钟，只用于文案。 */
let matchResumeMinute = 0;
/** 续播横幅只弹一次。 */
let matchResumeBannerShown = false;

/** 清掉续播意图（进比赛界面 / 完场时调，避免影响下一场）。 */
function clearMatchResume() {
  matchResumeSimT = null;
  matchResumeMinute = 0;
  matchResumeBannerShown = false;
}

function loadMatchViewModule() {
  if (!matchViewModulePromise) {
  matchViewModulePromise = import("./matchview.js?v=286").then((module) => {
      matchViewApi = module;
      return module;
    });
  }
  return matchViewModulePromise;
}

function destroyLoadedMatchView() {
  matchViewApi?.destroyMatchView?.();
}

/** 比赛播放控制：暂停 / 逐事件 + 进球回看缓存 */
const matchPlayback = {
  paused: false,
  stepMode: false,
  waitingStep: false,
  /** @type {null | (() => void)} */
  stepResolve: null,
  /** 赛中可操作暂停/下一步 */
  controlsEnabled: false,
  /** @type {{ ev: object, snap: object, fixture: object }[]} */
  goals: [],
  /** 赛后回看进行中，防止连点 */
  replaying: false,
  /** 进球后待自动 FMM 重播（高光段结束后执行） */
  pendingGoalReplay: null,
  /** 从赛程打开旧战报（只读，不结算） */
  reviewMode: false,
};

function resetMatchPlayback({ keepStepMode = true } = {}) {
  if (matchPlayback.stepResolve) {
    try {
      matchPlayback.stepResolve();
    } catch (_) {
      /* ignore */
    }
  }
  matchPlayback.paused = false;
  if (matchView?.setFrozen) matchView.setFrozen(false);
  if (!keepStepMode) matchPlayback.stepMode = false;
  matchPlayback.waitingStep = false;
  matchPlayback.stepResolve = null;
  matchPlayback.controlsEnabled = false;
  matchPlayback.goals = [];
  matchPlayback.replaying = false;
  matchPlayback.pendingGoalReplay = null;
  matchPlayback.reviewMode = false;
  updateMatchPlaybackUI();
}

function updateMatchPlaybackUI() {
  const pauseBtn = $("#btn-match-pause");
  const stepBtn = $("#btn-match-step");
  const modeBtn = $("#btn-match-step-mode");
  const en = !!matchPlayback.controlsEnabled;
  if (pauseBtn) {
    pauseBtn.disabled = !en;
    pauseBtn.classList.toggle("active", matchPlayback.paused);
    // 图标按钮：文字走 title/aria-label，避免覆盖 .mtb-glyph
    const label = matchPlayback.paused ? t("match.resume") : t("match.pause");
    pauseBtn.title = label;
    pauseBtn.setAttribute("aria-label", label);
    const glyph = pauseBtn.querySelector(".mtb-glyph");
    if (glyph) glyph.textContent = matchPlayback.paused ? "▶" : "⏸";
  }
  if (stepBtn) {
    // 暂停中 或 逐事件等待时，可点「下一步」
    stepBtn.disabled = !en || (!matchPlayback.paused && !matchPlayback.waitingStep && !matchPlayback.stepMode);
    stepBtn.classList.toggle("active", matchPlayback.waitingStep);
  }
  if (modeBtn) {
    modeBtn.classList.toggle("active", matchPlayback.stepMode);
    modeBtn.setAttribute("aria-pressed", matchPlayback.stepMode ? "true" : "false");
    const modeLabel = t("match.stepMode");
    modeBtn.setAttribute("aria-label", modeLabel);
  }
  updateMatchSfxUI();
}

/** 可被暂停打断的等待；逐事件模式下结束后再等用户点「下一步」 */
async function sleepPlayback(ms) {
  const total = Math.max(0, Number(ms) || 0);
  const end = performance.now() + total;
  while (performance.now() < end) {
    while (matchPlayback.paused) {
      updateMatchPlaybackUI();
      await sleep(40);
    }
    const left = end - performance.now();
    if (left <= 0) break;
    await sleep(Math.min(50, left));
  }
  if (matchPlayback.stepMode && matchPlayback.controlsEnabled) {
    await waitForMatchStep();
  }
}

function waitForMatchStep() {
  if (matchPlayback.stepResolve) {
    // 已在等，复用
    return new Promise((r) => {
      const prev = matchPlayback.stepResolve;
      matchPlayback.stepResolve = () => {
        prev();
        r();
      };
    });
  }
  matchPlayback.waitingStep = true;
  updateMatchPlaybackUI();
  return new Promise((resolve) => {
    matchPlayback.stepResolve = () => {
      matchPlayback.waitingStep = false;
      matchPlayback.stepResolve = null;
      // 点下一步时顺便解除暂停，避免卡死
      matchPlayback.paused = false;
      if (matchView?.setFrozen) matchView.setFrozen(false);
      updateMatchPlaybackUI();
      resolve();
    };
  });
}

function requestMatchStep() {
  if (matchPlayback.stepResolve) {
    matchPlayback.stepResolve();
    return;
  }
  // 暂停中但还没进入 wait：解除暂停让 sleep 继续，并进入一步
  if (matchPlayback.paused) {
    matchPlayback.paused = false;
    if (matchView?.setFrozen) matchView.setFrozen(false);
    updateMatchPlaybackUI();
  }
}

function toggleMatchPause() {
  if (!matchPlayback.controlsEnabled) return;
  matchPlayback.paused = !matchPlayback.paused;
  // 冻结球场 AI（保留站位，区别于 HT/FT 钉回阵型）
  if (matchView?.setFrozen) matchView.setFrozen(matchPlayback.paused);
  if (!matchPlayback.paused && matchPlayback.stepResolve && !matchPlayback.stepMode) {
    // 继续播放：若卡在逐步等待且非逐步模式，放行
    matchPlayback.stepResolve();
  }
  updateMatchPlaybackUI();
  toast(
    matchPlayback.paused
      ? getLang() === "en"
        ? "Paused"
        : "已暂停"
      : getLang() === "en"
        ? "Resumed"
        : "继续比赛"
  );
}

function toggleMatchStepMode() {
  matchPlayback.stepMode = !matchPlayback.stepMode;
  updateMatchPlaybackUI();
  toast(
    matchPlayback.stepMode
      ? t("match.stepModeOn")
      : t("match.stepModeOff")
  );
  // 关掉逐事件时若正在等下一步，放行
  if (!matchPlayback.stepMode && matchPlayback.stepResolve) {
    matchPlayback.stepResolve();
  }
}

function toggleMatchSfx() {
  const muted = matchView?.isSfxMuted?.() ?? localStorage.getItem("vcfm_sfx_muted") === "1";
  const next = !muted;
  if (matchView?.setSfxMuted) matchView.setSfxMuted(next);
  else {
    try {
      localStorage.setItem("vcfm_sfx_muted", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  updateMatchSfxUI();
  toast(
    next
      ? getLang() === "en"
        ? "SFX off"
        : "音效已关"
      : getLang() === "en"
        ? "SFX on"
        : "音效已开"
  );
  // 开音时轻响一声确认
  if (!next && matchView?.playSfx) matchView.playSfx("whistle");
}

function updateMatchSfxUI() {
  const btn = $("#btn-match-sfx");
  if (!btn) return;
  let muted = false;
  try {
    muted =
      matchView?.isSfxMuted?.() ?? localStorage.getItem("vcfm_sfx_muted") === "1";
  } catch {
    muted = false;
  }
  btn.classList.toggle("active", !muted);
  btn.classList.toggle("is-muted", !!muted);
  btn.setAttribute("aria-pressed", muted ? "false" : "true");
  const label = muted
    ? getLang() === "en"
      ? "SFX off"
      : "静音"
    : t("match.sfx") || (getLang() === "en" ? "SFX" : "音效");
  btn.title = label;
  btn.setAttribute("aria-label", label);
  const glyph = btn.querySelector(".mtb-glyph");
  if (glyph) glyph.textContent = muted ? "🔇" : "🔊";
}

/* ============================================================
   全屏观赛（2026-09-20）
   ------------------------------------------------------------
   为什么需要：手机横持时视口高只有 ~390px，浏览器工具栏（地址栏/导航栏）
   还要吃掉 ~95px ⇒ `100dvh ≈ 295px`。球场按 contain 只能拿到
   「295 − 控制条」的高度。进全屏后工具栏消失，`dvh` 直接等于屏幕高
   ⇒ 球场多出近 1/4 高度。**这才是「手机横屏看比赛还是太小」的根因**，
   不是 CSS 没调好——再怎么调 padding 也补不回那 95px。

   支持面（2026-09 查证，见 docs/measurements/mobile-fullscreen-2026-09-20.txt）：
   - ✅ Android Chrome/Edge、桌面 Chrome/Edge/Firefox、iPadOS Safari
   - ❌ **iPhone Safari 不支持任意元素全屏**（只有 <video> 能全屏）。
     ⇒ `document.fullscreenEnabled` 为假时按钮保持 `hidden`：
       宁可没有按钮，也不要给一个点了没反应的按钮。

   ⚠ 故意**不做** `screen.orientation.lock("landscape")`：那会把竖持的手机
     强行转过去，属于「用户没要求的动作」，且锁屏方向在部分系统上会失败。
     竖持进全屏时页面本来就会显示「请横持手机」提示，用户自己转过去即可。
   ============================================================ */
function fullscreenSupported() {
  try {
    const el = document.documentElement;
    return !!(
      document.fullscreenEnabled &&
      (el.requestFullscreen || el.webkitRequestFullscreen)
    );
  } catch {
    return false;
  }
}

function currentFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

/**
 * 全屏按钮的显隐 / 文案 / 高亮。
 * ⚠ 全部由**真实全屏状态**推导，不维护本地布尔标志位 ——
 *   用户按 Esc、系统返回手势、切后台都可能退出全屏，本地标志位会失真。
 */
function syncFullscreenUI() {
  const btn = $("#btn-match-fullscreen");
  if (!btn) return;
  if (!fullscreenSupported()) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  const on = !!currentFullscreenElement();
  btn.classList.toggle("active", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const label = on ? t("match.fullscreenExit") : t("match.fullscreen");
  const hint = on ? t("match.fullscreenExitHint") : t("match.fullscreenHint");
  btn.title = hint || label;
  btn.setAttribute("aria-label", label || hint);
}

const FULLSCREEN_HINT_KEY = "vcfm-fullscreen-hint-seen";

/**
 * 开赛后点一下全屏入口在哪。
 * ⚠ 只在按钮真的可见时弹（iPhone Safari 不支持 ⇒ 不弹，免得指一个点了没反应的键）。
 * ⚠ 赛后战报把控制条藏了，也不弹。点过一次或点过全屏键后不再弹。
 * ⚠ 不能在 openMatch（进比赛界面、尚未开踢）时弹：
 *   ① 那时用户还在看赛前简报，不一定注意到 toast；
 *   ② 一点「进入比赛」就会被「赛前讲话：…」盖掉（toast() 只有一条，后写覆盖先写）；
 *   ③ 更糟的是若先写 localStorage 再弹，被盖掉后也再不会弹。
 *   所以：开赛后再弹，且 **先弹再记**；若刚弹过队内讲话，延后超过 toast 的 2200ms。
 */
function maybeHintFullscreenEntry({ delayMs = 0 } = {}) {
  const btn = $("#btn-match-fullscreen");
  if (!btn || btn.hidden) return;
  if (!fullscreenSupported()) return;
  const layout = document.querySelector(".match-layout");
  if (layout?.classList.contains("match-report-only")) return;
  try {
    if (localStorage.getItem(FULLSCREEN_HINT_KEY) === "1") return;
  } catch {
    return;
  }
  const fire = () => {
    const still = $("#btn-match-fullscreen");
    if (!still || still.hidden) return;
    if (!fullscreenSupported()) return;
    const layoutNow = document.querySelector(".match-layout");
    if (layoutNow?.classList.contains("match-report-only")) return;
    const screen = document.querySelector("#screen-match");
    if (!screen?.classList.contains("active")) return;
    const msg = t("match.fullscreenFirstHint");
    if (!msg) return;
    toast(msg);
    try {
      localStorage.setItem(FULLSCREEN_HINT_KEY, "1");
    } catch {
      /* 记不住就当本场弹过 */
    }
  };
  if (delayMs > 0) setTimeout(fire, delayMs);
  else fire();
}

async function toggleMatchFullscreen() {
  if (!fullscreenSupported()) return;
  // 全屏的是**整块比赛界面**（含底部控制条），不是单块球场：
  // 若只全屏球场，进了全屏就点不到暂停/退出，用户会被困在里面。
  const host =
    document.querySelector(".match-layout.fmm-match") ||
    document.querySelector("#screen-match");
  if (!host) return;
  try {
    if (currentFullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      await exit.call(document);
    } else {
      const req = host.requestFullscreen || host.webkitRequestFullscreen;
      await req.call(host, { navigationUI: "hide" });
    }
  } catch {
    /* 用户拒绝 / 被策略拒绝：保持现状即可。静默比弹错干扰更小。 */
  }
  syncFullscreenUI();
  // 全屏改变的是**可用高度** ⇒ 画布必须重测。浏览器一般会补发 window resize，
  // 但补一帧显式重测成本极低，且能躲开「resize 与 flex 布局落稳」的时序差。
  requestAnimationFrame(() => matchView?.refreshLayout?.());
}

function trimGoalReplayFrames(frames, climaxAt) {
  if (!Array.isArray(frames) || frames.length < 4) return [];
  const firstT = Number(frames[0]?.t);
  const lastT = Number(frames[frames.length - 1]?.t);
  const netT = Number(frames.find((frame) => frame?.ball?.netHit)?.t);
  const requested = climaxAt == null ? NaN : Number(climaxAt);
  const climax = Number.isFinite(requested)
    ? requested
    : Number.isFinite(netT)
      ? netT
      : lastT;
  if (!Number.isFinite(firstT) || !Number.isFinite(lastT) || !Number.isFinite(climax)) return [];
  if (climax < firstT - 0.5 || climax > lastT + 0.5) return [];
  const replay = frames.filter((frame) => {
    const t = Number(frame?.t);
    return Number.isFinite(t) && t >= climax - 5.5 && t <= climax + 2;
  });
  return replay.length >= 4 ? replay : [];
}

function currentGoalReplayData() {
  const timeline = matchView?._lastTimeline;
  const climaxAt = timeline?.climaxAt == null ? NaN : Number(timeline.climaxAt);
  return {
    frames: trimGoalReplayFrames(timeline?.frames, climaxAt),
    climaxAt: Number.isFinite(climaxAt) ? climaxAt : null,
  };
}

/**
 * @param {object} ev
 * @param {object} [snap]
 * @param {object} [fixture]
 * @param {object|null} [scene] 进球瞬间场面（无真实帧的旧战报回退用）
 * @param {{ frames?: object[], climaxAt?: number|null }} [replay]
 */
function rememberGoalReplay(ev, snap, fixture, scene = null, replay = {}) {
  if (!ev || ev.type !== "goal") return;
  matchPlayback.goals.push({
    ev: { ...ev },
    snap: snap ? { ...snap } : { homeGoals: 0, awayGoals: 0, minute: ev.minute },
    fixture: fixture || pendingMatch,
    scene: scene || null,
    frames: Array.isArray(replay.frames) ? replay.frames.slice() : [],
    climaxAt:
      replay.climaxAt != null && Number.isFinite(Number(replay.climaxAt))
        ? Number(replay.climaxAt)
        : null,
  });
}

/** 赛后 / 日志点击：重看第 n 个进球 */
async function replayStoredGoal(index) {
  if (matchPlayback.replaying) {
    toast(getLang() === "en" ? "Replay in progress…" : "回放进行中…");
    return;
  }
  const item = matchPlayback.goals[index];
  if (!item || !matchView?.playGoalHighlight) {
    toast(getLang() === "en" ? "No replay for this goal" : "该进球暂无可回看");
    return;
  }
  matchPlayback.replaying = true;
  const layout = document.querySelector(".match-layout");
  const wasReportOnly = !!layout?.classList.contains("match-report-only");
  try {
    await ensureMatchPitch();
    layout?.classList.remove("match-report-only");
    matchView?.refreshLayout?.();
    const pitchRoot = $("#match-pitch-root");
    pitchRoot?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const spd = Math.max(0.25, Number(matchSpeed) || 1);
    // 空间比赛优先重播真实帧；旧战报没有帧时才使用确定性的轻量回退。
    const played =
      item.frames?.length >= 4 && matchView.playRecordedGoalReplay
        ? await matchView.playRecordedGoalReplay({
            frames: item.frames,
            climaxAt: item.climaxAt,
            lang: getLang(),
            sleepFn: sleepPlayback,
            getSpeed: () => Math.min(1, spd),
            isPaused: () => !!matchPlayback.paused,
          })
        : await matchView.playGoalHighlight(item.ev, item.snap, item.fixture, {
            speed: Math.min(spd, 1),
            lang: getLang(),
            sleepFn: sleepPlayback,
            rewatch: true,
            scene: item.scene || null,
          });
    if (!played) throw new Error("Goal replay could not enter playback state");
  } catch (err) {
    console.error(err);
    toast(getLang() === "en" ? "Replay failed" : "回放失败");
  } finally {
    if (wasReportOnly) layout?.classList.add("match-report-only");
    matchView?.refreshLayout?.();
    matchPlayback.replaying = false;
  }
}

/** 直播倍速 0.5 / 1 / 2 / 4 */
function readPref(key, oldKey, fallback) {
  try {
    return localStorage.getItem(key) || (oldKey ? localStorage.getItem(oldKey) : null) || fallback;
  } catch {
    return fallback;
  }
}
const MATCH_SPEEDS = [0.5, 1, 1.5, 2, 4];
let matchSpeed = (() => {
  const raw = Number(readPref("vcfm-match-speed", "vc-fm-match-speed", "1"));
  // 旧存档若是 2/4，仍尊重；非法值回落到「正常」×1
  if (!MATCH_SPEEDS.includes(raw)) return 1;
  return raw;
})();
const MATCH_CAMERAS = ["full", "tv", "tactical"];
let matchCamera = (() => {
  const raw = readPref("vcfm-match-camera", null, "tv");
  return MATCH_CAMERAS.includes(raw) ? raw : "tv";
})();
/** 导出提醒：上次导出时间戳 */
const EXPORT_TIP_KEY = "vcfm-last-export";
const OLD_EXPORT_TIP_KEY = "vc-fm-last-export";

/** 自动存档；失败 toast 提示（配额满/隐私模式），避免进度静默丢失 */
function autosave(msg) {
  if (!world) return false;
  const ok = saveGame(world);
  if (!ok) {
    console.warn("autosave failed", msg || "");
    try {
      toast(t("toast.autosaveFail"));
    } catch (_) {
      /* toast / i18n 尚未就绪时至少 console */
    }
  }
  return ok;
}


/** 球衣号码徽章的 inline style */
function kitBadgeStyle(club) {
  const kit = ensureKit(club);
  const bg = kitBackground(kit);
  const color = kit.numberColor || "#fff";
  return `background:${bg};color:${color};border-color:${kit.primary || "#fff"}`;
}

function renderKitShirt(club, number, size = 48) {
  const kit = ensureKit(club);
  const bg = kitBackground(kit);
  const color = kit.numberColor || "#fff";
  const n = number != null ? number : "—";
  return `<span class="kit-shirt" style="width:${size}px;height:${Math.round(size * 1.15)}px;background:${bg};color:${color};border-color:${kit.primary || "#334155"}"><span class="kit-shirt-num">${n}</span></span>`;
}

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const screens = {
  start: $("#screen-start"),
  main: $("#screen-main"),
  match: $("#screen-match"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
  // 离开比赛界面必须退出全屏：否则用户会停在一块满屏的比赛界面上，
  // 看不到任何返回入口（全屏把浏览器 UI 也藏了，连刷新/返回都没了）。
  if (name !== "match" && currentFullscreenElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      exit?.call(document);
    } catch {
      /* ignore */
    }
  }
  syncFullscreenUI();
}

const motionReviewState = {
  clip: null,
  index: 0,
  timer: 0,
  resumePlayback: false,
  returnFocus: null,
};

function safeMotionColor(value, fallback) {
  return /^#[0-9a-f]{3,8}$/i.test(String(value || "")) ? value : fallback;
}

function motionIncidentLabel(type, en = getLang() === "en") {
  const labels = en
    ? {
        "invalid-coordinate": "Invalid coordinate",
        "player-teleport": "Player displacement",
        "player-acceleration": "Acceleration spike",
        "player-oscillation": "Direction oscillation",
        "player-target-churn": "Run target churn",
        "player-overlap": "Persistent overlap",
        "support-target-crowding": "Support target crowding",
        "owner-ball-gap": "Owner/ball separation",
        "ball-teleport": "Ball displacement",
        "display-divergence": "Engine/display divergence",
      }
    : {
        "invalid-coordinate": "坐标越界",
        "player-teleport": "球员异常位移",
        "player-acceleration": "加速度突变",
        "player-oscillation": "方向反复切换",
        "player-target-churn": "跑位目标反复",
        "player-overlap": "持续重叠",
        "support-target-crowding": "接应目标拥挤",
        "owner-ball-gap": "持球人与球分离",
        "ball-teleport": "球异常位移",
        "display-divergence": "引擎与画面偏离",
      };
  return labels[type] || type || (en ? "Motion incident" : "运动异常");
}

function motionIncidentValue(incident, en = getLang() === "en") {
  if (Number.isFinite(Number(incident.speedMps))) return `${Number(incident.speedMps).toFixed(1)} m/s`;
  if (Number.isFinite(Number(incident.accelerationMps2))) return `${Number(incident.accelerationMps2).toFixed(1)} m/s²`;
  if (Number.isFinite(Number(incident.gapMetres))) return `${Number(incident.gapMetres).toFixed(2)} m`;
  if (Number.isFinite(Number(incident.distanceMetres))) return `${Number(incident.distanceMetres).toFixed(2)} m`;
  if (Number.isFinite(Number(incident.turns))) return en ? `${incident.turns} turns` : `${incident.turns} 次转向`;
  if (Number.isFinite(Number(incident.changes))) return en ? `${incident.changes} changes` : `${incident.changes} 次改跑`;
  return incident.entityId || "";
}

// 复核弹窗的小球场必须与主球场（js/matchview.js 里的 .mp-lines）共用同一套坐标系：
//   横向：viewBox 宽 150 = 引擎 y × 1.5（球场长 105 m），高 100 = 引擎 x（球场宽 68 m）
//   画面映射 screenX = 100 − engineY，screenY = engineX。标线照抄 .mp-lines。
const MOTION_PITCH_UNITS_X = 150 / 105;
const MOTION_PITCH_UNITS_Y = 100 / 68;
/**
 * 屏幕上要画成正圆时，椭圆短半轴该取多少。
 * rx 沿球场长（viewBox x）；ry 沿球场宽（viewBox y）。
 * ry/rx = (100/68) / (150/105) = 1.0294。
 */
function motionPitchRy(rx) {
  return rx * (MOTION_PITCH_UNITS_Y / MOTION_PITCH_UNITS_X);
}

function motionPitchSvg(frame, metadata = {}) {
  const homeColor = safeMotionColor(metadata.home?.color, "#22c55e");
  const awayColor = safeMotionColor(metadata.away?.color, "#ef4444");
  // 引擎坐标 → 横向 viewBox：x = (100-y)*1.5，y = engineX
  const vx = (x, y) => Math.max(1, Math.min(149, (100 - (Number(y) || 0)) * 1.5));
  const vy = (x, y) => Math.max(1, Math.min(99, Number(x) || 0));
  const targets = (frame?.players || []).map((player) => {
    if (!player.movementTarget || player.sentOff) return "";
    const x = vx(player.x, player.y);
    const y = vy(player.x, player.y);
    const tx = vx(player.movementTarget.x, player.movementTarget.y);
    const ty = vy(player.movementTarget.x, player.movementTarget.y);
    const color = player.team === "home" ? homeColor : awayColor;
    const r = 0.72;
    return `<g class="motion-target"><line x1="${x}" y1="${y}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width=".63" stroke-dasharray="2.25 1.8" opacity=".72"/><ellipse cx="${tx}" cy="${ty}" rx="${r}" ry="${motionPitchRy(r).toFixed(2)}" fill="none" stroke="${color}" stroke-width=".63" opacity=".9"/></g>`;
  }).join("");
  const players = (frame?.players || []).map((player) => {
    const x = vx(player.x, player.y);
    const y = vy(player.x, player.y);
    const color = player.team === "home" ? homeColor : awayColor;
    const number = Number.isFinite(Number(player.num)) ? String(player.num) : "";
    const opacity = player.sentOff ? 0.28 : 1;
    const r = 2.45;
    return `<g opacity="${opacity}"><ellipse cx="${x}" cy="${y}" rx="${r}" ry="${motionPitchRy(r).toFixed(2)}" fill="${color}" stroke="#f8fafc" stroke-width="0.825"/><text x="${x}" y="${(y + 1.17).toFixed(2)}" text-anchor="middle" fill="#fff" font-size="3.225" font-weight="800">${escapeHtml(number)}</text></g>`;
  }).join("");
  const ballX = Math.max(0.7, Math.min(149.3, (100 - (Number(frame?.ball?.y) || 0)) * 1.5));
  const ballY = Math.max(0.7, Math.min(99.3, Number(frame?.ball?.x) || 0));
  const ballR = 1.15;
  const ball = `<ellipse cx="${ballX}" cy="${ballY}" rx="${ballR}" ry="${motionPitchRy(ballR).toFixed(2)}" fill="#fff" stroke="#111827" stroke-width="0.975"/>`;
  return `<svg viewBox="0 0 150 100" preserveAspectRatio="none" aria-hidden="true">
    <rect x="0.35" y="0.35" width="149.3" height="99.3" fill="none" stroke="rgba(255,255,255,.78)" stroke-width=".7"/>
    <line x1="75" y1="0.35" x2="75" y2="99.65" stroke="rgba(255,255,255,.7)" stroke-width=".55"/>
    <ellipse cx="75" cy="50" rx="13.07" ry="13.46" fill="none" stroke="rgba(255,255,255,.68)" stroke-width=".55"/>
    <circle cx="75" cy="50" r=".85" fill="rgba(255,255,255,.9)"/>
    <rect x="0.35" y="22" width="23.65" height="56" fill="none" stroke="rgba(255,255,255,.68)" stroke-width=".55"/>
    <rect x="0.35" y="36.53" width="7.51" height="26.94" fill="none" stroke="rgba(255,255,255,.68)" stroke-width=".55"/>
    <path d="M 24 39.6 A 13.07 13.46 0 0 1 24 60.4" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".5"/>
    <circle cx="15.71" cy="50" r=".6" fill="rgba(255,255,255,.75)"/>
    <line x1="0.35" y1="44" x2="0.35" y2="56" stroke="rgba(255,255,255,.92)" stroke-width="1.4"/>
    <rect x="126" y="22" width="23.65" height="56" fill="none" stroke="rgba(255,255,255,.68)" stroke-width=".55"/>
    <rect x="142.14" y="36.53" width="7.51" height="26.94" fill="none" stroke="rgba(255,255,255,.68)" stroke-width=".55"/>
    <path d="M 126 39.6 A 13.07 13.46 0 0 0 126 60.4" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".5"/>
    <circle cx="134.29" cy="50" r=".6" fill="rgba(255,255,255,.75)"/>
    <line x1="149.65" y1="44" x2="149.65" y2="56" stroke="rgba(255,255,255,.92)" stroke-width="1.4"/>
    <path d="M 1.78 0.35 A 1.43 1.47 0 0 1 0.35 1.82" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".5"/>
    <path d="M 0.35 98.18 A 1.43 1.47 0 0 1 1.78 99.65" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".5"/>
    <path d="M 148.22 0.35 A 1.43 1.47 0 0 0 149.65 1.82" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".5"/>
    <path d="M 149.65 98.18 A 1.43 1.47 0 0 0 148.22 99.65" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".5"/>
    ${targets}${players}${ball}
  </svg>`;
}

function stopMotionReviewPlayback() {
  if (motionReviewState.timer) window.clearInterval(motionReviewState.timer);
  motionReviewState.timer = 0;
  const button = $("#btn-motion-review-play");
  if (button) {
    button.innerHTML = '<span aria-hidden="true">▶</span>';
    button.title = getLang() === "en" ? "Play" : "播放";
    button.setAttribute("aria-label", button.title);
  }
}

function renderMotionReviewFrame(index = motionReviewState.index) {
  const clip = motionReviewState.clip;
  if (!clip?.frames?.length) return;
  const frameIndex = Math.max(0, Math.min(clip.frames.length - 1, Number(index) || 0));
  motionReviewState.index = frameIndex;
  const frame = clip.frames[frameIndex];
  const enginePitch = $("#match-motion-engine-pitch");
  const displayPitch = $("#match-motion-display-pitch");
  if (enginePitch) enginePitch.innerHTML = motionPitchSvg(frame.engine, clip.metadata);
  if (displayPitch) displayPitch.innerHTML = motionPitchSvg(frame.display, clip.metadata);
  const range = $("#match-motion-review-range");
  if (range) {
    range.max = String(Math.max(0, clip.frames.length - 1));
    range.value = String(frameIndex);
  }
  const time = $("#match-motion-review-time");
  if (time) time.textContent = `${Number(frame.t || 0).toFixed(2)}s`;
  const count = $("#match-motion-review-frame");
  if (count) count.textContent = `${frameIndex + 1} / ${clip.frames.length}`;

  const incidentsRoot = $("#match-motion-review-incidents");
  if (incidentsRoot) {
    const incidents = clip.incidents || [];
    const en = getLang() === "en";
    incidentsRoot.innerHTML = incidents.length
      ? incidents.map((incident) => {
          const nearest = clip.frames.reduce((best, candidate, candidateIndex) =>
            Math.abs(Number(candidate.t) - Number(incident.t)) < best.distance
              ? { index: candidateIndex, distance: Math.abs(Number(candidate.t) - Number(incident.t)) }
              : best,
          { index: 0, distance: Infinity });
          const active = nearest.index === frameIndex;
          return `<button type="button" class="motion-review-incident${active ? " active" : ""}" data-motion-frame="${nearest.index}" data-severity="${escapeHtml(incident.severity || "warning")}">
            <time>${Number(incident.t || 0).toFixed(2)}s</time>
            <strong>${escapeHtml(motionIncidentLabel(incident.type, en))}</strong>
            <span>${escapeHtml(motionIncidentValue(incident, en))}</span>
          </button>`;
        }).join("")
      : `<div class="motion-review-empty">${en ? "No automatic incident in this clip" : "该片段没有自动异常标记"}</div>`;
  }
}

function toggleMotionReviewPlayback() {
  const clip = motionReviewState.clip;
  if (!clip?.frames?.length) return;
  if (motionReviewState.timer) {
    stopMotionReviewPlayback();
    return;
  }
  const button = $("#btn-motion-review-play");
  if (button) {
    button.innerHTML = '<span aria-hidden="true">⏸</span>';
    button.title = getLang() === "en" ? "Pause" : "暂停";
    button.setAttribute("aria-label", button.title);
  }
  if (motionReviewState.index >= clip.frames.length - 1) motionReviewState.index = 0;
  motionReviewState.timer = window.setInterval(() => {
    if (motionReviewState.index >= clip.frames.length - 1) {
      stopMotionReviewPlayback();
      return;
    }
    renderMotionReviewFrame(motionReviewState.index + 1);
  }, 80);
}

function motionClipFileName(clip) {
  const fixture = String(clip?.metadata?.fixtureId || "match").replace(/[^a-z0-9_-]+/gi, "-");
  const at = Number(clip?.range?.to);
  return `vcfm-motion-${fixture}-${Number.isFinite(at) ? at.toFixed(1) : "clip"}.json`;
}

function downloadMotionClip(clip) {
  if (!clip?.frames?.length) return false;
  const blob = new Blob([JSON.stringify(clip, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = motionClipFileName(clip);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export function showMotionDiagnostic(clip, options = {}) {
  if (!clip?.frames?.length) return false;
  stopMotionReviewPlayback();
  motionReviewState.clip = clip;
  motionReviewState.index = Math.max(0, clip.frames.length - 1);
  motionReviewState.returnFocus = document.activeElement;
  motionReviewState.resumePlayback = !!(matchPlayback.controlsEnabled && !matchPlayback.paused);
  if (motionReviewState.resumePlayback) {
    matchPlayback.paused = true;
    matchView?.setFrozen?.(true);
    updateMatchPlaybackUI();
  }
  const en = getLang() === "en";
  const root = $("#match-motion-review");
  root?.classList.remove("hidden");
  const title = $("#match-motion-review-title");
  if (title) title.textContent = en ? "Motion clip diagnostics" : "运动片段诊断";
  const meta = $("#match-motion-review-meta");
  if (meta) {
    const home = clip.metadata?.home?.name || clip.metadata?.home?.id || (en ? "Home" : "主队");
    const away = clip.metadata?.away?.name || clip.metadata?.away?.id || (en ? "Away" : "客队");
    meta.textContent = `${home} - ${away} · seed ${clip.metadata?.matchSeed ?? "—"}`;
  }
  const engineLabel = $("#motion-engine-label");
  const displayLabel = $("#motion-display-label");
  if (engineLabel) engineLabel.textContent = en ? "Engine coordinates" : "引擎坐标";
  if (displayLabel) displayLabel.textContent = en ? "Rendered coordinates" : "画面坐标";
  const summary = $("#match-motion-review-summary");
  if (summary) {
    summary.innerHTML = en
      ? `<span><strong>${clip.frames.length}</strong> frames</span><span><strong>${Number(clip.range?.durationSeconds || 0).toFixed(2)}s</strong></span><span><strong>${clip.incidents?.length || 0}</strong> incidents</span>`
      : `<span><strong>${clip.frames.length}</strong> 帧</span><span><strong>${Number(clip.range?.durationSeconds || 0).toFixed(2)} 秒</strong></span><span><strong>${clip.incidents?.length || 0}</strong> 个自动标记</span>`;
  }
  renderMotionReviewFrame(motionReviewState.index);
  $("#btn-motion-review-close")?.focus();
  if (options.download) downloadMotionClip(clip);
  return true;
}

export function closeMotionDiagnostic() {
  const root = $("#match-motion-review");
  if (!root || root.classList.contains("hidden")) return;
  stopMotionReviewPlayback();
  root.classList.add("hidden");
  if (motionReviewState.resumePlayback) {
    matchPlayback.paused = false;
    matchView?.setFrozen?.(false);
    updateMatchPlaybackUI();
  }
  motionReviewState.resumePlayback = false;
  motionReviewState.returnFocus?.focus?.();
}

function updateMotionCaptureUI(status = null) {
  const button = $("#btn-match-motion-capture");
  if (!button) return;
  const frames = Number(status?.frames) || 0;
  // incidents 是「当前滚动窗口内」的数量，会被 _trimFrames 裁掉，所以徽章会
  // 自己涨上去又归零；totalIncidents 才是本场累计。徽章继续表示「现在按下去
  // 能导出几个标记」（这才是按钮的真实行为），但提示里补上累计数，
  // 免得用户刚看到 3 个、回头发现清零了以为漏了。
  const incidents = Number(status?.incidents) || 0;
  const total = Number(status?.totalIncidents) || 0;
  const base = t("match.motionCaptureHint");
  const en = getLang() === "en";
  let detail = "";
  if (incidents) {
    detail = en ? ` · ${incidents} marked` : ` · 可导出 ${incidents} 个标记`;
  }
  if (total > incidents) {
    detail += en ? ` (${total} this match)` : `（本场累计 ${total}）`;
  }
  button.disabled = frames < 2;
  button.dataset.motionIncidents = String(Math.min(99, incidents));
  button.title = `${base}${detail}`;
  button.setAttribute("aria-label", button.title);
}

function captureCurrentMotionClip() {
  const clip = matchView?.createMotionClip?.({
    reason: "manual",
    metadata: {
      fixtureId: pendingMatch?.id || null,
      matchSeed: matchState?.matchSeed ?? pendingMatch?.matchSeed ?? null,
      minute: displayedMatchMinute,
      score: `${matchState?.hg ?? pendingMatch?.homeGoals ?? 0}-${matchState?.ag ?? pendingMatch?.awayGoals ?? 0}`,
      cameraPreset: matchCamera,
    },
  });
  if (!clip?.frames?.length || clip.frames.length < 2) {
    toast(getLang() === "en" ? "No motion frames to save yet" : "当前还没有可保存的比赛帧");
    return;
  }
  showMotionDiagnostic(clip, { download: true });
  toast(getLang() === "en" ? "Motion clip saved" : "比赛片段已保存");
}

// ---------- Start ----------
function refreshSlotUI() {
  migrateLegacySave();
  const active = getActiveSlot();
  const label = $("#active-slot-label");
  if (label) label.textContent = t("start.slotCurrent", { n: active });
  const box = $("#save-slots");
  if (!box) return;
  const slots = listSlots();
  box.innerHTML = slots
    .map((s) => {
      const activeCls = s.slot === active ? " active" : "";
      const emptyCls = s.empty ? " empty" : "";
      const title = formatSlotLabel(s);
      const sub = s.empty
        ? t("start.slotEmptyClick")
        : t("start.slotManager", { name: escapeHtml(s.manager || "—") });
      const delBtn = s.empty
        ? ""
        : `<button type="button" class="slot-delete btn small danger" data-slot-delete="${s.slot}" title="${escapeHtml(t("start.slotDelete"))}" aria-label="${escapeHtml(t("start.slotDelete"))}">${escapeHtml(t("start.slotDeleteShort"))}</button>`;
      return `<div class="slot-row${activeCls}${emptyCls}">
        <button type="button" class="slot-card${activeCls}${emptyCls}" data-slot="${s.slot}">
          <div class="slot-title">${escapeHtml(title)}</div>
          <div class="slot-sub">${sub}</div>
        </button>
        ${delBtn}
      </div>`;
    })
    .join("");
  box.querySelectorAll("[data-slot]").forEach((btn) => {
    btn.onclick = () => {
      setActiveSlot(+btn.dataset.slot);
      refreshSlotUI();
      const info = listSlots().find((x) => x.slot === +btn.dataset.slot);
      $("#start-hint").textContent = info?.empty
        ? t("start.slotEmpty", { n: btn.dataset.slot })
        : t("start.slotReady", { n: btn.dataset.slot });
    };
  });
  box.querySelectorAll("[data-slot-delete]").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const n = +btn.dataset.slotDelete;
      const info = listSlots().find((x) => x.slot === n);
      if (!info || info.empty) return;
      const detail =
        getLang() === "en"
          ? `Slot ${n}: ${info.clubName || "—"} · S${info.season ?? "?"} D${info.day ?? "?"}`
          : `${getLang() === "en" ? "Slot" : "槽"} ${n}：${
              clubBrandingById[info.clubId]
                ? localizedClubName(clubBrandingById[info.clubId], getLang())
                : info.clubName || "—"
            } · S${info.season ?? "?"} D${info.day ?? "?"}`;
      if (!confirm(`${t("start.slotDeleteConfirm", { n })}\n${detail}`)) return;
      if (!clearSave(n)) {
        toast(t("start.slotDeleteFail"));
        return;
      }
      // 删的是当前槽：保持选中空槽；否则不改 active
      if (getActiveSlot() === n) setActiveSlot(n);
      refreshSlotUI();
      $("#start-hint").textContent = t("start.slotDeleted", { n });
      toast(t("start.slotDeleted", { n }));
    };
  });

  if (hasAnySave()) {
    const filled = slots.filter((s) => !s.empty).length;
    if (!$("#start-hint").textContent) {
      $("#start-hint").textContent = t("start.filled", { filled, total: SLOT_COUNT });
    }
  }
}

/** 当前开局所选国家（七国之一）；默认英格兰/克朗兰 */
function getStartCountryId() {
  const sel = $("#select-country");
  const v = sel?.value;
  if (v && COUNTRY_LIST.some((c) => c.id === v)) return v;
  return COUNTRY_LIST[0]?.id || "crownland";
}

/** 该国最低可执教级别（startEligible） */
function startDivisionsForCountry(countryId) {
  return START_DIVISIONS.filter((id) => DIVISIONS[id]?.countryId === countryId);
}

/** 联赛下拉选项（七国全部级别） */
function divisionSelectOptionsHtml(includeAll = false) {
  const en = getLang() === "en";
  const parts = [];
  if (includeAll) {
    parts.push(`<option value="all">${escapeHtml(t("clubs.allDiv"))}</option>`);
  }
  for (const country of COUNTRY_LIST) {
    const options = DIVISION_IDS.filter((id) => DIVISIONS[id]?.countryId === country.id)
      .map((id) => {
        const d = DIVISIONS[id];
        const label = t("div." + id) || (en ? d.nameEn || d.name : d.name);
        return `<option value="${id}">${escapeHtml(label)}</option>`;
      })
      .join("");
    if (!options) continue;
    const countryLabel = en ? country.nameEn || country.name : country.name;
    parts.push(`<optgroup label="${escapeHtml(countryLabel)}">${options}</optgroup>`);
  }
  return parts.join("");
}

function fillDivisionSelects(preferDivision = null) {
  const tableSel = $("#table-division");
  const clubsSel = $("#clubs-division");
  const prefer = preferDivision != null ? String(preferDivision) : null;
  if (tableSel) {
    const prev = tableSel.dataset.touched ? tableSel.value : prefer || tableSel.value;
    tableSel.innerHTML = divisionSelectOptionsHtml(false);
    if (prev && [...tableSel.options].some((o) => o.value === prev)) tableSel.value = prev;
    else if (prefer && [...tableSel.options].some((o) => o.value === prefer)) tableSel.value = prefer;
  }
  if (clubsSel) {
    const prev = clubsSel.dataset.touched ? clubsSel.value : prefer || clubsSel.value;
    clubsSel.innerHTML = divisionSelectOptionsHtml(true);
    if (prev && [...clubsSel.options].some((o) => o.value === prev)) clubsSel.value = prev;
    else if (prefer && [...clubsSel.options].some((o) => o.value === prefer)) clubsSel.value = prefer;
  }
}

function fillCountrySelect() {
  const sel = $("#select-country");
  if (!sel) return;
  const prev = sel.value || getStartCountryId();
  const en = getLang() === "en";
  sel.innerHTML = COUNTRY_LIST.map((c) => {
    const label = en ? c.nameEn || c.name : c.name;
    return `<option value="${c.id}">${label}</option>`;
  }).join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else if (sel.options.length) sel.selectedIndex = 0;
}

function fillClubSelect() {
  const sel = $("#select-club");
  if (!sel) return;
  const prev = sel.value;
  const countryId = getStartCountryId();
  const startDivs = startDivisionsForCountry(countryId);
  const starters = CLUB_TEMPLATES.filter(
    (c) =>
      (c.countryId || DIVISIONS[c.division || 3]?.countryId) === countryId &&
      startDivs.includes(c.division || 3)
  );
  sel.innerHTML = starters
    .map(
      (c) =>
        `<option value="${c.id}">${t("start.clubOption", { name: clubDisplayName(c), power: c.power })}</option>`
    )
    .join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  renderStartClubPreview();
}

function renderStartClubPreview() {
  const target = $("#start-club-preview");
  const club = CLUB_TEMPLATES.find((item) => item.id === $("#select-club")?.value);
  if (!target || !club) return;
  const division = DIVISIONS[club.division || 3];
  const divisionName = t(`div.${club.division || 3}`) || (getLang() === "en" ? division?.nameEn : division?.name) || "";
  target.innerHTML = `
    ${clubCrestHtml(club, { size: 56, className: "start-club-crest", decorative: true })}
    <span>
      <strong>${escapeHtml(clubDisplayName(club))}</strong>
      <small>${escapeHtml(divisionName)} · ${escapeHtml(getLang() === "en" ? club.city?.en || "" : club.city?.zh || "")}</small>
    </span>`;
}

function initStart() {
  fillCountrySelect();
  fillClubSelect();

  const countrySel = $("#select-country");
  if (countrySel) {
    countrySel.onchange = () => {
      fillClubSelect();
    };
  }
  const clubSel = $("#select-club");
  if (clubSel) clubSel.onchange = renderStartClubPreview;

  refreshSlotUI();
  if (hasAnySave()) {
    $("#start-hint").textContent = t("start.detectSave", { n: getActiveSlot() });
  }

  $("#btn-new-game").onclick = () => {
    try {
      const manager = $("#input-manager").value.trim() || t("start.manager.placeholder");
      const clubId = $("#select-club").value;
      const countryId = getStartCountryId();
      const tpl = CLUB_TEMPLATES.find((c) => c.id === clubId);
      const startDivs = startDivisionsForCountry(countryId);
      const tplCountry = tpl?.countryId || DIVISIONS[tpl?.division || 3]?.countryId;
      if (!tpl || tplCountry !== countryId || !startDivs.includes(tpl.division || 3)) {
        $("#start-hint").textContent = t("start.div3Only");
        return;
      }
      const slot = getActiveSlot();
      if (hasSave(slot) && !confirm(t("start.overwriteConfirm", { n: slot }))) return;
      world = createWorld(clubId, manager, getLang());
      dashboardAdvanceDigest = null;
      ensureScoutingKnowledge(world);
      ensureMedia(world);
      for (const c of world.clubs) ensureStaff(c);
      ensureWorldFinances(world);
      ensureCompetitions(world);
      ensureWorldRegistrations(world);
      refreshStaffMarket(world);
      const u = world.clubs.find((c) => c.id === clubId);
      mediaSeasonKickoff(world, u, t("div." + (u.division || 3)) || DIVISIONS[u.division || 3]?.name || "League");
      ensureBoardObjective(world);
      ensureTransferWindow(world);
      processTransferWindowDay(world);
      ensureActiveCareer(world);
      ensureManagerOnboarding(world);
      saveGame(world, slot);
      enterMain();
    } catch (err) {
      console.error(err);
      const msg = err?.message || String(err);
      $("#start-hint").textContent = getLang() === "en" ? `Failed to start: ${msg}` : `开局失败：${msg}`;
      toast(getLang() === "en" ? `Start failed: ${msg}` : `开局失败：${msg}`);
    }
  };

  $("#btn-load-game").onclick = async () => {
    const slot = getActiveSlot();
    const data = await loadGame(slot);
    if (!data) {
      $("#start-hint").textContent = t("start.noSave", { n: slot });
      return;
    }
    world = data;
    dashboardAdvanceDigest = null;
    migrateWorld(world);
    enterMain();
  };

  $("#btn-export-save").onclick = async () => {
    const slot = getActiveSlot();
    if (!hasSave(slot)) {
      $("#start-hint").textContent = t("start.noExport", { n: slot });
      return;
    }
    const data = await loadGame(slot);
    if (exportSaveDownload(data)) {
      markExportDone();
      toast(t("toast.exportedOk"));
    } else toast(t("toast.exportFail"));
  };

  $("#btn-import-save").onclick = () => {
    $("#input-import-save").click();
  };

  $("#input-import-save").onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const data = importSaveText(text);
      if (!data) {
        toast(t("toast.importBad"));
        return;
      }
      const slot = getActiveSlot();
      if (hasSave(slot) && !confirm(t("start.overwriteConfirm", { n: slot }))) return;
      world = data;
      dashboardAdvanceDigest = null;
      migrateWorld(world);
      saveGame(world, slot);
      toast(t("toast.imported", { n: slot }));
      refreshSlotUI();
      enterMain();
    } catch (err) {
      console.error(err);
      toast(t("toast.importFail"));
    }
  };
}

/** 旧存档 / 缺字段兼容 */
function repairWorldFields(w) {
  if (!w.retiredPlayers) w.retiredPlayers = [];
  ensureScoutingKnowledge(w);
  ensureMedia(w);
  if (!Array.isArray(w.staffMarket)) refreshStaffMarket(w);
  try {
    ensureWorldStaff(w);
  } catch (_) {
    /* older engine builds */
  }
  try {
    ensureManagerJob(w);
  } catch (_) {
    /* ignore */
  }
  ensureBoardObjective(w);
  ensureTransferWindow(w);
  ensureActiveCareer(w);
  ensureWorldFinances(w);
  ensureWorldDelegation(w);
  ensureManagerOnboarding(w);
  if (!Array.isArray(w.poachBids)) w.poachBids = [];
  if (w.board && w.board.sackWarnings == null) w.board.sackWarnings = 0;
  for (const c of w.clubs || []) {
    if (!c.division) {
      c.division = c.power >= 72 ? 1 : c.power >= 60 ? 2 : 3;
    }
    // 队名随模板刷新（id 不变，兼容旧档队服/关系；显示名可改版）
    const tpl = CLUB_TEMPLATES.find((t) => t.id === c.id);
    if (tpl) {
      c.name = tpl.name;
      c.short = tpl.short;
      c.countryId = tpl.countryId || c.countryId;
      c.countryCode = tpl.countryCode || c.countryCode;
      c.realityProfile = tpl.realityProfile ? { ...tpl.realityProfile } : c.realityProfile || null;
      if (tpl.color && !c.kit) c.color = tpl.color;
    }
    ensureStaff(c);
    ensureYouthAcademy(c);
    ensureKit(c);
    ensureTactics(c);
    ensureTraining(c);
    ensureFacilities(c);
    ensureClubHonors(c);
    if (!c.youth.players.length) fillYouthSquad(c);
    ensureDistinctClubPlayerNames(c);
    for (const p of c.players || []) {
      if (p.potential == null) p.potential = Math.min(20, (p.ovr || 10) + 1);
      ensureRealisticPlayerTalent(p);
      ensurePlayerAttributeProfile(p);
      ensureFootballProfile(p);
      ensurePlayerHistory(p);
      ensureIntl(p);
      ensureHonors(p);
      ensureDiscipline(p);
      ensurePlayerInjury(p);
    }
    for (const p of c.youth.players || []) {
      if (p.potential == null) p.potential = Math.min(20, (p.ovr || 10) + 1);
      ensureRealisticPlayerTalent(p);
      ensurePlayerAttributeProfile(p);
      ensureFootballProfile(p);
      ensurePlayerHistory(p);
      ensureIntl(p);
      ensureHonors(p);
      ensurePlayerInjury(p);
    }
    // 先补齐详细位置与持久化号码偏好，再做旧档号码修复/当前赛季登记。
    assignSquadNumbers(c, { season: w.season, reason: "save-migration" });
    if (c.id === w.userClubId) {
      for (const p of c.players || []) ensurePlayerPathway(p, c, w);
    }
  }
  for (const p of w.freeAgents || []) {
    ensureRealisticPlayerTalent(p);
    ensurePlayerAttributeProfile(p);
    ensureFootballProfile(p);
    ensurePlayerInjury(p);
  }
  for (const p of w.retiredPlayers || []) {
    ensureRealisticPlayerTalent(p);
    ensurePlayerAttributeProfile(p);
    ensureFootballProfile(p);
    ensurePlayerInjury(p);
  }
  ensureCompetitions(w);
  if ((w.abilityDistributionVersion || 0) < ABILITY_DISTRIBUTION_VERSION) {
    calibrateWorldAbilityDistribution(w.clubs || []);
    for (const club of w.clubs || []) autoLineup(club);
    w.abilityDistributionVersion = ABILITY_DISTRIBUTION_VERSION;
  }
  ensureWorldRegistrations(w);
  applyWorldClubBranding(w, clubBrandingById, getLang());
  // 旧档若缺少当前七国联赛结构，提示开新档体验完整升降级
  const divisionIds = Object.keys(DIVISIONS).map(Number).filter(Number.isFinite);
  const counts = Object.fromEntries(divisionIds.map((id) => [id, 0]));
  for (const c of w.clubs || []) {
    const division = Number(c.division || 3);
    if (division in counts) counts[division]++;
  }
  if (divisionIds.some((division) => counts[division] < 4)) {
    // 仍可玩，但升降级可能跳过
    console.warn("存档联赛结构不完整，建议开新档体验完整七国联赛");
  }
}

function repairPlayerPathways(w) {
  const club = (w.clubs || []).find((item) => item.id === w.userClubId);
  for (const player of club?.players || []) ensurePlayerPathway(player, club, w);
}

function repairScoutingKnowledge(w) {
  ensureScoutingKnowledge(w);
}

function migrateWorld(w) {
  return migrateSaveSchema(w, {
    migrations: {
      1: repairWorldFields,
      2: repairPlayerPathways,
      3: repairScoutingKnowledge,
    },
    ensureCurrent: repairWorldFields,
  });
}

function enterMain() {
  showScreen("main");
  bindMainOnce();
  refreshAll();
}

// ---------- Tabs ----------
const MAIN_NAV_GROUPS = {
  overview: ["dashboard", "finance", "inbox", "media", "career"],
  team: ["squad", "tactics", "training", "youth", "staff", "facilities"],
  matches: ["fixtures", "table"],
  transfer: ["transfer"],
  world: ["competitions", "clubs"],
};
const mainNavLastTab = { overview: "dashboard", team: "squad", matches: "fixtures", transfer: "transfer", world: "competitions" };

function navGroupForTab(tab) {
  return Object.entries(MAIN_NAV_GROUPS).find(([, tabs]) => tabs.includes(tab))?.[0] || "overview";
}

function syncMainNavigation(tab) {
  const group = navGroupForTab(tab);
  mainNavLastTab[group] = tab;
  $$(".primary-tab").forEach((button) => {
    const active = button.dataset.navGroup === group;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  $$(".tab").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.hidden = !MAIN_NAV_GROUPS[group].includes(button.dataset.tab);
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}

function activateMainTab(tab, { refresh = true } = {}) {
  if (!document.querySelector(`[data-tab="${tab}"]`)) return;
  if (world && MANAGER_ONBOARDING_TAB_STEPS.includes(tab)) {
    if (completeManagerOnboardingStep(world, tab)) autosave(`onboarding-${tab}`);
  }
  syncMainNavigation(tab);
  $$(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  if (tab === "table") $(`#tab-${selectedLeagueCentreView}`)?.classList.add("active");
  else $(`#tab-${tab}`)?.classList.add("active");
  if (!refresh) {
    // 进入具体页签后再凑齐该页内容;停在概览时不预先铺满其余页。
    if (tab === "inbox") renderInbox();
    else if (tab === "dashboard") renderDashboard();
  }
  if (refresh) refreshAll();
}

let mainBound = false;
function bindMainOnce() {
  if (mainBound) return;
  mainBound = true;

  $$(".tab").forEach((btn) => {
    btn.onclick = () => activateMainTab(btn.dataset.tab);
  });
  $$(".primary-tab").forEach((btn) => {
    btn.onclick = () => activateMainTab(mainNavLastTab[btn.dataset.navGroup] || MAIN_NAV_GROUPS[btn.dataset.navGroup]?.[0]);
  });
  syncMainNavigation(document.querySelector(".tab.active")?.dataset.tab || "dashboard");
  $$('[data-league-centre-view]').forEach((btn) => {
    btn.addEventListener("click", () => setLeagueCentreView(btn.dataset.leagueCentreView));
  });
  $$('[data-competition-centre-view]').forEach((btn) => {
    btn.addEventListener("click", () => setCompetitionCentreView(btn.dataset.competitionCentreView));
  });

  // 信箱筛选 + 概览入口
  document.querySelectorAll("[data-inbox-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      inboxFilter = btn.dataset.inboxFilter || "pending";
      renderInbox();
    });
  });
  const dashInboxBtn = $("#btn-dash-inbox");
  if (dashInboxBtn) {
    dashInboxBtn.onclick = () => goToInboxTab();
  }
  $("#tab-dashboard")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-dashboard-link]");
    if (button) {
      const target = button.dataset.dashboardLink;
      if (target) activateMainTab(target);
      return;
    }
    const dismiss = event.target.closest("[data-dashboard-onboarding-dismiss]");
    if (dismiss && world && dismissManagerOnboarding(world)) {
      autosave("onboarding-dismiss");
      renderDashboard();
      return;
    }
    const play = event.target.closest("[data-dashboard-onboarding-match]");
    if (play && world) {
      const next = getNextUserMatch(world);
      if (next && next.day <= world.day) {
        try {
          await openMatch();
        } catch (error) {
          console.error(error);
          toast(getLang() === "en" ? "Match view failed to load" : "比赛画面加载失败");
        }
      } else activateMainTab("fixtures");
    }
  });
  document.querySelectorAll("[data-squad-view]").forEach((button) => {
    button.addEventListener("click", () => {
      squadTableView = button.dataset.squadView === "full" ? "full" : "compact";
      try { localStorage.setItem("vcfm-squad-view", squadTableView); } catch (_) { /* ignore */ }
      renderSquad();
    });
  });
  $("#finance-category-filter")?.addEventListener("change", (event) => {
    financeLedgerFilter = event.target.value || "all";
    renderFinance();
  });
  $("#finance-sponsorship")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sponsor-offer]");
    if (!button || !world) return;
    const res = acceptSponsorshipOffer(world, world.userClubId, button.dataset.sponsorOffer);
    toast(getLang() === "en" ? (res.ok ? "Sponsorship selected" : res.msg) : res.msg);
    if (res.ok) {
      saveGame(world);
      refreshAll();
    }
  });
  $("#btn-finance-borrow")?.addEventListener("click", () => {
    if (!world) return;
    const club = getUserClub(world);
    const budget = clubSeasonBudgetSnapshot(world, club);
    const en = getLang() === "en";
    if (budget.debt.headroom < 100_000) {
      toast(en ? "No borrowing headroom" : "当前没有可用融资额度");
      return;
    }
    const amountIn = prompt(
      en ? `Borrowing headroom ${formatMoney(budget.debt.headroom)}\nAmount:` : `可用融资额度 ${formatMoney(budget.debt.headroom)}\n请输入融资金额：`,
      String(Math.min(budget.debt.headroom, Math.max(100_000, Math.round(budget.debt.headroom / 2))))
    );
    if (amountIn == null) return;
    const termIn = prompt(en ? "Term in seasons (1–3):" : "期限（1–3 个赛季）：", "2");
    if (termIn == null) return;
    const res = requestClubFinancing(world, club.id, parseMoneyInput(amountIn), parseInt(termIn, 10));
    toast(en ? (res.ok ? "Financing received" : res.msg) : res.msg);
    if (res.ok) {
      saveGame(world);
      refreshAll();
    }
  });
  $("#finance-debt")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-debt-repay]");
    if (!button || !world) return;
    const club = getUserClub(world);
    const debt = club.finance?.debt?.facilities?.find((item) => item.id === button.dataset.debtRepay);
    if (!debt) return;
    const amountIn = prompt(
      getLang() === "en" ? `Outstanding ${formatMoney(debt.balance)}\nRepayment:` : `未偿本金 ${formatMoney(debt.balance)}\n请输入还款金额：`,
      String(Math.min(Number(club.money) || 0, Number(debt.balance) || 0))
    );
    if (amountIn == null) return;
    const res = repayClubFinancing(world, club.id, debt.id, parseMoneyInput(amountIn));
    toast(getLang() === "en" ? (res.ok ? "Debt repaid" : res.msg) : res.msg);
    if (res.ok) {
      saveGame(world);
      refreshAll();
    }
  });
  $("#finance-reserve-weeks")?.addEventListener("input", (event) => {
    const club = world ? getUserClub(world) : null;
    if (!club) return;
    updateClubFinanceBudget(club, { reserveWeeks: event.target.value });
    renderFinance();
  });
  $("#finance-reserve-weeks")?.addEventListener("change", () => {
    if (world) saveGame(world);
  });
  $("#finance-transfer-share")?.addEventListener("input", (event) => {
    const club = world ? getUserClub(world) : null;
    if (!club) return;
    updateClubFinanceBudget(club, { transferShare: event.target.value });
    renderFinance();
  });
  $("#finance-transfer-share")?.addEventListener("change", () => {
    if (world) saveGame(world);
  });

  $("#btn-save").onclick = () => {
    if (saveGame(world)) toast(t("toast.saved", { n: getActiveSlot() }));
    else toast(t("toast.saveFail"));
  };

  $("#btn-export-save-main").onclick = () => {
    if (!world) return;
    if (exportSaveDownload(world)) {
      markExportDone();
      toast(t("toast.exported"));
    } else toast(t("toast.exportFail"));
  };

  $("#btn-global-search")?.addEventListener("click", () => openGlobalSearch());

  // 比赛倍速（含 ×0.5 慢放）
  document.querySelectorAll("[data-match-speed]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = Number(btn.dataset.matchSpeed);
      matchSpeed = MATCH_SPEEDS.includes(v) ? v : 1;
      try {
        localStorage.setItem("vcfm-match-speed", String(matchSpeed));
      } catch (_) {
        /* ignore */
      }
      syncMatchSpeedUI();
      toast(getLang() === "en" ? `Speed ×${matchSpeed}` : `比赛倍速 ×${matchSpeed}`);
    });
  });

  document.querySelectorAll("[data-match-camera]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.matchCamera;
      matchCamera = MATCH_CAMERAS.includes(next) ? next : "tv";
      try {
        localStorage.setItem("vcfm-match-camera", matchCamera);
      } catch {
        /* ignore */
      }
      matchView?.setCameraPreset?.(matchCamera);
      syncMatchCameraUI();
      const labels = getLang() === "en"
        ? { full: "Full pitch", tv: "TV", tactical: "Tactical" }
        : { full: "全场", tv: "电视", tactical: "战术" };
      toast(getLang() === "en" ? `Camera: ${labels[matchCamera]}` : `镜头：${labels[matchCamera]}`);
    });
  });

  // FMM：xG / 控球 / 射门 折叠
  $("#btn-match-stats-toggle")?.addEventListener("click", () => toggleMatchStatsPanel());

  // 暂停 / 下一步 / 逐事件
  $("#btn-match-pause")?.addEventListener("click", () => toggleMatchPause());
  $("#btn-match-sfx")?.addEventListener("click", () => toggleMatchSfx());
  $("#btn-match-step")?.addEventListener("click", () => requestMatchStep());
  $("#btn-match-step-mode")?.addEventListener("click", () => toggleMatchStepMode());
  $("#btn-match-motion-capture")?.addEventListener("click", () => captureCurrentMotionClip());
  // 全屏观赛：按钮默认 `hidden`，由 syncFullscreenUI() 按能力检测结果决定是否露出。
  $("#btn-match-fullscreen")?.addEventListener("click", () => {
    try {
      localStorage.setItem(FULLSCREEN_HINT_KEY, "1");
    } catch {
      /* ignore */
    }
    toggleMatchFullscreen();
  });
  // ⚠ 必须监听 `document` 而不是按钮：用户按 Esc / 系统返回手势退出时也要同步图标。
  // ⚠ 两个事件名都挂：Safari/Firefox 用标准名，Chromium 系历史上用带前缀的旧名。
  document.addEventListener("fullscreenchange", syncFullscreenUI);
  document.addEventListener("webkitfullscreenchange", syncFullscreenUI);
  syncFullscreenUI();
  $("#btn-motion-review-close")?.addEventListener("click", () => closeMotionDiagnostic());
  $("#btn-motion-review-play")?.addEventListener("click", () => toggleMotionReviewPlayback());
  $("#btn-motion-review-prev")?.addEventListener("click", () => {
    stopMotionReviewPlayback();
    renderMotionReviewFrame(motionReviewState.index - 1);
  });
  $("#btn-motion-review-next")?.addEventListener("click", () => {
    stopMotionReviewPlayback();
    renderMotionReviewFrame(motionReviewState.index + 1);
  });
  $("#btn-motion-review-export")?.addEventListener("click", () => {
    if (downloadMotionClip(motionReviewState.clip)) {
      toast(getLang() === "en" ? "Motion clip saved" : "比赛片段已保存");
    }
  });
  $("#match-motion-review-range")?.addEventListener("input", (event) => {
    stopMotionReviewPlayback();
    renderMotionReviewFrame(Number(event.currentTarget.value));
  });
  $("#match-motion-review-incidents")?.addEventListener("click", (event) => {
    const incident = event.target.closest("[data-motion-frame]");
    if (!incident) return;
    stopMotionReviewPlayback();
    renderMotionReviewFrame(Number(incident.dataset.motionFrame));
  });
  $("#match-motion-review")?.addEventListener("click", (event) => {
    if (event.target.id === "match-motion-review") closeMotionDiagnostic();
  });
  // FMM 顶栏「跳过」重播
  $("#btn-match-fmm-skip")?.addEventListener("click", () => {
    if (!matchView) return;
    matchView._fmmReplay = matchView._fmmReplay || { active: false, skip: false };
    matchView._fmmReplay.skip = true;
    matchView.stopSimTimeline?.();
    matchView.setFmmReplayChrome?.(false, { lang: getLang() });
    matchView.setFmmTicker?.("", "", 0);
    matchPlayback.replaying = false;
    matchPlayback.pendingGoalReplay = null;
  });

  // 事件流 / 赛后报告：点进球再看回放
  const commentary = document.querySelector(".fmm-commentary");
  const commentaryToggle = $("#match-com-toggle");
  commentaryToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    // expanded 指点击前的状态：展开着就收起，收起着就展开。
    const expanded = !commentary?.classList.contains("is-collapsed");
    commentary?.classList.toggle("is-collapsed", expanded);
    commentaryToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    // 同时写 data-i18n-title，切换语言时 applyI18n 才能重新翻译当前状态。
    const titleKey = expanded ? "match.commentaryExpand" : "match.commentaryCollapse";
    commentaryToggle.setAttribute("data-i18n-title", titleKey);
    commentaryToggle.title = t(titleKey);
    const icon = commentaryToggle.querySelector("span");
    if (icon) icon.textContent = expanded ? "⌄" : "⌃";
  });
  $("#match-log")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-goal-replay]");
    if (!btn) return;
    e.preventDefault();
    const idx = Number(btn.dataset.goalReplay);
    if (Number.isFinite(idx)) replayStoredGoal(idx);
  });
  $("#match-report")?.addEventListener("click", (e) => {
    const analysisTab = e.target.closest("[data-analysis-tab]");
    if (analysisTab) {
      e.preventDefault();
      const root = analysisTab.closest(".match-analysis");
      const tab = analysisTab.dataset.analysisTab;
      for (const button of root?.querySelectorAll("[data-analysis-tab]") || []) {
        const active = button.dataset.analysisTab === tab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      }
      for (const panel of root?.querySelectorAll("[data-analysis-panel]") || []) {
        panel.classList.toggle("hidden", panel.dataset.analysisPanel !== tab);
      }
      return;
    }
    const btn = e.target.closest("[data-goal-replay]");
    if (!btn) return;
    e.preventDefault();
    const idx = Number(btn.dataset.goalReplay);
    if (Number.isFinite(idx)) replayStoredGoal(idx);
  });

  $("#btn-menu").onclick = () => {
    autosave("menu");
    if (confirm(getLang() === "en"
      ? `Return to menu? (auto-saved to slot ${getActiveSlot()})`
      : `返回主菜单？（已自动存到槽 ${getActiveSlot()}）`)) {
      showScreen("start");
      refreshSlotUI();
      $("#start-hint").textContent = hasAnySave()
        ? t("start.backMenu")
        : t("start.backMenuEmpty");
    }
  };

  $("#btn-advance").onclick = () => onAdvance();
  $("#btn-advance-matchday").onclick = () => onAdvanceToMatchday();
  const seasonEndBtn = $("#btn-advance-season-end");
  if (seasonEndBtn) seasonEndBtn.onclick = () => onAdvanceToSeasonEnd();
  // 顶栏常驻推进：主键随赛程上下文变脸，▾ 菜单放其余推进方式
  $("#btn-topbar-continue")?.addEventListener("click", () => runTopbarContinue());
  const closeContinueMenu = () => {
    const box = document.querySelector(".topbar-continue-more");
    if (box) box.open = false;
  };
  $("#btn-topbar-advance-day")?.addEventListener("click", () => {
    closeContinueMenu();
    onAdvance();
  });
  $("#btn-topbar-advance-matchday")?.addEventListener("click", () => {
    closeContinueMenu();
    onAdvanceToMatchday();
  });
  $("#btn-topbar-advance-season-end")?.addEventListener("click", () => {
    closeContinueMenu();
    onAdvanceToSeasonEnd();
  });
  // 点菜单外部收起
  document.addEventListener("click", (e) => {
    const box = document.querySelector(".topbar-continue-more");
    if (box?.open && !box.contains(e.target)) box.open = false;
  });
  $("#btn-play-match").onclick = async () => {
    try {
      await openMatch();
    } catch (error) {
      console.error(error);
      toast(getLang() === "en" ? "Match view failed to load" : "比赛画面加载失败");
    }
  };
  $("#btn-next-season").onclick = () => {
    const res = startNextSeason(world);
    toast(res.msg);
    if (res.ok) {
      autosave("next-season");
      refreshAll();
    }
  };

  // tactics
  const formSel = $("#formation-select");
  formSel.innerHTML = Object.keys(FORMATIONS)
    .map((k) => {
      const f = FORMATIONS[k];
      return `<option value="${k}">${f.name}${f.desc ? ` · ${f.desc}` : ""}</option>`;
    })
    .join("");
  // 中场阵型下拉
  const htForm = $("#ht-formation");
  if (htForm) {
    htForm.innerHTML = Object.keys(FORMATIONS)
      .map((k) => `<option value="${k}">${FORMATIONS[k].name}</option>`)
      .join("");
  }

  const phaseShapeSelectors = [
    { id: "#possession-formation-select", key: "possessionFormation" },
    { id: "#out-possession-formation-select", key: "outOfPossessionFormation" },
  ];
  const fillPhaseShapeOptions = () => {
    const followLabel = t("tac.followBaseFormation");
    const lang = getLang();
    for (const { id } of phaseShapeSelectors) {
      const select = $(id);
      if (!select || select.dataset.optionsLang === lang) continue;
      select.innerHTML = [
        `<option value="">${escapeHtml(followLabel)}</option>`,
        ...Object.keys(FORMATIONS).map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(FORMATIONS[k].name)}</option>`),
      ].join("");
      select.dataset.optionsLang = lang;
    }
  };
  fillPhaseShapeOptions();
  for (const { id, key } of phaseShapeSelectors) {
    const select = $(id);
    if (!select) continue;
    select.onchange = (e) => {
      const club = getUserClub(world);
      ensureTactics(club);
      const value = e.target.value;
      club.tactics[key] = FORMATIONS[value] ? value : null;
      club.tactics.coachPhaseIdentityId = null;
      club.tactics.coachPhaseIdentityVersion = null;
      renderTactics();
      saveGame(world);
    };
  }

  formSel.onchange = () => {
    const club = getUserClub(world);
    ensureTactics(club);
    club.tactics.formation = formSel.value;
    autoLineup(club, { eligibleIds: nextMatchEligibility(club).ids });
    renderTactics();
    saveGame(world);
  };

  $("#style-select").onchange = (e) => {
    ensureTactics(getUserClub(world));
    getUserClub(world).tactics.style = e.target.value;
    renderTacticsSummary();
    saveGame(world);
  };

  const bindTacSlider = (id, key, valId) => {
    const el = $(id);
    if (!el) return;
    el.oninput = (e) => {
      const club = getUserClub(world);
      ensureTactics(club);
      club.tactics[key] = +e.target.value;
      const lab = tacticsSliderLabel(key === "defensiveLine" ? "defensiveLine" : key, e.target.value, getLang());
      const valEl = $(valId);
      if (valEl) valEl.textContent = `${e.target.value} · ${lab}`;
      renderTacticsSummary();
      saveGame(world);
    };
  };
  bindTacSlider("#pressing", "pressing", "#pressing-val");
  bindTacSlider("#tempo", "tempo", "#tempo-val");
  bindTacSlider("#width", "width", "#width-val");
  bindTacSlider("#defensive-line", "defensiveLine", "#defensive-line-val");

  // 预设按钮
  const presetBox = $("#tac-presets");
  if (presetBox && !presetBox._bound) {
    presetBox._bound = true;
    presetBox.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tac-preset]");
      if (!btn || !world) return;
      const id = btn.getAttribute("data-tac-preset");
      const preset = TACTIC_PRESETS[id];
      if (!preset) return;
      const club = getUserClub(world);
      ensureTactics(club);
      const t0 = club.tactics;
      t0.style = preset.style;
      t0.pressing = preset.pressing;
      t0.tempo = preset.tempo;
      t0.width = preset.width;
      t0.defensiveLine = preset.defensiveLine;
      if (preset.formation && FORMATIONS[preset.formation]) {
        t0.formation = preset.formation;
        autoLineup(club, { eligibleIds: nextMatchEligibility(club).ids });
      }
      renderTactics();
      renderSquad();
      saveGame(world);
      toast(t("tac.presetApplied", { name: t(`tac.preset.${id}`) }));
    });
  }

  $("#btn-auto-xi").onclick = () => {
    const club = getUserClub(world);
    autoLineup(club, { eligibleIds: nextMatchEligibility(club).ids });
    renderTactics();
    renderSquad();
    toast(t("toast.autoXi"));
    saveGame(world);
  };

  $("#btn-refresh-market").onclick = () => renderTransfer();
  $("#filter-pos").onchange = () => renderTransfer();

  $("#btn-youth-upgrade").onclick = () => {
    const res = upgradeYouthAcademy(world, world.userClubId);
    toast(res.msg);
    if (res.ok) {
      saveGame(world);
      refreshAll();
    }
  };

  // 设施页按钮用事件委托（动态渲染）
  const facGrid = $("#facilities-grid");
  if (facGrid && !facGrid._bound) {
    facGrid._bound = true;
    facGrid.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-upgrade-facility]");
      if (!btn || !world) return;
      const kind = btn.dataset.upgradeFacility;
      const res = startFacilityUpgrade(world, world.userClubId, kind);
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    });
  }

  $("#btn-refresh-staff").onclick = () => {
    const club = getUserClub(world);
    const fee = 50_000;
    const cash = clubCashAvailability(world, club, fee);
    if (!cash.ok) {
      const en = getLang() === "en";
      toast(cash.reserved > 0
        ? (en
            ? `Only ${formatMoney(cash.available)} is uncommitted; active transfer talks reserve ${formatMoney(cash.reserved)}.`
            : `未承诺现金仅 ${formatMoney(cash.available)}；进行中的转会谈判已占用 ${formatMoney(cash.reserved)}。`)
        : (en ? `Staff-market refresh requires ${formatMoney(fee)}.` : `刷新职员市场需要 ${formatMoney(fee)}。`));
      return;
    }
    refreshStaffMarket(world);
    recordFinanceEntry(club, -fee, { category: "staff", source: "staff-market-refresh", season: world.season, day: world.day });
    toast(t("toast.staffRefresh"));
    saveGame(world);
    renderStaff();
    renderTopbar();
  };

  const clubsDiv = $("#clubs-division");
  if (clubsDiv && !clubsDiv._bound) {
    clubsDiv._bound = true;
    clubsDiv.addEventListener("change", () => {
      clubsDiv.dataset.touched = "1";
      renderClubs();
    });
  }
  const clubsSearch = $("#clubs-search");
  if (clubsSearch && !clubsSearch._bound) {
    clubsSearch._bound = true;
    clubsSearch.addEventListener("input", () => renderClubs());
  }
  const clubsTable = $("#clubs-table");
  if (clubsTable && !clubsTable._bound) {
    clubsTable._bound = true;
    clubsTable.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-open-club]");
      if (!btn) return;
      showClubModal(btn.dataset.openClub);
    });
  }

  // 积分榜 / 赛程 / 数据榜等：点击队名打开俱乐部详情
  document.body.addEventListener("click", (e) => {
    if (!world) return;
    const nationLink = e.target.closest("[data-nation]");
    if (nationLink) {
      e.preventDefault();
      e.stopPropagation();
      selectedNationCode = nationLink.dataset.nation;
      const competitionId = $("#intl-competition")?.value || world.international?.activeCompetitionId || null;
      renderCompetitions();
      showNationModal(selectedNationCode, competitionId);
      return;
    }
    const clubLink = e.target.closest("[data-club-link]");
    if (clubLink) {
      e.preventDefault();
      showClubModal(clubLink.dataset.clubLink);
      return;
    }
    const staffLink = e.target.closest("[data-staff-link]");
    if (staffLink) {
      e.preventDefault();
      e.stopPropagation();
      showStaffModal(staffLink.dataset.staffLink, {
        clubId: staffLink.dataset.staffClub || null,
        returnClubId: staffLink.dataset.staffReturnClub || null,
      });
      return;
    }
    // 任意界面：点击球员名打开资料
    const playerLink = e.target.closest("[data-player-link]");
    if (playerLink) {
      e.preventDefault();
      e.stopPropagation();
      const sourceWrap = playerLink.closest(".table-wrap");
      showPlayerModal(playerLink.dataset.playerLink, {
        nationCode: playerLink.dataset.playerNation || null,
        squadNumber: playerLink.dataset.playerNumber ? Number(playerLink.dataset.playerNumber) : null,
        browseType: playerLink.dataset.playerBrowse || null,
        browseId: playerLink.dataset.playerBrowseId || null,
        competitionId: playerLink.dataset.playerCompetition || null,
        returnScrollTop: sourceWrap?.scrollTop || 0,
        returnModalScrollTop: $("#modal-card")?.scrollTop || 0,
      });
    }
  });

  $("#modal-close").onclick = () => closeModal();
  $("#modal").onclick = (e) => {
    if (e.target.id === "modal") closeModal();
  };
  document.addEventListener("keydown", (e) => {
    const motionReviewOpen = !$("#match-motion-review")?.classList.contains("hidden");
    if (motionReviewOpen && e.key === "Escape") {
      e.preventDefault();
      closeMotionDiagnostic();
      return;
    }
    if (motionReviewOpen && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag !== "input") {
        e.preventDefault();
        stopMotionReviewPlayback();
        renderMotionReviewFrame(motionReviewState.index + (e.key === "ArrowLeft" ? -1 : 1));
        return;
      }
    }
    if (motionReviewOpen && e.key === "Tab") {
      const focusable = [...$("#match-motion-review")?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []].filter((element) => element.offsetParent !== null);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      return;
    }
    const modalOpen = !$("#modal")?.classList.contains("hidden");
    if (e.key === "Escape" && modalOpen) {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === "Tab" && modalOpen) {
      const focusable = [...$("#modal")?.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []].filter((element) => element.offsetParent !== null);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    if (
      modalOpen &&
      activePlayerBrowseContext &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      const tag = e.target?.tagName?.toLowerCase();
      const typing = e.target?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
      if (!typing) {
        e.preventDefault();
        navigatePlayerBrowse(e.key === "ArrowLeft" ? -1 : 1);
        return;
      }
    }
    if (!$("#screen-main")?.classList.contains("active")) return;
    const tag = e.target?.tagName?.toLowerCase();
    const typing = e.target?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
    const commandKey = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
    const slashKey = e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!commandKey && !slashKey) return;
    e.preventDefault();
    openGlobalSearch();
  });

  // match buttons
  $("#btn-sim-fast").onclick = () => runMatch("fast");
  $("#btn-sim-live").onclick = () => runMatch("live");
  $("#btn-sim-instant").onclick = () => runMatch("instant");
  $("#btn-match-continue").onclick = () => {
    const wasReview = !!matchPlayback.reviewMode;
    closeMotionDiagnostic();
    if (!wasReview) autosave("after-match");
    destroyLoadedMatchView();
    matchView = null;
    matchPlayback.reviewMode = false;
    // 恢复按钮文案（回顾时改成了「返回俱乐部」）
    const cont = $("#btn-match-continue");
    if (cont) cont.textContent = t("match.continue");
    showScreen("main");
    pendingMatch = null;
    matchState = null;
    pendingSubs = [];
    updateMotionCaptureUI(null);
    refreshAll();
    if (wasReview) {
      // 回到赛程页，方便连续回看
      const tabBtn = document.querySelector('[data-tab="fixtures"]');
      if (tabBtn) tabBtn.click();
    }
  };

  // 赛程：点击「战报」打开旧场回看
  $("#fixtures-table")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".fix-report-btn");
    if (!btn) return;
    e.preventDefault();
    try {
      await openPastMatchReport(btn.dataset.fixtureKey);
    } catch (error) {
      console.error(error);
      toast(getLang() === "en" ? "Match report failed to load" : "比赛战报加载失败");
    }
  });

  // 中场调整
  const bindHtVal = (inputId, valId) => {
    const el = $(inputId);
    if (!el) return;
    el.oninput = () => {
      const v = $(valId);
      if (v) v.textContent = el.value;
    };
  };
  bindHtVal("#ht-pressing", "#ht-pressing-val");
  bindHtVal("#ht-tempo", "#ht-tempo-val");
  bindHtVal("#ht-width", "#ht-width-val");
  bindHtVal("#ht-def-line", "#ht-def-line-val");
  $("#btn-ht-add-sub")?.addEventListener("click", () => onHtAddSub());
  $("#btn-ht-continue")?.addEventListener("click", () => finishHalfTime(true));
  $("#btn-ht-skip")?.addEventListener("click", () => finishHalfTime(false));
  $("#btn-live-tac-apply")?.addEventListener("click", () => onLiveTacApply());
  $("#btn-live-sub-apply")?.addEventListener("click", () => onLiveSubApply());
  const bindLiveVal = (inputId, valId) => {
    $(inputId)?.addEventListener("input", (e) => {
      const el = $(valId);
      if (el) el.textContent = e.target.value;
    });
  };
  bindLiveVal("#live-pressing", "#live-pressing-val");
  bindLiveVal("#live-tempo", "#live-tempo-val");
  bindLiveVal("#live-width", "#live-width-val");
  bindLiveVal("#live-def-line", "#live-def-line-val");
}

// ---------- Refresh ----------
function refreshAll() {
  if (!world) return;
  ensureActiveCareer(world);
  renderTopbar();
  renderDashboard();
  renderFinance();
  renderSquad();
  renderYouth();
  renderFacilities();
  renderStaff();
  renderTraining();
  renderTactics();
  renderTable();
  renderClubs();
  renderCompetitions();
  renderStats();
  renderMedia();
  renderInbox();
  renderTransfer();
  renderFixtures();
  renderCareer();
  updateInboxTabBadge();
  maybeShowSeasonSummary();
  checkExportReminder();
}

/** 世界赛事页当前选中的国家队 code */
let selectedNationCode = null;
/** 世界赛事内部视图；默认先展示俱乐部欧洲赛事。 */
let selectedCompetitionCentreView = "clubs";
/** 联赛中心内部视图；顶部只保留一个入口。 */
let selectedLeagueCentreView = "table";
/** 最近查看的具体联赛；“全部联赛”仅适用于球员榜。 */
let selectedLeagueDivision = null;
/** 数据榜联赛范围：默认展示全部 11 个国内联赛。 */
let selectedStatsDivision = "all";
/** 财政流水分类筛选。 */
let financeLedgerFilter = "all";
/** 从俱乐部/国家队名单进入球员资料时，保留连续浏览与返回上下文。 */
let activePlayerBrowseContext = null;

function nationCellHtml(code, clickable = true) {
  const label = `${nationFlagHtml(code)}${escapeHtml(nationName(code, getLang()))}`;
  if (!clickable) return label;
  return `<button type="button" class="intl-nation-link" data-nation="${escapeHtml(code)}" style="background:none;border:none;padding:0;color:inherit;cursor:pointer;font:inherit;text-align:left">${label}</button>`;
}

function nationalTeamView(code) {
  const nation = NATIONALITIES.find((item) => item.code === code);
  const kit = NATIONAL_TEAM_KITS[code] || {
    style: "solid",
    primary: "#334155",
    secondary: "#f8fafc",
    numberColor: "#f8fafc",
  };
  return {
    id: `national-${code}`,
    name: nation?.name || code,
    nameEn: nation?.nameEn || code,
    color: kit.primary,
    kit: { ...kit },
  };
}

/** meta / record 由调用方传入，避免在同一次渲染里重复全量统计。 */
function nationDetailHtml(code, competitionId = null, meta = null, record = null) {
  if (!world || !code) return "";
  const en = getLang() === "en";
  const squad = nationalSquad(world, code);
  const nationalTeam = nationalTeamView(code);
  const eventStats = nationalCompetitionStats(world, code, competitionId);
  if (!squad.length) {
    return `<p class="muted">${nationFlagHtml(code)}${escapeHtml(nationName(code, getLang()))} — ${escapeHtml(
      en ? "No eligible players in world pool." : "人才池中暂无可用球员。"
    )}</p>`;
  }
  const recText = en
    ? `${record.played} played · ${record.w}W ${record.d}D ${record.l}L · GD ${record.gd}`
    : `${record.played} 场 · ${record.w}胜 ${record.d}平 ${record.l}负 · 净胜 ${record.gd}`;
  return `
    <div class="row-between" style="flex-wrap:wrap;gap:0.35rem;margin-bottom:0.45rem">
      <strong style="font-size:var(--fs-lg)">${nationFlagHtml(code)}${escapeHtml(nationName(code, getLang()))}</strong>
      <span class="muted" style="font-size:var(--fs-base)">${escapeHtml(
        en
          ? `Pool ${meta?.pool ?? "—"} · XI OVR ${meta?.strength ?? "—"}`
          : `人才池 ${meta?.pool ?? "—"} · 首发均能 ${meta?.strength ?? "—"}`
      )}</span>
    </div>
    <p class="muted" style="margin:0 0 0.5rem;font-size:var(--fs-base)">${escapeHtml(recText)}</p>
    <h3 style="margin:0 0 0.35rem;font-size:var(--fs-base)">${escapeHtml(t("intl.squad"))}</h3>
    <div class="table-wrap" style="max-height:22rem;overflow:auto">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>${escapeHtml(en ? "Pos" : "位置")}</th>
            <th>${escapeHtml(en ? "Player" : "球员")}</th>
            <th>${escapeHtml(en ? "Club" : "俱乐部")}</th>
            <th>OVR</th>
            <th title="${escapeHtml(en ? "Season average / last rating" : "赛季场均 / 上一场评分")}">${escapeHtml(en ? "Form" : "状态")}</th>
            <th>${escapeHtml(en ? "Fit" : "体能")}</th>
            <th title="${escapeHtml(en ? "Ability, form, playing time, fitness and international continuity" : "综合能力、状态、出场、体能与国家队连续性")}">${escapeHtml(en ? "Call-up" : "征召分")}</th>
            <th>${escapeHtml(en ? "Caps" : "场")}</th>
            <th>${escapeHtml(en ? "G" : "球")}</th>
            <th>${escapeHtml(en ? "A" : "助")}</th>
          </tr>
        </thead>
        <tbody>
          ${squad
            .map(({ player, club, lastCalledUp, selectionScore, squadNumber }) => {
              const intl = player.intl || {};
              const ev = eventStats.get(player.id);
              const mark = lastCalledUp ? " ★" : "";
              const nationalScout = scoutPlayerSnapshot(world, player, getUserClub(world), {
                ownPlayer: club?.id === world.userClubId,
                club,
              });
              const apps = player.stats?.apps || 0;
              const avgRating = apps > 0 && (player.stats?.ratingSum || 0) > 0 ? player.stats.ratingSum / apps : null;
              const lastRating = player.stats?.lastRating;
              const form = avgRating == null && lastRating == null ? "—" : `${avgRating == null ? "—" : avgRating.toFixed(1)} / ${lastRating == null ? "—" : Number(lastRating).toFixed(1)}`;
              return `<tr>
                <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(nationalTeam)}">${squadNumber ?? "—"}</span></td>
                <td>${escapeHtml(player.pos || "—")}</td>
                <td class="name-with-avatar">${playerAvatarHtml(player, nationalTeam, 32)} <span>${playerLinkHtml(
                  player.id,
                  player.name || "—",
                  "",
                  {
                    nationCode: code,
                    squadNumber,
                    browseType: "nation",
                    browseId: code,
                    competitionId,
                  }
                )}${mark}</span></td>
                <td>${club ? clubLinkHtml(club.id, club.name) : "—"}</td>
                <td>${escapeHtml(nationalScout?.ovrText || "—")}</td>
                <td>${escapeHtml(form)}</td>
                <td>${Math.round(player.fitness ?? 100)}%</td>
                <td><strong>${Number(selectionScore || 0).toFixed(1)}</strong></td>
                <td>${intl.caps || 0}${ev?.apps ? ` <span class="muted">(${ev.apps})</span>` : ""}</td>
                <td>${intl.goals || 0}${ev?.goals ? ` <span class="muted">(+${ev.goals})</span>` : ""}</td>
                <td>${intl.assists || 0}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="hint" style="margin:0.4rem 0 0;font-size:var(--fs-sm)">${escapeHtml(
      en ? "★ last match XI · (n) this competition" : "★ 最近一场首发 · (n) 为本赛事数据"
    )}</p>`;
}

function showNationModal(code, competitionId = null) {
  if (!world || !code) return;
  activePlayerBrowseContext = null;
  ensureInternational(world);
  const teams = listNationalTeams(world);
  const records = nationalRecords(world);
  const meta = teams.find((item) => item.code === code) || null;
  const record = records.get(code) || emptyNationRow();
  const body = $("#modal-body");
  if (!body) return;
  body.innerHTML = nationDetailHtml(code, competitionId, meta, record);
  $("#modal-card")?.classList.remove("search-modal");
  $("#modal-card")?.classList.add("wide");
  openSharedModal();
}

function renderNationalTeamsPanel(competitionId = null) {
  if (!world) return;
  const body = $("#intl-nations tbody");
  const countEl = $("#intl-nations-count");
  if (!body) return;
  const en = getLang() === "en";
  const teams = listNationalTeams(world);
  const eligible = teams.filter((item) => item.eligible).length;
  if (countEl) {
    countEl.textContent = en
      ? `${eligible} eligible / ${teams.length} nations`
      : `${eligible} 支可参赛 / 共 ${teams.length} 国`;
  }
  if (!selectedNationCode || !teams.some((item) => item.code === selectedNationCode)) {
    selectedNationCode = teams.find((item) => item.eligible)?.code || teams[0]?.code || null;
  }
  const records = nationalRecords(world);
  body.innerHTML = teams
    .map((item, index) => {
      const rec = records.get(item.code);
      const active = item.code === selectedNationCode ? ' class="row-active"' : "";
      const recLabel = rec?.played ? `${rec.w}-${rec.d}-${rec.l}` : "—";
      return `<tr data-nation="${escapeHtml(item.code)}"${active} style="cursor:pointer${item.eligible ? "" : ";opacity:0.55"}">
        <td>${index + 1}</td>
        <td>${nationFlagHtml(item.code)}${escapeHtml(nationName(item.code, getLang()))}</td>
        <td>${item.pool}</td>
        <td>${item.eligible ? item.strength : "—"}</td>
        <td>${recLabel}</td>
      </tr>`;
    })
    .join("");
}

function syncCompetitionCentreView() {
  const clubsActive = selectedCompetitionCentreView !== "nations";
  const clubsView = $("#competition-clubs-view");
  const nationsView = $("#competition-nations-view");
  if (clubsView) clubsView.hidden = !clubsActive;
  if (nationsView) nationsView.hidden = clubsActive;
  $$('[data-competition-centre-view]').forEach((button) => {
    const active = button.dataset.competitionCentreView === (clubsActive ? "clubs" : "nations");
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function setCompetitionCentreView(view) {
  selectedCompetitionCentreView = view === "nations" ? "nations" : "clubs";
  syncCompetitionCentreView();
  renderCompetitions();
}

function continentalStageLabel(stage) {
  const en = getLang() === "en";
  if (stage === "league") return t("clubIntl.leagueStage");
  if (stage === "QF") return en ? "Quarter-finals" : "四分之一决赛";
  if (stage === "SF") return en ? "Semi-finals" : "半决赛";
  if (stage === "F") return en ? "Final" : "决赛";
  if (stage === "done") return t("intl.completed");
  return stage || "—";
}

function continentalRoundLabel(fixture) {
  const en = getLang() === "en";
  if (fixture.competitionType === "continental-league-stage") {
    return en
      ? `${t("clubIntl.leagueStage")} · MD ${fixture.round || "—"}`
      : `${t("clubIntl.leagueStage")} · 第 ${fixture.round || "—"} 比赛日`;
  }
  return continentalStageLabel(fixture.round);
}

function renderClubCompetitionPlayerLeaders(competition) {
  const goalsBody = $("#club-competition-goals tbody");
  const assistsBody = $("#club-competition-assists tbody");
  const ratingsBody = $("#club-competition-ratings tbody");
  const keepersBody = $("#club-competition-keepers tbody");
  if (!goalsBody || !assistsBody || !ratingsBody || !keepersBody) return;
  const empty = escapeHtml(t("clubIntl.emptyPlayers"));
  if (!competition) {
    goalsBody.innerHTML = `<tr><td colspan="6" class="muted">${empty}</td></tr>`;
    assistsBody.innerHTML = `<tr><td colspan="6" class="muted">${empty}</td></tr>`;
    ratingsBody.innerHTML = `<tr><td colspan="6" class="muted">${empty}</td></tr>`;
    keepersBody.innerHTML = `<tr><td colspan="8" class="muted">${empty}</td></tr>`;
    return;
  }

  const { goals, assists, ratings, keepers } = continentalPlayerLeaders(world, competition.id);
  const rowClass = (club) => (club.id === world.userClubId ? "me" : "");
  goalsBody.innerHTML = goals.length
    ? goals
        .map(({ player, club, stats }, index) => `<tr class="${rowClass(club)}">
          <td>${index + 1}</td><td>${playerLinkHtml(player.id, player.name)}</td>
          <td>${clubLinkHtml(club.id, club.short)}</td><td><strong>${stats.goals}</strong></td>
          <td>${stats.assists}</td><td>${stats.apps}</td>
        </tr>`)
        .join("")
    : `<tr><td colspan="6" class="muted">${empty}</td></tr>`;
  assistsBody.innerHTML = assists.length
    ? assists
        .map(({ player, club, stats }, index) => `<tr class="${rowClass(club)}">
          <td>${index + 1}</td><td>${playerLinkHtml(player.id, player.name)}</td>
          <td>${clubLinkHtml(club.id, club.short)}</td><td><strong>${stats.assists}</strong></td>
          <td>${stats.goals}</td><td>${stats.apps}</td>
        </tr>`)
        .join("")
    : `<tr><td colspan="6" class="muted">${empty}</td></tr>`;
  ratingsBody.innerHTML = ratings.length
    ? ratings
        .map(({ player, club, stats, avgRating }, index) => `<tr class="${rowClass(club)}">
          <td>${index + 1}</td><td>${playerLinkHtml(player.id, player.name)}</td>
          <td>${clubLinkHtml(club.id, club.short)}</td>
          <td class="rating-cell ${ratingClass(avgRating)}"><strong>${formatRating(avgRating)}</strong></td>
          <td class="rating-cell ${ratingClass(stats.lastRating)}">${formatRating(stats.lastRating)}</td>
          <td>${stats.apps}</td>
        </tr>`)
        .join("")
    : `<tr><td colspan="6" class="muted">${empty}</td></tr>`;
  keepersBody.innerHTML = keepers.length
    ? keepers
        .map(({ player, club, stats, avgRating, gaPerGame }, index) => `<tr class="${rowClass(club)}">
          <td>${index + 1}</td><td>${playerLinkHtml(player.id, player.name)}</td>
          <td>${clubLinkHtml(club.id, club.short)}</td><td>${stats.apps}</td>
          <td><strong>${stats.cleanSheets}</strong></td><td>${stats.goalsConceded}</td>
          <td>${gaPerGame.toFixed(2)}</td>
          <td class="rating-cell ${ratingClass(avgRating)}">${formatRating(avgRating)}</td>
        </tr>`)
        .join("")
    : `<tr><td colspan="8" class="muted">${empty}</td></tr>`;
}

function renderClubCompetitions() {
  const select = $("#club-competition");
  const summary = $("#club-competition-summary");
  const tableBody = $("#club-competition-table tbody");
  const matchesBody = $("#club-competition-matches tbody");
  if (!select || !summary || !tableBody || !matchesBody) return;

  ensureCompetitions(world);
  const en = getLang() === "en";
  const order = { champions: 0, union: 1, conference: 2 };
  const competitions = Object.values(world.continentals || {}).sort(
    (a, b) => (order[a.key] ?? 99) - (order[b.key] ?? 99)
  );
  const previous = select.value;
  select.innerHTML = competitions.length
    ? competitions
        .map((competition) => {
          const name = en ? competition.nameEn || competition.name : competition.name;
          return `<option value="${escapeHtml(competition.id)}">${escapeHtml(name)} · S${competition.season}</option>`;
        })
        .join("")
    : `<option value="">${escapeHtml(t("clubIntl.noComp"))}</option>`;
  if (previous && [...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
  if (!select._bound) {
    select._bound = true;
    select.addEventListener("change", () => renderClubCompetitions());
  }

  const competition = competitions.find((item) => item.id === select.value) || competitions[0] || null;
  if (!competition) {
    summary.textContent = t("clubIntl.noComp");
    tableBody.innerHTML = `<tr><td colspan="10" class="muted">${escapeHtml(t("clubIntl.noComp"))}</td></tr>`;
    matchesBody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(t("clubIntl.emptyMatches"))}</td></tr>`;
    renderClubCompetitionPlayerLeaders(null);
    return;
  }

  const name = en ? competition.nameEn || competition.name : competition.name;
  const completed = competition.stage === "done";
  const champion = competition.champion
    ? clubLinkHtml(competition.champion, null, "club-link-compact")
    : "";
  summary.innerHTML = `<strong>${escapeHtml(name)}</strong>
    · ${(competition.participants || []).length}${en ? " clubs" : " 队"}
    · ${escapeHtml(t("clubIntl.stage"))}: ${escapeHtml(continentalStageLabel(competition.stage))}
    · ${escapeHtml(completed ? t("intl.completed") : t("intl.inProgress"))}
    ${champion ? ` · ${escapeHtml(t("intl.champion"))}: ${champion}` : ""}`;

  const rows = sortedContinentalTable(competition);
  tableBody.innerHTML = rows.length
    ? rows
        .map((row, index) => {
          const rank = index + 1;
          const me = row.id === world.userClubId;
          const zone = rank <= 8
            ? ` <span class="badge MID">${escapeHtml(en ? "KO" : "晋级")}</span>`
            : "";
          return `<tr class="${me ? "me" : ""}">
            <td>${rank}</td>
            <td>${clubLinkHtml(row.id)}${me ? " ★" : ""}${zone}</td>
            <td>${row.played || 0}</td><td>${row.w || 0}</td><td>${row.d || 0}</td><td>${row.l || 0}</td>
            <td>${row.gf || 0}</td><td>${row.ga || 0}</td>
            <td>${row.gd > 0 ? "+" : ""}${row.gd || 0}</td><td><strong>${row.pts || 0}</strong></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="10" class="muted">${escapeHtml(t("clubIntl.noComp"))}</td></tr>`;

  const fixtures = [...(competition.fixtures || [])].sort(
    (a, b) => (a.day || 0) - (b.day || 0) || String(a.id).localeCompare(String(b.id))
  );
  const firstPending = fixtures.findIndex((fixture) => !fixture.played);
  const start = Math.max(0, firstPending < 0 ? fixtures.length - 40 : firstPending - 12);
  const visibleFixtures = fixtures.slice(start, start + 40);
  matchesBody.innerHTML = visibleFixtures.length
    ? visibleFixtures
        .map((fixture) => {
          const score = fixture.played
            ? `${fixture.homeGoals ?? 0} - ${fixture.awayGoals ?? 0}`
            : "—";
          return `<tr class="${fixture.home === world.userClubId || fixture.away === world.userClubId ? "me" : ""}">
            <td>D${fixture.day ?? "—"}<div class="muted" style="font-size:var(--fs-xs)">${escapeHtml(continentalRoundLabel(fixture))}</div></td>
            <td>${clubLinkHtml(fixture.home)}</td>
            <td><strong>${score}</strong></td>
            <td>${clubLinkHtml(fixture.away)}</td>
            <td>${escapeHtml(fixture.played ? t("clubIntl.finished") : t("clubIntl.scheduled"))}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="muted">${escapeHtml(t("clubIntl.emptyMatches"))}</td></tr>`;
  renderClubCompetitionPlayerLeaders(competition);
}

/** 世界赛事：欧洲俱乐部赛事与国家队赛事。 */
function renderCompetitions() {
  if (!world) return;
  syncCompetitionCentreView();
  renderClubCompetitions();
  const sumEl = $("#intl-summary");
  const tablesEl = $("#intl-tables");
  const matchesBody = $("#intl-matches tbody");
  const scorersEl = $("#intl-scorers");
  const assistsEl = $("#intl-assists");
  const appearancesEl = $("#intl-appearances");
  const keepersEl = $("#intl-keepers");
  const historyEl = $("#intl-history");
  const sel = $("#intl-competition");
  if (!sumEl || !tablesEl || !matchesBody) return;

  ensureInternational(world);
  const list = listInternationalCompetitions(world);
  const en = getLang() === "en";

  if (sel) {
    const prev = sel.value;
    sel.innerHTML = list.length
      ? list
          .map((c) => {
            const name = en ? c.nameEn || c.name : c.name;
            const mark = c.completed ? (en ? " ✓" : " ✓") : "";
            const n = c.participants?.length ? ` · ${c.participants.length}${en ? "t" : "队"}` : "";
            return `<option value="${escapeHtml(c.id)}">${escapeHtml(name)} · S${c.season}${n}${mark}</option>`;
          })
          .join("")
      : `<option value="">${escapeHtml(t("intl.noComp"))}</option>`;
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else if (world.international?.activeCompetitionId) {
      const aid = world.international.activeCompetitionId;
      if ([...sel.options].some((o) => o.value === aid)) sel.value = aid;
    }
    if (!sel._bound) {
      sel._bound = true;
      sel.addEventListener("change", () => renderCompetitions());
    }
  }

  const compId = sel?.value || world.international?.activeCompetitionId || list[0]?.id;
  const competition = list.find((c) => c.id === compId) || list[0] || null;

  if (!competition) {
    sumEl.textContent = t("intl.noComp");
    tablesEl.innerHTML = "";
    matchesBody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(t("intl.emptyMatches"))}</td></tr>`;
    if (scorersEl) scorersEl.textContent = "—";
    if (assistsEl) assistsEl.textContent = "—";
    if (appearancesEl) appearancesEl.textContent = "—";
    if (keepersEl) keepersEl.textContent = "—";
    if (historyEl) historyEl.textContent = "—";
    renderNationalTeamsPanel(null);
    return;
  }

  const koStage = competition.knockout?.stage;
  const stageLabel =
    competition.stage === "group"
      ? en
        ? "Group stage"
        : "小组赛"
      : competition.stage === "knockout"
        ? en
          ? koStage === "R16"
            ? "Round of 16"
            : koStage === "QF"
              ? "Quarter-finals"
              : koStage === "SF"
                ? "Semi-finals"
                : koStage === "F"
                  ? "Final"
                  : "Knockout"
          : koStage === "R16"
            ? "十六强"
            : koStage === "QF"
              ? "四分之一决赛"
              : koStage === "SF"
                ? "半决赛"
                : koStage === "F"
                  ? "决赛"
                  : "淘汰赛"
        : competition.stage === "series"
          ? en
            ? "Series"
            : "系列赛"
          : competition.stage || "—";
  const status = competition.completed ? t("intl.completed") : t("intl.inProgress");
  const champ = competition.champion
    ? `${nationFlagHtml(competition.champion)}${nationName(competition.champion, getLang())}`
    : "—";
  const partN = competition.participants?.length || 0;
  sumEl.innerHTML = `<strong>${escapeHtml(en ? competition.nameEn || competition.name : competition.name)}</strong>
    · ${partN}${en ? " teams" : " 队"}
    · ${escapeHtml(t("intl.stage"))}: ${escapeHtml(stageLabel)}
    · ${escapeHtml(status)}
    ${competition.champion ? ` · ${escapeHtml(t("intl.champion"))}: ${champ}` : ""}`;

  // tables
  let tablesHtml = "";
  if (competition.groups?.length) {
    tablesEl.style.display = "grid";
    tablesEl.style.gridTemplateColumns = competition.groups.length > 4 ? "repeat(auto-fill,minmax(14rem,1fr))" : "repeat(auto-fill,minmax(16rem,1fr))";
    for (const g of competition.groups) {
      const rows = internationalTable(competition, g.teams);
      tablesHtml += `<div class="card" style="padding:0.6rem;margin:0">
        <strong style="font-size:var(--fs-base)">${escapeHtml(t("intl.group", { id: g.id }))}</strong>
        <div class="table-wrap" style="margin-top:0.35rem">
          <table>
            <thead><tr>
              <th>#</th><th>${escapeHtml(en ? "Nation" : "国家")}</th>
              <th>${escapeHtml(en ? "P" : "赛")}</th><th>${escapeHtml(en ? "W" : "胜")}</th>
              <th>${escapeHtml(en ? "D" : "平")}</th><th>${escapeHtml(en ? "L" : "负")}</th>
              <th>${escapeHtml(en ? "GD" : "净")}</th><th>${escapeHtml(en ? "Pts" : "分")}</th>
            </tr></thead>
            <tbody>
              ${rows
                .map(
                  (r, i) => `<tr>
                <td>${i + 1}</td>
                <td>${nationCellHtml(r.code || r.id)}</td>
                <td>${r.played || 0}</td><td>${r.w || 0}</td><td>${r.d || 0}</td><td>${r.l || 0}</td>
                <td>${(r.gf || 0) - (r.ga || 0)}</td><td><strong>${r.pts || 0}</strong></td>
              </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>`;
    }
  } else {
    tablesEl.style.display = "block";
    const rows = internationalTable(competition);
    tablesHtml = `<div class="card" style="padding:0.6rem;margin:0">
      <strong style="font-size:var(--fs-base)">${escapeHtml(t("intl.series"))}</strong>
      <div class="table-wrap" style="margin-top:0.35rem;max-height:22rem;overflow:auto">
        <table>
          <thead><tr>
            <th>#</th><th>${escapeHtml(en ? "Nation" : "国家")}</th>
            <th>${escapeHtml(en ? "P" : "赛")}</th><th>${escapeHtml(en ? "W" : "胜")}</th>
            <th>${escapeHtml(en ? "D" : "平")}</th><th>${escapeHtml(en ? "L" : "负")}</th>
            <th>${escapeHtml(en ? "Pts" : "分")}</th>
            <th>${escapeHtml(en ? "GD" : "净")}</th>
          </tr></thead>
          <tbody>
            ${rows
              .map(
                (r, i) => `<tr>
              <td>${i + 1}</td>
              <td>${nationCellHtml(r.code || r.id)}</td>
              <td>${r.played || 0}</td><td>${r.w || 0}</td><td>${r.d || 0}</td><td>${r.l || 0}</td>
              <td><strong>${r.pts || 0}</strong></td>
              <td>${(r.gf || 0) - (r.ga || 0)}</td>
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }
  tablesEl.innerHTML = tablesHtml || `<p class="muted">${escapeHtml(t("intl.noComp"))}</p>`;
  const matches = internationalMatches(world, competition.id).slice().reverse().slice(0, 40);
  matchesBody.innerHTML = matches.length
    ? matches
        .map((m) => {
          const score =
            m.homeGoals != null && m.awayGoals != null
              ? `${m.homeGoals} - ${m.awayGoals}`
              : "—";
          const round = en ? m.roundLabelEn || m.roundLabel : m.roundLabel;
          return `<tr>
            <td>D${m.day ?? "—"}<div class="muted" style="font-size:var(--fs-xs)">${escapeHtml(round || "")}</div></td>
            <td>${nationCellHtml(m.home)}</td>
            <td><strong>${score}</strong>${
              m.penalties
                ? `<div class="muted" style="font-size:var(--fs-xs)">(${m.penalties.home}-${m.penalties.away} pen)</div>`
                : ""
            }</td>
            <td>${nationCellHtml(m.away)}</td>
            <td>${m.played === false ? (en ? "Sched." : "未赛") : en ? "FT" : "完场"}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="muted">${escapeHtml(t("intl.emptyMatches"))}</td></tr>`;
  const leaders = internationalLeaders(world, competition.id);
  const renderIntlLeaderList = (element, rows, valueFor) => {
    if (!element) return;
    const top = (Array.isArray(rows) ? rows : []).slice(0, 10);
    element.innerHTML = top.length
      ? `<ol style="margin:0;padding-left:1.2rem">${top
          .map(
            (item) =>
              `<li>${playerLinkHtml(item.id, item.name || item.id)} ${item.nation ? nationFlagHtml(item.nation) : ""} <strong>${escapeHtml(valueFor(item))}</strong></li>`
          )
          .join("")}</ol>`
      : "—";
  };
  renderIntlLeaderList(scorersEl, leaders?.scorers, (item) => item.value ?? 0);
  renderIntlLeaderList(assistsEl, leaders?.assists, (item) => item.value ?? 0);
  renderIntlLeaderList(appearancesEl, leaders?.appearances, (item) => item.value ?? 0);
  renderIntlLeaderList(
    keepersEl,
    leaders?.keepers,
    (item) => `${item.cleanSheets || 0} / ${item.goalsConceded || 0}`
  );
  if (historyEl) {
    const hist = world.international?.history || [];
    historyEl.innerHTML = hist.length
      ? `<ul style="margin:0;padding-left:1.2rem">${hist
          .slice(0, 8)
          .map((h) => {
            const name = en ? h.nameEn || h.name : h.name;
            const ch = h.champion ? `${nationFlagHtml(h.champion)}${nationName(h.champion, getLang())}` : "—";
            return `<li>S${h.season || "?"} ${escapeHtml(name || "")} — ${ch}</li>`;
          })
          .join("")}</ul>`
      : "—";
  }

  renderNationalTeamsPanel(competition.id);
}

/** 信箱筛选：pending | all */
let inboxFilter = "pending";

function updateInboxTabBadge() {
  if (!world) return;
  const n = pendingInboxCount(world);
  const btn = document.querySelector('.tab[data-tab="inbox"]');
  if (!btn) return;
  const base = t("tab.inbox") || (getLang() === "en" ? "Inbox" : "信箱");
  btn.textContent = n > 0 ? `${base} (${n})` : base;
  btn.classList.toggle("has-badge", n > 0);
}

function goToInboxTab() {
  activateMainTab("inbox");
}

/**
 * 把邮件引用解析为详情链接所需的实体。
 * 引用字段会随邮件类型变化，这里集中兼容旧存档和新邮件，避免让信箱
 * 重新猜测正文中的名字，也避免为详情页复制一套展示逻辑。
 */
/**
 * 单次渲染内共享的实体索引。信箱一次最多渲染 50 封邮件，每封都要按 id 回查
 * 球员和俱乐部；没有索引时每次回查都要扫遍 270 家俱乐部的全部名单，
 * 而且解析失败的 id 不会进 seen，同一个 id 还会被重复扫描。
 * 构建顺序与原来的查找顺序一致：同一俱乐部先一队后青训，最后才是已退役球员。
 */
function buildInboxEntityIndex(world) {
  const players = new Map();
  const clubs = new Map();
  for (const club of world?.clubs || []) {
    clubs.set(club.id, club);
    for (const player of club.players || []) {
      if (player?.id && !players.has(player.id)) players.set(player.id, { player, clubId: club.id });
    }
    for (const player of club.youth?.players || []) {
      if (player?.id && !players.has(player.id)) players.set(player.id, { player, clubId: club.id });
    }
  }
  for (const player of world?.retiredPlayers || []) {
    if (player?.id && !players.has(player.id)) players.set(player.id, { player, clubId: null });
  }
  return { players, clubs };
}

function inboxEntityRefs(mail, index = null) {
  if (!world || !mail) return [];
  const entityIndex = index || buildInboxEntityIndex(world);
  const ref = mail.ref || {};
  const entities = [];
  const seen = new Set();
  const add = (type, id, context = {}) => {
    if (!id) return;
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    let item = null;
    if (type === "club") {
      item = entityIndex.clubs.get(id) || null;
    } else if (type === "player") {
      const found = entityIndex.players.get(id);
      item = found?.player || null;
      if (item && found.clubId) context = { ...context, clubId: found.clubId };
    } else if (type === "nation") {
      // 这里只用得到国家的名字和代码，都是静态数据；listNationalTeams 会给每个
      // 国家重新分组全部球员并选出首发，代价远高于这一次查名字。
      item = NATIONALITIES.find((nation) => nation.code === id) || null;
    } else if (type === "staff") {
      const found = findStaffById(id, context.clubId || null);
      item = found?.staff || null;
      if (found?.club?.id) context = { ...context, clubId: found.club.id };
    }
    if (!item) return;
    const aliases = new Set();
    if (type === "club") {
      aliases.add(clubDisplayName(item));
      aliases.add(item.name);
      aliases.add(item.nameZh);
      aliases.add(item.nameEn);
      aliases.add(item.short);
      aliases.add(item.shortName);
    } else if (type === "player") {
      aliases.add(item.name);
      aliases.add(item.nameEn);
    } else if (type === "nation") {
      aliases.add(nationName(item.code, getLang()));
      aliases.add(item.name);
      aliases.add(item.nameEn);
      aliases.add(item.code);
    } else if (type === "staff") {
      aliases.add(item.name);
      aliases.add(item.nameEn);
    }
    const usableAliases = [...aliases].filter((alias) => String(alias || "").trim().length >= 2);
    if (!usableAliases.length) return;
    seen.add(key);
    entities.push({ type, id, item, aliases: usableAliases, clubId: context.clubId || null });
  };
  const addIds = (value, type, context = {}) => {
    const ids = Array.isArray(value) ? value : [value];
    ids.forEach((id) => add(type, typeof id === "object" ? id.id : id, context));
  };

  // 先补充谈判/挖角记录中的关联对象，旧邮件只保存了记录 ID 也能正常回溯。
  if (ref.kind === "poach") {
    const bid = world.poachBids?.find((item) => item.id === ref.bidId);
    add("player", ref.playerId || bid?.playerId, { clubId: ref.fromClubId || bid?.fromClubId || null });
    add("club", ref.buyerId || bid?.buyerId);
    add("club", ref.fromClubId || bid?.fromClubId);
  } else if (ref.kind === "transfer_negotiation") {
    const negotiation = world.transferNegotiations?.find((item) => item.id === ref.negotiationId);
    add("player", ref.playerId || negotiation?.playerId);
    add("club", ref.sellerClubId || negotiation?.sellerClubId);
    add("club", ref.buyerClubId || negotiation?.buyerClubId);
  } else if (ref.kind === "deal_negotiation") {
    const negotiation = world.dealNegotiations?.find((item) => item.id === ref.negotiationId);
    add("player", ref.playerId || negotiation?.playerId);
    add("club", ref.ownerClubId || negotiation?.ownerClubId);
    add("club", ref.hostClubId || negotiation?.hostClubId);
  } else if (ref.kind === "scout_report") {
    addIds(ref.playerIds, "player");
  }

  // 通用引用字段给新邮件和第三方模块使用，旧 kind 不需要额外适配。
  addIds(ref.playerId, "player", { clubId: ref.playerClubId || ref.clubId || null });
  addIds(ref.playerIds, "player");
  addIds(ref.clubId, "club");
  addIds(ref.clubIds, "club");
  addIds(ref.buyerId, "club");
  addIds(ref.sellerClubId, "club");
  addIds(ref.ownerClubId, "club");
  addIds(ref.hostClubId, "club");
  addIds(ref.nationCode, "nation");
  addIds(ref.nationCodes, "nation");
  addIds(ref.staffId, "staff", { clubId: ref.staffClubId || ref.clubId || null });
  addIds(ref.staffIds, "staff", { clubId: ref.staffClubId || ref.clubId || null });
  // 球员和职员所属单位也是邮件中的常见上下文；有明确对象事实时一并开放查阅。
  for (const entity of [...entities]) {
    if ((entity.type === "player" || entity.type === "staff") && entity.clubId) {
      add("club", entity.clubId);
    }
    if (entity.type === "player" && entity.item?.nationality) {
      add("nation", entity.item.nationality);
    }
  }
  return entities;
}

function inboxEntityLink(entity, label) {
  const className = "inbox-entity-link";
  if (entity.type === "club") return clubLinkHtml(entity.id, label, className);
  if (entity.type === "player") return playerLinkHtml(entity.id, label, className);
  if (entity.type === "staff") {
    const clubAttr = entity.clubId ? ` data-staff-club="${escapeHtml(entity.clubId)}"` : "";
    return `<button type="button" class="staff-link ${className}" data-staff-link="${escapeHtml(entity.id)}"${clubAttr} data-inbox-entity="staff">${escapeHtml(label)}</button>`;
  }
  return `<button type="button" class="nation-link ${className}" data-nation="${escapeHtml(entity.id)}" data-inbox-entity="nation">${escapeHtml(label)}</button>`;
}

function renderInboxEntityText(value, entities) {
  const text = String(value || "");
  if (!text) return "";
  const aliases = [];
  const aliasMap = new Map();
  for (const entity of entities || []) {
    for (const alias of entity.aliases || []) {
      const normalized = String(alias || "").trim();
      if (normalized.length < 2) continue;
      const key = normalized.toLocaleLowerCase();
      if (!aliasMap.has(key)) aliasMap.set(key, entity);
      else if (aliasMap.get(key) !== entity) aliasMap.set(key, null);
      aliases.push(normalized);
    }
  }
  const uniqueAliases = [...new Set(aliases)].sort((a, b) => b.length - a.length);
  if (!uniqueAliases.length) return escapeHtml(text).replace(/\r?\n/g, "<br>");
  const escaped = uniqueAliases.map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matcher = new RegExp(escaped.join("|"), "gi");
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    const index = match.index ?? 0;
    html += escapeHtml(text.slice(cursor, index)).replace(/\r?\n/g, "<br>");
    const entity = aliasMap.get(String(match[0]).toLocaleLowerCase()) || null;
    const before = index > 0 ? text[index - 1] : "";
    const after = text[index + match[0].length] || "";
    const needsLeftBoundary = /^[A-Za-z0-9]/.test(match[0]);
    const needsRightBoundary = /[A-Za-z0-9]$/.test(match[0]);
    const insideWord =
      (needsLeftBoundary && /[A-Za-z0-9]/.test(before)) ||
      (needsRightBoundary && /[A-Za-z0-9]/.test(after));
    html += entity && !insideWord ? inboxEntityLink(entity, match[0]) : escapeHtml(match[0]);
    cursor = index + match[0].length;
  }
  html += escapeHtml(text.slice(cursor)).replace(/\r?\n/g, "<br>");
  return html;
}

function renderInbox() {
  if (!world) return;
  ensureInbox(world);
  syncPoachBidsToInbox(world);
  syncTransferNegotiationsToInbox(world);
  syncDealNegotiationsToInbox(world);
  const tab = document.querySelector("#tab-inbox");
  if (tab && !tab.classList.contains("active")) return;
  const en = getLang() === "en";
  const pendingOnly = inboxFilter === "pending";
  const list = listInbox(world, { pendingOnly, limit: 50 });
  const pending = pendingInboxCount(world);
  const countEl = $("#inbox-count");
  if (countEl) {
    countEl.textContent = en
      ? `${pending} pending · ${list.length} shown`
      : `待办 ${pending} · 显示 ${list.length}`;
  }

  // 筛选按钮高亮
  document.querySelectorAll("[data-inbox-filter]").forEach((b) => {
    b.classList.toggle("active", b.dataset.inboxFilter === inboxFilter);
  });

  const box = $("#inbox-list");
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<p class="muted inbox-empty">${escapeHtml(
      en
        ? pendingOnly
          ? "No pending mail — you're clear."
          : "Inbox is empty."
        : pendingOnly
          ? "暂无待办邮件，清清爽爽。"
          : "信箱为空。"
    )}</p>`;
    return;
  }

  const entityIndex = buildInboxEntityIndex(world);
  box.innerHTML = list
    .map((m) => {
      const entities = inboxEntityRefs(m, entityIndex);
      const cat = inboxCatLabel(m.category, en ? "en" : "zh");
      const st =
        m.status === "pending"
          ? en
            ? "Pending"
            : "待办"
          : m.status === "read"
            ? en
              ? "Read"
              : "已读"
            : m.status === "done"
              ? en
                ? "Done"
                : "已处理"
              : en
                ? "Expired"
                : "过期";
      const pri =
        (m.priority || 1) >= 3
          ? `<span class="inbox-pri high">${en ? "Urgent" : "紧急"}</span>`
          : (m.priority || 1) >= 2
            ? `<span class="inbox-pri mid">${en ? "Important" : "重要"}</span>`
            : "";
      const actions =
        m.status === "pending" || m.status === "read"
          ? (m.actions || [])
              .map((a) => {
                const label = en && a.labelEn ? a.labelEn : a.label;
                const cls = a.primary ? "btn small primary" : "btn small";
                return `<button type="button" class="${cls}" data-inbox-act="${escapeHtml(a.id)}" data-inbox-id="${escapeHtml(m.id)}">${escapeHtml(label)}</button>`;
              })
              .join("")
          : m.resultNote
            ? `<span class="muted inbox-result">${escapeHtml(m.resultNote)}</span>`
            : "";
      return `<article class="inbox-item cat-${escapeHtml(m.category || "system")} status-${escapeHtml(m.status)}" data-mail-id="${escapeHtml(m.id)}">
        <header class="inbox-item-head">
          <span class="inbox-cat">${escapeHtml(cat)}</span>
          ${pri}
          <span class="muted inbox-day">D${m.day}</span>
          <span class="inbox-status">${escapeHtml(st)}</span>
        </header>
        <h3 class="inbox-title">${renderInboxEntityText(en && m.titleEn ? m.titleEn : m.title, entities)}</h3>
        ${en && m.bodyEn ? `<p class="inbox-body">${renderInboxEntityText(m.bodyEn, entities)}</p>` : m.body ? `<p class="inbox-body">${renderInboxEntityText(m.body, entities)}</p>` : ""}
        <div class="inbox-actions">${actions}</div>
      </article>`;
    })
    .join("");

  box.querySelectorAll("[data-inbox-act]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.inboxId;
      const act = btn.dataset.inboxAct;
      const mail = world.inbox?.find((item) => item.id === id);
      if (act === "accept") {
        const promptText = mail?.ref?.kind === "transfer_negotiation"
          ? en
            ? "Accept these transfer terms?"
            : "确认接受这组转会条款？"
          : en
            ? "Accept offer and sell the player?"
            : "确认接受报价并放走球员？";
        if (!confirm(promptText)) return;
      }
      const res = resolveInboxAction(world, id, act);
      toast(res.msg || (res.ok ? "OK" : "失败"));
      if (res.sacked || world.sacked) {
        handleSacked(res);
        return;
      }
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });
  // 点标题标已读
  box.querySelectorAll(".inbox-item").forEach((el) => {
    el.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-inbox-act], .inbox-entity-link")) return;
      const id = el.dataset.mailId;
      if (markInboxRead(world, id)) {
        saveGame(world);
        renderInbox();
        updateInboxTabBadge();
      }
    });
  });
}

function injuryDays(player) {
  ensurePlayerInjury(player);
  return Math.max(0, Math.ceil(Number(player?.injured) || 0));
}

function injuryStatusText(player, en = getLang() === "en") {
  const days = injuryDays(player);
  if (days) return en ? `Inj ${days}d` : `伤 ${days}天`;
  const monitored = Math.max(0, Math.ceil(Number(player?.returnToPlayDays) || 0));
  if (!monitored) return "";
  return en ? `RTP ${monitored}d` : `观察 ${monitored}天`;
}

function injuryDetailText(player, en = getLang() === "en") {
  return injuryLabel(player, en ? "en" : "zh");
}

function renderTraining() {
  const club = getUserClub(world);
  if (!club) return;
  const en = getLang() === "en";
  const coachControlled = isFullyDelegated(world, club, "training");
  const t = ensureTraining(club);
  const sum = trainingSummary(club);
  const focusCopy = {
    balanced: ["Balanced", "General development across the squad"],
    attack: ["Attacking", "Finishing, dribbling and movement"],
    defense: ["Defending", "Tackling, marking and shape"],
    technical: ["Technical", "Passing, vision and close control"],
    fitness: ["Fitness", "Stamina and physical conditioning"],
    goalkeeping: ["Goalkeeping", "Keeper handling and reflexes"],
    youth: ["Youth development", "Extra growth for academy players"],
    recovery: ["Recovery", "Restore fitness and reduce injury risk"],
    match_prep: ["Match preparation", "Prepare the squad for matchday"],
  };
  const intensityCopy = { light: "Light", normal: "Normal", hard: "High intensity" };

  const focusBox = $("#training-focus-list");
  if (focusBox) {
    focusBox.innerHTML = Object.values(TRAINING_FOCUSES)
      .map(
        (f) => `<button type="button" class="training-opt${
          t.focus === f.key ? " active" : ""
        }" data-focus="${f.key}">
          <div class="opt-title">${escapeHtml(en ? focusCopy[f.key]?.[0] || f.key : f.label)}</div>
          <div class="opt-desc">${escapeHtml(en ? focusCopy[f.key]?.[1] || "" : f.desc)}</div>
        </button>`
      )
      .join("");
    focusBox.querySelectorAll("[data-focus]").forEach((btn) => {
      btn.disabled = coachControlled;
      btn.onclick = () => {
        setTraining(club, { focus: btn.dataset.focus });
        autosave("training-focus");
        renderTraining();
        toast(en ? `Focus: ${focusCopy[btn.dataset.focus]?.[0] || btn.dataset.focus}` : `训练重点：${TRAINING_FOCUSES[btn.dataset.focus].label}`);
      };
    });
  }

  const intBox = $("#training-intensity-list");
  if (intBox) {
    intBox.innerHTML = Object.values(TRAINING_INTENSITIES)
      .map(
        (i) => `<button type="button" class="training-opt${
          t.intensity === i.key ? " active" : ""
        }" data-intensity="${i.key}">
          <div class="opt-title">${escapeHtml(en ? intensityCopy[i.key] || i.key : i.label)}</div>
        </button>`
      )
      .join("");
    intBox.querySelectorAll("[data-intensity]").forEach((btn) => {
      btn.disabled = coachControlled;
      btn.onclick = () => {
        setTraining(club, { intensity: btn.dataset.intensity });
        autosave("training-intensity");
        renderTraining();
        toast(en ? `Intensity: ${intensityCopy[btn.dataset.intensity] || btn.dataset.intensity}` : `训练强度：${TRAINING_INTENSITIES[btn.dataset.intensity].label}`);
      };
    });
  }

  const sumEl = $("#training-summary");
  if (sumEl) {
    const coach = club.staff?.coach;
    const coachTxt = coach ? `${en ? "Coach" : "教练"} ${coach.name} (${coach.rating})` : `${en ? "Coach" : "教练"} —`;
    const currentLine = en ? `${focusCopy[sum.focus]?.[0] || sum.focus} · ${intensityCopy[sum.intensity] || sum.intensity}` : sum.line;
    const currentDesc = en ? focusCopy[sum.focus]?.[1] || "" : sum.desc;
    sumEl.innerHTML = `<strong>${en ? "Current:" : "当前："}</strong>${escapeHtml(currentLine)}<br>
      <span class="muted">${escapeHtml(currentDesc)}</span><br>
      <span class="muted">${escapeHtml(coachTxt)} · ${en ? "growth is applied weekly; fitness and injury risk update daily" : "每周结算属性成长 · 每日影响体能与伤病风险"}</span>`;
  }

  const players = [...(club.players || [])].sort(
    (a, b) => (a.fitness || 0) - (b.fitness || 0)
  );
  const avg =
    players.length > 0
      ? Math.round(players.reduce((s, p) => s + (p.fitness || 0), 0) / players.length)
      : 0;
  const injured = players.filter((p) => p.injured > 0).length;
  const low = players.filter((p) => (p.fitness || 0) < 65 && !(p.injured > 0)).length;

  const fitBox = $("#training-fitness-bar");
  if (fitBox) {
    const show = players.slice(0, 12);
    fitBox.innerHTML =
      show
        .map((p) => {
          const fit = Math.round(p.fitness || 0);
          const lowCls = fit < 65 || p.injured > 0 ? " low" : "";
          const tag = injuryStatusText(p, en) ? ` ${injuryStatusText(p, en)}` : "";
          return `<div class="training-fit-row${lowCls}">
            <span>${playerLinkHtml(p.id, playerDisplaySurname(p.name, p.nationality) + tag)}</span>
            <div class="bar"><i style="width:${fit}%"></i></div>
            <span class="fit-val">${fit}%</span>
          </div>`;
        })
        .join("") || `<span class="muted">${en ? "No players" : "暂无球员"}</span>`;
  }

  const hint = $("#training-hint");
  if (hint) {
    let tip = en ? `Average fitness ${avg}% · ${injured} injured · ${low} low fitness.` : `平均体能 ${avg}% · 伤病 ${injured} 人 · 低体能 ${low} 人。`;
    if (avg < 70) tip += en ? " Consider Recovery or Light intensity." : " 建议改「恢复调整」或「轻松」强度。";
    else if (t.intensity === "hard" && avg < 80) tip += en ? " Fitness is tight under high intensity; watch injury risk." : " 高强度下体能偏紧，小心训练伤。";
    else if (t.focus === "youth") tip += en ? " Youth players grow faster this week; senior growth is reduced." : " 青训侧重时本周青训成长加快，一线队成长偏慢。";
    else tip += en ? " Match preparation is useful before matchday." : " 比赛日前可切「赛前准备」。";
    hint.textContent = tip;
  }

  renderTrainingPrep(club, en, coachControlled);

  const delegate = $("#btn-delegate-training");
  if (delegate) {
    const coach = club.staff?.coach;
    delegate.textContent = coachControlled
      ? (en ? "Managed by head coach" : "由主教练持续安排")
      : (en ? "Delegate to assistant" : "委托助理教练安排");
    delegate.disabled = coachControlled;
    delegate.title = coach
      ? (en ? `${coach.name} · Ability ${coach.rating}` : `${coach.name} · 能力 ${coach.rating}`)
      : "";
    delegate.onclick = () => {
      const plan = assistantTrainingPlan(world, club);
      setTraining(club, { focus: plan.focus, intensity: plan.intensity });
      const prepResult = setTrainingMode(club, plan.prepMode, world.day);
      autosave("assistant-training-plan");
      renderTraining();
      const focusLabel = en ? focusCopy[plan.focus]?.[0] || plan.focus : TRAINING_FOCUSES[plan.focus]?.label || plan.focus;
      const intensityLabel = en ? intensityCopy[plan.intensity] || plan.intensity : TRAINING_INTENSITIES[plan.intensity]?.label || plan.intensity;
      const prep = TRAINING_MODES[plan.prepMode];
      const prepLabel = en ? prep?.labelEn || plan.prepMode : prep?.label || plan.prepMode;
      const prepNote = prepResult.ok
        ? ` · ${en ? "Prep" : "备战"} ${prepLabel}`
        : ` · ${en ? "Prep unchanged (cooldown)" : "备战方案因冷却保持不变"}`;
      toast(`${en ? "Assistant plan" : "助教安排"}：${focusLabel} · ${intensityLabel}${prepNote}。${en ? plan.reasonEn : plan.reason}`);
    };
  }
}

/** 赛前备战：训练模式短期加成（影响下一场比赛） */
const PREP_MODE_ICONS = {
  balanced: "⚖️",
  attack: "⚽",
  defense: "🛡️",
  fitness: "💪",
  morale: "😊",
  setpiece: "🎯",
};

function renderTrainingPrep(club, en, coachControlled) {
  const boost = ensureTrainingBoost(club);
  const modeBox = $("#training-mode-list");
  if (modeBox) {
    modeBox.innerHTML = Object.entries(TRAINING_MODES)
      .map(
        ([key, m]) => `<button type="button" class="training-opt${
          boost.mode === key ? " active" : ""
        }" data-prep-mode="${key}">
          <div class="opt-title">${PREP_MODE_ICONS[key] || ""} ${escapeHtml(
            en ? m.labelEn : m.label
          )}</div>
          <div class="opt-desc">${escapeHtml(en ? m.descEn : m.desc)}</div>
        </button>`
      )
      .join("");
    modeBox.querySelectorAll("[data-prep-mode]").forEach((btn) => {
      btn.disabled = coachControlled;
      btn.onclick = () => {
        const r = setTrainingMode(club, btn.dataset.prepMode, world.day);
        const msg = en ? r.msgEn || r.msg : r.msg;
        if (!r.ok) {
          toast(msg);
          return;
        }
        autosave("training-prep-mode");
        renderTraining();
        toast(msg);
      };
    });
  }

  const sumEl = $("#training-mode-summary");
  if (!sumEl) return;
  const cur = TRAINING_MODES[boost.mode] || TRAINING_MODES.balanced;

  // 效果与代价明细
  const effects = [];
  const pct = (v) => `${v > 0 ? "+" : ""}${v}%`;
  if (cur.attacking) effects.push(en ? `Attack ${pct(cur.attacking)}` : `进攻 ${pct(cur.attacking)}`);
  if (cur.defending) effects.push(en ? `Defence ${pct(cur.defending)}` : `防守 ${pct(cur.defending)}`);
  if (cur.setpiece) effects.push(en ? `Set pieces ${pct(cur.setpiece)}` : `定位球 ${pct(cur.setpiece)}`);
  if (cur.fitness) effects.push(en ? `Fitness ${cur.fitness > 0 ? "+" : ""}${cur.fitness}` : `体能 ${cur.fitness > 0 ? "+" : ""}${cur.fitness}`);
  if (cur.morale) effects.push(en ? `Morale ${cur.morale > 0 ? "+" : ""}${cur.morale}` : `士气 ${cur.morale > 0 ? "+" : ""}${cur.morale}`);
  if (cur.injury) effects.push(en ? `Injury risk ${pct(Math.round(cur.injury * 100))}` : `受伤风险 ${pct(Math.round(cur.injury * 100))}`);

  // 冷却状态
  const sinceChange = world.day - (boost.lastChanged || 0);
  const wait = boost.lastChanged > 0 ? Math.max(0, 3 - sinceChange) : 0;
  const cdLine = wait > 0
    ? en ? `Can switch again in ${wait} day(s)` : `${wait} 天后可再次调整`
    : en ? "Ready to switch" : "可随时调整";

  // 下场对手
  const next = getNextUserMatch(world);
  let oppLine = "";
  if (next) {
    const oppId = next.home === club.id ? next.away : next.home;
    const opp = world.clubs.find((c) => c.id === oppId);
    if (opp) {
      const atHome = next.home === club.id;
      const oppOvr = opp.players?.length
        ? Math.round(opp.players.reduce((s, p) => s + (p.ovr || 0), 0) / opp.players.length)
        : null;
      oppLine = en
        ? `Next: ${opp.name} (${atHome ? "H" : "A"}${oppOvr ? `, avg OVR ${oppOvr}` : ""})`
        : `下场对手：${opp.name}（${atHome ? "主" : "客"}场${oppOvr ? `，平均能力 ${oppOvr}` : ""}）`;
    }
  }

  sumEl.innerHTML = `<strong>${en ? "Current:" : "当前："}</strong>${escapeHtml(
    `${PREP_MODE_ICONS[boost.mode] || ""} ${en ? cur.labelEn : cur.label}`
  )}<br>
    <span class="muted">${escapeHtml(
      effects.length ? effects.join(" · ") : en ? "No special bonus" : "无特殊加成"
    )}</span><br>
    <span class="muted">${escapeHtml(cdLine)}${oppLine ? ` · ${escapeHtml(oppLine)}` : ""}</span>`;
}

function renderDelegationCenter(club, en) {
  const box = $("#delegation-center");
  if (!box) return;
  const delegation = ensureDelegation(world, club);
  const coach = club.staff?.coach;
  const directorMode = world.managementMode === "club_director";
  const responsibilityOptions = {
    training: [
      ["player", en ? "Player controlled" : "玩家负责"],
      ["staff", en ? "Staff continuously manage" : "教练团队持续代管"],
    ],
    lineup: [
      ["player", en ? "Player controlled" : "玩家负责"],
      ["confirm", en ? "Staff suggestion, confirm" : "教练建议，确认后应用"],
      ["staff", en ? "Staff fully manage" : "教练团队完全代管"],
    ],
    tactics: [
      ["player", en ? "Player controlled" : "玩家负责"],
      ["confirm", en ? "Staff suggestion, confirm" : "教练建议，确认后应用"],
      ["staff", en ? "Staff fully manage" : "教练团队完全代管"],
    ],
    matchday: [
      ["player", en ? "Player controlled" : "玩家负责"],
      ["emergency", en ? "Emergency injury cover" : "仅伤退紧急代管"],
      ["staff", en ? "Staff fully manage" : "教练团队完全代管"],
    ],
    development: [
      ["player", en ? "Player principles" : "玩家制定原则"],
      ["staff", en ? "Staff execute principles" : "教练团队执行原则"],
    ],
  };
  const labels = {
    training: en ? "Training" : "训练安排",
    lineup: en ? "Starting XI" : "首发阵容",
    tactics: en ? "Pre-match tactics" : "赛前战术",
    matchday: en ? "Matchday changes" : "临场换人",
    development: en ? "Player development" : "年轻球员培养",
  };
  const selectHtml = (key) => `<label class="delegation-field"><span>${labels[key]}</span>
    <select data-delegation-key="${key}"${directorMode ? " disabled" : ""}>
      ${responsibilityOptions[key].map(([value, label]) => `<option value="${value}"${delegation[key] === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}
    </select></label>`;
  const locked = new Set(delegation.locks.playerIds);
  const playerOptions = [...(club.players || [])]
    .sort((a, b) => (b.ovr || 0) - (a.ovr || 0))
    .map((player) => `<option value="${escapeHtml(player.id)}"${locked.has(player.id) ? " selected" : ""}>${escapeHtml(player.name)} · ${positionLabel(player.pos)} · ${player.ovr}</option>`)
    .join("");
  const coreOptions = (club.players || [])
    .filter((player) => player.pos !== "GK")
    .sort((a, b) => (b.ovr || 0) - (a.ovr || 0))
    .map((player) => `<option value="${escapeHtml(player.id)}"${delegation.locks.corePlayerId === player.id ? " selected" : ""}>${escapeHtml(player.name)} · ${player.ovr}</option>`)
    .join("");
  const developmentPlan = delegation.developmentPlan;
  const developmentPlanLine = developmentPlan
    ? `<div class="delegation-status"><strong>${en ? "Development plan" : "当前培养计划"}：</strong>${escapeHtml(en ? developmentPlan.reasonEn : developmentPlan.reason)} · ${en ? "updated Day" : "更新于第"} ${developmentPlan.day}${en ? "" : " 天"}</div>`
    : "";
  box.innerHTML = `<div class="row-between delegation-heading">
      <div><h2>${en ? "Responsibilities" : "职责委托中心"}</h2>
      <p class="hint">${en ? "Staff decisions use the actual squad, fitness, form, schedule and coach ability. Delegation adds no hidden match bonus." : "自动决策读取真实阵容、体能、状态、赛程与教练能力，不添加隐藏比赛加成。"}</p></div>
      <label class="delegation-mode"><span>${en ? "Your role" : "玩家身份"}</span>
        <select id="management-mode-select">
          <option value="head_coach"${directorMode ? "" : " selected"}>${en ? "Head coach" : "主教练模式"}</option>
          <option value="club_director"${directorMode ? " selected" : ""}>${en ? "Club director" : "俱乐部经营模式"}</option>
        </select>
      </label>
    </div>
    <div class="delegation-status">${coach
      ? `${en ? (directorMode ? "Head coach" : "Coaching team") : (directorMode ? "聘用主教练" : "执行教练")}：<strong>${escapeHtml(coach.name)}</strong> · ${en ? "Ability" : "能力"} ${coach.rating}`
      : (en ? "No head coach available; full delegation is unavailable." : "当前没有可执行职责的主教练，无法完全委托。")}</div>
    ${developmentPlanLine}
    <div class="delegation-grid">${Object.keys(responsibilityOptions).map(selectHtml).join("")}</div>
    ${directorMode ? `<p class="hint delegation-director-note">${en ? "The employed head coach now controls training, selection, tactics and matchday decisions. You retain transfers, contracts, finance, facilities, youth intake and staff hiring." : "聘用主教练现负责训练、选人、战术与临场；你继续负责转会、合同、财政、设施、青训和聘帅。"}</p>` : ""}
    <div class="delegation-principles">
      <label><span>${en ? "Rotation" : "轮换原则"}</span><select data-principle="rotation">
        <option value="balanced"${delegation.principles.rotation === "balanced" ? " selected" : ""}>${en ? "Balanced" : "均衡"}</option>
        <option value="fitness"${delegation.principles.rotation === "fitness" ? " selected" : ""}>${en ? "Protect fitness" : "体能优先"}</option>
        <option value="strongest"${delegation.principles.rotation === "strongest" ? " selected" : ""}>${en ? "Strongest available" : "最强可用"}</option>
      </select></label>
      <label><span>${en ? "Youth principle" : "培养原则"}</span><select data-principle="youthPriority">
        <option value="normal"${delegation.principles.youthPriority === "normal" ? " selected" : ""}>${en ? "Merit first" : "实力优先"}</option>
        <option value="high"${delegation.principles.youthPriority === "high" ? " selected" : ""}>${en ? "Prefer youth when close" : "实力接近时优先年轻球员"}</option>
      </select></label>
      <label class="delegation-check"><input type="checkbox" id="delegation-lock-formation"${delegation.locks.formation ? " checked" : ""}> ${en ? `Lock formation (${club.tactics.formation})` : `锁定当前阵型（${club.tactics.formation}）`}</label>
      <label><span>${en ? "Key attacking player" : "锁定进攻核心"}</span><select id="delegation-core-player"><option value="">${en ? "Staff decides" : "由教练决定"}</option>${coreOptions}</select></label>
      <label class="delegation-player-lock"><span>${en ? "Must-start players (Ctrl to select multiple)" : "关键首发（按 Ctrl 可多选）"}</span><select id="delegation-locked-players" multiple size="5">${playerOptions}</select></label>
    </div>
    <div class="staff-card-actions delegation-actions">
      <button class="btn small" id="btn-delegation-training">${en ? "Apply training now" : "立即应用训练建议"}</button>
      <button class="btn small" id="btn-delegation-lineup">${en ? "Apply XI suggestion" : "应用首发建议"}</button>
      <button class="btn small" id="btn-delegation-tactics">${en ? "Apply tactics suggestion" : "应用战术建议"}</button>
    </div>`;

  $("#management-mode-select").onchange = (event) => {
    const result = setManagementMode(world, club, event.target.value);
    toast(result.ok
      ? (en ? "Management mode updated" : "管理模式已更新")
      : result.msg);
    if (result.ok) {
      autosave("management-mode");
      refreshAll();
    } else {
      renderStaff();
    }
  };
  box.querySelectorAll("[data-delegation-key]").forEach((select) => {
    select.onchange = () => {
      delegation[select.dataset.delegationKey] = select.value;
      autosave("delegation-responsibility");
      renderStaff();
    };
  });
  box.querySelectorAll("[data-principle]").forEach((select) => {
    select.onchange = () => {
      delegation.principles[select.dataset.principle] = select.value;
      autosave("delegation-principle");
    };
  });
  $("#delegation-lock-formation").onchange = (event) => {
    delegation.locks.formation = event.target.checked;
    autosave("delegation-formation-lock");
    renderStaff();
  };
  $("#delegation-core-player").onchange = (event) => {
    delegation.locks.corePlayerId = event.target.value || null;
    autosave("delegation-core-lock");
  };
  $("#delegation-locked-players").onchange = (event) => {
    delegation.locks.playerIds = [...event.target.selectedOptions].map((option) => option.value);
    autosave("delegation-player-locks");
  };
  $("#btn-delegation-training").onclick = () => {
    const previous = delegation.training;
    delegation.training = "staff";
    const result = applyDelegatedTraining(world, club);
    delegation.training = previous;
    toast(result.ok ? (en ? "Training recommendation applied" : "已应用教练训练建议") : (result.msg || "无法应用"));
    autosave("delegation-training-suggestion");
    renderTraining();
  };
  $("#btn-delegation-lineup").onclick = () => {
    const result = applyDelegatedLineup(world, club, { force: true, eligibleIds: nextMatchEligibility(club).ids });
    toast(result.ok ? (en ? "Starting XI recommendation applied" : "已应用教练首发建议") : (result.msg || "无法应用"));
    autosave("delegation-lineup-suggestion");
    renderTactics();
    renderSquad();
  };
  $("#btn-delegation-tactics").onclick = () => {
    const result = applyDelegatedTactics(world, club, getNextUserMatch(world), { force: true });
    toast(result.ok ? (en ? "Tactical recommendation applied" : "已应用教练战术建议") : (result.msg || "无法应用"));
    autosave("delegation-tactics-suggestion");
    renderTactics();
  };
}

function renderStaff() {
  const club = getUserClub(world);
  const en = getLang() === "en";
  if (!club) return;
  ensureStaff(club);
  ensureDelegation(world, club);
  try {
    ensureWorldStaff(world);
  } catch (_) {
    if (!Array.isArray(world.staffMarket)) refreshStaffMarket(world);
  }

  const roles = ["coach", "scout", "doctor"];
  const roleCopy = {
    coach: ["Head coach", "Improves match support, development and training plans"],
    scout: ["Scout", "Improves scouting knowledge and reports"],
    doctor: ["Doctor", "Reduces injury risk and recovery time"],
  };

  renderDelegationCenter(club, en);

  // 待处理：别人挖本队职员
  const approachBox = $("#staff-approaches");
  if (approachBox) {
    let pending = [];
    try {
      pending = pendingStaffApproaches(world) || [];
    } catch (_) {
      pending = [];
    }
    if (pending.length) {
      approachBox.classList.remove("hidden");
      approachBox.innerHTML = `<h3 style="margin:0 0 0.45rem;font-size:var(--fs-md)">${en ? "Incoming approaches" : "收到的接触"}</h3>
        ${pending
          .map((a) => {
            const roleLabel = en ? roleCopy[a.role]?.[0] || a.role : ROLES[a.role]?.label || a.role;
            return `<div class="staff-approach-banner">
              <div>
                <strong>${escapeHtml(a.buyerName || "—")}</strong>
                ${en ? "want" : "求购"}
                <strong>${escapeHtml(roleLabel)} ${escapeHtml(a.staffName || "")}</strong>
                · ${en ? "Compensation" : "补偿"} ${formatMoney(a.compensation || 0)}
                · ${en ? "Offer wage" : "新周薪"} ${formatMoney(a.wageOffer || 0)}
                · D${a.expiresDay}
              </div>
              <div class="staff-card-actions">
                <button class="btn small primary" data-staff-accept="${escapeHtml(a.id)}">${en ? "Accept" : "接受"}</button>
                <button class="btn small" data-staff-reject="${escapeHtml(a.id)}">${en ? "Reject" : "拒绝"}</button>
              </div>
            </div>`;
          })
          .join("")}`;
      approachBox.querySelectorAll("[data-staff-accept]").forEach((btn) => {
        btn.onclick = () => {
          const res = respondStaffApproachForUser(world, btn.dataset.staffAccept, true);
          toast(res.msg || (res.ok ? (en ? "Deal done" : "已成交") : (en ? "Failed" : "失败")));
          if (res.ok) {
            saveGame(world);
            refreshAll();
          }
        };
      });
      approachBox.querySelectorAll("[data-staff-reject]").forEach((btn) => {
        btn.onclick = () => {
          const res = respondStaffApproachForUser(world, btn.dataset.staffReject, false);
          toast(res.msg || (en ? "Rejected" : "已拒绝"));
          if (res.ok) {
            saveGame(world);
            refreshAll();
          }
        };
      });
    } else {
      approachBox.classList.add("hidden");
      approachBox.innerHTML = "";
    }
  }

  const box = $("#staff-current");
  if (!box) return;

  box.innerHTML = roles
    .map((role) => {
      const s = club.staff[role];
      const meta = ROLES[role];
      const years = s.contractYears != null ? s.contractYears : "—";
      let comp = 0;
      try {
        comp = staffCompensationFee(s);
      } catch (_) {
        comp = (s.wage || 0) * 4;
      }
      return `<div class="staff-card">
        <div class="staff-card-head">
          ${staffAvatarHtml(s, 52)}
          <div>
            <div class="role">${en ? roleCopy[role]?.[0] || role : meta.label}</div>
            <h3 style="margin:0.15rem 0">${staffLinkHtml(s, club.id)}</h3>
          </div>
        </div>
        <div class="meta">${en ? "Ability" : "能力"} <strong class="${ovrClass(s.rating)}">${s.rating}</strong> · ${en ? `Age ${s.age}` : `${s.age} 岁`}</div>
        <div class="meta">${en ? "Wage" : "周薪"} ${formatMoney(s.wage)} · ${en ? "Contract" : "合同"} ${years}${en ? "y" : " 年"}</div>
        ${role === "coach" ? `<div class="meta">${escapeHtml(coachIdentitySummary(s, en ? "en" : "zh"))}</div>` : ""}
        <div class="meta muted">${en ? "Release cost ~" : "解约约 "}${formatMoney(comp)}</div>
        <p class="hint" style="margin:0.4rem 0">${en ? roleCopy[role]?.[1] || "" : meta.effect}</p>
        <div class="staff-card-actions">
          <button class="btn small" data-staff-link="${escapeHtml(s.id)}" data-staff-club="${escapeHtml(club.id)}">${en ? "Profile" : "资料"}</button>
          <button class="btn small danger" data-fire="${role}">${en ? "Release" : "解约"}</button>
        </div>
      </div>`;
    })
    .join("");

  box.querySelectorAll("[data-fire]").forEach((btn) => {
    btn.onclick = () => {
      if (
        !confirm(
          en
            ? "Release this staff member? They become a free agent; you pay compensation and get a caretaker."
            : "解约后对方成为自由身进入市场，需支付补偿并上临时工，确认？"
        )
      ) {
        return;
      }
      const res = fireStaffForUser(world, btn.dataset.fire);
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });

  // 自由身市场
  const tbody = $("#staff-market-table tbody");
  if (tbody) {
    const free = (world.staffMarket || []).filter((s) => s && s.clubId == null);
    tbody.innerHTML = free.length
      ? free
          .map((s) => {
            let fee = Math.round(s.rating * s.rating * 4000);
            try {
              fee = staffSigningFee(s);
            } catch (_) {}
            return `<tr>
              <td class="avatar-cell">${staffAvatarHtml(s, 32)} ${staffLinkHtml(s)}</td>
              <td>${en ? roleCopy[s.role]?.[0] || s.role : ROLES[s.role]?.label || s.role}</td>
              <td class="${ovrClass(s.rating)}"><strong>${s.rating}</strong></td>
              <td>${s.age}</td>
              <td>${formatMoney(s.wage)}</td>
              <td>${formatMoney(fee)}</td>
              <td><button class="btn small primary" data-hire="${s.id}">${en ? "Sign" : "签约"}</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="muted">${en ? "No free agents — refresh or wait for releases." : "暂无自由身，可补充候选人或等待解约/到期。"}</td></tr>`;

    tbody.querySelectorAll("[data-hire]").forEach((btn) => {
      btn.onclick = () => {
        const res = hireStaffForUser(world, btn.dataset.hire);
        toast(res.msg);
        if (res.ok) {
          saveGame(world);
          refreshAll();
        }
      };
    });
  }

  // 在职可挖
  const empBody = $("#staff-approach-table tbody");
  if (empBody) {
    let list = [];
    try {
      list = (listApproachableStaff(world, club) || []).filter((row) => !row.freeAgent).slice(0, 40);
    } catch (_) {
      list = [];
    }
    const windowOpen = typeof isTransferWindowOpen === "function" ? isTransferWindowOpen(world) : true;
    empBody.innerHTML = list.length
      ? list
          .map((row) => {
            const s = row.staff;
            const from = row.fromClub;
            const years = s.contractYears != null ? s.contractYears : "—";
            const tags = (row.tags || [])
              .map(
                (t) =>
                  `<span class="staff-diff-tag ${t.id}">${escapeHtml(en ? t.en : t.zh)}</span>`
              )
              .join(" ");
            const diffCls = row.difficulty === "hard" ? "hard" : row.difficulty === "easy" ? "easy" : "";
            const hint = en ? row.hintEn || "" : row.hintZh || "";
            return `<tr class="${diffCls}" title="${escapeHtml(hint)}">
              <td class="avatar-cell">${staffAvatarHtml(s, 32)} ${staffLinkHtml(s, from?.id, from?.id)}</td>
              <td>${en ? roleCopy[s.role]?.[0] || s.role : ROLES[s.role]?.label || s.role}</td>
              <td>${from ? clubLinkHtml(from.id, clubDisplayShortName(from)) : "—"} ${tags}</td>
              <td class="${ovrClass(s.rating)}"><strong>${s.rating}</strong></td>
              <td>${years}${en ? "y" : "年"}</td>
              <td>${formatMoney(row.compensation || 0)}</td>
              <td><button class="btn small primary" data-approach="${s.id}" data-from="${from?.id || ""}" title="${escapeHtml(hint)}">${en ? "Approach" : "接触"}</button></td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7" class="muted">${
          windowOpen
            ? en
              ? "No approachable staff right now."
              : "当前没有可接触的在职职员。"
            : en
              ? "Window closed — only free agents or staff with ≤1 year left."
              : "转会窗外：仅自由身或合同剩余 ≤1 年的在职职员可接触。"
        }</td></tr>`;

    empBody.querySelectorAll("[data-approach]").forEach((btn) => {
      btn.onclick = () => {
        const fromId = btn.dataset.from || null;
        const res = approachStaffForUser(world, btn.dataset.approach, fromId);
        toast(res.msg || (res.ok ? (en ? "Done" : "完成") : en ? "Failed" : "失败"));
        // 拒绝也刷新列表（状态可能变化）
        if (res.ok || res.reason === "refused") {
          saveGame(world);
          refreshAll();
        }
      };
    });
  }
}

function staffLinkHtml(staff, clubId = null, returnClubId = null) {
  if (!staff?.id) return escapeHtml(staff?.name || "—");
  const clubAttr = clubId ? ` data-staff-club="${escapeHtml(clubId)}"` : "";
  const returnAttr = returnClubId ? ` data-staff-return-club="${escapeHtml(returnClubId)}"` : "";
  return `<button type="button" class="staff-link" data-staff-link="${escapeHtml(staff.id)}"${clubAttr}${returnAttr}>${escapeHtml(staff.name || "—")}</button>`;
}

/**
 * 在本队职员、全球俱乐部职员与职员市场中查找。
 * @returns {{ staff: object, club: object|null, source: "user"|"opponent"|"market", current: boolean }|null}
 */
function findStaffById(staffId, preferredClubId = null) {
  if (!staffId || !world) return null;
  const pack = (staff, club, source) => ({
    staff,
    club: club || null,
    source,
    current: source === "user",
  });

  if (preferredClubId) {
    const preferred = world.clubs?.find((c) => c.id === preferredClubId);
    if (preferred) {
      ensureStaff(preferred);
      const hit = Object.values(preferred.staff || {}).find((s) => s?.id === staffId);
      if (hit) {
        return pack(hit, preferred, preferred.id === world.userClubId ? "user" : "opponent");
      }
    }
  }

  const userClub = getUserClub(world);
  if (userClub) {
    ensureStaff(userClub);
    const mine = Object.values(userClub.staff || {}).find((s) => s?.id === staffId);
    if (mine) return pack(mine, userClub, "user");
  }

  for (const club of world.clubs || []) {
    if (club.id === userClub?.id) continue;
    ensureStaff(club);
    const hit = Object.values(club.staff || {}).find((s) => s?.id === staffId);
    if (hit) return pack(hit, club, "opponent");
  }

  const candidate = (world.staffMarket || []).find((s) => s?.id === staffId);
  if (candidate) return pack(candidate, null, "market");
  return null;
}

function staffImpactLines(staff, en) {
  const rating = Number(staff.rating || 8);
  if (staff.role === "coach") {
    ensureCoachIdentity(staff);
    const matchMod = 0.94 + (rating / 20) * 0.14;
    return [
      en ? `Match support multiplier ${matchMod.toFixed(3)}x` : `比赛支持系数 ${matchMod.toFixed(3)}x`,
      en ? `Weekly youth growth chance +${(rating * 0.8).toFixed(1)} percentage points` : `年轻球员每周成长概率 +${(rating * 0.8).toFixed(1)} 个百分点`,
      en ? "Training delegation uses fitness, injuries, morale, schedule and squad weaknesses" : "委托训练会分析体能、伤病、士气、赛程与阵容短板",
      ...coachIdentityFacts(staff, en ? "en" : "zh"),
    ];
  }
  if (staff.role === "scout") {
    const buyMod = 1.12 - (rating / 20) * 0.2;
    const sellMod = 0.85 + (rating / 20) * 0.2;
    return [
      en ? `Buying valuation multiplier ${buyMod.toFixed(2)}x` : `买入估价系数 ${buyMod.toFixed(2)}x`,
      en ? `Selling negotiation multiplier ${sellMod.toFixed(2)}x` : `出售议价系数 ${sellMod.toFixed(2)}x`,
      en ? `Youth intake potential bonus +${Math.floor(rating / 8)}` : `青训招生潜力加成 +${Math.floor(rating / 8)}`,
    ];
  }
  const injuryMod = 1.15 - (rating / 20) * 0.45;
  return [
    en ? `Injury probability multiplier ${injuryMod.toFixed(2)}x` : `受伤概率系数 ${injuryMod.toFixed(2)}x`,
    en ? `Daily recovery bonus +${Math.floor(rating / 5)}` : `每日恢复加成 +${Math.floor(rating / 5)}`,
    en ? "Medical effectiveness combines with the club's training facilities" : "医疗效果会与俱乐部训练设施共同生效",
  ];
}

function staffRoleLabel(role, en) {
  if (en) {
    if (role === "coach") return "Head coach";
    if (role === "scout") return "Scout";
    if (role === "doctor") return "Doctor";
    return role || "—";
  }
  if (role === "coach") return "主教练";
  return ROLES[role]?.label || role || "—";
}

function staffNationLabel(staff, en) {
  const nation = NATIONALITIES.find((item) => item.code === staff?.nationality);
  if (!nation) return en ? "Unknown nationality" : "国籍未记录";
  return `${nationFlagHtml(nation.code)} ${en ? nation.nameEn : nation.name}`;
}

function staffHistoryHtml(staff, en) {
  const rows = (Array.isArray(staff?.history) ? staff.history : []).slice().reverse().map((item) => {
    const club = world?.clubs?.find((candidate) => candidate.id === item.clubId);
    const clubName = club ? clubLinkHtml(club.id, clubDisplayName(club)) : escapeHtml(item.clubName || (en ? "Unknown club" : "未知俱乐部"));
    const from = item.fromSeason != null ? String(item.fromSeason) : "—";
    const to = item.toSeason != null ? String(item.toSeason) : en ? "Present" : "至今";
    return `<tr><td>${clubName}</td><td>${escapeHtml(staffRoleLabel(item.role, en))}</td><td>${from}–${to}</td></tr>`;
  });
  return rows.length
    ? `<table class="staff-history-table"><thead><tr><th>${en ? "Club" : "俱乐部"}</th><th>${en ? "Role" : "职位"}</th><th>${en ? "Period" : "任职时期"}</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
    : `<p class="muted">${en ? "No previous club record yet." : "暂无俱乐部任职记录。"}</p>`;
}

function showStaffModal(staffId, context = {}) {
  const found = findStaffById(staffId, context.clubId || null);
  if (!found) return;
  activePlayerBrowseContext = null;
  const { staff, club, source, current } = found;
  const en = getLang() === "en";
  const meta = ROLES[staff.role] || {};
  const roleCopy = {
    coach: [
      "Head coach",
      "Leads first-team coaching and supports the manager's training programme.",
    ],
    scout: [
      "Scout",
      "Assesses recruitment targets, supports negotiations and improves youth intake knowledge.",
    ],
    doctor: [
      "Doctor",
      "Manages injury prevention, rehabilitation and daily player recovery.",
    ],
  };
  const lines = staffImpactLines(staff, en);
  const fee = Math.round(Number(staff.rating || 0) ** 2 * 8000);
  const statusBadge =
    source === "user"
      ? en
        ? "Your staff"
        : "本队职员"
      : source === "opponent"
        ? en
          ? "Club staff"
          : "俱乐部职员"
        : en
          ? "Available candidate"
          : "市场候选人";
  const clubLine = club
    ? `${en ? "Club" : "所属"} ${clubLinkHtml(club.id, clubDisplayName(club))}`
    : "";
  const reviewLine = staff.role === "coach" && club?.managerReview && source === "opponent"
    ? `${managerReviewLabel(club.managerReview, en ? "en" : "zh")} · ${
        en ? "target" : "目标"
      } ${en ? `top ${club.managerReview.targetPosition}` : `前 ${club.managerReview.targetPosition}`}`
    : "";
  const returnClubId = context.returnClubId || (source !== "market" ? club?.id : null) || null;

  $("#modal-card")?.classList.remove("wide", "search-modal");
  $("#modal-body").innerHTML = `
    ${
      returnClubId
        ? `<div class="staff-profile-nav">
            <button type="button" class="btn small" data-return-club="${escapeHtml(returnClubId)}">${en ? "← Back to club" : "← 返回俱乐部"}</button>
          </div>`
        : ""
    }
    <div class="staff-profile-head">
      ${staffAvatarHtml(staff, 96)}
      <div>
        <div class="role">${escapeHtml(en ? roleCopy[staff.role]?.[0] || staff.role : staffRoleLabel(staff.role, false))}</div>
        <h2>${escapeHtml(staff.name)}</h2>
        <p class="muted">${en ? `Age ${staff.age}` : `${staff.age} 岁`} · ${en ? "Ability" : "能力"} <strong class="${ovrClass(staff.rating)}">${staff.rating}</strong> / 20 · ${staffNationLabel(staff, en)}${
          staff.contractYears != null && staff.clubId
            ? ` · ${en ? "Contract" : "合同"} ${staff.contractYears}${en ? "y" : " 年"}`
            : staff.clubId == null
              ? ` · ${en ? "Free agent" : "自由身"}`
              : ""
        }</p>
        ${clubLine ? `<p class="muted" style="margin:0.2rem 0 0">${clubLine}</p>` : ""}
      </div>
    </div>
    <div class="staff-profile-status">
      <span class="badge ${current ? "DEF" : source === "opponent" ? "MID" : "ATT"}">${escapeHtml(statusBadge)}</span>
      <span>${en ? "Weekly wage" : "周薪"} <strong>${formatMoney(staff.wage)}</strong></span>
      ${source === "market" ? `<span>${en ? "Signing fee" : "签约费"} <strong>${formatMoney(fee)}</strong></span>` : ""}
      ${reviewLine ? `<span>${escapeHtml(reviewLine)}</span>` : ""}
    </div>
    <p>${escapeHtml(en ? roleCopy[staff.role]?.[1] || "" : meta.desc || "")}</p>
    <h3 class="staff-profile-subtitle">${en ? "Employment history" : "效力记录"}</h3>
    ${staffHistoryHtml(staff, en)}
    <h3 class="staff-profile-subtitle">${en ? "Current impact" : "当前能力影响"}</h3>
    <div class="staff-impact-list">${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
    <p class="hint">${escapeHtml(
      en
        ? "The displayed ability and coaching identity are the same facts used by matches, delegation, recruitment, development and recovery; there is no separate hidden profile rating."
        : "资料展示的职员能力与主教练理念，就是比赛、委托、招聘、青训和恢复实际读取的同一事实，不存在独立隐藏评分。"
    )}</p>
    ${
      source === "user"
        ? `<p class="hint">${escapeHtml(en ? "Release or replace staff on the Staff tab." : "解约或改聘请到「职员」页操作。")}</p>`
        : source === "opponent"
          ? `<p class="hint">${escapeHtml(en ? "Opponent staff is read-only." : "对方职员仅供查阅，无法操作。")}</p>`
          : ""
    }
  `;
  $("#modal-body")
    .querySelector("[data-return-club]")
    ?.addEventListener("click", () => {
      showClubModal(returnClubId);
    });
  openSharedModal();
  $("#modal-card").scrollTop = 0;
}

/** 媒体页渲染委托给 js/ui/media.js */
function renderMedia() {
  renderMediaView(world, getLang() === "en", t);
}

function playerStats(p) {
  ensurePlayerHistory(p);
  return p.stats || emptyMatchStats();
}

function careerStats(p) {
  ensurePlayerHistory(p);
  // 生涯展示 = 已归档 career + 当前赛季尚未归档的 stats
  const c = p.career || emptyMatchStats();
  const s = p.stats || emptyMatchStats();
  return {
    apps: (c.apps || 0) + (s.apps || 0),
    goals: (c.goals || 0) + (s.goals || 0),
    assists: (c.assists || 0) + (s.assists || 0),
    cleanSheets: (c.cleanSheets || 0) + (s.cleanSheets || 0),
    goalsConceded: (c.goalsConceded || 0) + (s.goalsConceded || 0),
  };
}

function renderTopbar() {
  const club = getUserClub(world);
  const div = DIVISIONS[club.division || 3];
  $("#club-name").innerHTML = `${clubCrestHtml(club, { size: 30, className: "topbar-club-crest", decorative: true })}<span>${escapeHtml(clubDisplayName(club))}</span>`;
  const mgrAv = avatarHtml(
    { id: `mgr_${world.userClubId}_${world.managerName}`, name: world.managerName, age: 42 },
    { role: "manager", size: 32 }
  );
  $("#manager-name").innerHTML = `${mgrAv} <span>${escapeHtml(world.managerName)} · ${escapeHtml(t("div." + (club.division || 3)) || div?.short || "League")}</span>`;
  $("#season-label").textContent = t("top.season", { n: world.season });
  const tw = transferWindowShort(world);
  $("#date-label").textContent = `${t("top.day", { n: world.day })} · ${tw}`;
  $("#money-label").textContent = formatMoney(club.money);
  $("#btn-global-search")?.setAttribute("aria-label", t("search.open"));
}

function ticketFactorsText(factors, en = getLang() === "en") {
  if (!Array.isArray(factors) || !factors.length) return "";
  const labels = en
    ? {
        cupBase: "cup base",
        "cup-final": "final",
        "cup-semi": "semi-final",
        "cup-quarter": "quarter-final",
        "cup-r16": "round of 16",
        derby: "derby",
        relegation: "relegation battle",
        title: "title race",
        form: "league form",
        season: "run-in",
        tier1: "top tier",
        tier2: "second tier",
        cap: "income cap",
      }
    : {
        cupBase: "杯赛基础",
        "cup-final": "决赛",
        "cup-semi": "半决赛",
        "cup-quarter": "八强",
        "cup-r16": "十六强",
        derby: "德比",
        relegation: "保级战",
        title: "争冠战",
        form: "联赛表现",
        season: "赛季冲刺",
        tier1: "顶级联赛",
        tier2: "第二级联赛",
        cap: "收入封顶",
      };
  return factors
    .map((factor) => {
      const label = labels[factor?.key];
      if (!label) return "";
      if (factor.key === "cap" || !Number.isFinite(Number(factor.multiplier))) return label;
      return `${label} ×${Number(factor.multiplier).toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" · ");
}

/**
 * 顶栏推进键的当前语义：赛季末 → 进入下赛季；比赛日 → 进入比赛；否则推进一天。
 * 状态由 renderDashboard 算好后传入，这里只负责显示。
 */
let topbarContinueMode = "advance";

function syncTopbarContinue({ seasonDone = false, matchReady = false } = {}) {
  const btn = $("#btn-topbar-continue");
  if (!btn) return;
  const en = getLang() === "en";
  topbarContinueMode = seasonDone ? "season" : matchReady ? "match" : "advance";

  if (topbarContinueMode === "season") {
    btn.textContent = t("dash.nextSeason");
    btn.title = en ? "Start the next season" : "进入下一赛季";
  } else if (topbarContinueMode === "match") {
    btn.textContent = t("dash.play");
    btn.title = en ? "Matchday — enter the match" : "比赛日 · 进入比赛";
  } else {
    btn.textContent = t("dash.advance");
    btn.title = en ? "Advance one day" : "推进一天";
  }
  btn.setAttribute("aria-label", btn.title);
  btn.classList.toggle("is-matchday", topbarContinueMode === "match");
  btn.disabled = calendarAdvanceBusy;

  // 比赛日当天应先踢比赛：与概览页一致地禁掉跳过类推进
  const dayBtn = $("#btn-topbar-advance-day");
  const matchBtn = $("#btn-topbar-advance-matchday");
  const seasonBtn = $("#btn-topbar-advance-season-end");
  if (dayBtn) dayBtn.disabled = calendarAdvanceBusy || seasonDone;
  if (matchBtn) matchBtn.disabled = calendarAdvanceBusy || seasonDone || matchReady;
  if (seasonBtn) seasonBtn.disabled = calendarAdvanceBusy || seasonDone || matchReady;
}

/** 顶栏主键：按当前语义分派 */
async function runTopbarContinue() {
  if (topbarContinueMode === "season") {
    $("#btn-next-season")?.click();
    return;
  }
  if (topbarContinueMode === "match") {
    try {
      await openMatch();
    } catch (error) {
      console.error(error);
      toast(getLang() === "en" ? "Match view failed to load" : "比赛画面加载失败");
    }
    return;
  }
  await onAdvance();
}

function collectDashboardWorkbench(club, next) {
  const en = getLang() === "en";
  const issues = [];
  const actions = [];
  const addAction = (target, icon, label, hint = "") => {
    if (!target || actions.some((item) => item.target === target)) return;
    actions.push({ target, icon, label, hint });
  };

  if (world.sacked || world.managerJob?.status === "unemployed") {
    issues.push({
      severity: "critical",
      icon: "📋",
      title: en ? "Manager position requires action" : "经理职位需要处理",
      detail: en ? "Review available jobs and decide the next career step." : "查看工作邀请并决定下一段执教生涯。",
      target: "career",
      actionLabel: en ? "Career" : "查看生涯",
    });
    addAction("career", "📋", en ? "Career" : "经理生涯", en ? "Review job offers" : "处理工作邀请");
    return { issues, actions, digest: dashboardAdvanceDigest };
  }

  const inboxItems = listInbox(world, { pendingOnly: true, limit: 50 });
  const urgentMail = inboxItems.filter((item) => (item.priority || 1) >= 3);
  if (urgentMail.length) {
    issues.push({
      severity: "critical",
      icon: "✉️",
      title: en ? `${urgentMail.length} urgent inbox item(s)` : `${urgentMail.length} 项紧急信箱待办`,
      detail: en ? "Urgent decisions can block safe calendar progression." : "紧急决策可能影响日程推进，请优先处理。",
      target: "inbox",
      actionLabel: en ? "Inbox" : "打开信箱",
    });
  } else if (inboxItems.length) {
    issues.push({
      severity: "warning",
      icon: "✉️",
      title: en ? `${inboxItems.length} unresolved inbox item(s)` : `${inboxItems.length} 项信箱待办未解决`,
      detail: en ? "Review the pending decisions before their deadlines." : "请在截止日前检查待处理决策。",
      target: "inbox",
      actionLabel: en ? "Review" : "查看待办",
    });
  }
  if (inboxItems.length) addAction("inbox", "✉️", en ? "Inbox" : "信箱", en ? `${inboxItems.length} unresolved` : `${inboxItems.length} 项待办`);

  const board = ensureBoardObjective(world);
  const tone = boardTone(board);
  if (tone === "danger" || tone === "warn") {
    issues.push({
      severity: tone === "danger" ? "critical" : "warning",
      icon: "🏛️",
      title: en ? "Board confidence is under pressure" : "董事会信心承压",
      detail: en ? `Objective: finish in the top ${board.targetPos}.` : `赛季目标为联赛前 ${board.targetPos} 名。`,
      target: "career",
      actionLabel: en ? "Review" : "查看目标",
    });
    addAction("career", "🏛️", en ? "Board" : "董事会", en ? "Review expectations" : "检查赛季目标");
  }

  const finance = financeSnapshot(world);
  if (finance?.critical || finance?.warning) {
    issues.push({
      severity: finance.critical ? "critical" : "warning",
      icon: "💶",
      title: en ? "Cash runway needs attention" : "现金续航需要关注",
      detail: en
        ? `Current cash covers about ${finance.weeksCover} week(s) at the present burn rate.`
        : `按当前现金消耗，余额约可维持 ${finance.weeksCover} 周。`,
      target: "finance",
      actionLabel: en ? "Finances" : "查看财政",
    });
    addAction("finance", "💶", en ? "Finances" : "财政", en ? `${finance.weeksCover} weeks runway` : `可维持约 ${finance.weeksCover} 周`);
  }

  if (next) {
    const ready = next.day <= world.day;
    const daysLeft = Math.max(0, next.day - world.day);
    const eligible = eligiblePlayerIds(world, club, next);
    const lineup = getLineupPlayers(club);
    const unavailable = lineup.filter(
      (player) => !isAvailable(player) || !eligible.has(player.id)
    );
    if (unavailable.length) {
      issues.push({
        severity: ready || daysLeft <= 2 ? "critical" : "warning",
        icon: "🚑",
        title: en ? `${unavailable.length} selected player(s) unavailable` : `${unavailable.length} 名首发球员无法出场`,
        detail: en ? "Injury, suspension or registration leaves the selected XI incomplete." : "伤病、停赛或报名资格导致当前首发不完整。",
        target: "tactics",
        actionLabel: en ? "Fix XI" : "调整首发",
      });
    }
    if (eligible.size < 18) {
      issues.push({
        severity: ready || daysLeft <= 2 ? "critical" : "warning",
        icon: "📋",
        title: en ? "Match squad depth is below 18" : "比赛可用阵容不足 18 人",
        detail: en ? `Only ${eligible.size} players are currently eligible.` : `当前仅有 ${eligible.size} 名球员具备参赛资格。`,
        target: "squad",
        actionLabel: en ? "Squad" : "检查阵容",
      });
    }
    const registration = registrationSummary(world, club, next);
    if (!registration.valid) {
      issues.push({
        severity: ready || daysLeft <= 3 ? "critical" : "warning",
        icon: "🪪",
        title: en ? "Competition registration is invalid" : "赛事报名名单不合规",
        detail: en ? "Quota rules must be satisfied before the squad can be used safely." : "报名人数或本土培养名额不符合赛事规则。",
        target: "squad",
        actionLabel: en ? "Registration" : "处理报名",
      });
    }
    addAction("tactics", "🧭", en ? "Match plan" : "比赛计划", ready ? (en ? "Matchday XI" : "确认比赛日首发") : (en ? `${daysLeft} day(s) to prepare` : `还有 ${daysLeft} 天准备`));
    addAction("fixtures", "📅", en ? "Fixtures" : "赛程", en ? "Review the calendar" : "查看比赛日程");
  }

  const contracts = (club.players || []).filter((player) => !player.loan && needsContractAttention(player));
  if (contracts.length) {
    issues.push({
      severity: "warning",
      icon: "📝",
      title: en ? `${contracts.length} contract(s) need attention` : `${contracts.length} 份合同需要处理`,
      detail: en ? "Short or flagged contracts can reduce squad stability." : "短约或待续约合同可能影响阵容稳定。",
      target: "transfer",
      actionLabel: en ? "Contracts" : "处理合同",
    });
    addAction("transfer", "📝", en ? "Contracts" : "合同", en ? `${contracts.length} need attention` : `${contracts.length} 份待处理`);
  }

  // 将多年阵容规划中的真实冗余变成一个可处理的管理提醒：说明依据，
  // 但不替玩家自动出售或解约，避免把规划建议变成隐藏的后台动作。
  const squadPlan = ensureClubSquadPlan(world, club);
  const saleCandidate = selectPlannedSaleCandidate(world, club);
  if (saleCandidate && club.players.length > 15) {
    const decision = squadPlayerPlan(squadPlan, saleCandidate.id);
    const positionPlan = squadPositionPlan(squadPlan, saleCandidate.pos);
    const positionName = en ? positionPlan?.labelEn || saleCandidate.pos : positionPlan?.label || saleCandidate.pos;
    const excess = Math.max(0, Number(positionPlan?.current || 0) - Number(positionPlan?.ideal || 0));
    issues.push({
      severity: "info",
      icon: "↔",
      title: en ? `Squad exit available: ${saleCandidate.name}` : `阵容有可处理出口：${saleCandidate.name}`,
      detail: en
        ? `${positionName} is ${excess || 1} over ideal depth; ${decision?.reasonEn || "the player is outside the realistic rotation"}.`
        : `${positionName} 超过理想深度 ${excess || 1} 人；${decision?.reason || "球员不在现实轮换顺位内"}。`,
      target: "squad",
      actionLabel: en ? "Review squad" : "查看阵容",
    });
    addAction("squad", "↔", en ? "Squad exits" : "阵容出口", en ? "Review planned sale" : "查看规划建议");
  }

  ensureSquadRelations(club);
  const atmosphere = clubAtmosphere(club);
  if (atmosphere < 45) {
    issues.push({
      severity: atmosphere < 30 ? "critical" : "warning",
      icon: "💬",
      title: en ? "Dressing-room atmosphere is fragile" : "更衣室氛围不稳定",
      detail: en ? `Current atmosphere is ${atmosphere}; review morale, promises and relationships.` : `当前氛围 ${atmosphere}，建议检查士气、承诺与球员关系。`,
      target: "squad",
      actionLabel: en ? "Squad" : "查看球队",
    });
    addAction("squad", "💬", en ? "Dressing room" : "更衣室", en ? `Atmosphere ${atmosphere}` : `当前氛围 ${atmosphere}`);
  }

  if (!actions.length) {
    addAction("training", "🏋️", en ? "Training" : "训练", en ? "Prepare the squad" : "安排球队准备");
    addAction("squad", "👥", en ? "Squad" : "球队阵容", en ? "Review availability" : "检查球员状态");
  }
  return { issues, actions, digest: dashboardAdvanceDigest, onboarding: managerOnboardingView(world) };
}

function renderDashboard() {
  const club = getUserClub(world);
  const en = getLang() === "en";
  const next = getNextUserMatch(world);
  ensureInbox(world);
  syncPoachBidsToInbox(world);
  syncDealNegotiationsToInbox(world);
  syncTransferNegotiationsToInbox(world);
  const box = $("#next-match");
  const playBtn = $("#btn-play-match");
  const nextSeasonBtn = $("#btn-next-season");
  const advanceBtn = $("#btn-advance");
  const advanceMatchBtn = $("#btn-advance-matchday");
  const advanceSeasonBtn = $("#btn-advance-season-end");

  const seasonDone =
    world.seasonOver ||
    (world.fixtures.length > 0 && world.fixtures.every((f) => f.played));

  if (seasonDone) {
    const divName = t("div." + (club.division || 3)) || DIVISIONS[club.division || 3]?.name || "";
    box.innerHTML = `
      <div><strong>${en ? `Season ${world.season} complete` : `${world.season} 赛季已结束`}</strong></div>
      <div class="muted" style="margin-top:0.4rem">
        ${en ? `Current league: ${divName}` : `当前联赛：${divName}`}<br/>
        ${en ? "Ageing, retirements, promotion and relegation are complete. The next season will use the new divisions." : "已处理年龄 / 退役 / 升降级。进入下一赛季将按新级别生成赛程。"}
      </div>
    `;
    playBtn.disabled = true;
    playBtn.textContent = t("dash.seasonOver");
    advanceBtn.disabled = true;
    if (advanceMatchBtn) advanceMatchBtn.disabled = true;
    if (advanceSeasonBtn) advanceSeasonBtn.disabled = true;
    nextSeasonBtn.style.display = "inline-block";
  } else if (!next) {
    box.textContent = t("dash.noNext");
    playBtn.disabled = true;
    advanceBtn.disabled = false;
    if (advanceMatchBtn) advanceMatchBtn.disabled = false;
    if (advanceSeasonBtn) advanceSeasonBtn.disabled = false;
    nextSeasonBtn.style.display = "none";
  } else {
    const home = world.clubs.find((c) => c.id === next.home);
    const away = world.clubs.find((c) => c.id === next.away);
    const ready = next.day <= world.day;
    const brief = ready ? buildBriefingForFixture(next, club) : null;
    const briefHtml = brief ? renderPrematchBriefHtml(brief, { compact: true }) : "";
    const roundLabel = next.competition === "cup"
      ? en ? next.roundLabelEn || "Cup" : next.roundLabel || "杯赛"
      : en ? `Round ${next.round}` : `第 ${next.round} 轮`;
    box.innerHTML = `
      <div><strong>${roundLabel}</strong> · ${en ? `Day ${next.day}` : `第 ${next.day} 天`} · ${next.home === club.id ? (en ? "Home" : "主场") : (en ? "Away" : "客场")}</div>
      <div style="margin-top:0.4rem;font-size:var(--fs-3xl)">
        ${clubLinkHtml(home.id, clubDisplayName(home))} <span class="muted">vs</span> ${clubLinkHtml(away.id, clubDisplayName(away))}
      </div>
      <div class="muted" style="margin-top:0.35rem">
        ${ready ? (getLang() === "en" ? "Matchday · Pre-match briefing" : "可以开赛 · 赛前简报") : (getLang() === "en" ? `${next.day - world.day} day(s) to go` : `还需等待 ${next.day - world.day} 天`)}
      </div>
      ${briefHtml}
    `;
    playBtn.disabled = !ready;
    playBtn.textContent = ready ? t("dash.play") : t("dash.notMatchday");
    advanceBtn.disabled = false;
    // 比赛日当天：应先踢比赛，禁用跳到下场 / 赛季末
    if (advanceMatchBtn) advanceMatchBtn.disabled = ready;
    if (advanceSeasonBtn) advanceSeasonBtn.disabled = ready;
    nextSeasonBtn.style.display = "none";
  }

  // 顶栏常驻推进键：复用上面算好的三种态，避免重复判断
  syncTopbarContinue({ seasonDone, matchReady: !seasonDone && !!next && next.day <= world.day });
  renderManagerWorkbench(collectDashboardWorkbench(club, next));

  // 经理生涯摘要
  const careerBox = $("#manager-career-dash");
  if (careerBox) {
    const mc = ensureActiveCareer(world);
    const wr = managerWinRate(mc);
    const directorMode = world.managementMode === "club_director";
    careerBox.innerHTML = `
      <div><strong>${escapeHtml(world.managerName)}</strong> · ${en ? (directorMode ? "Club director record" : "Manager record") : (directorMode ? "俱乐部经营记录" : "主教练战绩")} · ${en ? `${mc.seasons} seasons · ${mc.matches} matches` : `${mc.seasons} 赛季 · ${mc.matches} 场`}</div>
      <div class="muted" style="margin-top:0.25rem">${en ? `${mc.wins}W ${mc.draws}D ${mc.losses}L · Win ${wr}%` : `${mc.wins}胜 ${mc.draws}平 ${mc.losses}负 · 胜率 ${wr}%`}</div>
      <div class="muted">${en ? `${mc.titles} titles · ${mc.promotions} promotions · ${mc.cups} cups · ${mc.sacked} sackings` : `${mc.titles} 冠 · ${mc.promotions} 次升级 · ${mc.cups} 杯 · 解雇 ${mc.sacked}`}</div>
      ${
        mc.bestFinish
          ? `<div class="muted">${en ? "Best: " : "最佳："}${mc.bestFinish.season} ${escapeHtml(mc.bestFinish.divName)} ${en ? `#${mc.bestFinish.pos}` : `第 ${mc.bestFinish.pos}`}</div>`
          : ""
      }
    `;
  }

  const userDiv = club.division || 3;
  const table = getSortedTable(world, userDiv);
  const pos = table.findIndex((r) => r.id === club.id) + 1;
  const row = table.find((r) => r.id === club.id) || { pts: 0, w: 0, d: 0, l: 0 };
  const divInfo = DIVISIONS[userDiv] || {};
  const divName = t("div." + userDiv) || divInfo.name || "";
  const ruleBits = [];
  if (divInfo.promote) ruleBits.push(en ? `top ${divInfo.promote} promoted` : `前 ${divInfo.promote} 名升级`);
  if (divInfo.relegate) ruleBits.push(en ? `bottom ${divInfo.relegate} relegated` : `后 ${divInfo.relegate} 名降级`);
  const promoHint = ruleBits.length ? ` (${ruleBits.join(en ? " · " : " · ")})` : "";
  $("#my-rank").textContent = en
    ? `${divName} · #${pos} · ${row.pts} pts (${row.w}W ${row.d}D ${row.l}L)${promoHint}`
    : `${divName} 第 ${pos} 名 · ${row.pts} 分（${row.w}胜 ${row.d}平 ${row.l}负）${promoHint}`;

  // 当前训练（概览一眼可见）
  const trainDash = document.querySelector("#training-dash");
  if (trainDash) {
    const training = trainingSummary(club);
    const focusEn = { balanced: "Balanced", attacking: "Attacking", defending: "Defending", fitness: "Fitness", goalkeeping: "Goalkeeping", youth: "Youth development", recovery: "Recovery", matchprep: "Match preparation" };
    const intensityEn = { light: "Light", normal: "Normal", hard: "High intensity" };
    trainDash.textContent = (en ? `${focusEn[training.focus] || training.focus} · ${intensityEn[training.intensity] || training.intensity}` : training.line) + t("dash.trainHint");
  }
  // 设施摘要
  const facDash = document.querySelector("#facilities-dash");
  if (facDash) {
    ensureFacilities(club);
    const facilities = club.facilities || {};
    facDash.textContent = (en
      ? `Stadium Lv.${facilities.stadium || 1} · Training Lv.${facilities.training || 1} · Youth Lv.${facilities.youth || 1}`
      : facilitySummaryLine(club)) + t("dash.facHint");
  }

  // 转会窗
  ensureTransferWindow(world);
  const twDash = document.querySelector("#transfer-window-dash");
  if (twDash) {
    const open = isTransferWindowOpen(world);
    twDash.textContent = transferWindowLabel(world, getLang());
    twDash.className = open ? "transfer-window-box open" : "transfer-window-box closed";
  }

  // board objective
  const boardEl = document.querySelector("#board-box");
  if (boardEl) {
    const b = ensureBoardObjective(world);
    if (!b) {
      boardEl.className = "board-box";
      boardEl.textContent = "\u2014";
    } else {
      if (!b.settled && !b.sacked) {
        const bPlayed = row.played || 0;
        if (bPlayed < 6) b.status = "active";
        else if (pos <= b.targetPos) b.status = "met";
        else if (pos <= b.targetPos + 2) b.status = "active";
        else b.status = "danger";
      }
      const tone = boardTone(b);
      boardEl.className = "board-box" + (tone ? " " + tone : "");
      const played = row.played || 0;
      const warn = !b.settled && (b.sackWarnings || 0) > 0 ? (en ? ` Warnings ${b.sackWarnings}/4` : ` 警告${b.sackWarnings}/4`) : "";
      const boardLine = en
        ? `Target: top ${b.targetPos} · ${b.sacked ? "Sacked" : b.settled ? (b.status === "success" || b.status === "achieved" ? "Completed" : "Missed") : b.status}${b.planLabelEn ? ` · Plan: ${b.planLabelEn}` : ""}`
        : boardStatusLine(b);
      boardEl.textContent =
        boardLine +
        (b.settled || b.sacked ? "" : en ? ` · Current #${pos}/target #${b.targetPos} · ${played} played${warn}` : ` · 现第${pos}/目标${b.targetPos} · ${played}场${warn}`);
    }
  }
  $("#news-list").innerHTML = world.news
    .slice(0, 12)
    .map((n) => `<li><strong>D${n.day}</strong> ${escapeHtml(n.text)}</li>`)
    .join("") || `<li>${en ? "No news" : "暂无新闻"}</li>`;

  // 概览信箱摘要
  ensureInbox(world);
  const dashIb = $("#dash-inbox");
  if (dashIb) {
    const en = getLang() === "en";
    const n = pendingInboxCount(world);
    const top = listInbox(world, { pendingOnly: true, limit: 3 });
    if (!n && !top.length) {
      dashIb.innerHTML = `<span class="muted">${escapeHtml(en ? "No pending mail" : "暂无待办")}</span>`;
    } else {
      const dashEntityIndex = buildInboxEntityIndex(world);
      const lines = top
        .map(
          (m) =>
            `<div class="dash-inbox-row"><span class="inbox-cat mini">${escapeHtml(inboxCatLabel(m.category, en ? "en" : "zh"))}</span> ${renderInboxEntityText(en && m.titleEn ? m.titleEn : m.title, inboxEntityRefs(m, dashEntityIndex))}</div>`
        )
        .join("");
      dashIb.innerHTML = `<div class="dash-inbox-count">${en ? `${n} pending` : `${n} 封待办`}</div>${lines}`;
    }
  }

  // 更衣室氛围 + 财政 + 成就
  ensureSquadRelations(club);
  const atm = clubAtmosphere(club);
  const atmEl = $("#dash-atmosphere");
  if (atmEl) {
    atmEl.innerHTML = `<strong>${atm}</strong> · ${escapeHtml(atmosphereLabel(atm, en ? "en" : "zh"))}`;
    atmEl.className = "dash-atm " + (atm >= 60 ? "good" : atm < 40 ? "bad" : "");
  }
  const fin = financeSnapshot(world);
  const finEl = $("#dash-finance");
  if (finEl && fin) {
    const crowd =
      fin.lastAttendance != null && fin.lastCapacity
        ? en
          ? `${fin.lastAttendance.toLocaleString()}/${fin.lastCapacity.toLocaleString()}${fin.lastFillPct != null ? ` (${fin.lastFillPct}%)` : ""}`
          : `${Number(fin.lastAttendance).toLocaleString()}/${Number(fin.lastCapacity).toLocaleString()}${fin.lastFillPct != null ? `（${fin.lastFillPct}%）` : ""}`
        : null;
    const ticketLine =
      fin.lastTicket != null
        ? en
          ? `Last gate <strong>${formatMoney(fin.lastTicket)}</strong>${fin.lastTicketDay != null ? ` · D${fin.lastTicketDay}` : ""}${crowd ? ` · ${crowd}` : ""}`
          : `最近门票 <strong>${formatMoney(fin.lastTicket)}</strong>${fin.lastTicketDay != null ? ` · D${fin.lastTicketDay}` : ""}${crowd ? ` · ${crowd}` : ""}`
        : en
          ? `Est. gate ~${formatMoney(fin.estTicket || 0)}/home`
          : `预估门票约 ${formatMoney(fin.estTicket || 0)}/主场`;
    const seasonGate = en
      ? `Season matchday <strong>${formatMoney((fin.seasonTickets || 0) + (fin.seasonMatchday || 0))}</strong> (tickets ${formatMoney(fin.seasonTickets || 0)} · ancillary ${formatMoney(fin.seasonMatchday || 0)})${fin.seasonHomeGates ? ` · ${fin.seasonHomeGates} home` : ""}`
      : `本季比赛日 <strong>${formatMoney((fin.seasonTickets || 0) + (fin.seasonMatchday || 0))}</strong>（门票 ${formatMoney(fin.seasonTickets || 0)} · 附加 ${formatMoney(fin.seasonMatchday || 0)}）${fin.seasonHomeGates ? ` · ${fin.seasonHomeGates} 场主场` : ""}`;
    const commercialLine = en
      ? `Commercial income <strong>${formatMoney(fin.seasonCommercial || 0)}</strong> · weekly ${formatMoney(fin.commercialIncome || 0)}`
      : `商业收入 <strong>${formatMoney(fin.seasonCommercial || 0)}</strong> · 每周 ${formatMoney(fin.commercialIncome || 0)}`;
    const ticketFactors = ticketFactorsText(fin.lastTicketFactors, en);
    const tvPrizeTotal = (fin.seasonBroadcast || 0) + (fin.seasonPrize || 0) + (fin.seasonCompetition || 0);
    const tvPrizeLine =
      tvPrizeTotal > 0
        ? en
          ? `TV + prizes <strong class="stat-high">${formatMoney(tvPrizeTotal)}</strong> (broadcast ${formatMoney(fin.seasonBroadcast || 0)} · place ${formatMoney(fin.seasonPrize || 0)} · competitions ${formatMoney(fin.seasonCompetition || 0)}${fin.lastPrizePos ? ` · P${fin.lastPrizePos}` : ""})`
          : `转播+奖金 <strong class="stat-high">${formatMoney(tvPrizeTotal)}</strong>（转播 ${formatMoney(fin.seasonBroadcast || 0)} · 名次 ${formatMoney(fin.seasonPrize || 0)} · 赛事 ${formatMoney(fin.seasonCompetition || 0)}${fin.lastPrizePos ? ` · 第${fin.lastPrizePos}名` : ""}）`
        : fin.lastBroadcast != null || fin.lastPrize != null
          ? en
            ? `Last league payout TV ${formatMoney(fin.lastBroadcast || 0)} · prize ${formatMoney(fin.lastPrize || 0)}${fin.lastPrizePos ? ` · P${fin.lastPrizePos}` : ""}${fin.lastLeaguePayoutSeason ? ` (S${fin.lastLeaguePayoutSeason})` : ""}`
            : `上季联赛结算：转播 ${formatMoney(fin.lastBroadcast || 0)} · 奖金 ${formatMoney(fin.lastPrize || 0)}${fin.lastPrizePos ? ` · 第${fin.lastPrizePos}名` : ""}${fin.lastLeaguePayoutSeason ? `（S${fin.lastLeaguePayoutSeason}）` : ""}`
          : en
            ? `TV + prizes settle at season end`
            : `转播/名次奖金于赛季末结算`;
    const xfer = fin.seasonTransferNet || 0;
    const xferTxt = en
      ? `Transfers net <strong class="${xfer >= 0 ? "stat-high" : "stat-low"}">${formatMoney(xfer)}</strong>`
      : `转会净额 <strong class="${xfer >= 0 ? "stat-high" : "stat-low"}">${formatMoney(xfer)}</strong>`;
    const spent = en
      ? `Season out: wages ${formatMoney(fin.seasonWageOut || 0)} · facilities ${formatMoney(fin.seasonFacilityOut || 0)}`
      : `本季支出：薪资 ${formatMoney(fin.seasonWageOut || 0)} · 设施 ${formatMoney(fin.seasonFacilityOut || 0)}`;
    const net = fin.seasonNetApprox || 0;
    finEl.innerHTML = `
      <div>${en ? "Balance" : "余额"} <strong>${formatMoney(fin.money)}</strong>
        <span class="muted"> · ${en ? "Season net " : "本季净额 "}<strong class="${net >= 0 ? "stat-high" : "stat-low"}">${formatMoney(net)}</strong></span></div>
      <div class="muted">🎟️ ${ticketLine}</div>
      ${ticketFactors ? `<div class="muted">↳ ${escapeHtml(ticketFactors)}</div>` : ""}
      <div class="muted">🎟️ ${seasonGate}</div>
      <div class="muted">🤝 ${commercialLine}</div>
      <div class="muted">📺 ${tvPrizeLine}</div>
      <div class="muted">🔁 ${xferTxt}</div>
      <div class="muted">📉 ${spent}</div>
      <div class="muted">${en ? "Weekly operation" : "每周运营"} ${formatMoney(fin.weekly)}
        （${en ? "wages" : "薪资"} ${formatMoney(fin.squadWage + fin.youthWage + fin.staffWage)}
        + ${en ? "facilities" : "设施"} ${formatMoney(fin.upkeep)}） · ${en ? "cash burn" : "现金消耗"} ${formatMoney(fin.weeklyCashBurn || 0)}</div>
      <div class="${fin.critical ? "stat-low" : fin.warning ? "stat-mid" : "muted"}">
        ${en ? "Runway" : "可撑"} ~${fin.weeksCover} ${en ? "weeks" : "周"}
        ${fin.critical ? (en ? " · CRITICAL" : " · 告急") : fin.warning ? (en ? " · tight" : " · 偏紧") : ""}
      </div>`;
  }
  const badgeEl = $("#dash-badges");
  if (badgeEl) {
    const badges = checkManagerBadges(world) || [];
    if (!badges.length) {
      badgeEl.innerHTML = `<span class="muted">${en ? "No badges yet" : "暂无成就徽章"}</span>`;
    } else {
      badgeEl.innerHTML = badges
        .slice(0, 6)
        .map((b) => `<span class="badge-chip" title="${escapeHtml(b.detail || "")}">🏅 ${escapeHtml(b.title)}</span>`)
        .join(" ");
    }
  }
}

/** 财政页渲染委托给 js/ui/finance.js；world 与筛选状态由这里托管后传入 */
function renderFinance() {
  if (!world) return;
  const club = getUserClub(world);
  if (!club) return;
  renderFinanceView(world, club, getLang() === "en", {
    ledgerFilter: financeLedgerFilter,
    onFilterReset: (next) => {
      financeLedgerFilter = next;
    },
  });
}

function ovrClass(n) {
  if (n >= 15) return "stat-high";
  if (n >= 11) return "stat-mid";
  return "stat-low";
}

let squadTableView = (() => {
  try { return localStorage.getItem("vcfm-squad-view") === "full" ? "full" : "compact"; }
  catch (_) { return "compact"; }
})();
let selectedRegistrationKey = "league";

function fixtureForRegistrationContext(context) {
  if (context.type === "continental") {
    return {
      competition: "continental",
      competitionType: "continental-league-stage",
      competitionId: context.competitionId,
      competitionName: context.name,
    };
  }
  return { competition: "league", competitionType: "league" };
}

function renderSquadRegistration() {
  const table = $("#registration-table");
  const select = $("#registration-competition");
  const summaryBox = $("#registration-summary");
  if (!world || !table || !select || !summaryBox) return;
  const club = getUserClub(world);
  const en = getLang() === "en";
  const heading = $("#registration-heading");
  const statusHeading = $("#registration-th-status");
  const developmentHeading = $("#registration-th-development");
  const routeHeading = $("#registration-th-route");
  if (heading) heading.textContent = en ? "Competition registration" : "赛事报名";
  if (statusHeading) statusHeading.textContent = en ? "Selected" : "报名";
  if (developmentHeading) developmentHeading.textContent = en ? "Development status" : "培养资格";
  if (routeHeading) routeHeading.textContent = en ? "Eligibility route" : "参赛路径";
  const contexts = availableRegistrationContexts(world, club);
  if (!contexts.some((context) => context.key === selectedRegistrationKey)) {
    selectedRegistrationKey = contexts[0]?.key || "league";
  }
  select.innerHTML = contexts
    .map((context) => `<option value="${escapeHtml(context.key)}"${context.key === selectedRegistrationKey ? " selected" : ""}>${escapeHtml(context.type === "league" ? (en ? "Domestic league" : "国内联赛") : context.name)}</option>`)
    .join("");
  const context = contexts.find((item) => item.key === selectedRegistrationKey) || contexts[0];
  if (!context) return;
  const summary = registrationSummary(world, club, context);
  const entryIds = new Set(summary.entry.playerIds || []);
  const fixture = fixtureForRegistrationContext(context);
  const quotaText = context.type === "continental"
    ? `${en ? "Club-trained" : "本俱乐部培养"} ${summary.clubTrained}/4 · ${en ? "Association-trained" : "本足协培养"} ${summary.associationTrained}/8`
    : `${en ? "Association-trained" : "本足协培养"} ${summary.associationTrained}`;
  summaryBox.innerHTML = `
    <div><span>${en ? "A-list" : "A 名单"}</span><strong>${summary.registered}/25</strong></div>
    <div><span>${en ? "Non-association trained" : "非本足协培养"}</span><strong class="${summary.nonAssociation > 17 ? "stat-low" : ""}">${summary.nonAssociation}/17</strong></div>
    <div><span>${quotaText}</span><strong>${summary.exempt} ${en ? "exempt" : "人免报名"}</strong></div>
    <div><span>${summary.locked ? (en ? "List locked" : "名单已锁定") : (en ? "Registration window open" : "报名窗口开放")}</span><strong class="${summary.valid ? "stat-high" : "stat-low"}">${summary.valid ? (en ? "Valid" : "合规") : (en ? "Invalid" : "不合规")}</strong></div>`;
  const hint = $("#registration-window-hint");
  if (hint) {
    hint.textContent = context.type === "continental"
      ? (en ? "25-player A-list: no more than 17 non-homegrown; four club-trained places. Club-trained U21 players with two years qualify for List B." : "25 人 A 名单最多 17 名非本土培养，并预留 4 个本俱乐部培养名额；在队培养满 2 年的 U21 可走 B 名单。")
      : (en ? "25-player league list with no more than 17 non-association-trained players; U21 players are exempt." : "联赛 25 人名单最多 17 名非本足协培养；U21 球员免占名额。") ;
  }
  const autoButton = $("#btn-registration-auto");
  if (autoButton) {
    autoButton.textContent = en ? "Auto-select" : "自动报名";
    autoButton.disabled = summary.locked;
    autoButton.onclick = () => {
      const result = autoRegisterClub(world, club, context);
      toast(en ? (result.ok ? "Registration submitted" : result.msg) : result.msg);
      if (result.ok) {
        saveGame(world);
        renderSquadRegistration();
        renderTactics();
      }
    };
  }
  select.onchange = () => {
    selectedRegistrationKey = select.value;
    renderSquadRegistration();
  };
  const rows = [...(club.players || [])].sort((a, b) => b.ovr - a.ovr);
  table.querySelector("tbody").innerHTML = rows.map((player) => {
    const status = developmentStatus(world, club, player);
    const eligibility = playerCompetitionEligibility(world, club, fixture, player);
    const exempt = eligibility.route === "u21" || eligibility.route === "list-b";
    const trained = status.clubTrained
      ? `<span class="badge MID">${en ? "Club-trained" : "本俱乐部培养"}</span><span class="muted">${status.clubYears}${en ? "y" : "年"}</span>`
      : status.associationTrained
        ? `<span class="badge DEF">${en ? "Association-trained" : "本足协培养"}</span><span class="muted">${status.associationYears}${en ? "y" : "年"}</span>`
        : `<span class="muted">${en ? "Non-homegrown" : "非本土培养"}</span>`;
    const route = eligibility.route === "u21"
      ? (en ? "U21 exempt" : "U21 免报名")
      : eligibility.route === "list-b"
        ? (en ? "List B" : "B 名单")
        : entryIds.has(player.id)
          ? (en ? "A-list" : "A 名单")
          : (en ? "Not eligible" : "未报名");
    return `<tr class="${eligibility.eligible ? "" : "row-unavailable"}">
      <td><input type="checkbox" data-registration-player="${escapeHtml(player.id)}" ${entryIds.has(player.id) || exempt ? "checked" : ""} ${summary.locked || exempt ? "disabled" : ""} aria-label="${escapeHtml(player.name)}"></td>
      <td>${playerLinkHtml(player.id, player.name)}</td>
      <td><span class="badge ${player.pos}">${escapeHtml(positionLabel(player.pos))}</span></td>
      <td>${player.age}</td>
      <td class="${ovrClass(player.ovr)}"><strong>${player.ovr}</strong></td>
      <td>${trained}</td>
      <td>${escapeHtml(route)}</td>
    </tr>`;
  }).join("");
  table.querySelectorAll("[data-registration-player]").forEach((checkbox) => {
    checkbox.onchange = () => {
      const result = setPlayerRegistered(world, club, context, checkbox.dataset.registrationPlayer, checkbox.checked);
      toast(en ? (result.ok ? "Registration updated" : result.msg) : result.msg);
      if (result.ok) saveGame(world);
      renderSquadRegistration();
      renderTactics();
    };
  });
}

function renderSquadPlan(club) {
  const root = $("#squad-plan-summary");
  if (!root) return;
  const en = getLang() === "en";
  const plan = ensureClubSquadPlan(world, club);
  if (!plan) {
    root.innerHTML = `<p class="muted">${en ? "Squad planning is unavailable." : "暂无阵容规划。"}</p>`;
    return;
  }
  const actionLabels = {
    renew: en ? "Renew" : "续约",
    loan: en ? "Loan" : "外租",
    develop: en ? "Develop" : "培养",
    replace: en ? "Successor" : "接班",
    sell: en ? "Sell" : "出售",
    release: en ? "Release" : "解约",
  };
  const actionTone = {
    renew: "DEF",
    loan: "MID",
    develop: "GK",
    replace: "ATT",
    sell: "ATT",
    release: "ATT",
  };
  const registration = plan.registration;
  const registrationText = registration.risk
    ? (en
        ? `${registration.clubTrained}/4 club-trained · ${registration.associationTrained}/8 association-trained · ${registration.nonAssociation} non-homegrown`
        : `本俱乐部培养 ${registration.clubTrained}/4 · 本足协培养 ${registration.associationTrained}/8 · 非本土培养 ${registration.nonAssociation}`)
    : (en
        ? `${registration.clubTrained} club-trained · ${registration.associationTrained} association-trained`
        : `本俱乐部培养 ${registration.clubTrained} · 本足协培养 ${registration.associationTrained}`);
  const positionRows = plan.orderedNeeds.map((position) => {
    const row = plan.positions[position];
    const quality = row.peerAverage > 0
      ? `${row.starterAverage.toFixed(1)} / ${row.peerAverage.toFixed(1)}`
      : row.starterAverage.toFixed(1);
    return `<tr>
      <td><span class="badge ${position}">${escapeHtml(en ? position : row.label)}</span></td>
      <td>${row.slots}</td>
      <td><strong>${row.current}</strong> / ${row.ideal}</td>
      <td>${row.securedNext} / ${row.securedTwoYears}</td>
      <td>${quality}</td>
      <td>${escapeHtml((en ? row.reasonsEn : row.reasons).slice(0, 2).join("；"))}</td>
    </tr>`;
  }).join("");
  const detailedNeedsText = (plan.detailedNeeds || []).slice(0, 4).map((need) =>
    en
      ? `${need.labelEn} (${need.readyCount} ready, best ${need.bestRating}/20)`
      : `${need.label}（可用 ${need.readyCount} 人，最佳 ${need.bestRating}/20）`
  ).join(" · ");
  const priorityHtml = plan.priorities.length
    ? plan.priorities.slice(0, 6).map((decision) => `
        <li>
          <span class="badge ${actionTone[decision.action] || "MID"}">${escapeHtml(actionLabels[decision.action] || decision.action)}</span>
          <strong>${playerLinkHtml(decision.playerId, decision.playerName)}</strong>
          <span class="muted">${escapeHtml(en ? decision.reasonEn : decision.reason)}</span>
        </li>`).join("")
    : `<li class="muted">${en ? "No urgent personnel decisions." : "暂无紧急人员决策。"}</li>`;

  root.innerHTML = `
    <div class="row-between squad-plan-heading">
      <div>
        <h2>${en ? "Multi-year squad plan" : "多年阵容规划"}</h2>
        <p class="hint">${en
          ? `Formation ${plan.formation} · ${plan.seasonPlanLabelEn}. Transfers, contracts, promotions and loans read these same squad facts; no hidden match bonus is added.`
          : `阵型 ${plan.formation} · ${plan.seasonPlanLabel}。转会、合同、提拔与租借读取同一份阵容事实，不添加隐藏比赛加成。`}</p>
        ${detailedNeedsText ? `<p class="hint">${escapeHtml(en ? `Detailed slot coverage: ${detailedNeedsText}` : `细分槽位覆盖：${detailedNeedsText}`)}</p>` : ""}
      </div>
      <span class="badge ${registration.risk ? "ATT" : "DEF"}">${registration.risk ? (en ? "Registration risk" : "报名风险") : (en ? "Registration stable" : "报名稳定")}</span>
    </div>
    <div class="squad-plan-metrics">
      <div><span>${en ? "Current / ideal" : "当前 / 理想人数"}</span><strong>${plan.squad.current} / ${plan.squad.ideal}</strong></div>
      <div><span>${en ? "Contracted next season" : "已签约下季"}</span><strong>${plan.squad.securedNext}</strong></div>
      <div><span>${en ? "Contracted in two years" : "已签约两年后"}</span><strong>${plan.squad.securedTwoYears}</strong></div>
      <div><span>${en ? "Average age" : "平均年龄"}</span><strong>${plan.squad.averageAge.toFixed(1)}</strong></div>
    </div>
    <p class="squad-plan-registration ${registration.risk ? "risk" : ""}">${escapeHtml(registrationText)}</p>
    <div class="squad-plan-grid">
      <div class="table-wrap">
        <table class="squad-plan-table">
          <thead><tr>
            <th>${en ? "Unit" : "位置"}</th>
            <th>${en ? "XI" : "首发位"}</th>
            <th>${en ? "Now / ideal" : "当前 / 理想"}</th>
            <th>${en ? "Next / +2y" : "下季 / 两年后"}</th>
            <th>${en ? "Quality / division" : "主力 / 同级"}</th>
            <th>${en ? "Evidence" : "依据"}</th>
          </tr></thead>
          <tbody>${positionRows}</tbody>
        </table>
      </div>
      <div class="squad-plan-priorities">
        <h3>${en ? "Personnel priorities" : "人员优先事项"}</h3>
        <ul>${priorityHtml}</ul>
      </div>
    </div>`;
}

/** 更衣室：领袖、派系与摩擦。关系由现有事实推导，此处只做呈现。 */
function renderDressingRoom(club) {
  const root = $("#dressing-room-summary");
  if (!root || !club) return;
  const en = getLang() === "en";
  const harmony = dressingRoomHarmony(club, world);
  const leaders = dressingRoomLeaders(club, world, 4);
  const factions = dressingRoomFactions(club, world);
  const frictions = dressingRoomFrictions(club, world, 4);
  const captainId = club.tactics?.captainId || null;
  const tone = harmony >= 60 ? "DEF" : harmony >= 42 ? "MID" : "ATT";

  const leaderHtml = leaders.length
    ? leaders.map((p) => {
        const badge = p.id === captainId ? `<span class="badge DEF">${en ? "Captain" : "队长"}</span>` : "";
        return `<li>
          <strong>${playerLinkHtml(p.id, p.name)}</strong> ${badge}
          <span class="muted">${escapeHtml(`${p.age}${en ? "y" : "岁"} · ${relationLabel(p.relation || 0, en ? "en" : "zh")}`)}</span>
        </li>`;
      }).join("")
    : `<li class="muted">${en ? "No established leaders yet." : "尚未形成队内领袖。"}</li>`;

  const factionHtml = factions.length
    ? factions.map((f) => {
        const stanceLabel = f.stance >= 0.5
          ? (en ? "Backs the manager" : "支持主帅")
          : f.stance <= -0.5
            ? (en ? "Unsettled" : "离心")
            : (en ? "Neutral" : "中立");
        const stanceTone = f.stance >= 0.5 ? "DEF" : f.stance <= -0.5 ? "ATT" : "MID";
        return `<li>
          <span class="badge ${stanceTone}">${escapeHtml(stanceLabel)}</span>
          <strong>${playerLinkHtml(f.leaderId, f.leaderName)}</strong>
          <span class="muted">${escapeHtml(en ? `${f.size} players` : `${f.size} 人`)}</span>
        </li>`;
      }).join("")
    : `<li class="muted">${en ? "No distinct cliques — the squad mixes freely." : "没有明显的小圈子，全队相处平顺。"}</li>`;

  const frictionHtml = frictions.length
    ? frictions.map((f) => `<li>
        <strong>${playerLinkHtml(f.aId, f.aName)}</strong>
        <span class="muted">${en ? "vs" : "与"}</span>
        <strong>${playerLinkHtml(f.bId, f.bName)}</strong>
      </li>`).join("")
    : `<li class="muted">${en ? "No notable clashes in the squad." : "队内暂无明显不合。"}</li>`;

  root.innerHTML = `
    <div class="row-between squad-plan-heading">
      <div>
        <h2>${en ? "Dressing room" : "更衣室"}</h2>
        <p class="hint">${en
          ? "Bonds are derived from shared nationality, age, youth-team background, seasons together and positional rivalry. They shape who speaks up, never a hidden match bonus."
          : "关系由同国籍、年龄、青训出身、共事赛季与位置竞争推导，只影响谁会发声，不写入隐藏比赛加成。"}</p>
      </div>
      <span class="badge ${tone}">${escapeHtml(harmonyLabel(harmony, en ? "en" : "zh"))} ${harmony}</span>
    </div>
    <div class="squad-plan-grid dressing-room-grid">
      <div class="dressing-room-block">
        <h3>${en ? "Leaders" : "队内领袖"}</h3>
        <ul>${leaderHtml}</ul>
      </div>
      <div class="dressing-room-block">
        <h3>${en ? "Cliques" : "小圈子"}</h3>
        <ul>${factionHtml}</ul>
      </div>
      <div class="dressing-room-block">
        <h3>${en ? "Friction" : "队内不合"}</h3>
        <ul>${frictionHtml}</ul>
      </div>
    </div>`;
}

function renderSquad() {
  const club = getUserClub(world);
  const en = getLang() === "en";
  // 旧存档里体能可能是浮点（训练 *0.6）；展示与存档一并收成整数
  for (const p of club.players || []) {
    if (p.fitness != null && !Number.isInteger(p.fitness)) {
      p.fitness = Math.round(Math.max(0, Math.min(100, p.fitness)));
    }
    if (p.morale != null && !Number.isInteger(p.morale)) {
      p.morale = Math.round(Math.max(0, Math.min(100, p.morale)));
    }
  }
  const xi = new Set(club.tactics.lineup);
  const table = $("#squad-table");
  const tbody = $("#squad-table tbody");
  const sorted = [...club.players].sort((a, b) => b.ovr - a.ovr);

  table?.classList.toggle("squad-compact", squadTableView === "compact");
  table?.classList.toggle("squad-full", squadTableView === "full");
  document.querySelectorAll("[data-squad-view]").forEach((button) => {
    const active = button.dataset.squadView === squadTableView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  $("#squad-count").textContent = t("squad.count", { n: sorted.length });

  tbody.innerHTML = sorted
    .map((p) => {
      ensureDiscipline(p);
      ensurePlayerHistory(p);
      const ovr = p.ovr || playerOverall(p);
      const s = playerStats(p);
      const isGk = p.pos === "GK";
      const detailedPosition = positionSummary(p, en ? "en" : "zh");
      // 本赛季：出场 / 进球·零封 / 助攻·失球
      const apps = s.apps || 0;
      const colG = isGk ? s.cleanSheets || 0 : s.goals || 0;
      const colA = isGk ? s.goalsConceded || 0 : s.assists || 0;
      const gTitle = isGk
        ? t("squad.csTitle") || "本赛季零封"
        : t("squad.goalsTitle") || "本赛季进球";
      const aTitle = isGk
        ? t("squad.gaTitle") || "本赛季失球"
        : t("squad.astTitle") || "本赛季助攻";
      const gCls = !isGk && colG > 0 ? "stat-high" : isGk && colG > 0 ? "stat-high" : "";
      const aCls =
        isGk && colA > 0 ? "stat-low" : !isGk && colA > 0 ? "stat-mid" : "";
      const avgR = seasonAvgRating(p);
      const lastR = s.lastRating != null ? s.lastRating : null;
      const form = playerForm(p);
      const playingTime = ensurePlayerPathway(p, club, world);
      const playingProgress = playingTimeProgress(world, club, p);
      const matchSharpness = developmentSharpness(world, p);
      const playingTitle = `${playingTimeRoleLabel(playingTime.role, en ? "en" : "zh")} · ${Math.round(playingProgress.minutesShare * 100)}% / ${Math.round(playingProgress.target * 100)}% · ${en ? "match sharpness" : "比赛锐度"} ${matchSharpness}`;
      const formTitle = form == null
        ? (en ? "Form: no recent ratings yet" : "状态：暂无近期评分")
        : `${en ? "Form" : "状态"} ${formatForm(form)} · ${formToneLabel(form, en ? "en" : "zh")} (${en ? "last" : "近"}${(s.recentRatings || []).length}${en ? " apps" : "场"})`;
      const num = p.number != null ? p.number : "—";
      const injuredDays = injuryDays(p);
      const recoveryStatus = injuryStatusText(p, en);
      const statusBadges = [
        xi.has(p.id) ? `<span class="badge">${en ? "XI" : "首发"}</span>` : "",
        p.loan ? `<span class="badge loan" title="${escapeHtml(t("contract.loanIn") || "租借")}">${escapeHtml(t("contract.loanIn") || "租借")}</span>` : "",
        injuredDays
          ? `<span class="badge ATT" title="${escapeHtml(injuryDetailText(p, en))}">${escapeHtml(recoveryStatus)}</span>`
          : recoveryStatus
            ? `<span class="badge MID" title="${escapeHtml(injuryDetailText(p, en))}">${escapeHtml(recoveryStatus)}</span>`
          : "",
        (p.suspendedMatches || 0) > 0
          ? `<span class="badge ATT" title="${en ? "Suspended" : "停赛"}">${en ? "Sus" : "停"}${p.suspendedMatches}</span>`
          : "",
        (p.yellowsSeason || 0) >= 4 && !(p.suspendedMatches > 0)
          ? `<span class="badge" style="background:#e6b450;color:#111" title="${en ? "Season yellows" : "累计黄牌"}">${en ? "Y" : "黄"}${p.yellowsSeason}</span>`
          : "",
        p._needsRenew
          ? `<span class="badge contract-urgent" title="${escapeHtml(t("contract.needsRenew") || "待续约")}">${escapeHtml(t("contract.needsRenew") || "待续")}</span>`
          : (p.contractYears || 0) <= 1 && !p.loan
            ? `<span class="badge contract-short" title="${escapeHtml(t("contract.expiring") || "合同将尽")}">${escapeHtml(t("contract.expiring") || "将尽")}</span>`
            : "",
      ]
        .filter(Boolean)
        .join(" ");
      const contractCell = p.loan
        ? escapeHtml(t("contract.loanIn") || "租借")
        : p._needsRenew
          ? escapeHtml(t("contract.needsRenew") || "待续约")
          : `${p.contractYears ?? "—"}${en ? "y" : "年"}`;
      return `<tr class="${xi.has(p.id) ? "me" : ""} ${!isAvailable(p) ? "row-unavailable" : ""} ${needsContractAttention(p) && !p.loan ? "row-contract" : ""}">
        <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(club)}">${num}</span></td>
        <td class="name-with-avatar">${playerAvatarHtml(p, club, 32)} <span>${playerLinkHtml(p.id, p.name)} ${statusBadges}</span></td>
        <td title="${escapeHtml(detailedPosition)}"><span class="badge ${p.pos}">${en ? p.pos : POS_LABEL[p.pos]}</span><small class="muted squad-position-detail">${escapeHtml(detailedPosition)}</small></td>
        <td class="${ovrClass(ovr)}"><strong>${ovr}</strong></td>
        <td class="num-stat rating-cell ${formClass(form)}" title="${escapeHtml(formTitle)}">${formatForm(form)}</td>
        <td>${Math.round(p.fitness ?? 0)}%</td>
        <td class="contract-cell">${contractCell}</td>
        <td class="squad-detail">${nationLabel(p)}</td>
        <td class="squad-detail">${p.age}</td>
        <td class="num-stat squad-detail" title="${escapeHtml(t("squad.appsTitle") || "本赛季出场")}">${apps}</td>
        <td class="num-stat squad-detail ${gCls}" title="${escapeHtml(gTitle)}">${colG}</td>
        <td class="num-stat squad-detail ${aCls}" title="${escapeHtml(aTitle)}">${colA}</td>
        <td class="num-stat rating-cell squad-detail ${ratingClass(avgR)}" title="${escapeHtml(t("squad.avgRTitle") || "本赛季场均评分")}">${formatRating(avgR)}</td>
        <td class="num-stat rating-cell squad-detail ${ratingClass(lastR)}" title="${escapeHtml(t("squad.lastRTitle") || "最近一场评分")}">${formatRating(lastR)}</td>
        <td class="squad-detail">${Math.round(p.morale ?? 0)}</td>
        <td class="rel-cell squad-detail rel-${relationTone(p.relation)}">${escapeHtml(relationLabel((ensurePlayerRelation(p), p.relation), getLang() === "en" ? "en" : "zh"))}</td>
        <td class="squad-detail" title="${escapeHtml(playingTitle)}"><span class="badge ${playingProgress.fulfilment >= 0.9 ? "DEF" : playingProgress.fulfilment >= 0.7 ? "MID" : "ATT"}">${escapeHtml(playingTimeRoleLabel(playingTime.role, en ? "en" : "zh"))}</span></td>
        <td class="squad-detail">${formatMoney(p.value)}</td>
        <td class="squad-detail">${formatMoney(p.wage)}</td>
        <td><button class="btn small" data-pid="${p.id}">${en ? "Info" : "详情"}</button></td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("button[data-pid]").forEach((btn) => {
    btn.onclick = () => showPlayerModal(btn.dataset.pid);
  });
  renderSquadPlan(club);
  renderDressingRoom(club);
  renderSquadRegistration();
}

function showPlayerModal(playerId, context = {}) {
  const club = getUserClub(world);
  const en = getLang() === "en";
  let player = club.players.find((p) => p.id === playerId);
  let isYouth = false;
  let fromOther = null;
  // 青训名单与一线队共用详情弹窗；青训球员不在 club.players 中，
  // 因此必须在查找其他俱乐部之前单独覆盖本队学院名单。
  if (!player) {
    player = club.youth?.players?.find((p) => p.id === playerId);
    isYouth = !!player;
  }
  if (!player) {
    for (const c of world.clubs) {
      player = c.players.find((p) => p.id === playerId);
      if (player) {
        fromOther = c;
        break;
      }
    }
  }
  // 退役球员历史（若之后 UI 引用）
  if (!player && world.retiredPlayers) {
    player = world.retiredPlayers.find((p) => p.id === playerId);
  }
  if (!player) return;

  const browseContext = resolvePlayerBrowseContext(player.id, context);
  activePlayerBrowseContext = browseContext;

  const owningClub = fromOther || world.clubs.find((item) => item.id === player.clubId) || (isYouth ? club : null);
  const nationalCode = context.nationCode === player.nationality ? context.nationCode : null;
  const nationalNumber = nationalCode && context.squadNumber != null ? Number(context.squadNumber) : null;
  const displayTeam = nationalCode ? nationalTeamView(nationalCode) : owningClub;
  let displayNumber = nationalCode ? nationalNumber : player.number;

  ensureFootballProfile(player);
  const a = player.attrs;
  const isOther = !!fromOther;
  const fogRows = scoutAttrRows(player, club, {
    ownPlayer: !isOther,
    lang: getLang() === "en" ? "en" : "zh",
    world,
  });
  const playerScout = isOther ? scoutPlayerSnapshot(world, player, club) : null;
  const isManagedPlayer =
    !isOther &&
    (club.players?.some((item) => item.id === player.id) ||
      club.youth?.players?.some((item) => item.id === player.id));

  const pot = isOther
      ? formatScoutPotFog(player, club, {
          ownPlayer: false,
          lang: getLang() === "en" ? "en" : "zh",
          world,
        })
    : player.potential != null
      ? String(player.potential)
      : "—";
  const ovrShow = isOther
    ? formatScoutOvrFog(player, club, { ownPlayer: false, world })
    : String(player.ovr);
  ensurePlayerHistory(player);
  ensureIntl(player);
  ensureHonors(player);
  const season = playerStats(player);
  const career = careerStats(player);
  const intl = player.intl || {};
  const isGk = player.pos === "GK";
  const detailedPosition = positionSummary(player, en ? "en" : "zh");
  const numberPreference = numberPreferenceLabel(player);
  const numberPreferenceStrength = numberPreference.strength === "strong"
    ? (en ? "strong" : "强烈")
    : numberPreference.strength === "light"
      ? (en ? "light" : "一般")
      : (en ? "normal" : "明确");
  const numberPreferenceText = numberPreference.numbers.length
    ? `${en ? "Preferred numbers" : "钟情号码"} ${numberPreference.numbers.map((number) => `#${number}`).join(" / ")}（${numberPreferenceStrength}）`
    : "";

  // 分赛季历史 + 当前未归档赛季
  const curAvgR = seasonAvgRating(player);
  const curForm = playerForm(player);
  const recentStrip = Array.isArray(season.recentRatings) ? season.recentRatings : [];
  const historyRows = [...(player.history || [])]
    .sort((a, b) => b.season - a.season)
    .map((h) => {
      const historyClub = world.clubs.find((item) => item.id === h.clubId);
      const historyClubHtml = historyClub
        ? clubLinkHtml(historyClub.id, clubDisplayName(historyClub))
        : escapeHtml(h.clubName || "—");
      return `<tr>
        <td>${h.season}</td>
        <td>${historyClubHtml}</td>
        <td>${h.apps}</td>
        <td>${isGk ? h.cleanSheets : h.goals}</td>
        <td>${isGk ? h.goalsConceded : h.assists}</td>
        <td class="rating-cell ${ratingClass(h.avgRating)}">${formatRating(h.avgRating)}</td>
      </tr>`;
    });
  if (season.apps || season.goals || season.assists || season.cleanSheets || season.goalsConceded) {
    const currentClub = owningClub || getUserClub(world);
    const clubName = clubDisplayName(currentClub);
    historyRows.unshift(`<tr class="me">
      <td>${world.season}*</td>
      <td>${currentClub ? clubLinkHtml(currentClub.id, clubName) : escapeHtml(clubName)}</td>
      <td>${season.apps}</td>
      <td>${isGk ? season.cleanSheets : season.goals}</td>
      <td>${isGk ? season.goalsConceded : season.assists}</td>
      <td class="rating-cell ${ratingClass(curAvgR)}">${formatRating(curAvgR)}</td>
    </tr>`);
  }

  const histHead = isGk
    ? `<th>${en ? "Season" : "赛季"}</th><th>${en ? "Club" : "球队"}</th><th>${en ? "Apps" : "出场"}</th><th>${en ? "CS" : "零封"}</th><th>${en ? "GA" : "失球"}</th><th>${en ? "Avg" : "场均"}</th>`
    : `<th>${en ? "Season" : "赛季"}</th><th>${en ? "Club" : "球队"}</th><th>${en ? "Apps" : "出场"}</th><th>${en ? "Goals" : "进球"}</th><th>${en ? "Assists" : "助攻"}</th><th>${en ? "Avg" : "场均"}</th>`;

  const honorHtml = (player.honors || []).length
    ? `<div class="honor-list">${player.honors
        .slice(0, 12)
        .map(
          (h) => `<div class="honor-item">
            <div class="season">${h.season} · ${escapeHtml(h.clubName || "")}</div>
            <strong>${escapeHtml(h.title)}</strong>
            ${h.detail ? ` <span class="muted">（${escapeHtml(h.detail)}）</span>` : ""}
          </div>`
        )
        .join("")}</div>`
    : `<p class="muted" style="margin:0">${en ? "No honours yet. End-of-season awards and titles will appear here." : "暂无荣誉，赛季末金靴/助攻王/最佳阵容/冠军等会写入此处"}</p>`;

  if (owningClub) {
    ensureKit(owningClub);
    if (!nationalCode) {
      ensurePlayerNumber(owningClub, player);
      displayNumber = player.number;
    }
  }
  if (displayTeam) ensureKit(displayTeam);
  const trainingStatus = owningClub ? developmentStatus(world, owningClub, player) : null;
  const trainingLabel = trainingStatus?.clubTrained
    ? (en ? `Club-trained (${trainingStatus.clubYears}y)` : `本俱乐部培养（${trainingStatus.clubYears} 年）`)
    : trainingStatus?.associationTrained
      ? (en ? `Association-trained (${trainingStatus.associationYears}y)` : `本足协培养（${trainingStatus.associationYears} 年）`)
      : (en ? "Non-homegrown" : "非本土培养");
  $("#modal-card")?.classList.remove("wide", "search-modal");
  $("#modal-body").innerHTML = `
    ${playerBrowseNavHtml(browseContext)}
    <div class="player-modal-head">
      ${playerAvatarHtml(player, displayTeam, 96)}
      ${displayTeam ? renderKitShirt(displayTeam, displayNumber, 56) : ""}
      <div>
    <h2 style="margin:0 0 0.25rem">${escapeHtml(player.name)}${displayNumber != null ? ` <span class="muted">#${displayNumber}</span>` : ""}</h2>
    <p class="muted">
       <span class="badge ${player.pos}">${en ? player.pos : POS_LABEL[player.pos]}</span>
       · ${en ? "Natural / compatible" : "主位 / 兼容位置"} ${escapeHtml(detailedPosition)}
       ${!isOther || (playerScout?.level || 0) >= 68 ? ` · ${en ? "Profile" : "属性类型"} ${escapeHtml(attributeArchetypeLabel(player, en ? "en" : "zh"))}` : ""}
       · ${nationLabel(player)}
       · ${en ? `Age ${player.age}` : `${player.age} 岁`} · ${en ? "Ability" : "能力"} <strong class="${isOther ? "" : ovrClass(player.ovr)}">${escapeHtml(ovrShow)}</strong>
       · ${en ? "Potential" : "潜力"} <strong>${escapeHtml(String(pot))}</strong>
       ${numberPreferenceText ? ` · ${escapeHtml(numberPreferenceText)}` : ""}
       · ${en ? "Foot" : "惯用脚"} ${escapeHtml(preferredFootLabel(player.preferredFoot, en))}
       · ${en ? "Height" : "身高"} ${Number(player.heightCm) || "—"}cm
       ${isYouth ? ` · <span class="badge MID">${en ? "Academy" : "青训学院"}</span>` : player.fromYouth ? ` · <span class="badge MID">${en ? "Youth graduate" : "青训"}</span>` : ""}
       ${owningClub ? ` · ${clubLinkHtml(owningClub.id, clubDisplayName(owningClub))}` : ""}
       ${nationalCode ? ` · <span class="badge">${escapeHtml(en ? "National team" : "国家队")}</span>` : ""}
      ${isOther ? ` · <span class="muted">${en ? "Knowledge" : "知识"} ${Math.round(playerScout.level)}/100 · ${escapeHtml(scoutingFreshnessLabel(playerScout, en ? "en" : "zh"))}</span>` : ""}
    </p>
      </div>
    </div>
    <p>${en ? "Value" : "身价"} ${fromOther ? formatScoutValue(world, player) : formatMoney(player.value)} · ${en ? "Wage" : "周薪"} ${formatMoney(player.wage)} · ${en ? "Fitness" : "体能"} ${Math.round(player.fitness ?? 0)}% · ${en ? "Morale" : "士气"} ${Math.round(player.morale ?? 0)}
      ${injuryStatusText(player, en) ? ` · <span class="badge ${injuryDays(player) ? "ATT" : "MID"}" title="${escapeHtml(injuryDetailText(player, en))}">${escapeHtml(injuryDetailText(player, en))}</span>` : ""}
      ${
        (player.suspendedMatches || 0) > 0
          ? ` · <span class="badge ATT">${en ? `Suspended ${player.suspendedMatches}` : `停赛 ${player.suspendedMatches} 场`}</span>`
          : ""
      }
      ${
        (player.yellowsSeason || 0) > 0
          ? ` · ${en ? "Season yellows" : "赛季黄牌"} ${player.yellowsSeason}`
          : ""
      }
      ${
        player.loan
          ? ` · <span class="badge loan">${escapeHtml(t("contract.loanIn") || "租借")}</span>`
          : player.contractYears != null
            ? ` · ${en ? `Contract ${player.contractYears}y` : `合同 ${player.contractYears} 年`}`
            : ""
      }
      ${player._needsRenew ? ` · <span class="badge contract-urgent">${escapeHtml(t("contract.needsRenew") || "待续约")}</span>` : ""}
      ${trainingStatus ? ` · <span class="badge ${trainingStatus.clubTrained ? "MID" : trainingStatus.associationTrained ? "DEF" : ""}">${escapeHtml(trainingLabel)}</span>` : ""}
    </p>
    ${
      fromOther
        ? formatScoutReportHtml(
            buildScoutReport(world, player, getUserClub(world)),
            formatMoney,
            getLang() === "en" ? "en" : "zh"
          )
        : ""
    }
    ${renderPlayerHabitsPanel(player, {
      isOther,
      snapshot: playerScout,
      canManage: isManagedPlayer && !world?.sacked,
      delegated: isManagedPlayer && isFullyDelegated(world, club, "development"),
    })}
    ${!fromOther && !isYouth ? renderPlayerTalkPanel(player) : ""}
    ${!isYouth ? renderPlayerContractActions(player, fromOther) : ""}

    <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${en ? "This season (club)" : "本赛季（俱乐部）"}</h3>
    <p class="muted" style="margin:0">${en ? "Apps" : "出场"} ${season.apps}
      ${
        isGk
          ? ` · ${en ? "Clean sheets" : "零封"} ${season.cleanSheets} · ${en ? "Goals conceded" : "失球"} ${season.goalsConceded}`
          : ` · ${en ? "Goals" : "进球"} ${season.goals} · ${en ? "Assists" : "助攻"} ${season.assists}`
      }
      · ${en ? "Average" : "场均"} <strong class="${ratingClass(curAvgR)}">${formatRating(curAvgR)}</strong>
      ${
        season.lastRating != null
          ? ` · ${en ? "Latest" : "最近"} <strong class="${ratingClass(season.lastRating)}">${formatRating(season.lastRating)}</strong>`
          : ""
      }
    </p>
    <p class="muted" style="margin:0.35rem 0 0" title="${escapeHtml(en ? "Rolling average of last up to 5 rated appearances (league, cup, continental and development)" : "最近最多 5 场已评分出场的滚动均值（含联赛/杯赛/洲际/发展队）")}">
      ${en ? "Form" : "状态"}
      <strong class="${formClass(curForm)}">${formatForm(curForm)}</strong>
      ${curForm != null ? ` <span class="form-pill ${formClass(curForm)}">${escapeHtml(formToneLabel(curForm, en ? "en" : "zh"))}</span>` : ""}
      ${
        recentStrip.length
          ? ` · ${en ? "Recent" : "近况"} ${recentStrip.map((r) => `<span class="rating-cell ${ratingClass(r)}">${formatRating(r)}</span>`).join(" ")}`
          : ` · <span class="hint">${en ? "Play matches to build form" : "出场后累积状态"}</span>`
      }
    </p>

    ${!fromOther ? `<h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${en ? "Development record" : "成长记录"}</h3>${renderPlayerDevelopmentPanel(player)}` : ""}

    <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${en ? "Career total (club)" : "生涯总计（俱乐部）"}</h3>
    <p class="muted" style="margin:0">${en ? "Apps" : "出场"} ${career.apps}
      ${
        isGk
          ? ` · ${en ? "Clean sheets" : "零封"} ${career.cleanSheets} · ${en ? "Goals conceded" : "失球"} ${career.goalsConceded}`
          : ` · ${en ? "Goals" : "进球"} ${career.goals} · ${en ? "Assists" : "助攻"} ${career.assists}`
      }
      <span style="opacity:0.7">${en ? "(including this season)" : "（含本赛季）"}</span>
    </p>

    <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${en ? "National team" : "国家队"}</h3>
    <p class="muted" style="margin:0">
      ${nationLabel(player)} · ${en ? "Caps" : "出场（Caps）"} <strong>${intl.caps || 0}</strong>
      ${
        isGk
          ? ` · ${en ? "Clean sheets" : "零封"} ${intl.cleanSheets || 0} · ${en ? "Goals conceded" : "失球"} ${intl.goalsConceded || 0}`
          : ` · ${en ? "Goals" : "进球"} ${intl.goals || 0} · ${en ? "Assists" : "助攻"} ${intl.assists || 0}`
      }
    </p>
    <p class="hint" style="margin:0.25rem 0 0">${en ? "International breaks occur about every 30 days; selected players accumulate international stats." : "约每 30 天国际比赛日，优秀球员可能入选并累积数据"}</p>

    <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${en ? "Honours" : "个人荣誉"}</h3>
    ${honorHtml}

    <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${en ? "Season history" : "分赛季历史"}</h3>
    <div class="table-wrap">
      <table style="font-size:var(--fs-base)">
        <thead><tr>${histHead}</tr></thead>
        <tbody>
          ${
            historyRows.length
              ? historyRows.join("")
              : `<tr><td colspan="5" class="muted">${en ? "No archived history yet" : "暂无历史，完赛并进入下一赛季后归档"}</td></tr>`
          }
        </tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:0.35rem">${en ? "* current season (not archived yet)" : "* 表示当前赛季（尚未归档）"}</p>

    <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${isOther ? (getLang() === "en" ? "Attributes (scout)" : "属性（球探可见）") : getLang() === "en" ? "Attributes" : "属性"}</h3>
    <div class="attrs${isOther ? " attrs-fogged" : ""}">
      ${fogRows
        .map((r) => {
          const mid = r.exact ? r.lo : Math.round(((r.lo || 1) + (r.hi || 10)) / 2);
          const width = r.exact || r.lo != null ? Math.max(4, Math.min(100, (mid / 20) * 100)) : 30;
          const cls = r.exact ? ovrClass(r.lo) : r.tier === "high" ? "stat-high" : r.tier === "weak" ? "stat-low" : "stat-mid";
          return `
        <div class="attr-row">
          <span>${escapeHtml(r.label)}</span>
          <span class="${cls}">${escapeHtml(r.text)}</span>
        </div>
        <div class="bar"><i style="width:${width}%"></i></div>
      `;
        })
        .join("")}
    </div>
  `;
  openSharedModal();
  $("#modal-card").scrollTop = 0;
  bindPlayerBrowseControls();
  if (isManagedPlayer) bindPlayerHabitActions(player, browseContext);
  if (!isYouth) {
    bindPlayerContractActions(player, fromOther);
    bindPlayerTalkActions(player, fromOther, browseContext);
  }
}

function playerBrowseItems(context) {
  if (!world || !context?.browseType || !context?.browseId) return [];
  const shared = {
    browseType: context.browseType,
    browseId: context.browseId,
    competitionId: context.competitionId || null,
    returnScrollTop: Number(context.returnScrollTop || 0),
    returnModalScrollTop: Number(context.returnModalScrollTop || 0),
  };
  if (context.browseType === "club") {
    const sourceClub = world.clubs.find((item) => item.id === context.browseId);
    if (!sourceClub) return [];
    return [...(sourceClub.players || [])]
      .sort((a, b) => (b.ovr || 0) - (a.ovr || 0))
      .slice(0, 16)
      .map((item) => ({ player: item, context: { ...shared } }));
  }
  if (context.browseType === "nation") {
    return nationalSquad(world, context.browseId).map(({ player: item, squadNumber }) => ({
      player: item,
      context: {
        ...shared,
        nationCode: context.browseId,
        squadNumber,
      },
    }));
  }
  return [];
}

function resolvePlayerBrowseContext(playerId, context = {}) {
  const items = playerBrowseItems(context);
  const index = items.findIndex((item) => item.player.id === playerId);
  if (index < 0) return null;
  return {
    ...items[index].context,
    playerId,
    index,
    total: items.length,
  };
}

function playerBrowseNavHtml(context) {
  if (!context) return "";
  const en = getLang() === "en";
  const isClub = context.browseType === "club";
  const sourceClub = isClub ? world.clubs.find((item) => item.id === context.browseId) : null;
  const sourceName = isClub
    ? clubDisplayName(sourceClub)
    : nationName(context.browseId, getLang());
  const backText = en ? `Back to ${sourceName}` : `返回${sourceName}名单`;
  return `<nav class="player-browse-nav" aria-label="${escapeHtml(en ? "Squad player navigation" : "球队球员连续浏览")}">
    <button type="button" class="btn small player-browse-back" data-player-browse-back title="${escapeHtml(backText)}">← ${escapeHtml(backText)}</button>
    <span class="player-browse-position">${context.index + 1} / ${context.total}</span>
    <span class="player-browse-controls">
      <button type="button" class="btn small" data-player-browse-step="-1" ${context.index <= 0 ? "disabled" : ""} title="${escapeHtml(en ? "Previous player (Left arrow)" : "上一位球员（←）")}">← ${escapeHtml(en ? "Previous" : "上一位")}</button>
      <button type="button" class="btn small" data-player-browse-step="1" ${context.index >= context.total - 1 ? "disabled" : ""} title="${escapeHtml(en ? "Next player (Right arrow)" : "下一位球员（→）")}">${escapeHtml(en ? "Next" : "下一位")} →</button>
    </span>
  </nav>`;
}

function navigatePlayerBrowse(delta) {
  const current = activePlayerBrowseContext;
  if (!current) return;
  const items = playerBrowseItems(current);
  const currentIndex = items.findIndex((item) => item.player.id === current.playerId);
  if (currentIndex < 0) return;
  const target = items[currentIndex + delta];
  if (!target) return;
  showPlayerModal(target.player.id, target.context);
}

function restorePlayerBrowseParent(context) {
  if (!context) return false;
  activePlayerBrowseContext = null;
  if (context.browseType === "club") {
    showClubModal(context.browseId);
  } else if (context.browseType === "nation") {
    showNationModal(context.browseId, context.competitionId || null);
  } else {
    return false;
  }
  requestAnimationFrame(() => {
    const card = $("#modal-card");
    if (card) card.scrollTop = Number(context.returnModalScrollTop || 0);
    const firstTableWrap = $("#modal-body")?.querySelector(".table-wrap");
    if (firstTableWrap) firstTableWrap.scrollTop = Number(context.returnScrollTop || 0);
  });
  return true;
}

function bindPlayerBrowseControls() {
  const body = $("#modal-body");
  body?.querySelector("[data-player-browse-back]")?.addEventListener("click", () => {
    restorePlayerBrowseParent(activePlayerBrowseContext);
  });
  body?.querySelectorAll("[data-player-browse-step]").forEach((button) => {
    button.addEventListener("click", () => navigatePlayerBrowse(Number(button.dataset.playerBrowseStep || 0)));
  });
}

function renderPlayerHabitsPanel(player, options = {}) {
  const en = getLang() === "en";
  const snapshot = options.snapshot || null;
  const habitIds = options.isOther
    ? Array.isArray(snapshot?.habitIds)
      ? snapshot.habitIds
      : []
    : Array.isArray(player?.playingHabits)
      ? player.playingHabits
      : [];
  const knownHtml = habitIds.length
    ? `<div class="player-habit-grid">${habitIds
        .map(
          (habitId) => `<div class="player-habit-item">
            <strong>${escapeHtml(habitLabel(habitId, en ? "en" : "zh"))}</strong>
            <span class="muted">${escapeHtml(habitDescription(habitId, en ? "en" : "zh"))}</span>
          </div>`
        )
        .join("")}</div>`
    : `<p class="muted" style="margin:0">${escapeHtml(
        options.isOther
          ? en
            ? "No playing habit has been confirmed by your scouting knowledge."
            : "现有球探知识尚未确认这名球员的个人习惯。"
          : en
            ? "No established playing habit."
            : "暂无已形成的个人踢球习惯。"
      )}</p>`;
  const scoutingNote = options.isOther && !snapshot?.habitsExact
    ? `<p class="hint" style="margin:0.35rem 0 0">${escapeHtml(
        en
          ? "Further observation may reveal additional habits; old reports do not update automatically."
          : "继续观察可能确认更多习惯；旧球探报告不会自动刷新。"
      )}</p>`
    : "";
  if (!options.canManage) {
    return `<section class="player-habits-panel">
      <h3>${escapeHtml(en ? "Playing habits" : "个人踢球习惯")}</h3>
      ${knownHtml}${scoutingNote}
    </section>`;
  }

  const training = player.habitTraining;
  const availability = availableHabitTraining(player);
  const learnOptions = availability.learn
    .map(
      (definition) => `<option value="learn:${escapeHtml(definition.id)}">${escapeHtml(
        en ? `Learn · ${definition.labelEn}` : `培养 · ${definition.label}`
      )}</option>`
    )
    .join("");
  const unlearnOptions = availability.unlearn
    .map(
      (definition) => `<option value="unlearn:${escapeHtml(definition.id)}">${escapeHtml(
        en ? `Unlearn · ${definition.labelEn}` : `纠正 · ${definition.label}`
      )}</option>`
    )
    .join("");
  const trainingHtml = training
    ? `<div class="player-habit-training">
        <div class="row-between" style="gap:0.5rem;flex-wrap:wrap">
          <span><strong>${escapeHtml(
            training.mode === "unlearn"
              ? en ? "Unlearning" : "正在纠正"
              : en ? "Learning" : "正在培养"
          )}：</strong>${escapeHtml(habitLabel(training.habitId, en ? "en" : "zh"))}</span>
          <span>${Math.round(training.progress || 0)}%</span>
        </div>
        <div class="bar"><i style="width:${Math.max(2, Math.round(training.progress || 0))}%"></i></div>
        <button type="button" class="btn small" data-habit-cancel ${options.delegated ? "disabled" : ""}>${escapeHtml(
          en ? "Cancel programme" : "取消训练"
        )}</button>
      </div>`
    : `<div class="playing-time-role-controls">
        <select data-habit-program aria-label="${escapeHtml(en ? "Personal habit programme" : "个人习惯训练")}" ${options.delegated ? "disabled" : ""}>
          ${learnOptions ? `<optgroup label="${escapeHtml(en ? "Learn" : "培养新习惯")}">${learnOptions}</optgroup>` : ""}
          ${unlearnOptions ? `<optgroup label="${escapeHtml(en ? "Unlearn" : "纠正现有习惯")}">${unlearnOptions}</optgroup>` : ""}
        </select>
        <button type="button" class="btn small primary" data-habit-start ${options.delegated || (!learnOptions && !unlearnOptions) ? "disabled" : ""}>${escapeHtml(
          en ? "Start programme" : "开始训练"
        )}</button>
      </div>`;
  const delegatedNote = options.delegated
    ? `<p class="hint" style="margin:0.35rem 0 0">${escapeHtml(
        en
          ? "Player development is delegated to the coaching staff."
          : "年轻球员培养已委托给教练团队，玩家不能直接改写个人计划。"
      )}</p>`
    : `<p class="hint" style="margin:0.35rem 0 0">${escapeHtml(
        en
          ? "Progress is settled weekly from the same coach, workload, age and decision-making facts used by training."
          : "进度每周结算，读取现有教练能力、训练强度、年龄和决策属性；习惯不提高属性。"
      )}</p>`;
  return `<section class="player-habits-panel">
    <h3>${escapeHtml(en ? "Playing habits" : "个人踢球习惯")}</h3>
    ${knownHtml}
    <div class="player-habit-programme">
      <strong>${escapeHtml(en ? "Individual programme" : "个人习惯训练")}</strong>
      ${trainingHtml}${delegatedNote}
    </div>
  </section>`;
}

function bindPlayerHabitActions(player, browseContext = null) {
  const body = $("#modal-body");
  if (!body || !player) return;
  body.querySelector("[data-habit-start]")?.addEventListener("click", () => {
    const value = body.querySelector("[data-habit-program]")?.value || "";
    const separator = value.indexOf(":");
    const mode = separator >= 0 ? value.slice(0, separator) : "learn";
    const habitId = separator >= 0 ? value.slice(separator + 1) : value;
    const result = startHabitTraining(player, habitId, mode, {
      season: world.season,
      day: world.day,
    });
    toast(getLang() === "en" ? result.msgEn : result.msg);
    if (!result.ok) return;
    saveGame(world);
    showPlayerModal(player.id, browseContext || {});
    refreshAll();
  });
  body.querySelector("[data-habit-cancel]")?.addEventListener("click", () => {
    const result = cancelHabitTraining(player);
    toast(getLang() === "en" ? result.msgEn : result.msg);
    if (!result.ok) return;
    saveGame(world);
    showPlayerModal(player.id, browseContext || {});
    refreshAll();
  });
}

function renderPlayerTalkPanel(player) {
  if (!player || world?.sacked) return "";
  ensurePlayerRelation(player);
  const en = getLang() === "en";
  const club = world.clubs?.find((item) => item.id === world.userClubId);
  const playingTime = ensurePlayerPathway(player, club, world);
  const progress = playingTimeProgress(world, club, player);
  const matchSharpness = developmentSharpness(world, player);
  const targetPct = Math.round(progress.target * 100);
  const actualPct = Math.round(progress.minutesShare * 100);
  const promise = playingTime.promise;
  const roleCooling = Number(playingTime.nextChangeDay || 0) > Number(world.day || 0);
  const roleOptions = Object.values(PLAYING_TIME_ROLES)
    .map((role) => `<option value="${role.key}"${role.key === playingTime.role ? " selected" : ""}>${escapeHtml(en ? role.labelEn : role.label)} · ${Math.round(role.minutesShare * 100)}%</option>`)
    .join("");
  const cd = player.talkCooldown || 0;
  const cooling = cd > (world.day || 0);
  return `<div class="player-talk-panel">
    <h3 style="margin:0.85rem 0 0.35rem;font-size:var(--fs-md)">${en ? "Manager talk" : "主帅约谈"}</h3>
    <p class="muted" style="margin:0 0 0.4rem">${en ? "Relation: " : "关系："}
      <strong class="rel-${relationTone(player.relation)}">${escapeHtml(relationLabel(player.relation, en ? "en" : "zh"))}</strong>
      ${cooling ? ` · ${en ? "Cooldown until D" : "冷却至第"}${cd}${en ? "" : " 天"}` : ""}
    </p>
    <div class="playing-time-role-card">
      <div class="playing-time-role-head">
        <strong>${en ? "Playing-time status" : "出场定位承诺"}</strong>
        <span class="badge ${progress.fulfilment >= 0.9 ? "DEF" : progress.fulfilment >= 0.7 ? "MID" : "ATT"}">${actualPct}% / ${targetPct}%</span>
      </div>
      <p class="muted">${escapeHtml(playingTimeRoleLabel(playingTime.role, en ? "en" : "zh"))} · ${progress.availableMatches} ${en ? "available matches" : "场可用比赛"} · ${progress.appearances} ${en ? "apps" : "次出场"} · ${progress.starts} ${en ? "starts" : "次首发"} · ${progress.minutes} ${en ? "minutes" : "分钟"} · ${en ? "match sharpness" : "比赛锐度"} ${matchSharpness}/100${promise?.dueDay ? ` · ${en ? "review D" : "复核 D"}${promise.dueDay}` : ` · ${en ? "inferred, not promised" : "当前为阵容推定，尚未正式承诺"}`}</p>
      <div class="playing-time-role-controls">
        <select data-playing-time-role aria-label="${escapeHtml(en ? "Playing-time role" : "出场定位")}">${roleOptions}</select>
        <button type="button" class="btn small" data-playing-time-save ${roleCooling ? "disabled" : ""}>${en ? "Agree role" : "确认承诺"}</button>
      </div>
      ${player.wantsTransfer ? `<p class="stat-low">${en ? "Repeated broken promises have made the player consider leaving." : "连续违约已使球员考虑离队。"}</p>` : ""}
    </div>
    <div class="player-talk-actions">
      <button type="button" class="btn small primary" data-talk="praise" ${cooling ? "disabled" : ""}>${en ? "Praise" : "表扬"}</button>
      <button type="button" class="btn small" data-talk="listen" ${cooling ? "disabled" : ""}>${en ? "Listen" : "倾听"}</button>
      <button type="button" class="btn small" data-talk="contract" ${cooling ? "disabled" : ""}>${en ? "Contract" : "谈续约"}</button>
      <button type="button" class="btn small" data-talk="criticize" ${cooling ? "disabled" : ""}>${en ? "Criticize" : "批评"}</button>
    </div>
  </div>`;
}

function renderPlayerDevelopmentPanel(player) {
  const en = getLang() === "en";
  const entries = playerDevelopmentTimeline(player, 10);
  const developmentStats = ensureDevelopmentStats(player);
  const latestArchive = player.developmentHistory?.[0] || null;
  const developmentSummary = `<div class="player-development-summary muted">${en ? "Development football" : "发展队比赛"} · ${developmentStats.apps} ${en ? "apps" : "场"} · ${developmentStats.minutes} ${en ? "minutes" : "分钟"} · ${developmentStats.goals} ${en ? "goals" : "球"} · ${developmentStats.assists} ${en ? "assists" : "助攻"}${latestArchive ? ` · ${en ? "last season" : "上季"} ${latestArchive.apps} ${en ? "apps" : "场"} / ${latestArchive.minutes} ${en ? "min" : "分钟"}` : ""}</div>`;
  if (!entries.length) {
    return `<div class="player-development-empty">${developmentSummary}<p class="muted">${en ? "No recorded attribute changes yet. Weekly training and season transitions will add explainable entries." : "暂无属性变化记录；每周训练和赛季转换后会记录具体变化与原因。"}</p></div>`;
  }
  return `<div class="player-development-log">${developmentSummary}${entries.map((entry) => {
    const date = entry.season != null
      ? `S${entry.season}${entry.day != null ? ` · D${entry.day}` : ""}`
      : entry.day != null ? `D${entry.day}` : "—";
    const changes = (entry.changes || []).map((change) => {
      const sign = change.delta > 0 ? "+" : "";
      return `<span class="development-change ${change.delta > 0 ? "positive" : "negative"}">${escapeHtml(developmentAttrLabel(change.attribute, en ? "en" : "zh"))} ${change.before}→${change.after} (${sign}${change.delta})</span>`;
    }).join(" ");
    const overall = entry.ovrBefore != null && entry.ovrAfter != null && entry.ovrBefore !== entry.ovrAfter
      ? `<span class="development-overall">OVR ${entry.ovrBefore}→${entry.ovrAfter}</span>`
      : "";
    return `<div class="player-development-entry">
      <div class="player-development-entry-head"><strong>${escapeHtml(en ? entry.reasonEn : entry.reason)}</strong><span>${escapeHtml(date)}</span></div>
      <div>${changes || `<span class="badge MID">${escapeHtml(en ? "Milestone" : "生涯节点")}</span>`} ${overall}</div>
    </div>`;
  }).join("")}</div>`;
}

function relationTone(rel) {
  const r = Math.round(rel ?? 0);
  if (r >= 1) return "good";
  if (r <= -1) return "bad";
  return "neutral";
}

function bindPlayerTalkActions(player, fromOther, browseContext = null) {
  if (fromOther || !player) return;
  document.querySelectorAll("[data-talk]").forEach((btn) => {
    btn.onclick = () => {
      const res = applyPlayerTalk(world, player.id, btn.dataset.talk);
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        showPlayerModal(player.id, browseContext || {});
        refreshAll();
      }
    };
  });
  document.querySelector("[data-playing-time-save]")?.addEventListener("click", () => {
    const club = world.clubs?.find((item) => item.id === world.userClubId);
    const role = document.querySelector("[data-playing-time-role]")?.value;
    const res = setPlayingTimeRole(world, club, player, role, { source: "manager-profile" });
    toast(res.msg);
    if (res.ok) {
      saveGame(world);
      showPlayerModal(player.id, browseContext || {});
      refreshAll();
    }
  });
}

/**
 * 本队球员：续约 / 解约 / 外租；他人：租入（窗内）
 */
function renderPlayerContractActions(player, fromOther) {
  if (!player || world?.sacked) return "";
  const en = getLang() === "en";
  const open = isTransferWindowOpen(world);
  const activeTalk = findActiveDealNegotiation(world, player.id) ||
    findActiveTransferNegotiation(world, player.id);

  // 租借中的本队租入
  if (!fromOther && player.loan) {
    const until =
      player.loan.untilDay >= 9999
        ? en
          ? "end of season"
          : "赛季末"
        : `D${player.loan.untilDay}`;
    return `<div class="contract-actions hint">
      ${en ? "On loan until" : "租借至"} ${escapeHtml(until)} · ${en ? "Cannot sell / terminate" : "不可出售或解约"}
    </div>`;
  }

  // 本队正式球员
  if (!fromOther) {
    return `<div class="contract-actions">
      <button type="button" class="btn small primary" data-act-renew="${player.id}" ${activeTalk ? "disabled" : ""}>${escapeHtml(activeTalk ? (en ? "In talks" : "谈判中") : t("contract.renew") || (en ? "Renew" : "续约"))}</button>
      <button type="button" class="btn small danger" data-act-terminate="${player.id}" ${activeTalk ? "disabled" : ""}>${escapeHtml(t("contract.terminate") || (en ? "Release" : "解约"))}</button>
      <button type="button" class="btn small" data-act-loan-out="${player.id}" ${!open || activeTalk ? "disabled" : ""}>${escapeHtml(t("contract.loanOut") || (en ? "Loan out" : "外租"))}${!open ? (en ? " (window closed)" : "（窗关）") : ""}</button>
    </div>`;
  }

  // 他队：可租入
  if (fromOther && !player.loan) {
    return `<div class="contract-actions">
      <button type="button" class="btn small" data-act-loan-in="${player.id}" data-from="${fromOther.id}" ${!open || activeTalk ? "disabled" : ""}>${escapeHtml(activeTalk ? (en ? "In talks" : "谈判中") : t("contract.loanInBtn") || (en ? "Loan in" : "租入"))}${!open ? (en ? " (window closed)" : "（窗关）") : ""}</button>
    </div>`;
  }
  return "";
}

function bindPlayerContractActions(player, fromOther) {
  const body = $("#modal-body");
  if (!body) return;
  body.querySelector("[data-act-renew]")?.addEventListener("click", () => {
    closeModal();
    doRenewPlayer(player.id);
  });
  body.querySelector("[data-act-terminate]")?.addEventListener("click", () => {
    closeModal();
    doTerminatePlayer(player.id);
  });
  body.querySelector("[data-act-loan-out]")?.addEventListener("click", () => {
    closeModal();
    doLoanOut(player.id);
  });
  body.querySelector("[data-act-loan-in]")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    closeModal();
    doLoanIn(btn.dataset.actLoanIn, btn.dataset.from);
  });
}

function doRenewPlayer(playerId) {
  const prev = previewRenew(world, playerId);
  if (!prev) {
    toast(getLang() === "en" ? "Player not found" : "找不到球员");
    return;
  }
  const yearsIn = prompt(
    getLang() === "en"
      ? `${prev.player.name}\nSuggested: ${prev.offer.years}y · wage ${formatMoney(prev.offer.newWage)} · bonus ${formatMoney(prev.offer.fee)}\nYears (1–5):`
      : `${prev.player.name}\n建议：${prev.offer.years} 年 · 周薪 ${formatMoney(prev.offer.newWage)} · 签约奖 ${formatMoney(prev.offer.fee)}\n合同年限（1–5）：`,
    String(prev.offer.years)
  );
  if (yearsIn == null) return;
  const years = Math.max(1, Math.min(5, parseInt(yearsIn, 10) || prev.offer.years));
  const final = previewRenew(world, playerId, years);
  const contractYears = final.offer.years;
  const wageIn = prompt(
    getLang() === "en"
      ? `Weekly-wage offer (reference ${formatMoney(final.offer.newWage)}):`
      : `请输入周薪报价（参考 ${formatMoney(final.offer.newWage)}）：`,
    String(final.offer.newWage)
  );
  if (wageIn == null) return;
  const wage = parseMoneyInput(wageIn);
  const bonus = Math.round(wage * 4 * contractYears * 0.15);
  if (
    !confirm(
      getLang() === "en"
        ? `Submit a renewal offer to ${final.player.name}?\n${contractYears} years · wage ${formatMoney(wage)} · bonus ${formatMoney(bonus)}\nThe player will reply in 1–2 days.`
        : `向 ${final.player.name} 提交续约报价？\n${contractYears} 年 · 周薪 ${formatMoney(wage)} · 签约奖 ${formatMoney(bonus)}\n球员将在 1–2 天内答复。`
    )
  ) {
    return;
  }
  const res = renewUserPlayer(world, playerId, { years: contractYears, wage });
  toast(getLang() === "en" ? (res.ok ? "Renewal offer submitted" : res.msg) : res.msg);
  if (res.ok) {
    saveGame(world);
    refreshAll();
  }
}

function doTerminatePlayer(playerId) {
  const prev = previewTerminate(world, playerId);
  if (!prev) {
    toast(getLang() === "en" ? "Player not found" : "找不到球员");
    return;
  }
  if (
    !confirm(
      getLang() === "en"
        ? `Release ${prev.player.name}?\nCompensation ${formatMoney(prev.cost)} — becomes free agent.`
        : `确认与 ${prev.player.name} 解约？\n补偿 ${formatMoney(prev.cost)}，球员将成为自由身。`
    )
  ) {
    return;
  }
  const res = terminateUserPlayer(world, playerId);
  toast(getLang() === "en" ? (res.ok ? `${prev.player.name} released` : "Player release failed") : res.msg);
  if (res.ok) {
    saveGame(world);
    refreshAll();
  }
}

function doLoanOut(playerId) {
  const en = getLang() === "en";
  const termIn = prompt(
    en
      ? "Loan term: half (to next window) or season (end of season). Type half / season:"
      : "租借期限：half=到下一窗末 · season=赛季末。输入 half 或 season：",
    "half"
  );
  if (termIn == null) return;
  const term = String(termIn).toLowerCase().startsWith("s") ? "season" : "half";
  const prev = previewLoanOut(world, playerId, term);
  if (!prev) {
    toast(en ? "Cannot loan this player" : "无法外租该球员");
    return;
  }
  const feeIn = prompt(en ? "Requested loan fee:" : "请输入期望租借费：", String(prev.fee));
  if (feeIn == null) return;
  const fee = parseMoneyInput(feeIn);
  const shareIn = prompt(en ? "Minimum wage share paid by host (50–100):" : "期望对方承担周薪比例（50–100）：", String(Math.round(prev.wageShare * 100)));
  if (shareIn == null) return;
  const wageShare = Math.max(0.5, Math.min(1, (parseInt(shareIn, 10) || 75) / 100));
  if (
    !confirm(
      en
        ? `List ${prev.player.name} for loan?\nRequested fee ${formatMoney(fee)} · host pays ${Math.round(wageShare * 100)}% wages · until ${prev.untilDay >= 9999 ? "EOS" : "D" + prev.untilDay}`
        : `将 ${prev.player.name} 放入租借市场？\n期望租借费 ${formatMoney(fee)} · 对方承担 ${Math.round(wageShare * 100)}% 薪水 · 至 ${prev.untilDay >= 9999 ? "赛季末" : "D" + prev.untilDay}`
    )
  ) {
    return;
  }
  const res = loanOutPlayer(world, playerId, { term, fee, wageShare });
  toast(en ? (res.ok ? "Player listed for loan" : res.msg) : res.msg);
  if (res.ok) {
    saveGame(world);
    refreshAll();
  }
}

function doLoanIn(playerId, fromClubId) {
  const en = getLang() === "en";
  const termIn = prompt(
    en
      ? "Loan term: half / season:"
      : "租借期限：half 或 season：",
    "half"
  );
  if (termIn == null) return;
  const term = String(termIn).toLowerCase().startsWith("s") ? "season" : "half";
  const prev = previewLoanIn(world, playerId, fromClubId, term);
  if (!prev) {
    toast(en ? "Cannot loan this player" : "无法租入该球员");
    return;
  }
  const feeIn = prompt(en ? "Loan-fee offer:" : "请输入租借费报价：", String(prev.fee));
  if (feeIn == null) return;
  const fee = parseMoneyInput(feeIn);
  const shareIn = prompt(en ? "Wage share paid by your club (50–100):" : "我方承担周薪比例（50–100）：", String(Math.round(prev.wageShare * 100)));
  if (shareIn == null) return;
  const wageShare = Math.max(0.5, Math.min(1, (parseInt(shareIn, 10) || 80) / 100));
  if (
    !confirm(
      en
        ? `Submit a loan bid for ${prev.player.name} from ${prev.from?.short || ""}?\nFee ${formatMoney(fee)} · you pay ${Math.round(wageShare * 100)}% wages`
        : `提交租入 ${prev.player.name}（${prev.from?.short || ""}）的报价？\n租借费 ${formatMoney(fee)} · 我方承担 ${Math.round(wageShare * 100)}% 薪水`
    )
  ) {
    return;
  }
  const res = loanInPlayer(world, playerId, fromClubId, { term, fee, wageShare });
  toast(en ? (res.ok ? "Loan offer submitted" : res.msg) : res.msg);
  if (res.ok) {
    saveGame(world);
    refreshAll();
  }
}

function doRecallLoan(playerId) {
  if (
    !confirm(
      getLang() === "en"
        ? "Recall this player? (fee if window closed)"
        : "确认召回该球员？（转会窗外需支付召回费）"
    )
  ) {
    return;
  }
  const res = recallLoan(world, playerId);
  toast(getLang() === "en" ? (res.ok ? "Player recalled" : "Recall failed") : res.msg);
  if (res.ok) {
    saveGame(world);
    refreshAll();
  }
}

/** 设施页渲染委托给 js/ui/facilities.js */
function renderFacilities() {
  if (!world) return;
  const club = getUserClub(world);
  if (!club) return;
  renderFacilitiesView(world, club, getLang() === "en", t);
}

function renderYouth() {
  const club = getUserClub(world);
  const en = getLang() === "en";
  ensureFacilities(club);
  const ya = ensureYouthAcademy(club);
  // 与设施同步
  if (club.facilities?.youth && club.facilities.youth !== ya.level) {
    ya.level = Math.max(ya.level, club.facilities.youth);
  }
  const cfg = YOUTH_LEVELS[ya.level] || YOUTH_LEVELS[1];
  const nextLv = ya.level + 1;
  const nextCost = YOUTH_UPGRADE_COST[nextLv];
  const daysLeft = Math.max(0, 30 - (ya.daysSinceIntake || 0));
  const building = isBuilding(club, "youth");
  const proj = getProject(club, "youth");

  $("#youth-info").innerHTML = `
    <div><strong>Lv.${ya.level}</strong> ${en ? "Youth academy" : cfg.name}</div>
    <div class="muted">${en ? `Capacity ${ya.players.length}/${cfg.capacity} · Intake ${cfg.intake}` : `容量 ${ya.players.length}/${cfg.capacity} · 每期招生 ${cfg.intake} 人`}</div>
    <div class="muted">${en ? `Weekly upkeep ${formatMoney(cfg.upkeep)} · Next intake in ~${daysLeft} days` : `周维护费 ${formatMoney(cfg.upkeep)} · 下次招生约 ${daysLeft} 天`}</div>
    ${
      building
        ? `<div class="muted">🚧 ${en ? `Upgrade in progress · completes around Day ${proj.finishDay}` : `升级施工中 · 约第 ${proj.finishDay} 天完工`}</div>`
        : ""
    }
  `;

  const upBtn = $("#btn-youth-upgrade");
  if (ya.level >= 5) {
    upBtn.disabled = true;
    upBtn.textContent = en ? "Max level" : "已满级";
    $("#youth-hint").textContent = en ? "The academy is fully upgraded. Stadium and training upgrades are available on Facilities." : "学院已是世界级，专心培养好苗子吧。也可在「设施」页查看球场与训练。";
  } else if (building) {
    upBtn.disabled = true;
    const left = Math.max(0, proj.finishDay - world.day);
    upBtn.textContent = en ? `Building (${left}d)` : `施工中（${left} 天）`;
    $("#youth-hint").textContent = en ? `Upgrading to Lv.${proj.to}; activates automatically when complete.` : `正在升级至 Lv.${proj.to} ${proj.name}，完工后自动生效。`;
  } else {
    upBtn.disabled = false;
    upBtn.textContent = en ? `Upgrade to Lv.${nextLv} (${formatMoney(nextCost)} · build time)` : `升级至 Lv.${nextLv}（${formatMoney(nextCost)} · 有工期）`;
    $("#youth-hint").textContent = en ? `Next: capacity ${YOUTH_LEVELS[nextLv].capacity}, faster growth. Manage all facilities on the Facilities tab.` : `下级：${YOUTH_LEVELS[nextLv].name} · 容量 ${YOUTH_LEVELS[nextLv].capacity} · 成长更快（「设施」页可一并管理球场/训练）`;
  }

  $("#youth-count").textContent = t("youth.count", { n: ya.players.length });
  const sorted = [...ya.players].sort(
    (a, b) => (b.potential || 0) - (a.potential || 0) || b.ovr - a.ovr
  );
  const tbody = $("#youth-table tbody");
  ensureKit(club);
  assignSquadNumbers(club);
  tbody.innerHTML = sorted.length
    ? sorted
        .map((p) => {
          const pot = p.potential ?? p.ovr;
          const potClass = pot >= 16 ? "stat-high" : pot >= 13 ? "stat-mid" : "stat-low";
          const num = p.number != null ? p.number : "—";
          return `<tr>
            <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(club)}">${num}</span></td>
            <td class="name-with-avatar">${playerAvatarHtml(p, club, 32)} <span>${playerLinkHtml(p.id, p.name)}</span></td>
            <td>${nationLabel(p)}</td>
            <td><span class="badge ${p.pos}">${en ? p.pos : POS_LABEL[p.pos]}</span></td>
            <td>${p.age}</td>
            <td class="${ovrClass(p.ovr)}"><strong>${p.ovr}</strong></td>
            <td class="${potClass}"><strong>${pot}</strong></td>
            <td>${formatMoney(p.wage)}</td>
            <td>
              <button class="btn small" data-player-link="${p.id}">${en ? "Info" : "详情"}</button>
              <button class="btn small primary" data-promote="${p.id}">${en ? "Promote" : "提拔"}</button>
              <button class="btn small danger" data-release="${p.id}">${en ? "Release" : "解约"}</button>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="9" class="muted">${en ? "No academy players; advance the calendar for the next intake" : "暂无青训球员，推进日程等待招生"}</td></tr>`;

  tbody.querySelectorAll("[data-promote]").forEach((btn) => {
    btn.onclick = () => {
      const res = promoteYouth(world, world.userClubId, btn.dataset.promote);
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });
  tbody.querySelectorAll("[data-release]").forEach((btn) => {
    btn.onclick = () => {
      if (!confirm(en ? "Release this academy player?" : "确认与该青训球员解约？")) return;
      const res = releaseYouth(world, world.userClubId, btn.dataset.release);
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });
}

function tacValText(key, n) {
  const lab = tacticsSliderLabel(key, n, getLang());
  return `${n} · ${lab}`;
}

function renderTacPresets() {
  const box = $("#tac-presets");
  if (!box) return;
  const order = ["balanced", "solid", "high_press", "tiki", "park_counter", "all_out"];
  box.innerHTML = order
    .map((id) => {
      if (!TACTIC_PRESETS[id]) return "";
      return `<button type="button" class="btn small tac-preset-btn" data-tac-preset="${id}">${escapeHtml(
        t(`tac.preset.${id}`)
      )}</button>`;
    })
    .join("");
}

const SET_PIECE_UI = Object.freeze([
  { type: "penalty", labelKey: "tac.penaltyTaker" },
  { type: "directFreeKick", labelKey: "tac.freeKickTaker" },
  { type: "corner", labelKey: "tac.cornerTaker" },
]);

function responsibilityOptionLabel(player, kind, en) {
  if (!player) return "—";
  const a = player.attrs || {};
  const num = player.number != null ? `#${player.number} ` : "";
  const base = `${num}${playerDisplaySurname(player.name, player.nationality)} · ${positionLabel(player.pos)}`;
  if (kind === "captain") {
    return `${base} · ${en ? "DEC" : "决"} ${a.decisions || 10}`;
  }
  if (kind === "penalty") {
    return `${base} · ${en ? "FIN" : "终"} ${a.finishing || 10} · ${en ? "DEC" : "决"} ${a.decisions || 10}`;
  }
  if (kind === "corner") {
    return `${base} · ${en ? "CRS" : "传中"} ${a.crossing || 10} · ${en ? "PAS" : "传"} ${a.passing || 10}`;
  }
  return `${base} · ${en ? "KCK" : "脚法"} ${a.kicking || 10} · ${en ? "SHT" : "射"} ${a.shooting || 10}`;
}

function renderTacticsResponsibilities(club, { coachControlled = false } = {}) {
  const host = $("#tac-responsibilities");
  if (!host) return;
  ensureLineupResponsibilities(club);
  const en = getLang() === "en";
  const xi = getLineupPlayers(club);
  const outfield = xi.filter((p) => p.pos !== "GK");
  const optionHtml = (players, selected, kind) =>
    players
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}"${p.id === selected ? " selected" : ""}>${escapeHtml(
            responsibilityOptionLabel(p, kind, en)
          )}</option>`
      )
      .join("");
  const captainId = getCaptainId(club);
  const rows = [
    `<label class="tac-responsibility-row">
      <span>${escapeHtml(t("tac.captain"))}</span>
      <select data-tac-captain ${coachControlled ? "disabled" : ""}>
        ${optionHtml(xi, captainId, "captain")}
      </select>
    </label>`,
    ...SET_PIECE_UI.map((item) => {
      const id = getSetPieceTakerId(club, item.type);
      return `<label class="tac-responsibility-row">
        <span>${escapeHtml(t(item.labelKey))}</span>
        <select data-tac-setpiece="${escapeHtml(item.type)}" ${coachControlled ? "disabled" : ""}>
          ${optionHtml(outfield, id, item.type)}
        </select>
      </label>`;
    }),
  ];
  host.innerHTML = rows.join("");
  if (coachControlled) return;
  host.querySelector("[data-tac-captain]")?.addEventListener("change", (e) => {
    const res = setCaptainId(club, e.target.value);
    if (!res.ok) {
      toast(res.msg || t("tac.responsibilityFail"));
      renderTactics();
      return;
    }
    saveGame(world);
    renderTactics();
    const p = club.players.find((x) => x.id === res.captainId);
    toast(t("tac.captainSet", { name: p?.name || "" }));
  });
  host.querySelectorAll("[data-tac-setpiece]").forEach((select) => {
    select.addEventListener("change", (e) => {
      const type = e.target.getAttribute("data-tac-setpiece");
      const res = setSetPieceTakerId(club, type, e.target.value);
      if (!res.ok) {
        toast(res.msg || t("tac.responsibilityFail"));
        renderTactics();
        return;
      }
      saveGame(world);
      renderTactics();
      const p = club.players.find((x) => x.id === res.playerId);
      toast(t("tac.setPieceSet", { name: p?.name || "" }));
    });
  });
}

function renderTacticsSummary() {
  const el = $("#tac-summary");
  if (!el || !world) return;
  const club = getUserClub(world);
  ensureTactics(club);
  const tac = club.tactics;
  const en = getLang() === "en";
  const form = FORMATIONS[tac.formation] || FORMATIONS["4-3-3"];
  const fmod = FORMATION_MOD[tac.formation] || FORMATION_MOD["4-3-3"];
  const smod = STYLE_MOD[tac.style] || STYLE_MOD.balanced;
  const atkBias = ((fmod.atk || 1) * (smod.atk || 1) - 1) * 100;
  const defBias = ((fmod.def || 1) * (smod.def || 1) - 1) * 100;
  const fitCost =
    (smod.fitness || 1) *
    (1 + Math.max(0, (tac.pressing || 3) - 3) * 0.08) *
    (1 + Math.max(0, (tac.defensiveLine || 3) - 3) * 0.04);
  const foulRisk =
    (smod.foulRisk || 1) *
    (1 + Math.max(0, (tac.pressing || 3) - 3) * 0.12);
  const bits = [];
  bits.push(
    en
      ? `<strong>${form.name}</strong>${form.desc ? ` · ${form.desc}` : ""}`
      : `<strong>${form.name}</strong>${form.desc ? ` · ${form.desc}` : ""}`
  );
  const shapes = teamShapeSummary(tac, en ? "en" : "zh");
  bits.push(`
    <div class="tac-shape-grid">
      ${shapes
        .map(
          (shape) => `<div class="tac-shape-fact" data-shape-phase="${escapeHtml(shape.key)}">
            <strong>${escapeHtml(shape.title)}</strong>
            <span>${escapeHtml(shape.detail)}</span>
          </div>`
        )
        .join("")}
    </div>
  `);
  bits.push(
    en
      ? `Attack bias ${atkBias >= 0 ? "+" : ""}${atkBias.toFixed(0)}% · Defend ${defBias >= 0 ? "+" : ""}${defBias.toFixed(0)}%`
      : `进攻倾向 ${atkBias >= 0 ? "+" : ""}${atkBias.toFixed(0)}% · 防守 ${defBias >= 0 ? "+" : ""}${defBias.toFixed(0)}%`
  );
  bits.push(
    en
      ? `Possession weight ×${(smod.possession || 1).toFixed(2)} · Fitness cost ×${fitCost.toFixed(2)} · Foul risk ×${foulRisk.toFixed(2)}`
      : `控球权重 ×${(smod.possession || 1).toFixed(2)} · 体能消耗 ×${fitCost.toFixed(2)} · 犯规风险 ×${foulRisk.toFixed(2)}`
  );
  if (tac.style === "counter") {
    bits.push(en ? "Counters attack & possession styles well." : "克制：擅长打进攻型 / 控球型。");
  } else if (tac.style === "attack") {
    bits.push(en ? "Vulnerable to deep counters." : "注意：容易被低位反击针对。");
  } else if (tac.style === "possession") {
    bits.push(en ? "Holds ball; less effective vs high press counters." : "控球主导；对高压反击略吃亏。");
  } else if (tac.style === "defend") {
    bits.push(en ? "Solid block; fewer chances created." : "防守稳固，创造机会偏少。");
  }
  // 角色指令摘要
  ensureLineupRoles(club);
  const roles = tac.roles || [];
  if (roles.length) {
    const counts = {};
    for (const rid of roles) {
      const lab = roleShort(rid, en ? "en" : "zh");
      counts[lab] = (counts[lab] || 0) + 1;
    }
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, n]) => (n > 1 ? `${k}×${n}` : k))
      .join(" · ");
    const rm = teamRoleMods(club);
    bits.push(
      en
        ? `Roles: ${top} · team bias ATK×${rm.atk.toFixed(2)} DEF×${rm.def.toFixed(2)}`
        : `角色：${top} · 整体 攻×${rm.atk.toFixed(2)} 防×${rm.def.toFixed(2)}`
    );
  }
  el.innerHTML = bits.map((b) => `<div>${b}</div>`).join("");
}

/** 战术板拖拽 / 点选状态 */
const tacPick = {
  mode: null, // 'slot' | 'bench'
  slot: null,
  playerId: null,
  dragging: false,
};
let tacRoleSlot = 0;

function clearTacPick() {
  tacPick.mode = null;
  tacPick.slot = null;
  tacPick.playerId = null;
  document.querySelectorAll(".tac-slot.selected, .tac-bench-chip.selected").forEach((el) => {
    el.classList.remove("selected");
  });
  const hint = $("#tac-pick-hint");
  if (hint) hint.textContent = t("tac.dragHint");
}

function applyTacPickHighlight() {
  document.querySelectorAll(".tac-slot.selected, .tac-bench-chip.selected").forEach((el) => {
    el.classList.remove("selected");
  });
  if (tacPick.mode === "slot" && tacPick.slot != null) {
    document
      .querySelector(`.tac-slot[data-slot="${tacPick.slot}"]`)
      ?.classList.add("selected");
  }
  if (tacPick.mode === "bench" && tacPick.playerId) {
    document.querySelectorAll(".tac-bench-chip").forEach((el) => {
      if (el.dataset.playerId === tacPick.playerId) el.classList.add("selected");
    });
  }
  const hint = $("#tac-pick-hint");
  if (!hint) return;
  if (tacPick.mode === "slot") {
    hint.textContent = t("tac.pickSlotNext");
  } else if (tacPick.mode === "bench") {
    hint.textContent = t("tac.pickBenchNext");
  } else {
    hint.textContent = t("tac.dragHint");
  }
}

function afterLineupChange(club, res) {
  if (res?.outOfPos) {
    toast(
      t("tac.outOfPos", {
        pos: positionLabel(res.playerPos),
        slot: positionLabel(res.slotPos),
      })
    );
  }
  clearTacPick();
  saveGame(world);
  renderTactics();
  renderSquad();
}

function nextMatchEligibility(club) {
  const fixture = getNextUserMatch(world);
  return {
    fixture,
    ids: fixture
      ? eligiblePlayerIds(world, club, fixture)
      : new Set((club?.players || []).map((player) => player.id)),
  };
}

function bindTacticsDragDrop() {
  const club = getUserClub(world);
  if (isFullyDelegated(world, club, "tactics")) return;
  const pitch = $("#pitch");
  const bench = $("#tac-bench");
  if (!pitch || pitch._tacBound) return;
  pitch._tacBound = true;

  // 阻止名牌链接在拖拽时打开资料
  pitch.addEventListener(
    "click",
    (e) => {
      if (tacPick.dragging) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  pitch.addEventListener("dragstart", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl || !pitch.contains(slotEl)) return;
    const pid = slotEl.dataset.playerId;
    if (!pid) {
      e.preventDefault();
      return;
    }
    tacPick.dragging = true;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ type: "slot", slot: +slotEl.dataset.slot, playerId: pid })
    );
    slotEl.classList.add("dragging");
  });

  pitch.addEventListener("dragend", (e) => {
    e.target.closest?.(".tac-slot")?.classList.remove("dragging");
    pitch.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    // 延后清 dragging，避免 dragend 后立刻触发 click 误选
    setTimeout(() => {
      tacPick.dragging = false;
    }, 30);
  });

  pitch.addEventListener("dragover", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    pitch.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    slotEl.classList.add("drag-over");
  });

  pitch.addEventListener("dragleave", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (slotEl && !slotEl.contains(e.relatedTarget)) slotEl.classList.remove("drag-over");
  });

  pitch.addEventListener("drop", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl) return;
    e.preventDefault();
    slotEl.classList.remove("drag-over");
    let payload = null;
    try {
      payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
    } catch (_) {
      return;
    }
    const club = getUserClub(world);
    ensureTactics(club);
    const toSlot = +slotEl.dataset.slot;
    if (payload.type === "slot" && payload.slot != null) {
      if (+payload.slot === toSlot) return;
      const res = swapLineupSlots(club, +payload.slot, toSlot);
      if (res.ok) afterLineupChange(club, res);
      else toast(res.msg || t("tac.swapFail"));
    } else if (payload.type === "bench" && payload.playerId) {
      const res = setLineupSlot(club, toSlot, payload.playerId);
      if (res.ok) afterLineupChange(club, res);
      else toast(res.msg || t("tac.swapFail"));
    }
    tacPick.dragging = false;
  });

  // 触屏 pointer：长按拖动换位（补强 HTML5 DnD）
  // 🔴 注意：这里**不能**在 pointerdown 时立刻 setPointerCapture。
  // 捕获会把后续 pointerup / click 的 target 强制改成 .tac-slot 本身，
  // 导致槽位内部的子按钮（⭐ 设为核心球员）永远收不到 click。
  // ⇒ 只在真正发生位移（判定为拖拽）之后才捕获。
  //
  // 📌 另一个实测事实（浏览器验证得出，勿凭直觉推翻）：
  // `.tac-slot` 带 `draggable="true"`，所以**鼠标**拖拽会启动**原生 HTML5 DnD**，
  // 浏览器随即用 `pointercancel` 终结 pointer 序列 ⇒ 鼠标下的拖拽换位实际走的是
  // 下方 `dragstart/dragover/drop` 那条路（`bindTacticsDragDrop` 上半段），
  // **本段 pointer 逻辑是给触屏用的**（触屏没有原生 DnD）。
  // 两条路都保留是有意的：缺一条就会在某类设备上无法换位。
  // 因此 `endPointerDrag` 同时挂在 `pointerup` 与 `pointercancel` 上，且额外挂到 `window`
  // 兜底（指针拖出球场容器时不漏收尾）—— 靠 `ptr.id` 守卫去重。
  let ptr = { id: null, fromSlot: null, fromBench: null, el: null };
  pitch.addEventListener(
    "pointerdown",
    (e) => {
      const slotEl = e.target.closest(".tac-slot");
      if (!slotEl || !slotEl.dataset.playerId) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      ptr = {
        id: e.pointerId,
        fromSlot: +slotEl.dataset.slot,
        fromBench: null,
        el: slotEl,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      };
    },
    { passive: true }
  );
  pitch.addEventListener("pointermove", (e) => {
    if (ptr.id !== e.pointerId || ptr.fromSlot == null) return;
    const dx = e.clientX - ptr.x;
    const dy = e.clientY - ptr.y;
    if (!ptr.moved && dx * dx + dy * dy < 64) return;
    if (!ptr.moved) {
      // 正式进入拖拽：此时才捕获指针，之后的事件都归本槽位
      try {
        ptr.el?.setPointerCapture?.(e.pointerId);
      } catch (_) {}
    }
    ptr.moved = true;
    tacPick.dragging = true;
    pitch.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".tac-slot");
    if (over) over.classList.add("drag-over");
  });
  // 拖拽收尾：pitch 与 window 双挂（window 兜底，防止指针在拖拽中途离开球场容器）。
  // 靠 `ptr.id !== e.pointerId` 守卫去重：收尾一次后 ptr.id 置 null，第二次进来直接返回。
  // ⚠ 注意：本函数**不能**改成在 pointerdown 时就 setPointerCapture —— 见上方注释。
  const endPointerDrag = (e) => {
    // 双重守卫：ptr.id 必须是一个真实的 pointerId（非 null），且与本次事件匹配。
    // 因为本函数也挂在 window 上，页面任意点击都会进来 —— 靠这道守卫立即返回。
    if (ptr.id == null || ptr.id !== e.pointerId) return;
    const from = ptr.fromSlot;
    const moved = ptr.moved;
    pitch.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    try {
      ptr.el?.releasePointerCapture?.(e.pointerId);
    } catch (_) {}
    ptr = { id: null, fromSlot: null, fromBench: null, el: null };
    if (!moved || from == null) {
      setTimeout(() => {
        tacPick.dragging = false;
      }, 30);
      return;
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".tac-slot");
    if (over && +over.dataset.slot !== from) {
      const club = getUserClub(world);
      ensureTactics(club);
      const res = swapLineupSlots(club, from, +over.dataset.slot);
      if (res.ok) afterLineupChange(club, res);
      else toast(res.msg || t("tac.swapFail"));
    }
    setTimeout(() => {
      tacPick.dragging = false;
    }, 30);
  };
  pitch.addEventListener("pointerup", endPointerDrag);
  pitch.addEventListener("pointercancel", endPointerDrag);
  window.addEventListener("pointerup", endPointerDrag);
  window.addEventListener("pointercancel", endPointerDrag);

  // 点击：点选互换 / 替补上场（触屏友好）
  pitch.addEventListener("click", (e) => {
    if (tacPick.dragging) return;
    // 点名牌链接且未在点选流程 → 放行打开资料
    if (e.target.closest("[data-player-link]") && !tacPick.mode) return;
    // 槽位内的独立按钮（⭐ 设为核心 / 角色徽章）各自处理，不进入点选流程
    if (e.target.closest("[data-core-id]") || e.target.closest("[data-role-edit]")) return;
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl || !pitch.contains(slotEl)) return;
    e.preventDefault();
    e.stopPropagation();
    const club = getUserClub(world);
    ensureTactics(club);
    const slot = +slotEl.dataset.slot;
    const pid = slotEl.dataset.playerId || null;

    if (tacPick.mode === "bench" && tacPick.playerId) {
      const res = setLineupSlot(club, slot, tacPick.playerId);
      if (res.ok) afterLineupChange(club, res);
      else toast(res.msg || t("tac.swapFail"));
      return;
    }
    if (tacPick.mode === "slot" && tacPick.slot != null) {
      if (tacPick.slot === slot) {
        clearTacPick();
        applyTacPickHighlight();
        return;
      }
      const res = swapLineupSlots(club, tacPick.slot, slot);
      if (res.ok) afterLineupChange(club, res);
      else toast(res.msg || t("tac.swapFail"));
      return;
    }
    // 开始点选（空槽也可被换上）
    tacPick.mode = "slot";
    tacPick.slot = slot;
    tacPick.playerId = pid;
    applyTacPickHighlight();
  });

  if (bench && !bench._tacBound) {
    bench._tacBound = true;
    bench.addEventListener("dragstart", (e) => {
      const chip = e.target.closest(".tac-bench-chip");
      if (!chip || chip.classList.contains("unavailable")) {
        e.preventDefault();
        return;
      }
      tacPick.dragging = true;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(
        "text/plain",
        JSON.stringify({ type: "bench", playerId: chip.dataset.playerId })
      );
      chip.classList.add("dragging");
    });
    bench.addEventListener("dragend", (e) => {
      e.target.closest?.(".tac-bench-chip")?.classList.remove("dragging");
      $("#pitch")?.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
      setTimeout(() => {
        tacPick.dragging = false;
      }, 30);
    });
    bench.addEventListener("click", (e) => {
      const chip = e.target.closest(".tac-bench-chip");
      if (!chip || chip.classList.contains("unavailable")) return;
      if (e.target.closest("[data-player-link]") && !tacPick.mode) return;
      if (e.target.closest("[data-player-link]") && tacPick.mode) {
        e.preventDefault();
        e.stopPropagation();
      }
      const pid = chip.dataset.playerId;
      // 若已选中首发槽 → 直接把该替补换上
      if (tacPick.mode === "slot" && tacPick.slot != null) {
        const club = getUserClub(world);
        const res = setLineupSlot(club, tacPick.slot, pid);
        if (res.ok) afterLineupChange(club, res);
        else toast(res.msg || t("tac.swapFail"));
        return;
      }
      if (tacPick.mode === "bench" && tacPick.playerId === pid) {
        clearTacPick();
        applyTacPickHighlight();
        return;
      }
      tacPick.mode = "bench";
      tacPick.playerId = pid;
      tacPick.slot = null;
      applyTacPickHighlight();
    });
  }
}

function renderTactics() {
  if (!world) return;
  const club = getUserClub(world);
  ensureTactics(club);
  const tac = club.tactics;
  const coachControlled = isFullyDelegated(world, club, "tactics");
  renderTacPresets();
  const formSel = $("#formation-select");
  if (formSel) formSel.value = tac.formation;
  if (formSel) formSel.disabled = coachControlled;
  const phaseShapeSelectors = [
    { id: "#possession-formation-select", key: "possessionFormation" },
    { id: "#out-possession-formation-select", key: "outOfPossessionFormation" },
  ];
  const followLabel = t("tac.followBaseFormation");
  const lang = getLang();
  for (const { id, key } of phaseShapeSelectors) {
    const select = $(id);
    if (!select) continue;
    if (select.dataset.optionsLang !== lang) {
      select.innerHTML = [
        `<option value="">${escapeHtml(followLabel)}</option>`,
        ...Object.keys(FORMATIONS).map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(FORMATIONS[k].name)}</option>`),
      ].join("");
      select.dataset.optionsLang = lang;
    }
    select.value = tac[key] || "";
    select.disabled = coachControlled;
  }
  const styleSel = $("#style-select");
  if (styleSel) styleSel.value = tac.style;
  if (styleSel) styleSel.disabled = coachControlled;
  const setSlider = (id, valId, key, n) => {
    const el = $(id);
    if (el) el.value = n;
    if (el) el.disabled = coachControlled;
    const v = $(valId);
    if (v) v.textContent = tacValText(key, n);
  };
  setSlider("#pressing", "#pressing-val", "pressing", tac.pressing);
  setSlider("#tempo", "#tempo-val", "tempo", tac.tempo);
  setSlider("#width", "#width-val", "width", tac.width ?? 3);
  setSlider("#defensive-line", "#defensive-line-val", "defensiveLine", tac.defensiveLine ?? 3);

  const formDesc = $("#formation-desc");
  const fmeta = FORMATIONS[tac.formation];
  if (formDesc) {
    const fm = FORMATION_MOD[tac.formation] || {};
    const en = getLang() === "en";
    formDesc.textContent = fmeta?.desc
      ? `${fmeta.desc} · ${en ? "ATK" : "攻"}×${(fm.atk || 1).toFixed(2)} ${en ? "DEF" : "防"}×${(fm.def || 1).toFixed(2)} ${en ? "MID" : "中场"}×${(fm.midfield || 1).toFixed(2)}`
      : "";
  }

  const nextEligibility = nextMatchEligibility(club);
  if (!tac.lineup?.length) autoLineup(club, { eligibleIds: nextEligibility.ids });
  // 阵型槽位数变化时对齐 lineup 长度
  const formation = FORMATIONS[tac.formation] || FORMATIONS["4-3-3"];
  if ((tac.lineup || []).length !== formation.slots.length) {
    autoLineup(club, { eligibleIds: nextEligibility.ids });
  }
  ensureLineupRoles(club);
  ensureLineupResponsibilities(club);
  const coreId = getCorePlayerId(club);
  const players = getLineupPlayers(club);
  const pitch = $("#pitch");
  if (!pitch) return;
  ensureKit(club);
  assignSquadNumbers(club);
  const kit = ensureKit(club);
  const kitBg = kitBackground(kit);
  const kitNc = kit.numberColor || "#fff";
  const en = getLang() === "en";
  // 核心球员展示
  const coreDisp = $("#tac-core-display");
  if (coreDisp) {
    if (coreId) {
      const cp = club.players.find((x) => x.id === coreId);
      coreDisp.classList.remove("muted");
      coreDisp.innerHTML = cp
        ? `⭐ <strong>${escapeHtml(cp.name)}</strong> <span class="muted">#${cp.number ?? "·"} · ${escapeHtml(cp.pos || "")}</span>`
        : escapeHtml(en ? "Not set" : "未指定");
    } else {
      coreDisp.classList.add("muted");
      coreDisp.textContent = en ? "Not set — tap ⭐ on the pitch" : "未指定 — 在战术板点 ⭐";
    }
  }
  renderTacticsResponsibilities(club, { coachControlled });
  pitch.innerHTML = formation.slots
    .map((slot, i) => {
      const p = players[i];
      const competitionEligible = !p || nextEligibility.ids.has(p.id);
      const coverage = p ? positionCoverage(p, slot, formation.slots) : null;
      const label = p ? playerDisplaySurname(p.name, p.nationality) : "?";
      const shirtNo = p && p.number != null ? p.number : null;
      const fallback = shirtNo != null ? shirtNo : p ? p.ovr : "-";
      const style = p
        ? `background:${kitBg};color:${kitNc};border-color:${kit.primary || "#fff"}`
        : "background:rgba(148,163,184,0.25);border-color:rgba(255,255,255,0.35)";
      const av = p ? playerAvatarHtml(p, club, 40) : "";
      const roleId = getSlotRole(club, i);
      const dutyId = getSlotDuty(club, i);
      const roleBadge = p
        ? `<button type="button" class="tac-role-badge" data-role-edit="${i}" draggable="false" title="${escapeHtml(
            en ? "Edit role and duty" : "设置角色与职责"
          )}">${escapeHtml(roleShort(roleId, en ? "en" : "zh"))} · ${escapeHtml(
            dutyShort(dutyId, en ? "en" : "zh")
          )}</button>`
        : "";
      const isCore = p && p.id === coreId;
      const full = p
        ? `${shirtNo != null ? `#${shirtNo} ` : ""}${p.name} · ${detailedPositionLabel(coverage?.target, en ? "en" : "zh")} ${coverage?.rating ?? 0}/20 · ${roleLabel(roleId, en ? "en" : "zh")}（${dutyLabel(dutyId, en ? "en" : "zh")}）${isCore ? (en ? " · CORE" : " · 核心") : ""}${competitionEligible ? "" : (en ? " · NOT REGISTERED" : " · 未报名")}`
        : positionLabel(slot.pos);
      const badge =
        shirtNo != null
          ? `<span class="pitch-num" style="background:${kitBg};color:${kitNc};border-color:${kit.primary || "#fff"}">${shirtNo}</span>`
          : `<span class="pitch-slot-pos">${escapeHtml(slot.pos)}</span>`;
      const nameText = shirtNo != null ? `#${shirtNo} ${label}` : label;
      const nameHtml = p
        ? `<button type="button" class="player-link pitch-player-link" data-player-link="${escapeHtml(p.id)}">${escapeHtml(nameText)}</button>`
        : `<span class="pitch-empty">${escapeHtml(positionLabel(slot.pos))}</span>`;
      const coreBtn = p
        ? `<button type="button" class="tac-core-btn${isCore ? " is-core" : ""}" data-core-id="${escapeHtml(p.id)}" title="${escapeHtml(
            en ? "Set as core (talisman)" : "设为核心球员"
          )}" aria-pressed="${isCore ? "true" : "false"}">⭐</button>`
        : "";
      const oop = p && (coverage?.rating || 0) < 10 ? " out-of-pos" : "";
      const empty = !p ? " empty" : "";
      const coreCls = isCore ? " is-core" : "";
      const registrationCls = competitionEligible ? "" : " unavailable";
      const roleEditing = i === tacRoleSlot ? " role-editing" : "";
      return `<div class="player-dot tac-slot${p ? " clickable-player" : ""}${oop}${empty}${coreCls}${registrationCls}${roleEditing}"
        style="left:${slot.x}%;top:${slot.y}%"
        title="${escapeHtml(full)}"
        draggable="${p ? "true" : "false"}"
        data-slot="${i}"
        data-slot-pos="${escapeHtml(slot.pos)}"
        data-slot-detailed-pos="${escapeHtml(coverage?.target || "")}"
        ${p ? `data-player-id="${escapeHtml(p.id)}"` : ""}>
        <div class="circle kit-dot" style="${style}">${av || fallback}${badge}${isCore ? '<span class="pitch-core-star">⭐</span>' : ""}</div>
        <div class="name">${nameHtml}</div>
        ${coreBtn}
        ${roleBadge}
      </div>`;
    })
    .join("");

  // 替补席
  const benchEl = $("#tac-bench");
  if (benchEl) {
    const xiSet = new Set(tac.lineup || []);
    const benchPlayers = (club.players || [])
      .filter((p) => p && !xiSet.has(p.id))
      .sort((a, b) => {
        const ua = (a.injured || 0) > 0 || (a.suspendedMatches || 0) > 0 ? 1 : 0;
        const ub = (b.injured || 0) > 0 || (b.suspendedMatches || 0) > 0 ? 1 : 0;
        if (ua !== ub) return ua - ub;
        return (b.ovr || 0) - (a.ovr || 0);
      });
    benchEl.innerHTML = benchPlayers.length
      ? benchPlayers
          .map((p) => {
            const unavail =
              (p.injured || 0) > 0 || (p.suspendedMatches || 0) > 0 || !nextEligibility.ids.has(p.id);
            const num = p.number != null ? `#${p.number}` : "";
            const av = playerAvatarHtml(p, club, 40);
            const fit = Math.round(p.fitness ?? 100);
            const status =
              (p.injured || 0) > 0
                ? `<em class="tac-chip-bad">${escapeHtml(injuryStatusText(p, getLang() === "en"))}</em>`
                : (p.returnToPlayDays || 0) > 0
                  ? `<em class="tac-chip-warn">${escapeHtml(injuryStatusText(p, getLang() === "en"))}</em>`
                : (p.suspendedMatches || 0) > 0
                  ? `<em class="tac-chip-bad">${getLang() === "en" ? "SUS" : "停"}</em>`
                  : !nextEligibility.ids.has(p.id)
                    ? `<em class="tac-chip-bad">${getLang() === "en" ? "UNREG" : "未报名"}</em>`
                  : fit < 62
                    ? `<em class="tac-chip-warn">${fit}%</em>`
                    : `<em>${p.ovr}</em>`;
            return `<div class="tac-bench-chip${unavail ? " unavailable" : ""}"
              draggable="${unavail ? "false" : "true"}"
              data-player-id="${escapeHtml(p.id)}"
              role="listitem"
              title="${escapeHtml(p.name)}">
              ${av}
              <div class="tac-chip-meta">
                <strong>${num} ${escapeHtml(playerDisplaySurname(p.name, p.nationality))}</strong>
                <span><i class="badge ${p.pos}">${escapeHtml(positionLabel(p.pos))}</i> <small class="muted">${escapeHtml(positionSummary(p, getLang() === "en" ? "en" : "zh"))}</small> ${status}</span>
              </div>
              <button type="button" class="btn small ghost tac-chip-info" data-player-link="${escapeHtml(p.id)}" title="${escapeHtml(getLang() === "en" ? "Profile" : "资料")}">ℹ</button>
            </div>`;
          })
          .join("")
      : `<p class="muted" style="margin:0.25rem 0">${escapeHtml(t("tac.benchEmpty"))}</p>`;
  }

  bindTacticsDragDrop();
  renderTacticsRolePanel(club, { coachControlled });
  bindTacticsRoleEditor();
  bindTacticsCoreButtons();
  const autoXiButton = $("#btn-auto-xi");
  if (autoXiButton) autoXiButton.disabled = coachControlled;
  const presetBox = $("#tac-presets");
  presetBox?.querySelectorAll("button").forEach((button) => { button.disabled = coachControlled; });
  pitch.classList.toggle("delegation-readonly", coachControlled);
  applyTacPickHighlight();
  renderTacticsSummary();
}

/** 核心球员 ⭐ 按钮 */
function bindTacticsCoreButtons() {
  const pitch = $("#pitch");
  if (!pitch) return;
  pitch.querySelectorAll("[data-core-id]").forEach((btn) => {
    btn.disabled = isFullyDelegated(world, getUserClub(world), "tactics");
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (!world) return;
      const club = getUserClub(world);
      const id = btn.getAttribute("data-core-id");
      const res = setCorePlayerId(club, id);
      if (!res.ok) {
        toast(res.msg || t("tac.coreFail"));
        return;
      }
      saveGame(world);
      renderTactics();
      if (res.cleared) {
        toast(t("tac.coreCleared"));
      } else {
        const p = club.players.find((x) => x.id === res.corePlayerId);
        toast(t("tac.coreSet", { name: p?.name || "" }));
      }
    });
  });
}

function renderTacticsRolePanel(club, { coachControlled = false } = {}) {
  const panel = $("#tac-role-panel");
  if (!panel || !club) return;
  ensureTactics(club);
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const slots = formation.slots || [];
  const players = getLineupPlayers(club);
  if (!players.length) {
    panel.innerHTML = `<p class="muted" style="margin:0;padding:0.75rem">${escapeHtml(
      getLang() === "en" ? "Set a starting XI to edit roles." : "请先排出首发，再设置角色。"
    )}</p>`;
    return;
  }
  if (tacRoleSlot < 0 || tacRoleSlot >= slots.length || !players[tacRoleSlot]) {
    tacRoleSlot = players.findIndex(Boolean);
    if (tacRoleSlot < 0) tacRoleSlot = 0;
  }
  const slot = slots[tacRoleSlot];
  const player = players[tacRoleSlot];
  const detailed = slotPositionCode(slot, tacRoleSlot, slots);
  const roleId = getSlotRole(club, tacRoleSlot);
  const dutyId = getSlotDuty(club, tacRoleSlot);
  const en = getLang() === "en";
  const candidates = rolesForDetailedPosition(detailed);
  const candidateCards = candidates
    .map((candidateId) => {
      const info = roleDetail(candidateId);
      const fit = roleSuitability(player, candidateId, info.defaultDuty, detailed);
      const active = candidateId === roleId ? " active" : "";
      return `<button type="button" class="tac-role-card${active}" data-role-choice="${escapeHtml(candidateId)}" ${coachControlled ? "disabled" : ""}>
        <strong>${escapeHtml(roleLabel(candidateId, en ? "en" : "zh"))}</strong>
        <span class="tac-role-fit">${escapeHtml(en ? `Fit ${fit.rating}/20` : `适配 ${fit.rating}/20`)}</span>
        <span>${escapeHtml(en ? info.descriptionEn : info.description)}</span>
      </button>`;
    })
    .join("");
  const currentInfo = roleDetail(roleId);
  const currentFit = roleSuitability(player, roleId, dutyId, detailed);
  const matched = currentFit.matched
    .map((habitId) => `<span>${escapeHtml(en ? `Natural: ${habitLabel(habitId, "en")}` : `契合：${habitLabel(habitId)}`)}</span>`)
    .join("");
  const conflicts = currentFit.conflicts
    .map((habitId) => `<span class="conflict">${escapeHtml(en ? `Conflict: ${habitLabel(habitId, "en")}` : `冲突：${habitLabel(habitId)}`)}</span>`)
    .join("");
  const dutyButtons = currentInfo.duties
    .map((id) => `<button type="button" class="tac-duty-btn${id === dutyId ? " active" : ""}" data-duty-choice="${escapeHtml(id)}" ${coachControlled ? "disabled" : ""}>
      ${escapeHtml(dutyLabel(id, en ? "en" : "zh"))} <small>${escapeHtml(dutyShort(id, en ? "en" : "zh"))}</small>
    </button>`)
    .join("");
  const avatar = playerAvatarHtml(player, club, 42);
  panel.innerHTML = `
    <div class="tac-role-panel-head">
      ${avatar ? `<div class="avatar">${avatar}</div>` : ""}
      <div class="tac-role-panel-player">
        <strong>${escapeHtml(`#${player.number ?? "·"} ${player.name}`)}</strong>
        <span class="muted">${escapeHtml(detailedPositionLabel(detailed, en ? "en" : "zh"))} · ${escapeHtml(roleLabel(roleId, en ? "en" : "zh"))} · ${escapeHtml(dutyLabel(dutyId, en ? "en" : "zh"))}</span>
      </div>
      <span class="muted" style="margin-left:auto">${escapeHtml(`${tacRoleSlot + 1}/${slots.length}`)}</span>
    </div>
    <div class="tac-role-list">${candidateCards}</div>
    <div class="tac-role-detail">
      <div class="muted">${escapeHtml(roleDescription(roleId, en ? "en" : "zh"))}</div>
      <div class="tac-duty-list">${dutyButtons}</div>
      <div class="tac-role-habit-facts">${matched || conflicts ? `${matched}${conflicts}` : `<span>${escapeHtml(en ? "No direct habit fit or conflict recorded." : "暂无直接习惯契合或冲突记录。")}</span>`}</div>
      <span class="hint">${escapeHtml(
        coachControlled
          ? (en ? "The coaching staff controls role selection for this team." : "当前由教练团队负责角色安排。")
          : (en ? "Role fit reads position, attributes and playing habits; it does not change ability." : "角色适配读取位置、属性和个人习惯，不会改变球员能力。")
      )}</span>
    </div>`;
}

function bindTacticsRoleEditor() {
  const pitch = $("#pitch");
  const panel = $("#tac-role-panel");
  if (!pitch || !panel) return;
  pitch.querySelectorAll("[data-role-edit]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("mousedown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      tacRoleSlot = Number(button.dataset.roleEdit) || 0;
      pitch.querySelectorAll(".role-editing").forEach((el) => el.classList.remove("role-editing"));
      button.closest(".tac-slot")?.classList.add("role-editing");
      renderTacticsRolePanel(getUserClub(world), {
        coachControlled: isFullyDelegated(world, getUserClub(world), "tactics"),
      });
      bindTacticsRoleChoices();
    });
  });
  bindTacticsRoleChoices();
}

function bindTacticsRoleChoices() {
  const panel = $("#tac-role-panel");
  if (!panel) return;
  panel.querySelectorAll("[data-role-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const club = getUserClub(world);
      if (!club || isFullyDelegated(world, club, "tactics")) return;
      const result = setSlotRole(club, tacRoleSlot, button.dataset.roleChoice);
      if (!result.ok) return toast(result.msg || t("tac.roleFail"));
      saveGame(world);
      renderTactics();
      toast(t("tac.roleSet", { role: roleLabel(result.roleId, getLang() === "en" ? "en" : "zh") }));
    });
  });
  panel.querySelectorAll("[data-duty-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const club = getUserClub(world);
      if (!club || isFullyDelegated(world, club, "tactics")) return;
      const result = setSlotDuty(club, tacRoleSlot, button.dataset.dutyChoice);
      if (!result.ok) return toast(result.msg || "职责设置失败");
      saveGame(world);
      renderTactics();
    });
  });
}

let sharedModalReturnFocus = null;

function openSharedModal() {
  const modal = $("#modal");
  if (!modal) return;
  if (modal.classList.contains("hidden")) sharedModalReturnFocus = document.activeElement;
  modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    const first = modal.querySelector(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );
    (first || $("#modal-card"))?.focus();
  });
}

function closeModal() {
  if (restorePlayerBrowseParent(activePlayerBrowseContext)) return;
  activePlayerBrowseContext = null;
  $("#modal")?.classList.add("hidden");
  $("#modal-card")?.classList.remove("wide", "search-modal");
  if (sharedModalReturnFocus?.isConnected) sharedModalReturnFocus.focus();
  sharedModalReturnFocus = null;
}

function normalizeGlobalSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function globalSearchScore(values, query) {
  let best = Number.POSITIVE_INFINITY;
  values.forEach((value, fieldIndex) => {
    const text = normalizeGlobalSearch(value);
    const at = text.indexOf(query);
    if (at < 0) return;
    let score = at === 0 ? 0 : 3;
    if (at > 0 && /[\s.'-]/.test(text[at - 1])) score = 1;
    best = Math.min(best, score + fieldIndex * 0.1 + at * 0.001);
  });
  return best;
}

function collectGlobalSearchResults(query) {
  const userClub = getUserClub(world);
  const players = [];
  const clubs = [];
  const nations = [];
  const youth = [];

  for (const nation of listNationalTeams(world)) {
    const score = globalSearchScore(
      [nationName(nation.code, getLang()), nation.name, nation.nameEn, nation.code],
      query
    );
    if (!Number.isFinite(score)) continue;
    nations.push({
      type: "nation",
      id: nation.code,
      label: nationName(nation.code, getLang()),
      nation,
      score,
    });
  }

  for (const club of world.clubs || []) {
    const clubScore = globalSearchScore(
      [clubDisplayName(club), club.nameZh, club.nameEn, club.short],
      query
    );
    if (Number.isFinite(clubScore)) {
      clubs.push({
        type: "club",
        id: club.id,
        label: clubDisplayName(club),
        club,
        score: clubScore,
      });
    }
    for (const player of club.players || []) {
      const score = globalSearchScore([player.name, playerDisplaySurname(player)], query);
      if (!Number.isFinite(score)) continue;
      players.push({
        type: "player",
        id: player.id,
        label: player.name,
        player,
        club,
        score,
      });
    }
  }

  for (const player of userClub.youth?.players || []) {
    const score = globalSearchScore([player.name, playerDisplaySurname(player)], query);
    if (!Number.isFinite(score)) continue;
    youth.push({
      type: "youth",
      id: player.id,
      label: player.name,
      player,
      club: userClub,
      score,
    });
  }

  const sortMatches = (a, b) =>
    a.score - b.score ||
    a.label.localeCompare(b.label, getLang() === "en" ? "en" : "zh-CN", { sensitivity: "base" });
  players.sort(sortMatches);
  clubs.sort(sortMatches);
  nations.sort(sortMatches);
  youth.sort(sortMatches);

  // Reserve room for every matching category, then refill unused slots by relevance.
  const selected = [
    ...players.slice(0, 5),
    ...clubs.slice(0, 2),
    ...nations.slice(0, 2),
    ...youth.slice(0, 1),
  ];
  const selectedKeys = new Set(selected.map((item) => `${item.type}:${item.id}`));
  const remaining = [...players, ...clubs, ...nations, ...youth]
    .filter((item) => !selectedKeys.has(`${item.type}:${item.id}`))
    .sort(sortMatches);
  while (selected.length < 10 && remaining.length) selected.push(remaining.shift());

  return {
    players: selected.filter((item) => item.type === "player").sort(sortMatches),
    clubs: selected.filter((item) => item.type === "club").sort(sortMatches),
    nations: selected.filter((item) => item.type === "nation").sort(sortMatches),
    youth: selected.filter((item) => item.type === "youth").sort(sortMatches),
  };
}

function globalPlayerSearchRow(item, { academy = false } = {}) {
  const { player, club } = item;
  const ownPlayer = club.id === world.userClubId;
  const ovr = ownPlayer
    ? String(player.ovr ?? playerOverall(player))
    : formatScoutOvrFog(player, getUserClub(world), { ownPlayer: false, world });
  const age = getLang() === "en" ? `Age ${player.age}` : `${player.age} 岁`;
  const source = academy ? t("search.youth") : clubDisplayName(club);
  return `<button type="button" class="global-search-result" data-player-link="${escapeHtml(player.id)}">
    ${playerAvatarHtml(player, club, 32)}
    <span class="global-search-copy">
      <strong>${escapeHtml(player.name)}</strong>
      <span>${escapeHtml(source)} · ${escapeHtml(positionLabel(player.pos))} · ${escapeHtml(age)}</span>
    </span>
    <span class="global-search-rating">${escapeHtml(t("th.ovr"))} ${escapeHtml(ovr)}</span>
  </button>`;
}

function globalClubSearchRow(item) {
  const club = item.club;
  ensureKit(club);
  const div = club.division || 3;
  const divName = t(`div.${div}`) || DIVISIONS[div]?.name || "";
  return `<button type="button" class="global-search-result" data-club-link="${escapeHtml(club.id)}">
    ${clubCrestHtml(club, { size: 36, className: "global-search-club-crest", decorative: true })}
    <span class="global-search-copy">
      <strong>${escapeHtml(clubDisplayName(club))}</strong>
      <span>${escapeHtml(divName)}${club.short ? ` · ${escapeHtml(club.short)}` : ""}</span>
    </span>
  </button>`;
}

function globalNationSearchRow(item) {
  const { nation } = item;
  const en = getLang() === "en";
  const detail = en
    ? `Player pool ${nation.pool} · XI OVR ${nation.strength || "—"}`
    : `人才池 ${nation.pool} · 首发能力 ${nation.strength || "—"}`;
  return `<button type="button" class="global-search-result" data-nation="${escapeHtml(nation.code)}">
    <span class="global-search-nation-flag">${nationFlagHtml(nation.code)}</span>
    <span class="global-search-copy">
      <strong>${escapeHtml(nationName(nation.code, getLang()))}</strong>
      <span>${escapeHtml(detail)}</span>
    </span>
    <span class="global-search-rating">${escapeHtml(nation.code)}</span>
  </button>`;
}

function renderGlobalSearchResults(rawQuery) {
  const host = $("#global-search-results");
  if (!host) return;
  const query = normalizeGlobalSearch(rawQuery.trim());
  if ([...query].length < 2) {
    host.innerHTML = `<p class="global-search-status">${escapeHtml(t("search.hint"))}</p>`;
    return;
  }

  const results = collectGlobalSearchResults(query);
  const total = results.players.length + results.clubs.length + results.nations.length + results.youth.length;
  if (!total) {
    host.innerHTML = `<p class="global-search-status">${escapeHtml(t("search.empty"))}</p>`;
    return;
  }

  const group = (title, items, renderItem) =>
    items.length
      ? `<section class="global-search-group">
          <h3><span>${escapeHtml(title)}</span><span>${items.length}</span></h3>
          <div class="global-search-list">${items.map(renderItem).join("")}</div>
        </section>`
      : "";
  host.innerHTML = [
    group(t("search.players"), results.players, (item) => globalPlayerSearchRow(item)),
    group(t("search.clubs"), results.clubs, globalClubSearchRow),
    group(t("search.nations"), results.nations, globalNationSearchRow),
    group(t("search.youth"), results.youth, (item) => globalPlayerSearchRow(item, { academy: true })),
  ].join("");
}

function openGlobalSearch() {
  if (!world || !$("#screen-main")?.classList.contains("active")) return;
  activePlayerBrowseContext = null;
  const card = $("#modal-card");
  card?.classList.remove("wide");
  card?.classList.add("search-modal");
  $("#modal-body").innerHTML = `
    <div class="global-search-shell">
      <h2 id="global-search-title">${escapeHtml(t("search.title"))}</h2>
      <input id="global-search-input" class="global-search-input" type="search"
        autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t("search.placeholder"))}" />
      <div id="global-search-results" class="global-search-results" aria-live="polite"></div>
    </div>`;
  openSharedModal();
  const input = $("#global-search-input");
  input?.addEventListener("input", () => renderGlobalSearchResults(input.value));
  renderGlobalSearchResults("");
  requestAnimationFrame(() => input?.focus());
}

function formatFormHtml(form) {
  const list = (form || []).slice(-5);
  if (!list.length) return `<span class="muted">—</span>`;
  return `<span class="form-pills">${list
    .map((r) => {
      const cls = r === "W" ? "w" : r === "D" ? "d" : "l";
      return `<i class="form-pill ${cls}" title="${r}">${r}</i>`;
    })
    .join("")}</span>`;
}

function squadAvgOvr(club) {
  const ps = club.players || [];
  if (!ps.length) return 0;
  return Math.round(ps.reduce((s, p) => s + (p.ovr || 0), 0) / ps.length);
}

function scoutedSquadAverage(club) {
  const players = club?.players || [];
  if (!players.length) return { estimate: 0, text: "0" };
  if (club.id === world.userClubId) {
    const exact = squadAvgOvr(club);
    return { estimate: exact, text: String(exact) };
  }
  const userClub = getUserClub(world);
  const snapshots = players.map((player) => scoutPlayerSnapshot(world, player, userClub, { club }));
  const average = (key) => Math.round(snapshots.reduce((sum, item) => sum + item[key], 0) / snapshots.length);
  return {
    estimate: average("ovrEstimate"),
    text: `${average("ovrLo")}-${average("ovrHi")}`,
  };
}

function renderClubs() {
  if (!world) return;
  const tbody = $("#clubs-table tbody");
  if (!tbody) return;
  const sel = $("#clubs-division");
  const searchEl = $("#clubs-search");
  const me = getUserClub(world);
  fillDivisionSelects(me?.division || 3);
  if (sel && !sel.dataset.touched) {
    if (me) sel.value = String(me.division || 3);
  }
  const divFilter = sel?.value || "all";
  const q = (searchEl?.value || "").trim().toLowerCase();

  // 各级积分榜排名缓存（七国全部联赛）
  const rankMap = new Map();
  for (const d of DIVISION_IDS) {
    getSortedTable(world, d).forEach((r, i) => {
      rankMap.set(r.id, { rank: i + 1, pts: r.pts, row: r });
    });
  }

  let clubs = [...(world.clubs || [])];
  if (divFilter !== "all") {
    const d = Number(divFilter);
    clubs = clubs.filter((c) => (c.division || 3) === d);
  }
  if (q) {
    clubs = clubs.filter(
      (c) =>
        clubDisplayName(c).toLowerCase().includes(q) ||
        (c.nameZh || "").toLowerCase().includes(q) ||
        (c.nameEn || "").toLowerCase().includes(q) ||
        (c.short || "").toLowerCase().includes(q)
    );
  }
  clubs.sort((a, b) => {
    const da = a.division || 3;
    const db = b.division || 3;
    if (da !== db) return da - db;
    const ra = rankMap.get(a.id)?.rank ?? 99;
    const rb = rankMap.get(b.id)?.rank ?? 99;
    return ra - rb;
  });

  tbody.innerHTML = clubs.length
    ? clubs
        .map((c) => {
          const me = c.id === world.userClubId;
          const info = rankMap.get(c.id);
          const divName = t("div." + (c.division || 3)) || DIVISIONS[c.division || 3]?.name || "";
          const avg = scoutedSquadAverage(c);
          ensureKit(c);
          return `<tr class="${me ? "me" : ""}">
            <td>
              ${clubLinkHtml(c.id, clubDisplayName(c))}${me ? " ★" : ""}
            </td>
            <td>${escapeHtml(divName)}</td>
            <td>${info ? info.rank : "—"}</td>
            <td><strong>${info ? info.pts : 0}</strong></td>
            <td>${formatFormHtml(c.form)}</td>
            <td class="${ovrClass(avg.estimate)}">${escapeHtml(avg.text)}</td>
            <td>${formatMoney(c.money || 0)}</td>
            <td><button type="button" class="btn small" data-open-club="${escapeHtml(c.id)}">${escapeHtml(t("clubs.view"))}</button></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="muted">${escapeHtml(t("clubs.empty"))}</td></tr>`;
}

function showClubModal(clubId) {
  if (!world || !clubId) return;
  activePlayerBrowseContext = null;
  const club = world.clubs.find((c) => c.id === clubId);
  if (!club) return;

  ensureKit(club);
  ensureClubHonors(club);
  ensureStaff(club);
  const me = club.id === world.userClubId;
  const en = getLang() === "en";
  const div = club.division || 3;
  const divName = t("div." + div) || DIVISIONS[div]?.name || "";
  const table = getSortedTable(world, div);
  const rank = table.findIndex((r) => r.id === club.id) + 1;
  const row = table.find((r) => r.id === club.id) || {
    played: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    gd: 0,
    pts: 0,
  };
  const userClub = getUserClub(world);
  const scoutedSquad = (club.players || []).map((player) => ({
    player,
    scouting: scoutPlayerSnapshot(world, player, userClub, { ownPlayer: me, club }),
  }));
  const avg = scoutedSquadAverage(club);
  const topPlayers = scoutedSquad
    .sort((a, b) => b.scouting.ovrEstimate - a.scouting.ovrEstimate)
    .slice(0, 16);
  const formation = club.tactics?.formation || "4-3-3";
  const possessionFormation = club.tactics?.possessionFormation || formation;
  const outOfPossessionFormation = club.tactics?.outOfPossessionFormation || formation;
  const styleKey = club.tactics?.style || "balanced";
  const styleLabel = t("style." + styleKey) || styleKey;
  const staffRoles = ["coach", "scout", "doctor"];
  const staffCardsHtml = staffRoles
    .map((role) => {
      const s = club.staff?.[role];
      if (!s) return "";
      const isHead = role === "coach";
      const years = s.contractYears != null ? s.contractYears : "—";
      return `<article class="club-staff-card ${isHead ? "is-head" : ""}">
        <div class="club-staff-card-main">
          ${staffAvatarHtml(s, isHead ? 48 : 40)}
          <div>
            <div class="role">${escapeHtml(staffRoleLabel(role, en))}</div>
            <strong class="name">${staffLinkHtml(s, club.id, club.id)}</strong>
            <div class="meta">
              ${en ? "Ability" : "能力"} <strong class="${ovrClass(s.rating)}">${s.rating}</strong>
              · ${en ? `Age ${s.age}` : `${s.age} 岁`}
              · ${en ? "Wage" : "周薪"} ${formatMoney(s.wage)}
              · ${en ? "Contract" : "合同"} ${years}${en ? "y" : "年"}
            </div>
          </div>
        </div>
        <button type="button" class="btn small" data-staff-link="${escapeHtml(s.id)}" data-staff-club="${escapeHtml(club.id)}" data-staff-return-club="${escapeHtml(club.id)}">${en ? "Profile" : "资料"}</button>
      </article>`;
    })
    .join("");

  const fixtures = (world.fixtures || [])
    .filter((f) => f.home === club.id || f.away === club.id)
    .slice()
    .sort((a, b) => a.day - b.day);
  // 近期已赛 + 接下来未赛
  const playedFx = fixtures.filter((f) => f.played).slice(-5).reverse();
  const upcomingFx = fixtures.filter((f) => !f.played).slice(0, 6);

  const honorHtml = (club.honors || []).length
    ? `<div class="honor-list">${club.honors
        .slice(0, 8)
        .map(
          (h) => `<div class="honor-item">
            <div class="season">${h.season}</div>
            <strong>${escapeHtml(h.title || "")}</strong>
            ${h.detail ? ` <span class="muted">（${escapeHtml(h.detail)}）</span>` : ""}
          </div>`
        )
        .join("")}</div>`
    : `<p class="muted" style="margin:0">${escapeHtml(t("clubs.noHonors"))}</p>`;

  const squadRows = topPlayers
    .map(({ player: p, scouting }) => {
      const s = playerStats(p);
      const isGk = p.pos === "GK";
      const ovrText = scouting.ovrText;
      return `<tr>
        <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(club)}">${p.number ?? "—"}</span></td>
        <td class="name-with-avatar">${playerAvatarHtml(p, club, 32)}
          ${playerLinkHtml(p.id, p.name, "", { browseType: "club", browseId: club.id })}
        </td>
        <td><span class="badge ${p.pos}">${escapeHtml(positionLabel(p.pos))}</span></td>
        <td>${p.age}</td>
        <td class="${ovrClass(scouting.ovrEstimate)}"><strong>${escapeHtml(ovrText)}</strong></td>
        <td title="${escapeHtml(isGk ? t("th.cs") : t("th.goals"))}">${isGk ? s.cleanSheets : s.goals}</td>
        <td title="${escapeHtml(isGk ? t("th.ga") : t("th.assists"))}">${isGk ? s.goalsConceded : s.assists}</td>
      </tr>`;
    })
    .join("");

  const fxRow = (f) => {
    const home = world.clubs.find((c) => c.id === f.home);
    const away = world.clubs.find((c) => c.id === f.away);
    const score = f.played ? `${f.homeGoals} - ${f.awayGoals}` : "—";
    const homeCls = f.home === club.id ? "me-side" : "";
    const awayCls = f.away === club.id ? "me-side" : "";
    return `<tr>
      <td>D${f.day}</td>
      <td class="${homeCls}">${home ? clubLinkHtml(home.id, home.short) : "?"}</td>
      <td>${score}</td>
      <td class="${awayCls}">${away ? clubLinkHtml(away.id, away.short) : "?"}</td>
      <td>${f.competition === "cup" ? escapeHtml(f.roundLabel || t("match.cup")) : `R${f.round || ""}`}</td>
    </tr>`;
  };

  $("#modal-body").innerHTML = `
    <div class="club-modal-head">
      ${clubCrestHtml(club, { size: 72, className: "club-modal-crest", decorative: true })}
      ${renderKitShirt(club, null, 52)}
      <div>
        <h2 style="margin:0 0 0.25rem">${escapeHtml(clubDisplayName(club))}${me ? " ★" : ""}</h2>
        <p class="muted" style="margin:0">
          ${escapeHtml(divName)}
          ${rank ? ` · ${t("clubs.rank", { n: rank })}` : ""}
          · ${t("clubs.pts", { n: row.pts || 0 })}
          · ${escapeHtml(t("clubs.record", { w: row.w || 0, d: row.d || 0, l: row.l || 0 }))}
        </p>
        <p class="muted" style="margin:0.25rem 0 0">
          ${escapeHtml(t("clubs.money"))} ${formatMoney(club.money || 0)}
          · ${escapeHtml(t("clubs.squadAvg"))} <strong class="${ovrClass(avg.estimate)}">${escapeHtml(avg.text)}</strong>
          · ${escapeHtml(t("clubs.power"))} ${club.power ?? "—"}
          · ${escapeHtml(t("tac.formation"))} ${escapeHtml(formation)}
          · ${escapeHtml(t("tac.possessionFormation"))} ${escapeHtml(possessionFormation)}
          · ${escapeHtml(t("tac.outOfPossessionFormation"))} ${escapeHtml(outOfPossessionFormation)}
          · ${escapeHtml(styleLabel)}
        </p>
        <div style="margin-top:0.4rem">${formatFormHtml(club.form)} <span class="muted" style="font-size:var(--fs-sm)">${escapeHtml(t("clubs.formHint"))}</span></div>
      </div>
    </div>

    <section class="club-staff-section">
      <div class="row-between" style="align-items:baseline;gap:0.5rem;flex-wrap:wrap">
        <h3 style="margin:0;font-size:var(--fs-md)">${escapeHtml(t("clubs.staff"))}</h3>
        <span class="muted" style="font-size:var(--fs-sm)">${escapeHtml(me ? t("clubs.staffHintOwn") : t("clubs.staffHintOther"))}</span>
      </div>
      <div class="club-staff-grid">
        ${staffCardsHtml || `<p class="muted" style="margin:0">${escapeHtml(t("clubs.noStaff"))}</p>`}
      </div>
    </section>

    <div class="club-modal-grid">
      <div>
        <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${escapeHtml(t("clubs.squad"))}</h3>
        <p class="hint" style="margin:0 0 0.4rem">${escapeHtml(t("clubs.squadHint", { n: (club.players || []).length }))}</p>
        <div class="table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>#</th><th>${escapeHtml(t("th.name"))}</th><th>${escapeHtml(t("th.pos"))}</th>
                <th>${escapeHtml(t("th.age"))}</th><th>${escapeHtml(t("th.ovr"))}</th>
                <th title="${escapeHtml(t("th.goalsCsTitle"))}">${escapeHtml(t("th.goalsCs"))}</th>
                <th title="${escapeHtml(t("th.assistsGaTitle"))}">${escapeHtml(t("th.assistsGa"))}</th>
              </tr>
            </thead>
            <tbody>
              ${
                squadRows ||
                `<tr><td colspan="7" class="muted">${escapeHtml(t("clubs.noSquad"))}</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${escapeHtml(t("clubs.upcoming"))}</h3>
        <div class="table-wrap">
          <table class="compact-table">
            <thead><tr><th>D</th><th>${escapeHtml(t("th.home"))}</th><th></th><th>${escapeHtml(t("th.away"))}</th><th></th></tr></thead>
            <tbody>
              ${
                upcomingFx.length
                  ? upcomingFx.map(fxRow).join("")
                  : `<tr><td colspan="5" class="muted">${escapeHtml(t("clubs.noFixtures"))}</td></tr>`
              }
            </tbody>
          </table>
        </div>
        <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${escapeHtml(t("clubs.recent"))}</h3>
        <div class="table-wrap">
          <table class="compact-table">
            <thead><tr><th>D</th><th>${escapeHtml(t("th.home"))}</th><th></th><th>${escapeHtml(t("th.away"))}</th><th></th></tr></thead>
            <tbody>
              ${
                playedFx.length
                  ? playedFx.map(fxRow).join("")
                  : `<tr><td colspan="5" class="muted">${escapeHtml(t("clubs.noFixtures"))}</td></tr>`
              }
            </tbody>
          </table>
        </div>
        <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${escapeHtml(t("clubs.honors"))}</h3>
        ${honorHtml}
      </div>
    </div>
  `;

  $("#modal-card")?.classList.remove("search-modal");
  $("#modal-card")?.classList.add("wide");
  openSharedModal();
}

/** 联赛榜与数据榜共享同一份筛选状态，委托给 js/ui/league-centre.js */
const leagueCentreState = {
  get leagueDivision() { return selectedLeagueDivision; },
  set leagueDivision(v) { selectedLeagueDivision = v; },
  get statsDivision() { return selectedStatsDivision; },
  set statsDivision(v) { selectedStatsDivision = v; },
};

function renderTable() {
  if (!world) return;
  renderTableView(world, getUserClub(world), leagueCentreState, {
    fillDivisionSelects,
    onRerender: () => renderTable(),
  });
}

function setLeagueCentreView(view) {
  const next = view === "stats" ? "stats" : "table";
  selectedLeagueCentreView = next;
  syncMainNavigation("table");
  $$(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  $(`#tab-${next}`)?.classList.add("active");
  $$('[data-league-centre-view]').forEach((button) => {
    const active = button.dataset.leagueCentreView === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  refreshAll();
}

function renderStats() {
  if (!world) return;
  renderStatsView(world, leagueCentreState, () => renderStats());
}

function parseMoneyInput(value) {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function openBuyNegotiator(playerId, fromClubId) {
  const en = getLang() === "en";
  const deal = previewBuyDeal(world, playerId, fromClubId, 3, 1.1);
  if (!deal) {
    toast(en ? "Unable to preview this deal" : "无法预览该交易");
    return;
  }
  const feeIn = prompt(
    en
      ? `${deal.player.name}\nScout estimate ${formatMoney(deal.price)}\nTransfer-fee offer:`
      : `${deal.player.name}\n球探估值约 ${formatMoney(deal.price)}\n请输入转会费报价：`,
    String(deal.price)
  );
  if (feeIn == null) return;
  const fee = parseMoneyInput(feeIn);
  const years = prompt(
    en ? "Contract length (1–5, default 3):" : "合同年限（1–5，默认 3）：",
    "3"
  );
  if (years == null) return;
  const y = Math.max(1, Math.min(5, parseInt(years, 10) || 3));
  const wageIn = prompt(
    en
      ? `Weekly-wage offer (market estimate ${formatMoney(deal.newWage)}):`
      : `请输入周薪报价（市场参考约 ${formatMoney(deal.newWage)}）：`,
    String(deal.newWage)
  );
  if (wageIn == null) return;
  const wage = parseMoneyInput(wageIn);
  const signingBonus = Math.round(wage * y * 0.5);
  const installmentIn = prompt(
    en ? "Transfer-fee installments (0–3, default 2):" : "转会费分期数（0–3，默认 2）：",
    fee >= 400_000 ? "2" : "0"
  );
  if (installmentIn == null) return;
  const installmentCount = Math.max(0, Math.min(3, parseInt(installmentIn, 10) || 0));
  let upfrontPct = 100;
  if (installmentCount > 0) {
    const upfrontIn = prompt(
      en ? "Upfront share (30–90%, default 60):" : "首付比例（30–90%，默认 60）：",
      "60"
    );
    if (upfrontIn == null) return;
    upfrontPct = Math.max(30, Math.min(90, parseInt(upfrontIn, 10) || 60));
  }
  const appearanceIn = prompt(
    en ? "Bonus after 20 appearances (0 to omit):" : "出场 20 次后的附加奖金（填 0 表示无）：",
    String(Math.round(fee * 0.08))
  );
  if (appearanceIn == null) return;
  const appearanceBonus = Math.max(0, parseMoneyInput(appearanceIn));
  const sellOnIn = prompt(
    en ? "Sell-on share for the selling club (0–30%, default 10):" : "卖方二次转售分成（0–30%，默认 10）：",
    "10"
  );
  if (sellOnIn == null) return;
  const sellOnPct = Math.max(0, Math.min(30, parseInt(sellOnIn, 10) || 0));
  const paymentPlan = buildTransferPaymentPlan(fee, upfrontPct, installmentCount);
  if (
    !confirm(
      en
        ? `Submit an offer for ${deal.player.name}?\nFee ${formatMoney(fee)} · upfront ${formatMoney(paymentPlan.upfront)} · ${paymentPlan.installmentCount} installments\nAppearance bonus ${formatMoney(appearanceBonus)} · sell-on ${sellOnPct}%\nSigning bonus ${formatMoney(signingBonus)}\n${y} years · wage ${formatMoney(wage)}\nThe club and player will reply in stages.`
        : `向 ${deal.player.name} 提交报价？\n转会费 ${formatMoney(fee)} · 首付 ${formatMoney(paymentPlan.upfront)} · ${paymentPlan.installmentCount} 期\n出场奖金 ${formatMoney(appearanceBonus)} · 二次转售 ${sellOnPct}%\n签约奖 ${formatMoney(signingBonus)}\n${y} 年 · 周薪 ${formatMoney(wage)}\n俱乐部与球员将分阶段答复。`
    )
  ) {
    return;
  }
  const res = submitTransferNegotiation(world, playerId, fromClubId, {
    fee,
    years: y,
    wage,
    upfrontPct: paymentPlan.upfrontPct,
    installmentCount: paymentPlan.installmentCount,
    appearanceBonus,
    appearanceTarget: 20,
    sellOnPct,
  });
  toast(en && res.ok ? `Offer submitted for ${deal.player.name}` : res.msg);
  if (res.ok) {
    saveGame(world);
    refreshAll();
  }
}

function transferNegotiationStatus(negotiation, en) {
  const labels = {
    market_search: en ? "Listed · finding buyers" : "已挂牌 · 寻找买家",
    seller_review: en ? "Offer awaiting your decision" : "买方报价待处理",
    buyer_review: en ? "Buyer reviewing counter-offer" : "买方审核还价",
    club_review: en ? "Club reviewing offer" : "俱乐部审核报价",
    club_counter: en ? "Club counter-offer" : "俱乐部还价",
    player_review: en ? "Player reviewing contract" : "球员审核合同",
    player_counter: en ? "Player counter-offer" : "球员合同还价",
    completed: en ? "Completed" : "已成交",
    rejected: en ? "Rejected" : "已拒绝",
    cancelled: en ? "Cancelled" : "已取消",
  };
  return labels[negotiation.status] || negotiation.status;
}

function renderTransferNegotiations() {
  const box = $("#transfer-negotiations");
  if (!box) return;
  const en = getLang() === "en";
  const title = $("#transfer-negotiations-title");
  if (title) title.textContent = en ? "Transfer negotiations" : "转会谈判";
  const hint = $("#transfer-negotiations-hint");
  if (hint) {
    hint.textContent = en
      ? "Purchases and sales progress over several days. Club decisions, counter-offers, player terms, and final checks use the same live data."
      : "买入与出售均需数日推进；俱乐部决定、还价、球员意愿和成交复核读取同一份实时数据。";
  }
  const negotiations = listTransferNegotiations(world, { limit: 12 });
  if (!negotiations.length) {
    box.innerHTML = `<p class="muted" style="margin:0">${en ? "No negotiations yet." : "暂无转会谈判"}</p>`;
    return;
  }
  box.innerHTML = negotiations
    .map((negotiation) => {
      const seller = world.clubs?.find((club) => club.id === negotiation.sellerClubId);
      const buyer = world.clubs?.find((club) => club.id === negotiation.buyerClubId);
      const player = (world.clubs || [])
        .flatMap((club) => club.players || [])
        .find((candidate) => candidate.id === negotiation.playerId);
      const playerName = player?.name || negotiation.playerId;
      const sale = negotiation.kind === "user_sell";
      const waiting = sale
        ? negotiation.status === "market_search" || negotiation.status === "buyer_review" || negotiation.status === "player_review"
        : negotiation.status === "club_review" || negotiation.status === "player_review";
      const counter = negotiation.status === "club_counter" || negotiation.status === "player_counter";
      const actionHtml = sale && negotiation.status === "seller_review"
        ? `<div class="poach-actions">
            <button class="btn small primary" data-negotiation-accept="${escapeHtml(negotiation.id)}">${en ? "Accept" : "接受"}</button>
            <button class="btn small" data-negotiation-counter="${escapeHtml(negotiation.id)}">${en ? "Counter" : "还价"}</button>
            <button class="btn small" data-negotiation-reject="${escapeHtml(negotiation.id)}">${en ? "Reject" : "拒绝"}</button>
          </div>`
        : counter
        ? `<div class="poach-actions">
            <button class="btn small primary" data-negotiation-accept="${escapeHtml(negotiation.id)}">${en ? "Accept" : "接受"}</button>
            <button class="btn small" data-negotiation-reject="${escapeHtml(negotiation.id)}">${en ? "Walk away" : "退出"}</button>
          </div>`
        : waiting
          ? `<div class="poach-actions"><button class="btn small" data-negotiation-withdraw="${escapeHtml(negotiation.id)}">${en ? "Withdraw" : "撤回报价"}</button></div>`
          : "";
      const reply = waiting && negotiation.decisionDay
        ? en
          ? ` · reply by D${negotiation.decisionDay}`
          : ` · 预计 D${negotiation.decisionDay} 答复`
        : "";
      const reason = negotiation.reason && !en
        ? `<div class="muted" style="margin-top:0.2rem">${escapeHtml(negotiation.reason)}</div>`
        : "";
      const counterpart = sale
        ? buyer
          ? clubDisplayName(buyer)
          : en ? "Transfer market" : "转会市场"
        : seller ? clubDisplayName(seller) : negotiation.sellerClubId;
      const feePlan = buildTransferPaymentPlan(
        negotiation.fee,
        negotiation.upfrontPct,
        negotiation.installmentCount
      );
      const paymentTerms = feePlan.installmentCount > 0
        ? `${en ? "upfront" : "首付"} ${formatMoney(feePlan.upfront)} · ${feePlan.installmentCount}${en ? " installments" : " 期"}`
        : en ? "paid in full" : "一次付清";
      const clauses = [
        negotiation.appearanceBonus > 0 ? `${en ? "apps" : "出场"} ${formatMoney(negotiation.appearanceBonus)}` : "",
        negotiation.sellOnPct > 0 ? `${en ? "sell-on" : "转售"} ${negotiation.sellOnPct}%` : "",
      ].filter(Boolean).join(" · ");
      const terms = sale && negotiation.wage == null
        ? `${en ? "asking" : "挂牌价"} ${formatMoney(negotiation.askingFee || negotiation.fee)}`
        : `${en ? "fee" : "转会费"} ${formatMoney(negotiation.fee)} · ${paymentTerms}${clauses ? ` · ${clauses}` : ""} · ${negotiation.years}${en ? "y" : "年"} / ${en ? "wage" : "周薪"} ${formatMoney(negotiation.wage)}`;
      return `<div class="poach-row">
        <div>
          <strong>${escapeHtml(playerName)}</strong> · ${escapeHtml(counterpart)}
          <div class="muted">${escapeHtml(transferNegotiationStatus(negotiation, en))}${reply} · ${terms}</div>
          ${reason}
        </div>
        ${actionHtml}
      </div>`;
    })
    .join("");

  const handle = (id, action, options = {}) => {
    const target = negotiations.find((item) => item.id === id);
    if (!target) return;
    if (
      action === "accept" &&
      !confirm(en ? "Accept these terms? This may complete the transfer." : "确认接受这些条款？若为球员还价，转会将立即完成。")
    ) return;
    const res = respondTransferNegotiation(world, id, action, options);
    toast(en ? (res.ok ? "Negotiation updated" : res.msg) : res.msg);
    if (res.ok) {
      saveGame(world);
      refreshAll();
    }
  };
  box.querySelectorAll("[data-negotiation-accept]").forEach((button) => {
    button.onclick = () => handle(button.dataset.negotiationAccept, "accept");
  });
  box.querySelectorAll("[data-negotiation-reject]").forEach((button) => {
    button.onclick = () => handle(button.dataset.negotiationReject, "reject");
  });
  box.querySelectorAll("[data-negotiation-counter]").forEach((button) => {
    button.onclick = () => {
      const target = negotiations.find((item) => item.id === button.dataset.negotiationCounter);
      if (!target) return;
      const value = prompt(
        en ? `Current offer ${formatMoney(target.fee)}\nYour counter-offer:` : `当前报价 ${formatMoney(target.fee)}\n请输入还价：`,
        String(Math.round((target.fee || 0) * 1.08))
      );
      if (value == null) return;
      handle(target.id, "counter", { fee: parseMoneyInput(value) });
    };
  });
  box.querySelectorAll("[data-negotiation-withdraw]").forEach((button) => {
    button.onclick = () => handle(button.dataset.negotiationWithdraw, "withdraw");
  });
}

function scoutMissionCriteriaLabel(filters = {}, en = false) {
  const profiles = {
    development: en ? "development" : "培养潜力",
    first_team: en ? "first-team" : "即战力",
    expiring: en ? "expiring" : "合同将尽",
  };
  const position = filters.position || (en ? "all positions" : "全部位置");
  const budget = Number(filters.maxValue) > 0
    ? `${en ? "up to" : "预算"} ${formatMoney(Number(filters.maxValue))}`
    : en ? "no fee limit" : "不限转会费";
  return `${position} · ${profiles[filters.profile] || profiles.development} · ${budget}`;
}

function renderTransfer() {
  ensureTransferWindow(world);
  const open = isTransferWindowOpen(world);
  const statusEl = $("#transfer-window-status");
  if (statusEl) {
    statusEl.textContent = transferWindowLabel(world, getLang());
    statusEl.className = open ? "transfer-window-box open" : "transfer-window-box closed";
  }
  renderTransferNegotiations();

  // 球探任务 + 关注列表
  const enTr = getLang() === "en";
  ensureScoutMissions(world);
  const smStatus = $("#scout-mission-status");
  if (smStatus) {
    const active = (world.scoutMissions || []).find((m) => m.status === "active");
    smStatus.textContent = active
      ? enTr
        ? `Mission active · returns day ${active.doneDay} · ${scoutMissionCriteriaLabel(active.filters, true)}`
        : `任务进行中 · 第 ${active.doneDay} 天回报 · ${scoutMissionCriteriaLabel(active.filters)}`
      : enTr
        ? "No active mission — send scouts below."
        : "当前无任务 — 可派遣球探。";
  }
  document.querySelectorAll("[data-scout-mission]").forEach((btn) => {
    btn.disabled = (world.scoutMissions || []).some((mission) => mission.status === "active");
    btn.onclick = () => {
      const res = startScoutMission(world, btn.dataset.scoutMission, {
        position: $("#scout-mission-pos")?.value || "",
        profile: $("#scout-mission-profile")?.value || "development",
        maxValue: Number($("#scout-mission-budget")?.value) || 0,
      });
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });

  const watchEl = $("#scout-watch-list");
  if (watchEl) {
    const ids = world.scoutWatch || [];
    if (!ids.length) {
      watchEl.innerHTML = `<p class="muted" style="margin:0">${escapeHtml(
        enTr ? "No watched players — Inbox or missions add them." : "暂无关注（信箱/球探任务可添加）"
      )}</p>`;
    } else {
      const rows = [];
      for (const id of ids.slice(0, 12)) {
        for (const c of world.clubs) {
          const p = c.players.find((x) => x.id === id);
          if (p) {
            const knowledge = scoutPlayerSnapshot(world, p, getUserClub(world));
            rows.push(
              `<div class="scout-watch-row">${playerAvatarHtml(p, c, 32)} ${playerLinkHtml(p.id, p.name)}
                <span class="badge ${p.pos}">${escapeHtml(positionLabel(p.pos))}</span>
                <span class="muted">${escapeHtml(c.short || c.name)} · ${formatScoutOvr(world, p)} · ${formatScoutValue(world, p)} · ${knowledge.confidence}% · ${escapeHtml(scoutingFreshnessLabel(knowledge, enTr ? "en" : "zh"))}</span>
              </div>`
            );
            break;
          }
        }
      }
      watchEl.innerHTML = rows.join("") || `<p class="muted" style="margin:0">${enTr ? "Watched players left clubs." : "关注对象已离队"}</p>`;
    }
  }

  renderContractsLoansPanel();

  // 挖角报价
  const poachEl = $("#poach-bids");
  if (poachEl) {
    const bids = pendingPoachBids(world);
    if (!bids.length) {
      poachEl.innerHTML = `<p class="muted" style="margin:0">${enTr ? "No offers from other clubs." : "暂无来自其他俱乐部的报价"}</p>`;
    } else {
      poachEl.innerHTML = bids
        .map(
          (b) => `<div class="poach-row">
          <div>
            <strong>${escapeHtml(clubNameById(b.buyerId, b.buyerName))}</strong> ${enTr ? "offers" : "报价"}
            <strong>${formatMoney(b.fee)}</strong> ${enTr ? "for" : "求购"}
            <strong>${playerLinkHtml(b.playerId, b.playerName)}</strong>
            <span class="muted">${enTr ? "(" : "（"}${escapeHtml(positionLabel(b.pos))} · ${b.ovr} · ${enTr ? `${Math.max(0, b.expiresDay - world.day)} days left` : `剩 ${Math.max(0, b.expiresDay - world.day)} 天`}${enTr ? ")" : "）"}</span>
          </div>
          <div class="poach-actions">
            <button class="btn small primary" data-poach-accept="${b.id}" ${!open ? "disabled" : ""}>${enTr ? "Accept" : "接受"}</button>
            <button class="btn small" data-poach-reject="${b.id}">${enTr ? "Reject" : "拒绝"}</button>
          </div>
        </div>`
        )
        .join("");
      poachEl.querySelectorAll("[data-poach-accept]").forEach((btn) => {
        btn.onclick = () => {
          if (!confirm(enTr ? "Accept the offer and sell this player?" : "确认接受报价并放走球员？")) return;
          const res = acceptPoachBid(world, btn.dataset.poachAccept);
          toast(enTr ? (res.ok ? "Offer accepted" : "Unable to accept offer") : res.msg);
          if (res.ok) {
            saveGame(world);
            refreshAll();
          }
        };
      });
      poachEl.querySelectorAll("[data-poach-reject]").forEach((btn) => {
        btn.onclick = () => {
          const res = rejectPoachBid(world, btn.dataset.poachReject);
          toast(enTr ? (res.ok ? "Offer rejected" : "Unable to reject offer") : res.msg);
          if (res.ok) {
            saveGame(world);
            refreshAll();
          }
        };
      });
    }
  }

  const pos = $("#filter-pos").value;
  let market = getMarketPlayers(world, pos);
  const watchOnly = $("#filter-watch-only")?.checked;
  if (watchOnly) {
    const set = new Set(world.scoutWatch || []);
    market = market.filter(({ player: p }) => set.has(p.id));
  }
  const mt = $("#market-table tbody");
  const userClub = getUserClub(world);
  ensureStaff(userClub);
  const buyDisabled = !open || world.sacked;
  const activeNegotiationIds = new Set(
    listTransferNegotiations(world, { limit: 100 })
      .filter((negotiation) => findActiveTransferNegotiation(world, negotiation.playerId))
      .map((negotiation) => negotiation.playerId)
  );
  const activeDealIds = new Set(
    listDealNegotiations(world, { limit: 100 })
      .filter((negotiation) => findActiveDealNegotiation(world, negotiation.playerId))
      .map((negotiation) => negotiation.playerId)
  );
  const en = getLang() === "en";
  const watchFilter = $("#filter-watch-only");
  if (watchFilter && !watchFilter.dataset.bound) {
    watchFilter.dataset.bound = "1";
    watchFilter.addEventListener("change", () => renderTransfer());
  }
  mt.innerHTML = market
    .map(({ player: p, club, scouting }) => {
      const valTxt = formatScoutValue(world, p);
      const ovrTxt = formatScoutOvr(world, p);
      const negotiating = activeNegotiationIds.has(p.id);
      const loanable = !p.loan && !buyDisabled && !negotiating && !activeDealIds.has(p.id);
      return `<tr>
        <td class="name-with-avatar">${playerAvatarHtml(p, club, 32)} <span>${playerLinkHtml(p.id, p.name)}</span></td>
        <td>${nationLabel(p)}</td>
        <td><span class="badge ${p.pos}">${escapeHtml(positionLabel(p.pos))}</span></td>
        <td class="${ovrClass(scouting.ovrEstimate)}">${ovrTxt}</td>
        <td>${p.age}</td>
        <td>${clubLinkHtml(club.id, club.short)}</td>
        <td title="${escapeHtml(en ? "Scouted value range" : "球探估值区间")}">${valTxt}</td>
        <td class="tr-actions">
          <button class="btn small" data-player-link="${p.id}">${en ? "Info" : "详情"}</button>
          <button class="btn small primary" data-buy="${p.id}" data-from="${club.id}" ${
            buyDisabled || negotiating ? "disabled" : ""
          }>${negotiating ? (en ? "In talks" : "谈判中") : open ? (en ? "Bid" : "谈判买入") : en ? "Closed" : "窗关"}</button>
          <button class="btn small" data-loan-in="${p.id}" data-from="${club.id}" ${
            loanable ? "" : "disabled"
          }>${open ? (en ? "Loan" : "租入") : en ? "Closed" : "窗关"}</button>
        </td>
      </tr>`;
    })
    .join("");

  mt.querySelectorAll("[data-buy]").forEach((b) => {
    b.onclick = () => openBuyNegotiator(b.dataset.buy, b.dataset.from);
  });
  mt.querySelectorAll("[data-loan-in]").forEach((b) => {
    b.onclick = () => doLoanIn(b.dataset.loanIn, b.dataset.from);
  });

  const club = getUserClub(world);
  const st = $("#sell-table tbody");
  const sorted = [...club.players].sort((a, b) => b.ovr - a.ovr);
  st.innerHTML = sorted
    .map((p) => {
      const onLoan = !!p.loan;
      const saleNegotiation = findActiveSaleNegotiation(world, p.id);
      const dealNegotiation = findActiveDealNegotiation(world, p.id);
      return `<tr>
      <td class="name-with-avatar">${playerAvatarHtml(p, club, 32)} <span>${playerLinkHtml(p.id, p.name)}${onLoan ? ` <span class="badge loan">${en ? "loan" : "租"}</span>` : ""}</span></td>
      <td>${nationLabel(p)}</td>
      <td><span class="badge ${p.pos}">${escapeHtml(positionLabel(p.pos))}</span></td>
      <td class="${ovrClass(p.ovr)}">${p.ovr}</td>
      <td>${formatMoney(p.value)}</td>
      <td class="tr-actions">
        <button class="btn small" data-player-link="${p.id}">${en ? "Info" : "详情"}</button>
        <button class="btn small danger" data-sell="${p.id}" ${
          buyDisabled || onLoan || saleNegotiation || dealNegotiation ? "disabled" : ""
        }>${onLoan ? (en ? "On loan" : "租借中") : saleNegotiation ? (en ? "Listed" : "已挂牌") : dealNegotiation ? (en ? "In talks" : "谈判中") : open ? (en ? "List" : "挂牌") : en ? "Closed" : "窗关"}</button>
        <button class="btn small" data-loan-out="${p.id}" ${
          buyDisabled || onLoan || saleNegotiation || dealNegotiation ? "disabled" : ""
        }>${open && !onLoan && !saleNegotiation && !dealNegotiation ? (en ? "Loan out" : "外租") : en ? "—" : "—"}</button>
      </td>
    </tr>`;
    })
    .join("");

  st.querySelectorAll("[data-sell]").forEach((b) => {
    b.onclick = () => {
      const player = club.players.find((candidate) => candidate.id === b.dataset.sell);
      if (!player) return;
      const input = prompt(
        en ? `${player.name}\nEstimated value ${formatMoney(player.value)}\nAsking price:` : `${player.name}\n参考身价 ${formatMoney(player.value)}\n请输入挂牌价：`,
        String(player.value || 0)
      );
      if (input == null) return;
      const askingFee = parseMoneyInput(input);
      if (!confirm(en ? `List ${player.name} for ${formatMoney(askingFee)}?` : `以 ${formatMoney(askingFee)} 挂牌 ${player.name}？`)) return;
      const res = sellPlayer(world, b.dataset.sell, { askingFee });
      toast(en ? (res.ok ? "Player listed" : res.msg) : res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });
  st.querySelectorAll("[data-loan-out]").forEach((b) => {
    b.onclick = () => doLoanOut(b.dataset.loanOut);
  });
}

/** 转会页：合同待办 + 外租/租入列表 */
function dealNegotiationStatus(negotiation, en) {
  const labels = {
    party_review: en ? "Player reviewing renewal" : "球员审核续约",
    party_counter: en ? "Renewal counter-offer" : "球员续约还价",
    club_review: en ? "Parent club reviewing loan" : "母队审核租借",
    club_counter: en ? "Parent club counter-offer" : "母队租借还价",
    market_search: en ? "Finding a loan club" : "寻找租入方",
    offer_review: en ? "Loan offer awaiting decision" : "租借报价待处理",
    buyer_review: en ? "Loan club reviewing counter" : "租入方审核还价",
    player_review: en ? "Player reviewing loan" : "球员审核租借",
    completed: en ? "Completed" : "已完成",
    rejected: en ? "Rejected" : "已拒绝",
    cancelled: en ? "Cancelled" : "已取消",
  };
  return labels[negotiation.status] || negotiation.status;
}

function renderContractsLoansPanel() {
  const box = $("#contracts-loans-panel");
  if (!box || !world) return;
  const club = getUserClub(world);
  if (!club) {
    box.innerHTML = "";
    return;
  }
  const en = getLang() === "en";
  const negotiations = listDealNegotiations(world, { limit: 10 });
  const activePlayerIds = new Set(
    negotiations.filter((item) => findActiveDealNegotiation(world, item.playerId)?.id === item.id).map((item) => item.playerId)
  );
  const attention = club.players
    .filter((p) => !p.loan && needsContractAttention(p))
    .sort((a, b) => (a.contractYears || 0) - (b.contractYears || 0) || b.ovr - a.ovr);
  const { out, inn } = listUserLoans(world);

  const renewRows = attention.length
    ? attention
        .map((p) => {
          const offer = previewRenew(world, p.id)?.offer;
          const tag = p._needsRenew
            ? en
              ? "Must renew"
              : "待续约"
            : en
              ? "Expiring"
              : "将尽";
          return `<div class="cl-row">
            <div class="cl-main">
              <strong>${playerLinkHtml(p.id, p.name)}</strong>
              <span class="badge ${p.pos}">${escapeHtml(positionLabel(p.pos))}</span>
              <span class="muted">${p.ovr} · ${p.contractYears ?? 0}${en ? "y" : "年"} · ${formatMoney(p.wage)}</span>
              <span class="badge contract-short">${escapeHtml(tag)}</span>
            </div>
            <div class="cl-actions">
              <button type="button" class="btn small primary" data-cl-renew="${p.id}" ${activePlayerIds.has(p.id) ? "disabled" : ""}>${escapeHtml(activePlayerIds.has(p.id) ? (en ? "In talks" : "谈判中") : t("contract.renew") || (en ? "Renew" : "续约"))}</button>
              <button type="button" class="btn small danger" data-cl-term="${p.id}" ${activePlayerIds.has(p.id) ? "disabled" : ""}>${escapeHtml(t("contract.terminate") || (en ? "Release" : "解约"))}</button>
            </div>
            ${
              offer
                ? `<div class="cl-offer muted">${en ? "Offer" : "报价"}: ${offer.years}${en ? "y" : "年"} · ${formatMoney(offer.newWage)} · ${en ? "bonus" : "奖"} ${formatMoney(offer.fee)}</div>`
                : ""
            }
          </div>`;
        })
        .join("")
    : `<p class="muted" style="margin:0">${en ? "No short contracts needing attention." : "暂无短约/待续约球员。"}</p>`;

  const outRows = out.length
    ? out
        .map(
          (l) => `<div class="cl-row">
          <div class="cl-main">
            <strong>${playerLinkHtml(l.playerId, l.playerName)}</strong>
            <span class="muted">→ ${escapeHtml(l.toName)} · ${escapeHtml(en ? (l.untilDay >= 9999 ? "End of season" : `D${l.untilDay}`) : l.untilLabel)}</span>
          </div>
          <div class="cl-actions">
            <button type="button" class="btn small" data-cl-recall="${l.playerId}">${escapeHtml(t("contract.recall") || (en ? "Recall" : "召回"))}</button>
          </div>
        </div>`
        )
        .join("")
    : `<p class="muted" style="margin:0">${en ? "No players out on loan." : "暂无外租球员。"}</p>`;

  const inRows = inn.length
    ? inn
        .map(
          (l) => `<div class="cl-row">
          <div class="cl-main">
            <strong>${playerLinkHtml(l.playerId, l.playerName)}</strong>
            <span class="muted">${en ? "from" : "来自"} ${escapeHtml(l.fromName)} · ${escapeHtml(en ? (l.untilDay >= 9999 ? "End of season" : `D${l.untilDay}`) : l.untilLabel)}</span>
          </div>
        </div>`
        )
        .join("")
    : `<p class="muted" style="margin:0">${en ? "No incoming loans." : "暂无租入球员。"}</p>`;

  const negotiationRows = negotiations.length
    ? negotiations.map((negotiation) => {
        const active = !!findActiveDealNegotiation(world, negotiation.playerId) &&
          findActiveDealNegotiation(world, negotiation.playerId)?.id === negotiation.id;
        const actionable = negotiation.status === "party_counter" || negotiation.status === "club_counter" || negotiation.status === "offer_review";
        const waiting = active && !actionable;
        const kind = negotiation.kind === "renewal"
          ? en ? "Renewal" : "续约"
          : negotiation.kind === "loan_in"
            ? en ? "Loan in" : "租入"
            : en ? "Loan out" : "外租";
        const terms = negotiation.kind === "renewal"
          ? `${negotiation.years}${en ? "y" : "年"} · ${formatMoney(negotiation.wage)} · ${en ? "bonus" : "奖"} ${formatMoney(negotiation.signingBonus)}`
          : `${en ? "fee" : "租借费"} ${formatMoney(negotiation.fee)} · ${en ? "wages" : "薪资"} ${Math.round((negotiation.wageShare || 0) * 100)}%`;
        const actions = actionable
          ? `<div class="cl-actions">
              <button type="button" class="btn small primary" data-deal-accept="${escapeHtml(negotiation.id)}">${en ? "Accept" : "接受"}</button>
              ${negotiation.kind === "loan_out" && negotiation.status === "offer_review" ? `<button type="button" class="btn small" data-deal-counter="${escapeHtml(negotiation.id)}">${en ? "Counter" : "还价"}</button>` : ""}
              <button type="button" class="btn small" data-deal-reject="${escapeHtml(negotiation.id)}">${en ? "Walk away" : "退出"}</button>
            </div>`
          : waiting
            ? `<div class="cl-actions"><button type="button" class="btn small" data-deal-withdraw="${escapeHtml(negotiation.id)}">${en ? "Withdraw" : "撤回"}</button></div>`
            : "";
        const reply = waiting && negotiation.decisionDay
          ? ` · ${en ? "reply by" : "预计答复"} D${negotiation.decisionDay}`
          : "";
        return `<div class="cl-row">
          <div class="cl-main"><strong>${escapeHtml(negotiation.playerName || negotiation.playerId)}</strong><span class="badge">${escapeHtml(kind)}</span></div>
          <div class="muted">${escapeHtml(dealNegotiationStatus(negotiation, en))}${reply} · ${terms}</div>
          ${actions}
        </div>`;
      }).join("")
    : `<p class="muted" style="margin:0">${en ? "No contract or loan negotiations yet." : "暂无续约或租借谈判。"}</p>`;

  box.innerHTML = `
    <div class="cl-section">
      <h3>${en ? "Contract & loan negotiations" : "续约与租借谈判"}</h3>
      ${negotiationRows}
    </div>
    <div class="cl-section">
      <h3>${escapeHtml(t("contract.attention") || (en ? "Contracts needing attention" : "合同待办"))}</h3>
      ${renewRows}
    </div>
    <div class="cl-section grid-2-loans">
      <div>
        <h3>${escapeHtml(t("contract.loansOut") || (en ? "Loaned out" : "外租中"))}</h3>
        ${outRows}
      </div>
      <div>
        <h3>${escapeHtml(t("contract.loansIn") || (en ? "Loaned in" : "租入中"))}</h3>
        ${inRows}
      </div>
    </div>
  `;

  box.querySelectorAll("[data-cl-renew]").forEach((b) => {
    b.onclick = () => doRenewPlayer(b.dataset.clRenew);
  });
  box.querySelectorAll("[data-cl-term]").forEach((b) => {
    b.onclick = () => doTerminatePlayer(b.dataset.clTerm);
  });
  box.querySelectorAll("[data-cl-recall]").forEach((b) => {
    b.onclick = () => doRecallLoan(b.dataset.clRecall);
  });
  const handleDeal = (id, action, options = {}) => {
    const result = respondDealNegotiation(world, id, action, options);
    toast(en ? (result.ok ? "Negotiation updated" : result.msg) : result.msg);
    if (result.ok) {
      saveGame(world);
      refreshAll();
    }
  };
  box.querySelectorAll("[data-deal-accept]").forEach((button) => {
    button.onclick = () => handleDeal(button.dataset.dealAccept, "accept");
  });
  box.querySelectorAll("[data-deal-reject]").forEach((button) => {
    button.onclick = () => handleDeal(button.dataset.dealReject, "reject");
  });
  box.querySelectorAll("[data-deal-withdraw]").forEach((button) => {
    button.onclick = () => handleDeal(button.dataset.dealWithdraw, "withdraw");
  });
  box.querySelectorAll("[data-deal-counter]").forEach((button) => {
    button.onclick = () => {
      const target = negotiations.find((item) => item.id === button.dataset.dealCounter);
      if (!target) return;
      const feeIn = prompt(en ? "Counter loan fee:" : "租借费还价：", String(target.fee || 0));
      if (feeIn == null) return;
      const shareIn = prompt(en ? "Host wage share (50–100):" : "对方承担周薪比例（50–100）：", String(Math.round((target.wageShare || 0.75) * 100)));
      if (shareIn == null) return;
      handleDeal(target.id, "counter", {
        fee: parseMoneyInput(feeIn),
        wageShare: Math.max(0.5, Math.min(1, (parseInt(shareIn, 10) || 75) / 100)),
      });
    };
  });
}

/** 赛程唯一键（无 id 时用） */
function fixtureKey(f) {
  if (!f) return "";
  return `${f.home}|${f.away}|${f.day}|${f.round ?? ""}|${f.roundLabel || ""}`;
}

function fixtureRoundDisplay(fixture) {
  if (!fixture) return "—";
  if (getLang() !== "en") return fixture.roundLabel || `第 ${fixture.round} 轮`;
  return fixture.competition === "cup"
    ? fixture.roundLabelEn || "Cup"
    : `Round ${fixture.round}`;
}

function findFixtureByKey(key) {
  if (!world || !key) return null;
  return (world.fixtures || []).find((f) => fixtureKey(f) === key) || null;
}

function renderFixtures() {
  const uid = world.userClubId;
  const list = world.fixtures.filter((f) => f.home === uid || f.away === uid);
  const tbody = $("#fixtures-table tbody");
  const en = getLang() === "en";
  tbody.innerHTML = list
    .map((f) => {
      const home = world.clubs.find((c) => c.id === f.home);
      const away = world.clubs.find((c) => c.id === f.away);
      const score = f.played ? `${f.homeGoals} - ${f.awayGoals}` : "-";
      let status = t("fix.pending");
      if (f.played) status = t("fix.played");
      else if (f.day === world.day) status = en ? "Today" : "今日";
      else if (f.day < world.day) status = en ? "Due" : "待踢";
      // 已赛且有报告 → 可回看
      let action = status;
      if (f.played && f.matchReport) {
        action = `<button type="button" class="btn tiny fix-report-btn" data-fixture-key="${escapeHtml(fixtureKey(f))}" title="${escapeHtml(t("fix.viewReport") || "战报")}">${escapeHtml(t("fix.viewReport") || (en ? "Report" : "战报"))}</button>`;
      } else if (f.played && f.events?.length) {
        // 旧档无完整 report：尽量用事件拼简易报告入口
        action = `<button type="button" class="btn tiny fix-report-btn" data-fixture-key="${escapeHtml(fixtureKey(f))}" title="${escapeHtml(t("fix.viewReport") || "战报")}">${escapeHtml(t("fix.viewReport") || (en ? "Report" : "战报"))}</button>`;
      }
      return `<tr class="${f.day === world.day && !f.played ? "me" : ""} ${f.played ? "played" : ""}">
        <td>${f.round}</td>
        <td>D${f.day}</td>
        <td>${clubLinkHtml(home.id, home.name)}</td>
        <td class="fix-score">${score}</td>
        <td>${clubLinkHtml(away.id, away.name)}</td>
        <td class="fix-action">${action}</td>
      </tr>`;
    })
    .join("");
}

/**
 * 从赛程打开旧战报（只读回顾，不重新模拟）
 */
async function openPastMatchReport(key) {
  const fixture = findFixtureByKey(key);
  if (!fixture || !fixture.played) {
    toast(getLang() === "en" ? "No match report" : "暂无战报");
    return;
  }
  // 旧档可能只有 events 无比分报告
  let report = fixture.matchReport;
  if (!report) {
    report = buildLegacyReportFromFixture(fixture);
  }
  if (!report) {
    toast(getLang() === "en" ? "Report not saved for this match" : "本场未保存完整战报（旧存档）");
    return;
  }

  pendingMatch = fixture;
  matchState = null;
  pendingSubs = [];
  matchPlayback.reviewMode = true;
  document.querySelector(".match-layout")?.classList.remove("match-report-only");

  const home = world.clubs.find((c) => c.id === fixture.home);
  const away = world.clubs.find((c) => c.id === fixture.away);
  setupMatchScoreboard(home, away, fixture);
  setMatchScore(fixture.homeGoals ?? report.homeGoals ?? 0, fixture.awayGoals ?? report.awayGoals ?? 0);
  setMatchMinute(90, { reset: true });
  setMatchLiveState("ft");
  updateLiveStats(report);
  setMatchStatsPanelOpen(true);
  $("#match-log").innerHTML = "";
  resetMatchPlayback({ keepStepMode: true });
  matchPlayback.reviewMode = true;

  // 从 events 重建进球回看列表
  rebuildGoalReplaysFromFixture(fixture);
  // 事件流摘要
  for (const ev of fixture.events || []) {
    if (ev.type === "tick" || !ev.text) continue;
    if (ev.type === "goal") {
      const gi = matchPlayback.goals.findIndex(
        (g) => g.ev.minute === ev.minute && g.ev.playerId === ev.playerId
      );
      appendMatchEvent(ev, { goalIndex: gi >= 0 ? gi : undefined });
    } else {
      appendMatchEvent(ev);
    }
  }

  hideHtPanel();
  hidePrematchBriefPanel();
  setLiveTacBarVisible(false);
  await ensureMatchPitch(true);
  if (matchView) {
    matchView.phase = "pause";
    matchView.setBanner(getLang() === "en" ? "FULL-TIME" : "完场回顾", "info");
    matchView._syncClickable?.();
  }

  showMatchReport(report, { review: true });
  if (report.ratings?.motm && matchView?.highlightMotm) {
    matchView.highlightMotm(report.ratings.motm);
  }

  $("#btn-sim-fast").disabled = true;
  $("#btn-sim-live").disabled = true;
  const inst = $("#btn-sim-instant");
  if (inst) inst.disabled = true;
  $("#btn-match-continue").disabled = false;
  $("#btn-match-continue").textContent =
    t("match.backToClub") || (getLang() === "en" ? "Back" : "返回俱乐部");
  matchPlayback.controlsEnabled = false;
  updateMatchPlaybackUI();
  showScreen("match");
  toast(getLang() === "en" ? "Match report" : "赛后战报");
}

/** 旧档无 matchReport 时从 events 拼简易报告 */
function buildLegacyReportFromFixture(f) {
  if (!f?.played) return null;
  const home = world.clubs.find((c) => c.id === f.home);
  const away = world.clubs.find((c) => c.id === f.away);
  if (!home || !away) return null;
  const events = f.events || [];
  const scorers = events
    .filter((e) => e.type === "goal")
    .map((e) => ({
      minute: e.minute,
      teamId: e.teamId,
      playerId: e.playerId,
      text: e.text,
      penalty: !!e.penalty,
    }));
  const narrative = [
    `${home.short || home.name} ${f.homeGoals ?? 0} - ${f.awayGoals ?? 0} ${away.short || away.name}`,
  ];
  if (scorers.length) {
    narrative.push(
      getLang() === "en"
        ? `${scorers.length} goal(s) in this match.`
        : `本场共 ${scorers.length} 粒进球。`
    );
  }
  narrative.push(
    getLang() === "en"
      ? "Detailed xG/ratings unavailable for older saves."
      : "旧存档未保存完整 xG/评分，仅显示比分与事件。"
  );
  return {
    score: `${f.homeGoals ?? 0} - ${f.awayGoals ?? 0}`,
    homeGoals: f.homeGoals ?? 0,
    awayGoals: f.awayGoals ?? 0,
    weather: f.weather ? { key: f.weather, name: f.weather, icon: "⚽" } : null,
    derby: !!f.derby,
    bigMatch: false,
    home: {
      name: home.name,
      short: home.short,
      shots: 0,
      shotsOn: 0,
      xg: 0,
      possession: 50,
      corners: 0,
      fouls: 0,
      yellows: 0,
      reds: 0,
      saves: 0,
      woodwork: 0,
    },
    away: {
      name: away.name,
      short: away.short,
      shots: 0,
      shotsOn: 0,
      xg: 0,
      possession: 50,
      corners: 0,
      fouls: 0,
      yellows: 0,
      reds: 0,
      saves: 0,
      woodwork: 0,
    },
    scorers,
    ratings: null,
    narrative,
  };
}

function rebuildGoalReplaysFromFixture(fixture) {
  matchPlayback.goals = [];
  let hg = 0;
  let ag = 0;
  for (const ev of fixture.events || []) {
    if (ev.type !== "goal") continue;
    if (ev.teamId === fixture.home) hg++;
    else ag++;
    matchPlayback.goals.push({
      ev: { ...ev },
      snap: { homeGoals: hg, awayGoals: ag, minute: ev.minute },
      fixture,
    });
  }
}

// ---------- Day / Match ----------
function captureAdvanceSnapshot() {
  const club = world ? getUserClub(world) : null;
  const players = new Map();
  for (const player of club?.players || []) {
    players.set(player.id, {
      name: player.name,
      injured: Math.max(0, Number(player.injured) || 0),
      suspended: Math.max(0, Number(player.suspendedMatches) || 0),
      fitness: Math.round(Number(player.fitness) || 0),
      morale: Math.round(Number(player.morale) || 0),
    });
  }
  const values = [...players.values()];
  const average = (key) => values.length
    ? Math.round(values.reduce((sum, item) => sum + item[key], 0) / values.length)
    : 0;
  return {
    day: Number(world?.day) || 0,
    money: Number(club?.money) || 0,
    inbox: world ? listInbox(world, { pendingOnly: true, limit: 500 }).length : 0,
    averageFitness: average("fitness"),
    averageMorale: average("morale"),
    players,
  };
}

function buildAdvanceDigest(before, events, days = 1) {
  const after = captureAdvanceSnapshot();
  const en = getLang() === "en";
  const items = [];
  const add = (item) => {
    if (!item?.title || items.some((current) => current.title === item.title)) return;
    items.push(item);
  };
  const names = (list) => list.slice(0, 3).map((item) => item.name).join(en ? ", " : "、");
  const extra = (list) => list.length > 3 ? (en ? ` +${list.length - 3}` : ` 等 ${list.length} 人`) : "";

  const newlyInjured = [];
  const recovered = [];
  const newlySuspended = [];
  for (const [id, current] of after.players) {
    const previous = before?.players?.get(id);
    if (!previous) continue;
    if (previous.injured <= 0 && current.injured > 0) newlyInjured.push(current);
    if (previous.injured > 0 && current.injured <= 0) recovered.push(current);
    if (current.suspended > previous.suspended) newlySuspended.push(current);
  }
  if (newlyInjured.length) {
    add({
      severity: "critical",
      icon: "🚑",
      title: en ? `${newlyInjured.length} new injury case(s)` : `新增 ${newlyInjured.length} 名伤员`,
      detail: `${names(newlyInjured)}${extra(newlyInjured)}`,
    });
  }
  if (newlySuspended.length) {
    add({
      severity: "warning",
      icon: "🟥",
      title: en ? `${newlySuspended.length} new suspension(s)` : `新增 ${newlySuspended.length} 人停赛`,
      detail: `${names(newlySuspended)}${extra(newlySuspended)}`,
    });
  }
  if (recovered.length) {
    add({
      severity: "info",
      icon: "✅",
      title: en ? `${recovered.length} player(s) returned from injury` : `${recovered.length} 名球员伤愈`,
      detail: `${names(recovered)}${extra(recovered)}`,
    });
  }

  const fitnessDelta = after.averageFitness - (before?.averageFitness || 0);
  if (Math.abs(fitnessDelta) >= 2) {
    add({
      severity: fitnessDelta < 0 ? "warning" : "info",
      icon: "💪",
      title: en ? `Squad fitness ${fitnessDelta > 0 ? "+" : ""}${fitnessDelta}` : `全队平均体能 ${fitnessDelta > 0 ? "+" : ""}${fitnessDelta}`,
      detail: en ? `Now ${after.averageFitness}% after training and recovery.` : `训练与恢复结算后，当前为 ${after.averageFitness}%。`,
    });
  }
  const moraleDelta = after.averageMorale - (before?.averageMorale || 0);
  if (Math.abs(moraleDelta) >= 2) {
    add({
      severity: moraleDelta < 0 ? "warning" : "info",
      icon: "🙂",
      title: en ? `Squad morale ${moraleDelta > 0 ? "+" : ""}${moraleDelta}` : `全队平均士气 ${moraleDelta > 0 ? "+" : ""}${moraleDelta}`,
      detail: en ? `Now ${after.averageMorale}.` : `当前平均士气为 ${after.averageMorale}。`,
    });
  }

  const moneyDelta = after.money - (before?.money || 0);
  if (moneyDelta !== 0) {
    add({
      severity: moneyDelta < 0 ? "warning" : "info",
      icon: "💶",
      title: en ? `Cash ${moneyDelta > 0 ? "+" : ""}${formatMoney(moneyDelta)}` : `现金变化 ${moneyDelta > 0 ? "+" : ""}${formatMoney(moneyDelta)}`,
      detail: en ? `Current balance ${formatMoney(after.money)}; see the ledger for the causes.` : `当前余额 ${formatMoney(after.money)}，具体原因可查看财政流水。`,
    });
  }

  const inboxDelta = after.inbox - (before?.inbox || 0);
  if (inboxDelta > 0) {
    add({
      severity: "warning",
      icon: "✉️",
      title: en ? `${inboxDelta} new decision(s)` : `新增 ${inboxDelta} 项待办`,
      detail: en ? `${after.inbox} unresolved inbox item(s) in total.` : `信箱现有 ${after.inbox} 项未解决待办。`,
    });
  }

  for (const line of advanceEventLines(events).sort((a, b) => b.priority - a.priority)) {
    add({
      severity: line.priority >= 4 ? "critical" : line.priority >= 3 ? "warning" : "info",
      icon: line.icon,
      title: line.text,
      detail: `D${line.day}`,
    });
  }
  if (!items.length) {
    add({
      severity: "info",
      icon: "✓",
      title: en ? "No major changes" : "没有重大变化",
      detail: en ? "Routine training, recovery and club operations were completed." : "已完成常规训练、恢复与俱乐部日常运营。",
    });
  }
  const rank = { critical: 3, warning: 2, info: 1 };
  items.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0));
  return {
    startDay: before?.day ?? after.day,
    endDay: after.day,
    days: Math.max(1, Number(days) || after.day - (before?.day || after.day) || 1),
    items: items.slice(0, 8),
  };
}

/**
 * 把 advanceDay() 返回的事件转成可展示的行
 * @returns {Array<{day:number, icon:string, text:string, priority:number}>}
 */
function advanceEventLines(events) {
  if (!Array.isArray(events) || !events.length) return [];
  const en = getLang() === "en";
  const lines = [];
  for (const ev of events) {
    if (!ev || !ev.type) continue;
    const day = ev.day ?? world?.day ?? 0;
    switch (ev.type) {
      case "transfer_window": {
        const map = {
          summer_open: en ? "Summer transfer window is open" : "夏季转会窗开启",
          winter_open: en ? "Winter transfer window is open" : "冬季转会窗开启",
          closed: en ? "Transfer window has closed" : "转会窗已关闭",
        };
        lines.push({ day, icon: "📅", text: map[ev.phase] || (en ? "Transfer window update" : "转会窗变动"), priority: 3 });
        break;
      }
      case "board_warning":
        lines.push({
          day,
          icon: "⚠️",
          text: en
            ? `Board warning ${ev.warnings}/${ev.maxWarnings}`
            : `董事会警告 ${ev.warnings}/${ev.maxWarnings}`,
          priority: 4,
        });
        break;
      case "player_unhappy":
        lines.push({
          day,
          icon: "💬",
          text: en ? `${ev.player} wants a word` : `${ev.player} 要求与你谈话`,
          priority: 3,
        });
        break;
      case "facility_completed": {
        const name =
          ev.facility === "stadium"
            ? en ? "Stadium" : "球场"
            : ev.facility === "training"
              ? en ? "Training ground" : "训练场"
              : en ? "Facility" : "设施";
        lines.push({ day, icon: "🏟️", text: en ? `${name} upgrade completed` : `${name}扩建完工`, priority: 3 });
        break;
      }
      case "injury_wave":
        lines.push({
          day,
          icon: "🚑",
          text: en ? `${ev.count} players in the treatment room` : `伤病潮：${ev.count} 人在治疗中`,
          priority: 3,
        });
        break;
      case "youth_recruitment":
        lines.push({
          day,
          icon: "🎓",
          text: en
            ? `Youth intake: ${ev.count} newcomer(s)${ev.avgPotential ? `, avg potential ${ev.avgPotential}` : ""}`
            : `青训招募 ${ev.count} 名新人${ev.avgPotential ? `，平均潜力 ${ev.avgPotential}` : ""}`,
          priority: 2,
        });
        break;
      case "loan_returned":
        lines.push({
          day,
          icon: "🔁",
          text: en ? `${ev.count} loanee(s) returned` : `${ev.count} 名租借球员归队`,
          priority: 2,
        });
        break;
      case "ai_squad_moves": {
        const transfer = Number(ev.types?.transfer) || 0;
        const loan = Number(ev.types?.loan) || 0;
        const release = Number(ev.types?.release) || 0;
        const parts = en
          ? [
              transfer ? `${transfer} transfer${transfer === 1 ? "" : "s"}` : "",
              loan ? `${loan} loan${loan === 1 ? "" : "s"}` : "",
              release ? `${release} release${release === 1 ? "" : "s"}` : "",
            ].filter(Boolean)
          : [
              transfer ? `${transfer} 笔转会` : "",
              loan ? `${loan} 笔租借` : "",
              release ? `${release} 人解约` : "",
            ].filter(Boolean);
        lines.push({
          day,
          icon: "↔",
          text: en ? `AI squad movement: ${parts.join(", ")}` : `AI 阵容流动：${parts.join("、")}`,
          priority: 2,
        });
        break;
      }
      case "international_break": {
        const callups = Number(ev.callups) || 0;
        lines.push({
          day,
          icon: "🌍",
          text: en
            ? callups
              ? `International break · ${callups} of your players featured`
              : "International break"
            : callups
              ? `国际比赛日 · 你有 ${callups} 人出场`
              : "国际比赛日",
          priority: 2,
        });
        for (const item of ev.injuries || []) {
          lines.push({
            day,
            icon: "🏥",
            text: en
              ? `${item.playerName} returned injured from national duty (${item.labelEn} · ~${item.days}d)`
              : `${item.playerName} 从国家队带伤回队（${item.label} · 约 ${item.days} 天）`,
            priority: 3,
          });
        }
        break;
      }
      case "key_matches":
        for (const m of ev.matches || []) {
          lines.push({
            day,
            icon: m.derby ? "🔥" : "⚽",
            text: `${m.home} ${m.homeGoals}-${m.awayGoals} ${m.away}${
              m.derby ? (en ? " (derby)" : "（德比）") : ""
            }`,
            priority: 1,
          });
        }
        break;
      case "manager_dismissal":
        lines.push({
          day,
          icon: "📢",
          text: en
            ? `${clubNameById(ev.clubId)} dismissed ${ev.coachName || "their head coach"}`
            : `${clubNameById(ev.clubId)} 解雇主教练 ${ev.coachName || ""}`,
          priority: 2,
        });
        break;
      case "manager_appointment":
        lines.push({
          day,
          icon: "📋",
          text: en
            ? `${clubNameById(ev.clubId)} appointed ${ev.coachName || "a new head coach"}`
            : `${clubNameById(ev.clubId)} 任命 ${ev.coachName || "新任主教练"}`,
          priority: 2,
        });
        break;
      default:
        break;
    }
  }
  return lines;
}

/** 多日推进后的关键事件摘要弹窗 */
function showAdvanceSummary(events, days) {
  const lines = advanceEventLines(events);
  if (!lines.length) return false;
  const body = $("#modal-body");
  const modal = $("#modal");
  if (!body || !modal) return false;
  const en = getLang() === "en";
  // 高优先级在前，同级按发生日期
  const sorted = [...lines].sort(
    (a, b) => b.priority - a.priority || a.day - b.day
  );
  const shown = sorted.slice(0, 40);
  const hidden = sorted.length - shown.length;
  body.innerHTML = `
    <h3 style="margin:0 0 0.6rem">${escapeHtml(
      en ? `Key events over ${days} day(s)` : `推进 ${days} 天的关键事件`
    )}</h3>
    <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.35rem">
      ${shown
        .map(
          (l) => `<li style="display:flex;gap:0.5rem;align-items:baseline">
        <span style="opacity:0.6;min-width:3.2rem;font-variant-numeric:tabular-nums">D${l.day}</span>
        <span>${l.icon}</span>
        <span>${escapeHtml(l.text)}</span>
      </li>`
        )
        .join("")}
    </ul>
    ${
      hidden > 0
        ? `<p class="hint" style="margin:0.6rem 0 0">${escapeHtml(
            en ? `+${hidden} more event(s)` : `另有 ${hidden} 条事件`
          )}</p>`
        : ""
    }`;
  $("#modal-card")?.classList.remove("wide", "search-modal");
  openSharedModal();
  return true;
}

let calendarAdvanceBusy = false;
let calendarBlockedControls = [];

function setCalendarAdvanceBusy(busy) {
  if (calendarAdvanceBusy === !!busy) return;
  calendarAdvanceBusy = !!busy;
  const screen = $("#screen-main");
  if (screen) {
    screen.inert = calendarAdvanceBusy;
    screen.setAttribute("aria-busy", String(calendarAdvanceBusy));
  }
  if (calendarAdvanceBusy) {
    calendarBlockedControls = [...document.querySelectorAll(
      "#screen-main button, #screen-main input, #screen-main select, #screen-main textarea"
    )].map((control) => ({ control, disabled: control.disabled }));
    for (const { control } of calendarBlockedControls) control.disabled = true;
  } else {
    for (const { control, disabled } of calendarBlockedControls) {
      if (control.isConnected) control.disabled = disabled;
    }
    calendarBlockedControls = [];
  }
  const en = getLang() === "en";
  const status = $("#calendar-advance-status");
  if (status) {
    status.textContent = busy
      ? (en ? "Advancing the calendar…" : "正在推进日历…")
      : (en ? "Calendar ready" : "日历已准备好");
  }
  for (const id of [
    "#btn-advance",
    "#btn-advance-matchday",
    "#btn-advance-season-end",
    "#btn-topbar-continue",
    "#btn-topbar-advance-day",
    "#btn-topbar-advance-matchday",
    "#btn-topbar-advance-season-end",
  ]) {
    const button = $(id);
    if (button) {
      button.disabled = calendarAdvanceBusy;
      button.setAttribute("aria-busy", calendarAdvanceBusy ? "true" : "false");
      button.toggleAttribute("data-advance-busy", calendarAdvanceBusy);
    }
  }
}

async function runCalendarAdvance(task) {
  if (calendarAdvanceBusy) return null;
  setCalendarAdvanceBusy(true);
  let lastProgressAt = 0;
  const onProgress = (event) => {
    const now = performance.now();
    const completed = Number(event.detail?.completed) || 0;
    const total = Number(event.detail?.total) || 0;
    if (!total || (completed < total && now - lastProgressAt < 700)) return;
    lastProgressAt = now;
    toast(
      getLang() === "en"
        ? `Running spatial matches ${completed}/${total}`
        : `正在运行空间比赛 ${completed}/${total}`
    );
    const status = $("#calendar-advance-status");
    if (status) {
      status.textContent = getLang() === "en"
        ? `Running spatial matches ${completed}/${total}`
        : `正在运行空间比赛 ${completed}/${total}`;
    }
  };
  window.addEventListener("vcfm-calendar-progress", onProgress);
  toast(
    getLang() === "en"
      ? "Running headless spatial matches…"
      : "正在后台运行无画面空间比赛…"
  );
  try {
    return await task();
  } catch (error) {
    console.error(error);
    toast(getLang() === "en" ? "Calendar advance failed" : "日历推进失败");
    return null;
  } finally {
    window.removeEventListener("vcfm-calendar-progress", onProgress);
    setCalendarAdvanceBusy(false);
  }
}

async function onAdvance() {
  if (world.sacked) {
    // 待业：允许推进日程刷工作邀请
    try {
      ensureManagerJob(world);
    } catch (_) {}
    if (world.managerJob?.status === "unemployed") {
      const advanceSnapshot = captureAdvanceSnapshot();
      const res = advanceDay(world);
      dashboardAdvanceDigest = buildAdvanceDigest(advanceSnapshot, res.events, 1);
      autosave("unemployed-advance");
      const n = (res.offers || pendingJobOffers(world) || []).length;
      toast(
        getLang() === "en"
          ? `Day ${world.day} · ${n} job offer(s)`
          : `第 ${world.day} 天 · ${n} 个工作邀请`
      );
      renderCareer();
      renderDashboard();
      return;
    }
    handleSacked({ sacked: true, msg: world.sackedReason || "你已被解雇" });
    return;
  }
  if (world.seasonOver || (world.fixtures.length && world.fixtures.every((f) => f.played))) {
    toast(t("toast.seasonOver"));
    return;
  }
  const next = getNextUserMatch(world);
  if (next && next.day === world.day && !next.played) {
    toast(t("toast.playFirst"));
    return;
  }
  // 紧急信箱：优先处理再推进
  const urgent = listInbox(world, { pendingOnly: true, limit: 20 }).filter(
    (m) => (m.priority || 1) >= 3
  );
  if (urgent.length && !world._inboxSkipGate) {
    const en = getLang() === "en";
    if (
      !confirm(
        en
          ? `You have ${urgent.length} urgent inbox item(s). Open inbox first?\n(OK = open inbox, Cancel = advance anyway)`
          : `有 ${urgent.length} 封紧急信箱待办。是否先打开信箱？\n（确定=打开信箱，取消=仍要推进）`
      )
    ) {
      world._inboxSkipGate = true;
    } else {
      goToInboxTab();
      return;
    }
  }
  world._inboxSkipGate = false;
  const advanceSnapshot = captureAdvanceSnapshot();
  const res = await runCalendarAdvance(() => advanceDayAsync(world));
  if (!res) return;
  dashboardAdvanceDigest = buildAdvanceDigest(advanceSnapshot, res.events, 1);
  if (handleSacked(res)) return;
  const { userMatches } = res;
  if (userMatches && userMatches.length) {
    pendingMatch = userMatches[0];
    const label = fixtureRoundDisplay(pendingMatch);
    toast(getLang() === "en" ? `${label} · Matchday` : `${label} · 比赛日到了！`);
  } else if (world.seasonOver) {
    toast(t("toast.seasonEndNews"));
    if (world.sacked) handleSacked({ sacked: true, msg: world.sackedReason });
  } else {
    // 单日推进用轻提示而非弹窗：优先播报高优先级事件，其次才是信箱
    const en = getLang() === "en";
    const evLines = advanceEventLines(res.events).sort(
      (a, b) => b.priority - a.priority
    );
    const top = evLines[0];
    if (top && top.priority >= 3) {
      const more =
        evLines.length > 1
          ? en
            ? ` (+${evLines.length - 1})`
            : `（另有 ${evLines.length - 1} 条）`
          : "";
      toast(`${top.icon} ${top.text}${more}`);
    } else {
      const n = pendingInboxCount(world);
      if (n > 0) {
        const urgent = listInbox(world, { pendingOnly: true, limit: 8 }).filter((m) => (m.priority || 1) >= 3);
        if (urgent.length) {
          toast(
            en
              ? `Inbox: ${n} pending (${urgent.length} urgent)`
              : `信箱有 ${n} 封待办（含 ${urgent.length} 封紧急）`
          );
        }
      }
    }
  }
  autosave("advance");
  refreshAll();
}

async function onAdvanceToMatchday() {
  if (world.sacked) {
    handleSacked({ sacked: true, msg: world.sackedReason || "你已被解雇" });
    return;
  }
  if (world.seasonOver || (world.fixtures.length && world.fixtures.every((f) => f.played))) {
    toast(t("toast.seasonOver"));
    return;
  }
  const advanceSnapshot = captureAdvanceSnapshot();
  const res = await runCalendarAdvance(() => advanceToNextMatchDayAsync(world));
  if (!res) return;
  dashboardAdvanceDigest = buildAdvanceDigest(advanceSnapshot, res.events, res.days);
  if (world.sacked || res.sacked) {
    handleSacked(res.sackedResult || { sacked: true, msg: world.sackedReason });
    return;
  }
  if (!res.ok && !res.days) {
    toast(getLang() === "en" ? "Unable to advance the calendar" : res.msg || "无法推进");
    return;
  }
  if (res.userMatches && res.userMatches.length) {
    pendingMatch = res.userMatches[0];
    const label = fixtureRoundDisplay(pendingMatch);
    toast(getLang() === "en" ? `Advanced ${res.days} day(s) · ${label}` : `推进 ${res.days} 天 · ${label}`);
  } else if (world.seasonOver) {
    toast(getLang() === "en" ? `Advanced ${res.days} day(s) · season complete` : `推进 ${res.days} 天 · 赛季结束`);
    if (world.sacked) handleSacked({ sacked: true, msg: world.sackedReason });
  } else {
    toast(getLang() === "en" ? `Advanced ${res.days} day(s)` : res.msg || `推进 ${res.days} 天`);
  }
  autosave("advance-matchday");
  refreshAll();
  // 多日推进：用摘要弹窗交代这段时间发生了什么
  showAdvanceSummary(res.events, res.days);
}

/** 推进到赛季末：遇我方比赛停下（无「连推 N 天」） */
async function onAdvanceToSeasonEnd() {
  if (world.sacked) {
    handleSacked({ sacked: true, msg: world.sackedReason || "你已被解雇" });
    return;
  }
  if (world.seasonOver || (world.fixtures.length && world.fixtures.every((f) => f.played))) {
    toast(t("toast.seasonOver"));
    return;
  }
  if (
    !confirm(
      getLang() === "en"
        ? "Advance automatically toward the end of the season. The calendar will stop at your next match and will not skip it. Continue?"
        : "将自动推进日程，直到赛季结束；途中遇到我方比赛会停下。\n（不会跳过你的比赛）\n确定？"
    )
  ) {
    return;
  }
  const advanceSnapshot = captureAdvanceSnapshot();
  const res = await runCalendarAdvance(() =>
    advanceToSeasonEndAsync(world, { stopOnUserMatch: true })
  );
  if (!res) return;
  dashboardAdvanceDigest = buildAdvanceDigest(advanceSnapshot, res.events, res.days);
  if (world.sacked || res.sacked) {
    handleSacked(res.sackedResult || { sacked: true, msg: world.sackedReason });
    return;
  }
  if (!res.ok && !res.days) {
    toast(getLang() === "en" ? "Unable to advance the calendar" : res.msg || "无法推进");
    if (res.userMatches?.length) pendingMatch = res.userMatches[0];
    refreshAll();
    return;
  }
  if (res.userMatches && res.userMatches.length) {
    pendingMatch = res.userMatches[0];
    const label = fixtureRoundDisplay(pendingMatch);
    toast(getLang() === "en" ? `Advanced ${res.days} day(s) · ${label}` : `${res.msg || `推进 ${res.days} 天`} · ${label}`);
  } else if (world.seasonOver) {
    toast(getLang() === "en" ? `Advanced ${res.days} day(s) · season complete` : res.msg || `推进 ${res.days} 天 · 赛季结束`);
    if (world.sacked) handleSacked({ sacked: true, msg: world.sackedReason });
  } else {
    toast(getLang() === "en" ? `Advanced ${res.days} day(s)` : res.msg || `推进 ${res.days} 天`);
  }
  autosave("advance-season-end");
  refreshAll();
  showAdvanceSummary(res.events, res.days);
}

function syncMatchSpeedUI() {
  document.querySelectorAll("[data-match-speed]").forEach((btn) => {
    const v = Number(btn.dataset.matchSpeed);
    btn.classList.toggle("active", v === matchSpeed);
  });
  try {
    matchView?.setFmmSpeedLabel?.(matchSpeed);
  } catch (_) {
    /* ignore */
  }
}

function syncMatchCameraUI() {
  document.querySelectorAll("[data-match-camera]").forEach((btn) => {
    const active = btn.dataset.matchCamera === matchCamera;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  matchView?.setCameraPreset?.(matchCamera, { persist: false });
}

/**
 * 高光观赛：细播段落用实时动画速度（rate=1，不抖）。
 * 平淡时段 skip，整场墙钟目标约 ≤10 分钟（见 adapt.buildHighlightWindows）。
 */
const SIM_HIGHLIGHT_RATE = 1;

/**
 * 直播/快速模拟事件停顿（毫秒，再除以倍速）
 * ×1 ≈ FMM「正常观赛」：空分钟也有节奏，关键戏更长
 */
function matchEventWaitMs(ev) {
  if (!ev) return 420;
  switch (ev.type) {
    case "goal":
      return 0; // 进球走高光回放，单独计时
    case "tick":
      // 每一比赛分钟的「呼吸」——之前几乎为 0，所以整体飞快
      return 280;
    case "sim_frame":
      return 16; // 连续时间轴下几乎不用
    case "chance":
    case "woodwork":
    case "penalty":
    case "pen_miss":
      // 预演已占 ~1.2s，这里只留射门结果停留
      return 900;
    case "save":
      return 800;
    case "red":
      return 1200;
    case "card":
    case "injury":
      return 950;
    case "sub":
    case "tactics":
      return 800;
    case "corner":
      // 预演已组织，角球结果稍短
      return 550;
    case "kickoff":
      return 1100;
    case "ht":
    case "ft":
      return 1000;
    case "coach":
    case "context":
      return 700;
    default:
      return 480;
  }
}

/**
 * 驱动球场画面 + 按倍速等待（进球自动高光回放）
 * 支持暂停 / 逐事件；进球会写入可回看列表
 * @param {boolean} live 直播：即时写评论区；快速模拟也会更新顶栏比分/分钟
 */
/**
 * 连续 sim 时间轴上的事件（进球/扑救…）：同步刷 UI，用 hold 卡时间轴而不是 await 长 sleep
 * （避免打断 rAF 插值流畅度）
 */
function handleSimLiveEvent(ev, snap) {
  if (!ev || ev.type === "tick" || ev.type === "sim_frame") return;
  const spd = Math.max(0.25, Number(matchSpeed) || 1);
  const fixture = pendingMatch;
  // 半场/完场是真实的时钟边界，必须显式 reset 才能落回 45'/90'：
  // 顶栏走 nextDisplayedMinute 的单调保护（Math.max，防止迟到事件把时钟拨回去），
  // 而上半场结束时快照分钟已经滚到 46，ht 事件写的是 45，
  // Math.max(46, 45) 恒为 46 —— 于是「中场休息」时顶栏挂着 46'。
  // 单调保护本身是对的（有审计钉着），所以只在这两个边界上开 reset。
  const evMin = Number.isFinite(ev.minute) ? ev.minute : null;
  const isBoundary = ev.type === "ht" || ev.type === "ft";
  if (isBoundary && evMin != null) setMatchMinute(evMin, { reset: true });
  else if (snap?.minute != null) setMatchMinute(snap.minute);
  else if (evMin != null) setMatchMinute(evMin);
  if (snap?.homeGoals != null) setMatchScore(snap.homeGoals, snap.awayGoals);
  // 高光事件的 snap 带的是整段模拟统计，按事件时刻切片后再显示。
  if (snap?.home) {
    const live = liveStatsThrough(snap.simT ?? null, snap.minute);
    updateLiveStats({ ...snap, home: live.home, away: live.away });
  }

  if (ev.type === "goal") {
    const scene = matchView?.captureSceneSnapshot?.() || null;
    const replay = currentGoalReplayData();
    rememberGoalReplay(ev, snap, fixture, scene, replay);
    if (ev.text) appendMatchEvent(ev, { goalIndex: matchPlayback.goals.length - 1 });
    if (matchView) {
      if (snap?.sim) matchView.applySimSnapshot(snap.sim);
      const lang = getLang();
      // 一粒进球只走一次 onEvent；hold 缩短，避免真帧入网后再「冻住看特效」
      matchView.onEvent(ev, snap, fixture);
      const goalHold = 380 / Math.min(spd, 1.35);
      matchView.holdSimTimeline?.(goalHold);
      matchPlayback.pendingGoalReplay = {
        lang,
        scene,
        frames: replay.frames,
        climaxAt: replay.climaxAt,
      };
    }
    return;
  }

  if (ev.text) appendMatchEvent(ev);
  if (matchView) {
    if (snap?.sim) matchView.applySimSnapshot(snap.sim);
    const lang = getLang();
    if (ev.type === "save" || ev.type === "chance" || ev.type === "woodwork") {
      matchView.triggerDirectorMoment?.(ev.type, { ev, fixture, lang });
      // FMM 底栏短句
      if (ev.type === "save") {
        matchView.setFmmTicker?.(
          lang === "en" ? "Great save!" : "精彩扑救！",
          "save",
          eventTickerMs("save", spd)
        );
      } else if (ev.type === "woodwork") {
        matchView.setFmmTicker?.(
          lang === "en" ? "Off the woodwork!" : "击中门框！",
          "wood",
          eventTickerMs("woodwork", spd)
        );
      } else {
        const nm = matchView.players?.find((p) => p.id === ev.playerId)?.name || "";
        matchView.setFmmTicker?.(
          nm
            ? lang === "en"
              ? `${nm} shoots!`
              : `${nm} 射门!`
            : lang === "en"
              ? "Chance!"
              : "威胁射门！",
          "shot",
          eventTickerMs("chance", spd)
        );
      }
    } else if (ev.type === "corner") {
      // 角球：摆位 + 角旗球 + 徽章，hold 够长让人看清
      matchView._stageCornerSetPiece?.(ev, fixture);
      matchView.triggerDirectorMoment?.("chance", { ev, fixture, lang });
      matchView.setFmmTicker?.(
        lang === "en" ? "Corner kick!" : "角球！",
        "info",
        eventTickerMs("corner", spd)
      );
      matchView.setBanner?.(lang === "en" ? "🚩 CORNER" : "🚩 角球", "info");
      setTimeout(() => matchView?.setBanner?.(""), 1600);
    } else if (ev.type === "offside") {
      matchView.setFmmTicker?.(
        lang === "en" ? "They think it was offside!" : "他认为这粒球越位在先!",
        "dispute",
        eventTickerMs("offside", spd)
      );
    } else if (ev.type === "penalty") {
      // 引擎判罚后要走完法定站位与助跑才出脚，判罚文案必须覆盖到主罚为止，
      // 否则"获得点球"会在球还没踢出时就被射门/扑救文案顶掉。
      const holdMs = eventTickerMs("penalty", spd);
      matchView.setFmmTicker?.(
        lang === "en" ? "Penalty awarded!" : "判罚点球！",
        "warn",
        holdMs
      );
      matchView.setBanner?.(lang === "en" ? "⚠ PENALTY" : "⚠ 点球", "warn");
      setTimeout(() => matchView?.setBanner?.(""), holdMs * 0.75);
    } else if (ev.text && !["tick", "sim_frame", "goal"].includes(ev.type)) {
      // 一般事件：短时 ticker
      // 旧实现所有杂项事件一律 "info"，于是「裁判示意有利」和「VAR 复核完成」
      // 长得一模一样——一条是继续比赛的提示，一条是改判结果，轻重完全不同。
      // 按性质分级：判罚争议 / 需要留意 / 普通信息。
      const kindMap = {
        var_decision: "dispute",
        offside: "dispute",
        handball: "warn",
        card: "warn",
        red: "warn",
        injury: "warn",
        backpass: "warn",
      };
      const raw = String(ev.text).replace(/^\[.*?\]\s*/, "");
      // 截断要留省略号，否则句子被硬切在半路，看着像文案出错
      const clean = raw.length > 48 ? raw.slice(0, 47) + "…" : raw;
      if (clean) {
        matchView.setFmmTicker?.(
          clean,
          kindMap[ev.type] || "info",
          eventTickerMs(ev.type, spd)
        );
      }
    }
    matchView.onEvent(ev, snap, fixture);
    const holdMap = {
      // 2026-09-05（表现层 A3）：事件定格整体收紧——实测快速高光 61% 墙钟时间画面
      // 无人移动，定格是主要成分之一。文案可读性由 KEY_EVENT_MS（底栏）保证，
      // 与画面定格解耦，压这里不伤读稿。
      save: 800,
      chance: 600,
      woodwork: 700,
      corner: 1300,
      card: 800,
      red: 1100,
      injury: 900,
      coach: 400,
      context: 350,
      offside: 600,
      // 点球：镜头停到主罚为止，让站位和助跑真的被看见。
      penalty: PENALTY_SETUP_SEC * 1000,
    };
    const h = holdMap[ev.type];
    if (h) matchView.holdSimTimeline?.(h / Math.min(spd, 1.5));
  }
}

/**
 * 刷新直播比分条 / 分钟 / 统计
 *
 * 高光播放时整个半场其实已经模拟完毕，`matchState.stats` 存的是半场终值。
 * 直接显示它会让开场几分钟就出现整段模拟的最终控球率和射门数，
 * 所以有 simT 时按"截至当前画面时刻"重算，让数据条跟着画面推进。
 * @param {number|null} minute 顶栏分钟
 * @param {number|null} [simT] 当前画面对应的模拟秒
 */
function refreshLiveHudFromState(minute, simT = null) {
  if (!matchState) return;
  if (minute != null) setMatchMinute(minute, { simT });
  setMatchScore(matchState.hg, matchState.ag);
  if (!matchState.stats) return;
  const live = liveStatsThrough(simT, minute);
  updateLiveStats({
    home: live.home,
    away: live.away,
    homeGoals: matchState.hg,
    awayGoals: matchState.ag,
    minute: minute ?? matchState.minute,
  });
}

/**
 * 取"截至画面当前时刻"的双方数据。
 * 空间引擎在场时按模拟时间切片；否则退回 state 累计值（概率引擎逐分钟记账，本身就同步）。
 * @param {number|null} simT 模拟秒
 * @param {number|null} minute 顶栏分钟，simT 缺失时用它折算
 */
function liveStatsThrough(simT, minute) {
  const stats = matchState.stats;
  const eng = matchState.simEng;
  if (eng?.statsThrough) {
    const t = Number.isFinite(Number(simT))
      ? Number(simT)
      : Number.isFinite(Number(minute))
        ? Number(minute) * 60
        : null;
    if (t != null) {
      const part = eng.statsThrough(t);
      const hp = part.possessionSec.home;
      const ap = part.possessionSec.away;
      const tot = hp + ap;
      // 开场前几秒还没有控球积分，此时不显示 0%/100% 这种失真读数。
      const homePoss = tot > 1 ? Math.round((hp / tot) * 100) : 50;
      return {
        home: {
          xg: Math.round(part.xg.home * 100) / 100,
          shots: part.shots.home,
          shotsOn: part.shotsOn.home,
          possession: homePoss,
        },
        away: {
          xg: Math.round(part.xg.away * 100) / 100,
          shots: part.shots.away,
          shotsOn: part.shotsOn.away,
          possession: 100 - homePoss,
        },
      };
    }
  }
  const ht = stats.home.possessionTicks;
  const at = stats.away.possessionTicks;
  const tot = ht + at || 1;
  const homePoss = Math.round((ht / tot) * 100);
  return {
    home: {
      xg: Math.round(stats.home.xg * 100) / 100,
      shots: stats.home.shots,
      shotsOn: stats.home.shotsOn,
      possession: homePoss,
    },
    away: {
      xg: Math.round(stats.away.xg * 100) / 100,
      shots: stats.away.shots,
      shotsOn: stats.away.shotsOn,
      possession: 100 - homePoss,
    },
  };
}

/**
 * 高光观赛计划执行：play 段实时细播，skip 段快进时钟
 * 直播与快速模拟共用；快速模式跳过进球后自动重播、跳过段更短，倍速仍走 getSpeed()
 */
async function playHighlightPlanBridge(spec) {
  const segs = spec?.segments || [];
  if (matchView?.setSimDrive) matchView.setSimDrive(true);

  const getSpeed = () => Math.max(0.25, Number(matchSpeed) || 1);
  const isPaused = () => !!(matchPlayback.paused || matchPlayback.replaying);
  // 快速模拟：同样播真高光帧，但更干脆（无 FMM 自动重播）
  const fast = !!(matchState && !matchState._liveMode);

  // 开场提示一次
  // 旧实现每调用一次 playHighlightPlanBridge 就弹一遍，一场比赛按高光批次能弹五六次；
  // 且文案写死「倍速生效」，而倍速选择器读数是 ×1，看着像系统自作主张改了倍速。
  // 改成：整场只提示一次，并直接报出当前实际倍速。
  if (
    segs.some((s) => s.kind === "play") &&
    matchView?.setCaption &&
    matchState &&
    !matchState._hlIntroShown
  ) {
    matchState._hlIntroShown = true;
    const en = getLang() === "en";
    const spd = getSpeed();
    matchView.setCaption(
      fast
        ? en
          ? `Fast highlights · goals in motion · ×${spd}`
          : `快速高光 · 进球动态细看 · 当前 ×${spd}`
        : en
          ? "Highlights mode · dull passages skipped"
          : "高光观赛 · 平淡时段已跳过",
      "info",
      fast ? 1600 : 2200
    );
  }

  for (const seg of segs) {
    // ④-B 续播：续播点之前的段只记账、不渲染。
    // 复用现成的 skip 路径（`spec.onSkip` 记账 + HUD 刷新），但**不走**下面的
    // 「⏩ 跳过平淡」横幅 —— 那会把一次长快进刷成十几条噪声横幅。
    if (matchResumeSimT != null && seg.t1 <= matchResumeSimT) {
      try {
        spec.onSkip?.(seg);
      } catch (e) {
        console.warn(e);
      }
      refreshLiveHudFromState(seg.toMin, seg.t1);
      if (!matchResumeBannerShown) {
        matchResumeBannerShown = true;
        const msg =
          getLang() === "en"
            ? `⏩ Fast-forward to where you left off (${matchResumeMinute}')`
            : `⏩ 快进到你上次看到的位置（${matchResumeMinute}′）`;
        matchView?.setBanner?.(msg, "info");
        matchView?.setCaption?.(msg, "info", fast ? 1400 : 2000);
        setTimeout(() => matchView?.setBanner?.(""), fast ? 140 : 200);
      }
      continue;
    }

    if (seg.kind === "skip") {
      try {
        spec.onSkip?.(seg);
      } catch (e) {
        console.warn(e);
      }
      refreshLiveHudFromState(seg.toMin, seg.t1);
      // 跳过：极短过渡 + 明确提示（让人看出「确实在跳过平淡」）
      const gapMin = Math.max(0, (seg.toMin || 0) - (seg.fromMin || 0));
      const skipMs = fast
        ? Math.min(120, 36 + gapMin * 3)
        : Math.min(220, 60 + gapMin * 5);
      if (gapMin >= 2) {
        const msg =
          getLang() === "en"
            ? `⏩ Skip ${seg.fromMin}'→${seg.toMin}'`
            : `⏩ 跳过平淡 ${seg.fromMin}'→${seg.toMin}'`;
        if (matchView?.setBanner) {
          matchView.setBanner(msg, "info");
          setTimeout(() => matchView.setBanner?.(""), fast ? 140 : 200);
        }
        if (matchView?.setCaption) matchView.setCaption(msg, "info", fast ? 320 : 450);
      }
      await sleepPlayback(skipMs / getSpeed());
      continue;
    }

    if (seg.kind === "play" && seg.frames?.length >= 2 && matchView?.playSimTimeline) {
      // ④-B：这是续播后**第一次真正渲染** ⇒ 续播使命完成，清掉以免影响
      // 后续批次（H2 有 3 次独立调用，不清会把整场都跳光）。
      matchResumeSimT = null;
      await matchView.playSimTimeline(seg.frames, {
        getSpeed,
        isPaused,
        // 快速略提 rate，仍完全服从倍速旋钮
        rate: fast ? SIM_HIGHLIGHT_RATE * 1.15 : SIM_HIGHLIGHT_RATE,
        // FMM 导演：段落标签 + 高潮时刻（推镜/慢镜）
        label: seg.label || null,
        climaxAt: seg.at != null ? seg.at : null,
        fmmWide: true,
        // 进球窗可挂助攻/射手，便于导演先跟传球再跟终结
        assistId: seg.assistId || null,
        scorerId: seg.scorerId || null,
        onSimT: (t, minute) => {
          refreshLiveHudFromState(minute, t);
          try {
            spec.onSimT?.(t, minute);
          } catch (e) {
            console.warn(e);
          }
        },
      });
      refreshLiveHudFromState(seg.toMin, seg.t1);
      // 直播：进球后 FMM 自动重播；快速只看高光窗本身（已含进球动态）
      if (
        !fast &&
        matchPlayback.pendingGoalReplay &&
        matchView?.playFmmGoalReplay
      ) {
        const pr = matchPlayback.pendingGoalReplay;
        matchPlayback.pendingGoalReplay = null;
        matchPlayback.replaying = true;
        try {
          await (matchView.playRecordedGoalReplay || matchView.playFmmGoalReplay).call(matchView, {
            lang: pr.lang || getLang(),
            scene: pr.scene,
            frames: pr.frames || seg.frames,
            climaxAt: pr.climaxAt != null ? pr.climaxAt : seg.at,
            sleepFn: sleepPlayback,
            // 自动重播不是二次慢镜：×1 约 6.5s，低速档也封在约 8s。
            getSpeed: () => Math.min(1.25, Math.max(0.8, getSpeed())),
            isPaused: () => !!(matchPlayback.paused || matchView._fmmReplay?.skip),
            returnToLiveSim: true,
          });
        } catch (e) {
          console.warn(e);
        } finally {
          matchPlayback.replaying = false;
          matchView.setFmmReplayChrome?.(false, { lang: pr.lang || getLang() });
          matchView.setFmmTicker?.("", "", 0);
        }
      } else if (fast) {
        matchPlayback.pendingGoalReplay = null;
      }
      continue;
    }

    // 无帧的 play 当 skip
    try {
      spec.onSkip?.(seg);
    } catch (_) {
      /* ignore */
    }
    refreshLiveHudFromState(seg.toMin, seg.t1);
  }
}

async function driveMatchEvent(ev, snap, { live = true } = {}) {
  const spd = Math.max(0.25, Number(matchSpeed) || 1);
  const fixture = pendingMatch;
  const simDrive = !!(matchView?.simDrive || snap?.sim || snap?.engine === "v2");

  // 连续时间轴弹出的事件：走轻量 UI + hold，保持流畅
  if (ev?._simLive && live) {
    handleSimLiveEvent(ev, snap);
    return;
  }

  // 旧式逐帧 sim_frame（兼容）：几乎不再使用
  if (ev.type === "sim_frame") {
    if (live && snap) setMatchMinute(snap.minute);
    if (snap?.home) updateLiveStats(snap);
    if (matchView?.applySimSnapshot && snap?.sim) {
      matchView.applySimSnapshot(snap.sim);
    } else if (matchView?.onTick) {
      matchView.onTick(snap);
    }
    await sleepPlayback(Math.max(8, 16 / spd));
    return;
  }

  if (ev.type === "tick") {
    // 快速/直播都要走表：否则快速模拟顶栏会卡在 0′/45′
    if (snap?.minute != null) setMatchMinute(snap.minute);
    else if (ev.minute != null) setMatchMinute(ev.minute);
    if (snap?.homeGoals != null && snap?.awayGoals != null) {
      setMatchScore(snap.homeGoals, snap.awayGoals);
    }
    if (snap?.sim && matchView?.applySimSnapshot) {
      matchView.applySimSnapshot(snap.sim);
    } else if (matchView?.onTick) {
      matchView.onTick(snap);
    }
    // 空分钟也要停：否则 90 分钟几乎瞬间跳完
    let tickMs = matchEventWaitMs(ev);
    if (!simDrive && matchView?._attackPhaseActive?.()) tickMs = Math.round(tickMs * 1.25);
    // 空间投影连续时间轴下 tick 几乎不用；兜底短停
    if (simDrive) {
      tickMs = snap?.sim ? 40 : 200;
    }
    const wait = live ? tickMs / spd : Math.max(12, tickMs / (spd * 8));
    await sleepPlayback(wait);
    return;
  }

  if (ev.type === "goal") {
    // 先抓场面，再对齐/高光——回看才能从同一帧接
    const scene = matchView?.captureSceneSnapshot?.() || null;
    const replay = currentGoalReplayData();
    rememberGoalReplay(ev, snap, fixture, scene, replay);
    // 顶栏比分/分钟：快速模拟也必须同步（横幅已在播，不能还显示 0-0 / 0′）
    if (snap) {
      setMatchScore(snap.homeGoals, snap.awayGoals);
      setMatchMinute(ev.minute ?? snap.minute);
    } else if (ev.minute != null) {
      setMatchMinute(ev.minute);
    }
    // 评论区：非 _simLive 路径（含快速的开球/中场指令）；高光进球走 handleSimLiveEvent
    if (ev.text) {
      appendMatchEvent(ev, { goalIndex: matchPlayback.goals.length - 1 });
    }

    // 空间投影：贴帧 + 横幅/音效，停顿接近旧版进球高光时长
    if (simDrive) {
      if (snap?.sim && matchView?.applySimSnapshot) matchView.applySimSnapshot(snap.sim);
      if (matchView) matchView.onEvent(ev, snap, fixture);
      // 普通空间事件路径此前只停在入网提示，连续时间轴路径才会自动回放。
      // 直播时统一先保留短暂真实入网画面，再进入带明确标识的进球回放。
      const goalWait = live ? 650 / Math.min(spd, 1.25) : 350;
      await sleepPlayback(goalWait);
      if (live && (matchView?.playRecordedGoalReplay || matchView?.playGoalHighlight)) {
        matchPlayback.replaying = true;
        try {
          const played =
            replay.frames.length >= 4 && matchView.playRecordedGoalReplay
              ? await matchView.playRecordedGoalReplay({
                  frames: replay.frames,
                  climaxAt: replay.climaxAt,
                  lang: getLang(),
                  sleepFn: sleepPlayback,
                  getSpeed: () => Math.min(1, spd),
                  isPaused: () => !!matchPlayback.paused,
                  returnToLiveSim: true,
                })
              : await matchView.playGoalHighlight(ev, snap, fixture, {
                  speed: Math.min(spd, 1),
                  lang: getLang(),
                  sleepFn: sleepPlayback,
                  scene: scene || null,
                  rewatch: true,
                });
          if (!played) throw new Error("Spatial goal replay could not enter playback state");
        } catch (error) {
          console.warn(error);
        } finally {
          matchPlayback.replaying = false;
        }
      }
      return;
    }

    if (matchView?.extendAttackFromEvent) matchView.extendAttackFromEvent(ev, fixture);
    if (matchView?.prepareEvent) {
      await matchView.prepareEvent(ev, snap, fixture, {
        speed: spd,
        live,
        sleepFn: sleepPlayback,
      });
    }
    if (matchView?.playGoalHighlight) {
      const goalSpd = Math.min(spd, live ? 1.15 : 1.5);
      await matchView.playGoalHighlight(ev, snap, fixture, {
        speed: goalSpd,
        lang: getLang(),
        sleepFn: sleepPlayback,
        scene: scene || null,
        rewatch: false,
      });
    }
    return;
  }

  // 关键事件：空间投影只贴帧 + 轻事件，不做预演编舞
  if (simDrive) {
    if (snap?.sim && matchView?.applySimSnapshot) matchView.applySimSnapshot(snap.sim);
    if (matchView) matchView.onEvent(ev, snap, fixture);
  } else {
    if (matchView?.extendAttackFromEvent) matchView.extendAttackFromEvent(ev, fixture);
    if (matchView?.prepareEvent) {
      await matchView.prepareEvent(ev, snap, fixture, {
        speed: spd,
        live,
        sleepFn: sleepPlayback,
      });
    }
    if (matchView) matchView.onEvent(ev, snap, fixture);
  }

  // 顶栏与评论：快速/直播都写（高光 _simLive 事件不经过本函数）
  // ht/ft 是真实时钟边界，要显式 reset 才能落回 45'/90'：顶栏分钟是单调的
  // （Math.max），而半场末快照已经滚到 46，不 reset 就永远显示 46'。
  const clockBoundary = ev.type === "ht" || ev.type === "ft";
  if (snap) {
    setMatchScore(snap.homeGoals, snap.awayGoals);
    const m = ev.minute ?? snap.minute;
    setMatchMinute(m, clockBoundary && ev.minute != null ? { reset: true } : undefined);
  } else if (ev.minute != null) {
    setMatchMinute(ev.minute, clockBoundary ? { reset: true } : undefined);
  }
  if (ev.text) appendMatchEvent(ev);
  if (ev.type === "ht") setMatchLiveState("ht");
  if (ev.type === "ft") setMatchLiveState("ft");

  const base = matchEventWaitMs(ev);
  if (base > 0) {
    let wait = live ? base / spd : base / (spd * 2.2);
    // 空间投影：事件停顿接近旧导演，略短于完整预演（已无 prepare 编舞）
    if (simDrive && live) {
      wait = Math.max(wait, Math.min(base, 1100) / spd);
    } else if (simDrive) {
      wait = Math.min(wait, 220);
    }
    await sleepPlayback(Math.max(50, wait));
  }
}

/**
 * 锁定天气 + 德比/焦点，生成完整赛前简报
 */
function buildBriefingForFixture(fixture, userClub) {
  if (!fixture || !userClub || !world) return null;
  const home = world.clubs.find((c) => c.id === fixture.home);
  const away = world.clubs.find((c) => c.id === fixture.away);
  if (!home || !away) return null;
  const weather = ensureFixtureWeather(fixture);
  const isCup = fixture.competition === "cup";
  const derby = isDerby(home, away);
  const bigMatch = isBigMatch(world, home, away, isCup);
  const brief = buildPreMatchBriefing(world, fixture, userClub, {
    weather: { key: weather.key, name: weather.name, icon: weather.icon },
    derby,
    bigMatch,
  });
  if (brief) {
    const oppClub = fixture.home === userClub.id ? away : home;
    brief.oppReport = buildOpponentReport(world, userClub, oppClub, fixture);
  }
  return brief;
}

/**
 * 赛前简报 HTML（概览 compact / 比赛页 full）
 * @param {object} brief
 * @param {{ compact?: boolean }} [opts]
 */
function renderPrematchBriefHtml(brief, opts = {}) {
  if (!brief) return "";
  const en = getLang() === "en";
  const compact = !!opts.compact;
  const me = brief.me || {};
  const opp = brief.opp || {};
  const wx = brief.weather;
  // 最近五场：5 个独立方块（W 绿 / D 灰 / L 红），而不是把 "WWDLW" 一坨塞进一个 pill。
  // 不足 5 场用 · 占位，无数据时整组显示「暂无」。
  const formBlocks = (form) => {
    const arr = Array.isArray(form) ? form.slice(-5) : [];
    if (!arr.length) {
      return `<span class="form-strip"><span class="form-cell empty">${en ? "n/a" : "暂无"}</span></span>`;
    }
    const cells = [];
    for (let i = 0; i < 5; i++) {
      const r = arr[i];
      if (!r) cells.push(`<span class="form-cell none" title="—">·</span>`);
      else if (r === "W") cells.push(`<span class="form-cell win" title="${en ? "Win" : "胜"}">W</span>`);
      else if (r === "L") cells.push(`<span class="form-cell loss" title="${en ? "Loss" : "负"}">L</span>`);
      else cells.push(`<span class="form-cell draw" title="${en ? "Draw" : "平"}">D</span>`);
    }
    return `<span class="form-strip">${cells.join("")}</span>`;
  };
  const chips = [];
  if (wx) chips.push(`<span class="brief-chip weather">${escapeHtml(wx.icon + " " + wx.name)}</span>`);
  if (brief.derby) chips.push(`<span class="brief-chip hot">${en ? "🔥 Derby" : "🔥 德比"}</span>`);
  if (brief.bigMatch) {
    chips.push(
      `<span class="brief-chip hot">${brief.isCup ? (en ? "🏆 Cup spotlight" : "🏆 焦点杯赛") : en ? "⭐ Big match" : "⭐ 焦点战"}</span>`
    );
  }
  if (brief.matchup === "favorite")
    chips.push(`<span class="brief-chip good">${en ? "Favourites" : "纸面占优"}</span>`);
  else if (brief.matchup === "underdog")
    chips.push(`<span class="brief-chip warn">${en ? "Underdogs" : "实力偏弱"}</span>`);
  if (brief.boardLabel)
    chips.push(
      `<span class="brief-chip board">${en ? `Board: top ${world.board?.targetPos ?? "—"}` : `董事会: ${escapeHtml(brief.boardLabel)}`}</span>`
    );

  const rows = [];
  if (!brief.isCup && (me.pos || opp.pos)) {
    rows.push(
      en
        ? `Table: us #${me.pos || "—"} (${me.pts}pts) · them #${opp.pos || "—"} (${opp.pts}pts)`
        : `积分榜：我 第${me.pos || "—"}（${me.pts}分） · 对方 第${opp.pos || "—"}（${opp.pts}分）`
    );
  }
  rows.push(
    `${en ? "Form" : "近况"}: ${en ? "Us" : "我"} ${me.formStr || "—"} · ${en ? "Them" : "对方"} ${opp.formStr || "—"}`
  );
  if (me.avgFit != null) {
    rows.push(
      en
        ? `XI fitness avg ${me.avgFit}% · ${me.formation}`
        : `首发体能均 ${me.avgFit}% · 阵型 ${me.formation}`
    );
  }
  if (brief.suspended?.length) {
    rows.push(
      `${en ? "Suspended" : "停赛"}: ${brief.suspended.map((s) => `${s.name}(${s.matches})`).join(en ? ", " : "、")}`
    );
  }
  if (brief.injured?.length) {
    rows.push(
      `${en ? "Injured" : "伤病"}: ${brief.injured
        .slice(0, compact ? 3 : 5)
        .map((s) => s.name)
        .join(en ? ", " : "、")}`
    );
  }
  if (brief.yellowRisk?.length) {
    rows.push(
      `${en ? "Card risk" : "黄牌边缘"}: ${brief.yellowRisk.map((s) => `${s.name}(${s.yellows})`).join(en ? ", " : "、")}`
    );
  }
  if (brief.tired?.length) {
    rows.push(
      `${en ? "Low fitness" : "体能告急"}: ${brief.tired.map((s) => `${s.name}${s.fit}%`).join(en ? ", " : "、")}`
    );
  }
  // 威胁球员：优先用球探报告（带模糊能力），否则回退精确 ovr
  if (brief.oppReport?.danger?.length) {
    rows.push(
      `${en ? "Threats" : "对方威胁"}: ${brief.oppReport.danger
        .map((s) => `${s.name}(${s.ovrText})`)
        .join(en ? ", " : "、")}`
    );
  } else if (opp.top?.length) {
    rows.push(
      `${en ? "Threats" : "对方威胁"}: ${opp.top.map((s) => `${s.name}(${s.ovr})`).join(en ? ", " : "、")}`
    );
  }
  if (!brief.oppReport && !compact && opp.formation) {
    rows.push(
      en
        ? `Opp setup: ${opp.formation} · power ${opp.power}`
        : `对方部署：${opp.formation} · 实力 ${opp.power}`
    );
  }
  if (brief.h2h?.length) {
    const h = brief.h2h
      .slice(0, 3)
      .map((x) => `${x.venue} ${x.score}`)
      .join(" · ");
    rows.push(`${en ? "H2H" : "交锋"}: ${h}`);
  } else if (!compact) {
    rows.push(en ? "H2H: first meeting this season" : "交锋：本季首次交手");
  }

  if (!rows.length) {
    rows.push(en ? "Squad available — no major absences" : "人员齐全，无重大缺阵");
  }

  const head = compact
    ? ""
    : `<div class="brief-head">
        <strong>${escapeHtml(t("match.briefing") || (en ? "Pre-match briefing" : "赛前简报"))}</strong>
        <span class="muted">${escapeHtml(brief.roundLabel || "")} · ${brief.isHome ? (en ? "Home" : "主场") : en ? "Away" : "客场"}</span>
      </div>`;

  const formRow =
    !compact
      ? `<div class="brief-form-row">
          <span class="brief-form-team">${escapeHtml(me.short || me.name || "")}</span>${formBlocks(me.form)}
          <span class="muted brief-form-vs">${en ? "vs" : "对"}</span>
          <span class="brief-form-team">${escapeHtml(opp.short || opp.name || "")}</span>${formBlocks(opp.form)}
        </div>`
      : "";

  const oppHtml = brief.oppReport
    ? formatOpponentReportHtml(brief.oppReport, { lang: en ? "en" : "zh", compact })
    : "";

  return `<div class="prematch-brief ${compact ? "compact" : "full"}">
    ${head}
    ${chips.length ? `<div class="brief-chips">${chips.join("")}</div>` : ""}
    ${formRow}
    ${rows.map((b) => `<div class="brief-line">• ${escapeHtml(b)}</div>`).join("")}
    ${oppHtml}
  </div>`;
}

/**
 * 队内讲话选项 UI
 * @param {"pre"|"ht"} phase
 * @param {string} selectedId
 * @param {string} [nameAttr]
 */
function renderTeamTalkPicker(phase, selectedId, nameAttr = "team-talk") {
  const en = getLang() === "en";
  const title =
    phase === "ht"
      ? en
        ? "Team talk"
        : "队内讲话"
      : en
        ? "Pre-match team talk"
        : "赛前队内讲话";
  const hint =
    phase === "ht"
      ? en
        ? "Sets the tone for the second half · morale + match modifiers"
        : "定调下半场 · 影响士气与攻防修正"
      : en
        ? "Pick one before kick-off · morale + first-half modifiers · media quote"
        : "开赛前选一句 · 影响士气与上半场 · 媒体会引用";
  const cards = TEAM_TALK_IDS.map((id) => {
    const talk = TEAM_TALKS[id];
    if (!talk || !talk.phases.includes(phase)) return "";
    const checked = id === selectedId ? "checked" : "";
    const sel = id === selectedId ? " selected" : "";
    const label = escapeHtml(en ? talk.labelEn : talk.label);
    const desc = escapeHtml(en ? talk.descEn : talk.desc);
    return `<label class="team-talk-card${sel}">
      <input type="radio" name="${escapeHtml(nameAttr)}" value="${escapeHtml(id)}" ${checked} />
      <span class="team-talk-label">${label}</span>
      <span class="team-talk-desc">${desc}</span>
    </label>`;
  }).join("");
  return `<div class="team-talk-panel" data-phase="${phase}">
    <div class="team-talk-head">
      <strong data-i18n-fallback>${escapeHtml(title)}</strong>
      <span class="muted team-talk-hint">${escapeHtml(hint)}</span>
    </div>
    <div class="team-talk-grid">${cards}</div>
  </div>`;
}

function getSelectedTeamTalk(root, nameAttr = "team-talk") {
  const el = (root || document).querySelector(`input[name="${nameAttr}"]:checked`);
  const id = el?.value;
  return TEAM_TALKS[id] ? id : "encourage";
}

function bindTeamTalkPicker(root) {
  if (!root) return;
  root.querySelectorAll(".team-talk-card input[type=radio]").forEach((inp) => {
    inp.addEventListener("change", () => {
      root.querySelectorAll(".team-talk-card").forEach((c) => c.classList.remove("selected"));
      inp.closest(".team-talk-card")?.classList.add("selected");
      if (root.dataset.phase === "pre" || root.closest("#match-pre-brief")) {
        selectedPreTalk = inp.value;
      }
    });
  });
}

async function openMatch() {
  const next = getNextUserMatch(world);
  if (!next || next.day > world.day) {
    toast(t("match.noMatch"));
    return;
  }
  if (world.day < next.day) {
    toast(t("match.notDay"));
    return;
  }
  pendingMatch = next;
  // 已完赛的场次不必再提示「重开会从 0′ 重演」
  if (next.played) clearMatchProgress();
  // 进比赛界面即清掉续播意图：只有弹窗里的「接着看」才会重新armed。
  clearMatchResume();
  matchState = null;
  pendingSubs = [];
  document.querySelector(".match-layout")?.classList.remove("match-report-only");
  // 进比赛界面永远从「有 chrome」开始：沉浸模式是当场的一次性选择，
  // 不该跨场次/跨刷新继承（否则用户会以为控制条坏了）。
  toggleMatchImmersive(false);
  const home = world.clubs.find((c) => c.id === next.home);
  const away = world.clubs.find((c) => c.id === next.away);
  const user = getUserClub(world);
  setupMatchScoreboard(home, away, next);
  setMatchScore(0, 0);
  setMatchMinute(0, { reset: true });
  setMatchLiveState("pre");
  updateLiveStats(null);
  setMatchStatsPanelOpen(false);
  $("#match-log").innerHTML = "";
  resetMatchPlayback({ keepStepMode: true });

  // 赛前简报 + 队内讲话：卡片 + 评论流（天气与开赛锁定一致）
  selectedPreTalk = "encourage";
  const staffManaged = shouldStaffHandleMatchday(world, user);
  const brief = buildBriefingForFixture(next, user);
  const panel = $("#match-pre-brief");
  if (panel) {
    const talkHtml = staffManaged
      ? `<div class="team-talk-panel coach-controlled"><div class="team-talk-head"><strong>${escapeHtml(getLang() === "en" ? "Head coach in charge" : "主教练负责比赛")}</strong><span class="muted team-talk-hint">${escapeHtml(getLang() === "en" ? "The head coach will choose the team talk and all matchday decisions." : "赛前讲话、临场战术与换人均由主教练决定。")}</span></div></div>`
      : renderTeamTalkPicker("pre", selectedPreTalk, "pre-team-talk");
    if (brief) {
      panel.innerHTML = renderPrematchBriefHtml(brief, { compact: false }) + talkHtml;
      panel.classList.remove("hidden");
    } else {
      panel.innerHTML = talkHtml;
      panel.classList.remove("hidden");
    }
    if (!staffManaged) bindTeamTalkPicker(panel.querySelector(".team-talk-panel"));
  }
  if (brief) {
    for (const text of briefingLogLines(brief)) {
      appendMatchEvent({ type: "briefing", text, minute: 0 });
    }
    if (brief.oppReport) {
      for (const text of opponentReportLogLines(brief.oppReport, getLang() === "en" ? "en" : "zh")) {
        appendMatchEvent({ type: "briefing", text, minute: 0 });
      }
    }
    // 计分板情境条：只放轮次，天气/德比留给简报卡与评论流（避免挤压两侧队名）
    const ctx = $("#match-context");
    if (ctx && brief.roundLabel) ctx.textContent = brief.roundLabel;
  }

  hideHtPanel();
  hideMatchReport();
  syncMatchSpeedUI();
  syncMatchCameraUI();
  // 2D 球场：赛前站位（可点球员）
  await ensureMatchPitch(true);
  $("#btn-sim-fast").disabled = false;
  $("#btn-sim-live").disabled = false;
  const inst = $("#btn-sim-instant");
  if (inst) inst.disabled = false;
  const contBtn = $("#btn-match-continue");
  if (contBtn) {
    contBtn.disabled = true;
    contBtn.textContent = t("match.continue");
  }
  matchPlayback.reviewMode = false;
  showScreen("match");
  // 提示放在最后：赛前简报已渲染完，弹窗不会盖住「还在渲染」的中间态。
  maybeWarnReopenedMatch(next);
}

/**
 * 重开同一场比赛前，把「会从 0′ 重演」说清楚，并给替代动作。
 *
 * 为什么需要这条提示：`matchSeed` 随存档保留，而进比赛永远是**新建**会话
 * （`openMatch` 无条件重置 + `runMatch` 新建会话 + `playFirstHalf` 从 fromMin=1 起算），
 * 同一个随机流 ⇒ 重放逐位相同 ⇒ 用户看到「重开之后画面一模一样」，像是没反应。
 *
 * ④-B：现在**真的能接着看**了 —— 进度记录里有模拟秒 `simT` 时给「从 N′ 接着看」，
 * 它会跳过续播点之前的段（只记账不渲染，见 `matchResumeSimT`）。
 * ⚠ 续播点在**下半场**时，上半场会整段跳过 ⇒ 会先停在中场面板等一次确认；
 *   文案里必须说清，否则用户会以为卡住了。
 */
function maybeWarnReopenedMatch(fixture) {
  if (!fixture || fixture.played) return;
  const rec = readMatchProgress();
  if (!rec || rec.key !== matchProgressKey(fixture) || !(rec.minute >= 1)) return;
  const en = getLang() === "en";
  const minute = Math.floor(rec.minute);
  // 续播要有模拟秒，且「跳过一点点」没有意义（≥2′ 才给按钮）。
  const resumeSimT = Number(rec.simT);
  const canResume = Number.isFinite(resumeSimT) && resumeSimT > 0 && minute >= 2;
  const body = $("#modal-body");
  if (!body) return;
  $("#modal-card")?.classList.remove("wide", "search-modal");
  body.innerHTML = `
    <h2>${escapeHtml(en ? "You already watched this match" : "这场比赛你已经看过一段")}</h2>
    <p>${
      canResume
        ? en
          ? `You watched up to <b>${minute}'</b>. You can <b>carry on from there</b>, or replay from <b>0'</b> (the engine replays identically every time, so a restart can look like nothing happened).`
          : `上次你看到 <b>${minute}′</b>。可以 <b>从那里接着看</b>，也可以 <b>从 0′ 重看</b>（引擎每次重放都一样，所以重开看起来像"没反应"）。`
        : en
          ? `You watched up to <b>${minute}'</b>. Reopening restarts from <b>0'</b> — the engine replays the whole match from the beginning (it is identical every time, so it can look like nothing happened).`
          : `上次你看到 <b>${minute}′</b>。重开直播会 <b>从 0′ 重演</b> —— 引擎会把整场从头再演一遍（每次都一样，所以看起来像"没反应"）。`
    }</p>
    ${
      canResume && minute >= 46
        ? `<p class="muted" style="font-size:0.9em">${escapeHtml(
            en
              ? "You were in the second half, so the first half is fast-forwarded — you will stop at the half-time panel once; just continue from there."
              : "你上次在下半场，上半场会被快进 —— 中途会先停在中场面板一次，直接点继续即可。"
          )}</p>`
        : ""
    }
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.75rem">
      ${
        canResume
          ? `<button type="button" class="btn primary" id="btn-reopened-match-resume">${escapeHtml(
              en ? `Carry on from ${minute}'` : `从 ${minute}′ 接着看`
            )}</button>`
          : ""
      }
      <button type="button" class="btn${canResume ? " ghost" : " primary"}" id="btn-reopened-match-replay">${escapeHtml(
        en ? "Replay from 0'" : "从头重看"
      )}</button>
      <button type="button" class="btn ghost" id="btn-reopened-match-instant">${escapeHtml(
        en ? "Skip to report" : "直接出战报"
      )}</button>
    </div>`;
  openSharedModal();
  // 「接着看」是用户明确点的 ⇒ 直接开直播，不必再让他去点一次「直播」按钮。
  $("#btn-reopened-match-resume")?.addEventListener("click", () => {
    closeModal();
    runMatch("live", { resume: true });
  });
  // 「从头重看」只关弹窗：用户随后自己点直播/快速按钮，这里不替他做决定。
  $("#btn-reopened-match-replay")?.addEventListener("click", () => closeModal());
  $("#btn-reopened-match-instant")?.addEventListener("click", () => {
    closeModal();
    runMatch("instant");
  });
}

// ---------- 沉浸模式（点空白球场切换） ----------
/**
 * 点空白球场 → 隐藏 比分条 / 控球率条 / 控制条，把高度全还给球场；再点一次恢复。
 *
 * 为什么是「点球场」而不是「N 秒无操作自动隐藏」：
 * v276 刚做完**全屏键可发现性**（控制条 6 个图标键同色同尺寸、用户找不到 ⇒
 * 改成主题色高亮 + 开赛 toast 提示）。**自动隐藏会让那个按钮再次找不到。**
 * 点球场是用户主动控制，且进入时给一次明确提示（含退出方式），
 * 不会出现「藏起来就回不来」。
 *
 * 收益（实测 800×295，等效真机去掉浏览器工具栏）：比分条 38.1 + 控球条 18.3 +
 * 控制条 51 ⇒ 可见球场还能再涨 ~100px。详见
 * `docs/measurements/mobile-match-chrome-2026-09-22.txt`。
 *
 * @param {boolean} [force] 省略则取反
 */
function toggleMatchImmersive(force) {
  const layout = document.querySelector(".match-layout");
  if (!layout) return;
  const next = force === undefined ? !layout.classList.contains("mp-immersive") : !!force;
  layout.classList.toggle("mp-immersive", next);
  // 布局变了（控制条在流里消失/出现）⇒ 让视图重算尺寸与镜头。
  // 有 ResizeObserver 兜底，但这里显式调一次可以让第一帧就不糊。
  if (matchView?.refreshLayout) requestAnimationFrame(() => matchView.refreshLayout());
  if (next && matchView?.setCaption) {
    // ⚠ 必须有这句：否则用户点一下球场，控制条「凭空消失」，不知道还能不能回来。
    const msg =
      getLang() === "en"
        ? "Immersive view · tap the pitch to bring the controls back"
        : "沉浸模式 · 再点球场恢复控制";
    matchView.setCaption(msg, "info", 2600);
    // 场内字幕只有一个槽（`#mp-caption`），开赛前后会被「比赛开始！」「☀️ 晴朗」
    // 这类转瞬即逝的字幕顶掉 —— 实测截图里就出现过一次。
    // 沉浸提示是**可发现性**信息（丢了用户就不知道控制条能不能回来），
    // 所以 1.5s 后再确认一次。第二次若仍被顶掉，用户再点一下球场也能恢复。
    setTimeout(() => {
      if (document.querySelector(".match-layout")?.classList.contains("mp-immersive")) {
        matchView.setCaption(msg, "info", 2200);
      }
    }, 1500);
  }
}

/** 开赛后收起赛前简报卡片（评论流仍保留） */
function hidePrematchBriefPanel() {
  const panel = $("#match-pre-brief");
  if (panel) {
    panel.classList.add("hidden");
  }
}

/** FM-style scoreboard: club crests, names and competition context. */
function setupMatchScoreboard(home, away, fixture) {
  ensureKit(home);
  ensureKit(away);
  const setName = (id, club) => {
    const el = $(id);
    if (el) el.textContent = clubDisplayName(club);
  };
  const setShort = (id, club) => {
    const el = $(id);
    if (el) el.textContent = club.short || "";
  };
  setName("#match-home", home);
  setName("#match-away", away);
  setShort("#match-home-short", home);
  setShort("#match-away-short", away);
  const hk = $("#match-home-kit");
  const ak = $("#match-away-kit");
  if (hk) hk.innerHTML = clubCrestHtml(home, { size: 30, className: "match-club-crest", decorative: true });
  if (ak) ak.innerHTML = clubCrestHtml(away, { size: 30, className: "match-club-crest", decorative: true });
  const ctx = $("#match-context");
  if (ctx) {
    ctx.textContent =
      fixture.competition === "cup"
        ? fixture.roundLabel || t("match.cup")
        : t("match.leagueRound", { n: fixture.round || "?" });
  }
}

function setMatchScore(hg, ag) {
  const h = $("#match-home-score");
  const a = $("#match-away-score");
  if (h) h.textContent = String(hg ?? 0);
  if (a) a.textContent = String(ag ?? 0);
  const legacy = $("#match-score");
  if (legacy) legacy.textContent = `${hg ?? 0} - ${ag ?? 0}`;
  matchView?.setBroadcastState?.({ homeGoals: hg ?? 0, awayGoals: ag ?? 0 });
}

let displayedMatchMinute = 0;

function setMatchMinute(min, { reset = false, simT = null } = {}) {
  displayedMatchMinute = nextDisplayedMinute(displayedMatchMinute, min, { reset });
  const el = $("#match-minute");
  if (el) el.textContent = `${Math.floor(displayedMatchMinute)}'`;
  matchView?.setBroadcastState?.({ minute: displayedMatchMinute });
  // 进度记账：服务「重开直播会从 0′ 重演」这条提醒 + ④-B 的续播点，不参与播放逻辑。
  // ① `reset` 那次是时钟边界或「刚进比赛界面」，不代表用户看过 —— 尤其 openMatch 的
  //    setMatchMinute(0, { reset: true })，真记了就会把进度写成 0′。
  // ② 已完赛场次不再提示（openMatch 里另有 clearMatchProgress）。
  // ③ 只记整分钟：直播时 onSimT 每帧都走到这里，而 sessionStorage 是同步 API。
  // ④ `simT` 是**模拟秒**（续播点用它，比整分钟精确）；缺失时沿用上一次的值 ——
  //    收尾那几处 `setMatchMinute(45/90)` 不带 simT，不该把续播点抹成 null。
  if (!reset && min >= 1 && pendingMatch && !pendingMatch.played) {
    const key = matchProgressKey(pendingMatch);
    const minute = Math.floor(min);
    const t = Number.isFinite(Number(simT)) ? Number(simT) : null;
    if (key !== lastMatchProgressWrite.key || minute > lastMatchProgressWrite.minute) {
      const nextSimT = t != null ? t : lastMatchProgressWrite.simT;
      if (writeMatchProgress({ key, minute, at: Date.now(), simT: nextSimT ?? 0 })) {
        lastMatchProgressWrite = { key, minute, simT: nextSimT ?? 0 };
      }
    }
  }
}

/**
 * 更新计分板下 xG / 控球 / 射门
 * @param {null | { home?: object, away?: object } | object} snapOrReport
 *   可传 liveSnap、match report、或 { home: {xg,possession,shots,shotsOn}, away: ... }
 */
function updateLiveStats(snapOrReport) {
  const empty = { xg: 0, possession: 50, shots: 0, shotsOn: 0 };
  let h = empty;
  let a = empty;
  if (snapOrReport) {
    // liveSnap 或 report 结构
    if (snapOrReport.home && (snapOrReport.home.xg != null || snapOrReport.home.possession != null)) {
      h = { ...empty, ...snapOrReport.home };
      a = { ...empty, ...snapOrReport.away };
    }
  }
  const set = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };
  const fmtXg = (n) => (Number(n) || 0).toFixed(2);
  set("#stat-xg-h", fmtXg(h.xg));
  set("#stat-xg-a", fmtXg(a.xg));
  set("#stat-poss-h", `${Math.round(h.possession ?? 50)}%`);
  set("#stat-poss-a", `${Math.round(a.possession ?? 50)}%`);
  set("#stat-shots-h", `${h.shots || 0} (${h.shotsOn || 0})`);
  set("#stat-shots-a", `${a.shots || 0} (${a.shotsOn || 0})`);
  // FMM 底栏控球条
  try {
    matchView?.setFmmPossession?.(h.possession ?? 50, a.possession ?? 50);
    matchView?.setFmmSpeedLabel?.(matchSpeed);
  } catch (_) {
    /* ignore */
  }

  const xgH = Number(h.xg) || 0;
  const xgA = Number(a.xg) || 0;
  const xgT = xgH + xgA || 1;
  const shH = Number(h.shots) || 0;
  const shA = Number(a.shots) || 0;
  const shT = shH + shA || 1;
  const possH = Math.round(h.possession ?? 50);

  const bar = (id, pct) => {
    const el = $(id);
    if (el) el.style.width = `${clampPct(pct)}%`;
  };
  bar("#stat-xg-bar-h", (xgH / xgT) * 100);
  bar("#stat-xg-bar-a", (xgA / xgT) * 100);
  bar("#stat-sh-bar-h", (shH / shT) * 100);
  bar("#stat-sh-bar-a", (shA / shT) * 100);
  bar("#stat-poss-bar", possH);

  // 球场角标迷你条（不挡视线）
  if (matchView?.updateLiveStrip) {
    matchView.updateLiveStrip({
      home: { xg: xgH, possession: possH },
      away: { xg: xgA, possession: 100 - possH },
    });
  }
}

function clampPct(n) {
  return Math.max(4, Math.min(96, n));
}

/** FMM：xG/控球/射门 折叠抽屉 */
function setMatchStatsPanelOpen(open) {
  const panel = $("#match-live-stats");
  const btn = $("#btn-match-stats-toggle");
  if (!panel) return;
  const isOpen = !!open;
  panel.classList.toggle("collapsed", !isOpen);
  if (isOpen) panel.removeAttribute("hidden");
  else panel.setAttribute("hidden", "");
  if (btn) btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function toggleMatchStatsPanel() {
  const panel = $("#match-live-stats");
  if (!panel) return;
  const open = panel.classList.contains("collapsed") || panel.hasAttribute("hidden");
  setMatchStatsPanelOpen(open);
}

/** @param {'pre'|'live'|'ht'|'ft'} state */
function setMatchLiveState(state) {
  const live = document.querySelector(".fm-sb-live");
  const badge = $("#match-com-badge");
  // 布局态：赛前让出高度给简报/讲话，避免底栏与下拉被裁
  const layout = document.querySelector(".match-layout.fm-match");
  if (layout) {
    layout.classList.remove("pre-kickoff", "live-kick", "ht-kick", "ft-kick");
    if (state === "pre") layout.classList.add("pre-kickoff");
    else if (state === "ht") layout.classList.add("ht-kick");
    else if (state === "ft") layout.classList.add("ft-kick");
    else layout.classList.add("live-kick");
  }
  if (live) {
    live.classList.remove("is-idle", "is-ft");
    if (state === "pre" || state === "ht") {
      live.classList.add("is-idle");
      live.innerHTML =
        state === "ht"
          ? `<span class="fm-live-dot"></span> HT`
          : `<span class="fm-live-dot"></span> PRE`;
    } else if (state === "ft") {
      live.classList.add("is-ft");
      live.textContent = "FT";
    } else {
      live.innerHTML = `<span class="fm-live-dot"></span> LIVE`;
    }
  }
  if (badge) {
    badge.className = "fm-com-badge" + (state !== "pre" ? " " + state : "");
    badge.textContent = state === "pre" ? "PRE" : state.toUpperCase();
  }
  // 布局 class 切换后球场高度会变，必须重测 canvas（否则要手动缩放页面才正常）
  matchView?.refreshLayout?.();
}

function setMatchBusy(busy) {
  liveRunning = busy;
  $("#btn-sim-fast").disabled = busy;
  $("#btn-sim-live").disabled = busy;
  const inst = $("#btn-sim-instant");
  if (inst) inst.disabled = busy;
}

/**
 * mode: "fast" | "live" | "instant"
 * fast/live 在中场暂停；instant 一键完赛
 * @param {{ resume?: boolean }} [opts] `resume` 时从进度记录的模拟秒接着播（④-B）。
 *   ⚠ 只有「接着看」按钮传 true —— 用户自己点直播/快速仍是「从 0′ 重演」的既有语义。
 */
async function runMatch(mode, { resume = false } = {}) {
  if (!pendingMatch || pendingMatch.played || liveRunning) return;
  clearMatchResume();
  // ⚠ 这里 `matchState` 还是 null（会话在下面才建），所以只算「是否续播」，
  //   `_hlIntroShown` 等建完会话再打（见下方 createMatchSession 之后）。
  let resumeArmed = false;
  if (resume && pendingMatch && !pendingMatch.played) {
    const rec = readMatchProgress();
    const simT = Number(rec?.simT);
    if (rec && rec.key === matchProgressKey(pendingMatch) && Number.isFinite(simT) && simT > 0) {
      matchResumeSimT = simT;
      matchResumeMinute = Math.floor(rec.minute);
      resumeArmed = true;
    }
  }
  setMatchBusy(true);
  hidePrematchBriefPanel();
  hideHtPanel();
  hideMatchReport();
  // 保留赛前简报行，只清掉旧比赛残留（若有）
  const logEl = $("#match-log");
  if (logEl) {
    const kept = [...logEl.querySelectorAll(".event.briefing")];
    logEl.innerHTML = "";
    for (const n of kept) logEl.appendChild(n);
    // 若无简报（异常路径），补写一次
    if (!kept.length && pendingMatch) {
      const user = getUserClub(world);
      const brief = buildBriefingForFixture(pendingMatch, user);
      if (brief) {
        for (const text of briefingLogLines(brief)) {
          appendMatchEvent({ type: "briefing", text, minute: 0 });
        }
        if (brief.oppReport) {
          for (const text of opponentReportLogLines(brief.oppReport, getLang() === "en" ? "en" : "zh")) {
            appendMatchEvent({ type: "briefing", text, minute: 0 });
          }
        }
      }
    }
  }
  resetMatchPlayback({ keepStepMode: true });
  matchPlayback.controlsEnabled = true;
  updateMatchPlaybackUI();

  try {
    // 确保球场已挂载
    await ensureMatchPitch();
    setMatchLiveState("live");

    // 读取赛前讲话（面板隐藏前）
    const prePanel = $("#match-pre-brief");
    const userClub = getUserClub(world);
    const coachRunsMatch = shouldStaffHandleMatchday(world, userClub);
    if (!coachRunsMatch) {
      selectedPreTalk = getSelectedTeamTalk(prePanel, "pre-team-talk") || selectedPreTalk || "encourage";
    }

    if (mode === "instant") {
      // 纯战报：同步算完 → 灌事件日志 → 直接赛后报告（不播球场动画）
      const layout = document.querySelector(".match-layout");
      layout?.classList.add("match-report-only");
      if (matchView) {
        try {
          matchView.setSimDrive?.(false);
          matchView.setFrozen?.(true);
          matchView.setBanner?.("");
          matchView.setCaption?.(
            getLang() === "en" ? "Instant report · no pitch replay" : "一键战报 · 不播放球场动画",
            "info",
            1800
          );
        } catch (_) {
          /* ignore */
        }
      }
      const result = simulateMatch(world, pendingMatch, coachRunsMatch ? {} : { teamTalkId: selectedPreTalk });
      let goalCursor = 0;
      for (const ev of result.events || []) {
        if (ev.type === "tick" || !ev.text) continue;
        if (ev.type === "goal") {
          rememberGoalReplay(
            ev,
            { homeGoals: result.homeGoals, awayGoals: result.awayGoals, minute: ev.minute },
            pendingMatch
          );
          appendMatchEvent(ev, { goalIndex: goalCursor++ });
        } else {
          appendMatchEvent(ev);
        }
      }
      setMatchScore(result.homeGoals, result.awayGoals);
      setMatchMinute(90);
      updateLiveStats(result.report || pendingMatch.matchReport);
      setMatchLiveState("ft");
      showMatchReport(result.report || pendingMatch.matchReport);
      finishMatchUI();
      saveGame(world);
      toast(getLang() === "en" ? "Full-time report ready" : "全场战报已生成");
      return;
    }

    matchState = createMatchSession(world, pendingMatch);
    // ④-B：续播时不弹通用的「高光观赛 · 平淡时段已跳过」开场字幕 ——
    // 续播横幅更具体，两条叠在一起只会互相盖。
    if (resumeArmed) matchState._hlIntroShown = true;
    // 赛前队内讲话 → 士气 + 上半场修正 + 媒体（事件经 playFirstHalf onEvent / 快速日志刷出）
    const talkRes = coachRunsMatch
      ? applyManagedTeamTalk(matchState, "pre")
      : applyTeamTalk(matchState, selectedPreTalk, "pre");
    if (talkRes.ok) toast(talkRes.msg);
    // 队内讲话 toast 2200ms；被它盖掉就等于没提示，所以等它消失再指全屏键。
    maybeHintFullscreenEntry({ delayMs: talkRes.ok ? 2600 : 400 });
    // 会话创建后阵容可能 autoLineup，刷新球场
    await ensureMatchPitch(true);
    document.querySelector(".match-layout")?.classList.remove("match-report-only");
    const live = mode === "live";
    matchState._liveMode = live;
    // 用户场（直播 + 快速）高光真帧投影
    if (matchView?.setSimDrive) matchView.setSimDrive(true);
    const onEvent = async (ev, snap) => {
      if (ev?._simLive) {
        handleSimLiveEvent(ev, snap);
        return;
      }
      if (snap?.home && ev?.type !== "sim_frame") updateLiveStats(snap);
      await driveMatchEvent(ev, snap, { live });
    };

    // 进场动画：两队从各自一侧场边跑入阵型位（约 2s，可点击/按键跳过）。
    // 位置在 `playFirstHalf` **之前** —— 时序必须是「入场 → 开球 → 上半场」。
    // 只做表现层位移（画在 canvas 上，见 `matchview.js` 的 `_introOffsetX`），
    // 不碰引擎：`_kickoff` 已经把 22 人摆在合法开球位了。
    // 每场比赛只播一次（`matchState._introPlayed`），避免快速模式下反复重播。
    //
    // 时长按模式区分：直播（用户要看的场次）给足 2s 的仪式感；「快速」
    // 模式是用户明确要「赶紧出结果」的路径，被 2s 动画挡住会很烦 ——
    // 给 700ms 的短促入场（`planIntro` 会自动压缩位移时长）。
    if (!matchState._introPlayed && matchView?.playPlayerIntro) {
      matchState._introPlayed = true;
      try {
        await matchView.playPlayerIntro(live ? 2000 : 700);
      } catch (_) {
        /* 动画失败绝不能挡住比赛开球 */
      }
    }

    await playFirstHalf(matchState, {
      onEvent,
      // 直播与快速均走高光帧播放（快速更干脆，倍速仍生效）
      playHighlightPlan: playHighlightPlanBridge,
    });

    // 半场对齐 HUD（高光流已边播边写评论，无需再批量灌日志）
    setMatchScore(matchState.hg, matchState.ag);
    setMatchMinute(45);
    if (matchState.stats) {
      updateLiveStats({
        home: {
          xg: Math.round(matchState.stats.home.xg * 100) / 100,
          shots: matchState.stats.home.shots,
          shotsOn: matchState.stats.home.shotsOn,
          possession: (() => {
            const ht = matchState.stats.home.possessionTicks;
            const at = matchState.stats.away.possessionTicks;
            const t = ht + at || 1;
            return Math.round((ht / t) * 100);
          })(),
        },
        away: {
          xg: Math.round(matchState.stats.away.xg * 100) / 100,
          shots: matchState.stats.away.shots,
          shotsOn: matchState.stats.away.shotsOn,
          possession: (() => {
            const ht = matchState.stats.home.possessionTicks;
            const at = matchState.stats.away.possessionTicks;
            const t = ht + at || 1;
            return 100 - Math.round((ht / t) * 100);
          })(),
        },
      });
    }

    // 中场暂停：停掉播放控制，避免卡在「下一步」
    matchPlayback.controlsEnabled = false;
    matchPlayback.paused = false;
    if (matchView?.setFrozen) matchView.setFrozen(false);
    if (matchPlayback.stepResolve) matchPlayback.stepResolve();
    updateMatchPlaybackUI();
    setMatchLiveState("ht");
    setMatchBusy(false);
    openHalfTimePanel();
  } catch (err) {
    console.error(err);
    toast(t("match.err", { msg: err.message || err }));
    matchPlayback.controlsEnabled = false;
    if (matchPlayback.stepResolve) matchPlayback.stepResolve();
    updateMatchPlaybackUI();
    setMatchBusy(false);
  }
}

async function ensureMatchPitch(remount = false) {
  const pitchRoot = $("#match-pitch-root");
  if (!pitchRoot || !pendingMatch) return;
  const home = world.clubs.find((c) => c.id === pendingMatch.home);
  const away = world.clubs.find((c) => c.id === pendingMatch.away);
  if (!home || !away) return;
  const { getMatchView } = await loadMatchViewModule();
  const onPlayerClick = (playerId) => {
    // 完整资料弹窗（暂停时最合适，进行中也可点）
    showPlayerModal(playerId);
  };
  const onMotionStatus = (status) => updateMotionCaptureUI(status);
  const report = pendingMatch.matchReport || matchState?.report || null;
  const broadcastContext = {
    derby: !!(matchState?.derby ?? pendingMatch.derby),
    bigMatch: !!matchState?.bigMatch,
    knockout: !!(
      matchState?.isKnockout ||
      ["domestic-cup", "continental-knockout"].includes(pendingMatch.competitionType)
    ),
    importance: Number(matchState?.importance) || 0.62,
    attendance: report?.ticketAttendance,
    capacity: report?.ticketCapacity,
    attendanceRatio: report?.ticketFillPct ? Number(report.ticketFillPct) / 100 : 0.84,
  };
  // 点空白球场 = 沉浸模式开关（见 `toggleMatchImmersive`）。
  // ⚠ 不能另挂一个 `fieldEl` 监听器：`matchview.js` 那个既有处理器已经用
  //   `closest(".mp-grass"/".mp-lines")` 把球员热区排除掉了，另起一个会连球员一起吃掉。
  const onPitchTap = () => toggleMatchImmersive();
  if (!matchView || remount || !matchView._built) {
    matchView = getMatchView(pitchRoot);
    matchView.mount(home, away, {
      onPlayerClick,
      onMotionStatus,
      onPitchTap,
      cameraPreset: matchCamera,
      broadcastContext,
    });
  } else {
    matchView.setOnPlayerClick(onPlayerClick);
    matchView.setOnMotionStatus?.(onMotionStatus);
    matchView.setOnPitchTap?.(onPitchTap);
    matchView.setBroadcastContext?.(broadcastContext);
    matchView.setCameraPreset?.(matchCamera, { persist: false });
  }
  matchView.setBroadcastState?.({
    minute: displayedMatchMinute,
    homeGoals: matchState?.hg ?? pendingMatch.homeGoals ?? 0,
    awayGoals: matchState?.ag ?? pendingMatch.awayGoals ?? 0,
  });
  matchView?.refreshLayout?.();
  updateMotionCaptureUI(matchView?.getMotionDiagnosticStatus?.());
}

function hideHtPanel() {
  $("#match-ht-panel")?.classList.add("hidden");
  const fit = $("#match-ht-fitness");
  if (fit) {
    fit.classList.add("hidden");
    fit.innerHTML = "";
  }
}

function openHalfTimePanel() {
  const panel = $("#match-ht-panel");
  if (!panel || !matchState) return;
  const club = matchState.userClub;
  const coachRunsMatch = shouldStaffHandleMatchday(world, club);
  panel.classList.remove("hidden");
  panel.classList.toggle("coach-controlled", coachRunsMatch);
  setLiveTacBarVisible(false);
  pendingSubs = [];
  ensureTactics(club);
  const tac = club?.tactics || {};
  const htScoreEl = $("#match-ht-score");
  if (htScoreEl) {
    htScoreEl.textContent = t("match.htScore", {
      home: clubDisplayName(matchState.home),
      away: clubDisplayName(matchState.away),
      hg: matchState.hg,
      ag: matchState.ag,
      max: matchState.maxSubs,
      used: matchState.subsUsed[matchState.userSide] || 0,
    });
    delete htScoreEl.dataset.htBase;
  }
  $("#ht-style").value = tac.style || "balanced";
  const htForm = $("#ht-formation");
  if (htForm) htForm.value = tac.formation || "4-3-3";
  $("#ht-pressing").value = tac.pressing ?? 3;
  $("#ht-tempo").value = tac.tempo ?? 3;
  $("#ht-pressing-val").textContent = String(tac.pressing ?? 3);
  $("#ht-tempo-val").textContent = String(tac.tempo ?? 3);
  const htW = $("#ht-width");
  const htDl = $("#ht-def-line");
  if (htW) {
    htW.value = tac.width ?? 3;
    const el = $("#ht-width-val");
    if (el) el.textContent = String(tac.width ?? 3);
  }
  if (htDl) {
    htDl.value = tac.defensiveLine ?? 3;
    const el = $("#ht-def-line-val");
    if (el) el.textContent = String(tac.defensiveLine ?? 3);
  }
  renderHtTips();
  renderHtTeamTalk();
  renderHtFitnessBars();
  renderHtRoleReview();
  renderHtRoleEditors();
  panel.querySelector(".ht-tactics")?.classList.toggle("hidden", coachRunsMatch);
  panel.querySelector(".ht-subs")?.classList.toggle("hidden", coachRunsMatch);
  $("#match-ht-roles")?.classList.toggle("hidden", coachRunsMatch);
  const continueButton = $("#btn-ht-continue");
  if (continueButton) {
    continueButton.textContent = coachRunsMatch
      ? (getLang() === "en" ? "Accept coach decisions · 2nd half" : "查看主教练安排 · 开始下半场")
      : (getLang() === "en" ? "Start 2nd half" : "下半场开始");
  }
  $("#btn-ht-skip")?.classList.toggle("hidden", coachRunsMatch);
  const htFormEl = $("#ht-formation");
  if (htFormEl && !htFormEl.dataset.roleBound) {
    htFormEl.dataset.roleBound = "1";
    htFormEl.addEventListener("change", () => {
      if (!matchState?.userClub) return;
      const club = matchState.userClub;
      if (shouldStaffHandleMatchday(world, club)) return;
      ensureTactics(club);
      const next = htFormEl.value;
      if (next && FORMATIONS[next] && next !== club.tactics.formation) {
        club.tactics.formation = next;
        ensureMatchLineup(club);
        ensureLineupRoles(club, { reset: true });
        toast(
          getLang() === "en"
            ? `Formation -> ${next} · roles reset`
            : `阵型改为 ${next} · 角色已按默认重配`
        );
      }
      renderHtRoleEditors();
      renderHtSubSelects();
      void ensureMatchPitch(true);
    });
  }
  renderHtSubSelects();
  renderHtSubsList();
  if (matchView) {
    matchView.phase = "pause";
    matchView.setBanner(getLang() === "en" ? "HALF-TIME" : "中场休息", "info");
    matchView._syncClickable?.();
  }
  $("#btn-match-continue").disabled = true;
  $("#btn-sim-fast").disabled = true;
  $("#btn-sim-live").disabled = true;
  const inst = $("#btn-sim-instant");
  if (inst) inst.disabled = true;
}

/** 中场：上半场角色复盘 */
function renderHtRoleReview() {
  const box = $("#match-ht-role-review");
  if (!box || !matchState) return;
  const en = getLang() === "en";
  const rev = buildRoleReview(matchState, { untilMinute: 45 });
  if (!rev) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const tips = (rev.tips || [])
    .map((line) => `<div class="ht-role-tip">• ${escapeHtml(line)}</div>`)
    .join("");
  const contrib = (rev.contributors || [])
    .slice(0, 4)
    .map((r) => {
      const lab = en ? r.roleLabelEn : r.roleLabel;
      const bits = [];
      if (r.goals) bits.push(`${r.goals}G`);
      if (r.assists) bits.push(`${r.assists}A`);
      return `<span class="ht-role-chip">${escapeHtml(r.name)} <em>${escapeHtml(lab)}</em> ${bits.join(" ")}</span>`;
    })
    .join("");
  box.innerHTML = `
    <div class="ht-role-review-head">
      <strong>${escapeHtml(en ? "1st-half role review" : "上半场角色复盘")}</strong>
      <span class="muted">${escapeHtml(rev.formation || "")}</span>
    </div>
    ${contrib ? `<div class="ht-role-contrib">${contrib}</div>` : ""}
    <div class="ht-role-tips">${tips}</div>
  `;
  box.classList.remove("hidden");
}

/** 中场：下半场角色指令编辑 */
function renderHtRoleEditors() {
  const box = $("#match-ht-roles");
  if (!box || !matchState?.userClub) return;
  const club = matchState.userClub;
  ensureTactics(club);
  ensureLineupRoles(club);
  const en = getLang() === "en";
  const formation = FORMATIONS[club.tactics.formation] || FORMATIONS["4-3-3"];
  const slots = formation.slots || [];
  const lineup = club.tactics.lineup || [];
  const roles = club.tactics.roles || [];
  const duties = club.tactics.duties || [];
  const rows = slots
    .map((slot, i) => {
      const pid = lineup[i];
      const p = club.players.find((x) => x.id === pid);
      const detailed = slotPositionCode(slot, i, slots);
      const rid = roles[i] || getSlotRole(club, i);
      const dutyId = duties[i] || getSlotDuty(club, i);
      const opts = rolesForDetailedPosition(detailed)
        .map((id) => {
          const r = PLAYER_ROLES[id];
          if (!r) return "";
          const lab = en ? r.labelEn : r.label;
          return `<option value="${id}" ${id === rid ? "selected" : ""}>${escapeHtml(lab)}</option>`;
        })
        .join("");
      const dutyOpts = roleDetail(rid).duties
        .map((id) => `<option value="${id}" ${id === dutyId ? "selected" : ""}>${escapeHtml(dutyLabel(id, en ? "en" : "zh"))}</option>`)
        .join("");
      const name = p ? escapeHtml(playerDisplaySurname(p.name, p.nationality) || p.name) : "—";
      return `<label class="ht-role-edit">
        <span class="ht-role-edit-pos">${escapeHtml(detailedPositionLabel(detailed, en ? "en" : "zh"))}</span>
        <span class="ht-role-edit-name">${name}</span>
        <select data-ht-role-slot="${i}">${opts}</select>
        <select data-ht-duty-slot="${i}">${dutyOpts}</select>
      </label>`;
    })
    .join("");
  box.innerHTML = `
    <div class="ht-role-edit-head">
      <strong>${escapeHtml(en ? "Roles for 2nd half" : "下半场角色指令")}</strong>
      <span class="muted">${escapeHtml(en ? "Changing formation resets defaults" : "上方换阵型会重置默认角色")}</span>
    </div>
    <div class="ht-role-edit-grid">${rows}</div>
  `;
  box.querySelectorAll("select[data-ht-role-slot]").forEach((select) => {
    select.addEventListener("change", () => {
      const dutySelect = box.querySelector(`select[data-ht-duty-slot="${select.dataset.htRoleSlot}"]`);
      if (!dutySelect) return;
      const info = roleDetail(select.value);
      dutySelect.innerHTML = info.duties
        .map((id) => `<option value="${id}">${escapeHtml(dutyLabel(id, en ? "en" : "zh"))}</option>`)
        .join("");
      dutySelect.value = info.defaultDuty;
    });
  });
}

function collectHtRoles() {
  const box = $("#match-ht-roles");
  if (!box) return null;
  const sels = box.querySelectorAll("select[data-ht-role-slot]");
  if (!sels.length) return null;
  const roles = [];
  sels.forEach((sel) => {
    roles[+sel.dataset.htRoleSlot] = sel.value;
  });
  return roles;
}

function collectHtDuties() {
  const box = $("#match-ht-roles");
  if (!box) return null;
  const sels = box.querySelectorAll("select[data-ht-duty-slot]");
  if (!sels.length) return null;
  const duties = [];
  sels.forEach((sel) => {
    duties[+sel.dataset.htDutySlot] = sel.value;
  });
  return duties;
}

/** 中场队内讲话选项（按比分推荐默认） */
function renderHtTeamTalk() {
  const box = $("#match-ht-talk");
  if (!box || !matchState) return;
  const en = getLang() === "en";
  if (shouldStaffHandleMatchday(world, matchState.userClub)) {
    box.className = "team-talk-panel coach-controlled";
    box.innerHTML = `<div class="team-talk-head"><strong>${escapeHtml(en ? "Head coach's dressing room" : "主教练更衣室安排")}</strong><span class="muted team-talk-hint">${escapeHtml(en ? "The coach will choose the team talk, tactics and substitutions from the score, fitness and available squad." : "主教练将依据比分、体能和可用阵容决定讲话、战术与换人。")}</span></div>`;
    return;
  }
  const suggested = suggestHalfTimeTalk(matchState) || "encourage";
  // 直接写入内容，避免与 #match-ht-talk 的 panel 套娃
  box.className = "team-talk-panel";
  box.dataset.phase = "ht";
  box.innerHTML = `
    <div class="team-talk-head">
      <strong>${escapeHtml(en ? "Team talk" : "队内讲话")}</strong>
      <span class="muted team-talk-hint">${escapeHtml(
        en
          ? "Sets the tone for the second half · morale + modifiers"
          : "定调下半场 · 影响士气与攻防修正"
      )}</span>
    </div>
    <div class="team-talk-grid">${TEAM_TALK_IDS.map((id) => {
      const talk = TEAM_TALKS[id];
      if (!talk) return "";
      const checked = id === suggested ? "checked" : "";
      const sel = id === suggested ? " selected" : "";
      return `<label class="team-talk-card${sel}">
        <input type="radio" name="ht-team-talk" value="${escapeHtml(id)}" ${checked} />
        <span class="team-talk-label">${escapeHtml(en ? talk.labelEn : talk.label)}</span>
        <span class="team-talk-desc">${escapeHtml(en ? talk.descEn : talk.desc)}</span>
      </label>`;
    }).join("")}</div>`;
  const rec = box.querySelector(`input[value="${suggested}"]`)?.closest(".team-talk-card");
  if (rec) {
    const badge = document.createElement("span");
    badge.className = "team-talk-rec";
    badge.textContent = en ? "Suggested" : "推荐";
    rec.appendChild(badge);
  }
  bindTeamTalkPicker(box);
}

/** 中场：体能告急 / 黄牌边缘 / 比分建议 */
function renderHtTips() {
  const box = $("#match-ht-tips");
  if (!box || !matchState) return;
  const tips = getHalfTimeTips(matchState);
  const en = getLang() === "en";
  const parts = [];
  if (tips.scoreTip) {
    parts.push(
      `<div class="ht-tip score"><strong>${en ? "Score" : "比分"}</strong> ${escapeHtml(en ? localizeHalfTimeScoreTip(tips.scoreTip) : tips.scoreTip)}</div>`
    );
  }
  if (tips.avgFit != null) {
    parts.push(
      `<div class="ht-tip fit"><strong>${en ? "Avg fitness" : "首发体能均"}</strong> ${tips.avgFit}%</div>`
    );
  }
  if (tips.fitness?.length) {
    const list = tips.fitness
      .map((p) => `${escapeHtml(p.name)} <em>${Math.round(p.fitness ?? 0)}%</em>`)
      .join(" · ");
    parts.push(
      `<div class="ht-tip warn"><strong>${en ? "Tired" : "体能告急"}</strong> ${list}</div>`
    );
  }
  if (tips.yellows?.length) {
    const list = tips.yellows
      .map(
        (p) =>
          `${escapeHtml(p.name)}${p.booked ? (en ? " (booked)" : "（本场已黄）") : ` (${p.yellows})`}`
      )
      .join(" · ");
    parts.push(
      `<div class="ht-tip card"><strong>${en ? "Card risk" : "黄牌边缘"}</strong> ${list}</div>`
    );
  }
  if (!parts.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.innerHTML = parts.join("");
  box.classList.remove("hidden");
}

/**
 * 中场：首发体能条（按体能升序，低体能高亮）
 */
function renderHtFitnessBars() {
  const box = $("#match-ht-fitness");
  if (!box || !matchState?.userClub) {
    if (box) {
      box.classList.add("hidden");
      box.innerHTML = "";
    }
    return;
  }
  const club = matchState.userClub;
  const sk = matchState.userSide;
  const sent = matchState.sentOff?.[sk] || new Set();
  const xi = getLineupPlayers(club)
    .filter((p) => p && !sent.has(p.id))
    .slice()
    .sort((a, b) => (a.fitness || 100) - (b.fitness || 100));
  if (!xi.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const en = getLang() === "en";
  // 标题不能再叫「首发体能」：上面的 ht-tip 摘要行已经占了这个词，
  // 同一块面板里出现两个一模一样的标题。这里是逐人明细，叫「各队员体能」。
  const title = en ? "Player fitness" : "各队员体能";
  const rows = xi
    .map((p) => {
      const fit = Math.round(p.fitness ?? 100);
      let cls = "ht-fit-row";
      if (fit < 50) cls += " critical";
      else if (fit < 62) cls += " low";
      else if (fit < 75) cls += " mid";
      const pos = positionLabel(p.pos);
      return `<div class="${cls}" title="${escapeHtml(p.name)} ${fit}%">
        <span class="ht-fit-pos">${escapeHtml(pos)}</span>
        <span class="ht-fit-name">${playerLinkHtml(p.id, p.name)}</span>
        <div class="ht-fit-bar"><i style="width:${fit}%"></i></div>
        <span class="ht-fit-val">${fit}%</span>
      </div>`;
    })
    .join("");
  box.innerHTML = `<div class="ht-fit-title">${escapeHtml(title)}</div>${rows}`;
  box.classList.remove("hidden");
}

function setLiveTacBarVisible(show) {
  const bar = $("#match-live-tac");
  if (!bar) return;
  if (show && matchState?.userClub && shouldStaffHandleMatchday(world, matchState.userClub)) {
    show = false;
  }
  bar.classList.toggle("hidden", !show);
  if (show && matchState?.userClub) {
    ensureTactics(matchState.userClub);
    const tac = matchState.userClub.tactics || {};
    const lf = $("#live-formation");
    if (lf) {
      if (!lf.options.length) {
        lf.innerHTML = Object.keys(FORMATIONS)
          .map((k) => `<option value="${k}">${FORMATIONS[k].name || k}</option>`)
          .join("");
      }
      lf.value = tac.formation || "4-3-3";
    }
    const st = $("#live-style");
    const pr = $("#live-pressing");
    const tm = $("#live-tempo");
    const wi = $("#live-width");
    const dl = $("#live-def-line");
    if (st) st.value = tac.style || "balanced";
    if (pr) {
      pr.value = String(tac.pressing ?? 3);
      const pv = $("#live-pressing-val");
      if (pv) pv.textContent = String(tac.pressing ?? 3);
    }
    if (tm) {
      tm.value = String(tac.tempo ?? 3);
      const tv = $("#live-tempo-val");
      if (tv) tv.textContent = String(tac.tempo ?? 3);
    }
    if (wi) {
      wi.value = String(tac.width ?? 3);
      const wv = $("#live-width-val");
      if (wv) wv.textContent = String(tac.width ?? 3);
    }
    if (dl) {
      dl.value = String(tac.defensiveLine ?? 3);
      const dv = $("#live-def-line-val");
      if (dv) dv.textContent = String(tac.defensiveLine ?? 3);
    }
    const outSelect = $("#live-sub-out");
    const inSelect = $("#live-sub-in");
    const onField = getOnFieldPlayers(matchState.userClub, matchState);
    const bench = getBenchPlayers(matchState.userClub, matchState);
    if (outSelect) {
      outSelect.innerHTML = `<option value="">${getLang() === "en" ? "Player off" : "选择换下"}</option>${onField
        .map((player) => `<option value="${escapeHtml(player.id)}">↓ ${escapeHtml(player.name)} · ${positionLabel(player.pos)} · ${Math.round(player.fitness ?? 100)}%</option>`)
        .join("")}`;
    }
    if (inSelect) {
      inSelect.innerHTML = `<option value="">${getLang() === "en" ? "Player on" : "选择换上"}</option>${bench
        .map((player) => `<option value="${escapeHtml(player.id)}">↑ ${escapeHtml(player.name)} · ${positionLabel(player.pos)} · ${player.ovr}</option>`)
        .join("")}`;
    }
  }
}

function onLiveTacApply() {
  if (!matchState?.userClub || matchState.finished) {
    toast(getLang() === "en" ? "Not available" : "当前无法调整");
    return;
  }
  if (shouldStaffHandleMatchday(world, matchState.userClub)) {
    toast(getLang() === "en" ? "Matchday decisions are managed by the head coach" : "比赛日决策由主教练负责");
    setLiveTacBarVisible(false);
    return;
  }
  // 仅下半场 live 有意义；上半场/中场用 HT 面板
  if (matchState.phase === "ht" || matchState.phase === "h1") {
    toast(getLang() === "en" ? "Use half-time panel" : "请在中场面板调整");
    return;
  }
  const orders = {
    formation: $("#live-formation")?.value,
    style: $("#live-style")?.value,
    pressing: +($("#live-pressing")?.value || 3),
    tempo: +($("#live-tempo")?.value || 3),
    width: +($("#live-width")?.value || 3),
    defensiveLine: +($("#live-def-line")?.value || 3),
  };
  const res = applyLiveTactics(matchState, orders);
  if (!res.ok) {
    toast(res.msg || "失败");
    return;
  }
  if (res.msg === "无变化") {
    toast(t("match.tacNoChange") || (getLang() === "en" ? "No change" : "无变化"));
    return;
  }
  // 画面 + 评论反馈
  const side = matchState.userSide === "away" ? "away" : "home";
  const styleKey = res.tactics.style || "balanced";
  const styleName = t("style." + styleKey) || styleKey;
  if (matchView?.showTacticsFeedback) {
    matchView.showTacticsFeedback(side, {
      style: res.tactics.style,
      pressing: res.tactics.pressing,
      tempo: res.tactics.tempo,
      styleLabel: styleName,
      label: res.event?.text?.replace(/^📋\s*/, "") || undefined,
    });
  }
  if (res.event?.text) appendMatchEvent(res.event);
  // 高压迫 → 表现层开一段攻势
  if (res.tactics.pressing >= 4 && matchView?.beginAttackPhase) {
    matchView.beginAttackPhase(side, { ms: 12000, intensity: 0.75, caption: false });
  }
  toast(
    t("match.tacApplied", {
      style: styleName,
      press: res.tactics.pressing,
      tempo: res.tactics.tempo,
    }) || (getLang() === "en" ? "Tactics applied" : "战术已应用")
  );
}

function onLiveSubApply() {
  if (!matchState?.userClub || matchState.finished) {
    toast(getLang() === "en" ? "Substitution is not available" : "当前无法换人");
    return;
  }
  if (shouldStaffHandleMatchday(world, matchState.userClub)) {
    toast(getLang() === "en" ? "Substitutions are managed by the head coach" : "临场换人由主教练负责");
    return;
  }
  const outId = $("#live-sub-out")?.value;
  const inId = $("#live-sub-in")?.value;
  if (!outId || !inId) {
    toast(getLang() === "en" ? "Select both players" : "请选择换下和换上球员");
    return;
  }
  const minute = Math.max(46, Math.min(89, Number(matchState.minute) || 46));
  const before = matchState.events.length;
  const result = applySubstitution(matchState, matchState.userClub, outId, inId, minute);
  if (!result.ok) {
    toast(result.msg || (getLang() === "en" ? "Substitution failed" : "换人失败"));
    return;
  }
  const event = matchState.events.slice(before).find((item) => item.type === "sub");
  if (event) appendMatchEvent(event);
  toast(getLang() === "en" ? "Substitution queued for the next restart" : "换人已提交，将在下一比赛窗口生效");
  setLiveTacBarVisible(true);
}

function renderHtSubSelects() {
  if (!matchState?.userClub) return;
  const club = matchState.userClub;
  const onField = getOnFieldPlayers(club, matchState);
  const bench = getBenchPlayers(club, matchState);
  const outSel = $("#ht-sub-out");
  const inSel = $("#ht-sub-in");
  if (!outSel || !inSel) return;
  const pendingOut = new Set(pendingSubs.map((s) => s.outId));
  const pendingIn = new Set(pendingSubs.map((s) => s.inId));
  outSel.innerHTML = onField
    .filter((p) => !pendingOut.has(p.id))
    .map(
      (p) =>
        `<option value="${p.id}">${escapeHtml(positionLabel(p.pos))} ${escapeHtml(p.name)} · ${p.ovr} · ${getLang() === "en" ? "Fit" : "体"}${Math.round(p.fitness ?? 0)}</option>`
    )
    .join("");
  inSel.innerHTML = bench
    .filter((p) => !pendingIn.has(p.id))
    .map(
      (p) =>
        `<option value="${p.id}">${escapeHtml(positionLabel(p.pos))} ${escapeHtml(p.name)} · ${p.ovr} · ${getLang() === "en" ? "Fit" : "体"}${Math.round(p.fitness ?? 0)}</option>`
    )
    .join("");
}

function renderHtSubsList() {
  const ul = $("#ht-subs-list");
  const left = $("#ht-subs-left");
  if (!matchState) return;
  const used = (matchState.subsUsed[matchState.userSide] || 0) + pendingSubs.length;
  const remain = Math.max(0, matchState.maxSubs - used);
  if (left) left.textContent = `${t("match.subsLeftFull", { n: remain, max: matchState.maxSubs })}`;
  if (ul) {
    ul.innerHTML = pendingSubs
      .map((s) => `<li>🔄 ${escapeHtml(s.outName)} ↓ → ${escapeHtml(s.inName)} ↑</li>`)
      .join("");
  }
}

function onHtAddSub() {
  if (!matchState?.userClub) return;
  if (shouldStaffHandleMatchday(world, matchState.userClub)) {
    toast(getLang() === "en" ? "Substitutions are managed by the head coach" : "换人由主教练负责");
    return;
  }
  const outId = $("#ht-sub-out")?.value;
  const inId = $("#ht-sub-in")?.value;
  if (!outId || !inId) {
    toast(t("match.pickSub"));
    return;
  }
  const used = (matchState.subsUsed[matchState.userSide] || 0) + pendingSubs.length;
  if (used >= matchState.maxSubs) {
    toast(t("match.subsFull"));
    return;
  }
  if (pendingSubs.some((s) => s.outId === outId || s.inId === inId)) {
    toast(t("match.subDup"));
    return;
  }
  const club = matchState.userClub;
  const outP = club.players.find((p) => p.id === outId);
  const inP = club.players.find((p) => p.id === inId);
  if (!outP || !inP) return;
  pendingSubs.push({
    outId,
    inId,
    outName: outP.name,
    inName: inP.name,
  });
  renderHtSubSelects();
  renderHtSubsList();
  // 中场面板：立刻可见反馈（真正上场在下半场开始时）
  const en = getLang() === "en";
  toast(
    t("match.subQueued", { out: outP.name, inn: inP.name }) ||
      (en ? `Queued: ${outP.name} → ${inP.name}` : `已登记：${outP.name} → ${inP.name}`)
  );
  const tip = $("#match-ht-score");
  if (tip && pendingSubs.length) {
    const base = tip.dataset.htBase || tip.textContent;
    tip.dataset.htBase = base;
    const names = pendingSubs.map((s) => `${s.outName}→${s.inName}`).join(" · ");
    tip.textContent = `${base} · ${en ? "Subs" : "换人"}: ${names}`;
  }
}

/** 下半场开球提示文案（比分 + 是否已调） */
function buildSecondHalfKickTip(applyOrders, orders) {
  const en = getLang() === "en";
  if (!matchState) return en ? "2nd half" : "下半场";
  const club = matchState.userClub;
  const myG = club === matchState.home ? matchState.hg : matchState.ag;
  const opG = club === matchState.home ? matchState.ag : matchState.hg;
  let scoreBit = "";
  if (myG < opG) scoreBit = en ? "Trailing" : "落后";
  else if (myG > opG) scoreBit = en ? "Leading" : "领先";
  else scoreBit = en ? "Level" : "平局";

  if (!applyOrders) {
    return en
      ? `${scoreBit} — no changes, 2nd half`
      : `${scoreBit} · 不调整，下半场开始`;
  }
  const bits = [scoreBit];
  if (orders?.style) {
    bits.push(t("style." + orders.style) || orders.style);
  }
  if (orders?.pressing != null) {
    bits.push(en ? `Press ${orders.pressing}` : `压迫 ${orders.pressing}`);
  }
  if (orders?.tempo != null) {
    bits.push(en ? `Tempo ${orders.tempo}` : `节奏 ${orders.tempo}`);
  }
  if (orders?.width != null) {
    bits.push(en ? `Width ${orders.width}` : `宽度 ${orders.width}`);
  }
  if (orders?.defensiveLine != null) {
    bits.push(en ? `Line ${orders.defensiveLine}` : `防线 ${orders.defensiveLine}`);
  }
  if (orders?.formation) {
    bits.push(orders.formation);
  }
  const nSub = orders?.subs?.length || 0;
  if (nSub) bits.push(en ? `${nSub} sub(s)` : `${nSub} 人换人`);
  return en
    ? `${bits.join(" · ")} — 2nd half`
    : `${bits.join(" · ")} · 下半场开始`;
}

async function finishHalfTime(applyOrders) {
  if (!matchState || matchState.finished || liveRunning) return;
  const coachRunsMatch = shouldStaffHandleMatchday(world, matchState.userClub);
  hideHtPanel();
  setMatchBusy(true);
  matchPlayback.controlsEnabled = true;
  matchPlayback.paused = false;
  if (matchView?.setFrozen) matchView.setFrozen(false);
  updateMatchPlaybackUI();

  const htTalk = coachRunsMatch ? null : getSelectedTeamTalk($("#match-ht-talk"), "ht-team-talk");
  const htRoles = coachRunsMatch ? null : collectHtRoles();
  const htDuties = coachRunsMatch ? null : collectHtDuties();
  const orders = coachRunsMatch
    ? {}
    : applyOrders
    ? {
        style: $("#ht-style")?.value,
        formation: $("#ht-formation")?.value,
        pressing: +($("#ht-pressing")?.value || 3),
        tempo: +($("#ht-tempo")?.value || 3),
        width: +($("#ht-width")?.value || 3),
        defensiveLine: +($("#ht-def-line")?.value || 3),
        roles: htRoles || undefined,
        duties: htDuties || undefined,
        subs: pendingSubs.map((s) => ({ outId: s.outId, inId: s.inId })),
        teamTalk: htTalk,
      }
    : {
        // 「不调整」仍可保留中场讲话（若玩家已选）
        teamTalk: htTalk,
      };

  const kickTip = coachRunsMatch
    ? (getLang() === "en" ? "Head coach decisions applied — 2nd half" : "主教练已完成中场安排 · 下半场开始")
    : buildSecondHalfKickTip(applyOrders, orders);
  try {
    const live = !!matchState._liveMode;
    setMatchLiveState("live");
    // 下半场：直播时显示场边战术条；快速/直播都保持真高光投影
    if (live) setLiveTacBarVisible(true);
    if (matchView?.setSimDrive) matchView.setSimDrive(true);

    // 开球提示（横幅 + 评论）
    if (matchView?.showSecondHalfKickoff) {
      matchView.showSecondHalfKickoff({ text: kickTip, lang: getLang() });
    }
    appendMatchEvent({
      type: "coach",
      minute: 46,
      text: `💬 ${kickTip}`,
    });
    toast(kickTip);

    // continueSecondHalf：中场战术/换人事件会立刻 onEvent
    const onEvent = async (ev, snap) => {
      if (ev?._simLive) {
        handleSimLiveEvent(ev, snap);
        return;
      }
      if (snap?.home) updateLiveStats(snap);
      await driveMatchEvent(ev, snap, { live });
    };

    if (matchView) {
      matchView.phase = "play";
    }

    const result = await continueSecondHalf(matchState, orders, {
      onEvent,
      playHighlightPlan: playHighlightPlanBridge,
    });

    setMatchScore(result.homeGoals, result.awayGoals);
    setMatchMinute(90);
    updateLiveStats(result.report || matchState.report);
    setMatchLiveState("ft");
    showMatchReport(result.report || matchState.report);
    finishMatchUI();
    saveGame(world);
  } catch (err) {
    console.error(err);
    toast(t("match.err2", { msg: err.message || err }));
    matchPlayback.controlsEnabled = false;
    if (matchPlayback.stepResolve) matchPlayback.stepResolve();
    updateMatchPlaybackUI();
    setMatchBusy(false);
  }
}

function hideMatchReport() {
  const el = $("#match-report");
  if (el) {
    el.classList.add("hidden");
    el.innerHTML = "";
  }
}

function reportAnalysisLabels() {
  const en = getLang() === "en";
  return en
    ? {
        title: "Tactical analysis",
        overview: "Overview",
        shots: "Shot map",
        progression: "Progression",
        pressing: "Pressing",
        heatmap: "Action zones",
        network: "Pass network",
        shapes: "Shapes",
        xg: "xG",
        openPlayXg: "Open-play xG",
        avgXg: "xG / shot",
        passCompletion: "Pass completion",
        progressivePasses: "Progressive passes",
        finalThirdEntries: "Final-third entries",
        boxEntries: "Box entries",
        pressures: "Pressures",
        pressureSuccess: "Pressure success",
        highPressures: "High pressures",
        regains: "Regains",
        highRegains: "High regains",
        averageHeight: "Average action height",
        left: "Left",
        center: "Centre",
        right: "Right",
        completed: "completed",
        goal: "Goal",
        saved: "Saved",
        blocked: "Blocked",
        offTarget: "Off target",
        noShots: "No shots",
        noNetwork: "No completed passing links",
        noPositions: "No spatial position sample",
        actualUsage: "Actual phase usage",
        averagePositions: "Average positions",
        baseShape: "Base",
        possessionShape: "In possession",
        outOfPossessionShape: "Out of possession",
        transitionAttack: "Attacking transition",
        transitionDefend: "Defensive transition",
        phaseTimeline: "Decision timeline",
        preMatch: "Pre-match",
        halfTime: "Half-time",
        review: "Match review",
        live: "Touchline",
        coach: "Coach",
        player: "Player",
        manualPlan: "Player plan",
        manualAdjustment: "Player adjustment",
        coachStable: "Coach kept the base shape",
        preMatchGuard: "Pre-match movement guard",
        chasingGame: "Chasing the game",
        protectingLead: "Protecting the lead",
        structuralReview: "Structural review",
        shapeMaintained: "Shape maintained",
      }
    : {
        title: "战术分析",
        overview: "复盘",
        shots: "射门图",
        progression: "推进",
        pressing: "压迫",
        heatmap: "行动热区",
        network: "传球网络",
        shapes: "阵型",
        xg: "期望进球",
        openPlayXg: "运动战 xG",
        avgXg: "每次射门 xG",
        passCompletion: "传球成功率",
        progressivePasses: "推进传球",
        finalThirdEntries: "进入进攻三区",
        boxEntries: "传入禁区",
        pressures: "压迫尝试",
        pressureSuccess: "压迫成功率",
        highPressures: "前场压迫",
        regains: "夺回球权",
        highRegains: "前场夺回",
        averageHeight: "平均行动高度",
        left: "左路",
        center: "中路",
        right: "右路",
        completed: "成功",
        goal: "进球",
        saved: "扑出",
        blocked: "封堵",
        offTarget: "偏出",
        noShots: "没有射门",
        noNetwork: "没有完成传球线路",
        noPositions: "没有空间站位样本",
        actualUsage: "实际阶段用时",
        averagePositions: "真实平均站位",
        baseShape: "基础",
        possessionShape: "持球",
        outOfPossessionShape: "无球",
        transitionAttack: "进攻转换",
        transitionDefend: "防守转换",
        phaseTimeline: "调整时间线",
        preMatch: "赛前",
        halfTime: "中场",
        review: "临场复核",
        live: "场边调整",
        coach: "主教练",
        player: "玩家",
        manualPlan: "玩家方案",
        manualAdjustment: "玩家调整",
        coachStable: "主教练保持基础阵型",
        preMatchGuard: "赛前限制大幅移动",
        chasingGame: "比分落后加强进攻",
        protectingLead: "比分领先加强保护",
        structuralReview: "结构性复核",
        shapeMaintained: "维持阶段阵型",
      };
}

function phaseShapeReasonLabel(reason, labels) {
  return labels[reason] || reason || labels.shapeMaintained;
}

function phaseShapeTriggerLabel(trigger, labels) {
  return labels[
    trigger === "half-time"
      ? "halfTime"
      : trigger === "review"
        ? "review"
        : trigger === "live"
          ? "live"
          : "preMatch"
  ];
}

function shapeUsageSummary(usage, labels) {
  if (!usage) return `<p class="muted analysis-empty">${escapeHtml(labels.noPositions)}</p>`;
  const pct = usage.phasePct || {};
  const rows = [
    [labels.possessionShape, pct["in-possession"]],
    [labels.outOfPossessionShape, pct["out-of-possession"]],
    [labels.transitionAttack, pct["attacking-transition"]],
    [labels.transitionDefend, pct["defensive-transition"]],
  ];
  const body = rows
    .map(([label, value]) => `<div class="shape-usage-row"><span>${escapeHtml(label)}</span><strong>${Number(value || 0).toFixed(1)}%</strong></div>`)
    .join("");
  return `<div class="shape-usage"><div class="shape-usage-total">${escapeHtml(labels.actualUsage)} · ${(Number(usage.totalSeconds || 0) / 60).toFixed(1)} min</div>${body}</div>`;
}

function averagePositionsSvg(side, labels) {
  const positions = side?.averagePositions || [];
  if (!positions.length) return `<p class="muted analysis-empty">${escapeHtml(labels.noPositions)}</p>`;
  const dots = positions
    .map((position) => {
      const cx = Math.max(5, Math.min(95, Number(position.x) || 50));
      const cy = 105 - Math.max(5, Math.min(95, Number(position.y) || 50));
      const number = position.number == null ? "?" : String(position.number);
      const title = `${position.name || position.playerId || "?"} · ${number} · ${cx.toFixed(1)}, ${position.y?.toFixed?.(1) || "0.0"}`;
      return `<g class="analysis-average-position"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" /><text x="${cx.toFixed(1)}" y="${(cy + 1.1).toFixed(1)}" text-anchor="middle">${escapeHtml(number)}</text><title>${escapeHtml(title)}</title></g>`;
    })
    .join("");
  return `<svg class="analysis-pitch analysis-average-pitch" viewBox="0 0 100 110" role="img" aria-label="${escapeHtml(labels.averagePositions)}">${analysisPitchBase()}${dots}</svg>`;
}

function phaseShapeTimelineHtml(phaseShapes, report, labels) {
  const timeline = Array.isArray(phaseShapes?.timeline) ? phaseShapes.timeline : [];
  if (!timeline.length) return `<p class="muted analysis-empty">${escapeHtml(labels.noPositions)}</p>`;
  const names = {
    home: report.home.short || report.home.name,
    away: report.away.short || report.away.name,
  };
  const rows = timeline
    .slice()
    .sort((left, right) => Number(left.minute) - Number(right.minute) || String(left.team).localeCompare(String(right.team)))
    .map((entry) => {
      const teamName = names[entry.team] || entry.team || "?";
      const source = labels[entry.source] || entry.source || labels.coach;
      const scoreGap = Number(entry.scoreGap) || 0;
      const scoreText = scoreGap === 0 ? "0" : scoreGap > 0 ? `+${scoreGap}` : String(scoreGap);
      return `<div class="shape-timeline-row"><time>${Number(entry.minute) || 0}'</time><strong>${escapeHtml(teamName)}</strong><span>${escapeHtml(phaseShapeTriggerLabel(entry.trigger, labels))} · ${escapeHtml(source)}</span><span class="shape-timeline-forms">${escapeHtml(`${entry.baseFormation || "4-3-3"} → ${entry.possessionFormation || entry.baseFormation || "4-3-3"} / ${entry.outOfPossessionFormation || entry.baseFormation || "4-3-3"}`)}</span><small>${escapeHtml(phaseShapeReasonLabel(entry.reason, labels))} · ${escapeHtml(scoreText)}</small></div>`;
    })
    .join("");
  return `<div class="shape-timeline">${rows}</div>`;
}

function analysisCompareRow(label, homeValue, awayValue, suffix = "") {
  return `<div class="analysis-compare-row">
    <strong>${escapeHtml(String(homeValue))}${suffix}</strong>
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(String(awayValue))}${suffix}</strong>
  </div>`;
}

function analysisPitchBase() {
  return `<rect class="analysis-pitch-grass" x="1" y="1" width="98" height="108" rx="2" />
    <path class="analysis-pitch-line" d="M4 5H96V105H4Z M4 55H96 M50 50a5 5 0 1 0 0 10a5 5 0 1 0 0-10 M28 5V22H72V5 M39 5V11H61V5 M28 105V88H72V105 M39 105V99H61V105" />`;
}

function shotMapSvg(side, labels) {
  if (!side?.shots?.length) return `<p class="muted analysis-empty">${escapeHtml(labels.noShots)}</p>`;
  const dots = side.shots
    .map((shot) => {
      const cx = Math.max(4, Math.min(96, Number(shot.x) || 50));
      const cy = 105 - Math.max(0, Math.min(100, Number(shot.y) || 0));
      const radius = Math.max(2.2, Math.min(5.8, 2 + (Number(shot.xg) || 0) * 7));
      const title = `${shot.minute}' ${shot.playerName || ""} · xG ${Number(shot.xg || 0).toFixed(2)} · ${labels[shot.outcome] || shot.outcome}`;
      return `<circle class="analysis-shot ${escapeHtml(shot.outcome || "offTarget")}" cx="${cx}" cy="${cy}" r="${radius}"><title>${escapeHtml(title)}</title></circle>`;
    })
    .join("");
  return `<svg class="analysis-pitch analysis-shot-map" viewBox="0 0 100 110" role="img" aria-label="${escapeHtml(labels.shots)}">
    ${analysisPitchBase()}${dots}
  </svg>`;
}

function heatmapSvg(side, labels) {
  const heatmap = side?.heatmap;
  const cells = heatmap?.cells || [];
  const max = Number(heatmap?.max) || 1;
  const cols = heatmap?.cols || 6;
  const rows = heatmap?.rows || 10;
  const rects = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const value = Number(cells[row * cols + col]) || 0;
      if (!value) continue;
      const opacity = Math.max(0.12, Math.min(0.88, value / max));
      const width = 92 / cols;
      const height = 100 / rows;
      const x = 4 + col * width;
      const y = 5 + (rows - row - 1) * height;
      rects.push(`<rect class="analysis-heat-cell" x="${x}" y="${y}" width="${width}" height="${height}" style="opacity:${opacity.toFixed(2)}"><title>${value}</title></rect>`);
    }
  }
  return `<svg class="analysis-pitch" viewBox="0 0 100 110" role="img" aria-label="${escapeHtml(labels.heatmap)}">
    ${analysisPitchBase()}${rects.join("")}
  </svg>`;
}

function passNetworkSvg(side, labels) {
  const nodes = side?.network?.nodes || [];
  const edges = side?.network?.edges || [];
  if (!nodes.length) return `<p class="muted analysis-empty">${escapeHtml(labels.noNetwork)}</p>`;
  const byId = new Map(nodes.map((node) => [node.playerId, node]));
  const maxEdge = Math.max(1, ...edges.map((edge) => Number(edge.count) || 0));
  const lines = edges
    .map((edge) => {
      const from = byId.get(edge.fromId);
      const to = byId.get(edge.toId);
      if (!from || !to) return "";
      const width = 0.5 + ((Number(edge.count) || 0) / maxEdge) * 2.6;
      return `<line class="analysis-pass-edge" x1="${from.x}" y1="${105 - from.y}" x2="${to.x}" y2="${105 - to.y}" style="stroke-width:${width.toFixed(2)}"><title>${escapeHtml(`${from.name} → ${to.name}: ${edge.count}`)}</title></line>`;
    })
    .join("");
  const nodeShapes = nodes.map((node) => ({
    node,
    cx: Number(node.x),
    cy: 105 - Number(node.y),
    radius: Math.max(2.7, Math.min(5, 2.5 + (Number(node.passes) + Number(node.received)) / 12)),
    short: String(node.name || "?").trim().split(/\s+/).slice(-1)[0].slice(0, 8),
  }));
  const circleBoxes = nodeShapes.map((shape) => ({
    left: shape.cx - shape.radius - 0.6,
    right: shape.cx + shape.radius + 0.6,
    top: shape.cy - shape.radius - 0.6,
    bottom: shape.cy + shape.radius + 0.6,
  }));
  const labelBoxes = [];
  const overlaps = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const labelFor = (shape, index) => {
    const width = Math.max(5.5, shape.short.length * 1.9);
    const height = 3.8;
    const gap = 1.2;
    const candidates = [
      { x: shape.cx, y: shape.cy - shape.radius - gap, anchor: "middle", side: "above" },
      { x: shape.cx, y: shape.cy + shape.radius + gap + height, anchor: "middle", side: "below" },
      { x: shape.cx + shape.radius + gap, y: shape.cy + height / 3, anchor: "start", side: "right" },
      { x: shape.cx - shape.radius - gap, y: shape.cy + height / 3, anchor: "end", side: "left" },
    ];
    const rotated = candidates.slice(index % candidates.length).concat(candidates.slice(0, index % candidates.length));
    for (const candidate of rotated) {
      const left = candidate.anchor === "middle" ? candidate.x - width / 2 : candidate.anchor === "start" ? candidate.x : candidate.x - width;
      const box = { left, right: left + width, top: candidate.y - height, bottom: candidate.y + 0.6 };
      if (box.left < 4 || box.right > 96 || box.top < 5 || box.bottom > 105) continue;
      if (circleBoxes.some((circle, circleIndex) => circleIndex !== index && overlaps(box, circle))) continue;
      if (labelBoxes.some((placed) => overlaps(box, placed))) continue;
      labelBoxes.push(box);
      return candidate;
    }
    return null;
  };
  const circles = nodeShapes
    .map((shape, index) => {
      const label = labelFor(shape, index);
      const text = label
        ? `<text x="${label.x}" y="${label.y}" text-anchor="${label.anchor}" data-label-side="${label.side}">${escapeHtml(shape.short)}</text>`
        : "";
      return `<g class="analysis-pass-node"><circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.radius}" />${text}<title>${escapeHtml(`${shape.node.name} · ${shape.node.passes} ${labels.completed}`)}</title></g>`;
    })
    .join("");
  return `<svg class="analysis-pitch" viewBox="0 0 100 110" role="img" aria-label="${escapeHtml(labels.network)}">
    ${analysisPitchBase()}${lines}${circles}
  </svg>`;
}

function tacticalInsights(analysis, report, labels) {
  const en = getLang() === "en";
  const home = analysis.home;
  const away = analysis.away;
  const hn = report.home.short || report.home.name;
  const an = report.away.short || report.away.name;
  const lines = [];
  const hAvg = home.shots.length ? home.xg / home.shots.length : 0;
  const aAvg = away.shots.length ? away.xg / away.shots.length : 0;
  const chanceSide = Math.abs(hAvg - aAvg) >= 0.025 ? (hAvg > aAvg ? [hn, home, hAvg] : [an, away, aAvg]) : null;
  if (chanceSide) {
    lines.push(en
      ? `${chanceSide[0]} created the cleaner average chance (${chanceSide[2].toFixed(2)} xG per shot from ${chanceSide[1].shots.length} attempts).`
      : `${chanceSide[0]}的平均机会质量更高（${chanceSide[1].shots.length} 次射门，每次 ${chanceSide[2].toFixed(2)} xG）。`);
  } else {
    lines.push(en
      ? `Average chance quality was similar (${hAvg.toFixed(2)}-${aAvg.toFixed(2)} xG per shot).`
      : `双方平均机会质量接近（每次射门 xG ${hAvg.toFixed(2)}-${aAvg.toFixed(2)}）。`);
  }

  const hp = home.progression;
  const ap = away.progression;
  const advanceName = hp.progressivePasses + hp.finalThirdEntries >= ap.progressivePasses + ap.finalThirdEntries ? hn : an;
  const advance = advanceName === hn ? hp : ap;
  lines.push(en
    ? `${advanceName} led ball progression with ${advance.progressivePasses} progressive passes and ${advance.finalThirdEntries} final-third entries.`
    : `${advanceName}以 ${advance.progressivePasses} 次推进传球和 ${advance.finalThirdEntries} 次进入进攻三区主导向前推进。`);

  const hPress = home.pressing.highRegains;
  const aPress = away.pressing.highRegains;
  if (hPress + aPress > 0) {
    const pressName = hPress >= aPress ? hn : an;
    const press = hPress >= aPress ? home.pressing : away.pressing;
    lines.push(en
      ? `${pressName} recovered the ball ${press.highRegains} times high up the pitch; ${press.pressureSuccessPct}% of recorded pressures led quickly to a regain.`
      : `${pressName}在前场 ${press.highRegains} 次夺回球权；记录到的压迫中有 ${press.pressureSuccessPct}% 很快转化为夺回。`);
  } else {
    lines.push(en ? "Neither side produced a high regain." : "双方都没有形成前场夺回球权。 ");
  }

  const homeHub = home.network?.hub || null;
  const awayHub = away.network?.hub || null;
  const hubSide = (homeHub?.passes || 0) + (homeHub?.received || 0) >=
    (awayHub?.passes || 0) + (awayHub?.received || 0) ? [hn, homeHub] : [an, awayHub];
  if (hubSide[1]) {
    lines.push(en
      ? `${hubSide[1].name} was ${hubSide[0]}'s main passing hub (${hubSide[1].passes} completed passes, ${hubSide[1].received} received).`
      : `${hubSide[1].name}是${hubSide[0]}的主要传球枢纽（完成 ${hubSide[1].passes} 次传球，接到 ${hubSide[1].received} 次）。`);
  }
  return lines;
}

function matchAnalysisHtml(analysis, report) {
  if (!analysis?.home || !analysis?.away) return "";
  const labels = reportAnalysisLabels();
  const home = analysis.home;
  const away = analysis.away;
  const homeName = report.home.short || report.home.name;
  const awayName = report.away.short || report.away.name;
  const sidePlots = (render) => `<div class="analysis-side-grid">
    <section><h5>${escapeHtml(homeName)}</h5>${render(home)}</section>
    <section><h5>${escapeHtml(awayName)}</h5>${render(away)}</section>
  </div>`;
  const tabs = ["overview", "shots", "progression", "pressing", "heatmap", "network"];
  if (report.phaseShapes) tabs.push("shapes");
  const tabHtml = tabs.map((key, index) => `<button type="button" class="analysis-tab${index ? "" : " active"}" role="tab" aria-selected="${index ? "false" : "true"}" data-analysis-tab="${key}">${escapeHtml(labels[key])}</button>`).join("");
  const overviewRows = [
    analysisCompareRow(labels.xg, Number(home.xg).toFixed(2), Number(away.xg).toFixed(2)),
    analysisCompareRow(labels.openPlayXg, Number(home.openPlayXg).toFixed(2), Number(away.openPlayXg).toFixed(2)),
    analysisCompareRow(labels.avgXg, home.shots.length ? (home.xg / home.shots.length).toFixed(2) : "0.00", away.shots.length ? (away.xg / away.shots.length).toFixed(2) : "0.00"),
    analysisCompareRow(labels.passCompletion, home.progression.passCompletionPct, away.progression.passCompletionPct, "%"),
    analysisCompareRow(labels.averageHeight, home.shape.averageActionHeight, away.shape.averageActionHeight),
  ].join("");
  const progressionRows = [
    analysisCompareRow(labels.passCompletion, home.progression.passCompletionPct, away.progression.passCompletionPct, "%"),
    analysisCompareRow(labels.progressivePasses, home.progression.progressivePasses, away.progression.progressivePasses),
    analysisCompareRow(labels.finalThirdEntries, home.progression.finalThirdEntries, away.progression.finalThirdEntries),
    analysisCompareRow(labels.boxEntries, home.progression.boxEntries, away.progression.boxEntries),
  ].join("");
  const pressingRows = [
    analysisCompareRow(labels.pressures, home.pressing.pressures, away.pressing.pressures),
    analysisCompareRow(labels.pressureSuccess, home.pressing.pressureSuccessPct, away.pressing.pressureSuccessPct, "%"),
    analysisCompareRow(labels.highPressures, home.pressing.highPressures, away.pressing.highPressures),
    analysisCompareRow(labels.regains, home.pressing.regains, away.pressing.regains),
    analysisCompareRow(labels.highRegains, home.pressing.highRegains, away.pressing.highRegains),
  ].join("");
  const insights = tacticalInsights(analysis, report, labels).map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const shotLegend = ["goal", "saved", "blocked", "offTarget"].map((key) => `<span><i class="analysis-legend-dot ${key}"></i>${escapeHtml(labels[key])}</span>`).join("");
  const phaseShapes = report.phaseShapes || null;
  const shapeSidePlots = phaseShapes?.usage
    ? `<div class="analysis-side-grid shape-position-grid">
        <section><h5>${escapeHtml(homeName)} · ${escapeHtml(labels.averagePositions)}</h5>${averagePositionsSvg(phaseShapes.usage.home, labels)}</section>
        <section><h5>${escapeHtml(awayName)} · ${escapeHtml(labels.averagePositions)}</h5>${averagePositionsSvg(phaseShapes.usage.away, labels)}</section>
      </div>`
    : `<p class="muted analysis-empty">${escapeHtml(labels.noPositions)}</p>`;
  const shapeUsage = phaseShapes?.usage
    ? `<div class="analysis-side-grid shape-usage-grid"><section><h5>${escapeHtml(homeName)}</h5>${shapeUsageSummary(phaseShapes.usage.home, labels)}</section><section><h5>${escapeHtml(awayName)}</h5>${shapeUsageSummary(phaseShapes.usage.away, labels)}</section></div>`
    : "";

  return `<section class="match-analysis">
    <div class="analysis-heading"><h4>${escapeHtml(labels.title)}</h4><div class="analysis-tabs" role="tablist">${tabHtml}</div></div>
    <div class="analysis-panel" data-analysis-panel="overview"><ul class="analysis-insights">${insights}</ul><div class="analysis-compare">${overviewRows}</div></div>
    <div class="analysis-panel hidden" data-analysis-panel="shots"><div class="analysis-legend">${shotLegend}</div>${sidePlots((side) => shotMapSvg(side, labels))}</div>
    <div class="analysis-panel hidden" data-analysis-panel="progression"><div class="analysis-compare">${progressionRows}</div></div>
    <div class="analysis-panel hidden" data-analysis-panel="pressing"><div class="analysis-compare">${pressingRows}</div></div>
    <div class="analysis-panel hidden" data-analysis-panel="heatmap">${sidePlots((side) => heatmapSvg(side, labels))}</div>
    <div class="analysis-panel hidden" data-analysis-panel="network">${sidePlots((side) => passNetworkSvg(side, labels))}</div>
    ${phaseShapes ? `<div class="analysis-panel hidden" data-analysis-panel="shapes"><div class="shape-panel-heading"><h5>${escapeHtml(labels.actualUsage)}</h5>${shapeUsage}</div>${shapeSidePlots}<h5 class="shape-timeline-heading">${escapeHtml(labels.phaseTimeline)}</h5>${phaseShapeTimelineHtml(phaseShapes, report, labels)}</div>` : ""}
  </section>`;
}

/**
 * @param {object} report
 * @param {{ review?: boolean }} [opts]
 */
export function showMatchReport(report, opts = {}) {
  const el = $("#match-report");
  if (!el || !report) return;
  const review = !!opts.review || !!matchPlayback.reviewMode;
  const h = report.home;
  const a = report.away;
  /**
   * @param {string} label
   * @param {number|string} hv
   * @param {number|string} av
   * @param {boolean} bar 是否画对比条
   * @param {((n: number) => string)|null} [fmt] 数值格式化
   *
   * 战报表格原来直接输出原始值，于是控球写成 80.4、xG 写成 1.2345，
   * 而同一场比赛的实时面板用的是 Math.round(...)% 和 toFixed(2)——
   * 同一个指标在两块界面上格式和读数都对不上。这里补上与实时面板一致的格式化。
   */
  const row = (label, hv, av, bar, fmt = null) => {
    let barHtml = "";
    if (bar && typeof hv === "number" && typeof av === "number") {
      const t = hv + av || 1;
      const hp = Math.round((hv / t) * 100);
      barHtml = `<div class="report-bar-wrap"><div class="report-bar-h" style="width:${hp}%"></div></div>`;
    }
    const show = (v) => (fmt && typeof v === "number" ? fmt(v) : v);
    return `<tr>
      <td class="num">${show(hv)}</td>
      <td class="stat-label">${label}${barHtml}</td>
      <td class="num">${show(av)}</td>
    </tr>`;
  };
  const fmtXgCell = (n) => (Number(n) || 0).toFixed(2);
  const fmtPossCell = (n) => `${Math.round(Number(n) || 0)}%`;
  const meta = [
    report.weather ? `${report.weather.icon} ${report.weather.name}` : "",
    report.derby ? "🔥 德比" : "",
    report.bigMatch ? "⭐ 焦点" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // 进球列表：尽量与本场回放缓存对齐，可点击再看
  let scorerGoalIdx = 0;
  const scorerHtml = (report.scorers || [])
    .map((s) => {
      const raw = String(s.text || "").replace(/^⚽\s*/, "");
      const namePart = s.playerId ? playerLinkHtml(s.playerId, raw) : escapeHtml(raw);
      const gi = scorerGoalIdx;
      const hasReplay = gi < matchPlayback.goals.length;
      if (hasReplay) scorerGoalIdx++;
      const replayBtn = hasReplay
        ? ` <button type="button" class="btn tiny goal-replay-btn" data-goal-replay="${gi}" title="${escapeHtml(t("match.watchReplay"))}">${t("match.watchReplay")}</button>`
        : "";
      return `<div class="report-scorer-row">${namePart}${replayBtn}</div>`;
    })
    .join("");

  const ratings = report.ratings;
  const rateSideHtml = (list, sideLabel) => {
    if (!list?.length) return "";
    const rows = list
      .map((x) => {
        const bits = [];
        if (x.started === false) bits.push(getLang() === "en" ? "SUB" : "替补");
        if (x.goals) bits.push(`${x.goals}G`);
        if (x.assists) bits.push(`${x.assists}A`);
        if (x.saves) bits.push(`${x.saves}S`);
        const note = bits.length ? ` <span class="muted">${bits.join(" ")}</span>` : "";
        const name = x.playerId
          ? playerLinkHtml(x.playerId, x.name)
          : escapeHtml(x.name || "—");
        return `<tr>
          <td class="muted">${escapeHtml(x.pos || "")}</td>
          <td>${name}${note}</td>
          <td class="num rating-cell ${ratingClass(x.rating)}"><strong>${formatRating(x.rating)}</strong></td>
        </tr>`;
      })
      .join("");
    return `<div class="report-ratings-side">
      <div class="report-ratings-title">${escapeHtml(sideLabel)}</div>
      <table class="report-ratings-table"><tbody>${rows}</tbody></table>
    </div>`;
  };
  let ratingsHtml = "";
  const motm = ratings?.motm;
  if (ratings?.home?.length || ratings?.away?.length) {
    ratingsHtml = `<div class="report-ratings">
      <strong>${t("match.ratings") || "球员评分"}</strong>
      <div class="report-ratings-grid">
        ${rateSideHtml(ratings.home, h.short || h.name)}
        ${rateSideHtml(ratings.away, a.short || a.name)}
      </div>
    </div>`;
  }

  // MOTM 大卡 + 文字复盘（经理可读）
  let motmCardHtml = "";
  if (motm) {
    const bits = [];
    if (motm.goals) bits.push(`${motm.goals}G`);
    if (motm.assists) bits.push(`${motm.assists}A`);
    if (motm.saves) bits.push(`${motm.saves}S`);
    const note = bits.length ? bits.join(" · ") : motm.pos || "";
    const nameHtml = motm.playerId
      ? playerLinkHtml(motm.playerId, motm.name)
      : escapeHtml(motm.name || "—");
    motmCardHtml = `<div class="report-motm-card">
      <div class="report-motm-label">${escapeHtml(t("match.motm") || "本场最佳")}</div>
      <div class="report-motm-body">
        <span class="report-motm-pos">${escapeHtml(motm.pos || "")}</span>
        <div class="report-motm-info">
          <strong>${nameHtml}</strong>
          ${note ? `<span class="muted">${escapeHtml(note)}</span>` : ""}
        </div>
        <div class="report-motm-rating rating-cell ${ratingClass(motm.rating)}">
          <em>${formatRating(motm.rating)}</em>
        </div>
      </div>
    </div>`;
  }

  const narrative = Array.isArray(report.narrative) ? report.narrative : [];
  const narrativeHtml = narrative.length
    ? `<div class="report-narrative">
        <strong>${escapeHtml(t("match.narrative") || "本场复盘")}</strong>
        <ul>${narrative.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
      </div>`
    : "";

  const reviewBadge = review
    ? `<span class="report-review-badge">${escapeHtml(t("fix.viewReport") || (getLang() === "en" ? "Archive" : "历史战报"))}</span>`
    : "";
  const ticketFactors = ticketFactorsText(report.ticketFactors, getLang() === "en");
  const analysisHtml = matchAnalysisHtml(report.analysis, report);

  el.innerHTML = `
    <h3>${t("match.report")}${reviewBadge}</h3>
    <div class="match-report-meta">${escapeHtml(t("match.reportMeta", { meta: meta || t("match.regular"), score: report.score }))}</div>
    ${motmCardHtml}
    ${narrativeHtml}
    ${analysisHtml}
    <table class="report-table">
      <thead><tr>
        <th>${escapeHtml(h.short || h.name)}</th>
        <th>${t("match.stats")}</th>
        <th>${escapeHtml(a.short || a.name)}</th>
      </tr></thead>
      <tbody>
        ${row(t("match.xg"), h.xg, a.xg, true, fmtXgCell)}
        ${row(t("match.shots"), h.shots, a.shots, true)}
        ${row(t("match.shotsOn"), h.shotsOn, a.shotsOn, true)}
        ${row(t("match.poss"), h.possession, a.possession, true, fmtPossCell)}
        ${row(t("match.corners"), h.corners, a.corners, true)}
        ${row(t("match.fouls"), h.fouls, a.fouls, false)}
        ${row(t("match.yellows"), h.yellows, a.yellows, false)}
        ${row(t("match.reds"), h.reds, a.reds, false)}
        ${row(t("match.saves"), h.saves, a.saves, false)}
        ${row(t("match.woodwork"), h.woodwork, a.woodwork, false)}
      </tbody>
    </table>
    ${scorerHtml ? `<div class="report-scorers"><strong>${t("match.scorers")}</strong>${scorerHtml}</div>` : ""}
    ${
      report.ticketIncome != null
        ? `<div class="report-tickets">🎟️ ${getLang() === "en" ? "Gate receipts" : "门票收入"} <strong>${formatMoney(report.ticketIncome)}</strong>${
            report.ticketAttendance != null && report.ticketCapacity
              ? ` <span class="muted">· ${getLang() === "en" ? "Att." : "上座"} ${Number(report.ticketAttendance).toLocaleString()}/${Number(report.ticketCapacity).toLocaleString()}${
                  report.ticketFillPct != null ? ` (${report.ticketFillPct}%)` : ""
                }</span>`
              : report.ticketStadium
                ? ` <span class="muted">（${escapeHtml(report.ticketStadium)}）</span>`
                : ""
          }${report.matchdayTotalIncome != null ? `<div class="muted">${getLang() === "en" ? "Retail" : "餐饮零售"} ${formatMoney(report.matchdayRetailIncome || 0)} · ${getLang() === "en" ? "Hospitality" : "商务接待"} ${formatMoney(report.matchdayHospitalityIncome || 0)} · ${getLang() === "en" ? "Total" : "合计"} ${formatMoney(report.matchdayTotalIncome)}</div>` : ""}${ticketFactors ? `<div class="muted">${getLang() === "en" ? "Factors: " : "系数："}${escapeHtml(ticketFactors)}</div>` : ""}</div>`
        : ""
    }
    ${
      matchPlayback.goals.length
        ? `<p class="hint report-replay-hint">${escapeHtml(t("match.replayHint"))}</p>`
        : ""
    }
    ${ratingsHtml}
    ${formatRoleReviewHtml(matchState && !review ? buildRoleReview(matchState, { untilMinute: 90 }) : null)}
  `;
  el.classList.remove("hidden");

  // 完场：球场上高亮 MOTM
  if (motm && matchView?.highlightMotm) {
    matchView.highlightMotm(motm);
  }
}

/** 战报内角色复盘 */
function formatRoleReviewHtml(rev) {
  if (!rev) return "";
  const en = getLang() === "en";
  const tips = (rev.tips || []).map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const rows = (rev.contributors || [])
    .slice(0, 6)
    .map((r) => {
      const lab = en ? r.roleLabelEn : r.roleLabel;
      const bits = [];
      if (r.goals) bits.push(`${r.goals}G`);
      if (r.assists) bits.push(`${r.assists}A`);
      return `<tr>
        <td>${escapeHtml(r.pos)}</td>
        <td>${playerLinkHtml(r.playerId, r.name)} <span class="muted">${escapeHtml(lab)}</span></td>
        <td class="num">${bits.join(" ") || "—"}</td>
      </tr>`;
    })
    .join("");
  return `<div class="report-role-review">
    <strong>${escapeHtml(en ? "Role review" : "角色复盘")}</strong>
    <span class="muted"> · ${escapeHtml(rev.formation || "")}</span>
    ${
      rows
        ? `<table class="report-ratings-table" style="margin-top:0.4rem"><tbody>${rows}</tbody></table>`
        : `<p class="muted" style="margin:0.35rem 0 0">${escapeHtml(
            en ? "No goal involvement from assigned roles." : "本场角色未直接贡献进球/助攻"
          )}</p>`
    }
    ${tips ? `<ul class="opp-tips">${tips}</ul>` : ""}
  </div>`;
}

function finishMatchUI() {
  // ④-B：完场即清续播意图（异常路径下 `runMatch` 可能中途退出，别把它带到下一场）。
  clearMatchResume();
  // 首周引导的比赛步骤在这里落定，随后由调用方的 saveGame 落盘。
  // 工作台此刻不可见（激活屏是比赛画面），点「继续」时 refreshAll 会重渲染，
  // 所以这里只改状态不渲染；也不能让异常冒出去，后面还要解锁「继续」按钮。
  try {
    if (world) completeManagerOnboardingStep(world, "match");
  } catch (err) {
    console.error(err);
  }
  // 结束录制，可下载 JSON 回放
  try {
    if (matchView?.stopRecording) {
      const rec = matchView.stopRecording();
      if (rec?.frames?.length > 10) {
        matchView._lastRecording = rec;
        const en = getLang() === "en";
        // 战报区附加导出按钮
        const el = $("#match-report");
        if (el && !el.querySelector("[data-dl-rec]")) {
          const bar = document.createElement("div");
          bar.className = "match-rec-bar";
          bar.innerHTML = `<button type="button" class="btn small" data-dl-rec>${
            en ? "Download 2D recording (JSON)" : "下载 2D 录像 JSON"
          }</button>
          <button type="button" class="btn small" data-play-rec>${
            en ? "Replay recording" : "回放录像"
          }</button>`;
          el.appendChild(bar);
          bar.querySelector("[data-dl-rec]").onclick = () => matchView.downloadRecording();
          bar.querySelector("[data-play-rec]").onclick = async () => {
            toast(en ? "Playing recording…" : "正在回放录像…");
            await matchView.playRecording(matchView._lastRecording, {
              speed: 1.2,
              sleepFn: (ms) => new Promise((r) => setTimeout(r, ms)),
            });
            toast(en ? "Recording done" : "录像回放结束");
          };
        }
      }
    }
  } catch (_) {
    /* ignore */
  }
  setMatchBusy(false);
  $("#btn-match-continue").disabled = false;
  $("#btn-sim-fast").disabled = true;
  $("#btn-sim-live").disabled = true;
  const inst = $("#btn-sim-instant");
  if (inst) inst.disabled = true;
  hideHtPanel();
  setLiveTacBarVisible(false);
  // 完赛后关闭暂停控制，保留进球回看列表
  matchPlayback.controlsEnabled = false;
  matchPlayback.paused = false;
  matchPlayback.waitingStep = false;
  if (matchPlayback.stepResolve) matchPlayback.stepResolve();
  updateMatchPlaybackUI();
}

/**
 * @param {object} ev
 * @param {{ goalIndex?: number }} [opts]
 */
function appendMatchEvent(ev, opts = {}) {
  if (!ev || !ev.text) return;
  const div = document.createElement("div");
  div.className = `event ${ev.type || ""}`;
  const min =
    ev.minute != null && ev.minute !== ""
      ? `${ev.minute}'`
      : ev.type === "briefing"
        ? "—"
        : "";
  const text = localizeMatchEvent(ev);
  const goalIndex = opts.goalIndex;
  const canReplay =
    ev.type === "goal" && goalIndex != null && goalIndex >= 0 && goalIndex < matchPlayback.goals.length;
  if (canReplay) {
    div.classList.add("event-replayable");
    div.innerHTML = `<span class="ev-min">${escapeHtml(min)}</span><span class="ev-text"><button type="button" class="ev-goal-link" data-goal-replay="${goalIndex}" title="${escapeHtml(t("match.watchReplay"))}">${escapeHtml(text)}</button></span>`;
  } else {
    div.innerHTML = `<span class="ev-min">${escapeHtml(min)}</span><span class="ev-text">${escapeHtml(text)}</span>`;
  }
  const log = $("#match-log");
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function localizeHalfTimeScoreTip(text) {
  const map = {
    "落后：可加强压迫或换进攻点": "Trailing: press higher or introduce another attacking option",
    "领先：注意控场与体能": "Leading: manage possession and fitness",
    "平局：可微调节奏寻找突破": "Level: adjust the tempo to find a breakthrough",
  };
  return map[text] || text || "";
}

/** 关键比赛事件中英切换（原文仍为中文引擎产出，EN 做简单映射） */
function localizeMatchEvent(ev) {
  if (!ev?.text) return "";
  if (getLang() !== "en") return ev.text;
  let s = ev.text;
  const map = [
    [/^比赛开始！$/, "Kick-off!"],
    [/^中场休息/, "Half-time"],
    [/^全场结束/, "Full-time"],
    [/^情境：/, "Context: "],
    [/^德比大战/, "Derby"],
    [/^焦点杯赛/, "Cup spotlight"],
    [/^焦点战/, "Big match"],
    [/^📋 赛前简报/, "📋 Pre-match briefing"],
    [/^主场/, "Home"],
    [/^客场/, "Away"],
    [/^停赛：/, "Suspended: "],
    [/^伤病：/, "Injured: "],
    [/^黄牌边缘：/, "On yellow limit: "],
    [/^对方威胁：/, "Threats: "],
    [/^人员齐全，无重大缺阵$/, "Full squad available"],
    [/^💬 (\d+)' 教练席：/, "💬 $1' Coach: "],
    [/^落后，可考虑加强压迫或换进攻点/, "Trailing — press higher or bring attackers"],
    [/^领先，注意控场与体能分配/, "Leading — manage tempo and fitness"],
    [/^僵持中，可微调节奏寻找突破/, "Stalemate — tweak tempo for a breakthrough"],
    [/^首发平均体能/, "XI avg fitness "],
    [/^名主力体能告急，建议换人/, " starters low on fitness — consider subs"],
    [/^比分胶着，最后 15 分钟是关键窗口/, "Tight score — last 15 is decisive"],
    [/^仅落后 1 球，可冒险压上/, "One goal down — risk going forward"],
    [/^守住优势，别急于冒进/, "Protect the lead — don't overcommit"],
    [/^考虑轮换/, "consider rotation"],
    [/^📋 中场调整：/, "📋 HT tweak: "],
    [/^两黄变一红/, "Second yellow → red"],
    [/^红牌/, "Red card"],
    [/^停赛/, "suspended"],
    [/^赛季黄牌/, "season yellows"],
  ];
  for (const [re, rep] of map) {
    s = s.replace(re, rep);
  }
  return s;
}

function renderCareerJobs() {
  renderCareer();
}

function renderCareer() {
  const el = $("#career-panel");
  if (!el || !world) return;
  const mc = ensureActiveCareer(world);
  const club = getUserClub(world);
  const en = getLang() === "en";
  const directorMode = world.managementMode === "club_director";
  if (club) ensureClubHonors(club);
  try {
    ensureManagerJob(world);
  } catch (_) {
    /* ignore */
  }
  const wr = managerWinRate(mc);
  let rep = 40;
  let repTier = "";
  let coolLeft = 0;
  try {
    rep = managerReputation(world);
    repTier = reputationTierLabel(rep, en ? "en" : "zh");
    coolLeft = resignCooldownLeft(world) || 0;
  } catch (_) {}
  const job = world.managerJob || {};
  const unemployed = !directorMode && (job.status === "unemployed" || !!world.sacked);
  const offers = (() => {
    try {
      return pendingJobOffers(world) || [];
    } catch {
      return [];
    }
  })();

  const trophies = (mc.trophies || [])
    .slice(0, 12)
    .map(
      (h) =>
        `<div class="honor-item"><div class="season">${h.season}</div><strong>${escapeHtml(h.title)}</strong>${
          h.detail ? ` <span class="muted">${escapeHtml(h.detail)}</span>` : ""
        }</div>`
    )
    .join("");
  const clubHonors = ((club && club.honors) || [])
    .slice(0, 12)
    .map(
      (h) =>
        `<div class="honor-item"><div class="season">${h.season}</div><strong>${escapeHtml(h.title)}</strong>${
          h.detail ? ` <span class="muted">${escapeHtml(h.detail)}</span>` : ""
        }</div>`
    )
    .join("");

  const offerHtml = directorMode
    ? `<p class="muted">${en ? "Manager job offers are inactive while you work as club director. Switch to head-coach mode before entering the manager job market." : "俱乐部经营身份不参与主教练职位市场；切换回主教练模式后才会处理执教邀请。"}</p>`
    : offers.length
    ? `<div class="job-offer-list">${offers
        .map((o) => {
          const kindLabel =
            o.kind === "prestige"
              ? en
                ? "Prestige invite"
                : "名望邀请"
              : o.kind === "sack_rehire"
                ? en
                  ? "After sacking"
                  : "再就业"
                : en
                  ? "Open role"
                  : "空缺职位";
          return `<article class="job-offer-card">
            <div>
              <div class="muted" style="font-size:var(--fs-xs)">${escapeHtml(kindLabel)}</div>
              <strong>${escapeHtml(o.clubName)}</strong>
              <div class="muted">${escapeHtml(o.divName || "")} · ${en ? "Power" : "实力"} ${o.power ?? "—"} · ${en ? "Wage" : "周薪"} ${formatMoney(o.wage)}${
                o.repTier ? ` · ${en ? "Your rep" : "名望档"} ${escapeHtml(o.repTier)}` : ""
              }</div>
              <div class="hint" style="margin:0.25rem 0 0">${escapeHtml(o.note || "")}</div>
              <div class="muted" style="font-size:var(--fs-xs)">D${o.day} → D${o.expiresDay}</div>
            </div>
            <div class="staff-card-actions">
              <button type="button" class="btn small primary" data-job-accept="${escapeHtml(o.id)}">${en ? "Accept" : "接受"}</button>
              <button type="button" class="btn small" data-job-reject="${escapeHtml(o.id)}">${en ? "Reject" : "拒绝"}</button>
            </div>
          </article>`;
        })
        .join("")}</div>`
    : `<p class="muted">${
        unemployed
          ? en
            ? "No offers yet — advance days to refresh the job market."
            : "暂无邀请 — 可推进日程等待经理市场刷新。"
          : en
            ? "No pending invites. Strong form may attract bigger clubs."
            : "暂无待处理邀请。战绩出色时可能收到更高水平俱乐部邀请。"
      }</p>`;

  el.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2>${en ? (directorMode ? "Club director career" : "Manager career") : (directorMode ? "俱乐部经营生涯" : "经理生涯")}</h2>
        <p><strong>${escapeHtml(world.managerName || "—")}</strong>
          · ${
            unemployed
              ? `<span class="stat-low">${en ? "Unemployed" : "待业中"}</span>`
              : escapeHtml(club ? clubDisplayName(club) : "—")
          }
          · ${en ? "Rep" : "名望"} <strong>${rep}</strong>/100
          <span class="badge-chip">${escapeHtml(repTier || "—")}</span>
        </p>
        ${
          unemployed && job.reason
            ? `<p class="hint">${escapeHtml(job.reason)}</p>`
            : !unemployed && coolLeft > 0
              ? `<p class="hint">${en ? `Resign cooldown: ${coolLeft} day(s)` : `请辞冷却：还剩 ${coolLeft} 天`}</p>`
              : ""
        }
        <ul class="career-stats">
          <li>${en ? "Seasons" : "执教赛季"}${en ? ": " : "："}${mc.seasons}</li>
          <li>${en ? "Record" : "战绩"}${en ? ": " : "："}${mc.wins}W ${mc.draws}D ${mc.losses}L${en ? ` (${mc.matches})` : `（${mc.matches}）`} · ${wr}%</li>
          <li>GF/GA${en ? ": " : "："}${mc.goalsFor || 0} / ${mc.goalsAgainst || 0}</li>
          <li>${en ? "Titles / promos / cups" : "冠军 / 升级 / 杯赛"}${en ? ": " : "："}${mc.titles} / ${mc.promotions} / ${mc.cups}</li>
          <li>${en ? "Sacked" : "被解雇"}${en ? ": " : "："}${mc.sacked} · ${en ? "Jobs taken" : "上任次数"} ${job.jobsTaken || 0}</li>
          <li>${
            mc.bestFinish
              ? `${en ? "Best" : "最佳"}${en ? ": " : "："}${mc.bestFinish.season} ${escapeHtml(mc.bestFinish.divName)} #${mc.bestFinish.pos}`
              : en
                ? "Best finish: —"
                : "最佳名次：—"
          }</li>
        </ul>
        <div class="staff-card-actions" style="margin-top:0.75rem">
          ${
            !unemployed
              ? `<button type="button" class="btn small danger" id="btn-resign-job" ${coolLeft > 0 ? "disabled" : ""}>${
                  coolLeft > 0
                    ? en
                      ? `Resign (${coolLeft}d)`
                      : `请辞（${coolLeft}天）`
                    : en
                      ? "Resign"
                      : "主动请辞"
                }</button>`
              : `<button type="button" class="btn small" id="btn-refresh-jobs">${en ? "Seek offers" : "刷新邀请"}</button>
                 <button type="button" class="btn small" id="btn-job-advance">${en ? "Advance 1 day" : "推进 1 天"}</button>`
          }
        </div>
        <h3 style="margin:1rem 0 0.4rem;font-size:var(--fs-md)">${en ? "Trophy cabinet" : "荣誉柜"}</h3>
        <div class="honor-list">${trophies || `<p class="muted">${en ? "No trophies yet" : "暂无奖杯"}</p>`}</div>
      </div>
      <div class="card">
        <h2>${en ? "Job offers" : "工作邀请"}</h2>
        <p class="hint">${
          en
            ? "After sacking or resigning you can take a new club. Strong form may draw prestige offers while employed."
            : "解雇或请辞后可接受新东家；在职且战绩出色时也可能收到更高水平俱乐部邀请。"
        }</p>
        ${offerHtml}
        <h3 style="margin:1.1rem 0 0.4rem;font-size:var(--fs-md)">${en ? "Club honours" : "俱乐部荣誉墙"}</h3>
        <div class="honor-list">${
          unemployed
            ? `<p class="muted">${en ? "Not attached to a club" : "当前无执教俱乐部"}</p>`
            : clubHonors || `<p class="muted">${en ? "Win a title or earn promotion to fill this wall" : "夺冠或升级后写入此处"}</p>`
        }</div>
      </div>
    </div>
  `;

  el.querySelector("#btn-resign-job")?.addEventListener("click", () => {
    if (
      !confirm(
        en
          ? "Resign from your current club and enter the job market?"
          : "确定辞去现任主帅、进入经理市场？"
      )
    ) {
      return;
    }
    const res = resignManagership(world);
    toast(res.msg || (res.ok ? (en ? "Resigned" : "已请辞") : en ? "Failed" : "失败"));
    if (res.ok) {
      saveGame(world);
      renderCareer();
      renderDashboard?.();
      refreshAll();
    }
  });
  el.querySelector("#btn-refresh-jobs")?.addEventListener("click", () => {
    const created = generateJobOffers(world, { force: true, count: 3 });
    toast(
      created.length
        ? en
          ? `${created.length} new offer(s)`
          : `新增 ${created.length} 个邀请`
        : en
          ? "No new clubs available"
          : "暂无新俱乐部"
    );
    saveGame(world);
    renderCareer();
  });
  el.querySelector("#btn-job-advance")?.addEventListener("click", () => {
    onAdvance();
    renderCareer();
  });
  el.querySelectorAll("[data-job-accept]").forEach((btn) => {
    btn.onclick = () => {
      const res = acceptJobOffer(world, btn.dataset.jobAccept);
      toast(res.msg || (res.ok ? (en ? "Hired!" : "已上任") : en ? "Failed" : "失败"));
      if (res.ok) {
        saveGame(world);
        enterMain();
        refreshAll();
        renderCareer();
      }
    };
  });
  el.querySelectorAll("[data-job-reject]").forEach((btn) => {
    btn.onclick = () => {
      const res = rejectJobOffer(world, btn.dataset.jobReject);
      toast(res.msg || (en ? "Rejected" : "已拒绝"));
      if (res.ok) {
        saveGame(world);
        renderCareer();
      }
    };
  });
}

function maybeShowSeasonSummary() {
  if (!world?.lastSeasonSummary || !world.seasonOver) return;
  if (world._summaryShownSeason === world.lastSeasonSummary.season) return;
  const s = world.lastSeasonSummary;
  const overlay = $("#season-summary");
  if (!overlay) return;
  world._summaryShownSeason = s.season;
  const trop = (s.trophies || [])
    .map((t) => `<li>${escapeHtml(t.title)}${t.detail ? ` · ${escapeHtml(t.detail)}` : ""}</li>`)
    .join("");
  overlay.innerHTML = `
    <div class="season-summary-card">
      <h2>🏆 ${s.season} ${getLang() === "en" ? "Season review" : "赛季结算"}</h2>
      <p class="muted">${escapeHtml(s.clubName)} · ${escapeHtml(s.divName)}</p>
      <p style="font-size:var(--fs-4xl);margin:0.5rem 0"><strong>#${s.pos}</strong> · ${s.pts} pts · ${s.w}W ${s.d}D ${s.l}L · ${s.gf}:${s.ga}</p>
      ${trop ? `<ul class="season-trop-list">${trop}</ul>` : `<p class="muted">${getLang() === "en" ? "No new silverware" : "本季无新奖杯"}</p>`}
      <p class="muted" style="margin-top:0.75rem">${getLang() === "en" ? "Career: " : "生涯："}${s.career?.seasons || 0} seasons · ${s.career?.titles || 0} titles · ${s.career?.promotions || 0} promos</p>
      <button type="button" class="btn primary" id="btn-close-season-summary">${getLang() === "en" ? "Continue" : "继续"}</button>
    </div>
  `;
  overlay.classList.remove("hidden");
  $("#btn-close-season-summary")?.addEventListener("click", () => {
    overlay.classList.add("hidden");
    overlay.innerHTML = "";
  });
}

function checkExportReminder() {
  try {
    const last = Number(
      localStorage.getItem(EXPORT_TIP_KEY) || localStorage.getItem(OLD_EXPORT_TIP_KEY) || 0
    );
    const days = last ? (Date.now() - last) / 86400000 : 999;
    const tip = $("#export-reminder");
    if (!tip) return;
    if (days >= 7 && hasAnySave()) {
      tip.classList.remove("hidden");
      tip.textContent =
        getLang() === "en"
          ? "Tip: export your save regularly — clearing cache wipes progress."
          : "提醒：建议定期导出存档；清缓存会丢失进度。";
    } else {
      tip.classList.add("hidden");
    }
  } catch (_) {
    /* ignore */
  }
}

function markExportDone() {
  try {
    localStorage.setItem(EXPORT_TIP_KEY, String(Date.now()));
  } catch (_) {
    /* ignore */
  }
  checkExportReminder();
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toast(msg) {
  const hint = $("#start-hint");
  // 主界面用临时提示
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.cssText =
      "position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:var(--toast-bg);border:1px solid var(--border);color:var(--text);padding:0.65rem 1.2rem;border-radius:8px;z-index:200;box-shadow:var(--shadow);max-width:90vw;text-align:center;";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.display = "none";
  }, 2200);
  if (hint && screens.start.classList.contains("active")) {
    hint.textContent = msg;
  }
}

if (typeof window !== "undefined") {
  window.vcfmMainApi = {
    showMatchReport,
    showMotionDiagnostic,
    closeMotionDiagnostic,
    // 调试/审计口：浏览器探针(_watch-live 等)需要拿当前视图的运动片段与状态。
    // 只读，不参与任何游戏逻辑。
    get matchView() { return matchView; },
  };
}

// ---------- Boot ----------
await initializeSaveStorage();
initPrefs();
window.addEventListener("vcfm-save-error", () => toast(t("toast.autosaveFail")));
window.addEventListener("vc-prefs-change", () => {
  fillCountrySelect();
  fillClubSelect();
  fillDivisionSelects();
  refreshSlotUI();
  if (world) {
    applyWorldClubBranding(world, clubBrandingById, getLang());
    refreshAll();
  }
});
initStart();
fillDivisionSelects(START_DIVISION);

/**
 * 刷新页面后自动读档：有当前槽存档则直接进主界面
 * （否则每次刷新都会停在开始页，像「没记住进度」）
 * URL 加 ?menu=1 可强制停在开始页（例如要换档 / 导出）
 */
async function tryAutoResume() {
  try {
    const params = new URLSearchParams(location.search || "");
    if (params.get("menu") === "1" || params.get("noload") === "1") return false;
    // session 内主动回菜单：同一会话刷新仍自动读；仅当带 menu=1 时停菜单
    const slot = getActiveSlot();
    if (!hasSave(slot)) return false;
    const data = await loadGame(slot);
    if (!data) return false;
    world = data;
    dashboardAdvanceDigest = null;
    migrateWorld(world);
    enterMain();
    // 轻提示，避免误以为还在登录页
    const msg =
      getLang() === "en"
        ? `Resumed slot ${slot}`
        : `已自动读取槽 ${slot}`;
    // enterMain 后 start 屏已隐藏，toast 仍可用
    setTimeout(() => toast(msg), 80);
    return true;
  } catch (err) {
    console.error("auto-resume failed", err);
    return false;
  }
}

await tryAutoResume();
