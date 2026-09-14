# 门将扫描扑救：同一时刻接触（2026-09-14）

交接文档 `docs/handoff-global-movement-2026-09-11.md` 的下一步第 1 项是复核
`scripts/goalkeeper-relative-contact-audit.mjs`：它复现了「移动门将的**步末位置**与球的
**步中投影点**混用」，但当时「只有受控失败证据，尚无修复，也未证明是进球偏低主因」。
本文把这三件事都补上：**缺陷确认、修复候选、以及对进球影响的定量否定**。

## 1. 缺陷

`js/sim/engine.js:5649-5662`：

```js
const x1 = b.x;                                          // 球：步末
const y1 = b.y;
const x0 = b._prevX;                                     // 球：步初
const y0 = b._prevY;
const segment = pitchVectorMetres(x1 - x0, y1 - y0);     // 球的步内位移
const offset = pitchVectorMetres(gk.x - x0, gk.y - y0);  // ← 门将用的是**步末**位置
let tt = clamp((offset.x * segment.x + offset.y * segment.y) / segLen2, 0, 1);
const cx = x0 + (x1 - x0) * tt;                          // 接触点落在**步中**
const cy = y0 + (y1 - y0) * tt;
const dPath = pitchDistanceBetween(gk.x, gk.y, cx, cy);  // ← 又用步末位置量距离
const lateral = Math.abs(gk.x - cx) * (SIM.PITCH_W_METRES / SIM.FIELD_W);
```

步内顺序是 `_integrate`（球员移动）→ `_separateAgents` → `_stepBall` → `_resolvePossession`
（`engine.js:1735-1755`）。所以到扑救判定时**球员和球都已在步末**，而只有球记了步初
（`b._prevX/_prevY`）。于是引擎等价于假设**门将整步都停在步末位置**，而球的接触点 `(cx, cy)`
可以落在步中。

正确模型是取步内**同一时刻**的最小距离：

```
d(t) = |B(t) − G(t)|,  t ∈ [0, dt]，B/G 各自按步内线性插值
```

## 2. 解析验证（手算对上引擎实测）

用审计第一个失败场景（`standard / across`）手算：

| 量 | 手算 | 引擎实测 |
|---|---:|---:|
| `tt` | 10.736 / 12.26 = **0.8757** | 0.8757 |
| `dPath` | **2.2772** | 2.2773 |

而同一时刻模型给 `tt = 0.8094`、`dPath = 2.2199`。**误差 +0.0574 m，方向是「引擎认为球更远」。**

## 3. 缺陷确认（HEAD 上就存在，不只是候选）

`goalkeeper-relative-contact-audit.mjs` 在**正式 HEAD** 上退出码 1：

| 运动 | 接触数 | 门将位移中位 | \|gapError\| 最大 |
|---|---:|---:|---:|
| `still`（静止） | 8 | 0.0000 m | **0.00000** |
| `along`（径向） | 8 | 0.4464 m | **0.00000** |
| `across`（横向） | 8 | 0.3639 m | **0.05736** |
| `diagonal`（斜向） | 8 | 0.4016 m | **0.03244** |

32 个场景 16 个失败，**只发生在门将有横向分量时**。静止和纯径向零误差。

## 4. 修复候选：`scripts/_gk-same-instant-contact-candidate.mjs`

四处改动：

1. `engine.js:1735` 的 agent 循环里，`_integrate` 之前记录 `a._stepStartX/_stepStartY`；
2. 接触几何改为**相对路径** `s = B0 − G0`、`d = (B1 − G1) − (B1 − G0)`，
   `tt = clamp(−(s·d)/|d|², 0, 1)`，再取 `B(tt)` 与 `G(tt)` 两点算 `dPath`/`lateral`；
3. 两个「门将还够不够得着」的门（`pastGk`、`ballCloserToLine`）同样改用 `G(tt)`；
4. 表现层（`diveDir`、`heading`）同步。

⚠ **候选在内存里把源码行尾从 CRLF 规范成 LF**——`js/sim/engine.js` 磁盘上是 CRLF，
多行标记不先规范就匹配不上（既有候选都只用单行标记，所以一直没暴露这个坑）。
因此候选报告的 `loadedEngineSha256` 是 **LF 规范版**哈希，与磁盘 blob 不同。

