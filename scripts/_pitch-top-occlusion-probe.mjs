/**
 * 「球场上方区域显示不全」根因测量（2026-09-22，v288 候选）。
 *
 * ## 用户报的现象
 *
 * 手机横屏直播（附截图，视口约 844×390）：球场盒的**顶部**看不见——
 * 顶边线、近侧（上方）那条边线区域被压在比分条下面；而**底部**的看台装饰带
 * 却完整可见（截图里那条灰色条纹带）。也就是「上方显示不全、下方正常」。
 *
 * ## 两个候选根因（必须先分清，改法完全不同）
 *
 * A) **被覆盖**：`.fmm-scoreboard` 在横屏是**浮层**（`position: absolute; z-index: 30`，
 *    见 `css/style.css:7303-7319`），叠在球场盒顶部之上 ⇒ 球场没被裁，只是被盖住。
 * B) **被裁掉**：球场盒比 `.mp-pitch-slot` / `.mp-wrap` 还高，且父级 `overflow: hidden`
 *    ⇒ 顶部被切掉，无论怎么隐藏 chrome 都救不回来。
 *
 * 现有 `_mobile-match-chrome-probe.mjs` 只量了**比分条∩相机**这一个交集的**高度**，
 * 没有量「从球场盒顶边往下，连续被盖住多少像素」，也没量 A/B 的区分。
 * 本探针补这两点，并**沿球场盒中轴逐像素扫 `elementFromPoint`**——
 * 这是唯一能同时区分「被盖住」与「被裁掉」的判据：
 *   · 被盖住：扫到的元素是 `.fmm-scoreboard`（在球场盒**内部**的 y 上）
 *   · 被裁掉：球场盒的 y 起点 < 父级可裁剪底边，扫到的元素越出球场盒
 *
 * ⚠ 取点必须 `elementFromPoint` 复核（AGENTS.md v284 的坑：DOM 里「存在」
 *   的元素 ≠ 「点得到」的元素；几秒前算好的空白点会被走过来的球员占掉）。
 *
 * 用法：node scripts/_pitch-top-occlusion-probe.mjs
 * 截图：.tmp-pitchtop/
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const port = 8931;
const baseUrl = `http://127.0.0.1:${port}/`;
const OUT = ".tmp-pitchtop";
mkdirSync(OUT, { recursive: true });

/** 横屏手机三档 + 竖持 + 桌面，覆盖四种布局规则。 */
const VIEWPORTS = [
  { label: "844x390", width: 844, height: 390, coarse: true },
  { label: "932x430", width: 932, height: 430, coarse: true },
  { label: "800x295", width: 800, height: 295, coarse: true },
  { label: "390x844", width: 390, height: 844, coarse: true },
  { label: "1440x900", width: 1440, height: 900, coarse: false },
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

/**
 * 只读测量。核心是两支「从某条边往里逐像素扫」的函数：
 *   scanFromTop / scanFromBottom —— 返回「连续被非球场元素覆盖」的像素数。
 * 这是唯一能区分「被别的元素盖住」与「被父级裁掉」的判据。
 */
const MEASURE = () => {
  const el = (sel) => document.querySelector(sel);
  const rectOf = (sel) => {
    const e = el(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return {
      x: +r.x.toFixed(1),
      y: +r.y.toFixed(1),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      bottom: +r.bottom.toFixed(1),
    };
  };
  const overlapY = (a, b) => {
    if (!a || !b) return 0;
    return +Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)).toFixed(1);
  };

  /** 这个元素算不算「球场自己的」——球场盒内部的一切（草坪/线/看台/球员层/热区）。 */
  const isPitchOwned = (n) => {
    if (!n || n.nodeType !== 1) return false;
    return !!n.closest(".mp-field");
  };

  /**
   * 从 `top` 往下扫，问「球场盒顶部有多少像素被**别的东西**盖住」。
   * `x` 取球场盒横向中线。返回 `{ coveredPx, by }`。
   * ⚠ 只在球场盒自身的 y 区间内扫，越出就当没盖（那是别的区域的问题）。
   */
  const scanFromTop = (box, x) => {
    if (!box) return { coveredPx: 0, by: null };
    let covered = 0;
    let by = null;
    const end = Math.min(box.bottom, box.y + box.h) - 0.5;
    for (let y = box.y + 0.5; y <= end; y += 1) {
      const n = document.elementFromPoint(x, y);
      if (isPitchOwned(n)) break;
      covered += 1;
      if (!by && n) by = String(n.className || n.tagName);
    }
    return { coveredPx: covered, by };
  };
  /** 从底边往上扫，对称判据。 */
  const scanFromBottom = (box, x) => {
    if (!box) return { coveredPx: 0, by: null };
    let covered = 0;
    let by = null;
    for (let y = box.bottom - 0.5; y >= box.y + 0.5; y -= 1) {
      const n = document.elementFromPoint(x, y);
      if (isPitchOwned(n)) break;
      covered += 1;
      if (!by && n) by = String(n.className || n.tagName);
    }
    return { coveredPx: covered, by };
  };

  const layout = el(".match-layout");
  const field = rectOf(".mp-field");
  const camera = rectOf(".mp-camera");
  const slot = rectOf(".mp-pitch-slot");
  const wrap = rectOf(".mp-wrap");
  const scoreboard = rectOf(".fmm-scoreboard");
  const bar = rectOf(".fmm-match-bar");
  const dock = rectOf(".mp-fmm-dock");
  const standsTop = rectOf(".mp-stands.top");
  const standsBot = rectOf(".mp-stands.bot");

  const cx = field ? +(field.x + field.w / 2).toFixed(1) : 0;

  // 「球场盒是否比它的可裁剪祖先还高」= 候选根因 B。
  const slotStyle = slot ? el(".mp-pitch-slot") : null;
  const clipParent = wrap || slot;

  /**
   * ★ 候选落点命中地图：在球场盒**四角**各取一个内缩点，问最上层是谁。
   * 用来挑「常驻切换胶囊」该放哪 —— 必须同时满足
   * ① 点得到（最上层不是比分条/球员热区）② 不压真草坪（落在看台带里）。
   */
  const probeCorners = () => {
    if (!field) return null;
    const insetX = Math.min(30, field.w * 0.09);
    const insetY = Math.min(18, field.h * 0.06);
    const pts = {
      左上: [field.x + insetX, field.y + insetY],
      右上: [field.x + field.w - insetX, field.y + insetY],
      左下: [field.x + insetX, field.bottom - insetY],
      右下: [field.x + field.w - insetX, field.bottom - insetY],
    };
    const out = {};
    for (const [k, [x, y]] of Object.entries(pts)) {
      const n = document.elementFromPoint(x, y);
      out[k] = {
        x: +x.toFixed(1),
        y: +y.toFixed(1),
        cls: n ? `${n.tagName}.${String(n.className || "").split(" ")[0]}` : null,
        overGrass: camera ? y > camera.y && y < camera.bottom : null,
        overStandsTop: standsTop ? y < standsTop.bottom : null,
      };
    }
    return out;
  };


  /**
   * ★ 命中判定：某元素**中心点**上真正在最上面的是谁。
   * 这是「它还看不看得见」的判据 —— 单看 rect 交集会漏掉
   * 「被更高的 z-index 完全盖住」（A 组就栽在这里，见 docs/measurements/...）。
   */
  const hitAt = (r) => {
    if (!r) return null;
    const n = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
    if (!n) return null;
    return { tag: n.tagName, cls: String(n.className || "").slice(0, 48) };
  };
  const hits = {
    dock: hitAt(dock),
    standsBot: hitAt(standsBot),
    standsTop: hitAt(standsTop),
    bar: hitAt(bar),
  };


  // ── 控制条**容量**：还能不能再塞一个图标键（决定「隐藏/唤出」按钮放哪）──
  const barEl = el(".fmm-match-bar");
  const barSpace = barEl
    ? {
        clientW: barEl.clientWidth,
        scrollW: barEl.scrollWidth,
        overflowPx: barEl.scrollWidth - barEl.clientWidth,
        groups: Object.fromEntries(
          [
            ".match-transport",
            ".match-playback-bar",
            ".match-speed-bar",
            ".match-camera-bar",
            "#match-main-actions",
          ].map((s) => [s, rectOf(s)?.w ?? null])
        ),
        playBtnCount: document.querySelectorAll(".match-playback-bar .icon-btn").length,
      }
    : null;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    layoutClass: layout ? String(layout.className) : null,
    mediaQuery: {
      coarse: window.matchMedia("(pointer: coarse)").matches,
      landscape: window.matchMedia("(orientation: landscape)").matches,
    },
    rects: { field, camera, slot, wrap, scoreboard, bar, dock, standsTop, standsBot },
    styles: {
      slotDisplay: slotStyle ? getComputedStyle(slotStyle).display : null,
      slotContainerType: slotStyle ? getComputedStyle(slotStyle).containerType : null,
      fieldAspect: field ? getComputedStyle(el(".mp-field")).aspectRatio : null,
      wrapOverflow: clipParent ? getComputedStyle(el(".mp-wrap") || el(".mp-pitch-slot")).overflow : null,
    },
    // ★ 关键判据：球场盒顶/底各有多少像素被**别的元素**盖住（沿中线逐像素扫）
    cover: {
      top: scanFromTop(field, cx),
      bottom: scanFromBottom(field, cx),
      cameraTop: camera ? scanFromTop(camera, cx) : null,
      cameraBottom: camera ? scanFromBottom(camera, cx) : null,
    },
    overlap: {
      scoreboardOverField: overlapY(scoreboard, field),
      scoreboardOverCamera: overlapY(scoreboard, camera),
      scoreboardOverStandsTop: overlapY(scoreboard, standsTop),
      dockOverCamera: overlapY(dock, camera),
      barOverCamera: overlapY(bar, camera),
      // 底栏顶边 vs 球场盒底边：>0 表示球场盒伸到控制条下面（被压住）
      fieldOverBar: bar && field ? +(field.bottom - bar.y).toFixed(1) : null,
      fieldOverDock: dock && field ? +(field.bottom - dock.y).toFixed(1) : null,
      cameraOverBar: bar && camera ? +(camera.bottom - bar.y).toFixed(1) : null,
    },
    sums: field
      ? {
          // 可见草坪 = 相机高 − 被比分条盖住的 − 被底栏盖住的
          cameraVisible:
            camera &&
            +(
              camera.h -
              overlapY(scoreboard, camera) -
              overlapY(dock, camera) -
              overlapY(bar, camera)
            ).toFixed(1),
          // 球场盒是否顶到/越过可裁剪祖先的上边界（越出 = 被裁）
          fieldTopVsWrapTop: wrap ? +(field.y - wrap.y).toFixed(1) : null,
          fieldBottomVsWrapBottom: wrap ? +(wrap.bottom - field.bottom).toFixed(1) : null,
          fieldOverflowsWrap: wrap ? +(field.h - wrap.h).toFixed(1) : null,
          slotH: slot?.h ?? null,
          fieldH: field.h,
        }
      : null,
    corners: probeCorners(),
    // ★ 关键反证：+18px 会不会是「把底部挤出视口」换来的？
    //   底部越出量必须一并量 —— 否则很容易把「问题从顶部搬到下部」读成收益。
    bottomOverflow: (() => {
      const inside = (r) => (r ? Math.max(0, +(r.bottom - window.innerHeight).toFixed(1)) : 0);
      return {
        viewportH: window.innerHeight,
        wrap: inside(wrap),
        bar: inside(bar),
        dock: inside(dock),
        field: inside(field),
        slot: inside(slot),
      };
    })(),
    barSpace,
    hits,
    scroll: {
      x: document.scrollingElement.scrollWidth - window.innerWidth,
      y: document.scrollingElement.scrollHeight - window.innerHeight,
    },
  };
};

