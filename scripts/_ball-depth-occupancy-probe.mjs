/**
 * 球位占用探针 —— 回答「球到底有多少时间待在对方禁区一带」。
 *
 * 动机：`_attack-span-endpoints-probe.mjs` 量到进攻三区控球帧里 85–105 m（球距对方门线 <20 m）
 * 占 **80.8%**，其中 95–105 m 一档独占 49.6%。这个比例高得可疑，必须用独立口径证伪或证实，
 * 否则「进攻三区跨度中位 44 m」到底在量什么就无法判断。
 *
 * ⚠ 第一版曾把「己方禁区持球」和「飞行中的球」也算进去，得到 21.4% 全帧、1158 秒/场，
 *   与 `box-possession-sampling-audit.mjs` 的 680–780 秒/场差了 1.7 倍。本版改为**逐字复刻**
 *   该审计的口径（`engine.js` 的 `_inOwnFoulBox` + `ball.state ∈ {held, control}` + 持球方必须是
 *   进攻方），这样两个数字才能直接对账。
 *
 * 三个互不依赖的读数：
 *   A. 全帧（不要求有持球人）—— 球距**最近**门线的距离分布。纯几何，与任何持球口径无关。
 *   B. 严格进攻持球帧 —— 球距**进攻方自己**门线的距离分布（即跨度探针的桶）。
 *   C. 禁区持球秒数 —— 与 `box-possession-sampling-audit.mjs` 同口径，用来对账。
 *
 * 只读，不消费随机数。
 * 用法：node scripts/_ball-depth-occupancy-probe.mjs [standard|background] [场数]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const PROFILE = process.argv[2] === "background" ? "background" : "standard";
const MATCHES = Number(process.argv[3] || 4);
const MX = SIM.PITCH_W_METRES / SIM.FIELD_W; // 0.68 m / x 格
const MY = SIM.PITCH_H_METRES / SIM.FIELD_H; // 1.05 m / y 格
const SAMPLE_STEPS = 5; // 每 0.5 秒
const SEEDS = Array.from({ length: MATCHES }, (_, i) => 372000 + i);

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

const ATTRS = [
  "pace", "shooting", "passing", "dribbling", "defending", "physical",
  "finishing", "tackling", "marking", "strength", "stamina", "vision",
  "reflexes", "handling", "positioning", "kicking", "crossing", "decisions",
];
function makeClub(name, ability) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, i) => {
    const rating = Math.max(1, Math.min(20, ability + (((i * 7 + ability) % 5) - 2)));
    const attrs = {};
    for (const k of ATTRS) attrs[k] = rating;
    return { id: `${name}-p${i}`, name: `${name}-p${i}`, pos, number: i + 1, fitness: 100, attrs };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const pct = (n, d) => (d ? fmt((100 * n) / d, 1) : "-");

const nearestAll = [];
let totalFrames = 0;
let boxAnyFrames = 0;          // 球在任一禁区内（纯几何，不看持球）
const strictDepth = [];        // 严格进攻持球帧：球距进攻方自己门线
let strictFrames = 0;
let looseFrames = 0;           // 有 owner 但 state 不是 held/control
let ownBoxOwnerFrames = 0;     // 有 owner 且在**己方**禁区
let boxSeconds = 0;            // 审计口径的禁区持球秒数

const bandOf = (d) => {
  if (d >= 85) return "85–105";
  if (d >= 70) return "70–85";
  if (d >= 55) return "55–70";
  if (d >= 40) return "40–55";
  if (d >= 20) return "20–40";
  return "0–20";
};

for (const seed of SEEDS) {
  const timeStep = PROFILE === "background" ? 0.3 : SIM.DT;
  const separationPasses = PROFILE === "background" ? 4 : 8;
  const engine = new SimEngine(
    makeClub(`home-${seed}`, 15),
    makeClub(`away-${seed}`, 15),
    { random: seededRandom(seed), simulationProfile: PROFILE, timeStep, separationPasses }
  );
  const steps = Math.round((90 * 60) / timeStep);
  const sampleInterval = 0.5;
  let nextSampleAt = 0;
  let lastSampleAt = null;

  for (let step = 0; step < steps; step++) {
    engine.step(timeStep);
    if (engine.t < nextSampleAt) continue;
    nextSampleAt = engine.t + sampleInterval;
    const elapsed = lastSampleAt === null ? timeStep : engine.t - lastSampleAt;
    lastSampleAt = engine.t;
    totalFrames++;

    const b = engine.ball;
    const ballY = b.y * MY;
    const nearest = Math.min(ballY, SIM.PITCH_H_METRES - ballY);
    nearestAll.push(nearest);

    const homeBox = engine._inOwnFoulBox("home", b.x, b.y);
    const awayBox = engine._inOwnFoulBox("away", b.x, b.y);
    if (homeBox || awayBox) boxAnyFrames++;

    const owner = b.owner ? engine.agentById(b.owner) : null;
    const defendingTeam = homeBox ? "home" : awayBox ? "away" : null;
    const attackerHasBall =
      !!owner && !!defendingTeam && owner.team !== defendingTeam &&
      (b.state === "held" || b.state === "control");

    if (attackerHasBall) boxSeconds += elapsed;

    if (!owner) continue;
    if (defendingTeam && owner.team === defendingTeam) { ownBoxOwnerFrames++; continue; }
    if (b.state !== "held" && b.state !== "control") { looseFrames++; continue; }

    strictFrames++;
    const ownGoalL = owner.team === "home" ? SIM.PITCH_H_METRES : 0;
    strictDepth.push(Math.abs(ballY - ownGoalL));
  }
}

console.log(`\n=== 球位占用（${SEEDS.length} 场，种子 ${SEEDS[0]}..${SEEDS[SEEDS.length - 1]}，${PROFILE} 档）===`);
console.log(`采样帧 ${totalFrames}（每 0.5 秒一帧，${SEEDS.length} 场 × 5400 秒）\n`);

console.log("--- A. 全帧几何：球距最近门线（不看持球，纯位置）---");
console.log(`  中位 ${fmt(median(nearestAll))} m`);
for (const lim of [10, 16.5, 20, 30, 40]) {
  console.log(`    < ${String(lim).padStart(4)} m 占 ${pct(nearestAll.filter((d) => d < lim).length, nearestAll.length).padStart(6)}%`);
}
console.log(`  球在任一罚球区内（_inOwnFoulBox，含己方）占全帧 ${pct(boxAnyFrames, totalFrames)}%`);

console.log("\n--- B. 严格进攻持球帧（owner 存在 + state=held/control + 不在己方禁区）---");
console.log(`  帧数 ${strictFrames} = 全帧 ${pct(strictFrames, totalFrames)}%`);
console.log(`  （被排除：己方禁区持球 ${ownBoxOwnerFrames} 帧；有 owner 但球飞行中 ${looseFrames} 帧）`);
console.log(`  球距进攻方自己门线 中位 ${fmt(median(strictDepth))} m`);
console.log("  分桶（跨度探针口径）：");
for (const b of ["0–20", "20–40", "40–55", "55–70", "70–85", "85–105"]) {
  const n = strictDepth.filter((d) => bandOf(d) === b).length;
  console.log(`    ${b.padEnd(9)} ${String(n).padStart(6)}  ${pct(n, strictDepth.length).padStart(6)}%`);
}
const third = strictDepth.filter((d) => d > 70).length;
const deep = strictDepth.filter((d) => d >= 85).length;
console.log(`  → 进攻三区（>70 m）${third} 帧；其中 85+ ${deep} 帧 = 进攻三区的 ${pct(deep, third)}%`);

console.log("\n--- C. 禁区持球秒数（逐字复刻 box-possession-sampling-audit 口径）---");
console.log(`  每场 ${fmt(boxSeconds / SEEDS.length)} 秒 = 比赛时间 ${pct(boxSeconds, totalFrames * 0.5)}%`);
console.log(`  对照：AGENTS.md 记录 v253 标准/后台 679.62/772.30 秒；该审计现护栏 ≤850 秒`);
console.log("  ⚠ 本探针每 0.5 秒采样，审计是每 0.1 秒。6 场实测：后台 776.5（差 0.5%，吻合）、");
console.log("    标准 762.6（高约 12%）。差额来自采样边界归属，不是引擎差异——标准档 0.5 秒");
console.log("    跨 5 个 step，回合首末帧的整段 0.5 秒会被归给采样瞬间的状态。");
console.log("    要精确对账请直接跑 box-possession-sampling-audit.mjs，不要用本探针当护栏。");

console.log("\n--- 读法 ---");
console.log("· A 与 C 是独立口径：A 只看位置，C 还要求进攻方真实持球。");
console.log("· B 的 85+ 占进攻三区比例若远高于组织阶段应有水平，说明「进攻三区跨度中位」");
console.log("  主要被**禁区围攻**帧拉动，而不是组织阶段的块长。");
