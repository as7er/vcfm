/*
 * _camera-framing-geometry-probe.mjs — 表现层 A2 镜头公式的几何验证
 *
 * 背景（2026-09-05）：A2 把 cameraFraming 的位移/钳制参数化了，但注释里的推导
 * 假设「scale 关于左上角原点」；真实 CSS 是 transform-origin: 50% 50%（中心），
 * 且 .mp-camera 在父容器里左右各内缩 5.5%、垂直满高——横纵两轴窗口并不对称。
 * 本探针把真实 CSS 几何建模出来，对公式做逐格断言：
 *   1) 球必须在可见窗口内（跟镜的基本职责）；
 *   2) 可见窗口必须 ⊆ 草皮 [-2, 102]（不露场外，A2 的设计意图）。
 *
 * 真实几何（对照 css/style.css）：
 *   .mp-camera  { left/right: 5.5%; top/bottom: 0; transform-origin: 50% 50% }
 *   .mp-grass   { inset: -2% }   → 草皮在相机坐标 [-2, 102]
 *   .mp-field   { overflow: hidden } → 父容器裁剪 = 屏幕窗口
 *   transform   = translate(tx%, ty%) scale(s)（_applyCamera 生成，先 scale 后 translate）
 *
 *   相机内容坐标 c（= 球场坐标 [0,100]）映射到父容器（屏幕）百分比：
 *     横轴：P(c) = 0.89·s·c + 50 − 44.5·s + 0.89·tx     （相机宽 = 场宽 89%）
 *     纵轴：P(v) =      s·v + 50 −   50·s +     ty      （相机高 = 场高 100%）
 *   可见窗口（P ∈ [0,100] 的内容坐标区间）：
 *     横轴：[50 − (50/0.89)/s − tx/s, 50 + (50/0.89)/s − tx/s]   中心 50 − tx/s
 *     纵轴：[50 − 50/s − ty/s,        50 + 50/s − ty/s]          中心 50 − ty/s
 *
 * 由此反推的正确公式：
 *     居中球：tx = −50·s·ox（横纵同型）
 *     钳制横轴：tx ∈ [50/0.89 − 52s, 52s − 50/0.89] = ±(52s − 56.18)
 *     钳制纵轴：ty ∈ [50 − 52s, 52s − 50]           = ±(52s − 50)
 *
 * 档位 scale（1.28~1.5）取自真实模块的返回值——本探针只验证几何数学，
 * 不复制档位选择逻辑（探针守则：import 真实现，不抄公式）。
 *
 * 用法：node scripts/_camera-framing-geometry-probe.mjs
 */

import { cameraFraming } from "../js/match-broadcast.js";

// ---- 真实 CSS 几何常量（改 CSS 必须同步这里，见文件头推导） ----
const CAM_H = 0.89; // 横向后 .mp-camera top/bottom 5.5% → 高 = 场高 89%
const GRASS = 2; // .mp-grass inset -2% → 草皮边缘在相机坐标 -2 / 102
const EPS = 1e-9;

/** 相机内容坐标 → 屏幕（父容器）百分比 */
function toScreen(c, { axis, s, t }) {
  if (axis === "v") return CAM_H * s * c + 50 - 50 * s * CAM_H + CAM_H * t;
  return s * c + 50 - 50 * s + t;
}

