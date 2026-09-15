import assert from "node:assert/strict";

import {
  MOTION_INCIDENT_TYPES,
  MotionIntegrityMonitor,
} from "../js/match-motion-integrity.js";
import { SimEngine } from "../js/sim/engine.js";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeClub(id, strength = 12) {
  const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = positions.map((pos, index) => ({
    id: `${id}-${index}`,
    name: `${id} ${index + 1}`,
    pos,
    number: index + 1,
    age: 25,
    ovr: strength,
    potential: strength,
    fitness: 100,
    morale: 70,
    injured: 0,
    suspended: 0,
    attrs: Object.fromEntries([
      "pace", "acceleration", "agility", "balance", "strength", "physical",
      "passing", "vision", "shooting", "finishing", "dribbling", "tackling",
      "marking", "stamina", "positioning", "reflexes", "handling", "kicking",
      "heading", "crossing", "decisions", "firstTouch",
    ].map((key) => [key, strength])),
  }));
  return {
    id,
    name: id,
    short: id,
    color: id.includes("home") ? "#2563eb" : "#dc2626",
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      style: "balanced",
      pressing: 3,
      tempo: 3,
      width: 3,
      defensiveLine: 3,
      roles: [],
      duties: [],
    },
  };
}

function manualFrame(t, options = {}) {
  const playerX = options.playerX ?? 30 + t * 0.5;
  const ballX = options.ballX ?? playerX + 0.8;
  return {
    t,
    ball: {
      x: ballX,
      y: options.ballY ?? 50,
      z: 0,
      owner: options.owner === undefined ? "home-1" : options.owner,
      state: options.ballState || "held",
      restartType: options.restartType || null,
    },
    motionContext: options.boundary
      ? { discontinuity: true, reason: "audit-boundary", restartType: null }
      : null,
    players: [
      {
        id: "home-1",
        team: "home",
        role: "MID",
        num: 8,
        x: playerX,
        y: 50,
        vx: options.vx ?? 0.5,
        vy: options.vy ?? 0,
        heading: 0,
        movementTarget: options.targetX == null
          ? null
          : { x: options.targetX, y: 50, source: "updated", setAt: t, until: t + 1, phase: "stable-possession", ownerId: "home-1" },
      },
      {
        id: "away-1",
        team: "away",
        role: "MID",
        num: 6,
        x: options.awayX ?? 70,
        y: options.awayY ?? 50,
        vx: 0,
        vy: 0,
        heading: Math.PI,
      },
    ],
  };
}

function incidentTypes(monitor) {
  return new Set(monitor.auditSummary().incidents.map((incident) => incident.type));
}

