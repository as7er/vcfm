/** VCFM 路 UI 涓婚€昏緫 */

import {
  CLUB_TEMPLATES,
  FORMATIONS,
  FORMATION_MOD,
  POS_LABEL,
  NATIONALITIES,
  DIVISIONS,
  START_DIVISION,
  playerDisplaySurname,
  TACTIC_PRESETS,
  tacticsSliderLabel,
  STYLE_MOD,
  PLAYER_ROLES,
  ROLES_BY_POS,
  roleLabel,
  roleShort,
  defaultRoleForSlot,
  TEAM_TALKS,
  TEAM_TALK_IDS,
  teamTalkLabel,
  teamTalkDesc,
} from "./data.js";
import { ensureMedia, mediaSeasonKickoff } from "./media.js";
import { t, initPrefs, getLang } from "./i18n.js";
import { getMatchView, destroyMatchView } from "./matchview.js";

function nationLabel(p) {
  if (p.nationFlag && p.nationName) return `${p.nationFlag} ${p.nationName}`;
  if (p.nationality) {
    const n = NATIONALITIES.find((x) => x.code === p.nationality);
    if (n) return `${n.flag} ${n.name}`;
  }
  return "鈥?;
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
  emptyMatchStats,
  seasonAvgRating,
  ratingClass,
  formatRating,
  YOUTH_LEVELS,
  YOUTH_UPGRADE_COST,
  ensureKit,
  ensureTactics,
  assignSquadNumbers,
  kitBackground,
  ensurePlayerNumber,
  swapLineupSlots,
  setLineupSlot,
  ensureLineupRoles,
  ensureMatchLineup,
  setSlotRole,
  getSlotRole,
  teamRoleMods,
} from "./models.js";
import {
  advanceDay,
  advanceToNextMatchDay,
  advanceToSeasonEnd,
  simulateMatch,
  createMatchSession,
  playFirstHalf,
  continueSecondHalf,
  applySubstitution,
  applyLiveTactics,
  getHalfTimeTips,
  applyTeamTalk,
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
  buyPlayer,
  sellPlayer,
  getMarketPlayers,
  getStatLeaders,
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
  startNextSeason,
  ensureStaff,
  ROLES,
  refreshStaffMarket,
  hireStaffForUser,
  fireStaffForUser,
  ensureIntl,
  ensureHonors,
  scoutValueRange,
  formatScoutValue,
  formatScoutOvr,
  ensureTraining,
  setTraining,
  trainingSummary,
  TRAINING_FOCUSES,
  TRAINING_INTENSITIES,
  ensureTransferWindow,
  isTransferWindowOpen,
  transferWindowLabel,
  transferWindowShort,
  processTransferWindowDay,
  ensureManagerCareer,
  managerWinRate,
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
  inboxCatLabel,
  buildScoutReport,
  formatScoutReportHtml,
  buildOpponentReport,
  formatOpponentReportHtml,
  opponentReportLogLines,
  scoutFogLevel,
  scoutAttrRows,
  formatScoutOvrFog,
  formatScoutPotFog,
  previewBuyDeal,
  ensureDiscipline,
  isAvailable,
} from "./engine.js";
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
  migrateLegacySave,
  clearSave,
} from "./save.js";
import {
  ensureBoardObjective,
  boardStatusLine,
  boardTone,
} from "./board.js";
import {
  playerAvatarHtml,
  staffAvatarHtml,
  avatarHtml,
} from "./avatar.js?v=58";

/** 瑙ｉ泧鍚庡洖鑿滃崟锛氫紭鍏堟彁绀烘崲绌烘Ы寮€鏂版。锛岄伩鍏嶈瑕嗙洊 */
function handleSacked(result) {
  if (!result || !result.sacked) return false;
  autosave("sacked");
  const slot = getActiveSlot();
  const slots = listSlots();
  const empty = slots.find((s) => s.empty);
  let pick = empty?.slot;
  if (pick) {
    setActiveSlot(pick);
  }
  const reason = result.msg || result.sackedResult?.msg || world?.sackedReason || "浣犲凡琚懀浜嬩細瑙ｉ泧銆?;
  const tip = pick
    ? `\n\n宸茶嚜鍔ㄩ€変腑绌烘Ы ${pick} 鏂逛究寮€鏂版。銆俓n瑙ｉ泧瀛樻。浠嶅湪妲?${slot}锛堝彲璇诲彇鍥為【锛夈€俙
    : `\n\n涓変釜妲介兘鏈夊瓨妗ｃ€傚紑鏂版。浼氳鐩栥€屽綋鍓嶆Ы銆嶁€斺€斿缓璁厛閫変竴涓笉蹇冪柤鐨勬Ы锛屾垨鍏堝鍑哄浠姐€俓n瑙ｉ泧璁板綍鍦ㄦЫ ${slot}銆俙;
  alert(reason + tip);
  showScreen("start");
  refreshSlotUI();
  $("#start-hint").textContent = pick
    ? `宸茶瑙ｉ泧銆傛柊妗ｅ皢鍐欏叆妲?${pick}锛涙Ы ${slot} 淇濈暀瑙ｉ泧瀛樻。銆俙
    : `宸茶瑙ｉ泧锛堟Ы ${slot}锛夈€傝閫夋嫨瑕佽鐩栫殑妲藉悗寮€鏂拌禌瀛ｏ紝鎴栧厛瀵煎嚭銆俙;
  world = null;
  return true;
}

let world = null;
let pendingMatch = null;
let liveRunning = false;
/** @type {import('./match.js').createMatchSession extends Function ? any : any} */
let matchState = null;
let pendingSubs = []; // 涓満寰呯‘璁ゆ崲浜?{outId, inId, outName, inName}
/** 璧涘墠闃熷唴璁茶瘽 id锛堥粯璁ら紦鍔憋級 */
let selectedPreTalk = "encourage";
/** @type {import('./matchview.js').MatchView | null} */
let matchView = null;

/** 姣旇禌鎾斁鎺у埗锛氭殏鍋?/ 閫愪簨浠?+ 杩涚悆鍥炵湅缂撳瓨 */
const matchPlayback = {
  paused: false,
  stepMode: false,
  waitingStep: false,
  /** @type {null | (() => void)} */
  stepResolve: null,
  /** 璧涗腑鍙搷浣滄殏鍋?涓嬩竴姝?*/
  controlsEnabled: false,
  /** @type {{ ev: object, snap: object, fixture: object }[]} */
  goals: [],
  /** 璧涘悗鍥炵湅杩涜涓紝闃叉杩炵偣 */
  replaying: false,
  /** 浠庤禌绋嬫墦寮€鏃ф垬鎶ワ紙鍙锛屼笉缁撶畻锛?*/
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
    pauseBtn.textContent = matchPlayback.paused
      ? t("match.resume")
      : t("match.pause");
  }
  if (stepBtn) {
    // 鏆傚仠涓?鎴?閫愪簨浠剁瓑寰呮椂锛屽彲鐐广€屼笅涓€姝ャ€?
    stepBtn.disabled = !en || (!matchPlayback.paused && !matchPlayback.waitingStep && !matchPlayback.stepMode);
    stepBtn.classList.toggle("active", matchPlayback.waitingStep);
  }
  if (modeBtn) {
    modeBtn.classList.toggle("active", matchPlayback.stepMode);
    modeBtn.setAttribute("aria-pressed", matchPlayback.stepMode ? "true" : "false");
  }
  updateMatchSfxUI();
}

/** 鍙鏆傚仠鎵撴柇鐨勭瓑寰咃紱閫愪簨浠舵ā寮忎笅缁撴潫鍚庡啀绛夌敤鎴风偣銆屼笅涓€姝ャ€?*/
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
    // 宸插湪绛夛紝澶嶇敤
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
      // 鐐逛笅涓€姝ユ椂椤轰究瑙ｉ櫎鏆傚仠锛岄伩鍏嶅崱姝?
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
  // 鏆傚仠涓絾杩樻病杩涘叆 wait锛氳В闄ゆ殏鍋滆 sleep 缁х画锛屽苟杩涘叆涓€姝?
  if (matchPlayback.paused) {
    matchPlayback.paused = false;
    if (matchView?.setFrozen) matchView.setFrozen(false);
    updateMatchPlaybackUI();
  }
}

function toggleMatchPause() {
  if (!matchPlayback.controlsEnabled) return;
  matchPlayback.paused = !matchPlayback.paused;
  // 鍐荤粨鐞冨満 AI锛堜繚鐣欑珯浣嶏紝鍖哄埆浜?HT/FT 閽夊洖闃靛瀷锛?
  if (matchView?.setFrozen) matchView.setFrozen(matchPlayback.paused);
  if (!matchPlayback.paused && matchPlayback.stepResolve && !matchPlayback.stepMode) {
    // 缁х画鎾斁锛氳嫢鍗″湪閫愭绛夊緟涓旈潪閫愭妯″紡锛屾斁琛?
    matchPlayback.stepResolve();
  }
  updateMatchPlaybackUI();
  toast(
    matchPlayback.paused
      ? getLang() === "en"
        ? "Paused"
        : "宸叉殏鍋?
      : getLang() === "en"
        ? "Resumed"
        : "缁х画姣旇禌"
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
  // 鍏虫帀閫愪簨浠舵椂鑻ユ鍦ㄧ瓑涓嬩竴姝ワ紝鏀捐
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
        : "闊虫晥宸插叧"
      : getLang() === "en"
        ? "SFX on"
        : "闊虫晥宸插紑"
  );
  // 寮€闊虫椂杞诲搷涓€澹扮‘璁?
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
  btn.textContent = muted
    ? getLang() === "en"
      ? "SFX off"
      : "闈欓煶"
    : t("match.sfx") || (getLang() === "en" ? "SFX" : "闊虫晥");
}

/**
 * @param {object} ev
 * @param {object} [snap]
 * @param {object} [fixture]
 * @param {object|null} [scene] 杩涚悆鐬棿鍦洪潰锛堝洖鐪嬭繕鍘熺敤锛?
 */
function rememberGoalReplay(ev, snap, fixture, scene = null) {
  if (!ev || ev.type !== "goal") return;
  matchPlayback.goals.push({
    ev: { ...ev },
    snap: snap ? { ...snap } : { homeGoals: 0, awayGoals: 0, minute: ev.minute },
    fixture: fixture || pendingMatch,
    scene: scene || null,
  });
}

/** 璧涘悗 / 鏃ュ織鐐瑰嚮锛氶噸鐪嬬 n 涓繘鐞?*/
async function replayStoredGoal(index) {
  if (matchPlayback.replaying) {
    toast(getLang() === "en" ? "Replay in progress鈥? : "鍥炴斁杩涜涓€?);
    return;
  }
  const item = matchPlayback.goals[index];
  if (!item || !matchView?.playGoalHighlight) {
    toast(getLang() === "en" ? "No replay for this goal" : "璇ヨ繘鐞冩殏鏃犲彲鍥炵湅");
    return;
  }
  matchPlayback.replaying = true;
  try {
    ensureMatchPitch();
    const spd = Math.max(0.25, Number(matchSpeed) || 1);
    // 鍥炵湅鏃剁暐鎱竴鐐规洿濂界湅锛涙湁鍦洪潰蹇収鍒欎粠鍚屼竴甯ф帴缁?
    await matchView.playGoalHighlight(item.ev, item.snap, item.fixture, {
      speed: Math.min(spd, 1),
      lang: getLang(),
      sleepFn: sleepPlayback,
      rewatch: true,
      scene: item.scene || null,
    });
  } catch (err) {
    console.error(err);
    toast(getLang() === "en" ? "Replay failed" : "鍥炴斁澶辫触");
  } finally {
    matchPlayback.replaying = false;
  }
}

/** 鐩存挱鍊嶉€?0.5 / 1 / 2 / 4 */
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
  // 鏃у瓨妗ｈ嫢鏄?2/4锛屼粛灏婇噸锛涢潪娉曞€煎洖钀藉埌銆屾甯搞€嵜?
  if (!MATCH_SPEEDS.includes(raw)) return 1;
  return raw;
})();
/** 瀵煎嚭鎻愰啋锛氫笂娆″鍑烘椂闂存埑 */
const EXPORT_TIP_KEY = "vcfm-last-export";
const OLD_EXPORT_TIP_KEY = "vc-fm-last-export";

/** 鑷姩瀛樻。锛堥潤榛橈紝澶辫触浠?console锛?*/
function autosave(msg) {
  if (!world) return false;
  const ok = saveGame(world);
  if (!ok) console.warn("autosave failed", msg || "");
  return ok;
}


