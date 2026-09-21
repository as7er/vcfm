/**
 * 「重开直播画面一样」提示的静态接线检查（2026-09-22 v281）。
 *
 * 用户报「直播看了一段，重开之后画面好像一样」。**这不是 bug，是设计**：
 * `openMatch` 无条件重置会话、`playFirstHalf` 从 fromMin=1 起算，而 `matchSeed`
 * 随存档保留 ⇒ 随机流相同 ⇒ 重放逐位相同。本轮只做「提示 + 替代动作」，
 * **续播没有实现**（`fromMin` 仍只有硬编码 1/46/61/76）——所以这条审计也顺便
 * 钉住「弹窗里不得出现承诺续播的字样」。
 *
 * 纯静态，不启动浏览器、不模拟引擎，1 秒内跑完：
 * 1. 进度键 `MATCH_PROGRESS_KEY === "vcfm-match-progress"`。
 * 2. `maybeWarnReopenedMatch` 有定义，且**在 `openMatch` 体内被调用**。
 * 3. 写入钩子在 `setMatchMinute` 里，且被 `!reset` 守住（顺序也要对：
 *    守卫必须在写之前，否则 `openMatch` 那次 `setMatchMinute(0, {reset:true})`
 *    会把进度写成 0′，弹窗从此再也不会出现）。
 * 4. `openMatch` 体内有 `clearMatchProgress()`（已完赛不必再提示）。
 * 5. 弹窗文案双语（`getLang() === "en"` + 中文串都在）。
 * 6. 弹窗**不承诺续播**（不得出现 `resume` / `continue from` / `继续观看`）。
 * 7. 弹窗按钮里调用了 `runMatch("instant")`。
 * 8. 弹窗按钮只用样式表里**真实存在**的 class（`.btn.primary` / `.btn.ghost`）。
 *
 * 末尾附带**变异测试**：把上述 7 个要点逐个改坏（每次只动一处），断言至少有
 * 一条检查转红 —— 「改坏就该红」，证明这些断言不是装饰。
 */
import { readFileSync } from "node:fs";

const main = readFileSync("js/main.js", "utf8");
const css = readFileSync("css/style.css", "utf8");

/**
 * 取**定义处**的块范围。
 *
 * ⚠ 不能用 `src.indexOf(名字)`：它命中的多半是**调用点**，于是断言会去数别人的
 *   花括号（本仓踩过这个坑：`js/matchview.js` 的 `_enterSegmentTransition` 定义在
 *   `:1212`、被调在 `:892`，首版审计因此 7 项假红，产品代码其实是对的）。
 *   这里锚「行首缩进 + 签名 + `{`」，调用点天然被排除。
 * @param {string} src
 * @param {string} pattern 正则源（不含结尾的 `{`，本身不能含未配对的 `{`）
 * @returns {null | { start: number, end: number, body: string }}
 */
function bodyRange(src, pattern) {
  const re = new RegExp(`^[ \\t]*${pattern}[ \\t]*\\{`, "m");
  const m = re.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return { start: open, end: i + 1, body: src.slice(open, i + 1) };
    }
  }
  return null;
}

// 参数表里有 `{ reset = false } = {}`，所以 `[^)]*` 比写死签名安全。
const OPEN_MATCH = "async function openMatch\\(\\)";
const SET_MINUTE = "function setMatchMinute\\([^)]*\\)";
const WARN = "function maybeWarnReopenedMatch\\([^)]*\\)";

const BODY_LIMITS = {
  openMatch: [2000, 60000],
  setMatchMinute: [200, 8000],
  maybeWarnReopenedMatch: [600, 8000],
};

