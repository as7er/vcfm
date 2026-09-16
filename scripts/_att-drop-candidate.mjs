// REVERSE-VALIDATION PROBE (not a candidate, never to be adopted).
//
// Purpose: prove the two mechanism assertions added to
// `scripts/attack-shape-compaction-audit.mjs` on 2026-09-15 actually fire.
//
//   1. `backLine >= 53`   — fails on the unfixed engine (49.69), i.e. it catches
//      a regression back to the stretched shape. Verified by running the audit
//      with no preload at all; no probe needed here.
//   2. `forwardTop >= 92` — must fail when the block is shortened from the TOP
//      (pulling the forward line back) instead of from the back. That is the
//      degenerate fix the old ratio assertion was written to catch.
//
// ⚠ The obvious way to pull the forwards back does NOT work: the forwards'
// advance-depth constant in `_chooseAttackOffBallTarget`
// (`a.baseY + dir * ((getsForward ? 18 : core ? 12 : 16) + roleDepth * 5)`)
// is not the binding constraint. Measured: lowering it by 10 m left
// `forwardTop` at 95.03 m versus the 94.39 m baseline — the front line is pinned
// by the ball position plus the offside line, not by that constant.
//
// So this probe widens the offside buffer for ATT instead: attackers are held
// further behind the offside line, which really does pull the front line back.
//
// Usage:
//   VCFM_ATT_OFFSIDE_BUFFER=8 node --import ./scripts/_att-drop-candidate.mjs \
//     scripts/_cb-tail-sweep.mjs standard
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
// 以 y 格为单位，与 `_clampOffside` 的 roleBuffer 同单位（1 格 = 1.05 m）
const BUFFER_GRID = Number(process.env.VCFM_ATT_OFFSIDE_BUFFER || 8);

let loadedEngineSha256;
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== engineURL) return result;
    let source = String(result.source).replace(/\r\n/g, "\n");
    const anchor = '        ? 0.8 + ((a.num || 0) % 3) * 0.35';
    assert.equal(source.split(anchor).length, 2, "unique ATT offside-buffer anchor");
    source = source.replace(anchor, `        ? 0.8 + ((a.num || 0) % 3) * 0.35 + ${BUFFER_GRID}`);
    loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
    return { ...result, source };
  },
});
process.on("exit", () => {
  console.log(JSON.stringify({ attOffsideBufferProbe: { loadedEngineSha256, BUFFER_GRID } }));
});
