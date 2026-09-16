# 边后卫套边加「球在本侧」门槛：替换式被门禁否决，AND 式通过（2026-09-15）

> 承接 `AGENTS.md` 交接节「正在做：边后卫两套竞争模型的调和」。
> 那一节留给下一台设备的决策是：远侧边卫套边到 85 m 是否符合真实足球？
> 路线 A = 只把 `bombOn` 的 `dBall < 55` 改成同侧判定；路线 B = 判定 HEAD 现状可接受。
>
> **本文的结论是：路线 A 的两种写法必须区分开——「替换」跌破发布门禁，
> 「AND」（保留距离门槛、额外要求同侧）通过。最终采纳 AND 式。**

## 1. 结论

`bombOn` 的门槛从

```js
dBall < 55
```

改为

```js
dBall < 55 && ballOnSide      // ballOnSide = wide < 0 ? b.x < 50 : b.x > 50
```

**不能**写成只留同侧判定（即用 `ballOnSide` 替换 `dBall < 55`）。两者对远侧边卫的
效果相同（都不再套边），差别只在**近侧**：替换式会让近侧边卫在 `dBall ≥ 55` 时
也去套边（占近侧决策的 0.3%），而那一点扰动足以让标准档 24 场跌破进球下限。

同机同种子的标准档 24 场配对读数（种子集固定，三组逐位可比）：

| 写法 | 进球/场 | 射门/场 | 转化% | `match-realism-audit.mjs 24 standard` |
|---|---:|---:|---:|---|
| HEAD 基线 | 2.75 | 26.96 | 10.2 | **exit 0** |
| `ballOnSide`（替换） | **2.29** | 27.75 | 8.3 | **exit 1**（`goals per match left the calibration envelope`） |
| `dBall < 55 && ballOnSide`（AND，采纳） | **2.92** | 26.58 | — | **exit 0** |

**⚠ 不要把 2.92 读成「改善」**：24 场对进球只有约 ±0.32 的标准误，而门限离下限
只剩 0.25 的余量（`AGENTS.md` §5.6、`docs/movement-release-2026-09-15.md` §5.6）。
这三组读数的正确读法是「替换式**破门禁**、AND 式**不破门禁**」，
不是「AND 式提高了进球」。同理，替换式那个 2.29 也不该被当成「远侧套边值 0.46 球」
的效应量——它只说明 24 场这个尺度对轨迹扰动极其敏感。

## 2. 为什么两式只差 0.3% 却能差 0.63 球

两式对**远侧**边卫完全等价：远侧时 `ballOnSide === false`，`bombOn` 恒为 false。

差别只在**近侧**边卫且 `dBall ≥ 55` 的决策：

- 旧门槛下这些决策落到兜底（`home`），HEAD 实测近侧 `dBall ≥ 55` 只占
  **0.3%**（95/36262，见 `AGENTS.md` 交接节表）。
- 替换式把它们放进套边分支 → 近侧套边占比 68.4% → 69.8%，近侧兜底深度
  39.96 → 39.83（`sd` 3.92 → 3.72）。
- AND 式保持近侧逐位不变：本次实测近侧兜底深度均值 **39.96 m**，与 HEAD 的
  39.96 完全相同。

也就是说：**「改远侧」这件事本身没有破坏门禁，是顺手改到的近侧破坏了门禁。**
这符合 `AGENTS.md` 的既有教训——单点改动在这台引擎上不可加，必须逐项隔离。

## 3. 观测器实测（隔离变体）

`scripts/_fullback-branch-observer.mjs` + `scripts/_fullback-branch-probe.mjs`，
8 场（22931–22936 background + 22941–22942 standard）、**80102 次边卫决策**：

| 指标 | HEAD 基线（交接节，另一台设备） | 采纳的 AND 式（本机） |
|---|---:|---:|
| 远侧套边占比 | **27.3%** | **0.0%**（`bomb|far` 计数为 0） |
| 近侧套边占比 | 68.4% | 68.6% |
| 近侧套边深度 | 89.25 m（sd 10.77） | 89.51 m（sd —） |
| 近侧兜底深度 | 39.96 m（sd 3.92） | **39.96 m** |
| 远侧兜底深度 | 47.64 m（sd 7.61） | 48.20 m |
| `contradiction` | 0 | **0** |

**不扰动验证**：控制组（裸跑）与观测组（`--import` 观测器）的 `perMatch`
**逐位相同**（`diff` 空输出）。

### 3.1 观测器新增规则开关（本次）

`contradiction` 交叉校验依赖被测引擎用的是哪种门槛，所以加了
`VCFM_FULLBACK_RULE`：

