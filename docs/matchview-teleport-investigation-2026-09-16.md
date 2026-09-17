# 比赛画面的「瞬移」—— 排查报告（2026-09-16）

> 用户原话：**「比赛画面中过渡的问题。感觉球员，球，裁判，基本上都是瞬移。
> FM 那些游戏中好像都没有画面过渡的时候出现瞬移」**

## 0. 结论摘要

| 问题 | 结论 | 证据 |
|---|---|---|
| 段内的球员/球/裁判运动是否平滑？ | **是，完全平滑** | 三个独立探针，见 §2 |
| canvas 与 DOM 两套坐标是否对齐？ | **是，误差 0.00 px** | §2.4 |
| 播放速率是否正确？ | **是，1.005×，帧间隔恒为 0.1 s** | §3 |
| 有没有真正的瞬移？ | **有，且规模极大：段边界整场换景** | §4 |
| 是否由前几轮改动引入？ | **不是**，`soft:false` 硬切是既有设计 | §4.3 |

**一句话**：段**内**的插值是教科书级的正确；瞬移发生在段**与段之间**——
每个高光段入场时，`playSimTimeline` 用一次 `soft:false` 的硬切把 **26 个实体**
（22 球员 + 球 + 3 官员）直接按到新窗口的第 0 帧上。

**实测最坏一例**（`_segment-boundary-probe`，40 s 采样）：

```
segment-start → label "chance", simT 754.1
  movedOver1m: 26 / 26
  movedOver3m: 26 / 26        ← 全部 26 个实体
  medianM:     44.9           ← 位移中位数 45 米
  maxM:        83.36          ← 球瞬移 83 米
上一段结束于 simT = 14 s，下一段起始于 simT = 754.1 s
  → 一帧之内穿越 740 比赛秒（12 分 34 秒）
```

这不是「过渡不够顺」，而是**切镜头没有做出切镜头的表现**：
观众看到的是「22 个人集体凭空换位」，而他期待的是 FM 那种
「上一条镜头结束 → 下一条镜头开始」的显式剪辑。

## 1. 为什么前面的审计没发现

仓库里已有的连续性审计都在查**引擎状态**（对速度阈值）和**显示 vs 引擎**
（对位置差）。这两类都在问「状态对不对」，而用户的抱怨是「看起来顺不顺」。
一个**只按模拟速率写坐标、却按 60 fps 重绘**的表现层可以同时通过这两类审计
而依然看着一顿一顿。所以本轮不问状态，直接量眼睛看到的东西。

## 2. 段内平滑度：四个探针，全部通过

### 2.1 主探针 `scripts/_match-smoothness-probe.mjs`

采样 `matchView.players / ball / officials` 的**视图坐标**（不是 DOM style——
比赛屏恒处于 `mp-canvas-mode`，DOM 球员是透明热区，`left/top` 不是被画出的位置）。

20 s、1193 帧、`mp-canvas-mode` 确认开启：

| 实体 | fps | zeroMovePct | distinctPerSec | stepMedianM | stepP95M | stepMaxM | >1 m | >3 m |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ball | 59.7 | 7.1 | 55.4 | 0.046 | 0.303 | 0.585 | 1 | 1 |
| player (4 名) | 59.7 | 0.5–2.2 | 48.2–59.3 | 0.004–0.080 | 0.051–0.089 | 0.095–0.241 | 1 | 0–1 |
| referee | 59.7 | 7.1 | 55.2 | 0.022 | 0.025 | 0.068 | 1 | 1 |
| assistantA | 59.7 | 3.1 | 44.5 | 0.005 | 0.057 | 0.077 | 1 | 0 |
| assistantB | 59.7 | 0.5 | 57.3 | 0.049 | 0.063 | 0.171 | 1 | 1 |

**判读**：没有一条签名成立。zeroMovePct 低（不是「模拟率阶梯」），
`distinctPerSec ≈ fps`（有效更新率等于帧率），`>3 m` 的尾巴基本为 0
（`>1 m` 各 1 次，1193 帧里的孤立点，不是「genuine teleports」的分布）。

### 2.2 裁判专项 `scripts/_official-smoothness-probe.mjs`

因为用户点名了裁判，单独再测一次，并额外做**遮挡判定**
（官员是 DOM `.mp-official`，z-index 2；canvas z-index 3，先怀疑被盖住）：

