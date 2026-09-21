/**
 * 「球员读懂战术了吗？」—— 战术层 / 个体层的配对 A/B 摸底（2026-09-22，**只读**）
 *
 * ## 为什么写它
 *
 * 审计（explorer，2026-09-22）查明：现有 100 来个探针里，
 * **「战术参数 → 逐人位置」只有 `defensiveLine` 有一条 e2e 链**
 * （`scripts/cb-line-height-e2e-audit.mjs`）；而
 * `width` / `tempo` / `style` / 阶段阵型 **从没被扫过**（在 fixtures 里只作为字面量出现）；
 * **「属性 → 选择」全仓只有一次**（`player-traits-set-pieces-audit.mjs` 的 heading/strength）。
 *
 * ⇒ 没人回答过「把宽度从 1 调到 5，球员站位真的变宽了吗」和
 *   「视野好的中场真的更爱打穿透球吗」。本探针补这两问。
 *
 * ## 设计（关键是**配对**，不是总量）
 *
 * 同一 `random` 种子、同一批球员、同一时长，**只改一个旋钮** ⇒ 差异可归因。
 * 主队改旋钮、**客队永远保持默认** —— 客队是对照组。
 *
 * 测得的是**逐人位置**（不是队形总量）：
 *   · `depth`   = 距**己方**球门的纵深（0=贴门，100=对方门），用引擎自己的
 *                 `_depthFromOwnGoal` ⇒ 换边无关，可直接跨场比较
 *   · `lateral` = |x − 50| 横向离中线（格 → 米 ×0.68）
 * 按 **角色 × 控球阶段** 分开统计（阶段用引擎自己的 `teamPhases`）。
 *
 * 另有**持球时长**：`tempo` 直接改的是「拿球后多久做决定」，
 * 用传球总数看不出来（传球数受控球时间支配），所以单独记「球归某人所有 → 到他失去球权」
 * 的连续段（每 0.1 s 采一次 owner，只统计 ≥0.3 s 的段）。
 *
 * ## 判据（先写在前面，避免事后找理由）
 *
 * **旋钮「被读懂」** = 目标指标**单调**变化，且幅度**明显大于**跨种子 SD。
 * 平 / 非单调 / 中央球员与边路同幅 ⇒ 没读懂。
 * **属性「驱动选择」** = 只改**选择分布**（占比），不该改「能做的事的数量」。
 *
 * ## 用法
 *
 *   node scripts/_tactics-understanding-probe.mjs [种子数=4] [分钟=30]
 *
 * ⚠ 必须传 `opts.random`（引擎不认 `opts.seed`）。本文件**不**改产品代码。
 */

import { SimEngine } from "../js/sim/engine.js";

const SEEDS = Math.max(1, Number(process.argv[2]) || 4);
const MINUTES = Math.max(5, Number(process.argv[3]) || 30);
const DT = 0.1;
const STEPS = Math.round((MINUTES * 60) / DT);
const SAMPLE_EVERY = 5; // 位置每 0.5 s 采一次
const WARMUP_STEPS = Math.round(30 / DT); // 前 30 s 不采（开局落位未稳）
const MX = 0.68; // 格 → 米（x）

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 属性用原始 1..20 分制（引擎 `norm()` 会归一）。15 ≈ 引擎级 0.76 */
function makeClub(name, attrOverrides = {}) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((role, i) => {
    const attrs = {};
    for (const k of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical",
      "finishing", "tackling", "marking", "strength", "stamina", "vision",
      "reflexes", "handling", "positioning", "kicking", "decisions",
      "crossing", "heading",
    ]) attrs[k] = 15;
    for (const [k, v] of Object.entries(attrOverrides)) {
      if (k.startsWith("__")) continue;
      if (role === "MID" || attrOverrides.__all) attrs[k] = v;
    }
    return { id: `${name}-${i}`, name: `${name} ${i}`, role, number: i + 1, attrs, playingHabits: [] };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((p) => p.id),
      pressing: 3, tempo: 3, defensiveLine: 3, width: 3, style: "balanced",
    },
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const fmt = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");

