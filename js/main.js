/** VC 足球经理 · UI 主逻辑 */

import {
  CLUB_TEMPLATES,
  FORMATIONS,
  POS_LABEL,
  NATIONALITIES,
  DIVISIONS,
  START_DIVISION,
} from "./data.js";
import { ensureMedia, mediaSeasonKickoff } from "./media.js";

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
} from "./models.js";
import {
  advanceDay,
  advanceToNextMatchDay,
  simulateMatch,
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
  startNextSeason,
  ensureStaff,
  ROLES,
  refreshStaffMarket,
  hireStaffForUser,
  fireStaffForUser,
  ensureIntl,
  ensureHonors,
} from "./engine.js";
import {
  saveGame,
  loadGame,
  hasSave,
  exportSaveDownload,
  importSaveText,
} from "./save.js";

let world = null;
let pendingMatch = null;
let liveRunning = false;

/** 自动存档（静默，失败仅 console） */
function autosave(msg) {
  if (!world) return false;
  const ok = saveGame(world);
  if (!ok) console.warn("autosave failed", msg || "");
  return ok;
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
function initStart() {
  const sel = $("#select-club");
  // 开局只能选最低级（乙级）
  const starters = CLUB_TEMPLATES.filter((c) => (c.division || 3) === START_DIVISION);
  sel.innerHTML = starters
    .map(
      (c) =>
        `<option value="${c.id}">${c.name} · 乙级（实力 ${c.power}）</option>`
    )
    .join("");

  if (hasSave()) {
    $("#start-hint").textContent = "检测到本地存档，可读取继续。";
  }

  $("#btn-new-game").onclick = () => {
    const manager = $("#input-manager").value.trim() || "教练";
    const clubId = $("#select-club").value;
    const tpl = CLUB_TEMPLATES.find((c) => c.id === clubId);
    if (!tpl || (tpl.division || 3) !== START_DIVISION) {
      $("#start-hint").textContent = "只能选择乙级联赛球队开局。";
      return;
    }
    if (hasSave() && !confirm("开始新赛季将覆盖本地存档，确定？")) return;
    world = createWorld(clubId, manager);
    ensureMedia(world);
    for (const c of world.clubs) ensureStaff(c);
    refreshStaffMarket(world);
    const u = world.clubs.find((c) => c.id === clubId);
    mediaSeasonKickoff(world, u, DIVISIONS[u.division || 3]?.name || "乙级联赛");
    saveGame(world);
    enterMain();
  };

  $("#btn-load-game").onclick = () => {
    const data = loadGame();
    if (!data) {
      $("#start-hint").textContent = "没有找到存档。";
      return;
    }
    world = data;
    migrateWorld(world);
    enterMain();
  };

  $("#btn-export-save").onclick = () => {
    if (!hasSave()) {
      $("#start-hint").textContent = "没有可导出的存档。";
      return;
    }
    const data = loadGame();
    if (exportSaveDownload(data)) toast("存档已下载");
    else toast("导出失败");
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
        toast("存档文件无效");
        return;
      }
      if (hasSave() && !confirm("导入将覆盖当前本地存档，确定？")) return;
      world = data;
      migrateWorld(world);
      saveGame(world);
      toast("导入成功");
      enterMain();
    } catch (err) {
      console.error(err);
      toast("导入失败");
    }
  };
}

