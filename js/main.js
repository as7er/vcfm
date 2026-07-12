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
  getBenchPlayers,
  getOnFieldPlayers,
  getSortedTable,
  getUserClub,
  getNextUserMatch,
  buyPlayer,
  sellPlayer,
  getMarketPlayers,
  getStatLeaders,
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
import { buildPreMatchBriefing, suspensionSummary } from "./discipline.js";
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
/** 直播倍速 1 / 2 / 4 */
function readPref(key, oldKey, fallback) {
  try {
    return localStorage.getItem(key) || (oldKey ? localStorage.getItem(oldKey) : null) || fallback;
  } catch {
    return fallback;
  }
}
let matchSpeed = Number(readPref("vcfm-match-speed", "vc-fm-match-speed", "2")) || 2;
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

  // 比赛倍速
  document.querySelectorAll("[data-match-speed]").forEach((btn) => {
    btn.addEventListener("click", () => {
      matchSpeed = Number(btn.dataset.matchSpeed) || 2;
      try {
        localStorage.setItem("vcfm-match-speed", String(matchSpeed));
      } catch (_) {
        /* ignore */
      }
      syncMatchSpeedUI();
      toast(getLang() === "en" ? `Speed ×${matchSpeed}` : `比赛倍速 ×${matchSpeed}`);
    });
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
    const link = e.target.closest("[data-club-link]");
    if (!link || !world) return;
    e.preventDefault();
    showClubModal(link.dataset.clubLink);
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
    autosave("after-match");
    destroyMatchView();
    matchView = null;
    showScreen("main");
    pendingMatch = null;
    matchState = null;
    pendingSubs = [];
    refreshAll();
  };

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
            <span>${escapeHtml(playerDisplaySurname(p.name, p.nationality))}${tag}</span>
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
    const brief = ready ? buildPreMatchBriefing(world, next, club) : null;
    let briefHtml = "";
    if (brief) {
      const bits = [];
      if (brief.suspended.length)
        bits.push(
          `停赛：${brief.suspended.map((s) => `${s.name}(${s.matches})`).join("、")}`
        );
      if (brief.injured.length)
        bits.push(
          `伤病：${brief.injured
            .slice(0, 3)
            .map((s) => s.name)
            .join("、")}`
        );
      if (brief.yellowRisk.length)
        bits.push(
          `黄牌边缘：${brief.yellowRisk.map((s) => `${s.name}(${s.yellows})`).join("、")}`
        );
      if (brief.tired.length)
        bits.push(
          `体能低：${brief.tired.map((s) => `${s.name}${s.fit}%`).join("、")}`
        );
      if (brief.opp.top.length)
        bits.push(
          `对方核心：${brief.opp.top.map((s) => `${s.name}(${s.ovr})`).join("、")}`
        );
      briefHtml = bits.length
        ? `<div class="prematch-brief">${bits.map((b) => `<div class="muted">• ${escapeHtml(b)}</div>`).join("")}</div>`
        : `<div class="prematch-brief muted">• 人员齐全，无重大缺阵</div>`;
    }
    box.innerHTML = `
      <div><strong>${next.competition === "cup" ? next.roundLabel || "杯赛" : `第 ${next.round} 轮`}</strong> · 第 ${next.day} 天 · ${next.home === club.id ? "主场" : "客场"}</div>
      <div style="margin-top:0.4rem;font-size:1.25rem">
        ${clubLinkHtml(home.id, home.name)} <span class="muted">vs</span> ${clubLinkHtml(away.id, away.name)}
      </div>
      <div class="muted" style="margin-top:0.35rem">
        ${ready ? "可以开赛 · 赛前简报" : `还需等待 ${next.day - world.day} 天`}
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
      const ovr = p.ovr || playerOverall(p);
      const s = playerStats(p);
      const statBits =
        p.pos === "GK"
          ? `零封 ${s.cleanSheets} · 失球 ${s.goalsConceded}`
          : `进球 ${s.goals} · 助攻 ${s.assists}`;
      const num = p.number != null ? p.number : "—";
      const statusBadges = [
        xi.has(p.id) ? '<span class="badge">首发</span>' : "",
        p.injured > 0 ? '<span class="badge ATT">伤</span>' : "",
        (p.suspendedMatches || 0) > 0
          ? `<span class="badge ATT" title="停赛">停${p.suspendedMatches}</span>`
          : "",
        (p.yellowsSeason || 0) >= 4 && !(p.suspendedMatches > 0)
          ? `<span class="badge" style="background:#e6b450;color:#111" title="累计黄牌">黄${p.yellowsSeason}</span>`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<tr class="${xi.has(p.id) ? "me" : ""} ${!isAvailable(p) ? "row-unavailable" : ""}">
        <td class="num-cell"><span class="kit-num" style="${kitBadgeStyle(club)}">${num}</span></td>
        <td class="name-with-avatar">${playerAvatarHtml(p, club, 30)} <span>${escapeHtml(p.name)} ${statusBadges}</span></td>
        <td>${nationLabel(p)}</td>
        <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
        <td>${p.age}</td>
        <td class="${ovrClass(ovr)}"><strong>${ovr}</strong></td>
        <td>${p.fitness}%</td>
        <td>${p.morale}</td>
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
  const historyRows = [...(player.history || [])]
    .sort((a, b) => b.season - a.season)
    .map(
      (h) => `<tr>
        <td>${h.season}</td>
        <td>${escapeHtml(h.clubName || "—")}</td>
        <td>${h.apps}</td>
        <td>${isGk ? h.cleanSheets : h.goals}</td>
        <td>${isGk ? h.goalsConceded : h.assists}</td>
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
    </tr>`);
  }

  const histHead = isGk
    ? `<th>赛季</th><th>球队</th><th>出场</th><th>零封</th><th>失球</th>`
    : `<th>赛季</th><th>球队</th><th>出场</th><th>进球</th><th>助攻</th>`;

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
      ${player.contractYears != null ? ` · 合同 ${player.contractYears} 年` : ""}
    </p>
    ${
      fromOther
        ? formatScoutReportHtml(buildScoutReport(world, player, getUserClub(world)), formatMoney)
        : ""
    }

    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">本赛季（俱乐部）</h3>
    <p class="muted" style="margin:0">出场 ${season.apps}
      ${
        isGk
          ? ` · 零封 ${season.cleanSheets} · 失球 ${season.goalsConceded}`
          : ` · 进球 ${season.goals} · 助攻 ${season.assists}`
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
            <td class="name-with-avatar">${playerAvatarHtml(p, club, 28)} <span>${escapeHtml(p.name)}</span></td>
            <td>${nationLabel(p)}</td>
            <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
            <td>${p.age}</td>
            <td class="${ovrClass(p.ovr)}"><strong>${p.ovr}</strong></td>
            <td class="${potClass}"><strong>${pot}</strong></td>
            <td>${formatMoney(p.wage)}</td>
            <td>
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
      return `<div class="player-dot" style="left:${slot.x}%;top:${slot.y}%" title="${escapeHtml(full)}">
        <div class="circle kit-dot" style="${style}">${av || fallback}${badge}</div>
        <div class="name">${escapeHtml(nameText)}</div>
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
          <button type="button" class="club-link" data-view-player="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>
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

  // 弹窗内点球员 → 球员详情
  $("#modal-body").querySelectorAll("[data-view-player]").forEach((btn) => {
    btn.onclick = () => showPlayerModal(btn.dataset.viewPlayer);
  });

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
  const { goals, assists, keepers } = getStatLeaders(world);
  const uid = world.userClubId;

  const goalsBody = $("#stats-goals tbody");
  goalsBody.innerHTML = goals.length
    ? goals
        .map(({ player: p, club }, i) => {
          const s = playerStats(p);
          const me = club.id === uid;
          return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${escapeHtml(p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            <td><strong>${s.goals}</strong></td>
            <td>${s.assists}</td>
            <td>${s.apps}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="muted">暂无进球数据，踢完比赛后更新</td></tr>`;

  const assistsBody = $("#stats-assists tbody");
  assistsBody.innerHTML = assists.length
    ? assists
        .map(({ player: p, club }, i) => {
          const s = playerStats(p);
          const me = club.id === uid;
          return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${escapeHtml(p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            <td><strong>${s.assists}</strong></td>
            <td>${s.goals}</td>
            <td>${s.apps}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="muted">暂无助攻数据，踢完比赛后更新</td></tr>`;

  const keepersBody = $("#stats-keepers tbody");
  keepersBody.innerHTML = keepers.length
    ? keepers
        .map(({ player: p, club, gaPerGame }, i) => {
          const s = playerStats(p);
          const me = club.id === uid;
          return `<tr class="${me ? "me" : ""}">
            <td>${i + 1}</td>
            <td>${escapeHtml(p.name)}</td>
            <td>${clubLinkHtml(club.id, club.short)}</td>
            <td>${s.apps}</td>
            <td><strong>${s.cleanSheets}</strong></td>
            <td>${s.goalsConceded}</td>
            <td>${gaPerGame.toFixed(2)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">暂无门将数据，踢完比赛后更新</td></tr>`;
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
            <strong>${escapeHtml(b.playerName)}</strong>
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
  mt.innerHTML = market
    .map(({ player: p, club }) => {
      const valTxt = formatScoutValue(world, p);
      const ovrTxt = formatScoutOvr(world, p);
      return `<tr>
        <td class="name-with-avatar">${playerAvatarHtml(p, club, 28)} <span>${escapeHtml(p.name)}</span></td>
        <td>${nationLabel(p)}</td>
        <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
        <td class="${ovrClass(p.ovr)}">${ovrTxt}</td>
        <td>${p.age}</td>
        <td>${escapeHtml(club.short)}</td>
        <td title="真实身价仅作参考区间">${valTxt}</td>
        <td>
          <button class="btn small" data-view="${p.id}">详情</button>
          <button class="btn small primary" data-buy="${p.id}" data-from="${club.id}" ${
            buyDisabled ? "disabled" : ""
          }>${open ? "谈判买入" : "窗关"}</button>
        </td>
      </tr>`;
    })
    .join("");

  mt.querySelectorAll("[data-view]").forEach((b) => {
    b.onclick = () => showPlayerModal(b.dataset.view);
  });
  mt.querySelectorAll("[data-buy]").forEach((b) => {
    b.onclick = () => openBuyNegotiator(b.dataset.buy, b.dataset.from);
  });

  const club = getUserClub(world);
  const st = $("#sell-table tbody");
  const sorted = [...club.players].sort((a, b) => b.ovr - a.ovr);
  st.innerHTML = sorted
    .map(
      (p) => `<tr>
      <td class="name-with-avatar">${playerAvatarHtml(p, club, 28)} <span>${escapeHtml(p.name)}</span></td>
      <td>${nationLabel(p)}</td>
      <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
      <td class="${ovrClass(p.ovr)}">${p.ovr}</td>
      <td>${formatMoney(p.value)}</td>
      <td><button class="btn small danger" data-sell="${p.id}" ${
        buyDisabled ? "disabled" : ""
      }>${open ? "出售" : "窗关"}</button></td>
    </tr>`
    )
    .join("");

  st.querySelectorAll("[data-sell]").forEach((b) => {
    b.onclick = () => {
      if (!confirm("确认出售该球员？")) return;
      const res = sellPlayer(world, b.dataset.sell);
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });
}

function renderFixtures() {
  const uid = world.userClubId;
  const list = world.fixtures.filter((f) => f.home === uid || f.away === uid);
  const tbody = $("#fixtures-table tbody");
  tbody.innerHTML = list
    .map((f) => {
      const home = world.clubs.find((c) => c.id === f.home);
      const away = world.clubs.find((c) => c.id === f.away);
      const score = f.played ? `${f.homeGoals} - ${f.awayGoals}` : "-";
      let status = t("fix.pending");
      if (f.played) status = t("fix.played");
      else if (f.day === world.day) status = getLang() === "en" ? "Today" : "今日";
      else if (f.day < world.day) status = getLang() === "en" ? "Due" : "待踢";
      return `<tr class="${f.day === world.day && !f.played ? "me" : ""}">
        <td>${f.round}</td>
        <td>D${f.day}</td>
        <td>${clubLinkHtml(home.id, home.name)}</td>
        <td>${score}</td>
        <td>${clubLinkHtml(away.id, away.name)}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join("");
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
  $("#match-home").textContent = home.name;
  $("#match-away").textContent = away.name;
  $("#match-score").textContent = "0 - 0";
  $("#match-minute").textContent = "0'";
  const ctx = $("#match-context");
  if (ctx) ctx.textContent = next.competition === "cup" ? next.roundLabel || t("match.cup") : t("match.leagueRound", { n: next.round || "?" });
  $("#match-log").innerHTML = "";
  // 赛前简报写入日志
  const brief = buildPreMatchBriefing(world, next, user);
  if (brief) {
    const lines = [`📋 赛前简报 · ${brief.roundLabel} · ${brief.isHome ? "主场" : "客场"}`];
    if (brief.suspended.length)
      lines.push(`停赛：${brief.suspended.map((s) => `${s.name} 停${s.matches}`).join("、")}`);
    if (brief.injured.length)
      lines.push(`伤病：${brief.injured.map((s) => s.name).join("、")}`);
    if (brief.yellowRisk.length)
      lines.push(`黄牌边缘：${brief.yellowRisk.map((s) => `${s.name}(${s.yellows})`).join("、")}`);
    if (brief.opp.top.length)
      lines.push(`对方威胁：${brief.opp.top.map((s) => `${s.name} ${s.ovr}`).join("、")}`);
    if (lines.length === 1) lines.push("人员齐全，无重大缺阵");
    for (const text of lines) {
      appendMatchEvent({ type: "briefing", text, minute: 0 });
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
  $("#btn-match-continue").disabled = true;
  showScreen("match");
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
  $("#match-log").innerHTML = "";
  hideHtPanel();
  hideMatchReport();

  try {
    // 确保球场已挂载
    ensureMatchPitch();

    if (mode === "instant") {
      const result = simulateMatch(world, pendingMatch);
      // 快速回放 2D（受倍速影响）
      if (matchView) {
        await matchView.replayEvents(result.events, pendingMatch, {
          speed: 1.5 * matchSpeed,
          onStep: (ev, snap) => {
            if (ev.type === "tick" || !ev.text) return;
            appendMatchEvent(ev);
            $("#match-score").textContent = `${snap.homeGoals} - ${snap.awayGoals}`;
            $("#match-minute").textContent = `${ev.minute || 90}'`;
          },
        });
      } else {
        for (const ev of result.events || []) {
          if (ev.type === "tick" || !ev.text) continue;
          appendMatchEvent(ev);
        }
      }
      $("#match-score").textContent = `${result.homeGoals} - ${result.awayGoals}`;
      $("#match-minute").textContent = "90'";
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
    const spd = Math.max(1, matchSpeed);
    const onEvent = async (ev, snap) => {
      if (ev.type === "tick") {
        if (live) $("#match-minute").textContent = `${snap.minute}'`;
        return;
      }
      if (matchView) matchView.onEvent(ev, snap, pendingMatch);
      if (live) {
        if (ev.text) appendMatchEvent(ev);
        $("#match-score").textContent = `${snap.homeGoals} - ${snap.awayGoals}`;
        $("#match-minute").textContent = `${ev.minute}'`;
        if (ev.type === "context") {
          const ctx = $("#match-context");
          if (ctx) ctx.textContent = ev.text.replace(/^情境：/, "");
        }
        await sleep(
          (ev.type === "goal"
            ? 480
            : ev.type === "kickoff" || ev.type === "ht" || ev.type === "coach"
              ? 200
              : 70) / spd
        );
      }
    };

    await playFirstHalf(matchState, { onEvent });

    // 非直播：上半场事件写入日志（画面已在 onEvent 驱动）
    if (!live) {
      for (const ev of matchState.events) {
        if (ev.type === "tick" || !ev.text) continue;
        appendMatchEvent(ev);
      }
      $("#match-score").textContent = `${matchState.hg} - ${matchState.ag}`;
      $("#match-minute").textContent = "45'";
      const ctxEv = matchState.events.find((e) => e.type === "context");
      if (ctxEv) {
        const ctx = $("#match-context");
        if (ctx) ctx.textContent = ctxEv.text.replace(/^情境：/, "");
      }
    }

    // 中场暂停
    setMatchBusy(false);
    openHalfTimePanel();
  } catch (err) {
    console.error(err);
    toast(t("match.err", { msg: err.message || err }));
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
}

function openHalfTimePanel() {
  const panel = $("#match-ht-panel");
  if (!panel || !matchState) return;
  panel.classList.remove("hidden");
  pendingSubs = [];
  const club = matchState.userClub;
  const tac = club?.tactics || {};
  $("#match-ht-score").textContent = t("match.htScore", {
    home: matchState.home.name,
    away: matchState.away.name,
    hg: matchState.hg,
    ag: matchState.ag,
    max: matchState.maxSubs,
    used: matchState.subsUsed[matchState.userSide] || 0,
  });
  $("#ht-style").value = tac.style || "balanced";
  $("#ht-pressing").value = tac.pressing ?? 3;
  $("#ht-tempo").value = tac.tempo ?? 3;
  $("#ht-pressing-val").textContent = String(tac.pressing ?? 3);
  $("#ht-tempo-val").textContent = String(tac.tempo ?? 3);
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
  toast(`${outP.name} → ${inP.name}`);
}

async function finishHalfTime(applyOrders) {
  if (!matchState || matchState.finished || liveRunning) return;
  hideHtPanel();
  setMatchBusy(true);

  const orders = applyOrders
    ? {
        style: $("#ht-style")?.value,
        pressing: +($("#ht-pressing")?.value || 3),
        tempo: +($("#ht-tempo")?.value || 3),
        subs: pendingSubs.map((s) => ({ outId: s.outId, inId: s.inId })),
      }
    : {};

  const eventCountBefore = matchState.events.length;
  try {
    const live = !!matchState._liveMode;
    // 先应用中场指令再刷新 2D（换人后号码/站位）
    // continueSecondHalf 内部会 applyUserHalfTime；此处先手动应用以更新 pitch
    const spd = Math.max(1, matchSpeed);
    const onEvent = async (ev, snap) => {
      if (ev.type === "tick") {
        if (live) $("#match-minute").textContent = `${snap.minute}'`;
        return;
      }
      if (matchView) matchView.onEvent(ev, snap, pendingMatch);
      if (live) {
        if (ev.text) appendMatchEvent(ev);
        $("#match-score").textContent = `${snap.homeGoals} - ${snap.awayGoals}`;
        $("#match-minute").textContent = `${ev.minute}'`;
        await sleep((ev.type === "goal" ? 480 : ev.type === "coach" ? 160 : 70) / spd);
      }
    };

    if (matchView) {
      matchView.phase = "play";
      matchView.setBanner("");
    }

    const result = await continueSecondHalf(matchState, orders, { onEvent });

    if (!live) {
      for (const ev of matchState.events.slice(eventCountBefore)) {
        if (ev.type === "tick" || !ev.text) continue;
        appendMatchEvent(ev);
      }
    } else {
      for (const ev of matchState.events.slice(eventCountBefore)) {
        if ((ev.type === "tactics" || ev.type === "sub") && ev.text) appendMatchEvent(ev);
      }
    }

    $("#match-score").textContent = `${result.homeGoals} - ${result.awayGoals}`;
    $("#match-minute").textContent = "90'";
    showMatchReport(result.report || matchState.report);
    finishMatchUI();
    saveGame(world);
  } catch (err) {
    console.error(err);
    toast(t("match.err2", { msg: err.message || err }));
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

function showMatchReport(report) {
  const el = $("#match-report");
  if (!el || !report) return;
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

  const scorers = (report.scorers || [])
    .map((s) => escapeHtml(s.text.replace(/^⚽\s*/, "")))
    .join("<br>");

  el.innerHTML = `
    <h3>${t("match.report")}</h3>
    <div class="match-report-meta">${escapeHtml(t("match.reportMeta", { meta: meta || t("match.regular"), score: report.score }))}</div>
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
    ${scorers ? `<div class="report-scorers"><strong>${t("match.scorers")}</strong><br>${scorers}</div>` : ""}
  `;
  el.classList.remove("hidden");
}

function finishMatchUI() {
  setMatchBusy(false);
  $("#btn-match-continue").disabled = false;
  $("#btn-sim-fast").disabled = true;
  $("#btn-sim-live").disabled = true;
  const inst = $("#btn-sim-instant");
  if (inst) inst.disabled = true;
  hideHtPanel();
}

function appendMatchEvent(ev) {
  if (!ev || !ev.text) return;
  const div = document.createElement("div");
  div.className = `event ${ev.type || ""}`;
  div.textContent = localizeMatchEvent(ev);
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

