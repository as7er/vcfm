/**
 * FM 风格 2D 俯视球场（非 3D）
 * - 双方阵型站位 + 球衣色
 * - 事件驱动：进球 / 扑救 / 角球 / 犯规 时球与球员移动
 * - 空闲时轻微游走 + 传球
 * - 镜头轻跟随球 + 射门轨迹线
 * - 点球员查看属性（中场/终场暂停更明显）
 */

import { FORMATIONS, playerDisplaySurname } from "./data.js";
import { ensureKit, getLineupPlayers, autoLineup } from "./models.js";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 战术站位 → 球场坐标（主队守下方，客队翻转） */
function slotToPitch(slot, isHome) {
  let x = slot.x;
  let y = slot.y;
  if (!isHome) {
    x = 100 - x;
    y = 100 - y;
  }
  return { x, y };
}

function contrastText(hex) {
  const h = String(hex || "#333").replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#111" : "#fff";
}

export class MatchView {
  /**
   * @param {HTMLElement} root - #match-pitch-root
   */
  constructor(root) {
    this.root = root;
    this.home = null;
    this.away = null;
    this.players = [];
    this.ball = { x: 50, y: 50, tx: 50, ty: 50, el: null };
    this.fxLayer = null;
    this.trailSvg = null;
    this.fieldEl = null;
    this.cameraEl = null;
    this.running = false;
    this.raf = 0;
    this.lastTs = 0;
    this.phase = "idle"; // idle | play | goal | pause
    this.possession = "home";
    this.passTimer = 0;
    this.highlightId = null;
    this.flashUntil = 0;
    this.bannerEl = null;
    this.tipEl = null;
    this.cardEl = null;
    this._built = false;
    /** @type {((playerId: string, team: 'home'|'away') => void) | null} */
    this.onPlayerClick = null;
    // 镜头：目标与当前（百分比偏移 → CSS translate）
    this.cam = { x: 0, y: 0, tx: 0, ty: 0, scale: 1, tScale: 1 };
    this.camBoostUntil = 0;
    this.trails = []; // active trail animations
    this.heatLayer = null;
    this.pressLayer = null;
    this.networkSvg = null;
    this.heatCells = []; // {x,y,w,h,home,away,el}
    this.heatTimer = 0;
    this.shapeTimer = 0;
    this.touchTimer = 0;
    /** @type {Map<string, { fromId: string, toId: string, team: string, count: number, last: number }>} */
    this.passNetwork = new Map();
    this.networkEnabled = true;
    this.networkFilter = "both"; // both | home | away
    this.networkDirty = false;
    this.lastCarrierId = null;
  }

  /**
   * @param {object} home
   * @param {object} away
   * @param {{ onPlayerClick?: (playerId, team) => void }} [opts]
   */
  mount(home, away, opts = {}) {
    this.home = home;
    this.away = away;
    if (opts.onPlayerClick) this.onPlayerClick = opts.onPlayerClick;
    this.root.innerHTML = "";
    this.root.classList.add("match-pitch-root");
    this.trails = [];

    const wrap = document.createElement("div");
    wrap.className = "mp-wrap";

    wrap.innerHTML = `
      <div class="mp-boards" aria-hidden="true">
        <span>VCFM</span><span>STADIUM</span><span>MATCHDAY</span><span>LIVE FEED</span>
      </div>
      <div class="mp-field" id="mp-field">
        <div class="mp-camera" id="mp-camera">
          <div class="mp-grass"></div>
          <svg class="mp-lines" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true">
            <rect x="2.5" y="2.5" width="95" height="145" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.55"/>
            <line x1="2.5" y1="75" x2="97.5" y2="75" stroke="rgba(255,255,255,0.48)" stroke-width="0.45"/>
            <circle cx="50" cy="75" r="11" fill="none" stroke="rgba(255,255,255,0.48)" stroke-width="0.45"/>
            <circle cx="50" cy="75" r="0.7" fill="rgba(255,255,255,0.65)"/>
            <rect x="20" y="116" width="60" height="31.5" fill="none" stroke="rgba(255,255,255,0.48)" stroke-width="0.45"/>
            <rect x="32" y="130" width="36" height="17.5" fill="none" stroke="rgba(255,255,255,0.48)" stroke-width="0.45"/>
            <path d="M 36 116 A 14 14 0 0 1 64 116" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.4"/>
            <circle cx="50" cy="126.5" r="0.55" fill="rgba(255,255,255,0.55)"/>
            <rect x="42" y="145" width="16" height="2.5" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.4"/>
            <rect x="20" y="2.5" width="60" height="31.5" fill="none" stroke="rgba(255,255,255,0.48)" stroke-width="0.45"/>
            <rect x="32" y="2.5" width="36" height="17.5" fill="none" stroke="rgba(255,255,255,0.48)" stroke-width="0.45"/>
            <path d="M 36 34 A 14 14 0 0 0 64 34" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.4"/>
            <circle cx="50" cy="23.5" r="0.55" fill="rgba(255,255,255,0.55)"/>
            <rect x="42" y="2.5" width="16" height="2.5" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.4"/>
            <path d="M 2.5 6.5 A 4 4 0 0 0 6.5 2.5" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.4"/>
            <path d="M 93.5 2.5 A 4 4 0 0 0 97.5 6.5" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.4"/>
            <path d="M 2.5 143.5 A 4 4 0 0 1 6.5 147.5" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.4"/>
            <path d="M 93.5 147.5 A 4 4 0 0 1 97.5 143.5" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.4"/>
          </svg>
          <div class="mp-heat" id="mp-heat" aria-hidden="true"></div>
          <svg class="mp-press" id="mp-press" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <svg class="mp-network" id="mp-network" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <svg class="mp-trails" id="mp-trails" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <div class="mp-actors" id="mp-actors"></div>
          <div class="mp-fx" id="mp-fx"></div>
        </div>
        <div class="mp-banner hidden" id="mp-banner"></div>
        <div class="mp-tip" id="mp-tip">点击球员查看属性</div>
        <div class="mp-card hidden" id="mp-card"></div>
      </div>
      <div class="mp-legend">
        <span class="mp-leg home"><i></i><em id="mp-leg-home"></em></span>
        <div class="mp-net-controls">
          <button type="button" class="mp-net-btn active" id="mp-net-toggle" title="Pass network">网</button>
          <button type="button" class="mp-net-btn active" id="mp-net-home" data-net-side="home" title="Home network">主</button>
          <button type="button" class="mp-net-btn active" id="mp-net-away" data-net-side="away" title="Away network">客</button>
        </div>
        <span class="mp-leg away"><i></i><em id="mp-leg-away"></em></span>
      </div>
    `;
    this.root.appendChild(wrap);

    this.fieldEl = wrap.querySelector("#mp-field");
    this.cameraEl = wrap.querySelector("#mp-camera");
    const actors = wrap.querySelector("#mp-actors");
    this.fxLayer = wrap.querySelector("#mp-fx");
    this.trailSvg = wrap.querySelector("#mp-trails");
    this.heatLayer = wrap.querySelector("#mp-heat");
    this.pressLayer = wrap.querySelector("#mp-press");
    this.networkSvg = wrap.querySelector("#mp-network");
    this.bannerEl = wrap.querySelector("#mp-banner");
    this.tipEl = wrap.querySelector("#mp-tip");
    this.cardEl = wrap.querySelector("#mp-card");
    const legH = wrap.querySelector("#mp-leg-home");
    const legA = wrap.querySelector("#mp-leg-away");
    this.passNetwork = new Map();
    this.networkEnabled = true;
    this.networkFilter = "both";
    this.lastCarrierId = null;
    this._initHeatGrid();
    this._bindNetworkControls(wrap);

    // 点空白关闭卡片
    this.fieldEl.addEventListener("click", (e) => {
      if (e.target === this.fieldEl || e.target.closest(".mp-grass") || e.target.closest(".mp-lines")) {
        this.hidePlayerCard();
      }
    });

    autoLineup(home);
    autoLineup(away);
    ensureKit(home);
    ensureKit(away);

    const homeKit = ensureKit(home);
    const awayKit = ensureKit(away);
    let awayPrimary = awayKit.secondary || awayKit.primary;
    if (colorsTooClose(homeKit.primary, awayPrimary)) {
      awayPrimary = awayKit.primary === homeKit.primary ? "#f1f5f9" : awayKit.primary;
      if (colorsTooClose(homeKit.primary, awayPrimary)) awayPrimary = "#f8fafc";
    }

    if (legH) {
      legH.textContent = home.short || home.name;
      legH.previousElementSibling.style.background = homeKit.primary;
    }
    if (legA) {
      legA.textContent = away.short || away.name;
      legA.previousElementSibling.style.background = awayPrimary;
    }

    this.players = [];
    this._spawnTeam(
      actors,
      home,
      true,
      homeKit.primary,
      homeKit.numberColor || contrastText(homeKit.primary)
    );
    this._spawnTeam(actors, away, false, awayPrimary, contrastText(awayPrimary));

    const ballEl = document.createElement("div");
    ballEl.className = "mp-ball";
    actors.appendChild(ballEl);
    this.ball = { x: 50, y: 50, tx: 50, ty: 50, el: ballEl };
    this._applyBall();

    this.cam = { x: 0, y: 0, tx: 0, ty: 0, scale: 1, tScale: 1 };
    this._applyCamera();

    this._built = true;
    this.phase = "idle";
    this._syncClickable();
    this.startLoop();
    this.setBanner("");
    this.hidePlayerCard();
  }

