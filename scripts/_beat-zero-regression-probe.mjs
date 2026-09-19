/**
 * 主动突破原语 —— **零回归自检**（2026-09-18 深夜，落地 PR 的枢纽步骤）。
 *
 * 为什么这条自检是整个落地路线的前提
 * ----------------------------------
 * 设计稿 §4.1 决定把 `beat` 做成**默认关闭**的开关（`opts.beatPrimitive`），
 * 理由是：关闭时标准档应**逐位不变** ⇒ 零重标定、零回归。
 *
 * ⚠ 但那是**一个承诺**，不是证据。本探针把它变成**可执行的断言**。
 *
 * ⚠⚠ 断言**不是**「开关开/关逐位相同」—— 那在逻辑上不可能：
 *   打开开关后 `beat` 选项入池，`weightedPick` 的输入变了，消费随机数的顺序
 *   必然改变，行为**本来就该不同**。把"打开也相同"当判据，等于要求新功能无效。
 *
 * 正确的断言是**两条**，缺一不可：
 *
 *   [A] **默认口径无影响**：`beatPrimitive` **不传**（= 标准档真实调用方式）
 *       时，行为与**打补丁前的基线**逐位相同。
 *       ⇒ 这是"零回归"的正身。做法：`git stash` 掉引擎补丁跑一遍，再 `pop` 跑一遍，
 *         比对；或直接与已归档的基线读数比对。
 *   [B] **开关确实生效**：显式传 `beatPrimitive: true` 时，必须真的产生 `beat` 事件，
 *       且行为**不再**与默认口径逐位相同。
 *       ⇒ 这是 [A] 的**反假通过**保障 —— 一个永远不生效的开关当然能通过 [A]。
 *
 * 本探针把 [B] 做成自动判据；[A] 需要跨补丁版本比对，故同时提供
 * `--emit` 子命令输出可归档的签名，供外部比对：
 *
 *   node scripts/_beat-zero-regression-probe.mjs [场数] [种子起点]        # 自检（含 [B]）
 *   node scripts/_beat-zero-regression-probe.mjs --emit [场数] [种子起点] # 输出签名（供 [A] 比对）
 *
 * 用法示例（[A] 的完整流程）：
 *   git stash push js/sim/engine.js
 *   node scripts/_beat-zero-regression-probe.mjs --emit 3 372000 > /tmp/before.txt
 *   git stash pop
 *   node scripts/_beat-zero-regression-probe.mjs --emit 3 372000 > /tmp/after.txt
 *   diff /tmp/before.txt /tmp/after.txt   # 必须无输出
 */

import { SimEngine, SIM } from "../js/sim/engine.js";

const EMIT_ONLY = process.argv[2] === "--emit";
const argOffset = EMIT_ONLY ? 1 : 0;
const matches = Math.max(2, Number(process.argv[2 + argOffset]) || 6);
const seedBase = Math.max(1, Number(process.argv[3 + argOffset]) || 372000);

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

/**
 * 球队构造：**与审计（`makeClub`）对齐的 18 项属性口径**，且用**差异档**。
 * 差异档是必要的 —— 同值档下"球星 vs 普通"在构造上被抹掉，
 * `beat` 的属性结算无从体现，[D] 项会假失败（打开了却没有行为差异）。
 */
function makeClub(name) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const CORE = new Set([5, 6, 9]);
  const players = roles.map((pos, index) => {
    const id = `${name}-p${index}`;
    const rating = CORE.has(index) ? 18 : 11;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
    ]) {
      attrs[key] = rating;
    }
    if (!CORE.has(index)) {
      attrs.dribbling = 9;
      attrs.vision = 9;
      attrs.passing = 11;
    }
    return { id, name: id, pos, number: index + 1, fitness: 100, attrs };
  });
  return {
    id: name,
    name,
    players,
    tactics: {
      formation: "4-3-3",
      lineup: players.map((p) => p.id),
      pressing: 3,
      tempo: 3,
      defensiveLine: 3,
      style: "balanced",
    },
  };
}

