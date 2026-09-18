# 直塞护栏标定 + 球员能力差异的结构（2026-09-18）

> **引擎零改动。** 本轮只做测量与诊断：① 给直塞这个指标标定噪声、判定它能否做判据；
> ② 顺「持球者能否主动过人」「球星与普通球员差在哪」两个问题，把引擎的能力作用面逐段读清。
>
> 触发：上一轮交接（[docs/handoff-runmargin-2026-09-18.md](./handoff-runmargin-2026-09-18.md)）
> 的 §5 第 2 条「直塞 2.02 → 1.88 方向与判据相反，且**直塞没有护栏**，无法判死 ——
> 需先给直塞补一条护栏（与『进球只有一种口径』『角球只有单侧下限』同型的仪器问题）」。

---

## 1. 直塞护栏标定（主结论）

### 1.1 方法

新探针 `scripts/_through-pass-noise-calibration-probe.mjs`（纯测量，只读 `engine.events`）：

**同一引擎、同一档位、同能力，跑 20 批互不重叠的 12 场种子窗口（共 240 场，种子 372000..372239）。**

- 批内均值 = 一次「12 场测量」的读数（就是 A/B 实验实际拿到的东西）；
- **批间标准差 = 换一批种子，读数会漂多少** ← 这就是缺的那个 SE。

取数口径与两件既有仪器**逐字一致**（已核对源码）：

```js
// 校准探针 _final-third-movement-calibration-probe.mjs:475
if (ev.through && !ev.cross) t.through++;
// 审计 match-realism-audit.mjs:312
if (event.through && !event.cross) totals.throughPasses++;
```

统计口径也一致：**总数 ÷ 场数（双方合计每场）**。

### 1.2 读数

| | control（引擎原样） | runC1.0（挂跑动原语） |
|---|---:|---:|
| 240 场总体均值 | **2.33** | **2.20** |
| 批间标准差（每批 12 场） | **0.38** | **0.49** |
| 批内均值极差 | **1.67 ~ 3.08**（1.42） | **0.83 ~ 3.00**（2.17） |
| 逐场标准差 | 1.49 | 1.46 |
| 0 次的场数占比 | 8.75% | 9.58% |
| ≥5 次的场数占比 | 9.58% | 6.25% |
| 逐场中位 / p75 / p90 / 最大 | 2 / 3 / 4 / 6 | 2 / 3 / 4 / 8 |

原始输出归档：`docs/measurements/probe-through-noise-240-{control,commit}-8b43f92.txt`。

⚠ **两档的档位差（2.33 vs 2.20）不是「效应」** —— 见 §1.4：它小于两档各自的批间漂移。

### 1.3 判决：那条「直塞 ❌ 反向」作废

被判反向的效应是 **0.14/场**（2.02 → 1.88，48 场 A/B）。对照本轮标定：

| 量 | 值 |
|---|---:|
| 48 场 A/B 的 2SE 门槛 | **0.61** |
| 被判的效应 | **0.14**（= 门槛的 **23%**） |
| 检出 0.30/场 所需每组场数 | **约 295 场** |
| 检出 0.14/场 所需每组场数 | **约 1352 场** |

**决定性反证**：同一档位在 6 场窗口是 **2.17 → 2.67（差 +0.50，方向相反）**——
同一实验换个种子窗口就翻向，噪声主导无疑。

⇒ **直塞不可用作「近 48 场判 ↑/↓」的细粒度判据**；只能用于
**大样本方向性参考（≥200 场/组）**。

### 1.4 这条也是「批次级仪器问题」的一个实例

⚠ 注意：**批间标准差（0.38）比被判的效应（0.14）还大 2.7 倍**。
凡「**护栏区间极宽 + 指标方差大 + 被当作方向判据用**」三者同时成立的量，
都要先做一次本节这样的噪声标定，再决定它能不能进验收表。

同型问题（本仓已有先例）：
- 「进球只有一种口径」（探针口径 vs 审计口径历史值域不同）；
- 「角球只有单侧下限」（`cornerShots >= 0.5` 系统性偏大永不报红，见 memory 2026-09-17 首节）；
- 本节：直塞 `0.5 ~ 12`（上下沿差 24 倍，实测均值贴在下沿上方 4.4 倍）。

### 1.5 现状那条「护栏」的真实性质

`match-realism-audit.mjs:463`：

```js
report.perMatch.throughPasses >= 0.5 && report.perMatch.throughPasses <= 12
```

**它不是「落在标定区间内」的质量判据，而是「爆炸半径限制」**（防这项指标整体消失/爆表）。
实测均值 2.2~2.33 稳居于区间中心偏下，与真实值 3.38 的缺口（约 60~68%）**由它管不着**。
⇒ 文档与读法应照此改述；**要真正补齐与真实的差距，得走机制侧（见 §3）。**

