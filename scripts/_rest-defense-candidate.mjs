// Keep the defensive safety line connected to the attack, respecting the
// public line-height instruction and retaining at least 28 m behind the ball.
import "./_attacking-unit-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const anchor = "    this._applyPassSupport(a, owner);";
  assert.equal(source.split(anchor).length, 2);
  source = source.replace(anchor, anchor + `
    if (a.role === "DEF" && !this._isFullback(a) && !a.offBallTargetKind) {
      const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
      const goalY = this.targetGoalY(a.team);
      const ballDepth = Math.abs(this.ball.y - goalY) * my;
      const ownGoalY = this.targetGoalY(a.team === "home" ? "away" : "home");
      const progress = Math.abs(this.ball.y - ownGoalY) / SIM.FIELD_H;
      const connect = clamp((progress - 0.4) / 0.24, 0, 1);
      const lineDepth = SIM.PITCH_H_METRES / 2 - (this._tacticLevel(a.team, "defensiveLine") - 3) * 3.8 * my;
      const depth = Math.max(lineDepth, ballDepth + 28);
      const connectedY = goalY - this.attackDir(a.team) * depth / my;
      a.ty += (connectedY - a.ty) * connect;
      a.fsm = "home";
    }`);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
process.on("exit", () => console.log(JSON.stringify({ restDefenseCandidate: { loadedEngineSha256 } })));
