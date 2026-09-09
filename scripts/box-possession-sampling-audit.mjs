/**
 * 禁区持球采样审计（真实比赛，只读观察）。
 *
 * 为什么需要它：`goalkeeper-open-goal-audit` 与 `box-defending-audit` 都是人为摆位的
 * 合成场景，只验证「摆成空门时会射」「摆成禁区持球时有人盯」，**不验证这些局面在
 * 真实比赛里出现得多频繁**。v239 的画面问题（禁区里大量空门却不射）正是从这条缝里
 * 漏过去的：两条审计全绿，而实测每场有 20.5 次「离门 10m 内且 3m 内无人防守」。
 *
 * 本审计跑固定种子的完整比赛，按固定间隔采样禁区局面，把「机会出现频率」这类只在
 * 真实比赛里才成立的量变成可回归的断言。全程只读引擎公开状态，不注入行为、不消费
 * 随机数（不调用 engine.random / Math.random），因此同种子下开关本审计不改变比分。
 *
 * 本审计的基线（标准档 6 场，种子 372000..372005）：
 *   boxSpellsPerMatch 346、boxSecondsPerMatch 1092.12、medianSpellSeconds 2.9
 *   回合结束方式 pass 74.4% / shot 3.6%
 *   unmarkedCloseChancesPerMatch 51.83，其去向 shot 3.5% / pass 67.5%
 *   pressTargetToCarrier 中位 2.27m、pressLagBehindTarget 中位 1.94m
 *   pressActualToCarrier 中位 2.52m、nearestDefenderToCarrier 中位 2.34m
 *   keeperOffLine 中位 5.97m、keeperLateralOffset 7.28m、keeperLaneDistance 2.57m
 *
 * **与 v239 定位问题时那次一次性插桩的口径不同，两组数字不可直接相减。** 那次报的是
 * 禁区持球回合 299.8 次/场、禁区内 713 秒/场、无人盯防机会 11.3 次/场；本审计同口径
 * 项目对得上（回合以传球结束 74.4% vs 77.3%、press 目标点离持球人 2.27m vs 2.36m、
 * 落后自己目标点 1.94m vs 2.09m——这三项交叉验证了仪器），但 boxSeconds 与机会次数
 * 高出不少，因为：① 本审计把两队的进攻合并计数；② 只统计 held/control 的真实持球；
 * ③ 机会用 0.5 秒滞回折叠连续帧，而非按回合去重。**要比较就用本审计自己的基线比。**
 *
 * 上界按「本审计实测基线 + 约 10% 余量」设定，作用是**防止进一步恶化**，
 * 绝不代表这些值已经真实——球在禁区内 1092 秒/场对比真实足球的 60~90 秒仍差一个量级。
 * 修禁区循环主线时应当看到 boxSeconds / boxSpells 显著下降，届时同步收紧上界。
 *
 * 后台档（`background`）同样通过：boxSeconds 1127.55、boxSpells 258.83、
 * medianSpellSeconds 3.6。回合数低于标准档是粗步长把相邻回合并成一个的结果
 * （中位回合时长相应变长），禁区总秒数两档一致，可作为交叉档位的合理性检查。
 *
 * 基线里最刺眼的一项是 `unmarkedChanceOutcomePct.shot` 只有 3.5%（传球 67.5%）。
 * 成因已定位：`_think` 的 `rangeBonus` 对近门区是反向激励（<9.5m 给 0.1，10~22m
 * 给 0.32），再叠上冷却期的 ×0.3，门前射门概率只剩约 0.05~0.07。
 *
 * **但直接放宽它已实测不可行**：完全豁免时该项升到 9.8%（画面确实改善），代价是
 * 24 场进球 3.88、破 3.3 上限；取中 0.55 仍是 3.33、照样破顶；且两个阻尼值都让
 * `box-defending-audit` 的 crowdedPairs 到 17（阈值 14、干净引擎 12）。
 * 根因是机会供给高一个量级（禁区内 1092 秒 vs 真实 60~90 秒），全队射门冷却是
 * 当前唯一压住进球的东西。**必须先降低禁区持球循环，再谈门前射门意愿。**
 * 完整标定曲线与两次负结果见 AGENTS.md v239 遗留问题 #1。
 *
 * `boxPassDestinationPct` 与 `medianAttackersInBoxAtSpellStart` 用来定位循环形态：
 * 实测 58.3% 的禁区传球目标点仍在同一禁区内，而禁区里平均只有 3 名进攻方（含持球人）。
 * 人少却仍在内部倒球——说明杠杆在传球价值评估，不在人数或跑位分布；这也排除了
 * 复活 `matchview.js` 里那条死代码软顶（`_capAttackersInBox`，≤3 且不含持球人，
 * 实测非持球者中位仅 2 名，本就在其上限之内）。
 */
