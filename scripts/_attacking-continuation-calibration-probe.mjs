// Process-local experiments. Production decisions and all random draws run first.
// Usage: node scripts/_attacking-continuation-calibration-probe.mjs value|runs|paired|finish|relay 12
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

const variant = process.argv[2] || "paired";
assert.ok(["control", "value", "runs", "paired", "finish", "relay"].includes(variant), `Unknown variant: ${variant}`);
const count = process.argv[3] || "12";
const audit = process.argv[4] || "movement";
const profile = process.argv[5];
const finishNewChance = variant === "finish";
const relayRuns = variant === "relay";
const scorePasses = variant === "value" || variant === "paired" || finishNewChance;
const timedRuns = variant === "runs" || variant === "paired" || finishNewChance || relayRuns;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const opponent = (team) => team === "home" ? "away" : "home";
const inBox = (engine, a) => engine._inOwnFoulBox(opponent(a.team), a.x, a.y);
const distance = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);

function shotPosition(engine, a) {
  const opportunity = engine._goalOpportunity(a);
  const range = clamp(1 - opportunity.dGoal / 30, 0, 1);
  return (range * 0.5 + opportunity.angle * 0.35) * (1 - engine._pressureOn(a) * 0.5);
}

const passCandidates = SimEngine.prototype._passCandidates;
SimEngine.prototype._passCandidates = function (a) {
  const candidates = passCandidates.call(this, a);
  if (!scorePasses || !inBox(this, a) || this.ball.restartType) return candidates;
  const currentQuality = shotPosition(this, a);
  const pressure = this._pressureOn(a);
  for (const candidate of candidates) {
    const m = candidate.agent;
    if (candidate.backpass || !m || m.role === "GK") continue;
    const target = { ...m, x: candidate.tx, y: candidate.ty };
    const qualityGain = shotPosition(this, target) - currentQuality;
    const pressureRelief = pressure - this._pressureOn(target);
    // Keep the original lane, distance, return-pass and offside factors. In the
    // box, forward distance alone is not the benefit of a pass to a marked player.
    const oldAdvance = clamp((Math.abs(a.y - this.targetGoalY(a.team)) -
      Math.abs(m.y - this.targetGoalY(a.team))) / 40, -0.5, 1);
    const oldBenefit = 0.35 + oldAdvance;
    const benefit = clamp(0.35 + qualityGain + Math.max(0, pressureRelief) * 0.5, 0.05, 0.9);
    if (oldBenefit > 0) candidate.value *= benefit / oldBenefit;
  }
  return candidates.sort((a, b) => b.value - a.value);
};

const pass = SimEngine.prototype._pass;
SimEngine.prototype._pass = function (a, target, prepared) {
  const wasOwner = this.ball.owner === a.id;
  const fromBox = inBox(this, a);
  const restart = this.ball.restartType;
  const originQuality = finishNewChance && wasOwner ? shotPosition(this, a) : 0;
  const result = pass.call(this, a, target, prepared);
  if (finishNewChance && wasOwner && this.ball.state === "pass" && !this.ball.owner &&
      this.ball.lastKicker === a.id && !restart) {
    this._probeNewChance = { team: a.team, at: this.ball.lastPassAt, toId: target.agent?.id,
      expectedAt: this.ball.expectedAt, originQuality };
  }
  if (!timedRuns || !wasOwner || this.ball.owner || this.ball.lastKicker !== a.id ||
      this.ball.state !== "pass" || restart) return result;
  if (relayRuns) {
    const b = this.ball;
    const receiver = target.agent;
    const dir = this.attackDir(a.team);
    const goalY = this.targetGoalY(a.team);
    if (!receiver || receiver.role === "GK" || Math.abs(target.ty - goalY) > 32 ||
        (target.ty - a.y) * dir < 3 || target.cross) return result;
    this._probeRuns ??= new Map();
    for (const [id, run] of this._probeRuns) {
      if (run.until <= this.t) this._probeRuns.delete(id);
    }
    if (this._probeRuns.size) return result;
    const options = this.agents.filter((runner) => runner.team === a.team && runner.role === "ATT" &&
      runner.id !== a.id && runner.id !== receiver.id && !runner.sentOff && !runner.injuredOff &&
      !b.offsideIds?.has(runner.id) && !inBox(this, runner)).map((runner) => {
        const spot = {
          x: clamp(target.tx + (runner.x < target.tx ? -1 : 1) * 6 / 0.68, 12, 88),
          y: clamp(target.ty + dir * 5 / 1.05, 3, 97),
        };
        const gap = distance(runner, spot);
        return { runner, spot, gap };
      }).filter((option) => option.gap >= 4 && option.gap <= 18)
      .sort((m, n) => m.gap - n.gap || String(m.runner.id).localeCompare(String(n.runner.id)));
    const choice = options[0];
    if (choice) {
      const speed = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * choice.runner.attr.pace) *
        (0.76 + (choice.runner.fitness ?? 100) / 100 * 0.24);
      const time = Math.min(4.5, choice.gap / (speed * 0.85) + 0.6);
      this._probeRuns.set(choice.runner.id, { ...choice.spot, until: this.t + time,
        kickAt: b.lastPassAt, team: a.team, relay: true });
    }
    return result;
  }
  this._probeRuns = new Map();
  const b = this.ball;
  const dir = this.attackDir(a.team);
  const goalY = this.targetGoalY(a.team);
  const until = b.expectedAt + 0.6;
  // After laying the ball off, offer an outside return lane instead of leaving
  // the passer's old dribble target at the goal line active.
  if (fromBox && !target.cross && target.agent && inBox(this, target.agent) &&
      (target.ty - a.y) * dir < 3) {
    this._probeRuns.set(a.id, {
      x: clamp(a.x + (a.x < target.tx ? -1 : 1) * 4 / 0.68, 12, 88),
      y: clamp(goalY - dir * 18 / 1.05, 3, 97),
      until: Math.max(until, this.t + 2), kickAt: b.lastPassAt,
    });
  }
  if (Math.abs(target.ty - goalY) > 32 || (target.ty - a.y) * dir < 3) return result;
  const runners = this.agents.filter((m) => m.team === a.team && m.role === "ATT" &&
    m.id !== a.id && m.id !== target.agent?.id && !m.sentOff && !m.injuredOff &&
    !b.offsideIds?.has(m.id) && !inBox(this, m) && distance(m, { x: target.tx, y: target.ty }) < 25);
  runners.sort((m, n) => Math.abs(n.x - target.tx) - Math.abs(m.x - target.tx));
  const runner = runners[0];
  if (runner) {
    const desired = {
      x: clamp(50 + (runner.x < target.tx ? -1 : 1) * 7 / 0.68, 12, 88),
      y: clamp(target.ty + dir * 6 / 1.05, 3, 97),
    };
    const reach = Math.min(1, (until - this.t) * 5 / Math.max(0.1, distance(runner, desired)));
    this._probeRuns.set(runner.id, {
      x: runner.x + (desired.x - runner.x) * reach,
      y: runner.y + (desired.y - runner.y) * reach,
      until, kickAt: b.lastPassAt,
    });
  }
  return result;
};

