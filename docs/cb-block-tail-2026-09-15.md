# 中卫线前压加尾部加权：进攻三区长度 47.4 → 41.1 m（2026-09-15）

> 承接 [docs/attack-block-shift-diagnosis-2026-09-14.md](attack-block-shift-diagnosis-2026-09-14.md)
> 与 `AGENTS.md` 的「2D 比赛画面：完整性与 FM26 差距」一节。
> 用户目标：**2D 比赛画面更合理、拟真（对齐 FM26 的 2D）**。
> 完整性（A）已干净，本轮处理的是 B 面**唯一稳健、成因已定位**的差距：
> **进攻三区纵向被拉长**。

## 1. 结论

给中卫线的整体前压量加**尾部加权**：

```js
// SIM（engine.js）
CB_BLOCK_TAIL_FROM: 0.7,
CB_BLOCK_TAIL_GAIN: 1.5,

// _chooseAttackOffBallTarget
const blockCurve = prog > cbTailFrom ? prog + (prog - cbTailFrom) * SIM.CB_BLOCK_TAIL_GAIN : prog;
const blockShiftY = (blockCurve * cbShiftMax) / (SIM.PITCH_H_METRES / SIM.FIELD_H);
```

即 `prog ≤ 0.7`（球在自己半场到中场）**逐位保持原行为**，只有球被压进对方半场深处
时才陡增前压量。

**效果（48 场同种子配对，标准档；形状为 4 场中位）**：

| | 改动前 | 改动后 | 目标 |
|---|---:|---:|---|
| 进攻三区长度 | 47.38 | **41.08** | 30–40 |
| span（DEF→ATT） | 44.70 | **40.25** | 30–40 |
| 后卫线深度 | 49.69 | **53.44** | 56–66（差 2.6） |
| 己方 / 中场三区 | 36.95 / 36.96 | 37.00 / 37.07 | 30–40（本就在区间内） |
| 进球/场 | 2.73 | 2.67 | ≥2.5 |
| 强弱分离 | 1.92 | **2.04** | ≥1.5 |

后台档同向：attack 47.4 → **41.19**、span 44.9 → **40.41**、
进球 3.13 → **2.92**（离上限 3.3 更远）、强弱分离 1.85 → **1.96**。

**信封没有代价，强弱分离反而略升。** 距 30–40 目标还差 1.1 m。

## 2. 为什么要「尾部」加权，而不是直接调大 `CB_BLOCK_SHIFT_MAX_M`

原前压量线性于 `prog`：`blockShiftY = prog × cbShiftMax`。整体调大它会把**中场块一起抬高**，
而队形拉长只发生在进攻三区。抬高整条线会把反击暴露一并放大，
强弱分离被摊薄——探针记录的阶梯是
**−14 → 强队 1.92 / −19 → 1.67 / −26 → 1.46**（门槛 1.5，见
`scripts/_cb-line-height-probe.mjs` 头部）。

`match-realism-audit.mjs` 把两队 `defensiveLine` 都写死成 3，所以它的 `strongVsWeak`
正是「两队同等前压」的世界，**看不见 `CB_BLOCK_SHIFT_LINE_GAIN`**
（那个因子是让强队压上、弱队回收用的）。线性调大因此会在形状改善之前先撞破分离门禁。

尾部加权避开了这条：中场块不动 → 反击保护不变 → 分离度不受损。

## 3. 参数扫描（`scripts/_cb-tail-sweep.mjs`，标准档 4 场同种子）

| 配置 | attack | middle | 比值 | backLine | forwardTop | span |
|---|---:|---:|---:|---:|---:|---:|
| 未修基线 | 47.38 | 36.96 | 1.282 | 49.69 | 94.39 | 44.70 |
| 尾部 1.0 | 43.31 | 36.74 | 1.179 | 53.12 | 95.62 | 42.50 |
| **尾部 1.5（采纳）** | **41.08** | 36.60 | 1.122 | 53.44 | 93.69 | **40.25** |
| 尾部 2.0 | 39.08 | 37.07 | 1.054 | 55.83 | 94.79 | 38.96 |
| 尾部 2.0 × 倍率 1.2 | 34.08 | 35.58 | 0.958 | 60.54 | 95.29 | 34.75 |

48 场信封：