/** 点一块**真空地**——必须先 `elementFromPoint` 复核（见文件头注释）。 */
async function tapEmptyPitch(page) {
  const pt = await page.evaluate(() => {
    const field = document.querySelector(".mp-field");
    if (!field) return null;
    const r = field.getBoundingClientRect();
    const cands = [];
    for (const fx of [0.5, 0.42, 0.58, 0.34, 0.66]) {
      for (const fy of [0.5, 0.6, 0.4, 0.68, 0.32]) {
        cands.push([r.x + r.width * fx, r.y + r.height * fy]);
      }
    }
    for (const [x, y] of cands) {
      const n = document.elementFromPoint(x, y);
      if (!n) continue;
      const cls = String(n.className || "");
      if (/mp-player|mp-ball/.test(cls)) continue; // 球员/球热区 → 会开卡片
      if (!/mp-grass|mp-lines|mp-field|mp-camera|mp-actors/.test(cls)) continue;
      return { x: +x.toFixed(1), y: +y.toFixed(1), cls };
    }
    return null;
  });
  if (!pt) return null;
  await page.mouse.click(pt.x, pt.y);
  return pt;
}

/**
 * 对照实验：只隐藏**底部**（控球条 + 控制条），**保留**比分条。
 * 用来回答「用户的诉求（隐藏底部功能区）到底能拿回多少 px」——
 * 沉浸模式（v284）连比分条一起隐藏，两者收益不是同一批像素。
 */
