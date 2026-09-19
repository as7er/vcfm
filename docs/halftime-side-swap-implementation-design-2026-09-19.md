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

---

## 7. 实施记录（2026-09-19 晚，按方案 A）

### 7.1 已完成并验证的部分

| 项 | 位置 | 验证 |
|---|---|---|
| `endsSwapped` 开关（默认 `false`） | `js/sim/engine.js` 构造函数 | — |
| `attackDir` / `targetGoalY` / `ownGoalY` 三入口换边取反 | `engine.js:814/820/834` | `_swap-ends-behavior-check.mjs` 13/13 |
| `_kickoff` 按 `attackingUp` 选式子（含中圈退出） | `engine.js:7931` | 同上 |
| `adapt.js` 阵型位镜像半场感知 | `adapt.js:150-159` | `_swap-ends-resync-check.mjs` 8/8 |
| **调用层接线**（`applyHalfTimeSwap`） | `match.js` async/sync 两入口 | `_swap-ends-wiring-check.mjs` 16/16 |
| `_endsSwappedApplied` 入存档白名单 | `match.js` `PREPARED_MATCH_STATE_FIELDS` | 同上（含读档自愈用例） |

**调用层接线的一个非显然设计点**：`resyncSimAfterHalfTime` 有**两条**触发路径
—— `fromMin === 46`（进下半场）与 `state._simNeedsResync`（换人/换阵）。
**只有前者该开换边**。若把 `eng.endsSwapped = true` 无条件塞进
`resyncSimAfterHalfTime`，用户在 60 分钟换个阵型就会全队当场换边。
因此换边判据单独用 `fromMin === 46`，并有专门的测试用例（wiring 用例 ③）。

**另一个非显然点**：`simEng` **不进存档**（不在 `PREPARED_MATCH_STATE_FIELDS`
里），读档续赛时 `ensureSimEngine` 会新建默认 `endsSwapped=false` 的引擎。
所以「是否已换边」必须记在 `state` 上并回灌（wiring 用例 ⑤）。

**等价性**：`endsSwapped=false` 下 3 场 × 16200 帧 **bit-for-bit 完全相同**
（`scripts/_gody-refactor-bitwise-check.mjs` + `cmp`，退出码 0）。

### 7.2 🔴 范围远大于本设计文档的预估：**41 处方向性坐标推断未收敛**

本设计文档 §2 只列了「三入口 + `_kickoff` + `adapt.js`」四处改动，
默认其余地方会**自动**跟着换边。**这个假设是错的。**

实测：`grep -cE 'team === "home" \?' js/sim/engine.js` = **51 处**。
剔除「球队标识互换」类（`owner.team === "home" ? "away" : "home"`，
与场地方向无关，约 12 处）后，**仍有约 29-41 处是「场地坐标推断」**，
它们**不经过任何统一入口**，换边时会静默错位。典型：

| 行 | 代码 | 语义 |
|---|---|---|
| `:2022` | `a.tx = a.team === "home" ? 1 : 99` | x 坐标（**本就与换边无关，但按队名判是错的**） |
| `:2245` / `:5926` | `towardGoal = b.vy > 1.2 : b.vy < -1.2` | 球是否朝己方门滚 |
| `:2356` | `recv.y < 82 : recv.y > 18` | 接球点边界 |
| `:2375-2376` | `yLo = 30 : 45` / `yHi = 55 : 70` | 跑位 y 区间 |
| `:2384/2388` | `progress` / `beyondOwnHalf` | 前插进度、是否过半场 |
| `:2486` / `:2523` | `boxY = 14 : 86` | 传中 / 任意球禁区锚点 |
| `:2782` | `a.y < 5.5 : a.y > 94.5` | 贴进攻底线 |
| `:3248` | `a.y >= 66 : a.y <= 34` | 后场组织区 |
| `:3353` | `leadY >= offY - 2 : leadY <= offY + 2` | 越位判定 |
| `:4218` | `a.baseY < 52 : a.baseY > 48` | 是否已前插 |
| `:5322/5328/5332` | `y >= 84 : y <= 16` | 己方禁区判定 |
| `:5848` | `fieldDir = gk.team === "home" ? -1 : 1` | 门将场上方向 |
| `:5900/5929/5955` | GK 站位夹取 / 近禁区 / 出击 | 门将 y 逻辑 |
| `:6036/6106` | `bylineDir = ±1` | 己方底线方向 |
| `:6552` / `:6998` | `bodyTargetHeading = ∓π/2` / `gk.heading` | 朝向 |
| `:6832/6857/6876/6877` | `spotY = 12 : 88` / `boxEdgeY = 16 : 84` | 点球、门球、禁区线 |
| `:6691` / `:7143` / `:7193` | 防守禁区 / 点球球门 y / 门球位置 | 定位球 |

