// 临时探针：量「总览 → 概览 → 赛季快照」里 `#form-strip`（近期战绩）及其所属卡片的
// 真实排版几何与继承字号。用户报告「字体太大、换行违和」。
//
// 关键要回答：
//   1. `#form-strip` 到底有没有内容？（源码里没有 JS 填充点）
//   2. 该卡片里是否有 16px+ 的大字号元素？是谁？
//   3. 若近期战绩内容确实渲染在别处（如 #next-match 里的 compact 简报），量它的字号。
//
// 用法：node scripts/_form-strip-typography-probe.mjs [视口宽] [视口高] [主题]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 8917;
const BASE = `http://127.0.0.1:${PORT}/`;
const VW = Number(process.argv[2]) || 1440;
const VH = Number(process.argv[3]) || 1000;
const THEME = process.argv[4] || "dark";

const server = spawn("python", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: ROOT,
  stdio: "ignore",
  windowsHide: true,
});

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

  await page.addInitScript((theme) => {
    try {
      localStorage.setItem("vcfm.theme", theme);
    } catch {}
  }, THEME);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => !("serviceWorker" in navigator) || Object.keys(sessionStorage).some((k) => k.startsWith("vcfm-sw-reloaded-")),
    null,
    { timeout: 60000 }
  );
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90000 });

  // 新开一局
  await page.fill("#input-manager", "Typography Probe");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 90000 });
  await page.waitForTimeout(1500);

  // 到总览页
  const dashTab = page.locator('[data-tab="dashboard"], .tab[data-tab="dashboard"], #tab-btn-dashboard').first();
  if (await dashTab.count()) {
    await dashTab.click().catch(() => {});
    await page.waitForTimeout(800);
  }

  const report = await page.evaluate(() => {
    const out = {};
    const strip = document.querySelector("#form-strip");
    const pulse = document.querySelector(".dashboard-pulse-card");

    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        display: cs.display,
        visible: r.width > 0 && r.height > 0,
      };
    };

    out.formStrip = strip
      ? { ...box(strip), html: (strip.innerHTML || "").slice(0, 240), childCount: strip.children.length, text: (strip.textContent || "").trim() }
      : null;
    out.pulse = box(pulse);

    // 关键元素：无论字号大小都报（用于 before/after 对比）
    const rank = document.querySelector("#my-rank");
    out.myRank = rank
      ? {
          ...box(rank),
          text: (rank.textContent || "").trim(),
          // 行数 = 高度 / 行高
          lines: (() => {
            const lh = parseFloat(getComputedStyle(rank).lineHeight);
            const h = rank.getBoundingClientRect().height;
            const pt = parseFloat(getComputedStyle(rank).paddingTop) + parseFloat(getComputedStyle(rank).paddingBottom);
            return lh > 0 ? Math.round((h - pt) / lh) : null;
          })(),
        }
      : null;
    const youth = document.querySelector("#youth-info");
    out.youthInfo = youth ? box(youth) : null;

    // pulse card 里所有 >= 15px 的可见元素
    out.pulseBig = [];
    if (pulse) {
      for (const el of pulse.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px >= 15) {
          out.pulseBig.push({
            sel: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).split(" ").join(".").slice(0, 50) : ""),
            fontSize: getComputedStyle(el).fontSize,
            text: (el.textContent || "").trim().slice(0, 70),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      }
    }

    // 全页扫描：谁显示了「近期战绩」正文（即非 h3 标题的那处）
    out.formLikeNodes = [];
    for (const el of document.querySelectorAll(".form-strip, .form-pills, .brief-form-row, .recent-form")) {
      const r = el.getBoundingClientRect();
      out.formLikeNodes.push({
        sel: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + String(el.className).split(" ").join("."),
        fontSize: getComputedStyle(el).fontSize,
        parentFontSize: el.parentElement ? getComputedStyle(el.parentElement).fontSize : null,
        parentCls: el.parentElement ? String(el.parentElement.className).slice(0, 60) : null,
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0,
        text: (el.textContent || "").trim().slice(0, 60),
        cells: el.querySelectorAll(".form-cell").length,
      });
    }

    return out;
  });

  console.log(JSON.stringify({ viewport: { VW, VH }, theme: THEME, report }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