// 对照 A′：比分条进布局流 **并且**把它的高度从 body 公式里扣掉。
//   ⚠ 必须单独做这一支：对照 A 只改 position、**没扣高度** ⇒ 内容比容器高 38px
//   ⇒ 球场盒把**控球条**顶到控制条下面（实测 fieldOverBar=+18.2、控球条中心点
//   最上层从 `.mp-fmm-poss-bar` 变成无名 DIV）⇒ A 的 +18px 是**拿控球条换的**。
//   A′ 才是「让位」这条路的真实数字。
async function measureInflowProper(page) {
  await page.evaluate(() => {
    const s = document.createElement("style");
    s.id = "probe-inflow-proper";
    s.textContent = [
      ".match-layout.fm-match.fmm-match.live-kick .fmm-scoreboard,",
      ".match-layout.fm-match.fmm-match.ht-kick .fmm-scoreboard,",
      ".match-layout.fm-match.fmm-match.pre-kickoff .fmm-scoreboard {",
      "  position: static !important; background: none !important;",
      "  backdrop-filter: none !important; border-radius: 0 !important; }",
      ".match-layout.fm-match.fmm-match.live-kick .fmm-match-body,",
      ".match-layout.fm-match.fmm-match.ht-kick .fmm-match-body,",
      ".match-layout.fm-match.fmm-match.pre-kickoff .fmm-match-body {",
      "  height: calc(100dvh - 58px - 38px - 2 * var(--fmm-shell-pad)) !important; }",
    ].join("\n");
    document.head.appendChild(s);
  });
  await page.waitForTimeout(900);
  const m = await page.evaluate(MEASURE);
  await page.evaluate(() => document.getElementById("probe-inflow-proper")?.remove());
  await page.waitForTimeout(700);
  return m;
}