### 7.3 实证证据：射门链路换了，但**推进链路只换了一半**

`scripts/_swap-ends-fullmatch-probe.mjs`（3 场 × 90 分钟，同 seed 对照）：

```
seed=611000  不换边 射门位均y 主10.2/客90.7 │ 球均y 33.7（上半36.8/下半30.5）
             换  边 射门位均y 主65.5/客55.2 │ 球均y 45.0（上半36.8/下半53.2）
seed=611001  不换边 射门位均y 主11.8/客89.2 │ 换边 主68.6/客49.1
seed=611002  不换边 射门位均y 主10.1/客91.2 │ 换边 主67.8/客55.2
```

**读法**：

- ✅ 主队射门位置从 y≈10 翻到 y≈67（换边后该攻 y 大侧）—— 射门链路**确实换了**
- ✅ 上半场球均 y 三场完全一致（36.8/36.8、50.1/50.1、43.2/43.2）—— 换边点正确
- ✅ 无异常、无 NaN、进球数正常（最高 5 球）
- 🔴 **客队射门位均 y ≈ 49~55，几乎还在中线** —— 换边后客队该攻 y 小侧，
  但它的**推进链路没全换**，攻不上去，只能在中间勉强起脚

⇒ 这直接证明了 §7.2 的范围问题**不是理论担忧，是能观测到的实际退化**。

### 7.4 结论与建议

**本轮到此为止是正确的**，理由：

1. **风险不对称**：`endsSwapped` 默认 `false`，当前所有比赛行为**逐位不变**
   （已证）。剩下 29-41 处的收敛一旦某处算错就是**静默错位**，而
   `verify.mjs` 要跑 45 分钟才发现回归。
2. **该建立统一工具，而不是逐处改**：这 41 处不同质 —— 有的是方向（用
   `attackDir`）、有的是门位（用 `ownGoalY/targetGoalY`）、有的是 x 轴
   （`:2022` 那种按队名判 x 本身就是错的）。应当先加一个显式的坐标镜像
   辅助（如 `_mirrorY(y)` / `_ownSide(y)`），再逐处替换并**每次跑逐位对比**。
3. **应作为独立一步**：设计文档 §3 已定位为「需要重标定的改动」。

### 7.5 下一步的具体工作清单（已分类，可直接照做）

把这批「场地坐标推断」按模式归成 **4 类**，收敛到 **3 个新入口**：

```js
// 新增三个统一入口（与 attackDir/targetGoalY/ownGoalY 并列）
_sign(team)                    // ≡ attackDir(team)。所有 `dir * …` 的符号
_ownGoalSideY(team, dist)      // 距己方门 dist 处的 y ⇒ 替代 12/88、14/86 一族
_onOwnSide(y, team, refY, cmp) // 该 y 是否已在己方门那侧的参考线之外
```

