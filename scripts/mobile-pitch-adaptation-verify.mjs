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
 * ②c 全屏观赛（复用 ② 的 page，不重跑联赛）：
 *   - 支持全屏时 `#btn-match-fullscreen` 必须**真的可见**
 *     （同时守住 `.fmm-match-bar .btn.icon-btn { display:inline-grid }` 压掉
 *     UA `[hidden]{display:none}` 的特异性坑）
 *   - 点击后 `document.fullscreenElement` 是整块比赛界面
 *   - 全屏下球场整块在视口内、比例正确、无纵向滚动
 *   - **控制条仍在视口内且不压球场**（全屏藏了浏览器 UI，控制条是唯一退出入口）
 *   - 再点一次能退出，`aria-pressed` 同步回 false
 *   - 模拟 `document.fullscreenEnabled === false`（iPhone Safari 的真实情形）
 *     时按钮必须 `hidden` 且 `display:none`
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

// 用例过滤：每个用例都要**真跑一遍 134 场联赛**（~2.5 分钟）才能进比赛界面，
// 全跑一轮 ~13 分钟。调某个姿态时没必要把四个都跑一遍。
//   VCFM_MOBILE_CASES=2b node scripts/mobile-pitch-adaptation-verify.mjs
// 默认全跑。⚠ 交付前必须**全跑一轮**，过滤只用于迭代。
const ONLY = new Set(
  (process.env.VCFM_MOBILE_CASES || "1,2,2b,3")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
async function runCase(id, fn) {
  if (!ONLY.has(id)) {
    console.log(`\n（跳过用例 ${id}）`);
    return;
  }
  await fn();
}

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
    // 高度分解：找出「球场之外的高度」都花在哪。
    // 手机横屏可用高度本来就矮（实测 dvh≈295），必须知道每一段占多少才能对症压缩，
    // 而不是猜「大概是解说栏吧」。
    const stackOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { y: Math.round(r.y), h: Math.round(r.height) };
    };
    const stack = {
      layout: stackOf(".match-layout"),
      head: stackOf(".fmm-scoreboard"),
      body: stackOf(".fmm-match-body"),
      pitchCol: stackOf(".fm-pitch-col"),
      wrap: stackOf(".mp-wrap"),
      slot: stackOf(".mp-pitch-slot"),
      field: stackOf(".mp-field"),
      dock: stackOf(".mp-fmm-dock"),
      commentary: stackOf(".fmm-commentary"),
      bar: stackOf(".fmm-match-bar"),
    };
    // 「非球场高度」预算 + 比分/控球浮层**遮挡量**（2026-09-22）。
    // ⚠ 必须减**两个**浮层：只减比分条，会把「控球条改浮层」误读成收益 ——
    //   它只是从「球场下方」搬到「球场底部压住」，球场盒变大但没多看见。
    //   （这个坑在 `_mobile-match-chrome-lab.mjs` 的第一版里真踩过。）
    const rOf = (sel) => document.querySelector(sel)?.getBoundingClientRect() || null;
    const overlapY = (a, b) =>
      a && b ? Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
    const sbR = rOf(".fmm-scoreboard");
    const barR = rOf(".fmm-match-bar");
    const dockR = rOf(".mp-fmm-dock");
    const camR = rOf(".mp-camera");
    const chrome = {
      scoreboardH: Math.round(sbR?.height || 0),
      barH: Math.round(barR?.height || 0),
      dockH: Math.round(dockR?.height || 0),
      chromePct: +(
        (((sbR?.height || 0) + (barR?.height || 0) + (dockR?.height || 0)) / window.innerHeight) *
        100
      ).toFixed(1),
      cameraH: Math.round(camR?.height || 0),
      occScoreboard: Math.round(overlapY(sbR, camR)),
      occDock: Math.round(overlapY(dockR, camR)),
      visiblePitch: camR
        ? Math.round(camR.height - overlapY(sbR, camR) - overlapY(dockR, camR))
        : 0,
    };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      chrome,
      hintVisible: vis(hint),
      hintDisplay: hint ? getComputedStyle(hint).display : null,
      hintRect: rectOf(hint),
      wrapVisible: vis(wrap),
      wrapDisplay: wrap ? getComputedStyle(wrap).display : null,
      slotVisible: vis(slot),
      slotDisplay: slot ? getComputedStyle(slot).display : null,
      fieldRect: rectOf(field),
      scrollX: document.scrollingElement.scrollWidth - window.innerWidth,
      scrollY: document.scrollingElement.scrollHeight - window.innerHeight,
      // 溢出**定位**：`scrollY` 只告诉你「溢出多少」，不告诉你「谁溢出的」。
      // 2026-09-20 实测：844×390 与 800×295 都溢出 11px，但 stack 里所有被跟踪
      // 元素的最大底边只有 380（< 视口 390）⇒ **溢出的东西不在跟踪清单里**。
      // 所以这里改成「全文档扫描」：把所有 bottom 超出视口的元素列出来。
      // （纪律：`scrollY` 是症状，`overflowing` 才是病因。）
      scroll: (() => {
        const innerH = window.innerHeight;
        const desc = (el) => {
          if (!el || el.nodeType !== 1) return String(el);
          const id = el.id ? `#${el.id}` : "";
          const cls = el.classList.length ? `.${[...el.classList].slice(0, 3).join(".")}` : "";
          return `${el.tagName.toLowerCase()}${id}${cls}`;
        };
        const found = [];
        const nearBottom = [];
        // ⚠ 第一版扫描只查 `body *` 的 `getBoundingClientRect()`，`overflowingCount` 是 **0**；
        //   第二版补了 `html`/`body` 与 `margin-bottom`，**还是 0**，而 `html.scrollHeight`
        //   依然 306（视口 295）。原因是我把两个坐标系混用了：
        //   `r.top` 是**视口坐标**，`scrollHeight` 是**文档尺寸**，`r.top + scrollH`
        //   不是任何东西的底边。而且页面此时**已经滚到底**（`window.scrollY ≈ 11`），
        //   所有 `rect.y` 都被整体上移 ⇒ 看起来「什么都没溢出」。
        //   ⇒ 改成：只看 `rect`（视口坐标，与 `innerHeight` 同框，无需换算），
        //     并且**把最接近底边的 15 个元素全部列出来**——不设「必须超界」的门槛，
        //     否则又会因为门槛卡在噪声里而看不到真相。
        const nodes = [document.documentElement, document.body, ...document.querySelectorAll("body *")];
        for (const el of nodes) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          const cs = getComputedStyle(el);
          const mb = parseFloat(cs.marginBottom) || 0;
          const entry = {
            el: desc(el),
            y: Math.round(r.y),
            h: Math.round(r.height),
            bottom: Math.round(r.bottom),
            marginBottom: Math.round(mb),
            scrollH: el.scrollHeight || 0,
            clientH: el.clientHeight || 0,
            pos: cs.position,
            overflowY: cs.overflowY,
          };
          if (r.bottom + mb > innerH + 0.5) found.push(entry);
          if (r.bottom + mb > innerH - 40) nearBottom.push(entry);
        }
        found.sort((a, b) => b.bottom - a.bottom || b.el.length - a.el.length);
        nearBottom.sort((a, b) => b.bottom - a.bottom || b.el.length - a.el.length);
        const bottoms = Object.values(stack)
          .filter(Boolean)
          .map((s) => s.y + s.h);
        // ⚠ 不用 `Math.max(...bottoms)`：本项目已因展开运算符在大数组上爆栈
        //   （`RangeError: Maximum call stack size exceeded`）。这里只有 10 个元素，
        //   但保持 `reduce` 习惯，避免以后复制到长数组上踩坑。
        const maxBottom = bottoms.reduce((m, v) => (v > m ? v : m), -Infinity);
        // 单位真相：`innerHeight` 只是「视觉视口」，而 CSS 的 `dvh/vh/lvh/svh`
        // 各指不同的视口。项目横屏档写的是 `calc(100dvh - 58px)`，
        // 若 `dvh ≠ innerHeight`，那 11px 就可能是**单位口径差**而不是布局错。
        // 用临时元素把四个单位各量一次（量完即删，不污染布局）。
        const unitProbe = {};
        for (const unit of ["vh", "dvh", "lvh", "svh"]) {
          const d = document.createElement("div");
          d.style.cssText = `position:absolute;left:-9999px;top:0;width:0;height:100${unit};`;
          document.body.appendChild(d);
          unitProbe[unit] = Math.round(d.getBoundingClientRect().height);
          d.remove();
        }
        return {
          scrollH: document.scrollingElement.scrollHeight,
          innerH,
          scrollYActual: Math.round(window.scrollY),
          visualViewportH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
          units: unitProbe,
          docScrollH: document.documentElement.scrollHeight,
          bodyScrollH: document.body.scrollHeight,
          scrollingEl: desc(document.scrollingElement),
          trackedMaxBottom: Number.isFinite(maxBottom) ? Math.round(maxBottom) : null,
          overflowingCount: found.length,
          overflowing: found.slice(0, 12),
          nearBottom: nearBottom.slice(0, 15),
        };
      })(),
      stack,
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
  await runCase("1", async () => {
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
  });

  // ============ ② 横持手机 ============
  console.log("\n=== ② 横持手机 844×390（touch） ===");
  await runCase("2", async () => {
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
    // 2026-09-20 起 ② 也断言纵向不滚：修 `--fmm-shell-pad` 之前这里稳定溢出 11px
    // （`#screen-match` 的 rect 高 = 视口 + 10.4，见 css 里 `:root` 处注释）。
    assert.ok(r.scrollY <= 0, `横屏不得纵向滚动，超出 ${r.scrollY}px`);
    console.log("   滚动诊断:", JSON.stringify(r.scroll));

    // ============ ②c 全屏观赛（复用 ② 的 page） ============
    // ⚠ 为什么复用同一页：`enterMatch()` 每调一次就要**真跑一遍 134 场联赛**
    //   （~3 分钟）。而「进全屏」本来就是用户在同一场里点一下的动作，
    //   重开 context 既慢又不是真实路径。
    //
    // 这条用例守的是「手机横屏看比赛还是太小」的**根因**：
    // 手机横持视口高 ~390px，浏览器工具栏吃掉 ~95px ⇒ dvh≈295。
    // 进全屏后工具栏消失、dvh 直接等于屏幕高。Playwright headless
    // （chromium / msedge 通道都验过）完整支持 `requestFullscreen`，
    // 所以这条路径**可以**自动验证，不必只靠真机肉眼看。
    console.log("  --- ②c 全屏观赛 ---");
    const fsBtn = await page.evaluate(() => {
      const b = document.querySelector("#btn-match-fullscreen");
      if (!b) return { exists: false };
      const cs = getComputedStyle(b);
      const pause = document.querySelector("#btn-match-pause");
      const pauseCs = pause ? getComputedStyle(pause) : null;
      return {
        exists: true,
        hidden: b.hidden,
        display: cs.display,
        color: cs.color,
        background: cs.backgroundColor,
        pauseColor: pauseCs?.color || null,
        inViewport:
          b.getBoundingClientRect().bottom <= window.innerHeight + 1 &&
          b.getBoundingClientRect().top >= -1,
        fullscreenEnabled: document.fullscreenEnabled,
      };
    });
    console.log("   按钮:", JSON.stringify(fsBtn));
    assert.ok(fsBtn.exists, "控制条里必须有全屏按钮 #btn-match-fullscreen");
    assert.equal(fsBtn.fullscreenEnabled, true, "该环境下应支持全屏（否则本用例无意义）");
    // ⚠ 这条同时守住 CSS 特异性坑：`.fmm-match-bar .btn.icon-btn { display: inline-grid }`
    //   会压掉 UA 的 `[hidden] { display: none }` ⇒ 不加 `!important` 的话
    //   `hidden` 为真但 `display` 仍是 inline-grid，按钮照样显示。
    assert.equal(fsBtn.hidden, false, "支持全屏的浏览器必须露出全屏按钮（不得 hidden）");
    assert.notEqual(fsBtn.display, "none", `全屏按钮不得被 CSS 藏掉，实测 display=${fsBtn.display}`);
    assert.equal(fsBtn.inViewport, true, "全屏按钮必须在视口内（被挤出屏幕等于没有入口）");
    // 可发现性：未全屏时不得和旁边暂停键同色（v276 用主题色把它拎出来）。
    assert.notEqual(
      fsBtn.color,
      fsBtn.pauseColor,
      `全屏键不得与暂停键同色（实测 color=${fsBtn.color} pause=${fsBtn.pauseColor}）`
    );

    await page.click("#btn-match-fullscreen");
    await page.waitForTimeout(700);
    const fsOn = await page.evaluate(() => {
      const el = document.fullscreenElement;
      return {
        fsTag: el ? el.tagName + "." + (el.className || "") : null,
        isMatchLayout: !!el && el.classList.contains("match-layout"),
        pressed: document.querySelector("#btn-match-fullscreen")?.getAttribute("aria-pressed"),
      };
    });
    console.log("   进入全屏:", JSON.stringify(fsOn));
    assert.equal(fsOn.isMatchLayout, true, `全屏元素应是整块比赛界面，实测 ${fsOn.fsTag}`);
    assert.equal(fsOn.pressed, "true", "全屏后按钮 aria-pressed 必须同步为 true");

    const rf = await probe(page);
    console.log("   全屏尺寸:", JSON.stringify(rf));
    await page.screenshot({ path: `${OUT}/mobile-landscape-fullscreen.png` });
    assert.equal(rf.slotVisible, true, "全屏横屏必须显示球场本体 .mp-pitch-slot");
    const ff = rf.fieldRect;
    assert.ok(ff && ff.h > 0, "全屏球场必须有高度");
    assert.ok(ff.x >= -1 && ff.y >= -1, `全屏球场左上角出视口：${JSON.stringify(ff)}`);
    assert.ok(ff.x + ff.w <= rf.viewport.w + 1, `全屏球场右缘出视口：${ff.x + ff.w} > ${rf.viewport.w}`);
    assert.ok(ff.y + ff.h <= rf.viewport.h + 1, `全屏球场下缘出视口：${ff.y + ff.h} > ${rf.viewport.h}`);
    const devFs = Math.abs(ff.ratio - PITCH_RATIO) / PITCH_RATIO;
    assert.ok(devFs <= 0.02, `全屏球场宽高比应保持 ${PITCH_RATIO.toFixed(3)}，实测 ${ff.ratio}`);
    assert.ok(rf.scrollY <= 0, `全屏不得纵向滚动，超出 ${rf.scrollY}px`);
    // 控制条必须仍在视口内 —— 全屏把浏览器 UI 都藏了，
    // 若连控制条也跑出视口，用户就**没有任何退出入口**了。
    assert.ok(
      rf.stack.bar && rf.stack.bar.y + rf.stack.bar.h <= rf.viewport.h + 1,
      `全屏下控制条必须留在视口内：${JSON.stringify(rf.stack.bar)} vs 视口高 ${rf.viewport.h}`
    );
    assert.ok(
      rf.stack.bar.y >= rf.stack.field.y + rf.stack.field.h - 2,
      `全屏下控制条不得压住球场：bar.y=${rf.stack.bar.y} < 球场底边 ${rf.stack.field.y + rf.stack.field.h}`
    );

    // 退出全屏：按钮必须回到「未全屏」状态，且全屏元素清空
    await page.click("#btn-match-fullscreen");
    await page.waitForTimeout(500);
    const fsOff = await page.evaluate(() => ({
      fsEl: document.fullscreenElement ? document.fullscreenElement.tagName : null,
      pressed: document.querySelector("#btn-match-fullscreen")?.getAttribute("aria-pressed"),
    }));
    console.log("   退出全屏:", JSON.stringify(fsOff));
    assert.equal(fsOff.fsEl, null, "再点一次必须退出全屏");
    assert.equal(fsOff.pressed, "false", "退出后 aria-pressed 必须回到 false");

    // 不支持全屏时（iPhone Safari 就是这样）按钮必须**真的**看不见。
    // 用「派发 fullscreenchange 让 syncFullscreenUI 重跑」来触发，
    // 这样不用重跑一遍联赛就能覆盖「能力检测为假」的分支。
    const unsupported = await page.evaluate(() => {
      Object.defineProperty(document, "fullscreenEnabled", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      const b = document.querySelector("#btn-match-fullscreen");
      return { hidden: b.hidden, display: getComputedStyle(b).display };
    });
    console.log("   模拟不支持全屏（iPhone Safari）:", JSON.stringify(unsupported));
    assert.equal(unsupported.hidden, true, "不支持全屏时按钮必须 hidden（iPhone Safari）");
    assert.equal(
      unsupported.display,
      "none",
      `不支持全屏时按钮必须真的不可见，实测 display=${unsupported.display}`
    );

    await context.close();
  });

  // ============ ②b 矮屏横持（贴近真机） ============
  // ⚠ 用户真机反馈「横屏球场还是小」。844×390 只是其中一种；20:9 手机去掉浏览器
  //   chrome（地址栏 ~56 + 系统栏）后 **dvh 常只有 ~295**，这才是常见情形。
  //   本用例直接把这个「等效可用高度」当视口高，量球场高度去向，
  //   并断言**不得纵向滚动**（旧实现实测 body 底边溢出 43px ⇒ 页面可滚 ⇒ 观感散）。
  console.log("\n=== ②b 横持矮屏 800×295（touch，等效真机 dvh） ===");
  await runCase("2b", async () => {
    const { page, context } = await enterMatch(browser, { width: 800, height: 295 }, { touch: true });
    const r = await probe(page);
    console.log("  ", JSON.stringify(r));
    const fill = r.fieldRect && r.viewport.h ? r.fieldRect.h / r.viewport.h : 0;
    console.log(
      `   球场高 ${r.fieldRect?.h} / 视口高 ${r.viewport.h} = ${(fill * 100).toFixed(1)}%`
    );
    console.log("   高度去向（y/h）:", JSON.stringify(r.stack));
    console.log("   非球场高度预算:", JSON.stringify(r.chrome));
    await page.screenshot({ path: `${OUT}/mobile-landscape-short.png` });

    // ── 几何护栏（2026-09-22）────────────────────────────────────────────
    // 为什么钉这几个数：用户报「上面比分模块太大」，实测比分条 61.6px = 视口 20.9%，
    // 三块 chrome 合计 **45.7%**，可见球场只有 160.9px。
    // 改成「中列一行 + 控球条去留白」后：38.1 / 37.7% / 189.0。
    // ⚠ 不加护栏的话，下次有人动横屏布局就会**静默退回** —— 屏幕上没有报错，
    //   只有用户再报一次「球场太小」。
    assert.ok(
      r.chrome.scoreboardH <= 44,
      `横屏比分条应 ≤44px（一行布局），实测 ${r.chrome.scoreboardH}px（旧实现 61.6）`
    );
    assert.ok(
      r.chrome.chromePct <= 40,
      `三块 chrome 合计应 ≤40% 视口，实测 ${r.chrome.chromePct}%（旧实现 45.7%）`
    );
    assert.ok(
      r.chrome.visiblePitch >= 180,
      `可见球场应 ≥180px，实测 ${r.chrome.visiblePitch}px（旧实现 160.9）`
    );

    assert.equal(r.hintVisible, false, "矮屏横持也必须隐藏「请横持手机」提示");
    assert.equal(r.slotVisible, true, "矮屏横持必须显示球场本体 .mp-pitch-slot");
    const f2 = r.fieldRect;
    assert.ok(f2 && f2.h > 0, "矮屏横持球场必须有高度");
    assert.ok(f2.y + f2.h <= r.viewport.h + 1, `矮屏横持球场下缘超出视口：${f2.y + f2.h} > ${r.viewport.h}`);
    const dev2 = Math.abs(f2.ratio - PITCH_RATIO) / PITCH_RATIO;
    assert.ok(dev2 <= 0.02, `矮屏横持球场宽高比应保持 ${PITCH_RATIO.toFixed(3)}，实测 ${f2.ratio}`);
    assert.ok(r.scrollX <= 0, `矮屏横持不得横向滚动，超出 ${r.scrollX}px`);
    assert.ok(r.scrollY <= 0, `矮屏横持不得纵向滚动，超出 ${r.scrollY}px`);
    // 控制条不得压到球场上（旧实现实测 bar.y=323 < field 底边 378 ⇒ 重叠）
    if (r.stack?.bar && f2) {
      assert.ok(
        r.stack.bar.y >= f2.y + f2.h - 2,
        `控制条与球场重叠：bar.y=${r.stack.bar.y} < 球场底边 ${f2.y + f2.h}`
      );
    }
    await context.close();
  });

  // ============ ③ 桌面反例（规则不得误伤桌面） ============
  console.log("\n=== ③ 桌面 1440×1000（无 touch） ===");
  await runCase("3", async () => {
    const { page, context } = await enterMatch(browser, { width: 1440, height: 1000 }, { touch: false });
    const r = await probe(page);
    console.log("  ", JSON.stringify(r));
    await page.screenshot({ path: `${OUT}/mobile-desktop-control.png` });

    assert.equal(r.hintVisible, false, "桌面绝不能出现「请横持手机」提示");
    assert.equal(r.slotVisible, true, "桌面必须显示球场本体 .mp-pitch-slot");
    assert.equal(r.wrapVisible, true, "桌面必须显示 .mp-wrap");
    assert.ok(r.scrollX <= 0, `桌面不得横向滚动，超出 ${r.scrollX}px`);
    // 桌面这条原本只记录不断言。2026-09-20 量到它**也溢出 11px**
    // （`#screen-match` 高 1011 vs 视口 1000），与手机横屏档同源：
    // `.match-layout` 高度公式只减了一次 `0.6rem`，而外壳 padding 上下各占一次。
    // 用 `--fmm-shell-pad` 统一后已归零 ⇒ 改成硬断言，防止再回退。
    assert.ok(r.scrollY <= 0, `桌面不得纵向滚动，超出 ${r.scrollY}px`);
    console.log("   滚动诊断（桌面）:", JSON.stringify(r.scroll));
    console.log("   非球场高度预算（桌面）:", JSON.stringify(r.chrome));
    // 2026-09-22 的横屏瘦身规则全在 `@media (pointer: coarse) and (orientation: landscape)`
    // 里，桌面（pointer: fine）**数学上不可能命中** ⇒ 用数值把这条论证钉住，
    // 而不是靠「我读过媒体查询」。
    assert.ok(
      r.chrome.scoreboardH >= 44,
      `桌面比分条不应被横屏规则压扁，实测 ${r.chrome.scoreboardH}px`
    );
    await context.close();
  });

  console.log("\n✅ 手机端横屏适配（B 方案）目验通过：");
  console.log("   竖持 → 提示「请横持手机」、藏球场；");
  console.log("   横持 → 球场整块等比放入视口，无滚动；");
  console.log("   全屏 → 可进入/退出，球场与控制条都在视口内；");
  console.log("   不支持全屏（iPhone Safari）→ 按钮真的不可见；");
  console.log("   桌面 → 不受影响（pointer: coarse 未误伤）。");
  console.log(
    `   截图：${OUT}/mobile-portrait.png, mobile-landscape.png, mobile-landscape-short.png, mobile-landscape-fullscreen.png, mobile-desktop-control.png`
  );
} finally {
  await browser?.close();
  server.kill();
}
