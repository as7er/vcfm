// Freeze v252 for reproducing support-offer candidates after integration.
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const scripts = new URL("js/", root).href;
const revision = "468816e37effa7139fb2bd28d543d0f7d2ed6413";
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