```json
{"key":"referee","writes":1195,"writesPerSec":59.7,
 "metersPerWriteMedian":0.022,"metersPerWriteP95":0.023,"metersPerWriteMax":2.979,
 "zeroMovePct":6.8,"over1m":1,"over3m":0,"over6m":0}
{"key":"assistantA","metersPerWriteMedian":0.002,"over1m":0,"over3m":0}
{"key":"assistantB","metersPerWriteMedian":0.033,"over1m":1,"over3m":0}
```

遮挡判定结果：`referee.visible = true`、`opacity = 1`、`zIndex.official = 2`
但 **`hit: "div.mp-actors"` 而不是官员自己**。不过这**不是**「被 canvas 盖住」——
`.mp-officials` 与 canvas 都在 `.mp-camera` 内，且官员是 `pointer-events: none`，
所以 `elementFromPoint` 穿过它命中了父容器。**视觉上官员是可见的**
（`_applyOfficials()` 把 `left/top` 写进 `.mp-actors`，父容器 z-index 4 > canvas 3）。

**结论**：裁判没有瞬移；每个写入位移 0.022 m、p95 0.023 m，非常均匀。
换算约 1.31 m/s，落在 `OFFICIAL_DRIFT_STEP_M`(0.15 m/0.1 s = 1.5 m/s) 设计的量级内。

### 2.3 可见性 `scripts/_actor-visibility-probe.mjs`

怀疑是「演员被画到镜头外、随镜头推拉而忽隐忽现」。25 个实体
（22 球员 + 球 + 3 官员），1202 帧：

```
key                     frames  insidePct  inOutTransitions  maxOffPx  widthPx
P:pl_893_u4610            1202        100                 0         0     30.7
... (全部 25 行都是 100 / 0 / 0 / 0) ...
O:referee                 1202        100                 0         0       23
O:assistantA              1202        100                 0         0     20.5
O:assistantB              1202        100                 0         0     20.5
```

25 个实体**全部 100% 帧在镜头矩形内、零次进出**。假说排除。
（顺带确认：`scale 1.28` 时可见窗口是球场的 87.8% × 78.1%，
横向 pan 钳制 ±10.4、纵向 ±16.6 格。）

### 2.4 图层对齐 `scripts/_layer-alignment-probe.mjs`

架构（读代码 + 实测确认）：

```
.mp-field                (aspect-ratio 68/93.45)
└ .mp-camera             (left/right 5.5%; transform: translate(x%,y%) scale(s))
    ├ .mp-grass/.mp-lines/...      球场美术，用 0-100 %
    ├ canvas.mp-canvas            球员+球，px=(x/100)*_cw
    └ .mp-actors                  官员，left/top %
```

两层都在同一个被 transform 的盒子里，**理论上**应当一致；但 `_resizeCanvas()`
用的是 `fieldEl.clientWidth/Height`，而 canvas 元素是 `.mp-camera` 的 `inset:0`。
两个盒子不等宽（`cameraClient 493` vs `fieldClient 553`），所以这是个真实风险。

实测（把球场坐标 X=25,Y=25 分别按两层映射成页面像素）：

```json
"sample": {"X":25,"Y":25,"domX":293.95,"domY":702.37,
           "cvX":293.95,"cvY":702.37,"dx":0,"dy":0}
```

**误差 0.00 px。** 再用真实球员位置反算（LIVE 档，`scale = 1.27993`）：
`pl_892` 引擎 `(50, 94.056)` → 实测 DOM 中心 `(332.6, 932.7)`；
模型 `camLeft + (X/100)*camWidth = 17.33 + 0.5*630.49 = 332.6`。**完全吻合。**

→ 映射模型确认：**球场坐标 X 落在 `camLeft + (X/100) * camWidth`**。
canvas 层与 DOM 层是同一个变换，不存在错位。

## 3. 播放速率：正确（并修正一处上轮误读）

`scripts/_timeline-frames-probe.mjs` 直接 dump 直播时间轴的帧表与游标：

```json
{"frameCount":285,"tFirst":0.1,"tLast":28.5,"spanSec":28.4,
 "gapMin":0.1,"gapMedian":0.1,"gapP95":0.1,"gapMax":0.1,
 "gapsOver1s":0,"gapsOver5s":0,"label":"goal","rate":1}

=== playback rate per contiguous run ===
{"wallSec":6.94,"simSec":6.97,"simPerWall":1.005,"framesConsumed":69,
 "framesPerWallSec":9.9,"avgGapSec":0.101,"holds":0,"rate":1,"rateMul":1,"speed":1}

{"gapWhilePlaying":{"n":402,"min":0.1,"median":0.1,"max":0.1}}
```

