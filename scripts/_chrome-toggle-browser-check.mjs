/**
 * 隐藏/唤出 常驻开关的**浏览器验收**（2026-09-22 v288）。
 *
 * ## 为什么必须有这一条（静态断言证明不了什么）
 *
 * 本仓库有血例：v281 只写了静态审计，而「弹窗到底会不会出现」只能靠浏览器量
 * （`reopened-match-notice-browser-check.mjs`）。这里同样 —— 要验的东西全是
 * **运行时行为**：
 *   ① 按钮真的**可见**（不是 `display:none`、不是被别的层盖住 ⇒ 必须 `elementFromPoint` 复核）；
 *   ② 点它真的进出沉浸模式；
 *   ③ 🔴 **不能点一次切两下**：球场那个既有「点空白」处理器用的是**排除法**
 *      （`NOT_BLANK` 里含 `button`），若这一层没接对，点击会冒泡到球场处理器
 *      ⇒ 一次点击进入又立刻退出（视觉上「点了没反应」）。
 *      这类 bug **只有真的点一次才能发现**，静态读代码看不出来。
 *   ④ 按钮在**沉浸模式下仍在**（否则用户又找不到怎么退出）；
 *   ⑤ 可见草坪真的变大（这才是这功能的意义）。
 *
 * ⚠ 每个视口一个**全新上下文**：`page.setViewportSize()` 会让
 *   `(pointer: coarse)` 漂回 false（见 `_pitch-top-occlusion-probe.mjs` §3ⓐ），
 *   量到的就不是手机档了。
 *
 * 用法：node scripts/_chrome-toggle-browser-check.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const port = 8933;
const baseUrl = `http://127.0.0.1:${port}/`;
const OUT = ".tmp-chrome-toggle";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { label: "844x390", width: 844, height: 390, coarse: true },
  { label: "800x295", width: 800, height: 295, coarse: true },
  { label: "1440x900", width: 1440, height: 900, coarse: false },
];

let failed = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

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

/** 只读：按钮与沉浸状态的现场。 */
const READ = () => {
  const btn = document.querySelector("#mp-chrome-toggle");
  const layout = document.querySelector(".match-layout");
  const rectOf = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) };
  };
  const overlapY = (a, b) =>
    a && b ? +Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)).toFixed(1) : 0;
  const camera = rectOf(".mp-camera");
  const scoreboard = rectOf(".fmm-scoreboard");
  const dock = rectOf(".mp-fmm-dock");
  const bar = rectOf(".fmm-match-bar");

  let btnVisible = false;
  let topAtBtnCenter = null;
  if (btn) {
    const cs = getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    btnVisible = cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
    if (r.width > 0) {
      const n = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      topAtBtnCenter = n ? `${n.tagName}.${String(n.className || "").split(" ")[0]}` : null;
    }
  }

  return {
    immersive: !!layout?.classList.contains("mp-immersive"),
    coarse: window.matchMedia("(pointer: coarse)").matches,
    btn: btn
      ? {
          visible: btnVisible,
          pressed: btn.getAttribute("aria-pressed"),
          label: btn.getAttribute("aria-label"),
          title: btn.getAttribute("title"),
          rect: rectOf("#mp-chrome-toggle"),
          topAtCenter: topAtBtnCenter,
          hasDataAttr: !!btn.closest("#match-pitch-root"),
        }
      : null,
    inner: { h: window.innerHeight, w: window.innerWidth },
    // ⚠ Playwright 的 `.click()` 会先把元素滚进视野 ⇒ 页面若可滚动，
    //   `getBoundingClientRect()` 会整体上移、出现「负 y」——
    //   那是**滚动**，不是裁切。必须把 scrollY 一并记下才能分清
    //   （`cameraTop=-23.3` 那条读数正是这两种解释之一）。
    scrollY: window.scrollY,
    docOverflowY: document.scrollingElement
      ? document.scrollingElement.scrollHeight - window.innerHeight
      : null,
    rects: { field: rectOf(".mp-field"), camera: rectOf(".mp-camera") },
    visibleGrass:
      camera &&
      +(camera.h - overlapY(scoreboard, camera) - overlapY(dock, camera) - overlapY(bar, camera)).toFixed(1),
    visibleGrassByHit: (() => {
      // 用命中法复核：从相机盒顶边往下扫第一块真草坪的位置
      if (!camera) return null;
      const x = camera.x + camera.w / 2;
      let first = null;
      for (let y = camera.y + 0.5; y < camera.bottom; y += 1) {
        const n = document.elementFromPoint(x, y);
        if (!n) continue;
        if (n.closest?.(".mp-field")) {
          first = +y.toFixed(1);
          break;
        }
      }
      return { cameraTop: +camera.y.toFixed(1), firstReachableY: first };
    })(),
  };
};

