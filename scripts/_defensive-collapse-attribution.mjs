/**
 * 归因：为什么「球在本方后三区时，本方 40 格内常比对方人少（47.3%）」
 *
 * 来源：`docs/handoff-2026-09-24.md` §4 / §8.3 —— 现象已被量到，但**未归因到代码**。
 *
 * 候选机制（读代码得出，本探针负责证实/证伪）：
 *   `_defLineY(a)`（`js/sim/engine.js:5521`）：
 *       layer     = DEF 20 / MID 38 / ATT 55  (+ linePush + pressPush + roleDepth)
 *       collapsed = DEF 11 / MID 22 / ATT 34
 *       threat    = clamp(1 - dBallGoal / 35, 0, 1)
 *       depth     = layer + (collapsed - layer) * threat²      ← **平方**
 *   球在「后三区」（距己方门 12~33 格）时：
 *       dBallGoal 33 ⇒ threat 0.057 ⇒ threat² **0.003** ⇒ 回收 ≈ 0
 *       dBallGoal 30 ⇒ threat 0.143 ⇒ threat² **0.020**
 *   ⇒ 后三区**外沿**（25~33 格）几乎不触发任何回收，前锋留在前场，
 *     于是「球附近本方人少」。
 *
 * 判据（要能判多大效应）：
 *   ① 把后三区按 dBallGoal 分两段（12~22 / 22~33），比「球门侧本方外场人数」与
 *      「球 40 格内本方 vs 对方外场人数」——**若外沿段的劣势显著大于内段，
 *      归因成立**。
 *   ② 直接打印 `threat²` 分布与各角色的实际 `depth`，与手算逐位对照。
 *
 * ⚠ 与交接 §4 的口径一致：**排除底线 12 格内**（角球/球门球/点球会把形状打乱）。
 * ⚠ 直接用 `SimEngine`（与 `match-realism-audit` 同路径），不走浏览器、不写引擎。
 *
 * 用法：node scripts/_defensive-collapse-attribution.mjs [场数=8]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";
import { generatePlayerAttributes } from "../js/player-attributes.js";

const MATCHES = Math.max(1, Number(process.argv[2]) || 8);
const STEP = SIM.DT; // 标准档 0.1s
const SAMPLE_EVERY = 20; // 每 2.0 模拟秒采一次，避免自相关把 n 撑大

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

function mkClub(id, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((role, i) => {
    const p = {
      id: `${id}_${i}`,
      name: `${id}${i}`,
      pos: role,
      role,
      ovr: ability,
      age: 25,
      nationality: "ENG",
      fitness: 100,
      injured: 0,
      suspendedMatches: 0,
      attrs: {},
      form: 0,
      morale: 70,
    };
    generatePlayerAttributes(p, ability);
    return p;
  });
  return { id, name: id, power: ability, players, tactics: undefined };
}

/** 米 → 格（y 轴）。`SIM.PITCH_H_METRES` / `SIM.FIELD_H` 是长边换算。 */
const Y_TO_M = SIM.PITCH_H_METRES / SIM.FIELD_H;
const X_TO_M = SIM.PITCH_W_METRES / SIM.FIELD_W;
const metres = (dx, dy) => Math.hypot(dx * X_TO_M, dy * Y_TO_M);

const rows = [];
let sampledFrames = 0;

