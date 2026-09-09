import assert from "node:assert/strict";

import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(8, Number(process.argv[2]) || 24);
const equalOnly = process.argv[4] === "equal-only";
const strongMatches = equalOnly ? 0 : Math.max(16, matches);
const simulationProfile = process.argv[3] === "background" ? "background" : "standard";
const timeStep = simulationProfile === "background" ? 0.3 : SIM.DT;
const separationPasses = simulationProfile === "background" ? 4 : 8;
// Seeds 165000..165023 and 265000..265023 on the standard profile. Update this
// only after an intentional standard-engine calibration and a fresh 24-match run.
//
// ⚠ 2026-09-03：这份快照曾经烂掉过，而且是**静默**烂掉的。发现过程写在下面，
//   因为同样的事会再发生一次：
//   · `npm test` 跑的是 `node scripts/verify.mjs`，**不带 `--full`**，
//     而这两个 24 场标定只在 `--full` 里（verify.mjs:121）。于是「75 项全过」
//     从来不包含本文件。
//   · 快照上一次刷新之后，引擎经历了门将站位、门框、开球等多轮有意标定，
//     没有人回来刷这份数。到 2026-09-03 时**标准档自己已经偏离快照 +4.38 次射门**
//     （29.21 vs 24.83），也就是说这条名为「background 与标准档不一致」的断言，
//     实际上量的是「与一份历史快照的偏离」。
//   · 结果是它在 `a82cb54` 上就已经红了三条（shots +4.42、goalkeeperClaims +5.92、
//     openGoalShots +0.79），只是没人跑 `--full` 所以没人知道。
//   所以下面加了一条**标准档自查**：标准档跑 24 场时也算同一份 delta 并用同一组容差
//   断言。快照一旦过期，会在标准档这一侧立刻失败并指向正确的原因，
//   而不是让 background 那一侧替它背锅。
//
// 【2026-09-03 有意刷新】上一份快照是门将出球修复之前的。那次改动有三处：
//   压迫阈值 6.5→4 格（旧值把站在禁区线外的合法逼抢也当成扑到门将脚下，
//   实测 113 次出球里 112 次判为贴身、短传分支从未执行）、大脚落点区间改成有方向的
//   [30,55]/[45,70]（旧值硬夹在中三区 [38,62]，100% 落在中路盒里、38% 落在本方半场）、
//   以及两处 `dir * -X` 的符号修正。依据见 `scripts/_gk-kick-and-ball-jump-probe.mjs`。
//   刷新的是**传球成功率 82.4 → 78.6**：大脚现在飞到中线一带的争抢区，
//   不再落进本方中场脚下，所以完成率必然下降；78.6% 仍在护栏 72~88 内，
//   也贴近真实（英超约 80%）。**这一项是有意刷的，不是为了让红的变绿**——
//   门将那两处旋钮单独跑都不破护栏，合并起来才把进球顶到 3.33，
//   收近端到 30 之后进球回到 3.08，剩下的就是这条成功率偏离。
//   其余八项一并按同一次标准档跑刷新，避免留下半新半旧的基准。
// 2026-09-09 有意标定：出脚线路、接应到球时间与真实触达统一；清晰近门机会
// 可以进入原有射门决策，误差分布、球员属性、扑救概率不变。标准/后台原始
// 24+24 场均通过真实性要求后，又纳入连续 96+96 场：进球 3.17/2.94、转化
// 9.9%/10.0%、完成率 81.1%/82.1%，强队积分 1.80/2.23。旧参考的射门/传球
// 差异来自这次有意改变的接应和选择，故按新的标准档原 24 个种子整体更新；
// 下方所有真实性门槛和九项容差保持原值。分片的失败与完整原始报告一并保留，
// 见 docs/match-attacking-continuity-2026-09-09.md，不挑选过关种子。
const STANDARD_PROFILE_REFERENCE_24 = Object.freeze({
  goals: 3.17,
  shots: 32.13,
  passes: 1064.83,
  passCompletionPct: 81.1,
  fouls: 26.17,
  openGoalShots: 0.21,
  goalkeeperClaims: 13.96,
  goalkeeperChallenges: 7.5,
  strongPointsPerMatch: 1.92,
});

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
    return {
      id,
      name: id,
      pos,
      number: index + 1,
      fitness: 100,
      attrs: {
        pace: rating,
        shooting: rating,
        passing: rating,
        dribbling: rating,
        defending: rating,
        physical: rating,
        finishing: rating,
        tackling: rating,
        marking: rating,
        strength: rating,
        stamina: rating,
        vision: rating,
        reflexes: rating,
        handling: rating,
        positioning: rating,
        kicking: rating,
      },
    };
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

