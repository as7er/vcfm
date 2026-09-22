/**
 * ④-B「真正的继续看」浏览器实测（2026-09-22，v282）。
 *
 * ## 为什么必须是浏览器
 *
 * `reopened-match-notice-audit.mjs` 只证明「按钮接线了」（静态）。但本仓库有
 * 「单测全绿、画面上什么都没发生」的血例（进场动画：17/17 通过，浏览器里零位移）。
 * 续播的核心承诺是**运行时行为**：「首帧落在续播点附近，而不是 0′」——
 * 静态断言在构造上就证明不了它。
 *
 * ## 量什么
 *
 * 钩 `matchView.playSimTimeline`（只读观测，不碰引擎），记录**第一次真正渲染**
 * 的首帧模拟秒 `frames[0].t`。然后对照：
 *
 * | 组 | 操作 | 首帧 t 期望 |
 * |---|---|---|
 * | A 续播 | 看到 N′ → 刷新 → 弹窗点「从 N′ 接着看」 | ≈ 续播点（差 ≤ 一个段长） |
 * | B 从头 | 刷新 → 弹窗点「从头重看」→ 点直播 | ≈ 0 |
 *
 * 判据（三条都要）：
 *  1. A 的首帧 t 与续播点之差 ≤ 200 模拟秒（一个高光段的量级）；
 *  2. A 的首帧 t **远大于** B（跳过量 > 续播点的一半）—— 自校准，不依赖绝对阈值；
 *  3. 续播后 HUD 分钟 ≥ 续播分钟（**不是**被重置回 0′）。
 *
 * ⚠ 跨半场（续播点在下半场）不在这里测：那会先停在中场面板，需要单独一轮。
 *   本探针只覆盖「同半场内续播」这条主路径。
 *
 * 用法：node scripts/_match-resume-probe.mjs [目标分钟=5]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 8917;
const baseUrl = `http://127.0.0.1:${port}/`;
const TARGET_MINUTE = Math.max(3, Number(process.argv[2]) || 5);
const PROGRESS_KEY = "vcfm-match-progress";

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

/** `#modal` 的显隐是 `hidden` class 切的，只查 `.modal.open/.show` 会漏。 */
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
 * 只读观测：包 `matchView.playSimTimeline`（记录**首帧模拟秒**）与
 * `matchView.setBanner`（记录横幅文案 —— 续播分支会打一条专属横幅，
 * 这是「真的走了续播路径」的直接证据，比只量首帧更硬）。
 * `matchView` 会在 `ensureMatchPitch(remount)` 时重建 ⇒ 用轮询补钩。
 */
const INSTALL_HOOK = () => {
  window.__resume = { firstT: null, calls: [], banners: [], patched: 0 };
  window.__resumeReset = () => {
    window.__resume.firstT = null;
    window.__resume.calls = [];
    window.__resume.banners = [];
  };
  setInterval(() => {
    const mv = window.vcfmMainApi?.matchView;
    if (!mv || mv.__resumeHooked) return;
    mv.__resumeHooked = true;
    const origTimeline = mv.playSimTimeline.bind(mv);
    mv.playSimTimeline = function patched(frames, opts) {
      try {
        if (window.__resume.firstT == null && frames?.length) {
          window.__resume.firstT = frames[0].t;
        }
        window.__resume.calls.push({ t0: frames?.[0]?.t ?? null, n: frames?.length ?? 0 });
      } catch {
        /* 观测失败绝不能影响播放 */
      }
      return origTimeline(frames, opts);
    };
    const origBanner = mv.setBanner?.bind(mv);
    if (origBanner) {
      mv.setBanner = function patchedBanner(msg, kind, ...rest) {
        try {
          if (msg) window.__resume.banners.push(String(msg));
        } catch {
          /* ignore */
        }
        return origBanner(msg, kind, ...rest);
      };
    }
    window.__resume.patched += 1;
  }, 200);
};

const readHud = () => {
  const txt = (sel) => document.querySelector(sel)?.textContent ?? "";
  const m = txt("#match-minute").match(/(\d+)/);
  return {
    minute: m ? Number(m[1]) : 0,
    minuteRaw: txt("#match-minute"),
    home: Number(txt("#match-home-score")) || 0,
    away: Number(txt("#match-away-score")) || 0,
    logLines: document.querySelectorAll("#match-log .event").length,
  };
};

