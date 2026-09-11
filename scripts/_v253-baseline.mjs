// Freeze v253 so every global-movement candidate remains reproducible.
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const scripts = new URL("js/", root).href;
const revision = "5f1d152";
const sources = new Map();
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (!url.startsWith(scripts)) return result;
  const relative = decodeURIComponent(url.slice(root.href.length).split("?")[0]);
  if (!sources.has(relative)) sources.set(relative,
    execFileSync("git", ["show", `${revision}:${relative}`], {
      cwd: fileURLToPath(root), encoding: "utf8", windowsHide: true,
    }));
  return { ...result, source: sources.get(relative) };
} });
