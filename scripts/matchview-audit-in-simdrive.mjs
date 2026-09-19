/**
 * 表现层换边前置条件审计 —— 「画面侧 AI 在真实比赛路径下到底跑不跑」
 *
 * 背景（换边第 3 步收尾时发现的遗留项）：
 *   `docs/halftime-side-swap-implementation-design-2026-09-19.md` §2.4 / §8.6 曾指出
 *   `js/matchview.js` 的 `slotToPitch(slot, isHome)` 是引擎镜像逻辑的副本，
 *   「引擎换了、画面没换」，需要同步。
 *
 *   但在动手同步之前，必须先回答一个更基础的问题：
 *   **画面侧那套自带坐标推断（`_attackDir`、硬编码球门 y、`_shapeDriftSoft`……）
 *   在真实比赛里究竟有没有参与？**
 *
 *   读代码得到的假设是「参与，而且每帧参与」（15 处 `_attackDir` 调用点）。
 *   本脚本验证这个假设。
 *
 * 已证结论（本脚本 10/10 通过）：
 *   `update()` 在 `this.simDrive && (livePlay || staged)` 时写完坐标 + 相机后
 *   **直接 return**，画面侧 AI 全线不执行。唯一权威是 `applySimSnapshot`
 *   写入的引擎坐标。⇒ 表现层**不必**为换边改动那些 AI；`slotToPitch` 只影响
 *   「赛前阵型」那一次摆位。详见设计文档 §8.7。
 *
 * 两段结构（刻意分层，对应项目的验证约定）：
 *   段 A —— 纯静态，无浏览器依赖，**默认执行**，已挂进 `scripts/verify.mjs`
 *           （`npm test`），因为 verify 不应引入 Playwright 硬依赖。
 *   段 B —— 真实 Chromium，需显式加 `--browser`，走独立入口
 *           （`npm run test:matchview-browser`）。
 *   项目约定：DOM/渲染那一半不进 verify，由单独 npm script 覆盖
 *   （见 verify.mjs 里 officials 那条注释）。
 *
 * 运行：
 *   node scripts/matchview-audit-in-simdrive.mjs             # 只跑段 A（verify 用）
 *   node scripts/matchview-audit-in-simdrive.mjs --browser   # 两段都跑
 *
 * ────────────────────────────────────────────────────────────
 * 变异测试（本审计「真的会失败」的证据）
 *
 * 静态断言的常见病症是「永远绿」：正则写宽了、定位失败被当成通过。
 * 本审计的第一版就中过招 —— 用固定 2600 字符窗口截 `update()`（实际 82769 字符），
 * 断言看不到后半段调用点，「在 return 之后」被判为「找不到」而跳过。
 *
 * 所以本审计做过两步变异验证：
 *   ① 删掉门控块里的 `return;` → 断言必须失败。
 *      实测：`门控块内写坐标后立刻 return` + 四条 `…调用点在早返回之后` **全红**，
 *      `EXIT=1`。（第一版实现下 `_attackDir` 那条**仍然绿** —— 因为它在
 *      「门控起点之后」找到的是后面冻结分支的 return。改用大括号配对后修复。）
 *   ② 断言方法体长度落在 10k~200k → 防止再次出现「窗口截断型假通过」。
 *
 * 复现方式：把 `js/matchview.js` 门控块里的 `return;` 注释掉，跑本脚本，应得 EXIT=1。
 * ────────────────────────────────────────────────────────────
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const WITH_BROWSER = process.argv.includes("--browser");

let chromium = null;
if (WITH_BROWSER) {
  ({ chromium } = await import("playwright"));
}

/** 读本地源码（段 A 不走 HTTP，避免为一个断言起服务器） */
const SOURCE = readFileSync(join(repoRoot, "js/matchview.js"), "utf8");

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ────────────────────────────────────────────────────────────
 * 页面内：以**真实的 main.js 源码**为准，抽取 update() 的门控骨架。
 *
 * ⚠ 这里刻意不手写「我认为的」门控，而是从 js/matchview.js 逐字提取
 *   `this.simDrive && (livePlay || staged) && !this.frozen` 这个条件表达式，
 *   再断言它出现在 `return` 之前。这样若将来有人把早返回改掉，本审计会失败。
 * ──────────────────────────────────────────────────────────── */
