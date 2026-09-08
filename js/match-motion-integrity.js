export const MOTION_DIAGNOSTIC_VERSION = 2;

const PITCH_WIDTH_METRES = 68;
const PITCH_LENGTH_METRES = 105;
const FIELD_UNITS = 100;

export const MOTION_INCIDENT_TYPES = Object.freeze({
  INVALID_COORDINATE: "invalid-coordinate",
  PLAYER_TELEPORT: "player-teleport",
  PLAYER_ACCELERATION: "player-acceleration",
  PLAYER_OSCILLATION: "player-oscillation",
  PLAYER_TARGET_CHURN: "player-target-churn",
  PLAYER_OVERLAP: "player-overlap",
  SUPPORT_TARGET_CROWDING: "support-target-crowding",
  OWNER_BALL_GAP: "owner-ball-gap",
  BALL_TELEPORT: "ball-teleport",
  DISPLAY_DIVERGENCE: "display-divergence",
});

export const DEFAULT_MOTION_THRESHOLDS = Object.freeze({
  playerSpeedMps: 12.2,
  playerAccelerationMps2: 42,
  ballSpeedMps: 48,
  shotBallSpeedMps: 65,
  ownerBallGapMetres: 3.2,
  overlapMetres: 0.55,
  overlapSeconds: 0.3,
  displayPlayerGapMetres: 2.5,
  displayBallGapMetres: 4.5,
  oscillationAngleRadians: Math.PI * 0.72,
  oscillationSpeedMps: 2.2,
  oscillationWindowSeconds: 1.2,
  oscillationCount: 3,
  targetChangeMetres: 5.5,
  targetRemainingMetres: 2.4,
  targetReversalAngleRadians: Math.PI * 0.72,
  targetChurnWindowSeconds: 4,
  targetChurnCount: 3,
  targetBallMoveMetres: 7,
  supportTargetGapMetres: 1.6,
  supportTargetCrowdingSeconds: 0.6,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
}

function pointDistanceMetres(a, b) {
  if (!a || !b) return Infinity;
  const dx = (finite(a.x) - finite(b.x)) * (PITCH_WIDTH_METRES / FIELD_UNITS);
  const dy = (finite(a.y) - finite(b.y)) * (PITCH_LENGTH_METRES / FIELD_UNITS);
  return Math.hypot(dx, dy);
}

function velocityMetres(player = {}) {
  return {
    x: finite(player.vx) * (PITCH_WIDTH_METRES / FIELD_UNITS),
    y: finite(player.vy) * (PITCH_LENGTH_METRES / FIELD_UNITS),
  };
}

function angleBetween(a, b) {
  const aLength = Math.hypot(a.x, a.y);
  const bLength = Math.hypot(b.x, b.y);
  if (aLength < 1e-6 || bLength < 1e-6) return 0;
  return Math.acos(clamp((a.x * b.x + a.y * b.y) / (aLength * bLength), -1, 1));
}

function compactPlayer(player = {}) {
  const movementTarget = player.movementTarget;
  return {
    id: player.id ?? null,
    team: player.team || null,
    role: player.role || null,
    num: player.num ?? null,
    x: round(player.x),
    y: round(player.y),
    vx: round(player.vx),
    vy: round(player.vy),
    heading: round(player.heading),
    fsm: player.fsm || null,
    shapePhase: player.shapePhase || null,
    movementTarget: movementTarget
      ? {
          x: round(movementTarget.x),
          y: round(movementTarget.y),
          source: movementTarget.source || null,
          kind: movementTarget.kind || null,
          setAt: round(movementTarget.setAt, 4),
          until: round(movementTarget.until, 4),
          phase: movementTarget.phase || player.shapePhase || null,
          ownerId: movementTarget.ownerId ?? null,
          ball: movementTarget.ball
            ? { x: round(movementTarget.ball.x), y: round(movementTarget.ball.y) }
            : null,
        }
      : null,
    defensiveJob: player.defensiveJob || null,
    sentOff: !!player.sentOff,
    separationContact: !!player.separationContact,
  };
}

function compactBall(ball = {}) {
  return {
    x: round(ball.x, 4),
    y: round(ball.y, 4),
    z: round(ball.z, 4),
    owner: ball.owner ?? null,
    state: ball.state || "loose",
    restartType: ball.restartType || null,
    shotAt: Number.isFinite(Number(ball.shotAt)) ? round(ball.shotAt, 4) : null,
  };
}

export function compactMotionFrame(frame = {}) {
  return {
    t: round(frame.t, 4),
    ball: compactBall(frame.ball),
    players: Array.isArray(frame.players) ? frame.players.map(compactPlayer) : [],
    motionContext: frame.motionContext
      ? {
          discontinuity: !!frame.motionContext.discontinuity,
          reason: frame.motionContext.reason || null,
          restartType: frame.motionContext.restartType || null,
        }
      : null,
  };
}

function playerMap(frame) {
  return new Map((frame?.players || []).map((player) => [player.id, player]));
}

function frameHasInvalidCoordinates(frame) {
  const candidates = [
    { point: frame?.ball, entityId: "ball" },
    ...(frame?.players || []).map((point) => ({ point, entityId: point?.id || "player" })),
  ];
  const invalid = candidates.find(({ point }) =>
    !Number.isFinite(Number(point?.x)) ||
    !Number.isFinite(Number(point?.y)) ||
    Number(point?.x) < -0.5 ||
    Number(point?.x) > 100.5 ||
    Number(point?.y) < -0.5 ||
    Number(point?.y) > 100.5
  );
  if (!invalid) return null;
  const safeValue = (value) => Number.isFinite(Number(value)) ? round(Number(value), 4) : String(value);
  return {
    entityId: invalid.entityId,
    x: safeValue(invalid.point?.x),
    y: safeValue(invalid.point?.y),
  };
}

function isMotionBoundary(previous, current, dt) {
  if (!previous || !current) return true;
  if (dt <= 0 || dt > 0.55) return true;
  if (previous.motionContext?.discontinuity || current.motionContext?.discontinuity) return true;
  if (previous.ball?.restartType || current.ball?.restartType) return true;
  return false;
}

export class MotionIntegrityMonitor {
  constructor(options = {}) {
    this.windowSeconds = Math.max(4, finite(options.windowSeconds, 12));
    this.sampleIntervalSeconds = Math.max(0.04, finite(options.sampleIntervalSeconds, 0.075));
    this.maxIncidents = Math.max(20, Math.round(finite(options.maxIncidents, 100)));
    this.maxHistory = Math.max(this.maxIncidents, Math.round(finite(options.maxHistory, 2000)));
    this.thresholds = {
      ...DEFAULT_MOTION_THRESHOLDS,
      ...(options.thresholds || {}),
    };
    this.reset(options.metadata || {});
  }

  reset(metadata = {}) {
    this.metadata = { ...metadata };
    this.frames = [];
    this.incidents = [];
    this.history = [];
    this._lastIncidentAt = new Map();
    this._overlapSince = new Map();
    this._overlapReportedAt = new Map();
    this._turns = new Map();
    this._targetTurns = new Map();
    this._supportCrowdingSince = new Map();
    this._supportCrowdingReportedAt = new Map();
    return this.status();
  }

  status() {
    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    return {
      version: MOTION_DIAGNOSTIC_VERSION,
      frames: this.frames.length,
      incidents: this.incidents.length,
      totalIncidents: this.history.length,
      severe: this.incidents.filter((incident) => incident.severity === "severe").length,
      durationSeconds: first && last ? round(Math.max(0, last.t - first.t), 2) : 0,
      lastIncident: this.incidents[this.incidents.length - 1] || null,
    };
  }

  record(engineFrame, displayFrame = null, context = {}) {
    if (!engineFrame?.players?.length || !engineFrame.ball) return this.status();
    const invalidCoordinate = frameHasInvalidCoordinates(engineFrame);
    const engine = compactMotionFrame(engineFrame);
    const display = compactMotionFrame(displayFrame || engineFrame);
    const lastRecord = this.frames[this.frames.length - 1];
    const lastTime = lastRecord?.t;

    if (Number.isFinite(lastTime) && engine.t < lastTime - 0.02) {
      this.frames = [];
      this._overlapSince.clear();
      this._turns.clear();
      this._targetTurns.clear();
      this._supportCrowdingSince.clear();
    } else if (
      Number.isFinite(lastTime) &&
      engine.t - lastTime < this.sampleIntervalSeconds &&
      !engine.motionContext?.discontinuity
    ) {
      return this.status();
    }

    const previous = this.frames[this.frames.length - 1] || null;
    const record = {
      t: engine.t,
      engine,
      display,
      // The engine argument can already be interpolated by MatchView. Preserve
      // its actual recording endpoints so a reported jump can be attributed.
      source: context.interpolationSource ? {
        alpha: context.interpolationSource.alpha,
        from: structuredClone(context.interpolationSource.from),
        to: structuredClone(context.interpolationSource.to),
      } : null,
      context: {
        cameraPreset: context.cameraPreset || null,
        replay: !!context.replay,
        label: context.label || null,
      },
      invalidCoordinate,
    };
    this.frames.push(record);
    this._trimFrames(engine.t);
    this._analyze(previous, record);
    return this.status();
  }

  _trimFrames(now) {
    const minimum = now - this.windowSeconds;
    while (this.frames.length > 1 && this.frames[0].t < minimum) this.frames.shift();
    const oldest = this.frames[0]?.t ?? minimum;
    this.incidents = this.incidents.filter((incident) => incident.t >= oldest - 0.001);
  }

  _addIncident(type, severity, t, details = {}, dedupeKey = type, cooldown = 0.75) {
    const key = `${type}:${dedupeKey}`;
    const lastAt = this._lastIncidentAt.get(key);
    if (Number.isFinite(lastAt) && t - lastAt < cooldown) return null;
    const incident = {
      id: `${type}:${round(t, 2)}:${dedupeKey}`,
      type,
      severity,
      t: round(t, 3),
      ...details,
    };
    this.incidents.push(incident);
    this.history.push(incident);
    if (this.incidents.length > this.maxIncidents) this.incidents.shift();
    if (this.history.length > this.maxHistory) this.history.shift();
    this._lastIncidentAt.set(key, t);
    return incident;
  }

  _analyze(previousRecord, currentRecord) {
    const current = currentRecord.engine;
    const invalid = currentRecord.invalidCoordinate || frameHasInvalidCoordinates(current);
    if (invalid) {
      this._addIncident(
        MOTION_INCIDENT_TYPES.INVALID_COORDINATE,
        "severe",
        current.t,
        { entityId: invalid.entityId, x: invalid.x, y: invalid.y },
        invalid.entityId,
        0.2
      );
    }
    if (!previousRecord) {
      this._analyzeDisplay(currentRecord);
      return;
    }

    const previous = previousRecord.engine;
    const dt = current.t - previous.t;
    const boundary = isMotionBoundary(previous, current, dt);
    const previousPlayers = playerMap(previous);
    const currentPlayers = playerMap(current);

    if (!boundary) {
      for (const [id, player] of currentPlayers) {
        const before = previousPlayers.get(id);
        if (!before || player.sentOff || before.sentOff) continue;
        const distance = pointDistanceMetres(before, player);
        const speed = distance / dt;
        if (speed > this.thresholds.playerSpeedMps) {
          this._addIncident(
            MOTION_INCIDENT_TYPES.PLAYER_TELEPORT,
            "severe",
            current.t,
            {
              entityId: id,
              team: player.team,
              speedMps: round(speed, 2),
              distanceMetres: round(distance, 2),
              dt: round(dt, 3),
              from: { x: before.x, y: before.y, fsm: before.fsm },
              to: { x: player.x, y: player.y, fsm: player.fsm },
              velocity: { vx: player.vx, vy: player.vy },
            },
            id
          );
        }

        const beforeVelocity = velocityMetres(before);
        const velocity = velocityMetres(player);
        const contactFrame = before.separationContact || player.separationContact;
        if (contactFrame) this._turns.delete(id);
        const acceleration = Math.hypot(
          velocity.x - beforeVelocity.x,
          velocity.y - beforeVelocity.y
        ) / dt;
        if (!contactFrame && acceleration > this.thresholds.playerAccelerationMps2) {
          this._addIncident(
            MOTION_INCIDENT_TYPES.PLAYER_ACCELERATION,
            "warning",
            current.t,
            { entityId: id, team: player.team, accelerationMps2: round(acceleration, 1), dt: round(dt, 3) },
            id
          );
        }

        const speedBefore = Math.hypot(beforeVelocity.x, beforeVelocity.y);
        const speedNow = Math.hypot(velocity.x, velocity.y);
        const turnAngle = angleBetween(beforeVelocity, velocity);
        if (
          !contactFrame &&
          speedBefore >= this.thresholds.oscillationSpeedMps &&
          speedNow >= this.thresholds.oscillationSpeedMps &&
          turnAngle >= this.thresholds.oscillationAngleRadians
        ) {
          const turns = (this._turns.get(id) || []).filter(
            (time) => current.t - time <= this.thresholds.oscillationWindowSeconds
          );
          turns.push(current.t);
          this._turns.set(id, turns);
          if (turns.length >= this.thresholds.oscillationCount) {
            this._addIncident(
              MOTION_INCIDENT_TYPES.PLAYER_OSCILLATION,
              "warning",
              current.t,
              { entityId: id, team: player.team, turns: turns.length, windowSeconds: this.thresholds.oscillationWindowSeconds },
              id,
              this.thresholds.oscillationWindowSeconds
            );
            this._turns.set(id, []);
          }
        }

        this._analyzeTargetChange(before, player, current.t, id);
      }

      const ballDistance = pointDistanceMetres(previous.ball, current.ball);
      const ballSpeed = ballDistance / dt;
      const recentShot = Number.isFinite(current.ball.shotAt) && current.t - current.ball.shotAt <= 0.5;
      const ballSpeedLimit = previous.ball.state === "shot" || current.ball.state === "shot" || recentShot
        ? this.thresholds.shotBallSpeedMps
        : this.thresholds.ballSpeedMps;
      if (ballSpeed > ballSpeedLimit) {
        this._addIncident(
          MOTION_INCIDENT_TYPES.BALL_TELEPORT,
          "severe",
          current.t,
          {
            entityId: "ball",
            speedMps: round(ballSpeed, 2),
            distanceMetres: round(ballDistance, 2),
            dt: round(dt, 3),
            fromState: previous.ball.state,
            toState: current.ball.state,
            fromOwner: previous.ball.owner || null,
            toOwner: current.ball.owner || null,
          },
          "ball"
        );
      }
    } else {
      this._turns.clear();
      this._targetTurns.clear();
    }

    this._analyzeOwnerGap(current, currentPlayers, boundary);
    this._analyzeOverlaps(current, boundary);
    this._analyzeSupportTargets(current, boundary);
    this._analyzeDisplay(currentRecord);
  }

  _analyzeTargetChange(before, player, time, id) {
    const previousTarget = before.movementTarget;
    const currentTarget = player.movementTarget;
    if (!previousTarget || !currentTarget) {
      this._targetTurns.delete(id);
      return;
    }
    if (
      previousTarget.phase !== currentTarget.phase ||
      previousTarget.ownerId !== currentTarget.ownerId
    ) {
      this._targetTurns.delete(id);
      return;
    }
    if (previousTarget.setAt === currentTarget.setAt) return;
    if (
      previousTarget.ball &&
      currentTarget.ball &&
      pointDistanceMetres(previousTarget.ball, currentTarget.ball) >= this.thresholds.targetBallMoveMetres
    ) {
      this._targetTurns.delete(id);
      return;
    }
    const change = pointDistanceMetres(previousTarget, currentTarget);
    const remaining = pointDistanceMetres(player, previousTarget);
    const previousVector = {
      x: (previousTarget.x - player.x) * (PITCH_WIDTH_METRES / FIELD_UNITS),
      y: (previousTarget.y - player.y) * (PITCH_LENGTH_METRES / FIELD_UNITS),
    };
    const currentVector = {
      x: (currentTarget.x - player.x) * (PITCH_WIDTH_METRES / FIELD_UNITS),
      y: (currentTarget.y - player.y) * (PITCH_LENGTH_METRES / FIELD_UNITS),
    };
    if (
      change < this.thresholds.targetChangeMetres ||
      remaining < this.thresholds.targetRemainingMetres ||
      angleBetween(previousVector, currentVector) < this.thresholds.targetReversalAngleRadians
    ) return;
    const turns = (this._targetTurns.get(id) || []).filter(
      (turn) => time - turn.t <= this.thresholds.targetChurnWindowSeconds
    );
    turns.push({ t: time, from: previousTarget, to: currentTarget });
    this._targetTurns.set(id, turns);
    if (turns.length < this.thresholds.targetChurnCount) return;
    this._addIncident(
      MOTION_INCIDENT_TYPES.PLAYER_TARGET_CHURN,
      "warning",
      time,
      {
        entityId: id,
        team: player.team,
        changes: turns.length,
        windowSeconds: this.thresholds.targetChurnWindowSeconds,
        from: { x: previousTarget.x, y: previousTarget.y },
        to: { x: currentTarget.x, y: currentTarget.y },
        fromSource: previousTarget.source,
        toSource: currentTarget.source,
        changeTimes: turns.map((turn) => round(turn.t, 2)),
      },
      id,
      this.thresholds.targetChurnWindowSeconds
    );
    this._targetTurns.set(id, []);
  }

  _analyzeSupportTargets(frame, boundary) {
    if (boundary) {
      this._supportCrowdingSince.clear();
      return;
    }
    const players = frame.players.filter((player) =>
      !player.sentOff &&
      player.fsm === "support" &&
      player.movementTarget &&
      player.movementTarget.ownerId
    );
    const active = new Set();
    for (let left = 0; left < players.length; left++) {
      for (let right = left + 1; right < players.length; right++) {
        const a = players[left];
        const b = players[right];
        if (
          a.team !== b.team ||
          a.movementTarget.ownerId !== b.movementTarget.ownerId
        ) continue;
        const gap = pointDistanceMetres(a.movementTarget, b.movementTarget);
        if (gap >= this.thresholds.supportTargetGapMetres) continue;
        const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        const key = `${a.movementTarget.ownerId}:${a.shapePhase || "phase"}:${pair}`;
        active.add(key);
        const since = this._supportCrowdingSince.get(key) ?? frame.t;
        this._supportCrowdingSince.set(key, since);
        const lastReported = this._supportCrowdingReportedAt.get(key) ?? -Infinity;
        if (
          frame.t - since >= this.thresholds.supportTargetCrowdingSeconds &&
          frame.t - lastReported >= 1.5
        ) {
          this._addIncident(
            MOTION_INCIDENT_TYPES.SUPPORT_TARGET_CROWDING,
            "warning",
            frame.t,
            {
              entityId: pair,
              playerIds: [a.id, b.id],
              ownerId: a.movementTarget.ownerId,
              gapMetres: round(gap, 2),
              durationSeconds: round(frame.t - since, 2),
              sources: [a.movementTarget.source, b.movementTarget.source],
            },
            key,
            1.5
          );
          this._supportCrowdingReportedAt.set(key, frame.t);
        }
      }
    }
    for (const key of this._supportCrowdingSince.keys()) {
      if (!active.has(key)) this._supportCrowdingSince.delete(key);
    }
  }

  _analyzeOwnerGap(frame, players, boundary) {
    if (boundary || !frame.ball?.owner) return;
    // During first-touch control the receiver is the logical owner while the
    // incoming ball is still travelling toward the contact point.
    if (!["held", "penalty"].includes(frame.ball.state)) return;
    const owner = players.get(frame.ball.owner);
    if (!owner) return;
    const gap = pointDistanceMetres(owner, frame.ball);
    if (gap > this.thresholds.ownerBallGapMetres) {
      this._addIncident(
        MOTION_INCIDENT_TYPES.OWNER_BALL_GAP,
        "severe",
        frame.t,
        { entityId: owner.id, team: owner.team, role: owner.role, gapMetres: round(gap, 2), ballState: frame.ball.state },
        owner.id
      );
    }
  }

  _analyzeOverlaps(frame, boundary) {
    if (boundary) {
      this._overlapSince.clear();
      return;
    }
    const players = frame.players.filter((player) => !player.sentOff);
    const active = new Set();
    for (let left = 0; left < players.length; left++) {
      for (let right = left + 1; right < players.length; right++) {
        const a = players[left];
        const b = players[right];
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        const distance = pointDistanceMetres(a, b);
        if (distance >= this.thresholds.overlapMetres) continue;
        active.add(key);
        const since = this._overlapSince.get(key) ?? frame.t;
        this._overlapSince.set(key, since);
        const lastReported = this._overlapReportedAt.get(key) ?? -Infinity;
        if (
          frame.t - since >= this.thresholds.overlapSeconds &&
          frame.t - lastReported >= 1.5
        ) {
          this._addIncident(
            MOTION_INCIDENT_TYPES.PLAYER_OVERLAP,
            "warning",
            frame.t,
            { entityId: key, playerIds: [a.id, b.id], distanceMetres: round(distance, 2), durationSeconds: round(frame.t - since, 2) },
            key,
            1.5
          );
          this._overlapReportedAt.set(key, frame.t);
        }
      }
    }
    for (const key of this._overlapSince.keys()) {
      if (!active.has(key)) this._overlapSince.delete(key);
    }
  }

  _analyzeDisplay(record) {
    const engine = record.engine;
    const display = record.display;
    if (!display?.players?.length || engine.motionContext?.discontinuity) return;
    const displayPlayers = playerMap(display);
    for (const player of engine.players) {
      const rendered = displayPlayers.get(player.id);
      if (!rendered) continue;
      const gap = pointDistanceMetres(player, rendered);
      if (gap > this.thresholds.displayPlayerGapMetres) {
        this._addIncident(
          MOTION_INCIDENT_TYPES.DISPLAY_DIVERGENCE,
          "warning",
          engine.t,
          { entityId: player.id, team: player.team, gapMetres: round(gap, 2), subject: "player" },
          `player:${player.id}`
        );
      }
    }
    const ballGap = pointDistanceMetres(engine.ball, display.ball);
    if (ballGap > this.thresholds.displayBallGapMetres) {
      this._addIncident(
        MOTION_INCIDENT_TYPES.DISPLAY_DIVERGENCE,
        "warning",
        engine.t,
        { entityId: "ball", gapMetres: round(ballGap, 2), subject: "ball" },
        "ball"
      );
    }
  }

  captureClip(options = {}) {
    const first = this.frames[0];
    const last = this.frames[this.frames.length - 1];
    return {
      kind: "vcfm-motion-clip",
      version: MOTION_DIAGNOSTIC_VERSION,
      reason: options.reason || "manual",
      createdAt: options.createdAt || new Date().toISOString(),
      metadata: {
        ...this.metadata,
        ...(options.metadata || {}),
      },
      range: {
        from: first?.t ?? null,
        to: last?.t ?? null,
        durationSeconds: first && last ? round(last.t - first.t, 2) : 0,
      },
      thresholds: { ...this.thresholds },
      summary: this.status(),
      incidents: this.incidents.map((incident) => ({ ...incident })),
      frames: this.frames.map((frame) => ({
        t: frame.t,
        engine: frame.engine,
        display: frame.display,
        source: frame.source,
        context: { ...frame.context },
      })),
    };
  }

  auditSummary() {
    const byType = {};
    for (const incident of this.history) byType[incident.type] = (byType[incident.type] || 0) + 1;
    return {
      framesSampled: this.frames.length,
      totalIncidents: this.history.length,
      severe: this.history.filter((incident) => incident.severity === "severe").length,
      warnings: this.history.filter((incident) => incident.severity === "warning").length,
      byType,
      incidents: this.history.map((incident) => ({ ...incident })),
    };
  }
}

export function analyzeMotionFrames(frames = [], options = {}) {
  const monitor = new MotionIntegrityMonitor(options);
  for (const frame of frames) monitor.record(frame, frame, { label: "audit" });
  return monitor.captureClip({ reason: "audit", createdAt: options.createdAt || "audit" });
}
