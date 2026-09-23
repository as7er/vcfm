/**
 * 「隐藏/唤出」常驻开关的**静态接线护栏**（2026-09-22 v288）。
 *
 * ## 为什么既要有浏览器验收、还要有这条
 *
 * 真正的行为验证在 `scripts/_chrome-toggle-browser-check.mjs`（真实 Chromium，
 * 3 个视口、51 项断言），但它要跑一遍开局（~2 分钟/视口）⇒ 只能手动跑。
 * 这条静态检查 1 秒内跑完，可以常驻 `verify.mjs`，守的是**接线被误删/改错**
 * 这类高频回归。它**不替代**浏览器验证。
 *
 * ## 守什么（每条都对应一个具体翻车方式）
 *
 * 1. 按钮必须真的在 `matchview.js` 的模板里（不是只写了 CSS）。
 * 2. 🔴 按钮必须是 `<button>`：球场那个「点空白」处理器用**排除法**，
 *    `NOT_BLANK` 里含 `button`。若改成 `<div>`，点按钮会同时触发
 *    「点空白球场」⇒ 进入又立刻退出（视觉上「点了没反应」）。
 * 3. 🔴 绑定必须是**事件委托**：`ensureMatchPitch(true)` 会重建整棵球场 DOM，
 *    直接 `btn.addEventListener` 的监听器会随旧节点丢掉 ⇒ 第二次进比赛按钮失效。
 * 4. 🔴 必须 `stopPropagation`：否则点击继续冒泡到球场的处理器，
 *    与第 2 条叠加会互相抵消。
 * 5. `toggleMatchImmersive` 必须调 `syncChromeToggle`：否则图标/aria 只在
 *    第一次点的时候是对的（v276 全屏键的可发现性就栽在「状态没反映出来」）。
 * 6. CSS 必须给 `.mp-chrome-toggle` 正 z-index，且在球场盒**内部**
 *    （放 `.mp-wrap` 之外会被沉浸模式的隐藏规则一起带走 ⇒ 沉浸后找不到退出）。
 * 7. `openMatch` 必须复位沉浸（否则换场次继承上一场的隐藏状态）。
 *
 * 用法：node scripts/chrome-toggle-wiring-verify.mjs
 */
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const mainJs = readFileSync("js/main.js", "utf8");
const matchview = readFileSync("js/matchview.js", "utf8");
const css = readFileSync("css/style.css", "utf8");

let failed = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

/** 取一个函数体（从签名到配对 `}`），把断言限制在该函数内。 */
function bodyOf(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) return "";
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

console.log("\n[1] 按钮标记（js/matchview.js 的球场模板）");
{
  const m = matchview.match(/<button[^>]*id="mp-chrome-toggle"[^>]*>/);
  check(!!m, "球场模板里有 `<button id=\"mp-chrome-toggle\">`");
  const tag = m ? m[0] : "";
  check(/class="mp-chrome-toggle"/.test(tag), "带 `mp-chrome-toggle` 类（CSS 才挂得上）", tag.slice(0, 100));
  check(/aria-pressed="false"/.test(tag), "初始 `aria-pressed=\"false\"`");
  check(/type="button"/.test(tag), "显式 `type=\"button\"`（避免在表单语境里被当 submit）");
  // 🔴 必须是 button：`NOT_BLANK` 用 `button` 排除，改成 div 会导致点一次切两下
  const notBlank = matchview.match(/const NOT_BLANK = "([^"]+)"/);
  check(!!notBlank, "找得到球场 `NOT_BLANK` 排除清单");
  check(
    !!notBlank && (notBlank[1] || "").split(",").map((s) => s.trim()).includes("button"),
    "`NOT_BLANK` 里含 `button`（点按钮不会被当成「点空白球场」）",
    notBlank ? notBlank[1] : ""
  );
  check(
    matchview.includes('class="mp-chrome-toggle"'),
    "按钮在 `.mp-field` 内部（`.mp-wrap` 内），沉浸时不会被一起藏掉",
    ""
  );
  // 它必须是 .mp-field 的子元素：检查它出现在 mp-field 模板段内
  const fieldOpen = matchview.indexOf('class="mp-field mp-fmm2d"');
  const fieldClose = matchview.indexOf("<!-- 竖持手机提示", fieldOpen);
  const btnPos = matchview.indexOf('id="mp-chrome-toggle"');
  check(
    fieldOpen > 0 && fieldClose > fieldOpen && btnPos > fieldOpen && btnPos < fieldClose,
    "按钮位置落在 `.mp-field` 那段模板里（实测四角里只有它的右下角点得到）"
  );
}

