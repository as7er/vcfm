// Observe the same seeded matches as box-possession-sampling-audit. No extra
// decisions, random draws, or writes to engine state are performed here.
import { SimEngine, SIM } from "../js/sim/engine.js";

const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const gap = (a, b) => Math.hypot((a.x - b.x) * mx, (a.y - b.y) * my);
const snapshot = (a) => ({ id: a.id, team: a.team, role: a.role,
  x: a.x, y: a.y, vx: a.vx, vy: a.vy, sentOff: a.sentOff, injuredOff: a.injuredOff });
const selections = new WeakMap();
const flights = new WeakMap();
const records = [];

function lineGap(a, origin, target) {
  const dx = (target.x - origin.x) * mx;
  const dy = (target.y - origin.y) * my;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { along: 0, perpendicular: Infinity };
  const px = (a.x - origin.x) * mx;
  const py = (a.y - origin.y) * my;
  return { along: (px * dx + py * dy) / length,
    perpendicular: Math.abs(px * dy - py * dx) / length };
}

function blocked(a, origin, target) {
  const line = lineGap(a, origin, target);
  return line.along >= 0 && line.along <= Math.min(8, gap(origin, target)) &&
    line.perpendicular <= 1.1;
}

function finish(engine) {
  const record = flights.get(engine);
  if (!record) return;
  const b = engine.ball;
  if (b.state === "pass" && !b.owner && b.lastPassAt === record.at &&
      b.lastKicker === record.passerId) return;
  record.outcome ??= b.owner ? "other-control" : b.restartType || b.state;
  records.push(record);
  flights.delete(engine);
}

const pass = SimEngine.prototype._pass;
SimEngine.prototype._pass = function (a, target, prepared) {
  const wasOwner = this.ball.owner === a.id;
  if (!wasOwner) return pass.call(this, a, target, prepared);
  const captured = { at: this.t, origin: { x: this.ball.x, y: this.ball.y },
    agents: this.agents.map(snapshot), target: { x: target.tx, y: target.ty } };
  if (!prepared) selections.set(a, captured);
  const selected = selections.get(a) || captured;
  const result = pass.call(this, a, target, prepared);
  const b = this.ball;
  if (b.state !== "pass" || b.owner || b.lastKicker !== a.id) return result;
  finish(this);
  const opponents = captured.agents.filter((m) => m.team !== a.team &&
    m.role !== "GK" && !m.sentOff && !m.injuredOff);
  const selectedOpponents = selected.agents.filter((m) => m.team !== a.team &&
    m.role !== "GK" && !m.sentOff && !m.injuredOff);
  flights.set(this, {
    at: b.lastPassAt, team: a.team, passerId: a.id,
    receiverId: b.receiverId, origin: captured.origin, target: captured.target,
    selection: selected, release: captured, cross: !!b.isCrossPass,
    through: !!b.isThroughPass, length: gap(captured.origin, captured.target),
    kind: target.cutback ? "cutback" : target.cross ? "cross" : target.through ? "through" : "ordinary",
    fromBox: this._inOwnFoulBox(a.team === "home" ? "away" : "home", captured.origin.x, captured.origin.y),
    preparation: captured.at - selected.at,
    blockedAtSelection: selectedOpponents.some((m) => blocked(m, selected.origin, selected.target)),
    blockedAtRelease: opponents.some((m) => blocked(m, captured.origin, captured.target)),
    earlyContact: null,
  });
  return result;
};

