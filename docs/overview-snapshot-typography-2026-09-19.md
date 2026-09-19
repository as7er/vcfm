# 总览 · 赛季快照：排版修复与一处「有标题、无内容」的死元素

**日期**：2026-09-19
**触发**：用户报告 ——
> 「总览-概览-赛季快照中的近期战绩里的内容字体显示太大了，换行显得很违和」

**结论**：用户描述的现象对应 **`.rank-box` 用了 `--fs-4xl`（22px）**。
同时顺带查实「**近期战绩**」标题下那个容器 `#form-strip` **自 `f1bbd46` 起就没有
任何代码往里写内容**（`index.html` 的容器和 `<h3>` 都还在）。两件事彼此独立。

---

## 1. 先把事实量出来，不要靠读源码猜

第一轮我按源码推断：`#form-strip` 没有声明 `font-size`，父链（`.card` →
`.dashboard-pulse-card` → `.dashboard-mini-block`）也都没声明，所以它应该继承
`body` 的字号。**这个推断本身没错，但它推不出用户看到的东西** —— 因为
`#form-strip` 的实测宽高是 `0 × 0`。

于是写了一个浏览器内的排版探针（`scripts/_form-strip-typography-probe.mjs`）：
起 `http.server`、走完整启动流程（`#input-manager` → `#btn-new-game` →
`#screen-main.active` → 切到总览页），然后用 `getComputedStyle` +
`getBoundingClientRect` 逐元素量 **computed fontSize / 行高 / 宽高 / 是否可见**。

> 教训：**「字号」这类问题必须量 computed 值。** 读 CSS 只能告诉你"声明了什么"，
> 告诉不了你"最终继承到多少"、更告诉不了你"这个元素根本不显示"。

### 实测读数（修复前）

| 元素 | 视口 | fontSize | 宽 | 高 | 行数 |
|---|---|---|---|---|---|
| `#my-rank`（.rank-box） | 1440×1000 | **22px** | 361 | 86 | **3** |
| `#my-rank`（.rank-box） | 1024×900 | **22px** | 275 | 116 | **5** |
| `#form-strip` | 两种 | 16px | **0** | **0** | — （`childCount: 0`，`html: ""`） |
| `.dashboard-mini-block h3`（近期战绩标题） | 两种 | 15px | 361 | 20 | 1 |

`#my-rank` 的文本是：
```
英格兰乙级联赛 第 1 名 · 0 分（0胜 0平 0负） (前 3 名升级)
```
一行**密集信息**，却用了 22px —— 也就是本仓字号标尺里注释为
「**页面标题**」的那一档（`--fs-4xl`）。于是在窄栏里折成 3~5 行，
看起来就像坏了。**这就是用户说的「字体太大、换行违和」。**

---

## 2. 修复

`css/style.css` 的 `.rank-box`：

```diff
 .rank-box {
-  font-size: var(--fs-4xl);
+  font-size: var(--fs-base);   /* 14px，本文件的「正文」级 */
+  line-height: 1.5;
   font-weight: 700;
+  text-wrap: pretty;           /* 避免最后一行只剩一两个字 */
   padding: 0.75rem;
   ...
 }
```

- 选 `--fs-base`（14px）而非更小的 `--fs-sm`：这行要放「联赛 + 名次 + 积分 +
  胜平负 + 升降级规则」四项，缩到 13px 反而更容易挤成 3 行。
- 加 `line-height: 1.5`：原来 `normal` 在 22px 下行高约 26px，换行时行距过大。
- 加 `text-wrap: pretty`：现代浏览器会避免出现孤字尾行。
- **`#youth-info` 不受影响**：它在 `index.html:495` 用行内
  `style="font-size:var(--fs-lg);line-height:1.6"` 覆盖，行内样式优先级更高。

### 修复后读数

| 视口 | 修复前 | 修复后 |
|---|---|---|
| 1440×1000 | 22px · **3 行** · 86px 高 | 14px · **2 行** · 68px 高 |
| 1024×900 | 22px · **5 行** · 116px 高 | 14px · **2 行** · 68px 高 |

---

## 3. 顺带查实的第二件事：`#form-strip` 是死元素

`index.html:245-248` 是：

```html
<div class="dashboard-mini-block">
  <h3 data-i18n="dash.form">近期战绩</h3>
  <div id="form-strip" class="form-strip"></div>
</div>
```

全仓搜索 `form-strip` 的**写入点**，只有 `js/main.js:9784/9794` ——
那两处是 `renderPrematchBriefHtml` 里 `formBlocks()` 的**返回值**（赛前简报用），
**没有任何地方把它赋给 `#form-strip`**。实测也证实：`childCount: 0`、`w/h: 0`。

### 它是什么时候变成死元素的

```
git log --oneline -S 'form-strip' -- js/main.js
  b884e48   （2 处，仍是返回的模板串）
  f1bbd46   （0 处 ← 填充逻辑在此被删除）
  e2c8702   （1 处，原始的 $("#form-strip").innerHTML = ...）
```

原始版本（`e2c8702`）确实有填充：

```js
$("#form-strip").innerHTML = (club.form.length ? club.form : ["—"]) ...
```

`f1bbd46`（"feat: board objectives and scout fuzzy valuation"）把它删掉了，
**但 `index.html` 里的容器和标题没删**。此后 170+ 个提交里，这块一直是
「有标题、空内容」。本轮**未改**它（先确认用户指的是哪一处 —— 见下），
但已在 `scripts/ui-layout-audit.mjs` 加了一条提示性断言，避免它被继续无视。

---

## 4. 回归防护

`scripts/ui-layout-audit.mjs` 新增 5 条断言（源码级，跑在 `verify.mjs` 里）：

1. `.rank-box` 必须 `font-size: var(--fs-base)`；
2. `.rank-box` **不得**出现 `font-size: var(--fs-4xl)`；
3. `.rank-box` 必须有显式 `line-height: 1.5`；
4. `#my-rank` 必须仍在快照卡片里；
5. `#form-strip` 若在 `js/main.js` 里没有写入点，就当死内容处理（补渲染或删块）。

**反假通过已验**：把 `.rank-box` 的 `--fs-base` 临时改回 `--fs-4xl`，
审计立刻 `EXIT=1` 并打印
`#my-rank summary must use body-scale type, not a page-title size`；恢复后转绿。

另有 `scripts/_form-strip-typography-probe.mjs` 保留在仓库里：它是一个**可复跑**
的真实浏览器排版量测工具（支持 `[视口宽] [视口高] [主题]` 三参数），
将来任何「某处字号/换行不对劲」的报告都可以先用它拿事实。

---

## 5. 一条通用教训

**CSS 里的字号问题，读源码只能定位"声明"，量算才能定位"显示"。**
本轮第一版推断（继承 16px）在源码层面完全正确，却导向了错误的对象 ——
因为真正违和的 `#my-rank` 是 22px，而用户指的 `#form-strip` 根本不显示。
**先量，再改。**
