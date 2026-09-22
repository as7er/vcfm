/**
 * 沉浸模式浏览器实测（2026-09-22，v284）。
 *
 * 用户诉求：「下面的功能区如果能在不使用的时候选择隐藏会更好吧？」
 * 实现成**点空白球场**切换（不是自动隐藏 —— 那会让 v276 刚做完可发现性的
 * 全屏键再次找不到）。本探针验的就是这条交互：
 *
 * 1. 点空白球场 ⇒ 比分条 / 控球率条 / 控制条都消失，**球场真的变大**；
 * 2. 再点一次 ⇒ 全部恢复，球场回到原尺寸；
 * 3. **点球员不能触发**（那应该开球员卡）—— 这是最容易做错的一处：
 *    `matchview.js` 的 `fieldEl` 点击处理器用 `closest(".mp-grass"/".mp-lines")`
 *    排除了球员热区，另挂监听器会把球员一起吃掉；
 * 4. 卡片开着时点空白 ⇒ **只关卡片**，不切沉浸（否则用户以为点坏了）；
 * 5. 进入时给一次提示（告诉用户怎么回来）—— 可发现性，v276 的教训。
 *
 * ⚠ 只验「球场变大」，不验观感。观感看截图。
 *
 * 用法：node scripts/_match-immersive-probe.mjs
 * ⚠ 需要 Playwright + msedge；约 3 分钟。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const port = 8939;
const baseUrl = `http://127.0.0.1:${port}/`;
const OUT = ".tmp-immersive";
mkdirSync(OUT, { recursive: true });

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
          /关闭|确定|继续|知道了|OK|×/i.test(b.text())
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
 * 只读观测：包 `matchView.setCaption` 记录**所有**字幕调用。
 *
 * 为什么需要：`#mp-caption` 是**全应用共用的唯一字幕槽**，开赛前后
 * 「比赛开始！」「☀️ 晴朗」「球场太小？点全屏键」会连续抢占它。
 * 只读某一瞬的 `textContent` 会得到「提示没出现」的假象 ——
 * 而代码其实设过（实测同一轮里 900ms 采样命中、后续轮询却miss）。
 * 记录调用序列才是「提示到底有没有被设过」的确定性判据。
 */
const INSTALL_HOOK = () => {
  // ⚠ 幂等：Service Worker 首次接管时 `index.html` 会**自动刷新一次页面**
  //   （`vcfm-sw-reloaded-vN` 那条），首屏装的钩子会被冲掉 ⇒ 必须在
  //   「已经进到比赛界面」之后再装一次，并且不能把已记录的数据清掉。
  if (!window.__cap) window.__cap = { calls: [] };
  if (!window.__capReset) {
    window.__capReset = () => {
      window.__cap.calls = [];
    };
  }
  setInterval(() => {
    const mv = window.vcfmMainApi?.matchView;
    if (!mv || mv.__capHooked) return;
    mv.__capHooked = true;
    const orig = mv.setCaption.bind(mv);
    mv.setCaption = function patched(text, kind, ms) {
      try {
        if (text) window.__cap.calls.push(String(text));
      } catch {
        /* 观测失败绝不能影响播放 */
      }
      return orig(text, kind, ms);
    };
  }, 200);
};

const MEASURE = () => {
  const vis = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      shown: cs.display !== "none" && cs.visibility !== "hidden" && r.height > 0,
      h: +r.height.toFixed(1),
    };
  };
  const cam = document.querySelector(".mp-camera");
  const camR = cam?.getBoundingClientRect();
  const field = document.querySelector(".mp-field");
  const sbR = document.querySelector(".fmm-scoreboard")?.getBoundingClientRect();
  const barR = document.querySelector(".fmm-match-bar")?.getBoundingClientRect();
  const dockR = document.querySelector(".mp-fmm-dock")?.getBoundingClientRect();
  const ov = (a, b) =>
    a && b ? Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
  const layout = document.querySelector(".match-layout");
  return {
    immersive: !!layout?.classList.contains("mp-immersive"),
    scoreboard: vis(".fmm-scoreboard"),
    bar: vis(".fmm-match-bar"),
    dock: vis(".mp-fmm-dock"),
    cameraH: camR ? +camR.height.toFixed(1) : 0,
    // ⚠ 比较「回到基线」要用**布局盒**（clientHeight），不能用相机 rect ——
    //   相机带 `scale(1.28)` 预设，rect 会被镜头动画带着变（实测退出沉浸后
    //   900ms 读到 202.2 vs 基线 188.5，看着像没恢复，其实只是镜头还没落位）。
    fieldBoxH: field?.clientHeight ?? 0,
    cameraBoxH: cam?.clientHeight ?? 0,
    visiblePitch: camR
      ? +(camR.height - ov(sbR, camR) - ov(dockR, camR) - ov(barR, camR)).toFixed(1)
      : 0,
    caption: document.querySelector("#mp-caption")?.textContent?.trim() || "",
    scrollY: document.scrollingElement.scrollHeight - window.innerHeight,
    scrollX: document.scrollingElement.scrollWidth - window.innerWidth,
  };
};

