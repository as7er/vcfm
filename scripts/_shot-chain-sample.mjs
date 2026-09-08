// Run via the pass-route probe with --import ./scripts/_shot-chain-observer.mjs.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";
import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import { makeClub, seededRandom } from "./match-realism-audit.mjs?shot-fixtures";

const count = Math.max(1, Number(process.argv[2]) || 8);
const profile = process.argv[3] || "standard";
assert.ok(["standard", "background"].includes(profile));
const dt = profile === "background" ? 0.3 : SIM.DT;
const matches = [];
for (let index = 0; index < count; index++) {
  const seed = 165000 + index;
  const originalRandom = Math.random;
  let randomDraws = 0;
  const random = seededRandom(seed);
  Math.random = () => { randomDraws++; return random(); };
  try {
    const engine = new SimEngine(makeClub(`home-${seed}`, 13), makeClub(`away-${seed}`, 13), {
      simulationProfile: profile, timeStep: dt, separationPasses: profile === "background" ? 4 : 8,
    });
    for (let step = 0; step < Math.round(5400 / dt); step++) engine.step(dt);
    matches.push({ seed, score: engine.score, shots: engine.events.filter((e) => e.type === "shot").length,
      randomDraws, eventHash: createHash("sha256").update(JSON.stringify(engine.events)).digest("hex"),
      stateHash: createHash("sha256").update(serialize({ ...engine, random: undefined })).digest("hex") });
    console.log(`Shot sample ${profile} ${index + 1}/${count}: ${engine.score.home}-${engine.score.away}`);
  } finally { Math.random = originalRandom; }
}
console.log(JSON.stringify({ shotSamples: { profile, matches } }, null, 2));