**候选下审计退出码 0**：32/32 通过，`|gapError|` 最大 **4.441e-15**、`|alpha差|` 恒为 **0**，
数值与同一时刻模型逐位一致。

## 5. 误差符号是**反对称**的

审计的 32 个场景有一个盲点：`keeper.x = 50 + side*2/mx` 且 `vx = side*3/mx`，
**门将永远朝远离球的一侧移动**。所以它不能回答「修了以后扑救变多还是变少」。
`scripts/_gk-contact-sweep-probe.mjs` 把几何双向扫开（81 个组合，球 35 m/s 沿球门方向）：

误差地图 `dPath − sameGap`（正 = 引擎认为球更远 → 少扑）：

| offX \ latMps | −4 | −2 | −1 | 0 | +1 | +2 | +4 |
|---|---:|---:|---:|---:|---:|---:|---:|
| −4 | +0.0751 | +0.0739 | +0.0486 | 0 | −0.0267 | −0.0320 | −0.0322 |
| −2 | +0.0644 | +0.0635 | +0.0432 | 0 | −0.0322 | −0.0425 | −0.0429 |
| −1 | +0.0590 | +0.0582 | +0.0404 | 0 | −0.0350 | −0.0477 | −0.0483 |
| 0 | +0.0537 | +0.0530 | +0.0377 | 0 | +0.0377 | +0.0530 | +0.0537 |
| +1 | −0.0483 | −0.0477 | −0.0350 | 0 | +0.0404 | +0.0582 | +0.0590 |
| +4 | −0.0322 | −0.0320 | −0.0267 | 0 | +0.0486 | +0.0739 | +0.0751 |

汇总（dt = 0.1）：

| 类别 | n | 误差中位 | 范围 | Δcover 中位 |
|---|---:|---:|---|---:|
| 门将静止 | 9 | 0.0000 | 0 | 0.0000 |
| **横向朝球移动** | 32 | **−0.0373** | [−0.0483, −0.0267] | **−0.0094** |
| **横向远离球** | 32 | **+0.0644** | [+0.0404, +0.0751] | **+0.0149** |
| 纯径向（offX = 0） | 8 | +0.0537 | [+0.0377, +0.0537] | +0.0135 |

即：**远离球 → 引擎少扑；朝球移动 → 引擎多扑。** 现实里门将通常是**朝球路移动**的
（那就是扑救本身），所以真实比赛的主导方向是**引擎多扑一点点**。

**81 个组合里 0 个翻转 `dPath > reach` 判定**——缺陷只影响扑救**质量**（`cover`），
不影响「扑/不扑」是否进入判定。

## 6. 对进球的影响：**不是标准档进球偏低的原因**

`pSave` 里 `cover` 的系数是 `0.28`，末尾再乘 `baseSaveCalibration = 0.94`
（`engine.js:5690-5721`），所以 `ΔpSave ≈ 0.28 × Δcover × 0.94`。

| 步长 | \|Δcover\| 最大 | \|ΔpSave\| 最大 |
|---|---:|---:|
| `dt = 0.1`（标准） | 0.0176 | **0.00462 = ±0.46 个百分点** |
| `dt = 0.3`（后台） | **0.2025** | **0.05331 = ±5.33 个百分点** |

后台档最坏组合：`offX = −2, latMps = −4` → `dPath 3.092` vs `sameGap 2.300`（`reach 3.911`），
`cover` 由 0.4121 被算成 0.2095。

**结论：**

1. **标准档（dt = 0.1）单脚射门的概率偏移 ≤ ±0.46 个百分点**，而进球 gate 从下限到基线的
   余量约 **0.38 球/场**。所以这个缺陷**不可能**是标准档进球偏低（2.21 / 2.16 对下限 2.5）的主因
   —— 交接文档「未证明是进球偏低主因」这一条，现在可以**定量地否定**了。
   不该为它单独烧一轮完整验收。
2. **但后台档（dt = 0.3）达到 ±5.33 个百分点，是标准档的约 11 倍。** 因为门将一步走过
   3 倍的地面。这是一个**档位相关误差**，属于「两档逐帧等价」要处理的那一类问题：
   引擎现在靠 `stepCorrection = clamp(1 − (dt − SIM.DT) × 1.5425, 0.65/0.94, 1)`
   （`engine.js:5710-5721`，注释已写明「Larger steps sweep a longer segment before this check
   and therefore need a numerical correction」）**用数值补偿掩盖同一类问题**。
   按同一时刻重算，这类补偿的需要本身就变小了。