/**
 * 找一块真正「空白」的点：既远离球员热区，也**不落在任何浮层上**。
 *
 * ⚠ 第一版只避开了球员，于是 800×295 下取到 (412, 29) —— 那正落在
 * 比分条浮层里（比分条 y=2.4..40.5，`position: absolute`），
 * 点击被浮层吃掉，探针报「点不动」。**是探针取点错了，不是功能坏了。**
 */
const findEmptyPitchPoint = () => {
  const field = document.querySelector(".mp-field");
  if (!field) return null;
  const fr = field.getBoundingClientRect();
  const players = [...document.querySelectorAll(".mp-actors .mp-player")].map((p) =>
    p.getBoundingClientRect()
  );
  const overlays = [".fmm-scoreboard", ".fmm-match-bar", ".mp-fmm-dock", ".mp-banner", ".mp-caption"]
    .map((s) => document.querySelector(s)?.getBoundingClientRect())
    .filter(Boolean);
  const hitOverlay = (x, y) =>
    overlays.some((o) => x >= o.left && x <= o.right && y >= o.top && y <= o.bottom);
  // ⚠ 容差要**自适应**：800×295 下球场只有 ~290×211，22 名球员铺开，
  //   固定 22px 的净空在粗网格上找不到点（第一版就这么空手而归）。
  //   从宽到严试三档，取第一个可行解；再不行就取「离最近球员最远」的那个点。
  for (const clear of [22, 16, 12]) {
    let best = null;
    let bestDist = -1;
    for (let gy = 0.06; gy <= 0.94; gy += 0.025) {
      for (let gx = 0.06; gx <= 0.94; gx += 0.025) {
        const x = fr.left + fr.width * gx;
        const y = fr.top + fr.height * gy;
        if (x < 3 || y < 3 || x > window.innerWidth - 3 || y > window.innerHeight - 3) continue;
        if (hitOverlay(x, y)) continue;
        let minDist = Infinity;
        for (const p of players) {
          const dx = Math.max(p.left - x, 0, x - p.right);
          const dy = Math.max(p.top - y, 0, y - p.bottom);
          minDist = Math.min(minDist, Math.hypot(dx, dy));
        }
        // 复核：这一点**真的**落在球场的空白层上（不是球员热区、不是浮层）
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit.closest?.(".mp-player")) continue;
        if (!(hit.id === "mp-field" || hit.closest?.(".mp-grass") || hit.closest?.(".mp-lines"))) {
          continue;
        }
        if (minDist >= clear) return { x: Math.round(x), y: Math.round(y), clear: +minDist.toFixed(1) };
        if (minDist > bestDist) {
          bestDist = minDist;
          best = { x: Math.round(x), y: Math.round(y), clear: +bestDist.toFixed(1) };
        }
      }
    }
    if (clear === 12) return best;
  }
  return null;
};

let browser;
let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
};

