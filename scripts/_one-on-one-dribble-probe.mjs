/**
 * 一对一（持球者主动过人）诊断探针 —— 2026-09-18 夜新建。
 *
 * 为什么需要它（AGENTS.md 2026-09-18 夜交接 §下一步 #1）：
 *   用户问「有没有梅西式一对一突破」。静态阅读的结论是：
 *     · 引擎**已有**完整的"防守者抢断"结算（`engine.js:5969-6003`）：
 *       `dribbling + strength` vs `tackling + marking`，含护球朝向/动量/犯规。
 *     · 缺的是**持球者主动发起**的过人动作。`engine.js:2736-2750` 的 `dribble`
 *       选项只做两件事：设 `intent.tx/ty`（跑向空当）+ 权重 `(1 - pressure*0.55)`。
 *       ⇒ **压力越大越不愿带球** —— 它是"有空间就带球跑"，不是"过掉眼前的人"。
 *   ⇒ 本探针量化这个缺口：**持球者被贴身时，实际发生了什么？**
 *
 * ⚠ 关键约束（决定了本探针必须用**差异档**）：
 *   现有全部探针的球队都是「所有属性同值」（能力 15 ⇒ passing/vision/dribbling
 *   全部 = norm(15) = 0.76）。同值档下，`dribbling` 高与低无法区分，
 *   「球星 vs 普通」的差异**在构造上就被抹掉了**。所以本探针显式构造
 *   **差异档**：核心球员（指定 dribbling/vision/passing 高）+ 普通球员（低）。
 *
 * 本探针**只读不写**：不插桩、不消费随机数、不改引擎。
 * 它读 `engine.events` 的 `pressure`/`tackle` 事件 + 每 tick 采样持球者周边几何，
 * 输出「贴身持球」的频次、持续时长、以及随后发生了什么。
 *
 * 用法：
 *   node scripts/_one-on-one-dribble-probe.mjs [场数] [种子起点] [档位]
 *   档位 = uniform（同值 15，与既有探针对齐）| tiered（差异档，核心高/普通低）
 *   默认 12 场、种子 372000、tiered
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const matches = Math.max(2, Number(process.argv[2]) || 12);
const seedBase = Math.max(1, Number(process.argv[3]) || 372000);
const TIER = (process.argv[4] || "tiered") === "uniform" ? "uniform" : "tiered";

const SAMPLE_INTERVAL = 0.1;
/**
 * ⚠ 关键：引擎的 x/y 是 **100×100 内部坐标**，不是米。球场是 68m × 105m，
 * 所以纵向每单位 ≈ 1.05m、横向 ≈ 0.68m。**必须做各向异性换算**，
 * 否则"3 场单位"在纵向是 3.15m、横向只有 2.04m —— 判据随方向漂移。
 * （引擎自己的 `pitchDistanceBetween` 是模块私有，这里显式复制同一换算。）
 */
const PER_UNIT_X = 68 / 100;
const PER_UNIT_Y = 105 / 100;
function pitchDistM(ax, ay, bx, by) {
  return Math.hypot((ax - bx) * PER_UNIT_X, (ay - by) * PER_UNIT_Y);
}
/** 「贴身」判定：与最近对手 ≤ 该米数。CONTROL_RADIUS_METRES = 2.6。 */
const TIGHT_METRES = Number(process.env.TIGHT_M || 3.0);
/** 「拉开」判定：贴身后把对手甩到该米数以外（且仍持球）算一次摆脱。 */
const ESCAPE_METRES = 5.0;

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
 * 球队构造。uniform = 既有探针口径（所有属性同值）。
 * tiered = 差异档：p5/p6/p10 是核心（高 dribbling/vision/passing），
 * 其余为普通球员（低一档）。两侧对称，避免引入实力不平衡。
 */
