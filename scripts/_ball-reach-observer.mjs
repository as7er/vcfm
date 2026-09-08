// Read-only contact observation; no decision calls or random draws.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url);
const command = process.argv.slice(1);
const groups = new Map();
const examples = [];
const observe = 'globalThis[Symbol.for("vcfm.ball-reach-observer")]';
let loadedEngineSha256;
globalThis[Symbol.for("vcfm.ball-reach-observer")] = (engine, player, stage, kind) => {
  const b = engine.ball;
  const type = b.isCrossPass ? "cross" : b.isThroughPass ? "through" : "ordinary";
  const key = `${stage}:${b.state}:${type}:${player.role === "GK" ? "GK" : "outfield"}`;
  const row = groups.get(key) || { key, count: 0, aboveReach: 0, maximumHeight: 0 };
  row.count++;
  row.maximumHeight = Math.max(row.maximumHeight, b.z || 0);
  if (b.z > (player.role === "GK" ? 3 : 2.2)) {
    row.aboveReach++;
    if (examples.length < 24) examples.push({ match: engine.home.id, t: engine.t, stage, kind,
      player: { id: player.id, role: player.role, x: player.x, y: player.y },
      ball: { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, state: b.state, type } });
  }
  groups.set(key, row);
};
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL.href) return result;
  loadedEngineSha256 = createHash("sha256").update(String(result.source)).digest("hex");
  let source = String(result.source).replace(/\r\n/g, "\n");
  for (const [anchor, replacement] of [
    ["    const incomingVx = b.vx || 0;", `    ${observe}(this, a, "control", kind);\n    const incomingVx = b.vx || 0;`],
    ["          if (d < SIM.CONTROL_RADIUS_METRES + 2.4) {",
      `          if (d < SIM.CONTROL_RADIUS_METRES + 2.4) {\n            ${observe}(this, o, "attempt", "intercept");`],
    ["    if (best) {\n      // —— 越位判罚 ——",
      `    if (best) {\n      ${observe}(this, best, "attempt", "collect");\n      // —— 越位判罚 ——`],
  ]) {
    assert.equal(source.split(anchor).length, 2, `unique reach observer anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  }
  return { ...result, source };
} });
process.on("exit", (exitCode) => {
  const directory = new URL("../.tmp-continuity/ball-reach/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  const path = new URL(`${command.slice(1, 5).join("-")}-${Date.now()}.json`, directory);
  const report = { command, preloads: process.execArgv, exitCode, loadedEngineSha256,
    engineSha256: createHash("sha256").update(readFileSync(engineURL)).digest("hex"),
    groups: [...groups.values()], examples };
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ballReach: { ...report, examples: undefined } }, null, 2));
  console.log(`Ball reach evidence: ${path.pathname}`);
});
