// Isolated pass-route experiment. No production feature flags or score changes.
// Usage and rejected-candidate evidence: docs/match-pass-routes-2026-09-08.md
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const variant = process.argv[2] || "route";
const count = process.argv[3] || "6";
const audit = process.argv[4] || "lanes";
const profile = process.argv[5] || "standard";
assert.ok(["control", "route", "contact", "flight", "flight_contact", "finish", "space", "space_timed", "cutback", "cutback_phase"].includes(variant));
const space = variant.startsWith("space");
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
const reports = [];
let evidenceFile = null;
const log = console.log.bind(console);
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].trimStart().startsWith("{")) {
    let report;
    try { report = JSON.parse(args[0]); } catch {}
    if (report) {
      reports.push(report);
      if (evidenceFile) writeFileSync(evidenceFile, JSON.stringify({ ...evidence, reports }, null, 2));
    }
  }
  log(...args);
};
const evidence = {
  variant, count: Number(count), audit, profile, node: process.version,
  startedAt: new Date().toISOString(),
  engineSha256: createHash("sha256").update(readFileSync(new URL(engineURL))).digest("hex"),
  candidateSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
};
process.on("uncaughtExceptionMonitor", (error) => { evidence.error = error.message; });
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL || variant === "control") return result;
  let source = String(result.source).replace(/\r\n/g, "\n");
  function replace(anchor, replacement) {
    assert.equal(source.split(anchor).length, 2, `unique engine anchor: ${anchor}`);
    source = source.replace(anchor, replacement);
  }
  if (variant.startsWith("cutback")) {
    replace('      const safety = this._laneSafety(a, m);\n      const value =\n        (0.28 + central',
      '      const tx = clamp(m.x + (50 - m.x) * 0.18, 18, 82);\n' +
      '      const ty = clamp(m.y - dir * 1.5, 6, 94);\n' +
      '      const safety = this._laneSafety(a, m, tx, ty);\n      const value =\n        (0.28 + central');
    replace('      const tx = clamp(m.x + (50 - m.x) * 0.18, 18, 82);\n' +
      '      const ty = clamp(m.y - dir * 1.5, 6, 94);\n      if (!best || value > best.value)',
      '      if (!best || value > best.value)');
    if (variant === "cutback_phase") {
      for (const [anchor, addition] of [
        ["const controlTeam = owner?.team || flightControl;",
          'if (owner) this._cornerAttackUntil[owner.team === "home" ? "away" : "home"] = 0;'],
        ["_restart(type, restartTeam, x, y) {", "this._cornerAttackUntil = { home: 0, away: 0 };"],
        ["_kickoff(team) {", "this._cornerAttackUntil = { home: 0, away: 0 };"],
        ["_penaltyKick(team) {", "this._cornerAttackUntil = { home: 0, away: 0 };"],
      ]) replace(anchor, `${anchor}\n    ${addition}`);
    }
    return { ...result, source };
  }
  if (variant.endsWith("contact") || variant === "finish" || space) {
    replace('if (oppBlocked && a.team !== b.kickTeam) continue;',
      'if (oppBlocked && a.team !== b.kickTeam && ((b.z || 0) > 1.1 || pitchDistanceBetween(a.x, a.y, b.x, b.y) > 1.1)) continue;');
  }
  // The old clamped projection charges an opponent behind the ball against
  // every escape lane. Use the actual launch point and the forward segment.
  replace('    const dx = tx - a.x;\n    const dy = ty - a.y;\n    const len = Math.hypot(dx, dy) || 1;',
    '    const originX = this.ball.owner === a.id ? this.ball.x : a.x;\n' +
    '    const originY = this.ball.owner === a.id ? this.ball.y : a.y;\n' +
    '    const dx = tx - originX;\n    const dy = ty - originY;\n    const len = Math.hypot(dx, dy) || 1;');
  replace('      if (o.team === a.team || o.role === "GK") continue;\n      // 投影到传球线段',
    '      if (o.team === a.team || o.role === "GK" || o.sentOff || o.injuredOff) continue;\n      // 投影到传球线段');
  replace('      const t = clamp(((o.x - a.x) * ux + (o.y - a.y) * uy) / len, 0, 1);\n' +
    '      const px = a.x + ux * len * t;\n      const py = a.y + uy * len * t;',
    '      const t = ((o.x - originX) * ux + (o.y - originY) * uy) / len;\n' +
    '      if (t < 0 || t > 1) continue;\n' +
    '      const px = originX + ux * len * t;\n      const py = originY + uy * len * t;');
  // Cutbacks use a shifted destination, not the receiver's current location.
  replace('      const safety = this._laneSafety(a, m);\n      const value =\n        (0.28 + central',
    '      const tx = clamp(m.x + (50 - m.x) * 0.18, 18, 82);\n' +
    '      const ty = clamp(m.y - dir * 1.5, 6, 94);\n' +
    '      if (!this._probeLaunchRouteClear(a, { tx, ty })) continue;\n' +
    '      const safety = this._laneSafety(a, m, tx, ty);\n      const value =\n        (0.28 + central');
  replace('      const tx = clamp(m.x + (50 - m.x) * 0.18, 18, 82);\n' +
    '      const ty = clamp(m.y - dir * 1.5, 6, 94);\n      if (!best || value > best.value)',
    '      if (!best || value > best.value)');
  if (variant === "finish") {
    replace('      const cdBlocked = this.t < (this._teamShotUntil[a.team] || 0);',
      '      const cdBlocked = this.t < (this._teamShotUntil[a.team] || 0) && !this._probeHasCloseShot(a);');
  }
  source += '\nexport { estimateBallArrivalSeconds as probeArrival, estimateBallHeightAtDistance as probeHeight };\n';
  return { ...result, source };
} });

