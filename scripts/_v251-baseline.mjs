// Freeze the complete JavaScript runtime for reproducing attacking-play
// candidates after integration. The candidate preloads must follow this one.
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const scripts = new URL("js/", root).href;
const revision = "524589d7c825d2b5113751a0588f9d1d0f8b5111";
const sources = new Map();
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (!url.startsWith(scripts)) return result;
  const relative = decodeURIComponent(url.slice(root.href.length).split("?")[0]);
  if (!sources.has(relative)) sources.set(relative,
    execFileSync("git", ["show", `${revision}:${relative}`], { cwd: fileURLToPath(root), encoding: "utf8" }));
  return { ...result, source: sources.get(relative) };
} });
