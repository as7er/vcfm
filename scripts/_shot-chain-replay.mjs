// Replay captured launches. Free-flight results separate aim from ball physics;
// full-flight trials compare both real profiles from the same captured scene.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deserialize } from "node:v8";
import { SimEngine, SIM } from "../js/sim/engine.js";

const path = process.argv[2];
assert.ok(path?.endsWith(".bin"), "provide a shot-chain snapshot .bin file");
const trials = Math.max(1, Number(process.argv[3]) || 8);
const snapshots = deserialize(readFileSync(path));
const original = JSON.parse(readFileSync(path.replace(/\.bin$/, ".json"), "utf8"));
const candidate = process.argv.includes("--legacy-shot") ? "legacy" : "production";
const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let n = Math.imul(seed ^ (seed >>> 15), seed | 1);
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
};

function replay(snapshot, profile, seed, free) {
  const engine = Object.assign(Object.create(SimEngine.prototype), deserialize(snapshot.state));
  engine.random = random(seed);
  engine.simulationProfile = profile;
  engine.timeStep = profile === "background" ? 0.3 : SIM.DT;
  engine.separationPasses = profile === "background" ? 4 : 8;
  engine._fatigueCheckT = Infinity;
  engine._emitTimeOffset = 0;
  const start = { ...engine.ball };
  const startAt = engine.t;
  let result;
  let crossing;
  const bounds = engine._resolveBounds;
  engine._resolveBounds = function () {
    const b = this.ball;
    if (b.y <= 0 || b.y >= 100) {
      const goalY = b.y <= 0 ? 0 : 100;
      const ratio = (goalY - b._prevY) / (b.y - b._prevY);
      const dt = b._stepDt * ratio;
      const elapsed = this.t - startAt + dt;
      const z = Math.max(0, b._prevZ + b._prevVz * dt - 9 * dt * dt);
      crossing = { x: b._prevX + (b.x - b._prevX) * ratio, z, elapsed,
        ballisticZ: Math.max(0, start.z + start.vz * elapsed - 9 * elapsed ** 2) };
    }
    return bounds.call(this);
  };
  engine._goal = () => { result ??= "goal"; engine.ball.state = "dead"; };
  engine._restart = (type) => { result ??= crossing ? crossing.z >= 2.44 ? "high" : "wide" : type; engine.ball.state = "dead"; };
  engine._emit = (type) => {
    if (["save", "block", "woodwork", "handball", "penalty"].includes(type)) result ??= type;
  };
  for (let index = 0; index < 80 && !result; index++) {
    if (free) {
      engine.t = startAt + index * SIM.DT;
      engine._stepBall(SIM.DT);
      engine._resolveBounds();
    } else engine.step(engine.timeStep);
    if (engine.ball.owner || engine.ball.state !== "shot") result ??= `ended-${engine.ball.state}`;
  }
  return { outcome: result || "unfinished", crossing };
}

const countBy = (rows, key) => rows.reduce((out, row) => {
  out[row[key]] = (out[row[key]] || 0) + 1;
  return out;
}, {});
const eligible = snapshots.filter((snapshot) => deserialize(snapshot.state).ball.state === "shot");
assert.ok(eligible.length > 0, "snapshot file must contain ordinary shot flights");
const records = eligible.map((snapshot) => {
  const record = original.records[snapshot.id];
  const free = replay(snapshot, "standard", 1, true);
  const paired = [];
  for (let trial = 0; trial < trials; trial++) {
    const seed = 901000 + snapshot.id * 100 + trial;
    paired.push({ standard: replay(snapshot, "standard", seed, false).outcome,
      background: replay(snapshot, "background", seed, false).outcome });
  }
  return { id: snapshot.id, distanceBin: record.distanceBin, originalOutcome: record.outcome,
    targetInFrame: record.targetInFrame, targetZ: record.targetZ, targetX: record.targetX, free, paired };
});
const paired = records.flatMap((r) => r.paired);
const crossed = records.filter((r) => r.free.crossing);
const report = { input: path, candidate, trials, launches: records.length,
  node: process.version, completedAt: new Date().toISOString(),
  sourceSnapshotEngineSha256: original.engineSha256,
  replayEngineSha256: createHash("sha256").update(readFileSync(new URL("../js/sim/engine.js", import.meta.url))).digest("hex"),
  preloads: process.execArgv,
  excludedNonShotLaunches: snapshots.length - eligible.length,
  freeOutcomes: countBy(records.map((r) => r.free), "outcome"),
  aimedInFrame: records.filter((r) => r.targetInFrame).length,
  aimedInFrameThenHigh: records.filter((r) => r.targetInFrame && r.free.outcome === "high").length,
  heightMinusBallisticMean: crossed.reduce((sum, r) => sum + r.free.crossing.z - r.free.crossing.ballisticZ, 0) / crossed.length,
  standard: countBy(paired, "standard"), background: countBy(paired, "background"),
  sameOutcomePct: paired.filter((r) => r.standard === r.background).length * 100 / paired.length,
  records };
const output = path.replace(/\.bin$/, `-${candidate}-${Date.now()}-replay.json`);
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, records: undefined, output }, null, 2));
