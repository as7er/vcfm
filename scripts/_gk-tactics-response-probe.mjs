/**
 * 门将出球**读不读球队战术**？—— 冻结状态下的 A/B 取证（2026-09-23）。
 *
 * 用户问：「如果设置了控球战术，为什么守门员开球方式依然是开大脚？是不是应该相应的短传出球？」
 * 读代码的答案是「不读」：`js/sim/engine.js:2485 _gkDistribute` 的全部输入是
 * 局面压迫（就近对手距离 / 9 格内人数）+ **门将个人**角色与习惯
 * （`_hasHabit("distributes_short"/"launches_counters")`、`_roleBehavior("shortDistribution")`），
 * **没有** `tactics.style` / `tempo` / `possession`。本探针用行为验证它。
 *
 * 🔴 判据怎么才成立（两版失败教训都保留在注释里，别再走回去）：
 *   第一版：比「整场门将出球序列是否逐位相同」⇒ 0/4，差点读成「门将读了战术」。
 *     **错**：战术改变节奏 ⇒ 出球**次数**必然不同（43 vs 90）⇒ 序列必然不同。
 *     那证明的是「战术影响比赛」，不是「门将读了战术」。
 *   第二版：受控比较「同一出球情境指纹 → 决策是否相同」⇒ 仍报 3 个「冲突」。
 *     **错**：`_gkDistribute` 里 `_bestPass(a)` 读**全队几何**，而**队友位置也随战术变**
 *     ⇒ 同一指纹下长传档自己就出现了**两种决策**（说明指纹没有穷尽状态）。
 *
 *   ⇒ 唯一干净的判据：**同一个引擎、同一个冻结状态，只翻转战术文本**，
 *     再调一次 `_gkDistribute` 看决策是否变化。这样「全队几何」完全相同，
 *     唯一的变量就是战术 ⇒ 是否读战术一目了然。
 *
 * ⚠ 纪律：引擎不认 `opts.seed`，必须传 `opts.random`；同进程双跑自检。
 *
 * 用法：node scripts/_gk-tactics-response-probe.mjs [场数=6]
 */
import { SimEngine, SIM } from "../js/sim/engine.js";

const MATCHES = Math.max(2, Number(process.argv[2]) || 6);
const DT = SIM.DT;
const POSSESSION = { style: "possession", tempo: 1, pressing: 3, width: 3, defensiveLine: 3 };
const DIRECT = { style: "direct", tempo: 5, pressing: 3, width: 3, defensiveLine: 3 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClub(name, tactics) {
  const positions = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];
  const players = positions.map((pos, i) => ({
    id: `${name}-${i}`,
    name: `${name}-${i}`,
    pos,
    number: i + 1,
    fitness: 100,
    attrs: Object.fromEntries(
      [
        "pace", "strength", "passing", "vision", "shooting", "finishing", "dribbling",
        "tackling", "marking", "stamina", "positioning", "reflexes", "handling", "kicking",
        "heading", "crossing", "decisions", "physical",
      ].map((k) => [k, 14])
    ),
  }));
  return {
    id: name,
    name,
    players,
    tactics: { formation: "4-3-3", lineup: players.map((p) => p.id), ...tactics },
  };
}

/** 门将出球决策的可判定摘要：落点（大脚=远处；短传=近处）+ 是否指定接球人 */
function decisionOf(engine, gk) {
  const eventsBefore = engine.events.length;
  const rngBefore = engine._gkProbeRngState ?? null;
  void rngBefore;
  engine._gkDistribute(gk);
  const fresh = engine.events.slice(eventsBefore);
  const pass = fresh.find((e) => e.type === "pass") || null;
  return {
    types: fresh.map((e) => e.type),
    tx: pass?.x ?? null,
    ty: pass?.y ?? null,
  };
}

function runMatch(matchIndex) {
  const seed = 0x7a000 + matchIndex * 7919;
  const engine = new SimEngine(makeClub(`h${matchIndex}`, POSSESSION), makeClub(`a${matchIndex}`, POSSESSION), {
    random: mulberry32(seed),
    simulationProfile: "standard",
    timeStep: DT,
    separationPasses: 8,
  });
  const steps = Math.round((90 * 60) / DT);
  const samples = [];
  let sinceLast = 0;
  for (let i = 0; i < steps; i += 1) {
    engine.step(DT);
    sinceLast += 1;
    // 每隔 2 分钟取样一次：在**球位于本方半场、门将持球附近**的时刻做冻结比较
    if (sinceLast < Math.round(6 / DT)) continue;
    sinceLast = 0;
    const gk = engine.agents.find((a) => a.team === "home" && a.role === "GK");
    if (!gk || !engine.ball.owner || engine.ball.owner !== gk.id) continue;
    if (engine.pendingPenalty || engine.ball.restartType === "corner") continue;
    samples.push(captureSample(engine, gk));
  }
  return samples;
}

