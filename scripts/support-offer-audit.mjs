import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

const mx = SIM.PITCH_W_METRES / SIM.FIELD_W;
const my = SIM.PITCH_H_METRES / SIM.FIELD_H;
const gap = (p, q) => Math.hypot((p.x - q.x) * mx, (p.y - q.y) * my);
function club(id) {
  const players = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"]
    .map((pos, i) => ({ id: `${id}-${i}`, name: `${id}-${i}`, pos, fitness: 100,
      attrs: Object.fromEntries(["pace", "passing", "vision", "shooting", "finishing", "dribbling",
        "tackling", "marking", "strength", "stamina", "positioning", "reflexes", "handling", "kicking"]
        .map((key) => [key, 15])) }));
  return { id, name: id, players, tactics: { formation: "4-3-3", lineup: players.map((p) => p.id) } };
}
function scene(team, side) {
  let draws = 0;
  const engine = new SimEngine(club("home"), club("away"), { random: () => { draws++; return 0.5; } });
  engine.t = 100;
  engine.deadBallUntil = 0;
  engine._teamAttackSince[team] = 90;
  const other = team === "home" ? "away" : "home";
  const depthY = (depth) => engine.targetGoalY(team) - engine.attackDir(team) * depth / my;
  const anchor = { x: 50 + side * 5, y: depthY(25) };
  for (const a of engine.agents) Object.assign(a, { sentOff: true, injuredOff: false, vx: 0, vy: 0 });
  const owner = engine.agentById(`${team}-8`);
  const player = engine.agentById(`${team}-9`);
  const blocker = engine.agentById(`${other}-2`);
  const keeper = engine.agentById(`${other}-0`);
  Object.assign(owner, { sentOff: false, x: anchor.x, y: depthY(8) });
  Object.assign(player, { sentOff: false, ...anchor, tx: anchor.x, ty: anchor.y, fsm: "support", habits: [] });
  Object.assign(blocker, { sentOff: false, x: anchor.x, y: depthY(16.5) });
  Object.assign(keeper, { sentOff: false, x: 50, y: depthY(1.5) });
  Object.assign(engine.ball, { x: owner.x, y: owner.y, owner: owner.id, state: "held", z: 0,
    restartType: null, kickoffPassUntil: 0 });
  const baseTarget = () => ({ ...anchor, fsm: "support", kind: null, ownerId: engine.ball.owner,
    playerId: player.id, team, phase: engine._teamShapePhase(team), setAt: engine.t, until: engine.t + 1.5 });
  function apply(previous = null, currentOwner = engine.agentById(engine.ball.owner), kind = null) {
    player.tx = anchor.x;
    player.ty = anchor.y;
    player.fsm = "support";
    player.offBallTargetKind = kind;
    player.offBallTarget = { ...baseTarget(), kind };
    const before = draws;
    engine._applySupportOffer(player, currentOwner, previous);
    assert.equal(draws, before, "finding a visible passing lane does not consume outcome randomness");
    const offer = player.offBallTarget?.offer;
    return offer ? { ...offer, x: player.tx, y: player.ty } : null;
  }
  function activate() {
    return apply();
  }
  return { engine, player, owner, blocker, anchor, depthY, apply, activate };
}

