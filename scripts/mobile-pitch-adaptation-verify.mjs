/**
 * 手机端横屏适配（B 方案）浏览器目验。
 *
 * ## 为什么必须走浏览器
 *
 * 本改动全部是 **CSS 运行时行为**：
 *   · `@media (pointer: coarse) and (orientation: landscape)` → 横屏 contain
 *   · `@media (pointer: coarse) and (orientation: portrait)`  → 显示横持提示、藏球场
 *   · 容器查询 `100cqw / 100cqh` → 球场等比放进可用矩形
 * 静态读 CSS 证明不了这些在真机上是否命中、contain 后球场是否真的**整块在屏内**、
 * 是否出现意外的横向滚动。所以必须在真实渲染路径下量。
 *
 * ## 两个姿态各自的判据
 *
 * 竖屏（390×844，hasTouch）：
 *   - `.mp-rotate-hint` 可见（computed display 非 none）
 *   - `.mp-wrap` 不可见（display: none）
 *   - 页面无横向滚动
 *
 * 横屏（844×390，hasTouch）：
 *   - `.mp-rotate-hint` 隐藏
 *   - `.mp-wrap` 可见
 *   - **球场整块在视口内**（field 的 rect 不超出视口）
 *   - 球场保持 93.45/68 ≈ 1.374 的宽高比（容差 2%）
 *   - 页面无横向滚动
 *
 * 另外跑一个**桌面反例**（1440×1000，无 touch）：提示必须不出现、
 * 球场必须可见 —— 防止 `pointer: coarse` 规则误伤桌面。
 *
 * ## 用法
 *
 *   node scripts/mobile-pitch-adaptation-verify.mjs
 * 产出：.tmp-video/mobile-*.png（.tmp- 族被 .gitignore 忽略，不入库）
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const port = 8881;
const baseUrl = `http://127.0.0.1:${port}/`;
const OUT = ".tmp-video";

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: process.cwd(),
  stdio: "ignore",
});
process.on("exit", () => server.kill());

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("static server did not come up");
}

/** 关掉自定义 modal（推进后可能弹「关键事件」详情），否则它会挡住按钮点击。 */
async function closeModalIfAny(page) {
  const closed = await page.evaluate(() => {
    const m = document.querySelector("#modal");
    if (!m) return false;
    const vis = getComputedStyle(m);
    if (vis.display === "none" || vis.visibility === "hidden" || m.classList.contains("hidden")) return false;
    // 优先找关闭按钮；找不到就点遮罩
    const btn = m.querySelector("[data-close], .modal-close, .modal-x, button.close")
      || [...m.querySelectorAll("button")].find((b) => /关闭|确定|继续|知道了|OK|×/i.test(b.textContent || ""));
    if (btn) { btn.click(); return true; }
    m.click();
    return true;
  }).catch(() => false);
  if (closed) await page.waitForTimeout(400);
  return closed;
}

