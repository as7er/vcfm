// Trace the calibrated candidate and the integrated implementation with identical
// fixtures. Preload _shot-chain-observer with --unobserved for its fixture exports.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { SimEngine, SIM } from "../js/sim/engine.js";
import { makeClub, seededRandom } from "./match-realism-audit.mjs?shot-fixtures";

const count = Math.max(1, Number(process.argv[2]) || 2);
const profile = process.argv[3] || "standard";
const label = process.argv.find((arg) => arg.startsWith("--sample-label="))?.split("=")[1] || "sample";
assert.match(label, /^[a-z0-9-]+$/);
assert.ok(["standard", "background"].includes(profile));
const dt = profile === "background" ? 0.3 : SIM.DT;
const matches = [];
for (let index = 0; index < count; index++) {
  const uneven = index % 2 === 1;
  const seed = (uneven ? 265000 : 165000) + Math.floor(index / 2);
  const originalRandom = Math.random;
  const rng = seededRandom(seed);
  let draws = 0;
  Math.random = () => { draws++; return rng(); };
  try {
    const engine = new SimEngine(makeClub(`home-${seed}`, uneven ? 15 : 13),
      makeClub(`away-${seed}`, uneven ? 11 : 13),
      { simulationProfile: profile, timeStep: dt, separationPasses: profile === "background" ? 4 : 8 });
    const frames = createHash("sha256");
    for (let step = 0; step < Math.round(5400 / dt); step++) {
      engine.step(dt);
      frames.update(JSON.stringify({ state: engine.snapshot(), draws }));
    }
    matches.push({ seed, uneven, score: engine.score, randomDraws: draws,
      frameHash: frames.digest("hex"),
      eventHash: createHash("sha256").update(JSON.stringify(engine.events)).digest("hex") });
  } finally {
    Math.random = originalRandom;
  }
}
const out = new URL("../.tmp-continuity/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL(`corner-trace-${label}-${profile}.json`, out), JSON.stringify({ profile, matches }, null, 2));
console.log(JSON.stringify({ cornerTrace: { label, profile, matches } }, null, 2));
