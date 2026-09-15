# 跑位层单独成案：三条候选的定位与阶梯归因（2026-09-15）

> 承接 [docs/subbundle-attribution-2026-09-14.md](subbundle-attribution-2026-09-14.md)。
> 那一轮把「跑位候选吃掉进球」更正为「损失全在近距离射门」，并指出**跑位四项是捆绑包
> 里唯一让射门供给变好、且信封全过的一层**。本轮把跑位层从捆绑包里剥出来单独成案。
>
> **引擎、数据、缓存、统计护栏、冻结参考均未改动。** 本文只记录候选测量结果。

## 1. 结论

跑位层确实可以单独成案，但**只有 3 条补丁是干净的**：

| 候选 | 补丁数 | 标准档 24 场 | 后台档 24 场 | 判定 |
|---|---:|---|---|---|
| `_movement-release-candidate.mjs`（v253 基线） | 8 | 792 脚 / 67 球（2.79），**转化 8.5% 破下限** | 771 脚 / 100 球（**4.17 破上限 3.3**） | **不可用** |
| `_movement-portable-candidate.mjs`（HEAD） | 5 | 638 脚 / 66 球（2.75），转化 10.3%，**传中 2.7% 破下限 3%** | — | 总量中性，但吃掉传中 |
| `_movement-reduced-candidate.mjs`（HEAD） | 3 | 640 脚 / 63 球（2.63），**仅挂 `penalties 0.08`** | 625 脚 / 70 球（2.92），**exit 0 全过** | **唯一接近可用** |

精简候选 = 前插资格（R3）+ 底线回追（R4）+ 传球支援释放（R5），
见 `scripts/_movement-reduced-candidate.mjs`。

## 2. 为什么 v253 基线上的 8 补丁候选不可用

`_movement-release-candidate.mjs` 在 v253（`5f1d152`）基线上：

- 标准档：射门 792（v253 基线 735，+57）、16 米内 562（+70）、禁区外 29.0%
  （基线 33.1%）——**射门供给明显变好**；但进球 67（2.79 过下限 2.5），
  **转化 8.5% 低于 9% 下限**。射门多了、转化掉了。
- 后台档：射门 771、进球 100（**4.17/场**），**破进球上限 3.3**。v253 后台基线本身
  已经 3.13，靠近上限，任何抬高射门供给的改动都会把它顶出去。

即：**「射门变多」这件事本身在两个档位上是反向的**——标准档缺射门、后台档不缺。
一个统一抬高射门供给的候选不可能同时满足两边。

## 3. HEAD 上的可移植子集（5 补丁）

`_movement-portable-candidate.mjs` 只保留能在 HEAD 上加载的补丁。
`_fullback-support-candidate.mjs`（及其依赖 `_backline-support-candidate.mjs`）**在 HEAD
上会断言失败**：它的 `end` 标记是 v253 的中卫注释文本，而 HEAD 的边后卫块已被 `2bd9fa5`
重写（加了 `blockForward` + `_checkCrowding`）。**移植它等于调和两套边后卫模型，
需要独立验证，不是改标记能解决的。**

5 补丁在 HEAD 上的结果：射门 638、进球 66（2.75，与 HEAD 基线 2.75 相同）、
转化 10.3%、强队积分 1.92——**总量几乎中性**，唯一失败是
**传中占比 5.0% → 2.7%，破 3% 下限**。

## 4. HEAD 上逐条单跑（可移植阶梯 R0–R6，标准档 24 场）

`LADDER_SET=portable LADDER_PIN=none`，见 `scripts/_subbundle-attribution-ladder.mjs`。
原始日志 `.tmp-continuity/movement-release/portable-ladder/`，机器可读结果
`ladder-standard24.json`。

