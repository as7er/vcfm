/**
 * 「重开直播提示」浏览器级验证（2026-09-22，v281）
 *
 * ## 为什么必须有这一层
 *
 * `scripts/reopened-match-notice-audit.mjs` 是**静态**审计（读源码断言 + 变异测试）——
 * 它能证明「代码写成了那样」，**不能证明「弹窗真的会出现」**。
 *
 * 🔴 本仓库有一个血例：进场动画第一版用纯 CSS 做，单元测试 17/17、`node --check`、
 * 缓存审计全过，**但浏览器里画面上什么都没发生**（见 AGENTS.md ③）。
 * 所以任何「必须让用户看见」的东西，都要用真实 Chromium 验一次。
 *
 * ## 验的是用户那条路（而不是「调一下函数看它返不返回」）
 *
 * 1. 新游戏 → 推进到比赛日 → 进比赛 → 点直播，播 ~25 秒（让 `setMatchMinute` 记下进度）
 * 2. 断言 `sessionStorage` 里有 `vcfm-match-progress` 且 `minute >= 1`
 * 3. **刷新页面（F5）** —— 这正是用户走的路（sessionStorage 仍在）
 * 4. 回到比赛日 → 再点「进入比赛」
 * 5. 断言 `#modal` **可见**、文案里含那个分钟数、按钮都在（v282 起含真正的
 *    续播按钮 `#btn-reopened-match-resume`）
 * 6. 反面对照：点「从头重看」应关掉弹窗
 *
 * ⚠ 本检查**不**验续播本身跑得对不对（那要真播一段，见
 *   `scripts/_match-resume-probe.mjs` / `npm run test:resume-browser`）。
 *
 * 用法：node scripts/reopened-match-notice-browser-check.mjs
 * ⚠ 需要 Playwright + msedge；约 3~5 分钟（含联赛开局）。
 * ⚠ 不重定向 stdout 会被宿主杀 ⇒ 调用方一律 `cmd /c "... > log 2>&1"`。
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8941;
const baseUrl = `http://127.0.0.1:${port}/`;

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

/** 等到「进入比赛」可点（必要时推进比赛日） */
async function reachMatchDay(page, tries = 360) {
  for (let i = 0; i < tries; i += 1) {
    await closeModalIfAny(page);
    const st = await page.evaluate(() => {
      const play = document.querySelector("#btn-play-match");
      const adv = document.querySelector("#btn-advance-matchday");
      return {
        playDisabled: play ? play.disabled : null,
        advExists: !!adv,
        advDisabled: adv ? adv.disabled : null,
      };
    });
    if (st.playDisabled === false) return true;
    if (st.advExists && st.advDisabled === false) {
      await page.locator("#btn-advance-matchday").click().catch(() => {});
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

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

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
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
  console.log("  [1/6] 首屏就绪");

  await page.fill("#input-manager", "Reopen Notice");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  console.log("  [2/6] 主界面");

  assert.ok(await reachMatchDay(page), "推进到比赛日后仍无「进入比赛」可点");
  console.log("  [3/6] 已到比赛日");

  // 清掉可能残留的进度，保证起点干净
  await page.evaluate(() => sessionStorage.removeItem("vcfm-match-progress"));

  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  await page.waitForTimeout(1200);
  await page.click("#btn-sim-live", { timeout: 30_000 });
  console.log("  [4/6] 直播已开始，播 25 秒以记录进度…");

  // 等到进度真的被记下来（每 1 秒看一次，最多 60 秒）
  let rec = null;
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(1000);
    rec = await page.evaluate(() => {
      try {
        return JSON.parse(sessionStorage.getItem("vcfm-match-progress") || "null");
      } catch {
        return null;
      }
    });
    if (rec && Number(rec.minute) >= 1) break;
  }
  assert.ok(rec && Number(rec.minute) >= 1, `直播中未记下进度：${JSON.stringify(rec)}`);
  console.log(`      ✓ 进度已记录：minute=${rec.minute}`);

  // ── 刷新（用户走的那条路）────────────────────────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  let backReady = false;
  for (let i = 0; i < 90 && !backReady; i += 1) {
    backReady = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
    if (!backReady) await page.waitForTimeout(1000);
  }
  assert.ok(backReady, "刷新后 window.vcfmMainApi 未就绪");
  const recAfter = await page.evaluate(() => {
    try {
      return JSON.parse(sessionStorage.getItem("vcfm-match-progress") || "null");
    } catch {
      return null;
    }
  });
  assert.ok(recAfter && recAfter.minute === rec.minute, "刷新后进度丢失（sessionStorage 应存活）");
  console.log("  [5/6] 已刷新；进度仍在");

  // 回到主界面（tryAutoResume 会读档）+ 进比赛日
  for (let i = 0; i < 90; i += 1) {
    const onMain = await page.evaluate(
      () => !!document.querySelector("#screen-main.active")
    );
    if (onMain) break;
    await page.waitForTimeout(1000);
  }
  assert.ok(await reachMatchDay(page), "刷新后没能回到比赛日");
  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  await page.waitForTimeout(1500);

  // ── 断言：弹窗真的出现了 ──────────────────────────────────────────────────
  const modal = await page.evaluate(() => {
    const m = document.querySelector("#modal");
    if (!m) return { present: false };
    const cs = getComputedStyle(m);
    return {
      present: true,
      hiddenClass: m.classList.contains("hidden"),
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      text: (m.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400),
      visible: !m.classList.contains("hidden") && cs.display !== "none" && cs.visibility !== "hidden",
    };
  });
  console.log(`  [6/6] 弹窗状态：${JSON.stringify({ ...modal, text: "…" })}`);
  assert.ok(modal.visible, `重开时弹窗**没有出现**（${JSON.stringify(modal)}）`);
  assert.ok(
    modal.text.includes(String(rec.minute)),
    `弹窗文案里没有报出分钟数 ${rec.minute}：${modal.text}`
  );

  const btns = await page.evaluate(() =>
    [...document.querySelectorAll("#modal button")].map((b) => ({
      id: b.id,
      text: (b.textContent || "").trim(),
      visible: getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0,
    }))
  );
  console.log(`      按钮：${JSON.stringify(btns)}`);
  assert.ok(btns.length >= 2, `弹窗按钮少于 2 个：${JSON.stringify(btns)}`);
  assert.ok(
    btns.every((b) => b.visible),
    `有按钮不可见（CSS 坑）：${JSON.stringify(btns)}`
  );
  // ⚠ v281 这里断言的是「不得出现未实现的续播承诺」（当时续播没做）。
  //   v282 的 ④-B **把续播实现了** ⇒ 前提变了，断言改成**钉住那个真按钮**：
  //   续播入口必须就是 `#btn-reopened-match-resume`（而不是另造一个措辞相近的假按钮）。
  const resumeBtn = btns.find((b) => b.id === "btn-reopened-match-resume");
  assert.ok(resumeBtn, `弹窗里没有真正的续播按钮 #btn-reopened-match-resume：${JSON.stringify(btns)}`);
  assert.ok(resumeBtn.visible, `续播按钮不可见：${JSON.stringify(resumeBtn)}`);
  // 仍不得出现**别的**未实现措辞（如「继续观看」——本项目没有这个词的入口）。
  assert.ok(
    !btns.some((b) => b.id !== "btn-reopened-match-resume" && /继续观看|继续直播/i.test(b.text)),
    `弹窗给了未实现的续播承诺：${JSON.stringify(btns)}`
  );

  // 反面对照：点「从头重看」应关掉弹窗
  const restartBtn = btns.find((b) => /从头重看|Replay/i.test(b.text));
  assert.ok(restartBtn?.id, "找不到「从头重看」按钮的 id");
  await page.locator(`#${restartBtn.id}`).click();
  await page.waitForTimeout(500);
  const afterClose = await page.evaluate(
    () =>
      !!document.querySelector("#modal")?.classList.contains("hidden")
  );
  assert.ok(afterClose, "点「从头重看」之后弹窗没有关闭");

  console.log("\n=== 结论 ===");
  console.log(`  ✓ 进度记录（直播中）→ 刷新后仍在 → 重开比赛时弹窗出现并报出 ${rec.minute}′`);
  console.log("  ✓ 两个按钮都可见、且没有承诺未实现的续播");
  console.log("  ✓ 点「从头重看」关闭弹窗");
  console.log(`  页面错误 ${errors.length} 条`);
  for (const e of errors.slice(0, 6)) console.log(`    ${e}`);
  exitCode = 0;
} catch (e) {
  console.error("\n验证失败：", e && e.stack ? e.stack : e);
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
