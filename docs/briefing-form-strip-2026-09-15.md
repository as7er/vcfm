# 赛前简报「最近五场状态」布局修复（2026-09-15）

> 纯表现层改动：`js/main.js` 一处、`css/style.css` 一处（新增选择器）。
> 没有碰引擎、数据、缓存内容（只升了版本号）。

## 1. 缺陷

赛前简报里「两队最近五场」原本渲染成：

```
曼城 WWDLW   vs   阿森纳 LDWDL
```

即 `discipline.js:143 formStr()` 把最近五场结果数组 `join("")` 成一个字符串，
再整串塞进**一个** `.form-pill`：

```js
const formPill = (str, tone) => `<span class="form-pill tone-${tone}">${escapeHtml(str)}</span>`;
```

问题：

1. **看不出每场的结果**——`WWDLW` 是一串字母，颜色只反映整串的冷热
   （`formTone()` 按 W 加 1、L 减 1 求和后分档），单场胜负没有视觉编码。
2. **宽度随内容浮动**：五场全是 `W` 与「W/D 混合」宽度不同，两队 pill 不对齐。
3. 与 FM 系列的「五场状态条」（5 个独立彩色方块）不是同一套视觉语言。

## 2. 修法

`renderPrematchBriefHtml()` 里换成 `formBlocks(form)`，输出 5 个独立 `.form-cell`：

| 结果 | 类名 | 颜色 |
|---|---|---|
| 胜 | `.form-cell.win` | 绿 |
| 平 | `.form-cell.draw` | 灰 |
| 负 | `.form-cell.loss` | 红 |
| 不足 5 场 | `.form-cell.none` | `·` 占位（保持对齐） |
| 整队无数据 | `.form-cell.empty` | 「暂无」/「n/a」 |

数据来源直接用 `brief.me.form` / `brief.opp.form`——`discipline.js:321/341`
已经把原始数组放在 brief 里了（`formStr` 只是它的字符串副本），所以
**没有改 `discipline.js`**，也不需要新增字段。

方块 `width/height: 1.15rem`、`border-radius: 4px`、`flex: 0 0 auto`，
`.form-strip` 用 `inline-flex` + `gap: 0.16rem`；浅色主题下把方块文字加深
（`#15803d` / `#475569` / `#b91c1c`），避免白底上太淡。

评论流里的那行纯文本（`main.js:9809` 的 `近况：我 WWDLW · 对方 LDWDL`）
**保持原样**——日志是文本流，字母串在那里是对的。

## 3. 验证

新建 `scripts/_briefing-layout-probe.mjs`：把游戏引导到**开赛前**状态
（`#match-pre-brief` 在屏，不点开赛），逐视口量简报面板，并对 form-strip 做断言
（每队恰好 5 个 cell、全部可见、两两不重叠、不溢出面板）。

2 主题 × 5 视口 = 10 组，**全部 `formStrip.issues` 为空**：

```
desktop 1440×1000 / laptop 1280×800 / tablet 768×1024 / phone 390×844 / phone-small 360×640
```

`brief-form-row` 实测 326×19（手机档）/ 1316×19（桌面档），
两个 strip 各 5 个 18×18 方块，无横向溢出。

### 3.1 探针的一个口径坑（已记录）

`rectOf()` 用 `document.querySelector` 是**全文档**搜索，会命中其它屏幕里
隐藏的 `.prematch-brief.compact` 副本，量出 `0×0`。看起来像「简报容器塌了」，
其实是量到了空气。要量比赛屏内的元素必须限定 `#screen-match` 作用域。

## 4. 顺带发现、**本轮未修**的三处显示缺陷

用同一个探针量出来的，都在开赛前状态：

| # | 视口 | 现象 | 量到的数 | 成因（已定位） |
|---|---|---|---|---|
| 1 | 手机 / 平板 | **简报面板被压成 2 px 高的细条**，819 px 内容全在滚动区里看不见 | `#match-pre-brief` `clientH: 2`、`scrollH: 821` | `.match-pre-brief { flex: 0 1 auto; min-height: 0 }`，而同容器里 `.fmm-match-body` 在开赛前是 `flex: 0 0 auto`——**唯一可收缩的子项吸收了全部挤压**。外层 `.match-layout` 本来是 `overflow-y: auto`，本该滚动而不是压扁简报 |
| 2 | 桌面 | 开赛前**球场被压成细条**，浮在空列中间 | 1440×1000：`175×240`（列宽 585）；1280×800：`82×112` | `css:1594` 有意让「高度跟行走、宽度按比例反推」，但开赛前简报占了 `min(56vh,520px)`，剩下的行高只有 ~240 px |
| 3 | 桌面 | 队内讲话卡片底部被裁 | 面板 `clientH 520` / `scrollH 562`（缺 42 px） | 简报面板自身 `overflow-y: auto`，属「设计上可滚」，但讲话卡片正好被切在中间 |

第 1 条是**真正的功能性问题**（手机档整个赛前简报不可见），建议优先处理；
修法是把 `.match-pre-brief` 在非宽屏下改成 `flex: 0 0 auto`，让它取
`max-height: min(36vh, 300px)` 并自身滚动，而不是被压到 0。

第 2 条是设计取舍（`css:1594` 的注释写明了动机：宽度定高会撑出 700px+ 竖场
挤掉底栏），要改得先定义「简报与球场谁让位」。

第 3 条只是需要滚动，属可接受范围。

## 5. 复现

```bash
# 两主题 × 5 视口的简报几何 + form-strip 断言 + 逐档截图
node scripts/_briefing-layout-probe.mjs .tmp-continuity/briefing-layout dark
node scripts/_briefing-layout-probe.mjs .tmp-continuity/briefing-layout-light light
```

原始数据：`.tmp-continuity/briefing-layout3/`（`briefing-all.json` + 10 组
`briefing-<theme>-<viewport>.json/.png`）。
