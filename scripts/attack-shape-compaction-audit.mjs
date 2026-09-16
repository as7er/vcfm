/**
 * 进攻三区队形压缩审计 —— 把「球队进攻时纵向被拉长」钉成可回归的断言。
 *
 * 为什么需要它：`AGENTS.md:3145-3148`（v238）诊断出「队形纵向被拉长、且只发生在进攻三区」，
 * 成因是引擎**缺少 team block 的纵向平移 + 长度压缩**：默认球队走
 * `_applyExplicitShapeAnchor` 时直接 `return false`（`engine.js:919`），只靠
 * `a.ty = clamp(a.baseY + (b.y - a.baseY) * pull, 3, 97)`、`pull = clamp(1 - d/40, 0, 1) * 0.2`
 * （`engine.js:4880-4882`）的 20% 跟球浮动。结果是进攻三区的队形长度
 * ≈ 4-3-3 **静态模板长度 59.85 m**（`js/data.js:775-781`），而真实球队是一个 30-40 m 的块。
 *
 * 本轮（2026-09-13）用 `scripts/_fm26-shape-gap-probe.mjs` 把这条做成了引擎侧可复现测量：
 * role-noGK 口径下己方三区 37.0 m / 中场 37.8 m / **进攻三区 63.4 m**（两档几乎相同）。
 * 本审计把那组数**变成断言**，这样后续修无球目标点生成时才有回归网。
 *
 * 修复进展（2026-09-14，两轮，均已在正式源码里）：
 *   ① 中卫线纵向目标 `baseY + dir*7`（与球位无关的常量）→ 叠加随球推进的 `blockForward`；
 *   ② 边卫兜底分支 `baseY + dir*(4 + prog*5)`（几乎不跟球）→ 叠加同一个 `blockForward`。
 *   结果：进攻三区长度 63.3 → **47.4 m**（standard）、`span` 55.7 → **44.0 m**。
 *   ⚠ ②的成因是 `bombOn` 的 `dBall < 55` 让**远侧边卫**永远进不了前插分支：
 *   实测控球时球侧边卫 93 m、远侧边卫却钉在 38 m，85.1% 的队帧两名边卫相差 >20 m。
 *   **注意 `_attack-block-shift-probe.mjs` 的跨度列是 `att − cb`、不含边卫，看不到这个问题。**
 *   详见 `docs/attack-block-shift-diagnosis-2026-09-14.md` §5f。
 * （旧文档把这块叫 `_attackPlan`，引擎里没有这个函数名；现名
 * `_chooseAttackOffBallTarget`，`engine.js:3734`。2026-09-14 已把病因精确定位到
 * 它的中卫分支 `:3788-3793`——`a.ty = clamp(a.baseY + dir*7, 18, 82)` 是与球位无关的常量。
 * 详见 `docs/attack-block-shift-diagnosis-2026-09-14.md`。）
 *
 * 修复进展（2026-09-15，第三轮）：中卫线前压加**尾部加权**
 * （`SIM.CB_BLOCK_TAIL_FROM/GAIN`，`prog > 0.7` 才陡增）。
 *   结果：进攻三区 47.4 → **41.08 m**、`span` 44.7 → **40.25 m**、
 *   后卫线 49.7 → **53.44 m**（目标 56–66）；两档一致（后台 41.19 / 40.41）。
 *   48 场信封无代价（标准 2.67 / 分离 2.04；后台 2.92 / 1.96）。
 *   ⚠ 尾部 2.0 能进 30–40 区间（39.08）但强弱分离掉到 1.52，故取 1.5。
 *   同轮修订了断言 ④ 并新增两条机制断言，见下方 LIMITS 注释。
 *   详见 `docs/cb-block-tail-2026-09-15.md`。
 *
 * 种子范围与探针相同（372000 起），本审计取前 4 个（探针取 6 个）；两者中位差 <0.5 m
 * （6 场 63.39/63.70 vs 4 场 63.32/63.82），所以 4 场足够稳定，且把耗时控制在约 60s。
 *
 * ⚠ 三条必须知道的口径约定：
 *   1. **必须剔门将**。`all` 口径的进攻三区高达 85.4 m，其中约 22 m 全是门将
 *      （门将钉在己方门线附近、前锋压到对方禁区）。不剔门将的数字毫无意义。
 *      这里按 `role !== "GK"` 精确剔（引擎侧有 role，不用几何带猜）。
 *   2. **不要用 cmp6 的「8 m 门将带」当门将代理**：实测门将距己方门线深度中位 7.5 m、
 *      p90 9.0 m，正好压在 8 m 边界上，**46.5% 的队帧门将仍在样本内**。
 *   3. 深度以**己方球门线**为 0；三区按球在该队进攻方向的前/中/后 1/3 划分。
 *
 * 断言的**方向**很重要：阈值按「现状 + 余量」设，所以
 * **改好（长度变小）会通过，改坏（长度变大）会失败**。下限则是防「压成一团」的塌陷。
 *
 * 口径与仓库其它探针一致：种子 372000..372005、`SIM.DT`、`separationPasses: 8`、
 * 每 0.5 秒采样。全程只读引擎公开状态。
 */
