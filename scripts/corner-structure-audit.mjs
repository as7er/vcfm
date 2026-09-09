/**
 * 角球结构审计：把「角球画面对不对」变成可回归的断言。
 *
 * 背景（AGENTS.md「🅰️ 角球真实参照值总表」第五、六节）：角球的**数量与威胁**都只有真实的
 * 一半左右（每队每场 3.02 vs 真实 5.14；每个角球进球 2.15% vs 4.1%），而**摆位**与现实
 * 差十处——最刺眼的是真实争点区（小禁区 0~5.5m 与第二个六码区 5.5~11m）**两边一个人都没有**，
 * 以及所有人在 `cornerShapeUntil` 的 2.15 秒里被冻住、球被吊进一张静止画面。
 *
 * 现有 `set-piece-presentation-audit.mjs` 只断言角球站位不重叠，而且那条断言
 * **直接对坐标取 `Math.hypot` 再和 3.3 比**——正是该文件为点球部分修掉的混单位写法
 * （x 一格 0.68m、y 一格 1.05m）。本审计的最小间距一律先换算成米。
 *
 * 断言分两级，沿用 `offside-event-integrity-audit.mjs` 立下的规矩：
 *   **硬失败**：现在就成立的结构不变量（不重叠、主罚者在角弧、Law 17 的 9.15m、
 *     全员在场内、每个角球恰好一名主罚者）。它们防的是回归。
 *   **只告警**：还没修的还原度缺口（小禁区无人、门柱无人、无人留守、门将站太出、
 *     开球时无人跑动、落点分区）。**成因未修，让它们硬失败会立刻挡住所有无关改动。**
 *
 * 口径：与 `box-possession-sampling-audit.mjs` 同种子（372000..）、同 4-3-3 能力 15 阵容、
 * 标准档、0.1s 步长。属性表额外含 `crossing`（角球开球质量读它）。
 * 全程只读引擎公开状态，不消费随机数，同种子下开关本审计不改变比分。
 *
 * 用法：node scripts/corner-structure-audit.mjs [场数=6]
 */
import assert from "node:assert/strict";
import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(4, Number(process.argv[2]) || 6);
const timeStep = SIM.DT;
const seeds = Array.from({ length: matches }, (_, i) => 372000 + i);

const MX = SIM.PITCH_W_METRES / SIM.FIELD_W; // 0.68 m / 格
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05 m / 格

// 真实球场尺寸（米）与真实参照值，出处见 AGENTS.md「🅰️ 角球真实参照值总表」
const SIX_YARD = 5.5;        // 小禁区纵深
const SECOND_SIX = 11;       // 「第二个六码区」外沿，也是点球点
const PEN_AREA = 16.5;       // 大禁区纵深
const POST = 3.66;           // 门柱横向偏移
const LAW17 = 9.15;          // 角球开出前防守方须退开的距离
/** 开球后用于量「有没有人抢点跑动」的窗口：主罚暂停 1.6s + 飞行，取 2.5s */
const RUN_WINDOW = 2.5;

function makeClub(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const id = `${name}-p${index}`;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
    ]) {
      attrs[key] = rating;
    }
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((player) => player.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      style: "balanced",
    },
  };
}

function seededRandom(seed) {
  let v = seed >>> 0;
  return () => {
    v += 0x6d2b79f5;
    let n = v;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

const median = (v) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};
const mean = (v) => (v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)) : 0);
const pct = (n, d) => Number(((n / Math.max(1, d)) * 100).toFixed(1));

