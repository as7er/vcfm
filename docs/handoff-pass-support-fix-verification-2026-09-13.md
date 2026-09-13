# 交接文档可靠性核查：`handoff-pass-support-fix-2026-09-13.md`

**核查时间**：2026-09-13 20:49–21:41
**被核查对象**：`docs/handoff-pass-support-fix-2026-09-13.md`（mtime 20:17）
**对应提交**：`f649b3d`（20:29，`js/sim/engine.js` +126/−5）
**核查方式**：静态比对 + 同机同 Node 的对照实验（非只读文档）

## 结论

**该文档不可作为续接依据。** 它的"问题背景/根本原因/修复内容"三节建立在两个不存在的文件上，
把一次 **126 行的行为改动**描述成"单点改动、风险较低"，并**完全遗漏**了它引入的真实后果：
当前 `master` 的标准档 24 场真实性审计已经失败。

可信度分级：

| 内容 | 判定 |
|---|---|
| 测试命令与结果（`npm test` 退出 0） | ✅ 实测为真 |
| 分支/日期/联系记录 | ✅ 为真 |
| 问题背景、根本原因、修复代码片段 | ❌ 文件与字符串均不存在 |
| "单点改动，风险较低" | ❌ 严重低估 |
| 改动带来的后果 | ❌ 完全遗漏（且是本次核查最重要的发现） |

## 一、虚构的部分

| 文档说法 | 实测 |
|---|---|
| 测试文件 `test/ai-decisions.test.mjs` | **不存在**。仓库无 `test/` 目录；全仓库仅 3 个 `*.test.js`，都在 `js/`（matchview-fsm / coords / director） |
| 修复文件 `js/ai/decisions.mjs` | **不存在**，连 `js/ai/` 目录都没有 |
| `offBallTargetKind = 'pass-support'` | `js/sim/engine.js` 中 `pass-support` 字符串出现 **0 次**；全仓库仅 4 个无关文件含该串 |
| `offBallTarget = { kind, receiverId }` | 实际为 `{ ...a.offBallTarget, x, y, fsm, kind }`，**无 `receiverId`**，`kind` 取值是 `third-man-run` / `cutback-outlet` |
| "测试在第 77 行检查 `offBallTarget?.kind`" | 行号与断言形式对得上，但真实位置是 `scripts/pass-support-audit.mjs:77`，期望值是 **`"third-man-run"`** |
| 参考模式 `js/ai/decisions.mjs:3738` | 真实参考是 `engine.js` 内的支援提议分支（`kind: "support-offer"`），模式描述大致成立，文件错 |
| Git 状态块 `M scripts/match-realism-audit.mjs`、`?? scripts/match-realism-baseline.json` | 这两项在 **18:01 的 `10378e3` 就已提交**，20:17 的快照不成立 |
| "下一步：可以提交" | 20:29 已提交 |

文档里列举的审计名（player names / habits / positions / squad numbers / roles / team shapes /
player control / collective defense / box defending / development football / manager phase-shape /
phase-shape evidence / scouting knowledge / corner structure）**大部分真实存在**；
`player-stillness-probe` 实为 `scripts/_player-stillness-probe.mjs`（下划线探针），
**不在 `npm test` 的检查列表里**。

## 二、`f649b3d` 实际做了什么

文档说是"只设了 kind、补一个对象"。实际改动分五类：

1. `_updateAttackIntent`：意图刷新改用 `Math.max(attackThinkUntil, offBallTargetUntil)`，**全局时序改动**。
2. `_applyPassSupport`：补 `offBallTarget`，并新增"过期清除"分支；MID 分支加
   `offBallTargetKind !== "midfield-late-run"` 守卫。
3. **新玩法**：`forward-burst` 激进前插（`this.random() < 0.55 + …`，冲刺 24–32 m）。
4. **新玩法**：`deepRun` 深度前插（`this.random() < 0.58 + …`，并改写了 depth 公式）。
5. **四段调试 `console.log` 留在提交里**，其中 `_integrateMotion` 的一处守卫写成
   `!this.ball.owner !== a.id` —— `!` 的结果是布尔值，与 id 比较**恒为真**，该过滤条件失效。

第 3、4 项各引入一次新的 `this.random()` 消耗，**会整体平移随机流**，因此所有下游统计都会变。

### 修复前审计为什么也通过

`pass-support-audit.mjs` 在 `10378e3` 与 `HEAD` 之间**字节相同**，且在**两个版本上都退出 0**。
探针显示修复前 `offBallTarget.kind` 已经是 `"third-man-run"`：

```
PROBE offBallTarget= {"x":74.4,"y":15.05,"fsm":"support","kind":"third-man-run",…} kind= third-man-run
```

原因：`engine.js:1414` 早已有 `candidate: { x, y, fsm, kind: a.offBallTargetKind }`，
经 1428 行写入 `a.offBallTarget`。**所谓"失败测试"并不存在，修复在这条路径上是冗余的。**

## 三、被遗漏的后果（本次核查的核心发现）

`f649b3d` 之后，**标准档 24 场真实性审计失败**：