// 对照 D：把**上看台带**加高到正好盖住整个比分浮层（相机 top inset 5.5% → 12%），
//   让浮层压的全是看台、而**不是草坪**。
//   球场盒比例必须同步改成 105/68 ÷ (1 − 0.12 − 0.055) = 1.8717（四处几何同时改）。
async function measureTallTopStand(page) {
  await page.evaluate(() => {
    const s = document.createElement("style");
    s.id = "probe-tall-stand";
    const L = ".match-layout.fm-match.fmm-match.live-kick";
    const H = ".match-layout.fm-match.fmm-match.ht-kick";
    const P = ".match-layout.fm-match.fmm-match.pre-kickoff";
    s.textContent = [
      `${L} .mp-field, ${H} .mp-field, ${P} .mp-field {`,
      "  aspect-ratio: 187.17 / 100 !important;",
      "  width: min(100cqw, calc(100cqh * 187.17 / 100)) !important;",
      "  height: min(100cqh, calc(100cqw * 100 / 187.17)) !important; }",
      `${L} .mp-camera, ${H} .mp-camera, ${P} .mp-camera { top: 12% !important; }`,
      `${L} .mp-stands.top, ${H} .mp-stands.top, ${P} .mp-stands.top { height: 12% !important; }`,
    ].join("\n");
    document.head.appendChild(s);
  });
  await page.waitForTimeout(900);
  const m = await page.evaluate(MEASURE);
  await page.evaluate(() => document.getElementById("probe-tall-stand")?.remove());
  await page.waitForTimeout(700);
  return m;
}

async function measureBottomOnly(page) {
  await page.evaluate(() => {
    const s = document.createElement("style");
    s.id = "probe-bottom-only";
    s.textContent = `
      .mp-fmm-dock, .fmm-match-bar { display: none !important; }
      .match-layout.fm-match.fmm-match.live-kick .fmm-match-body,
      .match-layout.fm-match.fmm-match.ht-kick .fmm-match-body,
      .match-layout.fm-match.fmm-match.pre-kickoff .fmm-match-body {
        height: calc(100dvh - 2 * var(--fmm-shell-pad)) !important;
      }`;
    document.head.appendChild(s);
  });
  await page.waitForTimeout(900);
  const m = await page.evaluate(MEASURE);
  await page.evaluate(() => document.getElementById("probe-bottom-only")?.remove());
  await page.waitForTimeout(700);
  return m;
}

/** 对照实验：只隐藏**比分条**（保留底部全部）。 */

async function measureTopOnly(page) {
  await page.evaluate(() => {
    const s = document.createElement("style");
    s.id = "probe-top-only";
    s.textContent = `.fmm-scoreboard { display: none !important; }`;
    document.head.appendChild(s);
  });
  await page.waitForTimeout(800);
  const m = await page.evaluate(MEASURE);
  await page.evaluate(() => document.getElementById("probe-top-only")?.remove());
  await page.waitForTimeout(700);
  return m;
}