| 取值 | 违规条件 | 用途 |
|---|---|---|
| `both`（默认） | `home && prog>0.55 && dBall<55 && near` | 采纳的 AND 式 |
| `same-side` | `home && prog>0.55 && near` | 只留同侧的替换式 |
| `dBall55` | `home && prog>0.55 && dBall<55` | 改动前的 HEAD 基线 |

不加这个开关就没法在本机复现改动前的基线：用当前默认规则去量 HEAD，
远侧边卫那些**合法**的兜底决策会被误判成矛盾。

## 4. 完整验收（采纳的 AND 式）

| 项目 | 结果 |
|---|---|
| `match-realism-audit.mjs 24 standard` | **exit 0**（2.92 球） |
| `match-realism-audit.mjs 48 standard` | **exit 0**（2.73 球 / 27.58 射门 / 传中占比 5.4%） |
| `match-realism-audit.mjs 48 background` | **exit 0**（3.13 球 / 26.71 射门 / 传中占比 5.8%） |
| `attack-shape-compaction-audit.mjs` | **通过**：standard attack 47.38 / span 44.70；background 47.40 / 43.67（收紧阈值 54 / 52） |
| `match-motion-integrity-audit.mjs` | **通过** |
| `browser-e2e.mjs` | **通过** |
| `verify --full` | 见 §5 |

对照 HEAD 的压缩审计读数（`AGENTS.md`：`attack` 47.4/47.6、`span` 44.0/44.9），
本次 47.38/47.40、44.70/43.67——**队形长度指标几乎没动**。这值得记一笔：
远侧套边率从 27.3% 掉到 0，却没有把进攻三区长度推回去，说明那名边卫
此前套边到 85 m 对「DEF→ATT 跨度」的贡献被中卫线/近侧边卫的同期变化抵消了。
**所以这条改动是「纠正一处不真实的行为」，不是「修复队形长度」的杠杆。**

## 5. `verify --full` 与遗留

`verify --full` 日志：`.tmp-continuity/fullback/isolated-verify-full.log`。

**遗留（本轮未做）**：

1. **远侧边卫 27.3% 套边率是不是「不真实」仍属判断，不是测量。** 本文只证明
   「把门槛改成同侧不会破门禁」，没有证明「现实中的远侧边卫不套边」。
   若要进一步收紧（例如远侧只允许前压到中线），必须先按 §1 的教训
   **逐项隔离**，再用 ≥48 场判效应量。
2. **24 场门限对轨迹扰动的敏感度**：0.3% 的决策差异 → 0.63 球/场。
   这与 `docs/movement-release-2026-09-15.md` §5.6 是同一件事的两面，
   引用时不要把它当成「效应量」。
3. `scripts/_fullback-support-candidate.mjs`（2026-09-11 的 8 补丁候选）
   至此**可以正式归档**：它要解决的「远侧边卫进不了套边分支」已被本轮的
   同侧门槛以更小的代价处理掉，而它本身在 HEAD 上加载即断言失败、
   且会丢掉 `blockForward` + `_checkCrowding`。

## 6. 复现

```bash
# 采纳的 AND 式（当前 HEAD+1）
node scripts/match-realism-audit.mjs 24 standard
node scripts/match-realism-audit.mjs 48 standard
node scripts/match-realism-audit.mjs 48 background

# 观测器：控制组 / 观测组必须逐位相同
node scripts/_fullback-branch-probe.mjs
node --import ./scripts/_fullback-branch-observer.mjs scripts/_fullback-branch-probe.mjs

# 量改动前的 HEAD 基线（规则必须切回 dBall55，否则矛盾计数会误报）
cp js/sim/engine.js /tmp/engine-candidate.js
git show HEAD:js/sim/engine.js > js/sim/engine.js
VCFM_FULLBACK_RULE=dBall55 node --import ./scripts/_fullback-branch-observer.mjs scripts/_fullback-branch-probe.mjs
cp /tmp/engine-candidate.js js/sim/engine.js
```

原始日志：`.tmp-continuity/fullback/`（`routeA-baseline-standard24.log`、
`routeA-standard24-direct.log`、`isolated-standard24.log`、
`isolated-envelope-standard48.log`、`isolated-envelope-background48.log`、
`isolated-instrumented.log`、`isolated-verify-full.log`）。

## 7. 同轮的另一处改动（独立议题）

赛前简报「两队最近五场状态」的布局修复（`js/main.js` 的 `formBlocks`、
`css/style.css` 的 `.form-strip` / `.form-cell`）与本文件无关，见
`docs/briefing-form-strip-2026-09-15.md`。
