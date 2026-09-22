/**
 * 手机横屏「非球场高度都花在哪 + 比分浮层遮住多少真球场」测量（2026-09-22）。
 *
 * ## 为什么需要它
 *
 * 用户反馈（附手机截图）：「上面的比分固定模块太大了；下面的功能区能不能不用时隐藏？」
 *
 * 现有 `mobile-pitch-adaptation-verify.mjs` 已经量了 `.fmm-scoreboard` /
 * `.fmm-match-bar` / `.mp-field` 的高度（`stack` 分解），**但量不出下面这件事**：
 *
 *   `css/style.css:7252-7257` 的注释声称比分浮层「遮住球场盒顶部约 62px ——
 *   那里是**看台装饰带**（`.mp-stands.top`），不是比赛区域，所以观感损失很小」。
 *
 * 而 `.mp-stands { height: 5.5% }` —— 800×295 下球场盒 206px ⇒ 看台只有 **~11px**。
 * 如果这条注释是错的，那 62px 浮层里 **~51px 压在真实比赛区域上**，
 * 「缩小比分条」就不是装饰取舍，而是**直接换回可见球场**。
 *
 * 所以本探针量的是**遮挡量**（scoreboard ∩ camera），不是各自的高度。
 * 单位口径：布局问题用 `clientWidth/clientHeight`，视觉遮挡用 `rect`（见 skill Step 5）。
 *
 * 用法：node scripts/_mobile-match-chrome-probe.mjs
 * ⚠ 需要 Playwright + msedge；约 6 分钟（两个视口各一次完整开局）。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const port = 8923;
const baseUrl = `http://127.0.0.1:${port}/`;
const OUT = ".tmp-chrome";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { label: "844x390", width: 844, height: 390 },
  { label: "800x295", width: 800, height: 295 },
];

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: process.cwd(),
  stdio: "ignore",
  windowsHide: true,
});
process.on("exit", () => server.kill());

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("static server did not come up");
}

async function closeModalIfAny(page) {
  const closed = await page
    .evaluate(() => {
      const m = document.querySelector("#modal");
      if (!m) return false;
      const vis = getComputedStyle(m);
      if (vis.display === "none" || vis.visibility === "hidden" || m.classList.contains("hidden")) {
        return false;
      }
      const btn =
        m.querySelector("#modal-close, [data-close], .modal-close, .modal-x, button.close") ||
        [...m.querySelectorAll("button")].find((b) =>
          /关闭|确定|继续|知道了|OK|×/i.test(b.textContent || "")
        );
      if (btn) {
        btn.click();
        return true;
      }
      m.click();
      return true;
    })
    .catch(() => false);
  if (closed) await page.waitForTimeout(400);
  return closed;
}

/** 只读：把「非球场高度」和「遮挡量」一次量全。 */
const MEASURE = () => {
  const rectOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return {
      y: +r.y.toFixed(1),
      h: +r.height.toFixed(1),
      w: +r.width.toFixed(1),
      bottom: +r.bottom.toFixed(1),
    };
  };
  const boxOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return { clientH: el.clientHeight, clientW: el.clientWidth, offsetH: el.offsetHeight };
  };
  /** 两个 rect 的纵向重叠量（px）。遮挡量必须算**交集**，不能只看各自高度。 */
  const overlapY = (a, b) => {
    if (!a || !b) return 0;
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.bottom, b.bottom);
    return +Math.max(0, bottom - top).toFixed(1);
  };

  const scoreboard = rectOf(".fmm-scoreboard");
  const bar = rectOf(".fmm-match-bar");
  const dock = rectOf(".mp-fmm-dock");
  const field = rectOf(".mp-field");
  const standsTop = rectOf(".mp-stands.top");
  const standsBot = rectOf(".mp-stands.bot");
  const camera = rectOf(".mp-camera");
  const slot = rectOf(".mp-pitch-slot");

  const vh = window.innerHeight;
  const pc = (v) => (v == null ? null : +((v / vh) * 100).toFixed(1));

  return {
    viewport: { w: window.innerWidth, h: vh },
    rects: { scoreboard, bar, dock, field, standsTop, standsBot, camera, slot },
    boxes: { field: boxOf(".mp-field"), camera: boxOf(".mp-camera") },
    // 非球场高度（布局占用，不含浮层）
    chromePx: {
      scoreboardLayout: 0, // 浮层 ⇒ 不占布局高度，这里显式记 0 以便对照
      bar: bar?.h ?? null,
      dock: dock?.h ?? null,
      total: (bar?.h ?? 0) + (dock?.h ?? 0),
    },
    pct: {
      scoreboardVisual: pc(scoreboard?.h),
      bar: pc(bar?.h),
      dock: pc(dock?.h),
      chromeVisualTotal: pc((scoreboard?.h ?? 0) + (bar?.h ?? 0) + (dock?.h ?? 0)),
      field: pc(field?.h),
      camera: pc(camera?.h),
    },
    // 关键：比分 / 控球浮层遮住**真实比赛区域**多少。
    // ⚠ 必须减**两个**浮层。第一版只减了比分条，于是「控球条改浮层」看起来
    //   有收益 —— 那是假的：它只是从「球场下方」搬到「球场底部压住」。
    //   两个浮层都减之后，基线 160.8 → 改后 188.5（与 `_mobile-match-chrome-lab.mjs` 一致）。
    occlusion: {
      scoreboardOverField: overlapY(scoreboard, field),
      scoreboardOverCamera: overlapY(scoreboard, camera),
      dockOverCamera: overlapY(dock, camera),
      standsTopH: standsTop?.h ?? 0,
      cameraVisibleH: camera
        ? +(camera.h - overlapY(scoreboard, camera) - overlapY(dock, camera)).toFixed(1)
        : null,
    },
    scrollX: document.scrollingElement.scrollWidth - window.innerWidth,
    scrollY: document.scrollingElement.scrollHeight - window.innerHeight,
  };
};