/** 鐞冭。鍙风爜寰界珷鐨?inline style */
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
  const n = number != null ? number : "鈥?;
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
        : t("start.slotManager", { name: escapeHtml(s.manager || "鈥?) });
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
          ? `Slot ${n}: ${info.clubName || "鈥?} 路 S${info.season ?? "?"} D${info.day ?? "?"}`
          : `妲?${n}锛?{info.clubName || "鈥?} 路 S${info.season ?? "?"} D${info.day ?? "?"}`;
      if (!confirm(`${t("start.slotDeleteConfirm", { n })}\n${detail}`)) return;
      if (!clearSave(n)) {
        toast(t("start.slotDeleteFail"));
        return;
      }
      // 鍒犵殑鏄綋鍓嶆Ы锛氫繚鎸侀€変腑绌烘Ы锛涘惁鍒欎笉鏀?active
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

function fillClubSelect() {
  const sel = $("#select-club");
  if (!sel) return;
  const prev = sel.value;
  const starters = CLUB_TEMPLATES.filter((c) => (c.division || 3) === START_DIVISION);
  sel.innerHTML = starters
    .map(
      (c) =>
        `<option value="${c.id}">${t("start.clubOption", { name: c.name, power: c.power })}</option>`
    )
    .join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function initStart() {
  fillClubSelect();

  refreshSlotUI();
  if (hasAnySave()) {
    $("#start-hint").textContent = t("start.detectSave", { n: getActiveSlot() });
  }

  $("#btn-new-game").onclick = () => {
    try {
      const manager = $("#input-manager").value.trim() || t("start.manager.placeholder");
      const clubId = $("#select-club").value;
      const tpl = CLUB_TEMPLATES.find((c) => c.id === clubId);
      if (!tpl || (tpl.division || 3) !== START_DIVISION) {
        $("#start-hint").textContent = t("start.div3Only");
        return;
      }
      const slot = getActiveSlot();
      if (hasSave(slot) && !confirm(t("start.overwriteConfirm", { n: slot }))) return;
      world = createWorld(clubId, manager);
      ensureMedia(world);
      for (const c of world.clubs) ensureStaff(c);
      refreshStaffMarket(world);
      const u = world.clubs.find((c) => c.id === clubId);
      mediaSeasonKickoff(world, u, DIVISIONS[u.division || 3]?.name || "涔欑骇鑱旇禌");
      ensureBoardObjective(world);
      ensureTransferWindow(world);
      processTransferWindowDay(world);
      ensureManagerCareer(world);
      saveGame(world, slot);
      enterMain();
    } catch (err) {
      console.error(err);
      const msg = err?.message || String(err);
      $("#start-hint").textContent = getLang() === "en" ? `Failed to start: ${msg}` : `寮€灞€澶辫触锛?{msg}`;
      toast(getLang() === "en" ? `Start failed: ${msg}` : `寮€灞€澶辫触锛?{msg}`);
    }
  };

  $("#btn-load-game").onclick = () => {
    const slot = getActiveSlot();
    const data = loadGame(slot);
    if (!data) {
      $("#start-hint").textContent = t("start.noSave", { n: slot });
      return;
    }
    world = data;
    migrateWorld(world);
    enterMain();
  };

  $("#btn-export-save").onclick = () => {
    const slot = getActiveSlot();
    if (!hasSave(slot)) {
      $("#start-hint").textContent = t("start.noExport", { n: slot });
      return;
    }
    const data = loadGame(slot);
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

/** 鏃у瓨妗?/ 缂哄瓧娈靛吋瀹?*/
function migrateWorld(w) {
  if (!w.retiredPlayers) w.retiredPlayers = [];
  ensureMedia(w);
  if (!Array.isArray(w.staffMarket)) refreshStaffMarket(w);
  ensureBoardObjective(w);
  ensureTransferWindow(w);
  ensureManagerCareer(w);
  if (!Array.isArray(w.poachBids)) w.poachBids = [];
  if (w.board && w.board.sackWarnings == null) w.board.sackWarnings = 0;
  for (const c of w.clubs || []) {
    if (!c.division) {
      c.division = c.power >= 72 ? 1 : c.power >= 60 ? 2 : 3;
    }
    ensureStaff(c);
    ensureYouthAcademy(c);
    ensureKit(c);
    ensureTactics(c);
    assignSquadNumbers(c);
    ensureTraining(c);
    ensureFacilities(c);
    ensureClubHonors(c);
    if (!c.youth.players.length) fillYouthSquad(c);
    for (const p of c.players || []) {
      if (p.potential == null) p.potential = Math.min(20, (p.ovr || 10) + 1);
      ensurePlayerHistory(p);
      ensureIntl(p);
      ensureHonors(p);
      ensureDiscipline(p);
    }
    for (const p of c.youth.players || []) {
      if (p.potential == null) p.potential = Math.min(20, (p.ovr || 10) + 1);
      ensurePlayerHistory(p);
      ensureIntl(p);
      ensureHonors(p);
    }
  }
  // 鏃ф。鑻ヤ笉瓒充笁绾х粨鏋勶紝鎻愮ず寮€鏂版。浣撻獙瀹屾暣鍗囬檷绾?
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const c of w.clubs || []) counts[c.division || 3]++;
  if (counts[1] < 4 || counts[2] < 4 || counts[3] < 4) {
    // 浠嶅彲鐜╋紝浣嗗崌闄嶇骇鍙兘璺宠繃
    console.warn("瀛樻。鑱旇禌缁撴瀯涓嶅畬鏁达紝寤鸿寮€鏂版。浣撻獙涓夌骇鑱旇禌");
  }
}

function enterMain() {
  showScreen("main");
  bindMainOnce();
  refreshAll();
}

// ---------- Tabs ----------
let mainBound = false;
function bindMainOnce() {
  if (mainBound) return;
  mainBound = true;

  $$(".tab").forEach((btn) => {
    btn.onclick = () => {
      $$(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      $(`#tab-${btn.dataset.tab}`).classList.add("active");
      refreshAll();
    };
  });

  // 淇＄绛涢€?+ 姒傝鍏ュ彛
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

  // 姣旇禌鍊嶉€燂紙鍚?脳0.5 鎱㈡斁锛?
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
      toast(getLang() === "en" ? `Speed 脳${matchSpeed}` : `姣旇禌鍊嶉€?脳${matchSpeed}`);
    });
  });

  // FMM锛歺G / 鎺х悆 / 灏勯棬 鎶樺彔
  $("#btn-match-stats-toggle")?.addEventListener("click", () => toggleMatchStatsPanel());

  // 鏆傚仠 / 涓嬩竴姝?/ 閫愪簨浠?
  $("#btn-match-pause")?.addEventListener("click", () => toggleMatchPause());
  $("#btn-match-sfx")?.addEventListener("click", () => toggleMatchSfx());
  $("#btn-match-step")?.addEventListener("click", () => requestMatchStep());
  $("#btn-match-step-mode")?.addEventListener("click", () => toggleMatchStepMode());

  // 浜嬩欢娴?/ 璧涘悗鎶ュ憡锛氱偣杩涚悆鍐嶇湅鍥炴斁
  $("#match-log")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-goal-replay]");
    if (!btn) return;
    e.preventDefault();
    const idx = Number(btn.dataset.goalReplay);
    if (Number.isFinite(idx)) replayStoredGoal(idx);
  });
  $("#match-report")?.addEventListener("click", (e) => {
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
      : `杩斿洖涓昏彍鍗曪紵锛堝凡鑷姩瀛樺埌妲?${getActiveSlot()}锛塦)) {
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
  $("#btn-play-match").onclick = () => openMatch();
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
      return `<option value="${k}">${f.name}${f.desc ? ` 路 ${f.desc}` : ""}</option>`;
    })
    .join("");
  // 涓満闃靛瀷涓嬫媺
  const htForm = $("#ht-formation");
  if (htForm) {
    htForm.innerHTML = Object.keys(FORMATIONS)
      .map((k) => `<option value="${k}">${FORMATIONS[k].name}</option>`)
      .join("");
  }

  formSel.onchange = () => {
    const club = getUserClub(world);
    ensureTactics(club);
    club.tactics.formation = formSel.value;
    autoLineup(club);
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
      if (valEl) valEl.textContent = `${e.target.value} 路 ${lab}`;
      renderTacticsSummary();
      saveGame(world);
    };
  };
  bindTacSlider("#pressing", "pressing", "#pressing-val");
  bindTacSlider("#tempo", "tempo", "#tempo-val");
  bindTacSlider("#width", "width", "#width-val");
  bindTacSlider("#defensive-line", "defensiveLine", "#defensive-line-val");

  // 棰勮鎸夐挳
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
        autoLineup(club);
      }
      renderTactics();
      renderSquad();
      saveGame(world);
      toast(t("tac.presetApplied", { name: t(`tac.preset.${id}`) }));
    });
  }

  $("#btn-auto-xi").onclick = () => {
    autoLineup(getUserClub(world));
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

  // 璁炬柦椤垫寜閽敤浜嬩欢濮旀墭锛堝姩鎬佹覆鏌擄級
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
    refreshStaffMarket(world);
    // 鍒锋柊璐?
    const club = getUserClub(world);
    const fee = 50_000;
    if (club.money >= fee) {
      club.money -= fee;
      toast(t("toast.staffRefresh"));
    } else {
      toast(t("toast.staffRefreshFree"));
    }
    saveGame(world);
    renderStaff();
    renderTopbar();
  };

  const tableDiv = $("#table-division");
  if (tableDiv) {
    tableDiv.onchange = () => renderTable();
  }

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

  // 绉垎姒?/ 璧涚▼ / 鏁版嵁姒滅瓑锛氱偣鍑婚槦鍚嶆墦寮€淇变箰閮ㄨ鎯?
  document.body.addEventListener("click", (e) => {
    if (!world) return;
    const clubLink = e.target.closest("[data-club-link]");
    if (clubLink) {
      e.preventDefault();
      showClubModal(clubLink.dataset.clubLink);
      return;
    }
    // 浠绘剰鐣岄潰锛氱偣鍑荤悆鍛樺悕鎵撳紑璧勬枡
    const playerLink = e.target.closest("[data-player-link]");
    if (playerLink) {
      e.preventDefault();
      e.stopPropagation();
      showPlayerModal(playerLink.dataset.playerLink);
    }
  });

  $("#modal-close").onclick = () => closeModal();
  $("#modal").onclick = (e) => {
    if (e.target.id === "modal") closeModal();
  };

  // match buttons
  $("#btn-sim-fast").onclick = () => runMatch("fast");
  $("#btn-sim-live").onclick = () => runMatch("live");
  $("#btn-sim-instant").onclick = () => runMatch("instant");
  $("#btn-match-continue").onclick = () => {
    const wasReview = !!matchPlayback.reviewMode;
    if (!wasReview) autosave("after-match");
    destroyMatchView();
    matchView = null;
    matchPlayback.reviewMode = false;
    // 鎭㈠鎸夐挳鏂囨锛堝洖椤炬椂鏀规垚浜嗐€岃繑鍥炰勘涔愰儴銆嶏級
    const cont = $("#btn-match-continue");
    if (cont) cont.textContent = t("match.continue");
    showScreen("main");
    pendingMatch = null;
    matchState = null;
    pendingSubs = [];
    refreshAll();
    if (wasReview) {
      // 鍥炲埌璧涚▼椤碉紝鏂逛究杩炵画鍥炵湅
      const tabBtn = document.querySelector('[data-tab="fixtures"]');
      if (tabBtn) tabBtn.click();
    }
  };

  // 璧涚▼锛氱偣鍑汇€屾垬鎶ャ€嶆墦寮€鏃у満鍥炵湅
  $("#fixtures-table")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".fix-report-btn");
    if (!btn) return;
    e.preventDefault();
    openPastMatchReport(btn.dataset.fixtureKey);
  });

  // 涓満璋冩暣
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
  ensureManagerCareer(world);
  renderTopbar();
  renderDashboard();
  renderSquad();
  renderYouth();
  renderFacilities();
  renderStaff();
  renderTraining();
  renderTactics();
  renderTable();
  renderClubs();
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

/** 淇＄绛涢€夛細pending | all */
let inboxFilter = "pending";

function updateInboxTabBadge() {
  if (!world) return;
  const n = pendingInboxCount(world);
  const btn = document.querySelector('.tab[data-tab="inbox"]');
  if (!btn) return;
  const base = t("tab.inbox") || (getLang() === "en" ? "Inbox" : "淇＄");
  btn.textContent = n > 0 ? `${base} (${n})` : base;
  btn.classList.toggle("has-badge", n > 0);
}

function goToInboxTab() {
  const btn = document.querySelector('.tab[data-tab="inbox"]');
  if (btn) btn.click();
}

function renderInbox() {
  if (!world) return;
  ensureInbox(world);
  syncPoachBidsToInbox(world);
  const en = getLang() === "en";
  const pendingOnly = inboxFilter === "pending";
  const list = listInbox(world, { pendingOnly, limit: 50 });
  const pending = pendingInboxCount(world);
  const countEl = $("#inbox-count");
  if (countEl) {
    countEl.textContent = en
      ? `${pending} pending 路 ${list.length} shown`
      : `寰呭姙 ${pending} 路 鏄剧ず ${list.length}`;
  }

  // 绛涢€夋寜閽珮浜?
  document.querySelectorAll("[data-inbox-filter]").forEach((b) => {
    b.classList.toggle("active", b.dataset.inboxFilter === inboxFilter);
  });

  const box = $("#inbox-list");
  if (!box) return;
  if (!list.length) {
    box.innerHTML = `<p class="muted inbox-empty">${escapeHtml(
      en
        ? pendingOnly
          ? "No pending mail 鈥?you're clear."
          : "Inbox is empty."
        : pendingOnly
          ? "鏆傛棤寰呭姙閭欢锛屾竻娓呯埥鐖姐€?
          : "淇＄涓虹┖銆?
    )}</p>`;
    return;
  }

  box.innerHTML = list
    .map((m) => {
      const cat = inboxCatLabel(m.category, en ? "en" : "zh");
      const st =
        m.status === "pending"
          ? en
            ? "Pending"
            : "寰呭姙"
          : m.status === "read"
            ? en
              ? "Read"
              : "宸茶"
            : m.status === "done"
              ? en
                ? "Done"
                : "宸插鐞?
              : en
                ? "Expired"
                : "杩囨湡";
      const pri =
        (m.priority || 1) >= 3
          ? `<span class="inbox-pri high">${en ? "Urgent" : "绱ф€?}</span>`
          : (m.priority || 1) >= 2
            ? `<span class="inbox-pri mid">${en ? "Important" : "閲嶈"}</span>`
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
        <h3 class="inbox-title">${escapeHtml(m.title)}</h3>
        ${m.body ? `<p class="inbox-body">${escapeHtml(m.body)}</p>` : ""}
        <div class="inbox-actions">${actions}</div>
      </article>`;
    })
    .join("");

  box.querySelectorAll("[data-inbox-act]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.inboxId;
      const act = btn.dataset.inboxAct;
      if (act === "accept" && !confirm(en ? "Accept offer and sell the player?" : "纭鎺ュ彈鎶ヤ环骞舵斁璧扮悆鍛橈紵")) {
        return;
      }
      const res = resolveInboxAction(world, id, act);
      toast(res.msg || (res.ok ? "OK" : "澶辫触"));
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
  // 鐐规爣棰樻爣宸茶
  box.querySelectorAll(".inbox-item").forEach((el) => {
    el.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-inbox-act]")) return;
      const id = el.dataset.mailId;
      if (markInboxRead(world, id)) {
        saveGame(world);
        renderInbox();
        updateInboxTabBadge();
      }
    });
  });
}

function renderTraining() {
  const club = getUserClub(world);
  if (!club) return;
  const t = ensureTraining(club);
  const sum = trainingSummary(club);

  const focusBox = $("#training-focus-list");
  if (focusBox) {
    focusBox.innerHTML = Object.values(TRAINING_FOCUSES)
      .map(
        (f) => `<button type="button" class="training-opt${
          t.focus === f.key ? " active" : ""
        }" data-focus="${f.key}">
          <div class="opt-title">${escapeHtml(f.label)}</div>
          <div class="opt-desc">${escapeHtml(f.desc)}</div>
        </button>`
      )
      .join("");
    focusBox.querySelectorAll("[data-focus]").forEach((btn) => {
      btn.onclick = () => {
        setTraining(club, { focus: btn.dataset.focus });
        autosave("training-focus");
        renderTraining();
        toast(`璁粌閲嶇偣锛?{TRAINING_FOCUSES[btn.dataset.focus].label}`);
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
          <div class="opt-title">${escapeHtml(i.label)}</div>
        </button>`
      )
      .join("");
    intBox.querySelectorAll("[data-intensity]").forEach((btn) => {
      btn.onclick = () => {
        setTraining(club, { intensity: btn.dataset.intensity });
        autosave("training-intensity");
        renderTraining();
        toast(`璁粌寮哄害锛?{TRAINING_INTENSITIES[btn.dataset.intensity].label}`);
      };
    });
  }

  const sumEl = $("#training-summary");
  if (sumEl) {
    const coach = club.staff?.coach;
    const coachTxt = coach ? `鏁欑粌 ${coach.name}锛?{coach.rating}锛塦 : "鏁欑粌 鈥?;
    sumEl.innerHTML = `<strong>褰撳墠锛?/strong>${escapeHtml(sum.line)}<br>
      <span class="muted">${escapeHtml(sum.desc)}</span><br>
      <span class="muted">${escapeHtml(coachTxt)} 路 姣忓懆缁撶畻灞炴€ф垚闀?路 姣忔棩褰卞搷浣撹兘涓庝激鐥呴闄?/span>`;
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
          const tag = p.injured > 0 ? " 浼? : "";
          return `<div class="training-fit-row${lowCls}">
            <span>${playerLinkHtml(p.id, playerDisplaySurname(p.name, p.nationality) + tag)}</span>
            <div class="bar"><i style="width:${fit}%"></i></div>
            <span class="fit-val">${fit}%</span>
          </div>`;
        })
        .join("") || `<span class="muted">鏆傛棤鐞冨憳</span>`;
  }

  const hint = $("#training-hint");
  if (hint) {
    let tip = `骞冲潎浣撹兘 ${avg}% 路 浼ょ梾 ${injured} 浜?路 浣庝綋鑳?${low} 浜恒€俙;
    if (avg < 70) tip += " 寤鸿鏀广€屾仮澶嶈皟鏁淬€嶆垨銆岃交鏉俱€嶅己搴︺€?;
    else if (t.intensity === "hard" && avg < 80) tip += " 楂樺己搴︿笅浣撹兘鍋忕揣锛屽皬蹇冭缁冧激銆?;
    else if (t.focus === "youth") tip += " 闈掕渚ч噸鏃舵湰鍛ㄩ潚璁垚闀垮姞蹇紝涓€绾块槦鎴愰暱鍋忔參銆?;
    else tip += " 姣旇禌鏃ュ墠鍙垏銆岃禌鍓嶅噯澶囥€嶃€?;
    hint.textContent = tip;
  }
}

function renderStaff() {
  const club = getUserClub(world);
  ensureStaff(club);
  if (!Array.isArray(world.staffMarket)) refreshStaffMarket(world);

  const box = $("#staff-current");
  if (!box) return;

  const roles = ["coach", "scout", "doctor"];
  box.innerHTML = roles
    .map((role) => {
      const s = club.staff[role];
      const meta = ROLES[role];
      return `<div class="staff-card">
        <div class="staff-card-head">
          ${staffAvatarHtml(s, 52)}
          <div>
            <div class="role">${meta.label}</div>
            <h3 style="margin:0.15rem 0">${escapeHtml(s.name)}</h3>
          </div>
        </div>
        <div class="meta">鑳藉姏 <strong class="${ovrClass(s.rating)}">${s.rating}</strong> 路 ${s.age} 宀?/div>
        <div class="meta">鍛ㄨ柂 ${formatMoney(s.wage)}</div>
        <p class="hint" style="margin:0.4rem 0">${meta.effect}</p>
        <button class="btn small danger" data-fire="${role}">瑙ｇ害</button>
      </div>`;
    })
    .join("");

  box.querySelectorAll("[data-fire]").forEach((btn) => {
    btn.onclick = () => {
      if (!confirm("瑙ｇ害闇€鏀粯绾?4 鍛ㄨ柂姘翠綔涓鸿ˉ鍋匡紝纭锛?)) return;
      const res = fireStaffForUser(world, btn.dataset.fire);
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });

  const tbody = $("#staff-market-table tbody");
  tbody.innerHTML = world.staffMarket
    .map((s) => {
      const fee = Math.round(s.rating * s.rating * 8000);
      return `<tr>
        <td class="avatar-cell">${staffAvatarHtml(s, 32)} ${escapeHtml(s.name)}</td>
        <td>${ROLES[s.role]?.label || s.role}</td>
        <td class="${ovrClass(s.rating)}"><strong>${s.rating}</strong></td>
        <td>${s.age}</td>
        <td>${formatMoney(s.wage)}</td>
        <td>${formatMoney(fee)}</td>
        <td><button class="btn small primary" data-hire="${s.id}">鑱樿</button></td>
      </tr>`;
    })
    .join("");

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

function renderMedia() {
  ensureMedia(world);
  const feed = $("#media-feed");
  if (!feed) return;
  const list = world.media || [];
  $("#media-count").textContent = t("media.count", { n: list.length });
  feed.innerHTML = list.length
    ? list
        .map((a) => {
          const tone = a.tone || "neutral";
          return `<article class="media-card ${tone}">
            <div class="outlet">
              <span>${escapeHtml(a.outlet || "濯掍綋")}</span>
              <span>S${a.season || world.season} 路 D${a.day ?? "鈥?}</span>
            </div>
            <h3>${escapeHtml(a.headline)}</h3>
            <p class="body">${escapeHtml(a.body || "")}</p>
          </article>`;
        })
        .join("")
    : `<p class="muted">鏆傛棤鎶ラ亾銆傛瘮璧涖€佽浆浼氥€佹帹杩涙棩绋嬪悗浼氬嚭鐜板獟浣撳唴瀹广€?/p>`;
}

function playerStats(p) {
  ensurePlayerHistory(p);
  return p.stats || emptyMatchStats();
}

function careerStats(p) {
  ensurePlayerHistory(p);
  // 鐢熸动灞曠ず = 宸插綊妗?career + 褰撳墠璧涘灏氭湭褰掓。鐨?stats
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
  const kit = ensureKit(club);
  $("#club-name").innerHTML = `<span class="kit-chip" style="${kitBadgeStyle(club)}" title="${kit.style}"></span> ${escapeHtml(club.name)}`;
  const mgrAv = avatarHtml(
    { id: `mgr_${world.userClubId}_${world.managerName}`, name: world.managerName, age: 42 },
    { role: "manager", size: 28 }
  );
  $("#manager-name").innerHTML = `${mgrAv} <span>${escapeHtml(world.managerName)} 路 ${div?.short || "涔欑骇"}</span>`;
  $("#season-label").textContent = t("top.season", { n: world.season });
  const tw = transferWindowShort(world);
  $("#date-label").textContent = `${t("top.day", { n: world.day })} 路 ${tw}`;
  $("#money-label").textContent = formatMoney(club.money);
}

function renderDashboard() {
  const club = getUserClub(world);
  const next = getNextUserMatch(world);
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
    const divName = DIVISIONS[club.division || 3]?.name || "";
    box.innerHTML = `
      <div><strong>${world.season} 璧涘宸茬粨鏉?/strong></div>
      <div class="muted" style="margin-top:0.4rem">
        褰撳墠鑱旇禌锛?{divName}<br/>
        宸插鐞嗗勾榫?/ 閫€褰?/ 鍗囬檷绾с€傝繘鍏ヤ笅涓€璧涘灏嗘寜鏂扮骇鍒敓鎴愯禌绋嬨€?
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
    box.innerHTML = `
      <div><strong>${next.competition === "cup" ? next.roundLabel || "鏉禌" : `绗?${next.round} 杞甡}</strong> 路 绗?${next.day} 澶?路 ${next.home === club.id ? "涓诲満" : "瀹㈠満"}</div>
      <div style="margin-top:0.4rem;font-size:1.25rem">
        ${clubLinkHtml(home.id, home.name)} <span class="muted">vs</span> ${clubLinkHtml(away.id, away.name)}
      </div>
      <div class="muted" style="margin-top:0.35rem">
        ${ready ? (getLang() === "en" ? "Matchday 路 Pre-match briefing" : "鍙互寮€璧?路 璧涘墠绠€鎶?) : (getLang() === "en" ? `${next.day - world.day} day(s) to go` : `杩橀渶绛夊緟 ${next.day - world.day} 澶ー)}
      </div>
      ${briefHtml}
    `;
    playBtn.disabled = !ready;
    playBtn.textContent = ready ? t("dash.play") : t("dash.notMatchday");
    advanceBtn.disabled = false;
    // 姣旇禌鏃ュ綋澶╋細搴斿厛韪㈡瘮璧涳紝绂佺敤璺冲埌涓嬪満 / 璧涘鏈?
    if (advanceMatchBtn) advanceMatchBtn.disabled = ready;
    if (advanceSeasonBtn) advanceSeasonBtn.disabled = ready;
    nextSeasonBtn.style.display = "none";
  }

  // 缁忕悊鐢熸动鎽樿
  const careerBox = $("#manager-career-dash");
  if (careerBox) {
    const mc = ensureManagerCareer(world);
    const wr = managerWinRate(mc);
    careerBox.innerHTML = `
      <div><strong>${escapeHtml(world.managerName)}</strong> 路 ${mc.seasons} 璧涘 路 ${mc.matches} 鍦?/div>
      <div class="muted" style="margin-top:0.25rem">${mc.wins}鑳?${mc.draws}骞?${mc.losses}璐?路 鑳滅巼 ${wr}%</div>
      <div class="muted">${mc.titles} 鍐?路 ${mc.promotions} 娆″崌绾?路 ${mc.cups} 鏉?路 瑙ｉ泧 ${mc.sacked}</div>
      ${
        mc.bestFinish
          ? `<div class="muted">鏈€浣筹細${mc.bestFinish.season} ${escapeHtml(mc.bestFinish.divName)} 绗?${mc.bestFinish.pos}</div>`
          : ""
      }
    `;
  }

  const userDiv = club.division || 3;
  const table = getSortedTable(world, userDiv);
  const pos = table.findIndex((r) => r.id === club.id) + 1;
  const row = table.find((r) => r.id === club.id) || { pts: 0, w: 0, d: 0, l: 0 };
  const divName = DIVISIONS[userDiv]?.name || "";
  const promoHint =
    userDiv === 3
      ? "锛堝墠 3 鍚嶅崌绾х敳绾э級"
      : userDiv === 2
        ? "锛堝墠 3 鍗囪秴鑱?路 鍚?3 闄嶄箼绾э級"
        : "锛堝悗 3 鍚嶉檷鐢茬骇锛?;
  $("#my-rank").textContent = `${divName} 绗?${pos} 鍚?路 ${row.pts} 鍒嗭紙${row.w}鑳?${row.d}骞?${row.l}璐燂級${promoHint}`;

  // 褰撳墠璁粌锛堟瑙堜竴鐪煎彲瑙侊級
  const trainDash = document.querySelector("#training-dash");
  if (trainDash) {
    trainDash.textContent = trainingSummary(club).line + t("dash.trainHint");
  }
  // 璁炬柦鎽樿
  let facDash = document.querySelector("#facilities-dash");
  if (!facDash) {
    const trainEl = document.querySelector("#training-dash");
    if (trainEl && trainEl.parentElement) {
      const h = document.createElement("h3");
      h.textContent = "淇变箰閮ㄨ鏂?;
      facDash = document.createElement("div");
      facDash.id = "facilities-dash";
      facDash.className = "muted";
      facDash.style.marginBottom = "0.5rem";
      trainEl.parentElement.insertBefore(h, trainEl);
      trainEl.parentElement.insertBefore(facDash, trainEl);
    }
  }
  if (facDash) {
    ensureFacilities(club);
    facDash.textContent = facilitySummaryLine(club) + t("dash.facHint");
  }

  // 杞細绐?
  ensureTransferWindow(world);
  const twDash = document.querySelector("#transfer-window-dash");
  if (twDash) {
    const open = isTransferWindowOpen(world);
    twDash.textContent = transferWindowLabel(world);
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
      const warn = !b.settled && (b.sackWarnings || 0) > 0 ? ` 璀﹀憡${b.sackWarnings}/3` : "";
      boardEl.textContent =
        boardStatusLine(b) +
        (b.settled || b.sacked ? "" : ` 路 鐜扮${pos}/鐩爣${b.targetPos} 路 ${played}鍦?{warn}`);
    }
  }
  $("#news-list").innerHTML = world.news
    .slice(0, 12)
    .map((n) => `<li><strong>D${n.day}</strong> ${escapeHtml(n.text)}</li>`)
    .join("") || "<li>鏆傛棤鏂伴椈</li>";

  // 姒傝淇＄鎽樿
  ensureInbox(world);
  syncPoachBidsToInbox(world);
  const dashIb = $("#dash-inbox");
  if (dashIb) {
    const en = getLang() === "en";
    const n = pendingInboxCount(world);
    const top = listInbox(world, { pendingOnly: true, limit: 3 });
    if (!n && !top.length) {
      dashIb.innerHTML = `<span class="muted">${escapeHtml(en ? "No pending mail" : "鏆傛棤寰呭姙")}</span>`;
    } else {
      const lines = top
        .map(
          (m) =>
            `<div class="dash-inbox-row"><span class="inbox-cat mini">${escapeHtml(inboxCatLabel(m.category, en ? "en" : "zh"))}</span> ${escapeHtml(m.title)}</div>`
        )
        .join("");
      dashIb.innerHTML = `<div class="dash-inbox-count">${en ? `${n} pending` : `${n} 灏佸緟鍔瀈}</div>${lines}`;
    }
  }
}

function ovrClass(n) {
  if (n >= 15) return "stat-high";
  if (n >= 11) return "stat-mid";
  return "stat-low";
}

function renderSquad() {
  const club = getUserClub(world);
  // 鏃у瓨妗ｉ噷浣撹兘鍙兘鏄诞鐐癸紙璁粌 *0.6锛夛紱灞曠ず涓庡瓨妗ｄ竴骞舵敹鎴愭暣鏁?
  for (const p of club.players || []) {
    if (p.fitness != null && !Number.isInteger(p.fitness)) {
      p.fitness = Math.round(Math.max(0, Math.min(100, p.fitness)));
    }
    if (p.morale != null && !Number.isInteger(p.morale)) {
      p.morale = Math.round(Math.max(0, Math.min(100, p.morale)));
    }
  }
  const xi = new Set(club.tactics.lineup);
  const tbody = $("#squad-table tbody");
  const sorted = [...club.players].sort((a, b) => b.ovr - a.ovr);

  $("#squad-count").textContent = t("squad.count", { n: sorted.length });

  tbody.innerHTML = sorted
    .map((p) => {
      ensureDiscipline(p);
      ensurePlayerHistory(p);
      const ovr = p.ovr || playerOverall(p);
      const s = playerStats(p);
      const isGk = p.pos === "GK";
      // 鏈禌瀛ｏ細鍑哄満 / 杩涚悆路闆跺皝 / 鍔╂敾路澶辩悆
      const apps = s.apps || 0;
      const colG = isGk ? s.cleanSheets || 0 : s.goals || 0;
      const colA = isGk ? s.goalsConceded || 0 : s.assists || 0;
      const gTitle = isGk
        ? t("squad.csTitle") || "鏈禌瀛ｉ浂灏?
        : t("squad.goalsTitle") || "鏈禌瀛ｈ繘鐞?;
      const aTitle = isGk
        ? t("squad.gaTitle") || "鏈禌瀛ｅけ鐞?
        : t("squad.astTitle") || "鏈禌瀛ｅ姪鏀?;
      const gCls = !isGk && colG > 0 ? "stat-high" : isGk && colG > 0 ? "stat-high" : "";
      const aCls =
        isGk && colA > 0 ? "stat-low" : !isGk && colA > 0 ? "stat-mid" : "";
      const avgR = seasonAvgRating(p);
      const lastR = s.lastRating != null ? s.lastRating : null;
      const num = p.number != null ? p.number : "鈥?;
      const statusBadges = [
        xi.has(p.id) ? '<span class="badge">棣栧彂</span>' : "",
        p.loan ? `<span class="badge loan" title="${escapeHtml(t("contract.loanIn") || "绉熷€?)}">${escapeHtml(t("contract.loanIn") || "绉熷€?)}</span>` : "",
        p.injured > 0 ? '<span class="badge ATT">浼?/span>' : "",
        (p.suspendedMatches || 0) > 0
          ? `<span class="badge ATT" title="鍋滆禌">鍋?{p.suspendedMatches}</span>`
          : "",
        (p.yellowsSeason || 0) >= 4 && !(p.suspendedMatches > 0)
          ? `<span class="badge" style="background:#e6b450;color:#111" title="绱榛勭墝">榛?{p.yellowsSeason}</span>`
          : "",
        p._needsRenew
          ? `<span class="badge contract-urgent" title="${escapeHtml(t("contract.needsRenew") || "寰呯画绾?)}">${escapeHtml(t("contract.needsRenew") || "寰呯画")}</span>`
          : (p.contractYears || 0) <= 1 && !p.loan
            ? `<span class="badge contract-short" title="${escapeHtml(t("contract.expiring") || "鍚堝悓灏嗗敖")}">${escapeHtml(t("contract.expiring") || "灏嗗敖")}</span>`
            : "",
      ]
        .filter(Boolean)
        .join(" ");
      const contractCell = p.loan
        ? escapeHtml(t("contract.loanIn") || "绉熷€?)
        : p._needsRenew
          ? escapeHtml(t("contract.needsRenew") || "寰呯画绾?)
          : `${p.contractYears ?? "鈥?}骞碻;
      return `<tr class="${xi.has(p.id) ? "me" : ""} ${!isAvailable(p) ? "row-unavailable" : ""} ${needsContractAttention(p) && !p.loan ? "row-contract" : ""}">
        <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(club)}">${num}</span></td>
        <td class="name-with-avatar">${playerAvatarHtml(p, club, 30)} <span>${playerLinkHtml(p.id, p.name)} ${statusBadges}</span></td>
        <td>${nationLabel(p)}</td>
        <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
        <td>${p.age}</td>
        <td class="${ovrClass(ovr)}"><strong>${ovr}</strong></td>
        <td class="num-stat" title="${escapeHtml(t("squad.appsTitle") || "鏈禌瀛ｅ嚭鍦?)}">${apps}</td>
        <td class="num-stat ${gCls}" title="${escapeHtml(gTitle)}">${colG}</td>
        <td class="num-stat ${aCls}" title="${escapeHtml(aTitle)}">${colA}</td>
        <td class="num-stat rating-cell ${ratingClass(avgR)}" title="${escapeHtml(t("squad.avgRTitle") || "鏈禌瀛ｅ満鍧囪瘎鍒?)}">${formatRating(avgR)}</td>
        <td class="num-stat rating-cell ${ratingClass(lastR)}" title="${escapeHtml(t("squad.lastRTitle") || "鏈€杩戜竴鍦鸿瘎鍒?)}">${formatRating(lastR)}</td>
        <td>${Math.round(p.fitness ?? 0)}%</td>
        <td>${Math.round(p.morale ?? 0)}</td>
        <td class="contract-cell">${contractCell}</td>
        <td>${formatMoney(p.value)}</td>
        <td>${formatMoney(p.wage)}</td>
        <td><button class="btn small" data-pid="${p.id}">璇︽儏</button></td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("button[data-pid]").forEach((btn) => {
    btn.onclick = () => showPlayerModal(btn.dataset.pid);
  });
}