---

## 2. 球员能力差异的结构（回答两个提问）

用户提出两点：
① 高光画面里机会多是「**进攻球员单独面对门将**」，是否有**中场远射**、
   **个人能力超强的球员突破射门**、**撞墙配合（二过一）**？
② 梅西/内马尔/德布劳内/凯恩/范戴克这类**超级巨星**，引擎里有对应的球员吗？

以下逐段读代码回答（**纯静态阅读 + 属性用量统计，未跑实验**）。

### 2.1 有没有「持球者主动过人」？——**没有**

`engine.js:2801` 的 `dribble` 分支**只设定移动目标**：

```js
} else if (choice.act === "dribble") {
  if (isWing) {
    // 边锋内切：向中 + 向前
    a.intent = { type: "dribble", tx: ..., ty: ... };
  } else {
    a.intent = { type: "dribble", tx: ..., ty: ... };
  }
  a.fsm = "carry";
}
```

**算完 `tx/ty` 就结束**——无对手判定、无掷骰、无成功/失败、**无「过掉几人」的记账**。
球员只是「带着球往那个点走」。

**「一对一」在引擎里只有单向的一半**：防守方可以下脚抢（`engine.js:6006` 的 `tackle`）：

```
def = 0.6×tackling + 0.2×marking
atk = 0.5×dribbling + 0.3×strength
p   = clamp((0.22 + (def−atk)×0.45 + moveVuln) × 团队防守mod / 对方poss mod, 0.06, 0.52)
```

这是**「防守者抢断成功率」**，不是**「进攻者过人成功率」**。实际区别：

- 过人失败 ⇒ 球仍在持球者脚下（只是没甩开人）；
- 抢断成功 ⇒ 球**直接换手**。

**后果**：盘带 20 的球星面对盘带 5 的球员，唯一好处是「**别人抢他更难**」——
他**不会更频繁地主动过掉对手**。引擎里不存在「梅西连过三人」这个事件类型，
进球事件（`_emit("goal")`）也**不带任何「本回合过掉 N 人」字段**。

### 2.2 有没有「撞墙配合」？——**有传球，但没有「二过一」这个协同原语**

`_passCandidates` 会为跑动中的队友算**提前量落点**（`engine.js:2884` 附近，`eta` 推算
`tx/ty = m.x + m.vx*eta, m.y + m.vy*eta`），这在**几何效果上**接近「给跑动者做球」。

但注意：这是**持球者单方面预测接球人轨迹**，**不是一个双人协同动作**：

- 没有「A 传给 B 后立刻前插、B 一脚回做给 A」的**时序承诺**；
- 接球人的跑位由 `_attackPlan` / `_chooseAttackOffBallTarget` 独立决定，
  **不读「谁刚把球传给我」**；
- 因此引擎里没有「二过一」这个可识别的事件，也没有对应的统计量。

⇒ **是「传切」的几何近似，不是「撞墙」的语义实现。**

### 2.3 有没有「中场远射」？——**有，但是按距离触发而非按球员**

`_shoot` 路线里存在远射分支（`engine.js:2801` 附近的 `choice.act === "longshot"`）：

```js
} else if (choice.act === "longshot") {
  a.shotCdUntil = this.t + (core ? 1.5 : isWing ? 1.6 : 2.2);
  this._shoot(a);
}
```

审计里也有专门的 `longShots` 与距离分桶（`outsideBoxSharePct >= 25 && <= 50`、
`distance["30plus"]` 有独立护栏）。

**但**：远射的**触发**是「概率 × 位置 × 冷却」，`shooting` 属性进的是**选项权重与结果**，
**不是「这名球员有没有远射能力」的门槛**。所以引擎里**没有「远射型中场」这个角色特征**——
任何位置合适的球员都会以相近频率尝试远射。

**这与你的观察一致**：高光机会多是「单刀面对门将」而不是「中场发炮」，
因为**单刀是一次机会的结果形态，而远射需要一个「远射倾向 × 远射能力」的个体差异**，
后者目前只有前者的一半（有位置项，无个体项）。

### 2.4 属性用量全表（`grep -o "attr\.[a-z]*" | sort | uniq -c`）

```
19 decisions   17 dribbling   14 shooting    14 finishing   12 positioning
11 pace        10 passing      9 vision       7 reflexes     7 kicking
 7 crossing     6 strength     5 handling     4 tackling     3 agility
 2 marking      1 stamina      1 heading      1 balance      1 accel
```

属性**都被读了**。关键不在「读没读」，而在**读完之后是进「选择层」还是「执行层」**：