- **`simPerWall = 1.005`** —— 恰好 1× 实时。
- **帧间隔 min/median/max 全是 0.1 s**，`gapsOver1s = 0` —— 不存在
  「跨一个几秒的缺口做线性插值」那种会让所有实体以恒定假速度滑行的情形。
- `rate = 1, rateMul = 1, speed = 1`，`holds = 0`。

⚠ **修正上一轮的一处误读**：`_match-smoothness-probe` 早先报过
`simSecondsAdvanced: 252.05, simRate: 12.6`，看上去像「12.6 倍速」。
**那是探针自身的量测错误**：`_simPlay.simT` 在每一段开始时被重置为窗口起点
（`matchview.js:784` 的 `simT: t0`），所以跨段做 `last - first` 没有意义——
它实际量到的是「最后一个窗口的绝对起点」，不是播放倍率。
本轮的 `_timeline-frames-probe` 改成**按连续段分段计算**，
得到 1.005×，才是真实倍率。

**教训（与 AGENTS.md 里「阈值效应 vs 真实效应」同类）**：
**一个会重置的游标不能跨重置点做差分。**

## 4. 真正的瞬移：段与段之间的入场硬切

既然段内一切正常，剩下的候选就是**段边界**。代码上有个明确的硬切：

```js
// js/matchview.js:809  —— playSimTimeline() 的开场
this.applySimSnapshot(frames[0], { soft: false });   // soft:false = 不做指数平滑
```

而 `applySimSnapshot` 的 `relocate()` 缓动路径要求
`adjacent && restartFrame`（相邻帧 + 重启语义）才武装；
段**首帧**必然判定为 `sceneCut`（`_relocLastSimT` 是上一段的陈旧值），
`sceneCut` 分支直接 `entity._relocAt = 0` → **不缓动**，
于是 `pl.x = tx` 一步到位。

再叠加窗口几何：`buildHighlightWindows` 里进球窗是
`t0 = t - lead`（有助攻 lead=10，无助攻 lead=8）、`t1 = t + 6`。
所以一个 285 帧的进球窗覆盖 `0.1 → 28.5` 比赛秒，
而**进球在第 8 秒**——窗口是从「完全无关的另一处球场位置」开场的。

⇒ **每个高光段入场时，25 个实体一起做一次瞬时的、多米的、无缓动的位移。**
这场比赛的段数是 5 类窗口（goal / save / 威胁射门 / 角球 / 开球）× 各自的次数，
一场下来观众会看到几十次这种「切镜头式」的整场跳变，正对应
「球员、球、裁判基本上都是瞬移」的观感。

**验收探针**：`scripts/_segment-boundary-probe.mjs` ——
监视每一次 `_simPlay` 身份切换，记录切换瞬间每个实体的屏幕位移、
以及 `>1 m` / `>3 m` 的实体数。

### 4.1 实测结果（40 s 采样，3 次边界事件）

```json
{"kind":"segment-start","from":null,
 "to":{"label":"kickoff","i":0,"simT":0.1,"n":140,"t0":0.1},
 "movedCount":26,"movedOver1m":6,"movedOver3m":5,
 "medianM":0.32,"maxM":24.24,
 "top5":[{"k":"P:pl_902_4kes9","m":24.24},{"k":"O:assistantA","m":21.21},
         {"k":"O:assistantB","m":18.7},{"k":"P:pl_909_5qowg","m":9.98},
         {"k":"O:referee","m":5.87}]}

{"kind":"segment-end","from":{"label":"kickoff","i":139,"simT":14,"n":140},"to":null,
 "movedCount":26,"movedOver1m":0,"movedOver3m":0,"medianM":0.01,"maxM":0.04}

{"kind":"segment-start","from":null,
 "to":{"label":"chance","i":0,"simT":754.1,"n":191,"t0":754.1000000001029},
 "movedCount":26,"movedOver1m":26,"movedOver3m":26,
 "medianM":44.9,"maxM":83.36,
 "top5":[{"k":"ball","m":83.36},{"k":"P:pl_1316_vlixf","m":80.29},
         {"k":"P:pl_906_fi6bx","m":74.53},{"k":"P:pl_895_pe7nn","m":73.66},
         {"k":"P:pl_1306_9sb1o","m":70.68}]}
```

