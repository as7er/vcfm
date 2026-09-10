// Keep tactical depth and find the shortest available check on either side.
// Refine the existing 2/4/6 m search brackets instead of overshooting a gap.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
function applySupportOffer(a, owner, previous) {
  const b = this.ball;
  if (!owner || owner.team !== a.team || a.id === b.owner || a.sentOff || a.injuredOff ||
      (a.role !== "ATT" && a.role !== "MID") || b.restartType || this.t < (this.deadBallUntil || 0) ||
      !["held", "control", "pass"].includes(b.state) ||
      ["third-man-run", "cutback-outlet", "one-two"].includes(a.offBallTarget?.kind)) return;
  const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
  const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
  const gap = (p, q) => pitchDistanceBetween(p.x, p.y, q.x, q.y);
  const anchor = { x: a.tx, y: a.ty };
  if (Math.abs(b.y - this.targetGoalY(a.team)) * my >= 38) return;
  let offer = previous?.attackSince === this._teamAttackSince[a.team] &&
    gap(previous, anchor) <= 6 && gap(b, previous.origin) <= 6 &&
    !this._isOffsidePosition(a.team, { x: previous.x, y: anchor.y })
      ? { ...previous, y: anchor.y } : null;
  if (offer && b.owner && b.owner !== offer.ownerId) {
    const receivingSpace = !this.agents.some((o) => o.team !== a.team && o.role !== "GK" &&
      !o.sentOff && !o.injuredOff && gap(o, offer) < 2);
    if (!receivingSpace || this._laneSafety(owner, a, offer.x, offer.y) < 1.8 / 8 ||
        !this._launchRouteClear(owner, { agent: a, tx: offer.x, ty: offer.y })) {
      offer = null;
    } else {
      offer = { ...offer, ownerId: b.owner };
    }
  }
  const target = offer || anchor;
  const settled = Math.hypot(a.vx * mx, a.vy * my) < 1 && gap(a, target) <= 1.5;
  if (b.owner === owner.id && b.state === "held" && settled && gap(b, target) >= 6 && gap(b, target) < 20 &&
      this._laneSafety(owner, a, target.x, target.y) <= 1.1 / 8) {
    let choice = null;
    const preferredSide = a.baseX < 49 ? -1 : a.baseX > 51 ? 1 : (a.num || 0) % 2 ? -1 : 1;
    const available = (x) => {
      const y = anchor.y;
      const spot = { x, y };
      if (x < 3 || x > 97 || y < 3 || y > 97 || gap(spot, anchor) > 6 + 1e-7 ||
          gap(b, spot) >= 20 || this._isOffsidePosition(a.team, spot)) return false;
      const other = a.team === "home" ? "away" : "home";
      if (a.role === "MID" && !this._isPrimaryMidRunner(a) && this._inOwnFoulBox(other, x, y)) return false;
      if (this._laneSafety(owner, a, x, y) < 1.8 / 8 ||
          !this._launchRouteClear(owner, { agent: a, tx: x, ty: y })) return false;
      return !this.agents.some((m) => m.id !== a.id && !m.sentOff && !m.injuredOff &&
        (m.team === a.team ? gap(spot, { x: m.tx, y: m.ty }) < OFF_BALL_TARGET_DEFAULTS.supportSpacingMetres
          : m.role !== "GK" && gap(spot, m) < 2));
    };
    for (const side of [preferredSide, -preferredSide]) {
      let lower = 0;
      for (const offset of [2, 4, 6]) {
        if (!available(target.x + offset * side / mx)) { lower = offset; continue; }
        let upper = offset;
        for (let step = 0; step < 10; step++) {
          const middle = (lower + upper) / 2;
          if (available(target.x + middle * side / mx)) upper = middle;
          else lower = middle;
        }
        const spot = { x: target.x + upper * side / mx, y: anchor.y };
        if (!choice || gap(a, spot) < gap(a, choice) - 1e-7) choice = spot;
        break;
      }
    }
    if (choice) offer = { ...choice, at: this.t, ownerId: b.owner, attackSince: this._teamAttackSince[a.team],
      origin: { x: b.x, y: b.y } };
  }
  if (!offer) return;
  a.tx = offer.x;
  a.ty = offer.y;
  a.fsm = "support";
  a.offBallTargetKind = "support-offer";
  a.offBallTarget = { ...a.offBallTarget, x: a.tx, y: a.ty, fsm: a.fsm, kind: "support-offer", offer };
}

registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  assert.ok(String(result.source).includes("_startPassSupport(a, option)"), "candidate requires the v252 passing baseline");
  const source = `${result.source}
SimEngine.prototype._applySupportOffer = ${applySupportOffer.toString()};
const supportOfferCommit = SimEngine.prototype._commitOffBallTarget;
SimEngine.prototype._commitOffBallTarget = function(a, owner) {
  const target = a.offBallTarget;
  const previous = target?.offer ? { ...target.offer, x: target.x, y: target.y } : null;
  const result = supportOfferCommit.call(this, a, owner);
  this._applySupportOffer(a, owner, previous);
  return result;
};
`;
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ supportOfferMinimalCandidate: { loadedEngineSha256 } })));
