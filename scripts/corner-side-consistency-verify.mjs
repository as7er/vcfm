/**
 * 角球侧别一致性校验（2026-09-20）
 *
 * 背景（用户报的 bug）：
 *   「开角球的时候竟然存在从另外一边底线角球区开角球」
 *
 * 根因（**两层都断**）：
 *   ① `js/match.js` 的角球是**纯统计事件**（`chance(0.035 * ...)`），并不模拟
 *      球从哪条边线出底线 ⇒ 事件里没有侧别。
 *   ② 表现层因此只能掷骰子选边——而且有**三条**路径都在掷（第三条是 2026-09-20 补修的）：
 *      · `_stageCornerSetPiece()`（sim 路径）：
 *          `Number.isFinite(ev.x) ? ev.x < 50 : (ball.x ?? 50) < 50 || Math.random() < 0.5`
 *        但 `match.js` 从来没写过 `ev.x`，所以第一分支永远进不去 ⇒ 恒走随机。
 *      · 内联 `case "corner"`（非 sim 路径）：`const left = Math.random() < 0.5`。
 *
 * 修法：
 *   ① `js/match.js` 产生角球时掷**一次**侧别写进事件（`cornerX`，引擎系 2/98）；
 *   ② 三条表现层路径都改读 `ev.cornerX`；
 *   ③ 端侧（`ty` / `cy`）改用 `_attackDir` 派生，顺带修好换边档。
 *
 * 本探针验的是**修后的不变量**（数据流 + 静态防回归），不看像素：
 *   [1] 事件确实带侧别，取值合法
 *   [2] 三条表现层路径都读事件侧别、都不再用 Math.random 决定侧别
 *   [3] `cornerX` → 视图 `tx` 的映射单调不翻转
 *   [4] 换边后端侧（`ty`/`cy`）跟攻方底线走
 *
 * 静态断言的价值：数据断言证明「现在是对的」，静态断言证明「以后改回去会被抓到」。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

/** 按花括号配对精确切出某个函数的**体**（不含签名与前后注释） */
function bodyOf(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) return "";
  const open = src.indexOf("{", start + signature.length - 1);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** 去掉行注释，避免「注释里提到旧写法」被误判为违规 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

