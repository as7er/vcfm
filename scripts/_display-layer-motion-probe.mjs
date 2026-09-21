/**
 * 画面层运动诊断探针（2026-09-21）
 *
 * ## 为什么需要它
 *
 * 现有 `scripts/match-motion-integrity-audit.mjs` 喂给诊断器的是
 * `monitor.record(snapshot, snapshot)` —— **引擎帧与显示帧传的是同一个对象**
 * ⇒ `display-divergence` 这一类**永远不可能触发**，而且它默认跑 `background` 档。
 * 也就是说：**用户感知的画面层，自动化里没有任何覆盖。**
 *
 * 而 App 自己是采真显示帧的（`js/matchview.js:3199`
 * `this.motionMonitor.record(engineFrame, displayFrame, {...})`），
 * 显示帧来自视图层的 `this.players[]`。
 *
 * 本探针走真实渲染路径：进比赛 → ×4 倍速跑一段 → 读
 * `vcfmMainApi.matchView.getMotionDiagnosticStatus()` 与 `createMotionClip()`，
 * 按事件类型汇总。这是「用户看到的东西」这一层目前**唯一**的自动检查。
 *
 * ## 用法
 *
 *   node scripts/_display-layer-motion-probe.mjs [比赛分钟数=30]
 *
 * ⚠ 每个 context 都要真跑一遍 134 场联赛（~3 分钟）才能进比赛界面。
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const port = 8885;
const baseUrl = `http://127.0.0.1:${port}/`;
const OUT = ".tmp-video";
const TARGET_MINUTE = Math.max(5, Number(process.argv[2]) || 30);

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

async function closeModalIfAny(page) {
  // ⚠ 必须认 `#modal` 的 `hidden` class：`index.html:1486` 的 `div#modal.modal.hidden`
  //   在 CSS 里是 `display` 切换的，只查 `.modal.open/.show` 会漏 ⇒ 遮罩继续挡住
  //   `#btn-play-match`（实测报 `#modal ... intercepts pointer events` 卡 57 次重试）。
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

/** 进比赛界面（照抄 mobile 探针的可靠路径：不干预 SW、轮询 vcfmMainApi）。 */
async function enterMatch(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: false,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("   [pageerror]", String(e).slice(0, 200)));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    ready = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
    if (!ready) await page.waitForTimeout(1000);
  }
  assert.ok(ready, "首屏未就绪：window.vcfmMainApi 未出现");

  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 90_000 });
  await page.locator("#btn-advance-matchday").click();
  let kicked = false;
  for (let i = 0; i < 360 && !kicked; i++) {
    await page.waitForTimeout(2000);
    await closeModalIfAny(page);
    const st = await page.evaluate(() => {
      const b = document.querySelector("#btn-play-match");
      return { disabled: b ? b.disabled : null, toast: document.querySelector("#toast")?.textContent || "" };
    });
    kicked = st.disabled === false;
    if (i % 30 === 0) console.log("  [推进]", i * 2, "s", JSON.stringify(st));
  }
  assert.ok(kicked, "推进到比赛日后仍无「进入比赛」可点");
  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  // 快速高光：走真帧但跳过平淡段，配合 ×4 能在几分钟内跑完大半个上半场
  await page.locator("#btn-sim-fast").click();
  await page.waitForSelector("#mp-camera", { state: "attached", timeout: 60_000 });
  await page.waitForTimeout(1500);
  return { page, context };
}

