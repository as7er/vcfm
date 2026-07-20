// VCFM 比赛引擎 v2 —— 空间模拟核心（纯逻辑，无 DOM）
//
// 设计见 docs/match-engine-v2-plan.md。
// 坐标系沿用全项目约定：0..100 × 0..100，主队守下方(y 大)、客队守上方(y 小)。
//   → 主队进攻方向朝 y 小（对方球门 y≈4），客队进攻方向朝 y 大（对方球门 y≈96）。
// 属性沿用 models.js 的 1..20 制。
//
// 本文件是 SimEngine 的"唯一真相来源"：以固定步长推进，产出 SimState 快照。
// matchview 只负责把快照画出来；match.js 只负责把涌现事件翻译回现有 event 结构。
//
// —— 阶段进度 ——
// P0–P5：球物理、持球/无球决策、球队协防、裁判规则、directResult 正式接入
// P5：match.js 经 sim/adapt.js 接入用户场；AI 后台仍用概率引擎

import { FORMATIONS } from "./../data.js";
import {
  getLineupPlayers,
  assignPlayersToFormationSlots,
  getCorePlayerId,
  getSlotRole,
  ensureTactics,
  ensureLineupRoles,
  ensureCorePlayer,
} from "./../models.js";

// ————————————————————————————————————————————————————————————
// 常量与工具
// ————————————————————————————————————————————————————————————

export const SIM = {
  DT: 0.1, // 固定步长（秒），10Hz
  FIELD_W: 100,
  FIELD_H: 100,
  // 球门：主队球门在 y≈100 一侧，客队球门在 y≈0 一侧；门宽以 x 计
  GOAL_X0: 44,
  GOAL_X1: 56,
  HOME_GOAL_Y: 100, // 主队防守的球门线
  AWAY_GOAL_Y: 0, // 客队防守的球门线
  // 球物理
  BALL_FRICTION: 0.96, // 每步地面滚动速度衰减
  CONTROL_RADIUS: 2.6, // 球员控球半径（百分比坐标）
  // 真实场地约按 105m×68m；把百分比坐标粗略当作"米级"处理，速度单位 = 场地%/秒
  MAX_PLAYER_SPEED: 6, // 顶级 pace 的最大移动速度（%/秒）；对齐真实纵穿全场约 14s
};

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}
/** 属性 1..20 → 0..1 归一 */
function norm(v) {
  // 足球是强协作系统，属性差不能线性放大成“弱队完全无法触球”。
  // 压缩两端仍保留强弱差异，同时给低级别球员基本职业能力下限。
  const raw = clamp((v ?? 10) / 20, 0.05, 1);
  return clamp(0.28 + raw * 0.64, 0.3, 0.92);
}

/**
 * 加权随机采样：从 [{key, w}] 里按权重 w 概率选一个。
 * temp（温度）控制随机度：temp→0 近似取最大值（确定性），temp 越大越随机。
 * 这是让决策"有概率性、不死板"的核心——同样局面不再永远同一选择，
 * 但高分动作仍更可能被选中（贴近真实球员的临场差异）。
 */
function weightedPick(items, temp = 0.35) {
  const valid = items.filter((it) => it && it.w > 0);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0].key;
  // softmax：exp(w/temp) 归一为概率
  const t = Math.max(0.05, temp);
  let sum = 0;
  const exps = valid.map((it) => {
    const e = Math.exp(it.w / t);
    sum += e;
    return e;
  });
  let r = Math.random() * sum;
  for (let i = 0; i < valid.length; i++) {
    r -= exps[i];
    if (r <= 0) return valid[i].key;
  }
  return valid[valid.length - 1].key;
}

/** 主队守下方(y 大)、客队守上方(y 小)：把阵型 slot 映射到场地坐标 */
function slotToPitch(slot, isHome) {
  let x = slot.x;
  let y = slot.y;
  if (!isHome) {
    x = 100 - x;
    y = 100 - y;
  }
  return { x, y };
}

// ————————————————————————————————————————————————————————————
// SimEngine
// ————————————————————————————————————————————————————————————

export class SimEngine {
  /**
   * @param {object} home  主队俱乐部对象（含 tactics、阵容）
   * @param {object} away  客队俱乐部对象
   * @param {object} [opts]
   */
  constructor(home, away, opts = {}) {
    this.home = home;
    this.away = away;
    this.opts = opts;
    this.t = 0; // 已模拟时间（秒）
    this.agents = [];
    this.ball = null;
    this.events = []; // 本引擎涌现的事件（P1+ 由决策产出；P0 仅 kickoff）
    // 球权阶段与防守任务由球队统一协调。此前每个球员每 0.1s 独立重排职责，
    // 会让上抢者/补位者来回交换，视觉上表现为集体抽搐。
    this._phaseTeam = null;
    this._defPlans = {
      home: { until: 0, jobs: new Map() },
      away: { until: 0, jobs: new Map() },
    };
    this._teamShotUntil = { home: 0, away: 0 };
    this._teamThroughUntil = { home: 0, away: 0 };
    this._teamTackleUntil = { home: 0, away: 0 };
    this._teamAttackSince = { home: 0, away: 0 };
    this._init();
  }

  _init() {
    this.agents = [];
    this._spawnTeam(this.home, true);
    this._spawnTeam(this.away, false);
    // 球先置于中圈，无归属
    this.ball = {
      x: 50,
      y: 50,
      vx: 0,
      vy: 0,
      z: 0,
      vz: 0,
      owner: null, // agent.id 或 null
    };
    this.t = 0;
    this.events = [];
    this.possession = "home";
    this.score = { home: 0, away: 0 };
    this.stats = {
      home: { shots: 0, passes: 0, poss: 0 },
      away: { shots: 0, passes: 0, poss: 0 },
    };
    // 死球恢复窗口：开球/重开后此刻前，持球方不被逼抢、不立刻起脚
    this.deadBallUntil = 0;
    // 进球庆祝（秒）：期间不立刻回中圈，队友聚拢后再开球
    this.celebrateUntil = 0;
    this.celebrateTeam = null;
    this.kickoffTeam = null;
    this.celebrateScorerId = null;
    this.celebrateCornerX = 50;
    this.celebrateParticipants = null;
    this.cornerShapeUntil = 0;
    // 正式开球（不靠"巧合触球"）
    this._kickoff("home");
  }

  /** 建立一队 11 个 agent（读阵型 slot + XI 球员属性） */
  _spawnTeam(club, isHome) {
    // 主客对称：都补齐战术/角色/核心，避免只有用户队有边锋内切、核心权等
    if (club) {
      ensureTactics(club);
      ensureLineupRoles(club);
      ensureCorePlayer(club);
    }
    const form = FORMATIONS[club?.tactics?.formation] || FORMATIONS["4-3-3"];
    const slots = form.slots || [];
    const xi = getLineupPlayers(club) || [];
    // 按阵型槽位匹配位置：门将必须落在 GK 槽，避免 lineup 顺序乱导致「球门没人」
    const assigned = assignPlayersToFormationSlots(xi, slots);
    for (let i = 0; i < Math.min(11, slots.length); i++) {
      const slot = slots[i];
      const p = assigned[i] || xi[i] || null;
      const base = slotToPitch(slot, isHome);
      const a = p?.attrs || {};
      // 战术角色以阵型槽为准（槽是 GK 就必须按门将 AI 站门）
      const role = slot.pos || p?.pos || "MID";
      // 战术板角色 id（边路爆破 / 内切前锋 等）
      let roleId = null;
      try {
        roleId = club ? getSlotRole(club, i) : null;
      } catch {
        roleId = null;
      }
      this.agents.push({
        id: p?.id || `${isHome ? "h" : "a"}-slot-${i}`,
        player: p,
        club,
        team: isHome ? "home" : "away",
        isHome,
        role, // GK | DEF | MID | ATT
        roleId: roleId || null,
        num: p?.number ?? i + 1,
        // —— 运动状态 ——
        x: base.x,
        y: base.y,
        tx: base.x, // 移动目标（初始 = 基准位，防 NaN）
        ty: base.y,
        vx: 0,
        vy: 0,
        heading: isHome ? -Math.PI / 2 : Math.PI / 2, // 朝对方球门
        // —— 阵型基准位（跑位围绕它浮动）——
        baseX: base.x,
        baseY: base.y,
        // 阵型槽原始 x（未翻转）：主客队判定边锋/边卫时一致，不依赖场地翻转后的 baseX
        slotX: slot.x ?? 50,
        slotY: slot.y ?? 50,
        // —— 归一化属性（决策用，读一次缓存）——
        attr: {
          pace: norm(a.pace),
          accel: norm(a.pace) * 0.6 + norm(a.strength) * 0.4, // 无独立加速度属性，用 pace/strength 合成
          passing: norm(a.passing),
          vision: norm(a.vision),
          shooting: norm(a.shooting),
          finishing: norm(a.finishing),
          dribbling: norm(a.dribbling),
          tackling: norm(a.tackling),
          marking: norm(a.marking),
          strength: norm(a.strength),
          stamina: norm(a.stamina),
          positioning: norm(a.positioning),
          reflexes: norm(a.reflexes),
          handling: norm(a.handling),
          kicking: norm(a.kicking),
        },
        // —— 决策缓存（P1 用）——
        decisionUntil: 0, // 到该时间前沿用上次决策
        attackThinkUntil: 0,
        intent: null, // { type, tx, ty, targetId... }
        // —— 状态机标签（渲染/调试用）——
        fsm: "home",
        fitness: p?.fitness ?? 100,
        // 核心球员：战术指定，享有进攻绝对权（梅西/C罗式）
        isCore: false,
      });
    }
    // 标记核心（每队最多一人；主客都确保有，见 ensureCorePlayer）
    const teamTag = isHome ? "home" : "away";
    let coreId = getCorePlayerId(club);
    if (!coreId) {
      // 引擎兜底：从本队 agent 里挑进攻属性最强者（与 models.pickAutoCore 同思路）
      const teamAgents = this.agents.filter((x) => x.team === teamTag && x.role !== "GK");
      let best = null;
      let bestS = -1;
      for (const ag of teamAgents) {
        const s =
          (ag.attr.finishing || 0) * 1.2 +
          (ag.attr.dribbling || 0) * 1.2 +
          (ag.attr.shooting || 0) +
          (ag.attr.pace || 0) * 0.6 +
          (ag.role === "ATT" ? 0.35 : ag.role === "MID" ? 0.2 : 0);
        if (s > bestS) {
          bestS = s;
          best = ag;
        }
      }
      if (best) {
        coreId = best.id;
        if (club?.tactics) club.tactics.corePlayerId = coreId;
      }
    }
    if (coreId) {
      const core = this.agents.find((x) => x.id === coreId && x.team === teamTag);
      if (core) core.isCore = true;
    }
  }

  /** 边后卫？宽位 DEF（用阵型 slotX，主客对称） */
  _isFullback(a) {
    const x = a.slotX != null ? a.slotX : a.baseX;
    return a.role === "DEF" && (x < 30 || x > 70);
  }

  /**
   * 边锋？宽位前锋 / 宽位中场 / 战术角色「边路爆破」「内切前锋」
   * 用阵型原始 slotX 判定，避免客队翻转坐标导致漏判
   * 负责：回撤拿球 → 内切射门或分球
   */
  _isWinger(a) {
    if (!a || a.role === "GK" || a.role === "DEF") return false;
    const rid = a.roleId;
    if (rid === "winger" || rid === "st_inside") return true;
    const x = a.slotX != null ? a.slotX : a.baseX;
    // 宽位 ATT（4-3-3 边锋等）
    if (a.role === "ATT" && (x < 34 || x > 66)) return true;
    // 宽位 MID（4-2-3-1 / 3-5-2 边前卫）
    if (a.role === "MID" && (x < 26 || x > 74)) return true;
    return false;
  }

  /**
   * 边锋在场地上的侧向：-1 左半场，+1 右半场（用当前 baseX/x，已含客队翻转）
   * 内切方向 = 朝中路，与主客无关
   */
  _wingSide(a) {
    const px = a.x != null ? a.x : a.baseX;
    return px < 50 ? -1 : 1;
  }

  /** 该队进攻方向：主队朝 y 小(-1)，客队朝 y 大(+1) */
  attackDir(team) {
    return team === "home" ? -1 : 1;
  }
  /** 该队进攻的目标球门 y */
  targetGoalY(team) {
    return team === "home" ? SIM.AWAY_GOAL_Y : SIM.HOME_GOAL_Y;
  }

  agentById(id) {
    return this.agents.find((a) => a.id === id) || null;
  }

  _clearBallTarget() {
    if (!this.ball) return;
    this.ball.receiverId = null;
    this.ball.targetX = null;
    this.ball.targetY = null;
    this.ball.expectedAt = 0;
    this.ball.isThroughPass = false;
    this.ball.offsideLineY = null;
    this.ball.offsideBallY = null;
    this.ball.offsideIds = null;
    this.ball.offsidePasser = null;
  }

  _teamTactics(team) {
    return (team === "home" ? this.home : this.away)?.tactics || {};
  }

  _tacticLevel(team, key, fallback = 3) {
    return clamp(Number(this._teamTactics(team)?.[key]) || fallback, 1, 5);
  }

  _nextControlDecision(a) {
    const tempo = this._tacticLevel(a.team, "tempo");
    const base = clamp(1.9 - (tempo - 3) * 0.18, 1.35, 2.45);
    const spread = clamp(1.7 - (tempo - 3) * 0.1, 1.1, 2.1);
    return this.t + base + Math.random() * spread;
  }

  _applyAttackTactics(a, phaseActor) {
    const tactics = this._teamTactics(a.team);
    const width = this._tacticLevel(a.team, "width");
    const widthMul = 1 + (width - 3) * 0.09;
    a.tx = clamp(50 + (a.tx - 50) * widthMul, 3, 97);

    const dir = this.attackDir(a.team);
    const style = tactics.style || "balanced";
    let depthShift = style === "attack" ? 3 : style === "defend" ? -2.5 : 0;
    if (style === "counter" && this.t - (this._teamAttackSince[a.team] || 0) < 7) {
      depthShift = 4;
    } else if (style === "possession" && phaseActor && phaseActor.team === a.team) {
      // 控球风格缩短接应距离，形成更多稳定三角，而不是全员冲纵深。
      a.tx = clamp(a.tx * 0.86 + phaseActor.x * 0.14, 3, 97);
      a.ty = clamp(a.ty * 0.86 + phaseActor.y * 0.14, 3, 97);
      depthShift = -1;
    }
    a.ty = clamp(a.ty + dir * depthShift, 3, 97);
    this._clampOffside(a);
  }

  // ——————————————————————————————————————————————
  // 推进一步（dt 秒）
  // ——————————————————————————————————————————————
  step(dt = SIM.DT) {
    // 进球庆祝段：球钉在网里，队友聚拢，结束后再中圈开球
    if (this.celebrateUntil && this.t < this.celebrateUntil) {
      this._tickCelebrate(dt);
      this.t += dt;
      if (this.t >= this.celebrateUntil - 1e-9) {
        this.celebrateUntil = 0;
        const side = this.kickoffTeam || "home";
        this.celebrateTeam = null;
        this.celebrateScorerId = null;
        this.celebrateParticipants = null;
        this._kickoff(side);
      }
      return;
    }

    // 1) 各 agent 决策 → 设定运动目标 / 触发传射
    const owner = this.ball.owner ? this.agentById(this.ball.owner) : null;
    // 传球/射门飞行中 owner 会暂时为空，但攻防阶段不能因此每脚球都切成“全员抢松球”。
    // kickTeam 是这段连续进攻的控制方；receiver/lastKicker 是阶段参照点。
    const flightControl =
      !owner && (this.ball.state === "pass" || this.ball.state === "shot")
        ? this.ball.kickTeam || null
        : null;
    const controlTeam = owner?.team || flightControl;
    const phaseActor =
      owner ||
      (this.ball.receiverId ? this.agentById(this.ball.receiverId) : null) ||
      (this.ball.lastKicker ? this.agentById(this.ball.lastKicker) : null);
    if (controlTeam && controlTeam !== this._phaseTeam) {
      this._phaseTeam = controlTeam;
      this._teamAttackSince[controlTeam] = this.t;
      this._defPlans.home.until = 0;
      this._defPlans.away.until = 0;
      for (const a of this.agents) a.attackThinkUntil = 0;
    }
    this.possession = controlTeam || this.possession;
    for (const a of this.agents) this._think(a, dt, owner, controlTeam, phaseActor);
    // 2) 积分运动
    for (const a of this.agents) this._integrate(a, dt);
    // 2b) 近距离分离，减轻禁区「叠成一团」（多轮更干净）
    this._separateAgents();
    this._separateAgents();
    // 3) 球物理
    this._stepBall(dt);
    // 4) 接管/控球判定
    this._resolvePossession(dt);
    // 5) 裁判规则（P3 填充：越位/出界/进球）——P0 仅做出界夹回
    this._resolveBounds();
    // 5a) 防死锁看门狗：僵持 20s 强制解围（存量僵持 + 减员放大的兜底）
    this._antiDeadlock(dt);
    // 5b) 疲劳伤病抽查（每 60s 模拟时间一次）
    if (this.t >= (this._fatigueCheckT || 0)) {
      this._fatigueCheckT = this.t + 60;
      this._tickFatigueInjury();
    }
    // 5c) 伤病换人生效（替补从边线进场）
    if (this._pendingSubs && this._pendingSubs.length) {
      for (let i = this._pendingSubs.length - 1; i >= 0; i--) {
        const s = this._pendingSubs[i];
        if (this.t >= s.at) {
          this.substituteAgent(s.outId, s.player);
          this._pendingSubs.splice(i, 1);
        }
      }
    }
    this.t += dt;
  }

