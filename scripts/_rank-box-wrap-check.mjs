// 临时探针：「赛季快照 → 联赛排名」（#my-rank）的换行是否只发生在段与段之间。
// 用户报告：窄卡片里「前 3 名升级」被劈成「前 3 / 名升级」。
// 判据：每个 `.rank-seg` 的 getClientRects() 恰好 1 个（= 段内没断行），并截图。
//
// 用法：node scripts/_rank-box-wrap-check.mjs [输出目录]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 8918;
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = process.argv[2] || `${ROOT}tmp-rank-box`;
mkdirSync(OUT, { recursive: true });

const server = spawn("python", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: ROOT,
  stdio: "ignore",
  windowsHide: true,
});

let browser;
let failures = 0;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });

  for (const [vw, vh] of [[1440, 1000], [1024, 900], [390, 844]]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width: vw, height: vh } });
      page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("vcfm.theme", t);
        } catch {}
      }, theme);
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForFunction(() => !!window.vcfmMainApi, null, { timeout: 90000 });
      await page.fill("#input-manager", "Rank Wrap Check");
      await page.click("#btn-new-game");
      await page.waitForSelector("#screen-main.active", { timeout: 90000 });
      await page.waitForTimeout(1200);
      const dashTab = page.locator('[data-tab="dashboard"], #tab-btn-dashboard').first();
      if (await dashTab.count()) {
        await dashTab.click().catch(() => {});
        await page.waitForTimeout(600);
      }
      const r = await page.evaluate(() => {
        const box = document.querySelector("#my-rank");
        if (!box) return null;
        const b = box.getBoundingClientRect();
        return {
          w: Math.round(b.width),
          h: Math.round(b.height),
          segs: [...box.querySelectorAll(".rank-seg")].map((s) => ({
            text: s.textContent,
            rects: s.getClientRects().length,
          })),
          lines: [...box.children].map((c) => c.textContent.replace(/\s+/g, " ").trim()),
        };
      });
      const tag = `${vw}x${vh}-${theme}`;
      if (!r) {
        console.log(`${tag}: ❌ 找不到 #my-rank`);
        failures++;
      } else {
        const broken = r.segs.filter((s) => s.rects !== 1);
        failures += broken.length ? 1 : 0;
        console.log(
          `${tag}: 盒 ${r.w}×${r.h} · 段 ${r.segs.length} 个 · 段内断行 ${broken.length} 个 ${broken.length ? "❌ " + JSON.stringify(broken) : "✅"}`
        );
        for (const l of r.lines) console.log(`    | ${l}`);
        const card = page.locator("#my-rank").locator("xpath=..");
        await card.screenshot({ path: `${OUT}/rank-${tag}.png` }).catch(() => {});
      }
      await page.close();
    }
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}
console.log(failures ? `\n❌ ${failures} 个视口有段内断行` : "\n✅ 所有视口：换行只发生在段与段之间");
process.exitCode = failures ? 1 : 0;