try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });

  for (const vp of [
    { label: "800x295", width: 800, height: 295, touch: true },
    { label: "1440x1000", width: 1440, height: 1000, touch: false },
  ]) {
    console.log(`\n=== ${vp.label}（touch=${vp.touch}）===`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
    let ready = false;
    for (let i = 0; i < 90 && !ready; i += 1) {
      ready = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
      if (!ready) await page.waitForTimeout(1000);
    }
    assert.ok(ready, "首屏未就绪");
    await page.evaluate(INSTALL_HOOK);
    await page.fill("#input-manager", "Immersive Probe");
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
    await page.waitForTimeout(3000);

    const base = await page.evaluate(MEASURE);
    console.log(`  基线: 比分条 ${base.scoreboard?.h} · 控制条 ${base.bar?.h} · 控球条 ${base.dock?.h}`);
    console.log(`        相机高 ${base.cameraH} · **可见球场 ${base.visiblePitch}**`);

    // ── 1. 点空白球场 ⇒ 进入沉浸 ─────────────────────────────────────
    const pt = await page.evaluate(findEmptyPitchPoint);
    check(!!pt, "找到一个可点的球场空白点（前置条件）", pt ? `净空 ${pt.clear ?? "?"}px` : "没找到");
    if (!pt) throw new Error("找不到可点的空白点，后续用例无法进行");
    console.log(`  点空白点 (${pt.x}, ${pt.y})`);
    await page.evaluate(INSTALL_HOOK); // 再装一次：SW 那次自动刷新已经把首屏的钩子冲掉了
    await page.evaluate(() => window.__capReset());
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(900);
    const imm = await page.evaluate(MEASURE);
    await page.screenshot({ path: join(OUT, `immersive-${vp.label}.png`) });
    check(imm.immersive, "点空白球场进入沉浸模式");
    check(!imm.scoreboard?.shown, "比分条已隐藏");
    check(!imm.bar?.shown, "控制条已隐藏");
    check(!imm.dock?.shown, "控球率条已隐藏");
    check(
      imm.visiblePitch > base.visiblePitch + 20,
      "可见球场**真的变大**（不是只藏了东西）",
      `${base.visiblePitch} → ${imm.visiblePitch}（+${(imm.visiblePitch - base.visiblePitch).toFixed(1)}）`
    );
    // 提示判据用**调用记录**而不是某一瞬的 textContent：
    // `#mp-caption` 是全局唯一字幕槽，开赛前后「比赛开始！」「☀️ 晴朗」会抢占它，
    // 只看瞬时值会把「设过但被顶掉」读成「没设」（实测同一轮里 900ms 采样命中、
    // 随后的轮询全 miss）。`toggleMatchImmersive` 也因此在 1.5s 后再确认一次。
    await page.waitForTimeout(1800);
    const capCalls = await page.evaluate(() => window.__cap.calls.slice());
    const hintCall = capCalls.find((t) => /沉浸模式|Immersive view/.test(t));
    check(!!hintCall, "进入时设过「怎么回来」的提示", hintCall || `记录到 ${capCalls.length} 条字幕，无提示`);
    console.log(`  字幕调用序列: ${JSON.stringify(capCalls.slice(0, 6))}`);
    check(imm.scrollY <= 0 && imm.scrollX <= 0, "沉浸后仍无滚动溢出", `X=${imm.scrollX} Y=${imm.scrollY}`);

    // ── 2. 再点一次 ⇒ 恢复 ──────────────────────────────────────────
    // ⚠ 每次点击前**重新取点**：球员一直在动，几秒前的空白点可能已经站了人
    //   （实测第 4 步就踩到了 —— 点在了球员身上，`stopPropagation` 让
    //   球场处理器根本没跑，卡片没关掉，看起来像功能坏了）。
    const pt2 = await page.evaluate(findEmptyPitchPoint);
    check(!!pt2, "重新取到空白点（退出沉浸用）");
    await page.mouse.click(pt2.x, pt2.y);
    await page.waitForTimeout(900);
    const back = await page.evaluate(MEASURE);
    check(!back.immersive, "再点一次退出沉浸");
    check(!!back.bar?.shown && !!back.scoreboard?.shown, "控制条与比分条都回来了");
    check(
      back.fieldBoxH === base.fieldBoxH,
      "球场**布局盒**回到基线（用 clientHeight，不受镜头动画影响）",
      `${base.fieldBoxH} → ${back.fieldBoxH}`
    );

    // ── 3. 点球员**不能**触发沉浸（那应该开球员卡） ──────────────────
    // ⚠ 必须挑一个**不被浮层盖住**的热区：比分条是 `position:absolute; z-index:30`
    //   的浮层，站在它下面的球员点不到（这一条本身也是实测发现的既有行为）。
    //   第一版直接取 DOM 里第一个 `.mp-player`，正好在浮层下 ⇒ 点击落空，
    //   于是「点球员」这一下什么也没发生，探针误判成代码有问题。
    // ⚠ 找到**并验证**：`getBoundingClientRect` 说有热区，不等于那个点真能点到。
    //   第一版只按 rect 取点，`elementFromPoint` 实测返回 `.mp-pitch-slot`
    //   （沉浸开关切回来时球场尺寸变了，热区的屏幕位置还在旧布局上）。
    //   ⇒ 必须用 `elementFromPoint` 复核，且允许重试（球员在动）。
    let playerPt = null;
    for (let attempt = 0; attempt < 6 && !playerPt; attempt += 1) {
      playerPt = await page.evaluate(() => {
        const overlays = [".fmm-scoreboard", ".fmm-match-bar", ".mp-fmm-dock"]
          .map((s) => document.querySelector(s)?.getBoundingClientRect())
          .filter(Boolean);
        for (const p of document.querySelectorAll(".mp-actors .mp-player")) {
          const r = p.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          const x = Math.round(r.left + r.width / 2);
          const y = Math.round(r.top + r.height / 2);
          if (x < 2 || y < 2 || x > window.innerWidth - 2 || y > window.innerHeight - 2) continue;
          if (overlays.some((o) => x >= o.left && x <= o.right && y >= o.top && y <= o.bottom)) {
            continue;
          }
          // 复核：这一点**真的**落在某个球员热区上
          const hit = document.elementFromPoint(x, y);
          if (!hit?.closest?.(".mp-player")) continue;
          return { x, y };
        }
        return null;
      });
      if (!playerPt) await page.waitForTimeout(500);
    }
    check(!!playerPt, "找到一个**复核过**、确实点得到的球员热区（前置条件）");
    if (playerPt) {
      // 诊断：点击点上**实际**是谁在接事件。只报「卡片没开」无法区分
      // 「热区没接住」与「接了但卡片没渲染」，会把探针问题写成产品问题。
      const hitBefore = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          if (!el) return "(null)";
          return `${el.tagName.toLowerCase()}#${el.id || ""}.${[...el.classList].slice(0, 3).join(".")}`;
        },
        playerPt
      );
      await page.mouse.click(playerPt.x, playerPt.y);
      await page.waitForTimeout(800);
      const afterPlayer = await page.evaluate(MEASURE);
      check(!afterPlayer.immersive, "点球员**没有**误触沉浸模式（球员热区被正确排除）");
      const cardOpen = await page.evaluate(
        () => !document.querySelector("#mp-card")?.classList.contains("hidden")
      );
      check(cardOpen, "点球员打开了场内球员卡（后续用例的前置）", `点击点上是 ${hitBefore}`);
      // 点球员还会弹**完整资料弹窗**（`main.js` 的 `onPlayerClick` → `showPlayerModal`），
      // 它是全屏遮罩，不关掉的话第 4 步的点击会落在遮罩上而不是球场。
      await closeModalIfAny(page);
      await page.waitForTimeout(300);
      // 4. 卡片开着时点空白 ⇒ 只关卡片，不切沉浸
      if (cardOpen) {
        const pt4 = await page.evaluate(findEmptyPitchPoint);
        check(!!pt4, "重新取到空白点（关卡片用）");
        await page.mouse.click(pt4.x, pt4.y);
        await page.waitForTimeout(800);
        const afterClose = await page.evaluate(MEASURE);
        const cardStillOpen = await page.evaluate(
          () => !document.querySelector("#mp-card")?.classList.contains("hidden")
        );
        check(!cardStillOpen, "卡片已被关掉");
        check(
          !afterClose.immersive,
          "卡片开着时点空白**只关卡片**，不切沉浸模式",
          `immersive=${afterClose.immersive}`
        );
      }
    }

    console.log(`  pageerror: ${errors.length}`);
    check(errors.length === 0, "无 pageerror", errors.slice(0, 2).join(" | "));
    await context.close();
  }
} catch (err) {
  failed += 1;
  console.error("\n探针异常:", err?.stack || err);
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(`\n_match-immersive-probe: ${failed ? `${failed} 项失败` : "ok"}`);
console.log(`截图：${OUT}/`);
process.exit(failed ? 1 : 0);