  /**
   * 决策分流：持球者 / 无球进攻方 / 防守方 / 门将。
   * 持球者按 decisionUntil 节流（受 tempo 与接球状态影响），中间沿用上次意图。
   */
  _think(a, dt, owner, controlTeam = owner?.team || null, phaseActor = owner) {
    if (a.sentOff) {
      // 被罚下：走向边线外并停住，不再参与任何决策/跑位。
      a.tx = a.team === "home" ? 1 : 99;
      a.ty = clamp(a.y, 4, 96);
      a.fsm = "off";
      a.intent = null;
      return;
    }
    if (a.role === "GK") return this._thinkGK(a, owner);

    const b = this.ball;

    // 被明确指定为接球队员后已经向球做出动作，属于参与进攻；若出脚快照中
    // 处于越位位置，无需等到真正触球才吹哨。
    if (
      !owner &&
      b.state === "pass" &&
      b.receiverId === a.id &&
      b.kickTeam === a.team &&
      b.offsideIds instanceof Set &&
      b.offsideIds.has(a.id)
    ) {
      this._callOffside(a);
      return;
    }

    // 角球摆位后的短窗口保持结构；除主罚者外，不在下一 tick 立刻把所有目标
    // 重算到球附近。主罚出球后再统一启动跑位。
    if (this.t < (this.cornerShapeUntil || 0) && b.owner !== a.id) {
      a.tx = a.x;
      a.ty = a.y;
      a.fsm = a.team === b.kickTeam ? "support" : "cover";
      return;
    }

    // 定向传球的接球队员拥有稳定接球任务；不再跟普通无球跑位争夺目标点。
    if (
      !owner &&
      b.state === "pass" &&
      b.receiverId === a.id &&
      b.kickTeam === a.team
    ) {
      const remain = Math.max(0.12, (b.expectedAt || this.t + 0.3) - this.t);
      a.tx = clamp(
        Number.isFinite(b.targetX) ? b.targetX : b.x + b.vx * remain,
        2,
        98
      );
      a.ty = clamp(
        Number.isFinite(b.targetY) ? b.targetY : b.y + b.vy * remain,
        2,
        98
      );
      a.intent = { type: "receive", tx: a.tx, ty: a.ty, targetId: a.id };
      a.fsm = "receive";
      return;
    }

    // 只有真正失去控制的 loose ball 才进入争抢；传球飞行仍保持原攻防结构。
    if (!controlTeam && !owner && this.t >= (this.deadBallUntil || 0)) {
      return this._thinkLoose(a);
    }

    const hasBall = b.owner === a.id;
    const teamHasBall = controlTeam === a.team;

    if (hasBall) {
      // 飞行中的球没有 owner，这里 owner===a 一定是脚下控球
      if (this.t >= a.decisionUntil) {
        const tempo = this._tacticLevel(a.team, "tempo");
        a.decisionUntil =
          this.t +
          clamp(0.9 - (tempo - 3) * 0.06, 0.7, 1.15) +
          Math.random() * 0.7;
        this._decideOnBall(a);
      }
      // 执行上次意图（盘带/护球朝目标带球；传/射在 decide 内瞬时触发）
      if (a.intent && (a.intent.type === "dribble" || a.intent.type === "hold")) {
        a.tx = a.intent.tx;
        a.ty = a.intent.ty;
      }
      return;
    }

    if (teamHasBall) {
      // 无球跑位目标保持 0.55~1.1s；随机数只在生成新意图时使用，不能每 tick 漂移。
      if (this.t >= (a.attackThinkUntil || 0)) {
        const tempo = this._tacticLevel(a.team, "tempo");
        a.attackThinkUntil =
          this.t +
          clamp(0.62 - (tempo - 3) * 0.055, 0.42, 0.82) +
          Math.random() * 0.5;
        this._thinkAttackOffBall(a, phaseActor);
        this._applyAttackTactics(a, phaseActor);
      }
      return;
    }
    return this._thinkDefend(a, phaseActor);
  }

  /** 门将：持球时开球分发（重置攻防），否则守门站位（绝不能离门太远） */
  _thinkGK(a, owner) {
    const goalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
    const b = this.ball;
    const facing = a.team === "home" ? -1 : 1; // 出击方向朝场内
    // 门将活动区：永远贴在球门前（主队 y 大、客队 y 小）
    const maxAdvance = 10; // 最多离门线 10 个坐标
    const clampGkY = (ty) =>
      a.team === "home"
        ? clamp(ty, goalY - maxAdvance, goalY - 2)
        : clamp(ty, goalY + 2, goalY + maxAdvance);

    // —— 门将持球：护球够久再开球（避免与前锋贴脸「传球互动」）——
    if (b.owner === a.id) {
      if (this.t >= a.decisionUntil) {
        a.decisionUntil = this.t + 0.55 + Math.random() * 0.35;
        this._gkDistribute(a);
      }
      // 持球时钉在门区，不跟着前锋挪
      a.tx = clamp(50 + (b.x - 50) * 0.15, 42, 58);
      a.ty = clampGkY(goalY + facing * 3);
      a.fsm = "home";
      return;
    }

    // 身后低平球：门将提前向落点收窄角度。旧逻辑只有前锋已经拿球后才出击，
    // 合法反越位也会轻易变成无人干扰的单刀。
    const throughReceiver = b.receiverId ? this.agentById(b.receiverId) : null;
    const throughTargetX = Number(b.targetX);
    const throughTargetY = Number(b.targetY);
    const throughGoalDist =
      Number.isFinite(throughTargetX) && Number.isFinite(throughTargetY)
        ? dist(throughTargetX, throughTargetY, 50, goalY)
        : Infinity;
    if (
      b.state === "pass" &&
      b.isThroughPass &&
      b.kickTeam !== a.team &&
      throughReceiver?.team !== a.team &&
      throughGoalDist < 20
    ) {
      const advance = clamp(12 - throughGoalDist * 0.16, 7, maxAdvance);
      a.tx = clamp(throughTargetX, 38, 62);
      a.ty = clampGkY(goalY + facing * advance);
      a.fsm = "press";
      return;
    }

    // —— 守门站位 + 小幅出击 ——
    const dGoal = dist(b.x, b.y, 50, goalY);
    const underThreat = owner && owner.team !== a.team && dGoal < 22;
    if (underThreat) {
      const vx = b.x - 50,
        vy = b.y - goalY;
      const len = Math.hypot(vx, vy) || 1;
      // 出击很克制：最多离门 7，避免「门将失踪」
      const advance = clamp(8 - dGoal * 0.2, 2.5, 7);
      a.tx = clamp(50 + (vx / len) * (advance * 0.45), 40, 60);
      a.ty = clampGkY(goalY + facing * advance);
      a.fsm = "press";
      return;
    }
    // 常规：门线前跟球横向移动
    const threat = a.team === "home" ? b.y > 78 : b.y < 22;
    const depth = threat ? 7 : 4;
    a.tx = clamp(b.x, 40, 60);
    a.ty = clampGkY(goalY + facing * depth);
    a.fsm = "home";
  }

  /** 门将分发：有压迫必大脚；否则才短传发动。杜绝门口与前锋「互传」 */
  _gkDistribute(a) {
    const b = this.ball;
    // 身边有对方出球员 → 绝不短传（画面上像门将和前锋传球互动）
    let pressureNear = 0;
    for (const o of this.agents) {
      if (o.team === a.team || o.role === "GK") continue;
      if (dist(o.x, o.y, a.x, a.y) < 11) pressureNear++;
    }
    const passTo = pressureNear === 0 ? this._bestPass(a) : null;
    // 有安全接球人且不太靠后 → 手抛/短传发动进攻
    if (passTo && passTo.value > 0.22 && pressureNear === 0) {
      // 接球人也不能贴在小禁区里（否则又像互传）
      const recv = passTo.agent;
      const recvOk =
        recv &&
        (a.team === "home" ? recv.y < 82 : recv.y > 18) &&
        dist(recv.x, recv.y, a.x, a.y) > 10;
      if (recvOk) {
        this._pass(a, passTo);
        return;
      }
    }
    // 大脚开到中场边路（远离己方球门，打破死循环）
    const dir = this.attackDir(a.team);
    const targetY = 50 + dir * -8; // 中场略偏己方一侧
    const targetX = Math.random() < 0.5 ? 22 : 78; // 开向边路
    const dx = targetX - b.x;
    const dy = targetY - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const power = clamp(30 + a.attr.kicking * 12, 30, 44);
    b.owner = null;
    b.vx = (dx / d) * power;
    b.vy = (dy / d) * power;
    b.z = 0.45;
    b.vz = 15 + a.attr.kicking * 6; // 大脚解围高吊 peak ~6–8
    b.lastKicker = a.id;
    b.kickTeam = a.team;
    b.kickX = b.x;
    b.kickY = b.y;
    // 门将大脚开球不受越位限制：清空越位快照，避免残留上次传球的旧线导致误判。
    b.offsideLineY = null;
    b.state = "pass";
    this._clearBallTarget();
    b.offsideExemptRestart = false;
    b.restartType = null;
    a.intent = null;
    a.pose = "kick";
    a.poseUntil = this.t + 0.45;
    this._emit("gk_clear", a);
    a.noReclaimUntil = this.t + 0.55;
    this.deadBallUntil = this.t + 0.7; // 开球保护加长，防门口围抢乒乓
    b.settleUntil = this.t + 0.65;
  }

  /**
   * 持球者决策（分区结构，替代四动作连续竞价）：
   *   1) 先按"到对方球门距离 dGoal"把场地分区，每区允许的动作集合不同：
   *      · 射门区 (dGoal<SHOOT_ZONE 且有角度)：射门 vs 传球，射门有每人冷却
   *      · 组织区 (其余)：只在 传球/盘带/护球 中选，禁止射门（根除远射爆炸）
   *   2) 每区内动作数量少、量级可控，不会出现某一维爆掉的双稳态。
   * 传球/射门为瞬时动作（给球初速、清 owner）；盘带/护球只设移动目标。
   */
  _decideOnBall(a) {
    const b = this.ball;
    // —— 角球开出：站在角旗附近持球时强制传中进禁区（保证观众能看到「角球开出」）——
    if (
      b.state === "corner" &&
      b.owner === a.id &&
      (a.x < 12 || a.x > 88) &&
      (a.y < 14 || a.y > 86)
    ) {
      const boxY = a.team === "home" ? 14 : 86;
      const crossTo = this._bestCross(a);
      if (crossTo) {
        this._pass(a, { ...crossTo, cross: true });
      } else {
        // 兜底：吊向点球点附近
        this._pass(a, {
          agent: null,
          value: 1,
          through: false,
          cross: true,
          tx: clamp(50 + (Math.random() - 0.5) * 12, 38, 62),
          ty: clamp(boxY + (Math.random() - 0.5) * 6, 8, 92),
        });
      }
      b.state = "pass";
      return;
    }

    // —— 人墙任意球主罚：按 _restart 制定的计划执行 ——
    // 直接射门吃现有人墙封堵/门将扑救；否则吊传禁区抢点（不豁免越位，规则如此）。
    // 直接调 _shoot 绕过全队射门冷却：定位球是常规进攻节奏之外的额外机会。
    if (
      b.restartType === "freekick" &&
      b.owner === a.id &&
      a._fkPlan &&
      this.t < (a._fkPlanUntil || 0)
    ) {
      const plan = a._fkPlan;
      a._fkPlan = null;
      b.restartType = null;
      if (plan === "shoot") {
        a.shotCdUntil = this.t + 1.2;
        this._shoot(a, { freekick: true });
        return;
      }
      const fkBoxY = a.team === "home" ? 14 : 86;
      const cross = this._bestCross(a);
      this._pass(
        a,
        cross
          ? { ...cross, cross: true }
          : {
              agent: null,
              value: 1,
              through: false,
              cross: true,
              tx: clamp(50 + (Math.random() - 0.5) * 12, 40, 60),
              ty: clamp(fkBoxY + (Math.random() - 0.5) * 6, 8, 92),
            }
      );
      return;
    }

    const goalY = this.targetGoalY(a.team);
    const goalX = 50;
    const dGoal = dist(a.x, a.y, goalX, goalY);
    const dir = this.attackDir(a.team);
    const pressure = this._pressureOn(a); // 0..1，越大越被逼
    const core = !!a.isCore; // 核心：进攻绝对权
    const attackAge = Math.max(0, this.t - (this._teamAttackSince[a.team] || 0));

    // 死球窗口内（开球/重开后）：只护球，不传射，不给对方逼抢窗口
    if (this.t < (this.deadBallUntil || 0)) {
      a.intent = { type: "hold", tx: a.x, ty: clamp(a.y + dir * 2, 3, 97) };
      a.fsm = "carry";
      return;
    }

    // 界外球必须由首脚传入场，不能把“首脚无越位”豁免带进后续盘带再传。
    if (b.offsideExemptRestart && b.restartType === "throwin") {
      const restartPass = this._bestPass(a);
      if (restartPass) {
        this._pass(a, restartPass);
        return;
      }
    }

    // 近射区：前锋/任何人；中场/核心/边锋内切弧顶稍大
    const isMid = a.role === "MID";
    const isAtt = a.role === "ATT";
    const isFb = this._isFullback(a);
    const isWing = this._isWinger(a);
    // 边锋内切：x 已靠中时射门区更大；贴边时仍要先内切
    const cutInProgress = isWing ? clamp(1 - Math.abs(a.x - goalX) / 38, 0, 1) : 0;
    const SHOOT_ZONE = core ? 28 : isWing ? 22 + cutInProgress * 6 : isMid ? 24 : 20;
    const angF = clamp(1 - Math.abs(a.x - goalX) / 26, 0, 1);
    const inShootZone = dGoal < SHOOT_ZONE && angF > (isWing ? 0.1 : 0.12);

    // ——————————— 近距离/弧顶射门区 ———————————
    if (inShootZone) {
      // 全队射门节奏上限只管常规进攻；已杀到门前（dGoal<12）必须允许起脚，
      // 否则冷却期内持球者在门前无动作可选 → 底线僵持（看门狗曾兜底的根因）。
      const cdBlocked = this.t < (this._teamShotUntil[a.team] || 0);
      const canShoot =
        this.t >= (a.shotCdUntil || 0) &&
        (!cdBlocked || dGoal < 12) &&
        (attackAge >= 3.5 || dGoal < 12);
      const distF = clamp(1 - dGoal / SHOOT_ZONE, 0, 1);
      const finBias = isMid && !isWing
        ? 0.35 * a.attr.finishing + 0.45 * a.attr.shooting
        : isWing
          ? 0.4 * a.attr.finishing + 0.4 * a.attr.shooting + 0.15 * a.attr.dribbling
          : 0.55 * a.attr.finishing + 0.25 * a.attr.shooting;
      let shootQuality =
        (0.5 * distF + 0.35 * angF) * (0.5 + finBias) * (1 - pressure * 0.25);
      if (core) shootQuality *= 1.35; // 核心：球权在自己脚下更敢射
      if (isWing) shootQuality *= 1.12 + cutInProgress * 0.2; // 内切后敢抽射

      const passTo = this._bestPass(a);
      let passQuality = passTo ? passTo.value * (0.6 + 0.4 * a.attr.vision) : 0;
      // 核心：除非传球质量碾压，否则优先自己解决
      if (core) passQuality *= 0.72;
      // 边锋：禁区附近仍会分中路队友，但不轻易放弃自己机会
      if (isWing && passTo?.agent?.role === "ATT" && !this._isWinger(passTo.agent)) {
        passQuality *= 1.15;
      }

      const shootThresh = core ? 0.24 : isWing ? 0.26 : isMid && dGoal > 16 ? 0.28 : 0.32;
      // 旧逻辑一旦质量过线便必射，导致每场数百脚。现在质量只决定“是否值得考虑”，
      // 最终仍需一次低频机会选择；越近、越强的终结者越敢起脚。
      // 12~22 距离的窗口反而略积极：避免强队总是一路带到六码区才射，
      // 既让画面更像正常攻门，也把机会质量拉回合理范围。
      const rangeBonus = dGoal >= 12 && dGoal <= 22 ? 0.32 : dGoal < 12 ? 0.1 : 0;
      // 穿透全队冷却的门前射门是"保活性"的例外通道，不是常规机会：
      // 概率重压（×0.3），大部分冷却期门前球走下方泄压阀（传中/回做）出球。
      const shootDecisionP =
        clamp(0.07 + shootQuality * 0.18 + rangeBonus, 0.03, 0.56) *
        (cdBlocked ? 0.3 : 1);
      const clearCloseChance = dGoal < 13 && angF > 0.16 && pressure < 0.9;
      if (
        canShoot &&
        (clearCloseChance ||
          (shootQuality > shootThresh &&
            shootQuality >= passQuality * (core ? 0.7 : isWing ? 0.78 : 0.85))) &&
        Math.random() < shootDecisionP
      ) {
        a.shotCdUntil = this.t + (core ? 0.9 : isWing ? 1.1 : isMid ? 1.6 : 1.2);
        this._shoot(a);
        return;
      }
      if (passTo && passQuality > (core ? 0.42 : isWing ? 0.34 : 0.3)) {
        this._pass(a, passTo);
        return;
      }
      // 泄压阀：射门被全队冷却封锁 + 被贴身逼抢时，继续往人堆里盘带只会
      // 在禁区边缘形成僵持平衡（残余僵持的根因）。真实球员会起球传中或回做。
      if (this.t < (this._teamShotUntil[a.team] || 0) && pressure > 0.55) {
        const cross = this._bestCross(a);
        if (cross && Math.random() < 0.5) {
          this._pass(a, cross);
          return;
        }
        if (passTo && Math.random() < 0.6) {
          this._pass(a, passTo);
          return;
        }
      }
      // 核心 / 边锋：内切带进去
      const tuckIn = isWing ? 0.55 + cutInProgress * 0.1 : core ? 0.55 : 0.4;
      a.intent = {
        type: "dribble",
        tx: clamp(a.x + (goalX - a.x) * tuckIn, 4, 96),
        ty: clamp(a.y + dir * (core || isWing ? 8 : 6), 3, 97),
      };
      a.fsm = "carry";
      return;
    }

    // ——————————— 边锋高位：优先内切，其次传中/横传 —— 
    if (isWing && dGoal < 48 && Math.abs(a.x - goalX) > 14) {
      // 贴边时：先内切再射/传，而不是贴边死磕
      const burst = 0.55 * a.attr.dribbling + 0.45 * a.attr.pace;
      if (pressure < 0.72 && burst > 0.35 && this.t >= (a.cutInCdUntil || 0)) {
        // 偶尔立刻起脚横传/传中；多数情况内切
        const wantCrossNow = pressure > 0.55 && Math.random() < 0.28;
        if (wantCrossNow) {
          const cross = this._bestCross(a);
          if (cross) {
            this._pass(a, cross);
            return;
          }
        }
        a.cutInCdUntil = this.t + 0.55;
        const side = this._wingSide(a);
        // 内切：向中路 + 向前，落点在禁区弧顶/肋部
        a.intent = {
          type: "dribble",
          tx: clamp(a.x - side * (10 + burst * 8) + (goalX - a.x) * 0.25, 18, 82),
          ty: clamp(a.y + dir * (10 + burst * 6), 5, 95),
        };
        a.fsm = "carry";
        return;
      }
    }

    // ——————————— 边后卫高位：优先传中/回做 —— 
    if (isFb && dGoal < 42 && (a.baseX < 30 || a.baseX > 70)) {
      const cross = this._bestCross(a);
      if (cross && this.t >= (a.crossCdUntil || 0) && Math.random() < 0.55 + a.attr.passing * 0.25) {
        a.crossCdUntil = this.t + 2.5;
        this._pass(a, cross);
        return;
      }
    }

    // ——————————— 组织区：传/带/护 + 远射 —— 
    const cands = this._passCandidates(a);
    const shortPass = cands.find((c) => !c.through) || null;
    const throughPass = cands.find((c) => c.through) || null;
    const aheadSpace = this._forwardSpace(a, dir);

    const options = [];

    if (shortPass) {
      let w = (0.42 + shortPass.value) * (0.8 + 0.2 * a.attr.vision) * (1 + pressure * 0.25);
      // 非核心：更愿意把球给核心
      if (!core && shortPass.agent?.isCore) w *= 1.55;
      if (core) w *= 0.85; // 核心略少无脑回传
      // 边锋：更爱找中路/前锋
      if (isWing && shortPass.agent && (shortPass.agent.role === "ATT" || shortPass.agent.role === "MID")) {
        w *= 1.12;
      }
      options.push({ key: { act: "pass", target: shortPass }, w });
    }
    if (throughPass) {
      const flair = 0.5 * a.attr.vision + 0.5 * a.attr.passing;
      let w =
        (0.08 + throughPass.value) *
        (0.35 + 1.1 * flair) *
        (1 - pressure * 0.4) *
        0.28;
      if (!core && throughPass.agent?.isCore) w *= 1.4;
      if (isWing) w *= 1.1;
      options.push({ key: { act: "pass", target: throughPass }, w });
    }
    // 边后卫高位：把传中也放进候选
    if (isFb) {
      const cross = this._bestCross(a);
      if (cross) {
        options.push({
          key: { act: "pass", target: cross },
          w: (0.2 + cross.value) * (0.5 + 0.5 * a.attr.passing) * (dGoal < 45 ? 1.2 : 0.7),
        });
      }
    }
    // 边锋：传中作次选（内切优先，但被逼时仍可起球）
    if (isWing) {
      const cross = this._bestCross(a);
      if (cross) {
        options.push({
          key: { act: "pass", target: cross },
          w: (0.12 + cross.value * 0.85) * (0.4 + 0.5 * a.attr.passing) * (pressure > 0.45 ? 1.15 : 0.75),
        });
      }
    }
    if (aheadSpace > 0.2 || (isWing && Math.abs(a.x - goalX) > 12)) {
      const burst = 0.6 * a.attr.dribbling + 0.4 * a.attr.pace;
      let midBoost = isMid ? 1.15 : 1;
      if (core) midBoost *= 1.45; // 核心盘带权重暴涨
      if (isFb) midBoost *= 0.9;
      if (isWing) midBoost *= 1.35; // 边锋爱带球内切
      // 边锋：即使 aheadSpace 一般也鼓励内切盘带
      const spaceW = isWing ? Math.max(aheadSpace, 0.35 + cutInProgress * 0.2) : aheadSpace;
      options.push({
        key: { act: "dribble" },
        w: (0.12 + 0.9 * burst) * spaceW * (1 - pressure * 0.55) * midBoost,
      });
    }
    const LONG_MIN = core ? 20 : isWing ? 18 : 24;
    const LONG_MAX = core ? 40 : isWing ? 34 : 36;
    const canLong =
      (isMid || isAtt || core || isWing || (isFb && dGoal < 38)) &&
      dGoal >= LONG_MIN &&
      dGoal < LONG_MAX &&
      angF > (core ? 0.2 : isWing ? 0.18 : 0.28) &&
      pressure < (core ? 0.85 : 0.72) &&
      this.t >= (a.shotCdUntil || 0) &&
      this.t >= (this._teamShotUntil[a.team] || 0) &&
      attackAge >= 5;
    if (canLong) {
      let longW =
        (0.06 + 0.5 * a.attr.shooting + 0.18 * a.attr.finishing + 0.12 * a.attr.pace) *
        angF *
        (0.55 + 0.45 * (1 - pressure)) *
        (0.45 + 0.55 * Math.min(1, aheadSpace + 0.35));
      if (isMid) longW *= 1.35;
      if (isWing) longW *= 1.25 + cutInProgress * 0.35; // 内切后远射
      if (core) longW *= 1.5;
      longW *= 0.22; // 远射是偶发选择，不能与常规传球同量级竞争
      options.push({ key: { act: "longshot" }, w: longW });
    }
    options.push({ key: { act: "hold" }, w: 0.12 + pressure * 0.2 + (core ? 0.05 : 0) });

    // 核心决策更果断（温度更低 → 更偏高分动作，但盘带/射门分已抬高）
    const choice = weightedPick(options, core ? 0.28 : isWing ? 0.3 : 0.35) || { act: "hold" };
    if (choice.act === "pass") {
      this._pass(a, choice.target);
    } else if (choice.act === "longshot") {
      a.shotCdUntil = this.t + (core ? 1.5 : isWing ? 1.6 : 2.2);
      this._shoot(a);
    } else if (choice.act === "dribble") {
      if (isWing) {
        // 边锋盘带默认内切：向中 + 向前，而不是沿边线直冲
        const side = this._wingSide(a);
        const push = 12 + a.attr.pace * 5;
        const inward = 9 + a.attr.dribbling * 7;
        a.intent = {
          type: "dribble",
          tx: clamp(a.x - side * inward + (goalX - a.x) * 0.22, 16, 84),
          ty: clamp(a.y + dir * push, 4, 96),
        };
      } else {
        const push = core ? 16 : isMid ? 15 : isFb ? 14 : 12;
        const tuck = core ? 0.35 : isMid ? 0.28 : 0.22;
        a.intent = {
          type: "dribble",
          tx: clamp(a.x + (goalX - a.x) * tuck, 4, 96),
          ty: clamp(a.y + dir * push, 3, 97),
        };
      }
      a.fsm = "carry";
    } else {
      a.intent = { type: "hold", tx: a.x, ty: clamp(a.y - dir * 3, 3, 97) };
      a.fsm = "carry";
    }
  }

