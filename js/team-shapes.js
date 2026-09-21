/** Team shape phases derived from the existing public tactical instructions. */

import { FORMATIONS } from "./data.js";

export const TEAM_SHAPE_PHASES = Object.freeze({
  IN_POSSESSION: "in-possession",
  OUT_OF_POSSESSION: "out-of-possession",
  ATTACKING_TRANSITION: "attacking-transition",
  DEFENSIVE_TRANSITION: "defensive-transition",
});

const shapeSlotMapCache = new Map();

function isAttackingPhase(phase) {
  return phase === TEAM_SHAPE_PHASES.IN_POSSESSION ||
    phase === TEAM_SHAPE_PHASES.ATTACKING_TRANSITION;
}

export function explicitShapeFormationId(tactics = {}, phase = TEAM_SHAPE_PHASES.IN_POSSESSION) {
  const configured = isAttackingPhase(phase)
    ? tactics.possessionFormation
    : tactics.outOfPossessionFormation;
  return typeof configured === "string" && FORMATIONS[configured] ? configured : null;
}

export function shapeFormationId(tactics = {}, phase = TEAM_SHAPE_PHASES.IN_POSSESSION) {
  const fallback = typeof tactics.formation === "string" && FORMATIONS[tactics.formation]
    ? tactics.formation
    : "4-3-3";
  return explicitShapeFormationId(tactics, phase) || fallback;
}

/**
 * Match the base XI slots to another formation without crossing the whole team.
 * The result maps each base slot index to one target slot index.
 */
