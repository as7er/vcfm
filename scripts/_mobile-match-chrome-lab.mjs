/**
 * 手机横屏「比分条瘦身 / 控球率条浮层」候选 CSS lab（2026-09-22）。
 *
 * ## 为什么用 lab 而不是每改一次跑一遍探针
 *
 * 一次完整开局 ~2.5 分钟。若「改 CSS → 跑探针 → 看数」逐个试，
 * 一小时只能试三个想法。lab 的做法：**开机一次**，把每个候选样式注入
 * 一个独立 `<style>` 节点，逐候选重新量同一批数（`ui-layout-audit` Step 4）。
 *
 * ## 防的三个坑（都是那个 skill 里记着的）
 *
 * 1. **特异性陷阱**：候选必须抄**真实选择器**。横屏那套规则在
 *    `@media (pointer: coarse) and (orientation: landscape)` 里，
 *    选择器长这样（0,4,0）：`.match-layout.fm-match.fmm-match.live-kick .fmm-scoreboard`。
 *    写 `.fmm-scoreboard { ... }`（0,1,0）会被**静默忽略**，lab 会报「所有候选都没变」——
 *    那是假证据。注入的 `<style>` 在主样式表**之后**，同特异性后写生效。
 * 2. **正对照**：`C4` 把比分条 `display: none`，遮挡量**必须**归零。
 *    它不动就说明注入没落地，其余行一律不可读。
 * 3. **C0 基线**：空 CSS。它必须等于上一次探针的读数（自校准）。
 *
 * 用法：node scripts/_mobile-match-chrome-lab.mjs [视口=800x295]
 * ⚠ 需要 Playwright + msedge；一次开机 + N 个候选，约 4 分钟。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const port = 8927;
const baseUrl = `http://127.0.0.1:${port}/`;
const OUT = ".tmp-chrome-lab";
mkdirSync(OUT, { recursive: true });

const [wArg, hArg] = (process.argv[2] || "800x295").split("x");
const VIEWPORT = { width: Number(wArg) || 800, height: Number(hArg) || 295 };

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

/** 与 `_mobile-match-chrome-probe.mjs` 同一套量法（读数可比）。 */
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
  const overlapY = (a, b) => {
    if (!a || !b) return 0;
    return +Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)).toFixed(1);
  };
  const scoreboard = rectOf(".fmm-scoreboard");
  const bar = rectOf(".fmm-match-bar");
  const dock = rectOf(".mp-fmm-dock");
  const field = rectOf(".mp-field");
  const camera = rectOf(".mp-camera");
  const standsTop = rectOf(".mp-stands.top");
  const camBox = document.querySelector(".mp-camera");
  const occSb = overlapY(scoreboard, camera);
  const occDock = overlapY(dock, camera);
  return {
    vh: window.innerHeight,
    scoreboard: scoreboard?.h ?? 0,
    bar: bar?.h ?? 0,
    dock: dock?.h ?? 0,
    field: field?.h ?? 0,
    fieldW: field?.w ?? 0,
    fieldRatio: field && field.h ? +(field.w / field.h).toFixed(3) : 0,
    standsTop: standsTop?.h ?? 0,
    cameraBoxH: camBox?.clientHeight ?? 0,
    // 球场「有多大」= 相机的**渲染高**（screen 空间，含 1.28 倍预设）
    cameraRectH: camera?.h ?? 0,
    occCamera: occSb,
    occDockCamera: occDock,
    occField: overlapY(scoreboard, field),
    // 🔴 「可见球场」必须**同时减掉两个浮层**。
    //    第一版只减了比分条，于是「控球条改浮层」看起来 +24px —— 那是假的：
    //    它只是从「球场下方」搬到了「球场底部压住」，球场盒变大了但没多看见。
    //    这正是 ui-layout-audit 里那条「量错量」的坑。
    visiblePitch: camera ? +(camera.h - occSb - occDock).toFixed(1) : 0,
    chromePct: +(
      (((scoreboard?.h ?? 0) + (bar?.h ?? 0) + (dock?.h ?? 0)) / window.innerHeight) *
      100
    ).toFixed(1),
    scrollY: document.scrollingElement.scrollHeight - window.innerHeight,
  };
};

/** 横屏那套规则的**真实选择器前缀**（三个状态类都要带，缺一个就有状态漏网）。 */
const S = [
  ".match-layout.fm-match.fmm-match.live-kick",
  ".match-layout.fm-match.fmm-match.ht-kick",
  ".match-layout.fm-match.fmm-match.pre-kickoff",
];
const each = (suffix) => S.map((s) => `${s} ${suffix}`).join(",\n");

const wrapMedia = (body) => `@media (pointer: coarse) and (orientation: landscape) {\n${body}\n}`;

