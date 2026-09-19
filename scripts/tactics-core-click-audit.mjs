import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 战术板核心球员 ⭐ 点击回归审计
 *
 * 背景（用户报告，2026-09-19）：战术板上点 ⭐「设为核心球员」没反应。
 * 根因：`js/main.js` 的触屏拖拽增强在 pointerdown 阶段就对 `.tac-slot`
 * 调用了 setPointerCapture()，导致 pointerup/click 的 target 被改写为父元素，
 * ⭐ 自身的 click 监听器根本不在事件路径上。
 *
 * 本脚本做两件事：
 *   A. 事件路径模拟：证明「pointerdown 立刻捕获」会吞掉子按钮 click，
 *      而「位移后才捕获」不会 —— 并同时验证拖拽换位未被破坏。
 *   B. 源码对齐断言：确认 `js/main.js` 里确实存在这两处修复。
 *      （按 skill §3.7「replica 必须与原件对齐」的纪律 —— 模拟器不能自说自话。）
 *
 * 运行：node scripts/tactics-core-click-audit.mjs
 *
 * 结构模拟战术板：
 *   <div class="tac-slot">            <- 父（pointerdown 委托在此 setPointerCapture）
 *     <div class="circle">…</div>
 *     <button data-core-id>⭐</button>  <- 真正想点的
 *   </div>
 *
 * 浏览器语义：
 *   setPointerCapture(el) 之后，pointerup 的 target 被强制为 el，
 *   而 click 的 target 由 pointerup 的 target 决定。
 *   ⇒ 子按钮的 click handler 收不到事件，事件被派发到父元素。
 *
 * 本脚本用「事件路径模拟」而非真实 DOM 来验证这条因果链。
 */

const log = [];

/** 一个极简的事件目标 */
function makeEl(name, opts = {}) {
  return {
    name,
    handlers: {},
    dataset: opts.dataset || {},
    closest(sel) {
      if (sel === "[data-core-id]") return this.dataset.coreId ? this : null;
      if (sel === "[data-role-edit]") return this.dataset.roleEdit != null ? this : null;
      if (this._isSlot) return sel === ".tac-slot" ? this : null;
      if (sel === ".tac-slot") return this._parent || null;
      return null;
    },
    contains(el) {
      return el === this || el._parent === this;
    },
    addEventListener(type, fn) {
      (this.handlers[type] ||= []).push(fn);
    },
    fire(type, target, extra = {}) {
      for (const fn of this.handlers[type] || []) {
        fn(Object.assign({ target, preventDefault() {}, stopPropagation() {} }, extra));
      }
    },
  };
}

/**
 * 跑一次点击流程。
 * @param {'old'|'fixed'} mode 旧实现（pointerdown 里捕获）vs 修复后（位移后才捕获）
 */
function run(mode) {
  const useCapture = mode === 'old';
  log.length = 0;

  const pitch = makeEl("pitch");
  const slot = makeEl("slot", { dataset: { slot: "0", playerId: "p1" } });
  const star = makeEl("star", { dataset: { coreId: "p1" } });
  slot._isSlot = true;
  star._parent = slot;

  // ── 现有代码（main.js:6527-6547）：委托 pointerdown ──
  let captureOwner = null;
  pitch.addEventListener("pointerdown", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl || !slotEl.dataset.playerId) return;
    if (mode === "old") captureOwner = slotEl; // 旧：pointerdown 立刻捕获
    // 修复后：此处不捕获，留到 pointermove 判定为拖拽后再捕获（见下文 dragMoveNeedle）
  });

  // ── 现有代码（main.js:6588）：委托 click ──
  pitch.addEventListener("click", (e) => {
    // 修复：放行槽位内独立按钮
    if (mode === "fixed" && (e.target.closest("[data-core-id]") || e.target.closest("[data-role-edit]"))) return;
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl) return;
    log.push(`[pitch] 「进入点选模式」(slot=${slotEl.dataset.slot})`);
  });

  // ── 现有代码（main.js:6888-6914）：⭐ 自己的 click ──
  star.addEventListener("click", () => {
    log.push("[star] setCorePlayerId() ✔  ← 期望的行为");
  });

  // 事件派发路径（目标阶段 → 冒泡）
  const pathTo = (el) => (el === star ? [star, slot, pitch] : el === slot ? [slot, pitch] : [pitch]);

  // 1) pointerdown：target = star
  for (const el of pathTo(star)) el.fire("pointerdown", star, { pointerId: 1 });

  // 2) pointerup：target 受 pointer capture 影响
  const upTarget = captureOwner || star;
  for (const el of pathTo(upTarget)) el.fire("pointerup", upTarget, { pointerId: 1 });

  // 3) click：target 由 pointerup 的 target 决定
  for (const el of pathTo(upTarget)) el.fire("click", upTarget);

  return { upTarget: upTarget.name, log: [...log] };
}

