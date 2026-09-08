import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";
import { buildCornerRoutine, cornerDelivery, cornerMovementTarget } from "../js/corner-routines.js";

const count = process.argv[2] || "12";
const audit = process.argv[3] || "corner";
const profile = process.argv[4];
const mode = process.argv[5] || "arrive";
assert.ok(["arrive", "timed", "timed_coarse", "duel", "phase"].includes(mode), `Unknown movement mode: ${mode}`);
const timing = mode !== "arrive";
const duel = mode === "duel";
const endOnTurnover = mode === "phase";
const integrated = typeof SimEngine.prototype._integrateMotion === "function";
assert.ok(!integrated || mode === "timed", "historical corner modes require --baseline-v250");
console.log(`Corner routine: mode=${mode}, audit=${audit}, matches=${count}, profile=${profile || "standard"}`);
const movement = [];
const metres = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);
const restart = SimEngine.prototype._restart;
SimEngine.prototype._restart = function (type, ...args) {
  const result = restart.call(this, type, ...args);
  if (integrated) return result;
  this._cornerRoutine = null;
  if (type !== "corner") return result;
  const ball = this.ball;
  this._cornerRoutine = buildCornerRoutine({ agents: this.agents, team: ball.kickTeam,
    takerId: ball.owner, ball, now: this.t, attackDirection: this.attackDir(ball.kickTeam),
    goalY: this.targetGoalY(ball.kickTeam) });
  for (const a of this.agents) {
    const spot = this._cornerRoutine.positions.get(a.id);
    if (!spot) continue;
    a.x = a.tx = spot.x;
    a.y = a.ty = spot.y;
    a.vx = a.vy = 0;
    a.offBallTarget = null;
  }
  return result;
};
const think = SimEngine.prototype._think;
SimEngine.prototype._think = function (a, ...args) {
  const result = think.call(this, a, ...args);
  if (integrated) return result;
  let target = cornerMovementTarget(this._cornerRoutine, a, this.ball, this.agents, this.t);
  const markedId = this._cornerRoutine?.marks.get(a.id);
  const markedRun = duel && target && this.ball.state === "pass" &&
    this._cornerRoutine.runs.get(markedId);
  if (markedRun) {
    target = { x: markedRun.x - this._cornerRoutine.side * 1.2 / 0.68,
      y: markedRun.y + this._cornerRoutine.attackDirection * 1.8 / 1.05 };
  }
  if (target) {
    a.tx = target.x;
    a.ty = target.y;
    a.offBallTarget = null;
  }
  a._probeArrivalAt = timing && target && this.ball.state === "pass" &&
    (this._cornerRoutine?.runs.has(a.id) || markedRun) ? this.ball.expectedAt : null;
  return result;
};
// A timed arrival uses the same speed and acceleration limits as ordinary
// movement. Compensate only for the ordinary five-unit stopping radius: an
// attacker meeting a cross must reach the contest while the ball is there.
const integrate = SimEngine.prototype._integrate;
SimEngine.prototype._integrate = function (a, dt) {
  if (integrated || !Number.isFinite(a._probeArrivalAt) || this.ball.owner || this.ball.state !== "pass") {
    return integrate.call(this, a, dt);
  }
  const tx = a.tx;
  const ty = a.ty;
  const steps = mode === "timed_coarse" ? 1 : Math.max(1, Math.ceil(dt / SIM.DT - 1e-9));
  const stepDt = dt / steps;
  for (let step = 0; step < steps; step++) {
    const dx = tx - a.x;
    const dy = ty - a.y;
    const gap = Math.hypot(dx, dy);
    if (gap > 0.05) {
      const speed = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * a.attr.pace) *
        (0.76 + Math.max(0.3, (a.fitness ?? 100) / 100) * 0.24);
      const accel = speed * (2.5 + 2.5 * a.attr.accel) * (0.94 + (a.attr.agility || 0.55) * 0.08);
      const along = Math.max(0, ((a.vx || 0) * dx + (a.vy || 0) * dy) / gap);
      const time = Math.max(stepDt, a._probeArrivalAt - this.t - step * stepDt -
        Math.max(0, speed - along) / (2 * accel));
      const lookAhead = Math.max(gap, Math.min(5, gap / time / speed * 5));
      a.tx = a.x + dx / gap * lookAhead;
      a.ty = a.y + dy / gap * lookAhead;
    } else {
      a.tx = tx;
      a.ty = ty;
    }
    integrate.call(this, a, stepDt);
  }
  a.tx = tx;
  a.ty = ty;
};
const pass = SimEngine.prototype._pass;
SimEngine.prototype._pass = function (a, ...args) {
  const fromCorner = this.ball.state === "corner" && this.ball.owner === a.id;
  const result = pass.call(this, a, ...args);
  if (fromCorner && this._cornerRoutine && this.ball.state === "pass" && this.ball.lastKicker === a.id) {
    this._cornerRoutine.releasedAt = this.ball.lastPassAt;
    this._probeCornerFlight = { routine: this._cornerRoutine,
      start: new Map([...this._cornerRoutine.runs.keys()].map((id) => {
        const runner = this.agentById(id);
        return [id, { x: runner.x, y: runner.y }];
      })), at: this.ball.lastPassAt };
  }
  return result;
};
const step = SimEngine.prototype.step;
SimEngine.prototype.step = function (...args) {
  const result = step.call(this, ...args);
  if (endOnTurnover && this.ball.owner) {
    const owner = this.agentById(this.ball.owner);
    if (owner) this._cornerAttackUntil[owner.team === "home" ? "away" : "home"] = 0;
  }
  const flight = this._probeCornerFlight;
  if (flight && (this.ball.owner || this.ball.state !== "pass" ||
      this.ball.lastPassAt !== flight.at || this.t > this.ball.expectedAt + 0.4)) {
    for (const [id, start] of flight.start) {
      const runner = this.agentById(id);
      if (runner) movement.push({ duration: this.t - flight.at, moved: metres(start, runner),
        gap: metres(runner, flight.routine.runs.get(id)) });
    }
    this._probeCornerFlight = null;
  }
  return result;
};
const cross = SimEngine.prototype._bestCross;
SimEngine.prototype._bestCross = function (a) {
  const result = cross.call(this, a);
  if (integrated) return result;
  return this.ball.state === "corner" && this.ball.owner === a.id
    ? cornerDelivery(this._cornerRoutine, this.agents, a) || result : result;
};
process.argv[2] = count;
process.argv[3] = audit === "corner" ? "control" : profile;
const audits = {
  corner: "./_corner-rework-calibration-probe.mjs",
  realism: "./match-realism-audit.mjs",
  structure: "./corner-structure-audit.mjs",
  defending: "./box-defending-audit.mjs",
  box: "./box-possession-sampling-audit.mjs",
  arrival: "./_corner-arrival-probe.mjs",
  trace: "./_corner-integration-sample.mjs",
};
if (!audits[audit]) throw new Error(`Unknown audit: ${audit}`);
const median = (key) => {
  const values = movement.map((m) => m[key]).sort((a, b) => a - b);
  return values.length ? Number(values[Math.floor(values.length / 2)].toFixed(2)) : null;
};
process.on("exit", () => console.log(JSON.stringify({ cornerFlightMovement: {
  samplesIncludingControlReplay: movement.length,
  durationMedian: median("duration"), distanceMedian: median("moved"), remainingMedian: median("gap"),
} }, null, 2)));
await import(audits[audit]);