function auditSyntheticDetection() {
  const normal = new MotionIntegrityMonitor({ windowSeconds: 12 });
  for (let index = 0; index <= 30; index++) normal.record(manualFrame(index * 0.1));
  assert.equal(normal.auditSummary().totalIncidents, 0, "ordinary continuous movement must remain clean");

  const teleport = new MotionIntegrityMonitor();
  teleport.record(manualFrame(0));
  teleport.record(manualFrame(0.1, { playerX: 60, ballX: 60.8 }));
  assert.ok(incidentTypes(teleport).has(MOTION_INCIDENT_TYPES.PLAYER_TELEPORT));

  const boundary = new MotionIntegrityMonitor();
  boundary.record(manualFrame(0));
  boundary.record(manualFrame(0.1, { playerX: 60, ballX: 60.8, boundary: true }));
  assert.equal(incidentTypes(boundary).has(MOTION_INCIDENT_TYPES.PLAYER_TELEPORT), false);

  const invalid = new MotionIntegrityMonitor();
  const invalidFrame = manualFrame(0);
  invalidFrame.players[0].x = Number.NaN;
  invalid.record(invalidFrame);
  assert.ok(incidentTypes(invalid).has(MOTION_INCIDENT_TYPES.INVALID_COORDINATE));
  assert.equal(invalid.auditSummary().incidents[0].x, "NaN");

  const ownerGap = new MotionIntegrityMonitor();
  ownerGap.record(manualFrame(0));
  ownerGap.record(manualFrame(0.1, { ballX: 45 }));
  assert.ok(incidentTypes(ownerGap).has(MOTION_INCIDENT_TYPES.OWNER_BALL_GAP));

  const displayGap = new MotionIntegrityMonitor();
  const engine = manualFrame(0);
  const display = manualFrame(0, { playerX: 45, ballX: 45.8 });
  displayGap.record(engine, display);
  assert.ok(incidentTypes(displayGap).has(MOTION_INCIDENT_TYPES.DISPLAY_DIVERGENCE));

  const overlap = new MotionIntegrityMonitor();
  for (let index = 0; index <= 7; index++) {
    const frame = manualFrame(index * 0.1, { awayX: 30.1 + index * 0.05, awayY: 50 });
    overlap.record(frame);
  }
  assert.ok(incidentTypes(overlap).has(MOTION_INCIDENT_TYPES.PLAYER_OVERLAP));

  const targetChurn = new MotionIntegrityMonitor();
  for (const [index, targetX] of [65, 35, 65, 35].entries()) {
    targetChurn.record(manualFrame(index * 0.1, { targetX, playerX: 50, ballX: 50.8 }));
  }
  assert.ok(incidentTypes(targetChurn).has(MOTION_INCIDENT_TYPES.PLAYER_TARGET_CHURN));

  const supportCrowding = new MotionIntegrityMonitor();
  for (let index = 0; index <= 7; index++) {
    const frame = manualFrame(index * 0.1);
    frame.players[0].fsm = "support";
    frame.players[0].movementTarget = { x: 55, y: 45, source: "layered", setAt: 0, until: 10, phase: "stable-possession", ownerId: "home-1" };
    frame.players.push({
      ...frame.players[0],
      id: "home-2",
      num: 10,
      x: 35,
      movementTarget: { x: 55.2, y: 45, source: "layered", setAt: 0, until: 10, phase: "stable-possession", ownerId: "home-1" },
    });
    supportCrowding.record(frame);
  }
  assert.ok(incidentTypes(supportCrowding).has(MOTION_INCIDENT_TYPES.SUPPORT_TARGET_CROWDING));

  const clip = overlap.captureClip({
    reason: "audit",
    createdAt: "2026-08-18T00:00:00.000Z",
    metadata: { fixtureId: "motion-audit", matchSeed: 229 },
  });
  assert.equal(clip.kind, "vcfm-motion-clip");
  assert.equal(clip.version, 2);
  assert.equal(clip.metadata.matchSeed, 229);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(clip)));
}

function runFullMatch(seed, { monitorMotion = true, profile = "background" } = {}) {
  const random = seededRandom(seed);
  const engine = new SimEngine(
    makeClub(`home-${seed}`, 12),
    makeClub(`away-${seed}`, 12),
    { random, simulationProfile: profile }
  );
  const monitor = monitorMotion
    ? new MotionIntegrityMonitor({
        windowSeconds: 12,
        sampleIntervalSeconds: profile === "background" ? 0.25 : 0.075,
        metadata: { matchSeed: seed, profile },
      })
    : null;
  while (engine.t < 90 * 60 - 1e-9) {
    engine.step(profile === "background" ? 0.3 : 0.1);
    if (monitor) {
      const snapshot = engine.snapshot();
      monitor.record(snapshot, snapshot, { label: "full-match-audit" });
    }
  }
  // `engine.stats` only ever accumulates `poss` (js/sim/engine.js:1698); its
  // `shots` and `passes` fields are initialised to 0 and never written, and it has
  // no `goals` field at all. Reading them here made three of the four read-only
  // assertions below compare a constant to itself and pass unconditionally:
  // `undefined` vs `undefined` for the score, `0` vs `0` for shots and passes.
  // Goals live on `engine.score`; shots and passes are derived from the event log,
  // which is the same source match-realism-audit.mjs counts from.
  const countEvents = (team, type) =>
    engine.events.filter((event) => event.team === team && event.type === type).length;
  return {
    score: [engine.score.home, engine.score.away],
    shots: [countEvents("home", "shot"), countEvents("away", "shot")],
    passes: [countEvents("home", "pass"), countEvents("away", "pass")],
    events: engine.events.map((event) => [event.type, event.t, event.team]),
    integration: engine.integrationSummary(),
    motion: monitor?.auditSummary() || null,
    clip: monitor?.captureClip({ reason: "audit", createdAt: "audit" }) || null,
  };
}