/**
 * 冻结一个样本：把引擎状态深拷贝两份，一份用控球战术、一份用长传战术，
 * 其余**逐位相同**，然后各跑一次 `_gkDistribute`。
 *
 * ⚠ `SimEngine` 有函数字段（`random`）与 Map/Set，不能整体 `structuredClone`；
 *   本探针只用它来**读**决策，因此做法是：
 *   · 记下当前 `home.tactics` / `away.tactics`；
 *   · 先按控球战术调用一次 ⇒ 记决策；
 *   · 把球与**所有 agent 的坐标/状态复位**到调用前的快照（决策不写坐标，只需复位球与被清空的字段）；
 *   · 再按长传战术调用一次 ⇒ 记决策；
 *   · 最后复位战术文本。
 *   为消除随机流差异，两次调用前都把 `random` 换成**同种子的新 PRNG**。
 */
function captureSample(engine, gk) {
  const ballSnapshot = {
    x: engine.ball.x, y: engine.ball.y, z: engine.ball.z,
    vx: engine.ball.vx, vy: engine.ball.vy, vz: engine.ball.vz,
    owner: engine.ball.owner, state: engine.ball.state,
    lastKicker: engine.ball.lastKicker, kickTeam: engine.ball.kickTeam,
    restartType: engine.ball.restartType,
  };
  const agentsSnapshot = engine.agents.map((a) => ({ id: a.id, x: a.x, y: a.y, tx: a.tx, ty: a.ty, intent: a.intent }));
  const eventsBefore = engine.events.length;
  const originalRandom = engine.random;
  const savedHome = { ...engine.home.tactics };
  const savedAway = { ...engine.away.tactics };

  const restore = () => {
    Object.assign(engine.ball, ballSnapshot);
    for (const s of agentsSnapshot) {
      const a = engine.agentById(s.id);
      if (!a) continue;
      a.x = s.x;
      a.y = s.y;
      a.tx = s.tx;
      a.ty = s.ty;
      a.intent = s.intent;
    }
    engine.events.length = eventsBefore;
    engine.random = originalRandom;
  };

  const probe = (tactics) => {
    Object.assign(engine.home.tactics, tactics);
    Object.assign(engine.away.tactics, tactics);
    engine.random = mulberry32(0x9911); // 同种子 ⇒ 两次调用面对同一随机流
    const d = decisionOf(engine, gk);
    restore();
    return d;
  };

  const a = probe(POSSESSION);
  const b = probe(DIRECT);
  Object.assign(engine.home.tactics, savedHome);
  Object.assign(engine.away.tactics, savedAway);
  return { a, b, same: JSON.stringify(a) === JSON.stringify(b), ball: { x: ballSnapshot.x, y: ballSnapshot.y } };
}

console.log(`=== 门将出球 vs 球队战术（冻结状态 A/B，${MATCHES} 场）===\n`);
console.log("A = 控球（style=possession, tempo=1）｜B = 长传（style=direct, tempo=5）");
console.log("同一个引擎 / 同一冻结状态 / 同一随机种子，**唯一变量是战术文本**。\n");

let total = 0;
let same = 0;
let longA = 0;
let longB = 0;
const diffs = [];
for (let m = 0; m < MATCHES; m += 1) {
  const samples = runMatch(m);
  for (const s of samples) {
    total += 1;
    if (s.same) same += 1;
    else if (diffs.length < 5) diffs.push({ m, ...s });
    // 落点纵深（越小 = 越靠本方门 = 越短）
    if (s.a.ty != null) longA += 1;
    if (s.b.ty != null) longB += 1;
  }
  console.log(`  场 ${m}：冻结样本 ${samples.length} 个，其中决策相同 ${samples.filter((s) => s.same).length} 个`);
}
console.log(`\n合计冻结样本 ${total} 个；A/B 决策**完全一致**的 ${same} 个` + (total ? `（${((same / total) * 100).toFixed(1)}%）` : ""));

console.log(`\n=== 判定 ===`);
if (total === 0) {
  console.log("⚠ 没有取到可用样本（门将持球时刻太少）—— 这不是结论，请加大场数或放宽取样条件。");
} else if (same === total) {
  // 2026-09-23 v291 起 `_gkDistribute` 已接入 `style`/`tempo`（短传门槛 ±0.05）
  // ⇒ 「零响应」现在是**回归**，不再是可解释的现状。
  console.log("🔴 在**完全相同的冻结状态**下，把球队战术从「极致控球」翻到「极致长传」，");
  console.log(`   门将出球决策 **${total}/${total} 一处都没变** ⇒ 球队战术**没接进**门将出球。`);
  console.log("   v291 起 `_gkDistribute` 的短传门槛应读 `style`/`tempo`（`teamShortBias`），");
  console.log("   这里零响应说明那条线断了（v290 修前实测 71/71 零响应，v291 修后 8/84 不同）。");
} else {
  console.log(`✅ ${total - same}/${total} 个冻结样本在两档下决策不同 ⇒ 门将出球读到了球队战术；`);
  console.log("   预期方向：控球档更多短传（pass），长传档更多大脚（gk_clear）。");
  console.log("   不同的只占少数是设计如此：战术只是修正项，门将个人习惯与局面压迫仍是主因。");
  for (const d of diffs) {
    console.log(`   球(${d.ball.x.toFixed(1)},${d.ball.y.toFixed(1)}) 控球=${JSON.stringify(d.a)} 长传=${JSON.stringify(d.b)}`);
  }
}
console.log(`\n（参考：A 档指定了落点的次数 ${longA}，B 档 ${longB}）`);
