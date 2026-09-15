# 跑位候选捆绑包的子候选归因（2026-09-14）

## 1. 结论先说

上一轮把「标准档护栏失败」记为**跑位候选吃掉进球**（
[movement-shot-supply-attribution-2026-09-14.md](movement-shot-supply-attribution-2026-09-14.md)）。
**这个说法是错的。** 把 29 个模块的闭包按真实加载顺序拆成前缀阶梯后：

| 层 | 内容 | 对标准档 24 场的影响 |
|---|---|---|
| **跑位四项** | 边锋居中、阵型角色、前插资格、底线回追 | 射门 **766（+31）**、16 米内 **528（+36）**、禁区外 33.1%→**31.1%**、进球 2.88 —— **全部护栏通过** |
| **传球链七项** | 传球价值 / 拦截风险 / 防守传球（到达·计划·动量·存活·释放） | 射门 **638（−97）**、16 米内 **383（−109）**、禁区外 **40.0%**、进球 2.33 —— **跌破进球下限** |
| **门将三项** | 门将同刻通知、扑救反应时钟、接触高度 | 射门 667→**670（持平）**，进球 2.88→**1.96**、转化 10.3%→**7.0%** —— **进球与转化双破** |

即：**捆绑包的红是两处互不相关的独立原因叠出来的，而且都不是「跑位」。**

1. **射门供给损失归传球链**：16 米内 −109 脚、禁区外占比 +7 个百分点。跑位层自己
   反而让射门**更多、更靠近门前**。
2. **转化率崩塌归门将三项**：射门数几乎不动，进球却从 69 掉到 47。这三条是
   **扑救侧的正确性修复**，不是射门侧改动。

所以「跑位候选吃掉进球」应当更正为「**跑位层单独可以通过；把三个待定的正确性修复
捆进同一个文件后，整体才失败**」。

## 2. 为什么必须拆：捆绑包的结构

`scripts/_backline-support-release-candidate.mjs` 只有两行：

```js
import "./_backline-contact-height-candidate.mjs";
import "./_pass-support-release-candidate.mjs";
```

但它的**传递闭包是 29 个候选模块**（另有 1 个公共报告模块），实际落进引擎的补丁是
这 29 个的并集。新增 `scripts/_candidate-import-closure.mjs` 打印闭包：

```text
_backline-support-release-candidate.mjs
  _backline-contact-height-candidate.mjs
    _backline-contact-clock-candidate.mjs
      _backline-release-candidate.mjs
        _backline-flight-candidate.mjs
          _backline-pass-tracking-candidate.mjs
            _backline-pass-candidate.mjs
              _coordinated-pass-value-candidate.mjs
                _coordinated-movement-candidate.mjs
                _pass-risk-value-candidate.mjs
                  _pass-interception-risk-candidate.mjs
                    _defensive-pass-release-candidate.mjs
                      _defensive-pass-lifetime-candidate.mjs
                        _defensive-pass-momentum-candidate.mjs
                          _defensive-pass-plan-candidate.mjs
                            _defensive-pass-arrival-candidate.mjs
              _backline-support-candidate.mjs → _fullback-support-candidate.mjs
            _moving-press-clock-candidate.mjs → _moving-press-target-candidate.mjs
          _defensive-flight-actor-candidate.mjs
        _goalkeeper-release-candidate.mjs
      _goalkeeper-reaction-clock-candidate.mjs
    _goalkeeper-contact-height-candidate.mjs
  _pass-support-release-candidate.mjs
```

**这 29 个补丁在 HEAD 里一个都没有**（`grep -c` 全部为 0）。它们只存在于这个候选文件，
所以这个「跑位候选」实际上是**整批待定改动**的运输工具，不是一次跑位改动。

## 3. 方法：前缀阶梯

