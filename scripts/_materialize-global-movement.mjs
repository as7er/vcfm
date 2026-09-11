// Export the exact loaded candidate for review without editing production.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
const label = process.argv[2];
assert.match(label || "", /^[a-z0-9-]+$/);
const root = new URL("../", import.meta.url);
const directory = new URL(`.tmp-continuity/global-movement/materialized/${label}/`, root);
assert.ok(!existsSync(directory), "use a new candidate export label");
mkdirSync(directory, { recursive: true });
const paths = ["js/sim/engine.js", "js/data.js", "js/player-positions.js"];
const pathsByURL = new Map(paths.map((path) => [new URL(path, root).href, path]));
const files = {};
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  const path = pathsByURL.get(url);
  if (path) {
    const source = String(result.source);
    const output = path.replaceAll("/", "--");
    writeFileSync(new URL(output, directory), source);
    files[path] = { output, sha256: createHash("sha256").update(source).digest("hex") };
  }
  return result;
} });
await import("../js/sim/engine.js");
assert.deepEqual(Object.keys(files).sort(), paths.sort());
const manifest = { label, createdAt: new Date().toISOString(), preloads: process.execArgv, files };
writeFileSync(new URL("manifest.json", directory), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