function validateKickoff(engine, kickingTeam) {
  for (const agent of engine.agents) {
    assert.ok(
      agent.team === "home" ? agent.y >= 50 : agent.y <= 50,
      `${agent.id} is in the wrong half at kickoff`
    );
    if (agent.team !== kickingTeam) {
      assert.ok(
        Math.hypot(agent.x - 50, agent.y - 50) >= 9.1,
        `${agent.id} is inside the centre circle before kickoff`
      );
    }
  }
}

function distanceBin(distance) {
  if (distance < 16) return "under16";
  if (distance < 22) return "16to22";
  if (distance < 30) return "22to30";
  return "30plus";
}

function runMatch(homeAbility, awayAbility, seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, homeAbility),
      makeClub(`away-${seed}`, awayAbility),
      { simulationProfile, timeStep, separationPasses }
    );
    validateKickoff(engine, "home");
    const steps = Math.round((90 * 60) / timeStep);
    for (let step = 0; step < steps; step++) engine.step(timeStep);
    return engine;
  } finally {
    Math.random = originalRandom;
  }
}

const totals = {
  goals: 0,
  shots: 0,
  saves: 0,
  passes: 0,
  completedPasses: 0,
  crosses: 0,
  throughPasses: 0,
  tackles: 0,
  interceptions: 0,
  fouls: 0,
  handballs: 0,
  varReviews: 0,
  varDecisions: 0,
  varOverturns: 0,
  yellows: 0,
  reds: 0,
  penalties: 0,
  corners: 0,
  cornerShots: 0,
  cornerGoals: 0,
  injuries: 0,
  stalls: 0,
  openGoalShots: 0,
  openGoalReasons: {},
  goalkeeperClaims: 0,
  goalkeeperBlocks: 0,
  goalkeeperChallenges: 0,
  goalkeeperFouls: 0,
  unattributedGoals: 0,
  ownGoals: 0,
  penaltyGoals: 0,
  longShots: [],
  distance: {
    under16: { shots: 0, goals: 0 },
    "16to22": { shots: 0, goals: 0 },
    "22to30": { shots: 0, goals: 0 },
    "30plus": { shots: 0, goals: 0 },
  },
};
const stallSeeds = [];
const integration = { fineSeconds: 0, totalSeconds: 0, extraSteps: 0, outerSteps: 0, reasons: {} };