**逐条判读**：

| 事件 | 判读 |
|---|---|
| ① `segment-start` kickoff | 从**赛前静态站位**进入首个高光段；中位 0.32 m，只有 5 个实体 >3 m（官员回位 + 1 球员）。**基本可接受**——这是「比赛开始」，画面本来就该有一次重置。 |
| ② `segment-end` kickoff | 中位 **0.01 m**、最大 **0.04 m**、`over3m = 0`。**完全干净** —— 段结束本身不产生位移。 |
| ③ `segment-start` chance | **26/26 全部 >3 m，中位 44.9 m，球 83.36 m。** 上一段结束于 `simT = 14`，这一段起始于 `simT = 754.1` → **一帧跨 740 比赛秒**。 |

⇒ **瞬移 100% 集中在 `segment-start`（段入场），且第 ③ 条就是用户抱怨的现象。**

### 4.2 为什么规模能到 80 米

一个高光窗覆盖的是**进球/射门前后的十几秒**，而两段之间隔着**几分钟到十几分钟**
的比赛时间（这里 740 s）。`applySimSnapshotLerped` 的**段内**插值再完美，
也管不到段与段之间——因为 `playSimTimeline` 在段首直接调用

```js
this.applySimSnapshot(frames[0], { soft: false });   // matchview.js:809
```

`soft:false` 让 `smooth = 1`，于是 `pl.x = tx` 一步到位；同时段首必然被判为
`sceneCut`（`_relocLastSimT` 还是上一段的陈旧值），`relocate()` 的缓动分支
要求 `adjacent && restartFrame` 才武装，`sceneCut` 时反而先把 `_relocAt` 清零
→ **缓动被显式关掉**。

所以「45 米/帧」不是插值失败，而是**设计上就没打算让段间连续**。

### 4.3 是否由前几轮改动引入？—— 不是

`soft: false` 这一行、以及 `sceneCut` 的判定语义，本轮**未改动**（`git diff` 干净）。
这是既有设计：高光模式下两段之间本来就是「跳到下一段」，只是**没有配任何转场**。
用户这次提出来，是因为它看起来像 bug，而实际上是**缺失的表现层功能**。

这也是为什么前面四轮 UI/颜色/字号的工作都没有触碰到它——
那些改的是样式令牌，这条是**播放时间线的转场语义**。

## 5. 修复：段入场一律显式剪辑

### 5.1 为什么「一律缓动」是错的

第一直觉是「把 `soft` 打开、让它滑过去」。**这是错的**，而且会更难看：

| 间隔 | 位移 | 若一律用 0.7 s 缓动 | 实际 |
|---|---:|---|---|
| 相邻窗（十几秒） | 几米 | 几米 / 0.7 s ≈ **5–10 m/s** | 尚可 |
| 实测间隔（>100 s） | 中位 44.9 m、球 83.4 m | 45 m / 0.7 s ≈ **64 m/s** | **整队以 64 m/s 扫过球场** |

64 m/s 是 230 km/h。那比硬切糟糕得多：硬切至少是「一瞬间」，而缓动会把
荒谬的速度**持续展示 0.7 秒**。

### 5.2 分档方案被实测否决：ease 分支是死代码

先实现的是「按间隔分档」：`gap ≤ 20 s → 缓动`，`gap > 20 s → 剪辑`。
**但整场普查（`scripts/_segment-gap-census.mjs`）把这个方案证伪了**：

```json
SEGMENTS 4
{"label":"kickoff","t0":0.1,   "t1":14.0,   "gapFromPrev":null}
{"label":"chance", "t0":970.8, "t1":989.8,  "gapFromPrev":956.8}
{"label":"save",   "t0":1119.3,"t1":1138.3, "gapFromPrev":129.5}
{"label":"chance", "t0":1527.6,"t1":1546.6, "gapFromPrev":389.3}

BUCKETS   {"<=0.5s":0,"0.5-20s":0,"20-60s":0,"60-180s":1,">180s":2}
STATS     {"trueGaps":3,"gapMedian":389.3,"gapP90":956.8,"gapMax":956.8}
THRESHOLD {"cut":3,"ease":0,"cutPct":100}
```