/** 一次角球的结构快照 */
function snapshot(engine, attTeam) {
  const goalY = engine.targetGoalY(attTeam);
  const b = engine.ball;
  const depth = (a) => Math.abs(a.y - goalY) * MY;      // 距被攻球门线（米）
  const lateral = (a) => (a.x - 50) * MX;               // 距球门中线（米，带符号）
  const outfield = (team) =>
    engine.agents.filter((a) => a.team === team && a.role !== "GK" && !a.sentOff);
  const defTeam = attTeam === "home" ? "away" : "home";
  const att = outfield(attTeam);
  const def = outfield(defTeam);

  // 主罚者 = 进攻方里离球最近的那个（`_restart` 把他放到角旗旁）
  let taker = null;
  let takerD = Infinity;
  for (const a of att) {
    const d = Math.hypot((a.x - b.x) * MX, (a.y - b.y) * MY);
    if (d < takerD) {
      takerD = d;
      taker = a;
    }
  }

  const zone = (list) => {
    const z = { six: 0, secondSix: 0, restOfBox: 0, edge: 0, middle: 0, ownHalf: 0 };
    for (const a of list) {
      const d = depth(a);
      if (d < SIX_YARD) z.six++;
      else if (d < SECOND_SIX) z.secondSix++;
      else if (d < PEN_AREA) z.restOfBox++;
      else if (d < 25) z.edge++;
      else if (d < SIM.PITCH_H_METRES / 2) z.middle++;
      else z.ownHalf++;
    }
    return z;
  };

  // 门柱上的人：距门线 ≤1.5m 且横向落在柱子 ±2m 内
  const onPost = (list) =>
    list.filter((a) => depth(a) <= 1.5 && Math.abs(Math.abs(lateral(a)) - POST) <= 2).length;

  // 「比全部防守者都更靠球门」的进攻者数（现实里盯人应在球门侧）
  const defDepths = def.map(depth);
  const minDefDepth = defDepths.length ? Math.min(...defDepths) : Infinity;
  const goalSideOfAll = att.filter((a) => a !== taker && depth(a) < minDefDepth).length;

  // Law 17：开出前防守方须距球 9.15m 以上
  let nearestDefToBall = Infinity;
  for (const a of def) {
    nearestDefToBall = Math.min(
      nearestDefToBall,
      Math.hypot((a.x - b.x) * MX, (a.y - b.y) * MY)
    );
  }

  // 最小两人间距（米）——修掉 set-piece-presentation-audit 那条混单位写法
  const all = engine.agents.filter((a) => !a.sentOff);
  let minPair = Infinity;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      minPair = Math.min(
        minPair,
        Math.hypot((all[i].x - all[j].x) * MX, (all[i].y - all[j].y) * MY)
      );
    }
  }

  const gk = engine.agents.find((a) => a.team === defTeam && a.role === "GK" && !a.sentOff);
  const halfway = SIM.PITCH_H_METRES / 2;

  return {
    attTeam,
    takerId: taker?.id ?? null,
    takerDistToBall: Number(takerD.toFixed(2)),
    attZone: zone(att.filter((a) => a !== taker)),
    defZone: zone(def),
    attPost: onPost(att),
    defPost: onPost(def),
    goalSideOfAll,
    attInBox: att.filter((a) => a !== taker && depth(a) < PEN_AREA).length,
    defInBox: def.filter((a) => depth(a) < PEN_AREA).length,
    attMeanBoxDepth: mean(att.filter((a) => a !== taker && depth(a) < PEN_AREA).map(depth)),
    defMeanBoxDepth: mean(def.filter((a) => depth(a) < PEN_AREA).map(depth)),
    attHeldBack: att.filter((a) => depth(a) > halfway).length,
    defPushedUp: def.filter((a) => depth(a) > halfway).length,
    nearestDefToBall: Number(nearestDefToBall.toFixed(2)),
    minPair: Number(minPair.toFixed(2)),
    gkDepth: gk ? Number((Math.abs(gk.y - goalY) * MY).toFixed(2)) : null,
    gkLateral: gk ? Number(((gk.x - 50) * MX).toFixed(2)) : null,
    startPositions: att
      .filter((a) => a !== taker)
      .map((a) => ({ id: a.id, x: a.x, y: a.y })),
    goalY,
  };
}

export function runCornerSample(seedList) {
  const corners = [];
  let cleared = 0;
  for (const seed of seedList) {
    const restore = Math.random;
    Math.random = seededRandom(seed);
    try {
      const engine = new SimEngine(makeClub(`h${seed}`, 15), makeClub(`a${seed}`, 15), {
        simulationProfile: "standard",
        timeStep,
        separationPasses: 8,
      });
      const steps = Math.round((90 * 60) / timeStep);
      let prevState = null;
      let pending = null; // 正在跟踪的这次角球
      for (let s = 0; s < steps; s++) {
        engine.step(timeStep);
        const state = engine.ball.state;

        // 新摆好一次角球：`ball.state` 刚切进 "corner"
        // ⚠ **不要用 `cornerShapeUntil` 检测角球**：`engine.js:6577` 让人墙任意球
        //   复用同一个字段（`t + 2.6`），按它触发会把任意球当成角球——
        //   第一版这么写，量出「站位重叠 1.02m」「Law 17 只剩 1.57m」两个假缺陷，
        //   与 `_restart` 对账才发现触发点落在 `type: "freekick"` 上。
        if (state === "corner" && prevState !== "corner") {
          const attTeam = engine.ball.kickTeam;
          if (attTeam === "home" || attTeam === "away") {
            pending = {
              ...snapshot(engine, attTeam),
              stagedAt: engine.t,
              delivery: null,
              moved: null,
            };
          }
        }
        prevState = state;

        if (!pending) continue;

        // 落点：主罚者出球那一刻球的目标点
        if (
          pending.delivery == null &&
          engine.ball.state === "pass" &&
          engine.ball.kickTeam === pending.attTeam &&
          Number.isFinite(engine.ball.targetY)
        ) {
          pending.delivery = {
            depth: Number((Math.abs(engine.ball.targetY - pending.goalY) * MY).toFixed(2)),
            lateral: Number(((engine.ball.targetX - 50) * MX).toFixed(2)),
          };
        }

        // 抢点跑动：从摆位到 +RUN_WINDOW 秒，各人走了多少米
        if (engine.t - pending.stagedAt >= RUN_WINDOW) {
          const byId = new Map(engine.agents.map((a) => [a.id, a]));
          const moved = pending.startPositions.map((p) => {
            const now = byId.get(p.id);
            if (!now) return 0;
            return Math.hypot((now.x - p.x) * MX, (now.y - p.y) * MY);
          });
          pending.moved = {
            median: median(moved),
            max: Number(Math.max(0, ...moved).toFixed(2)),
            overFiveMetres: moved.filter((d) => d >= 5).length,
          };
          delete pending.startPositions;
          corners.push(pending);
          pending = null;
        }
      }
      if (pending) cleared++;
      // 死球未结算的那次不计入统计，但要记下来免得样本莫名变少
    } finally {
      Math.random = restore;
    }
  }
  return { corners, unfinished: cleared };
}