新增 `scripts/_subbundle-attribution-ladder.mjs`：按闭包的**真实加载顺序**逐级加载，
每一级跑一次标准档 24 场，得到的是**前缀**的实测结果。因为相邻两级只差一层，
两级之差就是那一层的边际贡献，且所有边际**精确望远镜求和**为捆绑包总量。

配套：

- `scripts/_candidate-import-closure.mjs` — 打印传递导入闭包（29 个模块，见 §2）。
- `scripts/_audit-log-bins.mjs` — 从抓取的日志里取回审计报告，按距离箱出表。
- `scripts/_subbundle-attribution-marginals.mjs` — 出边际表，并给出噪声标尺。

**两级自校验**（阶梯正确性的硬证据）：

- `P9-full-bundle` 复现已知的捆绑包结果 **627 脚 / 53 球**，逐箱一致。
- 传球链阶梯的 Q0 独立复现跑位层 **766 脚 / 69 球**（与 P1 逐箱一致）。

同一基线的两条阶梯因此互相对账，不是各说各话。

### 3.1 一个必须避开的坑：跑位层不在传球链的闭包里

`_pass-risk-value-candidate.mjs` **只** import `_pass-interception-risk-candidate.mjs`，
**不** import `_coordinated-movement-candidate.mjs`。所以「加载传球链各级」得到的是
**纯传球链**，它的真基线是 v253，不是「跑位层」。第一版阶梯把跑位层当作传球链的
第 0 级，导致 Q1–Q7 的边际全部算错。

已修正：`LADDER_SET=passchain` 自带 v253 基线级；分析脚本支持
`BASELINE_LOG=<path>` 借用外部基线。**做嵌套归因前必须先确认闭包真的嵌套。**

### 3.2 噪声标尺

审计对 `shots` 自己声明的冻结容差是 **±3 脚/场**（24 场 ±72）。这是项目已达成一致的
唯一噪声尺度，因此用它当**保守门槛**：低于它的边际不主张为效果。

在**主阶梯**上，**唯一越过门槛的边际是 P2 的 −145 脚**。其余各级（P1 +31、P3 +48、
P4 −36、P5 +34、P6 −1、P7 +8、P8 −4、P9 −43）全部落在 ±72 以内。

在**传球链阶梯**上没有任何单级越过 ±72（最大 Q2 的 −59），说明传球链的损失是
**整条链摊开的**，不是某一个补丁的罪——见 §5。

## 4. 主阶梯：射门损失全在 P2

标准档 24 场，基线 v253（`5f1d152`），`shots` 为 24 场合计：

| 级 | 新增层 | under16 | 16to22 | 22to30 | 30+ | 合计 | 进球 | 转化% | 禁区外% |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| P0 | v253 基线 | 492 | 218 | 24 | 1 | **735** | **70** | 9.52 | 33.1 |
| P1 | 跑位四项 | 528 | 218 | 19 | 1 | 766 | 69 | 9.01 | 31.1 |
| **P2** | **+ 传球链七项** | **360** | 232 | 28 | 1 | **621** | **57** | 9.18 | **42.0** |
| P3 | + 中卫/边卫接应 | 407 | 225 | 33 | 4 | 669 | 67 | 10.01 | 39.2 |
| P4 | + 移动逼抢时钟/目标 | 413 | 193 | 27 | 0 | 633 | 61 | 9.64 | 34.8 |
| P5 | + 防守飞行参与者 | 412 | 219 | 33 | 3 | 667 | 69 | 10.34 | 38.2 |
| P6 | + 门将同刻通知 | 425 | 219 | 21 | 1 | 666 | **51** | 7.66 | 36.2 |
| P7 | + 门将反应时钟 | 418 | 233 | 22 | 1 | 674 | **49** | 7.27 | 38.0 |
| P8 | + 门将接触高度 | 416 | 232 | 21 | 1 | 670 | **47** | 7.01 | 37.9 |
| P9 | + 传球支援释放 | 386 | 199 | 39 | 3 | **627** | **53** | 8.45 | 38.4 |

