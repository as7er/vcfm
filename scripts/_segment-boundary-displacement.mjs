/**
 * 切段边界位移探针（2026-09-21，A 线）
 *
 * ## 它回答什么问题
 *
 * `docs/handoff-2026-09-21.md` §5A：用户抱怨的「整队瞬移」**未结案**。
 * 已知两条不能结案的理由：
 *   1. `_display-layer-motion-probe.mjs` 报的 `totalIncidents = 0`
 *      在 `isMotionBoundary`（`dt>0.55` / `discontinuity` / `restartType`）
 *      整段豁免 —— 用户看到的整队瞬移**常就在那里**。
 *   2. `match-motion-integrity-audit.mjs` 喂 `record(snapshot, snapshot)`，
 *      引擎帧与显示帧同一个对象 ⇒ `display-divergence` 结构上不可达。
 *
 * 所以本探针**绕开诊断器**，直接在 `applySimSnapshot` 上量：
 * 每一次调用前后，26 个实体（22 球员 + 球 + 3 官员）各自从哪走到哪。
 *
 * ## 判据（skill `motion-artifact-diagnosis` Step 4）
 *
 * - **所有实体一起跳** ⇒ 场景切换（剪辑），不是物理 bug。
 *   这类跳变在画面上该被一次明确的「换镜头」遮住；若遮罩只有 72%，
 *   观众仍能看见 28% 的跳变 —— 那就是用户报的瞬移。
 * - **只有个别实体跳**（球 + 少数人）⇒ 物理/搬运 bug，得在引擎侧查。
 *
 * 为了能判决，探针同时采：
 *   · 每个实体在**切段入口那次** `applySimSnapshot` 的位移（米，按 0.68/1.05 换算）
 *   · 同一实体在**普通帧**的位移分布（基线，用来对比「一跳多大算异常」）
 *   · 跳变发生瞬间 `.mp-field` 的 `::before` 实际 opacity（淡场到底遮了多少）
 *   · `sceneCut` 判定（切段入口应为 true，且 relocate 缓动被显式关掉）
 *
 * ## 用法
 *
 *   node scripts/_segment-boundary-displacement.mjs [运行秒数=75] [live|fast]
 *
 * ⚠ 每个 context 都要真跑一遍联赛开局（~1~3 分钟）才能进比赛界面。
 * ⚠ `#modal` 必须认 `hidden` class；比赛 45' 会停下等中场确认。
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8921;
const baseUrl = `http://127.0.0.1:${port}/`;
const seconds = Math.max(30, Number(process.argv[2]) || 75);
const simMode = (process.argv[3] || "live").toLowerCase() === "fast" ? "fast" : "live";

// 场地 100×100 格 → 68m×105m（与 `js/matchview.js` 的 OFFICIAL_MX/MY 同源）
const MX = 0.68;
const MY = 1.05;

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
});

async function closeModalIfAny(page) {
  // ⚠ 必须认 `#modal` 的 `hidden` class，只查 `.modal.open/.show` 会漏。
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
 * 在页面里安装测量。核心：包住 `applySimSnapshot`，量前后位移。
 * 注意**不能**读内部局部变量 `sceneCut`（那是函数内 const），
 * 只能按同一公式在调用前重算，并读 `mv._relocLastSimT`（它在返回前被更新）。
 */