function fmt(m) {
  const r = m.rects;
  const f = (o) => (o ? `y=${o.y} h=${o.h} w=${o.w}` : "null");
  return [
    `  视口 ${m.viewport.w}×${m.viewport.h} · pointer:coarse=${m.mediaQuery.coarse} · ${m.layoutClass}`,
    `  field    ${f(r.field)}`,
    `  camera   ${f(r.camera)}`,
    `  slot     ${f(r.slot)}   wrap ${f(r.wrap)}`,
    `  scoreboard ${f(r.scoreboard)}  bar ${f(r.bar)}  dock ${f(r.dock)}`,
    `  stands   top=${r.standsTop?.h ?? "-"} bot=${r.standsBot?.h ?? "-"}`,
    `  ★ 覆盖（沿中线逐像素扫）: 球场盒顶 ${m.cover.top.coveredPx}px 被「${m.cover.top.by}」盖住`,
    `                            球场盒底 ${m.cover.bottom.coveredPx}px 被「${m.cover.bottom.by}」盖住`,
    `                            相机顶   ${m.cover.cameraTop?.coveredPx}px ·  相机底 ${m.cover.cameraBottom?.coveredPx}px`,
    `  交集: scoreboard∩field=${m.overlap.scoreboardOverField} scoreboard∩camera=${m.overlap.scoreboardOverCamera}`,
    `        scoreboard∩standsTop=${m.overlap.scoreboardOverStandsTop} dock∩camera=${m.overlap.dockOverCamera}`,
    `  汇总: 可见草坪=${m.sums?.cameraVisible}px（相机 ${r.camera?.h}）`,
    `        fieldTop−wrapTop=${m.sums?.fieldTopVsWrapTop}（>0 = 球场顶没顶到容器顶）`,
    `        球场盒比 wrap 高 ${m.sums?.fieldOverflowsWrap}px（>0 = 被裁）`,
    `  scroll X=${m.scroll.x} Y=${m.scroll.y}`,
  ].join("\n");
}

