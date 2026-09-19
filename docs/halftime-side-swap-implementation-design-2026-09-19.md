# 下半场换边：实施方案设计（第 2 步）

> 承接 `docs/halftime-side-swap-verification-2026-09-16.md`。
> 该文档的第 1 步（收敛 10 处硬编码球门坐标）**已完成**，见 commit
> `b50adc7`。本文是**第 2 步的设计**，尚未实施。

## 0. 一句话

引擎里「半场」的概念**只存在于调用层**（`js/match.js` 按 `fromMin >= 46`
切分），而引擎自身**不知道** `this.t` 到多少算中场。所以换边最省事、
也最符合现有架构的做法是：**由调用层在中场时刻显式通知引擎换边**，
而不是让引擎自己按时间推断。

## 1. 现状盘点（已查证的硬事实）

### 1.1 调用层已经有一个天然的「中场」钩子

| 位置 | 内容 |
|---|---|
| `js/match.js:1393` | `if (fromMin === 46 \|\| state._simNeedsResync) resyncSimAfterHalfTime(state)` |
| `js/match.js:1647` | `if (fromMin >= 46) resyncSimAfterHalfTime(state)` |
| `js/sim/adapt.js:83` | `export function resyncSimAfterHalfTime(state)` |

⇒ **`resyncSimAfterHalfTime` 已经是「下半场开始」的唯一入口**，
换边必须挂在这里（或与之并列），否则会出现「阵型位换了但方向没换」的撕裂。

### 1.2 但 `resyncSimAfterHalfTime` 会把阵型位无条件重置回固定半场

`js/sim/adapt.js:150-159`：

```js
let bx = slot.x;
let by = slot.y;
if (!isHome) {
  bx = 100 - bx;
  by = 100 - by;
}
a.baseX = bx;
a.baseY = by;
a.slotX = slot.x ?? 50;
a.slotY = slot.y ?? 50;
```

**没有半场维度** —— 这会把「主队守下方 / 客队守上方」写死回去。
⇒ 只加 `attackDir` 翻转而不改这里，下半场一开球就被打回原形。

### 1.3 引擎没有比赛时长概念

`grep MATCH_SECONDS js/` = **0 处**。`this.t` 是无限累加的模拟时钟，
引擎被外部 `step()` 驱动，**不知道 45 分钟在哪**。
（唯一的 `45 * 60 + 1` 出现在 `js/match.js:1410/1655`，是**解说文案的
分钟数换算**，不是半场逻辑。）

### 1.4 `state.simEngineMeta.halves` 与换边无关

`js/sim/adapt.js:69-75` 定义 `halves: []`，`js/match.js:1459/1676` 往里
push 每半场的积分统计。**是诊断元数据**，不参与换边。

## 2. 改动清单（按依赖顺序）

### 2.1 引擎侧：加一个显式的换边开关（不改默认行为）

```js
// 构造函数附近
this.endsSwapped = opts.endsSwapped === true;   // 默认 false ⇒ 行为逐位不变
```

然后把两个入口改造成「带半场」：

```js
attackDir(team) {
  const base = team === "home" ? -1 : 1;
  return this.endsSwapped ? -base : base;
}

targetGoalY(team) {
  const base = team === "home" ? SIM.AWAY_GOAL_Y : SIM.HOME_GOAL_Y;
  return this.endsSwapped ? 100 - base : base;   // 0 ↔ 100
}

ownGoalY(team) {
  const base = team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
  return this.endsSwapped ? 100 - base : base;
}
```

**为什么用 `100 - base` 而不是写死另一组常量**：两个球门 y 恰好是 `0` 与
`100`，互换即 `100 - y`。这样换边逻辑与具体常量解耦，将来若球场坐标
改尺度也只需改一处。

### 2.2 引擎侧：`_kickoff` 按半场选式子

```js
// 现在（硬编码 home 在下半场）
a.y = a.team === "home" ? 50 + a.baseY * 0.48 : a.baseY * 0.48;

// 改后：用「该队此刻是否朝 y 小进攻」判断，而不是用队名
const attackingUp = this.attackDir(a.team) < 0;   // 朝 y 小 = 在上半场那侧
a.y = attackingUp ? 50 + a.baseY * 0.48 : a.baseY * 0.48;
```

同时中圈退出（`:7919-7922`）也要跟着翻转：

```js
if (a.team !== team) {
  // 非开球队退出中圈：朝自己的半场方向退
  a.y = this.attackDir(a.team) < 0 ? Math.max(a.y, 59.5) : Math.min(a.y, 40.5);
}
```