import assert from "node:assert/strict";

import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(4, Number(process.argv[2]) || 6);
const simulationProfile = process.argv[3] === "background" ? "background" : "standard";
const timeStep = simulationProfile === "background" ? 0.3 : SIM.DT;
const separationPasses = simulationProfile === "background" ? 4 : 8;
// 采样间隔：0.1 秒，与 v239 定位问题时的插桩口径一致。
const SAMPLE_INTERVAL = 0.1;

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

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
      "positioning", "kicking", "decisions",
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

const METRES_X = SIM.PITCH_W_METRES / SIM.FIELD_W;
const METRES_Y = SIM.PITCH_H_METRES / SIM.FIELD_H;
const distanceMetres = (ax, ay, bx, by) =>
  Math.hypot((ax - bx) * METRES_X, (ay - by) * METRES_Y);

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const goalYFor = (team) => (team === "home" ? SIM.FIELD_H : 0);
const distanceToGoalMetres = (x, y, team) =>
  distanceMetres(x, y, Math.min(Math.max(x, SIM.GOAL_X0), SIM.GOAL_X1), goalYFor(team));

export function runBoxPossessionSample(seeds) {
  const sample = {
    matches: 0,
    boxSpells: 0,
    boxSeconds: 0,
    spellEndings: { pass: 0, shot: 0, lost: 0, cleared: 0, other: 0 },
    unmarkedCloseChances: 0,
    unmarkedShots: 0,
    unmarkedPasses: 0,
    pressTargetToCarrier: [],
    pressLagBehindTarget: [],
    pressActualToCarrier: [],
    nearestDefenderToCarrier: [],
    // 禁区回合以传球结束时，球去了哪里：目标点仍在同一禁区内 = 回收循环；
    // 出禁区 = 真的把球带离危险区。这一项决定「禁区里球出不去」的杠杆在哪：
    // 若绝大多数传球把球留在禁区内，杠杆在接球点分布（谁在禁区里等球），
    // 而不在传球选择权重。
    boxPassRecycled: 0,
    boxPassExited: 0,
    boxPassUnknown: 0,
    // 回合开始时禁区内的进攻方人数（球在禁区时有多少人可供短传）。
    attackersInBoxAtSpellStart: [],
    keeperOffLine: [],
    keeperLateralOffset: [],
    keeperLaneDistance: [],
    spellSeconds: [],
  };

  for (const seed of seeds) {
    const originalRandom = Math.random;
    Math.random = seededRandom(seed);
    let engine;
    try {
      engine = new SimEngine(
        makeClub(`home-${seed}`, 15),
        makeClub(`away-${seed}`, 15),
        { simulationProfile, timeStep, separationPasses }
      );
      const steps = Math.round((90 * 60) / timeStep);
      let nextSampleAt = 0;
      // 每次采样要记「上次采样到现在真的过了多少秒」，不能记名义间隔：
      // 后台档 timeStep 是 0.3 而 SAMPLE_INTERVAL 是 0.1，每步都会过采样闸门，
      // 若按 0.1 计时会把禁区秒数少算三倍。标准档两者都是 0.1，结果不变。
      let lastSampleAt = null;
      // 当前禁区持球回合：记录持球方与进入时刻，用于统计回合数与结束方式。
      let spell = null;
      // 「无人盯防近距离」的连续帧要折叠成一次机会。3m 是硬边界，防守者在边界附近
      // 抖动会让条件反复真假，逐帧计数会把一次机会数成十几次——因此加 0.5 秒滞回：
      // 条件必须先连续假够 0.5 秒，才允许计入新机会。
      const UNMARKED_HYSTERESIS = 0.5;
      let unmarkedOpen = false;
      let unmarkedOwnerId = null;
      let unmarkedClosedSince = -Infinity;
      // 已计入但尚未结算去向的机会（等 shot/pass 落地时归类）。
      let pendingChance = false;

      for (let step = 0; step < steps; step++) {
        engine.step(timeStep);
        if (engine.t < nextSampleAt) continue;
        nextSampleAt = engine.t + SAMPLE_INTERVAL;
        const elapsed = lastSampleAt === null ? timeStep : engine.t - lastSampleAt;
        lastSampleAt = engine.t;

        const b = engine.ball;
        const owner = b.owner ? engine.agentById(b.owner) : null;
        // 防守方 = 球所在禁区的归属方。只在有人持球时算「禁区持球回合」，
        // 飞行中的传球与射门不算持球。
        const defendingTeam = engine._inOwnFoulBox("home", b.x, b.y)
          ? "home"
          : engine._inOwnFoulBox("away", b.x, b.y)
            ? "away"
            : null;
        const attackerHasBall =
          !!owner && !!defendingTeam && owner.team !== defendingTeam &&
          (b.state === "held" || b.state === "control");

        if (attackerHasBall) {
          if (!spell || spell.team !== owner.team) {
            if (spell) {
              sample.spellEndings.other++;
              sample.spellSeconds.push(spell.seconds);
              // 换持球方也算回合结束：未结算的机会必须在这里丢弃，否则会漏进
              // 下一个回合、把去向归到不相干的射门或传球上。
              pendingChance = false;
            }
            spell = { team: owner.team, seconds: 0, defendingTeam };
            sample.boxSpells++;
            let attackersInBox = 0;
            for (const agent of engine.agents) {
              if (agent.team !== owner.team || agent.sentOff) continue;
              if (engine._inOwnFoulBox(defendingTeam, agent.x, agent.y)) attackersInBox++;
            }
            sample.attackersInBoxAtSpellStart.push(attackersInBox);
          }
          spell.seconds += elapsed;
          sample.boxSeconds += elapsed;

          // —— 无人盯防近距离机会：离门 10m 内且 3m 内无防守者 ——
          const dGoal = distanceToGoalMetres(owner.x, owner.y, defendingTeam);
          if (dGoal <= 10) {
            let nearest = Infinity;
            for (const agent of engine.agents) {
              if (agent.team !== defendingTeam) continue;
              if (agent.role === "GK" || agent.sentOff) continue;
              const d = distanceMetres(agent.x, agent.y, owner.x, owner.y);
              if (d < nearest) nearest = d;
            }
            if (Number.isFinite(nearest)) sample.nearestDefenderToCarrier.push(nearest);
            if (nearest > 3) {
              const reopened =
                !unmarkedOpen &&
                (unmarkedOwnerId !== owner.id ||
                  engine.t - unmarkedClosedSince >= UNMARKED_HYSTERESIS);
              if (reopened) {
                sample.unmarkedCloseChances++;
                pendingChance = true;
              }
              unmarkedOpen = true;
              unmarkedOwnerId = owner.id;
            } else if (unmarkedOpen) {
              unmarkedOpen = false;
              unmarkedClosedSince = engine.t;
            }
          } else if (unmarkedOpen) {
            unmarkedOpen = false;
            unmarkedClosedSince = engine.t;
          }

          // —— 门将封角：离门线距离、横向偏移、到「射门点→球门中心」连线的距离 ——
          const keeper = engine.agents.find(
            (agent) => agent.team === defendingTeam && agent.role === "GK" && !agent.sentOff
          );
          if (keeper) {
            const goalY = goalYFor(defendingTeam);
            sample.keeperOffLine.push(Math.abs(keeper.y - goalY) * METRES_Y);
            sample.keeperLateralOffset.push(Math.abs(keeper.x - owner.x) * METRES_X);
            // 点到线段距离：射门点 owner → 球门中心 (50, goalY)
            const ax = owner.x, ay = owner.y;
            const bx = 50, by = goalY;
            const vx = (bx - ax) * METRES_X, vy = (by - ay) * METRES_Y;
            const wx = (keeper.x - ax) * METRES_X, wy = (keeper.y - ay) * METRES_Y;
            const lenSq = vx * vx + vy * vy;
            const tRaw = lenSq > 0 ? (wx * vx + wy * vy) / lenSq : 0;
            const t = Math.min(1, Math.max(0, tRaw));
            sample.keeperLaneDistance.push(Math.hypot(wx - vx * t, wy - vy * t));
          }

          // —— press 追点：上抢者目标点离持球人多远、他自己落后目标点多远 ——
          for (const agent of engine.agents) {
            if (agent.team !== defendingTeam) continue;
            if (agent.fsm !== "press") continue;
            if (!Number.isFinite(agent.tx) || !Number.isFinite(agent.ty)) continue;
            sample.pressTargetToCarrier.push(
              distanceMetres(agent.tx, agent.ty, owner.x, owner.y)
            );
            sample.pressLagBehindTarget.push(
              distanceMetres(agent.x, agent.y, agent.tx, agent.ty)
            );
            // 真正决定观感的是上抢者**本人**离持球人多远。target 到持球人的距离在
            // 引入提前量后必然变大（目标点故意站在人的去向上），它只能诊断旧 bug，
            // 不能当成功标准；这一项才是「有没有真的贴上去」。
            sample.pressActualToCarrier.push(
              distanceMetres(agent.x, agent.y, owner.x, owner.y)
            );
          }
        } else if (spell) {
          // 回合结束：按球的当前状态归类结束方式。
          const ending =
            b.state === "shot"
              ? "shot"
              : b.state === "pass"
                ? "pass"
                : owner && owner.team === spell.defendingTeam
                  ? "lost"
                  : !defendingTeam
                    ? "cleared"
                    : "other";
          sample.spellEndings[ending]++;
          sample.spellSeconds.push(spell.seconds);
          // 机会去向只在本回合确实出现过无人盯防机会时归类：这正是画面问题的核心
          // ——「站在空门前不射」意味着 shot 占比过低、pass 占比过高。
          if (pendingChance) {
            if (ending === "shot") sample.unmarkedShots++;
            else if (ending === "pass") sample.unmarkedPasses++;
            pendingChance = false;
          }
          // 传球结束的回合：按球的目标点判断是留在禁区还是出禁区。
          if (ending === "pass") {
            if (Number.isFinite(b.targetX) && Number.isFinite(b.targetY)) {
              if (engine._inOwnFoulBox(spell.defendingTeam, b.targetX, b.targetY)) {
                sample.boxPassRecycled++;
              } else {
                sample.boxPassExited++;
              }
            } else {
              sample.boxPassUnknown++;
            }
          }
          spell = null;
          unmarkedOpen = false;
          unmarkedOwnerId = null;
          unmarkedClosedSince = -Infinity;
        }
      }
      if (spell) {
        sample.spellEndings.other++;
        sample.spellSeconds.push(spell.seconds);
      }
      sample.matches++;
    } finally {
      Math.random = originalRandom;
    }
  }

  return sample;
}