```
AssertionError [ERR_ASSERTION]: goals per match left the calibration envelope
  at scripts/match-realism-audit.mjs:416:8
REALISM_EXIT=1
```

| 指标 | `10378e3`（修复前） | `f649b3d`（当前 HEAD） | 绝对护栏 |
|---|---:|---:|---|
| 进球/场 | **2.83** | **2.17** | 2.5 – 3.3 ❌ |
| 转化率 | **10.1%** | **8.5%** | 9 – 15 ❌ |
| 射门/场 | 27.96 | 25.58 | 参考 26.25 ±3 ✅ |
| 门将出击得球 | 14.38 | 8.88 | 参考 14.21 ±2 ❌ |
| 门将出击对抗 | 6.00 | 4.75 | 参考 7.83 ±2 ❌ |
| 犯规/场 | 26.17 | 23.54 | 参考 26.42 ±6 ✅ |
| 角球/场 | 5.29 | 4.17 | 2.75 – 10 ✅ |
| 禁区外射门占比 | 28.6% | 35.5% | 25 – 50 ✅ |
| 强队积分 | 1.79 | 1.63 | ≥1.5 ✅ |
| 退出码 | **0** | **1** | |

### 对照实验设计（排除环境混淆）

两次运行使用**同一 Node v22.22.2**、**同一份审计脚本与内联基准常量**
（`STANDARD_PROFILE_REFERENCE_24` 硬编码在 `match-realism-audit.mjs:62`，两版本一致；
`match-realism-baseline.json` 实际不被任何脚本读取）、同一批固定种子（165000+）。
修复前代码用 `git worktree` 检出 `10378e3` 后原地运行。

随机源是整数运算的 mulberry32，跨 V8 版本可复现；先排除 Node 版本差异后，
唯一变量就是 `engine.js` 的这 126 行。**结论：失败由 `f649b3d` 引入，不是环境差异。**

### 两个护栏的性质不同

- `goals 2.17` 与 `conversion 8.5%` 跌破的是**绝对真实性上下界**，不是相对基准容差。
  因此**不能靠"有意刷新 `STANDARD_PROFILE_REFERENCE_24`"来消掉**——刷新只影响
  `referenceDelta` 那类相对断言，绝对护栏仍然会失败。行为本身必须修。
- 默认 `verify`（`npm test`）**不包含** 24 场真实性审计，它只在 `--full` 里。
  所以"`npm test` 全绿"与"发布级标定已破"可以同时成立。

## 四、其它实测数据

- `node scripts/verify.mjs`（默认）：**退出码 0**，末行 `VCFM verification passed`，
  共 **206** 项检查。文档这条自述属实。
- 单次默认 verify 期间，调试 `console.log` 产生 **28 389 行**输出，占日志总量约 **90%**。
- 但短审计耗时差异不大（`pass-support-audit` 前后均约 0.59 s），
  **不宜把"测试慢"归因于调试输出**；51 分钟的耗时来自检查项数量。
- 18:01 那次射门频率标定本身没问题：`10378e3` 在我这边复跑退出 0，
  九项参考容差全部通过。问题出在它之后。

## 五、消融实验（已完成，定位到单一原因）

四个变体各自从 `HEAD` 检出独立工作树，只改 `js/sim/engine.js` 的一处，其余完全一致：

- `burst off`：`const burstRun = false;`（短路后不再消耗那次 `random()`）
- `deepRun off`：`const deepRun = false;`
- `both off`：两者都关
- `debug removed`：只把 5 处 `console.log` 替换为注释，逻辑一字不改

| 变体 | 退出 | 进球 | 射门 | 转化 | 门将得球 | 门将对抗 | 犯规 | 角球 | 禁区外% | 强队积分 | 传球 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `HEAD` f649b3d | **1** | 2.17 | 25.58 | 8.5 | 8.88 | 4.75 | 23.54 | 4.17 | 35.5 | 1.63 | 1013.21 |
| **`burst off`** | **0** | **2.58** | 26.63 | **9.7** | 13.00 | 4.96 | 25.58 | 4.46 | 34.6 | 1.79 | 1055.08 |
| `deepRun off` | 1 | 2.08 | 25.38 | 8.2 | 8.88 | 5.08 | 25.96 | 4.25 | 35.5 | 2.21 | 1005.71 |
| `both off` | 1 | 2.58 | 26.58 | 9.7 | 12.96 | 6.42 | 26.42 | 5.04 | 30.9 | 2.38 | 1054.92 |
| `debug removed` | 1 | 2.17 | 25.58 | 8.5 | 8.88 | 4.75 | 23.54 | 4.17 | 35.5 | 1.63 | 1013.21 |

九项参考偏差（容差：goals ±0.55、shots ±3、passes ±100、passCompletionPct ±2、fouls ±6、
openGoalShots ±0.65、gkClaims ±4、gkChallenges ±3、strongPointsPerMatch ±0.5）：