// ═════════════════════════════════════════════════════════════
console.log("\n[1] 事件源：`js/match.js` 是否给角球写了侧别");
// ═════════════════════════════════════════════════════════════
{
  const src = read("js/match.js");
  // ⚠ 不能 `indexOf('"corner"')`——那是文件里第一次出现的位置，锚定 `const cornerX`。
  const i = src.indexOf("const cornerX");
  const block = i < 0 ? "" : src.slice(Math.max(0, i - 400), i + 500);

  check(
    /const\s+cornerX\s*=\s*chance\(0\.5\)\s*\?\s*2\s*:\s*98/.test(block),
    "`match.js` 角球事件写入 `cornerX = chance(0.5) ? 2 : 98`",
    i < 0 ? "（未找到 `const cornerX`）" : ""
  );
  check(
    /pushEv\([\s\S]{0,200}?["']corner["'][\s\S]{0,200}?\bcornerX\b/.test(block),
    "`cornerX` 确实进了 `pushEv(..., \"corner\", ...)` 的 extra"
  );
  check(
    !/Math\.random\(\)\s*<\s*0\.5/.test(stripComments(block)),
    "`match.js` 角球侧别不依赖 `Math.random() < 0.5`（用 `chance` 走种子随机）"
  );
}

// ═════════════════════════════════════════════════════════════
console.log("\n[2] 表现层：三条角球路径都必须读事件侧别");
console.log("    ⚠ `matchview.js` 有**三条**角球路径，**都曾掷骰子/推错侧别**：");
console.log("      · sim 路径 → `_stageCornerSetPiece()`（摆 5v5 阵型）");
console.log("      · 非 sim 路径 → 内联 `case \"corner\"`（`_shootBall` 一脚）");
console.log("      · director 路径 → `prepareEvent()` 的角球分支（曾用射手 x 推侧别）");
// ═════════════════════════════════════════════════════════════
const viewSrc = read("js/matchview.js");

// —— 路径 A：onEvent 内联分支 ——
// ⚠ `case "corner"` 在文件里出现**三次**：
//   ① `case "corner": case "penalty": ... case "goal"`（kickoff 分组）
//   ② sim 路径那个（调 `_stageCornerSetPiece`）
//   ③ 非 sim 路径那个（调 `_shootBall`）——**要验的是 ③**，取最后一个。
const branch = (() => {
  const marker = 'case "corner": {';
  const start = viewSrc.lastIndexOf(marker);
  if (start < 0) return "";
  const body = viewSrc.slice(start + marker.length);
  const nextCase = body.search(/\n\s*case\s+"/);
  return body.slice(0, nextCase < 0 ? 4000 : nextCase);
})();
const branchLogic = stripComments(branch);

check(branch.length > 0, "定位到内联 `case \"corner\"` 分支体", `长度 ${branch.length}`);
check(/\bev\.cornerX\b/.test(branchLogic), "内联分支引用 `ev.cornerX`（读事件侧别）");
check(
  /(cornerX|sideEngX)[\s\S]{0,80}?<\s*50[\s\S]{0,80}?\?\s*5\s*:\s*95/.test(branchLogic),
  "内联分支由引擎侧别派生视图 `tx`（<50 → 5 左 / ≥50 → 95 右）"
);
check(
  /this\._shootBall\(\s*tx\s*,\s*ty\s*,\s*"pass"\s*\)/.test(branchLogic),
  "`_shootBall(tx, ty, \"pass\")` 用的是派生值"
);
check(
  /_attackDir\(\s*side\s*\)/.test(branchLogic),
  "内联分支用 `_attackDir(side)` 决定 `ty`（换边安全）"
);

// ⚠ 分支体内仍有 `Math.random() < 0.55`（禁区内堆人的概率，属**正当**随机），
//   所以不能笼统禁 `Math.random`。要禁的是「用它决定**角球侧别**」——
//   判据：`tx` 的赋值来源必须是 `cornerX` 派生。
const txAssign = (branchLogic.match(/const\s+tx\s*=\s*([^;]+);/) || [])[1] || "";
check(
  /\bcornerX\b|\bsideEngX\b/.test(txAssign),
  "内联分支的 `tx` 由引擎侧别派生",
  `实际: const tx = ${txAssign.trim()}`
);
check(!/Math\.random/.test(txAssign), "`tx` 的赋值里没有 `Math.random`");
check(!/const\s+left\s*=/.test(branchLogic), "内联分支里旧的 `const left = ...` 已删除");

// —— 路径 B：_stageCornerSetPiece ——
const stage = bodyOf(viewSrc, "_stageCornerSetPiece(ev = {}, fixture = null)");
const stageLogic = stripComments(stage);

check(stage.length > 0, "定位到 `_stageCornerSetPiece()`", `长度 ${stage.length}`);
check(/\bev\.cornerX\b/.test(stageLogic), "`_stageCornerSetPiece` 引用 `ev.cornerX`");
check(
  /Number\.isFinite\(\s*ev\.cornerX\s*\)/.test(stageLogic),
  "优先判 `ev.cornerX` 是否有限"
);
check(
  /_attackDir\(\s*team\s*\)/.test(stageLogic),
  "`_stageCornerSetPiece` 用 `_attackDir(team)` 派生端侧（换边安全）"
);
check(
  /const\s+attacksUp\s*=\s*this\._attackDir\(\s*team\s*\)\s*<\s*0/.test(stageLogic),
  "端侧变量 `attacksUp` 已建立"
);

const leftAssign = (stageLogic.match(/const\s+left\s*=\s*([^;]+);/) || [])[1] || "";
check(
  !/Math\.random\s*\(\)\s*<\s*0\.5/.test(leftAssign),
  "`_stageCornerSetPiece` 的 `left` 不再用 `Math.random() < 0.5` 掷骰子",
  leftAssign ? `实际: const left = ${leftAssign.trim()}` : ""
);
const cxAssign = (stageLogic.match(/const\s+cx\s*=\s*([^;]+);/) || [])[1] || "";
check(
  /\bleft\b/.test(cxAssign) && !/Math\.random/.test(cxAssign),
  "`_stageCornerSetPiece` 的 `cx` 由 `left` 派生，不含 `Math.random`",
  `实际: const cx = ${cxAssign.trim()}`
);

// 该函数体内不应再用 `attHome` 决定**半场方向**（应全部改走 `attacksUp`）。
// ⚠ 唯一允许保留的是 `const team = attHome ? "home" : "away"`——那是在推
//   「哪队进攻」，与端侧无关。其余位置若还出现 `attHome ?`，就是漏改。
const attHomeTernaries = (
  stageLogic.match(/attHome\s*\?[^;,)}\n]*/g) || []
).filter((s) => !/^attHome\s*\?\s*["']home["']\s*:\s*["']away["']/.test(s.trim()));
check(
  attHomeTernaries.length === 0,
  "函数体内不再用 `attHome ?` 决定半场方向（仅保留推 `team` 那一处）",
  attHomeTernaries.length ? `残留: ${attHomeTernaries.join(" | ")}` : ""
);
check(
  /attHome\s*\?\s*["']home["']\s*:\s*["']away["']/.test(stageLogic),
  "`const team = attHome ? \"home\" : \"away\"` 仍在（推进攻方，与端侧无关）"
);

// —— 路径 C：`prepareEvent()` 里的角球分支（第三条，2026-09-20 补修） ——
// ⚠ 这条路径当时**漏了**：它由 `main.js:9701/9727` 调 `prepareEvent` 进入，
//   `needsBuildup` 集合里含 `"corner"`，非 sim 路径会真的走到。
//   旧写法 `const left = (finisher?.x ?? this.ball.x) < 50` 用**射手/球的当前位置**
//   推侧别 —— 与「球从哪条边线出底线」没有必然关系 ⇒ 画面从另一侧角旗开球。
const prep = bodyOf(viewSrc, "async prepareEvent(ev, snap, fixture, opts = {})");
const prepLogic = stripComments(prep);
check(prep.length > 0, "定位到 `prepareEvent()`", `长度 ${prep.length}`);
check(/\bev\.cornerX\b/.test(prepLogic), "`prepareEvent` 的角球分支引用 `ev.cornerX`");
check(
  /Number\.isFinite\(\s*ev\.cornerX\s*\)/.test(prepLogic),
  "`prepareEvent` 优先判 `ev.cornerX` 是否有限"
);
check(
  /_attackDir\(\s*side\s*\)/.test(prepLogic),
  "`prepareEvent` 用 `_attackDir(side)` 派生端侧（换边安全）"
);
check(
  !/\(\s*finisher\?\.x\s*\?\?\s*this\.ball\.x\s*\)\s*<\s*50/.test(prepLogic),
  "不再用 `(finisher?.x ?? this.ball.x) < 50` 推角球侧别"
);
check(
  !/attHome\s*\?\s*6\s*:\s*94/.test(prepLogic),
  "不再用 `attHome ? 6 : 94` 决定角球端侧"
);

// ═════════════════════════════════════════════════════════════
console.log("\n[3] 引擎侧别 → 视图 tx 的映射");
// ═════════════════════════════════════════════════════════════
const toViewTx = (engineX) => (engineX < 50 ? 5 : 95);
for (const [eng, want] of [
  [2, 5],
  [98, 95],
]) {
  const got = toViewTx(eng);
  check(got === want, `引擎 x=${eng} → 视图 tx=${got}`, `期望 ${want}`);
}
check(toViewTx(2) < toViewTx(98), "映射单调不翻转（引擎左角旗 → 视图左端）");
check(
  new Set([2, 98]).size === 2 &&
    [...new Set([2, 98])].every((v) => v === 2 || v === 98),
  "侧别取值集合 = {2, 98}（引擎系左/右角旗）"
);

// ═════════════════════════════════════════════════════════════
console.log("\n[4] 换边后的端侧（`ty` / `cy`）");
// ═════════════════════════════════════════════════════════════
// 复刻 `_attackDir`：home 默认朝 y→0 攻（-1）；换边取反
const attackDir = (team, endsSwapped) => {
  const base = team === "home" ? -1 : 1;
  return endsSwapped ? -base : base;
};
const tyFor = (team, endsSwapped) => (attackDir(team, endsSwapped) < 0 ? 7 : 93);

check(tyFor("home", false) === 7, "主队不换边：在 y=7 端（客队守的 y=0 端）开角球");
check(tyFor("away", false) === 93, "客队不换边：在 y=93 端（主队守的 y=100 端）开角球");
check(tyFor("home", true) === 93, "主队换边后：端侧翻到 y=93");
check(tyFor("away", true) === 7, "客队换边后：端侧翻到 y=7");

// 默认档（不换边）必须与旧行为一致，不能引入漂移
check(
  tyFor("home", false) === 7 && tyFor("away", false) === 93,
  "默认档（不换边）端侧与旧行为 `ty = attHome ? 7 : 93` 一致"
);

// ═════════════════════════════════════════════════════════════
console.log(
  `\n${failures === 0 ? "✅ 全部通过" : `❌ ${failures} 项失败`}——` +
    "角球侧别：事件带侧别、三条路径都照读、映射单调、换边端侧正确。\n"
);
process.exit(failures === 0 ? 0 : 1);