/** 旧存档 / 缺字段兼容 */
function migrateWorld(w) {
  if (!w.retiredPlayers) w.retiredPlayers = [];
  ensureMedia(w);
  if (!Array.isArray(w.staffMarket)) refreshStaffMarket(w);
  for (const c of w.clubs || []) {
    if (!c.division) {
      c.division = c.power >= 72 ? 1 : c.power >= 60 ? 2 : 3;
    }
    ensureStaff(c);
    ensureYouthAcademy(c);
    if (!c.youth.players.length) fillYouthSquad(c);
    for (const p of c.players || []) {
      if (p.potential == null) p.potential = Math.min(20, (p.ovr || 10) + 1);
      ensurePlayerHistory(p);
      ensureIntl(p);
      ensureHonors(p);
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
    if (saveGame(world)) toast("存档成功");
    else toast("存档失败");
  };

  $("#btn-export-save-main").onclick = () => {
    if (!world) return;
    if (exportSaveDownload(world)) toast("存档已下载");
    else toast("导出失败");
  };

  $("#btn-menu").onclick = () => {
    autosave("menu");
    if (confirm("返回主菜单？（已自动存档）")) {
      showScreen("start");
      if (hasSave()) $("#start-hint").textContent = "检测到本地存档，可读取继续。";
    }
  };

  $("#btn-advance").onclick = () => onAdvance();
  $("#btn-advance-matchday").onclick = () => onAdvanceToMatchday();
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
    toast("已自动排出最佳十一人");
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

  $("#btn-refresh-staff").onclick = () => {
    refreshStaffMarket(world);
    // 刷新费
    const club = getUserClub(world);
    const fee = 50_000;
    if (club.money >= fee) {
      club.money -= fee;
      toast(`已刷新职员市场（-€50K）`);
    } else {
      toast("资金不足，仍已刷新列表");
    }
    saveGame(world);
    renderStaff();
    renderTopbar();
  };

  const tableDiv = $("#table-division");
  if (tableDiv) {
    tableDiv.onchange = () => renderTable();
  }

  $("#modal-close").onclick = () => $("#modal").classList.add("hidden");
  $("#modal").onclick = (e) => {
    if (e.target.id === "modal") $("#modal").classList.add("hidden");
  };

  // match buttons
  $("#btn-sim-fast").onclick = () => runMatch(false);
  $("#btn-sim-live").onclick = () => runMatch(true);
  $("#btn-match-continue").onclick = () => {
    autosave("after-match");
    showScreen("main");
    pendingMatch = null;
    refreshAll();
  };
}

// ---------- Refresh ----------
function refreshAll() {
  if (!world) return;
  renderTopbar();
  renderDashboard();
  renderSquad();
  renderYouth();
  renderStaff();
  renderTactics();
  renderTable();
  renderStats();
  renderMedia();
  renderTransfer();
  renderFixtures();
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
        <div class="role">${meta.label}</div>
        <h3>${escapeHtml(s.name)}</h3>
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
        <td>${escapeHtml(s.name)}</td>
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
  $("#media-count").textContent = `${list.length} 篇报道`;
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
  $("#club-name").textContent = club.name;
  $("#manager-name").textContent = `${world.managerName} · ${div?.short || "乙级"}`;
  $("#season-label").textContent = `赛季 ${world.season}`;
  $("#date-label").textContent = `第 ${world.day} 天`;
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
    playBtn.textContent = "赛季已结束";
    advanceBtn.disabled = true;
    if (advanceMatchBtn) advanceMatchBtn.disabled = true;
    nextSeasonBtn.style.display = "inline-block";
  } else if (!next) {
    box.textContent = "暂无下场比赛，可推进日程。";
    playBtn.disabled = true;
    advanceBtn.disabled = false;
    if (advanceMatchBtn) advanceMatchBtn.disabled = false;
    nextSeasonBtn.style.display = "none";
  } else {
    const home = world.clubs.find((c) => c.id === next.home);
    const away = world.clubs.find((c) => c.id === next.away);
    const ready = next.day <= world.day;
    box.innerHTML = `
      <div><strong>第 ${next.round} 轮</strong> · 第 ${next.day} 天</div>
      <div style="margin-top:0.4rem;font-size:1.25rem">
        ${home.name} <span class="muted">vs</span> ${away.name}
      </div>
      <div class="muted" style="margin-top:0.35rem">
        ${ready ? "可以开赛" : `还需等待 ${next.day - world.day} 天`}
      </div>
    `;
    playBtn.disabled = !ready;
    playBtn.textContent = ready ? "进入比赛" : "尚未到比赛日";
    advanceBtn.disabled = false;
    // 比赛日当天：应先踢比赛，禁用跳到下场
    if (advanceMatchBtn) advanceMatchBtn.disabled = ready;
    nextSeasonBtn.style.display = "none";
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

  $("#form-strip").innerHTML = (club.form.length ? club.form : ["—"])
    .map((f) =>
      f === "—"
        ? `<span class="form-dot" style="opacity:.4">-</span>`
        : `<span class="form-dot ${f}">${f}</span>`
    )
    .join("");

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

  $("#squad-count").textContent = `${sorted.length} 名球员`;

  tbody.innerHTML = sorted
    .map((p) => {
      const ovr = p.ovr || playerOverall(p);
      const s = playerStats(p);
      const statBits =
        p.pos === "GK"
          ? `零封 ${s.cleanSheets} · 失球 ${s.goalsConceded}`
          : `进球 ${s.goals} · 助攻 ${s.assists}`;
      return `<tr class="${xi.has(p.id) ? "me" : ""}">
        <td>${escapeHtml(p.name)}${xi.has(p.id) ? ' <span class="badge">首发</span>' : ""}${
          p.injured > 0 ? ' <span class="badge ATT">伤</span>' : ""
        }</td>
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

  $("#modal-body").innerHTML = `
    <h2 style="margin:0 0 0.25rem">${escapeHtml(player.name)}</h2>
    <p class="muted">
      <span class="badge ${player.pos}">${POS_LABEL[player.pos]}</span>
      · ${nationLabel(player)}
      · ${player.age} 岁 · 能力 <strong class="${ovrClass(player.ovr)}">${player.ovr}</strong>
      · 潜力 <strong>${pot}</strong>
      ${player.fromYouth ? ' · <span class="badge MID">青训</span>' : ""}
      ${fromOther ? ` · ${escapeHtml(fromOther.name)}` : ""}
    </p>
    <p>身价 ${formatMoney(player.value)} · 周薪 ${formatMoney(player.wage)} · 体能 ${player.fitness}% · 士气 ${player.morale}</p>

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

function renderYouth() {
  const club = getUserClub(world);
  const ya = ensureYouthAcademy(club);
  const cfg = YOUTH_LEVELS[ya.level] || YOUTH_LEVELS[1];
  const nextLv = ya.level + 1;
  const nextCost = YOUTH_UPGRADE_COST[nextLv];
  const daysLeft = Math.max(0, 30 - (ya.daysSinceIntake || 0));

  $("#youth-info").innerHTML = `
    <div><strong>Lv.${ya.level}</strong> ${cfg.name}</div>
    <div class="muted">容量 ${ya.players.length}/${cfg.capacity} · 每期招生 ${cfg.intake} 人</div>
    <div class="muted">周维护费 ${formatMoney(cfg.upkeep)} · 下次招生约 ${daysLeft} 天</div>
  `;

  const upBtn = $("#btn-youth-upgrade");
  if (ya.level >= 5) {
    upBtn.disabled = true;
    upBtn.textContent = "已满级";
    $("#youth-hint").textContent = "学院已是世界级，专心培养好苗子吧。";
  } else {
    upBtn.disabled = false;
    upBtn.textContent = `升级至 Lv.${nextLv}（${formatMoney(nextCost)}）`;
    $("#youth-hint").textContent = `下级：${YOUTH_LEVELS[nextLv].name} · 容量 ${YOUTH_LEVELS[nextLv].capacity} · 成长更快`;
  }

  $("#youth-count").textContent = `${ya.players.length} 名学员`;
  const sorted = [...ya.players].sort(
    (a, b) => (b.potential || 0) - (a.potential || 0) || b.ovr - a.ovr
  );
  const tbody = $("#youth-table tbody");
  tbody.innerHTML = sorted.length
    ? sorted
        .map((p) => {
          const pot = p.potential ?? p.ovr;
          const potClass = pot >= 16 ? "stat-high" : pot >= 13 ? "stat-mid" : "stat-low";
          return `<tr>
            <td>${escapeHtml(p.name)}</td>
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
    : `<tr><td colspan="8" class="muted">暂无青训球员，推进日程等待招生</td></tr>`;

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
  pitch.innerHTML = formation.slots
    .map((slot, i) => {
      const p = players[i];
      const label = p ? p.name.split(/\s+/).pop() : "?";
      const num = p ? p.ovr : "-";
      return `<div class="player-dot" style="left:${slot.x}%;top:${slot.y}%">
        <div class="circle">${num}</div>
        <div class="name">${escapeHtml(label)}</div>
      </div>`;
    })
    .join("");
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

  $("#table-title").textContent = `${info.name}积分榜`;
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
            <td>${escapeHtml(r.name)}${me ? " ★" : ""}${zone}</td>
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
            <td>${escapeHtml(club.short)}</td>
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
            <td>${escapeHtml(club.short)}</td>
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
            <td>${escapeHtml(club.short)}</td>
            <td>${s.apps}</td>
            <td><strong>${s.cleanSheets}</strong></td>
            <td>${s.goalsConceded}</td>
            <td>${gaPerGame.toFixed(2)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">暂无门将数据，踢完比赛后更新</td></tr>`;
}

function renderTransfer() {
  const pos = $("#filter-pos").value;
  const market = getMarketPlayers(world, pos);
  const mt = $("#market-table tbody");
  mt.innerHTML = market
    .map(({ player: p, club }) => {
      return `<tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${nationLabel(p)}</td>
        <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
        <td class="${ovrClass(p.ovr)}">${p.ovr}</td>
        <td>${p.age}</td>
        <td>${escapeHtml(club.short)}</td>
        <td>${formatMoney(p.value)}</td>
        <td>
          <button class="btn small" data-view="${p.id}">详情</button>
          <button class="btn small primary" data-buy="${p.id}" data-from="${club.id}">买入</button>
        </td>
      </tr>`;
    })
    .join("");

  mt.querySelectorAll("[data-view]").forEach((b) => {
    b.onclick = () => showPlayerModal(b.dataset.view);
  });
  mt.querySelectorAll("[data-buy]").forEach((b) => {
    b.onclick = () => {
      const res = buyPlayer(world, b.dataset.buy, b.dataset.from);
      toast(res.msg);
      if (res.ok) {
        saveGame(world);
        refreshAll();
      }
    };
  });

  const club = getUserClub(world);
  const st = $("#sell-table tbody");
  const sorted = [...club.players].sort((a, b) => b.ovr - a.ovr);
  st.innerHTML = sorted
    .map(
      (p) => `<tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${nationLabel(p)}</td>
      <td><span class="badge ${p.pos}">${POS_LABEL[p.pos]}</span></td>
      <td class="${ovrClass(p.ovr)}">${p.ovr}</td>
      <td>${formatMoney(p.value)}</td>
      <td><button class="btn small danger" data-sell="${p.id}">出售</button></td>
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
      let status = "未赛";
      if (f.played) status = "已完赛";
      else if (f.day === world.day) status = "今日";
      else if (f.day < world.day) status = "待踢";
      return `<tr class="${f.day === world.day && !f.played ? "me" : ""}">
        <td>${f.round}</td>
        <td>D${f.day}</td>
        <td>${escapeHtml(home.name)}</td>
        <td>${score}</td>
        <td>${escapeHtml(away.name)}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join("");
}

// ---------- Day / Match ----------
function onAdvance() {
  if (world.seasonOver || (world.fixtures.length && world.fixtures.every((f) => f.played))) {
    toast("赛季已结束，请进入下一赛季");
    return;
  }
  const next = getNextUserMatch(world);
  if (next && next.day === world.day && !next.played) {
    toast("今天有比赛，请先进入比赛！");
    return;
  }
  const { userMatches } = advanceDay(world);
  if (userMatches.length) {
    pendingMatch = userMatches[0];
    const label = pendingMatch.roundLabel || `第 ${pendingMatch.round} 轮`;
    toast(`${label} · 比赛日到了！`);
  } else if (world.seasonOver) {
    toast("赛季结束！查看新闻中的退役与年龄变化");
  }
  autosave("advance");
  refreshAll();
}

function onAdvanceToMatchday() {
  if (world.seasonOver || (world.fixtures.length && world.fixtures.every((f) => f.played))) {
    toast("赛季已结束，请进入下一赛季");
    return;
  }
  const res = advanceToNextMatchDay(world);
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
  } else {
    toast(res.msg || `推进 ${res.days} 天`);
  }
  autosave("advance-matchday");
  refreshAll();
}

function openMatch() {
  const next = getNextUserMatch(world);
  if (!next || next.day > world.day) {
    toast("还没有可踢的比赛");
    return;
  }
  // 若当天之前还有别的日未处理——允许直接踢已到日期的比赛
  // 先自动推进 AI 到该日之前的天？简化：若 day < next.day 不允许；若 day > next.day 且未踢，允许补赛
  if (world.day < next.day) {
    toast("尚未到比赛日，请推进日程");
    return;
  }
  // 补推进：如果 day 超过了 next.day，中间 AI 场次应已在 advance 时踢完
  // 若用户跳过了比赛日（理论上 advance 会拦截），这里兜底
  pendingMatch = next;
  const home = world.clubs.find((c) => c.id === next.home);
  const away = world.clubs.find((c) => c.id === next.away);
  $("#match-home").textContent = home.name;
  $("#match-away").textContent = away.name;
  $("#match-score").textContent = "0 - 0";
  $("#match-minute").textContent = "0'";
  $("#match-log").innerHTML = "";
  $("#btn-sim-fast").disabled = false;
  $("#btn-sim-live").disabled = false;
  $("#btn-match-continue").disabled = true;
  showScreen("match");
}

async function runMatch(live) {
  if (!pendingMatch || pendingMatch.played || liveRunning) return;
  $("#btn-sim-fast").disabled = true;
  $("#btn-sim-live").disabled = true;

  if (!live) {
    const result = simulateMatch(world, pendingMatch);
    const log = $("#match-log");
    log.innerHTML = "";
    let hg = 0;
    let ag = 0;
    for (const ev of result.events) {
      if (ev.type === "goal") {
        if (ev.teamId === pendingMatch.home) hg++;
        else ag++;
      }
      appendMatchEvent(ev);
    }
    $("#match-score").textContent = `${result.homeGoals} - ${result.awayGoals}`;
    $("#match-minute").textContent = "90'";
    finishMatchUI();
  } else {
    liveRunning = true;
    // 为了 live 回放不重复 apply，先克隆 events 路径：
    // 直接 simulate 后回放（结果已写入）
    const result = simulateMatch(world, pendingMatch);
    let hg = 0;
    let ag = 0;
    $("#match-log").innerHTML = "";
    for (const ev of result.events) {
      if (ev.type === "goal") {
        if (ev.teamId === pendingMatch.home) hg++;
        else ag++;
      }
      $("#match-score").textContent = `${hg} - ${ag}`;
      $("#match-minute").textContent = `${ev.minute}'`;
      appendMatchEvent(ev);
      await sleep(ev.type === "goal" ? 220 : 55);
    }
    liveRunning = false;
    finishMatchUI();
  }
  saveGame(world);
}

function finishMatchUI() {
  $("#btn-match-continue").disabled = false;
  $("#btn-sim-fast").disabled = true;
  $("#btn-sim-live").disabled = true;
}

function appendMatchEvent(ev) {
  const div = document.createElement("div");
  div.className = `event ${ev.type}`;
  div.textContent = ev.text;
  const log = $("#match-log");
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
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
      "position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#1e293b;border:1px solid #3d8bfd;padding:0.65rem 1.2rem;border-radius:8px;z-index:200;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:90vw;text-align:center;";
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
initStart();