const resolve = SimEngine.prototype._resolvePossession;
SimEngine.prototype._resolvePossession = function (dt) {
  const b = this.ball;
  const record = flights.get(this);
  if (record && !record.earlyContact && b.state === "pass" && !b.owner &&
      b.lastPassAt === record.at && b.lastKicker === record.passerId &&
      this.t >= (b.settleUntil || 0) && (b.z || 0) <= 1.1 && gap(record.origin, b) < 8) {
    const nearest = this.agents.filter((m) => m.team !== record.team &&
      m.role !== "GK" && !m.sentOff && !m.injuredOff)
      .sort((left, right) => gap(left, b) - gap(right, b))[0];
    if (nearest && gap(nearest, b) <= 1.1) {
      const selected = record.selection.agents.find((m) => m.id === nearest.id);
      const released = record.release.agents.find((m) => m.id === nearest.id);
      const atSelection = lineGap(selected, record.selection.origin, record.selection.target);
      const atRelease = lineGap(released, record.origin, record.target);
      record.earlyContact = { defenderId: nearest.id,
        flown: gap(record.origin, b), elapsed: this.t + (this._emitTimeOffset || 0) - record.at,
        gap: gap(nearest, b), releaseGap: atRelease.perpendicular,
        selectionGap: atSelection.perpendicular,
        displacement: gap(nearest, released),
        alreadyBlocked: blocked(released, record.origin, record.target),
        selectedBlocked: blocked(selected, record.selection.origin, record.selection.target),
      };
    }
  }
  const result = resolve.call(this, dt);
  finish(this);
  return result;
};

const control = SimEngine.prototype._beginBallControl;
SimEngine.prototype._beginBallControl = function (a, options) {
  const record = flights.get(this);
  if (record && this.ball.state === "pass" && this.ball.lastPassAt === record.at) {
    record.outcome = a.team !== record.team ? "opponent" :
      a.id === record.passerId ? "passer-reclaim" :
        a.id === record.receiverId ? "receiver" : "teammate";
    record.controlDistance = gap(a, this.ball);
    record.controlTravel = gap(record.origin, this.ball);
    record.controlKind = options?.kind;
  }
  return control.call(this, a, options);
};

const step = SimEngine.prototype.step;
SimEngine.prototype.step = function (...args) {
  const result = step.apply(this, args);
  finish(this);
  return result;
};

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)) : null;
};
const countBy = (list, key) => list.reduce((out, item) => {
  out[item[key] ?? "unknown"] = (out[item[key] ?? "unknown"] || 0) + 1;
  return out;
}, {});
const pct = (part, all) => all ? Number((part * 100 / all).toFixed(2)) : 0;
function summarize(list) {
  const contacts = list.filter((r) => r.earlyContact);
  return { passes: list.length, outcomes: countBy(list, "outcome"),
    preparationSeconds: median(list.map((r) => r.preparation)),
    blockedAtSelectionPct: pct(list.filter((r) => r.blockedAtSelection).length, list.length),
    blockedAtReleasePct: pct(list.filter((r) => r.blockedAtRelease).length, list.length),
    earlyContacts: contacts.length, contactOutcomes: countBy(contacts, "outcome"),
    kinds: countBy(list, "kind"), contactKinds: countBy(contacts, "kind"),
    contactAlreadyBlockedPct: pct(contacts.filter((r) => r.earlyContact.alreadyBlocked).length, contacts.length),
    contactSelectedBlockedPct: pct(contacts.filter((r) => r.earlyContact.selectedBlocked).length, contacts.length),
    contactFlightSeconds: median(contacts.map((r) => r.earlyContact.elapsed)),
    contactTravelMetres: median(contacts.map((r) => r.earlyContact.flown)),
    contactDefenderDisplacementMetres: median(contacts.map((r) => r.earlyContact.displacement)),
    contactReleaseGapMetres: median(contacts.map((r) => r.earlyContact.releaseGap)),
    contactSelectionGapMetres: median(contacts.map((r) => r.earlyContact.selectionGap)),
  };
}
process.on("exit", () => console.log(JSON.stringify({ passLaneContacts: {
  all: summarize(records), box: summarize(records.filter((r) => r.fromBox)),
  shortGround: summarize(records.filter((r) => r.length < 20 && !r.cross && !r.through)),
} }, null, 2)));
await import("./box-possession-sampling-audit.mjs");
