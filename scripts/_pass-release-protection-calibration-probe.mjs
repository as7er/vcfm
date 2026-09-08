// Process-local source substitution: no production flag and no changed random
// draws until an otherwise immune pass actually reaches a defending player.
// Requires Node 22.15+ for registerHooks (production does not use these hooks).
// Usage: node scripts/_pass-release-protection-calibration-probe.mjs control|release|contact 6 box
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const variant = process.argv[2] || "control";
const count = process.argv[3] || "6";
const audit = process.argv[4] || "box";
const profile = process.argv[5] || "standard";
assert.ok(["control", "release", "contact", "contact_space", "contact_chance", "lead", "contact_lead"].includes(variant));
const engineURL = new URL("../js/sim/engine.js", import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url !== engineURL || variant === "control") return result;
  let source = String(result.source);
  if (variant.startsWith("contact")) {
    const anchor = 'if (oppBlocked && a.team !== b.kickTeam) continue;';
    assert.equal(source.split(anchor).length, 2, "the early-pass opponent exclusion must be unique");
    source = source.replace(anchor,
      'if (oppBlocked && a.team !== b.kickTeam && ((b.z || 0) > 1.1 || pitchDistanceBetween(a.x, a.y, b.x, b.y) > 1.1)) continue;');
  }
  if (variant === "release") {
    const anchor = 'const oppBlocked = b.state === "pass" && flownFromKick < 8;';
    assert.equal(source.split(anchor).length, 2, "the production pass protection gate must be unique");
    source = source.replace(anchor,
      'const oppBlocked = b.state === "pass" && flownFromKick < SIM.CONTROL_RADIUS_METRES;');
  }
  if (variant === "lead" || variant === "contact_lead") {
    const anchor = /const nominalSpeed = clamp\(18 \+ d \* 0\.7,[\s\S]*?let ty = clamp\(m\.y \+ \(m\.vy \|\| 0\) \* eta, 3, 97\);/g;
    assert.equal([...source.matchAll(anchor)].length, 1, "the old receiver lead estimate must be unique");
    // Solve for the moving destination using the actual flight integrator. Loft
    // uses the ordinary pass's expected draw; this predictor consumes no RNG.
    source = source.replace(anchor, `let tx = m.x;
      let ty = m.y;
      let eta = 0;
      for (let iteration = 0; iteration < 4; iteration++) {
        const distanceM = pitchDistanceBetween(this.ball.x, this.ball.y, tx, ty);
        const nominalSpeed = clamp(10.5 + distanceM * 0.38, 11.5, 27) * (0.94 + 0.06 * (a.attr.passing || 0.55));
        const loft = distanceM >= 30 - 1e-6 ? 9 + (distanceM - 30) * 0.1 : distanceM >= 20 - 1e-6 ? 4.75 : 0;
        const nextEta = clamp(estimateBallArrivalSeconds(distanceM, nominalSpeed, loft ? 0.2 : 0, loft), 0.2, 3.4);
        tx = clamp(m.x + (m.vx || 0) * nextEta, 3, 97);
        ty = clamp(m.y + (m.vy || 0) * nextEta, 3, 97);
        if (Math.abs(nextEta - eta) < 0.005) break;
        eta = nextEta;
      }`);
  }
  return { ...result, source };
} });
const { SimEngine, SIM } = await import(engineURL);
const measured = new WeakMap();
const totals = { passes: 0, boxPasses: 0, protectedContacts: 0, boxProtectedContacts: 0,
  collectedUnder8m: 0, boxCollectedUnder8m: 0 };