## 7. 状态与下一步

### 7.1 几何判定：通过

**候选已通过它自己的判定标准**：32/32 场景，`|gapError|` 最大 4.441e-15，`|alpha差|` 恒为 0。
这证明修复在几何上是正确的。

### 7.2 统计护栏：两档都通过

**⚠ 第一次跑错了基线。** 首轮带了 `_v253-baseline.mjs`，而**HEAD 的引擎已不是 v253**
（见 §7.4），于是跑的是「旧引擎 + 补丁」，后台档报出
`penalty frequency left the calibration envelope`（`penalties 0.08` 对门槛 `≥0.1`）。
在**正确的 HEAD 基线**上重跑，四条全部退出 0：

| 指标（24 场） | HEAD 标准 | 候选 标准 | HEAD 后台 | 候选 后台 |
|---|---:|---:|---:|---:|
| 进球（门槛 2.5–3.3） | 2.75 | **2.71** ✅ | 2.88 | **2.92** ✅ |
| 射门 | 26.96 | 26.63 | 26.21 | 26.13 |
| 传球（800–1250） | 1056.92 | 1066.21 ✅ | 1006.46 | 1008.79 ✅ |
| 点球（0.1–0.5） | 0.17 | 0.13 ✅ | 0.25 | 0.25 ✅ |
| 角球（2.75–10） | 4.58 | 4.58 ✅ | 4.21 | 4.13 ✅ |
| 退出码 | 0 | **0** | 0 | **0** |

差异全部落在 n=24 的噪声内（进球每场 SD 1.645 → 24 场均值 SE **0.336**；
实测差 −0.04 / +0.04），与 §6 的预测一致：**修复对进球几乎无影响**。

九项冻结参考容差在两档、四个读数下都通过（退出码 0 即断言全过）。

### 7.3 结论与建议

1. **缺陷是真的**，且在正式 HEAD 上就存在，不只是候选。
2. **修复是正确的**（几何判定 32/32）。
3. **它不影响进球**：标准档单脚概率偏移 ≤ ±0.46 个百分点，护栏实测差 −0.04 / +0.04 球/场。
   所以交接文档「未证明是进球偏低主因」可以**定量否定**。
4. **它的价值在正确性与档位等价**：后台档偏移是标准档的约 11 倍，属于「两档逐帧等价」要处理的
   那一类；引擎现在用 `stepCorrection` 数值补偿掩盖同一类问题。
5. **建议**：与「提高射门供给」的候选**一起**合入，不要单独烧一轮完整验收
   （`verify --full` 约 52 分钟）。合入前仍需补：两档逐帧等价、缓存联动、`verify` 注册、
   正式 `--full`、桌面/手机实机。
6. **不要**为了这个修复去调 `reach`、`reflexes`、`handling` 或概率系数——§5 的符号地图
   说明该缺陷是**反对称**的，调系数只会把一侧压下去、把另一侧抬起来。

### 7.4 ⚠ 本轮发现的一处过期陈述

**HEAD 的 `js/sim/engine.js` 已经不是 v253**：与 `5f1d152` 相差 134 增 / 27 删，
来自 `e6567a8`（中卫线随球前压）、`0692c6a`（按防线高度缩放）、`2bd9fa5`（远侧边卫）。
`docs/handoff-global-movement-2026-09-11.md` 里「正式代码仍为已验收 vcfm-v253」与
「正式引擎 SHA-256 `7afe5e5f…`」只描述 2026-09-11 当时的快照。

- `scripts/_v253-baseline.mjs` 把 `js/` 全部退回 `5f1d152`，
  **只适合复现「全局跑位候选」的固定基线；测针对当前引擎的新修复时不要带它。**
- 该钩子返回 git blob（LF），工作区 `engine.js` 是 CRLF，两者
  `loadedEngineSha256` 不会相同（候选自身又会把行尾规范成 LF）。
- ⚠ **引用 24 场基线时必须注明是否带基线钩子。** 本轮 HEAD 标准档实测 **2.75**，
  而诊断文档 §5g 记录为 **2.88**；同一引擎同种子本应可复现，差额说明两次读数不是同一配置。
