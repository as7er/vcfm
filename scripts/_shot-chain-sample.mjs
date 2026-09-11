// Run via the pass-route probe with --import ./scripts/_shot-chain-observer.mjs.
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";
import { createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { makeClub, seededRandom } from "./match-realism-audit.mjs?shot-fixtures";

const count = Math.max(1, Number(process.argv[2]) || 8);
const profile = process.argv[3] || "standard";
assert.ok(["standard", "background"].includes(profile));
const dt = profile === "background" ? 0.3 : SIM.DT;
const traceState = process.argv.includes("--trace-state");
// V8's binary format is not canonical: equal JS values can have different
// encodings after JIT representation changes. Preserve graph links explicitly
// when comparing the values, while retaining the original binary hash below.
function graphValue(value, seen = new Map()) {
  if (value === undefined) return { $undefined: true };
  if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) };
  if (Object.is(value, -0)) return { $number: "-0" };
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return { $ref: seen.get(value) };
  const id = seen.size;
  seen.set(value, id);
  if (value instanceof Map) return { $id: id, $map: [...value].map(([k, v]) => [graphValue(k, seen), graphValue(v, seen)]) };
  if (value instanceof Set) return { $id: id, $set: [...value].map((v) => graphValue(v, seen)) };
  if (ArrayBuffer.isView(value)) return { $id: id, $type: value.constructor.name, values: [...value] };
  if (Array.isArray(value)) return { $id: id, $array: value.map((v) => graphValue(v, seen)) };
  return { $id: id, $object: Object.fromEntries(Object.keys(value).sort().map((k) => [k, graphValue(value[k], seen)])) };
}
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
    const frames = traceState ? createHash("sha256") : null;
    for (let step = 0; step < Math.round(5400 / dt); step++) {
      engine.step(dt);
      if (frames) frames.update(JSON.stringify(graphValue({
        randomDraws, snapshot: engine.snapshot(), stats: engine.stats,
        ball: engine.ball, agents: engine.agents, plans: engine._defPlans,
        passSupportRun: engine._passSupportRun, attackSince: engine._teamAttackSince,
      })));
    }
    const state = serialize({ ...engine, random: undefined });
    matches.push({ seed, score: engine.score, shots: engine.events.filter((e) => e.type === "shot").length,
      randomDraws, eventHash: createHash("sha256").update(JSON.stringify(engine.events)).digest("hex"),
      stateHash: createHash("sha256").update(state).digest("hex"),
      ...(frames ? { framesHash: frames.digest("hex"),
        stateValueHash: createHash("sha256").update(JSON.stringify(graphValue(deserialize(state)))).digest("hex") } : {}) });
    console.log(`Shot sample ${profile} ${index + 1}/${count}: ${engine.score.home}-${engine.score.away}`);
  } finally { Math.random = originalRandom; }
}
console.log(JSON.stringify({ shotSamples: { profile, matches } }, null, 2));
