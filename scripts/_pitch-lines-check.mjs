/**
 * 球场标线对齐验证（临时工具，不进 verify）。
 *
 * 把「旧标线」「新标线」与「引擎判定边界」叠在同一张图上，确认禁区/边线是否
 * 与 `_inOwnFoulBox`（x 22-78、home y>=84）逐格对齐。
 * 黄色虚线 = 引擎真相；白色 = SVG 画出来的线。两者重合才算对齐。
 *
 * 用法：node scripts/_pitch-lines-check.mjs
 * 产物：artifacts/pitch-lines-before-after.png
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const OLD_SVG = `
  <rect x="3" y="3" width="94" height="144" fill="none" stroke="rgba(255,255,255,0.78)" stroke-width="0.7"/>
  <line x1="3" y1="75" x2="97" y2="75" stroke="rgba(255,255,255,0.7)" stroke-width="0.55"/>
  <circle cx="50" cy="75" r="12" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
  <rect x="21" y="117" width="58" height="30" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
  <rect x="33" y="131" width="34" height="16" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
  <path d="M 37 117 A 13 13 0 0 1 63 117" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.5"/>
  <circle cx="50" cy="127" r="0.6" fill="rgba(255,255,255,0.75)"/>
  <rect x="21" y="3" width="58" height="30" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
  <rect x="33" y="3" width="34" height="16" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.55"/>
  <path d="M 37 33 A 13 13 0 0 0 63 33" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.5"/>
`;

// 从改好的 matchview.js 里把新标线抠出来，保证验证的就是真代码
const source = readFileSync(new URL("../js/matchview.js", import.meta.url), "utf8");
const match = source.match(/<svg class="mp-lines"[\s\S]*?<\/svg>/);
if (!match) throw new Error("could not find the mp-lines svg in matchview.js");
const NEW_SVG = match[0].replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

// 引擎真相：_inOwnFoulBox → x 22-78, home y>=84 / away y<=16；场地 0-100
const ENGINE = `
  <g stroke="#fde047" stroke-width="0.6" fill="none" stroke-dasharray="2 1.5">
    <rect x="0" y="0" width="150" height="100"/>
    <rect x="0" y="22" width="24" height="56"/>
    <rect x="126" y="22" width="24" height="56"/>
  </g>
  <g fill="#fde047" font-size="3.2" font-family="system-ui">
    <text x="26" y="20">y=84 引擎禁区线（画面左）</text>
  </g>
`;

// 探针球员：验证「看着在禁区里 vs 引擎判定」
const PROBES = [
  { x: 50, y: 80, label: "y=80", note: "旧线内/引擎外" },
  { x: 50, y: 84, label: "y=84", note: "引擎禁区线" },
  { x: 30, y: 99, label: "y=99", note: "旧线外/引擎内" },
];
const probeSvg = PROBES.map((p) =>
  `<circle cx="${(100 - p.y) * 1.5}" cy="${p.x}" r="1.6" fill="#f97316" stroke="#fff" stroke-width="0.4"/>` +
  `<text x="${(100 - p.y) * 1.5 + 2.6}" y="${p.x + 1}" fill="#f97316" font-size="3" font-family="system-ui">${p.label} ${p.note}</text>`
).join("");

const panel = (title, inner) => `
<div class="col">
  <div class="cap">${title}</div>
  <div class="field">
    <svg viewBox="0 0 150 100" preserveAspectRatio="none">${inner}${ENGINE}${probeSvg}</svg>
  </div>
</div>`;

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0b1220;color:#e5e7eb;font:13px system-ui,"Microsoft YaHei",sans-serif;padding:16px}
h1{font-size:15px;margin:0 0 4px}
.sub{color:#94a3b8;font-size:12px;margin:0 0 12px}
.row{display:flex;gap:18px}
.col{width:420px}
.cap{font-size:12px;color:#cbd5e1;padding:0 0 6px}
.field{position:relative;width:420px;aspect-ratio:105/68;background:#15803d;border-radius:8px;overflow:hidden}
svg{position:absolute;inset:0;width:100%;height:100%}
.legend{margin-top:12px;font-size:12px;color:#94a3b8}
b{color:#fde047}
</style></head><body>
<h1>球场标线 vs 引擎判定</h1>
<p class="sub">黄色虚线 = 引擎真相（_inOwnFoulBox: x 22-78, y≥84；场地 0-100）。白色 = SVG 画出的线。橙点 = 探针球员。</p>
<div class="row">
  ${panel("修改前", OLD_SVG)}
  ${panel("修改后", NEW_SVG)}
</div>
<div class="legend">对齐判据：白色禁区框与<b>黄色虚线框</b>重合；白色边线与<b>黄色外框</b>重合。</div>
</body></html>`;

mkdirSync("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 920, height: 780 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
await page.setContent(html);
await page.waitForTimeout(300);
await page.screenshot({ path: "artifacts/pitch-lines-before-after.png", fullPage: true });
await browser.close();
console.log("wrote artifacts/pitch-lines-before-after.png");
