# 个人电脑交接：全局跑位（2026-09-11）

用户下班前要求先交接，到家后继续。此前要求的 v253 提交推送已由 `5f1d152`
完成，之后快进了 README 地址修订 `5b1f711`。本次保存调查代码、失败结果和
可恢复证据；**全局跑位尚未完成，最新候选不能合入正式游戏。**

## 到家后的入口

在个人电脑已有仓库、工作区干净时执行：

```text
git switch master
git pull --ff-only
node --version
node scripts/_handoff-global-movement.mjs restore
```

本机使用 Node **24.18.0**；候选依赖 `node:module.registerHooks`，建议使用同版本。
诊断脚本不需要启动浏览器或安装 Playwright。若个人电脑有自己的未提交修改，先保留，
不要用 reset/clean 覆盖。首次克隆可用 `git clone https://github.com/as7er/VCFM.git`。

给下一次会话的提示：

> 继续全局跑位任务，先读 AGENTS.md 顶部和 docs/handoff-global-movement-2026-09-11.md。
> 当前候选是 _backline-support-release-candidate.mjs，96 场扩样已完成，标准仍失败。
> 不要重复提交 v253，不要重跑已归档扩样，不要把候选当成正式修复。

## 当前代码状态

- 正式代码仍为已验收 **vcfm-v253**。本轮没有改 `js/sim/engine.js`、`js/data.js`、
  `js/player-positions.js`、缓存、统计护栏或冻结参考。
- 正式引擎 SHA-256：`7afe5e5fb42e5390e71f1f94bee4d176501c9a29d39b790b1dfbbbbf44661fb1`。

> ⚠ **2026-09-14 更正（本条已过期，测新修复时务必先读）：** 交接之后引擎已继续前进，
> **HEAD 的 `js/sim/engine.js` 不再是 v253**——与 `5f1d152` 相差 134 增 / 27 删，
> 来自 `e6567a8`（中卫线随球前压）、`0692c6a`（按防线高度缩放）、`2bd9fa5`（远侧边卫）
> 三笔队形改动。因此本文里的「正式引擎 SHA-256」与「正式代码仍为 vcfm-v253」只描述
> **2026-09-11 当时的快照**。
> **`scripts/_v253-baseline.mjs` 会把 `js/` 全部退回 `5f1d152`，它只适合复现
> *全局跑位候选* 的固定基线；测一个针对当前引擎的新修复时不要带它**（带了就是在旧引擎上测）。
> 另外该钩子返回的是 git blob（LF），而工作区 `engine.js` 是 CRLF，两者的
> `loadedEngineSha256` 不会相同。
- 最新完整候选：`scripts/_backline-support-release-candidate.mjs`。
- 最新生效引擎 SHA-256：`b4fb0e92c7b25904ccc18ff039bc6e5c51540ded60c7337b8c7436a68e654b50`。
- 候选依赖都在 scripts 中；`_v253-baseline.mjs` 可从提交 `5f1d152` 还原 JS 基线。
  日志末尾的 `fullbackSupportCandidate` 是内层加载器哈希，不能拿它当最终引擎哈希。
- 新增审计多数是候选/反例入口，未注册到默认 verify；有意失败的复现不等于正式套件退化。
- 下班交接时全部运行结果已收取，没有待接管的比赛进程。`finalValidation` 仍为 `null`。

## 已确认的结果

| 最新候选 | 标准 | 后台 |
|---|---:|---:|
| 原 24 同强度 + 24 强弱：进球 | **2.21** | 2.75 |
| 原 24：转化率 | **8.5%** | 10.8% |
| 原 24：强队积分 | 2.00 | **1.42** |
| 原 24：结论 | 失败 | 失败 |
| 连续 96 + 96：进球 | **2.16** | 2.58 |
| 连续 96：转化率 | **8.2%** | 10.0% |
| 连续 96：强队积分 | 1.59 | 1.70 |
| 连续 96：诊断退出码 | 1 | 0 |

扩样是四个连续窗口 offset 0/24/48/72，全部保留。两档首窗口精确复现原 24 场。
标准进球/转化偏低持续存在；后台扩样通过不能抹掉原 24 场失败，未更改验收要求。

六场全局运动对照（种子 `372000..372005`）：

