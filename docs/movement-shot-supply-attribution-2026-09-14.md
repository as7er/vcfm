# 全局跑位候选为什么吃掉进球：射门供给归因（2026-09-14）

## 1. 问题

全局跑位候选（`scripts/_backline-support-release-candidate.mjs`）把六场的近静止率
53.7% → 33.1%、集体站定 35 → 2 段，但护栏两档皆红：标准档进球 **2.21**（下限 2.5）、
转化 **8.5%**（下限 9%）。交接文档把它记为「标准仍失败」，但没有说明**掉在哪里**。

本文回答这个问题，并且顺手更正上一轮一处**归因错误**。

## 2. 方法

- **同种子配对**：`match-realism-audit.mjs 24`，固定种子集，同审计、同参数。
- **同基线**：跑位候选的补丁系列是对着 v253 写的，它的标记在当前 HEAD 上已不存在
  （`_fullback-support-candidate.mjs:15` 的 `assert.ok(begin > 0 && end > begin)` 失败）。
  所以候选只能在 `_v253-baseline.mjs` 上跑。配对对象因此是
  **v253 vs v253 + 候选**，不是 HEAD。
- **逐段钉 revision**：新增 `scripts/_pin-engine-revision.mjs`（读 `VCFM_PIN_REV`），
  把 `js/` 钉到任意历史 revision，用来分离相邻两笔改动的归因。

复现命令见 §7。

## 3. 结果：损失集中在近距离射门

标准档 24 场，v253 vs v253 + 候选：

| 距离箱 | v253 脚 | 候选 脚 | 变化 | v253 转化 | 候选 转化 |
|---|---:|---:|---:|---:|---:|
| **< 16 m** | 492 | **386** | **−106（−21.5%）** | 10.2% | **9.1%** |
| 16–22 m | 218 | 199 | −19（−8.7%） | 8.7% | 8.0% |
| 22–30 m | 24 | **39** | **+15（+62.5%）** | 4.2% | 2.6% |
| 30 m+ | 1 | 3 | +2 | 0% | 33.3% |
| **合计** | **735**（30.63/场） | **627**（26.13/场） | **−108（−14.7%）** | **9.52%** | **8.45%** |

进球 **70 → 53（2.92 → 2.21）**，逐箱拆开是
**<16 m −15、16–22 m −3、22–30 m 0、30 m+ +1**。

**−108 的总射门损失里有 −106（98%）来自 16 米以内。**

参考尺度：`match-realism-audit.mjs` 自身对 `shots` 的冻结容差是 **±3 脚/场**
（24 场即 ±72 脚）。实测差 **−108 脚**，**超出该项目自己声明的容差**。

## 4. 转化率下降的分解：主要是「命中率」而不是「构成」

整体转化率 9.52% → 8.45%（**−1.07 个百分点**）。把它拆成两项：

| 成分 | 量 |
|---|---:|
| 构成效应（只把射门构成换成候选的，保留 v253 的各箱命中率） | **−0.24 pp** |
| 转化效应（在候选的构成下，各箱命中率本身的下降） | **−0.83 pp** |

也就是说：**构成外移只解释了约四分之一，四分之三是「同样距离的射门变难进了」。**

## 5. 结论

1. **候选不是「机会变少」，而是「门前机会变少」。** 总射门 −14.7%，但近距离 −21.5%
   而 22–30 m **+62.5%**、禁区外占比 33.1% → **38.4%**。射门被从门前推到了外围。
2. **两档损失叠加**：近距离射门少了 21.5%（数量），且近距离命中率从 10.2% 掉到 9.1%
   （质量）。两者相乘就是那 −15 个近距离进球。