function showPlayerModal(playerId) {
  const club = getUserClub(world);
  let player = club.players.find((p) => p.id === playerId);
  let fromOther = null;
  if (!player) {
    for (const c of world.clubs) {
      player = c.players.find((p) => p.id === playerId);
      if (player) {
        fromOther = c;
        break;
      }
    }
  }
  // 閫€褰圭悆鍛樺巻鍙诧紙鑻ヤ箣鍚?UI 寮曠敤锛?
  if (!player && world.retiredPlayers) {
    player = world.retiredPlayers.find((p) => p.id === playerId);
  }
  if (!player) return;

  const a = player.attrs;
  const isOther = !!fromOther;
  const fogRows = scoutAttrRows(player, club, {
    ownPlayer: !isOther,
    lang: getLang() === "en" ? "en" : "zh",
  });

  const pot = isOther
    ? formatScoutPotFog(player, club, { ownPlayer: false })
    : player.potential != null
      ? String(player.potential)
      : "鈥?;
  const ovrShow = isOther
    ? formatScoutOvrFog(player, club, { ownPlayer: false })
    : String(player.ovr);
  ensurePlayerHistory(player);
  ensureIntl(player);
  ensureHonors(player);
  const season = playerStats(player);
  const career = careerStats(player);
  const intl = player.intl || {};
  const isGk = player.pos === "GK";

  // 鍒嗚禌瀛ｅ巻鍙?+ 褰撳墠鏈綊妗ｈ禌瀛?
  const curAvgR = seasonAvgRating(player);
  const historyRows = [...(player.history || [])]
    .sort((a, b) => b.season - a.season)
    .map(
      (h) => `<tr>
        <td>${h.season}</td>
        <td>${escapeHtml(h.clubName || "鈥?)}</td>
        <td>${h.apps}</td>
        <td>${isGk ? h.cleanSheets : h.goals}</td>
        <td>${isGk ? h.goalsConceded : h.assists}</td>
        <td class="rating-cell ${ratingClass(h.avgRating)}">${formatRating(h.avgRating)}</td>
      </tr>`
    );
  if (season.apps || season.goals || season.assists || season.cleanSheets || season.goalsConceded) {
    const clubName =
      fromOther?.name ||
      world.clubs.find((c) => c.id === player.clubId)?.name ||
      getUserClub(world).name;
    historyRows.unshift(`<tr class="me">
      <td>${world.season}*</td>
      <td>${escapeHtml(clubName)}</td>
      <td>${season.apps}</td>
      <td>${isGk ? season.cleanSheets : season.goals}</td>
      <td>${isGk ? season.goalsConceded : season.assists}</td>
      <td class="rating-cell ${ratingClass(curAvgR)}">${formatRating(curAvgR)}</td>
    </tr>`);
  }

  const histHead = isGk
    ? `<th>璧涘</th><th>鐞冮槦</th><th>鍑哄満</th><th>闆跺皝</th><th>澶辩悆</th><th>鍦哄潎</th>`
    : `<th>璧涘</th><th>鐞冮槦</th><th>鍑哄満</th><th>杩涚悆</th><th>鍔╂敾</th><th>鍦哄潎</th>`;

  const honorHtml = (player.honors || []).length
    ? `<div class="honor-list">${player.honors
        .slice(0, 12)
        .map(
          (h) => `<div class="honor-item">
            <div class="season">${h.season} 路 ${escapeHtml(h.clubName || "")}</div>
            <strong>${escapeHtml(h.title)}</strong>
            ${h.detail ? ` <span class="muted">锛?{escapeHtml(h.detail)}锛?/span>` : ""}
          </div>`
        )
        .join("")}</div>`
    : `<p class="muted" style="margin:0">鏆傛棤鑽ｈ獕锛岃禌瀛ｆ湯閲戦澊/鍔╂敾鐜?鏈€浣抽樀瀹?鍐犲啗绛変細鍐欏叆姝ゅ</p>`;

  const kitClub = fromOther || club;
  if (kitClub) {
    ensureKit(kitClub);
    ensurePlayerNumber(kitClub, player);
  }
  $("#modal-card")?.classList.remove("wide");
  $("#modal-body").innerHTML = `
    <div class="player-modal-head">
      ${playerAvatarHtml(player, kitClub, 64)}
      ${kitClub ? renderKitShirt(kitClub, player.number, 56) : ""}
      <div>
    <h2 style="margin:0 0 0.25rem">${escapeHtml(player.name)}${player.number != null ? ` <span class="muted">#${player.number}</span>` : ""}</h2>
    <p class="muted">
      <span class="badge ${player.pos}">${POS_LABEL[player.pos]}</span>
      路 ${nationLabel(player)}
      路 ${player.age} 宀?路 鑳藉姏 <strong class="${isOther ? "" : ovrClass(player.ovr)}">${escapeHtml(ovrShow)}</strong>
      路 娼滃姏 <strong>${escapeHtml(String(pot))}</strong>
      ${player.fromYouth ? ' 路 <span class="badge MID">闈掕</span>' : ""}
      ${fromOther ? ` 路 ${escapeHtml(fromOther.name)}` : ""}
      ${isOther ? ` 路 <span class="muted">${getLang() === "en" ? "Scout fog" : "鐞冩帰鍙"} L${scoutFogLevel(club)}</span>` : ""}
    </p>
      </div>
    </div>
    <p>韬环 ${fromOther ? formatScoutValue(world, player) : formatMoney(player.value)} 路 鍛ㄨ柂 ${formatMoney(player.wage)} 路 浣撹兘 ${Math.round(player.fitness ?? 0)}% 路 澹皵 ${Math.round(player.morale ?? 0)}
      ${
        (player.suspendedMatches || 0) > 0
          ? ` 路 <span class="badge ATT">鍋滆禌 ${player.suspendedMatches} 鍦?/span>`
          : ""
      }
      ${
        (player.yellowsSeason || 0) > 0
          ? ` 路 璧涘榛勭墝 ${player.yellowsSeason}`
          : ""
      }
      ${
        player.loan
          ? ` 路 <span class="badge loan">${escapeHtml(t("contract.loanIn") || "绉熷€?)}</span>`
          : player.contractYears != null
            ? ` 路 鍚堝悓 ${player.contractYears} 骞碻
            : ""
      }
      ${player._needsRenew ? ` 路 <span class="badge contract-urgent">${escapeHtml(t("contract.needsRenew") || "寰呯画绾?)}</span>` : ""}
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
    ${renderPlayerContractActions(player, fromOther)}

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">鏈禌瀛ｏ紙淇变箰閮級</h3>
    <p class="muted" style="margin:0">鍑哄満 ${season.apps}
      ${
        isGk
          ? ` 路 闆跺皝 ${season.cleanSheets} 路 澶辩悆 ${season.goalsConceded}`
          : ` 路 杩涚悆 ${season.goals} 路 鍔╂敾 ${season.assists}`
      }
      路 鍦哄潎 <strong class="${ratingClass(curAvgR)}">${formatRating(curAvgR)}</strong>
      ${
        season.lastRating != null
          ? ` 路 鏈€杩?<strong class="${ratingClass(season.lastRating)}">${formatRating(season.lastRating)}</strong>`
          : ""
      }
    </p>

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">鐢熸动鎬昏锛堜勘涔愰儴锛?/h3>
    <p class="muted" style="margin:0">鍑哄満 ${career.apps}
      ${
        isGk
          ? ` 路 闆跺皝 ${career.cleanSheets} 路 澶辩悆 ${career.goalsConceded}`
          : ` 路 杩涚悆 ${career.goals} 路 鍔╂敾 ${career.assists}`
      }
      <span style="opacity:0.7">锛堝惈鏈禌瀛ｏ級</span>
    </p>

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">鍥藉闃?/h3>
    <p class="muted" style="margin:0">
      ${nationLabel(player)} 路 鍑哄満锛圕aps锛?<strong>${intl.caps || 0}</strong>
      ${
        isGk
          ? ` 路 闆跺皝 ${intl.cleanSheets || 0} 路 澶辩悆 ${intl.goalsConceded || 0}`
          : ` 路 杩涚悆 ${intl.goals || 0} 路 鍔╂敾 ${intl.assists || 0}`
      }
    </p>
    <p class="hint" style="margin:0.25rem 0 0">绾︽瘡 30 澶╁浗闄呮瘮璧涙棩锛屼紭绉€鐞冨憳鍙兘鍏ラ€夊苟绱Н鏁版嵁</p>

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">涓汉鑽ｈ獕</h3>
    ${honorHtml}

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">鍒嗚禌瀛ｅ巻鍙?/h3>
    <div class="table-wrap">
      <table style="font-size:0.85rem">
        <thead><tr>${histHead}</tr></thead>
        <tbody>
          ${
            historyRows.length
              ? historyRows.join("")
              : `<tr><td colspan="5" class="muted">鏆傛棤鍘嗗彶锛屽畬璧涘苟杩涘叆涓嬩竴璧涘鍚庡綊妗?/td></tr>`
          }
        </tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:0.35rem">* 琛ㄧず褰撳墠璧涘锛堝皻鏈綊妗ｏ級</p>

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">${isOther ? (getLang() === "en" ? "Attributes (scout)" : "灞炴€э紙鐞冩帰鍙锛?) : getLang() === "en" ? "Attributes" : "灞炴€?}</h3>
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
  $("#modal").classList.remove("hidden");
  bindPlayerContractActions(player, fromOther);
}

/**
 * 鏈槦鐞冨憳锛氱画绾?/ 瑙ｇ害 / 澶栫锛涗粬浜猴細绉熷叆锛堢獥鍐咃級
 */
function renderPlayerContractActions(player, fromOther) {
  if (!player || world?.sacked) return "";
  const en = getLang() === "en";
  const open = isTransferWindowOpen(world);

  // 绉熷€熶腑鐨勬湰闃熺鍏?
  if (!fromOther && player.loan) {
    const until =
      player.loan.untilDay >= 9999
        ? en
          ? "end of season"
          : "璧涘鏈?
        : `D${player.loan.untilDay}`;
    return `<div class="contract-actions hint">
      ${en ? "On loan until" : "绉熷€熻嚦"} ${escapeHtml(until)} 路 ${en ? "Cannot sell / terminate" : "涓嶅彲鍑哄敭鎴栬В绾?}
    </div>`;
  }

  // 鏈槦姝ｅ紡鐞冨憳
  if (!fromOther) {
    return `<div class="contract-actions">
      <button type="button" class="btn small primary" data-act-renew="${player.id}">${escapeHtml(t("contract.renew") || (en ? "Renew" : "缁害"))}</button>
      <button type="button" class="btn small danger" data-act-terminate="${player.id}">${escapeHtml(t("contract.terminate") || (en ? "Release" : "瑙ｇ害"))}</button>
      <button type="button" class="btn small" data-act-loan-out="${player.id}" ${!open ? "disabled" : ""}>${escapeHtml(t("contract.loanOut") || (en ? "Loan out" : "澶栫"))}${!open ? (en ? " (window closed)" : "锛堢獥鍏筹級") : ""}</button>
    </div>`;
  }

  // 浠栭槦锛氬彲绉熷叆
  if (fromOther && !player.loan) {
    return `<div class="contract-actions">
      <button type="button" class="btn small" data-act-loan-in="${player.id}" data-from="${fromOther.id}" ${!open ? "disabled" : ""}>${escapeHtml(t("contract.loanInBtn") || (en ? "Loan in" : "绉熷叆"))}${!open ? (en ? " (window closed)" : "锛堢獥鍏筹級") : ""}</button>
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
    toast(getLang() === "en" ? "Player not found" : "鎵句笉鍒扮悆鍛?);
    return;
  }
  const yearsIn = prompt(
    getLang() === "en"
      ? `${prev.player.name}\nSuggested: ${prev.offer.years}y 路 wage ${formatMoney(prev.offer.newWage)} 路 bonus ${formatMoney(prev.offer.fee)}\nYears (1鈥?):`
      : `${prev.player.name}\n寤鸿锛?{prev.offer.years} 骞?路 鍛ㄨ柂 ${formatMoney(prev.offer.newWage)} 路 绛剧害濂?${formatMoney(prev.offer.fee)}\n鍚堝悓骞撮檺锛?鈥?锛夛細`,
    String(prev.offer.years)
  );
  if (yearsIn == null) return;
  const years = Math.max(1, Math.min(5, parseInt(yearsIn, 10) || prev.offer.years));
  const final = previewRenew(world, playerId, years);
  if (
    !confirm(
      getLang() === "en"
        ? `Renew ${final.player.name}?\n${years} years 路 wage ${formatMoney(final.offer.newWage)} 路 bonus ${formatMoney(final.offer.fee)}`
        : `纭涓?${final.player.name} 缁害锛焅n${years} 骞?路 鍛ㄨ柂 ${formatMoney(final.offer.newWage)} 路 绛剧害濂?${formatMoney(final.offer.fee)}`
    )
  ) {
    return;
  }
  const res = renewUserPlayer(world, playerId, { years });
  toast(res.msg);
  if (res.ok) {
    saveGame(world);
    refreshAll();
  }
}

function doTerminatePlayer(playerId) {
  const prev = previewTerminate(world, playerId);
  if (!prev) {
    toast(getLang() === "en" ? "Player not found" : "鎵句笉鍒扮悆鍛?);
    return;
  }
  if (
    !confirm(
      getLang() === "en"
        ? `Release ${prev.player.name}?\nCompensation ${formatMoney(prev.cost)} 鈥?becomes free agent.`
        : `纭涓?${prev.player.name} 瑙ｇ害锛焅n琛ュ伩 ${formatMoney(prev.cost)}锛岀悆鍛樺皢鎴愪负鑷敱韬€俙
    )
  ) {
    return;
  }
  const res = terminateUserPlayer(world, playerId);
  toast(res.msg);
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
      : "绉熷€熸湡闄愶細half=鍒颁笅涓€绐楁湯 路 season=璧涘鏈€傝緭鍏?half 鎴?season锛?,
    "half"
  );
  if (termIn == null) return;
  const term = String(termIn).toLowerCase().startsWith("s") ? "season" : "half";
  const prev = previewLoanOut(world, playerId, term);
  if (!prev) {
    toast(en ? "Cannot loan this player" : "鏃犳硶澶栫璇ョ悆鍛?);
    return;
  }
  if (
    !confirm(
      en
        ? `Loan out ${prev.player.name}?\nFee ~${formatMoney(prev.fee)} 路 host pays ~${Math.round(prev.wageShare * 100)}% wages 路 until ${prev.untilDay >= 9999 ? "EOS" : "D" + prev.untilDay}`
        : `纭澶栫 ${prev.player.name}锛焅n绉熷€熻垂绾?${formatMoney(prev.fee)} 路 瀵规柟鎵挎媴绾?${Math.round(prev.wageShare * 100)}% 钖按 路 鑷?${prev.untilDay >= 9999 ? "璧涘鏈? : "D" + prev.untilDay}`
    )
  ) {
    return;
  }
  const res = loanOutPlayer(world, playerId, { term });
  toast(res.msg);
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
      : "绉熷€熸湡闄愶細half 鎴?season锛?,
    "half"
  );
  if (termIn == null) return;
  const term = String(termIn).toLowerCase().startsWith("s") ? "season" : "half";
  const prev = previewLoanIn(world, playerId, fromClubId, term);
  if (!prev) {
    toast(en ? "Cannot loan this player" : "鏃犳硶绉熷叆璇ョ悆鍛?);
    return;
  }
  if (
    !confirm(
      en
        ? `Loan in ${prev.player.name} from ${prev.from?.short || ""}?\nFee ${formatMoney(prev.fee)} 路 you pay ~${Math.round(prev.wageShare * 100)}% wages`
        : `纭绉熷叆 ${prev.player.name}锛?{prev.from?.short || ""}锛夛紵\n绉熷€熻垂 ${formatMoney(prev.fee)} 路 鎴戞柟绾︽壙鎷?${Math.round(prev.wageShare * 100)}% 钖按`
    )
  ) {
    return;
  }
  const res = loanInPlayer(world, playerId, fromClubId, { term });
  toast(res.msg);
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
        : "纭鍙洖璇ョ悆鍛橈紵锛堣浆浼氱獥澶栭渶鏀粯鍙洖璐癸級"
    )
  ) {
    return;
  }
  const res = recallLoan(world, playerId);
  toast(res.msg);
  if (res.ok) {
    saveGame(world);
    refreshAll();
  }
}

