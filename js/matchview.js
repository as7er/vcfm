/**
 * FMM / FM 风格 2D 俯视球场（DOM 表现层，非 3D）
 *
 * 技术栈拆分（对齐「模拟引擎 + 画布渲染」）：
 * 1) match.js      — 后台数据模拟 / 比分与事件真相源（truth）
 * 2) MatchView     — 前端渲染：rAF 主循环 + 状态机 + 坐标平滑插值
 * 3) 不改比分结果；attrs 只影响表演节奏
 *
 * 球员 FSM: home | support | press | cover | carry
 * 球 FSM:   free | held | flight | shot
 *
 * 区域规则（MVP 第 3 步）：球进入防守/接应区才离开阵型位去追，否则回 base。
 */

import { FORMATIONS, playerDisplaySurname } from "./data.js";
import {
  ensureKit,
  getLineupPlayers,
  autoLineup,
  assignPlayersToFormationSlots,
} from "./models.js";

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

/** 解析 #rgb / #rrggbb → [r,g,b] */
function parseHexRgb(hex) {
  let h = String(hex || "").replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length < 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return [r, g, b];
}

/** 相对亮度 0..1（sRGB 近似） */
function relativeLuma(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度（越大越好） */
function contrastRatioL(L1, L2) {
  const a = Math.max(L1, L2) + 0.05;
  const b = Math.min(L1, L2) + 0.05;
  return a / b;
}

/**
 * 球衣底色上的可读号码色：在黑/白之间选对比度更高的。
 * 粉衣 #f472b6 等：旧逻辑会给白字，几乎看不清。
 */
function contrastText(hex) {
  const L = relativeLuma(hex);
  const cBlack = contrastRatioL(L, 0);
  const cWhite = contrastRatioL(L, 1);
  return cBlack >= cWhite ? "#0f172a" : "#ffffff";
}

/** 若 preferred 与底色对比不够，改用自动对比色 */
function readableNumberColor(bgHex, preferred) {
  const auto = contrastText(bgHex);
  if (!preferred) return auto;
  const Lb = relativeLuma(bgHex);
  const Lf = relativeLuma(preferred);
  // 对比度不足（约 < 3:1）则强制自动
  if (contrastRatioL(Lb, Lf) < 3) return auto;
  return preferred;
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
    this.ball = { x: 50, y: 50, tx: 50, ty: 50, z: 0, el: null };
    /** 球轨迹（FM 空中/传球丝带） */
    this._ballTrail = [];
    this.fxLayer = null;
    this.trailSvg = null;
    this.fieldEl = null;
    this.cameraEl = null;
    this.running = false;
    this.raf = 0;
    this.lastTs = 0;
    this.phase = "pre"; // pre | play | goal | pause（pre=赛前静止）
    this.possession = "home";
    this.passTimer = 0;
    this.highlightId = null;
    this.flashUntil = 0;
    this.bannerEl = null;
    this.captionEl = null;
    this.tipEl = null;
    this.cardEl = null;
    this._built = false;
    /** 焦点球员 id 集合：其余压暗（FMM 关键戏） */
    this.focusIds = new Set();
    this.focusUntil = 0;
    /** 镜头模式：wide | ball | box */
    this.camMode = "wide";
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
    /** FMM：默认关网，少叠加 */
    this.networkEnabled = false;
    this.networkFilter = "both"; // both | home | away
    this.networkDirty = false;
    this.lastCarrierId = null;
    /** 当前持球人（盘带时球贴身） */
    this.carrier = null;
    /**
     * 球状态机（连续 tick 核心）
     * free | held | flight | shot
     */
    this.ballState = "free";
    /** 飞行目标：{ x, y, receiverId?, kind, until } */
    this.flight = null;
    /** 球在飞行中（传球/射门）结束时间戳 — 兼容旧逻辑 */
    this.ballFlightUntil = 0;
    /** 持球决策计时：盘带 / 传球 / 换向 */
    this.actionTimer = 0;
    /** 导演控球偏置 0..1 = 主队控球倾向（来自 snap.possession） */
    this.directorBias = 0.5;
    /** UI 暂停：冻结 AI，保留站位（区别于 HT/FT 的 phase=pause） */
    this.frozen = false;
    /**
     * 关键事件预演锁：暂停自由持球 AI，只跑镜头脚本跑位
     * （FMM：机会/扑救前 1–2 秒组织进攻）
     */
    this.scriptLock = false;
    /** 事件收尾中：缓慢回落，不立刻乱踢 */
    this.aftermathUntil = 0;
    /**
     * 攻势段落：一段连续压上（表现层）
     * { side:'home'|'away', until:number, intensity:number }
     */
    this.attackPhase = null;
    /** @type {AudioContext | null} */
    this._audioCtx = null;
    this._sfxMuted = false;
    /** 事件闪卡 DOM */
    this.flashCardEl = null;
    this._flashCardToken = 0;
    /** FMM：热区默认关 */
    this.heatEnabled = false;
    /**
     * 真空间投影模式：位置由 SimEngine 快照驱动，关闭自由导演 AI。
     * 直播 v2 时开启。
     */
    this.simDrive = false;
  }

  /**
   * 开启/关闭空间模拟投影驱动
   * @param {boolean} on
   */
  setSimDrive(on) {
    this.simDrive = !!on;
    this.fieldEl?.classList.toggle("mp-sim-drive", !!on);
    // 开赛时布局常从 pre-kickoff 变 live，必须重测 canvas
    this.refreshLayout?.();
    if (this.simDrive) {
      this.scriptLock = false;
      this.flight = null;
      this.ballFlightUntil = 0;
      this.ballState = "free";
      this.actionTimer = 999;
      this.aftermathUntil = 0;
      this.attackPhase = null;
      this.camMode = "follow";
      this._ballTrail = [];
      // 清轨迹/传球网，避免和 Canvas 球员叠成重影
      this.trails = [];
      if (this.trailSvg) this.trailSvg.innerHTML = "";
      if (this.networkSvg) {
        const paths = this.networkSvg.querySelector("#mp-net-paths");
        if (paths) paths.innerHTML = "";
      }
      this.passNetwork?.clear?.();
      if (this.phase === "pre" || this.phase === "pause") this.phase = "play";
    }
  }

  /**
   * 把 SimEngine 压缩帧投影到 2D 球场（球员坐标 + 球 + 持球高亮）
   * @param {object|null} sim compactSimFrame / snapshot
   * @param {{ soft?: boolean }} [opts] soft=true 时指数平滑（防抖），不强制切镜头
   */
  applySimSnapshot(sim, opts = {}) {
    if (!this._built || !sim?.players?.length) return false;
    this.simDrive = true;
    this.scriptLock = false;
    this.flight = null;
    this.ballFlightUntil = 0;
    if (this.phase !== "goal") this.phase = "play";

    const soft = !!opts.soft;
    // 平滑系数：约 70ms 跟上目标，去掉帧边界硬切造成的肉眼抖动
    const smooth = soft ? 0.38 : 1;

    const byId = new Map(sim.players.map((s) => [s.id, s]));
    let carrier = null;
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      const s = byId.get(pl.id);
      if (!s) continue;
      const tx = clamp(s.x, 0, 100);
      const ty = clamp(s.y, 0, 100);
      const ox = pl.x;
      const oy = pl.y;
      pl.x = smooth >= 1 ? tx : pl.x + (tx - pl.x) * smooth;
      pl.y = smooth >= 1 ? ty : pl.y + (ty - pl.y) * smooth;
      pl.tx = pl.x;
      pl.ty = pl.y;
      // 速度用于朝向箭头 / 冲刺残影
      pl.vx = pl.x - ox;
      pl.vy = pl.y - oy;
      if (s.heading != null && Number.isFinite(s.heading)) {
        pl.heading = s.heading;
      } else if (Math.hypot(pl.vx, pl.vy) > 0.08) {
        pl.heading = Math.atan2(pl.vy, pl.vx);
      }
      // 扑救倒地 / 开球等短时姿态（来自 sim compact 帧）
      // 注意：慢镜下不能每帧把 poseUntil 往后推，否则会「绿胶囊卡死」整段 SLOW-MO
      if (s.pose) {
        pl.pose = s.pose;
        pl.poseDir = s.poseDir || 0;
        // 仅首次进入姿态时开定时；续帧只刷新 pose 内容
        if (!pl.poseUntil || performance.now() > pl.poseUntil) {
          pl.poseUntil = performance.now() + 520;
        }
      } else if (pl.pose) {
        // sim 已无姿态：最多再留 80ms 防闪，然后清掉
        if (!pl.poseUntil || performance.now() > pl.poseUntil - 400) {
          pl.poseUntil = Math.min(pl.poseUntil || performance.now() + 80, performance.now() + 80);
        }
        if (performance.now() > pl.poseUntil) {
          pl.pose = null;
          pl.poseDir = 0;
          pl.poseUntil = 0;
        }
      }
      // 先清光环，球位更新后再按「真 owner + 贴球」赋值（杜绝空飘球却亮人）
      pl.el.classList.remove("has-ball");
      this._applyPlayer(pl);
    }

    if (sim.ball) {
      const bx = clamp(sim.ball.x, 0, 100);
      const by = clamp(sim.ball.y, 0, 100);
      const bz = clamp(Number(sim.ball.z) || 0, 0, 12);
      const prevZ = this.ball.z || 0;
      this.ball.x = smooth >= 1 ? bx : this.ball.x + (bx - this.ball.x) * smooth;
      this.ball.y = smooth >= 1 ? by : this.ball.y + (by - this.ball.y) * smooth;
      this.ball.z = smooth >= 1 ? bz : (this.ball.z || 0) + (bz - (this.ball.z || 0)) * smooth;
      this.ball.tx = this.ball.x;
      this.ball.ty = this.ball.y;
      // 落地轻弹：从空中落回地面时闪一下落点
      if (prevZ > 1.2 && (this.ball.z || 0) < 0.35 && !this.carrier) {
        this._ballBounceFlash = performance.now() + 220;
      }
      // 仅在球门线附近才播入网（防跳段/粘帧在中场炸出「迷你球门」）
      if (sim.ball.netHit && !this._netHitDone && (by < 8 || by > 92)) {
        this._netHitDone = true;
        const attHome = by < 50;
        const gx = clamp(bx, 42, 58);
        const gy = attHome ? Math.min(by, 3.5) : Math.max(by, 96.5);
        this._goalNetEffect?.(gx, gy, attHome);
      }
    }

    // 持球光环：仅球有 owner 且该球员贴在球边；飞行/松球绝不亮
    const ballState = sim.ball?.state || null;
    const isCornerState =
      ballState === "corner" || sim.ball?.setPiece === "corner";
    const inFlight =
      ballState === "shot" ||
      ballState === "pass" ||
      ballState === "loose" ||
      ballState === "dead";
    const ownerId = !inFlight ? sim.ball?.owner || null : null;
    if (ownerId) {
      const own = this.players.find((p) => p.id === ownerId);
      if (own) {
        const d = Math.hypot(own.x - this.ball.x, own.y - this.ball.y);
        if (isCornerState) {
          // 角球：主罚人钉在角旗球旁（修「角旗只有球、人全挤禁区」）
          own.x = this.ball.x;
          own.y = this.ball.y + (this.ball.y < 50 ? 1.5 : -1.5);
          own.tx = own.x;
          own.ty = own.y;
          own.heading = Math.atan2(50 - own.y, 50 - own.x);
          own.el.classList.add("has-ball", "highlight");
          carrier = own;
          this._applyPlayer(own);
        } else if (d < 5.5) {
          own.el.classList.add("has-ball");
          carrier = own;
          // 显示层球贴脚下，避免「人亮球远」
          this.ball.x = own.x + Math.cos(own.heading || 0) * 1.2;
          this.ball.y = own.y + Math.sin(own.heading || 0) * 1.2;
          this.ball.tx = this.ball.x;
          this.ball.ty = this.ball.y;
          this.ball.z = 0;
        }
      }
    }
    // sim 已在逻辑层完成分离。这里不能再改坐标，否则下一帧会被真实位置拉回而产生抖动。

    if (carrier) {
      this.carrier = carrier;
      this.lastCarrierId = carrier.id;
      this.possession = carrier.team;
      this.ballState = "held";
    } else {
      this.carrier = null;
      this.ballState =
        ballState === "shot"
          ? "shot"
          : ballState === "pass"
            ? "flight"
            : "free";
    }
    this._pushBallTrail();
    this._applyBall();
    // 直播用 soft follow（见 update）；非时间轴时默认 follow
    if (!this._simPlay && this.simDrive) this.camMode = this.camMode === "box" ? "box" : "follow";
    return true;
  }

  /** 两帧之间插值（对齐 sim-viewer：10Hz 模拟 → 屏幕 60fps 平滑） */
  applySimSnapshotLerped(fa, fb, alpha) {
    if (!fa?.players?.length) return false;
    if (!fb?.players?.length || alpha <= 0) {
      return this.applySimSnapshot(fa, { soft: true });
    }
    if (alpha >= 1) return this.applySimSnapshot(fb, { soft: true });
    const t = clamp(alpha, 0, 1);
    const byB = new Map(fb.players.map((p) => [p.id, p]));
    const players = fa.players.map((a) => {
      const b = byB.get(a.id) || a;
      let h = a.heading ?? 0;
      let hb = b.heading ?? h;
      let dh = hb - h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      return {
        id: a.id,
        team: a.team,
        role: a.role,
        num: a.num,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        heading: h + dh * t,
        pose: b.pose || a.pose || null,
        poseDir: b.poseDir ?? a.poseDir ?? 0,
        hasBall: false, // 下面按 ball.owner 统一赋值
      };
    });
    // 球 owner 跟插值后半帧，避免前半还亮旧持球人
    const za = Number(fa.ball?.z) || 0;
    const zb = Number(fb.ball?.z) || 0;
    const owner = t < 0.45 ? fa.ball?.owner : fb.ball?.owner;
    const st = t < 0.45 ? fa.ball?.state : fb.ball?.state;
    const ball = {
      x: (fa.ball?.x ?? 50) + ((fb.ball?.x ?? 50) - (fa.ball?.x ?? 50)) * t,
      y: (fa.ball?.y ?? 50) + ((fb.ball?.y ?? 50) - (fa.ball?.y ?? 50)) * t,
      z: za + (zb - za) * t,
      state: st || null,
      // 只认后半帧的脉冲，避免插值区间内重复 netHit
      netHit: t >= 0.5 ? !!fb.ball?.netHit : !!fa.ball?.netHit,
      owner: owner ?? null,
    };
    if (owner) {
      for (const p of players) p.hasBall = p.id === owner;
    }
    // 插值本身已是 60fps 平滑，不再二次 soft（双重平滑会发糊/发飘）
    return this.applySimSnapshot(
      { t: (fa.t ?? 0) + ((fb.t ?? 0) - (fa.t ?? 0)) * t, ball, players },
      { soft: false }
    );
  }

  /**
   * 连续回放密集 sim 帧 —— 严格对齐 sim-viewer：
   *   simT += realDt * speed * rate * rateMul
   *   rateMul 由导演系统控制（射门前/进球/扑救慢镜）
   *
   * @param {Array} frames compactSimFrame[]  建议 sampleEvery=1（0.1s）
   * @param {object} [opts]
   * @param {() => number} [opts.getSpeed]
   * @param {() => boolean} [opts.isPaused]
   * @param {number} [opts.rate] ×1 时模拟秒/墙钟秒，默认 1
   * @param {(t:number, minute:number) => void} [opts.onSimT]
   * @param {string} [opts.label] goal|save|chance|kickoff…
   * @param {number} [opts.climaxAt] 高潮模拟时刻（秒）
   */
  playSimTimeline(frames, opts = {}) {
    return new Promise((resolve) => {
      if (!this._built || !frames?.length) {
        resolve();
        return;
      }
      this.stopSimTimeline();
      this.setSimDrive(true);
      this.frozen = false;
      if (this.phase === "pre" || this.phase === "pause") this.phase = "play";
      // FM 软跟镜：缓跟球 + 死区；高潮前由导演切 box
      this.camMode = "follow";
      this._ballTrail = [];
      this._clearDirectorChrome();

      const t0 = frames[0].t ?? 0;
      const tEnd0 = frames[frames.length - 1].t ?? t0;
      const label = opts.label || null;
      let climaxAt = Number(opts.climaxAt);
      if (!Number.isFinite(climaxAt)) {
        // 无显式高潮：进球/扑救段默认偏后 70%
        if (label === "goal" || label === "save" || label === "chance") {
          climaxAt = t0 + (tEnd0 - t0) * 0.72;
        } else {
          climaxAt = null;
        }
      }
      // 供进球后 FMM 自动重播
      this._lastTimeline = { frames, label, climaxAt, t0, tEnd: tEnd0 };
      this._netHitDone = false;
      const sp = {
        frames,
        i: 0,
        simT: t0,
        lastTs: 0,
        getSpeed: typeof opts.getSpeed === "function" ? opts.getSpeed : () => 1,
        isPaused: typeof opts.isPaused === "function" ? opts.isPaused : () => false,
        rate: Number(opts.rate) > 0 ? Number(opts.rate) : 1,
        /** 导演慢镜倍率 0.25..1 */
        rateMul: 1,
        /** 事件触发的慢镜：墙钟截止时间（优先于预编排） */
        eventSlowUntil: 0,
        eventRateMul: 1,
        onSimT: opts.onSimT || null,
        holdUntil: 0,
        raf: 0,
        resolve,
        lastEmitT: t0 - 1,
        label,
        climaxAt,
        directorPhase: "build",
        /** FMM：默认不猛推 box，只轻跟 */
        fmmWide: opts.fmmWide !== false,
        assistId: opts.assistId || null,
        scorerId: opts.scorerId || null,
        _assistFocusDone: false,
      };
      this._simPlay = sp;
      this.applySimSnapshot(frames[0], { soft: false });

      const tick = (ts) => {
        if (this._simPlay !== sp) return;
        if (!sp.lastTs) sp.lastTs = ts;
        const realDt = Math.min(0.05, (ts - sp.lastTs) / 1000);
        sp.lastTs = ts;

        if (sp.isPaused() || this.frozen) {
          sp.raf = requestAnimationFrame(tick);
          return;
        }

        // 导演：预编排推镜/慢镜 + 事件慢镜衰减
        this._tickDirector(sp, ts, realDt);

        if (ts < sp.holdUntil) {
          // hold：不推进 simT；进球叙事 → 庆祝
          if (this.phase === "goal") {
            if (this._goalBeat && !this._goalBeat.done) {
              this._tickGoalBeat(realDt);
            } else {
              this._tickVisualCelebrate(realDt);
            }
          }
          this._updateSimCamera(realDt);
          this._drawCanvas();
          sp.raf = requestAnimationFrame(tick);
          return;
        }

        // 进球叙事/庆祝中：不要用后续 sim 帧覆盖（否则刚围拢又被冲散）
        if (
          this.phase === "goal" &&
          (this._goalBeat || this._celebrate)
        ) {
          if (this._goalBeat && !this._goalBeat.done) {
            this._tickGoalBeat(realDt);
          } else {
            this._tickVisualCelebrate(realDt);
          }
          this._updateSimCamera(realDt);
          this._drawCanvas();
          // 仍推进一点 simT 以免卡死事件，但很慢
          sp.simT += realDt * 0.15;
          const tEndHold = sp.frames[sp.frames.length - 1].t ?? 0;
          if (sp.simT >= tEndHold - 1e-6 && !this._celebrate && !this._goalBeat) {
            this._clearDirectorChrome();
            this._simPlay = null;
            sp.resolve();
            return;
          }
          sp.raf = requestAnimationFrame(tick);
          return;
        }

        const speed = Math.max(0.25, Number(sp.getSpeed()) || 1);
        const mul = clamp(sp.rateMul || 1, 0.2, 1.5);
        sp.simT += realDt * speed * sp.rate * mul;

        const fr = sp.frames;
        const tEnd = fr[fr.length - 1].t ?? 0;
        if (sp.simT > tEnd) sp.simT = tEnd;

        while (sp.i < fr.length - 1 && (fr[sp.i + 1].t ?? 0) <= sp.simT) {
          sp.i++;
        }
        const a = fr[sp.i];
        const b = fr[Math.min(sp.i + 1, fr.length - 1)];
        const tA = a.t ?? 0;
        const tB = b.t ?? tA;
        const span = Math.max(1e-6, tB - tA);
        const alpha = sp.i >= fr.length - 1 ? 1 : clamp((sp.simT - tA) / span, 0, 1);

        this.applySimSnapshotLerped(a, b, alpha);

        const minute = Math.max(1, Math.min(90, Math.ceil(sp.simT / 60) || 1));
        if (sp.onSimT && (sp.simT - sp.lastEmitT >= 0.12 || sp.simT >= tEnd)) {
          sp.lastEmitT = sp.simT;
          try {
            sp.onSimT(sp.simT, minute);
          } catch (e) {
            console.warn("onSimT", e);
          }
        }

        if (sp.simT >= tEnd - 1e-6) {
          this._clearDirectorChrome();
          this._simPlay = null;
          sp.resolve();
          return;
        }
        sp.raf = requestAnimationFrame(tick);
      };

      sp.raf = requestAnimationFrame(tick);
    });
  }

  /** 进球等：暂停时间轴推进 holdMs 毫秒（墙钟） */
  holdSimTimeline(ms) {
    if (!this._simPlay) return;
    const t = performance.now() + Math.max(0, Number(ms) || 0);
    this._simPlay.holdUntil = Math.max(this._simPlay.holdUntil || 0, t);
  }

  /**
   * FMM 导演：关键事件触发推镜 + 慢镜
   * @param {'goal'|'save'|'chance'|'woodwork'|'shot'} kind
   * @param {{ ev?: object, fixture?: object, lang?: string }} [opts]
   */
  triggerDirectorMoment(kind, opts = {}) {
    const now = performance.now();
    const lang = opts.lang || (typeof document !== "undefined" && document.documentElement?.lang === "en" ? "en" : "zh");
    const sp = this._simPlay;

    if (kind === "goal") {
      this.camMode = "follow";
      this.camBoostUntil = now + 4200;
      this.phase = "goal";
      this._netHitDone = false;
      this.fieldEl?.classList.add("mp-replay-slow");
      // 先播 3s 助攻→射门→入网，再庆祝（勿立刻聚拢抢戏）
      const fixture = opts.fixture;
      const homeId = fixture?.home || this.home?.id;
      const attHome =
        opts.attHome != null
          ? !!opts.attHome
          : opts.ev?.teamId
            ? opts.ev.teamId === homeId
            : true;
      this._beginGoalBeat(opts.ev || {}, { attHome, lang });
      // 横幅稍晚由 beat 入网时打出；此处兜底文案
      this.setFmmTicker?.(
        lang === "en" ? "GOAL!!" : "入球了!!",
        "goal",
        0
      );
      const scorer =
        (opts.ev?.playerId && this.players.find((p) => p.id === opts.ev.playerId)) ||
        null;
      if (sp) {
        sp.eventRateMul = 0.32;
        sp.eventSlowUntil = now + 3200;
        sp.rateMul = Math.min(sp.rateMul || 1, 0.32);
        sp.directorPhase = "impact";
        sp.assistId = opts.ev?.assistId || sp.assistId || null;
        sp.scorerId = opts.ev?.playerId || scorer?.id || null;
      }
      return;
    }

    if (kind === "save") {
      this.camMode = "box";
      this.camBoostUntil = now + 2200;
      this.fieldEl?.classList.add("mp-replay-slow");
      if (this.replayBadgeEl) {
        this.replayBadgeEl.textContent = lang === "en" ? "▶ SAVE" : "▶ 扑救";
        this.replayBadgeEl.classList.remove("hidden");
      }
      this.setCaption(lang === "en" ? "GREAT SAVE" : "精彩扑救", "save", 1600);
      const gk =
        (opts.ev?.playerId && this.players.find((p) => p.id === opts.ev.playerId)) ||
        this.players.find((p) => p.pos === "GK" || p.role === "GK");
      if (gk) {
        gk.el.classList.add("highlight");
        this.highlightId = gk.id;
        this.flashUntil = now + 1800;
        this._setFocus([gk], 1600);
        // 表现层扑救倒地（sim 帧若未带 pose 时兜底；短促，避免慢镜卡死）
        if (!gk.pose || gk.pose !== "dive") {
          gk.pose = "dive";
          gk.poseDir = (this.ball.x || 50) >= gk.x ? 1 : -1;
          gk.poseUntil = now + 520;
        }
      }
      if (sp) {
        sp.eventRateMul = 0.4;
        sp.eventSlowUntil = now + 1600;
        sp.rateMul = Math.min(sp.rateMul || 1, 0.4);
        sp.directorPhase = "impact";
      }
      this._burst?.(this.ball.x, this.ball.y, "save");
      return;
    }

    if (kind === "chance" || kind === "woodwork" || kind === "shot") {
      this.camMode = "box";
      this.camBoostUntil = now + 1400;
      if (kind === "woodwork") {
        this.setCaption(lang === "en" ? "WOODWORK!" : "击中门框！", "wood", 1400);
      } else {
        this.setCaption(lang === "en" ? "CHANCE" : "威胁射门", "chance", 1200);
      }
      if (sp) {
        sp.eventRateMul = 0.48;
        sp.eventSlowUntil = now + 1000;
        sp.rateMul = Math.min(sp.rateMul || 1, 0.48);
        sp.directorPhase = "slow";
      }
    }
  }

  /** 清除慢镜/回放角标/角球态 */
  _clearDirectorChrome() {
    this.fieldEl?.classList.remove("mp-replay-slow", "mp-corner-active");
    // mp-replay 留给完整回放；直播导演只清 slow
    if (this.phase !== "goal") {
      this.fieldEl?.classList.remove("mp-replay");
      this.replayBadgeEl?.classList.add("hidden");
    } else if (this.replayBadgeEl && !this.fieldEl?.classList.contains("mp-replay")) {
      this.replayBadgeEl.classList.add("hidden");
    }
  }

  /** 关掉角球徽章/角旗光（段结束或开出后） */
  _clearCornerChrome() {
    this.fieldEl?.classList.remove("mp-corner-active");
    const t = this.replayBadgeEl?.textContent || "";
    if (t.includes("角球") || t.includes("CORNER")) {
      this.replayBadgeEl.classList.add("hidden");
    }
  }

  /**
   * 每帧导演：高潮前推镜 → 临门慢镜；事件慢镜优先
   */
  _tickDirector(sp, nowTs, realDt) {
    if (!sp) return;
    const now = nowTs || performance.now();

    // 自动重播已经截成 7.5s 精华段，不再叠加一次进球导演慢镜。
    if (sp.label === "replay") {
      sp.rateMul = 1;
      sp.directorPhase = "replay";
      this.camMode = "follow";
      return;
    }

    // 1) 事件触发的慢镜（墙钟）
    let eventMul = 1;
    if (sp.eventSlowUntil && now < sp.eventSlowUntil) {
      eventMul = clamp(sp.eventRateMul || 0.35, 0.22, 1);
    } else if (sp.eventSlowUntil && now >= sp.eventSlowUntil) {
      // 缓出慢镜
      sp.eventRateMul = lerp(sp.eventRateMul || 1, 1, 1 - Math.pow(0.02, realDt || 0.016));
      eventMul = sp.eventRateMul;
      if (eventMul > 0.94) {
        sp.eventSlowUntil = 0;
        sp.eventRateMul = 1;
        eventMul = 1;
        if (this.phase === "goal") {
          // 进球 hold 结束后再清 chrome（由 hold 结束后 phase 可能仍是 goal）
        } else {
          this._clearDirectorChrome();
        }
      }
    }

    // 2) 预编排：相对 climaxAt
    let scriptMul = 1;
    const climax = sp.climaxAt;
    if (climax != null && Number.isFinite(climax)) {
      const lead = climax - sp.simT; // >0 未到高潮
      const after = sp.simT - climax;
      const isBig = sp.label === "goal";
      const isSave = sp.label === "save";
      const isChance = sp.label === "chance";

      // FMM 对齐：全程接近全场，只做轻跟 + 慢镜（不猛推 box）
      const wide = sp.fmmWide !== false;
      const isCorner = sp.label === "corner";
      if (isCorner) {
        // 角球段：只在「摆位/开出」窗口亮徽章；开出后（after>2.5）立刻关掉，避免粘整段
        sp.directorPhase = lead > 0.2 ? "push" : after < 2.5 ? "impact" : "settle";
        this.camMode = after < 3 ? "box" : "follow";
        this.camBoostUntil = Math.max(this.camBoostUntil, now + 400);
        scriptMul = lead > 0 ? 0.7 : after < 2 ? 0.78 : 0.95;
        if (lead > -0.5 && after < 2.2) {
          if (!sp._cornerChrome) {
            sp._cornerChrome = true;
            if (this.replayBadgeEl) {
              this.replayBadgeEl.textContent =
                (typeof document !== "undefined" && document.documentElement?.lang === "en")
                  ? "🚩 CORNER"
                  : "🚩 角球";
              this.replayBadgeEl.classList.remove("hidden");
            }
            this.fieldEl?.classList.add("mp-corner-active");
          }
        } else if (sp._cornerChrome && after >= 2.2) {
          sp._cornerChrome = false;
          this._clearCornerChrome();
        }
      } else if (lead > 5.5) {
        sp.directorPhase = "build";
        scriptMul = 1;
        this.camMode = "follow";
        // 进球段：先把焦点打在助攻者（传球起脚）
        if (isBig && sp.assistId && !sp._assistFocusDone) {
          const ass = this.players.find((p) => p.id === sp.assistId);
          if (ass) {
            ass.el.classList.add("highlight");
            this._setFocus([ass], 2200);
            sp._assistFocusDone = true;
            const en =
              typeof document !== "undefined" &&
              document.documentElement?.lang === "en";
            this.setFmmTicker?.(
              en
                ? `${ass.name || "Player"} looks up…`
                : `${ass.name || "球员"} 抬头观察…`,
              "shot",
              1600
            );
          }
        }
      } else if (lead > 2.2) {
        sp.directorPhase = "push";
        // 轻跟，不切 box
        this.camMode = wide ? "follow" : "box";
        this.camBoostUntil = Math.max(this.camBoostUntil, now + 400);
        scriptMul = isBig ? 0.82 : isSave ? 0.88 : 0.92;
        // 助攻传球后半段：焦点扩到接球/射手
        if (isBig && sp.scorerId && lead < 4.2) {
          const sc = this.players.find((p) => p.id === sp.scorerId);
          const ass = sp.assistId
            ? this.players.find((p) => p.id === sp.assistId)
            : null;
          if (sc) this._setFocus(ass ? [ass, sc] : [sc], 1800);
        }
      } else if (lead > 0.05) {
        sp.directorPhase = "slow";
        this.camMode = wide ? "follow" : "box";
        this.camBoostUntil = Math.max(this.camBoostUntil, now + 700);
        scriptMul = isBig ? 0.38 : isSave ? 0.45 : isChance ? 0.5 : 0.58;
        if (isBig || isSave) this.fieldEl?.classList.add("mp-replay-slow");
        if (isBig && sp.scorerId) {
          const sc = this.players.find((p) => p.id === sp.scorerId);
          if (sc) this._setFocus([sc], 2200);
        }
      } else if (after < (isBig ? 2.8 : isSave ? 1.8 : 1.2)) {
        sp.directorPhase = "impact";
        this.camMode = wide ? "follow" : "box";
        scriptMul = isBig ? 0.4 : isSave ? 0.52 : 0.65;
      } else {
        sp.directorPhase = "settle";
        scriptMul = 0.9;
        this.camMode = "follow";
        if (eventMul >= 0.98) this._clearDirectorChrome();
      }
    }

    // 取更慢者（事件优先更戏剧）
    sp.rateMul = Math.min(scriptMul, eventMul);
  }

  stopSimTimeline() {
    if (this._simPlay?.raf) cancelAnimationFrame(this._simPlay.raf);
    if (this._simPlay?.resolve) {
      const r = this._simPlay.resolve;
      this._simPlay.resolve = null;
      try {
        r();
      } catch (_) {
        /* ignore */
      }
    }
    this._simPlay = null;
    this._clearCornerChrome();
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
      <div class="mp-field mp-fmm2d" id="mp-field">
        <!-- FMM 两侧看台 -->
        <div class="mp-stands left" aria-hidden="true"></div>
        <div class="mp-stands right" aria-hidden="true"></div>
        <div class="mp-end-label mp-end-away" id="mp-end-away">AWAY</div>
        <div class="mp-end-label mp-end-home" id="mp-end-home">HOME</div>
        <div class="mp-camera" id="mp-camera">
          <div class="mp-grass"></div>
          <div class="mp-goal-mouth top" aria-hidden="true"></div>
          <div class="mp-goal-mouth bot" aria-hidden="true"></div>
          <div class="mp-poss-half" id="mp-poss-half" aria-hidden="true"></div>
          <div class="mp-form-zones" id="mp-form-zones" aria-hidden="true"></div>
          <div class="mp-attack-arrow" id="mp-attack-arrow" aria-hidden="true"></div>
          <svg class="mp-lines" viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true">
            <rect x="3" y="3" width="94" height="144" fill="none" stroke="rgba(255,255,255,0.78)" stroke-width="0.7"/>
            <line x1="3" y1="75" x2="97" y2="75" stroke="rgba(255,255,255,0.7)" stroke-width="0.55"/>
            <circle cx="50" cy="75" r="12" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <circle cx="50" cy="75" r="0.85" fill="rgba(255,255,255,0.9)"/>
            <rect x="21" y="117" width="58" height="30" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <rect x="33" y="131" width="34" height="16" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <path d="M 37 117 A 13 13 0 0 1 63 117" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.5"/>
            <circle cx="50" cy="127" r="0.6" fill="rgba(255,255,255,0.75)"/>
            <!-- 底端球门：门架在底线外侧（场外），不画进场内 -->
            <rect x="43.2" y="147" width="13.6" height="2.6" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.88)" stroke-width="0.65"/>
            <line x1="43.2" y1="147" x2="43.2" y2="149.6" stroke="rgba(255,255,255,0.92)" stroke-width="0.9"/>
            <line x1="56.8" y1="147" x2="56.8" y2="149.6" stroke="rgba(255,255,255,0.92)" stroke-width="0.9"/>
            <line x1="43.2" y1="149.6" x2="56.8" y2="149.6" stroke="rgba(255,255,255,0.92)" stroke-width="0.85"/>
            <rect x="21" y="3" width="58" height="30" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <rect x="33" y="3" width="34" height="16" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <path d="M 37 33 A 13 13 0 0 0 63 33" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.5"/>
            <circle cx="50" cy="23" r="0.6" fill="rgba(255,255,255,0.75)"/>
            <!-- 顶端球门：门架在顶线外侧（场外） -->
            <rect x="43.2" y="0.4" width="13.6" height="2.6" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.88)" stroke-width="0.65"/>
            <line x1="43.2" y1="3" x2="43.2" y2="0.4" stroke="rgba(255,255,255,0.92)" stroke-width="0.9"/>
            <line x1="56.8" y1="3" x2="56.8" y2="0.4" stroke="rgba(255,255,255,0.92)" stroke-width="0.9"/>
            <line x1="43.2" y1="0.4" x2="56.8" y2="0.4" stroke="rgba(255,255,255,0.92)" stroke-width="0.85"/>
            <path d="M 3 7.2 A 4.2 4.2 0 0 0 7.2 3" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>
            <path d="M 92.8 3 A 4.2 4.2 0 0 0 97 7.2" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>
            <path d="M 3 142.8 A 4.2 4.2 0 0 1 7.2 147" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>
            <path d="M 92.8 147 A 4.2 4.2 0 0 1 97 142.8" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>
          </svg>
          <div class="mp-heat" id="mp-heat" aria-hidden="true"></div>
          <svg class="mp-press" id="mp-press" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <svg class="mp-network" id="mp-network" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <svg class="mp-trails" id="mp-trails" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <div class="mp-bench-lane home" id="mp-bench-home" aria-hidden="true"></div>
          <div class="mp-bench-lane away" id="mp-bench-away" aria-hidden="true"></div>
          <canvas class="mp-canvas" id="mp-canvas" aria-hidden="true"></canvas>
          <div class="mp-actors" id="mp-actors"></div>
          <div class="mp-fx" id="mp-fx"></div>
        </div>
        <div class="mp-replay-badge hidden" id="mp-replay-badge">重播</div>
        <div class="mp-rec-badge hidden" id="mp-rec-badge">● REC</div>
        <div class="mp-banner hidden" id="mp-banner"></div>
        <div class="mp-caption hidden" id="mp-caption" aria-live="polite"></div>
        <div class="mp-flash-card hidden" id="mp-flash-card" aria-live="polite"></div>
        <div class="mp-tip hidden" id="mp-tip"></div>
        <div class="mp-card hidden" id="mp-card"></div>
      </div>
      <!-- FMM 底栏：解说文案 ↔ 控球条（互斥） -->
      <div class="mp-fmm-dock" id="mp-fmm-dock">
        <div class="mp-fmm-ticker" id="mp-fmm-ticker" aria-live="polite"></div>
        <div class="mp-fmm-poss show" id="mp-fmm-poss" aria-hidden="false">
          <span class="mp-fmm-poss-val" id="mp-fmm-poss-h">50%</span>
          <div class="mp-fmm-poss-bar"><i id="mp-fmm-poss-fill" style="width:50%"></i></div>
          <span class="mp-fmm-poss-val" id="mp-fmm-poss-a">50%</span>
        </div>
        <div class="mp-fmm-dock-meta">
          <span class="mp-fmm-speed" id="mp-fmm-speed">×1</span>
          <button type="button" class="mp-fmm-skip hidden" id="mp-fmm-skip">跳过</button>
        </div>
      </div>
      <div class="mp-live-strip" id="mp-live-strip" aria-hidden="true">
        <div class="mp-strip-row">
          <span class="mp-strip-val" id="mp-strip-poss-h">50</span>
          <div class="mp-strip-mid">
            <span class="mp-strip-label">POS</span>
            <div class="mp-strip-bar"><i id="mp-strip-poss-bar" style="width:50%"></i></div>
          </div>
          <span class="mp-strip-val" id="mp-strip-poss-a">50</span>
        </div>
        <div class="mp-strip-row">
          <span class="mp-strip-val" id="mp-strip-xg-h">0.00</span>
          <div class="mp-strip-mid">
            <span class="mp-strip-label">xG</span>
            <div class="mp-strip-bar dual">
              <i class="h" id="mp-strip-xg-h-bar" style="width:50%"></i>
              <i class="a" id="mp-strip-xg-a-bar" style="width:50%"></i>
            </div>
          </div>
          <span class="mp-strip-val" id="mp-strip-xg-a">0.00</span>
        </div>
      </div>
      <div class="mp-legend hidden">
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
    this.captionEl = wrap.querySelector("#mp-caption");
    this.flashCardEl = wrap.querySelector("#mp-flash-card");
    this.liveStripEl = wrap.querySelector("#mp-live-strip");
    this.tipEl = wrap.querySelector("#mp-tip");
    this.cardEl = wrap.querySelector("#mp-card");
    this.possHalfEl = wrap.querySelector("#mp-poss-half");
    this.formZonesEl = wrap.querySelector("#mp-form-zones");
    this.attackArrowEl = wrap.querySelector("#mp-attack-arrow");
    this.replayBadgeEl = wrap.querySelector("#mp-replay-badge");
    this.benchHomeEl = wrap.querySelector("#mp-bench-home");
    this.benchAwayEl = wrap.querySelector("#mp-bench-away");
    this.canvas = wrap.querySelector("#mp-canvas");
    this.recBadgeEl = wrap.querySelector("#mp-rec-badge");
    // FMM 底栏
    this.fmmDockEl = wrap.querySelector("#mp-fmm-dock");
    this.fmmTickerEl = wrap.querySelector("#mp-fmm-ticker");
    this.fmmPossEl = wrap.querySelector("#mp-fmm-poss");
    this.fmmPossFillEl = wrap.querySelector("#mp-fmm-poss-fill");
    this.fmmPossHEl = wrap.querySelector("#mp-fmm-poss-h");
    this.fmmPossAEl = wrap.querySelector("#mp-fmm-poss-a");
    this.fmmSpeedEl = wrap.querySelector("#mp-fmm-speed");
    this.fmmSkipEl = wrap.querySelector("#mp-fmm-skip");
    this._fmmTickerToken = 0;
    this._fmmReplay = { active: false, skip: false };
    this._lastTimeline = null;
    this._canvasEnabled = true;
    if (this.fmmSkipEl) {
      this.fmmSkipEl.addEventListener("click", () => {
        this._fmmReplay.skip = true;
        this.stopSimTimeline?.();
        this.setFmmReplayChrome(false);
      });
    }
    this._rec = { active: false, frames: [], t0: 0, lastPush: 0 };
    this._initCanvas();
    this.focusIds = new Set();
    this.focusUntil = 0;
    this.aftermathUntil = 0;
    this.camMode = "wide";
    // 恢复静音偏好
    try {
      this._sfxMuted = localStorage.getItem("vcfm_sfx_muted") === "1";
    } catch {
      this._sfxMuted = false;
    }
    const legH = wrap.querySelector("#mp-leg-home");
    const legA = wrap.querySelector("#mp-leg-away");
    this.passNetwork = new Map();
    this.networkEnabled = false;
    this.networkFilter = "both";
    this.heatEnabled = false;
    this.lastCarrierId = null;
    this.carrier = null;
    this.ballFlightUntil = 0;
    this.actionTimer = 0.4;
    this._initHeatGrid();
    this._bindNetworkControls(wrap);
    // FMM：网/热区默认关
    this.networkSvg?.classList.add("hidden", "fmm-net-off");
    this.heatLayer?.classList.add("fmm-heat-off");
    const netToggle = wrap.querySelector("#mp-net-toggle");
    netToggle?.classList.remove("active");

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
    // 球门方向标签（主队守下半场，客队守上半场 — 经典 FM 2D）
    const endH = wrap.querySelector("#mp-end-home");
    const endA = wrap.querySelector("#mp-end-away");
    if (endH) endH.textContent = (home.short || home.name || "HOME").slice(0, 10);
    if (endA) endA.textContent = (away.short || away.name || "AWAY").slice(0, 10);

    this.players = [];
    const homeNum = readableNumberColor(homeKit.primary, homeKit.numberColor);
    const awayNum = readableNumberColor(awayPrimary, awayKit.numberColor);
    // 写回 kit，避免存档里错误的白字粉衣继续沿用
    if (homeKit) homeKit.numberColor = homeNum;
    if (awayKit) awayKit.numberColor = awayNum;
    this._spawnTeam(actors, home, true, homeKit.primary, homeNum);
    this._spawnTeam(actors, away, false, awayPrimary, awayNum);
    this._spawnBench(home, true, homeKit.primary, homeNum);
    this._spawnBench(away, false, awayPrimary, awayNum);
    this._buildFormationZones();

    const ballEl = document.createElement("div");
    ballEl.className = "mp-ball";
    actors.appendChild(ballEl);
    this.ball = { x: 50, y: 50, tx: 50, ty: 50, el: ballEl };
    this._applyBall();

    this.cam = { x: 0, y: 0, tx: 0, ty: 0, scale: 1, tScale: 1 };
    this._applyCamera();
    this._updatePossessionChrome();

    this._built = true;
    // 赛前站位：静止，等 kickoff 再进入 play（修复未开赛就跑动）
    this.phase = "pre";
    this.carrier = null;
    this.ballState = "free";
    this.flight = null;
    this.ballFlightUntil = 0;
    this.actionTimer = 999;
    this.passTimer = 999;
    this.shapeTimer = 999;
    this.directorBias = 0.5;
    this.frozen = false;
    this.scriptLock = false;
    this.aftermathUntil = 0;
    this.camMode = "wide";
    this._clearFocus?.();
    this._syncClickable();
    this.startLoop();
    this.setBanner("");
    this.setCaption?.("");
    this.hideFlashCard?.();
    this.hidePlayerCard();
  }

  // ---------- 轻音效（Web Audio，无外部文件） ----------
  _ensureAudio() {
    if (this._sfxMuted) return null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!this._audioCtx) this._audioCtx = new AC();
      if (this._audioCtx.state === "suspended") this._audioCtx.resume().catch(() => {});
      return this._audioCtx;
    } catch {
      return null;
    }
  }

  /**
   * @param {'goal'|'whistle'|'card'|'save'|'kick'|'cheer'} kind
   */
  playSfx(kind) {
    const ctx = this._ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const beep = (freq, dur, type = "sine", gain = 0.08, when = 0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + when);
      g.gain.exponentialRampToValueAtTime(gain, now + when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + when + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now + when);
      o.stop(now + when + dur + 0.02);
    };
    switch (kind) {
      case "goal":
        beep(523, 0.12, "triangle", 0.09, 0);
        beep(659, 0.14, "triangle", 0.08, 0.1);
        beep(784, 0.22, "triangle", 0.07, 0.22);
        break;
      case "cheer":
        beep(200, 0.35, "sawtooth", 0.03, 0);
        beep(280, 0.4, "sawtooth", 0.025, 0.05);
        break;
      case "whistle":
        beep(1800, 0.18, "square", 0.04, 0);
        beep(1600, 0.12, "square", 0.03, 0.2);
        break;
      case "card":
        beep(440, 0.08, "square", 0.05, 0);
        beep(330, 0.12, "square", 0.04, 0.1);
        break;
      case "save":
        beep(300, 0.1, "triangle", 0.06, 0);
        beep(180, 0.15, "sine", 0.05, 0.08);
        break;
      case "kick":
        beep(120, 0.06, "triangle", 0.05, 0);
        break;
      default:
        break;
    }
  }

  /**
   * 关键事件闪卡（进球/红黄牌/伤病）
   * @param {{ title: string, sub?: string, kind?: string, player?: object|null, team?: 'home'|'away' }} opts
   */
  showFlashCard(opts = {}) {
    if (!this.flashCardEl) return;
    const kind = opts.kind || "info";
    const p = opts.player;
    const club = p
      ? this.players.find((x) => x.id === p.id)?.club ||
        (opts.team === "away" ? this.away : this.home)
      : opts.team === "away"
        ? this.away
        : this.home;
    const kit = club ? ensureKit(club) : null;
    const color = kit?.primary || "#3d8bfd";
    const num = p?.number ?? "";
    const name = p ? playerDisplaySurname(p.name, p.nationality) : "";
    this.flashCardEl.innerHTML = `
      <div class="mp-flash-inner">
        <span class="mp-flash-badge" style="background:${color}">${num || "•"}</span>
        <div class="mp-flash-text">
          <strong>${escapeHtml(opts.title || "")}</strong>
          ${name ? `<em>${escapeHtml(name)}</em>` : ""}
          ${opts.sub ? `<span>${escapeHtml(opts.sub)}</span>` : ""}
        </div>
      </div>`;
    this.flashCardEl.className = `mp-flash-card ${kind}`;
    this.flashCardEl.classList.remove("hidden");
    const token = ++this._flashCardToken;
    const ms = opts.ms ?? 2200;
    setTimeout(() => {
      if (this._flashCardToken !== token) return;
      this.hideFlashCard();
    }, ms);
  }

  hideFlashCard() {
    if (!this.flashCardEl) return;
    this.flashCardEl.classList.add("hidden");
    this.flashCardEl.innerHTML = "";
  }

  /**
   * 战术调整可见反馈：压迫线/队形 + 字幕
   * @param {'home'|'away'} team
   * @param {{ style?: string, pressing?: number, tempo?: number, label?: string, styleLabel?: string }} orders
   */
  showTacticsFeedback(team, orders = {}) {
    if (!this._built) return;
    const side = team === "away" ? "away" : "home";
    const press = orders.pressing != null ? +orders.pressing : null;
    const tempo = orders.tempo != null ? +orders.tempo : null;
    const style = orders.style || "";
    // 压迫高 → 防线前压；低 → 回收
    if (press != null) {
      const amount = clamp((press - 3) * 0.22 + 0.35, 0.15, 0.85);
      if (press >= 4) {
        this._nudgeAttackShape(side, amount);
        // 无球时也整体前压一点
        const dir = this._attackDir(side);
        for (const pl of this.players) {
          if (pl.team !== side || pl.pos === "GK" || pl.el.classList.contains("sent-off")) continue;
          pl.ty = clamp(pl.ty + dir * (press - 3) * 2.2, 6, 94);
        }
      } else if (press <= 2) {
        this._setBlockShape(side, "defend");
      } else {
        this._nudgeAttackShape(side, 0.25);
      }
    }
    if (style === "attack" || style === "counter") {
      this._nudgeAttackShape(side, 0.55);
      this.camMode = "ball";
      this.camBoostUntil = performance.now() + 600;
    } else if (style === "defend" || style === "possession") {
      this._setBlockShape(side, style === "defend" ? "defend" : "compact");
    }
    if (tempo != null && tempo >= 4) {
      // 高节奏：持球决策更快
      this.actionTimer = Math.min(this.actionTimer, 0.15);
      this.passTimer = 0.12;
    } else if (tempo != null && tempo <= 2) {
      this.actionTimer = Math.max(this.actionTimer, 0.55);
    }
    const en = document.documentElement.lang === "en";
    let label = orders.label;
    if (!label) {
      const bits = [en ? "Tactics" : "战术"];
      const styleName = orders.styleLabel || style;
      if (styleName) bits.push(styleName);
      if (press != null) {
        const arrow = press >= 4 ? "↑" : press <= 2 ? "↓" : "·";
        bits.push(en ? `Press ${arrow}${press}` : `压迫${arrow}${press}`);
      }
      if (tempo != null) {
        const arrow = tempo >= 4 ? "↑" : tempo <= 2 ? "↓" : "·";
        bits.push(en ? `Tempo ${arrow}${tempo}` : `节奏${arrow}${tempo}`);
      }
      label = bits.join(" · ");
    }
    this.setCaption(label, "info", 2200);
    this.setBanner("📋", "info");
    setTimeout(() => {
      if (this._built) this.setBanner("");
    }, 1000);
    this.playSfx("whistle");
    // 短暂焦点：中场线
    const mids = this.players.filter(
      (p) => p.team === side && p.pos === "MID" && !p.el.classList.contains("sent-off")
    );
    if (mids.length) this._setFocus(mids.slice(0, 3), 1600);
  }

  /**
   * 换人：场上替换身份 + 横幅/闪卡
   * @param {'home'|'away'} team
   * @param {{ outId?: string, inId?: string, outName?: string, inName?: string, text?: string, club?: object }} info
   */
  showSubFeedback(team, info = {}) {
    if (!this._built) return;
    const side = team === "away" ? "away" : "home";
    const club =
      info.club ||
      (side === "home" ? this.home : this.away) ||
      null;
    const outId = info.outId;
    const inId = info.inId;
    let board = null;
    if (outId && inId) {
      board = this.applySubOnPitch(outId, inId, club);
    }
    const outName =
      info.outName || board?.outName || "";
    const inName = info.inName || board?.inName || "";
    const en = document.documentElement.lang === "en";
    const line =
      info.text ||
      (outName && inName
        ? en
          ? `SUB: ${outName} ↓ → ${inName} ↑`
          : `换人：${outName} ↓ → ${inName} ↑`
        : en
          ? "Substitution"
          : "换人");
    this.camMode = "wide";
    this.camBoostUntil = performance.now() + 900;
    this.setBanner("🔄", "info");
    this.setCaption(line, "info", 2000);
    this.playSfx("whistle");
    setTimeout(() => {
      if (this._built) this.setBanner("");
    }, 900);
    const inPl = inId ? this.players.find((p) => p.id === inId) : null;
    if (inPl) {
      inPl.el.classList.add("highlight");
      this.highlightId = inPl.id;
      this.flashUntil = performance.now() + 2200;
      this._setFocus([inPl], 1800);
      if (inPl.player) {
        this.showFlashCard({
          title: en ? "SUB ON" : "上场",
          sub: inName || inPl.name || "",
          kind: "info",
          player: inPl.player,
          team: side,
          ms: 2000,
        });
      }
    }
    this._nudgeAttackShape(side, 0.18);
  }

  /**
   * 把下场球员的场上棋子换成上场球员（保持站位）
   * @returns {{ outName: string, inName: string }|null}
   */
  applySubOnPitch(outId, inId, club) {
    if (!this._built || !outId || !inId) return null;
    const pl = this.players.find((p) => p.id === outId);
    if (!pl) return null;
    const inn =
      (club?.players || []).find((p) => p.id === inId) ||
      (this.home?.players || []).find((p) => p.id === inId) ||
      (this.away?.players || []).find((p) => p.id === inId);
    if (!inn) return null;
    const outName = pl.player?.name || pl.name || "";
    const wasCarrier = this.carrier === pl;
    // 身份替换，坐标保留
    pl.id = inn.id;
    pl.player = inn;
    pl.club = club || pl.club;
    pl.num = inn.number ?? pl.num;
    pl.pos = inn.pos || pl.pos;
    pl.name = playerDisplaySurname(inn.name, inn.nationality);
    pl.el.dataset.id = inn.id;
    pl.el.title = inn.name || "";
    const numEl = pl.el.querySelector(".mp-num");
    if (numEl) numEl.textContent = String(pl.num);
    const nameEl = pl.el.querySelector(".mp-name");
    if (nameEl) nameEl.textContent = pl.name;
    if (this.lastCarrierId === outId) this.lastCarrierId = inId;
    if (wasCarrier) this._setCarrier(pl, { stick: true });
    // 上场球员从边线轻跑进位
    const edgeX = pl.x < 50 ? 4 : 96;
    pl.x = lerp(edgeX, pl.baseX, 0.35);
    pl.y = lerp(pl.y, pl.baseY, 0.2);
    pl.tx = pl.baseX;
    pl.ty = pl.baseY;
    this._applyPlayer(pl);
    return { outName, inName: inn.name };
  }

  /**
   * 下半场开球提示（比分情境 / 已调整）
   * @param {{ text?: string, lang?: string }} opts
   */
  showSecondHalfKickoff(opts = {}) {
    if (!this._built) return;
    const en = (opts.lang || document.documentElement.lang) === "en";
    const text =
      opts.text ||
      (en ? "2nd half — kick-off" : "下半场开始");
    this.phase = "play";
    this.camMode = "wide";
    this.camBoostUntil = performance.now() + 800;
    this.ball.tx = 50;
    this.ball.ty = 50;
    this.setBanner(en ? "2ND HALF" : "下半场", "info");
    this.setCaption(text, "info", 2400);
    this.playSfx("whistle");
    setTimeout(() => {
      if (this._built) this.setBanner("");
    }, 1200);
    this._syncClickable?.();
  }

  /**
   * 关键事件后收尾：球权/站位缓慢回落，避免硬切回乱踢
   * @param {{ flipPossession?: boolean, delayMs?: number, toGk?: boolean }} opts
   */
  _scheduleAftermath(opts = {}) {
    const delay = opts.delayMs ?? 700;
    const token = (this._aftermathToken = (this._aftermathToken || 0) + 1);
    setTimeout(() => {
      if (!this._built || this._aftermathToken !== token) return;
      if (this.phase === "pause" || this.phase === "goal" || this.phase === "pre") return;
      this._beginAftermath({
        flipPossession: !!opts.flipPossession,
        toGk: !!opts.toGk,
      });
    }, delay);
  }

  _beginAftermath({ flipPossession = false, toGk = false } = {}) {
    if (this.phase !== "play") return;
    this.aftermathUntil = performance.now() + 900;
    this.scriptLock = false;
    this.camMode = "wide";
    this.camBoostUntil = 0;
    this.actionTimer = 0.9;
    this.passTimer = 0.8;
    this.shapeTimer = 1.2;

    if (flipPossession) {
      this.possession = this.possession === "home" ? "away" : "home";
    }
    this._clearCarrier();
    this.flight = null;
    this.ballFlightUntil = 0;

    const side = this.possession;
    if (toGk) {
      const gk = this.players.find(
        (p) => p.team === side && p.pos === "GK" && !p.el.classList.contains("sent-off")
      );
      if (gk) {
        this.ball.tx = gk.x;
        this.ball.ty = gk.y;
        this._beginFlight({
          x: gk.x,
          y: gk.y,
          receiverId: gk.id,
          kind: "pass",
          ms: 400,
        });
        // 门将持球后交给后场
        setTimeout(() => {
          if (!this._built || this.phase !== "play") return;
          const def = this.players
            .filter(
              (p) =>
                p.team === side &&
                p.pos === "DEF" &&
                !p.el.classList.contains("sent-off")
            )
            .sort(
              (a, b) =>
                Math.hypot(a.x - gk.x, a.y - gk.y) - Math.hypot(b.x - gk.x, b.y - gk.y)
            )[0];
          if (def) {
            this._passTo(gk, def, { flightMs: 560 });
          } else {
            this._setCarrier(gk, { stick: true });
          }
          this.actionTimer = 0.5;
        }, 450);
      }
    } else {
      // 球滚到边路/中圈附近，最近人捡
      const bx = clamp(this.ball.x + (Math.random() - 0.5) * 12, 12, 88);
      const by = clamp(50 + (Math.random() - 0.5) * 16, 20, 80);
      this.ball.tx = bx;
      this.ball.ty = by;
      this._beginFlight({ x: bx, y: by, kind: "pass", ms: 350 });
      this.actionTimer = 0.4;
    }

    this._nudgeAttackShape(side, 0.2);
    this._nudgeDefendShape(side === "home" ? "away" : "home", this.ball);
    this._clearFocus();
  }

  /**
   * UI 暂停冻结（不改变 phase，避免把人钉回阵型）
   * @param {boolean} v
   */
  setFrozen(v) {
    this.frozen = !!v;
    this.fieldEl?.classList.toggle("mp-ui-paused", this.frozen);
  }

  /** 音效开关 */
  setSfxMuted(v) {
    this._sfxMuted = !!v;
    try {
      localStorage.setItem("vcfm_sfx_muted", this._sfxMuted ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  isSfxMuted() {
    return !!this._sfxMuted;
  }

  /**
   * 球场角标：控球 + xG 迷你条
   * @param {{ home?: { xg?: number, possession?: number }, away?: { xg?: number, possession?: number } }} snap
   */
  updateLiveStrip(snap) {
    if (!this.liveStripEl || !snap) return;
    const hp = Math.round(snap.home?.possession ?? 50);
    const ap = Math.round(snap.away?.possession ?? 100 - hp);
    const hx = Number(snap.home?.xg) || 0;
    const ax = Number(snap.away?.xg) || 0;
    const xt = hx + ax || 1;
    const set = (sel, text) => {
      const el = this.liveStripEl.querySelector(sel);
      if (el) el.textContent = text;
    };
    const bar = (sel, pct) => {
      const el = this.liveStripEl.querySelector(sel);
      if (el) el.style.width = `${clamp(pct, 4, 96)}%`;
    };
    set("#mp-strip-poss-h", String(hp));
    set("#mp-strip-poss-a", String(ap));
    set("#mp-strip-xg-h", hx.toFixed(2));
    set("#mp-strip-xg-a", ax.toFixed(2));
    bar("#mp-strip-poss-bar", hp);
    bar("#mp-strip-xg-h-bar", (hx / xt) * 100);
    bar("#mp-strip-xg-a-bar", (ax / xt) * 100);
    this.liveStripEl.classList.add("show");
  }

  /**
   * 完场高亮本场最佳
   * @param {{ playerId?: string, name?: string, rating?: number, side?: string }} motm
   */
  highlightMotm(motm) {
    if (!this._built || !motm) return;
    for (const pl of this.players) pl.el.classList.remove("motm");
    const pl =
      (motm.playerId && this.players.find((p) => p.id === motm.playerId)) ||
      this.players.find((p) => p.player?.name === motm.name);
    if (!pl) return;
    pl.el.classList.add("motm", "highlight");
    this.highlightId = pl.id;
    this.flashUntil = performance.now() + 8000;
    this._setFocus([pl], 5000);
    this.camMode = "ball";
    this.camBoostUntil = performance.now() + 2000;
    this.ball.tx = pl.x;
    this.ball.ty = pl.y;
    this.showFlashCard({
      title: document.documentElement.lang === "en" ? "MOTM" : "本场最佳",
      sub: motm.rating != null ? String(motm.rating) : "",
      kind: "goal",
      player: pl.player,
      team: pl.team,
      ms: 3200,
    });
  }

  /**
   * 从事件对齐控球方（表现层，不改比分）
   */
  _alignPossessionFromEvent(ev, fixture) {
    if (!ev) return;
    const homeId = fixture?.home || this.home?.id;
    const isHome = (id) => id && id === homeId;
    switch (ev.type) {
      case "chance":
      case "woodwork":
      case "corner":
      case "penalty":
      case "pen_miss":
      case "goal":
        if (ev.teamId) this.possession = isHome(ev.teamId) ? "home" : "away";
        break;
      case "save":
        // 扑救方是防守方 → 进攻是对方
        if (ev.teamId) this.possession = isHome(ev.teamId) ? "away" : "home";
        break;
      case "card":
      case "red":
      case "injury":
        // 犯规/受伤附近球权可归对方，表现上球靠近该球员即可
        break;
      default:
        break;
    }
  }

  /**
   * 关键事件前预演：从「当前场面」自然推进到禁区，不硬切中场
   * FMM 观感关键：连续，而不是更长的「新剧本」
   */
  async prepareEvent(ev, snap, fixture, opts = {}) {
    if (!this._built || !ev || this.phase === "pre" || this.phase === "idle") return;
    // 真空间投影 / v2 事件：不编舞，只贴最新引擎帧
    if (this.simDrive || snap?.sim || snap?.engine === "v2" || ev?.fromSim) {
      if (snap?.sim) this.applySimSnapshot(snap.sim);
      if (!this.simDrive) this.setSimDrive?.(true);
      return;
    }
    const sleepFn = typeof opts.sleepFn === "function" ? opts.sleepFn : sleep;
    const speed = Math.max(0.25, Number(opts.speed) || 1);
    const wait = (ms) => sleepFn(Math.max(40, ms / Math.min(speed, 2.2)));

    const soft = new Set(["card", "red", "injury", "sub", "tactics", "coach", "context"]);
    if (soft.has(ev.type)) {
      this._alignPossessionFromEvent(ev, fixture);
      return;
    }

    // 进球走完整高光；此处只对齐控球，避免和回放抢镜头
    if (ev.type === "goal") {
      this._alignPossessionFromEvent(ev, fixture);
      return;
    }

    const needsBuildup = new Set([
      "chance",
      "woodwork",
      "save",
      "corner",
      "penalty",
      "pen_miss",
    ]);
    if (!needsBuildup.has(ev.type)) {
      this._alignPossessionFromEvent(ev, fixture);
      return;
    }

    const live = opts.live !== false;
    this._alignPossessionFromEvent(ev, fixture);
    const side = this.possession;
    const dir = this._attackDir(side);
    const attHome = side === "home";
    const kind =
      ev.type === "save"
        ? "save"
        : ev.type === "penalty" || ev.type === "pen_miss"
          ? "pen"
          : "chance";

    // 快进：只轻推到威胁区，不跑完整组织
    if (!live && speed >= 2) {
      this._nudgeAttackShape(side, 0.35);
      const hero =
        (ev.playerId && this.players.find((p) => p.id === ev.playerId)) ||
        this.carrier ||
        this._nearestOutfield(side, this.ball.x, this.ball.y);
      if (hero) {
        hero.tx = clamp(hero.x + (Math.random() - 0.5) * 8, 16, 84);
        hero.ty = clamp(attHome ? Math.min(hero.y, 22) : Math.max(hero.y, 78), 8, 92);
        this._setCarrier(hero, { stick: true });
      }
      await wait(200);
      return;
    }

    this.scriptLock = true;
    this.phase = "play";
    this.camMode = "ball";
    this.actionTimer = 99;
    this.passTimer = 99;
    this.shapeTimer = 99;

    try {
      // —— 从当前球/持球人延续，禁止瞬移回中场 ——
      let organizer =
        this.carrier && this.carrier.team === side && !this.carrier.el.classList.contains("sent-off")
          ? this.carrier
          : this._nearestOutfield(side, this.ball.x, this.ball.y);

      let hero =
        (ev.playerId && this.players.find((p) => p.id === ev.playerId)) || null;
      if (hero && hero.team !== side) hero = null;
      if (!hero || hero === organizer) {
        // 前插优先：同队里更靠前的人
        const pool = this.players.filter(
          (p) =>
            p.team === side &&
            p !== organizer &&
            p.pos !== "GK" &&
            !p.el.classList.contains("sent-off")
        );
        pool.sort((a, b) => {
          const fa = (a.y - (organizer?.y || 50)) * dir;
          const fb = (b.y - (organizer?.y || 50)) * dir;
          const da = Math.hypot(a.x - (organizer?.x || 50), a.y - (organizer?.y || 50));
          const db = Math.hypot(b.x - (organizer?.x || 50), b.y - (organizer?.y || 50));
          return fb * 2 - fa * 2 + da - db + (b.pos === "ATT" ? -3 : 0) - (a.pos === "ATT" ? -3 : 0);
        });
        hero = pool[0] || organizer;
      }

      // 球若在别处，先让组织者自然拿球（不瞬移）
      if (organizer) {
        if (!this.carrier || this.carrier !== organizer) {
          const dist = Math.hypot(organizer.x - this.ball.x, organizer.y - this.ball.y);
          if (dist > 8) {
            organizer.tx = this.ball.x;
            organizer.ty = this.ball.y;
            this.ball.tx = organizer.x;
            this.ball.ty = organizer.y;
            this._beginFlight({
              x: organizer.x,
              y: organizer.y,
              receiverId: organizer.id,
              kind: "pass",
              ms: live ? 280 : 140,
            });
            await wait(live ? 320 : 150);
          }
          this._setCarrier(organizer, { stick: true });
        } else {
          this._setCarrier(organizer, { stick: true });
        }
      }

      // 只轻推队形目标，不整队瞬移
      this._nudgeAttackShape(side, 0.45);
      this._nudgeDefendShape(side === "home" ? "away" : "home", organizer || this.ball);

      // 接应/前插：只设目标，靠帧循环跑过去
      if (hero && hero !== organizer) {
        hero.tx = clamp(
          (organizer?.x || this.ball.x) + (Math.random() - 0.5) * 14,
          12,
          88
        );
        hero.ty = clamp(
          (organizer?.y || this.ball.y) + dir * (10 + Math.random() * 10),
          8,
          92
        );
      }
      const support = this.players
        .filter(
          (p) =>
            p.team === side &&
            p !== hero &&
            p !== organizer &&
            p.pos !== "GK" &&
            !p.el.classList.contains("sent-off")
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - (organizer?.x || 50), a.y - (organizer?.y || 50)) -
            Math.hypot(b.x - (organizer?.x || 50), b.y - (organizer?.y || 50))
        )[0];
      if (support) {
        support.tx = clamp((organizer?.x || 50) + (Math.random() < 0.5 ? -14 : 14), 10, 90);
        support.ty = clamp((organizer?.y || 50) + dir * 6, 10, 90);
      }

      this._setFocus([organizer, hero, support].filter(Boolean), 4200);
      {
        const en = document.documentElement.lang === "en";
        const cap =
          ev.type === "corner"
            ? en
              ? "Corner build-up…"
              : "角球组织…"
            : ev.type === "save"
              ? en
                ? "Threat building…"
                : "威胁进攻…"
              : en
                ? "Build-up…"
                : "组织进攻…";
        this.setCaption?.(cap, "info", 0);
      }

      // 1) 保持当前持球，向前推进（从现位置出发）
      if (organizer) {
        organizer.tx = clamp(organizer.x + (Math.random() - 0.5) * 8, 12, 88);
        organizer.ty = clamp(organizer.y + dir * (7 + Math.random() * 6), 10, 90);
        this._setTouch(organizer, 1400);
      }
      await wait(live ? 700 : 220);

      // 1b) 再前压一段 / 横带摆脱
      if (organizer) {
        const lateral = Math.random() < 0.45;
        organizer.tx = clamp(
          organizer.x + (lateral ? (Math.random() < 0.5 ? -10 : 10) : (Math.random() - 0.5) * 6),
          12,
          88
        );
        organizer.ty = clamp(organizer.y + dir * (lateral ? 4 : 8), 10, 90);
      }
      if (hero && hero !== organizer) {
        hero.tx = clamp(hero.x + (Math.random() - 0.5) * 8, 14, 86);
        hero.ty = clamp(hero.y + dir * 8, 8, 92);
      }
      await wait(live ? 640 : 200);

      // 2) 传球给前插（若已够靠前则自己带）
      const prog = organizer
        ? attHome
          ? 100 - organizer.y
          : organizer.y
        : 50;
      const needPass = hero && hero !== organizer && (prog < 68 || Math.random() < 0.65);

      if (needPass) {
        // 接应目标朝禁区方向，但不瞬移
        hero.tx = clamp(hero.x + (Math.random() - 0.5) * 8, 16, 84);
        hero.ty = clamp(
          attHome ? Math.min(hero.y, 22 + Math.random() * 10) : Math.max(hero.y, 78 - Math.random() * 10),
          8,
          92
        );
        this._passTo(organizer, hero, { flightMs: live ? 700 : 380 });
        await wait(live ? 860 : 420);
        if (this.carrier !== hero) this._setCarrier(hero, { stick: true });
        this._setTouch(hero, 1200);
        await wait(live ? 420 : 140);
      } else if (organizer) {
        // 自己带入威胁区
        organizer.tx = clamp(organizer.x + (Math.random() - 0.5) * 6, 16, 84);
        organizer.ty = clamp(
          attHome ? Math.min(organizer.y, 24) : Math.max(organizer.y, 76),
          8,
          92
        );
        await wait(live ? 560 : 180);
        hero = organizer;
      }

      // 3) 最后一段：持球人朝禁区跑（只设目标，不 lerp 瞬移）
      this.camMode = kind === "pen" || kind === "chance" || kind === "save" ? "box" : "ball";
      this.camBoostUntil = performance.now() + 1200;
      const finisher = this.carrier && this.carrier.team === side ? this.carrier : hero || organizer;
      if (finisher) {
        const boxY = attHome ? 18 + Math.random() * 8 : 82 - Math.random() * 8;
        finisher.tx = clamp(finisher.x * 0.55 + 50 * 0.2 + (Math.random() - 0.5) * 12, 20, 80);
        finisher.ty = boxY;
        this._setCarrier(finisher, { stick: true });
        this._setFocus([finisher], 2200);
      }

      // 角球：球从当前滚向角旗，人再堆禁区
      if (ev.type === "corner") {
        const left = (finisher?.x ?? this.ball.x) < 50;
        const cx = left ? 6 : 94;
        const cy = attHome ? 6 : 94;
        this._clearCarrier();
        this._beginFlight({ x: cx, y: cy, kind: "pass", ms: live ? 420 : 180 });
        this._addTrail(this.ball.x, this.ball.y, cx, cy, "pass", 0.45);
        for (const pl of this.players.filter((p) => p.team === side && p.pos !== "GK")) {
          if (Math.random() < 0.55) {
            pl.tx = clamp(30 + Math.random() * 40, 14, 86);
            pl.ty = clamp(attHome ? 12 + Math.random() * 14 : 88 - Math.random() * 14, 6, 94);
          }
        }
        await wait(live ? 520 : 160);
      } else {
        await wait(live ? 560 : 160);
      }
    } finally {
      this.scriptLock = false;
      this.actionTimer = 0.45;
      this.passTimer = 0.35;
      this.shapeTimer = 2.2;
    }
  }

  /** 最近的外场球员 */
  _nearestOutfield(team, x, y) {
    const pool = this.players.filter(
      (p) => p.team === team && p.pos !== "GK" && !p.el.classList.contains("sent-off")
    );
    if (!pool.length) return null;
    pool.sort(
      (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)
    );
    return pool[0];
  }

  /**
   * 轻推进攻队形目标（不改 x/y，只改 tx/ty）
   * amount 0..1
   */
  _nudgeAttackShape(team, amount = 0.4) {
    const dir = this._attackDir(team);
    const a = clamp(amount, 0.1, 0.65);
    for (const pl of this.players) {
      if (pl.team !== team || pl.el.classList.contains("sent-off")) continue;
      if (pl === this.carrier) continue;
      const push = pl.pos === "ATT" ? 4.5 : pl.pos === "MID" ? 3 : pl.pos === "DEF" ? 1.1 : 0.15;
      // 以 base 为主，轻微前压 — 更贴阵型
      pl.tx = clamp(lerp(pl.baseX, pl.x, 0.15) + (Math.random() - 0.5) * 1.2, 6, 94);
      pl.ty = clamp(pl.baseY + dir * push * a + (Math.random() - 0.5) * 0.8, 5, 95);
    }
  }

  /** 防守方：后卫追球深度 + 中前场按球回撤（不再锁死 baseY） */
  _nudgeDefendShape(team, toward) {
    const tx = toward?.x ?? this.ball?.x ?? 50;
    const ty = toward?.y ?? this.ball?.y ?? 50;
    const outfield = this.players.filter(
      (p) => p.team === team && p.pos !== "GK" && !p.el.classList.contains("sent-off")
    );
    const defs = outfield.filter((p) => p.pos === "DEF");
    const mids = outfield.filter((p) => p.pos === "MID");
    const atts = outfield.filter((p) => p.pos === "ATT");

    // 后卫：强跟球深度，弱跟 base（避免「锁在进攻阵型后卫位」）
    defs.sort(
      (a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty)
    );
    for (let i = 0; i < defs.length; i++) {
      const pl = defs[i];
      const ballW = i < 2 ? 0.55 : i < 4 ? 0.42 : 0.3;
      const lineY =
        team === "home"
          ? clamp(ty - (i < 2 ? 8 : 12), 56, 91)
          : clamp(ty + (i < 2 ? 8 : 12), 9, 44);
      pl.tx = clamp(lerp(pl.baseX, tx, ballW) + (Math.random() - 0.5) * 2.5, 8, 92);
      pl.ty = clamp(lerp(pl.baseY, lineY, 0.72) + (Math.random() - 0.5) * 2, 6, 94);
    }

    for (const pl of mids) {
      const lineY =
        team === "home"
          ? clamp(ty - 22, 48, 80)
          : clamp(ty + 22, 20, 52);
      pl.tx = clamp(lerp(pl.baseX, tx, 0.22) + (Math.random() - 0.5) * 2, 10, 90);
      pl.ty = clamp(lineY + (Math.random() - 0.5) * 3, team === "home" ? 46 : 18, team === "home" ? 82 : 54);
    }
    for (const pl of atts) {
      const lineY =
        team === "home"
          ? clamp(Math.max(48, ty - 34), 46, 68)
          : clamp(Math.min(52, ty + 34), 32, 54);
      pl.tx = clamp(lerp(pl.baseX, 50, 0.2) + (Math.random() - 0.5) * 4, 12, 88);
      pl.ty = lineY;
    }
  }

  /**
   * 把无人球球员轻轻拉回阵型位
   * 无球方只收横向 baseX，不把 Y 拉回进攻 base（否则前锋又会蹲对方半场）
   */
  _pullTowardBase(amount = 0.15) {
    const a = clamp(amount, 0.05, 0.4);
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      if (pl === this.carrier) continue;
      pl.tx = clamp(lerp(pl.tx, pl.baseX, a), 5, 95);
      if (pl.team === this.possession) {
        pl.ty = clamp(lerp(pl.ty, pl.baseY, a * 0.85), 5, 95);
      }
      // 无球方 Y 交给 _applyDefensiveDrop / FSM cover
    }
  }

  /**
   * 导演 tick：每比赛分钟用 snap 轻推表现层控球倾向 + 攻势段落
   * 不改比分，只让场面更贴 match.js 统计
   */
  onTick(snap) {
    if (!this._built || !snap) return;
    // 空间投影帧优先
    if (snap.sim) {
      this.applySimSnapshot(snap.sim);
      this.updateLiveStrip?.(snap);
      return;
    }
    if (this.simDrive) {
      this.updateLiveStrip?.(snap);
      return;
    }
    const hp = snap.home?.possession;
    if (hp != null && Number.isFinite(hp)) {
      // 缓变，避免每分钟硬切
      const target = clamp(hp / 100, 0.15, 0.85);
      this.directorBias = lerp(this.directorBias, target, 0.35);
    }
    // 空分钟也保持「有球在踢」：若长时间 free 且 play，轻推控球
    if (this.phase === "play" && !this.frozen && this.ballState === "free" && !this.carrier) {
      this.actionTimer = Math.min(this.actionTimer, 0.12);
    }
    // 攻势段落：无关键事件时也周期性「压上」
    this._tickAttackPhase(snap);
  }

  /**
   * 开启一段攻势（表现层连续压上）
   * @param {'home'|'away'} side
   * @param {{ ms?: number, intensity?: number, caption?: boolean }} [opts]
   */
  beginAttackPhase(side, opts = {}) {
    if (!this._built || this.phase !== "play") return;
    const s = side === "away" ? "away" : "home";
    const ms = opts.ms ?? 14000;
    const intensity = clamp(opts.intensity ?? 0.7, 0.35, 1);
    const now = performance.now();
    // 同方攻势可续命，不打断
    if (this.attackPhase && this.attackPhase.side === s && this.attackPhase.until > now) {
      this.attackPhase.until = Math.max(this.attackPhase.until, now + ms * 0.7);
      this.attackPhase.intensity = Math.max(this.attackPhase.intensity, intensity);
    } else {
      this.attackPhase = { side: s, until: now + ms, intensity };
    }
    this.possession = s;
    this._updatePossessionChrome();
    this._nudgeAttackShape(s, 0.35 + intensity * 0.35);
    this._nudgeDefendShape(s === "home" ? "away" : "home", this.carrier || this.ball);
    if (opts.caption !== false && Math.random() < 0.55) {
      const en = document.documentElement.lang === "en";
      const name =
        s === "home"
          ? this.home?.short || this.home?.name || (en ? "Home" : "主队")
          : this.away?.short || this.away?.name || (en ? "Away" : "客队");
      this.setCaption(en ? `${name} press high` : `${name} 压上`, "info", 1400);
    }
    // 若无持球，尽快把球交给攻势方
    if (!this.carrier || this.carrier.team !== s) {
      this.actionTimer = Math.min(this.actionTimer, 0.12);
    }
  }

  endAttackPhase() {
    this.attackPhase = null;
  }

  _attackPhaseActive() {
    if (!this.attackPhase) return null;
    if (performance.now() >= this.attackPhase.until) {
      this.attackPhase = null;
      return null;
    }
    return this.attackPhase;
  }

  /** 每分钟：续/开攻势段落 */
  _tickAttackPhase(snap) {
    if (this.phase !== "play" || this.frozen || this.scriptLock) return;
    if (performance.now() < this.aftermathUntil) return;
    const active = this._attackPhaseActive();
    if (active) {
      // 攻势中：保持控球偏向该方
      this.possession = active.side;
      if (Math.random() < 0.35) {
        this._nudgeAttackShape(active.side, 0.2 + active.intensity * 0.2);
      }
      return;
    }
    // 无攻势：按控球/xG 概率开一段
    const hx = Number(snap?.home?.xg) || 0;
    const ax = Number(snap?.away?.xg) || 0;
    let side = Math.random() < this.directorBias ? "home" : "away";
    // xG 高的一方更易压上
    if (hx + ax > 0.2) {
      const pHome = 0.5 + (hx - ax) * 0.15;
      side = Math.random() < clamp(pHome, 0.25, 0.75) ? "home" : "away";
    }
    // 约 40% 空分钟开攻势；有球方更稳
    if (Math.random() < 0.42) {
      const ms = 10000 + Math.random() * 10000; // 10–20s
      this.beginAttackPhase(side, { ms, intensity: 0.55 + Math.random() * 0.3 });
    }
  }

  /**
   * 关键事件延长/开启攻势
   */
  extendAttackFromEvent(ev, fixture) {
    if (!ev || this.phase !== "play") return;
    const homeId = fixture?.home || this.home?.id;
    let side = null;
    if (ev.type === "chance" || ev.type === "woodwork" || ev.type === "corner" || ev.type === "penalty") {
      if (ev.teamId) side = ev.teamId === homeId ? "home" : "away";
    } else if (ev.type === "save") {
      // 进攻方是扑救队的对方
      if (ev.teamId) side = ev.teamId === homeId ? "away" : "home";
    } else if (ev.type === "goal") {
      if (ev.teamId) side = ev.teamId === homeId ? "home" : "away";
    }
    if (side) {
      this.beginAttackPhase(side, {
        ms: ev.type === "goal" ? 6000 : 16000,
        intensity: 0.85,
        caption: false,
      });
    }
  }

  /** 读球员属性 1–20 */
  _attr(pl, key, def = 10) {
    const v = pl?.player?.attrs?.[key];
    return Number.isFinite(v) ? v : def;
  }

  /** pace → 跑动速度倍率 */
  _speedMul(pl) {
    const pace = this._attr(pl, "pace", 10);
    return 0.72 + (pace / 20) * 0.65;
  }

  setOnPlayerClick(fn) {
    this.onPlayerClick = fn;
  }

  _spawnTeam(actors, club, isHome, color, numColor) {
    const form = FORMATIONS[club.tactics?.formation] || FORMATIONS["4-3-3"];
    const xi = getLineupPlayers(club) || [];
    const slots = form.slots || [];
    // 与 SimEngine 一致：按槽位匹配位置，门将必须在 GK 槽
    const assigned = assignPlayersToFormationSlots(xi, slots);
    for (let i = 0; i < Math.min(11, slots.length); i++) {
      const slot = slots[i];
      const p = assigned[i] || xi[i] || null;
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
      // 门将用醒目球衣色（金/亮绿），场上不会「找不着门将」
      const rolePos = slot.pos || p?.pos || "MID";
      const isGk = rolePos === "GK";
      const dotBg = isGk ? (isHome ? "#eab308" : "#a3e635") : color;
      // 号码必须相对球衣底色可读（粉衣绝不能白字）
      const dotFg = isGk
        ? "#0f172a"
        : readableNumberColor(dotBg, numColor);
      el.innerHTML = `
        <div class="mp-shadow" aria-hidden="true"></div>
        <div class="mp-dot${isGk ? " mp-dot-gk" : ""}" style="background:${dotBg};color:${dotFg}">
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

      // FMM：站位贴阵型，仅极轻抖动
      const jitter = () => (Math.random() - 0.5) * 0.7;
      const baseX = clamp(pos.x + jitter(), 4, 96);
      const baseY = clamp(pos.y + jitter(), 4, 96);
      // 个人防区半径：球进入才离开阵型位（参考 FM 区域职责）
      const zoneR =
        rolePos === "GK" ? 16 : rolePos === "DEF" ? 20 : rolePos === "MID" ? 26 : 22;
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
        numColor: dotFg,
        kitColor: dotBg,
        pos: rolePos,
        zoneR,
        fsm: "home", // home | support | press | cover | carry
        touchUntil: 0,
        heatAcc: 0,
      });
      this._applyPlayer(this.players[this.players.length - 1]);
    }
  }

  /** 侧边替补席（FMM 感：小板凳一列） */
  _spawnBench(club, isHome, color, numColor) {
    const lane = isHome ? this.benchHomeEl : this.benchAwayEl;
    if (!lane || !club) return;
    lane.innerHTML = "";
    const form = FORMATIONS[club.tactics?.formation] || FORMATIONS["4-3-3"];
    const xi = new Set((getLineupPlayers(club) || []).map((p) => p?.id).filter(Boolean));
    const bench = (club.players || [])
      .filter((p) => p && !xi.has(p.id) && (p.injured || 0) <= 0)
      .sort((a, b) => (b.ovr || 0) - (a.ovr || 0))
      .slice(0, 7);
    if (!bench.length) {
      lane.classList.add("empty");
      return;
    }
    lane.classList.remove("empty");
    for (const p of bench) {
      const el = document.createElement("div");
      el.className = `mp-bench-chip ${isHome ? "home" : "away"}`;
      el.title = p.name || "";
      el.innerHTML = `<span class="mp-bench-dot" style="background:${color};color:${numColor}">${p.number ?? "·"}</span>`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this._selectPlayer(p.id, isHome ? "home" : "away", p, club);
      });
      lane.appendChild(el);
    }
  }

  /** 阵型半透明色块（按 DEF/MID/ATT 区域） */
  _buildFormationZones() {
    if (!this.formZonesEl) return;
    this.formZonesEl.innerHTML = "";
    const addZones = (club, isHome, teamClass) => {
      if (!club) return;
      const form = FORMATIONS[club.tactics?.formation] || FORMATIONS["4-3-3"];
      const byPos = { DEF: [], MID: [], ATT: [] };
      for (const slot of form.slots || []) {
        if (!byPos[slot.pos]) continue;
        const p = slotToPitch(slot, isHome);
        byPos[slot.pos].push(p);
      }
      for (const pos of ["DEF", "MID", "ATT"]) {
        const pts = byPos[pos];
        if (!pts.length) continue;
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const pad = pos === "MID" ? 7 : 6;
        const minX = clamp(Math.min(...xs) - pad, 2, 90);
        const maxX = clamp(Math.max(...xs) + pad, 10, 98);
        const minY = clamp(Math.min(...ys) - pad * 0.85, 2, 90);
        const maxY = clamp(Math.max(...ys) + pad * 0.85, 10, 98);
        const el = document.createElement("div");
        el.className = `mp-zone ${teamClass} pos-${pos.toLowerCase()}`;
        el.style.left = `${minX}%`;
        el.style.top = `${minY}%`;
        el.style.width = `${Math.max(8, maxX - minX)}%`;
        el.style.height = `${Math.max(8, maxY - minY)}%`;
        this.formZonesEl.appendChild(el);
      }
    };
    addZones(this.home, true, "home");
    addZones(this.away, false, "away");
  }

  /** 控球半场高亮 + 进攻方向箭头 */
  _updatePossessionChrome() {
    if (!this._built) return;
    const side = this.possession === "away" ? "away" : "home";
    // 主队向上攻（y 减小），客队向下攻
    if (this.possHalfEl) {
      this.possHalfEl.className = `mp-poss-half side-${side}`;
      // 进攻方向的半场更亮：主队攻上半场
      this.possHalfEl.dataset.dir = side === "home" ? "up" : "down";
    }
    if (this.attackArrowEl) {
      this.attackArrowEl.className = `mp-attack-arrow side-${side}`;
      this.attackArrowEl.classList.toggle("show", this.phase === "play" && !this.frozen);
    }
    this.fieldEl?.classList.toggle("mp-poss-home", side === "home");
    this.fieldEl?.classList.toggle("mp-poss-away", side === "away");
  }

  // ---------- Canvas 渲染层（与 DOM 并存：Canvas 画球星，DOM 点选） ----------
  /**
   * 按球场真实布局尺寸同步 canvas 像素缓冲。
   * 注意：不要写死 style.width/height 像素——会和 CSS 100% 打架，
   * 首屏 flex 未算完时量错，必须缩放页面才触发 resize 才正常。
   */
  _resizeCanvas() {
    if (!this.canvas || !this.fieldEl) return false;
    // clientWidth 不吃 transform 缩放误差，比 getBoundingClientRect 更稳
    const w = Math.floor(this.fieldEl.clientWidth || 0);
    const h = Math.floor(this.fieldEl.clientHeight || 0);
    if (w < 40 || h < 40) {
      this._canvasNeedsResize = true;
      return false;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.floor(w * dpr);
    const bh = Math.floor(h * dpr);
    // 清掉可能残留的内联尺寸，交给 CSS inset:0; width/height:100%
    this.canvas.style.width = "";
    this.canvas.style.height = "";
    if (this.canvas.width !== bw || this.canvas.height !== bh || !this._cx) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this._cx = this.canvas.getContext("2d");
    }
    if (this._cx) this._cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cw = w;
    this._ch = h;
    this._canvasNeedsResize = false;
    return true;
  }

  /** 布局变化后强制重测（开赛、换屏、简报收起等） */
  refreshLayout() {
    this._resizeCanvas();
    // 再排两帧，等 flex/百分比高度落稳
    requestAnimationFrame(() => {
      this._resizeCanvas();
      requestAnimationFrame(() => this._resizeCanvas());
    });
  }

  _initCanvas() {
    if (!this.canvas || !this.fieldEl) return;
    this._resizeCanvas();

    // 窗口缩放
    this._onCanvasResize = () => this._resizeCanvas();
    window.addEventListener("resize", this._onCanvasResize);

    // 球场盒子尺寸变化（比 window.resize 更关键：切 tab、flex 重算、pre→live）
    if (typeof ResizeObserver !== "undefined") {
      this._fieldRo = new ResizeObserver(() => {
        this._resizeCanvas();
      });
      this._fieldRo.observe(this.fieldEl);
      if (this.root) this._fieldRo.observe(this.root);
    }

    // 首屏多次补测：父级 match-layout 往往晚一拍才有高度
    requestAnimationFrame(() => {
      this._resizeCanvas();
      requestAnimationFrame(() => this._resizeCanvas());
    });
    this._resizeTimers = [50, 150, 400, 800].map((ms) =>
      setTimeout(() => this._resizeCanvas(), ms)
    );

    // DOM 球员改为透明热区，视觉交给 Canvas
    this.fieldEl.classList.add("mp-canvas-mode");
  }

  /** 球轨迹采样（空中/传球丝带） */
  _pushBallTrail() {
    if (!this._ballTrail) this._ballTrail = [];
    const x = this.ball.x;
    const y = this.ball.y;
    const z = this.ball.z || 0;
    const last = this._ballTrail[this._ballTrail.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < 0.35 && Math.abs((last.z || 0) - z) < 0.15) {
      return;
    }
    this._ballTrail.push({ x, y, z });
    // 持球时轨迹短，飞行时长
    const max = !this.carrier || z > 0.6 ? 22 : 8;
    while (this._ballTrail.length > max) this._ballTrail.shift();
  }

  /**
   * FM 2D 软跟镜：缓跟球 + 死区 + 禁区微推近
   * 避免旧「每帧 ball 镜头」的眼晕，也不锁死全景。
   */
  _updateSimCamera(d) {
    // FMM：几乎全场，仅轻微跟球（对照 rec 录屏）
    const ox = (this.ball.x - 50) / 50;
    const oy = (this.ball.y - 50) / 50;
    const deep = this.ball.y < 22 || this.ball.y > 78;
    const tight = this.camMode === "box" || this.phase === "goal";
    if (tight) {
      this.cam.tx = clamp(-ox * 1.6, -2.4, 2.4);
      this.cam.ty = clamp(-oy * 1.8, -2.8, 2.8);
      this.cam.tScale = performance.now() < this.camBoostUntil ? 1.04 : 1.02;
    } else {
      const wantX = clamp(-ox * (deep ? 0.9 : 0.45), -1.4, 1.4);
      const wantY = clamp(-oy * (deep ? 1.0 : 0.4), -1.5, 1.5);
      if (Math.hypot(wantX - this.cam.tx, wantY - this.cam.ty) > 0.28) {
        this.cam.tx = wantX;
        this.cam.ty = wantY;
      }
      this.cam.tScale = deep ? 1.02 : 1.0;
    }
    const kPan = 1 - Math.pow(0.05, d);
    const kZoom = 1 - Math.pow(0.08, d);
    this.cam.x = lerp(this.cam.x, this.cam.tx, kPan);
    this.cam.y = lerp(this.cam.y, this.cam.ty, kPan);
    this.cam.scale = lerp(this.cam.scale, this.cam.tScale, kZoom);
    this._applyCamera();
  }

  _drawCanvas() {
    // 每帧检查：布局若已变化则重绑缓冲（不用再手动缩放页面）
    if (this.fieldEl) {
      const fw = Math.floor(this.fieldEl.clientWidth || 0);
      const fh = Math.floor(this.fieldEl.clientHeight || 0);
      if (
        this._canvasNeedsResize ||
        !this._cw ||
        !this._ch ||
        (fw >= 40 && Math.abs(fw - this._cw) > 1) ||
        (fh >= 40 && Math.abs(fh - this._ch) > 1)
      ) {
        this._resizeCanvas();
      }
    }
    const ctx = this._cx;
    if (!ctx || !this._canvasEnabled || !this._cw) return;
    const w = this._cw;
    const h = this._ch;
    ctx.clearRect(0, 0, w, h);
    const px = (x) => (x / 100) * w;
    const py = (y) => (y / 100) * h;
    const minDim = Math.min(w, h);
    const focusOn =
      this.focusIds?.size > 0 && performance.now() < (this.focusUntil || 0);

    // 阵型色块（轻）
    if (this.formZonesEl) {
      for (const z of this.formZonesEl.querySelectorAll(".mp-zone")) {
        const left = parseFloat(z.style.left) || 0;
        const top = parseFloat(z.style.top) || 0;
        const zw = parseFloat(z.style.width) || 0;
        const zh = parseFloat(z.style.height) || 0;
        ctx.fillStyle = z.classList.contains("home")
          ? "rgba(59,130,246,0.10)"
          : "rgba(239,68,68,0.10)";
        ctx.beginPath();
        ctx.ellipse(
          px(left + zw / 2),
          py(top + zh / 2),
          px(zw / 2),
          py(zh / 2),
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    // 球轨迹丝带（地面投影）；射门用更醒目的橙黄弧
    const trail = this._ballTrail || [];
    const isShotTrail =
      this.ballState === "shot" ||
      (this.phase === "goal" && trail.some((p) => (p.z || 0) > 0.8));
    if (trail.length >= 2) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1];
        const b = trail[i];
        const t = i / trail.length;
        const elev = Math.max(a.z || 0, b.z || 0);
        ctx.beginPath();
        ctx.moveTo(px(a.x), py(a.y));
        ctx.lineTo(px(b.x), py(b.y));
        if (isShotTrail) {
          ctx.strokeStyle = `rgba(251, 146, 60, ${0.18 + t * 0.72})`;
          ctx.lineWidth = (1.8 + t * 3.6 + elev * 0.5) * (minDim / 420);
        } else {
          ctx.strokeStyle =
            elev > 0.8
              ? `rgba(253, 224, 71, ${0.12 + t * 0.55})`
              : `rgba(248, 250, 252, ${0.08 + t * 0.42})`;
          ctx.lineWidth = (1.2 + t * 2.8 + elev * 0.35) * (minDim / 420);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 球员：先阴影再本体，持球者最后画一层环
    const drawList = this.players.filter((p) => !p.el.classList.contains("sent-off"));
    for (const pl of drawList) {
      const x = px(pl.x);
      const y = py(pl.y);
      // 与模拟层 2.85~3.35 的中心间距匹配；旧半径 9px 会让直径大于碰撞距离。
      const r = clamp(minDim * 0.022, 6, 8);
      const spd = Math.hypot(pl.vx || 0, pl.vy || 0);
      const dim =
        focusOn && !this.focusIds.has(pl.id) && !pl.el.classList.contains("has-ball");
      ctx.globalAlpha = dim ? 0.38 : 1;

      // 冲刺残影（再明显一点）
      if (spd > 0.48 && pl.heading != null && pl.pose !== "dive") {
        const hx = Math.cos(pl.heading);
        const hy = Math.sin(pl.heading);
        for (let k = 1; k <= 3; k++) {
          ctx.fillStyle = `rgba(255,255,255,${0.12 - k * 0.03})`;
          ctx.beginPath();
          ctx.arc(
            x - hx * r * k * 0.62,
            y - hy * r * k * 0.62,
            r * (1 - k * 0.14),
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }

      // 地面阴影
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.55, r * 0.72, r * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();

      // 队服圆点（扑救时仍保持圆形号码，侧移 + 残影表示倒地，不再画绿胶囊）
      const isGk = pl.pos === "GK" || pl.role === "GK";
      const bg = isGk
        ? pl.team === "home"
          ? "#eab308"
          : "#a3e635"
        : pl.el.querySelector(".mp-dot")?.style?.background ||
          (pl.team === "home" ? "#3d8bfd" : "#ef4444");
      const diving =
        pl.pose === "dive" &&
        (!pl.poseUntil || performance.now() < pl.poseUntil);
      const diveDir = diving ? pl.poseDir || 1 : 0;
      // 扑救：身体仍是圆点，只向扑球方向平移一点 + 身后残影
      const drawX = diving ? x + diveDir * r * 0.55 : x;
      const drawY = diving ? y : y;

      if (diving) {
        // 横向残影（像侧扑，而不是变成椭圆胶囊）
        for (let k = 3; k >= 1; k--) {
          ctx.globalAlpha = dim ? 0.12 : 0.16 - k * 0.03;
          ctx.beginPath();
          ctx.arc(drawX - diveDir * r * k * 0.42, drawY, r * (1 - k * 0.08), 0, Math.PI * 2);
          ctx.fillStyle = bg;
          ctx.fill();
        }
        ctx.globalAlpha = dim ? 0.38 : 1;
      }

      ctx.beginPath();
      ctx.arc(drawX, drawY, r, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();

      ctx.lineWidth = isGk ? 2.5 : pl.team === "home" ? 2 : 1.6;
      ctx.strokeStyle = isGk
        ? "rgba(15,23,42,0.9)"
        : pl.team === "home"
          ? "#fff"
          : "rgba(15,23,42,0.75)";
      if (pl.el.classList.contains("has-ball")) {
        ctx.strokeStyle = "#fde68a";
        ctx.lineWidth = 2.8;
      } else if (diving) {
        ctx.strokeStyle = "rgba(253, 224, 71, 0.95)";
        ctx.lineWidth = 2.6;
      } else if (pl.fsm === "press") {
        ctx.strokeStyle = "rgba(248,113,113,0.9)";
      } else if (pl.fsm === "support") {
        ctx.strokeStyle = "rgba(96,165,250,0.85)";
      }
      ctx.stroke();

      // 持球光环（FM 选中/持球感）
      if (pl.el.classList.contains("has-ball")) {
        ctx.beginPath();
        ctx.arc(drawX, drawY, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(253, 224, 71, 0.55)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(drawX, drawY, r + 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(253, 224, 71, 0.22)";
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // 朝向箭头
      if (pl.heading !== undefined && spd > 0.35) {
        const hx = Math.cos(pl.heading);
        const hy = Math.sin(pl.heading);
        const tipX = drawX + hx * r * 1.35;
        const tipY = drawY + hy * r * 1.35;
        const nx = -hy;
        const ny = hx;
        const baseX = drawX + hx * r * 0.55;
        const baseY = drawY + hy * r * 0.55;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(baseX + nx * r * 0.42, baseY + ny * r * 0.42);
        ctx.lineTo(baseX - nx * r * 0.42, baseY - ny * r * 0.42);
        ctx.closePath();
        ctx.fillStyle = pl.team === "home" ? "rgba(255,255,255,0.9)" : "rgba(15,23,42,0.8)";
        ctx.fill();
      }

      // 号码：描边 + 高对比填充（粉衣/浅色球衣可辨）
      {
        const numStr = String(pl.num ?? "");
        const numCol =
          pl.numColor ||
          pl.el.querySelector(".mp-dot")?.style?.color ||
          contrastText(bg);
        ctx.font = `900 ${Math.max(10, r * 1.05)}px system-ui,"Segoe UI",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // 与字色相反的描边，保证绿茵上任何球衣都清楚
        const numL = relativeLuma(numCol);
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.lineWidth = Math.max(2.8, r * 0.28);
        ctx.strokeStyle =
          numL > 0.55 ? "rgba(15,23,42,0.82)" : "rgba(255,255,255,0.88)";
        ctx.strokeText(numStr, drawX, drawY + 0.5);
        ctx.fillStyle = numCol;
        ctx.fillText(numStr, drawX, drawY + 0.5);
      }

      // 姓名：持球 / 焦点 / highlight
      if (
        pl.el.classList.contains("show-name") ||
        pl.el.classList.contains("has-ball") ||
        pl.el.classList.contains("highlight") ||
        pl.el.classList.contains("scorer") ||
        (focusOn && this.focusIds.has(pl.id))
      ) {
        ctx.font = `800 ${Math.max(8, r * 0.55)}px system-ui,sans-serif`;
        ctx.fillStyle = "#f8fafc";
        ctx.strokeStyle = "rgba(0,0,0,0.78)";
        ctx.lineWidth = 3;
        ctx.strokeText(pl.name || "", drawX, drawY + r + 8);
        ctx.fillText(pl.name || "", drawX, drawY + r + 8);
      }
      ctx.globalAlpha = 1;
    }

    // 球：z 影响阴影偏移 + 球体放大（FM 空中球）
    const bz = clamp(this.ball.z || 0, 0, 12);
    const elev = bz / 6; // 0..2
    const bx = px(this.ball.x);
    const by = py(this.ball.y);
    const br = Math.max(4, minDim * 0.012) * (1 + elev * 0.35);
    // 地面落点阴影
    const shOff = elev * minDim * 0.018;
    ctx.fillStyle = `rgba(0,0,0,${0.22 + elev * 0.18})`;
    ctx.beginPath();
    ctx.ellipse(bx + shOff * 0.35, by + br * 0.7 + shOff * 0.2, br * (1.1 + elev * 0.5), br * (0.45 + elev * 0.15), 0, 0, Math.PI * 2);
    ctx.fill();
    // 球体略上移模拟高度
    const drawY = by - elev * minDim * 0.012;
    ctx.beginPath();
    ctx.arc(bx, drawY, br, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(
      bx - br * 0.35,
      drawY - br * 0.4,
      0,
      bx,
      drawY,
      br
    );
    grad.addColorStop(0, "#fff");
    grad.addColorStop(0.55, "#e2e8f0");
    grad.addColorStop(1, "#94a3b8");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(15,23,42,0.7)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 高空时画落点十字（FMM 传球落点感）
    if (bz > 1.0) {
      ctx.strokeStyle = "rgba(253, 224, 71, 0.55)";
      ctx.lineWidth = 1.2;
      const mark = br * 1.6;
      ctx.beginPath();
      ctx.moveTo(bx - mark, by);
      ctx.lineTo(bx + mark, by);
      ctx.moveTo(bx, by - mark * 0.7);
      ctx.lineTo(bx, by + mark * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx, by, mark * 0.85, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(253, 224, 71, 0.3)";
      ctx.stroke();
    }
    // 落地弹跳涟漪
    if (this._ballBounceFlash && performance.now() < this._ballBounceFlash) {
      const life = (this._ballBounceFlash - performance.now()) / 220;
      ctx.beginPath();
      ctx.arc(bx, by, br * (1.6 + (1 - life) * 2.2), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(248,250,252,${0.35 * life})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  /** 开始/停止录制 JSON 帧（表现层回放用） */
  startRecording() {
    this._rec = { active: true, frames: [], t0: performance.now(), lastPush: 0 };
    this.recBadgeEl?.classList.remove("hidden");
  }
  stopRecording() {
    if (this._rec) this._rec.active = false;
    this.recBadgeEl?.classList.add("hidden");
    return this.getRecording();
  }
  getRecording() {
    return {
      version: 1,
      pitch: { w: 100, h: 100 },
      home: this.home?.short || this.home?.name,
      away: this.away?.short || this.away?.name,
      frames: this._rec?.frames || [],
    };
  }
  _pushRecFrame(ts) {
    if (!this._rec?.active) return;
    if (ts - (this._rec.lastPush || 0) < 50) return; // ~20fps 采样
    this._rec.lastPush = ts;
    this._rec.frames.push({
      t: Math.round(ts - this._rec.t0),
      ball: {
        x: +this.ball.x.toFixed(2),
        y: +this.ball.y.toFixed(2),
        z: +((this.ball.z || 0).toFixed(2)),
      },
      poss: this.possession,
      players: this.players.map((p) => ({
        id: p.id,
        t: p.team,
        x: +p.x.toFixed(2),
        y: +p.y.toFixed(2),
        n: p.num,
        f: p.fsm,
      })),
    });
    // 防止爆内存：最长约 3 分钟
    if (this._rec.frames.length > 3600) this._rec.frames.shift();
  }

  /**
   * 播放录制 JSON（纯前端回放）
   * @param {object} data getRecording() 结构
   * @param {{ speed?: number, sleepFn?: function }} [opts]
   */
  async playRecording(data, opts = {}) {
    const frames = data?.frames || [];
    if (!frames.length) return;
    const speed = Math.max(0.25, opts.speed || 1);
    const sleepFn = opts.sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.phase = "play";
    this.frozen = true; // 停 AI，只播帧
    this.scriptLock = true;
    let prevT = frames[0].t;
    for (const fr of frames) {
      const dt = Math.max(0, fr.t - prevT);
      prevT = fr.t;
      if (fr.ball) {
        this.ball.x = fr.ball.x;
        this.ball.y = fr.ball.y;
        this.ball.tx = fr.ball.x;
        this.ball.ty = fr.ball.y;
      }
      if (fr.poss) this.possession = fr.poss;
      const byId = new Map((fr.players || []).map((p) => [p.id, p]));
      for (const pl of this.players) {
        const s = byId.get(pl.id);
        if (!s) continue;
        pl.x = s.x;
        pl.y = s.y;
        pl.tx = s.x;
        pl.ty = s.y;
        pl.fsm = s.f || pl.fsm;
        this._applyPlayer(pl);
      }
      this._applyBall();
      this._updatePossessionChrome();
      this._drawCanvas();
      await sleepFn(Math.max(16, (dt || 50) / speed));
    }
    this.frozen = false;
    this.scriptLock = false;
  }

  /** 导出录制为下载 JSON */
  downloadRecording(filename = "vcfm-match-rec.json") {
    const data = this.getRecording();
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
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
    if (!this.heatEnabled || !this.heatCells.length) return;
    for (const cell of this.heatCells) {
      if (x >= cell.x && x < cell.x + cell.w && y >= cell.y && y < cell.y + cell.h) {
        if (team === "home") cell.home += amount;
        else cell.away += amount;
        break;
      }
    }
  }

  _refreshHeatVisual() {
    if (!this.heatEnabled) return;
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

  /** 指定持球人：球贴身，后续盘带 */
  _setCarrier(pl, { stick = true } = {}) {
    if (!pl || pl.el.classList.contains("sent-off")) return;
    this.carrier = pl;
    this.lastCarrierId = pl.id;
    this.possession = pl.team;
    this.ballState = "held";
    this.flight = null;
    this._setTouch(pl, 1400);
    if (stick) {
      this.ballFlightUntil = 0;
      this.ball.tx = pl.x;
      this.ball.ty = pl.y;
      this.ball.x = pl.x;
      this.ball.y = pl.y;
    }
    this._updatePossessionChrome();
  }

  _clearCarrier() {
    this.carrier = null;
    if (this.ballState === "held") this.ballState = "free";
  }

  _isBallInFlight() {
    if (this.ballState === "flight" || this.ballState === "shot") return true;
    return performance.now() < this.ballFlightUntil;
  }

  /**
   * 进入传球飞行状态
   * @param {{ x:number, y:number, receiverId?:string|null, kind?:string, ms?:number }} opts
   */
  _beginFlight(opts = {}) {
    const ms = opts.ms ?? 520;
    const kind = opts.kind || "pass";
    this.ballState = kind === "shot" || kind === "goal" || kind === "wood" || kind === "save" ? "shot" : "flight";
    this.flight = {
      x: opts.x,
      y: opts.y,
      receiverId: opts.receiverId || null,
      kind,
      until: performance.now() + ms,
    };
    this.ball.tx = opts.x;
    this.ball.ty = opts.y;
    this.ballFlightUntil = this.flight.until;
  }

  _endFlight() {
    this.flight = null;
    this.ballFlightUntil = 0;
    if (this.ballState === "flight" || this.ballState === "shot") {
      this.ballState = this.carrier ? "held" : "free";
    }
  }

  _updateTouchClasses(ts) {
    // sim 驱动时只认 carrier，不用 touchUntil 拖影（否则会出现「人亮球远」）
    if (this.simDrive || this._simPlay) {
      for (const pl of this.players) {
        pl.el.classList.toggle("has-ball", pl === this.carrier);
      }
      return;
    }
    for (const pl of this.players) {
      // 旧编舞模式：持球人 + 刚触球短高亮
      const on = pl === this.carrier || (pl.touchUntil > ts && !this.carrier);
      pl.el.classList.toggle("has-ball", on);
    }
  }

  /**
   * 显示层禁区/近距离叠人轻推开（不改 sim 真相，只避免圆点糊成一团）
   * @param {number} [iters]
   */
  _visualUnstack(iters = 1) {
    if (!this.players?.length) return;
    const list = this.players.filter((p) => !p.el.classList.contains("sent-off"));
    const minD = 3.1;
    for (let n = 0; n < iters; n++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d >= minD) continue;
          // 禁区更狠一点
          const inBox =
            (a.y < 22 || a.y > 78) && (b.y < 22 || b.y > 78);
          const push = ((minD - d) / 2) * (inBox ? 1.15 : 0.85);
          const ux = dx / d;
          const uy = dy / d;
          // 门将少动
          const aGk = a.pos === "GK" || a.role === "GK";
          const bGk = b.pos === "GK" || b.role === "GK";
          const aw = aGk ? 0.15 : 1;
          const bw = bGk ? 0.15 : 1;
          const den = aw + bw || 1;
          a.x = clamp(a.x - ux * push * (bw / den), 2, 98);
          a.y = clamp(a.y - uy * push * (bw / den), 2, 98);
          b.x = clamp(b.x + ux * push * (aw / den), 2, 98);
          b.y = clamp(b.y + uy * push * (aw / den), 2, 98);
        }
      }
    }
    for (const pl of list) this._applyPlayer(pl);
  }

  /** 进攻方向：主队朝上(y减小)，客队朝下 */
  _attackDir(team) {
    return team === "home" ? -1 : 1;
  }

  /**
   * 对方「倒数第二名」防守线 Y（FIFA：全队含门将，取最靠近本方球门的第二人）
   * —— 不是「以门将为唯一基准」；门将通常是最后一人，线在他身前的第二人。
   * 主队进攻朝 y→0：对方 y 升序第 2
   * 客队进攻朝 y→100：对方 y 降序第 2
   */
  _offsideLineY(attackingTeam) {
    const defTeam = attackingTeam === "home" ? "away" : "home";
    const defs = this.players.filter(
      (p) => p.team === defTeam && !p.el.classList.contains("sent-off")
    );
    if (defs.length < 2) return 50;
    if (attackingTeam === "home") {
      const ys = defs.map((p) => p.y).sort((a, b) => a - b);
      // ys[0] 常是门将，ys[1] 才是越位线（第二近球门）
      return ys[1];
    }
    const ys = defs.map((p) => p.y).sort((a, b) => b - a);
    return ys[1];
  }

  /** 球是否在进攻方半场（相对进攻方向） */
  _ballInAttackHalf(attackingTeam) {
    const by = this.ball?.y ?? 50;
    return attackingTeam === "home" ? by < 50 : by > 50;
  }

  /**
   * 把目标 Y 限制在越位线合法侧（不能比球和倒数第二人更靠近对方球门）
   * 允许与球齐平略前 0.5
   */
  _clampTargetOffside(pl, tx, ty) {
    if (!pl || pl.pos === "GK") return { x: tx, y: ty };
    const att = pl.team;
    const line = this._offsideLineY(att);
    const ballY = this.ball?.y ?? 50;
    // 越位参考：不能比球和防守线都更靠前
    if (att === "home") {
      // 更小的 y = 更靠前
      const limit = Math.min(line, ballY) + 0.8;
      // 只有当限制线在中线之前时才硬卡（后场随意）
      if (ty < limit && (line < 52 || ballY < 52)) {
        ty = Math.max(ty, limit);
      }
      // 无球时绝不允许前场球员沉在对方大禁区「蹲坑」
      if (pl !== this.carrier && pl.team !== this.possession) {
        // handled by defensive drop
      } else if (pl !== this.carrier && this.possession === att) {
        // 有球进攻：禁止明显越位站位（ty 小于 limit）
        if (ty < limit - 0.5) ty = limit;
      }
    } else {
      const limit = Math.max(line, ballY) - 0.8;
      if (ty > limit && (line > 48 || ballY > 48)) {
        ty = Math.min(ty, limit);
      }
      if (pl !== this.carrier && this.possession === att) {
        if (ty > limit + 0.5) ty = limit;
      }
    }
    return { x: tx, y: clamp(ty, 5, 95) };
  }

  /** 归一化位置：模型可能是 ST/LW 等，统一到 GK|DEF|MID|ATT */
  _normPos(pl) {
    const p = String(pl?.pos || "").toUpperCase();
    if (p === "GK" || p === "G") return "GK";
    if (["DEF", "CB", "FB", "LB", "RB", "LWB", "RWB", "WB", "SW"].includes(p)) return "DEF";
    if (["MID", "CM", "DM", "AM", "LM", "RM", "CDM", "CAM", "WM", "LMID", "RMID"].includes(p)) return "MID";
    if (["ATT", "ST", "CF", "FW", "LW", "RW", "SS", "LF", "RF"].includes(p)) return "ATT";
    // 阵型槽位已是 DEF/MID/ATT
    if (p === "DEF" || p === "MID" || p === "ATT") return p;
    return "MID";
  }

  /**
   * 三线站位 Y（FM 块状）：按有球/无球 + 球深度，给 DEF/MID/ATT 一条线
   * 主队攻 y→0、守 y→100；客队相反
   */
  _roleLineY(team, pos, ballY, hasBall) {
    const role = ["GK", "DEF", "MID", "ATT"].includes(pos) ? pos : this._normPos({ pos });
    if (role === "GK") {
      return team === "home"
        ? clamp(Math.max(90, ballY + (hasBall ? 4 : 2)), 88, 96)
        : clamp(Math.min(10, ballY - (hasBall ? 4 : 2)), 4, 12);
    }
    if (team === "home") {
      if (hasBall) {
        if (role === "DEF") return clamp(Math.min(ballY + 28, 74), 52, 78);
        if (role === "MID") return clamp(ballY + 10, 30, 62);
        return clamp(ballY - 4, 12, 42);
      }
      // 无球：球在对方半场 → 中高位；球在己半场 → 整线跟着退
      // 前锋永远过中线附近，禁止蹲对方禁区
      if (ballY < 48) {
        if (role === "DEF") return clamp(58 + (48 - ballY) * 0.15, 56, 66);
        if (role === "MID") return 50;
        return 48; // ATT 中线
      }
      if (role === "DEF") return clamp(ballY - 6, 60, 90);
      if (role === "MID") return clamp(ballY - 18, 52, 78);
      return clamp(Math.max(50, ballY - 28), 48, 66);
    }
    // away 无球：绝不能停在 y 很大的对方（主队）半场/禁区
    if (hasBall) {
      if (role === "DEF") return clamp(Math.max(ballY - 28, 26), 22, 48);
      if (role === "MID") return clamp(ballY - 10, 38, 70);
      return clamp(ballY + 4, 58, 88);
    }
    if (ballY > 52) {
      // 球在主队半场：客队前锋站中线，后卫略前压
      if (role === "DEF") return clamp(42 - (ballY - 52) * 0.15, 34, 44);
      if (role === "MID") return 50;
      return 52; // ATT 中线
    }
    // 球在客队半场（被压）：整线回撤
    if (role === "DEF") return clamp(ballY + 6, 10, 40);
    if (role === "MID") return clamp(ballY + 18, 22, 48);
    return clamp(Math.min(50, ballY + 28), 34, 52);
  }

  /**
   * 每帧强制：无球方不得蹲在对方半场/禁区（修「粉攻上半场、紫前锋还在粉禁区」）
   * 以 carrier 为准同步 possession，避免控球标记滞后
   */
  _enforceOutOfPossessionShape() {
    if (this.carrier && this.carrier.team) {
      this.possession = this.carrier.team;
    }
    const att = this.possession === "away" ? "away" : "home";
    const def = att === "home" ? "away" : "home";
    const ballY = this.ball?.y ?? 50;
    const ballX = this.ball?.x ?? 50;

    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      if (pl === this.carrier) continue;
      const role = this._normPos(pl);
      if (role === "GK") continue;
      if (pl.team !== def) continue;

      const lineY = this._roleLineY(pl.team, role, ballY, false);
      // 无球硬上限/下限：比角色线更严一点，前锋尤其不许越中线太深
      let maxY = 100;
      let minY = 0;
      if (def === "away") {
        // 客队无球：y 不能太大（不能沉到主队球门前）
        maxY = role === "ATT" ? 52 : role === "MID" ? 56 : 46;
        // 球在客队半场时后卫可更深（小数）
        if (role === "DEF" && ballY < 40) maxY = 42;
        if (pl.y > maxY || pl.ty > maxY) {
          pl.ty = Math.min(pl.ty, maxY, lineY + 2);
          // 错位大：直接改坐标，不靠慢慢走
          if (pl.y > maxY + 2) {
            pl.y = lerp(pl.y, Math.min(maxY, lineY), 0.85);
            pl.x = lerp(pl.x, clamp(pl.baseX * 0.55 + ballX * 0.45, 8, 92), 0.4);
            pl.tx = pl.x;
          }
        }
        // 极端：还在对方大禁区/球门区
        if (pl.y > 64) {
          pl.y = lineY;
          pl.ty = lineY;
          pl.x = clamp(pl.baseX * 0.6 + 50 * 0.4, 10, 90);
          pl.tx = pl.x;
          pl.fsm = "cover";
        }
      } else {
        // 主队无球：y 不能太小
        minY = role === "ATT" ? 48 : role === "MID" ? 44 : 54;
        if (role === "DEF" && ballY > 60) minY = 58;
        if (pl.y < minY || pl.ty < minY) {
          pl.ty = Math.max(pl.ty, minY, lineY - 2);
          if (pl.y < minY - 2) {
            pl.y = lerp(pl.y, Math.max(minY, lineY), 0.85);
            pl.x = lerp(pl.x, clamp(pl.baseX * 0.55 + ballX * 0.45, 8, 92), 0.4);
            pl.tx = pl.x;
          }
        }
        if (pl.y < 36) {
          pl.y = lineY;
          pl.ty = lineY;
          pl.x = clamp(pl.baseX * 0.6 + 50 * 0.4, 10, 90);
          pl.tx = pl.x;
          pl.fsm = "cover";
        }
      }
    }
  }

  /**
   * 无球方强制回防 + 有球方保持三线（写 tx/ty）
   * 严重错位时直接改 y，避免「慢慢走回」在截图里永远不对
   */
  _applyDefensiveDrop(defTeam) {
    const ballY = this.ball?.y ?? 50;
    const ballX = this.ball?.x ?? 50;
    const attTeam = defTeam === "home" ? "away" : "home";

    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      if (pl === this.carrier) continue;
      if (pl.pos === "GK") {
        // 门将只在己方小禁区活动
        if (pl.team === "home") {
          pl.tx = clamp(lerp(pl.baseX, ballX, 0.12), 32, 68);
          pl.ty = clamp(Math.max(pl.baseY, ballY > 70 ? ballY - 4 : 92), 88, 96);
        } else {
          pl.tx = clamp(lerp(pl.baseX, ballX, 0.12), 32, 68);
          pl.ty = clamp(Math.min(pl.baseY, ballY < 30 ? ballY + 4 : 8), 4, 12);
        }
        continue;
      }

      const role = this._normPos(pl);
      const hasBall = pl.team !== defTeam;
      // 无球前锋：绝不走 press 特例留在对方半场
      const nearBallRole =
        pl.team === defTeam && role === "ATT"
          ? false
          : pl.fsm === "press" || pl.fsm === "support" || pl.fsm === "carry";
      const lineY = this._roleLineY(pl.team, role, ballY, hasBall);
      const xPull = role === "DEF" ? 0.32 : role === "MID" ? 0.18 : 0.1;
      const wantX = clamp(pl.baseX * (1 - xPull) + ballX * xPull + (Math.random() - 0.5) * 1.2, 6, 94);

      if (!nearBallRole) {
        pl.tx = wantX;
        pl.ty = lineY + (Math.random() - 0.5) * 1.5;
      } else if (pl.team === defTeam) {
        if (defTeam === "home" && role === "DEF" && pl.ty < 52) pl.ty = 52;
        if (defTeam === "away" && role === "DEF" && pl.ty > 48) pl.ty = 48;
      }

      // —— 有球方：后卫别全压进对方禁区 ——
      if (pl.team === attTeam && role === "DEF") {
        if (attTeam === "home" && pl.ty < 40) pl.ty = 40;
        if (attTeam === "away" && pl.ty > 60) pl.ty = 60;
      }
    }

    this._hardCorrectShape(defTeam);
    this._enforceOutOfPossessionShape();
  }

  /**
   * 错位过大时硬拉坐标（表现层，不改比分）
   * 解决：回防目标设了但人还在对面半场「慢慢走」的截图问题
   */
  _hardCorrectShape(defTeam) {
    const ballY = this.ball?.y ?? 50;
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      if (pl === this.carrier) continue;
      const role = this._normPos(pl);
      if (role === "GK") continue;

      const dy = pl.ty - pl.y;
      const ady = Math.abs(dy);
      const adx = Math.abs(pl.tx - pl.x);

      if (pl.team === defTeam) {
        // 无球：错位猛纠；前锋在对方半场直接拉回中线
        if (defTeam === "away" && pl.y > 55) {
          const ly = this._roleLineY("away", role, ballY, false);
          pl.y = role === "ATT" ? ly : lerp(pl.y, ly, 0.75);
          pl.ty = ly;
        } else if (defTeam === "home" && pl.y < 45) {
          const ly = this._roleLineY("home", role, ballY, false);
          pl.y = role === "ATT" ? ly : lerp(pl.y, ly, 0.75);
          pl.ty = ly;
        } else if (ady > 14) {
          pl.y = lerp(pl.y, pl.ty, 0.5);
          pl.x = lerp(pl.x, pl.tx, 0.3);
        }
      } else {
        if (role === "DEF" && ady > 22) pl.y = lerp(pl.y, pl.ty, 0.3);
        if (role === "ATT" && ady > 24) pl.y = lerp(pl.y, pl.ty, 0.25);
        if (adx > 30) pl.x = lerp(pl.x, pl.tx, 0.2);
      }
    }
  }

  /** 进攻方：把 tx/ty 钳在越位线后 */
  _applyOffsideClamp(attTeam) {
    for (const pl of this.players) {
      if (pl.team !== attTeam || pl.el.classList.contains("sent-off")) continue;
      if (pl.pos === "GK") continue;
      // 持球人带球可以压线，但接应点不能越位
      if (pl === this.carrier) {
        const c = this._clampTargetOffside(pl, pl.tx, pl.ty);
        // 持球允许略过线 1.5（带球不算接球越位）
        if (attTeam === "home") pl.ty = Math.max(c.y - 1.5, Math.min(pl.ty, 95));
        else pl.ty = Math.min(c.y + 1.5, Math.max(pl.ty, 5));
        continue;
      }
      const c = this._clampTargetOffside(pl, pl.tx, pl.ty);
      pl.tx = c.x;
      pl.ty = c.y;
    }
  }

  /**
   * 持球盘带：朝对方球门带球；dribbling/pace 影响步幅与横带
   * 攻势段落内进攻方前压更狠
   */
  _dribbleCarrier() {
    const pl = this.carrier;
    if (!pl || this._isBallInFlight()) return;
    if (pl.el.classList.contains("sent-off")) {
      this._clearCarrier();
      return;
    }
    const dir = this._attackDir(pl.team);
    const drib = this._attr(pl, "dribbling", 10);
    const pace = this._attr(pl, "pace", 10);
    const phase = this._attackPhaseActive();
    const onAttack = phase && phase.side === pl.team;
    // 高盘带：更敢前压；低盘带：多横带保球
    const lateralSpan = pl.pos === "ATT" ? 5 : 9;
    const lateral = (Math.random() - 0.5) * (lateralSpan * (1.15 - drib / 40));
    let push = pl.pos === "ATT" ? 13 : pl.pos === "MID" ? 11 : pl.pos === "DEF" ? 6.5 : 1.2;
    push *= 0.75 + (pace / 20) * 0.45 + (drib / 20) * 0.2;
    if (onAttack) push *= 1.15 + phase.intensity * 0.25;
    const goalY = pl.team === "home" ? 8 : 92;
    if (Math.abs(pl.y - goalY) < 16) push *= 0.4;

    pl.tx = clamp(pl.x + lateral, 8, 92);
    pl.ty = clamp(pl.y + dir * push * (0.7 + Math.random() * 0.5), 6, 94);
  }

  /** 是否在对方禁区（含大禁区） */
  _inOppBox(pl, deep = false) {
    if (!pl) return false;
    // 主队攻上（y 小），客队攻下（y 大）
    if (pl.team === "home") {
      return deep ? pl.y <= 18 && pl.x >= 28 && pl.x <= 72 : pl.y <= 32 && pl.x >= 18 && pl.x <= 82;
    }
    return deep ? pl.y >= 82 && pl.x >= 28 && pl.x <= 72 : pl.y >= 68 && pl.x >= 18 && pl.x <= 82;
  }

  /** 球门中心与门将位置 */
  _goalTarget(team) {
    const attHome = team === "home";
    const gx = 50 + (Math.random() - 0.5) * 10;
    const gy = attHome ? 4 + Math.random() * 3 : 96 - Math.random() * 3;
    return { gx, gy, attHome };
  }

  /**
   * 空门 / 禁区射门机会评估 0..1
   * 越高越该射而不是再传
   */
  _shotOpportunity(car) {
    if (!car) return 0;
    const { gx, gy } = this._goalTarget(car.team);
    const dist = Math.hypot(car.x - gx, car.y - gy);
    const inBox = this._inOppBox(car, false);
    const inSix = this._inOppBox(car, true);
    // 门将
    const gk = this.players.find(
      (p) =>
        p.team !== car.team &&
        p.pos === "GK" &&
        !p.el.classList.contains("sent-off")
    );
    const gkDist = gk ? Math.hypot(gk.x - gx, gk.y - gy) : 99;
    const gkOut = gk ? Math.hypot(gk.x - car.x, gk.y - car.y) : 99;
    // 球门前防守人数
    const blockers = this.players.filter((p) => {
      if (p.team === car.team || p.pos === "GK" || p.el.classList.contains("sent-off"))
        return false;
      // 在射门路线附近
      const onPath =
        Math.abs(p.x - car.x) < 14 &&
        (car.team === "home" ? p.y < car.y && p.y > gy - 2 : p.y > car.y && p.y < gy + 2);
      return onPath || Math.hypot(p.x - gx, p.y - gy) < 12;
    }).length;

    let score = 0;
    if (inSix) score += 0.55;
    else if (inBox) score += 0.38;
    else if (dist < 28) score += 0.18;
    else if (dist < 38) score += 0.08;
    else return 0;

    // 距离门越近越好
    score += clamp((36 - dist) / 50, 0, 0.25);
    // 空门：门将远离球门或远离持球人
    if (gkDist > 14 || gkOut > 22) score += 0.35;
    else if (gkDist > 9) score += 0.12;
    // 无人封堵
    if (blockers === 0) score += 0.28;
    else if (blockers === 1) score += 0.08;
    else score -= 0.12 * (blockers - 1);

    const fin = this._attr(car, "finishing", this._attr(car, "shooting", 10));
    score += (fin - 10) / 80;
    if (car.pos === "ATT") score += 0.08;
    if (car.pos === "DEF") score -= 0.12;

    return clamp(score, 0, 1);
  }

  /**
   * 表现层射门（不改比分；真进球仍由 match.js 事件驱动）
   * 禁区空门应优先调用
   */
  _attemptPresentationShot(car, { force = false } = {}) {
    if (!car || this._isBallInFlight()) return false;
    const opp = this._shotOpportunity(car);
    if (!force && opp < 0.28) return false;

    const { gx, gy, attHome } = this._goalTarget(car.team);
    const fin = this._attr(car, "finishing", this._attr(car, "shooting", 10));
    // 瞄准：空门更贴中，差射偏一点
    const scatter = Math.max(0.8, 5.5 - fin / 5 - opp * 3);
    const tx = clamp(gx + (Math.random() - 0.5) * scatter, 38, 62);
    const ty = clamp(gy + (Math.random() - 0.5) * (scatter * 0.35), attHome ? 2 : 90, attHome ? 10 : 98);

    this.camMode = "box";
    this.camBoostUntil = performance.now() + 1100;
    this._setFocus([car], 1200);
    this._shootBall(tx, ty, "shot");
    this.playSfx?.("kick");
    const en = document.documentElement.lang === "en";
    const open = opp >= 0.62;
    this.setCaption(
      open
        ? en
          ? `SHOT! ${car.name || ""} open goal`
          : `射门！${car.name || ""} 空门机会`
        : en
          ? `Shot! ${car.name || ""}`
          : `射门！${car.name || ""}`,
      open ? "chance" : "info",
      1400
    );
    // 表现层「扑救/偏出」：球到门前后由门将清走或出底
    const ms = 420;
    setTimeout(() => {
      if (!this._built || this.phase !== "play") return;
      if (this.ballState === "shot" || this.ballState === "flight") return;
      const gk = this.players.find(
        (p) =>
          p.team !== car.team &&
          p.pos === "GK" &&
          !p.el.classList.contains("sent-off")
      );
      // 空门：球贴门线；否则门将拿球或解围
      if (opp >= 0.7 && Math.random() < 0.55) {
        this.ball.x = tx;
        this.ball.y = ty;
        this.ballState = "free";
        this.carrier = null;
        this.setCaption(en ? "Off the line…" : "门线附近…", "chance", 900);
      } else if (gk) {
        this._setCarrier(gk, { stick: true });
        this.playSfx?.("save");
        this.setCaption(en ? "Saved / cleared" : "扑出 / 解围", "save", 1000);
        // 门将大脚
        setTimeout(() => {
          if (this.carrier !== gk) return;
          const clearY = car.team === "home" ? 55 : 45;
          this._beginFlight({
            x: 30 + Math.random() * 40,
            y: clearY,
            kind: "pass",
            ms: 480,
          });
          this.carrier = null;
        }, 380);
      } else {
        this.ballState = "free";
      }
      this.actionTimer = 0.35;
    }, ms + 80);
    this.actionTimer = 0.9;
    return true;
  }

  /**
   * 接应插上：同队无球人朝持球前方/肋部跑位
   */
  _supportRuns() {
    const car = this.carrier;
    if (!car || this.phase === "pause" || this.phase === "goal" || this.frozen || this.scriptLock)
      return;
    const phase = this._attackPhaseActive();
    const dir = this._attackDir(car.team);
    const mates = this.players.filter(
      (p) =>
        p.team === car.team &&
        p !== car &&
        p.pos !== "GK" &&
        !p.el.classList.contains("sent-off")
    );
    mates.sort(
      (a, b) =>
        Math.hypot(a.x - car.x, a.y - car.y) - Math.hypot(b.x - car.x, b.y - car.y)
    );
    const supportN = Math.min(mates.length, phase && phase.side === car.team ? 5 : 4);
    const pushMul = phase && phase.side === car.team ? 1.15 + phase.intensity * 0.2 : 1;
    for (let i = 0; i < mates.length; i++) {
      const pl = mates[i];
      if (i < supportN) {
        const mode = Math.random();
        if (mode < 0.55) {
          // 前插到持球人前侧
          pl.tx = clamp(car.x + (Math.random() - 0.5) * 22, 8, 92);
          pl.ty = clamp(car.y + dir * (12 + Math.random() * 16) * pushMul, 6, 94);
        } else if (mode < 0.82) {
          // 肋部拉开
          const side = car.x < 50 ? 1 : -1;
          pl.tx = clamp(car.x + side * (12 + Math.random() * 18), 6, 94);
          pl.ty = clamp(car.y + dir * (4 + Math.random() * 12) * pushMul, 6, 94);
        } else {
          // 回撤要球
          pl.tx = clamp(car.x + (Math.random() - 0.5) * 12, 8, 92);
          pl.ty = clamp(car.y - dir * (6 + Math.random() * 8), 6, 94);
        }
      } else if (Math.random() < 0.35) {
        pl.tx = clamp(pl.baseX + (Math.random() - 0.5) * 6 + dir * 2, 6, 94);
        pl.ty = clamp(pl.baseY + dir * 3 + (Math.random() - 0.5) * 4, 6, 94);
      }
    }
  }

  /**
   * 防守压迫：无球方逼抢持球人；tackling 高者更贴身
   */
  _pressCarrier() {
    const car = this.carrier;
    if (!car || this.phase === "pause" || this.phase === "goal" || this.frozen || this.scriptLock)
      return;
    const defs = this.players.filter(
      (p) =>
        p.team !== car.team &&
        p.pos !== "GK" &&
        !p.el.classList.contains("sent-off")
    );
    // 距离 + 抢断加权：好后卫更愿意上抢
    defs.sort((a, b) => {
      const da =
        Math.hypot(a.x - car.x, a.y - car.y) - this._attr(a, "tackling", 10) * 0.35;
      const db =
        Math.hypot(b.x - car.x, b.y - car.y) - this._attr(b, "tackling", 10) * 0.35;
      return da - db;
    });
    // 最近 2 人紧逼（幅度收敛）
    for (let i = 0; i < Math.min(2, defs.length); i++) {
      const pl = defs[i];
      const tight = 0.5 + this._attr(pl, "tackling", 10) / 40;
      pl.tx = clamp(car.x + (Math.random() - 0.5) * (3.2 / tight), 6, 94);
      pl.ty = clamp(car.y + (Math.random() - 0.5) * (2.6 / tight), 6, 94);
    }
    // 协防线：按球深度落位，不贴进攻 base
    for (let i = 2; i < Math.min(6, defs.length); i++) {
      const pl = defs[i];
      const defSide = pl.team;
      const lineY =
        defSide === "home"
          ? clamp(car.y - (pl.pos === "DEF" ? 10 : 18), 54, 90)
          : clamp(car.y + (pl.pos === "DEF" ? 10 : 18), 10, 46);
      pl.tx = clamp(pl.baseX * 0.35 + car.x * 0.45 + 50 * 0.2 + (Math.random() - 0.5) * 2.5, 8, 92);
      pl.ty = clamp(lineY + (Math.random() - 0.5) * 2, 6, 94);
    }
  }

  /**
   * 坐标平滑插值（表现层）：指数逼近目标，避免离散跳帧
   * speed ≈ 每秒可走完的球场百分比
   */
  _moveToward(pl, speed, dt) {
    if (pl.vx === undefined) { pl.vx = 0; pl.vy = 0; }
    // 瞬移检测：若上帧末记录的位置与本帧起点对不上，说明被硬纠偏函数
    // （_hardCorrectShape / _enforceOutOfPossessionShape 等）直接改了坐标，
    // 此时旧速度已过期，清零避免朝错误方向"滑行"。
    if (pl._lastX !== undefined) {
      const jump = Math.hypot(pl.x - pl._lastX, pl.y - pl._lastY);
      const expected = Math.hypot(pl.vx, pl.vy) * dt + 0.5;
      if (jump > expected * 2 + 1.5) { pl.vx = 0; pl.vy = 0; }
    }

    const dx = pl.tx - pl.x;
    const dy = pl.ty - pl.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.06) {
      // 到位：让速度快速衰减而不是硬停，避免"急刹"抖动
      pl.vx *= 0.55; pl.vy *= 0.55;
      pl.x += pl.vx * dt; pl.y += pl.vy * dt;
      pl._lastX = pl.x; pl._lastY = pl.y;
      return;
    }

    // arrive 行为：接近目标（<slowR）时降低期望速度，形成自然减速
    const slowR = 5.5;
    const desiredSpeed = speed * Math.min(1, dist / slowR);
    const dvx = (dx / dist) * desiredSpeed;
    const dvy = (dy / dist) * desiredSpeed;

    // 加速度上限：不能瞬间达到期望速度 —— 这就是"惯性/体重感"
    // 系数越大越灵活，越小越"重"；持球/冲刺自然更跟手。
    const accel = speed * 4.8;
    const maxDv = accel * dt;
    let ax = dvx - pl.vx;
    let ay = dvy - pl.vy;
    const amag = Math.hypot(ax, ay);
    if (amag > maxDv) { ax = ax / amag * maxDv; ay = ay / amag * maxDv; }

    pl.vx += ax; pl.vy += ay;
    // 速度上限兜底（防止 dt 抖动累积过冲）
    const vmag = Math.hypot(pl.vx, pl.vy);
    const vmax = speed * 1.25;
    if (vmag > vmax) { pl.vx = pl.vx / vmag * vmax; pl.vy = pl.vy / vmag * vmax; }

    pl.x += pl.vx * dt;
    pl.y += pl.vy * dt;
    pl._lastX = pl.x; pl._lastY = pl.y;

    // 朝向：按速度方向平滑旋转（供渲染画朝向用）
    if (vmag > 0.8) {
      const target = Math.atan2(pl.vy, pl.vx);
      if (pl.heading === undefined) pl.heading = target;
      let diff = target - pl.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      pl.heading += diff * Math.min(1, dt * 12);
    }
  }

  /**
   * 分离力：距离过近的球员互相推开一点，避免叠罗汉。
   * 只有 22 人，O(n²) 无所谓。持球人与门将不参与被推（保持画面焦点稳定）。
   * 替代原来靠 (Math.random()) 抖动防重叠的做法，更稳更干净。
   */
  _applySeparation(dt) {
    const R = 3.8;        // 期望最小间距（场地百分比坐标）
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.el.classList.contains("sent-off")) continue;
      if (a === this.carrier || a.pos === "GK") continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.el.classList.contains("sent-off")) continue;
        if (b === this.carrier || b.pos === "GK") continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01 && d < R) {
          const push = ((R - d) / R) * 7 * dt;
          const ux = dx / d, uy = dy / d;
          a.x += ux * push; a.y += uy * push;
          b.x -= ux * push; b.y -= uy * push;
        }
      }
    }
  }

  _ballDistTo(pl) {
    return Math.hypot((this.ball?.x ?? 50) - pl.x, (this.ball?.y ?? 50) - pl.y);
  }

  _ballInZone(pl, mul = 1) {
    const r = (pl.zoneR || 22) * mul;
    return Math.hypot((this.ball?.x ?? 50) - pl.baseX, (this.ball?.y ?? 50) - pl.baseY) <= r;
  }

  /**
   * 球员有限状态机目标分配（表现层 AI，不改比分）
   * 核心：先铺三线块状站位，再只挑少量人 press/support，禁止全员扎堆禁区
   */
  _assignFsmTargets() {
    if (this.phase !== "play" || this.frozen || this.scriptLock) return;
    const car = this.carrier;
    // 持球人优先：防止 possession 滞后导致无球前锋仍按「进攻站位」
    if (car?.team) this.possession = car.team;
    const bx = this.ball?.x ?? 50;
    const by = this.ball?.y ?? 50;
    const att = this.possession === "away" ? "away" : "home";
    const def = att === "home" ? "away" : "home";
    const dir = this._attackDir(att);

    // 1) 全员先回角色线（块状阵型），再覆盖少数特例
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      pl.fsm = pl === car ? "carry" : "home";
      if (pl === car) continue;
      const role = this._normPos(pl);
      const hasBall = pl.team === att;
      const lineY = this._roleLineY(pl.team, role, by, hasBall);
      const xPull = role === "DEF" ? 0.28 : role === "MID" ? 0.16 : 0.1;
      pl.tx = clamp(pl.baseX * (1 - xPull) + bx * xPull, 6, 94);
      pl.ty = clamp(lineY + (Math.random() - 0.5) * 1.2, 5, 95);
    }
    if (car) car.fsm = "carry";

    const danger = def === "home" ? by > 62 : by < 38;
    const pressMax = danger ? 3 : 2;

    // 2) 无球：最多 2–3 人逼抢，其余 cover 在角色线上（前锋几乎不参与后场逼抢）
    const defenders = this.players
      .filter((p) => p.team === def && this._normPos(p) !== "GK" && !p.el.classList.contains("sent-off"))
      .map((p) => ({ p, d: this._ballDistTo(p), role: this._normPos(p) }))
      .sort((a, b) => a.d - b.d);

    let pressN = 0;
    for (const { p, d, role } of defenders) {
      if (pressN >= pressMax) break;
      if (role === "ATT" && !danger) continue; // 前锋无球时留守中线，不跟着去对方半场蹲
      if (d < (danger ? 32 : 22) || (pressN < 2 && d < 36 && role !== "ATT")) {
        p.fsm = "press";
        const tight = 0.55 + this._attr(p, "tackling", 10) / 45;
        p.tx = clamp(bx + (Math.random() - 0.5) * (2.6 / tight), 6, 94);
        let py = clamp(by + (Math.random() - 0.5) * (2.2 / tight), 6, 94);
        if (def === "home") py = Math.max(py, role === "DEF" ? 52 : 44);
        else py = Math.min(py, role === "DEF" ? 48 : 56);
        p.ty = py;
        pressN++;
      }
    }
    for (const { p, role } of defenders) {
      if (p.fsm === "press") continue;
      p.fsm = "cover";
      const lineY = this._roleLineY(def, role, by, false);
      p.tx = clamp(p.baseX * 0.45 + bx * 0.4 + 50 * 0.15, 8, 92);
      p.ty = clamp(lineY + (Math.random() - 0.5) * 1.5, 6, 94);
    }

    // 3) 有球：最多 2 人近球接应（禁止「所有中前场都冲禁区」）
    if (car) {
      const mates = this.players
        .filter(
          (p) =>
            p.team === att &&
            p !== car &&
            p.pos !== "GK" &&
            !p.el.classList.contains("sent-off")
        )
        .map((p) => ({ p, d: this._ballDistTo(p) }))
        .sort((a, b) => a.d - b.d);

      // 后腰拖后：选最靠己方半场的中场
      const mids = mates.filter((m) => m.p.pos === "MID").sort((a, b) => {
        return att === "home" ? b.p.baseY - a.p.baseY : a.p.baseY - b.p.baseY;
      });
      if (mids[0]) {
        const dm = mids[0].p;
        dm.fsm = "cover";
        dm.subRole = "dm_hold";
        dm.tx = clamp(lerp(dm.baseX, 50, 0.3), 22, 78);
        dm.ty = this._roleLineY(att, "MID", by, true) + (att === "home" ? 4 : -4);
      }

      // 边后卫偶尔套边（最多 1）
      const fb = mates.find((m) => m.p.pos === "DEF" && (m.p.baseX < 26 || m.p.baseX > 74));
      if (fb && Math.random() < 0.4) {
        fb.p.fsm = "support";
        fb.p.subRole = "overlap";
        fb.p.tx = clamp(fb.p.baseX + (fb.p.baseX < 50 ? -5 : 5), 6, 94);
        fb.p.ty = clamp(this._roleLineY(att, "DEF", by, true) + dir * 6, 12, 88);
      }

      // 近球接应最多 2 人，且必须真正靠近球（不能全员 ATT 自动入选）
      let sup = 0;
      for (const { p, d } of mates) {
        if (sup >= 2) break;
        if (p.fsm === "support" || p.fsm === "cover") continue;
        const role = this._normPos(p);
        if (role === "DEF") continue;
        if (d > 28 && !(role === "ATT" && d < 36)) continue;
        p.fsm = "support";
        p.subRole = role === "ATT" ? "poach" : "link";
        const side = sup === 0 ? -1 : 1;
        let nx = clamp(car.x + side * (12 + sup * 4), 10, 90);
        let ny = clamp(car.y + dir * (5 + (role === "ATT" ? 3 : 0)), 8, 92);
        if (att === "home" && ny < 14) ny = 14;
        if (att === "away" && ny > 86) ny = 86;
        const c = this._clampTargetOffside(p, nx, ny);
        p.tx = c.x;
        p.ty = c.y;
        sup++;
      }
    }

    // 4) 禁区人数软顶：有球方非持球进大禁区 ≤ 3
    this._capAttackersInBox(att, car);

    for (const pl of this.players) {
      if (!pl.el.classList.contains("sent-off")) pl.el.dataset.fsm = pl.fsm;
    }

    this._applyDefensiveDrop(def);
    this._enforceOutOfPossessionShape();
    this._applyOffsideClamp(att);
  }

  /** 有球方非持球进对方大禁区的人数上限，多余的退到角色线 */
  _capAttackersInBox(attTeam, car) {
    const inBox = this.players.filter((p) => {
      if (p.team !== attTeam || p.el.classList.contains("sent-off")) return false;
      if (p === car || p.pos === "GK") return false;
      if (attTeam === "home") return p.ty <= 30 || p.y <= 28;
      return p.ty >= 70 || p.y >= 72;
    });
    if (inBox.length <= 3) return;
    // 离球门最近的优先留下，远的 / 后卫优先清出
    inBox.sort((a, b) => {
      const ga = attTeam === "home" ? a.y : 100 - a.y;
      const gb = attTeam === "home" ? b.y : 100 - b.y;
      const ra = a.pos === "DEF" ? -10 : a.pos === "MID" ? 0 : 5;
      const rb = b.pos === "DEF" ? -10 : b.pos === "MID" ? 0 : 5;
      return ga + ra - (gb + rb);
    });
    const by = this.ball?.y ?? 50;
    for (let i = 3; i < inBox.length; i++) {
      const p = inBox[i];
      p.fsm = "home";
      p.ty = this._roleLineY(attTeam, p.pos, by, true);
      p.tx = clamp(p.baseX * 0.7 + 50 * 0.3, 10, 90);
    }
  }

  /**
   * 传球给接应点：球进入 flight，落地后由 _resolveFlight 接球
   * passing 高 → 更准、略快；vision 高 → 预判更靠前
   * 飞行时长按场地%距离估算，接近 FM 2D 观感（短传 ~0.45–0.7s，中传 ~0.8–1.2s）
   */
  _passTo(fromPl, toPl, { flightMs = 520 } = {}) {
    if (!fromPl || !toPl) return;
    const from = { x: this.ball.x, y: this.ball.y };
    const passing = this._attr(fromPl, "passing", 10);
    const vision = this._attr(fromPl, "vision", 10);
    // 预判接球点：接应人朝目标跑 + vision 加权
    const leadX = toPl.tx ?? toPl.x;
    const leadY = toPl.ty ?? toPl.y;
    const lead = 0.35 + vision / 40;
    const aimX = lerp(toPl.x, leadX, lead);
    const aimY = lerp(toPl.y, leadY, lead);
    const scatter = Math.max(0.4, 2.2 - passing / 12);
    const tx = clamp(aimX + (Math.random() - 0.5) * scatter, 5, 95);
    const ty = clamp(aimY + (Math.random() - 0.5) * scatter, 5, 95);
    // 好传球略快（最多约 8%），不再把短传压到“瞬移”
    const ms = Math.round(flightMs * (1.04 - passing / 120));
    this._beginFlight({ x: tx, y: ty, receiverId: toPl.id, kind: "pass", ms });
    this._addTrail(from.x, from.y, tx, ty, "pass", ms / 1000 + 0.12);
    this._recordPass(fromPl, toPl);
    this.lastCarrierId = fromPl.id;
    this.carrier = null; // 保持 ballState=flight
    this._setTouch(fromPl, 280);
    // 接球人迎球
    toPl.tx = clamp(tx + (Math.random() - 0.5) * 2, 6, 94);
    toPl.ty = clamp(ty + (Math.random() - 0.5) * 2, 6, 94);
  }

  /** 飞行结束：接球 / 落地 free */
  _resolveFlight() {
    if (!this.flight) {
      this._endFlight();
      return;
    }
    const fl = this.flight;
    const kind = fl.kind || "pass";
    // 射门类：停在落点，由事件脚本接管
    if (kind === "shot" || kind === "goal" || kind === "wood" || kind === "save") {
      this.ball.x = fl.x;
      this.ball.y = fl.y;
      this.ball.tx = fl.x;
      this.ball.ty = fl.y;
      this._endFlight();
      this.ballState = "free";
      return;
    }
    // 传球：优先指定接球人，否则最近同队
    let recv =
      (fl.receiverId && this.players.find((p) => p.id === fl.receiverId)) || null;
    if (!recv || recv.el.classList.contains("sent-off")) {
      const side = this.possession;
      const pool = this.players.filter(
        (p) => p.team === side && p.pos !== "GK" && !p.el.classList.contains("sent-off")
      );
      pool.sort(
        (a, b) =>
          Math.hypot(a.x - fl.x, a.y - fl.y) - Math.hypot(b.x - fl.x, b.y - fl.y)
      );
      recv = pool[0] || null;
    }
    this.ball.x = fl.x;
    this.ball.y = fl.y;
    this._endFlight();
    if (recv) {
      // 人稍朝球靠
      recv.x = lerp(recv.x, fl.x, 0.35);
      recv.y = lerp(recv.y, fl.y, 0.35);
      this._setCarrier(recv, { stick: true });
      this.actionTimer = 0.28 + Math.random() * 0.4;
    } else {
      this.ballState = "free";
    }
  }

  /** 选接应点：前方优先；vision 高更爱找前插 */
  _pickPassTarget(fromPl) {
    if (!fromPl) return null;
    const dir = this._attackDir(fromPl.team);
    const vision = this._attr(fromPl, "vision", 10);
    const pool = this.players.filter(
      (p) =>
        p.team === fromPl.team &&
        p !== fromPl &&
        p.pos !== "GK" &&
        !p.el.classList.contains("sent-off")
    );
    if (!pool.length) return null;
    const line = this._offsideLineY(fromPl.team);
    const ballY = this.ball?.y ?? fromPl.y;
    const scored = pool.map((p) => {
      const dx = p.x - fromPl.x;
      const dy = (p.y - fromPl.y) * dir; // 向前为正
      const dist = Math.hypot(dx, p.y - fromPl.y);
      let score = 0;
      // 前插优先（vision 加权）
      if (dy > 2) score += 8 + dy * (0.5 + vision / 40);
      else if (dy > -4) score += 4;
      else score += 1; // 回敲
      if (dist > 6 && dist < 28) score += 6;
      else if (dist < 40) score += 3;
      if (Math.abs(dx) > 8) score += 2;
      if (p.pos === "ATT") score += 2.5;
      if (p.pos === "MID") score += 1.5;
      // 明显越位接应：大幅降权（传了也像犯规站位）
      const offside =
        fromPl.team === "home"
          ? p.y < Math.min(line, ballY) - 1.2
          : p.y > Math.max(line, ballY) + 1.2;
      if (offside) score -= 20;
      score += Math.random() * 3;
      return { p, score, dist, offside };
    });
    scored.sort((a, b) => b.score - a.score);
    // 过滤掉仍越位且分差不大的目标
    const legal = scored.filter((s) => !s.offside);
    if (legal.length) {
      scored.length = 0;
      scored.push(...legal);
    }
    // 压迫大时更多回敲
    const backRate = 0.14 + (20 - vision) / 120;
    if (Math.random() < backRate) {
      const back = scored.filter((s) => (s.p.y - fromPl.y) * dir < 0);
      if (back.length) return back[0].p;
    }
    return scored[0]?.p || null;
  }

  /**
   * 持球决策（tick AI）：盘带 / 传球 / 捡球
   * 属性 + 导演控球偏置 + 攻势段落；表现层断球不改比分
   */
  _decidePossessionAction() {
    if (this.phase === "pause" || this.phase === "goal" || this.frozen || this.scriptLock)
      return;
    if (performance.now() < this.aftermathUntil) return;
    if (this._isBallInFlight()) return;

    const phase = this._attackPhaseActive();

    // 无持球人：抢最近同队球员控球，或找球附近
    if (!this.carrier) {
      // 攻势方优先捡球；否则导演偏置
      let side = this.possession;
      if (phase) side = phase.side;
      else if (Math.random() > 0.55) {
        side = Math.random() < this.directorBias ? "home" : "away";
      }
      const pool = this.players.filter(
        (p) => p.team === side && p.pos !== "GK" && !p.el.classList.contains("sent-off")
      );
      if (!pool.length) return;
      pool.sort(
        (a, b) =>
          Math.hypot(a.x - this.ball.x, a.y - this.ball.y) -
          Math.hypot(b.x - this.ball.x, b.y - this.ball.y)
      );
      const near = pool[0];
      near.tx = this.ball.x;
      near.ty = this.ball.y;
      if (Math.hypot(near.x - this.ball.x, near.y - this.ball.y) < 5) {
        this._setCarrier(near, { stick: true });
      } else {
        // 短传/滚向最近的人 → flight 状态机
        this._beginFlight({
          x: near.x,
          y: near.y,
          receiverId: near.id,
          kind: "pass",
          ms: 180,
        });
      }
      this.actionTimer = 0.32;
      return;
    }

    const car = this.carrier;
    // 压迫人数（tackling 高的更有效）
    const pressers = this.players.filter(
      (p) =>
        p.team !== car.team &&
        p.pos !== "GK" &&
        !p.el.classList.contains("sent-off") &&
        Math.hypot(p.x - car.x, p.y - car.y) < 10
    );
    const pressN = pressers.length;
    const pressPower =
      pressers.reduce((s, p) => s + this._attr(p, "tackling", 10), 0) / Math.max(1, pressN);

    // 表现层断球：压迫强 + 盘带差时偶发（不改比分）
    if (pressN >= 1 && Math.random() < 0.04 + pressPower / 200 - this._attr(car, "dribbling", 10) / 400) {
      const stealer = pressers[0];
      if (stealer) {
        this._clearCarrier();
        this.possession = stealer.team;
        this._setCarrier(stealer, { stick: true });
        this.actionTimer = 0.25;
        return;
      }
    }

    // —— 优先射门：禁区/空门绝不再横传浪费 ——
    const shotOpp = this._shotOpportunity(car);
    if (!this._inOppBox(car)) this._boxPassStreak = 0;
    const forceShot =
      shotOpp >= 0.58 ||
      (shotOpp >= 0.4 && (this._boxPassStreak || 0) >= 2) ||
      (this._inOppBox(car, true) && shotOpp >= 0.32);
    if (forceShot || (shotOpp >= 0.36 && Math.random() < 0.55 + shotOpp * 0.4)) {
      if (this._attemptPresentationShot(car, { force: forceShot })) {
        this._boxPassStreak = 0;
        return;
      }
    }

    // 边路传中：到了底线附近优先传中路而非继续横敲
    const dir = this._attackDir(car.team);
    const nearByline =
      car.team === "home" ? car.y < 24 && (car.x < 28 || car.x > 72) : car.y > 76 && (car.x < 28 || car.x > 72);
    if (nearByline && car.pos !== "DEF") {
      const boxMate = this.players
        .filter(
          (p) =>
            p.team === car.team &&
            p !== car &&
            p.pos !== "GK" &&
            !p.el.classList.contains("sent-off") &&
            Math.abs(p.x - 50) < 22 &&
            (car.team === "home" ? p.y < 30 : p.y > 70)
        )
        .sort((a, b) => Math.hypot(a.x - 50, a.y - (car.team === "home" ? 14 : 86)) - Math.hypot(b.x - 50, b.y - (car.team === "home" ? 14 : 86)))[0];
      if (boxMate && Math.random() < 0.72) {
        this._passTo(car, boxMate, { flightMs: 620 });
        car.fsm = "support";
        this.setCaption(
          document.documentElement.lang === "en" ? "Cross!" : "传中！",
          "info",
          900
        );
        this.actionTimer = 0.7;
        if (this._inOppBox(car)) this._boxPassStreak = (this._boxPassStreak || 0) + 1;
        return;
      }
    }

    const target = this._pickPassTarget(car);
    const passing = this._attr(car, "passing", 10);
    const drib = this._attr(car, "dribbling", 10);
    let passChance = 0.32 + passing / 55;
    if (pressN >= 2) passChance = 0.68 + passing / 80;
    else if (pressN === 1) passChance = 0.48 + passing / 90;
    // 高盘带前锋更愿带
    if (car.pos === "ATT") passChance *= 0.78 - drib / 120;
    if (car.pos === "DEF") passChance = Math.max(passChance, 0.52);
    // 导演：控球优势方略多传控
    if (car.team === "home") passChance += (this.directorBias - 0.5) * 0.12;
    else passChance += (0.5 - this.directorBias) * 0.12;
    // 攻势段落：进攻方更愿前传/前带，防守方更急于解围
    if (phase) {
      if (car.team === phase.side) {
        passChance += 0.08 * phase.intensity;
      } else {
        passChance = Math.max(passChance, 0.62); // 解围/出球
      }
    }
    // 禁区内：显著降低横传概率，逼出射门
    if (this._inOppBox(car)) {
      passChance *= 0.42;
      if ((this._boxPassStreak || 0) >= 2) passChance *= 0.35;
    }
    passChance = clamp(passChance, 0.12, 0.88);

    if (target && Math.random() < passChance) {
      // 禁区内禁止传给更身后/更边的浪费球：优先更靠近球门的人
      let passTo = target;
      if (this._inOppBox(car)) {
        const { gy } = this._goalTarget(car.team);
        const better = this.players
          .filter(
            (p) =>
              p.team === car.team &&
              p !== car &&
              p.pos !== "GK" &&
              !p.el.classList.contains("sent-off") &&
              Math.hypot(p.x - car.x, p.y - car.y) < 22
          )
          .sort(
            (a, b) =>
              Math.hypot(a.x - 50, a.y - gy) - Math.hypot(b.x - 50, b.y - gy)
          )[0];
        if (better && Math.hypot(better.x - 50, better.y - gy) < Math.hypot(car.x - 50, car.y - gy) - 2) {
          passTo = better;
        } else if (shotOpp >= 0.3) {
          // 没有更好的人 → 射
          if (this._attemptPresentationShot(car, { force: true })) {
            this._boxPassStreak = 0;
            return;
          }
        }
      }
      const dist = Math.hypot(passTo.x - car.x, passTo.y - car.y);
      // 场地%：短 ~12 → ~0.5s，中 ~25 → ~0.9s，长 ~45 → ~1.4s
      const flightMs = clamp(300 + dist * (14 - passing / 30), 320, 1200);
      this._passTo(car, passTo, { flightMs });
      if (this._inOppBox(car)) this._boxPassStreak = (this._boxPassStreak || 0) + 1;
      // 传球被断（表现）
      if (Math.random() < 0.1 + pressN * 0.035 - passing / 200) {
        setTimeout(() => {
          if (!this._built || this.phase !== "play") return;
          this.possession = car.team === "home" ? "away" : "home";
          this.carrier = null;
          this.ballState = "free";
          this.actionTimer = 0.15;
        }, flightMs + 140);
      } else {
        this.actionTimer = 0.4 + Math.random() * 0.3;
      }
    } else {
      // 禁区盘带也优先再判一次射门
      if (this._inOppBox(car) && shotOpp >= 0.28 && Math.random() < 0.65) {
        if (this._attemptPresentationShot(car, { force: shotOpp >= 0.45 })) {
          this._boxPassStreak = 0;
          return;
        }
      }
      this._dribbleCarrier();
      this._setTouch(car, 900);
      const pace = this._attr(car, "pace", 10);
      this.actionTimer = 0.38 + Math.random() * 0.5 - pace / 80;
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
    // 第三钮：热区开关（复用「客」旁逻辑不够，用双击网钮不合适 → 长按网=热区）
    // 简洁：网钮开启网络；主/客筛选；热区随网一起开（FMM 默认都关）
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
      this.networkSvg?.classList.toggle("fmm-net-off", !this.networkEnabled);
      // 开网时顺带开热区，关网时关热区（少叠加）
      this.heatEnabled = this.networkEnabled;
      this.heatLayer?.classList.toggle("fmm-heat-off", !this.heatEnabled);
      if (this.networkEnabled) {
        this._redrawNetwork(true);
        this._refreshHeatVisual();
      }
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
   * 阵型游走：持球方前压，无球方收缩
   * 软版：离球近的人（持球/逼抢/接应）不覆盖其目标
   */
  _shapeDrift() {
    this._shapeDriftSoft(false);
  }

  _shapeDriftSoft(onlyFar = true) {
    if (this.phase === "pause" || this.phase === "goal") return;
    const dirHome = this.possession === "home" ? -1 : 0.35;
    const dirAway = this.possession === "away" ? 1 : -0.35;
    const focusX = this.carrier?.x ?? this.ball.x;
    const focusY = this.carrier?.y ?? this.ball.y;
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      if (pl === this.carrier) continue;
      if (onlyFar) {
        const dist = Math.hypot(pl.x - focusX, pl.y - focusY);
        // 近球区域交给盘带/插上/压迫
        if (dist < 22) continue;
      }
      const hasBall = pl.team === this.possession;
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
      if (!hasBall) {
        // 无球：横向收拢 + Y 跟球深度，禁止漂回进攻 baseY
        spread *= 0.65;
        pl.tx = clamp(pl.baseX * 0.5 + focusX * 0.35 + 50 * 0.15 + (Math.random() - 0.5) * spread, 6, 94);
        if (pl.team === "home") {
          const lineY =
            pl.pos === "DEF"
              ? clamp(focusY - 12, 56, 90)
              : pl.pos === "MID"
                ? clamp(focusY - 24, 48, 78)
                : clamp(Math.max(48, focusY - 34), 46, 66);
          pl.ty = clamp(lineY + (Math.random() - 0.5) * 2, 5, 95);
        } else {
          const lineY =
            pl.pos === "DEF"
              ? clamp(focusY + 12, 10, 44)
              : pl.pos === "MID"
                ? clamp(focusY + 24, 22, 52)
                : clamp(Math.min(52, focusY + 34), 34, 54);
          pl.ty = clamp(lineY + (Math.random() - 0.5) * 2, 5, 95);
        }
      } else {
        const dir = pl.team === "home" ? dirHome : dirAway;
        pl.tx = clamp(pl.baseX + (Math.random() - 0.5) * spread, 6, 94);
        pl.ty = clamp(pl.baseY + dir * push + (Math.random() - 0.5) * (spread * 0.5), 5, 95);
      }
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
    const frozen = this.phase === "pause" || this.phase === "pre" || this.phase === "idle";
    this.fieldEl?.classList.toggle("mp-clickable", true);
    this.fieldEl?.classList.toggle("mp-paused", frozen);
    this.fieldEl?.classList.toggle("mp-pre", this.phase === "pre" || this.phase === "idle");
    if (this.tipEl) {
      // 赛前/中场都提示可点球员
      this.tipEl.classList.toggle("show", frozen);
      if (this.phase === "pre" || this.phase === "idle") {
        this.tipEl.textContent =
          this.tipEl.dataset.preTip ||
          (document.documentElement.lang === "en"
            ? "Tap a player · start match below"
            : "点击球员查看 · 下方开始比赛");
      }
    }
    for (const pl of this.players) {
      pl.el.classList.toggle("clickable", true);
      pl.el.classList.toggle("pause-glow", this.phase === "pause");
    }
  }

  _applyPlayer(pl) {
    pl.el.style.left = `${pl.x}%`;
    pl.el.style.top = `${pl.y}%`;
    // FMM：默认隐藏姓名；持球/高亮/点选时显示
    // 赛前/中场暂停不再强制全员挂名（22 人叠字会糊成一团）
    const showName =
      pl.el.classList.contains("has-ball") ||
      pl.el.classList.contains("highlight") ||
      pl.el.classList.contains("selected") ||
      pl.el.classList.contains("mp-focus") ||
      pl.el.classList.contains("scorer");
    pl.el.classList.toggle("show-name", showName);
  }

  _applyBall() {
    if (!this.ball.el) return;
    this.ball.el.style.left = `${this.ball.x}%`;
    this.ball.el.style.top = `${this.ball.y}%`;
    // DOM 回退路径：用 CSS 变量表达高度（canvas 模式仍会隐藏球）
    const z = clamp(this.ball.z || 0, 0, 12);
    this.ball.el.style.setProperty("--ball-z", String(z));
    this.ball.el.classList.toggle("mp-ball-air", z > 0.8);
  }

  /**
   * 镜头：FMM 观感 — 默认稳全场，仅射门/进球短暂 box
   */
  _updateCameraTarget() {
    if (this.phase === "pause" || this.phase === "pre" || this.phase === "idle") {
      this.cam.tScale = 1;
      this.cam.tx = 0;
      this.cam.ty = 0;
      return;
    }
    // 收尾阶段强制回 wide
    if (performance.now() < this.aftermathUntil) {
      this.camMode = "wide";
    }
    const ox = (this.ball.x - 50) / 50;
    const oy = (this.ball.y - 50) / 50;
    const mode = this.camMode || "wide";
    if (mode === "box") {
      // 禁区戏：轻微贴门，不大晃
      this.cam.tx = clamp(-ox * 2.8, -3.8, 3.8);
      this.cam.ty = clamp(-oy * 3.4, -4.5, 4.5);
      this.cam.tScale = performance.now() < this.camBoostUntil ? 1.07 : 1.04;
    } else if (mode === "ball" || this.phase === "goal") {
      this.cam.tx = clamp(-ox * 2.2, -3, 3);
      this.cam.ty = clamp(-oy * 2.0, -2.8, 2.8);
      this.cam.tScale = performance.now() < this.camBoostUntil ? 1.05 : 1.03;
    } else {
      // wide：FMM 全场观感，几乎不晃
      this.cam.tx = clamp(-ox * 0.55, -1.0, 1.0);
      this.cam.ty = clamp(-oy * 0.45, -0.85, 0.85);
      this.cam.tScale = 1.0;
    }
  }

  /** 场内短字幕（FMM 风格事件条）——同步到底栏 ticker */
  setCaption(text, kind = "", ms = 1600) {
    if (!this.captionEl) {
      this.setFmmTicker(text, kind, ms);
      return;
    }
    if (!text) {
      this.captionEl.classList.add("hidden");
      this.captionEl.textContent = "";
      this.captionEl.className = "mp-caption hidden";
      // 空字幕 → 显示控球条
      this.setFmmTicker("", "", 0);
      return;
    }
    this.captionEl.textContent = text;
    this.captionEl.className = `mp-caption ${kind}`;
    this.captionEl.classList.remove("hidden");
    this.setFmmTicker(text, kind, ms);
    const token = (this._captionToken = (this._captionToken || 0) + 1);
    if (ms > 0) {
      setTimeout(() => {
        if (this._captionToken !== token) return;
        this.setCaption("");
      }, ms);
    }
  }

  /**
   * FMM 底栏解说文案（与控球条互斥）
   * @param {string} text
   * @param {string} [kind] info|goal|shot|save|dispute|warn|chance|wood|replay
   * @param {number} [ms] 0=常驻直到下次；>0 超时后切回控球条
   */
  setFmmTicker(text, kind = "info", ms = 2200) {
    if (!this.fmmTickerEl) return;
    const token = (this._fmmTickerToken = (this._fmmTickerToken || 0) + 1);
    if (!text) {
      this.fmmTickerEl.textContent = "";
      this.fmmTickerEl.className = "mp-fmm-ticker";
      this.fmmTickerEl.classList.remove("show", "dispute", "goal", "shot", "save", "warn", "chance", "wood", "replay");
      this.fmmPossEl?.classList.add("show");
      return;
    }
    this.fmmTickerEl.textContent = text;
    this.fmmTickerEl.className = `mp-fmm-ticker show ${kind || "info"}`;
    this.fmmPossEl?.classList.remove("show");
    if (ms > 0) {
      setTimeout(() => {
        if (this._fmmTickerToken !== token) return;
        this.setFmmTicker("", "", 0);
      }, ms);
    }
  }

  /** 更新 FMM 底栏控球条 */
  setFmmPossession(homePct, awayPct) {
    const h = clamp(Math.round(Number(homePct) || 50), 0, 100);
    const a = clamp(Math.round(Number(awayPct) != null ? awayPct : 100 - h), 0, 100);
    if (this.fmmPossHEl) this.fmmPossHEl.textContent = `${h}%`;
    if (this.fmmPossAEl) this.fmmPossAEl.textContent = `${a}%`;
    if (this.fmmPossFillEl) this.fmmPossFillEl.style.width = `${h}%`;
  }

  /** 倍速显示 */
  setFmmSpeedLabel(speed) {
    if (this.fmmSpeedEl) {
      const s = Number(speed) || 1;
      this.fmmSpeedEl.textContent = s === 1 ? "×1" : `×${s}`;
    }
  }

  /**
   * 重播 chrome：顶栏「重播」+ 底栏「跳过」
   * @param {boolean} on
   * @param {{ lang?: string }} [opts]
   */
  setFmmReplayChrome(on, opts = {}) {
    const en = opts.lang === "en";
    this._fmmReplay = this._fmmReplay || { active: false, skip: false };
    this._fmmReplay.active = !!on;
    if (!on) this._fmmReplay.skip = false;
    this.fieldEl?.classList.toggle("mp-fmm-replay", !!on);
    if (this.replayBadgeEl) {
      this.replayBadgeEl.textContent = en ? "REPLAY" : "重播";
      this.replayBadgeEl.classList.toggle("hidden", !on);
    }
    if (this.fmmSkipEl) {
      this.fmmSkipEl.textContent = en ? "Skip" : "跳过";
      this.fmmSkipEl.classList.toggle("hidden", !on);
    }
    // 同步页面顶栏（若存在）
    try {
      document.getElementById("match-fmm-replay-badge")?.classList.toggle("hidden", !on);
      const skipHdr = document.getElementById("btn-match-fmm-skip");
      if (skipHdr) {
        skipHdr.classList.toggle("hidden", !on);
        skipHdr.textContent = en ? "Skip" : "跳过";
      }
      document.querySelector(".fm-sb-live")?.classList.toggle("is-replay", !!on);
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * 进球后 FMM 自动重播：用最近高光段帧再播一遍（全场镜头 + 可跳过）
   * @param {object} [opts]
   */
  async playFmmGoalReplay(opts = {}) {
    const lang = opts.lang || "zh";
    const en = lang === "en";
    const frames = opts.frames || this._lastTimeline?.frames;
    if (!frames?.length || frames.length < 4) {
      // 无帧：用场景快照轻回放
      if (opts.scene && this.restoreSceneSnapshot) {
        this.setFmmReplayChrome(true, { lang });
        this.setFmmTicker(en ? "▶ Goal replay" : "▶ 进球重播", "replay", 0);
        this.restoreSceneSnapshot(opts.scene);
        this.camMode = "follow";
        this.cam.tx = 0;
        this.cam.ty = 0;
        this.cam.tScale = 1;
        this._drawCanvas?.();
        const sleepFn = opts.sleepFn || ((ms) => new Promise((r) => setTimeout(r, ms)));
        const isSkip = () => !!(this._fmmReplay?.skip || opts.isSkip?.());
        for (let i = 0; i < 12 && !isSkip(); i++) await sleepFn(120);
        this.setFmmReplayChrome(false, { lang });
        this.setFmmTicker("", "", 0);
      }
      return;
    }
    this.setFmmReplayChrome(true, { lang });
    this.setFmmTicker(en ? "▶ Goal replay" : "▶ 进球重播", "replay", 0);
    this._fmmReplay.skip = false;
    this.fieldEl?.classList.remove("mp-replay-slow");
    // 只重播最后传球/射门/入网，墙钟控制在约 7~9s。
    const rawClimax = opts.climaxAt ?? this._lastTimeline?.climaxAt;
    const requestedClimax = rawClimax == null ? NaN : Number(rawClimax);
    const firstT = Number(frames[0]?.t) || 0;
    const lastT = Number(frames[frames.length - 1]?.t) || firstT;
    const netFrame = frames.find((f) => f.ball?.netHit);
    const netT = Number(netFrame?.t);
    const inferredClimax = Number.isFinite(netT)
      ? netT
      : lastT - Math.min(2, Math.max(0, lastT - firstT) * 0.2);
    const climax = Number.isFinite(requestedClimax) ? requestedClimax : inferredClimax;
    const t0 = climax - 5.5;
    const t1 = climax + 2;
    let slice = frames.filter((f) => {
      const t = Number(f.t);
      return Number.isFinite(t) && t >= t0 && t <= t1;
    });
    if (slice.length < 4) {
      // 时间戳缺失/稀疏时也只取高潮附近的小段，绝不退化成整段重播。
      let nearest = frames.length - 1;
      let nearestDelta = Infinity;
      frames.forEach((f, i) => {
        const t = Number(f.t);
        const delta = Number.isFinite(t) ? Math.abs(t - climax) : Infinity;
        if (delta < nearestDelta) {
          nearest = i;
          nearestDelta = delta;
        }
      });
      slice = frames.slice(Math.max(0, nearest - 55), Math.min(frames.length, nearest + 21));
    }
    const getSpeed = opts.getSpeed || (() => 1);
    const isPaused = () => {
      if (this._fmmReplay?.skip) {
        this.stopSimTimeline();
        return true;
      }
      return !!(opts.isPaused?.());
    };
    // 最后的墙钟保险：低帧率或异常时间戳也不能让自动重播拖到几十秒。
    const hardStop = setTimeout(() => {
      if (this._fmmReplay?.active && this._simPlay?.label === "replay") {
        this.stopSimTimeline();
      }
    }, 9500);
    try {
      await this.playSimTimeline(slice, {
        getSpeed,
        isPaused,
        rate: 1.15,
        label: "replay",
        climaxAt: climax,
        fmmWide: true,
        onSimT: opts.onSimT || null,
      });
    } catch (_) {
      /* ignore */
    } finally {
      clearTimeout(hardStop);
    }
    this.setFmmReplayChrome(false, { lang });
    this.setFmmTicker("", "", 0);
    if (this.phase === "goal") this.phase = "play";
  }

  /**
   * 焦点球员：关键戏压暗其他人
   * @param {Array<object|string|null|undefined>} playersOrIds
   * @param {number} ms
   */
  _setFocus(playersOrIds, ms = 1400) {
    this.focusIds = new Set();
    for (const p of playersOrIds || []) {
      if (!p) continue;
      const id = typeof p === "string" ? p : p.id;
      if (id) this.focusIds.add(id);
    }
    this.focusUntil = performance.now() + ms;
    this._applyFocusClasses();
  }

  _clearFocus() {
    this.focusIds = new Set();
    this.focusUntil = 0;
    this._applyFocusClasses();
  }

  _applyFocusClasses() {
    const active = this.focusIds.size > 0 && performance.now() < this.focusUntil;
    this.fieldEl?.classList.toggle("mp-focus-mode", active);
    for (const pl of this.players) {
      const on = active && this.focusIds.has(pl.id);
      pl.el.classList.toggle("mp-focus", on);
      pl.el.classList.toggle("mp-dim", active && !on);
    }
  }

  /**
   * 阵型块：整队按职责平移（FMM 块状站位感）
   * @param {'home'|'away'} team
   * @param {'attack'|'defend'|'mid'|'compact'} shape
   */
  _setBlockShape(team, shape = "mid") {
    const dir = this._attackDir(team);
    for (const pl of this.players) {
      if (pl.team !== team || pl.el.classList.contains("sent-off")) continue;
      let push = 0;
      let spread = 1;
      if (shape === "attack") {
        push = pl.pos === "ATT" ? 10 : pl.pos === "MID" ? 7 : pl.pos === "DEF" ? 3.5 : 0.4;
        spread = 1.15;
      } else if (shape === "defend") {
        push = pl.pos === "ATT" ? -2 : pl.pos === "MID" ? -4 : pl.pos === "DEF" ? -2.5 : 0;
        spread = 0.72;
      } else if (shape === "compact") {
        push = 1;
        spread = 0.65;
      } else {
        push = pl.pos === "ATT" ? 3 : pl.pos === "MID" ? 2 : 1;
        spread = 0.95;
      }
      const midPull = 50;
      pl.tx = clamp(pl.baseX * spread + midPull * (1 - spread) + (Math.random() - 0.5) * 2.5, 6, 94);
      pl.ty = clamp(pl.baseY + dir * push + (Math.random() - 0.5) * 2, 5, 95);
    }
  }

  /** 双方按控球摆块 */
  _applyPossessionBlocks() {
    const att = this.possession;
    const def = att === "home" ? "away" : "home";
    this._setBlockShape(att, "attack");
    this._setBlockShape(def, "defend");
  }

  /**
   * 关键事件短镜头：把球和 1–2 名关键球员摆到「能看懂」的位置
   */
  _stageKeyMoment(side, { kind = "chance", playerId = null } = {}) {
    const attHome = side === "home";
    const dir = this._attackDir(side);
    this.possession = side;
    this.camMode = kind === "chance" || kind === "save" || kind === "pen" ? "box" : "ball";
    this.camBoostUntil = performance.now() + 900;
    // 只轻推目标，不整队瞬移到阵型块
    this._nudgeAttackShape(side, 0.4);
    this._nudgeDefendShape(side === "home" ? "away" : "home", this.carrier || this.ball);

    let hero =
      (playerId && this.players.find((p) => p.id === playerId)) ||
      (this.carrier && this.carrier.team === side ? this.carrier : null) ||
      this._nearestOutfield(side, this.ball.x, this.ball.y) ||
      this.players.find((p) => p.team === side && p.pos === "ATT" && !p.el.classList.contains("sent-off"));

    const boxY = attHome ? 16 + Math.random() * 8 : 84 - Math.random() * 8;
    if (hero) {
      // 从当前位置朝禁区推目标，几乎不瞬移
      hero.tx = clamp(lerp(hero.x, 32 + Math.random() * 36, 0.55), 18, 82);
      hero.ty = clamp(lerp(hero.y, boxY, 0.5), 8, 92);
      hero.x = lerp(hero.x, hero.tx, 0.18);
      hero.y = lerp(hero.y, hero.ty, 0.18);
      this._applyPlayer(hero);
    }

    const mate = this.players
      .filter((p) => p.team === side && p !== hero && p.pos !== "GK" && !p.el.classList.contains("sent-off"))
      .sort(
        (a, b) =>
          Math.hypot(a.x - (hero?.x || 50), a.y - (hero?.y || 50)) -
          Math.hypot(b.x - (hero?.x || 50), b.y - (hero?.y || 50))
      )[0];
    if (mate && hero) {
      mate.tx = clamp(hero.tx + (Math.random() < 0.5 ? -12 : 12), 10, 90);
      mate.ty = clamp(hero.ty - dir * 6, 8, 92);
    }
    const press = this.players
      .filter((p) => p.team !== side && p.pos !== "GK" && !p.el.classList.contains("sent-off"))
      .sort((a, b) => {
        const hx = hero?.x || 50;
        const hy = hero?.y || 50;
        return Math.hypot(a.x - hx, a.y - hy) - Math.hypot(b.x - hx, b.y - hy);
      })[0];
    if (press && hero) {
      press.tx = clamp(hero.tx + (Math.random() - 0.5) * 5, 8, 92);
      press.ty = clamp(hero.ty + (Math.random() - 0.5) * 4, 8, 92);
    }

    if (hero) {
      this._setCarrier(hero, { stick: true });
      this._setFocus([hero, mate, press].filter(Boolean), 1600);
    }
    return { hero, mate, press, boxY, attHome };
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
    this.stopSimTimeline?.();
    this.stopLoop();
    this.hideFlashCard?.();
    if (this._onCanvasResize) {
      window.removeEventListener("resize", this._onCanvasResize);
      this._onCanvasResize = null;
    }
    if (this._fieldRo) {
      try {
        this._fieldRo.disconnect();
      } catch (_) {
        /* ignore */
      }
      this._fieldRo = null;
    }
    if (this._resizeTimers?.length) {
      for (const t of this._resizeTimers) clearTimeout(t);
      this._resizeTimers = null;
    }
    if (this._rec?.active) this.stopRecording();
    this.root.innerHTML = "";
    this.players = [];
    this.trails = [];
    this.passNetwork = new Map();
    this.networkSvg = null;
    this.carrier = null;
    this.flight = null;
    this.ballState = "free";
    this.ballFlightUntil = 0;
    this.frozen = false;
    this.scriptLock = false;
    this.simDrive = false;
    this.aftermathUntil = 0;
    this.attackPhase = null;
    this.flashCardEl = null;
    this.canvas = null;
    this._cx = null;
    this._built = false;
  }

  update(dt, ts) {
    // 防止切后台后 dt 爆炸
    const d = Math.min(dt, 0.05);
    const livePlay = this.phase === "play" && !this.frozen;
    const staged = this.phase === "goal" && !this.frozen; // 进球/回放：只跟目标
    // scriptLock：关键事件预演，只朝脚本目标跑，不跑自由 AI
    // pre / idle / pause：钉阵型；UI frozen：冻结当前帧

    // —— 真空间投影：位置由 playSimTimeline 写入；软跟镜 + Canvas ——
    if (this.simDrive && (livePlay || staged) && !this.frozen) {
      for (const pl of this.players) {
        if (pl.el.classList.contains("sent-off")) continue;
        this._applyPlayer(pl);
      }
      this._applyBall();
      this._updateSimCamera(d);
      this._drawCanvas();
      this._updateTouchClasses(ts);
      return;
    }

    if (this.frozen && this.phase === "play") {
      // UI 暂停：保留站位与球，不跑 AI
      this._applyBall();
      this._updateCameraTarget();
      this.cam.x = lerp(this.cam.x, this.cam.tx, 1 - Math.pow(0.05, d));
      this.cam.y = lerp(this.cam.y, this.cam.ty, 1 - Math.pow(0.05, d));
      this.cam.scale = lerp(this.cam.scale, this.cam.tScale, 1 - Math.pow(0.08, d));
      this._applyCamera();
      this._drawCanvas();
      this._updateTouchClasses(ts);
      return;
    }

    // 飞行落地（状态机）
    if (
      (livePlay || staged) &&
      this.flight &&
      performance.now() >= this.flight.until
    ) {
      this._resolveFlight();
    } else if (
      (livePlay || staged) &&
      !this.flight &&
      this._isBallInFlight() &&
      performance.now() >= this.ballFlightUntil
    ) {
      this.ballFlightUntil = 0;
      if (this.ballState === "flight" || this.ballState === "shot") {
        this.ballState = this.carrier ? "held" : "free";
      }
    }

    const inAftermath = livePlay && performance.now() < this.aftermathUntil;

    if (livePlay && this.scriptLock) {
      // 预演：略快于日常，但仍可见跑动（不瞬移）
      for (const pl of this.players) {
        if (pl.el.classList.contains("sent-off")) continue;
        const mul = this._speedMul(pl);
        const speed = pl === this.carrier ? 18 * mul : 14 * mul;
        this._moveToward(pl, speed, d);
        this._applyPlayer(pl);
      }
    } else if (inAftermath) {
      // 收尾：只慢跑回目标，不新开盘带决策
      for (const pl of this.players) {
        if (pl.el.classList.contains("sent-off")) continue;
        this._moveToward(pl, 8 * this._speedMul(pl), d);
        this._applyPlayer(pl);
      }
    } else if (livePlay) {
      // 持球决策：盘带 / 传球 / 抢球
      this.actionTimer -= d;
      if (this.actionTimer <= 0) {
        this._decidePossessionAction();
        if (this.actionTimer <= 0) this.actionTimer = 0.35 + Math.random() * 0.45;
      }

      // 盘带：定期刷新前进目标
      if (this.carrier && !this._isBallInFlight()) {
        this.passTimer -= d;
        if (this.passTimer <= 0) {
          this.passTimer = 0.2 + Math.random() * 0.26;
          this._dribbleCarrier();
        }
      }

      // 持球人 → possession 同步（每帧）
      if (this.carrier?.team) this.possession = this.carrier.team;

      // FSM 目标分配（约 8 次/秒）：三线站位 + 少量 press/support
      this.touchTimer = (this.touchTimer || 0) - d;
      if (this.touchTimer <= 0) {
        this.touchTimer = 0.12;
        this._assignFsmTargets();
      }

      // 每帧硬约束：无球前锋不得蹲对方禁区（555 截图问题）
      this._enforceOutOfPossessionShape();

      // 低频仅刷新 chrome
      this.shapeTimer -= d;
      if (this.shapeTimer <= 0) {
        this.shapeTimer = 2.8 + Math.random() * 1.2;
        this._assignFsmTargets();
        this._updatePossessionChrome();
      }

      // 日常镜头偏 wide；仅很深推进时才 ball
      if (this.camMode === "wide" && this.carrier) {
        const prog =
          this.carrier.team === "home" ? 100 - this.carrier.y : this.carrier.y;
        if (prog > 78) this.camMode = "ball";
      }
      if (this.camMode === "ball" && this.carrier && performance.now() >= this.camBoostUntil) {
        const prog =
          this.carrier.team === "home" ? 100 - this.carrier.y : this.carrier.y;
        if (prog < 68) this.camMode = "wide";
      }

      for (const pl of this.players) {
        if (pl.el.classList.contains("sent-off")) continue;
        const mul = this._speedMul(pl);
        // 按 FSM 调速：压迫/接应稍快，回位更稳
        let speed = 7 * mul;
        if (pl.fsm === "carry" || pl === this.carrier) speed = 13.5 * mul;
        else if (pl.fsm === "press") speed = 12 * mul;
        else if (pl.fsm === "support") speed = 10.5 * mul;
        else if (pl.fsm === "cover") speed = 9 * mul;
        else if (pl.fsm === "home") speed = 6.5 * mul;
        else if (pl.pos === "GK") speed = 5;
        // 每帧：无球方跟角色线；错位加速（硬边界已在 _enforceOutOfPossessionShape）
        if (pl !== this.carrier && this._normPos(pl) !== "GK") {
          const by = this.ball?.y ?? 50;
          const role = this._normPos(pl);
          const hasBall = pl.team === this.possession;
          if (!hasBall) {
            const lineY = this._roleLineY(pl.team, role, by, false);
            if (Math.abs(pl.y - lineY) > 8) speed = Math.max(speed, 16 * mul);
            if (Math.abs(pl.y - lineY) > 18) speed = Math.max(speed, 22 * mul);
            // 目标始终贴线，防止又漂回进攻 base
            if (pl.fsm !== "press") {
              pl.ty = lineY;
            }
          } else if (role === "DEF") {
            if (pl.team === "home" && pl.ty < 38) pl.ty = 38;
            if (pl.team === "away" && pl.ty > 62) pl.ty = 62;
          }
        }
        // 有球方非持球：目标不得明显越位
        if (pl.team === this.possession && pl !== this.carrier && pl.pos !== "GK") {
          const c = this._clampTargetOffside(pl, pl.tx, pl.ty);
          pl.tx = c.x;
          pl.ty = c.y;
        }
        this._moveToward(pl, speed, d);
      }
      // 全体移动后再跑分离力，避免叠罗汉（推开的位移本帧即生效）
      this._applySeparation(d);
      // 分离后统一写 DOM + 热区
      for (const pl of this.players) {
        if (pl.el.classList.contains("sent-off")) continue;
        this._applyPlayer(pl);
        pl.heatAcc = (pl.heatAcc || 0) + d;
        if (pl.heatAcc > 0.45) {
          pl.heatAcc = 0;
          this._markHeat(pl.x, pl.y, pl.team, 0.35);
        }
      }
    } else if (staged) {
      // 进球庆祝 / 回放脚本：只朝 tx/ty 走
      for (const pl of this.players) {
        if (pl.el.classList.contains("sent-off")) continue;
        this._moveToward(pl, 14 * this._speedMul(pl), d);
        this._applyPlayer(pl);
      }
    } else {
      // 赛前 / 中场 / 完场：钉在阵型位，球回中圈
      this.carrier = null;
      this.ballState = "free";
      this.flight = null;
      for (const pl of this.players) {
        if (pl.el.classList.contains("sent-off")) continue;
        pl.tx = pl.baseX;
        pl.ty = pl.baseY;
        pl.x = pl.baseX;
        pl.y = pl.baseY;
        this._applyPlayer(pl);
      }
      if (this.phase === "pre" || this.phase === "idle" || this.phase === "pause") {
        if (!this._isBallInFlight()) {
          this.ball.x = 50;
          this.ball.y = 50;
          this.ball.tx = 50;
          this.ball.ty = 50;
        }
      }
    }

    // 球：held 贴人 / flight|shot 飞向目标
    if (livePlay || staged) {
      if (this.carrier && this.ballState === "held" && !this._isBallInFlight()) {
        const dir = this._attackDir(this.carrier.team);
        this.ball.x = this.carrier.x;
        this.ball.y = this.carrier.y + dir * 0.95;
        this.ball.tx = this.ball.x;
        this.ball.ty = this.ball.y;
      } else {
        const bdx = this.ball.tx - this.ball.x;
        const bdy = this.ball.ty - this.ball.y;
        const bdist = Math.hypot(bdx, bdy);
        // 飞行/射门：用剩余 flight 时间对齐视觉速度，避免“时长还没到球已瞬移到位”
        let bSpeed = 36;
        if (this.flight && (this.ballState === "flight" || this.ballState === "shot")) {
          const remainSec = Math.max(0.05, (this.flight.until - performance.now()) / 1000);
          bSpeed = Math.min(120, Math.max(14, bdist / remainSec));
        } else if (this.ballState === "shot") {
          bSpeed = 72;
        } else if (this._isBallInFlight()) {
          bSpeed = 48;
        }
        if (bdist < 0.15) {
          this.ball.x = this.ball.tx;
          this.ball.y = this.ball.ty;
        } else {
          const step = Math.min(bdist, bSpeed * d);
          this.ball.x += (bdx / bdist) * step;
          this.ball.y += (bdy / bdist) * step;
        }
      }
    }
    this._applyBall();
    if (livePlay) {
      this._markHeat(this.ball.x, this.ball.y, this.possession, 0.08 * (d * 60));
    }

    this._updateCameraTarget();
    // 镜头更钝：慢跟，减少晃
    const camEase = this.camMode === "wide" ? 0.02 : 0.04;
    this.cam.x = lerp(this.cam.x, this.cam.tx, 1 - Math.pow(camEase, d));
    this.cam.y = lerp(this.cam.y, this.cam.ty, 1 - Math.pow(camEase, d));
    this.cam.scale = lerp(this.cam.scale, this.cam.tScale, 1 - Math.pow(0.05, d));
    this._applyCamera();

    this._drawCanvas();
    this._pushRecFrame(ts);

    this._updateTrails(d);
    this._updateTouchClasses(ts);
    if (this.focusIds.size && performance.now() >= this.focusUntil) {
      this._clearFocus();
    } else if (this.focusIds.size) {
      this._applyFocusClasses();
    }

    this.heatTimer -= d;
    if (this.heatTimer <= 0) {
      this.heatTimer = 0.5;
      this._refreshHeatVisual();
      this._updatePressLines();
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

  /** 球飞向目标并画轨迹（进入 flight/shot 状态） */
  _shootBall(tx, ty, kind = "shot") {
    const dist = Math.hypot(tx - this.ball.x, ty - this.ball.y);
    const ms =
      kind === "goal"
        ? clamp(360 + dist * 10, 420, 1100)
        : kind === "pass"
          ? clamp(300 + dist * 13, 320, 1100)
          : clamp(280 + dist * 9, 320, 900);
    this._addTrail(
      this.ball.x,
      this.ball.y,
      tx,
      ty,
      kind,
      kind === "goal" ? 1.05 : kind === "pass" ? ms / 1000 + 0.1 : 0.75
    );
    this.carrier = null;
    this._beginFlight({ x: tx, y: ty, kind, ms });
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
    if (!this._built || !ev || ev.type === "tick" || ev.type === "sim_frame") return;

    // —— 真空间投影：只横幅/音效/贴帧，不瞬移编舞 ——
    // simDrive / 贴帧 / 或 engine=v2 事件：一律走轻量分支（防 fast 未开 simDrive 时掉进旧高光）
    if (this.simDrive || snap?.sim || snap?.engine === "v2" || ev?.fromSim) {
      if (snap?.sim) this.applySimSnapshot(snap.sim);
      // 无帧时也钉死 simDrive，阻断 update() 旧 AI
      if (!this.simDrive) this.setSimDrive?.(true);
      this.updateLiveStrip?.(snap);
      const homeId0 = fixture?.home || this.home?.id;
      switch (ev.type) {
        case "kickoff":
          this.phase = "play";
          this.frozen = false;
          this.setBanner(ev.text || "Kick-off", "info");
          this.setCaption(ev.text || "Kick-off", "info", 1400);
          this.playSfx("whistle");
          setTimeout(() => this.setBanner(""), 1200);
          if (!this._rec?.active) this.startRecording();
          this._syncClickable();
          break;
        case "context":
          this.setBanner(ev.text?.replace(/^情境：/, "") || "", "info");
          this.setCaption(ev.text?.replace(/^情境：/, "") || "", "info", 1800);
          setTimeout(() => this.setBanner(""), 1600);
          break;
        case "goal": {
          this.camMode = "box";
          this.camBoostUntil = performance.now() + 1400;
          const scorer = ev.playerId && this.players.find((p) => p.id === ev.playerId);
          if (scorer) {
            scorer.el.classList.add("scorer", "highlight");
            this._setFocus([scorer], 2000);
            setTimeout(() => scorer.el.classList.remove("scorer", "highlight"), 2200);
          }
          this.setBanner("⚽ GOAL!", "goal");
          // 进球只保留中央主提示 + 底栏事件文案；不再把同一句话复制到场内字幕。
          this.setCaption("");
          this.setFmmTicker(ev.text || "GOAL", "goal", 1800);
          this.playSfx("goal");
          this.playSfx("cheer");
          setTimeout(() => this.setBanner(""), 1800);
          break;
        }
        case "save":
          this.setBanner("🧤", "info");
          this.setCaption(ev.text || "SAVE", "info", 1200);
          this.playSfx("save");
          setTimeout(() => this.setBanner(""), 900);
          break;
        case "corner": {
          // sim 路径也要摆出角球画面（旧版只闪 🚩，用户反馈从没见过角球状态）
          this._stageCornerSetPiece(ev, fixture);
          this.setBanner("🚩 角球", "info");
          this.setCaption(ev.text || "CORNER", "info", 1600);
          this.setFmmTicker?.(
            (typeof document !== "undefined" && document.documentElement?.lang === "en")
              ? "Corner kick!"
              : "角球！",
            "info",
            1800
          );
          setTimeout(() => this.setBanner(""), 1400);
          break;
        }
        case "chance":
        case "woodwork":
          this.setBanner(ev.type === "woodwork" ? "🪵" : "!", "warn");
          this.setCaption(ev.text || "", "warn", 1100);
          setTimeout(() => this.setBanner(""), 900);
          break;
        case "card":
        case "red":
          this.setBanner(ev.type === "red" ? "🟥" : "🟨", "warn");
          this.setCaption(ev.type === "red" ? "RED CARD" : "YELLOW", "warn", 1400);
          if (ev.type === "red" && ev.playerId) {
            const pl = this.players.find((p) => p.id === ev.playerId);
            if (pl) pl.el.classList.add("sent-off");
          }
          setTimeout(() => this.setBanner(""), 1100);
          break;
        case "injury":
        case "sub":
        case "tactics":
        case "coach":
          if (ev.text) {
            this.setCaption(ev.text, "info", 1400);
          }
          if (ev.type === "sub" && ev.outId && ev.inId) {
            // 换人 DOM 仍走原逻辑
            try {
              this.applySubOnPitch?.(ev.outId, ev.inId, 
                ev.teamId === homeId0 ? this.home : this.away);
            } catch (_) { /* ignore */ }
          }
          break;
        case "ht":
        case "ft":
          this.setBanner(ev.type === "ht" ? "HT" : "FT", "info");
          this.setCaption(ev.text || "", "info", 2000);
          this.playSfx("whistle");
          this.phase = "pause";
          setTimeout(() => this.setBanner(""), 1600);
          break;
        default:
          break;
      }
      return;
    }

    const homeId = fixture?.home || this.home?.id;
    const isHomeTeam = (teamId) => teamId === homeId;

    switch (ev.type) {
      case "kickoff":
        this.phase = "play";
        this.frozen = false;
        this.aftermathUntil = 0;
        this.hidePlayerCard();
        this.hideFlashCard();
        this._clearCarrier();
        this._clearFocus();
        this.ballState = "free";
        this.flight = null;
        this.ballFlightUntil = 0;
        this.actionTimer = 0.35;
        this.passTimer = 0.3;
        this.shapeTimer = 1.2;
        this.camMode = "wide";
        this.ball.x = 50;
        this.ball.y = 50;
        this.possession = Math.random() < this.directorBias ? "home" : "away";
        this._applyPossessionBlocks();
        this._boxPassStreak = 0;
        if (!this._rec?.active) this.startRecording();
        // 中圈开球：直接交给中场，进入 held 连续 tick
        {
          const pool = this.players.filter(
            (p) => p.team === this.possession && p.pos === "MID" && !p.el.classList.contains("sent-off")
          );
          const fallback = this.players.filter(
            (p) => p.team === this.possession && p.pos !== "GK" && !p.el.classList.contains("sent-off")
          );
          const list = pool.length ? pool : fallback;
          list.sort(
            (a, b) =>
              Math.hypot(a.x - 50, a.y - 50) - Math.hypot(b.x - 50, b.y - 50)
          );
          if (list[0]) {
            list[0].tx = 50 + (Math.random() - 0.5) * 4;
            list[0].ty = 50 + this._attackDir(this.possession) * 3;
            list[0].x = lerp(list[0].x, 50, 0.4);
            list[0].y = lerp(list[0].y, 50, 0.4);
            this._setCarrier(list[0], { stick: true });
            this._setFocus([list[0]], 900);
            this.actionTimer = 0.2;
          }
        }
        this.setBanner(ev.text || "Kick-off", "info");
        this.setCaption(ev.text || "Kick-off", "info", 1400);
        this.playSfx("whistle");
        setTimeout(() => this.setBanner(""), 1200);
        this._syncClickable();
        break;

      case "context":
        this.setBanner(ev.text?.replace(/^情境：/, "") || "", "info");
        this.setCaption(ev.text?.replace(/^情境：/, "") || "", "info", 2200);
        setTimeout(() => this.setBanner(""), 2000);
        break;

      case "goal": {
        // 空间投影：不编舞瞬移，走导演慢镜 + 撞网（位置已由 sim 帧决定）
        if (this.simDrive) {
          this.triggerDirectorMoment("goal", { ev, fixture });
          this.playSfx("goal");
          this.playSfx("cheer");
          break;
        }
        // 无 await 场景的轻量进球（真正高光请用 playGoalHighlight）
        this._playGoalShot(ev, snap, fixture, { celebrateMs: 1600 });
        this.playSfx("goal");
        this.playSfx("cheer");
        break;
      }

      case "chance":
      case "woodwork": {
        if (this.simDrive) {
          this.triggerDirectorMoment(ev.type === "woodwork" ? "woodwork" : "chance", {
            ev,
            fixture,
          });
          this.playSfx("kick");
          break;
        }
        const attHome = ev.teamId ? isHomeTeam(ev.teamId) : this.possession === "home";
        const side = attHome ? "home" : "away";
        this.possession = side;
        // 预演后优先沿用当前持球/指定射手，避免再瞬移
        let shooter =
          (ev.playerId && this.players.find((p) => p.id === ev.playerId)) ||
          (this.carrier && this.carrier.team === side ? this.carrier : null);
        if (!shooter || shooter.el.classList.contains("sent-off")) {
          const staged = this._stageKeyMoment(side, { kind: "chance", playerId: ev.playerId });
          shooter = staged.hero;
        } else {
          this.camMode = "box";
          this.camBoostUntil = performance.now() + 700;
          this._setFocus([shooter], 1400);
          this._setCarrier(shooter, { stick: true });
        }
        const tx = 42 + Math.random() * 16;
        const ty = attHome ? 6 + Math.random() * 8 : 92 - Math.random() * 8;
        if (shooter) {
          this._setTouch(shooter, 1000);
          this.ball.x = shooter.x;
          this.ball.y = shooter.y;
        }
        this._clearCarrier();
        this._shootBall(tx, ty, ev.type === "woodwork" ? "wood" : "shot");
        this.playSfx("kick");
        this._markHeat(tx, ty, side, 2.5);
        if (ev.type === "woodwork") {
          this._burst(tx, ty, "wood");
          this.setCaption(ev.text || "WOODWORK", "wood", 1500);
        } else {
          this.setCaption(ev.text || "CHANCE", "chance", 1400);
        }
        if (shooter?.player) {
          this.showFlashCard({
            title: ev.type === "woodwork" ? "门框！" : "良机",
            sub: ev.type === "woodwork" ? "WOODWORK" : "CHANCE",
            kind: "chance",
            player: shooter.player,
            team: side,
            ms: 1800,
          });
        }
        this._refreshHeatVisual();
        this._scheduleAftermath({ flipPossession: true, delayMs: 800, toGk: false });
        break;
      }

      case "save": {
        if (this.simDrive) {
          this.triggerDirectorMoment("save", { ev, fixture });
          this.playSfx("save");
          // 扑救方门将焦点（若事件带了 id）
          const saveHome = isHomeTeam(ev.teamId);
          const gk = this.players.find(
            (p) =>
              (p.pos === "GK" || p.role === "GK") &&
              p.team === (saveHome ? "home" : "away")
          );
          if (gk) {
            this._setFocus([gk], 1600);
            this.showFlashCard?.({
              title: document.documentElement?.lang === "en" ? "SAVE" : "扑救",
              sub: "SAVE",
              kind: "save",
              player: gk.player,
              team: saveHome ? "home" : "away",
              ms: 1600,
            });
          }
          break;
        }
        const saveHome = isHomeTeam(ev.teamId);
        const atk = saveHome ? "away" : "home";
        this.possession = atk;
        // 预演后已有进攻持球则沿用
        if (!(this.carrier && this.carrier.team === atk)) {
          this._stageKeyMoment(atk, { kind: "save" });
        } else {
          this.camMode = "box";
          this.camBoostUntil = performance.now() + 700;
          this._setFocus([this.carrier], 1200);
        }
        const tx = 48 + Math.random() * 4;
        const ty = saveHome ? 92 + Math.random() * 4 : 4 + Math.random() * 4;
        const gk = this.players.find(
          (p) => p.team === (saveHome ? "home" : "away") && p.pos === "GK"
        );
        this._clearCarrier();
        this._shootBall(tx, ty, "save");
        this.playSfx("save");
        if (gk) {
          gk.tx = tx;
          gk.ty = ty;
          gk.x = lerp(gk.x, tx, 0.25);
          gk.y = lerp(gk.y, ty, 0.25);
          this._applyPlayer(gk);
          gk.el.classList.add("highlight");
          this.highlightId = gk.id;
          this.flashUntil = performance.now() + 1200;
          this._setTouch(gk, 900);
          this._setFocus([gk], 1400);
          this.showFlashCard({
            title: "扑救",
            sub: "SAVE",
            kind: "save",
            player: gk.player,
            team: saveHome ? "home" : "away",
            ms: 1800,
          });
        }
        this._markHeat(tx, ty, saveHome ? "home" : "away", 2);
        this._burst(tx, ty, "save");
        this.setCaption(ev.text || "SAVE", "save", 1400);
        this._refreshHeatVisual();
        // 扑救后球权给门将方
        this.possession = saveHome ? "home" : "away";
        this._scheduleAftermath({ flipPossession: false, delayMs: 850, toGk: true });
        break;
      }

      case "penalty":
      case "pen_miss": {
        const attHome = ev.teamId ? isHomeTeam(ev.teamId) : true;
        const side = attHome ? "home" : "away";
        this._stageKeyMoment(side, { kind: "pen", playerId: ev.playerId });
        const ty = attHome ? 8 : 92;
        this._clearCarrier();
        this._shootBall(50 + (Math.random() - 0.5) * 8, ty, ev.type === "penalty" ? "shot" : "save");
        this.playSfx(ev.type === "penalty" ? "kick" : "save");
        this.setBanner(ev.type === "penalty" ? "❗ PEN" : "😮", "warn");
        this.setCaption(ev.type === "penalty" ? "PENALTY" : "PEN MISSED", "warn", 1600);
        setTimeout(() => this.setBanner(""), 1000);
        this._scheduleAftermath({
          flipPossession: ev.type === "pen_miss",
          delayMs: 900,
          toGk: ev.type === "pen_miss",
        });
        break;
      }

      case "corner": {
        const attHome = ev.teamId ? isHomeTeam(ev.teamId) : this.possession === "home";
        const side = attHome ? "home" : "away";
        const left = Math.random() < 0.5;
        const tx = left ? 5 : 95;
        const ty = attHome ? 7 : 93;
        this.possession = side;
        this.camMode = "box";
        this.camBoostUntil = performance.now() + 600;
        this._nudgeAttackShape(side, 0.5);
        this._nudgeDefendShape(side === "home" ? "away" : "home", { x: 50, y: attHome ? 12 : 88 });
        // 禁区内堆人（只改目标）
        for (const pl of this.players.filter((p) => p.team === side && p.pos !== "GK")) {
          if (Math.random() < 0.55) {
            pl.tx = clamp(28 + Math.random() * 44, 12, 88);
            pl.ty = clamp(attHome ? 12 + Math.random() * 16 : 88 - Math.random() * 16, 6, 94);
          }
        }
        this._shootBall(tx, ty, "pass");
        this.setCaption(ev.text || "CORNER", "info", 1200);
        this._scheduleAftermath({ flipPossession: false, delayMs: 1100, toGk: false });
        break;
      }

      case "card":
      case "red": {
        const foulHome = ev.teamId ? isHomeTeam(ev.teamId) : true;
        const pl = this.players.find((p) => p.id === ev.playerId);
        this.camMode = "ball";
        this.camBoostUntil = performance.now() + 500;
        if (pl) {
          pl.el.classList.add("highlight");
          this.highlightId = pl.id;
          this.flashUntil = performance.now() + 1400;
          this._setFocus([pl], 1500);
          this.ball.tx = pl.x;
          this.ball.ty = pl.y;
          this.showFlashCard({
            title: ev.type === "red" ? "红牌" : "黄牌",
            sub: ev.type === "red" ? "RED CARD" : "YELLOW",
            kind: "warn",
            player: pl.player,
            team: pl.team,
            ms: 2000,
          });
        }
        this.playSfx("card");
        this.setBanner(ev.type === "red" ? "🟥" : "🟨", "warn");
        this.setCaption(ev.type === "red" ? "RED CARD" : "YELLOW CARD", "warn", 1400);
        setTimeout(() => this.setBanner(""), 900);
        if (ev.type === "red" && pl) {
          pl.el.classList.add("sent-off");
          pl.tx = 50;
          pl.ty = foulHome ? 102 : -2;
        }
        this._scheduleAftermath({ flipPossession: true, delayMs: 1000, toGk: false });
        break;
      }

      case "injury": {
        const pl = this.players.find((p) => p.id === ev.playerId);
        this.camMode = "ball";
        this.camBoostUntil = performance.now() + 500;
        if (pl) {
          pl.el.classList.add("injured");
          this.highlightId = pl.id;
          this.flashUntil = performance.now() + 1500;
          this.ball.tx = pl.x;
          this.ball.ty = pl.y;
          this._setFocus([pl], 1500);
          this.showFlashCard({
            title: "受伤",
            sub: "INJURY",
            kind: "warn",
            player: pl.player,
            team: pl.team,
            ms: 2000,
          });
        }
        this.setBanner("🏥", "warn");
        this.setCaption(ev.text || "INJURY", "warn", 1400);
        setTimeout(() => this.setBanner(""), 900);
        this._scheduleAftermath({ flipPossession: false, delayMs: 1000, toGk: false });
        break;
      }

      case "sub": {
        const subSide = ev.teamId
          ? isHomeTeam(ev.teamId)
            ? "home"
            : "away"
          : this.possession;
        this.showSubFeedback(subSide, {
          outId: ev.outId,
          inId: ev.inId,
          text: ev.text,
          club: subSide === "home" ? this.home : this.away,
        });
        break;
      }

      case "ht":
        this.phase = "pause";
        this.camMode = "wide";
        this.aftermathUntil = 0;
        this._clearFocus();
        this.hideFlashCard();
        this.setBanner(ev.text || "HT", "info");
        this.setCaption(ev.text || "HALF-TIME", "info", 2000);
        this.playSfx("whistle");
        this.ball.tx = 50;
        this.ball.ty = 50;
        this.cam.tx = 0;
        this.cam.ty = 0;
        this.cam.tScale = 1;
        this._syncClickable();
        break;

      case "ft":
        this.phase = "pause";
        this.camMode = "wide";
        this.aftermathUntil = 0;
        this._clearFocus();
        this.hideFlashCard();
        this.setBanner(ev.text || "FT", "info");
        this.setCaption(ev.text || "FULL-TIME", "info", 2400);
        this.playSfx("whistle");
        this.ball.tx = 50;
        this.ball.ty = 50;
        this.cam.tx = 0;
        this.cam.ty = 0;
        this.cam.tScale = 1;
        this._syncClickable();
        break;

      case "tactics": {
        // 中场/赛中调整：场上可见压迫与队形变化
        const side = ev.teamId
          ? isHomeTeam(ev.teamId)
            ? "home"
            : "away"
          : this.possession;
        this.showTacticsFeedback(side, {
          style: ev.style,
          pressing: ev.pressing,
          tempo: ev.tempo,
          label: (ev.text || "").replace(/^📋\s*/, "") || undefined,
        });
        break;
      }

      case "coach": {
        const tip = (ev.text || "").replace(/^💬\s*/, "");
        this.setBanner("💬", "info");
        this.setCaption(tip || (document.documentElement.lang === "en" ? "Coach note" : "教练席"), "info", 2200);
        setTimeout(() => {
          if (this._built) this.setBanner("");
        }, 1000);
        break;
      }

      default:
        break;
    }
  }

  _pushAttack(team) {
    this.possession = team;
    this.camMode = "ball";
    this._setBlockShape(team, "attack");
    this._setBlockShape(team === "home" ? "away" : "home", "defend");
    const carriers = this.players.filter(
      (p) => p.team === team && p.pos !== "GK" && !p.el.classList.contains("sent-off")
    );
    carriers.sort((a, b) => {
      const da = a.pos === "ATT" ? 0 : a.pos === "MID" ? 1 : 2;
      const db = b.pos === "ATT" ? 0 : b.pos === "MID" ? 1 : 2;
      return da - db;
    });
    if (carriers[0] && !this._isBallInFlight()) {
      this._setCarrier(carriers[0], { stick: true });
      this._setFocus([carriers[0]], 900);
      this.actionTimer = 0.3;
    }
  }

  _resetShape() {
    this._clearCarrier();
    this._clearFocus();
    this.ballFlightUntil = 0;
    this.flight = null;
    this.ballState = "free";
    this.camMode = "wide";
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      pl.tx = pl.baseX + (Math.random() - 0.5) * 2;
      pl.ty = pl.baseY + (Math.random() - 0.5) * 2;
    }
  }

  /**
   * 抓取当前场面（球员/球/持球）供进球回看从同一帧接续
   * @returns {object|null}
   */
  captureSceneSnapshot() {
    if (!this._built) return null;
    return {
      ball: { x: this.ball.x, y: this.ball.y },
      possession: this.possession,
      carrierId: this.carrier?.id || null,
      lastCarrierId: this.lastCarrierId || null,
      players: this.players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        tx: p.tx,
        ty: p.ty,
      })),
    };
  }

  /**
   * 还原场面快照（赛后回看用；无快照时不调用）
   * @param {object|null} snap
   */
  restoreSceneSnapshot(snap) {
    if (!this._built || !snap?.players?.length) return false;
    const byId = new Map(snap.players.map((s) => [s.id, s]));
    for (const pl of this.players) {
      const s = byId.get(pl.id);
      if (!s) continue;
      pl.x = s.x;
      pl.y = s.y;
      pl.tx = s.tx ?? s.x;
      pl.ty = s.ty ?? s.y;
      this._applyPlayer(pl);
    }
    if (snap.ball) {
      this.ball.x = snap.ball.x;
      this.ball.y = snap.ball.y;
      this.ball.tx = snap.ball.x;
      this.ball.ty = snap.ball.y;
    }
    this.flight = null;
    this.ballFlightUntil = 0;
    this.ballState = "free";
    if (snap.possession) this.possession = snap.possession;
    this.lastCarrierId = snap.lastCarrierId || null;
    this._clearCarrier();
    if (snap.carrierId) {
      const car = this.players.find((p) => p.id === snap.carrierId);
      if (car) this._setCarrier(car, { stick: true });
    }
    this._applyBall();
    return true;
  }

  /**
   * 赛后无快照：轻摆到半场威胁区（不整队回中圈硬演）
   */
  _seedGoalRewatchPositions(team, attHome, scorer, assister) {
    const dir = this._attackDir(team);
    const seedX = 36 + Math.random() * 28;
    // 偏中前场，避免从中圈突然开打
    const seedY = attHome ? 32 + Math.random() * 14 : 68 - Math.random() * 14;
    if (assister && assister !== scorer) {
      assister.x = seedX;
      assister.y = seedY;
      assister.tx = assister.x;
      assister.ty = assister.y;
      this._applyPlayer(assister);
    }
    if (scorer) {
      scorer.x = clamp(seedX + (Math.random() - 0.5) * 14, 14, 86);
      scorer.y = clamp(seedY + dir * 10, 12, 88);
      scorer.tx = scorer.x;
      scorer.ty = scorer.y;
      this._applyPlayer(scorer);
    }
    const bx = assister && assister !== scorer ? assister.x : scorer?.x ?? 50;
    const by = assister && assister !== scorer ? assister.y : scorer?.y ?? 50;
    this.ball.x = bx;
    this.ball.y = by;
    this.ball.tx = bx;
    this.ball.ty = by;
    this._applyBall();
    // 队友轻前压，不瞬移整队
    this._nudgeAttackShape(team, 0.35);
    this._nudgeDefendShape(team === "home" ? "away" : "home", {
      x: bx,
      y: by,
    });
  }

  /**
   * 角球摆位：球钉角旗 + 主罚人 + 双方堆禁区 + 角球徽章
   * sim 路径 / 直播事件共用（旧版只闪 🚩 导致「从没见过角球画面」）
   */
  _stageCornerSetPiece(ev = {}, fixture = null) {
    if (!this._built) return;
    const homeId = fixture?.home || this.home?.id;
    const attHome =
      ev.teamId != null
        ? ev.teamId === homeId
        : this.possession === "home";
    const team = attHome ? "home" : "away";
    // 角旗：优先球当前半边，否则随机
    const left =
      Number.isFinite(ev.x) ? ev.x < 50 : (this.ball?.x ?? 50) < 50 || Math.random() < 0.5;
    const cx = left ? 4 : 96;
    const cy = attHome ? 3.5 : 96.5;
    const boxY = attHome ? 14 : 86;

    // 主罚人：事件球员 or 最近边路
    let taker =
      (ev.playerId && this.players.find((p) => p.id === ev.playerId)) ||
      null;
    if (!taker || taker.team !== team || taker.pos === "GK") {
      const cands = this.players.filter(
        (p) =>
          p.team === team &&
          p.pos !== "GK" &&
          !p.el.classList.contains("sent-off")
      );
      cands.sort(
        (a, b) =>
          Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)
      );
      taker = cands[0] || null;
    }

    // 进攻：约 5 人进禁区，其余弧顶；防守 5 人盯人——别 20 人糊成一团
    let attPacked = 0;
    let defPacked = 0;
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      if (pl.pos === "GK" || pl.role === "GK") {
        if (pl.team !== team) {
          pl.x = clamp(50 + (Math.random() - 0.5) * 3, 46, 54);
          pl.y = attHome ? 5 : 95;
        } else {
          pl.x = pl.baseX ?? pl.x;
          pl.y = pl.baseY ?? pl.y;
        }
        pl.tx = pl.x;
        pl.ty = pl.y;
        this._applyPlayer(pl);
        continue;
      }
      if (pl === taker) continue;
      if (pl.team === team) {
        const pack = attPacked < 5;
        if (pack) attPacked++;
        const ang = (attPacked / 6) * Math.PI - Math.PI / 2;
        pl.x = clamp(
          pack
            ? 50 + Math.cos(ang) * (10 + (attPacked % 3) * 4) + (left ? -2 : 2)
            : 40 + Math.random() * 20,
          18,
          82
        );
        pl.y = clamp(
          pack
            ? boxY + Math.sin(ang) * 6 + (Math.random() - 0.5) * 3
            : boxY + (attHome ? 12 : -12),
          8,
          92
        );
        if (pack) pl.el.classList.add("highlight");
      } else {
        const pack = defPacked < 5;
        if (pack) defPacked++;
        pl.x = clamp(
          pack ? 42 + defPacked * 3 + (Math.random() - 0.5) * 4 : pl.baseX ?? 50,
          22,
          78
        );
        pl.y = clamp(
          pack ? boxY + (Math.random() - 0.5) * 5 : pl.baseY ?? 50,
          8,
          92
        );
      }
      pl.tx = pl.x;
      pl.ty = pl.y;
      this._applyPlayer(pl);
    }

    // 主罚人最后钉在角旗（必须在堆人之后）
    if (taker) {
      taker.x = cx;
      taker.y = cy + (attHome ? 1.5 : -1.5);
      taker.tx = taker.x;
      taker.ty = taker.y;
      taker.heading = Math.atan2(boxY - taker.y, 50 - taker.x);
      taker.el.classList.add("highlight", "has-ball");
      this.carrier = taker;
      this.lastCarrierId = taker.id;
      this._setFocus([taker], 2400);
      this._applyPlayer(taker);
    } else {
      this.carrier = null;
    }

    // 球钉在角旗
    this.ball.x = cx;
    this.ball.y = cy;
    this.ball.z = 0;
    this.ball.tx = cx;
    this.ball.ty = cy;
    this.ballState = "held";
    this.possession = team;
    this._ballTrail = [];
    this._applyBall();
    this._visualUnstack(2);

    this.camMode = "box";
    this.camBoostUntil = performance.now() + 2400;
    this.phase = "play";

    // 角球徽章
    if (this.replayBadgeEl) {
      this.replayBadgeEl.textContent =
        (typeof document !== "undefined" && document.documentElement?.lang === "en")
          ? "🚩 CORNER"
          : "🚩 角球";
      this.replayBadgeEl.classList.remove("hidden");
      clearTimeout(this._cornerBadgeTimer);
      this._cornerBadgeTimer = setTimeout(() => {
        if (this.replayBadgeEl?.textContent?.includes("角球") ||
            this.replayBadgeEl?.textContent?.includes("CORNER")) {
          this.replayBadgeEl.classList.add("hidden");
        }
      }, 2600);
    }
    this.fieldEl?.classList.add("mp-corner-active");
    clearTimeout(this._cornerFieldTimer);
    this._cornerFieldTimer = setTimeout(() => {
      this.fieldEl?.classList.remove("mp-corner-active");
    }, 2800);
  }

  /**
   * 进球高光叙事（约 3s）：助攻起脚 → 接球 → 射门弧 → 入网
   * 解决「比分对了但画面上球跟人没关系」
   */
  _beginGoalBeat(ev, { attHome = true, lang = "zh" } = {}) {
    if (!this._built) return;
    const team = attHome ? "home" : "away";
    const scorer =
      this.players.find((p) => p.id === ev?.playerId) ||
      this.players.find((p) => p.team === team && (p.pos === "ATT" || p.role === "ATT")) ||
      this.players.find((p) => p.team === team && p.pos !== "GK");
    if (!scorer) return;
    let assister =
      (ev?.assistId && this.players.find((p) => p.id === ev.assistId && p !== scorer)) ||
      null;
    if (!assister) {
      // 找同队最近的非门将当助攻视觉替身
      assister = this.players
        .filter(
          (p) =>
            p.team === team &&
            p !== scorer &&
            p.pos !== "GK" &&
            !p.el.classList.contains("sent-off")
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - scorer.x, a.y - scorer.y) -
            Math.hypot(b.x - scorer.x, b.y - scorer.y)
        )[0] || null;
    }
    const mouth = this._goalMouth(attHome, { deep: true });
    // 组织点：进攻方向禁区前沿
    const boxY = attHome ? 18 : 82;
    const finishY = attHome ? 12 : 88;
    const assistY = attHome ? 26 : 74;
    // 摆位：射手在门前，助攻在身后侧
    scorer.x = clamp(mouth.gx + (Math.random() - 0.5) * 6, 38, 62);
    scorer.y = finishY;
    scorer.tx = scorer.x;
    scorer.ty = scorer.y;
    scorer.heading = attHome ? -Math.PI / 2 : Math.PI / 2;
    if (assister) {
      assister.x = clamp(scorer.x + (assister.x < 50 ? -8 : 8), 28, 72);
      assister.y = assistY;
      assister.tx = assister.x;
      assister.ty = assister.y;
      assister.heading = Math.atan2(scorer.y - assister.y, scorer.x - assister.x);
    }
    // 其余人：同队前压半步，对方回防，避免糊在射门点
    for (const pl of this.players) {
      if (pl === scorer || pl === assister || pl.el.classList.contains("sent-off")) continue;
      if (pl.pos === "GK" || pl.role === "GK") continue;
      if (pl.team === team) {
        pl.x = clamp(lerp(pl.x, scorer.x, 0.25) + (Math.random() - 0.5) * 6, 8, 92);
        pl.y = clamp(lerp(pl.y, boxY, 0.35) + (Math.random() - 0.5) * 5, 8, 92);
      } else {
        pl.x = clamp(pl.x * 0.7 + 50 * 0.3 + (Math.random() - 0.5) * 4, 10, 90);
        pl.y = clamp(
          attHome
            ? Math.max(pl.y, 28) * 0.6 + 40 * 0.4
            : Math.min(pl.y, 72) * 0.6 + 60 * 0.4,
          12,
          88
        );
      }
      pl.tx = pl.x;
      pl.ty = pl.y;
      this._applyPlayer(pl);
    }
    this._visualUnstack(2);
    // 球从助攻脚下开始
    const start = assister
      ? { x: assister.x, y: assister.y }
      : { x: scorer.x, y: scorer.y + (attHome ? 6 : -6) };
    this.ball.x = start.x;
    this.ball.y = start.y;
    this.ball.z = 0;
    this.ball.tx = start.x;
    this.ball.ty = start.y;
    this._ballTrail = [];
    this.ballState = "flight";
    this.carrier = null;
    for (const pl of this.players) pl.el.classList.remove("has-ball");
    if (assister) {
      assister.el.classList.add("highlight", "has-ball");
      this._setFocus([assister, scorer], 3200);
    } else {
      scorer.el.classList.add("highlight", "scorer");
      this._setFocus([scorer], 3200);
    }
    this._applyPlayer(scorer);
    if (assister) this._applyPlayer(assister);
    this._applyBall();
    this.phase = "goal";
    this.camMode = "follow";
    this.camBoostUntil = performance.now() + 3200;
    this._goalBeat = {
      t: 0,
      attHome,
      team,
      scorerId: scorer.id,
      assistId: assister?.id || null,
      start,
      mid: { x: scorer.x, y: scorer.y },
      mouth,
      lang,
      done: false,
    };
  }

  /** 每帧推进进球叙事；返回 true 表示仍在播 */
  _tickGoalBeat(dt) {
    const g = this._goalBeat;
    if (!g || g.done) return false;
    g.t += Math.max(0.008, dt);
    const scorer = this.players.find((p) => p.id === g.scorerId);
    const assister = g.assistId
      ? this.players.find((p) => p.id === g.assistId)
      : null;
    const en = g.lang === "en";

    // 0–0.85s 助攻传球
    if (g.t < 0.85) {
      const u = clamp(g.t / 0.85, 0, 1);
      const e = u * u * (3 - 2 * u);
      this.ball.x = lerp(g.start.x, g.mid.x, e);
      this.ball.y = lerp(g.start.y, g.mid.y, e);
      this.ball.z = Math.sin(u * Math.PI) * 1.8;
      this.ballState = "flight";
      this.carrier = null;
      for (const pl of this.players) pl.el.classList.remove("has-ball");
      if (assister) assister.el.classList.add("highlight");
      if (scorer) scorer.el.classList.add("highlight");
      if (g.t > 0.05 && g.t < 0.2) {
        this.setCaption?.(en ? "Assist…" : "助攻传球…", "shot", 0);
      }
    }
    // 0.85–1.25s 接球停一下
    else if (g.t < 1.25) {
      if (scorer) {
        this.ball.x = scorer.x + Math.cos(scorer.heading || 0) * 1.1;
        this.ball.y = scorer.y + Math.sin(scorer.heading || 0) * 1.1;
        this.ball.z = 0;
        this.carrier = scorer;
        for (const pl of this.players) pl.el.classList.remove("has-ball");
        scorer.el.classList.add("has-ball", "highlight", "scorer");
        this._setFocus([scorer], 2000);
      }
      this.ballState = "held";
      if (g.t < 0.95) {
        const nm = scorer?.name || "";
        this.setCaption?.(
          nm ? (en ? `${nm} shoots!` : `${nm} 射门!`) : en ? "Shot!" : "射门!",
          "shot",
          0
        );
      }
    }
    // 1.25–2.35s 射门入网
    else if (g.t < 2.35) {
      const u = clamp((g.t - 1.25) / 1.1, 0, 1);
      const e = u * u * (3 - 2 * u);
      const from = g.mid;
      this.ball.x = lerp(from.x, g.mouth.gx, e);
      this.ball.y = lerp(from.y, g.mouth.gy, e);
      this.ball.z = Math.sin(u * Math.PI) * (2.2 + (1 - u) * 1.5);
      this.ballState = "shot";
      this.carrier = null;
      for (const pl of this.players) {
        pl.el.classList.remove("has-ball");
        if (pl === scorer) pl.el.classList.add("highlight", "scorer");
      }
      if (!g._net && u > 0.92) {
        g._net = true;
        this._goalNetEffect(g.mouth.gx, g.mouth.gy, g.attHome);
        this.setBanner?.(en ? "⚽ GOAL" : "⚽ 进球", "goal");
      }
    }
    // 2.35s+ 定格球在网内 → 切庆祝
    else {
      this.ball.x = g.mouth.gx;
      this.ball.y = g.mouth.gy;
      this.ball.z = 0.2;
      this.ballState = "free";
      this.carrier = null;
      for (const pl of this.players) pl.el.classList.remove("has-ball");
      if (!g._cele) {
        g._cele = true;
        if (scorer) this._beginVisualCelebrate(scorer, { playerId: scorer.id });
      }
      // 叙事结束，庆祝继续由 _celebrate 接管
      if (g.t > 2.55) {
        g.done = true;
        this._goalBeat = null;
      }
    }
    this.ball.tx = this.ball.x;
    this.ball.ty = this.ball.y;
    this._pushBallTrail();
    this._applyBall();
    // 射门段加强橙黄轨迹
    if (g.t >= 1.25 && g.t < 2.4) this.ballState = "shot";
    return !g.done;
  }

  /**
   * 进球庆祝：表现层聚拢（hold 冻结时间轴时也跑；与 sim 庆祝帧叠加更热闹）
   * @param {object} scorer
   * @param {object} [ev]
   */
  _beginVisualCelebrate(scorer, ev = null) {
    if (!scorer || !this._built) return;
    const team = scorer.team;
    const attHome = team === "home";
    const cornerX = (scorer.x ?? 50) < 50 ? 10 : 90;
    this._celebrate = {
      until: performance.now() + 5200,
      team,
      scorerId: scorer.id,
      cornerX,
      attHome,
    };
    // 只设置移动目标，不改写当前位置。
    scorer.tx = cornerX;
    scorer.ty = attHome ? 8 : 92;
    scorer.el.classList.add("highlight", "scorer");
    // 仅四名近端队友自然围拢；加上射手一共最多五人。
    const mates = this.players
      .filter(
        (p) =>
          p.team === team &&
          p !== scorer &&
          p.pos !== "GK" &&
          !p.el.classList.contains("sent-off")
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - scorer.x, a.y - scorer.y) -
          Math.hypot(b.x - scorer.x, b.y - scorer.y)
      );
    mates.forEach((pl, i) => {
      if (i < 4) {
        const ang = (i / 4) * Math.PI * 2 + 0.4;
        const ring = 3.2 + (i % 3) * 1.4;
        const tx = clamp(
          scorer.x + Math.cos(ang) * ring + (cornerX - 50) * 0.12,
          6,
          94
        );
        const ty = clamp(
          scorer.y + Math.sin(ang) * ring * 0.85 + (attHome ? -3 : 3),
          5,
          95
        );
        pl.tx = tx;
        pl.ty = ty;
        pl.el.classList.add("highlight");
      } else {
        pl.tx = pl.x;
        pl.ty = pl.y;
      }
      this._applyPlayer(pl);
    });
    this._applyPlayer(scorer);
    // 失球方自然后撤，也不在事件帧内改写坐标。
    for (const pl of this.players) {
      if (pl.team === team || pl.pos === "GK") continue;
      pl.tx = clamp(pl.baseX * 0.5 + 50 * 0.5, 10, 90);
      pl.ty = clamp(pl.baseY * 0.55 + 50 * 0.45, 14, 86);
      this._applyPlayer(pl);
    }
    this._setFocus(
      [scorer, ...mates.slice(0, 4)].filter(Boolean),
      4500
    );
    const nm = scorer.name || scorer.player?.name || "";
    if (nm) {
      const en =
        (typeof document !== "undefined" && document.documentElement?.lang === "en") ||
        false;
      this.setCaption?.(
        en ? `${nm} celebrates!` : `${nm} 庆祝进球！`,
        "goal",
        0
      );
    }
  }

  /** hold / 本地 tick：把球员朝庆祝目标挪过去 */
  _tickVisualCelebrate(dt) {
    const c = this._celebrate;
    if (!c || performance.now() > c.until) {
      this._celebrate = null;
      return;
    }
    const scorer = this.players.find((p) => p.id === c.scorerId);
    // 以单位/秒限制步长，避免远距离目标在首帧形成视觉跳跃。
    for (const pl of this.players) {
      if (pl.el.classList.contains("sent-off")) continue;
      const tx = pl.tx ?? pl.x;
      const ty = pl.ty ?? pl.y;
      const speed =
        scorer && pl.id === scorer.id
          ? 5.8
          : pl.team === c.team
            ? 4.6
            : 2.2;
      const dx = tx - pl.x;
      const dy = ty - pl.y;
      const distance = Math.hypot(dx, dy);
      const step = Math.min(distance, speed * Math.max(0.016, dt));
      if (distance > 1e-6) {
        pl.x += (dx / distance) * step;
        pl.y += (dy / distance) * step;
      }
      if (Math.hypot(tx - pl.x, ty - pl.y) > 0.4) {
        pl.heading = Math.atan2(ty - pl.y, tx - pl.x);
      }
      this._applyPlayer(pl);
    }
    // 球钉在进攻球门网口
    if (c.attHome) {
      this.ball.y = Math.min(this.ball.y, 3.5);
    } else {
      this.ball.y = Math.max(this.ball.y, 96.5);
    }
    this.ball.x = clamp(this.ball.x, 42, 58);
    this.ball.z = 0.15;
    this.ball.tx = this.ball.x;
    this.ball.ty = this.ball.y;
    this._applyBall();
    // 射手目标随时间微调（角旗晃动感）
    if (scorer) {
      scorer.tx = c.cornerX + Math.sin(performance.now() / 220) * 2;
      scorer.ty = (c.attHome ? 7 : 93) + Math.cos(performance.now() / 280) * 1.2;
      // 近端队友持续追射手
      let hi = 0;
      for (const pl of this.players) {
        if (pl.team !== c.team || pl === scorer || pl.pos === "GK") continue;
        if (!pl.el.classList.contains("highlight")) continue;
        const ang = (hi++ / 7) * Math.PI * 2 + performance.now() / 900;
        pl.tx = clamp(scorer.x + Math.cos(ang) * 4.2, 6, 94);
        pl.ty = clamp(scorer.y + Math.sin(ang) * 3.6, 5, 95);
      }
    }
    this._visualUnstack(1);
  }

  /** 进球后中圈开球：失球方门将拿球再轻传，少硬切 */
  async _restartAfterGoal(attHome, { wait, lang = "zh" } = {}) {
    this.fieldEl?.classList.remove("mp-replay", "mp-replay-slow");
    this.replayBadgeEl?.classList.add("hidden");
    this.phase = "play";
    this._celebrate = null;
    for (const pl of this.players) {
      pl.el.classList.remove("scorer", "highlight");
    }
    this.camMode = "wide";
    this.camBoostUntil = performance.now() + 600;
    this._clearFocus();
    this.flight = null;
    this.ballFlightUntil = 0;
    this.scriptLock = false;
    this.attackPhase = null;

    // 失球方开球
    const kickSide = attHome ? "away" : "home";
    this.possession = kickSide;
    this._resetShape();
    this._updatePossessionChrome();
    // 球先到中圈，再交给门将附近后卫
    this.ball.x = 50;
    this.ball.y = 50;
    this.ball.tx = 50;
    this.ball.ty = 50;
    this.ballState = "free";
    this._clearCarrier();
    this._applyBall();
    this.setBanner(lang === "en" ? "Kick-off" : "中圈开球", "info");
    this.setCaption(lang === "en" ? "Restart…" : "开球…", "info", 900);
    if (!this._rec?.active) this.startRecording();
    if (typeof wait === "function") await wait(380);

    const gk = this.players.find(
      (p) => p.team === kickSide && p.pos === "GK" && !p.el.classList.contains("sent-off")
    );
    const def = this.players
      .filter(
        (p) =>
          p.team === kickSide &&
          p.pos !== "GK" &&
          !p.el.classList.contains("sent-off")
      )
      .sort(
        (a, b) =>
          Math.hypot(a.x - 50, a.y - 50) - Math.hypot(b.x - 50, b.y - 50)
      )[0];
    const taker = def || gk;
    if (taker) {
      this._beginFlight({
        x: taker.x,
        y: taker.y,
        receiverId: taker.id,
        kind: "pass",
        ms: 320,
      });
      if (typeof wait === "function") await wait(340);
      if (this.carrier !== taker) this._setCarrier(taker, { stick: true });
    }
    this.actionTimer = 0.35;
    this.passTimer = 0.4;
    this.setBanner("");
    this.setCaption("");
    this._syncClickable();
    // 短收尾，避免立刻乱踢
    this.aftermathUntil = performance.now() + 700;
  }

  /** 球门线内侧坐标（主队攻上 / 客队攻下）——要看得见球进网 */
  _goalMouth(attHome, { deep = true } = {}) {
    // 俯视：主队球门在 y≈0 端，客队在 y≈100 端；进网要比球门线更深一点
    const gx = 50 + (Math.random() - 0.5) * (deep ? 7 : 10);
    const gy = attHome
      ? deep
        ? 1.2 + Math.random() * 1.6
        : 4 + Math.random() * 3
      : deep
        ? 98.2 - Math.random() * 1.6
        : 96 - Math.random() * 3;
    return { gx: clamp(gx, 42, 58), gy: clamp(gy, 0.6, 99.4) };
  }

  /** 进球入网特效：球门网撞击 + 网纹 + 球门区域轻闪 */
  _goalNetEffect(gx, gy, attHome) {
    this._burst(gx, gy, "goal");
    // 永久球门口“被撞凹”再回弹
    const mouthSel = attHome ? ".mp-goal-mouth.top" : ".mp-goal-mouth.bot";
    const mouth = this.fieldEl?.querySelector(mouthSel);
    if (mouth) {
      mouth.classList.remove("mp-goal-mouth-hit");
      // 强制重启动画
      void mouth.offsetWidth;
      mouth.classList.add("mp-goal-mouth-hit");
      setTimeout(() => mouth.classList.remove("mp-goal-mouth-hit"), 1000);
    }
    // 球门端轻闪；CSS 已限制范围和透明度。
    if (this.fieldEl) {
      this.fieldEl.style.setProperty("--goal-flash-y", attHome ? "6%" : "94%");
      this.fieldEl.classList.remove("mp-goal-flash");
      void this.fieldEl.offsetWidth;
      this.fieldEl.classList.add("mp-goal-flash");
      setTimeout(() => this.fieldEl?.classList.remove("mp-goal-flash"), 350);
    }
    if (!this.fxLayer) return;
    // 大块球网涟漪（比旧版更大更久）
    const net = document.createElement("div");
    net.className = `mp-goal-net ${attHome ? "top" : "bottom"}`;
    net.style.left = `${gx}%`;
    net.style.top = `${gy}%`;
    this.fxLayer.appendChild(net);
    setTimeout(() => net.remove(), 1200);
    // 第二层稍大、稍晚，增强撞击层次
    const net2 = document.createElement("div");
    net2.className = `mp-goal-net ${attHome ? "top" : "bottom"}`;
    net2.style.left = `${gx}%`;
    net2.style.top = `${gy}%`;
    net2.style.width = "68px";
    net2.style.height = "40px";
    net2.style.margin = "-12px 0 0 -34px";
    net2.style.opacity = "0.85";
    this.fxLayer.appendChild(net2);
    setTimeout(() => net2.remove(), 1300);
    // 入网光环
    const ring = document.createElement("div");
    ring.className = "mp-goal-ring";
    ring.style.left = `${gx}%`;
    ring.style.top = `${gy}%`;
    this.fxLayer.appendChild(ring);
    setTimeout(() => ring.remove(), 1000);
    // 球本身闪一下
    this.ball.el?.classList.add("mp-ball-goal");
    setTimeout(() => this.ball.el?.classList.remove("mp-ball-goal"), 1000);
  }

  _playGoalShot(ev, snap, fixture, { celebrateMs = 2800, skipReset = false } = {}) {
    const homeId = fixture?.home || this.home?.id;
    const attHome = ev.teamId === homeId;
    const team = attHome ? "home" : "away";
    this.phase = "goal";
    this.hidePlayerCard();
    this.possession = team;
    this.camMode = "box";
    const { gx, gy } = this._goalMouth(attHome, { deep: true });
    const scorer =
      this.players.find((p) => p.id === ev.playerId) ||
      (this.carrier && this.carrier.team === team ? this.carrier : null) ||
      this._nearestOutfield(team, this.ball.x, this.ball.y);
    const assister =
      (ev.assistId && this.players.find((p) => p.id === ev.assistId)) ||
      (this.lastCarrierId && this.lastCarrierId !== scorer?.id
        ? this.players.find((p) => p.id === this.lastCarrierId)
        : null);

    // 从当前位置轻推进禁区，不瞬移
    if (scorer) {
      scorer.tx = clamp(lerp(scorer.x, gx + (Math.random() - 0.5) * 6, 0.45), 18, 82);
      scorer.ty = clamp(lerp(scorer.y, attHome ? 16 : 84, 0.4), 8, 92);
      scorer.x = lerp(scorer.x, scorer.tx, 0.15);
      scorer.y = lerp(scorer.y, scorer.ty, 0.15);
      scorer.el.classList.add("highlight", "scorer");
      this.highlightId = scorer.id;
      this.flashUntil = performance.now() + Math.max(2200, celebrateMs);
      this._setTouch(scorer, 1800);
      if (assister && assister.team === scorer.team) this._recordPass(assister, scorer);
      this.lastCarrierId = scorer.id;
      this.ball.x = scorer.x;
      this.ball.y = scorer.y;
      this._markHeat(scorer.x, scorer.y, scorer.team, 3);
    }
    this._clearCarrier();
    this._shootBall(gx, gy, "goal");
    this.ball.tx = gx;
    this.ball.ty = gy;
    this._markHeat(gx, gy, team, 4);
    if (scorer) this._beginVisualCelebrate(scorer, ev);
    setTimeout(() => {
      if (!this._built) return;
      this.ball.x = gx;
      this.ball.y = gy;
      this.ball.tx = gx;
      this.ball.ty = gy;
      this._applyBall();
      this._goalNetEffect(gx, gy, attHome);
    }, 360);
    this._refreshHeatVisual();
    const scoreLine =
      snap && snap.homeGoals != null
        ? `⚽ ${snap.homeGoals} - ${snap.awayGoals}`
        : "⚽ GOAL";
    this.setBanner(scoreLine, "goal");
    this.setCaption?.(scoreLine, "goal", 1800);
    this._syncClickable();

    // 庆祝段：插值跑几帧再复位
    if (!skipReset) {
      const t0 = performance.now();
      const celeIv = setInterval(() => {
        if (!this._built || performance.now() - t0 > celebrateMs - 200) {
          clearInterval(celeIv);
          return;
        }
        this._tickVisualCelebrate(0.08);
        this._drawCanvas?.();
      }, 80);
      setTimeout(() => {
        clearInterval(celeIv);
        if (!this._built) return;
        this._celebrate = null;
        this.phase = "play";
        this._resetShape();
        this.ball.tx = 50;
        this.ball.ty = 50;
        this.ballFlightUntil = 0;
        this.flight = null;
        this.ballState = "free";
        this.possession = attHome ? "away" : "home";
        this._clearCarrier();
        this.actionTimer = 0.2;
        this.setBanner("");
        this.setCaption?.("");
        this._syncClickable();
      }, celebrateMs);
    }
    return { attHome, scorer, assister, gx, gy };
  }

  /**
   * 进球高光：从「当前场面」连续推进 → 射门入网 → 庆祝 → 开球
   * 直播 / 赛后回看共用。
   * opts.scene：直播进球前抓取的场面；回看优先还原，避免中圈重演。
   */
  async playGoalHighlight(ev, snap, fixture, opts = {}) {
    if (!this._built || !ev) return;
    const speed = Math.max(0.25, Number(opts.speed) || 1);
    const lang = opts.lang || "zh";
    const sleepFn = typeof opts.sleepFn === "function" ? opts.sleepFn : sleep;
    const homeId = fixture?.home || this.home?.id;
    const attHome = ev.teamId === homeId;
    const team = attHome ? "home" : "away";
    const dir = this._attackDir(team);
    const isRewatch = !!opts.rewatch;
    const scene = opts.scene || null;

    // 回看：优先还原进球瞬间场面
    let restored = false;
    if (isRewatch && scene) {
      restored = this.restoreSceneSnapshot(scene);
    }

    const prevCarrier = this.carrier;
    let ballX = this.ball.x;
    let ballY = this.ball.y;

    this.phase = "goal";
    this.scriptLock = false;
    this.hidePlayerCard();
    this.flight = null;
    this.ballFlightUntil = 0;
    if (this.ballState === "shot") this.ballState = "free";
    this.possession = team;
    this.fieldEl?.classList.add("mp-replay");
    this.fieldEl?.classList.toggle("mp-replay-slow", !!isRewatch);
    // 停掉进行中的攻势段落，避免高光被 tick 抢控球
    this.attackPhase = null;
    this.aftermathUntil = 0;
    this._updatePossessionChrome();

    const scorer =
      this.players.find((p) => p.id === ev.playerId) ||
      (prevCarrier && prevCarrier.team === team ? prevCarrier : null) ||
      this._nearestOutfield(team, ballX, ballY) ||
      this.players.find((p) => p.team === team && p.pos === "ATT") ||
      this.players.find((p) => p.team === team && p.pos !== "GK");

    let assister = ev.assistId ? this.players.find((p) => p.id === ev.assistId) : null;
    if (!assister || assister === scorer) {
      if (prevCarrier && prevCarrier !== scorer && prevCarrier.team === team) {
        assister = prevCarrier;
      } else if (this.lastCarrierId && this.lastCarrierId !== scorer?.id) {
        const prev = this.players.find((p) => p.id === this.lastCarrierId);
        if (prev && prev.team === team) assister = prev;
      }
    }
    if (!assister || assister === scorer) {
      const mates = this.players.filter(
        (p) =>
          p.team === team &&
          p !== scorer &&
          p.pos !== "GK" &&
          !p.el.classList.contains("sent-off")
      );
      mates.sort(
        (a, b) =>
          Math.hypot(a.x - ballX, a.y - ballY) - Math.hypot(b.x - ballX, b.y - ballY)
      );
      assister = mates[0] || null;
    }

    // 赛后无场面快照：轻摆威胁区（旧档 / 战报回看）
    if (isRewatch && !restored && scorer) {
      this._seedGoalRewatchPositions(team, attHome, scorer, assister);
      ballX = this.ball.x;
      ballY = this.ball.y;
    }

    // 回看明显更慢；直播进球高光也略拉长
    const basePace = Math.max(0.55, Math.min(1.35, 1 / Math.max(0.5, speed)));
    const pace = isRewatch ? basePace * 1.55 : basePace * 1.12;
    const wait = (ms) => sleepFn(Math.max(55, ms * pace));
    this.replayBadgeEl?.classList.toggle("hidden", !isRewatch);
    if (isRewatch && this.replayBadgeEl) {
      this.replayBadgeEl.textContent =
        lang === "en" ? "▶ REPLAY · SLOW" : "▶ 进球回放 · 慢镜";
    }
    const boxY = attHome ? 18 : 82;
    const { gx, gy } = this._goalMouth(attHome, { deep: true });

    // 距球门越近，组织越短（禁区内直接射，中场才完整组织）
    const goalDist = Math.hypot(ballX - gx, ballY - gy);
    /** @type {'box'|'final'|'build'} */
    let depth = "build";
    if (goalDist < 22 || (attHome ? ballY < 28 : ballY > 72)) depth = "box";
    else if (goalDist < 40 || (attHome ? ballY < 42 : ballY > 58)) depth = "final";

    // 有助攻：回放/高光强制走出「助攻传球 → 射门」，不直接禁区终结跳过传球
    const wantAssist =
      !!(assister && scorer && assister !== scorer) &&
      (isRewatch || !!ev.assistId || depth !== "box");
    if (wantAssist && depth === "box") depth = "final";

    this.camMode = depth === "box" && !wantAssist ? "box" : "ball";
    this.camBoostUntil = performance.now() + 900;
    const assistHint =
      assister && assister !== scorer
        ? lang === "en"
          ? ` · A: ${assister.name || ""}`
          : ` · 助攻 ${assister.name || ""}`
        : "";
    this.setBanner(
      isRewatch
        ? lang === "en"
          ? "▶ REPLAY"
          : "▶ 进球回放"
        : lang === "en"
          ? "⚽ GOAL"
          : "⚽ 进球",
      isRewatch ? "replay" : "goal"
    );
    const capLive =
      wantAssist
        ? lang === "en"
          ? "Assist…"
          : "助攻传球…"
        : depth === "box"
          ? lang === "en"
            ? "Finish!"
            : "禁区终结！"
          : depth === "final"
            ? lang === "en"
              ? "Final third…"
              : "最后一传…"
            : lang === "en"
              ? "Build-up…"
              : "组织进攻…";
    this.setCaption(
      isRewatch
        ? (lang === "en" ? "GOAL REPLAY" : "进球回放") + assistHint
        : capLive,
      isRewatch ? "replay" : "info",
      0
    );

    // 只轻推队形，不整队瞬移
    this._nudgeAttackShape(team, depth === "box" ? 0.22 : 0.4);
    this._nudgeDefendShape(
      team === "home" ? "away" : "home",
      prevCarrier || { x: ballX, y: ballY }
    );

    // —— 1) 从当前球权接组织者 ——
    let organizer = null;
    if (prevCarrier && prevCarrier.team === team && prevCarrier !== scorer) {
      organizer = prevCarrier;
    } else if (assister && assister !== scorer) {
      organizer = assister;
    } else {
      organizer = this._nearestOutfield(team, ballX, ballY);
      if (organizer === scorer) {
        const other = this.players
          .filter(
            (p) =>
              p.team === team &&
              p !== scorer &&
              p.pos !== "GK" &&
              !p.el.classList.contains("sent-off")
          )
          .sort(
            (a, b) =>
              Math.hypot(a.x - ballX, a.y - ballY) - Math.hypot(b.x - ballX, b.y - ballY)
          )[0];
        organizer = other || scorer;
      }
    }
    // 需要助攻戏：组织者优先用助攻者，绝不直接跳到禁区终结
    if (wantAssist && assister) {
      organizer = assister;
    } else if (depth === "box" && scorer && !wantAssist) {
      // 已在禁区且无助攻：射手本人持球终结
      organizer = scorer;
    }
    if (!assister && organizer && organizer !== scorer) assister = organizer;

    // 回放/有助攻：把助攻者摆到稍身后持球位，射手前插要球（明显看出传球）
    if (wantAssist && assister && scorer) {
      const midX = clamp((assister.x + scorer.x) / 2, 18, 82);
      assister.x = clamp(midX + (Math.random() - 0.5) * 6, 16, 84);
      assister.y = clamp(
        attHome ? Math.max(assister.y, boxY + 14) : Math.min(assister.y, boxY - 14),
        12,
        88
      );
      assister.tx = assister.x;
      assister.ty = assister.y;
      this._applyPlayer(assister);
      scorer.x = clamp(midX + (Math.random() - 0.5) * 10, 18, 82);
      scorer.y = clamp(lerp(scorer.y, boxY, 0.45), 10, 90);
      scorer.tx = scorer.x;
      scorer.ty = scorer.y;
      this._applyPlayer(scorer);
      this.ball.x = assister.x;
      this.ball.y = assister.y;
      this.ball.tx = assister.x;
      this.ball.ty = assister.y;
      this._applyBall();
      this._setCarrier(assister, { stick: true });
      this._setTouch(assister, 1800);
      assister.el.classList.add("highlight");
      this.setCaption(
        lang === "en"
          ? `${assister.name || "Assist"} looks up…`
          : `${assister.name || "助攻者"} 抬头找人…`,
        "info",
        0
      );
      await wait(isRewatch ? 520 : 380);
    } else if (organizer) {
      const dist = Math.hypot(organizer.x - this.ball.x, organizer.y - this.ball.y);
      const alreadyHeld =
        prevCarrier === organizer &&
        (this.ballState === "held" || dist < 4);
      if (dist > 5 && !alreadyHeld) {
        this._beginFlight({
          x: organizer.x,
          y: organizer.y,
          receiverId: organizer.id,
          kind: "pass",
          ms: Math.round(240 / Math.min(speed, 1.6)),
        });
        this._addTrail(this.ball.x, this.ball.y, organizer.x, organizer.y, "pass", 0.3);
        await wait(depth === "box" ? 180 : 280);
      }
      this._setCarrier(organizer, { stick: true });
      this._setTouch(organizer, 1600);
    }

    if (scorer) {
      scorer.el.classList.add("highlight");
      if (depth !== "box" || wantAssist) {
        scorer.tx = clamp(scorer.x + (Math.random() - 0.5) * 10, 14, 86);
        scorer.ty = clamp(scorer.y + dir * (8 + Math.random() * 8), 10, 90);
      } else {
        scorer.tx = clamp(scorer.x + (Math.random() - 0.5) * 5, 18, 82);
        scorer.ty = clamp(lerp(scorer.y, boxY, 0.35), 8, 92);
      }
    }
    this._setFocus([scorer, organizer, assister].filter(Boolean), 8000);

    const defs = this.players
      .filter((p) => p.team !== team && p.pos !== "GK" && !p.el.classList.contains("sent-off"))
      .sort(
        (a, b) =>
          Math.hypot(a.x - (organizer?.x || ballX), a.y - (organizer?.y || ballY)) -
          Math.hypot(b.x - (organizer?.x || ballX), b.y - (organizer?.y || ballY))
      );
    for (let i = 0; i < Math.min(depth === "box" ? 1 : 2, defs.length); i++) {
      defs[i].tx = clamp((organizer?.x || ballX) + (Math.random() - 0.5) * 8, 8, 92);
      defs[i].ty = clamp((organizer?.y || ballY) + (Math.random() - 0.5) * 6, 8, 92);
    }

    if (depth === "build") {
      await wait(560);
      // —— 2) 前压 ——
      if (organizer) {
        organizer.tx = clamp(organizer.x + (Math.random() - 0.5) * 8, 12, 88);
        organizer.ty = clamp(organizer.y + dir * (8 + Math.random() * 6), 10, 90);
        this._setTouch(organizer, 1800);
      }
      if (scorer && scorer !== organizer) {
        scorer.tx = clamp(
          (organizer?.x || scorer.x) + (Math.random() < 0.5 ? -11 : 11),
          12,
          88
        );
        scorer.ty = clamp(lerp(scorer.y, boxY, 0.55), 8, 92);
      }
      for (const pl of this.players.filter(
        (p) => p.team === team && p !== scorer && p !== organizer && p.pos !== "GK"
      )) {
        if (Math.random() < 0.35) {
          pl.tx = clamp(pl.x + (Math.random() - 0.5) * 8, 8, 92);
          pl.ty = clamp(pl.y + dir * (4 + Math.random() * 6), 8, 92);
        }
      }
      await wait(720);
    } else if (depth === "final") {
      await wait(380);
      if (organizer) {
        organizer.tx = clamp(organizer.x + (Math.random() - 0.5) * 6, 14, 86);
        organizer.ty = clamp(organizer.y + dir * 6, 10, 90);
      }
      if (scorer && scorer !== organizer) {
        scorer.tx = clamp(scorer.x + (Math.random() - 0.5) * 8, 14, 86);
        scorer.ty = clamp(lerp(scorer.y, boxY, 0.5), 8, 92);
      }
      await wait(420);
    } else {
      await wait(220);
    }

    // —— 3) 助攻直塞 / 自己带入 ——
    // 有助攻时强制：助攻者持球 → 传球轨迹 → 射手接球再射（回放重点）
    if ((wantAssist || depth !== "box") && organizer && scorer && organizer !== scorer) {
      scorer.tx = clamp(scorer.x + (Math.random() - 0.5) * 6, 16, 84);
      scorer.ty = clamp(lerp(scorer.y, boxY, 0.72), 8, 92);
      this.setCaption(
        lang === "en"
          ? `${organizer.name || "Player"} → ${scorer.name || "scorer"}`
          : `${organizer.name || "助攻"} → ${scorer.name || "射手"}`,
        "info",
        0
      );
      this._setFocus([organizer, scorer], 5000);
      this._passTo(organizer, scorer, {
        flightMs: Math.round((isRewatch || wantAssist ? 780 : depth === "final" ? 560 : 720) / Math.min(speed, 1.5)),
      });
      this._addTrail(organizer.x, organizer.y, scorer.tx, scorer.ty, "pass", 0.55);
      if (assister && assister !== scorer) this._recordPass(assister, scorer);
      await wait(isRewatch || wantAssist ? 920 : depth === "final" ? 700 : 880);
      if (this.carrier !== scorer) this._setCarrier(scorer, { stick: true });
      scorer.tx = clamp(scorer.x + (Math.random() - 0.5) * 5, 18, 82);
      scorer.ty = clamp(boxY + dir * 3, 8, 92);
      this._setTouch(scorer, 1600);
      this.setCaption(
        lang === "en" ? `${scorer.name || "Scorer"} shoots!` : `${scorer.name || "射手"} 起脚！`,
        "chance",
        0
      );
      await wait(isRewatch || wantAssist ? 480 : depth === "final" ? 320 : 420);
    } else if (scorer) {
      this._setCarrier(scorer, { stick: true });
      scorer.tx = clamp(scorer.x + (Math.random() - 0.5) * 5, 18, 82);
      scorer.ty = clamp(lerp(scorer.y, boxY, depth === "box" ? 0.4 : 0.65), 8, 92);
      await wait(depth === "box" ? 280 : 480);
    }

    // —— 4) 射门入网 ——
    this.camMode = "box";
    this.camBoostUntil = performance.now() + 1600;
    const finisher =
      (this.carrier && this.carrier.team === team ? this.carrier : null) || scorer;
    this._clearCarrier();
    if (finisher) {
      // 球从脚下出，不瞬移到门前
      this.ball.x = finisher.x;
      this.ball.y = finisher.y;
      finisher.el.classList.add("scorer", "highlight");
      this.highlightId = finisher.id;
      this.flashUntil = performance.now() + 3600;
      this._setTouch(finisher, 2200);
      if (assister && assister !== finisher) this._recordPass(assister, finisher);
      this.lastCarrierId = finisher.id;
    }
    this._shootBall(gx, gy, "goal");
    this.ball.tx = gx;
    this.ball.ty = gy;
    this.setBanner("⚽", "goal");
    this.setCaption(lang === "en" ? "SHOT…" : "射门…", "chance", 0);
    this.playSfx("kick");
    await wait(isRewatch ? 520 : 420);
    // 等飞行接近球门再钉死入网（观感：球飞进门）
    this.ball.x = gx;
    this.ball.y = gy;
    this.ball.tx = gx;
    this.ball.ty = gy;
    this.ballFlightUntil = 0;
    this.flight = null;
    this.ballState = "free";
    this._applyBall();
    this._goalNetEffect(gx, gy, attHome);
    this.playSfx("goal");
    this.playSfx("cheer");
    const scoreLine =
      snap && snap.homeGoals != null
        ? `⚽ ${snap.homeGoals} - ${snap.awayGoals}`
        : "⚽ GOAL";
    this.setBanner(scoreLine, "goal");
    this.setCaption(scoreLine, "goal", 0);
    if (finisher?.player) {
      const subAssist =
        assister && assister !== finisher
          ? lang === "en"
            ? `${scoreLine} · A ${assister.name || ""}`
            : `${scoreLine} · 助攻 ${assister.name || ""}`
          : scoreLine;
      this.showFlashCard({
        title: lang === "en" ? "GOAL!" : "进球！",
        sub: subAssist,
        kind: "goal",
        player: finisher.player,
        team,
        ms: 2800,
      });
    }
    await wait(isRewatch ? 1200 : 1100);

    // —— 5) 庆祝：射手冲角旗，队友聚拢 ——
    if (finisher) {
      this._beginVisualCelebrate(finisher, ev);
    }
    const scorerName = finisher?.name || finisher?.player?.name || scorer?.name || "";
    const assistName = assister?.name || assister?.player?.name || "";
    const cele =
      lang === "en"
        ? assistName
          ? `GOAL! ${scorerName} (A: ${assistName})`
          : `GOAL! ${scorerName}`
        : assistName
          ? `进球！${scorerName}（助攻 ${assistName}）`
          : `进球！${scorerName}`;
    this.setBanner(cele, "goal");
    this.setCaption(
      lang === "en" ? `${scorerName} and teammates celebrate!` : `${scorerName} 与队友庆祝！`,
      "goal",
      0
    );
    // 多帧插值庆祝（约 2.6s）
    const celeSteps = isRewatch ? 14 : 18;
    for (let i = 0; i < celeSteps; i++) {
      this._tickVisualCelebrate(0.12);
      this._drawCanvas?.();
      await wait(isRewatch ? 110 : 140);
    }

    // —— 6) 开球（回看也复位，方便连点下一球） ——
    this._celebrate = null;
    await this._restartAfterGoal(attHome, { wait, lang });
  }

  async replayEvents(events, fixture, { onStep, speed = 1, sleepFn } = {}) {
    this.phase = "play";
    this._syncClickable();
    let hg = 0;
    let ag = 0;
    const spd = Math.max(0.25, Number(speed) || 1);
    const waitFn = typeof sleepFn === "function" ? sleepFn : sleep;
    // 用户场 v2 事件带 fromSim：一键回放只走轻量 UI，不用旧编舞编造助攻/跑位
    const anySim = (events || []).some((e) => e?.fromSim);
    if (anySim && this.setSimDrive) this.setSimDrive(true);
    for (const ev of events || []) {
      if (ev.type === "tick") continue;
      if (ev.type === "goal") {
        if (ev.teamId === fixture.home) hg++;
        else ag++;
      }
      const snap = {
        homeGoals: hg,
        awayGoals: ag,
        minute: ev.minute,
        engine: anySim || ev.fromSim ? "v2" : "v1",
      };
      if (ev.type === "goal") {
        if (onStep) onStep(ev, snap);
        if (anySim || ev.fromSim || this.simDrive) {
          // 轻量：横幅 + 比分，不 playGoalHighlight 假编舞
          this.onEvent(ev, snap, fixture);
          await waitFn(Math.max(280, 900 / spd));
        } else {
          await this.playGoalHighlight(ev, snap, fixture, { speed: spd, sleepFn: waitFn });
        }
        continue;
      }
      this.onEvent(ev, snap, fixture);
      if (onStep) onStep(ev, snap);
      const wait =
        ev.type === "chance" || ev.type === "woodwork" || ev.type === "save"
          ? 520 / spd
          : ev.type === "ht" || ev.type === "ft"
            ? 400 / spd
            : ev.type === "kickoff"
              ? 320 / spd
              : 160 / spd;
      await waitFn(wait);
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