const seeds = Array.from({ length: matches }, (_, index) => 372000 + index);
const sample = runBoxPossessionSample(seeds);

const per = (value) => Number((value / sample.matches).toFixed(2));
const totalEndings = Object.values(sample.spellEndings).reduce((sum, n) => sum + n, 0);
const pct = (part, whole) => Number((whole ? (part / whole) * 100 : 0).toFixed(1));

const report = {
  profile: simulationProfile,
  matches: sample.matches,
  seeds: { first: seeds[0], last: seeds[seeds.length - 1] },
  boxSpellsPerMatch: per(sample.boxSpells),
  boxSecondsPerMatch: per(sample.boxSeconds),
  medianSpellSeconds: Number(median(sample.spellSeconds).toFixed(2)),
  spellEndingSharePct: Object.fromEntries(
    Object.entries(sample.spellEndings).map(([key, value]) => [key, pct(value, totalEndings)])
  ),
  boxPassDestinationPct: {
    recycledInBox: pct(
      sample.boxPassRecycled,
      sample.boxPassRecycled + sample.boxPassExited + sample.boxPassUnknown
    ),
    exitedBox: pct(
      sample.boxPassExited,
      sample.boxPassRecycled + sample.boxPassExited + sample.boxPassUnknown
    ),
  },
  medianAttackersInBoxAtSpellStart: Number(
    median(sample.attackersInBoxAtSpellStart).toFixed(2)
  ),
  unmarkedCloseChancesPerMatch: per(sample.unmarkedCloseChances),
  unmarkedChanceOutcomePct: {
    shot: pct(sample.unmarkedShots, sample.unmarkedCloseChances),
    pass: pct(sample.unmarkedPasses, sample.unmarkedCloseChances),
  },
  pressTargetToCarrierMedian: Number(median(sample.pressTargetToCarrier).toFixed(2)),
  pressLagBehindTargetMedian: Number(median(sample.pressLagBehindTarget).toFixed(2)),
  pressActualToCarrierMedian: Number(median(sample.pressActualToCarrier).toFixed(2)),
  nearestDefenderToCarrierMedian: Number(median(sample.nearestDefenderToCarrier).toFixed(2)),
  keeperOffLineMedian: Number(median(sample.keeperOffLine).toFixed(2)),
  keeperLateralOffsetMedian: Number(median(sample.keeperLateralOffset).toFixed(2)),
  keeperLaneDistanceMedian: Number(median(sample.keeperLaneDistance).toFixed(2)),
  samples: {
    press: sample.pressTargetToCarrier.length,
    keeper: sample.keeperOffLine.length,
    spells: sample.spellSeconds.length,
  },
};