function renderFacilities() {
  const club = getUserClub(world);
  if (!club) return;
  ensureFacilities(club);
  const grid = $("#facilities-grid");
  if (!grid) return;

  const items = [
    {
      kind: "stadium",
      icon: "馃彑锔?,
      info: stadiumInfo(club),
      effect: (i) =>
        `瀹归噺绾?${i.capacity.toLocaleString()} 路 涓诲満鏀跺叆绾?${formatMoney(i.matchday)}/鍦?路 鍛ㄧ淮鎶?${formatMoney(i.upkeep)}`,
      nextEffect: (lv) => {
        const n = STADIUM_LEVELS[lv];
        return n
          ? `鈫?瀹归噺 ${n.capacity.toLocaleString()} 路 鏀跺叆绾?${formatMoney(n.matchday)}`
          : "";
      },
    },
    {
      kind: "training",
      icon: "馃弸锔?,
      info: trainingFacilityInfo(club),
      effect: (i) =>
        `鎴愰暱+${Math.round((i.growth || 0) * 1000) / 10}% 路 鎭㈠+${i.heal} 路 浼ょ梾脳${i.injuryMod} 路 鍛ㄧ淮鎶?${formatMoney(i.upkeep)}`,
      nextEffect: (lv) => {
        const n = TRAINING_FACILITY_LEVELS[lv];
        return n ? `鈫?鎴愰暱+${Math.round(n.growth * 1000) / 10}% 路 鎭㈠+${n.heal}` : "";
      },
    },
    {
      kind: "youth",
      icon: "馃尡",
      info: youthFacilityInfo(club),
      effect: (i) =>
        `瀹归噺 ${i.capacity} 路 鎷涚敓 ${i.intake}/鏈?路 鎴愰暱 ${i.growth} 路 鍛ㄧ淮鎶?${formatMoney(i.upkeep)}`,
      nextEffect: (lv) => {
        const n = YOUTH_LEVELS[lv];
        return n ? `鈫?${n.name} 路 瀹归噺 ${n.capacity} 路 鎷涚敓 ${n.intake}` : "";
      },
    },
  ];

  const costs = {
    stadium: { 2: 3e6, 3: 8e6, 4: 18e6, 5: 40e6 },
    training: { 2: 1.5e6, 3: 4e6, 4: 10e6, 5: 22e6 },
    youth: YOUTH_UPGRADE_COST,
  };
  const buildDays = {
    stadium: { 2: 14, 3: 21, 4: 28, 5: 35 },
    training: { 2: 10, 3: 14, 4: 21, 5: 28 },
    youth: { 2: 12, 3: 18, 4: 24, 5: 30 },
  };

  grid.innerHTML = items
    .map(({ kind, icon, info, effect, nextEffect }) => {
      const lv = info.level;
      const proj = getProject(club, kind);
      const label = FACILITY_LABELS[kind] || kind;
      let action = "";
      if (proj) {
        const left = Math.max(0, proj.finishDay - world.day);
        action = `<button class="btn small" disabled>${t("fac.building", { n: left })}</button>
          <p class="hint" style="margin:0.4rem 0 0">鐩爣 Lv.${proj.to} ${escapeHtml(proj.name)}</p>`;
      } else if (lv >= FACILITY_MAX) {
        action = `<button class="btn small" disabled>${t("fac.maxed")}</button>`;
      } else {
        const next = lv + 1;
        const cost = costs[kind][next];
        const days = buildDays[kind][next];
        const verbKey =
          kind === "stadium" ? (next >= 4 ? "fac.buildNew" : "fac.expand") : "fac.upgrade";
        action = `<button class="btn small primary" data-upgrade-facility="${kind}">${t(verbKey, {
          lv: next,
          cost: formatMoney(cost),
          days,
        })}</button>
          <p class="hint" style="margin:0.4rem 0 0">${escapeHtml(nextEffect(next))}</p>`;
      }
      return `<div class="facility-card">
        <div class="facility-title">${icon} ${label}</div>
        <div class="facility-level">Lv.${lv} 路 ${escapeHtml(info.name)}</div>
        <p class="facility-effect">${escapeHtml(effect(info))}</p>
        ${action}
      </div>`;
    })
    .join("");

  const hint = $("#facilities-hint");
  if (hint) {
    hint.textContent =
      facilitySummaryLine(club) +
      " 路 涓诲満姣旇禌鑷姩鏀堕棬绁紱璁粌绛夌骇褰卞搷鏃ュ父璁粌涓庝激鐥呫€?;
  }
}