import assert from "node:assert/strict";

import { SimEngine, SIM } from "../js/sim/engine.js";

const MX = SIM.PITCH_W_METRES / SIM.FIELD_W; // 0.68 m / x 格
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05 m / y 格
const SAMPLE_STEPS = 5;                      // 每 5 步 = 0.5 秒

const SEEDS = [372000, 372001, 372002, 372003];

// 现状基线（role-noGK 口径，两档各 4 场的中位）。阈值 = 基线 + 余量：
// 变好会通过、变坏会失败。
//
// ⚠ 2026-09-14 收紧上限（不是放宽）。原始阈值是按**未修**基线（进攻三区 63.5 / span 60）
//   加余量设的；两轮修复后基线已降到 **47.4 / span 44.0**，旧的 68 / 70
//   **再也挡不住「退回原状」这种回归**（63.3 < 68 会照样通过）。所以把上限压到
//   新基线 + 约 6–7 m 余量。下限与比值下限一律保持原值，未动。
//   对照：修前 63.32 / 55.68（standard）在新上限下会**失败**，方向正确。
// ⚠ 2026-09-15 修订断言 ④（进攻/中场比值），并补两条机制断言。
//
//   原断言 `attack >= 1.15 * middle` 与 FM26 目标**数学上不相容**：
//   `AGENTS.md` 的目标是进攻三区落到 30–40 m，而己方/中场三区实测 37.0/37.8
//   本就**已经在该区间内**。三区都真实时，进攻/中场的比值只能是 ~1.0–1.1，
//   永远够不到 1.15。于是这条断言会**禁止达成目标的正确状态**。
//
//   实测（中卫线尾部加权，标准档同种子，48 场信封另测）：
//     配置        attack   middle   比值    backLine  forwardTop  span
//     未修基线     47.38    36.96   1.282    49.69      94.39    44.70
//     尾部 1.0     43.31    36.74   1.179    53.12      95.62    42.50
//     尾部 1.5     41.08    37.07   1.122    53.44      93.69    40.25
//     尾部 2.0     39.08    37.07   1.054    55.83      94.79    38.96
//   比值随「压得越对」而**单调下降**，与断言的判定方向相反。
//
//   而这条断言原本要防的「退化修法」（把锋线整体回撤、从上方压短队形）
//   经反例验证**不可达**：`scripts/_att-drop-candidate.mjs` 把锋线的前进目标
//   回撤 10 m 后，`forwardTop` 纹丝不动（95.03 vs 基线 94.39）——
//   锋线深度由「球位 + 越位线」钉住，不受那个常量控制。
//   （该反例探针后来改为改越位缓冲，见下。）
//
//   因此把比值下限降到 1.02（只拦「进攻三区塌到中场以下」），
//   并把「压缩必须来自后卫线抬升、且锋线不得回撤」写成两条**机制断言**，
//   这才是原断言想守的东西：
//     backLineFloor 53  —— 未修基线 49.69 会**失败**（反向验证过），
//                          采纳配置 53.44/53.27 通过。
//     forwardTopFloor 92 —— 锋线塌陷会失败；用改越位缓冲的反例验证
//                          （`scripts/_att-drop-candidate.mjs`）。
const LIMITS = {
  attackCeiling: 54,      // 进攻三区长度上限（基线 47.4/47.6；修前 63.3/63.8 会失败）
  thirdCeiling: 45,       // 己方/中场三区长度上限（基线 ~37.0，本轮未变）
  thirdFloor: 20,         // 三区长度下限：防「压成一团」的塌陷
  attackFloor: 25,
  // 2026-09-15：1.15 → 1.02。原值与 FM26 目标不相容，见上方长注释。
  attackOverMiddle: 1.02, // 进攻三区必须长于中场（只拦「塌到中场以下」）
  // 机制断言：压缩必须来自后卫线抬升，而不是锋线回撤
  backLineFloor: 53,      // 后卫线深度下限（未修基线 49.69 会失败）
  forwardTopFloor: 92,    // 锋线最高点下限（防「从上方压短队形」的退化修法）
  gkGapMin: 10,           // all − role 的差值下限，证明门将确实在 all 里、且被 role 剔掉（基线 ~22 m）
  spanMin: 30,            // 进攻三区 DEF→ATT 跨度下限
  spanMax: 52,            // 进攻三区 DEF→ATT 跨度上限（基线 44.0/44.9；修前 55.7/55.4 会失败）
  profileGapMax: 6,       // 两档差值的上限：说明这是引擎结构性属性，不是档位噪声
};

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
    ]) attrs[key] = rating;
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((player) => player.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** 一个点集沿球场长向的铺开（m） */
function lengthOf(points) {
  const depths = points.map((p) => p.y * MY);
  return Math.max(...depths) - Math.min(...depths);
}

function measureProfile(profile) {
  const timeStep = profile === "background" ? 0.3 : SIM.DT;
  const separationPasses = profile === "background" ? 4 : 8;
  const acc = {
    own: [], middle: [], attack: [],
    attackAll: [], attackBackLine: [], attackForwardTop: [],
  };

  for (const seed of SEEDS) {
    const engine = new SimEngine(
      makeClub(`home-${seed}`, 15),
      makeClub(`away-${seed}`, 15),
      { random: seededRandom(seed), simulationProfile: profile, timeStep, separationPasses }
    );
    const steps = Math.round((90 * 60) / timeStep);

    for (let step = 0; step < steps; step++) {
      engine.step(timeStep);
      if (step % SAMPLE_STEPS !== 0) continue;

      const live = engine.agents.filter((agent) => !agent.sentOff);
      for (const team of ["home", "away"]) {
        const squad = live.filter((agent) => agent.team === team);
        if (squad.length < 7) continue;
        const outfield = squad.filter((agent) => agent.role !== "GK");
        if (outfield.length < 7) continue;

        // 控球三区：球在该队进攻方向的前/中/后 1/3
        const ballL = engine.ball.y * MY;
        const progress = team === "home"
          ? (SIM.PITCH_H_METRES - ballL) / SIM.PITCH_H_METRES
          : ballL / SIM.PITCH_H_METRES;
        const phase = progress < 1 / 3 ? "own" : progress > 2 / 3 ? "attack" : "middle";

        acc[phase].push(lengthOf(outfield));
        if (phase !== "attack") continue;

        acc.attackAll.push(lengthOf(squad));
        // 深度以己方球门线为 0
        const ownGoalL = team === "home" ? SIM.PITCH_H_METRES : 0;
        const depthOf = (player) => Math.abs(player.y * MY - ownGoalL);
        const defenders = squad.filter((player) => player.role === "DEF").map(depthOf);
        const forwards = squad.filter((player) => player.role === "ATT").map(depthOf);
        if (defenders.length) acc.attackBackLine.push(Math.min(...defenders));
        if (forwards.length) acc.attackForwardTop.push(Math.max(...forwards));
      }
    }
  }

  const own = median(acc.own);
  const middle = median(acc.middle);
  const attack = median(acc.attack);
  const backLine = median(acc.attackBackLine);
  const forwardTop = median(acc.attackForwardTop);
  return {
    profile,
    samples: { own: acc.own.length, middle: acc.middle.length, attack: acc.attack.length },
    own,
    middle,
    attack,
    attackAll: median(acc.attackAll),
    attackOverMiddle: middle > 0 ? attack / middle : NaN,
    attackOverOwn: own > 0 ? attack / own : NaN,
    backLine,
    forwardTop,
    span: forwardTop - backLine,
    templateLength: 59.85, // js/data.js:775-781 的 4-3-3 静态模板长度
  };
}

function assertProfile(result) {
  const { profile } = result;
  const where = `[${profile}]`;

  // 结构性质：进攻时队形必须长于中场（只拦「塌到中场以下」）
  assert.ok(
    result.attack >= result.middle * LIMITS.attackOverMiddle,
    `${where} 进攻三区没有长于中场：attack ${result.attack.toFixed(1)} / middle ${result.middle.toFixed(1)} ` +
    `(需要 >= ${LIMITS.attackOverMiddle}×)`
  );

  // 机制断言（2026-09-15 新增）：队形压缩必须来自**后卫线抬升**，而不是把锋线回撤。
  // 这两条替代了原比值断言 1.15 想守的东西——原值随「压得越对」而单调失败，
  // 见文件顶部注释。
  assert.ok(
    result.backLine >= LIMITS.backLineFloor,
    `${where} 后卫线没有抬起来：${result.backLine.toFixed(1)} m < ${LIMITS.backLineFloor} m ` +
    `（未修基线 49.7 m；队形变短必须来自后卫线前压，而不是别处）`
  );
  assert.ok(
    result.forwardTop >= LIMITS.forwardTopFloor,
    `${where} 锋线回撤了：${result.forwardTop.toFixed(1)} m < ${LIMITS.forwardTopFloor} m ` +
    `（基线 94.4 m；把锋线拉回来压短队形是退化修法）`
  );

  // 回归上限：改好（变短）通过，改坏（变长）失败
  assert.ok(
    result.attack <= LIMITS.attackCeiling,
    `${where} 进攻三区纵向长度超出上限：${result.attack.toFixed(1)} m > ${LIMITS.attackCeiling} m ` +
    `（基线 63.4/63.7 m，静态模板 59.85 m；目标 ~40 m）`
  );
  assert.ok(
    result.own <= LIMITS.thirdCeiling,
    `${where} 己方三区纵向长度超出上限：${result.own.toFixed(1)} m > ${LIMITS.thirdCeiling} m`
  );
  assert.ok(
    result.middle <= LIMITS.thirdCeiling,
    `${where} 中场三区纵向长度超出上限：${result.middle.toFixed(1)} m > ${LIMITS.thirdCeiling} m`
  );

  // 下限：防止「把队形压成一团」的塌陷式改法
  assert.ok(result.own >= LIMITS.thirdFloor, `${where} 己方三区被压得过短：${result.own.toFixed(1)} m`);
  assert.ok(result.middle >= LIMITS.thirdFloor, `${where} 中场三区被压得过短：${result.middle.toFixed(1)} m`);
  assert.ok(result.attack >= LIMITS.attackFloor, `${where} 进攻三区被压得过短：${result.attack.toFixed(1)} m`);

  // 测量自检：门将必须在 all 里、且被 role 剔掉
  assert.ok(
    result.attackAll - result.attack >= LIMITS.gkGapMin,
    `${where} all 与 role-noGK 的进攻三区差值过小（${(result.attackAll - result.attack).toFixed(1)} m）：` +
    `门将可能没被正确剔除，或队形已退化`
  );

  // 进攻三区内的 DEF→ATT 跨度
  assert.ok(
    result.span >= LIMITS.spanMin && result.span <= LIMITS.spanMax,
    `${where} 进攻三区 DEF→ATT 跨度为 ${result.span.toFixed(1)} m，越出 [${LIMITS.spanMin}, ${LIMITS.spanMax}]`
  );
}

const standard = measureProfile("standard");
const background = measureProfile("background");
assertProfile(standard);
assertProfile(background);

// 两档一致性：说明这是引擎结构性属性，不是档位参数造成的噪声
assert.ok(
  Math.abs(standard.attack - background.attack) <= LIMITS.profileGapMax,
  `标准/后台两档的进攻三区长度差异过大：${standard.attack.toFixed(1)} vs ${background.attack.toFixed(1)} m`
);

console.log(JSON.stringify({
  standard,
  background,
  note: "role-noGK 口径；进攻三区长度 ≈ 4-3-3 静态模板 59.85 m 说明缺少 team block 平移+压缩",
}, null, 2));
console.log(
  "Attack shape compaction audit passed: attacking-third longitudinal spread stays bounded " +
  "(no team-block compaction regression) while own/middle thirds stay inside the healthy band"
);
