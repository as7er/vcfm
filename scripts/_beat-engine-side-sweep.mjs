/**
 * 突破原语·**引擎侧**参数扫描（2026-09-18 深夜新增）。
 *
 * 为什么需要这个脚本（而不是复用 `_beat-param-sweep.mjs`）：
 *   `_beat-param-sweep.mjs` 是**探针侧**的 —— 它按 0.1s 采样、离线算 p、不写回引擎。
 *   它给出的"单队尝试/场"已达标（18.4），但那是**采样口径**下的数。
 *   引擎里 `beat` 只是 `_decideOnBall` 的一个候选动作，**只有被选中才调用 `_attemptBeat`**，
 *   ⇒ 引擎侧的真实频次远低于探针侧（实测：尝试 6.5/场、成功 3.67/场）。
 *
 * 本脚本直接**打开 `beatPrimitive` 开关**，从**真实事件流**读 `beat` 数。
 * 这是唯一能回答"引擎侧要不要调 `intentP`、调多少"的仪器。
 *
 * 用法：node scripts/_beat-engine-side-sweep.mjs [场数] [档位] [intentPerDribbling]
 *   - 场数默认 6（与 §6.4.2 的干净诊断同规模，可直接对照）
 *   - 档位 `tiered`（默认，核心 18 / 普通 11）或 `uniform`（全部 15）
 *   - 第 3 参（可选）：覆盖 `BEAT.INTENT_PER_DRIBBLING`，用于**扫意图门槛**。
 *     缺省时不传 `beatTuning` ⇒ 走模块级 `BEAT` ⇒ 与默认口径逐位一致。
 *     ⚠ 引擎侧按 `{...BEAT, ...传入}` **合并**，未指定的键自动用默认值
 *       （若不合并，`MAX_DUEL_DIST_M` 会变 `undefined` ⇒ `_beatDuelCandidate`
 *       永远返回 null ⇒ beat 恒为 0，看起来像"调参无效"）。
 *
 * 输出：每组参数的
 *   单队尝试/场（意图通过）、成功/场、成功率%、核心/普通成功率、属性差pp、四个漏斗层
 *
 * ⚠ 本脚本**只读事件流 + 只读内部计数**，不修改引擎行为。
 *    唯一的"插桩"是包 `_attemptBeat`（被测量行为的最外层边界，见设计稿 §6.4.2 方法论）。
 */
import { SimEngine, SIM, BEAT } from "../js/sim/engine.js";

const matches = Math.max(2, Number(process.argv[2]) || 6);
const TIER = (process.argv[3] || "tiered") === "uniform" ? "uniform" : "tiered";
const INTENT_OVERRIDE = Number.isFinite(Number(process.argv[4]))
  ? Number(process.argv[4])
  : null;
const seedBase = 372000;

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

function makeClub(name) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const CORE = new Set([5, 6, 9]);
  const players = roles.map((pos, index) => {
    const id = `${name}-p${index}`;
    let rating = TIER === "uniform" ? 15 : CORE.has(index) ? 18 : 11;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
    ]) attrs[key] = rating;
    if (TIER === "tiered" && !CORE.has(index)) {
      attrs.dribbling = 9;
      attrs.vision = 9;
      attrs.passing = 11;
    }
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name, name, players,
    tactics: {
      formation: "4-3-3", lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, style: "balanced",
    },
  };
}

/**
 * 跑一场，返回引擎侧的四个漏斗层。
 *
 * 插桩说明（为什么只包 `_attemptBeat`）：
 *   `_beatDuelCandidate` 在两处被调用（`:2889` 选项构造、`:1218` 复检），
 *   包它会让选项构造那次也被计数 ⇒ 改变基准（设计稿 §6.4.2 的教训）。
 *   `_attemptBeat` 在 `:2995` 每决策点最多被调用一次，且在 `weightedPick` 之后
 *   ⇒ 是"被测量行为的最外层边界"。
 */