### 2.3 调用层：中场时设开关 + 重置阵型位

在 `resyncSimAfterHalfTime` 里：

```js
eng.endsSwapped = true;                  // 或按主办方规则取反
```

并且把 `adapt.js:150-159` 的阵型位映射改成**感知半场**：

```js
let bx = slot.x;
let by = slot.y;
// 客队永远镜像；主队在下半场也被镜像 —— 等价于「是否守下方」
const mirrored = isHome ? eng.endsSwapped : !eng.endsSwapped;
if (mirrored) {
  bx = 100 - bx;
  by = 100 - by;
}
```

**注意**：这里不能让 `baseY` 既是「槽位纵深」又是「绝对位置」。
当前 `baseY` 语义是**绝对 y 坐标**（已经镜像过的），所以镜像条件要按
「该队此刻是否守 y=100 那侧」来算。这是最容易搞错的一处，需要单独
逐位验证（见 §4）。

### 2.4 表现层（可选，建议同期做）

`js/matchview.js` 的 `slotToPitch(slot, isHome)` 有同样的镜像逻辑，
`_spawnTeam` 时用一次。换边后若球员重建，需同步。另外可用现成的
`SEGMENT_CUT_MS`（260ms 淡场）表现「下半场开始」。

## 3. 会改随机流的风险点（必须重标定）

| 影响面 | 为什么 |
|---|---|
| **进球率** | `attackDir` 翻转后，`_chooseAttackOffBallTarget` 的 `dir` 变了 ⇒ 所有 `dir * ...` 目标点全变 ⇒ 随机流分叉 |
| **强弱分离** | 同上（`CB_BLOCK_SHIFT` 一族依赖 `prog`，而 `prog` 依赖 `ownGoalY`） |
| **`beat` 带宽** | `beat` 的护栏带宽是在旧随机流下标定的，会失效 |
| **队形形状审计** | `attack-shape-compaction-audit` 的基线（己方 37.0 / 中场 37.8 / 进攻三区 63.3~63.8）是在「不换边」下标定的 |

⇒ 实施后必须跑**全量 `verify.mjs`**（43~47 分钟）并复核上述四项。
按项目纪律，这属于「需要重标定的改动」，不能只跑局部审计。

## 4. 验收方法（本次已具备条件）

**用 `scripts/_gody-refactor-bitwise-check.mjs` 的逐位对比能力**，
但换边场景需要新写一个变体：

1. **等价性验证**（必须通过）：`endsSwapped = false` 时，与改前**逐位相同**。
   这是「不破坏默认档」的硬门槛。
2. **换边正确性验证**：设 `endsSwapped = true` 后：
   - `attackDir("home")` 应为 `+1`
   - `_kickoff` 摆位后 home 的 y 中位数应在 **< 50** 侧，away 在 **> 50** 侧
   - 全场 `homeY` 均值应显著高于上半场（而不是现在的「都在 50 附近」）
3. ⚠ **必须先确认随机源正确注入**（`opts.random`，不是 `opts.seed`
   —— 引擎不认后者，见 `docs/measurements/` 与 MEMORY.md 的「环境坑」）。

## 5. 建议的推进顺序

1. **本次已完成**：收敛 10+ 处硬编码球门坐标（commit `b50adc7`，逐位验证通过）
2. **下一步（需你确认）**：加 `endsSwapped` 开关 + `_kickoff` 按方向选式子
   + `adapt.js` 阵型位镜像感知。**先用 `endsSwapped=false` 做逐位等价验证**，
   确认零影响后再验证 `true` 的行为。
3. **重标定**：全量 `verify.mjs` + 进球率/强弱分离/beat 带宽复核
4. **表现层**：复用 `SEGMENT_CUT_MS` 淡场表现「下半场开始」

## 6. 一个待你决策的契约问题

**「谁来决定换边」**，两种设计：

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A（推荐）** | 调用层在中场调 `eng.endsSwapped = true`（或 `eng.swapEnds()`） | 引擎保持「不知道比赛时长」的现有架构；调用层本来就有中场钩子 | 引擎多一个可变状态位 |
| **B** | 引擎收 `halfSeconds` 参数，内部按 `this.t` 自动翻 | 「换边」变成引擎内建概念 | 引擎开始依赖「比赛时长」，与现有「外部驱动」架构冲突；且加时赛/点球大战会复杂化 |

**我推荐 A** —— 因为 `resyncSimAfterHalfTime` 这个中场钩子**已经存在**，
换边挂上去是最小改动；而 B 会让引擎从「纯物理+行为模拟器」变成
「知道赛制的东西」，这是架构上的降级。