console.log(JSON.stringify(report, null, 2));

assert.ok(sample.matches === seeds.length, "every seeded match must complete");
assert.ok(sample.boxSpells > 0, "sampling found no box possession at all — the detector is broken");
assert.ok(report.samples.keeper > 0, "no keeper samples captured during box possession");

// v252：线路触达、接应与近门机会一并修正后，标准/后台同六种子分别为
// 727.82/784.90 秒、241.50/210.50 回合、25.33/29.83 次近门机会。
// 收紧旧上界，固定这次改进；绝对秒数仍是模拟的统计尺度，不能说等同真实比赛。
assert.ok(
  report.boxSecondsPerMatch <= 850,
  `ball spent ${report.boxSecondsPerMatch}s in the box per match (ceiling 850, former baseline 1092)`
);
assert.ok(
  report.boxSpellsPerMatch <= 280,
  `box possession spells rose to ${report.boxSpellsPerMatch} per match (ceiling 280, former baseline 346)`
);
assert.ok(
  report.boxPassDestinationPct.recycledInBox <= 50,
  `box passes are cycling inside the same penalty area (${report.boxPassDestinationPct.recycledInBox}%, ceiling 50)`
);

// 「无人盯防近距离」机会频率——画面上「空门却不射」的直接来源。合成场景审计
// 测不到这一项，v239 的问题正是从这条缝里漏过去的。
assert.ok(
  report.unmarkedCloseChancesPerMatch <= 35,
  `unmarked close-range chances rose to ${report.unmarkedCloseChancesPerMatch} per match (ceiling 35, former baseline 51.83)`
);

