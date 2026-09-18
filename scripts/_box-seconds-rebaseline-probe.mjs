/**
 * 重标定探针：`runC1.0+margin2` 在**审计口径**下的 boxSeconds（2026-09-18）。
 *
 * 为什么需要它：`box-possession-sampling-audit.mjs` 的 850 天花板是拿**审计自己的
 * 球队构造**（`makeClub`，17 项属性、无 `crossing`、能力 15）与**它自己的种子窗口**测的。
 * 而跑动原语只在 `_final-third-movement-calibration-probe.mjs` 里挂过，那个探针的
 * `club()` 是 18 项属性（**带 `crossing`**）。二者的 boxSec 差 **+51.5s**（同种子 6 场受控 A/B）
 * ⇒ **不能把探针的 boxSec 直接拿去和审计的 850 比。**
 *
 * 本探针 = 把审计的球队构造 / 回合判据 / 采样循环**逐字搬过来**，只多挂一个跑动原语。
 * 输出两档：`control`（不挂）与 `margin2`（挂 `runC1.0+margin2`）。
 * `control` 档必须与 `box-possession-sampling-audit.mjs` 的 boxSecondsPerMatch **逐位相同** ——
 * 这是本仪器的自检，不通过则整表作废。
 *
 * 用法：node scripts/_box-seconds-rebaseline-probe.mjs [场数]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(4, Number(process.argv[2]) || 6);
const simulationProfile = "standard";
const timeStep = SIM.DT;
const separationPasses = 8;
const SAMPLE_INTERVAL = 0.1;
// 种子窗口：默认 372000+（与审计一致）；CLI 第 2 参数可换窗口来查「别处是否也成立」。
const START_SEED = Math.max(1, Number(process.argv[3]) || 372000);
const seeds = Array.from({ length: matches }, (_, i) => START_SEED + i);

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

/** 与审计逐字相同的球队构造（17 项属性、无 `crossing`） */
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

// —— 跑动原语（与校准探针 `runC1.0+margin2` 同语义，逐字对齐）——
const ORIG = { think: SimEngine.prototype._thinkAttackOffBall };
const V = { on: false, lead: 1.0, margin: 2 };
const commit = new Map();

SimEngine.prototype._thinkAttackOffBall = function _probe(a, owner) {
  ORIG.think.call(this, a, owner);
  if (!V.on) return;
  const dir = this.attackDir(a.team);
  const ownGoalY = a.team === "home" ? SIM.HOME_GOAL_Y : SIM.AWAY_GOAL_Y;
  const prog = Math.abs(this.ball.y - ownGoalY) / 100;
  if (!(prog > 0.64)) return;
  const t = Number.isFinite(this.t) ? this.t : 0;
  const held = commit.get(a.id);
  const holding = !!(held && t < held.arriveBy && held.dir === dir);
  if (holding) {
    a.tx = held.tx;
    a.ty = held.ty;
    return;
  }
  commit.delete(a.id);
  if (!(a.role === "ATT" || this._isPrimaryMidRunner(a))) return;
  const lineY = this._offsideLineY(a.team);
  if (Number.isFinite(lineY)) {
    const safeLine = lineY - dir * V.margin;
    a.ty = a.team === "home" ? Math.min(a.ty, safeLine) : Math.max(a.ty, safeLine);
  }
  const speed = Number(a.speedMax) || 7.0;
  const dist = Math.hypot((a.tx - a.x) * 1.05, (a.ty - a.y) * 1.05);
  commit.set(a.id, { tx: a.tx, ty: a.ty, arriveBy: t + (dist / speed) * V.lead + 0.05, dir });
};

