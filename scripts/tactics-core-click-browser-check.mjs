/**
 * 战术板核心球员 ⭐ 点击 —— 真实浏览器验证（Playwright + Chromium）
 *
 * 为什么需要这一层：
 *   `scripts/tactics-core-click-audit.mjs` 用「事件路径模拟器」证明了
 *   「setPointerCapture 会改写 pointerup/click 的 target」这条**因果链**，
 *   但它终究是**我写的模型**。真正的判据只有一条：
 *   **在真实 Chromium 里，绑定在 ⭐ 上的监听器到底有没有被调用。**
 *
 *   本脚本不复刻 main.js（那是单体巨文件，无法单独加载），而是：
 *     ① 用真实 index.html 的 CSS（`css/style.css`）+ 真实 DOM 结构建战术板；
 *     ② 逐字复制 main.js 里**那两段**事件绑定代码（pointerdown 委托 + 委托 click
 *        + ⭐ 自身 click），分别跑「旧实现」与「修复后」两版；
 *     ③ 用 Playwright 的 `page.mouse` 做**真实鼠标按下/抬起**，读浏览器实际行为。
 *
 *   关键区别：模拟器里「pointerup 的 target 会被改写」是我断言的；
 *   这里它是 Chromium 自己决定的。若 Chromium 的行为与我的模型不符，本脚本会失败。
 *
 * 运行：node scripts/tactics-core-click-browser-check.mjs
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { chromium } from "playwright";

const port = 8881;
const baseUrl = `http://127.0.0.1:${port}/`;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: repoRoot,
  stdio: "ignore",
  windowsHide: true,
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const r = await fetch(baseUrl);
      if (r.ok) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("本地测试服务器未启动");
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ────────────────────────────────────────────────────────────
 * 页面内构造：真实 CSS + 真实 DOM 结构 + 两版事件绑定
 * ──────────────────────────────────────────────────────────── */
const BUILD = (mode) => `
(() => {
  const log = [];
  window.__log = log;

  if (!document.getElementById("__tac-style")) {
    const style = document.createElement("link");
    style.id = "__tac-style";
    style.rel = "stylesheet";
    style.href = "/css/style.css";
    document.head.appendChild(style);
  }

  // 只清掉上一轮的战术板，不动 head（清 body 会连带移除样式表引用）
  document.querySelectorAll("#pitch").forEach((el) => el.remove());

  const pitch = document.createElement("div");
  pitch.id = "pitch";
  pitch.className = "pitch";
  document.body.appendChild(pitch);

  // 与 renderTactics() 产出的真实结构一致
  pitch.innerHTML = \`
    <div class="player-dot tac-slot" style="left:50%;top:40%" draggable="true"
         data-slot="0" data-slot-pos="ST" data-player-id="p1">
      <div class="circle kit-dot"><span>10</span></div>
      <div class="name"><button type="button" class="player-link pitch-player-link"
           data-player-link="p1">#10 测试</button></div>
      <button type="button" class="tac-core-btn" data-core-id="p1"
              aria-pressed="false">⭐</button>
      <button type="button" class="tac-role-badge" data-role-edit="0">CM · 策应</button>
    </div>
    <div class="player-dot tac-slot" style="left:30%;top:40%" draggable="true"
         data-slot="1" data-slot-pos="CM" data-player-id="p2">
      <div class="circle kit-dot"><span>8</span></div>
      <div class="name"><button type="button" class="player-link pitch-player-link"
           data-player-link="p2">#8 另一人</button></div>
      <button type="button" class="tac-core-btn" data-core-id="p2"
              aria-pressed="false">⭐</button>
      <button type="button" class="tac-role-badge" data-role-edit="1">DM · 防守</button>
    </div>
  \`;

  const tacPick = { mode: null, slot: null, playerId: null, dragging: false };
  window.__tacPick = tacPick;

  // ── ⭐ 自己的 click（等价 main.js:6888 bindTacticsCoreButtons）──
  pitch.querySelectorAll("[data-core-id]").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      log.push("star:" + btn.getAttribute("data-core-id"));
    });
  });

  // ── 角色徽章自己的 click（等价 main.js:6998 bindTacticsRoleEditor）──
  pitch.querySelectorAll("[data-role-edit]").forEach((btn) => {
    btn.addEventListener("pointerdown", (event) => event.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      log.push("role:" + btn.getAttribute("data-role-edit"));
    });
  });

  // ── pointerdown 委托（两版的差别就在 setPointerCapture 的时机）──
  let ptr = { id: null, fromSlot: null, el: null, x: 0, y: 0, moved: false };
  window.__ptr = () => ptr;

  pitch.addEventListener("pointerdown", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl || !slotEl.dataset.playerId) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    ptr = { id: e.pointerId, fromSlot: +slotEl.dataset.slot, el: slotEl,
            x: e.clientX, y: e.clientY, moved: false };
    ${mode === "old" ? "try { slotEl.setPointerCapture(e.pointerId); log.push('capture@down'); } catch (_) {}"
                     : "/* 修复：此处不捕获 */"}
  }, { passive: true });

  pitch.addEventListener("pointermove", (e) => {
    if (ptr.id !== e.pointerId || ptr.fromSlot == null) return;
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    if (!ptr.moved && dx * dx + dy * dy < 64) return;
    ${mode === "fixed" ? "if (!ptr.moved) { try { ptr.el?.setPointerCapture?.(e.pointerId); log.push('capture@move'); } catch (_) {} }"
                       : ""}
    ptr.moved = true;
    tacPick.dragging = true;
    pitch.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".tac-slot");
    if (over) over.classList.add("drag-over");
  });

  const endDrag = (e) => {
    if (ptr.id == null || ptr.id !== e.pointerId) return;
    const from = ptr.fromSlot, moved = ptr.moved;
    pitch.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    try { ptr.el?.releasePointerCapture?.(e.pointerId); } catch (_) {}
    ptr = { id: null, fromSlot: null, el: null, x: 0, y: 0, moved: false };
    if (!moved || from == null) {
      setTimeout(() => { tacPick.dragging = false; }, 30);
      return;
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".tac-slot");
    if (over && +over.dataset.slot !== from) log.push("swap:" + from + "<->" + over.dataset.slot);
    setTimeout(() => { tacPick.dragging = false; }, 30);
  };
  pitch.addEventListener("pointerup", endDrag);
  pitch.addEventListener("pointercancel", endDrag);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);


  // ── 原生 DnD 委托（等价 main.js:6458-6523，桌面拖拽走这条路）──
  pitch.addEventListener("dragstart", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl) return;
    const pid = slotEl.dataset.playerId;
    if (!pid) { e.preventDefault(); return; }
    tacPick.dragging = true;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain",
      JSON.stringify({ type: "slot", slot: +slotEl.dataset.slot, playerId: pid }));
    slotEl.classList.add("dragging");
  });
  pitch.addEventListener("dragover", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    pitch.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    slotEl.classList.add("drag-over");
  });
  pitch.addEventListener("drop", (e) => {
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl) return;
    e.preventDefault();
    slotEl.classList.remove("drag-over");
    let payload = null;
    try { payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}"); } catch (_) { return; }
    const toSlot = +slotEl.dataset.slot;
    if (payload.type === "slot" && payload.slot != null) {
      if (+payload.slot === toSlot) return;
      log.push("swap:" + payload.slot + "<->" + toSlot);
    }
    tacPick.dragging = false;
  });
  pitch.addEventListener("dragend", () => {
    pitch.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    setTimeout(() => { tacPick.dragging = false; }, 30);
  });

  // ── click 委托（修复版多两条放行）──
  pitch.addEventListener("click", (e) => {
    if (tacPick.dragging) return;
    if (e.target.closest("[data-player-link]") && !tacPick.mode) return;
    ${mode === "fixed"
      ? 'if (e.target.closest("[data-core-id]") || e.target.closest("[data-role-edit]")) return;'
      : ""}
    const slotEl = e.target.closest(".tac-slot");
    if (!slotEl) return;
    e.preventDefault();
    e.stopPropagation();
    log.push("pick:slot" + slotEl.dataset.slot);
  });

  return true;
})()
`;

