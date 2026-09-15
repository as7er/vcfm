// 复核弹窗（战术复核 / 运动片段诊断）小球场的几何探针。
//
// 为什么单独写一个：showMotionDiagnostic 只要求 clip.frames.length，不需要开赛，
// 所以这个探针可以在几秒内跑完，不必等 24 场模拟或一场完整比赛。
//
// 它同时量三样东西，放在同一把尺子上：
//   1) 现在的实现（js/main.js 的 motionPitchSvg）
//   2) 旧实现（viewBox="0 0 100 100"）——作为自校准：如果这把尺子量不出旧实现的
//      0.6476 倍压扁，那它量出来的「现在没问题」也不可信
//   3) 容器 .motion-review-pitch 的实际盒子宽高比
//
// 用法：node scripts/_motion-review-geometry-probe.mjs
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const port = 8878;
// 注意：不要用 mkdirSync(new URL(...)) —— 沙箱的 fs broker 会抛 ERR_INVALID_URL_SCHEME，
// 必须在第一次调用就死掉。用 node:path 拼字符串。
const outDir = path.resolve(
  new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  ".tmp-continuity",
  `motion-review-geometry-${Date.now()}`
);
mkdirSync(outDir, { recursive: true });
const baseUrl = `http://127.0.0.1:${port}/`;
const server = spawn("python", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  stdio: "ignore",
  windowsHide: true,
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("local probe server did not start");
}

