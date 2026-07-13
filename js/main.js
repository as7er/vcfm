/** VCFM · UI 主逻辑 */

import {
  CLUB_TEMPLATES,
  FORMATIONS,
  POS_LABEL,
  NATIONALITIES,
  DIVISIONS,
  START_DIVISION,
  playerDisplaySurname,
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
  return "—";
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
  assignSquadNumbers,
  kitBackground,
  ensurePlayerNumber,
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
  buildScoutReport,
  formatScoutReportHtml,
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
} from "./avatar.js";

/** 解雇后回菜单：优先提示换空槽开新档，避免误覆盖 */
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
  const reason = result.msg || result.sackedResult?.msg || world?.sackedReason || "你已被董事会解雇。";
  const tip = pick
    ? `\n\n已自动选中空槽 ${pick} 方便开新档。\n解雇存档仍在槽 ${slot}（可读取回顾）。`
    : `\n\n三个槽都有存档。开新档会覆盖「当前槽」——建议先选一个不心疼的槽，或先导出备份。\n解雇记录在槽 ${slot}。`;
  alert(reason + tip);
  showScreen("start");
  refreshSlotUI();
  $("#start-hint").textContent = pick
    ? `已被解雇。新档将写入槽 ${pick}；槽 ${slot} 保留解雇存档。`
    : `已被解雇（槽 ${slot}）。请选择要覆盖的槽后开新赛季，或先导出。`;
  world = null;
  return true;
}

let world = null;
let pendingMatch = null;
let liveRunning = false;
/** @type {import('./match.js').createMatchSession extends Function ? any : any} */
let matchState = null;
let pendingSubs = []; // 中场待确认换人 {outId, inId, outName, inName}
/** @type {import('./matchview.js').MatchView | null} */
let matchView = null;

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
    // 暂停中 或 逐事件等待时，可点「下一步」
    stepBtn.disabled = !en || (!matchPlayback.paused && !matchPlayback.waitingStep && !matchPlayback.stepMode);
    stepBtn.classList.toggle("active", matchPlayback.waitingStep);
  }
  if (modeBtn) {
    modeBtn.classList.toggle("active", matchPlayback.stepMode);
    modeBtn.setAttribute("aria-pressed", matchPlayback.stepMode ? "true" : "false");
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
  btn.textContent = muted
    ? getLang() === "en"
      ? "SFX off"
      : "静音"
    : t("match.sfx") || (getLang() === "en" ? "SFX" : "音效");
}

/**
 * @param {object} ev
 * @param {object} [snap]
 * @param {object} [fixture]
 * @param {object|null} [scene] 进球瞬间场面（回看还原用）
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
  try {
    ensureMatchPitch();
    const spd = Math.max(0.25, Number(matchSpeed) || 1);
    // 回看时略慢一点更好看；有场面快照则从同一帧接续
    await matchView.playGoalHighlight(item.ev, item.snap, item.fixture, {
      speed: Math.min(spd, 1),
      lang: getLang(),
      sleepFn: sleepPlayback,
      rewatch: true,
      scene: item.scene || null,
    });
  } catch (err) {
    console.error(err);
    toast(getLang() === "en" ? "Replay failed" : "回放失败");
  } finally {
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
/** 导出提醒：上次导出时间戳 */
const EXPORT_TIP_KEY = "vcfm-last-export";
const OLD_EXPORT_TIP_KEY = "vc-fm-last-export";

