/**
 * 切段淡场静态 + 行为接线检查（2026-09-21 v277）。
 *
 * 用户报「整队瞬移」已判决为场景切换（全队一起跳，不是物理 bug），
 * 但遮住它的淡场峰值只到 72%、reduced-motion 下更是完全透明，
 * 且开球会因 `Number(null)===0` 多闪一次。详见
 * `docs/handoff-2026-09-21b.md` 与
 * `docs/measurements/segment-boundary-displacement-2026-09-21.txt`。
 *
 * 本检查 1 秒内跑完，守三处表现层回归；不替代 Playwright 探针
 * `scripts/_segment-boundary-displacement.mjs`（那条才能量跳变帧的
 * 真实 `fadeOpacity`）。
 *
 * 1. `_enterSegmentTransition` 必须在 `Number()` 之前用 `== null` 拦初值：
 *    `Number(null)===0` 且 `isFinite(0)` 为真 ⇒ 开球多闪一次淡场。
 *    同时用替身 `this` 真调原型方法，钉死 `null` 初值走 `first`、
 *    跨段走 `cut`、倒带走 `cut`、相接走 `first`。
 * 2. `@keyframes mp-seg-cut-fade` 峰值必须是 1，且 0% 之后还有一段全遮。
 * 3. `prefers-reduced-motion` 下 `.mp-seg-cut::before` 必须静态全遮
 *    （`animation:none; opacity:1`），不能是 `opacity:0`。
 */
import { readFileSync } from "node:fs";

import { MatchView } from "../js/matchview.js";

const css = readFileSync("css/style.css", "utf8");
const mv = readFileSync("js/matchview.js", "utf8");