const decide = SimEngine.prototype._decideOnBall;
SimEngine.prototype._decideOnBall = function (a) {
  const chance = this._probeNewChance;
  if (!finishNewChance || !chance || chance.toId !== a.id || this.ball.lastPassAt !== chance.at ||
      this.t > chance.expectedAt + 2 || !inBox(this, a) || this._pressureOn(a) >= 0.75 ||
      shotPosition(this, a) <= chance.originQuality) return decide.call(this, a);
  const opportunity = this._goalOpportunity(a);
  const toGoal = Math.atan2(this.targetGoalY(a.team) - a.y, 50 - a.x);
  if (opportunity.dGoal >= 18 || opportunity.angle < 0.45 ||
      Math.cos((a.heading || 0) - toGoal) < 0.5) return decide.call(this, a);
  const until = this._teamShotUntil[a.team];
  this._teamShotUntil[a.team] = 0;
  try {
    return decide.call(this, a);
  } finally {
    if (this._teamShotUntil[a.team] === 0) this._teamShotUntil[a.team] = until;
  }
};

const think = SimEngine.prototype._think;
SimEngine.prototype._think = function (a, ...args) {
  const result = think.call(this, a, ...args);
  const run = this._probeRuns?.get(a.id);
  if (!run) return result;
  const owner = this.ball.owner ? this.agentById(this.ball.owner) : null;
  if (a.sentOff || a.injuredOff || owner?.id === a.id || (owner && owner.team !== a.team) ||
      this.t > run.until || (!run.relay && this.ball.lastPassAt !== run.kickAt) || this.ball.restartType ||
      (run.relay && this.ball.lastPassAt !== run.kickAt && this.ball.offsideIds?.has(a.id)) ||
      (!owner && this.ball.state !== "pass") || distance(a, run) < 0.8) {
    this._probeRuns.delete(a.id);
    return result;
  }
  if (run.relay && !owner && this.ball.receiverId === a.id) return result;
  a.tx = run.x;
  a.ty = run.y;
  a.fsm = "support";
  a.offBallTarget = null;
  return result;
};

console.log(`Attacking continuation variant: ${variant}`);
process.argv[2] = count;
process.argv[3] = audit === "movement" ? "control" : profile;
const audits = {
  movement: "./_final-third-movement-calibration-probe.mjs",
  realism: "./match-realism-audit.mjs",
  box: "./box-possession-sampling-audit.mjs",
  defending: "./box-defending-audit.mjs",
  offside: "./offside-event-integrity-audit.mjs",
};
if (!audits[audit]) throw new Error(`Unknown audit: ${audit}`);
await import(audits[audit]);