function summarizeSamples(samples) {
  const totals = samples.reduce((summary, sample) => {
    summary.severe += sample.motion.severe;
    summary.warnings += sample.motion.warnings;
    for (const [type, count] of Object.entries(sample.motion.byType)) {
      summary.byType[type] = (summary.byType[type] || 0) + count;
    }
    summary.maxFineSharePct = Math.max(summary.maxFineSharePct, sample.integration.fineSharePct || 0);
    summary.maxExtraStepSharePct = Math.max(summary.maxExtraStepSharePct, sample.integration.extraStepSharePct || 0);
    return summary;
  }, { severe: 0, warnings: 0, byType: {}, maxFineSharePct: 0, maxExtraStepSharePct: 0 });
  const severeExamples = samples.flatMap((sample) =>
    sample.motion.incidents.filter((incident) => incident.severity === "severe")
  ).slice(0, 12);
  const warningExamples = samples.flatMap((sample) =>
    sample.motion.incidents.filter((incident) => incident.severity === "warning")
  ).slice(0, 12);
  return { matches: samples.length, ...totals, severeExamples, warningExamples };
}

function auditCompleteMatches() {
  const pairedSeed = 22901;
  const observed = runFullMatch(pairedSeed, { monitorMotion: true });
  const control = runFullMatch(pairedSeed, { monitorMotion: false });
  assert.deepEqual(observed.score, control.score, "motion observation changed the score");
  assert.deepEqual(observed.shots, control.shots, "motion observation changed shots");
  assert.deepEqual(observed.passes, control.passes, "motion observation changed passes");
  assert.deepEqual(observed.events, control.events, "motion observation consumed or reordered randomness");

  const backgroundSamples = [observed];
  for (const seed of [22902, 22903, 22904, 22905, 22906]) backgroundSamples.push(runFullMatch(seed));
  const standardSamples = [22911, 22912].map((seed) => runFullMatch(seed, { profile: "standard" }));
  const background = summarizeSamples(backgroundSamples);
  const standard = summarizeSamples(standardSamples);

  assert.equal(background.severe, 0, `severe background motion incidents remain: ${JSON.stringify(background.severeExamples)}`);
  assert.equal(standard.severe, 0, `severe standard motion incidents remain: ${JSON.stringify(standard.severeExamples)}`);
  assert.ok((background.byType[MOTION_INCIDENT_TYPES.PLAYER_TARGET_CHURN] || 0) <= 12, `background target churn is too high: ${JSON.stringify(background.byType)}`);
  assert.ok((background.byType[MOTION_INCIDENT_TYPES.SUPPORT_TARGET_CROWDING] || 0) <= 18, `background support target crowding is too high: ${JSON.stringify(background.byType)}`);
  assert.ok((background.byType[MOTION_INCIDENT_TYPES.PLAYER_OSCILLATION] || 0) <= 8, `background player oscillation is too high: ${JSON.stringify(background.byType)}`);
  assert.ok((standard.byType[MOTION_INCIDENT_TYPES.PLAYER_TARGET_CHURN] || 0) <= 4, `standard target churn is too high: ${JSON.stringify(standard.byType)}`);
  assert.ok((standard.byType[MOTION_INCIDENT_TYPES.SUPPORT_TARGET_CROWDING] || 0) <= 6, `standard support target crowding is too high: ${JSON.stringify(standard.byType)}`);
  assert.equal((standard.byType[MOTION_INCIDENT_TYPES.PLAYER_OSCILLATION] || 0), 0, `standard player oscillation remains: ${JSON.stringify(standard.warningExamples)}`);
  assert.ok([...backgroundSamples, ...standardSamples].every((sample) => sample.clip.frames.length >= 35 && sample.clip.frames.length <= 125));
  assert.ok([...backgroundSamples, ...standardSamples].every((sample) => sample.clip.range.durationSeconds <= 12.31));
  // Keep the read-only assertions above honest. They only mean something if the
  // counters they compare are actually populated; a dead field would make them
  // compare a constant to itself and pass forever, which is exactly what happened
  // before `score`/`shots`/`passes` were repointed at `engine.score` and the event log.
  for (const sample of [...backgroundSamples, ...standardSamples]) {
    assert.ok(sample.shots[0] + sample.shots[1] > 0, `motion audit sample recorded no shots: ${JSON.stringify(sample.shots)}`);
    assert.ok(sample.passes[0] + sample.passes[1] > 0, `motion audit sample recorded no passes: ${JSON.stringify(sample.passes)}`);
  }
  return { background, standard };
}

auditSyntheticDetection();
const complete = auditCompleteMatches();

console.log(JSON.stringify({
  synthetic: "invalid coordinates, teleport, boundary, owner gap, overlap and display divergence detected",
  complete,
}, null, 2));
console.log("Match motion integrity audit passed: rolling clips and automatic markers are deterministic, read-only and bounded across complete matches");