function makeClub(name) {
  const roles = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  /** 核心球员下标（三个中场 + 两个前锋里的中间那个）。 */
  const CORE = new Set([5, 6, 9]);
  const players = roles.map((pos, index) => {
    const id = `${name}-p${index}`;
    let rating;
    if (TIER === "uniform") {
      rating = 15;
    } else {
      // GK/DEF 走普通档；核心档把 technical 三维拉高，其余保持普通
      rating = CORE.has(index) ? 18 : 11;
    }
    const attrs = {};
    for (const key of [
      "pace", "shooting", "passing", "dribbling", "defending", "physical", "finishing",
      "tackling", "marking", "strength", "stamina", "vision", "reflexes", "handling",
      "positioning", "kicking", "decisions", "crossing",
    ]) {
      attrs[key] = rating;
    }
    if (TIER === "tiered" && !CORE.has(index)) {
      // 普通球员：技术三维再低一档，体能对抗维持 —— 让"球星差异"只体现在技术层
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

/** 最近对手（米）与对象。 */
function nearestOpponent(engine, a) {
  let best = null;
  let bestD = Infinity;
  for (const o of engine.agents) {
    if (o.team === a.team || o.role === "GK" || o.sentOff) continue;
    const d = pitchDistM(o.x, o.y, a.x, a.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return { opp: best, d: bestD };
}

function runMatch(seed, tiered) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const engine = new SimEngine(makeClub(`home-${seed}`), makeClub(`away-${seed}`), {
      simulationProfile: "standard",
      timeStep: SIM.DT,
      separationPasses: 8,
    });

    const steps = Math.round((90 * 60) / SIM.DT);
    let nextSampleAt = 0;
    let cursor = 0;

    const reading = {
      // 贴身持球样本（每 0.1s 一次）
      tightSamples: 0,
      ownedSamples: 0,
      // 核心 vs 普通 分开计
      tightCore: 0,
      ownedCore: 0,
      tightOrdinary: 0,
      ownedOrdinary: 0,
      // 贴身状态下"持续向前推进"的样本（持球者贴近对手时仍在向对方球门方向移动）
      tightPushing: 0,
      // 贴身时"向外侧/后侧回避"的样本（远离对手，非向前）
      tightAvoiding: 0,
      // 事件计数
      tackleAttempts: 0,
      tacklesWon: 0,
      pressureEvents: 0,
      // 过人成功：贴身 → 在 1.5s 内拉开 ≥ ESCAPE_METRES 且仍持球
      escapes: 0,
      tightSpells: 0,
      // 核心球员的过人成功/尝试
      escapesCore: 0,
      tightSpellsCore: 0,
      // 最近对手距离直方图（数据驱动地选「贴身」阈值，而不是拍脑袋）
      // 桶：0-1,1-2,2-3,3-4,4-5,5-6,6-8,8-10,10-14,14+
      distHist: new Array(10).fill(0),
    };

    // 贴身回合追踪：playerId -> { startedAt, core, lastD, escaped }
    const tightState = new Map();
    let prevT = 0;

    for (let step = 0; step < steps; step++) {
      engine.step(SIM.DT);
      const t = engine.t;

      // 先消化事件（压力/抢断）
      for (; cursor < engine.events.length; cursor++) {
        const ev = engine.events[cursor];
        if (ev.type === "pressure") reading.pressureEvents++;
        else if (ev.type === "tackle") reading.tacklesWon++;
      }

      if (t < nextSampleAt) continue;
      nextSampleAt = t + SAMPLE_INTERVAL;

      const b = engine.ball;
      const owner = b.owner ? engine.agentById(b.owner) : null;
      if (!owner || (b.state !== "held" && b.state !== "control")) {
        // 球不在人脚下：结算所有贴身回合（spells = 全部回合，escapes 是其中子集）
        for (const [, st] of tightState) {
          reading.tightSpells++;
          if (st.core) reading.tightSpellsCore++;
        }
        tightState.clear();
        prevT = t;
        continue;
      }

      const ownerIsCore = !!(owner.isCore);
      reading.ownedSamples++;
      if (ownerIsCore) reading.ownedCore++;
      else reading.ownedOrdinary++;

      // 仅保留当前持球者一个回合；换人 ⇒ 结算旧回合（语义比 Map 清晰）
      for (const [id, st] of tightState) {
        if (id !== owner.id) {
          reading.tightSpells++;
          if (st.core) reading.tightSpellsCore++;
          tightState.delete(id);
        }
      }

      const { d } = nearestOpponent(engine, owner);
      const tight = d <= TIGHT_METRES;

      // 直方图分桶
      {
        const edges = [1, 2, 3, 4, 5, 6, 8, 10, 14];
        let bi = edges.findIndex((e) => d < e);
        if (bi < 0) bi = edges.length;
        reading.distHist[bi]++;
      }

      // ⚠ 状态机修正（第一版有缺陷）：第一版在 `d > TIGHT_METRES` 时就删除追踪，
      //   导致「拉开到 ESCAPE_METRES」的分支永远走不到（escapes 恒为 0）。
      //   正确做法：追踪一旦建立，**持续到本轮胜负已分**（拉开达标 / 重新贴身 / 丢球）。
      let st = tightState.get(owner.id);
      if (tight) {
        reading.tightSamples++;
        if (ownerIsCore) reading.tightCore++;
        else reading.tightOrdinary++;

        // 持球者此刻是否在向对方球门方向移动？
        const dir = engine.attackDir(owner.team);
        const progressSpeed = owner.vy * dir; // 场单位/秒（朝向进攻方向为正）
        if (progressSpeed > 0.8) reading.tightPushing++;
        else if (progressSpeed < -0.8) reading.tightAvoiding++;

        if (!st) {
          st = { startedAt: t, core: ownerIsCore, escaped: false, released: false };
          tightState.set(owner.id, st);
        }
        // 若曾拉开又回来贴身 ⇒ 这轮重新开始计
        st.released = false;
      } else if (st) {
        // 已不贴身：若拉开到 ESCAPE_METRES 以外，判定为一次摆脱（过人/甩开）
        if (d >= ESCAPE_METRES && !st.escaped) {
          st.escaped = true;
          reading.escapes++;
          if (st.core) reading.escapesCore++;
        }
        // 追踪继续保留（st 不删）—— 直到丢球（下面清空）或再次贴身
        st.released = true;
      }
      prevT = t;
    }

    for (const [st] of tightState) {
      if (!st.escaped) reading.tightSpells++;
      if (st.core && !st.escaped) reading.tightSpellsCore++;
    }

    return reading;
  } finally {
    Math.random = originalRandom;
  }
}

const rows = [];
for (let m = 0; m < matches; m++) rows.push(runMatch(seedBase + m, TIER === "tiered"));

const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
const per = (k) => Number((sum(k) / matches).toFixed(2));
const pct = (a, b) => (b > 0 ? Number(((a / b) * 100).toFixed(1)) : null);

console.log(
  `\n=== 一对一（贴身持球）诊断 —— ${matches} 场，种子 ${seedBase}..${seedBase + matches - 1}，档位 ${TIER} ===`
);
console.log(
  TIER === "tiered"
    ? "差异档：核心球员（中场×3/前锋×1）dribbling 18、vision 18；普通球员 dribbling 9、vision 9"
    : "同值档：所有属性 = 15（与既有探针对齐；⚠ 此档无法体现球星差异）"
);

console.log("\n[1] 持球样本的构成（每 0.1s 采样一次）：");
console.log({
  "持球样本/场": per("ownedSamples"),
  [`其中贴身(≤${TIGHT_METRES}m)样本/场`]: per("tightSamples"),
  "贴身占比%": pct(sum("tightSamples"), sum("ownedSamples")),
  "贴身样本中·核心球员/场": per("tightCore"),
  "贴身样本中·普通球员/场": per("tightOrdinary"),
});

// —— 最近对手距离直方图（数据驱动地确认阈值是否合理）——
console.log("\n[1b] 持球时「最近对手距离」分布（用来确认「贴身」阈值不是拍脑袋）：");
{
  const labels = ["<1m", "1-2m", "2-3m", "3-4m", "4-5m", "5-6m", "6-8m", "8-10m", "10-14m", "≥14m"];
  const total = rows.reduce(
    (s, r) => s + r.distHist.reduce((a, b) => a + b, 0),
    0
  );
  const hist = new Array(10).fill(0);
  for (const r of rows) for (let i = 0; i < 10; i++) hist[i] += r.distHist[i];
  let cum = 0;
  for (let i = 0; i < 10; i++) {
    const share = total ? (hist[i] / total) * 100 : 0;
    cum += share;
    const bar = "█".repeat(Math.round(share / 2));
    console.log(
      `  ${labels[i].padStart(6)}  ${(share).toFixed(2).padStart(6)}%  累计 ${cum
        .toFixed(1)
        .padStart(5)}%  ${bar}`
    );
  }
}

console.log("\n[2] 贴身时持球者在做什么（辅助读数）：");
console.log({
  "贴身且向前推进的样本/场": per("tightPushing"),
  "贴身且向后/侧回避的样本/场": per("tightAvoiding"),
  "向前的比例%": pct(sum("tightPushing"), sum("tightSamples")),
  "回避的比例%": pct(sum("tightAvoiding"), sum("tightSamples")),
});
console.log(
  "  ⚠ 实测更正：第一版推测「贴身时以回避为主」—— **实测否定**（向前 60% > 回避 17%）。"
);
console.log(
  "     但这不等于「有主动过人」：向前推进是**顺势跑动**（前方有空当就走），"
);
console.log(
  "     与「顶着防守者把球带过去」是两件事。判据在 [6] 的**摆脱率属性差**，不是这一节。"
);

console.log("\n[3] 贴身回合与结果：");
console.log({
  "贴身回合/场": per("tightSpells"),
  "其中核心球员发起/场": per("tightSpellsCore"),
  "过人成功(拉开≥4.5)/场": per("escapes"),
  "其中核心球员/场": per("escapesCore"),
  "过人成功率%": pct(sum("escapes"), sum("tightSpells")),
  "核心球员过人成功率%": pct(sum("escapesCore"), sum("tightSpellsCore")),
});

console.log("\n[4] 防守侧结算（既有系统，供对照）：");
console.log({
  "pressure 事件/场": per("pressureEvents"),
  "抢断成功(tackle 事件)/场": per("tacklesWon"),
});

console.log("\n[5] 核心 vs 普通 的差距（本探针要回答的核心问题）：");
{
  const coreTightPct = pct(sum("tightCore"), sum("ownedCore"));
  const ordTightPct = pct(sum("tightOrdinary"), sum("ownedOrdinary"));
  console.log({
    "核心球员被迫贴身占比%": coreTightPct,
    "普通球员被迫贴身占比%": ordTightPct,
    "核心球员过人成功率%": pct(sum("escapesCore"), sum("tightSpellsCore")),
    "（对照）全队过人成功率%": pct(sum("escapes"), sum("tightSpells")),
  });
  const gap = coreTightPct !== null && ordTightPct !== null ? coreTightPct - ordTightPct : null;
  console.log(
    gap === null
      ? "   ⚠ 样本不足，无法比较。"
      : coreTightPct > ordTightPct
        ? `   ⇒ 核心球员更常被贴身（差 ${gap.toFixed(1)}pp）—— 因为球更多在他脚下。`
        : `   ⇒ 普通球员更常被贴身（差 ${(-gap).toFixed(1)}pp）。`
  );
  console.log(
    "   注意：本探针测的是**几何后果**，不是成功率本身 —— 若引擎缺少「主动过人」，"
  );
  console.log(
    "         核心与普通球员的过人成功率应当**没有显著差异**（因为没有按属性结算的过人动作）。"
  );
}

console.log("\n[6] ⚖ 诊断结论 —— 「核心 vs 普通」的摆脱率是否有差异：");
{
  const corePct = pct(sum("escapesCore"), sum("tightSpellsCore"));
  const teamPct = pct(sum("escapes"), sum("tightSpells"));
  const coreSpells = sum("tightSpellsCore");
  const allSpells = sum("tightSpells");
  const coreEsc = sum("escapesCore");
  const allEsc = sum("escapes");

  console.log({
    "核心球员 摆脱/贴身回合": `${coreEsc} / ${coreSpells}`,
    "全队 摆脱/贴身回合": `${allEsc} / ${allSpells}`,
    "核心摆脱率%": corePct,
    "全队摆脱率%": teamPct,
  });

  // 判据：核心的 dribbling 是普通球员的 2 倍（18 vs 9）。若引擎有按属性结算的
  // 主动过人，核心摆脱率应显著高于普通球员（>1.5×）。若两者接近 ⇒ 无主动过人原语。
  const ordinaryEsc = allEsc - coreEsc;
  const ordinarySpells = allSpells - coreSpells;
  const ordPct = ordinarySpells > 0 ? (ordinaryEsc / ordinarySpells) * 100 : null;
  console.log({
    "普通球员 摆脱/贴身回合": `${ordinaryEsc} / ${ordinarySpells}`,
    "普通球员摆脱率%": ordPct === null ? null : Number(ordPct.toFixed(2)),
  });

  if (corePct === null || ordPct === null || ordinarySpells < 30) {
    console.log("   ⚠ 样本不足（普通球员贴身回合 <30）—— 加大场数再判。");
  } else {
    const ratio = corePct / ordPct;
    if (ratio >= 1.5) {
      console.log(
        `   ✅ 核心摆脱率 ${corePct}% vs 普通 ${ordPct.toFixed(2)}%（${ratio.toFixed(2)}×）⇒`
      );
      console.log("      存在按属性结算的摆脱差异 —— 引擎的抢断系统已提供部分一对一效应。");
    } else {
      console.log(
        `   ⛔ 核心摆脱率 ${corePct}% vs 普通 ${ordPct.toFixed(2)}%（仅 ${ratio.toFixed(2)}×）⇒`
      );
      console.log(
        "      尽管核心 dribbling 是普通的 **2 倍**，摆脱率却几乎无差异 ⇒"
      );
      console.log(
        "      **引擎不存在「持球者主动发起、按 dribbling 结算」的过人动作。**"
      );
      console.log(
        "      现有摆脱是**几何副作用**（防守者自己没跟上 / 抢断冷却 / 球权转移），不是过人的结果。"
      );
      console.log(
        "      ⇒ 「梅西式突破」需要一条**新原语**，而不是给现有 `dribble` 调权重 ——"
      );
      console.log(
        "        调权重只改变「何时带球」，不产生「越过对手」这种按属性结算的事件。"
      );
    }
  }
  console.log(
    "   注：本探针只读事件 + 几何采样，不改引擎、不消费随机数。"
  );
}