const { corners, unfinished } = runCornerSample(seeds);
const n = corners.length;
const sumZone = (key, side) => {
  const out = { six: 0, secondSix: 0, restOfBox: 0, edge: 0, middle: 0, ownHalf: 0 };
  for (const c of corners) for (const k of Object.keys(out)) out[k] += c[side][k];
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Number((v / Math.max(1, n)).toFixed(2))]));
};

const report = {
  matches: seeds.length,
  seeds: { first: seeds[0], last: seeds[seeds.length - 1] },
  cornersSampled: n,
  cornersPerMatch: Number((n / seeds.length).toFixed(2)),
  unfinishedAtFullTime: unfinished,
  // 每次角球平均有几人在各深度带（进攻方不含主罚者）
  attackersByZone: sumZone("attZone", "attZone"),
  defendersByZone: sumZone("defZone", "defZone"),
  attackersInBox: mean(corners.map((c) => c.attInBox)),
  defendersInBox: mean(corners.map((c) => c.defInBox)),
  attackerMeanBoxDepthM: mean(corners.map((c) => c.attMeanBoxDepth)),
  defenderMeanBoxDepthM: mean(corners.map((c) => c.defMeanBoxDepth)),
  postPlayers: { attacking: mean(corners.map((c) => c.attPost)), defending: mean(corners.map((c) => c.defPost)) },
  attackersGoalSideOfEveryDefender: mean(corners.map((c) => c.goalSideOfAll)),
  attackersHeldBackOwnHalf: mean(corners.map((c) => c.attHeldBack)),
  defendersLeftUpfield: mean(corners.map((c) => c.defPushedUp)),
  nearestDefenderToBallM: { median: median(corners.map((c) => c.nearestDefToBall)), min: Number(Math.min(...corners.map((c) => c.nearestDefToBall)).toFixed(2)) },
  takerDistanceToBallM: median(corners.map((c) => c.takerDistToBall)),
  minPairSpacingM: Number(Math.min(...corners.map((c) => c.minPair)).toFixed(2)),
  keeper: { depthM: median(corners.map((c) => c.gkDepth ?? 0)), lateralAbsM: median(corners.map((c) => Math.abs(c.gkLateral ?? 0))) },
  deliveryLandingM: (() => {
    const withDelivery = corners.filter((c) => c.delivery);
    return {
      captured: withDelivery.length,
      medianDepth: median(withDelivery.map((c) => c.delivery.depth)),
      intoSixYardPct: pct(withDelivery.filter((c) => c.delivery.depth < SIX_YARD).length, withDelivery.length),
      intoSecondSixPct: pct(withDelivery.filter((c) => c.delivery.depth >= SIX_YARD && c.delivery.depth < SECOND_SIX).length, withDelivery.length),
      beyondPenAreaPct: pct(withDelivery.filter((c) => c.delivery.depth >= PEN_AREA).length, withDelivery.length),
    };
  })(),
  runMovementM: {
    windowSeconds: RUN_WINDOW,
    medianOfMedians: median(corners.map((c) => c.moved.median)),
    medianMax: median(corners.map((c) => c.moved.max)),
    playersMovingOver5m: mean(corners.map((c) => c.moved.overFiveMetres)),
  },
};

console.log(JSON.stringify(report, null, 2));

// —— 硬失败：现在就成立的结构不变量，防回归 ——
assert.ok(n >= seeds.length, `too few corners sampled (${n}) to assert on`);
assert.ok(
  report.minPairSpacingM >= 1.6,
  `staged corner players overlap: closest pair ${report.minPairSpacingM} m (unit-correct, not raw coordinates)`
);
assert.ok(
  report.takerDistanceToBallM <= 3,
  `the corner taker must be staged at the arc, median ${report.takerDistanceToBallM} m from the ball`
);
assert.ok(
  report.nearestDefenderToBallM.min >= LAW17,
  `Law 17 breach: a defender stood ${report.nearestDefenderToBallM.min} m from the corner (needs ${LAW17} m)`
);
assert.ok(
  report.deliveryLandingM.captured >= n * 0.8,
  `delivery target went unrecorded on ${n - report.deliveryLandingM.captured} of ${n} corners`
);

