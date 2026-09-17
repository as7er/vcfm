/**
 * 诊断：防守方「在本方禁区内触球」的**起点深度**，是否受防线高度（`defensiveLine`）影响？
 *
 * 起因（2026-09-17）：`_box-clearance-landing-probe.mjs` 修正判据后重测（18 场，n=1734）
 * 发现落点留在禁区内的成因**不是「球飞得不够远」**（位移中位 33.6 单位已贴物理上限
 * `v·DT/(1-0.96)/1.05`），而是**起点太深**——中位起脚点离本方球门仅 **7.38 单位**，
 * 而禁区纵深 16 单位。分种类对照：`loose` 起点比 `pass` 深 1.52 单位、留内率高 10.6pp
 * （每深 1 单位 → 留内概率 +7.0pp）。
 *
 * ⇒ 于是产生一个**新的、尚未量过的问题**：为什么防守方总在门线前 7 单位处触球？
 *   AGENTS.md 已有 `0692c6a`：中卫线前压按 `defensiveLine` 缩放
 *   （`cbShiftMax = CB_BLOCK_SHIFT_MAX_M * (1 + (line-3) * 0.35)`，`engine.js:3776-3778`）。
 *   而 `match-realism-audit` 与本探针所用的审计口径**都把防线写死成 3**
 *   ⇒ 乘数恰为 1.0，所以此前量到的 7.38 是**「防线 3 级」这一个点**，不是普遍值。
 *
 * 本探针只回答一个问题：**起点深度对 `defensiveLine` 敏感吗？**
 *   若敏感 ⇒ 起点深度是一个**已被现有杠杆（防线战术）覆盖**的量，
 *            不该再去找新旋钮；应改为检查「防线 5 级是否仍留内」。
 *   若不敏感 ⇒ 说明前压的是中卫线（block），而触球发生在更深的位置
 *            （门将/封堵/救援），**防线高度管不到它**，杠杆在别处。
 *
 * 三个配置（同种子、同能力，**单一变量**：只有 home 的 defensiveLine 不同）：
 *   L1: home 防线 1（很深/回收）  —— cbShift 乘数 0.30
 *   L3: home 防线 3（标准）       —— 乘数 1.00（= 审计口径，应精确复现 7.38）
 *   L5: home 防线 5（很高/压上）  —— 乘数 1.70
 * 只统计 **home** 的触球，away 恒为 3 以保持背景不变。
 *
 * 判据与 `_box-clearance-landing-probe.mjs` **逐字一致**（含 `pass || loose` 修正）：
 * 起点 `_inOwnFoulBox(team, kickX, kickY)`，落点 = 状态再变/易主那一帧。
 *
 * 全程只读引擎公开状态，不消费额外随机数，不改引擎。
 * 用法：node scripts/_box-origin-depth-probe.mjs [场数]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

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

function makeClub(name, ability, defensiveLine) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = roles.map((pos, index) => {
    const variance = ((index * 7 + ability) % 5) - 2;
    const rating = Math.max(1, Math.min(20, ability + variance));
    const id = `${name}-p${index}`;
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
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
      defensiveLine,
      style: "balanced",
    },
  };
}

const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};
const pct = (num, den) => Number(((num / Math.max(1, den)) * 100).toFixed(1));
const quantile = (values, q) => {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  return Number(s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2));
};

const matchCount = Math.max(1, Number(process.argv[2]) || 18);
const seeds = Array.from({ length: matchCount }, (_, i) => 372000 + i);
const timeStep = SIM.DT;

// —— 单次运行：给定 home 防线高度，回收 home 的触球统计 ——
function run(line) {
  const stats = {
    line,
    kicks: 0,
    landedInside: 0,
    perMatch: [],      // 每场触球次数（配对比较用）
    origin: [],
    travel: [],
    landing: [],
    kind: new Map(),
    // 起点深度分带 × 种类：用来验证「近门触球是门将/封堵，不是中卫线」这一机制
    bandKind: new Map(),
    blockedByOwnThird: 0,
  };
  for (const seed of seeds) {
    let matchKicks = 0;
    const original = Math.random;
    Math.random = seededRandom(seed);
    try {
      const engine = new SimEngine(
        makeClub(`home-${seed}`, 15, line),
        makeClub(`away-${seed}`, 15, 3), // away 恒 3：背景不变，单一变量
        { simulationProfile: "standard", timeStep, separationPasses: 8 }
      );
      const steps = Math.round((90 * 60) / timeStep);
      let pending = null;
      let lastKickTeam = null;
      for (let step = 0; step < steps; step++) {
        const prevState = engine.ball.state;
        engine.step(timeStep);
        const b = engine.ball;
        const owner = b.owner ? engine.agentById(b.owner) : null;
        const t = engine.t;

        const hasKickOrigin =
          b.kickTeam && Number.isFinite(b.kickX) && Number.isFinite(b.kickY);
        const inTouchState = b.state === "pass" || b.state === "loose";
        const isNewKick = hasKickOrigin && inTouchState && prevState !== b.state;
        const teamChanged =
          hasKickOrigin &&
          inTouchState &&
          lastKickTeam !== null &&
          lastKickTeam !== b.kickTeam &&
          prevState === b.state;
        if (hasKickOrigin && inTouchState) lastKickTeam = b.kickTeam;

        // ⚠️ **先结算、再检测**：若把检测写在结算之前，「本帧对手夺球」会先把
        // `pending` 清空，导致这一帧的落点被静默丢弃（少计一次触球）。
        // 与 `_box-clearance-landing-probe.mjs` 的次序保持一致。
        if (
          pending &&
          ((b.state !== "pass" && b.state !== "loose") ||
            (owner && owner.team !== "home") ||
            (b.kickTeam && b.kickTeam !== "home"))
        ) {
          stats.kicks++;
          matchKicks++;
          const goalY = 100; // home 守 +y 端
          const stillIn = engine._inOwnFoulBox("home", b.x, b.y);
          if (stillIn) stats.landedInside++;
          stats.origin.push(Math.hypot(pending.x - 50, pending.y - goalY));
          stats.travel.push(Math.hypot(b.x - pending.x, b.y - pending.y));
          stats.landing.push(Math.hypot(b.x - 50, b.y - goalY));
          stats.kind.set(pending.kind, (stats.kind.get(pending.kind) || 0) + 1);
          // 起点深度分带（离本方球门，单位）：≤6 / 6~12 / 12~22 / >22
          const od = Math.hypot(pending.x - 50, pending.y - goalY);
          const band = od <= 6 ? "≤6(门线前)" : od <= 12 ? "6~12" : od <= 22 ? "12~22" : ">22";
          const bk = `${band}|${pending.kind}`;
          stats.bandKind.set(bk, (stats.bandKind.get(bk) || 0) + 1);
          pending = null;
        }

        if (isNewKick || teamChanged) {
          const kickerTeam = b.kickTeam;
          if (kickerTeam !== "home") {
            pending = null;
          } else if (engine._inOwnFoulBox("home", b.kickX, b.kickY)) {
            pending = { x: b.kickX, y: b.kickY, at: t, kind: b.state };
          } else if (pending) {
            pending = null;
          }
        }
      }
    } finally {
      Math.random = original;
    }
    stats.perMatch.push(matchKicks);
  }
  return stats;
}

const CONFIGS = [
  { line: 1, label: "L1 回收（乘数 0.30）" },
  { line: 3, label: "L3 标准（乘数 1.00，=审计口径）" },
  { line: 5, label: "L5 压上（乘数 1.70）" },
];

console.log(
  `\n=== 防线高度 → 防守方本方禁区触球的起点深度（${seeds.length} 场，仅统计 home，away 恒 3）===`
);

const results = [];
for (const cfg of CONFIGS) {
  const s = run(cfg.line);
  const per = (v) => Number((v / seeds.length).toFixed(2));
  results.push({ ...s, label: cfg.label });
  console.log(`\n--- ${cfg.label} ---`);
  console.log({
    "触球次数": s.kicks,
    "每场": per(s.kicks),
    "落点仍在禁区内": `${s.landedInside} (${pct(s.landedInside, s.kicks)}%)`,
    "起点离球门 中位": median(s.origin),
    "起点离球门 p75": quantile(s.origin, 0.75),
    "起点离球门 p90": quantile(s.origin, 0.9),
    "位移中位": median(s.travel),
    "落点离球门 中位": median(s.landing),
  });
  const kinds = [...s.kind.entries()].sort((a, b) => b[1] - a[1]);
  console.log("  种类：" + kinds.map(([k, v]) => `${k} ${v}(${pct(v, s.kicks)}%)`).join("、"));
  const bands = ["≤6(门线前)", "6~12", "12~22", ">22"];
  console.log("  起点深度分带 × 种类：");
  for (const band of bands) {
    const parts = ["pass", "loose"].map((kind) => {
      const v = s.bandKind.get(`${band}|${kind}`) || 0;
      return `${kind} ${v}(${pct(v, s.kicks)}%)`;
    });
    const tot = ["pass", "loose"].reduce(
      (acc, kind) => acc + (s.bandKind.get(`${band}|${kind}`) || 0),
      0
    );
    console.log(`    ${band.padEnd(12)}合计 ${String(tot).padStart(4)} (${pct(tot, s.kicks)}%)  ${parts.join("  ")}`);
  }
}

console.log("\n=== 对比表（关键：起点中位是否随防线高度单调变化）===");
console.log("配置                        触球/场   起点中位   位移中位   留内%");
for (const r of results) {
  const per = Number((r.kicks / seeds.length).toFixed(2));
  console.log(
    `${r.label.padEnd(28)}${String(per).padStart(7)}` +
      `${String(median(r.origin)).padStart(10)}` +
      `${String(median(r.travel)).padStart(10)}` +
      `${String(pct(r.landedInside, r.kicks)).padStart(8)}%`
  );
}

const l3 = results[1];
const l1 = results[0];
const l5 = results[2];
console.log("\n=== 判读 ===");
const o1 = median(l1.origin), o3 = median(l3.origin), o5 = median(l5.origin);
const span = Math.max(o1, o3, o5) - Math.min(o1, o3, o5);
console.log(
  `起点中位：L1 ${o1} / L3 ${o3}（应≈7.38，复现原口径）/ L5 ${o5} ⇒ 极差 ${span.toFixed(2)} 单位`
);
if (span < 2) {
  console.log(
    "⇒ 起点深度对防线高度**几乎不敏感**。前压的是中卫线 block，而触球发生在更深的位置\n" +
      "   （门将托救/封堵/失控多发生在球门前），**防线高度管不到它 → 杠杆在别处**。"
  );
} else if (o5 > o3 && o3 > o1) {
  console.log("⇒ 起点深度随防线高度**单调变浅**：防线越高、触球点越靠外 → 该量已被现有杠杆覆盖。");
} else if (o1 > o3 && o3 > o5) {
  console.log("⇒ 意外：防线**越深**触球点越靠外（反直觉，需查 block 与门将的相互作用）。");
} else {
  console.log("⇒ 非单调，需查中间配置与分种类构成后再判读。");
}

// —— 配对比较：同种子下每场触球次数（Step 2 的决定性检验）——
console.log("\n=== 配对比较：每场触球次数（同种子，消除种子噪声）===");
function paired(a, b, nameA, nameB) {
  const diffs = a.perMatch.map((v, i) => v - b.perMatch[i]);
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const sd = Math.sqrt(
    diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, diffs.length - 1)
  );
  const se = sd / Math.sqrt(diffs.length);
  const t = se > 0 ? mean / se : 0;
  const better = diffs.filter((d) => d > 0).length;
  console.log(
    `${nameA} − ${nameB}: 均值 ${mean.toFixed(2)}/场 ± ${se.toFixed(2)}  t=${t.toFixed(2)}  ` +
      `(SE=${sd.toFixed(2)}, ${better}/${diffs.length} 场为正)`
  );
  return { mean, se, t, better, n: diffs.length };
}
const p15 = paired(l1, l5, "L1", "L5");
const p13 = paired(l1, l3, "L1", "L3");
const p35 = paired(l3, l5, "L3", "L5");
console.log(
  "\n⚠️ 配对 t 不是独立样本 t：同种子的两配置仍相关，这里只用于看**方向一致性**\n" +
    "   与效应量大小，不作为 p 值引用。符号一致性（多少场为正）才是主证。"
);
console.log(
  `判读：L1→L5 每场触球均值差 ${p15.mean.toFixed(2)}（${p15.better}/${p15.n} 场为正）⇒ ` +
    (p15.better >= 0.8 * p15.n
      ? "方向高度一致，**回收型防线确实带来更多本方禁区触球**。"
      : "方向不一致，不足以下结论。")
);