| 层 | 作用面 | 属性差的影响 |
|---|---|---|
| **选择层** | `w:`（选项权重）、`value *`（估值）、`intent`（尝试概率） | **强、连续** |
| **执行层** | `errMps`（落点误差）、各类成功率公式 | **弱或无** |

### 2.5 具体例子：直塞的能力链（本轮读得最细的一条）

**选择层（有差异 ✅）** `engine.js:3079-3081`：

```js
throughIntent = clamp(
  0.34 + a.attr.vision*0.24 + (a.attr.decisions||0.55)*0.1
  + (习惯 tries_through_balls ? 0.2 : 0) + 角色passRisk*0.12 − 持球压力*0.12,
  0.2, 0.82)
```

`vision` 权重 0.24，是单项最大 ⇒ **视野高的球员明显更常尝试直塞**。

**执行层（几乎没有差异 ❌）** `engine.js:3184 + 3189`：

```js
const technique = passTechnique(a, isCross);   // isCross=false ⇒ technique = a.attr.passing
const errMps = (1 - technique) * (isCross ? 3.8 : 3.2);
const nx = (random()-0.5) * errMps * (FIELD_W / PITCH_W_METRES);
const ny = (random()-0.5) * errMps * (FIELD_H / PITCH_H_METRES);
```

两个问题：

1. **`vision` 完全不参与落点。** 视野 20 与视野 5 的球员，直塞**落点误差分布完全相同**
   （只要 `passing` 相同）。视野只影响「要不要传」，不影响「传得准不准」。
   而视野的足球语义恰恰是**看见别人看不见的空档** ⇒ 它应当**既影响选择、也影响目标质量**。
2. **直塞与普通传球共用同一误差公式，无专属加成。** `isThrough` 只影响
   `passLaunchLoft`（`if (isThrough) return 6 + roll*3`，即弧线）与拦截豁免，
   **不影响精度**。⇒ 一脚 30 米穿两名中卫的直塞，与一脚 30 米横传，
   在引擎眼里**精度上难度相同**。

**附带发现**：`passLaunchLoft(distanceMetres, speedMps, {isCross, isThrough, fromCorner, roll})`
**根本不收 `technique`** ⇒ 技术不影响弧线/离地高度，技术好的人踢不出更平的球或更刁的弧线。
唯一的技术作用路径是 `passLaunchSpeedMps` 里的 `(0.94 + 0.06 * technique)`
——技术从 0.3 到 0.92 之间，出球速度只差 **3.7%**。

### 2.6 一句话概括结构

> **引擎的球员差异集中在「选择层」（做什么动作），而不在「执行层」（做得多好）。**

- 过人：**执行层完全没有**；
- 直塞：执行层**只读 `passing`**，`vision` 缺席，无专属难度加成；
- 远射：有位置项，**无个体倾向项**；
- 传中/抢断：**这两条是例外** —— `passTechnique(a, true)` 合成 `crossing/passing/kicking`，
  抢断的 `def−atk` 直接进成功率 ⇒ **能力差连续影响结果**。

⇒ **「球星与普通球员差在哪」的答案是：在当前引擎里，球星主要「更愿意冒险」、
「更不容易被抢断」；但不「更能过人」、不「更能传出致命球」、不「更擅远射」。**
这正是「超级巨星在比赛里不够显眼」的结构性原因。

### 2.7 属性表核对（一处自我更正）

`OUTFIELD_ATTRIBUTE_KEYS`（`js/player-attributes.js:11`）是 16 项：
`pace, shooting, passing, dribbling, defending, physical, finishing, tackling,
marking, strength, stamina, vision, positioning, heading, crossing, decisions`。

引擎读的 `attr.balance` / `attr.agility` / `attr.accel` **不在**该列表里，
但**不是缺陷**：它们由 `bodyControlProfile()`（`js/player-control.js:55`）从
`strength/physical/dribbling/agility` **派生**，再由 `normalizedAgentAttributes`
（`js/sim/engine.js:375`）注入。**读它们是正确的。**

⇒ 本文档初稿一度把这点写成「引擎读了不存在的属性」，**已更正**。

---

## 3. 下一步建议（按我的排序）

1. **【文档/仪器】把直塞从验收判据里撤下来**（§1.3–§1.5）：
   在 `docs/offball-run-primitive-design-2026-09-17.md` §6 的验收表里，
   把「直塞/场 ↑」一条标注为**不可执行**（与进球那一条同型的修订方式），
   并把 `match-realism-audit.mjs:463` 的护栏注释改述为「爆炸半径限制」。
2. **【主线·待用户拍板】boxSec 取舍**（交接 §5 第 1 条）：
   直塞这条判决作废之后，`runMargin` 的 48 场 A/B **只剩 boxSec 一条判据挡着**。
   取舍仍是二选一：(a) 接受回退、按新基线重标 850 天花板；
   (b) 改原语，实现设计文档 §6 里没实现的 `holdPass`（仅刚赢回球权后 6 秒内触发）。