console.log("========== 用例 1：直接点击 ⭐（期望：设置核心，不进入点选） ==========");
const oldC = run("old");
const fixC = run("fixed");

function show(label, r) {
  console.log(`\n--- ${label} ---`);
  console.log(`  pointerup target = ${r.upTarget}`);
  for (const l of r.log) console.log("  " + l);
}
show("旧实现（pointerdown 立刻捕获）", oldC);
show("修复后（位移后才捕获 + 放行按钮）", fixC);

const starOld = oldC.log.some((x) => x.startsWith("[star]"));
const starFix = fixC.log.some((x) => x.startsWith("[star]"));
const pickOld = oldC.log.some((x) => x.includes("进入点选"));
const pickFix = fixC.log.some((x) => x.includes("进入点选"));

console.log("\n──── 判定 ────");
console.log(`旧实现 ⭐ click 触发: ${starOld ? "是" : "否"}   误入点选: ${pickOld ? "是" : "否"}`);
console.log(`修复后 ⭐ click 触发: ${starFix ? "是" : "否"}   误入点选: ${pickFix ? "是" : "否"}`);

const c1ok = !starOld && starFix && !pickFix;


// ═══════════════════════════════════════════════════════════
// 用例 2：拖拽回归 —— 修复「位移后才捕获」不得破坏拖拽换位
// ═══════════════════════════════════════════════════════════
console.log("\n========== 用例 2：拖拽换位回归 ==========");

function runDrag(mode) {
  const events = [];
  const pitch = makeEl("pitch");
  const slotA = makeEl("slotA", { dataset: { slot: "0", playerId: "p1" } });
  const slotB = makeEl("slotB", { dataset: { slot: "1", playerId: "p2" } });
  slotA._isSlot = true;
  slotB._isSlot = true;

  let captureOwner = null;
  let ptr = { id: null, fromSlot: null, el: null, x: 0, y: 0, moved: false };

  pitch.addEventListener("pointerdown", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl) return;
    ptr = { id: e.pointerId, fromSlot: +slotEl.dataset.slot, el: slotEl, x: e.clientX, y: e.clientY, moved: false };
    if (mode === "old") captureOwner = slotEl;   // 旧：立刻捕获
  });

  pitch.addEventListener("pointermove", (e) => {
    if (ptr.id !== e.pointerId || ptr.fromSlot == null) return;
    const dx = e.clientX - ptr.x;
    const dy = e.clientY - ptr.y;
    if (!ptr.moved && dx * dx + dy * dy < 64) return;
    if (!ptr.moved && mode === "fixed") captureOwner = ptr.el;  // 修复：位移后才捕获
    ptr.moved = true;
    events.push("drag start from slot " + ptr.fromSlot);
  });

  pitch.addEventListener("pointerup", (e) => {
    if (ptr.id !== e.pointerId) return;
    const from = ptr.fromSlot;
    const moved = ptr.moved;
    const over = moved ? slotB : null;   // 模拟 elementFromPoint
    ptr = { id: null, fromSlot: null, el: null, x: 0, y: 0, moved: false };
    captureOwner = null;
    if (!moved || from == null) return;
    if (over && +over.dataset.slot !== from) events.push("swap " + from + " <-> " + (+over.dataset.slot));
  });

  // 带位移的拖拽：down(A) -> move(远) -> up
  pitch.fire("pointerdown", slotA, { pointerId: 2, clientX: 0, clientY: 0 });
  pitch.fire("pointermove", slotA, { pointerId: 2, clientX: 40, clientY: 40 });
  pitch.fire("pointerup", captureOwner || slotA, { pointerId: 2 });
  return { events: [...events] };
}

