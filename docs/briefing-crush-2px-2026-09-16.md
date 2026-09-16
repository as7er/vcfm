# 赛前简报被压成 2 px：验证与修复（2026-09-16）

> 一句话：**这是真缺陷，不是探针 resize 产物。** 窄屏（flex 列）下
> `#match-pre-brief` 是整条 flex 链上**唯一可收缩项**，被全宽竖场挤成 2 px。
> 修法一处：`flex: 0 1 auto` → `flex: 0 0 auto`。桌面档（grid）逐位不变。

## 1. 起因与结论

`docs/handoff-2026-09-16.md` §2 留了一个必须先验证再动手的问题：

> 手机 390×844 与平板 768×1024 下 `#match-pre-brief` 量到 `clientH: 2`、
> `scrollH: 821`，819 px 简报内容全在滚动区里看不见。
> ⚠ **但那个读数是在「从 1440×1000 缩到手机尺寸」之后量的**，
> 所以可能是 resize 产物。**未验证前不要改 CSS。**

**验证结论：真缺陷。** 判据是「启动视口」与「缩放视口」两臂读数一致：

| 臂 | 到达手机视口的方式 | `#match-pre-brief` clientH | scrollH |
|---|---|---:|---:|
| A 启动视口 | 页面**直接以 390×844 创建**，全程不 resize | **2** | 837 |
| B 缩放视口 | 1440×1000 启动 → 驱动到开赛前 → 再 resize 到 390×844 | **2** | 816 |

两臂 `clientH` 都是 2、`rectTop` 都是 115、`.mp-field` 都是 505 px 高。
**resize 不是变量。** 唯一差异是 `scrollH`（837 vs 816，文案换行差异，非结构差异）。

> 复现：`node scripts/_briefing-startup-viewport.mjs .tmp-continuity/briefing-startup`
> 原始数据 `.tmp-continuity/briefing-startup/startup-vs-resized.json`

## 2. 成因（实测祖先链，非推断）

开赛前 `.match-layout.fm-match` 是 flex 列，容器 `clientH 834`、内容需求 `scrollH 999`：

| 子项 | 声明 | 实测高 | 可收缩？ |
|---|---|---:|---|
| `.fm-scoreboard` | `flex-shrink: 0` | — | 否 |
| **`#match-pre-brief`** | **`flex: 0 1 auto` + `min-height: 0`** | **2** | **是（唯一）** |
| `.fmm-match-body`（开赛前） | `flex: 0 0 auto` | 560 | 否 |
| └ `.mp-field` | `flex: 0 0 auto` + `aspect-ratio: 68/93.45` | 505 | 否 |
| `.fmm-commentary` | `flex: 0 0 auto` | — | 否 |

即：**全宽竖场按宽度定高**（手机 390 宽 → 场地盒 367×505，比例 0.727 = 68/93.45，**比例本身是对的**），
它把 834 px 的容器吃光后，压缩只能落在唯一可收缩的简报上。

⚠ 与交接文档的一处差别：交接写「外层 `.match-layout` 本该滚动而不是压扁简报」。
实测外层 `scrollH 999 > clientH 834`，**它确实在滚**——只是 flex 先让可收缩项塌掉，
容器才不再溢出，于是外层永远轮不到滚动。所以「改简报的 shrink」是对的，
但**不是因为它没滚，而是因为它是唯一被选中的牺牲品**。

## 3. 修法（一处）

`css/style.css:6801`：

```css
.match-pre-brief {
-  flex: 0 1 auto;
-  flex-shrink: 1;
+  flex: 0 0 auto;
   min-height: 0;
   max-height: min(36vh, 300px);
   overflow-x: hidden;
   overflow-y: auto;
   ...
```

依据（原设计意图，非新增行为）：`.prematch-brief.full` 的注释写着
「高度交给外层 `#match-pre-brief` 统一滚动」（`css/style.css:6790`），
外层 `.match-layout.fm-match` 的注释写着「赛前简报+讲话变高后必须可滚」（`:1513`）。
改成不可收缩后，简报按 `max-height` 取 300 px 并**自身内滚**，整页超出时交给外层滚。