| 类 | 模式 | 具体位置 | 替换为 |
|---|---|---|---|
| **D1 方向** | `home ? 1 : -1` / `home ? -1 : 1` | `:5848` `fieldDir`、`:6036`/`:6106` `bylineDir`、`:6877` `outward`、`:6552`/`:6998` heading | `_sign(team)` / `-_sign(team)` |
| **D2 门位锚点** | `home ? 12 : 88`、`home ? 14 : 86`、`home ? 16 : 84` | `:6832`/`:6857`/`:7193` `spotY`、`:6876` `boxEdgeY`、`:2486`/`:2523` `boxY` | `_ownGoalSideY(team, d)` / `100 - _ownGoalSideY(team, d)` |
| **D3 区间/阈值判定** | `home ? y >= 84 : y <= 16` | `:5322`/`:5328`/`:5332`、`:6691`、`:3248`、`:2782`、`:2356`、`:5929`、`:5900` | `_onOwnSide(...)`；`:5900` 的 clamp 用 `_ownGoalSideY` |
| **D4 差值/进度** | `home ? a.y - m.y : m.y - a.y` | `:2384` `progress`、`:2388` `beyondOwnHalf`、`:3353` 越位、`:5955` 出击、`:2245`/`:5926` `towardGoal` | `× _sign(team)`；布尔比较用 `_sign` 归一 |

**⚠ 例外：`:2022` `a.tx = a.team === "home" ? 1 : 99`** —— 这是 **x 轴**，
与换边（y 轴镜像）**无关**。按队名判 x 只是命名不当，换边时**不应改**。
但要单独确认它的语义（是「边线方向」还是「某个 x 锚点」），别顺手改错。

**落地纪律**（每一步都要过）：
1. 改完立刻跑 `_gody-refactor-bitwise-check.mjs` ⇒ `endsSwapped=false` 必须**逐位相同**
2. 每收敛一类，跑一次 `_swap-ends-fullmatch-probe.mjs` ⇒ 观察**客队射门位均 y
   是否从 ~50 继续向 y<50 侧移动**（D3/D4 类应主要影响这个读数）
3. 全部收敛后再跑全量 `verify.mjs` + §3 的四项重标定
4. **在客队射门位均 y 翻到 y<50 侧之前，不要把换边暴露给用户**

**推荐顺序**：先做「统一镜像工具 + 逐处收敛」并保持 `endsSwapped=false`
逐位不变 ⇒ 再用 `endsSwapped=true` 跑 §7.3 的探针，直到**客队射门位均 y
翻到 y<50 侧**才算换边真正完整。**在此之前不要把换边暴露给用户**。

---

## 8. 第 3 步实施记录（2026-09-19）：统一镜像工具 + 41 处收敛

### 8.1 新增的统一入口（`engine.js:848-965`）

§7.5 规划了 3 个入口，实际落地成 **6 个**（拆得更细，调用点更好读）：

| 入口 | 语义 | 替代的模式 |
|---|---|---|
| `_sign(team)` | ≡ `attackDir`，方向符号 | `home ? 1 : -1` 一族 |
| `_ownGoalSideY(team, d)` | 距**己方**门 `d` 格的 y | `home ? 12 : 88`、`16/84`、`14/86` |
| `_oppGoalSideY(team, d)` | 距**对方**门 `d` 格的 y | 罚球点、门球位、传中锚点 |
| `_depthFromOwnGoal(y, team)` | 纵深（0=己方门线，100=对方门线） | D4 全部差值/进度比较 |
| `_onOwnSide(y, team, d)` | 是否在「距己方门 `d`」参考线之外（**闭区间**） | `home ? y >= 84 : y <= 16` |
| `_ownGoalSideYClamped(y, team, lo, hi)` | 把纵深夹进 `[lo,hi]` 后转回 y | GK 站位 clamp |

**设计要点**：`_oppGoalSideY` 是刻意加的 —— 点球点/门球位/禁区锚点本来就是
「距**对方**门 N 格」，若强行写成 `100 - _ownGoalSideY(t, 100-N)`，每次读都要
反推符号，正是埋换边漏改种子的地方。

### 8.2 收敛完成情况

**共收敛 26 处**（D1 6 + D2 5 + D3 6 + D4 9），**全部 `endsSwapped=false`
逐位相同**（16200 帧 / 3 场，`cmp` 退出码 0）。

### 8.3 ⛔ 逐位对比抓出的 5 个真实错误（都已修）

这一步的价值全在这里 —— 每一处都是「代数上等价、实际不等价」：