const metreGap = (a, b) => Math.hypot((a.x - b.x) * 0.68, (a.y - b.y) * 1.05);
if (variant === "contact_space" || variant === "contact_chance") {
  const candidates = SimEngine.prototype._passCandidates;
  SimEngine.prototype._passCandidates = function (a) {
    const options = candidates.call(this, a);
    if (this.ball.restartType || this.ball.owner !== a.id) return options;
    return options.filter((option) => {
      if (option.through || option.cross) return true;
      const dx = (option.tx - this.ball.x) * 0.68;
      const dy = (option.ty - this.ball.y) * 1.05;
      const length = Math.hypot(dx, dy);
      if (length < 20) {
        const blocked = this.agents.some((opponent) => {
          if (opponent.team === a.team || opponent.sentOff || opponent.injuredOff) return false;
          const px = (opponent.x - this.ball.x) * 0.68;
          const py = (opponent.y - this.ball.y) * 1.05;
          const along = (px * dx + py * dy) / length;
          if (along < 0 || along > Math.min(8, length)) return false;
          return Math.abs(px * dy - py * dx) / length < 1.1;
        });
        if (blocked) return false;
      }
      if (option.agent && !option.backpass) {
        const goalY = this.targetGoalY(a.team);
        const advance = Math.max(-0.5, Math.min(1,
          (Math.abs(a.y - goalY) - Math.abs(option.agent.y - goalY)) / 40));
        const previousBenefit = 0.35 + advance;
        if (previousBenefit < 0.1 && previousBenefit !== 0) {
          option.value *= 0.1 / previousBenefit;
        }
      }
      return true;
    }).sort((a, b) => b.value - a.value);
  };
}
if (variant === "contact_chance") {
  const decide = SimEngine.prototype._decideOnBall;
  SimEngine.prototype._decideOnBall = function (a) {
    const opportunity = this._goalOpportunity(a);
    const goalHeading = Math.atan2(this.targetGoalY(a.team) - a.y, 50 - a.x);
    if (!this._inOwnFoulBox(a.team === "home" ? "away" : "home", a.x, a.y) ||
        opportunity.dGoal >= 16 || opportunity.angle < 0.45 || this._pressureOn(a) >= 0.65 ||
        Math.cos((a.heading || 0) - goalHeading) < 0.5) return decide.call(this, a);
    const until = this._teamShotUntil[a.team];
    this._teamShotUntil[a.team] = 0;
    try {
      return decide.call(this, a);
    } finally {
      if (this._teamShotUntil[a.team] === 0) this._teamShotUntil[a.team] = until;
    }
  };
}
const pass = SimEngine.prototype._pass;
SimEngine.prototype._pass = function (a, ...args) {
  const wasOwner = this.ball.owner === a.id;
  const origin = { x: this.ball.x, y: this.ball.y };
  const wasBox = this._inOwnFoulBox(a.team === "home" ? "away" : "home", origin.x, origin.y);
  const result = pass.call(this, a, ...args);
  if (wasOwner && this.ball.state === "pass" && this.ball.lastKicker === a.id) {
    totals.passes++;
    if (wasBox) totals.boxPasses++;
    measured.set(this, { origin, wasBox, at: this.ball.lastPassAt, protected: false });
  }
  return result;
};
const resolve = SimEngine.prototype._resolvePossession;
SimEngine.prototype._resolvePossession = function (...args) {
  const b = this.ball;
  const record = measured.get(this);
  const wasPass = b.state === "pass" && record?.at === b.lastPassAt;
  const flown = wasPass ? metreGap(record.origin, b) : Infinity;
  if (wasPass && flown >= SIM.CONTROL_RADIUS_METRES && flown < 8 && (b.z || 0) < 2.2 && !b.owner) {
    const speed = Math.hypot(b.vx * 0.68, b.vy * 1.05);
    const reach = SIM.CONTROL_RADIUS_METRES + speed * 0.04;
    const nearest = this.agents.filter((a) => !a.sentOff && !a.injuredOff && a.role !== "GK")
      .sort((a, c) => metreGap(a, b) - metreGap(c, b))[0];
    if (nearest && nearest.team !== b.kickTeam && metreGap(nearest, b) < reach && !record.protected) {
      record.protected = true;
      totals.protectedContacts++;
      if (record.wasBox) totals.boxProtectedContacts++;
    }
  }
  const result = resolve.call(this, ...args);
  if (wasPass && b.owner && flown < 8) {
    totals.collectedUnder8m++;
    if (record.wasBox) totals.boxCollectedUnder8m++;
  }
  return result;
};
process.argv[2] = count;
process.argv[3] = audit === "movement" ? "control" : profile;
console.log(`Pass release protection: ${variant}`);
const audits = {
  box: "./box-possession-sampling-audit.mjs",
  movement: "./_final-third-movement-calibration-probe.mjs",
  realism: "./match-realism-audit.mjs",
  contact: "./_short-pass-contact-probe.mjs",
  timing: "./_pass-reception-timing-probe.mjs",
};
assert.ok(audits[audit], `unknown audit: ${audit}`);
process.on("exit", () => console.log(JSON.stringify({ passProtection: totals }, null, 2)));
await import(audits[audit]);