逐级边际（`d` 为相对上一级）：

| 级 | d under16 | d 合计 | d 进球 | 越过 ±72？ |
|---|---:|---:|---:|---|
| P1 跑位四项 | +36 | **+31** | −1 | 否 |
| **P2 传球链七项** | **−168** | **−145** | −12 | **是** |
| P3 中卫/边卫接应 | +47 | +48 | +10 | 否 |
| P4 移动逼抢 | +6 | −36 | −6 | 否 |
| P5 防守飞行参与者 | −1 | +34 | +8 | 否 |
| P6 门将同刻通知 | +13 | −1 | **−18** | 否（射门），进球另计 |
| P7 门将反应时钟 | −7 | +8 | −2 | 否 |
| P8 门将接触高度 | −2 | −4 | −2 | 否 |
| P9 传球支援释放 | −30 | −43 | +6 | 否 |

**读法：**

- **P1 是唯一同时让射门总数与近距离射门都上升的一级**（+31 / +36），并把禁区外
  占比从 33.1% 压到 31.1%。跑位层不是损失来源。
- **P2 是唯一越过噪声门槛的一级**，且它同时制造了唯一的**形态跳变**：禁区外占比
  31.1% → **42.0%**，近距离 −168 脚。这个形态是后面各级都没能复现的签名。
- **P6–P8 的射门数几乎不动（667→666→674→670），进球却单调下滑 69→51→49→47。**
  三级连续、方向一致、机制同类（都是门将正确性修复），这是**扑救侧**的效果。

### 4.1 护栏判定：只有信封检查在 v253 配对上有意义

`match-realism-audit.mjs` 先跑**绝对信封**（进球 2.5–3.3、转化 9–15%、传球 800–1250 …），
再跑**冻结参考漂移**（`shots` ±3 等）。因为断言按顺序短路，只报第一条。

`STANDARD_PROFILE_REFERENCE_24` 是为射门频率标定之后的引擎刷新的，**v253 结构上就对不上**
——`P0` 这一级本身就以「冻结参考过期」退出 1。所以在 v253 配对里：

> **只有信封断言是判定；冻结参考断言对每一级都必然失败，不是对候选的判定。**

按信封读：

| 级 | 第一条失败断言 | 信封判定 |
|---|---|---|
| P0 v253 | 冻结参考（shots） | 信封全过 |
| **P1 跑位四项** | 冻结参考（shots） | **信封全过**（进球 2.88、转化 9.01%） |
| **P2 传球链** | **goals per match left the calibration envelope** | **破进球下限**（2.38） |
| P3 | 冻结参考（pass completion） | 信封全过 |
| P4 | **penalty frequency** | 破点球下限（0.08） |
| P5 | **strong teams must retain a visible ability advantage** | 破强弱差 |
| P6 / P7 / P8 | **goals per match** | **破进球下限**（2.13 / 2.04 / 1.96），转化同时破 |
| P9 | **goals per match** | 破进球下限（2.21） |

⚠ P1 的转化 **9.01%** 只比下限 9% 高 **0.01 个百分点**。它「通过」是真的，但**极其脆弱**，
不能据此宣称跑位层可以独立合入而不做别的补偿。

## 5. 传球链内部：损失是摊开的，不是一条补丁

纯传球链阶梯（真基线 v253），每级只加一条补丁：