| # | 位置 | 错法 | 修法 |
|---|---|---|---|
| 1 | `_clampOffside` | 目标纵深 `clamp(d, 0, 100)` —— 原式**允许越出场地**（`legalY+buffer` 可到 100.2）。枚举 2626 个组合不一致 | 去掉 clamp |
| 2 | `_clampOffside` | 赋值走 `_ownGoalSideY(team, depth)` 往返 —— 浮点不精确（实测 **45% 取值有 ~7e-15 误差**） | 合法位置在 y 空间取 `min/max`，赋值用 `legalY - _sign*buffer` |
| 3 | `pastGk` | 纵深方向写反：`depth(cy) > depth(gk.y)+1.6` —— 纵深**越大越靠前**，而「越过门将回自己门」是纵深**更小** | 改 `<` |
| 4 | `_penaltyKick` `boxEdgeY` | `100 - _ownGoalSideY(team, 84)` 算反（home 得 84，应为 16） | `_oppGoalSideY(team, 16)` |
| 5 | `_penaltyKick` `outward` | 误当「朝对方门为正」＝ `attackDir`。实际语义是「**背离**对方门」 | `-this._sign(team)` |

**教训**：`outward`/`fieldDir`/`bylineDir` 这类「方向」变量，符号约定**同一个
文件里就有两种**（朝进攻方向 / 背进攻方向）。替换时必须逐个读**使用点**确认，
不能凭注释推。`boxEdgeY` 那次就是被自己的注释带错的。

### 8.4 🔴 关键修正：§7.3 的判据本身是错的

§7.3 / §7.5 用「**客队射门位均 y 是否翻到 y<50 侧**」当完成判据。
**这个判据是错的。** 换边会把 `y` 的含义整个翻过来 —— 拿换边后的**绝对 y**
跟 50 比，比的是「谁站在场地哪一侧」，**不是**「谁攻上去了」。

正确的量是**距己方门的纵深**（swap-invariant，0=己方门，100=对方门）：

```js
const depthOf = (y, team, swapped) => {
  const own = team === "home" ? (swapped ? 0 : 100) : swapped ? 100 : 0;
  return own > 50 ? 100 - y : y;
};
```

**还有第二个坑**：探针累计的 `homeShotYsum` 是**整场**合计，混了上半场
（换边前，主队射门 y≈10）。混合均值 ~49 看着像「没攻上去」，实际**下半场
单算是 87~89**。判据必须**只看下半场**。

修正判据后重测（下半场、按纵深）：

| seed | 换边后 主/客 射门纵深 | 不换边 主/客 |
|---|---|---|
| 611000 | **89.0 / 86.9** | 88.3 / 89.0 |
| 611001 | **87.5 / 87.2** | 90.0 / 90.7 |
| 611002 | **89.1 / 91.7** | 92.3 / 93.0 |

⇒ **两队换边后都打到了对方门前（纵深 ≈88），与不换边组同量级。**
换边没有破坏进攻组织；§7.3 的「客队攻不上去」是**测量错误**，不是引擎缺陷。

**顺带**：全队平均纵深也印证了这一点 —— 不换边时主 55.2/客 31.8（主队按
位置就压上、客队坐深），换边后变成主 43.9/客 43.3，**结构性不对称消失**，
这正是换边应有的效果。

### 8.5 验收状态

- ✅ `endsSwapped=false`：16200 帧**逐位相同**（`cmp` 退出码 0）
- ✅ 换边检查脚本 4 个共 **48 例全过**
- ✅ `_swap-ends-fullmatch-probe.mjs` **6/6 过**（含修正后的射门纵深判据）
- ✅ 全量 `verify.mjs` 通过
- ✅ 版本号 v269 → v270（10 处，含易漏的 `vcfm-sw-reloaded-v270`）

### 8.6 仍未处理（后续）

- **`js/matchview.js` 的 `slotToPitch(slot, isHome)`** 有同一套镜像逻辑的
  副本（§2.4），引擎侧收敛后需同步，否则「引擎换了、画面没换」。
- **`endsSwapped` 尚未接到 UI**：目前只有引擎开关 + 调用层接线，
  还没有任何用户可见的入口。**这是下一步的前置条件。**


