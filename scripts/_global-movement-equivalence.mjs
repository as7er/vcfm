// Compare the fixed v253 candidate with production before final verification.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SimEngine } from "../js/sim/engine.js";
const candidate = process.argv[2] || "_coordinated-pass-risk-candidate";
assert.match(candidate, /^_[a-z0-9-]+$/);
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
    "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling", "positioning", "kicking", "decisions"];
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-p${i}`, name: `${id}-p${i}`, pos, number: i + 1, fitness: 100,
      attrs: Object.fromEntries(attrs.map((key) => [key, ability + ((i * 7 + ability) % 5) - 2])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id),
    pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced" } };
}
const hash = (data) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
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
    const frames = createHash("sha256");
    for (let i = 0; i < Math.round(5400 / dt); i++) {
      e.step(dt);
      frames.update(JSON.stringify([draws, e.snapshot(), e.stats, e._teamAttackSince, e._passSupportRun,
        [e.ball.lastPassAt, e.ball.receiverId, e.ball.targetX, e.ball.targetY, e.ball.expectedAt],
        Object.entries(e._defPlans).map(([team, plan]) => [team, { ...plan, jobs: [...plan.jobs] }]),
        e.agents.map((a) => [a.detailedPosition, a.roleId, a.dutyId, a.intent, a.offBallTarget,
          a._passIntercept, a._pressTargetVelocity, a._cornerArrivalAt, a.pendingBallAction && {
          action: a.pendingBallAction.action, readyAt: a.pendingBallAction.readyAt,
          targetHeading: a.pendingBallAction.targetHeading,
          tx: a.pendingBallAction.payload?.tx, ty: a.pendingBallAction.payload?.ty,
          toId: a.pendingBallAction.payload?.agent?.id,
          value: a.pendingBallAction.payload?.value,
          interceptionRisk: a.pendingBallAction.payload?.interceptionRisk,
        }])]));
    }
    results.push({ profile, strong, seed, draws, score: e.score, frames: frames.digest("hex"),
      events: hash(e.events), final: hash(e.snapshot()) });
  }
  console.log(`MOVEMENT_TRACE ${JSON.stringify(results)}`);
} else {
  const samples = await Promise.all([[], ["--import", "./scripts/_v253-baseline.mjs", "--import", `./scripts/${candidate}.mjs`]]
    .map((preloads) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...preloads, "scripts/_global-movement-equivalence.mjs", candidate, "--sample"], {
        cwd: fileURLToPath(new URL("../", import.meta.url)), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      child.stdout.on("data", (data) => { stdout += data; });
      child.stderr.on("data", (data) => { stderr += data; });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(stderr || `sample exited ${code}`));
        const trace = stdout.split(/\r?\n/).find((line) => line.startsWith("MOVEMENT_TRACE "));
        if (!trace) return reject(new Error("complete match trace is required"));
        resolve(JSON.parse(trace.slice("MOVEMENT_TRACE ".length)));
      });
    })));
  assert.deepEqual(samples[0], samples[1], "production must preserve candidate frames, intentions, events and random draws");
  console.log(JSON.stringify({ equivalent: true, candidate, matches: samples[0] }, null, 2));
}