/** 跑一场，采主队逐人位置 + 持球段 + 事件统计 */
function runMatch({ seed, homeTactics = {}, homeAttrs = null }) {
  const eng = new SimEngine(makeClub("h", homeAttrs || {}), makeClub("a"), {
    random: mulberry32(seed),
  });
  Object.assign(eng.home.tactics, homeTactics);

  const acc = {
    byRole: {}, // `${role}|${phase}` → 逐样本
    phases: {},
    homePasses: 0,
    homeThrough: 0,
    homeCross: 0,
    homeShots: 0,
    homeIntercepted: 0,
    holdRuns: [],
  };
  const bump = (key, depth, lateral, central) => {
    const slot = (acc.byRole[key] ||= { depth: [], lateral: [], lateralCentral: [] });
    slot.depth.push(depth);
    if (central) slot.lateralCentral.push(lateral);
    else slot.lateral.push(lateral);
  };

  let evIdx = 0;
  let prevOwner = null;
  let runStart = 0;

  for (let i = 0; i < STEPS; i += 1) {
    eng.step();

    const evs = eng.events;
    for (; evIdx < evs.length; evIdx += 1) {
      const e = evs[evIdx];
      if (e.type === "pass" && e.team === "home") {
        acc.homePasses += 1;
        if (e.through) acc.homeThrough += 1;
        if (e.cross) acc.homeCross += 1;
      }
      if (e.type === "shot" && e.team === "home") acc.homeShots += 1;
      if (e.type === "intercept" && e.team === "away") acc.homeIntercepted += 1;
    }

    if (i < WARMUP_STEPS) continue;

    // 持球段（每步都看，精度 0.1 s）
    const owner = eng.ball.owner;
    if (owner !== prevOwner) {
      if (prevOwner != null) {
        const dur = i * DT - runStart;
        if (dur >= 0.3) acc.holdRuns.push(dur);
      }
      prevOwner = owner;
      if (owner != null) runStart = i * DT;
    }

    // 位置（每 0.5 s）
    if (i % SAMPLE_EVERY === 0) {
      const phase = eng.teamPhases?.home || "unknown";
      acc.phases[phase] = (acc.phases[phase] || 0) + 1;
      for (const a of eng.agents) {
        if (a.team !== "home" || a.role === "GK" || a.sentOff) continue;
        bump(
          `${a.role}|${phase}`,
          eng._depthFromOwnGoal(a.y, a.team),
          Math.abs(a.x - 50) * MX,
          Math.abs(a.baseX - 50) < 8 // 中央槽位
        );
      }
    }
  }
  return acc;
}

/** 每个档位 → 「每种子一个均值」（跨种子才是独立样本） */
function collect(levelsRuns) {
  const out = {};
  for (const [levelKey, runs] of Object.entries(levelsRuns)) {
    const perSeed = runs.map((acc) => {
      const o = { depth: {}, lateral: {} };
      for (const role of ["DEF", "MID", "ATT"]) {
        for (const phase of [
          "in-possession", "out-of-possession", "attacking-transition", "defensive-transition",
        ]) {
          const s = acc.byRole[`${role}|${phase}`];
          if (s && s.depth.length) {
            o.depth[`${role}|${phase}`] = mean(s.depth);
            o.lateral[`${role}|${phase}`] = mean(s.lateral);
          }
        }
      }
      o.passRate = acc.homePasses;
      o.throughShare = acc.homePasses ? acc.homeThrough / acc.homePasses : NaN;
      o.crossShare = acc.homePasses ? acc.homeCross / acc.homePasses : NaN;
      o.shots = acc.homeShots;
      o.lostPerPass = acc.homePasses ? acc.homeIntercepted / acc.homePasses : NaN;
      o.holdMedian = median(acc.holdRuns);
      o.holdCount = acc.holdRuns.length;
      return o;
    });
    const keys = new Set();
    for (const s of perSeed) for (const k of Object.keys(s.depth)) keys.add(k);
    out[levelKey] = { perSeed, keys };
  }
  return out;
}

const shortPhase = (p) =>
  p.replace("in-possession", "in")
    .replace("out-of-possession", "out")
    .replace("attacking-transition", "attTr")
    .replace("defensive-transition", "defTr");

function table(title, levels, keys, metric) {
  console.log(`\n${title}`);
  const head = [...keys].filter((k) => levels.some(([, v]) => v.perSeed.some((s) => s[metric]?.[k] != null)));
  if (!head.length) {
    console.log("  （无样本）");
    return;
  }
  console.log("  档位        " + head.map((k) => {
    const [role, phase] = k.split("|");
    return `${role}/${shortPhase(phase)}`.padStart(13);
  }).join(""));
  for (const [label, v] of levels) {
    const cells = head.map((k) => {
      const xs = v.perSeed.map((s) => s[metric]?.[k]).filter(Number.isFinite);
      if (!xs.length) return "—".padStart(13);
      return `${fmt(mean(xs), 1)}±${fmt(sd(xs), 1)}`.padStart(13);
    });
    console.log(`  ${label.padEnd(11)}` + cells.join(""));
  }
}

function scalar(title, levels, pick, digits = 3) {
  console.log(`\n${title}`);
  console.log("  档位        均值 ± 跨种子SD");
  for (const [label, v] of levels) {
    const xs = v.perSeed.map(pick).filter(Number.isFinite);
    if (!xs.length) {
      console.log(`  ${label.padEnd(11)} —`);
      continue;
    }
    console.log(`  ${label.padEnd(11)} ${fmt(mean(xs), digits)} ± ${fmt(sd(xs), digits)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`配对 A/B：${SEEDS} 种子 × ${MINUTES} 分钟（主队改旋钮，客队恒默认作对照）`);
console.log("阶段用引擎自己的 teamPhases；位置用 _depthFromOwnGoal（换边无关）");

// ── [0] 前提：阶段系统是否在跑 ──────────────────────────────────────────────
{
  const acc = runMatch({ seed: 700001 });
  const total = Object.values(acc.phases).reduce((a, b) => a + b, 0) || 1;
  console.log(`\n[0] 阶段系统自检（teamPhases 分布，${MINUTES}′）`);
  for (const [k, v] of Object.entries(acc.phases).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(24)} ${((v / total) * 100).toFixed(1)}%`);
  }
  console.log(
    `   ⇒ ${Object.keys(acc.phases).length > 1 ? "阶段在切换（系统活着）" : "⚠ 只有一个阶段 ⇒ 阶段系统没跑"}`
  );
  console.log(
    "   （默认 possessionFormation / outOfPossessionFormation 都是 null ⇒" +
      " _applyExplicitShapeAnchor 不生效；teamPhases 本身仍应随控球切换。）"
  );
}