async function enterMatch(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
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
  await page.fill("#input-manager", "Pitch Top Probe");
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
  await page.locator("#btn-sim-live").click({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  return { page, context };
}

console.log("\n=== 球场顶部遮挡/裁切根因测量 ===");
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  // ⚠ 每个视口一个**全新上下文**：`page.setViewportSize()` 在同一 isMobile 上下文里
  //   会让 `(pointer: coarse)` 漂回 false（实测：第二个视口起 matchMedia 变假，
  //   于是量到的是**桌面档**规则 —— h=464.2 那组数就是桌面档，不是手机档）。
  for (const vp of VIEWPORTS) {
    const { page, context } = await enterMatch(browser, vp);
    // 用户截图那个视角（截图里高亮的正是「全场」按钮）
    await page.locator('[data-match-camera="full"]').click().catch(() => {});
    await page.waitForTimeout(800);
    await closeModalIfAny(page);
    await closeModalIfAny(page);
    await page.waitForTimeout(600);

    const base = await page.evaluate(MEASURE);
    console.log(`\n--- ${vp.label} · 普通态 ---`);
    console.log(fmt(base));
    console.log(`     四角命中: ${JSON.stringify(base.corners)}`);
    if (base.mediaQuery.coarse !== true && vp.coarse) {
      console.log("  🔴 注意：本视口 pointer:coarse 为假，量到的是桌面档");
    }

    // 对照 A：只把比分条放回**布局流**（不浮动）—— 验证「遮挡 vs 让位」哪个更优
    // ⚠ 注入规则必须压过仓库里 `(0,5,0)` 那条 `position: absolute !important` ——
    //   否则 A 组等于没改（第一版就栽在这：A 与普通态逐位相同）。
    await page.evaluate(() => {
      const s = document.createElement("style");
      s.id = "probe-inflow";
      s.textContent =
        ".match-layout.fm-match.fmm-match.live-kick .fmm-scoreboard," +
        ".match-layout.fm-match.fmm-match.ht-kick .fmm-scoreboard," +
        ".match-layout.fm-match.fmm-match.pre-kickoff .fmm-scoreboard" +
        " { position: static !important; }";
      document.head.appendChild(s);
    });
    await page.waitForTimeout(700);
    const inflow = await page.evaluate(MEASURE);
    console.log(`  ── 对照 A：比分条改回**布局流**（占高度但不遮挡）──`);
    console.log(
      `     可见草坪=${inflow.sums?.cameraVisible}px（普通态 ${base.sums?.cameraVisible}px） · 顶上被盖 ${inflow.cover.top.coveredPx}px（普通态 ${base.cover.top.coveredPx}px）`
    );
    console.log(
      `     控制条容量: clientW=${inflow.barSpace?.clientW} scrollW=${inflow.barSpace?.scrollW} 溢出=${inflow.barSpace?.overflowPx} 图标键=${inflow.barSpace?.playBtnCount}`
    );
    console.log(
      `     命中判定（中心点最上层是谁）: dock→${JSON.stringify(inflow.hits.dock)} stands.bot→${JSON.stringify(inflow.hits.standsBot)}（普通态 dock→${JSON.stringify(base.hits.dock)}）`
    );
    console.log(`     控制条分组宽: ${JSON.stringify(inflow.barSpace?.groups)}`);
    console.log(
      `     底部越出视口: bar=${inflow.bottomOverflow.bar} dock=${inflow.bottomOverflow.dock} wrap=${inflow.bottomOverflow.wrap} field=${inflow.bottomOverflow.field}（普通态 bar=${base.bottomOverflow.bar} dock=${base.bottomOverflow.dock}）`
    );
    const inFlow = await measureInflowProper(page);
    console.log(`  ── 对照 A′：比分条进流 **且** 扣掉它的高度（这才是「让位」的真实数字）──`);
    console.log(
      `     可见草坪=${inFlow.sums?.cameraVisible}px · 顶上被盖 ${inFlow.cover.top.coveredPx}px · fieldOverBar=${inFlow.overlap.fieldOverBar} fieldOverDock=${inFlow.overlap.fieldOverDock}`
    );
    console.log(
      `     dock 命中→${JSON.stringify(inFlow.hits.dock)} · 底部越出 bar=${inFlow.bottomOverflow.bar} dock=${inFlow.bottomOverflow.dock}`
    );
    console.log(`     scoreboard=${JSON.stringify(inFlow.rects.scoreboard)} field=${JSON.stringify(inFlow.rects.field)}`);

    const tall = await measureTallTopStand(page);
    console.log(`  ── 对照 D：加高上看台带让浮层只压看台（不改比分条位置）──`);
    console.log(
      `     可见草坪=${tall.sums?.cameraVisible}px · 顶上被盖 ${tall.cover.top.coveredPx}px · 比分∩相机=${tall.overlap.scoreboardOverCamera}px（压在真草坪上的）· 比分离看台=${tall.cover.top.coveredPx - (tall.overlap.scoreboardOverCamera ?? 0)}px`
    );
    console.log(`     stands.top h=${tall.rects.standsTop?.h} field=${JSON.stringify(tall.rects.field)}`);
    await page.evaluate(() => document.getElementById("probe-inflow")?.remove());
    await page.waitForTimeout(600);

    // 对照 B：只隐藏**底部**（控球条 + 控制条），保留比分条
    const bottomOnly = await measureBottomOnly(page);
    console.log(`  ── 对照 B：只隐藏**底部**、保留比分条 ──`);
    console.log(
      `     可见草坪=${bottomOnly.sums?.cameraVisible}px · 顶上被盖 ${bottomOnly.cover.top.coveredPx}px · 相机∩比分=${bottomOnly.overlap.scoreboardOverCamera}px`
    );

    // 对照 C：只隐藏**比分条**，保留底部
    const topOnly = await measureTopOnly(page);
    console.log(`  ── 对照 C：只隐藏**比分条**、保留底部 ──`);
    console.log(
      `     可见草坪=${topOnly.sums?.cameraVisible}px · 顶上被盖 ${topOnly.cover.top.coveredPx}px`
    );

    // 沉浸模式（v284）：点空白球场 ⇒ 比分条 + 控球条 + 控制条全部隐藏
    const pt = await tapEmptyPitch(page);
    await page.waitForTimeout(1200);
    const imm = await page.evaluate(MEASURE);
    console.log(`  ── 点空白球场 ⇒ 沉浸模式（取点 ${pt ? `(${pt.x},${pt.y}) ${pt.cls}` : "失败"}） ──`);
    console.log(fmt(imm));

    await page.screenshot({ path: join(OUT, `pitchtop-${vp.label}.png`) });
    await context.close();
  }

  console.log(`\n截图：${OUT}/`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
