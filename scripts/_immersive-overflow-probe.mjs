/**
 * 沉浸态是否**真的**越界（2026-09-22 v288 排查）。
 *
 * 现象：验收探针里沉浸态 844×390 读到 `camera y=-23.3 / bottom=413.3`（视口高 390），
 * 且 `scrollY=0`、`docOverflowY=0` ⇒ 不是滚动假象。
 * 但 `_pitch-top-occlusion-probe.mjs` 同视口读到的沉浸态是 `field h=383.2`（放得下）。
 * **两次读数不一致**，必须先搞清哪个是真的，再决定要不要修。
 *
 * 本探针并排比较三种进入沉浸的方式：
 *   A) 点常驻按钮（Playwright `.click()`，会先 scrollIntoView）
 *   B) 直接派发 DOM click（不滚动、不聚焦）
 *   C) 直接调 `window.vcfmMainApi` 暴露的切换（若可用）—— 退化为 B
 * 并打印 innerWidth/innerHeight/visualViewport，因为**移动端模拟下
 * 「shrink-to-fit」会改变 CSS 像素视口**，那是第三种解释。
 *
 * 用法：node scripts/_immersive-overflow-probe.mjs
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 8935;
const baseUrl = `http://127.0.0.1:${port}/`;
const VP = { width: 844, height: 390 };

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
  throw new Error("server down");
}

async function closeModalIfAny(page) {
  const closed = await page
    .evaluate(() => {
      const m = document.querySelector("#modal");
      if (!m) return false;
      const v = getComputedStyle(m);
      if (v.display === "none" || v.visibility === "hidden" || m.classList.contains("hidden")) return false;
      const b =
        m.querySelector("#modal-close, [data-close], .modal-close, .modal-x, button.close") ||
        [...m.querySelectorAll("button")].find((x) => /关闭|确定|继续|知道了|OK|×/i.test(x.textContent || ""));
      (b || m).click();
      return true;
    })
    .catch(() => false);
  if (closed) await page.waitForTimeout(400);
  return closed;
}

const SNAP = () => {
  const r = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return {
      y: +b.y.toFixed(1),
      h: +b.height.toFixed(1),
      w: +b.width.toFixed(1),
      bottom: +b.bottom.toFixed(1),
    };
  };
  const vv = window.visualViewport;
  return {
    inner: { w: window.innerWidth, h: window.innerHeight },
    visual: vv ? { w: +vv.width.toFixed(1), h: +vv.height.toFixed(1), scale: +vv.scale.toFixed(3) } : null,
    dpr: window.devicePixelRatio,
    scroll: { x: window.scrollX, y: window.scrollY },
    doc: {
      scrollH: document.scrollingElement.scrollHeight,
      clientH: document.scrollingElement.clientHeight,
      scrollW: document.scrollingElement.scrollWidth,
      clientW: document.scrollingElement.clientWidth,
    },
    immersive: !!document.querySelector(".match-layout")?.classList.contains("mp-immersive"),
    field: r(".mp-field"),
    camera: r(".mp-camera"),
    slot: r(".mp-pitch-slot"),
    wrap: r(".mp-wrap"),
    body: r(".fmm-match-body"),
    layout: r(".match-layout"),
  };
};

console.log("\n=== 沉浸态越界排查（844×390）===");
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });

  for (const mobile of [true, false]) {
    const context = await browser.newContext({
      viewport: VP,
      hasTouch: mobile,
      isMobile: mobile,
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    let ready = false;
    for (let i = 0; i < 90 && !ready; i += 1) {
      ready = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
      if (!ready) await page.waitForTimeout(1000);
    }
    await page.fill("#input-manager", "Overflow Probe");
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
    await closeModalIfAny(page);
    await page.locator("#btn-play-match").click();
    await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
    await page.locator("#btn-sim-live").click({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await closeModalIfAny(page);
    await closeModalIfAny(page);
    await page.waitForTimeout(800);

    console.log(`\n--- isMobile=${mobile} ---`);
    console.log(`  普通态      ${JSON.stringify(await page.evaluate(SNAP))}`);

    // A) Playwright .click()（会先 scrollIntoView）
    await page.locator("#mp-chrome-toggle").click();
    await page.waitForTimeout(1200);
    const viaClick = await page.evaluate(SNAP);
    console.log(`  A 按钮.click ${JSON.stringify(viaClick)}`);

    // 退出
    await page.evaluate(() => document.querySelector("#mp-chrome-toggle").click());
    await page.waitForTimeout(1000);

    // B) 直接派发 DOM click（不滚动、不聚焦）
    await page.evaluate(() => document.querySelector("#mp-chrome-toggle").click());
    await page.waitForTimeout(1200);
    const viaDom = await page.evaluate(SNAP);
    console.log(`  B DOM.click  ${JSON.stringify(viaDom)}`);

    // 额外：等久一点，看是不是「布局晚一拍」的过渡态
    await page.waitForTimeout(2500);
    const settled = await page.evaluate(SNAP);
    console.log(`  B 等 2.5s 后 ${JSON.stringify(settled)}`);

    await page.screenshot({ path: `.tmp-immersive-overflow/ovf-mobile${mobile}.png` });
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
