/**
 * 直播观赛取证（2026-09-22）——「问题还是很多」的画面级体检。
 *
 * ## 为什么要新写一个
 *
 * 既有探针都只盯**一件事**（切段位移 / 淡场 / 跑动距离），
 * 没有一条覆盖「观众实际看到的画面」这个整体。本脚本换个角度：
 * **把整场直播跑起来，按固定节拍同时采三层数据**，用来定位「哪里看着不对」。
 *
 *   ① canvas 层：画布尺寸/缩放、相机状态、帧率与掉帧
 *   ② 实体层：22 球员 + 球 + 3 官员的**引擎坐标**（画面就是照这个画的）
 *   ③ DOM 层：比分/时间/控制条/ticker、遮罩，以及它们**是否压住球场**
 *
 * 同时按节拍把整屏截图落到 `.tmp-watch/`，再用 `contact-sheet.mjs` 拼成
 * 一张可翻阅的页面 —— 人（用户）能直接看，机器（我）读指标文本。
 *
 * ## 用法
 *
 *   node scripts/_live-visual-audit.mjs [秒数=70] [live|fast] [--headed]
 *
 * ⚠ 每个 context 都要真跑一遍联赛开局（~1~3 分钟）。
 * ⚠ `#modal` 必须认 `hidden` class；45' 会停下等中场确认（点 `#btn-ht-skip`）。
 * ⚠ headless 不要等 `vcfm-sw-reloaded-*`（SW 可能不写），用 `domcontentloaded`
 *   + 轮询 `window.vcfmMainApi`。
 * ⚠ 不重定向 stdout 时本脚本会被宿主杀 ⇒ 调用方一律 `cmd /c "... > log 2>&1"`。
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8932;
const baseUrl = `http://127.0.0.1:${port}/`;
const outDir = root + ".tmp-watch";
const seconds = Math.max(20, Number(process.argv[2]) || 70);
const simMode = (process.argv[3] || "live").toLowerCase() === "fast" ? "fast" : "live";
const headed = process.argv.includes("--headed");

// 场地 100×100 格 → 68m×105m（与 `js/matchview.js` 的 OFFICIAL_MX/MY 同源）
const MX = 0.68;
const MY = 1.05;

mkdirSync(outDir, { recursive: true });

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
});

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
        [...m.querySelectorAll("button")].find((b) => /关闭|确定|继续|知道了|OK|×/i.test(b.textContent || ""));
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
 * 页面内采集器：按节拍把所有「观众能看到的东西」取一份快照。
 * 用 `getComputedStyle` + `getBoundingClientRect` 读**渲染结果**，不读源码假设。
 */