/** 把一名球员的可观测状态压成一个可比对的字符串（逐位，不用浮点容差）。 */
function agentSig(a) {
  return [
    a.x, a.y, a.vx, a.vy, a.heading, a.fsm,
    a.role, a.isCore ? 1 : 0, a.sentOff ? 1 : 0,
    a.intent ? `${a.intent.type}:${a.intent.tx}:${a.intent.ty}` : "-",
  ].join("|");
}

function ballSig(b) {
  return [b.x, b.y, b.vx, b.vy, b.z || 0, b.state, b.owner ?? "-"].join("|");
}

function eventSig(e) {
  return [e.type, e.t, e.team ?? "-", e.agentId ?? "-", e.x ?? "-", e.y ?? "-"].join("|");
}

/**
 * 跑一场，返回完整轨迹 + 事件流 + 终局读数。
 *
 * `beatOn` 三态：
 *   · `undefined` —— **不传该选项**（= 标准档真实调用方式，用于 [A]）
 *   · `false`     —— 显式关闭（用于 [B] 的对照）
 *   · `true`      —— 显式打开（用于 [B] 的生效性）
 * 注意 `undefined` 与 `false` 在引擎里**行为相同**（都是"关闭"），
 * 但 `undefined` 才是生产路径，故 [A] 用它。
 */
function runMatch(seed, beatOn) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const opts = {
      simulationProfile: "standard",
      timeStep: SIM.DT,
      separationPasses: 8,
    };
    if (beatOn !== undefined) opts.beatPrimitive = beatOn;
    const engine = new SimEngine(makeClub(`home-${seed}`), makeClub(`away-${seed}`), opts);

    const steps = Math.round((90 * 60) / SIM.DT);
    let nextSampleAt = 0;
    const traces = [];
    const snapshot = () => {
      // 球员顺序固定（agents 的构造顺序稳定），直接按序拼
      const parts = [];
      for (const a of engine.agents) parts.push(agentSig(a));
      parts.push(ballSig(engine.ball));
      return parts.join("~");
    };

    for (let step = 0; step < steps; step++) {
      engine.step(SIM.DT);
      const t = engine.t;
      if (t < nextSampleAt) continue;
      nextSampleAt = t + SAMPLE_INTERVAL;
      traces.push(snapshot());
    }

    const tally = (type) => engine.events.filter((e) => e.type === type).length;
    const final = {
      // 24 项审计同口径的汇总量（逐位比对，不是"接近"）
      score: `${engine.score?.home ?? 0}-${engine.score?.away ?? 0}`,
      goals: tally("goal"),
      shots: tally("shot"),
      passes: tally("pass"),
      tackles: tally("tackle"),
      pressures: tally("pressure"),
      beats: tally("beat"),
      offsides: tally("offside"),
      fouls: tally("foul"),
      events: engine.events.length,
    };

    return {
      traces,
      events: engine.events.map(eventSig),
      final,
      // 便于报告：最后一次采样时的球位
      lastBall: ballSig(engine.ball),
    };
  } finally {
    Math.random = originalRandom;
  }
}

/** 找出两个轨迹数组中第一处不同的下标。 */
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  if (a.length !== b.length) return n;
  return -1;
}

/** 若两条签名不同，定位到具体是哪个字段。 */
function explainDiff(sigA, sigB) {
  const pa = sigA.split("~");
  const pb = sigB.split("~");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    const fa = (pa[i] || "").split("|");
    const fb = (pb[i] || "").split("|");
    const label = i < pa.length - 1 || i < pb.length - 1 ? `agent#${i}` : "ball";
    for (let k = 0; k < Math.max(fa.length, fb.length); k++) {
      if (fa[k] !== fb[k]) return `${label} field#${k}: ${fa[k]} vs ${fb[k]}`;
    }
  }
  return "(无法定位)";
}

/** 把一场的完整可归档签名压成一行文本（供跨版本 diff）。 */
function emitLine(seed, r) {
  return [
    `seed=${seed}`,
    `steps=${r.traces.length}`,
    `events=${r.events.length}`,
    `hash=${hashSig(r.traces.join("~") + "#" + r.events.join("~"))}`,
    `final=${JSON.stringify(r.final)}`,
  ].join(" ");
}