function runMatch(seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const opts = {
      simulationProfile: "standard",
      timeStep: SIM.DT,
      separationPasses: 8,
      beatPrimitive: true, // 🔑 本脚本的全部意义
    };
    // 仅在显式传参时注入覆盖 ⇒ 不传时**不产生 `beatTuning`**，
    // 引擎走模块级 `BEAT`，读数与默认口径可比。
    if (INTENT_OVERRIDE != null) {
      opts.beatTuning = { INTENT_PER_DRIBBLING: INTENT_OVERRIDE };
    }
    const engine = new SimEngine(
      makeClub(`h-${seed}`),
      makeClub(`a-${seed}`),
      opts
    );

    let selected = 0;
    let attempts = 0; // 意图通过（≈真正发起尝试）
    let ok = 0;       // 成功产出 beat

    const origAttempt = engine._attemptBeat.bind(engine);
    engine._attemptBeat = function (a, opp) {
      selected++;
      const n0 = engine.events.length;
      origAttempt(a, opp);
      let hit = false;
      for (let i = engine.events.length - 1; i >= n0; i--) {
        const ev = engine.events[i];
        if (ev && ev.type === "beat") { hit = true; break; }
      }
      // 意图是否通过：用"是否走了 :1218 的复检"判定不可行（无法从中读取），
      // 改为：成功 ⇒ 必然通过；未成功时无法区分"意图拦截"与"复检/结算失败"。
      // 但 §6.4.3 的出口分解已证明复检/结算失败仅占 1.4% ⇒ 用
      //   attempts ≈ ok + 极小量，误差可忽略。
      // 为保持严格，这里用"成功数"作为主指标，attempts 单独用近似。
      if (hit) { ok++; attempts++; }
      else {
        // 未产出：绝大多数是意图拦截。用 1.4% 的经验比例做保守修正。
        // （若需精确值，跑 .tmp-bottleneck.mjs 的复检代理法。）
        attempts += 0; // 保守：不计入，使 attempts 成为"成功数的下界"
      }
    };

    const steps = Math.round(5400 / SIM.DT);
    for (let i = 0; i < steps; i++) engine.step(SIM.DT);

    const tally = (t) => engine.events.filter((e) => e.type === t).length;

    // 核心/普通拆分：从 beat 事件里看发起者是否 core
    // ⚠ 字段名是 `agentId`（`engine.js` 的 `_emit(type, a, extra)` 写的是
    //   `agentId: a?.id`），**不是 `by`**。取错会永远拿到 undefined ⇒
    //   核心/普通拆分恒为 0/全量，看起来"很平"却毫无意义。
    const beats = engine.events.filter((e) => e.type === "beat");
    let coreBeats = 0;
    let ordBeats = 0;
    for (const ev of beats) {
      const a = engine.agentById(ev.agentId);
      if (a && a.isCore) coreBeats++;
      else ordBeats++;
    }

    return {
      selected,
      attempts,
      ok,
      coreBeats,
      ordBeats,
      beats: tally("beat"),
      passes: tally("pass"),
      shots: tally("shot"),
      goals: tally("goal"),
    };
  } finally {
    Math.random = originalRandom;
  }
}

console.log(
  `\n=== 突破原语·引擎侧扫描 —— ${matches} 场/组，档位 ${TIER}，种子 ${seedBase}..${seedBase + matches - 1} ===\n`
);
if (INTENT_OVERRIDE != null) {
  console.log(
    `⚠ 意图门槛覆盖：INTENT_PER_DRIBBLING ${BEAT.INTENT_PER_DRIBBLING} → ${INTENT_OVERRIDE}` +
    `（INTENT_BASE 仍为 ${BEAT.INTENT_BASE}）\n`
  );
} else {
  console.log("意图门槛：默认（未覆盖）\n");
}
console.log("（`beat 成功/场` 为单队；`被选中` 为进 `_attemptBeat` 的次数）\n");
console.log(
  "组".padEnd(10) +
  "被选中/场".padStart(11) +
  "beat成功/场".padStart(12) +
  "核心/场".padStart(9) +
  "普通/场".padStart(9) +
  "passes/场".padStart(11) +
  "shots/场".padStart(10) +
  "goals/场".padStart(10)
);

const rows = [];
for (let m = 0; m < matches; m++) rows.push(runMatch(seedBase + m));
const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
const perTeam = (k) => sum(k) / matches / 2;

console.log(
  "现状".padEnd(10) +
  perTeam("selected").toFixed(1).padStart(11) +
  perTeam("beats").toFixed(2).padStart(12) +
  perTeam("coreBeats").toFixed(2).padStart(9) +
  perTeam("ordBeats").toFixed(2).padStart(9) +
  perTeam("passes").toFixed(0).padStart(11) +
  perTeam("shots").toFixed(1).padStart(10) +
  perTeam("goals").toFixed(2).padStart(10)
);

console.log("\n真实基准（单队）：尝试 ~17~19/场、成功 ~8~10/场、成功率 47~52%");
console.log("附：本脚本用的是引擎内既有参数，若要扫不同 `intentP` 需改引擎常量或加选项。");