- **`_v253-baseline.mjs` 现在已经和当前的 `match-realism-audit.mjs` 不兼容。**
  实测「旧引擎 + 当前审计」标准档 24 场**退出 1**，失败断言是
  `standard shots diverged from the fixed-seed standard profile — the frozen
  STANDARD_PROFILE_REFERENCE_24 is stale`，**不是进球**。
  原因是九项冻结参考已为新引擎刷新过，旧引擎的射门数落在容差外。
  **所以交接文档里那条把 `_v253-baseline.mjs` 与 `match-realism-audit.mjs` 组合的命令
  会以「冻结参考过期」为由失败，不是引擎问题。**

### 7.5 顺带量到的：中卫线前压系列对射门供给的代价

同种子、同审计（标准档 24 场）：

| 引擎 | 进球 | **射门** | 传球 | 点球 | 角球 |
|---|---:|---:|---:|---:|---:|
| `5f1d152`（v253） | 2.92 | **30.63** | 1061.42 | 0.21 | 5.17 |
| HEAD（v253 + 中卫线前压三笔） | 2.75 | **26.96** | 1056.92 | 0.17 | 4.58 |

**射门 −3.67 脚/场（−12.0%）、进球 −0.17 球/场。** 也就是说已合入的
`e6567a8`/`0692c6a`/`2bd9fa5` 本身就让标准档的射门供给下降了约 12%。

把它与全局跑位候选（进球 2.21 / 2.16）放在一起看，趋势是一致的：
**队形与跑位的每一轮改进都在吃掉射门供给。** 这进一步支持 §5g.5 的方向 2 ——
**先把射门供给补回来，再谈队形**，否则后续每一轮都会撞在同一面墙上。

### 7.6 仍未做

- 两档逐帧等价、缓存联动、`verify` 注册、正式 `--full`、桌面/手机实机。
- 30 米以上远射、禁区贴防、角球、越位等其它套件未在候选下复跑。

## 8. 复现

```text
# 缺陷（正式 HEAD，预期退出 1）
node scripts/goalkeeper-relative-contact-audit.mjs

# 修复候选（预期退出 0）
node --import ./scripts/_gk-same-instant-contact-candidate.mjs scripts/goalkeeper-relative-contact-audit.mjs

# 误差符号地图（0.1 = 标准档步长，0.3 = 后台档步长）
node scripts/_gk-contact-sweep-probe.mjs 0.1
node scripts/_gk-contact-sweep-probe.mjs 0.3

# 统计护栏（两档）
node --import ./scripts/_gk-same-instant-contact-candidate.mjs scripts/match-realism-audit.mjs 24
node --import ./scripts/_gk-same-instant-contact-candidate.mjs scripts/match-realism-audit.mjs 24 background

# 对照：HEAD（不带任何钩子）
node scripts/match-realism-audit.mjs 24
node scripts/match-realism-audit.mjs 24 background
```

⚠ **不要**在测这个修复时带 `_v253-baseline.mjs`。带上它跑的是旧引擎，而且
「旧引擎 + 当前审计」会以冻结参考过期（`standard shots diverged …`）为由失败：

```text
# 复现这个陷阱（预期退出 1，失败在 shots 而非 goals）
node --import ./scripts/_v253-baseline.mjs scripts/match-realism-audit.mjs 24
```

## 9. 参考

- `js/sim/engine.js:5649-5662` — 接触几何（缺陷位置）
- `js/sim/engine.js:1735-1755` — 步内顺序（`_integrate` 在 `_resolvePossession` 之前）
- `js/sim/engine.js:5688-5721` — `cover` 与 `pSave`，含 `baseSaveCalibration` / `stepCorrection`
- `js/sim/engine.js:5699-5706` — 两个同样混用时刻的门（`pastGk`、`ballCloserToLine`）
- `scripts/goalkeeper-relative-contact-audit.mjs` — 受控失败复现（32 场景）
- `scripts/_gk-contact-sweep-probe.mjs` — 误差符号地图与量级（新增）
- `scripts/_gk-same-instant-contact-candidate.mjs` — 修复候选（新增）
- `docs/handoff-global-movement-2026-09-11.md` — 交接文档第 1 项