// —— 还原度检查：v252 的同源摆位、准备信号与落点选择已覆盖这些缺口 ——
// 真实参照见 AGENTS.md「🅰️ 角球真实参照值总表」第四节（争点全在 0~11m）。
const warnings = [];
const warn = (cond, msg) => {
  if (cond) warnings.push(msg);
};
// 真实数据没有公布「禁区里站几个人」，所以这里只断言「争点区是空的」这个事实，
// 不给一个没来源的目标人数（AGENTS.md 的惯例：不引用无出处的数值）。
warn(
  report.attackersByZone.six < 1,
  `进攻方小禁区（0~5.5m）内平均只有 ${report.attackersByZone.six} 人，` +
    `而真实角球吊进小禁区的第一下触球是前点/中路/后点三个进球区（合计 22 球/季）`
);
warn(
  report.attackersByZone.six + report.attackersByZone.secondSix < 2,
  `进攻方在真实争点区（0~11m，小禁区 + 第二个六码区）平均只有 ${(
    report.attackersByZone.six + report.attackersByZone.secondSix
  ).toFixed(2)} 人`
);
warn(
  report.defendersByZone.six < 1,
  `防守方小禁区（0~5.5m）内平均只有 ${report.defendersByZone.six} 人，门将区无人保护`
);
warn(report.postPlayers.defending < 1, `门柱上平均只有 ${report.postPlayers.defending} 名防守者`);
warn(
  report.defenderMeanBoxDepthM > report.attackerMeanBoxDepthM,
  `盯人方向反了：防守方禁区内均深 ${report.defenderMeanBoxDepthM} m 比进攻方 ${report.attackerMeanBoxDepthM} m 更远离本方球门`
);
warn(
  report.attackersGoalSideOfEveryDefender >= 1,
  `平均 ${report.attackersGoalSideOfEveryDefender} 名进攻者比全部防守者都更靠球门（应为 0）`
);
warn(
  report.nearestDefenderToBallM.median > 15,
  `无人干扰主罚者：最近防守者中位 ${report.nearestDefenderToBallM.median} m（Law 17 只要求 ${LAW17} m，真实里那条线上有人）`
);
warn(
  report.attackersHeldBackOwnHalf < 1,
  `进攻方留守本方半场 ${report.attackersHeldBackOwnHalf} 人，真实里会留 1~2 名中卫防反`
);
warn(
  report.defendersLeftUpfield < 1,
  `防守方留在前场 ${report.defendersLeftUpfield} 人，真实里会留 1 名快马做出球点`
);
warn(
  report.keeper.depthM > 3,
  `门将离门线 ${report.keeper.depthM} m（真实角球约 1~2 m）`
);
warn(
  report.runMovementM.playersMovingOver5m < 1,
  `开球窗口（${RUN_WINDOW}s）内位移 ≥5m 的进攻者平均 ${report.runMovementM.playersMovingOver5m} 人，` +
    `位移中位 ${report.runMovementM.medianOfMedians} m——真实角球的本体是有时机的抢点跑动`
);
warn(
  report.deliveryLandingM.intoSixYardPct < 20,
  `只有 ${report.deliveryLandingM.intoSixYardPct}% 的角球吊进小禁区（真实里领先的队达 49.5%）`
);
warn(
  report.deliveryLandingM.intoSixYardPct + report.deliveryLandingM.intoSecondSixPct < 30,
  `落点在真实争点区（0~11m）的角球只有 ${(
    report.deliveryLandingM.intoSixYardPct + report.deliveryLandingM.intoSecondSixPct
  ).toFixed(1)}%，落点中位 ${report.deliveryLandingM.medianDepth} m 已在大禁区线附近，` +
    `另有 ${report.deliveryLandingM.beyondPenAreaPct}% 直接吊到禁区外`
);

if (warnings.length) {
  console.log(`\n⚠ 还原度缺口 ${warnings.length} 项（只告警，成因未修，见 AGENTS.md「🅰️ 角球真实参照值总表」）：`);
  for (const w of warnings) console.log(`  · ${w}`);
} else {
  console.log("\n✅ 角球还原度告警项全部清空");
}

assert.equal(warnings.length, 0, "corner staging, run timing and delivery zones must retain the repaired structure");

console.log(
  `\nCorner structure audit passed: ${n} staged corners over ${seeds.length} matches ` +
    `(hard invariants: spacing, taker at the arc, Law 17, delivery recorded)`
);