const { SimEngine, SIM, probeArrival, probeHeight } = await import(engineURL);
const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const measures = { examined: 0, blocked: 0, preparedCancelled: 0 };
const shots = { clearDecisions: 0, cooldownDecisions: 0, outcomes: {} };

SimEngine.prototype._probeHasCloseShot = function (a) {
  const b = this.ball;
  if (b.owner !== a.id || b.restartType || b.state !== "held") return false;
  const other = a.team === "home" ? "away" : "home";
  if (!this._inOwnFoulBox(other, b.x, b.y)) return false;
  const opportunity = this._goalOpportunity(a);
  const dx = (opportunity.targetX - b.x) * mx;
  const dy = (this.targetGoalY(a.team) - b.y) * my;
  const length = Math.hypot(dx, dy);
  if (length > 16.5 || opportunity.angle < 0.45 || length < 0.1) return false;
  const hx = Math.cos(a.heading || 0) * mx;
  const hy = Math.sin(a.heading || 0) * my;
  if ((hx * dx + hy * dy) / (Math.hypot(hx, hy) * length) < 0.5) return false;
  for (const o of this.agents) {
    if (o.team === a.team || o.role === "GK" || o.sentOff || o.injuredOff) continue;
    const px = (o.x - b.x) * mx;
    const py = (o.y - b.y) * my;
    const along = (px * dx + py * dy) / length;
    if (along <= 0 || along >= length) continue;
    if (Math.abs(px * dy - py * dx) / length < 1.1) return false;
  }
  return true;
};
const decide = SimEngine.prototype._decideOnBall;
SimEngine.prototype._decideOnBall = function (a) {
  const clear = this._probeHasCloseShot(a);
  if (clear) {
    shots.clearDecisions++;
    if (this.t < (this._teamShotUntil[a.team] || 0)) shots.cooldownDecisions++;
  }
  const result = decide.call(this, a);
  if (clear) {
    const outcome = a.pendingBallAction?.action ||
      (!this.ball.owner ? this.ball.state : a.intent?.type || "other");
    shots.outcomes[outcome] = (shots.outcomes[outcome] || 0) + 1;
  }
  return result;
};

