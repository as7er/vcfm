/**
 * 全屏观赛（手机横屏）**静态接线检查**。
 *
 * ## 为什么还需要这条（明明有浏览器探针）
 *
 * `scripts/mobile-pitch-adaptation-verify.mjs` 的 ②c 用例是**真正的**浏览器验证
 * （进/出全屏、量尺寸、模拟 iPhone 不支持），但它要跑一遍 134 场联赛（~3 分钟/上下文），
 * 只能手动跑，**没有**进 `verify.mjs`。
 * 这条静态检查 1 秒内跑完，可以常驻 `verify.mjs`，守住的是「接线被误删/被改错」这类
 * 高频回归——不替代浏览器验证，只做第一道便宜防线。
 *
 * ## 守什么（都是踩过的坑）
 *
 * 1. **按钮必须默认 `hidden`**：iPhone Safari 不支持任意元素全屏，
 *    若默认可见，那里就是一个「点了没反应」的按钮。
 * 2. **能力检测必须读 `document.fullscreenEnabled`**：不能靠 UA 字符串猜。
 * 3. **全屏的必须是整块比赛界面**（含控制条），不是单块球场 ——
 *    否则进了全屏点不到暂停/退出，用户被困住。
 * 4. **离开比赛界面必须退出全屏**：否则满屏比赛界面上没有任何返回入口。
 * 5. **CSS 必须有 `.fmm-match-bar .btn[hidden] { display:none !important }`**：
 *    `.fmm-match-bar .btn.icon-btn { display: inline-grid }`（特异性 0,3,0）
 *    会压掉 UA 的 `[hidden] { display: none }`（0,1,0）⇒
 *    `hidden` 为真但按钮照样显示。**这个坑只有量 computed display 才能发现。**
 * 6. **`:fullscreen` 必须显式钉 `position: fixed !important`**：
 *    横屏档给 `.match-layout.….live-kick` 写了 `position: relative`（0,4,0），
 *    author 样式优先于 UA 样式 ⇒ 会把 UA 的 `position: fixed` 顶掉。
 * 7. **i18n 四个键两种语言都要有**：漏一种就出现 key 原文。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const mainJs = readFileSync("js/main.js", "utf8");
const css = readFileSync("css/style.css", "utf8");
const i18n = readFileSync("js/i18n.js", "utf8");

let failed = 0;
function check(ok, label, detail = "") {
  const mark = ok ? "  ✓" : "  ✗";
  console.log(`${mark} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

/** 取一个函数体（从签名到下一个顶层 `}`），用于把断言限制在该函数内。 */
function bodyOf(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  // 从签名后的第一个 `{` 起做花括号配对
  const open = src.indexOf("{", start);
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

console.log("\n[1] 按钮标记（index.html）");
{
  const m = html.match(/<button[^>]*id="btn-match-fullscreen"[^>]*>/);
  check(!!m, "存在全屏按钮 `#btn-match-fullscreen`");
  const tag = m ? m[0] : "";
  check(/\bhidden\b/.test(tag), "按钮默认带 `hidden`（iPhone Safari 那里必须看不见）", tag.slice(0, 120));
  check(/aria-pressed="false"/.test(tag), "按钮初始 `aria-pressed=\"false\"`");
  check(/data-i18n-title="match\.fullscreen/.test(tag), "按钮挂了 i18n title");
}

console.log("\n[2] 能力检测（js/main.js）");
{
  const supported = bodyOf(mainJs, "function fullscreenSupported()");
  check(supported.length > 0, "定位到 `fullscreenSupported()`", `长度 ${supported.length}`);
  check(/document\.fullscreenEnabled/.test(supported), "能力检测读 `document.fullscreenEnabled`");
  check(/webkitRequestFullscreen/.test(supported), "带 webkit 前缀回退（老 Safari/Chromium）");
  // 不允许用 UA 字符串猜能力
  check(
    !/navigator\.userAgent/.test(supported),
    "不得用 `navigator.userAgent` 猜能力（应读 `fullscreenEnabled`）"
  );

  const sync = bodyOf(mainJs, "function syncFullscreenUI()");
  check(sync.length > 0, "定位到 `syncFullscreenUI()`", `长度 ${sync.length}`);
  check(/btn\.hidden = true/.test(sync), "不支持全屏时把按钮 `hidden = true`");
  check(
    /document\.fullscreenElement|currentFullscreenElement/.test(sync),
    "按钮状态由**真实全屏状态**推导，不用本地标志位"
  );
  check(
    !/let\s+\w*[Ff]ullscreen\w*\s*=\s*(true|false)/.test(sync),
    "`syncFullscreenUI` 里没有本地布尔标志位"
  );
}

console.log("\n[3] 全屏的是整块比赛界面，不是单块球场");
{
  const toggle = bodyOf(mainJs, "async function toggleMatchFullscreen()");
  check(toggle.length > 0, "定位到 `toggleMatchFullscreen()`", `长度 ${toggle.length}`);
  check(
    /querySelector\("\.match-layout\.fmm-match"\)/.test(toggle),
    "全屏宿主是 `.match-layout.fmm-match`（含底部控制条）"
  );
  check(
    !/requestFullscreen[^;]*mp-field|mp-pitch-slot[^;]*requestFullscreen/.test(toggle),
    "没有把全屏宿主写成单块球场（否则进去后点不到退出）"
  );
  check(
    /refreshLayout/.test(toggle),
    "切换后重测画布（`matchView.refreshLayout()`）"
  );
}

console.log("\n[4] 接线与生命周期（js/main.js）");
{
  check(
    /#btn-match-fullscreen"\)\?\.addEventListener\("click"/.test(mainJs),
    "按钮已绑定 click"
  );
  check(
    /document\.addEventListener\("fullscreenchange"/.test(mainJs),
    "监听 `document` 的 `fullscreenchange`（用户按 Esc 退出也要同步）"
  );
  check(
    /document\.addEventListener\("webkitfullscreenchange"/.test(mainJs),
    "同时监听 `webkitfullscreenchange`"
  );
  const showScreen = bodyOf(mainJs, "function showScreen(name)");
  check(showScreen.length > 0, "定位到 `showScreen()`", `长度 ${showScreen.length}`);
  check(
    /name !== "match"/.test(showScreen) && /exitFullscreen/.test(showScreen),
    "离开比赛界面时退出全屏（否则满屏上找不到返回入口）"
  );
}

console.log("\n[5] CSS 两个必踩的坑（css/style.css）");
{
  check(
    /\.fmm-match-bar\s+\.btn\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css),
    "`.fmm-match-bar .btn[hidden] { display: none !important }` 存在",
    "否则 `[hidden]` 被 `.btn.icon-btn{display:inline-grid}` 压掉"
  );
  check(
    /:fullscreen/.test(css),
    "存在 `:fullscreen` 规则"
  );
  // 从 `:fullscreen` 选择器后取一段规则体，断言钉了 position/inset
  const fsIdx = css.indexOf(":fullscreen");
  const fsChunk = fsIdx >= 0 ? css.slice(fsIdx, fsIdx + 1200) : "";
  check(
    /position:\s*fixed\s*!important/.test(fsChunk),
    "`:fullscreen` 里显式 `position: fixed !important`",
    "否则被横屏档的 `.live-kick{position:relative}` 顶掉"
  );
  check(/inset:\s*0\s*!important/.test(fsChunk), "`:fullscreen` 里 `inset: 0 !important`");
  check(
    /-webkit-full-screen/.test(css),
    "带 `:-webkit-full-screen` 回退选择器"
  );
  check(
    /#btn-match-fullscreen:not\(\[hidden\]\)/.test(css),
    "未全屏时全屏键有独立高亮（`:not([hidden])`），避免和旁边 5 个灰图标混在一起"
  );
}

console.log("\n[5b] 首次提示（可发现性，不替代能力检测）");
{
  check(
    /function maybeHintFullscreenEntry\(/.test(mainJs),
    "存在 `maybeHintFullscreenEntry()`"
  );
  check(
    /vcfm-fullscreen-hint-seen/.test(mainJs),
    "提示只弹一次（localStorage 键 `vcfm-fullscreen-hint-seen`）"
  );
  check(
    /maybeHintFullscreenEntry\(\{\s*delayMs:/.test(mainJs),
    "开赛后调用首次提示（带 delay，躲开队内讲话 toast）"
  );
  check(
    !/showScreen\("match"\);\s*maybeHintFullscreenEntry\(\);/.test(mainJs),
    "不得在 openMatch / 进比赛界面时立刻弹（会被「赛前讲话」toast 盖掉）"
  );
  {
    // ⚠ 不能用 `bodyOf(..., "function maybeHintFullscreenEntry(")`：
    //   新签名是 `({ delayMs = 0 } = {})`，`bodyOf` 会把参数对象的 `{` 当成函数体起点，
    //   切到空串 ⇒ 本检查恒失败。按函数名切片即可。
    const hintIdx = mainJs.indexOf("function maybeHintFullscreenEntry");
    const hintChunk = hintIdx >= 0 ? mainJs.slice(hintIdx, hintIdx + 1800) : "";
    check(
      /match-report-only/.test(hintChunk),
      "赛后战报不弹提示（控制条被藏了）"
    );
  }
}

console.log("\n[6] i18n 键（两种语言都要有）");
{
  const keys = [
    "match.fullscreen",
    "match.fullscreenHint",
    "match.fullscreenExit",
    "match.fullscreenExitHint",
    "match.fullscreenFirstHint",
  ];
  const zhBlock = i18n.slice(i18n.indexOf("const dict = {"), i18n.indexOf("  en: {"));
  const enBlock = i18n.slice(i18n.indexOf("  en: {"));
  for (const k of keys) {
    const needle = `"${k}":`;
    check(zhBlock.includes(needle), `zh 有 \`${k}\``);
    check(enBlock.includes(needle), `en 有 \`${k}\``);
  }
}

console.log("");
if (failed) {
  console.error(`❌ 全屏观赛静态接线检查失败：${failed} 项`);
  process.exit(1);
}
console.log("✅ 全屏观赛静态接线检查通过（浏览器级验证见 scripts/mobile-pitch-adaptation-verify.mjs 的 ②c 用例）");
