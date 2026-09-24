/**
 * 整场直播观赛（2026-09-24）——真浏览器里把一场比赛从 0' 看到终场。
 *
 * 用途：给「球员智能化」这类**整体观感**问题取证。两层输出：
 *   ① 截图：每 N 秒（墙钟）一张整屏图，文件名带比赛分钟 ⇒ 人和 agent 都能按分钟翻看；
 *   ② 坐标：每秒一次 22 人 + 球的**画面坐标**（`matchView.players`，画面就是照它画的），
 *      离线算阵型纵深 / 宽度 / 防线高度 / 球周围人数 / 原地不动占比。
 *   ⚠ 只读静态帧会把「球员在动」误判成「静止」（见记忆 vcfm-visual-diagnosis-method），
 *     所以结论一律以 ② 的数字为准，① 只做佐证。
 *
 * 终场判据：`#btn-match-continue` 由禁用变为可点（比赛结束后才放开）。
 * 中场：自动点 `#btn-ht-skip`（不调整，直接踢）。
 *
 * 用法：node scripts/_full-match-watch.mjs [倍速=2] [截图间隔秒=6]
 *   ⚠ 调用方把 stdout 重定向到文件（宿主会杀掉长时间无重定向的进程）。
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 8941;
const baseUrl = `http://127.0.0.1:${port}/`;
const SPEED = String(process.argv[2] || "2");
const SHOT_EVERY_MS = Math.max(2, Number(process.argv[3]) || 6) * 1000;
const outDir = root + ".tmp-watch/full-match";
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir + "/frames", { recursive: true });

// 场地 100×100 格 → 68m×105m（与 `js/matchview.js` 的 OFFICIAL_MX/MY 同源）
const MX = 0.68;
const MY = 1.05;

const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
});

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function closeModalIfAny(page) {
  return page
    .evaluate(() => {
      const m = document.querySelector("#modal");
      if (!m || m.classList.contains("hidden") || getComputedStyle(m).display === "none") return false;
      const btn =
        m.querySelector("#modal-close, [data-close], .modal-close, .modal-x, button.close") ||
        [...m.querySelectorAll("button")].find((b) => /关闭|确定|继续|知道了|OK|×/i.test(b.textContent || ""));
      (btn || m).click();
      return true;
    })
    .catch(() => false);
}

/** 页面内一次采样：画面坐标 + 时钟 + 比分 + 解说 */
const SNAP = () => {
  const mv = window.vcfmMainApi?.matchView;
  const txt = (sel) => (document.querySelector(sel)?.textContent || "").trim().replace(/\s+/g, " ");
  const vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
  return {
    clock: txt("#match-minute"),
    score: txt(".fm-sb-scoreline, #match-score") || null,
    ticker: vis(mv?.fmmTickerEl) ? (mv.fmmTickerEl.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80) : null,
    caption: vis(mv?.captionEl) ? (mv.captionEl.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80) : null,
    ball: mv?.ball ? { x: +Number(mv.ball.x).toFixed(2), y: +Number(mv.ball.y).toFixed(2) } : null,
    players: (mv?.players || []).map((p) => ({
      id: p.id,
      team: p.team,
      pos: p.player?.pos || null,
      x: +Number(p.x).toFixed(2),
      y: +Number(p.y).toFixed(2),
      hidden: !!(p.el && (p.el.style.display === "none" || p.el.classList?.contains("off"))),
    })),
    done: document.querySelector("#btn-match-continue")?.disabled === false,
  };
};