  /**
   * 边后卫传中：找进攻方向上靠门的队友（前锋优先），落点到禁区肋部/前点
   */
  _bestCross(a) {
    const dir = this.attackDir(a.team);
    const goalY = this.targetGoalY(a.team);
    let best = null;
    for (const m of this.agents) {
      if (m === a || m.team !== a.team || m.role === "GK") continue;
      // 必须比持球者更靠前，且靠近门前
      const ahead = (m.y - a.y) * dir;
      if (ahead < 4) continue;
      const dGoalM = dist(m.x, m.y, 50, goalY);
      if (dGoalM > 32) continue;
      const d = dist(a.x, a.y, m.x, m.y);
      if (d < 10 || d > 48) continue;
      // 对侧更好（拉开传中）
      const opposite = Math.abs(m.x - a.x) > 12 ? 1.25 : 0.85;
      const roleB = m.role === "ATT" ? 1.35 : m.role === "MID" ? 1.05 : 0.7;
      const coreB = m.isCore ? 1.4 : 1;
      const value =
        (0.4 + clamp(1 - dGoalM / 32, 0, 1)) *
        this._laneSafety(a, m) *
        opposite *
        roleB *
        coreB;
      // 落点：禁区内前点/中点，不是脚下
      const tx = clamp(m.x * 0.55 + 50 * 0.45 + (Math.random() - 0.5) * 6, 28, 72);
      const ty = clamp(goalY - dir * (8 + Math.random() * 6), 4, 96);
      if (!best || value > best.value) {
        best = { agent: m, value, through: true, tx, ty, cross: true };
      }
    }
    return best;
  }

  /**
   * 生成一个"朝前带球调整"的意图（接球/抢断后 settle 期使用）。
   * 朝对方球门方向小步推进，横向略微收向球门中路，不做传射。
   */
  _forwardDribbleIntent(a) {
    const dir = this.attackDir(a.team);
    return {
      type: "dribble",
      tx: clamp(a.x + (50 - a.x) * 0.15, 4, 96),
      ty: clamp(a.y + dir * 8, 3, 97),
    };
  }

  /** 逼抢压力：最近对手距离 → 0..1（越近越大） */
  _pressureOn(a) {
    let nearest = 99;
    for (const o of this.agents) {
      if (o.team === a.team || o.role === "GK") continue;
      const d = dist(a.x, a.y, o.x, o.y);
      if (d < nearest) nearest = d;
    }
    return clamp(1 - nearest / 12, 0, 1);
  }

  /** 前方（进攻方向）可用空间：0..1 */
  _forwardSpace(a, dir) {
    // 看前方一个扇形里最近对手多远
    let nearest = 30;
    for (const o of this.agents) {
      if (o.team === a.team || o.role === "GK") continue;
      const ahead = (o.y - a.y) * dir; // >0 表示在前方
      if (ahead <= 0 || ahead > 30) continue;
      if (Math.abs(o.x - a.x) > 14) continue;
      const d = dist(a.x, a.y, o.x, o.y);
      if (d < nearest) nearest = d;
    }
    return clamp(nearest / 30, 0, 1);
  }

  /**
   * 评估最佳传球对象：对每个队友算 value（推进收益 × 安全度）。
   * @returns {{agent, value, tx, ty}|null}
   */
  _bestPass(a) {
    const cands = this._passCandidates(a);
    return cands.length ? cands[0] : null;
  }

  /**
   * 评估所有可行传球，返回按 value 降序的候选列表（供风格加权采样用）。
   * 每个候选标注：
   *   · value  —— 客观质量（推进 × 安全 × 距离）
   *   · through—— 是否"直塞"（穿透最后一道防线、送身后空当），价值高但难度大
   *   · tx/ty  —— 落点（直塞会打到接球人身前的空当，而非脚下）
   */
  _passCandidates(a) {
    const dir = this.attackDir(a.team);
    const goalY = this.targetGoalY(a.team);
    const offY = this._offsideLineY(a.team);
    const holderPressure = this._pressureOn(a);
    const out = [];
    for (const m of this.agents) {
      if (m === a || m.team !== a.team || m.role === "GK" || m.sentOff) continue;
      const d = dist(a.x, a.y, m.x, m.y);
      if (d < 6 || d > 45) continue; // 太近没必要，太远不可靠
      // 普通传球也瞄准预计接球点，而不是队友当前脚下。接球队员稍后会共享同一目标。
      const nominalSpeed = clamp(18 + d * 0.7, 18, 42) * (0.85 + 0.15 * a.attr.passing);
      const eta = clamp(d / Math.max(1, nominalSpeed), 0.2, 1.35);
      let tx = clamp(m.x + (m.vx || 0) * eta, 3, 97);
      let ty = clamp(m.y + (m.vy || 0) * eta, 3, 97);
      const myProg = Math.abs(a.y - goalY);
      const mProg = Math.abs(m.y - goalY);
      const advance = clamp((myProg - mProg) / 40, -0.5, 1);
      const safety = this._laneSafety(a, m, tx, ty);
      const distPen = clamp(1 - d / 55, 0.2, 1);
      // 核心球员：队友更愿意把球给他（进攻绝对权）
      const coreBoost = m.isCore ? 1.65 : 1;
      let value = (0.35 + advance) * safety * distPen * coreBoost;

      // 刚接到 A 的球后，不应立即把 A 再评为唯一最佳选择。受压时仍允许安全回做，
      // 无压时强烈鼓励寻找第三人或转移到另一侧。
      const directReturn =
        this.ball.lastPasserId === m.id &&
        this.ball.lastPassTeam === a.team &&
        this.t - (this.ball.lastPassAt || 0) < 8.5;
      if (directReturn) value *= 0.02 + holderPressure * 0.05;
      else if (Math.abs(m.x - a.x) > 18) value *= 1.08;

      // AI 尽量避免把球直接传给出脚瞬间已经越位的队友；绝境下仍可能犯错，
      // 随后由裁判快照系统判罚，而不是在候选阶段彻底消灭越位事件。
      if (this._isOffsidePosition(a.team, m, offY, this.ball.y)) {
        value *= 0.16 + (1 - a.attr.vision) * 0.34;
      }

      // —— 直塞识别：接球人处在越位线附近、且其身前（更靠对方球门）有空当 ——
      // 直塞落点打到接球人身前一段，让其反越位插上；风险高（易越位/被断）但收益大。
      let through = false;
      const aheadOfBall = (m.y - a.y) * dir > 4; // 接球人比持球者更靠前
      const lineGap = offY == null ? Infinity : Math.abs(m.y - offY);
      const receiverGoalDist = Math.abs(m.y - goalY);
      if (
        aheadOfBall &&
        advance > 0.35 &&
        lineGap < 11 &&
        receiverGoalDist < 44 &&
        safety > 0.28 &&
        Math.random() < 0.025 + a.attr.vision * 0.055 &&
        this.t >= (this._teamThroughUntil[a.team] || 0)
      ) {
        const leadY = clamp(ty + dir * (6 + Math.random() * 4), 3, 97);
        // 落点未越过越位线太多才算可行直塞
        const okOffside =
          offY == null ||
          (a.team === "home" ? leadY >= offY - 2 : leadY <= offY + 2);
        if (okOffside) {
          through = true;
          value *= 0.72;
          ty = leadY;
          tx = clamp(tx + (50 - tx) * 0.1, 3, 97);
        }
      }
      out.push({ agent: m, value, through, tx, ty });
    }
    out.sort((p, q) => q.value - p.value);
    return out;
  }

  /** 传球线安全度：线段附近对手越近越危险 → 0..1 */
  _laneSafety(a, m, tx = m.x, ty = m.y) {
    let minPerp = 99;
    const dx = tx - a.x;
    const dy = ty - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    for (const o of this.agents) {
      if (o.team === a.team || o.role === "GK") continue;
      // 投影到传球线段
      const t = clamp(((o.x - a.x) * ux + (o.y - a.y) * uy) / len, 0, 1);
      const px = a.x + ux * len * t;
      const py = a.y + uy * len * t;
      const perp = dist(o.x, o.y, px, py);
      if (perp < minPerp) minPerp = perp;
    }
    return clamp(minPerp / 8, 0.1, 1);
  }

  /** 执行传球：给球初速飞向接球点，清 owner（长传/传中/直塞带弧线高度） */
  _pass(a, passTo) {
    const b = this.ball;
    const offsideExempt = !!b.offsideExemptRestart;
    const kickBallY = b.y;
    const offsideLineY = offsideExempt ? null : this._offsideLineY(a.team);
    const offsideIds = offsideExempt
      ? new Set()
      : new Set(
          this.agents
            .filter(
              (m) =>
                m.team === a.team &&
                m.role !== "GK" &&
                m.id !== a.id &&
                this._isOffsidePosition(a.team, m, offsideLineY, kickBallY)
            )
            .map((m) => m.id)
        );
    const tx = passTo.tx;
    const ty = passTo.ty;
    const dx = tx - b.x;
    const dy = ty - b.y;
    const d = Math.hypot(dx, dy) || 1;
    // 传球速度：距离越远越快，受 passing 影响精度（加噪声）
    const passSpeed = clamp(18 + d * 0.7, 18, 42) * (0.85 + 0.15 * a.attr.passing);
    // 精度噪声：passing 越低越偏
    const err = (1 - a.attr.passing) * 6;
    const nx = (Math.random() - 0.5) * err;
    const ny = (Math.random() - 0.5) * err;
    b.owner = null;
    b.vx = (dx / d) * passSpeed + nx;
    b.vy = (dy / d) * passSpeed + ny;
    b.receiverId = passTo.agent?.id || null;
    b.targetX = tx;
    b.targetY = ty;
    b.expectedAt = this.t + clamp(d / Math.max(1, passSpeed) * 1.12, 0.2, 1.8);
    // 空中弧线（vz 对 g=18：peak≈vz²/36；传中 ~5–7，长传 ~3，短传贴地）
    const isCross = !!passTo.cross;
    const isThrough = !!passTo.through;
    let loft = 0;
    if (isCross) loft = 14 + Math.random() * 4;
    else if (isThrough) loft = 6 + Math.random() * 3;
    else if (d > 28) loft = 9 + (d - 28) * 0.12;
    else if (d > 18) loft = 3.5 + Math.random() * 2.5;
    b.z = 0.2;
    b.vz = loft;
    b.lastKicker = a.id;
    b.kickTeam = a.team;      // 传球方队伍（对手在飞行早段不可截）
    b.kickX = b.x;            // 踢球原点，用于"飞离一段后才可被对手截"
    b.kickY = b.y;
    // 越位快照：以队友触球的这一刻为准，保存所有处于越位位置的进攻者。
    // 之后即使该球员回到线上接球，仍应被吹；角球/界外球/门球首脚依法豁免。
    b.offsideLineY = offsideLineY;
    b.offsideBallY = kickBallY;
    b.offsideIds = offsideIds;
    b.offsideDir = this.attackDir(a.team);
    b.offsidePasser = a.id; // 传球者自己接回不算越位
    b.offsideExemptRestart = false;
    b.restartType = null;
    b.isThroughPass = isThrough;
    b.isCrossPass = isCross; // 高弧线传中：z 超过头顶时不可拦截/接管（见 _resolvePossession）
    b.state = "pass";
    if (passTo.agent) {
      passTo.agent.intent = {
        type: "receive",
        tx,
        ty,
        targetId: passTo.agent.id,
      };
      passTo.agent.tx = tx;
      passTo.agent.ty = ty;
      passTo.agent.attackThinkUntil = b.expectedAt + 0.45;
      passTo.agent.fsm = "receive";
    }
    // 助攻链路：最近一次本方传球（供射门/进球挂 assistId）
    b.lastPasserId = a.id;
    b.lastPassTeam = a.team;
    b.lastPassAt = this.t;
    a.intent = null;
    a.fsm = "home";
    this._emit("pass", a, {
      loft: loft > 2,
      cross: isCross,
      through: isThrough,
      toId: passTo.agent?.id || null,
      toX: tx,
      toY: ty,
    });
    if (isThrough) this._teamThroughUntil[a.team] = this.t + 3.2;
    // 传球后短暂不可立刻被自己接回
    a.noReclaimUntil = this.t + 0.25;
  }

  /** 执行射门：给球高速飞向球门，门将可扑（远射：更吃 shooting、误差更大） */
  _shoot(a, extraMeta = null) {
    const b = this.ball;
    const goalY = this.targetGoalY(a.team);
    const dGoal = dist(a.x, a.y, 50, goalY);
    const long = dGoal > 22;
    // 球队级节奏上限：强队长期围攻时也不能每几十秒起脚一次。
    // 这是模拟时间的进攻周期，不是表现层的墙钟等待。
    this._teamShotUntil[a.team] = this.t + 340 + Math.random() * 220;
    // 近：finishing；远：shooting。远射噪声更大，容易打飞/被扑
    const skill = long
      ? 0.35 * a.attr.finishing + 0.65 * a.attr.shooting
      : 0.7 * a.attr.finishing + 0.3 * a.attr.shooting;
    // 近距：误差缩小（更好的「该进就进」），但绝不强制夹进门框
    // aimX 在 [50-err/2, 50+err/2] 均匀分布；门宽只有 12。
    // 旧 err 常小于门宽，等于“每脚必射正”，此前只是被普通接管逻辑意外掩盖。
    let err = 20 + (1 - skill) * (long ? 26 : 22) + dGoal * (long ? 0.5 : 0.35);
    // 门将明显失位时明显更准（空门该进）；仍允许极小概率打飞
    const defGk = this.agents.find(
      (g) => g.role === "GK" && g.team !== a.team
    );
    let openGoal = false;
    if (defGk && dGoal < 20) {
      const aimMidX = clamp(a.x * 0.35 + 50 * 0.65, 38, 62);
      const gkCover = Math.abs(defGk.x - aimMidX);
      const gkDepth =
        defGk.team === "home"
          ? Math.max(0, 100 - defGk.y)
          : Math.max(0, defGk.y);
      // 横向失位 or 出击过深 → 空门感
      if (gkCover > 8.5 || gkDepth > 11) {
        openGoal = true;
        err *= gkCover > 11 ? 0.42 : 0.55;
      } else if (gkCover > 6) {
        err *= 0.78;
      }
    }
    const aimX = 50 + (Math.random() - 0.5) * err;
    const dx = aimX - b.x;
    const dy = goalY - b.y;
    const d = Math.hypot(dx, dy) || 1;
    // 远射初速略高，才像抽射
    const power = clamp(
      (long ? 42 : 38) + a.attr.shooting * (long ? 16 : 14),
      long ? 40 : 38,
      long ? 58 : 55
    );
    // 助攻：8s 内队友传球 → 本脚射门
    let assistId = null;
    if (
      b.lastPasserId &&
      b.lastPasserId !== a.id &&
      b.lastPassTeam === a.team &&
      this.t - (b.lastPassAt || 0) < 8.5
    ) {
      assistId = b.lastPasserId;
    }
    b.owner = null;
    b.vx = (dx / d) * power;
    b.vy = (dy / d) * power;
    // 射门弧线：远射抽射更高，近射低平
    b.z = 0.25;
    b.vz = long ? 10 + Math.random() * 4 : 5 + Math.random() * 3;
    b.lastKicker = a.id;
    b.kickTeam = a.team;
    b.kickX = b.x;
    b.kickY = b.y;
    b.state = "shot";
    b.shotDistance = dGoal;
    b.shotSkill = skill;
    b._saveChecked = false; // 新射门允许门将掷一次扑救骰
    b._blockersChecked = new Set();
    b._shotAssistId = assistId;
    b._openGoalShot = openGoal;
    this._clearBallTarget();
    a.intent = null;
    a.fsm = "home";
    this._emit("shot", a, {
      long: !!long,
      role: a.role,
      assistId,
      openGoal,
      x: a.x,
      y: a.y,
      distance: dGoal,
      ...(extraMeta || {}),
    });
    a.noReclaimUntil = this.t + 0.4;
  }