/** 一个简单的 FNV-1a，用来把长签名压成短摘要（用于 diff 定位）。 */
function hashSig(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

if (EMIT_ONLY) {
  // [A] 模式：只跑**默认口径**（不传 beatPrimitive），输出可归档签名。
  // 在补丁前后各跑一次，比对输出必须完全一致。
  console.log(`# beat-zero-regression --emit  baseline${matches} seeds ${seedBase}..${seedBase + matches - 1}`);
  console.log("# 判据：与打补丁前（git stash）的同命令输出**逐字节相同**。");
  for (let m = 0; m < matches; m++) {
    const seed = seedBase + m;
    console.log(emitLine(seed, runMatch(seed, undefined)));
  }
} else {
  console.log(
    `\n=== 主动突破原语·零回归自检 —— ${matches} 场，种子 ${seedBase}..${seedBase + matches - 1} ===`
  );
  console.log("判据 [A] 默认口径无影响（见 --emit）  [B] 开关确实生效且打开后有差异\n");

  let passB1 = true;   // 打开时确实产生 beat
  let passB2 = true;   // 关闭时 beat 必须为 0
  let passB3 = true;   // 打开后行为必须不同（否则开关是死的）
  const rows = [];

  for (let m = 0; m < matches; m++) {
    const seed = seedBase + m;
    const off = runMatch(seed, false);
    const on = runMatch(seed, true);

    const dTrace = firstDiff(off.traces, on.traces);
    const dEvent = firstDiff(off.events, on.events);
    const differs = dTrace !== -1 || dEvent !== -1;
    const beatsOn = on.final.beats;
    const beatsOff = off.final.beats;

    if (beatsOn <= 0) passB1 = false;
    if (beatsOff !== 0) passB2 = false;
    if (!differs) passB3 = false;

    rows.push({
      seed,
      differs,
      beatsOff,
      beatsOn,
      detail: dTrace === -1 ? "" : explainDiff(off.traces[dTrace], on.traces[dTrace]),
    });
  }

  console.log("[B] 开关生效性（关闭 vs 打开）：");
  console.log("  seed     行为有差异  beat(off/on)");
  for (const r of rows) {
    console.log(
      `  ${String(r.seed).padEnd(9)}` +
        `${(r.differs ? "是" : "否").padEnd(12)}` +
        `  ${r.beatsOff}/${r.beatsOn}` +
        (r.detail ? `\n            ↳ 首处差异 ${r.detail}` : "")
    );
  }

  const sumOff = rows.reduce((s, r) => s + r.beatsOff, 0);
  const sumOn = rows.reduce((s, r) => s + r.beatsOn, 0);

  console.log("\n  汇总：");
  console.log(`    关闭时 beat 总数 ${sumOff}（必须 = 0）`);
  console.log(`    打开时 beat 总数 ${sumOn}（必须 > 0），场均 ${(sumOn / matches).toFixed(2)}`);

  console.log("\n判定：");
  console.log(`  [B1] 关闭时 beat = 0        ${passB2 ? "✅" : "❌"}`);
  console.log(`  [B2] 打开时 beat > 0        ${passB1 ? "✅" : "❌"}`);
  console.log(`  [B3] 打开后行为确有差异      ${passB3 ? "✅" : "❌"}`);

  if (passB1 && passB2 && passB3) {
    console.log("\n✅ [B] 通过：开关接上了，且有真实行为影响。");
    console.log("   ⇒ [A]（默认口径无影响）请用 --emit 在补丁前后各跑一次并 diff：");
    console.log("       git stash push js/sim/engine.js");
    console.log("       node scripts/_beat-zero-regression-probe.mjs --emit 3 372000 > /tmp/before.txt");
    console.log("       git stash pop");
    console.log("       node scripts/_beat-zero-regression-probe.mjs --emit 3 372000 > /tmp/after.txt");
    console.log("       diff /tmp/before.txt /tmp/after.txt   # 必须无输出");
  } else {
    console.log("\n❌ [B] 未通过。");
    if (!passB1 || !passB3) {
      console.log("   ⇒ 开关**没有真正生效**。此时若去看 [A] 会得到「通过」的假象 ——");
      console.log("     一个永不生效的开关当然不影响任何东西。**不要据此宣告零回归。**");
    }
    console.log("   按设计稿 §7.2：**第 4 步不过，后面全部作废。不要往下走。**");
  }
  console.log("");
}