/** 把游戏推进到「可点进行比赛」，然后点进去。返回 page。 */
async function enterMatch(browser, viewport, { touch }) {
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: touch ? 3 : 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  page.on("dialog", async (d) => { await d.accept(); });

  // ⚠ 不要碰 serviceWorker！实测两种干预都坏：
  //   ① 替换整个 navigator.serviceWorker ⇒ main.js 顶层 addEventListener 抛错，模块中断；
  //   ② 包装 register 后 unregister ⇒ "Failed to update a ServiceWorker ... Not found"，
  //      页面显示「启动失败：」，vcfmMainApi 永不出现。
  //   不干预时首屏完全正常（对照诊断已验证）。本探针量 CSS 布局，SW 无害。
  void context;

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  // ⚠ 首屏初始化偶发慢（要建整个联赛数据）。用显式轮询而非 waitForFunction：
  //   `waitUntil: "networkidle"` 在手机视口下可能迟不达成，会把后续 waitForFunction
  //   一起拖死（实测踩过）。这里 domcontentloaded + 自己轮询最稳。
  {
    let ok = false;
    for (let i = 0; i < 90; i++) {
      ok = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
      if (ok) break;
      await page.waitForTimeout(1000);
    }
    if (!ok) {
      const diag = await page.evaluate(() => ({
        hasApi: !!window.vcfmMainApi,
        hasInput: !!document.querySelector("#input-manager"),
        screenMain: document.querySelector("#screen-main")?.className,
        bodyText: (document.body?.innerText || "").slice(0, 160),
      })).catch(() => "evaluate failed");
      console.log("  [首屏诊断]", JSON.stringify(diag));
      throw new Error("首屏未就绪：window.vcfmMainApi 未出现");
    }
  }
  await page.fill("#input-manager", "Mobile Audit");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 90_000 });

  // ⚠ 「推进一天」在手机视口下逐天点要 10+ 次才到比赛日，且偶发卡住。
  //   改用「推进到比赛日」按钮（#btn-advance-matchday）一步到位；
  //   它同样是异步的（计算期 disabled + aria-busy），用「进行比赛可点」作完成信号。
  // ⚠ 「推进到比赛日」要**真的逐场模拟整个联赛的其他比赛**
  //   （toast 会显示「正在运行空间比赛 n/134」），实测要数分钟。
  //   所以等完成信号的上限给足 12 分钟；点一次即可，不要重复点。
  let kicked = false;
  await page.locator("#btn-advance-matchday").click();
  for (let i = 0; i < 360 && !kicked; i++) {
    await page.waitForTimeout(2000);
    // 推进过程中会弹「关键事件」详情，挡住按钮 ⇒ 每轮都尝试关掉
    await closeModalIfAny(page);
    const st = await page.evaluate(() => ({
      playDisabled: (() => { const b = document.querySelector("#btn-play-match"); return b ? b.disabled : null; })(),
      toast: document.querySelector("#toast")?.textContent || "",
    }));
    kicked = st.playDisabled === false;
    if (i % 30 === 0) console.log("  [推进]", i * 2, "s", JSON.stringify(st));
  }
  assert.ok(kicked, "推进到比赛日后仍无「进入比赛」可点");
  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  // 进入快速模拟，让球场 DOM（mp-wrap / mp-camera）真的挂上。
  await page.locator("#btn-sim-fast").click();
  // ⚠ 不能用 waitForSelector("#mp-camera", visible)：竖屏下本方案**故意**
  //   把 .mp-wrap 设成 display:none（球场塞不进竖屏，改给横持提示），
  //   所以竖屏的 #mp-camera 必然 hidden。改为等「DOM 已挂载」（attached），
  //   可见性由后面的 probe() 分别按姿态断言。
  await page.waitForSelector("#mp-camera", { state: "attached", timeout: 60_000 });
  await page.waitForTimeout(1200);
  return { page, context };
}

/** 在页内量当前姿态的关键尺寸与可见性。 */
async function probe(page) {
  return page.evaluate(() => {
    const hint = document.querySelector("#mp-rotate-hint");
    const wrap = document.querySelector(".mp-wrap");
    // ⚠ 判「球场藏没藏」要看 `.mp-pitch-slot`（球场本体），**不是** `.mp-wrap`：
    //   `.mp-rotate-hint` 是 `.mp-wrap` 的子元素（与 `.mp-pitch-slot` 同级），
    //   竖屏要藏的是 `.mp-pitch-slot`，`.mp-wrap` 必须留着（提示在里面）。
    //   早期版本藏 `.mp-wrap` 会把提示一起藏掉（实测踩过，见 AGENTS）。
    const slot = document.querySelector(".mp-pitch-slot");
    const field = document.querySelector(".mp-field");
    const vis = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        ratio: r.height ? Number((r.width / r.height).toFixed(3)) : 0,
      };
    };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      hintVisible: vis(hint),
      hintDisplay: hint ? getComputedStyle(hint).display : null,
      hintRect: rectOf(hint),
      wrapVisible: vis(wrap),
      wrapDisplay: wrap ? getComputedStyle(wrap).display : null,
      slotVisible: vis(slot),
      slotDisplay: slot ? getComputedStyle(slot).display : null,
      fieldRect: rectOf(field),
      scrollX: document.scrollingElement.scrollWidth - window.innerWidth,
    };
  });
}

const PITCH_RATIO = 93.45 / 68;