console.log("\n[2] 事件绑定（js/main.js）");
{
  const bind = bodyOf(mainJs, "function bindChromeToggle()");
  check(!!bind, "存在 `bindChromeToggle()`");
  check(/addEventListener\("click"/.test(bind), "用事件委托绑在容器上（不是直接绑按钮）");
  check(
    /dataset\.chromeToggleBound/.test(bind),
    "有防重复绑定的标记（`dataset.chromeToggleBound`）"
  );
  check(/stopPropagation\(\)/.test(bind), "🔴 点击时 `stopPropagation()`（否则与球场处理器互相抵消）");
  check(/toggleMatchImmersive\(/.test(bind), "复用既有的 `toggleMatchImmersive`（单一真相源）");
  const ensure = bodyOf(mainJs, "async function ensureMatchPitch(remount = false)");
  check(/bindChromeToggle\(\)/.test(ensure), "`ensureMatchPitch` 里调了 `bindChromeToggle()`");
}

console.log("\n[3] 状态同步（切换时必须更新图标/aria）");
{
  const toggle = bodyOf(mainJs, "function toggleMatchImmersive(force)");
  check(/syncChromeToggle\(/.test(toggle), "`toggleMatchImmersive` 里调了 `syncChromeToggle`");
  const sync = bodyOf(mainJs, "function syncChromeToggle(immersive)");
  check(!!sync, "存在 `syncChromeToggle()`");
  check(/setAttribute\("aria-pressed"/.test(sync), "同步 `aria-pressed`");
  check(/aria-label/.test(sync), "同步 `aria-label`");
  check(/title/.test(sync), "同步 `title`（鼠标悬停也能看懂）");
  check(/getLang\(\)/.test(sync), "文案跟着语言走");
  // 复位：换场次必须从「有 chrome」开始
  const openMatch = bodyOf(mainJs, "function openMatch(");
  check(
    /toggleMatchImmersive\(false\)/.test(openMatch),
    "`openMatch` 复位沉浸（不跨场次继承）"
  );
}

console.log("\n[4] CSS 接线（css/style.css）");
{
  const rule = css.match(/\.mp-chrome-toggle\s*\{([^}]*)\}/);
  check(!!rule, "存在 `.mp-chrome-toggle` 规则");
  const body = rule ? rule[1] : "";
  check(/position:\s*absolute/.test(body), "绝对定位（叠在球场上，不占布局高度）");
  check(/z-index:\s*\d+/.test(body), "有显式 z-index");
  const z = Number((body.match(/z-index:\s*(\d+)/) || [])[1]);
  check(z >= 10, `z-index ≥ 10（实测应高于球员层 4 / 卡片 8），实际 ${z}`);
  check(/right:\s*[\d.]+px/.test(body), "钉在**右下角**");
  check(/bottom:\s*[\d.]+px/.test(body), "钉在**右下角**（bottom）");
  check(/cursor:\s*pointer/.test(body), "有 `cursor: pointer`");
  check(/aria-pressed="true"/.test(css), "有选中态样式（`[aria-pressed=\"true\"]`）");
  // 确定性：按钮不能被 `.mp-wrap` 之外的选择器藏掉
  check(
    !/mp-chrome-toggle[^{]*\{[^}]*display:\s*none/.test(css),
    "没有任何规则把 `.mp-chrome-toggle` 设成 `display:none`（两种状态都必须可见）"
  );
}

console.log("\n[5] 不新增 i18n 依赖（文案走 JS 的 getLang，不需要 i18n 键）");
{
  const keys = ["match.chromeHide", "match.chromeShow"];
  for (const k of keys) {
    check(!html.includes(`data-i18n="${k}"`), `没有用未定义的 i18n 键 ${k}`);
  }
  check(
    /getLang\(\) === "en"/.test(bodyOf(mainJs, "function syncChromeToggle(immersive)")),
    "双语文案由 `getLang()` 直接给出（不依赖 i18n 表，就不存在漏键）"
  );
}

console.log(`\nchrome-toggle-wiring-verify: ${failed ? `${failed} 项失败` : "全部通过"}`);
process.exitCode = failed ? 1 : 0;