| 变体 | goals | gkClaims | gkChallenges | strong | 判定 |
|---|---:|---:|---:|---:|---|
| `HEAD` | −0.54 | **−5.33** ✗ | **−3.08** ✗ | −0.12 | 破两项参考 + 破绝对下界 |
| **`burst off`** | −0.13 | −1.21 | −2.87 | +0.04 | **九项全过** |
| `deepRun off` | **−0.63** ✗ | −5.33 ✗ | −2.75 | +0.46 | 破 |
| `both off` | −0.13 | −1.25 | −1.41 | **+0.63** ✗ | 破强队分离 |

### 三条结论

1. **`forward-burst` 是唯一原因。** 只关它一项即从退出 1 变为退出 0，进球 2.17→2.58、
   转化 8.5%→9.7%，九项参考偏差全部回到容差内。
2. **`deepRun` 不是这次失败的原因**，但它也不是无害的：关掉它反而让进球掉到 2.08。
   两个新特性各自都在消耗新的随机数，都会平移整条随机流。
3. **`debug removed` 与 `HEAD` 的十项指标逐位相同**，证明那 5 处 `console.log` 是
   行为中性的——删除它们是零风险操作。

注意 `burst off` 的 `gkChallenges −2.87` 距 ±3 上限只剩 0.13，属于擦线通过；
`both off` 的 `strongPointsPerMatch +0.63` 说明"强队分离度"对这两个特性都很敏感。
这些都只基于单次 24 场样本，不宜据此下强结论。

## 六、后续补充：后台档推翻了"只关 forward-burst"的结论

上面的消融只测了标准档。按标准档结论实施"只删 `forward-burst` + 删调试输出"后，
`node scripts/verify.mjs --full` **仍然退出 1**——失败的是后台档
（`timeStep = 0.3`、`separationPasses = 4`）：

| 版本 | 标准档 | 后台档 |
|---|---|---|
| `10378e3` | 退出 0，2.83 球 / 10.1% | **退出 0**，2.67 球 / 10.5% |
| `f649b3d`（HEAD） | 退出 1，2.17 球 / 8.5% | 退出 1，3.04 球 / 12.6%（强队 1.42 < 1.5） |
| 只删 burst | 退出 0，2.58 球 / 9.7% | 退出 1，**2.13 球** / 8.6% |

后台档逐项归因（在"已删 burst"基础上再单独关一处）：

| 变体 | 退出 | 进球 | 转化 | 强队积分 | 失败点 |
|---|---:|---:|---:|---:|---|
| 关 `deepRun` | 1 | 2.38 | 9.4 | 1.79 | 进球 < 2.5 |
| 关缓存早退 | 1 | 2.13 | 8.6 | 1.88 | 进球 < 2.5（与不关完全相同） |
| 关 `protectedUntil` | 1 | 2.29 | 8.7 | 1.75 | 进球 < 2.5 |
| 关 `deepRun` + `protectedUntil` | 1 | 2.71 | 10.5 | **1.42** | 强队分离 < 1.5 |

**没有任何单项或组合方案能同时通过两档。** `forward-burst` 在两档上方向相反
（标准档删掉 +0.41 球，后台档删掉 −0.91 球），缓存改动在后台档完全不触发，
组合方案救回进球却撞上与 HEAD 同一个强队分离度失败点。

## 七、修订后的建议

1. **完整回退 `f649b3d`**（`git checkout 10378e3 -- js/sim/engine.js`）是唯一让两档
   都回到退出 0 的配置，已实施。见
   [match-f649b3d-revert-2026-09-13.md](match-f649b3d-revert-2026-09-13.md)。
2. **不要把 `f649b3d` 当成"传球支援修复"**：它在真实路径上是冗余的，
   真实内容是缓存 + 两个未标定的新玩法 + 调试残留，且同时打破两档标定。
3. 若产品上确实要保留 `forward-burst` / `deepRun` / 目标缓存，必须**逐个单独标定两档**，
   且保证进球仍在 2.5–3.3 的**绝对**区间内——绝对护栏不能靠刷新基准消除。
4. 回退后按项目流程补：`--full`、两档逐帧等价、缓存联动、浏览器实机。
5. 修订 `AGENTS.md` 顶部：它仍停留在 09-11 全局跑位交接，与当前状态脱节（已更新）。
6. 本机 `.tmp-continuity/global-movement/current-standard.json`（19:22）**不能代表当前 HEAD**。
   它记录的 `engineSha256 = d667c52c…` 与三个已提交版本都不吻合
   （`HEAD` blob `a5e1f30c…`、工作区 CRLF `cc87a5ff…`、`10378e3` blob `cef4c387…`），
   说明它测的是一份**已不存在的工作区 `engine.js`**（可能是当时未提交的中间状态）。
   在弄清它的来源之前，不要把它当作任何版本的基线。

## 证据文件

- `.tmp-continuity/handoff-verify/f649b3d-run.log` —— 当前 HEAD：真实性审计退出 1 + 默认 verify 退出 0
- `.tmp-continuity/handoff-verify/prefix-realism.log` —— `10378e3` 对照：真实性审计退出 0
- 对照工作树已清理（`git worktree list` 仅剩 `F:/VCFM f649b3d [master]`），工作区未改动源码
