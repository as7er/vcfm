/**
 * 把 `.tmp-watch/frames/*.png` 拼成一张可翻阅的页面（给人看，不入 Git）。
 *
 * 为什么需要它：`_live-visual-audit.mjs` 采到的是**一堆 PNG**；
 * 一张张点开没法看出「连续性」（瞬移、抖、闪都是**跨帧**才看得出来的）。
 * 本脚本把它们按时间顺序铺在一页里，并附带每帧的采样时刻。
 *
 * 用法：node scripts/_watch-contact-sheet.mjs [每行列数=4]
 * 产物：`.tmp-watch/index.html`（用 PI 内置浏览器打开即可）
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const watchDir = root + ".tmp-watch";
const frameDir = watchDir + "/frames";
const cols = Math.max(1, Number(process.argv[2]) || 4);

if (!existsSync(frameDir)) {
  console.error(`没有帧目录：${frameDir}（先跑 scripts/_live-visual-audit.mjs）`);
  process.exit(1);
}

const files = readdirSync(frameDir)
  .filter((f) => f.endsWith(".png"))
  .sort();

// 采样节拍：截图间隔（秒）—— 用来标注「这是第几秒的画面」
const SHOT_INTERVAL_S = 2.2;

// 尽量把每帧对应的采样读数也贴出来（有就贴，没有就只标时刻）
let samples = [];
const samplesPath = watchDir + "/samples.json";
if (existsSync(samplesPath)) {
  try {
    samples = JSON.parse(readFileSync(samplesPath, "utf8")).samples || [];
  } catch {
    samples = [];
  }
}

const near = (t) => {
  if (!samples.length) return null;
  let best = samples[0];
  for (const s of samples) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  return best;
};

const cards = files.map((f, i) => {
  const t = i * SHOT_INTERVAL_S;
  const s = near(t);
  const bits = [];
  if (s) {
    if (s.dom?.clock) bits.push(`时钟 ${s.dom.clock}`);
    if (s.dom?.score) bits.push(`比分 ${s.dom.score}`);
    if (Number.isFinite(s.fade) && s.fade > 0.01) bits.push(`遮罩 ${s.fade.toFixed(2)}`);
    if (s.cam?.zoom != null) bits.push(`zoom ${s.cam.zoom}`);
    if (s.players?.length) {
      // 队内最紧的两名球员相距多少米（<2m 基本就是叠在一起）
      let minD = Infinity;
      for (let a = 0; a < s.players.length; a += 1) {
        for (let b = a + 1; b < s.players.length; b += 1) {
          const d = Math.hypot((s.players[a].x - s.players[b].x) * 0.68, (s.players[a].y - s.players[b].y) * 1.05);
          if (d < minD) minD = d;
        }
      }
      bits.push(`最近两人 ${minD.toFixed(1)}m`);
    }
  }
  return `<figure>
  <img src="frames/${f}" alt="${f}" loading="lazy" />
  <figcaption><b>${f}</b> · ~${t.toFixed(1)}s${bits.length ? ` · ${bits.join(" · ")}` : ""}</figcaption>
</figure>`;
});

const html = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<title>VCFM 直播观赛取证 · ${files.length} 帧</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 16px 20px 40px; background: #0f1216; color: #e6e9ee;
         font: 14px/1.5 system-ui, "Segoe UI", sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.hint { margin: 0 0 16px; color: #9aa4b2; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 12px; }
  figure { margin: 0; background: #171b21; border: 1px solid #252b34; border-radius: 8px; overflow: hidden; }
  img { display: block; width: 100%; height: auto; background: #0b0d10; }
  figcaption { padding: 6px 8px; font-size: 12px; color: #9aa4b2; }
  figcaption b { color: #cdd4de; }
</style>
</head>
<body>
<h1>VCFM 直播观赛取证</h1>
<p class="hint">${files.length} 帧，约每 ${SHOT_INTERVAL_S}s 一帧。点开任一帧看原图。
判据：整队一起跳 = 换镜头（该被遮罩盖住）；只有球+少数人跳 = 物理/搬运问题。</p>
<div class="grid">
${cards.join("\n")}
</div>
</body>
</html>
`;

writeFileSync(watchDir + "/index.html", html, "utf8");
console.log(`已生成 ${watchDir}/index.html（${files.length} 帧，${cols} 列）`);