**桌面零副作用的理由**：宽屏 ≥1060px 走 `display: grid`（`:1535`），
**flex 属性对 grid item 无效**，所以这条只影响窄屏 flex 路径。

## 4. 验收

### 4.1 简报面板高度（深色档，5 视口）

| 视口 | 修复前 | 修复后 |
|---|---:|---:|
| desktop 1440×1000 | 520 | **520**（逐位不变） |
| laptop 1280×800 | —（grid） | 448 |
| tablet 768×1024 | **2** | **300** |
| phone 390×844 | **2** | **300** |
| phone-small 360×640 | 2 | **230** |

窄屏 `.mp-field` 比例全部保持 **0.727**（tablet 638×877 / phone 367×505 /
phone-small 337×463），修简报没有动到球场几何。

### 4.2 form-strip 断言

`_briefing-layout-probe.mjs` **两主题 × 5 视口**，`formStrip.issues` 全为空
（`stripCount: 2`，每队 5 个 cell，全部可见、不重叠、不溢出面板）；
`overflowX: 0`、`overlapCount: 0`、`lineIssueCount: 0`、`pageErrors: []`。
两档的简报高度逐位相同（desktop 520 / laptop 448 / tablet 300 / phone 300 /
phone-small 230），说明这次改动与主题无关（只动 `flex`，不涉及颜色）。

`clippedCount: 1` 是 `#match-pre-brief` 自身（`clientH 300 / scrollH 816`）——
**这是修复后的预期状态**（自身内滚），不是缺陷。

### 4.3 端到端

`node scripts/browser-e2e.mjs` → **退出 0**，通过的检查项里包含
`desktop/mobile overflow`：

```
Browser E2E passed: first-week onboarding persistence and first-match completion,
broadcast cameras, motion clip diagnostics, spatial goal replay, straight-pass
rendering, nonblank match canvas, phase-shape evidence, manager identity, squad
planning, club crests, finance, scouting knowledge, desktop/mobile overflow,
navigation and modal focus
```

### 4.4 缓存版本

`sw.js` 的 `CACHE`、`index.html` 的 `CURRENT_CACHE`、三处 `?v=`、
`vcfm-sw-reloaded-v` 同步升 **v258 → v259**（CSS 是预缓存资源）。

## 5. 顺带查清的两件事（都不是缺陷）

1. **`.mp-field` 在窄屏不是「过宽」**。手机档 505 px 高 ÷ 0.727 = 367 px 宽，
   正好是 390 视口减去 `#screen-match.active` 的 `0.65rem` 内边距。
   比例正确，不存在横向溢出（`docScrollW == clientW == 390`）。
2. **财政页 7 个「横向溢出」元素是探针假阳性**。`#finance-breakdown-table`
   与 `#finance-ledger-table` 都在 `.table-wrap { overflow-x: auto }`（`:743`）里，
   元素 `getBoundingClientRect()` 会报出滚动内容的完整宽度，属预期。

## 6. 仍然未修的相关问题（与本缺陷同族，独立议题）

| 视口 | 现象 | 量到的数 |
|---|---|---|
| 桌面 1440×1000 | 开赛前球场被压成细条，浮在空列中间 | `175×240`（列宽 585）；1280×800 更糟 `82×112` |
| 桌面 | 队内讲话卡片底部被裁 42 px | 面板 `clientH 520 / scrollH 562`（可滚动，属设计内） |
| 桌面 | 财政分类表在 5/12 列（约 515 px）内要求 `min-width: 38rem`（608 px） | 桌面档也出现不必要的横向滚动 |

第一条是**方向相反的同一个病**：窄屏是「球场撑爆容器、简报被牺牲」，
宽屏是「容器给行高、球场被牺牲」。要改得先定义「简报与球场谁让位」。

## 7. 复现

```bash
# 真缺陷判定（启动视口 vs 缩放视口）
node scripts/_briefing-startup-viewport.mjs .tmp-continuity/briefing-startup

# 官方验收（两主题 × 5 视口 + form-strip 断言）
node scripts/_briefing-layout-probe.mjs .tmp-continuity/briefing-fixed-dark dark
node scripts/_briefing-layout-probe.mjs .tmp-continuity/briefing-fixed-light light

node scripts/browser-e2e.mjs
```