3. **【机制侧·新】执行层的球员差异**（§2）：
   这是本轮「顺带」量出来的**结构性缺口**，且与用户的两个提问直接对应。
   候选（按性价比）：
   - **直塞落点加 `vision` 项**（改一行系数）——直接对应「德布劳内式直塞」；
   - **一对一过人原语**（新增执行层判定，`dribbling/agility` vs `tackling/marking`）
     ——对应「梅西式突破」，但**这是新原语，要走完整标定流程**；
   - **远射的个体倾向项**——对应「中场远射」。
   ⚠ 前两条都会动标准档 → 须整体重标定 `STANDARD_PROFILE_REFERENCE_24`。

### 3.1 「直塞落点加 `vision` 项」的可行性核实（本轮已做静态分析）

**结论：可行，且 `vision` 是有效的独立维度，不是 `passing` 的重复。**

`errMps`（`engine.js:3189`）是**唯一**的落点精度源，只依赖 `technique`：

| `passing` | `technique` | `errMps`（直塞） |
|---:|---:|---:|
| 5 | 0.440 | **1.792** m/s |
| 10 | 0.600 | 1.280 |
| 15 | 0.760 | 0.768 |
| 20 | 0.920 | **0.256** |

⇒ `passing` 本身影响不小（5→20 差 **7 倍**）。**缺的确实是 `vision`。**

**关键核实：`vision` 与 `passing` 会不会共线到没意义？** 查原型权重（`js/player-attributes.js`）：

| 原型 | `passing` | `vision` | 差 |
|---|---:|---:|---:|
| `playmaker` | 2.5 | 2.5 | 0.0 |
| `advanced_forward` | −0.8 | −1.0 | 0.2 |
| `holding_midfielder` | 1.2 | 0.4 | **0.8** |
| `winger` | 0.3 | 0.1 | 0.2 |
| `target_forward` | 0.2 | −0.5 | **0.7** |

有共线趋势，但**不致命**，原因在 `targetAttribute()`（`:268`）：

```js
const positional = Number(profile.weights[key] || 0) - protectedMean + ...;
return clamp(base + positional + stableGaussian(seedKey(player, key)) * noiseScale);
```

**每个属性各有独立的 `stableGaussian(seedKey(player,key))` 噪声（SD ≈ 1.45）** ⇒
在同一原型内部，`passing` 与 `vision` **相关系数接近 0，会各自独立波动**。

⇒ **加 `vision` 项会在两个层面产生真实区分**：
① 跨原型（组织核心 vs 防守型中场 / 前锋的差距被拉开）；
② 同原型内部（`vision` 高的个体与 `passing` 高的个体分开）。

**建议的最小改动形态**（待跑完整标定，此处只记设计意图）：

```js
// 直塞精度：技术 + 视野（看见空档的能力也是精度的一部分）
const throughVision = isThrough
  ? clamp(0.62 + 0.38 * (a.attr.vision ?? 0.55), 0.5, 1)
  : 1;
const errMps = (1 - technique * throughVision) * (isCross ? 3.8 : 3.2);
```

⚠ **这必然改变标准档的所有直塞落点** ⇒ `STANDARD_PROFILE_REFERENCE_24` 冻结快照整片作废，
须按 v252 的先例**重标定九项**，并重跑 `match-realism-audit` 两档。
**这是「一行系数」的表象下藏着的实际工作量。**
4. **【UI】中场体能记账「全队同值」** —— 用户已拍板「修根因：逐人连续消耗」，未开工。
5. **【UI/小】`.ht-roles` 窄屏单行 95px 偏高** —— 归「需要单独一轮」。

---

## 4. 复现命令

```bash
# 直塞噪声标定（240 场/档，约 45 分钟；Bash 工具会 SIGTERM，建议 run_in_background）
node scripts/_through-pass-noise-calibration-probe.mjs 12 20 control
node scripts/_through-pass-noise-calibration-probe.mjs 12 20 commit

# 快检（18 场，约 1 分钟）
node scripts/_through-pass-noise-calibration-probe.mjs 6 3 control

# 旧的三件仪器（口径对账用）
node scripts/match-realism-audit.mjs 24
node scripts/_through-pass-gate-probe.mjs 6
node scripts/_through-pass-profile-fidelity-probe.mjs 24 372000
```

本机环境坑同前（见 [docs/handoff-runmargin-2026-09-18.md](./handoff-runmargin-2026-09-18.md) §7）：
Bash 工具 SIGTERM 需 `> file 2>&1`；`rm` 会挡下同链命令；推送用系统 Git + 显式补 helper。
