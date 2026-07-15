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
// P0–P4：球物理、持球/无球决策、防守、裁判（角球/门球/界外/越位）、scaledResult 平衡
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
  return clamp((v ?? 10) / 20, 0.05, 1);
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
        this._kickoff(side);
      }
      return;
    }

    // 1) 各 agent 决策 → 设定运动目标 / 触发传射
    const owner = this.ball.owner ? this.agentById(this.ball.owner) : null;
    this.possession = owner ? owner.team : this.possession;
    for (const a of this.agents) this._think(a, dt, owner);
    // 2) 积分运动
    for (const a of this.agents) this._integrate(a, dt);
    // 3) 球物理
    this._stepBall(dt);
    // 4) 接管/控球判定
    this._resolvePossession(dt);
    // 5) 裁判规则（P3 填充：越位/出界/进球）——P0 仅做出界夹回
    this._resolveBounds();
    this.t += dt;
  }

  /**
   * 决策分流：持球者 / 无球进攻方 / 防守方 / 门将。
   * 持球者按 decisionUntil 节流（0.25~0.4s 一次），中间沿用上次意图。
   */
  _think(a, dt, owner) {
    if (a.role === "GK") return this._thinkGK(a, owner);

    const b = this.ball;

    // 松球（无人控球，且非死球保护中）：最近的人去抢，其余保持阵型
    if (!owner && this.t >= (this.deadBallUntil || 0)) {
      return this._thinkLoose(a);
    }

    const hasBall = b.owner === a.id;
    const teamHasBall = owner && owner.team === a.team;

    if (hasBall) {
      // 飞行中的球没有 owner，这里 owner===a 一定是脚下控球
      if (this.t >= a.decisionUntil) {
        a.decisionUntil = this.t + 0.25 + Math.random() * 0.18;
        this._decideOnBall(a);
      }
      // 执行上次意图（盘带/护球朝目标带球；传/射在 decide 内瞬时触发）
      if (a.intent && (a.intent.type === "dribble" || a.intent.type === "hold")) {
        a.tx = a.intent.tx;
        a.ty = a.intent.ty;
      }
      return;
    }

    if (teamHasBall) return this._thinkAttackOffBall(a, owner);
    return this._thinkDefend(a, owner);
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

  /** 门将分发：优先找中前场安全的接球人，否则大脚解围到中场边路 */
  _gkDistribute(a) {
    const passTo = this._bestPass(a);
    // 有安全接球人且不太靠后 → 手抛/短传发动进攻
    if (passTo && passTo.value > 0.15) {
      this._pass(a, passTo);
      return;
    }
    // 否则大脚开到中场边路（远离己方球门，打破死循环）
    const dir = this.attackDir(a.team);
    const b = this.ball;
    const targetY = 50 + dir * -8; // 中场略偏己方一侧
    const targetX = Math.random() < 0.5 ? 25 : 75; // 开向边路
    const dx = targetX - b.x;
    const dy = targetY - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const power = clamp(28 + a.attr.kicking * 12, 28, 42);
    b.owner = null;
    b.vx = (dx / d) * power;
    b.vy = (dy / d) * power;
    b.z = 0.4;
    b.vz = 15 + a.attr.kicking * 6; // 大脚解围高吊 peak ~6–8
    b.lastKicker = a.id;
    b.kickTeam = a.team;
    b.kickX = b.x;
    b.kickY = b.y;
    // 门将大脚开球不受越位限制：清空越位快照，避免残留上次传球的旧线导致误判。
    b.offsideLineY = null;
    b.state = "pass";
    a.intent = null;
    this._emit("gk_clear", a);
    a.noReclaimUntil = this.t + 0.5;
    this.deadBallUntil = this.t + 0.55; // 开球保护加长，防门口围抢乒乓
    b.settleUntil = this.t + 0.5;
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
    const goalY = this.targetGoalY(a.team);
    const goalX = 50;
    const dGoal = dist(a.x, a.y, goalX, goalY);
    const dir = this.attackDir(a.team);
    const pressure = this._pressureOn(a); // 0..1，越大越被逼
    const core = !!a.isCore; // 核心：进攻绝对权

    // 死球窗口内（开球/重开后）：只护球，不传射，不给对方逼抢窗口
    if (this.t < (this.deadBallUntil || 0)) {
      a.intent = { type: "hold", tx: a.x, ty: clamp(a.y + dir * 2, 3, 97) };
      a.fsm = "carry";
      return;
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
      const canShoot = this.t >= (a.shotCdUntil || 0);
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
      if (canShoot && shootQuality > shootThresh && shootQuality >= passQuality * (core ? 0.7 : isWing ? 0.78 : 0.85)) {
        a.shotCdUntil = this.t + (core ? 0.9 : isWing ? 1.1 : isMid ? 1.6 : 1.2);
        this._shoot(a);
        return;
      }
      if (passTo && passQuality > (core ? 0.42 : isWing ? 0.34 : 0.3)) {
        this._pass(a, passTo);
        return;
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
      let w = (0.15 + throughPass.value) * (0.35 + 1.1 * flair) * (1 - pressure * 0.4);
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
      this.t >= (a.shotCdUntil || 0);
    if (canLong) {
      let longW =
        (0.06 + 0.5 * a.attr.shooting + 0.18 * a.attr.finishing + 0.12 * a.attr.pace) *
        angF *
        (0.55 + 0.45 * (1 - pressure)) *
        (0.45 + 0.55 * Math.min(1, aheadSpace + 0.35));
      if (isMid) longW *= 1.35;
      if (isWing) longW *= 1.25 + cutInProgress * 0.35; // 内切后远射
      if (core) longW *= 1.5;
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
    const out = [];
    for (const m of this.agents) {
      if (m === a || m.team !== a.team || m.role === "GK") continue;
      const d = dist(a.x, a.y, m.x, m.y);
      if (d < 6 || d > 45) continue; // 太近没必要，太远不可靠
      const myProg = Math.abs(a.y - goalY);
      const mProg = Math.abs(m.y - goalY);
      const advance = clamp((myProg - mProg) / 40, -0.5, 1);
      const safety = this._laneSafety(a, m);
      const distPen = clamp(1 - d / 55, 0.2, 1);
      // 核心球员：队友更愿意把球给他（进攻绝对权）
      const coreBoost = m.isCore ? 1.65 : 1;
      const value = (0.35 + advance) * safety * distPen * coreBoost;

      // —— 直塞识别：接球人处在越位线附近、且其身前（更靠对方球门）有空当 ——
      // 直塞落点打到接球人身前一段，让其反越位插上；风险高（易越位/被断）但收益大。
      let through = false;
      let tx = m.x, ty = m.y;
      const aheadOfBall = (m.y - a.y) * dir > 4; // 接球人比持球者更靠前
      if (aheadOfBall && advance > 0.25) {
        const leadY = clamp(m.y + dir * (6 + Math.random() * 4), 3, 97);
        // 落点未越过越位线太多才算可行直塞
        const okOffside =
          offY == null ||
          (a.team === "home" ? leadY >= offY - 2 : leadY <= offY + 2);
        if (okOffside) {
          through = true;
          ty = leadY;
          tx = clamp(m.x + (50 - m.x) * 0.1, 3, 97);
        }
      }
      out.push({ agent: m, value, through, tx, ty });
    }
    out.sort((p, q) => q.value - p.value);
    return out;
  }

  /** 传球线安全度：线段附近对手越近越危险 → 0..1 */
  _laneSafety(a, m) {
    let minPerp = 99;
    const dx = m.x - a.x;
    const dy = m.y - a.y;
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
    // 越位快照：记录传球瞬间的越位线（倒数第二名防守者 y）+ 进攻方向。
    // 接球时若本方接球人越过此线接球 → 判越位。清空表示本次传球不作越位判定
    // （门将开球/界外球/角球等已在 _restart 里另行处理，不走这里）。
    b.offsideLineY = this._offsideLineY(a.team);
    b.offsideDir = this.attackDir(a.team);
    b.offsidePasser = a.id; // 传球者自己接回不算越位
    b.state = "pass";
    a.intent = null;
    a.fsm = "home";
    this._emit("pass", a, { loft: loft > 2, cross: isCross });
    // 传球后短暂不可立刻被自己接回
    a.noReclaimUntil = this.t + 0.25;
  }

  /** 执行射门：给球高速飞向球门，门将可扑（远射：更吃 shooting、误差更大） */
  _shoot(a) {
    const b = this.ball;
    const goalY = this.targetGoalY(a.team);
    const dGoal = dist(a.x, a.y, 50, goalY);
    const long = dGoal > 22;
    // 近：finishing；远：shooting。远射噪声更大，容易打飞/被扑
    const skill = long
      ? 0.35 * a.attr.finishing + 0.65 * a.attr.shooting
      : 0.7 * a.attr.finishing + 0.3 * a.attr.shooting;
    // 近距：误差缩小（更好的「该进就进」），但绝不强制夹进门框
    let err = (1 - skill) * (long ? 14 : 11) + dGoal * (long ? 0.42 : 0.32);
    if (!long && dGoal < 16) err *= 0.72;
    if (!long && dGoal < 11) err *= 0.78;
    // 门将明显失位时略准一点（空门感），仍允许打飞
    const defGk = this.agents.find(
      (g) => g.role === "GK" && g.team !== a.team
    );
    if (defGk && dGoal < 18) {
      const gkCover = Math.abs(defGk.x - clamp(a.x, 30, 70));
      if (gkCover > 9) err *= 0.7;
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
    b.owner = null;
    b.vx = (dx / d) * power;
    b.vy = (dy / d) * power;
    // 射门弧线：远射抽射更高，近射低平
    b.z = 0.25;
    b.vz = long ? 10 + Math.random() * 4 : 5 + Math.random() * 3;
    b.lastKicker = a.id;
    b.kickTeam = a.team;
    b.state = "shot";
    b._saveChecked = false; // 新射门允许门将掷一次扑救骰
    b._blockChecked = false;
    a.intent = null;
    a.fsm = "home";
    this._emit("shot", a, { long: !!long, role: a.role });
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
        // 落点：球前侧前方一点，略靠中（为内切留出通道），不锁死边线
        const pocketX = clamp(
          b.x + wingSide * (8 + Math.random() * 7) * 0.35 + wingSide * 10,
          wingSide < 0 ? 10 : 45,
          wingSide < 0 ? 55 : 90
        );
        // 再向中路收一点，方便接球后直接内切
        const softIn = clamp(pocketX * 0.65 + 50 * 0.35, 14, 86);
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
          a.baseX < 40 ? -1 : a.baseX > 60 ? 1 : a.x < b.x ? -1 : 1;
        const depth = 11 + burst * 10 + (advanced ? 4 : 0) + (core ? 3 : 0);
        a.tx = clamp(
          b.x + side * (5 + Math.random() * 9) + (a.baseX - 50) * 0.15,
          8,
          92
        );
        a.ty = clamp(b.y + dir * depth, 6, 94);
        a.fsm = "support";
        this._clampOffside(a);
        return;
      }

      if (dBall < 28) {
        const side = a.x < b.x ? -1 : 1;
        a.tx = clamp(b.x + side * (7 + Math.random() * 6), 5, 95);
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

  /** 越位自律：不越过倒数第二名防守者（P1 粗版，P3 精确判定） */
  _clampOffside(a) {
    const offY = this._offsideLineY(a.team);
    if (offY == null) return;
    if (a.team === "home" && a.ty < offY) a.ty = offY; // 主队朝 y 小进攻
    if (a.team === "away" && a.ty > offY) a.ty = offY;
  }

  /** 本队离球最近的前锋？（用于指派“回撤支点”的那一个） */
  _isNearestForwardToBall(a) {
    if (a.role !== "ATT") return false;
    const dMe = dist(a.x, a.y, this.ball.x, this.ball.y);
    for (const o of this.agents) {
      if (o === a || o.team !== a.team || o.role !== "ATT") continue;
      if (o.el?.classList?.contains?.("sent-off")) continue;
      if (dist(o.x, o.y, this.ball.x, this.ball.y) < dMe) return false;
    }
    return true;
  }

  /**
   * 防守方跑位（P2）：
   *  · 最近者上抢——站到持球人与己方球门之间（封堵推进线，而非扑向脚下），
   *    贴身后触发卡位减速（在 _integrate 里读 pressedBy）
   *  · 次近者补位——盯防最危险的接球点（离球门近的无球进攻者）
   *  · 其余——回防线 Y，横向随球压缩，保持整体性
   */
  _thinkDefend(a, owner) {
    const b = this.ball;
    const ownGoalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
    const rank = this._defBallRank(a); // 0=最近 1=次近 ...

    if (owner && rank === 0) {
      // 上抢者：站到"球→己方球门"连线上、略靠球一侧，逼停并封堵推进。
      // 越靠近己方球门（禁区内），站位越贴身——真正逼停持球人、压缩其射门空间，
      // 让前锋无法轻松捅到门前近距离（这是把射门距离推回真实区间的关键）。
      const gx = 50, gy = ownGoalY;
      const bx = b.x, by = b.y;
      const vx = gx - bx, vy = gy - by;
      const len = Math.hypot(vx, vy) || 1;
      // 球离己方球门越近，standoff 越小（禁区内贴到 0.8，中场保持 2.4）
      const dBallGoal = dist(bx, by, gx, gy);
      const standoff = clamp(0.8 + dBallGoal / 30 * 1.6, 0.8, 2.4);
      a.tx = clamp(bx + (vx / len) * standoff, 3, 97);
      a.ty = clamp(by + (vy / len) * standoff, 3, 97);
      a.fsm = "press";
      return;
    }

    if (owner && rank === 1) {
      // 次近者：盯防最危险的接球点（对方离我方球门最近的无球人），站其内侧
      const mark = this._mostDangerousReceiver(owner.team);
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

    // 中场拦截（rank 2/3）：不再干站着，主动封堵推进/拦截传球线。
    // 这是把"三区进入波次"从 ~650 压到真实 ~50 的核心——大部分进攻在中场
    // 就被断掉、逼回，而不是轻松穿过。只有离球较近的中前场人参与，避免防线散架。
    if (owner && (rank === 2 || rank === 3)) {
      const dBall = dist(a.x, a.y, b.x, b.y);
      // 只有在中前场、且离球不太远时才主动上抢拦截（后场交给防线站位）
      const midField = a.role !== "DEF";
      if (midField && dBall < 22) {
        // 扑向"持球人身前"的拦截点：切断其向前推进/传球的线路
        const dir = this.attackDir(owner.team); // 进攻方推进方向
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
    const toward = 0.3 + central * 0.45;
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
      // 预测球的落点（简单外推），朝落点冲
      const lead = 0.4;
      a.tx = clamp(b.x + b.vx * lead, 3, 97);
      a.ty = clamp(b.y + b.vy * lead, 3, 97);
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
    const layer = a.role === "DEF" ? 20 : a.role === "MID" ? 38 : 55;
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

  /** 惯性移动：arrive + 加速度上限（与 matchview 表演层同源，保证观感一致） */
  _integrate(a, dt) {
    let speed = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * a.attr.pace);
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
        b.vz = Math.abs(b.vz) * 0.28; // 轻弹
        if (b.vz < 1.2) b.vz = 0;
        // 落地略减速
        b.vx *= 0.88;
        b.vy *= 0.88;
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
    // 旧版：半径过大 + 成功率 0.92 + 不看球路 → 鬼扑。
    // 中间版：半径过小 + 10Hz 高速球跳过判定圈 → 几乎不扑、进球爆炸。
    // 现版：用「本帧球轨迹线段」到门将的最短距离判定是否可扑；每脚射门只掷一次。
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
        // 可扑范围：约 4.5–6.5（旧版定点半径可到 8+ 且无视球路）
        // 必须球路擦过门将（轨迹线段），不能站着吸远处的球
        const reach = 3.4 + 3.0 * ref + Math.min(1.6, speed * 0.035);
        if (dPath > reach) continue;

        // 球已明显越过门将且偏出 → 无法回头捞
        const pastGk =
          gk.team === "home" ? cy > gk.y + 2.5 : cy < gk.y - 2.5;
        if (pastGk && lateral > 2.8) continue;

        b._saveChecked = true; // 本脚射门只判定一次

        const dGoal = Math.abs(cy - goalY);
        const cover = clamp(1 - dPath / reach, 0, 1);
        // 路线正确：中等偏上扑救率；路线偏/空门明显扑不到（修鬼扑，不炸进球）
        let pSave =
          0.42 +
          0.38 * cover +
          0.3 * ref +
          0.1 * hand -
          speed / 125 -
          lateral * 0.025;
        if (dGoal < 10) pSave *= 0.72;
        else if (dGoal < 14) pSave *= 0.9;
        // 空门：横向远离射门落点 → 大幅降扑救
        if (lateral > 6.5 && dGoal < 18) pSave *= 0.12;
        else if (lateral > 5 && dGoal < 15) pSave *= 0.32;
        pSave = clamp(pSave, 0.12, 0.9);

        if (Math.random() < pSave) {
          b.owner = gk.id;
          b.x = cx;
          b.y = cy;
          b.vx = 0;
          b.vy = 0;
          b.z = 0;
          b.vz = 0;
          b.state = "held";
          gk.x = gk.x + (cx - gk.x) * 0.45;
          gk.y = gk.y + (cy - gk.y) * 0.45;
          gk.protectUntil = this.t + 1.4;
          gk.decisionUntil = this.t + 0.7;
          b.settleUntil = this.t + 0.9;
          this.deadBallUntil = this.t + 0.75;
          this._emit("save", gk);
          return;
        }
        // 未扑住：轻微变向
        if (Math.random() < 0.12) {
          b.vx += (Math.random() - 0.5) * 3.2;
          b.vy *= 0.95;
        }
        break; // 已判定本脚，不再换门将
      }
    }

    // —— 全局球权稳定锁：任何球权转换后短暂锁定，期间不可再易主 ——
    // 这是根治"贴身缠斗中球权亚秒级反复易主"（抢断乒乓 + 传球乒乓）的关键：
    // 每次球权转换都上一个缓冲垫，杜绝两名贴身球员来回夺球。
    if (this.t < (b.settleUntil || 0)) return;

    // —— 飞行传球拦截：路径附近的对手主动断球（中场绞杀的核心）——
    // 之前只有球飞到对手脚下 2.6 内才可能被接管，中场传球从空隙穿过、几乎不被拦，
    // 导致球轻松穿越中场、三区进入频率高达真实的 ~11 倍。这里让飞行中的传球，
    // 只要有对手足够贴近球的当前位置，就按 tackling/positioning 概率抢截下来。
    if (b.state === "pass" && !b.owner) {
      const flown = (b.kickX != null) ? dist(b.x, b.y, b.kickX, b.kickY) : 999;
      if (flown >= 6) { // 传球早段仍受保护（防贴脸截断/乒乓），飞出一段后才可拦
        for (const o of this.agents) {
          if (o.team === b.kickTeam || o.role === "GK") continue;
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
              o.decisionUntil = this.t + 0.6 + Math.random() * 0.35;
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
      for (const o of this.agents) {
        if (o.team === owner.team || o.role === "GK") continue;
        // 抢断尝试冷却：同一人不能每 tick 都掷骰子（根治抢断爆炸）
        if (this.t < (o.tackleCdUntil || 0)) continue;
        const d = dist(o.x, o.y, b.x, b.y);
        if (d < SIM.CONTROL_RADIUS + 0.4) {
          o.tackleCdUntil = this.t + 0.5; // 一次尝试后冷却 0.5s
          // 抢断成功率：tackling vs 持球者 dribbling+strength（单次尝试，不再乘 tick）
          const atk = 0.5 * owner.attr.dribbling + 0.3 * owner.attr.strength;
          const def = 0.6 * o.attr.tackling + 0.2 * o.attr.marking;
          // 基线抬高（P1 太低拦不住）；持球人正高速带球更易被断（重心不稳）
          const ownerSpeed = Math.hypot(owner.vx, owner.vy);
          const moveVuln = clamp(ownerSpeed / SIM.MAX_PLAYER_SPEED, 0, 1) * 0.15;
          const p = clamp(0.4 + (def - atk) * 0.7 + moveVuln, 0.08, 0.85);
          if (Math.random() < p) {
            b.owner = o.id;
            b.vx = 0;
            b.vy = 0;
            b.state = "held";
            b.settleUntil = this.t + 0.7; // 球权稳定锁：抢断后短暂不可再易主
            // settle：抢到后先护/带一下再决策，避免抢断→立刻回传的乒乓
            o.decisionUntil = this.t + 0.6 + Math.random() * 0.35;
            o.intent = this._forwardDribbleIntent(o);
            o.fsm = "carry";
            o.protectUntil = this.t + 0.75; // 抢到后护球窗口（略长于 settle，接球从容不慌）
            // 被抢者：设追抢冷却 + 轻微后撤，避免"贴身原地互抢"的乒乓循环。
            // 真实里丢球方会先失位、退一步再重新组织逼抢，不会瞬间贴脸抢回。
            owner.tackleCdUntil = this.t + 1.1;
            owner.protectUntil = 0;
            const bk = this.attackDir(owner.team); // 丢球者朝己方向后撤一点
            owner.tx = clamp(owner.x - bk * 4, 3, 97);
            owner.ty = clamp(owner.y + bk * 4, 3, 97);
            this._emit("tackle", o, { from: owner.id });
            return;
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

    let best = null;
    let bestD = SIM.CONTROL_RADIUS + speed * 0.04;
    for (const a of this.agents) {
      if (a.id === b.lastKicker && this.t < (a.noReclaimUntil || 0)) continue;
      if (oppBlocked && a.team !== b.kickTeam) continue;
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
    if (best && best.role !== "GK" && speed < 6) {
      const nearGk = this.agents.find((g) => {
        if (g.role !== "GK" || g.team === best.team) return false;
        const inSix =
          g.team === "home"
            ? b.y > 88 && b.x > 30 && b.x < 70
            : b.y < 12 && b.x > 30 && b.x < 70;
        return inSix && dist(g.x, g.y, b.x, b.y) < SIM.CONTROL_RADIUS + 1.2;
      });
      if (nearGk) best = nearGk;
    }

    if (best) {
      // —— 越位判罚 ——
      if (
        b.state === "pass" &&
        best.team === b.kickTeam &&
        best.id !== b.lastKicker &&
        b.offsideLineY != null &&
        best.role !== "GK"
      ) {
        const off = b.kickTeam === "home"
          ? best.y < b.offsideLineY - 0.5
          : best.y > b.offsideLineY + 0.5;
        if (off) {
          this._emit("offside", best, { team: b.kickTeam });
          const defTeam = b.kickTeam === "home" ? "away" : "home";
          this._restart("offside", defTeam, clamp(best.x, 6, 94), clamp(best.y, 6, 94));
          return;
        }
      }
      // 接管成功率：球越快越难控
      let ctl = 0.55 + 0.4 * best.attr.dribbling;
      if (best.role === "GK") ctl = 0.7 + 0.25 * (best.attr.handling || 0.5);
      const p = clamp(ctl - speed / 90, 0.15, 0.98);
      if (Math.random() < p) {
        b.owner = best.id;
        b.vx = 0;
        b.vy = 0;
        b.z = 0;
        b.vz = 0;
        b.state = "held";
        b.offsideLineY = null;
        b._saveChecked = false;
        best.decisionUntil = this.t + 0.6 + Math.random() * 0.35;
        best.intent = best.role === "GK" ? null : this._forwardDribbleIntent(best);
        best.fsm = best.role === "GK" ? "home" : "carry";
        // 门将拿球护球更长，杜绝前锋贴脸抢回造成「互传」
        best.protectUntil = this.t + (best.role === "GK" ? 1.3 : 0.7);
        b.settleUntil = this.t + (best.role === "GK" ? 0.85 : 0.45);
      } else {
        // 没控住：把球磕开，避免原地互抢
        const away = best.role === "GK" ? 1 : -1;
        const dir = this.attackDir(best.team);
        b.vx = (Math.random() - 0.5) * 8;
        b.vy = dir * away * (4 + Math.random() * 5);
        b.state = "loose";
      }
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
    if (b.y <= 0) {
      // 客队球门线：门框内且是主队打进 → 进球
      if (b.x > SIM.GOAL_X0 && b.x < SIM.GOAL_X1) return this._goal("home");
      // 门框外出底线：谁最后碰的决定门球/角球
      if (kickTeam === "home") return this._restart("corner", "home", b.x < 50 ? 2 : 98, 4);
      return this._restart("goalkick", "away", 50, 12);
    }
    if (b.y >= 100) {
      if (b.x > SIM.GOAL_X0 && b.x < SIM.GOAL_X1) return this._goal("away");
      if (kickTeam === "away") return this._restart("corner", "away", b.x < 50 ? 2 : 98, 96);
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
   * @param {"corner"|"goalkick"|"throwin"} type
   */
  _restart(type, restartTeam, x, y) {
    const b = this.ball;
    b.x = x;
    b.y = y;
    b.vx = 0;
    b.vy = 0;
    b.owner = null;
    b.state = "held";
    b.lastKicker = null;

    // 站位重置：把双方从"门口一团"拉回各自合理位置，围绕重启点重新展开
    const dir = this.attackDir(restartTeam); // 重启方进攻方向
    for (const a of this.agents) {
      a.vx = 0;
      a.vy = 0;
      a.intent = null;
      a.tackleCdUntil = 0;
      // 以阵型基准位为骨架，朝重启点方向轻微收拢（避免瞬移感太强，只调目标不硬拽全员）
      if (a.role === "GK") {
        a.x = a.baseX;
        a.y = a.baseY;
      } else {
        // 门球时重启方压上接球、防守方回收；角球时进攻方涌入禁区
        a.x = clamp(a.baseX + (x - 50) * 0.15, 4, 96);
        a.y = a.baseY;
      }
      a.decisionUntil = this.t + 0.6;
      a.fsm = "home";
    }

    // 发球者：重启方最近球员到球位
    let taker = null;
    if (type === "goalkick") {
      taker = this.agents.find((a) => a.team === restartTeam && a.role === "GK") || null;
    }
    if (!taker) taker = this._nearestOf(restartTeam, x, y);
    if (taker) {
      taker.x = x;
      taker.y = clamp(y + dir * 1.5, 2, 98);
      b.owner = taker.id;
      taker.decisionUntil = this.t + 0.7; // 发球前顿一下
      taker.protectUntil = this.t + 1.0; // 发球者护球窗口
    }
    this.possession = restartTeam;
    this.deadBallUntil = this.t + 1.0; // 死球恢复窗口，彻底离开门口再恢复逼抢
    this._emit(type, taker);
  }

  /**
   * 进球：记分、发事件 → 庆祝聚拢（约 5.5s）→ 再中圈开球（对方开）
   * 避免「入网瞬间整队瞬移回中圈」的观感断层。
   */
  _goal(scoringTeam) {
    const b = this.ball;
    this.score[scoringTeam]++;
    const scorer = b.lastKicker ? this.agentById(b.lastKicker) : null;
    this._emit("goal", scorer, { team: scoringTeam, score: { ...this.score } });

    // 球钉在球门线外/网口（主队进客门 y≈0，客队进主门 y≈100）
    const inTopNet = scoringTeam === "home";
    b.x = clamp(b.x, SIM.GOAL_X0 + 1.2, SIM.GOAL_X1 - 1.2);
    b.y = inTopNet ? 0.8 : 99.2;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.z = 0;
    b.owner = null;
    b.state = "dead";

    // 射手往最近角旗方向冲，队友围拢
    const cornerX = (scorer?.x ?? b.x) < 50 ? 8 : 92;
    this.celebrateCornerX = cornerX;
    this.celebrateTeam = scoringTeam;
    this.celebrateScorerId = scorer?.id || null;
    this.kickoffTeam = scoringTeam === "home" ? "away" : "home";
    // ~6.2s 庆祝；高光窗 t+16 能完整盖住庆祝+开球过渡
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
        } else {
          // 先半拉近射手（后场的人否则 5 秒跑不拢），再朝角旗围拢
          const ox = (Math.random() - 0.5) * 12;
          const oy = (Math.random() - 0.5) * 9;
          const sx = scorer?.x ?? b.x;
          const sy = scorer?.y ?? (inTopNet ? 12 : 88);
          const pull = a.role === "DEF" ? 0.72 : 0.55;
          a.x = clamp(a.x * (1 - pull) + sx * pull + ox * 0.3, 4, 96);
          a.y = clamp(a.y * (1 - pull) + sy * pull + oy * 0.3, 3, 97);
          a.tx = clamp(sx * 0.4 + cornerX * 0.6 + ox, 6, 94);
          a.ty = clamp(sy * 0.4 + (inTopNet ? 7 : 93) * 0.6 + oy, 4, 96);
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
    b.z = 0;
    b.owner = null;

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
            spd = 5.2;
          }
        } else if (scorer) {
          // 队友全力围拢射手（更激进，保证画面能看到「一堆人」）
          const ox = ((a.num || 1) % 7) - 3;
          const oy = ((a.num || 1) % 5) - 2;
          tx = clamp(scorer.x + ox * 1.8, 5, 95);
          ty = clamp(scorer.y + oy * 1.5, 4, 96);
          const d = dist(a.x, a.y, scorer.x, scorer.y);
          spd = d > 22 ? 6.8 : d > 10 ? 5.2 : d > 4 ? 3.2 : 1.4;
          if (windDown) {
            tx = clamp(a.baseX * 0.35 + 50 * 0.65, 10, 90);
            ty = clamp(a.baseY * 0.4 + 50 * 0.6, 12, 88);
            spd = 3.0;
          }
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
    for (const a of this.agents) {
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
      if (a.team !== team || a.role === "GK") continue;
      const d = dist(a.x, a.y, x, y);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  // ——————————————————————————————————————————————
  // 结果缩放层（Route A）：把引擎的"快节奏原始输出"映射到真实量级
  // ——————————————————————————————————————————————
  /**
   * 引擎为了跑出自然的空间博弈，节奏约是真实的 4-5 倍（每场 ~100 射、~650 次
   * 三区进入）。直接用原始进球会离谱。这里不是粗暴"乘系数"，而是做子采样 + xG 式转化：
   *
   *   1) 原始射门（含射手/时间/位置）按目标场均射门数(TARGET_SHOTS)子采样，
   *      保留的每一脚都是引擎真实涌现的机会（射手、分钟、位置全真）。
   *   2) 每个被保留的射门按 xG 式概率转化为进球：基于射手 finishing + 射门位置质量，
   *      再受对方门将 reflexes 抑制。→ 强队射手多、把握好，进球自然更多，强弱差异保留。
   *   3) 控球/传球等统计同步按比例缩放，保持自洽。
   *
   * 返回结构与旧概率引擎兼容：{ score, shots, goals:[{team,minute,scorerId}], ... }
   * 供 match.js 适配层翻译成现有 event 结构（P5）。
   *
   * @param {object} [opts]
   * @param {number} [opts.targetShotsPerTeam=13] 目标场均每队射门
   * @param {function} [opts.rng=Math.random]
   */
  scaledResult(opts = {}) {
    // 目标场均每队射门（真实约 12-14）；作为"两队原始射门均值"映射的锚点。
    // 半场窗口可用 targetShotsPerTeam≈6.5 或靠 tMin/tMax 自动减半。
    const tMin = opts.tMin ?? 0;
    const tMax = opts.tMax ?? Infinity;
    const windowSec =
      Number.isFinite(tMax) && Number.isFinite(tMin) ? Math.max(1, tMax - tMin) : 90 * 60;
    const defaultTarget = windowSec <= 50 * 60 ? 7 : 13;
    const targetShots = opts.targetShotsPerTeam ?? defaultTarget;
    const rng = opts.rng || Math.random;

    // 原始射门事件（可按时间窗过滤，供半场结算 / 适配层）
    const rawShots = this.events.filter(
      (e) => e.type === "shot" && e.t >= tMin && e.t <= tMax
    );
    const bySide = { home: [], away: [] };
    for (const s of rawShots) {
      if (s.team === "home" || s.team === "away") bySide[s.team].push(s);
    }

    const result = {
      score: { home: 0, away: 0 },
      shots: { home: 0, away: 0 },
      goals: [], // [{ team, minute, scorerId, t }]
      rawScore: { ...this.score },
      rawShots: { home: bySide.home.length, away: bySide.away.length },
      tMin,
      tMax: Number.isFinite(tMax) ? tMax : null,
    };

    // 缩放：两队原始射门均值锚定到 targetShots。但不做线性比例——
    // 线性会把原始 24:2 这种悬殊比例原样放大成碾压。改用【幂律压缩】：
    // 每队目标射门 = targetShots × (本队原始/均值)^COMPRESS。
    // COMPRESS<1 收敛强弱差距（0.5 即开平方），让 24:2 → 约 16:9 的真实差距，
    // 强队仍明显占优、弱队也有还手之力，不再碾压。
    const COMPRESS = 0.5;
    const rawAvg = (bySide.home.length + bySide.away.length) / 2 || 1;

    for (const team of ["home", "away"]) {
      const shots = bySide[team];
      if (!shots.length) continue;
      // 幂律压缩后的该队目标射门数
      const ratio = shots.length / rawAvg;
      const scaled = targetShots * Math.pow(ratio, COMPRESS);
      let keep = Math.floor(scaled) + (rng() < (scaled % 1) ? 1 : 0);
      keep = clamp(keep, 0, shots.length);
      if (!keep) continue;
      const idx = this._sampleIndices(shots.length, keep, rng);
      result.shots[team] = keep;
      const gk = this._teamGk(team === "home" ? "away" : "home");
      const gkSave = gk ? gk.attr.reflexes : 0.5;
      for (const i of idx) {
        const s = shots[i];
        const shooter = s.agentId ? this.agentById(s.agentId) : null;
        const fin = shooter ? shooter.attr.finishing : 0.5;
        // xG 式转化率：基线 ~0.11，finishing 提升、对方门将抑制
        const p = clamp(0.06 + 0.16 * fin - 0.06 * gkSave, 0.02, 0.4);
        if (rng() < p) {
          result.score[team]++;
          result.goals.push({
            team,
            minute: Math.max(1, Math.min(90, Math.round((s.t / (90 * 60)) * 90))) || 1,
            scorerId: s.agentId || null,
            t: s.t,
          });
        }
      }
    }
    result.goals.sort((a, b) => (a.t ?? a.minute) - (b.t ?? b.minute));
    return result;
  }

  /** 从 n 个中不重复抽取 k 个下标（升序返回），保留时间顺序 */
  _sampleIndices(n, k, rng = Math.random) {
    if (k >= n) return Array.from({ length: n }, (_, i) => i);
    const picked = new Set();
    while (picked.size < k) picked.add(Math.floor(rng() * n));
    return [...picked].sort((a, b) => a - b);
  }

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
