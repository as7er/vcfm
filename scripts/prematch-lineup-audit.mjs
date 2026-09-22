/**
 * 「双方预计首发」赛前预览的静态检查（2026-09-22）。
 *
 * 用户原话：「比赛开始的时候没有预览双方的首发阵容」——赛前只有计分条、简报卡、
 * 队内讲话和一块**只画号码不画姓名**的球场。本脚本钉住这次接线的每一处要害，
 * 重点全是「以前踩过、这次不能再踩」的坑：
 *
 * 1. `renderLineupsPreviewHtml` 有定义，且是**纯字符串、同步**（不得有 `await` /
 *    `fetch(`）—— 进比赛界面是同步渲染路径，塞一个 await 会改掉时序。
 * 2. 数据必须与引擎 / 2D 球场**同源**：`getLineupPlayers` +
 *    `assignPlayersToFormationSlots`（`js/models.js:1958`，`js/matchview.js:3370` 同款）。
 *    自己按下标对齐 `lineup` 会在「门将槽站了个后卫」那类数据上直接错。
 * 3. **渲染位置必须在 `await ensureMatchPitch(true)` 之后**：`matchview.mount()`
 *    无条件 `autoLineup(home/away)`（`js/matchview.js:1797-1798`），早于它渲染，
 *    预览里的 11 人就可能与球场上站着的 22 人不是同一批（同一事实两种结果）。
 * 4. 追加必须走 `insertAdjacentHTML`，**不能**重设 `panel.innerHTML` ——
 *    那会把 `bindTeamTalkPicker` 绑在讲话广播按钮上的 change 监听冲掉
 *    （赛前讲话就变回「点了没反应」）。
 * 5. 不新增 DOM id（`scripts/ui-layout-audit.mjs` 统计 index.html 的 unique IDs），
 *    也不得复用 `name="pre-team-talk"`（`js/main.js` 用它读赛前讲话）。
 * 6. 口语必须是「**预计** / Projected」：AI 队的阵型与首发要到
 *    `createMatchSession`（`js/match.js:773-891`，先 `aiTuneTactics` 可能改阵型、
 *    再 `ensureMatchLineup(forceAuto)`）才定案，写确定语气就是假承诺。
 * 7. 默认展开与否由 `window.matchMedia("(min-width: 900px) and (pointer: fine)")`
 *    决定，且**必须有 `typeof window.matchMedia === "function"` 守卫**
 *    （jsdom / 无 DOM 环境没有它）。
 * 8. CSS：两列 grid、summary 可点、**不给本块单独限高**（面板本身已有
 *    `max-height` + `overflow-y: auto`，再套一层 = 双滚动条，历史坑）。
 *
 * 末尾附带**变异测试**：把上述要点逐个改坏（每次只动一处，全在内存里做，不落盘），
 * 断言至少有一条检查转红 —— 「改坏就该红」，证明这些断言不是装饰。
 * 并比对 `js/main.js` / `css/style.css` 的 sha256 前后一致（本轮没有写盘）。
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const mainPath = "js/main.js";
const cssPath = "css/style.css";
const main = readFileSync(mainPath, "utf8");
const css = readFileSync(cssPath, "utf8");
const mainSha = sha256(main);
const cssSha = sha256(css);

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

const OPEN_MATCH = "async function openMatch\\(\\)";
const LINEUP_PREVIEW = "function renderLineupsPreviewHtml\\([^)]*\\)";
/** 追加那一行的**特征串**：改文案不改这里，但改渲染位置/方式会。 */
const APPEND_CALL = 'renderLineupsPreviewHtml(home, away)';
/** 体长区间是双保险：太小 = 抓错了块，太大 = 把文件后半截吞了进来。 */
const BODY_LIMITS = {
  openMatch: [2000, 70000],
  renderLineupsPreviewHtml: [800, 12000],
};

