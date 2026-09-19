# 战术板核心球员 ⭐ 点击无反应 —— 根因与修复

日期：2026-09-19
回报：用户 —— *"为什么现在点击战术板上的核心球员没有反应"*

---

## 1. 现象

在「战术」页的球场（`#pitch`）上，点击球员圆点头像下方的 ⭐ 按钮，
**不触发「设为核心球员」**，也没有任何提示。视觉上像「点了没反应」。

---

## 2. 根因

### 2.1 一句话

`js/main.js` 战术板的触屏拖拽增强代码，在 **`pointerdown`** 阶段就对
`.tac-slot` 调用了 `setPointerCapture()`。指针一旦被捕获，
后续 `pointerup` 的事件目标被浏览器**强制改写为被捕获的元素**，
而 `click` 的事件目标又由 `pointerup` 的目标决定 ——
于是 `click` 落在 `.tac-slot` 上，**槽位内部的子按钮永远收不到点击**。

### 2.2 事件链

```
用户在 ⭐ 上按下
   ↓
pointerdown  target = button[data-core-id]  （正确）
   ↓ 冒泡到 #pitch 的委托处理（main.js:6527）
e.target.closest(".tac-slot") 命中 → slotEl.setPointerCapture(e.pointerId)
   ↓
【指针被 .tac-slot 捕获】→ 此后 pointer 事件全部改派给 .tac-slot
   ↓
pointerup    target = .tac-slot   ← 被改写（本应是 ⭐ 按钮）
   ↓
click        target = .tac-slot   ← 跟随 pointerup（本应是 ⭐ 按钮）
   ↓
⭐ 按钮上的 click 监听器（main.js:6888 bindTacticsCoreButtons）永不触发 ✘
   ↓
事件冒泡到 #pitch 的委托 click（main.js:6595）
e.target.closest(".tac-slot") 命中 → 进入「点选模式」
   ↓
用户看到的现象：点了没反应（其实是被当成「选中该球员准备换位」）
```

**真实 Chromium 实测的事件日志**（旧实现，点击 ⭐）：

```
pointermove  -> star p1
pointerdown  -> star p1
capture@down                       ← 委托里 setPointerCapture
pointerup    -> slot0              ← target 被改写！本应是 star
lostpointercapture
pick:slot0                         ← 委托把它当成「选中槽位」
```

修复后：

```
pointerdown  -> star p1
pointerup    -> star p1            ← target 保持正确
star:p1                            ← ⭐ 的监听器终于触发
```

### 2.3 为什么是「现在」才坏

`pointerdown` 里 `setPointerCapture` 那段是为**触屏拖动换位**补强的
（HTML5 DnD 在触屏上不可靠）。这段后加，而 ⭐ 按钮的绑定更早 ——
两者叠加后，⭐ 被静默吃掉。**桌面鼠标同样中招**，不只是触屏。

### 2.4 ⚠ 一个被实测推翻的假设：角色徽章**不是**同源受害者

我最初写本文档时断言「角色徽章 `[data-role-edit]` 也一并失效」。**这是错的**，
被 `scripts/tactics-core-click-browser-check.mjs` 的用例 2 纠正：

```
old:   role:0     ← 旧实现下徽章本来就能点
fixed: role:0
```

原因：`bindTacticsRoleEditor`（`main.js:7003`）在徽章上绑了
`pointerdown → stopPropagation`，所以 `pointerdown` **根本不冒泡到 `#pitch` 的委托**
⇒ 从不触发捕获 ⇒ 徽章不受该缺陷影响。

**教训**：同处一个容器、同类外观的两个子控件，可能因为各自多绑了一个
`stopPropagation` 而**命运不同**。「它们看起来一样，所以都坏了」是推断，
不是证据。要逐个实测。

### 2.4 最小复现（已实证）

`scripts/_tmp-star-click-check.mjs` 用事件路径模拟器跑了两组对照：

| | pointerup target | ⭐ click 触发 | 误入点选 |
|---|---|---|---|
| 旧实现（pointerdown 立刻捕获） | `.tac-slot` | **否** | **是** |
| 修复后 | `⭐ button` | **是** | 否 |

---

## 3. 修复

### 3.1 延迟指针捕获（`js/main.js:6525-6565`）

**不再**在 `pointerdown` 捕获，改为在 `pointermove` 中
**确认发生位移（判定为拖拽）之后**才捕获：

```js
pitch.addEventListener("pointerdown", (e) => {
  const slotEl = e.target.closest(".tac-slot");
  if (!slotEl || !slotEl.dataset.playerId) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  ptr = { id: e.pointerId, fromSlot: +slotEl.dataset.slot, /* … */ };
  // 🔴 此处不 setPointerCapture
}, { passive: true });

pitch.addEventListener("pointermove", (e) => {
  // … 位移阈值判定 …
  if (!ptr.moved) {
    // 正式进入拖拽：此时才捕获指针，之后的事件都归本槽位
    try { ptr.el?.setPointerCapture?.(e.pointerId); } catch (_) {}
  }
  ptr.moved = true;
  // …
});
```

**为什么这样安全**：
- 「原地点击」从不进入位移分支 ⇒ 从不捕获 ⇒ 事件目标保持为真实子元素 ⇒ ⭐ 正常。
- 「拖拽」在移动超过 8px（`dx²+dy² < 64`）后才捕获 ⇒ 拖拽期间的事件仍全部归本槽位，
  拖拽换位行为不变。
- `pointerup` 的落点判定用的是 `document.elementFromPoint(e.clientX, e.clientY)`，
  这是**坐标查询**，不受指针捕获影响 ⇒ 落点仍然准确。

