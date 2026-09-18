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
 * 用法：
 *   node scripts/_box-seconds-rebaseline-probe.mjs [场数] [起始种子]        # 单次对照（control vs margin2）
 *   node scripts/_box-seconds-rebaseline-probe.mjs noise [批内场数] [批数] [档位]
 *     # 噪声标定：B 批互不重叠窗口，测「换一批种子，boxSec 读数会漂多少」
 *     # 档位 = control | margin2
 *
 * 噪声模式的动机（2026-09-18）：margin2 在 24 场三个窗口读出 878.28 / 830.98 / 864.01，
 * 均值 847.50 贴着 850 护栏。护栏是否可判，取决于**批间标准差**；不先量化它，
 * 「守 850」与「放宽到 960」都是在噪声上做决定。
 *
 * 实测结论（8 批 × 6 场 = 48 场/档，种子 372000..372047）：
 *   control 48 场均值 678.03，逐场 SD 148.20，批间 SD 59.01
 *   margin2 48 场均值 838.12，逐场 SD 100.95，批间 SD 47.89
 *   ⇒ ① 护栏不可判：margin2 均值距 850 仅 11.88s，而 48 场读数 2SE = 29.14s。
 *        逐场 SD 高达 148s（单场 326~991）⇒ 检出 20s/场 需每组约 440 场。
 *        **850 在 ≤48 场规模下没有判决力**，应降级为「爆炸半径限制」。
 *     ② 但原语效应本身极大：+160.09s，48 场 2SE 门槛仅 58.28 ⇒ 效应是门槛的 2.75 倍。
 *        「跑动原语让 boxSec 涨约 160s」已判死；6 场的 +199s 方向对、幅度被夸大。
 *   ⇒ 处置：不落引擎（+160s 是已知实质代价，纵深改善尚未证明能传导到终局指标）。
 *   归档：docs/measurements/probe-boxsec-noise-{control,margin2}-2026-09-18.txt
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const NOISE_MODE = process.argv[2] === "noise";

let matches;
let START_SEED;
let seeds;
if (NOISE_MODE) {
  matches = Math.max(2, Number(process.argv[3]) || 6);
  const batches = Math.max(2, Number(process.argv[4]) || 8);
  START_SEED = 372000;
  seeds = Array.from({ length: matches * batches }, (_, i) => START_SEED + i);
} else {
  matches = Math.max(4, Number(process.argv[2]) || 6);
  // 种子窗口：默认 372000+（与审计一致）；CLI 第 3 参数可换窗口来查「别处是否也成立」。
  START_SEED = Math.max(1, Number(process.argv[3]) || 372000);
  seeds = Array.from({ length: matches }, (_, i) => START_SEED + i);
}
const simulationProfile = "standard";
const timeStep = SIM.DT;
const separationPasses = 8;
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

/** 跑一场，返回该场读数（逐场粒度，供聚合与噪声标定共用）。 */
function runMatch(seed, usePrimitive) {
  V.on = usePrimitive;
  commit.clear();
  let boxSeconds = 0;
  let boxSpells = 0;
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
  return { seed, boxSeconds, boxSpells };
}

/** 聚合一批（或全部）逐场读数。 */
function aggregate(rows) {
  const boxSeconds = rows.reduce((s, r) => s + r.boxSeconds, 0);
  const boxSpells = rows.reduce((s, r) => s + r.boxSpells, 0);
  return {
    boxSecondsPerMatch: Number((boxSeconds / rows.length).toFixed(2)),
    boxSpellsPerMatch: Number((boxSpells / rows.length).toFixed(2)),
  };
}

/** 单次对照模式用的合并入口（保持原行为：一次跑完整个 seeds 数组）。 */
function run(usePrimitive) {
  return aggregate(seeds.map((seed) => runMatch(seed, usePrimitive)));
}