const INSTALL = ({ ms, mx, my }) => {
  const mv = window.vcfmMainApi?.matchView;
  const st = {
    frames: 0,
    cuts: [],            // 每次切段入口的完整快照
    normalMax: [],       // 普通帧的「最大单实体位移」分布
    pendingCut: null,
    notes: [],
    until: performance.now() + ms,
    done: false,
  };
  window.__seg = st;
  if (!mv) {
    st.notes.push("no matchView");
    st.done = true;
    return;
  }

  const snapshot = () => {
    const out = { players: [], ball: null, officials: [] };
    for (const p of mv.players || []) out.players.push({ id: p.id, team: p.team, x: p.x, y: p.y });
    if (mv.ball) out.ball = { x: mv.ball.x, y: mv.ball.y };
    const o = mv.officials || {};
    for (const k of ["referee", "assistantA", "assistantB"]) {
      if (o[k]) out.officials.push({ key: k, x: o[k].x, y: o[k].y });
    }
    return out;
  };

  // 位移（米）：两个轴的格不等长，必须分开换算
  const disp = (a, b) => Math.hypot((b.x - a.x) * mx, (b.y - a.y) * my);

  // 切段入口：`playSimTimeline` 在 `applySimSnapshot(frames[0])` 之前调它。
  // 记下 mode；mode==='cut' 说明紧接着的那次 applySimSnapshot 是跨段硬切。
  const origEnter = mv._enterSegmentTransition.bind(mv);
  mv._enterSegmentTransition = function patched(frames) {
    const r = origEnter(frames);
    if (r.mode === "cut") st.pendingCut = { gapSec: r.gapSec, t0: frames?.[0]?.t ?? null };
    return r;
  };

  const origApply = mv.applySimSnapshot.bind(mv);
  mv.applySimSnapshot = function patchedApply(sim, opts) {
    const before = snapshot();
    const prevSimT = mv._relocLastSimT;
    const simT = Number(sim?.t);
    // 与 `applySimSnapshot` 内部同一公式（line 472）
    const sceneCut =
      !Number.isFinite(prevSimT) || simT < prevSimT - 1e-6 || simT - prevSimT > 0.55;

    const ret = origApply(sim, opts);

    const after = snapshot();
    st.frames++;

    // 逐实体位移
    const per = [];
    for (let i = 0; i < before.players.length && i < after.players.length; i++) {
      if (before.players[i].id !== after.players[i].id) continue;
      per.push({
        kind: "player",
        id: before.players[i].id,
        team: before.players[i].team,
        m: disp(before.players[i], after.players[i]),
      });
    }
    if (before.ball && after.ball) {
      per.push({ kind: "ball", id: "ball", team: null, m: disp(before.ball, after.ball) });
    }
    for (const b of before.officials) {
      const a = after.officials.find((x) => x.key === b.key);
      if (a) per.push({ kind: b.key, id: b.key, team: null, m: disp(b, a) });
    }
    if (!per.length) return ret;

    const maxM = Math.max(...per.map((e) => e.m));
    const moved = per.filter((e) => e.m > 6).length; // >6m 近似「肉眼可辨的跳」

    if (st.pendingCut) {
      const el = document.querySelector(".mp-field");
      const cut = st.pendingCut;
      st.pendingCut = null;
      // 淡场遮罩此刻的实际不透明度（`.mp-field.mp-seg-cut::before`）
      let fadeOpacity = null;
      try {
        fadeOpacity = parseFloat(getComputedStyle(el, "::before").opacity);
      } catch {
        /* ignore */
      }
      st.cuts.push({
        gapSec: cut.gapSec != null ? +cut.gapSec.toFixed(1) : null,
        t0: cut.t0,
        simT: Number.isFinite(simT) ? +simT.toFixed(1) : null,
        sceneCut,
        fadeOpacity,
        entityCount: per.length,
        movedOver6m: moved,
        maxM: +maxM.toFixed(2),
        ballM: +(per.find((e) => e.kind === "ball")?.m || 0).toFixed(2),
        // 中位位移：全队一起漂 vs 只有个别实体
        medianM: +per
          .map((e) => e.m)
          .sort((a, b) => a - b)
          .at(Math.floor(per.length / 2))
          .toFixed(2),
        top: per
          .slice()
          .sort((a, b) => b.m - a.m)
          .slice(0, 5)
          .map((e) => ({ id: e.id, k: e.kind, m: +e.m.toFixed(1) })),
      });
    } else {
      st.normalMax.push(+maxM.toFixed(2));
    }
    return ret;
  };

  const watch = () => {
    if (performance.now() >= st.until) {
      st.done = true;
      return;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
};

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

let browser;
try {
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try {
      ready = (await fetch(baseUrl)).ok;
    } catch {
      /* retry */
    }
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "preview server did not start");
  mkdirSync(root + ".tmp-continuity", { recursive: true });

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });
  page.on("dialog", async (d) => {
    await d.accept();
  });

  // ⚠ 不要等 `vcfm-sw-reloaded-*`：headless 下 SW 可能不写这条，30s 超时。
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  let apiReady = false;
  for (let i = 0; i < 90 && !apiReady; i++) {
    apiReady = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
    if (!apiReady) await page.waitForTimeout(1000);
  }
  assert.ok(apiReady, "首屏未就绪：window.vcfmMainApi 未出现");
  console.log("  [1/4] 首屏就绪");

  await page.fill("#input-manager", "Seg Boundary");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  console.log("  [2/4] 主界面");

  await page.locator("#btn-advance-matchday").click();
  let kicked = false;
  for (let i = 0; i < 360 && !kicked; i++) {
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

  // ⚠ 钩子必须在**进比赛界面之后、开播之前**装（`applySimSnapshot` 是实例方法，
  //   `#built` 之后才存在）。装早了拿不到实例，装晚了漏掉前几次切段。
  await page.waitForTimeout(1200);
  await page.evaluate(INSTALL, { ms: seconds * 1000, mx: MX, my: MY });
  console.log("  [4/4] 测量已安装，开始播放");

  await page.click(simMode === "fast" ? "#btn-sim-fast" : "#btn-sim-live", { timeout: 30_000 });

  // 中场会停住等确认：点了「不调整，直接踢」继续跑
  const deadline = Date.now() + (seconds + 300) * 1000;
  let htHandled = false;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.__seg?.done === true).catch(() => false)) break;
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
    await page.waitForTimeout(2000);
  }

  const raw = await page.evaluate(() => {
    const s = window.__seg;
    return {
      frames: s.frames,
      cuts: s.cuts,
      normalMax: s.normalMax.length > 4000 ? s.normalMax.filter((_, i) => i % 2 === 0) : s.normalMax,
      notes: s.notes,
    };
  });

  console.log("\n=== 读数 ===");
  console.log(`采样 sim 帧数：${raw.frames}`);
  const normMed = pct(raw.normalMax, 0.5);
  const normP99 = pct(raw.normalMax, 0.99);
  console.log(
    `普通帧的「最大单实体位移」：中位 ${normMed ?? "?"}m  P99 ${normP99 ?? "?"}m  最大 ${raw.normalMax.length ? Math.max(...raw.normalMax).toFixed(1) : "?"}m`
  );

  console.log(`\n切段入口：${raw.cuts.length} 次`);
  for (const c of raw.cuts) {
    console.log(
      `  gap=${c.gapSec}s t0=${c.t0} simT=${c.simT} sceneCut=${c.sceneCut} ` +
        `fadeOpacity=${c.fadeOpacity} 实体=${c.entityCount} >6m的=${c.movedOver6m} ` +
        `max=${c.maxM}m 中位=${c.medianM}m 球=${c.ballM}m`
    );
    console.log(`     top5 ${JSON.stringify(c.top)}`);
  }
  console.log("NOTES " + JSON.stringify(raw.notes));
  console.log("ERRORS " + JSON.stringify(errors));

  // 判决
  console.log("\n=== 判决 ===");
  if (!raw.cuts.length) {
    console.log("⚠ 没采到切段入口 —— 采样太短或本次没走进高光段，不能下结论。");
  } else {
    const allJump = raw.cuts.filter((c) => c.medianM > 6);
    const fewJump = raw.cuts.filter((c) => c.medianM <= 6 && c.movedOver6m > 0);
    const noneJump = raw.cuts.filter((c) => c.movedOver6m === 0);
    console.log(
      `全队一起跳（中位 >6m）：${allJump.length} 次 ｜ ` +
        `个别实体跳（中位 ≤6m 但有 >6m）：${fewJump.length} 次 ｜ 无明显跳：${noneJump.length} 次`
    );
    if (allJump.length) {
      console.log("⇒ 签名符合**场景切换（剪辑）**，不是物理 bug（skill Step 4）。");
      const weak = allJump.filter((c) => c.fadeOpacity != null && c.fadeOpacity < 0.9);
      if (weak.length) {
        console.log(
          `⚠ 但有 ${weak.length} 次跳变发生时淡场 opacity < 0.9（实测 ${weak
            .map((c) => c.fadeOpacity)
            .join(", ")}）—— 遮罩没有完全盖住那一跳。`
        );
      } else {
        console.log("淡场在跳变瞬间遮罩足够（opacity ≥ 0.9）。");
      }
    }
    if (fewJump.length) {
      console.log("⇒ 有**个别实体**跳：这是物理/搬运类问题的候选，需在引擎侧定位。");
    }
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
