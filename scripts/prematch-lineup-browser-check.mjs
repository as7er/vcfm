/**
 * 「双方预计首发」赛前预览的浏览器级验证（2026-09-22）。
 *
 * ## 为什么必须有这一层
 *
 * `scripts/prematch-lineup-audit.mjs` 是**静态**审计（读源码断言 + 变异测试）——
 * 它能证明「代码写成了那样」，**不能证明「画面上真有那 22 行、讲话还摸得到」**。
 * 本仓有血例：进场动画第一版纯 CSS，单测 17/17 全绿，浏览器里画面上什么都没发生
 * （AGENTS.md ③）。而且这里改的正是「面板可滚高度只有 106px」那种挤出来的布局。
 *
 * ## 验的是用户那条路
 *
 * 新游戏 → 推进比赛日 → 点「进入比赛」→ 到赛前界面，然后**真量几何**：
 *
 * · **800×295（手机横屏，pointer: coarse ⇒ 走横屏那一整套媒体查询）**
 *   ⓑ `<details class="brief-lineups">` 默认**折叠**（`open === false`）；
 *   ⓐ 讲话 radio 的**可点性不受影响**：
 *     - **A/B 逐像素**：把整个 `<details>` 从 DOM 里摘掉再量一次，**讲话 radio** 的
 *       `getBoundingClientRect()` 必须**一模一样**（0 px 位移）。这是本轮唯一能
 *       真正控制的量 —— 首发块在 DOM 里排在讲话**之后**，摘掉它讲话不能动。
 *       🔴 实测（v286 基线，改前）：800×295 下第一个 radio 在 y=494.5，而面板可视
 *       矩形是 y=2.4..108.6 ⇒ **改前就需要在面板内滚动约 389px** 才够得着。
 *       所以「无需滚动就在可视区内」这条**在改前就是假的**，不能拿它当验收（详见
 *       `docs/measurements/` 归档 + 本文件的 `radioInsidePanelByDefault` 读数）。
 *     - **可达性**：面板内滚动后，radio 的 rect 必须落在面板可视矩形内（证明必填
 *       交互没被锁死）；展开 `details` 之后必须**仍然**可达。
 *   ⓓ 展开后 details 里能读到 22 个姓名，且**与球场上 22 个人的姓氏一致**
 *     （球场 `.mp-name` 与本块同用 `playerDisplaySurname`，这是「同一事实」的交叉校验）。
 *
 * · **1440×1000（桌面，pointer: fine）**：`details.open === true`、22 个姓名都在、
 *   面板**没有横向溢出**（`scrollWidth <= clientWidth + 1`）。
 *
 * ## 球场高度：为什么是「有界」而不是「0」
 *
 * 桌面的 `.match-pre-brief` 是 grid 第 2 行（`auto`）且 `max-height: min(56vh, 520px)`
 * ——面板自己内滚。所以首发块**只**在「赛前简报本身还没顶到限高」时才影响球场行：
 *   占用 = min(首发块高度, 520 − 简报高度)，且**简报只要 ≥ 限高就是 0**。
 * ⇒ 判据写成 **|Δ| ≤ 8px**（符号会翻：「带首发块」比「摘掉」矮 ⇒ 值 < 0）。
 *   三次实测（同一台机器，不同抽样的俱乐部/赛程）：
 *   · 1440×1000：简报 515（限高 520）⇒ |Δ| = **4.83px**；
 *   · 1440×1000：简报 553（已 ≥ 限高）⇒ |Δ| = **0**；
 *   · 800×295：限高只有 `min(36vh, 300px)` = 106px，简报 627 ⇒ |Δ| = **0**。
 *   ⚠ 简报高度**随抽样的俱乐部/对手/球探报告浮动**，所以判据必须是「有界」而不是
 *   某个具体值；判据里连「简报高度 / 面板限高」一起打印，便于复核口径。
 * ⚠ 已知残留风险（未处理）：若某场比赛的简报明显变短（球探报告/表格块缺失），
 *   占用会随之变大（上界 = 首发块整块高度 ~291px，仍不会顶破面板的 520 限高）。
 *
 * ⚠ 只验几何与可达性，不验观感（观感看截图）。
 * 用法：node scripts/prematch-lineup-browser-check.mjs（或 npm run test:prematch-lineup-browser）
 * ⚠ 需要 Playwright + msedge；约 4~6 分钟（两个视口各要开一局新游戏）。
 * ⚠ 一次只跑一个浏览器探针：并发会互相干扰（本仓已有约定）。
 * ⚠ 不重定向 stdout 会被宿主杀 ⇒ 调用方一律 `cmd /c "... > log 2>&1"`。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8943;
const baseUrl = `http://127.0.0.1:${port}/`;
/** 截图目录（可选）：设了才写盘，默认不往仓库丢临时产物。 */
const shotDir = process.env.VCFM_SHOT_DIR || "";
const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
});