let cases = 0;
for (const team of ["home", "away"]) for (const side of [-1, 1]) {
  const s = scene(team, side);
  assert.ok(s.engine._laneSafety(s.owner, s.player) <= 1.1 / 8, "fixture starts behind an actual defender");
  const offer = s.activate();
  assert.ok(offer, "a screened, settled forward should move into available short-pass space");
  assert.equal(offer.y, s.anchor.y, "a lateral offer preserves the tactical depth");
  assert.ok(s.engine._laneSafety(s.owner, s.player, offer.x, offer.y) >= 1.8 / 8);
  assert.ok(s.engine._launchRouteClear(s.owner, { agent: s.player, tx: offer.x, ty: offer.y }));
  assert.equal(s.engine._isOffsidePosition(team, offer), false);
  // Tangent from the ball to the defender's 1.8 m passing shadow, intersected
  // with the support depth. This independently bounds the necessary detour.
  const laneLength = Math.abs(s.anchor.y - s.engine.ball.y) * my;
  const defenderAlong = Math.abs(s.blocker.y - s.engine.ball.y) * my;
  const tangentDetour = 1.8 * laneLength / Math.sqrt(defenderAlong ** 2 - 1.8 ** 2);
  assert.ok(gap(s.anchor, offer) >= tangentDetour - 1e-7);
  assert.ok(gap(s.anchor, offer) <= tangentDetour + 0.003,
    "a clear opening should not force the receiver to overshoot to a fixed 4 or 6 m point");
  cases++;
  const start = { x: s.player.x, y: s.player.y };
  for (let step = 0; step < 30; step++) s.engine._integrate(s.player, SIM.DT);
  assert.ok(gap(start, s.player) > 2, "the offer must cause physical movement through the normal integrator");
  assert.ok(gap(s.player, offer) < gap(start, offer));
  assert.ok(Math.hypot(s.player.vx, s.player.vy) <= SIM.MAX_PLAYER_SPEED);
  s.engine.t += 3;
  assert.deepEqual(s.apply(offer), offer, "ordinary target refreshes keep a useful offer");
  cases += 2;

  for (const kind of ["third-man-run", "cutback-outlet", "one-two"]) {
    const assigned = scene(team, side);
    const prior = assigned.activate();
    assigned.engine.t += 0.2;
    assert.equal(assigned.apply(prior, assigned.owner, kind), null,
      "an explicit attacking run has priority over an ordinary passing offer");
    assert.equal(assigned.player.offBallTarget.kind, kind);
    cases++;
  }

  const progressing = scene(team, side);
  const priorDepth = progressing.activate();
  progressing.engine.t += 0.5;
  progressing.anchor.y += 1 / my;
  const followsDepth = progressing.apply(priorDepth);
  assert.ok(followsDepth);
  assert.equal(followsDepth.y, progressing.anchor.y,
    "the offer's lateral position cannot freeze a subsequent tactical depth change");
  assert.equal(followsDepth.x, priorDepth.x);
  cases++;

  const unscreened = scene(team, side);
  unscreened.blocker.sentOff = true;
  assert.equal(unscreened.apply(), null, "an already available outlet does not move for the sake of motion");
  const defending = scene(team, side);
  defending.player.role = "DEF";
  assert.equal(defending.apply(), null, "the support check cannot pull the defensive cover out of shape");
  cases += 2;

  const changed = scene(team, side);
  const old = changed.activate();
  const newOwner = changed.engine.agentById(`${team}-10`);
  Object.assign(newOwner, { sentOff: false, x: changed.owner.x + 2, y: changed.owner.y });
  Object.assign(changed.engine.ball, { owner: newOwner.id, x: newOwner.x, y: newOwner.y });
  // The defender screens the NEW passing line while both ball positions remain
  // within the old offer's spatial context. The v1 candidate retained this point.
  Object.assign(changed.blocker, { x: (newOwner.x + old.x) / 2, y: (newOwner.y + old.y) / 2 });
  assert.ok(changed.engine._laneSafety(newOwner, changed.player, old.x, old.y) <= 1.1 / 8);
  changed.engine.t += 0.5;
  const next = changed.apply(old, newOwner);
  assert.ok(!next || next.at !== old.at, "a new holder cannot inherit a now-blocked old offer");
  if (next) assert.ok(changed.engine._laneSafety(newOwner, changed.player, next.x, next.y) >= 1.8 / 8);
  cases++;

  const clear = scene(team, side);
  const available = clear.activate();
  const teammate = clear.engine.agentById(`${team}-10`);
  Object.assign(teammate, { sentOff: false, x: clear.owner.x + 0.5, y: clear.owner.y });
  Object.assign(clear.engine.ball, { owner: teammate.id, x: teammate.x, y: teammate.y });
  Object.assign(clear.blocker, { x: 3, y: clear.depthY(16.5) });
  clear.engine.t += 0.5;
  const continued = clear.apply(available, teammate);
  assert.ok(continued, "a revalidated open line can continue without a needless reversal");
  assert.deepEqual({ x: continued.x, y: continued.y }, { x: available.x, y: available.y });
  assert.equal(continued.ownerId, teammate.id, "the offer records its actual new holder");
  cases++;

  const closed = scene(team, side);
  const formerlyOpen = closed.activate();
  Object.assign(closed.blocker, {
    x: (closed.owner.x + formerlyOpen.x) / 2,
    y: (closed.owner.y + formerlyOpen.y) / 2,
  });
  closed.player.vx = 2;
  closed.engine.t += 0.5;
  const rechecked = closed.apply(formerlyOpen);
  assert.ok(!rechecked || rechecked.at !== formerlyOpen.at,
    "a defender closing the selected lane retires the offer even without a holder change");
  cases++;

  const leased = scene(team, side);
  leased.blocker.y = leased.depthY(13.5);
  const leasedOffer = leased.activate();
  assert.ok(leasedOffer && gap(leased.anchor, leasedOffer) > 5.5,
    "fixture needs a real opening beyond the ordinary reversal lease threshold");
  Object.assign(leased.blocker, { x: (leased.owner.x + leasedOffer.x) / 2,
    y: (leased.owner.y + leasedOffer.y) / 2 });
  const towardOffer = Math.sign(leasedOffer.x - leased.anchor.x);
  Object.assign(leased.player, { x: leased.anchor.x + towardOffer * 0.5 / mx,
    vx: towardOffer * 2, tx: leased.anchor.x, ty: leased.anchor.y, offBallTargetKind: null });
  leased.engine.t += 0.5;
  leased.engine._commitOffBallTarget(leased.player, leased.owner);
  assert.ok(leased.engine._laneSafety(leased.owner, leased.player, leased.player.tx, leased.player.ty) > 1.1 / 8,
    "the actual committed target must not retain a closed offer through the ordinary reversal lease");
  cases++;

  const stable = scene(team, side);
  stable.blocker.y = stable.depthY(13.5);
  const useful = stable.activate();
  const towardUseful = Math.sign(useful.x - stable.anchor.x);
  Object.assign(stable.player, { x: stable.anchor.x + towardUseful * 0.5 / mx,
    vx: towardUseful * 2, tx: stable.anchor.x, ty: stable.anchor.y + 0.4 / my, offBallTargetKind: null });
  stable.engine.t += 0.5;
  stable.engine._commitOffBallTarget(stable.player, stable.owner);
  assert.equal(stable.player.tx, useful.x,
    "the real target pipeline must continue a useful opening without reversing the runner");
  assert.equal(stable.player.ty, stable.anchor.y + 0.4 / my,
    "the ordinary reversal lease must not freeze the current tactical depth");
  assert.equal(stable.player.offBallTarget.offer.at, useful.at);
  cases++;

  const walking = scene(team, side);
  walking.blocker.y = walking.depthY(13.5);
  const opening = walking.activate();
  const marker = walking.engine.agentById(`${team === "home" ? "away" : "home"}-3`);
  Object.assign(marker, { sentOff: false, x: (walking.anchor.x + opening.x) / 2, y: opening.y });
  assert.ok(walking.engine._laneSafety(walking.owner, walking.player, opening.x, opening.y) >= 1.8 / 8,
    "the fixture has a safe passing line but a defender across the receiver's walking route");
  assert.ok(gap(marker, opening) > 2, "the original endpoint itself has receiving space");
  const walkable = walking.activate();
  assert.ok(walkable && (walkable.x - walking.anchor.x) * (opening.x - walking.anchor.x) < 0,
    "the receiver must choose the open side instead of crossing the nearby defender's body");
  cases++;

  const narrow = scene(team, side);
  const reservation = narrow.engine.agentById(`${team}-10`);
  Object.assign(reservation, { sentOff: false, x: narrow.anchor.x + side * 15 / mx, y: narrow.depthY(40),
    tx: narrow.anchor.x + side * 5.6 / mx, ty: narrow.anchor.y });
  const otherRoute = narrow.engine.agentById(`${team}-7`);
  Object.assign(otherRoute, { sentOff: false, x: narrow.anchor.x - side * 3 / mx, y: narrow.anchor.y,
    tx: narrow.anchor.x - side * 3 / mx, ty: narrow.anchor.y });
  const gapPoint = { x: narrow.anchor.x + side * 3.75 / mx, y: narrow.anchor.y };
  assert.ok(narrow.engine._supportRunClear(narrow.player, gapPoint));
  assert.ok(narrow.engine._laneSafety(narrow.owner, narrow.player, gapPoint.x, gapPoint.y) >= 1.8 / 8);
  assert.ok(gap(gapPoint, { x: reservation.tx, y: reservation.ty }) > 1.8);
  const narrowOffer = narrow.activate();
  assert.ok(narrowOffer, "an opening between the 2/4/6 m search points must not be missed");
  assert.ok((narrowOffer.x - narrow.anchor.x) * side > 0);
  assert.ok(gap(narrow.anchor, narrowOffer) <= 3.8 + 1e-6,
    "the chosen point must fit between the real passing shadow and the teammate's reserved space");
  cases++;

  const alreadyOpen = scene(team, side);
  alreadyOpen.player.x -= side * 1.2 / mx;
  alreadyOpen.blocker.x += side * 1 / mx;
  alreadyOpen.blocker.y = alreadyOpen.depthY(23.3);
  assert.ok(alreadyOpen.engine._laneSafety(alreadyOpen.owner, alreadyOpen.player,
    alreadyOpen.anchor.x, alreadyOpen.anchor.y) <= 1.1 / 8);
  assert.ok(alreadyOpen.engine._laneSafety(alreadyOpen.owner, alreadyOpen.player,
    alreadyOpen.player.x, alreadyOpen.player.y) >= 1.8 / 8);
  const staysOpen = alreadyOpen.activate();
  assert.ok(staysOpen);
  assert.equal(staysOpen.x, alreadyOpen.player.x,
    "an already open physical position is the nearest offer even when the tactical anchor is screened");
  assert.equal(staysOpen.y, alreadyOpen.anchor.y);
  cases++;

  for (const change of [
    (r) => { r.engine._teamAttackSince[team] = r.engine.t; },
    (r) => { r.engine.ball.restartType = "free_kick"; },
    (r) => { r.player.sentOff = true; },
    (r) => { r.player.injuredOff = true; },
    (r) => { r.engine.ball.state = "shot"; },
  ]) {
    const r = scene(team, side);
    const prior = r.activate();
    // Keep moving toward the old offer so this cannot initiate a new task.
    r.player.vx = 2;
    change(r);
    assert.equal(r.apply(prior), null, "ended possession/play/player contexts release the old offer");
    cases++;
  }
}
console.log(`Support offer audit passed: ${cases} mirrored lane, movement, continuation and context cases`);
