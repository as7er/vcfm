/**
 * 坐标系统工具类
 *
 * 统一处理 matchview 中的坐标变换，减少魔法数字和重复逻辑。
 *
 * 坐标系约定：
 * - 逻辑坐标：0-100 × 0-100（百分比场地，引擎不变）
 * - 主队守 y=100，进攻朝 y=0；客队相反
 * - **下半场换边（`endsSwapped`）只翻 y 轴，x 轴永不翻**：端别一律由 `defendingSide()`
 *   派生，不要再按队名写死（引擎侧对应 `attackDir` / `ownGoalY` / `targetGoalY`）
 * - 画面是横向球场（FM2026）：主队球门在左、客队在右
 * - 逻辑 → 画面：screenX = 100 - y，screenY = x
 * - Canvas 像素坐标：由实际容器尺寸决定
 */

export class MatchCoordSystem {
  /**
   * @param {{ endsSwapped?: boolean }} [opts] `endsSwapped` = 下半场换边（与引擎同名开关一致）。
   *   默认 `false`，与换边前逐位等价；调用方可在拿到引擎帧时用 `setEndsSwapped()` 同步。
   */
  constructor({ endsSwapped = false } = {}) {
    /** 换边状态：true 时「主队守 y=100 那一端」翻成「主队守 y=0 那一端」。 */
    this.endsSwapped = !!endsSwapped;

    // 场地逻辑尺寸（百分比）
    this.FIELD_W = 100;
    this.FIELD_H = 100;

    // 球门位置常量（逻辑坐标）
    // ⚠ HOME_Y / AWAY_Y 是**这两端球门**的名字，常量本身不随换边变；
    // 「哪个队守哪一端」由 defendingSide() 决定。
    this.GOAL = {
      HOME_Y: 96,      // 主队防守的球门线
      AWAY_Y: 4,       // 客队防守的球门线
      X_MIN: 44,       // 球门左柱
      X_MAX: 56,       // 球门右柱
      CENTER_X: 50     // 球门中心
    };

    // 关键区域边界
    this.AREA = {
      // 禁区（六码区）
      BOX_SMALL: {
        HOME: { yMin: 88, yMax: 96, xMin: 40, xMax: 60 },
        AWAY: { yMin: 4, yMax: 12, xMin: 40, xMax: 60 }
      },
      // 大禁区（十八码区）
      BOX_LARGE: {
        HOME: { yMin: 82, yMax: 96, xMin: 28, xMax: 72 },
        AWAY: { yMin: 4, yMax: 18, xMin: 28, xMax: 72 }
      },
      // 中圈
      CENTER: { x: 50, y: 50, radius: 12 },
      // 角旗区
      CORNER: {
        HOME_LEFT: { x: 5, y: 93 },
        HOME_RIGHT: { x: 95, y: 93 },
        AWAY_LEFT: { x: 5, y: 7 },
        AWAY_RIGHT: { x: 95, y: 7 }
      }
    };

    // Canvas 渲染相关（运行时更新）
    this.canvasWidth = 0;
    this.canvasHeight = 0;
    this.pixelRatio = 1;
  }

  /** 同步换边状态（返回 this，便于链式调用） */
  setEndsSwapped(flag) {
    this.endsSwapped = !!flag;
    return this;
  }

  /**
   * 该队**防守的球门**在逻辑坐标的哪一端：`+1` = y 大端（GOAL.HOME_Y 那端），`-1` = y 小端。
   *
   * 换边安全：本模块「队名 → 端别」只在这里推算，其余成员一律由它派生 ——
   * 换边在固定画面里表现为**整场只翻 y**（x 轴永不翻）。
   * 默认档（`endsSwapped = false`）home → `+1`、away → `-1`，与旧行为逐位相同。
   */
  defendingSide(isHome) {
    const base = isHome ? 1 : -1;
    return this.endsSwapped ? -base : base;
  }

  /** 该队**进攻的球门**在哪一端（`defendingSide` 的反面） */
  attackingSide(isHome) {
    return -this.defendingSide(isHome);
  }

  /**
   * 更新 Canvas 尺寸
   */
  updateCanvasSize(width, height, pixelRatio = 1) {
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.pixelRatio = pixelRatio;
  }