let browser;
try {
  mkdirSync(OUT, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });

  // ============ ① 竖持手机 ============
  console.log("\n=== ① 竖持手机 390×844（touch） ===");
  {
    const { page, context } = await enterMatch(browser, { width: 390, height: 844 }, { touch: true });
    const r = await probe(page);
    console.log("  ", JSON.stringify(r));
    await page.screenshot({ path: `${OUT}/mobile-portrait.png` });

    assert.equal(r.hintVisible, true, "竖屏必须显示「请横持手机」提示");
    assert.equal(r.slotVisible, false, "竖屏必须藏起球场本体 .mp-pitch-slot");
    assert.ok(
      r.fieldRect && r.fieldRect.w === 0 && r.fieldRect.h === 0,
      `竖屏球场不得有尺寸，实测 ${JSON.stringify(r.fieldRect)}`
    );
    // 提示必须真的有尺寸（不能是「display:flex 但被祖先藏掉」的 0×0）
    assert.ok(
      r.hintRect && r.hintRect.w > 0 && r.hintRect.h > 0,
      `竖屏提示必须有可见尺寸，实测 ${JSON.stringify(r.hintRect)}`
    );
    // ⚠ `.mp-wrap` 必须**保留**（它是提示的父级）；它被藏掉才是 bug
    assert.equal(r.wrapVisible, true, "竖屏 .mp-wrap 必须保留（提示在它里面），只藏 .mp-pitch-slot");
    assert.ok(r.scrollX <= 0, `竖屏不得横向滚动，超出 ${r.scrollX}px`);
    await context.close();
  }

  // ============ ② 横持手机 ============
  console.log("\n=== ② 横持手机 844×390（touch） ===");
  {
    const { page, context } = await enterMatch(browser, { width: 844, height: 390 }, { touch: true });
    const r = await probe(page);
    console.log("  ", JSON.stringify(r));
    await page.screenshot({ path: `${OUT}/mobile-landscape.png` });

    assert.equal(r.hintVisible, false, "横屏必须隐藏「请横持手机」提示");
    assert.equal(r.slotVisible, true, "横屏必须显示球场本体 .mp-pitch-slot");
    assert.ok(r.fieldRect, "横屏应能量到 .mp-field 的矩形");
    // 整块在视口内（允许 1px 取整误差）
    const f = r.fieldRect;
    assert.ok(f.x >= -1, `球场左缘超出视口：x=${f.x}`);
    assert.ok(f.y >= -1, `球场上缘超出视口：y=${f.y}`);
    assert.ok(f.x + f.w <= r.viewport.w + 1, `球场右缘超出视口：${f.x + f.w} > ${r.viewport.w}`);
    assert.ok(f.y + f.h <= r.viewport.h + 1, `球场下缘超出视口：${f.y + f.h} > ${r.viewport.h}`);
    // 宽高比保持 93.45/68
    const dev = Math.abs(f.ratio - PITCH_RATIO) / PITCH_RATIO;
    assert.ok(dev <= 0.02, `球场宽高比应保持 ${PITCH_RATIO.toFixed(3)}，实测 ${f.ratio}（偏差 ${(dev * 100).toFixed(1)}%）`);
    assert.ok(r.scrollX <= 0, `横屏不得横向滚动，超出 ${r.scrollX}px`);
    await context.close();
  }

  // ============ ③ 桌面反例（规则不得误伤桌面） ============
  console.log("\n=== ③ 桌面 1440×1000（无 touch） ===");
  {
    const { page, context } = await enterMatch(browser, { width: 1440, height: 1000 }, { touch: false });
    const r = await probe(page);
    console.log("  ", JSON.stringify(r));
    await page.screenshot({ path: `${OUT}/mobile-desktop-control.png` });

    assert.equal(r.hintVisible, false, "桌面绝不能出现「请横持手机」提示");
    assert.equal(r.slotVisible, true, "桌面必须显示球场本体 .mp-pitch-slot");
    assert.equal(r.wrapVisible, true, "桌面必须显示 .mp-wrap");
    assert.ok(r.scrollX <= 0, `桌面不得横向滚动，超出 ${r.scrollX}px`);
    await context.close();
  }

  console.log("\n✅ 手机端横屏适配（B 方案）目验通过：");
  console.log("   竖持 → 提示「请横持手机」、藏球场；");
  console.log("   横持 → 球场整块等比放入视口，无滚动；");
  console.log("   桌面 → 不受影响（pointer: coarse 未误伤）。");
  console.log(`   截图：${OUT}/mobile-portrait.png, mobile-landscape.png, mobile-desktop-control.png`);
} finally {
  await browser?.close();
  server.kill();
}
