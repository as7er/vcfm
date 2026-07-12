/**
 * FM 风格 2D 俯视球场（非 3D）
 * - 双方阵型站位 + 球衣色
 * - 事件驱动：进球 / 扑救 / 角球 / 犯规 时球与球员移动
 * - 空闲时轻微游走 + 传球
 */

import { FORMATIONS } from "./data.js";
import { ensureKit, getLineupPlayers, autoLineup } from "./models.js";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

/** 战术站位 → 球场坐标（主队守下方，客队翻转） */
function slotToPitch(slot, isHome) {
  // formation: x 0–100 左右, y 0–100 本方底线=100
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
    this.players = []; // { id, team, el, x, y, tx, ty, baseX, baseY, num, name, pos }
    this.ball = { x: 50, y: 50, tx: 50, ty: 50, el: null };
    this.fxLayer = null;
    this.running = false;
    this.raf = 0;
    this.lastTs = 0;
    this.phase = "idle"; // idle | play | goal | pause
    this.possession = "home"; // who has ball loosely
    this.passTimer = 0;
    this.highlightId = null;
    this.flashUntil = 0;
    this.bannerEl = null;
    this._built = false;
  }

  mount(home, away) {
    this.home = home;
    this.away = away;
    this.root.innerHTML = "";
    this.root.classList.add("match-pitch-root");

    const wrap = document.createElement("div");
    wrap.className = "mp-wrap";

    // 边线广告条
    wrap.innerHTML = `
      <div class="mp-boards">
        <span>VC LEAGUE</span><span>FM-STYLE 2D</span><span>LIVE</span><span>VC 足球经理</span>
      </div>
      <div class="mp-field" id="mp-field">
        <div class="mp-grass"></div>
        <svg class="mp-lines" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true">
          <rect x="2" y="2" width="96" height="146" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="0.6"/>
          <line x1="2" y1="75" x2="98" y2="75" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"/>
          <circle cx="50" cy="75" r="10" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"/>
          <circle cx="50" cy="75" r="0.8" fill="rgba(255,255,255,0.55)"/>
          <!-- 主队禁区（下） -->
          <rect x="22" y="118" width="56" height="30" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"/>
          <rect x="34" y="132" width="32" height="16" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"/>
          <path d="M 38 118 A 12 12 0 0 1 62 118" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.45"/>
          <circle cx="50" cy="128" r="0.6" fill="rgba(255,255,255,0.5)"/>
          <!-- 客队禁区（上） -->
          <rect x="22" y="2" width="56" height="30" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"/>
          <rect x="34" y="2" width="32" height="16" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"/>
          <path d="M 38 32 A 12 12 0 0 0 62 32" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.45"/>
          <circle cx="50" cy="22" r="0.6" fill="rgba(255,255,255,0.5)"/>
          <!-- 角球弧 -->
          <path d="M 2 6 A 4 4 0 0 0 6 2" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="0.4"/>
          <path d="M 94 2 A 4 4 0 0 0 98 6" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="0.4"/>
          <path d="M 2 144 A 4 4 0 0 1 6 148" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="0.4"/>
          <path d="M 94 148 A 4 4 0 0 1 98 144" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="0.4"/>
        </svg>
        <div class="mp-actors" id="mp-actors"></div>
        <div class="mp-fx" id="mp-fx"></div>
        <div class="mp-banner hidden" id="mp-banner"></div>
      </div>
      <div class="mp-legend">
        <span class="mp-leg home"><i></i><em id="mp-leg-home"></em></span>
        <span class="mp-leg away"><i></i><em id="mp-leg-away"></em></span>
      </div>
    `;
    this.root.appendChild(wrap);

    const actors = wrap.querySelector("#mp-actors");
    this.fxLayer = wrap.querySelector("#mp-fx");
    this.bannerEl = wrap.querySelector("#mp-banner");
    const legH = wrap.querySelector("#mp-leg-home");
    const legA = wrap.querySelector("#mp-leg-away");

    autoLineup(home);
    autoLineup(away);
    ensureKit(home);
    ensureKit(away);

    const homeKit = ensureKit(home);
    const awayKit = ensureKit(away);
    // 避免主客球衣撞色：客队用第二色或反差
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
    this._spawnTeam(actors, home, true, homeKit.primary, homeKit.numberColor || contrastText(homeKit.primary));
    this._spawnTeam(actors, away, false, awayPrimary, contrastText(awayPrimary));

    // 球
    const ballEl = document.createElement("div");
    ballEl.className = "mp-ball";
    actors.appendChild(ballEl);
    this.ball = { x: 50, y: 50, tx: 50, ty: 50, el: ballEl };
    this._applyBall();

    this._built = true;
    this.phase = "idle";
    this.startLoop();
    this.setBanner("");
  }

  _spawnTeam(actors, club, isHome, color, numColor) {
    const form = FORMATIONS[club.tactics?.formation] || FORMATIONS["4-3-3"];
    const xi = getLineupPlayers(club);
    const slots = form.slots || [];
    for (let i = 0; i < Math.min(11, slots.length); i++) {
      const slot = slots[i];
      const p = xi[i];
      const pos = slotToPitch(slot, isHome);
      // 球场坐标系：x 0–100 宽，y 0–100 映射到 0–150 的 field 高度比例
      // 我们用百分比 left/top，field 是 2:3 竖向 → y 用 0–100 的百分比即可
      const el = document.createElement("div");
      el.className = `mp-player ${isHome ? "home" : "away"}`;
      el.dataset.id = p?.id || `slot-${isHome ? "h" : "a"}-${i}`;
      const num = p?.number ?? i + 1;
      const name = p?.name?.split(" ").pop() || p?.name || "?";
      el.innerHTML = `
        <div class="mp-dot" style="background:${color};color:${numColor};border-color:${isHome ? "rgba(255,255,255,0.85)" : "rgba(15,23,42,0.5)"}">
          <span class="mp-num">${num}</span>
        </div>
        <div class="mp-name">${escapeHtml(name)}</div>
      `;
      actors.appendChild(el);
      const jitter = () => (Math.random() - 0.5) * 2.5;
      const baseX = clamp(pos.x + jitter(), 4, 96);
      const baseY = clamp(pos.y + jitter(), 4, 96);
      this.players.push({
        id: p?.id,
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
      });
      this._applyPlayer(this.players[this.players.length - 1]);
    }
  }

  /** 百分比 → CSS：y 直接作 top% */
  _applyPlayer(pl) {
    pl.el.style.left = `${pl.x}%`;
    pl.el.style.top = `${pl.y}%`;
  }

  _applyBall() {
    if (!this.ball.el) return;
    this.ball.el.style.left = `${this.ball.x}%`;
    this.ball.el.style.top = `${this.ball.y}%`;
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
    this._built = false;
  }

  update(dt, ts) {
    // 空闲游走
    if (this.phase === "idle" || this.phase === "play") {
      this.passTimer -= dt;
      if (this.passTimer <= 0) {
        this.passTimer = 1.2 + Math.random() * 1.8;
        this._idlePass();
      }
      // 球员向目标 + 微抖
      for (const pl of this.players) {
        if (this.phase === "idle" && Math.random() < 0.008) {
          pl.tx = clamp(pl.baseX + (Math.random() - 0.5) * 8, 5, 95);
          pl.ty = clamp(pl.baseY + (Math.random() - 0.5) * 6, 5, 95);
        }
        pl.x = lerp(pl.x, pl.tx, 1 - Math.pow(0.02, dt));
        pl.y = lerp(pl.y, pl.ty, 1 - Math.pow(0.02, dt));
        this._applyPlayer(pl);
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

    if (this.highlightId && ts > this.flashUntil) {
      this._clearHighlight();
    }
  }

  _idlePass() {
    const side = this.possession;
    const pool = this.players.filter((p) => p.team === side && p.pos !== "GK");
    if (pool.length < 2) return;
    const a = pool[Math.floor(Math.random() * pool.length)];
    let b = pool[Math.floor(Math.random() * pool.length)];
    if (b === a) b = pool[(pool.indexOf(a) + 1) % pool.length];
    // 持球人靠近球
    a.tx = clamp(a.baseX + (Math.random() - 0.5) * 4, 6, 94);
    a.ty = clamp(a.baseY + (this.possession === "home" ? -2 : 2) + (Math.random() - 0.5) * 3, 6, 94);
    this.ball.tx = a.x;
    this.ball.ty = a.y;
    // 传球
    setTimeout(() => {
      if (!this._built) return;
      this.ball.tx = b.x + (Math.random() - 0.5) * 3;
      this.ball.ty = b.y + (Math.random() - 0.5) * 3;
      b.tx = clamp(b.baseX + (Math.random() - 0.5) * 5, 6, 94);
      b.ty = clamp(b.baseY + (this.possession === "home" ? -3 : 3), 6, 94);
    }, 280);
    // 偶尔换边
    if (Math.random() < 0.22) {
      this.possession = this.possession === "home" ? "away" : "home";
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
   * @param {object} ev
   * @param {{ homeGoals, awayGoals, minute }} snap
   * @param {object} fixture - 含 home/away id
   */
  onEvent(ev, snap, fixture) {
    if (!this._built || !ev || ev.type === "tick") return;
    const homeId = fixture?.home || this.home?.id;
    const isHomeTeam = (teamId) => teamId === homeId;

    switch (ev.type) {
      case "kickoff":
        this.phase = "play";
        this.ball.tx = 50;
        this.ball.ty = 50;
        this.possession = Math.random() < 0.5 ? "home" : "away";
        this.setBanner(ev.text || "Kick-off", "info");
        setTimeout(() => this.setBanner(""), 1200);
        break;

      case "context":
        this.setBanner(ev.text?.replace(/^情境：/, "") || "", "info");
        setTimeout(() => this.setBanner(""), 2000);
        break;

      case "goal": {
        this.phase = "goal";
        const attHome = isHomeTeam(ev.teamId);
        this.possession = attHome ? "home" : "away";
        // 球进对方球门
        this.ball.tx = 50 + (Math.random() - 0.5) * 8;
        this.ball.ty = attHome ? 4 + Math.random() * 3 : 96 - Math.random() * 3;
        // 射手前插
        const scorer = this.players.find((p) => p.id === ev.playerId);
        if (scorer) {
          scorer.tx = this.ball.tx + (Math.random() - 0.5) * 4;
          scorer.ty = attHome ? 12 : 88;
          scorer.el.classList.add("highlight", "scorer");
          this.highlightId = scorer.id;
          this.flashUntil = performance.now() + 2200;
        }
        // 队友庆祝聚拢
        for (const pl of this.players.filter((p) => p.team === (attHome ? "home" : "away") && p.id !== ev.playerId)) {
          if (Math.random() < 0.45) {
            pl.tx = clamp((scorer?.tx || 50) + (Math.random() - 0.5) * 14, 8, 92);
            pl.ty = clamp((scorer?.ty || 50) + (Math.random() - 0.5) * 10, 8, 92);
          }
        }
        this._burst(this.ball.tx, this.ball.ty, "goal");
        this.setBanner(`⚽ ${snap.homeGoals} - ${snap.awayGoals}`, "goal");
        setTimeout(() => {
          this.phase = "play";
          this._resetShape();
          this.ball.tx = 50;
          this.ball.ty = 50;
          this.setBanner("");
        }, 1600);
        break;
      }

      case "chance":
      case "woodwork": {
        const attHome = ev.teamId ? isHomeTeam(ev.teamId) : this.possession === "home";
        this.ball.tx = 40 + Math.random() * 20;
        this.ball.ty = attHome ? 10 + Math.random() * 12 : 78 + Math.random() * 12;
        this._pushAttack(attHome ? "home" : "away");
        if (ev.type === "woodwork") this._burst(this.ball.tx, this.ball.ty, "wood");
        break;
      }

      case "save": {
        const saveHome = isHomeTeam(ev.teamId); // 门将方
        this.ball.tx = 48 + Math.random() * 4;
        this.ball.ty = saveHome ? 90 + Math.random() * 5 : 5 + Math.random() * 5;
        const gk = this.players.find((p) => p.team === (saveHome ? "home" : "away") && p.pos === "GK");
        if (gk) {
          gk.tx = this.ball.tx;
          gk.ty = this.ball.ty;
          gk.el.classList.add("highlight");
          this.highlightId = gk.id;
          this.flashUntil = performance.now() + 1000;
        }
        this._burst(this.ball.tx, this.ball.ty, "save");
        break;
      }

      case "penalty":
      case "pen_miss": {
        const attHome = ev.teamId ? isHomeTeam(ev.teamId) : true;
        this.ball.tx = 50;
        this.ball.ty = attHome ? 12 : 88;
        this._pushAttack(attHome ? "home" : "away");
        this.setBanner(ev.type === "penalty" ? "❗ PEN" : "😮", "warn");
        setTimeout(() => this.setBanner(""), 1000);
        break;
      }

      case "corner": {
        const attHome = ev.teamId ? isHomeTeam(ev.teamId) : this.possession === "home";
        const left = Math.random() < 0.5;
        this.ball.tx = left ? 4 : 96;
        this.ball.ty = attHome ? 6 : 94;
        this._pushAttack(attHome ? "home" : "away");
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
          pl.tx = foulHome ? 50 : 50;
          pl.ty = foulHome ? 102 : -2; // 移出场外
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
        // 简单：重置阵型站位
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
        break;

      case "ft":
        this.phase = "pause";
        this.setBanner(ev.text || "FT", "info");
        this.ball.tx = 50;
        this.ball.ty = 50;
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

  /** 快速回放：按事件序列推进（不阻塞太久） */
  async replayEvents(events, fixture, { onStep, speed = 1 } = {}) {
    this.phase = "play";
    let hg = 0;
    let ag = 0;
    for (const ev of events || []) {
      if (ev.type === "tick" || !ev.text && ev.type !== "goal") {
        if (ev.type === "tick") continue;
      }
      if (ev.type === "goal") {
        if (ev.teamId === fixture.home) hg++;
        else ag++;
      }
      const snap = { homeGoals: hg, awayGoals: ag, minute: ev.minute };
      this.onEvent(ev, snap, fixture);
      if (onStep) onStep(ev, snap);
      const wait =
        ev.type === "goal"
          ? 420 / speed
          : ev.type === "ht" || ev.type === "ft"
            ? 280 / speed
            : ev.type === "kickoff"
              ? 200 / speed
              : 90 / speed;
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
  const d = Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  return d < 80;
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