/** 中列压成一行（赛事名保留，缩小并截断）。 */
const SB_ROW = `
${each(".fmm-scoreboard .fm-sb-center")} {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
}
${each(".fmm-scoreboard .fm-sb-comp")} { font-size: 0.6rem; max-width: 5rem; }
${each(".fmm-scoreboard .fm-sb-live")} { margin-top: 0; }
`;
/** 同上，但横屏干脆省掉赛事名（赛前简报里已有）。 */
const SB_ROW_NOCOMP = `
${each(".fmm-scoreboard .fm-sb-center")} {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}
${each(".fmm-scoreboard .fm-sb-comp")} { display: none; }
${each(".fmm-scoreboard .fm-sb-live")} { margin-top: 0; }
`;
const DOCK_OVERLAY = `
${each(".fmm-match-body .mp-wrap")} { position: relative; }
${each(".fmm-match-body .mp-fmm-dock")} {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  z-index: 4;
  margin: 0;
  border-radius: 8px 8px 0 0;
}
`;
/** 控球率条压薄：只留进度条本体，去掉上下留白。 */
const DOCK_THIN = `
${each(".fmm-match-body .mp-fmm-dock")} {
  min-height: 0;
  padding: 0.04rem 0.45rem;
  margin-top: 0.06rem;
}
`;
const DOCK_HIDDEN = `${each(".fmm-match-body .mp-fmm-dock")} { display: none; }`;

const CANDIDATES = [
  { id: "C0-baseline", note: "空 CSS（自校准）", css: "" },
  { id: "C1-comp-inline", note: "比分条中列一行，**赛事名保留**（缩小截断）", css: wrapMedia(SB_ROW) },
  { id: "C1b-comp-hidden", note: "比分条中列一行，赛事名隐藏", css: wrapMedia(SB_ROW_NOCOMP) },
  { id: "C2-dock-overlay", note: "控球条改浮层（隔离变量）", css: wrapMedia(DOCK_OVERLAY) },
  { id: "C5-dock-thin", note: "控球条压薄（去掉留白）", css: wrapMedia(DOCK_THIN) },
  { id: "C6-dock-hidden", note: "控球条整条隐藏", css: wrapMedia(DOCK_HIDDEN) },
  {
    id: "C7-best",
    note: "推荐组合：比分条一行（留赛事名）+ 控球条压薄",
    css: wrapMedia(SB_ROW + DOCK_THIN),
  },
  {
    id: "C8-max",
    note: "极限组合：比分条一行（省赛事名）+ 控球条隐藏",
    css: wrapMedia(SB_ROW_NOCOMP + DOCK_HIDDEN),
  },
  {
    id: "C4-positive-control",
    note: "正对照：比分条 display:none ⇒ 遮挡量**必须**归零",
    css: wrapMedia(`${each(".fmm-scoreboard")} { display: none; }`),
  },
];

console.log(`\n=== 候选 CSS lab（视口 ${VIEWPORT.width}×${VIEWPORT.height}）===`);
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
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
  await page.fill("#input-manager", "Chrome Lab");
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

  const rows = [];
  for (const cand of CANDIDATES) {
    await page.evaluate((css) => {
      let el = document.getElementById("__lab-css");
      if (!el) {
        el = document.createElement("style");
        el.id = "__lab-css";
        document.head.appendChild(el);
      }
      el.textContent = css;
      // 强制一次重排，确保量到的是新样式
      void document.body.offsetHeight;
    }, cand.css);
    await page.waitForTimeout(500);
    const m = await page.evaluate(MEASURE);
    rows.push({ ...cand, m });
    console.log(`\n--- ${cand.id} ---  ${cand.note}`);
    console.log(
      `  比分条 ${m.scoreboard} · 控制条 ${m.bar} · 控球条 ${m.dock} · 合计 ${m.chromePct}%`
    );
    console.log(`  球场盒 ${m.field}（比 ${m.fieldRatio}）· 相机渲染高 ${m.cameraRectH}`);
    console.log(
      `  被比分条压 ${m.occCamera} · 被控球条压 ${m.occDockCamera} ⇒ **可见球场 ${m.visiblePitch}**`
    );
    await page.screenshot({ path: join(OUT, `${cand.id}.png`) });
  }

  // 正对照判定：C4 必须让遮挡量归零
  const base = rows.find((r) => r.id === "C0-baseline");
  const pos = rows.find((r) => r.id === "C4-positive-control");
  const ok = pos && pos.m.occCamera === 0;
  console.log(`\n正对照：C4 遮挡量 = ${pos?.m.occCamera} ⇒ ${ok ? "✅ 注入落地，其余行可读" : "❌ 注入未生效，本表作废"}`);

  console.log("\n=== 汇总（可见球场 px，越大越好）===");
  console.log("  候选                    可见球场    增量   相机高  比分条  控球条  球场盒");
  for (const r of rows) {
    const d = r.m.visiblePitch - (base?.m.visiblePitch ?? 0);
    console.log(
      `  ${r.id.padEnd(22)} ${String(r.m.visiblePitch).padStart(7)}  ${(d >= 0 ? "+" : "") + d.toFixed(1)}`.padEnd(42) +
        `${String(r.m.cameraRectH).padStart(6)}${String(r.m.scoreboard).padStart(8)}${String(r.m.dock).padStart(8)}${String(r.m.field).padStart(8)}`
    );
  }
  console.log(`\n截图：${OUT}/<候选>.png`);
  await context.close();
} finally {
  if (browser) await browser.close();
  server.kill();
}
