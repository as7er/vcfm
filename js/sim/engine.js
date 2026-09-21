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
// P5：match.js 经 sim/adapt.js 接入用户场
// v201：AI 后台通过无画面性能档运行同一空间因果

import { FORMATIONS } from "./../data.js";
import {
  getLineupPlayers,
  assignPlayersToFormationSlots,
  getCorePlayerId,
  getSlotRole,
  getSlotDuty,
  ensureTactics,
  ensureLineupRoles,
  ensureCorePlayer,
  ensureLineupResponsibilities,
  ensureFootballProfile,
  getCaptainId,
  getSetPieceTakerId,
} from "./../models.js";
import { positionCoverage } from "../player-positions.js";
import { buildCornerRoutine, cornerDelivery, cornerMovementTarget } from "../corner-routines.js";
import { roleBehavior } from "../player-roles.js";
import {
  TEAM_SHAPE_PHASES,
  explicitShapeFormationId,
  shapeFormationId,
  shapeFormationSlotMap,
  teamShapePhase,
  teamShapeProfile,
} from "../team-shapes.js";
import {
  angleDelta,
  ballActionPreparation,
  bodyControlProfile,
  firstTouchPlan,
  moveAngleToward,
  shieldingMomentumAdjustment,
} from "../player-control.js";
import {
  EDGE_RESTART_TYPES,
  VAR_INCIDENTS,
  advantageDecision,
  backpassViolation,
  forwardProgress,
  goalkeeperBackpassControl,
  handballContactDecision,
  penaltyOnFieldDecision,
  varReviewDecision,
} from "../edge-rules.js";
import {
  PRESS_TRIGGER_KINDS,
  collectiveDefenseProfile,
  defensiveAwarenessProfile,
  pressingTrigger,
  shouldHandoffMark,
  weakSideTargetX,
} from "../collective-defense.js";
import {
  OFF_BALL_TARGET_DEFAULTS,
  resolveOffBallTarget,
} from "../off-ball-movement.js";
import { estimateShotXg } from "./../match-analysis.js";
import {
  PENALTY_RUN_SEC,
  PENALTY_KICK_SEC,
  PENALTY_RESOLVE_SEC,
  simMinuteOf,
} from "./../match-presentation.js";

// ————————————————————————————————————————————————————————————
// 常量与工具
// ————————————————————————————————————————————————————————————

export const SIM = {
  DT: 0.1, // 固定步长（秒），10Hz
  FIELD_W: 100,
  FIELD_H: 100,
  // 标准职业球场约 68m × 105m。空间坐标仍保持 0..100，但物理距离和
  // 球速必须先换算成米，否则同样距离的横向与纵向动作会得到不同结果。
  PITCH_W_METRES: 68,
  PITCH_H_METRES: 105,
  // 进攻时中卫线随球整体前压的最大距离（米），以「标准防线」级 3 为基准。
  // 真实球队是一个整体平移的块：球推进到进攻三区时后卫线会越过中线。此前中卫线的
  // 纵向目标是常量、完全不跟球，导致队形冻结在静态模板长度上。
  // 实际前压量再乘以防线高度因子（见 CB_BLOCK_SHIFT_LINE_GAIN）。
  // 详见 docs/attack-block-shift-diagnosis-2026-09-14.md。
  CB_BLOCK_SHIFT_MAX_M: -19,
  // 防线高度每偏离标准级 1 级，前压量的增减比例。0.35 → 防线 1 级乘数 0.30、
  // 3 级 1.00、5 级 1.70。delegation.js 已按实力差给强队 ≥4、弱队 ≤2，
  // 所以这个因子让强队压上、弱队回收，而不是两队共用一个常数。
  CB_BLOCK_SHIFT_LINE_GAIN: 0.35,
  // 尾部加权（2026-09-15）：前压量对 `prog` 的响应在中场保持线性，只有球被压进
  // 对方半场深处时才陡增：
  //     blockCurve = prog > TAIL_FROM ? prog + (prog - TAIL_FROM) * TAIL_GAIN : prog
  //
  // 为什么需要它：`CB_BLOCK_SHIFT_MAX_M` 线性于 `prog`，整体抬高会连中场块一起抬，
  // 反击暴露随之上升，强弱分离被摊薄（探针阶梯：-14 → 强队 1.92、-19 → 1.67、
  // -26 → 1.46，门槛 1.5）。而队形拉长**只发生在进攻三区**，所以只需要在最深处加量。
  //
  // 实测（标准档同种子，48 场；形状取 4 场中位）：
  //     配置      attack   span   后卫线   进球48  强弱分离48
  //     未修      47.38   44.70   49.69    2.73    1.92
  //     尾部1.5   41.08   40.25   53.44    2.67    2.04
  // 目标区间 30–40 m（AGENTS.md 的 FM26 对照）；信封无代价，分离度略升。
  // 尾部 2.0 能进区间（39.08/38.96）但强弱分离掉到 1.52（擦线），故取 1.5。
  // 详见 docs/cb-block-tail-2026-09-15.md。
  CB_BLOCK_TAIL_FROM: 0.7,
  CB_BLOCK_TAIL_GAIN: 1.5,
  // 球门：主队球门在 y≈100 一侧，客队球门在 y≈0 一侧；门宽以 x 计
  GOAL_X0: 44,
  GOAL_X1: 56,
  HOME_GOAL_Y: 100, // 主队防守的球门线
  AWAY_GOAL_Y: 0, // 客队防守的球门线
  // 球物理
  BALL_FRICTION: 0.96, // 每步地面滚动速度衰减
  CONTROL_RADIUS_METRES: 2.6,
  // 球员积分仍使用场地百分比/秒；接触与球速判定通过上方尺寸换算为米制。
  MAX_PLAYER_SPEED: 6, // 顶级 pace 的最大移动速度（%/秒）；对齐真实纵穿全场约 14s
  // 非穿透求解器的身体最小间距，**单位是场地格**，而 `_separateAgents` 里的距离是
  // `Math.hypot(dx, dy)`——对格数取模。x 一格 0.68m、y 一格 1.05m，所以这条下限在
  // 真实空间里是个**椭圆**：
  //     横向（沿边线）      2.85 × 0.68 = **1.94 m**
  //     纵向（沿球门方向）  2.85 × 1.05 = **2.99 m**
  //
  // ⛔ **这不是可以随手抹平的笔误，两条半轴都是载荷。** 2026-09-03 实测（改成
  //    各向同性的米制、24 场标定，见 AGENTS.md「`_separateAgents` 混单位」那节）：
  //      各向同性 1.94m  进球 **2.29**（护栏 2.5~3.3）、转化率 **7.9%**（护栏 9~15）、
  //                      直塞 **0.25**（下限 0.5）——纵向下限从 2.99 掉到 1.94，
  //                      防守者可以坐进纵向传球线里，进攻产出整条塌掉。
  //      各向同性 1.10m  进球 3.04、转化率 10.8% 都好看，但**强弱分离塌了**：
  //                      强队 1.79 → **1.29** 分/场、净胜球 +12 → **−4**、直塞 0.21。
  //                      身体能贴到 1.1m 时弱队光靠贴身就能捂住强队。
  //    也就是说**引擎的进攻产出依赖纵向那 2.99m，而贴身防守被同一个数挡着**
  //    （实测最近防守者距离中位 2.76~2.83m 正好压在 2.99m 上）。
  //    要动它必须**同时**补上进攻产出（把球打到防线身后那条路，见「主线」一节），
  //    不能单改。参数化在这里就是为了让那次配对可以直接扫它，而不用再改一遍代码。
  SEPARATION_MIN_DISTANCE_UNITS: 2.85,
  // 控球时间轴采样间隔（模拟秒）：直播按此还原截至当前画面的控球率
  POSS_SAMPLE_SEC: 15,
  // 点球分阶段时长（模拟秒），与表现层共用同一组时序：
  // 界面的判罚文案和镜头停顿据此推导，才不会在球还没踢出时就被扑救文案顶掉。
  PENALTY_RUN_SEC, // 判罚 → 开始助跑
  PENALTY_KICK_SEC, // 判罚 → 出脚
  PENALTY_RESOLVE_SEC, // 判罚 → 进球/扑救结算

  /** A2（2026-09-20）：`drop` 分支纵向锚的「球位权重」。
   *
   *  背景（`docs/offball-upstream-target-flip-2026-09-16.md`）：`_chooseAttackOffBallTarget`
   *  的 ATT/MID `drop` 分支锚在**球位**，`else`/前插分支锚在**固定阵型位**，
   *  两锚相距可达 **74 m**，由 `this.random() < p` 每 0.42~1.32 s 重掷 ⇒ 目标点
   *  来回翻转 ⇒ 画面瞬移（实测锚点翻转使「大跳 >=15m」概率提升 **10.4 倍**）。
   *
   *  A2 = 在两条分支之间取折中：
   *      ty = lerp(baseY, b.y + dir*dropDepth, A2_ANCHOR_BLEND)
   *  与 `:5374` 防守跑位早就在用的 `baseY + (b.y - baseY) * pull` **同族**。
   *
   *  **取 0.65 的理由**：球位仍占主导 ⇒ 回撤深度基本保留（回撤是「回撤要球」
   *  这个行为本身，砍掉它就等于删功能）；同时把 74 m 的锚点间距压到
   *  `1 - 0.65 = 35%`（约 26 m），足以让两条分支的目标点不再天差地别。
   *
   *  ⚠ 这是**标准档行为改动**（改位置 ⇒ 下游决策路径随之改变），
   *  不是「默认关闭的可选行为」。落地前必须跑全量 `verify.mjs` +
   *  进球/射门护栏复核。设 1 即恢复「纯球位锚」（原行为）。 */
  A2_ANCHOR_BLEND: 0.65,
};

/**
 * 主动突破原语的参数（`opts.beatPrimitive === true` 时才使用）。
 *
 * 取值来自**探针侧标定**（引擎零改动、离线算 p 的 6 组参数扫描 +
 * 24 场复核，五项指标全部落在真实足球带内）：
 *   · 单队尝试 18.4/场（真实 ~17）
 *   · 成功率 52.2%（真实 47~52%）
 *   · 核心 71.2% vs 普通 47.6%，差 +23.6pp（顶级 66~78% vs 顶均 47~52%，真实差 +20~30pp）
 * 来源：`scripts/_beat-param-sweep.mjs` / `_beat-counterfactual-probe.mjs`，
 * 归档 `docs/measurements/probe-beat-counterfactual-24-tiered-2026-09-18.txt`。
 * 设计与全部取舍：`docs/one-on-one-beat-primitive-design-2026-09-18.md`。
 */
const BEAT = {
  /** 可尝试突破的距离上限（米）。控制在 `CONTROL_RADIUS_METRES` 的"贴身"尺度。 */
  MAX_DUEL_DIST_M: 3.0,
  /** 一次尝试的动作时长：期间不再发起新的突破（避免把采样频率当动作频率）。 */
  ACTION_SEC: 1.2,
  /** 个人冷却：与 `ACTION_SEC` 共同把频次压到真实量级。 */
  COOLDOWN_SEC: 3.0,
  /** 第一层意图门槛：`INTENT_BASE + INTENT_PER_DRIBBLING × dribbling`。 */
  INTENT_BASE: 0.005,
  INTENT_PER_DRIBBLING: 0.03,
  /** 第二层结算：`BASE + (atk − def) × ATTR_WEIGHT + 角奖励 − 协防惩罚`。 */
  BASE: 0.3,
  ATTR_WEIGHT: 1.7,
  ANGLE_WEIGHT: 0.2,
  HELP_WEIGHT: 0.05,
  P_MIN: 0.08,
  P_MAX: 0.8,
  /** 越过成功后防守者的失位时长（秒）。
   *  不引入外部数字（公开文献无此量化基准，见设计稿 §5.3.1），
   *  改为复用引擎既有失位词汇：被抢断者 8s 追抢冷却 + 后撤 4 单位
   *  （`:6012`/`:6016`），下脚抢断者 36~50s（`:5966`）。取两者之间。 */
  STAGGER_SEC: 10,
  /** 越过成功后防守者的后撤距离（**场单位**），与 `:6016` 同形。 */
  STAGGER_RETREAT_UNITS: 5,
  /** 入池权重的整体缩放。默认 1（**不改变任何行为**）。
   *  仅为标定探针 `_beat-engine-side-sweep.mjs` 保留的旋钮。 */
  WEIGHT_SCALE: 1,
};

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}
function pitchVectorMetres(dx, dy) {
  return {
    x: dx * (SIM.PITCH_W_METRES / SIM.FIELD_W),
    y: dy * (SIM.PITCH_H_METRES / SIM.FIELD_H),
  };
}
function pitchDistanceMetres(dx, dy) {
  return Math.hypot(
    dx * (SIM.PITCH_W_METRES / SIM.FIELD_W),
    dy * (SIM.PITCH_H_METRES / SIM.FIELD_H)
  );
}
function pitchDistanceBetween(ax, ay, bx, by) {
  return pitchDistanceMetres(ax - bx, ay - by);
}
function pitchDistanceToGoalMetres(x, y, goalY) {
  return pitchDistanceBetween(x, y, clamp(x, SIM.GOAL_X0, SIM.GOAL_X1), goalY);
}
function pitchOffsetMetres(dxMetres, dyMetres) {
  return {
    x: dxMetres * (SIM.FIELD_W / SIM.PITCH_W_METRES),
    y: dyMetres * (SIM.FIELD_H / SIM.PITCH_H_METRES),
  };
}
function pitchOffsetToward(dx, dy, distanceMetres) {
  const metresX = dx * (SIM.PITCH_W_METRES / SIM.FIELD_W);
  const metresY = dy * (SIM.PITCH_H_METRES / SIM.FIELD_H);
  const length = Math.hypot(metresX, metresY) || 1;
  return {
    x: (metresX / length) * distanceMetres * (SIM.FIELD_W / SIM.PITCH_W_METRES),
    y: (metresY / length) * distanceMetres * (SIM.FIELD_H / SIM.PITCH_H_METRES),
  };
}
function pitchSpeedMps(vx, vy) {
  return pitchDistanceMetres(vx, vy);
}
function pitchVelocityForMps(dx, dy, metresPerSecond) {
  const offset = pitchOffsetToward(dx, dy, metresPerSecond);
  return {
    vx: offset.x,
    vy: offset.y,
  };
}
function applyBoundedSeparationCorrection(agent, nextX, nextY, limitMetres, epoch) {
  if (agent._separationStartEpoch !== epoch) {
    agent._separationStartEpoch = epoch;
    agent._separationStartX = agent.x;
    agent._separationStartY = agent.y;
  }
  const startX = agent._separationStartX;
  const startY = agent._separationStartY;
  if (Number.isFinite(limitMetres)) {
    const dx = nextX - startX;
    const dy = nextY - startY;
    const distanceMetres = pitchDistanceMetres(dx, dy);
    if (distanceMetres > limitMetres) {
      const scale = limitMetres / distanceMetres;
      nextX = startX + dx * scale;
      nextY = startY + dy * scale;
    }
  }
  agent.x = nextX;
  agent.y = nextY;
}
function applyFreeBallForces(ball, dt) {
  const airborne = (ball.z || 0) > 0 || (ball.vz || 0) > 0;
  if (airborne) {
    const gravity = 18;
    const startZ = Math.max(0, ball.z || 0);
    const startVz = ball.vz || 0;
    ball.z = startZ + startVz * dt - 0.5 * gravity * dt * dt;
    ball.vz = startVz - gravity * dt;
    if (ball.z > 10) {
      ball.z = 10;
      if ((ball.vz || 0) > 0) ball.vz *= 0.4;
    }
    if (ball.z <= 0) {
      const hitTime = clamp(
        (startVz + Math.sqrt(Math.max(0, startVz * startVz + 2 * gravity * startZ))) /
          gravity,
        0,
        dt
      );
      const impact = Math.abs(startVz - gravity * hitTime);
      const rebound = impact * (impact > 4 ? 0.38 : 0.26);
      const remaining = dt - hitTime;
      const reboundZ = rebound * remaining - 0.5 * gravity * remaining * remaining;
      if (rebound < 1.05 || reboundZ <= 0) {
        ball.z = 0;
        ball.vz = 0;
      } else {
        ball.z = reboundZ;
        ball.vz = rebound - gravity * remaining;
      }
      ball.vx *= 0.86;
      ball.vy *= 0.86;
    }
  } else {
    ball.z = 0;
    ball.vz = 0;
  }
  // Both retention factors describe SIM.DT seconds, not one caller tick.
  const groundFriction = Math.pow(SIM.BALL_FRICTION, dt / SIM.DT);
  const horizontalFriction = ball.z > 0.4 ? Math.pow(0.992, dt / SIM.DT) : groundFriction;
  ball.vx *= horizontalFriction;
  ball.vy *= horizontalFriction;
}
function estimateBallArrivalSeconds(distanceMetres, speedMps, z, vz) {
  const motion = { vx: speedMps, vy: 0, z, vz };
  let travelled = 0;
  let elapsed = 0;
  for (let step = 0; step < 60 && motion.vx > 0.05; step++) {
    const nextTravelled = travelled + motion.vx * SIM.DT;
    if (nextTravelled >= distanceMetres) {
      return elapsed + (distanceMetres - travelled) / motion.vx;
    }
    travelled = nextTravelled;
    elapsed += SIM.DT;
    applyFreeBallForces(motion, SIM.DT);
  }
  return elapsed;
}
function estimateBallHeightAtDistance(distanceMetres, speedMps, z, vz) {
  const motion = { vx: speedMps, vy: 0, z, vz };
  let travelled = 0;
  for (let step = 0; step < 60 && motion.vx > 0.05; step++) {
    const nextTravelled = travelled + motion.vx * SIM.DT;
    const startZ = motion.z || 0;
    applyFreeBallForces(motion, SIM.DT);
    if (nextTravelled >= distanceMetres) {
      const alpha = clamp((distanceMetres - travelled) / Math.max(1e-9, nextTravelled - travelled), 0, 1);
      return startZ + ((motion.z || 0) - startZ) * alpha;
    }
    travelled = nextTravelled;
  }
  return motion.z || 0;
}
function loftForTargetHeight(distanceMetres, speedMps, targetHeight) {
  let low = 0;
  let high = 16;
  for (let attempt = 0; attempt < 12; attempt++) {
    const middle = (low + high) / 2;
    const height = estimateBallHeightAtDistance(distanceMetres, speedMps, 0.2, middle);
    if (height < targetHeight) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
// 传球选择、出脚和到球预测共用速度与弧线；预测取同一误差分布的中点，
// 不消费随机数。实际出脚仍只在需要的分支取一次弧线随机数。
function passTechnique(agent, isCross = false) {
  return isCross
    ? clamp((agent.attr.crossing || agent.attr.passing || 0.55) * 0.68 +
        (agent.attr.passing || 0.55) * 0.18 + (agent.attr.kicking || 0.55) * 0.14, 0.3, 0.95)
    : agent.attr.passing || 0.55;
}
function passLaunchSpeedMps(distanceMetres, technique) {
  return clamp(10.5 + distanceMetres * 0.38, 11.5, 27) * (0.94 + 0.06 * technique);
}
function passLaunchLoft(distanceMetres, speedMps, {
  isCross = false, isThrough = false, fromCorner = false, roll = 0.5,
} = {}) {
  if (isCross) {
    const targetZ = (fromCorner ? 1.65 : isThrough ? 1.15 : 1.4) + roll * 0.45;
    return loftForTargetHeight(distanceMetres, speedMps, targetZ);
  }
  if (isThrough) return 6 + roll * 3;
  if (distanceMetres >= 30 - 1e-6) return 9 + Math.max(0, distanceMetres - 30) * 0.1;
  if (distanceMetres >= 20 - 1e-6) return 3.5 + roll * 2.5;
  return 0;
}
function playerRunSpeed(agent) {
  return SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * agent.attr.pace) *
    (0.76 + clamp((agent.fitness ?? 100) / 100, 0.3, 1) * 0.24);
}
function playerAcceleration(agent, speed) {
  return speed * (2.5 + 2.5 * agent.attr.accel) * (0.94 + (agent.attr.agility || 0.55) * 0.08);
}
function shotBlockReachMetres(speedMps) {
  return 2.2 + Math.min(0.8, speedMps * 0.014);
}

/** 属性 1..20 → 0..1 归一 */
function norm(v) {
  // 足球是强协作系统，属性差不能线性放大成“弱队完全无法触球”。
  // 压缩两端仍保留强弱差异，同时给低级别球员基本职业能力下限。
  const raw = clamp((v ?? 10) / 20, 0.05, 1);
  return clamp(0.28 + raw * 0.64, 0.3, 0.92);
}

function normalizedAgentAttributes(attrs = {}) {
  const base = {
    pace: norm(attrs.pace),
    passing: norm(attrs.passing),
    vision: norm(attrs.vision),
    shooting: norm(attrs.shooting),
    finishing: norm(attrs.finishing),
    dribbling: norm(attrs.dribbling),
    tackling: norm(attrs.tackling),
    marking: norm(attrs.marking),
    strength: norm(attrs.strength),
    stamina: norm(attrs.stamina),
    physical: norm(attrs.physical),
    positioning: norm(attrs.positioning),
    reflexes: norm(attrs.reflexes),
    handling: norm(attrs.handling),
    kicking: norm(attrs.kicking),
    heading: norm(attrs.heading),
    crossing: norm(attrs.crossing),
    decisions: norm(attrs.decisions),
  };
  const control = bodyControlProfile(base);
  return {
    ...base,
    ...control,
    accel: clamp(base.pace * 0.5 + control.agility * 0.3 + control.balance * 0.2, 0.3, 0.92),
  };
}

function heightAerial(heightCm) {
  return clamp(((Number(heightCm) || 180) - 168) / 34, 0, 1);
}

/**
 * 加权随机采样：从 [{key, w}] 里按权重 w 概率选一个。
 * temp（温度）控制随机度：temp→0 近似取最大值（确定性），temp 越大越随机。
 * 这是让决策"有概率性、不死板"的核心——同样局面不再永远同一选择，
 * 但高分动作仍更可能被选中（贴近真实球员的临场差异）。
 */
function weightedPick(items, temp = 0.35, random = Math.random) {
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
  let r = random() * sum;
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

/**
 * 死球/庆祝/点球等待期 = 画面不连续窗口（重启搬迁、庆祝聚拢都发生在窗内）。
 * snapshot() 与 adapt 的 compactSimFrame 必须共用同一语义：表现层靠它豁免
 * 重启单 tick 搬位的瞬移告警、缓动期间的显示偏离告警（match-motion-integrity
 * 的 isMotionBoundary / _analyzeDisplay），缺了它直播帧流会把每次角球/门球
 * 布阵当成 20+ 人集体瞬移上报。
 */
export function motionContextOf(eng) {
  const deadBall = !!(eng.deadBallUntil && eng.t <= eng.deadBallUntil + 1e-6);
  const celebrating = !!(eng.celebrateUntil && eng.t <= eng.celebrateUntil + 1e-6);
  return {
    discontinuity: !!(deadBall || celebrating || eng.pendingPenalty),
    reason: eng.pendingPenalty
      ? "penalty"
      : celebrating
        ? "celebration"
        : deadBall
          ? "dead-ball"
          : null,
    restartType: eng.ball?.restartType || null,
  };
}

/** Keep contact evidence readable by both live snapshots and recorded frames. */
export function ballDeflectionOf(eng) {
  const contact = eng.ball?._deflectPulse;
  return contact && eng.t >= contact.t - 1e-6 && eng.t - contact.t <= 0.35
    ? contact
    : null;
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
    this.random = typeof opts.random === "function" ? opts.random : Math.random;
    /**
     * 半场是否已换边（两队互易攻守方向）。
     *
     * 默认 `false` ⇒ **行为与不换边逐位相同**，因此旧基线全部有效。
     * 由**调用层**在中场时置位（合同 A，见
     * `docs/halftime-side-swap-implementation-design-2026-09-19.md` §6）：
     * 引擎刻意不知道「比赛时长」，`this.t` 只是被外部 `step()` 驱动的
     * 无限累加时钟，没有半场概念（`grep MATCH_SECONDS js/` = 0 处）。
     * 让引擎自己按时间推断换边会把「赛制」塞进纯模拟器，是架构降级。
     *
     * ⚠ 改动这个位会**改随机流**（`attackDir` 翻转 ⇒ 所有 `dir * …` 的
     * 目标点全变），所以任何翻转到 `true` 的场景都必须全量重标定。
     */
    this.endsSwapped = opts.endsSwapped === true;
    this.matchModifiers = opts.modifiers || null;
    this.simulationProfile = opts.simulationProfile || "standard";
    this.timeStep = clamp(Number(opts.timeStep) || SIM.DT, SIM.DT, 0.5);
    this.separationPasses = clamp(Math.round(Number(opts.separationPasses) || 8), 1, 8);
    // 身体最小间距（**场地格**，见 `SIM.SEPARATION_MIN_DISTANCE_UNITS` 那段说明：
    // 它在真实空间里是个椭圆，两条半轴都是载荷）。参数化只为让标定探针
    // （`scripts/_separation-mind-calibration-probe.mjs`）能扫它，默认值不要在别处改。
    this.separationMinDistanceUnits = clamp(
      Number(opts.separationMinDistanceUnits) || SIM.SEPARATION_MIN_DISTANCE_UNITS,
      0.5,
      5
    );
    // 主动突破原语（"过掉眼前这个人"），见
    // `docs/one-on-one-beat-primitive-design-2026-09-18.md`。
    // **默认关闭**：关闭时 `beat` 选项根本不入池 ⇒ 决策分布逐位不变 ⇒
    // 标准档基线（`STANDARD_PROFILE_REFERENCE_24`）无需重标定。
    // 参数化只为让标定探针能扫它，**默认值不要在别处改**（同 `separationMinDistanceUnits`）。
    this.beatPrimitive = opts.beatPrimitive === true;
    // 标定参数覆盖（**仅当显式传入对象时生效**）。
    // 目的与 `separationMinDistanceUnits` 完全同型：让 `_beat-engine-side-sweep.mjs`
    // 能在**不改引擎常量**的前提下扫 `intentP` 等参数。
    // ⚠ 默认 `null` ⇒ `_beatTuning()` 返回模块级 `BEAT` ⇒ **默认口径逐位不变**。
    //   传入时按 `{...BEAT, ...opts.beatTuning}` **合并**，未指定的键自动用默认值
    //   （否则 `T.MAX_DUEL_DIST_M` 会是 `undefined`，`_beatDuelCandidate` 直接失效）。
    this.beatTuning =
      opts.beatTuning && typeof opts.beatTuning === "object"
        ? { ...BEAT, ...opts.beatTuning }
        : null;
    this.integrationStats = {
      outerSteps: 0,
      coarseSteps: 0,
      fineSteps: 0,
      fineIntervals: 0,
      fineSeconds: 0,
      reasons: {},
    };
    this._activeStepDt = this.timeStep;
    this.t = 0; // 已模拟时间（秒）
    this.agents = [];
    this.ball = null;
    this.events = []; // 本引擎涌现的事件（P1+ 由决策产出；P0 仅 kickoff）
    // 球权阶段与防守任务由球队统一协调。此前每个球员每 0.1s 独立重排职责，
    // 会让上抢者/补位者来回交换，视觉上表现为集体抽搐。
    this._phaseTeam = null;
    this._defPlans = {
      home: { until: 0, phase: null, ownerId: null, ballSide: 0, ballState: null, trigger: null, jobs: new Map() },
      away: { until: 0, phase: null, ownerId: null, ballSide: 0, ballState: null, trigger: null, jobs: new Map() },
    };
    this._teamGainAt = { home: 0, away: 0 };
    this._teamLoseAt = { home: 0, away: 0 };
    this.teamPhases = {
      home: TEAM_SHAPE_PHASES.OUT_OF_POSSESSION,
      away: TEAM_SHAPE_PHASES.OUT_OF_POSSESSION,
    };
    this._shapeEvidence = {
      home: this._emptyShapeEvidenceSide(),
      away: this._emptyShapeEvidenceSide(),
    };
    this._pendingShapeEvidenceSeconds = 0;
    this._nextShapeEvidenceSampleAt = 1;
    this._shapeProfileCache = { home: null, away: null };
    this._collectiveDefenseProfileCache = { home: null, away: null };
    this._stepPressing = { home: 3, away: 3 };
    this._teamShotUntil = { home: 0, away: 0 };
    this._teamThroughUntil = { home: 0, away: 0 };
    this._teamTackleUntil = { home: 0, away: 0 };
    this._teamInterceptUntil = { home: 0, away: 0 };
    this._cornerAttackUntil = { home: 0, away: 0 };
    this._teamAttackSince = { home: 0, away: 0 };
    this._advantage = null;
    this._varReviewSeq = 0;
    this._lastVarReview = null;
    this._init();
  }

  _init() {
    this.agents = [];
    this._spawnTeam(this.home, true);
    this._spawnTeam(this.away, false);
    this._agentIndex = new Map(this.agents.map((agent) => [agent.id, agent]));
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
    // 控球累计的稀疏采样（每 15 模拟秒一条），供直播按当前画面时刻还原
    // 截至该时刻的控球率，而不是提前展示整段模拟的最终值。
    this.possTimeline = [{ t: 0, home: 0, away: 0 }];
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
    this._cornerRoutine = null;
    this.pendingPenalty = null;
    this._advantage = null;
    this._varReviewSeq = 0;
    this._lastVarReview = null;
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
      ensureLineupResponsibilities(club);
    }
    const form = FORMATIONS[club?.tactics?.formation] || FORMATIONS["4-3-3"];
    const slots = form.slots || [];
    const xi = getLineupPlayers(club) || [];
    // 按阵型槽位匹配位置：门将必须落在 GK 槽，避免 lineup 顺序乱导致「球门没人」
    const assigned = assignPlayersToFormationSlots(xi, slots);
    for (let i = 0; i < Math.min(11, slots.length); i++) {
      const slot = slots[i];
      const p = assigned[i] || xi[i] || null;
      if (p) ensureFootballProfile(p);
      const base = slotToPitch(slot, isHome);
      const a = p?.attrs || {};
      const coverage = p ? positionCoverage(p, slot, slots) : { target: slot.pos || "MID", rating: 0, natural: false };
      // 战术角色以阵型槽为准（槽是 GK 就必须按门将 AI 站门）
      const role = slot.pos || p?.pos || "MID";
      // 战术板角色 id（边路爆破 / 内切前锋 等）
      let roleId = null;
      try {
        roleId = club ? getSlotRole(club, i) : null;
      } catch {
        roleId = null;
      }
      let dutyId = null;
      try {
        dutyId = club ? getSlotDuty(club, i) : null;
      } catch {
        dutyId = null;
      }
      this.agents.push({
        id: p?.id || `${isHome ? "h" : "a"}-slot-${i}`,
        player: p,
        club,
        team: isHome ? "home" : "away",
        isHome,
        role, // GK | DEF | MID | ATT
        roleId: roleId || null,
        dutyId: dutyId || null,
        detailedPosition: coverage.target,
        positionRating: coverage.rating,
        naturalPosition: coverage.natural,
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
        shapeSlotIndex: i,
        slotX: slot.x ?? 50,
        slotY: slot.y ?? 50,
        // —— 归一化属性（决策用，读一次缓存）——
        attr: normalizedAgentAttributes(a),
        heightCm: Number(p?.heightCm) || 180,
        preferredFoot: p?.preferredFoot || "right",
        controlFoot: p?.preferredFoot === "left" ? "left" : "right",
        controlPhase: "settled",
        controlUntil: 0,
        bodyTargetHeading: isHome ? -Math.PI / 2 : Math.PI / 2,
        pendingBallAction: null,
        actionPreparationActive: false,
        habits: new Set(p?.playingHabits || []),
        // —— 决策缓存（P1 用）——
        decisionUntil: 0, // 到该时间前沿用上次决策
        attackThinkUntil: 0,
        intent: null, // { type, tx, ty, targetId... }
        // —— 状态机标签（渲染/调试用）——
        fsm: "home",
        shapePhase: TEAM_SHAPE_PHASES.OUT_OF_POSSESSION,
        fitness: p?.fitness ?? 100,
        // 本场累计跑动距离（米）。累加处在 `_stepOnce` 的位移更新之后，
        // 消费方只有 `match.js` 的体能结算（`settleFitnessDrain`）——不参与物理/决策。
        runMetres: 0,
        // 核心球员：战术指定，享有进攻绝对权（梅西/C罗式）
        isCore: false,
        isCaptain: false,
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
    const captainId = getCaptainId(club);
    if (captainId) {
      const captain = this.agents.find((x) => x.id === captainId && x.team === teamTag);
      if (captain) captain.isCaptain = true;
    }
  }

  /** 边后卫？宽位 DEF（用阵型 slotX，主客对称） */
  _isFullback(a) {
    const x = a.slotX != null ? a.slotX : a.baseX;
    if (a.detailedPosition === "LB" || a.detailedPosition === "RB") return true;
    if (a.detailedPosition === "CB") return false;
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
    if (["LW", "RW", "LM", "RM"].includes(a.detailedPosition)) return true;
    if (["AM", "CM", "DM"].includes(a.detailedPosition)) return false;
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

  /**
   * 该队此刻「进攻方向」：-1 表示朝 y 小，+1 表示朝 y 大。
   *
   * ⚠ 半场换边（`swapEnds`）后本函数必须返回取反值，因此**所有**判断
   * 进攻/防守朝向的地方都必须走这里，不允许再出现 `team === "home" ? …`
   * 形式的坐标推断（历史上「team → 球门 y」被硬编码复制了 10+ 处，
   * 换边时漏改一处就是一个静默错位的分支）。
   * 详见 docs/halftime-side-swap-verification-2026-09-16.md §4。
   */
  attackDir(team) {
    const base = team === "home" ? -1 : 1;
    // 换边后攻守互易：原本朝 y 小进攻的改为朝 y 大。
    return this.endsSwapped ? -base : base;
  }

  /** 该队此刻进攻的**目标球门** y（对手那侧的门）。 */
  targetGoalY(team) {
    const base = team === "home" ? SIM.AWAY_GOAL_Y : SIM.HOME_GOAL_Y;
    return this.endsSwapped ? 100 - base : base;
  }

  /**
   * 该队此刻**自己防守的球门** y。与 `targetGoalY` 互补。
   *
   * 这个入口是 2026-09-19 重构新增的：此前 `a.team === "home" ? SIM.HOME_GOAL_Y
   * : SIM.AWAY_GOAL_Y` 在引擎里被逐字抄了 6 遍（旧 :1787/:2118/:3957/:4597/
   * :4801/:5170），全部绕过 `targetGoalY`。它们此前**恰好**与 `targetGoalY`
   * 反义，所以看起来像是同一个东西——换边时这就是最危险的一类重复。
   */
  ownGoalY(team) {
    const base = team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
    return this.endsSwapped ? 100 - base : base;
  }

  /**
   * 球到该队己方球门的距离（>0 = 球在这一侧之前）。
   * 替代旧 :5182 的 `home ? clamp(HOME_GOAL_Y - b.y) : clamp(b.y - AWAY_GOAL_Y)`。
   */
  _ballDistanceToOwnGoal(team, ball = this.ball) {
    if (!ball) return 0;
    return clamp(Math.abs(ball.y - this.ownGoalY(team)), 0, 100);
  }

  // ─────────────────────────────────────────────────────────────────
  // 镜像入口（2026-09-19 换边第 3 步新增）
  //
  // 背景：`team === "home" ? …` 在引擎里有 51 处。第 1 步收敛了 10 处
  // 「球门坐标」，第 2 步加了 `endsSwapped` 开关，但**仍有约 30 处
  // 「场地坐标推断」绕过了任何统一入口**（`yLo/yHi`、`bylineDir`、
  // `boxY`、`nearBox`、`inOwnBuildZone`、越位线、门将站位、点球/门球
  // 位置……）。它们换边时会**静默错位** —— 不报错、不 NaN，只是行为
  // 悄悄退化。实测：换边后主队射门位均 y 从 ~10 翻到 ~67，但客队仍
  // 停在中线附近，因为它攻不上去。
  //
  // 下面三个入口覆盖那 30 处的全部模式。**新增代码一律走这里**，不
  // 允许再出现 `team === "home" ? <坐标>` 形式。
  // ─────────────────────────────────────────────────────────────────

  /**
   * 该队此刻的「方向符号」：-1 = 朝 y 小，+1 = 朝 y 大。
   * 与 `attackDir` 完全同义 —— 提供这个别名是因为调用点读起来更清楚：
   * `a.y += _sign(team) * step` 比 `a.y += attackDir(team) * step` 更
   * 容易看出这是「沿进攻方向的位移」。
   *
   * 替代：`home ? 1 : -1`（:6877 outward）、`home ? -1 : 1`（:5848 fieldDir）、
   * `home ? 1 : -1`（:6036/:6106 bylineDir，己方底线方向）。
   * ⚠ 注意符号约定不同：`fieldDir`/`bylineDir` 是「朝己方底线」= **-attackDir**，
   * 而 `outward` 是「离对方球门为正」= **+attackDir**。替换时逐一核对语义。
   */
  _sign(team) {
    return this.attackDir(team);
  }

  /**
   * 距**己方**球门 `dist`（场地格）处的 y 坐标。
   *
   * 替代所有 `home ? 12 : 88` / `home ? 14 : 86` / `home ? 16 : 84` 一族
   * 硬编码锚点（:6832/:6857/:7193 spotY、:6876 boxEdgeY、:2486/:2523 boxY）。
   * 典型用法：
   *   const spotY = this._ownGoalSideY(team, 12);        // 点球点（距己方门 12 格）
   *   const boxEdgeY = this._ownGoalSideY(team, 16);     // 对方禁区线
   *   const nearGoalY = this._ownGoalSideY(team, 6);     // 贴门
   * 需要「距**对方**门 dist」时用 `100 - _ownGoalSideY(team, dist)`，
   * 或直接 `_ownGoalSideY(opposite(team), dist)`。
   */
  _ownGoalSideY(team, dist) {
    const own = this.ownGoalY(team);
    // own 是 0 或 100：朝场地内部走 dist 格
    return own > 50 ? own - dist : own + dist;
  }

  /**
   * 距**对方**球门 `dist`（场地格）处的 y 坐标。
   *
   * 与 `_ownGoalSideY` 互为镜像：`_oppGoalSideY(team, d) === _ownGoalSideY(team, 100 - d)`。
   * 提供它是为了让调用点读起来是它本来想表达的意思 —— 例如点球点、门球位置、
   * 传中禁区锚点全都是「距**对方**门 N 格」，写成 `100 - _ownGoalSideY(t, 100-N)`
   * 会让人反复怀疑符号，从而埋下换边漏改的种子。
   */
  _oppGoalSideY(team, dist) {
    const target = this.targetGoalY(team);
    return target > 50 ? target - dist : target + dist;
  }

  /**
   * 从**己方球门线**朝场地内部量到 `y` 的纵深（0 = 己方门线，100 = 对方门线）。
   *
   * 这是 D4「差值/进度」一类最自然的入口：这类代码关心的都是「谁比谁更靠前」
   * 「推进了多远」，用绝对 y 再乘符号既难读又极易把符号写反。
   * 用它之后，所有比较都可以写成标量大小比较，与主客/换边完全无关：
   *
   *   const depthOf = (y) => this._depthFromOwnGoal(y, team);
   *   const progress = depthOf(a.y) - depthOf(m.y);   // >0 = m 比 a 更靠前
   *   const beyondHalf = depthOf(m.y) >= 45;
   *
   * 替代：`home ? a.y - m.y : m.y - a.y`（:2480 前插进度）、
   * `home ? m.y <= yHi : m.y >= yLo`（:2484 是否过半场）、
   * `home ? leadY >= offY - 2 : leadY <= offY + 2`（:3455 越位线）、
   * `home ? a.baseY < 52 : a.baseY > 48`（:4320 是否已前插）、
   * `home ? cy > gk.y + 1.6 : cy < gk.y - 1.6`（:6068 球是否越过门将）。
   */
  _depthFromOwnGoal(y, team) {
    const own = this.ownGoalY(team);
    // own 是 0 或 100。own=100 时纵深 = 100 - y；own=0 时纵深 = y。
    return own > 50 ? 100 - y : y;
  }

  /**
   * 某个 y 是否位于「该队己方球门那一侧」的参考线之外。
   *
   * `refDist` = 参考线距己方门的距离（场地格）。语义等价于
   * 「从己方门往场地内部走 refDist 格画一条线，y 是否还在门那一侧」。
   *
   * 替代所有 `home ? y >= 84 : y <= 16` 一族区间判定
   * （:5322/:5328/:5332 己方禁区、:6691 防守禁区、:3248 inOwnBuildZone、
   * :2782 nearAttackingByline、:2356 接球点边界、:5929 nearBox、
   * :5900 GK 站位 clamp）。
   *
   * ⚠ 传 `refDist` 时想清楚是「距己方门」还是「距对方门」——这是这批
   * 硬编码最容易读错的地方（`:2782` 写的是「距对方底线 5.5」，
   * 而 `:5322` 写的是「距己方门 16」）。
   * ⚠ 本函数是**闭区间**（`>=`/`<=`）。原代码若用严格不等（`>`/`<`），
   * 边界点会差，应改用 `_depthFromOwnGoal` 直接比大小。
   */
  _onOwnSide(y, team, refDist) {
    const own = this.ownGoalY(team);
    const line = own > 50 ? own - refDist : own + refDist;
    return own > 50 ? y >= line : y <= line;
  }

  /**
   * 把「距己方门的带符号纵深」转成绝对 y（`_onOwnSide` 的连续版）。
   * `depth` > 0 = 朝场地内部；< 0 = 越过己方门线。
   * 用于 `clamp` 一类需要连续值的场合（如 :5900 GK 站位）。
   */
  _ownGoalSideYClamped(y, team, minDist, maxDist) {
    const own = this.ownGoalY(team);
    const lo = this._ownGoalSideY(team, minDist);
    const hi = this._ownGoalSideY(team, maxDist);
    return own > 50 ? clamp(y, hi, lo) : clamp(y, lo, hi);
  }

  /**
   * 坐标是否位于某队自己的禁区；与自由球门将接管使用同一边界。
   * 纵向边界由 `ownGoalY` 推出，不再硬编码 80/20。
   */
  _inOwnPenaltyArea(team, x, y, margin = 0) {
    if (!(x > 18 - margin && x < 82 + margin)) return false;
    const ownGoal = this.ownGoalY(team);
    return ownGoal > 50 ? y > 80 - margin : y < 20 + margin;
  }

  /** 门将只在自己的禁区附近构成持球压力，不能在中场被当成普通防守者。 */
  _goalkeeperCanPressure(gk, attacker) {
    return (
      gk?.role === "GK" &&
      attacker &&
      gk.team !== attacker.team &&
      this._inOwnPenaltyArea(gk.team, attacker.x, attacker.y, 2)
    );
  }

  /**
   * 从当前真实坐标评估射门线路是否仍被门将覆盖。
   * 同一结果同时驱动出脚意愿、射门误差和扑救难度，避免画面看到空门而
   * 决策层仍把它当成普通机会。门将出击但仍挡在线路上时不会被误判为空门。
   */
  _goalOpportunity(a) {
    const goalY = this.targetGoalY(a.team);
    const dGoal = dist(a.x, a.y, 50, goalY);
    const angle = clamp(1 - Math.abs(a.x - 50) / 26, 0, 1);
    const targetX = clamp(
      a.x * 0.28 + 50 * 0.72,
      SIM.GOAL_X0 + 0.8,
      SIM.GOAL_X1 - 0.8
    );
    const goalkeeper = this.agents.find(
      (g) => g.role === "GK" && g.team !== a.team && !g.sentOff
    ) || null;
    if (!goalkeeper) {
      const openGoal = dGoal < 24 && angle > 0.1;
      return {
        goalkeeper: null,
        dGoal,
        angle,
        targetX,
        laneDistance: Infinity,
        keeperReach: 0,
        keeperProjection: -1,
        exposure: openGoal ? 1 : 0,
        openGoal,
        openGoalReason: openGoal ? "no_goalkeeper" : null,
        clearOpenGoal: openGoal && dGoal < 18 && angle > 0.16,
      };
    }

    const sx = a.x;
    const sy = a.y;
    const dx = targetX - sx;
    const dy = goalY - sy;
    const len2 = dx * dx + dy * dy || 1e-6;
    const keeperProjection =
      ((goalkeeper.x - sx) * dx + (goalkeeper.y - sy) * dy) / len2;
    const projected = clamp(keeperProjection, 0, 1);
    const laneX = sx + dx * projected;
    const laneY = sy + dy * projected;
    const laneDistance = dist(goalkeeper.x, goalkeeper.y, laneX, laneY);
    const keeperReach =
      3.4 +
      (goalkeeper.attr.reflexes || 0.5) * 2.6 +
      (goalkeeper.attr.positioning || 0.5) * 0.8;
    const keeperDepth = Math.abs(goalkeeper.y - goalY);
    const keeperForwardGap =
      (goalkeeper.y - a.y) * this.attackDir(a.team);
    const behindShooter =
      keeperProjection <= -0.08 && keeperForwardGap < -2.4;
    const lateralCover = Math.abs(goalkeeper.x - targetX);
    const centerOffset = Math.abs(goalkeeper.x - 50);
    // 某一条射门线路暂时够不到只代表球门一侧暴露，不等于空门。只有门将
    // 已被进攻者越过，或横向失位到无法保护门框时，才允许绕过射门节奏限制。
    const strandedWide =
      lateralCover > 12 &&
      laneDistance > keeperReach + 1.2 &&
      (centerOffset > 11 || keeperDepth > 9.5);
    const completelyWide = centerOffset > 16;
    const openGoal =
      dGoal < 20 &&
      angle > 0.1 &&
      (behindShooter || strandedWide || completelyWide);
    const openGoalReason = behindShooter
      ? "rounded_goalkeeper"
      : completelyWide
        ? "goalkeeper_outside_frame"
        : strandedWide
          ? "goalkeeper_stranded_wide"
          : null;
    const exposure = behindShooter
      ? 1
      : clamp((lateralCover - 10) / 12 + Math.max(0, centerOffset - 11) / 12, 0, 1);

    return {
      goalkeeper,
      dGoal,
      angle,
      targetX,
      laneDistance,
      keeperReach,
      keeperProjection,
      keeperDepth,
      keeperForwardGap,
      lateralCover,
      exposure,
      openGoal,
      openGoalReason,
      clearOpenGoal:
        openGoal && dGoal < 18 && angle > 0.16 && (behindShooter || exposure > 0.08),
    };
  }

  agentById(id) {
    if (!id) return null;
    const cached = this._agentIndex?.get(id);
    if (cached?.id === id) return cached;
    if (cached) this._agentIndex.delete(id);
    const agent = this.agents.find((item) => item.id === id) || null;
    if (agent) this._agentIndex?.set(id, agent);
    return agent;
  }

  _clubForTeam(team) {
    return team === "home" ? this.home : this.away;
  }

  _setPieceTaker(team, type) {
    const club = this._clubForTeam(team);
    const id = club ? getSetPieceTakerId(club, type) : null;
    if (!id) return null;
    return this.agents.find((a) => a.id === id && a.team === team && a.role !== "GK" && !a.sentOff) || null;
  }

  _aerialAbility(a) {
    if (!a) return 0.5;
    return clamp(
      (a.attr.heading || 0.5) * 0.46 +
        (a.attr.strength || 0.5) * 0.25 +
        heightAerial(a.heightCm) * 0.22 +
        (a.attr.positioning || 0.5) * 0.07,
      0.18,
      0.98
    );
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

  _shapeProfile(team) {
    const tactics = this._teamTactics(team);
    const style = tactics.style || "balanced";
    const pressing = tactics.pressing || 3;
    const tempo = tactics.tempo || 3;
    const width = tactics.width || 3;
    const defensiveLine = tactics.defensiveLine || 3;
    const cached = this._shapeProfileCache[team];
    if (
      !cached ||
      cached.style !== style ||
      cached.pressing !== pressing ||
      cached.tempo !== tempo ||
      cached.width !== width ||
      cached.defensiveLine !== defensiveLine
    ) {
      this._shapeProfileCache[team] = {
        style,
        pressing,
        tempo,
        width,
        defensiveLine,
        profile: teamShapeProfile(tactics),
      };
    }
    return this._shapeProfileCache[team].profile;
  }

  /**
   * Apply an explicitly selected phase formation as a geometric target only.
   * With a null selector the old base-formation path remains byte-for-byte
   * equivalent; selecting a phase shape opts that phase into this blend.
   */
  _applyExplicitShapeAnchor(a, phase, weight = 0.25) {
    if (!a || a.role === "GK") return false;
    const tactics = this._teamTactics(a.team);
    const targetFormationId = explicitShapeFormationId(tactics, phase);
    if (!targetFormationId) return false;
    const baseFormationId = FORMATIONS[tactics.formation] ? tactics.formation : "4-3-3";
    const slotMap = shapeFormationSlotMap(baseFormationId, targetFormationId);
    const targetIndex = slotMap[a.shapeSlotIndex];
    const targetSlot = FORMATIONS[targetFormationId]?.slots?.[targetIndex];
    if (!targetSlot) return false;
    // ⚠ 2026-09-22 修：原来按 `a.isHome` 决定镜像，**没有** `endsSwapped`
    //   ⇒ 下半场换边后阶段阵型锚点会镜像错。规则与 `adapt.js:163` 同源：
    //   `mirrored = isHome ? endsSwapped : !endsSwapped`。
    const mirrored = a.isHome ? !!this.endsSwapped : !this.endsSwapped;
    const targetX = mirrored ? 100 - targetSlot.x : targetSlot.x;
    const targetY = mirrored ? 100 - targetSlot.y : targetSlot.y;
    const club = a.team === "home" ? this.home : this.away;
    const coachPlanned = !!tactics.coachPhaseIdentityId
      && tactics.coachPhaseIdentityId === club?.staff?.coach?.id;
    const resolvedWeight = coachPlanned ? Math.min(Number(weight) || 0, 0.18) : weight;
    const blend = clamp(Number(resolvedWeight) || 0, 0, 0.65);
    if (blend <= 0) return false;
    a.tx = clamp(a.tx * (1 - blend) + targetX * blend, 3, 97);
    a.ty = clamp(a.ty * (1 - blend) + targetY * blend, 3, 97);
    return true;
  }

  _collectiveDefenseProfile(team) {
    const tactics = this._teamTactics(team);
    const style = tactics.style || "balanced";
    const pressing = tactics.pressing || 3;
    const width = tactics.width || 3;
    const defensiveLine = tactics.defensiveLine || 3;
    const cached = this._collectiveDefenseProfileCache[team];
    if (
      !cached ||
      cached.style !== style ||
      cached.pressing !== pressing ||
      cached.width !== width ||
      cached.defensiveLine !== defensiveLine
    ) {
      this._collectiveDefenseProfileCache[team] = {
        style,
        pressing,
        width,
        defensiveLine,
        profile: collectiveDefenseProfile(tactics),
      };
    }
    return this._collectiveDefenseProfileCache[team].profile;
  }

  _teamShapePhase(team, controlTeam = this._phaseTeam || this.possession) {
    return teamShapePhase({
      team,
      controlTeam,
      now: this.t,
      gainedAt: this._teamGainAt[team] || 0,
      lostAt: this._teamLoseAt[team] || 0,
      tactics: this._teamTactics(team),
    });
  }

  _refreshTeamShapePhases(controlTeam = this._phaseTeam || this.possession) {
    for (const team of ["home", "away"]) {
      const phase = this._teamShapePhase(team, controlTeam);
      this.teamPhases[team] = phase;
    }
    return this.teamPhases;
  }

  _emptyShapeEvidenceSide() {
    return {
      totalSeconds: 0,
      phaseSeconds: {
        [TEAM_SHAPE_PHASES.IN_POSSESSION]: 0,
        [TEAM_SHAPE_PHASES.OUT_OF_POSSESSION]: 0,
        [TEAM_SHAPE_PHASES.ATTACKING_TRANSITION]: 0,
        [TEAM_SHAPE_PHASES.DEFENSIVE_TRANSITION]: 0,
      },
      phaseFormations: new Map(),
      positions: new Map(),
    };
  }

  _recordTeamShapeEvidence(dt) {
    const seconds = Math.max(0, Number(dt) || 0);
    this._pendingShapeEvidenceSeconds += seconds;
    if (this.t + seconds < this._nextShapeEvidenceSampleAt - 1e-9) return;
    const sampledSeconds = this._pendingShapeEvidenceSeconds;
    this._pendingShapeEvidenceSeconds = 0;
    for (const team of ["home", "away"]) {
      const side = this._shapeEvidence[team];
      const phase = this.teamPhases[team] || TEAM_SHAPE_PHASES.OUT_OF_POSSESSION;
      const formation = shapeFormationId(this._teamTactics(team), phase);
      side.totalSeconds += sampledSeconds;
      side.phaseSeconds[phase] = (side.phaseSeconds[phase] || 0) + sampledSeconds;
      const formationKey = `${phase}:${formation}`;
      side.phaseFormations.set(
        formationKey,
        (side.phaseFormations.get(formationKey) || 0) + sampledSeconds
      );
      for (const agent of this.agents) {
        if (agent.team !== team || agent.sentOff) continue;
        // 归一化到「两队都朝 y→100 攻」：朝 y 小攻的队翻 y、朝 y 大攻的队翻 x。
        // ⚠ 2026-09-22 修：原来用 `team === "home"` 选分支 ⇒ 下半场换边后 y 翻反了。
        const position = this.attackDir(team) < 0
          ? { x: agent.x, y: 100 - agent.y }
          : { x: 100 - agent.x, y: agent.y };
        const current = side.positions.get(agent.id) || {
          playerId: agent.id,
          name: agent.player?.name || String(agent.id),
          number: agent.num ?? null,
          role: agent.role || null,
          x: 0,
          y: 0,
          samples: 0,
        };
        current.x += clamp(position.x, 0, 100);
        current.y += clamp(position.y, 0, 100);
        current.samples++;
        side.positions.set(agent.id, current);
      }
    }
    while (this._nextShapeEvidenceSampleAt <= this.t + seconds + 1e-9) {
      this._nextShapeEvidenceSampleAt += 1;
    }
  }

  /** 由 match.js 注入的额外比赛情境修正；阵型/风格本身仍直接读取球队战术。 */
  _teamModifier(team, key, fallback = 1) {
    const value = Number(this.matchModifiers?.[team]?.[key]);
    return Number.isFinite(value) ? clamp(value, 0.75, 1.25) : fallback;
  }

  _tacticLevel(team, key, fallback = 3) {
    return clamp(Number(this._teamTactics(team)?.[key]) || fallback, 1, 5);
  }

  _hasHabit(agent, habitId) {
    return agent?.habits instanceof Set && agent.habits.has(habitId);
  }

  _roleBehavior(agent, key) {
    if (!agent?.roleId) return 0;
    if (
      agent._roleBehaviorRole !== agent.roleId ||
      agent._roleBehaviorDuty !== agent.dutyId
    ) {
      agent._roleBehaviorRole = agent.roleId;
      agent._roleBehaviorDuty = agent.dutyId;
      agent._roleBehaviorData = roleBehavior(agent.roleId, agent.dutyId);
    }
    return Number(agent._roleBehaviorData?.[key]) || 0;
  }

  _nextControlDecision(a) {
    const tempo = this._tacticLevel(a.team, "tempo");
    const decisions = a?.attr?.decisions || 0.58;
    const base = clamp(2.35 - (tempo - 3) * 0.2 - (decisions - 0.58) * 0.34, 1.55, 2.95);
    const spread = clamp(2.1 - (tempo - 3) * 0.12 - (decisions - 0.58) * 0.38, 1.2, 2.55);
    return this.t + base + this.random() * spread;
  }

  _nearestOpponent(a) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const opponent of this.agents) {
      if (opponent.team === a.team || opponent.sentOff) continue;
      if (opponent.role === "GK" && !this._goalkeeperCanPressure(opponent, a)) continue;
      const distance = pitchDistanceBetween(a.x, a.y, opponent.x, opponent.y);
      if (distance < nearestDistance) {
        nearest = opponent;
        nearestDistance = distance;
      }
    }
    return nearest ? { opponent: nearest, distance: nearestDistance } : null;
  }

  /**
   * 主动突破的生效参数：默认是模块级 `BEAT` 常量。
   * 仅当构造时显式传入 `opts.beatTuning` 才用覆盖值（标定探针专用）。
   * ⚠ 默认路径**不分配对象、不做合并**，直接返回常量 ⇒ 无性能/行为影响。
   */
  _beatTuning() {
    return this.beatTuning || BEAT;
  }

  /**
   * 主动突破：找一个**值得对抗**的最近对手。
   *
   * 与 `_nearestOpponent` 的区别：这里只看"贴身"范围内的对手（`BEAT.MAX_DUEL_DIST_M`），
   * 且要求该对手不在越位豁免/门将特殊状态里（门将复用 `_goalkeeperCanPressure` 的判据）。
   * 返回 `{ opponent, distance, angleRad, helpers }` 或 `null`。
   *
   * ⚠ 为什么必须配合"意图门槛"（见 `_attemptBeat`）：**引擎里贴身是常态**
   * （实测 53.5% 的持球样本最近对手 ≤3m），任何"贴身即触发"的方案都会
   * 给出比真实高 1~2 个数量级的频次（探针实测 42×）。
   */
  _beatDuelCandidate(a) {
    const T = this._beatTuning();
    const near = this._nearestOpponent(a);
    if (!near) return null;
    const { opponent: opp, distance } = near;
    if (distance > T.MAX_DUEL_DIST_M) return null;
    if (opp.sentOff) return null;

    // 侧向角：防守者相对"持球者 → 对方球门"方向的角偏差。越大越好过。
    const dir = this.attackDir(a.team);
    const goalY = this.targetGoalY(a.team);
    const toGoal = Math.atan2(goalY - a.y, 50 - a.x);
    const toDef = Math.atan2(opp.y - a.y, opp.x - a.x);
    let angleRad = Math.abs(toDef - toGoal);
    if (angleRad > Math.PI) angleRad = 2 * Math.PI - angleRad;

    // 协防人数：突破路径 8m 内的其他对手
    let helpers = 0;
    for (const o of this.agents) {
      if (o.team === a.team || o === opp || o.sentOff) continue;
      if (o.role === "GK" && !this._goalkeeperCanPressure(o, a)) continue;
      if (pitchDistanceBetween(a.x, a.y, o.x, o.y) <= 8) helpers++;
    }
    return { opponent: opp, distance, angleRad, helpers, dir };
  }

  /**
   * 主动突破的结果结算（两层结构）。
   *
   * 第一层**意图门槛**：贴身 ≠ 想过人。真实足球在 ~1000 次持球接触里只挑出
   *   ~17 次 take-on，所以"我这次要不要过他"必须独立于冷却单独掷一次。
   *   门槛随 `dribbling` 上升 —— 这本身就是球员差异的第一层体现。
   * 第二层**越过结算**：对齐抢断公式的形状（`:5996`），但表达"进攻方赢"。
   *
   * 赢 ⇒ 防守者进入 `beatenUntil` 失位窗口（真实后果，也是 `dribbling`
   *   传导到终局指标的唯一通道）；输 ⇒ **不换手**，只是这次没过去
   *   （直接换手等于把抢断系统重做一遍，见设计稿 §2.4 的取舍）。
   */
  _attemptBeat(a, opp) {
    if (!opp || opp.sentOff) return;
    const T = this._beatTuning();

    const intentP = T.INTENT_BASE + T.INTENT_PER_DRIBBLING * a.attr.dribbling;
    if (this.random() >= intentP) {
      // 本次不尝试，但仍进冷却：否则每个决策点都会重掷，退化成"高频重试"
      a.beatCdUntil = this.t + T.COOLDOWN_SEC;
      return;
    }
    a.beatCdUntil = this.t + T.COOLDOWN_SEC;

    const duel = this._beatDuelCandidate(a);
    if (!duel || duel.opponent !== opp) return;

    const atk = 0.55 * a.attr.dribbling + 0.25 * a.attr.balance + 0.2 * a.attr.pace;
    const def = 0.6 * opp.attr.tackling + 0.2 * opp.attr.marking;
    const angleBonus = (duel.angleRad / Math.PI) * T.ANGLE_WEIGHT;
    const p = clamp(
      T.BASE + (atk - def) * T.ATTR_WEIGHT + angleBonus - duel.helpers * T.HELP_WEIGHT,
      T.P_MIN,
      T.P_MAX
    );

    if (this.random() < p) {
      // 越过成功：防守者失位 + 朝己方后撤（与 `:6016` 被抢断者同形）
      opp.beatenUntil = this.t + T.STAGGER_SEC;
      const back = this.attackDir(opp.team);
      opp.tx = clamp(opp.x - back * T.STAGGER_RETREAT_UNITS, 3, 97);
      opp.ty = clamp(opp.y + back * T.STAGGER_RETREAT_UNITS, 3, 97);
      opp.intent = null;
      this._emit("beat", a, {
        from: opp.id,
        distance: Number(duel.distance.toFixed(2)),
        angle: Number(duel.angleRad.toFixed(3)),
        helpers: duel.helpers,
      });
    }
  }

  _beginBallControl(a, {
    kind = "receive",
    passFrom = null,
    intendedId = null,
    emitReceive = false,
    protectSeconds = 0.7,
    settleSeconds = 0.45,
    goalkeeperFeet = false,
  } = {}) {
    const b = this.ball;
    const observedFlight = Math.max(0, this.t - (b.lastPassAt ?? this.t));
    const anticipated = a.role !== "GK" && b.state === "pass" &&
      b.receiverId === a.id && b.kickTeam === a.team &&
      !b.isCrossPass && (b.z || 0) <= 0.8;
    const incomingVx = b.vx || 0;
    const incomingVy = b.vy || 0;
    b.backpassCandidate = false;
    b.backpassFrom = null;
    b.backpassTargetId = null;
    const incomingSpeedMps = pitchSpeedMps(incomingVx, incomingVy);
    const nearest = this._nearestOpponent(a);
    const pressure = this._pressureOn(a);
    const escapeHeading = nearest
      ? Math.atan2(a.y - nearest.opponent.y, a.x - nearest.opponent.x)
      : null;
    const plan = firstTouchPlan({
      playerX: a.x,
      playerY: a.y,
      heading: a.heading,
      incomingVx,
      incomingVy,
      incomingSpeedMps,
      attackDirection: this.attackDir(a.team),
      preferredFoot: a.preferredFoot,
      attrs: a.attr,
      pressure,
      escapeHeading,
      aerial: (b.z || 0) > 0.8 || !!b.isCrossPass,
    });
    const startX = b.x;
    const startY = b.y;
    const startZ = b.z || 0;
    const usesHands = a.role === "GK" && !goalkeeperFeet;
    b.owner = a.id;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.state = "control";
    this._clearBallTarget();
    b._saveChecked = false;
    a.controlFoot = plan.foot;
    a.bodyTargetHeading = plan.desiredHeading;
    a.pendingBallAction = null;
    a.actionPreparationActive = !usesHands;
    a.intent = usesHands ? null : this._forwardDribbleIntent(a);
    a.fsm = usesHands ? "home" : "receive";
    a.decisionUntil = this._nextControlDecision(a);
    if (usesHands) {
      const catchDistance = pitchDistanceBetween(startX, startY, a.x, a.y);
      const catchDuration = clamp(catchDistance / 26, 0.12, 0.26);
      a.controlPhase = "first-touch";
      a.controlUntil = this.t + catchDuration;
      a.protectUntil = this.t + protectSeconds;
      b.settleUntil = Math.max(this.t + settleSeconds, a.controlUntil + 0.08);
      b.controlOwnerId = a.id;
      b.controlKind = kind;
      b.controlStartAt = this.t;
      b.controlUntil = a.controlUntil;
      b.controlStartX = startX;
      b.controlStartY = startY;
      b.controlStartZ = startZ;
      b.controlOffsetX = 0;
      b.controlOffsetY = 0;
      b.controlFoot = plan.foot;
      a.pose = "hold";
      a.poseUntil = this.t + 0.7;
    } else {
      a.controlPhase = "first-touch";
      a.controlUntil = this.t + plan.duration;
      a.protectUntil = Math.max(this.t + protectSeconds, a.controlUntil + 0.16);
      b.settleUntil = Math.max(this.t + settleSeconds, a.controlUntil + 0.08);
      b.controlOwnerId = a.id;
      b.controlKind = kind;
      b.controlStartAt = this.t;
      b.controlUntil = a.controlUntil;
      b.controlStartX = startX;
      b.controlStartY = startY;
      b.controlStartZ = startZ;
      b.controlOffsetX = plan.targetX - a.x;
      b.controlOffsetY = plan.targetY - a.y;
      b.controlFoot = plan.foot;
    }
    if (emitReceive) {
      this._emit("receive", a, {
        from: passFrom,
        intendedId,
        controlDuration: plan.duration,
        foot: plan.foot,
      });
    }
    // An intended low-pass receiver observes the flight before touching the
    // ball. Count that time toward the next decision, without skipping control,
    // settling or the subsequent body-turn preparation.
    if (anticipated) {
      a.decisionUntil = Math.min(a.decisionUntil,
        Math.max(a.controlUntil, b.settleUntil || a.controlUntil, a.decisionUntil - observedFlight));
    }
    return plan;
  }

  _miscontrolBall(a) {
    const b = this.ball;
    const nearest = this._nearestOpponent(a);
    const plan = firstTouchPlan({
      playerX: a.x,
      playerY: a.y,
      heading: a.heading,
      incomingVx: b.vx || 0,
      incomingVy: b.vy || 0,
      incomingSpeedMps: pitchSpeedMps(b.vx || 0, b.vy || 0),
      attackDirection: this.attackDir(a.team),
      preferredFoot: a.preferredFoot,
      attrs: a.attr,
      pressure: this._pressureOn(a),
      escapeHeading: nearest
        ? Math.atan2(a.y - nearest.opponent.y, a.x - nearest.opponent.x)
        : null,
      aerial: (b.z || 0) > 0.8 || !!b.isCrossPass,
    });
    const errorHeading = plan.desiredHeading + (this.random() - 0.5) * (0.45 + (1 - plan.firstTouch) * 0.5);
    const looseSpeed = 4 + this.random() * 5;
    const velocity = pitchVelocityForMps(Math.cos(errorHeading), Math.sin(errorHeading), looseSpeed);
    b.owner = null;
    b.vx = velocity.vx;
    b.vy = velocity.vy;
    b.vz = Math.max(0, b.vz || 0) * 0.25;
    b.state = "loose";
    // 第一脚失控:球沿「想接的方向」加噪声飞出,和来球线路无关,而这里过去
    // **什么都不发**。按调查这是频率最高的一处折射(15~40%,快球最高 85%),
    // 也就是「无缘无故拐弯」的主要来源。记录带时间戳的接触点。
    b._deflectPulse = { x: b.x, y: b.y, byId: a.id, t: this.t + (this._emitTimeOffset || 0) };
    this._clearBallTarget();
    a.controlFoot = plan.foot;
    a.controlPhase = "miscontrol";
    a.controlUntil = this.t + 0.35;
    a.bodyTargetHeading = plan.desiredHeading;
    a.actionPreparationActive = false;
  }

  _queueBallAction(a, action, targetX, targetY, payload) {
    const b = this.ball;
    if (
      b.owner !== a.id ||
      b.state !== "held" ||
      b.restartType ||
      this.t < (a.controlUntil || 0) ||
      !a.actionPreparationActive
    ) {
      return false;
    }
    const prep = ballActionPreparation({
      heading: a.heading,
      targetX,
      targetY,
      playerX: a.x,
      playerY: a.y,
      preferredFoot: a.preferredFoot,
      controlFoot: a.controlFoot,
      attrs: a.attr,
      action,
    });
    a.bodyTargetHeading = prep.targetHeading;
    if (prep.delay < 0.14) return false;
    a.pendingBallAction = {
      action,
      payload,
      readyAt: this.t + prep.delay,
      targetHeading: prep.targetHeading,
      weakFoot: prep.weakFoot,
    };
    a.intent = { type: "prepare", tx: a.x, ty: a.y };
    a.tx = a.x;
    a.ty = a.y;
    a.fsm = "turn";
    return true;
  }

  _runPendingBallAction(a) {
    const pending = a.pendingBallAction;
    if (!pending) return false;
    if (this.ball.owner !== a.id) {
      a.pendingBallAction = null;
      return false;
    }
    a.bodyTargetHeading = pending.targetHeading;
    a.tx = a.x;
    a.ty = a.y;
    a.fsm = "turn";
    if (this.t + 1e-9 < pending.readyAt) return true;
    a.pendingBallAction = null;
    if (pending.action === "pass") {
      this._pass(a, pending.payload, true);
    } else if (pending.action === "shot") {
      this._shoot(a, pending.payload, true);
    }
    return true;
  }

  _applyAttackTactics(a, phaseActor) {
    const tactics = this._teamTactics(a.team);
    const profile = this._shapeProfile(a.team);
    const phase = this._teamShapePhase(a.team);
    const isTransition = phase === TEAM_SHAPE_PHASES.ATTACKING_TRANSITION;
    const widthMul = isTransition
      ? profile.transition.attackWidthMul
      : profile.inPossession.widthMul;
    a.tx = clamp(50 + (a.tx - 50) * widthMul, 3, 97);

    const dir = this.attackDir(a.team);
    const style = tactics.style || "balanced";
    let depthShift = isTransition
      ? profile.transition.attackDepthShift
      : profile.inPossession.depthShift;
    if (!isTransition && style === "possession" && phaseActor && phaseActor.team === a.team) {
      // 控球风格缩短接应距离，形成更多稳定三角，而不是全员冲纵深。
      const pull = profile.inPossession.supportPull;
      a.tx = clamp(a.tx * (1 - pull) + phaseActor.x * pull, 3, 97);
      a.ty = clamp(a.ty * (1 - pull) + phaseActor.y * pull, 3, 97);
    }
    a.ty = clamp(a.ty + dir * depthShift, 3, 97);
    this._applyExplicitShapeAnchor(
      a,
      phase,
      isTransition ? 0.16 : 0.28
    );
    a.shapePhase = phase;
    this._clampOffside(a);
  }

  /**
   * 队级接应目标横向松弛：在本 tick 全部球员都提交完跑位目标之后运行一次。
   *
   * 逐球员的去拥挤（`off-ball-movement.js` 的分层）读的是队友**上一 tick** 的
   * 预留目标，同一 tick 内排在前面的球员看到的全是过期数据；而 `_clampOffside`
   * 又在分层之后把纵深投影到越位线上，把刚分开的接应点重新压回一起——实测标准档
   * 的「接应目标拥挤」全部 sources=["updated","updated"]（分层根本没触发），且每
   * 一对的实际间距恰好等于两人越位缓冲之差。
   *
   * 这里改为在所有目标定稿后统一处理：同时看到全部最终目标，不受提交顺序和过期
   * 影响。只沿横向移动，纵深保持在越位线上，因此不会让���员重新越位；配对顺序与
   * 分侧都由稳定的 id 决定，不消费随机数。
   */
  _separateSupportTargets() {
    const spacing = OFF_BALL_TARGET_DEFAULTS.supportSpacingMetres;
    const perUnitX = SIM.PITCH_W_METRES / SIM.FIELD_W;
    const perUnitY = SIM.PITCH_H_METRES / SIM.FIELD_H;
    // 分组口径与运动完整性检测一致：同队、同持球人。这里刻意**不**按阶段分组—���
    // `offBallTarget.phase` 记的是提交那一刻的阶段，而球员因决策节流在不同 tick
    // 提交，同一波进攻里存下的阶段并不相同；按阶段分组会把本该分开的两个接应点
    // 判成互不相干，正是此前拥挤修不掉的原因。
    const buckets = new Map();
    for (const a of this.agents) {
      if (a.sentOff || a.fsm !== "support" || !a.offBallTarget) continue;
      if (a.offBallTarget.ownerId == null) continue;
      const key = `${a.team}|${a.offBallTarget.ownerId}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = []));
      bucket.push(a);
    }

    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      bucket.sort((p, q) => p.tx - q.tx || String(p.id).localeCompare(String(q.id)));
      // 有界的 Gauss-Seidel：两人各让一半，最多 4 轮；提前收敛即退出。
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (let i = 0; i < bucket.length; i++) {
          for (let j = i + 1; j < bucket.length; j++) {
            const left = bucket[i];
            const right = bucket[j];
            const gapY = (left.ty - right.ty) * perUnitY;
            // 纵深本身已经拉开足够间距时不需要横向补偿。
            if (Math.abs(gapY) >= spacing) continue;
            const neededX = Math.sqrt(spacing * spacing - gapY * gapY);
            const gapX = (left.tx - right.tx) * perUnitX;
            const spread = Math.abs(gapX);
            if (spread >= neededX - 1e-6) continue;
            // 横向完全重合时按稳定 id 分侧，避免两点永久粘连。
            const side = spread > 1e-6
              ? Math.sign(gapX)
              : (String(left.id) < String(right.id) ? -1 : 1);
            const half = (neededX - spread) / 2 / perUnitX;
            left.tx = clamp(left.tx + side * half, 3, 97);
            right.tx = clamp(right.tx - side * half, 3, 97);
            moved = true;
          }
        }
        if (!moved) break;
      }
      // 预留目标必须跟着走，否则下一 tick 的分层仍会读到未松弛的坐标。
      for (const a of bucket) a.offBallTarget = { ...a.offBallTarget, x: a.tx };
    }
  }

  _commitOffBallTarget(a, phaseActor) {
    const previousTarget = a.offBallTarget;
    const previousOffer = previousTarget?.offer
      ? { ...previousTarget.offer, x: previousTarget.x, y: previousTarget.y } : null;
    const phase = this._teamShapePhase(a.team);
    const ownerId = this.ball.owner || this.ball.receiverId || phaseActor?.id || null;
    const reservations = [];
    for (const teammate of this.agents) {
      if (
        teammate.team === a.team &&
        teammate.id !== a.id &&
        teammate.offBallTarget
      ) {
        reservations.push(teammate.offBallTarget);
      }
    }
    // 接应有自己的线路续接规则；通用防折返租约不能先保留已经失效的旧点。
    const urgent = (a.offBallTargetKind === "one-two" && a.offBallTarget?.kind !== "one-two") ||
      !!previousOffer;
    let target = resolveOffBallTarget({
      now: this.t,
      player: a,
      candidate: { x: a.tx, y: a.ty, fsm: a.fsm, kind: a.offBallTargetKind },
      previous: a.offBallTarget,
      reservations,
      ball: this.ball,
      phase,
      ownerId,
      attackDirection: this.attackDir(a.team),
      urgent,
      lateralOnly: true,
    });
    a.tx = target.x;
    a.ty = target.y;
    a.fsm = target.fsm;
    this._clampOffside(a);
    a.offBallTarget = {
      ...target,
      x: a.tx,
      y: a.ty,
      playerId: a.id,
      team: a.team,
    };
    this._applySupportOffer(a, phaseActor, previousOffer);
  }

  // ——————————————————————————————————————————————
  // 推进一步（dt 秒）
  // ——————————————————————————————————————————————
  _processAdvantage() {
    const pending = this._advantage;
    if (!pending) return;
    const ball = this.ball;
    const victim = this.agentById(pending.victimId);
    const defender = this.agentById(pending.defenderId);
    if (!victim || !defender) {
      this._advantage = null;
      return;
    }
    const owner = ball.owner ? this.agentById(ball.owner) : null;
    const progress = forwardProgress({
      fromY: pending.startY,
      toY: ball.y,
      attackDirection: this.attackDir(pending.team),
    });
    const releasedForward =
      ball.kickTeam === pending.team &&
      ball.lastKicker === victim.id &&
      (ball.state === "pass" || ball.state === "shot");
    const played = releasedForward || (owner?.team === pending.team && progress >= 3.2);
    if (played) {
      this._advantage = null;
      this._emit("advantage_played", victim, {
        from: defender.id,
        reason: pending.reason,
        x: ball.x,
        y: ball.y,
      });
      this._emit("foul", defender, {
        from: victim.id,
        card: pending.card || "none",
        penalty: false,
        advantage: true,
        whistle: false,
        x: pending.x,
        y: pending.y,
      });
      return;
    }
    const broken = owner && owner.team !== pending.team;
    if (broken || this.t >= pending.until - 1e-9) {
      this._finalizeAdvantageFoul(pending);
    }
  }

  _finalizeAdvantageFoul(pending) {
    const defender = this.agentById(pending.defenderId);
    const victim = this.agentById(pending.victimId);
    this._advantage = null;
    if (!defender || !victim) return;
    this._emit("foul", defender, {
      from: victim.id,
      card: pending.card || "none",
      penalty: false,
      advantage: true,
      whistle: true,
      x: pending.x,
      y: pending.y,
    });
    this._restart(
      EDGE_RESTART_TYPES.DIRECT_FREE_KICK,
      victim.team,
      clamp(pending.x, 4, 96),
      clamp(pending.y, 4, 96)
    );
  }

  _ballFlightNearInteraction(dt) {
    const b = this.ball;
    const xScale = SIM.PITCH_W_METRES / SIM.FIELD_W;
    const yScale = SIM.PITCH_H_METRES / SIM.FIELD_H;
    const sx = b.x * xScale;
    const sy = b.y * yScale;
    const ex = (b.x + b.vx * dt) * xScale;
    const ey = (b.y + b.vy * dt) * yScale;
    if (ex < 0 || ex > SIM.PITCH_W_METRES || ey < 0 || ey > SIM.PITCH_H_METRES) return true;
    const dx = ex - sx;
    const dy = ey - sy;
    const lengthSquared = dx * dx + dy * dy || 1e-9;
    const minimumHeight = Math.min(b.z || 0, (b.z || 0) + (b.vz || 0) * dt - 9 * dt * dt);
    for (const agent of this.agents) {
      if (agent.sentOff) continue;
      if (minimumHeight > (agent.role === "GK" ? 3 : 2.2)) continue;
      const px = agent.x * xScale;
      const py = agent.y * yScale;
      const along = clamp(((px - sx) * dx + (py - sy) * dy) / lengthSquared, 0, 1);
      const nearestX = sx + dx * along;
      const nearestY = sy + dy * along;
      const interactionRadius = SIM.CONTROL_RADIUS_METRES + (agent.role === "GK" ? 2.4 : 2);
      if (Math.hypot(px - nearestX, py - nearestY) <= interactionRadius) return true;
    }
    return false;
  }

  _ballPhysicsFineReason(dt) {
    if (
      this.simulationProfile !== "background" ||
      dt <= SIM.DT + 1e-9 ||
      (this.celebrateUntil && this.t < this.celebrateUntil)
    ) {
      return null;
    }
    const b = this.ball;
    if (!b) return null;
    if (!b.owner && b.state === "shot") return "shot-flight";
    if (!b.owner && b.state === "pass" && this._ballFlightNearInteraction(dt)) {
      return "pass-interaction";
    }
    if (
      !b.owner &&
      b.state === "loose" &&
      pitchSpeedMps(b.vx, b.vy) > 1 &&
      this._ballFlightNearInteraction(dt)
    ) {
      return "loose-interaction";
    }
    return null;
  }

  _contactFineReason() {
    if (this.simulationProfile !== "background") return null;
    const b = this.ball;
    const owner = b.owner ? this.agentById(b.owner) : null;
    if (!owner) return null;
    const defendingTeam = owner.team === "home" ? "away" : "home";
    const tackleWindowOpen =
      this.t >= (this.deadBallUntil || 0) &&
      this.t >= (owner.protectUntil || 0) &&
      this.t - (this._teamAttackSince[owner.team] || 0) >= 6.5 &&
      this.t >= (this._teamTackleUntil[defendingTeam] || 0);
    for (const opponent of this.agents) {
      if (opponent.sentOff || opponent.team === owner.team) continue;
      const contestDistance = pitchDistanceBetween(opponent.x, opponent.y, owner.x, owner.y);
      if (
        opponent.role === "GK" &&
        contestDistance <= 7 &&
        this._goalkeeperCanPressure(opponent, owner)
      ) {
        return "goalkeeper-contest";
      }
      if (
        tackleWindowOpen &&
        opponent.role !== "GK" &&
        opponent.fsm === "press" &&
        this.t >= (opponent.tackleCdUntil || 0) &&
        contestDistance <= 3.2
      ) {
        return "close-contest";
      }
    }
    return null;
  }

  _goalkeeperNeedsFineMovement(agent, dt) {
    if (
      this.simulationProfile !== "background" ||
      dt <= SIM.DT + 1e-9 ||
      agent.role !== "GK" ||
      agent.sentOff
    ) {
      return false;
    }
    const b = this.ball;
    const goalY = this.ownGoalY(agent.team);
    const goalDistance = pitchDistanceBetween(b.x, b.y, 50, goalY);
    if (b.owner) {
      const owner = this.agentById(b.owner);
      return !!owner && owner.team !== agent.team && goalDistance <= 26;
    }
    if ((b.state === "pass" || b.state === "shot") && b.kickTeam !== agent.team) {
      return goalDistance <= 38;
    }
    return b.state === "loose" && goalDistance <= 22;
  }

  step(dt = SIM.DT) {
    const requestedDt = clamp(Number(dt) || SIM.DT, 1e-6, 0.5);
    const stats = this.integrationStats;
    stats.outerSteps++;
    stats.coarseSteps++;
    this._stepOnce(requestedDt);
  }

  _stepOnce(dt) {
    this._activeStepDt = dt;
    this._motionStepEpoch = (this._motionStepEpoch || 0) + 1;
    // 进球庆祝段：球钉在网里，队友聚拢，结束后再中圈开球
    if (this.celebrateUntil && this.t < this.celebrateUntil) {
      this._tickCelebrate(dt);
      this._recordTeamShapeEvidence(dt);
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

    // 点球是独立死球阶段：先保持合法站位，再助跑、出脚和结算。
    // 这段时间不运行普通决策/抢球，确保直播与回放能实际录到点球过程。
    if (this.pendingPenalty) {
      this._tickPenalty(dt);
      this._recordTeamShapeEvidence(dt);
      this.t += dt;
      return;
    }

    this._processAdvantage();

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
      this._teamGainAt[controlTeam] = this.t;
      this._teamLoseAt[controlTeam === "home" ? "away" : "home"] = this.t;
      this._defPlans.home.until = 0;
      this._defPlans.away.until = 0;
      for (const a of this.agents) a.attackThinkUntil = 0;
    }
    this._refreshTeamShapePhases(controlTeam || this._phaseTeam || this.possession);
    this._recordTeamShapeEvidence(dt);
    this._stepPressing.home = this._tacticLevel("home", "pressing");
    this._stepPressing.away = this._tacticLevel("away", "pressing");
    this._stepDefContext = null;
    this.possession = controlTeam || this.possession;
    // 控球时间积分（秒）：供战报/计分板同源，而非事后按射门份额捏造
    if (
      (this.possession === "home" || this.possession === "away") &&
      !(this.celebrateUntil && this.t < this.celebrateUntil)
    ) {
      this.stats[this.possession].poss += dt;
    }
    this._samplePossession();
    for (const a of this.agents) {
      this._think(a, dt, owner, controlTeam, phaseActor);
      const target = cornerMovementTarget(this._cornerRoutine, a, this.ball, this.agents, this.t);
      if (target) {
        a.tx = target.x;
        a.ty = target.y;
        a.offBallTarget = null;
      }
      a._cornerArrivalAt = target && this.ball.state === "pass" && this._cornerRoutine?.runs.has(a.id)
        ? this.ball.expectedAt : null;
    }
    this._separateSupportTargets();
    // 球与球员共用接触时钟。否则先走完 0.3s 的球员会在第一个 0.1s
    // 球子步中提前触球。决策保持外层频率，低风险区间仍只积分一次。
    const physicsReason = this._ballPhysicsFineReason(dt);
    const physicsSubsteps = physicsReason
      ? Math.max(2, Math.ceil(dt / SIM.DT - 1e-9))
      : 1;
    const physicsDt = dt / physicsSubsteps;
    if (physicsReason) {
      this.integrationStats.fineSteps += physicsSubsteps;
      this.integrationStats.fineIntervals++;
      this.integrationStats.fineSeconds += dt;
      this.integrationStats.reasons[physicsReason] =
        (this.integrationStats.reasons[physicsReason] || 0) + 1;
    }
    const stepStartedAt = this.t;
    for (let index = 0; index < physicsSubsteps; index++) {
      this.t = stepStartedAt + index * physicsDt;
      this._activeStepDt = physicsDt;
      // 见 `_emit`：子步内发出的事件描述的是这一步之后的几何，时间戳要相应前推。
      this._emitTimeOffset = physicsDt;
      // 每次新运动都重置分离预算，不能把前一子步的正常位移当作碰撞修正。
      if (index > 0) this._motionStepEpoch++;
      for (const a of this.agents) {
        if (this._goalkeeperNeedsFineMovement(a, physicsDt)) {
          const movementSubsteps = Math.max(2, Math.ceil(physicsDt / SIM.DT - 1e-9));
          const movementDt = physicsDt / movementSubsteps;
          for (let movement = 0; movement < movementSubsteps; movement++) this._integrate(a, movementDt);
          this.integrationStats.reasons["goalkeeper-motion"] =
            (this.integrationStats.reasons["goalkeeper-motion"] || 0) + 1;
        } else {
          this._integrate(a, physicsDt);
        }
      }
      this._separateAgents(this.separationPasses, physicsDt, this._motionStepEpoch);
      const contactReason = this._contactFineReason();
      this._activeStepDt = contactReason ? Math.min(SIM.DT, physicsDt) : physicsDt;
      if (contactReason) {
        this.integrationStats.reasons[contactReason] =
          (this.integrationStats.reasons[contactReason] || 0) + 1;
      }
      const restartBeforeContact = this._restartStepEpoch || 0;
      this._stepBall(physicsDt);
      this._resolvePossession(physicsDt);
      this._resolveBounds();
      // 接球、折射与扑救仍消耗余下时间；只有新重启/点球/进球结束旧场景。
      if (this.pendingPenalty || this.celebrateUntil || (this._restartStepEpoch || 0) !== restartBeforeContact) break;
    }
    this._emitTimeOffset = 0;
    this.t = stepStartedAt;
    this._activeStepDt = dt;
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
          const outId = s.outId;
          const inn = s.player;
          if (this.substituteAgent(outId, inn)) {
            // 与 match 层换人记账对齐：热替换真正进场时再发事件（约伤后 40s）
            const a = this.agentById(inn?.id);
            this._emit("sub_on", a, {
              outId,
              inId: inn?.id || null,
              team: a?.team || null,
            });
          }
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
    a.shapePhase = this.teamPhases[a.team] || this._teamShapePhase(a.team, controlTeam || this._phaseTeam);
    if (a.sentOff) {
      // 被罚下：走向边线外并停住，不再参与任何决策/跑位。
      a.tx = a.team === "home" ? 1 : 99;
      a.ty = clamp(a.y, 4, 96);
      a.fsm = "off";
      a.intent = null;
      a.offBallTarget = null;
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
      a.offBallTarget = null;
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
      a.offBallTarget = null;
      return;
    }

    // 只有真正失去控制的 loose ball 才进入争抢；传球飞行仍保持原攻防结构。
    if (!controlTeam && !owner && this.t >= (this.deadBallUntil || 0)) {
      a.offBallTarget = null;
      return this._thinkLoose(a);
    }

    const hasBall = b.owner === a.id;
    const teamHasBall = controlTeam === a.team;
    if (!hasBall) {
      if (a.pendingBallAction) a.pendingBallAction = null;
      a.actionPreparationActive = false;
    }

    if (hasBall) {
      a.offBallTarget = null;
      if (b.state === "control" && this.t < (a.controlUntil || 0)) {
        a.tx = a.x;
        a.ty = a.y;
        a.fsm = "receive";
        return;
      }
      if (this._runPendingBallAction(a)) return;
      // 门将进入近身封角范围时，持球者必须及时感知并重算射/传/带选择。
      // 接球后的常规决策节流不能让门将在一两秒内单方面完成出击。
      const defendingGk = this._teamGk(a.team === "home" ? "away" : "home");
      if (
        defendingGk &&
        !defendingGk.sentOff &&
        this._goalkeeperCanPressure(defendingGk, a) &&
        dist(defendingGk.x, defendingGk.y, a.x, a.y) < 7
      ) {
        const reactionDelay = clamp(
          0.34 - ((a.attr.decisions || 0.55) - 0.55) * 0.2,
          0.2,
          0.4
        );
        a.decisionUntil = Math.min(
          Number.isFinite(a.decisionUntil) ? a.decisionUntil : Infinity,
          this.t + reactionDelay
        );
      }
      // 飞行中的球没有 owner，这里 owner===a 一定是脚下控球
      if (this.t >= a.decisionUntil) {
        const tempo = this._tacticLevel(a.team, "tempo");
        a.decisionUntil =
          this.t +
          clamp(1.2 - (tempo - 3) * 0.08, 0.88, 1.5) +
          this.random() * 0.9;
        this._decideOnBall(a);
      }
      // 执行上次意图（盘带/护球朝目标带球；传/射在 decide 内瞬时触发）
      if (a.intent && (a.intent.type === "dribble" || a.intent.type === "hold")) {
        a.tx = a.intent.tx;
        a.ty = a.intent.ty;
        if (a.intent.type === "hold") {
          const nearest = this._nearestOpponent(a);
          a.bodyTargetHeading = nearest
            ? Math.atan2(a.y - nearest.opponent.y, a.x - nearest.opponent.x)
            : Math.atan2(a.ty - a.y, a.tx - a.x);
        } else if (Math.hypot(a.tx - a.x, a.ty - a.y) > 0.05) {
          a.bodyTargetHeading = Math.atan2(a.ty - a.y, a.tx - a.x);
        }
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
          this.random() * 0.5;
        this._thinkAttackOffBall(a, phaseActor);
        this._applyAttackTactics(a, phaseActor);
        this._commitOffBallTarget(a, phaseActor);
      }
      return;
    }
    a.offBallTarget = null;
    return this._thinkDefend(a, phaseActor);
  }

  /** 门将：持球时开球分发（重置攻防），否则守门站位（绝不能离门太远） */
  _thinkGK(a, owner) {
    const goalY = this.ownGoalY(a.team);
    const b = this.ball;
    // ⚠ 门将出击方向 = **进攻方向**（朝场内推进），不是它的反向。
    // 曾误按注释「出击方向朝场内」推成 `-attackDir`，实测逐位对比第一帧
    // 就把 GK 的 ty 从 93.05 改成 99.0（贴到门线上）——见
    // scripts/_gody-refactor-bitwise-check.mjs。这里保持与旧式
    // `a.team === "home" ? -1 : 1` 完全等价。
    const facing = this.attackDir(a.team);
    const sweep = this._roleBehavior(a, "sweep");
    const maxAdvance = 11 + sweep * 4; // 出击职责只扩大真实活动区，不改扑救能力
    // 门将活动区：永远贴在球门前（主队 y 大、客队 y 小）。
    // 下界 2 格 = 2.1m，意味着门将**永远碰不到自己的门线**。真实门将球到禁区时
    // 就站在线上。收到 1 格（1.05m），下面的兜底分支才可能真的贴线。
    // `goalY + facing * d` 中 facing = 进攻方向 ⇒ 该式一律表示「离门线 d 格、
    // 在场地内侧」，主客同式，换边后自动跟着 `ownGoalY` 一起翻。
    // ⚠ 2026-09-22 修：原来按**队名**分支（`a.team === "home" ? … : …`）。`goalY` 已随
    //   `endsSwapped` 翻转，钳位窗口却仍按队名取「内侧」⇒ 下半场两名门将都被钳到门线外
    //   （实测 swap 下 home GK ty=-1.00、away GK ty=+101.00，整半场站在球网里）。
    //   下面 :2322-2323 的注释本来就写的是这个式子：`facing` = 进攻方向 ⇒
    //   `goalY + facing*d` 一律表示「离门线 d 格、在场地内侧」，主客同式、换边自动跟随。
    //   `endsSwapped=false` 下与旧实现逐位等价（home: facing<0；away: facing>0）。
    const clampGkY = (ty) =>
      facing < 0
        ? clamp(ty, goalY - maxAdvance, goalY - 1)
        : clamp(ty, goalY + 1, goalY + maxAdvance);

    // —— 门将持球：护球够久再开球（避免与前锋贴脸「传球互动」）——
    if (b.owner === a.id) {
      if (b.state === "control" && this.t < (a.controlUntil || 0)) {
        a.tx = a.x;
        a.ty = a.y;
        a.fsm = "receive";
        return;
      }
      if (this.t >= a.decisionUntil) {
        a.decisionUntil = this.t + 0.55 + this.random() * 0.35;
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
      const desiredAdvance = clamp(12 - throughGoalDist * 0.16 + sweep * 2, 2, maxAdvance);
      // 目标点必须在预计接球点与球门之间；旧逻辑在接球点很深时会让门将
      // 主动跑到球后方，前锋尚未做动作就被制造成空门。
      const advance = clamp(
        Math.min(desiredAdvance, Math.max(1.2, throughGoalDist - 1.2)),
        1.2,
        maxAdvance
      );
      a.tx = clamp(throughTargetX, 38, 62);
      a.ty = clampGkY(goalY + facing * advance);
      a.fsm = "press";
      return;
    }

    // 出击扑空后需要真实起身，不能下一帧立刻恢复满速封角或连续掷收球骰。
    if (this.t < (a.challengeRecoverUntil || 0)) {
      a.tx = a.x;
      a.ty = a.y;
      a.fsm = "recover";
      return;
    }

    // 射门飞行时按当前速度投影门线落点。扑救仍由真实轨迹、可达范围和
    // 门将属性结算；这里仅让门将提前朝可见球路移动，不等球到了身边才反应。
    if (b.state === "shot" && b.kickTeam !== a.team && !b.owner) {
      // 「朝本方门飞」= vy 的符号与进攻方向相反
      const towardGoal = facing * b.vy < -1.2;
      if (towardGoal) {
        const lineTime = (goalY - b.y) / (b.vy || 1e-6);
        if (lineTime >= 0 && lineTime <= 2.2) {
          const projectedX = b.x + b.vx * lineTime;
          const flightLeft = clamp(lineTime, 0, 1.4);
          const reactionShare =
            0.32 + (a.attr.reflexes || 0.5) * 0.3;
          a.tx = clamp(a.x + (projectedX - a.x) * reactionShare, 36, 64);
          a.ty = clampGkY(goalY + facing * clamp(3 + flightLeft * 2.2, 3, 6));
          a.fsm = "save";
          return;
        }
      }
    }

    // —— 守门站位 + 小幅出击 ——
    const dGoal = dist(b.x, b.y, 50, goalY);
    const underThreat = owner && owner.team !== a.team && dGoal < 22;
    if (underThreat) {
      const vx = b.x - 50,
        vy = b.y - goalY;
      const len = Math.hypot(vx, vy) || 1;
      // 封角：门将必须站在「射门点 → 球门中心」这条线上，而不是站在门中间等球。
      // 旧实现横向只走 advance*0.45，等于几乎不离开中路：实测进攻者杀到 8 米内
      // 时门将仍在门线前 5.8 米、横向偏移仅 1.6 米，射门线路距离 3.05 米始终小于
      // 可达范围 5.66 米——引擎判定「够得着」，于是既不出击也不封角，
      // 但画面上球门两侧全是空的。现在沿这条线站位，越近越贴线。
      const laneShare = clamp(0.55 + (1 - clamp(dGoal / 22, 0, 1)) * 0.4, 0.55, 0.95);

      // 出击距离：近距离一对一时真正压出去缩小射门角度。
      // 只有确实是单刀（持球者身边没有己方防守者）才敢大幅出击，
      // 否则贴着门线附近，避免被一脚分球打成空门。
      let coverNearBall = 0;
      for (const d of this.agents) {
        if (d.team !== a.team || d.role === "GK" || d.sentOff) continue;
        if (pitchDistanceBetween(d.x, d.y, b.x, b.y) < 3.2) coverNearBall++;
      }
      const isolated = coverNearBall === 0;
      // 无人协防且球已进到 13 米内：出击上限抬到 11（真实门将会主动缩小角度）。
      // 有人协防时保持原来的克制值 7，让防守者去处理。
      const advanceCap = isolated && dGoal < 13 ? 11 + sweep * 2 : 7;
      const desiredAdvance = clamp(
        (isolated ? 11 : 8) - dGoal * 0.2 + sweep * 1.6,
        1.1,
        advanceCap
      );
      const advance = clamp(
        // 绝不越过球：越过之后就是真空门
        Math.min(desiredAdvance, Math.max(1.1, dGoal - 1.1)),
        1.1,
        advanceCap
      );
      a.tx = clamp(50 + (vx / len) * (advance * laneShare), 38, 62);
      a.ty = clampGkY(goalY + facing * advance);
      a.fsm = this._inOwnPenaltyArea(a.team, b.x, b.y, 1) ? "smother" : "press";
      return;
    }
    // 常规：门线前跟球横向移动。横向跟随收窄到 0.72——门将横移幅度本来就小于
    // 球的横移，站到与球同一 x 会把近角完全让开。
    //
    // ⛔ 旧实现有两处硬伤，实测（`scripts/_box-marking-probe.mjs`，6 场）：
    //    **36.7% 的采样里门将站在自家门柱之外**，离门线中位 6.26m。
    //    1) `clamp(…, 40, 60)`：40 已经在 `GOAL_X0 = 44` 之外，球从边路来时
    //       `50 + (22-50)*0.72 = 29.8` 被夹到 40，人就站到近柱外面，远角整个空着。
    //       横向范围必须留在门框内——门将覆盖的是球门，不是球。
    //    2) `depth = threat ? 7 : 4` 是**格数常量**，等于 7.35m / 4.2m，
    //       与球离门多远无关。真实门将球到禁区时贴到门线 1~3m，球远了才当清道夫出来。
    //       改成按**米**随球距线性内收。
    // 这条兜底分支覆盖了所有传中、所有无主球、所有边路带球（`underThreat` 需要
    // 真实的 `owner`，而飞行中 `ball.owner` 是 null），所以它就是画面的常态。
    const dGoalM = pitchDistanceToGoalMetres(b.x, b.y, goalY);
    const depthM = clamp(1.0 + dGoalM * 0.12, 1.0, 9);
    a.tx = clamp(50 + (b.x - 50) * 0.72, SIM.GOAL_X0, SIM.GOAL_X1);
    a.ty = clampGkY(goalY + facing * (depthM / (SIM.PITCH_H_METRES / SIM.FIELD_H)));
    a.fsm = "home";
  }

  /**
   * 门将分发：近身压迫时大脚解围，否则优先短传发动。
   * 大脚必须落在场内可争顶/可接的通道——旧实现固定瞄 x=22/78 且力量 30–44，
   * 落地后仍带 ~20 速度，经常直接滚出边线（用户可见的「门将开大脚出界」）。
   */
  _gkDistribute(a) {
    const b = this.ball;
    let pressureNear = 0;
    let nearestOpp = 99;
    for (const o of this.agents) {
      if (o.team === a.team || o.role === "GK" || o.sentOff) continue;
      const dOpp = dist(o.x, o.y, a.x, a.y);
      if (dOpp < nearestOpp) nearestOpp = dOpp;
      // 9 码内才算贴身压迫（旧 11 过宽，门球时前场逼抢也常误触大脚）
      if (dOpp < 9) pressureNear++;
    }
    // 「贴身压迫」只应该指对手真的扑到门将脚下。旧阈值 6.5 格（纵向 ≈ 6.5 m）
    // 把**站在禁区线外的逼抢前锋**也算成贴身：实测门球时对方中锋固定站在
    // (50, 83.5)/(50, 16.5)，离门将 6.0~6.3 格，于是 113 次出球里 112 次判为贴身、
    // 短传分支从未触发过（`scripts/_gk-kick-and-ball-jump-probe.mjs`）。
    // 而那个站位本身是合法且真实的（禁区线在 y=84/16，他在线外高位逼抢），
    // 真实门将在这种情况下照样短传给拉边的中卫。所以门槛收到 4 格 ≈ 4 m，
    // 只有对手确实扑到跟前才放弃出脚选择，其余交给 `_bestPass` 自己的传球线路评估。
    const underHeavyPressure = nearestOpp < 4 || pressureNear >= 2;
    const prefersShort = this._hasHabit(a, "distributes_short") || this._roleBehavior(a, "shortDistribution") > 0.15;
    const launchesCounters = this._hasHabit(a, "launches_counters");
    const bypassBuildUp = launchesCounters && !underHeavyPressure && this.random() < 0.62;
    const passTo = underHeavyPressure || bypassBuildUp ? null : this._bestPass(a);
    // 有安全接球人且不太靠后 → 手抛/短传发动进攻
    if (passTo && passTo.value > (prefersShort ? 0.15 : 0.22) - this._roleBehavior(a, "shortDistribution") * 0.04) {
      const recv = passTo.agent;
      const recvOk =
        recv &&
        // 接球人不能太靠前：必须在「距己方门 ≥ 18 格」的**门那一侧**之外
        // ⇒ 取反。原式 `home ? recv.y < 82 : recv.y > 18` 就是这个意思。
        !this._onOwnSide(recv.y, a.team, 18) &&
        dist(recv.x, recv.y, a.x, a.y) > 8;
      if (recvOk) {
        this._pass(a, passTo);
        return;
      }
    }

    // —— 大脚解围：瞄中场安全通道，优先落点靠近本方前插队友 ——
    // 落点横向夹在 x∈[30,70]，远离边线给落地滚动留余量；纵向见下面的 yLo/yHi。
    const dir = this.attackDir(a.team); // home 攻 y↓ 为 -1
    // 落点纵向允许区间：往前落在中线前后（真实的受压解围就落在那一带），
    // 往后只留 5 格余量给「只能往回摆」的极端情形，不再允许把球开进本方半场深处。
    // 旧实现把两端硬夹在 [38,62]（中三区），实测 113 脚 100% 落在那个盒子里、
    // 38% 还落在本方半场（`scripts/_gk-kick-and-ball-jump-probe.mjs`）。
    // 近端取 30 而不是 22：22 会把受压解围直接送到对方半场深处，与「门将会短传」
    // 那一处叠起来多出 +0.66 球（两处单独跑都不破顶，合并 3.33 破顶 3.3）。
    // ⚠ 别再拿这个近端去凑进球：22/30/36 三档实测 3.33/3.08/3.21 **不单调**，
    // 那是固定种子下的混沌重掷，不是响应曲线，拧它等于拟合种子噪声。
    // 落点纵向区间改成「距己方门」纵深，主客不再需要两套数字：
    // 原式 `home ? [30,55] : [45,70]` 恰好互为镜像（100-55=45 / 100-30=70）。
    // ⚠ 注意 `yLo`/`yHi` 是**区间下界/上界**（clamp 用的字面大小顺序），
    // 不是「近端/远端」。home 下两者同向（y 越小越靠前），away 下反向，
    // 所以必须取 min/max，不能按「远端在前」写死顺序。
    const depthOf = (y) => this._depthFromOwnGoal(y, a.team);
    const yFar = this._ownGoalSideY(a.team, 45); // 纵深 45 = 距己方门更远
    const yNear = this._ownGoalSideY(a.team, 70); // 纵深 70 = 距己方门更近
    const yLo = Math.min(yFar, yNear);
    const yHi = Math.max(yFar, yNear);
    const DEPTH_NEAR = 70; // 纵深上界（离己方门最远 70 格 = 越过中线 20 格）
    const DEPTH_FAR = 45; // 纵深下界（必须在己方门 45 格之外 = 过中线）
    let targetX = 50;
    let targetY = clamp(50 + dir * 8, yLo, yHi);
    let receiver = null;
    let bestScore = -Infinity;
    for (const m of this.agents) {
      if (m === a || m.team !== a.team || m.role === "GK" || m.sentOff) continue;
      // 必须明显离开门区，朝进攻方向推进（纵深差 > 0 = m 比 a 更靠前）
      const progress = depthOf(m.y) - depthOf(a.y);
      if (progress < 14) continue;
      // 还必须已经推到中线附近（纵深 ≥ 45）：只要求「比门将靠前 14 格」时，
      // 本方半场里最居中的那个中场就能当选，于是落点被 clamp 拉回本方半场。
      const beyondOwnHalf = depthOf(m.y) >= DEPTH_FAR;
      if (!beyondOwnHalf) continue;
      // 偏好半身位更居中的通道，极端贴边会滚出界
      const central = 1 - Math.min(1, Math.abs(m.x - 50) / 42);
      const roleBonus = m.role === "MID" ? 8 : m.role === "ATT" ? 4 : 1;
      const score = progress * 0.5 + central * 22 + roleBonus;
      if (score > bestScore) {
        bestScore = score;
        // 落点略向中路收，略前于接应者；硬夹在安全区内
        const inward = m.x < 50 ? 1 : m.x > 50 ? -1 : 0;
        targetX = clamp(m.x + inward * 6, 30, 70);
        targetY = clamp(m.y + dir * 2, yLo, yHi);
        receiver = m;
      }
    }
    if (!receiver) {
      // 无人可瞄：开向中路偏一侧的安全通道（绝不到旧实现的 22/78 贴边）
      const sideBias = (b.x >= 50 ? 1 : -1) * (0.45 + this.random() * 0.4);
      targetX = clamp(50 + sideBias * (8 + this.random() * 10), 32, 68);
      // 符号修正：旧写法是 `dir * -(5+…)`，与上面瞄接应人那处的 `dir * +2` 相反，
      // 等于把球开向**本方**半场。dir 对 home 是 -1，所以要往前必须是 `dir * +X`。
      targetY = clamp(50 + dir * (5 + this.random() * 8), yLo, yHi);
    }

    const dx = targetX - b.x;
    const dy = targetY - b.y;
    const distanceM = pitchDistanceMetres(dx, dy);
    const kick = a.attr.kicking || 0.5;
    // 门将大脚同样按米制距离给力，避免斜向或横向落点改变实际速度。
    const powerMps = clamp(13 + distanceM * 0.25, 18, 27) * (0.92 + 0.1 * kick);
    const kickVelocity = pitchVelocityForMps(dx, dy, powerMps);
    const errMps = (1 - kick) * 2.4;
    const nx = (this.random() - 0.5) * errMps * (SIM.FIELD_W / SIM.PITCH_W_METRES);
    const ny = (this.random() - 0.5) * errMps * (SIM.FIELD_H / SIM.PITCH_H_METRES);

    // 先清旧传球/越位快照，再写入本脚大脚落点（门将开球依法不受越位限制）
    this._clearBallTarget();
    b.owner = null;
    b.vx = kickVelocity.vx + nx;
    b.vy = kickVelocity.vy + ny;
    b.z = 0.35;
    // 吊高越过第一波逼抢；峰值受控，落地残速不会像旧大脚那样滚出边线
    b.vz = clamp(7.5 + distanceM * 0.08 + kick * 2, 8.5, 13.5);
    b.receiverId = receiver?.id || null;
    b.targetX = targetX;
    b.targetY = targetY;
    b.expectedAt = this.t + clamp(
      estimateBallArrivalSeconds(distanceM, pitchSpeedMps(b.vx, b.vy), b.z, b.vz),
      0.4,
      3.4
    );
    b.lastKicker = a.id;
    b.kickTeam = a.team;
    b.kickX = b.x;
    b.kickY = b.y;
    b.state = "pass";
    b.isThroughPass = false;
    b.isCrossPass = false;
    b.offsideExemptRestart = false;
    b.restartType = null;
    if (receiver) {
      receiver.intent = {
        type: "receive",
        tx: targetX,
        ty: targetY,
        targetId: receiver.id,
      };
      receiver.tx = targetX;
      receiver.ty = targetY;
      receiver.fsm = "receive";
      receiver.attackThinkUntil = (b.expectedAt || this.t) + 0.5;
    }
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
      // 传中落点锚在**对方**禁区线附近（距对方门 14 格）。
      const boxY = this._oppGoalSideY(a.team, 14);
      this._cornerAttackUntil[a.team] = this.t + 14;
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
          tx: clamp(50 + (this.random() - 0.5) * 12, 38, 62),
          ty: clamp(boxY + (this.random() - 0.5) * 6, 8, 92),
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
      // 任意球吊传同样锚在**对方**禁区线附近（距对方门 14 格）。
      const fkBoxY = this._oppGoalSideY(a.team, 14);
      // 吊传定位球进入独立威胁窗口，训练/主罚质量会影响后续处理。
      this._cornerAttackUntil[a.team] = this.t + 14;
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
              tx: clamp(50 + (this.random() - 0.5) * 12, 40, 60),
              ty: clamp(fkBoxY + (this.random() - 0.5) * 6, 8, 92),
            }
      );
      return;
    }

    // 间接任意球首脚必须传给队友；只有下一名球员触球后才能形成合法射门。
    if (
      b.restartType === EDGE_RESTART_TYPES.INDIRECT_FREE_KICK &&
      b.owner === a.id
    ) {
      if (this.t < (this.deadBallUntil || 0)) {
        a.intent = { type: "hold", tx: a.x, ty: a.y };
        a.fsm = "carry";
        return;
      }
      let restartPass = this._bestPass(a);
      if (!restartPass) {
        const teammate = this.agents
          .filter((m) => m.team === a.team && m.id !== a.id && !m.sentOff)
          .sort(
            (left, right) =>
              pitchDistanceBetween(a.x, a.y, left.x, left.y) -
                pitchDistanceBetween(a.x, a.y, right.x, right.y) ||
              String(left.id).localeCompare(String(right.id))
          )[0];
        if (teammate) {
          restartPass = {
            agent: teammate,
            value: 1,
            through: false,
            cross: false,
            tx: teammate.x,
            ty: teammate.y,
          };
        }
      }
      if (restartPass) this._pass(a, restartPass);
      return;
    }

    const opportunity = this._goalOpportunity(a);
    const goalY = this.targetGoalY(a.team);
    const goalX = 50;
    const dGoal = opportunity.dGoal;
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

    // 开球同理：真实开球几乎总是一脚短传。开球没有 restartType（`_kickoff` 显式清空），
    // 所以走一个自带时限的独立标志，见 `_kickoff` 里的说明。
    // 没有这一条时，开球会掉进普通运动战逻辑，而队友全在球身后 → `advance` 为负 →
    // 传球价值被压到 ±0.05（正常运动战 0.4~0.85），于是常常选成护球或后撤。
    if (this.t < (b.kickoffPassUntil || 0)) {
      const cands = this._passCandidates(a);
      const target =
        (b.kickoffMateId && cands.find((c) => c.agent.id === b.kickoffMateId)) || cands[0] || null;
      if (target) {
        b.kickoffPassUntil = 0;
        b.kickoffMateId = null;
        this._pass(a, target);
        return;
      }
    }

    // 近射区：前锋/任何人；中场/核心/边锋内切弧顶稍大
    const isMid = a.role === "MID";
    const isAtt = a.role === "ATT";
    const isFb = this._isFullback(a);
    const isWing = this._isWinger(a);
    const roleWidth = this._roleBehavior(a, "width");
    const habitCutsInside = this._hasHabit(a, "cuts_inside");
    const habitHugsLine = this._hasHabit(a, "hugs_line");
    const cutsInside = habitCutsInside || (!habitHugsLine && roleWidth < -0.3);
    const hugsLine = habitHugsLine || (!habitCutsInside && roleWidth > 0.35);
    const runsWithBall = this._hasHabit(a, "runs_with_ball");
    const shootsFromDistance = this._hasHabit(a, "shoots_from_distance");
    const roleCarry = this._roleBehavior(a, "carry");
    const roleCross = this._roleBehavior(a, "cross");
    const roleShoot = this._roleBehavior(a, "shoot");
    const rolePassRisk = this._roleBehavior(a, "passRisk");
    // 边锋内切：x 已靠中时射门区更大；贴边时仍要先内切
    const cutInProgress = isWing ? clamp(1 - Math.abs(a.x - goalX) / 38, 0, 1) : 0;
    const SHOOT_ZONE = core ? 28 : isWing ? 22 + cutInProgress * 6 : isMid ? 24 : 20;
    const angF = clamp(1 - Math.abs(a.x - goalX) / 26, 0, 1);
    const inShootZone = dGoal < SHOOT_ZONE && angF > (isWing ? 0.1 : 0.12);

    // ——————————— 近距离/弧顶射门区 ———————————
    if (inShootZone) {
      // 全队射门节奏上限只管常规进攻；已杀到真正近门区（dGoal<9.5）允许起脚，
      // 否则冷却期内持球者在门前无动作可选 → 底线僵持（看门狗曾兜底的根因）。
      const cdBlocked = this.t < (this._teamShotUntil[a.team] || 0);
      const setPieceChance = this.t < (this._cornerAttackUntil[a.team] || 0);
      const canShoot =
        this.t >= (a.shotCdUntil || 0) &&
        (opportunity.clearOpenGoal || !cdBlocked || dGoal < 9.5 || setPieceChance || this._hasCloseShotWindow(a)) &&
        (opportunity.clearOpenGoal || attackAge >= 3.5 || dGoal < 9.5);
      const distF = clamp(1 - dGoal / SHOOT_ZONE, 0, 1);
      const finBias = isMid && !isWing
        ? 0.35 * a.attr.finishing + 0.45 * a.attr.shooting
        : isWing
          ? 0.4 * a.attr.finishing + 0.4 * a.attr.shooting + 0.15 * a.attr.dribbling
          : 0.55 * a.attr.finishing + 0.25 * a.attr.shooting;
      let shootQuality =
        (0.45 * distF + 0.44 * angF) * (0.5 + finBias) * (1 - pressure * 0.34);
      if (core) shootQuality *= 1.35; // 核心：球权在自己脚下更敢射
      if (isWing) shootQuality *= 1.12 + cutInProgress * 0.2; // 内切后敢抽射
      const attackMod = this._teamModifier(a.team, "atk");
      const chanceMod = this._teamModifier(a.team, "chance");
      const setpieceMod = setPieceChance ? this._teamModifier(a.team, "setpiece") : 1;
      shootQuality *= attackMod * setpieceMod;

      const passTo = this._bestPass(a);
      let passQuality = passTo ? passTo.value * (0.6 + 0.4 * a.attr.vision) : 0;
      passQuality *= Math.sqrt(attackMod);
      // 核心：除非传球质量碾压，否则优先自己解决
      if (core) passQuality *= 0.72;
      // 边锋：禁区附近仍会分中路队友，但不轻易放弃自己机会
      if (isWing && passTo?.agent?.role === "ATT" && !this._isWinger(passTo.agent)) {
        passQuality *= 1.15;
      }

      const shootThresh = core ? 0.26 : isWing ? 0.28 : isMid && dGoal > 16 ? 0.30 : 0.34;
      // 旧逻辑一旦质量过线便必射，导致每场数百脚。现在质量只决定“是否值得考虑”，
      // 最终仍需一次低频机会选择；越近、越强的终结者越敢起脚。
      // 约 10~22 距离的窗口反而略积极：避免强队总是一路带到六码区才射，
      // 既让画面更像正常攻门，也把机会质量拉回合理范围。
      const rangeBonus = dGoal >= 9.5 && dGoal <= 22 ? 0.18 : dGoal < 9.5 ? 0.08 : 0;
      // 穿透全队冷却的门前射门是"保活性"的例外通道，不是常规机会：
      // 概率重压（×0.3），大部分冷却期门前球走下方泄压阀（传中/回做）出球。
      const shootDecisionP =
        clamp(
          0.035 + shootQuality * 0.10 + rangeBonus + roleShoot * 0.03 + (setPieceChance ? 0.08 : 0),
          0.022,
          setPieceChance ? 0.42 : 0.38
        ) *
        (cdBlocked && !setPieceChance ? 0.3 : 1) * chanceMod;
      const clearCloseChance = dGoal < 13 && angF > 0.16 && pressure < 0.9;
      const openGoalDecisionP = clamp(
        0.78 +
          (a.attr.decisions || 0.55) * 0.12 +
          (a.attr.finishing || 0.55) * 0.1 +
          clamp(1 - dGoal / 18, 0, 1) * 0.08 -
          pressure * 0.12,
        0.72,
        0.98
      );
      const canRoundKeeper =
        this._hasHabit(a, "rounds_keeper") &&
        opportunity.goalkeeper &&
        !opportunity.openGoal &&
        dGoal < 13 &&
        opportunity.keeperDepth > 5 &&
        opportunity.keeperProjection > 0.14 &&
        pressure < 0.66;
      if (canRoundKeeper && this.random() < 0.18 + a.attr.dribbling * 0.08) {
        const keeperSide = opportunity.goalkeeper.x >= a.x ? -1 : 1;
        a.intent = {
          type: "dribble",
          tx: clamp(a.x + keeperSide * (5 + a.attr.dribbling * 3), 5, 95),
          ty: clamp(a.y + dir * clamp(dGoal - 5, 2.5, 6), 3, 97),
        };
        a.decisionUntil = Math.min(a.decisionUntil || Infinity, this.t + 0.42);
        a.fsm = "carry";
        return;
      }
      let takeShot = false;
      if (canShoot) {
        if (opportunity.clearOpenGoal) {
          takeShot = this.random() < openGoalDecisionP;
        } else if (
          clearCloseChance ||
          (shootQuality > shootThresh &&
            shootQuality >= passQuality * (core ? 0.7 : isWing ? 0.78 : 0.85))
        ) {
          takeShot = this.random() < shootDecisionP;
        }
      }
      if (takeShot) {
        a.shotCdUntil = this.t + (core ? 0.9 : isWing ? 1.1 : isMid ? 1.6 : 1.2);
        this._shoot(a);
        return;
      }
      // 极少数空门犹豫表现为再调整一步，而不是无视球门横传或一路带出底线。
      // 下一次决策很快重算，低决策/高压迫球员仍保留处理不干净的可能。
      if (opportunity.clearOpenGoal) {
        a.intent = {
          type: "dribble",
          tx: clamp(a.x + (goalX - a.x) * 0.45, 4, 96),
          ty: clamp(a.y + dir * clamp(dGoal - 5, 1.5, 4), 3, 97),
        };
        a.decisionUntil = Math.min(a.decisionUntil || Infinity, this.t + 0.35);
        a.fsm = "carry";
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
        if (cross && this.random() < 0.5) {
          this._pass(a, cross);
          return;
        }
        if (passTo && this.random() < 0.6) {
          this._pass(a, passTo);
          return;
        }
      }
      // 禁区边缘若连续数秒既没有推进也没有形成出球线路，现实中的持球者会
      // 回做或撤出人堆重新组织，而不是保持同一盘带目标直到看门狗强制解围。
      if (this.ball.owner === a.id && (this._stallT || 0) > 8) {
        const release = this._bestCutback(a) || passTo || this._bestCross(a);
        if (release) {
          this._pass(a, release);
          return;
        }
        a.intent = {
          type: "dribble",
          tx: clamp(a.x + (goalX - a.x) * 0.3, 8, 92),
          ty: clamp(a.y - dir * 10, 5, 95),
        };
        a.fsm = "carry";
        return;
      }
      // 贴**对方**底线（距对方门 5.5 格以内）。
      const nearAttackingByline =
        Math.abs(a.y - this.targetGoalY(a.team)) < 5.5;
      const trappedAtByline = nearAttackingByline && Math.abs(a.x - goalX) > 8;
      if (trappedAtByline && (pressure > 0.45 || cdBlocked || dGoal > 11)) {
        const cutback = this._bestCutback(a);
        if (cutback) {
          this._pass(a, cutback);
          return;
        }
        a.intent = {
          type: "dribble",
          tx: clamp(a.x + (goalX - a.x) * 0.65, 8, 92),
          ty: clamp(goalY - dir * 14, 3, 97),
        };
        a.fsm = "carry";
        return;
      }
      // 核心 / 边锋：内切带进去
      const tuckIn = isWing
        ? cutsInside
          ? 0.68 + cutInProgress * 0.08
          : hugsLine
            ? 0.2
            : 0.55 + cutInProgress * 0.1
        : core
          ? 0.55
          : 0.4;
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
      const nearAttackingByline = Math.abs(a.y - goalY) < 6.5;
      if (nearAttackingByline) {
        const release = this._bestCutback(a) || this._bestCross(a);
        if (release) {
          this._pass(a, release);
          return;
        }
        // 贴边习惯只要求保持宽度，不应让球员站在底线角落原地护球。
        // 没有可传目标时先回撤一步，重新获得观察角度和传球线路。
        const side = this._wingSide(a);
        a.intent = {
          type: "dribble",
          tx: clamp(side < 0 ? 10 : 90, 6, 94),
          ty: clamp(goalY - dir * 13, 5, 95),
        };
        a.fsm = "carry";
        return;
      }
      // 贴边时：先内切再射/传，而不是贴边死磕
      const burst = 0.55 * a.attr.dribbling + 0.45 * a.attr.pace;
      if (pressure < 0.72 && burst > 0.35 && this.t >= (a.cutInCdUntil || 0)) {
        // 偶尔立刻起脚横传/传中；多数情况内切
        const wantCrossNow =
          this.random() <
          (hugsLine
            ? 0.52 + pressure * 0.18 + roleCross * 0.12
            : cutsInside
              ? 0.12 + pressure * 0.14 + roleCross * 0.08
              : pressure > 0.55
                ? 0.28 + roleCross * 0.12
                : 0.08 + roleCross * 0.12);
        if (wantCrossNow) {
          const cross = this._bestCross(a);
          if (cross) {
            this._pass(a, cross);
            return;
          }
        }
        a.cutInCdUntil = this.t + 0.55;
        const side = this._wingSide(a);
        if (hugsLine && !cutsInside) {
          a.intent = {
            type: "dribble",
            tx: clamp(side < 0 ? 7 : 93, 4, 96),
            ty: clamp(a.y + dir * (10 + burst * 6), 4, 96),
          };
          a.fsm = "carry";
          return;
        }
        // 内切：向中路 + 向前，落点在禁区弧顶/肋部
        a.intent = {
          type: "dribble",
          tx: clamp(
            a.x - side * (10 + burst * 8) + (goalX - a.x) * (cutsInside ? 0.38 : 0.25),
            18,
            82
          ),
          ty: clamp(a.y + dir * (10 + burst * 6), 5, 95),
        };
        a.fsm = "carry";
        return;
      }
    }

    // ——————————— 边后卫高位：优先传中/回做 —— 
    if (isFb && dGoal < 42 && (a.baseX < 30 || a.baseX > 70)) {
      const cross = this._bestCross(a);
      if (cross && this.t >= (a.crossCdUntil || 0) && this.random() < 0.55 + (a.attr.crossing || a.attr.passing) * 0.25) {
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
        0.7;
      if (!core && throughPass.agent?.isCore) w *= 1.4;
      if (isWing) w *= 1.1;
      if (this._hasHabit(a, "tries_through_balls")) w *= 1.55;
      w *= 1 + Math.max(-0.35, rolePassRisk) * 0.45;
      options.push({ key: { act: "pass", target: throughPass }, w });
    }
    // 边后卫高位：把传中也放进候选
    if (isFb) {
      const cross = this._bestCross(a);
      if (cross) {
        options.push({
          key: { act: "pass", target: cross },
          w: (0.2 + cross.value) * (0.5 + 0.5 * (a.attr.crossing || a.attr.passing)) * (dGoal < 45 ? 1.2 : 0.7),
        });
      }
    }
    // 边锋：传中作次选（内切优先，但被逼时仍可起球）
    if (isWing) {
      const cross = this._bestCross(a);
      if (cross) {
        options.push({
          key: { act: "pass", target: cross },
          w: (0.12 + cross.value * 0.85) * (0.4 + 0.5 * (a.attr.crossing || a.attr.passing)) * (pressure > 0.45 ? 1.15 : 0.75),
        });
      }
    }
    if (aheadSpace > 0.2 || (isWing && Math.abs(a.x - goalX) > 12)) {
      const burst = 0.6 * a.attr.dribbling + 0.4 * a.attr.pace;
      let midBoost = isMid ? 1.15 : 1;
      if (core) midBoost *= 1.45; // 核心盘带权重暴涨
      if (isFb) midBoost *= 0.9;
      if (isWing) midBoost *= 1.35; // 边锋爱带球内切
      if (runsWithBall) midBoost *= 1.22;
      midBoost *= 1 + roleCarry * 0.26;
      // 边锋：即使 aheadSpace 一般也鼓励内切盘带
      const spaceW = isWing ? Math.max(aheadSpace, 0.35 + cutInProgress * 0.2) : aheadSpace;
      options.push({
        key: { act: "dribble" },
        w: (0.12 + 0.9 * burst) * spaceW * (1 - pressure * 0.55) * midBoost,
      });
    }
    // 主动突破（"过掉眼前这个人"）：仅在开关打开、冷却已过、且有贴身对手时入池。
    // **关闭时这一段整体不执行** ⇒ 决策分布与旧版逐位相同（这是默认关闭路线的根基）。
    if (
      this.beatPrimitive &&
      this.t >= (a.beatCdUntil || 0) &&
      this.t >= (a.beatActionUntil || 0)
    ) {
      const duel = this._beatDuelCandidate(a);
      if (duel) {
        // 权重与 `dribble` 同族，但**随压力上升**（这正是本原语与 `dribble` 的分工：
        // `dribble` 是"前方有空当就走"，权重随压力下降；`beat` 是"我要过他"）。
        // 核心/边锋更愿意尝试，与技术习惯同向。
        const burst = 0.6 * a.attr.dribbling + 0.4 * a.attr.balance;
        let w = (0.08 + 0.55 * burst) * (0.45 + 0.55 * pressure);
        if (core) w *= 1.5;
        if (isWing) w *= 1.25;
        if (isMid) w *= 1.1;
        if (this._hasHabit(a, "runs_with_ball")) w *= 1.2;
        // 标定用整体缩放（默认 1；仅 `opts.beatTuning.WEIGHT_SCALE` 覆盖时非 1）
        w *= this._beatTuning().WEIGHT_SCALE ?? 1;
        options.push({ key: { act: "beat", opp: duel.opponent }, w });
      }
    }
    const LONG_MIN = shootsFromDistance ? (isWing ? 18 : 20) : core ? 20 : isWing ? 18 : 24;
    const LONG_MAX = shootsFromDistance ? 40 : core ? 40 : isWing ? 34 : 36;
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
      // 先判断球员是否真的愿意在这个距离起脚。此前只把动作权重乘 0.22，
      // 但 weightedPick 使用 softmax，低权重动作仍会在每次决策中反复入池，
      // 最终让禁区外射门占到不现实的多数。距离越远，考虑出脚的概率应快速衰减。
      const longConsiderP = clamp(
        0.09 + a.attr.shooting * 0.08 + (core ? 0.025 : 0) + (shootsFromDistance ? 0.07 : 0) -
          (dGoal - LONG_MIN) * 0.008 - pressure * 0.045,
        0.012,
        0.16
      );
      if (this.random() < longConsiderP) {
        let longW =
          (0.06 + 0.5 * a.attr.shooting + 0.18 * a.attr.finishing + 0.12 * a.attr.pace) *
          angF *
          (0.55 + 0.45 * (1 - pressure)) *
          (0.45 + 0.55 * Math.min(1, aheadSpace + 0.35));
        if (isMid) longW *= 1.35;
        if (isWing) longW *= 1.25 + cutInProgress * 0.35; // 内切后远射
        if (core) longW *= 1.5;
        if (shootsFromDistance) longW *= 1.42;
        longW *= 1 + roleShoot * 0.32;
        longW *= 0.55;
        options.push({ key: { act: "longshot" }, w: longW });
      }
    }
    options.push({ key: { act: "hold" }, w: 0.12 + pressure * 0.2 + (core ? 0.05 : 0) });

    // 核心/高决策球员更果断（温度更低 → 更偏高分动作，但仍保留比赛随机性）
    const decisionTemp = clamp(
      (core ? 0.28 : isWing ? 0.3 : 0.35) - ((a.attr.decisions || 0.58) - 0.58) * 0.14,
      0.22,
      0.38
    );
    const choice = weightedPick(options, decisionTemp, this.random) || { act: "hold" };
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
        const inward = hugsLine
          ? 2.5
          : (cutsInside ? 12 : 9) + a.attr.dribbling * (cutsInside ? 8 : 7);
        a.intent = {
          type: "dribble",
          tx: hugsLine
            ? clamp(side < 0 ? 7 : 93, 4, 96)
            : clamp(
                a.x - side * inward + (goalX - a.x) * (cutsInside ? 0.32 : 0.22),
                16,
                84
              ),
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
    } else if (choice.act === "beat") {
      // 主动突破：把球带向该对手（"我要过他"），并立刻结算一次对抗。
      // 动作时长用于抑制频次（期间 `beatActionUntil` 挡住新的尝试）。
      a.beatActionUntil = this.t + this._beatTuning().ACTION_SEC;
      const opp = choice.opp;
      if (opp && !opp.sentOff) {
        a.intent = {
          type: "dribble",
          tx: clamp(a.x + (opp.x - a.x) * 0.85, 3, 97),
          ty: clamp(a.y + (opp.y - a.y) * 0.85, 3, 97),
        };
        a.fsm = "carry";
      }
      this._attemptBeat(a, opp);
    } else {
      a.intent = { type: "hold", tx: a.x, ty: clamp(a.y - dir * 3, 3, 97) };
      a.fsm = "carry";
    }
  }

  /**
   * 边后卫传中：找进攻方向上靠门的队友（前锋优先），落点到禁区肋部/前点
   */
  _crossTargetReachable(passer, receiver, tx, ty) {
    const distance = pitchDistanceBetween(this.ball.x, this.ball.y, tx, ty);
    const technique = passTechnique(passer, true);
    const ballSpeed = passLaunchSpeedMps(distance, technique);
    const loft = passLaunchLoft(distance, ballSpeed, { isCross: true, isThrough: true });
    const time = clamp(estimateBallArrivalSeconds(distance, ballSpeed, 0.2, loft), 0.2, 3.4);
    const dx = tx - receiver.x;
    const dy = ty - receiver.y;
    const gap = Math.hypot(dx, dy);
    if (gap < 0.01) return true;
    const speed = playerRunSpeed(receiver);
    const accel = playerAcceleration(receiver, speed);
    const along = Math.max(0, ((receiver.vx || 0) * dx + (receiver.vy || 0) * dy) / gap);
    const accelerating = Math.min(time, Math.max(0, speed - along) / accel);
    const travel = along * accelerating + 0.5 * accel * accelerating ** 2 + speed * (time - accelerating);
    const metresPerUnit = pitchDistanceMetres(dx, dy) / gap;
    return (gap - travel) * metresPerUnit <= SIM.CONTROL_RADIUS_METRES;
  }

  _bestCross(a) {
    const dir = this.attackDir(a.team);
    const goalY = this.targetGoalY(a.team);
    let best = null;
    for (const m of this.agents) {
      if (m === a || m.team !== a.team || m.role === "GK" || m.sentOff || m.injuredOff) continue;
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
      const aerialB = 0.72 + this._aerialAbility(m) * 0.72;
      const deliveryB = clamp(
        0.76 + (a.attr.crossing || a.attr.passing || 0.55) * 0.36 + (a.attr.decisions || 0.55) * 0.1,
        0.82,
        1.2
      );
      const tx = clamp(m.x * 0.55 + 50 * 0.45 + (this.random() - 0.5) * 6, 28, 72);
      const ty = clamp(goalY - dir * (8 + this.random() * 6), 4, 96);
      if (!this._crossTargetReachable(a, m, tx, ty)) continue;
      let value =
        (0.4 + clamp(1 - dGoalM / 32, 0, 1)) *
        this._laneSafety(a, m, tx, ty) *
        opposite *
        roleB *
        coreB *
        aerialB *
        deliveryB;
      if (!this.ball.offsideExemptRestart && this._isOffsidePosition(a.team, m)) {
        value *= 0.16 + (1 - a.attr.vision) * 0.34;
      }
      // 落点：禁区内前点/中点，不是脚下
      if (!best || value > best.value) {
        best = { agent: m, value, through: true, tx, ty, cross: true };
      }
    }
    return this.ball.state === "corner" && this.ball.owner === a.id
      ? cornerDelivery(this._cornerRoutine, this.agents, a, this.random()) || best : best;
  }

  /** 底线附近的倒三角/回做，防止低角度持球者继续撞向边界。 */
  _bestCutback(a) {
    const dir = this.attackDir(a.team);
    const goalY = this.targetGoalY(a.team);
    let best = null;
    for (const m of this.agents) {
      if (m === a || m.team !== a.team || m.role === "GK" || m.sentOff) continue;
      const behind = (m.y - a.y) * dir;
      if (behind > -4 || behind < -32) continue;
      const dGoalM = dist(m.x, m.y, 50, goalY);
      if (dGoalM > 34) continue;
      const d = dist(a.x, a.y, m.x, m.y);
      if (d < 7 || d > 38) continue;
      const central = 1 - Math.min(1, Math.abs(m.x - 50) / 42);
      const roleB = m.role === "ATT" ? 1.2 : m.role === "MID" ? 1.1 : 0.72;
      const tx = clamp(m.x + (50 - m.x) * 0.18, 18, 82);
      const ty = clamp(m.y - dir * 1.5, 6, 94);
      if (!this._launchRouteClear(a, { tx, ty })) continue;
      const safety = this._laneSafety(a, m, tx, ty);
      const value =
        (0.28 + central * 0.48 + clamp(1 - dGoalM / 34, 0, 1) * 0.22) *
        safety *
        roleB *
        (0.82 + (a.attr.decisions || 0.55) * 0.18);
      if (!best || value > best.value) {
        best = { agent: m, value, through: false, tx, ty, cutback: true };
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
      if (o.team === a.team) continue;
      if (o.role === "GK" && !this._goalkeeperCanPressure(o, a)) continue;
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
      if (o.team === a.team) continue;
      if (o.role === "GK" && !this._goalkeeperCanPressure(o, a)) continue;
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
  _collectPassCandidates(a) {
    const dir = this.attackDir(a.team);
    const goalY = this.targetGoalY(a.team);
    const offY = this._offsideLineY(a.team);
    const holderPressure = this._pressureOn(a);
    const out = [];
    for (const m of this.agents) {
      if (m === a || m.team !== a.team || m.sentOff) continue;
      const d = dist(a.x, a.y, m.x, m.y);
      if (m.role === "GK") {
        // 己方后场组织区 = 距己方门 ≤ 34 格 ⇒ 等价于「距门 ≥ 66 格」
        // 的那一侧之外（home 不换边时即 a.y >= 66）。
        const inOwnBuildZone = this._onOwnSide(a.y, a.team, 34);
        const canRecycleToKeeper =
          inOwnBuildZone &&
          holderPressure >= 0.68 &&
          (a.role === "DEF" || a.detailedPosition === "DM") &&
          d >= 6 &&
          d <= 32;
        if (!canRecycleToKeeper) continue;
        const safety = this._laneSafety(a, m, m.x, m.y);
        const distanceWeight = clamp(1 - d / 40, 0.25, 1);
        const value =
          (0.13 + holderPressure * 0.22) *
          safety *
          distanceWeight *
          (0.82 + (a.attr.decisions || 0.55) * 0.18);
        out.push({
          agent: m,
          value,
          through: false,
          backpass: true,
          tx: m.x,
          ty: m.y,
        });
        continue;
      }
      if (d < 6 || d > 45) continue; // 太近没必要，太远不可靠
      // 普通传球也瞄准预计接球点，而不是队友当前脚下。接球队员稍后会共享同一目标。
      let tx = m.x;
      let ty = m.y;
      let eta = 0;
      for (let iteration = 0; iteration < 4; iteration++) {
        const distanceM = pitchDistanceBetween(this.ball.x, this.ball.y, tx, ty);
        const nominalSpeed = passLaunchSpeedMps(distanceM, passTechnique(a));
        const loft = passLaunchLoft(distanceM, nominalSpeed);
        const nextEta = clamp(estimateBallArrivalSeconds(distanceM, nominalSpeed, loft ? 0.2 : 0, loft), 0.2, 3.4);
        tx = clamp(m.x + (m.vx || 0) * nextEta, 3, 97);
        ty = clamp(m.y + (m.vy || 0) * nextEta, 3, 97);
        if (Math.abs(nextEta - eta) < 0.005) break;
        eta = nextEta;
      }
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
      if (directReturn) {
        value *= this._hasHabit(a, "plays_one_twos")
          ? 0.38 + holderPressure * 0.12
          : 0.02 + holderPressure * 0.05;
        value *= 1 + Math.max(0, this._roleBehavior(a, "support")) * 0.35;
      } else if (Math.abs(m.x - a.x) > 18) {
        value *= this._hasHabit(a, "switches_play") ? 1.28 : 1.08;
      }

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
      const throughIntent = clamp(
        0.34 +
          a.attr.vision * 0.24 +
          (a.attr.decisions || 0.55) * 0.1 +
          (this._hasHabit(a, "tries_through_balls") ? 0.2 : 0) +
          this._roleBehavior(a, "passRisk") * 0.12 -
          holderPressure * 0.12,
        0.2,
        0.82
      );
      // 第 2 门 `advance`：要求接球人比持球者近门 `advance*40` 场地单位。
      // 2026-09-03 从 0.35（14 单位）放到 0.20（8 单位）——0.35 那道门把直塞意图挡掉了
      // 绝大部分（独立通过率 6.9%），实测直塞只有 0.63~0.73 次/场，真实是 3.38。
      // 标定曲线见 AGENTS.md「🅱️ 直塞第 2 门」一节：0.15 会把后台档进球顶到 3.46（护栏 3.3），
      // 0.25 余量只剩 0.09 且直塞反而更少，**0.20 是唯一两边都留余量的点**。
      // ⛔ 动它之前先读那一节，特别是「进球这一列在 48 场分辨不出来」那段。
      if (
        aheadOfBall &&
        advance > 0.20 &&
        lineGap < 11 &&
        receiverGoalDist < 44 &&
        safety > 0.28 &&
        this.random() < throughIntent &&
        this.t >= (this._teamThroughUntil[a.team] || 0)
      ) {
        const leadY = clamp(ty + dir * (6 + this.random() * 4), 3, 97);
        // 落点未越过越位线太多才算可行直塞。
        // 越位线是「朝进攻方向不得早于 offY 2 格」⇒ 用纵深表达：
        // 落点纵深 ≤ 越位线纵深 + 2。原式 home 的 `leadY >= offY - 2`
        // 展开正是 `100 - leadY <= 100 - offY + 2`。
        const okOffside =
          offY == null ||
          this._depthFromOwnGoal(leadY, a.team) <=
            this._depthFromOwnGoal(offY, a.team) + 2;
        if (okOffside) {
          through = true;
          value *= (this._hasHabit(a, "tries_through_balls") ? 0.9 : 0.72) *
            (1 + this._roleBehavior(a, "passRisk") * 0.22);
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
    const originX = this.ball.owner === a.id ? this.ball.x : a.x;
    const originY = this.ball.owner === a.id ? this.ball.y : a.y;
    const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
    const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
    const dx = (tx - originX) * mx;
    const dy = (ty - originY) * my;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    for (const o of this.agents) {
      if (o.team === a.team || o.role === "GK" || o.sentOff || o.injuredOff) continue;
      // 投影到传球线段
      const t = ((o.x - originX) * mx * ux + (o.y - originY) * my * uy) / len;
      if (t < 0 || t > 1) continue;
      const px = originX + ux * len * t / mx;
      const py = originY + uy * len * t / my;
      const perp = pitchDistanceBetween(o.x, o.y, px, py);
      if (perp < minPerp) minPerp = perp;
    }
    return clamp(minPerp / 8, 0.1, 1);
  }

  /** 执行传球：给球初速飞向接球点，清 owner（长传/传中/直塞带弧线高度） */
  _pass(a, passTo, prepared = false) {
    // Recheck the actual launch line after turning/preparation: a defender may
    // have entered it since this option was selected.
    if (prepared && !this._launchRouteClear(a, passTo)) {
      a.pendingBallAction = null;
      a.intent = { type: "hold", tx: a.x, ty: a.y };
      a.fsm = "carry";
      a.decisionUntil = this.t + 0.2;
      return;
    }
    const b = this.ball;
    if (!prepared && this._queueBallAction(a, "pass", passTo.tx, passTo.ty, passTo)) return;
    const fromCorner = b.state === "corner" || b.restartType === "corner";
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
    const distanceM = pitchDistanceMetres(dx, dy);
    const isCross = !!passTo.cross;
    const isThrough = !!passTo.through;
    const technique = passTechnique(a, isCross);
    // 传球速度统一使用米/秒：短传留给队友处理，中长传逐步加力。
    // passing 主要控制落点误差；同样距离不因方向或属性产生离谱的速度差。
    const passSpeedMps = passLaunchSpeedMps(distanceM, technique);
    const passVelocity = pitchVelocityForMps(dx, dy, passSpeedMps);
    // 精度噪声：passing 越低越偏
    // 普通职业球员的基础脚法不应让近中距离传球像随机解围；压力与线路风险
    // 已由决策/拦截系统体现，这里只保留随 passing 变化的温和落点误差。
    const errMps = (1 - technique) * (isCross ? 3.8 : 3.2);
    const nx = (this.random() - 0.5) * errMps * (SIM.FIELD_W / SIM.PITCH_W_METRES);
    const ny = (this.random() - 0.5) * errMps * (SIM.FIELD_H / SIM.PITCH_H_METRES);
    b.owner = null;
    b.vx = passVelocity.vx + nx;
    b.vy = passVelocity.vy + ny;
    b.receiverId = passTo.agent?.id || null;
    b.targetX = tx;
    b.targetY = ty;
    // 空中弧线（vz 对 g=18：peak≈vz²/36；传中按目标处可争顶高度反推，短传贴地）
    const needsLoftDraw = isCross || isThrough ||
      (distanceM >= 20 - 1e-6 && distanceM < 30 - 1e-6);
    const loft = passLaunchLoft(distanceM, pitchSpeedMps(b.vx, b.vy), {
      isCross, isThrough, fromCorner, roll: needsLoftDraw ? this.random() : 0.5,
    });
    b.z = loft > 0 ? 0.2 : 0;
    b.vz = loft;
    b.expectedAt = this.t + clamp(
      estimateBallArrivalSeconds(distanceM, pitchSpeedMps(b.vx, b.vy), b.z, b.vz),
      0.2,
      3.4
    );
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
    b._handballChecked = new Set();
    const backpass = backpassViolation({
      passer: a,
      goalkeeper: passTo.agent,
      pass: {
        deliberate: true,
        cross: isCross,
        through: isThrough,
      },
    });
    b.backpassCandidate = backpass.violation;
    b.backpassFrom = backpass.violation ? a.id : null;
    b.backpassTargetId = backpass.violation ? passTo.agent.id : null;
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
    a.pendingBallAction = null;
    a.actionPreparationActive = false;
    a.controlPhase = "released";
    a.controlUntil = this.t;
    a.fsm = "home";
    this._emit("pass", a, {
      loft: loft > 2,
      cross: isCross,
      corner: fromCorner,
      through: isThrough,
      toId: passTo.agent?.id || null,
      toX: tx,
      toY: ty,
    });
    if (isThrough) this._teamThroughUntil[a.team] = this.t + 3.2;
    // 传球后短暂不可立刻被自己接回
    a.noReclaimUntil = this.t + 0.25;
    if (fromCorner && this._cornerRoutine?.takerId === a.id) {
      this._cornerRoutine.releasedAt = b.lastPassAt;
    }
    this._startPassSupport(a, passTo);
  }

  /** 执行射门：给球高速飞向球门，门将可扑（远射：更吃 shooting、误差更大） */
  _shoot(a, extraMeta = null, prepared = false) {
    const b = this.ball;
    const opportunity = this._goalOpportunity(a);
    const goalY = this.targetGoalY(a.team);
    if (!prepared && this._queueBallAction(a, "shot", opportunity.targetX, goalY, extraMeta)) return;
    const dGoal = opportunity.dGoal;
    const long = dGoal > 22;
    const freekick = !!extraMeta?.freekick;
    // 球队级节奏上限：强队长期围攻时也不能每几十秒起脚一次。
    // 这是模拟时间的进攻周期，不是表现层的墙钟等待。
    //
    // 旧值 420 + rand*260（7~11 分钟）是在「禁区盯人只派 1 人、门将不出击」的
    // 世界里定的：机会本身过量（实测每场 336 次禁区持球回合，真实约 40~60），
    // 只能靠一个很长的冷却把射门数压回 24/场。副作用是近距离好机会也被压掉——
    // 实测「离门 10 米内且 3 米内无人防守」每场 20.5 次，其中射门只占 9.8%、
    // 传球占 58.5%，画面上就是「站在空门前不射」。
    // 本轮已收紧禁区盯人并让门将真正封角/出击，机会质量由防守压制，
    // 冷却随之缩短到 3~5 分钟，让球员在门前按机会本身做决定。
    this._teamShotUntil[a.team] = this.t + 300 + this.random() * 180;
    // 近：finishing；远：shooting。远射噪声更大，容易打飞/被扑
    const skill = freekick
      ? 0.42 * (a.attr.kicking || 0.55) +
        0.32 * (a.attr.shooting || 0.55) +
        0.16 * (a.attr.decisions || 0.55) +
        0.1 * (a.attr.finishing || 0.55)
      : long
        ? 0.35 * a.attr.finishing + 0.65 * a.attr.shooting
        : 0.7 * a.attr.finishing + 0.3 * a.attr.shooting;
    // 近距：误差缩小（更好的「该进就进」），但绝不强制夹进门框
    // aimX 在 [50-err/2, 50+err/2] 均匀分布；门宽只有 12。
    // 旧 err 常小于门宽，等于“每脚必射正”，此前只是被普通接管逻辑意外掩盖。
    let err =
      (long ? 20 : 28) +
      (1 - skill) * (long ? 57 : 53) +
      dGoal * (long ? 0.65 : 0.55);
    // 同一份门将覆盖事实已在出脚决策阶段使用；这里只把暴露程度转成落点误差。
    // 门将出击但仍位于射门线路上不算空门，真正绕过门将后才显著提高命中率。
    const openGoal = opportunity.openGoal;
    if (openGoal) {
      err *= 0.55 - opportunity.exposure * 0.13;
    } else if (
      Number.isFinite(opportunity.laneDistance) &&
      opportunity.laneDistance > opportunity.keeperReach - 0.8
    ) {
      err *= 0.82;
    }
    // 传控改善后禁区内起脚质量更高；保留约 12% 的统一落点离散，避免
    // 等强样本回到 3.3 球/场以上，同时不通过 UI 或赛后缩放篡改结果。
    err *= freekick ? 1.08 : 1.22;
    const placesShot = this._hasHabit(a, "places_shots") && !freekick && !long;
    const placementSide = this.random() < 0.5 ? -1 : 1;
    const aimCentre = placesShot ? 50 + placementSide * (2.8 + this.random()) : opportunity.targetX;
    const aimX = aimCentre + (this.random() - 0.5) * err;
    const dx = aimX - b.x;
    const dy = goalY - b.y;
    const d = Math.hypot(dx, dy) || 1;
    // 远射初速略高，才像抽射
    const power = clamp(
      (long ? 42 : 38) + (freekick ? a.attr.kicking : a.attr.shooting) * (long ? 16 : 14),
      long ? 40 : 38,
      long ? 58 : 55
    ) * (placesShot ? 0.9 : 1);
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
    // 垂直方向与横向一样由落点误差决定。按预计飞行时间反解初始竖直速度，
    // 这样远射不会因为固定 vz 天生飘高，也不再依靠“所有 shot 都算横梁下”的豁免。
    const flightTime = clamp(d / power, 0.18, 1.4);
    const verticalSpread =
      (long ? 4.4 : 3.8) + (1 - skill) * (long ? 2.8 : 2.2) +
      (long ? Math.max(0, dGoal - 25) * 0.05 : 0);
    const targetZ = Math.max(0.08, 1.0 + (this.random() - 0.5) * verticalSpread);
    b.z = 0.25;
    b.vz = (targetZ - b.z + 9 * flightTime * flightTime) / flightTime;
    b.lastKicker = a.id;
    b.kickTeam = a.team;
    b.kickX = b.x;
    b.kickY = b.y;
    b.state = "shot";
    b.shotDistance = dGoal;
    b.shotSkill = skill;
    b.shotTargetZ = targetZ;
    b.shotFlightTime = flightTime;
    b.shotAt = this.t;
    b._saveChecked = false; // 新射门允许门将掷一次扑救骰
    b._blockersChecked = new Set();
    b._handballChecked = new Set();
    b._shotAssistId = assistId;
    b._openGoalShot = openGoal;
    this._clearBallTarget();
    a.intent = null;
    a.pendingBallAction = null;
    a.actionPreparationActive = false;
    a.controlPhase = "released";
    a.controlUntil = this.t;
    a.bodyTargetHeading = Math.atan2(goalY - a.y, 50 - a.x);
    a.fsm = "home";
    this._emit("shot", a, {
      long: !!long,
      role: a.role,
      assistId,
      openGoal,
      openGoalReason: opportunity.openGoalReason,
      x: a.x,
      y: a.y,
      distance: dGoal,
      pressure: this._pressureOn(a),
      goalkeeperLaneDistance: Number.isFinite(opportunity.laneDistance)
        ? opportunity.laneDistance
        : null,
      goalkeeperReach: opportunity.keeperReach,
      targetX: aimX,
      targetZ,
      flightTime,
      ...(extraMeta || {}),
    });
    a.noReclaimUntil = this.t + 0.4;
  }

  /** 无球进攻：前锋回撤、中场前插、边后卫套边；核心自由靠球 */
  _thinkAttackOffBall(a, owner) {
    // 原目标选择照常消费随机流，再应用传球信号；不会因早退改变后续判罚随机数。
    this._chooseAttackOffBallTarget(a, owner);
    this._applyPassSupport(a, owner);
  }

  /** 已面向可见球门、真实封堵线路畅通的近门机会，不被球队节奏窗口排除。 */
  _hasCloseShotWindow(a, heading = a.heading, receiving = false) {
    const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
    const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
    const b = this.ball;
    if (b.owner !== a.id || b.restartType || (b.state !== "held" && !(receiving && b.state === "control"))) return false;
    const other = a.team === "home" ? "away" : "home";
    if (!this._inOwnFoulBox(other, b.x, b.y)) return false;
    const opportunity = this._goalOpportunity(a);
    const dx = (opportunity.targetX - b.x) * mx;
    const dy = (this.targetGoalY(a.team) - b.y) * my;
    const length = Math.hypot(dx, dy);
    const leftAngle = Math.atan2(dy, (SIM.GOAL_X0 - b.x) * mx);
    const rightAngle = Math.atan2(dy, (SIM.GOAL_X1 - b.x) * mx);
    const aperture = Math.abs(Math.atan2(Math.sin(leftAngle - rightAngle), Math.cos(leftAngle - rightAngle)));
    const sufficientAngle = aperture >= 0.45;
    if (length > 16.5 || !sufficientAngle || length < 0.1) return false;
    const hx = Math.cos(heading || 0) * mx;
    const hy = Math.sin(heading || 0) * my;
    if ((hx * dx + hy * dy) / (Math.hypot(hx, hy) * length) < 0.5) return false;
    // The existing block resolver uses a speed-dependent metric contact radius.
    // A privileged close-shot window must clear that same region, not just feet.
    const power = 38 + a.attr.shooting * 14;
    const unitLength = Math.hypot(dx / mx, dy / my);
    const speedMps = power * length / unitLength;
    const blockReach = shotBlockReachMetres(speedMps);
    for (const o of this.agents) {
      if (o.team === a.team || o.role === "GK" || o.sentOff || o.injuredOff) continue;
      const px = (o.x - b.x) * mx;
      const py = (o.y - b.y) * my;
      const along = (px * dx + py * dy) / length;
      if (along <= 0 || along >= length) continue;
      if (Math.abs(px * dy - py * dx) / length < blockReach) return false;
    }
    return true;
  }

  /** 从真实球位检查低球出脚段；守方已在触达范围内时不能依赖早段保护穿人。 */
  _launchRouteClear(a, option) {
    if (this.ball.owner !== a.id) return true;
    const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
    const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
    const b = this.ball;
    const dx = (option.tx - b.x) * mx;
    const dy = (option.ty - b.y) * my;
    const distance = Math.hypot(dx, dy);
    if (option.cross || option.through || distance < 0.1) return true;
    const speed = passLaunchSpeedMps(distance, passTechnique(a));
    const loft = passLaunchLoft(distance, speed);
    for (const o of this.agents) {
      if (o.team === a.team || o.sentOff || o.injuredOff || o.role === "GK") continue;
      const px = (o.x - b.x) * mx;
      const py = (o.y - b.y) * my;
      const along = (px * dx + py * dy) / distance;
      if (along < 0 || along > Math.min(8, distance)) continue;
      // The launch interval is short enough to use observed defender velocity.
      // Ground friction uses the same per-0.1-second attenuation as the engine.
      const t = estimateBallArrivalSeconds(along, speed, loft ? 0.2 : 0, loft);
      const ox = px + (o.vx || 0) * mx * t;
      const oy = py + (o.vy || 0) * my * t;
      const predictedAlong = (ox * dx + oy * dy) / distance;
      if (predictedAlong < 0 || predictedAlong > Math.min(8, distance)) continue;
      if (loft && estimateBallHeightAtDistance(predictedAlong, speed, 0.2, loft) > 1.1) continue;
      const perpendicular = Math.abs(ox * dy - oy * dx) / distance;
      if (perpendicular <= 1.1) {
        return false;
      }
    }
    return true;
  }

  /** 线路被挡时，只尝试接球人能按原速度赶到的横向空当。 */
  _passCandidates(a) {
    const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
    const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
    return this._collectPassCandidates(a).flatMap((option) => {
      if (this._launchRouteClear(a, option)) return [option];
      if (!option.agent || option.backpass) return [];
      const receiver = option.agent;
      const dx = (option.tx - this.ball.x) * mx;
      const dy = (option.ty - this.ball.y) * my;
      const length = Math.hypot(dx, dy);
      if (length < 0.1) return [];
      const vx = -dy / length;
      const vy = dx / length;
      const options = [];
      for (const side of [-1, 1]) {
        for (const offset of [2, 4]) {
          const tx = clamp(option.tx + vx * offset * side / mx, 3, 97);
          const ty = clamp(option.ty + vy * offset * side / my, 3, 97);
          const distance = Math.hypot((tx - this.ball.x) * mx, (ty - this.ball.y) * my);
          const speed = passLaunchSpeedMps(distance, passTechnique(a));
          const loft = passLaunchLoft(distance, speed);
          const eta = estimateBallArrivalSeconds(distance, speed, loft ? 0.2 : 0, loft);
          const rx = tx - receiver.x;
          const ry = ty - receiver.y;
          const runnerGap = Math.hypot(rx, ry);
          const runnerSpeed = playerRunSpeed(receiver);
          const accel = playerAcceleration(receiver, runnerSpeed);
          const along = runnerGap ? Math.max(0, (receiver.vx * rx + receiver.vy * ry) / runnerGap) : 0;
          const accelerateFor = Math.min(eta, Math.max(0, runnerSpeed - along) / accel);
          const reachable = along * accelerateFor + 0.5 * accel * accelerateFor ** 2 +
            runnerSpeed * (eta - accelerateFor);
          if (runnerGap > reachable || !this._launchRouteClear(a, { ...option, tx, ty })) continue;
          const originalSafety = this._laneSafety(a, receiver, option.tx, option.ty);
          const safety = this._laneSafety(a, receiver, tx, ty);
          options.push({ ...option, tx, ty, value: option.value * safety / Math.max(0.1, originalSafety),
            detour: offset });
        }
      }
      options.sort((left, right) => left.detour - right.detour || right.value - left.value);
      return options.length ? [options[0]] : [];
    }).sort((left, right) => right.value - left.value);
  }

  /** 一脚前场传球触发一名第三人跑动；近底线时提供禁区外回做点。 */
  _startPassSupport(a, option) {
    const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
    const metres = (a, b) => pitchDistanceBetween(a.x, a.y, b.x, b.y);
    const b = this.ball;
    if (b.state !== "pass" || b.lastKicker !== a.id || b.lastPassAt !== this.t ||
        !option.agent || option.cross || option.agent.role === "GK") return;
    const existing = this._passSupportRun;
    const previousRunner = existing && this.agentById(existing.playerId);
    if (existing?.team === a.team && this.t <= existing.until &&
        existing.attackSince === this._teamAttackSince[a.team] &&
        previousRunner && !previousRunner.sentOff && !previousRunner.injuredOff &&
        previousRunner.id !== a.id && previousRunner.id !== option.agent.id &&
        metres(previousRunner, existing) > 0.8) return;
    const dir = this.attackDir(a.team);
    const goalY = this.targetGoalY(a.team);
    const depth = Math.abs(b.targetY - goalY) * my;
    if (depth > 38 || (b.targetY - b.kickY) * dir < -4) return;
    const line = this._offsideLineY(a.team);
    if (!Number.isFinite(line)) return;
    const legalY = dir < 0 ? Math.min(line, b.targetY) : Math.max(line, b.targetY);
    const cutback = depth < 12;
    const receiver = option.agent;
    const candidates = this.agents.filter((m) => m.team === a.team && m.id !== a.id &&
      m.id !== receiver.id && !m.sentOff && !m.injuredOff &&
      (m.role === "ATT" || this._isPrimaryMidRunner(m)) &&
      !this._isOffsidePosition(m.team, m, line, b.y)).map((runner) => {
      const target = {
        x: clamp(runner.baseX * 0.8 + receiver.x * 0.2, 12, 88),
        y: cutback ? goalY - dir * 18 / my : legalY - dir * 1.8 / my,
      };
      const distance = metres(runner, target);
      const side = (runner.baseX - 50) * (receiver.x - 50) < 0 ? 0 : 3;
      return { runner, target, distance, rank: distance + side };
    }).filter((candidate) => candidate.distance >= 3 && candidate.distance <= 25)
      .sort((left, right) => left.rank - right.rank || String(left.runner.id).localeCompare(String(right.runner.id)));
    if (!candidates.length) return;
    const selected = candidates[0];
    const runnerSpeed = playerRunSpeed(selected.runner);
    const fieldDistance = Math.hypot(selected.target.x - selected.runner.x, selected.target.y - selected.runner.y);
    const travelSeconds = fieldDistance / runnerSpeed + 0.3;
    const plan = { team: a.team, playerId: selected.runner.id, receiverId: receiver.id,
      attackSince: this._teamAttackSince[a.team],
      until: this.t + Math.max(b.expectedAt - this.t, travelSeconds) + 0.7,
      ...selected.target, cutback };
    this._passSupportRun = plan;
    selected.runner.attackThinkUntil = Math.min(selected.runner.attackThinkUntil || Infinity, this.t);
  }

  _applyPassSupport(a, owner) {
    const plan = this._passSupportRun;
    if (plan && plan.playerId === a.id && plan.team === a.team && this.t <= plan.until &&
        plan.attackSince === this._teamAttackSince[a.team] &&
        owner?.team === a.team && this.ball.owner !== a.id && !this.ball.restartType) {
      a.tx = plan.x;
      a.ty = plan.y;
      a.fsm = "support";
      a.offBallTargetKind = plan.cutback ? "cutback-outlet" : "third-man-run";
    }
    if (a.role === "MID" && !this._isPrimaryMidRunner(a) &&
        Math.abs(this.ball.y - this.targetGoalY(a.team)) < 36) {
      const mids = this.agents.filter((m) => m.team === a.team && m.role === "MID" && !m.sentOff &&
        (!m.injuredOff && !this._isPrimaryMidRunner(m)))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      const rank = Math.max(0, mids.indexOf(a));
      const goalY = this.targetGoalY(a.team);
      const depth = Math.max(17 + rank * 6, Math.abs(this.ball.y - goalY) + 6 + rank * 5);
      a.ty = clamp(goalY - this.attackDir(a.team) * depth, 3, 97);
    }
  }

  /** 跑向空当的路径也须可通行，使用现有身体分离约束，允许向外脱离已有接触。 */
  _supportRunClear(a, target) {
    const dx = target.x - a.x;
    const dy = target.y - a.y;
    const squared = dx * dx + dy * dy;
    if (squared < 1e-8) return true;
    return !this.agents.some((other) => {
      if (other.id === a.id || other.sentOff || other.injuredOff) return false;
      const along = ((other.x - a.x) * dx + (other.y - a.y) * dy) / squared;
      if (along <= 0) return false;
      const progress = Math.min(1, along);
      return Math.hypot(other.x - a.x - dx * progress, other.y - a.y - dy * progress) <
        this.separationMinDistanceUnits - 1e-6;
    });
  }

  /** 用实际遮挡边界补充横向搜索点，避免漏掉两个粗采样点之间的窄空当。 */
  _supportOfferSearchXs(a, anchor) {
    const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
    const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
    const xs = [3, 97];
    const add = (x) => {
      if (Number.isFinite(x) && Math.abs(x - anchor.x) * mx < 6) xs.push(x);
    };
    const roots = (aa, bb, cc, fromX, scaleX) => {
      if (Math.abs(aa) < 1e-12) {
        if (Math.abs(bb) > 1e-12) add(fromX - cc / bb / scaleX);
        return;
      }
      const discriminant = bb * bb - 4 * aa * cc;
      if (discriminant < 0) return;
      const span = Math.sqrt(discriminant);
      add(fromX + (-bb - span) / (2 * aa) / scaleX);
      add(fromX + (-bb + span) / (2 * aa) / scaleX);
    };
    const circle = (point, radius, scaleX = mx, scaleY = my) => {
      const dy = (anchor.y - point.y) * scaleY;
      const squared = radius * radius - dy * dy;
      if (squared < 0) return;
      const dx = Math.sqrt(squared) / scaleX;
      add(point.x - dx);
      add(point.x + dx);
    };
    const segment = (from, obstacle, radius, scaleX, scaleY) => {
      const y = (anchor.y - from.y) * scaleY;
      const ox = (obstacle.x - from.x) * scaleX;
      const oy = (obstacle.y - from.y) * scaleY;
      // 遮挡圆的切线，以及投影进入/离开有限线段的边界，均反解为本纵深的目标 x。
      roots(oy * oy - radius * radius, -2 * ox * oy * y,
        (ox * ox - radius * radius) * y * y, from.x, scaleX);
      roots(0, ox, oy * y, from.x, scaleX);
      roots(1, -ox, y * y - oy * y, from.x, scaleX);
      circle(obstacle, radius, scaleX, scaleY);
    };
    circle(this.ball, 20);
    for (const other of this.agents) {
      if (other.id === a.id || other.sentOff || other.injuredOff) continue;
      // 跑动仍使用现有运动求解器的身体包络；传球与预留空间使用米制。
      segment(a, other, this.separationMinDistanceUnits - 1e-6, 1, 1);
      if (other.team === a.team) {
        circle({ x: other.tx, y: other.ty }, OFF_BALL_TARGET_DEFAULTS.supportSpacingMetres);
      } else if (other.role !== "GK") {
        segment(this.ball, other, 1.8, mx, my);
        circle(other, 2);
      }
    }
    return xs;
  }

  /** 已到位的接应者沿战术纵深横移找线路；旧空当被封住时结束本次接应。 */
  _applySupportOffer(a, owner, previous) {
    const b = this.ball;
    if (!owner || owner.team !== a.team || a.id === b.owner || a.sentOff || a.injuredOff ||
        (a.role !== "ATT" && a.role !== "MID") || b.restartType || this.t < (this.deadBallUntil || 0) ||
        !["held", "control", "pass"].includes(b.state) ||
        ["third-man-run", "cutback-outlet", "one-two"].includes(a.offBallTarget?.kind)) return;
    const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
    const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
    const gap = (p, q) => pitchDistanceBetween(p.x, p.y, q.x, q.y);
    const anchor = { x: a.tx, y: a.ty };
    if (Math.abs(b.y - this.targetGoalY(a.team)) * my >= 38) return;
    let offer = previous?.attackSince === this._teamAttackSince[a.team] &&
      gap(previous, anchor) <= 6 && gap(b, previous.origin) <= 6 &&
      !this._isOffsidePosition(a.team, { x: previous.x, y: anchor.y })
        ? { ...previous, y: anchor.y } : null;
    if (offer && b.owner) {
      // 换人持球需重新看见足够的线路；同一持球人的小幅变化保留滞回，避免反复折返。
      const minimumLane = b.owner === offer.ownerId ? 1.1 : 1.8;
      const receivingSpace = !this.agents.some((o) => o.team !== a.team && o.role !== "GK" &&
        !o.sentOff && !o.injuredOff && gap(o, offer) < 2);
      if (!receivingSpace || !this._supportRunClear(a, offer) ||
          this._laneSafety(owner, a, offer.x, offer.y) < minimumLane / 8 ||
          !this._launchRouteClear(owner, { agent: a, tx: offer.x, ty: offer.y })) {
        offer = null;
      } else {
        offer = { ...offer, ownerId: b.owner };
      }
    }
    const target = offer || anchor;
    const settled = Math.hypot(a.vx * mx, a.vy * my) < 1 && gap(a, target) <= 1.5;
    if (b.owner === owner.id && b.state === "held" && settled && gap(b, target) >= 6 && gap(b, target) < 20 &&
        this._laneSafety(owner, a, target.x, target.y) <= 1.1 / 8) {
      let choice = null;
      const preferredSide = a.baseX < 49 ? -1 : a.baseX > 51 ? 1 : (a.num || 0) % 2 ? -1 : 1;
      const available = (x) => {
        const y = anchor.y;
        const spot = { x, y };
        if (x < 3 || x > 97 || y < 3 || y > 97 || gap(spot, anchor) > 6 + 1e-7 ||
            gap(b, spot) >= 20 || this._isOffsidePosition(a.team, spot)) return false;
        const other = a.team === "home" ? "away" : "home";
        if (a.role === "MID" && !this._isPrimaryMidRunner(a) && this._inOwnFoulBox(other, x, y)) return false;
        if (!this._supportRunClear(a, spot) || this._laneSafety(owner, a, x, y) < 1.8 / 8 ||
            !this._launchRouteClear(owner, { agent: a, tx: x, ty: y })) return false;
        return !this.agents.some((m) => m.id !== a.id && !m.sentOff && !m.injuredOff &&
          (m.team === a.team ? gap(spot, { x: m.tx, y: m.ty }) < OFF_BALL_TARGET_DEFAULTS.supportSpacingMetres
            : m.role !== "GK" && gap(spot, m) < 2));
      };
      // 先保留原精度内的有效点；补查窄间隙时从球员当前位置比较真实位移。
      // 球员可能已经站在开放线路上，不能因战术锚点仍被挡而强迫他挪动。
      for (const refine of [false, true]) {
        const originX = refine ? a.x : target.x;
        if (refine && available(originX)) choice = { x: originX, y: anchor.y };
        const searchXs = refine ? [...this._supportOfferSearchXs(a, anchor),
          ...[-6, -4, -2, 0, 2, 4, 6].map((offset) => anchor.x + offset / mx)] : [];
        for (const side of [preferredSide, -preferredSide]) {
          const edges = [...new Set([0, ...searchXs
            .filter((x) => Math.abs(x - anchor.x) * mx <= 6 + 1e-7)
            .map((x) => (x - originX) * mx * side).filter((offset) => offset > 0)])].sort((x, y) => x - y);
          const probes = refine ? edges.flatMap((edge, i) => i ? [(edges[i - 1] + edge) / 2, edge] : []) : [2, 4, 6];
          let lower = 0;
          for (const offset of probes) {
            if (!available(originX + offset * side / mx)) { lower = offset; continue; }
            let upper = offset;
            for (let step = 0; step < 10; step++) {
              const middle = (lower + upper) / 2;
              if (available(originX + middle * side / mx)) upper = middle;
              else lower = middle;
            }
            const spot = { x: originX + upper * side / mx, y: anchor.y };
            if (!choice || gap(a, spot) < gap(a, choice) - (refine ? 2 / 2 ** 10 : 1e-7)) choice = spot;
            break;
          }
        }
      }
      if (choice) offer = { ...choice, at: this.t, ownerId: b.owner, attackSince: this._teamAttackSince[a.team],
        origin: { x: b.x, y: b.y } };
    }
    if (!offer) return;
    a.tx = offer.x;
    a.ty = offer.y;
    a.fsm = "support";
    a.offBallTargetKind = "support-offer";
    a.offBallTarget = { ...a.offBallTarget, x: a.tx, y: a.ty, fsm: a.fsm, kind: "support-offer", offer };
  }

  _chooseAttackOffBallTarget(a, owner) {
    a.offBallTargetKind = null;
    const dir = this.attackDir(a.team);
    const b = this.ball;
    const ownGoalY = this.ownGoalY(a.team);
    const prog = clamp(Math.abs(b.y - ownGoalY) / 100, 0, 1);
    // 中卫线的整体前压量（y 格，朝进攻方向）。中卫线原本只站在与球位无关的常量上，
    // 导致进攻时后防线不跟球、队形被拉长成静态模板形状。真实球队是整体平移的块，
    // 所以按球的推进深度给出前压量：原常量锚点保留，另外叠一个随球前移的项。
    //
    // 前压幅度由该队的「防线高度」战术（defensiveLine，1–5）决定——这是现实中真正
    // 决定后卫线站位的量：高位逼抢的队整条线压上去，摆深防的队不上压。以标准级 3
    // 为基准，所以防线为 3 时乘数为 1、行为与未引入该因子时逐位相同。
    // 注意 delegation.js 已按实力差设定防线高度（强队 ≥4、弱队 ≤2），
    // 因此这个因子同时把「队形紧凑度」与「实力优势」解耦：强队压上、弱队回收。
    const cbLineLevel = this._tacticLevel(a.team, "defensiveLine");
    const cbShiftMax =
      SIM.CB_BLOCK_SHIFT_MAX_M * (1 + (cbLineLevel - 3) * SIM.CB_BLOCK_SHIFT_LINE_GAIN);
    // 符号：-dir * shiftY，其中 shiftY 为负 → home(dir=-1) 时 ty 增大 = 向前压。
    // 用米制换算回 y 格，保证同一物理前压量在任何球场尺度下对应同一格数。
    // `blockCurve` 是尾部加权（见 SIM.CB_BLOCK_TAIL_FROM 注释）：中场保持线性，
    // 球被压进对方半场深处时才陡增，队形长度因此在进攻三区回落而防反保护不变。
    const cbTailFrom = SIM.CB_BLOCK_TAIL_FROM;
    const blockCurve =
      prog > cbTailFrom ? prog + (prog - cbTailFrom) * SIM.CB_BLOCK_TAIL_GAIN : prog;
    const blockShiftY = (blockCurve * cbShiftMax) / (SIM.PITCH_H_METRES / SIM.FIELD_H);
    const blockForward = -dir * blockShiftY;
    const dBall = dist(a.x, a.y, b.x, b.y);
    const core = !!a.isCore;
    const finalThird = prog > 0.64;
    const roleDepth = this._roleBehavior(a, "depth");
    const roleSupport = this._roleBehavior(a, "support");
    const roleHold = this._roleBehavior(a, "hold");
    const roleWidth = this._roleBehavior(a, "width");
    const habitComesDeep = this._hasHabit(a, "comes_deep");
    const habitGetsForward = this._hasHabit(a, "gets_forward");
    const habitHugsLine = this._hasHabit(a, "hugs_line");
    const habitCutsInside = this._hasHabit(a, "cuts_inside");
    const comesDeep = habitComesDeep || (!habitGetsForward && roleSupport > 0.52);
    const getsForward = habitGetsForward || (!habitComesDeep && roleDepth > 0.38);
    const hugsLine = habitHugsLine || (!habitCutsInside && roleWidth > 0.4);
    const cutsInside = habitCutsInside || (!habitHugsLine && roleWidth < -0.34);

    if (
      owner &&
      owner.team === a.team &&
      owner !== a &&
      this._hasHabit(a, "plays_one_twos") &&
      this.ball.lastPasserId === a.id &&
      this.t - (this.ball.lastPassAt || 0) < 8.5
    ) {
      const side = a.x <= owner.x ? -1 : 1;
      a.tx = clamp(owner.x + side * (5 + this.random() * 3), 6, 94);
      a.ty = clamp(owner.y + dir * (5 + this.random() * 5), 5, 95);
      a.fsm = "support";
      a.offBallTargetKind = "one-two";
      this._clampOffside(a);
      return;
    }

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

    // 中卫不再因为离球较近跟进到禁区弧顶围球，但仍随球队整体前压：纵向目标 =
    // 原防反保护锚点（baseY + dir*7）+ 随球推进的整体平移量。这样整条中卫线在进攻
    // 三区会越过中线，队形长度回落到真实块长，而不再冻结在静态模板长度上；
    // 球权丧失时 prog 回落，前压量同步收回，防反保护强度不变。
    if (finalThird && a.role === "DEF" && !this._isFullback(a)) {
      a.tx = clamp(a.baseX + (b.x - 50) * 0.08, 18, 82);
      a.ty = clamp(a.baseY + dir * 7 + blockForward, 18, 82);
      a.fsm = "home";
      return;
    }

    // —— 核心无球：积极要球（靠近持球者接应），不全程钉在锋线 ——
    if (core && a.role !== "GK") {
      // 持球者是队友时：靠近做墙/要球
      if (owner && owner.team === a.team && owner !== a) {
        const side = a.x < owner.x ? -1 : 1;
        // 时而回撤到球后接应，时而前插要直塞
        if (prog < 0.55 || this.random() < 0.4) {
          a.tx = clamp(owner.x + side * (6 + this.random() * 5), 8, 92);
          a.ty = clamp(owner.y + dir * (4 + this.random() * 6), 5, 95);
        } else {
          a.tx = clamp(owner.x + (50 - owner.x) * 0.2 + side * 4, 10, 90);
          a.ty = clamp(owner.y + dir * (12 + this.random() * 8), 6, 94);
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
          this.random() <
            0.32 +
              (prog < 0.48 ? 0.22 : 0) +
              a.attr.dribbling * 0.15 +
              (comesDeep ? 0.32 : 0) +
              roleSupport * 0.12 +
              roleHold * 0.1);
      if (drop) {
        // 组织阶段保持左右固定通道；旧逻辑围绕球只偏 8~12，双翼会一起挤进中路。
        const wideAnchor = wingSide < 0 ? (hugsLine ? 10 : 17) : hugsLine ? 90 : 83;
        const ballSide = clamp(b.x + wingSide * 8, 8, 92);
        const pocketX = wideAnchor * 0.65 + ballSide * 0.35;
        // 进入前场后才稍微内收，己方半场/中场仍提供真正宽度。
        const softIn = clamp(
          prog > 0.55 && !hugsLine
            ? pocketX * (cutsInside ? 0.66 : 0.78) + 50 * (cutsInside ? 0.34 : 0.22)
            : pocketX,
          12,
          88
        );
        const dropDepth = 8 + this.random() * 10;
        a.tx = clamp(softIn + (this.random() - 0.5) * 4, 10, 90);
        // A2（2026-09-20）：纵向锚从「纯球位」改成「球位与阵型位的加权」。
        //
        // 根因（docs/offball-upstream-target-flip-2026-09-16.md §2.1）：
        // drop 分支原本锚在**球位**（`b.y + dir*dropDepth`），而下面的 else/内切
        // 分支锚在**固定阵型位**（`a.baseY + dir*...`）。两锚相距可达 **74 m**，
        // 且由 `this.random() < p` **每 0.42~1.32 s 重掷** ⇒ 目标点在两条分支间来回
        // 翻转 ⇒ 画面硬切（实测锚点翻转使「大跳 >=15m」概率提升 10.4 倍）。
        //
        // A2 在两条分支之间取折中：`lerp(baseY, 球位锚, A2_ANCHOR_BLEND)`，
        // 把 74 m 的间距按比例压缩。这与 `:5374` 防守跑位早就在用的
        // `baseY + (b.y - baseY) * pull` **同族**，只是那里的 pull 是 0~0.2。
        // 取 0.65 是为了**保留大部分回撤深度**（球位仍占主导），同时让两锚靠近。
        const ballAnchoredY = b.y + dir * dropDepth;
        a.ty = clamp(
          a.baseY + (ballAnchoredY - a.baseY) * SIM.A2_ANCHOR_BLEND,
          8,
          92
        );
        a.fsm = "support";
        this._clampOffside(a);
        return;
      }
      // 已过半场：肋部内切跑位（不是死钉边线）
      if (prog > 0.48 && !hugsLine) {
        const cutX = clamp(
          50 + wingSide * ((cutsInside ? 8 : 14) + this.random() * (cutsInside ? 7 : 10)),
          18,
          82
        );
        a.tx = clamp(cutX + (b.x - 50) * 0.08, 12, 88);
        a.ty = clamp(b.y + dir * (10 + this.random() * 10), 5, 95);
        a.fsm = "support";
        this._clampOffside(a);
        return;
      }
      // 默认：保持半宽，略前压，避开拥挤区
      let targetX = clamp(a.baseX * 0.55 + 50 * 0.25 + (b.x - 50) * 0.12, 10, 90);
      const targetY = clamp(a.baseY + dir * (8 + prog * 6), 5, 95);
      const shiftMetres = this._checkCrowding(a, targetX, targetY);
      if (shiftMetres !== 0) {
        const shiftX = shiftMetres / (SIM.PITCH_W_METRES / SIM.FIELD_W);
        targetX = clamp(targetX + shiftX, 10, 90);
      }
      a.tx = targetX;
      a.ty = targetY;
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
          this.random() <
            0.22 +
              (prog < 0.45 ? 0.18 : 0) +
              (comesDeep ? 0.42 : 0) -
              (getsForward ? 0.16 : 0) +
              roleSupport * 0.14 +
              roleHold * 0.12 -
              Math.max(0, roleDepth) * 0.12);
      if (drop) {
        const side = a.baseX < 48 ? -1 : a.baseX > 52 ? 1 : a.x < b.x ? -1 : 1;
        // 回撤深度：到球与中场之间，而不是一直顶在越位线
        const dropDepth = nearest || core ? 10 + this.random() * 8 : 14 + this.random() * 6;
        a.tx = clamp(b.x + side * (6 + this.random() * 8), 8, 92);
        // A2（2026-09-20）：与上方边锋/MID 的 drop 分支同一处理 ——
        // 纵向锚从「纯球位」改成「球位与阵型位的加权」，消掉与
        // 下方前插分支（锚在 `a.baseY`）之间最多 74 m 的锚点间距。
        // 见上方注释与 docs/offball-upstream-target-flip-2026-09-16.md §2.1。
        const ballAnchoredY = b.y + dir * dropDepth;
        a.ty = clamp(
          a.baseY + (ballAnchoredY - a.baseY) * SIM.A2_ANCHOR_BLEND,
          8,
          92
        );
        a.fsm = "support";
        return;
      }
      // 前插纵深，避开拥挤区
      let fwdTargetX = clamp(a.baseX + (b.x - 50) * 0.12, 6, 94);
      const fwdTargetY = clamp(a.baseY + dir * ((getsForward ? 18 : core ? 12 : 16) + roleDepth * 5), 3, 97);
      const fwdShiftMetres = this._checkCrowding(a, fwdTargetX, fwdTargetY);
      if (fwdShiftMetres !== 0) {
        const fwdShiftX = fwdShiftMetres / (SIM.PITCH_W_METRES / SIM.FIELD_W);
        fwdTargetX = clamp(fwdTargetX + fwdShiftX, 6, 94);
      }
      a.tx = fwdTargetX;
      a.ty = fwdTargetY;
      a.fsm = "home";
      this._clampOffside(a);
      return;
    }

    // —— 中场：接应 + 前插 ——
    if (a.role === "MID") {
      // 「已过中线前插」。原式 `home ? baseY < 52 : baseY > 48`：home 折算成
      // 纵深是 `> 48`，away 折算成纵深是 `> 52`（两侧锚点本身差 4 格，是历史
      // 错位值，本次只做收敛、不借机纠正）。阈值写成「距己方门」纵深，
      // 换边后由 `_depthFromOwnGoal` 自动跟随 `ownGoalY` 翻转。
      const advanced =
        this._depthFromOwnGoal(a.baseY, a.team) >
        this._depthFromOwnGoal(a.team === "home" ? 52 : 48, "home");
      const burst = 0.55 * a.attr.pace + 0.45 * a.attr.dribbling;
      const wantRun =
        prog > 0.42 &&
        (advanced || burst > 0.48 || core) &&
        !comesDeep &&
        (dBall > 16 || this.random() < 0.28 + burst * 0.35 + (getsForward ? 0.12 : 0));

      if (wantRun && dBall > 12) {
        const side =
          a.baseX < 42
            ? -1
            : a.baseX > 58
              ? 1
              : (a.num || 0) % 2
                ? -0.45
                : 0.45;
        const depth =
          11 + burst * 10 + (advanced ? 4 : 0) + (core ? 3 : 0) + (getsForward ? 2 : 0) + roleDepth * 4;
        a.tx = clamp(
          b.x + side * (12 + this.random() * 6) + (a.baseX - 50) * 0.12,
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
        a.tx = clamp(b.x + side * (11 + this.random() * 6), 5, 95);
        a.ty = clamp(b.y + dir * (7 + this.random() * 5), 3, 97);
        a.fsm = "support";
      } else {
        let midTargetX = clamp(a.baseX + (b.x - 50) * 0.18, 5, 95);
        const midTargetY = clamp(a.baseY + dir * (10 + prog * 6), 3, 97);
        const midShiftMetres = this._checkCrowding(a, midTargetX, midTargetY);
        if (midShiftMetres !== 0) {
          const midShiftX = midShiftMetres / (SIM.PITCH_W_METRES / SIM.FIELD_W);
          midTargetX = clamp(midTargetX + midShiftX, 5, 95);
        }
        a.tx = midTargetX;
        a.ty = midTargetY;
        a.fsm = "home";
      }
      this._clampOffside(a);
      return;
    }

    // —— 边后卫：进攻时套边前插 / 提供传中 ——
    if (this._isFullback(a)) {
      const wide = a.baseX < 50 ? -1 : 1;
      // 本队控球且球已过半场：有概率沿边路前插。
      // 「球在本侧」是新增门槛：套边是沿球所在边路的配合，远侧边卫应内收保护
      // 而不是横穿整个半场去套边（旧门槛 `dBall < 55` 在 09-14 提高远侧兜底站位后
      // 大量失效，远侧套边率被动升到 27.3%）。
      // ⚠ 必须与 `dBall < 55` **同时**成立，不能拿同侧判定替换它：实测（标准档 24 场
      // 同种子）替换式会让近侧在 dBall≥55 时也套边（仅占近侧决策的 0.3%），
      // 进球 2.75 → **2.29 跌破下限 2.5**；保留距离门槛、只额外要求同侧则读到 **2.92**，
      // 且近侧行为与 HEAD 逐位一致。两者对远侧的效果相同（都不套边）。
      const ballOnSide = wide < 0 ? b.x < 50 : b.x > 50;
      const bombOn =
        prog > 0.38 &&
        (prog > 0.55 ||
          this.random() < 0.32 + a.attr.pace * 0.25 + (getsForward ? 0.12 : 0) + roleDepth * 0.1 - roleHold * 0.08) &&
        dBall < 55 &&
        ballOnSide;
      if (bombOn) {
        // 套边：贴边线 + 推到球的平行甚至更前，准备传中
        a.tx = clamp(wide < 0 ? 8 + this.random() * 6 : 86 + this.random() * 6, 4, 96);
        a.ty = clamp(b.y + dir * (8 + this.random() * 12 + prog * 8), 8, 92);
        a.fsm = "support";
        this._clampOffside(a);
        return;
      }
      // 未前插：保持宽度、略前压，避开拥挤区。**同样叠加整体前压量**。
      // 远侧边卫（球在对侧）进不了上面的套边分支（门槛：球须在本侧），
      // 于是只能落到这里；如果这里只留一个与球位几乎无关的 `4 + prog*5`（0→5 m），
      // 它就会钉在距己方门线约 38 m —— 球队在对方禁区前沿围攻时，一名边卫却仍站在
      // 己方三区边缘，整条后防线被撕成两截（实测控球时 85.1% 的队帧两名边卫相差 >20 m，
      // 跨度 58.6 m 里有 20 m 全由这名边卫贡献）。
      // 边卫与中卫同属一条后卫线，所以用同一个 `blockForward`，队形才是一个整体。
      let fbTargetX = clamp(a.baseX + wide * 2 + (b.x - 50) * 0.08, 4, 96);
      const fbTargetY = clamp(a.baseY + dir * (4 + prog * 5) + blockForward, 6, 94);
      const fbShiftMetres = this._checkCrowding(a, fbTargetX, fbTargetY);
      if (fbShiftMetres !== 0) {
        const fbShiftX = fbShiftMetres / (SIM.PITCH_W_METRES / SIM.FIELD_W);
        fbTargetX = clamp(fbTargetX + fbShiftX, 4, 96);
      }
      a.tx = fbTargetX;
      a.ty = fbTargetY;
      a.fsm = "home";
      this._clampOffside(a);
      return;
    }

    // —— 中卫：近球少接应，否则回位并随球队整体前压 ——
    if (dBall < 22) {
      const side = a.x < b.x ? -1 : 1;
      a.tx = clamp(b.x + side * (10 + this.random() * 4), 5, 95);
      a.ty = clamp(b.y + dir * 3, 3, 97);
      a.fsm = "support";
    } else {
      let cbTargetX = clamp(a.baseX + (b.x - 50) * 0.12, 5, 95);
      const cbTargetY = clamp(a.baseY + dir * 3 + blockForward, 3, 97);
      const cbShiftMetres = this._checkCrowding(a, cbTargetX, cbTargetY);
      if (cbShiftMetres !== 0) {
        const cbShiftX = cbShiftMetres / (SIM.PITCH_W_METRES / SIM.FIELD_W);
        cbTargetX = clamp(cbTargetX + cbShiftX, 5, 95);
      }
      a.tx = cbTargetX;
      a.ty = cbTargetY;
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
    // ⚠ 2026-09-22 修：原来按队名分支（`team === "home"` 要求 `player.y < 50`）——
    //   「在对方半场」被写死成 y<50。下半场换边后主队的对方半场是 y>50，
    //   于是**整场基本吹不出越位**。改由 `attackDir` 派生方向；
    //   三个比较的运算顺序保持原样（不用纵深换算，避免浮点差异）。
    const dir = this.attackDir(team);
    if (dir < 0) {
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

  /**
   * 检测目标点周围是否拥挤（3米内有2+队友），用于 home 状态的空间感知。
   * 返回建议的横向偏移量（米），0 表示不拥挤。
   * 加入稳定窗口避免震荡：一旦偏移，1.5秒内保持该决策。
   */
  _checkCrowding(a, targetX, targetY) {
    if (this.t < (a.crowdShiftUntil || 0)) {
      return a.crowdShiftMetres || 0;
    }

    const crowdRadius = 3;
    const radiusX = crowdRadius / (SIM.PITCH_W_METRES / SIM.FIELD_W);
    const radiusY = crowdRadius / (SIM.PITCH_H_METRES / SIM.FIELD_H);

    let nearbyCount = 0;
    for (const m of this.agents) {
      if (m.team !== a.team || m === a || m.role === "GK") continue;
      const dx = Math.abs(m.x - targetX);
      const dy = Math.abs(m.y - targetY);
      if (dx < radiusX && dy < radiusY) {
        nearbyCount++;
        if (nearbyCount >= 2) break;
      }
    }

    if (nearbyCount >= 2) {
      const shiftMetres = 4 + this.random() * 2;
      const direction = targetX < 50 ? -1 : 1;
      a.crowdShiftMetres = direction * shiftMetres;
      a.crowdShiftUntil = this.t + 1.5;
      return a.crowdShiftMetres;
    }
    a.crowdShiftMetres = 0;
    a.crowdShiftUntil = this.t + 1.5;
    return 0;
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
    let effectiveBuffer;
    if (this.t < (a.offsideBufferUntil || 0) && Number.isFinite(a.offsideRunBuffer)) {
      effectiveBuffer = a.offsideRunBuffer;
    } else {
      effectiveBuffer =
        this.random() < mistimeChance ? -(0.45 + (1 - awareness) * 0.9) : roleBuffer;
      a.offsideRunBuffer = effectiveBuffer;
      a.offsideBufferUntil = this.t + 0.2;
    }
    // —— 越位自律，用「纵深」重写 ——
    // 原式（home）：
    //   const legalY = Math.min(offY, ball.y);   // 合法 y = 两者中更靠前（y 更小）者的 y
    //   if (a.ty < legalY + buffer) a.ty = legalY + buffer;
    //   （away 逐项取反：max / `a.ty > legalY - buffer` / `legalY - buffer`）
    //
    // 换成「纵深」后主客两条分支合成一条：纵深越大越靠前，于是
    //   合法纵深 = max(越位线纵深, 球纵深)   ⇔  home 的 min(offY, ball.y)
    //   目标     = 合法位置再往后 buffer 格 ⇒ 纵深 = 合法纵深 - buffer
    //   （buffer 有符号，mistime 为负 ⇒ 自动变成「允许越位失误」，与原式一致）
    //
    // ⚠ 三个坑，全是逐位对比抓出来的，勿再重犯：
    //   1. 目标纵深**不能 clamp 到 [0,100]**。原式允许 `legalY + buffer` 落到
    //      场外（如 offY=ball=97、buffer=3.2 时得 100.2）。加 clamp 会在边界
    //      点改变 a.ty（枚举 2626 组合不一致）。
    //   2. **合法位置必须在 y 空间取 min/max，不要走 `_ownGoalSideY` 往返**。
    //      `ownSideY(own - offY)` 这类往返在浮点上不精确（实测 45% 的取值
    //      有 ~7e-15 误差），会被混沌放大到可见量级。
    //   3. 同理，赋值也不要由纵深反算。下面 `legalY` 就是原式的 min/max，
    //      `legalTarget` 就是原式的 `legalY ± buffer`，运算顺序完全一致。
    const depthOf = (y) => this._depthFromOwnGoal(y, a.team);
    // home 越位线在 y 小侧 ⇒ 取 min；away 反之取 max。（`_sign` = 进攻方向）
    const legalY =
      this._sign(a.team) < 0 ? Math.min(offY, this.ball.y) : Math.max(offY, this.ball.y);
    // 「再往后 buffer 格」= 沿背离进攻方向偏移 ⇒ `-sign * buffer`。
    const legalTarget = legalY - this._sign(a.team) * effectiveBuffer;
    // 只在目标比合法线更靠前（纵深更大）时才夹回，与原式的单边夹取一致。
    if (depthOf(a.ty) > depthOf(legalTarget)) {
      a.ty = legalTarget;
    }
  }

  /** 本队离球最近的前锋？（用于指派”回撤支点”的那一个） */
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
    // 池子必须是「真的在场上」的中场。`_commitInjury` 把伤退也走 `sentOff`
    // （注释原文「退出决策/跑位/发球候选，场上真实少一人」），而
    // `_applyPassSupport` 里的兄弟规则同样过滤了这两个标志。此前漏了这一步：
    // 一旦评分最高的中场被罚下，`mids[0]` 就是那名离场球员，于是**场上没有任何
    // 中场拿到名额**，而最后三区规则「三名前锋 + 一名最适合前插的中场」与禁区
    // 接应限制都写成「恰好一名」——规则会从「一名」静默退化成「零名」，
    // 并在剩下整场里一直关着。
    const mids = this.agents
      .filter((m) => m.team === a.team && m.role === "MID" && !m.sentOff && !m.injuredOff)
      .sort((m, n) => {
        const sm =
          (m.isCore ? 1.2 : 0) +
          0.4 * m.attr.dribbling +
          0.25 * m.attr.pace +
          0.2 * m.attr.finishing +
          0.15 * m.attr.vision +
          (this._hasHabit(m, "gets_forward") ? 0.45 : 0) +
          this._roleBehavior(m, "depth") * 0.55;
        const sn =
          (n.isCore ? 1.2 : 0) +
          0.4 * n.attr.dribbling +
          0.25 * n.attr.pace +
          0.2 * n.attr.finishing +
          0.15 * n.attr.vision +
          (this._hasHabit(n, "gets_forward") ? 0.45 : 0) +
          this._roleBehavior(n, "depth") * 0.55;
        return sn - sm || String(m.id).localeCompare(String(n.id));
      });
    return mids[0]?.id === a.id;
  }

  _defensiveThreats(attackingTeam, owner, ownGoalY) {
    return this.agents
      .filter(
        (candidate) =>
          candidate.team === attackingTeam &&
          candidate.role !== "GK" &&
          !candidate.sentOff &&
          candidate.id !== owner?.id
      )
      .map((candidate) => {
        const goalDistance = pitchDistanceToGoalMetres(candidate.x, candidate.y, ownGoalY);
        const ballDistance = pitchDistanceBetween(candidate.x, candidate.y, this.ball.x, this.ball.y);
        const centrality = 1 - clamp(Math.abs(candidate.x - 50) / 46, 0, 1);
        const roleBonus = candidate.role === "ATT" ? 8 : candidate.role === "MID" ? 4 : 0;
        return {
          candidate,
          goalDistance,
          score:
            (70 - goalDistance) * 1.15 +
            Math.max(0, 26 - ballDistance) * 0.42 +
            centrality * 8 +
            roleBonus,
        };
      })
      .filter((item) => item.goalDistance < 62)
      .sort(
        (left, right) =>
          right.score - left.score ||
          String(left.candidate.id).localeCompare(String(right.candidate.id))
      );
  }

  _assignMarkingJobs(
    team,
    owner,
    jobs,
    candidates,
    previousJobs,
    profile,
    ownGoalY,
    maxMarks = profile.markingCount
  ) {
    const occupiedTargets = new Set(
      [...jobs.values()]
        .map((job) => job.markId || job.shadowId || null)
        .filter(Boolean)
    );
    const threats = this._defensiveThreats(owner?.team, owner, ownGoalY)
      .filter((item) => !occupiedTargets.has(item.candidate.id));
    let assigned = 0;
    let handoffs = 0;
    for (const threat of threats) {
      if (assigned >= maxMarks) break;
      const available = candidates
        .filter(
          (defender) =>
            (defender.role === "DEF" || defender.role === "MID") &&
            jobs.get(defender.id)?.type === "shape"
        )
        .map((defender) => {
          const distance = pitchDistanceBetween(
            defender.x,
            defender.y,
            threat.candidate.x,
            threat.candidate.y
          );
          const layerPenalty = defender.role === "MID" && threat.goalDistance < 24 ? 3.2 : 0;
          const wrongSidePenalty =
            Math.sign(defender.x - 50) !== Math.sign(threat.candidate.x - 50) ? 1.8 : 0;
          return { defender, distance, cost: distance + layerPenalty + wrongSidePenalty };
        })
        .sort(
          (left, right) =>
            left.cost - right.cost ||
            String(left.defender.id).localeCompare(String(right.defender.id))
        );
      const best = available[0];
      if (!best) break;
      if (
        best.distance > profile.markingDistanceMetres &&
        threat.goalDistance > 24
      ) {
        continue;
      }

      const previous = [...previousJobs.entries()].find(
        ([, job]) => job.type === "mark" && job.markId === threat.candidate.id
      );
      let chosen = best;
      if (previous) {
        const current = available.find((item) => item.defender.id === previous[0]);
        if (
          current &&
          !shouldHandoffMark({
            currentDistanceMetres: current.distance,
            bestDistanceMetres: best.distance,
            currentMarking: current.defender.attr.marking,
            currentDecisions: current.defender.attr.decisions,
            profile,
          })
        ) {
          chosen = current;
        }
      }
      const handoffFrom = previous && previous[0] !== chosen.defender.id ? previous[0] : null;
      if (handoffFrom) handoffs++;
      jobs.set(chosen.defender.id, {
        type: "mark",
        markId: threat.candidate.id,
        handoffFrom,
      });
      assigned++;
    }
    return handoffs;
  }

  /** 每 0.48~1.08s 为整队刷新一次防守任务；窗口内保持交接与协防职责。 */
  _refreshDefPlan(team, owner, phase = this._teamShapePhase(team)) {
    const plan = this._defPlans[team];
    const pressing = clamp(
      this._tacticLevel(team, "pressing") * this._teamModifier(team, "def"),
      1,
      5
    );
    const shapeProfile = this._shapeProfile(team);
    const profile = this._collectiveDefenseProfile(team);
    const defensiveTransition = phase === TEAM_SHAPE_PHASES.DEFENSIVE_TRANSITION;
    const counterPress = defensiveTransition && shapeProfile.transition.counterPress;
    const planPhase = defensiveTransition
      ? TEAM_SHAPE_PHASES.DEFENSIVE_TRANSITION
      : TEAM_SHAPE_PHASES.OUT_OF_POSSESSION;
    const ballSide = this.ball.x < 34 ? -1 : this.ball.x > 66 ? 1 : 0;
    const flankSide = this.ball.x < 22 ? -1 : this.ball.x > 78 ? 1 : 0;
    const ownerId = owner?.id || this.ball.receiverId || null;
    // 飞行时 phaseActor 已是接球人；接球和停稳会改变分工，不能仅凭同一 ID 复用计划。
    if (
      plan &&
      plan.phase === planPhase &&
      plan.ownerId === ownerId &&
      plan.ballSide === ballSide &&
      plan.ballState === this.ball.state &&
      this.t < plan.until &&
      plan.jobs.size
    ) {
      return plan;
    }

    const candidates = this.agents.filter(
      (a) => a.team === team && a.role !== "GK" && !a.sentOff
    );
    // 角色「压迫」行为只改变谁更愿意成为上抢者：抢球中场 / 压迫型前锋的
    // 有效距离更短，会优先从压迫战术中领到上抢任务，其余仍按离球真实距离。
    // 权重上限 2.4 米，不会把远端的球员拽到前场，只影响“几近并列”的排序。
    const pressReach = (a) => Math.min(Math.max(0, this._roleBehavior(a, "press")) * 2.4, 2.4);
    const effDist = (a) =>
      pitchDistanceBetween(a.x, a.y, this.ball.x, this.ball.y) - pressReach(a);
    const ordered = candidates.slice().sort((a, b) => {
      const da = effDist(a);
      const db = effDist(b);
      return da - db || String(a.id).localeCompare(String(b.id));
    });
    const nearest = ordered[0] || null;
    const ownGoalY = this.ownGoalY(team);
    const spatialTrigger = pressingTrigger({
      tactics: this._teamTactics(team),
      phase,
      ballX: this.ball.x,
      ballY: this.ball.y,
      ownGoalY,
      ownerHeading: owner?.heading,
      ownerAttackDirection: owner ? this.attackDir(owner.team) : -this.attackDir(team),
      ownerControlPhase: owner?.controlPhase,
      ballState: this.ball.state,
      nearestDistanceMetres: nearest
        ? pitchDistanceBetween(nearest.x, nearest.y, this.ball.x, this.ball.y)
        : Infinity,
    });
    const trigger =
      !spatialTrigger.active && pressing >= 3
        ? Object.freeze({
            ...spatialTrigger,
            active: true,
            kind: PRESS_TRIGGER_KINDS.PROXIMITY,
            urgency: 0.5,
          })
        : spatialTrigger;
    const previousJobs = new Map(plan.jobs);
    const oldPressId = [...previousJobs.entries()].find(
      ([, job]) => job.type === "press" || job.type === "contain"
    )?.[0];
    const oldPress = oldPressId ? candidates.find((a) => a.id === oldPressId) : null;
    // 迟滞：旧上抢者没有明显落后就继续，避免两个人每 tick 互换职责。
    // 但必须自己也够得着球（有效距离 <5.5）：否则贴身队友全是 screen/shape 无权下脚，
    // 而挂名 presser 永远追不上 → 持球僵持。
    const presser =
      oldPress &&
      nearest &&
      effDist(oldPress) <= 5.5 &&
      effDist(oldPress) <= effDist(nearest) + 3.5
        ? oldPress
        : nearest;

    const jobs = new Map(candidates.map((a) => [a.id, { type: "shape" }]));
    const danger = owner ? this._mostDangerousReceiver(owner.team) : null;
    if (presser) {
      jobs.set(presser.id, {
        type: trigger.active ? "press" : "contain",
        trigger: trigger.kind,
        urgency: trigger.urgency,
        shadowId: danger?.id || null,
      });
    }

    const rest = ordered.filter((a) => a !== presser);
    const oldScreenId = [...previousJobs.entries()].find(([, job]) => job.type === "screen")?.[0];
    const oldScreen = oldScreenId ? rest.find((candidate) => candidate.id === oldScreenId) : null;
    const screen =
      oldScreen && rest[0] && effDist(oldScreen) <= effDist(rest[0]) + profile.handoffMarginMetres
        ? oldScreen
        : rest[0];
    if (screen) jobs.set(screen.id, { type: "screen", markId: danger?.id || null });
    let interceptN = 0;
    // 一人贴身、次近者盯接球点，通道拦截者只封线不再同时扑向球。
    // 标准压迫最多一名通道拦截者，极高压迫才允许第二人封另一侧。
    const maxInterceptors = trigger.active
      ? pressing >= 5 || (counterPress && pressing >= 4) ? 2 : pressing >= 3 ? 1 : 0
      : 0;
    const interceptRange = 16 + pressing * 2 + (counterPress ? 4 : 0);
    const usedSides = new Set();
    for (const a of rest.slice(1)) {
      if (interceptN >= maxInterceptors) break;
      if (a.role === "DEF") continue;
      const reach = interceptRange + Math.max(0, this._roleBehavior(a, "press")) * 6;
      if (pitchDistanceBetween(a.x, a.y, this.ball.x, this.ball.y) > reach) continue;
      let side = (a.baseX ?? a.x) <= this.ball.x ? -1 : 1;
      if (usedSides.has(side)) side *= -1;
      usedSides.add(side);
      jobs.set(a.id, { type: "intercept", side, order: interceptN });
      interceptN++;
    }

    // 边路触发时由下一名后卫保护肋部，避免边后卫上抢后中卫仍横向不动。
    if (flankSide !== 0) {
      const wideCover = candidates
        .filter((candidate) => candidate.role === "DEF" && jobs.get(candidate.id)?.type === "shape")
        .sort(
          (left, right) =>
            pitchDistanceBetween(left.x, left.y, this.ball.x, this.ball.y) -
              pitchDistanceBetween(right.x, right.y, this.ball.x, this.ball.y) ||
            String(left.id).localeCompare(String(right.id))
        )[0];
      if (wideCover) jobs.set(wideCover.id, { type: "wide-cover", side: flankSide });
    }

    // 阵地战此前只有 pressing>=5 才派盯人，于是禁区里一个盯人都没有：实测对方
    // 在自家禁区持球时，mark 只占防守任务时长的 0.2%，四名后卫全部落在 shape 上，
    // 被支援安全圈推到离球 3 米开外站着看。真实球队不论压迫设置高低，球进入自家
    // 禁区都会贴人。危险度只读球到自家球门的真实距离，不读比分、名望或球队身份。
    // 距离取真实禁区纵深 16.5 米、名额取 1：实测放到 20 米 / 2 人时后台档进球
    // 由 2.71 掉到 2.29（真实约 2.7），防守强度明显过头。
    const ballGoalDistanceMetres = pitchDistanceToGoalMetres(
      this.ball.x,
      this.ball.y,
      ownGoalY
    );
    // 名额随危险度递增：球到自家球门 11 米内（约小禁区弧顶到点球点一带）
    // 派两人，因为这时禁区里通常已有两名以上进攻者插入，一个盯人必然漏一个。
    // 更远处仍只派一人，避免全队被吸进禁区。
    //
    // 上一次尝试放到「20 米 / 2 人」时后台档进球从 2.71 掉到 2.29，于是退回 1 人。
    // 但那次只收紧了防守、没有同时松开 _shoot 的全队射门冷却，进球必然掉——
    // 防守变强 + 射门仍被冷却压死 = 机会少且不敢射。本轮三处一起改。
    // ⛔ 上面这套只看**球离门多远**，完全不看**禁区里站了几个人**。实测
    //    （`scripts/_box-marking-probe.mjs`，12 场）：禁区内平均 2.9~3.0 名进攻者，
    //    而 5 米内一个防守者都没有的占 **19.6%（有人持球）/ 20.8%（传中飞行中）**
    //    —— 五个人里有一个完全没人管，传中飞行段与有人持球段几乎一样糟。
    //    普通传中点（x=15, y=88）离门 23.4m，默认 pressing=3 → 上面那三元式给 0：
    //    **整个传中过程一个盯人都没有。**
    //
    // ✅ 所以补一条地板：禁区里有几个进攻者，就至少派同样多的人盯。
    //    上限**读球队自己的防守档**（`profile.markingCount`，pressing≥4 给 2、否则 1）
    //    再 +1：守自家禁区时比平时多压一个人上去，其余仍留在 shape 上保护第二落点
    //    与反击出口。所以默认俱乐部（pressing 3）上限 2，高压球队上限 3。
    //    人数用引擎自己的 `_inOwnPenaltyArea`（x∈(18,82)、y>80）数，比画面画的那个框
    //    深 4.2m 宽 2.7m；门将的所有出击闸门本来也跑在这个框里，两处保持同一个框。
    //
    //    ⛔ 第一版写死上限 3。12 场禁区指标确实更好（>5m 完全无人 19.6% → 14.8%），
    //       但 24 场标定 `shotConversionPct` 掉出 9~15% 护栏——禁区里多站的人把射门
    //       挡掉了，而 `_emit("shot")` 在出脚那一刻就记（engine.js:3191），封堵算射门
    //       不算进球，于是转化率被压低。基线本来只有 9.69%（进球 2.83 / 射门 29.21），
    //       余量 0.69pp，经不起这一下。**射门量本身偏高（14.6/队场 vs 真实 11.9~13.8）
    //       才是转化率贴着下沿的根因**，不是这条地板的错，但它没有余量可用。
    let boxAttackers = 0;
    for (const opponent of this.agents) {
      if (opponent.team === team || opponent.sentOff || opponent.role === "GK") continue;
      if (this._inOwnPenaltyArea(team, opponent.x, opponent.y)) boxAttackers++;
    }
    const boxMarkingFloor = Math.min(boxAttackers, profile.markingCount + 1);
    const markingLimit = defensiveTransition
      ? Math.min(1, profile.markingCount)
      : Math.max(
          ballGoalDistanceMetres < 11
            ? 2
            : pressing >= 5 || ballGoalDistanceMetres < 16.5
              ? 1
              : 0,
          boxMarkingFloor
        );
    const handoffs = this._assignMarkingJobs(
      team,
      owner,
      jobs,
      candidates,
      previousJobs,
      profile,
      ownGoalY,
      markingLimit
    );
    if (defensiveTransition && (profile.counterPress || profile.regroup)) {
      for (const [id, job] of jobs) {
        if (job.type === "shape") {
          jobs.set(id, { type: "recover", counterPress: trigger.active && counterPress });
        }
      }
    }

    plan.jobs = jobs;
    plan.phase = planPhase;
    plan.ownerId = ownerId;
    plan.ballSide = ballSide;
    plan.ballState = this.ball.state;
    plan.trigger = trigger;
    plan.coordination = profile;
    plan.handoffs = handoffs;
    plan.until =
      this.t +
      clamp(0.88 - (pressing - 3) * 0.08 - (counterPress ? 0.12 : 0), 0.48, 1.08) +
      this.random() * 0.28;
    return plan;
  }

  /**
   * 防守方执行球队统一任务：press / screen / intercept / shape。
   * 任务短时锁定，目标点仍连续跟随球和被盯球员。
   */
  _defensiveSupportTarget(x, y, ownGoalY, minDistance = 4.8, sideHint = 0) {
    const b = this.ball;
    let dx = x - b.x;
    let dy = y - b.y;
    const length = pitchDistanceMetres(dx, dy);
    if (length >= minDistance) {
      return { x: clamp(x, 3, 97), y: clamp(y, 3, 97) };
    }
    if (length < 1e-6) {
      dx = sideHint || (b.x >= 50 ? -1 : 1);
      dy = (ownGoalY - b.y) * 0.2;
    }
    const offset = pitchOffsetToward(dx, dy, minDistance);
    return {
      x: clamp(b.x + offset.x, 3, 97),
      y: clamp(b.y + offset.y, 3, 97),
    };
  }

  _thinkDefend(a, owner) {
    const b = this.ball;
    const ownGoalY = this.ownGoalY(a.team);
    const phaseTeam = owner?.team || this._phaseTeam;
    const ownerId = owner?.id || this.ball.receiverId || null;
    let context = this._stepDefContext;
    if (
      !context ||
      context.team !== a.team ||
      context.phaseTeam !== phaseTeam ||
      context.ownerId !== ownerId
    ) {
      const phase = this._teamShapePhase(a.team, phaseTeam);
      const shapeProfile = this._shapeProfile(a.team);
      const plan = this._refreshDefPlan(a.team, owner, phase);
      context = {
        team: a.team,
        phaseTeam,
        ownerId,
        phase,
        shapeProfile,
        plan,
        coordination: plan?.coordination || this._collectiveDefenseProfile(a.team),
      };
      this._stepDefContext = context;
    }
    const { phase, shapeProfile, plan, coordination } = context;
    const job = plan?.jobs.get(a.id) || { type: "shape" };
    a.shapePhase = phase;

    if (job.type === "press") {
      // 上抢者：站到"球→己方球门"连线上、略靠球一侧，逼停并封堵推进。
      // 越靠近己方球门（禁区内），站位越贴身——真正逼停持球人、压缩其射门空间，
      // 让前锋无法轻松捅到门前近距离（这是把射门距离推回真实区间的关键）。
      const gx = 50, gy = ownGoalY;
      const bx = b.x, by = b.y;
      const vx = gx - bx, vy = gy - by;
      // 球离己方球门越近，standoff 越小（禁区内贴到 0.8m，中场保持 2.4m）
      const dBallGoal = pitchDistanceToGoalMetres(bx, by, gy);
      const pressing = this._tacticLevel(a.team, "pressing");
      // 高压迫角色上抢略更贴身，但克制：默认角色几乎无感，只有明确指派
      // 抢球中场/压迫型前锋时才明显，避免整体提高防守强度改变传球基线。
      const rolePress = Math.max(0, this._roleBehavior(a, "press"));
      const awareness = defensiveAwarenessProfile(a.attr);
      const standoff =
        clamp(0.8 + dBallGoal / 30 * 1.6, 0.8, 2.4) *
        clamp(1 - (pressing - 3) * 0.07, 0.78, 1.18) *
        clamp(1 - rolePress * 0.08, 0.9, 1) *
        clamp(1.06 - (Number(job.urgency) || 0.6) * 0.08, 0.97, 1.03) *
        awareness.standoffMultiplier;
      const goalOffset = pitchOffsetToward(vx, vy, standoff);
      let targetOffset = goalOffset;
      const shadow = job.shadowId ? this.agentById(job.shadowId) : null;
      if (shadow && shadow.team !== a.team) {
        const sx = shadow.x - bx;
        const sy = shadow.y - by;
        // 夹角和下面的站位偏移使用同一米制几何，不能把 68×105 米球场当成正方形。
        const goalVector = pitchVectorMetres(vx, vy);
        const shadowVector = pitchVectorMetres(sx, sy);
        const goalLength = Math.hypot(goalVector.x, goalVector.y) || 1;
        const shadowLength = Math.hypot(shadowVector.x, shadowVector.y) || 1;
        const alignment = (goalVector.x * shadowVector.x + goalVector.y * shadowVector.y) /
          (goalLength * shadowLength);
        if (alignment > 0.08) {
          const shadowOffset = pitchOffsetToward(sx, sy, standoff);
          const shadowWeight = job.trigger === PRESS_TRIGGER_KINDS.TOUCHLINE ? 0.34 : 0.24;
          targetOffset = {
            x: goalOffset.x * (1 - shadowWeight) + shadowOffset.x * shadowWeight,
            y: goalOffset.y * (1 - shadowWeight) + shadowOffset.y * shadowWeight,
          };
        }
      }
      if (job.trigger === PRESS_TRIGGER_KINDS.TOUCHLINE) {
        const inside = pitchOffsetMetres(bx < 50 ? 0.55 : -0.55, 0);
        targetOffset.x += inside.x;
      }
      a.tx = clamp(bx + targetOffset.x, 3, 97);
      a.ty = clamp(by + targetOffset.y, 3, 97);
      a.fsm = "press";
      this._applyExplicitShapeAnchor(a, phase, 0.06);
      return;
    }

    if (job.type === "contain") {
      const awareness = defensiveAwarenessProfile(a.attr);
      const offset = pitchOffsetToward(
        50 - b.x,
        ownGoalY - b.y,
        4.4 * awareness.standoffMultiplier
      );
      a.tx = clamp(b.x + offset.x, 3, 97);
      a.ty = clamp(b.y + offset.y, 3, 97);
      a.fsm = "cover";
      this._applyExplicitShapeAnchor(a, phase, 0.1);
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
        const dBallGoal = Math.abs(b.y - ownGoalY) * (SIM.PITCH_H_METRES / SIM.FIELD_H);
        const awareness = defensiveAwarenessProfile(a.attr);
        const supportDistance = (dBallGoal < 19 ? 3.5 : 5.1) * awareness.standoffMultiplier;
        let support = this._defensiveSupportTarget(
          mx,
          my,
          ownGoalY,
          supportDistance,
          mark.x <= b.x ? -1 : 1
        );
        const supportVector = pitchVectorMetres(support.x - b.x, support.y - b.y);
        const playerVector = pitchVectorMetres(a.x - b.x, a.y - b.y);
        const crossesPressureCircle =
          supportVector.x * playerVector.x + supportVector.y * playerVector.y < 0;
        if (crossesPressureCircle) {
          const sameSide = pitchOffsetToward(a.x - b.x, a.y - b.y, supportDistance);
          support = {
            x: clamp(b.x + sameSide.x, 3, 97),
            y: clamp(b.y + sameSide.y, 3, 97),
          };
        }
        a.tx = support.x;
        a.ty = support.y;
        a.fsm = "cover";
        this._applyExplicitShapeAnchor(a, phase, 0.12);
        return;
      }
    }

    if (job.type === "mark") {
      const mark = job.markId ? this.agentById(job.markId) : null;
      if (mark && !mark.sentOff && mark.team !== a.team) {
        const goalDistance = pitchDistanceToGoalMetres(mark.x, mark.y, ownGoalY);
        const awareness = defensiveAwarenessProfile(a.attr);
        // 贴身程度读防守意识（marking / positioning / decisions）：意识顶级的能贴到
        // 1.5 米，意识差的只守到 3 米开外。此前这个距离与属性完全无关，弱队后卫
        // 因此拿到与顶级中卫等同的贴身收益——既压缩了实力差，也不符合真实：
        // 盯得住人本来就是能力差异最直接的体现之一。
        const markDistance = clamp(
          2.05 + goalDistance / 48 - (awareness.awareness - 0.5) * 1.3,
          1.5,
          3.4
        );
        const goalSide = pitchOffsetToward(50 - mark.x, ownGoalY - mark.y, markDistance);
        const ballSide = pitchOffsetToward(b.x - mark.x, b.y - mark.y, 1.35);
        const markX = mark.x + goalSide.x + ballSide.x;
        const markY = mark.y + goalSide.y + ballSide.y;
        const zoneX = weakSideTargetX({ baseX: a.baseX, ballX: b.x, profile: coordination });
        const zoneY = this._defLineY(a);
        // markWeight 是「贴人」与「守区域」的混合比。上限 0.66 意味着即使在禁区
        // 里也有三分之一的权重把人拉回区域位置，实测最近防守者中位 2.03 米——
        // 混合出来的距离，不是真的贴身。危险区（离门 12 米内）把上限放到 0.86，
        // 让盯人在门前真正贴住自己的人；禁区外仍保持原来的混合，维持阵型。
        const dangerZone = goalDistance < 12;
        // 危险区的贴人权重同样跟意识走：顶级 0.86、平庸 0.7 左右，
        // 不能一刀切（见下方 minDistance 的同一理由）。
        const markWeight = clamp(
          (dangerZone
            ? 0.7 + clamp(awareness.awareness - 0.5, -0.2, 0.2) * 0.5
            : goalDistance < 20
              ? 0.58
              : 0.38) + awareness.markWeightAdjustment,
          0.3,
          dangerZone ? 0.86 : 0.66
        );
        const target = this._defensiveSupportTarget(
          zoneX * (1 - markWeight) + markX * markWeight,
          zoneY * (1 - markWeight) + markY * markWeight,
          ownGoalY,
          // 盯人是贴住自己的人，不是站在离球固定距离的地方：禁区内若仍被推到
          // 离球 2.8 米，被盯者一旦靠近球，盯人就自动松开。
          // 危险区按防守意识分级：意识顶级的能贴到约 1.1 米（门前真实贴防的
          // 量级），意识差的只能到 2.1 米左右。一刀切会把弱队后卫也变成顶级
          // 中卫，实测强队场均积分从 1.5+ 掉到 1.38——盯得住人本来就是能力差异
          // 最直接的体现，这里必须跟属性走（与上面 markDistance 同一原则）。
          dangerZone
            ? clamp(2.1 - (awareness.awareness - 0.5) * 2.0, 1.1, 2.1)
            : goalDistance < 20
              ? 1.9
              : 3.7,
          mark.x <= b.x ? -1 : 1
        );
        a.tx = target.x;
        a.ty = target.y;
        a.fsm = "mark";
        this._applyExplicitShapeAnchor(a, phase, 0.1);
        return;
      }
    }

    // 中场拦截：不再干站着，主动封堵推进/拦截传球线。
    // 这是把"三区进入波次"从 ~650 压到真实 ~50 的核心——大部分进攻在中场
    // 就被断掉、逼回，而不是轻松穿过。只有离球较近的中前场人参与，避免防线散架。
    if (job.type === "intercept") {
      const dBall = pitchDistanceBetween(a.x, a.y, b.x, b.y);
      // 只有在中前场、且离球不太远时才主动上抢拦截（后场交给防线站位）
      const midField = a.role !== "DEF";
      if (midField && dBall < 22) {
        // 分居持球人前方两侧封线，保持支援距离；只有 press 职责贴身下脚。
        const dir = this.attackDir(owner?.team || b.kickTeam); // 进攻方推进方向
        const order = Number(job.order) || 0;
        const side = Number(job.side) || ((a.baseX ?? a.x) <= b.x ? -1 : 1);
        const offset = pitchOffsetMetres(
          side * (3.4 + order * 0.8),
          dir * (4 + order * 0.8)
        );
        a.tx = clamp(b.x + offset.x, 3, 97);
        a.ty = clamp(b.y + offset.y, 3, 97);
        a.fsm = "cover";
        this._applyExplicitShapeAnchor(a, phase, 0.12);
        return;
      }
    }

    if (job.type === "wide-cover") {
      const side = Number(job.side) || (b.x < 50 ? -1 : 1);
      const goalDirection = ownGoalY > 50 ? 1 : -1;
      const coverOffset = pitchOffsetMetres(
        -side * coordination.flankCoverInsideMetres,
        goalDirection * 4.6
      );
      const lineY = this._defLineY(a);
      const target = this._defensiveSupportTarget(
        b.x + coverOffset.x,
        lineY * 0.58 + (b.y + coverOffset.y) * 0.42,
        ownGoalY,
        4.1,
        -side
      );
      a.tx = target.x;
      a.ty = target.y;
      a.fsm = "cover";
      this._applyExplicitShapeAnchor(a, phase, 0.18);
      return;
    }

    if (job.type === "recover") {
      const goalDirection = ownGoalY > 50 ? 1 : -1;
      const recovery = pitchOffsetMetres(0, goalDirection * coordination.recoveryDepthMetres);
      const target = this._defensiveSupportTarget(
        weakSideTargetX({ baseX: a.baseX, ballX: b.x, profile: coordination }),
        clamp(this._defLineY(a) + recovery.y, 5, 95),
        ownGoalY,
        4.3,
        (a.baseX ?? a.x) <= b.x ? -1 : 1
      );
      a.tx = target.x;
      a.ty = target.y;
      a.fsm = "recover";
      this._applyExplicitShapeAnchor(a, phase, phase === TEAM_SHAPE_PHASES.DEFENSIVE_TRANSITION ? 0.18 : 0.28);
      return;
    }

    // 其余：回到防线 Y；横向随球压缩，且球逼近己方球门时向中路收缩。
    // 只锚 baseX 会让边后卫在禁区外沿两侧拉成横排、中路空虚——
    // 真实防守是"球进危险区，全队向球门前中路收拢成人墙"。
    const lineY = this._defLineY(a);
    const dBallGoal = Math.abs(b.y - ownGoalY) * (SIM.PITCH_H_METRES / SIM.FIELD_H);
    // 收缩强度：球离己方球门越近，越向中路(x=50)与球的 x 收拢（0.3→0.75）
    const central = clamp(1 - dBallGoal / 47, 0, 1); // 0=远 1=贴门
    const toward = 0.28 + central * 0.34;
    // 横向目标：baseX 与「球门中路和球位的混合」按 toward 插值
    const anchorX = (50 * 0.55 + b.x * 0.45);
    const transitionProgress = phase === TEAM_SHAPE_PHASES.DEFENSIVE_TRANSITION
      ? 0.4 + 0.6 * clamp(
          (this.t - (this._teamLoseAt[a.team] || 0)) /
            Math.max(0.1, shapeProfile.transition.defendSeconds),
          0,
          1
        )
      : 1;
    const widthMul = 1 + (shapeProfile.outOfPossession.widthMul - 1) * transitionProgress;
    const weakSideBaseX = weakSideTargetX({ baseX: a.baseX, ballX: b.x, profile: coordination });
    const shapeBaseX = 50 + (weakSideBaseX - 50) * widthMul;
    const shape = this._defensiveSupportTarget(
      shapeBaseX + (anchorX - shapeBaseX) * toward,
      lineY,
      ownGoalY,
      dBallGoal < 19 ? 3.05 : 4.05,
      (a.baseX ?? a.x) <= b.x ? -1 : 1
    );
    a.tx = clamp(shape.x, 4, 96);
    a.ty = shape.y;
    a.fsm = "cover";
    this._applyExplicitShapeAnchor(a, phase, phase === TEAM_SHAPE_PHASES.DEFENSIVE_TRANSITION ? 0.24 : 0.4);
  }

  /** 本队按"离球距离"给该 agent 的排名（0=最近外场人），用于分派上抢/补位 */
  _defBallRank(a) {
    if (a.role === "GK") return 99;
    const dMe = pitchDistanceBetween(a.x, a.y, this.ball.x, this.ball.y);
    let rank = 0;
    for (const o of this.agents) {
      if (o === a || o.team !== a.team || o.role === "GK") continue;
      const d = pitchDistanceBetween(o.x, o.y, this.ball.x, this.ball.y);
      if (d < dMe || (d === dMe && o.id < a.id)) rank++;
    }
    return rank;
  }

  /** 对方阵中"最危险的接球点"：离我方球门最近的无球外场进攻者 */
  _mostDangerousReceiver(attTeam) {
    const ownGoalY = this.targetGoalY(attTeam);
    let best = null;
    let bestD = Infinity;
    for (const o of this.agents) {
      if (o.team !== attTeam || o.role === "GK") continue;
      // 已离场的人还留着原来的 y（`:1692` 只改 x），旧实现没排除他，于是红牌之后
      // 「最危险接球点」可能选中一个站在场外的人，盯人者去跟他 —— 而这个人同时
      // 会吃掉 `screen` 职责与压迫者的 `shadowId`，还被 `occupiedTargets` 从盯人池里
      // 摘掉，等于三重浪费。`_defensiveThreats` 本来就滤了 `sentOff`，这里漏了。
      if (o.sentOff || o.injuredOff) continue;
      if (this.ball.owner === o.id) continue; // 跳过持球人
      // 旧实现只看 `|o.y - ownGoalY|`：**没有 x 项**，所以站在底线边上的边锋
      // 会排在点球点上的中锋前面；而且两名进攻者在 y 上交叉时身份就翻转，
      // 与横向距离无关 —— 每 0.48~1.36s 一次的重算于是不停换人。按米算真实距离。
      const d = pitchDistanceToGoalMetres(o.x, o.y, ownGoalY);
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
      // clamp 必须比拾球半径更贴边（1..99）：球停在底线死角时
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
    this._applyExplicitShapeAnchor(
      a,
      this._teamShapePhase(a.team),
      0.18
    );
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
    const ownGoalY = this.ownGoalY(a.team);
    const sign = this.attackDir(a.team); // 朝场内为正推进方向的反向
    // 距己方球门的层次：DEF 最靠后，ATT 最靠前
    const lineLevel = this._tacticLevel(a.team, "defensiveLine");
    const linePush =
      (lineLevel - 3) * (a.role === "DEF" ? 3.8 : a.role === "MID" ? 2.8 : 1.8);
    // 角色「前插/回收」倾向极小幅修正本层防线：克制到约 1 码内，
    // 让明确指派进攻/防守职责时才可感知，默认角色基本不偏离 v208 基线。
    const roleDepth = this._roleBehavior(a, "depth") * (a.role === "DEF" ? 3.5 : a.role === "MID" ? 2 : 0);
    const layer = (a.role === "DEF" ? 20 : a.role === "MID" ? 38 : 55) + linePush + roleDepth;
    // 球到己方球门的距离（0=贴门，越大越远）
    const dBallGoal = this._ballDistanceToOwnGoal(a.team, b);
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
    // ⚠ 2026-09-22 修：原来用 `attTeam === "home"` 判断「哪边更靠前」——
    //   那是把「主队朝 y=0 攻」写死了。下半场换边后方向反转，这条线会取到
    //   **反方向**那两个人（实测 swap 下 home 得 23，应为 87）。
    //   改由 `attackDir` 派生；比较的运算顺序保持原样（不换成「纵深」换算，
    //   避免浮点往返差异破坏 `endsSwapped=false` 的逐位等价 —— 见 AGENTS.md ⑦）。
    const dir = this.attackDir(attTeam);
    let first = dir < 0 ? Infinity : -Infinity;
    let second = first;
    let count = 0;
    for (const defender of this.agents) {
      if (defender.team !== defTeam) continue;
      count++;
      const y = defender.y;
      const ahead = dir < 0 ? y < first : y > first;
      const secondAhead = dir < 0 ? y < second : y > second;
      if (ahead) {
        second = first;
        first = y;
      } else if (secondAhead) {
        second = y;
      }
    }
    return count >= 2 ? second : null;
  }

  /** 记录涌现事件（P5 由适配层翻译成现有 event 结构） */
  _emit(type, a, extra = {}) {
    this.events.push({
      // 物理子步期间，事件描述的是「这一步跑完之后」的几何，而 `this.t` 还停在步首
      // （见 `_stepOnce` 的子步循环）。差一个 SIM.DT = 0.1s，而球一帧走 4~6 米，
      // 于是解说会在球进网/门将碰球**之前**就发出来，画面随后还被
      // `holdSimTimeline` 冻住 380ms——用户看到的就是「先播报，停顿一下才进球」。
      // 这里只把**事件时间戳**推到子步之后，`this.t` 本身一动不动：
      // 所有冷却、决策节流、settleUntil 都读 `this.t`，改它会改行为，
      // 而事件时间戳没有任何玩法逻辑读取（`directResult` 是半场跑完后的纯后处理）。
      t: this.t + (this._emitTimeOffset || 0),
      type,
      team: a?.team,
      agentId: a?.id,
      x: a?.x,
      y: a?.y,
      // 记下这条事件发生在**哪个半场**：`endsSwapped` 会翻 y，下游（赛后分析的
      // xG / 热区归一化）需要它才能还原「这次进攻朝哪个门」，否则下半场会按
      // 错误的端算距离与角度。缺省 false ⇒ 与旧行为一致。
      endsSwapped: !!this.endsSwapped,
      ...extra,
    });
  }

  _emitVarReview({ incident, onFieldDecision, team, agent = null, evidence = {} }) {
    const review = varReviewDecision({ incident, onFieldDecision, evidence });
    if (!review.reviewable) return review;
    const reviewId = `var_${++this._varReviewSeq}`;
    const common = {
      team,
      reviewId,
      incident,
      onFieldDecision,
      evidence,
    };
    this._lastVarReview = {
      reviewId,
      incident,
      team,
      decision: review.decision,
      finalDecision: review.finalDecision,
      reason: review.reason,
      at: this.t,
    };
    this._emit("var_review", agent, common);
    this._emit("var_decision", agent, {
      ...common,
      decision: review.decision,
      finalDecision: review.finalDecision,
      reason: review.reason,
    });
    return review;
  }

  _inOwnFoulBox(team, x, y) {
    return (
      x > 22 &&
      x < 78 &&
      // 己方禁区：距己方门 16 格以内（home 不换边时即 y >= 84）。
      this._onOwnSide(y, team, 16)
    );
  }

  _penaltyBoundaryDistance(team, x, y, inside = this._inOwnFoulBox(team, x, y)) {
    // 禁区线的绝对 y（距己方门 16 格）。
    const boxLineY = this._ownGoalSideY(team, 16);
    // 朝**己方门**方向的 y 增量符号（原式 `y - boxLineY` 在 home 下随 y 增大
    // 而增大，即 y 越靠门值越大 ⇒ 正方向指向己方门 ⇒ 与进攻方向反号）。
    const toOwnGoal = -this._sign(team);
    if (inside) {
      // 禁区内：到最近边界（两侧边线 / 到门线）的距离。
      const vertical = (y - boxLineY) * toOwnGoal;
      return Math.max(0, Math.min(x - 22, 78 - x, vertical));
    }
    const dx = x < 22 ? 22 - x : x > 78 ? x - 78 : 0;
    const dy = Math.max(0, (boxLineY - y) * toOwnGoal);
    return Math.hypot(dx, dy);
  }

  _onFieldPenaltyDecision(team, x, y, offenceType, evidence = {}) {
    const exactInPenaltyArea = this._inOwnFoulBox(team, x, y);
    const boundaryDistance = this._penaltyBoundaryDistance(team, x, y, exactInPenaltyArea);
    const perception = penaltyOnFieldDecision({
      exactInPenaltyArea,
      boundaryDistance,
      offenceType,
      bodyExposure: evidence.bodyExposure,
      roll: exactInPenaltyArea || boundaryDistance <= 1.4 ? this.random() : 1,
    });
    return { ...perception, exactInPenaltyArea, boundaryDistance };
  }

  _tryHandball(agent, { intendedReceive = false, isCross = false, isShot = false } = {}) {
    const b = this.ball;
    if (!agent || agent.role === "GK" || agent.sentOff) return false;
    const checked = b._handballChecked instanceof Set ? b._handballChecked : new Set();
    b._handballChecked = checked;
    if (checked.has(agent.id)) return false;
    const incomingHeading = Math.atan2(-(b.vy || 0), -(b.vx || 0));
    const exposure = 1 - Math.abs(Math.cos(angleDelta(agent.heading || 0, incomingHeading)));
    const inPenaltyArea = this._inOwnFoulBox(agent.team, b.x, b.y);
    const decision = handballContactDecision({
      ballHeight: b.z || 0,
      ballSpeedMps: pitchSpeedMps(b.vx || 0, b.vy || 0),
      bodyExposure: exposure,
      decisions: agent.attr.decisions,
      intendedReceive,
      isCross,
      isShot,
      inPenaltyArea,
      roll: this.random(),
    });
    if (!decision.eligible) return false;
    checked.add(agent.id);
    if (!decision.handball) return false;
    return this._commitHandball(agent, {
      reason: decision.reason,
      risk: decision.risk,
      ballHeight: b.z || 0,
      ballSpeedMps: pitchSpeedMps(b.vx || 0, b.vy || 0),
      bodyExposure: exposure,
      intendedReceive,
      isCross,
      isShot,
      inPenaltyArea,
    });
  }

  _commitHandball(player, evidence) {
    const b = this.ball;
    const restartTeam = player.team === "home" ? "away" : "home";
    const penalty = !!evidence.inPenaltyArea;
    const x = clamp(b.x, 4, 96);
    const y = clamp(b.y, 4, 96);
    this._emit("handball", player, {
      penalty,
      x,
      y,
      evidence,
    });
    // 纪律、统计和点球适配继续读取统一 foul 事件；handball 是可见的成因事实。
    this._emit("foul", player, {
      from: b.lastKicker || null,
      card: "none",
      penalty,
      handball: true,
      x,
      y,
      evidence,
    });
    const perception = this._onFieldPenaltyDecision(
      player.team,
      x,
      y,
      "handball",
      evidence
    );
    if (penalty || perception.onFieldDecision === "penalty") {
      const review = this._emitVarReview({
        incident: VAR_INCIDENTS.PENALTY,
        onFieldDecision: perception.onFieldDecision,
        team: restartTeam,
        agent: player,
        evidence: {
          inPenaltyArea: true,
          offenceType: "handball",
          x,
          y,
          source: evidence,
          boundaryDistance: perception.boundaryDistance,
          onFieldReason: perception.reason,
        },
      });
      if (review.finalDecision === "penalty") this._penaltyKick(restartTeam);
      else this._restart("freekick", restartTeam, x, y);
    } else {
      this._restart("freekick", restartTeam, x, y);
    }
    return true;
  }

  /**
   * 球员身体近距离非穿透约束（Gauss-Seidel 投影）。
   * 每人按自身机动权重分担修正量，门将权重极低因此几乎不被推离球门。
   * 根治「小禁区十余个圆点糊成一团」与前锋和门将占据同一坐标。
   *
   * ⚠ 距离是 `Math.hypot(dx, dy)` 对**格数**取模，所以这条下限在真实空间里是个
   *   椭圆（横向 1.94m、纵向 2.99m）。看起来像混单位，**实测证明两条半轴都是载荷，
   *   压成各向同性会破护栏**——完整证据与两组实测见
   *   `SIM.SEPARATION_MIN_DISTANCE_UNITS` 的注释。动它之前先读那一段。
   */
  _separateAgents(iterations = 1, dt = null, epoch = null) {
    const n = this.agents.length;
    const minD = this.separationMinDistanceUnits;
    const maxPasses = Math.max(1, iterations);
    const separationEpoch = Number.isFinite(epoch)
      ? epoch
      : (this._motionStepEpoch = (this._motionStepEpoch || 0) + 1);
    const correctionLimitMetres = Number.isFinite(dt)
      ? 3.2 * clamp(dt, SIM.DT, 0.5)
      : Infinity;
    for (let pass = 0; pass < maxPasses; pass++) {
      let resolved = true;
      for (let i = 0; i < n; i++) {
        const a = this.agents[i];
        if (a.sentOff) continue;
        for (let j = i + 1; j < n; j++) {
          const b = this.agents[j];
          if (b.sentOff) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          // 后台无画面档先做保守轴向排除；直播标准档保持原始逐对距离路径，
          // 因而不会改变已经发布的标准精度固定种子结果。
          if (
            this.simulationProfile === "background" &&
            (Math.abs(dx) >= 3.35 || Math.abs(dy) >= 3.35)
          ) {
            continue;
          }
          let d = Math.hypot(dx, dy);
          // 完全同坐标也要给稳定法向，否则两个圆点会永久粘住。
          if (d < 1e-6) {
            const angle = ((i * 11 + j * 7) % 16) * (Math.PI / 8);
            dx = Math.cos(angle) * 0.001;
            dy = Math.sin(angle) * 0.001;
            d = 0.001;
          }
          // 禁区内曾被强制拉得比禁区外更开（3.35 vs 2.85 场地单位，沿球门方向
          // 合 3.52 米），动机是让 2D 画面里小禁区的圆点不糊成一团。代价是后卫在
          // 禁区里物理上无法贴身：战术目标本身只要求离球 3.05 米，而这条几何下限
          // 是 3.52 米，两者取大，贴身防守被求解器直接顶开。身体半径不会因为球
          // 进了禁区就变大，这里统一用同一个下限；圆点是否重叠是渲染层的事。
          const need = minD;
          if (d >= need) continue;
          resolved = false;
          a.separationContactEpoch = separationEpoch;
          b.separationContactEpoch = separationEpoch;
          // 一次投影就补足整段重叠：留下残差会让多人堆叠始终收敛不到最小间距。
          const push = need - d;
          const ux = dx / d;
          const uy = dy / d;
          // 权重表示"愿意被推动的程度"，门将守在门线上因此接近不动。
          // 每人分担的比例是自身权重占总权重的份额。
          const aw = a.role === "GK" ? 0.08 : 1;
          const bw = b.role === "GK" ? 0.08 : 1;
          const den = aw + bw || 1;
          const aShare = aw / den;
          const bShare = bw / den;
          applyBoundedSeparationCorrection(
            a,
            clamp(a.x - ux * push * aShare, 2, 98),
            clamp(a.y - uy * push * aShare, 2, 98),
            correctionLimitMetres,
            separationEpoch
          );
          applyBoundedSeparationCorrection(
            b,
            clamp(b.x + ux * push * bShare, 2, 98),
            clamp(b.y + uy * push * bShare, 2, 98),
            correctionLimitMetres,
            separationEpoch
          );

          // 去掉相向速度的法向分量，防止下一步立刻再次穿回彼此身体。
          const closing = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
          if (closing < 0) {
            const impulse = -closing;
            a.vx -= ux * impulse * aShare;
            a.vy -= uy * impulse * aShare;
            b.vx += ux * impulse * bShare;
            b.vy += uy * impulse * bShare;
          }
        }
      }
      // 常态下阵型本就分散，首轮即无重叠可直接退出；
      // 只有禁区混战这类真正拥堵的帧才会用满迭代预算。
      if (resolved) break;
    }
  }

  /** 惯性移动：arrive + 加速度上限（与 matchview 表演层同源，保证观感一致） */
  _integrate(a, dt) {
    const arrivalAt = Number.isFinite(a._cornerArrivalAt) ? a._cornerArrivalAt :
      this.ball.receiverId === a.id && this.ball.kickTeam === a.team ? this.ball.expectedAt : null;
    if (!Number.isFinite(arrivalAt) || this.ball.owner || this.ball.state !== "pass") {
      return this._integrateMotion(a, dt);
    }
    // 接球与角球争顶按同一到球时序收敛，不提前停在普通 arrive 的减速圈内。
    // 跑动仍由同一运动积分器限制速度、加速度、转向与体能。
    const tx = a.tx;
    const ty = a.ty;
    const steps = Math.max(1, Math.ceil(dt / SIM.DT - 1e-9));
    const stepDt = dt / steps;
    for (let step = 0; step < steps; step++) {
      const dx = tx - a.x;
      const dy = ty - a.y;
      const gap = Math.hypot(dx, dy);
      if (gap > 0.05) {
        const speed = playerRunSpeed(a);
        const accel = playerAcceleration(a, speed);
        const along = Math.max(0, ((a.vx || 0) * dx + (a.vy || 0) * dy) / gap);
        const time = Math.max(stepDt, arrivalAt - this.t - step * stepDt -
          Math.max(0, speed - along) / (2 * accel));
        const lookAhead = Math.max(gap, Math.min(5, gap / time / speed * 5));
        a.tx = a.x + dx / gap * lookAhead;
        a.ty = a.y + dy / gap * lookAhead;
      } else {
        a.tx = tx;
        a.ty = ty;
      }
      this._integrateMotion(a, stepDt);
    }
    a.tx = tx;
    a.ty = ty;
  }

  _integrateMotion(a, dt) {
    let speed = playerRunSpeed(a);
    const pressing = this._stepPressing[a.team] || 3;
    if (a.fsm === "press") speed *= 0.94 + pressing * 0.025;
    // 卡位减速（P2）：持球人被对手贴身时带球变慢，防守才真能"挡住"推进。
    // strength/dribbling 高者受影响小（护得住球）。
    if (this.ball.owner === a.id) {
      let pressers = 0;
      for (const o of this.agents) {
        if (o.team === a.team) continue;
        if (o.role === "GK" && !this._goalkeeperCanPressure(o, a)) continue;
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
    const movementHeading = d > 0.05 ? Math.atan2(dy, dx) : a.heading;
    const movementTurn = Math.abs(angleDelta(a.heading, movementHeading));
    const turnCost = 1 - (movementTurn / Math.PI) * (0.16 - (a.attr.agility || 0.55) * 0.08);
    if (d < 0.05) {
      a.vx *= 0.5;
      a.vy *= 0.5;
    } else {
      const slowR = 5;
      const desired = speed * Math.min(1, d / slowR) * clamp(turnCost, 0.82, 1);
      const dvx = (dx / d) * desired - a.vx;
      const dvy = (dy / d) * desired - a.vy;
      const accel = playerAcceleration(a, speed);
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
    const prevX = a.x;
    const prevY = a.y;
    a.x = clamp(a.x + a.vx * dt, 1, 99);
    a.y = clamp(a.y + a.vy * dt, 1, 99);
    // ── 本场累计跑动距离（米）──────────────────────────────────────────
    // 为什么需要它：真实足球里球员体能消耗的差异**主要来自跑动距离**
    // （中场 ~10km / 中卫 ~9km / 门将 ~3km，实测队内 max/min 比值 3.889×，
    //  48 场标定，比赛级 SD 0.287），而下面的耗能公式只区分 press/carry
    // 三个**瞬时**状态、`pressing` 是**球队级**、`stamina` 又被 `norm()` 压到
    // 1.064× ⇒ 队内个体 spread 只有 0.39（总耗 4.84），个体差异被抹平。
    //
    // 这里累加的是**引擎每帧本来就有的真实位移**，不是新造的隐藏指标；
    // 它**不参与任何物理或决策**，只被 `match.js` 的体能结算读取。
    // 换算与 `pitchDistanceMetres` 完全一致（内部 100×100 ↔ 球场 68m × 105m）。
    a.runMetres = (a.runMetres || 0) + pitchDistanceMetres(a.x - prevX, a.y - prevY);
    // 引擎内体能只影响本场运动；正式球员体能记账仍由 match.js 负责。
    const workRate = a.fsm === "press" ? 1.35 : a.fsm === "carry" ? 1.12 : 1;
    const drain =
      dt *
      (0.0014 + pressing * 0.00018) *
      workRate *
      (1.18 - (a.attr.stamina || 0.5) * 0.35);
    a.fitness = Math.max(30, (a.fitness ?? 100) - drain);
    const vmag = Math.hypot(a.vx, a.vy);
    const turningInPlace = this.ball.owner === a.id &&
      Number.isFinite(a.bodyTargetHeading) &&
      (a.pendingBallAction || a.controlPhase === "first-touch");
    if (vmag > 0.6 || turningInPlace) {
      const velocityHeading = vmag > 0.01 ? Math.atan2(a.vy, a.vx) : a.heading;
      const target = this.ball.owner === a.id && Number.isFinite(a.bodyTargetHeading)
        ? a.bodyTargetHeading
        : velocityHeading;
      const turnRate = 4.8 + (a.attr.agility || 0.55) * 4.8;
      a.heading = moveAngleToward(a.heading, target, turnRate * dt);
    }
  }

  /** 球物理：被持球时跟随 owner 脚下；自由时地面滚动 + 摩擦 */
  _stepBall(dt) {
    const b = this.ball;
    if (b.owner) {
      const o = this.agentById(b.owner);
      if (o) {
        if (b.state === "control" && b.controlOwnerId === o.id) {
          const controlStartAt = Number.isFinite(b.controlStartAt) ? b.controlStartAt : this.t;
          const controlUntil = Number.isFinite(b.controlUntil) ? b.controlUntil : this.t;
          const progress = clamp(
            (this.t - controlStartAt) / Math.max(0.01, controlUntil - controlStartAt),
            0,
            1
          );
          const eased = progress * progress * (3 - 2 * progress);
          const targetX = o.x + (b.controlOffsetX || 0);
          const targetY = o.y + (b.controlOffsetY || 0);
          const nextX = b.controlStartX + (targetX - b.controlStartX) * eased;
          const nextY = b.controlStartY + (targetY - b.controlStartY) * eased;
          b.vx = (nextX - b.x) / Math.max(0.01, dt);
          b.vy = (nextY - b.y) / Math.max(0.01, dt);
          b.x = clamp(nextX, 1, 99);
          b.y = clamp(nextY, 1, 99);
          b.z = Math.max(0, (b.controlStartZ || 0) * (1 - eased));
          b.vz = 0;
          if (progress >= 1 - 1e-9) {
            b.state = "held";
            b.z = 0;
            b.vz = 0;
            o.controlPhase = "settled";
            o.controlUntil = this.t;
            delete b.controlOwnerId;
            delete b.controlKind;
            delete b.controlStartAt;
            delete b.controlUntil;
            delete b.controlStartX;
            delete b.controlStartY;
            delete b.controlStartZ;
            delete b.controlOffsetX;
            delete b.controlOffsetY;
            delete b.controlFoot;
          }
          return;
        }
        // 球黏在持球者惯用脚一侧的身前，护球时身体朝向会改变这条接触线。
        const heading = Number.isFinite(o.heading) ? o.heading : 0;
        const foot = o.controlFoot === "left" ? -1 : 1;
        const rightX = -Math.sin(heading);
        const rightY = Math.cos(heading);
        b.x = clamp(o.x + Math.cos(heading) * 1.4 + rightX * 0.24 * foot, 1, 99);
        b.y = clamp(o.y + Math.sin(heading) * 1.4 + rightY * 0.24 * foot, 1, 99);
        b.vx = o.vx;
        b.vy = o.vy;
        b.z = 0;
        b.vz = 0;
        return;
      }
      b.owner = null;
    }
    // 保存本帧起点，越过球门线时用它插值出准确的过线横向坐标与高度。
    b._prevX = b.x;
    b._prevY = b.y;
    b._prevZ = b.z || 0;
    b._prevVz = b.vz || 0;
    b._stepDt = dt;
    // 传球物理固定以 0.1s 子步推进。后台档的球员决策仍是 0.3s，但球不能
    // 先滑完整个粗步长再一次性吃掉三步摩擦，否则同一脚球会因 profile 变快。
    if (b.state === "pass") {
      let remaining = dt;
      while (remaining > 1e-9) {
        const stepDt = Math.min(SIM.DT, remaining);
        b.x += b.vx * stepDt;
        b.y += b.vy * stepDt;
        applyFreeBallForces(b, stepDt);
        remaining -= stepDt;
      }
    } else {
      // 自由球：滚动 + 摩擦（不夹 x/y，出界由 _resolveBounds 判定）
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // Shots share the ballistic height used by launch aiming and goal-line checks.
      applyFreeBallForces(b, dt);
    }
    if (Math.hypot(b.vx, b.vy) < 0.05 && b.z <= 0) {
      b.vx = 0;
      b.vy = 0;
      b.vz = 0;
      // 慢下来即回到普通自由球，可被任意接管
      if (b.state === "pass" || b.state === "shot") b.state = "loose";
    }
  }

  /**
   * 门将面对禁区内持球者的独立出击。普通抢断按球队节奏限频，门将救险不能
   * 等待 6.5 秒控球保护期；但仍必须真实移动到球旁，并由门将/持球者属性对抗。
   * 成功是收球而非射门扑救，不计入 saves；失败可能形成点球。
   */
  _tryGoalkeeperChallenge(owner) {
    if (!owner || owner.role === "GK" || this.ball.owner !== owner.id) return false;
    if (
      this.ball.state === "control" ||
      owner.controlPhase === "first-touch" ||
      owner.pendingBallAction
    ) return false;
    const defendingTeam = owner.team === "home" ? "away" : "home";
    const gk = this._teamGk(defendingTeam);
    const b = this.ball;
    if (
      !gk ||
      gk.sentOff ||
      !this._inOwnPenaltyArea(gk.team, b.x, b.y) ||
      this.t < (gk.challengeCdUntil || 0) ||
      (gk.challengeOwnerId === owner.id && this.t < (gk.challengeOwnerUntil || 0))
    ) {
      return false;
    }

    const dBall = pitchDistanceBetween(gk.x, gk.y, b.x, b.y);
    // Coarse positions can quantize both players onto the same side of the
    // contact boundary. Remove the maximum extra travel represented by the
    // larger sampling interval; standard 0.1s geometry is unchanged.
    const samplingReach = Math.max(0, this.timeStep - SIM.DT) * 2;
    const reach = Math.max(1.65, 2 + (gk.attr.reflexes || 0.5) * 0.4 - samplingReach);
    if (dBall > reach) return false;
    // 刚完成第一脚控制仍有很短的身体保护；门将已经贴到脚下则可直接封堵。
    if (this.t < (owner.protectUntil || 0) && dBall > 1.5) return false;

    gk.challengeCdUntil = this.t + 10.5;
    gk.challengeOwnerId = owner.id;
    gk.challengeOwnerUntil = this.t + 18;
    const claimSkill =
      (gk.attr.handling || 0.5) * 0.38 +
      (gk.attr.reflexes || 0.5) * 0.25 +
      (gk.attr.positioning || 0.5) * 0.22 +
      (gk.attr.strength || 0.5) * 0.15;
    const attackerControl =
      (owner.attr.dribbling || 0.5) * 0.52 +
      (owner.attr.strength || 0.5) * 0.25 +
      (owner.attr.decisions || 0.5) * 0.23;
    const close = clamp(1 - dBall / reach, 0, 1);
    const goalY = this.ownGoalY(gk.team);
    const goalSide =
      Math.abs(gk.y - goalY) <= Math.abs(owner.y - goalY) + 0.6 ? 1 : 0;
    const ownerSpeed = clamp(
      Math.hypot(owner.vx, owner.vy) / SIM.MAX_PLAYER_SPEED,
      0,
      1
    );
    const pClaim = clamp(
      (0.35 +
        (claimSkill - attackerControl) * 0.55 +
        close * 0.24 +
        goalSide * 0.1 -
        ownerSpeed * 0.08) *
        this._teamModifier(gk.team, "def"),
      0.14,
      0.82
    );

    gk.pose = "dive";
    gk.poseDir = b.x >= gk.x ? 1 : -1;
    gk.poseUntil = this.t + 0.58;
    gk.heading = Math.atan2(b.y - gk.y, b.x - gk.x);
    if (this.random() < pClaim) {
      b.owner = gk.id;
      b.x = gk.x;
      b.y = gk.y;
      b.vx = 0;
      b.vy = 0;
      b.z = 0;
      b.vz = 0;
      b.state = "held";
      this._clearBallTarget();
      b._saveChecked = false;
      b.settleUntil = this.t + 1.05;
      this.deadBallUntil = this.t + 0.75;
      gk.fsm = "home";
      gk.pose = "hold";
      gk.poseUntil = this.t + 0.75;
      gk.protectUntil = this.t + 1.8;
      gk.decisionUntil = this.t + 1.0;
      owner.noReclaimUntil = this.t + 1.0;
      owner.intent = null;
      this._emit("gk_claim", gk, {
        from: owner.id,
        challenge: true,
        claimProbability: pClaim,
      });
      return true;
    }

    // 没有抱稳不等于完全扑空。门将展开身体仍可能把球挡向侧前方，形成双方
    // 可争的二点球；这不是射门扑救，因此单独记录且不增加 saves。
    const blockSkill =
      (gk.attr.reflexes || 0.5) * 0.48 +
      (gk.attr.positioning || 0.5) * 0.32 +
      (gk.attr.strength || 0.5) * 0.2;
    const pBlock = clamp(
      0.48 +
        (blockSkill - attackerControl) * 0.4 +
        close * 0.12 +
        goalSide * 0.08 -
        ownerSpeed * 0.06,
      0.3,
      0.74
    );
    if (this.random() < pBlock) {
      // 解围方向：朝**场内**（对方半场）踢 ⇒ 与进攻方向同号。
      const fieldDir = this._sign(gk.team);
      const side = b.x >= 50 ? 1 : -1;
      b.owner = null;
      b.x = gk.x;
      b.y = gk.y;
      b.vx = side * (8 + this.random() * 6);
      b.vy = fieldDir * (5 + this.random() * 4);
      b.z = 0.15;
      b.vz = 1.5 + this.random() * 2;
      b.state = "loose";
      b.lastKicker = gk.id;
      b.kickTeam = gk.team;
      b.kickX = b.x;
      b.kickY = b.y;
      this._clearBallTarget();
      b.settleUntil = this.t + 0.3;
      this.deadBallUntil = this.t + 0.18;
      gk.protectUntil = this.t + 0.45;
      gk.challengeRecoverUntil = this.t + 0.55;
      gk.noReclaimUntil = this.t + 0.3;
      owner.noReclaimUntil = this.t + 0.7;
      owner.intent = null;
      // 门将封堵同样会把球弹开,过去也不发接触脉冲(matchview 没有 `gk_block` 的画法)。
      b._deflectPulse = { x: b.x, y: b.y, byId: gk.id, t: this.t + (this._emitTimeOffset || 0) };
      this._emit("gk_block", gk, {
        from: owner.id,
        challenge: true,
        blockProbability: pBlock,
      });
      return true;
    }

    this._emit("gk_challenge", gk, {
      from: owner.id,
      success: false,
      claimProbability: pClaim,
    });
    gk.challengeRecoverUntil = this.t + 0.65;
    return this._commitFoul(gk, owner, { goalkeeperChallenge: true });
  }

  /**
   * 接管/抢断判定：
   * - 有主时：邻近对手按 tackling 概率抢断
   * - 无主时：控球半径内最近球员按接管概率拿球（高速球更难接）
   * 门将扑救：必须朝己方球门飞 + 在可扑半径内 + 按射门难度掷一次骰。
   */
  _commitBackpassViolation(goalkeeper) {
    const b = this.ball;
    const passer = b.backpassFrom ? this.agentById(b.backpassFrom) : null;
    const restartTeam = goalkeeper.team === "home" ? "away" : "home";
    const x = clamp(b.x, 6, 94);
    // 站位限制在己方门前 6..18 格的带内（home 不换边时即 y ∈ [82, 94]）。
    const y = this._ownGoalSideYClamped(b.y, goalkeeper.team, 6, 18);
    this._emit("backpass", goalkeeper, {
      from: passer?.id || b.lastKicker || null,
      restart: EDGE_RESTART_TYPES.INDIRECT_FREE_KICK,
      x,
      y,
    });
    this._restart(EDGE_RESTART_TYPES.INDIRECT_FREE_KICK, restartTeam, x, y);
  }

  _resolvePossession(dt) {
    const b = this.ball;
    // Contact geometry uses metres; legacy probability calibration uses field units.
    const speed = Math.hypot(b.vx, b.vy);
    const speedMps = pitchSpeedMps(b.vx, b.vy);

    // —— 门将扑救（合理化）——
    // 轨迹线段判定 + 每脚只掷一次；空门/球已过身几乎不扑；成功后扑倒姿态。
    if (b.state === "shot" && !b.owner && !b._saveChecked) {
      for (const gk of this.agents) {
        if (gk.role !== "GK" || gk.sentOff || gk.injuredOff) continue;
        // This shot-contact model has no jumping save above the crossbar.
        if ((b.z || 0) > 2.44) continue;
        if (gk.id === b.lastKicker) continue;
        const goalY = this.ownGoalY(gk.team);
        // 球正朝己方球门飞（门将出击/接球的前提）
        // 球正朝己方球门飞（门将出击/接球的前提）。朝己方门 = vy 与原
        // 主客式的符号约定相反：home 攻 y↓（sign=-1）时要 vy>+1.2，
        // away 攻 y↑（sign=+1）时要 vy<-1.2 ⇒ 统一为 `sign * vy < -1.2`。
        const towardGoal = this._sign(gk.team) * b.vy < -1.2;
        if (!towardGoal) continue;
        // 只在球靠近己方禁区/门前时介入（球距己方门 < 32 格）。
        // 这里用「距门的绝对距离」而不是 `_onOwnSide`：原式是**严格**不等
        // （`b.y > 68` / `b.y < 32`），而 `_onOwnSide` 是闭区间，边界点会差。
        const nearBox = Math.abs(b.y - this.ownGoalY(gk.team)) < 32;
        if (!nearBox) continue;

        // Use the recorded start: friction has already changed the velocity.
        const x1 = b.x;
        const y1 = b.y;
        const x0 = Number.isFinite(b._prevX) ? b._prevX : b.x - b.vx * dt;
        const y0 = Number.isFinite(b._prevY) ? b._prevY : b.y - b.vy * dt;
        const segment = pitchVectorMetres(x1 - x0, y1 - y0);
        const offset = pitchVectorMetres(gk.x - x0, gk.y - y0);
        const segLen2 = segment.x ** 2 + segment.y ** 2 || 1e-6;
        let tt = (offset.x * segment.x + offset.y * segment.y) / segLen2;
        tt = clamp(tt, 0, 1);
        const cx = x0 + (x1 - x0) * tt;
        const cy = y0 + (y1 - y0) * tt;
        const dPath = pitchDistanceBetween(gk.x, gk.y, cx, cy);
        const lateral = Math.abs(gk.x - cx) * (SIM.PITCH_W_METRES / SIM.FIELD_W);

        const ref = gk.attr.reflexes || 0.5;
        const hand = gk.attr.handling || 0.5;
        // 可扑范围：必须球路擦过门将，不能站着吸远处的球
        const reach = 2.2 + 1.6 * ref + Math.min(0.8, speedMps * 0.016);
        if (dPath > reach) continue;

        // 球已越过门将朝球门线 → 无法回头捞（防「离谱反应」）。
        // 用纵深表达：纵深自**己方门线**起算（0=门线，100=对方门线），
        // 所以「越过门将、更靠近自己球门」= 球的纵深**更小**（不是更大）。
        const pastGk =
          this._depthFromOwnGoal(cy, gk.team) <
          this._depthFromOwnGoal(gk.y, gk.team) - 1.6;
        if (pastGk) continue;
        // 球已明显更靠近门线、门将还在外线 → 追不上
        const ballCloserToLine =
          gk.team === "home"
            ? Math.abs(cy - goalY) + 1.2 < Math.abs(gk.y - goalY)
            : Math.abs(cy - goalY) + 1.2 < Math.abs(gk.y - goalY);
        if (ballCloserToLine && lateral > 2.2) continue;

        b._saveChecked = true; // 本脚射门只判定一次

        const shotDistance = Number(b.shotDistance) || 18;
        const reactionTime = Number.isFinite(b.shotFlightTime)
          ? b.shotFlightTime
          : clamp(shotDistance / Math.max(1, speed), 0.18, 1.4);
        const reactionRead = clamp((reactionTime - 0.28) / 0.58, 0, 1);
        const cover = clamp(1 - dPath / reach, 0, 1);
        // 路线正确：门将对射正球应有稳定基础覆盖；空门/远侧再大幅降低。
        let pSave =
          0.29 +
          0.28 * cover +
          0.55 * ref +
          0.22 * hand -
          speed / 220 -
          lateral * 0.012 +
          (reactionRead - 0.45) * 0.32;
        pSave *= this._teamModifier(gk.team, "def");
        // 极近距离仍更难反应，但不再因为“球已靠近门线”把所有扑救率统一砍半。
        if (shotDistance < 8) pSave *= 0.82;
        else if (shotDistance < 12) pSave *= 0.92;
        // 空门：横向远离射门落点 / 标记 openGoal
        if (b._openGoalShot) pSave *= 0.18;
        if (lateral > 7.2) pSave *= 0.32;
        else if (lateral > 6.2) pSave *= 0.7;
        else if (lateral > 5.2) pSave *= 0.84;
        else if (lateral > 4.2) pSave *= 0.92;
        // 近距离强力抽射更难扑
        if (speed > 42 && dPath > reach * 0.45) pSave *= 0.7;
        // Keep the shared goalkeeper baseline aligned with observed on-target
        // conversion. Larger steps sweep a longer segment before this check and
        // therefore need a numerical correction; at dt=0.3 the combined factor
        // remains 0.65. Neither factor depends on team, score or presentation.
        const baseSaveCalibration = 0.94;
        const minimumStepCorrection = 0.65 / baseSaveCalibration;
        const stepCorrection = clamp(
          1 - Math.max(0, dt - SIM.DT) * 1.5425,
          minimumStepCorrection,
          1
        );
        pSave *= baseSaveCalibration * stepCorrection;
        pSave = clamp(pSave, 0.04, 0.93);

        // 扑救姿态：门将已在本步按连续速度向预测落点移动；这里不再额外改写
        // 坐标，否则一次结算会叠加一段不可见的瞬移。侧扑幅度由姿态动画表达。
        const diveDir = cx >= gk.x ? 1 : -1;
        gk.pose = "dive";
        gk.poseDir = diveDir;
        gk.poseUntil = this.t + 0.55;
        gk.heading = Math.atan2(cy - gk.y, cx - gk.x);

        if (this.random() < pSave) {
          // 可反应时间越长越容易抱稳；近距离扑救更多托出/击出。
          const holdP = 0.18 + 0.12 * hand + reactionRead * 0.16;
          const hold = this.random() < holdP;
          if (hold) {
            b.owner = gk.id;
            b.x = gk.x;
            b.y = gk.y;
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
            const side = diveDir || (this.random() < 0.5 ? 1 : -1);
            // 己方底线方向 = 朝自己守的那个门 ⇒ 与进攻方向**反号**。
            const bylineDir = -this._sign(gk.team);
            const tipOverP = clamp(0.8 + Math.max(0, dt - SIM.DT) * 0.4, 0.8, 0.95);
            const tipOver = this.random() < tipOverP;
            b.owner = null;
            b.x = cx;
            b.y = cy;
            b.vx = side * (tipOver ? 20 + this.random() * 8 : 10 + this.random() * 8);
            // tipOver：朝底线外送足够速度越线 → _resolveBounds 判角球给进攻方；
            // 否则朝场内边路托出，回到运动战。
            b.vy = tipOver
              ? bylineDir * (10 + this.random() * 6)
              : -bylineDir * (6 + this.random() * 5);
            // 托过横梁必须在过线时高于 2.44；否则门框内的托救会先被判成乌龙，
            // 永远走不到下方角球分支。
            b.z = tipOver ? 2.7 + this.random() * 0.5 : 0.6 + this.random() * 0.8;
            b.vz = tipOver ? 3 + this.random() * 2 : 4 + this.random() * 3;
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
        // 未扑住：球继续飞，仅轻微蹭偏（指尖擦到）。
        // 这里会改变球的飞行方向，但过去不发任何信号，表现层无从知晓，
        // 画面上就成了「球在无人接触的情况下自己拐弯」。
        // 记录带时间戳的接触点，供直播与压缩录像独立读取，
        // 让表现层能在擦球点画出接触标记。不改物理、不改判定概率。
        if (this.random() < 0.18) {
          b.vx += diveDir * (1.5 + this.random() * 2);
          b.vy *= 0.96;
          b._deflectPulse = { x: cx, y: cy, byId: gk.id, t: this.t + (this._emitTimeOffset || 0) };
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
      if ((b.z || 0) > 2.44) return;
      const checked = b._blockersChecked instanceof Set ? b._blockersChecked : new Set();
      b._blockersChecked = checked;
      for (const o of this.agents) {
        if (o.team === b.kickTeam || o.role === "GK" || o.sentOff || o.injuredOff || checked.has(o.id)) continue;
        const d = pitchDistanceBetween(o.x, o.y, b.x, b.y);
        if (d > shotBlockReachMetres(speedMps)) continue;
        if (this._tryHandball(o, { isShot: true })) return;
        checked.add(o.id);
        const blockSkill = 0.55 * o.attr.positioning + 0.45 * o.attr.tackling;
        const pBlock = clamp(
          (0.12 + blockSkill * 0.38 - speed / 240) * this._teamModifier(o.team, "def"),
          0.08,
          0.46
        );
        if (this.random() >= pBlock) continue;
        const side = o.x <= b.x ? 1 : -1;
        // 约半数封堵挡过自己的底线得角球；否则弹回场内。
        // 己方底线方向 = 朝自己守的那个门 ⇒ 与进攻方向**反号**。
        const bylineDir = -this._sign(o.team);
        const blockOutP = clamp(0.52 + Math.max(0, dt - SIM.DT) * 0.35, 0.52, 0.9);
        const blockOut = this.random() < blockOutP;
        b.vx = side * (6 + this.random() * 7) + b.vx * 0.12;
        b.vy = blockOut ? bylineDir * (9 + this.random() * 6) : b.vy * -0.12;
        // 明确挡过底线的球抬到横梁上方，避免门框范围内先误判成防守方乌龙。
        b.z = blockOut ? 2.65 + this.random() * 0.45 : Math.max(0.1, b.z || 0);
        b.vz = blockOut ? 3 + this.random() * 2 : 2 + this.random() * 3;
        b.state = "loose";
        if (blockOut) {
          b.lastKicker = o.id;
          b.kickTeam = o.team;
          b.kickX = b.x;
          b.kickY = b.y;
        }
        this._clearBallTarget();
        // 封堵会改变球的飞行方向，但过去只发 `block` 事件、不设接触脉冲，而
        // matchview 根本没有 `case "block"` —— 画面上就是球在无人接触处自己拐弯。
        // 与门将指尖擦球同一套做法：带时间戳的接触点，纯表现层信号，
        // 不改任何物理量。
        b._deflectPulse = { x: b.x, y: b.y, byId: o.id, t: this.t + (this._emitTimeOffset || 0) };
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
      const flown = b.kickX != null
        ? pitchDistanceBetween(b.x, b.y, b.kickX, b.kickY)
        : 999;
      const interceptTeam = b.kickTeam === "home" ? "away" : "home";
      // 传中球飞在头顶以上（z>2.2 ≈ 起跳争顶极限）时物理上够不着——
      // 不加这条，吊过人墙/人堆头顶的球会被"原地吃掉"，传中永远到不了禁区。
      const overhead = b.z > 2.2;
      if (
        flown >= 6 &&
        !overhead &&
        this.t >= (this._teamInterceptUntil[interceptTeam] || 0)
      ) { // 传球早段仍受保护（防贴脸截断/乒乓），飞出一段后才可拦
        for (const o of this.agents) {
          // sentOff：离场者（红牌/伤退走向边线途中）绝不能拦截，否则带球离场冻结比赛
          if (o.team === b.kickTeam || o.role === "GK" || o.sentOff) continue;
          if (this.t < (o.tackleCdUntil || 0)) continue;
          const d = pitchDistanceBetween(o.x, o.y, b.x, b.y);
          // 拦截半径：比脚下控球略大（伸脚/身体挡），越靠近越易成
          if (d < SIM.CONTROL_RADIUS_METRES + 2.4) {
            o.tackleCdUntil = this.t + 2;
            this._teamInterceptUntil[interceptTeam] = this.t + 75 + this.random() * 30;
            const pick = 0.45 * o.attr.tackling + 0.35 * o.attr.positioning + 0.2 * o.attr.pace;
            const p = clamp(
              (0.22 + pick * 0.45 - speedMps / 150) * this._teamModifier(o.team, "def"),
              0.08,
              0.68
            );
            if (this.random() < p) {
              this._beginBallControl(o, {
                kind: "intercept",
                protectSeconds: 0.7,
                settleSeconds: 0.45,
              });
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

      // 门将出击是禁区内的独立救险，不受普通球队抢断 6.5 秒组织窗口限制。
      // 只有门将真实移动到球旁才会触发，成功收球、失败则继续比赛或判罚。
      if (this._tryGoalkeeperChallenge(owner)) return;

      // 球队刚夺回球权后先获得一个可组织窗口；否则双方会在同一位置亚秒级互抢。
      const possessionAge = this.t - (this._teamAttackSince[owner.team] || 0);
      if (possessionAge < 6.5) return;

      const defendingTeam = owner.team === "home" ? "away" : "home";
      if (this.t < (this._teamTackleUntil[defendingTeam] || 0)) return;
      const tacklePlan = this._refreshDefPlan(defendingTeam, owner);
      for (const o of this.agents) {
        if (o.team === owner.team || o.role === "GK" || o.sentOff) continue;
        // 只有球队当前指定的上抢者可以下脚；其他人保持封线/盯人职责。
        if (tacklePlan?.jobs.get(o.id)?.type !== "press") continue;
        // 抢断尝试冷却：个人与全队都不能每 tick 掷骰子。
        if (this.t < (o.tackleCdUntil || 0)) continue;
        const d = pitchDistanceBetween(o.x, o.y, b.x, b.y);
        const divesIntoTackles = this._hasHabit(o, "dives_into_tackles");
        // 角色「下脚」倾向（抢球中场 / 压迫型前锋）扩大真实下脚范围并缩短个人冷却：
        // 只改变“更愿意主动抢”的尺度，不碰单次抢断成功率（成功率仍由属性结算）。
        const tackleAgg = Math.max(0, this._roleBehavior(o, "tackle"));
        if (d < SIM.CONTROL_RADIUS_METRES + (divesIntoTackles ? 0.8 : 0.55) + tackleAgg * 0.8) {
          o.tackleCdUntil = this.t + (divesIntoTackles ? 36 : 50) - tackleAgg * 14 + this.random() * 10;
          this._teamTackleUntil[defendingTeam] = this.t + 44 + this.random() * 10;
          this._emit("pressure", o, { onId: owner.id });
          // 抢断成功率：tackling vs 持球者 dribbling+strength（单次尝试，不再乘 tick）
          const atk = 0.5 * owner.attr.dribbling + 0.3 * owner.attr.strength;
          const def = 0.6 * o.attr.tackling + 0.2 * o.attr.marking;
          // 单次成功率保持克制；高速带球略容易丢球。
          const ownerSpeed = Math.hypot(owner.vx, owner.vy);
          const moveVuln = clamp(ownerSpeed / SIM.MAX_PLAYER_SPEED, 0, 1) * 0.1;
          const toDefenderX = o.x - owner.x;
          const toDefenderY = o.y - owner.y;
          const contactLength = Math.hypot(toDefenderX, toDefenderY) || 1;
          const awayHeading = Math.atan2(-toDefenderY, -toDefenderX);
          const shieldAlignment = clamp(
            Math.cos(angleDelta(owner.heading, awayHeading)),
            0,
            1
          );
          const relativeVelocity = pitchVectorMetres(o.vx - owner.vx, o.vy - owner.vy);
          const towardOwnerX = (owner.x - o.x) / contactLength;
          const towardOwnerY = (owner.y - o.y) / contactLength;
          const closingSpeedMps =
            relativeVelocity.x * towardOwnerX * (SIM.PITCH_W_METRES / SIM.FIELD_W) +
            relativeVelocity.y * towardOwnerY * (SIM.PITCH_H_METRES / SIM.FIELD_H);
          const momentumAdjustment = shieldingMomentumAdjustment({
            closingSpeedMps,
            shieldAlignment,
            balance: owner.attr.balance,
          });
          const possResistance = this._teamModifier(owner.team, "poss");
          const p = clamp(
            (0.22 + (def - atk) * 0.45 + moveVuln) *
              this._teamModifier(o.team, "def") *
              (1 + momentumAdjustment) /
              possResistance,
            0.06,
            0.52
          );
          if (this.random() < p) {
            this._beginBallControl(o, {
              kind: "tackle",
              protectSeconds: 1.6,
              settleSeconds: 1.4,
            });
            // 被抢者：设追抢冷却 + 轻微后撤，避免"贴身原地互抢"的乒乓循环。
            // 真实里丢球方会先失位、退一步再重新组织逼抢，不会瞬间贴脸抢回。
            owner.tackleCdUntil = this.t + 8;
            this._teamTackleUntil[owner.team] = this.t + 7;
            owner.protectUntil = 0;
            const bk = this.attackDir(owner.team); // 丢球者朝己方向后撤一点
            owner.tx = clamp(owner.x - bk * 4, 3, 97);
            owner.ty = clamp(owner.y + bk * 4, 3, 97);
            this._emit("tackle", o, { from: owner.id });
            return;
          } else {
            // 抢断失败 + 贴身接触：按 tackling 反比 + 战术凶狠度掷犯规。
            // 成立则判任意球/点球（禁区内），并按严重度掷黄/红，直接 return。
            if (this._commitFoul(o, owner, { aggressiveTackle: divesIntoTackles })) return;
          }
        }
      }
      return;
    }

    // —— 自由球接管 ——
    // 传球早段保护：球刚踢出、尚未飞离原点足够距离时，对手不能"贴脸截断"
    // （真实里无法在传球者脚下断球）。这是根治"传球乒乓"的关键——
    // 让球有机会飞到本方接球人，而不是被紧贴的对手零距离吃掉。
    const flownFromKick = b.kickX != null
      ? pitchDistanceBetween(b.x, b.y, b.kickX, b.kickY)
      : 999;
    const oppBlocked = b.state === "pass" && flownFromKick < 8; // 8 以内对手不可截

    // 注意：射门飞行中仍允许近距离争夺（原始行为，否则进球爆炸）；
    // 门将扑救已优先处理。禁区乒乓靠下方「小禁区优先门将」抑制。

    // 传中飞越头顶（z>2.2）时外场球员够不着：让球飞到落点再争，
    // 否则高弧线会被路径上的人在 2D 距离内"凭空控下"。门将手臂长（3.0）可摘高球。
    // 每一种自由球都遵守同一触达高度，不依赖“传中”标签。

    let best = null;
    let bestD = SIM.CONTROL_RADIUS_METRES + speedMps * 0.04;
    for (const a of this.agents) {
      // 已离场者（红牌/伤退）绝不能接管球：否则球会跟着他走出边线并永远 held
      if (a.sentOff) continue;
      // 越位的**非接球人**不去争这个飞行球：出脚瞬间已越位的队友碰球才会被判罚，
      // 真实里他知道自己越位、会主动让开，不会去截路过的传球（`peelB`，2026-09-05
      // 两窗口 12 场重测：越位 4.5→2.5，进球不破底，反把窗口B破底的 control 救回；
      // 见 AGENTS.md「越位老账」）。预定接球人 receiverId 不动——他仍会去接、随后在
      // 下方 5470 行由既有判罚照常吹越位。纯几何、不消费随机数、不改判罚路径。
      if (
        b.state === "pass" &&
        a.team === b.kickTeam &&
        a.id !== b.receiverId &&
        b.offsideIds instanceof Set &&
        b.offsideIds.has(a.id)
      ) {
        continue;
      }
      if (a.id === b.lastKicker && this.t < (a.noReclaimUntil || 0)) continue;
      if (oppBlocked && a.team !== b.kickTeam && ((b.z || 0) > 1.1 || pitchDistanceBetween(a.x, a.y, b.x, b.y) > 1.1)) continue;
      // 高弧线传中够不着就不能控（外场 2.2 / 门将 3.0）
      if (b.z > (a.role === "GK" ? 3.0 : 2.2)) continue;
      // 门将只能在本方禁区附近拿自由球（防中场门将"参与传球"）。
      // 原式严格不等（`b.y > 80` / `b.y < 20`），用「距己方门 < 20 格」
      // 保持严格语义（`_onOwnSide` 是闭区间，边界点会差）。
      if (a.role === "GK") {
        const inBox =
          Math.abs(b.y - this.ownGoalY(a.team)) < 20 && b.x > 18 && b.x < 82;
        if (!inBox) continue;
      }
      const d = pitchDistanceBetween(a.x, a.y, b.x, b.y);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }

    // 小禁区慢球：门将与对方前锋贴在一起时，优先归门将（防「门将与前锋传球」乒乓）
    if (best && best.role !== "GK" && speedMps < 8) {
      const nearGk = this.agents.find((g) => {
        if (g.role !== "GK" || g.team === best.team) return false;
        // 门区：严格不等（原式 `b.y > 86` / `b.y < 14`）⇒ 用绝对距离。
        const inSix =
          Math.abs(b.y - this.ownGoalY(g.team)) < 14 && b.x > 28 && b.x < 72;
        return inSix &&
          pitchDistanceBetween(g.x, g.y, b.x, b.y) < SIM.CONTROL_RADIUS_METRES + 2.2;
      });
      if (nearGk) best = nearGk;
    }

    // 门将刚踢/刚扑：小禁区内对方前锋不能立刻捡球「回传互动」
    if (best && best.role !== "GK") {
      const last = b.lastKicker ? this.agentById(b.lastKicker) : null;
      if (last?.role === "GK" && last.team !== best.team) {
        const flown = b.kickX != null
          ? pitchDistanceBetween(b.x, b.y, b.kickX, b.kickY)
          : 999;
        // 门区（6 码）：严格不等（原式 `b.y > 84` / `b.y < 16`），
        // 同样用绝对距离保持严格语义。
        const inSix =
          Math.abs(b.y - this.ownGoalY(last.team)) < 16 && b.x > 26 && b.x < 74;
        // 保护只在球仍在运动时有效：解围软弱球停在门区内时 flown 永远 <14，
        // 若继续禁止拾取会让对方站在死球旁边干瞪眼（无主球僵持来源之一）。
        if (inSix && flown < 14 && speedMps > 1) {
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
            : this.attackDir(b.kickTeam) < 0
              ? best.y < b.offsideLineY - 0.5
              : best.y > b.offsideLineY + 0.5;
        if (off) {
          this._callOffside(best);
          return;
        }
      }
      // 接管成功率：有明确接球目标的普通传球应大多被职业球员稳妥停下；
      // 传中、争顶和非预期松球仍显著更难，失误继续来自真实线路与压迫。
      const wasPass = b.state === "pass";
      const intendedReceive =
        wasPass && best.team === b.kickTeam && best.id === b.receiverId;
      let ctl;
      if (wasPass && b.isCrossPass) {
        const aerial = this._aerialAbility(best);
        ctl = intendedReceive
          ? 0.58 + 0.35 * aerial + 0.08 * (best.attr.decisions || 0.55)
          : 0.42 + 0.34 * aerial + 0.06 * (best.attr.positioning || 0.55);
      } else {
        ctl = intendedReceive
          ? 0.965 + 0.1 * best.attr.dribbling + 0.04 * (best.attr.decisions || 0.55)
          : 0.66 + 0.3 * best.attr.dribbling;
      }
      if (best.role === "GK") ctl = 0.75 + 0.22 * (best.attr.handling || 0.5);
      const speedScale = wasPass && b.isCrossPass ? (intendedReceive ? 180 : 135) : (intendedReceive ? 310 : 125);
      const p = clamp(ctl - speedMps / speedScale, 0.15, 0.99);
      if (this.random() < p) {
        if (
          this._tryHandball(best, {
            intendedReceive,
            isCross: !!b.isCrossPass,
            isShot: false,
          })
        ) {
          return;
        }
        if (
          best.role === "GK" &&
          b.backpassCandidate &&
          b.backpassTargetId === best.id
        ) {
          const passFrom = b.lastKicker;
          const intendedId = b.receiverId;
          const control = goalkeeperBackpassControl({
            pressure: this._pressureOn(best),
            decisions: best.attr.decisions,
            positioning: best.attr.positioning,
            roll: this.random(),
          });
          if (control.useHands) {
            this._commitBackpassViolation(best);
          } else {
            this._beginBallControl(best, {
              kind: "backpass-feet",
              passFrom,
              intendedId,
              emitReceive: true,
              protectSeconds: 0.85,
              settleSeconds: 0.5,
              goalkeeperFeet: true,
            });
            this._emit("gk_backpass_control", best, {
              from: passFrom,
              handlingRisk: control.handlingRisk,
            });
          }
          return;
        }
        const passFrom = b.lastKicker;
        const intendedId = b.receiverId;
        this._beginBallControl(best, {
          kind: wasPass ? "receive" : "loose-control",
          passFrom,
          intendedId,
          emitReceive: wasPass && best.team === b.kickTeam,
          protectSeconds: best.role === "GK" ? 1.7 : 0.7,
          settleSeconds: best.role === "GK" ? 1.05 : 0.45,
        });
      } else {
        // 没控住：按身体朝向和惯用脚把球磕开，避免瞬间绑定又瞬间丢失。
        this._miscontrolBall(best);
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
    this._agentIndex?.delete(outId);
    const wasCaptain = a.isCaptain;
    ensureFootballProfile(player);
    const attrs = player.attrs || {};
    a.id = player.id;
    this._agentIndex?.set(a.id, a);
    a.player = player;
    a.num = player.number ?? a.num;
    a.attr = normalizedAgentAttributes(attrs);
    a.heightCm = Number(player.heightCm) || 180;
    a.preferredFoot = player.preferredFoot || "right";
    a.habits = new Set(player.playingHabits || []);
    a.fitness = player.fitness ?? 100;
    // 换上的球员用**新球员的身体**，跑动距离必须从 0 重新累计
    // （否则他会继承被换下者的跑动距离 ⇒ 体能扣减分摊错人）。
    a.runMetres = 0;
    a.sentOff = false;
    a.injuredOff = false;
    a._yellows = 0;
    a.isCore = false;
    a.isCaptain = !wasCaptain && getCaptainId(a.club) === a.id;
    if (wasCaptain) {
      const candidates = this.agents
        .filter((x) => x.team === a.team && x !== a && !x.sentOff && !x.injuredOff)
        .sort(
          (x, y) =>
            (y.attr.decisions || 0) + (y.attr.positioning || 0) -
            ((x.attr.decisions || 0) + (x.attr.positioning || 0))
        );
      for (const teammate of this.agents) {
        if (teammate.team === a.team) teammate.isCaptain = false;
      }
      (candidates[0] || a).isCaptain = true;
    }
    // 从中线边缘进场，跑回基准位
    a.x = a.baseX < 50 ? 1 : 99;
    a.y = 50;
    a.tx = a.baseX;
    a.ty = a.baseY;
    a.vx = 0;
    a.vy = 0;
    a.intent = null;
    a.fsm = "home";
    a.controlFoot = a.preferredFoot === "left" ? "left" : "right";
    a.controlPhase = "settled";
    a.controlUntil = 0;
    // 面向进攻方向：朝 y 小 ⇒ atan2(负, 0) = -π/2，即 attackDir * π/2。
    a.bodyTargetHeading = this._sign(a.team) * (Math.PI / 2);
    a.pendingBallAction = null;
    a.actionPreparationActive = false;
    a.decisionUntil = this.t + 0.8;
    a.protectUntil = 0;
    a.tackleCdUntil = 0;
    // 主动突破原语（`opts.beatPrimitive`）的三个时间戳。默认关闭时不读不写。
    a.beatCdUntil = 0;
    a.beatActionUntil = 0;
    a.beatenUntil = 0;
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
    // 粗粒度无画面步长在低速护球时更容易连续落在同一 3m 采样窗内；
    // 给数值积分留出最多 4 秒容差，正常死锁仍会被看门狗清除。
    const stallLimit = 20 + clamp((this.timeStep - SIM.DT) * 40, 0, 4);
    if (this._stallT < stallLimit) return;
    this._stallT = 0;
    this._stallKey = null;
    const o = b.owner ? this.agentById(b.owner) : null;
    this._emit("stall_clear", o || null);
    if (o) {
      const dir = this.attackDir(o.team);
      const tx = clamp(o.x < 50 ? 62 + this.random() * 24 : 14 + this.random() * 24, 6, 94);
      const ty = clamp(o.y + dir * (28 + this.random() * 14), 6, 94);
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
    if (this.random() < p) this._commitInjury(worst, "fatigue");
  }

  /**
   * 犯规判定（P3）：抢断失败 + 贴身接触时调用。
   * - 犯规概率 = f(防守者 tackling 反比, 战术压迫凶狠度)
   * - 禁区内 → 点球；其余 → 任意球（判给被侵犯方）
   * - 严重度掷黄/红：累计第二黄 → 红；小概率直红
   * 成立返回 true（已重启死球或已开启有利观察窗），否则 false。
   * @param {object} defender 犯规的防守球员
   * @param {object} victim 被侵犯的持球者
   * @param {{goalkeeperChallenge?: boolean}|null} context 对抗情境
   */
  _rollFoulCard(defender, pressing, goalkeeperChallenge) {
    // 卡片严重度（相对犯规数的真实比例）：黄 ~15%，直红 ~0.3%。
    const roll = this.random();
    let card = "none";
    if (!goalkeeperChallenge && roll < 0.003 + (pressing - 3) * 0.0008) {
      card = "red";
    } else if (roll < (goalkeeperChallenge ? 0.1 : 0.15 + (pressing - 3) * 0.015)) {
      const prev = defender._yellows || 0;
      if (prev >= 1) {
        // 已有黄牌者会格外谨慎、裁判对第二黄也偏宽容。
        if (this.random() < 0.22) card = "red2";
      } else {
        card = "yellow";
        defender._yellows = prev + 1;
      }
    }
    if (card === "red" || card === "red2") defender.sentOff = true;
    return card;
  }

  _commitFoul(defender, victim, context = null) {
    const b = this.ball;
    // 禁区判定：犯规发生在防守方(defender)自己的禁区内 → 点球
    // 禁区横向 x∈[22,78]、纵深 16 格；`_onOwnSide` 正是「距己方门 ≤ 16 格」，
    // 主客/换边一体适用。
    const inBox =
      b.x > 22 && b.x < 78 && this._onOwnSide(b.y, defender.team, 16);

    // 凶狠度：压迫越高越易犯规；tackling 越好越不易“铲不到还犯规”。
    // 抢断节奏已降低到真实量级，因此单次失败对抗更可能构成可吹罚接触。
    const pressing = this._tacticLevel(defender.team, "pressing");
    const goalkeeperChallenge = !!context?.goalkeeperChallenge;
    let pFoul = goalkeeperChallenge
      ? clamp(
          0.02 +
            (1 - (defender.attr.handling || 0.5)) * 0.03 +
            ((victim.attr.dribbling || 0.5) - (defender.attr.positioning || 0.5)) * 0.02,
          0.015,
          0.07
        )
      : clamp(
          0.16 + (1 - defender.attr.tackling) * 0.2 + (pressing - 3) * 0.018,
          0.12,
          0.34
        );
    pFoul *= this._teamModifier(defender.team, "foul");
    // 较大的无画面积分步长会让一次接触跨越更宽的空间区间；按采样宽度
    // 校正可吹罚接触，避免仅因数值分辨率下降而凭空增加犯规与点球。
    const contactStep = this._activeStepDt || this.timeStep || SIM.DT;
    const contactSamplingScale = clamp(
      0.5 + 0.5 * (SIM.DT / contactStep),
      0.65,
      1
    );
    pFoul *= contactSamplingScale;
    // 后卫在禁区内会收脚，但不应把点球压低两个数量级。
    // 0.04 是在「后卫被支援安全圈推到离球 3.5 米外」的世界里定的；恢复禁区盯人后
    // 实测后卫贴到 2.05 米，同样的单次概率就产出更多点球（后台档 0.38 → 0.63，
    // 门槛 0.5）。这里按实测把本路径压回原量级：抢断+手球两条合计从 0.50 回到
    // 0.167（系数 0.334），门将出击一路不动。
    if (inBox && !goalkeeperChallenge) pFoul *= 0.014;
    if (this.random() >= pFoul) return false;

    // 被侵犯方获得球权重启
    const attackTeam = victim.team;

    const card = this._rollFoulCard(defender, pressing, goalkeeperChallenge);

    const advantage = !inBox && !goalkeeperChallenge
      ? advantageDecision({
          inPenaltyArea: inBox,
          ownerTeam: attackTeam,
          foulTeam: defender.team,
          forwardProgress: forwardProgress({
            fromY: victim.y,
            toY: victim.ty ?? victim.y,
            attackDirection: this.attackDir(victim.team),
          }),
          goalDistance: pitchDistanceToGoalMetres(
            b.x,
            b.y,
            this.targetGoalY(victim.team)
          ),
          pressure: this._pressureOn(victim),
          touchline: b.x < 5 || b.x > 95,
        })
      : { play: false };
    if (advantage.play) {
      this._advantage = {
        defenderId: defender.id,
        victimId: victim.id,
        team: attackTeam,
        reason: advantage.reason,
        card,
        x: b.x,
        y: b.y,
        startY: b.y,
        until: this.t + advantage.window,
      };
      this._emit("advantage", victim, {
        from: defender.id,
        reason: advantage.reason,
        x: b.x,
        y: b.y,
        window: advantage.window,
      });
      return true;
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
    if (this.random() < pInj * injMul) this._commitInjury(victim, "contact");

    const penaltyPerception = this._onFieldPenaltyDecision(
      defender.team,
      b.x,
      b.y,
      "foul"
    );
    if (inBox || penaltyPerception.onFieldDecision === "penalty") {
      const review = this._emitVarReview({
        incident: VAR_INCIDENTS.PENALTY,
        onFieldDecision: penaltyPerception.onFieldDecision,
        team: attackTeam,
        agent: victim,
        evidence: {
          inPenaltyArea: this._inOwnFoulBox(defender.team, b.x, b.y),
          offenceType: "foul",
          x: b.x,
          y: b.y,
          offenderId: defender.id,
          victimId: victim.id,
          boundaryDistance: penaltyPerception.boundaryDistance,
          onFieldReason: penaltyPerception.reason,
        },
      });
      if (review.finalDecision === "penalty") this._penaltyKick(attackTeam);
      else this._restart("freekick", attackTeam, clamp(b.x, 4, 96), clamp(b.y, 4, 96));
    } else {
      const fx = clamp(b.x, 4, 96);
      const fy = clamp(b.y, 4, 96);
      this._restart("freekick", attackTeam, fx, fy);
    }
    return true;
  }

  /**
   * 点球：先建立合法站位，再由 step 推进助跑、射门飞行和结果。
   * @param {"home"|"away"} team 主罚方
   */
  _penaltyKick(team) {
    this._passSupportRun = null;
    this._restartStepEpoch = (this._restartStepEpoch || 0) + 1;
    const b = this.ball;
    const dir = this.attackDir(team); // 主罚方进攻方向
    // 罚球点在**对方**禁区内（距对方门 12 格）。
    const spotY = this._oppGoalSideY(team, 12);
    // 主罚者：战术职责优先，否则按点球相关属性排序
    const assignedTaker = this._setPieceTaker(team, "penalty");
    const takers = this.agents
      .filter((a) => a.team === team && a.role !== "GK" && !a.sentOff)
      .sort(
        (a, c) =>
          (c === assignedTaker ? 1 : 0) - (a === assignedTaker ? 1 : 0) ||
          ((c.attr.finishing || 0.5) * 0.38 +
            (c.attr.shooting || 0.5) * 0.24 +
            (c.attr.decisions || 0.5) * 0.22 +
            (c.attr.kicking || 0.5) * 0.1) -
            ((a.attr.finishing || 0.5) * 0.38 +
              (a.attr.shooting || 0.5) * 0.24 +
              (a.attr.decisions || 0.5) * 0.22 +
              (a.attr.kicking || 0.5) * 0.1) ||
          (c.isCore ? 1 : 0) - (a.isCore ? 1 : 0) ||
          String(a.id).localeCompare(String(c.id))
      );
    const taker = takers[0] || null;
    const oppTeam = team === "home" ? "away" : "home";
    const gk = this._teamGk(oppTeam);

    if (!taker) {
      // 兜底：没人可罚，直接门球给对方。
      // ⚠ 门球坐标是「距**接球方自己**门 12 格」——与 :7390/:7411 一致，
      //   不是「距主罚方对方门」。这里发球方已换成 oppTeam，别用 team。
      this._restart("goalkick", oppTeam, 50, this._ownGoalSideY(oppTeam, 12));
      return;
    }

    // 死球摆位：其余球员退到禁区外 + 罚球弧外 + 球后方。
    //
    // 旧实现用等距网格（x = 25 + col*12.5，y = 24/29 两行），画面上是标尺一样的
    // 两条横排，而且纵坐标只看主罚方，双方球员交错混在同两排里，站位离球 13~18m。
    // 规则只要求离罚球点 9.15m，真实比赛里球员是贴着禁区线和弧线挤成松散弧形，
    // 进攻方抢弧顶等第二点、防守方站得更宽更靠后准备解围。
    //
    // 这里按「极角 + 半径」布点：
    //  · 进攻方（除主罚者）贴弧，半径小、集中在弧顶附近
    //  · 防守方半径更大、角度铺得更宽
    //  · 每人再叠一层按 id 派生的确定性抖动，避免任何等距痕迹
    // 抖动不能用 this.random()：它是有序流，在下面 pScore 抽样之前插入调用会
    // 改变本场之后所有随机数，破坏 seed 决定性。改用 id 哈希。
    const ARC_RX = 9.15 / 0.68;   // 9.15m 换成横向坐标单位（68m = 100）
    const ARC_RY = 9.15 / 1.05;   // 纵向坐标单位（105m = 100）
    // 对方禁区线：距**对方**门 16 格（home 主罚时即 y=16）。
    const boxEdgeY = this._oppGoalSideY(team, 16);
    // 「离对方球门为正」= 场地上背离对方门的方向 ⇒ 与进攻方向**反号**。
    // home 主罚时球门在 y=0、罚球点 y=12，frontierY 要把球员推到
    // `spotY + outward*1.2 = 13.2`（球的后方），所以这里必须是 +1。
    const outward = -this._sign(team);

    /** id 派生的 [0,1) 确定性伪随机，不消耗 this.random() 流 */
    const idNoise = (id, salt) => {
      const s = `${id}|${salt}`;
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return ((h >>> 0) % 100000) / 100000;
    };

    /**
     * 给定横坐标，返回该处「最靠近球门的合法纵坐标」。
     * 合法边界由三段拼成（以主队主罚为例，outward=+1）：
     *  · x < 22 或 x > 78：禁区之外，只受「必须在球后方」约束 → spotY
     *  · 弧与禁区线的交点之间（x≈38..62）：罚球弧是约束 → 弧上的 y
     *  · 其余（22..38、62..78）：禁区线是约束 → boxEdgeY
     */
    const frontierY = (x) => {
      let y = spotY + outward * 1.2;                  // 球后方
      if (x > 22 && x < 78) {
        const edge = boxEdgeY + outward * 0.6;        // 禁区线外侧
        y = outward > 0 ? Math.max(y, edge) : Math.min(y, edge);
      }
      const nx = (x - 50) / ARC_RX;
      if (Math.abs(nx) < 1) {
        // 弧在该 x 处的纵向半高
        const h = ARC_RY * Math.sqrt(1 - nx * nx) * 1.04;
        const arcY = spotY + outward * h;
        y = outward > 0 ? Math.max(y, arcY) : Math.min(y, arcY);
      }
      return y;
    };

    const teamRanks = { home: 0, away: 0 };
    const teamCounts = { home: 0, away: 0 };
    for (const a of this.agents) {
      if (a.sentOff || a === taker || a === gk || a.role === "GK") continue;
      teamCounts[a.team]++;
    }

    const placed = [];
    for (const a of this.agents) {
      if (a.sentOff) continue;
      a.vx = 0;
      a.vy = 0;
      a.intent = null;
      a.pose = null;
      if (a === taker || a === gk) continue;
      if (a.role === "GK") {
        // 另一位门将（主罚方的）留在自己半场，不参与摆位
        a.x = a.baseX;
        a.y = a.baseY;
        a.tx = a.x;
        a.ty = a.y;
        a.decisionUntil = this.t + SIM.PENALTY_RESOLVE_SEC + 1.5;
        a.fsm = "home";
        continue;
      }
      const attacking = a.team === team;
      const rank = teamRanks[a.team]++;
      const n = Math.max(1, teamCounts[a.team]);
      // 横向：进攻方挤在弧顶附近抢第二点；防守方铺得更宽，覆盖禁区两侧
      const halfSpan = attacking ? 17 : 27;
      const slot = n === 1 ? 0 : (rank / (n - 1)) * 2 - 1;      // -1..1
      const xJit = (idNoise(a.id, "x") - 0.5) * (attacking ? 7 : 9);
      let px = clamp(50 + slot * halfSpan + xJit, 6, 94);
      // 纵向：贴合法边界，再按队伍性质往后垫一点（防守方站得更靠后准备解围）
      const depth = (attacking ? 0.4 : 2.2) + idNoise(a.id, "d") * (attacking ? 2.6 : 5.0);
      let py = frontierY(px) + outward * depth;
      py = clamp(py, 3, 97);
      placed.push({ a, x: px, y: py, attacking });
    }

    // 去重叠：球员圆点直径约 1.6m，挤在一起会糊成一坨。做几轮互推，
    // 每轮之后重新压回合法边界，保证推挤不会把人顶进禁区或弧内。
    const MIN_GAP_M = 2.0;
    for (let iter = 0; iter < 6; iter++) {
      let moved = false;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const p = placed[i];
          const q = placed[j];
          const dxm = (q.x - p.x) * 0.68;
          const dym = (q.y - p.y) * 1.05;
          const dm = Math.hypot(dxm, dym);
          if (dm >= MIN_GAP_M || dm < 1e-6) continue;
          const push = (MIN_GAP_M - dm) / 2 + 0.05;
          const ux = dxm / dm;
          const uy = dym / dm;
          p.x -= (ux * push) / 0.68;
          p.y -= (uy * push) / 1.05;
          q.x += (ux * push) / 0.68;
          q.y += (uy * push) / 1.05;
          moved = true;
        }
      }
      for (const p of placed) {
        p.x = clamp(p.x, 6, 94);
        const front = frontierY(p.x);
        p.y = outward > 0 ? Math.max(p.y, front) : Math.min(p.y, front);
        p.y = clamp(p.y, 3, 97);
      }
      if (!moved) break;
    }

    for (const p of placed) {
      p.a.x = p.x;
      p.a.y = p.y;
      p.a.tx = p.x;
      p.a.ty = p.y;
      p.a.decisionUntil = this.t + SIM.PENALTY_RESOLVE_SEC + 1.5;
      p.a.fsm = "home";
    }
    if (gk) {
      gk.x = 50;
      gk.y = gk.baseY;
      gk.tx = gk.x;
      gk.ty = gk.y;
      // 门将面向**自己**的球门（背对进攻方向）⇒ 与进攻方向反号的 π/2。
      gk.heading = -this._sign(team) * (Math.PI / 2);
      gk.decisionUntil = this.t + SIM.PENALTY_RESOLVE_SEC + 1.5;
    }
    taker.x = 50;
    taker.y = spotY - dir * 4;
    taker.tx = taker.x;
    taker.ty = taker.y;
    taker.vx = 0;
    taker.vy = 0;
    taker.heading = dir < 0 ? -Math.PI / 2 : Math.PI / 2;
    taker.intent = null;
    taker.fsm = "setpiece";
    taker.decisionUntil = this.t + SIM.PENALTY_RESOLVE_SEC + 1.5;

    // 结算：终结/射门/决策/脚法决定质量，门将 reflexes/handling 决定扑出。
    const penSkill =
      (taker.attr.finishing || 0.55) * 0.38 +
      (taker.attr.shooting || 0.55) * 0.24 +
      (taker.attr.decisions || 0.55) * 0.22 +
      (taker.attr.kicking || 0.55) * 0.1 +
      (taker.isCore ? 0.015 : 0);
    const save = gk ? 0.55 * gk.attr.reflexes + 0.28 * gk.attr.handling : 0.2;
    const pScore = clamp(0.77 + (penSkill - 0.6) * 0.34 - save * 0.22, 0.55, 0.9);
    const r = this.random();
    const outcome =
      r < pScore
        ? "goal"
        : r < pScore + (1 - pScore) * 0.7 && gk
          ? "save"
          : "miss";
    const targetX = outcome === "miss"
      ? r < 0.5
        ? SIM.GOAL_X0 - 2
        : SIM.GOAL_X1 + 2
      : clamp(46.2 + ((r * 997) % 1) * 7.6, SIM.GOAL_X0 + 0.8, SIM.GOAL_X1 - 0.8);
    const saveSide = outcome === "save" ? (this.random() < 0.5 ? 1 : -1) : 0;

    // 球先摆到点上，供自适应录像捕捉完整定位球画面。
    b.x = 50;
    b.y = spotY;
    b.z = 0;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.owner = null;
    b.lastKicker = taker.id;
    b.kickTeam = team;
    b.state = "penalty";
    b._shotAssistId = null;
    b.shotDistance = 11;
    this._clearBallTarget();
    this.possession = team;
    this.deadBallUntil = this.t + SIM.PENALTY_RESOLVE_SEC + 0.9;
    this.pendingPenalty = {
      team,
      oppTeam,
      takerId: taker.id,
      gkId: gk?.id || null,
      spotY,
      dir,
      startedAt: this.t,
      runAt: this.t + SIM.PENALTY_RUN_SEC,
      kickAt: this.t + SIM.PENALTY_KICK_SEC,
      resolveAt: this.t + SIM.PENALTY_RESOLVE_SEC,
      outcome,
      targetX,
      saveSide,
      phase: "setup",
      // placed 就是这次摆位涉及的场上球员（不含主罚者和两位门将），
      // _tickPenalty 的 setup 阶段用它把这些人钉住不动。
      stagedIds: placed.map((p) => p.a.id),
    };
  }

  _tickPenalty(dt) {
    const pen = this.pendingPenalty;
    if (!pen) return;
    const b = this.ball;
    const taker = this.agentById(pen.takerId);
    const gk = pen.gkId ? this.agentById(pen.gkId) : null;

    if (pen.phase === "setup") {
      b.x = 50;
      b.y = pen.spotY;
      b.z = 0;
      b.vx = 0;
      b.vy = 0;
      b.vz = 0;
      b.owner = null;
      b.state = "penalty";

      for (const id of pen.stagedIds) {
        const a = this.agentById(id);
        if (!a) continue;
        a.vx = 0;
        a.vy = 0;
        a.tx = a.x;
        a.ty = a.y;
      }
      if (gk) {
        gk.x = 50;
        gk.y = gk.baseY;
        gk.tx = gk.x;
        gk.ty = gk.y;
        gk.vx = 0;
        gk.vy = 0;
      }
      if (taker) {
        const runProgress = clamp(
          (this.t - pen.runAt) / Math.max(0.01, pen.kickAt - pen.runAt),
          0,
          1
        );
        taker.x = 50;
        taker.y = pen.spotY - pen.dir * (4 - runProgress * 3.15);
        taker.tx = taker.x;
        taker.ty = taker.y;
        taker.vx = 0;
        taker.vy = runProgress > 0 ? pen.dir * 2.4 : 0;
      }

      if (this.t + dt >= pen.kickAt - 1e-9) {
        pen.phase = "flight";
        if (taker) {
          taker.pose = "kick";
          taker.poseDir = pen.dir;
          taker.poseUntil = this.t + 0.55;
          this._emit("shot", taker, {
            penalty: true,
            distance: 11,
            x: 50,
            y: pen.spotY,
            offTarget: pen.outcome === "miss",
          });
        }
        b.state = "shot";
      }
      return;
    }

    const flight = clamp(
      (this.t - pen.kickAt) / Math.max(0.01, pen.resolveAt - pen.kickAt),
      0,
      1
    );
    // 终点在**对方**门线内侧 0.8 格（不是球门常量 0/100，避免与门线重合）
    const goalY = this._oppGoalSideY(pen.team, 0.8);
    b.x = 50 + (pen.targetX - 50) * flight;
    b.y = pen.spotY + (goalY - pen.spotY) * flight;
    b.z = Math.sin(Math.PI * flight) * 0.45;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.owner = null;
    b.state = "shot";

    if (gk) {
      const dive = clamp((flight - 0.2) / 0.8, 0, 1);
      const goalTargetX = pen.outcome === "save" ? 50 + pen.saveSide * 6 : pen.targetX;
      gk.x = 50 + (goalTargetX - 50) * dive * 0.85;
      gk.y = gk.baseY;
      gk.tx = gk.x;
      gk.ty = gk.y;
      if (dive > 0) {
        gk.pose = "dive";
        gk.poseDir = goalTargetX < 50 ? -1 : 1;
        gk.poseUntil = pen.resolveAt + 0.5;
      }
    }

    if (this.t + dt < pen.resolveAt - 1e-9) return;
    this.pendingPenalty = null;
    if (pen.outcome === "goal") {
      b.x = pen.targetX;
      b.y = goalY;
      b.lastKicker = pen.takerId;
      b.kickTeam = pen.team;
      b._penaltyGoal = true;
      this._goal(pen.team);
      return;
    }
    if (pen.outcome === "save" && gk) {
      this._emit("save", gk, { hold: false, penalty: true });
      b.x = 50 + pen.saveSide * 8;
      b.y = pen.spotY + pen.dir * 3;
      b.vx = pen.saveSide * 12;
      b.vy = -pen.dir * 6;
      b.z = 0.5;
      b.vz = 3;
      b.state = "loose";
      b.lastKicker = gk.id;
      b.kickTeam = pen.oppTeam;
      b.settleUntil = this.t + 0.6;
      this.deadBallUntil = this.t + 0.5;
      return;
    }
    // 门球坐标同 :7390/:7411：距**接球方自己**门 12 格（pen.oppTeam 是发球方）。
    this._restart("goalkick", pen.oppTeam, 50, this._ownGoalSideY(pen.oppTeam, 12));
  }

  /**
   * 边界与进球判定（P3）：
   * - 球越过球门线且在门框内 → 进球
   * - 越过球门线（门框外）→ 进攻方碰的 = 门球；防守方碰的 = 角球
   * - 越过边线 → 界外球（判给最后触球方的对方）
   * 每种死球都经 _restart 分类重启：重置站位 + 死球窗口，让球彻底离开门口，
   * 从根上掐断"射偏→门口篮板→再射"的射门画廊。
   */
  /**
   * 门框命中：只发事件，**不做活球反弹**。
   *
   * ⛔ 活球反弹试过了，实测把护栏顶穿：门框 0.92 次/场（真实约 0.4）、
   *    进球 2.92 → **3.50**（护栏上限 3.3）、射门 13.75 → 15.33、角球 4.67 → 5.42。
   *    三项一起涨方向一致——反弹让球留在场内，替掉了原本的死球重启。
   *    而 `_resolveBounds` 的头注释写得很清楚：死球重启是**刻意**用来
   *    「让球彻底离开门口，从根上掐断『射偏→门口篮板→再射』的射门画廊」的。
   *    活球反弹等于把那个画廊请回来。
   *
   * 所以现在的语义是：擦柱/中梁的球**不算进球**，照常走下面的角球/门球重启
   * （射门方最后触球 → 角球给进攻方，与真实的「打柱出底线」一致），
   * 画面上多出一次「击中门框」的提示。真实里打柱后回到场内的情况没有覆盖，
   * 那要连带重做死球重启的设计，不在这一批里。
   */
  _emitWoodwork(part, crossX) {
    const shooter = this.agents.find((a) => a.id === this.ball.lastKicker) || null;
    this._emit("woodwork", shooter, { part, crossX: Number(crossX.toFixed(2)) });
  }

  _resolveBounds() {
    const b = this.ball;
    const kicker = b.lastKicker ? this.agentById(b.lastKicker) : null;
    const kickTeam = kicker ? kicker.team : null;

    // —— 越过球门线 ——
    // ⚠ 端别一律从 `ownGoalY` 派生，**不能**写死「主队球门在 y≈100，客队球门在 y≈0」——
    //   `endsSwapped` 会翻 y，写死的话下半场每一次底线判罚都会反：进球记给错队
    //   （还会被判成乌龙）、角球↔门球互换、门球点跑到另一端。
    //   （旧注释正是那句话，是下面那一整块错误的成因。）
    const lowTeam = this.ownGoalY("home") <= 50 ? "home" : "away"; // y≈0 端守门的队
    const highTeam = lowTeam === "home" ? "away" : "home"; // y≈100 端守门的队
    const crossedGoalLine = b.y <= 0 ? 0 : b.y >= 100 ? 100 : null;
    let crossX = b.x;
    let crossZ = b.z || 0;
    if (
      crossedGoalLine != null &&
      Number.isFinite(b._prevY) &&
      Math.abs(b.y - b._prevY) > 1e-9
    ) {
      const ratio = clamp((crossedGoalLine - b._prevY) / (b.y - b._prevY), 0, 1);
      crossX = b._prevX + (b.x - b._prevX) * ratio;
      const crossDt = (b._stepDt || SIM.DT) * ratio;
      crossZ = Math.max(0, b._prevZ + b._prevVz * crossDt - 9 * crossDt * crossDt);
    }
    const underBar = crossZ < 2.44;
    // —— 门框 ——
    // 立柱在 `GOAL_X0`/`GOAL_X1`，横梁在 z = 2.44。以前这里只有 `underBar` 的二元判断：
    // 柱内且低于横梁 → 进球，否则出底线。**那时**立柱与横梁不是可碰撞几何，
    // 所以画面上永远看不到打门框，`woodwork` 事件类型虽然存在也从没被发出过。
    // ⚠ 以上是历史说明。2026-09-03 起，下面已经实现可碰撞门框并真正发出 `woodwork`
    //    （`_emitWoodwork`，定义见本文件 :6897，调用点见 :6945 / :6966）。
    //    **不要再据此段认为门框未实现。**
    // 容差：柱子实际 12cm + 球半径约 11cm ≈ 0.34m。第一版按这个取（x 一格 0.68m → 0.5 格、
    // z 0.34m），实测门框 0.92 次/场，是真实 0.4 的两倍多——因为「越过门线那一刻的
    // 插值落点」本身带 0.1s 步长的离散误差，等效容差比几何容差大。取半后再量。
    const POST_TOL_X = 0.25;
    const BAR_TOL_Z = 0.17;
    const hitPost =
      underBar &&
      (Math.abs(crossX - SIM.GOAL_X0) < POST_TOL_X ||
        Math.abs(crossX - SIM.GOAL_X1) < POST_TOL_X);
    const hitBar =
      crossX > SIM.GOAL_X0 - POST_TOL_X &&
      crossX < SIM.GOAL_X1 + POST_TOL_X &&
      Math.abs(crossZ - 2.44) < BAR_TOL_Z;
    if (b.y <= 0) {
      // y≈0 端：`lowTeam` 守门，它的对手在这端进攻
      const defTeam = lowTeam;
      const attTeam = lowTeam === "home" ? "away" : "home";
      const goalEligible = b.state === "shot" || (b.state === "loose" && kickTeam === defTeam);
      // 擦柱/中梁：不算进球，往下走死球重启（见 `_emitWoodwork`）
      const wood = goalEligible && (hitPost || hitBar);
      if (wood) this._emitWoodwork(hitPost ? "post" : "bar", crossX);
      if (
        goalEligible &&
        !wood &&
        crossX > SIM.GOAL_X0 &&
        crossX < SIM.GOAL_X1 &&
        underBar
      ) return this._goal(attTeam, {
        crossedGoalLine: true,
        insidePosts: true,
        underBar,
        crossX,
        crossZ,
      });
      // 门框外出底线：守方(defTeam)最后碰 = 角球给攻方(attTeam)；攻方碰 = 门球给 defTeam
      if (kickTeam === defTeam) return this._restart("corner", attTeam, b.x < 50 ? 2 : 98, 4);
      return this._restart("goalkick", defTeam, 50, 12);
    }
    if (b.y >= 100) {
      // y≈100 端：`highTeam` 守门
      const defTeam = highTeam;
      const attTeam = highTeam === "home" ? "away" : "home";
      const goalEligible = b.state === "shot" || (b.state === "loose" && kickTeam === defTeam);
      const wood = goalEligible && (hitPost || hitBar);
      if (wood) this._emitWoodwork(hitPost ? "post" : "bar", crossX);
      if (
        goalEligible &&
        !wood &&
        crossX > SIM.GOAL_X0 &&
        crossX < SIM.GOAL_X1 &&
        underBar
      ) return this._goal(attTeam, {
        crossedGoalLine: true,
        insidePosts: true,
        underBar,
        crossX,
        crossZ,
      });
      // 门框外出底线：守方最后碰 = 角球给攻方；攻方碰 = 门球给守方
      if (kickTeam === defTeam) return this._restart("corner", attTeam, b.x < 50 ? 2 : 98, 96);
      return this._restart("goalkick", defTeam, 50, 88);
    }

    // —— 越过边线：界外球，判给对方 ——
    if (b.x <= 0 || b.x >= 100) {
      const throwTeam = kickTeam ? (kickTeam === "home" ? "away" : "home") : "home";
      const tx = b.x <= 0 ? 1 : 99;
      return this._restart("throwin", throwTeam, tx, clamp(b.y, 8, 92));
    }
  }

  /**
   * 死球重启：角球 / 门球 / 界外球 / 直接或间接任意球。
   * 把球放到重启点、交给 restartTeam 最近球员，并重置双方站位到合理形态，
   * 给足死球保护窗口——保证球真正离开门口，杜绝篮板连射。
   * @param {"corner"|"goalkick"|"throwin"|"offside"|"freekick"|"indirect"} type
   */
  _restart(type, restartTeam, x, y) {
    this._passSupportRun = null;
    this._restartStepEpoch = (this._restartStepEpoch || 0) + 1;
    this._cornerRoutine = null;
    this.pendingPenalty = null;
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
    b.backpassCandidate = false;
    b.backpassFrom = null;
    b.backpassTargetId = null;

    const dir = this.attackDir(restartTeam); // 重启方进攻方向
    // 守方门将锚点：距**守方自己**的球门 5 格（换边安全：从 `_ownGoalSideY` 派生）。
    // ⚠ 原式 `restartTeam === "home" ? 5 : 95` 同样把「主队朝 y 小攻」写死了。
    //   （当前它被 `buildCornerRoutine` 的槽位覆盖，所以观测不到，但属同类漏网。）
    const defGkY = this._ownGoalSideY(restartTeam === "home" ? "away" : "home", 5);

    // 角球用固定分槽而不是逐人随机撒点。旧逻辑的伯努利抽样会偶发 7v7
    // 同时塞进八码宽的区域，录像里就表现成一团重叠圆点。
    let cornerTaker = null;
    const attackBoxSlots = new Map();
    const attackEdgeSlots = new Map();
    const defendBoxSlots = new Map();
    const defendEdgeSlots = new Map();
    // 槽位表以「重启方朝 y→0 攻」为基准 ⇒ 按该队**进攻方向**决定要不要镜像。
    // ⚠ 2026-09-22 修：原式 `restartTeam === "home" ? topY : 100 - topY` 把
    //   「主队朝 y 小攻」写死了。下半场换边后整队会被摆到另一端（实测：主队在
    //   y=82 获前场任意球，10 名场上球员里 8 人被摆到 y≈14-28）。
    const mirrorY = (topY) => (dir < 0 ? topY : 100 - topY);
    if (type === "corner") {
      const attackOutfield = this.agents.filter(
        (a) => a.team === restartTeam && a.role !== "GK" && !a.sentOff
      );
      const cornerSide = x < 50 ? 0 : 100;
      const assignedCornerTaker = this._setPieceTaker(restartTeam, "corner");
      cornerTaker =
        assignedCornerTaker ||
        attackOutfield
          .slice()
          .sort((a, b) => {
            const roleA = a.role === "MID" ? 0 : a.role === "DEF" ? 4 : 8;
            const roleB = b.role === "MID" ? 0 : b.role === "DEF" ? 4 : 8;
            const skillA = (a.attr.crossing || 0.55) * 4 + (a.attr.passing || 0.55) * 2;
            const skillB = (b.attr.crossing || 0.55) * 4 + (b.attr.passing || 0.55) * 2;
            return (
              Math.abs(a.baseX - cornerSide) + roleA - skillA -
                (Math.abs(b.baseX - cornerSide) + roleB - skillB) ||
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
        // 主罚者：战术职责优先；直接任意球看 kicking/shooting，传中型看 crossing/passing/kicking
        const assignedFkTaker = this._setPieceTaker(restartTeam, "directFreeKick");
        const takerScore =
          fkClass === "direct"
            ? (p) =>
                0.44 * (p?.attr?.kicking || 0.55) +
                0.32 * (p?.attr?.shooting || 0.55) +
                0.14 * (p?.attr?.crossing || 0.55) +
                0.1 * (p?.attr?.decisions || 0.55)
            : (p) =>
                0.42 * (p?.attr?.crossing || 0.55) +
                0.25 * (p?.attr?.passing || 0.55) +
                0.2 * (p?.attr?.kicking || 0.55) +
                0.13 * (p?.attr?.decisions || 0.55);
        fkTaker =
          assignedFkTaker ||
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
                  (0.45 + 0.55 * angFk) *
                  (0.86 + takerScore(fkTaker || { attr: {} }) * 0.24),
                0.1,
                0.85
              )
            : 0;
      }
    }
    const fkSetPiece = fkClass && fkClass !== "simple";

    for (const a of this.agents) {
      if (a.sentOff || a.injuredOff) continue; // 已离场者不参与死球摆位
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
            a.x = clamp(50 + (this.random() - 0.5) * 4, 44, 56);
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
      taker = this.agents.find(
        (a) => a.team === restartTeam && a.role === "GK" && !a.sentOff && !a.injuredOff
      ) || null;
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
        taker._fkPlan = this.random() < fkShootP ? "shoot" : "cross";
        taker._fkPlanUntil = this.t + 6;
      }
    }
    this.possession = restartTeam;
    // 角球/人墙任意球死球窗更长，画面上能看清定位球状态
    this.deadBallUntil =
      this.t + (type === "corner" ? 1.8 : fkSetPiece ? 2.0 : 1.0);
    // 人墙任意球复用角球的短窗保形：开球前全员钉在摆位点，不被跑位逻辑拆散
    if (fkSetPiece) this.cornerShapeUntil = this.t + 2.6;
    // 越位是唯一「判罚原因」与「重启名称」同名的类型：`_callOffside` 已经发过一条
    // 真实判罚（带 kickLineY/kickBallY），这里若照 type 原样发，事件流里就会出现
    // 第二条 `offside`，且 taker 属于**获得任意球的防守方**——解说因此把越位念成
    // 对手越位。其余重启名（corner/goalkick/freekick/throwin）都不与判罚原因重名。
    this._emit(type === "offside" ? "offside_restart" : type, taker, {
      x,
      y,
      setPiece: type,
      indirect: type === EDGE_RESTART_TYPES.INDIRECT_FREE_KICK,
    });
    if (type === "corner" && b.state === "corner") {
      this._cornerRoutine = buildCornerRoutine({ agents: this.agents, team: b.kickTeam,
        takerId: b.owner, ball: b, now: this.t, attackDirection: this.attackDir(b.kickTeam),
        goalY: this.targetGoalY(b.kickTeam) });
      for (const a of this.agents) {
        const spot = this._cornerRoutine.positions.get(a.id);
        if (!spot) continue;
        a.x = a.tx = spot.x;
        a.y = a.ty = spot.y;
        a.vx = a.vy = 0;
        a.offBallTarget = null;
      }
    }
  }

  /**
   * 进球：记分、发事件 → 庆祝聚拢（约 5.5s）→ 再中圈开球（对方开）
   * 避免「入网瞬间整队瞬移回中圈」的观感断层。
   * 乌龙：lastKicker 属于失球方（封堵折射/自摆乌龙）时标 ownGoal；
   * agentId 仍是最后触球者，team 永远是得分方（与门线归属一致）。
   */
  _goal(scoringTeam, goalEvidence = null) {
    const b = this.ball;
    const scorer = b.lastKicker ? this.agentById(b.lastKicker) : null;
    const isPenalty = !!b._penaltyGoal;
    const review = this._emitVarReview({
      incident: VAR_INCIDENTS.GOAL,
      onFieldDecision: "goal",
      team: scoringTeam,
      agent: scorer,
      evidence: {
        crossedGoalLine: goalEvidence?.crossedGoalLine ?? true,
        insidePosts: goalEvidence?.insidePosts ?? true,
        underBar: goalEvidence?.underBar ?? true,
        offside: goalEvidence?.offside ?? false,
        crossX: goalEvidence?.crossX ?? b.x,
        crossZ: goalEvidence?.crossZ ?? b.z,
        penalty: isPenalty,
      },
    });
    if (review.finalDecision === "no-goal") {
      b._penaltyGoal = false;
      // 取消进球后改判门球给非得分方。门球坐标同 :7390/:7411：
      // 距**发球方自己**门 12 格。
      const kickTeam = scoringTeam === "home" ? "away" : "home";
      this._restart("goalkick", kickTeam, 50, this._ownGoalSideY(kickTeam, 12));
      return;
    }
    this.score[scoringTeam]++;
    b._penaltyGoal = false;
    // 最后触球方 ≠ 得分方 → 乌龙/折射入网；点球不可能乌龙
    const ownGoal = !isPenalty && !!scorer && scorer.team && scorer.team !== scoringTeam;
    const assistId =
      !isPenalty &&
      !ownGoal &&
      b._shotAssistId &&
      b._shotAssistId !== scorer?.id
        ? b._shotAssistId
        : null;
    this._emit("goal", scorer, {
      team: scoringTeam,
      score: { ...this.score },
      assistId,
      penalty: isPenalty,
      ownGoal,
    });

    // 球钉在球门线外/网口 —— **得分方进攻的**那个门（换边安全：从 `targetGoalY` 派生）。
    // ⚠ 这一行必须与上面 `_resolveBounds` 的记名**同批**改：两者原先同向错误、互相抵消
    //   （记名反 + 钉球端也反 ⇒ 球反而落在真实那一端）。只改一边会让球在进球瞬间
    //   瞬移 ~87 码（y 0.8 ↔ 99.2）。
    const inTopNet = this.targetGoalY(scoringTeam) <= 50;
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
        a.tx = clamp(a.baseX * 0.55 + 50 * 0.45 + (this.random() - 0.5) * 8, 8, 92);
        a.ty = clamp(a.baseY * 0.65 + 50 * 0.35 + (this.random() - 0.5) * 6, 10, 90);
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
    // 钉在**得分方进攻的**球门网口。
    // ⚠ 原实现是 `if (team === "home") … else if (team === "away") …` —— 按队名取端，
    //   换边后把球钉到另一端。改由 `targetGoalY` 派生（`endsSwapped=false` 下逐位等价）；
    //   仍保留「只有合法队名才钉球」的语义（team 为空时两边都不动）。
    if (team === "home" || team === "away") {
      const goalEnd = this.targetGoalY(team);
      if (goalEnd <= 50) b.y = Math.min(b.y, 1.2);
      else b.y = Math.max(b.y, 98.8);
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
          // 「上/下」端按**得分方进攻的球门**取，不按队名（换向安全）
          const inTop = this.targetGoalY(team) <= 50;
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

  /** 开球：双方留在己方半场，非开球队退出中圈 */
  _kickoff(team) {
    this._passSupportRun = null;
    this._restartStepEpoch = (this._restartStepEpoch || 0) + 1;
    this.celebrateParticipants = null;
    this.cornerShapeUntil = 0;
    for (const a of this.agents) {
      if (a.sentOff) continue; // 已离场者不回基准位（保持走向边线/场外）
      a.x = a.baseX;
      // 常规 baseY 是运动战纵深，前锋已在对方半场；开球时压缩回己方半场。
      // ⚠ 这里必须按**该队此刻的进攻方向**判断压在哪一侧，不能写 `team === "home"`：
      // 换边后主队守上半场、客队守下半场，用队名判断会把两队都压到错误的半场。
      // `attackingUp` = 朝 y 小进攻 ⇒ 己方半场在 y 大那一侧。
      const attackingUp = this.attackDir(a.team) < 0;
      a.y = attackingUp ? 50 + a.baseY * 0.48 : a.baseY * 0.48;
      // 非开球队必须在球开出前退出中圈（半径约 9.15m）。
      // 同样按进攻方向退向**自己的**半场，而不是按队名。
      if (a.team !== team) {
        if (attackingUp) a.y = Math.max(a.y, 59.5);
        else a.y = Math.min(a.y, 40.5);
      }
      a.tx = a.x;
      a.ty = a.y;
      a.vx = 0;
      a.vy = 0;
      a.intent = null;
      a.fsm = "home";
      a.decisionUntil = this.t + 0.5;
      // 朝向必须一起重置。旧实现重置了 x/y/tx/ty/vx/vy/intent/fsm 却漏了 heading，
      // 而 `_stepBall:4659` 把球钉在持球者 heading 前方 1.4 格——丢球那方在庆祝
      // 期间朝自己球门走（`:6702`），开球时那个朝向没被清，于是**球一开始就在
      // 开球者身后**，画面上是一次向后带球。
      a.heading = this.attackDir(a.team) > 0 ? Math.PI / 2 : -Math.PI / 2;
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
    this.ball.backpassCandidate = false;
    this.ball.backpassFrom = null;
    this.ball.backpassTargetId = null;
    // 把中圈球员拉来开球
    const near = this._nearestOf(team, 50, 50);
    if (near) {
      near.x = 50;
      near.y = 50;
      near.tx = near.x;
      near.ty = near.y;
      this.ball.owner = near.id;
      // 让首次决策落在死球窗口**之后**。旧值 t+0.6 落在 `deadBallUntil = t+0.9` 之内，
      // 于是它被死球护球分支（`_decideOnBall` 开头）吃掉，而节流是在调用**之前**写的
      // （`_think`），下一次机会被推到 t+1.64~2.86s。开球者因此抱着球空等 1~2 秒，
      // 常常在能传之前就被断掉——实测首脚传球只占 37.5%。
      near.decisionUntil = this.t + 0.95;
      // 摆一个接球人。`* 0.48` 的压缩把最近的队友推到 15~25 格（16~26m）外，
      // 真实开球旁边有个 5~10m 的伙伴。放在本方半场内 8 格处：Law 8 只要求
      // 开球方在本方半场（对手才需退出中圈），所以这个位置合法。
      // 距球 10 格，过得了传球候选的 `d < 6` 下限（`_passCandidates:2817`）。
      const back = -this.attackDir(team); // 指向本方半场
      let mate = null;
      let bestD = Infinity;
      for (const a of this.agents) {
        if (a.team !== team || a.sentOff || a.role === "GK" || a.id === near.id) continue;
        const d = dist(a.x, a.y, 50, 50);
        if (d < bestD) { bestD = d; mate = a; }
      }
      if (mate) {
        // 摆在**侧面**而不是身后：用户要的是「传给旁边的队友」。
        // ±9 格横向 + 3 格回撤 = 距球 6.9m（hypot(9×0.68, 3×1.05)），落在真实开球
        // 短传的 5~10m 里，也过得了传球候选的 `d < 6` 下限。
        // 先前版本放在身后 8 格，首脚传球率确实到了 100%，但 100% 的开球都把球
        // 往自己球门送（净位移中位 −1.56m），画面上仍然不对。
        mate.x = clamp(mate.baseX < 50 ? 41 : 59, 4, 96);
        mate.y = clamp(50 + back * 3, 3, 97);
        mate.tx = mate.x;
        mate.ty = mate.y;
        mate.vx = 0;
        mate.vy = 0;
        // 记下接球人。首脚**指定传给他**，不走 `_bestPass` 的 argmax——那个排序读的是
        // `advance`（`_passCandidates`），而开球时所有候选的 advance 都是负的，谁排第一
        // 基本是噪声，方向也就不可控。实测靠 `_bestPass` 选时首脚传球率只有 77~100% 之间
        // 浮动，且方向随摆位漂移。
        this.ball.kickoffMateId = mate.id;
      }
      // 首脚必须传出，与界外球同一条规矩（`_decideOnBall:2217`）。
      // ⚠ 刻意**不**设 `ball.restartType = "kickoff"`：那个字段有 8 处消费者，
      //   含 `box-defending-audit` 的 `crowdedPairs`（上限 14、干净基线 12，余量只有 2）、
      //   `edge-rules-audit` 的等值断言、以及 `_queueBallAction:1155` 的提前返回。
      //   用一个自带时限的独立标志，把影响面锁死在开球上。
      this.ball.kickoffPassUntil = this.t + 6;
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
  /** 按固定间隔记录控球累计值，让任意时刻的控球率可被还原 */
  _samplePossession() {
    const line = this.possTimeline;
    const last = line[line.length - 1];
    if (last && this.t - last.t < SIM.POSS_SAMPLE_SEC) return;
    line.push({
      t: this.t,
      home: this.stats.home.poss || 0,
      away: this.stats.away.poss || 0,
    });
  }

  /**
   * 截至某个模拟时刻的控球累计秒数（采样点之间线性插值）。
   * 直播用它显示"到当前画面为止"的控球率，避免提前泄露整段最终数据。
   * @param {number} t 模拟秒
   */
  possessionAt(t) {
    const line = this.possTimeline;
    if (!line?.length) return { home: 0, away: 0 };
    if (t <= line[0].t) return { home: line[0].home, away: line[0].away };
    const last = line[line.length - 1];
    if (t >= last.t) {
      // 采样点之后的部分仍未落点：直接用当前累计值，不做外推。
      return t >= this.t
        ? { home: this.stats.home.poss || 0, away: this.stats.away.poss || 0 }
        : { home: last.home, away: last.away };
    }
    let lo = 0;
    let hi = line.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (line[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = line[lo];
    const b = line[hi];
    const span = b.t - a.t;
    const k = span > 1e-9 ? (t - a.t) / span : 0;
    return {
      home: a.home + (b.home - a.home) * k,
      away: a.away + (b.away - a.away) * k,
    };
  }

  /**
   * 截至某个模拟时刻的累计统计，用于直播顶栏与数据条。
   * 射门/射正/xG 由同一批事件按时间过滤重算，控球读控球时间轴，
   * 因此画面在 20′时只会显示 20′之前发生过的事。
   * @param {number} t 模拟秒
   * @param {number} [tMin] 统计起点（默认全场累计）
   */
  statsThrough(t, tMin = 0) {
    const upTo = Math.max(tMin, Number.isFinite(t) ? t : this.t);
    const partial = this.directResult({ tMin, tMax: upTo });
    const possUpTo = this.possessionAt(upTo);
    const possFrom = this.possessionAt(tMin);
    partial.possessionSec = {
      home: Math.max(0, possUpTo.home - possFrom.home),
      away: Math.max(0, possUpTo.away - possFrom.away),
    };
    return partial;
  }

  directResult(opts = {}) {
    const tMin = opts.tMin ?? 0;
    const tMax = opts.tMax ?? Infinity;
    const inWindow = (e) => e.t > tMin && e.t <= tMax;
    const rawShots = this.events.filter((e) => e.type === "shot" && inWindow(e));
    const rawGoals = this.events.filter((e) => e.type === "goal" && inWindow(e));
    const rawSaves = this.events.filter((e) => e.type === "save" && inWindow(e));
    const result = {
      score: { home: 0, away: 0 },
      shots: { home: 0, away: 0 },
      shotsOn: { home: 0, away: 0 },
      xg: { home: 0, away: 0 },
      possessionSec: { home: 0, away: 0 },
      goals: [],
      rawScore: { home: 0, away: 0 },
      rawShots: { home: 0, away: 0 },
      tMin,
      tMax: Number.isFinite(tMax) ? tMax : null,
    };
    for (const shot of rawShots) {
      if (shot.team !== "home" && shot.team !== "away") continue;
      result.shots[shot.team]++;
      result.xg[shot.team] += estimateShotXg(shot);
    }
    for (const goal of rawGoals) {
      if (goal.team !== "home" && goal.team !== "away") continue;
      result.score[goal.team]++;
      result.shotsOn[goal.team]++;
      result.goals.push({
        team: goal.team,
        minute: simMinuteOf(goal.t),
        scorerId: goal.agentId || null,
        assistId: goal.assistId || null,
        // 与 _goal 同源：点球不记助攻；乌龙不记射手进球/助攻
        penalty: !!goal.penalty,
        ownGoal: !!goal.ownGoal,
        t: goal.t,
      });
    }
    // 扑救 ⇒ 对方一脚射正（与进球不重复：进球不会再走 save）
    for (const sav of rawSaves) {
      if (sav.team !== "home" && sav.team !== "away") continue;
      const att = sav.team === "home" ? "away" : "home";
      result.shotsOn[att]++;
    }
    for (const team of ["home", "away"]) {
      result.shotsOn[team] = Math.min(result.shots[team], result.shotsOn[team]);
      // 保留足够精度，让赛后分析按同一批射门求和后再统一四舍五入；
      // 过早截到 3 位会在 2 位展示边界上与分析页产生 0.01 差异。
      result.xg[team] = Math.round(result.xg[team] * 1_000_000) / 1_000_000;
    }
    // 控球秒数：时段内增量由调用方用 poss 快照差分；此处给累计值便于诊断
    result.possessionSec = {
      home: this.stats.home.poss || 0,
      away: this.stats.away.poss || 0,
    };
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
    return this.agents.find((a) => a.team === team && a.role === "GK" && !a.sentOff && !a.injuredOff) || null;
  }

  integrationSummary() {
    const stats = this.integrationStats || {};
    const extraSteps = Math.max(0, (stats.fineSteps || 0) - (stats.fineIntervals || 0));
    return {
      adaptive: this.simulationProfile === "background",
      outerSteps: stats.outerSteps || 0,
      coarseSteps: stats.coarseSteps || 0,
      fineSteps: stats.fineSteps || 0,
      extraSteps,
      fineSeconds: Number((stats.fineSeconds || 0).toFixed(1)),
      fineSharePct: Number(
        ((stats.fineSeconds || 0) * 100 / Math.max(SIM.DT, this.t || 0)).toFixed(1)
      ),
      extraStepSharePct: Number(
        (extraSteps * 100 / Math.max(1, stats.outerSteps || 0)).toFixed(1)
      ),
      reasons: { ...(stats.reasons || {}) },
    };
  }

  tacticalShapeEvidence({ compact = false } = {}) {
    const round = (value, digits = 1) => {
      const scale = 10 ** digits;
      return Math.round((Number(value) || 0) * scale) / scale;
    };
    const summarize = (side) => {
      const totalSeconds = Math.max(SIM.DT, Number(side.totalSeconds) || 0);
      const phaseSeconds = Object.fromEntries(
        Object.entries(side.phaseSeconds).map(([phase, seconds]) => [phase, round(seconds)])
      );
      const phasePct = Object.fromEntries(
        Object.entries(side.phaseSeconds).map(([phase, seconds]) => [
          phase,
          round(seconds * 100 / totalSeconds),
        ])
      );
      const phaseFormations = [...side.phaseFormations.entries()]
        .map(([key, seconds]) => {
          const separator = key.indexOf(":");
          return {
            phase: key.slice(0, separator),
            formation: key.slice(separator + 1),
            seconds: round(seconds),
            pct: round(seconds * 100 / totalSeconds),
          };
        })
        .sort((left, right) => right.seconds - left.seconds || left.phase.localeCompare(right.phase));
      const summary = {
        totalSeconds: round(totalSeconds),
        phaseSeconds,
        phasePct,
        phaseFormations,
      };
      if (!compact) {
        summary.averagePositions = [...side.positions.values()]
          .filter((position) => position.samples > 0)
          .sort((left, right) => right.samples - left.samples || String(left.playerId).localeCompare(String(right.playerId)))
          .slice(0, 11)
          .map((position) => ({
            playerId: position.playerId,
            name: position.name,
            number: position.number,
            role: position.role,
            x: round(position.x / position.samples),
            y: round(position.y / position.samples),
            samples: position.samples,
          }));
      }
      return summary;
    };
    return {
      version: 1,
      source: "spatial-samples",
      sampleIntervalSeconds: 1,
      compact: !!compact,
      home: summarize(this._shapeEvidence.home),
      away: summarize(this._shapeEvidence.away),
    };
  }

  // ——————————————————————————————————————————————
  // 快照：供 matchview 渲染 / 适配层记账
  // ——————————————————————————————————————————————
  snapshot() {
    const defensiveCoordination = Object.fromEntries(
      ["home", "away"].map((team) => {
        const plan = this._defPlans[team];
        const jobs = {};
        for (const job of plan?.jobs?.values?.() || []) {
          jobs[job.type] = (jobs[job.type] || 0) + 1;
        }
        return [team, {
          trigger: plan?.trigger?.kind || PRESS_TRIGGER_KINDS.CONTAIN,
          activePress: !!plan?.trigger?.active,
          ballSide: plan?.ballSide || 0,
          handoffs: plan?.handoffs || 0,
          jobs,
        }];
      })
    );
    return {
      t: this.t,
      // 表现层要跟着换边走（队名标签、边裁半场），不能只靠引擎内部状态。
      // 默认 false，与构造 opts.endsSwapped === true 同形。
      endsSwapped: !!this.endsSwapped,
      ball: {
        x: this.ball.x,
        y: this.ball.y,
        z: this.ball.z,
        owner: this.ball.owner,
        state: this.ball.state || "loose",
        restartType: this.ball.restartType || null,
        controlUntil: this.ball.controlUntil || 0,
        shotAt: Number.isFinite(this.ball.shotAt) ? this.ball.shotAt : null,
        deflect: ballDeflectionOf(this),
      },
      motionContext: motionContextOf(this),
      edgeRules: {
        advantage: this._advantage
          ? {
              team: this._advantage.team,
              reason: this._advantage.reason,
              until: this._advantage.until,
            }
          : null,
        lastVarReview: this._lastVarReview ? { ...this._lastVarReview } : null,
      },
      teamPhases: { ...this.teamPhases },
      defensiveCoordination,
      players: this.agents.map((a) => ({
        id: a.id,
        team: a.team,
        role: a.role,
        detailedPosition: a.detailedPosition,
        positionRating: a.positionRating,
        num: a.num,
        x: a.x,
        y: a.y,
        vx: a.vx,
        vy: a.vy,
        heading: a.heading,
        bodyTargetHeading: a.bodyTargetHeading,
        controlFoot: a.controlFoot,
        controlPhase: a.controlPhase,
        fsm: a.fsm,
        shapePhase: a.shapePhase,
        movementTarget: a.offBallTarget
          ? {
              x: a.offBallTarget.x,
              y: a.offBallTarget.y,
              source: a.offBallTarget.decision,
              kind: a.offBallTarget.kind,
              setAt: a.offBallTarget.setAt,
              until: a.offBallTarget.until,
              ownerId: a.offBallTarget.ownerId,
              ball: a.offBallTarget.ball
                ? { x: a.offBallTarget.ball.x, y: a.offBallTarget.ball.y }
                : null,
            }
          : null,
        defensiveJob: this._defPlans[a.team]?.jobs?.get(a.id)?.type || null,
        hasBall: this.ball.owner === a.id,
        sentOff: !!a.sentOff,
        separationContact: a.separationContactEpoch === this._motionStepEpoch,
      })),
    };
  }
}

/**
 * 仅用于**标定探针**读取突破原语的默认参数（`scripts/_beat-engine-side-sweep.mjs` 等）。
 *
 * ⚠ 这是**只读出口**，不是可调开关：引擎内部一律走模块级 `BEAT` 常量，
 *   或经 `opts.beatTuning` 合并出的实例副本（`this.beatTuning`）。
 *   导出它只为让探针能把「当前默认值」打进标题，便于存档比对。
 *   导出 `undefined` 也安全：引擎侧 `_beatTuning()` 只在该实例自己持有
 *   `beatTuning` 时才用传入值，从不读这个导出。
 */
export { BEAT };