/** 进到比赛界面（照抄已验证路径：不干预 SW、轮询 vcfmMainApi）。 */
async function toMatchScreen(page, { newGame = false } = {}) {
  if (newGame) {
    await page.fill("#input-manager", "Resume Probe");
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
  } else {
    await page.waitForSelector("#screen-main.active", { timeout: 120_000 });
    for (let i = 0; i < 60; i += 1) {
      const ready = await page.evaluate(() => {
        const b = document.querySelector("#btn-play-match");
        return !!b && b.disabled === false;
      });
      if (ready) break;
      await page.waitForTimeout(500);
    }
  }
  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  await page.waitForTimeout(1200);
}

console.log(`\n=== ④-B 续播实测（目标 ${TARGET_MINUTE}′）===`);
let browser;
let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
};

try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300));
  });
  // 资源级失败单独记账：用来判断 `ERR_CONNECTION_REFUSED` 到底是谁在请求。
  page.on("requestfailed", (r) => {
    failedRequests.push(`${r.url().slice(0, 120)} :: ${r.failure()?.errorText || "?"}`);
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
  await page.evaluate(INSTALL_HOOK);

  // ── 阶段 1：新游戏 → 比赛日 → 直播看到 TARGET_MINUTE ──────────────────
  console.log("\n[1] 新游戏 → 比赛日 → 直播");
  await toMatchScreen(page, { newGame: true });
  await page.evaluate(() => window.__resumeReset());
  const spd = await page.evaluate(() => {
    const b = document.querySelector('[data-match-speed="4"]');
    if (!b) return null;
    b.click();
    return b.textContent;
  });
  console.log(`  倍速键: ${spd}`);
  await page.locator("#btn-sim-live").click({ timeout: 30_000 });

  const deadline = Date.now() + 8 * 60 * 1000;
  let hud = await page.evaluate(readHud);
  while (Date.now() < deadline && hud.minute < TARGET_MINUTE) {
    await page.waitForTimeout(1500);
    await closeModalIfAny(page);
    hud = await page.evaluate(readHud);
  }
  console.log(`  到达: ${hud.minuteRaw}  比分 ${hud.home}-${hud.away}  日志 ${hud.logLines} 行`);
  const beforeReload = {
    progress: await page.evaluate((k) => {
      try {
        return JSON.parse(sessionStorage.getItem(k) || "null");
      } catch {
        return null;
      }
    }, PROGRESS_KEY),
    hud,
    firstT: await page.evaluate(() => window.__resume.firstT),
  };
  console.log(`  进度记录: ${JSON.stringify(beforeReload.progress)}`);
  console.log(`  本轮首帧 t: ${beforeReload.firstT}`);
  check(
    beforeReload.progress && Number(beforeReload.progress.simT) > 0,
    "进度记录里存了模拟秒 `simT`",
    `simT=${beforeReload.progress?.simT}`
  );
  check(
    beforeReload.firstT != null && beforeReload.firstT < 30,
    "不续播时首帧 t ≈ 0（基线）",
    `t=${beforeReload.firstT}`
  );

  // ── 阶段 2：刷新 → 重开 → 弹窗必须出现「接着看」 ────────────────────
  console.log("\n[2] F5 刷新 → 重开比赛 → 弹窗");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  let back = false;
  for (let i = 0; i < 90 && !back; i += 1) {
    back = await page.evaluate(() => !!window.vcfmMainApi).catch(() => false);
    if (!back) await page.waitForTimeout(1000);
  }
  assert.ok(back, "刷新后未回到可用状态");
  await page.evaluate(INSTALL_HOOK);
  await toMatchScreen(page, { newGame: false });

  const modal = await page.evaluate(() => {
    const m = document.querySelector("#modal");
    const visible =
      !!m && !m.classList.contains("hidden") && getComputedStyle(m).display !== "none";
    const btn = document.querySelector("#btn-reopened-match-resume");
    return {
      visible,
      hasResumeBtn: !!btn,
      resumeText: btn?.textContent?.trim() || "",
      bodyText: (document.querySelector("#modal-body")?.textContent || "").slice(0, 200),
    };
  });
  console.log(`  弹窗可见=${modal.visible} 接着看按钮=${modal.hasResumeBtn} 「${modal.resumeText}」`);
  check(modal.visible, "重开比赛时弹出了「你看过一段」提示");
  check(modal.hasResumeBtn, "弹窗里有「接着看」按钮（不是只提示）");

  // ── 阶段 3：点「接着看」→ 量首帧 t ──────────────────────────────────
  console.log("\n[3] 点「从 N′ 接着看」");
  await page.evaluate(() => window.__resumeReset());
  await page.click("#btn-reopened-match-resume", { timeout: 20_000 });
  const resumeDeadline = Date.now() + 3 * 60 * 1000;
  let resumeFirst = null;
  while (Date.now() < resumeDeadline && resumeFirst == null) {
    await page.waitForTimeout(700);
    resumeFirst = await page.evaluate(() => window.__resume.firstT);
  }
  const resumeHud = await page.evaluate(readHud);
  const resumeBanners = await page.evaluate(() => window.__resume.banners.slice());
  const resumeSimT = Number(beforeReload.progress.simT);
  console.log(`  续播点 simT=${resumeSimT}  首帧 t=${resumeFirst}  HUD=${resumeHud.minuteRaw}`);
  console.log(`  续播分支横幅: ${JSON.stringify(resumeBanners.slice(0, 3))}`);
  check(resumeFirst != null, "续播后真的渲染了（有首帧）", `t=${resumeFirst}`);
  // 最硬的证据：桥接器的**续播分支**真的跑了（它打一条专属横幅，
  // 与「⏩ 跳过平淡」区分开）。只量首帧的话，无法区分
  // 「续播生效」与「碰巧第一个高光段就在后面」。
  check(
    resumeBanners.some((m) => /快进到你上次看到的位置|Fast-forward to where you left off/.test(m)),
    "真的走了续播分支（打了「⏩ 快进到你上次看到的位置」专属横幅）",
    resumeBanners.find((m) => /快进到你上次看到的位置/.test(m)) || "(没打到)"
  );
  // ⚠ 不能断言「首帧 t ≈ 续播点」：续播点常常落在**平淡段内部**，
  //   最早能渲染的是它之后的**第一个高光段**，差值可以是一整个段的长度
  //   （本仓 census：段间隔 129.5~956.8 模拟秒）。本轮实测续播点 689.9 ⇒ 首帧 1122.6。
  //   所以判据用**跳过量**（自校准），见阶段 4 的对照。
  check(
    resumeHud.minute >= Math.floor(beforeReload.progress.minute) - 1,
    "HUD 分钟 ≥ 续播分钟（没有被重置回 0′）",
    `HUD=${resumeHud.minute} 续播分钟=${beforeReload.progress.minute}`
  );

  // ── 阶段 4：对照组「从头重看」───────────────────────────────────────
  console.log("\n[4] 对照组：刷新 → 「从头重看」→ 直播");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  for (let i = 0; i < 90; i += 1) {
    if (await page.evaluate(() => !!window.vcfmMainApi).catch(() => false)) break;
    await page.waitForTimeout(1000);
  }
  await page.evaluate(INSTALL_HOOK);
  await toMatchScreen(page, { newGame: false });
  await page.evaluate(() => window.__resumeReset());
  await page.click("#btn-reopened-match-replay", { timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.locator("#btn-sim-live").click({ timeout: 30_000 });
  const ctrlDeadline = Date.now() + 3 * 60 * 1000;
  let ctrlFirst = null;
  while (Date.now() < ctrlDeadline && ctrlFirst == null) {
    await page.waitForTimeout(700);
    ctrlFirst = await page.evaluate(() => window.__resume.firstT);
  }
  console.log(`  对照组首帧 t=${ctrlFirst}`);
  check(ctrlFirst != null && ctrlFirst < 60, "「从头重看」首帧 t ≈ 0（对照组）", `t=${ctrlFirst}`);
  // 核心判据 ①（精确）：首帧**不早于**续播点 ⇒ 看过的那段一点都没重看。
  // ⚠ 允许 1 秒的帧对齐误差；且**不能**要求「首帧 ≈ 续播点」——
  //   续播点常落在平淡段内部，最早能渲染的是它之后的第一个高光段
  //   （本仓 census 段间隔 129.5~956.8 模拟秒；实测见过 689.9 ⇒ 1122.6）。
  check(
    resumeFirst != null && resumeFirst >= resumeSimT - 1,
    "首帧不早于续播点（没让你重看已经看过的内容）",
    `首帧 ${resumeFirst} vs 续播点 ${resumeSimT}`
  );
  // 核心判据 ②（与对照配对，自校准）：跳过量 ≥ 续播点的 90%。
  // ⚠ 不写「≥ 续播点」：对照组的首帧是 **0.1** 而不是 0（帧对齐），
  //   精确比较会差这 0.1 秒而假红（本轮实测差 0.1000000000032）。
  check(
    resumeFirst != null && ctrlFirst != null && resumeFirst - ctrlFirst >= resumeSimT * 0.9,
    "跳过量 ≥ 续播点的 90%（与「从头重看」对照组配对，不依赖绝对阈值）",
    `跳过量 ${resumeFirst == null || ctrlFirst == null ? "n/a" : (resumeFirst - ctrlFirst).toFixed(1)} / 续播点 ${resumeSimT}`
  );

  // ── 阶段 5：跨半场（续播点落在下半场）────────────────────────────────
  // 交接的完成判据 2 要求「跨半场必须实测」。
  // 为什么用**合成**续播点：真跑到 50′ 再刷新要多花好几分钟，而这里要验的
  // 只是「续播点位于 H2 时桥接器 / 弹窗的行为」—— 它不关心 simT 怎么来的。
  // 键从阶段 4 留下的真实记录里取，所以赛季/天/场次仍然对得上。
  console.log("\n[5] 跨半场：把续播点设到下半场（50′ = 3000 模拟秒）");
  const rec5 = await page.evaluate((k) => {
    try {
      return JSON.parse(sessionStorage.getItem(k) || "null");
    } catch {
      return null;
    }
  }, PROGRESS_KEY);
  if (!rec5?.key) {
    check(false, "能读到阶段 4 的进度记录（跨半场用例的前置）");
  } else {
    await page.evaluate(
      ({ k, rec }) => {
        sessionStorage.setItem(k, JSON.stringify({ ...rec, minute: 50, simT: 3000 }));
      },
      { k: PROGRESS_KEY, rec: rec5 }
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    for (let i = 0; i < 90; i += 1) {
      if (await page.evaluate(() => !!window.vcfmMainApi).catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    await page.evaluate(INSTALL_HOOK);
    await toMatchScreen(page, { newGame: false });
    const m5 = await page.evaluate(() => ({
      hasResume: !!document.querySelector("#btn-reopened-match-resume"),
      text: document.querySelector("#btn-reopened-match-resume")?.textContent?.trim() || "",
      body: document.querySelector("#modal-body")?.textContent || "",
    }));
    check(/50/.test(m5.text), "弹窗按钮显示「从 50′ 接着看」", m5.text || "(无按钮)");
    check(
      /中场面板|half-time panel/.test(m5.body),
      "弹窗**讲清**「上半场会被快进、会先停在中场面板」（跨半场必须交代）"
    );
    await page.evaluate(() => window.__resumeReset());
    await page.click("#btn-reopened-match-resume", { timeout: 20_000 });
    let htShown = false;
    const htDeadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < htDeadline && !htShown) {
      await page.waitForTimeout(700);
      htShown = await page
        .evaluate(() => {
          const p = document.querySelector("#match-ht-panel");
          return !!p && !p.classList.contains("hidden") && getComputedStyle(p).display !== "none";
        })
        .catch(() => false);
    }
    const b5 = await page.evaluate(() => window.__resume.banners.slice());
    const hud5 = await page.evaluate(readHud);
    check(
      b5.some((m) => /快进到你上次看到的位置/.test(m)),
      "H1 整段走了续播跳过（打了专属横幅）",
      b5.find((m) => /快进到你上次看到的位置/.test(m)) || "(没打到)"
    );
    check(htShown, "停在**中场面板**等一次确认（跨半场的有意行为）", `HUD=${hud5.minuteRaw}`);
    check(hud5.minute >= 45, "HUD 到 45′（上半场没有重演）", `HUD=${hud5.minute}`);
  }

  console.log(`\nREQFAILED ${JSON.stringify(failedRequests.slice(0, 4))}`);
  console.log(`ERRORS ${JSON.stringify(errors.slice(0, 6))}`);
  // ⚠ 只把 **JS 异常**当失败：headless + Service Worker 组合下，
  //   SW 自己的某个后台请求偶尔会被拒（`ERR_CONNECTION_REFUSED`），
  //   与产品代码无关。资源级失败单独打印出来，不当红。
  check(
    !errors.some((e) => e.startsWith("pageerror")),
    "无 pageerror（真实 JS 异常）",
    errors.filter((e) => e.startsWith("pageerror")).slice(0, 2).join(" | ")
  );
} catch (err) {
  failed += 1;
  console.error("\n探针异常:", err?.message || err);
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(`\n_match-resume-probe: ${failed ? `${failed} 项失败` : "ok"}`);
process.exit(failed ? 1 : 0);