  /**
   * 逻辑坐标 → 画面 left/top 百分比（横向球场）
   * 主队球门在左（y=100 → left 0），客队球门在右（y=0 → left 100）
   *
   * 注意：这是**纯画布映射**，与换边无关 —— 换边改的是「谁守哪一端」，
   * 不改 y 轴到屏幕轴的对应关系。
   */
  logicToScreenPct(x, y) {
    return { left: this.FIELD_H - y, top: x };
  }

  /**
   * 逻辑坐标 → Canvas 像素坐标（横向球场：screenX = 100-y，screenY = x）
   * @param {number} x - 0..100
   * @param {number} y - 0..100
   * @returns {{x: number, y: number}}
   */
  logicToCanvas(x, y) {
    const p = this.logicToScreenPct(x, y);
    return {
      x: (p.left / this.FIELD_W) * this.canvasWidth,
      y: (p.top / this.FIELD_H) * this.canvasHeight
    };
  }

  /**
   * Canvas 像素坐标 → 逻辑坐标
   */
  canvasToLogic(px, py) {
    const left = (px / this.canvasWidth) * this.FIELD_W;
    const top = (py / this.canvasHeight) * this.FIELD_H;
    return {
      x: top,
      y: this.FIELD_H - left
    };
  }

  /**
   * 战术槽位 → 场地逻辑坐标
   *
   * 槽位按「己方球门在 y 大端」写，所以只有**己方球门在 y 小端**的一方才翻 y：
   * 默认档是客队，换边后是主队。x 的镜像与换边无关，永远按主客来。
   * @param {{x: number, y: number}} slot - 阵型槽位（0-100）
   * @param {boolean} isHome - 是否主队
   * @returns {{x: number, y: number}}
   */
  slotToPitch(slot, isHome) {
    const x = isHome ? slot.x : this.FIELD_W - slot.x;
    const ownGoalHighY = isHome ? !this.endsSwapped : this.endsSwapped;
    return { x, y: ownGoalHighY ? slot.y : this.FIELD_H - slot.y };
  }

  /**
   * 获取球队的进攻方向（单位向量）
   * @param {boolean} isHome
   * @returns {{dx: number, dy: number}}
   */
  attackDirection(isHome) {
    return {
      dx: 0,
      dy: -this.defendingSide(isHome)  // 主队默认朝 y 减小，换边后反过来
    };
  }

  /**
   * 获取球队防守的球门坐标（换边安全：端别走 defendingSide）
   * @param {boolean} isHome
   * @returns {{x: number, y: number}}
   */
  defendingGoal(isHome) {
    return {
      x: this.GOAL.CENTER_X,
      y: this.defendingSide(isHome) > 0 ? this.GOAL.HOME_Y : this.GOAL.AWAY_Y
    };
  }

  /**
   * 获取球队进攻的球门坐标（= 对手防守的那一端）
   */
  attackingGoal(isHome) {
    return {
      x: this.GOAL.CENTER_X,
      y: this.attackingSide(isHome) > 0 ? this.GOAL.HOME_Y : this.GOAL.AWAY_Y
    };
  }

  /**
   * 判断位置是否在球门内
   * team 给定时指**该队防守的球门**（换边后会换到另一端）
   */
  isInGoal(x, y, team = null) {
    const inGoalX = x >= this.GOAL.X_MIN && x <= this.GOAL.X_MAX;
    if (team === 'home' || team === 'away') {
      return this.defendingSide(team === 'home') > 0
        ? inGoalX && y >= this.GOAL.HOME_Y
        : inGoalX && y <= this.GOAL.AWAY_Y;
    } else {
      // 任意球门
      return inGoalX && (y <= this.GOAL.AWAY_Y || y >= this.GOAL.HOME_Y);
    }
  }

  /**
   * 判断位置是否在禁区内
   * @param {number} x
   * @param {number} y
   * @param {'home'|'away'|null} team - 指定哪个禁区（= 该队防守的那一端），null 表示任意
   * @param {boolean} large - true=大禁区，false=小禁区
   */
  isInBox(x, y, team = null, large = true) {
    const boxes = large ? this.AREA.BOX_LARGE : this.AREA.BOX_SMALL;

    if (team === 'home' || team === 'away') {
      // 换边后该队的禁区换到另一端
      const box = this.defendingSide(team === 'home') > 0 ? boxes.HOME : boxes.AWAY;
      return x >= box.xMin && x <= box.xMax && y >= box.yMin && y <= box.yMax;
    } else {
      // 任意禁区
      return this.isInBox(x, y, 'home', large) || this.isInBox(x, y, 'away', large);
    }
  }

