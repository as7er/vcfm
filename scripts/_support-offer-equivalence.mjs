// Compare the pinned process-local candidate with the production implementation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SimEngine } from "../js/sim/engine.js";

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function club(id, ability) {
  const attrs = ["pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
    "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning", "kicking"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, ability + ((i * 7 + ability) % 5) - 2])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced" } };
}
const digest = (data) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
if (process.argv.includes("--sample")) {
  const results = [];
  for (const profile of ["standard", "background"]) for (const strong of [false, true]) {
    const seed = strong ? 265000 : 165000;
    const random = seeded(seed);
    let draws = 0;
    const dt = profile === "background" ? 0.3 : 0.1;
    const e = new SimEngine(club(`home-${seed}`, strong ? 15 : 13), club(`away-${seed}`, strong ? 11 : 13), {
      random: () => { draws++; return random(); }, timeStep: dt, simulationProfile: profile,
      separationPasses: profile === "background" ? 4 : 8,
    });
    const frameHash = createHash("sha256");
    for (let step = 0; step < Math.round(5400 / dt); step++) {
      e.step(dt);
      frameHash.update(JSON.stringify([draws, e.snapshot(),
        e.agents.map((a) => [a.offBallTarget?.offer || null, a.supportScreen || null])]));
    }
    results.push({ profile, strong, seed, draws, score: e.score, frameHash: frameHash.digest("hex"),
      eventsHash: digest(e.events), finalHash: digest(e.snapshot()) });
  }
  console.log(`SUPPORT_TRACE ${JSON.stringify(results)}`);
} else {
  const samples = [];
  for (const preloads of [[], ["--import", "./scripts/_v252-baseline.mjs", "--import", "./scripts/_support-offer-actual-distance-candidate.mjs"]]) {
    const result = spawnSync(process.execPath, [...preloads, "scripts/_support-offer-equivalence.mjs", "--sample"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      // ⚠ **必须显式写 `stdio`**：只给 `encoding` 时 Node 用默认 stdio（三路都是 pipe，
      //   含 stdin），某些 Windows 环境下 `spawnSync` 直接返回 `status: null` +
      //   `error.code = "EBUSY"`，子进程根本没启动。
      //   实测（2026-09-24）：`{encoding:"utf8"}` → EBUSY；
      //   `{stdio:["ignore","pipe","pipe"], encoding:"utf8"}` → 正常。
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      windowsHide: true,
    });
    // 启动失败要**明确报出来**，别让它伪装成「断言没红」。
    if (result.error) {
      throw new Error(`子进程未启动（${result.error.code}）：${result.error.message}`);
    }
    assert.equal(result.status, 0, result.stderr || "the comparison match must complete");
    const trace = result.stdout.split(/\r?\n/).find((line) => line.startsWith("SUPPORT_TRACE "));
    assert.ok(trace, "a complete trace is required");
    samples.push(JSON.parse(trace.slice("SUPPORT_TRACE ".length)));
  }
  assert.deepEqual(samples[0], samples[1], "production must preserve every candidate frame, offer, event and random draw");
  console.log(JSON.stringify({ equivalent: true, matches: samples[0] }, null, 2));
}