let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(baseUrl)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept());

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90_000 });
  await page.fill("#input-manager", "Full Match Watch");
  await page.click("#btn-new-game");
  await page.waitForSelector("#screen-main.active", { timeout: 150_000 });
  log("主界面就绪，推进到比赛日");

  await page.locator("#btn-advance-matchday").click();
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) {
    await page.waitForTimeout(2000);
    await closeModalIfAny(page);
    ready = await page.evaluate(() => document.querySelector("#btn-play-match")?.disabled === false);
  }
  if (!ready) throw new Error("推进到比赛日后仍无「进入比赛」可点");
  await closeModalIfAny(page);
  await page.locator("#btn-play-match").click();
  await page.waitForSelector("#screen-match.active", { timeout: 90_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/frames/000-prematch.png` });

  await page.click("#btn-sim-live", { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.locator(`[data-match-speed="${SPEED}"]`).first().click().catch(() => log("⚠ 倍速按钮点不到，按默认速度"));
  log(`开球（直播 ×${SPEED}）`);

  const samples = [];
  const tickerSeen = [];
  let lastShot = 0;
  let shots = 0;
  const deadline = Date.now() + 60 * 60 * 1000;
  let finished = false;
  while (Date.now() < deadline) {
    const s = await page.evaluate(SNAP).catch(() => null);
    if (s) {
      s.wall = Date.now();
      samples.push(s);
      for (const line of [s.ticker, s.caption]) {
        if (line && tickerSeen[tickerSeen.length - 1]?.line !== line) tickerSeen.push({ clock: s.clock, line });
      }
      if (s.done) {
        finished = true;
        break;
      }
    }
    if (Date.now() - lastShot >= SHOT_EVERY_MS) {
      lastShot = Date.now();
      shots++;
      const minute = (s?.clock || "x").replace(/[^0-9+]/g, "") || "x";
      await page
        .screenshot({ path: `${outDir}/frames/${String(shots).padStart(3, "0")}-m${minute}.png` })
        .catch(() => {});
      if (shots % 10 === 0) log(`已截 ${shots} 张，时钟 ${s?.clock}，比分 ${s?.score}`);
    }
    const ht = await page
      .evaluate(() => {
        const p = document.querySelector("#match-ht-panel");
        if (p && !p.classList.contains("hidden") && getComputedStyle(p).display !== "none") {
          document.querySelector("#btn-ht-skip")?.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (ht) log("中场：不调整，直接踢");
    await closeModalIfAny(page);
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `${outDir}/frames/999-final.png` }).catch(() => {});
  log(finished ? "终场" : "⚠ 超时未等到终场");

  writeFileSync(
    `${outDir}/samples.json`,
    JSON.stringify({ speed: SPEED, finished, errors, tickerSeen, samples }),
    "utf8"
  );

  // ── 离线指标：只用画面坐标（= 观众看到的）──────────────────────────────
  const live = samples.filter((s) => s.players.length >= 20 && s.ball);
  const med = (a) => {
    const b = [...a].sort((x, y) => x - y);
    return b.length ? b[Math.floor(b.length / 2)] : NaN;
  };
  const rows = { home: [], away: [] };
  let stillPairs = 0;
  let movePairs = 0;
  for (let i = 0; i < live.length; i++) {
    const s = live[i];
    for (const team of ["home", "away"]) {
      const out = s.players.filter((p) => p.team === team && p.pos !== "GK" && !p.hidden);
      if (out.length < 8) continue;
      const ys = out.map((p) => p.y);
      const xs = out.map((p) => p.x);
      const nearBall = out.filter((p) => Math.hypot((p.x - s.ball.x) * MX, (p.y - s.ball.y) * MY) < 10).length;
      rows[team].push({
        depthM: (Math.max(...ys) - Math.min(...ys)) * MY,
        widthM: (Math.max(...xs) - Math.min(...xs)) * MX,
        nearBall,
      });
    }
    const prev = live[i - 1];
    if (prev && s.wall - prev.wall < 2500 && s.clock !== prev.clock) {
      const byId = new Map(prev.players.map((p) => [p.id, p]));
      for (const p of s.players) {
        const q = byId.get(p.id);
        if (!q || p.pos === "GK") continue;
        const d = Math.hypot((p.x - q.x) * MX, (p.y - q.y) * MY);
        if (d < 0.3) stillPairs++;
        else movePairs++;
      }
    }
  }
  const clocks = [...new Set(samples.map((s) => s.clock))];
  console.log("\n=== 整场观赛摘要 ===");
  console.log(`终场：${finished ? "是" : "否"}｜采样 ${samples.length}｜截图 ${shots}｜页面错误 ${errors.length}`);
  console.log(`时钟覆盖：${clocks[0]} → ${clocks[clocks.length - 1]}（${clocks.length} 个不同读数）`);
  console.log(`比分：${samples[samples.length - 1]?.score}`);
  for (const team of ["home", "away"]) {
    const r = rows[team];
    if (!r.length) continue;
    console.log(
      `${team}：阵型纵深中位 ${med(r.map((x) => x.depthM)).toFixed(1)} m｜宽度中位 ${med(r.map((x) => x.widthM)).toFixed(1)} m｜` +
        `球 10 m 内本队人数中位 ${med(r.map((x) => x.nearBall))}`
    );
  }
  console.log(
    `相邻采样（比赛时钟在走）外场球员位移 <0.3 m 的占比：${((stillPairs / Math.max(1, stillPairs + movePairs)) * 100).toFixed(1)}%`
  );
  console.log(`解说/字幕 ${tickerSeen.length} 条，原始数据 → .tmp-watch/full-match/samples.json`);
  for (const e of errors.slice(0, 8)) console.log("  " + e);
} finally {
  if (browser) await browser.close();
  server.kill();
}
