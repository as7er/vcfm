// Pass assessment uses the same nominal flight, reachable interception and
// control probability as the defender. No extra rating/shot/pass-speed weight.
import "./_defensive-pass-release-candidate.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { reportCandidateOnExit } from "./_candidate-exit-reports.mjs";
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
let loadedEngineSha256;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  let source = String(result.source);
  const resolveStart = source.indexOf("      let ctl;");
  const resolveEnd = source.indexOf("      if (this.random() < p)", resolveStart);
  assert.ok(resolveStart > 0 && resolveEnd > resolveStart);
  const probability = source.slice(resolveStart, resolveEnd).replaceAll("\r\n", "\n");
  assert.ok(probability.includes("const p = clamp(ctl - speedMps / speedScale, 0.15, 0.99);"));
  source = source.slice(0, resolveStart) +
    "      const p = this._ballControlProbability(best, b, intendedReceive);\n" + source.slice(resolveEnd);
  const controlMethod = `  _ballControlProbability(best, b, intendedReceive) {
    const wasPass = b.state === "pass";
    const speedMps = pitchSpeedMps(b.vx, b.vy);
${probability.replace(/^      /gm, "    ")}    return p;
  }

`;
  const methods = `  _passInterceptionRisk(a, option) {
    if (this.ball.owner !== a.id || option.cross || !option.agent || this.ball.restartType ||
        this.t < (this.deadBallUntil || 0)) return null;
    const b = this.ball;
    const dx = option.tx - b.x, dy = option.ty - b.y;
    const distance = pitchDistanceMetres(dx, dy);
    if (distance < 0.1) return null;
    const speed = passLaunchSpeedMps(distance, passTechnique(a));
    const velocity = pitchVelocityForMps(dx, dy, speed);
    const loft = passLaunchLoft(distance, speed, { isThrough: !!option.through, roll: 0.5 });
    const flight = { ...b, owner: null, state: "pass", vx: velocity.vx, vy: velocity.vy,
      z: loft > 0 ? 0.2 : 0, vz: loft, kickTeam: a.team, kickX: b.x, kickY: b.y,
      lastPassAt: this.t, receiverId: option.agent.id, targetX: option.tx, targetY: option.ty,
      isCrossPass: false, isThroughPass: !!option.through, restartType: null,
      expectedAt: this.t + clamp(estimateBallArrivalSeconds(distance, speed, loft ? 0.2 : 0, loft), 0.2, 3.4) };
    // A private view lets the existing controllers read the hypothetical pass
    // without replacing the live ball, players, plans or random generator.
    const view = Object.create(this);
    view.ball = { ...flight };
    view.t = this.t;
    const advanceFlight = (duration) => {
      for (let remaining = duration; remaining > 1e-9;) {
        const step = Math.min(SIM.DT, remaining);
        view.ball.x += view.ball.vx * step;
        view.ball.y += view.ball.vy * step;
        applyFreeBallForces(view.ball, step);
        remaining -= step;
      }
    };
    const receiver = { ...option.agent, tx: option.tx, ty: option.ty, fsm: "receive", _cornerArrivalAt: null };
    let receiverAt = Infinity, receiverGap = Infinity;
    while (view.t + SIM.DT <= flight.expectedAt + 1e-8) {
      view._integrate(receiver, SIM.DT);
      advanceFlight(SIM.DT);
      view.t += SIM.DT;
      const radius = SIM.CONTROL_RADIUS_METRES + pitchSpeedMps(view.ball.vx, view.ball.vy) * 0.04;
      const gap = pitchDistanceBetween(receiver.x, receiver.y, view.ball.x, view.ball.y);
      if (view.ball.z <= (receiver.role === "GK" ? 3 : 2.2) && gap < radius) {
        receiverAt = view.t;
        receiverGap = gap;
        break;
      }
    }
    view.t = this.t;
    view.ball = { ...flight, expectedAt: Math.min(flight.expectedAt, receiverAt) };
    const candidates = [];
    for (const defender of this.agents) {
      if (defender.team === a.team || defender.role === "GK" || defender.sentOff || defender.injuredOff) continue;
      const point = view._defensivePassArrival(defender);
      if (!point) continue;
      const projected = { ...defender, tx: point.x, ty: point.y, fsm: "press", _cornerArrivalAt: null, _passIntercept: point };
      view._integrate(projected, point.at - this.t);
      const gap = pitchDistanceBetween(projected.x, projected.y, point.x, point.y);
      if (point.at >= receiverAt - 1e-8 && gap >= receiverGap) continue;
      candidates.push({ defender, point, gap });
    }
    candidates.sort((left, right) => left.point.at - right.point.at ||
      pitchDistanceBetween(left.defender.x, left.defender.y, left.point.x, left.point.y) -
        pitchDistanceBetween(right.defender.x, right.defender.y, right.point.x, right.point.y) ||
      String(left.defender.id).localeCompare(String(right.defender.id)));
    if (!candidates.length) return null;
    const first = candidates[0];
    view.ball = { ...flight };
    advanceFlight(first.point.at - this.t);
    return { defenderId: first.defender.id, point: first.point, receiverAt: Number.isFinite(receiverAt) ? receiverAt : null,
      probability: this._ballControlProbability(first.defender, view.ball, false) };
  }

  _passCandidates(a) {
    return this._unratedPassCandidates(a).map((option) => {
      const interceptionRisk = this._passInterceptionRisk(a, option);
      return interceptionRisk ? { ...option, interceptionRisk, value: option.value * (1 - interceptionRisk.probability) } : option;
    }).sort((left, right) => right.value - left.value);
  }

`;
  const passCandidates = "  _passCandidates(a) {";
  assert.equal(source.split(passCandidates).length, 2);
  source = source.replace(passCandidates, controlMethod + methods + "  _unratedPassCandidates(a) {");
  const cutStart = source.indexOf("  _bestCutback(a) {");
  const cutEnd = source.indexOf("  _forwardDribbleIntent(a) {", cutStart);
  assert.ok(cutStart > 0 && cutEnd > cutStart);
  let cut = source.slice(cutStart, cutEnd);
  cut = cut.replace("      const value =", "      let value =");
  const choose = "      if (!best || value > best.value) {";
  assert.equal(cut.split(choose).length, 2);
  cut = cut.replace(choose, `      const interceptionRisk = this._passInterceptionRisk(a, { agent: m, tx, ty, cutback: true });
      if (interceptionRisk) value *= 1 - interceptionRisk.probability;
` + choose);
  source = source.slice(0, cutStart) + cut + source.slice(cutEnd);
  loadedEngineSha256 = createHash("sha256").update(source).digest("hex");
  return { ...result, source };
} });
reportCandidateOnExit(() => ({ passInterceptionRiskCandidate: { loadedEngineSha256 } }));