/** 自动存档（静默，失败仅 console） */
function autosave(msg) {
  if (!world) return false;
  const ok = saveGame(world);
  if (!ok) console.warn("autosave failed", msg || "");
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
          : `槽 ${n}：${info.clubName || "—"} · S${info.season ?? "?"} D${info.day ?? "?"}`;
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
      mediaSeasonKickoff(world, u, DIVISIONS[u.division || 3]?.name || "乙级联赛");
      ensureBoardObjective(world);
      ensureTransferWindow(world);
      processTransferWindowDay(world);
      ensureManagerCareer(world);
      saveGame(world, slot);
      enterMain();
    } catch (err) {
      console.error(err);
      const msg = err?.message || String(err);
      $("#start-hint").textContent = getLang() === "en" ? `Failed to start: ${msg}` : `开局失败：${msg}`;
      toast(getLang() === "en" ? `Start failed: ${msg}` : `开局失败：${msg}`);
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

/** 旧存档 / 缺字段兼容 */
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
  // 旧档若不足三级结构，提示开新档体验完整升降级
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const c of w.clubs || []) counts[c.division || 3]++;
  if (counts[1] < 4 || counts[2] < 4 || counts[3] < 4) {
    // 仍可玩，但升降级可能跳过
    console.warn("存档联赛结构不完整，建议开新档体验三级联赛");
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

  // FMM：xG / 控球 / 射门 折叠
  $("#btn-match-stats-toggle")?.addEventListener("click", () => toggleMatchStatsPanel());

  // 暂停 / 下一步 / 逐事件
  $("#btn-match-pause")?.addEventListener("click", () => toggleMatchPause());
  $("#btn-match-sfx")?.addEventListener("click", () => toggleMatchSfx());
  $("#btn-match-step")?.addEventListener("click", () => requestMatchStep());
  $("#btn-match-step-mode")?.addEventListener("click", () => toggleMatchStepMode());

  // 事件流 / 赛后报告：点进球再看回放
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
    .map((k) => `<option value="${k}">${FORMATIONS[k].name}</option>`)
    .join("");

  formSel.onchange = () => {
    const club = getUserClub(world);
    club.tactics.formation = formSel.value;
    autoLineup(club);
    renderTactics();
  };

  $("#style-select").onchange = (e) => {
    getUserClub(world).tactics.style = e.target.value;
  };

  $("#pressing").oninput = (e) => {
    getUserClub(world).tactics.pressing = +e.target.value;
    $("#pressing-val").textContent = e.target.value;
  };
  $("#tempo").oninput = (e) => {
    getUserClub(world).tactics.tempo = +e.target.value;
    $("#tempo-val").textContent = e.target.value;
  };

  $("#btn-auto-xi").onclick = () => {
    autoLineup(getUserClub(world));
    renderTactics();
    renderSquad();
    toast(t("toast.autoXi"));
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
    refreshStaffMarket(world);
    // 刷新费
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

  // 积分榜 / 赛程 / 数据榜等：点击队名打开俱乐部详情
  document.body.addEventListener("click", (e) => {
    if (!world) return;
    const clubLink = e.target.closest("[data-club-link]");
    if (clubLink) {
      e.preventDefault();
      showClubModal(clubLink.dataset.clubLink);
      return;
    }
    // 任意界面：点击球员名打开资料
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
    // 恢复按钮文案（回顾时改成了「返回俱乐部」）
    const cont = $("#btn-match-continue");
    if (cont) cont.textContent = t("match.continue");
    showScreen("main");
    pendingMatch = null;
    matchState = null;
    pendingSubs = [];
    refreshAll();
    if (wasReview) {
      // 回到赛程页，方便连续回看
      const tabBtn = document.querySelector('[data-tab="fixtures"]');
      if (tabBtn) tabBtn.click();
    }
  };

  // 赛程：点击「战报」打开旧场回看
  $("#fixtures-table")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".fix-report-btn");
    if (!btn) return;
    e.preventDefault();
    openPastMatchReport(btn.dataset.fixtureKey);
  });

  // 中场调整
  const htPress = $("#ht-pressing");
  const htTempo = $("#ht-tempo");
  if (htPress) {
    htPress.oninput = () => {
      $("#ht-pressing-val").textContent = htPress.value;
    };
  }
  if (htTempo) {
    htTempo.oninput = () => {
      $("#ht-tempo-val").textContent = htTempo.value;
    };
  }
  $("#btn-ht-add-sub")?.addEventListener("click", () => onHtAddSub());
  $("#btn-ht-continue")?.addEventListener("click", () => finishHalfTime(true));
  $("#btn-ht-skip")?.addEventListener("click", () => finishHalfTime(false));
  $("#btn-live-tac-apply")?.addEventListener("click", () => onLiveTacApply());
  $("#live-pressing")?.addEventListener("input", (e) => {
    const el = $("#live-pressing-val");
    if (el) el.textContent = e.target.value;
  });
  $("#live-tempo")?.addEventListener("input", (e) => {
    const el = $("#live-tempo-val");
    if (el) el.textContent = e.target.value;
  });
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
  renderTransfer();
  renderFixtures();
  renderCareer();
  maybeShowSeasonSummary();
  checkExportReminder();
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
        toast(`训练重点：${TRAINING_FOCUSES[btn.dataset.focus].label}`);
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
        toast(`训练强度：${TRAINING_INTENSITIES[btn.dataset.intensity].label}`);
      };
    });
  }

  const sumEl = $("#training-summary");
  if (sumEl) {
    const coach = club.staff?.coach;
    const coachTxt = coach ? `教练 ${coach.name}（${coach.rating}）` : "教练 —";
    sumEl.innerHTML = `<strong>当前：</strong>${escapeHtml(sum.line)}<br>
      <span class="muted">${escapeHtml(sum.desc)}</span><br>
      <span class="muted">${escapeHtml(coachTxt)} · 每周结算属性成长 · 每日影响体能与伤病风险</span>`;
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
          const tag = p.injured > 0 ? " 伤" : "";
          return `<div class="training-fit-row${lowCls}">
            <span>${playerLinkHtml(p.id, playerDisplaySurname(p.name, p.nationality) + tag)}</span>
            <div class="bar"><i style="width:${fit}%"></i></div>
            <span class="fit-val">${fit}%</span>
          </div>`;
        })
        .join("") || `<span class="muted">暂无球员</span>`;
  }

  const hint = $("#training-hint");
  if (hint) {
    let tip = `平均体能 ${avg}% · 伤病 ${injured} 人 · 低体能 ${low} 人。`;
    if (avg < 70) tip += " 建议改「恢复调整」或「轻松」强度。";
    else if (t.intensity === "hard" && avg < 80) tip += " 高强度下体能偏紧，小心训练伤。";
    else if (t.focus === "youth") tip += " 青训侧重时本周青训成长加快，一线队成长偏慢。";
    else tip += " 比赛日前可切「赛前准备」。";
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
        <div class="meta">能力 <strong class="${ovrClass(s.rating)}">${s.rating}</strong> · ${s.age} 岁</div>
        <div class="meta">周薪 ${formatMoney(s.wage)}</div>
        <p class="hint" style="margin:0.4rem 0">${meta.effect}</p>
        <button class="btn small danger" data-fire="${role}">解约</button>
      </div>`;
    })
    .join("");

  box.querySelectorAll("[data-fire]").forEach((btn) => {
    btn.onclick = () => {
      if (!confirm("解约需支付约 4 周薪水作为补偿，确认？")) return;
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
        <td><button class="btn small primary" data-hire="${s.id}">聘请</button></td>
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
              <span>${escapeHtml(a.outlet || "媒体")}</span>
              <span>S${a.season || world.season} · D${a.day ?? "—"}</span>
            </div>
            <h3>${escapeHtml(a.headline)}</h3>
            <p class="body">${escapeHtml(a.body || "")}</p>
          </article>`;
        })
        .join("")
    : `<p class="muted">暂无报道。比赛、转会、推进日程后会出现媒体内容。</p>`;
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
  const kit = ensureKit(club);
  $("#club-name").innerHTML = `<span class="kit-chip" style="${kitBadgeStyle(club)}" title="${kit.style}"></span> ${escapeHtml(club.name)}`;
  const mgrAv = avatarHtml(
    { id: `mgr_${world.userClubId}_${world.managerName}`, name: world.managerName, age: 42 },
    { role: "manager", size: 28 }
  );
  $("#manager-name").innerHTML = `${mgrAv} <span>${escapeHtml(world.managerName)} · ${div?.short || "乙级"}</span>`;
  $("#season-label").textContent = t("top.season", { n: world.season });
  const tw = transferWindowShort(world);
  $("#date-label").textContent = `${t("top.day", { n: world.day })} · ${tw}`;
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
      <div><strong>${world.season} 赛季已结束</strong></div>
      <div class="muted" style="margin-top:0.4rem">
        当前联赛：${divName}<br/>
        已处理年龄 / 退役 / 升降级。进入下一赛季将按新级别生成赛程。
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
      <div><strong>${next.competition === "cup" ? next.roundLabel || "杯赛" : `第 ${next.round} 轮`}</strong> · 第 ${next.day} 天 · ${next.home === club.id ? "主场" : "客场"}</div>
      <div style="margin-top:0.4rem;font-size:1.25rem">
        ${clubLinkHtml(home.id, home.name)} <span class="muted">vs</span> ${clubLinkHtml(away.id, away.name)}
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

  // 经理生涯摘要
  const careerBox = $("#manager-career-dash");
  if (careerBox) {
    const mc = ensureManagerCareer(world);
    const wr = managerWinRate(mc);
    careerBox.innerHTML = `
      <div><strong>${escapeHtml(world.managerName)}</strong> · ${mc.seasons} 赛季 · ${mc.matches} 场</div>
      <div class="muted" style="margin-top:0.25rem">${mc.wins}胜 ${mc.draws}平 ${mc.losses}负 · 胜率 ${wr}%</div>
      <div class="muted">${mc.titles} 冠 · ${mc.promotions} 次升级 · ${mc.cups} 杯 · 解雇 ${mc.sacked}</div>
      ${
        mc.bestFinish
          ? `<div class="muted">最佳：${mc.bestFinish.season} ${escapeHtml(mc.bestFinish.divName)} 第 ${mc.bestFinish.pos}</div>`
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
      ? "（前 3 名升级甲级）"
      : userDiv === 2
        ? "（前 3 升超联 · 后 3 降乙级）"
        : "（后 3 名降甲级）";
  $("#my-rank").textContent = `${divName} 第 ${pos} 名 · ${row.pts} 分（${row.w}胜 ${row.d}平 ${row.l}负）${promoHint}`;

  // 当前训练（概览一眼可见）
  const trainDash = document.querySelector("#training-dash");
  if (trainDash) {
    trainDash.textContent = trainingSummary(club).line + t("dash.trainHint");
  }
  // 设施摘要
  let facDash = document.querySelector("#facilities-dash");
  if (!facDash) {
    const trainEl = document.querySelector("#training-dash");
    if (trainEl && trainEl.parentElement) {
      const h = document.createElement("h3");
      h.textContent = "俱乐部设施";
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

  // 转会窗
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
      const warn = !b.settled && (b.sackWarnings || 0) > 0 ? ` 警告${b.sackWarnings}/3` : "";
      boardEl.textContent =
        boardStatusLine(b) +
        (b.settled || b.sacked ? "" : ` · 现第${pos}/目标${b.targetPos} · ${played}场${warn}`);
    }
  }
  $("#news-list").innerHTML = world.news
    .slice(0, 12)
    .map((n) => `<li><strong>D${n.day}</strong> ${escapeHtml(n.text)}</li>`)
    .join("") || "<li>暂无新闻</li>";
}

function ovrClass(n) {
  if (n >= 15) return "stat-high";
  if (n >= 11) return "stat-mid";
  return "stat-low";
}

function renderSquad() {
  const club = getUserClub(world);
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
      const num = p.number != null ? p.number : "—";
      const statusBadges = [
        xi.has(p.id) ? '<span class="badge">首发</span>' : "",
        p.loan ? `<span class="badge loan" title="${escapeHtml(t("contract.loanIn") || "租借")}">${escapeHtml(t("contract.loanIn") || "租借")}</span>` : "",
        p.injured > 0 ? '<span class="badge ATT">伤</span>' : "",
        (p.suspendedMatches || 0) > 0
          ? `<span class="badge ATT" title="停赛">停${p.suspendedMatches}</span>`
          : "",
        (p.yellowsSeason || 0) >= 4 && !(p.suspendedMatches > 0)
          ? `<span class="badge" style="background:#e6b450;color:#111" title="累计黄牌">黄${p.yellowsSeason}</span>`
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
          : `${p.contractYears ?? "—"}年`;
      return `<tr class="${xi.has(p.id) ? "me" : ""} ${!isAvailable(p) ? "row-unavailable" : ""} ${needsContractAttention(p) && !p.loan ? "row-contract" : ""}">
        <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(club)}">${num}</span></td>
        <td class="name-with-avatar">${playerAvatarHtml(p, club, 30)} <span>${playerLinkHtml(p.id, p.name)} ${statusBadges}</span></td>
        <td>${nationLabel(p)}</td>
        <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
        <td>${p.age}</td>
        <td class="${ovrClass(ovr)}"><strong>${ovr}</strong></td>
        <td class="num-stat" title="${escapeHtml(t("squad.appsTitle") || "本赛季出场")}">${apps}</td>
        <td class="num-stat ${gCls}" title="${escapeHtml(gTitle)}">${colG}</td>
        <td class="num-stat ${aCls}" title="${escapeHtml(aTitle)}">${colA}</td>
        <td class="num-stat rating-cell ${ratingClass(avgR)}" title="${escapeHtml(t("squad.avgRTitle") || "本赛季场均评分")}">${formatRating(avgR)}</td>
        <td class="num-stat rating-cell ${ratingClass(lastR)}" title="${escapeHtml(t("squad.lastRTitle") || "最近一场评分")}">${formatRating(lastR)}</td>
        <td>${p.fitness}%</td>
        <td>${p.morale}</td>
        <td class="contract-cell">${contractCell}</td>
        <td>${formatMoney(p.value)}</td>
        <td>${formatMoney(p.wage)}</td>
        <td><button class="btn small" data-pid="${p.id}">详情</button></td>
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
  // 退役球员历史（若之后 UI 引用）
  if (!player && world.retiredPlayers) {
    player = world.retiredPlayers.find((p) => p.id === playerId);
  }
  if (!player) return;

  const a = player.attrs;
  const rows = [
    ["速度", a.pace],
    ["射门", a.shooting],
    ["传球", a.passing],
    ["盘带", a.dribbling],
    ["防守", a.defending],
    ["身体", a.physical],
    ["终结", a.finishing],
    ["抢断", a.tackling],
    ["盯人", a.marking],
    ["力量", a.strength],
    ["体能", a.stamina],
    ["视野", a.vision],
  ];
  if (player.pos === "GK") {
    rows.push(
      ["反应", a.reflexes],
      ["手控", a.handling],
      ["站位", a.positioning],
      ["开球", a.kicking]
    );
  }

  const pot = player.potential != null ? player.potential : "—";
  ensurePlayerHistory(player);
  ensureIntl(player);
  ensureHonors(player);
  const season = playerStats(player);
  const career = careerStats(player);
  const intl = player.intl || {};
  const isGk = player.pos === "GK";

  // 分赛季历史 + 当前未归档赛季
  const curAvgR = seasonAvgRating(player);
  const historyRows = [...(player.history || [])]
    .sort((a, b) => b.season - a.season)
    .map(
      (h) => `<tr>
        <td>${h.season}</td>
        <td>${escapeHtml(h.clubName || "—")}</td>
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
    ? `<th>赛季</th><th>球队</th><th>出场</th><th>零封</th><th>失球</th><th>场均</th>`
    : `<th>赛季</th><th>球队</th><th>出场</th><th>进球</th><th>助攻</th><th>场均</th>`;

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
    : `<p class="muted" style="margin:0">暂无荣誉，赛季末金靴/助攻王/最佳阵容/冠军等会写入此处</p>`;

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
      · ${nationLabel(player)}
      · ${player.age} 岁 · 能力 <strong class="${ovrClass(player.ovr)}">${player.ovr}</strong>
      · 潜力 <strong>${pot}</strong>
      ${player.fromYouth ? ' · <span class="badge MID">青训</span>' : ""}
      ${fromOther ? ` · ${escapeHtml(fromOther.name)}` : ""}
    </p>
      </div>
    </div>
    <p>身价 ${fromOther ? formatScoutValue(world, player) : formatMoney(player.value)} · 周薪 ${formatMoney(player.wage)} · 体能 ${player.fitness}% · 士气 ${player.morale}
      ${
        (player.suspendedMatches || 0) > 0
          ? ` · <span class="badge ATT">停赛 ${player.suspendedMatches} 场</span>`
          : ""
      }
      ${
        (player.yellowsSeason || 0) > 0
          ? ` · 赛季黄牌 ${player.yellowsSeason}`
          : ""
      }
      ${
        player.loan
          ? ` · <span class="badge loan">${escapeHtml(t("contract.loanIn") || "租借")}</span>`
          : player.contractYears != null
            ? ` · 合同 ${player.contractYears} 年`
            : ""
      }
      ${player._needsRenew ? ` · <span class="badge contract-urgent">${escapeHtml(t("contract.needsRenew") || "待续约")}</span>` : ""}
    </p>
    ${
      fromOther
        ? formatScoutReportHtml(buildScoutReport(world, player, getUserClub(world)), formatMoney)
        : ""
    }
    ${renderPlayerContractActions(player, fromOther)}

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">本赛季（俱乐部）</h3>
    <p class="muted" style="margin:0">出场 ${season.apps}
      ${
        isGk
          ? ` · 零封 ${season.cleanSheets} · 失球 ${season.goalsConceded}`
          : ` · 进球 ${season.goals} · 助攻 ${season.assists}`
      }
      · 场均 <strong class="${ratingClass(curAvgR)}">${formatRating(curAvgR)}</strong>
      ${
        season.lastRating != null
          ? ` · 最近 <strong class="${ratingClass(season.lastRating)}">${formatRating(season.lastRating)}</strong>`
          : ""
      }
    </p>

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">生涯总计（俱乐部）</h3>
    <p class="muted" style="margin:0">出场 ${career.apps}
      ${
        isGk
          ? ` · 零封 ${career.cleanSheets} · 失球 ${career.goalsConceded}`
          : ` · 进球 ${career.goals} · 助攻 ${career.assists}`
      }
      <span style="opacity:0.7">（含本赛季）</span>
    </p>

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">国家队</h3>
    <p class="muted" style="margin:0">
      ${nationLabel(player)} · 出场（Caps） <strong>${intl.caps || 0}</strong>
      ${
        isGk
          ? ` · 零封 ${intl.cleanSheets || 0} · 失球 ${intl.goalsConceded || 0}`
          : ` · 进球 ${intl.goals || 0} · 助攻 ${intl.assists || 0}`
      }
    </p>
    <p class="hint" style="margin:0.25rem 0 0">约每 30 天国际比赛日，优秀球员可能入选并累积数据</p>

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">个人荣誉</h3>
    ${honorHtml}

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">分赛季历史</h3>
    <div class="table-wrap">
      <table style="font-size:0.85rem">
        <thead><tr>${histHead}</tr></thead>
        <tbody>
          ${
            historyRows.length
              ? historyRows.join("")
              : `<tr><td colspan="5" class="muted">暂无历史，完赛并进入下一赛季后归档</td></tr>`
          }
        </tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:0.35rem">* 表示当前赛季（尚未归档）</p>

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">属性</h3>
    <div class="attrs">
      ${rows
        .map(
          ([name, val]) => `
        <div class="attr-row">
          <span>${name}</span>
          <span class="${ovrClass(val)}">${val}</span>
        </div>
        <div class="bar"><i style="width:${(val / 20) * 100}%"></i></div>
      `
        )
        .join("")}
    </div>
  `;
  $("#modal").classList.remove("hidden");
  bindPlayerContractActions(player, fromOther);
}

