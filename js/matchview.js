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
import { MatchViewFSM } from "./matchview-fsm.js";
import { interpolateSimBall, simMinuteOf } from "./match-presentation.js";
import { MotionIntegrityMonitor } from "./match-motion-integrity.js";
import {
  cameraFraming,
  crowdAtmosphere,
  normalizeCameraPreset,
  visualCuePolicy,
} from "./match-broadcast.js";
import { coordSystem } from "./matchview-coords.js";
import { planIntro, planSkip, staggerDelay } from "./matchview-intro.js";
import { GOAL_NARRATIVE, DirectorScript } from "./matchview-director.js";
import {
  ensureKit,
  getLineupPlayers,
  autoLineup,
  assignPlayersToFormationSlots,
} from "./models.js";

// 球尾特效总开关（2026-09-04 用户反馈「球的尾巴违和，去掉」）。
// false = 关闭全部尾迹：canvas 地面丝带 + SVG 弧线尾迹（_addTrail/.mp-trails）。
// 代码全部保留，改回 true 即可找回。canvas 侧的字符串守卫见 _drawBall 附近注释。
const SHOW_BALL_TRAIL = false;

// .mp-press / .mp-network / .mp-trails 三个叠层用的是 viewBox="0 0 100 100"，写入的是
// **画面百分比**（screenX=100-engineY，screenY=engineX），不是引擎坐标。
// 盒子是横向 .mp-camera，宽高比 105/68。preserveAspectRatio="none" 会把 y 方向
// 压到 68/105：要让屏幕上正圆，ry = rx × 105/68。
// （.mp-lines 用的是 viewBox="0 0 150 100"，中圈椭圆 rx=13.07 ry=13.46。）
const OVERLAY_CIRCLE_RY = 105 / 68;