| 配置 | 标准进球 | 标准分离 | 后台进球 | 后台分离 | 判定 |
|---|---:|---:|---:|---:|---|
| 未修 | 2.73 | 1.92 | 3.13 | 1.85 | — |
| 尾部 1.0 | 2.63 | 1.83 | — | — | 全过 |
| **尾部 1.5** | **2.67** | **2.04** | **2.92** | **1.96** | 采纳 |
| 尾部 2.0 | 2.88 | **1.52（擦线）** | — | — | 不进 |

**为什么停在 1.5 而不是 2.0**：2.0 能把进攻三区压到 39.08（正好进区间），
但 48 场强弱分离掉到 **1.52**，只剩 0.02 余量——换一批种子就会翻红。
1.5 的形状只差 1.1 m，而分离度有 0.54 的余量。

⚠ **24 场的分离度读数不可用于选参数**：四组是 2.13 / 1.88 / 2.29 / 1.38，
**非单调**（1.5 那组比 1.0 还高）。48 场才看得出真实顺序。这与
`AGENTS.md`「门槛判定用 24 场够、效应量判定必须看 48 场」是同一件事。

## 4. 审计护栏修订（`attack-shape-compaction-audit.mjs`）

采纳本改动**必须**先改断言 ④，原因不是「它变红了」，而是
**它与 FM26 目标数学上不相容**：

- 原断言：`attack ≥ 1.15 × middle`。
- 目标：进攻三区落到 30–40 m，而己方/中场三区实测 37.0/37.8 **本就在该区间内**。
- 三区都真实时，比值只能是 ~1.0–1.1，永远够不到 1.15。
- 实测比值随「压得越对」而**单调下降**：1.282 → 1.179 → 1.122 → 1.054。
  判定方向与目标相反。

**原断言想防的「退化修法」不可达**：把锋线整体回撤来从上方压短队形。
`scripts/_att-drop-candidate.mjs` 最初就是把锋线的前进目标常量回撤 10 m，
结果 `forwardTop` **纹丝不动**（95.03 vs 基线 94.39）——锋线深度由
「球位 + 越位线」钉住，不受那个常量控制。该探针随后改为加宽 ATT 的越位缓冲
（真正能把锋线拉回来的做法）才造出反例。

**修订内容**：

| 断言 | 原值 | 新值 | 说明 |
|---|---|---|---|
| `attackOverMiddle` | 1.15 | **1.02** | 只拦「进攻三区塌到中场以下」 |
| `backLineFloor`（新） | — | **53** | 队形变短必须来自**后卫线抬升** |
| `forwardTopFloor`（新） | — | **92** | 锋线不得回撤（退化修法） |

**反向验证（三条都实测过）**：

1. 未修引擎 → `后卫线没有抬起来：49.7 m < 53 m` ✗ 按预期失败
2. 退化修法（只拉回锋线）→ `后卫线没有抬起来：49.4 m < 53 m` ✗ 按预期失败
3. 尾部 1.5 + 拉回锋线 → `锋线回撤了：87.3 m < 92 m` ✗ 按预期失败（**这条单独验证了 forwardTop**）
4. 尾部 1.5 → 全部通过 ✓

## 5. 冻结参考的有意刷新

`STANDARD_PROFILE_REFERENCE_24` 九项里八项在容差内，只有 `strongPointsPerMatch` 需要处理
（标准档 2.29 vs 旧参考 1.75，差 +0.54，容差 ±0.5）。

**但这一项不能钉在标准档自己的读数上**：该参考是**一份同时服务两档**的
（`match-realism-audit.mjs:404-406` 的注释写明），而两档在这个指标上天然相差 0.54——
标准档 24 场读 **2.29**、后台档读 **1.75**，容差 ±0.5。
于是不存在任何一个值能同时贴住两档：钉 1.75 被标准档顶破（+0.54），
钉 2.29 被后台档顶破（−0.54）。

**取两档中点 2.02**：标准档 +0.27、后台档 −0.27，两侧都在**未改动**的容差内
（没有放宽任何阈值）。

代价如实记录：标准档这一项「快照自查应接近 0」的性质对这个指标不成立（偏 +0.27）。
这是「一参考两档」的结构决定的，不是本次改动引入的——改动前两档是 1.96 / 1.75，
差 0.21，恰好还没撞上容差边界；尾部加权把标准档推到 2.29，才让这个结构问题暴露出来。