/**
 * 本队球员：续约 / 解约 / 外租；他人：租入（窗内）
 */
function renderPlayerContractActions(player, fromOther) {
  if (!player || world?.sacked) return "";
  const en = getLang() === "en";
  const open = isTransferWindowOpen(world);

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
      <button type="button" class="btn small primary" data-act-renew="${player.id}">${escapeHtml(t("contract.renew") || (en ? "Renew" : "续约"))}</button>
      <button type="button" class="btn small danger" data-act-terminate="${player.id}">${escapeHtml(t("contract.terminate") || (en ? "Release" : "解约"))}</button>
      <button type="button" class="btn small" data-act-loan-out="${player.id}" ${!open ? "disabled" : ""}>${escapeHtml(t("contract.loanOut") || (en ? "Loan out" : "外租"))}${!open ? (en ? " (window closed)" : "（窗关）") : ""}</button>
    </div>`;
  }

  // 他队：可租入
  if (fromOther && !player.loan) {
    return `<div class="contract-actions">
      <button type="button" class="btn small" data-act-loan-in="${player.id}" data-from="${fromOther.id}" ${!open ? "disabled" : ""}>${escapeHtml(t("contract.loanInBtn") || (en ? "Loan in" : "租入"))}${!open ? (en ? " (window closed)" : "（窗关）") : ""}</button>
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
  if (
    !confirm(
      getLang() === "en"
        ? `Renew ${final.player.name}?\n${years} years · wage ${formatMoney(final.offer.newWage)} · bonus ${formatMoney(final.offer.fee)}`
        : `确认与 ${final.player.name} 续约？\n${years} 年 · 周薪 ${formatMoney(final.offer.newWage)} · 签约奖 ${formatMoney(final.offer.fee)}`
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
  if (
    !confirm(
      en
        ? `Loan out ${prev.player.name}?\nFee ~${formatMoney(prev.fee)} · host pays ~${Math.round(prev.wageShare * 100)}% wages · until ${prev.untilDay >= 9999 ? "EOS" : "D" + prev.untilDay}`
        : `确认外租 ${prev.player.name}？\n租借费约 ${formatMoney(prev.fee)} · 对方承担约 ${Math.round(prev.wageShare * 100)}% 薪水 · 至 ${prev.untilDay >= 9999 ? "赛季末" : "D" + prev.untilDay}`
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
  if (
    !confirm(
      en
        ? `Loan in ${prev.player.name} from ${prev.from?.short || ""}?\nFee ${formatMoney(prev.fee)} · you pay ~${Math.round(prev.wageShare * 100)}% wages`
        : `确认租入 ${prev.player.name}（${prev.from?.short || ""}）？\n租借费 ${formatMoney(prev.fee)} · 我方约承担 ${Math.round(prev.wageShare * 100)}% 薪水`
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
        : "确认召回该球员？（转会窗外需支付召回费）"
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
      icon: "🏟️",
      info: stadiumInfo(club),
      effect: (i) =>
        `容量约 ${i.capacity.toLocaleString()} · 主场收入约 ${formatMoney(i.matchday)}/场 · 周维护 ${formatMoney(i.upkeep)}`,
      nextEffect: (lv) => {
        const n = STADIUM_LEVELS[lv];
        return n
          ? `→ 容量 ${n.capacity.toLocaleString()} · 收入约 ${formatMoney(n.matchday)}`
          : "";
      },
    },
    {
      kind: "training",
      icon: "🏋️",
      info: trainingFacilityInfo(club),
      effect: (i) =>
        `成长+${Math.round((i.growth || 0) * 1000) / 10}% · 恢复+${i.heal} · 伤病×${i.injuryMod} · 周维护 ${formatMoney(i.upkeep)}`,
      nextEffect: (lv) => {
        const n = TRAINING_FACILITY_LEVELS[lv];
        return n ? `→ 成长+${Math.round(n.growth * 1000) / 10}% · 恢复+${n.heal}` : "";
      },
    },
    {
      kind: "youth",
      icon: "🌱",
      info: youthFacilityInfo(club),
      effect: (i) =>
        `容量 ${i.capacity} · 招生 ${i.intake}/期 · 成长 ${i.growth} · 周维护 ${formatMoney(i.upkeep)}`,
      nextEffect: (lv) => {
        const n = YOUTH_LEVELS[lv];
        return n ? `→ ${n.name} · 容量 ${n.capacity} · 招生 ${n.intake}` : "";
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
          <p class="hint" style="margin:0.4rem 0 0">目标 Lv.${proj.to} ${escapeHtml(proj.name)}</p>`;
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
        <div class="facility-level">Lv.${lv} · ${escapeHtml(info.name)}</div>
        <p class="facility-effect">${escapeHtml(effect(info))}</p>
        ${action}
      </div>`;
    })
    .join("");

  const hint = $("#facilities-hint");
  if (hint) {
    hint.textContent =
      facilitySummaryLine(club) +
      " · 主场比赛自动收门票；训练等级影响日常训练与伤病。";
  }
}

function renderYouth() {
  const club = getUserClub(world);
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
    <div><strong>Lv.${ya.level}</strong> ${cfg.name}</div>
    <div class="muted">容量 ${ya.players.length}/${cfg.capacity} · 每期招生 ${cfg.intake} 人</div>
    <div class="muted">周维护费 ${formatMoney(cfg.upkeep)} · 下次招生约 ${daysLeft} 天</div>
    ${
      building
        ? `<div class="muted">🚧 升级施工中 · 约第 ${proj.finishDay} 天完工</div>`
        : ""
    }
  `;

  const upBtn = $("#btn-youth-upgrade");
  if (ya.level >= 5) {
    upBtn.disabled = true;
    upBtn.textContent = "已满级";
    $("#youth-hint").textContent = "学院已是世界级，专心培养好苗子吧。也可在「设施」页查看球场与训练。";
  } else if (building) {
    upBtn.disabled = true;
    const left = Math.max(0, proj.finishDay - world.day);
    upBtn.textContent = `施工中（${left} 天）`;
    $("#youth-hint").textContent = `正在升级至 Lv.${proj.to} ${proj.name}，完工后自动生效。`;
  } else {
    upBtn.disabled = false;
    upBtn.textContent = `升级至 Lv.${nextLv}（${formatMoney(nextCost)} · 有工期）`;
    $("#youth-hint").textContent = `下级：${YOUTH_LEVELS[nextLv].name} · 容量 ${YOUTH_LEVELS[nextLv].capacity} · 成长更快（「设施」页可一并管理球场/训练）`;
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
            <td class="name-with-avatar">${playerAvatarHtml(p, club, 28)} <span>${playerLinkHtml(p.id, p.name)}</span></td>
            <td>${nationLabel(p)}</td>
            <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
            <td>${p.age}</td>
            <td class="${ovrClass(p.ovr)}"><strong>${p.ovr}</strong></td>
            <td class="${potClass}"><strong>${pot}</strong></td>
            <td>${formatMoney(p.wage)}</td>
            <td>
              <button class="btn small" data-player-link="${p.id}">详情</button>
              <button class="btn small primary" data-promote="${p.id}">提拔</button>
              <button class="btn small danger" data-release="${p.id}">释放</button>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="9" class="muted">暂无青训球员，推进日程等待招生</td></tr>`;

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
      if (!confirm("确认释放该青训球员？")) return;
      const res = releaseYouth(world, world.userClubId, btn.dataset.release);
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });
}

function renderTactics() {
  const club = getUserClub(world);
  const t = club.tactics;
  $("#formation-select").value = t.formation;
  $("#style-select").value = t.style;
  $("#pressing").value = t.pressing;
  $("#tempo").value = t.tempo;
  $("#pressing-val").textContent = t.pressing;
  $("#tempo-val").textContent = t.tempo;

  if (!t.lineup?.length) autoLineup(club);
  const formation = FORMATIONS[t.formation] || FORMATIONS["4-3-3"];
  const players = getLineupPlayers(club);
  const pitch = $("#pitch");
  ensureKit(club);
  assignSquadNumbers(club);
  const kit = ensureKit(club);
  const kitBg = kitBackground(kit);
  const kitNc = kit.numberColor || "#fff";
  pitch.innerHTML = formation.slots
    .map((slot, i) => {
      const p = players[i];
      // 名牌：姓（中韩取首词，其余取末词）；球衣号用角标 + 名牌前缀
      const label = p ? playerDisplaySurname(p.name, p.nationality) : "?";
      const shirtNo = p && p.number != null ? p.number : null;
      const fallback = shirtNo != null ? shirtNo : p ? p.ovr : "-";
      const style = p
        ? `background:${kitBg};color:${kitNc};border-color:${kit.primary || "#fff"}`
        : "";
      const av = p ? playerAvatarHtml(p, club, 22) : "";
      const full = p ? `${shirtNo != null ? `#${shirtNo} ` : ""}${p.name}` : "";
      const badge =
        shirtNo != null
          ? `<span class="pitch-num" style="background:${kitBg};color:${kitNc};border-color:${kit.primary || "#fff"}">${shirtNo}</span>`
          : "";
      const nameText =
        shirtNo != null ? `#${shirtNo} ${label}` : label;
      const nameHtml = p
        ? playerLinkHtml(p.id, nameText, "pitch-player-link")
        : escapeHtml(nameText);
      return `<div class="player-dot${p ? " clickable-player" : ""}" style="left:${slot.x}%;top:${slot.y}%" title="${escapeHtml(full)}" ${p ? `data-player-link="${escapeHtml(p.id)}"` : ""}>
        <div class="circle kit-dot" style="${style}">${av || fallback}${badge}</div>
        <div class="name">${nameHtml}</div>
      </div>`;
    })
    .join("");
}

function closeModal() {
  $("#modal")?.classList.add("hidden");
  $("#modal-card")?.classList.remove("wide");
}

function clubLinkHtml(clubId, label, extraClass = "") {
  const name = label ?? world.clubs.find((c) => c.id === clubId)?.name ?? clubId;
  return `<button type="button" class="club-link ${extraClass}" data-club-link="${escapeHtml(clubId)}">${escapeHtml(name)}</button>`;
}

/** 可点击球员名 → showPlayerModal（全局 data-player-link 委托） */
function playerLinkHtml(playerId, label, extraClass = "") {
  if (!playerId) return escapeHtml(label ?? "—");
  return `<button type="button" class="player-link ${extraClass}" data-player-link="${escapeHtml(playerId)}">${escapeHtml(label ?? "?")}</button>`;
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

  // 各级积分榜排名缓存
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
              ${clubLinkHtml(c.id, c.name)}${me ? " ★" : ""}
            </td>
            <td>${escapeHtml(divName)}</td>
            <td>${info ? info.rank : "—"}</td>
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
    .map((p) => {
      const s = playerStats(p);
      const isGk = p.pos === "GK";
      return `<tr>
        <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(club)}">${p.number ?? "—"}</span></td>
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
    const score = f.played ? `${f.homeGoals} - ${f.awayGoals}` : "—";
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
        <h2 style="margin:0 0 0.25rem">${escapeHtml(club.name)}${me ? " ★" : ""}</h2>
        <p class="muted" style="margin:0">
          ${escapeHtml(divName)}
          ${rank ? ` · ${t("clubs.rank", { n: rank })}` : ""}
          · ${t("clubs.pts", { n: row.pts || 0 })}
          · ${escapeHtml(t("clubs.record", { w: row.w || 0, d: row.d || 0, l: row.l || 0 }))}
        </p>
        <p class="muted" style="margin:0.25rem 0 0">
          ${escapeHtml(t("clubs.money"))} ${formatMoney(club.money || 0)}
          · ${escapeHtml(t("clubs.squadAvg"))} <strong class="${ovrClass(avg)}">${avg}</strong>
          · ${escapeHtml(t("clubs.power"))} ${club.power ?? "—"}
          · ${escapeHtml(t("tac.formation"))} ${escapeHtml(formation)} · ${escapeHtml(styleLabel)}
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
  // 默认显示自己所在联赛
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
  if (div === 1) hint = `20 支球队 · 后 ${info.relegate} 名降入甲级联赛`;
  else if (div === 2) hint = `20 支球队 · 前 ${info.promote} 名升超级联赛 · 后 ${info.relegate} 名降乙级联赛`;
  else hint = `20 支球队 · 前 ${info.promote} 名升甲级联赛`;
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
          if (upN && rank <= upN) zone = ' <span class="badge MID">升级区</span>';
          if (downN && rank > n - downN) zone = ' <span class="badge ATT">降级区</span>';
          return `<tr class="${me ? "me" : ""}">
            <td>${rank}</td>
            <td>${clubLinkHtml(r.id, r.name)}${me ? " ★" : ""}${zone}</td>
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
    : `<tr><td colspan="10" class="muted">该级别暂无球队（请开新档体验完整三级联赛）</td></tr>`;
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
    : `<tr><td colspan="7" class="muted">暂无进球数据，踢完比赛后更新</td></tr>`;

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
    : `<tr><td colspan="7" class="muted">暂无助攻数据，踢完比赛后更新</td></tr>`;

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
      : `<tr><td colspan="6" class="muted">至少 3 场出场后显示评分榜</td></tr>`;
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
    : `<tr><td colspan="8" class="muted">暂无门将数据，踢完比赛后更新</td></tr>`;
}

function openBuyNegotiator(playerId, fromClubId) {
  const deal = previewBuyDeal(world, playerId, fromClubId, 3, 1.1);
  if (!deal) {
    toast("无法预览该交易");
    return;
  }
  const years = prompt(
    `${deal.player.name}\n球探估值约 ${formatMoney(deal.price)}\n合同年限（1–5，默认 3）：`,
    "3"
  );
  if (years == null) return;
  const y = Math.max(1, Math.min(5, parseInt(years, 10) || 3));
  const wageIn = prompt(
    `周薪倍率（0.95–1.4，默认 1.1；过低可能被拒）：\n预估周薪约 ${formatMoney(deal.newWage)}`,
    "1.1"
  );
  if (wageIn == null) return;
  const wm = Math.max(0.9, Math.min(1.5, parseFloat(wageIn) || 1.1));
  const finalDeal = previewBuyDeal(world, playerId, fromClubId, y, wm);
  if (
    !confirm(
      `确认签下 ${finalDeal.player.name}？\n转会费 ${formatMoney(finalDeal.price)}\n签约奖 ${formatMoney(finalDeal.signingBonus)}\n${y} 年 · 周薪 ${formatMoney(finalDeal.newWage)}\n合计约 ${formatMoney(finalDeal.total)}`
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

  renderContractsLoansPanel();

  // 挖角报价
  const poachEl = $("#poach-bids");
  if (poachEl) {
    const bids = pendingPoachBids(world);
    if (!bids.length) {
      poachEl.innerHTML = `<p class="muted" style="margin:0">暂无来自其他俱乐部的报价</p>`;
    } else {
      poachEl.innerHTML = bids
        .map(
          (b) => `<div class="poach-row">
          <div>
            <strong>${escapeHtml(b.buyerName)}</strong> 报价
            <strong>${formatMoney(b.fee)}</strong> 求购
            <strong>${playerLinkHtml(b.playerId, b.playerName)}</strong>
            <span class="muted">（${b.pos} · ${b.ovr} · 剩 ${Math.max(0, b.expiresDay - world.day)} 天）</span>
          </div>
          <div class="poach-actions">
            <button class="btn small primary" data-poach-accept="${b.id}" ${!open ? "disabled" : ""}>接受</button>
            <button class="btn small" data-poach-reject="${b.id}">拒绝</button>
          </div>
        </div>`
        )
        .join("");
      poachEl.querySelectorAll("[data-poach-accept]").forEach((btn) => {
        btn.onclick = () => {
          if (!confirm("确认接受报价并放走球员？")) return;
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
        <td title="真实身价仅作参考区间">${valTxt}</td>
        <td class="tr-actions">
          <button class="btn small" data-player-link="${p.id}">${en ? "Info" : "详情"}</button>
          <button class="btn small primary" data-buy="${p.id}" data-from="${club.id}" ${
            buyDisabled ? "disabled" : ""
          }>${open ? (en ? "Buy" : "谈判买入") : en ? "Closed" : "窗关"}</button>
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
      return `<tr>
      <td class="name-with-avatar">${playerAvatarHtml(p, club, 28)} <span>${playerLinkHtml(p.id, p.name)}${onLoan ? ` <span class="badge loan">${en ? "loan" : "租"}</span>` : ""}</span></td>
      <td>${nationLabel(p)}</td>
      <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
      <td class="${ovrClass(p.ovr)}">${p.ovr}</td>
      <td>${formatMoney(p.value)}</td>
      <td class="tr-actions">
        <button class="btn small" data-player-link="${p.id}">${en ? "Info" : "详情"}</button>
        <button class="btn small danger" data-sell="${p.id}" ${
          buyDisabled || onLoan ? "disabled" : ""
        }>${onLoan ? (en ? "On loan" : "租借中") : open ? (en ? "Sell" : "出售") : en ? "Closed" : "窗关"}</button>
        <button class="btn small" data-loan-out="${p.id}" ${
          buyDisabled || onLoan ? "disabled" : ""
        }>${open && !onLoan ? (en ? "Loan out" : "外租") : en ? "—" : "—"}</button>
      </td>
    </tr>`;
    })
    .join("");

  st.querySelectorAll("[data-sell]").forEach((b) => {
    b.onclick = () => {
      if (!confirm(en ? "Sell this player?" : "确认出售该球员？")) return;
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

/** 转会页：合同待办 + 外租/租入列表 */
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
              : "待续约"
            : en
              ? "Expiring"
              : "将尽";
          return `<div class="cl-row">
            <div class="cl-main">
              <strong>${playerLinkHtml(p.id, p.name)}</strong>
              <span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span>
              <span class="muted">${p.ovr} · ${p.contractYears ?? 0}${en ? "y" : "年"} · ${formatMoney(p.wage)}</span>
              <span class="badge contract-short">${escapeHtml(tag)}</span>
            </div>
            <div class="cl-actions">
              <button type="button" class="btn small primary" data-cl-renew="${p.id}">${escapeHtml(t("contract.renew") || (en ? "Renew" : "续约"))}</button>
              <button type="button" class="btn small danger" data-cl-term="${p.id}">${escapeHtml(t("contract.terminate") || (en ? "Release" : "解约"))}</button>
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
            <span class="muted">→ ${escapeHtml(l.toName)} · ${escapeHtml(l.untilLabel)}</span>
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
            <span class="muted">${en ? "from" : "来自"} ${escapeHtml(l.fromName)} · ${escapeHtml(l.untilLabel)}</span>
          </div>
        </div>`
        )
        .join("")
    : `<p class="muted" style="margin:0">${en ? "No incoming loans." : "暂无租入球员。"}</p>`;

  box.innerHTML = `
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
}

/** 赛程唯一键（无 id 时用） */
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
function openPastMatchReport(key) {
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
  ensureMatchPitch(true);
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
function onAdvance() {
  if (world.sacked) {
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
  const res = advanceDay(world);
  if (handleSacked(res)) return;
  const { userMatches } = res;
  if (userMatches && userMatches.length) {
    pendingMatch = userMatches[0];
    const label = pendingMatch.roundLabel || `第 ${pendingMatch.round} 轮`;
    toast(`${label} · 比赛日到了！`);
  } else if (world.seasonOver) {
    toast(t("toast.seasonEndNews"));
    if (world.sacked) handleSacked({ sacked: true, msg: world.sackedReason });
  }
  autosave("advance");
  refreshAll();
}

function onAdvanceToMatchday() {
  if (world.sacked) {
    handleSacked({ sacked: true, msg: world.sackedReason || "你已被解雇" });
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
    toast(res.msg || "无法推进");
    return;
  }
  if (res.userMatches && res.userMatches.length) {
    pendingMatch = res.userMatches[0];
    const label = pendingMatch.roundLabel || `第 ${pendingMatch.round} 轮`;
    toast(`推进 ${res.days} 天 · ${label}`);
  } else if (world.seasonOver) {
    toast(`推进 ${res.days} 天 · 赛季结束`);
    if (world.sacked) handleSacked({ sacked: true, msg: world.sackedReason });
  } else {
    toast(res.msg || `推进 ${res.days} 天`);
  }
  autosave("advance-matchday");
  refreshAll();
}

/** 推进到赛季末：遇我方比赛停下（无「连推 N 天」） */
function onAdvanceToSeasonEnd() {
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
      "将自动推进日程，直到赛季结束；途中遇到我方比赛会停下。\n（不会跳过你的比赛）\n确定？"
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
    toast(res.msg || "无法推进");
    if (res.userMatches?.length) pendingMatch = res.userMatches[0];
    refreshAll();
    return;
  }
  if (res.userMatches && res.userMatches.length) {
    pendingMatch = res.userMatches[0];
    const label = pendingMatch.roundLabel || `第 ${pendingMatch.round} 轮`;
    toast(`${res.msg || `推进 ${res.days} 天`} · ${label}`);
  } else if (world.seasonOver) {
    toast(res.msg || `推进 ${res.days} 天 · 赛季结束`);
    if (world.sacked) handleSacked({ sacked: true, msg: world.sackedReason });
  } else {
    toast(res.msg || `推进 ${res.days} 天`);
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
 * @param {boolean} live 是否写评论/更新比分条（直播）
 */
async function driveMatchEvent(ev, snap, { live = true } = {}) {
  const spd = Math.max(0.25, Number(matchSpeed) || 1);
  const fixture = pendingMatch;

  if (ev.type === "tick") {
    if (live && snap) setMatchMinute(snap.minute);
    // 导演 tick：用 snap 控球偏置推连续表演（不改比分）
    if (matchView?.onTick) matchView.onTick(snap);
    // 空分钟也要停：否则 90 分钟几乎瞬间跳完
    // 攻势段落中略拉长呼吸，更像「这一波」
    let tickMs = matchEventWaitMs(ev);
    if (matchView?._attackPhaseActive?.()) tickMs = Math.round(tickMs * 1.25);
    const wait = live ? tickMs / spd : Math.max(12, tickMs / (spd * 8));
    await sleepPlayback(wait);
    return;
  }

  if (ev.type === "goal") {
    // 先抓场面，再对齐/高光——回看才能从同一帧接
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
    // 高光前轻对齐控球（完整组织在 playGoalHighlight 内）
    if (matchView?.prepareEvent) {
      await matchView.prepareEvent(ev, snap, fixture, {
        speed: spd,
        live,
        sleepFn: sleepPlayback,
      });
    }
    if (matchView?.playGoalHighlight) {
      // 进球高光：×1 时不加速；快进档才略压缩
      const goalSpd = Math.min(spd, live ? 1.15 : 1.5);
      await matchView.playGoalHighlight(ev, snap, fixture, {
        speed: goalSpd,
        lang: getLang(),
        sleepFn: sleepPlayback,
        // 直播：用抓取的场面作参考（高光内仍从当前帧推进）
        scene: scene || null,
        rewatch: false,
      });
    }
    return;
  }

  // 关键事件延长攻势 + 预演
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
      if (ctx) ctx.textContent = (ev.text || "").replace(/^情境：/, "");
    }
    if (ev.type === "ht") setMatchLiveState("ht");
    if (ev.type === "ft") setMatchLiveState("ft");
  }

  const base = matchEventWaitMs(ev);
  if (base > 0) {
    // 快速模拟仍可见画面，但明显快于直播
    const wait = live ? base / spd : base / (spd * 2.2);
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
  return buildPreMatchBriefing(world, fixture, userClub, {
    weather: { key: weather.key, name: weather.name, icon: weather.icon },
    derby,
    bigMatch,
  });
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
  const formPill = (str, tone) => {
    const s = str && str !== "—" ? str : en ? "n/a" : "暂无";
    return `<span class="form-pill tone-${tone || "neutral"}">${escapeHtml(s)}</span>`;
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
      `<span class="brief-chip board">${en ? "Board" : "董事会"}: ${escapeHtml(brief.boardLabel)}</span>`
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
  if (opp.top?.length) {
    rows.push(
      `${en ? "Threats" : "对方威胁"}: ${opp.top.map((s) => `${s.name}(${s.ovr})`).join(en ? ", " : "、")}`
    );
  }
  if (!compact && opp.formation) {
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
          <span>${escapeHtml(me.short || me.name || "")} ${formPill(me.formStr, me.formTone)}</span>
          <span class="muted">vs</span>
          <span>${escapeHtml(opp.short || opp.name || "")} ${formPill(opp.formStr, opp.formTone)}</span>
        </div>`
      : "";

  return `<div class="prematch-brief ${compact ? "compact" : "full"}">
    ${head}
    ${chips.length ? `<div class="brief-chips">${chips.join("")}</div>` : ""}
    ${formRow}
    ${rows.map((b) => `<div class="brief-line">• ${escapeHtml(b)}</div>`).join("")}
  </div>`;
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

  // 赛前简报：卡片 + 评论流（天气与开赛锁定一致）
  const brief = buildBriefingForFixture(next, user);
  const panel = $("#match-pre-brief");
  if (panel) {
    if (brief) {
      panel.innerHTML = renderPrematchBriefHtml(brief, { compact: false });
      panel.classList.remove("hidden");
    } else {
      panel.innerHTML = "";
      panel.classList.add("hidden");
    }
  }
  if (brief) {
    for (const text of briefingLogLines(brief)) {
      appendMatchEvent({ type: "briefing", text, minute: 0 });
    }
    // 计分板情境条
    const ctx = $("#match-context");
    if (ctx && brief.weather) {
      const bits = [`${brief.weather.icon} ${brief.weather.name}`];
      if (brief.derby) bits.push(getLang() === "en" ? "Derby" : "德比");
      if (brief.bigMatch) bits.push(getLang() === "en" ? "Spotlight" : "焦点");
      bits.push(brief.roundLabel || "");
      ctx.textContent = bits.filter(Boolean).join(" · ");
    }
  }

  hideHtPanel();
  hideMatchReport();
  syncMatchSpeedUI();
  // 2D 球场：赛前站位（可点球员）
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

/** 开赛后收起赛前简报卡片（评论流仍保留） */
function hidePrematchBriefPanel() {
  const panel = $("#match-pre-brief");
  if (panel) {
    panel.classList.add("hidden");
  }
}

/** FM 风格计分板：队名、球衣色、赛事 */
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
    // 避免与主队撞色：优先副色
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
 * fast/live 在中场暂停；instant 一键完赛
 */
async function runMatch(mode) {
  if (!pendingMatch || pendingMatch.played || liveRunning) return;
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
      }
    }
  }
  resetMatchPlayback({ keepStepMode: true });
  matchPlayback.controlsEnabled = true;
  updateMatchPlaybackUI();

  try {
    // 确保球场已挂载
    ensureMatchPitch();
    setMatchLiveState("live");

    if (mode === "instant") {
      const result = simulateMatch(world, pendingMatch);
      // 快速回放 2D（受倍速影响；进球会高光）
      if (matchView) {
        await matchView.replayEvents(result.events, pendingMatch, {
          // 一键完赛：在所选倍速上再略快一点，但仍尊重 ×1 正常观感
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
    // 会话创建后阵容可能 autoLineup，刷新球场
    ensureMatchPitch(true);
    const live = mode === "live";
    matchState._liveMode = live;
    const onEvent = async (ev, snap) => {
      if (snap?.home) updateLiveStats(snap);
      await driveMatchEvent(ev, snap, { live });
    };

    await playFirstHalf(matchState, { onEvent });

    // 非直播：上半场事件写入日志（画面已在 onEvent 驱动）
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
      // 中场时用 session 统计刷一次条
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
        if (ctx) ctx.textContent = ctxEv.text.replace(/^情境：/, "");
      }
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

function ensureMatchPitch(remount = false) {
  const pitchRoot = $("#match-pitch-root");
  if (!pitchRoot || !pendingMatch) return;
  const home = world.clubs.find((c) => c.id === pendingMatch.home);
  const away = world.clubs.find((c) => c.id === pendingMatch.away);
  if (!home || !away) return;
  const onPlayerClick = (playerId) => {
    // 完整资料弹窗（暂停时最合适，进行中也可点）
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
  $("#ht-pressing").value = tac.pressing ?? 3;
  $("#ht-tempo").value = tac.tempo ?? 3;
  $("#ht-pressing-val").textContent = String(tac.pressing ?? 3);
  $("#ht-tempo-val").textContent = String(tac.tempo ?? 3);
  renderHtTips();
  renderHtFitnessBars();
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

/** 中场：体能告急 / 黄牌边缘 / 比分建议 */
function renderHtTips() {
  const box = $("#match-ht-tips");
  if (!box || !matchState) return;
  const tips = getHalfTimeTips(matchState);
  const en = getLang() === "en";
  const parts = [];
  if (tips.scoreTip) {
    parts.push(
      `<div class="ht-tip score"><strong>${en ? "Score" : "比分"}</strong> ${escapeHtml(tips.scoreTip)}</div>`
    );
  }
  if (tips.avgFit != null) {
    parts.push(
      `<div class="ht-tip fit"><strong>${en ? "Avg fitness" : "首发体能"}</strong> ${tips.avgFit}%</div>`
    );
  }
  if (tips.fitness?.length) {
    const list = tips.fitness
      .map((p) => `${escapeHtml(p.name)} <em>${p.fitness}%</em>`)
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
  const title = en ? "XI fitness" : "首发体能";
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
    const tac = matchState.userClub.tactics || {};
    const st = $("#live-style");
    const pr = $("#live-pressing");
    const tm = $("#live-tempo");
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
  }
}

function onLiveTacApply() {
  if (!matchState?.userClub || matchState.finished) {
    toast(getLang() === "en" ? "Not available" : "当前无法调整");
    return;
  }
  // 仅下半场 live 有意义；上半场/中场用 HT 面板
  if (matchState.phase === "ht" || matchState.phase === "h1") {
    toast(getLang() === "en" ? "Use half-time panel" : "请在中场面板调整");
    return;
  }
  const orders = {
    style: $("#live-style")?.value,
    pressing: +($("#live-pressing")?.value || 3),
    tempo: +($("#live-tempo")?.value || 3),
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
        `<option value="${p.id}">${POS_LABEL[p.pos] || p.pos} ${p.name} · ${p.ovr} · 体${p.fitness}</option>`
    )
    .join("");
  inSel.innerHTML = bench
    .filter((p) => !pendingIn.has(p.id))
    .map(
      (p) =>
        `<option value="${p.id}">${POS_LABEL[p.pos] || p.pos} ${p.name} · ${p.ovr} · 体${p.fitness}</option>`
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
  const nSub = orders?.subs?.length || 0;
  if (nSub) bits.push(en ? `${nSub} sub(s)` : `${nSub} 人换人`);
  return en
    ? `${bits.join(" · ")} — 2nd half`
    : `${bits.join(" · ")} · 下半场开始`;
}

async function finishHalfTime(applyOrders) {
  if (!matchState || matchState.finished || liveRunning) return;
  hideHtPanel();
  setMatchBusy(true);
  matchPlayback.controlsEnabled = true;
  matchPlayback.paused = false;
  if (matchView?.setFrozen) matchView.setFrozen(false);
  updateMatchPlaybackUI();

  const orders = applyOrders
    ? {
        style: $("#ht-style")?.value,
        pressing: +($("#ht-pressing")?.value || 3),
        tempo: +($("#ht-tempo")?.value || 3),
        subs: pendingSubs.map((s) => ({ outId: s.outId, inId: s.inId })),
      }
    : {};

  const eventCountBefore = matchState.events.length;
  const goalsBefore = matchPlayback.goals.length;
  const kickTip = buildSecondHalfKickTip(applyOrders, orders);
  try {
    const live = !!matchState._liveMode;
    setMatchLiveState("live");
    // 下半场：直播时显示场边战术条
    if (live) setLiveTacBarVisible(true);

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
      if (snap?.home) updateLiveStats(snap);
      await driveMatchEvent(ev, snap, { live });
    };

    if (matchView) {
      matchView.phase = "play";
    }

    const result = await continueSecondHalf(matchState, orders, { onEvent });

    if (!live) {
      // 快速模拟：onEvent 不写日志，此处补刷（含中场战术/换人）
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
    // 直播：sub/tactics 已在 driveMatchEvent 实时写入，无需完场再补

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
      .slice(0, 11)
      .map((x) => {
        const bits = [];
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
  `;
  el.classList.remove("hidden");

  // 完场：球场上高亮 MOTM
  if (motm && matchView?.highlightMotm) {
    matchView.highlightMotm(motm);
  }
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
        <h2 data-i18n="career.manager">${getLang() === "en" ? "Manager career" : "经理生涯"}</h2>
        <p><strong>${escapeHtml(world.managerName)}</strong> · ${escapeHtml(club.name)}</p>
        <ul class="career-stats">
          <li>${getLang() === "en" ? "Seasons" : "执教赛季"}：${mc.seasons}</li>
          <li>${getLang() === "en" ? "Record" : "战绩"}：${mc.wins}W ${mc.draws}D ${mc.losses}L（${mc.matches}）· ${wr}%</li>
          <li>GF/GA：${mc.goalsFor || 0} / ${mc.goalsAgainst || 0}</li>
          <li>${getLang() === "en" ? "Titles / promos / cups" : "冠军 / 升级 / 杯赛"}：${mc.titles} / ${mc.promotions} / ${mc.cups}</li>
          <li>${getLang() === "en" ? "Sacked" : "被解雇"}：${mc.sacked}</li>
          <li>${
            mc.bestFinish
              ? `${getLang() === "en" ? "Best" : "最佳"}：${mc.bestFinish.season} ${escapeHtml(mc.bestFinish.divName)} #${mc.bestFinish.pos}`
              : getLang() === "en"
                ? "Best finish: —"
                : "最佳名次：—"
          }</li>
        </ul>
        <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">${getLang() === "en" ? "Trophy cabinet" : "荣誉柜"}</h3>
        <div class="honor-list">${trophies || `<p class="muted">${getLang() === "en" ? "No trophies yet" : "暂无奖杯"}</p>`}</div>
      </div>
      <div class="card">
        <h2 data-i18n="career.club">${getLang() === "en" ? "Club honours" : "俱乐部荣誉墙"}</h2>
        <div class="honor-list">${clubHonors || `<p class="muted">${getLang() === "en" ? "Win a title or promote to fill the wall" : "夺冠或升级后写入此处"}</p>`}</div>
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
    .map((t) => `<li>${escapeHtml(t.title)}${t.detail ? ` · ${escapeHtml(t.detail)}` : ""}</li>`)
    .join("");
  overlay.innerHTML = `
    <div class="season-summary-card">
      <h2>🏆 ${s.season} ${getLang() === "en" ? "Season review" : "赛季结算"}</h2>
      <p class="muted">${escapeHtml(s.clubName)} · ${escapeHtml(s.divName)}</p>
      <p style="font-size:1.35rem;margin:0.5rem 0"><strong>#${s.pos}</strong> · ${s.pts} pts · ${s.w}W ${s.d}D ${s.l}L · ${s.gf}:${s.ga}</p>
      ${trop ? `<ul class="season-trop-list">${trop}</ul>` : `<p class="muted">${getLang() === "en" ? "No new silverware" : "本季无新奖杯"}</p>`}
      <p class="muted" style="margin-top:0.75rem">${getLang() === "en" ? "Career" : "生涯"}：${s.career?.seasons || 0} seasons · ${s.career?.titles || 0} titles · ${s.career?.promotions || 0} promos</p>
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

// ---------- Boot ----------
initPrefs();
window.addEventListener("vc-prefs-change", () => {
  fillClubSelect();
  refreshSlotUI();
  if (world) refreshAll();
});
initStart();

/**
 * 刷新页面后自动读档：有当前槽存档则直接进主界面
 * （否则每次刷新都会停在开始页，像「没记住进度」）
 * URL 加 ?menu=1 可强制停在开始页（例如要换档 / 导出）
 */
function tryAutoResume() {
  try {
    const params = new URLSearchParams(location.search || "");
    if (params.get("menu") === "1" || params.get("noload") === "1") return false;
    // session 内主动回菜单：同一会话刷新仍自动读；仅当带 menu=1 时停菜单
    const slot = getActiveSlot();
    if (!hasSave(slot)) return false;
    const data = loadGame(slot);
    if (!data) return false;
    world = data;
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

tryAutoResume();