async function enterMatch(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i += 1) {
    ready = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
    if (!ready) await page.waitForTimeout(1000);
  }
  assert.ok(ready, "首屏未就绪：window.vcfmMainApi 未出现");
  await page.fill("#input-manager", "Chrome Probe");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  await page.locator("#btn-advance-matchday").click();
  let kicked = false;
  for (let i = 0; i < 360 && !kicked; i += 1) {
    await page.waitForTimeout(2000);
    await closeModalIfAny(page);
    const st = await page.evaluate(() => {
      const b = document.querySelector("#btn-play-match");
      return { disabled: b ? b.disabled : null };
    });
    kicked = st.disabled === false;
  }
  assert.ok(kicked, "推进到比赛日后仍无「进入比赛」可点");
  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  // 必须进到**直播态**：`.live-kick` 才带横屏那套浮层规则
  await page.locator("#btn-sim-live").click({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  return { page, context };
}

console.log("\n=== 手机横屏：非球场高度 + 比分浮层遮挡量 ===");
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const vp of VIEWPORTS) {
    const { page, context } = await enterMatch(browser, vp);
    const m = await page.evaluate(MEASURE);
    console.log(`\n--- ${vp.label} ---`);
    console.log(`  视口高 ${m.viewport.h}`);
    console.log(`  rect: scoreboard=${JSON.stringify(m.rects.scoreboard)}`);
    console.log(`        bar=${JSON.stringify(m.rects.bar)} dock=${JSON.stringify(m.rects.dock)}`);
    console.log(`        field=${JSON.stringify(m.rects.field)}`);
    console.log(`        standsTop=${JSON.stringify(m.rects.standsTop)} camera=${JSON.stringify(m.rects.camera)}`);
    console.log(`  boxes: field=${JSON.stringify(m.boxes.field)} camera=${JSON.stringify(m.boxes.camera)}`);
    console.log(`  占视口%: scoreboard=${m.pct.scoreboardVisual} bar=${m.pct.bar} dock=${m.pct.dock}`);
    console.log(`          三块合计=${m.pct.chromeVisualTotal} field=${m.pct.field} camera=${m.pct.camera}`);
    console.log(`  🔎 遮挡: scoreboard∩field=${m.occlusion.scoreboardOverField}px`);
    console.log(`           scoreboard∩camera=${m.occlusion.scoreboardOverCamera}px  ← **压在真实比赛区域上的**`);
    console.log(`           看台带高=${m.occlusion.standsTopH}px ⇒ 浮层里只有 ${m.occlusion.scoreboardOverStandsOnly}px 落在非比赛区`);
    console.log(`           camera 可见高=${m.occlusion.cameraVisibleH}px（原 ${m.rects.camera?.h}）`);
    console.log(`  scroll: X=${m.scrollX} Y=${m.scrollY}`);
    await page.screenshot({ path: join(OUT, `chrome-${vp.label}.png`) });
    await context.close();
  }
  console.log(`\n截图：${OUT}/chrome-844x390.png, ${OUT}/chrome-800x295.png`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