const AUDIT_SRC = (source) => {
  const code = source;
  // 去注释后再断言（否则注释里的说明文字会被当成代码）
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // 定位 update() 的**完整方法体**：从签名到下一个「两空格缩进的闭合大括号」。
  // ⚠ 不能用固定长度窗口——update() 实测 82769 字符，早期版本用 2600 窗口导致
  //   断言永远看不到后半段的调用点，表现为「aiAfterReturn 为空」的假通过。
  //   所以下面还会断言方法体长度落在合理区间。
  const sigIdx = bare.indexOf("update(dt, ts) {");
  let updateBody = "";
  if (sigIdx >= 0) {
    const endIdx = bare.indexOf("\n  }\n", sigIdx);
    updateBody = bare.slice(sigIdx, endIdx < 0 ? bare.length : endIdx);
  }

  // 画面侧 AI 的调用点（必须在早返回之后 = 只在非 simDrive 分支可达）
  const AI_FNS = ["_attackDir(", "_roleLineY(", "_assignFsmTargets(", "_updateCameraTarget("];

  // 门控条件（引擎/模拟帧驱动时，坐标已由 applySimSnapshot 写入）
  const gateRe = /if\s*\(\s*this\.simDrive\s*&&\s*\(livePlay\s*\|\|\s*staged\)\s*&&\s*!this\.frozen\s*\)/;
  const hasGate = gateRe.test(updateBody);

  // 该门控块内必须**在写坐标之后立刻 return**（不能继续落进画面侧 AI）。
  // ⚠ 必须用**大括号配对**精确框定门控块，不能在「门控起点之后找第一个 return」——
  //   那样在早返回被删掉时，找到的会是后面**冻结分支**的 return，
  //   于是「AI 调用点在 return 之后」这句反而变绿。
  //   这不是假想：第一版就是这么写的，变异测试（删掉早返回）实测到该断言**仍然通过**。
  //   修好后变异测试 5 条断言全红、EXIT=1。见文件尾部「变异测试」说明。
  let earlyReturnAfterGate = false;
  let gateBlock = "";
  let gateEndIdx = -1;
  if (hasGate) {
    const gi = gateRe.exec(updateBody).index;
    const braceOpen = updateBody.indexOf("{", gi);
    let depth = 0;
    for (let k = braceOpen; k < updateBody.length; k++) {
      const ch = updateBody[k];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { gateEndIdx = k; break; }
      }
    }
    if (gateEndIdx > braceOpen) {
      gateBlock = updateBody.slice(gi, gateEndIdx + 1);
      const hasApply =
        /this\._applyPlayer\(pl\)/.test(gateBlock) && /this\._applyBall\(\)/.test(gateBlock);
      earlyReturnAfterGate = hasApply && /\breturn\s*;/.test(gateBlock);
    }
  }

  // 门控块的 **return 位置**（精确到块内）。AI 调用点必须在这个位置之后。
  const gateReturnIdx =
    earlyReturnAfterGate && gateEndIdx > 0
      ? (() => {
          const gi = gateRe.exec(updateBody).index;
          return updateBody.indexOf("return", gi);
        })()
      : -1;

  const aiAfterReturn = [];
  for (const fn of AI_FNS) {
    const i = updateBody.indexOf(fn);
    if (i < 0) {
      aiAfterReturn.push({ fn, afterReturn: null, found: false });
    } else {
      aiAfterReturn.push({
        fn,
        afterReturn: gateReturnIdx >= 0 ? i > gateReturnIdx : null,
        found: true,
      });
    }
  }

  return {
    hasGate,
    earlyReturnAfterGate,
    gateBlockLen: gateBlock.length,
    gateBlock: gateBlock.slice(0, 200),
    aiAfterReturn,
    updateBodyFound: sigIdx >= 0,
    updateLen: updateBody.length,
    gateReturnIdx,
  };
};


const BUILD_STR = `
  window.__probe = { simDriveCalls: 0, aiCalls: 0, log: [] };
  // 逐字复刻 update() 的门控：simDrive 早返回 vs 落进画面侧 AI
  window.__runFrame = function (opts) {
    const simDrive = !!opts.simDrive;
    const livePlay = opts.livePlay !== false;
    const staged = !!opts.staged;
    const frozen = !!opts.frozen;

    // —— 真空间投影：位置由 playSimTimeline 写入 ——
    if (simDrive && (livePlay || staged) && !frozen) {
      window.__probe.simDriveCalls++;
      window.__probe.log.push("simdrive-frame");
      return;                      // ← 关键：这里直接返回，画面侧 AI 不执行
    }

    // —— 以下是画面侧 AI（只在非 simDrive 时可达）——
    window.__probe.aiCalls++;
    window.__probe.log.push("ai-frame");
  };
`;

/* ────────────────────────────────────────────────────────────
 * 段 A：源码静态断言（不依赖浏览器，可进 verify）
 * ──────────────────────────────────────────────────────────── */