let failed = 0;
function check(ok, label, detail = "") {
  const mark = ok ? "  ✓" : "  ✗";
  console.log(`${mark} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 取**定义处**的方法体。
 *
 * ⚠ 首版这里是 `src.indexOf(signature)` —— 命中的是**调用点**，不是定义：
 *   `_enterSegmentTransition` 在 `js/matchview.js:892` 被 `this.` 调用（定义在 `:1212`），
 *   `_playSegmentCut` 在 `:1252` 被 `this.` 调用（定义在 `:1257`）。
 *   于是下面几条断言去数了**别人的花括号**，7 项假红 —— 当时产品代码其实是对的。
 *   判据：定义行长 `  _foo(args) {`；调用行长 `      this._foo(args);` 或 `= this._foo(args);`
 *   ⇒ 必须锚在**行首缩进**上、且签名后紧跟 `{`，调用点天然被排除。
 */
function bodyOf(src, signature) {
  const re = new RegExp(`^[ \\t]*${escapeRe(signature)}[ \\t]*\\{`, "m");
  const m = re.exec(src);
  if (!m) return "";
  const open = src.indexOf("{", m.index);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

console.log("\n[1] 开球守卫（js/matchview.js `_enterSegmentTransition`）");
{
  const body = bodyOf(mv, "_enterSegmentTransition(frames)");
  // 体长区间是**双保险**：太小 = 抓错了块（首版抓到 15 字符），
  // 太大 = 把文件后半截吞了进来。真实定义体实测 1949 字符（`_playSegmentCut` 是 399）。
  check(
    body.length > 500 && body.length < 20000,
    "定位到 `_enterSegmentTransition(frames)` 的**定义体**",
    `长度 ${body.length}`
  );
  // 必须留住原始值：`Number(null)===0` 会穿过 isFinite。
  check(/prevEndRaw/.test(body), "读取原始 `_segLastEndSimT` 到 `prevEndRaw`（先于 Number()）");
  check(
    /prevEndRaw\s*==\s*null/.test(body),
    "守卫含 `prevEndRaw == null`（同时覆盖 null / undefined）"
  );
  const nullIdx = body.search(/prevEndRaw\s*==\s*null/);
  const finiteIdx = body.search(/Number\.isFinite\(\s*prevEnd\s*\)/);
  check(finiteIdx >= 0, "守卫仍保留 `Number.isFinite(prevEnd)`（拦住 NaN）");
  check(
    nullIdx >= 0 && finiteIdx >= 0 && nullIdx < finiteIdx,
    "`== null` 出现在 `isFinite(prevEnd)` 之前（短路，避免 Number(null) 漏过）"
  );
}

console.log("\n[2] 行为：替身 this 调原型方法");
{
  function stub(prev) {
    return {
      _segLastEndSimT: prev,
      _cutCalled: false,
      _playSegmentCut() { this._cutCalled = true; },
    };
  }
  const call = (prev, frames) =>
    MatchView.prototype._enterSegmentTransition.call(stub(prev), frames);

  const kickoff = call(null, [{ t: 0.1 }]);
  check(kickoff.mode === "first", "初值 null + t0=0.1 → mode first（开球不闪）", JSON.stringify(kickoff));
  check(kickoff.gapSec == null, "开球 gapSec 为 null（没有上一段）");

  const undef = call(undefined, [{ t: 0.1 }]);
  check(undef.mode === "first", "初值 undefined → mode first");

  const nan = call(Number.NaN, [{ t: 0.1 }]);
  check(nan.mode === "first", "初值 NaN → mode first");

  const missingT = call(125, [{}]);
  check(missingT.mode === "first", "t0 非 finite → mode first");

  const empty = call(125, []);
  check(empty.mode === "first", "空帧表 → mode first");

  // 真跨段：必须淡场。用一个会记录调用的 stub 再跑一次。
  {
    const s = stub(125);
    const r = MatchView.prototype._enterSegmentTransition.call(s, [{ t: 238.8 }]);
    check(r.mode === "cut", "跨段 125 → 238.8 → mode cut", JSON.stringify(r));
    check(Math.abs(r.gapSec - 113.8) < 1e-9, "跨段 gapSec = 113.8");
    check(s._cutCalled === true, "跨段调用了 `_playSegmentCut`");
  }

  const abut = call(125, [{ t: 125 }]);
  check(abut.mode === "first" && abut.gapSec === 0, "两窗相接 gap===0 → mode first（不闪）");

  {
    const s = stub(243.3);
    const r = MatchView.prototype._enterSegmentTransition.call(s, [{ t: 231.8 }]);
    check(r.mode === "cut", "倒带 243.3 → 231.8 → mode cut（必须淡场）", JSON.stringify(r));
    check(r.gapSec < 0, "倒带 gapSec < 0");
    check(s._cutCalled === true, "倒带调用了 `_playSegmentCut`");
  }

  // 合法的 prevEnd=0（不是初值 null）仍应走 cut：证明我们拦的是 null，不是 0。
  {
    const s = stub(0);
    const r = MatchView.prototype._enterSegmentTransition.call(s, [{ t: 0.1 }]);
    check(r.mode === "cut", "prevEnd=0（已播过）+ t0=0.1 → mode cut", JSON.stringify(r));
    check(s._cutCalled === true, "prevEnd=0 仍调用 `_playSegmentCut`");
  }
}

console.log("\n[3] 淡场峰值（css/style.css `@keyframes mp-seg-cut-fade`）");
{
  // 不能用非贪婪 `[\s\S]*?\}`：0% 那一行自己就有 `}`，会把 35%/100% 截掉。
  const kfStart = css.search(/@keyframes\s+mp-seg-cut-fade\s*\{/);
  check(kfStart >= 0, "存在 `@keyframes mp-seg-cut-fade`");
  const open = kfStart >= 0 ? css.indexOf("{", kfStart) : -1;
  let body = "";
  if (open >= 0) {
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          body = css.slice(open + 1, i);
          break;
        }
      }
    }
  }
  check(/0%\s*\{\s*opacity:\s*1\s*;?\s*\}/.test(body), "0% 峰值 opacity: 1（跳变帧全遮）");
  check(
    !/0%\s*\{\s*opacity:\s*0\.72\s*;?\s*\}/.test(body),
    "0% 不再是 0.72（v276 的缺陷）"
  );
  // 0% 之后必须还有一段全遮，否则一跳完立刻变透。
  check(
    /35%\s*\{\s*opacity:\s*1\s*;?\s*\}/.test(body),
    "35% 仍是 opacity: 1（保持曲段，避免跳完立刻变透）"
  );
  check(/100%\s*\{\s*opacity:\s*0\s*;?\s*\}/.test(body), "100% 淡到 opacity: 0");
}

console.log("\n[4] reduced-motion 下必须静态全遮，不能裸露");
{
  // 只认跟 `.mp-seg-cut` 绑在一起的那条，避免误伤页首/横屏提示的 reduce 块。
  const blocks = [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/g)];
  const hit = blocks.find((m) => /mp-seg-cut/.test(m[1]));
  check(!!hit, "存在针对 `.mp-seg-cut` 的 `prefers-reduced-motion: reduce` 块");
  const body = hit ? hit[1] : "";
  check(
    /\.mp-field\.mp-seg-cut::before\s*\{[^}]*animation:\s*none/.test(body),
    "reduced-motion 下 `animation: none`（不引入动画）"
  );
  check(
    /\.mp-field\.mp-seg-cut::before\s*\{[^}]*opacity:\s*1/.test(body),
    "reduced-motion 下 `opacity: 1`（静态全遮）"
  );
  check(
    !/\.mp-field\.mp-seg-cut::before\s*\{[^}]*opacity:\s*0/.test(body),
    "reduced-motion 下不再 `opacity: 0`（那等于没有遮罩）"
  );
}

console.log("\n[5] `_playSegmentCut` 仍会摘 class（遮罩不粘）");
{
  const body = bodyOf(mv, "_playSegmentCut()");
  check(
    body.length > 200 && body.length < 20000,
    "定位到 `_playSegmentCut()` 的**定义体**",
    `长度 ${body.length}`
  );
  check(/classList\.add\(\s*"mp-seg-cut"\s*\)/.test(body), "加 `.mp-seg-cut`");
  check(/classList\.remove\(\s*"mp-seg-cut"\s*\)/.test(body), "定时器到时摘 `.mp-seg-cut`");
  check(/SEGMENT_CUT_MS\s*\+\s*40/.test(body), "摘 class 的延迟是 `SEGMENT_CUT_MS + 40`");
}

if (failed) {
  console.error(`\nsegment-cut-fade-verify: ${failed} 项失败`);
  process.exit(1);
}
console.log("\nsegment-cut-fade-verify: ok");