**真实间隔是 129.5 / 389.3 / 956.8 秒，3 个全部落在长档。**
最近的一对（129.5 s）也是门限的 **6.5 倍** → **ease 分支永远不可能触发。**

原因在窗口构造本身：每个高光窗只覆盖约 **19 秒**比赛时间
（`buildHighlightWindows`：进球 lead 8 / trail 6，扑救还要求 `farFromExisting(25)`，
射门按威胁度分散挑），而两窗之间必然隔着几分钟。
「两段本来就连续」这种情形**在数据上不存在**。

⇒ **已把 ease 分支删除**，代码里只留剪辑一条路径。
（保留一个永不触发的分支比没有分支更糟：它会让后来的人以为存在两种行为。）
`git diff --stat` 现在是 **107 insertions / 0 deletions**，纯新增。

### 5.3 最终实现

**cut**：不去伪造位移连续性，而是加一次**显式的剪辑提示**——
`.mp-seg-cut` 在球场层上播 260 ms 的淡场（`@keyframes mp-seg-cut-fade`），
把这 0.26 s 讲成「换了条镜头」。这与 `playHighlightPlanBridge` 里已有的
「⏩ 跳过平淡」是同一套语汇（那里也承认「确实跳过了内容」）。
`prefers-reduced-motion: reduce` 时不做淡入，直接切。

**首段不剪辑**：`_segLastEndSimT` 为 `null` 时返回 `first`，不放淡场——
比赛开场本来就是一次「从无到有」，再叠一个剪辑提示是多余的。

官员不需要单独处理：它们和球员同处 `.mp-camera` 内，剪辑的淡场覆盖整个球场层。

### 5.4 改了什么（文件与行）

| 文件 | 改动 |
|---|---|
| `js/matchview.js` | 新增常量 `SEGMENT_CUT_MS`(260) |
| `js/matchview.js` | 新增 `_enterSegmentTransition()` / `_playSegmentCut()` |
| `js/matchview.js` | `playSimTimeline`：段首硬切前调用转场；记录 `_segLastEndSimT` |
| `js/matchview.js` | 构造器与 `_build` 各加 2 个新状态字段（`_segLastEndSimT` / `_segCutTimer`） |
| `css/style.css` | 新增 `.mp-field.mp-seg-cut::before` + `@keyframes mp-seg-cut-fade` |

**没有改**：`soft:false` 的段首调用本身保留（段首仍需一次「落到正确坐标」的赋值，
只是现在长间隔会配一次剪辑提示）。
`applySimSnapshot` / `_updateOfficials` **完全没动**——ease 分支删掉后，
`entryEase` 那套对这个函数的改动也一并回退了。

### 5.5 判定的边界情形（已用纯函数逐条验证）

| 上一段结束 | 本段 t0 | 结果 | 情形 |
|---:|---:|---|---|
| `null` | 0.1 | `first` | 本场第一次入场（开球），不剪辑 |
| 14 | 754.1 | `cut` | 实测的 740 s 间隔 |
| 14 | 14 | `first` | 同一窗重播（gap 非正） |
| 100 | 90 | `first` | 乱序（gap 为负） |
| 100 | 121 | `cut` | 正常跨段 |

### 5.7 验收日志里两条「反常记录」的归因（已查清，非 bug）

首轮 `_segment-cut-verify.mjs` 的 `ENTRIES` 里有两条与设计不符，逐一追到源头后
确认**都是进球自动重播的合法表现，不是 `_segLastEndSimT` 被意外重置**：

```
entry 1  mode "cut"  gapSec 0.1    ← 期望 "first"
entry 3  mode "first" gapSec null  ← 期望 "cut"（t0 = 217 在比赛里）
```

`scripts/_segment-entry-trace.mjs` 跑 200 秒（10 次入场：1 kickoff + 4 goal +
2 chance + 1 save + 3 replay）后，完整归因链如下：

**1. entry 1 其实是 kickoff，`prevEnd` 就是 `null`。** 逐条记录显示：

```
kickoff  prevEndRaw=null  relocRaw=null  t0=0.1     -> cut      ← 本场第一次入场
goal     prevEndRaw=num   relocRaw=num   t0=21.2    -> cut      ← gap 7.2 目标未达成
replay   prevEndRaw=num   relocRaw=num   t0=25.8    -> first    ← 倒带，gap -11.4
goal     prevEndRaw=num   relocRaw=num   t0=387.1   -> cut      ← gap 354
```