| 级 | 新增补丁 | 射门 | 进球 | 转化% | 传中% | 禁区外% | 强队积分 | 结果 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| R0 | HEAD 基线 | 647 | 66 (2.75) | 10.2 | 5.0 | 28.9 | 2.04 | 全过 |
| R1 | 边锋居中 | 666 | 63 (2.63) | 9.5 | 4.8 | 32.3 | **1.13** | 破强队差 |
| R2 | 阵型角色 | 648 | 58 (**2.42**) | 9.0 | **2.8** | 27.8 | **1.00** | 破进球+传中 |
| R3 | 前插资格 | 647 | 68 (2.83) | 10.5 | 5.1 | 27.8 | 1.79 | **全过** |
| R4 | 底线回追 | 656 | 70 (2.92) | 10.7 | 4.4 | 29.6 | 2.04 | **全过** |
| R5 | 传球支援释放 | 648 | 64 (2.67) | 9.9 | 5.0 | 31.9 | 1.71 | **全过** |
| R6 | 可移植全部（5） | 638 | 66 (2.75) | 10.3 | **2.7** | 29.5 | 1.92 | 破传中 |

读法：

- **R1 与 R2 必须剔除。** 边锋居中把强队积分从 2.04 打到 **1.13**；阵型角色把进球打到
  **2.42**（破下限）并把传中打到 **2.8%**（破下限）。这里的 `strongVsWeak` 是
  **24 场**（`strongMatches = max(16, matches)`），不是小样本噪声。
- **R6 的传中塌陷是 R1+R2 造成的**：R3/R4/R5 单跑时传中分别是 5.1/4.4/5.0，
  全部在 3–14% 信封内。
- 三条干净的补丁方向一致：**抬高进球（2.83/2.92/2.67）、略微抬高射门、
  传中不塌**。

## 5. 精简候选（R3+R4+R5）的当前状态

| 档位 | 射门 | 进球 | 转化% | 传中% | 禁区外% | 点球 | 强队积分 | 结果 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 标准 24 | 640 (26.67/场) | 63 (2.63) | 9.8 | 4.2 | 30.3 | **0.08** | 1.67 | **仅挂 `penalties`** |
| 后台 24 | 625 (26.04/场) | 70 (2.92) | 11.2 | 5.0 | 33.1 | 0.21 | 1.79 | **exit 0，全过** |

标准档失败项：`penalties 0.08`，信封是 **0.1–0.5**。24 场里 2 个点球（基线 4 个），
即**低频事件的小样本**，不是系统性问题——但**这一句必须被证据支持，不能直接当结论**：
要判定它落在噪声内，需要扩到 96 场量点球的分布，或给出「补丁与点球无因果路径」的机制论证。

## 6. 待决

1. **是否采纳精简候选**：需要先处理 `penalties 0.08` 这一项（扩样或机制论证），
   然后才谈完整验收（`verify --full`、两档逐帧等价、缓存联动、桌面+手机实机）。
2. **是否调和 `_fullback-support-candidate.mjs` 与 HEAD 的边后卫模型**（见 §3）。
3. **传球链作为整体决策**（上一轮结论）：损失摊在 Q2/Q3/Q5/Q6，无单条越 ±72；
   若要接受拦截模型，得在别处补回 16 米内机会质量。
4. **门将三项是独立议题**（扑救侧是否过强），与跑位无关。

## 7. 复现

```bash
# v253 基线上的 8 补丁候选
node --import ./scripts/_v253-baseline.mjs --import ./scripts/_movement-release-candidate.mjs \
  scripts/match-realism-audit.mjs 24 standard

# HEAD 上的 5 补丁 / 3 补丁候选（不要加 _v253-baseline）
node --import ./scripts/_movement-portable-candidate.mjs scripts/match-realism-audit.mjs 24 standard
node --import ./scripts/_movement-reduced-candidate.mjs  scripts/match-realism-audit.mjs 24 standard
node --import ./scripts/_movement-reduced-candidate.mjs  scripts/match-realism-audit.mjs 24 background

# 可移植阶梯（R0–R6）整体重跑
LADDER_SET=portable LADDER_PIN=none LADDER_JOBS=3 node scripts/_subbundle-attribution-ladder.mjs 24 standard
```

原始日志：`.tmp-continuity/movement-release/`
（`standard24.log`、`background24.log`、`portable-head-standard24.log`、
`reduced-head-standard24.log`、`reduced-head-background24.log`、`portable-ladder/`）。
