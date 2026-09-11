// Evaluate the existing height limit at the same instant as the save's XY
// projection. Reuse the physical integrator, including any intervening bounce.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { reportCandidateOnExit } from "./_candidate-exit-reports.mjs";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source).replaceAll("\r\n", "\n");
  const gate = `        // This shot-contact model has no jumping save above the crossbar.
        if ((b.z || 0) > 2.44) continue;
`;
  assert.equal(source.split(gate).length, 2);
  source = source.replace(gate, "");
  const marker = "        tt = clamp(tt, 0, 1);";
  assert.equal(source.split(marker).length, 2);
  source = source.replace(marker, marker + `
        let contactZ = b.z || 0;
        if (Number.isFinite(b._prevZ) && Number.isFinite(b._prevVz)) {
          const heightState = { z: b._prevZ, vz: b._prevVz, vx: 0, vy: 0 };
          applyFreeBallForces(heightState, (Number.isFinite(b._stepDt) ? b._stepDt : dt) * tt);
          contactZ = heightState.z;
        }
        // This shot-contact model has no jumping save above the crossbar.
        if (contactZ > 2.44) continue;`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ goalkeeperContactHeightCandidate: { loadedEngineSha256 } }));