const INSTALL = ({ ms, mx, my, sampleEveryMs }) => {
  const mv = window.vcfmMainApi?.matchView;
  const st = {
    notes: [],
    samples: [],
    fps: { last: 0, frames: 0, gaps: [] },
    errors: [],
    until: performance.now() + ms,
    done: false,
    keys: null,
  };
  window.__vis = st;
  if (!mv) {
    st.notes.push("no matchView");
    st.done = true;
    return;
  }
  // 一次性 dump：我（agent）据此知道有哪些可读状态，避免靠猜字段名
  st.keys = {
    matchView: Object.keys(mv).sort(),
    camera: mv.camera ? Object.keys(mv.camera).sort() : null,
    hasCanvas: !!mv.canvas,
  };

  const rectOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const vis = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    if (parseFloat(s.opacity || "1") < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const overlapArea = (a, b) => {
    if (!a || !b) return 0;
    const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return w * h;
  };

  const snap = () => {
    const o = {
      t: +((performance.now() - (st.until - ms)) / 1000).toFixed(2),
      // ── ② 实体层：画面就是照这些坐标画的 ──
      players: [],
      ball: null,
      officials: [],
      // ── ① canvas 层 ──
      canvas: null,
      cam: null,
      // ── ③ DOM 层 ──
      dom: {},
      fade: null,
    };

    for (const p of mv.players || []) {
      o.players.push({ id: p.id, team: p.team, x: +Number(p.x).toFixed(2), y: +Number(p.y).toFixed(2) });
    }
    if (mv.ball) o.ball = { x: +Number(mv.ball.x).toFixed(2), y: +Number(mv.ball.y).toFixed(2) };
    const of = mv.officials || {};
    for (const k of ["referee", "assistantA", "assistantB"]) {
      if (of[k]) o.officials.push({ key: k, x: +Number(of[k].x).toFixed(2), y: +Number(of[k].y).toFixed(2) });
    }

    const cv = mv.canvas || document.querySelector("#match-canvas") || document.querySelector("canvas");
    if (cv) {
      const r = cv.getBoundingClientRect();
      o.canvas = {
        css: { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), y: +r.y.toFixed(1) },
        buf: { w: cv.width, h: cv.height },
        dpr: +(window.devicePixelRatio || 1).toFixed(2),
        // 缓冲区分辨率 / CSS 尺寸：<1 说明画面被拉大（糊），>1 说明被压缩（丢细节）
        scaleX: +(cv.width / Math.max(1, r.width)).toFixed(3),
        scaleY: +(cv.height / Math.max(1, r.height)).toFixed(3),
      };
    }

    const cam = mv.camera || mv.cam;
    if (cam) {
      o.cam = {};
      for (const k of ["x", "y", "zoom", "targetX", "targetY", "targetZoom", "mode", "scale"]) {
        if (cam[k] != null && typeof cam[k] !== "object") o.cam[k] = +Number(cam[k]).toFixed(4);
      }
    }
    if (mv.camMode != null) o.cam = { ...(o.cam || {}), camMode: String(mv.camMode) };

    // 遮罩：`.mp-field.mp-seg-cut::before` 的实际 opacity（跳变帧它该接近全遮）
    const field = document.querySelector(".mp-field");
    if (field) {
      try {
        o.fade = parseFloat(getComputedStyle(field, "::before").opacity);
      } catch {
        /* ignore */
      }
      o.dom.field = rectOf(field);
    }

    // 关键 DOM：比分/时间、控制条、ticker、名牌层
    const pick = (sel) => document.querySelector(sel);
    const score = pick("#match-score, .mp-score, #mp-score");
    const clock = pick("#match-clock, .mp-clock, #mp-clock");
    o.dom.score = score ? (score.textContent || "").trim().slice(0, 40) : null;
    o.dom.clock = clock ? (clock.textContent || "").trim().slice(0, 24) : null;

    for (const [key, sel] of [
      ["controls", "#match-controls, .mp-controls, .mp-dock"],
      ["ticker", "#match-ticker, .mp-ticker, .mp-ticker-line"],
      ["actors", ".mp-actors"],
      ["labels", ".mp-name, .mp-teams, .mp-team-name"],
    ]) {
      const el = pick(sel);
      o.dom[key] = { present: !!el, visible: vis(el), rect: rectOf(el) };
    }

    // 名牌层里**真正可见**的名字块：两两重叠就是「字叠在一起看不清」
    const nameEls = [...document.querySelectorAll(".mp-name, .mp-ticker, .mp-team-name")]
      .filter(vis)
      .map((el) => rectOf(el))
      .filter(Boolean);
    o.dom.nameRects = nameEls.length;
    let nameOverlaps = 0;
    let nameOverlapArea = 0;
    for (let i = 0; i < nameEls.length; i += 1) {
      for (let j = i + 1; j < nameEls.length; j += 1) {
        const a = overlapArea(nameEls[i], nameEls[j]);
        if (a > 4) {
          nameOverlaps += 1;
          nameOverlapArea += a;
        }
      }
    }
    o.dom.nameOverlaps = nameOverlaps;
    o.dom.nameOverlapArea = +nameOverlapArea.toFixed(0);

    // 控制条 / ticker 压住球场多少面积（观感「看不清」的常见来源）
    const fieldR = o.dom.field;
    o.dom.coverArea = {
      controls: +
        (overlapArea(fieldR, o.dom.controls.rect) / Math.max(1, (fieldR?.w || 1) * (fieldR?.h || 1))).toFixed(3),
      ticker: +
        (overlapArea(fieldR, o.dom.ticker.rect) / Math.max(1, (fieldR?.w || 1) * (fieldR?.h || 1))).toFixed(3),
    };

    // 相机的合成变换：值突变 = 镜头跳（观感上的「画面猛地一动」）
    const ctxSet = mv.canvas ? getComputedStyle(mv.canvas).transform : "";
    o.dom.canvasTransform = ctxSet && ctxSet !== "none" ? ctxSet.slice(0, 60) : null;

    // ── 布局抖动定位：**谁**在推尺寸（每 1 秒扫一次，避免每帧 layout thrash）──
    st._n = (st._n || 0) + 1;
    o.deltas = [];
    if (st._n % 2 === 1) {
      if (!st._rects) st._rects = new Map();
      const scope = document.querySelector("#screen-match") || document.body;
      const all = scope.querySelectorAll("*");
      for (let i = 0; i < all.length && i < 900; i += 1) {
        const el = all[i];
        const r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) continue;
        const key = (
          el.tagName +
          (el.id ? "#" + el.id : "") +
          (el.classList.length ? "." + [...el.classList].join(".") : "")
        ).slice(0, 80);
        const now = { x: r.x, y: r.y, w: r.width, h: r.height };
        const prev = st._rects.get(key);
        st._rects.set(key, now);
        if (!prev) continue;
        const d = Math.max(
          Math.abs(now.w - prev.w),
          Math.abs(now.h - prev.h),
          Math.abs(now.x - prev.x),
          Math.abs(now.y - prev.y)
        );
        if (d > 0.5) {
          o.deltas.push({
            k: key,
            dw: +(now.w - prev.w).toFixed(1),
            dh: +(now.h - prev.h).toFixed(1),
            dx: +(now.x - prev.x).toFixed(1),
            dy: +(now.y - prev.y).toFixed(1),
          });
        }
      }
    }

    // 视口 / 滚动条：滚动条一出现，整页可用宽度就变 ⇒ 一切等比缩放
    const de = document.documentElement;
    o.view = {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      clientW: de.clientWidth,
      clientH: de.clientHeight,
      scrollH: de.scrollHeight,
      scrollW: de.scrollWidth,
    };

    // 球场祖先链：区分「容器变了」还是「canvas 自己变了」
    {
      // ⚠ 起点必须是 **canvas 的祖先链**，不是随手 `querySelector(".mp-field")` 拿到的那个 ——
      //   实测 canvas 的 CSS 宽 1375 而那个 `.mp-field` 只有 1026，两者**不是同一棵树**
      //   （FMM 2D 模式另有 DOM）。第一版就是这样把链查错了对象。
      let anc = mv.canvas || mv.fieldEl || field;
      const chain = [];
      for (let i = 0; i < 6 && anc; i += 1) {
        const r = rectOf(anc);
        chain.push({
          k: (
            anc.tagName +
            (anc.id ? "#" + anc.id : "") +
            (anc.classList.length ? "." + [...anc.classList].join(".") : "")
          ).slice(0, 70),
          w: r ? +r.w.toFixed(1) : null,
          h: r ? +r.h.toFixed(1) : null,
          css: getComputedStyle(anc).height + "/" + getComputedStyle(anc).aspectRatio,
        });
        anc = anc.parentElement;
      }
      o.chain = chain;
    }

    // 可见文本：观众**读得到**的字（时钟/比分/解说/提示/控制坞）
    {
      const txt = (el, n = 28) =>
        el && vis(el) ? (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, n) : null;
      o.text = {
        score: txt(score, 20),
        clock: txt(clock, 20),
        ticker: txt(mv.fmmTickerEl, 44),
        caption: txt(mv.captionEl, 44),
        banner: txt(mv.bannerEl, 44),
        tip: txt(mv.tipEl, 44),
        dock: txt(mv.fmmDockEl, 24),
        bench: txt(mv.benchStripEl, 24),
        live: txt(mv.liveStripEl, 28),
        poss: txt(mv.fmmPossEl, 12),
      };
      o.fmm = mv.fmmDockEl ? { dockVisible: vis(mv.fmmDockEl), dockRect: rectOf(mv.fmmDockEl) } : null;
    }

    st.samples.push(o);
  };

  // 帧率：rAF 间隔分布（掉帧 = 观感卡顿）
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    st.fps.frames += 1;
    if (gap > 0 && st.fps.gaps.length < 20000) st.fps.gaps.push(+gap.toFixed(2));
    if (now < st.until) requestAnimationFrame(tick);
    else st.done = true;
  };
  requestAnimationFrame(tick);

  // 采样节拍
  const timer = setInterval(() => {
    if (performance.now() >= st.until) {
      clearInterval(timer);
      return;
    }
    try {
      snap();
    } catch (e) {
      st.errors.push(String(e && e.message ? e.message : e));
    }
  }, sampleEveryMs);
  snap();

  window.addEventListener("error", (e) => st.errors.push("window: " + (e.message || "")));
};

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