  /** 无球进攻：前锋回撤、中场前插、边后卫套边；核心自由靠球 */
  _thinkAttackOffBall(a, owner) {
    const dir = this.attackDir(a.team);
    const b = this.ball;
    const ownGoalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
    const prog = clamp(Math.abs(b.y - ownGoalY) / 100, 0, 1);
    const dBall = dist(a.x, a.y, b.x, b.y);
    const core = !!a.isCore;
    const finalThird = prog > 0.64;

    // 最后三区限制中央前插名额：三名前锋 + 一名最适合前插的中场。
    // 其他中场在球后形成两层接应，避免六七个人同时被吸到点球点附近。
    if (finalThird && a.role === "MID" && !this._isPrimaryMidRunner(a)) {
      const mids = this.agents
        .filter((m) => m.team === a.team && m.role === "MID")
        .sort((m, n) => String(m.id).localeCompare(String(n.id)));
      const rank = Math.max(0, mids.indexOf(a));
      a.tx = clamp(a.baseX * 0.72 + b.x * 0.18 + 50 * 0.1, 12, 88);
      a.ty = clamp(b.y - dir * (15 + rank * 3.5), 12, 88);
      a.fsm = "support";
      this._clampOffside(a);
      return;
    }

    // 中卫留作防反保护，不再因为离球较近跟进到禁区弧顶围球。
    if (finalThird && a.role === "DEF" && !this._isFullback(a)) {
      a.tx = clamp(a.baseX + (b.x - 50) * 0.08, 18, 82);
      a.ty = clamp(a.baseY + dir * 7, 18, 82);
      a.fsm = "home";
      return;
    }

    // —— 核心无球：积极要球（靠近持球者接应），不全程钉在锋线 ——
    if (core && a.role !== "GK") {
      // 持球者是队友时：靠近做墙/要球
      if (owner && owner.team === a.team && owner !== a) {
        const side = a.x < owner.x ? -1 : 1;
        // 时而回撤到球后接应，时而前插要直塞
        if (prog < 0.55 || Math.random() < 0.4) {
          a.tx = clamp(owner.x + side * (6 + Math.random() * 5), 8, 92);
          a.ty = clamp(owner.y + dir * (4 + Math.random() * 6), 5, 95);
        } else {
          a.tx = clamp(owner.x + (50 - owner.x) * 0.2 + side * 4, 10, 90);
          a.ty = clamp(owner.y + dir * (12 + Math.random() * 8), 6, 94);
        }
        a.fsm = "support";
        this._clampOffside(a);
        return;
      }
    }

    const isWing = this._isWinger(a);
    const wingSide = isWing ? this._wingSide(a) : 0;

    // —— 边锋：回撤接球 + 内切通道，不全程贴边顶在最前 ——
    if (isWing) {
      // 组织阶段：回撤到球侧/半空当要球（像萨拉赫/内马尔接球再内切）
      const drop =
        prog < 0.72 &&
        (dBall < 42 ||
          core ||
          Math.random() < 0.32 + (prog < 0.48 ? 0.22 : 0) + a.attr.dribbling * 0.15);
      if (drop) {
        // 组织阶段保持左右固定通道；旧逻辑围绕球只偏 8~12，双翼会一起挤进中路。
        const wideAnchor = wingSide < 0 ? 17 : 83;
        const ballSide = clamp(b.x + wingSide * 8, 8, 92);
        const pocketX = wideAnchor * 0.65 + ballSide * 0.35;
        // 进入前场后才稍微内收，己方半场/中场仍提供真正宽度。
        const softIn = clamp(
          prog > 0.55 ? pocketX * 0.78 + 50 * 0.22 : pocketX,
          12,
          88
        );
        const dropDepth = 8 + Math.random() * 10;
        a.tx = clamp(softIn + (Math.random() - 0.5) * 4, 10, 90);
        a.ty = clamp(b.y + dir * dropDepth, 8, 92);
        a.fsm = "support";
        this._clampOffside(a);
        return;
      }
      // 已过半场：肋部内切跑位（不是死钉边线）
      if (prog > 0.48) {
        const cutX = clamp(50 + wingSide * (14 + Math.random() * 10), 18, 82);
        a.tx = clamp(cutX + (b.x - 50) * 0.08, 12, 88);
        a.ty = clamp(b.y + dir * (10 + Math.random() * 10), 5, 95);
        a.fsm = "support";
        this._clampOffside(a);
        return;
      }
      // 默认：保持半宽，略前压
      a.tx = clamp(a.baseX * 0.55 + 50 * 0.25 + (b.x - 50) * 0.12, 10, 90);
      a.ty = clamp(a.baseY + dir * (8 + prog * 6), 5, 95);
      a.fsm = "home";
      this._clampOffside(a);
      return;
    }

    // —— 前锋：组织阶段更多回撤（不只最近一人）；核心更爱回撤要球 ——
    if (a.role === "ATT") {
      const nearest = this._isNearestForwardToBall(a);
      // 回撤条件：球未深入进攻三区；最近前锋必回撤，其他前锋也有概率回撤接应
      const drop =
        prog < 0.68 &&
        (nearest ||
          core ||
          Math.random() < 0.22 + (prog < 0.45 ? 0.18 : 0));
      if (drop) {
        const side = a.baseX < 48 ? -1 : a.baseX > 52 ? 1 : a.x < b.x ? -1 : 1;
        // 回撤深度：到球与中场之间，而不是一直顶在越位线
        const dropDepth = nearest || core ? 10 + Math.random() * 8 : 14 + Math.random() * 6;
        a.tx = clamp(b.x + side * (6 + Math.random() * 8), 8, 92);
        a.ty = clamp(b.y + dir * dropDepth, 8, 92);
        a.fsm = "support";
        return;
      }
      // 前插纵深
      a.tx = clamp(a.baseX + (b.x - 50) * 0.12, 6, 94);
      a.ty = clamp(a.baseY + dir * (core ? 12 : 16), 3, 97);
      a.fsm = "home";
      this._clampOffside(a);
      return;
    }

    // —— 中场：接应 + 前插 ——
    if (a.role === "MID") {
      const advanced = a.team === "home" ? a.baseY < 52 : a.baseY > 48;
      const burst = 0.55 * a.attr.pace + 0.45 * a.attr.dribbling;
      const wantRun =
        prog > 0.42 &&
        (advanced || burst > 0.48 || core) &&
        (dBall > 16 || Math.random() < 0.28 + burst * 0.35);

      if (wantRun && dBall > 12) {
        const side =
          a.baseX < 42
            ? -1
            : a.baseX > 58
              ? 1
              : (a.num || 0) % 2
                ? -0.45
                : 0.45;
        const depth = 11 + burst * 10 + (advanced ? 4 : 0) + (core ? 3 : 0);
        a.tx = clamp(
          b.x + side * (12 + Math.random() * 6) + (a.baseX - 50) * 0.12,
          8,
          92
        );
        a.ty = clamp(b.y + dir * depth, 6, 94);
        a.fsm = "support";
        this._clampOffside(a);
        return;
      }

      if (dBall < 28) {
        const side =
          a.baseX < 42
            ? -1
            : a.baseX > 58
              ? 1
              : (a.num || 0) % 2
                ? -0.5
                : 0.5;
        a.tx = clamp(b.x + side * (11 + Math.random() * 6), 5, 95);
        a.ty = clamp(b.y + dir * (7 + Math.random() * 5), 3, 97);
        a.fsm = "support";
      } else {
        a.tx = clamp(a.baseX + (b.x - 50) * 0.18, 5, 95);
        a.ty = clamp(a.baseY + dir * (10 + prog * 6), 3, 97);
        a.fsm = "home";
      }
      this._clampOffside(a);
      return;
    }

    // —— 边后卫：进攻时套边前插 / 提供传中 ——
    if (this._isFullback(a)) {
      const wide = a.baseX < 50 ? -1 : 1;
      // 本队控球且球已过半场：有概率沿边路前插
      const bombOn =
        prog > 0.38 &&
        (prog > 0.55 || Math.random() < 0.32 + a.attr.pace * 0.25) &&
        dBall < 55;
      if (bombOn) {
        // 套边：贴边线 + 推到球的平行甚至更前，准备传中
        a.tx = clamp(wide < 0 ? 8 + Math.random() * 6 : 86 + Math.random() * 6, 4, 96);
        a.ty = clamp(b.y + dir * (8 + Math.random() * 12 + prog * 8), 8, 92);
        a.fsm = "support";
        this._clampOffside(a);
        return;
      }
      // 未前插：保持宽度、略前压
      a.tx = clamp(a.baseX + wide * 2 + (b.x - 50) * 0.08, 4, 96);
      a.ty = clamp(a.baseY + dir * (4 + prog * 5), 6, 94);
      a.fsm = "home";
      this._clampOffside(a);
      return;
    }

    // —— 中卫：近球少接应，否则回位略前压 ——
    if (dBall < 22) {
      const side = a.x < b.x ? -1 : 1;
      a.tx = clamp(b.x + side * (10 + Math.random() * 4), 5, 95);
      a.ty = clamp(b.y + dir * 3, 3, 97);
      a.fsm = "support";
    } else {
      a.tx = clamp(a.baseX + (b.x - 50) * 0.12, 5, 95);
      a.ty = clamp(a.baseY + dir * 3, 3, 97);
      a.fsm = "home";
    }
    this._clampOffside(a);
  }

  /**
   * 出脚瞬间是否处于越位位置：必须同时满足在对方半场、比球更靠近球门、
   * 且越过倒数第二名防守者。这里只判“位置”，是否参与进攻在接球时处理。
   */
  _isOffsidePosition(team, player, lineY = this._offsideLineY(team), ballY = this.ball.y) {
    if (!player || lineY == null || !Number.isFinite(ballY)) return false;
    const tol = 0.45;
    if (team === "home") {
      return player.y < 50 && player.y < ballY - tol && player.y < lineY - tol;
    }
    return player.y > 50 && player.y > ballY + tol && player.y > lineY + tol;
  }

  /** 越位球员开始参与进攻：记录事件并交给防守方在犯规位置重开。 */
  _callOffside(player) {
    const b = this.ball;
    const attackingTeam = b.kickTeam || player?.team;
    if (!player || (attackingTeam !== "home" && attackingTeam !== "away")) return;
    this._emit("offside", player, {
      team: attackingTeam,
      kickLineY: b.offsideLineY,
      kickBallY: b.offsideBallY,
    });
    const defTeam = attackingTeam === "home" ? "away" : "home";
    this._restart("offside", defTeam, clamp(player.x, 6, 94), clamp(player.y, 6, 94));
  }

  /** 越位自律：前锋与最后防线留出小缓冲，不再所有人自动贴死同一条线。 */
  _clampOffside(a) {
    const offY = this._offsideLineY(a.team);
    if (offY == null) return;
    const roleBuffer =
      a.role === "ATT"
        ? 0.8 + ((a.num || 0) % 3) * 0.35
        : a.role === "MID"
          ? 2.1 + ((a.num || 0) % 2) * 0.45
          : 3.2;
    const awareness = 0.7 * (a.attr.positioning || 0.5) + 0.3 * (a.attr.vision || 0.5);
    const mistimeChance =
      a.role === "ATT"
        ? 0.04 + (1 - awareness) * 0.08
        : a.role === "MID"
          ? 0.012 + (1 - awareness) * 0.025
          : 0;
    // 少量真实的启动失误：同一次跑位计算会调用两次 clamp，因此短暂缓存本次判断，
    // 避免第二次调用把第一次的越线目标立刻纠正掉。
    let effectiveBuffer;
    if (this.t < (a.offsideBufferUntil || 0) && Number.isFinite(a.offsideRunBuffer)) {
      effectiveBuffer = a.offsideRunBuffer;
    } else {
      effectiveBuffer =
        Math.random() < mistimeChance ? -(0.45 + (1 - awareness) * 0.9) : roleBuffer;
      a.offsideRunBuffer = effectiveBuffer;
      a.offsideBufferUntil = this.t + 0.2;
    }
    // 越位基准应取“球和倒数第二名防守者中更靠近球门者”。
    if (a.team === "home") {
      const legalY = Math.min(offY, this.ball.y);
      if (a.ty < legalY + effectiveBuffer) a.ty = legalY + effectiveBuffer;
    } else {
      const legalY = Math.max(offY, this.ball.y);
      if (a.ty > legalY - effectiveBuffer) a.ty = legalY - effectiveBuffer;
    }
  }

  /** 本队离球最近的前锋？（用于指派“回撤支点”的那一个） */
  _isNearestForwardToBall(a) {
    if (a.role !== "ATT") return false;
    const dMe = dist(a.x, a.y, this.ball.x, this.ball.y);
    for (const o of this.agents) {
      if (o === a || o.team !== a.team || o.role !== "ATT") continue;
      if (o.sentOff) continue;
      if (dist(o.x, o.y, this.ball.x, this.ball.y) < dMe) return false;
    }
    return true;
  }

  /** 本队唯一的中场前插名额：核心优先，否则按带球/速度/终结综合选择。 */
  _isPrimaryMidRunner(a) {
    if (a.role !== "MID") return false;
    const mids = this.agents
      .filter((m) => m.team === a.team && m.role === "MID")
      .sort((m, n) => {
        const sm =
          (m.isCore ? 1.2 : 0) +
          0.4 * m.attr.dribbling +
          0.25 * m.attr.pace +
          0.2 * m.attr.finishing +
          0.15 * m.attr.vision;
        const sn =
          (n.isCore ? 1.2 : 0) +
          0.4 * n.attr.dribbling +
          0.25 * n.attr.pace +
          0.2 * n.attr.finishing +
          0.15 * n.attr.vision;
        return sn - sm || String(m.id).localeCompare(String(n.id));
      });
    return mids[0]?.id === a.id;
  }

  /** 每 0.65~1s 为整队刷新一次防守任务；窗口内保持上抢/补位职责。 */
  _refreshDefPlan(team, owner) {
    const plan = this._defPlans[team];
    if (!plan || (this.t < plan.until && plan.jobs.size)) return plan;
    const pressing = this._tacticLevel(team, "pressing");

    const candidates = this.agents.filter(
      (a) => a.team === team && a.role !== "GK" && !a.sentOff
    );
    const ordered = candidates.slice().sort((a, b) => {
      const da = dist(a.x, a.y, this.ball.x, this.ball.y);
      const db = dist(b.x, b.y, this.ball.x, this.ball.y);
      return da - db || String(a.id).localeCompare(String(b.id));
    });
    const oldPressId = [...plan.jobs.entries()].find(([, job]) => job.type === "press")?.[0];
    const nearest = ordered[0] || null;
    const oldPress = oldPressId ? candidates.find((a) => a.id === oldPressId) : null;
    // 迟滞：旧上抢者没有明显落后就继续，避免两个人每 tick 互换职责。
    // 但必须自己也够得着球（<5.5）：否则贴身队友全是 screen/shape 无权下脚，
    // 而挂名 presser 永远追不上 → 持球僵持。
    const presser =
      oldPress &&
      nearest &&
      dist(oldPress.x, oldPress.y, this.ball.x, this.ball.y) <= 5.5 &&
      dist(oldPress.x, oldPress.y, this.ball.x, this.ball.y) <=
        dist(nearest.x, nearest.y, this.ball.x, this.ball.y) + 3.5
        ? oldPress
        : nearest;

    const jobs = new Map(candidates.map((a) => [a.id, { type: "shape" }]));
    if (presser) jobs.set(presser.id, { type: "press" });

    const rest = ordered.filter((a) => a !== presser);
    const danger = owner ? this._mostDangerousReceiver(owner.team) : null;
    if (rest[0]) jobs.set(rest[0].id, { type: "screen", markId: danger?.id || null });
    let interceptN = 0;
    const maxInterceptors = pressing >= 5 ? 3 : pressing >= 3 ? 2 : 1;
    const interceptRange = 16 + pressing * 2;
    for (const a of rest.slice(1)) {
      if (interceptN >= maxInterceptors) break;
      if (a.role === "DEF") continue;
      if (dist(a.x, a.y, this.ball.x, this.ball.y) > interceptRange) continue;
      jobs.set(a.id, { type: "intercept" });
      interceptN++;
    }

    plan.jobs = jobs;
    plan.until =
      this.t + clamp(0.88 - (pressing - 3) * 0.08, 0.58, 1.08) + Math.random() * 0.28;
    return plan;
  }

  /**
   * 防守方执行球队统一任务：press / screen / intercept / shape。
   * 任务短时锁定，目标点仍连续跟随球和被盯球员。
   */
  _thinkDefend(a, owner) {
    const b = this.ball;
    const ownGoalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
    const plan = this._refreshDefPlan(a.team, owner);
    const job = plan?.jobs.get(a.id) || { type: "shape" };

    if (job.type === "press") {
      // 上抢者：站到"球→己方球门"连线上、略靠球一侧，逼停并封堵推进。
      // 越靠近己方球门（禁区内），站位越贴身——真正逼停持球人、压缩其射门空间，
      // 让前锋无法轻松捅到门前近距离（这是把射门距离推回真实区间的关键）。
      const gx = 50, gy = ownGoalY;
      const bx = b.x, by = b.y;
      const vx = gx - bx, vy = gy - by;
      const len = Math.hypot(vx, vy) || 1;
      // 球离己方球门越近，standoff 越小（禁区内贴到 0.8，中场保持 2.4）
      const dBallGoal = dist(bx, by, gx, gy);
      const pressing = this._tacticLevel(a.team, "pressing");
      const standoff =
        clamp(0.8 + dBallGoal / 30 * 1.6, 0.8, 2.4) *
        clamp(1 - (pressing - 3) * 0.07, 0.78, 1.18);
      a.tx = clamp(bx + (vx / len) * standoff, 3, 97);
      a.ty = clamp(by + (vy / len) * standoff, 3, 97);
      a.fsm = "press";
      return;
    }

    if (job.type === "screen") {
      // 次近者：盯防最危险的接球点（对方离我方球门最近的无球人），站其内侧
      const mark =
        (job.markId ? this.agentById(job.markId) : null) ||
        (owner ? this._mostDangerousReceiver(owner.team) : null);
      if (mark) {
        // 站在 mark 与球门之间，切断直塞
        const mx = mark.x + (50 - mark.x) * 0.15;
        const my = mark.y + (ownGoalY - mark.y) * 0.22;
        a.tx = clamp(mx, 3, 97);
        a.ty = clamp(my, 3, 97);
        a.fsm = "cover";
        return;
      }
    }

    // 中场拦截：不再干站着，主动封堵推进/拦截传球线。
    // 这是把"三区进入波次"从 ~650 压到真实 ~50 的核心——大部分进攻在中场
    // 就被断掉、逼回，而不是轻松穿过。只有离球较近的中前场人参与，避免防线散架。
    if (job.type === "intercept") {
      const dBall = dist(a.x, a.y, b.x, b.y);
      // 只有在中前场、且离球不太远时才主动上抢拦截（后场交给防线站位）
      const midField = a.role !== "DEF";
      if (midField && dBall < 22) {
        // 扑向"持球人身前"的拦截点：切断其向前推进/传球的线路
        const dir = this.attackDir(owner?.team || b.kickTeam); // 进攻方推进方向
        a.tx = clamp(b.x, 3, 97);
        a.ty = clamp(b.y + dir * 3, 3, 97); // 站到持球人身前一点
        a.fsm = "press";
        return;
      }
    }

    // 其余：回到防线 Y；横向随球压缩，且球逼近己方球门时向中路收缩。
    // 只锚 baseX 会让边后卫在禁区外沿两侧拉成横排、中路空虚——
    // 真实防守是"球进危险区，全队向球门前中路收拢成人墙"。
    const lineY = this._defLineY(a);
    const dBallGoal = Math.abs(b.y - ownGoalY);
    // 收缩强度：球离己方球门越近，越向中路(x=50)与球的 x 收拢（0.3→0.75）
    const central = clamp(1 - dBallGoal / 45, 0, 1); // 0=远 1=贴门
    const toward = 0.28 + central * 0.34;
    // 横向目标：baseX 与「球门中路和球位的混合」按 toward 插值
    const anchorX = (50 * 0.55 + b.x * 0.45);
    a.tx = clamp(a.baseX + (anchorX - a.baseX) * toward, 4, 96);
    a.ty = clamp(lineY, 3, 97);
    a.fsm = "cover";
  }