`prevEndRaw="null"` 说明**首段判定完全正确**。上一轮看到的 `gapSec 0.1` 不是首段的
记录，而是那轮里另一个**退化重播切片**：`playFmmGoalReplay` 构造的切片若只剩一帧，
`t0 = tEnd0 - 0.1`，于是 `gap = 0.1` 被读成 `cut`。切片自己首尾只差 0.1 s，
与「跨段跳过」无关。

**2. entry 3 是「倒带」被读成了「重置」。** 三次 `replay` 入场的 gap 分别是
**-11.4 / -11.4 / -11.5**，全部落在 `gap ≤ 0` → `first` 分支。
倒带来自 `playFmmGoalReplay`（`matchview.js:5866`）：它把切片收尾在 `climax+2`，
起点在 `climax-5.5`，所以重播的 `t0` 必然**早于**上一段结束。

**3. 游标采样排除了「重置」假设。** 每帧采样的 `_relocLastSimT`（`sceneCut` 的判定源）
在整个比赛里只有 **3 次回退**，与 3 次 replay 入场**一一对应**，
且回退时 `_segLastEndSimT` 同步从真实窗尾（37.2 / 403.1 / 2349.1）
切到重播切片尾（33.1 / 399 / 2345.1）：

```
w=159334  reloc=37.04  segEnd=37.2     ┐ 真实高光段播放中
w=159595  reloc=25.86  segEnd=33.1     ┘ 切到重播切片：游标倒带 11.2 s
```

`_relocLastSimT` 在 753 个采样里 **0 次为 `null`**、`_built` **0 次为 false**，
说明 `_build` 从未重入。**没有任何中途重置。**

**4. 为什么不改逻辑。** 若把 `_segLastEndSimT` 改记「真实高光窗终点」，
重播段播完后它会跳回真实窗尾，**反而在两窗之间凭空多出一次跨段剪辑**。
用 `tEnd0` 的代价只是极少数相邻高光窗因 `gap ≤ 0` 退化成 `first`——
那种情况两窗之间本来就只差十来秒，谈不上「跳过了一段」。

因此本轮只补注释（`matchview.js:846` 附近与 `_enterSegmentTransition` 内），
**判定逻辑一字未改**。

### 5.6 验收

- `scripts/_segment-cut-verify.mjs`：确认剪辑类真的在段入场时挂上、
  `mode` 统计里 `cut ≥ 1` 且 `ease == 0`，并检查**类不会卡住**
  （卡住会让球场一直发暗——这是这个修法唯一的新增风险）。
- `scripts/_smoke-boot.mjs`：改动后页面正常 boot，`pageErrors` 只有
  收尾时的 `ERR_CONNECTION_REFUSED`（服务已 kill，非代码问题）。

## 6. 顺带修正的一处探针误读

`_simPlay.simT` 在每段开始时被重置为窗口起点（`matchview.js:784` 的 `simT: t0`），
所以**跨段做 `last - first` 没有意义**。

`_match-smoothness-probe` 早先报过 `simSecondsAdvanced: 252.05, simRate: 12.6`，
看似「12.6 倍速」；实际量到的是「最后一个窗口的绝对起点」。
`_timeline-frames-probe` 改成**按连续段分段计算**后得到 `simPerWall = 1.005`，才是真值。

**教训（与 AGENTS.md「阈值效应 vs 真实效应」同类，别丢）**：
**一个会被重置的游标，不能跨重置点做差分。**

## 附：本轮新增/修改的脚本

| 脚本 | 用途 |
|---|---|
| `scripts/_match-smoothness-probe.mjs` | 段内平滑度（视图坐标，非 DOM） |
| `scripts/_official-smoothness-probe.mjs` | 裁判/边裁专项 + 遮挡判定 |
| `scripts/_actor-visibility-probe.mjs` | 25 实体在镜头矩形内的占比与进出次数 |
| `scripts/_layer-alignment-probe.mjs` | canvas 层与 DOM 层的坐标对齐（逐 px） |
| `scripts/_apparent-speed-probe.mjs` | 视在速度（米/墙钟秒 与 米/模拟秒 并列） |
| `scripts/_timeline-frames-probe.mjs` | 时间轴帧表/间隔/游标/真实倍率（分段计算） |
| `scripts/_segment-boundary-probe.mjs` | 段边界瞬间的实体位移分布 |
| `scripts/_segment-gap-census.mjs` | 整场段间隔分布（校准 20 s 门限） |
| `scripts/_segment-entry-trace.mjs` | 段入场逐条归因（`prevEnd` 原始值 + 每帧游标采样） |
| `scripts/_smoke-boot.mjs` | 启动冒烟（确认改动后页面仍能 boot，无 console error） |