| 级 | 新增补丁 | under16 | 合计 | 进球 | 转化% | 禁区外% | d 合计 | d under16 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| v253 | — | 492 | 735 | 70 | 9.52 | 33.1 | — | — |
| Q1 | `defensive-pass-arrival` | 497 | 743 | 61 | 8.21 | 33.1 | **+8** | +5 |
| Q2 | `defensive-pass-plan` | 417 | 684 | 63 | 9.21 | 39.0 | **−59** | **−80** |
| Q3 | `defensive-pass-momentum` | 395 | 672 | 60 | 8.93 | 41.2 | −12 | −22 |
| Q4 | `defensive-pass-lifetime` | 395 | 672 | 60 | 8.93 | 41.2 | **0** | **0** |
| Q5 | `defensive-pass-release` | 399 | 656 | 58 | 8.84 | 39.2 | −16 | +4 |
| Q6 | `pass-interception-risk` | 377 | 630 | 60 | 9.52 | 40.2 | −26 | −22 |
| Q7 | `pass-risk-value` | 383 | 638 | 56 | 8.78 | 40.0 | +8 | +6 |

**没有任何单级越过 ±72 门槛**，最大的是 Q2 的 −59（近距离 −80）。也就是说，
损失由 **Q2 + Q3 + Q5 + Q6** 分摊，Q1 与 Q7 方向甚至相反。

**机制上这是一条自洽的链**，不是四个独立 bug：

- `defensive-pass-arrival`：防守球员**跑到观测到的球飞行轨迹上的可达点**去拦截
  （新增 `_defensivePassArrival(a)`，接进 `_thinkDefend` 的 `press` 分支）。
- `defensive-pass-plan` / `momentum` / `lifetime` / `release`：把这条到达任务做完整
  ——按可达到达而不是到旧球位的距离分配逼抢、用真实移动球员复核乐观估计、限制任务
  存活期、让已完成出脚对**所有**防守者在移动开始前可见。
- `pass-interception-risk`：传球评估**用与防守方相同的飞行、可达拦截与控制概率**
  折算价值：`value: option.value * (1 - interceptionRisk.probability)`。
- `pass-risk-value`：负的领地价值不应被生存乘数推向 0。

即「**防守方能真的在半路截球，进攻方也按这个概率给传球打折**」。这是一次系统性的
前向传球重新定价。因此**不能靠删掉某一条来修复**——要改的是整条拦截模型的强度，
或者在接受它的同时从别处补回机会质量。

### 5.1 `defensive-pass-lifetime` 是空补丁（可验证的冗余）

**Q3 与 Q4 的审计报告 18 个字段逐字段完全相同**（不只是进球和射门，包括传球、
犯规、越位、角球、门将指标全部一致）。源码确实被改了，所以不是补丁没打上。

原因是它的守卫被上游覆盖了。`_defensivePassArrival` 自己已经返回 null 于
`b.owner || b.state !== "pass" || b.kickTeam === a.team || b.isCrossPass || a.sentOff ||
a.injuredOff || a.role === "GK" || this.t < this.deadBallUntil || b.restartType`；
lifetime 追加的是 `!a.sentOff && !a.injuredOff && a.role !== "GK" && a.fsm === "press" &&
!b.restartType && !b.isCrossPass && t >= deadBallUntil`——**除 `a.fsm === "press"` 外全部是子集**，
而 `a.fsm = "press"` 正是在 `_thinkDefend` 里设置 `a._passIntercept` 的同一分支里赋的。

结论：这条补丁在当前配置下**没有可观测作用**，可以在下一次整理时删除或改写。

## 6. 非可加性：组合比两块之和更差

| 组合 | 射门 | 进球 |
|---|---:|---:|
| v253 | 735 | 70 |
| 只有跑位层 | 766 | 69 |
| 只有传球链 | 638 | 56 |
| 跑位层 + 传球链（= P2） | **621** | **57** |

把两块单独效果相加：`735 + 31 − 97 = 669`；实测组合是 **621**，比相加**再少 48 脚**。
这是混沌系统里常见的次可加（超加性伤害），也是**为什么必须逐级实测而不是把单独
效果相加**的直接证据。

## 7. 对下一步的直接影响

1. **跑位层可以单独成案**。它是唯一让射门供给变好的一层，且信封全过。
   但它的转化率只高出下限 0.01pp，所以成案时必须同时给出转化余量。