  /** 本队按"离球距离"给该 agent 的排名（0=最近外场人），用于分派上抢/补位 */
  _defBallRank(a) {
    if (a.role === "GK") return 99;
    const dMe = dist(a.x, a.y, this.ball.x, this.ball.y);
    let rank = 0;
    for (const o of this.agents) {
      if (o === a || o.team !== a.team || o.role === "GK") continue;
      const d = dist(o.x, o.y, this.ball.x, this.ball.y);
      if (d < dMe || (d === dMe && o.id < a.id)) rank++;
    }
    return rank;
  }

  /** 对方阵中"最危险的接球点"：离我方球门最近的无球外场进攻者 */
  _mostDangerousReceiver(attTeam) {
    const ownGoalY = attTeam === "home" ? SIM.AWAY_GOAL_Y : SIM.HOME_GOAL_Y;
    let best = null;
    let bestD = Infinity;
    for (const o of this.agents) {
      if (o.team !== attTeam || o.role === "GK") continue;
      if (this.ball.owner === o.id) continue; // 跳过持球人
      const d = Math.abs(o.y - ownGoalY);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  /**
   * 松球（无人控球）：本队离球最近者冲抢，其余按阵型站位轻微跟球。
   * 修复"全体退防→无人碰球→死局"的结构性 bug。
   */
  _thinkLoose(a) {
    const b = this.ball;
    if (this._isClosestToBall(a)) {
      // 预测球的落点（简单外推），朝落点冲。
      // clamp 必须比拾球半径更贴边（1..99）：球停在底线死角（y>97+2.6）时
      // 3..97 的旧 clamp 会让追球者永远停在拾球半径之外 → 无主球僵持。
      const lead = 0.4;
      a.tx = clamp(b.x + b.vx * lead, 1, 99);
      a.ty = clamp(b.y + b.vy * lead, 1, 99);
      a.fsm = "press";
      return;
    }
    // 其余：阵型基准位为主，轻微朝球浮动
    const d = dist(a.x, a.y, b.x, b.y);
    const pull = clamp(1 - d / 40, 0, 1) * 0.2;
    a.tx = clamp(a.baseX + (b.x - a.baseX) * pull, 3, 97);
    a.ty = clamp(a.baseY + (b.y - a.baseY) * pull, 3, 97);
    a.fsm = "home";
  }

  /** 本队离球最近的外场球员？（防守上抢用） */
  _isClosestToBall(a) {
    if (a.role === "GK") return false;
    const dMe = dist(a.x, a.y, this.ball.x, this.ball.y);
    for (const o of this.agents) {
      if (o === a || o.team !== a.team || o.role === "GK") continue;
      if (dist(o.x, o.y, this.ball.x, this.ball.y) < dMe) return false;
    }
    return true;
  }

  /** 防守时该球员的防线 Y（随球深度回撤，按角色分层） */
  _defLineY(a) {
    const b = this.ball;
    const ownGoalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
    const sign = a.team === "home" ? -1 : 1; // 朝场内为正推进方向的反向
    // 距己方球门的层次：DEF 最靠后，ATT 最靠前
    const lineLevel = this._tacticLevel(a.team, "defensiveLine");
    const linePush = (lineLevel - 3) * (a.role === "DEF" ? 3.8 : a.role === "MID" ? 2.8 : 1.8);
    const layer = (a.role === "DEF" ? 20 : a.role === "MID" ? 38 : 55) + linePush;
    // 球到己方球门的距离（0=贴门，越大越远）
    const dBallGoal = a.team === "home"
      ? clamp(SIM.HOME_GOAL_Y - b.y, 0, 100)
      : clamp(b.y - SIM.AWAY_GOAL_Y, 0, 100);
    // 威胁度：球越逼近己方球门越接近 1（非线性——进入约 35 范围才急剧上升）
    const threat = clamp(1 - dBallGoal / 35, 0, 1);
    const threatSq = threat * threat; // 平方：远处几乎不收，近门时猛收
    // 危险时整条线大幅回收：DEF 压到贴禁区(~11)，MID 压回禁区弧顶(~22)，ATT 也回撤协防
    const collapsed = a.role === "DEF" ? 11 : a.role === "MID" ? 22 : 34;
    // 在“常规层 layer”与“回收位 collapsed”之间按威胁度插值
    const depth = layer + (collapsed - layer) * threatSq;
    return ownGoalY + sign * depth;
  }

  /** 越位线 Y（倒数第二名防守者），无则 null */
  _offsideLineY(attTeam) {
    const defTeam = attTeam === "home" ? "away" : "home";
    const defs = this.agents
      .filter((o) => o.team === defTeam)
      .map((o) => o.y);
    if (defs.length < 2) return null;
    // 防守方球门在 attTeam 进攻方向：主队进攻朝 y 小 → 客队防守，取第二小的 y
    if (attTeam === "home") {
      defs.sort((p, q) => p - q); // 升序，取第 2 小
      return defs[1];
    } else {
      defs.sort((p, q) => q - p); // 降序，取第 2 大
      return defs[1];
    }
  }

  /** 记录涌现事件（P5 由适配层翻译成现有 event 结构） */
  _emit(type, a, extra = {}) {
    this.events.push({ t: this.t, type, team: a?.team, agentId: a?.id, ...extra });
  }

  /**
   * 出球员近距离互推，禁区更强。门将几乎不动。
   * 根治「小禁区 3–4 个圆点糊成半透明一团」。
   */
  _separateAgents() {
    const n = this.agents.length;
    const minD = 2.85;
    for (let i = 0; i < n; i++) {
      const a = this.agents[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.agents[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        // 完全同坐标不能直接跳过，否则两个圆点会永久粘在一起。
        if (d < 1e-6) {
          const sign = (i + j) % 2 ? 1 : -1;
          dx = sign * 0.001;
          dy = ((i * 3 + j) % 2 ? 1 : -1) * 0.001;
          d = Math.hypot(dx, dy);
        }
        const inBox =
          (a.y < 20 || a.y > 80) &&
          (b.y < 20 || b.y > 80) &&
          a.x > 22 &&
          a.x < 78 &&
          b.x > 22 &&
          b.x < 78;
        const need = inBox ? 3.35 : minD;
        if (d >= need) continue;
        const push = (need - d) * 0.5;
        const ux = dx / d;
        const uy = dy / d;
        const aGk = a.role === "GK";
        const bGk = b.role === "GK";
        const aw = aGk ? 0.08 : 1;
        const bw = bGk ? 0.08 : 1;
        const den = aw + bw || 1;
        a.x = clamp(a.x - ux * push * (bw / den), 2, 98);
        a.y = clamp(a.y - uy * push * (bw / den), 2, 98);
        b.x = clamp(b.x + ux * push * (aw / den), 2, 98);
        b.y = clamp(b.y + uy * push * (aw / den), 2, 98);
      }
    }
  }

  /** 惯性移动：arrive + 加速度上限（与 matchview 表演层同源，保证观感一致） */
  _integrate(a, dt) {
    let speed = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * a.attr.pace);
    const pressing = this._tacticLevel(a.team, "pressing");
    const fit = clamp((a.fitness ?? 100) / 100, 0.3, 1);
    speed *= 0.76 + fit * 0.24;
    if (a.fsm === "press") speed *= 0.94 + pressing * 0.025;
    // 卡位减速（P2）：持球人被对手贴身时带球变慢，防守才真能"挡住"推进。
    // strength/dribbling 高者受影响小（护得住球）。
    if (this.ball.owner === a.id) {
      let pressers = 0;
      for (const o of this.agents) {
        if (o.team === a.team || o.role === "GK") continue;
        if (dist(o.x, o.y, a.x, a.y) < 4) pressers++;
      }
      if (pressers > 0) {
        const resist = 0.5 * a.attr.strength + 0.3 * a.attr.dribbling;
        const slow = clamp(0.55 - resist * 0.3, 0.25, 0.55) * Math.min(pressers, 2);
        speed *= clamp(1 - slow, 0.25, 1);
      }
    }
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) {
      a.vx *= 0.5;
      a.vy *= 0.5;
    } else {
      const slowR = 5;
      const desired = speed * Math.min(1, d / slowR);
      const dvx = (dx / d) * desired - a.vx;
      const dvy = (dy / d) * desired - a.vy;
      const accel = speed * (2.5 + 2.5 * a.attr.accel);
      const maxDv = accel * dt;
      const m = Math.hypot(dvx, dvy);
      if (m > maxDv) {
        a.vx += (dvx / m) * maxDv;
        a.vy += (dvy / m) * maxDv;
      } else {
        a.vx += dvx;
        a.vy += dvy;
      }
    }
    a.x = clamp(a.x + a.vx * dt, 1, 99);
    a.y = clamp(a.y + a.vy * dt, 1, 99);
    // 引擎内体能只影响本场运动；正式球员体能记账仍由 match.js 负责。
    const workRate = a.fsm === "press" ? 1.35 : a.fsm === "carry" ? 1.12 : 1;
    const drain =
      dt *
      (0.0014 + pressing * 0.00018) *
      workRate *
      (1.18 - (a.attr.stamina || 0.5) * 0.35);
    a.fitness = Math.max(30, (a.fitness ?? 100) - drain);
    const vmag = Math.hypot(a.vx, a.vy);
    if (vmag > 0.6) {
      const target = Math.atan2(a.vy, a.vx);
      let diff = target - a.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      a.heading += diff * Math.min(1, dt * 12);
    }
  }

  /** 球物理：被持球时跟随 owner 脚下；自由时地面滚动 + 摩擦 */
  _stepBall(dt) {
    const b = this.ball;
    if (b.owner) {
      const o = this.agentById(b.owner);
      if (o) {
        // 球黏在持球者身前一点（沿其朝向）
        b.x = clamp(o.x + Math.cos(o.heading) * 1.4, 1, 99);
        b.y = clamp(o.y + Math.sin(o.heading) * 1.4, 1, 99);
        b.vx = o.vx;
        b.vy = o.vy;
        b.z = 0;
        b.vz = 0;
        return;
      }
      b.owner = null;
    }
    // 自由球：滚动 + 摩擦（不夹 x/y，出界由 _resolveBounds 判定）
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // 高度：重力 + 落地弹跳（供直播空中球 / 落点标记）
    b.z = (b.z || 0) + (b.vz || 0) * dt;
    b.vz = (b.vz || 0) - 18 * dt; // 重力（单位与 pitch% 同量级即可）
    if (b.z > 10) {
      b.z = 10;
      if ((b.vz || 0) > 0) b.vz *= 0.4;
    }
    if (b.z <= 0) {
      b.z = 0;
      if ((b.vz || 0) < 0) {
        // 落地弹跳：再明显一点（画面落点涟漪可读）
        const impact = Math.abs(b.vz);
        b.vz = impact * (impact > 4 ? 0.38 : 0.26);
        if (b.vz < 1.05) b.vz = 0;
        else b.z = 0.05; // 微离地一帧，方便 compact 帧看出弹
        // 落地略减速
        b.vx *= 0.86;
        b.vy *= 0.86;
      }
    }
    const f = Math.pow(SIM.BALL_FRICTION, dt / SIM.DT);
    // 空中摩擦更小，贴地更黏
    const airMul = b.z > 0.4 ? 0.992 : f;
    b.vx *= airMul;
    b.vy *= airMul;
    if (Math.hypot(b.vx, b.vy) < 0.05 && b.z <= 0) {
      b.vx = 0;
      b.vy = 0;
      b.vz = 0;
      // 慢下来即回到普通自由球，可被任意接管
      if (b.state === "pass" || b.state === "shot") b.state = "loose";
    }
  }

  /**
   * 接管/抢断判定：
   * - 有主时：邻近对手按 tackling 概率抢断
   * - 无主时：控球半径内最近球员按接管概率拿球（高速球更难接）
   * 门将扑救：必须朝己方球门飞 + 在可扑半径内 + 按射门难度掷一次骰。
   */
  _resolvePossession(dt) {
    const b = this.ball;
    const speed = Math.hypot(b.vx, b.vy);

    // —— 门将扑救（合理化）——
    // 轨迹线段判定 + 每脚只掷一次；空门/球已过身几乎不扑；成功后扑倒姿态。
    if (b.state === "shot" && !b.owner && !b._saveChecked) {
      for (const gk of this.agents) {
        if (gk.role !== "GK") continue;
        if (gk.id === b.lastKicker) continue;
        const goalY = gk.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
        const towardGoal = gk.team === "home" ? b.vy > 1.2 : b.vy < -1.2;
        if (!towardGoal) continue;
        // 只在球靠近禁区/门前时介入
        const nearBox = gk.team === "home" ? b.y > 68 : b.y < 32;
        if (!nearBox) continue;

        // 本帧轨迹：step 后位置 - 速度*dt → 上帧位置
        const x1 = b.x;
        const y1 = b.y;
        const x0 = b.x - b.vx * dt;
        const y0 = b.y - b.vy * dt;
        // 点到线段最短距离
        const segLen2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1e-6;
        let tt = ((gk.x - x0) * (x1 - x0) + (gk.y - y0) * (y1 - y0)) / segLen2;
        tt = clamp(tt, 0, 1);
        const cx = x0 + (x1 - x0) * tt;
        const cy = y0 + (y1 - y0) * tt;
        const dPath = dist(gk.x, gk.y, cx, cy);
        const lateral = Math.abs(gk.x - cx);

        const ref = gk.attr.reflexes || 0.5;
        const hand = gk.attr.handling || 0.5;
        // 可扑范围：必须球路擦过门将，不能站着吸远处的球
        const reach = 3.2 + 2.8 * ref + Math.min(1.4, speed * 0.03);
        if (dPath > reach) continue;

        // 球已越过门将朝球门线 → 无法回头捞（防「离谱反应」）
        const pastGk =
          gk.team === "home" ? cy > gk.y + 1.6 : cy < gk.y - 1.6;
        if (pastGk) continue;
        // 球已明显更靠近门线、门将还在外线 → 追不上
        const ballCloserToLine =
          gk.team === "home"
            ? Math.abs(cy - goalY) + 1.2 < Math.abs(gk.y - goalY)
            : Math.abs(cy - goalY) + 1.2 < Math.abs(gk.y - goalY);
        if (ballCloserToLine && lateral > 2.2) continue;

        b._saveChecked = true; // 本脚射门只判定一次

        const shotDistance = Number(b.shotDistance) || 18;
        const cover = clamp(1 - dPath / reach, 0, 1);
        // 路线正确：门将对射正球应有稳定基础覆盖；空门/远侧再大幅降低。
        let pSave =
          0.68 +
          0.32 * cover +
          0.22 * ref +
          0.08 * hand -
          speed / 180 -
          lateral * 0.025;
        // 极近距离仍更难反应，但不再因为“球已靠近门线”把所有扑救率统一砍半。
        if (shotDistance < 8) pSave *= 0.82;
        else if (shotDistance < 12) pSave *= 0.92;
        // 空门：横向远离射门落点 / 标记 openGoal
        if (b._openGoalShot) pSave *= 0.18;
        if (lateral > 6.5) pSave *= 0.08;
        else if (lateral > 5) pSave *= 0.22;
        else if (lateral > 3.8) pSave *= 0.55;
        // 近距离强力抽射更难扑
        if (speed > 42 && dPath > reach * 0.45) pSave *= 0.7;
        pSave = clamp(pSave, 0.04, 0.88);

        // 扑救姿态：短促侧扑（画面仍画成圆点+残影，勿拉成胶囊）
        const diveDir = cx >= gk.x ? 1 : -1;
        gk.pose = "dive";
        gk.poseDir = diveDir;
        gk.poseUntil = this.t + 0.55;
        // 身体朝球微移（不像瞬移）
        gk.x = clamp(gk.x + (cx - gk.x) * 0.55, 36, 64);
        gk.y = clamp(gk.y + (cy - gk.y) * 0.4, 2, 98);
        gk.heading = Math.atan2(cy - gk.y, cx - gk.x);

        if (Math.random() < pSave) {
          // 约 55% 抱稳，其余托出/击出（更像真实扑救，且球飞离门口）
          const hold = Math.random() < 0.55 + 0.2 * hand;
          if (hold) {
            b.owner = gk.id;
            b.x = cx;
            b.y = cy;
            b.vx = 0;
            b.vy = 0;
            b.z = 0;
            b.vz = 0;
            b.state = "held";
            gk.protectUntil = this.t + 1.8;
            gk.decisionUntil = this.t + 1.0;
            b.settleUntil = this.t + 1.15;
            this.deadBallUntil = this.t + 1.0;
          } else {
            // 托出：约 40% 托过底线得角球（现实中门将扑救最主要的角球来源），
            // 其余弹向边路/角区、不落到前锋脚下。
            const side = diveDir || (Math.random() < 0.5 ? 1 : -1);
            const bylineDir = gk.team === "home" ? 1 : -1; // 己方底线方向：home 朝 +y(≈100)
            const tipOver = Math.random() < 0.4;
            b.owner = null;
            b.x = cx;
            b.y = cy;
            b.vx = side * (10 + Math.random() * 8);
            // tipOver：朝底线外送足够速度越线 → _resolveBounds 判角球给进攻方；
            // 否则朝场内边路托出，回到运动战。
            b.vy = tipOver
              ? bylineDir * (10 + Math.random() * 6)
              : -bylineDir * (6 + Math.random() * 5);
            b.z = 0.6 + Math.random() * 0.8;
            b.vz = 4 + Math.random() * 3;
            b.state = "loose";
            b.lastKicker = gk.id;
            b.kickTeam = gk.team;
            b.kickX = b.x;
            b.kickY = b.y;
            b.settleUntil = this.t + 0.55;
            this.deadBallUntil = this.t + 0.4;
            gk.protectUntil = this.t + 0.5;
            gk.decisionUntil = this.t + 0.55;
          }
          this._emit("save", gk, { hold, lateral, openGoal: !!b._openGoalShot });
          return;
        }
        // 未扑住：球继续飞，仅轻微蹭偏
        if (Math.random() < 0.18) {
          b.vx += diveDir * (1.5 + Math.random() * 2);
          b.vy *= 0.96;
        }
        break; // 已判定本脚，不再换门将
      }
    }

    // —— 全局球权稳定锁：任何球权转换后短暂锁定，期间不可再易主 ——
    // 这是根治"贴身缠斗中球权亚秒级反复易主"（抢断乒乓 + 传球乒乓）的关键：
    // 每次球权转换都上一个缓冲垫，杜绝两名贴身球员来回夺球。
    if (this.t < (b.settleUntil || 0)) return;

    // —— 射门封堵 ——
    // 高速射门不能走下方普通“接管球权”逻辑，否则后卫会像停传球一样把球吸住。
    // 每名路径附近的防守者只判一次：成功则折射成 loose ball，失败则球继续飞向球门。
    if (b.state === "shot" && !b.owner) {
      const checked = b._blockersChecked instanceof Set ? b._blockersChecked : new Set();
      b._blockersChecked = checked;
      for (const o of this.agents) {
        if (o.team === b.kickTeam || o.role === "GK" || o.sentOff || checked.has(o.id)) continue;
        const d = dist(o.x, o.y, b.x, b.y);
        if (d > 3.2 + Math.min(1.2, speed * 0.018)) continue;
        checked.add(o.id);
        const blockSkill = 0.55 * o.attr.positioning + 0.45 * o.attr.tackling;
        const pBlock = clamp(0.12 + blockSkill * 0.38 - speed / 240, 0.08, 0.42);
        if (Math.random() >= pBlock) continue;
        const side = o.x <= b.x ? 1 : -1;
        // 约 30% 挡过自己的底线得角球（真实角球来源之一）；否则弹回场内。
        const bylineDir = o.team === "home" ? 1 : -1; // 己方底线：home 在 +y
        const blockOut = Math.random() < 0.3;
        b.vx = side * (6 + Math.random() * 7) + b.vx * 0.12;
        b.vy = blockOut ? bylineDir * (9 + Math.random() * 6) : b.vy * -0.12;
        b.z = Math.max(0.1, b.z || 0);
        b.vz = 2 + Math.random() * 3;
        b.state = "loose";
        if (blockOut) {
          b.lastKicker = o.id;
          b.kickTeam = o.team;
          b.kickX = b.x;
          b.kickY = b.y;
        }
        this._clearBallTarget();
        this._emit("block", o, { from: b.lastKicker });
        return;
      }
      return;
    }

    // —— 飞行传球拦截：路径附近的对手主动断球（中场绞杀的核心）——
    // 之前只有球飞到对手脚下 2.6 内才可能被接管，中场传球从空隙穿过、几乎不被拦，
    // 导致球轻松穿越中场、三区进入频率高达真实的 ~11 倍。这里让飞行中的传球，
    // 只要有对手足够贴近球的当前位置，就按 tackling/positioning 概率抢截下来。
    if (b.state === "pass" && !b.owner) {
      const flown = (b.kickX != null) ? dist(b.x, b.y, b.kickX, b.kickY) : 999;
      // 传中球飞在头顶以上（z>2.2 ≈ 起跳争顶极限）时物理上够不着——
      // 不加这条，吊过人墙/人堆头顶的球会被"原地吃掉"，传中永远到不了禁区。
      const overhead = b.isCrossPass && b.z > 2.2;
      if (flown >= 6 && !overhead) { // 传球早段仍受保护（防贴脸截断/乒乓），飞出一段后才可拦
        for (const o of this.agents) {
          // sentOff：离场者（红牌/伤退走向边线途中）绝不能拦截，否则带球离场冻结比赛
          if (o.team === b.kickTeam || o.role === "GK" || o.sentOff) continue;
          if (this.t < (o.tackleCdUntil || 0)) continue;
          const d = dist(o.x, o.y, b.x, b.y);
          // 拦截半径：比脚下控球略大（伸脚/身体挡），越靠近越易成
          if (d < SIM.CONTROL_RADIUS + 1.6) {
            o.tackleCdUntil = this.t + 0.5;
            const pick = 0.45 * o.attr.tackling + 0.35 * o.attr.positioning + 0.2 * o.attr.pace;
            const p = clamp(0.3 + pick * 0.55 - speed / 160, 0.1, 0.8);
            if (Math.random() < p) {
              b.owner = o.id;
              b.vx = 0; b.vy = 0;
              b.state = "held";
              this._clearBallTarget();
              o.decisionUntil = this._nextControlDecision(o);
              o.intent = this._forwardDribbleIntent(o);
              o.fsm = "carry";
              o.protectUntil = this.t + 0.7;
              b.settleUntil = this.t + 0.45;
              this._emit("intercept", o, { from: b.lastKicker });
              return;
            }
          }
        }
      }
    }

    if (b.owner) {
      // —— 抢断：非持球方邻近对手尝试抢断 ——
      const owner = this.agentById(b.owner);
      if (!owner) { b.owner = null; return; }
      // 死球窗口内不许抢断（开球/重开恢复期），打断刷球死循环
      if (this.t < (this.deadBallUntil || 0)) return;
      // 持球者刚拿球有短暂护球保护，避免"接球即被断"的乒乓球
      if (this.t < (owner.protectUntil || 0)) return;

      // 球队刚夺回球权后先获得一个可组织窗口；否则双方会在同一位置亚秒级互抢。
      const possessionAge = this.t - (this._teamAttackSince[owner.team] || 0);
      if (possessionAge < 4) return;

      const defendingTeam = owner.team === "home" ? "away" : "home";
      if (this.t < (this._teamTackleUntil[defendingTeam] || 0)) return;
      const tacklePlan = this._refreshDefPlan(defendingTeam, owner);
      for (const o of this.agents) {
        if (o.team === owner.team || o.role === "GK" || o.sentOff) continue;
        // 只有球队当前指定的上抢者可以下脚；其他人保持封线/盯人职责。
        if (tacklePlan?.jobs.get(o.id)?.type !== "press") continue;
        // 抢断尝试冷却：个人与全队都不能每 tick 掷骰子。
        if (this.t < (o.tackleCdUntil || 0)) continue;
        const d = dist(o.x, o.y, b.x, b.y);
        if (d < SIM.CONTROL_RADIUS + 0.25) {
          o.tackleCdUntil = this.t + 2.8;
          this._teamTackleUntil[defendingTeam] = this.t + 2.8;
          // 抢断成功率：tackling vs 持球者 dribbling+strength（单次尝试，不再乘 tick）
          const atk = 0.5 * owner.attr.dribbling + 0.3 * owner.attr.strength;
          const def = 0.6 * o.attr.tackling + 0.2 * o.attr.marking;
          // 单次成功率保持克制；高速带球略容易丢球。
          const ownerSpeed = Math.hypot(owner.vx, owner.vy);
          const moveVuln = clamp(ownerSpeed / SIM.MAX_PLAYER_SPEED, 0, 1) * 0.1;
          const p = clamp(0.32 + (def - atk) * 0.55 + moveVuln, 0.1, 0.7);
          if (Math.random() < p) {
            b.owner = o.id;
            b.vx = 0;
            b.vy = 0;
            b.state = "held";
            this._clearBallTarget();
            b.settleUntil = this.t + 1.4;
            // settle：抢到后先护/带一下再决策，避免抢断→立刻回传的乒乓
            o.decisionUntil = this._nextControlDecision(o);
            o.intent = this._forwardDribbleIntent(o);
            o.fsm = "carry";
            o.protectUntil = this.t + 1.6;
            // 被抢者：设追抢冷却 + 轻微后撤，避免"贴身原地互抢"的乒乓循环。
            // 真实里丢球方会先失位、退一步再重新组织逼抢，不会瞬间贴脸抢回。
            owner.tackleCdUntil = this.t + 2.2;
            this._teamTackleUntil[owner.team] = this.t + 2.2;
            owner.protectUntil = 0;
            const bk = this.attackDir(owner.team); // 丢球者朝己方向后撤一点
            owner.tx = clamp(owner.x - bk * 4, 3, 97);
            owner.ty = clamp(owner.y + bk * 4, 3, 97);
            this._emit("tackle", o, { from: owner.id });
            return;
          } else {
            // 抢断失败 + 贴身接触：按 tackling 反比 + 战术凶狠度掷犯规。
            // 成立则判任意球/点球（禁区内），并按严重度掷黄/红，直接 return。
            if (this._commitFoul(o, owner)) return;
          }
        }
      }
      return;
    }

    // —— 自由球接管 ——
    // 传球早段保护：球刚踢出、尚未飞离原点足够距离时，对手不能"贴脸截断"
    // （真实里无法在传球者脚下断球）。这是根治"传球乒乓"的关键——
    // 让球有机会飞到本方接球人，而不是被紧贴的对手零距离吃掉。
    const flownFromKick = (b.kickX != null)
      ? dist(b.x, b.y, b.kickX, b.kickY) : 999;
    const oppBlocked = b.state === "pass" && flownFromKick < 8; // 8 以内对手不可截

    // 注意：射门飞行中仍允许近距离争夺（原始行为，否则进球爆炸）；
    // 门将扑救已优先处理。禁区乒乓靠下方「小禁区优先门将」抑制。

    // 传中飞越头顶（z>2.2）时外场球员够不着：让球飞到落点再争，
    // 否则高弧线会被路径上的人在 2D 距离内"凭空控下"。门将手臂长（3.0）可摘高球。
    const overheadCross = b.state === "pass" && !!b.isCrossPass;

    let best = null;
    let bestD = SIM.CONTROL_RADIUS + speed * 0.04;
    for (const a of this.agents) {
      // 已离场者（红牌/伤退）绝不能接管球：否则球会跟着他走出边线并永远 held
      if (a.sentOff) continue;
      if (a.id === b.lastKicker && this.t < (a.noReclaimUntil || 0)) continue;
      if (oppBlocked && a.team !== b.kickTeam) continue;
      // 高弧线传中够不着就不能控（外场 2.2 / 门将 3.0）
      if (overheadCross && b.z > (a.role === "GK" ? 3.0 : 2.2)) continue;
      // 门将只能在本方禁区附近拿自由球（防中场门将"参与传球"）
      if (a.role === "GK") {
        const inBox =
          a.team === "home"
            ? b.y > 80 && b.x > 18 && b.x < 82
            : b.y < 20 && b.x > 18 && b.x < 82;
        if (!inBox) continue;
      }
      const d = dist(a.x, a.y, b.x, b.y);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }

    // 小禁区慢球：门将与对方前锋贴在一起时，优先归门将（防「门将与前锋传球」乒乓）
    if (best && best.role !== "GK" && speed < 8) {
      const nearGk = this.agents.find((g) => {
        if (g.role !== "GK" || g.team === best.team) return false;
        const inSix =
          g.team === "home"
            ? b.y > 86 && b.x > 28 && b.x < 72
            : b.y < 14 && b.x > 28 && b.x < 72;
        return inSix && dist(g.x, g.y, b.x, b.y) < SIM.CONTROL_RADIUS + 2.2;
      });
      if (nearGk) best = nearGk;
    }

    // 门将刚踢/刚扑：小禁区内对方前锋不能立刻捡球「回传互动」
    if (best && best.role !== "GK") {
      const last = b.lastKicker ? this.agentById(b.lastKicker) : null;
      if (last?.role === "GK" && last.team !== best.team) {
        const flown = b.kickX != null ? dist(b.x, b.y, b.kickX, b.kickY) : 999;
        const inSix =
          last.team === "home"
            ? b.y > 84 && b.x > 26 && b.x < 74
            : b.y < 16 && b.x > 26 && b.x < 74;
        // 保护只在球仍在运动时有效：解围软弱球停在门区内时 flown 永远 <14，
        // 若继续禁止拾取会让对方站在死球旁边干瞪眼（无主球僵持来源之一）。
        if (inSix && flown < 14 && Math.hypot(b.vx, b.vy) > 1) {
          // 球还没真正离开门区 → 对方不能抢
          best = null;
        }
      }
    }

    if (best) {
      // —— 越位判罚 ——
      if (
        b.state === "pass" &&
        best.team === b.kickTeam &&
        best.id !== b.lastKicker &&
        (b.offsideIds instanceof Set || b.offsideLineY != null) &&
        best.role !== "GK"
      ) {
        // 新路径使用出脚瞬间的球员集合；旧存档/诊断球仍兼容接球点判定。
        const off =
          b.offsideIds instanceof Set
            ? b.offsideIds.has(best.id)
            : b.kickTeam === "home"
              ? best.y < b.offsideLineY - 0.5
              : best.y > b.offsideLineY + 0.5;
        if (off) {
          this._callOffside(best);
          return;
        }
      }
      // 接管成功率：球越快越难控
      let ctl = 0.55 + 0.4 * best.attr.dribbling;
      if (best.role === "GK") ctl = 0.75 + 0.22 * (best.attr.handling || 0.5);
      const p = clamp(ctl - speed / 90, 0.15, 0.98);
      if (Math.random() < p) {
        b.owner = best.id;
        b.vx = 0;
        b.vy = 0;
        b.z = 0;
        b.vz = 0;
        b.state = "held";
        this._clearBallTarget();
        b._saveChecked = false;
        best.decisionUntil = this._nextControlDecision(best);
        best.intent = best.role === "GK" ? null : this._forwardDribbleIntent(best);
        best.fsm = best.role === "GK" ? "home" : "carry";
        // 门将拿球护球更长，杜绝前锋贴脸抢回造成「互传」
        best.protectUntil = this.t + (best.role === "GK" ? 1.7 : 0.7);
        b.settleUntil = this.t + (best.role === "GK" ? 1.05 : 0.45);
        if (best.role === "GK") {
          best.pose = "hold";
          best.poseUntil = this.t + 0.7;
        }
      } else {
        // 没控住：把球磕开，避免原地互抢
        const away = best.role === "GK" ? 1 : -1;
        const dir = this.attackDir(best.team);
        b.vx = (Math.random() - 0.5) * 8;
        b.vy = dir * away * (4 + Math.random() * 5);
        b.state = "loose";
        this._clearBallTarget();
      }
    }
  }

  /**
   * 伤病涌现（P3 收尾）：让球员因对抗或疲劳受伤退场。
   * 引擎只判定「发生伤病风险」并让其退出模拟（复用 sentOff 减员）；
   * 是否真成伤、缺阵多久由 match 层按队医/训练/天气二次结算（保留设施深度）。
   * 门将不作为对象（避免无人守门）。
   * @param {object} p 受伤球员
   * @param {"contact"|"fatigue"} cause 成因（仅用于文案/统计）
   * @returns {boolean}
   */
  _commitInjury(p, cause) {
    if (!p || p.sentOff || p.injuredOff || p.role === "GK") return false;
    p.injuredOff = true;
    p.sentOff = true; // 复用罚下减员：退出决策/跑位/发球候选，场上真实少一人
    // 伤退者可能正持球（接触伤受害者/疲劳伤抽查都可能是 owner）：
    // 必须原地放落为 loose，否则他会带着球走向边线并永久冻结比赛。
    if (this.ball.owner === p.id) {
      const b = this.ball;
      b.owner = null;
      b.state = "loose";
      b.vx = 0;
      b.vy = 0;
      this._clearBallTarget();
    }
    this._emit("injury", p, { cause });
    // 请求替补（接入层决定名额/人选）：约 40s 后从边线热替换进场，恢复 11v11。
    // 无名额/无人可换 → 返回 null，真实地少人作战。
    const sub = typeof this.onInjurySub === "function" ? this.onInjurySub(p, cause) : null;
    if (sub) {
      (this._pendingSubs || (this._pendingSubs = [])).push({
        outId: p.id,
        player: sub,
        at: this.t + 40,
      });
    }
    return true;
  }

  /**
   * 伤病热替换：把 outId 所在 slot 换成替补 player（角色/基准位继承槽位）。
   * 引擎不做名额记账（match 层负责），只让替补从中线边缘进场跑回基准位。
   * @param {string} outId 伤退球员 id
   * @param {object} player 替补球员（club.players 成员）
   * @returns {boolean}
   */
  substituteAgent(outId, player) {
    const a = this.agents.find((x) => x.id === outId);
    if (!a || !player) return false;
    const attrs = player.attrs || {};
    a.id = player.id;
    a.player = player;
    a.num = player.number ?? a.num;
    a.attr = {
      pace: norm(attrs.pace),
      accel: norm(attrs.pace) * 0.6 + norm(attrs.strength) * 0.4,
      passing: norm(attrs.passing),
      vision: norm(attrs.vision),
      shooting: norm(attrs.shooting),
      finishing: norm(attrs.finishing),
      dribbling: norm(attrs.dribbling),
      tackling: norm(attrs.tackling),
      marking: norm(attrs.marking),
      strength: norm(attrs.strength),
      stamina: norm(attrs.stamina),
      positioning: norm(attrs.positioning),
      reflexes: norm(attrs.reflexes),
      handling: norm(attrs.handling),
      kicking: norm(attrs.kicking),
    };
    a.fitness = player.fitness ?? 100;
    a.sentOff = false;
    a.injuredOff = false;
    a._yellows = 0;
    a.isCore = false;
    // 从中线边缘进场，跑回基准位
    a.x = a.baseX < 50 ? 1 : 99;
    a.y = 50;
    a.tx = a.baseX;
    a.ty = a.baseY;
    a.vx = 0;
    a.vy = 0;
    a.intent = null;
    a.fsm = "home";
    a.decisionUntil = this.t + 0.8;
    a.protectUntil = 0;
    a.tackleCdUntil = 0;
    return true;
  }

  /**
   * 防死锁看门狗（对症存量僵持 + 减员放大版）：
   * 球权/球位 20s 零进展（正常持球含角球停顿最长 ~5s）判定为病理僵持，
   * 强制持球者大脚解围到对方半场（同门将被逼抢的既有行为）；无主僵持球轻推回中场。
   * 根因（持球决策在特定攻防形态下选不出动作）另行排查，此处只兜底保比赛活性。
   */
  _antiDeadlock(dt) {
    const b = this.ball;
    if (this.celebrateUntil && this.t < this.celebrateUntil) {
      this._stallT = 0;
      return;
    }
    if (this.t < this.deadBallUntil) {
      this._stallT = 0;
      return;
    }
    const key = `${b.owner || "-"}|${b.state}`;
    const moved = Math.hypot(b.x - (this._stallX ?? b.x), b.y - (this._stallY ?? b.y));
    if (key === this._stallKey && moved < 3) {
      this._stallT = (this._stallT || 0) + dt;
    } else {
      this._stallKey = key;
      this._stallX = b.x;
      this._stallY = b.y;
      this._stallT = 0;
    }
    if (this._stallT < 20) return;
    this._stallT = 0;
    this._stallKey = null;
    const o = b.owner ? this.agentById(b.owner) : null;
    this._emit("stall_clear", o || null);
    if (o) {
      const dir = this.attackDir(o.team);
      const tx = clamp(o.x < 50 ? 62 + Math.random() * 24 : 14 + Math.random() * 24, 6, 94);
      const ty = clamp(o.y + dir * (28 + Math.random() * 14), 6, 94);
      const d = Math.max(1, dist(o.x, o.y, tx, ty));
      const sp = 26;
      b.vx = ((tx - o.x) / d) * sp;
      b.vy = ((ty - o.y) / d) * sp;
      b.z = 0.4;
      b.vz = 4.5;
      b.owner = null;
      b.state = "loose";
      b.lastKicker = o.id;
      b.kickTeam = o.team;
      b.kickX = o.x;
      b.kickY = o.y;
      this._clearBallTarget();
      o.noReclaimUntil = this.t + 1.2;
      o.decisionUntil = this._nextControlDecision(o);
      o.intent = null;
    } else {
      // 无主球僵持（没人去捡）：定速推回中圈，让接管判定重新有人可选
      const d = Math.max(1, dist(b.x, b.y, 50, 50));
      b.vx = ((50 - b.x) / d) * 10;
      b.vy = ((50 - b.y) / d) * 10;
      b.z = 0;
      b.vz = 0;
      b.state = "loose";
    }
  }

  /**
   * 疲劳性无接触伤：每模拟分钟考察一名体能最低的在场球员，低概率受伤。
   * 真实里肌肉拉伤无场面因果，故独立于对抗；体能越低越危险。
   */
  _tickFatigueInjury() {
    let worst = null;
    let worstFit = 101;
    for (const a of this.agents) {
      if (a.sentOff || a.injuredOff || a.role === "GK") continue;
      const f = a.fitness ?? 100;
      if (f < worstFit) {
        worstFit = f;
        worst = a;
      }
    }
    if (!worst) return;
    // 持球者/飞行接球点不伤（避免球随人「离场」卡死），留给下次抽查
    if (worst.id === this.ball.owner || worst.id === this.ball.receiverId) return;
    const fit = worstFit / 100;
    const mul = this.injuryMul?.[worst.team] ?? 1;
    const p = clamp(0.0006 + (0.7 - fit) * 0.004, 0.0003, 0.006) * mul;
    if (Math.random() < p) this._commitInjury(worst, "fatigue");
  }

  /**
   * 犯规判定（P3）：抢断失败 + 贴身接触时调用。
   * - 犯规概率 = f(防守者 tackling 反比, 战术压迫凶狠度)
   * - 禁区内 → 点球；其余 → 任意球（判给被侵犯方）
   * - 严重度掷黄/红：累计第二黄 → 红；小概率直红
   * 成立返回 true（已重启死球），否则 false。
   * @param {object} defender 犯规的防守球员
   * @param {object} victim 被侵犯的持球者
   */
  _commitFoul(defender, victim) {
    const b = this.ball;
    // 禁区判定：犯规发生在防守方(defender)自己的禁区内 → 点球
    // 防守方球门：home 守 y≈100，away 守 y≈0；禁区约 x∈[22,78]、纵深 16
    const inBox =
      b.x > 22 &&
      b.x < 78 &&
      (defender.team === "home" ? b.y >= 84 : b.y <= 16);

    // 凶狠度：压迫越高越易犯规；tackling 越好越不易“铲不到还犯规”。
    // 基准经量化校准到全场约 22 次犯规（失败抢断接触 ~166 次/场 × 均值 ~0.13）。
    const pressing = this._tacticLevel(defender.team, "pressing");
    let pFoul = clamp(
      0.028 + (1 - defender.attr.tackling) * 0.077 + (pressing - 3) * 0.008,
      0.015,
      0.12
    );
    // 禁区内强抑制：真实里后卫在禁区格外谨慎、裁判需明显接触才判点，
    // 否则点球会随禁区内每次贴身暴涨。约 0.024× → 点球落到每 3-4 场一个量级。
    if (inBox) pFoul *= 0.024;
    if (Math.random() >= pFoul) return false;

    // 被侵犯方获得球权重启
    const attackTeam = victim.team;

    // 卡片严重度（相对犯规数的真实比例）：黄 ~15%，直红 ~0.3%。
    const roll = Math.random();
    let card = "none";
    // 直红（暴力/最后一人）：很小概率
    if (roll < 0.003 + (pressing - 3) * 0.0008) {
      card = "red";
    } else if (roll < 0.15 + (pressing - 3) * 0.015) {
      const prev = defender._yellows || 0;
      if (prev >= 1) {
        // 已有黄牌者会格外谨慎、裁判对第二黄也偏宽容：仅 ~22% 真的变红，
        // 否则本次逃过（不吃牌）。杜绝第二黄红牌泛滥（真实红牌约每 8-10 场一张）。
        if (Math.random() < 0.22) card = "red2";
      } else {
        card = "yellow";
        defender._yellows = prev + 1;
      }
    }

    if (card === "red" || card === "red2") {
      defender.sentOff = true;
    }

    this._emit("foul", defender, {
      from: victim.id,
      card, // none | yellow | red | red2
      penalty: inBox,
      x: b.x,
      y: b.y,
    });

    // 被侵犯者可能伤退：犯规越重越可能（重伤多来自恶性犯规）。
    // 量级：普通犯规 ~1%、黄牌级 ~6%、直红 ~20% → 配合犯规 ~22/场
    // 约 0.4 次接触伤/场，对齐旧 tryInjury 的整体频率。
    const injMul = this.injuryMul?.[victim.team] ?? 1;
    const pInj =
      card === "red" ? 0.2 : card === "yellow" || card === "red2" ? 0.06 : 0.01;
    if (Math.random() < pInj * injMul) this._commitInjury(victim, "contact");

    if (inBox) {
      this._penaltyKick(attackTeam);
    } else {
      const fx = clamp(b.x, 4, 96);
      const fy = clamp(b.y, 4, 96);
      this._restart("freekick", attackTeam, fx, fy);
    }
    return true;
  }

  /**
   * 点球：罚球点单挑门将（不做助跑动画）。
   * 按主罚者 finishing vs 门将 reflexes 结算进球/扑救/罚失，进球走 _goal。
   * @param {"home"|"away"} team 主罚方
   */
  _penaltyKick(team) {
    const b = this.ball;
    const dir = this.attackDir(team); // 主罚方进攻方向
    const spotY = team === "home" ? 12 : 88; // 罚球点（对方禁区内）
    // 主罚者：核心优先，否则本队 finishing 最高的非门将
    const takers = this.agents
      .filter((a) => a.team === team && a.role !== "GK" && !a.sentOff)
      .sort(
        (a, c) =>
          (c.isCore ? 1 : 0) - (a.isCore ? 1 : 0) ||
          c.attr.finishing - a.attr.finishing
      );
    const taker = takers[0] || null;
    const oppTeam = team === "home" ? "away" : "home";
    const gk = this.agents.find((a) => a.team === oppTeam && a.role === "GK") || null;

    // 死球摆位：其余球员退到禁区弧顶外（已离场者不参与摆位）
    for (const a of this.agents) {
      if (a.sentOff) continue;
      a.vx = 0;
      a.vy = 0;
      a.intent = null;
      a.pose = null;
      if (a === taker || a === gk) continue;
      // 站到弧顶外（远离罚球点）
      const backY = team === "home" ? 26 : 74;
      a.y = clamp(backY + (Math.random() - 0.5) * 6, 4, 96);
      a.x = clamp(30 + Math.random() * 40, 6, 94);
      a.tx = a.x;
      a.ty = a.y;
      a.decisionUntil = this.t + 1.2;
      a.fsm = "home";
    }
    if (gk) {
      gk.x = 50;
      gk.y = gk.baseY;
      gk.tx = gk.x;
      gk.ty = gk.y;
    }
    if (!taker) {
      // 兜底：没人可罚，直接门球给对方
      this._restart("goalkick", oppTeam, 50, team === "home" ? 12 : 88);
      return;
    }
    taker.x = 50;
    taker.y = spotY - dir * 4;
    taker.tx = taker.x;
    taker.ty = taker.y;

    // 结算：finishing 决定命中，门将 reflexes 决定扑出，另有罚失（打偏/中框）
    const finish = taker.attr.finishing;
    const save = gk ? 0.5 * gk.attr.reflexes + 0.3 * gk.attr.handling : 0.2;
    const pScore = clamp(0.78 + (finish - 0.6) * 0.35 - save * 0.28, 0.5, 0.9);
    const r = Math.random();
    // 球先摆到点上（供直播看到）
    b.x = 50;
    b.y = spotY;
    b.z = 0;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.owner = null;
    b.lastKicker = taker.id;
    b.kickTeam = team;
    b.state = "shot";
    b._shotAssistId = null;

    if (r < pScore) {
      // 进球：钉在球门方向
      b.y = team === "home" ? 0.6 : 99.4;
      b._penaltyGoal = true;
      this._goal(team);
    } else if (r < pScore + (1 - pScore) * 0.7 && gk) {
      // 门将扑出：球托向边路，转运动战
      this._emit("save", gk, { hold: false, penalty: true });
      const side = Math.random() < 0.5 ? 1 : -1;
      b.x = 50 + side * 8;
      b.y = spotY + dir * 3;
      b.vx = side * 12;
      b.vy = -dir * 6;
      b.z = 0.5;
      b.vz = 3;
      b.state = "loose";
      b.lastKicker = gk.id;
      b.kickTeam = oppTeam;
      b.settleUntil = this.t + 0.6;
      this.deadBallUntil = this.t + 0.5;
    } else {
      // 罚失（打偏/中框出底线）：门球给对方
      this._emit("shot", taker, { penalty: true, offTarget: true });
      this._restart("goalkick", oppTeam, 50, team === "home" ? 12 : 88);
    }
  }

  /**
   * 边界与进球判定（P3）：
   * - 球越过球门线且在门框内 → 进球
   * - 越过球门线（门框外）→ 进攻方碰的 = 门球；防守方碰的 = 角球
   * - 越过边线 → 界外球（判给最后触球方的对方）
   * 每种死球都经 _restart 分类重启：重置站位 + 死球窗口，让球彻底离开门口，
   * 从根上掐断"射偏→门口篮板→再射"的射门画廊。
   */
  _resolveBounds() {
    const b = this.ball;
    const kicker = b.lastKicker ? this.agentById(b.lastKicker) : null;
    const kickTeam = kicker ? kicker.team : null;

    // —— 越过球门线 ——
    // 主队球门在 y≈100，客队球门在 y≈0
    // 横梁：非射门球（传中/解围等高弧线）过门线时必须低于横梁才算进。
    // 射门豁免——射门的高度误差已折算进水平误差校准，不能重复惩罚。
    const underBar = b.state === "shot" || (b.z || 0) < 2.6;
    if (b.y <= 0) {
      // 客队球门线：门框内且是主队打进 → 进球
      if (b.x > SIM.GOAL_X0 && b.x < SIM.GOAL_X1 && underBar) return this._goal("home");
      // 门框外出底线：防守方(away)最后碰 = 角球给进攻方(home)；进攻方(home)碰 = 门球给 away
      if (kickTeam === "away") return this._restart("corner", "home", b.x < 50 ? 2 : 98, 4);
      return this._restart("goalkick", "away", 50, 12);
    }
    if (b.y >= 100) {
      if (b.x > SIM.GOAL_X0 && b.x < SIM.GOAL_X1 && underBar) return this._goal("away");
      // 防守方(home)最后碰 = 角球给进攻方(away)；进攻方(away)碰 = 门球给 home
      if (kickTeam === "home") return this._restart("corner", "away", b.x < 50 ? 2 : 98, 96);
      return this._restart("goalkick", "home", 50, 88);
    }

    // —— 越过边线：界外球，判给对方 ——
    if (b.x <= 0 || b.x >= 100) {
      const throwTeam = kickTeam ? (kickTeam === "home" ? "away" : "home") : "home";
      const tx = b.x <= 0 ? 1 : 99;
      return this._restart("throwin", throwTeam, tx, clamp(b.y, 8, 92));
    }
  }

  /**
   * 死球重启：角球 / 门球 / 界外球。
   * 把球放到重启点、交给 restartTeam 最近球员，并重置双方站位到合理形态，
   * 给足死球保护窗口——保证球真正离开门口，杜绝篮板连射。
   * @param {"corner"|"goalkick"|"throwin"|"offside"|"freekick"} type
   */
  _restart(type, restartTeam, x, y) {
    const b = this.ball;
    b.x = x;
    b.y = y;
    b.vx = 0;
    b.vy = 0;
    b.z = 0;
    b.vz = 0;
    b.owner = null;
    b.state = type === "corner" ? "corner" : "held";
    b.lastKicker = null;
    b.kickTeam = restartTeam;
    b.kickX = x;
    b.kickY = y;
    b.offsideLineY = null;
    this._clearBallTarget();
    b.offsideExemptRestart =
      type === "corner" || type === "throwin" || type === "goalkick";
    b.restartType = type;

    const dir = this.attackDir(restartTeam); // 重启方进攻方向
    // 角球攻的球门：主队攻 y≈0，客队攻 y≈100
    const defGkY = restartTeam === "home" ? 5 : 95;

    // 角球用固定分槽而不是逐人随机撒点。旧逻辑的伯努利抽样会偶发 7v7
    // 同时塞进八码宽的区域，录像里就表现成一团重叠圆点。
    let cornerTaker = null;
    const attackBoxSlots = new Map();
    const attackEdgeSlots = new Map();
    const defendBoxSlots = new Map();
    const defendEdgeSlots = new Map();
    const mirrorY = (topY) => (restartTeam === "home" ? topY : 100 - topY);
    if (type === "corner") {
      const attackOutfield = this.agents.filter(
        (a) => a.team === restartTeam && a.role !== "GK" && !a.sentOff
      );
      const cornerSide = x < 50 ? 0 : 100;
      cornerTaker = attackOutfield
        .slice()
        .sort((a, b) => {
          const roleA = a.role === "MID" ? 0 : a.role === "DEF" ? 4 : 8;
          const roleB = b.role === "MID" ? 0 : b.role === "DEF" ? 4 : 8;
          return (
            Math.abs(a.baseX - cornerSide) + roleA -
              (Math.abs(b.baseX - cornerSide) + roleB) ||
            String(a.id).localeCompare(String(b.id))
          );
        })[0] || null;

      const roleOrder = (a) => (a.role === "ATT" ? 0 : a.role === "MID" ? 1 : 2);
      const attackers = attackOutfield
        .filter((a) => a !== cornerTaker)
        .sort(
          (a, b) =>
            roleOrder(a) - roleOrder(b) ||
            Math.abs(a.baseX - 50) - Math.abs(b.baseX - 50) ||
            String(a.id).localeCompare(String(b.id))
        );
      attackers.slice(0, 5).forEach((a, i) => attackBoxSlots.set(a.id, i));
      attackers.slice(5).forEach((a, i) => attackEdgeSlots.set(a.id, i));

      const defenders = this.agents
        .filter((a) => a.team !== restartTeam && a.role !== "GK" && !a.sentOff)
        .sort((a, b) => {
          const pa = a.role === "DEF" ? 0 : a.role === "MID" ? 1 : 2;
          const pb = b.role === "DEF" ? 0 : b.role === "MID" ? 1 : 2;
          return pa - pb || Math.abs(a.baseX - 50) - Math.abs(b.baseX - 50) ||
            String(a.id).localeCompare(String(b.id));
        });
      defenders.slice(0, 5).forEach((a, i) => defendBoxSlots.set(a.id, i));
      defenders.slice(5).forEach((a, i) => defendEdgeSlots.set(a.id, i));
      this.cornerShapeUntil = this.t + 2.15;
    } else {
      this.cornerShapeUntil = 0;
    }

    const attackBoxX = [35, 43, 50, 57, 65];
    const attackBoxY = [13, 17, 10, 17, 13];
    const attackEdgeX = [27, 39, 50, 61, 73];
    const attackEdgeY = [30, 27, 31, 27, 30];
    const defendBoxX = [38, 46, 50, 54, 62];
    const defendBoxY = [16, 12, 19, 12, 16];
    const defendEdgeX = [24, 37, 50, 63, 76];
    const defendEdgeY = [34, 31, 35, 31, 34];

    // —— 人墙任意球（P3 收尾）：按危险度分级摆位 ——
    // direct：距门近且角度尚可 → 人墙 3-5 人 + 主罚射/传中二选一
    // cross：进攻三区但射门价值低 → 2 人短墙 + 吊禁区抢点（角球式）
    // simple：后场/中场 → 沿用轻量重启（快发）
    let fkClass = null;
    let fkTaker = null;
    let fkShootP = 0;
    const fkWallPos = new Map();
    const fkAtkSlots = new Map();
    const fkDefSlots = new Map();
    if (type === "freekick") {
      const atkGoalY = this.targetGoalY(restartTeam);
      const dGoalFk = dist(x, y, 50, atkGoalY);
      const angFk = clamp(1 - Math.abs(x - 50) / 30, 0, 1);
      fkClass =
        dGoalFk < 30 && angFk > 0.25 ? "direct" : dGoalFk < 38 ? "cross" : "simple";
      if (fkClass !== "simple") {
        const atkOut = this.agents.filter(
          (a) => a.team === restartTeam && a.role !== "GK" && !a.sentOff
        );
        const defOut = this.agents.filter(
          (a) => a.team !== restartTeam && a.role !== "GK" && !a.sentOff
        );
        // 主罚者：直接任意球看 kicking/shooting，传中型看 passing/kicking
        const takerScore =
          fkClass === "direct"
            ? (p) => 0.5 * p.attr.kicking + 0.35 * p.attr.shooting + 0.15 * p.attr.passing
            : (p) => 0.55 * p.attr.passing + 0.45 * p.attr.kicking;
        fkTaker =
          atkOut
            .slice()
            .sort(
              (a, b) =>
                takerScore(b) - takerScore(a) ||
                String(a.id).localeCompare(String(b.id))
            )[0] || null;

        // 人墙：球→门连线 8.5 处（球贴门线时前压），MID/ATT 站墙让 DEF 留守盯人
        const wallN =
          fkClass === "direct" ? (dGoalFk < 18 ? 5 : dGoalFk < 24 ? 4 : 3) : 2;
        const gvx = 50 - x;
        const gvy = atkGoalY - y;
        const gd = Math.hypot(gvx, gvy) || 1;
        const wallD = Math.min(8.5, Math.max(4, gd - 4));
        const wcx = x + (gvx / gd) * wallD;
        const wcy = y + (gvy / gd) * wallD;
        const perpX = -gvy / gd;
        const perpY = gvx / gd;
        const wallPref = (a) => (a.role === "MID" ? 0 : a.role === "ATT" ? 1 : 2);
        const wallMen = defOut
          .slice()
          .sort(
            (a, b) =>
              wallPref(a) - wallPref(b) || String(a.id).localeCompare(String(b.id))
          )
          .slice(0, wallN);
        wallMen.forEach((a, i) => {
          const off = (i - (wallMen.length - 1) / 2) * 1.5;
          fkWallPos.set(a.id, {
            x: clamp(wcx + perpX * off, 2, 98),
            y: clamp(wcy + perpY * off, 2, 98),
          });
        });

        // 防守方其余人：复用角球防守槽位盯区，多余的退弧顶外
        const wallIds = new Set(wallMen.map((a) => a.id));
        const markers = defOut
          .filter((a) => !wallIds.has(a.id))
          .sort((a, b) => {
            const pa = a.role === "DEF" ? 0 : a.role === "MID" ? 1 : 2;
            const pb = b.role === "DEF" ? 0 : b.role === "MID" ? 1 : 2;
            return (
              pa - pb ||
              Math.abs(a.baseX - 50) - Math.abs(b.baseX - 50) ||
              String(a.id).localeCompare(String(b.id))
            );
          });
        markers.slice(0, 5).forEach((a, i) =>
          fkDefSlots.set(a.id, { x: defendBoxX[i], y: mirrorY(defendBoxY[i]) })
        );
        markers.slice(5).forEach((a, i) =>
          fkDefSlots.set(a.id, {
            x: defendEdgeX[i % 5],
            y: mirrorY(defendEdgeY[i % 5]),
          })
        );

        // 进攻方抢点：槽位压在防线身后 1.5+（任意球不豁免越位，开球瞬间必须合法）
        const fkBoxX = [42, 50, 58, 36, 64];
        const fkBoxY = [15, 17.5, 14, 16, 16];
        const atkN = fkClass === "direct" ? 3 : 5;
        const runnerPref = (a) => (a.role === "ATT" ? 0 : a.role === "MID" ? 1 : 2);
        const runners = atkOut
          .filter((a) => a !== fkTaker)
          .sort(
            (a, b) =>
              runnerPref(a) - runnerPref(b) ||
              Math.abs(a.baseX - 50) - Math.abs(b.baseX - 50) ||
              String(a.id).localeCompare(String(b.id))
          );
        runners.slice(0, atkN).forEach((a, i) =>
          fkAtkSlots.set(a.id, { x: fkBoxX[i], y: mirrorY(fkBoxY[i]) })
        );
        runners.slice(atkN, atkN + 2).forEach((a, i) =>
          fkAtkSlots.set(a.id, { x: i === 0 ? 38 : 62, y: mirrorY(27) })
        );

        // 主罚计划：越近越正越敢直接射，否则吊传禁区
        fkShootP =
          fkClass === "direct"
            ? clamp(
                (dGoalFk < 18 ? 0.85 : dGoalFk < 24 ? 0.62 : 0.45) *
                  (0.45 + 0.55 * angFk),
                0.1,
                0.85
              )
            : 0;
      }
    }
    const fkSetPiece = fkClass && fkClass !== "simple";

    for (const a of this.agents) {
      if (a.sentOff) continue; // 已离场者不参与死球摆位（否则每次重启都被传送回场内）
      a.vx = 0;
      a.vy = 0;
      a.intent = null;
      a.tackleCdUntil = 0;
      a.pose = null;

      if (type === "corner") {
        // —— 角球摆位：确定的 5v5 分槽，其余留在弧顶/外围 ——
        if (a.role === "GK") {
          if (a.team === restartTeam) {
            a.x = a.baseX;
            a.y = a.baseY;
          } else {
            a.x = clamp(50 + (Math.random() - 0.5) * 4, 44, 56);
            a.y = defGkY;
          }
        } else if (a === cornerTaker) {
          a.x = x;
          a.y = clamp(y + dir * 1.2, 1.5, 98.5);
        } else if (a.team === restartTeam) {
          const boxSlot = attackBoxSlots.get(a.id);
          const edgeSlot = attackEdgeSlots.get(a.id) ?? 0;
          if (boxSlot != null) {
            a.x = attackBoxX[boxSlot];
            a.y = mirrorY(attackBoxY[boxSlot]);
          } else {
            a.x = attackEdgeX[edgeSlot % attackEdgeX.length];
            a.y = mirrorY(attackEdgeY[edgeSlot % attackEdgeY.length]);
          }
        } else {
          const boxSlot = defendBoxSlots.get(a.id);
          const edgeSlot = defendEdgeSlots.get(a.id) ?? 0;
          if (boxSlot != null) {
            a.x = defendBoxX[boxSlot];
            a.y = mirrorY(defendBoxY[boxSlot]);
          } else {
            a.x = defendEdgeX[edgeSlot % defendEdgeX.length];
            a.y = mirrorY(defendEdgeY[edgeSlot % defendEdgeY.length]);
          }
        }
        a.tx = a.x;
        a.ty = a.y;
        a.decisionUntil = this.t + 1.1;
        a.fsm = a.team === restartTeam ? "support" : "home";
      } else if (type === "freekick" && fkSetPiece) {
        // —— 人墙任意球摆位：墙/盯区/抢点，其余基准位微调 ——
        if (a.role === "GK") {
          a.x = a.baseX;
          a.y = a.baseY;
        } else if (fkWallPos.has(a.id)) {
          const p = fkWallPos.get(a.id);
          a.x = p.x;
          a.y = p.y;
        } else if (fkDefSlots.has(a.id)) {
          const p = fkDefSlots.get(a.id);
          a.x = p.x;
          a.y = p.y;
        } else if (fkAtkSlots.has(a.id)) {
          const p = fkAtkSlots.get(a.id);
          a.x = p.x;
          a.y = p.y;
        } else {
          a.x = clamp(a.baseX + (x - 50) * 0.15, 4, 96);
          a.y = a.baseY;
        }
        a.tx = a.x;
        a.ty = a.y;
        a.decisionUntil = this.t + 1.2;
        a.fsm = a.team === restartTeam ? "support" : "cover";
      } else if (type === "goalkick") {
        if (a.role === "GK") {
          a.x = a.baseX;
          a.y = a.baseY;
        } else {
          a.x = clamp(a.baseX + (x - 50) * 0.1, 4, 96);
          a.y = a.baseY;
        }
        a.tx = a.x;
        a.ty = a.y;
        a.decisionUntil = this.t + 0.6;
        a.fsm = "home";
      } else {
        // 界外 / 越位等：基准位微调
        if (a.role === "GK") {
          a.x = a.baseX;
          a.y = a.baseY;
        } else {
          a.x = clamp(a.baseX + (x - 50) * 0.15, 4, 96);
          a.y = a.baseY;
        }
        a.tx = a.x;
        a.ty = a.y;
        a.decisionUntil = this.t + 0.6;
        a.fsm = "home";
      }
    }

    // 发球者
    let taker = null;
    if (type === "goalkick") {
      taker = this.agents.find((a) => a.team === restartTeam && a.role === "GK") || null;
    }
    if (type === "corner") {
      taker = cornerTaker;
    }
    if (type === "freekick" && fkTaker) {
      taker = fkTaker;
    }
    if (!taker) taker = this._nearestOf(restartTeam, x, y);
    if (taker) {
      taker.x = x;
      taker.y = clamp(y + dir * 1.2, 1.5, 98.5);
      taker.tx = taker.x;
      taker.ty = taker.y;
      b.owner = taker.id;
      // 角球/人墙任意球：多顿一会儿让观众看清摆位，再开出
      const pause = type === "corner" ? 1.6 : fkSetPiece ? 2.2 : 0.7;
      taker.decisionUntil = this.t + pause;
      taker.protectUntil = this.t + pause + 0.3;
      taker.fsm = "carry";
      if (type === "corner") {
        // 标记角球开球人，决策时强制传中
        taker._cornerTakerUntil = this.t + 3;
      }
      if (type === "freekick" && fkSetPiece) {
        // 主罚计划在摆位时定死（射/传中），_decideOnBall 到时执行
        taker._fkPlan = Math.random() < fkShootP ? "shoot" : "cross";
        taker._fkPlanUntil = this.t + 6;
      }
    }
    this.possession = restartTeam;
    // 角球/人墙任意球死球窗更长，画面上能看清定位球状态
    this.deadBallUntil =
      this.t + (type === "corner" ? 1.8 : fkSetPiece ? 2.0 : 1.0);
    // 人墙任意球复用角球的短窗保形：开球前全员钉在摆位点，不被跑位逻辑拆散
    if (fkSetPiece) this.cornerShapeUntil = this.t + 2.6;
    this._emit(type, taker, { x, y, setPiece: type });
  }

  /**
   * 进球：记分、发事件 → 庆祝聚拢（约 5.5s）→ 再中圈开球（对方开）
   * 避免「入网瞬间整队瞬移回中圈」的观感断层。
   */
  _goal(scoringTeam) {
    const b = this.ball;
    this.score[scoringTeam]++;
    const scorer = b.lastKicker ? this.agentById(b.lastKicker) : null;
    const isPenalty = !!b._penaltyGoal;
    b._penaltyGoal = false;
    const assistId =
      !isPenalty && b._shotAssistId && b._shotAssistId !== scorer?.id
        ? b._shotAssistId
        : null;
    this._emit("goal", scorer, {
      team: scoringTeam,
      score: { ...this.score },
      assistId,
      penalty: isPenalty,
    });

    // 球钉在球门线外/网口（主队进客门 y≈0，客队进主门 y≈100）
    const inTopNet = scoringTeam === "home";
    b.x = clamp(b.x, SIM.GOAL_X0 + 1.2, SIM.GOAL_X1 - 1.2);
    b.y = inTopNet ? 0.8 : 99.2;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.z = 0.15;
    b.owner = null;
    b.state = "dead";
    this._clearBallTarget();
    // 仅脉冲一帧：供 compact 画入网特效；勿长期粘住（否则跳段时在中场误爆迷你球门）
    b._netHitPulse = true;

    // 射手往最近角旗方向冲，队友围拢
    const cornerX = (scorer?.x ?? b.x) < 50 ? 8 : 92;
    this.celebrateCornerX = cornerX;
    this.celebrateTeam = scoringTeam;
    this.celebrateScorerId = scorer?.id || null;
    const celebrationMates = scorer
      ? this.agents
          .filter((a) => a.team === scoringTeam && a.role !== "GK")
          .sort((a, b) => dist(a.x, a.y, scorer.x, scorer.y) - dist(b.x, b.y, scorer.x, scorer.y))
          .slice(0, 5)
      : [];
    this.celebrateParticipants = new Set(celebrationMates.map((a) => a.id));
    celebrationMates.forEach((a, i) => {
      a.celebrateSlot = i;
    });
    this.kickoffTeam = scoringTeam === "home" ? "away" : "home";
    // ~6.2s 庆祝；高光在开球站位硬复位前切出，避免画面瞬移。
    this.celebrateUntil = this.t + 6.2;
    this.deadBallUntil = this.celebrateUntil + 1.2;
    this.possession = scoringTeam;

    for (const a of this.agents) {
      a.vx = 0;
      a.vy = 0;
      a.intent = null;
      a.decisionUntil = this.t + 9;
      if (a.role === "GK") {
        a.tx = a.baseX;
        a.ty = a.baseY;
        a.fsm = "home";
        continue;
      }
      if (a.team === scoringTeam) {
        a.fsm = "support";
        if (scorer && a.id === scorer.id) {
          a.tx = cornerX;
          a.ty = inTopNet ? 5 : 95;
        } else if (this.celebrateParticipants.has(a.id)) {
          // 只让最近的 4 名队友自然跑去庆祝；绝不直接改写当前位置。
          const slot = a.celebrateSlot || 1;
          const side = slot % 2 ? -1 : 1;
          a.tx = clamp((scorer?.x ?? b.x) + side * (3.5 + slot * 0.7), 8, 92);
          a.ty = clamp((scorer?.y ?? b.y) + (slot - 2) * 1.8, 6, 94);
        } else {
          // 后场球员不跨半场瞬移参与庆祝。
          a.tx = a.x;
          a.ty = a.y;
        }
      } else {
        // 失球方：垂头丧气往中场/本半场走
        a.fsm = "home";
        a.tx = clamp(a.baseX * 0.55 + 50 * 0.45 + (Math.random() - 0.5) * 8, 8, 92);
        a.ty = clamp(a.baseY * 0.65 + 50 * 0.35 + (Math.random() - 0.5) * 6, 10, 90);
      }
    }
  }

  /** 庆祝帧：慢速跑向聚拢点，球保持在网内 */
  _tickCelebrate(dt) {
    const team = this.celebrateTeam;
    const scorer = this.celebrateScorerId
      ? this.agentById(this.celebrateScorerId)
      : null;
    const b = this.ball;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.z = 0.15;
    b.owner = null;
    // 钉在进攻球门网口
    if (team === "home") {
      b.y = Math.min(b.y, 1.2);
    } else if (team === "away") {
      b.y = Math.max(b.y, 98.8);
    }
    b.x = clamp(b.x, SIM.GOAL_X0 + 1, SIM.GOAL_X1 - 1);

    const elapsed = Math.max(0, this.celebrateUntil - this.t);
    // 后 1.2s 开始往本方半场回落，衔接下一个开球
    const windDown = elapsed < 1.2;

    for (const a of this.agents) {
      let tx = a.tx ?? a.x;
      let ty = a.ty ?? a.y;
      let spd = 2.2;

      if (a.role === "GK") {
        tx = a.baseX;
        ty = a.baseY;
        spd = 1.6;
      } else if (team && a.team === team) {
        if (scorer && a.id === scorer.id) {
          // 射手：先冲角旗，再在角区小范围晃
          const cx = this.celebrateCornerX || 8;
          const inTop = team === "home";
          if (windDown) {
            tx = clamp(cx * 0.4 + 50 * 0.6, 12, 88);
            ty = inTop ? 22 : 78;
            spd = 3.2;
          } else {
            tx = cx + Math.sin(this.t * 3.1) * 2.5;
            ty = (inTop ? 6 : 94) + Math.cos(this.t * 2.4) * 1.5;
            spd = 5.8;
          }
        } else if (scorer && this.celebrateParticipants?.has(a.id)) {
          // 少量队友分槽靠近射手，不再半瞬移或全部堆成一个圆点。
          const slot = a.celebrateSlot || 1;
          const side = slot % 2 ? -1 : 1;
          tx = clamp(scorer.x + side * (3.8 + slot * 0.65), 8, 92);
          ty = clamp(scorer.y + (slot - 2) * 1.7, 6, 94);
          const d = dist(a.x, a.y, scorer.x, scorer.y);
          spd = d > 18 ? 5.6 : d > 9 ? 4.6 : d > 4 ? 3.2 : 1.4;
          if (windDown) {
            tx = clamp(a.baseX * 0.35 + 50 * 0.65, 10, 90);
            ty = clamp(a.baseY * 0.4 + 50 * 0.6, 12, 88);
            spd = 3.0;
          }
        } else {
          // 非参与者原地轻走；最后阶段再向开球结构回收。
          tx = windDown ? clamp(a.baseX * 0.45 + 50 * 0.55, 10, 90) : a.x;
          ty = windDown ? clamp(a.baseY * 0.5 + 50 * 0.5, 12, 88) : a.y;
          spd = windDown ? 2.6 : 0.8;
        }
      } else {
        // 对方：缓缓回落
        tx = clamp(a.baseX * 0.6 + 50 * 0.4, 8, 92);
        ty = clamp(a.baseY * 0.7 + 50 * 0.3, 12, 88);
        spd = windDown ? 2.8 : 1.8;
      }

      const dx = tx - a.x;
      const dy = ty - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, spd * dt);
      a.x = clamp(a.x + (dx / d) * step, 2, 98);
      a.y = clamp(a.y + (dy / d) * step, 1, 99);
      a.vx = (dx / d) * step;
      a.vy = (dy / d) * step;
      if (d > 0.4) a.heading = Math.atan2(dy, dx);
      a.tx = tx;
      a.ty = ty;
    }
  }