// ── [A] 旋钮 → 逐人位置 ─────────────────────────────────────────────────────
const numericKnobs = [
  ["width", [1, 3, 5]],
  ["defensiveLine", [1, 3, 5]],
  ["pressing", [1, 3, 5]],
  ["tempo", [1, 3, 5]],
];

for (const [knob, levels] of numericKnobs) {
  const runs = {};
  for (const lv of levels) {
    runs[`${knob}=${lv}`] = [];
    for (let s = 0; s < SEEDS; s += 1) {
      runs[`${knob}=${lv}`].push(runMatch({ seed: 710000 + s, homeTactics: { [knob]: lv } }));
    }
  }
  const coll = collect(runs);
  const pair = levels.map((lv) => [`${knob}=${lv}`, coll[`${knob}=${lv}`]]);
  table(`\n[A] ${knob} → 距己方门纵深（格，越大越靠前）`, pair, pair[0][1].keys, "depth");
  table(`     同档 → 横向 |x−50|（米，仅非中央槽位）`, pair, pair[0][1].keys, "lateral");
  scalar(`     ${knob} → 持球时长中位（秒）`, pair, (s) => s.holdMedian, 3);
  scalar(`     ${knob} → 主队传球数`, pair, (s) => s.passRate, 1);
  scalar(`     ${knob} → 穿透球占比`, pair, (s) => s.throughShare, 4);
  scalar(`     ${knob} → 被断/传球`, pair, (s) => s.lostPerPass, 4);
}

{
  const styleLevels = ["defend", "balanced", "attack", "possession", "counter"];
  const runs = {};
  for (const lv of styleLevels) {
    runs[`style=${lv}`] = [];
    for (let s = 0; s < SEEDS; s += 1) {
      runs[`style=${lv}`].push(runMatch({ seed: 720000 + s, homeTactics: { style: lv } }));
    }
  }
  const coll = collect(runs);
  const pair = styleLevels.map((lv) => [`style=${lv}`, coll[`style=${lv}`]]);
  table(`\n[A] style → 距己方门纵深（格）`, pair, pair[0][1].keys, "depth");
  scalar(`     style → 持球时长中位（秒）`, pair, (s) => s.holdMedian, 3);
  scalar(`     style → 主队传球数`, pair, (s) => s.passRate, 1);
  scalar(`     style → 穿透球占比`, pair, (s) => s.throughShare, 4);
}

// ── [B] 属性 → 选择分布 ─────────────────────────────────────────────────────
// 原始 0.6 ≈ 引擎级 0.30（低）；20 = 引擎级 0.92（高）
const ATTR_CASES = [
  ["vision", 0.6, 20],
  ["decisions", 0.6, 20],
];
for (const [attr, lo, hi] of ATTR_CASES) {
  const loKey = "低(引擎0.30)";
  const hiKey = "高(引擎0.92)";
  const runs = { [loKey]: [], [hiKey]: [] };
  for (let s = 0; s < SEEDS + 1; s += 1) {
    runs[loKey].push(runMatch({ seed: 730000 + s, homeAttrs: { [attr]: lo } }));
    runs[hiKey].push(runMatch({ seed: 730000 + s, homeAttrs: { [attr]: hi } }));
  }
  const coll = collect(runs);
  const pair = [loKey, hiKey].map((k) => [k, coll[k]]);
  console.log(`\n[B] 三个中场的 ${attr}：${loKey} vs ${hiKey}（同一批种子，配对）`);
  scalar(`     ${attr} → 主队传球数`, pair, (s) => s.passRate, 1);
  scalar(`     ${attr} → 穿透球占比（through/pass）`, pair, (s) => s.throughShare, 4);
  scalar(`     ${attr} → 传中占比`, pair, (s) => s.crossShare, 4);
  scalar(`     ${attr} → 被断/传球（越低越好）`, pair, (s) => s.lostPerPass, 4);
  scalar(`     ${attr} → 射门数`, pair, (s) => s.shots, 1);
}

console.log("\n判据回顾：");
console.log("  · 旋钮「被读懂」= 目标指标**单调**变化且幅度明显大于跨种子 SD；");
console.log("    平 / 非单调 / 中央与边路同幅 ⇒ 没读懂。");
console.log("  · 属性「驱动选择」= 只改**分布**（占比），不改「能做的事的数量」。");
