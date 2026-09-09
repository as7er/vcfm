// One onward run responds to an actual forward pass. A close byline reception
// instead asks a teammate to offer a cutback outside the crowded goalmouth.
import { registerHooks } from "node:module";

const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const key = Symbol.for("vcfm.third-man-run-candidate");
const stats = { starts: 0, forward: 0, cutback: 0, targets: 0 };
const plans = new WeakMap();
const sustain = process.argv.includes("--sustain-runs");
globalThis[key] = (SimEngine, SIM) => {
  const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
  const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const metres = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
  const pass = SimEngine.prototype._pass;
  SimEngine.prototype._pass = function (a, option, prepared) {
    const result = pass.call(this, a, option, prepared);
    const b = this.ball;
    if (b.state !== "pass" || b.lastKicker !== a.id || b.lastPassAt !== this.t ||
        !option.agent || option.cross || option.agent.role === "GK") return result;
    const existing = plans.get(this);
    const previousRunner = existing && this.agentById(existing.playerId);
    if (sustain && existing?.team === a.team && this.t <= existing.until &&
        existing.attackSince === this._teamAttackSince[a.team] &&
        previousRunner && !previousRunner.sentOff && !previousRunner.injuredOff &&
        previousRunner.id !== a.id && previousRunner.id !== option.agent.id &&
        metres(previousRunner, existing) > 0.8) return result;
    const dir = this.attackDir(a.team);
    const goalY = this.targetGoalY(a.team);
    const depth = Math.abs(b.targetY - goalY) * my;
    if (depth > 38 || (b.targetY - b.kickY) * dir < -4) return result;
    const line = this._offsideLineY(a.team);
    if (!Number.isFinite(line)) return result;
    const legalY = dir < 0 ? Math.min(line, b.targetY) : Math.max(line, b.targetY);
    const cutback = depth < 12;
    const receiver = option.agent;
    const candidates = this.agents.filter((m) => m.team === a.team && m.id !== a.id &&
      m.id !== receiver.id && !m.sentOff && !m.injuredOff &&
      (m.role === "ATT" || this._isPrimaryMidRunner(m)) &&
      !this._isOffsidePosition(m.team, m, line, b.y)).map((runner) => {
      const target = {
        x: clamp(runner.baseX * 0.8 + receiver.x * 0.2, 12, 88),
        y: cutback ? goalY - dir * 18 / my : legalY - dir * 1.8 / my,
      };
      const distance = metres(runner, target);
      const side = (runner.baseX - 50) * (receiver.x - 50) < 0 ? 0 : 3;
      return { runner, target, distance, rank: distance + side };
    }).filter((candidate) => candidate.distance >= 3 && candidate.distance <= 25)
      .sort((left, right) => left.rank - right.rank || String(left.runner.id).localeCompare(String(right.runner.id)));
    if (!candidates.length) return result;
    const selected = candidates[0];
    const runnerSpeed = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * selected.runner.attr.pace) *
      (0.76 + Math.max(0.3, (selected.runner.fitness ?? 100) / 100) * 0.24);
    const fieldDistance = Math.hypot(selected.target.x - selected.runner.x, selected.target.y - selected.runner.y);
    const travelSeconds = fieldDistance / runnerSpeed + 0.3;
    const plan = { team: a.team, playerId: selected.runner.id, receiverId: receiver.id,
      attackSince: this._teamAttackSince[a.team],
      until: sustain ? this.t + Math.max(b.expectedAt - this.t, travelSeconds) + 0.7 : b.expectedAt + 2.4,
      ...selected.target, cutback };
    plans.set(this, plan);
    selected.runner.attackThinkUntil = Math.min(selected.runner.attackThinkUntil || Infinity, this.t);
    stats.starts++;
    stats[cutback ? "cutback" : "forward"]++;
    return result;
  };
  const think = SimEngine.prototype._thinkAttackOffBall;
  SimEngine.prototype._thinkAttackOffBall = function (a, owner) {
    const result = think.call(this, a, owner);
    const plan = plans.get(this);
    if (plan && plan.playerId === a.id && plan.team === a.team && this.t <= plan.until &&
        plan.attackSince === this._teamAttackSince[a.team] &&
        owner?.team === a.team && this.ball.owner !== a.id && !this.ball.restartType) {
      a.tx = plan.x;
      a.ty = plan.y;
      a.fsm = "support";
      a.offBallTargetKind = plan.cutback ? "cutback-outlet" : "third-man-run";
      stats.targets++;
    }
    if (process.argv.includes("--mid-support") && a.role === "MID" && !this._isPrimaryMidRunner(a) &&
        Math.abs(this.ball.y - this.targetGoalY(a.team)) < 36) {
      const mids = this.agents.filter((m) => m.team === a.team && m.role === "MID" && !m.sentOff &&
        (!sustain || (!m.injuredOff && !this._isPrimaryMidRunner(m))))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      const rank = Math.max(0, mids.indexOf(a));
      const goalY = this.targetGoalY(a.team);
      const depth = Math.max(17 + rank * 6, Math.abs(this.ball.y - goalY) + 6 + rank * 5);
      a.ty = clamp(goalY - this.attackDir(a.team) * depth, 3, 97);
    }
    return result;
  };
  for (const method of ["_restart", "_kickoff", "_penaltyKick"]) {
    const restart = SimEngine.prototype[method];
    SimEngine.prototype[method] = function (...args) {
      plans.delete(this);
      return restart.apply(this, args);
    };
  }
};
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL) return result;
  return { ...result, source: `${result.source}\nglobalThis[Symbol.for("vcfm.third-man-run-candidate")](SimEngine, SIM);\n` };
} });
process.on("exit", () => console.log(JSON.stringify({ thirdManRuns: { sustain, ...stats } }, null, 2)));