let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
};

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
      await page.locator("#btn-advance-matchday").click({ timeout: 20_000 }).catch(() => {});
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

/**
 * 量赛前界面的几何。**全部用真实 `getBoundingClientRect`**，不看「元素存在」——
 * 本仓栽过两次：「DOM 里存在 ≠ 点得到/看得见」。
 */
const MEASURE = () => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      x: +b.left.toFixed(2),
      y: +b.top.toFixed(2),
      w: +b.width.toFixed(2),
      h: +b.height.toFixed(2),
      top: +b.top.toFixed(2),
      bottom: +b.bottom.toFixed(2),
      left: +b.left.toFixed(2),
      right: +b.right.toFixed(2),
    };
  };
  const panel = document.querySelector("#match-pre-brief");
  const details = panel ? panel.querySelector("details.brief-lineups") : null;
  const talk = panel ? panel.querySelector(".team-talk-panel") : null;
  const radio = panel ? panel.querySelector('input[name="pre-team-talk"]') : null;
  const rows = details ? [...details.querySelectorAll(".brief-lineup-row")] : [];
  const names = rows.map((x) => (x.querySelector(".ln-name")?.textContent || "").trim()).filter(Boolean);
  const nums = rows.map((x) => (x.querySelector(".ln-num")?.textContent || "").trim()).filter(Boolean);
  const pitchNames = [...document.querySelectorAll(".mp-actors .mp-player .mp-name")]
    .map((n) => (n.textContent || "").trim())
    .filter(Boolean);
  const pr = panel ? panel.getBoundingClientRect() : null;
  const rr = radio ? radio.getBoundingClientRect() : null;
  const inside = (b, p) => !!(b && p && b.top >= p.top - 0.5 && b.bottom <= p.bottom + 0.5);
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    coarse: window.matchMedia("(pointer: coarse)").matches,
    hasPanel: !!panel,
    hasDetails: !!details,
    detailsOpen: details ? details.open : null,
    summaryText: details ? (details.querySelector("summary")?.textContent || "").replace(/\s+/g, " ").trim() : "",
    rowCount: rows.length,
    names,
    numbers: nums,
    inText: details ? rows.filter((x) => (details.textContent || "").includes((x.querySelector(".ln-name")?.textContent || "").trim())).length : 0,
    pitchCount: pitchNames.length,
    pitchNames,
    pitchNamesMissing: [...new Set(pitchNames)].filter((n) => !names.includes(n)),
    panel: r(panel),
    panelScroll: panel
      ? {
          top: +panel.scrollTop.toFixed(1),
          clientH: panel.clientHeight,
          scrollH: panel.scrollHeight,
          clientW: panel.clientWidth,
          scrollW: panel.scrollWidth,
        }
      : null,
    talk: r(talk),
    radio: r(radio),
    radioInsidePanelByDefault: inside(rr, pr),
    radioInsideViewportByDefault: !!(
      rr &&
      rr.top >= -0.5 &&
      rr.bottom <= window.innerHeight + 0.5 &&
      rr.left >= -0.5 &&
      rr.right <= window.innerWidth + 0.5
    ),
    // 面板内还要滚多少 px 才够得着讲话（0 = 无需滚动）
    radioNeedsScrollPx: rr && pr ? +Math.max(0, rr.bottom - pr.bottom).toFixed(1) : null,
    field: r(document.querySelector(".mp-field")),
    actors: document.querySelectorAll(".mp-actors .mp-player").length,
  };
};

/** 把面板内滚动到「讲话第一个 radio 的顶边贴住面板顶边」，然后复核它在不在可视矩形里。 */
const SCROLL_TO_RADIO = () => {
  const panel = document.querySelector("#match-pre-brief");
  const radio = panel ? panel.querySelector('input[name="pre-team-talk"]') : null;
  if (!panel || !radio) return null;
  const before = panel.scrollTop;
  panel.scrollTop += radio.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  const pr = panel.getBoundingClientRect();
  const rr = radio.getBoundingClientRect();
  return {
    scrollBefore: +before.toFixed(1),
    scrollAfter: +panel.scrollTop.toFixed(1),
    inside: rr.top >= pr.top - 0.5 && rr.bottom <= pr.bottom + 0.5,
    radioTop: +rr.top.toFixed(2),
    panelTop: +pr.top.toFixed(2),
    panelBottom: +pr.bottom.toFixed(2),
  };
};