let browser;
let exitCode = 0;
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i += 1) {
    try {
      ready = (await fetch(baseUrl)).ok;
    } catch {
      /* retry */
    }
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "preview server did not start");

  browser = await chromium.launch({ channel: "msedge", headless: !headed });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300));
  });
  page.on("dialog", async (d) => {
    await d.accept();
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  let apiReady = false;
  for (let i = 0; i < 90 && !apiReady; i += 1) {
    apiReady = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
    if (!apiReady) await page.waitForTimeout(1000);
  }
  assert.ok(apiReady, "首屏未就绪：window.vcfmMainApi 未出现");
  console.log("  [1/4] 首屏就绪");

  await page.fill("#input-manager", "Visual Audit");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  console.log("  [2/4] 主界面");

  await page.locator("#btn-advance-matchday").click();
  let kicked = false;
  for (let i = 0; i < 360 && !kicked; i += 1) {
    await page.waitForTimeout(2000);
    await closeModalIfAny(page);
    const s = await page.evaluate(() => {
      const b = document.querySelector("#btn-play-match");
      return { disabled: b ? b.disabled : null };
    });
    kicked = s.disabled === false;
  }
  assert.ok(kicked, "推进到比赛日后仍无「进入比赛」可点");
  console.log("  [3/4] 已到比赛日");

  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  await page.waitForTimeout(1200);

  await page.evaluate(INSTALL, { ms: seconds * 1000, mx: MX, my: MY, sampleEveryMs: 500 });
  console.log("  [4/4] 采集已安装，开始播放");

  // 截图节拍与采样并行：每 2.2 秒一张整屏图
  const shotDir = outDir + "/frames";
  mkdirSync(shotDir, { recursive: true });
  let shots = 0;
  const shotTimer = setInterval(async () => {
    try {
      shots += 1;
      await page.screenshot({ path: `${shotDir}/f-${String(shots).padStart(3, "0")}.png` });
    } catch {
      /* 页面在切换瞬间可能拒拍，忽略 */
    }
  }, 2200);

  await page.click(simMode === "fast" ? "#btn-sim-fast" : "#btn-sim-live", { timeout: 30_000 });

  const deadline = Date.now() + (seconds + 300) * 1000;
  let htHandled = false;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.__vis?.done === true).catch(() => false)) break;
    if (!htHandled) {
      const ht = await page
        .evaluate(() => {
          const panel = document.querySelector("#match-ht-panel");
          const visible =
            !!panel && !panel.classList.contains("hidden") && getComputedStyle(panel).display !== "none";
          if (visible) {
            const skip = document.querySelector("#btn-ht-skip");
            if (skip) {
              skip.click();
              return true;
            }
          }
          return false;
        })
        .catch(() => false);
      if (ht) {
        htHandled = true;
        console.log("  [中场] 已点「不调整，直接踢」");
        await page.waitForTimeout(1500);
        continue;
      }
    }
    await closeModalIfAny(page);
    await page.waitForTimeout(1500);
  }
  clearInterval(shotTimer);

  const raw = await page.evaluate(() => {
    const s = window.__vis;
    return { samples: s.samples, fps: s.fps, notes: s.notes, errors: s.errors, keys: s.keys };
  });

  // ── 报告 ────────────────────────────────────────────────────────────────────
  const S = raw.samples;
  console.log("\n=== A. `matchView` 可读状态（一次性 dump，供后续定位）===");
  console.log(`  matchView keys: ${(raw.keys?.matchView || []).join(", ")}`);
  console.log(`  camera keys   : ${(raw.keys?.camera || []).join(", ") || "(无 camera 对象)"}`);
  console.log(`  hasCanvas     : ${raw.keys?.hasCanvas}`);

  console.log(`\n=== B. 采样 ===`);
  console.log(`  样本 ${S.length} 个，每 0.5 秒一个`);
  console.log(`  截图 ${shots} 张 → ${shotDir.replace(root, "")}`);

  console.log(`\n=== C. 帧率（rAF 间隔）===`);
  const gaps = raw.fps.gaps;
  if (gaps.length) {
    const med = pct(gaps, 0.5);
    const p95 = pct(gaps, 0.95);
    const max = Math.max(...gaps);
    const janky = gaps.filter((g) => g > 50).length;
    console.log(
      `  帧数 ${raw.fps.frames}｜间隔 中位 ${med?.toFixed(1)}ms｜P95 ${p95?.toFixed(1)}ms｜最大 ${max.toFixed(1)}ms`
    );
    console.log(`  >50ms 的卡顿 ${janky} 次（${((janky / gaps.length) * 100).toFixed(1)}%）`);
    console.log(`  等效帧率：中位 ${(1000 / (med || 16.7)).toFixed(1)} fps`);
  } else {
    console.log("  ⚠ 没采到 rAF（页面可能用了别的渲染循环）");
  }

  console.log(`\n=== D. canvas 尺寸与缩放 ===`);
  const c0 = S.find((s) => s.canvas)?.canvas;
  if (c0) {
    console.log(`  CSS 尺寸 ${c0.css.w}×${c0.css.h} ｜ 缓冲区 ${c0.buf.w}×${c0.buf.h} ｜ dpr ${c0.dpr}`);
    console.log(`  缩放 scaleX ${c0.scaleX} scaleY ${c0.scaleY}（<1 = 被拉大 ⇒ 糊；>1 = 被压缩 ⇒ 丢细节）`);
    const bufVariants = [...new Set(S.filter((s) => s.canvas).map((s) => `${s.canvas.buf.w}x${s.canvas.buf.h}`))];
    console.log(`  缓冲区尺寸变化：${bufVariants.join(" → ")}`);
    const cssVariants = [...new Set(S.filter((s) => s.canvas).map((s) => `${s.canvas.css.w}x${s.canvas.css.h}`))];
    console.log(`  CSS 尺寸变化：${cssVariants.join(" → ")}`);
  } else {
    console.log("  ⚠ 没找到 canvas");
  }

  console.log(`\n=== E. 球员几何（画面里 22 人挤不挤、有没有出界）===`);
  let maxClose = 0;
  let sumClose = 0;
  let maxOut = 0;
  const closeHist = [];
  for (const s of S) {
    const ps = s.players || [];
    let close = 0;
    for (let i = 0; i < ps.length; i += 1) {
      for (let j = i + 1; j < ps.length; j += 1) {
        const d = Math.hypot((ps[i].x - ps[j].x) * MX, (ps[i].y - ps[j].y) * MY);
        if (d < 2) close += 1;
      }
    }
    closeHist.push(close);
    maxClose = Math.max(maxClose, close);
    sumClose += close;
    let out = 0;
    for (const p of ps) if (p.x < -1 || p.x > 101 || p.y < -1 || p.y > 101) out += 1;
    maxOut = Math.max(maxOut, out);
  }
  console.log(`  两两距离 <2m 的对数：均值 ${(sumClose / Math.max(1, S.length)).toFixed(2)}｜最大 ${maxClose}`);
  console.log(`  越界（出场地 ±1 格）球员数：最大 ${maxOut}`);
  const ball = S.map((s) => s.ball).filter(Boolean);
  if (ball.length) {
    const bx = ball.map((b) => b.x);
    const by = ball.map((b) => b.y);
    console.log(
      `  球：x ${Math.min(...bx).toFixed(1)}~${Math.max(...bx).toFixed(1)}｜y ${Math.min(...by).toFixed(1)}~${Math.max(...by).toFixed(1)}`
    );
    const ballOut = ball.filter((b) => b.x < -1 || b.x > 101 || b.y < -1 || b.y > 101).length;
    console.log(`  球越界样本：${ballOut} / ${ball.length}`);
  }

  console.log(`\n=== F. 相机（镜头跳 = 观感「画面猛地一动」）===`);
  const cams = S.map((s) => s.cam).filter(Boolean);
  if (cams.length) {
    const zoomKey = cams[0].zoom != null ? "zoom" : cams[0].targetZoom != null ? "targetZoom" : null;
    console.log(`  样本 ${cams.length}；mode/camMode 取值：${[...new Set(cams.map((c) => c.mode ?? c.camMode))].join(", ")}`);
    if (zoomKey) {
      const zs = cams.map((c) => c[zoomKey]).filter((v) => Number.isFinite(v));
      console.log(`  ${zoomKey}：${Math.min(...zs).toFixed(3)} ~ ${Math.max(...zs).toFixed(3)}`);
      let bigJumps = 0;
      let maxJump = 0;
      for (let i = 1; i < zs.length; i += 1) {
        const d = Math.abs(zs[i] - zs[i - 1]);
        if (d > 0.15) bigJumps += 1;
        maxJump = Math.max(maxJump, d);
      }
      console.log(`  相邻样本 zoom 变化 >0.15 的次数：${bigJumps}｜最大 ${maxJump.toFixed(3)}`);
    }
  } else {
    console.log("  ⚠ 没采到相机状态（字段名可能不同 —— 见 A 的 keys dump）");
  }

  console.log(`\n=== G. DOM 覆盖与标签重叠 ===`);
  const dom0 = S.find((s) => s.dom?.field)?.dom;
  if (dom0) {
    console.log(`  球场 rect ${JSON.stringify(dom0.field)}`);
    for (const k of ["controls", "ticker", "actors", "labels"]) {
      const v = dom0[k];
      console.log(`  ${k.padEnd(9)} present=${v.present} visible=${v.visible} rect=${JSON.stringify(v.rect)}`);
    }
    const cov = S.map((s) => s.dom.coverArea).filter(Boolean);
    if (cov.length) {
      console.log(
        `  控制条压住球场面积占比：最大 ${Math.max(...cov.map((c) => c.controls)).toFixed(3)}`
      );
      console.log(`  ticker  压住球场面积占比：最大 ${Math.max(...cov.map((c) => c.ticker)).toFixed(3)}`);
    }
  }
  const names = S.map((s) => s.dom?.nameRects ?? 0);
  const nov = S.map((s) => s.dom?.nameOverlaps ?? 0);
  console.log(`  可见名字块数：${Math.min(...names)} ~ ${Math.max(...names)}`);
  console.log(`  名字块两两重叠对数：最大 ${Math.max(...nov)}｜均值 ${(nov.reduce((a, b) => a + b, 0) / Math.max(1, nov.length)).toFixed(2)}`);

  console.log(`\n=== H. 比分 / 时间 / 遮罩 ===`);
  const sc = [...new Set(S.map((s) => s.dom?.score).filter(Boolean))];
  const ck = [...new Set(S.map((s) => s.dom?.clock).filter(Boolean))];
  console.log(`  score 取值：${sc.join(" | ") || "(读不到)"}`);
  console.log(`  clock 取值：${ck.join(" | ") || "(读不到)"}`);
  const fades = S.map((s) => s.fade).filter((v) => Number.isFinite(v));
  if (fades.length) {
    const nonZero = fades.filter((v) => v > 0.01);
    console.log(`  ::before opacity：${Math.min(...fades).toFixed(2)} ~ ${Math.max(...fades).toFixed(2)}｜>0.01 的样本 ${nonZero.length}/${fades.length}`);
  }

  console.log(`\n=== J. 布局抖动：谁在推容器尺寸 ===`);
  {
    const wv = S.filter((s) => s.view);
    if (wv.length) {
      const vW = [...new Set(wv.map((s) => `${s.view.innerW}x${s.view.innerH}`))];
      const cW = [...new Set(wv.map((s) => `${s.view.clientW}x${s.view.clientH}`))];
      const sH = [...new Set(wv.map((s) => s.view.scrollH))];
      console.log(`  window.inner ${vW.join(" → ")}｜documentElement.client ${cW.join(" → ")}`);
      console.log(`  scrollHeight ${sH.join(" → ")}（> clientH 就是页面可滚）`);
    }
    // 哪个元素在动？幅度 + 频次一眼看出罪魁
    const tally = new Map();
    for (const s of S) {
      for (const d of s.deltas || []) {
        const cur = tally.get(d.k) || { n: 0, maxAbs: 0, sample: null };
        cur.n += 1;
        // ⚠ 只按**尺寸**排序：Δx/Δy 会把「世界坐标在动」的元素（球场的线、
        //   球员圆点、SVG path）全顶上来 —— 那些是比赛在动，不是布局在抖。
        const abs = Math.max(Math.abs(d.dw), Math.abs(d.dh));
        if (abs > cur.maxAbs) {
          cur.maxAbs = +abs.toFixed(1);
          cur.sample = d;
        }
        tally.set(d.k, cur);
      }
    }
    const top = [...tally.entries()].sort((a, b) => b[1].maxAbs - a[1].maxAbs).slice(0, 10);
    console.log(`  在动的元素共 ${tally.size} 个；幅度最大的 Top 10：`);
    for (const [k, v] of top) {
      console.log(`    ${String(v.maxAbs).padStart(7)}px ×${String(v.n).padStart(3)}  ${k}`);
      if (v.sample) {
        console.log(`              Δw=${v.sample.dw} Δh=${v.sample.dh} Δx=${v.sample.dx} Δy=${v.sample.dy}`);
      }
    }
    const chains = S.map((s) => s.chain).filter(Boolean);
    if (chains.length) {
      console.log(`  球场祖先链（field → 上 4 级）—— 谁在变，就从这里看：`);
      for (let i = 0; i < 6; i += 1) {
        const at = chains.map((c) => c[i]).filter(Boolean);
        if (!at.length) break;
        const ws = at.map((x) => x.w).filter(Number.isFinite);
        const hs = at.map((x) => x.h).filter(Number.isFinite);
        const rng = (a) => {
          const s = [...new Set(a.map((v) => +v.toFixed(1)))].sort((x, y) => x - y);
          return s.length > 3 ? `${s[0]}~${s[s.length - 1]}（${s.length} 种）` : s.join(",");
        };
        console.log(`    [${i}] ${at[0].k}`);
        console.log(`         宽 ${rng(ws)}｜高 ${rng(hs)}｜css h/ar ${at[0].css}`);
      }
    }
    const texts = ["score", "clock", "ticker", "caption", "banner", "tip", "dock", "bench", "live", "poss"];
    const seen = {};
    for (const s of S) {
      for (const k of texts) {
        const v = s.text?.[k];
        if (v != null) (seen[k] ||= new Set()).add(v);
      }
    }
    console.log(`  可见文本取值：`);
    for (const k of texts) {
      if (!seen[k]) continue;
      const arr = [...seen[k]];
      console.log(`    ${k.padEnd(8)} ${arr.slice(0, 6).join(" ｜ ")}${arr.length > 6 ? ` …(+${arr.length - 6})` : ""}`);
    }
  }
  console.log(`\n=== I. 错误 ===`);
  console.log(`  页面错误 ${errors.length} 条｜采集器错误 ${raw.errors.length} 条`);
  for (const e of [...errors, ...raw.errors].slice(0, 12)) console.log(`    ${e}`);
  if (raw.notes.length) console.log(`  notes: ${raw.notes.join("; ")}`);

  // 原始样本留给下一次分析（避免再来一遍 3 分钟的开局）
  const dump = outDir + "/samples.json";
  writeFileSync(dump, JSON.stringify({ seconds, simMode, samples: S, fps: raw.fps }, null, 0), "utf8");
  console.log(`\n原始样本 → ${dump.replace(root, "")}`);

  exitCode = 0;
} catch (e) {
  console.error("\n采集失败：", e && e.stack ? e.stack : e);
  exitCode = 1;
} finally {
  try {
    await browser?.close();
  } catch {
    /* ignore */
  }
  server.kill();
}
process.exit(exitCode);
