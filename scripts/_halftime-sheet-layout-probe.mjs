/**
 * 中场休息抽屉布局探针（用户报告：「内容显示不全，只能慢慢滑动鼠标才能看一行」）。
 *
 * 症状：`#match-ht-fitness`（各队员体能）与 `#match-ht-roles`（下半场角色指令）
 *       内容看不全，需要艰难地滚动才能逐行看。
 *
 * 本探针只**测量**，不改任何 CSS / JS。按 ui-layout-audit 技能：
 * 先给每个缺陷一个数字（改前 / 改后），再谈修复。
 *
 * 重点测：
 *   1. 抽屉本身：clientHeight vs scrollHeight（是否真的能滚、溢出多少）
 *   2. 每个子区块的盒高与 flex 参数（谁是"不可收缩"的那个）
 *   3. 两个问题面板的可见高度 vs 内容高度（裁切量）
 *   4. 单行 `.ht-fit-row` / `.ht-role-edit` 的实际高度（判断"一行要看半天"）
 *   5. 是否横向溢出（grid 列在窄屏可能被压）
 *
 * 用法：node scripts/_halftime-sheet-layout-probe.mjs [outDir] [--shots]
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8896;
const baseUrl = `http://127.0.0.1:${port}/`;
const outArg = process.argv[2];
const out = outArg
  ? (isAbsolute(outArg) ? outArg : resolve(root, outArg))
  : join(root, ".tmp-ht-lab", `ht-sheet-${Date.now()}`);
const shots = process.argv.includes("--shots");
mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { label: "phone-small", width: 360, height: 640 },
  { label: "phone", width: 390, height: 844 },
  { label: "phone-land", width: 844, height: 390 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 1000 },
];

// 在页面里跑的测量函数：只读，不改样式
const measureScript = () => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel: el.id ? `#${el.id}` : `.${(el.className || "").toString().split(" ")[0]}`,
      clientH: el.clientHeight,
      clientW: el.clientWidth,
      scrollH: el.scrollHeight,
      scrollW: el.scrollWidth,
      rectTop: Math.round(r.top),
      rectBottom: Math.round(r.bottom),
      rectH: Math.round(r.height),
      overflowY: cs.overflowY,
      overflowX: cs.overflowX,
      display: cs.display,
      flexGrow: cs.flexGrow,
      flexShrink: cs.flexShrink,
      flexBasis: cs.flexBasis,
      minHeight: cs.minHeight,
      maxHeight: cs.maxHeight,
      paddingTop: cs.paddingTop,
      paddingBottom: cs.paddingBottom,
      clippedBy: el.scrollHeight > el.clientHeight + 1 ? el.scrollHeight - el.clientHeight : 0,
    };
  };

  const panel = document.querySelector("#match-ht-panel");
  const fitness = document.querySelector("#match-ht-fitness");
  const roles = document.querySelector("#match-ht-roles");

  // 抽屉的直接子元素，看谁吸收挤压
  const children = panel
    ? [...panel.children].map((el) => box(el))
    : [];

  // 单行高度（判断"一行要看半天"）
  const fitRows = fitness ? [...fitness.querySelectorAll(".ht-fit-row")] : [];
  const roleRows = roles ? [...roles.querySelectorAll(".ht-role-edit")] : [];
  const rowH = (arr) => (arr.length ? Math.round(arr[0].getBoundingClientRect().height) : null);
  const rowHeights = arr => arr.map((el) => Math.round(el.getBoundingClientRect().height));

  // 可见性：面板底部是否超出抽屉可视区
  const panelRect = panel?.getBoundingClientRect();
  const within = (el) => {
    if (!el || !panelRect) return null;
    const r = el.getBoundingClientRect();
    return {
      topInside: r.top >= panelRect.top - 1,
      bottomInside: r.bottom <= panelRect.bottom + 1,
    };
  };

  // 窄屏横向溢出
  const smallTargets = [];
  document.querySelectorAll("#match-ht-panel select, #match-ht-panel button, #match-ht-panel input").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.width < 40 || r.height < 40)) {
      smallTargets.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: (el.className || "").toString().slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  });

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    document: {
      clientW: document.documentElement.clientWidth,
      scrollW: document.documentElement.scrollWidth,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    },
    panel: box(panel),
    fitness: box(fitness),
    roles: box(roles),
    panelChildren: children,
    fitRowCount: fitRows.length,
    roleRowCount: roleRows.length,
    fitRowH: rowH(fitRows),
    roleRowH: rowH(roleRows),
    fitRowHeights: rowHeights(fitRows),
    roleRowHeights: rowHeights(roleRows),
    fitnessWithin: within(fitness),
    rolesWithin: within(roles),
    smallTargetCount: smallTargets.length,
    smallTargets: smallTargets.slice(0, 12),
  };
};

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
});

let browser;
try {
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = (await fetch(baseUrl)).ok; } catch { /* retry */ }
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "preview server did not start");

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", async (d) => { await d.accept(); });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  // ⚠ boot 是整个探针最 flaky 的一段：偶发 90s 不够（曾超时一次）。
  // 用「有界等待 + 重载重试」，而不是一个长 timeout —— 单次慢启动不该废掉整轮测量。
  let booted = false;
  for (let attempt = 0; attempt < 3 && !booted; attempt++) {
    try {
      await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 120000 });
      booted = true;
    } catch {
      console.log(`[boot] vcfmMainApi 第 ${attempt + 1} 次等待超时，重载重试……`);
      await page.reload({ waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(3000);
    }
  }
  assert.ok(booted, "vcfmMainApi did not appear after 3 attempts");
  await page.fill("#input-manager", "HT Probe");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 90000 });

  // 推进到有比赛可打
  let matchReady = false;
  for (let day = 0; day < 30 && !matchReady; day++) {
    matchReady = await page.locator("#btn-play-match").isEnabled();
    if (matchReady) break;
    const before = await page.locator("#date-label").innerText().catch(() => "");
    await page.click("#btn-advance").catch(() => {});
    try {
      await page.waitForFunction(
        (d) => document.querySelector("#date-label")?.textContent !== d,
        before,
        { timeout: 45000 }
      );
    } catch { /* slow day: retry */ }
  }
  assert.ok(matchReady, "no match became playable within 30 days");

  await page.click("#btn-play-match");
  await page.waitForSelector("#screen-match.active", { timeout: 60000 });
  await page.click("#btn-sim-live");
  await page.waitForSelector("#mp-canvas", { timeout: 60000 });

  // 直接跳到中场：全速模拟直到抽屉出现
  console.log("[boot] 等待中场抽屉出现……");
  let reachedHt = false;
  for (let i = 0; i < 60 && !reachedHt; i++) {
    reachedHt = await page.locator("#match-ht-panel:not(.hidden)").count() > 0;
    if (reachedHt) break;
    // 点「快速」推进；若已在中场则按钮会失效
    await page.click("#btn-sim-fast").catch(() => {});
    await page.waitForTimeout(2000);
  }
  if (!reachedHt) {
    console.log("[boot] 未在限定时间内到达中场，尝试直接显示抽屉……");
    await page.evaluate(() => {
      const p = document.querySelector("#match-ht-panel");
      if (p) p.classList.remove("hidden");
    });
    await page.waitForTimeout(800);
  }
  console.log("[boot] 抽屉状态：", reachedHt ? "✅ 中场已到达" : "⚠ 强制显示");

  // 确认两个目标面板是否有内容
  const counts = await page.evaluate(() => ({
    fitRows: document.querySelectorAll("#match-ht-fitness .ht-fit-row").length,
    roleRows: document.querySelectorAll("#match-ht-roles .ht-role-edit").length,
    fitnessHidden: document.querySelector("#match-ht-fitness")?.classList.contains("hidden"),
  }));
  console.log("[boot] 面板行数：", JSON.stringify(counts));

  // —— 候选 CSS 实验室：一次 boot，逐个候选 × 逐个视口测量 ——
  // 按 ui-layout-audit Step 4。C0 = 空候选（基线，自校准）。
  //
  // 诊断（探针已测出）：`.ht-fitness` / `.ht-roles` 都有 `max-height` + `flex-shrink: 1`，
  //   在抽屉这个 flex column 里是**唯一可收缩**的子项 ⇒ 吸收全部溢出，被压到 16px。
  //   它们的 `overflow-y: auto` 因此形同虚设（16px 放不下一行）。
  //   ⇒ 修法是「停止这个子项收缩」（不是「让它滚动」）。
  //
  // ⚠ 特异性：真实规则在 `.ht-fitness`（0,1,0）/ `.ht-roles`（0,1,0）。
  //   候选必须同特异性**且出现在其后**，故用 <style> 注入到文档末尾。
  const CANDIDATES = [
    { id: "C0-baseline", css: "" },
    { id: "C1-noshrink", css: `
      .ht-fitness, .ht-roles { flex: 0 0 auto; }
    ` },
    { id: "C2-noshrink+minh", css: `
      .ht-fitness, .ht-roles { flex: 0 0 auto; min-height: 6rem; }
    ` },
    { id: "C3-noshrink+taller", css: `
      .ht-fitness { flex: 0 0 auto; max-height: 14rem; }
      .ht-roles   { flex: 0 0 auto; max-height: 18rem; }
    ` },
    { id: "C4-row-layout", css: `
      .ht-fitness, .ht-roles { flex: 0 0 auto; min-height: 6rem; }
      .ht-role-edit-grid { grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); }
    ` },
  ];

  // `--verify`：不注入任何候选，只测**真实 stylesheet**（修复后的）。
  //   `--quick` 可叠加，只测 phone 一个视口（验证用，省时间）。
  const verifyMode = process.argv.includes("--verify");
  const quickMode = process.argv.includes("--quick");
  const vpList = quickMode ? VIEWPORTS.filter((v) => v.label === "phone") : VIEWPORTS;
  const activeCandidates = verifyMode ? [{ id: "live", css: "" }] : CANDIDATES;

  const applyCandidate = async (css) => {
    await page.evaluate((text) => {
      let node = document.getElementById("__ht-probe-candidate");
      if (!node) {
        node = document.createElement("style");
        node.id = "__ht-probe-candidate";
        document.head.appendChild(node);
      }
      node.textContent = text;
    }, css);
    await page.waitForTimeout(400);
  };

  const results = [];
  for (const cand of activeCandidates) {
    await applyCandidate(cand.css);
    for (const vp of vpList) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(900);
      const data = await page.evaluate(measureScript);
      data.label = vp.label;
      data.candidate = cand.id;
      const stem = `ht-${cand.id}-${vp.label}-${vp.width}x${vp.height}`;
      if (shots) await page.screenshot({ path: join(out, `${stem}.png`), fullPage: false });
      writeFileSync(join(out, `${stem}.json`), `${JSON.stringify(data, null, 2)}\n`);
      results.push(data);
      console.log(JSON.stringify({
        candidate: cand.id,
        viewport: vp.label,
        panel: data.panel && { h: data.panel.clientH, scrollH: data.panel.scrollH },
        fitness: data.fitness && { h: data.fitness.clientH, scrollH: data.fitness.scrollH, clipped: data.fitness.clippedBy },
        roles: data.roles && { h: data.roles.clientH, scrollH: data.roles.scrollH, clipped: data.roles.clippedBy },
        overflowX: data.document.overflowX,
      }));
    }
  }
  writeFileSync(join(out, "ht-lab-all.json"), `${JSON.stringify({ errors, results, counts }, null, 2)}\n`);
  console.log(JSON.stringify({ pageErrors: errors, out }));
} finally {
  if (browser) await browser.close();
  server.kill();
}