全部探针都带文件进度标记（stdout 重定向到文件时是块缓冲，
挂住的话看不到任何输出——`mark()` 直接写盘绕过这个陷阱）。

⚠ **探针的日推进循环不能靠固定 sleep**：实测 `#btn-advance` 每次只推进 **1 天**，
而下一场比赛可能在 **2 天**后（`#next-match` 文案「还需等待 2 天」）。
固定 `waitForTimeout(1500)` 在机器忙时会漏拍，表现为**卡在 matchday 循环十几分钟**。
正确做法是点了之后 `waitForFunction` 等 `#next-match` 文案**真的变化**。
本轮 `_segment-gap-census.mjs` 已按此修好。

---

# 第二轮（2026-09-16/17）：**球的瞬移**——用户追报，定位到第二个独立缺陷

> 用户原话：「播放进球集锦时，**球**还是会出现瞬移的情况，尤其是**角球**的时候。
> 还有别的类似定位球的场景，如**边线球、点球、任意球**，也会出现吗？」

## 一、为什么第一轮没修干净

第一轮修的是**整队瞬移**：段首 `applySimSnapshot(frames[0], {soft:false})` 把
26 个实体一步按到新坐标，修法是用 260 ms 显式淡场把它讲成「换镜头」。
淡场能掩盖**同时移动的所有实体**，但如果一次搬运发生在**淡场没覆盖到的时刻**，
球就会露出来。用户看到的正是这种情况。

## 二、根因：`_enterSegmentTransition` 把「倒带」和「两窗相接」混为一谈

```js
// 旧代码（js/matchview.js）
if (!(gapSec > 0)) return { mode: "first", gapSec };   // ⛔ gap < 0 也被归到 first
```

`gapSec = t0 - prevEnd`（本段起点 − 上段终点）：

| gapSec | 含义 | 旧行为 | 应然 |
|---|---|---|---|
| `> 0` | 跨段跳帧 | `cut`（淡场） | 淡场 ✅ |
| `= 0` | 两窗相接 | `first`（不淡场） | 不淡场 ✅ |
| **`< 0`** | **倒带（重播回跳）** | **`first`（不淡场）** | **淡场 ❌** |

对「相接」不淡场是对的（两窗本就连续，没有换场景）。
对「倒带」恰恰相反：那是 `playFmmGoalReplay` 从 `climax+2` **倒回** `climax-5.5`，
画面上是一次明确的换镜头。而更糟的是，倒带会让 `applySimSnapshot` 的
`sceneCut` 判定成立（其定义含 `simT < lastSimT - 1e-6`），于是：

```js
if (sceneCut) entity._relocAt = 0;   // 把 relocate 缓动显式关掉
```

⇒ **既不淡场、也不缓动，球和全部实体一步按到新坐标。** 这就是用户报的球的瞬移。

## 三、实证：每一次进球重播都是硬切

`scripts/_segment-entry-trace.mjs` 跑真实页面、记录每一次入场（原始 JSON 在
`.tmp-continuity/entry-trace.json`）：

| 段 | label | t0 | prevEnd | gapSec | mode（旧） | 应有 |
|---|---|---|---|---|---|---|
| 1 | kickoff | 0.1 | 0 | +0.1 | first | 合理 |
| 2 | goal | 21.2 | 14 | +7.2 | cut | 合理 |
| 3 | **replay** | 25.8 | 37.2 | **−11.4** | **first** | ❌ 应淡场 |
| 4 | goal | 387.1 | 33.1 | +354 | cut | 合理 |
| 5 | **replay** | 391.7 | 403.1 | **−11.4** | **first** | ❌ 应淡场 |

**每一个 `replay` 段都是 `gapSec = −11.4` / `mode = "first"`**——
即每一次进球重播都没有淡场。

