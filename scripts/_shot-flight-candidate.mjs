// Process-local experiment: use the existing ballistic/bounce solver for shots.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const legacy = process.argv.includes("--legacy-shot");
const legacySource = legacy ? execFileSync("git", ["show", "9f32cb4902ac2c74ce965cc8d31be8c4c0436e13"],
  { cwd: new URL("../", import.meta.url), encoding: "utf8" }) : null;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  if (legacy) return { ...result, source: legacySource };
  const source = String(result.source);
  const anchor = 'if (b.state === "shot") applyShotForces(b, dt);';
  if (!source.includes(anchor)) {
    assert.ok(!source.includes("function applyShotForces("), "production already uses the shared solver");
    return result;
  }
  assert.equal(source.split(anchor).length, 2, "unique shot force call");
  return { ...result, source: source.replace(anchor, 'if (b.state === "shot") applyFreeBallForces(b, dt);') };
} });