async function run() {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  // 用空白页而非 index.html：后者会加载 js/main.js 并可能触发导航，
  // 导致「Execution context destroyed」。我们只需要真实 CSS + 真实 DOM 语义。
  await page.goto(baseUrl + "__blank_for_tactics_check__", { waitUntil: "domcontentloaded" })
    .catch(() => page.goto("about:blank"));

  const boxOf = async (sel) => {
    const el = await page.$(sel);
    const b = await el.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  /* ── 用例 1：点击 ⭐（旧 vs 修复）── */
  console.log("\n========== 用例 1：真实 Chromium 点击 ⭐ ==========");
  const perMode = {};

  for (const mode of ["old", "fixed"]) {
    await page.evaluate(BUILD(mode));
    await page.waitForTimeout(120);

    const pt = await boxOf('.tac-slot[data-slot="0"] [data-core-id]');
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(80);

    const log = await page.evaluate(() => window.__log.slice());
    perMode[mode] = log;
    console.log(`\n--- ${mode === "old" ? "旧实现（pointerdown 立刻捕获）" : "修复后（位移后才捕获 + 放行）"} ---`);
    console.log("  " + (log.join(" | ") || "(无事件)"));
  }

  const oldStar = perMode.old.some((x) => x.startsWith("star:"));
  const fixStar = perMode.fixed.some((x) => x.startsWith("star:"));
  const oldPick = perMode.old.some((x) => x.startsWith("pick:"));
  const fixPick = perMode.fixed.some((x) => x.startsWith("pick:"));

  record("旧实现：⭐ click 未触发（复现缺陷）", !oldStar);
  record("旧实现：误入点选模式（复现次生现象）", oldPick);
  record("修复后：⭐ click 已触发", fixStar);
  record("修复后：不再误入点选模式", !fixPick);

  /* ── 用例 2：点击角色徽章 ── */
  console.log("\n========== 用例 2：真实 Chromium 点击角色徽章 ==========");
  const roleMode = {};
  for (const mode of ["old", "fixed"]) {
    await page.evaluate(BUILD(mode));
    await page.waitForTimeout(120);
    const pt = await boxOf('.tac-slot[data-slot="0"] [data-role-edit]');
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(80);
    roleMode[mode] = await page.evaluate(() => window.__log.slice());
    console.log(`  ${mode}: ` + (roleMode[mode].join(" | ") || "(无事件)"));
  }
  // ⚠ 修正：`bindTacticsRoleEditor`（main.js:7003）在徽章上绑了 pointerdown →
  //   stopPropagation，所以 pointerdown 根本不冒泡到 #pitch 的委托 ⇒ 从不触发捕获
  //   ⇒ 徽章【不受】该缺陷影响，新旧实现下都应触发。
  //   （我最初的文档写成「徽章也受影响」，那是错的 —— 被这个用例纠正了。）
  record("旧实现：角色徽章本就正常（自带 pointerdown 隔离）",
    roleMode.old.some((x) => x.startsWith("role:")));
  record("修复后：角色徽章仍然正常", roleMode.fixed.some((x) => x.startsWith("role:")));
  record("修复未误伤徽章（两版行为一致）",
    roleMode.old.some((x) => x.startsWith("role:")) === roleMode.fixed.some((x) => x.startsWith("role:")));

  /* ── 用例 3：空白处点击槽位仍应进入点选（不能误伤）── */
  console.log("\n========== 用例 3：点击槽位本体（应仍进入点选）==========");
  await page.evaluate(BUILD("fixed"));
  await page.waitForTimeout(120);
  const circlePt = await boxOf('.tac-slot[data-slot="0"] .circle');
  await page.mouse.move(circlePt.x, circlePt.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);
  const circleLog = await page.evaluate(() => window.__log.slice());
  console.log("  " + (circleLog.join(" | ") || "(无事件)"));
  record("修复后：点圆点本体仍进入点选模式", circleLog.some((x) => x.startsWith("pick:slot0")));

  /* ── 用例 4：拖拽换位回归 ──
   *
   * 🔴 这里有一个**真实浏览器才暴露的事实**（本项目文档此前未记录）：
   *   `.tac-slot` 带 `draggable="true"`，所以**鼠标**拖拽会启动**原生 HTML5 DnD**，
   *   浏览器随即把 pointer 序列用 `pointercancel` 终结 ——
   *   `pointerup` 根本不会到达 pitch 的委托。
   *   ⇒ 桌面上「拖拽换位」实际走的是 dragstart/dragover/drop 那条路
   *     （main.js:6458-6523），pointer 那条路是给**触屏**用的备份。
   *
   *   所以：用 mouse.down/move/up 测 pointer 路是**测错了对象**（必被 cancel）。
   *   正确做法是 dispatch 真实的 DnD 事件序列。
   */
  console.log("\n========== 用例 4：真实 DnD 拖拽换位（桌面路径）==========");
  await page.evaluate(BUILD("fixed"));
  await page.waitForTimeout(120);
  const dndLog = await page.evaluate(() => {
    const from = document.querySelector('.tac-slot[data-slot="0"]');
    const to = document.querySelector('.tac-slot[data-slot="1"]');
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    return window.__log.slice();
  });
  console.log("  " + (dndLog.join(" | ") || "(无事件)"));
  record("修复后：原生 DnD 拖拽换位生效", dndLog.some((x) => x.startsWith("swap:0<->1")));

  /* ── 用例 5：触屏 pointer 拖拽（真实指针位移，不经原生 DnD）── */
  console.log("\n========== 用例 5：触屏 pointer 拖拽 ==========");
  await page.evaluate(() => {
    // 去掉 draggable，模拟触屏上原生 DnD 不可用的情形
    document.querySelectorAll(".tac-slot").forEach((el) => el.removeAttribute("draggable"));
  });
  const ptFrom = await boxOf('.tac-slot[data-slot="0"] .circle');
  const ptTo = await boxOf('.tac-slot[data-slot="1"] .circle');
  await page.mouse.move(ptFrom.x, ptFrom.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(ptFrom.x + ((ptTo.x - ptFrom.x) * i) / 10, ptFrom.y + ((ptTo.y - ptFrom.y) * i) / 10);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
  const ptrLog = await page.evaluate(() => window.__log.slice());
  console.log("  " + (ptrLog.join(" | ") || "(无事件)"));
  record("触屏 pointer 路：拖拽换位生效", ptrLog.some((x) => x.startsWith("swap:0<->1")));

  await browser.close();
  server.kill();

  /* ── 汇总 ── */
  const failed = results.filter((r) => !r.ok);
  console.log(`\n════════ 结果：${results.length - failed.length} 通过 / ${results.length} 总计 ════════`);
  if (failed.length) {
    console.log("\n❌ 失败项：");
    for (const f of failed) console.log("  - " + f.name + (f.detail ? " — " + f.detail : ""));
    process.exit(1);
  }
  console.log("\n✅ 真实浏览器验证全部通过。");
}

run().catch((err) => {
  console.error(err);
  try { server.kill(); } catch {}
  process.exit(1);
});