## 四、修复

`js/matchview.js` 的 `_enterSegmentTransition`，把两档拆开：

```js
const gapSec = t0 - prevEnd;
// gap === 0：两窗几乎相接（本来是连续的），不需要剪辑提示。
if (gapSec === 0) return { mode: "first", gapSec };
// gap < 0：倒带重播 —— 明确的换镜头，必须淡场，否则球被硬置。
// gap > 0：跨段跳帧 —— 原本就走剪辑。
this._playSegmentCut();
return { mode: "cut", gapSec };
```

⛔ **仍然不给段首加缓动**（第一轮的结论不变）：倒带时球是从「进球后」回到
「5.5 秒前」，缓动会让球**倒着飞回去**，比硬切更怪。正确解法就是淡场。

## 五、验证

`.tmp-seg-verify-minimal.mjs`：从页面 **import matchview 模块**、取
**真实 prototype 方法**调用（不是我复刻的逻辑），6 项断言：

| 场景 | 期望 | 实测 |
|---|---|---|
| ★倒带 gap = −11.4 | `cut` | ✅ `cut` |
| 两窗相接 gap = 0 | `first` | ✅ `first` |
| 正常跨段 gap = +354 | `cut` | ✅ `cut` |
| `prevEnd = null`（`Number(null)=0`） | `cut`（既有行为） | ✅ `cut` |
| `prevEnd = undefined`（真·开球首段） | `first` | ✅ `first` |
| `pageErrors` | 空 | ✅ 空 |

**7/7 通过。**

## 六、其他定位球：四类都会被硬切，角球只是最显眼

新建 `scripts/_restart-teleport-probe.mjs`（18 场，自检恒等式 1283 = 1283 ✅）。
**引擎侧 `_restart` 对四类定位球都是单 tick 硬置**（`b.x = x; b.y = y`），
所以引擎侧一律是瞬移，**补救全部在渲染层**：

| 类型 | 搬运次数/场 | 球位移中位 | 球位移 max | 受影响球员中位 | 最大球员位移中位 |
|---|---|---|---|---|---|
| **corner** | **7.33** | **14.37** | **48** | 6 | 7.55 |
| freekick | 25 | 1.93 | 11.3 | 6.5 | 14.2 |
| goalkick | 29.11 | 5.65 | 40.4 | 7.5 | 15.65 |
| offside | 6.89 | 2.68 | 44.5 | 9 | 21.85 |
| none（死球→held） | 2.72 | **49.26** | 49.4 | 19 | 72.5 |

**关键判读**：
- 角球搬运的球位移 **14.37 单位（≈15 m）**，远超缓动门槛 `RELOCATE_BALL_JUMP = 6`；
  球员位移 7.55 单位也远超其门槛（`10 m/s × 0.1 s ≈ 0.95` 单位）。
- ⇒ **段内**定位球的门槛不是问题，只要 `adjacent`（相邻帧）成立缓动就会武装。
- ⇒ 漏掉的是**段边界**：那里 `adjacent` 为假 + `sceneCut` 为真，**双重关闭**。
- ⇒ **四类定位球在段边界都会被硬切，不只是角球**；角球因为
  「射门被扑出 → 角球」紧跟高光段、且位移大而**最显眼**。

**回答用户的问题**：边线球/点球/任意球**同样会**，只要它们落在高光段的边界上。
本次修复对四类一并生效（修的是段边界判定，与定位球类型无关）。

## 七、留档：第三个独立缺陷（**未修**）

`this._segLastEndSimT = tEnd0;` 记的是**帧表尾**，而重播段把 `tEnd0`
设成 `climax+2`（`playFmmGoalReplay`），使这个游标停在「半路」。
`_segment-entry-trace.mjs` 头部已记录该现象，并给出「不改成真实窗尾」的理由
（会多出一次假跨段剪辑）。

**本次没动它**——修 1（`gap < 0` 走剪辑）已覆盖用户报的现象；
动 `_segLastEndSimT` 需要单独的 A/B 论证，不能顺手改。

## 八、本轮新增脚本

| 脚本 | 用途 |
|---|---|
| `scripts/_restart-teleport-probe.mjs` | 按定位球类型分层量搬运位移 + 受影响球员数 |
| `.tmp-seg-verify-minimal.mjs` | 最小端到端验证（import 真实 prototype，6 断言） |