for (let match = 0; match < matches; match++) {
  const seed = 165000 + match;
  const engine = runMatch(13, 13, seed);
  const integrationSummary = engine.integrationSummary();
  integration.fineSeconds += integrationSummary.fineSeconds;
  integration.totalSeconds += engine.t;
  integration.extraSteps += integrationSummary.extraSteps;
  integration.outerSteps += integrationSummary.outerSteps;
  for (const [reason, count] of Object.entries(integrationSummary.reasons)) {
    integration.reasons[reason] = (integration.reasons[reason] || 0) + count;
  }
  const recentShots = [];
  const recentCorners = { home: -Infinity, away: -Infinity };
  for (const event of engine.events) {
    if (event.type === "shot") {
      const shot = {
        seed,
        team: event.team,
        t: event.t,
        distance: Number(event.distance) || 18,
        agentId: event.agentId || null,
        openGoal: !!event.openGoal,
        bin: distanceBin(Number(event.distance) || 18),
      };
      recentShots.push(shot);
      if (shot.bin === "30plus") totals.longShots.push(shot);
      totals.shots++;
      totals.distance[shot.bin].shots++;
      if (event.openGoal) {
        totals.openGoalShots++;
        const reason = event.openGoalReason || "unknown";
        totals.openGoalReasons[reason] = (totals.openGoalReasons[reason] || 0) + 1;
      }
      if (event.t - recentCorners[event.team] <= 18) totals.cornerShots++;
    } else if (event.type === "goal") {
      totals.goals++;
      if (event.ownGoal) totals.ownGoals++;
      if (event.penalty) totals.penaltyGoals++;
      const shot = recentShots
        .slice()
        .reverse()
        .find((item) => item.team === event.team && event.t - item.t <= 8);
      if (shot) {
        totals.distance[shot.bin].goals++;
        shot.goal = true;
      }
      else totals.unattributedGoals++;
      if (event.t - recentCorners[event.team] <= 18) totals.cornerGoals++;
    } else if (event.type === "save") totals.saves++;
    else if (event.type === "gk_claim") totals.goalkeeperClaims++;
    else if (event.type === "gk_block") totals.goalkeeperBlocks++;
    else if (event.type === "gk_challenge") totals.goalkeeperChallenges++;
    else if (event.type === "pass") {
      totals.passes++;
      if (event.cross) totals.crosses++;
      if (event.through && !event.cross) totals.throughPasses++;
    } else if (event.type === "receive") totals.completedPasses++;
    else if (event.type === "tackle") totals.tackles++;
    else if (event.type === "intercept") totals.interceptions++;
    else if (event.type === "corner") {
      totals.corners++;
      recentCorners[event.team] = event.t;
    } else if (event.type === "foul") {
      totals.fouls++;
      if (engine.agentById(event.agentId)?.role === "GK") totals.goalkeeperFouls++;
      if (event.penalty) totals.penalties++;
      if (event.card === "yellow") totals.yellows++;
      if (event.card === "red" || event.card === "red2") totals.reds++;
    } else if (event.type === "handball") totals.handballs++;
    else if (event.type === "var_review") totals.varReviews++;
    else if (event.type === "var_decision") {
      totals.varDecisions++;
      if (event.decision === "overturned") totals.varOverturns++;
    } else if (event.type === "injury") totals.injuries++;
    else if (event.type === "stall_clear") {
      totals.stalls++;
      stallSeeds.push(seed);
    }
  }
}

let strongPoints = 0;
let strongWins = 0;
let strongGoals = 0;
let weakGoals = 0;
for (let match = 0; match < strongMatches; match++) {
  const strongAtHome = match % 2 === 0;
  const engine = runMatch(strongAtHome ? 15 : 11, strongAtHome ? 11 : 15, 265000 + match);
  const scored = strongAtHome ? engine.score.home : engine.score.away;
  const conceded = strongAtHome ? engine.score.away : engine.score.home;
  strongGoals += scored;
  weakGoals += conceded;
  if (scored > conceded) strongWins++;
  strongPoints += scored > conceded ? 3 : scored === conceded ? 1 : 0;
}

const perMatch = (value) => Number((value / matches).toFixed(2));
const pct = (part, whole) => Number((whole ? (part / whole) * 100 : 0).toFixed(1));
const distance = Object.fromEntries(
  Object.entries(totals.distance).map(([bin, row]) => [
    bin,
    { ...row, sharePct: pct(row.shots, totals.shots), conversionPct: pct(row.goals, row.shots) },
  ])
);
const report = {
  simulationProfile,
  timeStep,
  separationPasses,
  integration: {
    fineSharePct: pct(integration.fineSeconds, integration.totalSeconds),
    extraStepSharePct: pct(integration.extraSteps, integration.outerSteps),
    reasons: integration.reasons,
  },
  stallSeeds,
  longShots: totals.longShots,
  equalMatches: matches,
  perMatch: {
    goals: perMatch(totals.goals),
    shots: perMatch(totals.shots),
    saves: perMatch(totals.saves),
    passes: perMatch(totals.passes),
    completedPasses: perMatch(totals.completedPasses),
    crosses: perMatch(totals.crosses),
    throughPasses: perMatch(totals.throughPasses),
    tackles: perMatch(totals.tackles),
    interceptions: perMatch(totals.interceptions),
    fouls: perMatch(totals.fouls),
    handballs: perMatch(totals.handballs),
    varReviews: perMatch(totals.varReviews),
    varOverturns: perMatch(totals.varOverturns),
    yellows: perMatch(totals.yellows),
    reds: perMatch(totals.reds),
    penalties: perMatch(totals.penalties),
    corners: perMatch(totals.corners),
    cornerShots: perMatch(totals.cornerShots),
    cornerGoals: perMatch(totals.cornerGoals),
    injuries: perMatch(totals.injuries),
    stalls: perMatch(totals.stalls),
    openGoalShots: perMatch(totals.openGoalShots),
    goalkeeperClaims: perMatch(totals.goalkeeperClaims),
    goalkeeperBlocks: perMatch(totals.goalkeeperBlocks),
    goalkeeperChallenges: perMatch(totals.goalkeeperChallenges),
    goalkeeperFouls: perMatch(totals.goalkeeperFouls),
    unattributedGoals: perMatch(totals.unattributedGoals),
    ownGoals: perMatch(totals.ownGoals),
    penaltyGoals: perMatch(totals.penaltyGoals),
  },
  shotConversionPct: pct(totals.goals, totals.shots),
  passCompletionPct: pct(totals.completedPasses, totals.passes),
  crossSharePct: pct(totals.crosses, totals.passes),
  throughPassSharePct: pct(totals.throughPasses, totals.passes),
  openGoalReasons: Object.fromEntries(
    Object.entries(totals.openGoalReasons).map(([reason, count]) => [reason, perMatch(count)])
  ),
  outsideBoxSharePct: pct(
    totals.distance["16to22"].shots + totals.distance["22to30"].shots + totals.distance["30plus"].shots,
    totals.shots
  ),
  distance,
  strongVsWeak: {
    matches: strongMatches,
    pointsPerMatch: Number((strongPoints / strongMatches).toFixed(2)),
    winRatePct: pct(strongWins, strongMatches),
    goalsFor: strongGoals,
    goalsAgainst: weakGoals,
  },
};

