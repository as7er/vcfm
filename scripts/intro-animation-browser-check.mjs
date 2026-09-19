/**
 * 进场动画浏览器实测（Playwright + Chromium）
 *
 * 这个脚本存在的唯一理由：**canvas 层的问题只有浏览器能发现。**
 *
 * 血泪教训（第一版的失败）
 * ------------------------
 * 第一版把入场动画做成了 DOM/CSS：给 `.mp-field` 挂 class、用
 * `transform: translateY(var(--intro-dy))` 推 `.mp-player`。
 * 单元测试 17/17 全绿、缓存审计全过、`node --check` 通过 ——
 * **但浏览器里画面上什么都没发生。**
 *
 * 真因：本项目球员不是 DOM 画的。`_initCanvas()` 无条件加
 * `mp-canvas-mode`，该模式下 `.mp-actors .mp-player` 及子元素被
 * `opacity: 0 !important` + `visibility: hidden !important` 全隐藏，
 * DOM 球员只是**点击热区**。而且优先级（0,3,1 > 0,2,1）还把
 * `opacity: 0.35` 压回了 1。
 *
 * 所以本脚本**不**断言 DOM 的 transform —— 那正是第一版被骗的地方。
 * 它改为在 canvas 的 2D context 上插桩，抓取 `arc()` 的调用坐标
 * （球员圆点就是 arc 画的），从**真实绘制坐标**判断是否发生了位移。
 *
 * 运行：node scripts/intro-animation-browser-check.mjs
 */

import { spawn } from "node:child_process";

import { chromium } from "playwright";

const port = 8879;
const baseUrl = `http://127.0.0.1:${port}/`;
const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: repoRoot,
  stdio: "ignore",
  windowsHide: true,
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("本地测试服务器未启动");
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * 页面内初始化：造最小 MatchView（22 名球员），并给 canvas 2D context
 * 打桩以记录每帧 arc 的坐标。
 */
const SETUP = `
(async () => {
  const mod = await import("./js/matchview.js");
  const root = document.createElement("div");
  root.id = "__intro-test-root";
  document.body.appendChild(root);
  const view = new mod.MatchView(root);

  const mkClub = (id, name, color) => {
    const players = [];
    for (let i = 0; i < 11; i++) {
      players.push({
        id: id + "-p" + i,
        name: name + " 球员" + i,
        number: i + 1,
        pos: i === 0 ? "GK" : i < 5 ? "DEF" : i < 9 ? "MID" : "FWD",
        nationality: "CN",
        ovr: 70,
      });
    }
    return {
      id, name, color, players,
      tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) },
    };
  };

  view.mount(mkClub("h", "主队", "#3d8bfd"), mkClub("a", "客队", "#f87171"), {});
  window.__view = view;

  // ── canvas 插桩：记录 arc 调用（球员圆点靠 arc 绘制）──────────────
  // 直接包裹 context 实例上的 arc。_drawCanvas 每帧调用它。
  // ⚠ 本段位于模板字符串内，注释里绝不能出现反引号或美元花括号。
  const ctx = view._cx;
  if (!ctx) return { error: "canvas ctx 未就绪", count: 0 };
  const origArc = ctx.arc.bind(ctx);
  window.__arcs = [];
  let recording = false;
  ctx.arc = function (x, y, r, a0, a1, ccw) {
    if (recording) window.__arcs.push({ x, y, r });
    return origArc(x, y, r, a0, a1, ccw);
  };
  window.__recordStart = () => { recording = true; window.__arcs = []; };
  window.__recordStop = () => { recording = false; return window.__arcs.slice(); };

  // 强制一次重绘，确认插桩生效
  view._drawCanvas?.();
  return {
    count: view.players.length,
    cw: view._cw,
    ch: view._ch,
    hasArc: typeof ctx.arc === "function",
  };
})()
`;


