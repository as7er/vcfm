/** Collective defensive coordination derived only from public tactical and spatial facts. */

export const PRESS_TRIGGER_KINDS = Object.freeze({
  COUNTER_PRESS: "counter-press",
  TRANSITION_DELAY: "transition-delay",
  REGROUP: "regroup",
  POOR_TOUCH: "poor-touch",
  TOUCHLINE: "touchline-trap",
  BACKWARD_FACING: "backward-facing",
  DEEP_THREAT: "deep-threat",
  HIGH_PRESS: "high-press",
  PROXIMITY: "proximity",
  CONTAIN: "contain",
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function level(tactics, key, fallback = 3) {
  return clamp(tactics?.[key] ?? fallback, 1, 5);
}

function angleDelta(a, b) {
  let delta = (Number(b) || 0) - (Number(a) || 0);
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function collectiveDefenseProfile(tactics = {}) {
  const pressing = level(tactics, "pressing");
  const width = level(tactics, "width");
  const defensiveLine = level(tactics, "defensiveLine");
  const style = tactics.style || "balanced";
  const counterPress = pressing >= 4 && style !== "defend";
  const regroup = style === "defend" || pressing <= 2;
  // 2026-09-22 记录：**试过**让「反击」也 regroup（丢球后回收、不就地反抢），**已撤回**。
  // 理由两条：一是它推翻 scripts/team-shapes-audit.mjs:75 的既有钉定断言
  // （counter + pressing>=4 必须 counterPress=true），说明该行为是有意设计；
  // 二是实测效果在噪声内（反击的穿透球占比 0.0691±0.0226 → 0.0782±0.0206，约 0.43σ）。
  // 若将来要做，先定方向再动：引擎里「反击」目前只有"转换期猛冲"，
  // 没有"防守深"那一半（_defLineY 不读 style）。

  return Object.freeze({
    version: 1,
    pressing,
    counterPress,
    regroup,
    triggerDistanceMetres: clamp(11.5 + (pressing - 3) * 2.2, 7.5, 16.5),
    touchlineTrapMetres: clamp(8 + (pressing - 3) * 1.1, 5.8, 10.5),
    counterPressRadiusMetres: clamp(10.5 + pressing * 1.65, 12, 19),
    counterPressUnit: pressing >= 5 ? 5 : pressing >= 4 ? 4 : 2,
    markingDistanceMetres: clamp(13 + (defensiveLine - 3) * 1.1 + (pressing - 3) * 0.7, 10, 17),
    markingCount: pressing >= 4 ? 2 : 1,
    handoffMarginMetres: clamp(2.6 - (pressing - 3) * 0.15, 2.1, 3.1),
    weakSideSqueeze: clamp(
      0.055 + (3 - width) * 0.02 + (pressing >= 4 ? 0.015 : 0),
      0.025,
      0.11
    ),
    flankCoverInsideMetres: clamp(7.5 + (3 - width) * 0.7, 6, 9),
    recoveryDepthMetres: clamp(7.5 + (3 - pressing) * 0.8 + (regroup ? 1.5 : 0), 5.5, 10.5),
  });
}

export function pressingTrigger({
  tactics = {},
  phase = "out-of-possession",
  ballX = 50,
  ballY = 50,
  ownGoalY = 100,
  ownerHeading = 0,
  ownerAttackDirection = -1,
  ownerControlPhase = "settled",
  ballState = "held",
  nearestDistanceMetres = Infinity,
} = {}) {
  const profile = collectiveDefenseProfile(tactics);
  const transition = phase === "defensive-transition";
  const touchlineDistance = Math.min(clamp(ballX, 0, 100), 100 - clamp(ballX, 0, 100)) * 0.68;
  const goalDistance = Math.abs((Number(ballY) || 0) - (Number(ownGoalY) || 0)) * 1.05;
  const attackHeading = ownerAttackDirection < 0 ? -Math.PI / 2 : Math.PI / 2;
  const facingProgress = Math.cos(angleDelta(ownerHeading, attackHeading));
  const poorTouch = ballState === "control" || ownerControlPhase === "first-touch" || ownerControlPhase === "miscontrol";

  if (transition && profile.regroup) {
    return Object.freeze({ active: false, kind: PRESS_TRIGGER_KINDS.REGROUP, urgency: 0, profile });
  }
  if (
    transition &&
    profile.counterPress &&
    nearestDistanceMetres <= profile.counterPressRadiusMetres
  ) {
    return Object.freeze({ active: true, kind: PRESS_TRIGGER_KINDS.COUNTER_PRESS, urgency: 1, profile });
  }
  if (
    transition &&
    nearestDistanceMetres <= profile.counterPressRadiusMetres * 0.72
  ) {
    return Object.freeze({ active: true, kind: PRESS_TRIGGER_KINDS.TRANSITION_DELAY, urgency: 0.72, profile });
  }
  if (poorTouch && nearestDistanceMetres <= profile.triggerDistanceMetres + 4) {
    return Object.freeze({ active: true, kind: PRESS_TRIGGER_KINDS.POOR_TOUCH, urgency: 0.92, profile });
  }
  if (
    touchlineDistance <= profile.touchlineTrapMetres &&
    nearestDistanceMetres <= profile.triggerDistanceMetres + 3
  ) {
    return Object.freeze({ active: true, kind: PRESS_TRIGGER_KINDS.TOUCHLINE, urgency: 0.84, profile });
  }
  if (facingProgress < -0.2 && nearestDistanceMetres <= profile.triggerDistanceMetres + 2) {
    return Object.freeze({ active: true, kind: PRESS_TRIGGER_KINDS.BACKWARD_FACING, urgency: 0.78, profile });
  }
  if (goalDistance <= 34 + (profile.pressing - 3) * 2.5) {
    return Object.freeze({ active: true, kind: PRESS_TRIGGER_KINDS.DEEP_THREAT, urgency: 0.88, profile });
  }
  if (profile.pressing >= 4 && nearestDistanceMetres <= profile.triggerDistanceMetres + 5) {
    return Object.freeze({ active: true, kind: PRESS_TRIGGER_KINDS.HIGH_PRESS, urgency: 0.76, profile });
  }
  if (profile.pressing >= 3 && nearestDistanceMetres <= profile.triggerDistanceMetres) {
    return Object.freeze({ active: true, kind: PRESS_TRIGGER_KINDS.PROXIMITY, urgency: 0.62, profile });
  }
  return Object.freeze({ active: false, kind: PRESS_TRIGGER_KINDS.CONTAIN, urgency: 0.35, profile });
}

export function shouldHandoffMark({
  currentDistanceMetres = Infinity,
  bestDistanceMetres = Infinity,
  currentMarking = 0.5,
  currentDecisions = 0.5,
  profile = collectiveDefenseProfile(),
} = {}) {
  const awareness = clamp((Number(currentMarking) + Number(currentDecisions)) / 2, 0, 1);
  const margin = profile.handoffMarginMetres + (1 - awareness) * 0.9;
  return bestDistanceMetres + margin < currentDistanceMetres;
}

export function defensiveAwarenessProfile(attrs = {}) {
  const marking = clamp(attrs.marking ?? 0.5, 0, 1);
  const positioning = clamp(attrs.positioning ?? 0.5, 0, 1);
  const decisions = clamp(attrs.decisions ?? 0.5, 0, 1);
  const awareness = (marking + positioning + decisions) / 3;
  return Object.freeze({
    awareness,
    standoffMultiplier: clamp(1.12 - awareness * 0.2, 0.94, 1.06),
    markWeightAdjustment: clamp((awareness - 0.55) * 0.18, -0.05, 0.06),
  });
}

export function weakSideTargetX({ baseX = 50, ballX = 50, profile = collectiveDefenseProfile() } = {}) {
  const side = Math.sign((Number(ballX) || 50) - 50);
  const weakSide = side !== 0 && Math.sign((Number(baseX) || 50) - 50) === -side;
  if (!weakSide) return clamp(baseX, 3, 97);
  return clamp(baseX + (50 - baseX) * profile.weakSideSqueeze, 3, 97);
}
