/**
 * 把 `js/` 全部钉到任意一个历史 revision（只读、内存内）。
 *
 * 用途：`_v253-baseline.mjs` 把 revision 写死成 `5f1d152`，但它早已不是 HEAD，
 * 拿它测新修复会跑到旧引擎上（见 docs/gk-same-instant-contact-2026-09-14.md §7.4）。
 * 需要「隔离某一笔改动的效果」时，用本钩子指定任意 revision。
 *
 * ⚠ 钉住旧 revision 只对**不依赖冻结参考**的审计安全。带冻结参考的审计
 * （如 `match-realism-audit.mjs` 的 `STANDARD_PROFILE_REFERENCE_24`）在旧引擎上
 * 会以「参考过期」为由失败——那是预期的，读失败断言时要分清是参考过期还是引擎差异。
 *
 * 用法：
 *   VCFM_PIN_REV=75d9e4c node --import ./scripts/_pin-engine-revision.mjs scripts/<审计>.mjs [参数]
 *
 * 与 `_v253-baseline.mjs` 的差别：本钩子把 revision 从环境变量读入，
 * 并会在 `stderr` 打印实际钉住的 revision 与解析到的 commit，避免跑完不知道跑的是谁。
 */
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const revision = process.env.VCFM_PIN_REV;
if (!revision) {
  throw new Error("VCFM_PIN_REV is required, e.g. VCFM_PIN_REV=75d9e4c node --import ./scripts/_pin-engine-revision.mjs <audit>");
}

const root = new URL("../", import.meta.url);
const jsPrefix = new URL("js/", root).href;
const sources = new Map();

const resolved = execFileSync("git", ["rev-parse", "--short", revision], {
  cwd: fileURLToPath(root), encoding: "utf8", windowsHide: true,
}).trim();
process.stderr.write(`[pin-engine-revision] pinned js/ to ${revision} (${resolved})\n`);

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith(jsPrefix)) return result;
    const relative = decodeURIComponent(url.slice(root.href.length).split("?")[0]);
    if (!sources.has(relative)) {
      sources.set(relative, execFileSync("git", ["show", `${revision}:${relative}`], {
        cwd: fileURLToPath(root), encoding: "utf8", windowsHide: true,
      }));
    }
    return { ...result, source: sources.get(relative) };
  },
});