function renderYouth() {
  const club = getUserClub(world);
  ensureFacilities(club);
  const ya = ensureYouthAcademy(club);
  // 涓庤鏂藉悓姝?
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
    <div><strong>Lv.${ya.level}</strong> ${cfg.name}</div>
    <div class="muted">瀹归噺 ${ya.players.length}/${cfg.capacity} 路 姣忔湡鎷涚敓 ${cfg.intake} 浜?/div>
    <div class="muted">鍛ㄧ淮鎶よ垂 ${formatMoney(cfg.upkeep)} 路 涓嬫鎷涚敓绾?${daysLeft} 澶?/div>
    ${
      building
        ? `<div class="muted">馃毀 鍗囩骇鏂藉伐涓?路 绾︾ ${proj.finishDay} 澶╁畬宸?/div>`
        : ""
    }
  `;

  const upBtn = $("#btn-youth-upgrade");
  if (ya.level >= 5) {
    upBtn.disabled = true;
    upBtn.textContent = "宸叉弧绾?;
    $("#youth-hint").textContent = "瀛﹂櫌宸叉槸涓栫晫绾э紝涓撳績鍩瑰吇濂借嫍瀛愬惂銆備篃鍙湪銆岃鏂姐€嶉〉鏌ョ湅鐞冨満涓庤缁冦€?;
  } else if (building) {
    upBtn.disabled = true;
    const left = Math.max(0, proj.finishDay - world.day);
    upBtn.textContent = `鏂藉伐涓紙${left} 澶╋級`;
    $("#youth-hint").textContent = `姝ｅ湪鍗囩骇鑷?Lv.${proj.to} ${proj.name}锛屽畬宸ュ悗鑷姩鐢熸晥銆俙;
  } else {
    upBtn.disabled = false;
    upBtn.textContent = `鍗囩骇鑷?Lv.${nextLv}锛?{formatMoney(nextCost)} 路 鏈夊伐鏈燂級`;
    $("#youth-hint").textContent = `涓嬬骇锛?{YOUTH_LEVELS[nextLv].name} 路 瀹归噺 ${YOUTH_LEVELS[nextLv].capacity} 路 鎴愰暱鏇村揩锛堛€岃鏂姐€嶉〉鍙竴骞剁鐞嗙悆鍦?璁粌锛塦;
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
          const num = p.number != null ? p.number : "鈥?;
          return `<tr>
            <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(club)}">${num}</span></td>
            <td class="name-with-avatar">${playerAvatarHtml(p, club, 28)} <span>${playerLinkHtml(p.id, p.name)}</span></td>
            <td>${nationLabel(p)}</td>
            <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
            <td>${p.age}</td>
            <td class="${ovrClass(p.ovr)}"><strong>${p.ovr}</strong></td>
            <td class="${potClass}"><strong>${pot}</strong></td>
            <td>${formatMoney(p.wage)}</td>
            <td>
              <button class="btn small" data-player-link="${p.id}">璇︽儏</button>
              <button class="btn small primary" data-promote="${p.id}">鎻愭嫈</button>
              <button class="btn small danger" data-release="${p.id}">閲婃斁</button>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="9" class="muted">鏆傛棤闈掕鐞冨憳锛屾帹杩涙棩绋嬬瓑寰呮嫑鐢?/td></tr>`;

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
      if (!confirm("纭閲婃斁璇ラ潚璁悆鍛橈紵")) return;
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
  return `${n} 路 ${lab}`;
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
      ? `<strong>${form.name}</strong>${form.desc ? ` 路 ${form.desc}` : ""}`
      : `<strong>${form.name}</strong>${form.desc ? ` 路 ${form.desc}` : ""}`
  );
  bits.push(
    en
      ? `Attack bias ${atkBias >= 0 ? "+" : ""}${atkBias.toFixed(0)}% 路 Defend ${defBias >= 0 ? "+" : ""}${defBias.toFixed(0)}%`
      : `杩涙敾鍊惧悜 ${atkBias >= 0 ? "+" : ""}${atkBias.toFixed(0)}% 路 闃插畧 ${defBias >= 0 ? "+" : ""}${defBias.toFixed(0)}%`
  );
  bits.push(
    en
      ? `Possession weight 脳${(smod.possession || 1).toFixed(2)} 路 Fitness cost 脳${fitCost.toFixed(2)} 路 Foul risk 脳${foulRisk.toFixed(2)}`
      : `鎺х悆鏉冮噸 脳${(smod.possession || 1).toFixed(2)} 路 浣撹兘娑堣€?脳${fitCost.toFixed(2)} 路 鐘椋庨櫓 脳${foulRisk.toFixed(2)}`
  );
  if (tac.style === "counter") {
    bits.push(en ? "Counters attack & possession styles well." : "鍏嬪埗锛氭搮闀挎墦杩涙敾鍨?/ 鎺х悆鍨嬨€?);
  } else if (tac.style === "attack") {
    bits.push(en ? "Vulnerable to deep counters." : "娉ㄦ剰锛氬鏄撹浣庝綅鍙嶅嚮閽堝銆?);
  } else if (tac.style === "possession") {
    bits.push(en ? "Holds ball; less effective vs high press counters." : "鎺х悆涓诲锛涘楂樺帇鍙嶅嚮鐣ュ悆浜忋€?);
  } else if (tac.style === "defend") {
    bits.push(en ? "Solid block; fewer chances created." : "闃插畧绋冲浐锛屽垱閫犳満浼氬亸灏戙€?);
  }
  // 瑙掕壊鎸囦护鎽樿
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
      .map(([k, n]) => (n > 1 ? `${k}脳${n}` : k))
      .join(" 路 ");
    const rm = teamRoleMods(club);
    bits.push(
      en
        ? `Roles: ${top} 路 team bias ATK脳${rm.atk.toFixed(2)} DEF脳${rm.def.toFixed(2)}`
        : `瑙掕壊锛?{top} 路 鏁翠綋 鏀幻?{rm.atk.toFixed(2)} 闃裁?{rm.def.toFixed(2)}`
    );
  }
  el.innerHTML = bits.map((b) => `<div>${b}</div>`).join("");
}

/** 鎴樻湳鏉挎嫋鎷?/ 鐐归€夌姸鎬?*/
const tacPick = {
  mode: null, // 'slot' | 'bench'
  slot: null,
  playerId: null,
  dragging: false,
};

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
        pos: POS_LABEL[res.playerPos] || res.playerPos,
        slot: POS_LABEL[res.slotPos] || res.slotPos,
      })
    );
  }
  clearTacPick();
  saveGame(world);
  renderTactics();
  renderSquad();
}

function bindTacticsDragDrop() {
  const pitch = $("#pitch");
  const bench = $("#tac-bench");
  if (!pitch || pitch._tacBound) return;
  pitch._tacBound = true;

  // 闃绘鍚嶇墝閾炬帴鍦ㄦ嫋鎷芥椂鎵撳紑璧勬枡
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
    // 寤跺悗娓?dragging锛岄伩鍏?dragend 鍚庣珛鍒昏Е鍙?click 璇€?
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

  // 鐐瑰嚮锛氱偣閫変簰鎹?/ 鏇胯ˉ涓婂満锛堣Е灞忓弸濂斤級
  pitch.addEventListener("click", (e) => {
    if (tacPick.dragging) return;
    // 鐐瑰悕鐗岄摼鎺ヤ笖鏈湪鐐归€夋祦绋?鈫?鏀捐鎵撳紑璧勬枡
    if (e.target.closest("[data-player-link]") && !tacPick.mode) return;
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
    // 寮€濮嬬偣閫夛紙绌烘Ы涔熷彲琚崲涓婏級
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
      // 鑻ュ凡閫変腑棣栧彂妲?鈫?鐩存帴鎶婅鏇胯ˉ鎹笂
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
  renderTacPresets();
  const formSel = $("#formation-select");
  if (formSel) formSel.value = tac.formation;
  const styleSel = $("#style-select");
  if (styleSel) styleSel.value = tac.style;
  const setSlider = (id, valId, key, n) => {
    const el = $(id);
    if (el) el.value = n;
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
      ? `${fmeta.desc} 路 ${en ? "ATK" : "鏀?}脳${(fm.atk || 1).toFixed(2)} ${en ? "DEF" : "闃?}脳${(fm.def || 1).toFixed(2)} ${en ? "MID" : "涓満"}脳${(fm.midfield || 1).toFixed(2)}`
      : "";
  }

  if (!tac.lineup?.length) autoLineup(club);
  // 闃靛瀷妲戒綅鏁板彉鍖栨椂瀵归綈 lineup 闀垮害
  const formation = FORMATIONS[tac.formation] || FORMATIONS["4-3-3"];
  if ((tac.lineup || []).length !== formation.slots.length) {
    autoLineup(club);
  }
  ensureLineupRoles(club);
  const players = getLineupPlayers(club);
  const pitch = $("#pitch");
  if (!pitch) return;
  ensureKit(club);
  assignSquadNumbers(club);
  const kit = ensureKit(club);
  const kitBg = kitBackground(kit);
  const kitNc = kit.numberColor || "#fff";
  const en = getLang() === "en";
  pitch.innerHTML = formation.slots
    .map((slot, i) => {
      const p = players[i];
      const label = p ? playerDisplaySurname(p.name, p.nationality) : "?";
      const shirtNo = p && p.number != null ? p.number : null;
      const fallback = shirtNo != null ? shirtNo : p ? p.ovr : "-";
      const style = p
        ? `background:${kitBg};color:${kitNc};border-color:${kit.primary || "#fff"}`
        : "background:rgba(148,163,184,0.25);border-color:rgba(255,255,255,0.35)";
      const av = p ? playerAvatarHtml(p, club, 40) : "";
      const roleId = getSlotRole(club, i);
      const roleOpts = (ROLES_BY_POS[slot.pos] || []).map((rid) => {
        const r = PLAYER_ROLES[rid];
        const lab = en ? r?.labelEn : r?.label;
        return `<option value="${rid}"${rid === roleId ? " selected" : ""}>${escapeHtml(lab || rid)}</option>`;
      });
      const roleSel = `<select class="tac-role-sel" data-slot-role="${i}" title="${escapeHtml(
        en ? "Player role" : "瑙掕壊鎸囦护"
      )}" aria-label="${escapeHtml(en ? "Role" : "瑙掕壊")}">${roleOpts.join("")}</select>`;
      const full = p
        ? `${shirtNo != null ? `#${shirtNo} ` : ""}${p.name} 路 ${roleLabel(roleId, en ? "en" : "zh")}`
        : `${POS_LABEL[slot.pos] || slot.pos}`;
      const badge =
        shirtNo != null
          ? `<span class="pitch-num" style="background:${kitBg};color:${kitNc};border-color:${kit.primary || "#fff"}">${shirtNo}</span>`
          : `<span class="pitch-slot-pos">${escapeHtml(slot.pos)}</span>`;
      const nameText = shirtNo != null ? `#${shirtNo} ${label}` : label;
      // 鍚嶇墝锛氳祫鏂欓摼鎺ワ紱鎷栨嫿鍙ユ焺鍦ㄦ暣涓?slot
      const nameHtml = p
        ? `<button type="button" class="player-link pitch-player-link" data-player-link="${escapeHtml(p.id)}">${escapeHtml(nameText)}</button>`
        : `<span class="pitch-empty">${escapeHtml(POS_LABEL[slot.pos] || slot.pos)}</span>`;
      const oop = p && p.pos !== slot.pos ? " out-of-pos" : "";
      const empty = !p ? " empty" : "";
      return `<div class="player-dot tac-slot${p ? " clickable-player" : ""}${oop}${empty}"
        style="left:${slot.x}%;top:${slot.y}%"
        title="${escapeHtml(full)}"
        draggable="${p ? "true" : "false"}"
        data-slot="${i}"
        data-slot-pos="${escapeHtml(slot.pos)}"
        ${p ? `data-player-id="${escapeHtml(p.id)}"` : ""}>
        <div class="circle kit-dot" style="${style}">${av || fallback}${badge}</div>
        <div class="name">${nameHtml}</div>
        ${roleSel}
      </div>`;
    })
    .join("");

  // 鏇胯ˉ甯?
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
              (p.injured || 0) > 0 || (p.suspendedMatches || 0) > 0;
            const num = p.number != null ? `#${p.number}` : "";
            const av = playerAvatarHtml(p, club, 40);
            const fit = Math.round(p.fitness ?? 100);
            const status =
              (p.injured || 0) > 0
                ? `<em class="tac-chip-bad">${getLang() === "en" ? "INJ" : "浼?}</em>`
                : (p.suspendedMatches || 0) > 0
                  ? `<em class="tac-chip-bad">${getLang() === "en" ? "SUS" : "鍋?}</em>`
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
                <span><i class="badge ${p.pos}">${POS_LABEL[p.pos] || p.pos}</i> ${status}</span>
              </div>
              <button type="button" class="btn small ghost tac-chip-info" data-player-link="${escapeHtml(p.id)}" title="${escapeHtml(getLang() === "en" ? "Profile" : "璧勬枡")}">鈩?/button>
            </div>`;
          })
          .join("")
      : `<p class="muted" style="margin:0.25rem 0">${escapeHtml(t("tac.benchEmpty"))}</p>`;
  }

  bindTacticsDragDrop();
  bindTacticsRoleSelects();
  applyTacPickHighlight();
  renderTacticsSummary();
}

/** 妲戒綅瑙掕壊涓嬫媺锛堟瘡娆?render 鍚庨噸缁戯級 */
function bindTacticsRoleSelects() {
  const pitch = $("#pitch");
  if (!pitch) return;
  pitch.querySelectorAll("[data-slot-role]").forEach((sel) => {
    sel.addEventListener("mousedown", (e) => e.stopPropagation());
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", (e) => {
      e.stopPropagation();
      if (!world) return;
      const club = getUserClub(world);
      const slot = +sel.getAttribute("data-slot-role");
      const res = setSlotRole(club, slot, sel.value);
      if (!res.ok) {
        toast(res.msg || t("tac.roleFail"));
        return;
      }
      saveGame(world);
      renderTacticsSummary();
      toast(
        t("tac.roleSet", {
          role: roleLabel(sel.value, getLang() === "en" ? "en" : "zh"),
        })
      );
    });
  });
}

function closeModal() {
  $("#modal")?.classList.add("hidden");
  $("#modal-card")?.classList.remove("wide");
}

function clubLinkHtml(clubId, label, extraClass = "") {
  const name = label ?? world.clubs.find((c) => c.id === clubId)?.name ?? clubId;
  return `<button type="button" class="club-link ${extraClass}" data-club-link="${escapeHtml(clubId)}">${escapeHtml(name)}</button>`;
}

/** 鍙偣鍑荤悆鍛樺悕 鈫?showPlayerModal锛堝叏灞€ data-player-link 濮旀墭锛?*/
function playerLinkHtml(playerId, label, extraClass = "") {
  if (!playerId) return escapeHtml(label ?? "鈥?);
  return `<button type="button" class="player-link ${extraClass}" data-player-link="${escapeHtml(playerId)}">${escapeHtml(label ?? "?")}</button>`;
}

function formatFormHtml(form) {
  const list = (form || []).slice(-5);
  if (!list.length) return `<span class="muted">鈥?/span>`;
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

function renderClubs() {
  if (!world) return;
  const tbody = $("#clubs-table tbody");
  if (!tbody) return;
  const sel = $("#clubs-division");
  const searchEl = $("#clubs-search");
  if (sel && !sel.dataset.touched) {
    const me = getUserClub(world);
    if (me) sel.value = String(me.division || 3);
  }
  const divFilter = sel?.value || "all";
  const q = (searchEl?.value || "").trim().toLowerCase();

  // 鍚勭骇绉垎姒滄帓鍚嶇紦瀛?
  const rankMap = new Map();
  for (const d of [1, 2, 3]) {
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
        c.name.toLowerCase().includes(q) ||
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
          const avg = squadAvgOvr(c);
          ensureKit(c);
          return `<tr class="${me ? "me" : ""}">
            <td>
              <span class="kit-chip" style="${kitBadgeStyle(c)}"></span>
              ${clubLinkHtml(c.id, c.name)}${me ? " 鈽? : ""}
            </td>
            <td>${escapeHtml(divName)}</td>
            <td>${info ? info.rank : "鈥?}</td>
            <td><strong>${info ? info.pts : 0}</strong></td>
            <td>${formatFormHtml(c.form)}</td>
            <td class="${ovrClass(avg)}">${avg}</td>
            <td>${formatMoney(c.money || 0)}</td>
            <td><button type="button" class="btn small" data-open-club="${escapeHtml(c.id)}">${escapeHtml(t("clubs.view"))}</button></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="muted">${escapeHtml(t("clubs.empty"))}</td></tr>`;
}

function showClubModal(clubId) {
  if (!world || !clubId) return;
  const club = world.clubs.find((c) => c.id === clubId);
  if (!club) return;

  ensureKit(club);
  ensureClubHonors(club);
  const me = club.id === world.userClubId;
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
  const avg = squadAvgOvr(club);
  const topPlayers = [...(club.players || [])]
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 16);
  const formation = club.tactics?.formation || "4-3-3";
  const styleKey = club.tactics?.style || "balanced";
  const styleLabel = t("style." + styleKey) || styleKey;

  const fixtures = (world.fixtures || [])
    .filter((f) => f.home === club.id || f.away === club.id)
    .slice()
    .sort((a, b) => a.day - b.day);
  // 杩戞湡宸茶禌 + 鎺ヤ笅鏉ユ湭璧?
  const playedFx = fixtures.filter((f) => f.played).slice(-5).reverse();
  const upcomingFx = fixtures.filter((f) => !f.played).slice(0, 6);

  const honorHtml = (club.honors || []).length
    ? `<div class="honor-list">${club.honors
        .slice(0, 8)
        .map(
          (h) => `<div class="honor-item">
            <div class="season">${h.season}</div>
            <strong>${escapeHtml(h.title || "")}</strong>
            ${h.detail ? ` <span class="muted">锛?{escapeHtml(h.detail)}锛?/span>` : ""}
          </div>`
        )
        .join("")}</div>`
    : `<p class="muted" style="margin:0">${escapeHtml(t("clubs.noHonors"))}</p>`;

  const squadRows = topPlayers
    .map((p) => {
      const s = playerStats(p);
      const isGk = p.pos === "GK";
      return `<tr>
        <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(club)}">${p.number ?? "鈥?}</span></td>
        <td class="name-with-avatar">${playerAvatarHtml(p, club, 26)}
          ${playerLinkHtml(p.id, p.name)}
        </td>
        <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
        <td>${p.age}</td>
        <td class="${ovrClass(p.ovr)}"><strong>${p.ovr}</strong></td>
        <td>${isGk ? s.cleanSheets : s.goals}</td>
        <td>${isGk ? s.goalsConceded : s.assists}</td>
      </tr>`;
    })
    .join("");

  const fxRow = (f) => {
    const home = world.clubs.find((c) => c.id === f.home);
    const away = world.clubs.find((c) => c.id === f.away);
    const score = f.played ? `${f.homeGoals} - ${f.awayGoals}` : "鈥?;
    const homeCls = f.home === club.id ? "me-side" : "";
    const awayCls = f.away === club.id ? "me-side" : "";
    return `<tr>
      <td>D${f.day}</td>
      <td class="${homeCls}">${escapeHtml(home?.short || home?.name || "?")}</td>
      <td>${score}</td>
      <td class="${awayCls}">${escapeHtml(away?.short || away?.name || "?")}</td>
      <td>${f.competition === "cup" ? escapeHtml(f.roundLabel || t("match.cup")) : `R${f.round || ""}`}</td>
    </tr>`;
  };

  $("#modal-body").innerHTML = `
    <div class="club-modal-head">
      <span class="kit-chip large" style="${kitBadgeStyle(club)}"></span>
      ${renderKitShirt(club, null, 52)}
      <div>
        <h2 style="margin:0 0 0.25rem">${escapeHtml(club.name)}${me ? " 鈽? : ""}</h2>
        <p class="muted" style="margin:0">
          ${escapeHtml(divName)}
          ${rank ? ` 路 ${t("clubs.rank", { n: rank })}` : ""}
          路 ${t("clubs.pts", { n: row.pts || 0 })}
          路 ${escapeHtml(t("clubs.record", { w: row.w || 0, d: row.d || 0, l: row.l || 0 }))}
        </p>
        <p class="muted" style="margin:0.25rem 0 0">
          ${escapeHtml(t("clubs.money"))} ${formatMoney(club.money || 0)}
          路 ${escapeHtml(t("clubs.squadAvg"))} <strong class="${ovrClass(avg)}">${avg}</strong>
          路 ${escapeHtml(t("clubs.power"))} ${club.power ?? "鈥?}
          路 ${escapeHtml(t("tac.formation"))} ${escapeHtml(formation)} 路 ${escapeHtml(styleLabel)}
        </p>
        <div style="margin-top:0.4rem">${formatFormHtml(club.form)} <span class="muted" style="font-size:0.8rem">${escapeHtml(t("clubs.formHint"))}</span></div>
      </div>
    </div>

    <div class="club-modal-grid">
      <div>
        <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">${escapeHtml(t("clubs.squad"))}</h3>
        <p class="hint" style="margin:0 0 0.4rem">${escapeHtml(t("clubs.squadHint", { n: (club.players || []).length }))}</p>
        <div class="table-wrap">
          <table class="compact-table">
            <thead>
              <tr>
                <th>#</th><th>${escapeHtml(t("th.name"))}</th><th>${escapeHtml(t("th.pos"))}</th>
                <th>${escapeHtml(t("th.age"))}</th><th>${escapeHtml(t("th.ovr"))}</th>
                <th>${escapeHtml(t("th.goals"))}</th><th>${escapeHtml(t("th.assists"))}</th>
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
        <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">${escapeHtml(t("clubs.upcoming"))}</h3>
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
        <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">${escapeHtml(t("clubs.recent"))}</h3>
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
        <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">${escapeHtml(t("clubs.honors"))}</h3>
        ${honorHtml}
      </div>
    </div>
  `;

  $("#modal-card")?.classList.add("wide");
  $("#modal").classList.remove("hidden");
}

function renderTable() {
  const club = getUserClub(world);
  const sel = $("#table-division");
  // 榛樿鏄剧ず鑷繁鎵€鍦ㄨ仈璧?
  if (sel && !sel.dataset.touched) {
    sel.value = String(club.division || 3);
  }
  if (sel && !sel._bound) {
    sel._bound = true;
    sel.addEventListener("change", () => {
      sel.dataset.touched = "1";
      renderTable();
    });
  }
  const div = Number(sel?.value || club.division || 3);
  const info = DIVISIONS[div] || DIVISIONS[3];
  const table = getSortedTable(world, div);
  const n = table.length;

  $("#table-title").textContent = t("table.titleNamed", { name: t("div." + div) || info.name });
  let hint = "";
  if (div === 1) hint = `20 鏀悆闃?路 鍚?${info.relegate} 鍚嶉檷鍏ョ敳绾ц仈璧沗;
  else if (div === 2) hint = `20 鏀悆闃?路 鍓?${info.promote} 鍚嶅崌瓒呯骇鑱旇禌 路 鍚?${info.relegate} 鍚嶉檷涔欑骇鑱旇禌`;
  else hint = `20 鏀悆闃?路 鍓?${info.promote} 鍚嶅崌鐢茬骇鑱旇禌`;
  $("#table-hint").textContent = hint;

  const tbody = $("#league-table tbody");
  const upN = info.promote || 0;
  const downN = info.relegate || 0;
  tbody.innerHTML = table.length
    ? table
        .map((r, i) => {
          const me = r.id === world.userClubId;
          const rank = i + 1;
          let zone = "";
          if (upN && rank <= upN) zone = ' <span class="badge MID">鍗囩骇鍖?/span>';
          if (downN && rank > n - downN) zone = ' <span class="badge ATT">闄嶇骇鍖?/span>';
          return `<tr class="${me ? "me" : ""}">
            <td>${rank}</td>
            <td>${clubLinkHtml(r.id, r.name)}${me ? " 鈽? : ""}${zone}</td>
            <td>${r.played}</td>
            <td>${r.w}</td>
            <td>${r.d}</td>
            <td>${r.l}</td>
            <td>${r.gf}</td>
            <td>${r.ga}</td>
            <td>${r.gd > 0 ? "+" : ""}${r.gd}</td>
            <td><strong>${r.pts}</strong></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="10" class="muted">璇ョ骇鍒殏鏃犵悆闃燂紙璇峰紑鏂版。浣撻獙瀹屾暣涓夌骇鑱旇禌锛?/td></tr>`;
}

function renderStats() {
  const { goals, assists, keepers, ratings } = getStatLeaders(world);
  const uid = world.userClubId;

  const goalsBody = $("#stats-goals tbody");
  goalsBody.innerHTML = goals.length
    ? goals
        .map(({ player: p, club }, i) => {
          const s = playerStats(p);
          const avgR = seasonAvgRating(p);
          const me = club.id === uid;
          return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${playerLinkHtml(p.id, p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            <td><strong>${s.goals}</strong></td>
            <td>${s.assists}</td>
            <td>${s.apps}</td>
            <td class="rating-cell ${ratingClass(avgR)}">${formatRating(avgR)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">鏆傛棤杩涚悆鏁版嵁锛岃涪瀹屾瘮璧涘悗鏇存柊</td></tr>`;

  const assistsBody = $("#stats-assists tbody");
  assistsBody.innerHTML = assists.length
    ? assists
        .map(({ player: p, club }, i) => {
          const s = playerStats(p);
          const avgR = seasonAvgRating(p);
          const me = club.id === uid;
          return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${playerLinkHtml(p.id, p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            <td><strong>${s.assists}</strong></td>
            <td>${s.goals}</td>
            <td>${s.apps}</td>
            <td class="rating-cell ${ratingClass(avgR)}">${formatRating(avgR)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">鏆傛棤鍔╂敾鏁版嵁锛岃涪瀹屾瘮璧涘悗鏇存柊</td></tr>`;

  const ratingsBody = $("#stats-ratings tbody");
  if (ratingsBody) {
    ratingsBody.innerHTML = ratings?.length
      ? ratings
          .map(({ player: p, club, avgRating, lastRating, apps }, i) => {
            const me = club.id === uid;
            return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${playerLinkHtml(p.id, p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            <td class="rating-cell ${ratingClass(avgRating)}"><strong>${formatRating(avgRating)}</strong></td>
            <td class="rating-cell ${ratingClass(lastRating)}">${formatRating(lastRating)}</td>
            <td>${apps}</td>
          </tr>`;
          })
          .join("")
      : `<tr><td colspan="6" class="muted">鑷冲皯 3 鍦哄嚭鍦哄悗鏄剧ず璇勫垎姒?/td></tr>`;
  }

  const keepersBody = $("#stats-keepers tbody");
  keepersBody.innerHTML = keepers.length
    ? keepers
        .map(({ player: p, club, gaPerGame }, i) => {
          const s = playerStats(p);
          const avgR = seasonAvgRating(p);
          const me = club.id === uid;
          return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${playerLinkHtml(p.id, p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            <td>${s.apps}</td>
            <td><strong>${s.cleanSheets}</strong></td>
            <td>${s.goalsConceded}</td>
            <td>${gaPerGame.toFixed(2)}</td>
            <td class="rating-cell ${ratingClass(avgR)}">${formatRating(avgR)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="muted">鏆傛棤闂ㄥ皢鏁版嵁锛岃涪瀹屾瘮璧涘悗鏇存柊</td></tr>`;
}

function openBuyNegotiator(playerId, fromClubId) {
  const deal = previewBuyDeal(world, playerId, fromClubId, 3, 1.1);
  if (!deal) {
    toast("鏃犳硶棰勮璇ヤ氦鏄?);
    return;
  }
  const years = prompt(
    `${deal.player.name}\n鐞冩帰浼板€肩害 ${formatMoney(deal.price)}\n鍚堝悓骞撮檺锛?鈥?锛岄粯璁?3锛夛細`,
    "3"
  );
  if (years == null) return;
  const y = Math.max(1, Math.min(5, parseInt(years, 10) || 3));
  const wageIn = prompt(
    `鍛ㄨ柂鍊嶇巼锛?.95鈥?.4锛岄粯璁?1.1锛涜繃浣庡彲鑳借鎷掞級锛歕n棰勪及鍛ㄨ柂绾?${formatMoney(deal.newWage)}`,
    "1.1"
  );
  if (wageIn == null) return;
  const wm = Math.max(0.9, Math.min(1.5, parseFloat(wageIn) || 1.1));
  const finalDeal = previewBuyDeal(world, playerId, fromClubId, y, wm);
  if (
    !confirm(
      `纭绛句笅 ${finalDeal.player.name}锛焅n杞細璐?${formatMoney(finalDeal.price)}\n绛剧害濂?${formatMoney(finalDeal.signingBonus)}\n${y} 骞?路 鍛ㄨ柂 ${formatMoney(finalDeal.newWage)}\n鍚堣绾?${formatMoney(finalDeal.total)}`
    )
  ) {
    return;
  }
  const res = buyPlayer(world, playerId, fromClubId, { years: y, wageMult: wm });
  toast(res.msg);
  if (res.ok) {
    saveGame(world);
    refreshAll();
  }
}

function renderTransfer() {
  ensureTransferWindow(world);
  const open = isTransferWindowOpen(world);
  const statusEl = $("#transfer-window-status");
  if (statusEl) {
    statusEl.textContent = transferWindowLabel(world);
    statusEl.className = open ? "transfer-window-box open" : "transfer-window-box closed";
  }

  // 鐞冩帰鍏虫敞鍒楄〃锛堟潵鑷俊绠便€屽姞鍏ュ叧娉ㄣ€嶏級
  const watchEl = $("#scout-watch-list");
  if (watchEl) {
    const en = getLang() === "en";
    const ids = world.scoutWatch || [];
    if (!ids.length) {
      watchEl.innerHTML = `<p class="muted" style="margin:0">${escapeHtml(
        en ? "No watched players 鈥?add from Inbox scout tips." : "鏆傛棤鍏虫敞鐩爣锛堜俊绠辩悆鎺㈤偖浠跺彲娣诲姞锛?
      )}</p>`;
    } else {
      const rows = [];
      for (const id of ids.slice(0, 12)) {
        for (const c of world.clubs) {
          const p = c.players.find((x) => x.id === id);
          if (p) {
            rows.push(
              `<div class="scout-watch-row">${playerAvatarHtml(p, c, 26)} ${playerLinkHtml(p.id, p.name)}
                <span class="badge ${p.pos}">${POS_LABEL[p.pos] || p.pos}</span>
                <span class="muted">${escapeHtml(c.short || c.name)} 路 ${formatScoutOvr(world, p)} 路 ${formatScoutValue(world, p)}</span>
              </div>`
            );
            break;
          }
        }
      }
      watchEl.innerHTML = rows.join("") || `<p class="muted" style="margin:0">${en ? "Watched players left clubs." : "鍏虫敞瀵硅薄宸茬闃?}</p>`;
    }
  }

  renderContractsLoansPanel();

  // 鎸栬鎶ヤ环
  const poachEl = $("#poach-bids");
  if (poachEl) {
    const bids = pendingPoachBids(world);
    if (!bids.length) {
      poachEl.innerHTML = `<p class="muted" style="margin:0">鏆傛棤鏉ヨ嚜鍏朵粬淇变箰閮ㄧ殑鎶ヤ环</p>`;
    } else {
      poachEl.innerHTML = bids
        .map(
          (b) => `<div class="poach-row">
          <div>
            <strong>${escapeHtml(b.buyerName)}</strong> 鎶ヤ环
            <strong>${formatMoney(b.fee)}</strong> 姹傝喘
            <strong>${playerLinkHtml(b.playerId, b.playerName)}</strong>
            <span class="muted">锛?{b.pos} 路 ${b.ovr} 路 鍓?${Math.max(0, b.expiresDay - world.day)} 澶╋級</span>
          </div>
          <div class="poach-actions">
            <button class="btn small primary" data-poach-accept="${b.id}" ${!open ? "disabled" : ""}>鎺ュ彈</button>
            <button class="btn small" data-poach-reject="${b.id}">鎷掔粷</button>
          </div>
        </div>`
        )
        .join("");
      poachEl.querySelectorAll("[data-poach-accept]").forEach((btn) => {
        btn.onclick = () => {
          if (!confirm("纭鎺ュ彈鎶ヤ环骞舵斁璧扮悆鍛橈紵")) return;
          const res = acceptPoachBid(world, btn.dataset.poachAccept);
          toast(res.msg);
          if (res.ok) {
            saveGame(world);
            refreshAll();
          }
        };
      });
      poachEl.querySelectorAll("[data-poach-reject]").forEach((btn) => {
        btn.onclick = () => {
          const res = rejectPoachBid(world, btn.dataset.poachReject);
          toast(res.msg);
          if (res.ok) {
            saveGame(world);
            refreshAll();
          }
        };
      });
    }
  }

  const pos = $("#filter-pos").value;
  const market = getMarketPlayers(world, pos);
  const mt = $("#market-table tbody");
  const userClub = getUserClub(world);
  ensureStaff(userClub);
  const buyDisabled = !open || world.sacked;
  const en = getLang() === "en";
  mt.innerHTML = market
    .map(({ player: p, club }) => {
      const valTxt = formatScoutValue(world, p);
      const ovrTxt = formatScoutOvr(world, p);
      const loanable = !p.loan && !buyDisabled;
      return `<tr>
        <td class="name-with-avatar">${playerAvatarHtml(p, club, 28)} <span>${playerLinkHtml(p.id, p.name)}</span></td>
        <td>${nationLabel(p)}</td>
        <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
        <td class="${ovrClass(p.ovr)}">${ovrTxt}</td>
        <td>${p.age}</td>
        <td>${clubLinkHtml(club.id, club.short)}</td>
        <td title="鐪熷疄韬环浠呬綔鍙傝€冨尯闂?>${valTxt}</td>
        <td class="tr-actions">
          <button class="btn small" data-player-link="${p.id}">${en ? "Info" : "璇︽儏"}</button>
          <button class="btn small primary" data-buy="${p.id}" data-from="${club.id}" ${
            buyDisabled ? "disabled" : ""
          }>${open ? (en ? "Buy" : "璋堝垽涔板叆") : en ? "Closed" : "绐楀叧"}</button>
          <button class="btn small" data-loan-in="${p.id}" data-from="${club.id}" ${
            loanable ? "" : "disabled"
          }>${open ? (en ? "Loan" : "绉熷叆") : en ? "Closed" : "绐楀叧"}</button>
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
      return `<tr>
      <td class="name-with-avatar">${playerAvatarHtml(p, club, 28)} <span>${playerLinkHtml(p.id, p.name)}${onLoan ? ` <span class="badge loan">${en ? "loan" : "绉?}</span>` : ""}</span></td>
      <td>${nationLabel(p)}</td>
      <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
      <td class="${ovrClass(p.ovr)}">${p.ovr}</td>
      <td>${formatMoney(p.value)}</td>
      <td class="tr-actions">
        <button class="btn small" data-player-link="${p.id}">${en ? "Info" : "璇︽儏"}</button>
        <button class="btn small danger" data-sell="${p.id}" ${
          buyDisabled || onLoan ? "disabled" : ""
        }>${onLoan ? (en ? "On loan" : "绉熷€熶腑") : open ? (en ? "Sell" : "鍑哄敭") : en ? "Closed" : "绐楀叧"}</button>
        <button class="btn small" data-loan-out="${p.id}" ${
          buyDisabled || onLoan ? "disabled" : ""
        }>${open && !onLoan ? (en ? "Loan out" : "澶栫") : en ? "鈥? : "鈥?}</button>
      </td>
    </tr>`;
    })
    .join("");

  st.querySelectorAll("[data-sell]").forEach((b) => {
    b.onclick = () => {
      if (!confirm(en ? "Sell this player?" : "纭鍑哄敭璇ョ悆鍛橈紵")) return;
      const res = sellPlayer(world, b.dataset.sell);
      toast(res.msg);
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

/** 杞細椤碉細鍚堝悓寰呭姙 + 澶栫/绉熷叆鍒楄〃 */
function renderContractsLoansPanel() {
  const box = $("#contracts-loans-panel");
  if (!box || !world) return;
  const club = getUserClub(world);
  if (!club) {
    box.innerHTML = "";
    return;
  }
  const en = getLang() === "en";
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
              : "寰呯画绾?
            : en
              ? "Expiring"
              : "灏嗗敖";
          return `<div class="cl-row">
            <div class="cl-main">
              <strong>${playerLinkHtml(p.id, p.name)}</strong>
              <span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span>
              <span class="muted">${p.ovr} 路 ${p.contractYears ?? 0}${en ? "y" : "骞?} 路 ${formatMoney(p.wage)}</span>
              <span class="badge contract-short">${escapeHtml(tag)}</span>
            </div>
            <div class="cl-actions">
              <button type="button" class="btn small primary" data-cl-renew="${p.id}">${escapeHtml(t("contract.renew") || (en ? "Renew" : "缁害"))}</button>
              <button type="button" class="btn small danger" data-cl-term="${p.id}">${escapeHtml(t("contract.terminate") || (en ? "Release" : "瑙ｇ害"))}</button>
            </div>
            ${
              offer
                ? `<div class="cl-offer muted">${en ? "Offer" : "鎶ヤ环"}: ${offer.years}${en ? "y" : "骞?} 路 ${formatMoney(offer.newWage)} 路 ${en ? "bonus" : "濂?} ${formatMoney(offer.fee)}</div>`
                : ""
            }
          </div>`;
        })
        .join("")
    : `<p class="muted" style="margin:0">${en ? "No short contracts needing attention." : "鏆傛棤鐭害/寰呯画绾︾悆鍛樸€?}</p>`;

  const outRows = out.length
    ? out
        .map(
          (l) => `<div class="cl-row">
          <div class="cl-main">
            <strong>${playerLinkHtml(l.playerId, l.playerName)}</strong>
            <span class="muted">鈫?${escapeHtml(l.toName)} 路 ${escapeHtml(l.untilLabel)}</span>
          </div>
          <div class="cl-actions">
            <button type="button" class="btn small" data-cl-recall="${l.playerId}">${escapeHtml(t("contract.recall") || (en ? "Recall" : "鍙洖"))}</button>
          </div>
        </div>`
        )
        .join("")
    : `<p class="muted" style="margin:0">${en ? "No players out on loan." : "鏆傛棤澶栫鐞冨憳銆?}</p>`;

  const inRows = inn.length
    ? inn
        .map(
          (l) => `<div class="cl-row">
          <div class="cl-main">
            <strong>${playerLinkHtml(l.playerId, l.playerName)}</strong>
            <span class="muted">${en ? "from" : "鏉ヨ嚜"} ${escapeHtml(l.fromName)} 路 ${escapeHtml(l.untilLabel)}</span>
          </div>
        </div>`
        )
        .join("")
    : `<p class="muted" style="margin:0">${en ? "No incoming loans." : "鏆傛棤绉熷叆鐞冨憳銆?}</p>`;

  box.innerHTML = `
    <div class="cl-section">
      <h3>${escapeHtml(t("contract.attention") || (en ? "Contracts needing attention" : "鍚堝悓寰呭姙"))}</h3>
      ${renewRows}
    </div>
    <div class="cl-section grid-2-loans">
      <div>
        <h3>${escapeHtml(t("contract.loansOut") || (en ? "Loaned out" : "澶栫涓?))}</h3>
        ${outRows}
      </div>
      <div>
        <h3>${escapeHtml(t("contract.loansIn") || (en ? "Loaned in" : "绉熷叆涓?))}</h3>
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
}

/** 璧涚▼鍞竴閿紙鏃?id 鏃剁敤锛?*/
function fixtureKey(f) {
  if (!f) return "";
  return `${f.home}|${f.away}|${f.day}|${f.round ?? ""}|${f.roundLabel || ""}`;
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
      else if (f.day === world.day) status = en ? "Today" : "浠婃棩";
      else if (f.day < world.day) status = en ? "Due" : "寰呰涪";
      // 宸茶禌涓旀湁鎶ュ憡 鈫?鍙洖鐪?
      let action = status;
      if (f.played && f.matchReport) {
        action = `<button type="button" class="btn tiny fix-report-btn" data-fixture-key="${escapeHtml(fixtureKey(f))}" title="${escapeHtml(t("fix.viewReport") || "鎴樻姤")}">${escapeHtml(t("fix.viewReport") || (en ? "Report" : "鎴樻姤"))}</button>`;
      } else if (f.played && f.events?.length) {
        // 鏃ф。鏃犲畬鏁?report锛氬敖閲忕敤浜嬩欢鎷肩畝鏄撴姤鍛婂叆鍙?
        action = `<button type="button" class="btn tiny fix-report-btn" data-fixture-key="${escapeHtml(fixtureKey(f))}" title="${escapeHtml(t("fix.viewReport") || "鎴樻姤")}">${escapeHtml(t("fix.viewReport") || (en ? "Report" : "鎴樻姤"))}</button>`;
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
 * 浠庤禌绋嬫墦寮€鏃ф垬鎶ワ紙鍙鍥為【锛屼笉閲嶆柊妯℃嫙锛?
 */
function openPastMatchReport(key) {
  const fixture = findFixtureByKey(key);
  if (!fixture || !fixture.played) {
    toast(getLang() === "en" ? "No match report" : "鏆傛棤鎴樻姤");
    return;
  }
  // 鏃ф。鍙兘鍙湁 events 鏃犳瘮鍒嗘姤鍛?
  let report = fixture.matchReport;
  if (!report) {
    report = buildLegacyReportFromFixture(fixture);
  }
  if (!report) {
    toast(getLang() === "en" ? "Report not saved for this match" : "鏈満鏈繚瀛樺畬鏁存垬鎶ワ紙鏃у瓨妗ｏ級");
    return;
  }

  pendingMatch = fixture;
  matchState = null;
  pendingSubs = [];
  matchPlayback.reviewMode = true;

  const home = world.clubs.find((c) => c.id === fixture.home);
  const away = world.clubs.find((c) => c.id === fixture.away);
  setupMatchScoreboard(home, away, fixture);
  setMatchScore(fixture.homeGoals ?? report.homeGoals ?? 0, fixture.awayGoals ?? report.awayGoals ?? 0);
  setMatchMinute(90);
  setMatchLiveState("ft");
  updateLiveStats(report);
  setMatchStatsPanelOpen(true);
  $("#match-log").innerHTML = "";
  resetMatchPlayback({ keepStepMode: true });
  matchPlayback.reviewMode = true;

  // 浠?events 閲嶅缓杩涚悆鍥炵湅鍒楄〃
  rebuildGoalReplaysFromFixture(fixture);
  // 浜嬩欢娴佹憳瑕?
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
  ensureMatchPitch(true);
  if (matchView) {
    matchView.phase = "pause";
    matchView.setBanner(getLang() === "en" ? "FULL-TIME" : "瀹屽満鍥為【", "info");
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
    t("match.backToClub") || (getLang() === "en" ? "Back" : "杩斿洖淇变箰閮?);
  matchPlayback.controlsEnabled = false;
  updateMatchPlaybackUI();
  showScreen("match");
  toast(getLang() === "en" ? "Match report" : "璧涘悗鎴樻姤");
}

/** 鏃ф。鏃?matchReport 鏃朵粠 events 鎷肩畝鏄撴姤鍛?*/
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
        : `鏈満鍏?${scorers.length} 绮掕繘鐞冦€俙
    );
  }
  narrative.push(
    getLang() === "en"
      ? "Detailed xG/ratings unavailable for older saves."
      : "鏃у瓨妗ｆ湭淇濆瓨瀹屾暣 xG/璇勫垎锛屼粎鏄剧ず姣斿垎涓庝簨浠躲€?
  );
  return {
    score: `${f.homeGoals ?? 0} - ${f.awayGoals ?? 0}`,
    homeGoals: f.homeGoals ?? 0,
    awayGoals: f.awayGoals ?? 0,
    weather: f.weather ? { key: f.weather, name: f.weather, icon: "鈿? } : null,
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
function onAdvance() {
  if (world.sacked) {
    handleSacked({ sacked: true, msg: world.sackedReason || "浣犲凡琚В闆? });
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
  const res = advanceDay(world);
  if (handleSacked(res)) return;
  const { userMatches } = res;
  if (userMatches && userMatches.length) {
    pendingMatch = userMatches[0];
    const label = pendingMatch.roundLabel || `绗?${pendingMatch.round} 杞甡;
    toast(`${label} 路 姣旇禌鏃ュ埌浜嗭紒`);
  } else if (world.seasonOver) {
    toast(t("toast.seasonEndNews"));
    if (world.sacked) handleSacked({ sacked: true, msg: world.sackedReason });
  } else {
    const n = pendingInboxCount(world);
    if (n > 0) {
      const urgent = listInbox(world, { pendingOnly: true, limit: 8 }).filter((m) => (m.priority || 1) >= 3);
      if (urgent.length) {
        toast(
          getLang() === "en"
            ? `Inbox: ${n} pending (${urgent.length} urgent)`
            : `淇＄鏈?${n} 灏佸緟鍔烇紙鍚?${urgent.length} 灏佺揣鎬ワ級`
        );
      }
    }
  }
  autosave("advance");
  refreshAll();
}

function onAdvanceToMatchday() {
  if (world.sacked) {
    handleSacked({ sacked: true, msg: world.sackedReason || "浣犲凡琚В闆? });
    return;
  }
  if (world.seasonOver || (world.fixtures.length && world.fixtures.every((f) => f.played))) {
    toast(t("toast.seasonOver"));
    return;
  }
  const res = advanceToNextMatchDay(world);
  if (world.sacked || res.sacked) {
    handleSacked(res.sackedResult || { sacked: true, msg: world.sackedReason });
    return;
  }
  if (!res.ok && !res.days) {
    toast(res.msg || "鏃犳硶鎺ㄨ繘");
    return;
  }
  if (res.userMatches && res.userMatches.length) {
    pendingMatch = res.userMatches[0];
    const label = pendingMatch.roundLabel || `绗?${pendingMatch.round} 杞甡;
    toast(`鎺ㄨ繘 ${res.days} 澶?路 ${label}`);
  } else if (world.seasonOver) {
    toast(`鎺ㄨ繘 ${res.days} 澶?路 璧涘缁撴潫`);
    if (world.sacked) handleSacked({ sacked: true, msg: world.sackedReason });
  } else {
    toast(res.msg || `鎺ㄨ繘 ${res.days} 澶ー);
  }
  autosave("advance-matchday");
  refreshAll();
}

/** 鎺ㄨ繘鍒拌禌瀛ｆ湯锛氶亣鎴戞柟姣旇禌鍋滀笅锛堟棤銆岃繛鎺?N 澶┿€嶏級 */
function onAdvanceToSeasonEnd() {
  if (world.sacked) {
    handleSacked({ sacked: true, msg: world.sackedReason || "浣犲凡琚В闆? });
    return;
  }
  if (world.seasonOver || (world.fixtures.length && world.fixtures.every((f) => f.played))) {
    toast(t("toast.seasonOver"));
    return;
  }
  if (
    !confirm(
      "灏嗚嚜鍔ㄦ帹杩涙棩绋嬶紝鐩村埌璧涘缁撴潫锛涢€斾腑閬囧埌鎴戞柟姣旇禌浼氬仠涓嬨€俓n锛堜笉浼氳烦杩囦綘鐨勬瘮璧涳級\n纭畾锛?
    )
  ) {
    return;
  }
  const res = advanceToSeasonEnd(world, { stopOnUserMatch: true });
  if (world.sacked || res.sacked) {
    handleSacked(res.sackedResult || { sacked: true, msg: world.sackedReason });
    return;
  }
  if (!res.ok && !res.days) {
    toast(res.msg || "鏃犳硶鎺ㄨ繘");
    if (res.userMatches?.length) pendingMatch = res.userMatches[0];
    refreshAll();
    return;
  }
  if (res.userMatches && res.userMatches.length) {
    pendingMatch = res.userMatches[0];
    const label = pendingMatch.roundLabel || `绗?${pendingMatch.round} 杞甡;
    toast(`${res.msg || `鎺ㄨ繘 ${res.days} 澶ー} 路 ${label}`);
  } else if (world.seasonOver) {
    toast(res.msg || `鎺ㄨ繘 ${res.days} 澶?路 璧涘缁撴潫`);
    if (world.sacked) handleSacked({ sacked: true, msg: world.sackedReason });
  } else {
    toast(res.msg || `鎺ㄨ繘 ${res.days} 澶ー);
  }
  autosave("advance-season-end");
  refreshAll();
}

function syncMatchSpeedUI() {
  document.querySelectorAll("[data-match-speed]").forEach((btn) => {
    const v = Number(btn.dataset.matchSpeed);
    btn.classList.toggle("active", v === matchSpeed);
  });
}

/**
 * 鐩存挱/蹇€熸ā鎷熶簨浠跺仠椤匡紙姣锛屽啀闄や互鍊嶉€燂級
 * 脳1 鈮?FMM銆屾甯歌璧涖€嶏細绌哄垎閽熶篃鏈夎妭濂忥紝鍏抽敭鎴忔洿闀?
 */
function matchEventWaitMs(ev) {
  if (!ev) return 420;
  switch (ev.type) {
    case "goal":
      return 0; // 杩涚悆璧伴珮鍏夊洖鏀撅紝鍗曠嫭璁℃椂
    case "tick":
      // 姣忎竴姣旇禌鍒嗛挓鐨勩€屽懠鍚搞€嶁€斺€斾箣鍓嶅嚑涔庝负 0锛屾墍浠ユ暣浣撻蹇?
      return 280;
    case "chance":
    case "woodwork":
    case "penalty":
    case "pen_miss":
      // 棰勬紨宸插崰 ~1.2s锛岃繖閲屽彧鐣欏皠闂ㄧ粨鏋滃仠鐣?
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
      // 棰勬紨宸茬粍缁囷紝瑙掔悆缁撴灉绋嶇煭
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
 * 椹卞姩鐞冨満鐢婚潰 + 鎸夊€嶉€熺瓑寰咃紙杩涚悆鑷姩楂樺厜鍥炴斁锛?
 * 鏀寔鏆傚仠 / 閫愪簨浠讹紱杩涚悆浼氬啓鍏ュ彲鍥炵湅鍒楄〃
 * @param {boolean} live 鏄惁鍐欒瘎璁?鏇存柊姣斿垎鏉★紙鐩存挱锛?
 */
async function driveMatchEvent(ev, snap, { live = true } = {}) {
  const spd = Math.max(0.25, Number(matchSpeed) || 1);
  const fixture = pendingMatch;

  if (ev.type === "tick") {
    if (live && snap) setMatchMinute(snap.minute);
    // 瀵兼紨 tick锛氱敤 snap 鎺х悆鍋忕疆鎺ㄨ繛缁〃婕旓紙涓嶆敼姣斿垎锛?
    if (matchView?.onTick) matchView.onTick(snap);
    // 绌哄垎閽熶篃瑕佸仠锛氬惁鍒?90 鍒嗛挓鍑犱箮鐬棿璺冲畬
    // 鏀诲娍娈佃惤涓暐鎷夐暱鍛煎惛锛屾洿鍍忋€岃繖涓€娉€?
    let tickMs = matchEventWaitMs(ev);
    if (matchView?._attackPhaseActive?.()) tickMs = Math.round(tickMs * 1.25);
    const wait = live ? tickMs / spd : Math.max(12, tickMs / (spd * 8));
    await sleepPlayback(wait);
    return;
  }

  if (ev.type === "goal") {
    // 鍏堟姄鍦洪潰锛屽啀瀵归綈/楂樺厜鈥斺€斿洖鐪嬫墠鑳戒粠鍚屼竴甯ф帴
    const scene = matchView?.captureSceneSnapshot?.() || null;
    rememberGoalReplay(ev, snap, fixture, scene);
    if (live) {
      if (ev.text) appendMatchEvent(ev, { goalIndex: matchPlayback.goals.length - 1 });
      if (snap) {
        setMatchScore(snap.homeGoals, snap.awayGoals);
        setMatchMinute(ev.minute);
      }
    }
    if (matchView?.extendAttackFromEvent) matchView.extendAttackFromEvent(ev, fixture);
    // 楂樺厜鍓嶈交瀵归綈鎺х悆锛堝畬鏁寸粍缁囧湪 playGoalHighlight 鍐咃級
    if (matchView?.prepareEvent) {
      await matchView.prepareEvent(ev, snap, fixture, {
        speed: spd,
        live,
        sleepFn: sleepPlayback,
      });
    }
    if (matchView?.playGoalHighlight) {
      // 杩涚悆楂樺厜锛毭? 鏃朵笉鍔犻€燂紱蹇繘妗ｆ墠鐣ュ帇缂?
      const goalSpd = Math.min(spd, live ? 1.15 : 1.5);
      await matchView.playGoalHighlight(ev, snap, fixture, {
        speed: goalSpd,
        lang: getLang(),
        sleepFn: sleepPlayback,
        // 鐩存挱锛氱敤鎶撳彇鐨勫満闈綔鍙傝€冿紙楂樺厜鍐呬粛浠庡綋鍓嶅抚鎺ㄨ繘锛?
        scene: scene || null,
        rewatch: false,
      });
    }
    return;
  }

  // 鍏抽敭浜嬩欢寤堕暱鏀诲娍 + 棰勬紨
  if (matchView?.extendAttackFromEvent) matchView.extendAttackFromEvent(ev, fixture);
  if (matchView?.prepareEvent) {
    await matchView.prepareEvent(ev, snap, fixture, {
      speed: spd,
      live,
      sleepFn: sleepPlayback,
    });
  }

  if (matchView) matchView.onEvent(ev, snap, fixture);

  if (live) {
    if (ev.text) appendMatchEvent(ev);
    if (snap) {
      setMatchScore(snap.homeGoals, snap.awayGoals);
      setMatchMinute(ev.minute);
    }
    if (ev.type === "context") {
      const ctx = $("#match-context");
      if (ctx) ctx.textContent = (ev.text || "").replace(/^鎯呭锛?, "");
    }
    if (ev.type === "ht") setMatchLiveState("ht");
    if (ev.type === "ft") setMatchLiveState("ft");
  }

  const base = matchEventWaitMs(ev);
  if (base > 0) {
    // 蹇€熸ā鎷熶粛鍙鐢婚潰锛屼絾鏄庢樉蹇簬鐩存挱
    const wait = live ? base / spd : base / (spd * 2.2);
    await sleepPlayback(Math.max(50, wait));
  }
}

/**
 * 閿佸畾澶╂皵 + 寰锋瘮/鐒︾偣锛岀敓鎴愬畬鏁磋禌鍓嶇畝鎶?
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
 * 璧涘墠绠€鎶?HTML锛堟瑙?compact / 姣旇禌椤?full锛?
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
  const formPill = (str, tone) => {
    const s = str && str !== "鈥? ? str : en ? "n/a" : "鏆傛棤";
    return `<span class="form-pill tone-${tone || "neutral"}">${escapeHtml(s)}</span>`;
  };
  const chips = [];
  if (wx) chips.push(`<span class="brief-chip weather">${escapeHtml(wx.icon + " " + wx.name)}</span>`);
  if (brief.derby) chips.push(`<span class="brief-chip hot">${en ? "馃敟 Derby" : "馃敟 寰锋瘮"}</span>`);
  if (brief.bigMatch) {
    chips.push(
      `<span class="brief-chip hot">${brief.isCup ? (en ? "馃弳 Cup spotlight" : "馃弳 鐒︾偣鏉禌") : en ? "猸?Big match" : "猸?鐒︾偣鎴?}</span>`
    );
  }
  if (brief.matchup === "favorite")
    chips.push(`<span class="brief-chip good">${en ? "Favourites" : "绾搁潰鍗犱紭"}</span>`);
  else if (brief.matchup === "underdog")
    chips.push(`<span class="brief-chip warn">${en ? "Underdogs" : "瀹炲姏鍋忓急"}</span>`);
  if (brief.boardLabel)
    chips.push(
      `<span class="brief-chip board">${en ? "Board" : "钁ｄ簨浼?}: ${escapeHtml(brief.boardLabel)}</span>`
    );

  const rows = [];
  if (!brief.isCup && (me.pos || opp.pos)) {
    rows.push(
      en
        ? `Table: us #${me.pos || "鈥?} (${me.pts}pts) 路 them #${opp.pos || "鈥?} (${opp.pts}pts)`
        : `绉垎姒滐細鎴?绗?{me.pos || "鈥?}锛?{me.pts}鍒嗭級 路 瀵规柟 绗?{opp.pos || "鈥?}锛?{opp.pts}鍒嗭級`
    );
  }
  rows.push(
    `${en ? "Form" : "杩戝喌"}: ${en ? "Us" : "鎴?} ${me.formStr || "鈥?} 路 ${en ? "Them" : "瀵规柟"} ${opp.formStr || "鈥?}`
  );
  if (me.avgFit != null) {
    rows.push(
      en
        ? `XI fitness avg ${me.avgFit}% 路 ${me.formation}`
        : `棣栧彂浣撹兘鍧?${me.avgFit}% 路 闃靛瀷 ${me.formation}`
    );
  }
  if (brief.suspended?.length) {
    rows.push(
      `${en ? "Suspended" : "鍋滆禌"}: ${brief.suspended.map((s) => `${s.name}(${s.matches})`).join(en ? ", " : "銆?)}`
    );
  }
  if (brief.injured?.length) {
    rows.push(
      `${en ? "Injured" : "浼ょ梾"}: ${brief.injured
        .slice(0, compact ? 3 : 5)
        .map((s) => s.name)
        .join(en ? ", " : "銆?)}`
    );
  }
  if (brief.yellowRisk?.length) {
    rows.push(
      `${en ? "Card risk" : "榛勭墝杈圭紭"}: ${brief.yellowRisk.map((s) => `${s.name}(${s.yellows})`).join(en ? ", " : "銆?)}`
    );
  }
  if (brief.tired?.length) {
    rows.push(
      `${en ? "Low fitness" : "浣撹兘鍛婃€?}: ${brief.tired.map((s) => `${s.name}${s.fit}%`).join(en ? ", " : "銆?)}`
    );
  }
  // 濞佽儊鐞冨憳锛氫紭鍏堢敤鐞冩帰鎶ュ憡锛堝甫妯＄硦鑳藉姏锛夛紝鍚﹀垯鍥為€€绮剧‘ ovr
  if (brief.oppReport?.danger?.length) {
    rows.push(
      `${en ? "Threats" : "瀵规柟濞佽儊"}: ${brief.oppReport.danger
        .map((s) => `${s.name}(${s.ovrText})`)
        .join(en ? ", " : "銆?)}`
    );
  } else if (opp.top?.length) {
    rows.push(
      `${en ? "Threats" : "瀵规柟濞佽儊"}: ${opp.top.map((s) => `${s.name}(${s.ovr})`).join(en ? ", " : "銆?)}`
    );
  }
  if (!brief.oppReport && !compact && opp.formation) {
    rows.push(
      en
        ? `Opp setup: ${opp.formation} 路 power ${opp.power}`
        : `瀵规柟閮ㄧ讲锛?{opp.formation} 路 瀹炲姏 ${opp.power}`
    );
  }
  if (brief.h2h?.length) {
    const h = brief.h2h
      .slice(0, 3)
      .map((x) => `${x.venue} ${x.score}`)
      .join(" 路 ");
    rows.push(`${en ? "H2H" : "浜ら攱"}: ${h}`);
  } else if (!compact) {
    rows.push(en ? "H2H: first meeting this season" : "浜ら攱锛氭湰瀛ｉ娆′氦鎵?);
  }

  if (!rows.length) {
    rows.push(en ? "Squad available 鈥?no major absences" : "浜哄憳榻愬叏锛屾棤閲嶅ぇ缂洪樀");
  }

  const head = compact
    ? ""
    : `<div class="brief-head">
        <strong>${escapeHtml(t("match.briefing") || (en ? "Pre-match briefing" : "璧涘墠绠€鎶?))}</strong>
        <span class="muted">${escapeHtml(brief.roundLabel || "")} 路 ${brief.isHome ? (en ? "Home" : "涓诲満") : en ? "Away" : "瀹㈠満"}</span>
      </div>`;

  const formRow =
    !compact
      ? `<div class="brief-form-row">
          <span>${escapeHtml(me.short || me.name || "")} ${formPill(me.formStr, me.formTone)}</span>
          <span class="muted">vs</span>
          <span>${escapeHtml(opp.short || opp.name || "")} ${formPill(opp.formStr, opp.formTone)}</span>
        </div>`
      : "";

  const oppHtml = brief.oppReport
    ? formatOpponentReportHtml(brief.oppReport, { lang: en ? "en" : "zh", compact })
    : "";

  return `<div class="prematch-brief ${compact ? "compact" : "full"}">
    ${head}
    ${chips.length ? `<div class="brief-chips">${chips.join("")}</div>` : ""}
    ${formRow}
    ${rows.map((b) => `<div class="brief-line">鈥?${escapeHtml(b)}</div>`).join("")}
    ${oppHtml}
  </div>`;
}

/**
 * 闃熷唴璁茶瘽閫夐」 UI
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
        : "闃熷唴璁茶瘽"
      : en
        ? "Pre-match team talk"
        : "璧涘墠闃熷唴璁茶瘽";
  const hint =
    phase === "ht"
      ? en
        ? "Sets the tone for the second half 路 morale + match modifiers"
        : "瀹氳皟涓嬪崐鍦?路 褰卞搷澹皵涓庢敾闃蹭慨姝?
      : en
        ? "Pick one before kick-off 路 morale + first-half modifiers 路 media quote"
        : "寮€璧涘墠閫変竴鍙?路 褰卞搷澹皵涓庝笂鍗婂満 路 濯掍綋浼氬紩鐢?;
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

function openMatch() {
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
  matchState = null;
  pendingSubs = [];
  const home = world.clubs.find((c) => c.id === next.home);
  const away = world.clubs.find((c) => c.id === next.away);
  const user = getUserClub(world);
  setupMatchScoreboard(home, away, next);
  setMatchScore(0, 0);
  setMatchMinute(0);
  setMatchLiveState("pre");
  updateLiveStats(null);
  setMatchStatsPanelOpen(false);
  $("#match-log").innerHTML = "";
  resetMatchPlayback({ keepStepMode: true });

  // 璧涘墠绠€鎶?+ 闃熷唴璁茶瘽锛氬崱鐗?+ 璇勮娴侊紙澶╂皵涓庡紑璧涢攣瀹氫竴鑷达級
  selectedPreTalk = "encourage";
  const brief = buildBriefingForFixture(next, user);
  const panel = $("#match-pre-brief");
  if (panel) {
    const talkHtml = renderTeamTalkPicker("pre", selectedPreTalk, "pre-team-talk");
    if (brief) {
      panel.innerHTML = renderPrematchBriefHtml(brief, { compact: false }) + talkHtml;
      panel.classList.remove("hidden");
    } else {
      panel.innerHTML = talkHtml;
      panel.classList.remove("hidden");
    }
    bindTeamTalkPicker(panel.querySelector(".team-talk-panel"));
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
    // 璁″垎鏉挎儏澧冩潯
    const ctx = $("#match-context");
    if (ctx && brief.weather) {
      const bits = [`${brief.weather.icon} ${brief.weather.name}`];
      if (brief.derby) bits.push(getLang() === "en" ? "Derby" : "寰锋瘮");
      if (brief.bigMatch) bits.push(getLang() === "en" ? "Spotlight" : "鐒︾偣");
      bits.push(brief.roundLabel || "");
      ctx.textContent = bits.filter(Boolean).join(" 路 ");
    }
  }

  hideHtPanel();
  hideMatchReport();
  syncMatchSpeedUI();
  // 2D 鐞冨満锛氳禌鍓嶇珯浣嶏紙鍙偣鐞冨憳锛?
  ensureMatchPitch(true);
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
}

/** 寮€璧涘悗鏀惰捣璧涘墠绠€鎶ュ崱鐗囷紙璇勮娴佷粛淇濈暀锛?*/
function hidePrematchBriefPanel() {
  const panel = $("#match-pre-brief");
  if (panel) {
    panel.classList.add("hidden");
  }
}

/** FM 椋庢牸璁″垎鏉匡細闃熷悕銆佺悆琛ｈ壊銆佽禌浜?*/
function setupMatchScoreboard(home, away, fixture) {
  ensureKit(home);
  ensureKit(away);
  const setName = (id, club) => {
    const el = $(id);
    if (el) el.textContent = club.name;
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
  if (hk) hk.style.background = kitBackground(ensureKit(home));
  if (ak) {
    const kit = ensureKit(away);
    // 閬垮厤涓庝富闃熸挒鑹诧細浼樺厛鍓壊
    ak.style.background = kitBackground({
      ...kit,
      primary: kit.secondary || kit.primary,
      secondary: kit.primary,
    });
  }
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
}

function setMatchMinute(min) {
  const el = $("#match-minute");
  if (el) el.textContent = `${min ?? 0}'`;
}

/**
 * 鏇存柊璁″垎鏉夸笅 xG / 鎺х悆 / 灏勯棬
 * @param {null | { home?: object, away?: object } | object} snapOrReport
 *   鍙紶 liveSnap銆乵atch report銆佹垨 { home: {xg,possession,shots,shotsOn}, away: ... }
 */
function updateLiveStats(snapOrReport) {
  const empty = { xg: 0, possession: 50, shots: 0, shotsOn: 0 };
  let h = empty;
  let a = empty;
  if (snapOrReport) {
    // liveSnap 鎴?report 缁撴瀯
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

  // 鐞冨満瑙掓爣杩蜂綘鏉★紙涓嶆尅瑙嗙嚎锛?
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

/** FMM锛歺G/鎺х悆/灏勯棬 鎶樺彔鎶藉眽 */
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
 * fast/live 鍦ㄤ腑鍦烘殏鍋滐紱instant 涓€閿畬璧?
 */
async function runMatch(mode) {
  if (!pendingMatch || pendingMatch.played || liveRunning) return;
  setMatchBusy(true);
  hidePrematchBriefPanel();
  hideHtPanel();
  hideMatchReport();
  // 淇濈暀璧涘墠绠€鎶ヨ锛屽彧娓呮帀鏃ф瘮璧涙畫鐣欙紙鑻ユ湁锛?
  const logEl = $("#match-log");
  if (logEl) {
    const kept = [...logEl.querySelectorAll(".event.briefing")];
    logEl.innerHTML = "";
    for (const n of kept) logEl.appendChild(n);
    // 鑻ユ棤绠€鎶ワ紙寮傚父璺緞锛夛紝琛ュ啓涓€娆?
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
    // 纭繚鐞冨満宸叉寕杞?
    ensureMatchPitch();
    setMatchLiveState("live");

    // 璇诲彇璧涘墠璁茶瘽锛堥潰鏉块殣钘忓墠锛?
    const prePanel = $("#match-pre-brief");
    selectedPreTalk = getSelectedTeamTalk(prePanel, "pre-team-talk") || selectedPreTalk || "encourage";

    if (mode === "instant") {
      const result = simulateMatch(world, pendingMatch, { teamTalkId: selectedPreTalk });
      // 蹇€熷洖鏀?2D锛堝彈鍊嶉€熷奖鍝嶏紱杩涚悆浼氶珮鍏夛級
      if (matchView) {
        await matchView.replayEvents(result.events, pendingMatch, {
          // 涓€閿畬璧涳細鍦ㄦ墍閫夊€嶉€熶笂鍐嶇暐蹇竴鐐癸紝浣嗕粛灏婇噸 脳1 姝ｅ父瑙傛劅
          speed: Math.max(0.5, Number(matchSpeed) || 1) * (Number(matchSpeed) <= 1 ? 1.05 : 1.35),
          sleepFn: sleepPlayback,
          onStep: (ev, snap) => {
            if (ev.type === "tick") return;
            if (ev.type === "goal") {
              rememberGoalReplay(ev, snap, pendingMatch);
              if (ev.text) {
                appendMatchEvent(ev, { goalIndex: matchPlayback.goals.length - 1 });
              }
            } else if (ev.text) {
              appendMatchEvent(ev);
            }
            setMatchScore(snap.homeGoals, snap.awayGoals);
            setMatchMinute(ev.minute || 90);
          },
        });
      } else {
        for (const ev of result.events || []) {
          if (ev.type === "tick" || !ev.text) continue;
          if (ev.type === "goal") {
            rememberGoalReplay(ev, { homeGoals: 0, awayGoals: 0, minute: ev.minute }, pendingMatch);
            appendMatchEvent(ev, { goalIndex: matchPlayback.goals.length - 1 });
          } else {
            appendMatchEvent(ev);
          }
        }
      }
      setMatchScore(result.homeGoals, result.awayGoals);
      setMatchMinute(90);
      updateLiveStats(result.report || pendingMatch.matchReport);
      setMatchLiveState("ft");
      showMatchReport(result.report || pendingMatch.matchReport);
      finishMatchUI();
      saveGame(world);
      return;
    }

    matchState = createMatchSession(world, pendingMatch);
    // 璧涘墠闃熷唴璁茶瘽 鈫?澹皵 + 涓婂崐鍦轰慨姝?+ 濯掍綋锛堜簨浠剁粡 playFirstHalf onEvent / 蹇€熸棩蹇楀埛鍑猴級
    const talkRes = applyTeamTalk(matchState, selectedPreTalk, "pre");
    if (talkRes.ok) toast(talkRes.msg);
    // 浼氳瘽鍒涘缓鍚庨樀瀹瑰彲鑳?autoLineup锛屽埛鏂扮悆鍦?
    ensureMatchPitch(true);
    const live = mode === "live";
    matchState._liveMode = live;
    const onEvent = async (ev, snap) => {
      if (snap?.home) updateLiveStats(snap);
      await driveMatchEvent(ev, snap, { live });
    };

    await playFirstHalf(matchState, { onEvent });

    // 闈炵洿鎾細涓婂崐鍦轰簨浠跺啓鍏ユ棩蹇楋紙鐢婚潰宸插湪 onEvent 椹卞姩锛?
    if (!live) {
      let goalCursor = 0;
      for (const ev of matchState.events) {
        if (ev.type === "tick" || !ev.text) continue;
        if (ev.type === "goal") {
          appendMatchEvent(ev, { goalIndex: goalCursor });
          goalCursor++;
        } else {
          appendMatchEvent(ev);
        }
      }
      setMatchScore(matchState.hg, matchState.ag);
      setMatchMinute(45);
      // 涓満鏃剁敤 session 缁熻鍒蜂竴娆℃潯
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
      const ctxEv = matchState.events.find((e) => e.type === "context");
      if (ctxEv) {
        const ctx = $("#match-context");
        if (ctx) ctx.textContent = ctxEv.text.replace(/^鎯呭锛?, "");
      }
    }

    // 涓満鏆傚仠锛氬仠鎺夋挱鏀炬帶鍒讹紝閬垮厤鍗″湪銆屼笅涓€姝ャ€?
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

function ensureMatchPitch(remount = false) {
  const pitchRoot = $("#match-pitch-root");
  if (!pitchRoot || !pendingMatch) return;
  const home = world.clubs.find((c) => c.id === pendingMatch.home);
  const away = world.clubs.find((c) => c.id === pendingMatch.away);
  if (!home || !away) return;
  const onPlayerClick = (playerId) => {
    // 瀹屾暣璧勬枡寮圭獥锛堟殏鍋滄椂鏈€鍚堥€傦紝杩涜涓篃鍙偣锛?
    showPlayerModal(playerId);
  };
  if (!matchView || remount || !matchView._built) {
    matchView = getMatchView(pitchRoot);
    matchView.mount(home, away, { onPlayerClick });
  } else {
    matchView.setOnPlayerClick(onPlayerClick);
  }
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
  panel.classList.remove("hidden");
  setLiveTacBarVisible(false);
  pendingSubs = [];
  const club = matchState.userClub;
  ensureTactics(club);
  const tac = club?.tactics || {};
  const htScoreEl = $("#match-ht-score");
  if (htScoreEl) {
    htScoreEl.textContent = t("match.htScore", {
      home: matchState.home.name,
      away: matchState.away.name,
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
  // 鎹㈤樀鍨嬫椂閲嶉厤瑙掕壊缂栬緫鍣?
  const htForm = $("#ht-formation");
  if (htForm && !htForm.dataset.roleBound) {
    htForm.dataset.roleBound = "1";
    htForm.addEventListener("change", () => {
      if (!matchState?.userClub) return;
      const club = matchState.userClub;
      ensureTactics(club);
      const next = htForm.value;
      if (next && FORMATIONS[next] && next !== club.tactics.formation) {
        club.tactics.formation = next;
        ensureMatchLineup(club);
        ensureLineupRoles(club, { reset: true });
        toast(
          getLang() === "en"
            ? `Formation 鈫?${next} 路 roles reset`
            : `闃靛瀷鏀逛负 ${next} 路 瑙掕壊宸叉寜榛樿閲嶉厤`
        );
      }
      renderHtRoleEditors();
      renderHtSubSelects();
      ensureMatchPitch(true);
    });
  }
  renderHtSubSelects();
  renderHtSubsList();
  if (matchView) {
    matchView.phase = "pause";
    matchView.setBanner(getLang() === "en" ? "HALF-TIME" : "涓満浼戞伅", "info");
    matchView._syncClickable?.();
  }
  $("#btn-match-continue").disabled = true;
  $("#btn-sim-fast").disabled = true;
  $("#btn-sim-live").disabled = true;
  const inst = $("#btn-sim-instant");
  if (inst) inst.disabled = true;
}

/** 涓満锛氫笂鍗婂満瑙掕壊澶嶇洏 */
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
    .map((t) => `<div class="ht-role-tip">鈥?${escapeHtml(t)}</div>`)
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
      <strong>${escapeHtml(en ? "1st-half role review" : "涓婂崐鍦鸿鑹插鐩?)}</strong>
      <span class="muted">${escapeHtml(rev.formation || "")}</span>
    </div>
    ${contrib ? `<div class="ht-role-contrib">${contrib}</div>` : ""}
    <div class="ht-role-tips">${tips}</div>
  `;
  box.classList.remove("hidden");
}

/** 涓満锛氶€愪汉瑙掕壊涓嬫媺锛堜笅鍗婂満鐢熸晥锛?*/
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
  const rows = slots
    .map((slot, i) => {
      const pid = lineup[i];
      const p = club.players.find((x) => x.id === pid);
      const rid = roles[i] || defaultRoleForSlot(slot, i, slots);
      const opts = (ROLES_BY_POS[slot.pos] || [])
        .map((id) => {
          const r = PLAYER_ROLES[id];
          if (!r) return "";
          const lab = en ? r.labelEn : r.label;
          return `<option value="${id}" ${id === rid ? "selected" : ""}>${escapeHtml(lab)}</option>`;
        })
        .join("");
      const name = p ? escapeHtml(playerDisplaySurname(p.name, p.nationality) || p.name) : "鈥?;
      return `<label class="ht-role-edit">
        <span class="ht-role-edit-pos">${escapeHtml(POS_LABEL[slot.pos] || slot.pos)}</span>
        <span class="ht-role-edit-name">${name}</span>
        <select data-ht-role-slot="${i}">${opts}</select>
      </label>`;
    })
    .join("");
  box.innerHTML = `
    <div class="ht-role-edit-head">
      <strong>${escapeHtml(en ? "Roles for 2nd half" : "涓嬪崐鍦鸿鑹叉寚浠?)}</strong>
      <span class="muted">${escapeHtml(en ? "Change formation above resets defaults" : "涓婃柟鎹㈤樀鍨嬩細閲嶇疆榛樿瑙掕壊")}</span>
    </div>
    <div class="ht-role-edit-grid">${rows}</div>
  `;
}

function collectHtRoles() {
  const box = $("#match-ht-roles");
  if (!box) return null;
  const sels = box.querySelectorAll("select[data-ht-role-slot]");
  if (!sels.length) return null;
  const roles = [];
  sels.forEach((sel) => {
    const i = +sel.dataset.htRoleSlot;
    roles[i] = sel.value;
  });
  return roles;
}

/** 涓満闃熷唴璁茶瘽閫夐」锛堟寜姣斿垎鎺ㄨ崘榛樿锛?*/
function renderHtTeamTalk() {
  const box = $("#match-ht-talk");
  if (!box || !matchState) return;
  const suggested = suggestHalfTimeTalk(matchState) || "encourage";
  const en = getLang() === "en";
  // 鐩存帴鍐欏叆鍐呭锛岄伩鍏嶄笌 #match-ht-talk 鐨?panel 濂楀▋
  box.className = "team-talk-panel";
  box.dataset.phase = "ht";
  box.innerHTML = `
    <div class="team-talk-head">
      <strong>${escapeHtml(en ? "Team talk" : "闃熷唴璁茶瘽")}</strong>
      <span class="muted team-talk-hint">${escapeHtml(
        en
          ? "Sets the tone for the second half 路 morale + modifiers"
          : "瀹氳皟涓嬪崐鍦?路 褰卞搷澹皵涓庢敾闃蹭慨姝?
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
    badge.textContent = en ? "Suggested" : "鎺ㄨ崘";
    rec.appendChild(badge);
  }
  bindTeamTalkPicker(box);
}

/** 涓満锛氫綋鑳藉憡鎬?/ 榛勭墝杈圭紭 / 姣斿垎寤鸿 */
function renderHtTips() {
  const box = $("#match-ht-tips");
  if (!box || !matchState) return;
  const tips = getHalfTimeTips(matchState);
  const en = getLang() === "en";
  const parts = [];
  if (tips.scoreTip) {
    parts.push(
      `<div class="ht-tip score"><strong>${en ? "Score" : "姣斿垎"}</strong> ${escapeHtml(tips.scoreTip)}</div>`
    );
  }
  if (tips.avgFit != null) {
    parts.push(
      `<div class="ht-tip fit"><strong>${en ? "Avg fitness" : "棣栧彂浣撹兘"}</strong> ${tips.avgFit}%</div>`
    );
  }
  if (tips.fitness?.length) {
    const list = tips.fitness
      .map((p) => `${escapeHtml(p.name)} <em>${Math.round(p.fitness ?? 0)}%</em>`)
      .join(" 路 ");
    parts.push(
      `<div class="ht-tip warn"><strong>${en ? "Tired" : "浣撹兘鍛婃€?}</strong> ${list}</div>`
    );
  }
  if (tips.yellows?.length) {
    const list = tips.yellows
      .map(
        (p) =>
          `${escapeHtml(p.name)}${p.booked ? (en ? " (booked)" : "锛堟湰鍦哄凡榛勶級") : ` (${p.yellows})`}`
      )
      .join(" 路 ");
    parts.push(
      `<div class="ht-tip card"><strong>${en ? "Card risk" : "榛勭墝杈圭紭"}</strong> ${list}</div>`
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
 * 涓満锛氶鍙戜綋鑳芥潯锛堟寜浣撹兘鍗囧簭锛屼綆浣撹兘楂樹寒锛?
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
  const title = en ? "XI fitness" : "棣栧彂浣撹兘";
  const rows = xi
    .map((p) => {
      const fit = Math.round(p.fitness ?? 100);
      let cls = "ht-fit-row";
      if (fit < 50) cls += " critical";
      else if (fit < 62) cls += " low";
      else if (fit < 75) cls += " mid";
      const pos = POS_LABEL[p.pos] || p.pos || "";
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
  }
}

function onLiveTacApply() {
  if (!matchState?.userClub || matchState.finished) {
    toast(getLang() === "en" ? "Not available" : "褰撳墠鏃犳硶璋冩暣");
    return;
  }
  // 浠呬笅鍗婂満 live 鏈夋剰涔夛紱涓婂崐鍦?涓満鐢?HT 闈㈡澘
  if (matchState.phase === "ht" || matchState.phase === "h1") {
    toast(getLang() === "en" ? "Use half-time panel" : "璇峰湪涓満闈㈡澘璋冩暣");
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
    toast(res.msg || "澶辫触");
    return;
  }
  if (res.msg === "鏃犲彉鍖?) {
    toast(t("match.tacNoChange") || (getLang() === "en" ? "No change" : "鏃犲彉鍖?));
    return;
  }
  // 鐢婚潰 + 璇勮鍙嶉
  const side = matchState.userSide === "away" ? "away" : "home";
  const styleKey = res.tactics.style || "balanced";
  const styleName = t("style." + styleKey) || styleKey;
  if (matchView?.showTacticsFeedback) {
    matchView.showTacticsFeedback(side, {
      style: res.tactics.style,
      pressing: res.tactics.pressing,
      tempo: res.tactics.tempo,
      styleLabel: styleName,
      label: res.event?.text?.replace(/^馃搵\s*/, "") || undefined,
    });
  }
  if (res.event?.text) appendMatchEvent(res.event);
  // 楂樺帇杩?鈫?琛ㄧ幇灞傚紑涓€娈垫敾鍔?
  if (res.tactics.pressing >= 4 && matchView?.beginAttackPhase) {
    matchView.beginAttackPhase(side, { ms: 12000, intensity: 0.75, caption: false });
  }
  toast(
    t("match.tacApplied", {
      style: styleName,
      press: res.tactics.pressing,
      tempo: res.tactics.tempo,
    }) || (getLang() === "en" ? "Tactics applied" : "鎴樻湳宸插簲鐢?)
  );
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
        `<option value="${p.id}">${POS_LABEL[p.pos] || p.pos} ${p.name} 路 ${p.ovr} 路 浣?{Math.round(p.fitness ?? 0)}</option>`
    )
    .join("");
  inSel.innerHTML = bench
    .filter((p) => !pendingIn.has(p.id))
    .map(
      (p) =>
        `<option value="${p.id}">${POS_LABEL[p.pos] || p.pos} ${p.name} 路 ${p.ovr} 路 浣?{Math.round(p.fitness ?? 0)}</option>`
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
      .map((s) => `<li>馃攧 ${escapeHtml(s.outName)} 鈫?鈫?${escapeHtml(s.inName)} 鈫?/li>`)
      .join("");
  }
}

function onHtAddSub() {
  if (!matchState?.userClub) return;
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
  // 涓満闈㈡澘锛氱珛鍒诲彲瑙佸弽棣堬紙鐪熸涓婂満鍦ㄤ笅鍗婂満寮€濮嬫椂锛?
  const en = getLang() === "en";
  toast(
    t("match.subQueued", { out: outP.name, inn: inP.name }) ||
      (en ? `Queued: ${outP.name} 鈫?${inP.name}` : `宸茬櫥璁帮細${outP.name} 鈫?${inP.name}`)
  );
  const tip = $("#match-ht-score");
  if (tip && pendingSubs.length) {
    const base = tip.dataset.htBase || tip.textContent;
    tip.dataset.htBase = base;
    const names = pendingSubs.map((s) => `${s.outName}鈫?{s.inName}`).join(" 路 ");
    tip.textContent = `${base} 路 ${en ? "Subs" : "鎹汉"}: ${names}`;
  }
}

/** 涓嬪崐鍦哄紑鐞冩彁绀烘枃妗堬紙姣斿垎 + 鏄惁宸茶皟锛?*/
function buildSecondHalfKickTip(applyOrders, orders) {
  const en = getLang() === "en";
  if (!matchState) return en ? "2nd half" : "涓嬪崐鍦?;
  const club = matchState.userClub;
  const myG = club === matchState.home ? matchState.hg : matchState.ag;
  const opG = club === matchState.home ? matchState.ag : matchState.hg;
  let scoreBit = "";
  if (myG < opG) scoreBit = en ? "Trailing" : "钀藉悗";
  else if (myG > opG) scoreBit = en ? "Leading" : "棰嗗厛";
  else scoreBit = en ? "Level" : "骞冲眬";

  if (!applyOrders) {
    return en
      ? `${scoreBit} 鈥?no changes, 2nd half`
      : `${scoreBit} 路 涓嶈皟鏁达紝涓嬪崐鍦哄紑濮媊;
  }
  const bits = [scoreBit];
  if (orders?.style) {
    bits.push(t("style." + orders.style) || orders.style);
  }
  if (orders?.pressing != null) {
    bits.push(en ? `Press ${orders.pressing}` : `鍘嬭揩 ${orders.pressing}`);
  }
  if (orders?.tempo != null) {
    bits.push(en ? `Tempo ${orders.tempo}` : `鑺傚 ${orders.tempo}`);
  }
  if (orders?.width != null) {
    bits.push(en ? `Width ${orders.width}` : `瀹藉害 ${orders.width}`);
  }
  if (orders?.defensiveLine != null) {
    bits.push(en ? `Line ${orders.defensiveLine}` : `闃茬嚎 ${orders.defensiveLine}`);
  }
  if (orders?.formation) {
    bits.push(orders.formation);
  }
  const nSub = orders?.subs?.length || 0;
  if (nSub) bits.push(en ? `${nSub} sub(s)` : `${nSub} 浜烘崲浜篳);
  return en
    ? `${bits.join(" 路 ")} 鈥?2nd half`
    : `${bits.join(" 路 ")} 路 涓嬪崐鍦哄紑濮媊;
}

async function finishHalfTime(applyOrders) {
  if (!matchState || matchState.finished || liveRunning) return;
  hideHtPanel();
  setMatchBusy(true);
  matchPlayback.controlsEnabled = true;
  matchPlayback.paused = false;
  if (matchView?.setFrozen) matchView.setFrozen(false);
  updateMatchPlaybackUI();

  const htTalk = getSelectedTeamTalk($("#match-ht-talk"), "ht-team-talk");
  const htRoles = collectHtRoles();
  const orders = applyOrders
    ? {
        style: $("#ht-style")?.value,
        formation: $("#ht-formation")?.value,
        pressing: +($("#ht-pressing")?.value || 3),
        tempo: +($("#ht-tempo")?.value || 3),
        width: +($("#ht-width")?.value || 3),
        defensiveLine: +($("#ht-def-line")?.value || 3),
        roles: htRoles || undefined,
        subs: pendingSubs.map((s) => ({ outId: s.outId, inId: s.inId })),
        teamTalk: htTalk,
      }
    : {
        // 銆屼笉璋冩暣銆嶄粛鍙繚鐣欎腑鍦鸿璇濓紙鑻ョ帺瀹跺凡閫夛級
        teamTalk: htTalk,
      };

  const eventCountBefore = matchState.events.length;
  const goalsBefore = matchPlayback.goals.length;
  const kickTip = buildSecondHalfKickTip(applyOrders, orders);
  try {
    const live = !!matchState._liveMode;
    setMatchLiveState("live");
    // 涓嬪崐鍦猴細鐩存挱鏃舵樉绀哄満杈规垬鏈潯
    if (live) setLiveTacBarVisible(true);

    // 寮€鐞冩彁绀猴紙妯箙 + 璇勮锛?
    if (matchView?.showSecondHalfKickoff) {
      matchView.showSecondHalfKickoff({ text: kickTip, lang: getLang() });
    }
    appendMatchEvent({
      type: "coach",
      minute: 46,
      text: `馃挰 ${kickTip}`,
    });
    toast(kickTip);

    // continueSecondHalf锛氫腑鍦烘垬鏈?鎹汉浜嬩欢浼氱珛鍒?onEvent
    const onEvent = async (ev, snap) => {
      if (snap?.home) updateLiveStats(snap);
      await driveMatchEvent(ev, snap, { live });
    };

    if (matchView) {
      matchView.phase = "play";
    }

    const result = await continueSecondHalf(matchState, orders, { onEvent });

    if (!live) {
      // 蹇€熸ā鎷燂細onEvent 涓嶅啓鏃ュ織锛屾澶勮ˉ鍒凤紙鍚腑鍦烘垬鏈?鎹汉锛?
      let goalCursor = goalsBefore;
      for (const ev of matchState.events.slice(eventCountBefore)) {
        if (ev.type === "tick" || !ev.text) continue;
        if (ev.type === "goal") {
          appendMatchEvent(ev, { goalIndex: goalCursor });
          goalCursor++;
        } else {
          appendMatchEvent(ev);
        }
      }
    }
    // 鐩存挱锛歴ub/tactics 宸插湪 driveMatchEvent 瀹炴椂鍐欏叆锛屾棤闇€瀹屽満鍐嶈ˉ

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

/**
 * @param {object} report
 * @param {{ review?: boolean }} [opts]
 */
function showMatchReport(report, opts = {}) {
  const el = $("#match-report");
  if (!el || !report) return;
  const review = !!opts.review || !!matchPlayback.reviewMode;
  const h = report.home;
  const a = report.away;
  const row = (label, hv, av, bar) => {
    let barHtml = "";
    if (bar && typeof hv === "number" && typeof av === "number") {
      const t = hv + av || 1;
      const hp = Math.round((hv / t) * 100);
      barHtml = `<div class="report-bar-wrap"><div class="report-bar-h" style="width:${hp}%"></div></div>`;
    }
    return `<tr>
      <td class="num">${hv}</td>
      <td class="stat-label">${label}${barHtml}</td>
      <td class="num">${av}</td>
    </tr>`;
  };
  const meta = [
    report.weather ? `${report.weather.icon} ${report.weather.name}` : "",
    report.derby ? "馃敟 寰锋瘮" : "",
    report.bigMatch ? "猸?鐒︾偣" : "",
  ]
    .filter(Boolean)
    .join(" 路 ");

  // 杩涚悆鍒楄〃锛氬敖閲忎笌鏈満鍥炴斁缂撳瓨瀵归綈锛屽彲鐐瑰嚮鍐嶇湅
  let scorerGoalIdx = 0;
  const scorerHtml = (report.scorers || [])
    .map((s) => {
      const raw = String(s.text || "").replace(/^鈿絓s*/, "");
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
      .slice(0, 11)
      .map((x) => {
        const bits = [];
        if (x.goals) bits.push(`${x.goals}G`);
        if (x.assists) bits.push(`${x.assists}A`);
        if (x.saves) bits.push(`${x.saves}S`);
        const note = bits.length ? ` <span class="muted">${bits.join(" ")}</span>` : "";
        const name = x.playerId
          ? playerLinkHtml(x.playerId, x.name)
          : escapeHtml(x.name || "鈥?);
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
      <strong>${t("match.ratings") || "鐞冨憳璇勫垎"}</strong>
      <div class="report-ratings-grid">
        ${rateSideHtml(ratings.home, h.short || h.name)}
        ${rateSideHtml(ratings.away, a.short || a.name)}
      </div>
    </div>`;
  }

  // MOTM 澶у崱 + 鏂囧瓧澶嶇洏锛堢粡鐞嗗彲璇伙級
  let motmCardHtml = "";
  if (motm) {
    const bits = [];
    if (motm.goals) bits.push(`${motm.goals}G`);
    if (motm.assists) bits.push(`${motm.assists}A`);
    if (motm.saves) bits.push(`${motm.saves}S`);
    const note = bits.length ? bits.join(" 路 ") : motm.pos || "";
    const nameHtml = motm.playerId
      ? playerLinkHtml(motm.playerId, motm.name)
      : escapeHtml(motm.name || "鈥?);
    motmCardHtml = `<div class="report-motm-card">
      <div class="report-motm-label">${escapeHtml(t("match.motm") || "鏈満鏈€浣?)}</div>
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
        <strong>${escapeHtml(t("match.narrative") || "鏈満澶嶇洏")}</strong>
        <ul>${narrative.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
      </div>`
    : "";

  const reviewBadge = review
    ? `<span class="report-review-badge">${escapeHtml(t("fix.viewReport") || (getLang() === "en" ? "Archive" : "鍘嗗彶鎴樻姤"))}</span>`
    : "";

  el.innerHTML = `
    <h3>${t("match.report")}${reviewBadge}</h3>
    <div class="match-report-meta">${escapeHtml(t("match.reportMeta", { meta: meta || t("match.regular"), score: report.score }))}</div>
    ${motmCardHtml}
    ${narrativeHtml}
    <table class="report-table">
      <thead><tr>
        <th>${escapeHtml(h.short || h.name)}</th>
        <th>${t("match.stats")}</th>
        <th>${escapeHtml(a.short || a.name)}</th>
      </tr></thead>
      <tbody>
        ${row(t("match.xg"), h.xg, a.xg, true)}
        ${row(t("match.shots"), h.shots, a.shots, true)}
        ${row(t("match.shotsOn"), h.shotsOn, a.shotsOn, true)}
        ${row(t("match.poss"), h.possession, a.possession, true)}
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
      matchPlayback.goals.length
        ? `<p class="hint report-replay-hint">${escapeHtml(t("match.replayHint"))}</p>`
        : ""
    }
    ${ratingsHtml}
    ${formatRoleReviewHtml(matchState && !review ? buildRoleReview(matchState, { untilMinute: 90 }) : null)}
  `;
  el.classList.remove("hidden");

  // 瀹屽満锛氱悆鍦轰笂楂樹寒 MOTM
  if (motm && matchView?.highlightMotm) {
    matchView.highlightMotm(motm);
  }
}

/** 鎴樻姤鍐呰鑹插鐩?HTML */
function formatRoleReviewHtml(rev) {
  if (!rev) return "";
  const en = getLang() === "en";
  const tips = (rev.tips || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
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
        <td class="num">${bits.join(" ") || "鈥?}</td>
      </tr>`;
    })
    .join("");
  return `<div class="report-role-review">
    <strong>${escapeHtml(en ? "Role review" : "瑙掕壊澶嶇洏")}</strong>
    <span class="muted"> 路 ${escapeHtml(rev.formation || "")}</span>
    ${
      rows
        ? `<table class="report-ratings-table" style="margin-top:0.4rem"><tbody>${rows}</tbody></table>`
        : `<p class="muted" style="margin:0.35rem 0 0">${escapeHtml(
            en ? "No goal involvement from assigned roles." : "鏈満瑙掕壊鏈洿鎺ヨ础鐚繘鐞?鍔╂敾"
          )}</p>`
    }
    ${tips ? `<ul class="opp-tips">${tips}</ul>` : ""}
  </div>`;
}

function finishMatchUI() {
  setMatchBusy(false);
  $("#btn-match-continue").disabled = false;
  $("#btn-sim-fast").disabled = true;
  $("#btn-sim-live").disabled = true;
  const inst = $("#btn-sim-instant");
  if (inst) inst.disabled = true;
  hideHtPanel();
  setLiveTacBarVisible(false);
  // 瀹岃禌鍚庡叧闂殏鍋滄帶鍒讹紝淇濈暀杩涚悆鍥炵湅鍒楄〃
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
        ? "鈥?
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

/** 鍏抽敭姣旇禌浜嬩欢涓嫳鍒囨崲锛堝師鏂囦粛涓轰腑鏂囧紩鎿庝骇鍑猴紝EN 鍋氱畝鍗曟槧灏勶級 */
function localizeMatchEvent(ev) {
  if (!ev?.text) return "";
  if (getLang() !== "en") return ev.text;
  let s = ev.text;
  const map = [
    [/^姣旇禌寮€濮嬶紒$/, "Kick-off!"],
    [/^涓満浼戞伅/, "Half-time"],
    [/^鍏ㄥ満缁撴潫/, "Full-time"],
    [/^鎯呭锛?, "Context: "],
    [/^寰锋瘮澶ф垬/, "Derby"],
    [/^鐒︾偣鏉禌/, "Cup spotlight"],
    [/^鐒︾偣鎴?, "Big match"],
    [/^馃搵 璧涘墠绠€鎶?, "馃搵 Pre-match briefing"],
    [/^涓诲満/, "Home"],
    [/^瀹㈠満/, "Away"],
    [/^鍋滆禌锛?, "Suspended: "],
    [/^浼ょ梾锛?, "Injured: "],
    [/^榛勭墝杈圭紭锛?, "On yellow limit: "],
    [/^瀵规柟濞佽儊锛?, "Threats: "],
    [/^浜哄憳榻愬叏锛屾棤閲嶅ぇ缂洪樀$/, "Full squad available"],
    [/^馃挰 (\d+)' 鏁欑粌甯細/, "馃挰 $1' Coach: "],
    [/^钀藉悗锛屽彲鑰冭檻鍔犲己鍘嬭揩鎴栨崲杩涙敾鐐?, "Trailing 鈥?press higher or bring attackers"],
    [/^棰嗗厛锛屾敞鎰忔帶鍦轰笌浣撹兘鍒嗛厤/, "Leading 鈥?manage tempo and fitness"],
    [/^鍍垫寔涓紝鍙井璋冭妭濂忓鎵剧獊鐮?, "Stalemate 鈥?tweak tempo for a breakthrough"],
    [/^棣栧彂骞冲潎浣撹兘/, "XI avg fitness "],
    [/^鍚嶄富鍔涗綋鑳藉憡鎬ワ紝寤鸿鎹汉/, " starters low on fitness 鈥?consider subs"],
    [/^姣斿垎鑳剁潃锛屾渶鍚?15 鍒嗛挓鏄叧閿獥鍙?, "Tight score 鈥?last 15 is decisive"],
    [/^浠呰惤鍚?1 鐞冿紝鍙啋闄╁帇涓?, "One goal down 鈥?risk going forward"],
    [/^瀹堜綇浼樺娍锛屽埆鎬ヤ簬鍐掕繘/, "Protect the lead 鈥?don't overcommit"],
    [/^鑰冭檻杞崲/, "consider rotation"],
    [/^馃搵 涓満璋冩暣锛?, "馃搵 HT tweak: "],
    [/^涓ら粍鍙樹竴绾?, "Second yellow 鈫?red"],
    [/^绾㈢墝/, "Red card"],
    [/^鍋滆禌/, "suspended"],
    [/^璧涘榛勭墝/, "season yellows"],
  ];
  for (const [re, rep] of map) {
    s = s.replace(re, rep);
  }
  return s;
}

function renderCareer() {
  const el = $("#career-panel");
  if (!el || !world) return;
  const mc = ensureManagerCareer(world);
  const club = getUserClub(world);
  ensureClubHonors(club);
  const wr = managerWinRate(mc);
  const trophies = (mc.trophies || [])
    .slice(0, 12)
    .map(
      (h) =>
        `<div class="honor-item"><div class="season">${h.season}</div><strong>${escapeHtml(h.title)}</strong>${
          h.detail ? ` <span class="muted">${escapeHtml(h.detail)}</span>` : ""
        }</div>`
    )
    .join("");
  const clubHonors = (club.honors || [])
    .slice(0, 12)
    .map(
      (h) =>
        `<div class="honor-item"><div class="season">${h.season}</div><strong>${escapeHtml(h.title)}</strong>${
          h.detail ? ` <span class="muted">${escapeHtml(h.detail)}</span>` : ""
        }</div>`
    )
    .join("");
  el.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <h2 data-i18n="career.manager">${getLang() === "en" ? "Manager career" : "缁忕悊鐢熸动"}</h2>
        <p><strong>${escapeHtml(world.managerName)}</strong> 路 ${escapeHtml(club.name)}</p>
        <ul class="career-stats">
          <li>${getLang() === "en" ? "Seasons" : "鎵ф暀璧涘"}锛?{mc.seasons}</li>
          <li>${getLang() === "en" ? "Record" : "鎴樼哗"}锛?{mc.wins}W ${mc.draws}D ${mc.losses}L锛?{mc.matches}锛壜?${wr}%</li>
          <li>GF/GA锛?{mc.goalsFor || 0} / ${mc.goalsAgainst || 0}</li>
          <li>${getLang() === "en" ? "Titles / promos / cups" : "鍐犲啗 / 鍗囩骇 / 鏉禌"}锛?{mc.titles} / ${mc.promotions} / ${mc.cups}</li>
          <li>${getLang() === "en" ? "Sacked" : "琚В闆?}锛?{mc.sacked}</li>
          <li>${
            mc.bestFinish
              ? `${getLang() === "en" ? "Best" : "鏈€浣?}锛?{mc.bestFinish.season} ${escapeHtml(mc.bestFinish.divName)} #${mc.bestFinish.pos}`
              : getLang() === "en"
                ? "Best finish: 鈥?
                : "鏈€浣冲悕娆★細鈥?
          }</li>
        </ul>
        <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">${getLang() === "en" ? "Trophy cabinet" : "鑽ｈ獕鏌?}</h3>
        <div class="honor-list">${trophies || `<p class="muted">${getLang() === "en" ? "No trophies yet" : "鏆傛棤濂栨澂"}</p>`}</div>
      </div>
      <div class="card">
        <h2 data-i18n="career.club">${getLang() === "en" ? "Club honours" : "淇变箰閮ㄨ崳瑾夊"}</h2>
        <div class="honor-list">${clubHonors || `<p class="muted">${getLang() === "en" ? "Win a title or promote to fill the wall" : "澶哄啝鎴栧崌绾у悗鍐欏叆姝ゅ"}</p>`}</div>
      </div>
    </div>
  `;
}

function maybeShowSeasonSummary() {
  if (!world?.lastSeasonSummary || !world.seasonOver) return;
  if (world._summaryShownSeason === world.lastSeasonSummary.season) return;
  const s = world.lastSeasonSummary;
  const overlay = $("#season-summary");
  if (!overlay) return;
  world._summaryShownSeason = s.season;
  const trop = (s.trophies || [])
    .map((t) => `<li>${escapeHtml(t.title)}${t.detail ? ` 路 ${escapeHtml(t.detail)}` : ""}</li>`)
    .join("");
  overlay.innerHTML = `
    <div class="season-summary-card">
      <h2>馃弳 ${s.season} ${getLang() === "en" ? "Season review" : "璧涘缁撶畻"}</h2>
      <p class="muted">${escapeHtml(s.clubName)} 路 ${escapeHtml(s.divName)}</p>
      <p style="font-size:1.35rem;margin:0.5rem 0"><strong>#${s.pos}</strong> 路 ${s.pts} pts 路 ${s.w}W ${s.d}D ${s.l}L 路 ${s.gf}:${s.ga}</p>
      ${trop ? `<ul class="season-trop-list">${trop}</ul>` : `<p class="muted">${getLang() === "en" ? "No new silverware" : "鏈鏃犳柊濂栨澂"}</p>`}
      <p class="muted" style="margin-top:0.75rem">${getLang() === "en" ? "Career" : "鐢熸动"}锛?{s.career?.seasons || 0} seasons 路 ${s.career?.titles || 0} titles 路 ${s.career?.promotions || 0} promos</p>
      <button type="button" class="btn primary" id="btn-close-season-summary">${getLang() === "en" ? "Continue" : "缁х画"}</button>
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
          ? "Tip: export your save regularly 鈥?clearing cache wipes progress."
          : "鎻愰啋锛氬缓璁畾鏈熷鍑哄瓨妗ｏ紱娓呯紦瀛樹細涓㈠け杩涘害銆?;
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
  // 涓荤晫闈㈢敤涓存椂鎻愮ず
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

// ---------- Boot ----------
initPrefs();
window.addEventListener("vc-prefs-change", () => {
  fillClubSelect();
  refreshSlotUI();
  if (world) refreshAll();
});
initStart();

/**
 * 鍒锋柊椤甸潰鍚庤嚜鍔ㄨ妗ｏ細鏈夊綋鍓嶆Ы瀛樻。鍒欑洿鎺ヨ繘涓荤晫闈?
 * 锛堝惁鍒欐瘡娆″埛鏂伴兘浼氬仠鍦ㄥ紑濮嬮〉锛屽儚銆屾病璁颁綇杩涘害銆嶏級
 * URL 鍔??menu=1 鍙己鍒跺仠鍦ㄥ紑濮嬮〉锛堜緥濡傝鎹㈡。 / 瀵煎嚭锛?
 */
function tryAutoResume() {
  try {
    const params = new URLSearchParams(location.search || "");
    if (params.get("menu") === "1" || params.get("noload") === "1") return false;
    // session 鍐呬富鍔ㄥ洖鑿滃崟锛氬悓涓€浼氳瘽鍒锋柊浠嶈嚜鍔ㄨ锛涗粎褰撳甫 menu=1 鏃跺仠鑿滃崟
    const slot = getActiveSlot();
    if (!hasSave(slot)) return false;
    const data = loadGame(slot);
    if (!data) return false;
    world = data;
    migrateWorld(world);
    enterMain();
    // 杞绘彁绀猴紝閬垮厤璇互涓鸿繕鍦ㄧ櫥褰曢〉
    const msg =
      getLang() === "en"
        ? `Resumed slot ${slot}`
        : `宸茶嚜鍔ㄨ鍙栨Ы ${slot}`;
    // enterMain 鍚?start 灞忓凡闅愯棌锛宼oast 浠嶅彲鐢?
    setTimeout(() => toast(msg), 80);
    return true;
  } catch (err) {
    console.error("auto-resume failed", err);
    return false;
  }
}

tryAutoResume();