SimEngine.prototype._probeLaunchRouteClear = function (a, option) {
  if (this.ball.owner !== a.id) return true;
  const b = this.ball;
  const dx = (option.tx - b.x) * mx;
  const dy = (option.ty - b.y) * my;
  const distance = Math.hypot(dx, dy);
  // The first experiment isolated ground passes. The flight variant also
  // examines the low launch segment of longer ordinary passes, using the
  // production flight integrator rather than treating all loft as immunity.
  const flight = variant.startsWith("flight") || variant === "finish" || space;
  if (option.cross || option.through || (!flight && distance >= 20) || distance < 0.1) return true;
  measures.examined++;
  const speed = clamp(10.5 + distance * 0.38, 11.5, 27) *
    (0.94 + 0.06 * (a.attr.passing || 0.55));
  const loft = distance >= 30 - 1e-6 ? 9 + (distance - 30) * 0.1 :
    distance >= 20 - 1e-6 ? 4.75 : 0;
  for (const o of this.agents) {
    if (o.team === a.team || o.sentOff || o.injuredOff || o.role === "GK") continue;
    const px = (o.x - b.x) * mx;
    const py = (o.y - b.y) * my;
    const along = (px * dx + py * dy) / distance;
    if (along < 0 || along > Math.min(8, distance)) continue;
    // The launch interval is short enough to use observed defender velocity.
    // Ground friction uses the same per-0.1-second attenuation as the engine.
    const decay = -Math.log(SIM.BALL_FRICTION) / SIM.DT;
    const t = flight ? probeArrival(along, speed, loft ? 0.2 : 0, loft) :
      -Math.log(Math.max(0.01, 1 - along * decay / speed)) / decay;
    const ox = px + (o.vx || 0) * mx * t;
    const oy = py + (o.vy || 0) * my * t;
    const predictedAlong = (ox * dx + oy * dy) / distance;
    if (predictedAlong < 0 || predictedAlong > Math.min(8, distance)) continue;
    if (flight && loft && probeHeight(predictedAlong, speed, 0.2, loft) > 1.1) continue;
    const perpendicular = Math.abs(ox * dy - oy * dx) / distance;
    if (perpendicular <= 1.1) {
      measures.blocked++;
      return false;
    }
  }
  return true;
};

if (variant !== "control" && !variant.startsWith("cutback")) {
  const candidates = SimEngine.prototype._passCandidates;
  SimEngine.prototype._passCandidates = function (a) {
    return candidates.call(this, a).flatMap((option) => {
      if (this._probeLaunchRouteClear(a, option)) return [option];
      if (!space || !option.agent || option.backpass) return [];
      const receiver = option.agent;
      const dx = (option.tx - this.ball.x) * mx;
      const dy = (option.ty - this.ball.y) * my;
      const length = Math.hypot(dx, dy);
      if (length < 0.1) return [];
      const vx = -dy / length;
      const vy = dx / length;
      const options = [];
      for (const side of [-1, 1]) {
        for (const offset of [2, 4]) {
          const tx = clamp(option.tx + vx * offset * side / mx, 3, 97);
          const ty = clamp(option.ty + vy * offset * side / my, 3, 97);
          const distance = Math.hypot((tx - this.ball.x) * mx, (ty - this.ball.y) * my);
          const speed = clamp(10.5 + distance * 0.38, 11.5, 27) * (0.94 + 0.06 * a.attr.passing);
          const loft = distance >= 30 ? 9 + (distance - 30) * 0.1 : distance >= 20 ? 4.75 : 0;
          const eta = probeArrival(distance, speed, loft ? 0.2 : 0, loft);
          const rx = tx - receiver.x;
          const ry = ty - receiver.y;
          const runnerGap = Math.hypot(rx, ry);
          const runnerSpeed = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * receiver.attr.pace) *
            (0.76 + Math.max(0.3, (receiver.fitness ?? 100) / 100) * 0.24);
          const accel = runnerSpeed * (2.5 + 2.5 * receiver.attr.accel) *
            (0.94 + (receiver.attr.agility || 0.55) * 0.08);
          const along = runnerGap ? Math.max(0, (receiver.vx * rx + receiver.vy * ry) / runnerGap) : 0;
          const accelerateFor = Math.min(eta, Math.max(0, runnerSpeed - along) / accel);
          const reachable = along * accelerateFor + 0.5 * accel * accelerateFor ** 2 +
            runnerSpeed * (eta - accelerateFor);
          if (runnerGap > reachable || !this._probeLaunchRouteClear(a, { ...option, tx, ty })) continue;
          const originalSafety = this._laneSafety(a, receiver, option.tx, option.ty);
          const safety = this._laneSafety(a, receiver, tx, ty);
          options.push({ ...option, tx, ty, value: option.value * safety / Math.max(0.1, originalSafety),
            probeSpace: true, detour: offset });
        }
      }
      options.sort((left, right) => left.detour - right.detour || right.value - left.value);
      return options.length ? [options[0]] : [];
    }).sort((left, right) => right.value - left.value);
  };
  const pass = SimEngine.prototype._pass;
  SimEngine.prototype._pass = function (a, target, prepared) {
    if (prepared && !this._probeLaunchRouteClear(a, target)) {
      measures.preparedCancelled++;
      a.pendingBallAction = null;
      a.intent = { type: "hold", tx: a.x, ty: a.y };
      a.fsm = "carry";
      a.decisionUntil = this.t + 0.2;
      return;
    }
    const result = pass.call(this, a, target, prepared);
    if (this.ball.state === "pass" && this.ball.lastKicker === a.id && target.probeSpace) {
      this._probeSpaceFlight = { at: this.ball.lastPassAt, receiverId: this.ball.receiverId };
    }
    return result;
  };
}

