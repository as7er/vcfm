// The swept save compared the ball's mid-step contact point against the
// goalkeeper's step-END position. Record each agent's step-start position and
// evaluate the whole contact geometry at the same instant instead.
//
// Why: `_integrate` runs before `_resolvePossession`, so `gk.x/gk.y` is already
// the future position. Projecting it onto the ball's path (`tt`) and measuring
// `dPath` from it treats the keeper as frozen at its end point for the whole
// step. The correct model is the minimum of |B(t) - G(t)| over the step, which
// is what `goalkeeper-relative-contact-audit.mjs` asserts.
//
// The error is antisymmetric: it under-saves when the keeper moves away from
// the ball's line and over-saves when it moves toward it. Measured with
// `_gk-contact-sweep-probe.mjs`: at dt=0.1 the save probability moves by at
// most +-0.46pp, but at dt=0.3 it reaches +-5.33pp, because the keeper covers
// three times the ground per step. So this is also a profile-equivalence fix.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { reportCandidateOnExit } from "./_candidate-exit-reports.mjs";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;

const PATCHES = [
  // 1) Record every agent's step-start position before integration moves it.
  [
    `      for (const a of this.agents) {
        if (this._goalkeeperNeedsFineMovement(a, physicsDt)) {`,
    `      for (const a of this.agents) {
        a._stepStartX = a.x;
        a._stepStartY = a.y;
        if (this._goalkeeperNeedsFineMovement(a, physicsDt)) {`,
  ],
  // 2) Same-instant contact geometry: build the relative path, then read both
  //    the ball and the keeper at the contact parameter.
  [
    `        const segment = pitchVectorMetres(x1 - x0, y1 - y0);
        const offset = pitchVectorMetres(gk.x - x0, gk.y - y0);
        const segLen2 = segment.x ** 2 + segment.y ** 2 || 1e-6;
        let tt = (offset.x * segment.x + offset.y * segment.y) / segLen2;
        tt = clamp(tt, 0, 1);
        const cx = x0 + (x1 - x0) * tt;
        const cy = y0 + (y1 - y0) * tt;
        const dPath = pitchDistanceBetween(gk.x, gk.y, cx, cy);
        const lateral = Math.abs(gk.x - cx) * (SIM.PITCH_W_METRES / SIM.FIELD_W);`,
    `        const gx0 = Number.isFinite(gk._stepStartX) ? gk._stepStartX : gk.x;
        const gy0 = Number.isFinite(gk._stepStartY) ? gk._stepStartY : gk.y;
        const relStart = pitchVectorMetres(x0 - gx0, y0 - gy0);
        const relEnd = pitchVectorMetres(x1 - gk.x, y1 - gk.y);
        const rel = { x: relEnd.x - relStart.x, y: relEnd.y - relStart.y };
        const relLen2 = rel.x ** 2 + rel.y ** 2 || 1e-6;
        let tt = clamp(-(relStart.x * rel.x + relStart.y * rel.y) / relLen2, 0, 1);
        const cx = x0 + (x1 - x0) * tt;
        const cy = y0 + (y1 - y0) * tt;
        const gkx = gx0 + (gk.x - gx0) * tt;
        const gky = gy0 + (gk.y - gy0) * tt;
        const dPath = pitchDistanceBetween(gkx, gky, cx, cy);
        const lateral = Math.abs(gkx - cx) * (SIM.PITCH_W_METRES / SIM.FIELD_W);`,
  ],
  // 3) The two "can the keeper still get there" gates were also mixing instants.
  [
    `        const pastGk =
          gk.team === "home" ? cy > gk.y + 1.6 : cy < gk.y - 1.6;
        if (pastGk) continue;
        // 球已明显更靠近门线、门将还在外线 → 追不上
        const ballCloserToLine =
          gk.team === "home"
            ? Math.abs(cy - goalY) + 1.2 < Math.abs(gk.y - goalY)
            : Math.abs(cy - goalY) + 1.2 < Math.abs(gk.y - goalY);`,
    `        const pastGk =
          gk.team === "home" ? cy > gky + 1.6 : cy < gky - 1.6;
        if (pastGk) continue;
        // 球已明显更靠近门线、门将还在外线 → 追不上
        const ballCloserToLine =
          gk.team === "home"
            ? Math.abs(cy - goalY) + 1.2 < Math.abs(gky - goalY)
            : Math.abs(cy - goalY) + 1.2 < Math.abs(gky - goalY);`,
  ],
  // 4) Presentation: dive side and heading should use the same instant too.
  [
    `        const diveDir = cx >= gk.x ? 1 : -1;`,
    `        const diveDir = cx >= gkx ? 1 : -1;`,
  ],
  [
    `        gk.heading = Math.atan2(cy - gk.y, cx - gk.x);`,
    `        gk.heading = Math.atan2(cy - gky, cx - gkx);`,
  ],
];

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== engineURL) return result;
    // ⚠ `js/sim/engine.js` 在磁盘上是 CRLF；多行标记必须先把行尾规范成 LF 才能匹配。
    // 这只发生在内存里（候选本来就只在内存中生效），不影响磁盘文件。
    // 因此下面记录的 `loadedEngineSha256` 是 **LF 规范版**的哈希，与磁盘 blob 不同。
    let source = String(result.source).replace(/\r\n/g, "\n");
    for (const [marker, replacement] of PATCHES) {
      assert.equal(source.split(marker).length, 2, `marker must be unique: ${marker.slice(0, 60)}`);
      source = source.replace(marker, replacement);
    }
    loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
    return { ...result, source };
  },
});

reportCandidateOnExit(() => ({ gkSameInstantContactCandidate: { loadedEngineSha256 } }));