/** 引擎坐标 → 画面 left/top 百分比。主队球门在左（y=100 → left 0），客队在右（y=0 → left 100）。 */
function pitchToScreenPct(x, y) {
  return { left: 100 - y, top: x };
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 重启搬运过渡（见 `applySimSnapshot`）。球员门槛按帧间模拟秒与米制速度计算，
 * 包含正常跑动和身体分离的余量；旧的 3 格门槛会漏掉约 1~3 米的短促摆位。
 * 只在重启语义下按搬运处理。700ms 是压缩后的摆位过渡，
 * 不代表真实跑动或活球轨迹；重启判罚与目标点仍以引擎为准。
 */
const RELOCATE_MS = 700;
const RELOCATE_BALL_JUMP = 6;
const RELOCATE_PLAYER_MAX_SPEED_MPS = 10;

/**
 * 高光段入场的转场（见 `_enterSegmentTransition`）。
 *
 * 背景：`playSimTimeline` 每段开场都用 `applySimSnapshot(frames[0], { soft:false })`
 * 硬切，而 `applySimSnapshot` 的 `sceneCut` 判定会把缓动显式关掉
 * （`simT - lastSimT > 0.55` → 非 adjacent → 不武装 relocate）。
 * 于是段首那一帧把 26 个实体直接按到新坐标上。
 *
 * 实测（`scripts/_segment-boundary-probe.mjs`）：相邻段之间可隔 740 比赛秒，
 * 位移中位 44.9 m、球 83.4 m、26/26 实体全部 >3 m —— 观众看到「整队凭空换位」。
 *
 * ⛔ **不要试图给段入口加缓动。** 曾经按「短间隔缓动 / 长间隔剪辑」分档实现过，
 * 但 `scripts/_segment-gap-census.mjs` 跑完整场后量到真实间隔是
 * **129.5 / 389.3 / 956.8 秒**（3 个间隔，无一例外都在长档），
 * 最近的一对也是门限的 6.5 倍——**ease 分支永远不可能触发，是纯死代码**。
 *
 * 原因是窗口构造本身：每个高光窗只覆盖约 19 秒比赛时间
 * （`buildHighlightWindows`：进球 lead 8 / trail 6，扑救还要 `farFromExisting(25)`，
 * 射门按威胁度分散挑），而两窗之间必然隔着几分钟。
 * 所以「两段本来就连续」这种情形在数据上不存在。
 *
 * ⇒ 一律按**显式剪辑**处理：不去伪造位移连续性，而是用一次短暂淡场
 * 把「换场景了」讲出来（与 `playHighlightPlanBridge` 的「⏩ 跳过平淡」同一语汇）。
 */
/** 剪辑淡出的时长（ms）：够看出「换镜头了」，又不至于拖慢观赛节奏 */
const SEGMENT_CUT_MS = 260;

/**
 * 关键事件横幅停留时长（ms）。
 * 底栏是「解说文案 ↔ 控球条」互斥的同一个格子，横幅一超时就切回控球条。
 * 旧值 1.1–2.4s，换人/红黄牌/VAR/进球这类必须读到的事件常常一闪而过。
 */
const KEY_EVENT_MS = 3400;
/** 次要但仍需读的事件（扑救 / 角球 / 伤停） */
const MINOR_EVENT_MS = 2200;

/**
 * 逻辑格 → 米。场地 100×100 格映射到 68m×105m，所以**两个轴的格不等长**：
 * x 一格 0.68m、y 一格 1.05m（等于引擎的 `SIM.PITCH_W_METRES / SIM.FIELD_W`）。
 * 直接对格数取 `Math.hypot` 是混单位——`corner-structure-audit` 修掉的就是这个写法。
 * 这里不 import SIM：表现层不该为两个常量把引擎拉进来。
 */
const OFFICIAL_MX = 0.68;
const OFFICIAL_MY = 1.05;
/** 主裁与球的最小间距（米）：低于此值两个圆点会叠在一起，读起来像裁判在带球 */
const MIN_REF_GAP_M = 5;
/**
 * 主裁的移动是**恒速追击 + 分档**，不是「速度 ∝ 目标残差」。
 *
 * ⛔ 前两版都错在同一条链上：目标点是局面重心的**刚性偏移**，于是球持续移动时目标
 * 以 1:1 的增益跟着走，主裁必须跑出**球速**才追得上。低通只削高频、上限只削峰值，
 * 那条牵引链一直没解开。用户在长传转移时看得最清楚——球一次飞 30~40m，残差瞬间变大，
 * 主裁于是连续多帧顶着上限跑，而同时段的球员正在慢跑回位或以 2~4 m/s 转移。
 *
 * 真实主裁**让球跑掉，再补上来**：距球是呼吸的，不是常数。所以这里按距球分三档给速度，
 * 并且把指数追踪换成恒速追击——主裁的速度与球速彻底解耦。
 *
 * 速度锚在引擎自己的球员上（`scripts/_referee-motion-probe.mjs`：追球者中位 2.10 m/s、
 * p90 4.82，全体外场 p99 5.72）：
 *   · 带内慢跑 1.5 m/s   —— 低于追球者中位
 *   · 落后过多才全速 3.8 m/s —— 仍低于追球者 p90，所以**转移时他必然被落下**，这是对的
 * 代价是距球会拉开到 30m 上下。真实主裁在长传转移后落后 25~35m 是常态。
 */
const OFFICIAL_DRIFT_STEP_M = 0.15; // 1.5 m/s（每 sim 帧 0.1s）
const MAX_OFFICIAL_STEP_M = 0.38; // 3.8 m/s
const REF_GAP_NEAR_M = 9; // 比这更近就慢慢让开，别贴着球
const REF_GAP_FAR_M = 30; // 比这更远才允许全速补位

function replayRandomFor(event = {}) {
  const key = [
    event.teamId,
    event.playerId,
    event.assistId,
    event.minute,
    event.penalty ? 1 : 0,
    event.ownGoal ? 1 : 0,
  ].join("|");
  let seed = 2166136261;
  for (let index = 0; index < key.length; index++) {
    seed ^= key.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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
    this._simBallTrailPhase = null;
    this.fxLayer = null;
    this.trailSvg = null;
    this.fieldEl = null;
    this.cameraEl = null;
    this.running = false;
    this.raf = 0;
    this.lastTs = 0;
    this.fsm = new MatchViewFSM(); // 状态机替代 phase
    this.possession = "home";
    /** 与引擎 `endsSwapped` 同步：下半场换边后主队守右、客队守左。默认 false。 */
    this.endsSwapped = false;
    /** 本场是否已提示过换边。上升沿只讲一次，高光回放把队名翻回去再翻回来不再闪。 */
    this._endsSwapAnnounced = false;
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
    /** Stable user-facing camera: full | tv | tactical. */
    this.cameraPreset = "tv";
    /** @type {((playerId: string, team: 'home'|'away') => void) | null} */
    this.onPlayerClick = null;
    // 镜头：目标与当前（百分比偏移 → CSS translate）
    this.cam = { x: 0, y: 0, tx: 0, ty: 0, scale: 1, tScale: 1 };
    this._everPlayed = false; // A2 收尾：死球镜头策略在开赛/开赛前分叉（见 _updateCameraTarget）
    this._officialsSimT = null;
    this._playCentre = null;
    this._relocLastSimT = null;
    this._lastDeflectionKey = null;
    this.camBoostUntil = 0;
    this.trails = []; // active trail animations
    // 高光段入场转场（见 `_enterSegmentTransition`）：上一段结束的比赛秒 +
    // 剪辑提示动画的定时器。
    this._segLastEndSimT = null;
    this._segCutTimer = null;
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
    // ===== 状态机（替代旧的 phase/frozen/scriptLock 标志） =====
    this.fsm = new MatchViewFSM();
    this._legacyPhase = "pre";
    this._legacyFrozen = false;
    this._legacyScriptLock = false;

    // FSM 状态监听器：同步回旧标志（兼容期）
    this.fsm.on('enter:PRE_MATCH', () => { this._legacyPhase = 'pre'; });
    this.fsm.on('enter:PLAYING', (data) => {
      this._legacyPhase = 'play';
      this._legacyScriptLock = data?.toSub === 'SCRIPTED';
    });
    this.fsm.on('enter:GOAL_SEQUENCE', () => { this._legacyPhase = 'goal'; });
    this.fsm.on('enter:PAUSED', () => { this._legacyPhase = 'pause'; });
    this.fsm.on('enter:HALF_TIME', () => { this._legacyPhase = 'pause'; });
    this.fsm.on('enter:FULL_TIME', () => { this._legacyPhase = 'pause'; });

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
    this._broadcastContext = { attendanceRatio: 0.84 };
    this._crowdBed = null;
    this._crowdReaction = { value: 0, until: 0 };
    this._crowdLastUpdate = 0;
    this._broadcastScore = { home: 0, away: 0 };
    this.motionMonitor = new MotionIntegrityMonitor({ windowSeconds: 12 });
    this.onMotionStatus = null;
    this._motionStatusKey = "0:0";
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
    this._presentationReadOnlyDepth = 0;
  }

  // ===== 状态标志兼容层（getter/setter 代理到 FSM） =====

  /** @deprecated 使用 fsm.state 替代 */
  get phase() { return this._legacyPhase; }
  set phase(val) {
    this._legacyPhase = val;
    // 同步到 FSM
    if (val === 'pre') {
      this.fsm.transition('PRE_MATCH');
    } else if (val === 'play') {
      const subState = this._legacyScriptLock ? 'SCRIPTED' : 'FREE_PLAY';
      this.fsm.transition('PLAYING', subState);
    } else if (val === 'goal') {
      this.fsm.transition('GOAL_SEQUENCE', 'STRIKE');
    } else if (val === 'pause') {
      this.fsm.transition('PAUSED');
    }
  }

  /** @deprecated 使用 fsm.canAIAct() 替代 */
  get frozen() { return this._legacyFrozen; }
  set frozen(val) {
    this._legacyFrozen = !!val;
    if (val) {
      this.fsm.transition('PAUSED');
    } else if (this.fsm.is('PAUSED')) {
      this.fsm.resume();
    }
  }

  /** @deprecated 使用 fsm 子状态替代 */
  get scriptLock() { return this._legacyScriptLock; }
  set scriptLock(val) {
    this._legacyScriptLock = !!val;
    if (this._legacyPhase === 'play' && !this._legacyFrozen) {
      this.fsm.transition('PLAYING', val ? 'SCRIPTED' : 'FREE_PLAY');
    }
  }

  /**
   * 开启/关闭空间模拟投影驱动
   * @param {boolean} on
   */
  setSimDrive(on) {
    const wasOn = this.simDrive;
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
      this._simBallTrailPhase = null;
      // 清轨迹/传球网，避免和 Canvas 球员叠成重影
      this.trails = [];
      if (this.trailSvg) this.trailSvg.innerHTML = "";
      if (this.networkSvg) {
        const paths = this.networkSvg.querySelector("#mp-net-paths");
        if (paths) paths.innerHTML = "";
      }
      if (!wasOn && this._presentationReadOnlyDepth <= 0) this.passNetwork?.clear?.();
      const currentState = this.fsm.current();
      if (currentState === 'PRE_MATCH' || currentState === 'PAUSED' || currentState === 'HALF_TIME') {
        this.fsm.transition('PLAYING', 'FREE_PLAY');
      }
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
    // 换边位必须在本帧官员更新之前落地：`_updateOfficials` 按它选半场钳位。
    const nextEndsSwapped = !!sim.endsSwapped;
    // 上升沿必须在赋值前判：队名标签换位的那一帧才该提示。
    // 下降沿（高光回放上半场）只改 chrome，不再闪一次「换边」。
    const endsSwapRising = nextEndsSwapped && !this.endsSwapped;
    if (nextEndsSwapped !== !!this.endsSwapped) {
      this.endsSwapped = nextEndsSwapped;
      this._applyEndsChrome();
      if (endsSwapRising) this._announceEndsSwap();
    } else {
      this.endsSwapped = nextEndsSwapped;
    }
    if (!this.fsm.isIn('GOAL_SEQUENCE')) {
      this.fsm.transition('PLAYING', 'SIM_DRIVEN');
    }

    const soft = !!opts.soft;
    // 平滑系数：约 70ms 跟上目标，去掉帧边界硬切造成的肉眼抖动
    const smooth = soft ? 0.38 : 1;

    // 重启搬运过渡：引擎 `_restart` 会把球和全部球员在**一个 tick 内**搬到重启点
    // （门球/越位/角球/任意球），画面照坐标画就是瞬移——实测 2 场 98 次单 tick
    // 位移 >6 格，90 次带重启类型（`scripts/_gk-kick-and-ball-jump-probe.mjs`）。
    // 判罚本身不动；这里只在看到「相邻 sim 帧内超出物理可能的位移」时，
    // 把显示坐标从旧位置缓动到新位置（0.7s 比赛时间，ease-out），
    // 倍速与暂停都随比赛时钟，避免开球后仍拖着上一段的摆位动画。
    // 只在相邻帧（dt ≤ 0.35s）里判：跳段/高光切帧本来就是剪辑，不该缓动。
    const nowMs = performance.now();
    const simT = Number(sim.t);
    const lastSimT = this._relocLastSimT;
    const sceneCut = !Number.isFinite(lastSimT) || simT < lastSimT - 1e-6 || simT - lastSimT > 0.55;
    const restartFrame = !!(sim.ball?.restartType || sim.motionContext?.discontinuity);
    const adjacent =
      Number.isFinite(simT) && Number.isFinite(lastSimT) && simT > lastSimT && simT - lastSimT <= 0.35;
    if (Number.isFinite(simT)) this._relocLastSimT = simT;
    // 门槛按实际帧间隔放大：跳过几帧时合法位移也成比例变大
    const dtScale = adjacent ? Math.max(1, (simT - lastSimT) / 0.1) : 1;
    const relocate = (entity, tx, ty, jumpLimit, metric = false, followOwner = false) => {
      if (sceneCut) entity._relocAt = 0;
      const distance = metric
        ? Math.hypot((tx - entity.x) * OFFICIAL_MX, (ty - entity.y) * OFFICIAL_MY)
        : Math.hypot(tx - entity.x, ty - entity.y);
      // 只在「没有缓动在进行」时武装。武装检查在缓动读取之前，若不加这道闸，
      // 只要目标与显示位置的距离仍超阈值，就会每次调用都重新武装（_relocFrom
      // 重设为当前显示位、u 重置为 0），缓动一步都走不了——实测球员被冻在
      // 原地几十秒、离引擎位置 38 m（display-divergence 刷屏的根因）。
      if (
        adjacent && restartFrame && !entity._relocAt &&
        (distance > jumpLimit + 1e-8 || followOwner)
      ) {
        entity._relocFromX = entity.x;
        entity._relocFromY = entity.y;
        entity._relocAt = nowMs;
        entity._relocSimT = simT;
      }
      if (!entity._relocAt) return null;
      const u = Math.max(0, (simT - entity._relocSimT) * 1000 / RELOCATE_MS);
      if (u >= 1) {
        entity._relocAt = 0;
        return null;
      }
      const e = 1 - Math.pow(1 - u, 3);
      return {
        x: entity._relocFromX + (tx - entity._relocFromX) * e,
        y: entity._relocFromY + (ty - entity._relocFromY) * e,
      };
    };

    const byId = new Map(sim.players.map((s) => [s.id, s]));
    let carrier = null;
    for (const pl of this.players) {
      const s = byId.get(pl.id);
      // 罚下/伤退的人：引擎已让他走向本方底线并停住（`_think` 的 sentOff 分支），
      // 这里只负责把「已离场」这个事实**落到 DOM class** 上。
      //
      // ⚠ 为什么要在这里同步，而不是继续依赖 `red` 事件分支
      //   （`case "red"` 里的 `classList.add("sent-off")`）：
      //   画布绘制（`drawList`）与几十处选人逻辑全都读 `el.classList`，
      //   而事件通道是**一次性**的——只要那一个事件因为任何原因没被这一层
      //   消费到（跳段、快进、事件重放、`players` 在这一帧之前刚重建过），
      //   class 就永远不会被补上，该球员此后**一直画在场上**、还一直参与
      //   「最近的队友/对手」这类选人，表现为「卡在场边不动」（用户报告）。
      //   而 compact frame **每帧都带 `sentOff`**（`engine.js` 的导出），
      //   用它可以自愈：状态错了下一帧就纠回来。
      //
      // 只在**状态变化**时写 DOM，避免每帧 22 次 `classList.toggle` 的开销。
      if (s) {
        const off = !!s.sentOff;
        if (off !== pl.el.classList.contains("sent-off")) {
          pl.el.classList.toggle("sent-off", off);
          // ⚠ 这里**不**额外设落点。引擎 `_think` 的 sentOff 分支已经把
          //   `a.tx` 定到本方底线外（主队 1 / 客队 99）并每帧保持，
          //   而这个循环末尾对 sent-off 的人是 `continue`（不再写坐标），
          //   于是引擎给的那条「走向边线」的轨迹会被原样保留。
          //   事件分支（`case "red"`）另设的 `pl.ty = ±2/102` 是边线落点，
          //   与引擎的底线落点不同；在快照路径里以引擎为准，不自作主张。
        }
      }
      if (pl.el.classList.contains("sent-off")) continue;
      if (!s) continue;
      const tx = clamp(s.x, 0, 100);
      const ty = clamp(s.y, 0, 100);
      const ox = pl.x;
      const oy = pl.y;
      const reloc = relocate(pl, tx, ty,
        RELOCATE_PLAYER_MAX_SPEED_MPS * (simT - lastSimT), true);
      if (reloc) {
        pl.x = reloc.x;
        pl.y = reloc.y;
      } else {
        pl.x = smooth >= 1 ? tx : pl.x + (tx - pl.x) * smooth;
        pl.y = smooth >= 1 ? ty : pl.y + (ty - pl.y) * smooth;
      }
      pl.tx = pl.x;
      pl.ty = pl.y;
      // 速度用于朝向箭头 / 冲刺残影
      pl.vx = pl.x - ox;
      pl.vy = pl.y - oy;
      pl.movementTarget = s.movementTarget || null;
      pl.shapePhase = s.shapePhase || null;
      pl.fsm = s.fsm || null;
      pl.defensiveJob = s.defensiveJob || null;
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
        // 导演层兜的扑救姿态（poseHold）必须活到它自己的截止时间：
        // 高光路径下带 pose 的 sim 帧常被整段跳过，紧接着来的无姿态帧会把
        // poseUntil 压到 80ms，扑救动作还没画出来就没了。
        const held = pl.poseHold && performance.now() < pl.poseHold;
        if (!held) {
          // sim 已无姿态：最多再留 80ms 防闪，然后清掉
          if (!pl.poseUntil || performance.now() > pl.poseUntil - 400) {
            pl.poseUntil = Math.min(pl.poseUntil || performance.now() + 80, performance.now() + 80);
          }
          if (performance.now() > pl.poseUntil) {
            pl.pose = null;
            pl.poseDir = 0;
            pl.poseUntil = 0;
            pl.poseHold = 0;
          }
        }
      }
      // 先清光环，球位更新后再按「真 owner + 贴球」赋值（杜绝空飘球却亮人）
      pl.el.classList.remove("has-ball");
      this._applyPlayer(pl);
    }

    const previousBall = {
      x: this.ball.x,
      y: this.ball.y,
      z: this.ball.z || 0,
    };
    if (sim.ball) {
      const bx = clamp(sim.ball.x, 0, 100);
      const by = clamp(sim.ball.y, 0, 100);
      const bz = clamp(Number(sim.ball.z) || 0, 0, 12);
      const prevZ = this.ball.z || 0;
      const ownerRelocating = !!sim.ball.owner && this.players.some((p) =>
        p.id === sim.ball.owner && p._relocAt);
      const ballReloc = relocate(this.ball, bx, by, RELOCATE_BALL_JUMP * dtScale, false, ownerRelocating);
      if (ballReloc) {
        this.ball.x = ballReloc.x;
        this.ball.y = ballReloc.y;
        this.ball.z = 0;
      } else {
        this.ball.x = smooth >= 1 ? bx : this.ball.x + (bx - this.ball.x) * smooth;
        this.ball.y = smooth >= 1 ? by : this.ball.y + (by - this.ball.y) * smooth;
        this.ball.z = smooth >= 1 ? bz : (this.ball.z || 0) + (bz - (this.ball.z || 0)) * smooth;
      }
      this.ball.tx = this.ball.x;
      this.ball.ty = this.ball.y;
      // 落地轻弹:从空中落回地面时闪一下落点。
      // ⚠ 上一段若在做重启搬运缓动(relocate),球是被搬到死球点、不是落地——
      // 搬运里 z 已清零(0),照 flash 会画出假落点尘,所以跳过。
      if (prevZ > 1.2 && (this.ball.z || 0) < 0.35 && !this.carrier && !ballReloc) {
        this._ballBounceFlash = performance.now() + 220;
      }
      // 仅在球门线附近才播入网（防跳段/粘帧在中场炸出「迷你球门」）
      if (sim.ball.netHit && !this._netHitDone && (by < 8 || by > 92)) {
        this._netHitDone = true;
        const attHome = by < 50;
        const gx = clamp(bx, coordSystem.GOAL.X_MIN - 2, coordSystem.GOAL.X_MAX + 2);
        const gy = attHome ? Math.min(by, coordSystem.GOAL.AWAY_Y - 0.5) : Math.max(by, coordSystem.GOAL.HOME_Y + 0.5);
        this._goalNetEffect?.(gx, gy, attHome);
      }
      // 门将指尖擦到但没扑住：球的方向确实变了，标一下接触点，
      // 否则画面上就是「球无接触自己拐弯」。复用现有的克制 burst，不加新特效。
      if (sceneCut) this._lastDeflectionKey = null;
      if (sim.ball.deflect) {
        const d = sim.ball.deflect;
        const key = `${d.t}:${d.byId}:${d.x}:${d.y}`;
        if (key !== this._lastDeflectionKey && (!Number.isFinite(d.t) || simT >= d.t - 1e-6)) {
          this._lastDeflectionKey = key;
          this._burst?.(Number.isFinite(d.x) ? d.x : bx, Number.isFinite(d.y) ? d.y : by, "save");
        }
      }
    }

    // 持球光环：仅球有 owner 且该球员贴在球边；飞行/松球绝不亮
    const ballState = sim.ball?.state || null;
    const isCornerState =
      ballState === "corner" || sim.ball?.setPiece === "corner";
    const inFlight =
      ballState === "shot" ||
      ballState === "pass" ||
      ballState === "control" ||
      ballState === "loose" ||
      ballState === "dead";
    const ownerId = !inFlight ? sim.ball?.owner || null : null;
    if (ownerId) {
      const own = this.players.find((p) => p.id === ownerId);
      if (own) {
        const d = Math.hypot(own.x - this.ball.x, own.y - this.ball.y);
        if (d < 5.5) {
          own.el.classList.add("has-ball");
          if (isCornerState) own.el.classList.add("highlight");
          carrier = own;
          // The engine already supplies the foot offset and first-touch path.
          // Highlight ownership without changing that recorded trajectory.
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
    const trailPhase = ownerId
      ? `held:${ownerId}`
      : ballState === "pass" || ballState === "shot"
        ? ballState
        : ballState || "free";
    if (this._simBallTrailPhase && trailPhase !== this._simBallTrailPhase) {
      const startsFlight = trailPhase === "pass" || trailPhase === "shot";
      const leftPossession = this._simBallTrailPhase.startsWith("held:");
      this._ballTrail = startsFlight && leftPossession ? [previousBall] : [];
    }
    this._simBallTrailPhase = trailPhase;
    this._pushBallTrail();
    this._applyBall();
    const previousOfficialsSimT = this._officialsSimT;
    if (Number.isFinite(simT)) this._officialsSimT = simT;
    const officialsSimDt =
      Number.isFinite(simT) && Number.isFinite(previousOfficialsSimT)
        ? Math.max(0, simT - previousOfficialsSimT)
        : null;
    this._updateOfficials(soft, officialsSimDt, sceneCut);
    this._recordMotionDiagnostic(sim, opts.interpolationSource);
    // 直播用 soft follow（见 update）；非时间轴时默认 follow
    if (!this._simPlay && this.simDrive) this.camMode = this.camMode === "box" ? "box" : "follow";
    return true;
  }

  /** 两帧之间插值（对齐 sim-viewer：10Hz 模拟 → 屏幕 60fps 平滑） */
  applySimSnapshotLerped(fa, fb, alpha) {
    if (!fa?.players?.length) return false;
    const interpolationSource = { from: fa, to: fb || fa, alpha: clamp(alpha, 0, 1) };
    if (!fb?.players?.length || alpha <= 0) {
      return this.applySimSnapshot(fa, { soft: false, interpolationSource });
    }
    if (alpha >= 1) return this.applySimSnapshot(fb, { soft: false, interpolationSource });
    const t = clamp(alpha, 0, 1);
    const byB = new Map(fb.players.map((p) => [p.id, p]));
    // 重启搬迁（引擎 _restart 单 tick 把球+全员搬到定位球槽位）落在相邻录制帧上
    // 就是 17-28 m 的位移。线性插值会把显示坐标在一个帧跨度内扫过整个缺口——
    // 实测一次角球布阵刷出 20+ 条 218-351 m/s 的 player-teleport（2635.64s），
    // 而且 applySimSnapshot 的 relocate() 只认「单次调用大位移」，插值小步喂进
    // 去永远武装不了。这里把重启帧对里超出物理可能的实体按住在出发点，下一帧对
    // 目标跳变时 relocate() 自然接管缓动 0.7s——观感即「球员走到位、球被捡回摆好」。
    // 门必须是语义标记（fb 带重启/不连续窗口）而非纯位移：合成测试与快操作的
    // 大位移帧没有标记，照常插值（browser-e2e 直线传球断言是这条边界的规格）。
    // 跳段剪辑（dt 大）本来就是硬切，也不在此列。
    const pairDt = (fb.t ?? 0) - (fa.t ?? 0);
    const pairAdjacent = pairDt > 0 && pairDt <= 0.35;
    const restartPair = !!(fb.motionContext?.discontinuity || fb.ball?.restartType);
    const heldIds = new Set();
    if (pairAdjacent && restartPair) {
      for (const a of fa.players) {
        const b = byB.get(a.id);
        if (b && Math.hypot((b.x - a.x) * OFFICIAL_MX, (b.y - a.y) * OFFICIAL_MY) >
          RELOCATE_PLAYER_MAX_SPEED_MPS * pairDt + 1e-8) heldIds.add(a.id);
      }
    }
    const players = fa.players.map((a) => {
      const b = byB.get(a.id) || a;
      const held = heldIds.has(a.id);
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
        x: held ? a.x : a.x + (b.x - a.x) * t,
        y: held ? a.y : a.y + (b.y - a.y) * t,
        vx: held ? 0 : (a.vx || 0) + ((b.vx || 0) - (a.vx || 0)) * t,
        vy: held ? 0 : (a.vy || 0) + ((b.vy || 0) - (a.vy || 0)) * t,
        heading: held ? h : h + dh * t,
        fsm: t < 0.5 ? a.fsm || null : b.fsm || null,
        shapePhase: t < 0.5 ? a.shapePhase || null : b.shapePhase || null,
        movementTarget: t < 0.5 ? a.movementTarget || null : b.movementTarget || null,
        defensiveJob: t < 0.5 ? a.defensiveJob || null : b.defensiveJob || null,
        sentOff: !!(t < 0.5 ? a.sentOff : b.sentOff),
        separationContact: !!(t < 0.5 ? a.separationContact : b.separationContact),
        pose: b.pose || a.pose || null,
        poseDir: b.poseDir ?? a.poseDir ?? 0,
        hasBall: false, // 下面按 ball.owner 统一赋值
      };
    });
    const ball = interpolateSimBall(fa.ball, fb.ball, t);
    if (
      pairAdjacent &&
      restartPair &&
      (heldIds.has(fa.ball?.owner) || heldIds.has(fb.ball?.owner) ||
        Math.hypot(
          (fb.ball?.x ?? 0) - (fa.ball?.x ?? 0),
          (fb.ball?.y ?? 0) - (fa.ball?.y ?? 0)
        ) > RELOCATE_BALL_JUMP)
    ) {
      // While geometry still belongs to the preceding frame, ownership must
      // also stay there. Switching to the new taker early creates a remote owner.
      ball.x = fa.ball?.x ?? ball.x;
      ball.y = fa.ball?.y ?? ball.y;
      ball.z = fa.ball?.z ?? ball.z;
      ball.owner = fa.ball?.owner ?? null;
      ball.state = fa.ball?.state || null;
    }
    ball.restartType = t < 0.5
      ? fa.ball?.restartType || null
      : fb.ball?.restartType || null;
    if (ball.owner) {
      for (const p of players) p.hasBall = p.id === ball.owner;
    }
    // 插值本身已是 60fps 平滑，不再二次 soft（双重平滑会发糊/发飘）
    return this.applySimSnapshot(
      {
        t: (fa.t ?? 0) + ((fb.t ?? 0) - (fa.t ?? 0)) * t,
        ball,
        players,
        motionContext: t < 0.5 ? fa.motionContext || null : fb.motionContext || null,
        endsSwapped: !!(t < 0.5 ? fa.endsSwapped : fb.endsSwapped),
      },
      { soft: false, interpolationSource }
    );
  }

  /**
   * 连续回放密集 sim 帧 —— 严格对齐 sim-viewer：
   *   simT += realDt * speed * rate * rateMul
   *   rateMul 由导演系统控制（射门前/进球/扑救慢镜）
   *
   * @param {Array} frames compactSimFrame[]  高光窗建议 10Hz（自适应录制已保证）
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
      const currentState = this.fsm.current();
      if (currentState === 'PRE_MATCH' || currentState === 'PAUSED' || currentState === 'HALF_TIME') {
        this.fsm.transition('PLAYING', 'SIM_DRIVEN');
      }
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
      // 段入场转场（必须在硬切之前）：跨段的入场会配一次显式剪辑提示。
      // 不这么做时，段首帧会走 sceneCut 分支，把 26 个实体一步按到新坐标上
      // ——实测相邻段隔 129.5~956.8 比赛秒、位移中位 44.9 m（整队瞬移的成因）。
      const entry = this._enterSegmentTransition(frames);
      sp._entryMode = entry.mode;
      this.applySimSnapshot(frames[0], { soft: false });
      // 记下本段结束的比赛秒，供下一段判断间隔。
      // ⚠ 这里刻意记 `tEnd0`（可能被重播覆写）而不是「真实高光窗终点」：
      //   `playFmmGoalReplay` 会用 climax+2 收尾再调进来，若改记真实窗终点，
      //   重播段播完后 `_segLastEndSimT` 会跳回真实窗尾，反而多出一次假跨段剪辑。
      //   代价是极少数相邻高光窗会因 gap ≤ 0 退化成 `first`（无剪辑提示）——
      //   那是两窗之间**只差十来秒**的情况，本来也谈不上「跳过了一段」。
      // 证据：`scripts/_segment-entry-trace.mjs`（记录 prevEnd 原始值 + 每帧游标）。
      this._segLastEndSimT = tEnd0;

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
          if (this.fsm.isIn('GOAL_SEQUENCE')) {
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
          this.fsm.isIn('GOAL_SEQUENCE') &&
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

        const minute = simMinuteOf(sp.simT);
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
      const fixture = opts.fixture;
      const homeId = fixture?.home || this.home?.id;
      const attHome =
        opts.attHome != null
          ? !!opts.attHome
          : opts.ev?.teamId
            ? opts.ev.teamId === homeId
            : true;
      const scorer =
        (opts.ev?.playerId && this.players.find((p) => p.id === opts.ev.playerId)) ||
        null;

      // 空间投影已有真实射门帧：禁止 _beginGoalBeat 瞬移重演，只做轻慢镜点缀
      if (this.simDrive || this._simPlay) {
        this.camMode = "follow";
        this.camBoostUntil = now + 1800;
        this.fsm.transition('GOAL_SEQUENCE', 'STRIKE');
        this.fieldEl?.classList.add("mp-replay-slow");
        if (scorer) {
          scorer.el.classList.add("scorer", "highlight");
          this._setFocus([scorer], 1600);
        }
        if (sp) {
          sp.eventRateMul = 0.55;
          sp.eventSlowUntil = now + 1200;
          sp.rateMul = Math.min(sp.rateMul || 1, 0.55);
          sp.directorPhase = "impact";
          sp.assistId = opts.ev?.assistId || sp.assistId || null;
          sp.scorerId = opts.ev?.playerId || scorer?.id || null;
        }
        // 约 1.2s 后清掉 slow 角标，避免整段高光都挂着紫色 SLOW-MO
        setTimeout(() => {
          if (!this._simPlay) this._clearDirectorChrome();
          else if (performance.now() > (this._simPlay.eventSlowUntil || 0)) {
            this.fieldEl?.classList.remove("mp-replay-slow");
          }
        }, 1300);
        return;
      }

      // 无真帧时：旧编舞助攻→射门→入网
      this.camMode = "follow";
      this.camBoostUntil = now + 4200;
      this.fsm.transition('GOAL_SEQUENCE', 'STRIKE');
      this._netHitDone = false;
      this.fieldEl?.classList.add("mp-replay-slow");
      this._beginGoalBeat(opts.ev || {}, { attHome, lang });
      this.setFmmTicker?.(
        lang === "en" ? "GOAL!!" : "入球了!!",
        "goal",
        0
      );
      if (sp) {
        sp.eventRateMul = 0.42;
        sp.eventSlowUntil = now + 2400;
        sp.rateMul = Math.min(sp.rateMul || 1, 0.42);
        sp.directorPhase = "impact";
        sp.assistId = opts.ev?.assistId || sp.assistId || null;
        sp.scorerId = opts.ev?.playerId || scorer?.id || null;
      }
      return;
    }

    if (kind === "save") {
      // 引擎的 save 事件带 `hold`：true = 干净抱住，false = 托出/拍出。
      // 实测抱住约占扑救的 29.5%（`holdP = 0.18 + 0.12*handling + 0.16*反应时间`），
      // 但这个字段过去**整个前端一次都没读过**：文案永远「精彩扑救」，
      // 姿势永远被强制成倒地扑救，于是三成的抱球被画成了扑出——
      // 用户的原话是「都没有接住过，都是扑救」，对画面成立，对模拟不成立。
      const held = !!opts.ev?.hold;
      this.camMode = "box";
      this.camBoostUntil = now + 2200;
      this.fieldEl?.classList.add("mp-replay-slow");
      if (this.replayBadgeEl) {
        this.replayBadgeEl.textContent = held
          ? lang === "en" ? "▶ CLAIMED" : "▶ 没收"
          : lang === "en" ? "▶ SAVE" : "▶ 扑救";
        this.replayBadgeEl.classList.remove("hidden");
      }
      this.setCaption(
        held
          ? lang === "en" ? "CLAIMED IT" : "稳稳抱住"
          : lang === "en" ? "GREAT SAVE" : "精彩扑救",
        "save",
        1600
      );
      // save 事件的 playerId 就是做出扑救的门将（match.js 把引擎的 agentId 映射过来）。
      // 兜底不能只找「第一个门将」——那有一半概率是对方门将，动作会画在错误的一端。
      // ev.teamId 是扑救方，据此挑对应门将；再退一步才用离球最近的门将。
      const savingSide = opts.ev?.teamId
        ? opts.ev.teamId === (opts.fixture?.home || this.home?.id)
          ? "home"
          : "away"
        : null;
      const keepers = this.players.filter((p) => p.pos === "GK" || p.role === "GK");
      const gk =
        (opts.ev?.playerId && this.players.find((p) => p.id === opts.ev.playerId)) ||
        (savingSide && keepers.find((p) => p.team === savingSide)) ||
        keepers.sort(
          (a, b) =>
            Math.hypot(a.x - this.ball.x, a.y - this.ball.y) -
            Math.hypot(b.x - this.ball.x, b.y - this.ball.y)
        )[0];
      if (gk) {
        gk.el.classList.add("highlight");
        this.highlightId = gk.id;
        this.flashUntil = now + 1800;
        this._setFocus([gk], 1600);
        // 表现层扑救倒地（sim 帧若未带 pose 时兜底）。
        // 高光/快速路径会跳帧，带 pose 的那一两帧可能整个被跳过，所以这里必须兜。
        // 时长 520 → 900ms：×2/×4 倍速下 520ms 的墙钟窗口基本看不见；
        // 引擎侧姿态本身是 0.55s 模拟时间，这里是画面停留，不影响判定。
        // ⚠ 但**抱住**的时候不能摆倒地：门将是站着把球没收的。
        //   以前这里无条件强制 dive，是「从来没接住过」这个观感的直接来源。
        const savePose = held ? "hold" : "dive";
        if (!gk.pose || gk.pose !== savePose) {
          gk.pose = savePose;
          gk.poseDir = (this.ball.x || 50) >= gk.x ? 1 : -1;
          // heading 必须一起给：新的扑救画法优先按 heading 决定伸展方向，
          // 留着上一次跑位的旧 heading 会让门将朝错误方向扑。
          gk.heading = Math.atan2(
            (this.ball.y ?? gk.y) - gk.y,
            (this.ball.x ?? gk.x) - gk.x
          );
          gk.poseUntil = now + 900;
        } else {
          gk.poseUntil = Math.max(gk.poseUntil || 0, now + 900);
        }
        // poseHold 告诉 applySimSnapshot：这段时间内不要因为「sim 帧没带姿态」
        // 就把扑救压掉（高光路径经常跳过带姿态的那几帧）。
        gk.poseHold = now + 900;
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
    if (!this.fsm.isIn('GOAL_SEQUENCE')) {
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
   * 高光段入场转场 —— 修掉「整队瞬移」的观感（推导见 SEGMENT_CUT_MS 上方）。
   *
   * 必须在 `applySimSnapshot(frames[0], …)` **之前**调用：它要先知道
   * 「上一段结束在哪个比赛秒」，才能判断这次入场是不是跨越了一段比赛。
   *
   * ⛔ 这里**刻意不做缓动**：整场实测的段间隔是 129.5 / 389.3 / 956.8 秒，
   * 无一落在「相邻」档，缓动分支不可能触发（详见 SEGMENT_CUT_MS 的注释）。
   * 而且缓动本身也是错的解法——45 m 位移摊到 0.7 s 等于 64 m/s 的扫掠。
   *
   * @param {Array} frames 即将播放的帧表
   * @returns {{mode:'cut'|'first', gapSec:number|null}}
   */
  _enterSegmentTransition(frames) {
    const t0 = Number(frames?.[0]?.t);
    const prevEnd = Number(this._segLastEndSimT);
    // 上一段结束的比赛秒。没有则说明是本场第一次入场（开球），
    // 那是「比赛开始」而不是「跳过了内容」，不需要剪辑提示。
    //
    // ⚠ 这里必须把「倒带」与「两窗相接」分开处理（`gap < 0` vs `gap === 0`）：
    //   旧实现把两者一起归到 first，理由是「倒带/相接都不该闪一下」。
    //   对**相接**成立（两窗本就连续，没有换场景）；对**倒带**恰恰相反：
    //   那是「进球重播从 climax+2 倒回 climax-5.5」—— 画面上是一次明确的换镜头。
    //   而倒带会让 `applySimSnapshot` 的 `sceneCut` 判定成立（simT < lastSimT），
    //   于是 relocate 缓动被显式关掉（`entity._relocAt = 0`），球和 26 个实体
    //   被一步按到新坐标 —— 既不淡场也不缓动，观众看到的就是**球凭空瞬移**。
    //   角球最容易撞上：它是进球/扑救之后最常见的下一事件，段与段紧邻。
    //
    //   证据链：
    //     · `scripts/_restart-teleport-probe.mjs`：角球搬运球位移中位 14.37 单位
    //       （≈15 m），远超 `RELOCATE_BALL_JUMP = 6`，只要缓动武装就该被缓动。
    //     · `scripts/_segment-entry-trace.mjs` 头部已记录：重播回跳被当成 gap，
    //       `_segLastEndSimT` 停在 climax+2，后续窗判 `gap <= 0` → mode "first"。
    //     · `js/matchview.js` 的 sceneCut 定义含 `simT < lastSimT - 1e-6`（倒带）。
    //
    //   注意：**不给段首加缓动**。倒带时球是从「进球后」缓动回「5.5 秒前」，
    //   那是倒着飞回去，比硬切更怪；正确解法是让淡场把它讲成换镜头。
    if (!Number.isFinite(prevEnd) || !Number.isFinite(t0)) {
      return { mode: "first", gapSec: null };
    }
    const gapSec = t0 - prevEnd;
    // gap === 0：两窗几乎相接（本来是连续的），不需要剪辑提示。
    if (gapSec === 0) return { mode: "first", gapSec };
    // gap < 0：倒带重播 —— 明确的换镜头，必须淡场，否则球被硬置。
    // gap > 0：跨段跳帧 —— 原本就走剪辑。
    this._playSegmentCut();
    return { mode: "cut", gapSec };
  }

  /** 一次短暂的场景切换提示：淡场，明确告诉观众「换镜头了」 */
  _playSegmentCut() {
    const el = this.fieldEl;
    if (!el) return;
    el.classList.remove("mp-seg-cut");
    // 强制重排，保证连续两次剪辑都能重放动画
    void el.offsetWidth;
    el.classList.add("mp-seg-cut");
    if (this._segCutTimer) clearTimeout(this._segCutTimer);
    this._segCutTimer = setTimeout(() => {
      el.classList.remove("mp-seg-cut");
      this._segCutTimer = null;
    }, SEGMENT_CUT_MS + 40);
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
        if (this.fsm.isIn('GOAL_SEQUENCE')) {
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
        // 进球慢镜略收：迷你球场上 0.38 太「电影预告片」，易与真帧脱节
        scriptMul = isBig ? 0.52 : isSave ? 0.45 : isChance ? 0.5 : 0.58;
        if (isBig || isSave) this.fieldEl?.classList.add("mp-replay-slow");
        if (isBig && sp.scorerId) {
          const sc = this.players.find((p) => p.id === sp.scorerId);
          if (sc) this._setFocus([sc], 1800);
        }
      } else if (after < (isBig ? 1.6 : isSave ? 1.8 : 1.2)) {
        sp.directorPhase = "impact";
        this.camMode = wide ? "follow" : "box";
        scriptMul = isBig ? 0.58 : isSave ? 0.52 : 0.65;
        // 入网后尽快去掉 SLOW-MO 角标，让庆祝/复位更干净
        if (isBig && after > 0.55) {
          this.fieldEl?.classList.remove("mp-replay-slow");
        }
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
   * @param {{ onPlayerClick?: (playerId, team) => void, onMotionStatus?: (status: object) => void, cameraPreset?: string, broadcastContext?: object }} [opts]
   */
  mount(home, away, opts = {}) {
    this.home = home;
    this.away = away;
    if (opts.onPlayerClick) this.onPlayerClick = opts.onPlayerClick;
    if (opts.onMotionStatus) this.onMotionStatus = opts.onMotionStatus;
    this.motionMonitor.reset({
      home: { id: home?.id || null, name: home?.name || null, color: home?.color || null },
      away: { id: away?.id || null, name: away?.name || null, color: away?.color || null },
    });
    this._motionStatusKey = "0:0";
    this._notifyMotionStatus(true);
    this.setBroadcastContext(opts.broadcastContext || {});
    let storedCamera = opts.cameraPreset;
    if (!storedCamera) {
      try {
        storedCamera = localStorage.getItem("vcfm-match-camera");
      } catch {
        storedCamera = null;
      }
    }
    this.cameraPreset = normalizeCameraPreset(storedCamera);
    this.root.innerHTML = "";
    this.root.classList.add("match-pitch-root");
    this.trails = [];

    const wrap = document.createElement("div");
    wrap.className = "mp-wrap";

    wrap.innerHTML = `
      <div class="mp-pitch-slot">
      <div class="mp-field mp-fmm2d" id="mp-field">
        <!-- FMM 上下看台（横向球场，球门在左右） -->
        <div class="mp-stands top" aria-hidden="true"></div>
        <div class="mp-stands bot" aria-hidden="true"></div>
        <div class="mp-end-label mp-end-away" id="mp-end-away">AWAY</div>
        <div class="mp-end-label mp-end-home" id="mp-end-home">HOME</div>
        <div class="mp-camera" id="mp-camera">
          <div class="mp-grass"></div>
          <div class="mp-goal-mouth left" aria-hidden="true"></div>
          <div class="mp-goal-mouth right" aria-hidden="true"></div>
          <div class="mp-poss-half" id="mp-poss-half" aria-hidden="true"></div>
          <div class="mp-form-zones" id="mp-form-zones" aria-hidden="true"></div>
          <div class="mp-attack-arrow" id="mp-attack-arrow" aria-hidden="true"></div>
          <svg class="mp-lines" viewBox="0 0 150 100" preserveAspectRatio="none" aria-hidden="true">
            <!-- 横向球场：screenX=100-engineY、screenY=engineX。viewBox 宽 150 = 球场长
                 105 m（engine y × 1.5），高 100 = 球场宽 68 m（engine x）。主队球门在左
                 （y=100 → x=0），客队在右（y=0 → x=150）。禁区必须与 _inOwnFoulBox
                 （x 22-78、home y>=84）逐格对齐。
                 注意：本段位于 innerHTML 模板字符串内，注释里不得出现反引号或美元花括号插值。 -->
            <rect x="0.35" y="0.35" width="149.3" height="99.3" fill="none" stroke="rgba(255,255,255,0.78)" stroke-width="0.7"/>
            <line x1="75" y1="0.35" x2="75" y2="99.65" stroke="rgba(255,255,255,0.7)" stroke-width="0.55"/>
            <!-- 中圈半径 9.15 m。横向后 x 沿球场长、y 沿球场宽，椭圆轴对调：
                 rx=9.15/105*150、ry=9.15/68*100。 -->
            <ellipse cx="75" cy="50" rx="13.07" ry="13.46" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <circle cx="75" cy="50" r="0.85" fill="rgba(255,255,255,0.9)"/>
            <!-- 左侧（主队防守）：大禁区 engine x22-78 / y84-100 → SVG x 0-24、y 22-78 -->
            <rect x="0.35" y="22" width="23.65" height="56" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <rect x="0.35" y="36.53" width="7.51" height="26.94" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <path d="M 24 39.6 A 13.07 13.46 0 0 1 24 60.4" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.5"/>
            <circle cx="15.71" cy="50" r="0.6" fill="rgba(255,255,255,0.75)"/>
            <line x1="0.35" y1="44" x2="0.35" y2="56" stroke="rgba(255,255,255,0.92)" stroke-width="1.4"/>
            <!-- 右侧（客队防守） -->
            <rect x="126" y="22" width="23.65" height="56" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <rect x="142.14" y="36.53" width="7.51" height="26.94" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
            <path d="M 126 39.6 A 13.07 13.46 0 0 0 126 60.4" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.5"/>
            <circle cx="134.29" cy="50" r="0.6" fill="rgba(255,255,255,0.75)"/>
            <line x1="149.65" y1="44" x2="149.65" y2="56" stroke="rgba(255,255,255,0.92)" stroke-width="1.4"/>
            <!-- 角球弧半径 1 m -->
            <path d="M 1.78 0.35 A 1.43 1.47 0 0 1 0.35 1.82" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>
            <path d="M 0.35 98.18 A 1.43 1.47 0 0 1 1.78 99.65" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>
            <path d="M 148.22 0.35 A 1.43 1.47 0 0 0 149.65 1.82" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>
            <path d="M 149.65 98.18 A 1.43 1.47 0 0 0 148.22 99.65" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="0.5"/>
          </svg>
          <div class="mp-heat" id="mp-heat" aria-hidden="true"></div>
          <svg class="mp-press" id="mp-press" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <svg class="mp-network" id="mp-network" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
          <svg class="mp-trails" id="mp-trails" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
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
      </div>
      <!-- FMM 底栏：解说文案 ↔ 控球条（互斥） -->
      <div class="mp-fmm-dock" id="mp-fmm-dock">
        <div class="mp-bench-strip" id="mp-bench-strip" aria-label="Substitutes">
          <span class="mp-bench-side home" aria-hidden="true">主</span>
          <div class="mp-bench-list home" id="mp-bench-home"></div>
          <span class="mp-bench-divider" aria-hidden="true"></span>
          <div class="mp-bench-list away" id="mp-bench-away"></div>
          <span class="mp-bench-side away" aria-hidden="true">客</span>
        </div>
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
    this.benchStripEl = wrap.querySelector("#mp-bench-strip");
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
    // 球门方向标签（主队守左、客队守右 — 横向 FM 2D）
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
    // 替补席重绘要用到球衣色（换人后 _spawnBench 会被再调一次）
    this._benchKits = {
      home: { club: home, color: homeKit.primary, numColor: homeNum },
      away: { club: away, color: awayPrimary, numColor: awayNum },
    };
    this._spawnBench(home, true, homeKit.primary, homeNum);
    this._spawnBench(away, false, awayPrimary, awayNum);
    this._applyPossessionBarKit(homeKit.primary, awayPrimary);
    this._buildFormationZones();

    const ballEl = document.createElement("div");
    ballEl.className = "mp-ball";
    actors.appendChild(ballEl);
    this.ball = { x: 50, y: 50, tx: 50, ty: 50, el: ballEl };
    this._applyBall();
    this._spawnOfficials(actors);

    this.cam = { x: 0, y: 0, tx: 0, ty: 0, scale: 1, tScale: 1 };
    this._everPlayed = false; // A2 收尾：死球镜头策略在开赛/开赛前分叉（见 _updateCameraTarget）
    this._officialsSimT = null;
    this._playCentre = null;
    this._relocLastSimT = null;
    this._lastDeflectionKey = null;
    this._segLastEndSimT = null;
    this._segCutTimer = null;
    this.setCameraPreset(this.cameraPreset, { persist: false });
    this._applyCamera();
    this.endsSwapped = false;
    this._endsSwapAnnounced = false;
    this._applyEndsChrome();

    this._built = true;
    // 赛前站位：静止，等 kickoff 再进入 play（修复未开赛就跑动）
    this.fsm.transition('PRE_MATCH');
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
    this.simDrive = false;  // 重置 SimEngine 模式，使用导演 AI
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

  _ensureCrowdBed(ctx) {
    if (!ctx || this._crowdBed) return this._crowdBed;
    try {
      const seconds = 2;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let low = 0;
      for (let index = 0; index < data.length; index++) {
        low = low * 0.985 + (Math.random() * 2 - 1) * 0.075;
        data[index] = clamp(low + (Math.random() * 2 - 1) * 0.08, -1, 1);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 760;
      filter.Q.value = 0.45;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      const pan = typeof ctx.createStereoPanner === "function" ? ctx.createStereoPanner() : null;
      source.connect(filter);
      filter.connect(gain);
      if (pan) {
        gain.connect(pan);
        pan.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }
      source.start();
      this._crowdBed = { source, filter, gain, pan };
    } catch {
      this._crowdBed = null;
    }
    return this._crowdBed;
  }

  _raiseCrowd(kind) {
    const reactions = {
      goal: { value: 0.5, duration: 6500 },
      cheer: { value: 0.34, duration: 5200 },
      save: { value: 0.2, duration: 2500 },
      whistle: { value: 0.08, duration: 1200 },
      card: { value: 0.12, duration: 2200 },
      kick: { value: 0.04, duration: 700 },
    };
    const next = reactions[kind];
    if (!next) return;
    const now = performance.now();
    const current = this._crowdReaction?.until > now ? this._crowdReaction.value : 0;
    this._crowdReaction = {
      value: Math.max(current, next.value),
      duration: next.duration,
      until: Math.max(this._crowdReaction?.until || 0, now + next.duration),
    };
  }

  _updateCrowdAtmosphere(nowMs = performance.now()) {
    const ctx = this._audioCtx;
    if (!ctx || !this._crowdBed || nowMs - this._crowdLastUpdate < 120) return;
    this._crowdLastUpdate = nowMs;
    const reactionState = this._crowdReaction || { value: 0, until: 0, duration: 1 };
    const reaction = reactionState.until > nowMs
      ? reactionState.value * clamp((reactionState.until - nowMs) / Math.max(1, reactionState.duration), 0, 1)
      : 0;
    const minute = this._simPlay?.simT != null
      ? simMinuteOf(this._simPlay.simT)
      : Number(this._broadcastMinute) || 0;
    const atmosphere = crowdAtmosphere({
      context: this._broadcastContext,
      ball: this.ball,
      ownerTeam: this.carrier?.team || null,
      minute,
      homeGoals: this._broadcastScore?.home || 0,
      awayGoals: this._broadcastScore?.away || 0,
      reaction,
    });
    const active = this.fsm.canAIAct() || this.fsm.isIn('GOAL_SEQUENCE');
    const targetGain = this._sfxMuted ? 0.0001 : (active ? 0.0025 : 0.001) + atmosphere.intensity * (active ? 0.018 : 0.006);
    this._crowdBed.gain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.32);
    if (this._crowdBed.pan) {
      this._crowdBed.pan.pan.setTargetAtTime(atmosphere.pan, ctx.currentTime, 0.28);
    }
  }

  /**
   * @param {'goal'|'whistle'|'card'|'save'|'kick'|'cheer'} kind
   */
  playSfx(kind) {
    const ctx = this._ensureAudio();
    if (!ctx) return;
    this._ensureCrowdBed(ctx);
    this._raiseCrowd(kind);
    this._updateCrowdAtmosphere();
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
    this.setCaption(line, "info", KEY_EVENT_MS);
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
    // ⚠ 离场标记必须清掉：这里是**身份替换 + 复用同一个 DOM 元素**，
    //   不是新建元素。被换下的若是罚下/伤退者（引擎的 `sentOff` / `injuredOff`），
    //   他的 `.sent-off` / `.injured` 会**被新上场的球员继承** ——
    //   表现为「刚换上来的人一登场就是淡出的、不可点、还不被画到画布上」。
    //   （`.sent-off` 还有第二道保险：`applySimSnapshot` 每帧按新 id 查到
    //   `sentOff === false` 会自动 toggle 掉；但 `.injured` 是纯表现层标记，
    //   引擎不导出，只能在这里清。）
    pl.el.classList.remove("sent-off", "injured");
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
    // 替补席必须跟着换人走：旧实现只在 mount() 里画一次，整场都是开场快照，
    // 已登场的替补仍留在席上，看起来像同队重号。
    this._subbedOn = this._subbedOn || new Set();
    this._subbedOff = this._subbedOff || new Set();
    this._subbedOn.add(inId);
    this._subbedOff.add(outId);
    this._refreshBench(pl.team);
    return { outName, inName: inn.name };
  }

  /** 换人后重绘一侧替补席 */
  _refreshBench(side) {
    const kit = this._benchKits?.[side === "home" ? "home" : "away"];
    if (!kit?.club) return;
    this._spawnBench(kit.club, side === "home", kit.color, kit.numColor);
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
    this.fsm.transition('PLAYING', 'FREE_PLAY');
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
      if (!this.fsm.canAIAct()) return;
      this._beginAftermath({
        flipPossession: !!opts.flipPossession,
        toGk: !!opts.toGk,
      });
    }, delay);
  }

  _beginAftermath({ flipPossession = false, toGk = false } = {}) {
    if (!this.fsm.canAIAct()) return;
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
          if (!this._built || !this.fsm.canAIAct()) return;
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

  /**
   * 进场动画：两队从各自一侧场边跑入阵型位（用户 2026-09-19 提出）。
   *
   * ⚠️ 为什么必须画在 canvas 而不是用 DOM/CSS（第一版返工的原因）
   * ------------------------------------------------------------
   * 第一版是纯 CSS 动画：给 `.mp-field` 挂 class，用 `transform` 推
   * `.mp-player`。**单测全绿但画面上毫无变化** —— 真因是本项目的球员
   * 不是 DOM 画的：`_initCanvas()` 无条件加 `mp-canvas-mode`，该模式下
   * `.mp-actors .mp-player` 的 `mp-dot`/`mp-name`/`mp-shadow` 全被
   * `opacity: 0 !important; visibility: hidden !important` 隐藏，DOM
   * 球员只是**点击热区**。而且那条选择器（0,3,1）优先级高于
   * `.mp-intro .mp-player`（0,2,1），我的 `opacity: 0.35` 被直接压回 1。
   *
   * 所以入场位移做在这里：`_introOffsetX()` 给 `_drawCanvas` 里每名球员
   * 的**屏幕 x 像素**叠加一个按错峰衰减的偏移。玩家看到的才是真位移。
   *
   * 为什么不动引擎
   * --------------
   * 「球员走进球场」是纯观看体验。引擎的 `_kickoff` 已把 22 人摆在合法
   * 开球位，**不该为了动画再动他们**（那会改随机流、让全部基线失效）。
   * 这里只改 canvas 的绘制坐标，引擎与模拟状态一个字节都不改。
   *
   * 时长与跳过
   * ----------
   * 默认 2s，可被「点击球场 / 按任意键」立即结束。立即结束不是硬切，
   * 而是把剩余偏移按 0.16s 快速收拢（`planSkip`）。
   *
   * @param {number} ms 总时长；≤0 ⇒ 跳过（直接到位）
   * @returns {Promise<void>} 动画结束（或被打断）后 resolve
   */
  playPlayerIntro(ms = 2000) {
    // 「进行中」用独立标志守卫：跳过时 `_introCleanup` 会同步置空，但真正
    // 的收拢还要 200ms。若用后者做守卫，这 200ms 窗口内再次调用会重入。
    if (this._introPlaying) return Promise.resolve();
    const players = this.players || [];
    if (!players.length) return Promise.resolve();

    // 「无动画」偏好：系统设置了减少动态效果就直接跳过。
    // 这既是无障碍要求，也顺手给了自动化测试一个确定性的旁路。
    let reduceMotion = false;
    try {
      reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    } catch (_) {
      reduceMotion = false;
    }
    const plan = planIntro(ms);
    if (reduceMotion || plan.skip) {
      this._introStartAt = null;
      this._introPlan = null;
      return Promise.resolve();
    }

    // 时序规划交给纯函数模块 `matchview-intro.js`（可单测，见
    // `js/matchview-intro.test.js`）。这里只负责照着计划推进时间轴
    // 与渲染偏移。
    this._introPlan = plan;
    this._introStartAt = performance.now();
    // 错峰基准：按「本队第几名」排，而不是全局索引 —— 全局索引会把主队
    // 与客队的错峰混在一起（`players` 是先主后客的连续数组）。
    this._introIndex = new Map();
    {
      const counter = { home: 0, away: 0 };
      for (const pl of players) {
        const key = pl.team === "home" ? "home" : "away";
        this._introIndex.set(pl, counter[key]++);
      }
    }

    const timers = [];
    let onSkip = () => {};
    return new Promise((resolve) => {
      let settled = false;
      /** 结束：fast=true 由用户跳过（快速收拢），false 为正常跑完 */
      const finish = (fast) => {
        if (settled) return;
        settled = true;
        const skipPlan = planSkip();
        // 快速收拢：以「当前这一刻」为新起点，用 0.16s 把剩余偏移归零。
        // 不能硬切（直接 `_introStartAt = null`）——22 人瞬间闪现到阵型位
        // 比动画本身更突兀。
        if (fast) {
          const remainY = this._introOffsetRatio
            ? this._introOffsetRatio(performance.now())
            : 0;
          this._introFast = { t0: performance.now(), ratio: remainY, dur: skipPlan.runSeconds * 1000 };
        }
        const tail = fast ? skipPlan.tailMs : plan.tailMs;
        timers.push(
          window.setTimeout(() => {
            this._introStartAt = null;
            this._introPlan = null;
            this._introFast = null;
            this._introIndex = null;
            this._introCleanup = null;
            this._introPlaying = false;
            window.removeEventListener("keydown", onSkip);
            this.fieldEl?.removeEventListener("pointerdown", onSkip);
            for (const t of timers) window.clearTimeout(t);
            resolve();
          }, tail),
        );
      };
      onSkip = () => finish(true);
      this._introCleanup = onSkip;
      this._introPlaying = true;
      this.fieldEl?.addEventListener("pointerdown", onSkip);
      window.addEventListener("keydown", onSkip);
      // 正常结束：从 t0 起算。
      // `plan.totalMs` = 位移占用与目标时长取大者（已含起止，不含 tail 收尾）。
      // ⚠️ 这里容易写错：曾经把 `plan.holdMs`（语义是「位移跑完后**还要**
      // 保持多久」）当总时长用，导致 ms=700 这种「位移刚好占满、holdMs=0」
      // 的场景在 0ms 就收尾（实测 153ms 结束，而位移需要 697ms ⇒ 球员跑到
      // 一半被掐断）。用 totalMs 则始终覆盖位移本身。
      const t0 = performance.now();
      const advance = (now) => {
        if (settled) return;
        const remain = Math.max(0, plan.totalMs - (now - t0));
        timers.push(
          window.setTimeout(() => {
            if (!settled) finish(false);
          }, remain),
        );
      };
      const raf = window.requestAnimationFrame?.bind(window);
      if (raf) raf(advance);
      else timers.push(window.setTimeout(() => advance(performance.now()), 16));
    });
  }

  /**
   * 计算某名球员当前的**横向入场偏移**（屏幕像素，负 = 向左）。
   *
   * 在 `_drawCanvas` 里被逐帧调用（只在动画进行中）。返回 0 表示已到位。
   *
   * 观感设计：
   * - 主队守左 ⇒ 从左往右跑入，偏移为负（画在真实位置左侧）；客队相反。
   * - 幅度取球场宽度的 6%：最远的是门将（engine y≈97 → 画面最左），至少要 3%
   *   才在场外，6% 留出余量，看起来是「从端线外跨进来」。
   * - 错峰：每名球员有自己的延迟（`staggerDelay`），22 人依次跑出，
   *   而不是一坨人同时弹进来。
   *
   * @param {object} pl 球员记录（`this.players` 里的元素，用于查错峰序号）
   * @param {number} drawIndex 在绘制列表里的下标（仅作 `_introIndex` 缺失时的兜底）
   * @param {number} w 球场画布宽度（像素）
   * @returns {number} 像素偏移
   */
  _introOffsetX(pl, drawIndex, w) {
    const plan = this._introPlan;
    if (!plan || this._introStartAt == null) return 0;
    const isHome = pl.team === "home";

    // 快速收拢阶段：把「跳过那一刻的剩余比例」在 0.16s 内线性归零。
    if (this._introFast) {
      const f = this._introFast;
      const p = Math.min(1, (performance.now() - f.t0) / f.dur);
      const ratio = f.ratio * (1 - p);
      return (isHome ? -1 : 1) * ratio * w * 0.06;
    }

    const elapsed = performance.now() - this._introStartAt;
    // 错峰：用「本队第几名」算延迟，再按 plan 的缩放系数压缩。
    // ⚠️ 必须按**球员对象**查 `_introIndex`，不能拿 drawIndex 去索引
    // `this.players` —— 绘制列表过滤掉了被罚下的球员，两者下标会错位，
    // 一旦有人 red card，后面所有人的错峰序号就整体偏了。
    const within = this._introIndex?.get(pl) ?? drawIndex;
    const delayMs = staggerDelay(within, isHome) * plan.staggerScale * 1000;
    // 位移时长（毫秒）：plan.runSeconds 是本队位移补间时长。
    const runMs = plan.runSeconds * 1000;
    if (elapsed <= delayMs) return (isHome ? -1 : 1) * w * 0.06;
    const t = Math.min(1, (elapsed - delayMs) / runMs);
    // 缓出（ease-out cubic）：起步快、收尾稳，像真的「跑到位站住」。
    const eased = 1 - Math.pow(1 - t, 3);
    return (isHome ? -1 : 1) * (1 - eased) * w * 0.06;
  }

  /** 当前剩余偏移比例（0..1），供 skip 时衔接快速收拢 */
  _introOffsetRatio(now) {
    const plan = this._introPlan;
    if (!plan || this._introStartAt == null) return 0;
    const elapsed = now - this._introStartAt;
    const runMs = plan.runSeconds * 1000;
    // 取「位移进度最慢的那名球员」作为剩余比例上限（保证收拢不突变）。
    let remain = 0;
    for (const pl of this.players || []) {
      const within = this._introIndex?.get(pl) ?? 0;
      const isHome = pl.team === "home";
      const delayMs = staggerDelay(within, isHome) * plan.staggerScale * 1000;
      const t = Math.min(1, Math.max(0, (elapsed - delayMs) / runMs));
      const eased = 1 - Math.pow(1 - t, 3);
      remain = Math.max(remain, 1 - eased);
    }
    return remain;
  }

  /** 立即结束进场动画（供外部：比赛被推进 / 切换视图 / 卸载时调用） */
  skipPlayerIntro() {
    const fn = this._introCleanup || this._introFinish;
    if (typeof fn === "function") fn();
  }

  /** 音效开关 */
  setSfxMuted(v) {
    this._sfxMuted = !!v;
    try {
      localStorage.setItem("vcfm_sfx_muted", this._sfxMuted ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this._audioCtx && this._crowdBed) {
      const target = this._sfxMuted ? 0.0001 : 0.008;
      this._crowdBed.gain.gain.setTargetAtTime(target, this._audioCtx.currentTime, 0.08);
    }
  }

  isSfxMuted() {
    return !!this._sfxMuted;
  }

  setBroadcastState({ minute, homeGoals, awayGoals } = {}) {
    if (Number.isFinite(Number(minute))) this._broadcastMinute = Number(minute);
    if (Number.isFinite(Number(homeGoals))) this._broadcastScore.home = Number(homeGoals);
    if (Number.isFinite(Number(awayGoals))) this._broadcastScore.away = Number(awayGoals);
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
    if (!this._built || !ev || this.fsm.is('PRE_MATCH') || this.fsm.is('IDLE')) return;
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
    this.fsm.transition('PLAYING', 'SCRIPTED');
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
  _nudgeAttackShape(team, amount = 0.4, random = Math.random) {
    const dir = this._attackDir(team);
    const a = clamp(amount, 0.1, 0.65);
    for (const pl of this.players) {
      if (pl.team !== team || pl.el.classList.contains("sent-off")) continue;
      if (pl === this.carrier) continue;
      const push = pl.pos === "ATT" ? 4.5 : pl.pos === "MID" ? 3 : pl.pos === "DEF" ? 1.1 : 0.15;
      // 以 base 为主，轻微前压 — 更贴阵型
      pl.tx = clamp(lerp(pl.baseX, pl.x, 0.15) + (random() - 0.5) * 1.2, 6, 94);
      pl.ty = clamp(pl.baseY + dir * push * a + (random() - 0.5) * 0.8, 5, 95);
    }
  }

  /** 防守方：后卫追球深度 + 中前场按球回撤（不再锁死 baseY） */
  _nudgeDefendShape(team, toward, random = Math.random) {
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
      pl.tx = clamp(lerp(pl.baseX, tx, ballW) + (random() - 0.5) * 2.5, 8, 92);
      pl.ty = clamp(lerp(pl.baseY, lineY, 0.72) + (random() - 0.5) * 2, 6, 94);
    }

    for (const pl of mids) {
      const lineY =
        team === "home"
          ? clamp(ty - 22, 48, 80)
          : clamp(ty + 22, 20, 52);
      pl.tx = clamp(lerp(pl.baseX, tx, 0.22) + (random() - 0.5) * 2, 10, 90);
      pl.ty = clamp(lineY + (random() - 0.5) * 3, team === "home" ? 46 : 18, team === "home" ? 82 : 54);
    }
    for (const pl of atts) {
      const lineY =
        team === "home"
          ? clamp(Math.max(48, ty - 34), 46, 68)
          : clamp(Math.min(52, ty + 34), 32, 54);
      pl.tx = clamp(lerp(pl.baseX, 50, 0.2) + (random() - 0.5) * 4, 12, 88);
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
    if (this.fsm.canAIAct() && this.ballState === "free" && !this.carrier) {
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
    if (!this._built || !this.fsm.canAIAct()) return;
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
    if (!this.fsm.canAIAct()) return;
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
    if (!ev || !this.fsm.canAIAct()) return;
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

  setCameraPreset(value, { persist = true } = {}) {
    this.cameraPreset = normalizeCameraPreset(value);
    if (persist) {
      try {
        localStorage.setItem("vcfm-match-camera", this.cameraPreset);
      } catch {
        /* ignore */
      }
    }
    if (this.fieldEl) {
      this.fieldEl.dataset.cameraPreset = this.cameraPreset;
      this.fieldEl.classList.toggle("mp-camera-tactical", this.cameraPreset === "tactical");
      this.fieldEl.classList.toggle("mp-camera-full", this.cameraPreset === "full");
      this.fieldEl.classList.toggle("mp-camera-tv", this.cameraPreset === "tv");
    }
    if (this.cameraPreset !== "tv") {
      this.cam.tx = 0;
      this.cam.ty = 0;
      this.cam.tScale = 1;
    }
    this._drawCanvas?.();
    return this.cameraPreset;
  }

  getCameraPreset() {
    return normalizeCameraPreset(this.cameraPreset);
  }

  setBroadcastContext(context = {}) {
    const capacity = Number(context.capacity);
    const attendance = Number(context.attendance);
    const attendanceRatio =
      Number.isFinite(attendance) && Number.isFinite(capacity) && capacity > 0
        ? attendance / capacity
        : Number(context.attendanceRatio);
    this._broadcastContext = {
      ...(this._broadcastContext || {}),
      ...context,
      attendanceRatio: Number.isFinite(attendanceRatio)
        ? clamp(attendanceRatio, 0.35, 1)
        : this._broadcastContext?.attendanceRatio || 0.84,
    };
  }

  setOnPlayerClick(fn) {
    this.onPlayerClick = fn;
  }

  setOnMotionStatus(fn) {
    this.onMotionStatus = typeof fn === "function" ? fn : null;
    this._notifyMotionStatus(true);
  }

  getMotionDiagnosticStatus() {
    return this.motionMonitor.status();
  }

  createMotionClip(options = {}) {
    return this.motionMonitor.captureClip(options);
  }

  _notifyMotionStatus(force = false) {
    const status = this.motionMonitor.status();
    const key = `${status.frames}:${status.incidents}`;
    if (!force && key === this._motionStatusKey) return;
    this._motionStatusKey = key;
    try {
      this.onMotionStatus?.(status);
    } catch (error) {
      console.warn("motion status", error);
    }
  }

  _recordMotionDiagnostic(engineFrame, interpolationSource = null) {
    if (!engineFrame?.players?.length || !engineFrame.ball) return;
    const displayFrame = {
      t: engineFrame.t,
      ball: {
        x: this.ball.x,
        y: this.ball.y,
        z: this.ball.z || 0,
        owner: this.carrier?.id || null,
        state: this.ballState === "flight" ? "pass" : this.ballState,
        restartType: engineFrame.ball.restartType || null,
        shotAt: engineFrame.ball.shotAt ?? null,
      },
      players: this.players.map((player) => ({
        id: player.id,
        team: player.team,
        role: player.pos,
        num: player.num,
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        heading: player.heading,
        fsm: player.fsm || null,
        shapePhase: player.shapePhase || null,
        movementTarget: player.movementTarget || null,
        defensiveJob: player.defensiveJob || null,
        sentOff: player.el.classList.contains("sent-off"),
      })),
      motionContext: engineFrame.motionContext || null,
    };
    this.motionMonitor.record(engineFrame, displayFrame, {
      cameraPreset: this.cameraPreset,
      replay: !!(this._fmmReplay?.active || this._simPlay?.label === "replay"),
      label: this._simPlay?.label || null,
      interpolationSource,
    });
    this._notifyMotionStatus();
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
      // 门将用醒目球衣色，场上不会「找不着门将」。
      // 客队旧值 #a3e635（黄绿）画在绿草皮上对比度很差，换成品红 #e879f9：
      // 绿场上没有相近色，且与主队门将的琥珀色互相可分。
      const rolePos = slot.pos || p?.pos || "MID";
      const isGk = rolePos === "GK";
      const dotBg = isGk ? (isHome ? "#eab308" : "#e879f9") : color;
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
      // 死球站位（赛前 / 中场 / 完场）：baseY 是运动战纵深，前锋本来就站在
      // 对方半场，直接拿来当赛前阵型会出现「开赛前前锋已经杵在对方小禁区」。
      // 与 SimEngine 的 _kickoff 用同一套压缩：整队收回本方半场，且全员退出
      // 中圈（半径 9.15m ≈ 8.7 个纵向单位，对应 40.5 / 59.5 两条边界）。
      const preX = baseX;
      const preY = isHome
        ? Math.max(50 + baseY * 0.48, 59.5)
        : Math.min(baseY * 0.48, 40.5);
      // 个人防区半径：球进入才离开阵型位（参考 FM 区域职责）
      const zoneR =
        rolePos === "GK" ? 16 : rolePos === "DEF" ? 20 : rolePos === "MID" ? 26 : 22;
      this.players.push({
        id: p?.id,
        player: p,
        club,
        team: isHome ? "home" : "away",
        el,
        // 初始就是赛前站位；baseX/baseY 保留为运动战阵型基准（导演层仍在用）
        x: preX,
        y: preY,
        tx: preX,
        ty: preY,
        baseX,
        baseY,
        preX,
        preY,
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

  /**
   * 比赛官员（主裁 + 两名边裁）——纯表现层。
   *
   * 引擎已完整实现裁判规则（越位按出脚瞬间快照、手球、点球、VAR），但**场上不存在
   * 裁判这个对象**：判罚是全局精确计算的，没有视野、没有站位影响。这里只把已经
   * 发生的判罚「配上人」，**不反向影响任何判定**，所以不碰 24 场标定。
   *
   * 坐标约定（从 `_offsideLineY` 反推确认）：主队攻向 y=0、客队攻向 y=100，
   * 即客队球门在 y≈0、主队球门在 y≈100。
   *
   * 边裁按真实分工站**对角两条边线**，各负责一半场地，位置跟随该半场的越位线——
   * 这正是真实边裁的职责（与倒数第二名防守者齐平）。好处是当进攻转到另一半场时，
   * 他会自然被拉回中线附近，不需要额外写「回撤」逻辑。
   */
  _spawnOfficials(actors) {
    if (!actors) return;
    // `label` 只是圆点里的一个字母（主裁 R / 边裁 A），让两种官员在场上可区分：
    // 光靠 16px 与 18px 的直径差、加一圈黄边，在跟镜里几乎读不出来。
    // 仍保持 aria-hidden：官员是纯装饰标记，不可点击、不承载比赛信息，
    // 把字母暴露给读屏只会在 22 名球员之间插进三个无意义的朗读点。
    const make = (cls, label, x, y) => {
      const el = document.createElement("div");
      el.className = `mp-official ${cls}`;
      el.textContent = label;
      el.setAttribute("aria-hidden", "true");
      actors.appendChild(el);
      return { x, y, el };
    };
    this.officials = {
      // 主裁：对角线体系，跟球但保持距离，不站在球上
      referee: make("referee", "R", 42, 50),
      // 边裁 A：x≈3 边线，负责 y<50（上场，几何半场不随换边移动）
      assistantA: make("assistant", "A", 3, 32),
      // 边裁 B：x≈97 边线，负责 y>50（下场）。换边后改的是跟哪一队的越位线。
      assistantB: make("assistant", "A", 97, 68),
    };
    this._applyOfficials();
  }

  /** 把官员的逻辑坐标写到 DOM（与 `_applyPlayer` 同一套百分比定位） */
  _applyOfficials() {
    const o = this.officials;
    if (!o) return;
    for (const key of ["referee", "assistantA", "assistantB"]) {
      const m = o[key];
      if (!m?.el) continue;
      const s = pitchToScreenPct(m.x, m.y);
      m.el.style.left = `${s.left}%`;
      m.el.style.top = `${s.top}%`;
    }
  }

  /**
   * 每帧更新官员位置。只读 `this.ball` 与 `this.players`，不写任何球员/球状态。
   * `soft` 与球员同义：慢镜/直播下用指数平滑，避免硬切抖动。
   *
   * 主裁跟的是**局面重心**（`_playCentre`），不是球的瞬时位置。旧实现把目标点
   * 直接挂在 `this.ball` 上，于是球的每一次不连续都被原样传给主裁：长传飞行、
   * 死球摆位瞬移到角旗，看起来就是「主裁和球同步瞬移」。**先低通球位再算目标**，
   * 输入连续，输出就不可能瞬移。
   */
  _updateOfficials(soft = false, simDt = null, sceneCut = false) {
    const o = this.officials;
    if (!o) return;
    const bx = this.ball?.x ?? 50;
    const by = this.ball?.y ?? 50;

    // 局面重心：飞行中几乎不追球——真实主裁不跟着长传球跑，他跑向局面要去的地方。
    // 系数按 `_referee-motion-probe.mjs` 的档位曲线取 C 档（详见 MAX_OFFICIAL_STEP_M）：
    // 低通越强，路径越短、均速越低，代价是离球更远（实测距球中位 11.07 → 12.99m，
    // 而真实主裁离球 15~20m，所以这个方向本身也更真实）。
    if (sceneCut) this._playCentre = null;
    const play = (this._playCentre ??= { x: bx, y: by });
    // The movement constants are calibrated per 0.1s simulation tick, but
    // interpolation calls this method once per rendered frame. Scale both the
    // low-pass response and walking distance by simulation time so a 60fps
    // render loop cannot make the referee sprint tens of metres per second.
    const tickScale = Number.isFinite(simDt)
      ? clamp(simDt / 0.1, 0, 3)
      : 1;
    const track = this._isBallInFlight() ? 0.012 : soft ? 0.035 : 0.058;
    const trackNow = 1 - Math.pow(1 - track, tickScale);
    play.x += (bx - play.x) * trackNow;
    play.y += (by - play.y) * trackNow;

    // 恒速追击：本帧朝目标走 stepM 米，走不到就停在半路。
    // 刻意**不用** `residual * k` —— 那会让速度跟着残差走，残差又跟着球走。
    const moveTo = (m, tx, ty, stepM) => {
      // A skipped interval cuts the entire scene; officials join the new scene
      // at the same instant instead of running across the previous one.
      if (sceneCut) {
        m.x = clamp(tx, 1, 99);
        m.y = clamp(ty, 1, 99);
        return;
      }
      const dx = clamp(tx, 1, 99) - m.x;
      const dy = clamp(ty, 1, 99) - m.y;
      const dM = Math.hypot(dx * OFFICIAL_MX, dy * OFFICIAL_MY);
      if (dM < 1e-4) return;
      const s = Math.min(1, (stepM * tickScale) / dM);
      m.x += dx * s;
      m.y += dy * s;
    };

    // —— 主裁：对角线体系 ——
    // 真实主裁跑一条对角线，侧后方跟随，把球夹在自己与边裁之间。
    // 用 tanh 过渡而不是旧的 `bx >= 50 ? -1 : 1`：符号写法在球每次横穿中线时
    // 让目标 x 直接跳 22 格（纵向那一项同理跳 14 格），那正是肉眼看到的「瞬移」。
    // tanh 在中线平滑过零，两侧仍饱和到原来的 ±11 / ±7 偏移，几何意图不变。
    const lateral = -Math.tanh((play.x - 50) / 12); // 球偏右 → 裁判偏左
    const trail = -Math.tanh((play.y - 50) / 12); // 纵向朝中线滞后
    let tx = play.x + lateral * 11;
    let ty = play.y + trail * 7;

    // 与球保持最小间距。这条兜底在旧实现里是**死代码**：偏移恒为 ±11/±7，
    // `Math.hypot(11, 7)` 恒等于 13.04，`gap < 6` 永远不成立。tanh 之后偏移在
    // 中线附近趋于 0，主裁真的可能站到球上，所以它现在必须成立。
    // 距离换算成米（旧写法直接对格数取 hypot，是混单位）。
    const dxM = (tx - bx) * OFFICIAL_MX;
    const dyM = (ty - by) * OFFICIAL_MY;
    const gapM = Math.hypot(dxM, dyM);
    if (gapM < MIN_REF_GAP_M) {
      // 沿「球 → 目标」方向推开；偏移恰好为零时退到横向让开，避免除零
      const ux = gapM > 1e-3 ? dxM / gapM : 1;
      const uy = gapM > 1e-3 ? dyM / gapM : 0;
      tx = bx + (ux * MIN_REF_GAP_M) / OFFICIAL_MX;
      ty = by + (uy * MIN_REF_GAP_M) / OFFICIAL_MY;
    }
    // 距球分档给速度（见 OFFICIAL_DRIFT_STEP_M 那段说明）。判据用**真实球位**而不是
    // 局面重心：玩家眼里的「离球多远」看的是球。
    // 注意与上面那个 `gapM` 不是一回事——那个是「站位点到球」，用来防止站位点落在球上；
    // 这个是「主裁本人到球」，用来决定他该慢跑还是全速。
    const refGapM = Math.hypot((bx - o.referee.x) * OFFICIAL_MX, (by - o.referee.y) * OFFICIAL_MY);
    const refStep =
      refGapM > REF_GAP_FAR_M
        ? MAX_OFFICIAL_STEP_M
        : refGapM < REF_GAP_NEAR_M
          ? OFFICIAL_DRIFT_STEP_M * 0.6
          : OFFICIAL_DRIFT_STEP_M;
    moveTo(o.referee, tx, ty, refStep);

    // —— 边裁：各守一半，跟随该半场的越位线 ——
    // `_offsideLineY(att)` 返回倒数第二名防守者的 y，正是边裁该齐平的位置。
    // 几何半场不随换边移动：A 永远盯 y<50（上场），B 永远盯 y>50（下场）。
    // 换边后改的是「哪一队朝哪头攻」——朝 y=0 攻的那队，其越位线在上场。
    const topAttacker = this._attackDir("home") < 0 ? "home" : "away";
    const botAttacker = topAttacker === "home" ? "away" : "home";
    const lineForHomeAttack = this._offsideLineY(topAttacker);
    const lineForAwayAttack = this._offsideLineY(botAttacker);
    // 边裁按真实分工必须与倒数第二名防守者齐平，所以允许他们跑到上限——
    // 真实边裁确实沿边线冲刺，而且没人会拿他们跟场内球员比速度。
    // 恒速追击同样保护他们：越位线在攻防转换时跳得比球还狠。
    moveTo(
      o.assistantA,
      3,
      clamp(Number.isFinite(lineForHomeAttack) ? lineForHomeAttack : 32, 1, 50),
      MAX_OFFICIAL_STEP_M
    );
    moveTo(
      o.assistantB,
      97,
      clamp(Number.isFinite(lineForAwayAttack) ? lineForAwayAttack : 68, 50, 99),
      MAX_OFFICIAL_STEP_M
    );

    this._applyOfficials();
  }

  /**
   * 底部替补席：保留可点击资料入口，但不占用球场边线。
   *
   * 这一条是「现算的展示列表」而不是持久化名单：全队减首发。两点必须与
   * 真正的换人池（match.js 的 getBenchPlayers / aiBenchCandidates）对齐，
   * 否则玩家会看到「上场的人不在替补席上」：
   *  1. 不做人数截断。旧实现硬编码 .slice(0, 7)，而换人是从整个非首发阵容
   *     里挑的（排序键还多了「同位置 +5」加成），排在第 8 位以后的人被换上
   *     属于常态，看起来就像凭空冒出一个号码。
   *  2. 停赛球员同样排除（旧实现只排除 injured）。
   * 本场已被换下的球员不再回到席上（对应 applySubstitution 的 alreadyRemoved 校验）。
   */
  _spawnBench(club, isHome, color, numColor) {
    const lane = isHome ? this.benchHomeEl : this.benchAwayEl;
    if (!lane || !club) return;
    lane.innerHTML = "";
    const xi = new Set((getLineupPlayers(club) || []).map((p) => p?.id).filter(Boolean));
    const usedOut = this._subbedOff || new Set();
    const bench = (club.players || [])
      .filter(
        (p) =>
          p &&
          !xi.has(p.id) &&
          !usedOut.has(p.id) &&
          (p.injured || 0) <= 0 &&
          (p.suspendedMatches || 0) <= 0
      )
      .sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
    if (!bench.length) {
      lane.classList.add("empty");
      this.benchStripEl?.classList.toggle(
        "empty",
        !this.benchHomeEl?.children.length && !this.benchAwayEl?.children.length
      );
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
    this.benchStripEl?.classList.remove("empty");
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
        const screens = pts.map((p) => pitchToScreenPct(p.x, p.y));
        const pad = pos === "MID" ? 7 : 6;
        const lefts = screens.map((s) => s.left);
        const tops = screens.map((s) => s.top);
        const minL = clamp(Math.min(...lefts) - pad, 2, 90);
        const maxL = clamp(Math.max(...lefts) + pad, 10, 98);
        const minT = clamp(Math.min(...tops) - pad * 0.85, 2, 90);
        const maxT = clamp(Math.max(...tops) + pad * 0.85, 10, 98);
        const el = document.createElement("div");
        el.className = `mp-zone ${teamClass} pos-${pos.toLowerCase()}`;
        el.style.left = `${minL}%`;
        el.style.top = `${minT}%`;
        el.style.width = `${Math.max(8, maxL - minL)}%`;
        el.style.height = `${Math.max(8, maxT - minT)}%`;
        this.formZonesEl.appendChild(el);
      }
    };
    addZones(this.home, true, "home");
    addZones(this.away, false, "away");
  }

  /**
   * 换边后的可见标记：队名标签换位。FMM 屏把控球高亮/进攻箭头藏掉了，
   * 用户真正能看见的是两端队名（`.mp-end-home` / `.mp-end-away`）。
   * CSS 用 `.mp-field.mp-ends-swapped` 把 home 换到右端、away 换到左端。
   */
  _applyEndsChrome() {
    this.fieldEl?.classList.toggle("mp-ends-swapped", !!this.endsSwapped);
    this._updatePossessionChrome();
  }

  /**
   * 换边上升沿：队名标签正在换位，用一次淡场把「换边了」讲出来。
   *
   * 只在 false→true 触发，且本场 `_endsSwapAnnounced` 锁死一次。
   * 默认档（一直 false）和 `build()` 重置都不会走到这里。
   *
   * 用户能看见的层：`.mp-seg-cut` 淡场（球场伪元素，FMM 没藏）+
   * `.mp-fmm-ticker`。不要接到 `.mp-poss-half` / `.mp-attack-arrow`
   * （`.fmm-match` 把它们 `display:none` 了），也不抢 `.mp-banner` ——
   * `showSecondHalfKickoff` 已经在播「下半场」，它的 1200ms 超时会把后写的横幅清掉。
   *
   * 高光段入场可能已经在播淡场，再叠一次会闪两次，故已有 `.mp-seg-cut` 时跳过。
   */
  _announceEndsSwap() {
    if (!this._built || this._endsSwapAnnounced) return;
    this._endsSwapAnnounced = true;
    if (!this.fieldEl?.classList.contains("mp-seg-cut")) {
      this._playSegmentCut();
    }
    const en = typeof document !== "undefined" && document.documentElement?.lang === "en";
    this.setFmmTicker?.(en ? "2nd half · sides swapped" : "下半场 · 换边", "info", 2400);
  }

  /** 控球半场高亮 + 进攻方向箭头 */
  _updatePossessionChrome() {
    if (!this._built) return;
    const side = this.possession === "away" ? "away" : "home";
    // class 仍跟控球队（颜色），位置由 `.mp-ends-swapped` 翻转。
    // 默认档 `_attackDir(home)=-1` ⇒ 朝 y=0 攻 ⇒ 画面朝右。
    const attackingRight = this._attackDir(side) < 0;
    if (this.possHalfEl) {
      this.possHalfEl.className = `mp-poss-half side-${side}`;
      this.possHalfEl.dataset.dir = attackingRight ? "right" : "left";
    }
    if (this.attackArrowEl) {
      this.attackArrowEl.className = `mp-attack-arrow side-${side}`;
      this.attackArrowEl.classList.toggle("show", this.fsm.canAIAct());
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
    // 量 .mp-camera：横屏后 .mp-field 含上下看台，球员/标线都画在 camera 里。
    // clientWidth 不吃 transform 缩放误差，比 getBoundingClientRect 更稳
    const box = this.cameraEl || this.fieldEl;
    const w = Math.floor(box.clientWidth || 0);
    const h = Math.floor(box.clientHeight || 0);
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
    // 持球时轨迹短，飞行时长（更克制的长度）
    const max = !this.carrier || z > 0.6 ? 14 : 5;
    while (this._ballTrail.length > max) this._ballTrail.shift();
  }

  /**
   * FM 2D 软跟镜：缓跟球 + 死区 + 禁区微推近
   * 避免旧「每帧 ball 镜头」的眼晕，也不锁死全景。
   */
  _updateSimCamera(d) {
    const target = cameraFraming({
      preset: this.cameraPreset,
      ball: this.ball,
      mode: this.camMode,
      goalSequence: this.fsm.isIn('GOAL_SEQUENCE'),
      boosted: performance.now() < this.camBoostUntil,
    });
    if (
      this.cameraPreset !== "tv" ||
      Math.hypot(target.x - this.cam.tx, target.y - this.cam.ty) > 0.2
    ) {
      this.cam.tx = target.x;
      this.cam.ty = target.y;
    }
    this.cam.tScale = target.scale;
    const kPan = 1 - Math.pow(0.05, d);
    const kZoom = 1 - Math.pow(0.08, d);
    this.cam.x = lerp(this.cam.x, this.cam.tx, kPan);
    this.cam.y = lerp(this.cam.y, this.cam.ty, kPan);
    this.cam.scale = lerp(this.cam.scale, this.cam.tScale, kZoom);
    this._applyCamera();
  }

  _drawTacticalStructure(ctx, px, py) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const side of ["home", "away"]) {
      const active = this.players.filter(
        (player) => player.team === side && player.pos !== "GK" && !player.el.classList.contains("sent-off")
      );
      const groups = [
        active.filter((player) => player.pos === "DEF"),
        active.filter((player) => player.pos === "MID"),
        active.filter((player) => player.pos !== "DEF" && player.pos !== "MID"),
      ];
      const lineColor = side === "home" ? "rgba(191,219,254,0.48)" : "rgba(254,202,202,0.48)";
      const spineColor = side === "home" ? "rgba(96,165,250,0.24)" : "rgba(248,113,113,0.24)";
      const centroids = [];
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.15;
      ctx.setLineDash([4, 4]);
      for (const group of groups) {
        if (!group.length) continue;
        const ordered = group.slice().sort((a, b) => a.x - b.x);
        centroids.push({
          x: group.reduce((sum, player) => sum + player.x, 0) / group.length,
          y: group.reduce((sum, player) => sum + player.y, 0) / group.length,
        });
        if (ordered.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(px(ordered[0].x, ordered[0].y), py(ordered[0].x, ordered[0].y));
        for (let index = 1; index < ordered.length; index++) {
          ctx.lineTo(px(ordered[index].x, ordered[index].y), py(ordered[index].x, ordered[index].y));
        }
        ctx.stroke();
      }
      if (centroids.length >= 2) {
        centroids.sort((a, b) => a.y - b.y);
        ctx.strokeStyle = spineColor;
        ctx.lineWidth = 0.9;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(px(centroids[0].x, centroids[0].y), py(centroids[0].x, centroids[0].y));
        for (let index = 1; index < centroids.length; index++) {
          ctx.lineTo(px(centroids[index].x, centroids[index].y), py(centroids[index].x, centroids[index].y));
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawCanvas() {
    this._updateCrowdAtmosphere();
    // 每帧检查：布局若已变化则重绑缓冲（不用再手动缩放页面）
    if (this.fieldEl) {
      const box = this.cameraEl || this.fieldEl;
      const fw = Math.floor(box.clientWidth || 0);
      const fh = Math.floor(box.clientHeight || 0);
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
    const px = (x, y) => ((100 - y) / 100) * w;
    const py = (x, y) => (x / 100) * h;
    const minDim = Math.min(w, h);
    const focusOn =
      this.focusIds?.size > 0 && performance.now() < (this.focusUntil || 0);

    const scenePolicy = visualCuePolicy({ preset: this.cameraPreset });
    if (scenePolicy.drawStructure) {
      this._drawTacticalStructure(ctx, px, py);
    }

    // 球轨迹丝带（地面投影）；射门用更醒目的橙黄弧
    // 2026-09-04：用户反馈球的尾巴特效违和，整体关闭（保留代码，改 SHOW_BALL_TRAIL 即可找回）。
    // 2026-09-05：SVG 弧线尾迹（_addTrail/.mp-trails）也收进同一个开关（见文件顶部常量）。
    // 注意：下面那行 `if (!this.carrier && trail.length >= 2)` 是 match-broadcast-audit
    // 的字符串守卫（「持球时尾迹隐藏」），不要改写它——总开关放在它之前做早返回。
    const trail = this._ballTrail || [];
    const isShotTrail =
      this.ballState === "shot" ||
      (this.fsm.isIn('GOAL_SEQUENCE') && trail.some((p) => (p.z || 0) > 0.8));
    // 总开关关闭时整块跳过；开启时下面这行照旧（它是 broadcast-audit 的字符串守卫）。
    if (!SHOW_BALL_TRAIL) { /* 尾迹已整体关闭，见文件顶部 SHOW_BALL_TRAIL */ }
    else if (!this.carrier && trail.length >= 2) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1];
        const b = trail[i];
        const t = i / trail.length;
        const elev = Math.max(a.z || 0, b.z || 0);
        ctx.beginPath();
        ctx.moveTo(px(a.x, a.y), py(a.x, a.y));
        ctx.lineTo(px(b.x, b.y), py(b.x, b.y));
        if (isShotTrail) {
          // 更克制的射门轨迹：降低透明度和线宽
          ctx.strokeStyle = `rgba(251, 146, 60, ${0.12 + t * 0.48})`;
          ctx.lineWidth = (1.2 + t * 2.4 + elev * 0.3) * (minDim / 420);
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
    // 进场动画的横向偏移（像素）。没在播时返回 0，零开销。
    const introActive = this._introStartAt != null;
    for (let di = 0; di < drawList.length; di++) {
      const pl = drawList[di];
      // 入场位移叠加在**屏幕 x** 上（不是引擎坐标）：球场宽度 w 已换算成
      // 像素，按 w 取比例才能让「从端线外进来」在不同屏幕上都成立。
      const x = px(pl.x, pl.y) + (introActive ? this._introOffsetX(pl, di, w) : 0);
      const y = py(pl.x, pl.y);
      // 与模拟层 2.85~3.35 的中心间距匹配；旧半径 9px 会让直径大于碰撞距离。
      // 2026-09-05（A1）：上限 10→12——列放宽到 640px 后 minDim 变大，12px 半径
      // 与纵向分离距离的比例和旧 10px/480px 列一致（≈0.65），大屏上球员更可读。
      const r = clamp(minDim * 0.026, 7, 12);
      const spd = Math.hypot(pl.vx || 0, pl.vy || 0);
      const dim =
        focusOn && !this.focusIds.has(pl.id) && !pl.el.classList.contains("has-ball");
      const hasBall = pl.el.classList.contains("has-ball");
      const cue = visualCuePolicy({
        preset: this.cameraPreset,
        speed: spd,
        hasBall,
        focused: focusOn && this.focusIds.has(pl.id),
        pressing: pl.fsm === "press",
        diving: pl.pose === "dive",
      });
      ctx.globalAlpha = dim ? 0.38 : 1;

      // One short motion cue only for a decisive TV-camera sprint.
      if (cue.drawTrail && pl.heading != null && pl.pose !== "dive") {
        const hx = -Math.sin(pl.heading);
        const hy = Math.cos(pl.heading);
        ctx.strokeStyle = "rgba(248,250,252,0.2)";
        ctx.lineWidth = Math.max(1, r * 0.18);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x - hx * r * 0.75, y - hy * r * 0.75);
        ctx.lineTo(x - hx * r * 1.65, y - hy * r * 1.65);
        ctx.stroke();
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
          : "#e879f9"
        : pl.el.querySelector(".mp-dot")?.style?.background ||
          (pl.team === "home" ? "#2563eb" : "#dc2626");
      const diving =
        pl.pose === "dive" &&
        (!pl.poseUntil || performance.now() < pl.poseUntil);
      const diveDir = diving ? pl.poseDir || 1 : 0;

      // 扑救方向（屏幕空间）。引擎 heading 是 (dx, dy)=(cos, sin)；横向映射后
      // 屏幕向量是 d(left)/d(engine) = (-dy, dx)，再乘像素比例。
      let dux = diveDir;
      let duy = 0;
      if (diving) {
        let sx = null;
        let sy = null;
        if (Number.isFinite(pl.heading)) {
          sx = -Math.sin(pl.heading) * (w / 100);
          sy = Math.cos(pl.heading) * (h / 100);
        } else if (this.ball) {
          sx = px(this.ball.x, this.ball.y) - x;
          sy = py(this.ball.x, this.ball.y) - y;
        }
        const len = sx == null ? 0 : Math.hypot(sx, sy);
        if (len > 0.001) {
          dux = sx / len;
          duy = sy / len;
        }
      }

      // 扑救：圆点保持圆形（号码要一直可读），沿扑救方向平移 + 身后残影。
      // 这里刻意不画拉长的胶囊/手臂——那个版本试过，在迷你球场上很难看。
      // 唯一相对旧版的改动：方向从「只有横向 poseDir」换成真实扑救方向，
      // 于是朝上下扑也能看出来。位移量和残影透明度保持原值。
      const drawX = diving ? x + dux * r * 0.55 : x;
      const drawY = diving ? y + duy * r * 0.55 : y;

      if (diving) {
        // 残影：沿扑救方向的反向留三段
        for (let k = 3; k >= 1; k--) {
          ctx.globalAlpha = dim ? 0.12 : 0.16 - k * 0.03;
          ctx.beginPath();
          ctx.arc(
            drawX - dux * r * k * 0.42,
            drawY - duy * r * k * 0.42,
            r * (1 - k * 0.08),
            0,
            Math.PI * 2
          );
          ctx.fillStyle = bg;
          ctx.fill();
        }
        ctx.globalAlpha = dim ? 0.38 : 1;
      }

      ctx.beginPath();
      ctx.arc(drawX, drawY, r, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();

      // 队伍描边：白 = 主队、深 = 客队。这一圈是区分两队最稳定的线索，
      // 不能被战术状态顶掉——旧实现一进入 press/support 就把队伍色整个换成
      // 红/蓝，于是两队同号球员挨在一起时谁也认不出谁。
      ctx.lineWidth = isGk ? 2.5 : pl.team === "home" ? 2 : 1.6;
      ctx.strokeStyle = isGk
        ? "rgba(15,23,42,0.9)"
        : pl.team === "home"
          ? "#fff"
          : "rgba(15,23,42,0.75)";
      if (hasBall) {
        ctx.strokeStyle = "#fde68a";
        ctx.lineWidth = 2.8;
      } else if (diving) {
        ctx.strokeStyle = "rgba(253, 224, 71, 0.95)";
        ctx.lineWidth = 2.6;
      }
      ctx.stroke();

      // 战术状态画在队伍描边之外再套一圈，两种信息各占一层、互不覆盖
      if (!hasBall && !diving && (pl.fsm === "press" || pl.fsm === "support")) {
        ctx.beginPath();
        ctx.arc(drawX, drawY, r + 1.7, 0, Math.PI * 2);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle =
          pl.fsm === "press" ? "rgba(248,113,113,0.9)" : "rgba(96,165,250,0.85)";
        ctx.stroke();
      }

      // A single possession ring keeps the ball carrier readable without a glow stack.
      if (cue.drawPossessionRing) {
        ctx.beginPath();
        ctx.arc(drawX, drawY, r + 3.6, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(253, 224, 71, 0.7)";
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // 朝向箭头
      if (cue.drawArrow && pl.heading !== undefined && spd > 0.35) {
        const hx = -Math.sin(pl.heading);
        const hy = Math.cos(pl.heading);
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
    const bx = px(this.ball.x, this.ball.y);
    const by = py(this.ball.x, this.ball.y);
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
    this.fsm.transition('PLAYING', 'SCRIPTED');
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
      this._updateOfficials(true, dt / 1000, fr === frames[0] || dt > 550);
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

  /** 8×6 热区网格（横向球场：沿球场长 8 格、沿球场宽 6 格） */
  _initHeatGrid() {
    this.heatCells = [];
    if (!this.heatLayer) return;
    this.heatLayer.innerHTML = "";
    const cols = 8;
    const rows = 6;
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
    if (this._presentationReadOnlyDepth > 0 || !this.heatEnabled || !this.heatCells.length) return;
    const s = pitchToScreenPct(x, y);
    for (const cell of this.heatCells) {
      if (s.left >= cell.x && s.left < cell.x + cell.w && s.top >= cell.y && s.top < cell.y + cell.h) {
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
          // 权重是"愿意被推动的程度"，门将守门线因此几乎不动；
          // 每人按自身权重份额分担修正，与引擎 _separateAgents 同一套规则。
          const aw = a.pos === "GK" || a.role === "GK" ? 0.15 : 1;
          const bw = b.pos === "GK" || b.role === "GK" ? 0.15 : 1;
          const den = aw + bw || 1;
          const aShare = aw / den;
          const bShare = bw / den;
          a.x = clamp(a.x - ux * push * aShare, 2, 98);
          a.y = clamp(a.y - uy * push * aShare, 2, 98);
          b.x = clamp(b.x + ux * push * bShare, 2, 98);
          b.y = clamp(b.y + uy * push * bShare, 2, 98);
        }
      }
    }
    for (const pl of list) this._applyPlayer(pl);
  }

  /** 进攻方向：与引擎 `attackDir` 同形。默认主队朝上(y减小)，客队朝下；换边取反。 */
  _attackDir(team) {
    const base = team === "home" ? -1 : 1;
    return this.endsSwapped ? -base : base;
  }

  /**
   * 对方「倒数第二名」防守线 Y（FIFA：全队含门将，取最靠近本方球门的第二人）
   * —— 不是「以门将为唯一基准」；门将通常是最后一人，线在他身前的第二人。
   * 朝 y→0 攻：对方 y 升序第 2（最靠近 y=0 球门的第二人）
   * 朝 y→100 攻：对方 y 降序第 2
   * 默认档 `_attackDir("home")=-1`，与改前 `attackingTeam === "home"` 同分支。
   */
  _offsideLineY(attackingTeam) {
    const defTeam = attackingTeam === "home" ? "away" : "home";
    const defs = this.players.filter(
      (p) => p.team === defTeam && !p.el.classList.contains("sent-off")
    );
    if (defs.length < 2) return 50;
    if (this._attackDir(attackingTeam) < 0) {
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
    return this._attackDir(attackingTeam) < 0 ? by < 50 : by > 50;
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
      return deep
        ? coordSystem.isInBox(pl.x, pl.y, 'away', true)
        : pl.y <= 32 && pl.x >= 18 && pl.x <= 82;
    }
    return deep
      ? coordSystem.isInBox(pl.x, pl.y, 'home', true)
      : pl.y >= 68 && pl.x >= 18 && pl.x <= 82;
  }

  /** 球门中心与门将位置 */
  _goalTarget(team) {
    const attHome = team === "home";
    const goal = coordSystem.attackingGoal(attHome);
    const gx = goal.x + (Math.random() - 0.5) * 10;
    const gy = attHome ? goal.y + Math.random() * 3 : goal.y - Math.random() * 3;
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
      if (!this._built || !this.fsm.canAIAct()) return;
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
    if (!car || !this.fsm.canAIAct())
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
    if (!car || !this.fsm.canAIAct())
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
      if (jump > expected * 2 + 2.5) { pl.vx = 0; pl.vy = 0; }
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
    const slowR = 6.5;
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
    if (!this.fsm.canAIAct()) return;
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
  _passTo(fromPl, toPl, { flightMs = 520, random = Math.random } = {}) {
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
    const tx = clamp(aimX + (random() - 0.5) * scatter, 5, 95);
    const ty = clamp(aimY + (random() - 0.5) * scatter, 5, 95);
    // 好传球略快（最多约 8%），不再把短传压到“瞬移”
    const ms = Math.round(flightMs * (1.04 - passing / 120));
    this._beginFlight({ x: tx, y: ty, receiverId: toPl.id, kind: "pass", ms });
    this._addTrail(from.x, from.y, tx, ty, "pass", ms / 1000 + 0.12);
    this._recordPass(fromPl, toPl);
    this.lastCarrierId = fromPl.id;
    this.carrier = null; // 保持 ballState=flight
    this._setTouch(fromPl, 280);
    // 接球人迎球
    toPl.tx = clamp(tx + (random() - 0.5) * 2, 6, 94);
    toPl.ty = clamp(ty + (random() - 0.5) * 2, 6, 94);
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
    if (!this.fsm.canAIAct())
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
          if (!this._built || !this.fsm.canAIAct()) return;
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

  /** 压迫线 / 防线：横向球场画竖线，随队形平均 engineY 左右移动 */
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
    const hx = pitchToScreenPct(50, avgY(homeOut)).left;
    const ax = pitchToScreenPct(50, avgY(awayOut)).left;
    const hDefX = pitchToScreenPct(50, avgY(homeDefs.length ? homeDefs : homeOut)).left;
    const aDefX = pitchToScreenPct(50, avgY(awayDefs.length ? awayDefs : awayOut)).left;

    // 持球方压迫线更靠前、更亮
    const homePress = this.possession === "home";
    this.pressLayer.innerHTML = `
      <line class="mp-press-line home ${homePress ? "active" : ""}" x1="${hx.toFixed(1)}" y1="6" x2="${hx.toFixed(1)}" y2="94" />
      <line class="mp-def-line home" x1="${hDefX.toFixed(1)}" y1="10" x2="${hDefX.toFixed(1)}" y2="90" />
      <line class="mp-press-line away ${!homePress ? "active" : ""}" x1="${ax.toFixed(1)}" y1="6" x2="${ax.toFixed(1)}" y2="94" />
      <line class="mp-def-line away" x1="${aDefX.toFixed(1)}" y1="10" x2="${aDefX.toFixed(1)}" y2="90" />
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
    if (this._presentationReadOnlyDepth > 0) return;
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
      const p0e = this._netPos(from);
      const p1e = this._netPos(to);
      const p0 = pitchToScreenPct(p0e.x, p0e.y);
      const p1 = pitchToScreenPct(p1e.x, p1e.y);
      const t = e.count / maxCount;
      const age = clamp(1 - (now - e.last) / 45000, 0.35, 1);
      const sw = 0.35 + t * 1.85;
      const op = (0.22 + t * 0.55) * age;
      const cls = e.team === "home" ? "home" : "away";
      // 轻微弧线，避免重叠直线（画面坐标）
      const mx = (p0.left + p1.left) / 2 + (p0.top - p1.top) * 0.06;
      const my = (p0.top + p1.top) / 2 + (p1.left - p0.left) * 0.06;
      parts.push(
        `<path class="mp-net-edge ${cls}" d="M ${p0.left.toFixed(1)} ${p0.top.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${p1.left.toFixed(1)} ${p1.top.toFixed(1)}" stroke-width="${sw.toFixed(2)}" opacity="${op.toFixed(2)}" data-count="${e.count}" />`
      );
    }
    for (const id of nodeIds) {
      const pl = byId.get(id);
      if (!pl || pl.el.classList.contains("sent-off")) continue;
      if (this.networkFilter === "home" && pl.team !== "home") continue;
      if (this.networkFilter === "away" && pl.team !== "away") continue;
      const pe = this._netPos(pl);
      const p = pitchToScreenPct(pe.x, pe.y);
      const touches = pl.passTouches || 1;
      const r = clamp(0.55 + Math.sqrt(touches) * 0.28, 0.55, 1.6);
      parts.push(
        `<ellipse class="mp-net-node ${pl.team}" cx="${p.left.toFixed(1)}" cy="${p.top.toFixed(1)}" rx="${r.toFixed(2)}" ry="${(r * OVERLAY_CIRCLE_RY).toFixed(2)}" />`
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
    if (!this.fsm.canAIAct()) return;
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
    const frozen = !this.fsm.canAIAct();
    this.fieldEl?.classList.toggle("mp-clickable", true);
    this.fieldEl?.classList.toggle("mp-paused", frozen);
    const isPre = this.fsm.is('PRE_MATCH') || this.fsm.is('IDLE');
    this.fieldEl?.classList.toggle("mp-pre", isPre);
    if (this.tipEl) {
      // 赛前/中场都提示可点球员
      this.tipEl.classList.toggle("show", frozen);
      if (isPre) {
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
    const s = pitchToScreenPct(pl.x, pl.y);
    pl.el.style.left = `${s.left}%`;
    pl.el.style.top = `${s.top}%`;
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
    const s = pitchToScreenPct(this.ball.x, this.ball.y);
    this.ball.el.style.left = `${s.left}%`;
    this.ball.el.style.top = `${s.top}%`;
    // DOM 回退路径：用 CSS 变量表达高度（canvas 模式仍会隐藏球）
    const z = clamp(this.ball.z || 0, 0, 12);
    this.ball.el.style.setProperty("--ball-z", String(z));
    this.ball.el.classList.toggle("mp-ball-air", z > 0.8);
  }

  /**
   * 镜头：FMM 观感 — 默认稳全场，仅射门/进球短暂 box
   */
  _updateCameraTarget() {
    if (!this.fsm.canAIAct()) {
      // 2026-09-05（A2 收尾）：开赛后死球/重启不再回全球场——旧档 scale≈1.03 时
      // 回中不可察觉，A2 的广播档 1.28 下每次重启都会 zoom 泵 1.28→1.0→1.28。
      // 球已摆好，镜头原地歇（保持上一目标）。开赛前仍回全球场看阵型。
      if (!this._everPlayed) {
        this.cam.tScale = 1;
        this.cam.tx = 0;
        this.cam.ty = 0;
      }
      return;
    }
    // 收尾阶段强制回 wide
    if (performance.now() < this.aftermathUntil) {
      this.camMode = "wide";
    }
    const target = cameraFraming({
      preset: this.cameraPreset,
      ball: this.ball,
      mode: this.camMode || "wide",
      goalSequence: this.fsm.isIn('GOAL_SEQUENCE'),
      boosted: performance.now() < this.camBoostUntil,
    });
    this.cam.tx = target.x;
    this.cam.ty = target.y;
    this.cam.tScale = target.scale;
  }

  /**
   * 场内短字幕（FMM 风格事件条）
   *
   * 旧实现每次都把同一句话再写一份到底栏 ticker，于是同一个事件在画面上出现两次：
   * 场内胶囊一份、球场下方深色条一份，文字一模一样；碰上还打了 mp-banner 的事件
   * （例如扑救的 🧤）就是三层。而底栏 ticker 与控球条共用同一个 grid 格子，
   * 一显示就把控球比顶掉，整场几乎看不到控球数据。
   *
   * 现在字幕只管场内这一层；底栏 ticker 留给真正需要占用底栏的少数调用
   * （进球、进球重播），两者互不干扰。
   */
  setCaption(text, kind = "", ms = 1600) {
    if (!this.captionEl) {
      // 没有场内字幕元素时才退回底栏
      this.setFmmTicker(text, kind, ms);
      return;
    }
    if (!text) {
      this.captionEl.classList.add("hidden");
      this.captionEl.textContent = "";
      this.captionEl.className = "mp-caption hidden";
      return;
    }
    this.captionEl.textContent = text;
    this.captionEl.className = `mp-caption ${kind}`;
    this.captionEl.classList.remove("hidden");
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

  /**
   * 控球条配色跟随球衣。
   * 旧实现在 CSS 里写死「底色 #c62828 红 / 填充 #e8eaed 浅灰」，与球衣无关：
   * 主队穿红、圆点也是红，控球份额却画成浅灰，客队反而是红，观感完全对调。
   * 填充 = 主队份额，用主队球衣色；底色 = 客队份额，用客队球衣色。
   */
  _applyPossessionBarKit(homeColor, awayColor) {
    const fill = this.fmmPossFillEl;
    const bar = fill?.parentElement;
    if (!bar || !fill) return;
    const home = String(homeColor || "").trim();
    const away = String(awayColor || "").trim();
    if (!home || !away) return;
    bar.style.background = away;
    fill.style.background = home;
    // 两队球衣色接近时（例如都是深蓝），纯色相接会看不出分界；
    // 用一条与主队色对比的细边把分界线钉出来。
    fill.style.borderRightColor = readableNumberColor(home, "#0f172a");
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
  async playRecordedGoalReplay(opts = {}) {
    const frames = opts.frames || this._lastTimeline?.frames;
    if (!frames?.length || frames.length < 4) return false;
    const captured = {
      state: this.fsm.current(),
      subState: this.fsm.subState,
      frozen: this._legacyFrozen,
      simDrive: this.simDrive,
      possession: this.possession,
      bannerText: this.bannerEl?.textContent || "",
      captionText: this.captionEl?.textContent || "",
      camMode: this.camMode,
      scene: this.captureSceneSnapshot(),
    };
    const target = opts.returnToLiveSim
      ? {
          ...captured,
          state: "PLAYING",
          subState: "SIM_DRIVEN",
          frozen: false,
          simDrive: true,
          bannerText: "",
          captionText: "",
        }
      : captured;
    this._presentationReadOnlyDepth++;
    try {
      return (await this.playFmmGoalReplay(opts)) !== false;
    } finally {
      try {
        if (target.scene) this.restoreSceneSnapshot(target.scene);
        if (
          this.fsm.isIn("GOAL_SEQUENCE") &&
          this.fsm.subState !== "CELEBRATE" &&
          target.state !== "GOAL_SEQUENCE"
        ) {
          this.fsm.transition("GOAL_SEQUENCE", "CELEBRATE", { replay: true });
        }
        this.fsm.transition(target.state, target.subState, { replayReturn: true });
        this._legacyFrozen = target.frozen;
        this.fieldEl?.classList.toggle("mp-ui-paused", target.frozen);
        this.simDrive = target.simDrive;
        this.fieldEl?.classList.toggle("mp-sim-drive", target.simDrive);
        this.possession = target.possession;
        this.camMode = target.camMode;
        this.setBanner(target.bannerText, "info");
        this.setCaption(target.captionText, "info", 0);
        this._updatePossessionChrome();
        this._syncClickable();
        this.refreshLayout?.();
      } finally {
        this._presentationReadOnlyDepth = Math.max(0, this._presentationReadOnlyDepth - 1);
      }
    }
  }

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
      return !!opts.scene;
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
    if (this.fsm.isIn('GOAL_SEQUENCE')) {
      this.fsm.transition('PLAYING', 'FREE_PLAY');
    }
    return true;
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
    if (this._crowdBed?.source) {
      try {
        this._crowdBed.source.stop();
      } catch {
        /* ignore */
      }
    }
    this._crowdBed = null;
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
    const livePlay = this.fsm.canAIAct();
    if (livePlay) this._everPlayed = true; // 开赛过的标记：死球镜头策略的分叉条件
    const staged = this.fsm.isIn('GOAL_SEQUENCE') && !this.frozen; // 进球/回放：只跟目标
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

    if (this.fsm.is('PAUSED') && this.fsm.wasIn('PLAYING')) {
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
      // 赛前 / 中场 / 完场：钉在死球站位（本方半场 + 中圈外），球回中圈
      this.carrier = null;
      this.ballState = "free";
      this.flight = null;
      for (const pl of this.players) {
        if (pl.el.classList.contains("sent-off")) continue;
        const px = pl.preX ?? pl.baseX;
        const py = pl.preY ?? pl.baseY;
        pl.tx = px;
        pl.ty = py;
        pl.x = px;
        pl.y = py;
        this._applyPlayer(pl);
      }
      if (!this.fsm.canAIAct()) {
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
    if (!SHOW_BALL_TRAIL) return; // 球尾总开关（2026-09-05）：关闭 SVG 弧线尾迹
    if (!this.trailSvg) return;
    const a = pitchToScreenPct(x0, y0);
    const b = pitchToScreenPct(x1, y1);
    // 二次贝塞尔：中点侧偏模拟弧线（画面坐标）
    const mx = (a.left + b.left) / 2 + (Math.random() - 0.5) * (kind === "pass" ? 4 : 10);
    const my = (a.top + b.top) / 2 + (kind === "goal" || kind === "shot" ? (b.left < a.left ? -6 : 6) : 0);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = `M ${a.left} ${a.top} Q ${mx} ${my} ${b.left} ${b.top}`;
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
    // 只有当 snap.sim 真正有数据时才开启 simDrive（Canvas 球员渲染）
    // 不能仅根据 snap.engine === "v2" 判断，因为 v2 引擎也可以只提供事件不提供空间数据
    if (this.simDrive || snap?.sim || ev?.fromSim) {
      if (snap?.sim) this.applySimSnapshot(snap.sim);
      // 无帧时也钉死 simDrive，阻断 update() 旧 AI
      if (!this.simDrive) this.setSimDrive?.(true);
      this.updateLiveStrip?.(snap);
      const homeId0 = fixture?.home || this.home?.id;
      switch (ev.type) {
        case "kickoff":
          this.fsm.transition('PLAYING', 'FREE_PLAY');
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
          // 真帧路径：入网/站位已由 sim 时间轴决定，UI 只做轻提示，避免再叠「假射门/大横幅/硬切 box」
          this.camMode = "follow";
          this.camBoostUntil = performance.now() + 1600;
          const scorer = ev.playerId && this.players.find((p) => p.id === ev.playerId);
          if (scorer) {
            scorer.el.classList.add("scorer", "highlight");
            this._setFocus([scorer], 1600);
            setTimeout(() => scorer.el.classList.remove("scorer", "highlight"), 1800);
          }
          // 底栏事件句即可；中央不打巨型 GOAL，减少与真实入网叠戏。
          // （试过在这里加中央横幅，结果同一个进球同时出现在底栏 ticker、
          //   中央横幅和入网特效三处，正是之前要消掉的「一事三屏」。）
          this.setCaption("");
          this.setBanner("");
          this.setFmmTicker(ev.text || "GOAL", "goal", KEY_EVENT_MS);
          this.playSfx("goal");
          // cheer 略延迟，避免与 netHit 音效糊成一片
          setTimeout(() => {
            if (this._built) this.playSfx("cheer");
          }, 180);
          break;
        }
        case "save":
          // 必须走导演时刻：门将倒地兜底、镜头推进、慢镜都在里面。
          // 旧实现这里只打了手套横幅 + 一行字幕，于是 onEvent 直接进来的路径
          // （非 handleSimLiveEvent）整场都没有任何扑救动作。
          // 与 case "goal" 的处理方式保持一致。视觉表现仍是原来那套克制的。
          this.triggerDirectorMoment("save", { ev, fixture });
          this.setBanner("🧤", "info");
          this.setCaption(ev.text || "SAVE", "info", MINOR_EVENT_MS);
          this.playSfx("save");
          setTimeout(() => this.setBanner(""), 900);
          break;
        case "corner": {
          // sim 路径也要摆出角球画面（旧版只闪 🚩，用户反馈从没见过角球状态）
          this._stageCornerSetPiece(ev, fixture);
          this.setBanner("🚩 角球", "info");
          this.setCaption(ev.text || "CORNER", "info", MINOR_EVENT_MS);
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
          this.setCaption(ev.type === "red" ? "RED CARD" : "YELLOW", "warn", KEY_EVENT_MS);
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
            this.setCaption(ev.text, "info", KEY_EVENT_MS);
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
          this.setCaption(ev.text || "", "info", KEY_EVENT_MS);
          this.playSfx("whistle");
          this.fsm.transition(ev.type === "ht" ? 'HALF_TIME' : 'FULL_TIME');
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
        this.fsm.transition('PLAYING', 'FREE_PLAY');
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
        this.setCaption(ev.text || "SAVE", "save", MINOR_EVENT_MS);
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
        this.setCaption(ev.type === "penalty" ? "PENALTY" : "PEN MISSED", "warn", KEY_EVENT_MS);
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
        this.setCaption(ev.text || "CORNER", "info", MINOR_EVENT_MS);
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
        this.setCaption(ev.type === "red" ? "RED CARD" : "YELLOW CARD", "warn", KEY_EVENT_MS);
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
        this.setCaption(ev.text || "INJURY", "warn", MINOR_EVENT_MS);
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
        this.fsm.transition('HALF_TIME');
        this.camMode = "wide";
        this.aftermathUntil = 0;
        this._clearFocus();
        this.hideFlashCard();
        this.setBanner(ev.text || "HT", "info");
        this.setCaption(ev.text || "HALF-TIME", "info", KEY_EVENT_MS);
        this.playSfx("whistle");
        this.ball.tx = 50;
        this.ball.ty = 50;
        this.cam.tx = 0;
        this.cam.ty = 0;
        this.cam.tScale = 1;
        this._syncClickable();
        break;

      case "ft":
        this.fsm.transition('FULL_TIME');
        this.camMode = "wide";
        this.aftermathUntil = 0;
        this._clearFocus();
        this.hideFlashCard();
        this.setBanner(ev.text || "FT", "info");
        this.setCaption(ev.text || "FULL-TIME", "info", KEY_EVENT_MS);
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
      ball: { x: this.ball.x, y: this.ball.y, z: this.ball.z || 0 },
      ballState: this.ballState,
      ballTrail: (this._ballTrail || []).map((point) => ({ ...point })),
      ballTrailPhase: this._simBallTrailPhase,
      possession: this.possession,
      carrierId: this.carrier?.id || null,
      lastCarrierId: this.lastCarrierId || null,
      officials: this.officials
        ? Object.fromEntries(Object.entries(this.officials).map(([role, official]) => [
            role, { x: official.x, y: official.y },
          ]))
        : null,
      playCentre: this._playCentre ? { ...this._playCentre } : null,
      officialsSimT: this._officialsSimT,
      relocLastSimT: this._relocLastSimT,
      lastDeflectionKey: this._lastDeflectionKey,
      players: this.players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        tx: p.tx,
        ty: p.ty,
        heading: p.heading,
        vx: p.vx,
        vy: p.vy,
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
      pl.heading = s.heading ?? pl.heading;
      pl.vx = s.vx || 0;
      pl.vy = s.vy || 0;
      pl._relocAt = 0;
      pl.el.classList.toggle("has-ball", pl.id === snap.carrierId);
      this._applyPlayer(pl);
    }
    if (snap.ball) {
      this.ball.x = snap.ball.x;
      this.ball.y = snap.ball.y;
      this.ball.z = snap.ball.z || 0;
      this.ball.tx = snap.ball.x;
      this.ball.ty = snap.ball.y;
    }
    this.flight = null;
    this.ballFlightUntil = 0;
    this.ballState = snap.ballState || (snap.carrierId ? "held" : "free");
    this.ball._relocAt = 0;
    this._ballTrail = (snap.ballTrail || []).map((point) => ({ ...point }));
    this._simBallTrailPhase = snap.ballTrailPhase || null;
    this._ballBounceFlash = 0;
    if (snap.possession) this.possession = snap.possession;
    this.lastCarrierId = snap.lastCarrierId || null;
    // Restoring a frame must neither reposition the ball nor record a new touch.
    this.carrier = this.players.find((p) => p.id === snap.carrierId) || null;
    this._playCentre = snap.playCentre ? { ...snap.playCentre } : null;
    this._officialsSimT = snap.officialsSimT ?? null;
    this._relocLastSimT = snap.relocLastSimT ?? null;
    this._lastDeflectionKey = snap.lastDeflectionKey ?? null;
    for (const [role, official] of Object.entries(this.officials || {})) {
      const position = snap.officials?.[role];
      if (position) {
        official.x = position.x;
        official.y = position.y;
      }
    }
    this._applyOfficials();
    this._updatePossessionChrome();
    this._applyBall();
    return true;
  }

  /**
   * 赛后无快照：轻摆到半场威胁区（不整队回中圈硬演）
   */
  _seedGoalRewatchPositions(team, attHome, scorer, assister, random = Math.random) {
    const dir = this._attackDir(team);
    const seedX = 36 + random() * 28;
    // 偏中前场，避免从中圈突然开打
    const seedY = attHome ? 32 + random() * 14 : 68 - random() * 14;
    if (assister && assister !== scorer) {
      assister.x = seedX;
      assister.y = seedY;
      assister.tx = assister.x;
      assister.ty = assister.y;
      this._applyPlayer(assister);
    }
    if (scorer) {
      scorer.x = clamp(seedX + (random() - 0.5) * 14, 14, 86);
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
    this._nudgeAttackShape(team, 0.35, random);
    this._nudgeDefendShape(team === "home" ? "away" : "home", {
      x: bx,
      y: by,
    }, random);
  }

  /**
   * 角球摆位：球钉角旗 + 主罚人 + 双方堆禁区 + 角球徽章
   *
   * 仅用于没有空间帧的旧路径。空间引擎的 `_restart` 已经给角球排好合法分槽，
   * 真实帧本身就包含正确站位；此时再摆拍会让整队先瞬移到预设坐标、
   * 下一帧又被真实位置覆盖回去，也就是录像里看到的双重跳变与重复画面。
   */
  _stageCornerSetPiece(ev = {}, fixture = null) {
    if (!this._built) return;
    if (this.simDrive) {
      // 空间帧已带角球站位：只给镜头和徽章，不动球员坐标。
      this._showCornerChrome();
      return;
    }
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

    // 固定 5v5 禁区分槽，其他人留在弧顶。双方槽位交错，避免随机摆位重叠。
    const stageY = (topY) => (attHome ? topY : 100 - topY);
    const attackBox = [[35, 13], [43, 17], [50, 10], [57, 17], [65, 13]];
    const attackEdge = [[27, 30], [39, 27], [50, 31], [61, 27], [73, 30]];
    const defendBox = [[38, 16], [46, 12], [50, 19], [54, 12], [62, 16]];
    const defendEdge = [[24, 34], [37, 31], [50, 35], [63, 31], [76, 34]];
    const roleRank = (pl, attacking) =>
      attacking
        ? pl.pos === "ATT" || pl.role === "ATT" ? 0 : pl.pos === "MID" || pl.role === "MID" ? 1 : 2
        : pl.pos === "DEF" || pl.role === "DEF" ? 0 : pl.pos === "MID" || pl.role === "MID" ? 1 : 2;
    const attackers = this.players
      .filter((pl) => pl.team === team && pl !== taker && pl.pos !== "GK" && pl.role !== "GK" && !pl.el.classList.contains("sent-off"))
      .sort((a, b) => roleRank(a, true) - roleRank(b, true) || String(a.id).localeCompare(String(b.id)));
    const defenders = this.players
      .filter((pl) => pl.team !== team && pl.pos !== "GK" && pl.role !== "GK" && !pl.el.classList.contains("sent-off"))
      .sort((a, b) => roleRank(a, false) - roleRank(b, false) || String(a.id).localeCompare(String(b.id)));
    const attackIndex = new Map(attackers.map((pl, index) => [pl.id, index]));
    const defendIndex = new Map(defenders.map((pl, index) => [pl.id, index]));
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
        const index = attackIndex.get(pl.id) ?? 0;
        const slot = index < attackBox.length
          ? attackBox[index]
          : attackEdge[(index - attackBox.length) % attackEdge.length];
        pl.x = slot[0];
        pl.y = stageY(slot[1]);
        if (index < attackBox.length) pl.el.classList.add("highlight");
      } else {
        const index = defendIndex.get(pl.id) ?? 0;
        const slot = index < defendBox.length
          ? defendBox[index]
          : defendEdge[(index - defendBox.length) % defendEdge.length];
        pl.x = slot[0];
        pl.y = stageY(slot[1]);
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
    this._visualUnstack(3);

    this.fsm.transition('PLAYING', 'SCRIPTED');
    this._showCornerChrome();
  }

  /** 角球的镜头、徽章与场地强调；不改动任何球员坐标 */
  _showCornerChrome() {
    this.camMode = "box";
    this.camBoostUntil = performance.now() + 2400;

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
    this.fsm.transition('GOAL_SEQUENCE', 'BUILDUP');
    this.camMode = "follow";
    this.camBoostUntil = performance.now() + 3200;

    // 创建 DirectorScript 实例
    const narrative = GOAL_NARRATIVE.rewatch;
    this._goalScript = new DirectorScript(narrative, {
      attHome,
      team,
      scorerId: scorer.id,
      assistId: assister?.id || null,
      start,
      mid: { x: scorer.x, y: scorer.y },
      mouth,
      lang,
    });

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

    const script = this._goalScript;
    if (!script) return false;

    script.tick(dt);
    const phase = script.currentPhase();
    if (!phase) {
      g.done = true;
      this._goalBeat = null;
      this._goalScript = null;
      return false;
    }

    const scorer = this.players.find((p) => p.id === g.scorerId);
    const assister = g.assistId
      ? this.players.find((p) => p.id === g.assistId)
      : null;
    const en = g.lang === "en";

    // 根据当前阶段执行对应的动画
    switch (phase.name) {
      case 'setup':
        // 准备阶段：保持初始位置
        break;

      case 'pass':
        // 传球阶段
        {
          const u = clamp(script.phaseProgress(), 0, 1);
          const e = u * u * (3 - 2 * u);
          this.ball.x = lerp(g.start.x, g.mid.x, e);
          this.ball.y = lerp(g.start.y, g.mid.y, e);
          this.ball.z = Math.sin(u * Math.PI) * 1.8;
          this.ballState = "flight";
          this.carrier = null;
          for (const pl of this.players) pl.el.classList.remove("has-ball");
          if (assister) assister.el.classList.add("highlight");
          if (scorer) scorer.el.classList.add("highlight");
          if (u > 0.1 && u < 0.4) {
            this.setCaption?.(en ? "Assist…" : "助攻传球…", "shot", 0);
          }
        }
        break;

      case 'receive':
        // 接球阶段
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
        break;

      case 'shot':
        // 起脚射门阶段
        {
          const nm = scorer?.name || "";
          this.setCaption?.(
            nm ? (en ? `${nm} shoots!` : `${nm} 射门!`) : en ? "Shot!" : "射门!",
            "shot",
            0
          );
          if (scorer) {
            for (const pl of this.players) {
              pl.el.classList.remove("has-ball");
              if (pl === scorer) pl.el.classList.add("highlight", "scorer");
            }
          }
        }
        break;

      case 'flight':
        // 球飞行阶段
        {
          const u = clamp(script.phaseProgress(), 0, 1);
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
        }
        break;

      case 'net':
        // 入网阶段
        {
          const u = clamp(script.phaseProgress(), 0, 1);
          if (u > 0.3 && !g._net) {
            g._net = true;
            this._goalNetEffect(g.mouth.gx, g.mouth.gy, g.attHome);
            this.setBanner?.(en ? "⚽ GOAL" : "⚽ 进球", "goal");
          }
          this.ball.x = g.mouth.gx;
          this.ball.y = g.mouth.gy;
          this.ball.z = 0.2;
          this.ballState = "free";
          this.carrier = null;
          for (const pl of this.players) pl.el.classList.remove("has-ball");
        }
        break;

      case 'celebrate':
        // 庆祝阶段
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
        break;
    }

    this.ball.tx = this.ball.x;
    this.ball.ty = this.ball.y;
    this._pushBallTrail();
    this._applyBall();

    // 射门和飞行阶段加强橙黄轨迹
    if (phase.name === 'shot' || phase.name === 'flight' || phase.name === 'net') {
      this.ballState = "shot";
    }

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
    const corner = coordSystem.getCelebrationCorner(attHome, scorer.x ?? 50);
    this._celebrate = {
      until: performance.now() + 5200,
      team,
      scorerId: scorer.id,
      cornerX: corner.x,
      attHome,
    };
    // 只设置移动目标，不改写当前位置。
    scorer.tx = corner.x;
    scorer.ty = corner.y;
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
          scorer.x + Math.cos(ang) * ring + (corner.x - 50) * 0.12,
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
  async _restartAfterGoal(attHome, { wait, lang = "zh", replayReturn = null } = {}) {
    this.fieldEl?.classList.remove("mp-replay", "mp-replay-slow");
    this.replayBadgeEl?.classList.add("hidden");
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

    const kickSide = attHome ? "away" : "home";
    this.possession = replayReturn?.liveSim
      ? kickSide
      : replayReturn?.possession || kickSide;
    this._resetShape();
    this._updatePossessionChrome();
    this.ball.x = 50;
    this.ball.y = 50;
    this.ball.tx = 50;
    this.ball.ty = 50;
    this.ballState = "free";
    this._clearCarrier();
    this._applyBall();

    if (replayReturn) {
      this.fsm.transition(replayReturn.state, replayReturn.subState, { replayReturn: true });
      this._legacyFrozen = replayReturn.frozen;
      this.fieldEl?.classList.toggle("mp-ui-paused", replayReturn.frozen);
      this.simDrive = replayReturn.simDrive;
      this.fieldEl?.classList.toggle("mp-sim-drive", replayReturn.simDrive);
      this.setBanner(
        replayReturn.liveSim
          ? ""
          : replayReturn.bannerText || (lang === "en" ? "FULL-TIME" : "完场回顾"),
        "info"
      );
      this.setCaption("");
      this._syncClickable();
      this.refreshLayout?.();
      return;
    }

    this.fsm.transition('PLAYING', 'FREE_PLAY');
    this.possession = kickSide;
    this._updatePossessionChrome();
    // 球先到中圈，再交给门将附近后卫
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
  _goalMouth(attHome, { deep = true, random = Math.random } = {}) {
    // 俯视：主队球门在 y≈0 端，客队在 y≈100 端；进网要比球门线更深一点
    const gx = 50 + (random() - 0.5) * (deep ? 7 : 10);
    const gy = attHome
      ? deep
        ? 1.2 + random() * 1.6
        : 4 + random() * 3
      : deep
        ? 98.2 - random() * 1.6
        : 96 - random() * 3;
    return { gx: clamp(gx, 42, 58), gy: clamp(gy, 0.6, 99.4) };
  }

  /** 进球入网特效：克制版——球门微颤 + 单层网 + 轻闪（避免迷你球场上的街机光污染） */
  _goalNetEffect(gx, gy, attHome) {
    // 永久球门口微颤
    const mouthSel = attHome ? ".mp-goal-mouth.right" : ".mp-goal-mouth.left";
    const mouth = this.fieldEl?.querySelector(mouthSel);
    if (mouth) {
      mouth.classList.remove("mp-goal-mouth-hit");
      void mouth.offsetWidth;
      mouth.classList.add("mp-goal-mouth-hit");
      setTimeout(() => mouth.classList.remove("mp-goal-mouth-hit"), 520);
    }
    if (!this.fxLayer) return;
    // 球门端极轻径向闪（强度不变，仍是原来的克制值）。
    // 旧实现挂在 .mp-field.mp-goal-flash::after 上，而进球时 mp-replay-slow 也在，
    // 它的 ::after（"慢镜"角标）在样式表里写在后面、特异度相同，于是把闪光整条
    // 规则盖掉——闪光恰好在最需要它的时刻不显示。改成独立元素，不再抢伪元素。
    const flash = document.createElement("div");
    flash.className = `mp-goal-flash-fx ${attHome ? "right" : "left"}`;
    this.fxLayer.appendChild(flash);
    setTimeout(() => flash.remove(), 320);

    // 单层小网涟漪（不加第二层大网 / 爆炸光环 / 绿色 burst，
    // 那些在迷你球场上是光污染）
    const net = document.createElement("div");
    net.className = `mp-goal-net ${attHome ? "right" : "left"}`;
    const ns = pitchToScreenPct(gx, gy);
    net.style.left = `${ns.left}%`;
    net.style.top = `${ns.top}%`;
    this.fxLayer.appendChild(net);
    setTimeout(() => net.remove(), 720);
    // 球轻微强调即可
    this.ball.el?.classList.add("mp-ball-goal");
    setTimeout(() => this.ball.el?.classList.remove("mp-ball-goal"), 520);
  }

  _playGoalShot(ev, snap, fixture, { celebrateMs = 2800, skipReset = false } = {}) {
    const homeId = fixture?.home || this.home?.id;
    const attHome = ev.teamId === homeId;
    const team = attHome ? "home" : "away";
    this.fsm.transition('GOAL_SEQUENCE', 'STRIKE');
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
        this.fsm.transition('PLAYING', 'FREE_PLAY');
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
    if (!opts.rewatch) return this._playGoalHighlight(ev, snap, fixture, opts);
    this._presentationReadOnlyDepth++;
    try {
      return await this._playGoalHighlight(ev, snap, fixture, opts);
    } finally {
      this._presentationReadOnlyDepth = Math.max(0, this._presentationReadOnlyDepth - 1);
    }
  }

  async _playGoalHighlight(ev, snap, fixture, opts = {}) {
    if (!this._built || !ev) return;
    const speed = Math.max(0.25, Number(opts.speed) || 1);
    const lang = opts.lang || "zh";
    const sleepFn = typeof opts.sleepFn === "function" ? opts.sleepFn : sleep;
    const homeId = fixture?.home || this.home?.id;
    const attHome = ev.teamId === homeId;
    const team = attHome ? "home" : "away";
    const dir = this._attackDir(team);
    const isRewatch = !!opts.rewatch;
    const random = isRewatch ? replayRandomFor(ev) : Math.random;
    const scene = opts.scene || null;
    const replayReturn =
      isRewatch && (['FULL_TIME', 'PAUSED'].includes(this.fsm.current()) || this.simDrive)
        ? {
            state: this.fsm.current(),
            subState: this.fsm.subState,
            frozen: this._legacyFrozen,
            simDrive: this.simDrive,
            liveSim: this.simDrive && this.fsm.current() === 'PLAYING',
            possession: this.possession,
            bannerText: this.bannerEl?.textContent || "",
          }
        : null;

    // 赛后状态本身不推进动画；回放期间临时交给脚本驱动，结束后原样恢复。
    if (replayReturn) {
      this._legacyFrozen = false;
      this.fieldEl?.classList.remove("mp-ui-paused");
      this.simDrive = false;
      this.fieldEl?.classList.remove("mp-sim-drive");
    }

    // 回看：优先还原进球瞬间场面
    let restored = false;
    if (isRewatch && scene) {
      restored = this.restoreSceneSnapshot(scene);
    }

    const prevCarrier = this.carrier;
    let ballX = this.ball.x;
    let ballY = this.ball.y;

    const enteredReplay = this.fsm.transition('GOAL_SEQUENCE', 'STRIKE', {
      replay: isRewatch,
    });
    if (!enteredReplay) {
      if (replayReturn) {
        this._legacyFrozen = replayReturn.frozen;
        this.fieldEl?.classList.toggle("mp-ui-paused", replayReturn.frozen);
        this.simDrive = replayReturn.simDrive;
        this.fieldEl?.classList.toggle("mp-sim-drive", replayReturn.simDrive);
      }
      return false;
    }
    this._legacyScriptLock = false;
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
    if (!isRewatch && (!assister || assister === scorer)) {
      if (prevCarrier && prevCarrier !== scorer && prevCarrier.team === team) {
        assister = prevCarrier;
      } else if (this.lastCarrierId && this.lastCarrierId !== scorer?.id) {
        const prev = this.players.find((p) => p.id === this.lastCarrierId);
        if (prev && prev.team === team) assister = prev;
      }
    }
    if (!isRewatch && (!assister || assister === scorer)) {
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
      this._seedGoalRewatchPositions(team, attHome, scorer, assister, random);
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
    const { gx, gy } = this._goalMouth(attHome, { deep: true, random });

    // 距球门越近，组织越短（禁区内直接射，中场才完整组织）
    const goalDist = Math.hypot(ballX - gx, ballY - gy);
    /** @type {'box'|'final'|'build'} */
    let depth = "build";
    if (goalDist < 22 || (attHome ? ballY < 28 : ballY > 72)) depth = "box";
    else if (goalDist < 40 || (attHome ? ballY < 42 : ballY > 58)) depth = "final";

    // 有助攻：回放/高光强制走出「助攻传球 → 射门」，不直接禁区终结跳过传球
    const wantAssist =
      !!(assister && scorer && assister !== scorer) &&
      (isRewatch ? !!ev.assistId : !!ev.assistId || depth !== "box");
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
    this._nudgeAttackShape(team, depth === "box" ? 0.22 : 0.4, random);
    this._nudgeDefendShape(
      team === "home" ? "away" : "home",
      prevCarrier || { x: ballX, y: ballY },
      random
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
    if (isRewatch && !ev.assistId) organizer = scorer;
    if (!isRewatch && !assister && organizer && organizer !== scorer) assister = organizer;

    // 回放/有助攻：把助攻者摆到稍身后持球位，射手前插要球（明显看出传球）
    if (wantAssist && assister && scorer) {
      const midX = clamp((assister.x + scorer.x) / 2, 18, 82);
      assister.x = clamp(midX + (random() - 0.5) * 6, 16, 84);
      assister.y = clamp(
        attHome ? Math.max(assister.y, boxY + 14) : Math.min(assister.y, boxY - 14),
        12,
        88
      );
      assister.tx = assister.x;
      assister.ty = assister.y;
      this._applyPlayer(assister);
      scorer.x = clamp(midX + (random() - 0.5) * 10, 18, 82);
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
        scorer.tx = clamp(scorer.x + (random() - 0.5) * 10, 14, 86);
        scorer.ty = clamp(scorer.y + dir * (8 + random() * 8), 10, 90);
      } else {
        scorer.tx = clamp(scorer.x + (random() - 0.5) * 5, 18, 82);
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
      defs[i].tx = clamp((organizer?.x || ballX) + (random() - 0.5) * 8, 8, 92);
      defs[i].ty = clamp((organizer?.y || ballY) + (random() - 0.5) * 6, 8, 92);
    }

    if (depth === "build") {
      await wait(560);
      // —— 2) 前压 ——
      if (organizer) {
        organizer.tx = clamp(organizer.x + (random() - 0.5) * 8, 12, 88);
        organizer.ty = clamp(organizer.y + dir * (8 + random() * 6), 10, 90);
        this._setTouch(organizer, 1800);
      }
      if (scorer && scorer !== organizer) {
        scorer.tx = clamp(
          (organizer?.x || scorer.x) + (random() < 0.5 ? -11 : 11),
          12,
          88
        );
        scorer.ty = clamp(lerp(scorer.y, boxY, 0.55), 8, 92);
      }
      for (const pl of this.players.filter(
        (p) => p.team === team && p !== scorer && p !== organizer && p.pos !== "GK"
      )) {
        if (random() < 0.35) {
          pl.tx = clamp(pl.x + (random() - 0.5) * 8, 8, 92);
          pl.ty = clamp(pl.y + dir * (4 + random() * 6), 8, 92);
        }
      }
      await wait(720);
    } else if (depth === "final") {
      await wait(380);
      if (organizer) {
        organizer.tx = clamp(organizer.x + (random() - 0.5) * 6, 14, 86);
        organizer.ty = clamp(organizer.y + dir * 6, 10, 90);
      }
      if (scorer && scorer !== organizer) {
        scorer.tx = clamp(scorer.x + (random() - 0.5) * 8, 14, 86);
        scorer.ty = clamp(lerp(scorer.y, boxY, 0.5), 8, 92);
      }
      await wait(420);
    } else {
      await wait(220);
    }

    // —— 3) 助攻直塞 / 自己带入 ——
    // 有助攻时强制：助攻者持球 → 传球轨迹 → 射手接球再射（回放重点）
    if ((wantAssist || depth !== "box") && organizer && scorer && organizer !== scorer) {
      scorer.tx = clamp(scorer.x + (random() - 0.5) * 6, 16, 84);
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
        random,
      });
      this._addTrail(organizer.x, organizer.y, scorer.tx, scorer.ty, "pass", 0.55);
      await wait(isRewatch || wantAssist ? 920 : depth === "final" ? 700 : 880);
      if (this.carrier !== scorer) this._setCarrier(scorer, { stick: true });
      scorer.tx = clamp(scorer.x + (random() - 0.5) * 5, 18, 82);
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
      scorer.tx = clamp(scorer.x + (random() - 0.5) * 5, 18, 82);
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
    this.fsm.transition('GOAL_SEQUENCE', 'CELEBRATE');
    // 多帧插值庆祝（约 2.6s）
    const celeSteps = isRewatch ? 14 : 18;
    for (let i = 0; i < celeSteps; i++) {
      this._tickVisualCelebrate(0.12);
      this._drawCanvas?.();
      await wait(isRewatch ? 110 : 140);
    }

    // —— 6) 直播继续开球；赛后回看恢复完场画面 ——
    this._celebrate = null;
    await this._restartAfterGoal(attHome, { wait, lang, replayReturn });
    return true;
  }

  async replayEvents(events, fixture, { onStep, speed = 1, sleepFn } = {}) {
    this.fsm.transition('PLAYING', 'FREE_PLAY');
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
    const s = pitchToScreenPct(x, y);
    el.style.left = `${s.left}%`;
    el.style.top = `${s.top}%`;
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