3. **候选是一个 ~17 个子候选的捆绑包**（加载时依次报告 `wingCenteringCandidate`、
   `runnerOnlyCandidate`、`bylineRecoveryCandidate`、`passInterventionRiskCandidate`、
   `backlineSupportCandidate`、`movingPressTargetCandidate`、`goalkeeperReleaseCandidate`、
   `passSupportReleaseCandidate`、`fullbackSupportCandidate` …）。
   因此「跑位改进吃掉进球」这个说法**不够精确**——必须拆到子候选才知道是哪一条。
   项目自己在射门频率标定那轮已经写下过这条方法（
   [match-shot-frequency-2026-09-13.md](match-shot-frequency-2026-09-13.md)：
   「这两处与另外四处合在一起时互相补偿，净效果是射门不降反升——各自单独度量才看得出归因」）。

## 6. ⚠ 更正：射门下降的归因

本文早先版本（以及 `AGENTS.md` 与 `docs/gk-same-instant-contact-2026-09-14.md` §7.5 的
同一段）把 `5f1d152` → HEAD 的射门下降**整体归因给中卫线前压三笔**，这是**错的**。
逐段钉 revision 后：

| 引擎 | 总脚 | 总球 | 转化% |
|---|---:|---:|---:|
| `5f1d152`（v253） | 735 | 70 | 9.5 |
| `10378e3`（**射门频率标定**） | 671 | 68 | 10.1 |
| `75d9e4c`（中卫线前压**之前**） | **671** | **68** | 10.1 |
| HEAD（+ 中卫线前压三笔 + 远侧边卫） | 647 | 66 | 10.2 |

`10378e3` 与 `75d9e4c` **逐位相同** → **735 → 671 的 −64 脚（−8.7%）是有意的射门频率标定**，
目标是贴近真实英超约 26 次/场。中卫线前压三笔实际只贡献 **−24 脚（−3.6%）与 −2 球**，
且把转化结构从 16–22 m（10.5% → 7.3%）搬到了 <16 m（10.2% → **11.5%**），
量级在噪声内。

**教训：把两笔改动之间的差值直接归因给后一笔，会系统性放大后一笔的罪名。
必须逐段钉 revision。**

## 7. 复现

```text
# 配对主测：v253 vs v253 + 跑位候选（候选只能在 v253 基线上跑）
node --import ./scripts/_v253-baseline.mjs scripts/match-realism-audit.mjs 24
node --import ./scripts/_v253-baseline.mjs --import ./scripts/_backline-support-release-candidate.mjs scripts/match-realism-audit.mjs 24

# 逐段钉 revision（分离相邻两笔改动）
VCFM_PIN_REV=10378e3 node --import ./scripts/_pin-engine-revision.mjs scripts/match-realism-audit.mjs 24
VCFM_PIN_REV=75d9e4c node --import ./scripts/_pin-engine-revision.mjs scripts/match-realism-audit.mjs 24

# 当前 HEAD 对照
node scripts/match-realism-audit.mjs 24
```

⚠ 两条带钉 revision 的命令**预期退出 1**：`STANDARD_PROFILE_REFERENCE_24` 是为较新引擎
刷新的，旧 revision 会以「参考过期」失败。**审计报告 JSON 在断言之前打印**，
读分箱数据不受影响；但不要把那个退出码当作引擎结论。

⚠ 日志里 `{\"xxxCandidate\":…}` 这类加载行会在审计报告之前输出，解析时要从
审计报告那一段（含 `distance` 字段）开始，不能从文件开头取 JSON。

## 8. 参考

- `docs/match-shot-frequency-2026-09-13.md` — 射门频率标定（735 → 671 的来源）
- `docs/handoff-global-movement-2026-09-11.md` — 跑位候选的状态与失败记录
- `scripts/_pin-engine-revision.mjs` — 逐段钉 revision（新增）
- `scripts/_backline-support-release-candidate.mjs` — 候选捆绑包入口
- `scripts/match-realism-audit.mjs:206-209` — 距离分箱定义
- `scripts/match-realism-audit.mjs:471` — `shots` 冻结容差 ±3