  setOnPlayerClick(fn) {
    this.onPlayerClick = fn;
  }

  _spawnTeam(actors, club, isHome, color, numColor) {
    const form = FORMATIONS[club.tactics?.formation] || FORMATIONS["4-3-3"];
    const xi = getLineupPlayers(club);
    const slots = form.slots || [];
    for (let i = 0; i < Math.min(11, slots.length); i++) {
      const slot = slots[i];
      const p = xi[i];
      const pos = slotToPitch(slot, isHome);
      const el = document.createElement("div");
      el.className = `mp-player ${isHome ? "home" : "away"}`;
      el.dataset.id = p?.id || `slot-${isHome ? "h" : "a"}-${i}`;
      el.dataset.team = isHome ? "home" : "away";
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.title = p?.name || "";
      const num = p?.number ?? i + 1;
      const name = p
        ? playerDisplaySurname(p.name, p.nationality)
        : "?";
      el.innerHTML = `
        <div class="mp-dot" style="background:${color};color:${numColor};border-color:${isHome ? "rgba(255,255,255,0.85)" : "rgba(15,23,42,0.5)"}">
          <span class="mp-num">${num}</span>
        </div>
        <div class="mp-name">${escapeHtml(name)}</div>
      `;
      actors.appendChild(el);

      const onPick = (e) => {
        e.stopPropagation();
        if (!p?.id) return;
        this._selectPlayer(p.id, isHome ? "home" : "away", p, club);
      };
      el.addEventListener("click", onPick);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(e);
        }
      });

      const jitter = () => (Math.random() - 0.5) * 2.5;
      const baseX = clamp(pos.x + jitter(), 4, 96);
      const baseY = clamp(pos.y + jitter(), 4, 96);
      this.players.push({
        id: p?.id,
        player: p,
        club,
        team: isHome ? "home" : "away",
        el,
        x: baseX,
        y: baseY,
        tx: baseX,
        ty: baseY,
        baseX,
        baseY,
        num,
        name,
        pos: p?.pos || slot.pos,
        touchUntil: 0,
        heatAcc: 0,
      });
      this._applyPlayer(this.players[this.players.length - 1]);
    }
  }

  /** 6×8 热区网格（半透明叠层） */
  _initHeatGrid() {
    this.heatCells = [];
    if (!this.heatLayer) return;
    this.heatLayer.innerHTML = "";
    const cols = 6;
    const rows = 8;
    const w = 100 / cols;
    const h = 100 / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const el = document.createElement("div");
        el.className = "mp-heat-cell";
        el.style.left = `${c * w}%`;
        el.style.top = `${r * h}%`;
        el.style.width = `${w}%`;
        el.style.height = `${h}%`;
        this.heatLayer.appendChild(el);
        this.heatCells.push({ x: c * w, y: r * h, w, h, home: 0, away: 0, el });
      }
    }
  }

  _markHeat(x, y, team, amount = 1) {
    if (!this.heatCells.length) return;
    for (const cell of this.heatCells) {
      if (x >= cell.x && x < cell.x + cell.w && y >= cell.y && y < cell.y + cell.h) {
        if (team === "home") cell.home += amount;
        else cell.away += amount;
        break;
      }
    }
  }

  _refreshHeatVisual() {
    let max = 0.01;
    for (const c of this.heatCells) max = Math.max(max, c.home, c.away);
    for (const c of this.heatCells) {
      const h = c.home / max;
      const a = c.away / max;
      if (h < 0.08 && a < 0.08) {
        c.el.style.background = "transparent";
        continue;
      }
      // 主队偏蓝、客队偏红，重叠处偏紫
      const hr = Math.round(61 * h);
      const hg = Math.round(139 * h);
      const hb = Math.round(253 * h);
      const ar = Math.round(248 * a);
      const ag = Math.round(113 * a);
      const ab = Math.round(113 * a);
      const alpha = clamp(Math.max(h, a) * 0.42, 0.04, 0.38);
      if (h >= a) {
        c.el.style.background = `rgba(${hr},${hg},${hb},${alpha})`;
      } else {
        c.el.style.background = `rgba(${ar},${ag},${ab},${alpha})`;
      }
    }
  }

  /** 持球触球高亮 */
  _setTouch(pl, ms = 700) {
    if (!pl) return;
    pl.touchUntil = performance.now() + ms;
    pl.el.classList.add("has-ball");
    this._markHeat(pl.x, pl.y, pl.team, 1.2);
  }

  _updateTouchClasses(ts) {
    for (const pl of this.players) {
      const on = pl.touchUntil > ts;
      pl.el.classList.toggle("has-ball", on);
    }
  }

  /** 压迫线 / 防线：SVG 横线随队形上下移动 */
  _updatePressLines() {
    if (!this.pressLayer) return;
    const homeOut = this.players.filter(
      (p) => p.team === "home" && p.pos !== "GK" && !p.el.classList.contains("sent-off")
    );
    const awayOut = this.players.filter(
      (p) => p.team === "away" && p.pos !== "GK" && !p.el.classList.contains("sent-off")
    );
    const avgY = (list) =>
      list.length ? list.reduce((s, p) => s + p.y, 0) / list.length : 50;
    const homeDefs = homeOut.filter((p) => p.pos === "DEF");
    const awayDefs = awayOut.filter((p) => p.pos === "DEF");
    const hy = avgY(homeOut);
    const ay = avgY(awayOut);
    const hDefY = avgY(homeDefs.length ? homeDefs : homeOut);
    const aDefY = avgY(awayDefs.length ? awayDefs : awayOut);

    // 持球方压迫线更靠前、更亮
    const homePress = this.possession === "home";
    this.pressLayer.innerHTML = `
      <line class="mp-press-line home ${homePress ? "active" : ""}" x1="6" y1="${hy.toFixed(1)}" x2="94" y2="${hy.toFixed(1)}" />
      <line class="mp-def-line home" x1="10" y1="${hDefY.toFixed(1)}" x2="90" y2="${hDefY.toFixed(1)}" />
      <line class="mp-press-line away ${!homePress ? "active" : ""}" x1="6" y1="${ay.toFixed(1)}" x2="94" y2="${ay.toFixed(1)}" />
      <line class="mp-def-line away" x1="10" y1="${aDefY.toFixed(1)}" x2="90" y2="${aDefY.toFixed(1)}" />
    `;
  }

  _bindNetworkControls(wrap) {
    const toggle = wrap.querySelector("#mp-net-toggle");
    const homeBtn = wrap.querySelector("#mp-net-home");
    const awayBtn = wrap.querySelector("#mp-net-away");
    const syncFilter = () => {
      const h = homeBtn?.classList.contains("active");
      const a = awayBtn?.classList.contains("active");
      if (h && a) this.networkFilter = "both";
      else if (h) this.networkFilter = "home";
      else if (a) this.networkFilter = "away";
      else this.networkFilter = "none";
      this.networkDirty = true;
      this._redrawNetwork(true);
    };
    toggle?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.networkEnabled = !this.networkEnabled;
      toggle.classList.toggle("active", this.networkEnabled);
      this.networkSvg?.classList.toggle("hidden", !this.networkEnabled);
      if (this.networkEnabled) this._redrawNetwork(true);
    });
    homeBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      homeBtn.classList.toggle("active");
      // 至少保留一方
      if (!homeBtn.classList.contains("active") && !awayBtn?.classList.contains("active")) {
        awayBtn?.classList.add("active");
      }
      syncFilter();
    });
    awayBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      awayBtn.classList.toggle("active");
      if (!awayBtn.classList.contains("active") && !homeBtn?.classList.contains("active")) {
        homeBtn?.classList.add("active");
      }
      syncFilter();
    });
  }

  /**
   * 记录一次成功传球（用于网络图）
   * @param {object} fromPl
   * @param {object} toPl
   */
  _recordPass(fromPl, toPl) {
    if (!fromPl?.id || !toPl?.id || fromPl.id === toPl.id) return;
    if (fromPl.team !== toPl.team) return;
    // 无向边 key（同一对球员合并）
    const a = fromPl.id;
    const b = toPl.id;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const prev = this.passNetwork.get(key);
    if (prev) {
      prev.count += 1;
      prev.last = performance.now();
      // 保留最近一次方向，用于轻微箭头感
      prev.fromId = fromPl.id;
      prev.toId = toPl.id;
    } else {
      this.passNetwork.set(key, {
        fromId: fromPl.id,
        toId: toPl.id,
        team: fromPl.team,
        count: 1,
        last: performance.now(),
      });
    }
    // 更新网络节点平均位置（触球位置）
    for (const pl of [fromPl, toPl]) {
      if (pl.netX == null) {
        pl.netX = pl.x;
        pl.netY = pl.y;
      } else {
        pl.netX = pl.netX * 0.82 + pl.x * 0.18;
        pl.netY = pl.netY * 0.82 + pl.y * 0.18;
      }
      pl.passTouches = (pl.passTouches || 0) + 1;
    }
    this.networkDirty = true;
  }

  /** 网络节点坐标：平均触球位优先，否则阵型位 */
  _netPos(pl) {
    if (!pl) return { x: 50, y: 50 };
    if (pl.netX != null && pl.netY != null) {
      return {
        x: pl.netX * 0.65 + pl.baseX * 0.35,
        y: pl.netY * 0.65 + pl.baseY * 0.35,
      };
    }
    return { x: pl.baseX, y: pl.baseY };
  }

  /**
   * 重绘传球网络：线宽∝次数，透明度∝最近活跃
   * @param {boolean} [force]
   */
  _redrawNetwork(force = false) {
    if (!this.networkSvg) return;
    if (!this.networkEnabled) {
      this.networkSvg.innerHTML = "";
      return;
    }
    if (!force && !this.networkDirty) return;
    this.networkDirty = false;

    const now = performance.now();
    const byId = new Map(this.players.map((p) => [p.id, p]));
    let maxCount = 1;
    const edges = [];
    for (const edge of this.passNetwork.values()) {
      if (this.networkFilter === "home" && edge.team !== "home") continue;
      if (this.networkFilter === "away" && edge.team !== "away") continue;
      if (this.networkFilter === "none") continue;
      maxCount = Math.max(maxCount, edge.count);
      edges.push(edge);
    }
    // 次数多的画在上层
    edges.sort((a, b) => a.count - b.count);

    const parts = [];
    // 节点：有传球参与的球员
    const nodeIds = new Set();
    for (const e of edges) {
      nodeIds.add(e.fromId);
      nodeIds.add(e.toId);
    }
    for (const e of edges) {
      const from = byId.get(e.fromId);
      const to = byId.get(e.toId);
      if (!from || !to) continue;
      if (from.el.classList.contains("sent-off") || to.el.classList.contains("sent-off")) continue;
      const p0 = this._netPos(from);
      const p1 = this._netPos(to);
      const t = e.count / maxCount;
      const age = clamp(1 - (now - e.last) / 45000, 0.35, 1);
      const sw = 0.35 + t * 1.85;
      const op = (0.22 + t * 0.55) * age;
      const cls = e.team === "home" ? "home" : "away";
      // 轻微弧线，避免重叠直线
      const mx = (p0.x + p1.x) / 2 + (p0.y - p1.y) * 0.06;
      const my = (p0.y + p1.y) / 2 + (p1.x - p0.x) * 0.06;
      parts.push(
        `<path class="mp-net-edge ${cls}" d="M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}" stroke-width="${sw.toFixed(2)}" opacity="${op.toFixed(2)}" data-count="${e.count}" />`
      );
    }
    for (const id of nodeIds) {
      const pl = byId.get(id);
      if (!pl || pl.el.classList.contains("sent-off")) continue;
      if (this.networkFilter === "home" && pl.team !== "home") continue;
      if (this.networkFilter === "away" && pl.team !== "away") continue;
      const p = this._netPos(pl);
      const touches = pl.passTouches || 1;
      const r = clamp(0.55 + Math.sqrt(touches) * 0.28, 0.55, 1.6);
      parts.push(
        `<circle class="mp-net-node ${pl.team}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(2)}" />`
      );
    }
    this.networkSvg.innerHTML = parts.join("");
  }

  /**
   * 阵型游走：持球方前压，无球方收缩；中场三角轻微联动
   */
  _shapeDrift() {
    if (this.phase === "pause" || this.phase === "goal") return;
    const dirHome = this.possession === "home" ? -1 : 0.35;
    const dirAway = this.possession === "away" ? 1 : -0.35;
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      const dir = pl.team === "home" ? dirHome : dirAway;
      let spread = 5;
      let push = 3;
      if (pl.pos === "GK") {
        spread = 1.5;
        push = 0.5;
      } else if (pl.pos === "DEF") {
        spread = 3.5;
        push = 2.2;
      } else if (pl.pos === "MID") {
        spread = 6;
        push = 4;
      } else {
        spread = 7;
        push = 5.5;
      }
      // 持球方前场更散、无球方内收
      const hasBall = pl.team === this.possession;
      if (!hasBall) {
        spread *= 0.7;
        push *= 0.55;
        // 向中路收缩
        pl.tx = clamp(pl.baseX * 0.55 + 50 * 0.45 + (Math.random() - 0.5) * spread, 6, 94);
      } else {
        pl.tx = clamp(pl.baseX + (Math.random() - 0.5) * spread, 6, 94);
      }
      pl.ty = clamp(pl.baseY + dir * push + (Math.random() - 0.5) * (spread * 0.5), 5, 95);
    }
  }

  _selectPlayer(playerId, team, playerObj, club) {
    // 高亮
    for (const pl of this.players) {
      pl.el.classList.toggle("selected", pl.id === playerId);
    }
    const pl = this.players.find((x) => x.id === playerId);
    const p = playerObj || pl?.player;
    const c = club || pl?.club;
    if (p) this.showPlayerCard(p, c, team);

    if (typeof this.onPlayerClick === "function") {
      this.onPlayerClick(playerId, team);
    }
  }

  showPlayerCard(player, club, team) {
    if (!this.cardEl || !player) return;
    const a = player.attrs || {};
    const isGk = player.pos === "GK";
    const stats = player.stats || {};
    const kit = club ? ensureKit(club) : null;
    const color = kit?.primary || (team === "home" ? "#3d8bfd" : "#f8fafc");
    const rows = isGk
      ? [
          ["反应", a.reflexes],
          ["手控", a.handling],
          ["站位", a.positioning],
          ["开球", a.kicking],
        ]
      : [
          ["速度", a.pace],
          ["射门", a.shooting],
          ["传球", a.passing],
          ["盘带", a.dribbling],
          ["防守", a.defending],
          ["终结", a.finishing],
        ];
    const bars = rows
      .filter(([, v]) => v != null)
      .map(
        ([label, v]) => `
        <div class="mp-card-row">
          <span>${escapeHtml(label)}</span>
          <div class="mp-card-bar"><i style="width:${clamp((v / 20) * 100, 4, 100)}%"></i></div>
          <em>${v}</em>
        </div>`
      )
      .join("");

    this.cardEl.innerHTML = `
      <button type="button" class="mp-card-close" aria-label="close">×</button>
      <div class="mp-card-head">
        <span class="mp-card-dot" style="background:${color}"></span>
        <div>
          <strong>${escapeHtml(player.name)}</strong>
          <div class="mp-card-sub">
            #${player.number ?? "—"} · ${player.pos || "?"} · OVR ${player.ovr ?? "—"}
            ${player.potential != null ? ` · POT ${player.potential}` : ""}
          </div>
        </div>
      </div>
      <div class="mp-card-meta">
        <span>体能 ${Math.round(player.fitness ?? 100)}</span>
        <span>士气 ${Math.round(player.morale ?? 70)}</span>
        ${player.injured > 0 ? `<span class="bad">伤 ${player.injured}天</span>` : ""}
      </div>
      <div class="mp-card-attrs">${bars}</div>
      <div class="mp-card-season muted">
        本赛季 · 出场 ${stats.apps || 0}
        ${isGk ? ` · 零封 ${stats.cleanSheets || 0} · 失球 ${stats.goalsConceded || 0}` : ` · 进球 ${stats.goals || 0} · 助攻 ${stats.assists || 0}`}
      </div>
      <button type="button" class="btn small mp-card-more" data-pid="${escapeHtml(player.id)}">完整资料</button>
    `;
    this.cardEl.classList.remove("hidden");
    this.cardEl.querySelector(".mp-card-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hidePlayerCard();
    });
    this.cardEl.querySelector(".mp-card-more")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof this.onPlayerClick === "function") {
        this.onPlayerClick(player.id, team);
      }
    });
  }

  hidePlayerCard() {
    if (!this.cardEl) return;
    this.cardEl.classList.add("hidden");
    this.cardEl.innerHTML = "";
    for (const pl of this.players) pl.el.classList.remove("selected");
  }

  _syncClickable() {
    const pause = this.phase === "pause" || this.phase === "idle";
    this.fieldEl?.classList.toggle("mp-clickable", true);
    this.fieldEl?.classList.toggle("mp-paused", this.phase === "pause");
    if (this.tipEl) {
      this.tipEl.classList.toggle("show", this.phase === "pause");
    }
    // legend mid is network controls now
    // 暂停时放大可点区域观感
    for (const pl of this.players) {
      pl.el.classList.toggle("clickable", true);
      pl.el.classList.toggle("pause-glow", pause && this.phase === "pause");
    }
  }

  _applyPlayer(pl) {
    pl.el.style.left = `${pl.x}%`;
    pl.el.style.top = `${pl.y}%`;
  }

  _applyBall() {
    if (!this.ball.el) return;
    this.ball.el.style.left = `${this.ball.x}%`;
    this.ball.el.style.top = `${this.ball.y}%`;
  }

  /** 镜头：以球为中心轻微平移 + 缩放 */
  _updateCameraTarget() {
    // 球偏离中心时镜头跟过去（最大偏移约 8%）
    const ox = (this.ball.x - 50) / 50; // -1..1
    const oy = (this.ball.y - 50) / 50;
    this.cam.tx = clamp(-ox * 6, -8, 8);
    this.cam.ty = clamp(-oy * 5, -7, 7);
    // 进球瞬间略放大
    if (performance.now() < this.camBoostUntil) {
      this.cam.tScale = 1.12;
    } else if (this.phase === "goal") {
      this.cam.tScale = 1.1;
    } else if (this.phase === "pause") {
      this.cam.tScale = 1;
      this.cam.tx = 0;
      this.cam.ty = 0;
    } else {
      this.cam.tScale = 1.04;
    }
  }

  _applyCamera() {
    if (!this.cameraEl) return;
    const { x, y, scale } = this.cam;
    this.cameraEl.style.transform = `translate(${x}%, ${y}%) scale(${scale})`;
  }

  startLoop() {
    if (this.running) return;
    this.running = true;
    this.lastTs = performance.now();
    const tick = (ts) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
      this.lastTs = ts;
      this.update(dt, ts);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopLoop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stopLoop();
    this.root.innerHTML = "";
    this.players = [];
    this.trails = [];
    this.passNetwork = new Map();
    this.networkSvg = null;
    this._built = false;
  }

  update(dt, ts) {
    if (this.phase === "idle" || this.phase === "play") {
      this.passTimer -= dt;
      if (this.passTimer <= 0) {
        this.passTimer = 0.75 + Math.random() * 1.1;
        this._idlePass();
      }
      // 阵型游走：持球前压 / 无球收缩
      this.shapeTimer -= dt;
      if (this.shapeTimer <= 0) {
        this.shapeTimer = 1.6 + Math.random() * 1.4;
        this._shapeDrift();
      }
      for (const pl of this.players) {
        // 更频繁的微步移动
        if (Math.random() < (this.phase === "play" ? 0.035 : 0.02)) {
          const hasBall = pl.team === this.possession;
          const jx = hasBall ? 5 : 3;
          const jy = hasBall ? 4 : 2.5;
          pl.tx = clamp(pl.tx + (Math.random() - 0.5) * jx, 5, 95);
          pl.ty = clamp(pl.ty + (Math.random() - 0.5) * jy, 5, 95);
        }
        // 无球方靠近持球人压迫
        if (
          pl.team !== this.possession &&
          pl.pos !== "GK" &&
          !pl.el.classList.contains("sent-off") &&
          Math.random() < 0.012
        ) {
          pl.tx = clamp(pl.tx * 0.7 + this.ball.tx * 0.3, 6, 94);
          pl.ty = clamp(pl.ty * 0.7 + this.ball.ty * 0.3, 6, 94);
        }
        pl.x = lerp(pl.x, pl.tx, 1 - Math.pow(0.015, dt));
        pl.y = lerp(pl.y, pl.ty, 1 - Math.pow(0.015, dt));
        this._applyPlayer(pl);
        // 持续采样热区
        pl.heatAcc = (pl.heatAcc || 0) + dt;
        if (pl.heatAcc > 0.45) {
          pl.heatAcc = 0;
          this._markHeat(pl.x, pl.y, pl.team, 0.35);
        }
      }
    } else {
      for (const pl of this.players) {
        pl.x = lerp(pl.x, pl.tx, 1 - Math.pow(0.001, dt));
        pl.y = lerp(pl.y, pl.ty, 1 - Math.pow(0.001, dt));
        this._applyPlayer(pl);
      }
    }

    this.ball.x = lerp(this.ball.x, this.ball.tx, 1 - Math.pow(0.0008, dt));
    this.ball.y = lerp(this.ball.y, this.ball.ty, 1 - Math.pow(0.0008, dt));
    this._applyBall();
    // 球附近采样热区
    this._markHeat(this.ball.x, this.ball.y, this.possession, 0.08 * (dt * 60));

    this._updateCameraTarget();
    this.cam.x = lerp(this.cam.x, this.cam.tx, 1 - Math.pow(0.05, dt));
    this.cam.y = lerp(this.cam.y, this.cam.ty, 1 - Math.pow(0.05, dt));
    this.cam.scale = lerp(this.cam.scale, this.cam.tScale, 1 - Math.pow(0.08, dt));
    this._applyCamera();

    this._updateTrails(dt);
    this._updateTouchClasses(ts);

    this.heatTimer -= dt;
    if (this.heatTimer <= 0) {
      this.heatTimer = 0.5;
      this._refreshHeatVisual();
      this._updatePressLines();
      // 网络节点随位置缓慢漂移，需定期重绘
      if (this.networkEnabled) this._redrawNetwork(true);
    } else if (this.networkDirty && this.networkEnabled) {
      this._redrawNetwork(true);
    }

    if (this.highlightId && ts > this.flashUntil) {
      this._clearHighlight();
    }
  }

  _idlePass() {
    if (this.phase === "pause") return;
    const side = this.possession;
    const pool = this.players.filter(
      (p) => p.team === side && p.pos !== "GK" && !p.el.classList.contains("sent-off")
    );
    if (pool.length < 2) return;
    // 优先靠近球的球员接应
    pool.sort(
      (a, b) =>
        Math.hypot(a.x - this.ball.x, a.y - this.ball.y) -
        Math.hypot(b.x - this.ball.x, b.y - this.ball.y)
    );
    const a = pool[Math.floor(Math.random() * Math.min(4, pool.length))];
    // 三角传球：选另一名同队较近的
    const others = pool.filter((p) => p !== a);
    others.sort(
      (p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)
    );
    const b = others[Math.floor(Math.random() * Math.min(3, others.length))] || others[0];
    if (!b) return;

    const push = this.possession === "home" ? -1 : 1;
    a.tx = clamp(a.baseX + (Math.random() - 0.5) * 5, 6, 94);
    a.ty = clamp(a.baseY + push * 2.5 + (Math.random() - 0.5) * 3, 6, 94);
    this._setTouch(a, 500);

    // 无球方 1–2 人上抢
    const pressers = this.players.filter(
      (p) =>
        p.team !== side &&
        p.pos !== "GK" &&
        !p.el.classList.contains("sent-off")
    );
    for (const pr of pressers.slice(0, 2)) {
      if (Math.random() < 0.55) {
        pr.tx = clamp(a.x + (Math.random() - 0.5) * 8, 6, 94);
        pr.ty = clamp(a.y + (Math.random() - 0.5) * 6, 6, 94);
      }
    }

    const from = { x: this.ball.x, y: this.ball.y };
    this.ball.tx = a.x;
    this.ball.ty = a.y;
    this._addTrail(from.x, from.y, a.x, a.y, "pass", 0.32);
    this._markHeat(a.x, a.y, side, 0.8);
    // 上一持球人 → a 也算一次网络边（若有）
    if (this.lastCarrierId && this.lastCarrierId !== a.id) {
      const prev = this.players.find((p) => p.id === this.lastCarrierId);
      if (prev && prev.team === a.team) this._recordPass(prev, a);
    }
    this.lastCarrierId = a.id;

    setTimeout(() => {
      if (!this._built) return;
      const fx = this.ball.x;
      const fy = this.ball.y;
      this.ball.tx = b.x + (Math.random() - 0.5) * 2.5;
      this.ball.ty = b.y + (Math.random() - 0.5) * 2.5;
      this._addTrail(fx, fy, this.ball.tx, this.ball.ty, "pass", 0.38);
      this._setTouch(b, 650);
      this._markHeat(b.x, b.y, side, 1);
      this._recordPass(a, b);
      this.lastCarrierId = b.id;
      b.tx = clamp(b.baseX + (Math.random() - 0.5) * 6, 6, 94);
      b.ty = clamp(b.baseY + push * 3.5, 6, 94);
      // 偶发一脚转移给第三名
      if (Math.random() < 0.28 && others.length > 1) {
        const c = others[Math.min(others.length - 1, 1 + Math.floor(Math.random() * 2))];
        setTimeout(() => {
          if (!this._built || !c) return;
          const fx2 = this.ball.x;
          const fy2 = this.ball.y;
          this.ball.tx = c.x;
          this.ball.ty = c.y;
          this._addTrail(fx2, fy2, c.x, c.y, "pass", 0.35);
          this._setTouch(c, 600);
          this._recordPass(b, c);
          this.lastCarrierId = c.id;
        }, 260);
      }
    }, 240);

    if (Math.random() < 0.2) {
      this.possession = this.possession === "home" ? "away" : "home";
    }
  }

  /**
   * 射门/传球轨迹
   * @param {string} kind goal|shot|save|pass|wood
   */
  _addTrail(x0, y0, x1, y1, kind = "shot", life = 0.7) {
    if (!this.trailSvg) return;
    // 二次贝塞尔：中点侧偏模拟弧线
    const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * (kind === "pass" ? 4 : 10);
    const my = (y0 + y1) / 2 + (kind === "goal" || kind === "shot" ? (y1 < y0 ? -6 : 6) : 0);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = `M ${x0} ${y0} Q ${mx} ${my} ${x1} ${y1}`;
    path.setAttribute("d", d);
    path.setAttribute("class", `mp-trail mp-trail-${kind}`);
    path.setAttribute("fill", "none");
    this.trailSvg.appendChild(path);
    // 测量长度做 dash 动画
    let len = 80;
    try {
      len = path.getTotalLength() || 80;
    } catch (_) {}
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    this.trails.push({ el: path, life, max: life, len });
    // 限制数量
    while (this.trails.length > 8) {
      const old = this.trails.shift();
      old.el.remove();
    }
  }

  _updateTrails(dt) {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      tr.life -= dt;
      const t = 1 - tr.life / tr.max;
      // 画出轨迹
      const draw = clamp(t * 1.4, 0, 1);
      tr.el.style.strokeDashoffset = String(tr.len * (1 - draw));
      tr.el.style.opacity = String(clamp(tr.life / tr.max, 0, 1));
      if (tr.life <= 0) {
        tr.el.remove();
        this.trails.splice(i, 1);
      }
    }
  }

  /** 球飞向目标并画轨迹 */
  _shootBall(tx, ty, kind = "shot") {
    this._addTrail(this.ball.x, this.ball.y, tx, ty, kind, kind === "goal" ? 0.9 : 0.65);
    this.ball.tx = tx;
    this.ball.ty = ty;
    if (kind === "goal" || kind === "shot") {
      this.camBoostUntil = performance.now() + 900;
    }
  }

  _clearHighlight() {
    this.highlightId = null;
    for (const pl of this.players) pl.el.classList.remove("highlight", "scorer");
  }

  setBanner(text, kind = "") {
    if (!this.bannerEl) return;
    if (!text) {
      this.bannerEl.classList.add("hidden");
      this.bannerEl.textContent = "";
      return;
    }
    this.bannerEl.textContent = text;
    this.bannerEl.className = `mp-banner ${kind}`;
    this.bannerEl.classList.remove("hidden");
  }

  /**
   * 根据比赛事件驱动画面
   */
  onEvent(ev, snap, fixture) {
    if (!this._built || !ev || ev.type === "tick") return;
    const homeId = fixture?.home || this.home?.id;
    const isHomeTeam = (teamId) => teamId === homeId;

    switch (ev.type) {
      case "kickoff":
        this.phase = "play";
        this.hidePlayerCard();
        this._shootBall(50, 50, "pass");
        this.possession = Math.random() < 0.5 ? "home" : "away";
        this.setBanner(ev.text || "Kick-off", "info");
        setTimeout(() => this.setBanner(""), 1200);
        this._syncClickable();
        break;

      case "context":
        this.setBanner(ev.text?.replace(/^情境：/, "") || "", "info");
        setTimeout(() => this.setBanner(""), 2000);
        break;

      case "goal": {
        this.phase = "goal";
        this.hidePlayerCard();
        const attHome = isHomeTeam(ev.teamId);
        this.possession = attHome ? "home" : "away";
        const gx = 50 + (Math.random() - 0.5) * 8;
        const gy = attHome ? 4 + Math.random() * 3 : 96 - Math.random() * 3;
        const scorer = this.players.find((p) => p.id === ev.playerId);
        if (scorer) {
          scorer.tx = gx + (Math.random() - 0.5) * 4;
          scorer.ty = attHome ? 14 : 86;
          scorer.el.classList.add("highlight", "scorer");
          this.highlightId = scorer.id;
          this.flashUntil = performance.now() + 2200;
          this._setTouch(scorer, 1800);
          // 助攻链：上一持球人 → 射手
          if (this.lastCarrierId && this.lastCarrierId !== scorer.id) {
            const assister = this.players.find((p) => p.id === this.lastCarrierId);
            if (assister && assister.team === scorer.team) this._recordPass(assister, scorer);
          }
          this.lastCarrierId = scorer.id;
          // 从射手位置起脚
          this.ball.x = scorer.x;
          this.ball.y = scorer.y;
          this._markHeat(scorer.x, scorer.y, scorer.team, 3);
        }
        this._shootBall(gx, gy, "goal");
        this._markHeat(gx, gy, attHome ? "home" : "away", 4);
        for (const pl of this.players.filter(
          (p) => p.team === (attHome ? "home" : "away") && p.id !== ev.playerId
        )) {
          if (Math.random() < 0.45) {
            pl.tx = clamp((scorer?.tx || 50) + (Math.random() - 0.5) * 14, 8, 92);
            pl.ty = clamp((scorer?.ty || 50) + (Math.random() - 0.5) * 10, 8, 92);
          }
        }
        this._burst(gx, gy, "goal");
        this._refreshHeatVisual();
        this.setBanner(`⚽ ${snap.homeGoals} - ${snap.awayGoals}`, "goal");
        setTimeout(() => {
          this.phase = "play";
          this._resetShape();
          this.ball.tx = 50;
          this.ball.ty = 50;
          this.setBanner("");
          this._syncClickable();
        }, 1600);
        this._syncClickable();
        break;
      }

      case "chance":
      case "woodwork": {
        const attHome = ev.teamId ? isHomeTeam(ev.teamId) : this.possession === "home";
        const tx = 40 + Math.random() * 20;
        const ty = attHome ? 10 + Math.random() * 12 : 78 + Math.random() * 12;
        this._pushAttack(attHome ? "home" : "away");
        const shooter = this.players
          .filter((p) => p.team === (attHome ? "home" : "away") && p.pos === "ATT")
          .sort(() => Math.random() - 0.5)[0];
        if (shooter) this._setTouch(shooter, 900);
        this._shootBall(tx, ty, ev.type === "woodwork" ? "wood" : "shot");
        this._markHeat(tx, ty, attHome ? "home" : "away", 2.5);
        if (ev.type === "woodwork") this._burst(tx, ty, "wood");
        this._refreshHeatVisual();
        break;
      }

      case "save": {
        const saveHome = isHomeTeam(ev.teamId);
        const tx = 48 + Math.random() * 4;
        const ty = saveHome ? 90 + Math.random() * 5 : 5 + Math.random() * 5;
        this._shootBall(tx, ty, "save");
        const gk = this.players.find(
          (p) => p.team === (saveHome ? "home" : "away") && p.pos === "GK"
        );
        if (gk) {
          gk.tx = tx;
          gk.ty = ty;
          gk.el.classList.add("highlight");
          this.highlightId = gk.id;
          this.flashUntil = performance.now() + 1000;
          this._setTouch(gk, 800);
        }
        this._markHeat(tx, ty, saveHome ? "home" : "away", 2);
        this._burst(tx, ty, "save");
        this._refreshHeatVisual();
        break;
      }

      case "penalty":
      case "pen_miss": {
        const attHome = ev.teamId ? isHomeTeam(ev.teamId) : true;
        const ty = attHome ? 12 : 88;
        this._pushAttack(attHome ? "home" : "away");
        this._shootBall(50, ty, ev.type === "penalty" ? "shot" : "save");
        this.setBanner(ev.type === "penalty" ? "❗ PEN" : "😮", "warn");
        setTimeout(() => this.setBanner(""), 1000);
        break;
      }

      case "corner": {
        const attHome = ev.teamId ? isHomeTeam(ev.teamId) : this.possession === "home";
        const left = Math.random() < 0.5;
        const tx = left ? 4 : 96;
        const ty = attHome ? 6 : 94;
        this._pushAttack(attHome ? "home" : "away");
        this._shootBall(tx, ty, "pass");
        break;
      }

      case "card":
      case "red": {
        const foulHome = ev.teamId ? isHomeTeam(ev.teamId) : true;
        const pl = this.players.find((p) => p.id === ev.playerId);
        if (pl) {
          pl.el.classList.add("highlight");
          this.highlightId = pl.id;
          this.flashUntil = performance.now() + 1400;
        }
        this.ball.tx = 50 + (Math.random() - 0.5) * 20;
        this.ball.ty = 50 + (Math.random() - 0.5) * 20;
        this.setBanner(ev.type === "red" ? "🟥" : "🟨", "warn");
        setTimeout(() => this.setBanner(""), 900);
        if (ev.type === "red" && pl) {
          pl.el.classList.add("sent-off");
          pl.tx = 50;
          pl.ty = foulHome ? 102 : -2;
        }
        break;
      }

      case "injury": {
        const pl = this.players.find((p) => p.id === ev.playerId);
        if (pl) {
          pl.el.classList.add("injured");
          this.highlightId = pl.id;
          this.flashUntil = performance.now() + 1500;
          this.ball.tx = pl.x;
          this.ball.ty = pl.y;
        }
        this.setBanner("🏥", "warn");
        setTimeout(() => this.setBanner(""), 900);
        break;
      }

      case "sub": {
        this._resetShape();
        this.setBanner("🔄", "info");
        setTimeout(() => this.setBanner(""), 800);
        break;
      }

      case "ht":
        this.phase = "pause";
        this.setBanner(ev.text || "HT", "info");
        this.ball.tx = 50;
        this.ball.ty = 50;
        this.cam.tx = 0;
        this.cam.ty = 0;
        this.cam.tScale = 1;
        this._syncClickable();
        break;

      case "ft":
        this.phase = "pause";
        this.setBanner(ev.text || "FT", "info");
        this.ball.tx = 50;
        this.ball.ty = 50;
        this.cam.tx = 0;
        this.cam.ty = 0;
        this.cam.tScale = 1;
        this._syncClickable();
        break;

      case "tactics":
        this._resetShape();
        break;

      default:
        break;
    }
  }

  _pushAttack(team) {
    this.possession = team;
    const dir = team === "home" ? -1 : 1;
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      if (pl.team === team && pl.pos !== "GK") {
        pl.tx = clamp(pl.baseX + (Math.random() - 0.5) * 6, 6, 94);
        pl.ty = clamp(pl.baseY + dir * (4 + Math.random() * 8), 6, 94);
      } else if (pl.team !== team && pl.pos !== "GK") {
        pl.tx = clamp(pl.baseX + (Math.random() - 0.5) * 4, 6, 94);
        pl.ty = clamp(pl.baseY + dir * 2, 6, 94);
      }
    }
  }

  _resetShape() {
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      pl.tx = pl.baseX + (Math.random() - 0.5) * 2;
      pl.ty = pl.baseY + (Math.random() - 0.5) * 2;
    }
  }

  async replayEvents(events, fixture, { onStep, speed = 1 } = {}) {
    this.phase = "play";
    this._syncClickable();
    let hg = 0;
    let ag = 0;
    for (const ev of events || []) {
      if (ev.type === "tick") continue;
      if (ev.type === "goal") {
        if (ev.teamId === fixture.home) hg++;
        else ag++;
      }
      const snap = { homeGoals: hg, awayGoals: ag, minute: ev.minute };
      this.onEvent(ev, snap, fixture);
      if (onStep) onStep(ev, snap);
      const wait =
        ev.type === "goal"
          ? 520 / speed
          : ev.type === "ht" || ev.type === "ft"
            ? 300 / speed
            : ev.type === "kickoff"
              ? 220 / speed
              : 100 / speed;
      await sleep(wait);
    }
  }

  _burst(x, y, kind) {
    if (!this.fxLayer) return;
    const el = document.createElement("div");
    el.className = `mp-burst ${kind}`;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    this.fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }
}

function colorsTooClose(a, b) {
  const parse = (hex) => {
    const h = String(hex || "").replace("#", "");
    if (h.length < 6) return [0, 0, 0];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 80;
}

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

let singleton = null;

export function getMatchView(root) {
  if (!root) return null;
  if (!singleton || singleton.root !== root) {
    if (singleton) singleton.destroy();
    singleton = new MatchView(root);
  }
  return singleton;
}

export function destroyMatchView() {
  if (singleton) {
    singleton.destroy();
    singleton = null;
  }
}