/** 只跑检查、不打印：变异测试要复用同一套判据。 */
function audit(src, cssSrc) {
  const results = [];
  const add = (ok, label, detail = "") => results.push({ ok: !!ok, label, detail });

  const openMatch = bodyRange(src, OPEN_MATCH);
  const setMinute = bodyRange(src, SET_MINUTE);
  const warn = bodyRange(src, WARN);

  // 体长区间是**双保险**：太小 = 抓错了块，太大 = 把文件后半截吞了进来。
  for (const [name, found] of [
    ["openMatch", openMatch],
    ["setMatchMinute", setMinute],
    ["maybeWarnReopenedMatch", warn],
  ]) {
    const [min, max] = BODY_LIMITS[name];
    add(
      !!found && found.body.length > min && found.body.length < max,
      `定位到 \`${name}\` 的**定义体**`,
      found ? `长度 ${found.body.length}（预期 ${min}~${max}）` : "未找到定义"
    );
  }

  // 1
  add(
    /const[ \t]+MATCH_PROGRESS_KEY[ \t]*=[ \t]*"vcfm-match-progress"[ \t]*;/.test(src),
    '`MATCH_PROGRESS_KEY` 的值是 "vcfm-match-progress"'
  );

  // 2
  add(
    !!openMatch && /\bmaybeWarnReopenedMatch\([ \t]*next[ \t]*\)/.test(openMatch.body),
    "`openMatch` 体内调用了 `maybeWarnReopenedMatch(next)`（否则永远不会弹）"
  );

  // 3
  {
    const body = setMinute ? setMinute.body : "";
    const guardAt = body.search(/![ \t]*reset\b/);
    const keyAt = body.search(/matchProgressKey\(/);
    add(
      guardAt >= 0 && keyAt >= 0,
      "写入钩子里既有 `!reset` 守卫又有 `matchProgressKey(`",
      `guard@${guardAt} key@${keyAt}`
    );
    add(
      guardAt >= 0 && keyAt >= 0 && guardAt < keyAt,
      "`!reset` 守卫出现在写入**之前**（openMatch 的 0′ reset 不得覆盖进度）"
    );
  }

  // 4
  add(
    !!openMatch && /\bclearMatchProgress\(\)/.test(openMatch.body),
    "`openMatch` 体内有 `clearMatchProgress()`（已完赛不提示）"
  );

  // 5
  add(
    !!warn && /getLang\(\)[ \t]*===[ \t]*"en"/.test(warn.body) && /[\u4e00-\u9fff]/.test(warn.body),
    "弹窗文案双语（`getLang() === \"en\"` 与中文串都在同一个函数里）"
  );

  // 6：本轮不实现续播，弹窗里不能出现任何承诺续播的字样。
  {
    const hit = /resume|continue from|继续观看/i.exec(warn ? warn.body : "");
    add(
      !!warn && !hit,
      "弹窗不承诺续播（无 resume / continue from / 继续观看）",
      hit ? `出现 "${hit[0]}"` : ""
    );
  }

  // 7
  add(
    !!warn && /runMatch\([ \t]*"instant"[ \t]*\)/.test(warn.body),
    '弹窗按钮的处理里调用了 `runMatch("instant")`（替代动作不是空按钮）'
  );

  // 8：按钮 class 必须是样式表里真实存在的，不要发明新 class。
  add(
    /\.btn\.primary[ \t]*\{/.test(cssSrc) && /\.btn\.ghost[ \t]*\{/.test(cssSrc),
    "弹窗按钮用的 `.btn.primary` / `.btn.ghost` 在 `css/style.css` 里真实存在"
  );

  return results;
}

let failed = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? `  —— ${detail}` : ""}`);
  if (!ok) failed += 1;
}

const results = audit(main, css);
console.log(`\n[1] 静态接线（js/main.js + css/style.css，共 ${results.length} 项）`);
for (const r of results) check(r.ok, r.label, r.detail);

/** 只改一个定义体，避免误伤同名调用点。 */
function mutateBody(src, pattern, needle, replacement) {
  const r = bodyRange(src, pattern);
  if (!r) return null;
  if (!r.body.includes(needle)) return null;
  const body = r.body.split(needle).join(replacement);
  return src.slice(0, r.start) + body + src.slice(r.end);
}

// 每个变异对应上面的一条要点：改坏之后**至少一条**检查必须转红。
const mutations = [
  ["① 进度键拼错", () => main.replace('"vcfm-match-progress"', '"vcfm-match-progress-typo"')],
  [
    "② 删掉 openMatch 里的调用",
    () => mutateBody(main, OPEN_MATCH, "  maybeWarnReopenedMatch(next);", ""),
  ],
  ["③ 去掉 `!reset` 守卫", () => mutateBody(main, SET_MINUTE, "!reset && ", "")],
  [
    "④ 删掉已完赛的清除",
    () => mutateBody(main, OPEN_MATCH, "if (next.played) clearMatchProgress();", ""),
  ],
  ["⑤ 弹窗只留一种语言", () => mutateBody(main, WARN, 'getLang() === "en"', "true")],
  ["⑥ 弹窗按钮改成假承诺", () => mutateBody(main, WARN, '"直接出战报"', '"继续观看"')],
  ["⑦ 替代动作改成直播", () => mutateBody(main, WARN, 'runMatch("instant")', 'runMatch("live")')],
];

console.log(`\n[2] 变异测试（每次只改坏一处，共 ${mutations.length} 项）`);
for (const [label, build] of mutations) {
  const mutated = build();
  // 变异必须真的改动了源码，否则「被抓住」毫无意义（针没扎到人身上）。
  const applied = typeof mutated === "string" && mutated !== main;
  const caught = applied ? audit(mutated, css).filter((r) => !r.ok) : [];
  check(
    applied && caught.length > 0,
    label,
    applied ? `红 ${caught.length} 项：${caught[0]?.label ?? ""}` : "变异未生效（针没扎上）"
  );
}

if (failed) {
  console.error(`\nreopened-match-notice-audit: ${failed} 项失败`);
  process.exit(1);
}
console.log("\nreopened-match-notice-audit: ok");