if (variant === "space_timed") {
  const integrate = SimEngine.prototype._integrate;
  SimEngine.prototype._integrate = function (a, dt) {
    const flight = this._probeSpaceFlight;
    const b = this.ball;
    if (!flight || flight.receiverId !== a.id || flight.at !== b.lastPassAt ||
        b.state !== "pass" || b.owner || a.sentOff || a.injuredOff) return integrate.call(this, a, dt);
    const tx = a.tx;
    const ty = a.ty;
    const steps = Math.max(1, Math.ceil(dt / SIM.DT - 1e-9));
    const stepDt = dt / steps;
    for (let index = 0; index < steps; index++) {
      const dx = tx - a.x;
      const dy = ty - a.y;
      const gap = Math.hypot(dx, dy);
      if (gap > 0.05) {
        const speed = SIM.MAX_PLAYER_SPEED * (0.55 + 0.45 * a.attr.pace) *
          (0.76 + Math.max(0.3, (a.fitness ?? 100) / 100) * 0.24);
        const accel = speed * (2.5 + 2.5 * a.attr.accel) * (0.94 + (a.attr.agility || 0.55) * 0.08);
        const along = Math.max(0, (a.vx * dx + a.vy * dy) / gap);
        const time = Math.max(stepDt, b.expectedAt - this.t - index * stepDt -
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
}

console.log(`Pass-route candidate: ${variant}`);
process.argv[2] = count;
process.argv[3] = profile;
const audits = { lanes: "./_pass-lane-contact-probe.mjs", box: "./box-possession-sampling-audit.mjs",
  shots: "./_shot-chain-sample.mjs",
  realism: "./match-realism-audit.mjs", contact: "./_short-pass-contact-probe.mjs",
  fixture: "./_pass-route-fixture.mjs", cutback: "./_cutback-target-fixture.mjs",
  phase: "./_set-piece-phase-fixture.mjs" };
assert.ok(audits[audit], `unknown audit: ${audit}`);
process.on("exit", () => console.log(JSON.stringify({ launchRoutes: measures, closeShotDecisions: shots }, null, 2)));
process.on("exit", (exitCode) => {
  const directory = new URL("../.tmp-continuity/pass-routes/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  evidenceFile = new URL(`${variant}-${audit}-${count}-${profile}-${Date.now()}.json`, directory);
  evidence.completedAt = new Date().toISOString();
  evidence.exitCode = exitCode;
  writeFileSync(evidenceFile, JSON.stringify({ ...evidence, reports }, null, 2));
  log(`Structured evidence: ${evidenceFile.pathname}`);
});
await import(audits[audit]);