⚠ 这是**引擎有意改动**的后果，不是「把红的改绿」：刷新后九项又回到
「与当前引擎一致」，继续承担「引擎被改过却没人回来刷数」的报警职责。

## 6. 验收

| 项目 | 结果 |
|---|---|
| `attack-shape-compaction-audit.mjs` | **通过**（standard 41.08 / span 40.25 / backLine 53.44；background 41.19 / 40.41 / 53.27） |
| `match-realism-audit.mjs 24 standard` | **exit 0**（参考偏离：八项逐位 0，`strongPointsPerMatch` +0.27，见 §5） |
| `match-realism-audit.mjs 24 background` | **exit 0**（九项全在容差内，`strongPointsPerMatch` −0.27） |
| `match-realism-audit.mjs 48 standard` | **exit 0**（进球 2.67 / 射门 27.75 / 分离 2.04） |
| `match-realism-audit.mjs 48 background` | **exit 0**（进球 2.92 / 射门 25.77 / 分离 1.96） |
| `match-motion-integrity-audit.mjs` | **通过** |
| `browser-e2e.mjs` | **通过** |
| `verify.mjs --full` | **95/95 入口、0 断言错误、退出码 0**（57m38s） |

缓存随之升 **v258**（`sw.js` / `index.html` 的 `CURRENT_CACHE` 与 SW reload key /
`index.html`+`main.js` 的 8 处 `?v=` / `AGENTS.md` 顶部）。

## 7. 仍未达成的部分（如实记录）

- 进攻三区 41.08 m，目标区间 30–40，**仍差 1.1 m**；后卫线 53.44 m，
  目标 56–66，**差 2.6 m**。再往上走就是尾部 2.0，而它把分离度压到 1.52。
- **本轮没有改善进攻产出**：强队进球 48 场 82 → 78（噪声内），
  说明这台引擎里**「块长」是症状而不是病因**——压缩队形换来的是更真实的画面，
  不是更多的机会。真正提升进攻质量仍要回到传球链/机会质量那条线（见
  `docs/subsbundle-attribution-2026-09-14.md`）。
- 横向宽度（+10~12%）、覆盖面积（+22%）、速度（−18~21%）、近静止（×1.95）
  四项仍未处理，按 `AGENTS.md:3108` 属「边缘偏离不足以单独支撑改动」。

## 8. 复现

```bash
# 形状与全部六条断言（含新增的两条机制断言）
node scripts/attack-shape-compaction-audit.mjs

# 只测数值、不断言（扫参数用）
node scripts/_cb-tail-sweep.mjs standard
node scripts/_cb-tail-sweep.mjs background

# 反向验证：两条新机制断言必须按预期失败
node scripts/attack-shape-compaction-audit.mjs                       # 挂 backLine
VCFM_ATT_OFFSIDE_BUFFER=8 node --import ./scripts/_att-drop-candidate.mjs \
  scripts/attack-shape-compaction-audit.mjs                          # 挂 backLine
VCFM_CB_TAIL_GAIN=1.5 VCFM_ATT_OFFSIDE_BUFFER=8 \
  node --import ./scripts/_cb-tail-candidate.mjs \
       --import ./scripts/_att-drop-candidate.mjs \
  scripts/attack-shape-compaction-audit.mjs                          # 挂 forwardTop

# 信封
node scripts/match-realism-audit.mjs 48 standard
node scripts/match-realism-audit.mjs 48 background
```

原始日志：`.tmp-continuity/fullback/`
（`cbtail1.0/1.5/2.0-standard24.log`、`cbtail1.0/1.5/2.0-standard48.log`、
`cbtail1.5-background48.log`、`cbtail-final-standard48.log`、`cbtail-final-background48.log`）。

## 9. 同轮工具

| 文件 | 用途 |
|---|---|
| `scripts/_cb-tail-candidate.mjs` | 候选预载（已整合进引擎，锚点失效 → 归档） |
| `scripts/_cb-tail-sweep.mjs` | 复刻审计口径但不断言，用于扫参数（基线逐位吻合 47.38/44.70） |
| `scripts/_att-drop-candidate.mjs` | 反例探针：加宽 ATT 越位缓冲，验证 `forwardTopFloor` |