function run(usePrimitive) {
  V.on = usePrimitive;
  commit.clear();
  let boxSeconds = 0;
  let boxSpells = 0;
  for (const seed of seeds) {
    const originalRandom = Math.random;
    Math.random = seededRandom(seed);
    try {
      const engine = new SimEngine(
        makeClub(`home-${seed}`, 15),
        makeClub(`away-${seed}`, 15),
        { simulationProfile, timeStep, separationPasses }
      );
      const steps = Math.round((90 * 60) / timeStep);
      let nextSampleAt = 0;
      let lastSampleAt = null;
      // ⚠ 与审计逐字相同的回合判据：必须有人**持球**（`held`/`control`），
      //   且持球方不是球所在禁区的归属方。第一版我用 `_inOwnFoulBox(ball.team)` 裸判，
      //   把飞行中的球也算成回合 ⇒ control 读到 600.95 而非审计的 679.53（自检不过）。
      let spell = null;
      for (let step = 0; step < steps; step++) {
        engine.step(timeStep);
        if (engine.t < nextSampleAt) continue;
        nextSampleAt = engine.t + SAMPLE_INTERVAL;
        const elapsed = lastSampleAt === null ? timeStep : engine.t - lastSampleAt;
        lastSampleAt = engine.t;

        const b = engine.ball;
        const owner = b.owner ? engine.agentById(b.owner) : null;
        const defendingTeam = engine._inOwnFoulBox("home", b.x, b.y)
          ? "home"
          : engine._inOwnFoulBox("away", b.x, b.y)
            ? "away"
            : null;
        const attackerHasBall =
          !!owner && !!defendingTeam && owner.team !== defendingTeam &&
          (b.state === "held" || b.state === "control");

        if (!attackerHasBall) continue;
        if (!spell || spell.team !== owner.team) {
          spell = { team: owner.team };
          boxSpells++;
        }
        boxSeconds += elapsed;
      }
    } finally {
      Math.random = originalRandom;
    }
  }
  return {
    boxSecondsPerMatch: Number((boxSeconds / matches).toFixed(2)),
    boxSpellsPerMatch: Number((boxSpells / matches).toFixed(2)),
  };
}

const control = run(false);
const margin2 = run(true);

console.log(`\n=== boxSeconds 在**审计口径**下的重标定（${matches} 场，种子 ${seeds[0]}..${seeds[seeds.length - 1]}）===`);
console.log("\n[0] 仪器自检 —— 本探针 control 必须与 `box-possession-sampling-audit.mjs` 的读数逐位相同：");
console.log(
  `  control boxSeconds/场 = ${control.boxSecondsPerMatch}   boxSpells/场 = ${control.boxSpellsPerMatch}`
);
console.log(
  `  ⚠ 比对命令：node scripts/box-possession-sampling-audit.mjs ${matches}` +
    "（看它的 boxSecondsPerMatch / boxSpellsPerMatch）"
);

console.log("\n[1] 两档对照：");
const d = margin2.boxSecondsPerMatch - control.boxSecondsPerMatch;
console.log(
  `  ${"control".padEnd(10)} boxSeconds/场 ${String(control.boxSecondsPerMatch).padStart(8)}` +
    `   boxSpells/场 ${String(control.boxSpellsPerMatch).padStart(7)}`
);
console.log(
  `  ${"margin2".padEnd(10)} boxSeconds/场 ${String(margin2.boxSecondsPerMatch).padStart(8)}` +
    `   boxSpells/场 ${String(margin2.boxSpellsPerMatch).padStart(7)}` +
    `   （比 control ${d >= 0 ? "+" : ""}${d.toFixed(2)}）`
);

console.log("\n[2] 读法：");
console.log(
  [
    "· 这一档的 boxSeconds 才是**与审计 850 天花板同口径**的数字；校准探针的 855.58 不可直接比（17 vs 18 项属性）。",
    "· 若 margin2 在此口径下 ≤850，则**不需要重标天花板** —— 原来的「顶破」是跨口径比较造成的假象。",
    "· 若 >850，则需按 v252 先例重标（v252 是**收紧**：1200→850；本次将是**放宽**，须在注释里写明理由与代价）。",
  ].join("\n")
);