// —— 统计工具（与 `_through-pass-noise-calibration-probe.mjs` 同式）——
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const stdev = (v) => {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
const median = (v) => {
  if (!v.length) return 0;
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};
const fx = (v) => Number(v.toFixed(2));

if (NOISE_MODE) {
  // ============ 噪声标定模式 ============
  const batches = Math.max(2, Number(process.argv[4]) || 8);
  const level = (process.argv[5] || "control") === "margin2";
  const perBatch = matches;
  const total = perBatch * batches;

  console.log(
    `\n=== boxSec 噪声标定（${batches} 批 × ${perBatch} 场 = ${total} 场，` +
      `种子 ${START_SEED}..${START_SEED + total - 1}）===`
  );
  console.log(`档位：${level ? "margin2（runC1.0 + margin2）" : "control（引擎原样）"}`);
  console.log("口径：审计（17 项属性球队 + held/control 回合判据）—— 与 850 天花板同口径。");

  const batchMeans = [];
  const batchDetails = [];
  const perMatch = [];
  for (let b = 0; b < batches; b++) {
    const rows = [];
    for (let i = 0; i < perBatch; i++) {
      const seed = START_SEED + b * perBatch + i;
      const r = runMatch(seed, level);
      rows.push(r);
      perMatch.push(r);
    }
    const m = mean(rows.map((r) => r.boxSeconds));
    batchMeans.push(m);
    batchDetails.push({
      批: b + 1,
      种子: `${START_SEED + b * perBatch}..${START_SEED + b * perBatch + perBatch - 1}`,
      boxSec均值: fx(m),
      boxSpells均值: fx(mean(rows.map((r) => r.boxSpells))),
      最长: fx(Math.max(...rows.map((r) => r.boxSeconds))),
      最短: fx(Math.min(...rows.map((r) => r.boxSeconds))),
    });
    process.stderr.write(`批 ${b + 1}/${batches}: boxSec/场 ${fx(m)}\n`);
  }

  const perMatchSecs = perMatch.map((r) => r.boxSeconds);
  const sdBatch = stdev(batchMeans);
  const grandMean = mean(perMatchSecs);

  console.log("\n[1] 🔑 核心结论 —— 同一引擎、同一档位，换一批种子 boxSec 会漂多少：");
  console.log({
    "总体均值(所有场)": fx(grandMean),
    [`批内均值范围(每批 ${perBatch} 场)`]: `${fx(Math.min(...batchMeans))} ~ ${fx(
      Math.max(...batchMeans)
    )}`,
    "批间标准差": fx(sdBatch),
    "批间极差": fx(Math.max(...batchMeans) - Math.min(...batchMeans)),
    "逐场标准差": fx(stdev(perMatchSecs)),
    [`${perBatch} 场读数的标准误`]: fx(sdBatch),
    "48 场读数的标准误(外推)": fx(stdev(perMatchSecs) / Math.sqrt(48)),
  });

  console.log("\n[2] 逐批明细（每批就是一次「n 场测量」的读数）：");
  for (const d of batchDetails) {
    console.log(
      `  批 ${String(d.批).padStart(2)} 种子 ${d.种子.padEnd(15)} ` +
        `boxSec/场 ${String(d.boxSec均值).padStart(7)}  spells/场 ${String(d.boxSpells均值).padStart(7)}  ` +
        `单场 ${d.最短} ~ ${d.最长}`
    );
  }

  console.log("\n[3] ⚖ 判决 —— 850 护栏在这个噪声水平下是否可判：");
  {
    // 用**本档实测总体均值**判，不硬编码任何历史数字（否则易不自洽）。
    const n = perMatchSecs.length;
    const seN = stdev(perMatchSecs) / Math.sqrt(n);
    const se24 = stdev(perMatchSecs) / Math.sqrt(24);
    const delta = Math.abs(850 - grandMean);
    console.log({
      "本档总体均值(所有场)": fx(grandMean),
      "护栏": 850,
      "护栏与观测均值之差": fx(delta),
      "本档实测场数": n,
      "本档全样本读数标准误": fx(seN),
      "⇒ 2SE(全样本)": fx(2 * seN),
      "（若只看 24 场）24 场标准误": fx(se24),
      "（若只看 24 场）2SE": fx(2 * se24),
    });
    console.log(
      delta < 2 * seN
        ? `   ⇒ ⛔ 差距 ${fx(delta)}s < 2SE=${fx(2 * seN)}s（${n} 场口径）⇒ ` +
            `**本档样本量分不出过/破**，护栏落在噪声尺度内，不可作为判决线。`
        : `   ⇒ ✅ 差距 ${fx(delta)}s ≥ 2SE=${fx(2 * seN)}s ⇒ 可判。`
    );
    console.log("  各效应量所需的每组场数（2SE 判据，两独立样本，用逐场标准差）：");
    const sdMatch = stdev(perMatchSecs);
    for (const eff of [5, 10, 20, 50]) {
      const n = Math.ceil(2 * ((2 * sdMatch) / eff) ** 2);
      console.log(`    效应 ${String(eff).padStart(2)}s/场 → 每组约 ${String(n).padStart(5)} 场`);
    }
  }
} else {
  // ============ 单次对照模式（原行为） ============
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
      "· ⚠ 单次对照**不足以**判决护栏 —— 先跑 noise 模式量化批间标准差，再读单次对照的方向。",
    ].join("\n")
  );
}