if (matches === 24 && !equalOnly) {
  report.standardProfileReference = STANDARD_PROFILE_REFERENCE_24;
  // 两个档位都算同一份 delta。background 档保留 `profileDelta` 这个键名
  // （留档与既有读法都按它写），标准档用 `referenceDelta` ——**标准档这一侧
  // 就是快照自查**：刷新之后应当逐项接近 0，任何非零都说明引擎自那次刷新起动过。
  const delta = {
    goals: Number((report.perMatch.goals - STANDARD_PROFILE_REFERENCE_24.goals).toFixed(2)),
    shots: Number((report.perMatch.shots - STANDARD_PROFILE_REFERENCE_24.shots).toFixed(2)),
    passes: Number((report.perMatch.passes - STANDARD_PROFILE_REFERENCE_24.passes).toFixed(2)),
    passCompletionPct: Number(
      (report.passCompletionPct - STANDARD_PROFILE_REFERENCE_24.passCompletionPct).toFixed(1)
    ),
    fouls: Number((report.perMatch.fouls - STANDARD_PROFILE_REFERENCE_24.fouls).toFixed(2)),
    openGoalShots: Number(
      (report.perMatch.openGoalShots - STANDARD_PROFILE_REFERENCE_24.openGoalShots).toFixed(2)
    ),
    goalkeeperClaims: Number(
      (report.perMatch.goalkeeperClaims - STANDARD_PROFILE_REFERENCE_24.goalkeeperClaims).toFixed(2)
    ),
    goalkeeperChallenges: Number(
      (report.perMatch.goalkeeperChallenges - STANDARD_PROFILE_REFERENCE_24.goalkeeperChallenges).toFixed(2)
    ),
    strongPointsPerMatch: Number(
      (report.strongVsWeak.pointsPerMatch - STANDARD_PROFILE_REFERENCE_24.strongPointsPerMatch).toFixed(2)
    ),
  };
  report.referenceDelta = delta;
  if (simulationProfile === "background") report.profileDelta = delta;
}

console.log(JSON.stringify(report, null, 2));