### 3.2 委托 click 放行槽位内独立按钮（`js/main.js:6595-6601`）

即便修好捕获，仍应明确表达「这些子按钮不属于点选流程」：

```js
pitch.addEventListener("click", (e) => {
  if (tacPick.dragging) return;
  if (e.target.closest("[data-player-link]") && !tacPick.mode) return;
  // 槽位内的独立按钮（⭐ 设为核心 / 角色徽章）各自处理，不进入点选流程
  if (e.target.closest("[data-core-id]") || e.target.closest("[data-role-edit]")) return;
  const slotEl = e.target.closest(".tac-slot");
  // …
});
```

这一条同时修掉了「点 ⭐ 会顺带把该槽位置为选中态」的次生 bug。

---

## 4. 验证

验证分**两层**，因为第一层有一个无法自证的缺口。

### 4.1 第一层：事件路径模拟器（`scripts/tactics-core-click-audit.mjs`）

三组断言：

```
用例1 点击⭐   : ✔ 通过     （旧实现：⭐ 不触发且误入点选；修复后：⭐ 触发）
用例2 拖拽回归 : ✔ 通过
用例3 源码对齐 : ✔ 通过     （确认 js/main.js 里确实是这两处修复，非注释）
```

**缺口**：模拟器里「`setPointerCapture` 会改写 `pointerup` 的 target」是我
**写进模型的断言**。若真实浏览器不这么干，模拟器会给出错误的信心。

### 4.2 第二层：真实 Chromium（`scripts/tactics-core-click-browser-check.mjs`）

用 Playwright 做**真实鼠标按下/抬起**，读浏览器实际行为。5 个用例，**10/10 通过**：

| 用例 | 旧实现 | 修复后 |
|---|---|---|
| 1. 点击 ⭐ | `capture@down \| pick:slot0`（⭐ 不触发，误入点选） | `star:p1` ✔ |
| 2. 点击角色徽章 | `role:0`（**本来正常**） | `role:0` ✔ |
| 3. 点击槽位本体 | — | `pick:slot0`（点选未被误伤）✔ |
| 4. 原生 DnD 拖拽（桌面） | — | `swap:0<->1` ✔ |
| 5. 触屏 pointer 拖拽 | — | `capture@move \| swap:0<->1` ✔ |

**这一层证实了模型**：真实 Chromium 的 `pointerup` target 确实从 `star p1`
被改写成 `slot0` —— 与模拟器预测一致。

### 4.3 🔴 浏览器层新暴露的事实：原生 DnD 会用 `pointercancel` 终结 pointer 序列

用例 4/5 最初合并成一个「鼠标拖拽」用例，结果失败。诊断日志给出了真相：

```
pointerdown → pointermove ×6 → capture@move → pointercancel ×6
```

`pointercancel` **不是我的代码发的**，是浏览器发的：`.tac-slot` 带
`draggable="true"`，鼠标拖拽会启动**原生 HTML5 DnD**，浏览器随即取消 pointer 序列，
`pointerup` 根本不会到达。所以：

- **桌面上**的拖拽换位实际走 `dragstart/dragover/drop`（`main.js:6458-6523`）；
- **pointer 那条路是给触屏用的**（触屏没有原生 DnD）。

两条路都保留是有意的。据此把用例拆成「4 桌面 DnD」与「5 触屏 pointer」，
两条都独立验证通过。

**顺带加固**：`endDrag` 现在同时挂在 `pointerup` 与 `pointercancel` 上，
并额外挂到 `window` 兜底（指针拖出球场容器时不漏收尾），靠 `ptr.id` 守卫去重。

---

## 5. 可迁移的教训

> **`setPointerCapture` 会改写 `pointerup` 的 target，进而改写 `click` 的 target。**

这是「事件委托 + 内部可点元素」组合下的经典陷阱。它与 `stopPropagation` 不同：
`stopPropagation` 只影响传播，**不改写 target**；而 pointer capture **直接换掉 target**，
使得绑定在深层子元素上的监听器**根本不在事件路径上**。

**判据**：如果一个容器既要「整块可拖拽」又要「内部有独立按钮」，
指针捕获必须**晚于**「确认这是拖拽而非点击」的时刻。

**通用的修法**（按推荐顺序）：
1. **延迟捕获**：位移超过阈值后才 `setPointerCapture`（本次采用）。
2. **命中排除**：`pointerdown` 里若 `e.target.closest("button, a, [data-*]")` 命中，直接 return。
3. **改用事件坐标手写拖拽**，不用 pointer capture。

**排查手法**：不要只盯着「按钮的监听器有没有绑上」。
要先问「事件到底有没有到达那个元素」——
在 `pointerdown` / `pointerup` / `click` 三处各打一次 `e.target`，
target 在 `pointerup` 处「跳变」到祖先节点，就是指针捕获在作祟。

### 5.1 三条来自本轮的补充教训

1. **「它们的症状应该一样」是推断，不是证据。** 我一度认定角色徽章同源受害，
   实测证明它自带 `pointerdown → stopPropagation` 隔离，本来就能点（见 §2.4）。
2. **模拟器再自洽，也必须与真实运行时对齐。** 模拟器证实的是「我的模型」；
   只有浏览器能证实「浏览器的行为」。（第一层若没有第二层，就只是一次自我确认。）
3. **`draggable="true"` 与 pointer 事件是竞争关系。** 同一个元素上同时挂原生 DnD
   和 pointer 拖拽时，**鼠标走 DnD、触屏走 pointer**，且鼠标路径会用
   `pointercancel` 终结 pointer 序列。给这类元素写测试时，
   用 `mouse.down/move/up` 测 pointer 路是**测错了对象**。