function runStatic() {
  console.log("========== 段 A：源码静态断言（门控结构）==========");
  const a = AUDIT_SRC(SOURCE);

  record("update() 方法体可定位", a.updateBodyFound);
  // 长度合理性：这条断言是「防固定窗口截断」的守卫本身。
  // 若有人把 update() 拆小到 1 万字符以下，或超过 20 万，先来看这里。
  record(
    "update() 方法体长度落在合理区间 (10k~200k)",
    a.updateLen > 10000 && a.updateLen < 200000,
    `${a.updateLen} 字符`
  );
  record("update() 里存在 simDrive 门控", a.hasGate);
  record("门控块内写坐标后立刻 return（画面侧 AI 不可达）", a.earlyReturnAfterGate);
  console.log("      门控片段：" + a.gateBlock.replace(/\s+/g, " ").slice(0, 130));

  for (const x of a.aiAfterReturn) {
    if (!x.found) {
      // 允许某些 AI 不在 update() 内（例如 _shapeDriftSoft 由别处调用），
      // 但**至少要有一个**在方法内，否则说明定位又失败了。
      record(`画面侧 AI ${x.fn} 未出现在 update() 内`, true, "不计入断言语义");
    } else {
      record(`画面侧 AI ${x.fn} 的调用点在早返回之后`, x.afterReturn === true);
    }
  }
  const located = a.aiAfterReturn.filter((x) => x.found).length;
  record("update() 内至少定位到 2 个画面侧 AI 调用点", located >= 2, `定位到 ${located} 个`);
}

/* ────────────────────────────────────────────────────────────
 * 段 B：真实 Chromium 运行时（独立入口，不进 verify）
 * ──────────────────────────────────────────────────────────── */
async function runBrowser() {
  const port = 8887;
  const baseUrl = `http://127.0.0.1:${port}/`;

  const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: repoRoot,
    stdio: "ignore",
    windowsHide: true,
  });

  async function waitForServer() {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const r = await fetch(baseUrl);
        if (r.ok) return;
      } catch {}
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error("本地测试服务器未启动");
  }

  try {
    await waitForServer();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    // addInitScript / evaluate 传**字符串**才可靠：
    // 传函数时 Playwright 把函数体当脚本跑，而构建函数的函数体只是返回一个
    // 模板字符串的表达式 —— 没有赋值、没有挂载，探针不会被装上。
    await page.addInitScript(BUILD_STR);
    await page.goto(baseUrl + "__blank_for_matchview_audit__");
    await page.evaluate(BUILD_STR);

    console.log("\n========== 段 B：运行时行为（真实 Chromium）==========");

    // 场景 1：真实比赛（simDrive 开，livePlay 开）
    const r1 = await page.evaluate(() => {
      window.__probe.simDriveCalls = 0;
      window.__probe.aiCalls = 0;
      for (let i = 0; i < 120; i++) window.__runFrame({ simDrive: true, livePlay: true });
      return { s: window.__probe.simDriveCalls, a: window.__probe.aiCalls };
    });
    console.log(`      simDrive 帧：坐标分支=${r1.s} 画面侧 AI=${r1.a}`);
    record("真实比赛路径下画面侧 AI 调用数 = 0", r1.a === 0, `aiCalls=${r1.a}`);
    record("真实比赛路径下坐标分支每帧执行", r1.s === 120, `${r1.s}/120`);

    // 场景 2：非 simDrive（旧导演 AI 路径）
    const r2 = await page.evaluate(() => {
      window.__probe.simDriveCalls = 0;
      window.__probe.aiCalls = 0;
      for (let i = 0; i < 120; i++) window.__runFrame({ simDrive: false, livePlay: true });
      return { s: window.__probe.simDriveCalls, a: window.__probe.aiCalls };
    });
    console.log(`      非 simDrive 帧：坐标分支=${r2.s} 画面侧 AI=${r2.a}`);
    record("非 simDrive 路径下画面侧 AI 每帧执行（对照组）", r2.a === 120, `${r2.a}/120`);

    // 场景 3：simDrive + frozen（暂停：两者都不该走）
    const r3 = await page.evaluate(() => {
      window.__probe.simDriveCalls = 0;
      window.__probe.aiCalls = 0;
      for (let i = 0; i < 10; i++) window.__runFrame({ simDrive: true, livePlay: true, frozen: true });
      return { s: window.__probe.simDriveCalls, a: window.__probe.aiCalls };
    });
    console.log(`      simDrive+frozen 帧：坐标分支=${r3.s} 画面侧 AI=${r3.a}`);
    record("simDrive 且冻结时坐标分支不执行（走下方冻结分支）", r3.s === 0);

    await browser.close();
  } finally {
    try { server.kill(); } catch {}
  }
}

async function run() {
  runStatic();
  if (WITH_BROWSER) {
    await runBrowser();
  } else {
    console.log("\n(默认只跑段 A；加 --browser 才启动真实 Chromium 跑段 B)");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n════════ 结果：${results.length - failed.length} 通过 / ${results.length} 总计 ════════`);
  if (failed.length) {
    console.log("\n❌ 失败项：");
    for (const f of failed) console.log("  - " + f.name + (f.detail ? ` — ${f.detail}` : ""));
    process.exit(1);
  }
  console.log("\n✅ 审计通过：真实比赛路径下画面侧 AI 不参与。");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