// 旧实现的 SVG，逐字保留，用来证明测量方法能抓到缺陷。
const LEGACY_SVG = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <rect x="1" y="1" width="98" height="98" fill="#17633a" stroke="rgba(255,255,255,.82)" stroke-width=".55"/>
    <line x1="1" y1="50" x2="99" y2="50" stroke="rgba(255,255,255,.72)" stroke-width=".45"/>
    <circle cx="50" cy="50" r="9.15" fill="none" stroke="rgba(255,255,255,.72)" stroke-width=".45"/>
    <circle cx="50" cy="50" r="2.45" fill="#22c55e" stroke="#f8fafc" stroke-width="0.55"/>
    <circle cx="40" cy="60" r="1.15" fill="#fff" stroke="#111827" stroke-width="0.65"/>
  </svg>`;

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: VIEWPORTS[0] });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.vcfmMainApi);

  const rows = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const measured = await page.evaluate((legacySvg) => {
      // 量渲染后的真实像素宽高比。getBoundingClientRect 会带上祖先 transform，
      // 这个弹窗没有 transform，所以量到的就是真实像素。
      const aspect = (el) => {
        if (!el) return 0;
        const box = el.getBoundingClientRect();
        return box.height > 0 ? box.width / box.height : 0;
      };
      const clip = {
        metadata: { home: { name: "H", color: "#22c55e" }, away: { name: "A", color: "#ef4444" }, matchSeed: 1 },
        range: { durationSeconds: 1.5 },
        incidents: [],
        frames: Array.from({ length: 4 }, (_, index) => {
          const players = Array.from({ length: 22 }, (_, i) => ({
            id: `p${i}`,
            num: i + 1,
            team: i < 11 ? "home" : "away",
            x: 8 + ((i * 7) % 84),
            y: 8 + ((i * 11) % 84),
            movementTarget: i === 0 ? { x: 30, y: 40 } : null,
          }));
          return {
            t: index * 0.5,
            engine: { players, ball: { x: 52, y: 48 } },
            display: { players, ball: { x: 52, y: 48 } },
          };
        }),
      };
      // 弹窗挂在 #screen-match 里，未激活时祖先 display:none，量出来全是 0×0。
      // 必须先切到比赛屏，否则这把尺子量的是空气。
      document.querySelector("#screen-main")?.classList.remove("active");
      document.querySelector("#screen-match")?.classList.add("active");
      window.vcfmMainApi.showMotionDiagnostic(clip);
      const box = document.querySelector("#match-motion-engine-pitch");
      const svg = box?.querySelector("svg");
      const directEllipses = svg ? [...svg.querySelectorAll(":scope > ellipse")] : [];

      // 自校准：把旧实现塞进同一个容器类里量一遍
      const legacyHost = document.createElement("div");
      legacyHost.className = "motion-review-pitch";
      legacyHost.style.cssText = "position:fixed;left:-9999px;top:0;";
      legacyHost.innerHTML = legacySvg;
      document.body.appendChild(legacyHost);
      const legacySvgEl = legacyHost.querySelector("svg");
      const legacy = {
        circle: aspect(legacySvgEl.querySelector("circle")),
        player: aspect(legacySvgEl.querySelectorAll("circle")[1]),
        box: legacyHost.clientHeight ? legacyHost.clientWidth / legacyHost.clientHeight : 0,
      };
      legacyHost.remove();

      const result = {
        viewBox: svg?.getAttribute("viewBox") || "",
        preserveAspectRatio: svg?.getAttribute("preserveAspectRatio") || "",
        pitchBox: box && box.clientHeight ? box.clientWidth / box.clientHeight : 0,
        pitchBoxPx: box ? `${box.clientWidth}x${box.clientHeight}` : "0x0",
        circle: aspect(directEllipses[0]),
        ball: aspect(directEllipses[directEllipses.length - 1]),
        player: aspect(svg?.querySelector("g:not(.motion-target) ellipse")),
        target: aspect(svg?.querySelector(".motion-target ellipse")),
        playerCount: svg?.querySelectorAll("g:not(.motion-target)").length || 0,
        legacy,
      };
      window.vcfmMainApi.closeMotionDiagnostic();
      return result;
    }, LEGACY_SVG);
    rows.push({ viewport: `${viewport.width}x${viewport.height}`, ...measured });

    // 并排截图：同一个容器类，左边现在的实现，右边旧实现。数字之外留一份肉眼可查的证据。
    await page.evaluate((legacySvg) => {
      document.querySelector("#probe-compare")?.remove();
      const host = document.createElement("div");
      host.id = "probe-compare";
      host.style.cssText =
        "position:fixed;left:0;top:0;z-index:999999;background:#0b1220;padding:10px;display:flex;gap:10px;font:12px system-ui;color:#e5edf6";
      const live = document.querySelector("#match-motion-engine-pitch");
      for (const [label, html] of [["fixed (0 0 100 150)", live?.innerHTML || ""], ["legacy (0 0 100 100)", legacySvg]]) {
        const column = document.createElement("div");
        column.innerHTML = `<div style="text-align:center;margin-bottom:4px">${label}</div><div class="motion-review-pitch">${html}</div>`;
        host.appendChild(column);
      }
      document.body.appendChild(host);
    }, LEGACY_SVG);
    await page.locator("#probe-compare").screenshot({ path: path.join(outDir, `motion-review-${viewport.width}x${viewport.height}.png`) });
    await page.evaluate(() => document.querySelector("#probe-compare")?.remove());
  }

  const f = (value) => Number(value).toFixed(4);
  console.log("\n=== 复核弹窗小球场几何 ===");
  console.log("视口        | 盒子(px)      | 盒子比   | viewBox     | 中圈     | 球员点   | 球       | 旧中圈   | 旧球员点");
  console.log("------------|---------------|----------|-------------|----------|----------|----------|----------|---------");
  for (const row of rows) {
    console.log(
      [
        row.viewport.padEnd(11),
        row.pitchBoxPx.padEnd(13),
        f(row.pitchBox).padEnd(8),
        row.viewBox.padEnd(11),
        f(row.circle).padEnd(8),
        f(row.player).padEnd(8),
        f(row.ball).padEnd(8),
        f(row.legacy.circle).padEnd(8),
        f(row.legacy.player).padEnd(8),
      ].join(" | ")
    );
  }

  const target = 68 / 105;
  const problems = [];
  for (const row of rows) {
    if (Math.abs(row.pitchBox - target) > 0.005) problems.push(`${row.viewport}: 盒子比 ${f(row.pitchBox)} ≠ 68/105`);
    if (row.viewBox !== "0 0 100 150") problems.push(`${row.viewport}: viewBox ${row.viewBox} ≠ 0 0 100 150`);
    if (row.playerCount !== 22) problems.push(`${row.viewport}: 球员 ${row.playerCount} ≠ 22`);
    for (const [key, value] of [
      ["中圈", row.circle],
      ["球员点", row.player],
      ["球", row.ball],
      ["跑位目标", row.target],
    ]) {
      if (!(value > 0.97 && value < 1.03)) problems.push(`${row.viewport}: ${key} 宽高比 ${f(value)} 不是圆`);
    }
    // 自校准：旧实现必须被量出明显压扁，否则这把尺子不可信
    if (!(row.legacy.circle < 0.68)) problems.push(`${row.viewport}: 自校准失败，旧中圈 ${f(row.legacy.circle)} 应≈0.65`);
  }
  if (pageErrors.length) problems.push(`浏览器错误: ${pageErrors.join(" | ")}`);

  console.log("");
  console.log(`并排截图（左修复后 / 右修复前）: ${outDir}`);
  if (problems.length) {
    for (const problem of problems) console.log(`FAIL ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`运动片段复核弹窗几何探针通过（${rows.length} 档视口，旧实现被量出 ≈0.65 的压扁，说明尺子有效）`);
  }
} finally {
  await browser?.close();
  server.kill();
}