// press 追点：目标点要真的贴住持球人，上抢者也不能长期落后自己的目标点。
// 这两条是「追一个随球移动的点，永远追不上」的可回归证据（AGENTS.md v239 遗留 #1）。
assert.ok(
  report.pressTargetToCarrierMedian <= 2.6,
  `press target sits ${report.pressTargetToCarrierMedian}m from the carrier (ceiling 2.6, baseline 2.27)`
);
assert.ok(
  report.pressLagBehindTargetMedian <= 2.3,
  `pressers lag ${report.pressLagBehindTargetMedian}m behind their own target (ceiling 2.3, baseline 1.94)`
);
// 上抢者**本人**离持球人的距离才是观感的决定项。`pressTargetToCarrier` 只诊断
// 「目标点是否贴人」，一旦给目标点加提前量它必然变大，不能当成功标准——
// 已实测过一次：加 0.75 秒提前量后 lag 由 1.94 降到 1.75，而本项由 2.52 涨到 2.65，
// 禁区秒数反而微升。详见 AGENTS.md v239 遗留 #1 的负结果记录。
assert.ok(
  report.pressActualToCarrierMedian <= 2.8,
  `pressers themselves sit ${report.pressActualToCarrierMedian}m from the carrier (ceiling 2.8, baseline 2.52)`
);
assert.ok(
  report.nearestDefenderToCarrierMedian <= 2.6,
  `nearest defender sits ${report.nearestDefenderToCarrierMedian}m from the box carrier (ceiling 2.6, baseline 2.34)`
);

// 门将封角：不能窝在门线附近、也不能让开射门线路。
assert.ok(
  report.keeperLaneDistanceMedian <= 3.2,
  `keeper sits ${report.keeperLaneDistanceMedian}m off the shooting lane (ceiling 3.2, baseline 2.57)`
);

console.log("Box possession sampling audit passed: real-match box spells, chances, press pursuit and keeper angles");