const dragOld = runDrag("old");
const dragFix = runDrag("fixed");
console.log("  旧实现: " + (dragOld.events.join(" | ") || "(无)"));
console.log("  修复后: " + (dragFix.events.join(" | ") || "(无)"));
const c2ok = dragFix.events.some((x) => x.startsWith("drag start")) &&
             dragFix.events.some((x) => x.startsWith("swap"));
console.log("  拖拽回归: " + (c2ok ? "✔ 通过" : "✘ 失败"));

// ═══════════════════════════════════════════════════════════
// 用例 3：源码对齐 —— 上面模拟的「修复后」必须与 js/main.js 实际代码一致
//         （skill §3.7：replica 不能自说自话，必须与原件对齐）
// ═══════════════════════════════════════════════════════════
console.log("\n========== 用例 3：与 js/main.js 源码对齐 ==========");

const src = readFileSync(join(here, "..", "js", "main.js"), "utf8").replace(/\r\n/g, "\n");

// 去掉注释再断言，避免「注释里提到 setPointerCapture」造成假阳性/假阴性
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// 精确定位 pointerdown 处理块（从 "pointerdown" 到对应的 "}, { passive" 或 "});"）
const pdBlock = code.match(/pitch\.addEventListener\(\s*"pointerdown"[\s\S]*?\n\s*\},?\s*\{?[^\n]*\n\s*\)?/)?.[0] || "";
const pmBlock = (() => {
  const i = code.indexOf('pitch.addEventListener("pointermove"');
  return i < 0 ? "" : code.slice(i, code.indexOf('pitch.addEventListener("pointerup"', i));
})();

const checks = [
  {
    label: "pointerdown 块里【没有】setPointerCapture（代码，非注释）",
    pass: pdBlock.length > 0 && !pdBlock.includes("setPointerCapture"),
  },
  {
    label: "pointermove 块里【有】按位移延迟捕获（代码，非注释）",
    pass: pmBlock.includes("ptr.moved") && pmBlock.includes("setPointerCapture"),
  },
  {
    label: "委托 click 放行 [data-core-id] / [data-role-edit]",
    pass: /closest\("\[data-core-id\]"\)[\s\S]{0,160}?closest\("\[data-role-edit\]"\)/.test(code),
  },
  {
    label: "⭐ 按钮绑定仍存在（bindTacticsCoreButtons 调 setCorePlayerId）",
    pass: /bindTacticsCoreButtons[\s\S]*?setCorePlayerId/.test(code),
  },
  {
    label: "代码里 setPointerCapture 只此一处",
    pass: (code.match(/setPointerCapture/g) || []).length === 1,
  },
];

let srcOk = true;
for (const c of checks) {
  console.log("  " + (c.pass ? "✔" : "✘") + " " + c.label);
  if (!c.pass) srcOk = false;
}

console.log("\n════════ 最终总结 ════════");
console.log("用例1 点击⭐   : " + (c1ok ? "✔ 通过" : "✘ 失败"));
console.log("用例2 拖拽回归 : " + (c2ok ? "✔ 通过" : "✘ 失败"));
console.log("用例3 源码对齐 : " + (srcOk ? "✔ 通过" : "✘ 失败"));

if (c1ok && c2ok && srcOk) {
  console.log("\n✅ 全部通过：⭐ 点击已恢复、拖拽换位未受影响、模拟与源码一致。");
} else {
  console.log("\n❌ 存在失败项。");
  process.exit(1);
}