2. **传球链要作为一个整体决策**，不能挑一条删。若接受拦截模型，必须在别处补回
   16 米内的机会质量。
3. **门将三项是独立议题**：它们把转化率从 10.3% 打到 7.0%，是**扑救侧是否过强**的
   问题，与跑位无关。上一轮新做的门将「同一时刻接触」修复
   （[gk-same-instant-contact-2026-09-14.md](gk-same-instant-contact-2026-09-14.md)）
   同样属于这一类，量级只有 ±0.46pp（标准档），远小于这三项。
4. **`defensive-pass-lifetime` 可以清理。**

## 8. 仍未做

- 只跑了**标准档**。后台档（`dt = 0.3`）的对应阶梯未跑；上一轮已知两档结论会分叉。
- 只跑了 `equal-only` 的 24 场同强度；`strongVsWeak` 只在 P5 触发过一次断言，未逐级读。
- **没有改任何正式源码、护栏或冻结参考**，也没有把任何一层接入引擎。
- 前缀边际是**轨迹级**实测，不是因果效应估计：补丁会改变随机数消耗，因此每级都在
  不同的轨迹上。§6 的非可加性就是这件事的量化体现。

## 9. 复现

```text
# 闭包与阶梯定义
node scripts/_candidate-import-closure.mjs _backline-support-release-candidate.mjs

# 主阶梯（10 级，含 v253 基线级；3 个 worker，约 40 分钟）
LADDER_JOBS=3 node scripts/_subbundle-attribution-ladder.mjs standard 24 .tmp-continuity/subbundle-attribution/standard24

# 传球链阶梯（8 级，自带 v253 基线级）
LADDER_SET=passchain LADDER_JOBS=3 node scripts/_subbundle-attribution-ladder.mjs standard 24 .tmp-continuity/subbundle-attribution/passchain24

# 出表
node scripts/_subbundle-attribution-marginals.mjs .tmp-continuity/subbundle-attribution/standard24/ladder-standard24.json
BASELINE_LOG=.tmp-continuity/subbundle-attribution/standard24/P0-v253-baseline-standard24.log \
  node scripts/_subbundle-attribution-marginals.mjs .tmp-continuity/subbundle-attribution/passchain24/ladder-standard24.json

# 单级原始命令（阶梯每级就是这一条）
node --import ./scripts/_v253-baseline.mjs [--import ./scripts/<candidate>.mjs] scripts/match-realism-audit.mjs 24 standard
```

⚠ **每一级都预期退出 1。** v253 配对上冻结参考断言结构上必然失败（§4.1）；
要读的是**信封**断言与审计报告 JSON（在断言之前打印）。

⚠ 日志里 `{"xxxCandidate":…}` 加载行在审计报告之前输出，解析要从含 `distance`
字段的那段 JSON 开始（`_audit-log-bins.mjs` 已处理）。

## 10. 参考

- [movement-shot-supply-attribution-2026-09-14.md](movement-shot-supply-attribution-2026-09-14.md)
  — 上一轮「损失集中在近距离」的测量，本文更正其归因
- [gk-same-instant-contact-2026-09-14.md](gk-same-instant-contact-2026-09-14.md)
  — 门将「同一时刻接触」修复（扑救侧同类议题）
- [handoff-global-movement-2026-09-11.md](handoff-global-movement-2026-09-11.md)
  — 捆绑包状态与失败记录
- `scripts/_subbundle-attribution-ladder.mjs`、`scripts/_candidate-import-closure.mjs`、
  `scripts/_audit-log-bins.mjs`、`scripts/_subbundle-attribution-marginals.mjs`（本轮新增）
- `scripts/_v253-baseline.mjs` — 把 `js/` 钉到 `5f1d152`
- `scripts/match-realism-audit.mjs:416-439`（信封）、`:463-471`（冻结参考）
- 原始日志：`.tmp-continuity/subbundle-attribution/{standard24,passchain24}/`