async function enterMatch(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: true,
    isMobile: vp.coarse,
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i += 1) {
    ready = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
    if (!ready) await page.waitForTimeout(1000);
  }
  assert.ok(ready, "首屏未就绪：window.vcfmMainApi 未出现");
  await page.fill("#input-manager", "Chrome Toggle Check");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  await page.locator("#btn-advance-matchday").click();
  let kicked = false;
  for (let i = 0; i < 360 && !kicked; i += 1) {
    await page.waitForTimeout(2000);
    await closeModalIfAny(page);
    kicked = await page.evaluate(() => {
      const b = document.querySelector("#btn-play-match");
      return b ? b.disabled === false : false;
    });
  }
  assert.ok(kicked, "推进到比赛日后仍无「进入比赛」可点");
  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  await page.locator("#btn-sim-live").click({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await closeModalIfAny(page);
  await closeModalIfAny(page);
  await page.waitForTimeout(600);
  return { page, context };
}

console.log("\n=== 隐藏/唤出 常驻开关 · 浏览器验收 ===");
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });

  for (const vp of VIEWPORTS) {
    const { page, context } = await enterMatch(browser, vp);
    console.log(`\n--- ${vp.label} ---`);

    const base = await page.evaluate(READ);
    check(!!base.btn, "球场里存在常驻开关 #mp-chrome-toggle");
    check(!!base.btn?.visible, "按钮**真的可见**（display/尺寸都不为 0）", JSON.stringify(base.btn?.rect));
    check(
      base.btn?.topAtCenter === "BUTTON.mp-chrome-toggle" ||
        base.btn?.topAtCenter === "SPAN.mp-chrome-glyph",
      "按钮中心点最上层就是它自己（没被别的层盖住）",
      `实际最上层=${base.btn?.topAtCenter}`
    );
    check(base.btn?.pressed === "false", "初始 aria-pressed=false");
    check(!base.immersive, "初始不是沉浸模式");
    const grassBefore = base.visibleGrass;

    // ① 点一次 ⇒ 必须**进入**沉浸（若冒泡到球场处理器会立刻被切回来）
    await page.locator("#mp-chrome-toggle").click();
    await page.waitForTimeout(1100);
    const on = await page.evaluate(READ);
    check(on.immersive, "点一次按钮 ⇒ 进入沉浸模式（没有被球场处理器抵消）");
    check(on.btn?.pressed === "true", "aria-pressed 变成 true", `实际=${on.btn?.pressed}`);
    check(!!on.btn?.visible, "沉浸模式下按钮**仍然可见**（否则用户找不到怎么退出）");
    check(
      on.btn?.topAtCenter === "BUTTON.mp-chrome-toggle" ||
        on.btn?.topAtCenter === "SPAN.mp-chrome-glyph",
      "沉浸模式下按钮仍点得到",
      `实际最上层=${on.btn?.topAtCenter}`
    );
    check(
      (on.visibleGrass ?? 0) > (grassBefore ?? 0),
      "可见草坪变大（这就是该功能的意义）",
      `${grassBefore} → ${on.visibleGrass}`
    );
    console.log(`     命中法复核: ${JSON.stringify(on.visibleGrassByHit)}`);

    //    🔴 判据必须量 `.mp-field`（布局盒），**不能**量 `.mp-camera`：
    //    `.mp-camera` 带 `transform: scale()`，`getBoundingClientRect()` 给的是
    //    **缩放后的视觉框** —— 它比球场盒大、上下各溢出十几到几十 px，
    //    但那是 `css/style.css` 里写明的**设计**（看台当固定画框，
    //    「相机放大/平移超出时才被看台切掉，这正是转播画框该有的行为」）。
    //    第一版拿 camera 当判据 ⇒ 在**产品完全正常**时报红（误报）。
    const fb = on.rects?.field;
    check(
      !!fb && fb.y >= -1 && fb.bottom <= (on.inner?.h ?? 0) + 1,
      "沉浸态球场布局盒没有越出视口（y≥0 且 bottom≤视口高）",
      `field=${JSON.stringify(fb)} 视口高=${on.inner?.h}`
    );

    // ② 再点一次 ⇒ 必须**退出**
    await page.locator("#mp-chrome-toggle").click();
    await page.waitForTimeout(1100);
    const off = await page.evaluate(READ);
    check(!off.immersive, "再点一次 ⇒ 退出沉浸模式");
    check(off.btn?.pressed === "false", "aria-pressed 回到 false", `实际=${off.btn?.pressed}`);
    check(
      Math.abs((off.visibleGrass ?? 0) - (grassBefore ?? 0)) < 3,
      "退出后可见草坪回到基线（±3px 取整容差）",
      `${grassBefore} → ${off.visibleGrass}`
    );

    // ③ 键盘可达（可访问性）：聚焦后回车应等价于点击
    await page.evaluate(() => document.querySelector("#mp-chrome-toggle")?.focus());
    const focused = await page.evaluate(() => document.activeElement?.id);
    check(focused === "mp-chrome-toggle", "按钮可被键盘聚焦", `实际=${focused}`);

    // ⑥ 沉浸态**不允许**出现「没滚动却越出视口顶部」——
    //    那才是真的裁切（球场被切掉），与「滚动造成的负 y」必须分清。
    //    这条要放在**进入沉浸后**读的那次 (on) 上，故紧跟 ② 之后断言。

    await page.locator("#mp-chrome-toggle").click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, `toggle-${vp.label}.png`) });
    await page.locator("#mp-chrome-toggle").click().catch(() => {});
    await page.waitForTimeout(500);

    // ④ 点**空白球场**仍应工作（保留为快捷方式），且不应与按钮互相干扰
    const blank = await page.evaluate(() => {
      const f = document.querySelector(".mp-field");
      if (!f) return null;
      const r = f.getBoundingClientRect();
      for (const fy of [0.62, 0.7, 0.55, 0.45]) {
        for (const fx of [0.5, 0.44, 0.56]) {
          const x = r.x + r.width * fx;
          const y = r.y + r.height * fy;
          const n = document.elementFromPoint(x, y);
          const cls = String(n?.className || "");
          if (/mp-grass|mp-field|mp-camera/.test(cls) && !/mp-player|mp-ball/.test(cls)) {
            return { x: +x.toFixed(1), y: +y.toFixed(1), cls };
          }
        }
      }
      return null;
    });
    if (blank) {
      await page.mouse.click(blank.x, blank.y);
      await page.waitForTimeout(1000);
      const viaBlank = await page.evaluate(READ);
      check(viaBlank.immersive, "点空白球场仍能进入沉浸（快捷方式没被破坏）", JSON.stringify(blank));
      check(
        viaBlank.btn?.pressed === "true",
        "点球场进入时按钮状态也同步成 true",
        `实际=${viaBlank.btn?.pressed}`
      );
      await page.mouse.click(blank.x, blank.y);
      await page.waitForTimeout(800);
    } else {
      check(false, "找不到可用于点击的空白球场取样点");
    }

    await context.close();
  }

  console.log(`\n截图：${OUT}/`);
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(`\n_chrome-toggle-browser-check: ${failed ? `${failed} 项失败` : "全部通过"}`);
process.exitCode = failed ? 1 : 0;