export function shapeFormationSlotMap(baseFormationId, targetFormationId) {
  const baseId = FORMATIONS[baseFormationId] ? baseFormationId : "4-3-3";
  const targetId = FORMATIONS[targetFormationId] ? targetFormationId : baseId;
  const cacheKey = `${baseId}>${targetId}`;
  if (shapeSlotMapCache.has(cacheKey)) return shapeSlotMapCache.get(cacheKey);

  const baseSlots = FORMATIONS[baseId].slots || [];
  const targetSlots = FORMATIONS[targetId].slots || [];
  const count = Math.min(baseSlots.length, targetSlots.length);
  const result = Array.from({ length: count }, (_, index) => index);
  if (count <= 1 || baseId === targetId) {
    const frozen = Object.freeze(result);
    shapeSlotMapCache.set(cacheKey, frozen);
    return frozen;
  }

  // All current formations contain one goalkeeper at index 0. Keep that identity
  // fixed and solve the ten outfield assignments with a small bitmask DP.
  const baseIndexes = Array.from({ length: count - 1 }, (_, index) => index + 1);
  const targetIndexes = Array.from({ length: count - 1 }, (_, index) => index + 1);
  const roleRank = { GK: 0, DEF: 1, MID: 2, ATT: 3 };
  const memo = new Map();
  const solve = (baseOffset, usedMask) => {
    if (baseOffset >= baseIndexes.length) return { cost: 0, targets: [] };
    const key = `${baseOffset}:${usedMask}`;
    if (memo.has(key)) return memo.get(key);
    const source = baseSlots[baseIndexes[baseOffset]];
    let best = null;
    for (let targetOffset = 0; targetOffset < targetIndexes.length; targetOffset++) {
      const bit = 1 << targetOffset;
      if (usedMask & bit) continue;
      const targetIndex = targetIndexes[targetOffset];
      const target = targetSlots[targetIndex];
      const dx = (Number(source.x) || 50) - (Number(target.x) || 50);
      const dy = (Number(source.y) || 50) - (Number(target.y) || 50);
      const roleDistance = Math.abs((roleRank[source.pos] ?? 2) - (roleRank[target.pos] ?? 2));
      const tail = solve(baseOffset + 1, usedMask | bit);
      const candidate = {
        cost: dx * dx + dy * dy + roleDistance * roleDistance * 90 + tail.cost,
        targets: [targetIndex, ...tail.targets],
      };
      if (!best || candidate.cost < best.cost - 1e-9) best = candidate;
    }
    memo.set(key, best);
    return best;
  };

  const assignment = solve(0, 0)?.targets || [];
  for (let index = 0; index < assignment.length; index++) {
    result[baseIndexes[index]] = assignment[index];
  }
  const frozen = Object.freeze(result);
  shapeSlotMapCache.set(cacheKey, frozen);
  return frozen;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function level(tactics, key, fallback = 3) {
  return clamp(tactics?.[key] ?? fallback, 1, 5);
}

/**
 * Geometry and transition timing only. These values never change ability,
 * action success, xG, score, or any other result after the spatial fact.
 */
export function teamShapeProfile(tactics = {}) {
  const style = tactics.style || "balanced";
  const pressing = level(tactics, "pressing");
  const tempo = level(tactics, "tempo");
  const width = level(tactics, "width");

  // ⚠ 2026-09-22：「反击」的**持球期**纵深层试过改成 −2.5（与 defend 同档），
  //   实测被推翻：穿透球占比不升反降（0.0691 → 0.0275）。
  //   原因是这个 `depthShift` 作用在**持球期**，全队压深 2.5 格后
  //   前插的跑动者反而越不过越位线 ⇒ `advance > 0.20` 门槛失效。
  //   ⇒ 反击的「深」应该体现在**丢球后回收**（见下面 `regroup`），不是持球期压深。
  //   （原值 0 保持不变；行保留是因为它现在是「反击」语义的唯一入口。）
  const styleAttackDepth =
    style === "attack" ? 3 :
      style === "counter" ? 0 :
        style === "defend" ? -2.5 :
          style === "possession" ? -1 : 0;
  const styleWidth =
    style === "attack" ? 0.03 :
      style === "possession" ? -0.04 :
        style === "counter" ? -0.02 : 0;
  const supportPull =
    style === "possession" ? 0.16 :
      style === "defend" ? 0.1 :
        style === "balanced" ? 0.06 : 0.03;

  const counterPress = pressing >= 4 && style !== "defend";
  // ⚠ 2026-09-22：**试过**让「反击」也 regroup，**已撤回**（与 `collective-defense.js`
  //   同一处、同一理由）：① 推翻 `team-shapes-audit.mjs:75` 的既有钉定断言；
  //   ② 实测穿透球占比只从 0.0691±0.0226 变到 0.0782±0.0206（≈0.43σ，噪声内）。
  //   ⇒ 留作待拍板的问题：引擎里「反击」只有"转换期猛冲"、没有"防守深"那一半。
  const regroup = style === "defend" || pressing <= 2;

  return Object.freeze({
    version: 1,
    inPossession: Object.freeze({
      widthMul: clamp(1 + (width - 3) * 0.09 + styleWidth, 0.78, 1.2),
      depthShift: styleAttackDepth,
      supportPull,
    }),
    outOfPossession: Object.freeze({
      widthMul: clamp(
        1 + (width - 3) * 0.04 + (pressing >= 4 ? 0.015 : pressing <= 2 ? -0.02 : 0),
        0.88,
        1.08
      ),
    }),
    transition: Object.freeze({
      attackSeconds: clamp(
        4.7 + (tempo - 3) * 0.55 + (style === "counter" ? 2.1 : style === "attack" ? 0.8 : style === "possession" ? -0.8 : 0),
        2.8,
        8.8
      ),
      defendSeconds: clamp(
        3.2 + (pressing - 3) * 0.45 + (counterPress ? 0.5 : 0) + (regroup ? -0.3 : 0),
        2.2,
        6.5
      ),
      attackDepthShift:
        style === "counter" ? 4 :
          style === "attack" ? 3 :
            style === "possession" ? -1 :
              style === "defend" ? -2.5 : 0,
      attackWidthMul: clamp(
        1 + (width - 3) * 0.06 + (style === "counter" ? -0.05 : style === "attack" ? 0.04 : 0),
        0.82,
        1.16
      ),
      counterPress,
      regroup,
    }),
  });
}

export function teamShapePhase({
  team,
  controlTeam,
  now = 0,
  gainedAt = 0,
  lostAt = 0,
  tactics = {},
} = {}) {
  const profile = teamShapeProfile(tactics);
  if (controlTeam === team) {
    return now - gainedAt < profile.transition.attackSeconds
      ? TEAM_SHAPE_PHASES.ATTACKING_TRANSITION
      : TEAM_SHAPE_PHASES.IN_POSSESSION;
  }
  return now - lostAt < profile.transition.defendSeconds
    ? TEAM_SHAPE_PHASES.DEFENSIVE_TRANSITION
    : TEAM_SHAPE_PHASES.OUT_OF_POSSESSION;
}

function widthLabel(multiplier, lang) {
  if (multiplier >= 1.07) return lang === "en" ? "wide occupation" : "宽位占位";
  if (multiplier <= 0.91) return lang === "en" ? "compact occupation" : "紧凑占位";
  return lang === "en" ? "balanced occupation" : "均衡占位";
}

function blockLabel(tactics, lang) {
  const line = level(tactics, "defensiveLine");
  const pressing = level(tactics, "pressing");
  if (line >= 4 && pressing >= 4) return lang === "en" ? "high compact block" : "高位紧凑防守";
  if (line <= 2) return lang === "en" ? "deep compact block" : "低位紧凑防守";
  return lang === "en" ? "mid-block" : "中位防守块";
}

export function teamShapeSummary(tactics = {}, lang = "zh") {
  const profile = teamShapeProfile(tactics);
  const possessionFormation = shapeFormationId(tactics, TEAM_SHAPE_PHASES.IN_POSSESSION);
  const outOfPossessionFormation = shapeFormationId(tactics, TEAM_SHAPE_PHASES.OUT_OF_POSSESSION);
  const transition = profile.transition.counterPress
    ? (lang === "en" ? "counter-press after losing it" : "丢球后就地反抢")
    : profile.transition.regroup
      ? (lang === "en" ? "regroup after losing it" : "丢球后优先回收")
      : (lang === "en" ? "balanced recovery" : "平衡反抢与回收");
  const attackTransition = tactics.style === "counter"
    ? (lang === "en" ? "fast vertical counter" : "得球后快速纵向反击")
    : (lang === "en" ? "controlled expansion" : "得球后有序展开");

  return [
    {
      key: TEAM_SHAPE_PHASES.IN_POSSESSION,
      title: lang === "en" ? "In possession" : "持球形态",
      detail: `${possessionFormation} · ${widthLabel(profile.inPossession.widthMul, lang)} · ${attackTransition}`,
    },
    {
      key: TEAM_SHAPE_PHASES.OUT_OF_POSSESSION,
      title: lang === "en" ? "Out of possession" : "无球形态",
      detail: `${outOfPossessionFormation} · ${blockLabel(tactics, lang)}`,
    },
    {
      key: "transition",
      title: lang === "en" ? "Transitions" : "攻防转换",
      detail: `${transition} · ${possessionFormation} → ${outOfPossessionFormation}`,
    },
  ];
}