  /**
   * 获取最近的角旗位置（`isHome` 选的是该队**所在那一端**的角旗）
   */
  nearestCorner(x, y, isHome) {
    const corners = this.defendingSide(isHome) > 0
      ? [this.AREA.CORNER.HOME_LEFT, this.AREA.CORNER.HOME_RIGHT]
      : [this.AREA.CORNER.AWAY_LEFT, this.AREA.CORNER.AWAY_RIGHT];

    let nearest = corners[0];
    let minDist = this.distance(x, y, nearest.x, nearest.y);

    for (let i = 1; i < corners.length; i++) {
      const d = this.distance(x, y, corners[i].x, corners[i].y);
      if (d < minDist) {
        minDist = d;
        nearest = corners[i];
      }
    }

    return nearest;
  }

  /**
   * 计算两点距离
   */
  distance(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  /**
   * 限制坐标在场地范围内
   */
  clamp(x, y, margin = 0) {
    return {
      x: Math.max(margin, Math.min(this.FIELD_W - margin, x)),
      y: Math.max(margin, Math.min(this.FIELD_H - margin, y))
    };
  }

  /**
   * 线性插值
   */
  lerp(from, to, t) {
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t
    };
  }

  /**
   * 计算方向角（弧度）
   */
  angleTowards(fromX, fromY, toX, toY) {
    return Math.atan2(toY - fromY, toX - fromX);
  }

  /**
   * 获取庆祝目标位置（角旗）
   * 庆祝端 = **进攻端**（对手守的那一端），换边后跟着翻
   * @param {boolean} scoredHome - 进球方是否主队
   * @param {number} ballX - 进球时球的 x 坐标
   * @returns {{x: number, y: number}}
   */
  getCelebrationCorner(scoredHome, ballX) {
    // 选择更近的角旗
    const atHighY = this.attackingSide(scoredHome) > 0;
    const leftCorner = atHighY ? this.AREA.CORNER.HOME_LEFT : this.AREA.CORNER.AWAY_LEFT;
    const rightCorner = atHighY ? this.AREA.CORNER.HOME_RIGHT : this.AREA.CORNER.AWAY_RIGHT;

    const toLeft = Math.abs(ballX - leftCorner.x);
    const toRight = Math.abs(ballX - rightCorner.x);

    return toLeft < toRight ? leftCorner : rightCorner;
  }

  /**
   * 计算距离球门的距离（用于 xG 计算）
   * @param {number} x
   * @param {number} y
   * @param {boolean} isHome - 射门方是否主队
   * @returns {number} 距离（逻辑坐标单位）
   */
  distanceToGoal(x, y, isHome) {
    const goal = this.attackingGoal(isHome);
    return this.distance(x, y, goal.x, goal.y);
  }

  /**
   * 判断射门角度（0-1，越大越正对球门）
   */
  shootingAngle(x, y, isHome) {
    const goal = this.attackingGoal(isHome);
    const leftPost = { x: this.GOAL.X_MIN, y: goal.y };
    const rightPost = { x: this.GOAL.X_MAX, y: goal.y };

    const angleLeft = this.angleTowards(x, y, leftPost.x, leftPost.y);
    const angleRight = this.angleTowards(x, y, rightPost.x, rightPost.y);

    // 两门柱夹角越大，射门角度越好
    // 注意：atan2 的值域是 [-π, π]，跨越 π/-π 边界时需要特殊处理
    let span = angleRight - angleLeft;
    // 如果跨越了 ±π 边界，调整
    if (span < -Math.PI) span += 2 * Math.PI;
    if (span > Math.PI) span -= 2 * Math.PI;
    span = Math.abs(span);

    return Math.min(1, span / (Math.PI * 0.3)); // 归一化到 0-1
  }
}

// 导出单例（换边状态由调用方 setEndsSwapped；默认 false = 与换边前逐位等价）
export const coordSystem = new MatchCoordSystem();