console.log(`\n=== 画面层运动诊断（目标 ${TARGET_MINUTE} 分钟）===`);
const t0 = Date.now();
let browser;
try {
  mkdirSync(OUT, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const { page, context } = await enterMatch(browser);

  // ×4 倍速
  const speed = await page.evaluate(() => {
    const b = document.querySelector('[data-match-speed="4"]');
    if (!b) return null;
    b.click();
    return b.textContent;
  });
  console.log("  倍速键:", speed);

  // 跑到目标分钟（或超时）
  // ⚠ **必须处理中场**：比赛在 45' 会停下等用户确认中场调整，
  //   实测不处理就会永远停在「已跑 45'」（第一版跑了 9 分钟没动静）。
  //   用 `#btn-ht-skip`（「不调整，直接踢」）跳过，避免引入任何战术改动。
  const deadline = Date.now() + 14 * 60 * 1000;
  let minute = 0;
  let htHandled = false;
  let lastLogged = -1;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const ht = await page.evaluate(() => {
      const panel = document.querySelector("#match-ht-panel");
      const visible = !!panel && !panel.classList.contains("hidden")
        && getComputedStyle(panel).display !== "none";
      if (visible) {
        const skip = document.querySelector("#btn-ht-skip");
        if (skip) { skip.click(); return true; }
      }
      return false;
    });
    if (ht) {
      htHandled = true;
      console.log("  [中场] 已点「不调整，直接踢」");
      await page.waitForTimeout(1500);
      continue;
    }
    await closeModalIfAny(page);
    const st = await page.evaluate(() => {
      const clock = document.querySelector(".fm-sb-clock")?.textContent || "";
      const m = clock.match(/(\d+)/);
      return { clock, minute: m ? Number(m[1]) : 0 };
    });
    minute = st.minute;
    if (minute !== lastLogged && minute % 5 === 0) {
      console.log(`  已跑 ${st.clock}`);
      lastLogged = minute;
    }
    if (minute >= TARGET_MINUTE) break;
  }
  console.log(`  中场是否处理过：${htHandled ? "是" : "否（可能没跑到 45'）"}`);

  // 读画面层诊断
  // 🔴 读**全场累计**而不是滚动窗口：
  //   `status().frames` / `.incidents` / `.severe` 都是**最近 12 秒窗口**里的量
  //   （`_trimFrames` 按时间窗裁），只有 **`totalIncidents`（= history 长度）**
  //   是本场累计。第一版读了 `incidents` ⇒ 报「0 事件」，
  //   那其实只是「最后 12 秒没有事件」，**完全不可信**。
  //   （App 的徽章读窗口值是**对的** —— 它表示「现在按下去能导出几个标记」，
  //     tooltip 里另外补累计数，见 `js/main.js:1247` 的注释。别去"修"它。）
  const status = await page.evaluate(() => {
    const mv = window.vcfmMainApi?.matchView;
    if (!mv?.getMotionDiagnosticStatus) return { error: "no matchView" };
    const s = mv.getMotionDiagnosticStatus();
    return {
      totalIncidents: s.totalIncidents, // ← 全场累计（要看的）
      windowFrames: s.frames, // ← 滚动窗口
      windowIncidents: s.incidents, // ← 滚动窗口
      windowSeconds: s.durationSeconds,
      lastIncident: s.lastIncident,
      version: s.version,
    };
  });
  console.log(`\n  已跑 ${minute}'（墙钟 ${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  console.log("  画面层诊断（全场累计 / 窗口）:", JSON.stringify(status, null, 2));

  // 拿片段，看事件明细
  const clip = await page.evaluate(() => {
    const mv = window.vcfmMainApi?.matchView;
    const c = mv?.createMotionClip?.({ reason: "display-probe" });
    if (!c) return null;
    return {
      frames: c.frames?.length || 0,
      incidents: (c.incidents || []).map((i) => ({
        type: i.type,
        severity: i.severity,
        t: i.t,
        entityId: i.entityId,
        team: i.team,
        metres: i.metres ?? i.displacementMetres ?? null,
        speedMps: i.speedMps ?? null,
      })),
    };
  });
  console.log("  片段帧数:", clip?.frames ?? 0, " 事件数:", clip?.incidents?.length ?? 0);
  if (clip?.incidents?.length) {
    const byType = {};
    for (const i of clip.incidents) {
      byType[i.type] = byType[i.type] || { n: 0, max: 0, sample: null };
      byType[i.type].n += 1;
      const m = Number(i.metres) || 0;
      if (m > byType[i.type].max) {
        byType[i.type].max = m;
        byType[i.type].sample = i;
      }
    }
    for (const [type, v] of Object.entries(byType)) {
      console.log(`    ${type}: ${v.n} 次，最大 ${v.max.toFixed(2)}m  ${JSON.stringify(v.sample)}`);
    }
  }

  const n = status?.totalIncidents ?? 0;
  console.log(`\n${n === 0 ? "✅" : "⚠"} 画面层**本场累计**：${n} 个事件（共跑到 ${minute}'）`);
  if (n > 0) {
    console.log("   ⇒ 有事件 ⇒ 这就是「用户看到的瞬移」的候选证据，按上面的类型明细定位。");
  } else {
    console.log("   ⇒ 本场画面层**累计 0 个事件**。");
    console.log("     ⚠ 仍不能断言「不存在」：① 只跑了 1 场；② 快速高光只渲染高光段。");
  }
  await context.close();
} finally {
  await browser?.close();
  server.kill();
}