  /** 开球：所有人回基准位，球给指定方中圈球员 */
  _kickoff(team) {
    this.celebrateParticipants = null;
    this.cornerShapeUntil = 0;
    for (const a of this.agents) {
      if (a.sentOff) continue; // 已离场者不回基准位（保持走向边线/场外）
      a.x = a.baseX;
      a.y = a.baseY;
      a.vx = 0;
      a.vy = 0;
      a.intent = null;
      a.fsm = "home";
      a.decisionUntil = this.t + 0.5;
    }
    this.ball.x = 50;
    this.ball.y = 50;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
    this.ball.z = 0;
    this.ball.state = "held";
    this.ball.lastKicker = null;
    this._clearBallTarget();
    this.ball.offsideExemptRestart = false;
    this.ball.restartType = null;
    // 把中圈球员拉来开球
    const near = this._nearestOf(team, 50, 50);
    if (near) {
      near.x = 50;
      near.y = team === "home" ? 52 : 48;
      this.ball.owner = near.id;
      near.decisionUntil = this.t + 0.6;
    }
    this.possession = team;
    this.deadBallUntil = this.t + 0.9; // 死球恢复窗口
  }

  /** 某队离 (x,y) 最近的外场球员 */
  _nearestOf(team, x, y) {
    let best = null;
    let bestD = Infinity;
    for (const a of this.agents) {
      if (a.team !== team || a.role === "GK" || a.sentOff) continue;
      const d = dist(a.x, a.y, x, y);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  // ——————————————————————————————————————————————
  // 结果层：从空间模拟事件直接生成结果
  // ——————————————————————————————————————————————
  /**
   * 直接从空间模拟事件生成结果。进球、射手、助攻和直播帧共享同一事实来源。
   */
  directResult(opts = {}) {
    const tMin = opts.tMin ?? 0;
    const tMax = opts.tMax ?? Infinity;
    const inWindow = (e) => e.t > tMin && e.t <= tMax;
    const rawShots = this.events.filter((e) => e.type === "shot" && inWindow(e));
    const rawGoals = this.events.filter((e) => e.type === "goal" && inWindow(e));
    const result = {
      score: { home: 0, away: 0 },
      shots: { home: 0, away: 0 },
      goals: [],
      rawScore: { home: 0, away: 0 },
      rawShots: { home: 0, away: 0 },
      tMin,
      tMax: Number.isFinite(tMax) ? tMax : null,
    };
    for (const shot of rawShots) {
      if (shot.team === "home" || shot.team === "away") result.shots[shot.team]++;
    }
    for (const goal of rawGoals) {
      if (goal.team !== "home" && goal.team !== "away") continue;
      result.score[goal.team]++;
      result.goals.push({
        team: goal.team,
        minute: clamp(Math.floor(goal.t / 60) + 1, 1, 90),
        scorerId: goal.agentId || null,
        assistId: goal.assistId || null,
        t: goal.t,
      });
    }
    result.rawScore = { ...result.score };
    result.rawShots = { ...result.shots };
    result.goals.sort((a, b) => a.t - b.t);
    return result;
  }

  /*
   * P6 清理：scaledResult()/_sampleIndices()（旧幂律缩放二次转化层）已删除。
   * 正式路径只有 directResult()——比分/射手/助攻与直播帧共享同一事实来源。
   */

  /** 某队门将 agent */
  _teamGk(team) {
    return this.agents.find((a) => a.team === team && a.role === "GK") || null;
  }

  // ——————————————————————————————————————————————
  // 快照：供 matchview 渲染 / 适配层记账
  // ——————————————————————————————————————————————
  snapshot() {
    return {
      t: this.t,
      ball: { x: this.ball.x, y: this.ball.y, z: this.ball.z, owner: this.ball.owner },
      players: this.agents.map((a) => ({
        id: a.id,
        team: a.team,
        role: a.role,
        num: a.num,
        x: a.x,
        y: a.y,
        vx: a.vx,
        vy: a.vy,
        heading: a.heading,
        fsm: a.fsm,
        hasBall: this.ball.owner === a.id,
      })),
    };
  }
}