/** 只跑检查、不打印：变异测试要复用同一套判据。 */
function audit(src, cssSrc) {
  const results = [];
  const add = (ok, label, detail = "") => results.push({ ok: !!ok, label, detail });

  const openMatch = bodyRange(src, OPEN_MATCH);
  const preview = bodyRange(src, LINEUP_PREVIEW);
  const pBody = preview ? preview.body : "";
  const oBody = openMatch ? openMatch.body : "";

  for (const [name, found] of [
    ["openMatch", openMatch],
    ["renderLineupsPreviewHtml", preview],
  ]) {
    const [min, max] = BODY_LIMITS[name];
    add(
      !!found && found.body.length > min && found.body.length < max,
      `定位到 \`${name}\` 的**定义体**`,
      found ? `长度 ${found.body.length}（预期 ${min}~${max}）` : "未找到定义"
    );
  }

  // 1. 构造器是纯字符串、同步。
  add(!!preview && !/\bawait\b/.test(pBody), "构造器里没有 `await`（同步路径）");
  add(!!preview && !/\bfetch\(/.test(pBody), "构造器里没有 `fetch(`（不引入新网络请求）");
  add(
    !!preview && /return[ \t]+`/.test(pBody),
    "构造器返回**字符串**（模板串），不是 DOM 节点"
  );

  // 2. 与引擎 / 球场同源。
  add(!!preview && /\bgetLineupPlayers\(/.test(pBody), "用 `getLineupPlayers(club)` 取首发");
  add(
    !!preview && /\bassignPlayersToFormationSlots\(/.test(pBody),
    "用 `assignPlayersToFormationSlots(xi, slots)` 按槽位排人（与 `js/matchview.js:3370` 同款）"
  );
  add(
    !!preview && /FORMATIONS\[/.test(pBody) && /\.slots\b/.test(pBody),
    "槽位来自 `FORMATIONS[tac.formation].slots`（阵型名也一并显示）"
  );
  // ⚠ `^import \{` 不行：`js/main.js` 第 1 行是注释，`^` 不带 `m` 匹配不到导入块。
  //   判据用「行首缩进 + 名字 + 逗号 + 行尾」——main.js 里这一行只出现在 models 导入块。
  add(
    /^[ \t]*assignPlayersToFormationSlots,[ \t]*\r?$/m.test(src),
    "`assignPlayersToFormationSlots` 已 import（否则运行期 ReferenceError）"
  );

  // 3. 插入点：必须在 `await ensureMatchPitch(true)` **之后**。
  {
    const a = oBody.indexOf("ensureMatchPitch(");
    const b = oBody.indexOf(APPEND_CALL);
    add(b >= 0, "`openMatch` 体内调用了 `renderLineupsPreviewHtml(home, away)`");
    add(
      a >= 0 && b >= 0 && a < b,
      "渲染位置在 `ensureMatchPitch` **之后**（`mount()` 的 `autoLineup` 会改写首发）",
      `ensureMatchPitch@${a} renderLineupsPreviewHtml@${b}`
    );
  }

  // 4. 追加方式：insertAdjacentHTML，不得重设 panel.innerHTML。
  add(
    !!openMatch && /insertAdjacentHTML\([ \t]*"beforeend"/.test(oBody),
    "用 `insertAdjacentHTML(\"beforeend\", …)` 追加（保住讲话 radio 的 change 监听）"
  );
  add(
    !!openMatch && !/innerHTML[ \t]*=[ \t]*[^;]*renderLineupsPreviewHtml/.test(oBody),
    "没有把 `renderLineupsPreviewHtml` 拼进另一次 `innerHTML =` 赋值"
  );
  add(
    !!openMatch && /\$\("#match-pre-brief"\)/.test(oBody),
    "追加目标就是 `#match-pre-brief`（开赛时随 `hidePrematchBriefPanel` 一起收起）"
  );

  // 5. 不新增 DOM id、不碰 `pre-team-talk`。
  add(!!preview && !/\bid[ \t]*=[ \t]*["']/.test(pBody), "新块里**没有** `id=`（ui-layout-audit 统计 unique IDs）");
  add(
    !!preview && !/name[ \t]*=[ \t]*["']pre-team-talk["']/.test(pBody),
    '新块里**没有** `name="pre-team-talk"`（那是赛前讲话的读值口径）'
  );
  add(!!preview && !/<input\b/.test(pBody), "新块里没有 `<input>`（不参与任何表单读值）");

  // 6. 口径必须是「预计」。⚠ 只在整个函数体里搜「预计」不够强：下面的**注释**
  //    （"对方为预计首发…"）里也有这两个字，把 summary 改坏仍然全绿。
  //    ⇒ 判据必须锚在 `const summary = …;` 这一条声明上。
  {
    const summaryDecl = (pBody.match(/const summary =[^;]*;/) || [""])[0];
    add(
      /双方预计首发/.test(summaryDecl) && /Projected/.test(summaryDecl),
      "`<summary>` 双语且用「预计 / Projected」口径（不给确定语气）",
      summaryDecl ? summaryDecl.replace(/\s+/g, " ").slice(0, 72) : "未找到 `const summary = …;`"
    );
  }
  add(
    !!preview && /<details class="brief-lineups"/.test(pBody),
    "用 `<details class=\"brief-lineups\">` 包住（默认折叠，不挤走必填的赛前讲话）"
  );

  // 7. 桌面默认展开 + matchMedia 守卫。
  add(
    !!preview && /window\.matchMedia\("\(min-width: 900px\) and \(pointer: fine\)"\)/.test(pBody),
    "桌面展开判定用 `(min-width: 900px) and (pointer: fine)`"
  );
  add(
    !!preview && /typeof[ \t]+window\.matchMedia[ \t]*===[ \t]*"function"/.test(pBody),
    "有 `typeof window.matchMedia === \"function\"` 守卫（jsdom / 无 DOM 环境）"
  );
  add(
    !!preview && /wide[ \t]*\?[ \t]*" open"[ \t]*:[ \t]*""/.test(pBody),
    "`open` 由 wide 决定（手机横屏默认折叠）"
  );

  // 8. CSS：两列 grid、summary 可点、本块不单独限高。
  add(/\.brief-lineup-grid[ \t]*\{/.test(cssSrc), "`css/style.css` 有 `.brief-lineup-grid`");
  add(
    /\.brief-lineup-grid[ \t]*\{[^}]*grid-template-columns:[^}]*repeat\(2,/.test(cssSrc),
    "两列 grid 排布（主队 | 客队）"
  );
  add(
    /\.brief-lineups > summary[ \t]*\{[^}]*cursor:[ \t]*pointer/.test(cssSrc),
    "`summary` 有 `cursor: pointer`（可点的可发现性）"
  );
  add(
    /\.brief-lineups[^,{]*\{[^}]*max-height/.test(cssSrc) === false,
    "本块**没有**自己的 `max-height`（面板已内滚，再套一层 = 双滚动条）"
  );
  add(
    /@media \(pointer: coarse\) and \(orientation: landscape\)/.test(cssSrc),
    "`css/style.css` 里手机横屏媒体查询仍在（折叠策略的适用环境）"
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

/** 只改一个定义体（或全文件里唯一的一处），避免误伤同名调用点。 */
function mutateBody(src, pattern, needle, replacement) {
  const r = bodyRange(src, pattern);
  if (!r) return null;
  if (!r.body.includes(needle)) return null;
  const body = r.body.split(needle).join(replacement);
  return src.slice(0, r.start) + body + src.slice(r.end);
}

/**
 * 变异工具组。
 *
 * ⚠ 本仓 JS/CSS 都是 **CRLF**：多行 needle 里写 `\n` 永远匹配不到（踩过一次，
 *   症状是「变异未生效：针没扎上」，看起来像断言失败，其实是针本身没找着地方）。
 *   所以下面一律用单行 needle 或 `\r?\n` 正则。
 */
// 每个变异对应上面的一条要点：改坏之后**至少一条**检查必须转红。
// 变异在**内存字符串**上做（`{ src, css }`，只给一个就是只改那个文件），不落盘。
/**
 * 把「追加首发预览」那一行搬到 `await ensureMatchPitch(true)` **之前**（模拟插错位置）。
 * ⚠ 本仓 JS/CSS 都是 **CRLF**：多行 needle 里写 `\n` 永远匹配不到（踩过）。
 */
function moveAppendBeforeEnsurePitch(src) {
  const r = bodyRange(src, OPEN_MATCH);
  if (!r) return null;
  const lines = [...r.body.matchAll(/^[ \t]*lineupPanel\.insertAdjacentHTML\([^\n]*\r?\n/gm)];
  if (lines.length !== 1) return null;
  const em = /^[ \t]*await ensureMatchPitch\(true\);\r?\n/m.exec(r.body);
  if (!em) return null;
  const moved = r.body.replace(lines[0][0], "").replace(em[0], lines[0][0] + em[0]);
  return src.slice(0, r.start) + moved + src.slice(r.end);
}
const mutations = [
  ["① 插入点挪到 ensureMatchPitch 之前", () => ({ src: moveAppendBeforeEnsurePitch(main) })],
  ["② 标题去掉「预计」", () => ({ src: mutateBody(main, LINEUP_PREVIEW, "双方预计首发", "双方首发") })],
  [
    "③ 新块加一个 id=",
    () => ({
      src: mutateBody(
        main,
        LINEUP_PREVIEW,
        '<details class="brief-lineups"',
        '<details class="brief-lineups" id="lineups-preview"'
      ),
    }),
  ],
  ["④ 标题去掉 Projected", () => ({ src: mutateBody(main, LINEUP_PREVIEW, "Projected starting XIs", "Starting XIs") })],
  [
    "⑤ 自己按下标排人（不用 assignPlayersToFormationSlots）",
    () => ({
      src: mutateBody(
        main,
        LINEUP_PREVIEW,
        "assignPlayersToFormationSlots(getLineupPlayers(club), slots)",
        "getLineupPlayers(club)"
      ),
    }),
  ],
  [
    "⑥ 追加改回重设 panel.innerHTML",
    () => ({
      src: mutateBody(
        main,
        OPEN_MATCH,
        'lineupPanel.insertAdjacentHTML("beforeend", renderLineupsPreviewHtml(home, away));',
        'lineupPanel.innerHTML += renderLineupsPreviewHtml(home, away);'
      ),
    }),
  ],
  [
    "⑦ 删掉 matchMedia 守卫",
    () => ({
      src: mutateBody(
        main,
        LINEUP_PREVIEW,
        'typeof window.matchMedia === "function" &&',
        "true &&"
      ),
    }),
  ],
  [
    "⑧ 复用赛前讲话的 name",
    () => ({
      src: mutateBody(
        main,
        LINEUP_PREVIEW,
        "<summary>",
        '<summary><input type="radio" name="pre-team-talk" value="x" /></summary><summary>'
      ),
    }),
  ],
  [
    "⑨ 引入 await / fetch（破坏纯字符串同步）",
    () => ({
      src: mutateBody(
        main,
        LINEUP_PREVIEW,
        'const en = getLang() === "en";',
        'void fetch("x"); await 0;\n  const en = getLang() === "en";'
      ),
    }),
  ],
  ["⑩ 去掉「手机折叠」分支（永远 open）", () => ({ src: mutateBody(main, LINEUP_PREVIEW, '{wide ? " open" : ""}', '{" open"}') })],
  [
    "⑪ 本块自己加 max-height（双滚动条）",
    () => {
      // ⚠ 用正则而不是 `".brief-lineups {\n"`：本仓 CSS 是 CRLF，写 `\n` 匹配不到。
      const mutated = css.replace(/\.brief-lineups \{/, ".brief-lineups {\r\n  max-height: 140px;");
      return mutated !== css ? { css: mutated } : null;
    },
  ],
];

console.log(`\n[2] 变异测试（每次只改坏一处，共 ${mutations.length} 项）`);
for (const [label, build] of mutations) {
  const built = build();
  const src = built && typeof built.src === "string" ? built.src : main;
  const cssSrc = built && typeof built.css === "string" ? built.css : css;
  // 变异必须真的改动了源码，否则「被抓住」毫无意义（针没扎到人身上）。
  const applied = !!built && (src !== main || cssSrc !== css);
  const caught = applied ? audit(src, cssSrc).filter((r) => !r.ok) : [];
  check(
    applied && caught.length > 0,
    label,
    applied ? `红 ${caught.length} 项：${caught[0]?.label ?? ""}` : "变异未生效（针没扎上）"
  );
}

// ── 收尾：变异测试全在内存里做，工作区文件必须**逐字节未变** ────────────────
console.log("\n[3] 工作区文件未被测试改动（sha256）");
const mainAfter = sha256(readFileSync(mainPath, "utf8"));
const cssAfter = sha256(readFileSync(cssPath, "utf8"));
check(mainAfter === mainSha, `${mainPath} sha256 前后一致`, mainAfter.slice(0, 16));
check(cssAfter === cssSha, `${cssPath} sha256 前后一致`, cssAfter.slice(0, 16));

if (failed) {
  console.error(`\nprematch-lineup-audit: ${failed} 项失败`);
  process.exit(1);
}
console.log("\nprematch-lineup-audit: ok");