/** A/B：把首发块整个摘出 DOM（留个把手以便复原），再量一次讲话与球场。 */
const DETACH_DETAILS = () => {
  const panel = document.querySelector("#match-pre-brief");
  const details = panel ? panel.querySelector("details.brief-lineups") : null;
  if (!panel || !details) return false;
  window.__lineupsDetached = details;
  details.remove();
  return true;
};
const REATTACH_DETAILS = () => {
  const panel = document.querySelector("#match-pre-brief");
  if (!panel || !window.__lineupsDetached) return false;
  panel.appendChild(window.__lineupsDetached);
  window.__lineupsDetached = null;
  return true;
};

/** 展开/收起首发块（模拟用户点 summary）。 */
const SET_DETAILS_OPEN = (open) => {
  const details = document.querySelector("#match-pre-brief details.brief-lineups");
  if (!details) return null;
  details.open = !!open;
  return details.open;
};

const VIEWPORTS = [
  { label: "800x295", width: 800, height: 295, touch: true, wide: false },
  { label: "1440x1000", width: 1440, height: 1000, touch: false, wide: true },
];

const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

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

  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.label}（touch=${vp.touch}）===`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160));
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
    assert.ok(apiReady, `${vp.label}: 首屏未就绪（window.vcfmMainApi 未出现）`);

    await page.fill("#input-manager", `Lineup Preview ${vp.label}`);
    await page.click("#btn-new-game");
    await page.waitForSelector("#screen-main.active", { timeout: 180_000 });
    assert.ok(await reachMatchDay(page), `${vp.label}: 推进到比赛日后仍无「进入比赛」可点`);
    await closeModalIfAny(page);
    await page.locator("#btn-play-match").click({ timeout: 30_000 });
    await page.waitForSelector("#screen-match.active", { timeout: 120_000 });
    await page.waitForTimeout(2500);

    // ── 基线读数（details 还在、未滚动）────────────────────────────────────
    const m1 = await page.evaluate(MEASURE);
    console.log(`  面板 ${JSON.stringify(m1.panel)} · 滚动 ${JSON.stringify(m1.panelScroll)}`);
    console.log(`  讲话 panel ${JSON.stringify(m1.talk)} · radio ${JSON.stringify(m1.radio)}`);
    console.log(`  球场 field ${JSON.stringify(m1.field)} · actors=${m1.actors}`);
    console.log(
      `  details: 存在=${m1.hasDetails} open=${m1.detailsOpen} 行数=${m1.rowCount} · summary="${m1.summaryText}"`
    );
    console.log(
      `  radio 默认落在面板可视矩形内=${m1.radioInsidePanelByDefault} · 视口内=${m1.radioInsideViewportByDefault}` +
        ` · 还需面板内滚动 ${m1.radioNeedsScrollPx}px`
    );

    // ── ⓑ 默认折叠 / 桌面默认展开 ──────────────────────────────────────────
    check(m1.hasPanel, "赛前简报面板存在");
    check(m1.hasDetails, "面板里有 <details class=\"brief-lineups\">（首发预览已接入）");
    // ⚠ `vp.wide` 就是「桌面宽屏」⇒ 期望值 **等于** `wide`（不是取反）：桌面 open=true、
    //   手机横屏 open=false。写成 `!vp.wide` 会把产品行为判反（首版就这么写错过一次）。
    check(
      m1.detailsOpen === vp.wide,
      `details.open === ${vp.wide}（桌面展开 / 手机横屏折叠）`,
      `实测 ${m1.detailsOpen}`
    );
    check(
      /预计|Projected/.test(m1.summaryText),
      "summary 用了「预计 / Projected」口径（不给确定语气）",
      m1.summaryText
    );

    // ── ⓓ 22 个姓名 ───────────────────────────────────────────────────────
    check(m1.rowCount === 22, "两列共 22 行（11 + 11）", `实测 ${m1.rowCount}`);
    check(m1.names.length === 22, "22 个姓氏都渲染进 DOM", `实测 ${m1.names.length}`);
    check(m1.pitchCount === 22, "球场上有 22 个球员热区（交叉校验的前置条件）", `实测 ${m1.pitchCount}`);
    check(
      m1.pitchNamesMissing.length === 0,
      "球场上 22 个人的姓氏**全部**出现在首发预览里（同一份数据）",
      m1.pitchNamesMissing.length ? `缺：${m1.pitchNamesMissing.join("、")}` : `例：${m1.names.slice(0, 3).join(" / ")}`
    );
    check(m1.inText === 22, "22 个姓氏都在 details 的文本里（可被读屏/搜索读到）", `实测 ${m1.inText}`);

    // ── 版面未被撑破 ──────────────────────────────────────────────────────
    check(
      !m1.panelScroll || m1.panelScroll.scrollW <= m1.panelScroll.clientW + 1,
      "面板没有横向溢出（scrollWidth ≤ clientWidth + 1）",
      m1.panelScroll ? `${m1.panelScroll.scrollW} vs ${m1.panelScroll.clientW}` : "无面板"
    );

    // ── ⓐ A/B：摘掉首发块，讲话与球场必须 0 位移 ──────────────────────────
    check(await page.evaluate(DETACH_DETAILS), "A/B：把首发块整个摘出 DOM");
    await page.waitForTimeout(200);
    const m2 = await page.evaluate(MEASURE);
    check(await page.evaluate(REATTACH_DETAILS), "A/B：把首发块放回（appendChild 复原）");
    await page.waitForTimeout(200);
    const m3 = await page.evaluate(MEASURE);
    const radioDelta =
      m1.radio && m2.radio ? { dx: +(m2.radio.x - m1.radio.x).toFixed(2), dy: +(m2.radio.y - m1.radio.y).toFixed(2) } : null;
    // 球场高度：**有界**而不是 0（口径见文件头「球场高度」一节）。
    // `pitchCost` 的**符号会翻**：简报 < 限高时「带首发块」的面板更矮（值 < 0）。
    // ⇒ 判据取**绝对值** |Δ| ≤ 8px（8px 是本轮三次实测标定的，见文件头）。
    const fieldDelta =
      m1.field && m2.field
        ? {
            dy: +(m2.field.y - m1.field.y).toFixed(2),
            dh: +(m2.field.h - m1.field.h).toFixed(2),
            pitchCost: +(m1.field.h - m2.field.h).toFixed(2),
          }
        : null;
    const briefOnlyH = m2.panelScroll ? m2.panelScroll.scrollH : null;
    const capH = m1.panel ? +m1.panel.h.toFixed(1) : null;
    console.log(
      `  A/B（摘掉首发块）：讲话 radio Δ=${JSON.stringify(radioDelta)} · 球场 Δ=${JSON.stringify(fieldDelta)}` +
        ` · 简报高度 ${briefOnlyH} / 面板限高 ${capH}（差 ${briefOnlyH != null && capH != null ? +(capH - briefOnlyH).toFixed(1) : "?"}）`
    );
    check(
      !!radioDelta && near(radioDelta.dx, 0) && near(radioDelta.dy, 0),
      "**摘掉首发块后讲话 radio 位移 0px**（必填交互一像素都没被推远）",
      `Δ=${JSON.stringify(radioDelta)}`
    );
    check(
      !!fieldDelta && Math.abs(fieldDelta.pitchCost) <= 8,
      "带/不带首发块，球场高度 |Δ| ≤ 8px（面板限高内滚，不是把球场顶下去）",
      fieldDelta
        ? `Δ=${fieldDelta.pitchCost}px（带首发块 ${m1.field.h} / 摘掉 ${m2.field.h}；简报 ${briefOnlyH} vs 限高 ${capH}）`
        : "无 field"
    );
    check(
      !!m3.radio && !!m1.radio && near(m3.radio.y, m1.radio.y) && near(m3.field.y, m1.field.y),
      "放回之后几何复原（A/B 没有把页面留在被改坏的状态）",
      m3.radio ? `radio.y ${m1.radio.y} → ${m3.radio.y}` : "无 radio"
    );

    // ── ⓐ/ⓒ 面板内滚动可达（折叠时 / 展开后都要可达）──────────────────────
    await page.evaluate(() => {
      const p = document.querySelector("#match-pre-brief");
      if (p) p.scrollTop = 0;
    });
    await page.waitForTimeout(120);
    const collapsedReach = await page.evaluate(SCROLL_TO_RADIO);
    check(
      !!collapsedReach && collapsedReach.inside,
      "折叠状态下：面板内滚动后讲话 radio 落在面板可视矩形内（必填交互可达）",
      collapsedReach ? `scrollTop ${collapsedReach.scrollBefore}→${collapsedReach.scrollAfter}，radio ${collapsedReach.radioTop} ∈ [${collapsedReach.panelTop}, ${collapsedReach.panelBottom}]` : "无 radio"
    );

    // 展开（手机模拟用户点 summary；桌面本来就是展开的）
    const opened = await page.evaluate(SET_DETAILS_OPEN, true);
    await page.waitForTimeout(250);
    const mExpanded = await page.evaluate(MEASURE);
    console.log(
      `  展开后：open=${opened} 行数=${mExpanded.rowCount} · 面板滚动 ${JSON.stringify(mExpanded.panelScroll)}`
    );
    check(opened === true, "展开首发块（details.open = true）");
    check(
      mExpanded.rowCount === 22 && mExpanded.inText === 22,
      "展开后 22 行 / 22 个姓名仍在（展开不会把内容冲掉）",
      `行 ${mExpanded.rowCount} · 文本 ${mExpanded.inText}`
    );
    check(
      !mExpanded.panelScroll || mExpanded.panelScroll.scrollW <= mExpanded.panelScroll.clientW + 1,
      "展开后面板仍无横向溢出",
      mExpanded.panelScroll ? `${mExpanded.panelScroll.scrollW} vs ${mExpanded.panelScroll.clientW}` : "无面板"
    );
    check(
      !!mExpanded.field && !!m1.field && near(mExpanded.field.y, m1.field.y) && near(mExpanded.field.h, m1.field.h),
      "展开后面板内滚（球场几何不变 ⇒ 没有把球场挤走）",
      mExpanded.field ? `field.y ${m1.field.y} → ${mExpanded.field.y}` : "无 field"
    );

    await page.evaluate(() => {
      const p = document.querySelector("#match-pre-brief");
      if (p) p.scrollTop = 0;
    });
    await page.waitForTimeout(120);
    const expandedReach = await page.evaluate(SCROLL_TO_RADIO);
    check(
      !!expandedReach && expandedReach.inside,
      "**展开后**：讲话 radio 仍可通过面板内滚动到达（展开也不会锁死必填交互）",
      expandedReach ? `scrollTop ${expandedReach.scrollBefore}→${expandedReach.scrollAfter}，radio ${expandedReach.radioTop} ∈ [${expandedReach.panelTop}, ${expandedReach.panelBottom}]` : "无 radio"
    );

    // 展开的内容本身也要够得着（否则手机上这个功能等于没有）
    const contentReach = await page.evaluate(() => {
      const panel = document.querySelector("#match-pre-brief");
      const det = panel ? panel.querySelector("details.brief-lineups") : null;
      if (!panel || !det) return null;
      panel.scrollTop += det.getBoundingClientRect().top - panel.getBoundingClientRect().top;
      const pr = panel.getBoundingClientRect();
      const dr = det.getBoundingClientRect();
      return {
        inside: dr.top >= pr.top - 0.5 && dr.top <= pr.bottom,
        detTop: +dr.top.toFixed(2),
        panelTop: +pr.top.toFixed(2),
        panelBottom: +pr.bottom.toFixed(2),
      };
    });
    check(
      !!contentReach && contentReach.inside,
      "滚到首发块本身（展开内容在手机上也够得着）",
      contentReach ? `details.top ${contentReach.detTop} ∈ [${contentReach.panelTop}, ${contentReach.panelBottom}]` : "无 details"
    );

    // 收尾：把面板滚回顶部，方便截图/后续观察
    // 收尾：把面板滚回顶部（截图是可选的：**设了 `VCFM_SHOT_DIR` 才写盘**，
    // 默认不往仓库里丢文件 —— 仓库不接受会话级的临时产物）。
    await page.evaluate(() => {
      const p = document.querySelector("#match-pre-brief");
      if (p) p.scrollTop = 0;
    });
    if (shotDir) {
      await page.screenshot({ path: `${shotDir}/lineups-${vp.label}.png` }).catch(() => {});
    }

    console.log(`  页面错误 ${errors.length} 条`);
    for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
    check(errors.length === 0, "控制台 / pageerror 无报错", errors[0] || "");

    await context.close();
  }

  console.log(`\n=== 结论 ===`);
  console.log(failed ? `  ✗ ${failed} 项失败` : "  ✓ 全部通过");
  exitCode = failed ? 1 : 0;
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