for (let m = 0; m < MATCHES; m += 1) {
  const rng = seededRandom(165000 + m);
  const home = mkClub(`h${m}`, 13);
  const away = mkClub(`a${m}`, 13);
  const engine = new SimEngine(home, away, {
    simulationProfile: "standard",
    timeStep: STEP,
    separationPasses: 8,
    random: rng,
  });
  const steps = Math.round((90 * 60) / STEP);
  for (let step = 0; step < steps; step += 1) {
    engine.step(STEP);
    if (step % SAMPLE_EVERY !== 0) continue;

    const b = engine.ball;
    for (const team of ["home", "away"]) {
      const ownGoalY = engine.ownGoalY(team);
      // 球距**本方**球门的格数
      const dBallGoal = Math.abs(b.y - ownGoalY);
      // 交接口径：后三区 = 12~33 格，排除底线 12 格内
      if (dBallGoal < 12 || dBallGoal > 33) continue;

      const mine = engine.agents.filter((a) => a.team === team && a.role !== "GK" && !a.sentOff);
      const theirs = engine.agents.filter(
        (a) => a.team !== team && a.role !== "GK" && !a.sentOff
      );

      // ① 球门侧：站在「球 → 本方球门」连线之间（按 y 层次判，与交接同口径）
      const goalSide = mine.filter((a) => {
        const dA = Math.abs(a.y - ownGoalY);
        return dA < dBallGoal - 1;
      }).length;

      // ② 球 40 格内的双方外场人数
      const nearMine = mine.filter((a) => metres(a.x - b.x, a.y - b.y) <= 40).length;
      const nearTheirs = theirs.filter((a) => metres(a.x - b.x, a.y - b.y) <= 40).length;

      // ③ 各角色的实际防线深度（对照手算的 threat² 插值）
      const depthByRole = { DEF: [], MID: [], ATT: [] };
      for (const a of mine) {
        const lineY = engine._defLineY(a);
        depthByRole[a.role]?.push(Math.abs(lineY - ownGoalY));
      }
      const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

      const threat = Math.max(0, Math.min(1, 1 - dBallGoal / 35));
      rows.push({
        dBallGoal,
        threatSq: threat * threat,
        goalSide,
        nearMine,
        nearTheirs,
        defDepth: mean(depthByRole.DEF),
        midDepth: mean(depthByRole.MID),
        attDepth: mean(depthByRole.ATT),
      });
      sampledFrames += 1;
    }
  }
}

const q = (arr, p) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const meanOf = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

const inner = rows.filter((r) => r.dBallGoal < 22); // 12~22 格
const outer = rows.filter((r) => r.dBallGoal >= 22); // 22~33 格

console.log(`场数 ${MATCHES} ｜ 后三区采样 ${rows.length}（每场每 2.0 模拟秒一次）`);
console.log(`\n=== ① 后三区分两段对照 ===`);
const seg = (label, arr) => {
  if (!arr.length) return console.log(`  ${label}: 无样本`);
  const outnum = arr.filter((r) => r.nearTheirs > r.nearMine).length;
  console.log(
    `  ${label.padEnd(14)} n=${String(arr.length).padStart(5)}  ` +
      `球门侧本方人数 P10/中位/P90 = ${q(arr.map((r) => r.goalSide), 0.1)}/` +
      `${q(arr.map((r) => r.goalSide), 0.5)}/${q(arr.map((r) => r.goalSide), 0.9)}  ｜ ` +
      `球40格内 我/他 = ${meanOf(arr.map((r) => r.nearMine)).toFixed(2)}/` +
      `${meanOf(arr.map((r) => r.nearTheirs)).toFixed(2)}  ｜ ` +
      `对方人多占比 **${((outnum / arr.length) * 100).toFixed(1)}%**`
  );
};
seg("内段 12~22", inner);
seg("外沿 22~33", outer);
seg("合计 12~33", rows);

console.log(`\n=== ② threat² 与各角色实际防线深度（距己方门，格）===`);
console.log(`  球距门  threat²   DEF    MID    ATT   （手算：DEF 20→11 / MID 38→22 / ATT 55→34）`);
for (const lo of [12, 15, 18, 21, 24, 27, 30, 33]) {
  const band = rows.filter((r) => r.dBallGoal >= lo - 1 && r.dBallGoal < lo + 2);
  if (!band.length) continue;
  console.log(
    `  ${String(lo).padStart(4)}    ${meanOf(band.map((r) => r.threatSq)).toFixed(3)}  ` +
      `${meanOf(band.map((r) => r.defDepth))?.toFixed(1)}  ` +
      `${meanOf(band.map((r) => r.midDepth))?.toFixed(1)}  ` +
      `${meanOf(band.map((r) => r.attDepth))?.toFixed(1)}`
  );
}

console.log(`\n=== ③ 结论判据 ===`);
const innerOut = inner.length ? inner.filter((r) => r.nearTheirs > r.nearMine).length / inner.length : 0;
const outerOut = outer.length ? outer.filter((r) => r.nearTheirs > r.nearMine).length / outer.length : 0;
console.log(`  内段对方人多 ${(innerOut * 100).toFixed(1)}%  vs  外沿 ${(outerOut * 100).toFixed(1)}%`);
console.log(
  `  ⇒ 若外沿明显更差，则「threat² 在后三区外沿趋零 ⇒ 不回收 ⇒ 人少」这条归因成立。`
);
console.log(`  参照：交接实测整场（含所有区间）为 47.3%。`);