assert.equal(totals.stalls, 0, "spatial engine must not need watchdog clearances");
assert.ok(report.perMatch.goals >= 2.5 && report.perMatch.goals <= 3.3, "goals per match left the calibration envelope");
assert.ok(report.shotConversionPct >= 9 && report.shotConversionPct <= 15, "shot conversion left the calibration envelope");
assert.ok(report.perMatch.passes >= 800 && report.perMatch.passes <= 1250, "pass volume left the calibration envelope");
assert.ok(report.passCompletionPct >= 72 && report.passCompletionPct <= 88, "pass completion left the calibration envelope");
assert.ok(report.crossSharePct >= 3 && report.crossSharePct <= 14, "cross share left the calibration envelope");
assert.ok(
  report.perMatch.throughPasses >= 0.5 && report.perMatch.throughPasses <= 12,
  "through-ball volume left the calibration envelope"
);
assert.ok(
  report.outsideBoxSharePct >= 25 && report.outsideBoxSharePct <= 50,
  "outside-box shot share left the calibration envelope"
);
// 30m+ attempts are deliberately rare, so a conversion percentage over one or
// two shots is not a stable gate. Cap their goal frequency instead: at most one
// exceptional long-range goal per 24-match release sample.
assert.ok(
  report.distance["30plus"].goals <= Math.max(1, Math.ceil(matches / 24)),
  "30+ distance goal frequency is too high"
);
assert.ok(report.perMatch.tackles <= 55, "successful tackles remain unrealistically frequent");
assert.ok(report.perMatch.interceptions <= 60, "clean interceptions remain unrealistically frequent");
assert.ok(report.perMatch.penalties >= 0.1 && report.perMatch.penalties <= 0.5, "penalty frequency left the calibration envelope");
assert.ok(report.perMatch.corners >= 2.75 && report.perMatch.corners <= 10, "corner frequency left the calibration envelope");
assert.ok(report.perMatch.cornerShots >= 0.5, "corners are not producing attacking shots");
assert.ok(report.perMatch.handballs <= 1, "handball frequency is too high");
assert.equal(totals.varReviews, totals.varDecisions, "every VAR review must have a decision");
assert.ok(totals.varOverturns <= totals.varReviews, "VAR overturns cannot exceed reviews");
// 24 场样本的胜率会被平局和单场随机性显著扰动；积分/净胜球更稳定地
// 检验能力差异仍然存在，同时避免把正常的足球方差误判为引擎回归。
if (!equalOnly) {
  assert.ok(report.strongVsWeak.pointsPerMatch >= 1.5, "strong teams must retain a visible ability advantage");
  assert.ok(strongGoals > weakGoals, "strong teams need a positive goal difference");
}
if (report.profileDelta) {
  const delta = report.profileDelta;
  assert.ok(report.integration.fineSharePct >= 5, "background profile did not activate critical ball substeps");
  assert.ok(report.integration.fineSharePct <= 20, "background critical ball windows exceeded their time budget");
  assert.ok(
    report.integration.extraStepSharePct <= 32,
    "background critical ball substeps exceeded their execution budget"
  );
}
// 同一组容差同时管住两件事：background 档与快照的偏离，以及**快照本身有没有过期**。
// 标准档跑到这里时 `referenceDelta` 应当逐项接近 0；一旦某项超差，说明自上次刷新
// 以来引擎被有意改过而没人回来刷这份数——那就应该在标准档这一侧失败，
// 而不是等到某次 `--full` 让 background 那一侧替它背锅（2026-09-03 就是这么发现的）。
if (report.referenceDelta) {
  const delta = report.referenceDelta;
  const who = simulationProfile === "background" ? "background" : "standard";
  const stale =
    simulationProfile === "background"
      ? ""
      : " — the frozen STANDARD_PROFILE_REFERENCE_24 is stale; refresh it deliberately";
  assert.ok(Math.abs(delta.goals) <= 0.55, `${who} goals diverged from the fixed-seed standard profile${stale}`);
  assert.ok(Math.abs(delta.shots) <= 3, `${who} shots diverged from the fixed-seed standard profile${stale}`);
  assert.ok(Math.abs(delta.passes) <= 100, `${who} pass volume diverged from the fixed-seed standard profile${stale}`);
  assert.ok(
    Math.abs(delta.passCompletionPct) <= 2,
    `${who} pass completion diverged from the fixed-seed standard profile${stale}`
  );
  assert.ok(Math.abs(delta.fouls) <= 6, `${who} fouls diverged from the fixed-seed standard profile${stale}`);
  assert.ok(
    Math.abs(delta.openGoalShots) <= 0.65,
    `${who} open-goal chances diverged from the fixed-seed standard profile${stale}`
  );
  assert.ok(
    Math.abs(delta.goalkeeperClaims) <= 4,
    `${who} goalkeeper claims diverged from the fixed-seed standard profile${stale}`
  );
  assert.ok(
    Math.abs(delta.goalkeeperChallenges) <= 3,
    `${who} goalkeeper challenges diverged from the fixed-seed standard profile${stale}`
  );
  assert.ok(
    Math.abs(delta.strongPointsPerMatch) <= 0.5,
    `${who} strength separation diverged from the fixed-seed standard profile${stale}`
  );
}