async function main() {
  await waitForServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // 禁用 service worker 与自动 reload：`index.html` 里 sw 首次接管会
  // `location.reload()`，把页面导航掉 ⇒ `page.evaluate` 上下文销毁。
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "serviceWorker", {
        value: {
          register: () => Promise.resolve({}),
          addEventListener: () => {},
          controller: null,
          ready: new Promise(() => {}),
        },
        configurable: true,
      });
    } catch {}
    try {
      window.location.reload = () => {};
    } catch {}
  });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const setup = await page.evaluate(SETUP);
  record("构造 MatchView 与 22 名球员", setup.count === 22, `${setup.count} 名`);
  record("canvas 已就绪", !!setup.cw && !!setup.ch, `${setup.cw}×${setup.ch}`);
  if (setup.error || setup.count !== 22) {
    await browser.close();
    server.kill();
    console.log(`\n❌ 前置失败：${setup.error || "球员数不对"}`);
    process.exit(1);
  }

  /**
   * 核心测量：**真实时间流逝**下，抓球员圆点的绘制 y 与「无动画基线」对比。
   *
   * ⚠️ 刻意不用「手动改 `_introStartAt` 拨时钟」那种做法 —— 那等于在测试
   * 自己的桩。第一版的失败正是被「单测全绿」骗了，所以这里坚持走真实
   * 时间轴：真 `await`、真 rAF 驱动、只读真实绘制坐标。
   *
   * 为了让读数确定，采样在一个 rAF 边界上同步抓取（`_drawCanvas` 是
   * 纯函数式重绘，同一帧内多次调用结果一致）。
   */
  const measure = await page.evaluate(async () => {
    const view = window.__view;
    const minDim = Math.min(view._cw, view._ch);
    const rPlayer = Math.min(12, Math.max(7, minDim * 0.026));
    const isPlayerArc = (a) => Math.abs(a.r - rPlayer) < 0.6;

    const captureYs = () => {
      window.__recordStart();
      view._drawCanvas();
      return window.__recordStop().filter(isPlayerArc).map((a) => a.y);
    };

    // 基线：此刻没有动画。
    const baseline = captureYs();

    // 开始动画（长时长 ⇒ 不会在采样期间自然结束）。
    view.playPlayerIntro(20000);
    const t0 = performance.now();
    const samples = [];
    const at = async (targetMs) => {
      const wait = targetMs - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const ys = captureYs();
      let maxAbs = 0;
      for (let i = 0; i < Math.min(ys.length, baseline.length); i++) {
        maxAbs = Math.max(maxAbs, Math.abs(ys[i] - baseline[i]));
      }
      samples.push({ ms: performance.now() - t0, offset: maxAbs });
    };

    await at(60);
    await at(300);
    await at(750);
    // 结束，别留 20 秒计时器。
    view.skipPlayerIntro();
    await new Promise((r) => setTimeout(r, 350));
    const afterYs = captureYs();
    let afterMax = 0;
    for (let i = 0; i < Math.min(afterYs.length, baseline.length); i++) {
      afterMax = Math.max(afterMax, Math.abs(afterYs[i] - baseline[i]));
    }

    return {
      baselineCount: baseline.length,
      samples,
      afterOffset: afterMax,
      ch: view._ch,
    };
  });

  record("基线画出 22 个球员圆点", measure.baselineCount === 22, `${measure.baselineCount} 个`);
  const expected = measure.ch * 0.06;
  const early = measure.samples[0]?.offset ?? 0;
  const mid = measure.samples[1]?.offset ?? 0;
  const late = measure.samples[2]?.offset ?? 0;

  record(
    "起步时球员被画在场外（偏移≈球场高 6%）",
    early > expected * 0.6,
    `60ms 偏移 ${early.toFixed(1)}px，期望≈${expected.toFixed(1)}px`,
  );
  record(
    "位移随时间收敛（真的在跑，不是静止）",
    mid < early && mid > 0,
    `60ms=${early.toFixed(1)}px → 300ms=${mid.toFixed(1)}px`,
  );
  record(
    "750ms 时已基本到位",
    late < early * 0.4,
    `750ms 偏移 ${late.toFixed(1)}px（起步的 ${((late / (early || 1)) * 100).toFixed(0)}%）`,
  );
  record(
    "结束后偏移归零",
    measure.afterOffset < 2,
    `结束后偏移 ${measure.afterOffset.toFixed(2)}px`,
  );

  // ── 跳过：真实点击球场，偏移应在 ~0.16s 内收拢（不硬切）──────────
  const skipMeasure = await page.evaluate(async () => {
    const view = window.__view;
    const minDim = Math.min(view._cw, view._ch);
    const rPlayer = Math.min(12, Math.max(7, minDim * 0.026));
    const isPlayerArc = (a) => Math.abs(a.r - rPlayer) < 0.6;
    const captureYs = () => {
      window.__recordStart();
      view._drawCanvas();
      return window.__recordStop().filter(isPlayerArc).map((a) => a.y);
    };
    const baseline = captureYs();

    view.playPlayerIntro(20000);
    await new Promise((r) => setTimeout(r, 200));
    const during = captureYs();
    // 真实跳过：向球场派发 pointerdown（走的就是用户点击的路径）。
    const field = view.fieldEl;
    field.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const fastRightAfter = view._introFast ? { ...view._introFast } : null;
    // 收拢应在 ~0.16s 内完成（再看是否已复位）
    await new Promise((r) => setTimeout(r, 400));
    const after = captureYs();
    const maxAbs = (a, b) => {
      let m = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
      return m;
    };
    return {
      duringOffset: maxAbs(during, baseline),
      afterOffset: maxAbs(after, baseline),
      fastDur: fastRightAfter?.dur ?? null,
      fastRatio: fastRightAfter?.ratio ?? null,
      startAt: view._introStartAt,
    };
  });
  record(
    "点击时正处在位移中（有可见偏移）",
    skipMeasure.duringOffset > measure.ch * 0.06 * 0.2,
    `偏移 ${skipMeasure.duringOffset.toFixed(1)}px`,
  );
  record("点击建立快速收拢（非硬切）", skipMeasure.fastDur != null, `dur=${skipMeasure.fastDur}ms`);
  record(
    "快速收拢时长 0.16s",
    Math.abs((skipMeasure.fastDur ?? 0) - 160) < 1,
    `${skipMeasure.fastDur}ms`,
  );
  record(
    "收拢起始比例未归零（确实在收拢而非瞬移）",
    (skipMeasure.fastRatio ?? 0) > 0.05,
    `ratio=${skipMeasure.fastRatio?.toFixed(3)}`,
  );
  record(
    "跳过 0.4s 后偏移归零",
    skipMeasure.afterOffset < 2,
    `${skipMeasure.afterOffset.toFixed(2)}px`,
  );
  record("跳过后动画态复位", skipMeasure.startAt === null);

  // ── 跳过后彻底复位 ───────────────────────────────────────────────
  const afterSkip = await page.evaluate(async () => {
    const view = window.__view;
    view.playPlayerIntro(20000);
    await new Promise((r) => setTimeout(r, 100));
    view.skipPlayerIntro();
    await new Promise((r) => setTimeout(r, 400));
    return {
      startAt: view._introStartAt,
      plan: view._introPlan,
      playing: view._introPlaying,
      cleanup: view._introCleanup,
    };
  });
  record("跳过后 _introStartAt 归 null", afterSkip.startAt === null, `${afterSkip.startAt}`);
  record("跳过后 _introPlan 归 null", afterSkip.plan === null);
  record("跳过后 _introPlaying 归 false", afterSkip.playing === false);
  record("跳过后事件监听已撤销", afterSkip.cleanup === null);

  // ── 播放完整时长后自动复位 ───────────────────────────────────────
  const natural = await page.evaluate(async () => {
    const view = window.__view;
    const t0 = performance.now();
    await view.playPlayerIntro(700);
    return {
      elapsed: performance.now() - t0,
      startAt: view._introStartAt,
      playing: view._introPlaying,
    };
  });
  record(
    "700ms 播放时长≈700ms(+收尾)",
    natural.elapsed > 600 && natural.elapsed < 1000,
    `${natural.elapsed.toFixed(0)}ms`,
  );
  record("正常跑完后自动复位", natural.startAt === null && natural.playing === false);

  // ── 重入守卫 ─────────────────────────────────────────────────────
  const reentry = await page.evaluate(async () => {
    const view = window.__view;
    const p1 = view.playPlayerIntro(800);
    const p2 = view.playPlayerIntro(800);
    const t0 = performance.now();
    await Promise.all([p1, p2]);
    return { elapsed: performance.now() - t0 };
  });
  record("重入被守卫短路（时长不翻倍）", reentry.elapsed < 1400, `${reentry.elapsed.toFixed(0)}ms`);

  // ── ms=0 / reduced-motion 旁路 ───────────────────────────────────
  const zero = await page.evaluate(async () => {
    const view = window.__view;
    const t0 = performance.now();
    await view.playPlayerIntro(0);
    return { elapsed: performance.now() - t0, startAt: view._introStartAt };
  });
  record("ms=0 立即返回且不进入动画态", zero.elapsed < 60 && zero.startAt === null, `${zero.elapsed.toFixed(0)}ms`);

  const reduced = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  await reduced.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "serviceWorker", {
        value: {
          register: () => Promise.resolve({}),
          addEventListener: () => {},
          controller: null,
          ready: new Promise(() => {}),
        },
        configurable: true,
      });
    } catch {}
    try {
      window.location.reload = () => {};
    } catch {}
  });
  const rp = await reduced.newPage();
  await rp.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await rp.evaluate(SETUP);
  const rm = await rp.evaluate(async () => {
    const view = window.__view;
    const t0 = performance.now();
    await view.playPlayerIntro(2000);
    return { elapsed: performance.now() - t0, startAt: view._introStartAt };
  });
  record("reduced-motion 立即返回", rm.elapsed < 300, `${rm.elapsed.toFixed(0)}ms`);
  record("reduced-motion 不进入动画态", rm.startAt === null);

  // 注：曾想在此加「罚下球员不让错峰序号错位」的断言，但**该场景不会
  // 发生** —— 入场动画只在比赛开始时播一次，那时不可能有人被罚下。
  // 为一个不会发生的场景硬造测试，只会测到自己的桩。相关防御保留在
  // `_introOffsetY` 里（按 `pl` 对象查错峰表，不用绘制下标），并在
  // 那里注释了原因。这里不设断言。

  record("无 JS 运行时错误", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  server.kill();

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n📊 Results: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`,
  );
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("❌ 实测异常：", e);
  server.kill();
  process.exit(1);
});