/** 可见窗口（屏幕 [0,100] 对应的内容坐标区间） */
function windowOf(axis, s, t) {
  const half = 50 / (axis === "v" ? CAM_H : 1) / s;
  const center = 50 - t / s;
  return { lo: center - half, hi: center + half, center };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- 被测公式 ----
// 现行（A2 落地版）：中心推导用了左上原点模型 + 钳制界限错位
const CURRENT = {
  label: "current (A2 as landed)",
  target: (o, s) => -50 * (s - 1) - 50 * s * o,
  bounds: (s) => ({ loH: 100 - 102 * s, hiH: 2 * s, loV: 100 - 102 * s, hiV: 2 * s }),
};
// 修正版：中心原点 + 相机左右内缩 5.5% 的真实几何
const FIXED = {
  label: "fixed (center-origin + 5.5% inset)",
  target: (o, s) => -50 * s * o,
  bounds: (s) => ({
    loH: 50 - 52 * s,
    hiH: 52 * s - 50,
    loV: 50 / CAM_H - 52 * s,
    hiV: 52 * s - 50 / CAM_H,
  }),
};

/** 对给定球位与 scale，量化一个公式的三条几何指标 */
function evaluate(def, ball, s) {
  const sx = 100 - ball.y;
  const sy = ball.x;
  const ox = (sx - 50) / 50;
  const oy = (sy - 50) / 50;
  const { loH, hiH, loV, hiV } = def.bounds(s);
  const tx = clamp(def.target(ox, s), loH, hiH);
  const ty = clamp(def.target(oy, s), loV, hiV);
  const winH = windowOf("h", s, tx);
  const winV = windowOf("v", s, ty);
  // 球到窗口边缘的余量（相机坐标 %）；负 = 球出画
  const margin = Math.min(sx - winH.lo, winH.hi - sx, sy - winV.lo, winV.hi - sy);
  // 窗口超出草皮 [-2,102] 的宽度（相机坐标 %）
  const overhang =
    Math.max(0, -GRASS - winH.lo) + Math.max(0, winH.hi - (100 + GRASS)) +
    Math.max(0, -GRASS - winV.lo) + Math.max(0, winV.hi - (100 + GRASS));
  return { def: def.label, ball, s, tx, ty, margin, overhang };
}

// 球位网格：全场 11×11 + 极端六点
const ballGrid = [];
for (let x = 0; x <= 100; x += 10) {
  for (let y = 0; y <= 100; y += 10) ballGrid.push({ x, y });
}
for (const p of [{ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 0, y: 50 }, { x: 100, y: 50 }]) {
  if (!ballGrid.some((b) => b.x === p.x && b.y === p.y)) ballGrid.push(p);
}

// 档位触发参数（mode/boosted 只为把 5 档 scale 都打出来；deep 由 ball.y 自然触发）
const TIER_MODES = [
  { mode: "follow", boosted: false, name: "wide/deep" },
  { mode: "follow", boosted: true, name: "boosted" },
  { mode: "box", boosted: false, name: "tight" },
  { mode: "box", boosted: true, name: "tight+boosted" },
];

function runSuite(def) {
  const rows = [];
  for (const tm of TIER_MODES) {
    for (const ball of ballGrid) {
      const real = cameraFraming({ preset: "tv", ball, mode: tm.mode, boosted: tm.boosted });
      rows.push(evaluate(def, ball, real.scale));
    }
  }
  return rows;
}

function summarize(rows, label) {
  const ballOut = rows.filter((r) => r.margin < -EPS);
  const tightest = rows.reduce((a, b) => (b.margin < a.margin ? b : a));
  const voidCases = rows.filter((r) => r.overhang > 0.01);
  const worstVoid = rows.reduce((a, b) => (b.overhang > a.overhang ? b : a));
  console.log(`\n== ${label} ==`);
  console.log(`  球出画格数: ${ballOut.length} / ${rows.length}`);
  for (const r of ballOut.slice(0, 6)) {
    console.log(`    s=${r.s} ball=(${r.ball.x},${r.ball.y}) margin=${r.margin.toFixed(1)}cam% → 球在画外`);
  }
  console.log(`  最紧球余量: ${tightest.margin.toFixed(2)} cam% @ s=${tightest.s} ball=(${tightest.ball.x},${tightest.ball.y})`);
  console.log(`  露场外格数: ${voidCases.length} / ${rows.length}，最大超界 ${worstVoid.overhang.toFixed(1)} cam% @ s=${worstVoid.s} ball=(${worstVoid.ball.x},${worstVoid.ball.y})`);
  // 球居中时球应落在屏幕正中
  const c = rows.find((r) => r.ball.x === 50 && r.ball.y === 50 && r.s === Math.min(...rows.map((r2) => r2.s)));
  if (c) {
    const px = toScreen(50, { axis: "h", s: c.s, t: c.tx });
    console.log(`  球居中时球的屏幕偏移: ${(px - 50).toFixed(1)}%（应为 0）`);
  }
  return { ballOut: ballOut.length, worstVoid: worstVoid.overhang };
}

// ---- cross-check：探针复算的 tx/ty 必须与真实模块逐格一致 ----
// 只对 FIXED 做交叉核对：FIXED 应当就是已落地进模块的公式；
// CURRENT 仅用于改动前后的对照叙事，模块修掉后自然不再一致。
function crossCheck(def) {
  let bad = 0;
  for (const tm of TIER_MODES) {
    for (const ball of ballGrid) {
      const out = cameraFraming({ preset: "tv", ball, mode: tm.mode, boosted: tm.boosted });
      const mine = evaluate(def, ball, out.scale);
      if (Math.abs(out.x - mine.tx) > 1e-9 || Math.abs(out.y - mine.ty) > 1e-9) {
        bad++;
        if (bad <= 3) console.log(`  ✗ [${def.label}] ball=(${ball.x},${ball.y}) scale=${out.scale}: real=(${out.x.toFixed(3)},${out.y.toFixed(3)}) probe=(${mine.tx.toFixed(3)},${mine.ty.toFixed(3)})`);
      }
    }
  }
  console.log(`cross-check vs js/match-broadcast.js [${def.label}]: ${bad === 0 ? "✅ 逐格一致" : `✗ ${bad} 格不一致`}`);
  return bad;
}

console.log("VCFM 表现层 A2：镜头公式几何验证（真实 CSS：origin 中心 + 相机左右内缩 5.5%）");
const cur = summarize(runSuite(CURRENT), "现行公式（A2 落地版）");
const fix = summarize(runSuite(FIXED), "修正公式");
const ccBad = crossCheck(FIXED);

// ---- 断言：修正版必须过两道几何门，且与真实模块逐格一致 ----
let failed = 0;
if (fix.ballOut > 0) { console.log("\n✗ 修正版仍有球出画"); failed++; }
if (fix.worstVoid > 0.01) { console.log("\n✗ 修正版仍露场外"); failed++; }
if (ccBad > 0) { console.log("✗ 修正版与真实模块不一致（公式没落地或又被改）"); failed++; }
if (cur.ballOut === 0 && cur.worstVoid <= 0.01) console.log("（意外：现行公式也过了两道门——那修正就无必要，复核建模）");
if (failed === 0) console.log("\n✅ 修正版通过：球恒在画内，窗口 ⊆ 草皮 [-2, 102]，且与 js/match-broadcast.js 逐格一致");
process.exit(failed === 0 ? 0 : 1);