| 指标 | v253 标准 / 后台 | 最新候选标准 / 后台 |
|---|---|---|
| 历史近静止率 | 53.660% / 53.389% | 33.104% / 35.345% |
| 前场同时移动人数中位 | 2 / 2 | 3 / 3 |
| 集体站定至少 2 秒 | 35 / 13 段 | 2 / 0 段 |
| 长片段中过半无接应 | 14 / 4 段 | 0 / 0 段 |
| 目标领先中位 | −10.987 / −10.594 m | −9.732 / −10.402 m |
| 领先至少 5 m 占比 | 9.366% / 10.161% | 13.324% / 12.526% |

每档全局观测只在首场做无扰动逐帧对照。最新候选尚未重跑禁区、贴防、角球、越位、
完整运动审计或浏览器；不得套用旧候选的通过结果。

## 下一步，按这个节点继续

1. 先复核 `scripts/goalkeeper-relative-contact-audit.mjs`。32 个受控场景沿真实
   step、球员运动和球物理运行，仅关闭战术重新选点；当前版把门将步末位置与球的
   步中投影点比较，复现失败已保存。尚无修复候选，也未证明它是进球偏低的主因。
2. 最新两档各六场的实际射门已保存。标准 160 脚、后台 156 脚。标准首场开关观测的
   54000 帧、终态值、事件、比分与 190275 次随机调用一致；V8 二进制 hash 不同是
   编码差异，不能只比较旧 stateHash。后台射门观测尚无单独的逐帧无扰动核对。
3. 基于保存的场景检查相对运动、接触时刻和真实出脚质量；不要调射门精度、球员能力、
   跑速或概率来凑统计，也不要扫描深度参数。原反应时钟/球高/第三人出脚通知都已在
   当前候选中修正；第三人之前存在依赖球员数组顺序的实际迟发，不要重做旧假设。
4. 如后续候选通过原真实性范围，再完成该版禁区、贴防、角球、越位、运动验证。
   之后才是正式整合、两档逐帧等价、缓存联动、verify 注册、正式 `--full` 与桌面/手机实机。

## 可直接用的命令

恢复证据后，只读已有结果，不重新模拟：

```text
node scripts/_global-movement-read-checks.mjs support-release-realism-standard support-release-realism-background support-expanded-standard-summary support-expanded-background-summary
node scripts/_global-movement-report.mjs v253 support-release
node scripts/_goalkeeper-contact-analysis.mjs .tmp-continuity/shot-chain/6-standard-1789118905997.json .tmp-continuity/global-movement/checks/support-shot-trace-standard.log .tmp-continuity/global-movement/checks/support-shot-trace-unobserved-standard.log
```

复核新受控失败（当前预期退出 1）：

```text
node --import ./scripts/_v253-baseline.mjs --import ./scripts/_backline-support-release-candidate.mjs scripts/goalkeeper-relative-contact-audit.mjs
```

新检查用唯一标签记录，包装器拒绝覆盖旧日志：

```text
node scripts/_global-movement-check.mjs home-new-label --import ./scripts/_v253-baseline.mjs --import ./scripts/_backline-support-release-candidate.mjs scripts/goalkeeper-relative-contact-audit.mjs
```

不要在包装器参数里再加一个 `node`。Windows 读取用 `Get-Content`，搜索用 `rg`；
不要用 PowerShell 变量、分号或管道拼接读取。本轮不使用子代理。

## 证据与限制

- 调查全文：[match-global-movement-2026-09-10.md](match-global-movement-2026-09-10.md)。
- 完整结构化检查摘要及成功/失败记录：
  [match-global-movement-2026-09-10.json](evidence/match-global-movement-2026-09-10.json)。
- 跨电脑压缩包与文件清单位于 `docs/evidence/global-movement-handoff-2026-09-11/`；
  三个包合计约 10.53 MiB，含 386 项检查的完整日志/元数据、4 份跑位原始报告、
  7 份射门 JSON 和 3 份出脚状态二进制，共 1172 个文件。恢复脚本逐项校验 SHA-256，
  同名文件内容不同就停止，保留个人电脑已有数据。
- `.tmp-continuity/` 本身不入 Git。压缩包只收录交接所需的证据，完整旧检查摘要在
  结构化 JSON 中。恢复后不要直接运行旧归档器覆盖该完整摘要；本机还有未打包的历史素材。
- 当前候选加载较多退出报告钩子，有 `MaxListenersExceededWarning`。原警告已保留，
  它没有令本次采样退出失败，尚未整理这项工具层问题。
- 本次交接已验证压缩包全部 1172 个文件，并在全新目录完整恢复。固定 v253 基线加载
  最新候选得到相同的生效引擎哈希。完整摘要覆盖 386 项检查和 69 份观测摘要。
- 不要把本次交接提交写成“全局跑位已修复”或“完整验收通过”。
